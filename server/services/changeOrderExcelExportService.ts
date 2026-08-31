import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  calculateLineTotal,
  calculateSpareQuantity,
  type ChangeOrderDetails,
  type ChangeOrderDocumentType,
  type ChangeOrderItem,
} from '../models/changeOrder.js';

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

// Descriptive values are deliberately excluded: the same catalog material can be
// used by several cable lines with different tags or other report text. Those
// values are joined below. Numeric values that drive package and price formulas
// remain in the key so the consolidated row keeps valid calculations.
const exportGroupingKey = (item: ChangeOrderItem): string =>
  JSON.stringify([
    item.sourceCatalog,
    item.sourceMaterialId,
    item.packagingQuantity,
    item.minimumOrderQuantity,
    item.orderMeasurement,
    item.weightKg,
    item.unitPrice,
  ]);

const joinDistinctTextValues = (
  items: readonly ChangeOrderItem[],
  select: (item: ChangeOrderItem) => string | null,
): string | null => {
  const values: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const value = select(item)?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }

  return values.length > 0 ? values.join(', ') : null;
};

const revisionCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

export const newestRevisionNumber = (items: readonly ChangeOrderItem[]): string | null => {
  let newest: string | null = null;
  for (const item of items) {
    const revision = item.revisionNumber?.trim();
    if (!revision) continue;
    if (newest === null || revisionCollator.compare(revision, newest) > 0) {
      newest = revision;
    }
  }
  return newest;
};

const consolidateExportGroup = (items: readonly ChangeOrderItem[]): ChangeOrderItem => {
  const first = items[0];
  if (!first) {
    throw new Error('Cannot consolidate an empty Change Order export group');
  }

  const designQuantity = items.reduce((total, item) => total + item.designQuantity, 0);
  const orderQuantity = items.reduce((total, item) => total + item.orderQuantity, 0);
  const orderedQuantity =
    first.packagingQuantity !== null && first.packagingQuantity > 0
      ? Math.ceil(orderQuantity / first.packagingQuantity)
      : items.every((item) => item.orderedQuantity === null)
        ? null
        : items.reduce((total, item) => total + (item.orderedQuantity ?? 0), 0);
  const packagedOrderQuantity = (first.packagingQuantity ?? 0) * (orderedQuantity ?? 0);

  return {
    ...first,
    designQuantity,
    orderQuantity,
    orderedQuantity,
    spareQuantity: calculateSpareQuantity(
      designQuantity,
      orderQuantity,
      first.packagingQuantity,
      orderedQuantity,
    ),
    totalPrice: calculateLineTotal(packagedOrderQuantity, first.unitPrice),
    unit: joinDistinctTextValues(items, (item) => item.unit),
    packaging: joinDistinctTextValues(items, (item) => item.packaging),
    packagingUnit: joinDistinctTextValues(items, (item) => item.packagingUnit),
    orderedUnit: joinDistinctTextValues(items, (item) => item.orderedUnit),
    sapNumber: joinDistinctTextValues(items, (item) => item.sapNumber),
    descriptionEn:
      joinDistinctTextValues(items, (item) => item.descriptionEn) ?? first.descriptionEn,
    descriptionDe: joinDistinctTextValues(items, (item) => item.descriptionDe),
    dimensionMm: joinDistinctTextValues(items, (item) => item.dimensionMm),
    material: joinDistinctTextValues(items, (item) => item.material),
    clearDescription: joinDistinctTextValues(items, (item) => item.clearDescription),
    countryOfOrigin: joinDistinctTextValues(items, (item) => item.countryOfOrigin),
    hsCode: joinDistinctTextValues(items, (item) => item.hsCode),
    tagNo: joinDistinctTextValues(items, (item) => item.tagNo),
    drawingNo: joinDistinctTextValues(items, (item) => item.drawingNo),
    shippingList: joinDistinctTextValues(items, (item) => item.shippingList),
    revisionNumber: newestRevisionNumber(items),
    clientBarcode: joinDistinctTextValues(items, (item) => item.clientBarcode),
    manufacturer: joinDistinctTextValues(items, (item) => item.manufacturer),
    manufacturerPartNo: joinDistinctTextValues(items, (item) => item.manufacturerPartNo),
    acsBarcode: joinDistinctTextValues(items, (item) => item.acsBarcode),
    remarks: joinDistinctTextValues(items, (item) => item.remarks),
    sourceStandardMaterialAssignmentIds: Array.from(
      new Set(items.flatMap((item) => item.sourceStandardMaterialAssignmentIds ?? [])),
    ).sort(),
  };
};

