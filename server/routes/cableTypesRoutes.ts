import { randomUUID } from 'crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { pool } from '../db.js';
import { mapCableTypeRow } from '../models/cableType.js';
import type { CableTypeRow } from '../models/cableType.js';
import { authenticate, requireAdmin } from '../middleware.js';
import { ensureProjectExists } from '../services/projectService.js';
import {
  createCableTypeSchema,
  updateCableTypeSchema
} from '../validators.js';

const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE }
});

const CABLE_EXCEL_HEADERS = {
  name: 'Type',
  purpose: 'Purpose',
  diameter: 'Diameter [mm]',
  weight: 'Weight [kg/m]'
} as const;

const normalizeOptionalString = (
  value: string | null | undefined
): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const sanitizeFileSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

const selectCableTypesQuery = `
  SELECT
    id,
    project_id,
    name,
    purpose,
    diameter_mm,
    weight_kg_per_m,
    created_at,
    updated_at
  FROM cable_types
`;

const cableTypesRouter = Router({ mergeParams: true });

cableTypesRouter.get(
  '/',
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const result = await pool.query<CableTypeRow>(
        `
          ${selectCableTypesQuery}
          WHERE project_id = $1
          ORDER BY name ASC;
        `,
        [projectId]
      );

      res.json({ cableTypes: result.rows.map(mapCableTypeRow) });
    } catch (error) {
      console.error('List cable types error', error);
      res.status(500).json({ error: 'Failed to fetch cable types' });
    }
  }
);

cableTypesRouter.post(
  '/',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
    } catch (error) {
      console.error('Verify project for cable type create error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    const parseResult = createCableTypeSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const { name, purpose, diameterMm, weightKgPerM } = parseResult.data;

    const normalizedPurpose = normalizeOptionalString(purpose ?? null);
    const normalizedDiameter = diameterMm ?? null;
    const normalizedWeight = weightKgPerM ?? null;

    try {
      const duplicateResult = await pool.query<{ id: string }>(
        `
          SELECT id
          FROM cable_types
          WHERE project_id = $1
            AND lower(name) = lower($2)
          LIMIT 1;
        `,
        [projectId, name]
      );

      if (duplicateResult.rowCount > 0) {
        res.status(409).json({
          error: 'A cable type with this name already exists for the project'
        });
        return;
      }

      const result = await pool.query<CableTypeRow>(
        `
          INSERT INTO cable_types (
            id,
            project_id,
            name,
            purpose,
            diameter_mm,
            weight_kg_per_m
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING
            id,
            project_id,
            name,
            purpose,
            diameter_mm,
            weight_kg_per_m,
            created_at,
            updated_at;
        `,
        [
          randomUUID(),
          projectId,
          name.trim(),
          normalizedPurpose,
          normalizedDiameter,
          normalizedWeight
        ]
      );

      res.status(201).json({ cableType: mapCableTypeRow(result.rows[0]) });
    } catch (error) {
      console.error('Create cable type error', error);
      res.status(500).json({ error: 'Failed to create cable type' });
    }
  }
);

