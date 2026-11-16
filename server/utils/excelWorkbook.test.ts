// @vitest-environment node
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { orderExcelWorksheetDrawings, writeExcelWorkbook } from './excelWorkbook.js';

it('preserves every part except worksheet ordering across multiple sheets and is idempotent', async () => {
  const workbook = new ExcelJS.Workbook();
  for (const name of ['Cables', 'Other cables']) {
    const sheet = workbook.addWorksheet(name);
    sheet.addTable({ name: name === 'Cables' ? 'Cables' : 'OtherCables', ref: 'A1',
      columns: [{ name: 'Routing' }], rows: [['/B001 & /B002']] });
    sheet.getCell('A2').note = 'Маршрут <B001> & B002';
  }
  const original = await workbook.xlsx.writeBuffer();
  const fixed = await orderExcelWorksheetDrawings(Buffer.from(original));
  const before = await JSZip.loadAsync(original), after = await JSZip.loadAsync(fixed);
  expect(Object.keys(after.files).sort()).toEqual(Object.keys(before.files).sort());
  for (const entry of Object.values(before.files)) {
    if (entry.dir) continue;
    const source = await entry.async('string'), result = await after.file(entry.name)!.async('string');
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)) {
      expect(result.indexOf('<legacyDrawing ')).toBeLessThan(result.indexOf('<tableParts '));
      expect(result.replace(/<legacyDrawing\b[^>]*\/>/, '')).toBe(source.replace(/<legacyDrawing\b[^>]*\/>/, ''));
    } else expect(result).toBe(source);
  }
  expect(await orderExcelWorksheetDrawings(fixed)).toBe(fixed);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(Uint8Array.from(fixed).buffer);
  expect(loaded.getWorksheet('Cables')!.getCell('A2').value).toBe('/B001 & /B002');
  expect(JSON.stringify(loaded.getWorksheet('Other cables')!.getCell('A2').note)).toContain('Маршрут');
});

it('places comments before worksheet extensions even without a table', async () => {
  const archive = new JSZip();
  archive.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData/><extLst/><legacyDrawing r:id="rId2"/></worksheet>');
  const fixed = await JSZip.loadAsync(await orderExcelWorksheetDrawings(await archive.generateAsync({ type: 'nodebuffer' })));
  expect(await fixed.file('xl/worksheets/sheet1.xml')!.async('string')).toBe(
    '<worksheet><sheetData/><legacyDrawing r:id="rId2"/><extLst/></worksheet>',
  );
});

it('leaves workbooks without comments untouched', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Plain').getCell('A1').value = 'Cable';
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  expect(await orderExcelWorksheetDrawings(buffer)).toBe(buffer);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(Uint8Array.from(await writeExcelWorkbook(workbook)).buffer);
  expect(loaded.getWorksheet('Plain')!.getCell('A1').value).toBe('Cable');
});
