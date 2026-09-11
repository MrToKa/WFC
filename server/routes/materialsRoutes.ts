import type { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { uploadExcelFile } from '../utils/excelUpload.js';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { pool } from '../db.js';
import {
  mapMaterialTrayRow,
  type MaterialTrayRow
} from '../models/materialTray.js';
import {
  mapMaterialSupportRow,
  type MaterialSupportRow
} from '../models/materialSupport.js';
import {
  mapMaterialLoadCurveRow,
  mapMaterialLoadCurvePointRow,
  mapMaterialLoadCurveSummary,
  type MaterialLoadCurvePointRow,
  type MaterialLoadCurveRow,
  type PublicMaterialLoadCurve,
  type PublicMaterialLoadCurveSummary
} from '../models/materialLoadCurve.js';
import { authenticate, requireAdmin } from '../middleware.js';
import { listStandardMaterialAssignments } from '../services/standardMaterialService.js';
import {
  excelImportError,
  getExcelRowNumber,
  readExcelImportRows,
  validateExcelImport,
  type ExcelImportColumn,
  type ExcelImportIssue
} from '../utils/excelImport.js';
import {
  createMaterialLoadCurveSchema,
  createMaterialSupportSchema,
  createMaterialTraySchema,
  updateMaterialLoadCurveSchema,
  updateMaterialSupportSchema,
  updateMaterialTraySchema
} from '../validators.js';
import { registerStandardMaterialMutationRoutes } from './standardMaterialRoutes.js';


const TRAY_HEADERS = {
  manufacturer: 'Manufacturer',
  type: 'Type',
  height: 'Height [mm]',
  rungHeight: 'Rung height [mm]',
  width: 'Width [mm]',
  weight: 'Weight [kg/m]',
  loadCurve: 'Load curve',
  unitPrice: 'Price',
  minimumOrder: 'Minimum order quantity',
  orderMeasurement: 'Order measurement',
  packaging: 'Packaging'
} as const;

const SUPPORT_HEADERS = {
  manufacturer: 'Manufacturer',
  type: 'Type',
  height: 'Height [mm]',
  width: 'Width [mm]',
  length: 'Length [mm]',
  weight: 'Weight [kg]',
  unitPrice: 'Price',
  minimumOrder: 'Minimum order quantity',
  orderMeasurement: 'Order measurement',
  packaging: 'Packaging'
} as const;

const LOAD_CURVE_HEADERS = {
  span: 'L [m]',
  load: 'q(L) [kN/m]'
} as const;

const LOAD_CURVE_SHEET_NAME = 'CurveData';
const MAX_LOAD_CURVE_POINTS = 2000;

const materialImportColumns = (
  headers: typeof TRAY_HEADERS | typeof SUPPORT_HEADERS
): ExcelImportColumn[] => [
  { headers: [headers.type], required: true, maxLength: 200, unique: true, normalizeWhitespace: true },
  { headers: [headers.manufacturer], maxLength: 200 },
  ...('loadCurve' in headers ? [{ headers: [headers.loadCurve], maxLength: 200 }] : []),
  ...[
    headers.height,
    headers.width,
    'rungHeight' in headers ? headers.rungHeight : headers.length,
    headers.weight
  ].map((header): ExcelImportColumn => ({
    headers: [header], type: 'number', min: 0, max: 1_000_000
  })),
  { headers: [headers.unitPrice], type: 'number', min: 0 },
  {
    headers: [headers.minimumOrder], type: 'number', min: 0,
    exclusiveMin: true, max: 1_000_000
  },
  { headers: [headers.orderMeasurement], values: ['pcs', 'pack', 'meters'], caseInsensitive: true },
  { headers: [headers.packaging], values: ['m', 'Package', 'Box', 'Drum', 'pcs'] }
];

const readImportWorkbook = (buffer: Buffer, res: Response): XLSX.WorkBook | null => {
  try {
    return XLSX.read(buffer, { type: 'buffer' });
  } catch {
    res.status(400).json(excelImportError([{
      row: 1,
      column: 'File',
      message: 'Could not read the Excel workbook. Upload a valid .xlsx file.'
    }]));
    return null;
  }
};

type Queryable = {
  query: <T = unknown>(
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: T[] }>;
};

const sanitizeFileSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'materials';

const toNullableNumber = (value: unknown): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const normalized = trimmed.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const toMinimumOrderQuantity = (value: unknown): number => {
  const parsed = toNullableNumber(value);
  return parsed !== null && parsed > 0 ? parsed : 1;
};

const toUnitPrice = (value: unknown): number | undefined => {
  const parsed = toNullableNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : undefined;
};

const toOrderMeasurement = (
  value: unknown,
  fallback: 'pcs' | 'pack' | 'meters' = 'pcs'
): 'pcs' | 'pack' | 'meters' => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'pcs' || normalized === 'pack' || normalized === 'meters'
    ? normalized
    : fallback;
};

const toPackaging = (
  value: unknown,
  fallback: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs' = 'pcs'
): 'm' | 'Package' | 'Box' | 'Drum' | 'pcs' => {
  const normalized = String(value ?? '').trim();
  return normalized === 'm' ||
    normalized === 'Package' ||
    normalized === 'Box' ||
    normalized === 'Drum' ||
    normalized === 'pcs'
    ? normalized
    : fallback;
};

const normalizeType = (value: string): string => value.trim().replace(/\s+/g, ' ');

const normalizeOptionalText = (value?: string | null): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const normalizeOptionalUuid = (value?: string | null): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const normalizeLookupKey = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

const IMAGE_TEMPLATE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

const isImageTemplateFile = (
  fileName: string | null,
  contentType: string | null
): boolean => {
  if (contentType && contentType.toLowerCase().startsWith('image/')) {
    return true;
  }

  if (!fileName) {
    return false;
  }

  const extension = path.extname(fileName).toLowerCase();
  return IMAGE_TEMPLATE_EXTENSIONS.has(extension);
};

const ensureTemplateIsImage = async (templateId: string): Promise<void> => {
  const result = await pool.query<{
    file_name: string | null;
    content_type: string | null;
  }>(
    `
      SELECT file_name, content_type
      FROM template_files
      WHERE id = $1
      LIMIT 1;
    `,
    [templateId]
  );

  const template = result.rows[0];

  if (!template) {
    const error = new Error('Template not found');
    (error as { code?: string }).code = 'TEMPLATE_NOT_FOUND';
    throw error;
  }

  if (!isImageTemplateFile(template.file_name, template.content_type)) {
    const error = new Error('Template must be an image (.jpg, .jpeg, .png)');
    (error as { code?: string }).code = 'TEMPLATE_NOT_IMAGE';
    throw error;
  }
};

const respondToTemplateValidationError = (
  res: Response,
  error: unknown
): boolean => {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: string }).code === 'string'
  ) {
    const code = (error as { code?: string }).code;
    if (code === 'TEMPLATE_NOT_FOUND') {
      res
        .status(400)
        .json({ error: 'Selected template file could not be found. Refresh and try again.' });
      return true;
    }

    if (code === 'TEMPLATE_NOT_IMAGE') {
      res
        .status(400)
        .json({ error: 'Template file must be an image (jpg or png).' });
      return true;
    }
  }

  return false;
};

type NormalizedLoadCurvePoint = {
  spanM: number;
  loadKnPerM: number;
};

