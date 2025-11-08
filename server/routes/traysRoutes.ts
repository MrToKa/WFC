import { randomUUID } from 'crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { pool } from '../db.js';
import { mapTrayRow } from '../models/tray.js';
import type { PublicTray, TrayRow } from '../models/tray.js';
import { mapProjectRow } from '../models/project.js';
import {
  computeTrayFreeSpaceByTrayId,
  type TrayCableForFreeSpace
} from '../utils/trayFreeSpace.js';
import { authenticate, requireAdmin } from '../middleware.js';
import { ensureProjectExists } from '../services/projectService.js';
import { createTraySchema, updateTraySchema } from '../validators.js';

const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE }
});

const TRAY_EXCEL_HEADERS = {
  name: 'Name',
  type: 'Type',
  purpose: 'Purpose',
  width: 'Width [mm]',
  height: 'Height [mm]',
  length: 'Length [mm]',
  freeSpace: 'Cable tray free space [%]'
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

const toNumberOrNull = (value: string | number | null): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  let normalized = value.trim();

  if (normalized === '') {
    return null;
  }

  normalized = normalized.replace(/\s*(mm|m)$/i, '').trim();
  normalized = normalized.replace(/\s+/g, '');

  if (normalized.includes(',') && normalized.includes('.')) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const selectTraysQuery = `
  SELECT
    id,
    project_id,
    name,
    tray_type,
    purpose,
    width_mm,
    height_mm,
    length_mm,
    include_grounding_cable,
    grounding_cable_type_id,
    created_at,
    updated_at
  FROM trays
`;

type CableFreeSpaceRow = {
  routing: string | null;
  purpose: string | null;
  diameter_mm: string | number | null;
};

const selectTrayCablesQuery = `
  SELECT
    c.routing,
    ct.purpose AS purpose,
    ct.diameter_mm AS diameter_mm
  FROM cables c
  JOIN cable_types ct ON ct.id = c.cable_type_id
  WHERE c.project_id = $1;
`;

type TrayImportRequest = Request & {
  params: {
    projectId?: string;
  };
  file?: {
    buffer: Buffer;
    originalname?: string;
  };
};

type TrayExportBody = {
  freeSpaceByTrayId?: Record<string, unknown>;
};

const traysRouter = Router({ mergeParams: true });

traysRouter.get('/', async (req: Request, res: Response): Promise<void> => {
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

    const result = await pool.query<TrayRow>(
      `
        ${selectTraysQuery}
        WHERE project_id = $1
        ORDER BY name ASC;
      `,
      [projectId]
    );

    res.json({ trays: result.rows.map(mapTrayRow) });
  } catch (error) {
    console.error('List trays error', error);
    res.status(500).json({ error: 'Failed to fetch trays' });
  }
});

