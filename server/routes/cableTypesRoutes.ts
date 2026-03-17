import { randomUUID } from 'crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import type { PoolClient } from 'pg';
import * as XLSX from 'xlsx';
import { pool } from '../db.js';
import {
  mapCableTypeDefaultMaterialRow,
  type CableTypeDefaultMaterialRow,
} from '../models/cableTypeDefaultMaterial.js';
import { mapCableTypeRow, toNumberOrNull } from '../models/cableType.js';
import type { CableTypeRow } from '../models/cableType.js';
import { mapMaterialCableTypeRow, type MaterialCableTypeRow } from '../models/materialCableType.js';
import { authenticate, requireAdmin } from '../middleware.js';
import { ensureProjectExists } from '../services/projectService.js';
import {
  createCableTypeDefaultMaterialSchema,
  createCableTypeSchema,
  updateCableTypeDefaultMaterialSchema,
  updateCableTypeSchema,
} from '../validators.js';

const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE },
});

const CABLE_EXCEL_HEADERS = {
  name: 'Type',
  purpose: 'Purpose',
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

const selectCableTypeDefaultMaterialsQuery = `
  SELECT
    id,
    cable_type_id,
    name,
    quantity,
    unit,
    remarks,
    created_at,
    updated_at
  FROM cable_type_default_materials
`;

type MaterialCableTypeMatchRow = {
  name: string;
  purpose: string | null;
  diameter_mm: string | number | null;
  weight_kg_per_m: string | number | null;
};

type MaterialCableInstallationMaterialMatchRow = {
  type: string;
};

type ProjectCableTypeNameRow = {
  id: string;
  name: string;
};

type Queryable = Pick<PoolClient, 'query'>;

const selectMaterialCableTypesForProjectQuery = `
  SELECT
    name,
    purpose,
    diameter_mm,
    weight_kg_per_m
  FROM material_cable_types
`;

const selectMaterialCableTypeDetailsForProjectQuery = `
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

const selectMaterialCableInstallationMaterialsForProjectQuery = `
  SELECT
    type
  FROM material_cable_installation_materials
`;

const createMaterialCableTypeNotFoundPayload = (name: string) => ({
  fieldErrors: {
    name: [`Cable type "${name}" was not found in materials.`],
  },
});

const createMaterialCableInstallationMaterialNotFoundPayload = (name: string) => ({
  fieldErrors: {
    name: [`Cable installation material "${name}" was not found in materials.`],
  },
});

const formatMissingMaterialCableTypesError = (names: string[]): string => {
  const label = names.length === 1 ? 'Cable type' : 'Cable types';
  return `${label} not found in materials: ${names.join(', ')}.`;
};

const findMaterialCableTypeByName = async (
  queryable: Queryable,
  name: string,
): Promise<MaterialCableTypeMatchRow | null> => {
  const result = await queryable.query<MaterialCableTypeMatchRow>(
    `
      ${selectMaterialCableTypesForProjectQuery}
      WHERE lower(name) = lower($1)
      LIMIT 1;
    `,
    [name],
  );

  return result.rows[0] ?? null;
};

const findMaterialCableInstallationMaterialByType = async (
  queryable: Queryable,
  type: string,
): Promise<MaterialCableInstallationMaterialMatchRow | null> => {
  const result = await queryable.query<MaterialCableInstallationMaterialMatchRow>(
    `
      ${selectMaterialCableInstallationMaterialsForProjectQuery}
      WHERE lower(type) = lower($1)
      LIMIT 1;
    `,
    [type],
  );

  return result.rows[0] ?? null;
};

const findMaterialCableTypesByKeys = async (
  queryable: Queryable,
  keys: string[],
): Promise<Map<string, MaterialCableTypeMatchRow>> => {
  if (keys.length === 0) {
    return new Map<string, MaterialCableTypeMatchRow>();
  }

  const result = await queryable.query<MaterialCableTypeMatchRow>(
    `
      ${selectMaterialCableTypesForProjectQuery}
      WHERE lower(name) = ANY($1::text[]);
    `,
    [keys],
  );

  const materialCableTypes = new Map<string, MaterialCableTypeMatchRow>();

  for (const materialCableType of result.rows) {
    materialCableTypes.set(materialCableType.name.toLowerCase(), materialCableType);
  }

  return materialCableTypes;
};

const findProjectCableTypeById = async (
  queryable: Queryable,
  projectId: string,
  cableTypeId: string,
): Promise<CableTypeRow | null> => {
  const result = await queryable.query<CableTypeRow>(
    `
      ${selectCableTypesQuery}
      WHERE project_id = $1
        AND id = $2
      LIMIT 1;
    `,
    [projectId, cableTypeId],
  );

  return result.rows[0] ?? null;
};

const findMaterialCableTypeDetailsByName = async (
  queryable: Queryable,
  name: string,
): Promise<MaterialCableTypeRow | null> => {
  const result = await queryable.query<MaterialCableTypeRow>(
    `
      ${selectMaterialCableTypeDetailsForProjectQuery}
      WHERE lower(name) = lower($1)
      LIMIT 1;
    `,
    [name],
  );

  return result.rows[0] ?? null;
};

const listCableTypeDefaultMaterials = async (
  queryable: Queryable,
  cableTypeId: string,
): Promise<CableTypeDefaultMaterialRow[]> => {
  const result = await queryable.query<CableTypeDefaultMaterialRow>(
    `
      ${selectCableTypeDefaultMaterialsQuery}
      WHERE cable_type_id = $1
      ORDER BY lower(name) ASC, created_at ASC;
    `,
    [cableTypeId],
  );

  return result.rows;
};

const cableTypesRouter = Router({ mergeParams: true });

cableTypesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
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
      [projectId],
    );

    res.json({ cableTypes: result.rows.map(mapCableTypeRow) });
  } catch (error) {
    console.error('List cable types error', error);
    res.status(500).json({ error: 'Failed to fetch cable types' });
  }
});

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

    const { name } = parseResult.data;

    try {
      const materialCableType = await findMaterialCableTypeByName(pool, name);

      if (!materialCableType) {
        res.status(400).json({
          error: createMaterialCableTypeNotFoundPayload(name.trim()),
        });
        return;
      }

      const duplicateResult = await pool.query<{ id: string }>(
        `
          SELECT id
          FROM cable_types
          WHERE project_id = $1
            AND lower(name) = lower($2)
          LIMIT 1;
        `,
        [projectId, name],
      );

      if (duplicateResult.rowCount > 0) {
        res.status(409).json({
          error: 'A cable type with this name already exists for the project',
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
          materialCableType.name,
          normalizeOptionalString(materialCableType.purpose ?? null),
          toNumberOrNull(materialCableType.diameter_mm),
          toNumberOrNull(materialCableType.weight_kg_per_m),
        ],
      );

      res.status(201).json({ cableType: mapCableTypeRow(result.rows[0]) });
    } catch (error) {
      console.error('Create cable type error', error);
      res.status(500).json({ error: 'Failed to create cable type' });
    }
  },
);

cableTypesRouter.patch(
  '/:cableTypeId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId } = req.params;

    if (!projectId || !cableTypeId) {
      res.status(400).json({ error: 'Project ID and cable type ID are required' });
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

    const { name } = parseResult.data;

    try {
      const existingCableTypeResult = await pool.query<ProjectCableTypeNameRow>(
        `
          SELECT id, name
          FROM cable_types
          WHERE id = $1
            AND project_id = $2
          LIMIT 1;
        `,
        [cableTypeId, projectId],
      );

      const existingCableType = existingCableTypeResult.rows[0];

      if (!existingCableType) {
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      const materialCableTypeName = name?.trim() || existingCableType.name;
      const materialCableType = await findMaterialCableTypeByName(pool, materialCableTypeName);

      if (!materialCableType) {
        res.status(400).json({
          error: createMaterialCableTypeNotFoundPayload(materialCableTypeName),
        });
        return;
      }

      const duplicateResult = await pool.query<{ id: string }>(
        `
          SELECT id
          FROM cable_types
          WHERE project_id = $1
            AND lower(name) = lower($2)
            AND id <> $3
          LIMIT 1;
        `,
        [projectId, materialCableType.name, cableTypeId],
      );

      if (duplicateResult.rowCount > 0) {
        res.status(409).json({
          error: 'A cable type with this name already exists for the project',
        });
        return;
      }

      const result = await pool.query<CableTypeRow>(
        `
          UPDATE cable_types
          SET
            name = $1,
            purpose = $2,
            diameter_mm = $3,
            weight_kg_per_m = $4,
            updated_at = NOW()
          WHERE id = $5
            AND project_id = $6
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
          materialCableType.name,
          normalizeOptionalString(materialCableType.purpose ?? null),
          toNumberOrNull(materialCableType.diameter_mm),
          toNumberOrNull(materialCableType.weight_kg_per_m),
          cableTypeId,
          projectId,
        ],
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
  },
);

