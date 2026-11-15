import { routingDiagnosticText } from '../../shared/cableRoutingLabels.js';
import * as XLSX from 'xlsx';
import type ExcelJS from 'exceljs';
import { CABLE_ROUTING_PALETTE, cableRoutingTone, type CableRoutingControl } from '../../shared/cableRoutingControl.js';

export const CABLE_EXECUTION_EXCEL_COLUMNS = {
  installLength: { header: 'Install length [m]', aliases: ['Install length [m]', 'Install Length [m]', 'Installed length [m]'] },
  pullDate: { header: 'Pull date', aliases: ['Pull date', 'Pull Date'] },
  connectedFrom: { header: 'Connected From', aliases: ['Connected From', 'Connected "From"', 'Connected from'] },
  connectedTo: { header: 'Connected To', aliases: ['Connected To', 'Connected "To"', 'Connected to'] },
  tested: { header: 'Cable tested', aliases: ['Cable tested', 'Cable Tested', 'Tested', 'Tested date'] },
} as const;
/** Calendar date only: roundtrip does not depend on a workstation's timezone. */
export function parseCableExcelDate(value: unknown, date1904 = false): string | null {
  if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return null;
  let year: number, month: number, day: number;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('Enter a valid calendar date.');
    year = value.getUTCFullYear(); month = value.getUTCMonth() + 1; day = value.getUTCDate();
  } else if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 2958465 || !date1904 && value === 60) throw new Error('Enter a date without a time.');
    const decoded = XLSX.SSF.parse_date_code(value, { date1904 });
    if (!decoded) throw new Error('Enter a valid Excel date.');
    year = decoded.y; month = decoded.m; day = decoded.d;
  } else if (typeof value === 'string') {
    const text = value.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text), european = /^(\d{1,2})[.](\d{1,2})[.](\d{4})$/.exec(text);
    if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
    else if (european) { year = Number(european[3]); month = Number(european[2]); day = Number(european[1]); }
    else throw new Error('Use YYYY-MM-DD, DD.MM.YYYY or an Excel date cell.');
  } else throw new Error('Enter a valid date.');
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) throw new Error('Enter a valid calendar date.');
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error('Enter a valid calendar date.');
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export type RoutingExcelView = { routing: string | null; routingControl?: CableRoutingControl;
  autoCalculatedRouting?: string | null; autoRoutingStatus?: string; manualRouteLengthStatus?: string; routingDiagnostics?: string[] };
export function styleCableRoutingCell(cell: ExcelJS.Cell, view: RoutingExcelView) {
  const control = view.routingControl ?? { schemaVersion: 'wfc.cable-routing-control.v1' as const, manualRouting: view.routing,
    manualProtected: Boolean(view.routing?.trim()), executionLocked: false, executionRouting: null };
  const warning = Boolean(view.routingDiagnostics?.length || ['pending', 'stale', 'invalid'].includes(view.manualRouteLengthStatus ?? '')
    || ['unavailable', 'stale', 'failed', 'blocked'].includes(view.autoRoutingStatus ?? ''));
  const tone = cableRoutingTone(control, view.autoCalculatedRouting ?? null, warning, view.routing), palette = CABLE_ROUTING_PALETTE[tone];
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${palette.light.slice(1)}` } };
  cell.font = { ...cell.font, color: { argb: `FF${palette.textLight.slice(1)}` } };
  cell.note = [palette.label, `Used route: ${view.routing ?? 'Not set'}`, `Manual route: ${control.manualRouting ?? 'Not set'}`,
    `Automatic route: ${view.autoCalculatedRouting ?? 'Not calculated'}`, ...(view.routingDiagnostics ?? []).map(routingDiagnosticText)].join('\n');
}
