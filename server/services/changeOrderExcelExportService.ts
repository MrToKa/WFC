import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  calculateLineTotal,
  type ChangeOrderDetails,
  type ChangeOrderDocumentType,
  type ChangeOrderItem,
} from '../models/changeOrder.js';
import {
  changeOrderSummaryGroupingKey,
  consolidateChangeOrderSummaryGroup,
  consolidateChangeOrderItems as consolidateChangeOrderItemsForExport,
} from '../../shared/changeOrderSummary.js';

export { consolidateChangeOrderItemsForExport };
export { newestRevisionNumber } from '../../shared/changeOrderSummary.js';

const TEMPLATE_FILE_NAME =
  'Change order - Change order - Trafo interface and Sampling pumps cables.xlsx';
const EXPECTED_HEADERS = [
  'Item No.',
  'Design Qty',
  'Order Qty',
  'Spare Qty',
  'Unit',
  'Packaging',
  'Packaging Qty',
  'Unit',
  'Ordered Qty',
  'Unit',
  'SAP number',
  'Description (EN)',
  'Description (DE)',
  'Dimension [mm]',
  'Material',
  'Weight [kg]',
  'Clear description of content of a set and type designation',
  'Price/pcs',
  'Total Price',
  'Country of origin',
  'HS Code',
  'Pos./TAG-No',
  'Drawing No.',
  'Shipping list',
  'Revision number',
  'Certificates',
  'Original Equipment Manufacturer',
  'Manufacturer Part No.',
  'ACS barcode',
  'Remarks',
] as const;
const HEADER_ALIASES = new Map<number, readonly string[]>([[25, ['Client Barcode']]]);
const OMITTED_EXPORT_COLUMN_NUMBERS = [24, 21, 13, 11] as const;
const EXPORT_COLUMN_COUNT = EXPECTED_HEADERS.length - OMITTED_EXPORT_COLUMN_NUMBERS.length;
const LAST_EXPORT_COLUMN = 'Z';
const TEMPLATE_WIDE_HEADER_MERGES = [
  ['K1:AB2', 'K1:X2'],
  ['K3:AB4', 'K3:X4'],
] as const;
const DOCUMENT_TITLE_STYLES = [
  ['K1', 26],
  ['K3', 20],
] as const;
const DOCUMENT_TITLE_BORDER: Partial<ExcelJS.Border> = {
  style: 'thin',
  color: { argb: 'FF000000' },
};

// ExcelJS serializes font properties in JavaScript object order, which is not the
// order required by SpreadsheetML. Excel desktop rejects the resulting styles.xml
// even though ExcelJS can read it back.
const FONT_PROPERTY_ORDER = new Map(
  [
    'b',
    'i',
    'strike',
    'condense',
    'extend',
    'outline',
    'shadow',
    'u',
    'vertAlign',
    'sz',
    'color',
    'name',
    'family',
    'charset',
    'scheme',
  ].map((name, index) => [name, index]),
);

export class ChangeOrderTemplateError extends Error {}
export class EmptyChangeOrderError extends Error {}

const normalizeHeader = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\d+$/, '')
    .toLowerCase();

const findTableHeaderRowNumber = (worksheet: ExcelJS.Worksheet): number => {
  const lastCandidateRow = Math.min(worksheet.rowCount, 20);
  for (let rowNumber = 1; rowNumber <= lastCandidateRow; rowNumber += 1) {
    if (
      normalizeHeader(worksheet.getCell(`A${rowNumber}`).value) ===
      normalizeHeader(EXPECTED_HEADERS[0])
    ) {
      return rowNumber;
    }
  }
  throw new ChangeOrderTemplateError('Change Order template table header row is missing');
};

export const validateChangeOrderTemplateHeaders = (
  worksheet: ExcelJS.Worksheet,
  headerRowNumber = findTableHeaderRowNumber(worksheet),
): void => {
  const invalid: string[] = [];
  EXPECTED_HEADERS.forEach((expected, index) => {
    const cell = worksheet.getRow(headerRowNumber).getCell(index + 1);
    const actual = normalizeHeader(cell.value);
    const matchesExpected = actual === normalizeHeader(expected);
    const matchesAlias = HEADER_ALIASES.get(index)?.some(
      (alias) => actual === normalizeHeader(alias),
    );
    if (!matchesExpected && !matchesAlias) {
      invalid.push(`${cell.address}: expected "${expected}", found "${String(cell.value ?? '')}"`);
    }
  });
  if (invalid.length > 0) {
    throw new ChangeOrderTemplateError(
      `Invalid Change Order template headers: ${invalid.join('; ')}`,
    );
  }
};

