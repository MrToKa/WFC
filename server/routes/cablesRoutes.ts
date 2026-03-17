import { randomUUID } from 'crypto';
import path from 'node:path';
import type { Request as ExpressRequest, Response } from 'express';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import type { PoolClient } from 'pg';
import * as XLSX from 'xlsx';

// Extend Request type to include params, body, query, and file
interface Request extends ExpressRequest {
  params: Record<string, string>;
  body: any;
  query: Record<string, any>;
  file?: Express.Multer.File;
}
import { pool } from '../db.js';
import {
  mapCableRow,
  type CableRow,
  type CableWithTypeRow
} from '../models/cable.js';
import {
  mapCableMaterialRow,
  type CableMaterialRow
} from '../models/cableMaterial.js';
import {
  mapCableTypeDefaultMaterialRow,
  type CableTypeDefaultMaterialRow
} from '../models/cableTypeDefaultMaterial.js';
import type { CableTypeRow } from '../models/cableType.js';
import {
  mapMaterialCableTypeRow,
  type MaterialCableTypeRow
} from '../models/materialCableType.js';
import { authenticate } from '../middleware.js';
import { ensureProjectExists } from '../services/projectService.js';
import {
  createCableSchema,
  createCableMaterialSchema,
  updateCableMaterialSchema,
  updateCableSchema
} from '../validators.js';

const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE }
});

const INPUT_HEADERS = {
  cableId: 'Cable Id',
  tag: 'Tag',
  type: 'Type',
  fromLocation: 'From Location',
  toLocation: 'To Location',
  designLength: 'Design Length [m]',
  installLength: 'Install Length [m]',
  pullDate: 'Pull Date',
  connectedFrom: 'Connected From',
  connectedTo: 'Connected To',
  tested: 'Tested'
} as const;

const LIST_OUTPUT_HEADERS = {
  cableId: 'Cable Id',
  tag: 'Tag',
  type: 'Type',
  purpose: 'Purpose',
  diameter: 'Diameter [mm]',
  weight: 'Weight [kg/m]',
  fromLocation: 'From Location',
  toLocation: 'To Location',
  routing: 'Routing',
  designLength: 'Design Length'
} as const;

const REPORT_OUTPUT_HEADERS = {
  cableId: 'Cable Id',
  tag: 'Tag',
  type: 'Type',
  fromLocation: 'From Location',
  toLocation: 'To Location',
  designLength: 'Design Length [m]',
  installLength: 'Install Length [m]',
  pullDate: 'Pull Date',
  connectedFrom: 'Connected From',
  connectedTo: 'Connected To',
  tested: 'Tested'
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

const normalizeDateValue = (
  value: string | null | undefined
): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === '') {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!match) {
    const europeanMatch = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
    if (europeanMatch) {
      const [, day, month, year] = europeanMatch;
      return `${year}-${month}-${day}`;
    }
    return null;
  }

  const [, year, month, day] = match;
  return `${year}-${month}-${day}`;
};

const normalizeDateForComparison = (
  value: string | Date | null | undefined
): string | null => {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  if (typeof value === 'string') {
    return normalizeDateValue(value);
  }

  return null;
};

const parseCableId = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      return null;
    }
    return value;
  }

  const trimmed = String(value).trim();
  if (trimmed === '') {
    return null;
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
    return null;
  }

  return numeric;
};

const parseInstallLength = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }

  const trimmed = String(value).trim();
  if (trimmed === '') {
    return null;
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
};

const parseNumericValue = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const trimmed = String(value).trim();
  if (trimmed === '') {
    return null;
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeCableMaterialUnit = (
  value: string | null | undefined
): string | null => {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === 'm' || normalized === 'meter' || normalized === 'meters') {
    return 'meters';
  }

  if (
    normalized === 'pc' ||
    normalized === 'pcs' ||
    normalized === 'piece' ||
    normalized === 'pieces'
  ) {
    return 'pcs';
  }

  if (
    normalized === 'pcs/m' ||
    normalized === 'pc/m' ||
    normalized === 'pcs per meter' ||
    normalized === 'pieces per meter'
  ) {
    return 'pcs/m';
  }

  return normalized;
};

