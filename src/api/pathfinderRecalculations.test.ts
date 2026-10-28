import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecalculationContext, sendRecalculationCommand } from './pathfinderRecalculations';
import { recalculationFixture, recalculationIds as ids } from '@/test/recalculationFixtures';
import { AUTOMATIC_PAIR_POLICY } from '../../shared/pathfinderAutomaticPair';
import { recalculationCommandSchema } from '../../shared/pathfinderRecalculation';
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown) => new Response(JSON.stringify(body));
describe('fixed recalculation transport', () => {
  it.each(['resume', 'retry'] as const)('preserves required output intent in a v2 %s and rejects a proposal-only acknowledgement', async action => {
    const f = recalculationFixture(), command = recalculationCommandSchema.parse({ schemaVersion: 'wfc.pf.recalculation-command.v2', action,
      expectedControlRevision: '4', idempotencyKey: ids.key, reason: 'Continue original output permission.', automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } });
    const receipt = { ...f.receipt, context: { ...f.receipt.context, automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } } };
    vi.mocked(fetch).mockResolvedValueOnce(response(receipt)).mockResolvedValueOnce(response(f.receipt));
    await expect(sendRecalculationCommand(ids.project, 'token', command)).resolves.toEqual(receipt);
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/recalculations/commands'), expect.objectContaining({ body: JSON.stringify(command) }));
    await expect(sendRecalculationCommand(ids.project, 'token', command)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'unknown' });
  });
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
  it('sends the explicit output policy on a new enable and retains it in the verified receipt', async () => {
    const f = recalculationFixture(), command = recalculationCommandSchema.parse({ ...f.command, schemaVersion: 'wfc.pf.recalculation-command.v2', automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } });
    const receipt = { ...f.receipt, context: { ...f.receipt.context, automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } } };
    vi.mocked(fetch).mockResolvedValueOnce(response(receipt));
    await expect(sendRecalculationCommand(ids.project, 'token', command)).resolves.toEqual(receipt);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/recalculations/commands'), expect.objectContaining({ method: 'POST', body: JSON.stringify(command) }));
  });
  it('does not confirm automatic Cable list updates when an enable receipt omits the requested output policy', async () => {
    const f = recalculationFixture(), command = recalculationCommandSchema.parse({ ...f.command, schemaVersion: 'wfc.pf.recalculation-command.v2', automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } });
    vi.mocked(fetch).mockResolvedValueOnce(response(f.receipt));
    await expect(sendRecalculationCommand(ids.project, 'token', command)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
