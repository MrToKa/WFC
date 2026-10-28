import {
  normalizeCatalogKey,
  canonicalPurposeJson,
} from './pathfinderPurposePolicy.js';
import {
  PREPARATION_LIMITS,
  preparationResolutionMatchesScope,
  type PreparationContext,
  type PreparationDiscovery,
} from './pathfinderPreparation.js';
import type {
  PreparationDiscoveryObject,
  PreparationDiscoveryPage,
  PreparationDiscoveryRequest,
  PreparationEndpointVisibility,
} from '../viewer-runtime/preparation-input.mjs';
import { PREPARATION_MATCHING_POLICY, PREPARATION_VIEWER_LIMITS, validatePreparationDiscoveryPage, validatePreparationDiscoveryRequest } from '../viewer-runtime/preparation-input.mjs';
export type PreparationDiscoveryReader = { discover(request: PreparationDiscoveryRequest): Promise<PreparationDiscoveryPage>; assertCurrent(): void };
export type PreparationDiscoveryFailureStage = {
  stage: 'tray-name-search' | 'tray-root-coverage' | 'endpoint-property-search' | 'endpoint-ancestor-coverage';
  mode: PreparationDiscoveryRequest['mode']; rootObjectId: number | null; rootObjectIds?: number[]; cursor: number;
  queryNameCount: number; completedUnits: number; totalUnits: number; trayNames: string[];
};
/** Host diagnostics only; discovery pages and their exact coverage proof are unchanged. */
export class PreparationDiscoveryError extends Error {
  readonly causeCode: string | null;
  constructor(readonly discoveryStage: PreparationDiscoveryFailureStage, cause: unknown) {
    const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code.slice(0, 96) : null;
    const { mode, rootObjectId, rootObjectIds, cursor, completedUnits, totalUnits, trayNames } = discoveryStage;
    const labels = trayNames.slice(0, 4).join(', ') + (trayNames.length > 4 ? ` and ${trayNames.length - 4} more project trays` : '');
    const step = mode === 'names' ? `Tray-name discovery stopped after checking ${completedUnits} of ${totalUnits} name variants${labels ? ` (${labels})` : ''}`
      : mode === 'subtree' ? `Tray-root discovery stopped at dbid:${rootObjectId}${labels ? ` (${labels})` : ''}; ${completedUnits} of ${totalUnits} roots completed`
        : mode === 'subtrees' ? `Tray-root discovery stopped for ${(rootObjectIds ?? []).slice(0, 4).map(id => `dbid:${id}`).join(', ')}${(rootObjectIds?.length ?? 0) > 4 ? ` and ${rootObjectIds!.length - 4} more roots` : ''}${labels ? ` (${labels})` : ''}; ${completedUnits} of ${totalUnits} roots completed`
        : mode === 'equipment' ? `From/To property discovery stopped after checking ${completedUnits} of ${totalUnits} project endpoint names`
          : `From/To hierarchy discovery stopped at dbid:${rootObjectId}; ${completedUnits} of ${totalUnits} endpoint hierarchies completed`;
    const reasons: Record<string, string> = {
      PREPARATION_EQUIPMENT_PROPERTIES_TIMEOUT: 'Reading the model endpoint properties timed out.',
      PREPARATION_EQUIPMENT_PROPERTIES_FAILED: 'The viewer could not read the model endpoint properties.',
      PREPARATION_DISCOVERY_DEADLINE: 'The protected discovery request reached its time limit.',
      PREPARATION_EQUIPMENT_SCAN_LIMIT: 'The endpoint property scan reached its supported total property limit.',
      PREPARATION_EQUIPMENT_ROW_LIMIT: 'A model endpoint property row exceeded its supported size.',
      PREPARATION_EQUIPMENT_INDEX_LIMIT: 'The matching endpoint index reached its supported size limit.',
      PREPARATION_EQUIPMENT_PROPERTIES_INVALID: 'The model returned invalid endpoint property data.',
      PREPARATION_DISCOVERY_RESULT_INVALID: 'The viewer returned invalid discovery evidence.',
      EXTRACTION_FAILED: 'The viewer did not report a more specific cause.',
    };
    const detail = code ? `${reasons[code] ?? 'The viewer reported a discovery failure.'} Viewer code: ${code}.`
      : cause instanceof Error ? cause.message.slice(0, 500) : 'The viewer did not provide a specific reason.';
    super(`${step} (page cursor ${cursor}). ${detail}`, { cause });
    this.name = 'PreparationDiscoveryError'; this.causeCode = code;
  }
}
function preserveDiscoveryFailure(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') || status === 401 || status === 403
    || ['CAPTURE_RELOAD_REQUIRED', 'ACCESS_REVOKED', 'SESSION_EXPIRED', 'MODEL_SELECTION_CHANGED', 'MODEL_UNAVAILABLE',
      'RESOURCE_FAILED', 'BARRIER_CAPTURE_MODEL_CHANGED', 'AUTHENTICATION_REQUIRED', 'LOGIN_REVOKED'].includes(String(code));
}

