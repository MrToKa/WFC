import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { hasStepEnvelope, MAX_STEP_BYTES, csvCell } from './stepFileValidation.js';
import { convertStepToMesh } from './converter.js';
import { cadPocPortSeeds } from './pocPortSeed.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireProjectEdit } from '../middleware.js';
import { deleteObject, getObjectStream, getProjectBucket, uploadObject } from '../services/objectStorageService.js';

export const cadDesignRouter = Router({ mergeParams: true });

// 8 MiB stays below the existing nginx generic /api/ body limit (10 MiB).
const upload = multer({ storage: multer.memoryStorage(), limits: {
  fileSize: MAX_STEP_BYTES, files: 1, fields: 3, parts: 4,
} });
const uuid = z.string().uuid();
const catalogueInput = z.object({
  manufacturer: z.string().trim().min(1).max(100),
  partNumber: z.string().trim().min(1).max(160),
  family: z.string().trim().min(1).max(100),
}).strict();
const position = z.object({
  x: z.number().finite().min(-1e9).max(1e9),
  y: z.number().finite().min(-1e9).max(1e9),
  z: z.number().finite().min(-1e9).max(1e9),
}).strict();
const quaternion = z.object({
  x: z.number().finite().min(-1).max(1),
  y: z.number().finite().min(-1).max(1),
  z: z.number().finite().min(-1).max(1),
  w: z.number().finite().min(-1).max(1),
}).strict().refine(q => {
  const n = q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w;
  return Math.abs(n - 1) <= 1e-6;
}, 'Rotation must be a unit quaternion.');
const transform = z.object({ positionMm: position, rotation: quaternion }).strict();
const designInput = z.object({
  modelVersionId: uuid,
  name: z.string().trim().min(1).max(160),
}).strict();
const instanceInput = z.object({
  catalogItemId: uuid,
  transform,
}).strict();
const updateInput = z.object({
  expectedRevision: z.number().int().positive(),
  transform,
}).strict();

type CadRequest = Request<{projectId: string; catalogItemId?: string; designId?: string; instanceId?: string}>;

// Express 4 does not automatically forward rejected async handler promises.
const safe = (handler: (req: CadRequest, res: Response) => Promise<void>) =>
  (req: CadRequest, res: Response, next: NextFunction): void => {
    void handler(req, res).catch(next);
  };

const failure = (res: Response, status: number, code: string): void => {
  res.status(status).json({ code });
};


cadDesignRouter.get('/catalog', safe(async (req: CadRequest, res: Response) => {
  const result = await pool.query(
    `SELECT id, manufacturer, part_number AS "partNumber", family,
            original_filename AS "originalFilename", source_sha256 AS "sourceSha256",
            source_bytes AS "sourceBytes", conversion_status AS "conversionStatus",
            mesh_metadata AS "meshMetadata",
            created_at AS "createdAt"
     FROM cad_catalog_items WHERE project_id=$1 ORDER BY created_at, id LIMIT 250`,
    [req.params.projectId],
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ items: result.rows });
}));

