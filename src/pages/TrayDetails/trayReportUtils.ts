import JSZip from 'jszip';

import type {
  Project,
  Tray,
  Cable,
  ProjectFile,
  CableType
} from '@/api/client';
import type {
  SupportCalculationResult,
  ChartEvaluation
} from './TrayDetails.types';
import {
  PROJECT_FILE_CATEGORIES,
  PROJECT_FILE_CATEGORY_LABELS,
  getProjectFileCategory,
  type ProjectFileCategory
} from '../ProjectDetails/projectFileUtils';

export type TrayPlaceholderContext = {
  project: Project;
  trays: Tray[];
  tray: Tray;
  trayCables: Cable[];
  projectCableTypes: CableType[];
  projectCables: Cable[];
  projectFiles: ProjectFile[];
  trayTemplatePurposeCount: number;
  trayFreeSpacePercent: number | null;
  includeGroundingCable: boolean;
  groundingCableTypeName: string | null;
  supportCalculations: SupportCalculationResult;
  supportTypeDisplay: string | null;
  supportLengthMm: number | null;
  trayWeightLoadPerMeterKg: number | null;
  trayTotalOwnWeightKg: number | null;
  cablesWeightLoadPerMeterKg: number | null;
  cablesTotalWeightKg: number | null;
  totalWeightLoadPerMeterKg: number | null;
  totalWeightKg: number | null;
  projectCableSpacingMm: number;
  considerBundleSpacingAsFree: boolean;
  minFreeSpacePercent: number | null;
  maxFreeSpacePercent: number | null;
  safetyFactorPercent: number | null;
  safetyFactorStatusMessage: string | null;
  chartSpanMeters: number | null;
  safetyAdjustedLoadKnPerM: number | null;
  chartEvaluation: ChartEvaluation;
  selectedLoadCurveName: string | null;
  numberFormatter: Intl.NumberFormat;
  percentageFormatter: Intl.NumberFormat;
  dateTimeFormatter: Intl.DateTimeFormat;
  loadCurveImageFileName: string;
  bundlesImageFileName: string;
};

export const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to export canvas to image'));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });

const fallbackText = (value: string | null | undefined): string => {
  if (value === null || value === undefined) {
    return '-';
  }
  const trimmed = value.trim();
  return trimmed === '' ? '-' : trimmed;
};

const formatNumber = (
  formatter: Intl.NumberFormat,
  value: number | null | undefined
): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return formatter.format(value);
};

const formatNumberWithUnit = (
  formatter: Intl.NumberFormat,
  value: number | null | undefined,
  unit: string
): string => {
  const formatted = formatNumber(formatter, value);
  return formatted === '-' ? '-' : `${formatted} ${unit}`;
};

const formatPercent = (
  formatter: Intl.NumberFormat,
  value: number | null | undefined
): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return `${formatter.format(value)} %`;
};

const formatBoolean = (value: boolean | null | undefined): string => {
  if (value === null || value === undefined) {
    return '-';
  }
  return value ? 'Yes' : 'No';
};

const formatRowCount = (
  formatter: Intl.NumberFormat,
  count: number | null | undefined
): string => {
  if (count === null || count === undefined || Number.isNaN(count)) {
    return '0 rows';
  }
  const safe = Math.max(0, count);
  const formatted = formatter.format(safe);
  return `${formatted} ${safe === 1 ? 'row' : 'rows'}`;
};

const buildTableSummary = (
  formatter: Intl.NumberFormat,
  count: number | null | undefined,
  note?: string
): string => {
  const parts = [note ?? 'Entire table export'];
  if (count !== null && count !== undefined && Number.isFinite(count)) {
    parts.push(formatRowCount(formatter, count));
  }
  return parts.join(' — ');
};

const formatDateTime = (
  formatter: Intl.DateTimeFormat,
  value: string | null | undefined
): string => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return formatter.format(date);
};

