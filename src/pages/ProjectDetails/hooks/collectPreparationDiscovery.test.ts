import { describe, expect, it, vi } from 'vitest';
import { collectPreparationDiscovery } from './collectPreparationDiscovery';
import { preparationFixture, preparationIds as ids } from '../../../test/preparationFixtures';
import type { ProjectPreparationViewer } from './usePathFinder';
import type {
  PreparationDiscoveryPage,
  PreparationDiscoveryRequest,
} from '../../../../viewer-runtime/preparation-input.mjs';
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
      } else if (request.mode === 'subtree')
        objects =
          request.rootObjectId === 1
            ? [
                object(1, null, options.conflicting ? 'Changed' : 'Tray 01', 0),
                object(2, 1, 'Leaf', 1, true),
              ]
            : [object(3, null, 'Tray 01', 2, true)];
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
        cursor: request.cursor,
        matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v2',
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
    readSelection: vi.fn(),
  } as ProjectPreparationViewer & {
    discover: typeof discover;
  };
}
describe('complete exact preparation discovery', () => {
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
          cursor: request.cursor,
          matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v2',
          indexedObjectCount: records.length,
          propertyScan: null,
          objects: records
            .filter((record) =>
              request.mode === 'names'
                ? request.names.includes(record.name)
                : record.objectId === request.rootObjectId,
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
        readSelection: vi.fn(),
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
      matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v2',
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