export const escapeSpreadsheetText = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
};

const cloneStyle = (style: Partial<ExcelJS.Style>): Partial<ExcelJS.Style> =>
  JSON.parse(JSON.stringify(style)) as Partial<ExcelJS.Style>;

type RowTemplate = {
  height?: number;
  hidden: boolean;
  styles: Partial<ExcelJS.Style>[];
};

const captureRowTemplate = (row: ExcelJS.Row): RowTemplate => ({
  height: row.height,
  hidden: row.hidden,
  styles: Array.from({ length: EXPORT_COLUMN_COUNT }, (_, index) =>
    cloneStyle(row.getCell(index + 1).style),
  ),
});

const applyRowTemplate = (row: ExcelJS.Row, template: RowTemplate): void => {
  if (template.height !== undefined) {
    row.height = template.height;
  }
  row.hidden = template.hidden;
  template.styles.forEach((style, index) => {
    row.getCell(index + 1).style = cloneStyle(style);
  });
};

const toText = (value: string | null): string | null => escapeSpreadsheetText(value);

const removeUnusedExportColumns = (worksheet: ExcelJS.Worksheet): void => {
  const mergesToRestore = TEMPLATE_WIDE_HEADER_MERGES.filter(([templateMerge]) =>
    worksheet.model.merges.includes(templateMerge),
  );
  for (const [templateMerge] of mergesToRestore) {
    worksheet.unMergeCells(templateMerge);
  }

  for (const columnNumber of OMITTED_EXPORT_COLUMN_NUMBERS) {
    worksheet.spliceColumns(columnNumber, 1);
  }

  for (const [, exportMerge] of mergesToRestore) {
    worksheet.mergeCells(exportMerge);
  }
};

const styleDocumentTitles = (worksheet: ExcelJS.Worksheet): void => {
  for (const [address, fontSize] of DOCUMENT_TITLE_STYLES) {
    const cell = worksheet.getCell(address);
    cell.font = { ...cell.font, bold: true, size: fontSize };
    cell.alignment = { ...cell.alignment, horizontal: 'center', vertical: 'middle' };
    cell.border = {
      ...cell.border,
      top: DOCUMENT_TITLE_BORDER,
      right: DOCUMENT_TITLE_BORDER,
      bottom: DOCUMENT_TITLE_BORDER,
      left: DOCUMENT_TITLE_BORDER,
    };
  }
};

const exportItemValues = (
  item: ChangeOrderItem,
  rowNumber: number,
  itemNumber: number,
): ExcelJS.CellValue[] => {
  const packagedOrderQuantity = (item.packagingQuantity ?? 0) * (item.orderedQuantity ?? 0);
  const values: Array<ExcelJS.CellValue> = [
    itemNumber,
    item.designQuantity,
    { formula: `G${rowNumber}*I${rowNumber}`, result: packagedOrderQuantity },
    {
      formula: `C${rowNumber}-B${rowNumber}`,
      result: packagedOrderQuantity - item.designQuantity,
    },
    toText(item.unit),
    toText(item.packaging),
    item.packagingQuantity,
    toText(item.packagingUnit),
    item.orderedQuantity,
    toText(item.orderedUnit),
    escapeSpreadsheetText(item.descriptionEn),
    toText(item.dimensionMm),
    toText(item.material),
    item.weightKg,
    toText(item.clearDescription),
    item.unitPrice,
    {
      formula: `P${rowNumber}*C${rowNumber}`,
      result: calculateLineTotal(packagedOrderQuantity, item.unitPrice),
    },
    toText(item.countryOfOrigin),
    toText(item.tagNo),
    toText(item.drawingNo),
    toText(item.revisionNumber),
    toText(item.clientBarcode),
    toText(item.manufacturer),
    toText(item.manufacturerPartNo),
    toText(item.acsBarcode),
    toText(item.remarks),
  ];
  return values;
};

