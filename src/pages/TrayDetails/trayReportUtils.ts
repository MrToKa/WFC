import JSZip from 'jszip';

import type { Project, Tray, Cable, ProjectFile, CableType } from '@/api/client';
import type { SupportCalculationResult, ChartEvaluation } from './TrayDetails.types';
import { isGroundingPurpose, KN_PER_KG } from './TrayDetails.utils';
import { calculateTraySpanLoad, getLoadCapacityMetrics } from './loadAssessment';
import {
  PROJECT_FILE_CATEGORIES,
  PROJECT_FILE_CATEGORY_LABELS,
  getProjectFileCategory,
  type ProjectFileCategory,
} from '../ProjectDetails/projectFileUtils';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

export const MISSING_VALUE_PLACEHOLDER = '*****';

export const GROUNDING_CABLE_NOTE_TEXT =
  'Bare grounding copper cable {cableType} is included in the weight and load calculations. It is mounted outside the tray side rail and excluded from free width calculations.';

const buildGroundingCableNote = (
  includeGroundingCable: boolean,
  groundingCableTypeLabel: string | null | undefined,
): string => {
  if (!includeGroundingCable) {
    return '';
  }

  const trimmedLabel = groundingCableTypeLabel?.trim();
  const resolvedLabel =
    trimmedLabel && trimmedLabel !== '' ? trimmedLabel : MISSING_VALUE_PLACEHOLDER;

  return GROUNDING_CABLE_NOTE_TEXT.replace('{cableType}', resolvedLabel);
};

export type WordTableDefinition = {
  columnWidthsTwips?: number[];
  headers: string[];
  rows: string[][];
};

export type PlaceholderImageSource = 'loadCurve' | 'bundles' | 'trayTemplate';

export type TrayPlaceholderValueBundle = {
  values: Record<string, string>;
  tables: Record<string, WordTableDefinition>;
  images: Record<string, PlaceholderImageSource>;
};

export type DocxImageDefinition = {
  data: Uint8Array;
  widthEmu: number;
  heightEmu: number;
  fileName: string;
  contentType: string;
  description?: string;
};

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
  trayOccupiedWidthMm: number | null;
  occupiedWidthFormula?: string | null;
  includeGroundingCable: boolean;
  groundingCableTypeName: string | null;
  supportCalculations: SupportCalculationResult;
  supportTypeDisplay: string | null;
  supportLengthMm: number | null;
  trayWeightLoadPerMeterKg: number | null;
  trayWeightPerMeterKg: number | null;
  trayTotalOwnWeightKg: number | null;
  cablesWeightLoadPerMeterKg: number | null;
  cablesTotalWeightKg: number | null;
  totalWeightLoadPerMeterKg: number | null;
  totalWeightKg: number | null;
  groundingCableWeightKgPerM: number | null;
  trefoilClampsWeightKgPerM?: number | null;
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
  materialTrayMetadata: {
    manufacturer: string | null;
    heightMm: number | null;
    widthMm: number | null;
    weightKgPerM: number | null;
    rungHeightMm: number | null;
    imageTemplateId: string | null;
    imageTemplateFileName: string | null;
    imageTemplateContentType: string | null;
  } | null;
  currentUserDisplay: string;
};

export const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
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
      quality,
    );
  });

const fallbackText = (value: string | null | undefined): string => {
  if (value === null || value === undefined) {
    return MISSING_VALUE_PLACEHOLDER;
  }
  const trimmed = value.trim();
  return trimmed === '' ? MISSING_VALUE_PLACEHOLDER : trimmed;
};

const formatNumber = (formatter: Intl.NumberFormat, value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return MISSING_VALUE_PLACEHOLDER;
  }
  return formatter.format(value);
};

const formatNumberWithUnit = (
  formatter: Intl.NumberFormat,
  value: number | null | undefined,
  unit: string,
): string => {
  const formatted = formatNumber(formatter, value);
  return formatted === MISSING_VALUE_PLACEHOLDER
    ? MISSING_VALUE_PLACEHOLDER
    : `${formatted} ${unit}`;
};

const formatPercent = (formatter: Intl.NumberFormat, value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return MISSING_VALUE_PLACEHOLDER;
  }
  return `${formatter.format(value)} %`;
};

const formatBoolean = (value: boolean | null | undefined): string => {
  if (value === null || value === undefined) {
    return MISSING_VALUE_PLACEHOLDER;
  }
  return value ? 'Yes' : 'No';
};

const formatRowCount = (formatter: Intl.NumberFormat, count: number | null | undefined): string => {
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
  note?: string,
): string => {
  const parts = [note ?? 'Entire table export'];
  if (count !== null && count !== undefined && Number.isFinite(count)) {
    parts.push(formatRowCount(formatter, count));
  }
  return parts.join(' — ');
};