const formatDateCell = (
  value: Date | string | null | undefined
): string => {
  if (value === undefined || value === null) {
    return '';
  }

  if (value instanceof Date) {
    // Use local calendar parts so we mirror the original DATE field without shifting by timezone.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${day}-${month}-${year}`;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

  if (!match) {
    return value;
  }

  const [, year, month, day] = match;
  return `${day}-${month}-${year}`;
};

const selectCablesQuery = `
  SELECT
    c.id,
    c.project_id,
    c.cable_id,
    c.tag,
    c.cable_type_id,
    c.from_location,
    c.to_location,
    c.routing,
    c.design_length,
    c.install_length,
    c.pull_date,
    c.connected_from,
    c.connected_to,
    c.tested,
    c.created_at,
    c.updated_at,
    ct.name AS type_name,
    ct.purpose AS type_purpose,
    ct.diameter_mm AS type_diameter_mm,
    ct.weight_kg_per_m AS type_weight_kg_per_m
  FROM cables c
  JOIN cable_types ct ON ct.id = c.cable_type_id
`;

const selectCableDetailsQuery = `
  SELECT
    c.id,
    c.project_id,
    c.cable_id,
    c.tag,
    c.cable_type_id,
    c.from_location,
    c.to_location,
    c.routing,
    c.design_length,
    c.install_length,
    c.pull_date,
    c.connected_from,
    c.connected_to,
    c.tested,
    c.materials_initialized,
    c.materials_customized,
    c.created_at,
    c.updated_at,
    ct.name AS type_name,
    ct.purpose AS type_purpose,
    ct.diameter_mm AS type_diameter_mm,
    ct.weight_kg_per_m AS type_weight_kg_per_m
  FROM cables c
  JOIN cable_types ct ON ct.id = c.cable_type_id
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

const selectCableMaterialsQuery = `
  SELECT
    id,
    cable_id,
    name,
    quantity,
    unit,
    remarks,
    created_at,
    updated_at
  FROM cable_materials
`;

const selectMaterialCableTypeDetailsQuery = `
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

const selectMaterialCableInstallationMaterialsQuery = `
  SELECT
    type
  FROM material_cable_installation_materials
`;

type Queryable = Pick<PoolClient, 'query'>;

type MaterialCableInstallationMaterialMatchRow = {
  type: string;
};

type CableDetailsRow = CableWithTypeRow & {
  materials_initialized: boolean;
  materials_customized: boolean;
};

type CableReportFilterCriteria =
  | 'all'
  | 'tag'
  | 'typeName'
  | 'fromLocation'
  | 'toLocation'
  | 'routing';

type CableReportMaterialSummary = {
  name: string;
  unit: string;
  totalQuantity: number;
  cableCount: number;
  missingDesignLengthCount: number;
};

type CableReportCableTypeSummary = {
  cableTypeId: string;
  typeName: string;
  cableCount: number;
  totalDesignLength: number;
  materials: CableReportMaterialSummary[];
};

type CableReportSummary = {
  cableCount: number;
  cableTypeCount: number;
  totalDesignLength: number;
  omittedMaterialCount: number;
  missingDesignLengthMaterialCount: number;
  cableTypeSummaries: CableReportCableTypeSummary[];
};

const VALID_CABLE_REPORT_FILTER_CRITERIA = new Set<CableReportFilterCriteria>([
  'all',
  'tag',
  'typeName',
  'fromLocation',
  'toLocation',
  'routing'
]);

const normalizeCableReportFilterCriteria = (
  value: string | undefined
): CableReportFilterCriteria =>
  value && VALID_CABLE_REPORT_FILTER_CRITERIA.has(value as CableReportFilterCriteria)
    ? (value as CableReportFilterCriteria)
    : 'all';

const createMaterialCableInstallationMaterialNotFoundPayload = (
  name: string
) => ({
  fieldErrors: {
    name: [`Cable installation material "${name}" was not found in materials.`]
  }
});

const findProjectCableById = async (
  queryable: Queryable,
  projectId: string,
  cableId: string
): Promise<CableDetailsRow | null> => {
  const result = await queryable.query<CableDetailsRow>(
    `
      ${selectCableDetailsQuery}
      WHERE c.project_id = $1
        AND c.id = $2
      LIMIT 1;
    `,
    [projectId, cableId]
  );

  return result.rows[0] ?? null;
};

const listCableTypeDefaultMaterials = async (
  queryable: Queryable,
  cableTypeId: string
): Promise<CableTypeDefaultMaterialRow[]> => {
  const result = await queryable.query<CableTypeDefaultMaterialRow>(
    `
      ${selectCableTypeDefaultMaterialsQuery}
      WHERE cable_type_id = $1
      ORDER BY LOWER(name) ASC, created_at ASC;
    `,
    [cableTypeId]
  );

  return result.rows;
};

const listCableMaterials = async (
  queryable: Queryable,
  cableId: string
): Promise<CableMaterialRow[]> => {
  const result = await queryable.query<CableMaterialRow>(
    `
      ${selectCableMaterialsQuery}
      WHERE cable_id = $1
      ORDER BY LOWER(name) ASC, created_at ASC;
    `,
    [cableId]
  );

  return result.rows;
};

const findMaterialCableTypeDetailsByName = async (
  queryable: Queryable,
  name: string
): Promise<MaterialCableTypeRow | null> => {
  const result = await queryable.query<MaterialCableTypeRow>(
    `
      ${selectMaterialCableTypeDetailsQuery}
      WHERE lower(name) = lower($1)
      LIMIT 1;
    `,
    [name]
  );

  return result.rows[0] ?? null;
};

const findMaterialCableInstallationMaterialByType = async (
  queryable: Queryable,
  type: string
): Promise<MaterialCableInstallationMaterialMatchRow | null> => {
  const result = await queryable.query<MaterialCableInstallationMaterialMatchRow>(
    `
      ${selectMaterialCableInstallationMaterialsQuery}
      WHERE lower(type) = lower($1)
      LIMIT 1;
    `,
    [type]
  );

  return result.rows[0] ?? null;
};

const updateCableMaterialState = async (
  queryable: Queryable,
  cableId: string,
  options: {
    initialized: boolean;
    customized: boolean;
  }
): Promise<void> => {
  await queryable.query(
    `
      UPDATE cables
      SET
        materials_initialized = $2,
        materials_customized = $3,
        updated_at = NOW()
      WHERE id = $1;
    `,
    [cableId, options.initialized, options.customized]
  );
};

const normalizeComparableCableTypeName = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

const resolveCableTypeDefaultMaterials = async (
  queryable: Queryable,
  projectId: string,
  cableTypeId: string,
  cableTypeName: string
): Promise<CableTypeDefaultMaterialRow[]> => {
  const exactMaterials = await listCableTypeDefaultMaterials(queryable, cableTypeId);

  if (exactMaterials.length > 0) {
    return exactMaterials;
  }

  const normalizedName = normalizeComparableCableTypeName(cableTypeName);

  if (normalizedName === '') {
    return exactMaterials;
  }

  const fallbackSourceResult = await queryable.query<{ id: string }>(
    `
      SELECT ct.id
      FROM cable_types ct
      JOIN cable_type_default_materials dm ON dm.cable_type_id = ct.id
      WHERE ct.project_id = $1
        AND regexp_replace(lower(trim(ct.name)), '\s+', ' ', 'g') = $2
      GROUP BY ct.id
      ORDER BY COUNT(dm.id) DESC, ct.id ASC
      LIMIT 1;
    `,
    [projectId, normalizedName]
  );

  const fallbackSource = fallbackSourceResult.rows[0];

  if (!fallbackSource) {
    return exactMaterials;
  }

  return listCableTypeDefaultMaterials(queryable, fallbackSource.id);
};

const resetCableMaterialsToCableTypeDefaults = async (
  queryable: Queryable,
  projectId: string,
  cableId: string,
  cableTypeId: string,
  cableTypeName: string
): Promise<void> => {
  const defaultMaterials = await resolveCableTypeDefaultMaterials(
    queryable,
    projectId,
    cableTypeId,
    cableTypeName
  );

  await queryable.query(
    `
      DELETE FROM cable_materials
      WHERE cable_id = $1;
    `,
    [cableId]
  );

  for (const material of defaultMaterials) {
    await queryable.query(
      `
        INSERT INTO cable_materials (
          id,
          cable_id,
          name,
          quantity,
          unit,
          remarks
        )
        VALUES ($1, $2, $3, $4, $5, $6);
      `,
      [
        randomUUID(),
        cableId,
        material.name,
        material.quantity,
        material.unit,
        material.remarks
      ]
    );
  }

  await updateCableMaterialState(queryable, cableId, {
    initialized: true,
    customized: false
  });
};

const ensureCableMaterialsInitialized = async (
  queryable: Queryable,
  projectId: string,
  cableId: string,
  cableTypeId: string,
  cableTypeName: string,
  materialsInitialized: boolean,
  materialsCustomized: boolean
): Promise<CableMaterialRow[]> => {
  const existingMaterials = await listCableMaterials(queryable, cableId);
  const shouldHydrateFromDefaults =
    !materialsInitialized || (!materialsCustomized && existingMaterials.length === 0);

  if (shouldHydrateFromDefaults) {
    await resetCableMaterialsToCableTypeDefaults(
      queryable,
      projectId,
      cableId,
      cableTypeId,
      cableTypeName
    );

    return listCableMaterials(queryable, cableId);
  }

  return existingMaterials;
};

const listCableMaterialsByCableIds = async (
  queryable: Queryable,
  cableIds: string[]
): Promise<Map<string, CableMaterialRow[]>> => {
  const grouped = new Map<string, CableMaterialRow[]>();

  if (cableIds.length === 0) {
    return grouped;
  }

  const result = await queryable.query<CableMaterialRow>(
    `
      ${selectCableMaterialsQuery}
      WHERE cable_id = ANY($1::uuid[])
      ORDER BY cable_id ASC, LOWER(name) ASC, created_at ASC;
    `,
    [cableIds]
  );

  for (const row of result.rows) {
    const existing = grouped.get(row.cable_id);

    if (existing) {
      existing.push(row);
      continue;
    }

    grouped.set(row.cable_id, [row]);
  }

  return grouped;
};

const roundReportQuantity = (value: number): number =>
  Math.round(value * 1000) / 1000;

const buildCableReportSummary = async (
  queryable: Queryable,
  projectId: string,
  cables: CableDetailsRow[]
): Promise<CableReportSummary> => {
  const cableMaterialsByCableId = await listCableMaterialsByCableIds(
    queryable,
    cables.map((cable) => cable.id)
  );

  const defaultMaterialsCache = new Map<string, Promise<CableTypeDefaultMaterialRow[]>>();
  const cableTypeSummaries = new Map<
    string,
    {
      cableTypeId: string;
      typeName: string;
      cableCount: number;
      totalDesignLength: number;
      materials: Map<
        string,
        {
          name: string;
          unit: string;
          totalQuantity: number;
          cableCount: number;
          missingDesignLengthCount: number;
        }
      >;
    }
  >();

  let totalDesignLength = 0;
  let omittedMaterialCount = 0;
  let missingDesignLengthMaterialCount = 0;

  const getDefaultMaterials = (
    cable: CableDetailsRow
  ): Promise<CableTypeDefaultMaterialRow[]> => {
    const cacheKey = `${cable.cable_type_id}:${normalizeComparableCableTypeName(
      cable.type_name
    )}`;
    const cached = defaultMaterialsCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const next = resolveCableTypeDefaultMaterials(
      queryable,
      projectId,
      cable.cable_type_id,
      cable.type_name
    );
    defaultMaterialsCache.set(cacheKey, next);
    return next;
  };

  for (const cable of cables) {
    const designLength = parseInstallLength(cable.design_length);
    const cableTypeKey = cable.cable_type_id;
    const existingSummary = cableTypeSummaries.get(cableTypeKey);
    const cableTypeSummary =
      existingSummary ??
      (() => {
        const next = {
          cableTypeId: cable.cable_type_id,
          typeName: cable.type_name,
          cableCount: 0,
          totalDesignLength: 0,
          materials: new Map<
            string,
            {
              name: string;
              unit: string;
              totalQuantity: number;
              cableCount: number;
              missingDesignLengthCount: number;
            }
          >()
        };
        cableTypeSummaries.set(cableTypeKey, next);
        return next;
      })();

    cableTypeSummary.cableCount += 1;

    if (designLength !== null) {
      cableTypeSummary.totalDesignLength += designLength;
      totalDesignLength += designLength;
    }

    const existingMaterials = cableMaterialsByCableId.get(cable.id) ?? [];
    const shouldUseDefaultMaterials =
      !cable.materials_initialized ||
      (!cable.materials_customized && existingMaterials.length === 0);
    const materials = shouldUseDefaultMaterials
      ? await getDefaultMaterials(cable)
      : existingMaterials;

    for (const material of materials) {
      const materialName = material.name?.trim();
      const unit = normalizeCableMaterialUnit(material.unit);
      const quantity = parseNumericValue(material.quantity);

      if (!materialName || !unit || quantity === null) {
        omittedMaterialCount += 1;
        continue;
      }

      let outputUnit = unit;
      let totalQuantity = quantity;
      let missingDesignLength = false;

      if (unit === 'pcs/m') {
        outputUnit = 'pcs';

        if (designLength === null) {
          missingDesignLength = true;
          missingDesignLengthMaterialCount += 1;
          totalQuantity = 0;
        } else {
          totalQuantity = quantity * designLength;
        }
      }

      const materialKey = `${materialName.toLowerCase()}::${outputUnit}`;
      const existingMaterialSummary = cableTypeSummary.materials.get(materialKey);
      const materialSummary =
        existingMaterialSummary ??
        (() => {
          const next = {
            name: materialName,
            unit: outputUnit,
            totalQuantity: 0,
            cableCount: 0,
            missingDesignLengthCount: 0
          };
          cableTypeSummary.materials.set(materialKey, next);
          return next;
        })();

      materialSummary.cableCount += 1;

      if (missingDesignLength) {
        materialSummary.missingDesignLengthCount += 1;
        continue;
      }

      materialSummary.totalQuantity = roundReportQuantity(
        materialSummary.totalQuantity + totalQuantity
      );
    }
  }

  const sortedCableTypeSummaries = Array.from(cableTypeSummaries.values())
    .sort((a, b) =>
      a.typeName.localeCompare(b.typeName, undefined, { sensitivity: 'base' })
    )
    .map<CableReportCableTypeSummary>((summary) => ({
      cableTypeId: summary.cableTypeId,
      typeName: summary.typeName,
      cableCount: summary.cableCount,
      totalDesignLength: summary.totalDesignLength,
      materials: Array.from(summary.materials.values())
        .sort((a, b) => {
          const nameCompare = a.name.localeCompare(b.name, undefined, {
            sensitivity: 'base'
          });

          if (nameCompare !== 0) {
            return nameCompare;
          }

          return a.unit.localeCompare(b.unit, undefined, {
            sensitivity: 'base'
          });
        })
        .map((material) => ({
          name: material.name,
          unit: material.unit,
          totalQuantity: roundReportQuantity(material.totalQuantity),
          cableCount: material.cableCount,
          missingDesignLengthCount: material.missingDesignLengthCount
        }))
    }));

  return {
    cableCount: cables.length,
    cableTypeCount: sortedCableTypeSummaries.length,
    totalDesignLength,
    omittedMaterialCount,
    missingDesignLengthMaterialCount,
    cableTypeSummaries: sortedCableTypeSummaries
  };
};

const cablesRouter = Router({ mergeParams: true });

cablesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
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

    const result = await pool.query<CableWithTypeRow>(
      `
        ${selectCablesQuery}
        WHERE c.project_id = $1
        ORDER BY LOWER(COALESCE(c.tag, c.cable_id::text)) ASC,
          c.cable_id ASC;
      `,
      [projectId]
    );

    res.json({ cables: result.rows.map(mapCableRow) });
  } catch (error) {
    console.error('List cables error', error);
    res.status(500).json({ error: 'Failed to fetch cables' });
  }
});

