import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { requirePreparedRoutingScope } from './routingScope.js';
import { cadOverlayPayloadSchema } from '../../shared/pathfinderCadOverlay.js';
import { GEOMETRY_TRACE_DERIVATION, geometryTraceManifestSchema } from '../../shared/pathfinderGeometryTrace.js';
import { cadDesignEnabled } from '../cadDesign/configuration.js';
import { canonicalPurposeJson, normalizeCatalogKey, routingCatalogDiagnostics, PURPOSE_POLICY_LIMITS } from '../../shared/pathfinderPurposePolicy.js';
import { PREPARATION_LIMITS, preparationContextSchema, preparationPlanSchema, preparationPlanHashInput, preparationPartScopeHashInput, preparationResolutionMatchesScope, preparationResolutionSchema, type PreparationContext, type PreparationCreate, type PreparationPlan, preparationAggregateSchema, type PreparationScope } from '../../shared/pathfinderPreparation.js';
import { readRoutingCatalog } from './catalog.js';
import { readRoutingPolicyScope } from './purposePolicy.js';
import { PathFinderError } from './errors.js';
import { LEGACY_PREPARATION_CAPACITY_PROFILE, preparationCapacityProfileSchema, type PreparationCapacityProfile } from '../../shared/pathfinderCapacity.js';
import { loadTrayAssignmentCarryover } from './trayAssignmentCarryover.js';

