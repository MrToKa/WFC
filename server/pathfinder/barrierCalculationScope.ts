import fs from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { barrierAdmissionIntentSchema, type BarrierAdmissionIntent } from '../../shared/pathfinderBarrierAdmission.js';
import { BARRIER_LIMITS, barrierCanonicalJson, barrierCaptureCommandSchema, barrierCaptureSchema, barrierSnapshotSchema,
  barrierSnapshotHashInput } from '../../shared/pathfinderBarriers.js';
import { BARRIER_RUNTIME_PROFILE, barrierRuntimeContextSchema, createBarrierRuntimePolicy, type BarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';
import { policyHashSchema, policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { currentBarrierScope } from './barrierScope.js';
import { barrierBytesHash, barrierValueHash, encodeBarrierJson, readBarrierBytes } from './barrierStorage.js';
import { parsePolicyJson } from './policyJson.js';
import { pathFinderRoot } from './storage.js';
import { PathFinderError } from './errors.js';

const blobSchema = z.object({ blobId: policyUuidSchema, sha256: policyHashSchema, bytes: z.number().int().positive().max(BARRIER_LIMITS.captureBytes) }).strict();
const frozenIntentSchema = z.object({ id: policyUuidSchema, snapshotId: policyUuidSchema, captureBlobId: policyUuidSchema, manifestBlobId: policyUuidSchema,
  command: barrierCaptureCommandSchema, createdBy: policyUuidSchema, loginId: policyUuidSchema }).strict();
const allocationSchema = z.array(z.object({ fragmentId: z.number().int().nonnegative().max(2147483647), blobId: policyUuidSchema }).strict())
  .min(1).max(BARRIER_LIMITS.fragments).refine(values => new Set(values.map(value => value.fragmentId)).size === values.length && new Set(values.map(value => value.blobId)).size === values.length);
const same = (left: unknown, right: unknown) => barrierCanonicalJson(left) === barrierCanonicalJson(right);
const fail = (code = 'BARRIER_CALCULATION_SCOPE_CHANGED', status = 409): never => {
  throw new PathFinderError(code, status, 'The registered barrier scope is unavailable or changed. Refresh barriers and calculate again.');
};
const missingRetainedFile = (error: unknown): never => {
  if (error !== null && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT')
    return fail('BARRIER_CALCULATION_STORAGE_INVALID');
  throw error;
};
const readCalculationBytes: typeof readBarrierBytes = (...args) => readBarrierBytes(...args).catch(missingRetainedFile);
type SnapshotRow = { id: string; model_version_id: string; registry_revision: string; storage_intent_id: string; manifest_blob: unknown; manifest: unknown };
type IntentRow = { id: string; state: string; actor_id: string; login_id: string; request_sha256: string; request: unknown; frozen: unknown; capture_sha256: string; allocation: unknown };

/** Caller owns the current administrator/grant and project transaction, including
 * the project-row lock that fences an absent head. This reader starts no nested
 * transaction, mutates no SQL rows and performs no topology/SDK certification. */
export async function collectBarrierCalculationScope(client: PoolClient, projectId: string, rawIntent: BarrierAdmissionIntent,
  options: { signal?: AbortSignal; deadline?: number } = {}): Promise<BarrierRuntimeContext> {
  policyUuidSchema.parse(projectId);
  const intent = barrierAdmissionIntentSchema.parse(rawIntent);
  if (intent.scope.projectId !== projectId) return fail();
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + 15_000);
  if (!Number.isFinite(deadline)) return fail('BARRIER_CALCULATION_DEADLINE', 503);
  const check = () => { options.signal?.throwIfAborted(); if (Date.now() >= deadline) fail('BARRIER_CALCULATION_DEADLINE', 503); };
  check(); const scope = await currentBarrierScope(client, projectId); check();
  if (!same(scope, intent.scope)) return fail();
  const heads = (await client.query<{ revision: string; snapshot_id: string | null }>(
    '/* barrier:calculation-head */ SELECT revision::text,snapshot_id FROM pf_barrier_heads WHERE project_id=$1 FOR SHARE', [projectId])).rows;
  check(); if (heads.length > 1) return fail();
  const head = heads[0] ?? { revision: '0', snapshot_id: null };
  policyRevisionSchema.parse(head.revision);
  if (head.revision !== intent.expectedRegistryRevision || head.snapshot_id !== (intent.expectedSnapshot?.snapshotId ?? null)) return fail();
  const policy = createBarrierRuntimePolicy(intent.drillThroughWalls);
  const common = { schemaVersion: 'wfc.pf.barrier-runtime.v1' as const,
    binding: { scope, registryRevision: head.revision, snapshot: intent.expectedSnapshot, policy, policySha256: barrierValueHash(policy) },
    profile: BARRIER_RUNTIME_PROFILE, profileSha256: barrierValueHash(BARRIER_RUNTIME_PROFILE) };
  if (!head.snapshot_id) {
    if (head.revision !== '0' || intent.expectedSnapshot !== null || !intent.drillThroughWalls) return fail();
    return barrierRuntimeContextSchema.parse({ ...common, storage: null });
  }
  const snapshots = (await client.query<SnapshotRow>(`/* barrier:calculation-snapshot */
    SELECT id,model_version_id,registry_revision::text,storage_intent_id,manifest_blob,
      CASE WHEN octet_length(manifest::text)<=$3 THEN manifest ELSE NULL END AS manifest
    FROM pf_barrier_snapshots WHERE project_id=$1 AND id=$2 FOR SHARE`, [projectId, head.snapshot_id, BARRIER_LIMITS.manifestBytes])).rows;
  check(); if (snapshots.length !== 1) return fail('BARRIER_CALCULATION_STORAGE_INVALID');
  const row = snapshots[0], parsed = barrierSnapshotSchema.safeParse(row.manifest), blob = blobSchema.safeParse(row.manifest_blob);
  if (!parsed.success || !blob.success || blob.data.bytes > BARRIER_LIMITS.manifestBytes) return fail('BARRIER_CALCULATION_STORAGE_INVALID');
  const manifest = parsed.data;
  policyUuidSchema.parse(row.storage_intent_id);
  const reference = { snapshotId: manifest.snapshotId, scope: manifest.scope, registryRevision: manifest.registryRevision,
    contentSha256: manifest.contentSha256, mode: manifest.geometry.mode };
  if (row.id !== manifest.snapshotId || row.model_version_id !== scope.modelVersionId || row.registry_revision !== head.revision
    || manifest.registryRevision !== head.revision || !same(manifest.scope, scope) || !same(reference, intent.expectedSnapshot)
    || barrierValueHash(barrierSnapshotHashInput(manifest)) !== manifest.contentSha256) return fail('BARRIER_CALCULATION_STORAGE_INVALID');
  const storedManifest = await readCalculationBytes(projectId, row.storage_intent_id, blob.data, BARRIER_LIMITS.manifestBytes); check();
  if (!storedManifest.equals(encodeBarrierJson(manifest, BARRIER_LIMITS.manifestBytes))) return fail('BARRIER_CALCULATION_STORAGE_INVALID');
  let captureBlob: z.infer<typeof blobSchema> | null = null;
  if (manifest.geometry.mode === 'mesh-set') {
    if (!manifest.capture || manifest.capture.captureId !== row.storage_intent_id) return fail('BARRIER_CALCULATION_STORAGE_INVALID');
    const intents = (await client.query<IntentRow>(`/* barrier:calculation-intent */ SELECT id,state,actor_id,login_id,request_sha256,capture_sha256,allocation,
      CASE WHEN octet_length(request::text)<=$3 THEN request ELSE NULL END AS request,
      CASE WHEN octet_length(frozen::text)<=$3+1024 THEN frozen ELSE NULL END AS frozen
      FROM pf_barrier_capture_intents WHERE project_id=$1 AND id=$2 FOR SHARE`, [projectId, row.storage_intent_id, BARRIER_LIMITS.controlBytes])).rows;
    check(); if (intents.length !== 1) return fail('BARRIER_CALCULATION_STORAGE_INVALID');
    const captureIntent = intents[0], frozen = frozenIntentSchema.safeParse(captureIntent.frozen), allocation = allocationSchema.safeParse(captureIntent.allocation);
    if (!frozen.success || !allocation.success || captureIntent.state !== 'complete' || captureIntent.id !== frozen.data.id
      || captureIntent.actor_id !== frozen.data.createdBy || captureIntent.login_id !== frozen.data.loginId
      || frozen.data.id !== row.storage_intent_id || frozen.data.snapshotId !== row.id || frozen.data.manifestBlobId !== blob.data.blobId
      || !same(captureIntent.request, frozen.data.command) || captureIntent.request_sha256 !== barrierValueHash(frozen.data.command)
      || !same(frozen.data.command.scope, scope) || !same(frozen.data.command.selectedParents, manifest.selectedParents)
      || BigInt(frozen.data.command.expectedRegistryRevision) + 1n !== BigInt(head.revision)
      || captureIntent.capture_sha256 !== manifest.capture.payloadSha256) return fail('BARRIER_CALCULATION_STORAGE_INVALID');
    // B2 retained the raw SHA but not its byte count. Observe only the bounded
    // server UUID path size; readBarrierBytes independently pins all ancestors,
    // file identity, exact bytes and the authoritative publication digest.
    const capturePath = path.join(await pathFinderRoot(), 'barriers', projectId, row.storage_intent_id, frozen.data.captureBlobId + '.json'); check();
    const stamp = await fs.lstat(capturePath, { bigint: true }).catch(missingRetainedFile); check();
    if (!stamp.isFile() || stamp.isSymbolicLink() || stamp.nlink !== 1n || stamp.size <= 0n || stamp.size > BigInt(BARRIER_LIMITS.captureBytes))
      return fail('BARRIER_CALCULATION_STORAGE_INVALID');
    captureBlob = blobSchema.parse({ blobId: frozen.data.captureBlobId, sha256: manifest.capture.payloadSha256, bytes: Number(stamp.size) });
    const raw = await readCalculationBytes(projectId, row.storage_intent_id, captureBlob, BARRIER_LIMITS.captureBytes); check();
    const captured = barrierCaptureSchema.safeParse(parsePolicyJson(raw, { maxBytes: BARRIER_LIMITS.captureBytes })); check();
    if (!captured.success || captured.data.captureId !== frozen.data.id || !same(captured.data.scope, scope)
      || !same(captured.data.selectedParents, manifest.selectedParents) || captured.data.observation.state !== 'reported-complete'
      || captured.data.fragments.length !== manifest.geometry.fragments.length || allocation.data.length !== captured.data.fragments.length)
      return fail('BARRIER_CALCULATION_STORAGE_INVALID');
    const allocationById = new Map(allocation.data.map(value => [value.fragmentId, value.blobId]));
    const fragments = new Map(captured.data.fragments.map(value => [value.source.fragmentId, value]));
    for (const fragment of manifest.geometry.fragments) {
      check(); const source = fragments.get(fragment.source.fragmentId);
      if (!source || allocationById.get(fragment.source.fragmentId) !== fragment.mesh.blobId || !same(source.source, fragment.source)
        || !same(source.bounds, fragment.bounds) || source.verticesMetres.length !== fragment.vertices
        || source.triangleIndices.length / 3 !== fragment.triangles) return fail('BARRIER_CALCULATION_STORAGE_INVALID');
      const mesh = encodeBarrierJson({ verticesMetres: source.verticesMetres, triangleIndices: source.triangleIndices });
      if (mesh.length !== fragment.mesh.bytes || barrierBytesHash(mesh) !== fragment.mesh.sha256) return fail('BARRIER_CALCULATION_STORAGE_INVALID');
      await readCalculationBytes(projectId, row.storage_intent_id, fragment.mesh); check();
    }
  }
  check();
  // Model/frame rows and the exact head remain locked by this transaction. A
  // final reread also refuses a broken caller fixture or changed frame source.
  if (!same(await currentBarrierScope(client, projectId), scope)) return fail(); check();
  return barrierRuntimeContextSchema.parse({ ...common, storage: { intentId: row.storage_intent_id, manifest: blob.data, capture: captureBlob } });
}

/** A browser-closed producer obtains a fresh published choice from locked server
 * state. It never borrows a manual drilling choice or treats absence as an empty
 * declaration. The same complete reader verifies retained publication bytes. */
export async function readCurrentBarrierAdmissionIntent(client: PoolClient, projectId: string, drillThroughWalls: false,
  options: { signal?: AbortSignal; deadline?: number } = {}): Promise<BarrierAdmissionIntent> {
  policyUuidSchema.parse(projectId);
  if (drillThroughWalls !== false) return fail('BARRIER_BACKGROUND_DRILLING_REFUSED');
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + 15_000);
  const check = () => { options.signal?.throwIfAborted(); if (!Number.isFinite(deadline) || Date.now() >= deadline) fail('BARRIER_CALCULATION_DEADLINE', 503); };
  check(); const scope = await currentBarrierScope(client, projectId); check();
  const heads = (await client.query<{ revision: string; snapshot_id: string | null }>(
    '/* barrier:calculation-head */ SELECT revision::text,snapshot_id FROM pf_barrier_heads WHERE project_id=$1 FOR SHARE', [projectId])).rows;
  check(); if (heads.length !== 1 || heads[0].snapshot_id === null || !policyRevisionSchema.safeParse(heads[0].revision).success)
    return fail('BARRIER_READY_SNAPSHOT_REQUIRED');
  const head = heads[0];
  const rows = (await client.query<SnapshotRow>(`/* barrier:calculation-snapshot */
    SELECT id,model_version_id,registry_revision::text,storage_intent_id,manifest_blob,
      CASE WHEN octet_length(manifest::text)<=$3 THEN manifest ELSE NULL END AS manifest
    FROM pf_barrier_snapshots WHERE project_id=$1 AND id=$2 FOR SHARE`, [projectId, head.snapshot_id, BARRIER_LIMITS.manifestBytes])).rows;
  check(); if (rows.length !== 1) return fail('BARRIER_READY_SNAPSHOT_REQUIRED');
  const parsed = barrierSnapshotSchema.safeParse(rows[0].manifest);
  if (!parsed.success) return fail('BARRIER_CALCULATION_STORAGE_INVALID');
  const manifest = parsed.data;
  const parsedIntent = barrierAdmissionIntentSchema.safeParse({ schemaVersion: 'wfc.pf.barrier-admission-intent.v1', scope,
    expectedRegistryRevision: head.revision, expectedSnapshot: { snapshotId: manifest.snapshotId, scope: manifest.scope,
      registryRevision: manifest.registryRevision, contentSha256: manifest.contentSha256, mode: manifest.geometry.mode }, drillThroughWalls: false });
  if (!parsedIntent.success) return fail();
  const intent = parsedIntent.data;
  await collectBarrierCalculationScope(client, projectId, intent, { ...options, deadline }); check();
  return intent;
}
