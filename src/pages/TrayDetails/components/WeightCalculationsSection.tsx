import React from 'react';
import { Caption1, Body1 } from '@fluentui/react-components';

interface WeightCalculationsSectionProps {
  title: string;
  calculations: Array<{
    label: string;
    value: number | null;
  }>;
  formatNumber: (value: number | null) => string;
  styles: Record<string, string>;
}

export const WeightCalculationsSection: React.FC<WeightCalculationsSectionProps> = ({
  title,
  calculations,
  formatNumber,
  styles
}) => {
  return (
    <div className={styles.section}>
      <Caption1>{title}</Caption1>
      <div className={styles.grid}>
        {calculations.map((calc, index) => (
          <div key={index} className={styles.field}>
            <Caption1>{calc.label}</Caption1>
            <Body1>{formatNumber(calc.value)}</Body1>
          </div>
        ))}
      </div>
    </div>
  );
};
