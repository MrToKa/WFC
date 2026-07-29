import path from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { ChangeOrderDetails, ChangeOrderItem } from '../models/changeOrder.js';
import {
  generateChangeOrderWorkbook,
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

const reopen = async (count: number): Promise<ExcelJS.Worksheet> => {
  const buffer = await generateChangeOrderWorkbook(createDetails(count), templatePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  const worksheet = workbook.getWorksheet('Change Order');
  if (!worksheet) throw new Error('Generated worksheet is missing');
  return worksheet;
};

describe('Change Order workbook export', () => {
  it('populates headers, dynamic rows, formulas, ranges, dates, and safe text', async () => {
    const sourceWorkbook = new ExcelJS.Workbook();
    await sourceWorkbook.xlsx.readFile(templatePath);
    const source = sourceWorkbook.worksheets[0];
    validateChangeOrderTemplateHeaders(source);

    const worksheet = await reopen(2);
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
  });

  it('supports more rows than the original data capacity', async () => {
    const worksheet = await reopen(30);
    expect(worksheet.getCell('A34').value).toBe(30);
    expect(worksheet.getCell('D34').value).toMatchObject({ formula: 'C34-B34' });
    expect(worksheet.getCell('S34').value).toMatchObject({ formula: 'R34*C34' });
    expect(worksheet.getCell('R35').value).toBe('TOTAL:');
    expect(worksheet.getCell('S35').value).toMatchObject({ formula: 'SUM(S5:S34)' });
    expect(worksheet.pageSetup.printArea).toBe('A1:AD35');
    expect(worksheet.autoFilter).toBe('A4:AD34');
  });
});
