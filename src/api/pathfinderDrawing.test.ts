import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDrawingPurposePolicy, fetchDrawingPurposeHistory, saveDrawingPurposePolicy, DEFAULT_DRAWING_MODES } from './pathfinderDrawing';
const id = '11111111-1111-1111-1111-111111111111';
afterEach(() => vi.unstubAllGlobals());
describe('strict drawing positioning transport', () => {
  it('rejects noncanonical scope/revision and unknown/missing category keys before fetch', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(fetchDrawingPurposePolicy(id + '\n', 'login')).rejects.toThrow();
    await expect(fetchDrawingPurposeHistory(id, 'login', '1\n')).rejects.toThrow();
    const body = { schemaVersion: 'pathfinder.drawing-purpose-policy.write.v1', expectedCatalogRevision: '1', expectedRevision: '0', idempotencyKey: id, changes: [{ purposeKey: 'Synthetic', categoryModes: { ...DEFAULT_DRAWING_MODES, unknown: 'left' } }] };
    await expect(saveDrawingPurposePolicy(id, 'login', body as never)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects escaped duplicates and cross-project responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"x":1,"\\u0078":2}')).mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 'pathfinder.drawing-purpose-policy.v1', projectId: '22222222-2222-2222-2222-222222222222', catalogRevision: '1', drawingPolicyRevision: '0', rules: [] }))));
    await expect(fetchDrawingPurposePolicy(id, 'login')).rejects.toThrow(); await expect(fetchDrawingPurposePolicy(id, 'login')).rejects.toThrow();
  });
  it('uses the fixed endpoint and exact four-mode request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ schemaVersion: 'pathfinder.policy-save.v1', projectId: id, domain: 'drawing', catalogRevision: '1', previousRevision: '0', revision: '1', auditId: id, duplicate: false })));
    vi.stubGlobal('fetch', fetch);
    const body = { schemaVersion: 'pathfinder.drawing-purpose-policy.write.v1' as const, expectedCatalogRevision: '1', expectedRevision: '0', idempotencyKey: id, changes: [{ purposeKey: 'Synthetic', categoryModes: { ...DEFAULT_DRAWING_MODES, mv: 'left' as const } }] };
    await saveDrawingPurposePolicy(id, 'login', body);
    expect(fetch.mock.calls[0][0]).toMatch(new RegExp(`/api/projects/${id}/pathfinder/drawing-positioning$`));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
  });
});
