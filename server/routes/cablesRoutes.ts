import { randomUUID } from 'crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { pool } from '../db.js';
import {
  mapCableRow,
  type CableRow,
  type CableWithTypeRow
} from '../models/cable.js';
import type { CableTypeRow } from '../models/cableType.js';
import { authenticate } from '../middleware.js';
import { ensureProjectExists } from '../services/projectService.js';
import {
  createCableSchema,
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
  routing: 'Routing'
} as const;

const OUTPUT_HEADERS = {
  tag: 'Tag',
  type: 'Type',
  purpose: 'Purpose',
  diameter: 'Diameter [mm]',
  weight: 'Weight [kg/m]',
  fromLocation: 'From Location',
  toLocation: 'To Location',
  routing: 'Routing'
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
    c.created_at,
    c.updated_at,
    ct.name AS type_name,
    ct.purpose AS type_purpose,
    ct.diameter_mm AS type_diameter_mm,
    ct.weight_kg_per_m AS type_weight_kg_per_m
  FROM cables c
  JOIN cable_types ct ON ct.id = c.cable_type_id
`;

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
        ORDER BY c.cable_id ASC;
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
      routing
    } = parseResult.data;

    try {
      const typeResult = await pool.query<CableTypeRow>(
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
        res
          .status(400)
          .json({ error: 'Cable type does not belong to the project' });
        return;
      }

      const normalizedTag = normalizeOptionalString(tag ?? null);

      const insertResult = await pool.query<CableRow>(
        `
          INSERT INTO cables (
            id,
            project_id,
            cable_id,
            tag,
            cable_type_id,
            from_location,
            to_location,
            routing
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING
            id,
            project_id,
            cable_id,
            tag,
            cable_type_id,
            from_location,
            to_location,
            routing,
            created_at,
            updated_at;
        `,
        [
          randomUUID(),
          projectId,
          cableId.trim(),
          normalizedTag,
          cableTypeId,
          normalizeOptionalString(fromLocation ?? null),
          normalizeOptionalString(toLocation ?? null),
          normalizeOptionalString(routing ?? null)
        ]
      );

      const inserted = insertResult.rows[0];

      if (!inserted) {
        res.status(500).json({ error: 'Failed to create cable' });
        return;
      }

      const result = await pool.query<CableWithTypeRow>(
        `
          ${selectCablesQuery}
          WHERE c.id = $1;
        `,
        [inserted.id]
      );

      res.status(201).json({ cable: mapCableRow(result.rows[0]) });
    } catch (error) {
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
      routing
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

    if (cableTypeId) {
      try {
        const typeResult = await pool.query(
          `
            SELECT id
            FROM cable_types
            WHERE id = $1
              AND project_id = $2;
          `,
          [cableTypeId, projectId]
        );

        if (typeResult.rowCount === 0) {
          res
            .status(400)
            .json({ error: 'Cable type does not belong to the project' });
          return;
        }
      } catch (error) {
        console.error('Verify cable type for update error', error);
        res.status(500).json({ error: 'Failed to update cable' });
        return;
      }
    }

    if (newCableId) {
      try {
        const duplicate = await pool.query(
          `
            SELECT id
            FROM cables
            WHERE project_id = $1
              AND id <> $2
              AND lower(cable_id) = lower($3);
          `,
          [projectId, cableId, newCableId.trim()]
        );

        if (duplicate.rowCount > 0) {
          res
            .status(409)
            .json({ error: 'Cable ID already exists for this project' });
          return;
        }
      } catch (error) {
        console.error('Duplicate cable id check error', error);
        res.status(500).json({ error: 'Failed to update cable' });
        return;
      }
    }

    const fields: string[] = [];
    const values: Array<string | null> = [];
    let index = 1;

    if (newCableId !== undefined) {
      fields.push(`cable_id = $${index++}`);
      values.push(newCableId.trim());
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

    fields.push(`updated_at = NOW()`);

    try {
      const updateResult = await pool.query<CableRow>(
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
            created_at,
            updated_at;
        `,
        [...values, cableId, projectId]
      );

      const updated = updateResult.rows[0];

      if (!updated) {
        res.status(404).json({ error: 'Cable not found' });
        return;
      }

      const result = await pool.query<CableWithTypeRow>(
        `
          ${selectCablesQuery}
          WHERE c.id = $1;
        `,
        [updated.id]
      );

      res.json({ cable: mapCableRow(result.rows[0]) });
    } catch (error) {
      console.error('Update cable error', error);
      res.status(500).json({ error: 'Failed to update cable' });
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

    const prepared: Array<{
      cableId: string;
      cableKey: string;
      tag: string | null;
      typeName: string;
      typeKey: string;
      fromLocation: string | null;
      toLocation: string | null;
      routing: string | null;
    }> = [];

    const seenCableIds = new Set<string>();
    const requestedTypeKeys = new Set<string>();

    for (const row of rows) {
      const rawCableId = row[INPUT_HEADERS.cableId] as unknown;
      const cableId =
        typeof rawCableId === 'number'
          ? String(rawCableId)
          : String(rawCableId ?? '').trim();

      if (cableId === '') {
        summary.skipped += 1;
        continue;
      }

      const cableKey = cableId.toLowerCase();

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

      prepared.push({
        cableId,
        cableKey,
        tag: normalizeOptionalString(
          row[INPUT_HEADERS.tag] as string | null | undefined
        ),
        typeName,
        typeKey,
        fromLocation: normalizeOptionalString(
          row[INPUT_HEADERS.fromLocation] as string | null | undefined
        ),
        toLocation: normalizeOptionalString(
          row[INPUT_HEADERS.toLocation] as string | null | undefined
        ),
        routing: normalizeOptionalString(
          row[INPUT_HEADERS.routing] as string | null | undefined
        )
      });

      seenCableIds.add(cableKey);
      requestedTypeKeys.add(typeKey);
    }

    if (prepared.length === 0) {
      try {
        const existing = await pool.query<CableWithTypeRow>(
          `
            ${selectCablesQuery}
            WHERE c.project_id = $1
            ORDER BY c.cable_id ASC;
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

    let cableTypesMap = new Map<string, CableTypeRow>();

    try {
      const typeResult = await pool.query<CableTypeRow>(
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
          WHERE project_id = $1
            AND lower(name) = ANY($2::text[]);
        `,
        [projectId, Array.from(requestedTypeKeys)]
      );

      cableTypesMap = new Map(
        typeResult.rows.map((type) => [type.name.toLowerCase(), type])
      );
    } catch (error) {
      console.error('Fetch cable types for import error', error);
      res.status(500).json({ error: 'Failed to import cables' });
      return;
    }

    const missingTypes = new Set<string>();

    for (const row of prepared) {
      if (!cableTypesMap.has(row.typeKey)) {
        missingTypes.add(row.typeName);
      }
    }

    if (missingTypes.size > 0) {
      res.status(400).json({
        error: `Import cancelled. Missing cable types: ${Array.from(
          missingTypes
        ).join(', ')}.`
      });
      return;
    }

    type ExistingCable = Pick<CableRow, 'id' | 'cable_id'>;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const existingResult = await client.query<ExistingCable>(
        `
          SELECT id, cable_id
          FROM cables
          WHERE project_id = $1
            AND lower(cable_id) = ANY($2::text[]);
        `,
        [projectId, prepared.map((row) => row.cableKey)]
      );

      const existingMap = new Map<string, ExistingCable>();

      for (const cable of existingResult.rows) {
        existingMap.set(cable.cable_id.toLowerCase(), cable);
      }

      for (const row of prepared) {
        const cableType = cableTypesMap.get(row.typeKey);

        if (!cableType) {
          continue;
        }

        const payload = {
          tag: row.tag,
          fromLocation: row.fromLocation,
          toLocation: row.toLocation,
          routing: row.routing
        };

        const existing = existingMap.get(row.cableKey);

        if (existing) {
          await client.query(
            `
              UPDATE cables
              SET
                tag = $1,
                cable_type_id = $2,
                from_location = $3,
                to_location = $4,
                routing = $5,
                updated_at = NOW()
              WHERE id = $6;
            `,
            [
              payload.tag,
              cableType.id,
              payload.fromLocation,
              payload.toLocation,
              payload.routing,
              existing.id
            ]
          );
          summary.updated += 1;
        } else {
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
                routing
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
            `,
            [
              randomUUID(),
              projectId,
              row.cableId,
              payload.tag,
              cableType.id,
              payload.fromLocation,
              payload.toLocation,
              payload.routing
            ]
          );
          summary.inserted += 1;
        }
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
          ORDER BY c.cable_id ASC;
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
              LOWER(c.cable_id) LIKE ${likeParam}
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
        tag: "LOWER(COALESCE(c.tag, c.cable_id))",
        typeName: "LOWER(COALESCE(ct.name, ''))",
        fromLocation: "LOWER(COALESCE(c.from_location, ''))",
        toLocation: "LOWER(COALESCE(c.to_location, ''))",
        routing: "LOWER(COALESCE(c.routing, ''))"
      };

      const sortExpression =
        sortExpressionMap[normalizedSortColumn] ?? 'LOWER(c.cable_id)';

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      const result = await pool.query<CableWithTypeRow>(
        `
          ${selectCablesQuery}
          ${whereClause}
          ORDER BY ${sortExpression} ${normalizedSortDirection}, LOWER(c.cable_id) ASC;
        `,
        values
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cables', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      const columns = [
        { name: OUTPUT_HEADERS.tag, key: 'tag', width: 20 },
        { name: OUTPUT_HEADERS.type, key: 'type', width: 28 },
        { name: OUTPUT_HEADERS.purpose, key: 'purpose', width: 30 },
        { name: OUTPUT_HEADERS.diameter, key: 'diameter', width: 18 },
        { name: OUTPUT_HEADERS.weight, key: 'weight', width: 18 },
        { name: OUTPUT_HEADERS.fromLocation, key: 'fromLocation', width: 26 },
        { name: OUTPUT_HEADERS.toLocation, key: 'toLocation', width: 26 },
        { name: OUTPUT_HEADERS.routing, key: 'routing', width: 30 }
      ] as const;

      const rows = result.rows.map((row) => [
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
        row.routing ?? ''
      ]);

      const table = worksheet.addTable({
        name: 'Cables',
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
        rows: rows.length > 0
          ? rows
          : [['', '', '', '', '', '', '', '', '']]
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
      const fileName = `${projectSegment}-cable-list.xlsx`;

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

export { cablesRouter };
