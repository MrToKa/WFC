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
  Switch,
  mergeClasses
} from '@fluentui/react-components';

import type { Cable } from '@/api/client';
import type { CableSearchCriteria } from './hooks/useCableListSection';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import { toCableFormState, type CableFormState } from '../ProjectDetails.forms';
import { formatDisplayDate, formatNumeric } from '../ProjectDetails.utils';

type CableReportTabProps = {
  styles: ProjectDetailsStyles;
  canManageCables: boolean;
  isAdmin: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onImportClick: () => void;
  onExport: () => void;
  onOpenProgress?: () => void;
  onImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  isImporting: boolean;
  isExporting: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  filterCriteria: CableSearchCriteria;
  onFilterCriteriaChange: (value: CableSearchCriteria) => void;
  inlineEditingEnabled: boolean;
  onInlineEditingToggle: (checked: boolean) => void;
  inlineUpdatingIds: Set<string>;
  isInlineEditable: boolean;
  items: Cable[];
  drafts: Record<string, CableFormState>;
  onDraftChange: (
    cableId: string,
    field: keyof CableFormState,
    value: string
  ) => void;
  onFieldBlur: (cable: Cable, field: keyof CableFormState) => void;
  pendingId: string | null;
  onEdit: (cable: Cable) => void;
  error: string | null;
  isLoading: boolean;
  showPagination: boolean;
  page: number;
  totalPages: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
};

