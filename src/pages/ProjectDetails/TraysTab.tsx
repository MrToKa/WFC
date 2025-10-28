import type { ChangeEvent, RefObject } from 'react';

import {
  Body1,
  Button,
  Caption1,
  Spinner,
  mergeClasses
} from '@fluentui/react-components';

import type { Tray } from '@/api/client';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';

type TraysTabProps = {
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
  items: Tray[];
  pendingId: string | null;
  onDetails: (tray: Tray) => void;
  onDelete: (tray: Tray) => void;
  formatNumeric: (value: number | null) => string;
  showPagination: boolean;
  page: number;
  totalPages: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
};

export const TraysTab = ({
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
  onDetails,
  onDelete,
  formatNumeric,
  showPagination,
  page,
  totalPages,
  onPreviousPage,
  onNextPage
}: TraysTabProps) => (
  <div className={styles.tabPanel} role="tabpanel" aria-label="Trays">
    <div className={styles.actionsRow}>
      <Button onClick={onRefresh} disabled={isRefreshing}>
        {isRefreshing ? 'Refreshing...' : 'Refresh'}
      </Button>
      {isAdmin ? (
        <>
          <Button appearance="primary" onClick={onCreate}>
            Add tray
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

    {error ? <Body1 className={styles.errorText}>{error}</Body1> : null}

    {isLoading ? (
      <Spinner label="Loading trays..." />
    ) : items.length === 0 ? (
      <div className={styles.emptyState}>
        <Caption1>No trays found</Caption1>
        <Body1>
          {isAdmin
            ? 'Use the buttons above to add or import trays for this project.'
            : 'There are no trays recorded for this project yet.'}
        </Body1>
      </div>
    ) : (
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>Name</th>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={styles.tableHeadCell}>Purpose</th>
              <th
                className={mergeClasses(
                  styles.tableHeadCell,
                  styles.numericCell
                )}
              >
                Width [mm]
              </th>
              <th
                className={mergeClasses(
                  styles.tableHeadCell,
                  styles.numericCell
                )}
              >
                Height [mm]
              </th>
              <th
                className={mergeClasses(
                  styles.tableHeadCell,
                  styles.numericCell
                )}
              >
                Length
              </th>
              <th className={styles.tableHeadCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((tray) => {
              const isBusy = pendingId === tray.id;
              return (
                <tr key={tray.id}>
                  <td className={styles.tableCell}>{tray.name}</td>
                  <td className={styles.tableCell}>{tray.type ?? '-'}</td>
                  <td className={styles.tableCell}>{tray.purpose ?? '-'}</td>
                  <td
                    className={mergeClasses(
                      styles.tableCell,
                      styles.numericCell
                    )}
                  >
                    {formatNumeric(tray.widthMm)}
                  </td>
                  <td
                    className={mergeClasses(
                      styles.tableCell,
                      styles.numericCell
                    )}
                  >
                    {formatNumeric(tray.heightMm)}
                  </td>
                  <td
                    className={mergeClasses(
                      styles.tableCell,
                      styles.numericCell
                    )}
                  >
                    {formatNumeric(tray.lengthMm)}
                  </td>
                  <td
                    className={mergeClasses(
                      styles.tableCell,
                      styles.actionsCell
                    )}
                  >
                    <Button
                      size="small"
                      onClick={() => onDetails(tray)}
                      disabled={isBusy}
                    >
                      Details
                    </Button>
                    {isAdmin ? (
                      <Button
                        size="small"
                        appearance="secondary"
                        onClick={() => onDelete(tray)}
                        disabled={isBusy}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {showPagination ? (
          <div className={styles.pagination}>
            <Button
              size="small"
              onClick={onPreviousPage}
              disabled={page === 1}
            >
              Previous
            </Button>
            <Body1>
              Page {page} of {totalPages}
            </Body1>
            <Button
              size="small"
              onClick={onNextPage}
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