cadDesignRouter.post('/catalog', requireProjectEdit, (req: CadRequest, res: Response, next) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (error) {
      failure(res, error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'INVALID_STEP_UPLOAD');
      return;
    }
    next();
  });
}, safe(async (req: CadRequest, res: Response) => {
  const parsed = catalogueInput.safeParse(req.body);
  if (!parsed.success || !req.file || !hasStepEnvelope(req.file.originalname, req.file.buffer)) {
    failure(res, 400, 'INVALID_STEP_FILE_OR_METADATA');
    return;
  }
  const projectId = req.params.projectId;
  const sha = createHash('sha256').update(req.file.buffer).digest('hex');
  const existing = await pool.query(
    'SELECT id FROM cad_catalog_items WHERE project_id=$1 AND source_sha256=$2',
    [projectId, sha],
  );
  if (existing.rows[0]) {
    res.status(200).json({ id: existing.rows[0].id, reused: true });
    return;
  }
  const id = randomUUID();
  const key = `cad-design/projects/${projectId}/catalog/${id}/original.step`;
  const meshKey = `cad-design/projects/${projectId}/catalog/${id}/mesh.json`;
  const name = path.basename(req.file.originalname).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  const bucket = getProjectBucket();
  try {
    // Parse the untrusted CAD only inside the isolated OCCT conversion service.
    const { bytes: meshBytes, mesh } = await convertStepToMesh(req.file.buffer);
    await uploadObject({
      bucket, objectKey: key, data: req.file.buffer, size: req.file.size,
      contentType: 'application/step',
    });
    await uploadObject({
      bucket, objectKey: meshKey, data: meshBytes, size: meshBytes.length,
      contentType: 'application/json',
    });
    const client = await pool.connect();
    let created = false;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO cad_catalog_items
           (id,project_id,manufacturer,part_number,family,original_filename,
            source_sha256,source_object_key,source_bytes,created_by,mesh_object_key,mesh_metadata,conversion_status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ready')
         ON CONFLICT(project_id,source_sha256) DO NOTHING RETURNING id`,
        [id, projectId, parsed.data.manufacturer, parsed.data.partNumber, parsed.data.family,
          name, sha, key, req.file.size, req.userId ?? null, meshKey,
          JSON.stringify({ triangleCount: mesh.triangleCount, solidCount: mesh.solidCount,
            boundsMm: mesh.boundsMm, units: mesh.units })],
      );
      if (inserted.rows[0]) {
        for (const port of cadPocPortSeeds(name, sha)) {
          await client.query(
            `INSERT INTO cad_catalog_ports
              (id,project_id,catalog_item_id,name,port_type,local_transform)
             VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
            [randomUUID(), projectId, id, port.name, port.portType,
              JSON.stringify(port.localTransform)],
          );
        }
        created = true;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (created) {
      res.status(201).json({ id, reused: false, conversionStatus: 'ready' });
      return;
    }
    await Promise.allSettled([deleteObject(bucket, key), deleteObject(bucket, meshKey)]);
    const result = await pool.query(
      'SELECT id FROM cad_catalog_items WHERE project_id=$1 AND source_sha256=$2',
      [projectId, sha],
    );
    if (result.rows[0]) res.status(200).json({ id: result.rows[0].id, reused: true });
    else failure(res, 409, 'CATALOG_IMPORT_CONFLICT');
  } catch (error) {
    await Promise.allSettled([deleteObject(bucket, key), deleteObject(bucket, meshKey)]);
    console.error('CAD catalogue import failed', error);
    failure(res, 500, 'CATALOG_IMPORT_FAILED');
  }
}));

cadDesignRouter.get('/catalog/:catalogItemId/mesh', safe(async (req: CadRequest, res: Response) => {
  if (!uuid.safeParse(req.params.catalogItemId).success) {
    failure(res, 400, 'INVALID_CATALOG_ITEM_ID'); return;
  }
  const result = await pool.query<{ mesh_object_key: string }>(
    `SELECT mesh_object_key FROM cad_catalog_items
       WHERE project_id=$1 AND id=$2 AND conversion_status='ready'
         AND mesh_object_key IS NOT NULL`,
    [req.params.projectId, req.params.catalogItemId],
  );
  const key = result.rows[0]?.mesh_object_key;
  if (!key) { failure(res, 404, 'CAD_MESH_NOT_READY'); return; }
  const stream = await getObjectStream(getProjectBucket(), key);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}));

cadDesignRouter.get('/designs', safe(async (req: CadRequest, res: Response) => {
  const result = await pool.query(
    `SELECT d.id, d.model_version_id AS "modelVersionId", d.name, d.status,
            d.revision, s.active_model_version_id=d.model_version_id AS "activeModel",
            d.created_at AS "createdAt", d.updated_at AS "updatedAt"
       FROM cad_designs d
       LEFT JOIN project_model_selections s ON s.project_id=d.project_id
      WHERE d.project_id=$1 ORDER BY d.created_at DESC LIMIT 50`,
    [req.params.projectId],
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ designs: result.rows });
}));

