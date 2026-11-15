import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TrayDialog } from './TrayDialog';

const props = (): ComponentProps<typeof TrayDialog> => ({
  styles: {} as ComponentProps<typeof TrayDialog>['styles'], open: true, mode: 'create',
  values: { name: 'B001', type: '', purpose: '', lengthMm: '', widthMm: '', heightMm: '' }, errors: {},
  submitting: false, materialTrays: [], onFieldChange: () => vi.fn(),
  onPurposeSelect: vi.fn(), onSubmit: vi.fn(), onDismiss: vi.fn()
});

describe('project tray purpose choices', () => {
  it('offers project purposes and retains a selected legacy purpose exactly once', () => {
    const value = props();
    render(<TrayDialog {...value} values={{ ...value.values, purpose: 'Legacy purpose' }}
      purposeOptions={['Project purpose', 'Project purpose']} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Purpose' }));
    expect(screen.getByRole('option', { name: 'Project purpose' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Legacy purpose' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Medium voltage cable tray' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Project purpose' }));
    expect(value.onPurposeSelect).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ optionValue: 'Project purpose' }));
  });

  it('explains where to add purposes when the project catalog is empty', () => {
    render(<TrayDialog {...props()} />);
    expect(screen.getByText('Add tray purposes in Project Details → Tray report templates.')).toBeVisible();
    fireEvent.click(screen.getByRole('combobox', { name: 'Purpose' }));
    expect(screen.queryByRole('option')).toBeNull();
  });
});