/** Bound both echoed request names and one fully matching object inside 24KiB.
 * Keep query-scoped exact names; never retain the model's unrelated properties.
 */
export function preparationEquipmentNameBatches(names: readonly string[]): string[][] {
  if(names.length>PREPARATION_VIEWER_LIMITS.equipmentNames||new Set(names).size!==names.length)throw new Error('Project endpoint names exceed the supported exact discovery scope.');
  const groups:string[][]=[],encoder=new TextEncoder();let group:string[]=[],bytes=2;
  for(const name of names){
    if(!validatePreparationDiscoveryRequest({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:[name],rootObjectId:null,cursor:0,limit:1}))
      throw new Error('A project endpoint name is outside the protected discovery limits.');
    const size=encoder.encode(JSON.stringify(name)).length;
    if(group.length&&(group.length>=PREPARATION_VIEWER_LIMITS.equipmentNames||bytes+1+size>PREPARATION_VIEWER_LIMITS.equipmentNameBytes)){
      groups.push(group);group=[];bytes=2;
    }
    bytes+=size+(group.length?1:0);group.push(name);
  }
  if(group.length)groups.push(group);return groups;
}

/** Exact complete pagination; no candidate, scope or policy is inferred from a first match. */
export async function collectPreparationDiscovery<T extends PreparationDiscoveryReader>(
  context: PreparationContext,
  viewer: T,
  progress: (message: string) => void = () => {},
  options: { skipEquipment?: boolean } = {},
): Promise<PreparationDiscovery> {
  let stage: PreparationDiscoveryFailureStage = { stage: 'tray-name-search', mode: 'names', rootObjectId: null,
    cursor: 0, queryNameCount: 0, completedUnits: 0, totalUnits: 0, trayNames: [] };
  try {
  const objects = new Map<number, PreparationDiscoveryObject>();
  const order = new Map<number, number>();
  const trayMatches = new Map<string, number[]>(),
    endpointMatches = new Map<string, number[]>();
  let inventoryCount: number | null = null,
    equipmentProof: PreparationDiscovery['propertyScan'] = null;
  let visibilityScope:PreparationEndpointVisibility|null=null;
  // The query batch still fits its existing 8KiB/24KiB request-response scope.
  // A bounded shared name universe lets the viewer index project properties
  // once across those batches; larger universes retain the existing fallback.
  const equipmentIndexNames = context.endpointNames.length > 0
    && context.endpointNames.length <= PREPARATION_VIEWER_LIMITS.equipmentNames
    && new TextEncoder().encode(JSON.stringify(context.endpointNames)).length <= PREPARATION_VIEWER_LIMITS.equipmentIndexNameBytes
    && validatePreparationDiscoveryRequest({ schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: 'equipment',
      names: [context.endpointNames[0]], indexNames: context.endpointNames, rootObjectId: null, cursor: 0, limit: 1 })
    ? context.endpointNames : undefined;
  const add = (object: PreparationDiscoveryObject) => {
    const prior = objects.get(object.objectId);
    const { matchedNames: _matched, ...identity } = object;
    if (prior) {
      const { matchedNames: _oldMatched, ...oldIdentity } = prior;
      if (canonicalPurposeJson(identity) !== canonicalPurposeJson(oldIdentity))
        throw new Error(
          'The model inventory changed during discovery. Reload the model and discover again.',
        );
    } else {
      if (
        objects.size >= PREPARATION_LIMITS.objects ||
        (order.has(object.orderIndex) && order.get(object.orderIndex) !== object.objectId)
      )
        throw new Error(
          'The model discovery exceeds its supported size or has conflicting object order.',
        );
      objects.set(object.objectId, object);
      order.set(object.orderIndex, object.objectId);
    }
  };
  const pages = async (
    mode: PreparationDiscoveryRequest['mode'],
    names: string[],
    rootObjectId: number | null,
    consume: (page: PreparationDiscoveryPage) => void,
    rootObjectIds?: number[],
  ) => {
    let cursor = 0;
    let pages = 0;
    for (;;) {
      stage = { ...stage, mode, rootObjectId, rootObjectIds: rootObjectIds ? [...rootObjectIds] : undefined, cursor, queryNameCount: names.length };
      viewer.assertCurrent();
      if (++pages > PREPARATION_LIMITS.objects)
        throw new Error('Model discovery exceeded its bounded pagination.');
      const page = await viewer.discover({
        schemaVersion: 'wfc.pf.viewer-discovery.v1',
        mode,
        names,
        rootObjectId,
        ...(rootObjectIds ? { rootObjectIds } : {}),
        cursor,
        limit: 128,
        ...(mode === 'equipment' && equipmentIndexNames ? { indexNames: equipmentIndexNames } : {}),
        ...(visibilityScope?{visibilityScope}:{}),
      });
      viewer.assertCurrent();
      if (
        !validatePreparationDiscoveryPage(page) || page.mode !== mode ||
        page.rootObjectId !== rootObjectId ||
        JSON.stringify(page.rootObjectIds) !== JSON.stringify(rootObjectIds) ||
        page.cursor !== cursor ||
        JSON.stringify(page.names) !== JSON.stringify(names) ||
        page.matchingPolicyVersion !== PREPARATION_MATCHING_POLICY ||
        page.complete !== (page.nextCursor === null) ||
        (page.nextCursor !== null && page.nextCursor <= cursor)
      )
        throw new Error(
          'The model returned inconsistent discovery coverage. Reload and try again.',
        );
      if(visibilityScope&&canonicalPurposeJson(visibilityScope)!==canonicalPurposeJson(page.visibilityScope))
        throw new Error('The model display visibility changed during discovery. Discover again before freezing a plan.');
      visibilityScope=page.visibilityScope;
      if (inventoryCount !== null && inventoryCount !== page.indexedObjectCount)
        throw new Error('The model inventory changed during discovery.');
      inventoryCount = page.indexedObjectCount;
      page.objects.forEach(add);
      consume(page);
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
  };
  const trayNames = new Map(
    context.trays.map((tray) => [
      tray.projectTrayId,
      [...new Set([normalizeCatalogKey(tray.rawName), normalizeCatalogKey(tray.routeName)])],
    ]),
  );
  const names = [...new Set([...trayNames.values()].flat())];
  const labelsByName = new Map<string, Set<string>>();
  for (const tray of context.trays) for (const name of trayNames.get(tray.projectTrayId) ?? []) {
    const labels = labelsByName.get(name) ?? new Set<string>(); labels.add(tray.rawName); labelsByName.set(name, labels);
  }
  stage = { ...stage, totalUnits: names.length };
  for (let offset = 0; offset < names.length; offset += 32) {
    const batch = names.slice(offset, offset + 32);
    stage = { ...stage, completedUnits: offset, trayNames: [...new Set(batch.flatMap(name => [...(labelsByName.get(name) ?? [])]))] };
    progress(
      `Searching ${context.trays.length} project trays: ${offset} of ${names.length} name variants checked; starting the next ${batch.length}.`,
    );
    for (const name of batch) trayMatches.set(name, []);
    await pages('names', batch, null, (page) => {
      for (const object of page.objects)
        for (const name of object.matchedNames) {
          if (!batch.includes(name))
            throw new Error('The model returned a candidate outside the requested names.');
          trayMatches.get(name)!.push(object.objectId);
        }
    });
    progress(`Searching ${context.trays.length} project trays: ${offset + batch.length} of ${names.length} name variants checked.`);
  }
  const currentResolutions = context.resolutions.filter(item => item.mode === 'roots' && preparationResolutionMatchesScope(item.scope, context.scope));
  const roots = [
    ...new Set(
      [...trayMatches.values()]
        .flat()
        .concat(
          currentResolutions
            .flatMap((item) => item.rootObjectIds.map((id) => Number(id.slice(5)))),
        ),
    ),
  ];
  const labelsByRoot = new Map<number, Set<string>>(), trayLabels = new Map(context.trays.map(tray => [tray.projectTrayId, tray.rawName]));
  const addRootLabel = (root: number, label: string) => {
    const labels = labelsByRoot.get(root) ?? new Set<string>(); labels.add(label); labelsByRoot.set(root, labels);
  };
  for (const [name, ids] of trayMatches) for (const root of ids) for (const label of labelsByName.get(name) ?? []) addRootLabel(root, label);
  for (const resolution of currentResolutions) {
    const label = trayLabels.get(resolution.projectTrayId);
    if (label) for (const id of resolution.rootObjectIds) addRootLabel(Number(id.slice(5)), label);
  }
  for (let index = 0; index < roots.length; index += PREPARATION_VIEWER_LIMITS.subtreeRoots) {
    const batch = roots.slice(index, index + PREPARATION_VIEWER_LIMITS.subtreeRoots);
    const mode = batch.length === 1 ? 'subtree' : 'subtrees', rootObjectId = batch.length === 1 ? batch[0] : null;
    stage = { stage: 'tray-root-coverage', mode, rootObjectId, ...(batch.length > 1 ? { rootObjectIds: [...batch] } : {}), cursor: 0, queryNameCount: 0,
      completedUnits: index, totalUnits: roots.length, trayNames: [...new Set(batch.flatMap(root => [...(labelsByRoot.get(root) ?? [])]))] };
    progress(`Reading tray-root coverage: ${index} of ${roots.length} distinct roots completed for ${context.trays.length} project trays; starting ${batch.length === 1 ? `dbid:${rootObjectId}` : `the next ${batch.length} roots`}.`);
    const covered = new Set<number>();
    await pages(mode, [], rootObjectId, page => {
      for (const object of page.objects) if (batch.includes(object.objectId)) covered.add(object.objectId);
    }, batch.length > 1 ? batch : undefined);
    if (batch.length > 1 && batch.some(root => !covered.has(root))) throw new Error('The model did not return every requested tray root. Check the model and discover again.');
    progress(`Reading tray-root coverage: ${index + batch.length} of ${roots.length} distinct roots completed for ${context.trays.length} project trays.`);
  }
  let endpointOffset=0;
  stage = { stage: 'endpoint-property-search', mode: 'equipment', rootObjectId: null, cursor: 0, queryNameCount: 0,
    completedUnits: 0, totalUnits: context.endpointNames.length, trayNames: [] };
  for (const batch of preparationEquipmentNameBatches(options.skipEquipment ? [] : context.endpointNames)) {
    stage = { ...stage, completedUnits: endpointOffset };
    progress(
      `Searching From/To properties: ${endpointOffset} of ${context.endpointNames.length} project endpoint names checked; starting the next ${batch.length}.`,
    );
    for (const name of batch) endpointMatches.set(name, []);
    await pages('equipment', batch, null, (page) => {
      if (!page.propertyScan)
        throw new Error('The endpoint search did not report complete property coverage.');
      const proof = { indexedObjectCount: page.indexedObjectCount, ...page.propertyScan };
      if (equipmentProof && canonicalPurposeJson(equipmentProof) !== canonicalPurposeJson(proof))
        throw new Error(
          'Endpoint property coverage changed between discovery pages. Reload and try again.',
        );
      equipmentProof = proof;
      for (const object of page.objects)
        for (const name of object.matchedNames) {
          if (!batch.includes(name))
            throw new Error('The model returned an endpoint outside the requested names.');
          endpointMatches.get(name)!.push(object.objectId);
        }
    });
    endpointOffset+=batch.length;
    progress(`Searching From/To properties: ${endpointOffset} of ${context.endpointNames.length} project endpoint names checked.`);
  }
  const endpoints = [...new Set([...endpointMatches.values()].flat())];
  for (const [index, endpoint] of endpoints.entries()) {
    stage = { stage: 'endpoint-ancestor-coverage', mode: 'ancestors', rootObjectId: endpoint, cursor: 0,
      queryNameCount: 0, completedUnits: index, totalUnits: endpoints.length, trayNames: [] };
    let parent = objects.get(endpoint)?.parentId ?? null;
    const seen = new Set<number>();
    let missing = false;
    while (parent !== null) {
      if (seen.has(parent)) throw new Error('The model returned a cyclic endpoint hierarchy.');
      seen.add(parent);
      const object = objects.get(parent);
      if (!object) {
        missing = true;
        break;
      }
      parent = object.parentId;
    }
    if (missing) {
      progress(`Reading From/To hierarchy: ${index} of ${endpoints.length} endpoint hierarchies completed; starting dbid:${endpoint}.`);
      await pages('ancestors', [], endpoint, () => {});
    }
  }
  const ordered = [...objects.values()].sort((left, right) => left.orderIndex - right.orderIndex);
  const idList = (values: number[]) =>
    [...new Set(values)]
      .sort((left, right) => objects.get(left)!.orderIndex - objects.get(right)!.orderIndex)
      .map((value) => `dbid:${value}`);
  const proof = equipmentProof as PreparationDiscovery['propertyScan'];
  if(!visibilityScope)throw new Error('No project tray or endpoint names are available for discovery.');
  return {
    schemaVersion: 'wfc.pf.discovery-report.v1',
    modelVersionId: context.scope.modelVersionId,
    contentFingerprint: context.scope.contentFingerprint,
    selectionRevision: context.scope.selectionRevision,
    matchingPolicyVersion: PREPARATION_MATCHING_POLICY,
    visibilityScope,
    ...(options.skipEquipment ? { endpointScope: { schemaVersion: 'wfc.pf.endpoint-discovery-scope.v1' as const, mode: 'not-requested' as const } } : {}),
    complete: proof === null || proof.complete,
    propertyScan: proof,
    objects: ordered.map(({ matchedNames: _names, ...object }) => ({
      ...object,
      objectId: `dbid:${object.objectId}`,
      parentId: object.parentId === null ? null : `dbid:${object.parentId}`,
    })),
    trays: context.trays.map((tray) => ({
      projectTrayId: tray.projectTrayId,
      candidateRootObjectIds: idList(
        (trayNames.get(tray.projectTrayId) ?? []).flatMap((name) => trayMatches.get(name) ?? []),
      ),
    })),
    endpointCandidates: (options.skipEquipment ? [] : context.endpointNames).map((name) => ({
      name,
      objectIds: idList(endpointMatches.get(name) ?? []),
    })),
  };
  } catch (error) {
    if (preserveDiscoveryFailure(error) || error instanceof PreparationDiscoveryError) throw error;
    throw new PreparationDiscoveryError(stage, error);
  }
}
