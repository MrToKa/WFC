import React from 'react';
import { Caption1, Body1 } from '@fluentui/react-components';
import { Cable } from '../../../api/client';

interface CablesTableSectionProps {
  trayCables: Cable[];
  cablesError: string | null;
  styles: Record<string, string>;
  numberFormatter: Intl.NumberFormat;
}

export const CablesTableSection: React.FC<CablesTableSectionProps> = ({
  trayCables,
  cablesError,
  styles,
  numberFormatter
}) => {
  return (
    <div className={styles.section}>
      <Caption1>Cables laying on the tray</Caption1>
      {cablesError ? (
        <Body1 className={styles.errorText}>{cablesError}</Body1>
      ) : trayCables.length === 0 ? (
        <Body1 className={styles.emptyState}>No cables found on this tray.</Body1>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>#</th>
                <th className={styles.tableHeadCell}>Tag</th>
                <th className={styles.tableHeadCell}>From</th>
                <th className={styles.tableHeadCell}>To</th>
                <th className={styles.tableHeadCell}>Purpose</th>
                <th className={styles.tableHeadCell}>Weight [kg/m]</th>
                <th className={styles.tableHeadCell}>Diameter [mm]</th>
              </tr>
            </thead>
            <tbody>
              {trayCables.map((cable, index) => (
                <tr key={cable.id}>
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={styles.tableCell}>{cable.tag || '-'}</td>
                  <td className={styles.tableCell}>{cable.fromLocation || '-'}</td>
                  <td className={styles.tableCell}>{cable.toLocation || '-'}</td>
                  <td className={styles.tableCell}>{cable.purpose || '-'}</td>
                  <td className={styles.tableCell}>
                    {cable.weightKgPerM !== null
                      ? numberFormatter.format(cable.weightKgPerM)
                      : '-'}
                  </td>
                  <td className={styles.tableCell}>
                    {cable.diameterMm !== null && !Number.isNaN(cable.diameterMm)
                      ? numberFormatter.format(cable.diameterMm)
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
