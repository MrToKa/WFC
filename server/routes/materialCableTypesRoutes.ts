import { randomUUID } from 'crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { pool } from '../db.js';
import { mapMaterialCableTypeRow, type MaterialCableTypeRow } from '../models/materialCableType.js';
import { authenticate, requireAdmin } from '../middleware.js';
import {
  createMaterialCableTypeSchema,
  updateMaterialCableTypeSchema,
} from '../validators.js';

const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE },
});

const MATERIAL_CABLE_EXCEL_HEADERS = {
  name: 'Type',
  purpose: 'Purpose',
  material: 'Material',
  description: 'Description',
  manufacturer: 'Manufacturer',
  partNo: 'Part No.',
  remarks: 'Remarks',
  diameter: 'Diameter [mm]',
  weight: 'Weight [kg/m]',
} as const;

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const selectMaterialCableTypesQuery = `
  SELECT
    id,
    name,
    purpose,
    material,
    description,
    manufacturer,
    part_no,
    remarks,
    diameter_mm,
    weight_kg_per_m,
    created_at,
    updated_at
  FROM material_cable_types
`;

const materialCableTypesRouter = Router();

materialCableTypesRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query<MaterialCableTypeRow>(
      `
          ${selectMaterialCableTypesQuery}
          ORDER BY name ASC;
        `,
    );

    res.json({ cableTypes: result.rows.map(mapMaterialCableTypeRow) });
  } catch (error) {
    console.error('List material cable types error', error);
    res.status(500).json({ error: 'Failed to fetch cable types' });
  }
});

materialCableTypesRouter.post(
  '/',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parseResult = createMaterialCableTypeSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const {
      name,
      purpose,
      material,
      description,
      manufacturer,
      partNo,
      remarks,
      diameterMm,
      weightKgPerM,
    } = parseResult.data;

    try {
      const duplicateResult = await pool.query<{ id: string }>(
        `
          SELECT id
          FROM material_cable_types
          WHERE lower(name) = lower($1)
          LIMIT 1;
        `,
        [name],
      );

      if (duplicateResult.rowCount > 0) {
        res.status(409).json({
          error: 'A material cable type with this name already exists',
        });
        return;
      }

      const result = await pool.query<MaterialCableTypeRow>(
        `
          INSERT INTO material_cable_types (
            id,
            name,
            purpose,
            material,
            description,
            manufacturer,
            part_no,
            remarks,
            diameter_mm,
            weight_kg_per_m
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING
            id,
            name,
            purpose,
            material,
            description,
            manufacturer,
            part_no,
            remarks,
            diameter_mm,
            weight_kg_per_m,
            created_at,
            updated_at;
        `,
        [
          randomUUID(),
          name.trim(),
          normalizeOptionalString(purpose ?? null),
          normalizeOptionalString(material ?? null),
          normalizeOptionalString(description ?? null),
          normalizeOptionalString(manufacturer ?? null),
          normalizeOptionalString(partNo ?? null),
          normalizeOptionalString(remarks ?? null),
          diameterMm ?? null,
          weightKgPerM ?? null,
        ],
      );

      res.status(201).json({ cableType: mapMaterialCableTypeRow(result.rows[0]) });
    } catch (error) {
      console.error('Create material cable type error', error);
      res.status(500).json({ error: 'Failed to create cable type' });
    }
  },
);

