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
  PreparationObjectIdentity,
  PreparationDiscoveryProgress,
} from '../viewer-runtime/preparation-input.mjs';
import { PREPARATION_MATCHING_POLICY, PREPARATION_VIEWER_LIMITS, validatePreparationDiscoveryPage, validatePreparationDiscoveryRequest, validatePreparationDiscoveryProgress } from '../viewer-runtime/preparation-input.mjs';
export type PreparationDiscoveryReader = { discover(request: PreparationDiscoveryRequest, onProgress?: (value: PreparationDiscoveryProgress) => void): Promise<PreparationDiscoveryPage>; assertCurrent(): void };
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
      PREPARATION_EQUIPMENT_PROPERTIES_TIMEOUT: 'Reading the model properties timed out.',
      PREPARATION_EQUIPMENT_PROPERTIES_FAILED: 'The viewer could not read the model properties.',
      PREPARATION_DISCOVERY_DEADLINE: 'The protected discovery request reached its time limit.',
      PREPARATION_EQUIPMENT_SCAN_LIMIT: 'The model property scan reached its supported total property limit.',
      PREPARATION_EQUIPMENT_ROW_LIMIT: 'A model property row exceeded its supported size.',
      PREPARATION_EQUIPMENT_INDEX_LIMIT: 'The matching property index reached its supported size limit.',
      PREPARATION_EQUIPMENT_PROPERTIES_INVALID: 'The model returned invalid property data.',
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

function equipmentNameBatches(names: readonly string[], maximumBytes: number): string[][] {
  if(names.length>PREPARATION_VIEWER_LIMITS.equipmentNames||new Set(names).size!==names.length)throw new Error('Project endpoint names exceed the supported exact discovery scope.');
  const groups:string[][]=[],encoder=new TextEncoder();let group:string[]=[],bytes=2;
  for(const name of names){
    if(!validatePreparationDiscoveryRequest({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:[name],rootObjectId:null,cursor:0,limit:1}))
      throw new Error('A project endpoint name is outside the protected discovery limits.');
    const size=encoder.encode(JSON.stringify(name)).length;
    if(group.length&&(group.length>=PREPARATION_VIEWER_LIMITS.equipmentNames||bytes+1+size>maximumBytes)){
      groups.push(group);group=[];bytes=2;
    }
    bytes+=size+(group.length?1:0);group.push(name);
  }
  if(group.length)groups.push(group);return groups;
}
/** Bound both echoed query names and one fully matching object inside 24KiB.
 * Keep query-scoped exact names; never retain the model's unrelated properties.
 */
export function preparationEquipmentNameBatches(names: readonly string[]): string[][] {
  return equipmentNameBatches(names, PREPARATION_VIEWER_LIMITS.equipmentNameBytes);
}
/** Reuse one complete property index across narrow query pages, even when all
 * project names cannot fit together in the existing bounded index request. */
export function preparationEquipmentIndexBatches(names: readonly string[]): string[][] {
  return equipmentNameBatches(names, PREPARATION_VIEWER_LIMITS.equipmentIndexNameBytes);
}