cadDesignRouter.post('/designs', requireProjectEdit, safe(async (req: CadRequest, res: Response) => {
  const parsed = designInput.safeParse(req.body);
  if (!parsed.success) { failure(res, 400, 'INVALID_CAD_DESIGN'); return; }
  const { projectId } = req.params;
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO cad_designs(id,project_id,model_version_id,name,created_by)
       SELECT $1,$2,v.id,$4,$5
         FROM model_versions v
         JOIN project_model_selections s ON s.project_id=v.project_id
        WHERE v.project_id=$2 AND v.id=$3 AND s.active_model_version_id=v.id
          AND v.state='ready' AND v.health='healthy'
       ON CONFLICT (project_id,model_version_id) DO NOTHING
       RETURNING id`,
    [id, projectId, parsed.data.modelVersionId, parsed.data.name, req.userId ?? null],
  );
  if (result.rows[0]) { res.status(201).json({ id, created: true }); return; }
  const existing = await pool.query(
    `SELECT d.id FROM cad_designs d
       JOIN project_model_selections s ON s.project_id=d.project_id AND s.active_model_version_id=d.model_version_id
       JOIN model_versions v ON v.id=d.model_version_id AND v.project_id=d.project_id
      WHERE d.project_id=$1 AND d.model_version_id=$2 AND v.state='ready' AND v.health='healthy'`,
    [projectId, parsed.data.modelVersionId],
  );
  if (existing.rows[0]) res.status(200).json({ id: existing.rows[0].id, created: false });
  else failure(res, 409, 'ACTIVE_MODEL_REQUIRED');
}));

cadDesignRouter.get('/designs/:designId/instances', safe(async (req: CadRequest, res: Response) => {
  if (!uuid.safeParse(req.params.designId).success) {
    failure(res, 400, 'INVALID_DESIGN_ID'); return;
  }
  const result = await pool.query(
    `SELECT i.id, i.catalog_item_id AS "catalogItemId", i.revision,
            i.x_mm AS "xMm", i.y_mm AS "yMm", i.z_mm AS "zMm",
            i.qx, i.qy, i.qz, i.qw,
            c.manufacturer, c.part_number AS "partNumber", c.family,
            c.conversion_status AS "conversionStatus"
       FROM cad_design_instances i
       JOIN cad_designs d ON d.project_id=i.project_id AND d.id=i.design_id
       JOIN cad_catalog_items c ON c.project_id=i.project_id AND c.id=i.catalog_item_id
      WHERE i.project_id=$1 AND d.id=$2 ORDER BY i.created_at, i.id LIMIT 500`,
    [req.params.projectId, req.params.designId],
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ instances: result.rows });
}));

cadDesignRouter.post('/designs/:designId/instances', requireProjectEdit, safe(async (req: CadRequest, res: Response) => {
  if (!uuid.safeParse(req.params.designId).success) {
    failure(res, 400, 'INVALID_DESIGN_ID'); return;
  }
  const parsed = instanceInput.safeParse(req.body);
  if (!parsed.success) { failure(res, 400, 'INVALID_INSTANCE'); return; }
  const { projectId, designId } = req.params;
  const { catalogItemId, transform: t } = parsed.data;
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO cad_design_instances
      (id,project_id,design_id,catalog_item_id,x_mm,y_mm,z_mm,qx,qy,qz,qw,created_by)
     SELECT $1,d.project_id,d.id,c.id,$5,$6,$7,$8,$9,$10,$11,$12
       FROM cad_designs d
       JOIN project_model_selections s ON s.project_id=d.project_id AND s.active_model_version_id=d.model_version_id
       JOIN model_versions v ON v.project_id=d.project_id AND v.id=d.model_version_id
       JOIN cad_catalog_items c ON c.project_id=d.project_id AND c.id=$4
      WHERE d.project_id=$2 AND d.id=$3 AND d.status='proposed'
        AND v.state='ready' AND v.health='healthy'
     RETURNING id, revision`,
    [id, projectId, designId, catalogItemId,
      t.positionMm.x, t.positionMm.y, t.positionMm.z,
      t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w,
      req.userId ?? null],
  );
  if (!result.rows[0]) { failure(res, 409, 'DESIGN_OR_MODEL_NOT_EDITABLE'); return; }
  res.status(201).json(result.rows[0]);
}));

