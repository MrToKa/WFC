import type { WorkSheet } from 'xlsx';
import { validateExcelImport, type ExcelImportColumn } from './excelImport.js';

/** Catalog imports use the same limits and enum values as manual material editing. */
export const validateMaterialExcelImport = (
  worksheet: WorkSheet,
  aliases: Record<string, readonly string[]>,
  kind: 'cable-type' | 'installation-material',
) => {
  const rules: Record<string, Omit<ExcelImportColumn, 'headers'>> = {
    name: { required: true, unique: true, maxLength: 200 },
    type: { required: true, unique: true, maxLength: 200 },
    purpose: { maxLength: kind === 'cable-type' ? 500 : 2000 },
    diameter: { type: 'number', min: 0, max: 1_000_000 },
    weight: { type: 'number', min: 0, max: 1_000_000 },
    weightKg: { type: 'number', min: 0, max: 1_000_000 },
    unitPrice: { type: 'number', min: 0 },
    minimumOrder: { type: 'number', min: 0, exclusiveMin: true, max: 1_000_000 },
    orderMeasurement: { values: ['pcs', 'pack', 'meters'] },
    packaging: { values: ['m', 'Package', 'Box', 'Drum', 'pcs'] },
    dimensionMm: { maxLength: 500 },
    source: { maxLength: 2000, httpUrl: true },
  };
  return validateExcelImport(
    worksheet,
    Object.entries(aliases).map(([key, headers]) => ({
      headers,
      maxLength: 2000,
      ...rules[key],
    })),
  );
};
