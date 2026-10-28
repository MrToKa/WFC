import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { PREPARATION_LIMITS, type PreparationPlan } from '../../shared/pathfinderPreparation.js';
import { validatePreparationPart } from '../../shared/preparationMerge.js';
import { parseOwnedPreparationSnapshot } from './preparationUnionTask.js';
import { PathFinderError } from './errors.js';
import { validateSnapshotStructure, objectMatchNames } from './matching.js';
import type { EngineExecutor } from './engineSession.js';
import type { PreparationAdapters, PreparationValidation } from './preparationSessions.js';
import { readPreparationBlob } from './preparationStorage.js';
import { readSnapshot } from './storage.js';
import { runPreparationUnion } from './preparationUnionWorker.js';
import { bumpRegistry } from './repository.js';
import { routingScopeSchema } from './routingScope.js';

const count = z.number().int().nonnegative().max(1_000_000);
export const preparedUnionResponseSchema = z.object({
  schemaVersion: z.literal('pathfinder.model.response.v1'), requestId: policyUuidSchema,
  status: z.literal('prepared'), message: z.string().max(32768), engineeringAccepted: z.literal(false),
  model: z.object({ projectId: policyUuidSchema, modelVersionId: policyUuidSchema,
    contentSha256: policyHashSchema, sourceContentSha256: policyHashSchema.nullable().optional() }).strict(),
  prepared: z.object({ key: policyHashSchema,
    readiness: z.enum(['needs_review', 'fitted_geometry_ready_native_parity_not_asserted']),
    counts: z.object({ validatedBends: count, fallbackBends: count, validatedStraights: count,
      fallbackStraights: count, fallbackClearances: count }).strict(),
    cacheScope: z.literal('fitted-centerlines-ports-and-canonical-mesh;surface-bvh-reconstructed-on-disk-load;graph-per-calculation'),
    loadedFromDisk: z.boolean(), objectCount: count, segmentCount: count,
    diagnosticCount: count, diagnostics: z.array(z.string().max(2048)).max(2048),
    diagnosticsTruncated: z.boolean(), engineeringAccepted: z.literal(false),
  }).strict(),
}).strict();
const publicationSchema = z.object({ snapshotId: policyUuidSchema,
  sha256: policyHashSchema, bytes: z.number().int().positive().max(PREPARATION_LIMITS.unionBytes) }).strict();
const refuse = (code: string): never => { throw new PathFinderError(code, 409); };

async function verifiedPublicationSnapshot(plan: PreparationPlan, validation: PreparationValidation, owned: z.infer<typeof publicationSchema>) {
  // Authenticate every immutable representation, but do not retain three full
  // buffers or a second full Zod graph across the publication transaction.
  const bytes = await (async () => {
    await readPreparationBlob(plan.projectId, plan.id, validation.traceIndex, PREPARATION_LIMITS.unionBytes);
    const cache = await readSnapshot(owned.snapshotId, owned.sha256);
    const projection = await readPreparationBlob(plan.projectId, plan.id, validation.projection, PREPARATION_LIMITS.unionBytes);
    if (!cache.equals(projection)) return refuse('PREPARATION_PROJECTION_INTEGRITY');
    return cache;
  })();
  return parseOwnedPreparationSnapshot(JSON.parse(bytes.toString('utf8')));
}

