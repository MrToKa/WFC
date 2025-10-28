import { useMemo } from 'react';
import {
  Body1,
  Body2,
  Button,
  Caption1,
  Card,
  CardFooter,
  CardHeader,
  CardPreview,
  tokens
} from '@fluentui/react-components';
import type { MaterialLoadCurve } from '@/api/client';
import { LoadCurveChart } from './LoadCurveChart';

type LoadCurveCardProps = {
  loadCurve: MaterialLoadCurve;
  onView: (loadCurve: MaterialLoadCurve) => void;
  onEdit: (loadCurve: MaterialLoadCurve) => void;
  onDelete: (loadCurve: MaterialLoadCurve) => void;
  isAdmin: boolean;
  isPending: boolean;
  className: string;
  chartClassName: string;
  footerClassName: string;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

export const LoadCurveCard = ({
  loadCurve,
  onView,
  onEdit,
  onDelete,
  isAdmin,
  isPending,
  className,
  chartClassName,
  footerClassName
}: LoadCurveCardProps) => {
  const metadata = useMemo(() => {
    const updatedAt = dateFormatter.format(new Date(loadCurve.updatedAt));
    const pointCount = loadCurve.points.length;

    const trayLabel =
      loadCurve.trayType ?? (loadCurve.trayId ? 'Assigned tray' : 'No tray assigned');

    return {
      updatedAt,
      pointCount,
      trayLabel
    };
  }, [loadCurve]);

  return (
    <Card className={className} appearance='outline'>
      <CardHeader
        header={<Body1>{loadCurve.name}</Body1>}
        description={
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            {metadata.trayLabel}
          </Caption1>
        }
      />
      <CardPreview>
        <LoadCurveChart points={loadCurve.points} className={chartClassName} />
      </CardPreview>
      {loadCurve.description ? (
        <Body2 style={{ color: tokens.colorNeutralForeground2 }}>{loadCurve.description}</Body2>
      ) : null}
      <Caption1 style={{ marginTop: '0.5rem', color: tokens.colorNeutralForeground3 }}>
        {metadata.pointCount} {metadata.pointCount === 1 ? 'point' : 'points'}{' '}
        {'\u2022'}{' '}Updated {metadata.updatedAt}
      </Caption1>
      <CardFooter className={footerClassName}>
        <Button appearance='secondary' onClick={() => onView(loadCurve)}>
          View details
        </Button>
        {isAdmin ? (
          <>
            <Button onClick={() => onEdit(loadCurve)}>Edit</Button>
            <Button
              appearance='primary'
              onClick={() => onDelete(loadCurve)}
              disabled={isPending}
            >
              {isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        ) : null}
      </CardFooter>
    </Card>
  );
};


