import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { ChangeOrderDetails, ChangeOrderItem } from '../models/changeOrder.js';
import {
  consolidateChangeOrderItemsForExport,
  currentExcelDate,
  generateChangeOrderWorkbook,
  normalizeSpreadsheetFontOrder,
  trimWorksheetAfterRow,
  validateChangeOrderTemplateHeaders,
} from './changeOrderExcelExportService.js';

const templatePath = path.resolve(
  process.cwd(),
  'Template files',
  'Change order - Discharge Impulse lines materials.xlsx',
);

const createItem = (index: number): ChangeOrderItem => ({
  id: `item-${index}`,
  changeOrderId: 'change-order',
  sortOrder: index,
  sourceCatalog: 'support',
  sourceMaterialId: `source-${index}`,
  designQuantity: index === 1 ? 10.5 : 2,
  orderQuantity: index === 1 ? 8.25 : 3,
  spareQuantity: index === 1 ? -2.25 : 1,
  unit: 'pcs',
  packaging: 'box',
  packagingQuantity: 5,
  packagingUnit: 'pcs',
  orderedQuantity: 2,
  orderedUnit: 'boxes',
  sapNumber: null,
  descriptionEn: index === 1 ? '=unsafe formula' : `Material ${index}`,
  descriptionDe: null,
  dimensionMm: 'H 40 × W 60',
  material: 'Steel',
  weightKg: 1.25,
  clearDescription: 'A complete support set',
  unitPrice: 4.5,
  totalPrice: (index === 1 ? 8.25 : 3) * 4.5,
  countryOfOrigin: null,
  hsCode: null,
  tagNo: null,
  drawingNo: null,
  shippingList: null,
  revisionNumber: '00',
  clientBarcode: null,
  manufacturer: 'Maker',
  manufacturerPartNo: `P-${index}`,
  acsBarcode: null,
  remarks: index === 2 ? '@unsafe remark' : null,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
});

const createDetails = (count: number): ChangeOrderDetails => {
  const items = Array.from({ length: count }, (_, index) => createItem(index + 1));
  return {
    id: 'change-order',
    projectId: 'project',
    title: 'Discharge impulse lines',
    projectReference: 'P-100',
    preparedBy: 'Test User',
    reportDate: '2026-07-29',
    revision: '02',
    itemCount: count,
    totalPrice: items.reduce((sum, item) => sum + item.totalPrice, 0),
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    projectName: 'Heat Pump Project',
    projectCustomer: 'Customer Ltd',
    createdBy: null,
    items,
  };
};

