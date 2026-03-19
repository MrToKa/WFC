import { useMemo } from 'react';

import {
  Body1,
  Button,
  Caption1,
  Dropdown,
  Input,
  Option,
  Spinner,
  Tab,
  TabList,
  type TabValue,
  Title3,
  mergeClasses
} from '@fluentui/react-components';

import {
  CABLE_MTO_OPTIONS,
  type CableMtoOption,
  type CableReportSummary
} from '@/api/client';
import type { CableSearchCriteria } from './hooks/useCableListSection';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import { formatNumeric } from '../ProjectDetails.utils';

type CableReportTabProps = {
  styles: ProjectDetailsStyles;
  canManageCables: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onExport: (mto: CableMtoOption | null) => void;
  isExporting: boolean;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  filterCriteria: CableSearchCriteria;
  onFilterCriteriaChange: (value: CableSearchCriteria) => void;
  selectedMto: CableMtoOption | null;
  onSelectedMtoChange: (value: CableMtoOption | null) => void;
  summary: CableReportSummary | null;
  summaryError: string | null;
  summaryLoading: boolean;
};

const REPORT_SCOPE_OPTIONS = [
  { value: 'total', label: 'Total', mto: null },
  ...CABLE_MTO_OPTIONS.map((option) => ({
    value: option,
    label: option,
    mto: option
  }))
] as const;

const formatCountLabel = (
  count: number,
  singular: string,
  plural: string
): string => `${count} ${count === 1 ? singular : plural}`;

export const CableReportTab = ({
  styles,
  canManageCables,
  isRefreshing,
  onRefresh,
  onExport,
  isExporting,
  filterText,
  onFilterTextChange,
  filterCriteria,
  onFilterCriteriaChange,
  selectedMto,
  onSelectedMtoChange,
  summary,
  summaryError,
  summaryLoading
}: CableReportTabProps) => {
  const selectedReportTab = (selectedMto ?? 'total') as TabValue;
  const reportLabel = selectedMto ?? 'Total';
  const selectedCriteria = useMemo<string[]>(
    () => [filterCriteria],
    [filterCriteria]
  );

  const materialRows = useMemo(
    () => {
      if (!summary) {
        return [];
      }

      const grouped = new Map<
        string,
        {
          name: string;
          unit: string;
          totalQuantity: number;
          cableCount: number;
          missingDesignLengthCount: number;
        }
      >();

      for (const cableTypeSummary of summary.cableTypeSummaries) {
        for (const material of cableTypeSummary.materials) {
          const key = `${material.name.toLowerCase()}::${material.unit}`;
          const existing = grouped.get(key);

          if (existing) {
            existing.totalQuantity += material.totalQuantity;
            existing.cableCount += material.cableCount;
            existing.missingDesignLengthCount += material.missingDesignLengthCount;
            continue;
          }

          grouped.set(key, {
            name: material.name,
            unit: material.unit,
            totalQuantity: material.totalQuantity,
            cableCount: material.cableCount,
            missingDesignLengthCount: material.missingDesignLengthCount
          });
        }
      }

      return Array.from(grouped.values())
        .map((material) => ({
          ...material,
          totalQuantity: Math.round(material.totalQuantity * 1000) / 1000
        }))
        .sort((a, b) => {
          const nameCompare = a.name.localeCompare(b.name, undefined, {
            sensitivity: 'base'
          });

          if (nameCompare !== 0) {
            return nameCompare;
          }

          return a.unit.localeCompare(b.unit, undefined, {
            sensitivity: 'base'
          });
        });
    },
    [summary]
  );

  const summaryNotes = useMemo(() => {
    if (!summary) {
      return [];
    }

    const notes = [
      selectedMto
        ? `Totals use the current cable filter and the materials assigned to ${selectedMto} cables.`
        : 'Totals use the current cable filter and the materials assigned to each cable.'
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
  }, [selectedMto, summary]);

  return (
    <div className={styles.tabPanel} role="tabpanel" aria-label="Cable report">
      <div className={styles.actionsRow}>
        <Button onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing ? 'Refreshing' : 'Refresh'}
        </Button>
        {canManageCables ? (
          <>
            <Button onClick={() => onExport(selectedMto)} disabled={isExporting}>
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

      <TabList
        selectedValue={selectedReportTab}
        onTabSelect={(_, data) => {
          if (data.value === 'total') {
            onSelectedMtoChange(null);
            return;
          }

          if (typeof data.value === 'string') {
            onSelectedMtoChange(data.value as CableMtoOption);
          }
        }}
      >
        {REPORT_SCOPE_OPTIONS.map((scope) => (
          <Tab key={scope.value} value={scope.value}>
            {scope.label}
          </Tab>
        ))}
      </TabList>

      <div className={styles.panel}>
        <div className={styles.header}>
          <Title3>{reportLabel} Materials Summary</Title3>
          <Caption1>
            Cable type totals and rolled-up material quantities for{' '}
            {selectedMto
              ? `${selectedMto} cables matching the current filter.`
              : 'the currently filtered cables.'}
          </Caption1>
        </div>

        {summaryLoading ? (
          <Spinner label="Loading cable report summary..." />
        ) : summaryError ? (
          <Body1 className={styles.errorText}>{summaryError}</Body1>
        ) : !summary || summary.cableCount === 0 ? (
          <div className={styles.emptyState}>
            <Caption1>No summary data available</Caption1>
            <Body1>
              Adjust the filter or add cables with design and material data for the selected
              report.
            </Body1>
          </div>
        ) : (
          <>
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
                      <th className={styles.tableHeadCell}>Material</th>
                      <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                        Total quantity
                      </th>
                      <th className={styles.tableHeadCell}>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materialRows.map((material) => (
                      <tr key={`${material.name}:${material.unit}`}>
                        <td className={styles.tableCell}>{material.name}</td>
                        <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                          {formatNumeric(material.totalQuantity)}
                        </td>
                        <td className={styles.tableCell}>{material.unit}</td>
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
