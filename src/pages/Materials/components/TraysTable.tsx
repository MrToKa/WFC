import { Body1, Button, Caption1, Spinner, mergeClasses } from '@fluentui/react-components';
import { MaterialTray } from '@/api/client';
import { TemplateImagePreview } from './TemplateImagePreview';
import { TablePagination } from '../../ProjectDetails/TablePagination';
import type { FilterableTableSectionStyles } from '../../ProjectDetails.styles';

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
  onDetails: (tray: MaterialTray) => void;
  onEdit: (tray: MaterialTray) => void;
  onDelete: (tray: MaterialTray) => void;
  onAssignLoadCurve: (tray: MaterialTray) => void;
  token: string | null;
  page: number;
  totalPages: number;
  onSetPage: (page: number) => void;
  hasFilters?: boolean;
  paginationStyles: Pick<FilterableTableSectionStyles, 'pagination' | 'paginationDropdown'>;
  styles: {
    emptyState: string;
    errorText: string;
    tableWrapper: string;
    table: string;
    tableHeadCell: string;
    tableCell: string;
    numericCell: string;
    actionsCell: string;
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
  onDetails,
  onEdit,
  onDelete,
  onAssignLoadCurve,
  token,
  page,
  totalPages,
  onSetPage,
  hasFilters = false,
  paginationStyles,
  styles,
}: TraysTableProps) => {
  if (error) {
    return <Body1 className={styles.errorText}>{error}</Body1>;
  }

  if (isLoading) {
    return <Spinner label="Loading trays..." />;
  }

  if (trays.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Caption1>No trays found</Caption1>
        <Body1>
          {hasFilters
            ? 'Try adjusting or clearing your filters.'
            : isAdmin
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
              <th className={styles.tableHeadCell}>Manufacturer</th>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Height [mm]
              </th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Rung height [mm]
              </th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>Width [mm]</th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Weight [kg/m]
              </th>
              <th className={styles.tableHeadCell}>Load curve</th>
              <th className={styles.tableHeadCell}>Minimum order</th>
              <th className={styles.tableHeadCell}>Packaging</th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>Price</th>
              <th className={styles.tableHeadCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {trays.map((tray) => {
              const isBusy = pendingId === tray.id;
              const isAssigning = loadCurvePendingId === tray.id;
              return (
                <tr key={tray.id}>
                  <td className={styles.tableCell}>{tray.manufacturer ?? '-'}</td>
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
                  <td className={styles.tableCell}>
                    {tray.minimumOrderQuantity} {tray.orderMeasurement}
                  </td>
                  <td className={styles.tableCell}>{tray.packaging}</td>
                  <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                    {formatNumeric(tray.unitPrice)}
                  </td>
                  <td className={styles.tableCell}>
                    <div className={styles.actionsCell}>
                      <Button size="small" onClick={() => onDetails(tray)}>
                        Details
                      </Button>
                      {isAdmin ? (
                        <>
                          <Button
                            size="small"
                            appearance="secondary"
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
                            size="small"
                            onClick={() => onEdit(tray)}
                            disabled={isBusy || isSubmitting}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            appearance="secondary"
                            onClick={() => onDelete(tray)}
                            disabled={isBusy}
                          >
                            {isBusy ? 'Updating...' : 'Mark obsolete'}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <TablePagination
          styles={paginationStyles}
          page={page}
          totalPages={totalPages}
          onPrevious={() => onSetPage(Math.max(1, page - 1))}
          onNext={() => onSetPage(Math.min(totalPages, page + 1))}
          onPageSelect={onSetPage}
          dropdownAriaLabel="Select trays page"
        />
      ) : null}
    </>
  );
};