const setItemValues = (row: ExcelJS.Row, item: ChangeOrderItem, itemNumber: number): void => {
  exportItemValues(item, row.number, itemNumber).forEach((value, index) => {
    row.getCell(index + 1).value = value;
  });

  for (const column of [2, 3, 4, 7, 9]) {
    row.getCell(column).numFmt = '#,##0.00';
  }
  row.getCell(14).numFmt = '#,##0.###';
  row.getCell(16).numFmt = '#,##0.00 [$€-1]';
  row.getCell(17).numFmt = '#,##0.00 [$€-1]';
};

const highlightCell = (cell: ExcelJS.Cell): void => {
  // Imported cells can share styles, including merged header blocks.
  // Copy before changing the fill so unchanged cells retain their formatting.
  cell.style = {
    ...cloneStyle(cell.style),
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } },
  };
};

const displayedCellValue = (value: ExcelJS.CellValue): string | number | boolean | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'object') return value;
  if ('result' in value) return displayedCellValue(value.result);
  if (value instanceof Date) return value.toISOString();
  throw new Error('Unsupported Change Order comparison value');
};

const highlightMaterialChanges = (
  row: ExcelJS.Row,
  item: ChangeOrderItem,
  previousItems: readonly ChangeOrderItem[],
  changedContributionColumns: ReadonlySet<number>,
): void => {
  const currentValues = exportItemValues(item, row.number, 0);
  if (previousItems.length === 0) {
    currentValues.forEach((value, index) => {
      if (index > 0 && displayedCellValue(value) !== null) highlightCell(row.getCell(index + 1));
    });
    return;
  }

  const previousValues = exportItemValues(
    consolidateChangeOrderSummaryGroup(previousItems),
    row.number,
    0,
  );
  const previousGroups = consolidateChangeOrderItemsForExport([...previousItems]).map((previous) =>
    exportItemValues(previous, row.number, 0),
  );
  // Compare formula results, not row references. Previous prices/package sizes
  // may form several old summary positions that now merge into one position.
  const summedColumns = new Set([2, 3, 4, 9, 17]);
  const separateColumns = new Set([7, 14, 16]);
  currentValues.forEach((value, index) => {
    const column = index + 1;
    if (column === 1) return; // Renumbering surviving rows is not a material change.
    const current = displayedCellValue(value);
    let changed: boolean;
    if (summedColumns.has(column)) {
      const previousResults = previousGroups.map((values) => displayedCellValue(values[index]));
      const previous = previousResults.every((value) => value === null)
        ? null
        : previousResults.reduce<number>((sum, value) => sum + Number(value ?? 0), 0);
      changed = current !== previous;
    } else if (separateColumns.has(column)) {
      changed = previousGroups.some((values) => current !== displayedCellValue(values[index]));
    } else {
      changed = current !== displayedCellValue(previousValues[index]);
    }
    if (changed || changedContributionColumns.has(column)) highlightCell(row.getCell(column));
  });
};

const resolveDefaultTemplatePath = async (): Promise<string> => {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'Template files', TEMPLATE_FILE_NAME),
    path.resolve(moduleDirectory, '..', '..', 'Template files', TEMPLATE_FILE_NAME),
    path.resolve(moduleDirectory, '..', '..', '..', 'Template files', TEMPLATE_FILE_NAME),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next deployment layout.
    }
  }
  throw new ChangeOrderTemplateError('Change Order workbook template is unavailable');
};

const findTemplateWorksheet = (workbook: ExcelJS.Workbook): ExcelJS.Worksheet => {
  const worksheet =
    workbook.getWorksheet('Change Order') ??
    workbook.getWorksheet('List1') ??
    (workbook.worksheets.length === 1 ? workbook.worksheets[0] : undefined);
  if (!worksheet) {
    throw new ChangeOrderTemplateError('Change Order worksheet is missing from the template');
  }
  return worksheet;
};

const findTotalRowNumber = (worksheet: ExcelJS.Worksheet, dataStartRowNumber: number): number => {
  for (let rowNumber = dataStartRowNumber; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    if (normalizeHeader(worksheet.getCell(`R${rowNumber}`).value) === 'total:') {
      return rowNumber;
    }
  }
  throw new ChangeOrderTemplateError('Change Order template Total row is missing');
};

