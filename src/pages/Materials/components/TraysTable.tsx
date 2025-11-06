import { Body1, Button, Caption1, Spinner, mergeClasses } from '@fluentui/react-components';
import { MaterialTray } from '@/api/client';
import { TemplateImagePreview } from './TemplateImagePreview';

type TraysTableProps = {
  trays: MaterialTray[];
  isLoading: boolean;
  error: string | null;
  isAdmin: boolean;
  pendingId: string | null;
  loadCurvePendingId: string | null;
  isSubmitting: boolean;
  formatNumeric: (value: number | null) => string;
  formatWeight: (value: number | null) => string;
  onEdit: (tray: MaterialTray) => void;
  onDelete: (tray: MaterialTray) => void;
  onAssignLoadCurve: (tray: MaterialTray) => void;
  token: string | null;
  page: number;
  totalPages: number;
  onSetPage: (page: number) => void;
  styles: {
    emptyState: string;
    errorText: string;
    tableWrapper: string;
    table: string;
    tableHeadCell: string;
    tableCell: string;
    numericCell: string;
    actionsCell: string;
    pagination: string;
  };
};

export const TraysTable = ({
  trays,
  isLoading,
  error,
  isAdmin,
  pendingId,
  loadCurvePendingId,
  isSubmitting,
  formatNumeric,
  formatWeight,
  onEdit,
  onDelete,
  onAssignLoadCurve,
  token,
  page,
  totalPages,
  onSetPage,
  styles
}: TraysTableProps) => {
  if (error) {
    return <Body1 className={styles.errorText}>{error}</Body1>;
  }

  if (isLoading) {
    return <Spinner label='Loading trays...' />;
  }

  if (trays.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Caption1>No trays found</Caption1>
        <Body1>
          {isAdmin
            ? 'Use the actions above to add or import tray definitions.'
            : 'Trays will appear here once an administrator adds them.'}
        </Body1>
      </div>
    );
  }

  return (
    <>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Height [mm]
              </th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Rung height [mm]
              </th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Width [mm]
              </th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Weight [kg/m]
              </th>
              <th className={styles.tableHeadCell}>Load curve</th>
              {isAdmin ? <th className={styles.tableHeadCell}>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {trays.map((tray) => {
              const isBusy = pendingId === tray.id;
              const isAssigning = loadCurvePendingId === tray.id;
              return (
                <tr key={tray.id}>
                  <td className={styles.tableCell}>{tray.type}</td>
                  <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                    {formatNumeric(tray.heightMm)}
                  </td>
                  <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                    {formatNumeric(tray.rungHeightMm)}
                  </td>
                  <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                    {formatNumeric(tray.widthMm)}
                  </td>
                  <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                    {formatWeight(tray.weightKgPerM)}
                  </td>
                  <td className={styles.tableCell}>
                    {tray.loadCurveName ?? 'No load curve assigned'}
                  </td>
                  {isAdmin ? (
                    <td className={mergeClasses(styles.tableCell, styles.actionsCell)}>
                      <Button
                        size='small'
                        appearance='secondary'
                        onClick={() => onAssignLoadCurve(tray)}
                        disabled={isBusy || isSubmitting || isAssigning}
                      >
                        {isAssigning ? 'Updating...' : 'Assign load curve'}
                      </Button>
                      {tray.imageTemplateId ? (
                        <TemplateImagePreview
                          token={token}
                          templateId={tray.imageTemplateId}
                          fileName={tray.imageTemplateFileName}
                          contentType={tray.imageTemplateContentType}
                        />
                      ) : null}
                      <Button
                        size='small'
                        onClick={() => onEdit(tray)}
                        disabled={isBusy || isSubmitting}
                      >
                        Edit
                      </Button>
                      <Button
                        size='small'
                        appearance='secondary'
                        onClick={() => onDelete(tray)}
                        disabled={isBusy}
                      >
                        {isBusy ? 'Deleting...' : 'Delete'}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.pagination}>
        <Button
          size='small'
          onClick={() => onSetPage(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <Body1>
          Page {Math.max(1, Math.min(page, Math.max(1, totalPages)))} of {Math.max(1, totalPages)}
        </Body1>
        <Button
          size='small'
          onClick={() =>
            onSetPage(totalPages > 0 ? Math.min(totalPages, page + 1) : page)
          }
          disabled={totalPages > 0 ? page >= totalPages : true}
        >
          Next
        </Button>
      </div>
    </>
  );
};