const normalizeLoadCurvePoints = (
  points?: { spanM: number; loadKnPerM: number }[]
): NormalizedLoadCurvePoint[] => {
  if (!points) {
    return [];
  }

  const normalized = points
    .map((point) => ({
      spanM: Number(point.spanM),
      loadKnPerM: Number(point.loadKnPerM)
    }))
    .filter(
      (point) =>
        Number.isFinite(point.spanM) &&
        Number.isFinite(point.loadKnPerM) &&
        point.spanM >= 0 &&
        point.loadKnPerM >= 0
    );

  normalized.sort((a, b) => a.spanM - b.spanM);
  return normalized.slice(0, MAX_LOAD_CURVE_POINTS);
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type PaginationParams = {
  page: number;
  pageSize: number;
  offset: number;
};

const parsePaginationParams = (req: Request): PaginationParams => {
  const page = Math.max(
    1,
    Number.parseInt(String(req.query.page ?? ''), 10) || 1
  );
  const rawPageSize =
    Number.parseInt(String(req.query.pageSize ?? ''), 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(Math.max(1, rawPageSize), MAX_PAGE_SIZE);

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  };
};

const buildPaginationMeta = (
  totalItems: number,
  page: number,
  pageSize: number
) => {
  const totalPages =
    totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  return {
    page,
    pageSize,
    totalItems,
    totalPages
  };
};

const selectMaterialTraysQuery = `
  SELECT
    mt.id,
    mt.tray_type,
    mt.manufacturer,
    mt.height_mm,
    mt.rung_height_mm,
    mt.width_mm,
    mt.weight_kg_per_m,
    mt.unit_price,
    mt.minimum_order_quantity,
    mt.order_measurement,
    mt.packaging,
    mt.source,
    mt.load_curve_id,
    mt.image_template_id,
    tf.file_name AS image_template_file_name,
    tf.content_type AS image_template_content_type,
    mt.created_at,
    mt.updated_at,
    lc.name AS load_curve_name
  FROM material_trays mt
  LEFT JOIN material_load_curves lc ON mt.load_curve_id = lc.id
  LEFT JOIN template_files tf ON tf.id = mt.image_template_id
`;

const selectMaterialSupportsQuery = `
  SELECT
    ms.id,
    ms.support_type,
    ms.manufacturer,
    ms.height_mm,
    ms.width_mm,
    ms.length_mm,
    ms.weight_kg,
    ms.unit_price,
    ms.minimum_order_quantity,
    ms.order_measurement,
    ms.packaging,
    ms.source,
    ms.image_template_id,
    tf.file_name AS image_template_file_name,
    tf.content_type AS image_template_content_type,
    ms.created_at,
    ms.updated_at
  FROM material_supports ms
  LEFT JOIN template_files tf ON tf.id = ms.image_template_id
`;

const selectMaterialLoadCurvesQuery = `
  SELECT
    lc.id,
    lc.name,
    lc.description,
    lc.tray_id,
    lc.created_at,
    lc.updated_at,
    mt.tray_type,
    COALESCE(stats.assigned_tray_count, 0) AS assigned_tray_count,
    stats.assigned_tray_types
  FROM material_load_curves lc
  LEFT JOIN material_trays mt ON lc.tray_id = mt.id
  LEFT JOIN (
    SELECT
      load_curve_id,
      COUNT(*)::int AS assigned_tray_count,
      ARRAY_AGG(tray_type ORDER BY tray_type) AS assigned_tray_types
    FROM material_trays
    WHERE load_curve_id IS NOT NULL
    GROUP BY load_curve_id
  ) stats ON stats.load_curve_id = lc.id
`;

const selectMaterialLoadCurvePointsQuery = `
  SELECT
    id,
    load_curve_id,
    point_order,
    span_m,
    load_kn_per_m,
    created_at,
    updated_at
  FROM material_load_curve_points
`;

const materialsRouter = Router();

const mapLoadCurvesWithPoints = async (
  db: Queryable,
  rows: MaterialLoadCurveRow[]
): Promise<PublicMaterialLoadCurve[]> => {
  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);

  const pointsResult = await db.query<MaterialLoadCurvePointRow>(
    `
      ${selectMaterialLoadCurvePointsQuery}
      WHERE load_curve_id = ANY($1::uuid[])
      ORDER BY load_curve_id ASC, point_order ASC;
    `,
    [ids]
  );

  const pointsByCurve = new Map<string, ReturnType<typeof mapMaterialLoadCurvePointRow>[]>();

  for (const pointRow of pointsResult.rows) {
    const mappedPoint = mapMaterialLoadCurvePointRow(pointRow);
    const existing = pointsByCurve.get(pointRow.load_curve_id);
    if (existing) {
      existing.push(mappedPoint);
    } else {
      pointsByCurve.set(pointRow.load_curve_id, [mappedPoint]);
    }
  }

  return rows.map((row) =>
    mapMaterialLoadCurveRow(
      row,
      (pointsByCurve.get(row.id) ?? []).sort((a, b) => a.order - b.order)
    )
  );
};

const fetchMaterialLoadCurveById = async (
  db: Queryable,
  id: string
): Promise<PublicMaterialLoadCurve | null> => {
  const result = await db.query<MaterialLoadCurveRow>(
    `
      ${selectMaterialLoadCurvesQuery}
      WHERE lc.id = $1
      LIMIT 1;
    `,
    [id]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const loadCurves = await mapLoadCurvesWithPoints(db, [row]);
  return loadCurves[0] ?? null;
};

materialsRouter.get(
  '/trays',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { page, pageSize, offset } = parsePaginationParams(req);

      const countResult = await pool.query<{ count: string }>(`
        SELECT COUNT(*)::int AS count FROM material_trays;
      `);
      const totalItems = Number(countResult.rows[0]?.count ?? 0);

      const result = await pool.query<MaterialTrayRow>(
        `
          ${selectMaterialTraysQuery}
          ORDER BY mt.tray_type ASC
          LIMIT $1 OFFSET $2;
        `,
        [pageSize, offset]
      );

      res.json({
        trays: result.rows.map(mapMaterialTrayRow),
        pagination: buildPaginationMeta(totalItems, page, pageSize)
      });
    } catch (error) {
      console.error('List material trays error', error);
      res.status(500).json({ error: 'Failed to fetch trays' });
    }
  }
);

materialsRouter.get(
  '/trays/all',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<MaterialTrayRow>(
        `
          ${selectMaterialTraysQuery}
          ORDER BY mt.tray_type ASC;
        `
      );

      res.json({ trays: result.rows.map(mapMaterialTrayRow) });
    } catch (error) {
      console.error('List all material trays error', error);
      res.status(500).json({ error: 'Failed to fetch trays' });
    }
  }
);

materialsRouter.post(
  '/trays',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parseResult = createMaterialTraySchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const data = parseResult.data;
    const type = normalizeType(data.type);
    const manufacturer = normalizeOptionalText(data.manufacturer ?? null);
    const normalizedImageTemplateId = normalizeOptionalUuid(
      data.imageTemplateId ?? null
    );

    if (normalizedImageTemplateId) {
      try {
        await ensureTemplateIsImage(normalizedImageTemplateId);
      } catch (error) {
        if (respondToTemplateValidationError(res, error)) {
          return;
        }
        console.error('Validate tray image template error', error);
        res.status(500).json({ error: 'Failed to validate template file' });
        return;
      }
    }

    const trayId = randomUUID();

    try {
      await pool.query(
        `
          INSERT INTO material_trays (
            id,
            tray_type,
            manufacturer,
            height_mm,
            rung_height_mm,
            width_mm,
            weight_kg_per_m,
            unit_price,
            minimum_order_quantity,
            order_measurement,
            packaging,
            source,
            load_curve_id,
            image_template_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, $13);
        `,
        [
          trayId,
          type,
          manufacturer,
          data.heightMm ?? null,
          data.rungHeightMm ?? null,
          data.widthMm ?? null,
          data.weightKgPerM ?? null,
          data.unitPrice ?? 0,
          data.minimumOrderQuantity ?? 1,
          data.orderMeasurement ?? 'pcs',
          data.packaging ?? 'pcs',
          normalizeOptionalText(data.source ?? null),
          normalizedImageTemplateId
        ]
      );

      const trayResult = await pool.query<MaterialTrayRow>(
        `
          ${selectMaterialTraysQuery}
          WHERE mt.id = $1
          LIMIT 1;
        `,
        [trayId]
      );

      const trayRow = trayResult.rows[0];

      if (!trayRow) {
        res.status(500).json({ error: 'Failed to create tray' });
        return;
      }

      res.status(201).json({ tray: mapMaterialTrayRow(trayRow) });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        // PostgreSQL unique violation
        (error as { code: string }).code === '23505'
      ) {
        res.status(409).json({ error: 'A tray with this type already exists' });
        return;
      }

      console.error('Create material tray error', error);
      res.status(500).json({ error: 'Failed to create tray' });
    }
  }
);

