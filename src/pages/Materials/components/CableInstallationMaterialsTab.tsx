import type { ChangeEvent, RefObject } from 'react';
import { useMemo } from 'react';
import {
  Body1,
  Button,
  Caption1,
  Dropdown,
  Input,
  Option,
  Spinner,
  mergeClasses,
} from '@fluentui/react-components';
import type { MaterialCableInstallationMaterial } from '@/api/client';
import { TablePagination } from '../../ProjectDetails/TablePagination';
import type { FilterableTableSectionStyles } from '../../ProjectDetails.styles';
import type { CableInstallationMaterialSearchCriteria } from '../CableInstallationMaterials.forms';

type PaginationHandlers = {
  onPrevious: () => void;
  onNext: () => void;
  onPageSelect: (page: number) => void;
};

type CableInstallationMaterialsTabProps = {
  styles: FilterableTableSectionStyles;
  isAdmin: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onImportClick: () => void;
  onExport: () => void;
  onGetTemplate: () => void;
  onImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  isImporting: boolean;
  isExporting: boolean;
  isGettingTemplate: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  searchText: string;
  searchCriteria: CableInstallationMaterialSearchCriteria;
  onSearchTextChange: (value: string) => void;
  onSearchCriteriaChange: (value: CableInstallationMaterialSearchCriteria) => void;
  error: string | null;
  isLoading: boolean;
  items: MaterialCableInstallationMaterial[];
  pendingId: string | null;
  onEdit: (item: MaterialCableInstallationMaterial) => void;
  onDelete: (item: MaterialCableInstallationMaterial) => void;
  showPagination: boolean;
  page: number;
  totalPages: number;
  paginationHandlers: PaginationHandlers;
  includeTabPanelRole?: boolean;
  emptyStateTitle?: string;
  emptyStateBody?: string;
};

export const CableInstallationMaterialsTab = ({
  styles,
  isAdmin,
  isRefreshing,
  onRefresh,
  onCreate,
  onImportClick,
  onExport,
  onGetTemplate,
  onImportFileChange,
  isImporting,
  isExporting,
  isGettingTemplate,
  fileInputRef,
  searchText,
  searchCriteria,
  onSearchTextChange,
  onSearchCriteriaChange,
  error,
  isLoading,
  items,
  pendingId,
  onEdit,
  onDelete,
  showPagination,
  page,
  totalPages,
  paginationHandlers,
  includeTabPanelRole = true,
  emptyStateTitle = 'No cable installation materials found',
  emptyStateBody,
}: CableInstallationMaterialsTabProps) => {
  const selectedCriteria = useMemo<string[]>(() => [searchCriteria], [searchCriteria]);

  const resolvedEmptyStateBody =
    emptyStateBody ??
    (isAdmin
      ? 'Use the buttons above to add or import cable installation materials.'
      : 'There are no cable installation materials recorded yet.');

  const panelProps = includeTabPanelRole
    ? {
        role: 'tabpanel' as const,
        'aria-label': 'Cable installation materials',
      }
    : {};

  return (
    <div className={styles.tabPanel} {...panelProps}>
      <div className={styles.actionsRow}>
        <Button onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
        {isAdmin ? (
          <>
            <Button appearance="primary" onClick={onCreate}>
              Add cable installation material
            </Button>
            <Button onClick={onImportClick} disabled={isImporting}>
              {isImporting ? 'Importing...' : 'Import from Excel'}
            </Button>
            <Button appearance="secondary" onClick={onExport} disabled={isExporting}>
              {isExporting ? 'Exporting...' : 'Export to Excel'}
            </Button>
            <Button appearance="secondary" onClick={onGetTemplate} disabled={isGettingTemplate}>
              {isGettingTemplate ? 'Getting template...' : 'Get upload template'}
            </Button>
            <input
              ref={fileInputRef}
              className={styles.hiddenInput}
              type="file"
              accept=".xlsx"
              onChange={onImportFileChange}
            />
          </>
        ) : null}
      </div>

      <div className={styles.filtersRow}>
        <Input
          value={searchText}
          placeholder="Filter cable installation materials"
          onChange={(_, data) => onSearchTextChange(data.value)}
          aria-label="Filter cable installation materials"
        />
        <Dropdown
          selectedOptions={selectedCriteria}
          value={
            searchCriteria === 'all'
              ? 'All fields'
              : searchCriteria === 'type'
                ? 'Type'
                : searchCriteria === 'purpose'
                  ? 'Purpose'
                  : searchCriteria === 'material'
                    ? 'Material'
                    : searchCriteria === 'description'
                      ? 'Description'
                      : searchCriteria === 'manufacturer'
                        ? 'Manufacturer'
                        : 'Part No.'
          }
          onOptionSelect={(_, data) =>
            onSearchCriteriaChange(data.optionValue as CableInstallationMaterialSearchCriteria)
          }
          aria-label="Search criteria"
        >
          <Option value="all">All fields</Option>
          <Option value="type">Type</Option>
          <Option value="purpose">Purpose</Option>
          <Option value="material">Material</Option>
          <Option value="description">Description</Option>
          <Option value="manufacturer">Manufacturer</Option>
          <Option value="partNo">Part No.</Option>
        </Dropdown>
      </div>

      {error ? <Body1 className={styles.errorText}>{error}</Body1> : null}

      {isLoading ? (
        <Spinner label="Loading cable installation materials..." />
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <Caption1>{emptyStateTitle}</Caption1>
          <Body1>{resolvedEmptyStateBody}</Body1>
        </div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>Type</th>
                <th className={styles.tableHeadCell}>Purpose</th>
                <th className={styles.tableHeadCell}>Material</th>
                <th className={styles.tableHeadCell}>Description</th>
                <th className={styles.tableHeadCell}>Manufacturer</th>
                <th className={styles.tableHeadCell}>Part No.</th>
                {isAdmin ? <th className={styles.tableHeadCell}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isBusy = pendingId === item.id;
                return (
                  <tr key={item.id}>
                    <td className={styles.tableCell}>{item.type}</td>
                    <td className={styles.tableCell}>{item.purpose ?? '-'}</td>
                    <td className={styles.tableCell}>{item.material ?? '-'}</td>
                    <td className={styles.tableCell}>{item.description ?? '-'}</td>
                    <td className={styles.tableCell}>{item.manufacturer ?? '-'}</td>
                    <td className={styles.tableCell}>{item.partNo ?? '-'}</td>
                    {isAdmin ? (
                      <td className={mergeClasses(styles.tableCell, styles.actionsCell)}>
                        <Button size="small" onClick={() => onEdit(item)} disabled={isBusy}>
                          Edit
                        </Button>
                        <Button
                          size="small"
                          appearance="secondary"
                          onClick={() => onDelete(item)}
                          disabled={isBusy}
                        >
                          Delete
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {showPagination ? (
            <TablePagination
              styles={styles}
              page={page}
              totalPages={totalPages}
              onPrevious={paginationHandlers.onPrevious}
              onNext={paginationHandlers.onNext}
              onPageSelect={paginationHandlers.onPageSelect}
              dropdownAriaLabel="Select cable installation materials page"
            />
          ) : null}
        </div>
      )}
    </div>
  );
};
