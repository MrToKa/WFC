import {
  normalizeCatalogKey,
  canonicalPurposeJson,
} from './pathfinderPurposePolicy.js';
import {
  PREPARATION_LIMITS,
  type PreparationContext,
  type PreparationDiscovery,
} from './pathfinderPreparation.js';
import type {
  PreparationDiscoveryObject,
  PreparationDiscoveryPage,
  PreparationDiscoveryRequest,
} from '../viewer-runtime/preparation-input.mjs';
export type PreparationDiscoveryReader = { discover(request: PreparationDiscoveryRequest): Promise<PreparationDiscoveryPage>; assertCurrent(): void };

/** Exact complete pagination; no candidate, scope or policy is inferred from a first match. */
export async function collectPreparationDiscovery<T extends PreparationDiscoveryReader>(
  context: PreparationContext,
  viewer: T,
  progress: (message: string) => void = () => {},
): Promise<PreparationDiscovery> {
  const objects = new Map<number, PreparationDiscoveryObject>();
  const order = new Map<number, number>();
  const trayMatches = new Map<string, number[]>(),
    endpointMatches = new Map<string, number[]>();
  let inventoryCount: number | null = null,
    equipmentProof: PreparationDiscovery['propertyScan'] = null;
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
  ) => {
    let cursor = 0;
    let pages = 0;
    for (;;) {
      viewer.assertCurrent();
      if (++pages > PREPARATION_LIMITS.objects)
        throw new Error('Model discovery exceeded its bounded pagination.');
      const page = await viewer.discover({
        schemaVersion: 'wfc.pf.viewer-discovery.v1',
        mode,
        names,
        rootObjectId,
        cursor,
        limit: 128,
      });
      viewer.assertCurrent();
      if (
        page.mode !== mode ||
        page.rootObjectId !== rootObjectId ||
        page.cursor !== cursor ||
        JSON.stringify(page.names) !== JSON.stringify(names) ||
        page.matchingPolicyVersion !== 'wfc.pf.project-exact-candidates.v1' ||
        page.complete !== (page.nextCursor === null) ||
        (page.nextCursor !== null && page.nextCursor <= cursor)
      )
        throw new Error(
          'The model returned inconsistent discovery coverage. Reload and try again.',
        );
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
  for (let offset = 0; offset < names.length; offset += 32) {
    const batch = names.slice(offset, offset + 32);
    progress(
      `Finding exact tray names: ${Math.min(offset + batch.length, names.length)} of ${names.length}.`,
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
  }
  const roots = [
    ...new Set(
      [...trayMatches.values()]
        .flat()
        .concat(
          context.resolutions
            .filter(
              (item) =>
                item.mode === 'roots' &&
                Object.entries(context.scope).every(
                  ([key, value]) =>
                    key === 'resolutionRevision' ||
                    item.scope[key as keyof typeof item.scope] === value,
                ),
            )
            .flatMap((item) => item.rootObjectIds.map((id) => Number(id.slice(5)))),
        ),
    ),
  ];
  for (let index = 0; index < roots.length; index++) {
    progress(`Reading candidate coverage: ${index + 1} of ${roots.length} roots.`);
    await pages('subtree', [], roots[index], () => {});
  }
  for (let offset = 0; offset < context.endpointNames.length; offset += 32) {
    const batch = context.endpointNames.slice(offset, offset + 32);
    progress(
      `Finding project endpoints: ${Math.min(offset + batch.length, context.endpointNames.length)} of ${context.endpointNames.length}.`,
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
  }
  for (const endpoint of new Set([...endpointMatches.values()].flat())) {
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
    if (missing) await pages('ancestors', [], endpoint, () => {});
  }
  const ordered = [...objects.values()].sort((left, right) => left.orderIndex - right.orderIndex);
  const idList = (values: number[]) =>
    [...new Set(values)]
      .sort((left, right) => objects.get(left)!.orderIndex - objects.get(right)!.orderIndex)
      .map((value) => `dbid:${value}`);
  const proof = equipmentProof as PreparationDiscovery['propertyScan'];
  return {
    schemaVersion: 'wfc.pf.discovery-report.v1',
    modelVersionId: context.scope.modelVersionId,
    contentFingerprint: context.scope.contentFingerprint,
    selectionRevision: context.scope.selectionRevision,
    matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1',
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
    endpointCandidates: context.endpointNames.map((name) => ({
      name,
      objectIds: idList(endpointMatches.get(name) ?? []),
    })),
  };
}
