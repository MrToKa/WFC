import { useMemo, useState } from 'react';
import { Body1, Button, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import type { ProjectChangeLogEntry } from '@/api/types/project';
import { TablePagination } from '@/pages/ProjectDetails/TablePagination';

export type ChangeLogEntry = Omit<ProjectChangeLogEntry, 'userId'> & {
  userId?: string;
  itemId?: string;
  name?: string;
  revision?: string;
};

const PAGE_SIZE = 10;
const EMPTY_ENTRIES: ChangeLogEntry[] = [];
const useStyles = makeStyles({
  content: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  actions: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' },
  tableContainer: { width: '100%', overflowX: 'auto' },
  table: { width: '100%', minWidth: '28rem', borderCollapse: 'collapse' },
  head: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  cell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
  },
  pagination: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' },
  paginationDropdown: { minWidth: '7rem' },
  error: { color: tokens.colorPaletteRedForeground1 },
});

type Props = {
  entries?: ChangeLogEntry[];
  label?: string;
  fileName: string;
  showItem?: boolean;
  showRevision?: boolean;
  canExport?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

export const ChangeLogTable = ({
  entries = EMPTY_ENTRIES,
  label = 'Change log',
  fileName,
  showItem = false,
  showRevision = false,
  canExport = true,
  loading = false,
  error,
  onRetry,
}: Props) => {
  const styles = useStyles();
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt)),
    [entries],
  );
  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedEntries = sortedEntries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const exportHistory = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const { exportChangeLog } = await import('@/utils/exportChangeLog');
      exportChangeLog(sortedEntries, { fileName, showItem, showRevision });
    } catch {
      setExportError('Failed to export change log. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={styles.content}>
      {canExport ? (
        <div className={styles.actions}>
          <Button
            onClick={() => void exportHistory()}
            disabled={exporting || loading || Boolean(error) || !entries.length}
          >
            {exporting ? 'Exporting...' : 'Export change log to Excel'}
          </Button>
        </div>
      ) : null}
      {exportError ? (
        <Body1 role="alert" className={styles.error}>
          {exportError}
        </Body1>
      ) : null}
      {loading ? <Spinner label="Loading change log..." /> : null}
      {error ? (
        <div className={styles.actions}>
          <Body1 role="alert" className={styles.error}>
            {error}
          </Body1>
          {onRetry ? <Button onClick={onRetry}>Retry history</Button> : null}
        </div>
      ) : null}
      {sortedEntries.length ? (
        <>
          <div className={styles.tableContainer}>
            <table className={styles.table} aria-label={label}>
              <thead>
                <tr>
                  {[
                    ...(showItem ? ['Item'] : []),
                    'Who',
                    'When',
                    ...(showRevision ? ['Revision'] : []),
                    'Changes',
                  ].map((heading) => (
                    <th key={heading} className={styles.head} scope="col">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedEntries.map((entry) => (
                  <tr key={`${entry.itemId ?? ''}:${entry.id}`}>
                    {showItem ? <td className={styles.cell}>{entry.name}</td> : null}
                    <td className={styles.cell}>{entry.userName}</td>
                    <td className={styles.cell}>{new Date(entry.changedAt).toLocaleString()}</td>
                    {showRevision ? <td className={styles.cell}>{entry.revision}</td> : null}
                    <td className={styles.cell}>
                      <ul>
                        {entry.changes.map((change, index) => (
                          <li key={index}>{change}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <TablePagination
              styles={styles}
              page={currentPage}
              totalPages={totalPages}
              onPrevious={() => setPage(Math.max(1, currentPage - 1))}
              onNext={() => setPage(Math.min(totalPages, currentPage + 1))}
              onPageSelect={(next) => setPage(Math.max(1, Math.min(totalPages, next)))}
              dropdownAriaLabel={`Select ${label.toLowerCase()} page`}
            />
          ) : null}
        </>
      ) : !loading && !error ? (
        <Body1>No recorded changes yet. Future saved changes will appear here.</Body1>
      ) : null}
    </div>
  );
};
