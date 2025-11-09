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
import { isGroundingPurpose } from './TrayDetails.utils';
import {
  PROJECT_FILE_CATEGORIES,
  PROJECT_FILE_CATEGORY_LABELS,
  getProjectFileCategory,
  type ProjectFileCategory
} from '../ProjectDetails/projectFileUtils';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS_NS =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP_NS =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

export const MISSING_VALUE_PLACEHOLDER = '*****';

export const GROUNDING_CABLE_NOTE_TEXT =
  '\r\n \tNote: Bare grounding copper cable {cableType} is included in the calculations. The cable itself will be mounted on the outside of the board of the tray and it is not included in the free space calculations.';

const buildGroundingCableNote = (
  includeGroundingCable: boolean,
  groundingCableTypeLabel: string | null | undefined
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
    return MISSING_VALUE_PLACEHOLDER;
  }
  const trimmed = value.trim();
  return trimmed === '' ? MISSING_VALUE_PLACEHOLDER : trimmed;
};

const formatNumber = (
  formatter: Intl.NumberFormat,
  value: number | null | undefined
): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return MISSING_VALUE_PLACEHOLDER;
  }
  return formatter.format(value);
};

const formatNumberWithUnit = (
  formatter: Intl.NumberFormat,
  value: number | null | undefined,
  unit: string
): string => {
  const formatted = formatNumber(formatter, value);
  return formatted === MISSING_VALUE_PLACEHOLDER
    ? MISSING_VALUE_PLACEHOLDER
    : `${formatted} ${unit}`;
};

