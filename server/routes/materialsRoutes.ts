import { randomUUID } from 'crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import * as XLSX from 'xlsx';
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
import {
  createMaterialLoadCurveSchema,
  createMaterialSupportSchema,
  createMaterialTraySchema,
  updateMaterialLoadCurveSchema,
  updateMaterialSupportSchema,
  updateMaterialTraySchema
} from '../validators.js';

const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE }
});

const TRAY_HEADERS = {
  type: 'Type',
  height: 'Height [mm]',
  width: 'Width [mm]',
  weight: 'Weight [kg/m]'
} as const;

const SUPPORT_HEADERS = {
  type: 'Type',
  height: 'Height [mm]',
  width: 'Width [mm]',
  length: 'Length [mm]',
  weight: 'Weight [kg]'
} as const;

const LOAD_CURVE_HEADERS = {
  span: 'L [m]',
  load: 'q(L) [kN/m]'
} as const;

const LOAD_CURVE_SHEET_NAME = 'CurveData';
const MAX_LOAD_CURVE_POINTS = 2000;

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
    mt.height_mm,
    mt.width_mm,
    mt.weight_kg_per_m,
    mt.load_curve_id,
    mt.created_at,
    mt.updated_at,
    lc.name AS load_curve_name
  FROM material_trays mt
  LEFT JOIN material_load_curves lc ON mt.load_curve_id = lc.id
