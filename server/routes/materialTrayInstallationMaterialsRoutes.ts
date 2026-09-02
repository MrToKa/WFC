import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { pool } from '../db.js';
import {
  mapMaterialTrayInstallationMaterialRow,
  type MaterialTrayInstallationMaterialRow,
} from '../models/materialTrayInstallationMaterial.js';
import { authenticate, requireAdmin } from '../middleware.js';
import { listStandardMaterialAssignments } from '../services/standardMaterialService.js';
import {
  createMaterialTrayInstallationMaterialSchema,
  updateMaterialTrayInstallationMaterialSchema,
} from '../validators.js';
import { registerStandardMaterialMutationRoutes } from './standardMaterialRoutes.js';

const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE },
});

const EXCEL_HEADERS = {
  type: 'Type',
  purpose: 'Purpose',
  material: 'Material',
  description: 'Description',
  manufacturer: 'Manufacturer',
  partNo: 'Part No.',
  dimensionMm: 'Dimension [mm]',
  weightKg: 'Weight [kg]',
  minimumOrder: 'Minimum order quantity',
  orderMeasurement: 'Order measurement',
  packaging: 'Packaging',
  source: 'Source',
} as const;

const EXCEL_HEADER_ALIASES = {
  type: [EXCEL_HEADERS.type, 'Name'],
  purpose: [EXCEL_HEADERS.purpose],
  material: [EXCEL_HEADERS.material],
  description: [EXCEL_HEADERS.description],
  manufacturer: [EXCEL_HEADERS.manufacturer],
  partNo: [EXCEL_HEADERS.partNo, 'Part No'],
  dimensionMm: [EXCEL_HEADERS.dimensionMm, 'Dimension'],
  weightKg: [EXCEL_HEADERS.weightKg, 'Weight'],
  minimumOrder: [EXCEL_HEADERS.minimumOrder],
  orderMeasurement: [EXCEL_HEADERS.orderMeasurement, 'Measurement'],
  packaging: [EXCEL_HEADERS.packaging],
  source: [EXCEL_HEADERS.source],
} as const;

const EXCEL_COLUMNS = [
  { name: EXCEL_HEADERS.type, width: 32 },
  { name: EXCEL_HEADERS.purpose, width: 24 },
  { name: EXCEL_HEADERS.material, width: 24 },
  { name: EXCEL_HEADERS.description, width: 40 },
  { name: EXCEL_HEADERS.manufacturer, width: 24 },
  { name: EXCEL_HEADERS.partNo, width: 24 },
  { name: EXCEL_HEADERS.dimensionMm, width: 24 },
  { name: EXCEL_HEADERS.weightKg, width: 16 },
  { name: EXCEL_HEADERS.minimumOrder, width: 22 },
  { name: EXCEL_HEADERS.orderMeasurement, width: 20 },
  { name: EXCEL_HEADERS.packaging, width: 18 },
  { name: EXCEL_HEADERS.source, width: 40 },
] as const;

const EMPTY_EXCEL_ROW: Array<string | number> = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  1,
  'pcs',
  'pcs',
  '',
];

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const selectMaterialsQuery = `
  SELECT
    id,
    type,
    purpose,
    material,
    description,
    manufacturer,
    part_no,
    dimension_mm,
    weight_kg,
    minimum_order_quantity,
    order_measurement,
    packaging,
    source,
    created_at,
    updated_at
  FROM material_tray_installation_materials
`;

const materialTrayInstallationMaterialsRouter = Router();

const isPostgresError = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;

const buildWorkbook = async (
  rows: Array<Array<string | number>>,
  tableName: string,
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Tray Installation Materials', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const table = worksheet.addTable({
    name: tableName,
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: {
      theme: 'TableStyleLight8',
      showFirstColumn: false,
      showLastColumn: false,
      showRowStripes: true,
      showColumnStripes: true,
    },
    columns: EXCEL_COLUMNS.map((column) => ({
      name: column.name,
      filterButton: true,
    })),
    rows: rows.length > 0 ? rows : [EMPTY_EXCEL_ROW],
  });

  table.commit();
  EXCEL_COLUMNS.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = column.width;
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

const sendWorkbook = (res: Response, fileName: string, buffer: Buffer): void => {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buffer);
};

materialTrayInstallationMaterialsRouter.get(
  '/',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<MaterialTrayInstallationMaterialRow>(
        `${selectMaterialsQuery} ORDER BY type ASC`,
      );
      res.json({
        trayInstallationMaterials: result.rows.map(mapMaterialTrayInstallationMaterialRow),
      });
    } catch (error) {
      console.error('List material tray installation materials error', error);
      res.status(500).json({ error: 'Failed to fetch tray installation materials' });
    }
  },
);

