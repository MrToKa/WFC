import { withTransaction } from '../utils/transaction.js';
import { randomUUID } from 'crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { uploadExcelFile } from '../utils/excelUpload.js';
import type { PoolClient } from 'pg';
import * as XLSX from 'xlsx';
import { pool } from '../db.js';
import {
  beginProjectMaterialMutation,
  completeProjectMaterialMutation,
} from '../services/projectMaterialMutationService.js';
import {
  MutationError,
  getMutationRevision,
  respondToMutationError,
} from '../services/mutationService.js';
import {
  mapCableTypeDefaultMaterialRow,
  type CableTypeDefaultMaterialRow,
} from '../models/cableTypeDefaultMaterial.js';
import { mapCableTypeRow, toNumberOrNull } from '../models/cableType.js';
import type { CableTypeRow } from '../models/cableType.js';
import { authenticate, requireProjectEditor } from '../middleware.js';
import { ensureProjectExists } from '../services/projectService.js';
import {
  excelImportError,
  getExcelRowNumber,
  readExcelImportRows,
  validateExcelImport,
} from '../utils/excelImport.js';
import { snapshotStandardMaterialsToProjectCableType } from '../services/projectCableTypeSnapshotService.js';
import {
  captureInstallationMaterial,
  replaceInheritedCableMaterials,
} from '../services/cableMaterialSnapshotService.js';
import {
  buildNamedCatalogLookup,
  findNamedCatalogMatch,
  type NamedCatalogLookup,
} from '../utils/catalogNameMatching.js';
import {
  createCableTypeDefaultMaterialSchema,
  createCableTypeSchema,
  updateCableTypeDefaultMaterialSchema,
  updateCableTypeSchema,
} from '../validators.js';

const CABLE_EXCEL_HEADERS = {
  name: 'Type',
  purpose: 'Purpose',
  diameter: 'Diameter [mm]',
  weight: 'Weight [kg/m]',
} as const;

const CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS = {
  material: 'Material',
  quantity: 'Quantity',
  unit: 'Unit',
  remarks: 'Remarks',
} as const;

const CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADER_ALIASES = {
  material: [CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.material],
  quantity: [CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.quantity],
  unit: [CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.unit],
  remarks: [CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.remarks],
} as const;

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

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

const normalizeExcelHeader = (value: string): string => value.trim().toLowerCase();

const sanitizeFileSegment = (value: string | null | undefined): string =>
  (typeof value === 'string' ? value.trim() : '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

const selectCableTypesQuery = `
  SELECT
    id,
    project_id,
    name,
    purpose,
    material,
    description,
    manufacturer,
    part_no,
    remarks,
    diameter_mm,
    weight_kg_per_m,
    source_material_cable_type_id,
    material_snapshot,
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
    source_kind,
    source_master_material_id,
    source_standard_material_assignment_ids,
    current_material_id,
    material_snapshot,
    inherited_override,
    created_at,
    updated_at
  FROM cable_type_default_materials
`;

type MaterialCableTypeMatchRow = {
  id: string;
  name: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  part_no: string | null;
  remarks: string | null;
  diameter_mm: string | number | null;
  weight_kg_per_m: string | number | null;
  [key: string]: unknown;
};

type MaterialCableInstallationMaterialMatchRow = {
  type: string;
  id: string;
  [key: string]: unknown;
};

type MaterialCableInstallationMaterialCatalogRow = {
  type: string;
  name: string;
};

type ProjectCableTypeNameRow = {
  id: string;
  name: string;
  source_material_cable_type_id: string | null;
};

type Queryable = Pick<PoolClient, 'query'>;

const selectMaterialCableTypesForProjectQuery = `
  SELECT *
  FROM (SELECT * FROM material_cable_types WHERE obsolete_at IS NULL) material_cable_types
`;

const selectMaterialCableInstallationMaterialsForProjectQuery = `
  SELECT *
  FROM (SELECT * FROM material_cable_installation_materials WHERE obsolete_at IS NULL) material_cable_installation_materials
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

const findMaterialCableTypeByName = async (
  queryable: Queryable,
  name: string,
  sourceMaterialCableTypeId?: string,
): Promise<MaterialCableTypeMatchRow | null> => {
  if (sourceMaterialCableTypeId) {
    const exactResult = await queryable.query<MaterialCableTypeMatchRow>(
      `${selectMaterialCableTypesForProjectQuery} WHERE id = $1 LIMIT 1`,
      [sourceMaterialCableTypeId],
    );
    return exactResult.rows[0] ?? null;
  }
  const result = await queryable.query<MaterialCableTypeMatchRow>(
    `
      ${selectMaterialCableTypesForProjectQuery}
      ORDER BY name ASC;
    `,
  );

  return findNamedCatalogMatch(
    buildNamedCatalogLookup<MaterialCableTypeMatchRow>(result.rows),
    name,
  );
};

const findMaterialCableInstallationMaterialByType = async (
  queryable: Queryable,
  type: string,
  currentMaterialId?: string,
): Promise<MaterialCableInstallationMaterialMatchRow | null> => {
  const result = await queryable.query<MaterialCableInstallationMaterialMatchRow>(
    `
      ${selectMaterialCableInstallationMaterialsForProjectQuery}
      WHERE ${currentMaterialId ? 'id = $1' : 'lower(type) = lower($1)'}
      LIMIT 1;
    `,
    [currentMaterialId ?? type],
  );

  return result.rows[0] ?? null;
};

const listMaterialCableInstallationMaterialCatalog = async (
  queryable: Queryable,
): Promise<MaterialCableInstallationMaterialCatalogRow[]> => {
  const result = await queryable.query<MaterialCableInstallationMaterialCatalogRow>(
    `
      SELECT
        type,
        type AS name
      FROM (SELECT * FROM material_cable_installation_materials WHERE obsolete_at IS NULL) material_cable_installation_materials
      ORDER BY type ASC;
    `,
  );

  return result.rows;
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
      ORDER BY name ASC;
    `,
  );

  const materialCableTypeLookup = buildNamedCatalogLookup<MaterialCableTypeMatchRow>(result.rows);
  const materialCableTypes = new Map<string, MaterialCableTypeMatchRow>();

  for (const key of keys) {
    const materialCableType = findNamedCatalogMatch(materialCableTypeLookup, key);

    if (materialCableType) {
      materialCableTypes.set(key, materialCableType);
    }
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
    const data = await withTransaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

      const project = await ensureProjectExists(projectId, client);

      if (!project) {
        throw new MutationError(404, 'RESOURCE_NOT_FOUND', 'Project not found');
      }

      const mutationRevision = await getMutationRevision(client, 'project-materials', projectId);
      const result = await client.query<CableTypeRow>(
        `
          ${selectCableTypesQuery}
          WHERE project_id = $1
          ORDER BY name ASC;
        `,
        [projectId],
      );

      return { cableTypes: result.rows.map(mapCableTypeRow), mutationRevision };
    });
    res.json(data);
  } catch (error) {
    if (respondToMutationError(error, res)) return;
    console.error('List cable types error', error);
    res.status(500).json({ error: 'Failed to fetch cable types' });
  }
});

