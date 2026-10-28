import { randomUUID, createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  MODEL_LOCATION_MATCH_LIMITS, modelLocationMatchAssignSchema, modelLocationMatchContextSchema, modelLocationMatchReceiptSchema,
  modelLocationMatchNamesHashInput, type ModelLocationMatchAssign, type ModelLocationMatchContext, type ModelLocationMatchResult,
} from '../../shared/pathfinderModelLocationMatch.js';
import { ENDPOINT_MODEL_MATCH_DERIVATION, endpointBindingSchema, endpointLocationSchema, endpointModelMatchEvidenceSchema, normalizeEndpointLocation, type EndpointBinding } from '../../shared/pathfinderEndpointBindings.js';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { assertLoginNotExpired } from './auth.js';
import { cableWorkflowReadTransaction } from './cableWorkflowRead.js';
import { endpointBindingTransaction, readCurrentEndpointBindingContext, confirmMatchedEndpointInTransaction } from './endpointBindingRepository.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { authorizePathFinderPreflight } from './projectPreflightAuthorization.js';

const digest = (v: unknown) => createHash('sha256').update(canonicalPurposeJson(v)).digest('hex');
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'Model location matching could not be completed. Refresh its context and check the reported names; keep an uncertain saved command for reconciliation.'); };
const bound = <T>(v: T): T => { if (Buffer.byteLength(canonicalPurposeJson(v)) > MODEL_LOCATION_MATCH_LIMITS.responseBytes) return fail('MODEL_LOCATION_MATCH_RESPONSE_LIMIT', 413); return v; };
const owner = (command: ModelLocationMatchAssign) => ({ schemaVersion: 'wfc.pf.model-location-match-owner.v1', command });

async function context(c: PoolClient, projectId: string, check: () => void): Promise<ModelLocationMatchContext> {
  const current = await readCurrentEndpointBindingContext(c, projectId); check();
  if (!current) return fail('ENDPOINT_PREPARATION_REQUIRED');
  const registry = (await c.query<{ revision: string }>('/* model-location-match:registry */ SELECT registry_revision::text AS revision FROM pf_project_state WHERE project_id=$1 FOR SHARE', [projectId])).rows[0];
  if (!registry) return fail('MODEL_LOCATION_MATCH_STATE_REQUIRED');
  const rows = (await c.query<{ name: string }>("/* model-location-match:names */ SELECT DISTINCT value COLLATE \"C\" AS name FROM cables c CROSS JOIN LATERAL(VALUES(c.from_location),(c.to_location)) e(value) WHERE c.project_id=$1 AND value IS NOT NULL AND btrim(value)<>'' ORDER BY name LIMIT 4097", [projectId])).rows; check();
  if (rows.length > MODEL_LOCATION_MATCH_LIMITS.names) return fail('MODEL_LOCATION_MATCH_NAME_LIMIT', 413);
  const byKey = new Map<string, string>();
  for (const row of rows) {
    const name = row.name.normalize('NFC').trim();
    if (!name.length || name.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) return fail('MODEL_LOCATION_MATCH_NAME_LIMIT', 413);
    const key = normalizeEndpointLocation(name); if (!byKey.has(key)) byKey.set(key, name);
  }
  const names = [...byKey.values()];
  return modelLocationMatchContextSchema.parse({ schemaVersion: 'wfc.pf.model-location-match-context.v1', projectId, current,
    registryRevision: registry.revision, names, namesSha256: digest(modelLocationMatchNamesHashInput(names)) });
}

