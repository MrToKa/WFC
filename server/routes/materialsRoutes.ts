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
import { authenticate, requireAdmin } from '../middleware.js';
import {
  createMaterialSupportSchema,
  createMaterialTraySchema,
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
    id,
    tray_type,
    height_mm,
    width_mm,
    weight_kg_per_m,
    created_at,
    updated_at
  FROM material_trays
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

const materialsRouter = Router();

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
            weight_kg_per_m
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING
            id,
            tray_type,
            height_mm,
            width_mm,
            weight_kg_per_m,
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

    setClauses.push('updated_at = NOW()');

    const idParamIndex = parameterIndex;
    values.push(trayId);

    try {
      const result = await pool.query<MaterialTrayRow>(
        `
          UPDATE material_trays
          SET ${setClauses.join(', ')}
          WHERE id = $${idParamIndex}
          RETURNING
            id,
            tray_type,
            height_mm,
            width_mm,
            weight_kg_per_m,
            created_at,
            updated_at;
        `,
        values
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Tray not found' });
        return;
      }

      res.json({ tray: mapMaterialTrayRow(result.rows[0]) });
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

export { materialsRouter };