cablesRouter.post(
  '/',
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

    } catch (error) {
      console.error('Verify project for cable create error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    const parseResult = createCableSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const {
      cableId,
      tag,
      cableTypeId,
      fromLocation,
      toLocation,
      routing,
      designLength,
      installLength,
      pullDate,
      connectedFrom,
      connectedTo,
      tested
    } = parseResult.data;

    let client: PoolClient | null = null;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const typeResult = await client.query<CableTypeRow>(
        `
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
          WHERE id = $1
            AND project_id = $2;
        `,
        [cableTypeId, projectId]
      );

      const cableType = typeResult.rows[0];

      if (!cableType) {
        await client.query('ROLLBACK');
        res
          .status(400)
          .json({ error: 'Cable type does not belong to the project' });
        return;
      }

      const insertedCableId = randomUUID();
      const normalizedTag = normalizeOptionalString(tag ?? null);

      const insertResult = await client.query<CableRow>(
        `
          INSERT INTO cables (
            id,
            project_id,
            cable_id,
            tag,
            cable_type_id,
            from_location,
            to_location,
            routing,
            design_length,
            install_length,
            pull_date,
            connected_from,
            connected_to,
            tested
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING
            id,
            project_id,
            cable_id,
            tag,
            cable_type_id,
            from_location,
            to_location,
            routing,
            design_length,
            install_length,
            pull_date,
            connected_from,
            connected_to,
            tested,
            created_at,
            updated_at;
        `,
        [
          insertedCableId,
          projectId,
          cableId,
          normalizedTag,
          cableTypeId,
          normalizeOptionalString(fromLocation ?? null),
          normalizeOptionalString(toLocation ?? null),
          normalizeOptionalString(routing ?? null),
          designLength ?? null,
          installLength ?? null,
          normalizeDateValue(pullDate ?? null),
          normalizeDateValue(connectedFrom ?? null),
          normalizeDateValue(connectedTo ?? null),
          normalizeDateValue(tested ?? null)
        ]
      );

      const inserted = insertResult.rows[0];

      if (!inserted) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to create cable' });
        return;
      }

      await resetCableMaterialsToCableTypeDefaults(
        client,
        projectId,
        inserted.id,
        cableTypeId,
        cableType.name
      );
      await client.query('COMMIT');

      const result = await pool.query<CableWithTypeRow>(
        `
          ${selectCablesQuery}
          WHERE c.id = $1;
        `,
        [inserted.id]
      );

      res.status(201).json({ cable: mapCableRow(result.rows[0]) });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
      }

      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        res
          .status(409)
          .json({ error: 'Cable ID already exists for this project' });
        return;
      }

      console.error('Create cable error', error);
      res.status(500).json({ error: 'Failed to create cable' });
    } finally {
      client?.release();
    }
  }
);