materialCableTypesRouter.patch(
  '/:cableTypeId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { cableTypeId } = req.params;

    if (!cableTypeId) {
      res.status(400).json({ error: 'Cable type ID is required' });
      return;
    }

    const parseResult = updateMaterialCableTypeSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const {
      name,
      purpose,
      material,
      description,
      manufacturer,
      partNo,
      remarks,
      diameterMm,
      weightKgPerM,
    } = parseResult.data;

    const updates: string[] = [];
    const values: Array<string | number | null> = [];
    let index = 1;

    if (name !== undefined) {
      try {
        const duplicateResult = await pool.query<{ id: string }>(
          `
            SELECT id
            FROM material_cable_types
            WHERE lower(name) = lower($1)
              AND id <> $2
            LIMIT 1;
          `,
          [name, cableTypeId],
        );

        if (duplicateResult.rowCount > 0) {
          res.status(409).json({
            error: 'A material cable type with this name already exists',
          });
          return;
        }
      } catch (error) {
        console.error('Duplicate material cable type check error', error);
        res.status(500).json({ error: 'Failed to update cable type' });
        return;
      }

      updates.push(`name = $${index++}`);
      values.push(name.trim());
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

    if (remarks !== undefined) {
      updates.push(`remarks = $${index++}`);
      values.push(normalizeOptionalString(remarks ?? null));
    }

    if (diameterMm !== undefined) {
      updates.push(`diameter_mm = $${index++}`);
      values.push(diameterMm ?? null);
    }

    if (weightKgPerM !== undefined) {
      updates.push(`weight_kg_per_m = $${index++}`);
      values.push(weightKgPerM ?? null);
    }

    updates.push('updated_at = NOW()');

    try {
      const result = await pool.query<MaterialCableTypeRow>(
        `
          UPDATE material_cable_types
          SET ${updates.join(', ')}
          WHERE id = $${index}
          RETURNING
            id,
            name,
            purpose,
            material,
            description,
            manufacturer,
            part_no,
            remarks,
            diameter_mm,
            weight_kg_per_m,
            created_at,
            updated_at;
        `,
        [...values, cableTypeId],
      );

      const cableType = result.rows[0];

      if (!cableType) {
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      res.json({ cableType: mapMaterialCableTypeRow(cableType) });
    } catch (error) {
      console.error('Update material cable type error', error);
      res.status(500).json({ error: 'Failed to update cable type' });
    }
  },
);

materialCableTypesRouter.delete(
  '/:cableTypeId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { cableTypeId } = req.params;

    if (!cableTypeId) {
      res.status(400).json({ error: 'Cable type ID is required' });
      return;
    }

    try {
      const result = await pool.query(
        `
          DELETE FROM material_cable_types
          WHERE id = $1;
        `,
        [cableTypeId],
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete material cable type error', error);
      res.status(500).json({ error: 'Failed to delete cable type' });
    }
  },
);

materialCableTypesRouter.post(
  '/import',
  authenticate,
  requireAdmin,
  upload.single('file'),
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
      console.error('Read material cable type import workbook error', error);
      res.status(400).json({ error: 'Failed to read Excel workbook' });
      return;
    }

    type CableImportRow = Record<string, unknown>;

    const rows = XLSX.utils.sheet_to_json<CableImportRow>(worksheet, {
      defval: '',
      raw: false,
    });

    const summary = {
      inserted: 0,
      updated: 0,
      skipped: 0,
    };

    const prepared: Array<{
      key: string;
      name: string;
      purpose: string | null;
      material: string | null;
      description: string | null;
      manufacturer: string | null;
      partNo: string | null;
      remarks: string | null;
      diameter: number | null;
      weight: number | null;
    }> = [];

    const seenKeys = new Set<string>();

    const readNumeric = (raw: unknown): number | null => {
      if (raw === undefined || raw === null) {
        return null;
      }

      if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : null;
      }

      const text = String(raw).trim();

      if (text === '') {
        return null;
      }

      const normalized = text.replace(',', '.');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const readString = (raw: unknown): string | null =>
      raw === undefined || raw === null ? null : normalizeOptionalString(String(raw));

    for (const row of rows) {
      const rawName = row[MATERIAL_CABLE_EXCEL_HEADERS.name] as unknown;
      const name = typeof rawName === 'number' ? String(rawName) : String(rawName ?? '').trim();

      if (name === '') {
        summary.skipped += 1;
        continue;
      }

      const key = name.toLowerCase();

      if (seenKeys.has(key)) {
        summary.skipped += 1;
        continue;
      }

      seenKeys.add(key);

      prepared.push({
        key,
        name,
        purpose: readString(row[MATERIAL_CABLE_EXCEL_HEADERS.purpose]),
        material: readString(row[MATERIAL_CABLE_EXCEL_HEADERS.material]),
        description: readString(row[MATERIAL_CABLE_EXCEL_HEADERS.description]),
        manufacturer: readString(row[MATERIAL_CABLE_EXCEL_HEADERS.manufacturer]),
        partNo: readString(row[MATERIAL_CABLE_EXCEL_HEADERS.partNo]),
        remarks: readString(row[MATERIAL_CABLE_EXCEL_HEADERS.remarks]),
        diameter: readNumeric(row[MATERIAL_CABLE_EXCEL_HEADERS.diameter]),
        weight: readNumeric(row[MATERIAL_CABLE_EXCEL_HEADERS.weight]),
      });
    }

    if (prepared.length === 0) {
      try {
        const existing = await pool.query<MaterialCableTypeRow>(
          `
            ${selectMaterialCableTypesQuery}
            ORDER BY name ASC;
          `,
        );

        res.json({
          summary,
          cableTypes: existing.rows.map(mapMaterialCableTypeRow),
        });
      } catch (error) {
        console.error('Fetch material cable types after empty import error', error);
        res.status(500).json({
          error: 'No rows imported and failed to fetch existing cable types',
          summary,
        });
      }
      return;
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const existingResult = await client.query<MaterialCableTypeRow>(
        `
          ${selectMaterialCableTypesQuery}
          WHERE lower(name) = ANY($1::text[]);
        `,
        [prepared.map((row) => row.key)],
      );

      const existingMap = new Map<string, MaterialCableTypeRow>();

      for (const existing of existingResult.rows) {
        existingMap.set(existing.name.toLowerCase(), existing);
      }

      for (const row of prepared) {
        const existing = existingMap.get(row.key);

        if (existing) {
          await client.query(
            `
              UPDATE material_cable_types
              SET
                purpose = $1,
                material = $2,
                description = $3,
                manufacturer = $4,
                part_no = $5,
                remarks = $6,
                diameter_mm = $7,
                weight_kg_per_m = $8,
                updated_at = NOW()
              WHERE id = $9;
            `,
            [
              row.purpose,
              row.material,
              row.description,
              row.manufacturer,
              row.partNo,
              row.remarks,
              row.diameter,
              row.weight,
              existing.id,
            ],
          );
          summary.updated += 1;
        } else {
          await client.query(
            `
              INSERT INTO material_cable_types (
                id,
                name,
                purpose,
                material,
                description,
                manufacturer,
                part_no,
                remarks,
                diameter_mm,
                weight_kg_per_m
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
            `,
            [
              randomUUID(),
              row.name,
              row.purpose,
              row.material,
              row.description,
              row.manufacturer,
              row.partNo,
              row.remarks,
              row.diameter,
              row.weight,
            ],
          );
          summary.inserted += 1;
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Import material cable types error', error);
      res.status(500).json({ error: 'Failed to import cable types' });
      return;
    } finally {
      client.release();
    }

    try {
      const refreshed = await pool.query<MaterialCableTypeRow>(
        `
          ${selectMaterialCableTypesQuery}
          ORDER BY name ASC;
        `,
      );

      res.json({
        summary,
        cableTypes: refreshed.rows.map(mapMaterialCableTypeRow),
      });
    } catch (error) {
      console.error('Fetch material cable types after import error', error);
      res.status(500).json({
        error: 'Cable types imported but failed to refresh list',
        summary,
      });
    }
  },
);

materialCableTypesRouter.get(
  '/template',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cable Types', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      const columns = [
        { name: MATERIAL_CABLE_EXCEL_HEADERS.name, key: 'type', width: 32 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.purpose, key: 'purpose', width: 36 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.material, key: 'material', width: 24 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.description, key: 'description', width: 36 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.manufacturer, key: 'manufacturer', width: 24 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.partNo, key: 'partNo', width: 24 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.remarks, key: 'remarks', width: 30 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.diameter, key: 'diameter', width: 18 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.weight, key: 'weight', width: 18 },
      ] as const;

      const table = worksheet.addTable({
        name: 'MaterialCableTypesTemplate',
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
        rows: [['', '', '', '', '', '', '', '', '']],
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (column.key === 'diameter') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
        if (column.key === 'weight') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.000';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="material-cable-types-template.xlsx"',
      );

      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Generate material cable types template error', error);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  },
);

materialCableTypesRouter.get(
  '/export',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<MaterialCableTypeRow>(
        `
          ${selectMaterialCableTypesQuery}
          ORDER BY name ASC;
        `,
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cable Types', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      const columns = [
        { name: MATERIAL_CABLE_EXCEL_HEADERS.name, key: 'type', width: 32 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.purpose, key: 'purpose', width: 36 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.material, key: 'material', width: 24 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.description, key: 'description', width: 36 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.manufacturer, key: 'manufacturer', width: 24 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.partNo, key: 'partNo', width: 24 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.remarks, key: 'remarks', width: 30 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.diameter, key: 'diameter', width: 18 },
        { name: MATERIAL_CABLE_EXCEL_HEADERS.weight, key: 'weight', width: 18 },
      ] as const;

      const rows = result.rows.map((row) => [
        row.name ?? '',
        row.purpose ?? '',
        row.material ?? '',
        row.description ?? '',
        row.manufacturer ?? '',
        row.part_no ?? '',
        row.remarks ?? '',
        row.diameter_mm !== null && row.diameter_mm !== '' ? Number(row.diameter_mm) : '',
        row.weight_kg_per_m !== null && row.weight_kg_per_m !== ''
          ? Number(row.weight_kg_per_m)
          : '',
      ]);

      const table = worksheet.addTable({
        name: 'MaterialCableTypes',
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
        rows: rows.length > 0 ? rows : [['', '', '', '', '', '', '', '', '']],
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (column.key === 'diameter') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
        if (column.key === 'weight') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.000';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', 'attachment; filename="materials-cable-types.xlsx"');

      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Export material cable types error', error);
      res.status(500).json({ error: 'Failed to export cable types' });
    }
  },
);

export { materialCableTypesRouter };
