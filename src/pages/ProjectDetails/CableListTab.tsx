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
  Switch
} from '@fluentui/react-components';

import type { Cable, CableType } from '@/api/client';
import type { CableSearchCriteria } from './hooks/useCableListSection';
import { TablePagination } from './TablePagination';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import type { CableFormState } from '../ProjectDetails.forms';

type CableListTabProps = {
  styles: ProjectDetailsStyles;
  canManageCables: boolean;
  isAdmin: boolean;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  filterCriteria: CableSearchCriteria;
  onFilterCriteriaChange: (value: CableSearchCriteria) => void;
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
  inlineEditingEnabled: boolean;
  onInlineEditingToggle: (checked: boolean) => void;
  inlineUpdatingIds: Set<string>;
  isInlineEditable: boolean;
  cableTypes: CableType[];
  items: Cable[];
  drafts: Record<string, CableFormState>;
  onDraftChange: (
    cableId: string,
    field: keyof CableFormState,
    value: string
  ) => void;
  onTextFieldBlur: (
    cable: Cable,
    field: 'tag' | 'fromLocation' | 'toLocation' | 'routing' | 'designLength'
  ) => void;
  onInlineCableTypeChange: (cable: Cable, nextCableTypeId: string) => void;
  pendingId: string | null;
  onDetails?: (cable: Cable) => void;
  onEdit: (cable: Cable) => void;
  onDelete: (cable: Cable) => void;
  error: string | null;
  isLoading: boolean;
  showPagination: boolean;
  page: number;
  totalPages: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSelect: (page: number) => void;
};

