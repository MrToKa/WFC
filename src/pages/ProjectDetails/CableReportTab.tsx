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
  Title3,
  mergeClasses
} from '@fluentui/react-components';

import type { CableReportSummary } from '@/api/client';
import type { CableSearchCriteria } from './hooks/useCableListSection';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import { formatNumeric } from '../ProjectDetails.utils';

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
  summary: CableReportSummary | null;
  summaryError: string | null;
  summaryLoading: boolean;
};

const formatCountLabel = (
  count: number,
  singular: string,
  plural: string
): string => `${count} ${count === 1 ? singular : plural}`;

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
  summary,
  summaryError,
  summaryLoading
}: CableReportTabProps) => {
  const selectedCriteria = useMemo<string[]>(
    () => [filterCriteria],
    [filterCriteria]
  );

  const materialRows = useMemo(
    () =>
      summary?.cableTypeSummaries.flatMap((cableTypeSummary) =>
        cableTypeSummary.materials.map((material) => ({
          cableTypeId: cableTypeSummary.cableTypeId,
          typeName: cableTypeSummary.typeName,
          ...material
        }))
      ) ?? [],
    [summary]
  );

  const summaryNotes = useMemo(() => {
    if (!summary) {
      return [];
    }

    const notes = [
      'Totals use the current cable filter and the materials assigned to each cable.'
    ];

    if (summary.omittedMaterialCount > 0) {
      notes.push(
        `${formatCountLabel(
          summary.omittedMaterialCount,
          'material row without quantity or unit is excluded from totals',
          'material rows without quantity or unit are excluded from totals'
        )}.`
      );
    }

    if (summary.missingDesignLengthMaterialCount > 0) {
      notes.push(
        `${formatCountLabel(
          summary.missingDesignLengthMaterialCount,
          'pcs/m material row could not be converted because the cable has no design length',
          'pcs/m material rows could not be converted because the cable has no design length'
        )}.`
      );
    }

    notes.push('Materials with unit pcs/m are converted to pcs using cable design length.');

    return notes;
  }, [summary]);

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
            filterCriteria === 'all'
              ? 'All fields'
              : filterCriteria === 'tag'
                ? 'Tag'
                : filterCriteria === 'typeName'
                  ? 'Type'
                  : filterCriteria === 'fromLocation'
                    ? 'From location'
                    : filterCriteria === 'toLocation'
                      ? 'To location'
                      : 'Routing'
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

      <div className={styles.panel}>
        <div className={styles.header}>
          <Title3>Materials summary</Title3>
          <Caption1>
            Cable type totals and rolled-up material quantities for the currently filtered cables.
          </Caption1>
        </div>

        {summaryLoading ? (
          <Spinner label="Loading cable report summary..." />
        ) : summaryError ? (
          <Body1 className={styles.errorText}>{summaryError}</Body1>
        ) : !summary || summary.cableCount === 0 ? (
          <div className={styles.emptyState}>
            <Caption1>No summary data available</Caption1>
            <Body1>Adjust the filter or add cables with design and material data.</Body1>
          </div>
        ) : (
          <>
            <div className={styles.metadata}>
              <div className={styles.numericField}>
                <Caption1>Filtered cables</Caption1>
                <Body1 className={styles.numericFieldLabel}>{summary.cableCount}</Body1>
              </div>
              <div className={styles.numericField}>
                <Caption1>Cable types</Caption1>
                <Body1 className={styles.numericFieldLabel}>{summary.cableTypeCount}</Body1>
              </div>
              <div className={styles.numericField}>
                <Caption1>Total design length [m]</Caption1>
                <Body1 className={styles.numericFieldLabel}>
                  {formatNumeric(summary.totalDesignLength)}
                </Body1>
              </div>
            </div>

            {summaryNotes.map((note) => (
              <Caption1 key={note}>{note}</Caption1>
            ))}

            <div className={styles.header}>
              <Title3>Cable type totals</Title3>
            </div>
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.tableHeadCell}>Cable type</th>
                    <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                      Cables
                    </th>
                    <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                      Design length [m]
                    </th>
                    <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                      Materials
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.cableTypeSummaries.map((cableTypeSummary) => (
                    <tr key={cableTypeSummary.cableTypeId}>
                      <td className={styles.tableCell}>{cableTypeSummary.typeName}</td>
                      <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                        {formatNumeric(cableTypeSummary.cableCount)}
                      </td>
                      <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                        {formatNumeric(cableTypeSummary.totalDesignLength)}
                      </td>
                      <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                        {formatNumeric(cableTypeSummary.materials.length)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.header}>
              <Title3>Material totals</Title3>
            </div>
            {materialRows.length === 0 ? (
              <div className={styles.emptyState}>
                <Caption1>No summable materials found</Caption1>
                <Body1>
                  Add material quantities and units to cables or cable type defaults to see totals.
                </Body1>
              </div>
            ) : (
              <div className={styles.tableContainer}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.tableHeadCell}>Cable type</th>
                      <th className={styles.tableHeadCell}>Material</th>
                      <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                        Total quantity
                      </th>
                      <th className={styles.tableHeadCell}>Unit</th>
                      <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                        Cables
                      </th>
                      <th className={styles.tableHeadCell}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materialRows.map((material) => (
                      <tr
                        key={`${material.cableTypeId}:${material.name}:${material.unit}`}
                      >
                        <td className={styles.tableCell}>{material.typeName}</td>
                        <td className={styles.tableCell}>{material.name}</td>
                        <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                          {formatNumeric(material.totalQuantity)}
                        </td>
                        <td className={styles.tableCell}>{material.unit}</td>
                        <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                          {formatNumeric(material.cableCount)}
                        </td>
                        <td className={styles.tableCell}>
                          {material.missingDesignLengthCount > 0
                            ? `Skipped ${formatCountLabel(
                                material.missingDesignLengthCount,
                                'cable',
                                'cables'
                              )} without design length`
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
