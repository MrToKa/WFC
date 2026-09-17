import { ChangeLogTable } from '@/components/ChangeLogTable';
import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
} from '@fluentui/react-components';
import { fetchCableListHistory, type Cable, type ProjectChangeLogEntry } from '@/api/client';
import type { FilterableTableSectionStyles } from '../ProjectDetails.styles';
import { diffCableVersions, formatCableVersionUser } from './cableVersionUtils';

export type ChangeLogSource = {
  id: string;
  name: string;
  changeLog?: ProjectChangeLogEntry[];
};

type Props = {
  fileName?: string;
  canExport?: boolean;
  styles: FilterableTableSectionStyles & { panel?: string };
  items: ChangeLogSource[];
  loading?: boolean;
  error?: string | null;
};

export const SectionChangeLog = ({
  styles,
  items,
  loading,
  error,
  fileName = 'change-log',
  canExport = false,
}: Props) => {
  const entries = useMemo(
    () =>
      items.flatMap((item) =>
        (item.changeLog ?? []).map((entry) => ({ ...entry, itemId: item.id, name: item.name })),
      ),
    [items],
  );

  return (
    <Accordion collapsible defaultOpenItems={[]}>
      <AccordionItem value="change-log" className={styles.panel}>
        <AccordionHeader>Change log</AccordionHeader>
        <AccordionPanel>
          <ChangeLogTable
            entries={entries}
            showItem
            fileName={fileName}
            canExport={canExport}
            loading={loading}
            error={error}
          />
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
};

export const CableListChangeLog = ({
  styles,
  projectId,
  cables,
  canExport = false,
}: {
  styles: FilterableTableSectionStyles;
  projectId: string;
  cables: Cable[];
  canExport?: boolean;
}) => {
  const [items, setItems] = useState<ChangeLogSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchCableListHistory(projectId)
      .then((response) => {
        if (cancelled) return;
        const sources = new Map(
          response.cables.map((cable) => [
            cable.id,
            {
              id: cable.id,
              name: cable.tag?.trim() || `Cable ${cable.cableId}`,
              changeLog: [...(cable.changeLog ?? [])],
            },
          ]),
        );
        const previousVersions = new Map<string, (typeof response.versions)[number]>();
        for (const version of [...response.versions].sort(
          (a, b) => a.versionNumber - b.versionNumber,
        )) {
          const previous = previousVersions.get(version.cableRecordId) ?? null;
          const source = sources.get(version.cableRecordId);
          source?.changeLog.push({
            id: version.id,
            userId: version.changedBy?.id ?? '',
            userName: formatCableVersionUser(version),
            changedAt: version.changedAt,
            changes: [
              `${version.changeType === 'create' ? 'Created' : 'Updated'} via ${version.changeSource === 'import' ? 'import' : 'manual save'} (v${version.versionNumber}).`,
              ...diffCableVersions(version, previous).map(
                (change) => `${change.label}: ${change.previousValue} → ${change.nextValue}`,
              ),
            ],
          });
          previousVersions.set(version.cableRecordId, version);
        }
        setItems([...sources.values()]);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load change log. Use Refresh to try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, cables]);

  return (
    <SectionChangeLog
      styles={styles}
      items={items}
      loading={loading}
      error={error}
      canExport={canExport}
      fileName={`project-${projectId}-cables-change-log`}
    />
  );
};
