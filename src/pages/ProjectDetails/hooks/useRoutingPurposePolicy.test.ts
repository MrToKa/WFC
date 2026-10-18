import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoutingPurposePolicy } from './useRoutingPurposePolicy';
import * as api from '@/api/pathfinderPolicies';
vi.mock('@/api/pathfinderPolicies', async () => ({ ...await vi.importActual<typeof api>('@/api/pathfinderPolicies'), fetchRoutingPurposeCatalog: vi.fn(), fetchRoutingPurposePolicy: vi.fn(), fetchRoutingPurposeHistory: vi.fn(), saveRoutingPurposePolicy: vi.fn() }));
const projectId = '11111111-1111-1111-1111-111111111111';
const scope = { projectId, loadedProjectId: projectId, token: 'login-one', isAdmin: true };
const catalog = { projectId, catalogRevision: '1', rowCount: 2, diagnostics: [], rows: [{ purposeKey: 'Custom Ω' }, { purposeKey: 'Custom Ω' }] } as unknown as api.CatalogEnvelope;
const policy = { schemaVersion: 'pathfinder.routing-purpose-policy.v1', projectId, catalogRevision: '1', routingPolicyRevision: '0', rules: [] } as api.RoutingPurposePolicy;
const history = { schemaVersion: 'pathfinder.policy-history.v1', projectId, domain: 'routing', events: [], nextBeforeRevision: null } as api.PolicyHistory;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.fetchRoutingPurposeCatalog).mockResolvedValue(catalog); vi.mocked(api.fetchRoutingPurposePolicy).mockResolvedValue(policy); vi.mocked(api.fetchRoutingPurposeHistory).mockResolvedValue(history); });
async function ready() { const hook = renderHook(() => useRoutingPurposePolicy(scope)); await waitFor(() => expect(hook.result.current.canEdit).toBe(true)); return hook; }
describe('routing purpose policy lifecycle', () => {
  it('uses actual purposes and distinguishes absent, empty and reset without defaults', async () => {
    const hook = await ready();
    expect(hook.result.current.rows[0]).toMatchObject({ purposeKey: 'Custom Ω', trayCount: 2, configured: false, categories: [] });
    act(() => hook.result.current.exclude('Custom Ω'));
    expect(hook.result.current.rows[0]).toMatchObject({ configured: true, categories: [], dirty: true });
    act(() => hook.result.current.reset('Custom Ω'));
    expect(hook.result.current.dirty).toBe(false);
  });
  it('keeps drawing diagnostics visible while allowing the affected purpose to be saved', async () => {
    vi.mocked(api.fetchRoutingPurposeCatalog).mockResolvedValue({ ...catalog, diagnostics: [{ code: 'INVALID_DIMENSION', projectTrayIds: ['tray-one'], message: 'A drawing dimension is invalid.' }],
      rows: [{ projectTrayId: 'tray-one', purposeKey: 'Custom Ω', rawPurpose: 'Custom Ω' }] } as api.CatalogEnvelope);
    const hook = await ready();
    expect(hook.result.current.snapshot?.catalog.diagnostics).toHaveLength(1);
    expect(hook.result.current.rows[0].blocked).toBe(false);
    act(() => hook.result.current.exclude('Custom Ω'));
    expect(hook.result.current.canSave).toBe(true);
    vi.mocked(api.saveRoutingPurposePolicy).mockResolvedValue({ duplicate: false } as api.PolicySaveReceipt);
    await act(() => hook.result.current.save());
    expect(vi.mocked(api.saveRoutingPurposePolicy).mock.calls[0][2].changes).toEqual([{ purposeKey: 'Custom Ω', operation: 'set', allowedCategories: [] }]);
  });
  it('blocks only missing, invalid or colliding purposes and saves clean purposes alone', async () => {
    vi.mocked(api.fetchRoutingPurposeCatalog).mockResolvedValue({ ...catalog, diagnostics: [{ code: 'TRAY_NAME_COLLISION', projectTrayIds: ['bad-one'], message: 'Duplicate tray name.' }],
      rows: [{ projectTrayId: 'bad-one', purposeKey: 'Blocked', rawPurpose: 'Blocked' }, { projectTrayId: 'clean-one', purposeKey: 'Clean', rawPurpose: 'Clean' },
        { projectTrayId: 'missing', purposeKey: null, rawPurpose: null }, { projectTrayId: 'invalid', purposeKey: ' Invalid ', rawPurpose: ' Invalid ' }] } as api.CatalogEnvelope);
    const hook = await ready();
    expect(hook.result.current.rows.filter(row => row.blocked).map(row => row.purposeKey)).toEqual([' Invalid ', 'Blocked', null]);
    act(() => { hook.result.current.toggle('Blocked', 'MV', true); hook.result.current.exclude(' Invalid '); hook.result.current.toggle('Detached', 'LV', true); });
    expect(hook.result.current.dirty).toBe(false);
    act(() => hook.result.current.toggle('Clean', 'Control', true));
    expect(hook.result.current.canSave).toBe(true);
    vi.mocked(api.saveRoutingPurposePolicy).mockResolvedValue({ duplicate: false } as api.PolicySaveReceipt);
    await act(() => hook.result.current.save());
    expect(vi.mocked(api.saveRoutingPurposePolicy).mock.calls[0][2].changes).toEqual([{ purposeKey: 'Clean', operation: 'set', allowedCategories: ['Control'] }]);
  });
  it('freezes an unknown save and retries the same body and idempotency key, then refreshes a historical receipt', async () => {
    const hook = await ready();
    vi.mocked(api.saveRoutingPurposePolicy).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ duplicate: true } as api.PolicySaveReceipt);
    act(() => hook.result.current.toggle('Custom Ω', 'MV', true));
    await act(() => hook.result.current.save());
    expect(hook.result.current.uncertain).toBe(true); expect(hook.result.current.canEdit).toBe(false);
    const first = vi.mocked(api.saveRoutingPurposePolicy).mock.calls[0][2];
    act(() => hook.result.current.toggle('Custom Ω', 'LV', true));
    await act(() => hook.result.current.refresh(true));
    expect(api.fetchRoutingPurposePolicy).toHaveBeenCalledTimes(1);
    await act(() => hook.result.current.retrySave());
    expect(vi.mocked(api.saveRoutingPurposePolicy).mock.calls[1][2]).toBe(first);
    expect(first.changes).toEqual([{ purposeKey: 'Custom Ω', operation: 'set', allowedCategories: ['MV'] }]);
    expect(api.fetchRoutingPurposePolicy).toHaveBeenCalledTimes(2);
    expect(api.fetchRoutingPurposeHistory).toHaveBeenCalledTimes(2);
  });
  it('requires explicit discard after a concurrency conflict', async () => {
    const hook = await ready(); vi.mocked(api.saveRoutingPurposePolicy).mockRejectedValueOnce(new api.PathFinderPolicyApiError('STALE_REVISION', 409, 'Changed', true));
    act(() => hook.result.current.exclude('Custom Ω')); await act(() => hook.result.current.save());
    expect(hook.result.current.conflict).toBeTruthy(); expect(hook.result.current.canSave).toBe(false);
    await act(() => hook.result.current.refresh()); expect(hook.result.current.refreshPrompt).toBe(true);
    await act(() => hook.result.current.refresh(true)); expect(hook.result.current.dirty).toBe(false); expect(hook.result.current.conflict).toBeNull();
  });
  it('discards old responses and dirty state across token, loaded identity and role changes', async () => {
    let resolve!: (value: api.CatalogEnvelope) => void;
    vi.mocked(api.fetchRoutingPurposeCatalog).mockReturnValueOnce(new Promise(value => { resolve = value; }));
    const hook = renderHook(props => useRoutingPurposePolicy(props), { initialProps: scope });
    hook.rerender({ ...scope, token: 'login-two', isAdmin: false });
    await act(async () => { resolve(catalog); });
    expect(hook.result.current.snapshot).toBeNull(); expect(hook.result.current.canEdit).toBe(false);
    hook.rerender({ ...scope, loadedProjectId: '22222222-2222-2222-2222-222222222222' });
    expect(hook.result.current.snapshot).toBeNull(); expect(api.fetchRoutingPurposePolicy).toHaveBeenCalledTimes(1);
    hook.rerender({ ...scope, token: 'login-three' }); await waitFor(() => expect(hook.result.current.canEdit).toBe(true));
    act(() => hook.result.current.exclude('Custom Ω')); hook.rerender({ ...scope, token: 'login-four' });
    expect(hook.result.current.dirty).toBe(false);
    await waitFor(() => expect(hook.result.current.canEdit).toBe(true));
  });
});