materialsRouter.patch(
  '/trays/:trayId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { trayId } = req.params;

    if (!trayId) {
      res.status(400).json({ error: 'Tray ID is required' });
      return;
    }

    const parseResult = updateMaterialTraySchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const data = parseResult.data;

  let normalizedImageTemplateId: string | null | undefined;

  if (data.imageTemplateId !== undefined) {
    normalizedImageTemplateId = normalizeOptionalUuid(data.imageTemplateId);

    if (normalizedImageTemplateId) {
      try {
        await ensureTemplateIsImage(normalizedImageTemplateId);
      } catch (error) {
        if (respondToTemplateValidationError(res, error)) {
          return;
        }
        console.error('Validate tray image template error', error);
        res.status(500).json({ error: 'Failed to validate template file' });
        return;
      }
    }
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let parameterIndex = 1;

  if (data.type !== undefined) {
      setClauses.push(`tray_type = $${parameterIndex}`);
      values.push(normalizeType(data.type));
      parameterIndex += 1;
    }

    if (data.manufacturer !== undefined) {
      setClauses.push(`manufacturer = $${parameterIndex}`);
      values.push(normalizeOptionalText(data.manufacturer));
      parameterIndex += 1;
    }

    if (data.heightMm !== undefined) {
      setClauses.push(`height_mm = $${parameterIndex}`);
      values.push(data.heightMm ?? null);
      parameterIndex += 1;
    }

    if (data.rungHeightMm !== undefined) {
      setClauses.push(`rung_height_mm = $${parameterIndex}`);
      values.push(data.rungHeightMm ?? null);
      parameterIndex += 1;
    }

    if (data.widthMm !== undefined) {
      setClauses.push(`width_mm = $${parameterIndex}`);
      values.push(data.widthMm ?? null);
      parameterIndex += 1;
    }

    if (data.weightKgPerM !== undefined) {
      setClauses.push(`weight_kg_per_m = $${parameterIndex}`);
      values.push(data.weightKgPerM ?? null);
      parameterIndex += 1;
    }

    if (data.unitPrice !== undefined) {
      setClauses.push(`unit_price = $${parameterIndex}`);
      values.push(data.unitPrice);
      parameterIndex += 1;
    }

    if (data.minimumOrderQuantity !== undefined) {
      setClauses.push(`minimum_order_quantity = $${parameterIndex}`);
      values.push(data.minimumOrderQuantity);
      parameterIndex += 1;
    }

    if (data.orderMeasurement !== undefined) {
      setClauses.push(`order_measurement = $${parameterIndex}`);
      values.push(data.orderMeasurement);
      parameterIndex += 1;
    }

    if (data.packaging !== undefined) {
      setClauses.push(`packaging = $${parameterIndex}`);
      values.push(data.packaging);
      parameterIndex += 1;
    }

    if (data.source !== undefined) {
      setClauses.push(`source = $${parameterIndex}`);
      values.push(normalizeOptionalText(data.source));
      parameterIndex += 1;
    }

    if (data.loadCurveId !== undefined) {
      setClauses.push(`load_curve_id = $${parameterIndex}`);
    values.push(normalizeOptionalUuid(data.loadCurveId));
    parameterIndex += 1;
  }

  if (normalizedImageTemplateId !== undefined) {
    setClauses.push(`image_template_id = $${parameterIndex}`);
    values.push(normalizedImageTemplateId);
    parameterIndex += 1;
  }

  setClauses.push('updated_at = NOW()');

    const idParamIndex = parameterIndex;
    values.push(trayId);

    try {
      const result = await pool.query(
        `
          UPDATE material_trays
          SET ${setClauses.join(', ')}
          WHERE id = $${idParamIndex}
        `,
        values
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Tray not found' });
        return;
      }

      const trayResult = await pool.query<MaterialTrayRow>(
        `
          ${selectMaterialTraysQuery}
          WHERE mt.id = $1
          LIMIT 1;
        `,
        [trayId]
      );

      const trayRow = trayResult.rows[0];
      if (!trayRow) {
        res.status(404).json({ error: 'Tray not found' });
        return;
      }

      res.json({ tray: mapMaterialTrayRow(trayRow) });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        res.status(409).json({ error: 'A tray with this type already exists' });
        return;
      }

      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === '23503'
      ) {
        res.status(400).json({ error: 'Referenced load curve not found' });
        return;
      }

      console.error('Update material tray error', error);
      res.status(500).json({ error: 'Failed to update tray' });
    }
  }
);