cableTypesRouter.post(
  '/',
  authenticate,
  requireProjectEditor,
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
      if (respondToMutationError(error, res)) return;
      console.error('Verify project for cable type create error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    const parseResult = createCableTypeSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const { name, sourceMaterialCableTypeId } = parseResult.data;
    let client: PoolClient | undefined;

    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const mutation = await beginProjectMaterialMutation(client, req, res);
      if (!mutation) return;
      const materialCableType = await findMaterialCableTypeByName(
        client,
        name,
        sourceMaterialCableTypeId,
      );

      if (!materialCableType) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: createMaterialCableTypeNotFoundPayload(name.trim()),
        });
        return;
      }

      const duplicateResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM cable_types
          WHERE project_id = $1
            AND lower(name) = lower($2)
          LIMIT 1;
        `,
        [projectId, materialCableType.name],
      );

      if ((duplicateResult.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({
          error: 'A cable type with this name already exists for the project',
        });
        return;
      }

      const result = await client.query<CableTypeRow>(
        `
          INSERT INTO cable_types (
            id,
            project_id,
            name,
            purpose,
            material,
            description,
            manufacturer,
            part_no,
            remarks,
            diameter_mm,
            weight_kg_per_m,
            source_material_cable_type_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING
            id,
            project_id,
            name,
            purpose,
            material,
            description,
            manufacturer,
            part_no,
            remarks,
            diameter_mm,
            weight_kg_per_m,
            source_material_cable_type_id,
            created_at,
            updated_at;
        `,
        [
          randomUUID(),
          projectId,
          materialCableType.name,
          normalizeOptionalString(materialCableType.purpose ?? null),
          normalizeOptionalString(materialCableType.material ?? null),
          normalizeOptionalString(materialCableType.description ?? null),
          normalizeOptionalString(materialCableType.manufacturer ?? null),
          normalizeOptionalString(materialCableType.part_no ?? null),
          normalizeOptionalString(materialCableType.remarks ?? null),
          toNumberOrNull(materialCableType.diameter_mm),
          toNumberOrNull(materialCableType.weight_kg_per_m),
          materialCableType.id,
        ],
      );

      await snapshotStandardMaterialsToProjectCableType(
        client,
        result.rows[0].id,
        materialCableType.id,
        { replaceInherited: false },
      );
      await client.query('UPDATE cable_types SET material_snapshot = $2::jsonb WHERE id = $1', [
        result.rows[0].id,
        JSON.stringify(materialCableType),
      ]);
      await completeProjectMaterialMutation(
        client,
        mutation,
        projectId,
        res,
        { cableType: mapCableTypeRow(result.rows[0]) },
        201,
      );
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (respondToMutationError(error, res)) return;
      console.error('Create cable type error', error);
      res.status(500).json({ error: 'Failed to create cable type' });
    } finally {
      client?.release();
    }
  },
);

cableTypesRouter.patch(
  '/:cableTypeId',
  authenticate,
  requireProjectEditor,
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
      if (respondToMutationError(error, res)) return;
      console.error('Verify project for cable type update error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    const parseResult = updateCableTypeSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const { name, sourceMaterialCableTypeId } = parseResult.data;
    let client: PoolClient | undefined;

    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const mutation = await beginProjectMaterialMutation(client, req, res);
      if (!mutation) return;
      const existingCableTypeResult = await client.query<ProjectCableTypeNameRow>(
        `
          SELECT *
          FROM cable_types
          WHERE id = $1
            AND project_id = $2
          LIMIT 1 FOR UPDATE;
        `,
        [cableTypeId, projectId],
      );

      const existingCableType = existingCableTypeResult.rows[0];

      if (!existingCableType) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      // A save that does not select another identity must also work after catalog deletion.
      if (!sourceMaterialCableTypeId && (!name || name.trim() === existingCableType.name)) {
        await completeProjectMaterialMutation(client, mutation, projectId, res, {
          cableType: mapCableTypeRow(existingCableType as CableTypeRow),
        });
        return;
      }
      const materialCableTypeName = name?.trim() || existingCableType.name;
      const materialCableType = await findMaterialCableTypeByName(
        client,
        materialCableTypeName,
        sourceMaterialCableTypeId,
      );

      if (!materialCableType) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: createMaterialCableTypeNotFoundPayload(materialCableTypeName),
        });
        return;
      }

      // An unchanged selected identity is not an implicit catalog refresh.
      if (existingCableType.source_material_cable_type_id === materialCableType.id) {
        await completeProjectMaterialMutation(client, mutation, projectId, res, {
          cableType: mapCableTypeRow(existingCableType as CableTypeRow),
        });
        return;
      }

      const duplicateResult = await client.query<{ id: string }>(
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

      if ((duplicateResult.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({
          error: 'A cable type with this name already exists for the project',
        });
        return;
      }

      const result = await client.query<CableTypeRow>(
        `
          UPDATE cable_types
          SET
            name = $1,
            purpose = $2,
            material = $3,
            description = $4,
            manufacturer = $5,
            part_no = $6,
            remarks = $7,
            diameter_mm = $8,
            weight_kg_per_m = $9,
            source_material_cable_type_id = $10,
            updated_at = NOW()
          WHERE id = $11
            AND project_id = $12
          RETURNING
            id,
            project_id,
            name,
            purpose,
            material,
            description,
            manufacturer,
            part_no,
            remarks,
            diameter_mm,
            weight_kg_per_m,
            source_material_cable_type_id,
            created_at,
            updated_at;
        `,
        [
          materialCableType.name,
          normalizeOptionalString(materialCableType.purpose ?? null),
          normalizeOptionalString(materialCableType.material ?? null),
          normalizeOptionalString(materialCableType.description ?? null),
          normalizeOptionalString(materialCableType.manufacturer ?? null),
          normalizeOptionalString(materialCableType.part_no ?? null),
          normalizeOptionalString(materialCableType.remarks ?? null),
          toNumberOrNull(materialCableType.diameter_mm),
          toNumberOrNull(materialCableType.weight_kg_per_m),
          materialCableType.id,
          cableTypeId,
          projectId,
        ],
      );

      const cableType = result.rows[0];

      if (!cableType) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      if (existingCableType.source_material_cable_type_id !== materialCableType.id) {
        await snapshotStandardMaterialsToProjectCableType(
          client,
          cableTypeId,
          materialCableType.id,
          { replaceInherited: true },
        );
        const capturedDefaults = await listCableTypeDefaultMaterials(client, cableTypeId);
        const cables = await client.query<{ id: string }>(
          'SELECT id FROM cables WHERE cable_type_id = $1 ORDER BY id FOR UPDATE',
          [cableTypeId],
        );
        for (const cable of cables.rows) {
          await replaceInheritedCableMaterials(client, cable.id, capturedDefaults);
        }
      }
      await client.query('UPDATE cable_types SET material_snapshot = $2::jsonb WHERE id = $1', [
        cableTypeId,
        JSON.stringify(materialCableType),
      ]);
      await completeProjectMaterialMutation(client, mutation, projectId, res, {
        cableType: mapCableTypeRow(cableType),
      });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (respondToMutationError(error, res)) return;
      console.error('Update cable type error', error);
      res.status(500).json({ error: 'Failed to update cable type' });
    } finally {
      client?.release();
    }
  },
);

cableTypesRouter.delete(
  '/:cableTypeId',
  authenticate,
  requireProjectEditor,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId } = req.params;
    if (!projectId || !cableTypeId) {
      res.status(400).json({ error: 'Project and cable type identifiers are required' });
      return;
    }
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const mutation = await beginProjectMaterialMutation(client, req, res);
      if (!mutation) return;
      const existing = await client.query(
        'SELECT id FROM cable_types WHERE id = $1 AND project_id = $2 FOR UPDATE',
        [cableTypeId, projectId],
      );
      if (!existing.rows[0]) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }
      const used = await client.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM cables WHERE cable_type_id = $1',
        [cableTypeId],
      );
      if (Number(used.rows[0]?.count ?? 0) > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({
          error: 'Reassign the cables using this project cable type before deleting it.',
          code: 'CABLE_TYPE_IN_USE',
          cableCount: Number(used.rows[0].count),
        });
        return;
      }
      await client.query('DELETE FROM cable_types WHERE id = $1 AND project_id = $2', [
        cableTypeId,
        projectId,
      ]);
      await completeProjectMaterialMutation(client, mutation, projectId, res, {});
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (respondToMutationError(error, res)) return;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['23503', '23001'].includes(String(error.code))
      ) {
        res.status(409).json({
          error: 'Reassign the cables using this project cable type before deleting it.',
          code: 'CABLE_TYPE_IN_USE',
        });
        return;
      }
      console.error('Delete cable type error', error);
      res.status(500).json({ error: 'Failed to delete cable type' });
    } finally {
      client?.release();
    }
  },
);

cableTypesRouter.post(
  '/import',
  authenticate,
  requireProjectEditor,
  uploadExcelFile,
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
      if (respondToMutationError(error, res)) return;
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
      if (respondToMutationError(error, res)) return;
      console.error('Read cable import workbook error', error);
      res.status(400).json({ error: 'Failed to read Excel workbook' });
      return;
    }

    const rows = readExcelImportRows(worksheet, []);

    const issues = validateExcelImport(worksheet, [
      { headers: [CABLE_EXCEL_HEADERS.name], required: true, maxLength: 200, unique: true },
    ]);

    if (issues.length > 0) {
      res.status(400).json(excelImportError(issues));
      return;
    }

    const summary = {
      inserted: 0,
      updated: 0,
      skipped: 0,
    };

    const prepared: Array<{
      rowNumber: number;
      key: string;
      name: string;
    }> = [];

    const seenKeys = new Set<string>();

    for (const [index, row] of rows.entries()) {
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
        rowNumber: getExcelRowNumber(row, index),
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
        if (respondToMutationError(error, res)) return;
        console.error('Fetch cable types after empty import error', error);
        res.status(500).json({
          error: 'No rows imported and failed to fetch existing cable types',
          summary,
        });
      }
      return;
    }

    let client: PoolClient | undefined;

    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const mutation = await beginProjectMaterialMutation(client, req, res);
      if (!mutation) return;

      const materialCableTypes = await findMaterialCableTypesByKeys(
        client,
        prepared.map((row) => row.key),
      );

      const missingMaterialCableTypes = prepared
        .filter((row) => !materialCableTypes.has(row.key))
        .map((row) => ({
          row: row.rowNumber,
          column: CABLE_EXCEL_HEADERS.name,
          message: `Cable type "${row.name}" was not found in the material catalog. Add it to Materials first.`,
        }));

      if (missingMaterialCableTypes.length > 0) {
        await client.query('ROLLBACK');
        res.status(400).json(excelImportError(missingMaterialCableTypes));
        return;
      }

      // Different spellings may resolve to the same catalog entry. Reject these
      // before an insert can violate the project's unique cable type name.
      const seenMaterialIds = new Map<string, number>();
      for (const row of prepared) {
        const material = materialCableTypes.get(row.key)!;
        const firstRow = seenMaterialIds.get(material.id);
        if (firstRow !== undefined) {
          issues.push({
            row: row.rowNumber,
            column: CABLE_EXCEL_HEADERS.name,
            message: `Cable type "${material.name}" is already present in row ${firstRow}.`,
          });
        } else {
          seenMaterialIds.set(material.id, row.rowNumber);
        }
        // Use the catalog's canonical name for existing-row lookup as well as
        // inserts, so an imported alias updates the existing project type.
        row.key = material.name.toLowerCase();
        materialCableTypes.set(row.key, material);
      }
      if (issues.length > 0) {
        await client.query('ROLLBACK');
        res.status(400).json(excelImportError(issues));
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
          if (existing.source_material_cable_type_id === materialCableType.id) {
            summary.skipped += 1;
            continue;
          }
          await client.query(
            `
              UPDATE cable_types
              SET
                purpose = $1,
                material = $2,
                description = $3,
                manufacturer = $4,
                part_no = $5,
                remarks = $6,
                diameter_mm = $7,
                weight_kg_per_m = $8,
                source_material_cable_type_id = $9,
                updated_at = NOW()
              WHERE id = $10;
            `,
            [
              normalizeOptionalString(materialCableType.purpose ?? null),
              normalizeOptionalString(materialCableType.material ?? null),
              normalizeOptionalString(materialCableType.description ?? null),
              normalizeOptionalString(materialCableType.manufacturer ?? null),
              normalizeOptionalString(materialCableType.part_no ?? null),
              normalizeOptionalString(materialCableType.remarks ?? null),
              toNumberOrNull(materialCableType.diameter_mm),
              toNumberOrNull(materialCableType.weight_kg_per_m),
              materialCableType.id,
              existing.id,
            ],
          );
          if (existing.source_material_cable_type_id !== materialCableType.id) {
            await snapshotStandardMaterialsToProjectCableType(
              client,
              existing.id,
              materialCableType.id,
              { replaceInherited: true },
            );
            const capturedDefaults = await listCableTypeDefaultMaterials(client, existing.id);
            const cables = await client.query<{ id: string }>(
              'SELECT id FROM cables WHERE cable_type_id = $1 ORDER BY id FOR UPDATE',
              [existing.id],
            );
            for (const cable of cables.rows)
              await replaceInheritedCableMaterials(client, cable.id, capturedDefaults);
          }
          await client.query('UPDATE cable_types SET material_snapshot = $2::jsonb WHERE id = $1', [
            existing.id,
            JSON.stringify(materialCableType),
          ]);
          summary.updated += 1;
        } else {
          const cableTypeId = randomUUID();
          await client.query(
            `
              INSERT INTO cable_types (
                id,
                project_id,
                name,
                purpose,
                material,
                description,
                manufacturer,
                part_no,
                remarks,
                diameter_mm,
                weight_kg_per_m,
                source_material_cable_type_id
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
            `,
            [
              cableTypeId,
              projectId,
              materialCableType.name,
              normalizeOptionalString(materialCableType.purpose ?? null),
              normalizeOptionalString(materialCableType.material ?? null),
              normalizeOptionalString(materialCableType.description ?? null),
              normalizeOptionalString(materialCableType.manufacturer ?? null),
              normalizeOptionalString(materialCableType.part_no ?? null),
              normalizeOptionalString(materialCableType.remarks ?? null),
              toNumberOrNull(materialCableType.diameter_mm),
              toNumberOrNull(materialCableType.weight_kg_per_m),
              materialCableType.id,
            ],
          );
          await snapshotStandardMaterialsToProjectCableType(
            client,
            cableTypeId,
            materialCableType.id,
            { replaceInherited: false },
          );
          await client.query('UPDATE cable_types SET material_snapshot = $2::jsonb WHERE id = $1', [
            cableTypeId,
            JSON.stringify(materialCableType),
          ]);
          summary.inserted += 1;
        }
      }

      const refreshed = await client.query<CableTypeRow>(
        `
          ${selectCableTypesQuery}
          WHERE project_id = $1
          ORDER BY name ASC;
        `,
        [projectId],
      );

      await completeProjectMaterialMutation(client, mutation, projectId, res, {
        summary,
        cableTypes: refreshed.rows.map(mapCableTypeRow),
      });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (respondToMutationError(error, res)) return;
      console.error('Import cable types error', error);
      res.status(500).json({ error: 'Failed to import cable types' });
    } finally {
      client?.release();
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
      const data = await withTransaction(async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

        const mutationRevision = await getMutationRevision(client, 'project-materials', projectId);
        const project = await ensureProjectExists(projectId, client);

        if (!project) {
          throw new MutationError(404, 'RESOURCE_NOT_FOUND', 'Project not found');
        }

        const cableType = await findProjectCableTypeById(client, projectId, cableTypeId);

        if (!cableType) {
          throw new MutationError(404, 'RESOURCE_NOT_FOUND', 'Cable type not found');
        }

        const [defaultMaterials, cableCountResult] = await Promise.all([
          listCableTypeDefaultMaterials(client, cableTypeId),
          client.query<{ count: number }>(
            `
            SELECT COUNT(*)::int AS count
            FROM cables
            WHERE project_id = $1
              AND cable_type_id = $2;
          `,
            [projectId, cableTypeId],
          ),
        ]);

        return {
          cableType: mapCableTypeRow(cableType),
          mutationRevision,
          materialCableType: {
            material: cableType.material ?? null,
            manufacturer: cableType.manufacturer ?? null,
            partNo: cableType.part_no ?? null,
            description: cableType.description ?? null,
            remarks: cableType.remarks ?? null,
          },
          defaultMaterials: defaultMaterials.map(mapCableTypeDefaultMaterialRow),
          cableCount: cableCountResult.rows[0]?.count ?? 0,
        };
      });
      res.json(data);
    } catch (error) {
      if (respondToMutationError(error, res)) return;
      console.error('Fetch cable type details error', error);
      res.status(500).json({ error: 'Failed to fetch cable type details' });
    }
  },
);

cableTypesRouter.post(
  '/:cableTypeId/default-materials',
  authenticate,
  requireProjectEditor,
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

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const mutation = await beginProjectMaterialMutation(client, req, res);
      if (!mutation) return;
      const project = await ensureProjectExists(projectId);

      if (!project) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const cableType = await findProjectCableTypeById(client, projectId, cableTypeId);

      if (!cableType) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      const { name, quantity, unit, remarks, currentMaterialId } = parseResult.data;
      const materialCableInstallationMaterial = await findMaterialCableInstallationMaterialByType(
        client,
        name,
        currentMaterialId ?? undefined,
      );

      if (!materialCableInstallationMaterial) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: createMaterialCableInstallationMaterialNotFoundPayload(name.trim()),
        });
        return;
      }

      const result = await client.query<CableTypeDefaultMaterialRow>(
        `
          INSERT INTO cable_type_default_materials (
            id,
            cable_type_id,
            name,
            quantity,
            unit,
            remarks,
            source_kind, current_material_id, material_snapshot
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8::jsonb)
          RETURNING
            id,
            cable_type_id,
            name,
            quantity,
            unit,
            remarks,
            source_kind,
            source_master_material_id,
            source_standard_material_assignment_ids,
            current_material_id, material_snapshot, inherited_override,
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
          materialCableInstallationMaterial.id,
          JSON.stringify(captureInstallationMaterial(materialCableInstallationMaterial)),
        ],
      );

      await completeProjectMaterialMutation(
        client,
        mutation,
        projectId,
        res,
        {
          defaultMaterial: mapCableTypeDefaultMaterialRow(result.rows[0]),
        },
        201,
      );
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (respondToMutationError(error, res)) return;
      console.error('Create cable type default material error', error);
      res.status(500).json({ error: 'Failed to create default material' });
    } finally {
      client?.release();
    }
  },
);