materialTrayInstallationMaterialsRouter.post(
  '/',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = createMaterialTrayInstallationMaterialSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const data = parsed.data;
    try {
      const result = await pool.query<MaterialTrayInstallationMaterialRow>(
        `INSERT INTO material_tray_installation_materials (
           id, type, purpose, material, description, manufacturer, part_no,
           dimension_mm, weight_kg, minimum_order_quantity, order_measurement,
           packaging, source
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          randomUUID(),
          data.type.trim(),
          normalizeOptionalString(data.purpose),
          normalizeOptionalString(data.material),
          normalizeOptionalString(data.description),
          normalizeOptionalString(data.manufacturer),
          normalizeOptionalString(data.partNo),
          normalizeOptionalString(data.dimensionMm),
          data.weightKg ?? null,
          data.minimumOrderQuantity ?? 1,
          data.orderMeasurement ?? 'pcs',
          data.packaging ?? 'pcs',
          normalizeOptionalString(data.source),
        ],
      );
      res.status(201).json({
        trayInstallationMaterial: mapMaterialTrayInstallationMaterialRow(result.rows[0]),
      });
    } catch (error) {
      if (isPostgresError(error, '23505')) {
        res.status(409).json({
          error: 'A material tray installation material with this type already exists',
        });
        return;
      }
      console.error('Create material tray installation material error', error);
      res.status(500).json({ error: 'Failed to create tray installation material' });
    }
  },
);

materialTrayInstallationMaterialsRouter.patch(
  '/:trayInstallationMaterialId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { trayInstallationMaterialId } = req.params;
    if (!trayInstallationMaterialId) {
      res.status(400).json({ error: 'Tray installation material ID is required' });
      return;
    }

    const parsed = updateMaterialTrayInstallationMaterialSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const updates: string[] = [];
    const values: Array<string | number | null> = [];
    let parameter = 1;
    const add = (column: string, value: string | number | null): void => {
      updates.push(`${column} = $${parameter++}`);
      values.push(value);
    };
    const data = parsed.data;

    if (data.type !== undefined) add('type', data.type.trim());
    if (data.purpose !== undefined) add('purpose', normalizeOptionalString(data.purpose));
    if (data.material !== undefined) add('material', normalizeOptionalString(data.material));
    if (data.description !== undefined) {
      add('description', normalizeOptionalString(data.description));
    }
    if (data.manufacturer !== undefined) {
      add('manufacturer', normalizeOptionalString(data.manufacturer));
    }
    if (data.partNo !== undefined) add('part_no', normalizeOptionalString(data.partNo));
    if (data.dimensionMm !== undefined) {
      add('dimension_mm', normalizeOptionalString(data.dimensionMm));
    }
    if (data.weightKg !== undefined) add('weight_kg', data.weightKg);
    if (data.minimumOrderQuantity !== undefined) {
      add('minimum_order_quantity', data.minimumOrderQuantity);
    }
    if (data.orderMeasurement !== undefined) {
      add('order_measurement', data.orderMeasurement);
    }
    if (data.packaging !== undefined) add('packaging', data.packaging);
    if (data.source !== undefined) add('source', normalizeOptionalString(data.source));
    updates.push('updated_at = NOW()');

    try {
      const result = await pool.query<MaterialTrayInstallationMaterialRow>(
        `UPDATE material_tray_installation_materials
         SET ${updates.join(', ')}
         WHERE id = $${parameter}
         RETURNING *`,
        [...values, trayInstallationMaterialId],
      );
      const row = result.rows[0];
      if (!row) {
        res.status(404).json({ error: 'Tray installation material not found' });
        return;
      }
      res.json({
        trayInstallationMaterial: mapMaterialTrayInstallationMaterialRow(row),
      });
    } catch (error) {
      if (isPostgresError(error, '23505')) {
        res.status(409).json({
          error: 'A material tray installation material with this type already exists',
        });
        return;
      }
      console.error('Update material tray installation material error', error);
      res.status(500).json({ error: 'Failed to update tray installation material' });
    }
  },
);

materialTrayInstallationMaterialsRouter.delete(
  '/:trayInstallationMaterialId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { trayInstallationMaterialId } = req.params;
    if (!trayInstallationMaterialId) {
      res.status(400).json({ error: 'Tray installation material ID is required' });
      return;
    }

    try {
      const result = await pool.query(
        'DELETE FROM material_tray_installation_materials WHERE id = $1',
        [trayInstallationMaterialId],
      );
      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Tray installation material not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      if (isPostgresError(error, '23503')) {
        res.status(409).json({
          error:
            'Tray installation material is in use and cannot be deleted until its references are removed.',
        });
        return;
      }
      console.error('Delete material tray installation material error', error);
      res.status(500).json({ error: 'Failed to delete tray installation material' });
    }
  },
);

type ImportRow = Record<string, unknown>;
type PreparedImportRow = {
  key: string;
  type: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  partNo: string | null;
  dimensionMm: string | null;
  weightKg: number | null;
  minimumOrderQuantity: number;
  orderMeasurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  source: string | null;
};

const readCell = (row: ImportRow, headers: readonly string[]): unknown => {
  for (const header of headers) {
    if (header in row) return row[header];
  }
  return undefined;
};

const readString = (raw: unknown): string | null =>
  raw === undefined || raw === null ? null : normalizeOptionalString(String(raw));

const readPositiveNumber = (raw: unknown): number => {
  const parsed = Number(
    String(raw ?? '')
      .trim()
      .replace(',', '.'),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const readNonNegativeNumber = (raw: unknown): number | null => {
  const text = String(raw ?? '').trim();
  if (text === '') return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const prepareImportRows = (
  rows: ImportRow[],
): {
  prepared: PreparedImportRow[];
  skipped: number;
} => {
  const prepared: PreparedImportRow[] = [];
  const seenKeys = new Set<string>();
  let skipped = 0;

  for (const row of rows) {
    const rawType = readCell(row, EXCEL_HEADER_ALIASES.type);
    const type = String(rawType ?? '').trim();
    const key = type.toLowerCase();
    if (!type || seenKeys.has(key)) {
      skipped += 1;
      continue;
    }
    seenKeys.add(key);

    const rawOrderMeasurement = readString(readCell(row, EXCEL_HEADER_ALIASES.orderMeasurement));
    const orderMeasurement =
      rawOrderMeasurement === 'pcs' ||
      rawOrderMeasurement === 'pack' ||
      rawOrderMeasurement === 'meters'
        ? rawOrderMeasurement
        : 'pcs';
    const rawPackaging = readString(readCell(row, EXCEL_HEADER_ALIASES.packaging));
    const packaging =
      rawPackaging === 'm' ||
      rawPackaging === 'Package' ||
      rawPackaging === 'Box' ||
      rawPackaging === 'Drum' ||
      rawPackaging === 'pcs'
        ? rawPackaging
        : 'pcs';

    prepared.push({
      key,
      type,
      purpose: readString(readCell(row, EXCEL_HEADER_ALIASES.purpose)),
      material: readString(readCell(row, EXCEL_HEADER_ALIASES.material)),
      description: readString(readCell(row, EXCEL_HEADER_ALIASES.description)),
      manufacturer: readString(readCell(row, EXCEL_HEADER_ALIASES.manufacturer)),
      partNo: readString(readCell(row, EXCEL_HEADER_ALIASES.partNo)),
      dimensionMm: readString(readCell(row, EXCEL_HEADER_ALIASES.dimensionMm)),
      weightKg: readNonNegativeNumber(readCell(row, EXCEL_HEADER_ALIASES.weightKg)),
      minimumOrderQuantity: readPositiveNumber(readCell(row, EXCEL_HEADER_ALIASES.minimumOrder)),
      orderMeasurement,
      packaging,
      source: readString(readCell(row, EXCEL_HEADER_ALIASES.source)),
    });
  }

  return { prepared, skipped };
};

materialTrayInstallationMaterialsRouter.post(
  '/import',
  authenticate,
  requireAdmin,
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: 'An .xlsx file is required' });
      return;
    }
    if (path.extname(req.file.originalname ?? '').toLowerCase() !== '.xlsx') {
      res.status(400).json({ error: 'Only .xlsx files are supported' });
      return;
    }

    let rows: ImportRow[];
    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
      if (!worksheet) {
        res.status(400).json({ error: 'The workbook does not contain any sheets' });
        return;
      }
      rows = XLSX.utils.sheet_to_json<ImportRow>(worksheet, { defval: '', raw: false });
    } catch (error) {
      console.error('Read material tray installation import workbook error', error);
      res.status(400).json({ error: 'Failed to read Excel workbook' });
      return;
    }

    const { prepared, skipped } = prepareImportRows(rows);
    const summary = { inserted: 0, updated: 0, skipped };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of prepared) {
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM material_tray_installation_materials WHERE lower(type) = $1 LIMIT 1',
          [row.key],
        );
        const existingId = existing.rows[0]?.id;
        if (existingId) {
          await client.query(
            `UPDATE material_tray_installation_materials
             SET purpose = $1, material = $2, description = $3, manufacturer = $4,
                 part_no = $5, dimension_mm = $6, weight_kg = $7,
                 minimum_order_quantity = $8, order_measurement = $9,
                 packaging = $10, source = $11, updated_at = NOW()
             WHERE id = $12`,
            [
              row.purpose,
              row.material,
              row.description,
              row.manufacturer,
              row.partNo,
              row.dimensionMm,
              row.weightKg,
              row.minimumOrderQuantity,
              row.orderMeasurement,
              row.packaging,
              row.source,
              existingId,
            ],
          );
          summary.updated += 1;
        } else {
          await client.query(
            `INSERT INTO material_tray_installation_materials (
               id, type, purpose, material, description, manufacturer, part_no,
               dimension_mm, weight_kg, minimum_order_quantity, order_measurement,
               packaging, source
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              randomUUID(),
              row.type,
              row.purpose,
              row.material,
              row.description,
              row.manufacturer,
              row.partNo,
              row.dimensionMm,
              row.weightKg,
              row.minimumOrderQuantity,
              row.orderMeasurement,
              row.packaging,
              row.source,
            ],
          );
          summary.inserted += 1;
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('Import material tray installation materials error', error);
      res.status(500).json({ error: 'Failed to import tray installation materials' });
      return;
    } finally {
      client.release();
    }

    try {
      const refreshed = await pool.query<MaterialTrayInstallationMaterialRow>(
        `${selectMaterialsQuery} ORDER BY type ASC`,
      );
      res.json({
        summary,
        trayInstallationMaterials: refreshed.rows.map(mapMaterialTrayInstallationMaterialRow),
      });
    } catch (error) {
      console.error('Refresh material tray installation materials after import error', error);
      res.status(500).json({
        error: 'Tray installation materials imported but failed to refresh list',
        summary,
      });
    }
  },
);

