import type { ChangeEvent, RefObject } from 'react';

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

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import type { CableFormState } from '../ProjectDetails.forms';

type CableListTabProps = {
  styles: ProjectDetailsStyles;
  canManageCables: boolean;
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
    field: 'tag' | 'fromLocation' | 'toLocation' | 'routing'
  ) => void;
  onInlineCableTypeChange: (cable: Cable, nextCableTypeId: string) => void;
  pendingId: string | null;
  onEdit: (cable: Cable) => void;
  onDelete: (cable: Cable) => void;
  error: string | null;
  isLoading: boolean;
  showPagination: boolean;
  page: number;
  totalPages: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
};

export const CableListTab = ({
  styles,
  canManageCables,
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
  onEdit,
  onDelete,
  error,
  isLoading,
  showPagination,
  page,
  totalPages,
  onPreviousPage,
  onNextPage
}: CableListTabProps) => (
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
              <th className={styles.tableHeadCell}>Tag</th>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={styles.tableHeadCell}>From location</th>
              <th className={styles.tableHeadCell}>To location</th>
              <th className={styles.tableHeadCell}>Routing</th>
              {canManageCables ? (
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
                  {canManageCables ? (
                    <td className={styles.tableCell}>
                      <div className={styles.actionsCell}>
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
                      </div>
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
