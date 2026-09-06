import type { PoolClient } from 'pg';
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
  unitPrice: 'Price',
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
  unitPrice: [EXCEL_HEADERS.unitPrice, 'Unit price', 'Unit Price'],
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
  { name: EXCEL_HEADERS.unitPrice, width: 16 },
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
  0,
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

type InstallationMaterialCatalogConfig = {
  category: 'tray-installation-material' | 'instrument' | 'instrument-installation-material';
  table:
    | 'material_tray_installation_materials'
    | 'material_instruments'
    | 'material_instrument_installation_materials';
  label: string;
  collectionKey: string;
  itemKey: string;
  idParam: string;
  worksheetName: string;
  excelTableName: string;
  fileSlug: string;
};

// All catalogs use the same fields, import rules, permissions, and composition routes.
export const createInstallationMaterialCatalogRouter = (
  config: InstallationMaterialCatalogConfig,
): Router => {
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
    unit_price,
    minimum_order_quantity,
    order_measurement,
    packaging,
    source,
    created_at,
    updated_at
  FROM ${config.table}
`;

  const router = Router();

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
    const worksheet = workbook.addWorksheet(config.worksheetName, {
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
      if (column.name === EXCEL_HEADERS.unitPrice) {
        worksheet.getColumn(index + 1).numFmt = '#,##0.00';
      }
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

  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<MaterialTrayInstallationMaterialRow>(
        `${selectMaterialsQuery} ORDER BY type ASC`,
      );
      res.json({
        [config.collectionKey]: result.rows.map(mapMaterialTrayInstallationMaterialRow),
      });
    } catch (error) {
      console.error(`List material ${config.label.toLowerCase()}s error`, error);
      res.status(500).json({ error: `Failed to fetch ${config.label.toLowerCase()}s` });
    }
  });

  router.post(
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
          `INSERT INTO ${config.table} (
           id, type, purpose, material, description, manufacturer, part_no,
           dimension_mm, weight_kg, unit_price, minimum_order_quantity, order_measurement,
           packaging, source
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
            data.unitPrice ?? 0,
            data.minimumOrderQuantity ?? 1,
            data.orderMeasurement ?? 'pcs',
            data.packaging ?? 'pcs',
            normalizeOptionalString(data.source),
          ],
        );
        res.status(201).json({
          [config.itemKey]: mapMaterialTrayInstallationMaterialRow(result.rows[0]),
        });
      } catch (error) {
        if (isPostgresError(error, '23505')) {
          res.status(409).json({
            error: `A material ${config.label.toLowerCase()} with this type already exists`,
          });
          return;
        }
        console.error(`Create material ${config.label.toLowerCase()} error`, error);
        res.status(500).json({ error: `Failed to create ${config.label.toLowerCase()}` });
      }
    },
  );

  router.patch(
    `/:${config.idParam}`,
    authenticate,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const materialId = req.params[config.idParam];
      if (!materialId) {
        res.status(400).json({ error: `${config.label} ID is required` });
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
      if (data.unitPrice !== undefined) add('unit_price', data.unitPrice);
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
          `UPDATE ${config.table}
         SET ${updates.join(', ')}
         WHERE id = $${parameter}
         RETURNING *`,
          [...values, materialId],
        );
        const row = result.rows[0];
        if (!row) {
          res.status(404).json({ error: `${config.label} not found` });
          return;
        }
        res.json({
          [config.itemKey]: mapMaterialTrayInstallationMaterialRow(row),
        });
      } catch (error) {
        if (isPostgresError(error, '23505')) {
          res.status(409).json({
            error: `A material ${config.label.toLowerCase()} with this type already exists`,
          });
          return;
        }
        console.error(`Update material ${config.label.toLowerCase()} error`, error);
        res.status(500).json({ error: `Failed to update ${config.label.toLowerCase()}` });
      }
    },
  );

  router.delete(
    `/:${config.idParam}`,
    authenticate,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const materialId = req.params[config.idParam];
      if (!materialId) {
        res.status(400).json({ error: `${config.label} ID is required` });
        return;
      }

      try {
        const result = await pool.query(`DELETE FROM ${config.table} WHERE id = $1`, [materialId]);
        if (result.rowCount === 0) {
          res.status(404).json({ error: `${config.label} not found` });
          return;
        }
        res.status(204).send();
      } catch (error) {
        if (isPostgresError(error, '23503')) {
          res.status(409).json({
            error: `${config.label} is in use and cannot be deleted until its references are removed.`,
          });
          return;
        }
        console.error(`Delete material ${config.label.toLowerCase()} error`, error);
        res.status(500).json({ error: `Failed to delete ${config.label.toLowerCase()}` });
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
    unitPrice: number | null;
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
        unitPrice: readNonNegativeNumber(readCell(row, EXCEL_HEADER_ALIASES.unitPrice)),
        minimumOrderQuantity: readPositiveNumber(readCell(row, EXCEL_HEADER_ALIASES.minimumOrder)),
        orderMeasurement,
        packaging,
        source: readString(readCell(row, EXCEL_HEADER_ALIASES.source)),
      });
    }

    return { prepared, skipped };
  };

  router.post(
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
        console.error(`Read material ${config.label.toLowerCase()} import workbook error`, error);
        res.status(400).json({ error: 'Failed to read Excel workbook' });
        return;
      }

      const { prepared, skipped } = prepareImportRows(rows);
      const summary = { inserted: 0, updated: 0, skipped };
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query('BEGIN');
        for (const row of prepared) {
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM ${config.table} WHERE lower(type) = $1 LIMIT 1`,
            [row.key],
          );
          const existingId = existing.rows[0]?.id;
          if (existingId) {
            await client.query(
              `UPDATE ${config.table}
             SET purpose = $1, material = $2, description = $3, manufacturer = $4,
                 part_no = $5, dimension_mm = $6, weight_kg = $7,
                 unit_price = COALESCE($8, unit_price),
                 minimum_order_quantity = $9, order_measurement = $10,
                 packaging = $11, source = $12, updated_at = NOW()
             WHERE id = $13`,
              [
                row.purpose,
                row.material,
                row.description,
                row.manufacturer,
                row.partNo,
                row.dimensionMm,
                row.weightKg,
                row.unitPrice,
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
              `INSERT INTO ${config.table} (
               id, type, purpose, material, description, manufacturer, part_no,
               dimension_mm, weight_kg, unit_price, minimum_order_quantity, order_measurement,
               packaging, source
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
                row.unitPrice ?? 0,
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
        await client?.query('ROLLBACK').catch(() => undefined);
        console.error(`Import material ${config.label.toLowerCase()}s error`, error);
        res.status(500).json({ error: `Failed to import ${config.label.toLowerCase()}s` });
        return;
      } finally {
        client?.release();
      }

      try {
        const refreshed = await pool.query<MaterialTrayInstallationMaterialRow>(
          `${selectMaterialsQuery} ORDER BY type ASC`,
        );
        res.json({
          summary,
          [config.collectionKey]: refreshed.rows.map(mapMaterialTrayInstallationMaterialRow),
        });
      } catch (error) {
        console.error(`Refresh material ${config.label.toLowerCase()}s after import error`, error);
        res.status(500).json({
          error: `${config.label}s imported but failed to refresh list`,
          summary,
        });
      }
    },
  );

  router.get(
    '/template',
    authenticate,
    requireAdmin,
    async (_req: Request, res: Response): Promise<void> => {
      try {
        const buffer = await buildWorkbook([], `${config.excelTableName}Template`);
        sendWorkbook(res, `material-${config.fileSlug}-template.xlsx`, buffer);
      } catch (error) {
        console.error(`Generate material ${config.label.toLowerCase()}s template error`, error);
        res.status(500).json({ error: 'Failed to generate template' });
      }
    },
  );

  router.get(
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
          Number(row.unit_price),
          Number(row.minimum_order_quantity),
          row.order_measurement,
          row.packaging,
          row.source ?? '',
        ]);
        const buffer = await buildWorkbook(rows, config.excelTableName);
        sendWorkbook(res, `materials-${config.fileSlug}.xlsx`, buffer);
      } catch (error) {
        console.error(`Export material ${config.label.toLowerCase()}s error`, error);
        res.status(500).json({ error: `Failed to export ${config.label.toLowerCase()}s` });
      }
    },
  );

  router.get(`/:${config.idParam}`, async (req: Request, res: Response): Promise<void> => {
    const parsedId = z.string().uuid().safeParse(req.params[config.idParam]);
    if (!parsedId.success) {
      res.status(400).json({ error: `Invalid ${config.idParam}` });
      return;
    }

    try {
      const result = await pool.query<MaterialTrayInstallationMaterialRow>(
        `${selectMaterialsQuery} WHERE id = $1 LIMIT 1`,
        [parsedId.data],
      );
      const row = result.rows[0];
      if (!row) {
        res.status(404).json({ error: `${config.label} not found` });
        return;
      }
      const standardMaterials = await listStandardMaterialAssignments(
        pool,
        config.category,
        parsedId.data,
      );
      res.json({
        category: {
          key: config.category,
          label: config.label,
          supportsStandardMaterials: true,
        },
        material: mapMaterialTrayInstallationMaterialRow(row),
        standardMaterials,
      });
    } catch (error) {
      console.error(`Fetch ${config.label.toLowerCase()} details error`, error);
      res.status(500).json({ error: `Failed to fetch ${config.label.toLowerCase()} details` });
    }
  });

  registerStandardMaterialMutationRoutes(
    router,
    config.category,
    `/:${config.idParam}`,
    config.idParam,
  );

  return router;
};
