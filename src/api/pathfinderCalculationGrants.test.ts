import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCalculationGrantContext, sendCalculationGrantCommand } from './pathfinderCalculationGrants';
import { calculationGrantFixture, calculationGrantIds as ids } from '@/test/calculationGrantFixtures';

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const barrierIntent=(drillThroughWalls=false)=>{const scope={projectId:ids.project,modelVersionId:ids.grant,contentFingerprint:'a'.repeat(64),selectionRevision:'3',captureFrameId:ids.key,captureFrameSha256:'b'.repeat(64),coordinateFrame:'canonical-world-metres' as const};return{schemaVersion:'wfc.pf.barrier-admission-intent.v1' as const,scope,expectedRegistryRevision:'4',expectedSnapshot:{snapshotId:ids.installation,scope,registryRevision:'4',contentSha256:'c'.repeat(64),mode:'explicit-empty' as const},drillThroughWalls};};
describe('fixed calculation-grant transport', () => {
  it('preserves the full no-drilling barrier choice through enable JSON and retained grant responses',async()=>{
    const f=calculationGrantFixture();if(f.command.action!=='enable')throw Error('Enable fixture required');
    const barrierRouting=barrierIntent(),preferences={...f.command.preferences,barrierRouting},command={...f.command,preferences};
    const context={...f.enabled,grant:{...f.enabled.grant!,preferences}},receipt={...f.receipt,context};
    vi.mocked(fetch).mockResolvedValueOnce(response(receipt)).mockResolvedValueOnce(response(context));
    await expect(sendCalculationGrantCommand(ids.project,'token',command)).resolves.toEqual(receipt);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).preferences.barrierRouting).toEqual(barrierRouting);
    await expect(fetchCalculationGrantContext(ids.project,'token')).resolves.toEqual(context);
  });
  it('refuses drilling, malformed, null and foreign-project barrier command intent before transport',async()=>{
    const f=calculationGrantFixture();if(f.command.action!=='enable')throw Error('Enable fixture required');
    const intent=barrierIntent(),scope={...intent.scope,projectId:ids.actor};
    for(const barrierRouting of [barrierIntent(true),null,{...intent,drillThroughWalls:undefined},{...intent,scope,expectedSnapshot:{...intent.expectedSnapshot,scope}}])
      await expect(sendCalculationGrantCommand(ids.project,'token',{...f.command,preferences:{...f.command.preferences,barrierRouting}} as never)).rejects.toMatchObject({code:'INVALID_REQUEST',outcome:'refused'});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses fixed human management routes, exact CAS identity and no producer authority fields', async () => {
    const f = calculationGrantFixture(), signal = new AbortController().signal;
    vi.mocked(fetch).mockResolvedValueOnce(response(f.context)).mockResolvedValueOnce(response(f.receipt));
    await expect(fetchCalculationGrantContext(ids.project, 'token', signal)).resolves.toEqual(f.context);
    await expect(sendCalculationGrantCommand(ids.project, 'token', f.command, signal)).resolves.toEqual(f.receipt);
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining(`/projects/${ids.project}/pathfinder/calculation-grants/context`), expect.objectContaining({ method: 'GET', cache: 'no-store', redirect: 'error', signal }));
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/calculation-grants/commands'), expect.objectContaining({ method: 'POST', body: JSON.stringify(f.command), signal }));
  });
  it('rejects malformed project identity and extra client authority before sending anything', async () => {
    const f = calculationGrantFixture();
    await expect(fetchCalculationGrantContext(ids.project + '\n', 'token')).rejects.toMatchObject({ outcome: 'refused' });
    await expect(sendCalculationGrantCommand(ids.project, 'token', { ...f.command, grantEpoch: '9' } as unknown as typeof f.command)).rejects.toMatchObject({ outcome: 'refused' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects cross-project context/receipt and duplicate JSON keys as uncertain', async () => {
    const f = calculationGrantFixture();
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...f.context, projectId: ids.actor })).mockResolvedValueOnce(response({ ...f.receipt, context: { ...f.enabled, projectId: ids.actor } })).mockResolvedValueOnce(new Response('{"schemaVersion":"a","schemaVersion":"b"}'));
    await expect(fetchCalculationGrantContext(ids.project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'unknown' });
    await expect(sendCalculationGrantCommand(ids.project, 'token', f.command)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'unknown' });
    await expect(fetchCalculationGrantContext(ids.project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('bounds and rejects oversized or invalid UTF-8 responses before accepting authority', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('x'.repeat(1024 ** 2 + 1))).mockResolvedValueOnce(new Response(new Uint8Array([0xc3, 0x28])));
    await expect(fetchCalculationGrantContext(ids.project, 'token')).rejects.toMatchObject({ outcome: 'unknown' });
    await expect(fetchCalculationGrantContext(ids.project, 'token')).rejects.toMatchObject({ outcome: 'unknown' });
  });
  it.each([{ status: 503, outcome: 'unknown' }, { status: 409, outcome: 'refused' }])('retains typed $outcome outcomes instead of claiming save success', async ({ status, outcome }) => {
    const f = calculationGrantFixture();
    vi.mocked(fetch).mockResolvedValueOnce(response({ schemaVersion: 'wfc.pf.calculation-grant-error.v1', code: 'GRANT_COMMAND_RECONCILIATION_REQUIRED', message: 'Refresh the project and reconcile this command.', outcome, currentControlRevision: null }, status));
    await expect(sendCalculationGrantCommand(ids.project, 'token', f.command)).rejects.toMatchObject({ status, outcome });
  });
});
