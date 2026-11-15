// @vitest-environment node
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseCableExcelDate, styleCableRoutingCell } from './cableRoutingExcel.js';
import { emptyRoutingControl } from '../../shared/cableRoutingControl.js';
describe('cable Excel execution dates and route meaning', () => {
  it.each([['2026-11-15', '2026-11-15'], ['15.11.2026', '2026-11-15'], ['29.02.2024', '2024-02-29'], [61, '1900-03-01'], ['', null], [null, null]] as const)('reads date %s', (input, expected) => expect(parseCableExcelDate(input)).toBe(expected));
  it('reads genuine Excel date cells and 1904 workbooks without local timezone drift', () => {
    expect(parseCableExcelDate(new Date('2026-11-15T00:00:00.000Z'))).toBe('2026-11-15');
    expect(parseCableExcelDate(0, true)).toBe('1904-01-01');
  });
  it.each(['2026-02-29', '31.11.2026', '11/12/2026', '2026-11-15T12:00:00Z', true, 60, 1.5, NaN])('rejects ambiguous/invalid date %s', value => expect(() => parseCableExcelDate(value)).toThrow());
  it('preserves colors and both route notes in a real xlsx roundtrip', async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Cables');
    const cell = sheet.getCell('A1'); cell.value = '/B001';
    styleCableRoutingCell(cell, { routing: '/B001', routingControl: { ...emptyRoutingControl(), manualRouting: '/B001', manualProtected: true }, autoCalculatedRouting: '/B002' });
    const reloaded = new ExcelJS.Workbook(); await reloaded.xlsx.load(await workbook.xlsx.writeBuffer());
    const result = reloaded.getWorksheet('Cables')!.getCell('A1');
    expect(result.fill).toMatchObject({ fgColor: { argb: 'FFFFF2DB' } });
    expect(JSON.stringify(result.note)).toContain('/B001'); expect(JSON.stringify(result.note)).toContain('/B002');
    expect(result.value).toBe('/B001');
  });
});
