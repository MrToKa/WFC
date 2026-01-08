import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { pool } from '../db.js';
import { mapProjectRow } from '../models/project.js';
import type { ProjectRow } from '../models/project.js';
import { authenticate, requireAdmin } from '../middleware.js';
import {
  createProjectSchema,
  updateProjectSchema
} from '../validators.js';
import { ensureProjectExists } from '../services/projectService.js';
import { cableTypesRouter } from './cableTypesRoutes.js';
import { cablesRouter } from './cablesRoutes.js';
import { traysRouter } from './traysRoutes.js';
import { projectFilesRouter } from './projectFilesRoutes.js';

const projectsRouter = Router();
const INVALID_TRAY_TEMPLATE_FILE = 'INVALID_TRAY_TEMPLATE_FILE';

type NormalizedSupportOverrides = Record<
  string,
  {
    distance: number | null;
    supportId: string | null;
  }
>;

type NormalizedTrayPurposeTemplates = Record<
  string,
  {
    fileId: string;
  }
>;

const syncSupportDistances = async (
  projectId: string,
  overrides: NormalizedSupportOverrides
): Promise<void> => {
  const entries = Object.entries(overrides)
    .map(([trayType, value]) => [trayType.trim(), value] as const)
    .filter(
      ([trayType, value]) =>
        trayType !== '' && (value.distance !== null || value.supportId !== null)
    );

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM project_support_distances WHERE project_id = $1;`,
      [projectId]
    );

    for (const [trayType, value] of entries) {
      await client.query(
        `
          INSERT INTO project_support_distances (
            project_id,
            tray_type,
            support_distance,
            support_id,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (project_id, tray_type)
          DO UPDATE
          SET
            support_distance = EXCLUDED.support_distance,
            support_id = EXCLUDED.support_id,
            updated_at = NOW();
        `,
        [projectId, trayType, value.distance, value.supportId]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const syncTrayPurposeTemplates = async (
  projectId: string,
  templates: NormalizedTrayPurposeTemplates
): Promise<void> => {
  const entries = Object.entries(templates)
    .map(([purpose, value]) => [purpose.trim(), value] as const)
    .filter(([purpose]) => purpose !== '');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM project_tray_purpose_templates WHERE project_id = $1;`,
      [projectId]
    );

    if (entries.length > 0) {
      const fileIds = Array.from(new Set(entries.map(([, value]) => value.fileId)));
      if (fileIds.length > 0) {
        const { rows } = await client.query<{ id: string }>(
          `
            SELECT id
            FROM project_files
            WHERE project_id = $1
              AND id = ANY($2::uuid[])
          `,
          [projectId, fileIds]
        );
        if (rows.length !== fileIds.length) {
          throw new Error(INVALID_TRAY_TEMPLATE_FILE);
        }
      }
    }

    for (const [purpose, value] of entries) {
      await client.query(
        `
          INSERT INTO project_tray_purpose_templates (
            project_id,
            tray_purpose,
            project_file_id,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, NOW(), NOW())
          ON CONFLICT (project_id, tray_purpose)
          DO UPDATE
          SET
            project_file_id = EXCLUDED.project_file_id,
            updated_at = NOW();
        `,
        [projectId, purpose, value.fileId]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

type SupportOverrideInput =
  | {
      distance?: unknown;
      supportId?: unknown;
    }
  | number
  | null
  | undefined;

type TrayPurposeTemplateInput =
  | {
      fileId?: unknown;
    }
  | string
  | null
  | undefined;

type CableBundleSpacingInput = '0' | '1D' | '2D';

type CableCategorySettingsInput =
  | {
      maxRows?: number | null;
      maxColumns?: number | null;
      bundleSpacing?: CableBundleSpacingInput | null;
      trefoil?: boolean | null;
      trefoilSpacingBetweenBundles?: boolean | null;
      applyPhaseRotation?: boolean | null;
    }
  | null
  | undefined;

type CustomBundleRangeInput = {
  id: string;
  min: number;
  max: number;
};

type CustomBundleRangesInput = {
  mv?: CustomBundleRangeInput[];
  power?: CustomBundleRangeInput[];
  vfd?: CustomBundleRangeInput[];
  control?: CustomBundleRangeInput[];
} | null;

type CableLayoutInput =
  | {
      cableSpacing?: number | null;
      considerBundleSpacingAsFree?: boolean | null;
      minFreeSpacePercent?: number | null;
      maxFreeSpacePercent?: number | null;
      mv?: CableCategorySettingsInput;
      power?: CableCategorySettingsInput;
      vfd?: CableCategorySettingsInput;
      control?: CableCategorySettingsInput;
      customBundleRanges?: CustomBundleRangesInput;
    }
  | null
  | undefined;

type NormalizedCableCategorySettings = {
  maxRows: number | null;
  maxColumns: number | null;
  bundleSpacing: CableBundleSpacingInput | null;
  trefoil: boolean | null;
  trefoilSpacingBetweenBundles: boolean | null;
  applyPhaseRotation: boolean | null;
};

const normalizeSupportDistances = (
  distances: Record<string, SupportOverrideInput>
): NormalizedSupportOverrides => {
  const parseNumeric = (value: unknown): number | null => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().replace(',', '.');
      if (normalized === '') {
        return null;
      }
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  };

  return Object.entries(distances).reduce<NormalizedSupportOverrides>(
    (acc, [trayType, rawValue]) => {
      const normalizedTrayType = trayType.trim();
      if (normalizedTrayType === '') {
        return acc;
      }

      let distance: number | null = null;
      let supportId: string | null = null;

      if (
        rawValue !== null &&
        rawValue !== undefined &&
        typeof rawValue === 'object' &&
        !Array.isArray(rawValue)
      ) {
        const candidate = rawValue as {
          distance?: unknown;
          supportId?: unknown;
        };

        if (candidate.distance !== undefined) {
          distance = candidate.distance === null ? null : parseNumeric(candidate.distance);
        }

        if (candidate.supportId !== undefined) {
          if (
            candidate.supportId === null ||
            (typeof candidate.supportId === 'string' &&
              candidate.supportId.trim() === '')
          ) {
            supportId = null;
          } else if (typeof candidate.supportId === 'string') {
            supportId = candidate.supportId.trim();
          }
        }
      } else {
        distance = parseNumeric(rawValue);
      }

      if (distance === null && supportId === null) {
        return acc;
      }

      acc[normalizedTrayType] = { distance, supportId };
      return acc;
    },
    {}
  );
};

const normalizeTrayPurposeTemplates = (
  templates: Record<string, TrayPurposeTemplateInput>
): NormalizedTrayPurposeTemplates => {
  return Object.entries(templates).reduce<NormalizedTrayPurposeTemplates>(
    (acc, [purpose, rawValue]) => {
      const normalizedPurpose = purpose.trim();
      if (normalizedPurpose === '') {
        return acc;
      }

      let fileId: string | null = null;

      if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim();
        fileId = trimmed === '' ? null : trimmed;
      } else if (
        rawValue !== null &&
        rawValue !== undefined &&
        typeof rawValue === 'object' &&
        !Array.isArray(rawValue) &&
        'fileId' in rawValue
      ) {
        const candidate = (rawValue as { fileId?: unknown }).fileId;
        if (typeof candidate === 'string') {
          const trimmed = candidate.trim();
          fileId = trimmed === '' ? null : trimmed;
        }
      }

      if (fileId) {
        acc[normalizedPurpose] = { fileId };
      }

      return acc;
    },
    {}
  );
};

const normalizeCableCategory = (
  settings: CableCategorySettingsInput
): NormalizedCableCategorySettings | null => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return null;
  }

  const maxRows =
    settings.maxRows === undefined || settings.maxRows === null
      ? null
      : Number.isInteger(settings.maxRows)
      ? settings.maxRows
      : null;
  const maxColumns =
    settings.maxColumns === undefined || settings.maxColumns === null
      ? null
      : Number.isInteger(settings.maxColumns)
      ? settings.maxColumns
      : null;
  const bundleSpacing =
    settings.bundleSpacing === undefined ? null : settings.bundleSpacing ?? null;
  const trefoil =
    settings.trefoil === undefined
      ? null
      : settings.trefoil === null
      ? null
      : settings.trefoil;
  const trefoilSpacingBetweenBundles =
    settings.trefoilSpacingBetweenBundles === undefined
      ? null
      : settings.trefoilSpacingBetweenBundles === null
      ? null
      : settings.trefoilSpacingBetweenBundles;
  const applyPhaseRotation =
    settings.applyPhaseRotation === undefined
      ? null
      : settings.applyPhaseRotation === null
      ? null
      : settings.applyPhaseRotation;

  if (
    maxRows === null &&
    maxColumns === null &&
    bundleSpacing === null &&
    trefoil === null &&
    trefoilSpacingBetweenBundles === null &&
    applyPhaseRotation === null
  ) {
    return null;
  }

  return {
    maxRows,
    maxColumns,
    bundleSpacing,
    trefoil,
    trefoilSpacingBetweenBundles,
    applyPhaseRotation
  };
};

