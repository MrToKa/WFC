import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MaterialTray } from '@/api/client';
import { TraysTable } from './TraysTable';

const tray: MaterialTray = {
  id: 'tray-1',
  type: 'KL-300',
  manufacturer: 'Niedax',
  heightMm: 60,
  rungHeightMm: 20,
  widthMm: 300,
  weightKgPerM: 2,
  minimumOrderQuantity: 1,
  orderMeasurement: 'pcs',
  packaging: 'pcs',
  unitPrice: 5,
  loadCurveId: null,
  loadCurveName: null,
  imageTemplateId: null,
  imageTemplateFileName: null,
  imageTemplateContentType: null,
  createdAt: '',
  updatedAt: '',
};
function show(status?: 'ready' | 'loading' | 'error') {
  const onStep = vi.fn();
  render(
    <FluentProvider theme={webLightTheme}>
      <TraysTable
        trays={[tray, { ...tray, id: 'tray-2', type: 'KL-600' }]}
        isLoading={false}
        error={null}
        isAdmin={false}
        pendingId={null}
        loadCurvePendingId={null}
        isSubmitting={false}
        formatNumeric={String}
        formatWeight={String}
        onDetails={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAssignLoadCurve={vi.fn()}
        onStep={onStep}
        stepRevisions={{ 'tray-1': 3 }}
        stepStatus={status}
        token="token"
        page={1}
        totalPages={1}
        onSetPage={vi.fn()}
        paginationStyles={{ pagination: '', paginationDropdown: '' }}
        styles={{
          emptyState: '',
          errorText: '',
          tableWrapper: '',
          table: '',
          tableHeadCell: '',
          tableCell: '',
          numericCell: '',
          actionsCell: '',
        }}
      />
    </FluentProvider>,
  );
  return onStep;
}

describe('tray STEP status', () => {
  it('identifies attached and missing STEP files by tray ID and opens the matching row', () => {
    const onStep = show('ready');
    const row = screen.getByText('KL-300').closest('tr')!;
    expect(within(row).getByText('STEP attached')).toHaveAttribute('title', 'STEP revision 3');
    const missing = screen.getByText('KL-600').closest('tr')!;
    expect(within(missing).getByText('No STEP')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'STEP file' }));
    expect(onStep).toHaveBeenCalledWith(tray);
  });
  it.each([
    ['loading', 'Loading STEP status…'],
    ['error', 'STEP status unavailable'],
  ] as const)('shows %s explicitly instead of claiming that STEP is missing', (status, text) => {
    show(status);
    expect(screen.getAllByText(text)).toHaveLength(2);
    expect(screen.queryByText('No STEP')).not.toBeInTheDocument();
    expect(screen.queryByText('STEP attached')).not.toBeInTheDocument();
  });
  it('omits the STEP status column when the feature is disabled', () => {
    show();
    expect(screen.queryByRole('columnheader', { name: 'STEP' })).not.toBeInTheDocument();
    expect(screen.queryByText('STEP attached')).not.toBeInTheDocument();
    expect(screen.queryByText('No STEP')).not.toBeInTheDocument();
  });
});