const formatDateTime = (
  formatter: Intl.DateTimeFormat,
  value: string | null | undefined,
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
  context: TrayPlaceholderContext,
): TrayPlaceholderValueBundle => {
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
    trayOccupiedWidthMm,
    occupiedWidthFormula,
    includeGroundingCable,
    groundingCableTypeName,
    supportCalculations,
    supportTypeDisplay,
    supportLengthMm,
    trayWeightLoadPerMeterKg,
    trayWeightPerMeterKg,
    trayTotalOwnWeightKg,
    cablesWeightLoadPerMeterKg,
    cablesTotalWeightKg,
    totalWeightLoadPerMeterKg,
    totalWeightKg,
    trefoilClampsWeightKgPerM = 0,
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
    bundlesImageFileName,
    materialTrayMetadata,
    currentUserDisplay,
  } = context;

  const values: Record<string, string> = {};
  const tablesById: Record<string, WordTableDefinition> = {};
  const imagesById: Record<string, PlaceholderImageSource> = {};
  const trayHeightSourceMm = tray.heightMm ?? materialTrayMetadata?.heightMm ?? null;
  const trayWidthSourceMm = tray.widthMm ?? materialTrayMetadata?.widthMm ?? null;
  const trayMaterialWeightPerMeterKg = materialTrayMetadata?.weightKgPerM ?? null;
  const trayRungHeightMm = materialTrayMetadata?.rungHeightMm ?? null;
  const trayTypeImageAvailable = Boolean(materialTrayMetadata?.imageTemplateId);

  // Calculate useful tray height (tray height - rung height)
  const usefulTrayHeightMm =
    trayHeightSourceMm !== null && trayRungHeightMm !== null
      ? trayHeightSourceMm - trayRungHeightMm
      : null;

  const usefulTrayHeightFormula =
    trayHeightSourceMm !== null && trayRungHeightMm !== null && usefulTrayHeightMm !== null
      ? `${numberFormatter.format(trayHeightSourceMm)} - ${numberFormatter.format(
          trayRungHeightMm,
        )} = ${numberFormatter.format(usefulTrayHeightMm)} mm`
      : null;

  const trayFreeSpaceFormula =
    trayWidthSourceMm !== null &&
    !Number.isNaN(trayWidthSourceMm) &&
    trayOccupiedWidthMm !== null &&
    !Number.isNaN(trayOccupiedWidthMm) &&
    trayFreeSpacePercent !== null &&
    !Number.isNaN(trayFreeSpacePercent)
      ? `${trayOccupiedWidthMm > trayWidthSourceMm ? 'max(0, ' : ''}((${numberFormatter.format(trayWidthSourceMm)} - ${numberFormatter.format(
          trayOccupiedWidthMm,
        )}) / ${numberFormatter.format(trayWidthSourceMm)}) * 100${trayOccupiedWidthMm > trayWidthSourceMm ? ')' : ''} = ${percentageFormatter.format(
          trayFreeSpacePercent,
        )} %`
      : null;

  const addValue = (key: string, value: string | null | undefined) => {
    if (value === null || value === undefined) {
      values[key] = MISSING_VALUE_PLACEHOLDER;
      return;
    }
    const normalized = value.trim();
    values[key] = normalized === '' ? MISSING_VALUE_PLACEHOLDER : normalized;
  };

  const trayLengthMeters = supportCalculations.lengthMeters;
  const supportsTotalWeight = supportCalculations.totalWeightKg;
  const supportsWeightPerMeter = supportCalculations.weightPerMeterKg;
  const supportsCount = supportCalculations.supportsCount;
  const supportsWeightPerPiece = supportCalculations.weightPerPieceKg;
  const supportDistanceMeters = supportCalculations.distanceMeters;

  const trayWeightLoadPerMeterFormula =
    trayWeightPerMeterKg !== null &&
    supportsWeightPerMeter !== null &&
    trayWeightLoadPerMeterKg !== null
      ? `${numberFormatter.format(trayWeightPerMeterKg)} + ${numberFormatter.format(
          supportsWeightPerMeter,
        )} = ${numberFormatter.format(trayWeightLoadPerMeterKg)} kg/m`
      : null;

  const trayTotalOwnWeightFormula =
    trayWeightLoadPerMeterKg !== null &&
    trayLengthMeters !== null &&
    trayLengthMeters > 0 &&
    trayTotalOwnWeightKg !== null
      ? `${numberFormatter.format(trayWeightLoadPerMeterKg)} * ${numberFormatter.format(
          trayLengthMeters,
        )} = ${numberFormatter.format(trayTotalOwnWeightKg)} kg`
      : null;

  const hasKnownTrefoilClampWeight =
    typeof trefoilClampsWeightKgPerM === 'number' &&
    Number.isFinite(trefoilClampsWeightKgPerM) &&
    trefoilClampsWeightKgPerM >= 0;
  const cablesWeightPerMeterFormula =
    cablesWeightLoadPerMeterKg !== null && hasKnownTrefoilClampWeight
      ? `Sum of ${trayCables.filter((cable) => !isGroundingPurpose(cable.purpose)).length} routed cable weights${includeGroundingCable ? ' plus grounding cable' : ''}${trefoilClampsWeightKgPerM! > 0 ? ' plus trefoil clamps' : ''} = ${numberFormatter.format(cablesWeightLoadPerMeterKg)} kg/m`
      : null;

  const cablesTotalWeightFormula =
    cablesWeightLoadPerMeterKg !== null &&
    trayLengthMeters !== null &&
    trayLengthMeters > 0 &&
    cablesTotalWeightKg !== null
      ? `${numberFormatter.format(cablesWeightLoadPerMeterKg)} * ${numberFormatter.format(
          trayLengthMeters,
        )} = ${numberFormatter.format(cablesTotalWeightKg)} kg`
      : null;

  const totalWeightLoadPerMeterFormula =
    trayWeightLoadPerMeterKg !== null &&
    cablesWeightLoadPerMeterKg !== null &&
    totalWeightLoadPerMeterKg !== null
      ? `${numberFormatter.format(trayWeightLoadPerMeterKg)} + ${numberFormatter.format(
          cablesWeightLoadPerMeterKg,
        )} = ${numberFormatter.format(totalWeightLoadPerMeterKg)} kg/m`
      : null;

  const totalWeightFormula =
    trayTotalOwnWeightKg !== null && cablesTotalWeightKg !== null && totalWeightKg !== null
      ? `${numberFormatter.format(trayTotalOwnWeightKg)} + ${numberFormatter.format(
          cablesTotalWeightKg,
        )} = ${numberFormatter.format(totalWeightKg)} kg`
      : null;

  const supportsTotalWeightFormula =
    supportsCount !== null && supportsWeightPerPiece !== null && supportsTotalWeight !== null
      ? `${numberFormatter.format(supportsCount)} * ${numberFormatter.format(
          supportsWeightPerPiece,
        )} = ${numberFormatter.format(supportsTotalWeight)} kg`
      : null;

  const supportsWeightPerMeterFormula =
    supportsTotalWeight !== null &&
    trayLengthMeters !== null &&
    trayLengthMeters > 0 &&
    supportsWeightPerMeter !== null
      ? `${numberFormatter.format(supportsTotalWeight)} / ${numberFormatter.format(
          trayLengthMeters,
        )} = ${numberFormatter.format(supportsWeightPerMeter)} kg/m`
      : null;

  const baseSegments =
    trayLengthMeters !== null && supportDistanceMeters !== null && supportDistanceMeters > 0
      ? Math.floor(trayLengthMeters / supportDistanceMeters)
      : null;
  const supportRemainder =
    baseSegments !== null && trayLengthMeters !== null && supportDistanceMeters !== null
      ? trayLengthMeters - baseSegments * supportDistanceMeters
      : null;
  const supportsCountFormula =
    baseSegments !== null &&
    supportRemainder !== null &&
    supportDistanceMeters !== null &&
    supportsCount !== null
      ? `floor(${numberFormatter.format(trayLengthMeters!)} / ${numberFormatter.format(supportDistanceMeters)}) = ${baseSegments}; remainder = ${numberFormatter.format(supportRemainder)} m; N = max(2, ${baseSegments} + 1)${baseSegments >= 1 && supportRemainder > supportDistanceMeters * 0.2 ? ' + 1' : ''} = ${supportsCount}`
      : null;

  // Detail section
  addValue('details:project-number', fallbackText(project.projectNumber));
  addValue('details:project-name', fallbackText(project.name));
  addValue('details:customer', fallbackText(project.customer));
  addValue('details:manager', fallbackText(project.manager));
  addValue('details:description', fallbackText(project.description));
  addValue('details:current-user', fallbackText(currentUserDisplay));
  addValue('details:created-at', formatDateTime(dateTimeFormatter, project.createdAt));
  addValue('details:updated-at', formatDateTime(dateTimeFormatter, project.updatedAt));
  addValue(
    'details:secondary-tray-length',
    formatNumberWithUnit(numberFormatter, project.secondaryTrayLength, 'm'),
  );
  addValue(
    'details:support-distance',
    formatNumberWithUnit(numberFormatter, project.supportDistance, 'm'),
  );
  addValue(
    'details:support-weight',
    formatNumberWithUnit(numberFormatter, project.supportWeight, 'kg'),
  );
  addValue(
    'details:tray-load-safety-factor',
    formatNumberWithUnit(numberFormatter, project.trayLoadSafetyFactor, '%'),
  );
  addValue(
    'details:cable-spacing',
    formatNumberWithUnit(numberFormatter, projectCableSpacingMm, 'mm'),
  );
  addValue('details:bundle-spacing-free', formatBoolean(considerBundleSpacingAsFree));
  addValue('details:min-free-space', formatPercent(percentageFormatter, minFreeSpacePercent));
  addValue('details:max-free-space', formatPercent(percentageFormatter, maxFreeSpacePercent));

  // Detail tables
  addValue(
    'table:details:tray-report-templates',
    buildTableSummary(numberFormatter, trayTemplatePurposeCount, 'Tray report templates table'),
  );

  // Cable/cables list tables
  addValue(
    'table:cables:main',
    buildTableSummary(numberFormatter, projectCableTypes.length, 'Cable types table'),
  );
  addValue(
    'table:cable-list:main',
    buildTableSummary(numberFormatter, projectCables.length, 'Cables list table'),
  );
  addValue('table:trays:main', buildTableSummary(numberFormatter, trays.length, 'Trays table'));

  const fileCounts: Record<ProjectFileCategory, number> = {
    word: 0,
    excel: 0,
    pdf: 0,
    images: 0,
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
        `${PROJECT_FILE_CATEGORY_LABELS[category]} files table`,
      ),
    );
  }

  // Tray info
  addValue('tray-details:name', fallbackText(tray.name));
  addValue('tray-details:type', fallbackText(tray.type));
  addValue('tray-details:manufacturer', fallbackText(materialTrayMetadata?.manufacturer));
  addValue('tray-details:purpose', fallbackText(tray.purpose));
  addValue('tray-details:width', formatNumberWithUnit(numberFormatter, trayWidthSourceMm, 'mm'));
  addValue('tray-details:height', formatNumberWithUnit(numberFormatter, trayHeightSourceMm, 'mm'));
  addValue('tray-details:length', formatNumberWithUnit(numberFormatter, tray.lengthMm, 'mm'));
  addValue(
    'tray-details:occupied-space',
    formatNumberWithUnit(numberFormatter, trayOccupiedWidthMm, 'mm'),
  );
  addValue(
    'tray-details:free-space',
    trayFreeSpaceFormula ??
      (trayFreeSpacePercent === null
        ? MISSING_VALUE_PLACEHOLDER
        : formatPercent(percentageFormatter, trayFreeSpacePercent)),
  );
  addValue('tray-details:grounding-flag', formatBoolean(includeGroundingCable));
  const groundingCableTypeDisplay = includeGroundingCable
    ? fallbackText(groundingCableTypeName)
    : 'Not included';

  addValue('tray-details:grounding-type', groundingCableTypeDisplay);
  values['tray-details:grounding-note'] = buildGroundingCableNote(
    includeGroundingCable,
    includeGroundingCable ? groundingCableTypeDisplay : null,
  );
  addValue(
    'tray-details:rung-height',
    formatNumberWithUnit(numberFormatter, trayRungHeightMm, 'mm'),
  );
  addValue(
    'tray-details:useful-height',
    usefulTrayHeightFormula ?? formatNumberWithUnit(numberFormatter, usefulTrayHeightMm, 'mm'),
  );
  addValue(
    'tray-details:material-weight-per-meter',
    formatNumberWithUnit(numberFormatter, trayMaterialWeightPerMeterKg, 'kg/m'),
  );
  addValue(
    'tray-details:tray-type-image',
    trayTypeImageAvailable
      ? (materialTrayMetadata?.imageTemplateFileName ?? 'Tray type illustration')
      : MISSING_VALUE_PLACEHOLDER,
  );
  addValue('tray-details:created-at', formatDateTime(dateTimeFormatter, tray.createdAt));
  addValue('tray-details:updated-at', formatDateTime(dateTimeFormatter, tray.updatedAt));

  // Load curve
  addValue('tray-details:load-curve-name', fallbackText(selectedLoadCurveName));
  addValue(
    'tray-details:safety-factor',
    formatNumberWithUnit(numberFormatter, safetyFactorPercent, '%'),
  );
  addValue('tray-details:calculated-span', formatNumber(numberFormatter, chartSpanMeters));
  addValue('tray-details:calculated-load', formatNumber(numberFormatter, safetyAdjustedLoadKnPerM));
  const limitHighlight = chartEvaluation.limitHighlight;
  addValue(
    'tray-details:limit-highlight',
    limitHighlight && !Number.isNaN(limitHighlight.span)
      ? `${limitHighlight.label}: ${formatNumber(numberFormatter, limitHighlight.span)} m`
      : 'Not applicable',
  );
  addValue(
    'tray-details:allowable-load',
    formatNumber(numberFormatter, chartEvaluation.allowableLoadAtSpan),
  );
  const loadCurveStatus =
    safetyFactorStatusMessage ?? chartEvaluation.message ?? 'Status unavailable';
  addValue('tray-details:load-curve-status', loadCurveStatus);
  addValue('tray-details:load-curve-canvas', loadCurveImageFileName);

  // Load verification uses the same evaluation as the Tray details chart.
  const spanLoad = calculateTraySpanLoad(trayWeightPerMeterKg, cablesWeightLoadPerMeterKg);
  const spanMass = spanLoad === null ? null : spanLoad / KN_PER_KG;
  const metrics = getLoadCapacityMetrics(chartEvaluation, safetyAdjustedLoadKnPerM);
  const calcFormatter = new Intl.NumberFormat(numberFormatter.resolvedOptions().locale, {
    maximumFractionDigits: 6,
  });
  const f = (value: number) => calcFormatter.format(value);
  const factor =
    safetyFactorPercent !== null && Number.isFinite(safetyFactorPercent) && safetyFactorPercent >= 0
      ? 1 + safetyFactorPercent / 100
      : null;
  addValue('tray-details:reported-at', dateTimeFormatter.format(new Date()));
  addValue(
    'tray-details:tray-weight-per-meter',
    formatNumberWithUnit(numberFormatter, trayWeightPerMeterKg, 'kg/m'),
  );
  addValue('tray-details:span-mass', formatNumberWithUnit(numberFormatter, spanMass, 'kg/m'));
  addValue(
    'tray-details:span-load-formula',
    spanLoad !== null && trayWeightPerMeterKg !== null && cablesWeightLoadPerMeterKg !== null
      ? `(${f(cablesWeightLoadPerMeterKg)} + ${f(trayWeightPerMeterKg)}) x 9.80665 / 1000 = ${f(spanLoad)} kN/m`
      : null,
  );
  addValue(
    'tray-details:design-load-formula',
    spanLoad !== null && factor !== null && safetyAdjustedLoadKnPerM !== null
      ? `${f(spanLoad)} x (1 + ${f(safetyFactorPercent!)} / 100) = ${f(safetyAdjustedLoadKnPerM)} kN/m`
      : null,
  );
  const interpolation = chartEvaluation.interpolation;
  addValue(
    'tray-details:allowable-load-formula',
    interpolation && chartSpanMeters !== null && chartEvaluation.allowableLoadAtSpan !== null
      ? interpolation.from.spanM === interpolation.to.spanM
        ? `Published curve point at ${f(interpolation.from.spanM)} m: ${f(chartEvaluation.allowableLoadAtSpan)} kN/m`
        : `${f(interpolation.from.loadKnPerM)} + ((${f(chartSpanMeters)} - ${f(interpolation.from.spanM)}) / (${f(interpolation.to.spanM)} - ${f(interpolation.from.spanM)})) x (${f(interpolation.to.loadKnPerM)} - ${f(interpolation.from.loadKnPerM)}) = ${f(chartEvaluation.allowableLoadAtSpan)} kN/m`
      : 'Not available within the documented curve range',
  );
  addValue(
    'tray-details:load-utilization',
    formatPercent(percentageFormatter, metrics.utilizationPercent),
  );
  addValue(
    'tray-details:load-reserve',
    formatNumberWithUnit(calcFormatter, metrics.reserveKnPerM, 'kN/m'),
  );
  addValue(
    'tray-details:load-reserve-percent',
    formatPercent(percentageFormatter, metrics.reservePercent),
  );
  addValue(
    'tray-details:load-utilization-formula',
    metrics.utilizationPercent !== null
      ? `${f(safetyAdjustedLoadKnPerM!)} / ${f(chartEvaluation.allowableLoadAtSpan!)} x 100 = ${f(metrics.utilizationPercent)} %`
      : null,
  );
  addValue(
    'tray-details:load-reserve-formula',
    metrics.reserveKnPerM !== null
      ? `${f(chartEvaluation.allowableLoadAtSpan!)} - ${f(safetyAdjustedLoadKnPerM!)} = ${f(metrics.reserveKnPerM)} kN/m`
      : null,
  );
  addValue(
    'tray-details:max-allowable-span',
    formatNumberWithUnit(calcFormatter, chartEvaluation.maxAllowableSpan, 'm'),
  );
  addValue(
    'tray-details:load-range',
    chartEvaluation.minSpan !== null && chartEvaluation.maxSpan !== null
      ? `${f(chartEvaluation.minSpan)} to ${f(chartEvaluation.maxSpan)} m`
      : null,
  );
  const verified = chartEvaluation.status === 'ok';
  const exceeded =
    chartEvaluation.allowableLoadAtSpan !== null &&
    ['too-long', 'load-too-high'].includes(chartEvaluation.status);
  addValue(
    'tray-details:load-verification',
    verified
      ? 'PASS - Design load is within the allowable load at the selected support spacing.'
      : exceeded
        ? 'FAIL - Design load exceeds the allowable load at the selected support spacing.'
        : `NOT VERIFIED - ${loadCurveStatus}`,
  );
  addValue(
    'tray-details:free-space-percent',
    formatPercent(percentageFormatter, trayFreeSpacePercent),
  );
  const validFree =
    trayFreeSpacePercent !== null &&
    Number.isFinite(trayFreeSpacePercent) &&
    trayWidthSourceMm !== null &&
    trayWidthSourceMm > 0;
  const freeStatus = !validFree
    ? 'NOT VERIFIED - Complete tray width and cable layout data are required.'
    : trayFreeSpacePercent! < 0 ||
        (trayOccupiedWidthMm !== null &&
          trayWidthSourceMm !== null &&
          trayOccupiedWidthMm > trayWidthSourceMm)
      ? 'FAIL - Cable layout exceeds the tray width.'
      : minFreeSpacePercent !== null && trayFreeSpacePercent! < minFreeSpacePercent
        ? 'FAIL - Free width is below the project minimum.'
        : maxFreeSpacePercent !== null && trayFreeSpacePercent! > maxFreeSpacePercent
          ? 'OUTSIDE TARGET - Free width exceeds the project maximum.'
          : minFreeSpacePercent === null && maxFreeSpacePercent === null
            ? 'Free width calculated; project limits are not configured.'
            : 'PASS - Free width is within the configured project limits.';
  addValue('tray-details:free-space-verification', freeStatus);

  const cableUnitWeights = [...trayCables]
    .filter((cable) => !isGroundingPurpose(cable.purpose))
    .sort((a, b) => a.cableId - b.cableId)
    .map((cable) => cable.weightKgPerM);
  if (includeGroundingCable) cableUnitWeights.push(context.groundingCableWeightKgPerM);
  if (trefoilClampsWeightKgPerM !== 0) cableUnitWeights.push(trefoilClampsWeightKgPerM);
  const cableWeightSum =
    cablesWeightLoadPerMeterKg !== null &&
    cableUnitWeights.every(
      (weight) => typeof weight === 'number' && Number.isFinite(weight) && weight >= 0,
    )
      ? `${cableUnitWeights.length ? cableUnitWeights.map((weight) => numberFormatter.format(weight!)).join(' + ') : '0'} = ${numberFormatter.format(cablesWeightLoadPerMeterKg)} kg/m`
      : null;
  addValue('tray-details:cables-weight-sum-formula', cableWeightSum);
  addValue(
    'tray-details:occupied-width-formula',
    occupiedWidthFormula ?? formatNumberWithUnit(numberFormatter, trayOccupiedWidthMm, 'mm'),
  );

  // Weight calculations
  addValue(
    'tray-details:weight-load-per-meter',
    trayWeightLoadPerMeterFormula ?? formatNumber(numberFormatter, trayWeightLoadPerMeterKg),
  );
  addValue(
    'tray-details:total-own-weight',
    trayTotalOwnWeightFormula ?? formatNumber(numberFormatter, trayTotalOwnWeightKg),
  );
  addValue(
    'tray-details:cables-weight-load-per-meter',
    cablesWeightPerMeterFormula ??
      formatNumber(numberFormatter, hasKnownTrefoilClampWeight ? cablesWeightLoadPerMeterKg : null),
  );
  addValue(
    'tray-details:cables-total-weight',
    cablesTotalWeightFormula ?? formatNumber(numberFormatter, cablesTotalWeightKg),
  );
  addValue(
    'tray-details:total-weight-load-per-meter',
    totalWeightLoadPerMeterFormula ?? formatNumber(numberFormatter, totalWeightLoadPerMeterKg),
  );
  addValue(
    'tray-details:total-weight',
    totalWeightFormula ?? formatNumber(numberFormatter, totalWeightKg),
  );

  // Cables listing
  addValue(
    'tray-details:cables-table',
    `${formatRowCount(numberFormatter, trayCables.length)} on tray`,
  );

  // Supports section
  addValue('tray-details:support-type', fallbackText(supportTypeDisplay));
  addValue(
    'tray-details:support-length',
    formatNumberWithUnit(numberFormatter, supportLengthMm, 'mm'),
  );
  addValue(
    'tray-details:support-distance',
    formatNumberWithUnit(numberFormatter, supportDistanceMeters, 'm'),
  );
  addValue(
    'tray-details:supports-count',
    supportsCountFormula ?? formatNumber(numberFormatter, supportsCount),
  );
  addValue(
    'tray-details:support-weight-per-piece',
    formatNumber(numberFormatter, supportCalculations.weightPerPieceKg),
  );
  addValue(
    'tray-details:supports-total-weight',
    supportsTotalWeightFormula ?? formatNumber(numberFormatter, supportCalculations.totalWeightKg),
  );
  addValue(
    'tray-details:supports-weight-per-meter',
    supportsWeightPerMeterFormula ??
      formatNumber(numberFormatter, supportCalculations.weightPerMeterKg),
  );

  // Visualization
  addValue('tray-details:concept-canvas', bundlesImageFileName);

  tablesById['tray-details:cables-table'] = buildTrayCablesTable(trayCables, numberFormatter);

  imagesById['tray-details:load-curve-canvas'] = 'loadCurve';
  imagesById['tray-details:concept-canvas'] = 'bundles';
  if (trayTypeImageAvailable) {
    imagesById['tray-details:tray-type-image'] = 'trayTemplate';
  }

  return {
    values,
    tables: tablesById,
    images: imagesById,
  };
};