const mergedHeaderAddress = (worksheet: ExcelJS.Worksheet, candidates: string[]): string =>
  candidates.find((candidate) => {
    const cell = worksheet.getCell(candidate);
    return cell.isMerged || cell.value !== null;
  }) ?? candidates[0];

const setMergedHeaderValue = (
  worksheet: ExcelJS.Worksheet,
  candidates: string[],
  value: string,
): void => {
  const address = mergedHeaderAddress(worksheet, candidates);
  worksheet.getCell(address).value = escapeSpreadsheetText(value);
};

const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const populateDocumentHeader = (
  worksheet: ExcelJS.Worksheet,
  headerRowNumber: number,
  changeOrder: ChangeOrderDetails,
  documentType: ChangeOrderDocumentType,
): void => {
  const reportDate = new Date(`${changeOrder.reportDate}T00:00:00.000Z`);
  const prefix = documentType === 'internal-ncr' ? 'Internal NCR' : 'Change order';
  const documentTitle = `${prefix} - ${changeOrder.title}`;

  if (headerRowNumber === 5) {
    // Current shared template: a four-row header with outlined merged blocks.
    setMergedHeaderValue(worksheet, ['D1'], changeOrder.projectName);
    setMergedHeaderValue(worksheet, ['D2'], changeOrder.projectCustomer);
    setMergedHeaderValue(worksheet, ['D3'], changeOrder.projectReference ?? '');
    setMergedHeaderValue(worksheet, ['K1'], changeOrder.projectName);
    setMergedHeaderValue(worksheet, ['K3'], documentTitle);
    worksheet.getCell('Z1').value = escapeSpreadsheetText(changeOrder.preparedBy);
    worksheet.getCell('Z2').value = reportDate;
    worksheet.getCell('Z3').value = {
      formula: 'Z2+28',
      result: addDays(reportDate, 28),
    };
    worksheet.getCell('Z4').value = escapeSpreadsheetText(changeOrder.revision);
    return;
  }

  // Compatibility with the previous three-row template layout.
  worksheet.getCell('B1').value = escapeSpreadsheetText(changeOrder.projectName);
  worksheet.getCell('B2').value = escapeSpreadsheetText(changeOrder.projectCustomer);
  worksheet.getCell('B3').value = escapeSpreadsheetText(changeOrder.projectReference ?? '');
  setMergedHeaderValue(worksheet, ['K1', 'F1'], changeOrder.projectName);
  setMergedHeaderValue(worksheet, ['K2', 'F2'], documentTitle);
  worksheet.getCell('Z1').value = escapeSpreadsheetText(changeOrder.preparedBy);
  worksheet.getCell('Z2').value = reportDate;
  worksheet.getCell('Z3').value = escapeSpreadsheetText(changeOrder.revision);
};

const highlightHeaderChanges = (
  worksheet: ExcelJS.Worksheet,
  headerRowNumber: number,
  current: ChangeOrderDetails,
  previous: ChangeOrderDetails,
): void => {
  const currentLayout = headerRowNumber === 5;
  const fields: Array<[keyof ChangeOrderDetails, string[][]]> = [
    ['projectName', currentLayout ? [['D1'], ['K1']] : [['B1'], ['K1', 'F1']]],
    ['projectCustomer', [[currentLayout ? 'D2' : 'B2']]],
    ['projectReference', [[currentLayout ? 'D3' : 'B3']]],
    ['title', [currentLayout ? ['K3'] : ['K2', 'F2']]],
    ['preparedBy', [['Z1']]],
    ['reportDate', currentLayout ? [['Z2'], ['Z3']] : [['Z2']]],
    ['revision', [[currentLayout ? 'Z4' : 'Z3']]],
  ];
  for (const [field, addresses] of fields) {
    if ((current[field] ?? '') === (previous[field] ?? '')) continue;
    for (const candidates of addresses) {
      highlightCell(worksheet.getCell(mergedHeaderAddress(worksheet, candidates)).master);
    }
  }
};

