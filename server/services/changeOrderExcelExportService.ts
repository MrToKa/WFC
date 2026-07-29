import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  calculateChangeOrderTotal,
  type ChangeOrderDetails,
  type ChangeOrderItem,
} from '../models/changeOrder.js';

const TEMPLATE_FILE_NAME = 'Change order - Discharge Impulse lines materials.xlsx';
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
  'Client Barcode',
  'Original Equipment Manufacturer',
  'Manufacturer Part No.',
  'ACS barcode',
  'Remarks',
] as const;

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

export const validateChangeOrderTemplateHeaders = (worksheet: ExcelJS.Worksheet): void => {
  const invalid: string[] = [];
  EXPECTED_HEADERS.forEach((expected, index) => {
    const cell = worksheet.getRow(4).getCell(index + 1);
    if (normalizeHeader(cell.value) !== normalizeHeader(expected)) {
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
  const values: Array<ExcelJS.CellValue> = [
    itemNumber,
    item.designQuantity,
    item.orderQuantity,
    { formula: `C${rowNumber}-B${rowNumber}`, result: item.spareQuantity },
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
    { formula: `R${rowNumber}*C${rowNumber}`, result: item.totalPrice },
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

  for (const column of [2, 3, 4, 7, 9, 16]) {
    row.getCell(column).numFmt = '#,##0.###';
  }
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

const findTotalRowNumber = (worksheet: ExcelJS.Worksheet): number => {
  for (let rowNumber = 5; rowNumber <= worksheet.rowCount; rowNumber += 1) {
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
): Promise<Buffer> {
  if (changeOrder.items.length === 0) {
    throw new EmptyChangeOrderError('A Change Order must contain at least one material row');
  }

  const workbook = new ExcelJS.Workbook();
  const resolvedTemplatePath = templatePath ?? (await resolveDefaultTemplatePath());
  try {
    await workbook.xlsx.readFile(resolvedTemplatePath);
  } catch (error) {
    if (error instanceof ChangeOrderTemplateError) throw error;
    throw new ChangeOrderTemplateError('Change Order workbook template could not be read');
  }

  const worksheet = findTemplateWorksheet(workbook);
  validateChangeOrderTemplateHeaders(worksheet);

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

  const totalTemplateRowNumber = findTotalRowNumber(worksheet);
  const dataTemplate = captureRowTemplate(worksheet.getRow(5));
  const totalTemplate = captureRowTemplate(worksheet.getRow(totalTemplateRowNumber));

  if (worksheet.getTable('MTO')) {
    worksheet.removeTable('MTO');
  }

  for (let rowNumber = 5; rowNumber <= totalTemplateRowNumber; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (let column = 1; column <= 30; column += 1) {
      row.getCell(column).value = null;
    }
  }

  changeOrder.items.forEach((item, index) => {
    const row = worksheet.getRow(5 + index);
    applyRowTemplate(row, dataTemplate);
    setItemValues(row, item, index + 1);
  });

  const lastItemRow = 4 + changeOrder.items.length;
  const totalRowNumber = lastItemRow + 1;
  const totalRow = worksheet.getRow(totalRowNumber);
  applyRowTemplate(totalRow, totalTemplate);
  totalRow.getCell(18).value = 'TOTAL:';
  totalRow.getCell(19).value = {
    formula: `SUM(S5:S${lastItemRow})`,
    result: calculateChangeOrderTotal(changeOrder.items),
  };
  if (totalRowNumber < totalTemplateRowNumber) {
    worksheet.spliceRows(totalRowNumber + 1, totalTemplateRowNumber - totalRowNumber);
  }

  worksheet.name = 'Change Order';
  worksheet.getCell('B1').value = escapeSpreadsheetText(changeOrder.projectName);
  worksheet.getCell('B2').value = escapeSpreadsheetText(changeOrder.projectCustomer);
  worksheet.getCell('B3').value = escapeSpreadsheetText(changeOrder.projectReference ?? '');
  setMergedHeaderValue(worksheet, ['K1', 'F1'], changeOrder.projectName);
  setMergedHeaderValue(worksheet, ['K2', 'F2'], changeOrder.title);
  worksheet.getCell('AD1').value = escapeSpreadsheetText(changeOrder.preparedBy);
  worksheet.getCell('AD2').value = currentExcelDate();
  worksheet.getCell('AD3').value = escapeSpreadsheetText(changeOrder.revision);

  worksheet.autoFilter = `A4:AD${lastItemRow}`;
  worksheet.pageSetup.printArea = `A1:AD${totalRowNumber}`;
  worksheet.pageSetup.printTitlesRow = '4:4';
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

export const sanitizeChangeOrderFileName = (title: string, revision: string): string => {
  const clean = (value: string): string =>
    value
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  return `Change order - ${clean(title) || 'report'} - Rev ${clean(revision) || '00'}.xlsx`;
};