cableTypesRouter.delete(
  '/:cableTypeId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId } = req.params;

    if (!projectId || !cableTypeId) {
      res.status(400).json({ error: 'Project ID and cable type ID are required' });
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
        [cableTypeId, projectId],
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
  },
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
        res.status(400).json({ error: 'The workbook does not contain any sheets' });
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
    }> = [];

    const seenKeys = new Set<string>();

    for (const row of rows) {
      const rawName = row[CABLE_EXCEL_HEADERS.name] as unknown;
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
          [projectId],
        );

        res.json({
          summary,
          cableTypes: existing.rows.map(mapCableTypeRow),
        });
      } catch (error) {
        console.error('Fetch cable types after empty import error', error);
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

      const materialCableTypes = await findMaterialCableTypesByKeys(
        client,
        prepared.map((row) => row.key),
      );

      const missingMaterialCableTypes = prepared
        .filter((row) => !materialCableTypes.has(row.key))
        .map((row) => row.name);

      if (missingMaterialCableTypes.length > 0) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: formatMissingMaterialCableTypesError(missingMaterialCableTypes),
        });
        return;
      }

      const existingResult =
        prepared.length > 0
          ? await client.query<CableTypeRow>(
              `
                ${selectCableTypesQuery}
                WHERE project_id = $1
                  AND lower(name) = ANY($2::text[]);
              `,
              [projectId, prepared.map((row) => row.key)],
            )
          : { rows: [] as CableTypeRow[] };

      const existingMap = new Map<string, CableTypeRow>();

      for (const existing of existingResult.rows) {
        existingMap.set(existing.name.toLowerCase(), existing);
      }

      for (const row of prepared) {
        const existing = existingMap.get(row.key);
        const materialCableType = materialCableTypes.get(row.key);

        if (!materialCableType) {
          continue;
        }

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
            [
              normalizeOptionalString(materialCableType.purpose ?? null),
              toNumberOrNull(materialCableType.diameter_mm),
              toNumberOrNull(materialCableType.weight_kg_per_m),
              existing.id,
            ],
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
              materialCableType.name,
              normalizeOptionalString(materialCableType.purpose ?? null),
              toNumberOrNull(materialCableType.diameter_mm),
              toNumberOrNull(materialCableType.weight_kg_per_m),
            ],
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
        [projectId],
      );

      res.json({
        summary,
        cableTypes: refreshed.rows.map(mapCableTypeRow),
      });
    } catch (error) {
      console.error('Fetch cable types after import error', error);
      res.status(500).json({
        error: 'Cable types imported but failed to refresh list',
        summary,
      });
    }
  },
);

