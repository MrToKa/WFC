import { webcrypto, createHash } from 'node:crypto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { requalifyStaleCableEndpoints, hasPendingEndpointRequalification } from './pathfinderEndpointRequalification';
import { fetchCableEndpointContext } from './pathfinderCableEndpoints';
import { modelMatchContext } from '@/test/modelLocationMatchFixtures';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy';
vi.mock('./pathfinderCableEndpoints', () => ({ fetchCableEndpointContext: vi.fn() }));
const scope = modelMatchContext().current, projectId = modelMatchContext().projectId, cableId = 'aaa00000-0000-4000-8000-000000000001';
const model = { modelVersionId: scope.modelVersionId, contentFingerprint: scope.contentFingerprint, selectionRevision: scope.selectionRevision };
const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); vi.mocked(fetchCableEndpointContext).mockResolvedValue({ current: scope, head: { mode: 'fixed-world', status: 'confirmed', modelVersionId: scope.modelVersionId } } as Awaited<ReturnType<typeof fetchCableEndpointContext>>); });
afterEach(() => vi.unstubAllGlobals());
function receipt(_url: string, options: RequestInit) { const command = JSON.parse(options.body as string); return new Response(JSON.stringify({ schemaVersion: 'wfc.pf.endpoint-requalify-receipt.v1', projectId, cableId, idempotencyKey: command.idempotencyKey, commandSha256: createHash('sha256').update(canonicalPurposeJson(command)).digest('hex'), updatedLocationIds: [], duplicate: false })); }
it('verifies a receipt and clears only the exact retained command', async () => {
 fetchMock.mockImplementation(receipt);
 expect(await requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).toBe(true);
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId)).toBe(false); expect(fetchMock).toHaveBeenCalledOnce();
});
it('retains an unknown write and retries the identical key and body without reading model locations again', async () => {
 fetchMock.mockRejectedValueOnce(new TypeError('Lost ACK')).mockImplementation(receipt);
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).rejects.toThrow();
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId)).toBe(true);
 await requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal);
 expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body); expect(fetchCableEndpointContext).toHaveBeenCalledTimes(2);
});
it('does not replay another login or another model pending command', async () => {
 fetchMock.mockRejectedValueOnce(new TypeError('Lost ACK'));
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).rejects.toThrow();
 expect(await hasPendingEndpointRequalification(projectId, 'other-login', cableId)).toBe(false);
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, { ...model, selectionRevision: '999' }, new AbortController().signal)).rejects.toThrow();
 expect(fetchMock).toHaveBeenCalledOnce(); expect(await hasPendingEndpointRequalification(projectId, 'token', cableId)).toBe(true);
});
it('rejects a mismatched receipt without dropping the exact pending verification', async () => {
 fetchMock.mockImplementation(async (url, options) => { const r = await receipt(url, options).json(); return new Response(JSON.stringify({ ...r, cableId: scope.modelVersionId })); });
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).rejects.toThrow();
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId)).toBe(true);
});
it('releases a retained command only after the serialized context fence confirms refusal', async () => {
 fetchMock.mockRejectedValueOnce(new TypeError('Lost ACK'));
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).rejects.toThrow();
 fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'ENDPOINT_REQUALIFICATION_CONTEXT_CHANGED', outcome: 'refused' }), { status: 409 }));
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).rejects.toThrow();
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId)).toBe(false);
 expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
});