cableTypesRouter.patch(
  '/:cableTypeId/default-materials/:defaultMaterialId',
  authenticate,
  requireProjectEditor,
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

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const mutation = await beginProjectMaterialMutation(client, req, res);
      if (!mutation) return;
      const project = await ensureProjectExists(projectId);

      if (!project) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const cableType = await findProjectCableTypeById(client, projectId, cableTypeId);

      if (!cableType) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      const { name, quantity, unit, remarks, currentMaterialId } = parseResult.data;
      const existingResult = await client.query<CableTypeDefaultMaterialRow>(
        'SELECT * FROM cable_type_default_materials WHERE id = $1 AND cable_type_id = $2 FOR UPDATE',
        [defaultMaterialId, cableTypeId],
      );
      const existing = existingResult.rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Default material not found' });
        return;
      }

      const fields: string[] = [];
      const values: Array<string | number | null> = [];
      let index = 1;

      if (
        (currentMaterialId && currentMaterialId !== existing.current_material_id) ||
        (name !== undefined && name !== existing.name)
      ) {
        const materialCableInstallationMaterial = await findMaterialCableInstallationMaterialByType(
          client,
          name ?? existing.name,
          currentMaterialId ?? undefined,
        );

        if (!materialCableInstallationMaterial) {
          await client.query('ROLLBACK');
          res.status(400).json({
            error: createMaterialCableInstallationMaterialNotFoundPayload(
              (name ?? existing.name).trim(),
            ),
          });
          return;
        }

        fields.push(`name = $${index++}`);
        values.push(materialCableInstallationMaterial.type);
        fields.push(`current_material_id = $${index++}`);
        values.push(materialCableInstallationMaterial.id);
        fields.push(`material_snapshot = $${index++}::jsonb`);
        values.push(
          JSON.stringify(
            captureInstallationMaterial(
              materialCableInstallationMaterial,
              existing.material_snapshot ?? null,
            ),
          ),
        );
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

      fields.push(
        "inherited_override = inherited_override OR source_kind = 'standard-material'",
        'updated_at = NOW()',
      );

      const result = await client.query<CableTypeDefaultMaterialRow>(
        `
          UPDATE cable_type_default_materials
          SET ${fields.join(', ')}
          WHERE id = $${index}
            AND cable_type_id = $${index + 1}
          RETURNING *;
        `,
        [...values, defaultMaterialId, cableTypeId],
      );

      const defaultMaterial = result.rows[0];

      if (!defaultMaterial) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Default material not found' });
        return;
      }

      await completeProjectMaterialMutation(client, mutation, projectId, res, {
        defaultMaterial: mapCableTypeDefaultMaterialRow(defaultMaterial),
      });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (respondToMutationError(error, res)) return;
      console.error('Update cable type default material error', error);
      res.status(500).json({ error: 'Failed to update default material' });
    } finally {
      client?.release();
    }
  },
);