cableTypesRouter.get(
  '/:cableTypeId/details',
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId } = req.params;

    if (!projectId || !cableTypeId) {
      res.status(400).json({ error: 'Project ID and cable type ID are required' });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const cableType = await findProjectCableTypeById(pool, projectId, cableTypeId);

      if (!cableType) {
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      const [materialCableType, defaultMaterials, cableCountResult] = await Promise.all([
        findMaterialCableTypeDetailsByName(pool, cableType.name),
        listCableTypeDefaultMaterials(pool, cableTypeId),
        pool.query<{ count: number }>(
          `
            SELECT COUNT(*)::int AS count
            FROM cables
            WHERE project_id = $1
              AND cable_type_id = $2;
          `,
          [projectId, cableTypeId],
        ),
      ]);

      res.json({
        cableType: mapCableTypeRow(cableType),
        materialCableType: materialCableType ? mapMaterialCableTypeRow(materialCableType) : null,
        defaultMaterials: defaultMaterials.map(mapCableTypeDefaultMaterialRow),
        cableCount: cableCountResult.rows[0]?.count ?? 0,
      });
    } catch (error) {
      console.error('Fetch cable type details error', error);
      res.status(500).json({ error: 'Failed to fetch cable type details' });
    }
  },
);

cableTypesRouter.post(
  '/:cableTypeId/default-materials',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId } = req.params;

    if (!projectId || !cableTypeId) {
      res.status(400).json({ error: 'Project ID and cable type ID are required' });
      return;
    }

    const parseResult = createCableTypeDefaultMaterialSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const cableType = await findProjectCableTypeById(pool, projectId, cableTypeId);

      if (!cableType) {
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      const { name, quantity, unit, remarks } = parseResult.data;
      const materialCableInstallationMaterial = await findMaterialCableInstallationMaterialByType(
        pool,
        name,
      );

      if (!materialCableInstallationMaterial) {
        res.status(400).json({
          error: createMaterialCableInstallationMaterialNotFoundPayload(name.trim()),
        });
        return;
      }

      const result = await pool.query<CableTypeDefaultMaterialRow>(
        `
          INSERT INTO cable_type_default_materials (
            id,
            cable_type_id,
            name,
            quantity,
            unit,
            remarks
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING
            id,
            cable_type_id,
            name,
            quantity,
            unit,
            remarks,
            created_at,
            updated_at;
        `,
        [
          randomUUID(),
          cableTypeId,
          materialCableInstallationMaterial.type,
          quantity ?? null,
          normalizeOptionalString(unit ?? null),
          normalizeOptionalString(remarks ?? null),
        ],
      );

      res.status(201).json({
        defaultMaterial: mapCableTypeDefaultMaterialRow(result.rows[0]),
      });
    } catch (error) {
      console.error('Create cable type default material error', error);
      res.status(500).json({ error: 'Failed to create default material' });
    }
  },
);