cablesRouter.patch(
  '/:cableId',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableId } = req.params;

    if (!projectId || !cableId) {
      res
        .status(400)
        .json({ error: 'Project ID and cable ID are required' });
      return;
    }

    const parseResult = updateCableSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const {
      cableId: newCableId,
      tag,
      cableTypeId,
      fromLocation,
      toLocation,
      routing,
      designLength,
      installLength,
      pullDate,
      connectedFrom,
      connectedTo,
      tested
    } = parseResult.data;

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
    } catch (error) {
      console.error('Verify project for cable update error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    let index = 1;

    if (newCableId !== undefined) {
      fields.push(`cable_id = $${index++}`);
      values.push(newCableId);
    }

    if (tag !== undefined) {
      fields.push(`tag = $${index++}`);
      values.push(normalizeOptionalString(tag) ?? null);
    }

    if (cableTypeId !== undefined) {
      fields.push(`cable_type_id = $${index++}`);
      values.push(cableTypeId);
    }

    if (fromLocation !== undefined) {
      fields.push(`from_location = $${index++}`);
      values.push(normalizeOptionalString(fromLocation));
    }

    if (toLocation !== undefined) {
      fields.push(`to_location = $${index++}`);
      values.push(normalizeOptionalString(toLocation));
    }

    if (routing !== undefined) {
      fields.push(`routing = $${index++}`);
      values.push(normalizeOptionalString(routing));
    }

    if (designLength !== undefined) {
      fields.push(`design_length = $${index++}`);
      values.push(designLength ?? null);
    }

    if (installLength !== undefined) {
      fields.push(`install_length = $${index++}`);
      values.push(installLength ?? null);
    }

    if (pullDate !== undefined) {
      fields.push(`pull_date = $${index++}`);
      values.push(normalizeDateValue(pullDate));
    }

    if (connectedFrom !== undefined) {
      fields.push(`connected_from = $${index++}`);
      values.push(normalizeDateValue(connectedFrom));
    }

    if (connectedTo !== undefined) {
      fields.push(`connected_to = $${index++}`);
      values.push(normalizeDateValue(connectedTo));
    }

    if (tested !== undefined) {
      fields.push(`tested = $${index++}`);
      values.push(normalizeDateValue(tested));
    }

    fields.push(`updated_at = NOW()`);

    let client: PoolClient | null = null;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const existingCableResult = await client.query<
        Pick<CableRow, 'id' | 'cable_type_id'>
      >(
        `
          SELECT id, cable_type_id
          FROM cables
          WHERE id = $1
            AND project_id = $2
          LIMIT 1;
        `,
        [cableId, projectId]
      );

      const existingCable = existingCableResult.rows[0];

      if (!existingCable) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable not found' });
        return;
      }

      let nextCableTypeName: string | null = null;

      if (cableTypeId) {
        const typeResult = await client.query<Pick<CableTypeRow, 'id' | 'name'>>(
          `
            SELECT id, name
            FROM cable_types
            WHERE id = $1
              AND project_id = $2;
          `,
          [cableTypeId, projectId]
        );

        const nextCableType = typeResult.rows[0];

        if (!nextCableType) {
          await client.query('ROLLBACK');
          res
            .status(400)
            .json({ error: 'Cable type does not belong to the project' });
          return;
        }

        nextCableTypeName = nextCableType.name;
      }

      if (newCableId !== undefined) {
        const duplicate = await client.query(
          `
            SELECT id
            FROM cables
            WHERE project_id = $1
              AND id <> $2
              AND cable_id = $3;
          `,
          [projectId, cableId, newCableId]
        );

        if (duplicate.rowCount > 0) {
          await client.query('ROLLBACK');
          res
            .status(409)
            .json({ error: 'Cable ID already exists for this project' });
          return;
        }
      }

      const updateResult = await client.query<CableRow>(
        `
          UPDATE cables
          SET ${fields.join(', ')}
          WHERE id = $${index}
            AND project_id = $${index + 1}
          RETURNING
            id,
            project_id,
            cable_id,
            tag,
            cable_type_id,
            from_location,
            to_location,
            routing,
            design_length,
            install_length,
            pull_date,
            connected_from,
            connected_to,
            tested,
            created_at,
            updated_at;
        `,
        [...values, cableId, projectId]
      );

      const updated = updateResult.rows[0];

      if (!updated) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable not found' });
        return;
      }

      const shouldResetMaterials =
        cableTypeId !== undefined && cableTypeId !== existingCable.cable_type_id;

      if (shouldResetMaterials) {
        await resetCableMaterialsToCableTypeDefaults(
          client,
          projectId,
          updated.id,
          cableTypeId,
          nextCableTypeName ?? ''
        );
      }

      await client.query('COMMIT');

      const result = await pool.query<CableWithTypeRow>(
        `
          ${selectCablesQuery}
          WHERE c.id = $1;
        `,
        [updated.id]
      );

      res.json({ cable: mapCableRow(result.rows[0]) });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
      }

      console.error('Update cable error', error);
      res.status(500).json({ error: 'Failed to update cable' });
    } finally {
      client?.release();
    }
  }
);

cablesRouter.get(
  '/:cableId/details',
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableId } = req.params;

    if (!projectId || !cableId) {
      res.status(400).json({ error: 'Project ID and cable ID are required' });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
    } catch (error) {
      console.error('Verify project for cable details error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    let client: PoolClient | null = null;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const cable = await findProjectCableById(client, projectId, cableId);

      if (!cable) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable not found' });
        return;
      }

      const cableMaterials = await ensureCableMaterialsInitialized(
        client,
        projectId,
        cable.id,
        cable.cable_type_id,
        cable.type_name,
        cable.materials_initialized,
        cable.materials_customized
      );

      const [materialCableType, cableTypeDefaultMaterials] = await Promise.all([
        findMaterialCableTypeDetailsByName(client, cable.type_name),
        resolveCableTypeDefaultMaterials(client, projectId, cable.cable_type_id, cable.type_name)
      ]);

      await client.query('COMMIT');

      res.json({
        cable: mapCableRow(cable),
        materialCableType: materialCableType ? mapMaterialCableTypeRow(materialCableType) : null,
        cableTypeDefaultMaterials: cableTypeDefaultMaterials.map(mapCableTypeDefaultMaterialRow),
        cableMaterials: cableMaterials.map(mapCableMaterialRow)
      });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
      }

      console.error('Fetch cable details error', error);
      res.status(500).json({ error: 'Failed to fetch cable details' });
    } finally {
      client?.release();
    }
  }
);

cablesRouter.post(
  '/:cableId/materials',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableId } = req.params;

    if (!projectId || !cableId) {
      res.status(400).json({ error: 'Project ID and cable ID are required' });
      return;
    }

    const parseResult = createCableMaterialSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    let client: PoolClient | null = null;

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      client = await pool.connect();
      await client.query('BEGIN');

      const cable = await findProjectCableById(client, projectId, cableId);

      if (!cable) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable not found' });
        return;
      }

      await ensureCableMaterialsInitialized(
        client,
        projectId,
        cable.id,
        cable.cable_type_id,
        cable.type_name,
        cable.materials_initialized,
        cable.materials_customized
      );

      const { name, quantity, unit, remarks } = parseResult.data;
      const materialCableInstallationMaterial =
        await findMaterialCableInstallationMaterialByType(client, name);

      if (!materialCableInstallationMaterial) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: createMaterialCableInstallationMaterialNotFoundPayload(name.trim())
        });
        return;
      }

      const result = await client.query<CableMaterialRow>(
        `
          INSERT INTO cable_materials (
            id,
            cable_id,
            name,
            quantity,
            unit,
            remarks
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING
            id,
            cable_id,
            name,
            quantity,
            unit,
            remarks,
            created_at,
            updated_at;
        `,
        [
          randomUUID(),
          cable.id,
          materialCableInstallationMaterial.type,
          quantity ?? null,
          normalizeOptionalString(unit ?? null),
          normalizeOptionalString(remarks ?? null)
        ]
      );

      await updateCableMaterialState(client, cable.id, {
        initialized: true,
        customized: true
      });
      await client.query('COMMIT');

      res.status(201).json({
        cableMaterial: mapCableMaterialRow(result.rows[0])
      });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
      }

      console.error('Create cable material error', error);
      res.status(500).json({ error: 'Failed to create cable material' });
    } finally {
      client?.release();
    }
  }
);

