import { excelImportError, readExcelImportRows } from '../utils/excelImport.js';
import { validateMaterialExcelImport } from '../utils/materialExcelImport.js';
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
  mapMaterialCableInstallationMaterialRow,
  type MaterialCableInstallationMaterialRow,
} from '../models/materialCableInstallationMaterial.js';
import { authenticate, requireAdmin } from '../middleware.js';
import { listStandardMaterialAssignments } from '../services/standardMaterialService.js';
import {
  createMaterialCableInstallationMaterialSchema,
  updateMaterialCableInstallationMaterialSchema,
} from '../validators.js';
import { registerStandardMaterialMutationRoutes } from './standardMaterialRoutes.js';


const MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS = {
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

const MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES = {
  type: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.type, 'Name'],
  purpose: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.purpose],
  material: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.material],
  description: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.description],
  manufacturer: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.manufacturer],
  partNo: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.partNo, 'Part No'],
  dimensionMm: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.dimensionMm, 'Dimension'],
  weightKg: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.weightKg, 'Weight'],
  unitPrice: [
    MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.unitPrice,
    'Unit price',
    'Unit Price',
  ],
  minimumOrder: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.minimumOrder],
  orderMeasurement: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.orderMeasurement, 'Measurement'],
  packaging: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.packaging],
  source: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.source],
} as const;

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const selectMaterialCableInstallationMaterialsQuery = `
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
  FROM material_cable_installation_materials
`;

const materialCableInstallationMaterialsRouter = Router();

materialCableInstallationMaterialsRouter.get(
  '/',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<MaterialCableInstallationMaterialRow>(
        `
          ${selectMaterialCableInstallationMaterialsQuery}
          ORDER BY type ASC;
        `,
      );

      res.json({
        cableInstallationMaterials: result.rows.map(mapMaterialCableInstallationMaterialRow),
      });
    } catch (error) {
      console.error('List material cable installation materials error', error);
      res.status(500).json({ error: 'Failed to fetch cable installation materials' });
    }
  },
);

materialCableInstallationMaterialsRouter.post(
  '/',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parseResult = createMaterialCableInstallationMaterialSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const {
      type,
      purpose,
      material,
      description,
      manufacturer,
      partNo,
      dimensionMm,
      weightKg,
      unitPrice,
      minimumOrderQuantity,
      orderMeasurement,
      packaging,
      source,
    } = parseResult.data;

    try {
      const duplicateResult = await pool.query<{ id: string }>(
        `
          SELECT id
          FROM material_cable_installation_materials
          WHERE lower(type) = lower($1)
          LIMIT 1;
        `,
        [type],
      );

      if ((duplicateResult.rowCount ?? 0) > 0) {
        res.status(409).json({
          error: 'A material cable installation material with this type already exists',
        });
        return;
      }

      const result = await pool.query<MaterialCableInstallationMaterialRow>(
        `
          INSERT INTO material_cable_installation_materials (
            id,
            type,
            purpose,
            material,
            description,
            manufacturer,
            part_no
            ,dimension_mm
            ,weight_kg
            ,unit_price
            ,minimum_order_quantity
            ,order_measurement
            ,packaging
            ,source
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING
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
            updated_at;
        `,
        [
          randomUUID(),
          type.trim(),
          normalizeOptionalString(purpose ?? null),
          normalizeOptionalString(material ?? null),
          normalizeOptionalString(description ?? null),
          normalizeOptionalString(manufacturer ?? null),
          normalizeOptionalString(partNo ?? null),
          normalizeOptionalString(dimensionMm ?? null),
          weightKg ?? null,
          unitPrice ?? 0,
          minimumOrderQuantity ?? 1,
          orderMeasurement ?? 'pcs',
          packaging ?? 'pcs',
          normalizeOptionalString(source ?? null),
        ],
      );

      res.status(201).json({
        cableInstallationMaterial: mapMaterialCableInstallationMaterialRow(result.rows[0]),
      });
    } catch (error) {
      console.error('Create material cable installation material error', error);
      res.status(500).json({ error: 'Failed to create cable installation material' });
    }
  },
);