cableTypesRouter.patch(
  '/:cableTypeId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId } = req.params;

    if (!projectId || !cableTypeId) {
      res
        .status(400)
        .json({ error: 'Project ID and cable type ID are required' });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
    } catch (error) {
      console.error('Verify project for cable type update error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    const parseResult = updateCableTypeSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const { name, purpose, diameterMm, weightKgPerM } = parseResult.data;

    const updates: string[] = [];
    const values: Array<string | number | null> = [];
    let index = 1;

    if (name !== undefined) {
      try {
        const duplicateResult = await pool.query<{ id: string }>(
          `
            SELECT id
            FROM cable_types
            WHERE project_id = $1
              AND lower(name) = lower($2)
              AND id <> $3
            LIMIT 1;
          `,
          [projectId, name, cableTypeId]
        );

        if (duplicateResult.rowCount > 0) {
          res.status(409).json({
            error:
              'A cable type with this name already exists for the project'
          });
          return;
        }
      } catch (error) {
        console.error('Duplicate cable type check error', error);
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

    if (diameterMm !== undefined) {
      updates.push(`diameter_mm = $${index++}`);
      values.push(diameterMm ?? null);
    }

    if (weightKgPerM !== undefined) {
      updates.push(`weight_kg_per_m = $${index++}`);
      values.push(weightKgPerM ?? null);
    }

    updates.push(`updated_at = NOW()`);

    try {
      const result = await pool.query<CableTypeRow>(
        `
          UPDATE cable_types
          SET ${updates.join(', ')}
          WHERE id = $${index}
            AND project_id = $${index + 1}
          RETURNING
            id,
            project_id,
            name,
            purpose,
            diameter_mm,
            weight_kg_per_m,
            created_at,
            updated_at;
        `,
        [...values, cableTypeId, projectId]
      );

      const cableType = result.rows[0];

      if (!cableType) {
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      res.json({ cableType: mapCableTypeRow(cableType) });
    } catch (error) {
      console.error('Update cable type error', error);
      res.status(500).json({ error: 'Failed to update cable type' });
    }
  }
);

cableTypesRouter.delete(
  '/:cableTypeId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId } = req.params;

    if (!projectId || !cableTypeId) {
      res
        .status(400)
        .json({ error: 'Project ID and cable type ID are required' });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
    } catch (error) {
      console.error('Verify project for cable type delete error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    try {
      const result = await pool.query(
        `
          DELETE FROM cable_types
          WHERE id = $1
            AND project_id = $2;
        `,
        [cableTypeId, projectId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete cable type error', error);
      res.status(500).json({ error: 'Failed to delete cable type' });
    }
  }
);

cableTypesRouter.post(
  '/import',
  authenticate,
  requireAdmin,
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
    } catch (error) {
      console.error('Verify project for cable type import error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

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
        res
          .status(400)
          .json({ error: 'The workbook does not contain any sheets' });
        return;
      }

      worksheet = workbook.Sheets[sheetName];
    } catch (error) {
      console.error('Read cable import workbook error', error);
      res.status(400).json({ error: 'Failed to read Excel workbook' });
      return;
    }

    type CableImportRow = Record<string, unknown>;

    const rows = XLSX.utils.sheet_to_json<CableImportRow>(worksheet, {
      defval: '',
      raw: false
    });

    const summary = {
      inserted: 0,
      updated: 0,
      skipped: 0
    };

    const prepared: Array<{
      key: string;
      name: string;
      purpose: string | null;
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

      const normalised = text.replace(',', '.');
      const parsed = Number(normalised);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const readString = (raw: unknown): string | null =>
      raw === undefined || raw === null
        ? null
        : normalizeOptionalString(String(raw));

    for (const row of rows) {
      const rawName = row[CABLE_EXCEL_HEADERS.name] as unknown;
      const name =
        typeof rawName === 'number'
          ? String(rawName)
          : String(rawName ?? '').trim();

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
        purpose: readString(row[CABLE_EXCEL_HEADERS.purpose]),
        diameter: readNumeric(row[CABLE_EXCEL_HEADERS.diameter]),
        weight: readNumeric(row[CABLE_EXCEL_HEADERS.weight])
      });
    }

    if (prepared.length === 0) {
      try {
        const existing = await pool.query<CableTypeRow>(
          `
            ${selectCableTypesQuery}
            WHERE project_id = $1
            ORDER BY name ASC;
          `,
          [projectId]
        );

        res.json({
          summary,
          cableTypes: existing.rows.map(mapCableTypeRow)
        });
      } catch (error) {
        console.error('Fetch cable types after empty import error', error);
        res.status(500).json({
          error: 'No rows imported and failed to fetch existing cable types',
          summary
        });
      }
      return;
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const existingResult =
        prepared.length > 0
          ? await client.query<CableTypeRow>(
              `
                ${selectCableTypesQuery}
                WHERE project_id = $1
                  AND lower(name) = ANY($2::text[]);
              `,
              [projectId, prepared.map((row) => row.key)]
            )
          : { rows: [] as CableTypeRow[] };

      const existingMap = new Map<string, CableTypeRow>();

      for (const existing of existingResult.rows) {
        existingMap.set(existing.name.toLowerCase(), existing);
      }

      for (const row of prepared) {
        const existing = existingMap.get(row.key);

        if (existing) {
          await client.query(
            `
              UPDATE cable_types
              SET
                purpose = $1,
                diameter_mm = $2,
                weight_kg_per_m = $3,
                updated_at = NOW()
              WHERE id = $4;
            `,
            [row.purpose, row.diameter, row.weight, existing.id]
          );
          summary.updated += 1;
        } else {
          await client.query(
            `
              INSERT INTO cable_types (
                id,
                project_id,
                name,
                purpose,
                diameter_mm,
                weight_kg_per_m
              )
              VALUES ($1, $2, $3, $4, $5, $6);
            `,
            [
              randomUUID(),
              projectId,
              row.name,
              row.purpose,
              row.diameter,
              row.weight
            ]
          );
          summary.inserted += 1;
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Import cable types error', error);
      res.status(500).json({ error: 'Failed to import cable types' });
      return;
    } finally {
      client.release();
    }

    try {
      const refreshed = await pool.query<CableTypeRow>(
        `
          ${selectCableTypesQuery}
          WHERE project_id = $1
          ORDER BY name ASC;
        `,
        [projectId]
      );

      res.json({
        summary,
        cableTypes: refreshed.rows.map(mapCableTypeRow)
      });
    } catch (error) {
      console.error('Fetch cable types after import error', error);
      res.status(500).json({
        error: 'Cable types imported but failed to refresh list',
        summary
      });
    }
  }
);

cableTypesRouter.get(
  '/export',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const result = await pool.query<CableTypeRow>(
        `
          ${selectCableTypesQuery}
          WHERE project_id = $1
          ORDER BY name ASC;
        `,
        [projectId]
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cable Types', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      const columns = [
        { name: CABLE_EXCEL_HEADERS.name, key: 'type', width: 32 },
        { name: CABLE_EXCEL_HEADERS.purpose, key: 'purpose', width: 36 },
        { name: CABLE_EXCEL_HEADERS.diameter, key: 'diameter', width: 18 },
        { name: CABLE_EXCEL_HEADERS.weight, key: 'weight', width: 18 }
      ] as const;

      const rows = result.rows.map((row) => [
        row.name ?? '',
        row.purpose ?? '',
        row.diameter_mm !== null && row.diameter_mm !== ''
          ? Number(row.diameter_mm)
          : '',
        row.weight_kg_per_m !== null && row.weight_kg_per_m !== ''
          ? Number(row.weight_kg_per_m)
          : ''
      ]);

      const table = worksheet.addTable({
        name: 'CableTypes',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: {
          theme: 'TableStyleLight8',
          showFirstColumn: false,
          showLastColumn: false,
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
        if (column.key === 'diameter') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
        if (column.key === 'weight') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.000';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();

      const projectSegment = sanitizeFileSegment(project.project_number);
      const fileName = `${projectSegment}-cables.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileName}"`
      );

      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Export cable types error', error);
      res.status(500).json({ error: 'Failed to export cable types' });
    }
  }
);

export { cableTypesRouter };