const formatPercent = (
  formatter: Intl.NumberFormat,
  value: number | null | undefined
): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
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
    groundingCableWeightKgPerM,
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
    currentUserDisplay
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

  const cableWeightComponents: number[] = [];
  for (const cable of trayCables) {
    if (isGroundingPurpose(cable.purpose)) {
      continue;
    }
    if (typeof cable.weightKgPerM === 'number' && !Number.isNaN(cable.weightKgPerM)) {
      cableWeightComponents.push(cable.weightKgPerM);
    }
  }
  if (
    groundingCableWeightKgPerM !== null &&
    !Number.isNaN(groundingCableWeightKgPerM)
  ) {
    cableWeightComponents.push(groundingCableWeightKgPerM);
  }

  const trayWeightLoadPerMeterFormula =
    trayWeightPerMeterKg !== null &&
    supportsWeightPerMeter !== null &&
    trayWeightLoadPerMeterKg !== null
      ? `${numberFormatter.format(trayWeightPerMeterKg)} + ${numberFormatter.format(
          supportsWeightPerMeter
        )} = ${numberFormatter.format(trayWeightLoadPerMeterKg)} [kg/m]`
      : null;

  const trayTotalOwnWeightFormula =
    trayWeightLoadPerMeterKg !== null &&
    trayLengthMeters !== null &&
    trayLengthMeters > 0 &&
    trayTotalOwnWeightKg !== null
      ? `${numberFormatter.format(trayWeightLoadPerMeterKg)} * ${numberFormatter.format(
          trayLengthMeters
        )} m = ${numberFormatter.format(trayTotalOwnWeightKg)} [kg]`
      : null;

  const cablesWeightPerMeterFormula =
    cablesWeightLoadPerMeterKg !== null && cableWeightComponents.length > 0
      ? `${cableWeightComponents
          .map((value) => numberFormatter.format(value))
          .join(' + ')} = ${numberFormatter.format(
          cablesWeightLoadPerMeterKg
        )} [kg/m]`
      : null;

  const cablesTotalWeightFormula =
    cablesWeightLoadPerMeterKg !== null &&
    trayLengthMeters !== null &&
    trayLengthMeters > 0 &&
    cablesTotalWeightKg !== null
      ? `${numberFormatter.format(cablesWeightLoadPerMeterKg)} * ${numberFormatter.format(
          trayLengthMeters
        )} m = ${numberFormatter.format(cablesTotalWeightKg)} [kg]`
      : null;

  const totalWeightLoadPerMeterFormula =
    trayWeightLoadPerMeterKg !== null &&
    cablesWeightLoadPerMeterKg !== null &&
    totalWeightLoadPerMeterKg !== null
      ? `${numberFormatter.format(trayWeightLoadPerMeterKg)} + ${numberFormatter.format(
          cablesWeightLoadPerMeterKg
        )} = ${numberFormatter.format(totalWeightLoadPerMeterKg)} [kg/m]`
      : null;

  const totalWeightFormula =
    trayTotalOwnWeightKg !== null &&
    cablesTotalWeightKg !== null &&
    totalWeightKg !== null
      ? `${numberFormatter.format(trayTotalOwnWeightKg)} + ${numberFormatter.format(
          cablesTotalWeightKg
        )} = ${numberFormatter.format(totalWeightKg)} [kg]`
      : null;

  const supportsTotalWeightFormula =
    supportsCount !== null &&
    supportsWeightPerPiece !== null &&
    supportsTotalWeight !== null
      ? `${numberFormatter.format(supportsCount)} * ${numberFormatter.format(
          supportsWeightPerPiece
        )} = ${numberFormatter.format(supportsTotalWeight)} [kg]`
      : null;

  const supportsWeightPerMeterFormula =
    supportsTotalWeight !== null &&
    trayLengthMeters !== null &&
    trayLengthMeters > 0 &&
    supportsWeightPerMeter !== null
      ? `${numberFormatter.format(supportsTotalWeight)} / ${numberFormatter.format(
          trayLengthMeters
        )} m = ${numberFormatter.format(supportsWeightPerMeter)} [kg/m]`
      : null;

  const supportsCountFormula =
    trayLengthMeters !== null &&
    trayLengthMeters > 0 &&
    supportDistanceMeters !== null &&
    supportDistanceMeters > 0 &&
    supportsCount !== null
      ? `${numberFormatter.format(trayLengthMeters)} / ${numberFormatter.format(
          supportDistanceMeters
        )} ≈ ${numberFormatter.format(
          trayLengthMeters / supportDistanceMeters
        )} = ${numberFormatter.format(supportsCount)}`
      : null;

  // Detail section
  addValue('details:project-number', fallbackText(project.projectNumber));
  addValue('details:project-name', fallbackText(project.name));
  addValue('details:customer', fallbackText(project.customer));
  addValue('details:manager', fallbackText(project.manager));
  addValue('details:description', fallbackText(project.description));
  addValue('details:current-user', fallbackText(currentUserDisplay));
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
    formatNumberWithUnit(numberFormatter, trayWidthSourceMm, 'mm')
  );
  addValue(
    'tray-details:height',
    formatNumberWithUnit(numberFormatter, trayHeightSourceMm, 'mm')
  );
  addValue(
    'tray-details:length',
    formatNumberWithUnit(numberFormatter, tray.lengthMm, 'mm')
  );
  addValue(
    'tray-details:free-space',
    trayFreeSpacePercent === null
      ? MISSING_VALUE_PLACEHOLDER
      : formatPercent(percentageFormatter, trayFreeSpacePercent)
  );
  addValue(
    'tray-details:grounding-flag',
    formatBoolean(includeGroundingCable)
  );
  const groundingCableTypeDisplay = includeGroundingCable
    ? fallbackText(groundingCableTypeName)
    : 'Not included';

  addValue('tray-details:grounding-type', groundingCableTypeDisplay);
  values['tray-details:grounding-note'] = buildGroundingCableNote(
    includeGroundingCable,
    includeGroundingCable ? groundingCableTypeDisplay : null
  );
  addValue(
    'tray-details:rung-height',
    formatNumberWithUnit(numberFormatter, trayRungHeightMm, 'mm')
  );
  addValue(
    'tray-details:useful-height',
    formatNumberWithUnit(numberFormatter, usefulTrayHeightMm, 'mm')
  );
  addValue(
    'tray-details:material-weight-per-meter',
    formatNumberWithUnit(numberFormatter, trayMaterialWeightPerMeterKg, 'kg/m')
  );
  addValue(
    'tray-details:tray-type-image',
    trayTypeImageAvailable
      ? materialTrayMetadata?.imageTemplateFileName ?? 'Tray type illustration'
      : MISSING_VALUE_PLACEHOLDER
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
    trayWeightLoadPerMeterFormula ??
      formatNumber(numberFormatter, trayWeightLoadPerMeterKg)
  );
  addValue(
    'tray-details:total-own-weight',
    trayTotalOwnWeightFormula ??
      formatNumber(numberFormatter, trayTotalOwnWeightKg)
  );
  addValue(
    'tray-details:cables-weight-load-per-meter',
    cablesWeightPerMeterFormula ??
      formatNumber(numberFormatter, cablesWeightLoadPerMeterKg)
  );
  addValue(
    'tray-details:cables-total-weight',
    cablesTotalWeightFormula ??
      formatNumber(numberFormatter, cablesTotalWeightKg)
  );
  addValue(
    'tray-details:total-weight-load-per-meter',
    totalWeightLoadPerMeterFormula ??
      formatNumber(numberFormatter, totalWeightLoadPerMeterKg)
  );
  addValue(
    'tray-details:total-weight',
    totalWeightFormula ?? formatNumber(numberFormatter, totalWeightKg)
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
    supportsCountFormula ?? formatNumber(numberFormatter, supportsCount)
  );
  addValue(
    'tray-details:support-weight-per-piece',
    formatNumber(numberFormatter, supportCalculations.weightPerPieceKg)
  );
  addValue(
    'tray-details:supports-total-weight',
    supportsTotalWeightFormula ??
      formatNumber(numberFormatter, supportCalculations.totalWeightKg)
  );
  addValue(
    'tray-details:supports-weight-per-meter',
    supportsWeightPerMeterFormula ??
      formatNumber(numberFormatter, supportCalculations.weightPerMeterKg)
  );

  // Visualization
  addValue('tray-details:concept-canvas', bundlesImageFileName);

  tablesById['tray-details:cables-table'] = buildTrayCablesTable(
    trayCables,
    numberFormatter
  );

  imagesById['tray-details:load-curve-canvas'] = 'loadCurve';
  imagesById['tray-details:concept-canvas'] = 'bundles';
  if (trayTypeImageAvailable) {
    imagesById['tray-details:tray-type-image'] = 'trayTemplate';
  }

  return {
    values,
    tables: tablesById,
    images: imagesById
  };
};