cadDesignRouter.patch('/designs/:designId/instances/:instanceId', requireProjectEdit, safe(async (req: CadRequest, res: Response) => {
  if (!uuid.safeParse(req.params.designId).success || !uuid.safeParse(req.params.instanceId).success) {
    failure(res, 400, 'INVALID_INSTANCE_ID'); return;
  }
  const parsed = updateInput.safeParse(req.body);
  if (!parsed.success) { failure(res, 400, 'INVALID_INSTANCE'); return; }
  const t = parsed.data.transform;
  const result = await pool.query(
    `UPDATE cad_design_instances i
        SET x_mm=$5, y_mm=$6, z_mm=$7, qx=$8, qy=$9, qz=$10, qw=$11,
            revision=i.revision+1, updated_at=now()
       FROM cad_designs d
       JOIN project_model_selections s ON s.project_id=d.project_id AND s.active_model_version_id=d.model_version_id
       JOIN model_versions v ON v.project_id=d.project_id AND v.id=d.model_version_id
      WHERE i.project_id=$1 AND i.design_id=$2 AND i.id=$3
        AND i.revision=$4 AND d.project_id=i.project_id AND d.id=i.design_id
        AND d.status='proposed' AND v.state='ready' AND v.health='healthy'
    RETURNING i.id, i.revision`,
    [req.params.projectId, req.params.designId, req.params.instanceId,
      parsed.data.expectedRevision, t.positionMm.x, t.positionMm.y, t.positionMm.z,
      t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w],
  );
  if (!result.rows[0]) { failure(res, 409, 'STALE_OR_INACTIVE_INSTANCE'); return; }
  res.json(result.rows[0]);
}));

cadDesignRouter.get('/designs/:designId/materials.csv', safe(async (req: CadRequest, res: Response) => {
  if (!uuid.safeParse(req.params.designId).success) {
    failure(res, 400, 'INVALID_DESIGN_ID'); return;
  }
  const rows = await pool.query(
    `SELECT c.manufacturer, c.part_number, c.family, c.source_sha256,
            COUNT(i.id)::int AS quantity
       FROM cad_design_instances i
       JOIN cad_catalog_items c ON c.project_id=i.project_id AND c.id=i.catalog_item_id
      WHERE i.project_id=$1 AND i.design_id=$2
      GROUP BY c.id, c.manufacturer, c.part_number, c.family, c.source_sha256
      ORDER BY c.manufacturer, c.part_number`,
    [req.params.projectId, req.params.designId],
  );
  const lines = [
    ['Manufacturer','Part number','Family','Source SHA-256','Quantity'].map(csvCell).join(','),
    ...rows.rows.map(row => [row.manufacturer,row.part_number,row.family,row.source_sha256,row.quantity].map(csvCell).join(',')),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wfc-proposed-tray-mto.csv"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
}));

cadDesignRouter.get('/designs/:designId/assembly.step', safe(async (req: CadRequest, res: Response) => {
  if (!uuid.safeParse(req.params.designId).success) {
    failure(res, 400, 'INVALID_DESIGN_ID'); return;
  }
  const { projectId, designId } = req.params;
  const design = await pool.query<{ model_version_id: string; name: string; revision: number }>(
    `SELECT model_version_id, name, revision
       FROM cad_designs WHERE project_id=$1 AND id=$2`,
    [projectId, designId],
  );
  if (!design.rows[0]) { failure(res, 404, 'CAD_DESIGN_NOT_FOUND'); return; }
  const result = await pool.query<{
    original_filename: string; source_object_key: string;
    x_mm: number; y_mm: number; z_mm: number;
    qx: number; qy: number; qz: number; qw: number;
  }>(
    `SELECT c.original_filename, c.source_object_key,
            i.x_mm, i.y_mm, i.z_mm, i.qx, i.qy, i.qz, i.qw
       FROM cad_design_instances i
       JOIN cad_catalog_items c ON c.project_id=i.project_id AND c.id=i.catalog_item_id
      WHERE i.project_id=$1 AND i.design_id=$2
      ORDER BY i.created_at, i.id LIMIT 33`,
    [projectId, designId],
  );
  if (!result.rows.length) { failure(res, 409, 'EMPTY_CAD_DESIGN'); return; }
  if (result.rows.length > 32) { failure(res, 413, 'CAD_EXPORT_PART_LIMIT'); return; }
  const { exportStepAssembly } = await import('./stepAssemblyClient.js');
  const output = await exportStepAssembly(result.rows);
  res.setHeader('Content-Type', 'application/step');
  res.setHeader('Content-Disposition', 'attachment; filename="wfc-proposed-cable-trays.step"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-WFC-Source-Model-Version', design.rows[0].model_version_id);
  res.setHeader('X-WFC-Design-Revision', String(design.rows[0].revision));
  res.send(output);
}));