const buildTrayCablesTable = (
  cables: Cable[],
  numberFormatter: Intl.NumberFormat,
): WordTableDefinition => {
  const headers = ['No.', 'Cable name', 'Cable type', 'Cable diameter mm', 'Cable weight kg/m'];

  if (cables.length === 0) {
    return {
      headers,
      rows: [['-', 'No cables on this tray', '-', '-', '-']],
    };
  }

  const sortedCables = [...cables].sort((a, b) => a.cableId - b.cableId);

  const rows = sortedCables.map((cable, index) => {
    const diameter =
      cable.diameterMm === null || Number.isNaN(cable.diameterMm)
        ? '-'
        : numberFormatter.format(cable.diameterMm);

    const weight =
      cable.weightKgPerM === null || Number.isNaN(cable.weightKgPerM)
        ? '-'
        : numberFormatter.format(cable.weightKgPerM);

    const name = cable.tag?.trim() || String(cable.cableId) || 'Unnamed cable';

    return [numberFormatter.format(index + 1), name, cable.typeName ?? 'N/A', diameter, weight];
  });

  return {
    headers,
    rows,
    columnWidthsTwips: [500, 3400, 3100, 1450, 1300],
  };
};

const escapeRegExp = (value: string): string => value.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&');

const replaceXmlPlaceholders = (xml: string, replacements: Record<string, string>): string => {
  const entries = Object.entries(replacements).filter(([token]) => token.length > 0);
  if (entries.length === 0) return xml;
  const expression = new RegExp(
    entries
      .map(([token]) => token)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|'),
    'g',
  );
  const xmlDoc = new DOMParser().parseFromString(xml, 'application/xml');
  if (xmlDoc.getElementsByTagName('parsererror').length)
    throw new Error('Invalid Word XML in report template.');
  for (const paragraph of Array.from(xmlDoc.getElementsByTagNameNS(WORD_NS, 'p'))) {
    const nodes = Array.from(paragraph.getElementsByTagNameNS(WORD_NS, 't')).filter(
      (node) => findAncestorParagraph(node) === paragraph,
    );
    const original = nodes.map((node) => node.textContent ?? '');
    const combined = original.join('');
    const matches = [...combined.matchAll(expression)];
    // Right-to-left edits retain the original character offsets and run formatting.
    for (const match of matches.reverse()) {
      const start = match.index!;
      const end = start + match[0].length;
      let offset = 0;
      let inserted = false;
      nodes.forEach((node, index) => {
        const nodeStart = offset;
        offset += original[index].length;
        if (offset <= start || nodeStart >= end) return;
        const text = node.textContent ?? '';
        const localStart = Math.max(0, start - nodeStart);
        const localEnd = Math.min(original[index].length, end - nodeStart);
        node.textContent =
          text.slice(0, localStart) +
          (inserted ? '' : (replacements[match[0]] ?? '')) +
          text.slice(localEnd);
        node.setAttribute('xml:space', 'preserve');
        inserted = true;
      });
    }
  }
  return new XMLSerializer().serializeToString(xmlDoc);
};

