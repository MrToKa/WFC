import { Body1, Spinner } from '@fluentui/react-components';
import type { MaterialLoadCurve } from '@/api/client';
import { TablePagination } from '../../ProjectDetails/TablePagination';
import { useProjectDetailsStyles } from '../../ProjectDetails.styles';
import { LoadCurveCard } from './LoadCurveCard';

type LoadCurvesGridProps = {
  loadCurves: MaterialLoadCurve[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  isAdmin: boolean;
  pendingId: string | null;
  page: number;
  totalPages: number;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  onSetPage: (page: number) => void;
  onView: (loadCurve: MaterialLoadCurve) => void;
  onEdit: (loadCurve: MaterialLoadCurve) => void;
  onDelete: (loadCurve: MaterialLoadCurve) => void;
  gridClassName: string;
  cardClassName: string;
  chartClassName: string;
  footerClassName: string;
  emptyStateClassName: string;
  paginationClassName: string;
};

export const LoadCurvesGrid = ({
  loadCurves,
  isLoading,
  isRefreshing,
  error,
  isAdmin,
  pendingId,
  page,
  totalPages,
  pageSize,
  onPageSizeChange,
  onSetPage,
  onView,
  onEdit,
  onDelete,
  gridClassName,
  cardClassName,
  chartClassName,
  footerClassName,
  emptyStateClassName,
  paginationClassName,
}: LoadCurvesGridProps) => {
  const paginationStyles = useProjectDetailsStyles();
  if (isLoading && !isRefreshing) {
    return (
      <div className={emptyStateClassName}>
        <Spinner label="Loading load curves..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={emptyStateClassName}>
        <Body1>{error}</Body1>
      </div>
    );
  }

  if (loadCurves.length === 0) {
    return (
      <div className={emptyStateClassName}>
        <Body1>No load curves found. Add a new load curve to get started.</Body1>
      </div>
    );
  }

  return (
    <>
      <div className={gridClassName}>
        {loadCurves.map((loadCurve) => (
          <LoadCurveCard
            key={loadCurve.id}
            loadCurve={loadCurve}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
            isAdmin={isAdmin}
            isPending={pendingId === loadCurve.id}
            className={cardClassName}
            chartClassName={chartClassName}
            footerClassName={footerClassName}
          />
        ))}
      </div>
      <div className={paginationClassName}>
        <TablePagination
          styles={paginationStyles}
          page={page}
          totalPages={Math.max(1, totalPages)}
          onPrevious={() => onSetPage(Math.max(1, page - 1))}
          onNext={() => onSetPage(Math.min(totalPages, page + 1))}
          onPageSelect={onSetPage}
          dropdownAriaLabel="Select load curves page"
          pageSize={pageSize}
          onPageSizeChange={onPageSizeChange}
        />
      </div>
    </>
  );
};