cablesRouter.patch(
  '/:cableId/materials/:materialId',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableId, materialId } = req.params;

    if (!projectId || !cableId || !materialId) {
      res.status(400).json({
        error: 'Project ID, cable ID, and material ID are required'
      });
      return;
    }

    const parseResult = updateCableMaterialSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    let client: PoolClient | null = null;

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      client = await pool.connect();
      await client.query('BEGIN');

      const cable = await findProjectCableById(client, projectId, cableId);

      if (!cable) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable not found' });
        return;
      }

      await ensureCableMaterialsInitialized(
        client,
        projectId,
        cable.id,
        cable.cable_type_id,
        cable.type_name,
        cable.materials_initialized,
        cable.materials_customized
      );

      const { name, quantity, unit, remarks } = parseResult.data;
      const fields: string[] = [];
      const values: Array<string | number | null> = [];
      let index = 1;

      if (name !== undefined) {
        const materialCableInstallationMaterial =
          await findMaterialCableInstallationMaterialByType(client, name);

        if (!materialCableInstallationMaterial) {
          await client.query('ROLLBACK');
          res.status(400).json({
            error: createMaterialCableInstallationMaterialNotFoundPayload(name.trim())
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

      const result = await client.query<CableMaterialRow>(
        `
          UPDATE cable_materials
          SET ${fields.join(', ')}
          WHERE id = $${index}
            AND cable_id = $${index + 1}
          RETURNING
            id,
            cable_id,
            name,
            quantity,
            unit,
            remarks,
            created_at,
            updated_at;
        `,
        [...values, materialId, cable.id]
      );

      const cableMaterial = result.rows[0];

      if (!cableMaterial) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable material not found' });
        return;
      }

      await updateCableMaterialState(client, cable.id, {
        initialized: true,
        customized: true
      });
      await client.query('COMMIT');

      res.json({
        cableMaterial: mapCableMaterialRow(cableMaterial)
      });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
      }

      console.error('Update cable material error', error);
      res.status(500).json({ error: 'Failed to update cable material' });
    } finally {
      client?.release();
    }
  }
);

cablesRouter.delete(
  '/:cableId/materials/:materialId',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableId, materialId } = req.params;

    if (!projectId || !cableId || !materialId) {
      res.status(400).json({
        error: 'Project ID, cable ID, and material ID are required'
      });
      return;
    }

    let client: PoolClient | null = null;

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      client = await pool.connect();
      await client.query('BEGIN');

      const cable = await findProjectCableById(client, projectId, cableId);

      if (!cable) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable not found' });
        return;
      }

      await ensureCableMaterialsInitialized(
        client,
        projectId,
        cable.id,
        cable.cable_type_id,
        cable.type_name,
        cable.materials_initialized,
        cable.materials_customized
      );

      const result = await client.query(
        `
          DELETE FROM cable_materials
          WHERE id = $1
            AND cable_id = $2;
        `,
        [materialId, cable.id]
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Cable material not found' });
        return;
      }

      await updateCableMaterialState(client, cable.id, {
        initialized: true,
        customized: true
      });
      await client.query('COMMIT');

      res.status(204).send();
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
      }

      console.error('Delete cable material error', error);
      res.status(500).json({ error: 'Failed to delete cable material' });
    } finally {
      client?.release();
    }
  }
);

cablesRouter.delete(
  '/:cableId',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableId } = req.params;

    if (!projectId || !cableId) {
      res
        .status(400)
        .json({ error: 'Project ID and cable ID are required' });
      return;
    }

    try {
      const result = await pool.query(
        `
          DELETE FROM cables
          WHERE id = $1
            AND project_id = $2;
        `,
        [cableId, projectId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Cable not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete cable error', error);
      res.status(500).json({ error: 'Failed to delete cable' });
    }
  }
);