export const replaceDocxPlaceholders = async (
  templateBlob: Blob,
  replacements: Record<string, string>,
  options?: {
    tables?: Record<string, WordTableDefinition>;
    images?: Record<string, DocxImageDefinition>;
  },
): Promise<Blob> => {
  const zip = await JSZip.loadAsync(templateBlob);

  const specialPlaceholders = new Set([
    ...(options?.tables ? Object.keys(options.tables) : []),
    ...(options?.images ? Object.keys(options.images) : []),
  ]);

  const textOnlyReplacements = Object.fromEntries(
    Object.entries(replacements).filter(([placeholder]) => !specialPlaceholders.has(placeholder)),
  );

  const targetFiles = Object.keys(zip.files).filter(
    (fileName) => fileName.startsWith('word/') && fileName.endsWith('.xml'),
  );

  await Promise.all(
    targetFiles.map(async (fileName) => {
      const file = zip.file(fileName);
      if (!file) {
        return;
      }
      const content = await file.async('string');
      const updated = replaceXmlPlaceholders(content, textOnlyReplacements);
      zip.file(fileName, updated);
    }),
  );

  let imageRelIds: Record<string, string> = {};
  if (options?.images && Object.keys(options.images).length > 0) {
    imageRelIds = await embedImages(zip, options.images);
  }

  const requiresDocumentUpdate =
    (options?.tables && Object.keys(options.tables).length > 0) ||
    (options?.images && Object.keys(options.images).length > 0);

  if (requiresDocumentUpdate) {
    const documentFile = zip.file('word/document.xml');
    if (documentFile) {
      const parser = new DOMParser();
      const serializer = new XMLSerializer();
      const xmlContent = await documentFile.async('string');
      const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');
      let modified = false;

      if (options?.tables) {
        modified = injectTablesIntoDocument(xmlDoc, options.tables) || modified;
      }

      if (options?.images) {
        let nextDrawingId = 1;
        for (const partName of targetFiles) {
          const part = await zip.file(partName)?.async('string');
          if (!part) continue;
          const partDoc = parser.parseFromString(part, 'application/xml');
          for (const properties of Array.from(partDoc.getElementsByTagNameNS(WP_NS, 'docPr'))) {
            nextDrawingId = Math.max(
              nextDrawingId,
              (Number(properties.getAttribute('id')) || 0) + 1,
            );
          }
        }
        modified =
          injectImagesIntoDocument(xmlDoc, options.images, imageRelIds, nextDrawingId) || modified;
      }

      if (modified) {
        zip.file('word/document.xml', serializer.serializeToString(xmlDoc));
      }
    }
  }

  return zip.generateAsync({ type: 'blob' });
};