async function location(c: PoolClient, projectId: string, name: string, check: () => void) {
  const rows = (await c.query<{ id: string; name: string; revision: string; binding_id: string | null; has_legacy: boolean }>("/* model-location-match:location */ SELECT l.id,l.name,l.revision::text,h.binding_id,EXISTS(SELECT 1 FROM pf_location_bindings b WHERE b.project_id=l.project_id AND b.location_id=l.id) AS has_legacy FROM pf_location_aliases a JOIN pf_locations l ON l.project_id=a.project_id AND l.id=a.location_id LEFT JOIN pf_endpoint_binding_heads h ON h.project_id=l.project_id AND h.location_id=l.id WHERE a.project_id=$1 AND a.normalized_alias=$2 ORDER BY l.id LIMIT 2 FOR SHARE OF a,l", [projectId, normalizeEndpointLocation(name)])).rows; check();
  if (rows.length > 1) return fail('MODEL_LOCATION_MATCH_ALIAS_AMBIGUOUS');
  if (!rows.length) return null;
  const row = rows[0], aliases = (await c.query<{ display_alias: string }>('/* model-location-match:aliases */ SELECT display_alias FROM pf_location_aliases WHERE project_id=$1 AND location_id=$2 ORDER BY normalized_alias LIMIT 102 FOR SHARE', [projectId, row.id])).rows; check();
  const value = endpointLocationSchema.parse({ id: row.id, name: row.name, revision: row.revision,
    aliases: aliases.map(v => v.display_alias).filter(n => normalizeEndpointLocation(n) !== normalizeEndpointLocation(row.name)) });
  let binding: EndpointBinding | null = null;
  if (row.binding_id) {
    const stored = (await c.query<{ record: unknown }>('/* model-location-match:head */ SELECT record FROM pf_endpoint_binding_revisions WHERE project_id=$1 AND id=$2 FOR SHARE', [projectId, row.binding_id])).rows[0];
    check(); binding = endpointBindingSchema.parse(stored?.record);
    const { contentSha256, ...body } = binding;
    if (binding.id !== row.binding_id || binding.projectId !== projectId || binding.locationId !== row.id || digest(body) !== contentSha256) return fail('ENDPOINT_HEAD_INTEGRITY');
  }
  return { ...value, bindingId: row.binding_id, binding, hasLegacy: row.has_legacy };
}

/** Explicit matching records approximate fixed-world observations. Existing
 * bindings survive. This operation never invokes the engine or its outboxes. */
