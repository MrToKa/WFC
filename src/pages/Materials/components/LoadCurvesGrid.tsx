import { Body1, Button, Spinner } from '@fluentui/react-components';
import type { MaterialLoadCurve } from '@/api/client';
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
  onSetPage,
  onView,
  onEdit,
  onDelete,
  gridClassName,
  cardClassName,
  chartClassName,
  footerClassName,
  emptyStateClassName,
  paginationClassName
}: LoadCurvesGridProps) => {
  if (isLoading && !isRefreshing) {
    return (
      <div className={emptyStateClassName}>
        <Spinner label='Loading load curves...' />
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