materialsRouter.delete(
  '/trays/:trayId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { trayId } = req.params;

    if (!trayId) {
      res.status(400).json({ error: 'Tray ID is required' });
      return;
    }

    try {
      const result = await pool.query(
        `
          DELETE FROM material_trays
          WHERE id = $1
          RETURNING id;
        `,
        [trayId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Tray not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete material tray error', error);
      res.status(500).json({ error: 'Failed to delete tray' });
    }
  }
);

materialsRouter.post(
  '/trays/import',
  authenticate,
  requireAdmin,
  uploadExcelFile,
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    try {
      const workbook = readImportWorkbook(file.buffer, res);
      if (!workbook) return;
      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        res.status(400).json({ error: 'Uploaded workbook does not contain sheets' });
        return;
      }

      const sheet = workbook.Sheets[sheetName];
      const issues = validateExcelImport(sheet, materialImportColumns(TRAY_HEADERS));
      if (issues.length > 0) {
        res.status(400).json(excelImportError(issues));
        return;
      }
      const rows = readExcelImportRows(sheet, [
        TRAY_HEADERS.height, TRAY_HEADERS.rungHeight, TRAY_HEADERS.width, TRAY_HEADERS.weight,
        TRAY_HEADERS.unitPrice, TRAY_HEADERS.minimumOrder
      ]);

      const loadCurveResult = await pool.query<{ id: string; name: string | null }>(`
        SELECT id, name
        FROM material_load_curves;
      `);
      const loadCurveLookup = new Map<string, string>();
      for (const loadCurve of loadCurveResult.rows) {
        if (loadCurve.name) {
          loadCurveLookup.set(
            normalizeLookupKey(loadCurve.name),
            loadCurve.id
          );
        }
      }

      const preparedRows: {
        data: z.infer<typeof createMaterialTraySchema>;
        loadCurveId: string | null;
      }[] = [];
      const fieldHeaders: Record<string, string> = {
        type: TRAY_HEADERS.type,
        manufacturer: TRAY_HEADERS.manufacturer,
        heightMm: TRAY_HEADERS.height,
        rungHeightMm: TRAY_HEADERS.rungHeight,
        widthMm: TRAY_HEADERS.width,
        weightKgPerM: TRAY_HEADERS.weight,
        unitPrice: TRAY_HEADERS.unitPrice,
        minimumOrderQuantity: TRAY_HEADERS.minimumOrder,
        orderMeasurement: TRAY_HEADERS.orderMeasurement,
        packaging: TRAY_HEADERS.packaging
      };
      rows.forEach((row, index) => {
        const rowNumber = getExcelRowNumber(row, index);
        const loadCurveName = normalizeOptionalText(String(row[TRAY_HEADERS.loadCurve] ?? ''));
        const loadCurveId = loadCurveName
          ? loadCurveLookup.get(normalizeLookupKey(loadCurveName)) ?? null
          : null;
        if (loadCurveName && !loadCurveId) {
          issues.push({
            row: rowNumber,
            column: TRAY_HEADERS.loadCurve,
            message: `Load curve "${loadCurveName}" was not found. Use an existing load curve name or leave this cell blank.`
          });
        }
        const parseResult = createMaterialTraySchema.safeParse({
          type: normalizeType(String(row[TRAY_HEADERS.type])),
          manufacturer: normalizeOptionalText(String(row[TRAY_HEADERS.manufacturer] ?? '')),
          heightMm: toNullableNumber(row[TRAY_HEADERS.height]),
          rungHeightMm: toNullableNumber(row[TRAY_HEADERS.rungHeight]),
          widthMm: toNullableNumber(row[TRAY_HEADERS.width]),
          weightKgPerM: toNullableNumber(row[TRAY_HEADERS.weight]),
          unitPrice: toUnitPrice(row[TRAY_HEADERS.unitPrice]),
          minimumOrderQuantity: toMinimumOrderQuantity(row[TRAY_HEADERS.minimumOrder]),
          orderMeasurement: toOrderMeasurement(row[TRAY_HEADERS.orderMeasurement]),
          packaging: toPackaging(row[TRAY_HEADERS.packaging])
        });
        if (!parseResult.success) {
          issues.push(...parseResult.error.issues.map((issue): ExcelImportIssue => ({
            row: rowNumber,
            column: fieldHeaders[String(issue.path[0])] ?? 'Row',
            message: issue.message
          })));
        } else {
          preparedRows.push({ data: parseResult.data, loadCurveId });
        }
      });
      if (issues.length > 0) {
        res.status(400).json(excelImportError(issues));
        return;
      }

      const client = await pool.connect();

      let created = 0;
      let updated = 0;

      try {
        await client.query('BEGIN');

        for (const { data, loadCurveId } of preparedRows) {
          const existing = await client.query<{ id: string }>(
            `
              SELECT id FROM material_trays
              WHERE LOWER(tray_type) = LOWER($1)
              LIMIT 1;
            `,
            [data.type]
          );

          if (existing.rowCount && existing.rows[0]) {
            await client.query(
              `
                UPDATE material_trays
                SET
                  tray_type = $1,
                  manufacturer = $2,
                  height_mm = $3,
                  rung_height_mm = $4,
                  width_mm = $5,
                  weight_kg_per_m = $6,
                  unit_price = COALESCE($7, unit_price),
                  load_curve_id = $8,
                  minimum_order_quantity = $9,
                  order_measurement = $10,
                  packaging = $11,
                  updated_at = NOW()
                WHERE id = $12;
              `,
              [
                data.type,
                data.manufacturer ?? null,
                data.heightMm ?? null,
                data.rungHeightMm ?? null,
                data.widthMm ?? null,
                data.weightKgPerM ?? null,
                data.unitPrice ?? null,
                loadCurveId,
                data.minimumOrderQuantity ?? 1,
                data.orderMeasurement ?? 'pcs',
                data.packaging ?? 'pcs',
                existing.rows[0].id
              ]
            );
            updated += 1;
          } else {
            await client.query(
              `
                INSERT INTO material_trays (
                  id,
                  tray_type,
                  manufacturer,
                  height_mm,
                  rung_height_mm,
                  width_mm,
                  weight_kg_per_m,
                  unit_price,
                  load_curve_id,
                  minimum_order_quantity,
                  order_measurement,
                  packaging
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
              `,
              [
                randomUUID(),
                data.type,
                data.manufacturer ?? null,
                data.heightMm ?? null,
                data.rungHeightMm ?? null,
                data.widthMm ?? null,
                data.weightKgPerM ?? null,
                data.unitPrice ?? 0,
                loadCurveId,
                data.minimumOrderQuantity ?? 1,
                data.orderMeasurement ?? 'pcs',
                data.packaging ?? 'pcs'
              ]
            );
            created += 1;
          }
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const listResult = await pool.query<MaterialTrayRow>(
        `
          ${selectMaterialTraysQuery}
          ORDER BY mt.tray_type ASC;
        `
      );

      res.json({
        summary: {
          totalRows: rows.length,
          created,
          updated,
          skipped: 0
        },
        trays: listResult.rows.map(mapMaterialTrayRow)
      });
    } catch (error) {
      console.error('Import material trays error', error);
      res.status(500).json({ error: 'Failed to import trays' });
    }
  }
);

materialsRouter.get(
  '/trays/export',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<MaterialTrayRow>(
        `
          ${selectMaterialTraysQuery}
          ORDER BY mt.tray_type ASC;
        `
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Trays', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      const columns = [
        { name: TRAY_HEADERS.manufacturer, key: 'manufacturer', width: 26 },
        { name: TRAY_HEADERS.type, key: 'type', width: 30 },
        { name: TRAY_HEADERS.height, key: 'height', width: 18 },
        { name: TRAY_HEADERS.rungHeight, key: 'rungHeight', width: 18 },
        { name: TRAY_HEADERS.width, key: 'width', width: 18 },
        { name: TRAY_HEADERS.weight, key: 'weight', width: 18 },
        { name: TRAY_HEADERS.loadCurve, key: 'loadCurve', width: 26 },
        { name: TRAY_HEADERS.unitPrice, key: 'unitPrice', width: 16 },
        { name: TRAY_HEADERS.minimumOrder, key: 'minimumOrder', width: 22 },
        { name: TRAY_HEADERS.orderMeasurement, key: 'orderMeasurement', width: 20 },
        { name: TRAY_HEADERS.packaging, key: 'packaging', width: 18 }
      ] as const;

      const rows = result.rows.map((row) => [
        row.manufacturer ?? '',
        row.tray_type,
        row.height_mm !== null && row.height_mm !== '' ? Number(row.height_mm) : '',
        row.rung_height_mm !== null && row.rung_height_mm !== '' ? Number(row.rung_height_mm) : '',
        row.width_mm !== null && row.width_mm !== '' ? Number(row.width_mm) : '',
        row.weight_kg_per_m !== null && row.weight_kg_per_m !== ''
          ? Number(row.weight_kg_per_m)
          : '',
        row.load_curve_name ?? '',
        Number(row.unit_price),
        Number(row.minimum_order_quantity),
        row.order_measurement,
        row.packaging
      ]);

      const table = worksheet.addTable({
        name: 'MaterialTrays',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: {
          theme: 'TableStyleLight8',
          showRowStripes: true,
          showColumnStripes: true
        },
        columns: columns.map((column) => ({
          name: column.name,
          filterButton: true
        })),
        rows:
          rows.length > 0
            ? rows
            : [Array.from({ length: columns.length }, () => '')]
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (column.key === 'height' || column.key === 'rungHeight' || column.key === 'width') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
        if (column.key === 'weight') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.000';
        }
        if (column.key === 'unitPrice') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
        if (column.key === 'minimumOrder') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.###';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${sanitizeFileSegment('materials-trays')}-${timestamp}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${path.basename(filename)}"`
      );
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Export material trays error', error);
      res.status(500).json({ error: 'Failed to export trays' });
    }
  }
);

materialsRouter.get(
  '/trays/template',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Trays', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      const columns = [
        { name: TRAY_HEADERS.manufacturer, key: 'manufacturer', width: 26 },
        { name: TRAY_HEADERS.type, key: 'type', width: 30 },
        { name: TRAY_HEADERS.height, key: 'height', width: 18 },
        { name: TRAY_HEADERS.rungHeight, key: 'rungHeight', width: 18 },
        { name: TRAY_HEADERS.width, key: 'width', width: 18 },
        { name: TRAY_HEADERS.weight, key: 'weight', width: 18 },
        { name: TRAY_HEADERS.loadCurve, key: 'loadCurve', width: 26 },
        { name: TRAY_HEADERS.unitPrice, key: 'unitPrice', width: 16 },
        { name: TRAY_HEADERS.minimumOrder, key: 'minimumOrder', width: 22 },
        { name: TRAY_HEADERS.orderMeasurement, key: 'orderMeasurement', width: 20 },
        { name: TRAY_HEADERS.packaging, key: 'packaging', width: 18 }
      ] as const;

      const table = worksheet.addTable({
        name: 'MaterialTrayTemplate',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: {
          theme: 'TableStyleLight8',
          showRowStripes: true,
          showColumnStripes: true
        },
        columns: columns.map((column) => ({
          name: column.name,
          filterButton: true
        })),
        rows: [[...Array.from({ length: columns.length - 4 }, () => ''), 0, 1, 'pcs', 'pcs']]
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (column.key === 'height' || column.key === 'rungHeight' || column.key === 'width') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
        if (column.key === 'weight') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.000';
        }
        if (column.key === 'unitPrice') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
        if (column.key === 'minimumOrder') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.###';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `${sanitizeFileSegment('materials-trays-template')}.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filename)}"`);
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Generate material tray template error', error);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  }
);

