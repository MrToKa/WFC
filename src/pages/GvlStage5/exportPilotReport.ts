import type { Workbook } from 'exceljs';
import type { PilotReport } from './report';
import { label, scopeLabels } from './reportLabels';

type Cell = string | number | null | undefined;
type Column = [heading: string, width: number];

function addSheet(workbook: Workbook, name: string, columns: Column[], rows: Cell[][], filter = false) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(([header, width]) => ({
    header, width, style: { alignment: { vertical: 'top', wrapText: true } },
  }));
  sheet.addRows(rows);
  const header = sheet.getRow(1);
  header.height = 30;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174A70' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  if (filter) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: columns.length },
    };
  }
  return sheet;
}

function formatDocuments(documents: PilotReport['unresolved'][number]['documents'] = []) {
  return documents.map(({ source, page }) => page === null ? source : `${source} · стр. ${page}`).join('\n');
}

export async function buildPilotReportWorkbook(report: PilotReport) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const { summary, quality } = report;
  const metricColumns: Column[] = [['Показател', 42], ['Стойност', 72]];
  addSheet(workbook, 'Обобщение', metricColumns, [
    ['Статус на сверяване', scopeLabels[report.scopeStatus]],
    ['Данни към (ISO 8601)', report.capturedAt],
    ['Модел', report.modelLabel],
    ['Проект (ID)', report.projectId],
    ['Общо локации', summary.locations],
    ['Присвоени локации', summary.assigned],
    ['Запазени локации', summary.preserved],
    ['Други валидни присвоявания от WFC', summary.otherReady],
    ['Локации за преглед', summary.unresolved],
    ['Общо кабели', summary.cables],
    ['Кабели с маршрут', summary.routed],
    ['Кабели без маршрут', summary.unrouted],
    ['Защитени ръчни маршрути', summary.manualProtected],
    ['Променени тагове', summary.changedTags],
  ]);

  const checks = addSheet(workbook, 'Проверки и разходи', metricColumns, quality ? [
    ['Данни към (ISO 8601)', quality.capturedAt],
    ['Версия на модела (ID)', quality.modelVersionId],
    ['Анализирани страници', quality.pagesAnalyzed],
    ['Общо страници', quality.pagesTotal],
    ['Проверени локации', quality.locationsChecked],
    ['Потвърдени присвоявания', quality.verifiedBindings],
    ['Локации за преглед', quality.reviewLocations],
    ['Успешни автоматични проверки', quality.checksPassed],
    ['Общо автоматични проверки', quality.checksTotal],
    ['Заявки към OpenAI', quality.apiAttempts],
    ['Оценен разход (USD)', quality.estimatedUsd],
    ['Лимит (USD)', quality.ceilingUsd],
    ['Дял на повторното използване', quality.cacheHitRate ?? 'Няма данни'],
  ] : [['Статус', 'Няма публикувани данни за проверките и разходите.']]);
  if (typeof quality?.cacheHitRate === 'number') {
    checks.getCell(checks.rowCount, 2).numFmt = '0.0%';
  }

  addSheet(workbook, 'Локации за преглед', [
    ['Локация', 32], ['Статус', 24], ['Причина', 45], ['Следващо действие', 52],
    ['Кабели и край', 42], ['Конфликтни контури', 28], ['Кандидати в модела', 45],
    ['Документи', 50], ['Локация (ID)', 38],
  ], report.unresolved.map(item => [
    item.name, label(item.status), label(item.reason), item.nextAction,
    item.cables.map(cable => `${cable.tag || cable.id} (${cable.side})`).join('\n'),
    item.conflictingCableLoops?.join('\n'),
    item.candidates.map(candidate => [candidate.tag, candidate.objectIds.join(', ')].filter(Boolean).join(' · ')).join('\n'),
    formatDocuments(item.documents), item.locationId,
  ]), true);

  addSheet(workbook, 'Кабели за преглед', [
    ['Кабел', 28], ['From', 30], ['To', 30], ['Причина', 48], ['Последна задача (статус)', 26],
    ['Последна задача (съобщение)', 50], ['Последна задача (ID)', 38], ['Кабел (ID)', 38],
  ], report.routingBlocked.map(cable => [
    cable.tag || cable.id, cable.from, cable.to, label(cable.reason), cable.latestJobStatus,
    cable.latestJobMessage, cable.latestJobId, cable.id,
  ]), true);

  addSheet(workbook, 'История на присвояванията', [
    ['Локация', 30], ['Статус', 24], ['Таг на оборудването', 28], ['Доказателство', 45],
    ['Документи', 50], ['Обекти в модела (ID)', 28], ['Локация (ID)', 38], ['Присвояване (ID)', 38],
    ['Потвърждение (ID)', 38], ['Маршрутно влияние (ID)', 38], ['Състояние на изпращане', 28],
    ['Маршрутна задача (статус)', 28], ['Маршрутна задача (ID)', 38],
  ], (report.audit ?? report.assigned).map(item => [
    item.name, label(item.status), item.equipmentTag, label(item.evidence), formatDocuments(item.documents),
    item.objectIds.join(', '), item.locationId, item.bindingId, item.receiptId, item.impactId,
    item.dispatchStatus, item.jobStatus, item.jobId,
  ]), true);

  return workbook;
}

export async function downloadPilotReport(report: PilotReport, targetDocument: Document) {
  const workbook = await buildPilotReportWorkbook(report);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const anchor = targetDocument.createElement('a');
  const timestamp = new Date(report.capturedAt).toISOString().slice(0, 19).replaceAll(':', '-');
  anchor.download = `GVL244-pilot-report-${timestamp}Z.xlsx`;
  anchor.hidden = true;
  const urlApi = URL;
  const url = urlApi.createObjectURL(blob);
  anchor.href = url;
  try {
    targetDocument.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => urlApi.revokeObjectURL(url), 1000);
  }
}
