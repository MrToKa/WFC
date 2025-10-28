import React from 'react';
import { Caption1, Body1 } from '@fluentui/react-components';
import { Tray } from '../../../api/client';

interface TrayInfoSectionProps {
  tray: Tray;
  weightDisplay: string;
  numberFormatter: Intl.NumberFormat;
  styles: Record<string, string>;
}

export const TrayInfoSection: React.FC<TrayInfoSectionProps> = ({
  tray,
  weightDisplay,
  numberFormatter,
  styles
}) => {
  return (
    <div className={styles.grid}>
      <div className={styles.field}>
        <Caption1>Name</Caption1>
        <Body1>{tray.name}</Body1>
      </div>
      <div className={styles.field}>
        <Caption1>Type</Caption1>
        <Body1>{tray.type ?? '-'}</Body1>
      </div>
      <div className={styles.field}>
        <Caption1>Purpose</Caption1>
        <Body1>{tray.purpose ?? '-'}</Body1>
      </div>
      <div className={styles.field}>
        <Caption1>Width [mm]</Caption1>
        <Body1>
          {tray.widthMm !== null ? numberFormatter.format(tray.widthMm) : '-'}
        </Body1>
      </div>
      <div className={styles.field}>
        <Caption1>Height [mm]</Caption1>
        <Body1>
          {tray.heightMm !== null ? numberFormatter.format(tray.heightMm) : '-'}
        </Body1>
      </div>
      <div className={styles.field}>
        <Caption1>Weight [kg/m]</Caption1>
        <Body1>{weightDisplay}</Body1>
      </div>
      <div className={styles.field}>
        <Caption1>Length [mm]</Caption1>
        <Body1>
          {tray.lengthMm !== null ? numberFormatter.format(tray.lengthMm) : '-'}
        </Body1>
      </div>
      <div className={styles.field}>
        <Caption1>Created</Caption1>
        <Body1>
          {new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
          }).format(new Date(tray.createdAt))}
        </Body1>
      </div>
      <div className={styles.field}>
        <Caption1>Updated</Caption1>
        <Body1>
          {new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
          }).format(new Date(tray.updatedAt))}
        </Body1>
      </div>
    </div>
  );
};