materialsRouter.get(
  '/supports',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { page, pageSize, offset } = parsePaginationParams(req);

      const countResult = await pool.query<{ count: string }>(`
        SELECT COUNT(*)::int AS count FROM material_supports;
      `);
      const totalItems = Number(countResult.rows[0]?.count ?? 0);

      const result = await pool.query<MaterialSupportRow>(
        `
          ${selectMaterialSupportsQuery}
          ORDER BY ms.support_type ASC
          LIMIT $1 OFFSET $2;
        `,
        [pageSize, offset]
      );

      res.json({
        supports: result.rows.map(mapMaterialSupportRow),
        pagination: buildPaginationMeta(totalItems, page, pageSize)
      });
    } catch (error) {
      console.error('List material supports error', error);
      res.status(500).json({ error: 'Failed to fetch supports' });
    }
  }
);

materialsRouter.get(
  '/supports/all',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<MaterialSupportRow>(
        `
          ${selectMaterialSupportsQuery}
          ORDER BY ms.support_type ASC;
        `
      );

      res.json({ supports: result.rows.map(mapMaterialSupportRow) });
    } catch (error) {
      console.error('List all material supports error', error);
      res.status(500).json({ error: 'Failed to fetch supports' });
    }
  }
);

materialsRouter.post(
  '/supports',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
  const parseResult = createMaterialSupportSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const data = parseResult.data;
  const type = normalizeType(data.type);
  const manufacturer = normalizeOptionalText(data.manufacturer ?? null);

  const normalizedImageTemplateId = normalizeOptionalUuid(
    data.imageTemplateId ?? null
  );

  if (normalizedImageTemplateId) {
    try {
      await ensureTemplateIsImage(normalizedImageTemplateId);
    } catch (error) {
      if (respondToTemplateValidationError(res, error)) {
        return;
      }
      console.error('Validate support image template error', error);
      res.status(500).json({ error: 'Failed to validate template file' });
      return;
    }
  }

  const supportId = randomUUID();

  try {
      await pool.query(
        `
          INSERT INTO material_supports (
            id,
            support_type,
            manufacturer,
            height_mm,
            width_mm,
            length_mm,
            weight_kg,
            unit_price,
            minimum_order_quantity,
            order_measurement,
            packaging,
            source,
            image_template_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
        `,
        [
          supportId,
          type,
          manufacturer,
          data.heightMm ?? null,
          data.widthMm ?? null,
          data.lengthMm ?? null,
          data.weightKg ?? null,
          data.unitPrice ?? 0,
          data.minimumOrderQuantity ?? 1,
          data.orderMeasurement ?? 'pcs',
          data.packaging ?? 'pcs',
          normalizeOptionalText(data.source ?? null),
          normalizedImageTemplateId
        ]
      );

      const supportResult = await pool.query<MaterialSupportRow>(
        `
          ${selectMaterialSupportsQuery}
          WHERE ms.id = $1
          LIMIT 1;
        `,
        [supportId]
      );

      const supportRow = supportResult.rows[0];

      if (!supportRow) {
        res.status(500).json({ error: 'Failed to create support' });
        return;
      }

      res.status(201).json({ support: mapMaterialSupportRow(supportRow) });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        res
          .status(409)
          .json({ error: 'A support with this type already exists' });
        return;
      }

      console.error('Create material support error', error);
      res.status(500).json({ error: 'Failed to create support' });
    }
  }
);

materialsRouter.patch(
  '/supports/:supportId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { supportId } = req.params;

    if (!supportId) {
      res.status(400).json({ error: 'Support ID is required' });
      return;
    }

    const parseResult = updateMaterialSupportSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
  }

  const data = parseResult.data;

  let normalizedImageTemplateId: string | null | undefined;

  if (data.imageTemplateId !== undefined) {
    normalizedImageTemplateId = normalizeOptionalUuid(data.imageTemplateId);

    if (normalizedImageTemplateId) {
      try {
        await ensureTemplateIsImage(normalizedImageTemplateId);
      } catch (error) {
        if (respondToTemplateValidationError(res, error)) {
          return;
        }
        console.error('Validate support image template error', error);
        res.status(500).json({ error: 'Failed to validate template file' });
        return;
      }
    }
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let parameterIndex = 1;

  if (data.type !== undefined) {
    setClauses.push(`support_type = $${parameterIndex}`);
    values.push(normalizeType(data.type));
    parameterIndex += 1;
  }

  if (data.manufacturer !== undefined) {
    setClauses.push(`manufacturer = $${parameterIndex}`);
    values.push(normalizeOptionalText(data.manufacturer));
    parameterIndex += 1;
  }

  if (data.heightMm !== undefined) {
    setClauses.push(`height_mm = $${parameterIndex}`);
    values.push(data.heightMm ?? null);
    parameterIndex += 1;
  }

  if (data.widthMm !== undefined) {
    setClauses.push(`width_mm = $${parameterIndex}`);
    values.push(data.widthMm ?? null);
    parameterIndex += 1;
  }

  if (data.lengthMm !== undefined) {
    setClauses.push(`length_mm = $${parameterIndex}`);
    values.push(data.lengthMm ?? null);
    parameterIndex += 1;
  }

  if (data.weightKg !== undefined) {
    setClauses.push(`weight_kg = $${parameterIndex}`);
    values.push(data.weightKg ?? null);
    parameterIndex += 1;
  }

  if (data.unitPrice !== undefined) {
    setClauses.push(`unit_price = $${parameterIndex}`);
    values.push(data.unitPrice);
    parameterIndex += 1;
  }

  if (data.minimumOrderQuantity !== undefined) {
    setClauses.push(`minimum_order_quantity = $${parameterIndex}`);
    values.push(data.minimumOrderQuantity);
    parameterIndex += 1;
  }

  if (data.orderMeasurement !== undefined) {
    setClauses.push(`order_measurement = $${parameterIndex}`);
    values.push(data.orderMeasurement);
    parameterIndex += 1;
  }

  if (data.packaging !== undefined) {
    setClauses.push(`packaging = $${parameterIndex}`);
    values.push(data.packaging);
    parameterIndex += 1;
  }

  if (data.source !== undefined) {
    setClauses.push(`source = $${parameterIndex}`);
    values.push(normalizeOptionalText(data.source));
    parameterIndex += 1;
  }

  if (normalizedImageTemplateId !== undefined) {
    setClauses.push(`image_template_id = $${parameterIndex}`);
    values.push(normalizedImageTemplateId);
    parameterIndex += 1;
  }

  setClauses.push('updated_at = NOW()');

  const idParamIndex = parameterIndex;
  values.push(supportId);

  try {
    const updateResult = await pool.query(
      `
        UPDATE material_supports
        SET ${setClauses.join(', ')}
        WHERE id = $${idParamIndex};
      `,
      values
    );

    if (updateResult.rowCount === 0) {
      res.status(404).json({ error: 'Support not found' });
      return;
    }

    const supportResult = await pool.query<MaterialSupportRow>(
      `
        ${selectMaterialSupportsQuery}
        WHERE ms.id = $1
        LIMIT 1;
      `,
      [supportId]
    );

    const supportRow = supportResult.rows[0];

    if (!supportRow) {
      res.status(404).json({ error: 'Support not found' });
      return;
    }

    res.json({ support: mapMaterialSupportRow(supportRow) });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        res
          .status(409)
          .json({ error: 'A support with this type already exists' });
        return;
      }

      console.error('Update material support error', error);
      res.status(500).json({ error: 'Failed to update support' });
    }
  }
);