export const CableReportTab = ({
  styles,
  canManageCables,
  isAdmin,
  isRefreshing,
  onRefresh,
  onImportClick,
  onExport,
  onOpenProgress,
  onImportFileChange,
  isImporting,
  isExporting,
  fileInputRef,
  filterText,
  onFilterTextChange,
  filterCriteria,
  onFilterCriteriaChange,
  inlineEditingEnabled,
  onInlineEditingToggle,
  inlineUpdatingIds,
  isInlineEditable,
  items,
  drafts,
  onDraftChange,
  onFieldBlur,
  pendingId,
  onEdit,
  error,
  isLoading,
  showPagination,
  page,
  totalPages,
  onPreviousPage,
  onNextPage
}: CableReportTabProps) => {
  const selectedCriteria = useMemo<string[]>(
    () => [filterCriteria],
    [filterCriteria]
  );

  return (
    <div className={styles.tabPanel} role="tabpanel" aria-label="Cable report">

      <div className={styles.actionsRow}>
        <Button onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing ? 'Refreshing' : 'Refresh'}
        </Button>
        {canManageCables ? (
          <>
            {isAdmin ? (
              <>
                <Button onClick={onImportClick} disabled={isImporting}>
                  {isImporting ? 'Importing' : 'Import from Excel'}
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
            <Button appearance="primary" onClick={onOpenProgress}>
              Progress
            </Button>
            <Button onClick={onExport} disabled={isExporting}>
              {isExporting ? 'Exporting' : 'Export to Excel'}
            </Button>
            <Switch
              checked={inlineEditingEnabled}
              label="Inline edit"
              onChange={(_, data) => onInlineEditingToggle(Boolean(data.checked))}
              disabled={inlineUpdatingIds.size > 0}
            />
          </>
        ) : null}
      </div>

      <div className={styles.filtersRow}>
        <Input
          value={filterText}
          placeholder="Filter cables"
          onChange={(_, data) => onFilterTextChange(data.value)}
          aria-label="Filter cables"
        />
        <Dropdown
          selectedOptions={selectedCriteria}
          value={
            filterCriteria === 'all' ? 'All fields' :
            filterCriteria === 'tag' ? 'Tag' :
            filterCriteria === 'typeName' ? 'Type' :
            filterCriteria === 'fromLocation' ? 'From location' :
            filterCriteria === 'toLocation' ? 'To location' :
            'Routing'
          }
          onOptionSelect={(_, data) =>
            onFilterCriteriaChange(data.optionValue as CableSearchCriteria)
          }
          aria-label="Search criteria"
        >
          <Option value="all">All fields</Option>
          <Option value="tag">Tag</Option>
          <Option value="typeName">Type</Option>
          <Option value="fromLocation">From location</Option>
          <Option value="toLocation">To location</Option>
          <Option value="routing">Routing</Option>
        </Dropdown>
      </div>

      {error ? <Body1 className={styles.errorText}>{error}</Body1> : null}

      {isLoading ? (
        <Spinner label="Loading cables" />
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <Caption1>No cables found</Caption1>
          <Body1>
            {canManageCables
              ? 'Use the actions above to import cables for this project.'
              : 'There are no cables recorded for this project yet.'}
          </Body1>
        </div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>Tag</th>
                <th className={styles.tableHeadCell}>Type</th>
                <th className={styles.tableHeadCell}>From location</th>
                <th className={styles.tableHeadCell}>To location</th>
                <th
                  className={mergeClasses(
                    styles.tableHeadCell,
                    styles.numericCell
                  )}
                >
                  Design length [m]
                </th>
                <th
                  className={mergeClasses(
                    styles.tableHeadCell,
                    styles.numericCell
                  )}
                >
                  Install length [m]
                </th>
                <th className={styles.tableHeadCell}>Pull date</th>
                <th className={styles.tableHeadCell}>Connected from</th>
                <th className={styles.tableHeadCell}>Connected to</th>
                <th className={styles.tableHeadCell}>Tested</th>
                {canManageCables ? (
                  <th className={styles.tableHeadCell}>Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {items.map((cable) => {
                const draft = drafts[cable.id] ?? toCableFormState(cable);
                const isBusy = inlineUpdatingIds.has(cable.id);

                return (
                  <tr key={cable.id}>
                    <td className={styles.tableCell}>{cable.tag ?? '-'}</td>
                    <td className={styles.tableCell}>{cable.typeName ?? '-'}</td>
                    <td className={styles.tableCell}>
                      {cable.fromLocation ?? '-'}
                    </td>
                    <td className={styles.tableCell}>
                      {cable.toLocation ?? '-'}
                    </td>
                    <td
                      className={mergeClasses(
                        styles.tableCell,
                        styles.numericCell
                      )}
                    >
                      {formatNumeric(cable.designLength)}
                    </td>
                    <td
                      className={mergeClasses(
                        styles.tableCell,
                        styles.numericCell
                      )}
                    >
                      {isInlineEditable ? (
                        <Input
                          type="number"
                          min={0}
                          value={draft.installLength}
                          onChange={(_, data) =>
                            onDraftChange(
                              cable.id,
                              'installLength',
                              data.value
                            )
                          }
                          onBlur={() =>
                            onFieldBlur(cable, 'installLength')
                          }
                          disabled={!canManageCables || isBusy}
                        />
                      ) : cable.installLength !== null ? (
                        formatNumeric(cable.installLength)
                    ) : (
                      '-'
                    )}
                  </td>
                    <td className={styles.tableCell}>
                      {isInlineEditable ? (
                        <Input
                          type="date"
                          value={draft.pullDate}
                          onChange={(_, data) =>
                            onDraftChange(cable.id, 'pullDate', data.value)
                          }
                          onBlur={() => onFieldBlur(cable, 'pullDate')}
                          disabled={!canManageCables || isBusy}
                        />
                      ) : cable.pullDate ? (
                        formatDisplayDate(cable.pullDate)
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className={styles.tableCell}>
                      {isInlineEditable ? (
                        <Input
                          type="date"
                          value={draft.connectedFrom}
                          onChange={(_, data) =>
                            onDraftChange(
                              cable.id,
                              'connectedFrom',
                              data.value
                            )
                          }
                          onBlur={() => onFieldBlur(cable, 'connectedFrom')}
                          disabled={!canManageCables || isBusy}
                        />
                      ) : cable.connectedFrom ? (
                        formatDisplayDate(cable.connectedFrom)
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className={styles.tableCell}>
                      {isInlineEditable ? (
                        <Input
                          type="date"
                          value={draft.connectedTo}
                          onChange={(_, data) =>
                            onDraftChange(
                              cable.id,
                              'connectedTo',
                              data.value
                            )
                          }
                          onBlur={() => onFieldBlur(cable, 'connectedTo')}
                          disabled={!canManageCables || isBusy}
                        />
                      ) : cable.connectedTo ? (
                        formatDisplayDate(cable.connectedTo)
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className={styles.tableCell}>
                      {isInlineEditable ? (
                        <Input
                          type="date"
                          value={draft.tested}
                          onChange={(_, data) =>
                            onDraftChange(cable.id, 'tested', data.value)
                          }
                          onBlur={() => onFieldBlur(cable, 'tested')}
                          disabled={!canManageCables || isBusy}
                        />
                      ) : cable.tested ? (
                        formatDisplayDate(cable.tested)
                      ) : (
                        '-'
                      )}
                    </td>
                    {canManageCables ? (
                      <td className={styles.tableCell}>
                        <div className={styles.actionsCell}>
                          <Button
                            size="small"
                            onClick={() => onEdit(cable)}
                            disabled={pendingId === cable.id || isBusy}
                          >
                            Edit
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showPagination ? (
        <div className={styles.pagination}>
          <Button onClick={onPreviousPage} disabled={page === 1}>
            Previous
          </Button>
          <Body1>
            Page {page} of {totalPages}
          </Body1>
          <Button onClick={onNextPage} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
};