const reopen = async (
  count: number,
): Promise<{ workbook: ExcelJS.Workbook; worksheet: ExcelJS.Worksheet; buffer: Buffer }> => {
  const buffer = await generateChangeOrderWorkbook(createDetails(count), templatePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  const worksheet = workbook.getWorksheet('Change Order');
  if (!worksheet) throw new Error('Generated worksheet is missing');
  return { workbook, worksheet, buffer };
};

describe('Change Order workbook export', () => {
  it('consolidates identical cable materials into one export position', async () => {
    const firstCable: ChangeOrderItem = {
      ...createItem(1),
      sourceCatalog: 'cable-type',
      sourceMaterialId: 'same-cable-type',
      unit: 'm',
      designQuantity: 50,
      orderQuantity: 60,
      spareQuantity: 10,
      orderedQuantity: null,
      unitPrice: 2,
      totalPrice: 120,
    };
    const secondCable: ChangeOrderItem = {
      ...firstCable,
      id: 'second-cable-line',
      sortOrder: 2,
      designQuantity: 100,
      orderQuantity: 120,
      spareQuantity: 20,
      totalPrice: 240,
    };
    const details = createDetails(0);
    details.items = [firstCable, secondCable];
    details.itemCount = 2;
    details.totalPrice = 360;

    expect(consolidateChangeOrderItemsForExport(details.items)).toMatchObject([
      {
        sourceMaterialId: 'same-cable-type',
        designQuantity: 150,
        orderQuantity: 180,
        spareQuantity: 30,
        unit: 'm',
        totalPrice: 360,
      },
    ]);

    const buffer = await generateChangeOrderWorkbook(details, templatePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const worksheet = workbook.getWorksheet('Change Order');
    if (!worksheet) throw new Error('Generated worksheet is missing');

    expect(worksheet.getCell('B5').value).toBe(150);
    expect(worksheet.getCell('C5').value).toBe(180);
    expect(worksheet.getCell('E5').value).toBe('m');
    expect(worksheet.getCell('R6').value).toBe('TOTAL:');
    expect(worksheet.getCell('A6').value).toBeNull();
  });

  it('keeps the same material separate when unit prices differ', () => {
    const first = createItem(1);
    const second = {
      ...first,
      id: 'second-price',
      unitPrice: first.unitPrice + 1,
    };

    expect(consolidateChangeOrderItemsForExport([first, second])).toHaveLength(2);
  });

  it('populates headers, dynamic rows, formulas, ranges, dates, and safe text', async () => {
    const sourceWorkbook = new ExcelJS.Workbook();
    await sourceWorkbook.xlsx.readFile(templatePath);
    const source = sourceWorkbook.worksheets[0];
    validateChangeOrderTemplateHeaders(source);

    const { workbook, worksheet, buffer } = await reopen(2);
    expect(worksheet.name).toBe('Change Order');
    expect(worksheet.getCell('B1').value).toBe('Heat Pump Project');
    expect(worksheet.getCell('B2').value).toBe('Customer Ltd');
    expect(worksheet.getCell('B3').value).toBe('P-100');
    expect(worksheet.getCell('K2').value).toBe('Discharge impulse lines');
    expect(worksheet.getCell('AD1').value).toBe('Test User');
    expect(worksheet.getCell('AD2').value).toBeInstanceOf(Date);
    expect(worksheet.getCell('AD3').value).toBe('02');
    expect(worksheet.getCell('A5').value).toBe(1);
    expect(worksheet.getCell('A6').value).toBe(2);
    expect(worksheet.getCell('L5').value).toBe("'=unsafe formula");
    expect(worksheet.getCell('AD6').value).toBe("'@unsafe remark");
    expect(worksheet.getCell('D5').value).toMatchObject({ formula: 'C5-B5' });
    expect(worksheet.getCell('S5').value).toMatchObject({ formula: 'R5*C5' });
    expect(worksheet.getCell('R7').value).toBe('TOTAL:');
    expect(worksheet.getCell('S7').value).toMatchObject({ formula: 'SUM(S5:S6)' });
    expect(worksheet.getCell('L8').value).toBeNull();
    expect(worksheet.getColumn('M').hidden).toBe(true);
    expect(worksheet.getColumn('U').hidden).toBe(true);
    expect(worksheet.pageSetup.orientation).toBe('landscape');
    expect(worksheet.pageSetup.printArea).toBe('A1:AD7');
    expect(worksheet.pageSetup.printTitlesRow).toBe('4:4');
    expect(worksheet.autoFilter).toBe('A4:AD6');
    expect(worksheet.getRow(5).height).toBe(source.getRow(5).height);
    expect(worksheet.getCell('A5').border.left?.style).toBe(
      source.getCell('A5').border.left?.style,
    );
    expect(worksheet.getCell('R7').font.bold).toBe(source.getCell('R29').font.bold);

    expect(
      workbook.definedNames.model.some(
        (definedName) =>
          definedName.name === '_xlnm._FilterDatabase' ||
          definedName.ranges.some((range) => range.includes('List1') || range.includes('[1]')),
      ),
    ).toBe(false);

    const archive = await JSZip.loadAsync(buffer);
    const workbookXml = await archive.file('xl/workbook.xml')?.async('string');
    const worksheetXml = await archive.file('xl/worksheets/sheet1.xml')?.async('string');
    expect(workbookXml).toBeDefined();
    expect(workbookXml).not.toContain('_xlnm._FilterDatabase');
    expect(workbookXml).not.toContain('List1');
    expect(worksheetXml).toContain('<cols>');
    expect(worksheetXml).toContain('<mergeCells');
    expect(worksheetXml).toContain('<autoFilter ref="A4:AD6"');
    expect(worksheetXml).not.toContain('<conditionalFormatting');
    expect(worksheetXml).toContain('<dimension ref="A1:AD7"');
    expect(worksheetXml).not.toMatch(/<row\b[^>]*\br="(?:8|9|[1-9]\d+)"/);
    expect(archive.file('xl/calcChain.xml')).toBeNull();
    expect(archive.file(/xl\/externalLinks\//)).toHaveLength(0);
  });

  it('writes font properties in the SpreadsheetML order required by Excel desktop', () => {
    const stylesXml =
      '<fonts><font><charset val="238"/><color theme="1"/><family val="2"/>' +
      '<scheme val="minor"/><sz val="11"/><name val="Calibri"/></font></fonts>';

    expect(normalizeSpreadsheetFontOrder(stylesXml)).toBe(
      '<fonts><font><sz val="11"/><color theme="1"/><name val="Calibri"/>' +
        '<family val="2"/><charset val="238"/><scheme val="minor"/></font></fonts>',
    );
  });

  it('uses the current local date and removes styled template rows below Total', () => {
    const localDate = new Date(2026, 7, 2, 23, 45);
    expect(currentExcelDate(localDate).toISOString()).toBe('2026-08-02T00:00:00.000Z');

    const worksheetXml =
      '<worksheet><dimension ref="A1:AD29"/><sheetData>' +
      '<row r="6"><c r="S6"/></row><row r="7"><c r="A7" s="5"/></row>' +
      '<row r="29"><c r="A29" s="8"/></row></sheetData></worksheet>';
    expect(trimWorksheetAfterRow(worksheetXml, 6)).toBe(
      '<worksheet><dimension ref="A1:AD6"/><sheetData>' +
        '<row r="6"><c r="S6"/></row></sheetData></worksheet>',
    );
  });

  it('supports more rows than the original data capacity', async () => {
    const { worksheet } = await reopen(30);
    expect(worksheet.getCell('A34').value).toBe(30);
    expect(worksheet.getCell('D34').value).toMatchObject({ formula: 'C34-B34' });
    expect(worksheet.getCell('S34').value).toMatchObject({ formula: 'R34*C34' });
    expect(worksheet.getCell('R35').value).toBe('TOTAL:');
    expect(worksheet.getCell('S35').value).toMatchObject({ formula: 'SUM(S5:S34)' });
    expect(worksheet.pageSetup.printArea).toBe('A1:AD35');
    expect(worksheet.autoFilter).toBe('A4:AD34');
  });
});
