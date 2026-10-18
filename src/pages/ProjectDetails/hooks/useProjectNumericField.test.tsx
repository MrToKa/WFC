import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateProject, type Project } from '@/api/client';
import { useProjectNumericField } from './useProjectNumericField';

vi.mock('@/api/client', async importOriginal => ({ ...await importOriginal<typeof import('@/api/client')>(), updateProject: vi.fn() }));
const project: Project = { id: '11111111-1111-4111-8111-111111111111', projectNumber: 'P-1', name: 'Local project', customer: 'Test', manager: null, description: null,
  connectionGap: 1, secondaryTrayLength: 4, endConnectionLength: 6, additionalBendingPercent: 10, supportDistance: null, supportWeight: null, trayLoadSafetyFactor: null, supportDistanceOverrides: {}, trayPurposeTemplates: {},
  cableLayout: { cableSpacing: null, considerBundleSpacingAsFree: null, minFreeSpacePercent: null, maxFreeSpacePercent: null, mv: null, power: null, vfd: null, control: null, customBundleRanges: null }, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z' };
const reloadProject = vi.fn(async () => {}), showToast = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.mocked(updateProject).mockResolvedValue({ project }); });
describe('Project connection gap field', () => {
  it('shows the persisted one-metre default, saves0.25 without allowance rounding, and reflects the reloaded project', async () => {
    const { result, rerender } = renderHook(({ value }) => useProjectNumericField({ project: value, field: 'connectionGap', token: 'local-token', isAdmin: true, reloadProject, showToast }), { initialProps: { value: project } });
    expect(result.current.input).toBe('1'); expect(result.current.decimals).toBe(3);
    act(() => result.current.onInputChange('0.25')); await act(() => result.current.onSave());
    expect(updateProject).toHaveBeenCalledExactlyOnceWith('local-token', project.id, { connectionGap: 0.25 }); expect(reloadProject).toHaveBeenCalledOnce();
    rerender({ value: { ...project, connectionGap: 0.25 } }); expect(result.current.input).toBe('0.25');
    expect(project.secondaryTrayLength).toBe(4); expect(project.endConnectionLength).toBe(6); expect(project.additionalBendingPercent).toBe(10);
  });
  it.each(['', '0', '0.0004', '-1', '100.001', 'Infinity'])('rejects an invalid or rounded-to-zero connection gap: %s', async value => {
    const { result } = renderHook(() => useProjectNumericField({ project, field: 'connectionGap', token: 'local-token', isAdmin: true, reloadProject, showToast }));
    act(() => result.current.onInputChange(value)); await act(() => result.current.onSave());
    expect(result.current.error).toBeTruthy(); expect(updateProject).not.toHaveBeenCalled(); expect(reloadProject).not.toHaveBeenCalled();
  });
  it('retains the existing project-edit permission guard', async () => {
    const { result } = renderHook(() => useProjectNumericField({ project, field: 'connectionGap', token: 'local-token', isAdmin: false, reloadProject, showToast }));
    act(() => result.current.onInputChange('2')); await act(() => result.current.onSave()); expect(updateProject).not.toHaveBeenCalled(); expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ intent: 'error' }));
  });
  it('preserves existing SECONDARY precision and nullable semantics', async () => {
    const { result } = renderHook(() => useProjectNumericField({ project, field: 'secondaryTrayLength', token: 'local-token', isAdmin: true, reloadProject, showToast }));
    expect(result.current.decimals).toBe(1); act(() => result.current.onInputChange('')); await act(() => result.current.onSave());
    expect(updateProject).toHaveBeenCalledExactlyOnceWith('local-token', project.id, { secondaryTrayLength: null });
  });
});