materialTrayInstallationMaterialsRouter.get(
  '/template',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const buffer = await buildWorkbook([], 'MaterialTrayInstallationMaterialsTemplate');
      sendWorkbook(res, 'material-tray-installation-materials-template.xlsx', buffer);
    } catch (error) {
      console.error('Generate material tray installation materials template error', error);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  },
);

materialTrayInstallationMaterialsRouter.get(
  '/export',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<MaterialTrayInstallationMaterialRow>(
        `${selectMaterialsQuery} ORDER BY type ASC`,
      );
      const rows = result.rows.map((row) => [
        row.type ?? '',
        row.purpose ?? '',
        row.material ?? '',
        row.description ?? '',
        row.manufacturer ?? '',
        row.part_no ?? '',
        row.dimension_mm ?? '',
        row.weight_kg === null ? '' : Number(row.weight_kg),
        Number(row.minimum_order_quantity),
        row.order_measurement,
        row.packaging,
        row.source ?? '',
      ]);
      const buffer = await buildWorkbook(rows, 'MaterialTrayInstallationMaterials');
      sendWorkbook(res, 'materials-tray-installation-materials.xlsx', buffer);
    } catch (error) {
      console.error('Export material tray installation materials error', error);
      res.status(500).json({ error: 'Failed to export tray installation materials' });
    }
  },
);

