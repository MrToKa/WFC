import { afterEach, expect, it, vi } from 'vitest';
import { beginBarrierCapture, changeBarrierRegistry, getBarrierRegistry } from './pathfinderBarriers';
const id = (n: number) => `b2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1',
  captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
const registry = { schemaVersion: 'wfc.pf.barrier-registry.v1', scope, registryRevision: '0', state: 'unconfigured',
  selectedParents: [], snapshot: null, reasonCodes: ['NO_BARRIER_SCOPE_CONFIGURED'] };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('reads the exact API route with login and detached strict registry shape', async () => {
  const fetcher = vi.fn(async () => Response.json(registry)); vi.stubGlobal('fetch', fetcher);
  expect(await getBarrierRegistry(id(1), 'synthetic-token')).toEqual(registry);
  expect(fetcher.mock.calls[0]).toEqual([expect.stringMatching(new RegExp(`/api/projects/${id(1)}/pathfinder/barriers$`)),
    expect.objectContaining({ credentials: 'same-origin', redirect: 'error', headers: { Authorization: 'Bearer synthetic-token' } })]);
});
it('refuses caller authority fields before sending an empty declaration', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const command = { schemaVersion: 'wfc.pf.barrier-registry-command.v1' as const, action: 'declare-empty' as const,
    scope, expectedRegistryRevision: '0', idempotencyKey: id(4), reason: 'Synthetic scope', actorId: id(9) };
  await expect(changeBarrierRegistry(id(1), 'synthetic-token', command)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it('retains a specific public denial without retrying or accepting a ready-shaped error', async () => {
  const fetcher = vi.fn(async () => Response.json({ code: 'ADMIN_REQUIRED', state: 'ready' }, { status: 403 })); vi.stubGlobal('fetch', fetcher);
  await expect(getBarrierRegistry(id(1), 'synthetic-token')).rejects.toMatchObject({ code: 'ADMIN_REQUIRED', status: 403 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('validates server intent identities and rejects extra authority before a capture can start', async () => {
  const command = { schemaVersion: 'wfc.pf.barrier-capture-command.v1' as const, scope, expectedRegistryRevision: '0', idempotencyKey: id(5),
    selectedParents: [{ selectionId: id(6), kind: 'wall' as const, objectId: 'dbid:7', dbId: 7, externalId: null, name: 'Synthetic wall',
      identityBasis: 'version-local-only' as const, inclusion: 'own-and-all-descendant-fragments' as const }] };
  const fetcher = vi.fn(async () => Response.json({ schemaVersion: 'wfc.pf.barrier-intent-receipt.v1', state: 'pending', duplicate: false,
    intent: { id: id(7), snapshotId: id(8), captureBlobId: id(9), manifestBlobId: id(10), command, createdBy: id(11), loginId: id(12), path: '/caller-path' } }));
  vi.stubGlobal('fetch', fetcher); await expect(beginBarrierCapture(id(1), 'synthetic-token', command)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