materialCableInstallationMaterialsRouter.patch(
  '/:cableInstallationMaterialId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { cableInstallationMaterialId } = req.params;

    if (!cableInstallationMaterialId) {
      res.status(400).json({ error: 'Cable installation material ID is required' });
      return;
    }

    const parseResult = updateMaterialCableInstallationMaterialSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const {
      type,
      purpose,
      material,
      description,
      manufacturer,
      partNo,
      dimensionMm,
      weightKg,
      unitPrice,
      minimumOrderQuantity,
      orderMeasurement,
      packaging,
      source,
    } = parseResult.data;

    const updates: string[] = [];
    const values: Array<string | number | null> = [];
    let index = 1;

    if (type !== undefined) {
      try {
        const duplicateResult = await pool.query<{ id: string }>(
          `
            SELECT id
            FROM material_cable_installation_materials
            WHERE lower(type) = lower($1)
              AND id <> $2
            LIMIT 1;
          `,
          [type, cableInstallationMaterialId],
        );

        if ((duplicateResult.rowCount ?? 0) > 0) {
          res.status(409).json({
            error: 'A material cable installation material with this type already exists',
          });
          return;
        }
      } catch (error) {
        console.error('Duplicate material cable installation material check error', error);
        res.status(500).json({ error: 'Failed to update cable installation material' });
        return;
      }

      updates.push(`type = $${index++}`);
      values.push(type.trim());
    }

    if (purpose !== undefined) {
      updates.push(`purpose = $${index++}`);
      values.push(normalizeOptionalString(purpose ?? null));
    }

    if (material !== undefined) {
      updates.push(`material = $${index++}`);
      values.push(normalizeOptionalString(material ?? null));
    }

    if (description !== undefined) {
      updates.push(`description = $${index++}`);
      values.push(normalizeOptionalString(description ?? null));
    }

    if (manufacturer !== undefined) {
      updates.push(`manufacturer = $${index++}`);
      values.push(normalizeOptionalString(manufacturer ?? null));
    }

    if (partNo !== undefined) {
      updates.push(`part_no = $${index++}`);
      values.push(normalizeOptionalString(partNo ?? null));
    }

    if (dimensionMm !== undefined) {
      updates.push(`dimension_mm = $${index++}`);
      values.push(normalizeOptionalString(dimensionMm));
    }

    if (weightKg !== undefined) {
      updates.push(`weight_kg = $${index++}`);
      values.push(weightKg);
    }

    if (unitPrice !== undefined) {
      updates.push(`unit_price = $${index++}`);
      values.push(unitPrice);
    }

    if (minimumOrderQuantity !== undefined) {
      updates.push(`minimum_order_quantity = $${index++}`);
      values.push(minimumOrderQuantity);
    }

    if (orderMeasurement !== undefined) {
      updates.push(`order_measurement = $${index++}`);
      values.push(orderMeasurement);
    }

    if (packaging !== undefined) {
      updates.push(`packaging = $${index++}`);
      values.push(packaging);
    }

    if (source !== undefined) {
      updates.push(`source = $${index++}`);
      values.push(normalizeOptionalString(source));
    }

    updates.push('updated_at = NOW()');

    try {
      const result = await pool.query<MaterialCableInstallationMaterialRow>(
        `
          UPDATE material_cable_installation_materials
          SET ${updates.join(', ')}
          WHERE id = $${index}
          RETURNING
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
            updated_at;
        `,
        [...values, cableInstallationMaterialId],
      );

      const cableInstallationMaterial = result.rows[0];

      if (!cableInstallationMaterial) {
        res.status(404).json({ error: 'Cable installation material not found' });
        return;
      }

      res.json({
        cableInstallationMaterial:
          mapMaterialCableInstallationMaterialRow(cableInstallationMaterial),
      });
    } catch (error) {
      console.error('Update material cable installation material error', error);
      res.status(500).json({ error: 'Failed to update cable installation material' });
    }
  },
);

materialCableInstallationMaterialsRouter.delete(
  '/:cableInstallationMaterialId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { cableInstallationMaterialId } = req.params;

    if (!cableInstallationMaterialId) {
      res.status(400).json({ error: 'Cable installation material ID is required' });
      return;
    }

    try {
      const result = await pool.query(
        `
          DELETE FROM material_cable_installation_materials
          WHERE id = $1;
        `,
        [cableInstallationMaterialId],
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Cable installation material not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23503'
      ) {
        res.status(409).json({
          error:
            'Cable installation material is used by a Standard Material assignment. Remove the assignment first.',
        });
        return;
      }
      console.error('Delete material cable installation material error', error);
      res.status(500).json({ error: 'Failed to delete cable installation material' });
    }
  },
);