const buildTrayCablesTable = (
  cables: Cable[],
  numberFormatter: Intl.NumberFormat
): WordTableDefinition => {
  const headers = [
    'No.',
    'Cable name',
    'Cable type',
    'Cable diameter [mm]',
    'Cable weight [kg/m]'
  ];

  if (cables.length === 0) {
    return {
      headers,
      rows: [['-', 'No cables on this tray', '-', '-', '-']]
    };
  }

  const rows = cables.map((cable, index) => {
    const diameter =
      cable.diameterMm === null || Number.isNaN(cable.diameterMm)
        ? '-'
        : numberFormatter.format(cable.diameterMm);

    const weight =
      cable.weightKgPerM === null || Number.isNaN(cable.weightKgPerM)
        ? '-'
        : numberFormatter.format(cable.weightKgPerM);

    const name = cable.tag?.trim() || cable.cableId || 'Unnamed cable';

    return [
      numberFormatter.format(index + 1),
      name,
      cable.typeName ?? 'N/A',
      diameter,
      weight
    ];
  });

  return {
    headers,
    rows
  };
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
  replacements: Record<string, string>,
  options?: {
    tables?: Record<string, WordTableDefinition>;
    images?: Record<string, DocxImageDefinition>;
  }
): Promise<Blob> => {
  const zip = await JSZip.loadAsync(templateBlob);

  const specialPlaceholders = new Set([
    ...(options?.tables ? Object.keys(options.tables) : []),
    ...(options?.images ? Object.keys(options.images) : [])
  ]);

  const textOnlyReplacements = Object.fromEntries(
    Object.entries(replacements).filter(
      ([placeholder]) => !specialPlaceholders.has(placeholder)
    )
  );

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
      const updated = replaceXmlPlaceholders(content, textOnlyReplacements);
      zip.file(fileName, updated);
    })
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
        modified =
          injectTablesIntoDocument(xmlDoc, options.tables) || modified;
      }

      if (options?.images) {
        modified =
          injectImagesIntoDocument(xmlDoc, options.images, imageRelIds) ||
          modified;
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
  images: Record<string, DocxImageDefinition>
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
  const relationships = Array.from(
    relsDoc.getElementsByTagName('Relationship')
  );

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
      sanitizeMediaFileName(imageDef.fileName) ||
      `generated-${Date.now()}-${mediaIndex}`;
    const mediaFileName = `${safeName}.${extension}`;
    const mediaPath = `word/media/${mediaFileName}`;

    zip.file(mediaPath, imageDef.data);

    const relationshipElement = relsDoc.createElementNS(
      RELS_NS,
      'Relationship'
    );
    const nextRelId = `rId${++maxRelId}`;
    relationshipElement.setAttribute('Id', nextRelId);
    relationshipElement.setAttribute(
      'Type',
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
    );
    relationshipElement.setAttribute('Target', `media/${mediaFileName}`);
    relsDoc.documentElement?.appendChild(relationshipElement);
    relationshipMap[placeholder] = nextRelId;
    mediaIndex += 1;
  }

  zip.file(relsPath, serializer.serializeToString(relsDoc));
  return relationshipMap;
};

