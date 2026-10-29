import type { WorkSheet } from 'xlsx';
import { cablePurposeInputSchema } from '../../shared/routingCablePurposes.js';
import {
  getExcelRowNumber,
  readExcelImportRows,
  validateExcelImport,
  type ExcelImportColumn,
} from './excelImport.js';

/** Catalog imports use the same limits and enum values as manual material editing. */
export const validateMaterialExcelImport = (
  worksheet: WorkSheet,
  aliases: Record<string, readonly string[]>,
  kind: 'cable-type' | 'installation-material',
) => {
  const rules: Record<string, Omit<ExcelImportColumn, 'headers'>> = {
    name: { required: true, maxLength: 200 },
    type: { required: true, maxLength: 200 },
    purpose: { maxLength: kind === 'cable-type' ? undefined : 2000 },
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
  const issues = validateExcelImport(
    worksheet,
    Object.entries(aliases).map(([key, headers]) => ({
      headers,
      maxLength: 2000,
      ...rules[key],
    })),
  );
  const seen = new Map<string, number>();
  for (const [index, row] of readExcelImportRows(worksheet, []).entries()) {
    const purposeHeader = aliases.purpose?.find(header => header in row);
    if (kind === 'cable-type' && purposeHeader && !cablePurposeInputSchema.safeParse(String(row[purposeHeader] ?? '')).success) {
      issues.push({row:getExcelRowNumber(row,index),column:purposeHeader,message:'Use a cable Purpose of at most 500 characters without control characters.'});
    }
    const readIdentity = (headers: readonly string[]) => {
      const header = headers.find((candidate) => candidate in row);
      return header
        ? String(row[header] ?? '')
            .trim()
            .toLowerCase()
        : '';
    };
    const manufacturer = readIdentity(aliases.manufacturer);
    const partNo = readIdentity(aliases.partNo);
    if (!manufacturer || !partNo) continue;
    const key = JSON.stringify([manufacturer, partNo]);
    const rowNumber = getExcelRowNumber(row, index);
    const previous = seen.get(key);
    if (previous !== undefined) {
      issues.push({
        row: rowNumber,
        column: 'Manufacturer + Part No.',
        message: `Duplicate Manufacturer + Part No.; it already appears on row ${previous}.`,
      });
    } else {
      seen.set(key, rowNumber);
    }
  }
  return issues;
};
