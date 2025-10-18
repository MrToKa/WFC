import type { ChangeEvent, RefObject } from 'react';

import {
  Body1,
  Button,
  Caption1,
  Spinner,
  mergeClasses
} from '@fluentui/react-components';

import type { CableType } from '@/api/client';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';

type PaginationHandlers = {
  onPrevious: () => void;
  onNext: () => void;
};

type CableTypesTabProps = {
  styles: ProjectDetailsStyles;
  isAdmin: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onImportClick: () => void;
  onExport: () => void;
  onImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  isImporting: boolean;
  isExporting: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  error: string | null;
  isLoading: boolean;
  items: CableType[];
  pendingId: string | null;
  onEdit: (cableType: CableType) => void;
  onDelete: (cableType: CableType) => void;
  formatNumeric: (value: number | null) => string;
  showPagination: boolean;
  page: number;
  totalPages: number;
  paginationHandlers: PaginationHandlers;
};

export const CableTypesTab = ({
  styles,
  isAdmin,
  isRefreshing,
  onRefresh,
  onCreate,
  onImportClick,
  onExport,
  onImportFileChange,
  isImporting,
  isExporting,
  fileInputRef,
  error,
  isLoading,
  items,
  pendingId,
  onEdit,
  onDelete,
  formatNumeric,
  showPagination,
  page,
  totalPages,
  paginationHandlers
}: CableTypesTabProps) => (
  <div className={styles.tabPanel} role="tabpanel" aria-label="Cable types">
    <div className={styles.actionsRow}>
      <Button onClick={onRefresh} disabled={isRefreshing}>
        {isRefreshing ? 'Refreshing...' : 'Refresh'}
      </Button>
      {isAdmin ? (
        <>
          <Button appearance="primary" onClick={onCreate}>
            Add cable type
          </Button>
          <Button onClick={onImportClick} disabled={isImporting}>
            {isImporting ? 'Importing...' : 'Import from Excel'}
          </Button>
          <Button
            appearance="secondary"
            onClick={onExport}
            disabled={isExporting}
          >
            {isExporting ? 'Exporting...' : 'Export to Excel'}
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

    {error ? (
      <Body1 className={styles.errorText}>{error}</Body1>
    ) : null}

    {isLoading ? (
      <Spinner label="Loading cable types..." />
    ) : items.length === 0 ? (
      <div className={styles.emptyState}>
        <Caption1>No cable types found</Caption1>
        <Body1>
          {isAdmin
            ? 'Use the buttons above to add or import cable types for this project.'
            : 'There are no cable types recorded for this project yet.'}
        </Body1>
      </div>
    ) : (
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={styles.tableHeadCell}>Purpose</th>
              <th
                className={mergeClasses(
                  styles.tableHeadCell,
                  styles.numericCell
                )}
              >
                Diameter [mm]
              </th>
              <th
                className={mergeClasses(
                  styles.tableHeadCell,
                  styles.numericCell
                )}
              >
                Weight [kg/m]
              </th>
              {isAdmin ? (
                <th className={styles.tableHeadCell}>Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {items.map((cableType) => {
              const isBusy = pendingId === cableType.id;
              return (
                <tr key={cableType.id}>
                  <td className={styles.tableCell}>{cableType.name}</td>
                  <td className={styles.tableCell}>
                    {cableType.purpose ?? '-'}
                  </td>
                  <td
                    className={mergeClasses(
                      styles.tableCell,
                      styles.numericCell
                    )}
                  >
                    {formatNumeric(cableType.diameterMm)}
                  </td>
                  <td
                    className={mergeClasses(
                      styles.tableCell,
                      styles.numericCell
                    )}
                  >
                    {formatNumeric(cableType.weightKgPerM)}
                  </td>
                  {isAdmin ? (
                    <td
                      className={mergeClasses(
                        styles.tableCell,
                        styles.actionsCell
                      )}
                    >
                      <Button
                        size="small"
                        onClick={() => onEdit(cableType)}
                        disabled={isBusy}
                      >
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
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {showPagination ? (
          <div className={styles.pagination}>
            <Button
              size="small"
              onClick={paginationHandlers.onPrevious}
              disabled={page === 1}
            >
              Previous
            </Button>
            <Body1>
              Page {page} of {totalPages}
            </Body1>
            <Button
              size="small"
              onClick={paginationHandlers.onNext}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    )}
  </div>
);