traysRouter.get(
  '/template',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    try {
      const projectRow = await ensureProjectExists(projectId);

      if (!projectRow) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const project = mapProjectRow(projectRow);

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Trays', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      const columns = [
        { name: TRAY_EXCEL_HEADERS.name, key: 'name', width: 30 },
        { name: TRAY_EXCEL_HEADERS.type, key: 'type', width: 24 },
        { name: TRAY_EXCEL_HEADERS.purpose, key: 'purpose', width: 36 },
        { name: TRAY_EXCEL_HEADERS.length, key: 'length', width: 18 }
      ] as const;

      const table = worksheet.addTable({
        name: 'Trays',
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
        const excelColumn = worksheet.getColumn(index + 1);
        excelColumn.width = column.width;

        if (column.key === 'length') {
          excelColumn.numFmt = '#,##0.00';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();

      const projectSegment = sanitizeFileSegment(project.projectNumber);
      const fileName = `${projectSegment}-trays-template.xlsx`;

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
      console.error('Generate trays template error', error);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  }
);

traysRouter.post(
  '/export',
  authenticate,
  requireAdmin,
  async (
    req: Request<{ projectId?: string }, unknown, TrayExportBody>,
    res: Response
  ): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    try {
      const projectRow = await ensureProjectExists(projectId);

      if (!projectRow) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const [traysResult, cablesResult] = await Promise.all([
        pool.query<TrayRow>(
          `
            ${selectTraysQuery}
            WHERE project_id = $1
            ORDER BY name ASC;
          `,
          [projectId]
        ),
        pool.query<CableFreeSpaceRow>(selectTrayCablesQuery, [projectId])
      ]);

      const trays = traysResult.rows.map(mapTrayRow);
      const project = mapProjectRow(projectRow);

      const cables: TrayCableForFreeSpace[] = cablesResult.rows.map(
        (row: CableFreeSpaceRow) => ({
          routing: row.routing ?? null,
          purpose: row.purpose ?? null,
          diameterMm: toNumberOrNull(row.diameter_mm)
        })
      );

      const computedFreeSpaceByTrayId = computeTrayFreeSpaceByTrayId({
        trays,
        cables,
        layout: project.cableLayout
      });

      const providedMap = req.body?.freeSpaceByTrayId;
      const sanitizedProvided: Record<string, number | null> = {};

      if (providedMap && typeof providedMap === 'object' && !Array.isArray(providedMap)) {
        for (const [trayId, value] of Object.entries(providedMap)) {
          if (value === null) {
            sanitizedProvided[trayId] = null;
            continue;
          }

          if (typeof value === 'number') {
            if (Number.isFinite(value)) {
              sanitizedProvided[trayId] = value;
            }
            continue;
          }

          if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
              sanitizedProvided[trayId] = parsed;
            }
          }
        }
      }

      const freeSpaceByTrayId: Record<string, number | null> = {
        ...computedFreeSpaceByTrayId
      };

      for (const [trayId, value] of Object.entries(sanitizedProvided)) {
        freeSpaceByTrayId[trayId] = value;
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Trays', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      const columns = [
        { name: TRAY_EXCEL_HEADERS.name, key: 'name', width: 30 },
        { name: TRAY_EXCEL_HEADERS.type, key: 'type', width: 24 },
        { name: TRAY_EXCEL_HEADERS.purpose, key: 'purpose', width: 36 },
        { name: TRAY_EXCEL_HEADERS.width, key: 'width', width: 18 },
        { name: TRAY_EXCEL_HEADERS.height, key: 'height', width: 18 },
        { name: TRAY_EXCEL_HEADERS.length, key: 'length', width: 18 },
        { name: TRAY_EXCEL_HEADERS.freeSpace, key: 'freeSpace', width: 24 }
      ] as const;

      const rows = trays.map((tray: PublicTray) => {
        const freeSpacePercent = freeSpaceByTrayId[tray.id];
        const roundedFreeSpace =
          typeof freeSpacePercent === 'number' && Number.isFinite(freeSpacePercent)
            ? Math.round(freeSpacePercent * 100) / 100
            : null;

        return [
          tray.name,
          tray.type ?? '',
          tray.purpose ?? '',
          tray.widthMm ?? '',
          tray.heightMm ?? '',
          tray.lengthMm ?? '',
          roundedFreeSpace ?? ''
        ];
      });

      const table = worksheet.addTable({
        name: 'Trays',
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
        rows: rows.length > 0 ? rows : [['', '', '', '', '', '', '']]
      });

      table.commit();

      columns.forEach((column, index) => {
        const excelColumn = worksheet.getColumn(index + 1);
        excelColumn.width = column.width;

        if (column.key === 'width' || column.key === 'height') {
          excelColumn.numFmt = '#,##0.00';
        } else if (column.key === 'length') {
          excelColumn.numFmt = '#,##0.00';
        } else if (column.key === 'freeSpace') {
          excelColumn.numFmt = '0.00" %"';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();

      const projectSegment = sanitizeFileSegment(project.projectNumber);
      const fileName = `${projectSegment}-trays.xlsx`;

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
      console.error('Export trays error', error);
      res.status(500).json({ error: 'Failed to export trays' });
    }
  }
);

traysRouter.get(
  '/:trayId',
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, trayId } = req.params;

    if (!projectId || !trayId) {
      res
        .status(400)
        .json({ error: 'Project ID and tray ID are required' });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const result = await pool.query<TrayRow>(
        `
          ${selectTraysQuery}
          WHERE id = $1
            AND project_id = $2;
        `,
        [trayId, projectId]
      );

      const tray = result.rows[0];

      if (!tray) {
        res.status(404).json({ error: 'Tray not found' });
        return;
      }

      res.json({ tray: mapTrayRow(tray) });
    } catch (error) {
      console.error('Fetch tray error', error);
      res.status(500).json({ error: 'Failed to fetch tray' });
    }
  }
);