materialsRouter.delete(
  '/supports/:supportId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { supportId } = req.params;

    if (!supportId) {
      res.status(400).json({ error: 'Support ID is required' });
      return;
    }

    try {
      const result = await pool.query(
        `
          DELETE FROM material_supports
          WHERE id = $1
          RETURNING id;
        `,
        [supportId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Support not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete material support error', error);
      res.status(500).json({ error: 'Failed to delete support' });
    }
  }
);

materialsRouter.post(
  '/supports/import',
  authenticate,
  requireAdmin,
  uploadExcelFile,
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    try {
      const workbook = readImportWorkbook(file.buffer, res);
      if (!workbook) return;
      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        res.status(400).json({ error: 'Uploaded workbook does not contain sheets' });
        return;
      }

      const sheet = workbook.Sheets[sheetName];
      const issues = validateExcelImport(sheet, materialImportColumns(SUPPORT_HEADERS));
      if (issues.length > 0) {
        res.status(400).json(excelImportError(issues));
        return;
      }
      const rows = readExcelImportRows(sheet, [
        SUPPORT_HEADERS.height, SUPPORT_HEADERS.width, SUPPORT_HEADERS.length, SUPPORT_HEADERS.weight,
        SUPPORT_HEADERS.unitPrice, SUPPORT_HEADERS.minimumOrder
      ]);

      const preparedRows: z.infer<typeof createMaterialSupportSchema>[] = [];
      const fieldHeaders: Record<string, string> = {
        type: SUPPORT_HEADERS.type,
        manufacturer: SUPPORT_HEADERS.manufacturer,
        heightMm: SUPPORT_HEADERS.height,
        widthMm: SUPPORT_HEADERS.width,
        lengthMm: SUPPORT_HEADERS.length,
        weightKg: SUPPORT_HEADERS.weight,
        unitPrice: SUPPORT_HEADERS.unitPrice,
        minimumOrderQuantity: SUPPORT_HEADERS.minimumOrder,
        orderMeasurement: SUPPORT_HEADERS.orderMeasurement,
        packaging: SUPPORT_HEADERS.packaging
      };
      rows.forEach((row, index) => {
        const parseResult = createMaterialSupportSchema.safeParse({
          type: normalizeType(String(row[SUPPORT_HEADERS.type])),
          manufacturer: normalizeOptionalText(String(row[SUPPORT_HEADERS.manufacturer] ?? '')),
          heightMm: toNullableNumber(row[SUPPORT_HEADERS.height]),
          widthMm: toNullableNumber(row[SUPPORT_HEADERS.width]),
          lengthMm: toNullableNumber(row[SUPPORT_HEADERS.length]),
          weightKg: toNullableNumber(row[SUPPORT_HEADERS.weight]),
          unitPrice: toUnitPrice(row[SUPPORT_HEADERS.unitPrice]),
          minimumOrderQuantity: toMinimumOrderQuantity(row[SUPPORT_HEADERS.minimumOrder]),
          orderMeasurement: toOrderMeasurement(row[SUPPORT_HEADERS.orderMeasurement]),
          packaging: toPackaging(row[SUPPORT_HEADERS.packaging])
        });
        if (!parseResult.success) {
          issues.push(...parseResult.error.issues.map((issue): ExcelImportIssue => ({
            row: getExcelRowNumber(row, index),
            column: fieldHeaders[String(issue.path[0])] ?? 'Row',
            message: issue.message
          })));
        } else {
          preparedRows.push(parseResult.data);
        }
      });
      if (issues.length > 0) {
        res.status(400).json(excelImportError(issues));
        return;
      }

      const client = await pool.connect();

      let created = 0;
      let updated = 0;

      try {
        await client.query('BEGIN');

        for (const data of preparedRows) {
          const existing = await client.query<{ id: string }>(
            `
              SELECT id FROM material_supports
              WHERE LOWER(support_type) = LOWER($1)
              LIMIT 1;
            `,
            [data.type]
          );

          if (existing.rowCount && existing.rows[0]) {
            await client.query(
              `
                UPDATE material_supports
                SET
                  support_type = $1,
                  manufacturer = $2,
                  height_mm = $3,
                  width_mm = $4,
                  length_mm = $5,
                  weight_kg = $6,
                  unit_price = COALESCE($7, unit_price),
                  minimum_order_quantity = $8,
                  order_measurement = $9,
                  packaging = $10,
                  updated_at = NOW()
                WHERE id = $11;
              `,
              [
                data.type,
                data.manufacturer ?? null,
                data.heightMm ?? null,
                data.widthMm ?? null,
                data.lengthMm ?? null,
                data.weightKg ?? null,
                data.unitPrice ?? null,
                data.minimumOrderQuantity ?? 1,
                data.orderMeasurement ?? 'pcs',
                data.packaging ?? 'pcs',
                existing.rows[0].id
              ]
            );
            updated += 1;
          } else {
            await client.query(
              `
                INSERT INTO material_supports (
                  id,
                  support_type,
                  manufacturer,
                  height_mm,
                  width_mm,
                  length_mm,
                  weight_kg,
                  unit_price,
                  minimum_order_quantity,
                  order_measurement,
                  packaging
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
              `,
              [
                randomUUID(),
                data.type,
                data.manufacturer ?? null,
                data.heightMm ?? null,
                data.widthMm ?? null,
                data.lengthMm ?? null,
                data.weightKg ?? null,
                data.unitPrice ?? 0,
                data.minimumOrderQuantity ?? 1,
                data.orderMeasurement ?? 'pcs',
                data.packaging ?? 'pcs'
              ]
            );
            created += 1;
          }
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const listResult = await pool.query<MaterialSupportRow>(
        `
          ${selectMaterialSupportsQuery}
          ORDER BY ms.support_type ASC;
        `
      );

      res.json({
        summary: {
          totalRows: rows.length,
          created,
          updated,
          skipped: 0
        },
        supports: listResult.rows.map(mapMaterialSupportRow)
      });
    } catch (error) {
      console.error('Import material supports error', error);
      res.status(500).json({ error: 'Failed to import supports' });
    }
  }
);

materialsRouter.get(
  '/supports/export',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<MaterialSupportRow>(
        `
          ${selectMaterialSupportsQuery}
          ORDER BY ms.support_type ASC;
        `
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Supports', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      const columns = [
        { name: SUPPORT_HEADERS.manufacturer, key: 'manufacturer', width: 26 },
        { name: SUPPORT_HEADERS.type, key: 'type', width: 30 },
        { name: SUPPORT_HEADERS.height, key: 'height', width: 18 },
        { name: SUPPORT_HEADERS.width, key: 'width', width: 18 },
        { name: SUPPORT_HEADERS.length, key: 'length', width: 18 },
        { name: SUPPORT_HEADERS.weight, key: 'weight', width: 18 },
        { name: SUPPORT_HEADERS.unitPrice, key: 'unitPrice', width: 16 },
        { name: SUPPORT_HEADERS.minimumOrder, key: 'minimumOrder', width: 22 },
        { name: SUPPORT_HEADERS.orderMeasurement, key: 'orderMeasurement', width: 20 },
        { name: SUPPORT_HEADERS.packaging, key: 'packaging', width: 18 }
      ] as const;

      const rows = result.rows.map((row) => [
        row.manufacturer ?? '',
        row.support_type,
        row.height_mm !== null && row.height_mm !== '' ? Number(row.height_mm) : '',
        row.width_mm !== null && row.width_mm !== '' ? Number(row.width_mm) : '',
        row.length_mm !== null && row.length_mm !== '' ? Number(row.length_mm) : '',
        row.weight_kg !== null && row.weight_kg !== '' ? Number(row.weight_kg) : '',
        Number(row.unit_price),
        Number(row.minimum_order_quantity),
        row.order_measurement,
        row.packaging
      ]);

      const table = worksheet.addTable({
        name: 'MaterialSupports',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: {
          theme: 'TableStyleLight8',
          showRowStripes: true,
          showColumnStripes: true
        },
        columns: columns.map((column) => ({
          name: column.name,
          filterButton: true
        })),
        rows:
          rows.length > 0
            ? rows
            : [Array.from({ length: columns.length }, () => '')]
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (column.key === 'weight') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.000';
        } else if (column.key === 'unitPrice') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        } else if (
          column.key === 'height' ||
          column.key === 'width' ||
          column.key === 'length'
        ) {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
        if (column.key === 'minimumOrder') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.###';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${sanitizeFileSegment('materials-supports')}-${timestamp}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${path.basename(filename)}"`
      );
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Export material supports error', error);
      res.status(500).json({ error: 'Failed to export supports' });
    }
  }
);