const injectTablesIntoDocument = (
  xmlDoc: Document,
  tables: Record<string, WordTableDefinition>
): boolean => {
  let modified = false;
  for (const [placeholder, definition] of Object.entries(tables)) {
    const replaced = replaceParagraphWithNode(xmlDoc, placeholder, () =>
      createTableNode(xmlDoc, definition)
    );
    modified = replaced || modified;
  }
  return modified;
};

const injectImagesIntoDocument = (
  xmlDoc: Document,
  images: Record<string, DocxImageDefinition>,
  relationshipIds: Record<string, string>
): boolean => {
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
        imageDef.description ?? 'Inserted image'
      )
    );
    modified = replaced || modified;
  }
  return modified;
};

const replaceParagraphWithNode = (
  xmlDoc: Document,
  placeholder: string,
  nodeFactory: () => Node
): boolean => {
  const textNodes = Array.from(
    xmlDoc.getElementsByTagNameNS(WORD_NS, 't')
  );
  let replaced = false;

  for (const textNode of textNodes) {
    if (textNode.textContent?.trim() === placeholder) {
      const paragraph = findAncestorParagraph(textNode);
      if (paragraph && paragraph.parentNode) {
        const replacementNode = nodeFactory();
        paragraph.parentNode.replaceChild(replacementNode, paragraph);
        replaced = true;
      }
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

const createTableNode = (
  xmlDoc: Document,
  definition: WordTableDefinition
): Element => {
  const table = xmlDoc.createElementNS(WORD_NS, 'w:tbl');
  const tblPr = xmlDoc.createElementNS(WORD_NS, 'w:tblPr');
  const tblBorders = xmlDoc.createElementNS(WORD_NS, 'w:tblBorders');

  const borders: Array<{ tag: string; size: string }> = [
    { tag: 'w:top', size: '8' },
    { tag: 'w:left', size: '8' },
    { tag: 'w:bottom', size: '8' },
    { tag: 'w:right', size: '8' },
    { tag: 'w:insideH', size: '4' },
    { tag: 'w:insideV', size: '4' }
  ];

  for (const border of borders) {
    const borderElement = xmlDoc.createElementNS(WORD_NS, border.tag);
    borderElement.setAttributeNS(WORD_NS, 'w:val', 'single');
    borderElement.setAttributeNS(WORD_NS, 'w:sz', border.size);
    borderElement.setAttributeNS(WORD_NS, 'w:color', 'auto');
    tblBorders.appendChild(borderElement);
  }

  tblPr.appendChild(tblBorders);
  table.appendChild(tblPr);

  if (definition.headers?.length) {
    const headerRow = createTableRow(xmlDoc, definition.headers, true);
    table.appendChild(headerRow);
  }

  for (const row of definition.rows) {
    const dataRow = createTableRow(xmlDoc, row, false);
    table.appendChild(dataRow);
  }

  return table;
};

const createTableRow = (
  xmlDoc: Document,
  cells: string[],
  bold: boolean
): Element => {
  const rowElement = xmlDoc.createElementNS(WORD_NS, 'w:tr');
  cells.forEach((cellText) => {
    rowElement.appendChild(createTableCell(xmlDoc, cellText, bold));
  });
  return rowElement;
};

const createTableCell = (
  xmlDoc: Document,
  text: string,
  bold: boolean
): Element => {
  const cell = xmlDoc.createElementNS(WORD_NS, 'w:tc');
  const paragraph = xmlDoc.createElementNS(WORD_NS, 'w:p');
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
  description: string
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

  const cNvGraphicFramePr = xmlDoc.createElementNS(
    WP_NS,
    'wp:cNvGraphicFramePr'
  );
  const graphicLocks = xmlDoc.createElementNS(
    DRAWING_NS,
    'a:graphicFrameLocks'
  );
  graphicLocks.setAttribute('noChangeAspect', '1');
  cNvGraphicFramePr.appendChild(graphicLocks);
  inline.appendChild(cNvGraphicFramePr);

  const graphic = xmlDoc.createElementNS(DRAWING_NS, 'a:graphic');
  const graphicData = xmlDoc.createElementNS(DRAWING_NS, 'a:graphicData');
  graphicData.setAttribute(
    'uri',
    'http://schemas.openxmlformats.org/drawingml/2006/picture'
  );

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