export const consolidateChangeOrderItemsForExport = (
  items: readonly ChangeOrderItem[],
): ChangeOrderItem[] => {
  const groups = new Map<string, ChangeOrderItem[]>();

  for (const item of items) {
    const key = exportGroupingKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  return Array.from(groups.values(), consolidateExportGroup);
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
  styles: Array.from({ length: 30 }, (_, index) => cloneStyle(row.getCell(index + 1).style)),
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

const setItemValues = (row: ExcelJS.Row, item: ChangeOrderItem, itemNumber: number): void => {
  const rowNumber = row.number;
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
    toText(item.sapNumber),
    escapeSpreadsheetText(item.descriptionEn),
    toText(item.descriptionDe),
    toText(item.dimensionMm),
    toText(item.material),
    item.weightKg,
    toText(item.clearDescription),
    item.unitPrice,
    {
      formula: `R${rowNumber}*C${rowNumber}`,
      result: calculateLineTotal(packagedOrderQuantity, item.unitPrice),
    },
    toText(item.countryOfOrigin),
    toText(item.hsCode),
    toText(item.tagNo),
    toText(item.drawingNo),
    toText(item.shippingList),
    toText(item.revisionNumber),
    toText(item.clientBarcode),
    toText(item.manufacturer),
    toText(item.manufacturerPartNo),
    toText(item.acsBarcode),
    toText(item.remarks),
  ];
  values.forEach((value, index) => {
    row.getCell(index + 1).value = value;
  });

  for (const column of [2, 3, 4, 7, 9]) {
    row.getCell(column).numFmt = '#,##0.00';
  }
  row.getCell(16).numFmt = '#,##0.###';
  row.getCell(18).numFmt = '#,##0.00 [$€-1]';
  row.getCell(19).numFmt = '#,##0.00 [$€-1]';
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

const setMergedHeaderValue = (
  worksheet: ExcelJS.Worksheet,
  candidates: string[],
  value: string,
): void => {
  const address =
    candidates.find((candidate) => {
      const cell = worksheet.getCell(candidate);
      return cell.isMerged || cell.value !== null;
    }) ?? candidates[0];
  worksheet.getCell(address).value = escapeSpreadsheetText(value);
};

const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const populateDocumentHeader = (
  worksheet: ExcelJS.Worksheet,
  headerRowNumber: number,
  changeOrder: ChangeOrderDetails,
): void => {
  const reportDate = currentExcelDate();

  if (headerRowNumber === 5) {
    // Current shared template: a four-row header with outlined merged blocks.
    setMergedHeaderValue(worksheet, ['D1'], changeOrder.projectName);
    setMergedHeaderValue(worksheet, ['D2'], changeOrder.projectCustomer);
    setMergedHeaderValue(worksheet, ['D3'], changeOrder.projectReference ?? '');
    setMergedHeaderValue(worksheet, ['K1'], changeOrder.projectName);
    setMergedHeaderValue(worksheet, ['K3'], changeOrder.title);
    worksheet.getCell('AD1').value = escapeSpreadsheetText(changeOrder.preparedBy);
    worksheet.getCell('AD2').value = reportDate;
    worksheet.getCell('AD3').value = {
      formula: 'AD2+28',
      result: addDays(reportDate, 28),
    };
    worksheet.getCell('AD4').value = escapeSpreadsheetText(changeOrder.revision);
    return;
  }

  // Compatibility with the previous three-row template layout.
  worksheet.getCell('B1').value = escapeSpreadsheetText(changeOrder.projectName);
  worksheet.getCell('B2').value = escapeSpreadsheetText(changeOrder.projectCustomer);
  worksheet.getCell('B3').value = escapeSpreadsheetText(changeOrder.projectReference ?? '');
  setMergedHeaderValue(worksheet, ['K1', 'F1'], changeOrder.projectName);
  setMergedHeaderValue(worksheet, ['K2', 'F2'], changeOrder.title);
  worksheet.getCell('AD1').value = escapeSpreadsheetText(changeOrder.preparedBy);
  worksheet.getCell('AD2').value = reportDate;
  worksheet.getCell('AD3').value = escapeSpreadsheetText(changeOrder.revision);
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
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:AD${lastRow}"/>`);

export const currentExcelDate = (now = new Date()): Date =>
  new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

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
): Promise<Buffer> {
  if (changeOrder.items.length === 0) {
    const documentName = documentType === 'internal-ncr' ? 'Internal NCR' : 'Change Order';
    const article = documentType === 'internal-ncr' ? 'An' : 'A';
    throw new EmptyChangeOrderError(
      `${article} ${documentName} must contain at least one material row`,
    );
  }
  const exportItems = consolidateChangeOrderItemsForExport(changeOrder.items);

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

  const totalTemplateRowNumber = findTotalRowNumber(worksheet, dataStartRowNumber);
  const dataTemplate = captureRowTemplate(worksheet.getRow(dataStartRowNumber));
  const totalTemplate = captureRowTemplate(worksheet.getRow(totalTemplateRowNumber));

  if (worksheet.getTable('MTO')) {
    worksheet.removeTable('MTO');
  }

  for (let rowNumber = dataStartRowNumber; rowNumber <= totalTemplateRowNumber; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (let column = 1; column <= 30; column += 1) {
      row.getCell(column).value = null;
    }
  }

  exportItems.forEach((item, index) => {
    const row = worksheet.getRow(dataStartRowNumber + index);
    applyRowTemplate(row, dataTemplate);
    setItemValues(row, item, index + 1);
  });

  const lastItemRow = headerRowNumber + exportItems.length;
  const totalRowNumber = lastItemRow + 1;
  const totalRow = worksheet.getRow(totalRowNumber);
  applyRowTemplate(totalRow, totalTemplate);
  totalRow.getCell(18).value = 'TOTAL:';
  totalRow.getCell(19).value = {
    formula: `SUM(S${dataStartRowNumber}:S${lastItemRow})`,
    result: exportItems.reduce((total, item) => total + item.totalPrice, 0),
  };
  if (totalRowNumber < totalTemplateRowNumber) {
    worksheet.spliceRows(totalRowNumber + 1, totalTemplateRowNumber - totalRowNumber);
  }

  worksheet.name = documentType === 'internal-ncr' ? 'Internal NCR' : 'Change Order';
  populateDocumentHeader(worksheet, headerRowNumber, changeOrder);

  worksheet.autoFilter = `A${headerRowNumber}:AD${lastItemRow}`;
  worksheet.pageSetup.printArea = `A1:AD${totalRowNumber}`;
  worksheet.pageSetup.printTitlesRow = `${headerRowNumber}:${headerRowNumber}`;
  const calculationProperties = workbook.calcProperties as typeof workbook.calcProperties & {
    forceFullCalc?: boolean;
    calcMode?: string;
  };
  calculationProperties.fullCalcOnLoad = true;
  calculationProperties.forceFullCalc = true;
  calculationProperties.calcMode = 'auto';

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
