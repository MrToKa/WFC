import { Body1, Button, Caption1, Spinner, mergeClasses } from '@fluentui/react-components';
import { MaterialSupport } from '@/api/client';
import { TemplateImagePreview } from './TemplateImagePreview';
import { TablePagination } from '../../ProjectDetails/TablePagination';
import type { FilterableTableSectionStyles } from '../../ProjectDetails.styles';

type SupportsTableProps = {
  supports: MaterialSupport[];
  isLoading: boolean;
  error: string | null;
  isAdmin: boolean;
  pendingId: string | null;
  isSubmitting: boolean;
  formatNumeric: (value: number | null) => string;
  formatWeight: (value: number | null) => string;
  onDetails: (support: MaterialSupport) => void;
  onEdit: (support: MaterialSupport) => void;
  onDelete: (support: MaterialSupport) => void;
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

export const SupportsTable = ({
  supports,
  isLoading,
  error,
  isAdmin,
  pendingId,
  isSubmitting,
  formatNumeric,
  formatWeight,
  onDetails,
  onEdit,
  onDelete,
  token,
  page,
  totalPages,
  onSetPage,
  hasFilters = false,
  paginationStyles,
  styles,
}: SupportsTableProps) => {
  if (error) {
    return <Body1 className={styles.errorText}>{error}</Body1>;
  }

  if (isLoading) {
    return <Spinner label="Loading supports..." />;
  }

  if (supports.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Caption1>No supports found</Caption1>
        <Body1>
          {hasFilters
            ? 'Try adjusting or clearing your filters.'
            : isAdmin
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
              <th className={styles.tableHeadCell}>Manufacturer</th>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Height [mm]
              </th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>Width [mm]</th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Length [mm]
              </th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                Weight [kg]
              </th>
              <th className={styles.tableHeadCell}>Minimum order</th>
              <th className={styles.tableHeadCell}>Packaging</th>
              <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>Price</th>
              <th className={styles.tableHeadCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {supports.map((support) => {
              const isBusy = pendingId === support.id;
              return (
                <tr key={support.id}>
                  <td className={styles.tableCell}>{support.manufacturer ?? '-'}</td>
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
                  <td className={styles.tableCell}>
                    {support.minimumOrderQuantity} {support.orderMeasurement}
                  </td>
                  <td className={styles.tableCell}>{support.packaging}</td>
                  <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                    {formatNumeric(support.unitPrice)}
                  </td>
                  <td className={styles.tableCell}>
                    <div className={styles.actionsCell}>
                      <Button size="small" onClick={() => onDetails(support)}>
                        Details
                      </Button>
                      {isAdmin ? (
                        <>
                          {support.imageTemplateId ? (
                            <TemplateImagePreview
                              token={token}
                              templateId={support.imageTemplateId}
                              fileName={support.imageTemplateFileName}
                              contentType={support.imageTemplateContentType}
                            />
                          ) : null}
                          <Button
                            size="small"
                            onClick={() => onEdit(support)}
                            disabled={isBusy || isSubmitting}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            appearance="secondary"
                            onClick={() => onDelete(support)}
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
          dropdownAriaLabel="Select supports page"
        />
      ) : null}
    </>
  );
};
