// @vitest-environment node

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  excelImportError,
  getExcelRowNumber,
  parseExcelNumber,
  validateExcelImport,
} from './excelImport.js';

describe('Excel workbook validation', () => {
  const columns = [
    { headers: ['Type', 'Name'], required: true, unique: true },
    { headers: ['Quantity'], type: 'number' as const, min: 0 },
  ];

  it.each([true, false, 'Infinity', 'NaN', '0x10', '2 kilograms', {}, null, ''])(
    'rejects non-decimal numeric input %j',
    (value) => {
      expect(parseExcelNumber(value)).toBeNull();
    },
  );

  it.each([
    [0, 0],
    ['0', 0],
    ['2,5', 2.5],
    [' 1.2e3 ', 1200],
    ['.5', 0.5],
  ])('parses a supported number %s', (value, expected) => {
    expect(parseExcelNumber(value)).toBe(expected);
  });

  it('rejects Excel error cells and formulas without cached values', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Type', 'Quantity'],
      ['Error', 1],
      ['Formula', 1],
    ]);
    sheet.B2 = { t: 'e', v: 7 };
    sheet.B3 = { t: 'n', f: 'SUM(1,2)' };
    expect(validateExcelImport(sheet, columns)).toEqual([
      { row: 2, column: 'Quantity', message: expect.stringContaining('Excel error') },
      { row: 3, column: 'Quantity', message: expect.stringContaining('calculated value') },
    ]);
  });

  it('accepts calculated formulas and ignores entirely blank rows', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Type', 'Quantity'], [], ['Formula', 3], [' ', ' ']]);
    sheet.B3.f = 'SUM(1,2)';
    expect(validateExcelImport(sheet, columns)).toEqual([]);
  });

  it('preserves row positions when the sheet starts below row 1', () => {
    const sheet = XLSX.utils.sheet_add_aoa(
      {},
      [
        ['Type', 'Quantity'],
        ['Material', 'invalid'],
      ],
      { origin: 'B4' },
    );
    sheet['!ref'] = 'B4:C5';
    expect(validateExcelImport(sheet, columns)).toEqual([
      { row: 5, column: 'Quantity', message: expect.any(String) },
    ]);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(getExcelRowNumber(rows[0], 0)).toBe(5);
  });

  it('caps response details while retaining the total issue count', () => {
    const issues = Array.from({ length: 150 }, (_, index) => ({
      row: index + 2,
      column: 'Type',
      message: 'A value is required.',
    }));
    const response = excelImportError(issues);
    expect(response.issues).toHaveLength(100);
    expect(response.totalIssues).toBe(150);
    expect(response.error).toContain('No data was changed');
  });

  it('rejects required identifiers hidden by Excel number formatting', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Type'], [1]]);
    sheet.A2.z = ';;;';
    expect(validateExcelImport(sheet, columns)).toEqual([
      { row: 2, column: 'Type', message: expect.stringContaining('visible value is required') },
    ]);
  });
});