materialCableInstallationMaterialsRouter.post(
  '/import',
  authenticate,
  requireAdmin,
  uploadExcelFile,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: 'An .xlsx file is required' });
      return;
    }

    const extension = path.extname(req.file.originalname ?? '').toLowerCase();

    if (extension !== '.xlsx') {
      res.status(400).json({ error: 'Only .xlsx files are supported' });
      return;
    }

    let worksheet: XLSX.WorkSheet | null = null;

    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        res.status(400).json({ error: 'The workbook does not contain any sheets' });
        return;
      }

      worksheet = workbook.Sheets[sheetName];
    } catch (error) {
      console.error('Read material cable installation material import workbook error', error);
      res.status(400).json({ error: 'Failed to read Excel workbook' });
      return;
    }

    const issues = validateMaterialExcelImport(worksheet, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES, 'installation-material');
    if (issues.length > 0) {
      res.status(400).json(excelImportError(issues));
      return;
    }

    const rows = readExcelImportRows(worksheet, [...MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.weightKg, ...MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.unitPrice, ...MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.minimumOrder]);

    const summary = {
      inserted: 0,
      updated: 0,
      skipped: 0,
    };

    const prepared: Array<{
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
    }> = [];

    const seenKeys = new Set<string>();

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

    const readCell = (row: Record<string, unknown>, headers: readonly string[]): unknown => {
      for (const header of headers) {
        if (header in row) {
          return row[header];
        }
      }

      return undefined;
    };

    for (const row of rows) {
      const rawType = readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.type);
      const type = typeof rawType === 'number' ? String(rawType) : String(rawType ?? '').trim();

      if (type === '') {
        summary.skipped += 1;
        continue;
      }

      const key = type.toLowerCase();

      if (seenKeys.has(key)) {
        summary.skipped += 1;
        continue;
      }

      seenKeys.add(key);

      prepared.push({
        key,
        type,
        purpose: readString(
          readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.purpose),
        ),
        material: readString(
          readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.material),
        ),
        description: readString(
          readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.description),
        ),
        manufacturer: readString(
          readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.manufacturer),
        ),
        partNo: readString(readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.partNo)),
        dimensionMm: readString(
          readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.dimensionMm),
        ),
        weightKg: readNonNegativeNumber(
          readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.weightKg),
        ),
        unitPrice: readNonNegativeNumber(
          readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.unitPrice),
        ),
        minimumOrderQuantity: readPositiveNumber(
          readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.minimumOrder),
        ),
        orderMeasurement: (() => {
          const parsed = readString(
            readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.orderMeasurement),
          );
          return parsed === 'pcs' || parsed === 'pack' || parsed === 'meters' ? parsed : 'pcs';
        })(),
        packaging: (() => {
          const parsed = readString(
            readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.packaging),
          );
          return parsed === 'm' ||
            parsed === 'Package' ||
            parsed === 'Box' ||
            parsed === 'Drum' ||
            parsed === 'pcs'
            ? parsed
            : 'pcs';
        })(),
        source: readString(readCell(row, MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES.source)),
      });
    }

    if (prepared.length === 0) {
      try {
        const existing = await pool.query<MaterialCableInstallationMaterialRow>(
          `
            ${selectMaterialCableInstallationMaterialsQuery}
            ORDER BY type ASC;
          `,
        );

        res.json({
          summary,
          cableInstallationMaterials: existing.rows.map(mapMaterialCableInstallationMaterialRow),
        });
      } catch (error) {
        console.error(
          'Fetch material cable installation materials after empty import error',
          error,
        );
        res.status(500).json({
          error: 'No rows imported and failed to fetch existing cable installation materials',
          summary,
        });
      }
      return;
    }

    let client: PoolClient | undefined;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const existingResult = await client.query<MaterialCableInstallationMaterialRow>(
        `
          ${selectMaterialCableInstallationMaterialsQuery}
          WHERE lower(type) = ANY($1::text[]);
        `,
        [prepared.map((row) => row.key)],
      );

      const existingMap = new Map<string, MaterialCableInstallationMaterialRow>();

      for (const existing of existingResult.rows) {
        existingMap.set(existing.type.toLowerCase(), existing);
      }

      for (const row of prepared) {
        const existing = existingMap.get(row.key);

        if (existing) {
          await client.query(
            `
              UPDATE material_cable_installation_materials
              SET
                purpose = $1,
                material = $2,
                description = $3,
                manufacturer = $4,
                part_no = $5,
                dimension_mm = $6,
                weight_kg = $7,
                unit_price = COALESCE($8, unit_price),
                minimum_order_quantity = $9,
                order_measurement = $10,
                packaging = $11,
                source = $12,
                updated_at = NOW()
              WHERE id = $13;
            `,
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
              existing.id,
            ],
          );
          summary.updated += 1;
        } else {
          await client.query(
            `
              INSERT INTO material_cable_installation_materials (
                id,
                type,
                purpose,
                material,
                description,
                manufacturer,
                part_no
                ,dimension_mm
                ,weight_kg
                ,unit_price
                ,minimum_order_quantity
                ,order_measurement
                ,packaging
                ,source
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
            `,
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
      console.error('Import material cable installation materials error', error);
      res.status(500).json({ error: 'Failed to import cable installation materials' });
      return;
    } finally {
      client?.release();
    }

    try {
      const refreshed = await pool.query<MaterialCableInstallationMaterialRow>(
        `
          ${selectMaterialCableInstallationMaterialsQuery}
          ORDER BY type ASC;
        `,
      );

      res.json({
        summary,
        cableInstallationMaterials: refreshed.rows.map(mapMaterialCableInstallationMaterialRow),
      });
    } catch (error) {
      console.error('Fetch material cable installation materials after import error', error);
      res.status(500).json({
        error: 'Cable installation materials imported but failed to refresh list',
        summary,
      });
    }
  },
);