cablesRouter.post(
  '/import',
  authenticate,
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
      console.error('Verify project for cable import error', error);
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
      console.error('Read cable list workbook error', error);
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

    type PreparedCableFields = {
      tag?: string | null;
      fromLocation?: string | null;
      toLocation?: string | null;
      routing?: string | null;
      designLength?: number | null;
      installLength?: number | null;
      pullDate?: string | null;
      connectedFrom?: string | null;
      connectedTo?: string | null;
      tested?: string | null;
    };

    type PreparedCableRow = {
      cableId: number;
      cableKey: number;
      typeName: string;
      typeKey: string;
      fields: PreparedCableFields;
    };

    const prepared: PreparedCableRow[] = [];

    const seenCableIds = new Set<number>();

    const availableColumns = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (key.trim() !== '') {
          availableColumns.add(key);
        }
      }
    }

    const hasColumn = (header: string): boolean =>
      rows.length === 0 || availableColumns.has(header);

    const requiredColumns = [
      INPUT_HEADERS.cableId,
      INPUT_HEADERS.tag,
      INPUT_HEADERS.type,
      INPUT_HEADERS.fromLocation,
      INPUT_HEADERS.toLocation,
      INPUT_HEADERS.designLength
    ];

    const missingColumns = requiredColumns.filter((header) => !hasColumn(header));

    if (missingColumns.length > 0) {
      const columnList = missingColumns.join(', ');
      res.status(400).json({
        error: `Import cancelled. Missing required column${
          missingColumns.length === 1 ? '' : 's'
        }: ${columnList}.`
      });
      return;
    }

    // Track worksheet columns so we only touch fields the user supplied.
    const columnAvailability = {
      tag: hasColumn(INPUT_HEADERS.tag),
      fromLocation: hasColumn(INPUT_HEADERS.fromLocation),
      toLocation: hasColumn(INPUT_HEADERS.toLocation),
      routing: hasColumn(LIST_OUTPUT_HEADERS.routing),
      designLength: hasColumn(INPUT_HEADERS.designLength),
      installLength: hasColumn(INPUT_HEADERS.installLength),
      pullDate: hasColumn(INPUT_HEADERS.pullDate),
      connectedFrom: hasColumn(INPUT_HEADERS.connectedFrom),
      connectedTo: hasColumn(INPUT_HEADERS.connectedTo),
      tested: hasColumn(INPUT_HEADERS.tested)
    };

    for (const row of rows) {
      const rawCableId = row[INPUT_HEADERS.cableId] as unknown;
      const cableId = parseCableId(rawCableId);

      if (cableId === null) {
        summary.skipped += 1;
        continue;
      }

      const cableKey = cableId;

      if (seenCableIds.has(cableKey)) {
        summary.skipped += 1;
        continue;
      }

      const rawType = row[INPUT_HEADERS.type] as unknown;
      const typeName =
        typeof rawType === 'number'
          ? String(rawType)
          : String(rawType ?? '').trim();

      if (typeName === '') {
        summary.skipped += 1;
        continue;
      }

      const typeKey = typeName.toLowerCase();

      const fields: PreparedCableFields = {};

      if (columnAvailability.tag) {
        fields.tag = normalizeOptionalString(
          typeof row[INPUT_HEADERS.tag] === 'number'
            ? String(row[INPUT_HEADERS.tag])
            : (row[INPUT_HEADERS.tag] as string | null | undefined)
        );
      }

      if (columnAvailability.fromLocation) {
        fields.fromLocation = normalizeOptionalString(
          typeof row[INPUT_HEADERS.fromLocation] === 'number'
            ? String(row[INPUT_HEADERS.fromLocation])
            : (row[INPUT_HEADERS.fromLocation] as string | null | undefined)
        );
      }

      if (columnAvailability.toLocation) {
        fields.toLocation = normalizeOptionalString(
          typeof row[INPUT_HEADERS.toLocation] === 'number'
            ? String(row[INPUT_HEADERS.toLocation])
            : (row[INPUT_HEADERS.toLocation] as string | null | undefined)
        );
      }

      if (columnAvailability.routing) {
        fields.routing = normalizeOptionalString(
          typeof row[LIST_OUTPUT_HEADERS.routing] === 'number'
            ? String(row[LIST_OUTPUT_HEADERS.routing])
            : (row[LIST_OUTPUT_HEADERS.routing] as string | null | undefined)
        );
      }

      if (columnAvailability.designLength) {
        fields.designLength = parseInstallLength(
          row[INPUT_HEADERS.designLength] as unknown
        );
      }

      if (columnAvailability.installLength) {
        fields.installLength = parseInstallLength(
          row[INPUT_HEADERS.installLength] as unknown
        );
      }

      if (columnAvailability.pullDate) {
        fields.pullDate = normalizeDateValue(
          row[INPUT_HEADERS.pullDate] as string | null | undefined
        );
      }

      if (columnAvailability.connectedFrom) {
        fields.connectedFrom = normalizeDateValue(
          row[INPUT_HEADERS.connectedFrom] as string | null | undefined
        );
      }

      if (columnAvailability.connectedTo) {
        fields.connectedTo = normalizeDateValue(
          row[INPUT_HEADERS.connectedTo] as string | null | undefined
        );
      }

      if (columnAvailability.tested) {
        fields.tested = normalizeDateValue(
          row[INPUT_HEADERS.tested] as string | null | undefined
        );
      }

      prepared.push({
        cableId,
        cableKey,
        typeName,
        typeKey,
        fields
      });

      seenCableIds.add(cableKey);
    }

    if (prepared.length === 0) {
      try {
        const existing = await pool.query<CableWithTypeRow>(
          `
            ${selectCablesQuery}
            WHERE c.project_id = $1
            ORDER BY LOWER(COALESCE(c.tag, c.cable_id::text)) ASC,
              c.cable_id ASC;
          `,
          [projectId]
        );

        res.json({
          summary,
          cables: existing.rows.map(mapCableRow)
        });
      } catch (error) {
        console.error('Fetch cables after empty import error', error);
        res.status(500).json({
          error: 'No rows imported and failed to fetch existing cables',
          summary
        });
      }
      return;
    }

    type ExistingCable = Pick<
      CableRow,
      | 'id'
      | 'cable_id'
      | 'cable_type_id'
      | 'tag'
      | 'from_location'
      | 'to_location'
      | 'routing'
      | 'design_length'
      | 'install_length'
      | 'pull_date'
      | 'connected_from'
      | 'connected_to'
      | 'tested'
    > & {
      type_name: string;
    };

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const typeKeys = Array.from(new Set(prepared.map((row) => row.typeKey)));

      const typeResult =
        typeKeys.length > 0
          ? await client.query<CableTypeRow>(
              `
                SELECT
                  id,
                  name
                FROM cable_types
                WHERE project_id = $1
                  AND lower(name) = ANY($2::text[]);
              `,
              [projectId, typeKeys]
            )
          : { rows: [] as CableTypeRow[] };

      const typeMap = new Map<string, CableTypeRow>();

      for (const type of typeResult.rows) {
        typeMap.set(type.name.toLowerCase(), type);
      }

      const existingResult = await client.query<ExistingCable>(
        `
          SELECT
            c.id,
            c.cable_id,
            c.cable_type_id,
            c.tag,
            c.from_location,
            c.to_location,
            c.routing,
            c.design_length,
            c.install_length,
            c.pull_date,
            c.connected_from,
            c.connected_to,
            c.tested,
            ct.name AS type_name
          FROM cables c
          JOIN cable_types ct ON ct.id = c.cable_type_id
          WHERE c.project_id = $1
            AND c.cable_id = ANY($2::int[]);
        `,
        [projectId, prepared.map((row) => row.cableKey)]
      );

      const existingMap = new Map<number, ExistingCable>();

      for (const cable of existingResult.rows) {
        existingMap.set(cable.cable_id, cable);
      }

      for (const row of prepared) {
        const { fields } = row;
        const type = typeMap.get(row.typeKey);

        if (!type) {
          summary.skipped += 1;
          continue;
        }

        const existing = existingMap.get(row.cableKey);

        if (!existing) {
          const insertedCableId = randomUUID();

          await client.query(
            `
              INSERT INTO cables (
                id,
                project_id,
                cable_id,
                tag,
                cable_type_id,
                from_location,
                to_location,
                routing,
                design_length,
                install_length,
                pull_date,
                connected_from,
                connected_to,
                tested
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
            `,
            [
              insertedCableId,
              projectId,
              row.cableId,
              fields.tag ?? null,
              type.id,
              fields.fromLocation ?? null,
              fields.toLocation ?? null,
              fields.routing ?? null,
              fields.designLength ?? null,
              fields.installLength ?? null,
              fields.pullDate ?? null,
              fields.connectedFrom ?? null,
              fields.connectedTo ?? null,
              fields.tested ?? null
            ]
          );
          await resetCableMaterialsToCableTypeDefaults(
            client,
            projectId,
            insertedCableId,
            type.id,
            type.name
          );
          summary.inserted += 1;
          continue;
        }

        const updateAssignments: string[] = [];
        const updateValues: Array<string | number | null> = [];
        let parameterIndex = 1;

        if (existing.cable_type_id !== type.id) {
          updateAssignments.push(`cable_type_id = $${parameterIndex}`);
          updateValues.push(type.id);
          parameterIndex += 1;
        }

        if (columnAvailability.tag && fields.tag !== undefined) {
          const currentTag = normalizeOptionalString(existing.tag ?? null);
          if (fields.tag !== currentTag) {
            updateAssignments.push(`tag = $${parameterIndex}`);
            updateValues.push(fields.tag ?? null);
            parameterIndex += 1;
          }
        }

        if (columnAvailability.fromLocation && fields.fromLocation !== undefined) {
          const currentFrom = normalizeOptionalString(
            existing.from_location ?? null
          );
          if (fields.fromLocation !== currentFrom) {
            updateAssignments.push(`from_location = $${parameterIndex}`);
            updateValues.push(fields.fromLocation ?? null);
            parameterIndex += 1;
          }
        }

        if (columnAvailability.toLocation && fields.toLocation !== undefined) {
          const currentTo = normalizeOptionalString(existing.to_location ?? null);
          if (fields.toLocation !== currentTo) {
            updateAssignments.push(`to_location = $${parameterIndex}`);
            updateValues.push(fields.toLocation ?? null);
            parameterIndex += 1;
          }
        }

        if (columnAvailability.routing && fields.routing !== undefined) {
          const currentRouting = normalizeOptionalString(existing.routing ?? null);
          if (fields.routing !== currentRouting) {
            updateAssignments.push(`routing = $${parameterIndex}`);
            updateValues.push(fields.routing ?? null);
            parameterIndex += 1;
          }
        }

        if (columnAvailability.designLength && fields.designLength !== undefined) {
          const currentDesignLength = parseInstallLength(existing.design_length);
          if (fields.designLength !== currentDesignLength) {
            updateAssignments.push(`design_length = $${parameterIndex}`);
            updateValues.push(fields.designLength ?? null);
            parameterIndex += 1;
          }
        }

        if (columnAvailability.installLength && fields.installLength !== undefined) {
          const currentInstallLength = parseInstallLength(existing.install_length);
          if (fields.installLength !== currentInstallLength) {
            updateAssignments.push(`install_length = $${parameterIndex}`);
            updateValues.push(fields.installLength ?? null);
            parameterIndex += 1;
          }
        }

        if (columnAvailability.pullDate && fields.pullDate !== undefined) {
          const currentPullDate = normalizeDateForComparison(existing.pull_date);
          if (fields.pullDate !== currentPullDate) {
            updateAssignments.push(`pull_date = $${parameterIndex}`);
            updateValues.push(fields.pullDate ?? null);
            parameterIndex += 1;
          }
        }

        if (
          columnAvailability.connectedFrom &&
          fields.connectedFrom !== undefined
        ) {
          const currentConnectedFrom = normalizeDateForComparison(
            existing.connected_from
          );
          if (fields.connectedFrom !== currentConnectedFrom) {
            updateAssignments.push(`connected_from = $${parameterIndex}`);
            updateValues.push(fields.connectedFrom ?? null);
            parameterIndex += 1;
          }
        }

        if (
          columnAvailability.connectedTo &&
          fields.connectedTo !== undefined
        ) {
          const currentConnectedTo = normalizeDateForComparison(
            existing.connected_to
          );
          if (fields.connectedTo !== currentConnectedTo) {
            updateAssignments.push(`connected_to = $${parameterIndex}`);
            updateValues.push(fields.connectedTo ?? null);
            parameterIndex += 1;
          }
        }

        if (columnAvailability.tested && fields.tested !== undefined) {
          const currentTested = normalizeDateForComparison(existing.tested);
          if (fields.tested !== currentTested) {
            updateAssignments.push(`tested = $${parameterIndex}`);
            updateValues.push(fields.tested ?? null);
            parameterIndex += 1;
          }
        }

        const shouldResetMaterials = existing.cable_type_id !== type.id;

        if (updateAssignments.length === 0) {
          summary.skipped += 1;
          continue;
        }

        const idParameterIndex = parameterIndex;
        updateAssignments.push('updated_at = NOW()');

        const assignments = updateAssignments.join(',\n                ');

        await client.query(
          `
            UPDATE cables
            SET
              ${assignments}
            WHERE id = $${idParameterIndex};
          `,
          [...updateValues, existing.id]
        );

        if (shouldResetMaterials) {
          await resetCableMaterialsToCableTypeDefaults(
            client,
            projectId,
            existing.id,
            type.id,
            type.name
          );
        }

        summary.updated += 1;
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Import cables error', error);
      res.status(500).json({ error: 'Failed to import cables' });
      return;
    } finally {
      client.release();
    }

    try {
      const refreshed = await pool.query<CableWithTypeRow>(
        `
          ${selectCablesQuery}
          WHERE c.project_id = $1
          ORDER BY LOWER(COALESCE(c.tag, c.cable_id::text)) ASC,
            c.cable_id ASC;
        `,
        [projectId]
      );

      res.json({
        summary,
        cables: refreshed.rows.map(mapCableRow)
      });
    } catch (error) {
      console.error('Fetch cables after import error', error);
      res.status(500).json({
        error: 'Cables imported but failed to refresh list',
        summary
      });
    }
  }
);

