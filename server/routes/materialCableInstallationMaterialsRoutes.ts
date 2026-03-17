import { randomUUID } from 'crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { pool } from '../db.js';
import {
  mapMaterialCableInstallationMaterialRow,
  type MaterialCableInstallationMaterialRow,
} from '../models/materialCableInstallationMaterial.js';
import { authenticate, requireAdmin } from '../middleware.js';
import {
  createMaterialCableInstallationMaterialSchema,
  updateMaterialCableInstallationMaterialSchema,
} from '../validators.js';

const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE },
});

const MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS = {
  type: 'Type',
  purpose: 'Purpose',
  material: 'Material',
  description: 'Description',
  manufacturer: 'Manufacturer',
  partNo: 'Part No.',
} as const;

const MATERIAL_CABLE_INSTALLATION_EXCEL_HEADER_ALIASES = {
  type: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.type, 'Name'],
  purpose: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.purpose],
  material: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.material],
  description: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.description],
  manufacturer: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.manufacturer],
  partNo: [MATERIAL_CABLE_INSTALLATION_EXCEL_HEADERS.partNo, 'Part No'],
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

    const { type, purpose, material, description, manufacturer, partNo } = parseResult.data;

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

      if (duplicateResult.rowCount > 0) {
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
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING
            id,
            type,
            purpose,
            material,
            description,
            manufacturer,
            part_no,
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

    const { type, purpose, material, description, manufacturer, partNo } = parseResult.data;

    const updates: string[] = [];
    const values: Array<string | null> = [];
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

        if (duplicateResult.rowCount > 0) {
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
      console.error('Delete material cable installation material error', error);
      res.status(500).json({ error: 'Failed to delete cable installation material' });
    }
  },
);

materialCableInstallationMaterialsRouter.post(
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
      console.error('Read material cable installation material import workbook error', error);
      res.status(400).json({ error: 'Failed to read Excel workbook' });
      return;
    }

    type CableInstallationImportRow = Record<string, unknown>;

    const rows = XLSX.utils.sheet_to_json<CableInstallationImportRow>(worksheet, {
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
      type: string;
      purpose: string | null;
      material: string | null;
      description: string | null;
      manufacturer: string | null;
      partNo: string | null;
    }> = [];

    const seenKeys = new Set<string>();

    const readString = (raw: unknown): string | null =>
      raw === undefined || raw === null ? null : normalizeOptionalString(String(raw));

    const readCell = (row: CableInstallationImportRow, headers: readonly string[]): unknown => {
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

    const client = await pool.connect();

    try {
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
                updated_at = NOW()
              WHERE id = $6;
            `,
            [row.purpose, row.material, row.description, row.manufacturer, row.partNo, existing.id],
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
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7);
            `,
            [
              randomUUID(),
              row.type,
              row.purpose,
              row.material,
              row.description,
              row.manufacturer,
              row.partNo,
            ],
          );
          summary.inserted += 1;
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Import material cable installation materials error', error);
      res.status(500).json({ error: 'Failed to import cable installation materials' });
      return;
    } finally {
      client.release();
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
        rows: [['', '', '', '', '', '']],
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
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
      ] as const;

      const rows = result.rows.map((row: MaterialCableInstallationMaterialRow) => [
        row.type ?? '',
        row.purpose ?? '',
        row.material ?? '',
        row.description ?? '',
        row.manufacturer ?? '',
        row.part_no ?? '',
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
        rows: rows.length > 0 ? rows : [['', '', '', '', '', '']],
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
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

export { materialCableInstallationMaterialsRouter };
