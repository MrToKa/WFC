import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CablePositioningCard } from './CablePositioningCard';
import * as api from '@/api/pathfinderDrawing';
import type { CatalogEnvelope } from '../../shared/pathfinderPurposePolicy';
vi.mock('@fluentui/react-components', () => ({ tokens: {}, Spinner: () => null,
  Button: ({ children, appearance: _appearance, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { appearance?: string; size?: string }) => <button {...props}>{children}</button>,
  Checkbox: ({ onChange, checked, label: _label, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { label?: string; onChange: (event: React.ChangeEvent<HTMLInputElement>, data: { checked: boolean }) => void }) => <input {...props} type="checkbox" checked={checked} onChange={event => onChange(event, { checked: event.target.checked })} />,
}));
vi.mock('@/api/pathfinderDrawing', async () => ({ ...await vi.importActual<typeof api>('@/api/pathfinderDrawing'), fetchDrawingPurposeCatalog: vi.fn(), fetchDrawingPurposePolicy: vi.fn(), fetchDrawingPurposeHistory: vi.fn(), saveDrawingPurposePolicy: vi.fn() }));
const projectId = '11111111-1111-1111-1111-111111111111';
const props = { projectId, loadedProjectId: projectId, token: 'login', isAdmin: true };
beforeEach(() => { vi.clearAllMocks();
  vi.mocked(api.fetchDrawingPurposeCatalog).mockResolvedValue({ projectId, catalogRevision: '1', rowCount: 2, diagnostics: [], rows: ['Synthetic and  Control', 'Synthetic and Control'].map((purposeKey, index) => ({ projectTrayId: String(index), purposeKey, rawPurpose: purposeKey })) } as unknown as CatalogEnvelope);
  vi.mocked(api.fetchDrawingPurposePolicy).mockResolvedValue({ schemaVersion: 'pathfinder.drawing-purpose-policy.v1', projectId, catalogRevision: '1', drawingPolicyRevision: '0', rules: [] });
  vi.mocked(api.fetchDrawingPurposeHistory).mockResolvedValue({ schemaVersion: 'pathfinder.policy-history.v1', projectId, domain: 'drawing', events: [], nextBeforeRevision: null });
});
describe('Cable positioning card', () => {
  it('keeps exact purpose spacing, disambiguates accessible controls and makes Left/Right exclusive', async () => {
    render(<CablePositioningCard {...props} />);
    const left = await screen.findByRole('checkbox', { name: /MV Left .*Spacing variant 1 of 2/ });
    const right = screen.getByRole('checkbox', { name: /MV Right .*Spacing variant 1 of 2/ });
    expect(screen.getByText('MV positioning includes grounding cables. Grounding retains its separate packing rules. These choices affect drawings only.')).toBeVisible();
    fireEvent.click(left); expect(left).toBeChecked(); expect(right).not.toBeChecked();
    fireEvent.click(right); expect(right).toBeChecked(); expect(left).not.toBeChecked();
    const untouched = screen.getByRole('checkbox', { name: /MV Right .*Spacing variant 2 of 2/ }); expect(untouched).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Use default layout for MV .*Spacing variant 1 of 2/ })); expect(right).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save cable positioning' })).toBeDisabled();
    expect(screen.getByText('Synthetic·and··Control', { exact: false })).toBeVisible();
  });
  it('hides the card and performs no reads for an engineer or mismatched loaded project', async () => {
    const view = render(<CablePositioningCard {...props} isAdmin={false} />); expect(screen.queryByRole('region', { name: 'Cable positioning' })).toBeNull();
    view.rerender(<CablePositioningCard {...props} loadedProjectId="other" />);
    await waitFor(() => expect(api.fetchDrawingPurposePolicy).not.toHaveBeenCalled());
  });
  it('refreshes dependent tray metrics after a confirmed current drawing revision change', async () => {
    const onSaved = vi.fn(); render(<CablePositioningCard {...props} onSaved={onSaved} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /MV Left .*Spacing variant 1 of 2/ }));
    vi.mocked(api.fetchDrawingPurposePolicy).mockResolvedValue({ schemaVersion: 'pathfinder.drawing-purpose-policy.v1', projectId, catalogRevision: '1', drawingPolicyRevision: '1', rules: [] });
    vi.mocked(api.saveDrawingPurposePolicy).mockResolvedValue({ duplicate: false } as api.DrawingPolicySaveReceipt);
    fireEvent.click(screen.getByRole('button', { name: 'Save cable positioning' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});