materialCableInstallationMaterialsRouter.get(
  '/template',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cable Installation Materials', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      const columns = [
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.type, width: 32 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.purpose, width: 24 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.material, width: 24 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.description, width: 40 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.manufacturer, width: 24 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.partNo, width: 24 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.dimensionMm, width: 24 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.weightKg, width: 16 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.unitPrice, width: 16 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.minimumOrder, width: 22 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.orderMeasurement, width: 20 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.packaging, width: 18 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.source, width: 40 },
      ] as const;

      const table = worksheet.addTable({
        name: 'MaterialCableInstallationMaterialsTemplate',
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
        columns: columns.map((column) => ({
          name: column.name,
          filterButton: true,
        })),
        rows: [['', '', '', '', '', '', '', '', 0, 1, 'pcs', 'pcs', '']],
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (column.name === MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.unitPrice) {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="material-cable-installation-materials-template.xlsx"',
      );

      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Generate material cable installation materials template error', error);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  },
);

materialCableInstallationMaterialsRouter.get(
  '/export',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<MaterialCableInstallationMaterialRow>(
        `
          ${selectMaterialCableInstallationMaterialsQuery}
          ORDER BY type ASC;
        `,
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cable Installation Materials', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      const columns = [
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.type, width: 32 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.purpose, width: 24 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.material, width: 24 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.description, width: 40 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.manufacturer, width: 24 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.partNo, width: 24 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.dimensionMm, width: 24 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.weightKg, width: 16 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.unitPrice, width: 16 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.minimumOrder, width: 22 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.orderMeasurement, width: 20 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.packaging, width: 18 },
        { name: MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.source, width: 40 },
      ] as const;

      const rows = result.rows.map((row: MaterialCableInstallationMaterialRow) => [
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

      const table = worksheet.addTable({
        name: 'MaterialCableInstallationMaterials',
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
        columns: columns.map((column) => ({
          name: column.name,
          filterButton: true,
        })),
        rows:
          rows.length > 0
            ? rows
            : [['', '', '', '', '', '', '', '', 0, 1, 'pcs', 'pcs', '']],
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (column.name === MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.unitPrice) {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="materials-cable-installation-materials.xlsx"',
      );

      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Export material cable installation materials error', error);
      res.status(500).json({ error: 'Failed to export cable installation materials' });
    }
  },
);

materialCableInstallationMaterialsRouter.get(
  '/:cableInstallationMaterialId',
  async (req: Request, res: Response): Promise<void> => {
    const parsedId = z.string().uuid().safeParse(req.params.cableInstallationMaterialId);
    if (!parsedId.success) {
      res.status(400).json({ error: 'Invalid cableInstallationMaterialId' });
      return;
    }
    try {
      const result = await pool.query<MaterialCableInstallationMaterialRow>(
        `${selectMaterialCableInstallationMaterialsQuery} WHERE id = $1 LIMIT 1`,
        [parsedId.data],
      );
      const row = result.rows[0];
      if (!row) {
        res.status(404).json({ error: 'Cable installation material not found' });
        return;
      }
      const standardMaterials = await listStandardMaterialAssignments(
        pool,
        'cable-installation-material',
        parsedId.data,
      );
      res.json({
        category: {
          key: 'cable-installation-material',
          label: 'Cable installation material',
          supportsStandardMaterials: true,
        },
        material: mapMaterialCableInstallationMaterialRow(row),
        standardMaterials,
      });
    } catch (error) {
      console.error('Fetch cable installation material details error', error);
      res.status(500).json({ error: 'Failed to fetch cable installation material details' });
    }
  },
);

registerStandardMaterialMutationRoutes(
  materialCableInstallationMaterialsRouter,
  'cable-installation-material',
  '/:cableInstallationMaterialId',
  'cableInstallationMaterialId',
);

export { materialCableInstallationMaterialsRouter };