const normalizeCableLayout = (
  layout: CableLayoutInput
): Record<string, unknown> | null => {
  if (layout === null || layout === undefined) {
    return null;
  }

  if (typeof layout !== 'object' || Array.isArray(layout)) {
    return null;
  }

  const normalized: Record<string, unknown> = {};

  if ('cableSpacing' in layout) {
    const value = layout.cableSpacing;
    normalized.cableSpacing =
      value === null || value === undefined
        ? null
        : Number.isFinite(value)
        ? Math.round(value * 1000) / 1000
        : null;
  }

  if ('considerBundleSpacingAsFree' in layout) {
    const value = layout.considerBundleSpacingAsFree;
    normalized.considerBundleSpacingAsFree =
      value === null || value === undefined ? null : Boolean(value);
  }

  if ('minFreeSpacePercent' in layout) {
    const value = layout.minFreeSpacePercent;
    normalized.minFreeSpacePercent =
      value === null || value === undefined
        ? null
        : Number.isFinite(value)
        ? Math.min(100, Math.max(1, Math.round(value)))
        : null;
  }

  if ('maxFreeSpacePercent' in layout) {
    const value = layout.maxFreeSpacePercent;
    normalized.maxFreeSpacePercent =
      value === null || value === undefined
        ? null
        : Number.isFinite(value)
        ? Math.min(100, Math.max(1, Math.round(value)))
        : null;
  }

  const assignCategory = (
    key: 'mv' | 'power' | 'vfd' | 'control',
    value: CableCategorySettingsInput
  ) => {
    const normalizedCategory = normalizeCableCategory(value);
    if (normalizedCategory) {
      normalized[key] = normalizedCategory;
    } else if (value !== undefined) {
      normalized[key] = null;
    }
  };

  if ('mv' in layout) {
    assignCategory('mv', layout.mv);
  }
  if ('power' in layout) {
    assignCategory('power', layout.power);
  }
  if ('vfd' in layout) {
    assignCategory('vfd', layout.vfd);
  }
  if ('control' in layout) {
    assignCategory('control', layout.control);
  }

  // Handle customBundleRanges
  if ('customBundleRanges' in layout) {
    const customRanges = layout.customBundleRanges;
    if (customRanges === null) {
      normalized.customBundleRanges = null;
    } else if (customRanges && typeof customRanges === 'object') {
      const normalizedRanges: Record<string, Array<{ id: string; min: number; max: number }>> = {};
      const validCategories = ['mv', 'power', 'vfd', 'control'] as const;
      let hasRanges = false;

      for (const category of validCategories) {
        const categoryRanges = customRanges[category];
        if (Array.isArray(categoryRanges) && categoryRanges.length > 0) {
          normalizedRanges[category] = categoryRanges
            .filter(
              (r): r is CustomBundleRangeInput =>
                r !== null &&
                typeof r === 'object' &&
                typeof r.id === 'string' &&
                typeof r.min === 'number' &&
                typeof r.max === 'number' &&
                r.max > r.min
            )
            .map((r) => ({
              id: r.id,
              min: Math.round(r.min * 10) / 10,
              max: Math.round(r.max * 10) / 10
            }));
          if (normalizedRanges[category].length > 0) {
            hasRanges = true;
          } else {
            delete normalizedRanges[category];
          }
        }
      }

      normalized.customBundleRanges = hasRanges ? normalizedRanges : null;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
};

projectsRouter.get(
  '/',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<ProjectRow>(
        `
          SELECT
            p.id,
            p.project_number,
            p.name,
            p.customer,
            p.manager,
            p.description,
            p.secondary_tray_length,
            p.support_distance,
            p.support_weight,
            p.tray_load_safety_factor,
            p.cable_layout_settings,
            COALESCE(
              (
                SELECT jsonb_object_agg(
                  d.tray_type,
                  jsonb_build_object(
                    'distance', d.support_distance,
                    'supportId', d.support_id,
                    'supportType', s.support_type
                  )
                )
                FROM project_support_distances d
                LEFT JOIN material_supports s ON s.id = d.support_id
                WHERE d.project_id = p.id
              ),
              '{}'::jsonb
            ) AS support_distances,
            p.created_at,
            p.updated_at
          FROM projects p
          ORDER BY p.created_at DESC;
        `
      );
      res.json({ projects: result.rows.map(mapProjectRow) });
    } catch (error) {
      console.error('List projects error', error);
      res.status(500).json({ error: 'Failed to fetch projects' });
    }
  }
);