traysRouter.post(
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
      console.error('Verify project for tray create error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    const parseResult = createTraySchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const { name, type, purpose, widthMm, heightMm, lengthMm } =
      parseResult.data;

    try {
      const result = await pool.query<TrayRow>(
        `
          INSERT INTO trays (
            id,
            project_id,
            name,
            tray_type,
            purpose,
            width_mm,
            height_mm,
            length_mm
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING
            id,
            project_id,
            name,
            tray_type,
            purpose,
            width_mm,
            height_mm,
            length_mm,
            include_grounding_cable,
            grounding_cable_type_id,
            created_at,
            updated_at;
        `,
        [
          randomUUID(),
          projectId,
          name.trim(),
          normalizeOptionalString(type ?? null),
          normalizeOptionalString(purpose ?? null),
          widthMm ?? null,
          heightMm ?? null,
          lengthMm ?? null
        ]
      );

      res.status(201).json({ tray: mapTrayRow(result.rows[0]) });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        res
          .status(409)
          .json({ error: 'A tray with this name already exists for the project' });
        return;
      }

      console.error('Create tray error', error);
      res.status(500).json({ error: 'Failed to create tray' });
    }
  }
);

traysRouter.patch(
  '/:trayId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, trayId } = req.params;

    if (!projectId || !trayId) {
      res
        .status(400)
        .json({ error: 'Project ID and tray ID are required' });
      return;
    }

    const parseResult = updateTraySchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const {
      name,
      type,
      purpose,
      widthMm,
      heightMm,
      lengthMm,
      includeGroundingCable,
      groundingCableTypeId
    } = parseResult.data;

    if (
      groundingCableTypeId !== undefined &&
      groundingCableTypeId !== null
    ) {
      try {
        const cableTypeResult = await pool.query(
          `
            SELECT project_id
            FROM cable_types
            WHERE id = $1;
          `,
          [groundingCableTypeId]
        );

        if (
          cableTypeResult.rowCount === 0 ||
          cableTypeResult.rows[0]?.project_id !== projectId
        ) {
          res.status(400).json({
            error: 'Grounding cable type does not belong to this project'
          });
          return;
        }
      } catch (error) {
        console.error('Validate grounding cable type error', error);
        res.status(500).json({ error: 'Failed to update tray' });
        return;
      }
    }

    if (name !== undefined) {
      try {
        const duplicate = await pool.query(
          `
            SELECT id
            FROM trays
            WHERE project_id = $1
              AND id <> $2
              AND lower(name) = lower($3);
          `,
          [projectId, trayId, name.trim()]
        );

        if (duplicate.rowCount > 0) {
          res
            .status(409)
            .json({ error: 'A tray with this name already exists for the project' });
          return;
        }
      } catch (error) {
        console.error('Duplicate tray name check error', error);
        res.status(500).json({ error: 'Failed to update tray' });
        return;
      }
    }

    const fields: string[] = [];
    const values: Array<string | number | boolean | null> = [];
    let index = 1;

    if (name !== undefined) {
      fields.push(`name = $${index++}`);
      values.push(name.trim());
    }
    if (type !== undefined) {
      fields.push(`tray_type = $${index++}`);
      values.push(normalizeOptionalString(type) ?? null);
    }
    if (purpose !== undefined) {
      fields.push(`purpose = $${index++}`);
      values.push(normalizeOptionalString(purpose) ?? null);
    }
    if (widthMm !== undefined) {
      fields.push(`width_mm = $${index++}`);
      values.push(widthMm ?? null);
    }
    if (heightMm !== undefined) {
      fields.push(`height_mm = $${index++}`);
      values.push(heightMm ?? null);
    }
    if (lengthMm !== undefined) {
      fields.push(`length_mm = $${index++}`);
      values.push(lengthMm ?? null);
    }
    if (includeGroundingCable !== undefined) {
      fields.push(`include_grounding_cable = $${index++}`);
      values.push(includeGroundingCable);
    }
    if (groundingCableTypeId !== undefined) {
      fields.push(`grounding_cable_type_id = $${index++}`);
      values.push(groundingCableTypeId);
    }

    fields.push(`updated_at = NOW()`);

    try {
      const result = await pool.query<TrayRow>(
        `
          UPDATE trays
          SET ${fields.join(', ')}
          WHERE id = $${index}
            AND project_id = $${index + 1}
          RETURNING
            id,
            project_id,
            name,
            tray_type,
            purpose,
            width_mm,
            height_mm,
            length_mm,
            include_grounding_cable,
            grounding_cable_type_id,
            created_at,
            updated_at;
        `,
        [...values, trayId, projectId]
      );

      const tray = result.rows[0];

      if (!tray) {
        res.status(404).json({ error: 'Tray not found' });
        return;
      }

      res.json({ tray: mapTrayRow(tray) });
    } catch (error) {
      console.error('Update tray error', error);
      res.status(500).json({ error: 'Failed to update tray' });
    }
  }
);

