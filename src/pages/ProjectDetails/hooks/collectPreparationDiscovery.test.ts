import { describe, expect, it, vi } from 'vitest';
import { collectPreparationDiscovery } from './collectPreparationDiscovery';
import { preparationEquipmentNameBatches, PreparationDiscoveryError } from '../../../../shared/collectPreparationDiscovery';
import { PREPARATION_MATCHING_POLICY, PREPARATION_VIEWER_LIMITS } from '../../../../viewer-runtime/preparation-input.mjs';
import { preparationFixture, preparationIds as ids } from '../../../test/preparationFixtures';
import type { ProjectPreparationViewer } from './usePathFinder';
import type {
  PreparationDiscoveryPage,
  PreparationDiscoveryRequest,
} from '../../../../viewer-runtime/preparation-input.mjs';
const visibilityScope={schemaVersion:'wfc.pf.sdk-display-visibility.v1' as const,basis:'sdk-display-before-pf-appearance' as const,contentSha256:'a'.repeat(64)};
function viewer(
  options: { incomplete?: boolean; conflicting?: boolean; endpoints?: boolean } = {},
) {
  const object = (
    id: number,
    parentId: number | null,
    name: string,
    orderIndex: number,
    leaf = false,
    matchedNames: string[] = [],
  ) => ({
    objectId: id,
    parentId,
    name,
    orderIndex,
    isPhysicalLeaf: leaf,
    hasGeometry: leaf,
    matchedNames,
  });
  const discover = vi.fn(
    async (request: PreparationDiscoveryRequest): Promise<PreparationDiscoveryPage> => {
      let objects: PreparationDiscoveryPage['objects'] = [],
        nextCursor: number | null = null;
      if (request.mode === 'names') {
        if (request.cursor === 0) {
          objects = [object(1, null, 'Tray 01', 0, false, ['Tray 01'])];
          nextCursor = 1;
        } else objects = [object(3, null, 'Tray 01', 2, true, ['Tray 01'])];
      } else if (request.mode === 'subtree' || request.mode === 'subtrees') {
        const roots = request.rootObjectIds ?? [request.rootObjectId];
        objects = roots.flatMap(root => root === 1
          ? [object(1, null, options.conflicting ? 'Changed' : 'Tray 01', 0), object(2, 1, 'Leaf', 1, true)]
          : root === 3 ? [object(3, null, 'Tray 01', 2, true)] : []);
      }
      else if (request.mode === 'equipment')
        objects = [object(9, 8, 'Property-only endpoint', 9, false, request.names)];
      else
        objects = [
          object(8, null, 'Endpoint ancestor', 8),
          object(9, 8, 'Property-only endpoint', 9),
        ];
      return {
        schemaVersion: 'wfc.pf.viewer-discovery.v1',
        mode: request.mode,
        names: request.names,
        rootObjectId: request.rootObjectId,
        ...(request.rootObjectIds ? { rootObjectIds: [...request.rootObjectIds] } : {}),
        cursor: request.cursor,
        matchingPolicyVersion: PREPARATION_MATCHING_POLICY,
        visibilityScope,
        indexedObjectCount: 10,
        propertyScan:
          request.mode === 'equipment'
            ? {
                attemptedObjectCount: 10,
                returnedObjectCount: options.incomplete ? 9 : 10,
                omittedObjectCount: options.incomplete ? 1 : 0,
                complete: !options.incomplete,
              }
            : null,
        objects,
        nextCursor,
        complete: nextCursor === null,
      };
    },
  );
  return {
    discover,
    assertCurrent: vi.fn(),
    capture: vi.fn(),
    captureBarriers: vi.fn(),
    publishBarriers: vi.fn(),
    readSelection: vi.fn(),
    readTrayRootSelection: vi.fn(),
  } as ProjectPreparationViewer & {
    discover: typeof discover;
  };
}
describe('complete exact preparation discovery', () => {
  it('manual tray-only discovery never calls the From/To property scanner and retains every project tray', async () => {
    const {context}=preparationFixture(),io=viewer();context.endpointNames=['EQ-01'];
    const result=await collectPreparationDiscovery(context,io,()=>{},{skipEquipment:true});
    expect(io.discover.mock.calls.every(([request])=>request.mode==='names'||request.mode==='subtree'||request.mode==='subtrees')).toBe(true);
    expect(result.trays).toHaveLength(context.trays.length);expect(result.complete).toBe(true);expect(result.propertyScan).toBeNull();
    expect(result.endpointCandidates).toEqual([]);
    expect(result.endpointScope).toEqual({ schemaVersion: 'wfc.pf.endpoint-discovery-scope.v1', mode: 'not-requested' });
  });
  it('keeps default discovery as a full endpoint search with no tray-only marker', async () => {
    const { context } = preparationFixture(), io = viewer(); context.endpointNames = ['EQ-01'];
    const result = await collectPreparationDiscovery(context, io);
    expect(io.discover.mock.calls.some(([request]) => request.mode === 'equipment')).toBe(true);
    expect(result.propertyScan?.complete).toBe(true); expect(result.endpointScope).toBeUndefined();
    expect(result.endpointCandidates).toEqual([{ name: 'EQ-01', objectIds: ['dbid:9'] }]);
  });
  it.each(['names', 'subtrees', 'equipment', 'ancestors'] as const)('reports the exact ordinary failure stage for %s without claiming a geometry limit', async mode => {
    const { context } = preparationFixture(), io = viewer(), original = io.discover.getMockImplementation()!;
    context.endpointNames = ['EQ-01'];
    const cause = Object.assign(new Error('Opaque SDK failure'), { code: 'EXTRACTION_FAILED' });
    io.discover.mockImplementation(request => request.mode === mode ? Promise.reject(cause) : original(request));
    const failure = await collectPreparationDiscovery(context, io).catch(error => error);
    expect(failure).toBeInstanceOf(PreparationDiscoveryError); expect(failure.cause).toBe(cause);
    expect(failure.causeCode).toBe('EXTRACTION_FAILED');
    expect(failure.discoveryStage).toMatchObject({ mode, cursor: 0,
      rootObjectId: mode === 'ancestors' ? 9 : null });
    if (mode === 'subtrees') { expect(failure.discoveryStage.trayNames).toEqual(['Tray 01']); expect(failure.discoveryStage.rootObjectIds).toEqual([1, 3]); }
    expect(failure.message).toContain('Viewer code: EXTRACTION_FAILED'); expect(failure.message).not.toMatch(/safety limits|triangle limit|memory limit/);
  });
  it('retains the exact failing subtree page cursor and counts only completed roots', async () => {
    const { context } = preparationFixture(), io = viewer(), original = io.discover.getMockImplementation()!;
    const cause = Object.assign(new Error('Failed second subtree page'), { code: 'EXTRACTION_FAILED' });
    io.discover.mockImplementation(async request => {
      if (request.mode === 'subtrees' && request.cursor === 1) throw cause;
      const page = await original(request);
      return request.mode === 'subtrees' ? { ...page, nextCursor: 1, complete: false } : page;
    });
    await expect(collectPreparationDiscovery(context, io)).rejects.toMatchObject({
      discoveryStage: { stage: 'tray-root-coverage', mode: 'subtrees', rootObjectId: null, rootObjectIds: [1, 3], cursor: 1, completedUnits: 0, totalUnits: 2 }, causeCode: 'EXTRACTION_FAILED',
    });
  });
  it.each([
    new DOMException('Paused', 'AbortError'), Object.assign(new Error('Paused'), { name: 'AbortError' }),
    Object.assign(new Error('Renew frame'), { code: 'CAPTURE_RELOAD_REQUIRED' }),
    Object.assign(new Error('Access refused'), { code: 'ACCESS_REVOKED', status: 403 }),
  ])('preserves cancellation, reload and authority failures unchanged (%s)', async cause => {
    const { context } = preparationFixture(), io = viewer(); io.discover.mockRejectedValue(cause);
    await expect(collectPreparationDiscovery(context, io)).rejects.toBe(cause);
    expect(io.discover).toHaveBeenCalledOnce();
  });
  it('distinguishes 330 project trays, 660 name variants and 328 completed roots without dropping two missing trays', async () => {
    const { context } = preparationFixture(), base = context.trays[0], progress = vi.fn();
    context.trays = Array.from({ length: 330 }, (_, index) => ({ ...base,
      projectTrayId: `81000000-0000-4000-8000-${String(index).padStart(12, '0')}`, rawName: `T${index}`, routeName: `/T${index}` }));
    const objects = context.trays.slice(0, 328).map((tray, index) => ({ objectId: index + 1, parentId: null,
      name: tray.rawName, hasGeometry: true, isPhysicalLeaf: true, orderIndex: index }));
    const io = viewer();
    io.discover.mockImplementation(async request => ({ schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: request.mode,
      rootObjectId: request.rootObjectId, names: request.names, cursor: request.cursor, matchingPolicyVersion: PREPARATION_MATCHING_POLICY,
      ...(request.rootObjectIds ? { rootObjectIds: [...request.rootObjectIds] } : {}),
      visibilityScope, indexedObjectCount: 328, propertyScan: null, nextCursor: null, complete: true,
      objects: objects.filter(object => request.mode === 'names' ? request.names.includes(object.name) : request.rootObjectIds?.includes(object.objectId) ?? object.objectId === request.rootObjectId)
        .map(object => ({ ...object, matchedNames: request.mode === 'names' ? [object.name] : [] })) }));
    const result = await collectPreparationDiscovery(context, io, progress);
    expect(progress).toHaveBeenCalledWith('Searching 330 project trays: 640 of 660 name variants checked; starting the next 20.');
    expect(progress).toHaveBeenCalledWith('Searching 330 project trays: 660 of 660 name variants checked.');
    expect(progress).toHaveBeenLastCalledWith('Reading tray-root coverage: 328 of 328 distinct roots completed for 330 project trays.');
    expect(result.trays).toHaveLength(330); expect(result.trays.filter(tray => tray.candidateRootObjectIds.length === 1)).toHaveLength(328);
    expect(result.trays.filter(tray => tray.candidateRootObjectIds.length === 0)).toHaveLength(2);
    expect(result.complete).toBe(true);
    const rootRequests = io.discover.mock.calls.map(([request]) => request).filter(request => request.mode === 'subtrees');
    expect(rootRequests).toHaveLength(11); expect(rootRequests.every(request => request.rootObjectIds!.length <= 32)).toBe(true);
    expect(rootRequests.flatMap(request => request.rootObjectIds!)).toEqual(objects.map(object => object.objectId));
  });
  it('freezes the first SDK baseline visibility scope into every following page and the complete report',async()=>{
    const {context}=preparationFixture(),io=viewer();context.endpointNames=['EQ-01'];
    const result=await collectPreparationDiscovery(context,io);
    expect(io.discover.mock.calls[0][0]).not.toHaveProperty('visibilityScope');
    for(const [request] of io.discover.mock.calls.slice(1))expect(request.visibilityScope).toEqual(visibilityScope);
    expect(result.visibilityScope).toEqual(visibilityScope);expect(result.matchingPolicyVersion).toBe('wfc.pf.project-exact-candidates.v3');
  });
  it('refuses a reordered batched root echo even when the page is structurally valid', async () => {
    const { context } = preparationFixture(), io = viewer(), original = io.discover.getMockImplementation()!;
    io.discover.mockImplementation(async request => {
      const page = await original(request);
      return request.mode === 'subtrees' ? { ...page, rootObjectIds: [...request.rootObjectIds!].reverse() } : page;
    });
    await expect(collectPreparationDiscovery(context, io)).rejects.toThrow('inconsistent discovery coverage');
  });
  it('does not claim complete batched root coverage when one root was omitted from the returned union', async () => {
    const { context } = preparationFixture(), io = viewer(), original = io.discover.getMockImplementation()!;
    io.discover.mockImplementation(async request => {
      const page = await original(request);
      return request.mode === 'subtrees' ? { ...page, objects: page.objects.filter(object => object.objectId !== 3) } : page;
    });
    await expect(collectPreparationDiscovery(context, io)).rejects.toThrow('did not return every requested tray root');
  });
  it('packs all1527 exact endpoint names into a few UTF8-bounded query scopes without truncating candidates',async()=>{
    const {context}=preparationFixture(),io=viewer();context.trays=[];
    context.endpointNames=Array.from({length:1527},(_,index)=>`=F1=SECTION${String(index).padStart(4,'0')}=EQ001`);
    const groups=preparationEquipmentNameBatches(context.endpointNames);expect(groups.length).toBeGreaterThan(1);expect(groups.length).toBeLessThan(10);
    expect(groups.flat()).toEqual(context.endpointNames);for(const group of groups)expect(new TextEncoder().encode(JSON.stringify(group)).length).toBeLessThanOrEqual(PREPARATION_VIEWER_LIMITS.equipmentNameBytes);
    const result=await collectPreparationDiscovery(context,io),requests=io.discover.mock.calls.map(([request])=>request).filter(request=>request.mode==='equipment');
    expect(requests).toHaveLength(groups.length);expect(requests.flatMap(request=>request.names)).toEqual(context.endpointNames);
    expect(result.endpointCandidates).toHaveLength(1527);expect(result.endpointCandidates.every(candidate=>candidate.objectIds.join()==='dbid:9')).toBe(true);
    expect(result.complete).toBe(true);
  });
  it('sends one bounded project-name universe across endpoint query batches while preserving each narrow response scope', async () => {
    const { context } = preparationFixture(), io = viewer(); context.trays = [];
    context.endpointNames = Array.from({ length: 1527 }, (_, index) => `=EQ${String(index).padStart(5, '0')}`);
    const groups = preparationEquipmentNameBatches(context.endpointNames);
    expect(groups.length).toBeGreaterThan(1);
    expect(new TextEncoder().encode(JSON.stringify(context.endpointNames)).length).toBeLessThanOrEqual(PREPARATION_VIEWER_LIMITS.equipmentIndexNameBytes);
    const result = await collectPreparationDiscovery(context, io);
    const requests = io.discover.mock.calls.map(([request]) => request).filter(request => request.mode === 'equipment');
    expect(requests.map(request => request.names)).toEqual(groups);
    for (const request of requests) expect(request.indexNames).toEqual(context.endpointNames);
    expect(io.discover.mock.calls.filter(([request]) => request.mode !== 'equipment').every(([request]) => !('indexNames' in request))).toBe(true);
    expect(result.endpointCandidates.map(item => item.name)).toEqual(context.endpointNames);
    expect(result.endpointCandidates.every(item => item.objectIds.join() === 'dbid:9')).toBe(true);
  });
  it('retains the original per-query indexing fallback when the full project-name universe exceeds 32KiB', async () => {
    const { context } = preparationFixture(), io = viewer(); context.trays = [];
    context.endpointNames = Array.from({ length: 400 }, (_, index) => `=${'X'.repeat(100)}${index}`);
    expect(new TextEncoder().encode(JSON.stringify(context.endpointNames)).length).toBeGreaterThan(PREPARATION_VIEWER_LIMITS.equipmentIndexNameBytes);
    const result = await collectPreparationDiscovery(context, io);
    expect(io.discover.mock.calls.every(([request]) => !('indexNames' in request))).toBe(true);
    expect(result.endpointCandidates).toHaveLength(400); expect(result.complete).toBe(true);
  });
  it('counts escaped and multibyte name bytes exactly rather than assuming32 names or UTF16 size',()=>{
    const names=Array.from({length:200},(_,index)=>`界${'"\\'.repeat(30)}${index}`),groups=preparationEquipmentNameBatches(names);
    expect(groups.flat()).toEqual(names);expect(groups.length).toBeGreaterThan(1);
    for(const group of groups)expect(new TextEncoder().encode(JSON.stringify(group)).length).toBeLessThanOrEqual(8192);
    expect(()=>preparationEquipmentNameBatches(['X'.repeat(257)])).toThrow('protected discovery limits');
    expect(()=>preparationEquipmentNameBatches(['DUPLICATE','DUPLICATE'])).toThrow('exact discovery scope');
  });
  it('refuses a display visibility mutation between pages instead of publishing stale uniqueness',async()=>{
    const {context}=preparationFixture(),io=viewer(),original=io.discover.getMockImplementation()!;let pages=0;
    io.discover.mockImplementation(async request=>{const page=await original(request);return ++pages===2?{...page,visibilityScope:{...visibilityScope,contentSha256:'b'.repeat(64)}}:page;});
    await expect(collectPreparationDiscovery(context,io)).rejects.toThrow('visibility changed');
  });
  it('refuses a page without v3 visibility evidence, even if it claims complete property coverage',async()=>{
    const {context}=preparationFixture(),io=viewer(),original=io.discover.getMockImplementation()!;
    io.discover.mockImplementation(async request=>{const page=await original(request);delete(page as Partial<PreparationDiscoveryPage>).visibilityScope;return page;});
    await expect(collectPreparationDiscovery(context,io)).rejects.toThrow('inconsistent discovery coverage');
  });
  it.each([false, true])(
    'queries exact raw and authoritative route alternatives and retains ambiguity=%s',
    async (both) => {
      const { context } = preparationFixture();
      context.trays[0] = { ...context.trays[0], rawName: 'R-010', routeName: '/R-010' };
      const records = [
        {
          objectId: 4,
          parentId: null,
          name: '/R-010',
          hasGeometry: true,
          isPhysicalLeaf: true,
          orderIndex: 0,
        },
        ...(both
          ? [
              {
                objectId: 3,
                parentId: null,
                name: 'R-010',
                hasGeometry: true,
                isPhysicalLeaf: true,
                orderIndex: 1,
              },
            ]
          : []),
        {
          objectId: 8,
          parentId: null,
          name: '/r-010',
          hasGeometry: true,
          isPhysicalLeaf: true,
          orderIndex: 2,
        },
        {
          objectId: 9,
          parentId: null,
          name: '/R010',
          hasGeometry: true,
          isPhysicalLeaf: true,
          orderIndex: 3,
        },
      ];
      const discover = vi.fn(
        async (request: PreparationDiscoveryRequest): Promise<PreparationDiscoveryPage> => ({
          schemaVersion: 'wfc.pf.viewer-discovery.v1',
          mode: request.mode,
          names: request.names,
          rootObjectId: request.rootObjectId,
          ...(request.rootObjectIds ? { rootObjectIds: [...request.rootObjectIds] } : {}),
          cursor: request.cursor,
          matchingPolicyVersion: PREPARATION_MATCHING_POLICY,
          visibilityScope,
          indexedObjectCount: records.length,
          propertyScan: null,
          objects: records
            .filter((record) =>
              request.mode === 'names'
                ? request.names.includes(record.name)
                : request.rootObjectIds?.includes(record.objectId) ?? record.objectId === request.rootObjectId,
            )
            .map((record) => ({
              ...record,
              matchedNames: request.mode === 'names' ? [record.name] : [],
            })),
          nextCursor: null,
          complete: true,
        }),
      );
      const result = await collectPreparationDiscovery(context, {
        discover,
        assertCurrent: () => {},
        capture: vi.fn(),
        captureBarriers: vi.fn(),
        publishBarriers: vi.fn(),
        readSelection: vi.fn(),
        readTrayRootSelection: vi.fn(),
      });
      expect(discover).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'names', names: ['R-010', '/R-010'] }),
      );
      expect(result.trays[0].candidateRootObjectIds).toEqual(
        both ? ['dbid:4', 'dbid:3'] : ['dbid:4'],
      );
      expect(result.objects.map((record) => record.objectId)).not.toContain('dbid:8');
      expect(result.objects.map((record) => record.objectId)).not.toContain('dbid:9');
    },
  );
  it('does not expand saved manual roots from another model or routing scope', async () => {
    const { context } = preparationFixture(),
      io = viewer();
    context.resolutions = [
      {
        id: ids.session,
        projectTrayId: ids.tray,
        mode: 'roots',
        rootObjectIds: ['dbid:999'],
        reason: 'Previous model decision',
        actorId: ids.actor,
        createdAt: '2026-10-19T00:00:00Z',
        scope: { ...context.scope, selectionRevision: '0' },
      },
    ];
    await collectPreparationDiscovery(context, io);
    expect(io.discover).not.toHaveBeenCalledWith(expect.objectContaining({ rootObjectId: 999 }));
  });
  it('discovers current manually assigned roots with different names without relabeling them as automatic candidates', async () => {
    const { context } = preparationFixture(), io = viewer();
    context.scope.resolutionRevision = '2';
    context.resolutions = [{ id: ids.session, projectTrayId: ids.tray, mode: 'roots', rootObjectIds: ['dbid:4'],
      reason: 'Explicit physical assignment', actorId: ids.actor, createdAt: '2026-10-26T00:00:00Z',
      scope: { ...context.scope, resolutionRevision: '0' } }];
    const discover = io.discover.getMockImplementation()!;
    io.discover.mockImplementation(async request => {
      const page = await discover(request);
      return request.mode === 'subtrees' && request.rootObjectIds?.includes(4) ? { ...page, objects: [...page.objects,
        { objectId: 4, parentId: 1, name: 'Different physical tray name', orderIndex: 3, hasGeometry: false, isPhysicalLeaf: false, matchedNames: [] },
        { objectId: 5, parentId: 4, name: 'STRAIGHT', orderIndex: 4, hasGeometry: true, isPhysicalLeaf: true, matchedNames: [] },
      ] } : page;
    });
    const result = await collectPreparationDiscovery(context, io);
    expect(io.discover).toHaveBeenCalledWith(expect.objectContaining({ mode: 'subtrees', rootObjectIds: [1, 3, 4] }));
    expect(result.objects).toEqual(expect.arrayContaining([expect.objectContaining({ objectId: 'dbid:4', name: 'Different physical tray name' }),
      expect.objectContaining({ objectId: 'dbid:5', parentId: 'dbid:4' })]));
    expect(result.trays[0].candidateRootObjectIds).toEqual(['dbid:1', 'dbid:3']);
    expect(result.complete).toBe(true);
  });
  it('retains a verified tray assignment after only the From/To location registry and resolution revisions advance', async () => {
    const { context } = preparationFixture(), io = viewer(), original = io.discover.getMockImplementation()!;
    context.resolutions = [{ id: ids.session, projectTrayId: ids.tray, mode: 'roots', rootObjectIds: ['dbid:4'],
      reason: 'Physical tray assignment', actorId: ids.actor, createdAt: '2026-10-27T00:00:00Z', scope: { ...context.scope } }];
    context.scope = { ...context.scope, locationRegistryRevision: '48', resolutionRevision: '5' };
    io.discover.mockImplementation(async request => {
      const page = await original(request);
      return request.mode === 'subtrees' && request.rootObjectIds?.includes(4) ? { ...page,
        objects: [...page.objects, { objectId: 4, parentId: null, name: 'Assigned physical tray', orderIndex: 3,
          hasGeometry: true, isPhysicalLeaf: true, matchedNames: [] }] } : page;
    });
    await collectPreparationDiscovery(context, io);
    expect(io.discover).toHaveBeenCalledWith(expect.objectContaining({ mode: 'subtrees', rootObjectIds: [1, 3, 4] }));
  });
  it('retains every paged exact candidate and stable global order without authoring masks', async () => {
    const { context } = preparationFixture(),
      io = viewer();
    const result = await collectPreparationDiscovery(context, io);
    expect(result.trays).toEqual([
      { projectTrayId: ids.tray, candidateRootObjectIds: ['dbid:1', 'dbid:3'] },
    ]);
    expect(result.objects.map((value) => value.objectId)).toEqual(['dbid:1', 'dbid:2', 'dbid:3']);
    expect(result.complete).toBe(true);
    expect(result.objects[0]).not.toHaveProperty('allowedCategories');
  });
  it('refuses inconsistent repeated records instead of selecting one copy', async () => {
    const { context } = preparationFixture();
    await expect(
      collectPreparationDiscovery(context, viewer({ conflicting: true })),
    ).rejects.toThrow('inventory changed');
  });
  it('uses property-only endpoint matches and narrow ancestor closure, while preserving incomplete property evidence', async () => {
    const { context } = preparationFixture();
    context.endpointNames = ['EQ-01'];
    const io = viewer({ incomplete: true });
    const result = await collectPreparationDiscovery(context, io);
    expect(result.endpointCandidates).toEqual([{ name: 'EQ-01', objectIds: ['dbid:9'] }]);
    expect(result.complete).toBe(false);
    expect(result.propertyScan?.omittedObjectCount).toBe(1);
    expect(result.objects.some((value) => value.objectId === 'dbid:8')).toBe(true);
    expect(io.discover).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'ancestors', rootObjectId: 9 }),
    );
  });
  it('refuses stalled continuation and late scope changes', async () => {
    const { context } = preparationFixture(),
      io = viewer();
    io.discover.mockImplementationOnce(async (request) => ({
      schemaVersion: 'wfc.pf.viewer-discovery.v1',
      mode: request.mode,
      names: request.names,
      rootObjectId: null,
      cursor: 0,
      matchingPolicyVersion: PREPARATION_MATCHING_POLICY,
      visibilityScope,
      indexedObjectCount: 10,
      propertyScan: null,
      objects: [],
      nextCursor: 0,
      complete: false,
    }));
    await expect(collectPreparationDiscovery(context, io)).rejects.toThrow('inconsistent');
    const stale = viewer();
    stale.assertCurrent = () => {
      throw new DOMException('Changed', 'AbortError');
    };
    await expect(collectPreparationDiscovery(context, stale)).rejects.toThrow('Changed');
  });
});