export const normalizeSpreadsheetFontOrder = (stylesXml: string): string =>
  stylesXml.replace(
    /<font(\s[^>]*)?>([\s\S]*?)<\/font>/g,
    (fontXml, attributes: string | undefined, content: string) => {
      const children = content.match(/<([A-Za-z][\w.-]*)(?:\s[^>]*)?\/>/g);
      if (!children || children.join('') !== content) {
        return fontXml;
      }

      const orderedChildren = children
        .map((xml, originalIndex) => ({
          xml,
          originalIndex,
          name: /^<([A-Za-z][\w.-]*)/.exec(xml)?.[1] ?? '',
        }))
        .sort((left, right) => {
          const leftOrder = FONT_PROPERTY_ORDER.get(left.name) ?? Number.MAX_SAFE_INTEGER;
          const rightOrder = FONT_PROPERTY_ORDER.get(right.name) ?? Number.MAX_SAFE_INTEGER;
          return leftOrder - rightOrder || left.originalIndex - right.originalIndex;
        })
        .map(({ xml }) => xml)
        .join('');

      return `<font${attributes ?? ''}>${orderedChildren}</font>`;
    },
  );

export const trimWorksheetAfterRow = (worksheetXml: string, lastRow: number): string =>
  worksheetXml
    .replace(
      /<row\b(?=[^>]*\br="(\d+)")[^>]*(?:\/>|>[\s\S]*?<\/row>)/g,
      (rowXml, rowNumber: string) => (Number(rowNumber) > lastRow ? '' : rowXml),
    )
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${LAST_EXPORT_COLUMN}${lastRow}"/>`);

export const currentExcelDate = (now = new Date()): Date =>
  new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

const addRevisionHistoryWorksheet = (
  workbook: ExcelJS.Workbook,
  changeOrder: ChangeOrderDetails,
): void => {
  const worksheet = workbook.addWorksheet('Revision history', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  worksheet.columns = [{ width: 12 }, { width: 23 }, { width: 25 }, { width: 110 }];
  for (const row of [1, 2, 3]) worksheet.mergeCells(`A${row}:D${row}`);
  worksheet.getCell('A1').value = 'Revision history';
  worksheet.getCell('A1').font = { name: 'Calibri', size: 18, bold: true };
  worksheet.getRow(1).height = 28;
  worksheet.getCell('A2').value = escapeSpreadsheetText(changeOrder.title);
  worksheet.getCell('A2').font = { name: 'Calibri', size: 12, bold: true };
  worksheet.getCell('A3').value = `History through revision ${changeOrder.revision}`;
  worksheet.getRow(2).height = 22;
  worksheet.getRow(3).height = 22;
  const header = worksheet.getRow(4);
  header.values = ['Revision', 'Date / time (UTC)', 'Changed by', 'Change'];
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  // Historical snapshots carry their own log, so later revisions never leak
  // into an export of an earlier revision. Keep every individual recorded edit.
  const entries = [...(changeOrder.changeLog ?? [])].sort(
    (first, second) => Date.parse(first.changedAt) - Date.parse(second.changedAt),
  );
  for (const entry of entries) {
    for (const change of entry.changes) {
      const changedAt = new Date(entry.changedAt);
      const row = worksheet.addRow([
        escapeSpreadsheetText(entry.revision),
        Number.isFinite(changedAt.getTime()) ? changedAt : escapeSpreadsheetText(entry.changedAt),
        escapeSpreadsheetText(entry.userName),
        escapeSpreadsheetText(change),
      ]);
      row.getCell(1).numFmt = '@';
      row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss';
      const descriptionLines = change
        .split(/\r?\n/)
        .reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / 100)), 0);
      row.height = Math.min(409, Math.max(30, descriptionLines * 15 + 8));
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Calibri', size: 11 };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9E2F3' } } };
        if (row.number % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F5FA' } };
        }
      });
    }
  }
  if (worksheet.rowCount === 4) {
    worksheet.mergeCells('A5:D5');
    worksheet.getCell('A5').value = 'No recorded changes for this revision.';
    worksheet.getCell('A5').font = { name: 'Calibri', size: 11, italic: true };
    worksheet.getRow(5).height = 24;
  } else {
    worksheet.autoFilter = `A4:D${worksheet.rowCount}`;
  }
  worksheet.pageSetup.printArea = `A1:D${worksheet.rowCount}`;
  worksheet.pageSetup.printTitlesRow = '4:4';
};