cableTypesRouter.delete(
  '/:cableTypeId/default-materials/:defaultMaterialId',
  authenticate,
  requireProjectEditor,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId, defaultMaterialId } = req.params;

    if (!projectId || !cableTypeId || !defaultMaterialId) {
      res.status(400).json({
        error: 'Project ID, cable type ID, and default material ID are required',
      });
      return;
    }

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const mutation = await beginProjectMaterialMutation(client, req, res);
      if (!mutation) return;
      const project = await ensureProjectExists(projectId);

      if (!project) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const cableType = await findProjectCableTypeById(client, projectId, cableTypeId);

      if (!cableType) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      const result = await client.query(
        `
          DELETE FROM cable_type_default_materials
          WHERE id = $1
            AND cable_type_id = $2;
        `,
        [defaultMaterialId, cableTypeId],
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Default material not found' });
        return;
      }

      await completeProjectMaterialMutation(client, mutation, projectId, res, {});
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (respondToMutationError(error, res)) return;
      console.error('Delete cable type default material error', error);
      res.status(500).json({ error: 'Failed to delete default material' });
    } finally {
      client?.release();
    }
  },
);

cableTypesRouter.post(
  '/:cableTypeId/default-materials/import',
  authenticate,
  requireProjectEditor,
  uploadExcelFile,
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
    } catch (error) {
      if (respondToMutationError(error, res)) return;
      console.error('Verify project for cable type default material import error', error);
      res.status(500).json({ error: 'Failed to verify project cable type' });
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
      if (respondToMutationError(error, res)) return;
      console.error('Read cable type default material import workbook error', error);
      res.status(400).json({ error: 'Failed to read Excel workbook' });
      return;
    }

    const rawRows = XLSX.utils.sheet_to_json<(unknown | null)[]>(worksheet, {
      header: 1,
      raw: true,
      defval: null,
    });
    const headerRow = Array.isArray(rawRows[0]) ? rawRows[0] : [];
    const normalizedHeaders = new Set(
      headerRow
        .map((value) => normalizeExcelHeader(String(value ?? '')))
        .filter((value) => value !== ''),
    );
    const missingHeaders = [
      CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.material,
      CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.quantity,
      CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.unit,
    ].filter((header) => !normalizedHeaders.has(normalizeExcelHeader(header)));

    if (missingHeaders.length > 0) {
      res.status(400).json(
        excelImportError(
          missingHeaders.map((column) => ({
            row: worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']).s.r + 1 : 1,
            column,
            message: 'Required column is missing. Use the import template.',
          })),
        ),
      );
      return;
    }

    type CableTypeDefaultMaterialImportRow = Record<string, unknown>;

    // Default material templates historically accept trimmed, case-insensitive headers.
    const aliases = (name: string) => [
      name,
      ...headerRow
        .map((value) => String(value ?? ''))
        .filter((header) => normalizeExcelHeader(header) === normalizeExcelHeader(name)),
    ];
    const rows = readExcelImportRows(
      worksheet,
      aliases(CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.quantity),
    );
    const issues = validateExcelImport(worksheet, [
      {
        headers: aliases(CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.material),
        required: true,
        maxLength: 200,
      },
      {
        headers: aliases(CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.quantity),
        type: 'number',
        min: 0,
        max: 1_000_000,
      },
      {
        headers: aliases(CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.unit),
        values: ['pcs', 'meters', 'pcs/m'],
      },
      { headers: aliases(CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.remarks), maxLength: 2000 },
    ]);

    const readCell = (
      row: CableTypeDefaultMaterialImportRow,
      headers: readonly string[],
    ): unknown => {
      const normalizedAliasHeaders = new Set(headers.map(normalizeExcelHeader));

      for (const [header, value] of Object.entries(row)) {
        if (normalizedAliasHeaders.has(normalizeExcelHeader(header))) {
          return value;
        }
      }

      return undefined;
    };

    const hasCellValue = (value: unknown): boolean =>
      normalizeOptionalString(typeof value === 'number' ? String(value) : String(value ?? '')) !==
      null;

    const prepared: Array<{
      rowNumber: number;
      name: string;
      quantity: number | null;
      unit: string | null;
      remarks: string | null;
    }> = [];

    for (const [index, row] of rows.entries()) {
      const materialRaw = readCell(row, CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADER_ALIASES.material);
      const quantityRaw = readCell(row, CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADER_ALIASES.quantity);
      const unitRaw = readCell(row, CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADER_ALIASES.unit);
      const remarksRaw = readCell(row, CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADER_ALIASES.remarks);
      const rowNumber = getExcelRowNumber(row, index);
      const hasAnyValue = [materialRaw, quantityRaw, unitRaw, remarksRaw].some(hasCellValue);

      if (!hasAnyValue) {
        continue;
      }

      const name =
        typeof materialRaw === 'number' ? String(materialRaw) : String(materialRaw ?? '').trim();

      if (name === '') {
        continue;
      }

      const quantityText =
        typeof quantityRaw === 'number' ? String(quantityRaw) : String(quantityRaw ?? '').trim();
      const quantity = toNullableNumber(quantityRaw);

      if (quantityText !== '' && quantity === null) {
        continue;
      }

      if (quantity !== null && quantity < 0) {
        continue;
      }

      const unit = normalizeOptionalString(
        typeof unitRaw === 'number' ? String(unitRaw) : String(unitRaw ?? ''),
      );

      if (quantity !== null && unit === null) {
        issues.push({
          row: rowNumber,
          column: CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.unit,
          message: 'Unit is required when quantity is set.',
        });
      }

      if (quantity === null && unit !== null) {
        issues.push({
          row: rowNumber,
          column: CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.quantity,
          message: 'Quantity is required when unit is set.',
        });
      }

      prepared.push({
        rowNumber,
        name,
        quantity,
        unit,
        remarks: normalizeOptionalString(
          typeof remarksRaw === 'number' ? String(remarksRaw) : String(remarksRaw ?? ''),
        ),
      });
    }

    if (issues.length > 0) {
      res.status(400).json(excelImportError(issues));
      return;
    }

    if (prepared.length === 0) {
      res.status(400).json(
        excelImportError([
          {
            row: worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']).s.r + 2 : 2,
            column: 'Workbook',
            message: 'No default materials found in the workbook. Add at least one material row.',
          },
        ]),
      );
      return;
    }

    let materialLookup: NamedCatalogLookup<MaterialCableInstallationMaterialCatalogRow>;

    try {
      const materialCatalog = await listMaterialCableInstallationMaterialCatalog(pool);
      materialLookup = buildNamedCatalogLookup(materialCatalog);
    } catch (error) {
      if (respondToMutationError(error, res)) return;
      console.error('Fetch material catalog for cable type default material import error', error);
      res.status(500).json({ error: 'Failed to validate materials' });
      return;
    }

    const normalizedRows = prepared.map((row) => {
      const matchedMaterial = findNamedCatalogMatch(materialLookup, row.name);

      if (!matchedMaterial) {
        issues.push({
          row: row.rowNumber,
          column: CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.material,
          message: `Cable installation material "${row.name}" was not found in the material catalog. Add it to Materials first.`,
        });
        return row;
      }

      return {
        ...row,
        name: matchedMaterial.type,
      };
    });

    const seenRows = new Map<string, number>();
    for (const row of normalizedRows) {
      const key = JSON.stringify([row.name.toLowerCase(), row.quantity, row.unit, row.remarks]);
      const firstRow = seenRows.get(key);
      if (firstRow !== undefined) {
        issues.push({
          row: row.rowNumber,
          column: CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.material,
          message: `Duplicate material row; it already appears on row ${firstRow}.`,
        });
      } else {
        seenRows.set(key, row.rowNumber);
      }
    }

    if (issues.length > 0) {
      res.status(400).json(excelImportError(issues));
      return;
    }

    let client: PoolClient | undefined;

    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const mutation = await beginProjectMaterialMutation(client, req, res);
      if (!mutation) return;

      await client.query(
        "DELETE FROM cable_type_default_materials WHERE cable_type_id = $1 AND source_kind = 'manual'",
        [cableTypeId],
      );
      for (const row of normalizedRows) {
        const material = await findMaterialCableInstallationMaterialByType(client, row.name);
        if (!material) {
          await client.query('ROLLBACK');
          res
            .status(409)
            .json({ error: 'The material catalog changed. Reload and retry the import.' });
          return;
        }
        await client.query(
          `INSERT INTO cable_type_default_materials
            (id, cable_type_id, name, quantity, unit, remarks, source_kind, current_material_id, material_snapshot)
           VALUES ($1,$2,$3,$4,$5,$6,'manual',$7,$8::jsonb)`,
          [
            randomUUID(),
            cableTypeId,
            material.type,
            row.quantity,
            row.unit,
            row.remarks,
            material.id,
            JSON.stringify(captureInstallationMaterial(material)),
          ],
        );
      }
      const refreshed = await listCableTypeDefaultMaterials(client, cableTypeId);
      await completeProjectMaterialMutation(client, mutation, projectId, res, {
        summary: { imported: normalizedRows.length },
        defaultMaterials: refreshed.map(mapCableTypeDefaultMaterialRow),
      });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (respondToMutationError(error, res)) return;
      console.error('Import cable type default materials error', error);
      res.status(500).json({ error: 'Failed to import default materials' });
      return;
    } finally {
      client?.release();
    }
  },
);