export const CableListTab = ({
  styles,
  canManageCables,
  isAdmin,
  filterText,
  onFilterTextChange,
  filterCriteria,
  onFilterCriteriaChange,
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
  inlineEditingEnabled,
  onInlineEditingToggle,
  inlineUpdatingIds,
  isInlineEditable,
  cableTypes,
  items,
  drafts,
  onDraftChange,
  onTextFieldBlur,
  onInlineCableTypeChange,
  pendingId,
  onDetails,
  onEdit,
  onDelete,
  error,
  isLoading,
  showPagination,
  page,
  totalPages,
  onPreviousPage,
  onNextPage,
  onPageSelect
}: CableListTabProps) => {
  const selectedCriteria = useMemo<string[]>(
    () => [filterCriteria],
    [filterCriteria]
  );
  const showActions = Boolean(onDetails) || canManageCables;

  return (
    <div className={styles.tabPanel} role="tabpanel" aria-label="Cable list">
    <div className={styles.actionsRow}>
      <Button onClick={onRefresh} disabled={isRefreshing}>
        {isRefreshing ? 'Refreshing...' : 'Refresh'}
      </Button>
      {canManageCables ? (
        <>
          <Button
            appearance="primary"
            onClick={onCreate}
            disabled={cableTypes.length === 0}
          >
            Add cable
          </Button>
          {isAdmin ? (
            <>
              <Button onClick={onImportClick} disabled={isImporting}>
                {isImporting ? 'Importing...' : 'Import from Excel'}
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
          <Button
            appearance="secondary"
            onClick={onExport}
            disabled={isExporting}
          >
            {isExporting ? 'Exporting...' : 'Export to Excel'}
          </Button>
          <Switch
            checked={inlineEditingEnabled}
            label="Inline edit"
            onChange={(_, data) =>
              onInlineEditingToggle(Boolean(data.checked))
            }
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
      <Spinner label="Loading cables..." />
    ) : items.length === 0 ? (
      <div className={styles.emptyState}>
        <Caption1>No cables found</Caption1>
        <Body1>
          {canManageCables
            ? isAdmin
              ? 'Add a cable manually or import a list from Excel.'
              : 'Add a cable manually to start building this list.'
            : 'No cables have been recorded for this project yet.'}
        </Body1>
      </div>
    ) : (
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>
                ID
              </th>
              <th className={styles.tableHeadCell}>
                Tag
              </th>
              <th className={styles.tableHeadCell}>
                Type
              </th>
              <th className={styles.tableHeadCell}>
                From location
              </th>
              <th className={styles.tableHeadCell}>
                To location
              </th>
              <th className={styles.tableHeadCell}>
                Routing
              </th>
              <th
                className={`${styles.tableHeadCell} ${styles.numericCell}`}
              >
                Design length [m]
              </th>
              {showActions ? (
                <th className={styles.tableHeadCell}>Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {items.map((cable) => {
              const isBusy = pendingId === cable.id;
              const draft = drafts[cable.id];
              const isRowUpdating = inlineUpdatingIds.has(cable.id);
              const disableActions = isBusy || isRowUpdating;
              const currentCableType = cableTypes.find(
                (type) => type.id === draft?.cableTypeId
              );
              return (
                <tr key={cable.id}>
                  <td className={styles.tableCell}>{cable.cableId}</td>
                  <td className={styles.tableCell}>
                    {isInlineEditable && draft ? (
                      <Input
                        size="small"
                        value={draft.tag}
                        onChange={(_, data) =>
                          onDraftChange(cable.id, 'tag', data.value)
                        }
                        onBlur={() => onTextFieldBlur(cable, 'tag')}
                        disabled={isRowUpdating}
                        aria-label="Cable tag"
                      />
                    ) : (
                      cable.tag ?? '-'
                    )}
                  </td>
                  <td className={styles.tableCell}>
                    {isInlineEditable && draft ? (
                      <Dropdown
                        size="small"
                        selectedOptions={
                          draft.cableTypeId ? [draft.cableTypeId] : []
                        }
                        value={currentCableType?.name ?? ''}
                        onOptionSelect={(_, data) => {
                          const nextTypeId = data.optionValue ?? '';
                          onDraftChange(cable.id, 'cableTypeId', nextTypeId);
                          if (!data.optionValue) {
                            return;
                          }
                          onInlineCableTypeChange(cable, data.optionValue);
                        }}
                        disabled={isRowUpdating}
                        aria-label="Cable type"
                      >
                        {cableTypes.map((type) => (
                          <Option key={type.id} value={type.id}>
                            {type.name}
                          </Option>
                        ))}
                      </Dropdown>
                    ) : (
                      cable.typeName
                    )}
                  </td>
                  <td className={styles.tableCell}>
                    {isInlineEditable && draft ? (
                      <Input
                        size="small"
                        value={draft.fromLocation}
                        onChange={(_, data) =>
                          onDraftChange(cable.id, 'fromLocation', data.value)
                        }
                        onBlur={() => onTextFieldBlur(cable, 'fromLocation')}
                        disabled={isRowUpdating}
                        aria-label="From location"
                      />
                    ) : (
                      cable.fromLocation ?? '-'
                    )}
                  </td>
                  <td className={styles.tableCell}>
                    {isInlineEditable && draft ? (
                      <Input
                        size="small"
                        value={draft.toLocation}
                        onChange={(_, data) =>
                          onDraftChange(cable.id, 'toLocation', data.value)
                        }
                        onBlur={() => onTextFieldBlur(cable, 'toLocation')}
                        disabled={isRowUpdating}
                        aria-label="To location"
                      />
                    ) : (
                      cable.toLocation ?? '-'
                    )}
                  </td>
                  <td className={styles.tableCell}>
                    {isInlineEditable && draft ? (
                      <Input
                        size="small"
                        value={draft.routing}
                        onChange={(_, data) =>
                          onDraftChange(cable.id, 'routing', data.value)
                        }
                        onBlur={() => onTextFieldBlur(cable, 'routing')}
                        disabled={isRowUpdating}
                        aria-label="Routing"
                      />
                    ) : (
                      cable.routing ?? '-'
                    )}
                  </td>
                  <td
                    className={`${styles.tableCell} ${styles.numericCell}`}
                  >
                    {isInlineEditable && draft ? (
                      <Input
                        size="small"
                        type="number"
                        min={0}
                        value={draft.designLength}
                        onChange={(_, data) =>
                          onDraftChange(cable.id, 'designLength', data.value)
                        }
                        onBlur={() => onTextFieldBlur(cable, 'designLength')}
                        disabled={isRowUpdating}
                        aria-label="Design length"
                      />
                    ) : cable.designLength !== null ? (
                      cable.designLength
                    ) : (
                      '-'
                    )}
                  </td>
                  {showActions ? (
                    <td className={styles.tableCell}>
                      <div className={styles.actionsCell}>
                        {onDetails ? (
                          <Button size="small" onClick={() => onDetails(cable)}>
                            Details
                          </Button>
                        ) : null}
                        {canManageCables ? (
                          <>
                            <Button
                              size="small"
                              onClick={() => onEdit(cable)}
                              disabled={disableActions}
                            >
                              Edit
                            </Button>
                            <Button
                              size="small"
                              appearance="secondary"
                              onClick={() => onDelete(cable)}
                              disabled={disableActions}
                            >
                              Delete
                            </Button>
                          </>
                        ) : null}
                      </div>
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
            onPrevious={onPreviousPage}
            onNext={onNextPage}
            onPageSelect={onPageSelect}
            dropdownAriaLabel="Select cable list page"
          />
        ) : null}
      </div>
    )}
  </div>
  );
};
