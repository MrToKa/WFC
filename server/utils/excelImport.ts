import * as XLSX from 'xlsx';

export type ExcelImportIssue = { row: number; column: string; message: string };

export type ExcelImportColumn = {
  headers: readonly string[];
  required?: boolean;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  integer?: boolean;
  maxLength?: number;
  values?: readonly string[];
  caseInsensitive?: boolean;
  unique?: boolean;
  normalizeWhitespace?: boolean;
  httpUrl?: boolean;
};

export const getExcelRowNumber = (row: Record<string, unknown>, fallbackIndex: number): number =>
  typeof row.__rowNum__ === 'number' ? row.__rowNum__ + 1 : fallbackIndex + 2;

/** Preserve displayed identifiers (e.g. 001), but never parse formatted prices as text. */
export const readExcelImportRows = (
  worksheet: XLSX.WorkSheet,
  numericHeaders: readonly string[],
): Record<string, unknown>[] => {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: false,
  });
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: true,
  });
  const rawByRow = new Map(rawRows.map((row, index) => [getExcelRowNumber(row, index), row]));
  for (const [index, row] of rows.entries()) {
    const raw = rawByRow.get(getExcelRowNumber(row, index));
    for (const header of numericHeaders) {
      if (raw && header in raw) row[header] = raw[header];
    }
  }
  return rows.filter((row) => Object.values(row).some((value) => !isBlank(value)));
};

const isBlank = (value: unknown): boolean => value == null || String(value).trim() === '';

// Avoid Number() accepting booleans, hex strings, or Infinity as spreadsheet numbers.
export const parseExcelNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};

/** Check every data row before any import writes, retaining physical spreadsheet positions. */
export const validateExcelImport = (
  worksheet: XLSX.WorkSheet,
  columns: readonly ExcelImportColumn[],
): ExcelImportIssue[] => {
  const issues: ExcelImportIssue[] = [];
  const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null;
  if (!range) return [{ row: 1, column: 'Workbook', message: 'The worksheet is empty.' }];

  const headerRow = range.s.r;
  const headers: Array<{ name: string; index: number }> = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    if (!isBlank(cell?.v)) headers.push({ name: String(cell.v), index: c });
  }

  const resolved = columns.map((column) => {
    const matches = headers.filter((header) => column.headers.includes(header.name));
    if (matches.length === 0 && column.required) {
      issues.push({
        row: headerRow + 1,
        column: column.headers[0],
        message: 'Required column is missing. Use the import template.',
      });
    } else if (matches.length > 1) {
      issues.push({
        row: headerRow + 1,
        column: column.headers[0],
        message:
          'The column is repeated or more than one supported alias is present. Keep one column.',
      });
    }
    return { column, header: matches[0], seen: new Map<string, number>() };
  });

  let dataRows = 0;
  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    let hasData = false;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
      if (!isBlank(cell?.v) || cell?.f || cell?.t === 'e') {
        hasData = true;
        break;
      }
    }
    if (!hasData) continue;
    dataRows += 1;
    for (const { column, header, seen } of resolved) {
      if (!header) continue;
      const cell = worksheet[XLSX.utils.encode_cell({ r, c: header.index })];
      const value: unknown = cell?.v;
      const add = (message: string) => issues.push({ row: r + 1, column: header.name, message });
      if (cell?.t === 'e' || (cell?.f && isBlank(value))) {
        add(
          'The cell contains an Excel error or a formula without a calculated value. Replace it with a valid value.',
        );
        continue;
      }
      if (isBlank(value)) {
        if (column.required) add('A value is required.');
        continue;
      }
      const text = (column.type === 'number' ? String(value) : XLSX.utils.format_cell(cell)).trim();
      if (text === '') {
        if (column.required) {
          add('A visible value is required. Remove the cell formatting that hides its value.');
        }
        continue;
      }
      let key = (column.normalizeWhitespace ? text.replace(/\s+/g, ' ') : text).toLowerCase();
      if (column.type === 'number') {
        const number = parseExcelNumber(value);
        if (number === null) {
          add('Enter a valid finite number.');
          continue;
        }
        key = String(number);
        if (column.integer && !Number.isInteger(number)) add('Enter a whole number.');
        if (
          column.min !== undefined &&
          (column.exclusiveMin ? number <= column.min : number < column.min)
        ) {
          add(
            `Enter a number ${column.exclusiveMin ? 'greater than' : 'greater than or equal to'} ${column.min}.`,
          );
        }
        if (column.max !== undefined && number > column.max)
          add(`Enter a number less than or equal to ${column.max}.`);
      } else if (column.maxLength !== undefined && text.length > column.maxLength) {
        add(`Use no more than ${column.maxLength} characters.`);
      }
      if (
        column.values &&
        !column.values.some((allowed) =>
          column.caseInsensitive ? allowed.toLowerCase() === text.toLowerCase() : allowed === text,
        )
      ) {
        add(`Choose one of: ${column.values.join(', ')}.`);
      }
      if (column.httpUrl) {
        try {
          const url = new URL(text);
          if (url.protocol !== 'http:' && url.protocol !== 'https:')
            throw new Error('Invalid protocol');
        } catch {
          add('Enter a valid internet link starting with http:// or https://.');
        }
      }
      if (column.unique) {
        const previousRow = seen.get(key);
        if (previousRow !== undefined)
          add(`Duplicate value; it already appears on row ${previousRow}.`);
        else seen.set(key, r + 1);
      }
    }
  }
  if (dataRows === 0)
    issues.push({
      row: headerRow + 2,
      column: 'Workbook',
      message: 'The worksheet has no data rows. Add at least one row below the headers.',
    });
  return issues;
};

export const excelImportError = (issues: readonly ExcelImportIssue[]) => ({
  error: `Import cancelled: ${issues.length} validation ${issues.length === 1 ? 'error' : 'errors'}. No data was changed. Correct the workbook and upload it again.`,
  issues: issues.slice(0, 100),
  totalIssues: issues.length,
});