materialsRouter.get(
  '/supports/template',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Supports', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      const columns = [
        { name: SUPPORT_HEADERS.manufacturer, key: 'manufacturer', width: 26 },
        { name: SUPPORT_HEADERS.type, key: 'type', width: 30 },
        { name: SUPPORT_HEADERS.height, key: 'height', width: 18 },
        { name: SUPPORT_HEADERS.width, key: 'width', width: 18 },
        { name: SUPPORT_HEADERS.length, key: 'length', width: 18 },
        { name: SUPPORT_HEADERS.weight, key: 'weight', width: 18 },
        { name: SUPPORT_HEADERS.unitPrice, key: 'unitPrice', width: 16 },
        { name: SUPPORT_HEADERS.minimumOrder, key: 'minimumOrder', width: 22 },
        { name: SUPPORT_HEADERS.orderMeasurement, key: 'orderMeasurement', width: 20 },
        { name: SUPPORT_HEADERS.packaging, key: 'packaging', width: 18 }
      ] as const;

      const table = worksheet.addTable({
        name: 'MaterialSupportTemplate',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: {
          theme: 'TableStyleLight8',
          showRowStripes: true,
          showColumnStripes: true
        },
        columns: columns.map((column) => ({
          name: column.name,
          filterButton: true
        })),
        rows: [[...Array.from({ length: columns.length - 4 }, () => ''), 0, 1, 'pcs', 'pcs']]
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (
          column.key === 'height' ||
          column.key === 'width' ||
          column.key === 'length'
        ) {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
        if (column.key === 'weight') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.000';
        }
        if (column.key === 'unitPrice') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
        if (column.key === 'minimumOrder') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.###';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `${sanitizeFileSegment('materials-supports-template')}.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filename)}"`);
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Generate material support template error', error);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  }
);

materialsRouter.get(
  '/load-curves',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { page, pageSize, offset } = parsePaginationParams(req);

      const countResult = await pool.query<{ count: string }>(`
        SELECT COUNT(*)::int AS count FROM material_load_curves;
      `);
      const totalItems = Number(countResult.rows[0]?.count ?? 0);

      const result = await pool.query<MaterialLoadCurveRow>(
        `
          ${selectMaterialLoadCurvesQuery}
          ORDER BY LOWER(lc.name) ASC
          LIMIT $1 OFFSET $2;
        `,
        [pageSize, offset]
      );

      const loadCurves = await mapLoadCurvesWithPoints(pool, result.rows);

      res.json({
        loadCurves,
        pagination: buildPaginationMeta(totalItems, page, pageSize)
      });
    } catch (error) {
      console.error('List material load curves error', error);
      res.status(500).json({ error: 'Failed to fetch load curves' });
    }
  }
);

materialsRouter.get(
  '/load-curves/summary',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<MaterialLoadCurveRow>(
        `
          ${selectMaterialLoadCurvesQuery}
          ORDER BY LOWER(lc.name) ASC;
        `
      );

      const loadCurves: PublicMaterialLoadCurveSummary[] = result.rows.map(
        (row) => mapMaterialLoadCurveSummary(row)
      );

      res.json({ loadCurves });
    } catch (error) {
      console.error('List material load curve summaries error', error);
      res.status(500).json({ error: 'Failed to fetch load curve summaries' });
    }
  }
);

materialsRouter.get(
  '/load-curves/:loadCurveId',
  async (req: Request, res: Response): Promise<void> => {
    const { loadCurveId } = req.params;

    if (!z.string().uuid().safeParse(loadCurveId).success) {
      res.status(400).json({ error: 'Invalid loadCurveId' });
      return;
    }

    try {
      const loadCurve = await fetchMaterialLoadCurveById(pool, loadCurveId);
      if (!loadCurve) {
        res.status(404).json({ error: 'Load curve not found' });
        return;
      }

      res.json({
        category: {
          key: 'load-curve',
          label: 'Load curve',
          supportsStandardMaterials: false,
        },
        loadCurve,
      });
    } catch (error) {
      console.error('Fetch material load curve error', error);
      res.status(500).json({ error: 'Failed to fetch load curve' });
    }
  }
);

materialsRouter.post(
  '/load-curves',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parseResult = createMaterialLoadCurveSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const data = parseResult.data;
    const name = normalizeType(data.name);
    const description = normalizeOptionalText(data.description ?? null);
    const trayId = normalizeOptionalUuid(data.trayId);
    const points = normalizeLoadCurvePoints(data.points);

    let client: PoolClient | undefined;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const loadCurveId = randomUUID();
      await client.query(
        `
          INSERT INTO material_load_curves (
            id,
            name,
            description,
            tray_id
          ) VALUES ($1, $2, $3, $4);
        `,
        [loadCurveId, name, description, trayId]
      );

      if (points.length > 0) {
        const insertValues: unknown[] = [];
        const valueClauses: string[] = [];

        points.forEach((point, index) => {
          const baseIndex = index * 5;
          insertValues.push(
            randomUUID(),
            loadCurveId,
            index + 1,
            point.spanM,
            point.loadKnPerM
          );
          valueClauses.push(
            `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5})`
          );
        });

        await client.query(
          `
            INSERT INTO material_load_curve_points (
              id,
              load_curve_id,
              point_order,
              span_m,
              load_kn_per_m
            ) VALUES ${valueClauses.join(', ')};
          `,
          insertValues
        );
      }

      const loadCurve = await fetchMaterialLoadCurveById(client, loadCurveId);
      await client.query('COMMIT');

      if (!loadCurve) {
        res.status(500).json({ error: 'Failed to load new load curve' });
        return;
      }

      res.status(201).json({ loadCurve });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);

      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        res.status(409).json({ error: 'A load curve with this name already exists' });
        return;
      }

      console.error('Create material load curve error', error);
      res.status(500).json({ error: 'Failed to create load curve' });
    } finally {
      client?.release();
    }
  }
);

materialsRouter.patch(
  '/load-curves/:loadCurveId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { loadCurveId } = req.params;

    if (!loadCurveId) {
      res.status(400).json({ error: 'Load curve ID is required' });
      return;
    }

    const parseResult = updateMaterialLoadCurveSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const data = parseResult.data;
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let parameterIndex = 1;

    if (data.name !== undefined) {
      setClauses.push(`name = $${parameterIndex}`);
      values.push(normalizeType(data.name));
      parameterIndex += 1;
    }

    if (data.description !== undefined) {
      setClauses.push(`description = $${parameterIndex}`);
      values.push(normalizeOptionalText(data.description));
      parameterIndex += 1;
    }

    if (data.trayId !== undefined) {
      setClauses.push(`tray_id = $${parameterIndex}`);
      values.push(normalizeOptionalUuid(data.trayId));
      parameterIndex += 1;
    }

    setClauses.push('updated_at = NOW()');

    const idParamIndex = parameterIndex;
    values.push(loadCurveId);

    const points =
      data.points !== undefined ? normalizeLoadCurvePoints(data.points) : undefined;

    let client: PoolClient | undefined;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const updateResult = await client.query<MaterialLoadCurveRow>(
        `
          UPDATE material_load_curves
          SET ${setClauses.join(', ')}
          WHERE id = $${idParamIndex}
          RETURNING
            id,
            name,
            description,
            tray_id,
            created_at,
            updated_at;
        `,
        values
      );

      if (updateResult.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Load curve not found' });
        return;
      }

      if (points !== undefined) {
        await client.query(
          `
            DELETE FROM material_load_curve_points
            WHERE load_curve_id = $1;
          `,
          [loadCurveId]
        );

        if (points.length > 0) {
          const insertValues: unknown[] = [];
          const valueClauses: string[] = [];

          points.forEach((point, index) => {
            const baseIndex = index * 5;
            insertValues.push(
              randomUUID(),
              loadCurveId,
              index + 1,
              point.spanM,
              point.loadKnPerM
            );
            valueClauses.push(
              `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5})`
            );
          });

          await client.query(
            `
              INSERT INTO material_load_curve_points (
                id,
                load_curve_id,
                point_order,
                span_m,
                load_kn_per_m
              ) VALUES ${valueClauses.join(', ')};
            `,
            insertValues
          );
        }
      }

      const loadCurve = await fetchMaterialLoadCurveById(client, loadCurveId);
      await client.query('COMMIT');

      if (!loadCurve) {
        res.status(404).json({ error: 'Load curve not found' });
        return;
      }

      res.json({ loadCurve });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);

      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        res.status(409).json({ error: 'A load curve with this name already exists' });
        return;
      }

      console.error('Update material load curve error', error);
      res.status(500).json({ error: 'Failed to update load curve' });
    } finally {
      client?.release();
    }
  }
);