const makeExcelDesktopCompatible = async (
  output: Buffer,
  totalRowNumber: number,
): Promise<Buffer> => {
  const archive = await JSZip.loadAsync(output);
  const stylesPart = archive.file('xl/styles.xml');
  if (stylesPart) {
    const stylesXml = await stylesPart.async('string');
    archive.file('xl/styles.xml', normalizeSpreadsheetFontOrder(stylesXml));
  }
  const worksheetPart = archive.file('xl/worksheets/sheet1.xml');
  if (worksheetPart) {
    const worksheetXml = await worksheetPart.async('string');
    archive.file('xl/worksheets/sheet1.xml', trimWorksheetAfterRow(worksheetXml, totalRowNumber));
  }
  return archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
};

export async function generateChangeOrderWorkbook(
  changeOrder: ChangeOrderDetails,
  templatePath?: string,
  documentType: ChangeOrderDocumentType = 'change-order',
  previousChangeOrder?: ChangeOrderDetails,
): Promise<Buffer> {
  if (changeOrder.items.length === 0) {
    const documentName = documentType === 'internal-ncr' ? 'Internal NCR' : 'Change Order';
    const article = documentType === 'internal-ncr' ? 'An' : 'A';
    throw new EmptyChangeOrderError(
      `${article} ${documentName} must contain at least one material row`,
    );
  }
  const previousItemsById = new Map(previousChangeOrder?.items.map((item) => [item.id, item]));
  const comparisonGroups = new Map<string, ChangeOrderItem[]>();
  const changedGroups = new Set<string>();
  const changedContributionColumns = new Map<string, Set<number>>();
  const revisionMetadata = new Set<keyof ChangeOrderItem>([
    'id',
    'changeOrderId',
    'sortOrder',
    'createdAt',
    'updatedAt',
    'revisionNumber',
  ]);
  for (const item of changeOrder.items) {
    if (!previousChangeOrder) break;
    const previous = previousItemsById.get(item.id);
    const key = changeOrderSummaryGroupingKey(item);
    if (previous) {
      const group = comparisonGroups.get(key) ?? [];
      group.push(previous);
      comparisonGroups.set(key, group);
    }
    const materialChanged =
      !previous ||
      (Object.keys(item) as Array<keyof ChangeOrderItem>).some(
        (field) =>
          !revisionMetadata.has(field) &&
          JSON.stringify(item[field] ?? null) !== JSON.stringify(previous[field] ?? null),
      );
    const columns = changedContributionColumns.get(key) ?? new Set<number>();
    const currentValues = exportItemValues(consolidateChangeOrderSummaryGroup([item]), 1, 0);
    const previousValues = previous
      ? exportItemValues(consolidateChangeOrderSummaryGroup([previous]), 1, 0)
      : [];
    // Keep constituent differences even when joined text or summed quantities
    // happen to stay the same in the consolidated position.
    currentValues.forEach((value, index) => {
      if (index > 0 && displayedCellValue(value) !== displayedCellValue(previousValues[index])) {
        columns.add(index + 1);
      }
    });
    if (materialChanged) {
      changedGroups.add(key);
      columns.add(21); // The changed summary position belongs to the selected revision.
    }
    changedContributionColumns.set(key, columns);
  }
  const exportItems = consolidateChangeOrderItemsForExport(changeOrder.items).map((item) =>
    changedGroups.has(changeOrderSummaryGroupingKey(item))
      ? { ...item, revisionNumber: changeOrder.revision }
      : item,
  );

  const workbook = new ExcelJS.Workbook();
  const resolvedTemplatePath = templatePath ?? (await resolveDefaultTemplatePath());
  try {
    await workbook.xlsx.readFile(resolvedTemplatePath);
  } catch (error) {
    if (error instanceof ChangeOrderTemplateError) throw error;
    throw new ChangeOrderTemplateError('Change Order workbook template could not be read');
  }

  const worksheet = findTemplateWorksheet(workbook);
  const headerRowNumber = findTableHeaderRowNumber(worksheet);
  validateChangeOrderTemplateHeaders(worksheet, headerRowNumber);
  worksheet.getRow(headerRowNumber).getCell(26).value = EXPECTED_HEADERS[25];
  const dataStartRowNumber = headerRowNumber + 1;
  const totalTemplateRowNumber = findTotalRowNumber(worksheet, dataStartRowNumber);

  // Row splicing makes ExcelJS write the template's conditional-formatting
  // containers without their rules. Empty containers are invalid SpreadsheetML
  // and cause Excel to repair sheet1.xml on open.
  worksheet.removeConditionalFormatting(() => false);

  // The source workbook contains a hidden filter name tied to its original sheet/table.
  // ExcelJS does not update that name when the table is removed and the sheet is renamed,
  // leaving a broken external reference that desktop Excel attempts to repair.
  workbook.definedNames.model = workbook.definedNames.model.filter(
    (definedName) => definedName.name !== '_xlnm._FilterDatabase',
  );

  if (worksheet.getTable('MTO')) {
    worksheet.removeTable('MTO');
  }

  removeUnusedExportColumns(worksheet);
  const dataTemplate = captureRowTemplate(worksheet.getRow(dataStartRowNumber));
  const totalTemplate = captureRowTemplate(worksheet.getRow(totalTemplateRowNumber));

  for (let rowNumber = dataStartRowNumber; rowNumber <= totalTemplateRowNumber; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (let column = 1; column <= EXPORT_COLUMN_COUNT; column += 1) {
      row.getCell(column).value = null;
    }
  }

  exportItems.forEach((item, index) => {
    const row = worksheet.getRow(dataStartRowNumber + index);
    applyRowTemplate(row, dataTemplate);
    setItemValues(row, item, index + 1);
    if (previousChangeOrder) {
      // Deleted source rows are excluded from the comparison and the export.
      highlightMaterialChanges(
        row,
        item,
        comparisonGroups.get(changeOrderSummaryGroupingKey(item)) ?? [],
        changedContributionColumns.get(changeOrderSummaryGroupingKey(item)) ?? new Set(),
      );
    }
  });

  const lastItemRow = headerRowNumber + exportItems.length;
  const totalRowNumber = lastItemRow + 1;
  const totalRow = worksheet.getRow(totalRowNumber);
  applyRowTemplate(totalRow, totalTemplate);
  totalRow.getCell(16).value = 'TOTAL:';
  totalRow.getCell(17).value = {
    formula: `SUM(Q${dataStartRowNumber}:Q${lastItemRow})`,
    result: exportItems.reduce((total, item) => total + item.totalPrice, 0),
  };
  if (totalRowNumber < totalTemplateRowNumber) {
    worksheet.spliceRows(totalRowNumber + 1, totalTemplateRowNumber - totalRowNumber);
  }

  worksheet.name = documentType === 'internal-ncr' ? 'Internal NCR' : 'Change Order';
  populateDocumentHeader(worksheet, headerRowNumber, changeOrder, documentType);
  styleDocumentTitles(worksheet);
  if (previousChangeOrder) {
    highlightHeaderChanges(worksheet, headerRowNumber, changeOrder, previousChangeOrder);
  }

  worksheet.autoFilter = `A${headerRowNumber}:${LAST_EXPORT_COLUMN}${lastItemRow}`;
  worksheet.pageSetup.printArea = `A1:${LAST_EXPORT_COLUMN}${totalRowNumber}`;
  worksheet.pageSetup.printTitlesRow = `${headerRowNumber}:${headerRowNumber}`;
  const calculationProperties = workbook.calcProperties as typeof workbook.calcProperties & {
    forceFullCalc?: boolean;
    calcMode?: string;
  };
  calculationProperties.fullCalcOnLoad = true;
  calculationProperties.forceFullCalc = true;
  calculationProperties.calcMode = 'auto';

  addRevisionHistoryWorksheet(workbook, changeOrder);
  const output = await workbook.xlsx.writeBuffer();
  return makeExcelDesktopCompatible(Buffer.from(output), totalRowNumber);
}

export const sanitizeChangeOrderFileName = (
  title: string,
  documentType: ChangeOrderDocumentType = 'change-order',
): string => {
  const clean = (value: string): string =>
    value
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  const prefix = documentType === 'internal-ncr' ? 'Internal NCR' : 'Change order';
  return `${prefix} - ${clean(title) || 'report'}.xlsx`;
};