materialTrayInstallationMaterialsRouter.get(
  '/:trayInstallationMaterialId',
  async (req: Request, res: Response): Promise<void> => {
    const parsedId = z.string().uuid().safeParse(req.params.trayInstallationMaterialId);
    if (!parsedId.success) {
      res.status(400).json({ error: 'Invalid trayInstallationMaterialId' });
      return;
    }

    try {
      const result = await pool.query<MaterialTrayInstallationMaterialRow>(
        `${selectMaterialsQuery} WHERE id = $1 LIMIT 1`,
        [parsedId.data],
      );
      const row = result.rows[0];
      if (!row) {
        res.status(404).json({ error: 'Tray installation material not found' });
        return;
      }
      const standardMaterials = await listStandardMaterialAssignments(
        pool,
        'tray-installation-material',
        parsedId.data,
      );
      res.json({
        category: {
          key: 'tray-installation-material',
          label: 'Tray installation material',
          supportsStandardMaterials: true,
        },
        material: mapMaterialTrayInstallationMaterialRow(row),
        standardMaterials,
      });
    } catch (error) {
      console.error('Fetch tray installation material details error', error);
      res.status(500).json({ error: 'Failed to fetch tray installation material details' });
    }
  },
);

registerStandardMaterialMutationRoutes(
  materialTrayInstallationMaterialsRouter,
  'tray-installation-material',
  '/:trayInstallationMaterialId',
  'trayInstallationMaterialId',
);

export { materialTrayInstallationMaterialsRouter };
