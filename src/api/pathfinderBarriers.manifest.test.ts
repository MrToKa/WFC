import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { getBarrierSnapshot } from './pathfinderBarriers';
import { barrierCanonicalJson, barrierSnapshotHashInput, type BarrierSnapshot } from '../../shared/pathfinderBarriers';

const id = (n: number) => `b5500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function manifest(): Promise<BarrierSnapshot> {
  const value: BarrierSnapshot = { schemaVersion: 'wfc.pf.barrier-snapshot.v1', snapshotId: id(4),
    scope: { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1',
      captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' },
    registryRevision: '1', contentSha256: '0'.repeat(64), selectedParents: [], capture: null,
    geometry: { mode: 'explicit-empty', declarationId: id(5), declaration: 'administrator-declared-no-selected-barriers', reason: 'Synthetic explicit scope' },
    coverage: 'registered-selected-objects-only', engineeringAccepted: false };
  value.contentSha256 = [...new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(barrierCanonicalJson(barrierSnapshotHashInput(value)))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  return value;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('reads an exact immutable manifest using normal login and validates its content digest', async () => {
  const value = await manifest(), fetcher = vi.fn(async () => Response.json(value)); vi.stubGlobal('fetch', fetcher);
  const result = await getBarrierSnapshot(id(1), 'synthetic-login', id(4));
  expect(result).toEqual(value); expect(result).not.toBe(value);
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/api/projects/${id(1)}/pathfinder/barriers/snapshots/${id(4)}`),
    expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer synthetic-login' } }));
});
it.each(['project', 'snapshot', 'content', 'authority'] as const)('refuses a changed manifest %s instead of inferring readiness', async kind => {
  const value = await manifest();
  if (kind === 'project') value.scope.projectId = id(90);
  if (kind === 'snapshot') value.snapshotId = id(90);
  if (kind === 'content' && value.geometry.mode === 'explicit-empty') value.geometry.reason = 'Changed after hashing';
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(kind === 'authority' ? { ...value, actorId: id(90) } : value)));
  await expect(getBarrierSnapshot(id(1), 'synthetic-login', id(4))).rejects.toThrow();
});
it('fences a cancelled manifest read even if a late response ignores its abort signal', async () => {
  const value = await manifest(), controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); return Response.json(value); }));
  await expect(getBarrierSnapshot(id(1), 'synthetic-login', id(4), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