cablesRouter.get(
  '/report-summary',
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    const filterQuery =
      typeof req.query.filter === 'string' ? req.query.filter : undefined;
    const filterCriteria = normalizeCableReportFilterCriteria(
      typeof req.query.criteria === 'string' ? req.query.criteria : undefined
    );

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

      const conditions: string[] = ['c.project_id = $1'];
      const values: string[] = [projectId];
      let parameterIndex = 2;

      const normalizedFilter = filterQuery?.trim().toLowerCase() ?? '';

      if (normalizedFilter) {
        const likeParam = `$${parameterIndex}`;
        const filterExpressions =
          filterCriteria === 'tag'
            ? [`LOWER(COALESCE(c.tag, '')) LIKE ${likeParam}`]
            : filterCriteria === 'typeName'
              ? [`LOWER(COALESCE(ct.name, '')) LIKE ${likeParam}`]
              : filterCriteria === 'fromLocation'
                ? [`LOWER(COALESCE(c.from_location, '')) LIKE ${likeParam}`]
                : filterCriteria === 'toLocation'
                  ? [`LOWER(COALESCE(c.to_location, '')) LIKE ${likeParam}`]
                  : filterCriteria === 'routing'
                    ? [`LOWER(COALESCE(c.routing, '')) LIKE ${likeParam}`]
                    : [
                        `LOWER(c.cable_id::text) LIKE ${likeParam}`,
                        `LOWER(COALESCE(c.tag, '')) LIKE ${likeParam}`,
                        `LOWER(COALESCE(ct.name, '')) LIKE ${likeParam}`,
                        `LOWER(COALESCE(c.from_location, '')) LIKE ${likeParam}`,
                        `LOWER(COALESCE(c.to_location, '')) LIKE ${likeParam}`,
                        `LOWER(COALESCE(c.routing, '')) LIKE ${likeParam}`,
                        `LOWER(COALESCE(c.design_length::text, '')) LIKE ${likeParam}`
                      ];

        conditions.push(`(${filterExpressions.join(' OR ')})`);
        values.push(`%${normalizedFilter}%`);
        parameterIndex += 1;
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      const result = await pool.query<CableDetailsRow>(
        `
          ${selectCableDetailsQuery}
          ${whereClause}
          ORDER BY LOWER(COALESCE(ct.name, '')) ASC, c.cable_id ASC;
        `,
        values
      );

      const summary = await buildCableReportSummary(pool, projectId, result.rows);

      res.json({ summary });
    } catch (error) {
      console.error('Fetch cable report summary error', error);
      res.status(500).json({ error: 'Failed to fetch cable report summary' });
    }
  }
);

