import type { ReactNode } from 'react';
import {
  Body1,
  Button,
  Card,
  Caption1,
  Spinner,
  Title2,
  Title3,
  makeStyles,
  tokens,
} from '@fluentui/react-components';

const useStyles = makeStyles({
  root: {
    display: 'grid',
    gap: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalXXL,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalS,
  },
  header: {
    display: 'grid',
    gap: tokens.spacingVerticalXS,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: tokens.spacingHorizontalM,
  },
  property: {
    display: 'grid',
    gap: tokens.spacingVerticalXXS,
  },
  value: {
    overflowWrap: 'anywhere',
  },
  state: {
    display: 'grid',
    justifyItems: 'start',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalXXL,
  },
  error: {
    color: tokens.colorStatusDangerForeground1,
  },
});

export type MaterialProperty = {
  label: string;
  value: ReactNode;
};

export const MaterialSourceLink = ({ source }: { source?: string | null }) =>
  source ? (
    <a href={source} target="_blank" rel="noreferrer">
      {source}
    </a>
  ) : (
    '—'
  );

type MaterialDetailsLayoutProps = {
  title: string;
  categoryLabel: string;
  properties: MaterialProperty[];
  createdAt: string;
  updatedAt: string;
  onBack: () => void;
  onEdit?: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  children?: ReactNode;
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
};

export const MaterialDetailsLoading = () => {
  const styles = useStyles();
  return (
    <div className={styles.state}>
      <Spinner label="Loading material details..." />
    </div>
  );
};

export const MaterialDetailsError = ({
  message,
  onBack,
  onRetry,
}: {
  message: string;
  onBack: () => void;
  onRetry: () => void;
}) => {
  const styles = useStyles();
  return (
    <section className={styles.state} aria-labelledby="material-details-error-heading">
      <Title2 as="h1" id="material-details-error-heading">
        Material details
      </Title2>
      <Body1 className={styles.error}>{message}</Body1>
      <div className={styles.actions}>
        <Button appearance="primary" onClick={onBack}>
          Back to Materials
        </Button>
        <Button onClick={onRetry}>Try again</Button>
      </div>
    </section>
  );
};

export const MaterialDetailsLayout = ({
  title,
  categoryLabel,
  properties,
  createdAt,
  updatedAt,
  onBack,
  onEdit,
  onRefresh,
  refreshing,
  children,
}: MaterialDetailsLayoutProps) => {
  const styles = useStyles();
  return (
    <section className={styles.root} aria-labelledby="material-details-heading">
      <div className={styles.actions}>
        <Button appearance="secondary" onClick={onBack}>
          Back to Materials
        </Button>
        {onEdit ? (
          <Button appearance="primary" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
        <Button onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>
      <header className={styles.header}>
        <Caption1>{categoryLabel}</Caption1>
        <Title2 as="h1" id="material-details-heading">
          {title}
        </Title2>
      </header>
      <Card>
        <Title3 as="h2">Properties</Title3>
        <div className={styles.grid}>
          {properties.map((property) => (
            <div className={styles.property} key={property.label}>
              <Caption1>{property.label}</Caption1>
              <Body1 className={styles.value}>{property.value ?? '—'}</Body1>
            </div>
          ))}
          <div className={styles.property}>
            <Caption1>Created</Caption1>
            <Body1>{formatDate(createdAt)}</Body1>
          </div>
          <div className={styles.property}>
            <Caption1>Updated</Caption1>
            <Body1>{formatDate(updatedAt)}</Body1>
          </div>
        </div>
      </Card>
      {children}
    </section>
  );
};