export const preparationDigest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'The project preparation changed or requires a routing decision. Refresh and try again.'); };
const scopeKeys = ['modelVersionId', 'contentFingerprint', 'selectionRevision', 'catalogRevision', 'routingContentSha256', 'routingPolicyRevision', 'routingPolicySha256', 'locationRegistryRevision', 'resolutionRevision'] as const;
function presentationType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/u.test(trimmed)
    && [...trimmed].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff) ? trimmed : null;
}
function presentationMillimetres(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && (value.length > 100 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$(?![\s\S])/.test(value))) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}
export const equalPreparationScope = (a: PreparationScope, b: PreparationScope, { ignoreResolution = false } = {}) => scopeKeys.every(key => ignoreResolution && key === 'resolutionRevision' || a[key] === b[key]);
export const toDbId = (value: string) => Number(value.slice(5));
export function preparationFrameId(projectId: string, modelId: string, fingerprint: string): string {
  const hex = preparationDigest({ schemaVersion: 'wfc.pf.canonical-frame-identity.v1', projectId, modelId, fingerprint });
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function readPreparationState(c: PoolClient, projectId: string, options:{lock?:boolean}={}) {
  const lock=options.lock??true;
  if(lock)await c.query('INSERT INTO pf_project_preparations(project_id) VALUES($1) ON CONFLICT(project_id) DO NOTHING', [projectId]);
  return (await c.query<{ geometry_revision: string; resolution_revision: string; current_aggregate_id: string | null; current_artifact_id: string | null }>(`SELECT geometry_revision::text,resolution_revision::text,current_aggregate_id,current_artifact_id FROM pf_project_preparations WHERE project_id=$1${lock?' FOR UPDATE':''}`, [projectId])).rows[0]??{geometry_revision:'0',resolution_revision:'0',current_aggregate_id:null,current_artifact_id:null};
}
/** Snapshot callers must use REPEATABLE READ; writers retain their existing row fences. */
export async function readPreparationContext(c: PoolClient, projectId: string, options:{snapshot?:boolean}={}): Promise<PreparationContext> {
  const lock=!options.snapshot;
  const model = (await c.query<{ active_model_version_id: string | null; selection_revision: string; content_fingerprint: string | null; state: string; health: string }>(`SELECT s.active_model_version_id,s.selection_revision::text,v.content_fingerprint,v.state,v.health FROM project_model_selections s LEFT JOIN model_versions v ON v.id=s.active_model_version_id AND v.project_id=s.project_id WHERE s.project_id=$1${lock?' FOR SHARE OF s':''}`, [projectId])).rows[0];
  if (!model?.active_model_version_id || model.state !== 'ready' || model.health !== 'healthy' || !model.content_fingerprint) return fail('MODEL_UNAVAILABLE');
  const currentModel = (await c.query<{ state: string; health: string; content_fingerprint: string }>(`SELECT state,health,content_fingerprint FROM model_versions WHERE project_id=$1 AND id=$2${lock?' FOR SHARE':''}`, [projectId, model.active_model_version_id])).rows[0];
  if (!currentModel || currentModel.state !== 'ready' || currentModel.health !== 'healthy' || currentModel.content_fingerprint !== model.content_fingerprint) return fail('MODEL_UNAVAILABLE');
  const catalog = await readRoutingCatalog(c, projectId,{lock}), routing = await readRoutingPolicyScope(c, projectId,{lock});
  // Current display facts are intentionally separate from the routing catalog's
  // null dimension placeholders, immutable plans and drawing proof budgets.
  const detailRows = (await c.query<{ id: string; tray_type: unknown; width_mm: unknown; height_mm: unknown; cad_geometry?:boolean; cad_published?:boolean; cad_route_group_id?:string|null }>(
    cadDesignEnabled()?`/* preparation-tray-details */ SELECT t.id::text,t.tray_type,t.width_mm::text,t.height_mm::text,
      EXISTS(SELECT 1 FROM cad_route_tray_exports e JOIN cad_designs d ON d.project_id=e.project_id AND d.id=e.design_id
        JOIN cad_route_groups g ON g.project_id=e.project_id AND g.design_id=e.design_id AND g.id=e.route_group_id
        WHERE e.project_id=t.project_id AND e.tray_id=t.id AND d.model_version_id=$2 AND d.status='proposed') AS cad_geometry,
      EXISTS(SELECT 1 FROM cad_route_groups g JOIN cad_designs d ON d.project_id=g.project_id AND d.id=g.design_id
        WHERE g.project_id=t.project_id AND g.project_tray_id=t.id AND g.status='published'
          AND d.model_version_id=$2 AND d.status='proposed') AS cad_published,
      COALESCE((SELECT g.id::text FROM cad_route_groups g JOIN cad_designs d ON d.project_id=g.project_id AND d.id=g.design_id
        WHERE g.project_id=t.project_id AND g.project_tray_id=t.id AND g.status='published' AND d.model_version_id=$2 AND d.status='proposed' ORDER BY g.id LIMIT 1),
        (SELECT e.route_group_id::text FROM cad_route_tray_exports e JOIN cad_designs d ON d.project_id=e.project_id AND d.id=e.design_id
        WHERE e.project_id=t.project_id AND e.tray_id=t.id AND d.model_version_id=$2 AND d.status='proposed' ORDER BY e.route_group_id LIMIT 1)) AS cad_route_group_id
      FROM trays t WHERE t.project_id=$1 ORDER BY t.id LIMIT 100001`:
      '/* preparation-tray-details */ SELECT id::text,tray_type,width_mm::text,height_mm::text FROM trays WHERE project_id=$1 ORDER BY id LIMIT 100001',
      cadDesignEnabled()?[projectId,model.active_model_version_id]:[projectId])).rows;
  if (detailRows.length > PURPOSE_POLICY_LIMITS.catalogRows) return fail('PREPARATION_TRAY_DETAILS_LIMIT', 413);
  const detailsById = new Map(detailRows.map(row => [row.id, { type: presentationType(row.tray_type),
    widthMm: presentationMillimetres(row.width_mm), heightMm: presentationMillimetres(row.height_mm) }]));
  const publishedCadTrayIds = new Set(detailRows.filter(row => row.cad_published === true).map(row => row.id));
  const cadGroupsByTrayId = new Map(detailRows.map(row => [row.id, row.cad_route_group_id]));
  const cadTrayIds=new Set(detailRows.filter(row=>row.cad_geometry===true).map(row=>row.id));
  const state = await readPreparationState(c, projectId,{lock});
  const registry = (await c.query<{ revision: string }>(`SELECT registry_revision::text AS revision FROM pf_project_state WHERE project_id=$1${lock?' FOR UPDATE':''}`, [projectId])).rows[0];
  if (!registry) return fail('PREPARATION_REGISTRY_REQUIRED');
  const scope: PreparationScope = { modelVersionId: model.active_model_version_id, contentFingerprint: model.content_fingerprint, selectionRevision: model.selection_revision, ...routing, locationRegistryRevision: registry.revision, resolutionRevision: state.resolution_revision };
  const rules = (await c.query<{ purpose_key: string; allowed_categories: unknown }>(`SELECT r.purpose_key,r.allowed_categories FROM pf_routing_purpose_rules r JOIN pf_catalog_purpose_incarnations i ON i.project_id=r.project_id AND i.purpose_key=r.purpose_key AND i.incarnation_id=r.purpose_incarnation_id WHERE r.project_id=$1 AND i.active AND i.row_count>0 ORDER BY r.purpose_key COLLATE "C"`, [projectId])).rows;
  const blocked = new Map<string, string[]>();
  for (const diagnostic of routingCatalogDiagnostics(catalog.diagnostics)) for (const id of diagnostic.projectTrayIds) blocked.set(id, [...(blocked.get(id) ?? []), diagnostic.code]);
  const codeNames = new Map<string, string[]>();
  const trays = catalog.rows.map(row => {
    const routeName = '/' + normalizeCatalogKey(row.rawName).replace(/^\/+|\/+$/g, '').trim().toUpperCase();
    const codes = [...(blocked.get(row.projectTrayId) ?? [])];
    if (row.rawName.length > 256 || !/^\/[A-Z0-9][A-Z0-9_.-]*$/.exec(routeName)?.[0] || /^\/[A-Z0-9][A-Z0-9_.-]*$/.exec(routeName)?.[0] !== routeName || routeName === '/SECONDARY') codes.push('UNSUPPORTED_ROUTE_CODE');
    codeNames.set(routeName, [...(codeNames.get(routeName) ?? []), row.projectTrayId]);
    const rule = rules.find(r => r.purpose_key === row.purposeKey);
    // Purpose permissions are enforced per calculation. Capture each usable tray
    // once with engine classes; one shared network serves independent purposes.
    const allowedCategories: Array<'MV' | 'LV' | 'Control'> | undefined = rule
      ? Array.isArray(rule.allowed_categories) && rule.allowed_categories.length ? ['MV', 'LV', 'Control'] : [] : undefined;
    return { projectTrayId: row.projectTrayId, rawName: row.rawName, purposeKey: row.purposeKey, routeName, allowedCategories: allowedCategories ?? [], policyState: codes.length ? 'invalid' as const : !rule ? 'unconfigured' as const : allowedCategories?.length ? 'configured' as const : 'excluded' as const, diagnosticCodes: codes,
      ...(cadGroupsByTrayId.get(row.projectTrayId) ? {cadRouteGroupId: cadGroupsByTrayId.get(row.projectTrayId)!} : {}),
      details: detailsById.get(row.projectTrayId) ?? { type: null, widthMm: null, heightMm: null },
      ...(publishedCadTrayIds.has(row.projectTrayId) ? { geometrySource: 'published-cad-route' as const }
        : cadTrayIds.has(row.projectTrayId) ? { geometrySource: 'saved-cad-route' as const } : {}) };
  });
  for (const ids of codeNames.values()) if (ids.length > 1) for (const tray of trays) if (ids.includes(tray.projectTrayId)) { tray.diagnosticCodes.push('ROUTE_CODE_COLLISION'); tray.policyState = 'invalid'; }
  const endpointRows = (await c.query<{ name: string }>(`SELECT DISTINCT value COLLATE "C" AS name FROM cables c CROSS JOIN LATERAL(VALUES(c.from_location),(c.to_location)) e(value) WHERE c.project_id=$1 AND value IS NOT NULL AND btrim(value)<>'' ORDER BY name LIMIT 4097`, [projectId])).rows;
  if (endpointRows.length >= 4097) return fail('PREPARATION_ENDPOINT_LIMIT', 413);
  const endpoints = endpointRows.map(r => r.name.normalize('NFC').trim());
  const endpointNames = [...new Set(endpoints)]; if (endpointNames.length > 4096) return fail('PREPARATION_ENDPOINT_LIMIT', 413);
  const resolutions = (await c.query<{ resolution: unknown }>('SELECT resolution FROM pf_preparation_resolutions WHERE project_id=$1 ORDER BY project_tray_id', [projectId])).rows.map(r => preparationResolutionSchema.parse(r.resolution));
  const trayAssignmentCarryover = await loadTrayAssignmentCarryover(c, projectId, scope, resolutions);
  const aggregate = state.current_aggregate_id ? (await c.query<{ manifest: unknown }>('SELECT manifest FROM pf_preparation_aggregates WHERE project_id=$1 AND id=$2', [projectId, state.current_aggregate_id])).rows[0]?.manifest ?? null : null;
  const currentAggregate=aggregate===null?null:preparationAggregateSchema.parse(aggregate);
  const networkTrayIds = await readPreparationNetworkTrayIds(c, projectId, scope, currentAggregate, lock);
  for (const tray of trays) Object.assign(tray, {inNetwork: networkTrayIds.has(tray.projectTrayId)});
  return preparationContextSchema.parse({ schemaVersion: currentAggregate?.schemaVersion==='wfc.pf.geometry-aggregate.v2'?'wfc.pf.preparation-context.v2':'wfc.pf.preparation-context.v1', projectId, scope, trays, endpointNames, resolutions, diagnostics: catalog.diagnostics, currentAggregate,
    ...(trayAssignmentCarryover.length ? { trayAssignmentCarryover } : {}) });
}

/** Membership follows fitted base geometry and the validated additive CAD overlay. */
export async function readPreparationNetworkTrayIds(c: PoolClient, projectId: string, scope: PreparationScope,
  aggregate: PreparationContext['currentAggregate'], lock: boolean): Promise<Set<string>> {
  const result = new Set<string>();
  if (!aggregate || aggregate.projectId !== projectId || aggregate.modelVersionId !== scope.modelVersionId
    || aggregate.contentFingerprint !== scope.contentFingerprint || aggregate.selectionRevision !== scope.selectionRevision
    || aggregate.resolutionRevision !== scope.resolutionRevision) return result;
  let routing;
  try { routing = await requirePreparedRoutingScope(c, projectId, aggregate.artifactId, {lock}); }
  catch (error) {
    if (error instanceof PathFinderError && ['ROUTING_PREPARATION_REQUIRED', 'CAD_ROUTE_CATALOG_CHANGED', 'CAD_ROUTE_BASE_CHANGED', 'PREPARATION_CURRENT_INTEGRITY'].includes(error.code)) return result;
    throw error;
  }
  const traceRow = (await c.query<{id:string;manifest:unknown}>(`/* preparation-network-trace */ SELECT id,manifest FROM pf_geometry_trace_sets
    WHERE project_id=$1 AND aggregate_id=$2 AND derivation_version=$3 ORDER BY created_at DESC,id DESC LIMIT 1`,
    [projectId, aggregate.id, GEOMETRY_TRACE_DERIVATION])).rows[0];
  if (!traceRow) return result;
  const trace = geometryTraceManifestSchema.parse(traceRow.manifest);
  if (trace.id !== traceRow.id || trace.projectId !== projectId || trace.aggregateId !== aggregate.id || trace.modelVersionId !== aggregate.modelVersionId
    || trace.derivationVersion !== GEOMETRY_TRACE_DERIVATION || trace.counts.objects !== aggregate.counts.objects
    || trace.counts.segments !== aggregate.counts.physicalLeaves
    || trace.sessionId !== aggregate.sessionId || trace.geometryRevision !== aggregate.geometryRevision
    || trace.projection.sha256 !== aggregate.projection.sha256 || trace.projection.payloadRef !== aggregate.projection.payloadRef
    || trace.projection.bytes !== aggregate.projection.bytes || trace.captureFrameId !== aggregate.coordinateFrameId) return result;
  const members = (await c.query<{project_tray_id:string}>(`/* preparation-network-members */ SELECT DISTINCT project_tray_id::text FROM pf_geometry_object_revisions
    WHERE project_id=$1 AND trace_id=$2 AND project_tray_id IS NOT NULL AND record->'geometry'->>'role'='routing-leaf'
      AND record->'geometry'->'fitted' IS NOT NULL AND record->'geometry'->'fitted'<>'null'::jsonb`, [projectId, traceRow.id])).rows;
  for (const member of members) result.add(member.project_tray_id);
  if (routing.cadOverlay) {
    const payload = cadOverlayPayloadSchema.parse(JSON.parse(Buffer.from(routing.cadOverlay.payloadBase64, 'base64').toString('utf8')));
    const groupIds = payload.segments.map(segment => segment.id.replace(/^cad:/, ''));
    const groups = (await c.query<{project_tray_id:string}>(`/* preparation-network-cad-members */ SELECT project_tray_id::text FROM cad_route_groups
      WHERE project_id=$1 AND id=ANY($2::uuid[]) AND status='published' AND project_tray_id IS NOT NULL`, [projectId, groupIds])).rows;
    for (const group of groups) result.add(group.project_tray_id);
  }
  return result;
}

export function buildPreparationPlan(context: PreparationContext, input: PreparationCreate, id: string = randomUUID(), capacityProfile: PreparationCapacityProfile = LEGACY_PREPARATION_CAPACITY_PROFILE): PreparationPlan {
  const limitsProfile = preparationCapacityProfileSchema.parse(capacityProfile);
  const started = performance.now(); let work = 0;
  const budget = () => { if (++work > PREPARATION_LIMITS.planWork || performance.now() - started > PREPARATION_LIMITS.planMilliseconds) return fail('PREPARATION_PLAN_WORK_LIMIT', 413); };
  if (!equalPreparationScope(context.scope, input.expected)) return fail('PREPARATION_SCOPE_STALE');
  const discovery = input.discovery;
  const endpointsRequested = discovery.endpointScope?.mode !== 'not-requested';
  if (!endpointsRequested && (discovery.propertyScan !== null || discovery.endpointCandidates.length !== 0)) return fail('PREPARATION_DISCOVERY_ENDPOINT_SCOPE');
  if (discovery.modelVersionId !== context.scope.modelVersionId || discovery.contentFingerprint !== context.scope.contentFingerprint || discovery.selectionRevision !== context.scope.selectionRevision) return fail('PREPARATION_DISCOVERY_SCOPE');
  if (!discovery.complete) return fail('PREPARATION_DISCOVERY_INCOMPLETE');
  const objects = new Map(discovery.objects.map(o => [o.objectId, o]));
  const children = new Map<string, typeof discovery.objects>();
  for (const object of discovery.objects) { budget(); if (object.parentId !== null) { const group = children.get(object.parentId) ?? []; group.push(object); children.set(object.parentId, group); } }
  const diagnostics: PreparationPlan['diagnostics'] = [];
  const add = (code: string, trayIds: string[] = [], objectIds: string[] = []) => diagnostics.push({ code, projectTrayIds: trayIds, objectIds, message: 'Resolve this requested preparation scope before capture and publication.' });
  const chainCache = new Map<string, string[]>();
  const parentChain = (id: string): string[] => { const cached = chainCache.get(id); if (cached) return cached; const result: string[] = [], seen = new Set<string>([id]); let next = objects.get(id)?.parentId; while (next !== null && next !== undefined) { budget(); if (seen.has(next) || result.length >= 512 || !objects.has(next)) return fail('PREPARATION_HIERARCHY_INVALID'); seen.add(next); result.push(next); next = objects.get(next)!.parentId; } chainCache.set(id, result); return result; };
  for (const object of discovery.objects) parentChain(object.objectId);
  const trayIds = new Set(context.trays.map(t => t.projectTrayId));
  const explicitRootOwners = new Map(context.resolutions.filter(resolution => resolution.mode === 'roots'
    && trayIds.has(resolution.projectTrayId) && preparationResolutionMatchesScope(resolution.scope, context.scope))
    .flatMap(resolution => resolution.rootObjectIds.map(root => [root, resolution.projectTrayId] as const)));
  if (discovery.trays.length !== context.trays.length || discovery.trays.some(t => !trayIds.has(t.projectTrayId))) return fail('PREPARATION_DISCOVERY_TRAYS');
  const excluded: string[] = [], deferredCadTrayIds:string[]=[], skipped: NonNullable<PreparationPlan['requestedScope']['skippedTrays']> = [], trays: PreparationPlan['requestedScope']['trays'] = [], leafOwners = new Map<string, { trayId: string; root: string }>();
  const sliceObjects: Array<PreparationPlan['partPlan'][number]['objects'][number]> = [];
  for (const tray of context.trays) {
    budget();
    const savedResolution = context.resolutions.find(r => r.projectTrayId === tray.projectTrayId);
    const resolution = savedResolution && preparationResolutionMatchesScope(savedResolution.scope, context.scope) ? savedResolution : undefined;
    if (resolution?.mode === 'exclude' || tray.policyState === 'excluded') { excluded.push(tray.projectTrayId); continue; }
    if (tray.policyState !== 'configured' || !tray.purposeKey) { add(tray.policyState === 'unconfigured' ? 'PURPOSE_UNCONFIGURED' : 'TRAY_POLICY_INVALID', [tray.projectTrayId]); continue; }
    // Saved CAD centerlines enter through verified publication, never an SDK
    // name match. Keep their catalog dependency while capturing only base trays.
    if(tray.geometrySource==='saved-cad-route' || tray.geometrySource==='published-cad-route'){excluded.push(tray.projectTrayId);deferredCadTrayIds.push(tray.projectTrayId);continue;}
    const candidates = discovery.trays.find(t => t.projectTrayId === tray.projectTrayId)!.candidateRootObjectIds;
    if (candidates.some(root => { const candidate = objects.get(root); if (!candidate) return true; const exact = normalizeCatalogKey(candidate.name); return exact !== normalizeCatalogKey(tray.rawName) && exact !== normalizeCatalogKey(tray.routeName); })) return fail('PREPARATION_EXACT_CANDIDATE_INVALID');
    // A name match in a new model is not evidence that it is the physical object
    // assigned previously. Restore that assignment by stable identity first.
    const awaitingModelIdentity = !resolution && savedResolution?.mode === 'roots'
      && (['modelVersionId', 'contentFingerprint', 'selectionRevision'] as const).some(key => savedResolution.scope[key] !== context.scope[key]);
    const roots = resolution?.mode === 'roots' ? resolution.rootObjectIds : !awaitingModelIdentity && candidates.length === 1
      && !candidates.some(root => explicitRootOwners.has(root) && explicitRootOwners.get(root) !== tray.projectTrayId) ? candidates : [];
    if (!roots.length) {
      const reason = !awaitingModelIdentity && candidates.length ? 'TRAY_ROOT_AMBIGUOUS' as const : 'TRAY_ROOT_MISSING' as const;
      if (input.unresolvedTrayPolicy === 'skip') { excluded.push(tray.projectTrayId); skipped.push({ projectTrayId: tray.projectTrayId, reason }); }
      else add(reason, [tray.projectTrayId], candidates);
      continue;
    }
    if (roots.some(root => !objects.has(root))) return fail('PREPARATION_RESOLUTION_OBJECT_MISSING');
    trays.push({ projectTrayId: tray.projectTrayId, rawName: tray.rawName, purposeKey: tray.purposeKey, routeName: tray.routeName, allowedCategories: tray.allowedCategories, ownershipDecisionId: resolution?.id ?? null, orderedRootObjectIds: roots });
    let leaves = 0;
    for (const root of roots) {
      const stack = [objects.get(root)!];
      while (stack.length) {
      budget(); const object = stack.pop()!; for (const child of children.get(object.objectId) ?? []) { budget(); stack.push(child); }
      if (object.hasGeometry && !object.isPhysicalLeaf) { add('NON_LEAF_ROUTING_GEOMETRY', [tray.projectTrayId], [object.objectId]); continue; }
      if (!object.isPhysicalLeaf || !object.hasGeometry) continue;
      const old = leafOwners.get(object.objectId);
      if (old && old.trayId !== tray.projectTrayId) return fail('PREPARATION_LEAF_OWNERSHIP_CONFLICT');
      if (old) continue;
      leafOwners.set(object.objectId, { trayId: tray.projectTrayId, root }); leaves++;
      const boundedChain = [object.objectId, ...parentChain(object.objectId)];
      const inside = boundedChain.slice(0, boundedChain.indexOf(root) + 1);
      const shapeName = inside.map(id => objects.get(id)!.name).find(value => /(?:^|[^A-Za-z0-9])(?:BEND|ELBOW|FTUBE|TUBE|STRAIGHT)(?![A-Za-z0-9])/i.test(value)) ?? object.name;
      sliceObjects.push({ objectId: toDbId(object.objectId), rootObjectId: toDbId(root), projectTrayId: tray.projectTrayId, routeName: tray.routeName, shapeName, allowedCategories: tray.allowedCategories });
      }
    }
    if (!leaves) add('TRAY_GEOMETRY_MISSING', [tray.projectTrayId], roots);
  }
  const ordered = [...discovery.objects].sort((a, b) => a.orderIndex - b.orderIndex || toDbId(a.objectId) - toDbId(b.objectId));
  const order = new Map(ordered.map((o, i) => [o.objectId, i])); sliceObjects.sort((a, b) => order.get('dbid:' + a.objectId)! - order.get('dbid:' + b.objectId)!);
  const equipment = new Set<string>(), endpointNamesByObject = new Map<string, string[]>();
  if (endpointsRequested && context.endpointNames.length && (!discovery.propertyScan?.complete || discovery.endpointCandidates.length !== context.endpointNames.length || discovery.endpointCandidates.some(v => !context.endpointNames.includes(v.name)))) add('ENDPOINT_DISCOVERY_INCOMPLETE');
  for (const endpoint of endpointsRequested ? context.endpointNames : []) {
    const candidate = discovery.endpointCandidates.find(e => e.name === endpoint);
    for (const objectId of candidate?.objectIds ?? []) { if (!objects.has(objectId)) return fail('PREPARATION_ENDPOINT_OBJECT_MISSING'); if (leafOwners.has(objectId)) return fail('PREPARATION_ENDPOINT_ROUTE_CONFLICT'); equipment.add(objectId); endpointNamesByObject.set(objectId, [...(endpointNamesByObject.get(objectId) ?? []), endpoint]); }
    // Missing/ambiguous locations are captured as explicit endpoint status; they do not invent bindings.
  }
  const physicalLeaves = sliceObjects.map(o => 'dbid:' + o.objectId), equipmentIds = [...equipment].sort((a, b) => order.get(a)! - order.get(b)!);
  const slicesById = new Map(sliceObjects.map(o => ['dbid:' + o.objectId, o]));
  const captureBytesById = new Map(sliceObjects.map(o => ['dbid:' + o.objectId, Buffer.byteLength(canonicalPurposeJson(o)) + 1]));
  const partPlan: PreparationPlan['partPlan'] = [];
  const entities = [...physicalLeaves.map(id => ({ id, leaf: true })), ...equipmentIds.map(id => ({ id, leaf: false }))];
  for (let at = 0; at < entities.length;) {
    const items: typeof entities = [], ancestors = new Set<string>(), closure = new Set<string>(), names = new Set<string>(); let bytes = 128;
    while (at < entities.length && items.length < PREPARATION_LIMITS.objectsPerPart) {
      budget();
      const candidate = entities[at], chain = parentChain(candidate.id), additionalIds = [...new Set([candidate.id, ...chain])].filter(v => !closure.has(v));
      const additionalNames = candidate.leaf ? [] : (endpointNamesByObject.get(candidate.id) ?? []).filter(v => !names.has(v));
      const additionalBytes = (candidate.leaf ? captureBytesById.get(candidate.id)! : String(toDbId(candidate.id)).length + 1) + additionalNames.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value)) + 1, 0);
      if (closure.size + additionalIds.length > PREPARATION_LIMITS.closurePerPart || names.size + additionalNames.length > 256 || bytes + additionalBytes > 60 * 1024) { if (!items.length) return fail('PREPARATION_PART_CLOSURE_LIMIT', 413); break; }
      items.push(candidate); chain.forEach(v => ancestors.add(v)); additionalIds.forEach(v => closure.add(v)); additionalNames.forEach(v => names.add(v)); bytes += additionalBytes; at++;
    }
    const leaves = items.filter(v => v.leaf).map(v => v.id), endpoints = items.filter(v => !v.leaf).map(v => v.id);
    items.forEach(v => ancestors.delete(v.id));
    const part = { partId: randomUUID(), partIndex: partPlan.length, physicalLeafIds: leaves, equipmentObjectIds: endpoints, ancestorObjectIds: [...ancestors].sort((a, b) => order.get(a)! - order.get(b)!), objects: leaves.map(id => slicesById.get(id)!), equipmentNames: [...names], scopeSha256: '0'.repeat(64) };
    if (part.equipmentNames.length > 256) return fail('PREPARATION_PART_ENDPOINT_LIMIT', 413);
    part.scopeSha256 = preparationDigest(preparationPartScopeHashInput(part)); partPlan.push(part);
    if (partPlan.length > PREPARATION_LIMITS.parts) return fail('PREPARATION_PART_COUNT_LIMIT', 413);
  }
  if (!physicalLeaves.length) diagnostics.push({ code: 'NO_AUTHORIZED_ROUTING_GEOMETRY', projectTrayIds: [], objectIds: [], message: 'No usable tray geometry was found. Assign model objects to at least one configured tray, then check the trays again.' });
  const endpointEvidence = (endpointsRequested ? context.endpointNames : []).map(name => { const candidateObjectIds = [...(discovery.endpointCandidates.find(e => e.name === name)?.objectIds ?? [])].sort((a, b) => order.get(a)! - order.get(b)!); return { name, candidateObjectIds, status: candidateObjectIds.length === 0 ? 'missing' as const : candidateObjectIds.length === 1 ? 'unique_candidate' as const : 'ambiguous' as const }; });
  // Keep the current names as scope dependencies without inventing search evidence.
  const requestedScope = { scopeKind: endpointsRequested ? 'server-requested-project-routing-and-endpoints' as const : 'server-requested-project-routing-only' as const, wholePlantGeometry: false as const, ...(deferredCadTrayIds.length?{deferredCadTrayIds}:{}), ...(input.unresolvedTrayPolicy === 'skip' ? { unresolvedTrayPolicy: 'skip' as const, skippedTrays: skipped } : {}), ...(discovery.visibilityScope ? { endpointVisibility: discovery.visibilityScope } : {}), ...(discovery.endpointScope ? { endpointScope: discovery.endpointScope } : {}), trays, endpointNames: context.endpointNames, endpointEvidence, excludedProjectTrayIds: excluded, orderedPhysicalLeafIds: physicalLeaves, orderedEquipmentObjectIds: equipmentIds, scopeSha256: '0'.repeat(64) };
  const { scopeSha256: _scopeHash, ...scopeInput } = requestedScope;
  requestedScope.scopeSha256 = preparationDigest(scopeInput);
  const partial = { schemaVersion: 'wfc.pf.preparation-plan.v1' as const, id, projectId: context.projectId, ...context.scope, coordinateFrameId: preparationFrameId(context.projectId, context.scope.modelVersionId, context.scope.contentFingerprint), matchingPolicyVersion: discovery.matchingPolicyVersion, partitionAlgorithmVersion: 'wfc.pf.ordered-partition.v1' as const, limitsProfile, requestedScope, partPlan, objectManifest: ordered, objectOrder: ordered.map(o => toDbId(o.objectId)), diagnostics, orderedPlanSha256: '0'.repeat(64) };
  const plan = preparationPlanSchema.parse(partial); plan.orderedPlanSha256 = preparationDigest(preparationPlanHashInput(plan)); return plan;
}
