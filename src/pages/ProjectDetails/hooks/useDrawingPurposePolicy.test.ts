import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDrawingPurposePolicy } from './useDrawingPurposePolicy';
import * as api from '@/api/pathfinderDrawing';
import type { CatalogEnvelope } from '../../../../shared/pathfinderPurposePolicy';
vi.mock('@/api/pathfinderDrawing', async () => ({ ...await vi.importActual<typeof api>('@/api/pathfinderDrawing'), fetchDrawingPurposeCatalog: vi.fn(), fetchDrawingPurposePolicy: vi.fn(), fetchDrawingPurposeHistory: vi.fn(), saveDrawingPurposePolicy: vi.fn() }));
const projectId = '11111111-1111-1111-1111-111111111111';
const scope = { projectId, loadedProjectId: projectId, token: 'login-one', isAdmin: true };
const catalog = { projectId, catalogRevision: '1', rowCount: 2, diagnostics: [], rows: [{ projectTrayId: projectId, purposeKey: 'Custom Ω', rawPurpose: 'Custom Ω' }, { projectTrayId: 'second', purposeKey: 'Custom Ω', rawPurpose: 'Custom Ω' }] } as unknown as CatalogEnvelope;
const policy = { schemaVersion: 'pathfinder.drawing-purpose-policy.v1', projectId, catalogRevision: '1', drawingPolicyRevision: '0', rules: [], cablePurposes: ['Control', 'Control special', 'Plastic tubing', 'Power'], cablePurposesSha256: 'a'.repeat(64) } as api.DrawingPurposePolicy;
const history = { schemaVersion: 'pathfinder.policy-history.v1', projectId, domain: 'drawing', events: [], nextBeforeRevision: null } as api.DrawingPolicyHistory;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.fetchDrawingPurposeCatalog).mockResolvedValue(catalog); vi.mocked(api.fetchDrawingPurposePolicy).mockResolvedValue(policy); vi.mocked(api.fetchDrawingPurposeHistory).mockResolvedValue(history); });
async function ready() { const hook = renderHook(() => useDrawingPurposePolicy(scope)); await waitFor(() => expect(hook.result.current.canEdit).toBe(true)); return hook; }
describe('drawing positioning lifecycle', () => {
  it('uses actual purposes and mutually exclusive modes; all-default resets have no authored override', async () => {
    const hook = await ready(); expect(hook.result.current.rows[0]).toMatchObject({ purposeKey: 'Custom Ω', trayCount: 2, configured: false, categoryModes: api.DEFAULT_DRAWING_MODES });
    act(() => hook.result.current.setMode('Custom Ω', 'Plastic tubing', 'left'));
    act(() => hook.result.current.setMode('Custom Ω', 'Plastic tubing', 'right'));
    expect(hook.result.current.rows[0].purposeModes['Plastic tubing']).toBe('right');
    act(() => hook.result.current.reset('Custom Ω')); expect(hook.result.current.dirty).toBe(false);
  });
  it('saves an explicit all-default reset with all four keys', async () => {
    vi.mocked(api.fetchDrawingPurposePolicy).mockResolvedValue({ ...policy, rules: [{ purposeKey: 'Custom Ω', categoryModes: { ...api.DEFAULT_DRAWING_MODES, power: 'left' } }] });
    const hook = await ready(); act(() => hook.result.current.reset('Custom Ω'));
    vi.mocked(api.saveDrawingPurposePolicy).mockResolvedValue({ duplicate: false } as api.DrawingPolicySaveReceipt);
    await act(() => hook.result.current.save());
    expect(vi.mocked(api.saveDrawingPurposePolicy).mock.calls[0][2].changes).toEqual([{ purposeKey: 'Custom Ω', categoryModes: api.DEFAULT_DRAWING_MODES, purposeModes: {} }]);
  });
  it('retries an unknown save with the frozen body/key and refreshes historical duplicate receipts', async () => {
    const hook = await ready(); vi.mocked(api.saveDrawingPurposePolicy).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({ duplicate: true } as api.DrawingPolicySaveReceipt);
    act(() => hook.result.current.setMode('Custom Ω', 'Control', 'left')); await act(() => hook.result.current.save());
    const body = vi.mocked(api.saveDrawingPurposePolicy).mock.calls[0][2]; expect(hook.result.current.canEdit).toBe(false);
    act(() => hook.result.current.setMode('Custom Ω', 'Plastic tubing', 'right')); await act(() => hook.result.current.refresh(true));
    expect(api.fetchDrawingPurposePolicy).toHaveBeenCalledTimes(1); await act(() => hook.result.current.retrySave());
    expect(vi.mocked(api.saveDrawingPurposePolicy).mock.calls[1][2]).toBe(body); expect(body.changes[0].categoryModes.mv).toBe('use-default');
    expect(api.fetchDrawingPurposePolicy).toHaveBeenCalledTimes(2); expect(api.fetchDrawingPurposeHistory).toHaveBeenCalledTimes(2);
  });
  it('requires explicit conflict discard and refuses affected purpose collisions while ignoring tray-name/dimension diagnostics', async () => {
    vi.mocked(api.fetchDrawingPurposeCatalog).mockResolvedValue({ ...catalog, diagnostics: [{ code: 'TRAY_NAME_COLLISION', projectTrayIds: [projectId], message: 'Name issue' }, { code: 'INVALID_DIMENSION', projectTrayIds: [projectId], message: 'Dimension issue' }] });
    const hook = await ready(); expect(hook.result.current.rows[0].blocked).toBe(false);
    vi.mocked(api.saveDrawingPurposePolicy).mockRejectedValueOnce(new api.DrawingPolicyApiError('STALE', 409, 'Changed', true));
    act(() => hook.result.current.setMode('Custom Ω', 'Power', 'right')); await act(() => hook.result.current.save());
    expect(hook.result.current.conflict).toBeTruthy(); await act(() => hook.result.current.refresh()); expect(hook.result.current.refreshPrompt).toBe(true);
    vi.mocked(api.fetchDrawingPurposeCatalog).mockResolvedValue({ ...catalog, diagnostics: [{ code: 'PURPOSE_NORMALIZATION_COLLISION', projectTrayIds: [projectId], message: 'Purpose issue' }] });
    await act(() => hook.result.current.refresh(true)); expect(hook.result.current.rows[0].blocked).toBe(true);
    act(() => hook.result.current.setMode('Custom Ω', 'Plastic tubing', 'left')); expect(hook.result.current.dirty).toBe(false);
  });
  it('preserves legacy modes and independently saves exact purposes with the current purpose hash', async () => {
    vi.mocked(api.fetchDrawingPurposePolicy).mockResolvedValue({ ...policy, rules: [{ purposeKey: 'Custom Ω', categoryModes: { ...api.DEFAULT_DRAWING_MODES, control: 'right' } }] });
    const hook = await ready();
    expect(hook.result.current.rows[0].purposeModes.Control).toBe('right');
    expect(hook.result.current.rows[0].purposeModes['Control special']).toBe('right');
    act(() => hook.result.current.setMode('Custom Ω', 'Control special', 'left'));
    act(() => hook.result.current.setMode('Custom Ω', 'Plastic tubing', 'right'));
    expect(hook.result.current.rows[0].purposeModes.Control).toBe('right');
    expect(hook.result.current.rows[0].purposeModes['Control special']).toBe('left');
    vi.mocked(api.saveDrawingPurposePolicy).mockRejectedValueOnce(new api.DrawingPolicyApiError('CABLE_PURPOSES_CHANGED', 409, 'Purposes changed', true));
    await act(() => hook.result.current.save());
    const body = vi.mocked(api.saveDrawingPurposePolicy).mock.calls[0][2];
    expect(body.expectedCablePurposesSha256).toBe('a'.repeat(64));
    expect(body.changes[0]).toMatchObject({ categoryModes: { ...api.DEFAULT_DRAWING_MODES, control: 'right' }, purposeModes: { 'Control special': 'left', 'Plastic tubing': 'right' } });
    expect(hook.result.current.conflict).toBeTruthy();
    expect(hook.result.current.canSave).toBe(false);
  });
  it('explicit default overrides a legacy side without affecting another purpose in the same family', async () => {
    vi.mocked(api.fetchDrawingPurposePolicy).mockResolvedValue({ ...policy, rules: [{ purposeKey: 'Custom Ω', categoryModes: { ...api.DEFAULT_DRAWING_MODES, control: 'right' } }] });
    const hook = await ready();
    act(() => hook.result.current.setMode('Custom Ω', 'Control', 'use-default'));
    expect(hook.result.current.rows[0].purposeModes.Control).toBe('use-default');
    expect(hook.result.current.rows[0].purposeModes['Control special']).toBe('right');
    expect(hook.result.current.dirty).toBe(true);
    act(() => hook.result.current.setMode('Custom Ω', 'Invented purpose', 'left'));
    expect(hook.result.current.rows[0].purposeModes['Invented purpose']).toBeUndefined();
  });
  it('discards stale responses and drafts on token/loaded identity/admin context switches', async () => {
    let resolve!: (value: CatalogEnvelope) => void; vi.mocked(api.fetchDrawingPurposeCatalog).mockReturnValueOnce(new Promise(value => { resolve = value; }));
    const hook = renderHook(props => useDrawingPurposePolicy(props), { initialProps: scope });
    hook.rerender({ ...scope, token: 'next', isAdmin: false }); await act(async () => resolve(catalog)); expect(hook.result.current.snapshot).toBeNull();
    hook.rerender({ ...scope, loadedProjectId: 'other' }); expect(hook.result.current.snapshot).toBeNull();
    hook.rerender({ ...scope, token: 'third' }); await waitFor(() => expect(hook.result.current.canEdit).toBe(true));
    act(() => hook.result.current.setMode('Custom Ω', 'Plastic tubing', 'left')); hook.rerender({ ...scope, token: 'fourth' }); expect(hook.result.current.dirty).toBe(false);
    await waitFor(() => expect(hook.result.current.canEdit).toBe(true));
  });
});