/** Only server-owned immutable references cross the validation/publication boundary. */
export function createPreparationPublisher(execute: EngineExecutor['execute']): PreparationAdapters {
  return {
    validatePart: validatePreparationPart,
    async validateUnion(plan, parts, signal) {
      signal.throwIfAborted();
      const union = await runPreparationUnion(plan, parts, signal);
      const {snapshotId,projection,traceIndex,counts} = union;
      signal.throwIfAborted();
      const requestId = randomUUID();
      const response = preparedUnionResponseSchema.parse(await execute({
        schemaVersion: 'pathfinder.model.runner.v1', requestId, operation: 'prepare',
        projectId: plan.projectId, modelVersionId: plan.modelVersionId,
        snapshotId, snapshotSha256: projection.sha256, timeoutMilliseconds: 120000,
      }, signal));
      signal.throwIfAborted();
      validatePreparedUnionResponse(plan, response, requestId, counts.objects, counts.physicalLeaves);
      return {
        projection, traceIndex,
        counts, engineVersion: 'pathfinder-45c24bf5-pf1-modelrunner-v1',
        rulesVersion: 'pf2.rules.v1/wfc-mto-v1', diagnostics: response.prepared.diagnostics,
        publicationData: { snapshotId, sha256:projection.sha256,bytes:projection.bytes },
      };
    },
    async publish(client, { plan, validation, principal }) {
      const owned = publicationSchema.parse(validation.publicationData);
      if (owned.snapshotId !== validation.projection.payloadRef || owned.sha256 !== validation.projection.sha256
        || owned.bytes !== validation.projection.bytes) return refuse('PREPARATION_PROJECTION_INTEGRITY');
      const snapshot = await verifiedPublicationSnapshot(plan,validation,owned);
      if (snapshot.model.projectId !== plan.projectId || snapshot.model.modelVersionId !== plan.modelVersionId
        || snapshot.model.contentSha256 !== plan.contentFingerprint || snapshot.objects.length !== validation.counts.objects)
        return refuse('PREPARATION_PROJECTION_INTEGRITY');
      const visibility = validateSnapshotStructure(snapshot), id = owned.snapshotId;
      await client.query(`INSERT INTO pf_artifacts(id,project_id,model_version_id,content_fingerprint,snapshot_sha256,snapshot_bytes,capture,coordinates,object_count,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, plan.projectId, plan.modelVersionId,
        plan.contentFingerprint, owned.sha256, owned.bytes, snapshot.capture, snapshot.coordinates, snapshot.objects.length, principal.userId]);
      for (let start = 0; start < snapshot.objects.length; start += 1000) {
        const chunk = snapshot.objects.slice(start, start + 1000).map(object => ({
          object_id: object.id, external_id: object.externalId ?? null, db_id: object.dbId ?? null, name: object.name,
          geometry_role: object.geometryRole, anchor: [(object.bounds.minimum[0] + object.bounds.maximum[0]) / 2,
            (object.bounds.minimum[1] + object.bounds.maximum[1]) / 2, object.bounds.minimum[2]],
          visibility: visibility.get(object.id), match_names: objectMatchNames(object),
        }));
        if (chunk.some(object => object.anchor.some(value => !Number.isFinite(value)))) return refuse('NON_FINITE_ANCHOR');
        await client.query(`INSERT INTO pf_model_objects(project_id,artifact_id,object_id,external_id,db_id,name,geometry_role,anchor,visibility,match_names)
          SELECT $1,$2,x.object_id,x.external_id,x.db_id,x.name,x.geometry_role,x.anchor,x.visibility,x.match_names
          FROM jsonb_to_recordset($3::jsonb) AS x(object_id text,external_id text,db_id int,name text,geometry_role text,anchor jsonb,visibility text,match_names jsonb)`,
        [plan.projectId, id, JSON.stringify(chunk)]);
      }
      const routing = routingScopeSchema.parse({ catalogRevision: plan.catalogRevision,
        routingContentSha256: plan.routingContentSha256, routingPolicyRevision: plan.routingPolicyRevision,
        routingPolicySha256: plan.routingPolicySha256 });
      await client.query(`INSERT INTO pf_artifact_routing_scopes(project_id,artifact_id,producer_version,routing_scope)
        VALUES($1,$2,'pathfinder.catalog-preparation.v1',$3)`, [plan.projectId, id, routing]);
      return { artifactId: id, registryRevision: await bumpRegistry(client, plan.projectId) };
    },
  };
}

export function validatePreparedUnionResponse(plan: Pick<PreparationPlan,'projectId'|'modelVersionId'|'contentFingerprint'>, response: z.infer<typeof preparedUnionResponseSchema>, requestId: string, objects: number, leaves: number): void {
  const prepared = response.prepared;
  if (response.requestId !== requestId || response.model.projectId !== plan.projectId
    || response.model.modelVersionId !== plan.modelVersionId || response.model.contentSha256 !== plan.contentFingerprint
    || prepared.objectCount !== objects || prepared.segmentCount !== leaves || leaves < 1
    || prepared.diagnostics.length !== Math.min(prepared.diagnosticCount, 2048)
    || prepared.diagnosticsTruncated !== (prepared.diagnosticCount > 2048)) return refuse('PREPARATION_ENGINE_INCOMPLETE');
}