cableTypesRouter.get(
  '/:cableTypeId/default-materials/export',
  authenticate,
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

      const defaultMaterials = await listCableTypeDefaultMaterials(pool, cableTypeId);
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Default Materials', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      const columns = [
        { name: CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.material, width: 36 },
        { name: CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.quantity, width: 18 },
        { name: CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.unit, width: 16 },
        { name: CABLE_TYPE_DEFAULT_MATERIAL_EXCEL_HEADERS.remarks, width: 40 },
      ] as const;

      const rows = defaultMaterials.map((row) => [
        row.name ?? '',
        row.quantity !== null && row.quantity !== '' ? Number(row.quantity) : '',
        row.unit ?? '',
        row.remarks ?? '',
      ]);

      const table = worksheet.addTable({
        name: 'CableTypeDefaultMaterials',
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
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const fileName = 'CablesAdditionalDefaultMaterials.xlsx';

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      res.send(Buffer.from(buffer));
    } catch (error) {
      if (respondToMutationError(error, res)) return;
      console.error('Export cable type default materials error', error);
      res.status(500).json({ error: 'Failed to export default materials' });
    }
  },
);

cableTypesRouter.get(
  '/template',
  authenticate,
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
      if (respondToMutationError(error, res)) return;
      console.error('Generate cable types template error', error);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  },
);

cableTypesRouter.get(
  '/export',
  authenticate,
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
      if (respondToMutationError(error, res)) return;
      console.error('Export cable types error', error);
      res.status(500).json({ error: 'Failed to export cable types' });
    }
  },
);

export { cableTypesRouter };
