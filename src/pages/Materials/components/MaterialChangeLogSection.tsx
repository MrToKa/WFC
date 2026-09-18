import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Body1,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { fetchMaterialChangeLog } from '@/api/client';
import type { MaterialDetailsCategory, ProjectChangeLogEntry } from '@/api/client';
import { ChangeLogTable } from '@/components/ChangeLogTable';
import { useAuth } from '@/context/AuthContext';
import { canExportChangeLogs } from '@/utils/permissions';

const useStyles = makeStyles({
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalM,
  },
});

export const MaterialChangeLogSection = ({
  category,
  materialId,
  refreshKey,
}: {
  category: MaterialDetailsCategory;
  materialId: string;
  refreshKey: unknown;
}) => {
  const styles = useStyles();
  const { user, token } = useAuth();
  const [entries, setEntries] = useState<ProjectChangeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setEntries([]);
    void fetchMaterialChangeLog(category, materialId)
      .then(
        (response) => {
          if (active) setEntries(response.changeLog);
        },
        () => {
          if (active) setError('Unable to load material change log.');
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [category, materialId, refreshKey, retry]);

  return (
    <Accordion collapsible defaultOpenItems={[]} key={`${category}:${materialId}`}>
      <AccordionItem value="change-log" className={styles.card}>
        <AccordionHeader>Change log</AccordionHeader>
        <AccordionPanel className={styles.content}>
          <Body1>Changes are recorded from the introduction of change tracking.</Body1>
          <ChangeLogTable
            entries={entries}
            fileName={`material-${category}-${materialId}-change-log`}
            canExport={canExportChangeLogs(user, token)}
            loading={loading}
            error={error}
            onRetry={() => setRetry((value) => value + 1)}
          />
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
};