materialsRouter.delete(
  '/load-curves/:loadCurveId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { loadCurveId } = req.params;

    if (!loadCurveId) {
      res.status(400).json({ error: 'Load curve ID is required' });
      return;
    }

    try {
      const result = await pool.query(
        `
          DELETE FROM material_load_curves
          WHERE id = $1;
        `,
        [loadCurveId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Load curve not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete material load curve error', error);
      res.status(500).json({ error: 'Failed to delete load curve' });
    }
  }
);

materialsRouter.post(
  '/load-curves/:loadCurveId/import',
  authenticate,
  requireAdmin,
  uploadExcelFile,
  async (req: Request, res: Response): Promise<void> => {
    const { loadCurveId } = req.params;

    if (!loadCurveId) {
      res.status(400).json({ error: 'Load curve ID is required' });
      return;
    }
    if (!z.string().uuid().safeParse(loadCurveId).success) {
      res.status(400).json({ error: 'Invalid load curve ID' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Excel file is required' });
      return;
    }

    try {
      const workbook = readImportWorkbook(file.buffer, res);
      if (!workbook) return;
      const sheet = workbook.Sheets[LOAD_CURVE_SHEET_NAME];

      if (!sheet) {
        res.status(400).json(excelImportError([{
          row: 1,
          column: 'Workbook',
          message: `Sheet '${LOAD_CURVE_SHEET_NAME}' was not found. Use the load curve import template.`
        }]));
        return;
      }

      const issues = validateExcelImport(sheet, [
        { headers: [LOAD_CURVE_HEADERS.span], required: true, type: 'number', min: 0, unique: true },
        { headers: [LOAD_CURVE_HEADERS.load], required: true, type: 'number', min: 0 }
      ]);
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null
      }).filter((row) => Object.values(row).some((value) => value != null && String(value).trim() !== ''));
      if (rows.length > MAX_LOAD_CURVE_POINTS) {
        issues.push({
          row: getExcelRowNumber(rows[MAX_LOAD_CURVE_POINTS], MAX_LOAD_CURVE_POINTS),
          column: 'Workbook',
          message: `A load curve can contain at most ${MAX_LOAD_CURVE_POINTS} points. Remove the additional rows.`
        });
      }
      if (issues.length > 0) {
        res.status(400).json(excelImportError(issues));
        return;
      }

      const normalizedPoints = normalizeLoadCurvePoints(rows.map((row) => ({
        spanM: Number(toNullableNumber(row[LOAD_CURVE_HEADERS.span])),
        loadKnPerM: Number(toNullableNumber(row[LOAD_CURVE_HEADERS.load]))
      })));

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const existing = await client.query(
          `
            SELECT id FROM material_load_curves
            WHERE id = $1;
          `,
          [loadCurveId]
        );

        if (existing.rowCount === 0) {
          await client.query('ROLLBACK');
          res.status(404).json({ error: 'Load curve not found' });
          return;
        }

        await client.query(
          `
            UPDATE material_load_curves
            SET updated_at = NOW()
            WHERE id = $1;
          `,
          [loadCurveId]
        );

        await client.query(
          `
            DELETE FROM material_load_curve_points
            WHERE load_curve_id = $1;
          `,
          [loadCurveId]
        );

        const insertValues: unknown[] = [];
        const valueClauses: string[] = [];

        normalizedPoints.forEach((point, index) => {
          const baseIndex = index * 5;
          insertValues.push(
            randomUUID(),
            loadCurveId,
            index + 1,
            point.spanM,
            point.loadKnPerM
          );
          valueClauses.push(
            `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5})`
          );
        });

        if (valueClauses.length > 0) {
          await client.query(
            `
              INSERT INTO material_load_curve_points (
                id,
                load_curve_id,
                point_order,
                span_m,
                load_kn_per_m
              ) VALUES ${valueClauses.join(', ')};
            `,
            insertValues
          );
        }

        const loadCurve = await fetchMaterialLoadCurveById(
          client,
          loadCurveId
        );
        await client.query('COMMIT');

        if (!loadCurve) {
          res.status(404).json({ error: 'Load curve not found' });
          return;
        }

        res.json({
          loadCurve,
          summary: {
            importedPoints: normalizedPoints.length
          }
        });
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Import load curve points error', error);
        res.status(500).json({ error: 'Failed to import load curve points' });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Parse load curve import file error', error);
      res.status(500).json({ error: 'Failed to read Excel file' });
    }
  }
);

materialsRouter.get('/trays/:trayId', async (req: Request, res: Response): Promise<void> => {
  const parsedId = z.string().uuid().safeParse(req.params.trayId);
  if (!parsedId.success) {
    res.status(400).json({ error: 'Invalid trayId' });
    return;
  }

  try {
    const result = await pool.query<MaterialTrayRow>(
      `${selectMaterialTraysQuery} WHERE mt.id = $1 LIMIT 1`,
      [parsedId.data],
    );
    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Tray not found' });
      return;
    }
    const standardMaterials = await listStandardMaterialAssignments(pool, 'tray', parsedId.data);
    res.json({
      category: { key: 'tray', label: 'Tray', supportsStandardMaterials: true },
      material: mapMaterialTrayRow(row),
      standardMaterials,
    });
  } catch (error) {
    console.error('Fetch material tray details error', error);
    res.status(500).json({ error: 'Failed to fetch tray details' });
  }
});

materialsRouter.get(
  '/supports/:supportId',
  async (req: Request, res: Response): Promise<void> => {
    const parsedId = z.string().uuid().safeParse(req.params.supportId);
    if (!parsedId.success) {
      res.status(400).json({ error: 'Invalid supportId' });
      return;
    }
    try {
      const result = await pool.query<MaterialSupportRow>(
        `${selectMaterialSupportsQuery} WHERE ms.id = $1 LIMIT 1`,
        [parsedId.data],
      );
      const row = result.rows[0];
      if (!row) {
        res.status(404).json({ error: 'Support not found' });
        return;
      }
      const standardMaterials = await listStandardMaterialAssignments(
        pool,
        'support',
        parsedId.data,
      );
      res.json({
        category: { key: 'support', label: 'Support', supportsStandardMaterials: true },
        material: mapMaterialSupportRow(row),
        standardMaterials,
      });
    } catch (error) {
      console.error('Fetch material support details error', error);
      res.status(500).json({ error: 'Failed to fetch support details' });
    }
  },
);

registerStandardMaterialMutationRoutes(materialsRouter, 'tray', '/trays/:trayId', 'trayId');
registerStandardMaterialMutationRoutes(
  materialsRouter,
  'support',
  '/supports/:supportId',
  'supportId',
);

export { materialsRouter };
