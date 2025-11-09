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
  mergeClasses
} from '@fluentui/react-components';

import type { Tray } from '@/api/client';
import type { TraySearchCriteria } from './hooks/useTraysSection';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';

type TraysTabProps = {
  styles: ProjectDetailsStyles;
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
  searchCriteria: TraySearchCriteria;
  onSearchTextChange: (value: string) => void;
  onSearchCriteriaChange: (value: TraySearchCriteria) => void;
  error: string | null;
  isLoading: boolean;
  items: Tray[];
  pendingId: string | null;
  freeSpaceByTrayId: Record<string, number | null>;
  minFreeSpacePercent: number | null;
  maxFreeSpacePercent: number | null;
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
  freeSpaceByTrayId,
  minFreeSpacePercent,
  maxFreeSpacePercent,
  onDetails,
  onDelete,
  formatNumeric,
  showPagination,
  page,
  totalPages,
  onPreviousPage,
  onNextPage
}: TraysTabProps) => {
  const selectedCriteria = useMemo<string[]>(
    () => [searchCriteria],
    [searchCriteria]
  );

  const freeSpaceFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    []
  );

  return (
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
          <Button
            appearance="secondary"
            onClick={onGetTemplate}
            disabled={isGettingTemplate}
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
        placeholder="Filter trays"
        onChange={(_, data) => onSearchTextChange(data.value)}
        aria-label="Filter trays"
      />
      <Dropdown
        selectedOptions={selectedCriteria}
        value={
          searchCriteria === 'all' ? 'All fields' :
          searchCriteria === 'name' ? 'Name' :
          searchCriteria === 'type' ? 'Type' :
          searchCriteria === 'purpose' ? 'Purpose' :
          searchCriteria === 'width' ? 'Width' :
          'Height'
        }
        onOptionSelect={(_, data) =>
          onSearchCriteriaChange(data.optionValue as TraySearchCriteria)
        }
        aria-label="Search criteria"
      >
        <Option value="all">All fields</Option>
        <Option value="name">Name</Option>
        <Option value="type">Type</Option>
        <Option value="purpose">Purpose</Option>
        <Option value="width">Width</Option>
        <Option value="height">Height</Option>
      </Dropdown>
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
              <th
                className={mergeClasses(
                  styles.tableHeadCell,
                  styles.numericCell
                )}
              >
                Cable tray free space [%]
              </th>
              <th className={styles.tableHeadCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((tray) => {
              const isBusy = pendingId === tray.id;
              const freeSpacePercent =
                tray.id in freeSpaceByTrayId
                  ? freeSpaceByTrayId[tray.id]
                  : null;
              const freeSpaceDisplay =
                freeSpacePercent === null
                  ? '-'
                  : `${freeSpaceFormatter.format(freeSpacePercent)} %`;
              const freeSpaceClass =
                freeSpacePercent === null
                  ? undefined
                  : minFreeSpacePercent !== null &&
                    freeSpacePercent < minFreeSpacePercent
                  ? styles.lowFreeSpace
                  : maxFreeSpacePercent !== null &&
                    freeSpacePercent > maxFreeSpacePercent
                  ? styles.highFreeSpace
                  : undefined;
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
                      styles.numericCell,
                      freeSpaceClass
                    )}
                  >
                    {freeSpaceDisplay}
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
};
