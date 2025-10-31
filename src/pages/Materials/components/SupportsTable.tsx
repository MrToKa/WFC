import { Body1, Button, Caption1, Spinner, mergeClasses } from '@fluentui/react-components';
import { MaterialSupport } from '@/api/client';
import { TemplateImagePreview } from './TemplateImagePreview';

type SupportsTableProps = {
  supports: MaterialSupport[];
  isLoading: boolean;
  error: string | null;
  isAdmin: boolean;
  pendingId: string | null;
  isSubmitting: boolean;
  formatNumeric: (value: number | null) => string;
  formatWeight: (value: number | null) => string;
  onEdit: (support: MaterialSupport) => void;
  onDelete: (support: MaterialSupport) => void;
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

export const SupportsTable = ({
  supports,
  isLoading,
  error,
  isAdmin,
  pendingId,
  isSubmitting,
  formatNumeric,
  formatWeight,
  onEdit,
  onDelete,
  token,
  page,
  totalPages,
  onSetPage,
  styles
}: SupportsTableProps) => {
  if (error) {
    return <Body1 className={styles.errorText}>{error}</Body1>;
  }

  if (isLoading) {
    return <Spinner label='Loading supports...' />;
  }

  if (supports.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Caption1>No supports found</Caption1>
        <Body1>
          {isAdmin
            ? 'Use the actions above to add or import support definitions.'
            : 'Supports will appear here once an administrator adds them.'}
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
                Width [mm]
              </th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Length [mm]
              </th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Weight [kg]
              </th>
              {isAdmin ? <th className={styles.tableHeadCell}>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {supports.map((support) => {
              const isBusy = pendingId === support.id;
              return (
                <tr key={support.id}>
                  <td className={styles.tableCell}>{support.type}</td>
                  <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                    {formatNumeric(support.heightMm)}
                  </td>
                  <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                    {formatNumeric(support.widthMm)}
                  </td>
                  <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                    {formatNumeric(support.lengthMm)}
                  </td>
                  <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                    {formatWeight(support.weightKg)}
                  </td>
                  {isAdmin ? (
                    <td className={mergeClasses(styles.tableCell, styles.actionsCell)}>
                      {support.imageTemplateId ? (
                        <TemplateImagePreview
                          token={token}
                          templateId={support.imageTemplateId}
                          fileName={support.imageTemplateFileName}
                          contentType={support.imageTemplateContentType}
                        />
                      ) : null}
                      <Button
                        size='small'
                        onClick={() => onEdit(support)}
                        disabled={isBusy || isSubmitting}
                      >
                        Edit
                      </Button>
                      <Button
                        size='small'
                        appearance='secondary'
                        onClick={() => onDelete(support)}
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
