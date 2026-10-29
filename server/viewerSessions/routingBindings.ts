import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { preparationAggregateSchema, preparationPlanSchema, preparationPlanHashInput, preparationResolutionSchema, PREPARATION_LIMITS } from '../../shared/pathfinderPreparation.js';
import { canonicalPurposeJson, catalogRoutingHashInput, normalizeCatalogKey, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { normalizeRoutingKey } from '../../viewer-runtime/protocol.mjs';
import { projectRoutingCatalogRows } from '../pathfinder/catalog.js';
import { ViewerSessionError } from './errors.js';

export const ROUTING_BINDING_LIMITS = Object.freeze({ mappings: 128, roots: 512, bytes: 28 * 1024 });
export type ViewerRoutingBindings = {
  schemaVersion: 'wfc.viewer.routing-bindings.v1'; modelVersionId: string; contentFingerprint: string;
  selectionRevision: string; aggregateId: string | null; bindings: Array<{ routeName: string; rootObjectIds: string[] }>;
};
type Row = Record<string, any>;
const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const corrupt = (): never => { throw new ViewerSessionError('ROUTING_BINDINGS_INVALID', 409); };
const limit = (): never => { throw new ViewerSessionError('ROUTING_BINDINGS_LIMIT', 413); };
const same = (left: unknown, right: unknown) => canonicalPurposeJson(left) === canonicalPurposeJson(right);

/** Ordinary model-view projection only. This reader never initializes PF state,
 * mutates a resolution, or exposes administrator planning/engineering records.
 * The caller owns fresh viewer-session authorization before and after the read.
 */
export async function readViewerRoutingBindings(client: PoolClient, input: { projectId: string; modelVersionId: string; contentFingerprint: string }): Promise<ViewerRoutingBindings> {
  const row = (await client.query<Row>(`/* viewer-routing-bindings:publication */ SELECT
    sel.active_model_version_id,sel.selection_revision::text,ver.content_fingerprint,
    p.current_aggregate_id,p.current_artifact_id,p.geometry_revision::text,p.resolution_revision::text,
    policy.catalog_revision::text,policy.routing_policy_revision::text,
    a.id AS aggregate_id,a.project_id AS aggregate_project_id,a.model_version_id AS aggregate_model_id,
    a.session_id,a.artifact_id,a.geometry_revision::text AS aggregate_geometry_revision,
    CASE WHEN octet_length(a.manifest::text)<=1048576 THEN a.manifest END AS manifest,
    octet_length(a.manifest::text)>1048576 AS manifest_oversize,
    s.state AS session_state,s.published_aggregate_id,
    CASE WHEN octet_length(s.plan::text)<=16777216 THEN s.plan END AS plan,
    octet_length(s.plan::text)>16777216 AS plan_oversize,
    f.model_version_id AS artifact_model_id,f.snapshot_sha256,f.snapshot_bytes::text,
    r.producer_version,r.routing_scope,
    EXISTS(SELECT 1 FROM pf_preparation_commands command WHERE command.project_id=a.project_id
      AND command.kind='publish' AND command.receipt->>'sessionId'=a.session_id::text
      AND command.receipt->'aggregate'=a.manifest) AS publication_proof
    FROM project_model_selections sel JOIN model_versions ver ON ver.project_id=sel.project_id AND ver.id=sel.active_model_version_id
    LEFT JOIN pf_project_preparations p ON p.project_id=sel.project_id
    LEFT JOIN pf_purpose_project_state policy ON policy.project_id=sel.project_id
    LEFT JOIN pf_preparation_aggregates a ON a.project_id=p.project_id AND a.id=p.current_aggregate_id
    LEFT JOIN pf_preparation_sessions s ON s.project_id=a.project_id AND s.id=a.session_id
    LEFT JOIN pf_artifacts f ON f.project_id=a.project_id AND f.id=a.artifact_id
    LEFT JOIN pf_artifact_routing_scopes r ON r.project_id=a.project_id AND r.artifact_id=a.artifact_id
    WHERE sel.project_id=$1`, [input.projectId])).rows[0];
  if (!row || row.active_model_version_id !== input.modelVersionId || row.content_fingerprint !== input.contentFingerprint)
    throw new ViewerSessionError('MODEL_SELECTION_CHANGED', 409);
  const parsedRevision = policyRevisionSchema.safeParse(row.selection_revision);
  if (!parsedRevision.success) return corrupt();
  const empty = (): ViewerRoutingBindings => ({ schemaVersion: 'wfc.viewer.routing-bindings.v1', modelVersionId: input.modelVersionId,
    contentFingerprint: input.contentFingerprint, selectionRevision: parsedRevision.data, aggregateId: null, bindings: [] });
  if (row.current_aggregate_id === null || row.current_aggregate_id === undefined) return empty();
  if (row.plan_oversize || row.manifest_oversize) return limit();
  const parsedAggregate = preparationAggregateSchema.safeParse(row.manifest), parsedPlan = preparationPlanSchema.safeParse(row.plan);
  if (!parsedAggregate.success || !parsedPlan.success) return corrupt();
  const aggregate = parsedAggregate.data, plan = parsedPlan.data;
  if (aggregate.modelVersionId !== input.modelVersionId || aggregate.contentFingerprint !== input.contentFingerprint ||
      aggregate.selectionRevision !== parsedRevision.data || plan.catalogRevision !== row.catalog_revision ||
      plan.routingPolicyRevision !== row.routing_policy_revision || plan.resolutionRevision !== row.resolution_revision) return empty();
  if (row.session_state !== 'published' || !row.publication_proof || row.aggregate_id !== aggregate.id || row.current_aggregate_id !== aggregate.id ||
      row.published_aggregate_id !== aggregate.id || row.aggregate_project_id !== input.projectId || aggregate.projectId !== input.projectId ||
      plan.projectId !== input.projectId || row.aggregate_model_id !== input.modelVersionId || row.artifact_model_id !== input.modelVersionId ||
      row.current_artifact_id !== aggregate.artifactId || row.artifact_id !== aggregate.artifactId || row.session_id !== aggregate.sessionId ||
      plan.id !== aggregate.sessionId || row.geometry_revision !== aggregate.geometryRevision || row.aggregate_geometry_revision !== aggregate.geometryRevision ||
      row.snapshot_sha256 !== aggregate.projection.sha256 || row.snapshot_bytes !== String(aggregate.projection.bytes) ||
      aggregate.projection.payloadRef !== aggregate.artifactId || plan.diagnostics.length || plan.partPlan.length === 0 ||
      plan.orderedPlanSha256 !== digest(preparationPlanHashInput(plan)) || aggregate.orderedPlanSha256 !== plan.orderedPlanSha256 ||
      aggregate.orderedScopeSha256 !== plan.requestedScope.scopeSha256) return corrupt();
  const { scopeSha256: _scopeHash, ...scope } = plan.requestedScope;
  if (digest(scope) !== plan.requestedScope.scopeSha256) return corrupt();
  for (const key of ['modelVersionId', 'contentFingerprint', 'selectionRevision', 'catalogRevision', 'routingContentSha256', 'routingPolicyRevision', 'routingPolicySha256', 'resolutionRevision'] as const)
    if (aggregate[key] !== plan[key]) return corrupt();
  const expectedRoutingScope = { catalogRevision: plan.catalogRevision, routingContentSha256: plan.routingContentSha256,
    routingPolicyRevision: plan.routingPolicyRevision, routingPolicySha256: plan.routingPolicySha256 };
  if (row.producer_version !== 'pathfinder.catalog-preparation.v1' || !same(row.routing_scope, expectedRoutingScope)) return corrupt();

  const source = (await client.query<{ id: string; name: string; purpose: string | null }>(
    '/* viewer-routing-bindings:catalog */ SELECT id::text,name,purpose FROM trays WHERE project_id=$1 ORDER BY id LIMIT 100001', [input.projectId])).rows;
  const catalog = projectRoutingCatalogRows(source);
  if (digest(catalogRoutingHashInput(input.projectId, catalog.rows, catalog.diagnostics)) !== plan.routingContentSha256) return empty();
  const currentTrays = new Map(catalog.rows.map(tray => [tray.projectTrayId, tray]));
  const manifest = new Map(plan.objectManifest.map(object => [object.objectId, object]));
  const allRoots = new Map<string, string>(), keys = new Set<string>(), explicit = plan.requestedScope.trays.filter(tray => tray.ownershipDecisionId !== null);
  if (explicit.length > ROUTING_BINDING_LIMITS.mappings || explicit.reduce((count, tray) => count + tray.orderedRootObjectIds.length, 0) > ROUTING_BINDING_LIMITS.roots) return limit();
  const bindings: ViewerRoutingBindings['bindings'] = []; let roots = 0;
  for (const tray of plan.requestedScope.trays) {
    const current = currentTrays.get(tray.projectTrayId);
    let key: string; try { key = normalizeRoutingKey(tray.routeName); } catch { return corrupt(); }
    if (!current || current.rawName !== tray.rawName || current.purposeKey !== tray.purposeKey || keys.has(key) || !tray.orderedRootObjectIds.length ||
      tray.routeName !== '/' + normalizeCatalogKey(current.rawName).replace(/^\/+|\/+$/g, '').trim().toUpperCase()) return corrupt();
    keys.add(key);
    for (const root of tray.orderedRootObjectIds) {
      const object = manifest.get(root);
      if (!object || object.parentId === null || allRoots.has(root)) return corrupt();
      allRoots.set(root, tray.projectTrayId);
    }
    if (tray.ownershipDecisionId !== null) {
      roots += tray.orderedRootObjectIds.length; if (roots > ROUTING_BINDING_LIMITS.roots) return limit();
      bindings.push({ routeName: tray.routeName, rootObjectIds: [...tray.orderedRootObjectIds] });
    }
  }
  // Ancestor-related roots would draw another route's geometry or duplicate a
  // logical tray. The immutable planner also fences physical leaf ownership.
  for (const root of allRoots.keys()) {
    let parent = manifest.get(root)!.parentId; const seen = new Set([root]);
    while (parent !== null) {
      if (seen.has(parent) || seen.size >= 512 || !manifest.has(parent) || allRoots.has(parent)) return corrupt();
      seen.add(parent); parent = manifest.get(parent)!.parentId;
    }
  }
  const owners = new Map<string, string>(), usedRoots = new Set<string>(), byTray = new Map(plan.requestedScope.trays.map(tray => [tray.projectTrayId, tray]));
  for (const part of plan.partPlan) for (const object of part.objects) {
    const id = 'dbid:' + object.objectId, root = 'dbid:' + object.rootObjectId, tray = byTray.get(object.projectTrayId), leaf = manifest.get(id);
    if (owners.has(id) || !leaf?.isPhysicalLeaf || !leaf.hasGeometry || !tray || !tray.orderedRootObjectIds.includes(root) || object.routeName !== tray.routeName) return corrupt();
    const seen = new Set<string>(); let parent: string | null = id;
    while (parent !== root) { if (parent === null || seen.has(parent) || seen.size >= 512 || !manifest.has(parent)) return corrupt(); seen.add(parent); parent = manifest.get(parent)!.parentId; }
    owners.set(id, tray.projectTrayId); usedRoots.add(root);
  }
  if (owners.size !== plan.requestedScope.orderedPhysicalLeafIds.length || owners.size !== aggregate.counts.physicalLeaves ||
      plan.requestedScope.orderedPhysicalLeafIds.some(id => !owners.has(id)) || [...allRoots.keys()].some(root => !usedRoots.has(root))) return corrupt();
  const parts = (await client.query<Row>(`/* viewer-routing-bindings:parts */ SELECT part_id,part_index,
    receipt->>'sessionPlanSha256' AS plan_sha256,receipt->>'payloadSha256' AS payload_sha256
    FROM pf_preparation_parts WHERE project_id=$1 AND session_id=$2 ORDER BY part_index LIMIT 4097`, [input.projectId, plan.id])).rows;
  if (parts.length !== plan.partPlan.length || parts.length !== aggregate.partReferences.length || parts.length > PREPARATION_LIMITS.parts ||
    parts.some((part, index) => part.part_id !== plan.partPlan[index].partId || part.part_index !== index || part.plan_sha256 !== plan.orderedPlanSha256 ||
      part.part_id !== aggregate.partReferences[index].partId || part.part_index !== aggregate.partReferences[index].partIndex || part.payload_sha256 !== aggregate.partReferences[index].payloadSha256)) return corrupt();
  if (explicit.length) {
    const decisions = (await client.query<{ resolution: unknown }>(`/* viewer-routing-bindings:decisions */ SELECT after_value AS resolution
      FROM pf_preparation_resolution_events WHERE project_id=$1 AND after_value->>'id'=ANY($2::text[]) LIMIT 129`, [input.projectId, explicit.map(tray => tray.ownershipDecisionId!)])).rows;
    if (decisions.length !== explicit.length) return corrupt();
    const ids = new Set<string>();
    for (const value of decisions) {
      const parsed = preparationResolutionSchema.safeParse(value.resolution); if (!parsed.success) return corrupt();
      const decision = parsed.data, tray = explicit.find(item => item.ownershipDecisionId === decision.id);
      if (!tray || ids.has(decision.id) || decision.mode !== 'roots' || decision.projectTrayId !== tray.projectTrayId || !same(decision.rootObjectIds, tray.orderedRootObjectIds)) return corrupt();
      ids.add(decision.id);
      for (const key of ['modelVersionId', 'contentFingerprint', 'selectionRevision', 'catalogRevision', 'routingContentSha256', 'routingPolicyRevision', 'routingPolicySha256', 'locationRegistryRevision'] as const)
        if (decision.scope[key] !== plan[key]) return corrupt();
    }
  }
  // Take only state latches, after reading row data, in the publisher's order.
  // No tray row locks are acquired after these latches, avoiding trigger cycles.
  const policy = (await client.query<Row>('/* viewer-routing-bindings:policy-fence */ SELECT catalog_revision::text,routing_policy_revision::text FROM pf_purpose_project_state WHERE project_id=$1 FOR SHARE', [input.projectId])).rows[0];
  const preparation = (await client.query<Row>('/* viewer-routing-bindings:preparation-fence */ SELECT current_aggregate_id,current_artifact_id,geometry_revision::text,resolution_revision::text FROM pf_project_preparations WHERE project_id=$1 FOR SHARE', [input.projectId])).rows[0];
  if (!policy || !preparation || policy.catalog_revision !== row.catalog_revision || policy.routing_policy_revision !== row.routing_policy_revision ||
      preparation.current_aggregate_id !== aggregate.id || preparation.current_artifact_id !== aggregate.artifactId || preparation.geometry_revision !== aggregate.geometryRevision || preparation.resolution_revision !== plan.resolutionRevision) return empty();
  const result: ViewerRoutingBindings = { ...empty(), aggregateId: aggregate.id, bindings };
  if (Buffer.byteLength(JSON.stringify(result)) > ROUTING_BINDING_LIMITS.bytes) return limit();
  return result;
}
