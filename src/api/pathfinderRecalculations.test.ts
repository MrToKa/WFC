import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecalculationContext, sendRecalculationCommand } from './pathfinderRecalculations';
import { recalculationFixture, recalculationIds as ids } from '@/test/recalculationFixtures';
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown) => new Response(JSON.stringify(body));
describe('fixed recalculation transport', () => {
  it('uses only the fixed paths and preserves exact command identity without adding authority fields', async () => {
    const f = recalculationFixture(); vi.mocked(fetch).mockResolvedValueOnce(response(f.context)).mockResolvedValueOnce(response(f.receipt));
    await expect(fetchRecalculationContext(ids.project, 'token')).resolves.toEqual(f.context);
    await expect(sendRecalculationCommand(ids.project, 'token', f.command)).resolves.toEqual(f.receipt);
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining(`/projects/${ids.project}/pathfinder/recalculations/context`), expect.objectContaining({ method: 'GET', cache: 'no-store' }));
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/recalculations/commands'), expect.objectContaining({ method: 'POST', body: JSON.stringify(f.command) }));
  });
  it('refuses cross-project and duplicate JSON responses', async () => {
    const f = recalculationFixture(); vi.mocked(fetch).mockResolvedValueOnce(response({ ...f.context, projectId: ids.actor })).mockResolvedValueOnce(new Response('{"schemaVersion":"a","schemaVersion":"b"}'));
    await expect(fetchRecalculationContext(ids.project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fetchRecalculationContext(ids.project, 'token')).rejects.toMatchObject({ outcome: 'unknown' });
  });
  it('rejects malformed identities before network and retains typed server uncertainty', async () => {
    await expect(fetchRecalculationContext(ids.project + '\n', 'token')).rejects.toMatchObject({ outcome: 'refused' }); expect(fetch).not.toHaveBeenCalled();
    const f = recalculationFixture(); vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 'wfc.pf.recalculation-error.v1', code: 'COMMIT_OUTCOME_UNKNOWN', message: 'Reconcile the same command.', outcome: 'unknown', currentControlRevision: null }), { status: 503 }));
    await expect(sendRecalculationCommand(ids.project, 'token', f.command)).rejects.toMatchObject({ outcome: 'unknown', status: 503 });
  });
});