traysRouter.delete(
  '/:trayId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, trayId } = req.params;

    if (!projectId || !trayId) {
      res
        .status(400)
        .json({ error: 'Project ID and tray ID are required' });
      return;
    }

    try {
      const result = await pool.query(
        `
          DELETE FROM trays
          WHERE id = $1
            AND project_id = $2;
        `,
        [trayId, projectId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Tray not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete tray error', error);
      res.status(500).json({ error: 'Failed to delete tray' });
    }
  }
);

traysRouter.post(
  '/import',
  authenticate,
  requireAdmin,
  upload.single('file'),
  async (req: TrayImportRequest, res: Response): Promise<void> => {
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
      console.error('Verify project for tray import error', error);
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
      console.error('Read tray import workbook error', error);
      res.status(400).json({ error: 'Failed to read Excel workbook' });
      return;
    }

    type TrayImportRow = Record<string, unknown>;

    const rows = XLSX.utils.sheet_to_json<TrayImportRow>(worksheet, {
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
      type: string | null;
      typeKey: string | null;
      purpose: string | null;
      width: number | null;
      height: number | null;
      length: number | null;
    }> = [];

    const seenNames = new Set<string>();

    for (const row of rows) {
      const rawName = row[TRAY_EXCEL_HEADERS.name] as unknown;
      const name =
        typeof rawName === 'number'
          ? String(rawName)
          : String(rawName ?? '').trim();

      if (name === '') {
        summary.skipped += 1;
        continue;
      }

      const key = name.toLowerCase();

      if (seenNames.has(key)) {
        summary.skipped += 1;
        continue;
      }

      seenNames.add(key);

      const typeValue = normalizeOptionalString(
        row[TRAY_EXCEL_HEADERS.type] as string | null | undefined
      );

      prepared.push({
        key,
        name,
        type: typeValue,
        typeKey: typeValue ? typeValue.toLowerCase() : null,
        purpose: normalizeOptionalString(
          row[TRAY_EXCEL_HEADERS.purpose] as string | null | undefined
        ),
        width: toNumberOrNull(
          row[TRAY_EXCEL_HEADERS.width] as string | number | null
        ),
        height: toNumberOrNull(
          row[TRAY_EXCEL_HEADERS.height] as string | number | null
        ),
        length: toNumberOrNull(
          row[TRAY_EXCEL_HEADERS.length] as string | number | null
        )
      });
    }

    if (prepared.length === 0) {
      try {
        const existing = await pool.query<TrayRow>(
          `
            ${selectTraysQuery}
            WHERE project_id = $1
            ORDER BY name ASC;
          `,
          [projectId]
        );

        res.json({
          summary,
          trays: existing.rows.map(mapTrayRow)
        });
      } catch (error) {
        console.error('Fetch trays after empty import error', error);
        res.status(500).json({
          error: 'No rows imported and failed to fetch existing trays',
          summary
        });
      }
      return;
    }

    const materialDimensionsByType = new Map<
      string,
      { width: number | null; height: number | null }
    >();

    const materialTypeKeys = Array.from(
      new Set(
        prepared
          .map((row) => row.typeKey)
          .filter((typeKey): typeKey is string => Boolean(typeKey))
      )
    );

    if (materialTypeKeys.length > 0) {
      // Enrich tray imports with catalog dimensions when a matching type exists.
      try {
        const result = await pool.query<{
          tray_type: string;
          width_mm: string | number | null;
          height_mm: string | number | null;
        }>(
          `
            SELECT
              tray_type,
              width_mm,
              height_mm
            FROM material_trays
            WHERE LOWER(tray_type) = ANY($1::text[]);
          `,
          [materialTypeKeys]
        );

        for (const row of result.rows) {
          const key = row.tray_type.toLowerCase();
          materialDimensionsByType.set(key, {
            width: toNumberOrNull(row.width_mm),
            height: toNumberOrNull(row.height_mm)
          });
        }
      } catch (error) {
        console.error('Fetch material tray dimensions error', error);
      }
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const existingResult = await client.query<TrayRow>(
        `
          ${selectTraysQuery}
          WHERE project_id = $1
            AND lower(name) = ANY($2::text[]);
        `,
        [projectId, prepared.map((row) => row.key)]
      );

      const existingMap = new Map<string, TrayRow>();

      for (const existing of existingResult.rows) {
        existingMap.set(existing.name.toLowerCase(), existing);
      }

      for (const row of prepared) {
        const dimensions =
          row.typeKey !== null
            ? materialDimensionsByType.get(row.typeKey)
            : undefined;
        const widthMm = dimensions?.width ?? row.width ?? null;
        const heightMm = dimensions?.height ?? row.height ?? null;

        const existing = existingMap.get(row.key);

        if (existing) {
          await client.query(
            `
              UPDATE trays
              SET
                tray_type = $1,
                purpose = $2,
                width_mm = $3,
                height_mm = $4,
                length_mm = $5,
                updated_at = NOW()
              WHERE id = $6;
            `,
            [
              row.type,
              row.purpose,
              widthMm,
              heightMm,
              row.length,
              existing.id
            ]
          );
          summary.updated += 1;
        } else {
          await client.query(
            `
              INSERT INTO trays (
                id,
                project_id,
                name,
                tray_type,
                purpose,
                width_mm,
                height_mm,
                length_mm
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
            `,
            [
              randomUUID(),
              projectId,
              row.name,
              row.type,
              row.purpose,
              widthMm,
              heightMm,
              row.length
            ]
          );
          summary.inserted += 1;
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Import trays error', error);
      res.status(500).json({ error: 'Failed to import trays' });
      return;
    } finally {
      client.release();
    }

    try {
      const refreshed = await pool.query<TrayRow>(
        `
          ${selectTraysQuery}
          WHERE project_id = $1
          ORDER BY name ASC;
        `,
        [projectId]
      );

      res.json({
        summary,
        trays: refreshed.rows.map(mapTrayRow)
      });
    } catch (error) {
      console.error('Fetch trays after import error', error);
      res.status(500).json({
        error: 'Trays imported but failed to refresh list',
        summary
      });
    }
  }
);

export { traysRouter };