cableTypesRouter.patch(
  '/:cableTypeId/default-materials/:defaultMaterialId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId, defaultMaterialId } = req.params;

    if (!projectId || !cableTypeId || !defaultMaterialId) {
      res.status(400).json({
        error: 'Project ID, cable type ID, and default material ID are required',
      });
      return;
    }

    const parseResult = updateCableTypeDefaultMaterialSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const cableType = await findProjectCableTypeById(pool, projectId, cableTypeId);

      if (!cableType) {
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      const { name, quantity, unit, remarks } = parseResult.data;

      const fields: string[] = [];
      const values: Array<string | number | null> = [];
      let index = 1;

      if (name !== undefined) {
        const materialCableInstallationMaterial = await findMaterialCableInstallationMaterialByType(
          pool,
          name,
        );

        if (!materialCableInstallationMaterial) {
          res.status(400).json({
            error: createMaterialCableInstallationMaterialNotFoundPayload(name.trim()),
          });
          return;
        }

        fields.push(`name = $${index++}`);
        values.push(materialCableInstallationMaterial.type);
      }

      if (quantity !== undefined) {
        fields.push(`quantity = $${index++}`);
        values.push(quantity ?? null);
      }

      if (unit !== undefined) {
        fields.push(`unit = $${index++}`);
        values.push(normalizeOptionalString(unit ?? null));
      }

      if (remarks !== undefined) {
        fields.push(`remarks = $${index++}`);
        values.push(normalizeOptionalString(remarks ?? null));
      }

      fields.push('updated_at = NOW()');

      const result = await pool.query<CableTypeDefaultMaterialRow>(
        `
          UPDATE cable_type_default_materials
          SET ${fields.join(', ')}
          WHERE id = $${index}
            AND cable_type_id = $${index + 1}
          RETURNING
            id,
            cable_type_id,
            name,
            quantity,
            unit,
            remarks,
            created_at,
            updated_at;
        `,
        [...values, defaultMaterialId, cableTypeId],
      );

      const defaultMaterial = result.rows[0];

      if (!defaultMaterial) {
        res.status(404).json({ error: 'Default material not found' });
        return;
      }

      res.json({
        defaultMaterial: mapCableTypeDefaultMaterialRow(defaultMaterial),
      });
    } catch (error) {
      console.error('Update cable type default material error', error);
      res.status(500).json({ error: 'Failed to update default material' });
    }
  },
);