export const buildTrayPlaceholderValues = (
  context: TrayPlaceholderContext
): Record<string, string> => {
  const {
    project,
    trays,
    tray,
    trayCables,
    projectCableTypes,
    projectCables,
    projectFiles,
    trayTemplatePurposeCount,
    trayFreeSpacePercent,
    includeGroundingCable,
    groundingCableTypeName,
    supportCalculations,
    supportTypeDisplay,
    supportLengthMm,
    trayWeightLoadPerMeterKg,
    trayTotalOwnWeightKg,
    cablesWeightLoadPerMeterKg,
    cablesTotalWeightKg,
    totalWeightLoadPerMeterKg,
    totalWeightKg,
    projectCableSpacingMm,
    considerBundleSpacingAsFree,
    minFreeSpacePercent,
    maxFreeSpacePercent,
    safetyFactorPercent,
    safetyFactorStatusMessage,
    chartSpanMeters,
    safetyAdjustedLoadKnPerM,
    chartEvaluation,
    selectedLoadCurveName,
    numberFormatter,
    percentageFormatter,
    dateTimeFormatter,
    loadCurveImageFileName,
    bundlesImageFileName
  } = context;

  const values: Record<string, string> = {};

  const addValue = (key: string, value: string | null | undefined) => {
    values[key] = value === null || value === undefined ? '-' : value;
  };

  // Detail section
  addValue('details:project-number', fallbackText(project.projectNumber));
  addValue('details:project-name', fallbackText(project.name));
  addValue('details:customer', fallbackText(project.customer));
  addValue('details:manager', fallbackText(project.manager));
  addValue('details:description', fallbackText(project.description));
  addValue(
    'details:created-at',
    formatDateTime(dateTimeFormatter, project.createdAt)
  );
  addValue(
    'details:updated-at',
    formatDateTime(dateTimeFormatter, project.updatedAt)
  );
  addValue(
    'details:secondary-tray-length',
    formatNumberWithUnit(numberFormatter, project.secondaryTrayLength, 'm')
  );
  addValue(
    'details:support-distance',
    formatNumberWithUnit(numberFormatter, project.supportDistance, 'm')
  );
  addValue(
    'details:support-weight',
    formatNumberWithUnit(numberFormatter, project.supportWeight, 'kg')
  );
  addValue(
    'details:tray-load-safety-factor',
    formatNumberWithUnit(numberFormatter, project.trayLoadSafetyFactor, '%')
  );
  addValue(
    'details:cable-spacing',
    formatNumberWithUnit(numberFormatter, projectCableSpacingMm, 'mm')
  );
  addValue(
    'details:bundle-spacing-free',
    formatBoolean(considerBundleSpacingAsFree)
  );
  addValue(
    'details:min-free-space',
    formatPercent(percentageFormatter, minFreeSpacePercent)
  );
  addValue(
    'details:max-free-space',
    formatPercent(percentageFormatter, maxFreeSpacePercent)
  );

  // Detail tables
  addValue(
    'table:details:tray-report-templates',
    buildTableSummary(
      numberFormatter,
      trayTemplatePurposeCount,
      'Tray report templates table'
    )
  );

  // Cable/cables list tables
  addValue(
    'table:cables:main',
    buildTableSummary(
      numberFormatter,
      projectCableTypes.length,
      'Cable types table'
    )
  );
  addValue(
    'table:cable-list:main',
    buildTableSummary(
      numberFormatter,
      projectCables.length,
      'Cables list table'
    )
  );
  addValue(
    'table:trays:main',
    buildTableSummary(numberFormatter, trays.length, 'Trays table')
  );

  const fileCounts: Record<ProjectFileCategory, number> = {
    word: 0,
    excel: 0,
    pdf: 0,
    images: 0
  };

  for (const file of projectFiles) {
    const category = getProjectFileCategory(file);
    if (category in fileCounts) {
      fileCounts[category as ProjectFileCategory] += 1;
    }
  }

  for (const category of PROJECT_FILE_CATEGORIES) {
    addValue(
      `table:files:category-${category}`,
      buildTableSummary(
        numberFormatter,
        fileCounts[category] ?? 0,
        `${PROJECT_FILE_CATEGORY_LABELS[category]} files table`
      )
    );
  }

  // Tray info
  addValue('tray-details:name', fallbackText(tray.name));
  addValue('tray-details:type', fallbackText(tray.type));
  addValue('tray-details:purpose', fallbackText(tray.purpose));
  addValue(
    'tray-details:width',
    formatNumberWithUnit(numberFormatter, tray.widthMm, 'mm')
  );
  addValue(
    'tray-details:height',
    formatNumberWithUnit(numberFormatter, tray.heightMm, 'mm')
  );
  addValue(
    'tray-details:length',
    formatNumberWithUnit(numberFormatter, tray.lengthMm, 'mm')
  );
  addValue(
    'tray-details:free-space',
    trayFreeSpacePercent === null
      ? 'Not calculated'
      : formatPercent(percentageFormatter, trayFreeSpacePercent)
  );
  addValue(
    'tray-details:grounding-flag',
    formatBoolean(includeGroundingCable)
  );
  addValue(
    'tray-details:grounding-type',
    includeGroundingCable ? fallbackText(groundingCableTypeName) : 'Not included'
  );
  addValue(
    'tray-details:created-at',
    formatDateTime(dateTimeFormatter, tray.createdAt)
  );
  addValue(
    'tray-details:updated-at',
    formatDateTime(dateTimeFormatter, tray.updatedAt)
  );

  // Load curve
  addValue(
    'tray-details:load-curve-name',
    fallbackText(selectedLoadCurveName)
  );
  addValue(
    'tray-details:safety-factor',
    formatNumberWithUnit(numberFormatter, safetyFactorPercent, '%')
  );
  addValue(
    'tray-details:calculated-span',
    formatNumber(numberFormatter, chartSpanMeters)
  );
  addValue(
    'tray-details:calculated-load',
    formatNumber(numberFormatter, safetyAdjustedLoadKnPerM)
  );
  const limitHighlight = chartEvaluation.limitHighlight;
  addValue(
    'tray-details:limit-highlight',
    limitHighlight && !Number.isNaN(limitHighlight.span)
      ? `${limitHighlight.label}: ${formatNumber(
          numberFormatter,
          limitHighlight.span
        )} m`
      : 'Not applicable'
  );
  addValue(
    'tray-details:allowable-load',
    formatNumber(numberFormatter, chartEvaluation.allowableLoadAtSpan)
  );
  const loadCurveStatus =
    safetyFactorStatusMessage ?? chartEvaluation.message ?? 'Status unavailable';
  addValue('tray-details:load-curve-status', loadCurveStatus);
  addValue('tray-details:load-curve-canvas', loadCurveImageFileName);

  // Weight calculations
  addValue(
    'tray-details:weight-load-per-meter',
    formatNumber(numberFormatter, trayWeightLoadPerMeterKg)
  );
  addValue(
    'tray-details:total-own-weight',
    formatNumber(numberFormatter, trayTotalOwnWeightKg)
  );
  addValue(
    'tray-details:cables-weight-load-per-meter',
    formatNumber(numberFormatter, cablesWeightLoadPerMeterKg)
  );
  addValue(
    'tray-details:cables-total-weight',
    formatNumber(numberFormatter, cablesTotalWeightKg)
  );
  addValue(
    'tray-details:total-weight-load-per-meter',
    formatNumber(numberFormatter, totalWeightLoadPerMeterKg)
  );
  addValue(
    'tray-details:total-weight',
    formatNumber(numberFormatter, totalWeightKg)
  );

  // Cables listing
  addValue(
    'tray-details:cables-table',
    `${formatRowCount(numberFormatter, trayCables.length)} on tray`
  );

  // Supports section
  addValue('tray-details:support-type', fallbackText(supportTypeDisplay));
  addValue(
    'tray-details:support-length',
    formatNumberWithUnit(numberFormatter, supportLengthMm, 'mm')
  );
  addValue(
    'tray-details:supports-count',
    formatNumber(numberFormatter, supportCalculations.supportsCount)
  );
  addValue(
    'tray-details:support-weight-per-piece',
    formatNumber(numberFormatter, supportCalculations.weightPerPieceKg)
  );
  addValue(
    'tray-details:supports-total-weight',
    formatNumber(numberFormatter, supportCalculations.totalWeightKg)
  );
  addValue(
    'tray-details:supports-weight-per-meter',
    formatNumber(numberFormatter, supportCalculations.weightPerMeterKg)
  );

  // Visualization
  addValue('tray-details:concept-canvas', bundlesImageFileName);

  return values;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&');

const encodeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const replaceXmlPlaceholders = (
  xml: string,
  replacements: Record<string, string>
): string => {
  let nextXml = xml;
  for (const [placeholder, rawValue] of Object.entries(replacements)) {
    if (!placeholder) {
      continue;
    }
    const safeValue = rawValue ?? '';
    const regex = new RegExp(escapeRegExp(placeholder), 'g');
    nextXml = nextXml.replace(regex, encodeXml(safeValue));
  }
  return nextXml;
};

export const replaceDocxPlaceholders = async (
  templateBlob: Blob,
  replacements: Record<string, string>
): Promise<Blob> => {
  const zip = await JSZip.loadAsync(templateBlob);
  const targetFiles = Object.keys(zip.files).filter(
    (fileName) => fileName.startsWith('word/') && fileName.endsWith('.xml')
  );

  await Promise.all(
    targetFiles.map(async (fileName) => {
      const file = zip.file(fileName);
      if (!file) {
        return;
      }
      const content = await file.async('string');
      const updated = replaceXmlPlaceholders(content, replacements);
      zip.file(fileName, updated);
    })
  );

  return zip.generateAsync({ type: 'blob' });
};
