import React from 'react';
import { Caption1, Body1, Spinner } from '@fluentui/react-components';
import { SupportCalculationResult } from '../TrayDetails.types';

interface SupportCalculationsSectionProps {
  supportSectionNeedsSupportData: boolean;
  materialSupportsLoading: boolean;
  supportDetailsError: string | null;
  supportDistanceMissing: boolean;
  trayLengthMissing: boolean;
  supportTypeDisplay: string | null;
  supportLengthMm: number | null;
  supportCalculations: SupportCalculationResult;
  formatSupportNumber: (value: number | null) => string;
  numberFormatter: Intl.NumberFormat;
  styles: Record<string, string>;
}

export const SupportCalculationsSection: React.FC<SupportCalculationsSectionProps> = ({
  supportSectionNeedsSupportData,
  materialSupportsLoading,
  supportDetailsError,
  supportDistanceMissing,
  trayLengthMissing,
  supportTypeDisplay,
  supportLengthMm,
  supportCalculations,
  formatSupportNumber,
  numberFormatter,
  styles
}) => {
  return (
    <div className={styles.section}>
      <Caption1>Supports weight calculations</Caption1>
      {supportSectionNeedsSupportData && materialSupportsLoading ? (
        <Spinner label="Loading support details..." />
      ) : null}
      {supportSectionNeedsSupportData && supportDetailsError ? (
        <Body1 className={styles.errorText}>{supportDetailsError}</Body1>
      ) : null}
      {supportDistanceMissing || trayLengthMissing ? (
        <Body1 className={styles.emptyState}>
          {supportDistanceMissing && trayLengthMissing
            ? 'Tray length and support distance are required for calculations.'
            : supportDistanceMissing
            ? 'Support distance is not configured for this tray.'
            : 'Tray length is not specified for this tray.'}
        </Body1>
      ) : null}
      <div className={styles.grid}>
        <div className={styles.field}>
          <Caption1>Support type</Caption1>
          <Body1>{supportTypeDisplay ?? '-'}</Body1>
        </div>
        <div className={styles.field}>
          <Caption1>Support length [mm]</Caption1>
          <Body1>
            {supportLengthMm !== null ? numberFormatter.format(supportLengthMm) : '-'}
          </Body1>
        </div>
        <div className={styles.field}>
          <Caption1>Supports count</Caption1>
          <Body1>{formatSupportNumber(supportCalculations.supportsCount)}</Body1>
        </div>
        <div className={styles.field}>
          <Caption1>Weight per piece [kg]</Caption1>
          <Body1>{formatSupportNumber(supportCalculations.weightPerPieceKg)}</Body1>
        </div>
        <div className={styles.field}>
          <Caption1>Supports total weight [kg]</Caption1>
          <Body1>{formatSupportNumber(supportCalculations.totalWeightKg)}</Body1>
        </div>
        <div className={styles.field}>
          <Caption1>Supports weight load per meter [kg/m]</Caption1>
          <Body1>{formatSupportNumber(supportCalculations.weightPerMeterKg)}</Body1>
        </div>
      </div>
    </div>
  );
};