projectsRouter.get(
  '/:projectId',
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

      res.json({ project: mapProjectRow(project) });
    } catch (error) {
      console.error('Fetch project error', error);
      res.status(500).json({ error: 'Failed to fetch project details' });
    }
  }
);

projectsRouter.post(
  '/',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parseResult = createProjectSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const {
      projectNumber,
      name,
      customer,
      description,
      manager,
      secondaryTrayLength,
      supportDistance,
      supportWeight,
      trayLoadSafetyFactor,
      cableLayout,
      supportDistances
    } = parseResult.data;
    const projectId = randomUUID();
    const normalizedDescription =
      description === undefined ? undefined : description.trim();
    const normalizedManager = manager === undefined ? undefined : manager.trim();
    const normalizedCableLayout = normalizeCableLayout(cableLayout);

    try {
      await pool.query<{ id: string }>(
        `
          INSERT INTO projects (
            id,
            project_number,
            name,
            customer,
            manager,
            description,
            secondary_tray_length,
            support_distance,
            support_weight,
            tray_load_safety_factor,
            cable_layout_settings
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id;
        `,
        [
          projectId,
          projectNumber.trim(),
          name.trim(),
          customer.trim(),
          normalizedManager === undefined || normalizedManager === ''
            ? null
            : normalizedManager,
          normalizedDescription === undefined || normalizedDescription === ''
            ? null
            : normalizedDescription,
          secondaryTrayLength ?? null,
          supportDistance ?? null,
          supportWeight ?? null,
          trayLoadSafetyFactor ?? null,
          normalizedCableLayout
        ]
      );

      if (supportDistances !== undefined) {
        await syncSupportDistances(projectId, normalizeSupportDistances(supportDistances));
      }

      const projectRow = await ensureProjectExists(projectId);

      if (!projectRow) {
        res.status(500).json({ error: 'Failed to create project' });
        return;
      }

      res.status(201).json({ project: mapProjectRow(projectRow) });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === INVALID_TRAY_TEMPLATE_FILE
        ) {
          res.status(400).json({
            error: 'Tray report template must reference a file attached to this project.'
          });
          return;
        }

        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === '23505'
      ) {
        res.status(409).json({ error: 'Project number already in use' });
        return;
      }

      console.error('Create project error', error);
      res.status(500).json({ error: 'Failed to create project' });
    }
  }
);