cablesRouter.get(
  '/export',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    const {
      filter: filterQuery,
      cableTypeId: cableTypeIdQuery,
      sortColumn: sortColumnQuery,
      sortDirection: sortDirectionQuery
    } = req.query as Record<string, string | undefined>;

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

      const conditions: string[] = ['c.project_id = $1'];
      const values: Array<string> = [projectId];
      let parameterIndex = 2;

      if (cableTypeIdQuery) {
        conditions.push(`c.cable_type_id = $${parameterIndex}`);
        values.push(cableTypeIdQuery);
        parameterIndex += 1;
      }

      const normalizedFilter =
        typeof filterQuery === 'string' ? filterQuery.trim().toLowerCase() : '';

      if (normalizedFilter) {
        const likeParam = `$${parameterIndex}`;
        conditions.push(
          `
            (
              LOWER(c.cable_id::text) LIKE ${likeParam}
              OR LOWER(COALESCE(c.tag, '')) LIKE ${likeParam}
              OR LOWER(COALESCE(ct.name, '')) LIKE ${likeParam}
              OR LOWER(COALESCE(c.from_location, '')) LIKE ${likeParam}
              OR LOWER(COALESCE(c.to_location, '')) LIKE ${likeParam}
              OR LOWER(COALESCE(c.routing, '')) LIKE ${likeParam}
            )
          `
        );
        values.push(`%${normalizedFilter}%`);
        parameterIndex += 1;
      }

      const allowedSortColumns = new Set([
        'tag',
        'typeName',
        'fromLocation',
        'toLocation',
        'routing'
      ]);

      const normalizedSortColumn =
        sortColumnQuery && allowedSortColumns.has(sortColumnQuery)
          ? sortColumnQuery
          : 'tag';

      const normalizedSortDirection =
        sortDirectionQuery && sortDirectionQuery.toLowerCase() === 'desc'
          ? 'DESC'
          : 'ASC';

      const sortExpressionMap: Record<string, string> = {
        tag: "LOWER(COALESCE(c.tag, c.cable_id::text))",
        typeName: "LOWER(COALESCE(ct.name, ''))",
        fromLocation: "LOWER(COALESCE(c.from_location, ''))",
        toLocation: "LOWER(COALESCE(c.to_location, ''))",
        routing: "LOWER(COALESCE(c.routing, ''))"
      };

      const sortExpression =
        sortExpressionMap[normalizedSortColumn] ?? 'c.cable_id';

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      const result = await pool.query<CableWithTypeRow>(
        `
          ${selectCablesQuery}
          ${whereClause}
          ORDER BY ${sortExpression} ${normalizedSortDirection}, c.cable_id ASC;
        `,
        values
      );

      const viewParam =
        typeof req.query.view === 'string'
          ? req.query.view.toLowerCase()
          : undefined;
      const exportView = viewParam === 'report' ? 'report' : 'list';

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(
        exportView === 'report' ? 'Cables report' : 'Cables',
        {
          views: [{ state: 'frozen', ySplit: 1 }]
        }
      );

      const columns =
        exportView === 'report'
          ? [
              {
                name: REPORT_OUTPUT_HEADERS.cableId,
                key: 'cableId',
                width: 18
              },
              { name: REPORT_OUTPUT_HEADERS.tag, key: 'tag', width: 20 },
              { name: REPORT_OUTPUT_HEADERS.type, key: 'type', width: 26 },
              {
                name: REPORT_OUTPUT_HEADERS.fromLocation,
                key: 'fromLocation',
                width: 26
              },
              {
                name: REPORT_OUTPUT_HEADERS.toLocation,
                key: 'toLocation',
                width: 26
              },
              {
                name: REPORT_OUTPUT_HEADERS.designLength,
                key: 'designLength',
                width: 18
              },
              {
                name: REPORT_OUTPUT_HEADERS.installLength,
                key: 'installLength',
                width: 18
              },
              {
                name: REPORT_OUTPUT_HEADERS.pullDate,
                key: 'pullDate',
                width: 20
              },
              {
                name: REPORT_OUTPUT_HEADERS.connectedFrom,
                key: 'connectedFrom',
                width: 20
              },
              {
                name: REPORT_OUTPUT_HEADERS.connectedTo,
                key: 'connectedTo',
                width: 20
              },
              { name: REPORT_OUTPUT_HEADERS.tested, key: 'tested', width: 18 }
            ] as const
          : [
              { name: LIST_OUTPUT_HEADERS.cableId, key: 'cableId', width: 18 },
              { name: LIST_OUTPUT_HEADERS.tag, key: 'tag', width: 20 },
              { name: LIST_OUTPUT_HEADERS.type, key: 'type', width: 28 },
              { name: LIST_OUTPUT_HEADERS.purpose, key: 'purpose', width: 30 },
              {
                name: LIST_OUTPUT_HEADERS.diameter,
                key: 'diameter',
                width: 18
              },
              { name: LIST_OUTPUT_HEADERS.weight, key: 'weight', width: 18 },
              {
                name: LIST_OUTPUT_HEADERS.fromLocation,
                key: 'fromLocation',
                width: 26
              },
              {
                name: LIST_OUTPUT_HEADERS.toLocation,
                key: 'toLocation',
                width: 26
              },
              {
                name: LIST_OUTPUT_HEADERS.routing,
                key: 'routing',
                width: 30
              },
              {
                name: LIST_OUTPUT_HEADERS.designLength,
                key: 'designLength',
                width: 18
              }
            ] as const;

      const rows =
        exportView === 'report'
          ? result.rows.map((row: CableWithTypeRow) => [
              row.cable_id ?? '',
              row.tag ?? '',
              row.type_name ?? '',
              row.from_location ?? '',
              row.to_location ?? '',
              row.design_length !== null && row.design_length !== ''
                ? Number(row.design_length)
                : '',
              row.install_length !== null && row.install_length !== ''
                ? Number(row.install_length)
                : '',
              formatDateCell(row.pull_date),
              formatDateCell(row.connected_from),
              formatDateCell(row.connected_to),
              formatDateCell(row.tested)
            ])
          : result.rows.map((row: CableWithTypeRow) => [
              row.cable_id ?? '',
              row.tag ?? '',
              row.type_name ?? '',
              row.type_purpose ?? '',
              row.type_diameter_mm !== null && row.type_diameter_mm !== ''
                ? Number(row.type_diameter_mm)
                : '',
              row.type_weight_kg_per_m !== null && row.type_weight_kg_per_m !== ''
                ? Number(row.type_weight_kg_per_m)
                : '',
              row.from_location ?? '',
              row.to_location ?? '',
              row.routing ?? '',
              row.design_length !== null && row.design_length !== ''
                ? Number(row.design_length)
                : ''
            ]);

      const table = worksheet.addTable({
        name: exportView === 'report' ? 'CablesReport' : 'Cables',
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
        rows: rows.length > 0 ? rows : [Array(columns.length).fill('')]
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
        if (column.key === 'designLength') {
          worksheet.getColumn(index + 1).numFmt = '#,##0';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();

      const projectSegment = sanitizeFileSegment(project.project_number);
      const fileSuffix = exportView === 'report' ? 'cables-report' : 'cable-list';
      const fileName = `${projectSegment}-${fileSuffix}.xlsx`;

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
      console.error('Export cables error', error);
      res.status(500).json({ error: 'Failed to export cables' });
    }
  }
);

cablesRouter.get(
  '/template',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const viewParam =
      typeof req.query.view === 'string'
        ? req.query.view.toLowerCase()
        : undefined;
    const exportView = viewParam === 'report' ? 'report' : 'list';

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(
        exportView === 'report' ? 'Cables report' : 'Cables',
        {
          views: [{ state: 'frozen', ySplit: 1 }]
        }
      );

      const columns =
        exportView === 'report'
          ? [
              {
                name: REPORT_OUTPUT_HEADERS.cableId,
                key: 'cableId',
                width: 18
              },
              { name: REPORT_OUTPUT_HEADERS.tag, key: 'tag', width: 20 },
              { name: REPORT_OUTPUT_HEADERS.type, key: 'type', width: 26 },
              {
                name: REPORT_OUTPUT_HEADERS.fromLocation,
                key: 'fromLocation',
                width: 26
              },
              {
                name: REPORT_OUTPUT_HEADERS.toLocation,
                key: 'toLocation',
                width: 26
              },
              {
                name: REPORT_OUTPUT_HEADERS.designLength,
                key: 'designLength',
                width: 18
              },
              {
                name: REPORT_OUTPUT_HEADERS.installLength,
                key: 'installLength',
                width: 18
              },
              {
                name: REPORT_OUTPUT_HEADERS.pullDate,
                key: 'pullDate',
                width: 20
              },
              {
                name: REPORT_OUTPUT_HEADERS.connectedFrom,
                key: 'connectedFrom',
                width: 20
              },
              {
                name: REPORT_OUTPUT_HEADERS.connectedTo,
                key: 'connectedTo',
                width: 20
              },
              { name: REPORT_OUTPUT_HEADERS.tested, key: 'tested', width: 18 }
            ] as const
          : [
              { name: INPUT_HEADERS.cableId, key: 'cableId', width: 18 },
              { name: INPUT_HEADERS.tag, key: 'tag', width: 20 },
              { name: INPUT_HEADERS.type, key: 'type', width: 28 },
              {
                name: INPUT_HEADERS.fromLocation,
                key: 'fromLocation',
                width: 26
              },
              {
                name: INPUT_HEADERS.toLocation,
                key: 'toLocation',
                width: 26
              },
              {
                name: LIST_OUTPUT_HEADERS.routing,
                key: 'routing',
                width: 24
              },
              {
                name: INPUT_HEADERS.designLength,
                key: 'designLength',
                width: 18
              }
            ] as const;

      const table = worksheet.addTable({
        name: exportView === 'report' ? 'CablesReport' : 'Cables',
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
        rows: [Array(columns.length).fill('')]
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (column.key === 'designLength' || column.key === 'installLength') {
          worksheet.getColumn(index + 1).numFmt = '#,##0';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();

      const fileSuffix = exportView === 'report' ? 'cables-report' : 'cable-list';
      const fileName = `${fileSuffix}-template.xlsx`;

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
      console.error('Generate cables template error', error);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  }
);

export { cablesRouter };







