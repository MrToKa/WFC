import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { Tray } from '@/api/client';
import { toTrayFormState, updateTrayFormField } from '../TrayDetails.utils';
import type { TrayFormState } from '../TrayDetails.types';
import { TrayEditForm } from './TrayEditForm';
import { TrayInfoSection } from './TrayInfoSection';

const tray: Tray = { id: 'tray', projectId: 'project', name: 'B001', type: null, purpose: null, widthMm: null, heightMm: null,
  lengthMm: 800, includeGroundingCable: false, groundingCableTypeId: null, createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z' };
const props = (): ComponentProps<typeof TrayEditForm> => ({
  formValues: toTrayFormState(tray), formErrors: {}, materialsError: null, canUseMaterialDropdown: false, currentTypeHasMaterial: false,
  isLoadingMaterials: false, isSubmitting: false, materialTrays: [], onFieldChange: () => vi.fn(), onTypeSelect: vi.fn(), onPurposeSelect: vi.fn(),
  onSubmit: vi.fn(event => event.preventDefault()), onCancel: vi.fn(), styles: {}, autoLengthPending: false, autoLengthError: null,
  autoLengthDisabled: false, onAutoLength: vi.fn(), autoLengthProposal: null, onAcceptAutoLength: vi.fn(),
});

describe('tray auto-length controls', () => {
  it('calculates through a separate button without submitting or replacing the manual length', () => {
    const value = props(); render(<TrayEditForm {...value} />);
    fireEvent.click(screen.getByRole('button', { name: 'Auto-length' }));
    expect(value.onAutoLength).toHaveBeenCalledOnce(); expect(value.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Length [mm]' })).toHaveValue('800');
    expect(screen.queryByText('Auto-calculated')).toBeNull();
  });
  it('blocks calculation and save while pending, while allowing cancellation', () => {
    const value = props(); render(<TrayEditForm {...value} autoLengthPending />);
    expect(screen.getByRole('button', { name: 'Auto-length' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Calculating length from tray centerlines');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(value.onCancel).toHaveBeenCalledOnce();
  });
  it('presents the manual and proposed lengths and requires a separate acceptance action', () => {
    const value = props(); render(<TrayEditForm {...value} autoLengthProposal={{ currentLengthMm: '800', proposedLengthMm: '1234.567', savedManualLengthMm: 800 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Current manual length: 800 mm. Proposed auto-length: 1234.567 mm.');
    expect(screen.getByRole('textbox', { name: 'Length [mm]' })).toHaveValue('800');
    fireEvent.click(screen.getByRole('button', { name: 'Use auto-length' }));
    expect(value.onAcceptAutoLength).toHaveBeenCalledOnce(); expect(value.onSubmit).not.toHaveBeenCalled();
  });
  it('shows the current measurement stage while the model geometry is being read', () => {
    render(<TrayEditForm {...props()} autoLengthPending autoLengthProgress="Reading only this tray’s assigned geometry…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading only this tray’s assigned geometry');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
  it('shows the saved baseline when an unsaved manual value differs', () => {
    render(<TrayEditForm {...props()} autoLengthProposal={{ currentLengthMm: '950', proposedLengthMm: '1234.567', savedManualLengthMm: 800 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Current manual length: 950 mm. Proposed auto-length: 1234.567 mm. Saved manual length: 800 mm.');
  });
  it('shows a saved manual zero when the draft has been cleared', () => {
    render(<TrayEditForm {...props()} autoLengthProposal={{ currentLengthMm: '', proposedLengthMm: '1234.567', savedManualLengthMm: 0 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Current manual length: Empty. Proposed auto-length: 1234.567 mm. Saved manual length: 0 mm.');
  });
  it('keeps an error actionable without discarding the existing manual length', () => {
    render(<TrayEditForm {...props()} autoLengthError="No current centerline is available. Prepare this tray and try Auto-length again." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Prepare this tray');
    expect(screen.getByRole('button', { name: 'Auto-length' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Length [mm]' })).toHaveValue('800');
  });
  it('removes the auto indicator after the length is manually edited', () => {
    function Form() {
      const [formValues, setFormValues] = useState<TrayFormState>({ ...toTrayFormState(tray), lengthSource: 'auto' });
      return <TrayEditForm {...props()} formValues={formValues} onFieldChange={field => (_event, data) =>
        setFormValues(previous => updateTrayFormField(previous, field, data.value))} />;
    }
    render(<Form />); expect(screen.getByText('Auto-calculated')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Length [mm]' }), { target: { value: '2000' } });
    expect(screen.queryByText('Auto-calculated')).toBeNull();
  });
  it('persists the auto indicator in the read-only tray information', () => {
    const value = { tray: { ...tray, lengthSource: 'auto' as const }, weightDisplay: '-', numberFormatter: new Intl.NumberFormat('en', { maximumFractionDigits: 3 }),
      manufacturer: null, rungHeightMm: null, styles: {} };
    const view = render(<TrayInfoSection {...value} />); expect(screen.getByText('Auto-calculated')).toBeVisible();
    view.rerender(<TrayInfoSection {...value} tray={{ ...tray, lengthSource: 'manual' }} />); expect(screen.queryByText('Auto-calculated')).toBeNull();
  });
});