projectsRouter.patch(
  '/:projectId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    const parseResult = updateProjectSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

      const {
        projectNumber,
        name,
        customer,
        description,
        manager,
        supportDistances,
        trayPurposeTemplates,
        cableLayout
      } = parseResult.data;

    const fields: string[] = [];
    const values: Array<string | number | null | Record<string, unknown>> = [];
    let index = 1;

    if (projectNumber !== undefined) {
      fields.push(`project_number = $${index++}`);
      values.push(projectNumber.trim());
    }

    if (name !== undefined) {
      fields.push(`name = $${index++}`);
      values.push(name.trim());
    }

    if (customer !== undefined) {
      fields.push(`customer = $${index++}`);
      values.push(customer.trim());
    }

    if (manager !== undefined) {
      const normalized = manager.trim();
      fields.push(`manager = $${index++}`);
      values.push(normalized === '' ? null : normalized);
    }

    if (description !== undefined) {
      const normalized = description.trim();
      fields.push(`description = $${index++}`);
      values.push(normalized === '' ? null : normalized);
    }

    if (parseResult.data.secondaryTrayLength !== undefined) {
      fields.push(`secondary_tray_length = $${index++}`);
      values.push(parseResult.data.secondaryTrayLength);
    }

    if (parseResult.data.supportDistance !== undefined) {
      fields.push(`support_distance = $${index++}`);
      values.push(parseResult.data.supportDistance);
    }

    if (parseResult.data.supportWeight !== undefined) {
      fields.push(`support_weight = $${index++}`);
      values.push(parseResult.data.supportWeight);
    }

    if (parseResult.data.trayLoadSafetyFactor !== undefined) {
      fields.push(`tray_load_safety_factor = $${index++}`);
      values.push(parseResult.data.trayLoadSafetyFactor);
    }

    if (parseResult.data.cableLayout !== undefined) {
      const normalizedCableLayout = normalizeCableLayout(cableLayout);
      fields.push(
        `cable_layout_settings = CASE WHEN $${index}::jsonb IS NULL THEN NULL ELSE COALESCE(cable_layout_settings, '{}'::jsonb) || $${index}::jsonb END`
      );
      values.push(normalizedCableLayout);
      index += 1;
    }

    fields.push(`updated_at = NOW()`);

    try {
      const result = await pool.query<{ id: string }>(
        `
          UPDATE projects
          SET ${fields.join(', ')}
          WHERE id = $${index}
          RETURNING id;
        `,
        [...values, projectId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

        if (supportDistances !== undefined) {
          await syncSupportDistances(
            projectId,
            normalizeSupportDistances(supportDistances)
          );
        }

        if (trayPurposeTemplates !== undefined) {
          await syncTrayPurposeTemplates(
            projectId,
            normalizeTrayPurposeTemplates(trayPurposeTemplates)
          );
        }

      const projectRow = await ensureProjectExists(projectId);

      if (!projectRow) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      res.json({ project: mapProjectRow(projectRow) });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        res.status(409).json({ error: 'Project number already in use' });
        return;
      }

      console.error('Update project error', error);
      res.status(500).json({ error: 'Failed to update project' });
    }
  }
);

projectsRouter.delete(
  '/:projectId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    try {
      const result = await pool.query(
        `DELETE FROM projects WHERE id = $1 RETURNING id`,
        [projectId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete project error', error);
      res.status(500).json({ error: 'Failed to delete project' });
    }
  }
);

projectsRouter.use('/:projectId/cable-types', cableTypesRouter);
projectsRouter.use('/:projectId/cables', cablesRouter);
projectsRouter.use('/:projectId/trays', traysRouter);
projectsRouter.use('/:projectId/files', projectFilesRouter);

export { projectsRouter };
