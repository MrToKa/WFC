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

import type { CableType } from '@/api/client';
import type { CableTypeSearchCriteria } from './hooks/useCableTypesSection';
import { TablePagination } from './TablePagination';

import type { FilterableTableSectionStyles } from '../ProjectDetails.styles';

type PaginationHandlers = {
  onPrevious: () => void;
  onNext: () => void;
  onPageSelect: (page: number) => void;
};

type CableTypesTabItem = Pick<CableType, 'id' | 'name' | 'purpose' | 'diameterMm' | 'weightKgPerM'>;

type CableTypesTabProps<T extends CableTypesTabItem> = {
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
  searchCriteria: CableTypeSearchCriteria;
  onSearchTextChange: (value: string) => void;
  onSearchCriteriaChange: (value: CableTypeSearchCriteria) => void;
  error: string | null;
  isLoading: boolean;
  items: T[];
  pendingId: string | null;
  onDetails?: (cableType: T) => void;
  onEdit: (cableType: T) => void;
  onDelete: (cableType: T) => void;
  formatNumeric: (value: number | null) => string;
  showPagination: boolean;
  page: number;
  totalPages: number;
  paginationHandlers: PaginationHandlers;
  includeTabPanelRole?: boolean;
  emptyStateTitle?: string;
  emptyStateBody?: string;
  disableCreateAction?: boolean;
  disableImportAction?: boolean;
  disableExportAction?: boolean;
  disableGetTemplateAction?: boolean;
};

export const CableTypesTab = <T extends CableTypesTabItem>({
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
  onDetails,
  onEdit,
  onDelete,
  formatNumeric,
  showPagination,
  page,
  totalPages,
  paginationHandlers,
  includeTabPanelRole = true,
  emptyStateTitle = 'No cable types found',
  emptyStateBody,
  disableCreateAction = false,
  disableImportAction = false,
  disableExportAction = false,
  disableGetTemplateAction = false,
}: CableTypesTabProps<T>) => {
  const selectedCriteria = useMemo<string[]>(() => [searchCriteria], [searchCriteria]);
  const showActions = Boolean(onDetails) || isAdmin;

  const resolvedEmptyStateBody =
    emptyStateBody ??
    (isAdmin
      ? 'Use the buttons above to add or import cable types for this project.'
      : 'There are no cable types recorded for this project yet.');

  const panelProps = includeTabPanelRole
    ? {
        role: 'tabpanel' as const,
        'aria-label': 'Cable types',
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
            <Button appearance="primary" onClick={onCreate} disabled={disableCreateAction}>
              Add cable type
            </Button>
            <Button onClick={onImportClick} disabled={isImporting || disableImportAction}>
              {isImporting ? 'Importing...' : 'Import from Excel'}
            </Button>
            <Button
              appearance="secondary"
              onClick={onExport}
              disabled={isExporting || disableExportAction}
            >
              {isExporting ? 'Exporting...' : 'Export to Excel'}
            </Button>
            <Button
              appearance="secondary"
              onClick={onGetTemplate}
              disabled={isGettingTemplate || disableGetTemplateAction}
            >
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
          placeholder="Filter cable types"
          onChange={(_, data) => onSearchTextChange(data.value)}
          aria-label="Filter cable types"
        />
        <Dropdown
          selectedOptions={selectedCriteria}
          value={
            searchCriteria === 'all'
              ? 'All fields'
              : searchCriteria === 'name'
                ? 'Name'
                : searchCriteria === 'purpose'
                  ? 'Purpose'
                  : searchCriteria === 'diameter'
                    ? 'Diameter'
                    : 'Weight'
          }
          onOptionSelect={(_, data) =>
            onSearchCriteriaChange(data.optionValue as CableTypeSearchCriteria)
          }
          aria-label="Search criteria"
        >
          <Option value="all">All fields</Option>
          <Option value="name">Name</Option>
          <Option value="purpose">Purpose</Option>
          <Option value="diameter">Diameter</Option>
          <Option value="weight">Weight</Option>
        </Dropdown>
      </div>

      {error ? <Body1 className={styles.errorText}>{error}</Body1> : null}

      {isLoading ? (
        <Spinner label="Loading cable types..." />
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
                <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                  Diameter [mm]
                </th>
                <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                  Weight [kg/m]
                </th>
                {showActions ? <th className={styles.tableHeadCell}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((cableType) => {
                const isBusy = pendingId === cableType.id;
                return (
                  <tr key={cableType.id}>
                    <td className={styles.tableCell}>{cableType.name}</td>
                    <td className={styles.tableCell}>{cableType.purpose ?? '-'}</td>
                    <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                      {formatNumeric(cableType.diameterMm)}
                    </td>
                    <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                      {formatNumeric(cableType.weightKgPerM)}
                    </td>
                    {showActions ? (
                      <td className={mergeClasses(styles.tableCell, styles.actionsCell)}>
                        {onDetails ? (
                          <Button size="small" onClick={() => onDetails(cableType)}>
                            Details
                          </Button>
                        ) : null}
                        {isAdmin ? (
                          <>
                            <Button size="small" onClick={() => onEdit(cableType)} disabled={isBusy}>
                              Edit
                            </Button>
                            <Button
                              size="small"
                              appearance="secondary"
                              onClick={() => onDelete(cableType)}
                              disabled={isBusy}
                            >
                              Delete
                            </Button>
                          </>
                        ) : null}
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
              dropdownAriaLabel="Select cable types page"
            />
          ) : null}
        </div>
      )}
    </div>
  );
};