/** Exact complete pagination; no candidate, scope or policy is inferred from a first match. */
export async function collectPreparationDiscovery<T extends PreparationDiscoveryReader>(
  context: PreparationContext,
  viewer: T,
  progress: (message: string) => void = () => {},
  options: { skipEquipment?: boolean; assignedOnly?: boolean } = {},
): Promise<PreparationDiscovery> {
  let stage: PreparationDiscoveryFailureStage = { stage: 'tray-name-search', mode: 'names', rootObjectId: null,
    cursor: 0, queryNameCount: 0, completedUnits: 0, totalUnits: 0, trayNames: [] };
  try {
  const objects = new Map<number, PreparationDiscoveryObject>();
  const objectIdentities = new Map<number, PreparationObjectIdentity>();
  const skipEquipment = options.skipEquipment || options.assignedOnly;
  const order = new Map<number, number>();
  const trayMatches = new Map<string, number[]>(),
    endpointMatches = new Map<string, number[]>();
  let inventoryCount: number | null = null,
    equipmentProof: PreparationDiscovery['propertyScan'] = null;
  let visibilityScope:PreparationEndpointVisibility|null=null;
  const add = (object: PreparationDiscoveryObject) => {
    const prior = objects.get(object.objectId);
    const { matchedNames: _matched, objectIdentity, ...identity } = object;
    if (objectIdentity) {
      const priorIdentity = objectIdentities.get(object.objectId);
      if (priorIdentity && canonicalPurposeJson(priorIdentity) !== canonicalPurposeJson(objectIdentity)) throw new Error('The model object identity changed during discovery.');
      objectIdentities.set(object.objectId, objectIdentity);
    }
    if (prior) {
      const { matchedNames: _oldMatched, objectIdentity: _oldObjectIdentity, ...oldIdentity } = prior;
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
    equipmentIndexNames?: string[],
  ) => {
    let cursor = 0;
    let pages = 0;
    for (;;) {
      stage = { ...stage, mode, rootObjectId, rootObjectIds: rootObjectIds ? [...rootObjectIds] : undefined, cursor, queryNameCount: names.length };
      viewer.assertCurrent();
      if (++pages > PREPARATION_LIMITS.objects)
        throw new Error('Model discovery exceeded its bounded pagination.');
      let pendingPage = true, lastProgress: PreparationDiscoveryProgress | null = null;
      let page: PreparationDiscoveryPage;
      const request: PreparationDiscoveryRequest = {
        schemaVersion: 'wfc.pf.viewer-discovery.v1',
        mode,
        names,
        rootObjectId,
        ...(rootObjectIds ? { rootObjectIds } : {}),
        cursor,
        limit: 128,
        ...(mode === 'equipment' && equipmentIndexNames ? { indexNames: equipmentIndexNames } : {}),
        ...(mode === 'names' ? { includeProperties: true as const, ...(equipmentIndexNames ? { indexNames: equipmentIndexNames } : {}) } : {}),
        ...(visibilityScope?{visibilityScope}:{}),
      };
      const onPropertyProgress = (value: PreparationDiscoveryProgress) => {
        if (!pendingPage || !['names', 'equipment'].includes(mode) || !validatePreparationDiscoveryProgress(value)) return;
        try { viewer.assertCurrent(); } catch { return; }
        if (lastProgress && (value.total !== lastProgress.total || value.loaded < lastProgress.loaded)) return;
        lastProgress = { ...value };
        progress(`Reading model Properties for ${mode === 'names' ? 'project trays' : 'From/To locations'}: ${value.loaded} of ${value.total} objects checked.`);
      };
      try { page = await (['names', 'equipment'].includes(mode) ? viewer.discover(request, onPropertyProgress) : viewer.discover(request)); }
      finally { pendingPage = false; }
      viewer.assertCurrent();
      if (
        !validatePreparationDiscoveryPage(page) || page.mode !== mode ||
        page.rootObjectId !== rootObjectId ||
        JSON.stringify(page.rootObjectIds) !== JSON.stringify(rootObjectIds) ||
        page.cursor !== cursor ||
        JSON.stringify(page.names) !== JSON.stringify(names) ||
        (mode === 'names' && page.includeProperties !== true) ||
        page.matchingPolicyVersion !== PREPARATION_MATCHING_POLICY ||
        page.complete !== (page.nextCursor === null) ||
        (page.nextCursor !== null && page.nextCursor <= cursor)
      )
        throw new Error(
          'The model returned inconsistent discovery coverage. Reload and try again.',
        );
      if (mode === 'names' && (!page.propertyScan || !page.propertyScan.complete))
        throw new Error('The tray Properties search did not report complete model coverage. No automatic tray assignments were saved.');
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
  const names = options.assignedOnly ? [] : [...new Set([...trayNames.values()].flat())];
  const labelsByName = new Map<string, Set<string>>();
  for (const tray of context.trays) for (const name of trayNames.get(tray.projectTrayId) ?? []) {
    const labels = labelsByName.get(name) ?? new Set<string>(); labels.add(tray.rawName); labelsByName.set(name, labels);
  }
  stage = { ...stage, totalUnits: names.length };
  const trayIndexNames: string[][] = [];
  for (let at = 0; at < names.length; at += PREPARATION_VIEWER_LIMITS.equipmentNames)
    trayIndexNames.push(...preparationEquipmentIndexBatches(names.slice(at, at + PREPARATION_VIEWER_LIMITS.equipmentNames)));
  let nameOffset = 0;
  for (const indexNames of trayIndexNames) for (let at = 0; at < indexNames.length; at += 32) {
    const batch = indexNames.slice(at, at + 32), offset = nameOffset;
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
    }, undefined, indexNames);
    nameOffset += batch.length;
    progress(`Searching ${context.trays.length} project trays: ${offset + batch.length} of ${names.length} name variants checked.`);
  }
  const trayIds = new Set(context.trays.map(tray => tray.projectTrayId));
  const currentResolutions = context.resolutions.filter(item => item.mode === 'roots' && trayIds.has(item.projectTrayId) && preparationResolutionMatchesScope(item.scope, context.scope));
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
  if (options.assignedOnly && !roots.length) throw new Error('No current tray assignments are available. Discover project tray candidates or assign model objects before generating the network.');
  const labelsByRoot = new Map<number, Set<string>>(), trayLabels = new Map(context.trays.map(tray => [tray.projectTrayId, tray.rawName]));
  const addRootLabel = (root: number, label: string) => {
    const labels = labelsByRoot.get(root) ?? new Set<string>(); labels.add(label); labelsByRoot.set(root, labels);
  };
  for (const [name, ids] of trayMatches) for (const root of ids) for (const label of labelsByName.get(name) ?? []) addRootLabel(root, label);
  for (const resolution of currentResolutions) {
    const label = trayLabels.get(resolution.projectTrayId);
    if (label) for (const id of resolution.rootObjectIds) addRootLabel(Number(id.slice(5)), label);
  }
  const coverageRoots = options.skipEquipment && !options.assignedOnly ? [] : roots;
  for (let index = 0; index < coverageRoots.length; index += PREPARATION_VIEWER_LIMITS.subtreeRoots) {
    const batch = coverageRoots.slice(index, index + PREPARATION_VIEWER_LIMITS.subtreeRoots);
    const mode = batch.length === 1 ? 'subtree' : 'subtrees', rootObjectId = batch.length === 1 ? batch[0] : null;
    stage = { stage: 'tray-root-coverage', mode, rootObjectId, ...(batch.length > 1 ? { rootObjectIds: [...batch] } : {}), cursor: 0, queryNameCount: 0,
      completedUnits: index, totalUnits: roots.length, trayNames: [...new Set(batch.flatMap(root => [...(labelsByRoot.get(root) ?? [])]))] };
    progress(`Reading tray-root coverage: ${index} of ${roots.length} distinct roots completed for ${context.trays.length} project trays; starting ${batch.length === 1 ? `dbid:${rootObjectId}` : `the next ${batch.length} roots`}.`);
    const covered = new Set<number>();
    await pages(mode, [], rootObjectId, page => {
      for (const object of page.objects) if (batch.includes(object.objectId)) covered.add(object.objectId);
    }, batch.length > 1 ? batch : undefined);
    if (batch.some(root => !covered.has(root))) throw new Error('The model did not return every requested tray root. Check the model and discover again.');
    progress(`Reading tray-root coverage: ${index + batch.length} of ${roots.length} distinct roots completed for ${context.trays.length} project trays.`);
  }
  let endpointOffset=0;
  stage = { stage: 'endpoint-property-search', mode: 'equipment', rootObjectId: null, cursor: 0, queryNameCount: 0,
    completedUnits: 0, totalUnits: context.endpointNames.length, trayNames: [] };
  const endpointBatches = preparationEquipmentIndexBatches(skipEquipment ? [] : context.endpointNames)
    .flatMap(indexNames => preparationEquipmentNameBatches(indexNames).map(batch => ({ batch, indexNames })));
  for (const { batch, indexNames } of endpointBatches) {
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
    }, undefined, indexNames);
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
    ...(skipEquipment ? { endpointScope: { schemaVersion: 'wfc.pf.endpoint-discovery-scope.v1' as const, mode: 'not-requested' as const } } : {}),
    complete: proof === null || proof.complete,
    propertyScan: proof,
    objects: ordered.map(({ matchedNames: _names, objectIdentity: _identity, ...object }) => ({
      ...object,
      objectId: `dbid:${object.objectId}`,
      parentId: object.parentId === null ? null : `dbid:${object.parentId}`,
    })),
    trays: context.trays.map((tray) => ({
      projectTrayId: tray.projectTrayId,
      candidateRootObjectIds: idList(
        (trayNames.get(tray.projectTrayId) ?? []).flatMap((name) => trayMatches.get(name) ?? []),
      ),
      ...(!options.assignedOnly ? { candidateRootGroups: (() => {
        const groups = new Map<string, { rootObjectIds: string[]; identity: PreparationObjectIdentity | null }>();
        for (const root of idList((trayNames.get(tray.projectTrayId) ?? []).flatMap(name => trayMatches.get(name) ?? []))) {
          const identity = objectIdentities.get(Number(root.slice(5))) ?? null;
          const key = identity ? canonicalPurposeJson(identity) : root;
          const group = groups.get(key) ?? { rootObjectIds: [], identity };
          group.rootObjectIds.push(root); groups.set(key, group);
        }
        return [...groups.values()];
      })() } : {}),
    })),
    endpointCandidates: (skipEquipment ? [] : context.endpointNames).map((name) => ({
      name,
      objectIds: idList(endpointMatches.get(name) ?? []),
    })),
  };
  } catch (error) {
    if (preserveDiscoveryFailure(error) || error instanceof PreparationDiscoveryError) throw error;
    throw new PreparationDiscoveryError(stage, error);
  }
}
