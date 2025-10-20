import { useEffect, useMemo, useState } from 'react';

import {
  Body1,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Subtitle2,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';

import type { Cable } from '@/api/client';

import { isIsoDateString } from '../ProjectDetails.utils';

const METRIC_CONFIG = [
  { key: 'pullDate', label: 'Pull date' },
  { key: 'connectedFrom', label: 'Connected from' },
  { key: 'connectedTo', label: 'Connected to' },
  { key: 'tested', label: 'Tested' }
] as const;

type MetricKey = (typeof METRIC_CONFIG)[number]['key'];

type ProgressDialogProps = {
  open: boolean;
  cables: Cable[];
  onDismiss: () => void;
};

const useStyles = makeStyles({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    width: 'min(32rem, 90vw)'
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: '0.75rem'
  },
  metricsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  metricsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  metricRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(8rem, 0.45fr) 1fr minmax(3.5rem, auto)',
    alignItems: 'center',
    gap: '0.75rem'
  },
  metricLabel: {
    fontWeight: tokens.fontWeightSemibold
  },
  barTrack: {
    position: 'relative',
    height: '0.5rem',
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground4,
    overflow: 'hidden'
  },
  barFill: {
    position: 'absolute',
    inset: 0,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorPaletteBlueForeground2
  },
  metricValue: {
    justifySelf: 'end',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: tokens.fontWeightSemibold
  },
  summary: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeadCell: {
    textAlign: 'left',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2
  },
  tableCell: {
    paddingBlock: '0.25rem',
    paddingInline: 0,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`
  },
  noData: {
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground4,
    ...shorthands.padding('1rem'),
    borderRadius: tokens.borderRadiusMedium
  }
});

const getTodayIso = (): string => new Date().toISOString().slice(0, 10);

const toIsoDate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const isoCandidate = trimmed.slice(0, 10);

  if (!isIsoDateString(isoCandidate)) {
    return null;
  }

  return isoCandidate;
};

export const ProgressDialog = ({ open, cables, onDismiss }: ProgressDialogProps) => {
  const styles = useStyles();
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayIso());

  useEffect(() => {
    if (open) {
      setSelectedDate(getTodayIso());
    }
  }, [open]);

  const totalCables = cables.length;
  const metrics = useMemo(() => {
    const cutoff = selectedDate || '9999-12-31';

    return METRIC_CONFIG.map(({ key, label }) => {
      const completed = cables.reduce((count, cable) => {
        const isoValue = toIsoDate(cable[key as MetricKey]);
        return isoValue && isoValue <= cutoff ? count + 1 : count;
      }, 0);

      return {
        key,
        label,
        count: completed,
        percentage: totalCables > 0 ? Math.round((completed / totalCables) * 100) : 0
      };
    });
  }, [cables, selectedDate, totalCables]);

  const hasProgress = metrics.some((metric) => metric.count > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) {
          onDismiss();
        }
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Project progress</DialogTitle>
          <DialogContent className={styles.content}>
            <div className={styles.controls}>
              <Field label="Show progress up to">
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(_, data) => setSelectedDate(data.value ?? '')}
                />
              </Field>
              <Button
                appearance="secondary"
                type="button"
                onClick={() => setSelectedDate(getTodayIso())}
              >
                Reset to today
              </Button>
            </div>

            <div className={styles.summary}>
              <Subtitle2>Total cables tracked: {totalCables}</Subtitle2>
              <Body1>
                Completed stage counts consider items dated on or before the selected day.
              </Body1>
            </div>

            <section className={styles.metricsSection} aria-label="Progress overview">
              <div className={styles.metricsList}>
                {metrics.map((metric) => (
                  <div key={metric.key} className={styles.metricRow}>
                    <span className={styles.metricLabel}>{metric.label}</span>
                    <div className={styles.barTrack} aria-hidden="true">
                      <div
                        className={styles.barFill}
                        style={{ width: `${metric.percentage}%` }}
                      />
                    </div>
                    <span className={styles.metricValue}>
                      {metric.count}
                      {totalCables ? ` / ${totalCables}` : ''}
                    </span>
                  </div>
                ))}
              </div>

              {hasProgress ? (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.tableHeadCell}>Stage</th>
                      <th className={styles.tableHeadCell}>Completed</th>
                      <th className={styles.tableHeadCell}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((metric) => (
                      <tr key={`${metric.key}-summary`}>
                        <td className={styles.tableCell}>{metric.label}</td>
                        <td className={styles.tableCell}>{metric.count}</td>
                        <td className={styles.tableCell}>
                          {totalCables
                            ? `${metric.percentage.toString()}%`
                            : '0%'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className={styles.noData}>
                  No cables are completed for the selected stage and date yet.
                </div>
              )}
            </section>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onDismiss}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};

