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
it.each(['fixed-world', 'object-derived'] as const)('verifies a %s receipt and clears only the exact retained command', async mode => {
 vi.mocked(fetchCableEndpointContext).mockResolvedValue({ current: scope, head: { mode, status: 'confirmed', modelVersionId: scope.modelVersionId } } as Awaited<ReturnType<typeof fetchCableEndpointContext>>);
 fetchMock.mockImplementation(receipt);
 expect(await requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).toBe(true);
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId, model)).toBe(false); expect(fetchMock).toHaveBeenCalledOnce();
});
it('retains an unknown write and retries the identical key and body without reading model locations again', async () => {
 fetchMock.mockRejectedValueOnce(new TypeError('Lost ACK')).mockImplementation(receipt);
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).rejects.toThrow();
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId, model)).toBe(true);
 await requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal);
 expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body); expect(fetchCableEndpointContext).toHaveBeenCalledTimes(2);
});
it('does not replay another login or another model pending command', async () => {
 fetchMock.mockRejectedValueOnce(new TypeError('Lost ACK'));
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).rejects.toThrow();
 expect(await hasPendingEndpointRequalification(projectId, 'other-login', cableId, model)).toBe(false);
 const nextScope = { ...scope, selectionRevision: '999' }, nextModel = { ...model, selectionRevision: '999' };
 const firstKey = sessionStorage.key(0)!, firstBody = sessionStorage.getItem(firstKey)!;
 const legacyKey = firstKey.split(':').slice(0, 4).join(':');
 sessionStorage.setItem(legacyKey, firstBody); sessionStorage.removeItem(firstKey);
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId, nextModel)).toBe(false);
 vi.mocked(fetchCableEndpointContext).mockResolvedValue({ current: nextScope, head: { mode: 'fixed-world', status: 'confirmed', modelVersionId: scope.modelVersionId } } as Awaited<ReturnType<typeof fetchCableEndpointContext>>);
 fetchMock.mockImplementation(receipt);
 expect(await requalifyStaleCableEndpoints(projectId, 'token', cableId, nextModel, new AbortController().signal)).toBe(true);
 expect(JSON.parse(fetchMock.mock.calls[1][1].body).expectedCurrent).toEqual(nextScope);
 expect(JSON.parse(fetchMock.mock.calls[1][1].body).idempotencyKey).not.toBe(JSON.parse(firstBody).idempotencyKey);
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId, nextModel)).toBe(false);
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId, model)).toBe(true);
 await requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal);
 expect(fetchMock.mock.calls[2][1].body).toBe(fetchMock.mock.calls[0][1].body);
 expect(sessionStorage.getItem(legacyKey)).toBeNull();
});
it('rejects a mismatched receipt without dropping the exact pending verification', async () => {
 fetchMock.mockImplementation(async (url, options) => { const r = await receipt(url, options).json(); return new Response(JSON.stringify({ ...r, cableId: scope.modelVersionId })); });
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).rejects.toThrow();
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId, model)).toBe(true);
});
it.each(['ENDPOINT_REQUALIFICATION_CONTEXT_CHANGED', 'ENDPOINT_REQUALIFICATION_UNAVAILABLE', 'ENDPOINT_OBJECT_SCOPE'])('releases the retained command after a definitive %s refusal', async code => {
 fetchMock.mockRejectedValueOnce(new TypeError('Lost ACK'));
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).rejects.toThrow();
 fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 'wfc.pf.endpoint-binding-error.v1', code, message: 'The endpoint could not be verified.', outcome: 'refused' }), { status: 409 }));
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).rejects.toThrow();
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId, model)).toBe(false);
 expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
});

it.each([
 { code: 'ENDPOINT_REQUALIFICATION_RECEIPT_INVALID', outcome: 'refused', status: 409 },
 { code: 'ENDPOINT_REQUALIFICATION_UNAVAILABLE', outcome: 'unknown', status: 500 },
])('retains unresolved outcomes ($code)', async ({ code, outcome, status }) => {
 fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 'wfc.pf.endpoint-binding-error.v1', code, message: 'Unconfirmed.', outcome }), { status }));
 await expect(requalifyStaleCableEndpoints(projectId, 'token', cableId, model, new AbortController().signal)).rejects.toThrow();
 expect(await hasPendingEndpointRequalification(projectId, 'token', cableId, model)).toBe(true);
});