export function createModelLocationMatchRepository(pool: Pool) {
  return {
    authorize(projectId: string, who: JobPrincipal) { return authorizePathFinderPreflight(pool, projectId, who); },
    context(projectId: string, who: JobPrincipal, signal?: AbortSignal) {
      return cableWorkflowReadTransaction(pool, projectId, who, (c, check) => context(c, projectId, check), signal);
    },
    assign(projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal) {
      policyUuidSchema.parse(projectId);
      return endpointBindingTransaction(pool, projectId, who, async c => {
        const check = () => { signal?.throwIfAborted(); assertLoginNotExpired(who); }; check();
        const command = modelLocationMatchAssignSchema.parse(raw), request = owner(command), commandSha256 = digest(command);
        if (Buffer.byteLength(canonicalPurposeJson(request)) > MODEL_LOCATION_MATCH_LIMITS.bodyBytes) return fail('MODEL_LOCATION_MATCH_BODY_LIMIT', 413);
        const old = (await c.query<{ request_sha256: string; request: unknown; receipt: unknown; kind: string }>(
          '/* model-location-match:replay */ SELECT kind,request_sha256,request,receipt FROM pf_endpoint_binding_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 FOR SHARE',
          [projectId, who.userId, command.idempotencyKey])).rows[0]; check();
        if (old) {
          if (old.kind !== 'confirm' || old.request_sha256 !== digest(request) || canonicalPurposeJson(old.request) !== canonicalPurposeJson(request))
            return fail('MODEL_LOCATION_MATCH_IDEMPOTENCY_CONFLICT');
          const receipt = modelLocationMatchReceiptSchema.parse(old.receipt);
          if (receipt.projectId !== projectId || receipt.idempotencyKey !== command.idempotencyKey || receipt.commandSha256 !== commandSha256)
            return fail('MODEL_LOCATION_MATCH_RECEIPT_INTEGRITY');
          return bound({ ...receipt, duplicate: true });
        }
        const snapshot = await context(c, projectId, check);
        if (canonicalPurposeJson(snapshot.current) !== canonicalPurposeJson(command.current)
          || snapshot.namesSha256 !== command.namesSha256 || snapshot.registryRevision !== command.expectedRegistryRevision
          || command.names.some(n => !snapshot.names.some(s => normalizeEndpointLocation(s) === normalizeEndpointLocation(n))))
          return fail('MODEL_LOCATION_MATCH_CONTEXT_CHANGED');
        const scanSha256 = digest(command.scan), results: ModelLocationMatchResult[] = [];
        let revision = snapshot.registryRevision;
        await c.query("SET LOCAL wfc.pathfinder_location_impact='1'");
        for (const name of command.names) {
          check();
          const saved = await location(c, projectId, name, check);
          const candidates = command.scan.candidates.filter(v => v.matchedNames.some(n => normalizeEndpointLocation(n) === normalizeEndpointLocation(name)));
          const candidateObjectIds = candidates.map(v => v.objectId).sort((a, b) => a - b);
          const base = { name, candidateObjectIds, locationId: saved?.id ?? null, bindingId: saved?.bindingId ?? null };
          if (saved?.hasLegacy || saved?.bindingId && (saved.binding?.derivation !== ENDPOINT_MODEL_MATCH_DERIVATION
            || saved.binding.status === 'confirmed' && saved.binding.locationRevision === saved.revision
              && canonicalPurposeJson(saved.binding.autoMatchEvidence?.current) === canonicalPurposeJson(snapshot.current))) {
            results.push({ ...base, status: 'preserved', reasonCode: 'EXISTING_LOCATION_BINDING_PRESERVED' }); continue;
          }
          if (candidates.length !== 1) { results.push({ ...base, status: candidates.length ? 'ambiguous' : 'missing', reasonCode: candidates.length ? 'MODEL_LOCATION_MATCH_AMBIGUOUS' : 'MODEL_LOCATION_MATCH_MISSING' }); continue; }
          const candidate = candidates[0];
          if (candidate.objectId === 0) { results.push({ ...base, status: 'unavailable', reasonCode: 'MODEL_LOCATION_MATCH_UNSUPPORTED_MODEL_OBJECT' }); continue; }
          if (!candidate.bounds || !candidate.bottomCentre) { results.push({ ...base, status: 'unavailable', reasonCode: 'MODEL_LOCATION_MATCH_BOUNDS_UNAVAILABLE' }); continue; }
          const evidence = endpointModelMatchEvidenceSchema.parse({ schemaVersion: 'wfc.pf.model-location-match-evidence.v1',
            operationId: command.idempotencyKey, commandSha256, scanSha256, namesSha256: command.namesSha256, current: snapshot.current,
            logicalKey: normalizeEndpointLocation(name), sdkObjectId: candidate.objectId, objectName: candidate.name,
            bounds: candidate.bounds, bottomCentre: candidate.bottomCentre, matchingPolicyVersion: command.scan.matchingPolicyVersion,
            visibilityScopeSha256: command.scan.visibilityScope.contentSha256, approximate: true, engineeringAccepted: false });
          const receipt = await confirmMatchedEndpointInTransaction(c, projectId, who, {
            locationId: saved?.id ?? randomUUID(), location: saved ? { name: saved.name, aliases: saved.aliases } : { name, aliases: [] },
            current: snapshot.current, expectedRegistryRevision: revision, expectedLocationRevision: saved?.revision ?? null, expectedHeadId: saved?.bindingId ?? null,
            evidence, reason: 'Explicit Find and assign From/To: unique visible model-name match; approximate fixed-world bottom centre.',
          }, signal); check();
          revision = receipt.registryRevision;
          results.push({ ...base, status: 'assigned', locationId: receipt.locationId, bindingId: receipt.binding.id, reasonCode: null });
        }
        const receipt = modelLocationMatchReceiptSchema.parse({ schemaVersion: 'wfc.pf.model-location-match-receipt.v1', projectId,
          idempotencyKey: command.idempotencyKey, commandSha256, registryRevision: revision, results, duplicate: false });
        bound(receipt); check();
        await c.query("/* model-location-match:store */ INSERT INTO pf_endpoint_binding_commands(project_id,actor_id,idempotency_key,kind,request_sha256,request,receipt) VALUES($1,$2,$3,'confirm',$4,$5,$6)",
          [projectId, who.userId, command.idempotencyKey, digest(request), request, receipt]); check();
        return receipt;
      }, signal);
    },
  };
}
export type ModelLocationMatchRepository = ReturnType<typeof createModelLocationMatchRepository>;
