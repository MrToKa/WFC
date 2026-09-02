import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { ChangeOrderDetails, ChangeOrderItem } from '../models/changeOrder.js';
import {
  consolidateChangeOrderItemsForExport,
  currentExcelDate,
  generateChangeOrderWorkbook,
  newestRevisionNumber,
  normalizeSpreadsheetFontOrder,
  sanitizeChangeOrderFileName,
  trimWorksheetAfterRow,
  validateChangeOrderTemplateHeaders,
} from './changeOrderExcelExportService.js';

const templatePath = path.resolve(
  process.cwd(),
  'Template files',
  'Change order - Change order - Trafo interface and Sampling pumps cables.xlsx',
);

const expectedHeaderMerges = [
  'A1:C1',
  'A2:C2',
  'A3:C4',
  'D1:J1',
  'D2:J2',
  'D3:J4',
  'K1:X2',
  'K3:X4',
] as const;

const createItem = (index: number): ChangeOrderItem => ({
  id: `item-${index}`,
  changeOrderId: 'change-order',
  sortOrder: index,
  sourceCatalog: 'support',
  sourceMaterialId: `source-${index}`,
  designQuantity: index === 1 ? 10.5 : 2,
  orderQuantity: index === 1 ? 8.25 : 3,
  spareQuantity: index === 1 ? 1.75 : 7,
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
  it('names the export after the Change Order title', () => {
    expect(sanitizeChangeOrderFileName('Discharge impulse lines')).toBe(
      'Change order - Discharge impulse lines.xlsx',
    );
    expect(sanitizeChangeOrderFileName('  Area 1: cable/order  ')).toBe(
      'Change order - Area 1 cable order.xlsx',
    );
  });

  it('uses Internal NCR branding while reusing the Change Order workbook template', async () => {
    expect(sanitizeChangeOrderFileName('Area 1: cable/order', 'internal-ncr')).toBe(
      'Internal NCR - Area 1 cable order.xlsx',
    );

    const buffer = await generateChangeOrderWorkbook(
      createDetails(1),
      templatePath,
      'internal-ncr',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);

    const worksheet = workbook.getWorksheet('Internal NCR');
    expect(worksheet).toBeDefined();
    expect(workbook.getWorksheet('Change Order')).toBeUndefined();
    expect(worksheet?.model.merges).toEqual(expect.arrayContaining([...expectedHeaderMerges]));
    expect(worksheet?.getCell('A5').fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { theme: 4 },
    });
    expect(worksheet?.getCell('V5').value).toBe('Certificates');
    expect(worksheet?.getCell('P7').font.bold).toBe(true);
    expect(worksheet?.getCell('Q7').font.bold).toBe(true);
  });

  it('uses the supplied styled workbook as the default shared template', async () => {
    const buffer = await generateChangeOrderWorkbook(createDetails(1));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const worksheet = workbook.getWorksheet('Change Order');
    if (!worksheet) throw new Error('Generated worksheet is missing');

    expect(worksheet.model.merges).toEqual(expect.arrayContaining([...expectedHeaderMerges]));
    expect(worksheet.getCell('A5').fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { theme: 4 },
    });
    expect(worksheet.getCell('V5').value).toBe('Certificates');
    expect(worksheet.getCell('P7').font.bold).toBe(true);
    expect(worksheet.getCell('Q7').font.bold).toBe(true);
  });

  it('consolidates identical cable materials into one export position', async () => {
    const firstCable: ChangeOrderItem = {
      ...createItem(1),
      sourceCatalog: 'cable-type',
      sourceMaterialId: 'same-cable-type',
      unit: 'm',
      designQuantity: 50,
      orderQuantity: 60,
      spareQuantity: 0,
      packaging: 'Drum',
      packagingQuantity: 1,
      packagingUnit: 'meters',
      orderedQuantity: 60,
      orderedUnit: 'Drum',
      minimumOrderQuantity: 1,
      orderMeasurement: 'meters',
      unitPrice: 2,
      totalPrice: 120,
    };
    const secondCable: ChangeOrderItem = {
      ...firstCable,
      id: 'second-cable-line',
      sortOrder: 2,
      designQuantity: 100,
      orderQuantity: 120,
      spareQuantity: 0,
      orderedQuantity: 120,
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
        orderedQuantity: 180,
        unit: 'm',
        totalPrice: 360,
      },
    ]);

    const buffer = await generateChangeOrderWorkbook(details, templatePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const worksheet = workbook.getWorksheet('Change Order');
    if (!worksheet) throw new Error('Generated worksheet is missing');

    expect(worksheet.getCell('B6').value).toBe(150);
    expect(worksheet.getCell('C6').value).toMatchObject({ formula: 'G6*I6', result: 180 });
    expect(worksheet.getCell('E6').value).toBe('m');
    expect(worksheet.getCell('F6').value).toBe('Drum');
    expect(worksheet.getCell('G6').value).toBe(1);
    expect(worksheet.getCell('H6').value).toBe('meters');
    expect(worksheet.getCell('I6').value).toBe(180);
    expect(worksheet.getCell('J6').value).toBe('Drum');
    expect(worksheet.getCell('P7').value).toBe('TOTAL:');
    expect(worksheet.getCell('A7').value).toBeNull();
  });

  it('sums the same material and exports only its newest revision', async () => {
    const revision00: ChangeOrderItem = {
      ...createItem(1),
      designQuantity: 10,
      orderQuantity: 10,
      revisionNumber: '00',
    };
    const revision01: ChangeOrderItem = {
      ...revision00,
      id: 'same-material-new-revision',
      sortOrder: 2,
      designQuantity: 20,
      orderQuantity: 20,
      revisionNumber: '01',
    };

    expect(newestRevisionNumber([revision00, revision01])).toBe('01');
    expect(consolidateChangeOrderItemsForExport([revision00, revision01])).toMatchObject([
      {
        designQuantity: 30,
        orderQuantity: 30,
        revisionNumber: '01',
      },
    ]);

    const details = createDetails(0);
    details.items = [revision00, revision01];
    details.itemCount = 2;
    details.totalPrice = 135;
    const buffer = await generateChangeOrderWorkbook(details, templatePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const worksheet = workbook.getWorksheet('Change Order');
    if (!worksheet) throw new Error('Generated worksheet is missing');

    expect(worksheet.getCell('C6').value).toMatchObject({ formula: 'G6*I6', result: 30 });
    expect(worksheet.getCell('U6').value).toBe('01');
    expect(worksheet.getCell('A7').value).toBeNull();
  });

  it('joins differing report fields while summing the same material type', async () => {
    const firstCable: ChangeOrderItem = {
      ...createItem(1),
      sourceCatalog: 'cable-type',
      sourceMaterialId: 'same-cable-type',
      designQuantity: 50,
      orderQuantity: 60,
      tagNo: 'ESD-001',
      drawingNo: 'GDS-100',
      remarks: 'Area A',
    };
    const secondCable: ChangeOrderItem = {
      ...firstCable,
      id: 'second-cable-line',
      sortOrder: 2,
      designQuantity: 100,
      orderQuantity: 120,
      descriptionEn: 'Updated cable description',
      tagNo: 'ESD-002',
      drawingNo: 'GDS-200',
      remarks: 'Area B',
    };
    const thirdCable: ChangeOrderItem = {
      ...secondCable,
      id: 'third-cable-line',
      sortOrder: 3,
      designQuantity: 25,
      orderQuantity: 30,
      tagNo: 'ESD-001',
      drawingNo: null,
      remarks: null,
    };

    const consolidated = consolidateChangeOrderItemsForExport([
      firstCable,
      secondCable,
      thirdCable,
    ]);
    expect(consolidated).toMatchObject([
      {
        designQuantity: 175,
        orderQuantity: 210,
        descriptionEn: '=unsafe formula, Updated cable description',
        tagNo: 'ESD-001, ESD-002',
        drawingNo: 'GDS-100, GDS-200',
        remarks: 'Area A, Area B',
      },
    ]);

    const details = createDetails(0);
    details.items = [firstCable, secondCable, thirdCable];
    details.itemCount = 3;
    details.totalPrice = consolidated[0].totalPrice;
    const buffer = await generateChangeOrderWorkbook(details, templatePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const worksheet = workbook.getWorksheet('Change Order');
    if (!worksheet) throw new Error('Generated worksheet is missing');

    expect(worksheet.getCell('B6').value).toBe(175);
    expect(worksheet.getCell('C6').value).toMatchObject({ formula: 'G6*I6', result: 210 });
    expect(worksheet.getCell('K6').value).toBe("'=unsafe formula, Updated cable description");
    expect(worksheet.getCell('S6').value).toBe('ESD-001, ESD-002');
    expect(worksheet.getCell('T6').value).toBe('GDS-100, GDS-200');
    expect(worksheet.getCell('Z6').value).toBe('Area A, Area B');
    expect(worksheet.getCell('P7').value).toBe('TOTAL:');
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

  it('recalculates packages and spare after identical materials are consolidated', () => {
    const first = {
      ...createItem(1),
      designQuantity: 8,
      orderQuantity: 8,
      packaging: 'Box',
      packagingQuantity: 50,
      packagingUnit: 'pcs',
      orderedQuantity: 1,
      orderedUnit: 'Box',
      minimumOrderQuantity: 50,
      orderMeasurement: 'pcs' as const,
    };
    const second = {
      ...first,
      id: 'second-box-line',
      designQuantity: 30,
      orderQuantity: 30,
    };

    expect(consolidateChangeOrderItemsForExport([first, second])).toMatchObject([
      {
        designQuantity: 38,
        orderQuantity: 38,
        orderedQuantity: 1,
        spareQuantity: 12,
        packaging: 'Box',
        packagingQuantity: 50,
        packagingUnit: 'pcs',
        orderedUnit: 'Box',
      },
    ]);
  });

  it('counts the order above cable design as spare after consolidation', () => {
    const first = {
      ...createItem(1),
      sourceCatalog: 'cable-type' as const,
      sourceMaterialId: 'same-cable',
      designQuantity: 50,
      orderQuantity: 52,
      packaging: 'm',
      packagingQuantity: 1,
      packagingUnit: 'meters',
      orderedQuantity: 52,
      orderedUnit: 'm',
      minimumOrderQuantity: 1,
      orderMeasurement: 'meters' as const,
    };
    const second = {
      ...first,
      id: 'second-cable',
      sortOrder: 2,
    };

    expect(consolidateChangeOrderItemsForExport([first, second])).toMatchObject([
      {
        designQuantity: 100,
        orderQuantity: 104,
        orderedQuantity: 104,
        spareQuantity: 4,
      },
    ]);
  });

  it('keeps historical snapshots separate when minimum orders differ', () => {
    const first = {
      ...createItem(1),
      minimumOrderQuantity: 1,
      orderMeasurement: 'pack' as const,
    };
    const second = {
      ...first,
      id: 'second-minimum',
      minimumOrderQuantity: 2,
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
    expect(worksheet.getCell('D1').value).toBe('Heat Pump Project');
    expect(worksheet.getCell('D2').value).toBe('Customer Ltd');
    expect(worksheet.getCell('D3').value).toBe('P-100');
    expect(worksheet.getCell('K1').value).toBe('Heat Pump Project');
    expect(worksheet.getCell('K3').value).toBe('Discharge impulse lines');
    expect(worksheet.getCell('Z1').value).toBe('Test User');
    expect(worksheet.getCell('Z2').value).toBeInstanceOf(Date);
    expect(worksheet.getCell('Z3').value).toMatchObject({ formula: 'Z2+28' });
    expect(worksheet.getCell('Z4').value).toBe('02');
    expect(worksheet.getCell('A5').value).toBe('Item No.');
    expect(worksheet.getCell('V5').value).toBe('Certificates');
    expect(worksheet.getCell('Z5').value).toBe('Remarks');
    const exportedHeaders = worksheet.getRow(5).values;
    expect(exportedHeaders).not.toContain('SAP number');
    expect(exportedHeaders).not.toContain('Description (DE)');
    expect(exportedHeaders).not.toContain('HS Code');
    expect(exportedHeaders).not.toContain('Shipping list');
    expect(worksheet.getCell('A6').value).toBe(1);
    expect(worksheet.getCell('A7').value).toBe(2);
    expect(worksheet.getCell('K6').value).toBe("'=unsafe formula");
    expect(worksheet.getCell('Z7').value).toBe("'@unsafe remark");
    expect(worksheet.getCell('C6').value).toMatchObject({ formula: 'G6*I6', result: 10 });
    expect(worksheet.getCell('D6').value).toMatchObject({
      formula: 'C6-B6',
      result: -0.5,
    });
    expect(worksheet.getCell('Q6').value).toMatchObject({ formula: 'P6*C6', result: 45 });
    for (const address of ['B6', 'C6', 'D6', 'G6', 'I6']) {
      expect(worksheet.getCell(address).numFmt).toBe('#,##0.00');
    }
    expect(worksheet.getCell('P8').value).toBe('TOTAL:');
    expect(worksheet.getCell('Q8').value).toMatchObject({ formula: 'SUM(Q6:Q7)' });
    expect(worksheet.getCell('L9').value).toBeNull();
    expect(worksheet.pageSetup.orientation).toBe('landscape');
    expect(worksheet.pageSetup.printArea).toBe('A1:Z8');
    expect(worksheet.pageSetup.printTitlesRow).toBe('5:5');
    expect(worksheet.autoFilter).toBe('A5:Z7');
    expect(worksheet.getRow(6).height).toBe(source.getRow(6).height);
    expect(worksheet.getCell('A6').border.left?.style).toBe(
      source.getCell('A6').border.left?.style,
    );
    expect(worksheet.model.merges).toHaveLength(expectedHeaderMerges.length);
    expect(worksheet.model.merges).toEqual(expect.arrayContaining([...expectedHeaderMerges]));
    for (let column = 1; column <= 26; column += 1) {
      const fill = worksheet.getRow(5).getCell(column).fill;
      expect(fill.type).toBe('pattern');
      if (fill.type !== 'pattern') throw new Error('Expected a pattern fill');
      expect(fill.pattern).toBe('solid');
      expect(fill.fgColor?.theme).toBe(4);
      expect(fill.fgColor?.tint).toBeCloseTo(0.5999938962981048, 12);
    }
    for (const address of ['P8', 'Q8']) {
      const cell = worksheet.getCell(address);
      expect(cell.font.bold).toBe(true);
      expect(cell.fill).toMatchObject({
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFF00' },
      });
    }
    expect(worksheet.getCell('P8').border).toEqual(source.getCell('R9').border);
    expect(worksheet.getCell('Q8').border).toEqual(source.getCell('S9').border);

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
    expect(worksheetXml).toContain('<autoFilter ref="A5:Z7"');
    expect(worksheetXml).not.toContain('<conditionalFormatting');
    expect(worksheetXml).toContain('<dimension ref="A1:Z8"');
    expect(worksheetXml).not.toMatch(/<row\b[^>]*\br="(?:9|[1-9]\d+)"/);
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
      '<row r="7"><c r="S7"/></row><row r="8"><c r="A8" s="5"/></row>' +
      '<row r="29"><c r="A29" s="8"/></row></sheetData></worksheet>';
    expect(trimWorksheetAfterRow(worksheetXml, 7)).toBe(
      '<worksheet><dimension ref="A1:Z7"/><sheetData>' +
        '<row r="7"><c r="S7"/></row></sheetData></worksheet>',
    );
  });

  it('supports more rows than the original data capacity', async () => {
    const { worksheet } = await reopen(30);
    expect(worksheet.getCell('A35').value).toBe(30);
    expect(worksheet.getCell('C35').value).toMatchObject({ formula: 'G35*I35' });
    expect(worksheet.getCell('D35').value).toMatchObject({
      formula: 'C35-B35',
    });
    expect(worksheet.getCell('Q35').value).toMatchObject({ formula: 'P35*C35' });
    expect(worksheet.getCell('P36').value).toBe('TOTAL:');
    expect(worksheet.getCell('Q36').value).toMatchObject({ formula: 'SUM(Q6:Q35)' });
    expect(worksheet.pageSetup.printArea).toBe('A1:Z36');
    expect(worksheet.autoFilter).toBe('A5:Z35');
  });
});
