import { useRef, useState } from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useProjectDetailsStyles } from '../ProjectDetails.styles';
import { CableTypesTab } from './CableTypesTab';

const onPurposeFilterChange = vi.fn();
const CableTypesHarness = ({ withPurposeFilter = false }: { withPurposeFilter?: boolean }) => {
  const styles = useProjectDetailsStyles();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [purpose, setPurpose] = useState('');
  return (
    <CableTypesTab
      styles={styles}
      isAdmin={false}
      canExport
      isRefreshing={false}
      onRefresh={vi.fn()}
      onCreate={vi.fn()}
      onImportClick={vi.fn()}
      onExport={vi.fn()}
      onGetTemplate={vi.fn()}
      onImportFileChange={vi.fn()}
      isImporting={false}
      isExporting={false}
      isGettingTemplate={false}
      fileInputRef={fileInputRef}
      searchText=""
      searchCriteria="all"
      onSearchTextChange={vi.fn()}
      onSearchCriteriaChange={vi.fn()}
      purposeFilter={purpose}
      purposeOptions={['Control', 'Power']}
      onPurposeFilterChange={
        withPurposeFilter
          ? (value) => {
              setPurpose(value);
              onPurposeFilterChange(value);
            }
          : undefined
      }
      error={null}
      isLoading={false}
      items={[{ id: 'cable', name: 'Cable', purpose: 'Power', diameterMm: 12, weightKgPerM: 0.2 }]}
      pendingId={null}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      formatNumeric={(value) => String(value)}
      showPagination
      page={1}
      totalPages={2}
      paginationHandlers={{ onPrevious: vi.fn(), onNext: vi.fn(), onPageSelect: vi.fn() }}
    />
  );
};

describe('CableTypesTab', () => {
  it('shows exports and templates to signed-in ordinary users without mutation controls', () => {
    render(<FluentProvider theme={webLightTheme}><CableTypesHarness /></FluentProvider>);
    expect(screen.getByRole('button', { name: 'Export to Excel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Get upload template' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Add cable type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import from Excel' })).not.toBeInTheDocument();
  });
  it('supports selecting and clearing the optional purpose filter', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <CableTypesHarness withPurposeFilter />
      </FluentProvider>,
    );
    const purpose = screen.getByRole('combobox', { name: 'Filter by purpose' });
    expect(purpose).toHaveTextContent('All purposes');

    fireEvent.click(purpose);
    fireEvent.click(screen.getByRole('option', { name: 'Control' }));
    expect(onPurposeFilterChange).toHaveBeenLastCalledWith('Control');
    expect(purpose).toHaveTextContent('Control');

    fireEvent.click(purpose);
    fireEvent.click(screen.getByRole('option', { name: 'All purposes' }));
    expect(onPurposeFilterChange).toHaveBeenLastCalledWith('');
    expect(purpose).toHaveTextContent('All purposes');
  });

  it('preserves project filters and keeps pagination outside the scrolling table', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <CableTypesHarness />
      </FluentProvider>,
    );
    expect(screen.queryByRole('combobox', { name: 'Filter by purpose' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Filter cable types' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Search criteria' })).toBeInTheDocument();
    const pagination = screen.getByRole('combobox', { name: 'Select cable types page' });
    const tableContainer = screen.getByRole('table').parentElement;
    expect(tableContainer).not.toContainElement(pagination);
    expect(tableContainer?.parentElement).toContainElement(pagination);
  });
});