`;

const selectMaterialSupportsQuery = `
  SELECT
    id,
    support_type,
    height_mm,
    width_mm,
    length_mm,
    weight_kg,
    created_at,
    updated_at
  FROM material_supports
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
          ORDER BY tray_type ASC
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
          ORDER BY tray_type ASC;
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

    try {
      const result = await pool.query<MaterialTrayRow>(
        `
          INSERT INTO material_trays (
            id,
            tray_type,
            height_mm,
            width_mm,
            weight_kg_per_m,
            load_curve_id
          ) VALUES ($1, $2, $3, $4, $5, NULL)
          RETURNING
            id,
            tray_type,
            height_mm,
            width_mm,
            weight_kg_per_m,
            load_curve_id,
            created_at,
            updated_at;
        `,
        [
          randomUUID(),
          type,
          data.heightMm ?? null,
          data.widthMm ?? null,
          data.weightKgPerM ?? null
        ]
      );

      res.status(201).json({ tray: mapMaterialTrayRow(result.rows[0]) });
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

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let parameterIndex = 1;

    if (data.type !== undefined) {
      setClauses.push(`tray_type = $${parameterIndex}`);
      values.push(normalizeType(data.type));
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

    if (data.weightKgPerM !== undefined) {
      setClauses.push(`weight_kg_per_m = $${parameterIndex}`);
      values.push(data.weightKgPerM ?? null);
      parameterIndex += 1;
    }

    if (data.loadCurveId !== undefined) {
      setClauses.push(`load_curve_id = $${parameterIndex}`);
      values.push(normalizeOptionalUuid(data.loadCurveId));
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
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    try {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        res.status(400).json({ error: 'Uploaded workbook does not contain sheets' });
        return;
      }

      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null
      });

      if (rows.length === 0) {
        const listResult = await pool.query<MaterialTrayRow>(
          `
            SELECT
              id,
              tray_type,
              height_mm,
              width_mm,
              weight_kg_per_m,
              created_at,
              updated_at
            FROM material_trays
            ORDER BY tray_type ASC;
          `
        );

        res.json({
          summary: {
            totalRows: 0,
            created: 0,
            updated: 0,
            skipped: 0
          },
          trays: listResult.rows.map(mapMaterialTrayRow)
        });
        return;
      }

      const client = await pool.connect();

      let created = 0;
      let updated = 0;
      let skipped = 0;

      try {
        await client.query('BEGIN');

        for (const row of rows) {
          const typeRaw = row[TRAY_HEADERS.type];
          const heightRaw = row[TRAY_HEADERS.height];
          const widthRaw = row[TRAY_HEADERS.width];
          const weightRaw = row[TRAY_HEADERS.weight];

          if (typeRaw === null || typeRaw === undefined || String(typeRaw).trim() === '') {
            skipped += 1;
            continue;
          }

          const parseResult = createMaterialTraySchema.safeParse({
            type: normalizeType(String(typeRaw)),
            heightMm: toNullableNumber(heightRaw),
            widthMm: toNullableNumber(widthRaw),
            weightKgPerM: toNullableNumber(weightRaw)
          });

          if (!parseResult.success) {
            skipped += 1;
            continue;
          }

          const data = parseResult.data;

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
                  height_mm = $2,
                  width_mm = $3,
                  weight_kg_per_m = $4,
                  updated_at = NOW()
                WHERE id = $5;
              `,
              [
                data.type,
                data.heightMm ?? null,
                data.widthMm ?? null,
                data.weightKgPerM ?? null,
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
                  height_mm,
                  width_mm,
                  weight_kg_per_m
                ) VALUES ($1, $2, $3, $4, $5);
              `,
              [
                randomUUID(),
                data.type,
                data.heightMm ?? null,
                data.widthMm ?? null,
                data.weightKgPerM ?? null
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
          SELECT
            id,
            tray_type,
            height_mm,
            width_mm,
            weight_kg_per_m,
            created_at,
            updated_at
          FROM material_trays
          ORDER BY tray_type ASC;
        `
      );

      res.json({
        summary: {
          totalRows: rows.length,
          created,
          updated,
          skipped
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
          SELECT
            id,
            tray_type,
            height_mm,
            width_mm,
            weight_kg_per_m,
            created_at,
            updated_at
          FROM material_trays
          ORDER BY tray_type ASC;
        `
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Trays', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      const columns = [
        { name: TRAY_HEADERS.type, key: 'type', width: 30 },
        { name: TRAY_HEADERS.height, key: 'height', width: 18 },
        { name: TRAY_HEADERS.width, key: 'width', width: 18 },
        { name: TRAY_HEADERS.weight, key: 'weight', width: 18 }
      ] as const;

      const rows = result.rows.map((row) => [
        row.tray_type,
        row.height_mm !== null && row.height_mm !== '' ? Number(row.height_mm) : '',
        row.width_mm !== null && row.width_mm !== '' ? Number(row.width_mm) : '',
        row.weight_kg_per_m !== null && row.weight_kg_per_m !== ''
          ? Number(row.weight_kg_per_m)
          : ''
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
        rows: rows.length > 0 ? rows : [['', '', '', '']]
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (column.key === 'height' || column.key === 'width') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
        if (column.key === 'weight') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.000';
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
          ORDER BY support_type ASC
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

    try {
      const result = await pool.query<MaterialSupportRow>(
        `
          INSERT INTO material_supports (
            id,
            support_type,
            height_mm,
            width_mm,
            length_mm,
            weight_kg
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING
            id,
            support_type,
            height_mm,
            width_mm,
            length_mm,
            weight_kg,
            created_at,
            updated_at;
        `,
        [
          randomUUID(),
          type,
          data.heightMm ?? null,
          data.widthMm ?? null,
          data.lengthMm ?? null,
          data.weightKg ?? null
        ]
      );

      res.status(201).json({ support: mapMaterialSupportRow(result.rows[0]) });
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

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let parameterIndex = 1;

    if (data.type !== undefined) {
      setClauses.push(`support_type = $${parameterIndex}`);
      values.push(normalizeType(data.type));
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

    setClauses.push('updated_at = NOW()');

    const idParamIndex = parameterIndex;
    values.push(supportId);

    try {
      const result = await pool.query<MaterialSupportRow>(
        `
          UPDATE material_supports
          SET ${setClauses.join(', ')}
          WHERE id = $${idParamIndex}
          RETURNING
            id,
            support_type,
            height_mm,
            width_mm,
            length_mm,
            weight_kg,
            created_at,
            updated_at;
        `,
        values
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Support not found' });
        return;
      }

      res.json({ support: mapMaterialSupportRow(result.rows[0]) });
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
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    try {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        res.status(400).json({ error: 'Uploaded workbook does not contain sheets' });
        return;
      }

      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null
      });

      if (rows.length === 0) {
        const listResult = await pool.query<MaterialSupportRow>(
          `
            SELECT
              id,
              support_type,
              height_mm,
              width_mm,
              length_mm,
              weight_kg,
              created_at,
              updated_at
            FROM material_supports
            ORDER BY support_type ASC;
          `
        );

        res.json({
          summary: {
            totalRows: 0,
            created: 0,
            updated: 0,
            skipped: 0
          },
          supports: listResult.rows.map(mapMaterialSupportRow)
        });
        return;
      }

      const client = await pool.connect();

      let created = 0;
      let updated = 0;
      let skipped = 0;

      try {
        await client.query('BEGIN');

        for (const row of rows) {
          const typeRaw = row[SUPPORT_HEADERS.type];
          const heightRaw = row[SUPPORT_HEADERS.height];
          const widthRaw = row[SUPPORT_HEADERS.width];
          const lengthRaw = row[SUPPORT_HEADERS.length];
          const weightRaw = row[SUPPORT_HEADERS.weight];

          if (typeRaw === null || typeRaw === undefined || String(typeRaw).trim() === '') {
            skipped += 1;
            continue;
          }

          const parseResult = createMaterialSupportSchema.safeParse({
            type: normalizeType(String(typeRaw)),
            heightMm: toNullableNumber(heightRaw),
            widthMm: toNullableNumber(widthRaw),
            lengthMm: toNullableNumber(lengthRaw),
            weightKg: toNullableNumber(weightRaw)
          });

          if (!parseResult.success) {
            skipped += 1;
            continue;
          }

          const data = parseResult.data;

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
                  height_mm = $2,
                  width_mm = $3,
                  length_mm = $4,
                  weight_kg = $5,
                  updated_at = NOW()
                WHERE id = $6;
              `,
              [
                data.type,
                data.heightMm ?? null,
                data.widthMm ?? null,
                data.lengthMm ?? null,
                data.weightKg ?? null,
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
                  height_mm,
                  width_mm,
                  length_mm,
                  weight_kg
                ) VALUES ($1, $2, $3, $4, $5, $6);
              `,
              [
                randomUUID(),
                data.type,
                data.heightMm ?? null,
                data.widthMm ?? null,
                data.lengthMm ?? null,
                data.weightKg ?? null
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
          SELECT
            id,
            support_type,
            height_mm,
            width_mm,
            length_mm,
            weight_kg,
            created_at,
            updated_at
          FROM material_supports
          ORDER BY support_type ASC;
        `
      );

      res.json({
        summary: {
          totalRows: rows.length,
          created,
          updated,
          skipped
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
          SELECT
            id,
            support_type,
            height_mm,
            width_mm,
            length_mm,
            weight_kg,
            created_at,
            updated_at
          FROM material_supports
          ORDER BY support_type ASC;
        `
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Supports', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      const columns = [
        { name: SUPPORT_HEADERS.type, key: 'type', width: 30 },
        { name: SUPPORT_HEADERS.height, key: 'height', width: 18 },
        { name: SUPPORT_HEADERS.width, key: 'width', width: 18 },
        { name: SUPPORT_HEADERS.length, key: 'length', width: 18 },
        { name: SUPPORT_HEADERS.weight, key: 'weight', width: 18 }
      ] as const;

      const rows = result.rows.map((row) => [
        row.support_type,
        row.height_mm !== null && row.height_mm !== '' ? Number(row.height_mm) : '',
        row.width_mm !== null && row.width_mm !== '' ? Number(row.width_mm) : '',
        row.length_mm !== null && row.length_mm !== '' ? Number(row.length_mm) : '',
        row.weight_kg !== null && row.weight_kg !== '' ? Number(row.weight_kg) : ''
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
        rows: rows.length > 0 ? rows : [['', '', '', '', '']]
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (column.key === 'weight') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.000';
        } else if (column.key !== 'type') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
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

    if (!loadCurveId) {
      res.status(400).json({ error: 'Load curve ID is required' });
      return;
    }

    try {
      const loadCurve = await fetchMaterialLoadCurveById(pool, loadCurveId);
      if (!loadCurve) {
        res.status(404).json({ error: 'Load curve not found' });
        return;
      }

      res.json({ loadCurve });
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

    const client = await pool.connect();

    try {
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
      await client.query('ROLLBACK');

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
      client.release();
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

    const client = await pool.connect();

    try {
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
      await client.query('ROLLBACK');

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
      client.release();
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
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const { loadCurveId } = req.params;

    if (!loadCurveId) {
      res.status(400).json({ error: 'Load curve ID is required' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Excel file is required' });
      return;
    }

    try {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[LOAD_CURVE_SHEET_NAME];

      if (!sheet) {
        res.status(400).json({
          error: `Sheet '${LOAD_CURVE_SHEET_NAME}' not found in workbook`
        });
        return;
      }

      const rows = XLSX.utils.sheet_to_json<(unknown | null)[]>(sheet, {
        header: 1,
        raw: true,
        defval: null
      });

      const [, ...dataRows] = rows;
      const points = dataRows
        .map((row) => {
          if (!Array.isArray(row) || row.length < 2) {
            return null;
          }

          const span = toNullableNumber(row[0]);
          const load = toNullableNumber(row[1]);

          if (span === null || load === null) {
            return null;
          }

          return {
            spanM: span,
            loadKnPerM: load
          };
        })
        .filter(
          (point): point is { spanM: number; loadKnPerM: number } =>
            point !== null
        );

      if (points.length === 0) {
        res.status(400).json({ error: 'No valid curve points found in file' });
        return;
      }

      const normalizedPoints = normalizeLoadCurvePoints(points);

      if (normalizedPoints.length === 0) {
        res.status(400).json({ error: 'No valid curve points to import' });
        return;
      }

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

export { materialsRouter };