cableTypesRouter.delete(
  '/:cableTypeId/default-materials/:defaultMaterialId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId, defaultMaterialId } = req.params;

    if (!projectId || !cableTypeId || !defaultMaterialId) {
      res.status(400).json({
        error: 'Project ID, cable type ID, and default material ID are required',
      });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const cableType = await findProjectCableTypeById(pool, projectId, cableTypeId);

      if (!cableType) {
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      const result = await pool.query(
        `
          DELETE FROM cable_type_default_materials
          WHERE id = $1
            AND cable_type_id = $2;
        `,
        [defaultMaterialId, cableTypeId],
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Default material not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete cable type default material error', error);
      res.status(500).json({ error: 'Failed to delete default material' });
    }
  },
);

cableTypesRouter.get(
  '/template',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cable Types', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      const columns = [
        { name: CABLE_EXCEL_HEADERS.name, key: 'type', width: 32 },
        { name: CABLE_EXCEL_HEADERS.purpose, key: 'purpose', width: 36 },
        { name: CABLE_EXCEL_HEADERS.diameter, key: 'diameter', width: 18 },
        { name: CABLE_EXCEL_HEADERS.weight, key: 'weight', width: 18 },
      ] as const;

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
          showColumnStripes: true,
        },
        columns: columns.map((column) => ({
          name: column.name,
          filterButton: true,
        })),
        rows: [['', '', '', '']],
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

      const fileName = 'cable-types-template.xlsx';

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Generate cable types template error', error);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  },
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
        [projectId],
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cable Types', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      const columns = [
        { name: CABLE_EXCEL_HEADERS.name, key: 'type', width: 32 },
        { name: CABLE_EXCEL_HEADERS.purpose, key: 'purpose', width: 36 },
        { name: CABLE_EXCEL_HEADERS.diameter, key: 'diameter', width: 18 },
        { name: CABLE_EXCEL_HEADERS.weight, key: 'weight', width: 18 },
      ] as const;

      const rows = result.rows.map((row: CableTypeRow) => [
        row.name ?? '',
        row.purpose ?? '',
        row.diameter_mm !== null && row.diameter_mm !== '' ? Number(row.diameter_mm) : '',
        row.weight_kg_per_m !== null && row.weight_kg_per_m !== ''
          ? Number(row.weight_kg_per_m)
          : '',
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
          showColumnStripes: true,
        },
        columns: columns.map((column) => ({
          name: column.name,
          filterButton: true,
        })),
        rows: rows.length > 0 ? rows : [['', '', '', '']],
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
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Export cable types error', error);
      res.status(500).json({ error: 'Failed to export cable types' });
    }
  },
);

export { cableTypesRouter };