const embedImages = async (
  zip: JSZip,
  images: Record<string, DocxImageDefinition>,
): Promise<Record<string, string>> => {
  const relsPath = 'word/_rels/document.xml.rels';
  const relsFile = zip.file(relsPath);
  if (!relsFile) {
    throw new Error('Document relationships part not found in template.');
  }

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const relsXml = await relsFile.async('string');
  const relsDoc = parser.parseFromString(relsXml, 'application/xml');
  const relationships = Array.from(relsDoc.getElementsByTagName('Relationship'));

  let maxRelId = relationships.reduce((max, rel) => {
    const currentId = rel.getAttribute('Id') ?? '';
    const numeric = parseInt(currentId.replace('rId', ''), 10);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  const relationshipMap: Record<string, string> = {};
  let mediaIndex = 0;

  for (const [placeholder, imageDef] of Object.entries(images)) {
    const extension = imageDef.contentType.includes('png') ? 'png' : 'jpeg';
    const safeName =
      sanitizeMediaFileName(imageDef.fileName) || `generated-${Date.now()}-${mediaIndex}`;
    const mediaFileName = `${safeName}.${extension}`;
    const mediaPath = `word/media/${mediaFileName}`;

    zip.file(mediaPath, imageDef.data);

    const relationshipElement = relsDoc.createElementNS(RELS_NS, 'Relationship');
    const nextRelId = `rId${++maxRelId}`;
    relationshipElement.setAttribute('Id', nextRelId);
    relationshipElement.setAttribute(
      'Type',
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
    );
    relationshipElement.setAttribute('Target', `media/${mediaFileName}`);
    relsDoc.documentElement?.appendChild(relationshipElement);
    relationshipMap[placeholder] = nextRelId;
    mediaIndex += 1;
  }

  zip.file(relsPath, serializer.serializeToString(relsDoc));
  const contentTypesPath = '[Content_Types].xml';
  const contentTypesXml = await zip.file(contentTypesPath)?.async('string');
  if (!contentTypesXml) throw new Error('Document content types part not found.');
  const typesDoc = parser.parseFromString(contentTypesXml, 'application/xml');
  const typesNs = 'http://schemas.openxmlformats.org/package/2006/content-types';
  for (const image of Object.values(images)) {
    const extension = image.contentType.includes('png') ? 'png' : 'jpeg';
    const existing = Array.from(typesDoc.getElementsByTagNameNS(typesNs, 'Default'));
    if (!existing.some((node) => node.getAttribute('Extension') === extension)) {
      const type = typesDoc.createElementNS(typesNs, 'Default');
      type.setAttribute('Extension', extension);
      type.setAttribute('ContentType', extension === 'png' ? 'image/png' : 'image/jpeg');
      typesDoc.documentElement.appendChild(type);
    }
  }
  zip.file(contentTypesPath, serializer.serializeToString(typesDoc));
  return relationshipMap;
};

const injectTablesIntoDocument = (
  xmlDoc: Document,
  tables: Record<string, WordTableDefinition>,
): boolean => {
  let modified = false;
  for (const [placeholder, definition] of Object.entries(tables)) {
    const replaced = replaceParagraphWithNode(xmlDoc, placeholder, () =>
      createTableNode(xmlDoc, definition),
    );
    modified = replaced || modified;
  }
  return modified;
};

const injectImagesIntoDocument = (
  xmlDoc: Document,
  images: Record<string, DocxImageDefinition>,
  relationshipIds: Record<string, string>,
  nextDrawingId: number,
): boolean => {
  drawingCounter = nextDrawingId;
  let modified = false;
  for (const [placeholder, imageDef] of Object.entries(images)) {
    const relId = relationshipIds[placeholder];
    if (!relId) {
      continue;
    }
    const replaced = replaceParagraphWithNode(xmlDoc, placeholder, () =>
      createImageParagraph(
        xmlDoc,
        relId,
        imageDef.widthEmu,
        imageDef.heightEmu,
        imageDef.description ?? 'Inserted image',
      ),
    );
    modified = replaced || modified;
  }
  return modified;
};

const replaceParagraphWithNode = (
  xmlDoc: Document,
  placeholder: string,
  nodeFactory: () => Node,
): boolean => {
  const paragraphs = Array.from(xmlDoc.getElementsByTagNameNS(WORD_NS, 'p'));
  let replaced = false;
  for (const paragraph of paragraphs) {
    const text = Array.from(paragraph.getElementsByTagNameNS(WORD_NS, 't'))
      .map((node) => node.textContent ?? '')
      .join('');
    if (text.trim() === placeholder && paragraph.parentNode) {
      paragraph.parentNode.replaceChild(nodeFactory(), paragraph);
      replaced = true;
    }
  }

  return replaced;
};

const findAncestorParagraph = (node: Node | null): Element | null => {
  let current: Node | null = node;
  while (current) {
    if (
      current.nodeType === Node.ELEMENT_NODE &&
      (current as Element).localName === 'p' &&
      (current as Element).namespaceURI === WORD_NS
    ) {
      return current as Element;
    }
    current = current.parentNode;
  }
  return null;
};

const createTableNode = (xmlDoc: Document, definition: WordTableDefinition): Element => {
  const table = xmlDoc.createElementNS(WORD_NS, 'w:tbl');
  const tblPr = xmlDoc.createElementNS(WORD_NS, 'w:tblPr');
  const style = xmlDoc.createElementNS(WORD_NS, 'w:tblStyle');
  style.setAttributeNS(WORD_NS, 'w:val', 'ReportTable');
  tblPr.appendChild(style);
  const width = xmlDoc.createElementNS(WORD_NS, 'w:tblW');
  width.setAttributeNS(WORD_NS, 'w:w', '5000');
  width.setAttributeNS(WORD_NS, 'w:type', 'pct');
  tblPr.appendChild(width);
  const margins = xmlDoc.createElementNS(WORD_NS, 'w:tblCellMar');
  for (const side of ['top', 'bottom', 'left', 'right']) {
    const margin = xmlDoc.createElementNS(WORD_NS, `w:${side}`);
    margin.setAttributeNS(WORD_NS, 'w:w', '90');
    margin.setAttributeNS(WORD_NS, 'w:type', 'dxa');
    margins.appendChild(margin);
  }
  tblPr.appendChild(margins);
  const tblBorders = xmlDoc.createElementNS(WORD_NS, 'w:tblBorders');

  const borders: Array<{ tag: string; size: string }> = [
    { tag: 'w:top', size: '8' },
    { tag: 'w:left', size: '8' },
    { tag: 'w:bottom', size: '8' },
    { tag: 'w:right', size: '8' },
    { tag: 'w:insideH', size: '4' },
    { tag: 'w:insideV', size: '4' },
  ];

  for (const border of borders) {
    const borderElement = xmlDoc.createElementNS(WORD_NS, border.tag);
    borderElement.setAttributeNS(
      WORD_NS,
      'w:val',
      ['w:left', 'w:right', 'w:insideV'].includes(border.tag) ? 'nil' : 'single',
    );
    borderElement.setAttributeNS(WORD_NS, 'w:sz', border.size);
    borderElement.setAttributeNS(WORD_NS, 'w:color', 'DCE3EA');
    tblBorders.appendChild(borderElement);
  }

  tblPr.appendChild(tblBorders);
  table.appendChild(tblPr);
  if (definition.columnWidthsTwips) {
    const grid = xmlDoc.createElementNS(WORD_NS, 'w:tblGrid');
    for (const width of definition.columnWidthsTwips) {
      const col = xmlDoc.createElementNS(WORD_NS, 'w:gridCol');
      col.setAttributeNS(WORD_NS, 'w:w', String(width));
      grid.appendChild(col);
    }
    table.appendChild(grid);
  }

  if (definition.headers?.length) {
    const headerRow = createTableRow(
      xmlDoc,
      definition.headers,
      true,
      definition.columnWidthsTwips,
    );
    table.appendChild(headerRow);
  }

  for (const row of definition.rows) {
    const dataRow = createTableRow(xmlDoc, row, false, definition.columnWidthsTwips);
    table.appendChild(dataRow);
  }

  return table;
};

const createTableRow = (
  xmlDoc: Document,
  cells: string[],
  bold: boolean,
  widths?: number[],
): Element => {
  const rowElement = xmlDoc.createElementNS(WORD_NS, 'w:tr');
  const properties = xmlDoc.createElementNS(WORD_NS, 'w:trPr');
  properties.appendChild(xmlDoc.createElementNS(WORD_NS, 'w:cantSplit'));
  if (bold) properties.appendChild(xmlDoc.createElementNS(WORD_NS, 'w:tblHeader'));
  rowElement.appendChild(properties);
  cells.forEach((cellText, index) => {
    rowElement.appendChild(createTableCell(xmlDoc, cellText, bold, widths?.[index]));
  });
  return rowElement;
};

const createTableCell = (
  xmlDoc: Document,
  text: string,
  bold: boolean,
  width?: number,
): Element => {
  const cell = xmlDoc.createElementNS(WORD_NS, 'w:tc');
  const cellProperties = xmlDoc.createElementNS(WORD_NS, 'w:tcPr');
  if (width !== undefined) {
    const cellWidth = xmlDoc.createElementNS(WORD_NS, 'w:tcW');
    cellWidth.setAttributeNS(WORD_NS, 'w:w', String(width));
    cellWidth.setAttributeNS(WORD_NS, 'w:type', 'dxa');
    cellProperties.appendChild(cellWidth);
  }
  const alignment = xmlDoc.createElementNS(WORD_NS, 'w:vAlign');
  alignment.setAttributeNS(WORD_NS, 'w:val', 'center');
  cellProperties.appendChild(alignment);
  if (bold) {
    const shade = xmlDoc.createElementNS(WORD_NS, 'w:shd');
    shade.setAttributeNS(WORD_NS, 'w:fill', 'E9EFF5');
    cellProperties.appendChild(shade);
  }
  cell.appendChild(cellProperties);
  const paragraph = xmlDoc.createElementNS(WORD_NS, 'w:p');
  const pPr = xmlDoc.createElementNS(WORD_NS, 'w:pPr');
  const spacing = xmlDoc.createElementNS(WORD_NS, 'w:spacing');
  spacing.setAttributeNS(WORD_NS, 'w:after', '0');
  pPr.appendChild(spacing);
  paragraph.appendChild(pPr);
  const run = xmlDoc.createElementNS(WORD_NS, 'w:r');

  if (bold) {
    const runProperties = xmlDoc.createElementNS(WORD_NS, 'w:rPr');
    const boldElement = xmlDoc.createElementNS(WORD_NS, 'w:b');
    runProperties.appendChild(boldElement);
    run.appendChild(runProperties);
  }

  const textElement = xmlDoc.createElementNS(WORD_NS, 'w:t');
  textElement.setAttribute('xml:space', 'preserve');
  textElement.textContent = text;

  run.appendChild(textElement);
  paragraph.appendChild(run);
  cell.appendChild(paragraph);
  return cell;
};

let drawingCounter = 1;

const createImageParagraph = (
  xmlDoc: Document,
  relationshipId: string,
  widthEmu: number,
  heightEmu: number,
  description: string,
): Element => {
  const paragraph = xmlDoc.createElementNS(WORD_NS, 'w:p');
  const paragraphProps = xmlDoc.createElementNS(WORD_NS, 'w:pPr');
  const justification = xmlDoc.createElementNS(WORD_NS, 'w:jc');
  justification.setAttributeNS(WORD_NS, 'w:val', 'center');
  paragraphProps.appendChild(justification);
  paragraph.appendChild(paragraphProps);

  const run = xmlDoc.createElementNS(WORD_NS, 'w:r');
  const drawing = xmlDoc.createElementNS(WORD_NS, 'w:drawing');
  const inline = xmlDoc.createElementNS(WP_NS, 'wp:inline');

  inline.setAttribute('distT', '0');
  inline.setAttribute('distB', '0');
  inline.setAttribute('distL', '0');
  inline.setAttribute('distR', '0');

  const extent = xmlDoc.createElementNS(WP_NS, 'wp:extent');
  extent.setAttribute('cx', String(widthEmu));
  extent.setAttribute('cy', String(heightEmu));
  inline.appendChild(extent);

  const effectExtent = xmlDoc.createElementNS(WP_NS, 'wp:effectExtent');
  effectExtent.setAttribute('l', '0');
  effectExtent.setAttribute('t', '0');
  effectExtent.setAttribute('r', '0');
  effectExtent.setAttribute('b', '0');
  inline.appendChild(effectExtent);

  const docPr = xmlDoc.createElementNS(WP_NS, 'wp:docPr');
  docPr.setAttribute('id', String(drawingCounter++));
  docPr.setAttribute('name', description);
  inline.appendChild(docPr);

  const cNvGraphicFramePr = xmlDoc.createElementNS(WP_NS, 'wp:cNvGraphicFramePr');
  const graphicLocks = xmlDoc.createElementNS(DRAWING_NS, 'a:graphicFrameLocks');
  graphicLocks.setAttribute('noChangeAspect', '1');
  cNvGraphicFramePr.appendChild(graphicLocks);
  inline.appendChild(cNvGraphicFramePr);

  const graphic = xmlDoc.createElementNS(DRAWING_NS, 'a:graphic');
  const graphicData = xmlDoc.createElementNS(DRAWING_NS, 'a:graphicData');
  graphicData.setAttribute('uri', 'http://schemas.openxmlformats.org/drawingml/2006/picture');

  const picture = xmlDoc.createElementNS(PIC_NS, 'pic:pic');

  const nvPicPr = xmlDoc.createElementNS(PIC_NS, 'pic:nvPicPr');
  const cNvPr = xmlDoc.createElementNS(PIC_NS, 'pic:cNvPr');
  cNvPr.setAttribute('id', '0');
  cNvPr.setAttribute('name', description);
  const cNvPicPr = xmlDoc.createElementNS(PIC_NS, 'pic:cNvPicPr');
  const picLocks = xmlDoc.createElementNS(DRAWING_NS, 'a:picLocks');
  picLocks.setAttribute('noChangeAspect', '1');
  cNvPicPr.appendChild(picLocks);
  nvPicPr.appendChild(cNvPr);
  nvPicPr.appendChild(cNvPicPr);
  picture.appendChild(nvPicPr);

  const blipFill = xmlDoc.createElementNS(PIC_NS, 'pic:blipFill');
  const blip = xmlDoc.createElementNS(DRAWING_NS, 'a:blip');
  blip.setAttributeNS(REL_NS, 'r:embed', relationshipId);
  blipFill.appendChild(blip);
  const stretch = xmlDoc.createElementNS(DRAWING_NS, 'a:stretch');
  stretch.appendChild(xmlDoc.createElementNS(DRAWING_NS, 'a:fillRect'));
  blipFill.appendChild(stretch);
  picture.appendChild(blipFill);

  const spPr = xmlDoc.createElementNS(PIC_NS, 'pic:spPr');
  const transform = xmlDoc.createElementNS(DRAWING_NS, 'a:xfrm');
  const offset = xmlDoc.createElementNS(DRAWING_NS, 'a:off');
  offset.setAttribute('x', '0');
  offset.setAttribute('y', '0');
  const extents = xmlDoc.createElementNS(DRAWING_NS, 'a:ext');
  extents.setAttribute('cx', String(widthEmu));
  extents.setAttribute('cy', String(heightEmu));
  transform.appendChild(offset);
  transform.appendChild(extents);
  spPr.appendChild(transform);
  const geometry = xmlDoc.createElementNS(DRAWING_NS, 'a:prstGeom');
  geometry.setAttribute('prst', 'rect');
  geometry.appendChild(xmlDoc.createElementNS(DRAWING_NS, 'a:avLst'));
  spPr.appendChild(geometry);
  picture.appendChild(spPr);

  graphicData.appendChild(picture);
  graphic.appendChild(graphicData);
  inline.appendChild(graphic);
  drawing.appendChild(inline);
  run.appendChild(drawing);
  paragraph.appendChild(run);
  return paragraph;
};

const sanitizeMediaFileName = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
