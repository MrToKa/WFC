import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PathFinderResults } from './PathFinderResults';
import type { usePathFinder } from './hooks/usePathFinder';
vi.mock('./PathFinderRecalculationPanel', () => ({ PathFinderRecalculationPanel: () => <div>Server recalculation status</div> }));
describe('calculation production boundary', () => {
  it('does not create jobs from ready data or dependency changes; manual actions remain explicit', () => {
    const calculate = vi.fn(), options = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
    const pf = { data: { registryRevision: '1', activeModel: { modelVersionId: 'model', selectionRevision: '1' }, settings: {}, artifacts: [{ id: 'artifact' }], cables: [{ id: 'cable', cableWriteRevision: '1', mto: 'Control', fromMatch: { status: 'matched' }, toMatch: { status: 'matched' } }], jobs: [], proposals: [] }, busy: false, calculate, preparationAccess: { projectId: null, loadedProjectId: null, token: null, isAdmin: false } } as unknown as ReturnType<typeof usePathFinder>;
    const view = render(<PathFinderResults pf={pf} selectedCableId="cable" options={options} />);
    expect(calculate).not.toHaveBeenCalled(); expect(screen.getByText('Server recalculation status')).toBeVisible();
    view.rerender(<PathFinderResults pf={{ ...pf, data: { ...pf.data!, registryRevision: '2' } }} selectedCableId="cable" options={options} />);
    expect(calculate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate all cables' })); expect(calculate).toHaveBeenLastCalledWith(undefined, true, options);
    fireEvent.click(screen.getByRole('button', { name: 'Calculate selected cable' })); expect(calculate).toHaveBeenLastCalledWith(['cable'], true, options);
  });
});
