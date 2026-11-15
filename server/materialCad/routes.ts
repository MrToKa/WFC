import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { materialComponentKinds } from '../../shared/materialCad.js';
import { requireAdmin } from '../middleware.js';
import { materialAuditPool as pool, withMaterialTransaction } from '../services/materialAuditPool.js';
import { getObjectStream, getProjectBucket, uploadObject, deleteObject } from '../services/objectStorageService.js';
import { convertStepToMesh } from '../cadDesign/converter.js';
import { hasStepEnvelope, MAX_STEP_BYTES } from '../cadDesign/stepFileValidation.js';

export const materialComponentsRouter = Router();
export const materialTrayCadRouter = Router();
const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const dimension = z.number().finite().positive().max(1000000).nullable().optional();
const familySchema = z.object({ manufacturer: text(200), name: text(240) }).strict();
export const componentSchema = z.object({
  familyId: uuid, partNumber: text(200), componentKind: z.enum(materialComponentKinds), name: text(200),
  materialTrayId: uuid.nullable().optional(), widthMm: dimension, heightMm: dimension, lengthMm: dimension,
}).strict().refine(value => !value.materialTrayId || value.componentKind === 'straight', {
  message: 'Only straight products may link an existing tray', path: ['materialTrayId'],
});
const bad = (res: Response, code: string, status = 400): void => { res.status(status).json({ code }); };
const safe = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res).catch((error: unknown) => {
      const code = (error as { code?: string })?.code;
      if (code === '23505') bad(res, 'MATERIAL_COMPONENT_IDENTITY_EXISTS', 409);
      else if (code === '23503') bad(res, 'MATERIAL_REFERENCE_NOT_FOUND', 409);
      else next(error);
    });
  };
materialComponentsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

const componentSelect = `SELECT c.id,c.family_id AS "familyId",f.name AS "familyName",f.manufacturer,
  c.part_number AS "partNumber",c.component_kind AS "componentKind",c.name,
  c.material_tray_id AS "materialTrayId",c.width_mm AS "widthMm",c.height_mm AS "heightMm",c.length_mm AS "lengthMm",
  a.id AS "latestAssetId",a.revision AS "latestRevision"
  FROM material_components c JOIN material_product_families f ON f.id=c.family_id
  LEFT JOIN material_component_cad_assets a ON a.component_id=c.id AND a.active`;

materialComponentsRouter.get('/families', safe(async (_req, res) => {
  const rows = await pool.query('SELECT id,manufacturer,name FROM material_product_families ORDER BY manufacturer,name,id');
  res.json({ families: rows.rows });
}));
materialComponentsRouter.post('/families', requireAdmin, safe(async (req, res) => {
  const parsed = familySchema.safeParse(req.body);
  if (!parsed.success) { bad(res, 'INVALID_MATERIAL_FAMILY'); return; }
  const result = await pool.query('INSERT INTO material_product_families(id,manufacturer,name) VALUES ($1,$2,$3) RETURNING id,manufacturer,name',
    [randomUUID(), parsed.data.manufacturer, parsed.data.name]);
  res.status(201).json({ family: result.rows[0] });
}));
materialComponentsRouter.get('/', safe(async (req, res) => {
  const parsed = z.object({ familyId: uuid.optional(), componentKind: z.enum(materialComponentKinds).optional() }).strict().safeParse(req.query);
  if (!parsed.success) { bad(res, 'INVALID_COMPONENT_FILTER'); return; }
  const rows = await pool.query(`${componentSelect}
    WHERE ($1::uuid IS NULL OR c.family_id=$1) AND ($2::text IS NULL OR c.component_kind=$2)
    ORDER BY f.manufacturer,f.name,c.part_number,c.id`,
  [parsed.data.familyId ?? null, parsed.data.componentKind ?? null]);
  res.json({ components: rows.rows });
}));
materialComponentsRouter.post('/', requireAdmin, safe(async (req, res) => {
  const parsed = componentSchema.safeParse(req.body);
  if (!parsed.success) { bad(res, 'INVALID_MATERIAL_COMPONENT'); return; }
  const value = parsed.data;
  const id = randomUUID();
  const created = await withMaterialTransaction(async client => {
    const family = await client.query<{ manufacturer: string }>('SELECT manufacturer FROM material_product_families WHERE id=$1 FOR SHARE', [value.familyId]);
    if (!family.rows[0]) return false;
    // Existing trays are already represented by a migrated straight component.
    // The unique FK also prevents assigning one straight record to two products.
    if (value.materialTrayId) {
      const tray = await client.query<{ tray_type: string; manufacturer: string | null }>('SELECT tray_type,manufacturer FROM material_trays WHERE id=$1 FOR SHARE', [value.materialTrayId]);
      if (!tray.rows[0] || tray.rows[0].tray_type.trim().toLowerCase() !== value.partNumber.toLowerCase() ||
          (tray.rows[0].manufacturer?.trim() || 'Unspecified').toLowerCase() !== family.rows[0].manufacturer.toLowerCase()) return false;
    }
    await client.query(`INSERT INTO material_components
      (id,family_id,manufacturer,part_number,component_kind,name,material_tray_id,width_mm,height_mm,length_mm)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id,value.familyId,family.rows[0].manufacturer,value.partNumber,value.componentKind,value.name,
      value.materialTrayId ?? null,value.widthMm ?? null,value.heightMm ?? null,value.lengthMm ?? null]);
    return true;
  });
  if (!created) { bad(res, 'INVALID_MATERIAL_REFERENCE', 409); return; }
  const result = await pool.query(`${componentSelect} WHERE c.id=$1`, [id]);
  res.status(201).json({ component: result.rows[0] });
}));

materialComponentsRouter.get('/:componentId/cad-assets', safe(async (req, res) => {
  if (!uuid.safeParse(req.params.componentId).success) { bad(res, 'INVALID_COMPONENT_ID'); return; }
  const owner = await pool.query('SELECT id FROM material_components WHERE id=$1', [req.params.componentId]);
  if (!owner.rows[0]) { bad(res, 'MATERIAL_COMPONENT_NOT_FOUND', 404); return; }
  const result = await pool.query(`SELECT id,component_id AS "componentId",revision,original_filename AS "originalFilename",
    source_sha256 AS "sourceSha256",source_bytes::float8 AS "sourceBytes",mesh_metadata AS "meshMetadata",active,created_at AS "createdAt"
    FROM material_component_cad_assets WHERE component_id=$1 ORDER BY revision DESC`, [req.params.componentId]);
  res.json({ assets: result.rows });
}));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_STEP_BYTES, files: 1, fields: 0, parts: 2 } });
materialComponentsRouter.post('/:componentId/cad-assets', requireAdmin, (req, res, next) => {
  if (!uuid.safeParse(req.params.componentId).success) { bad(res, 'INVALID_COMPONENT_ID'); return; }
  upload.single('file')(req, res, (error: unknown) => {
    if (error) {
      const excessive = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
      bad(res, excessive ? 'STEP_FILE_TOO_LARGE' : 'INVALID_STEP_UPLOAD', excessive ? 413 : 400);
    } else next();
  });
}, safe(async (req, res) => {
  if (!req.file || !hasStepEnvelope(req.file.originalname, req.file.buffer)) { bad(res, 'INVALID_MATERIAL_CAD_FILE'); return; }
  const componentId = req.params.componentId;
  const owner = await pool.query('SELECT id FROM material_components WHERE id=$1', [componentId]);
  if (!owner.rows[0]) { bad(res, 'MATERIAL_COMPONENT_NOT_FOUND', 404); return; }
  const sha = createHash('sha256').update(req.file.buffer).digest('hex');
  const existing = await pool.query('SELECT id FROM material_component_cad_assets WHERE component_id=$1 AND active AND source_sha256=$2', [componentId,sha]);
  if (existing.rows[0]) { res.json({ id: existing.rows[0].id, reused: true, meshReady: true }); return; }
  const id = randomUUID();
  const sourceKey = `materials/components/${componentId}/cad/${id}/original.step`;
  const meshKey = `materials/components/${componentId}/cad/${id}/mesh.json`;
  const originalFilename = path.basename(req.file.originalname.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0,200);
  if (!originalFilename) { bad(res, 'INVALID_STEP_FILENAME'); return; }
  const bucket = getProjectBucket();
  const converted = await convertStepToMesh(req.file.buffer);
  // Limit expensive geometry conversions to the existing isolated converter; no
  // caller-provided URL, storage key, mesh or product identity is accepted here.
  let committed = false;
  try {
    await uploadObject({ bucket, objectKey: sourceKey, data: req.file.buffer, size: req.file.size, contentType: 'application/step' });
    await uploadObject({ bucket, objectKey: meshKey, data: converted.bytes, size: converted.bytes.length, contentType: 'application/json' });
    const result = await withMaterialTransaction(async client => {
      const part = await client.query('SELECT id FROM material_components WHERE id=$1 FOR UPDATE', [componentId]);
      if (!part.rows[0]) return { status: 'missing' as const };
      const current = await client.query<{ id: string; source_sha256: string }>('SELECT id,source_sha256 FROM material_component_cad_assets WHERE component_id=$1 AND active FOR UPDATE', [componentId]);
      if (current.rows[0]?.source_sha256 === sha) return { status: 'reused' as const, id: current.rows[0].id };
      const revision = await client.query<{ next: number }>('SELECT COALESCE(MAX(revision),0)+1 AS next FROM material_component_cad_assets WHERE component_id=$1', [componentId]);
      await client.query('UPDATE material_component_cad_assets SET active=FALSE WHERE component_id=$1 AND active', [componentId]);
      await client.query(`INSERT INTO material_component_cad_assets
        (id,component_id,revision,original_filename,source_sha256,source_bytes,source_object_key,mesh_object_key,mesh_metadata,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [id,componentId,Number(revision.rows[0]?.next ?? 1),originalFilename,sha,req.file!.size,sourceKey,meshKey,
        JSON.stringify({ triangleCount: converted.mesh.triangleCount, solidCount: converted.mesh.solidCount,
          boundsMm: converted.mesh.boundsMm, units: converted.mesh.units }),req.userId ?? null]);
      return { status: 'created' as const, id };
    });
    committed = result.status === 'created';
    if (!committed) await Promise.allSettled([deleteObject(bucket,sourceKey),deleteObject(bucket,meshKey)]);
    if (result.status === 'missing') { bad(res, 'MATERIAL_COMPONENT_NOT_FOUND', 404); return; }
    res.status(committed ? 201 : 200).json({ id: result.id, reused: !committed, meshReady: true });
  } catch (error) {
    // Attempt both keys even when the first/second object upload fails partway.
    // A response failure after COMMIT must never delete a published revision.
    if (!committed) await Promise.allSettled([deleteObject(bucket,sourceKey),deleteObject(bucket,meshKey)]);
    throw error;
  }
}));
// Removing the current STEP retires it from new catalogue selections. Historical
// downloads and project instances retain their immutable revision and source.
materialComponentsRouter.delete('/:componentId/cad-assets/:assetId', requireAdmin, safe(async (req, res) => {
  const { componentId, assetId } = req.params;
  if (!uuid.safeParse(componentId).success || !uuid.safeParse(assetId).success) { bad(res, 'INVALID_MATERIAL_CAD_ID'); return; }
  const status = await withMaterialTransaction(async client => {
    // Same lock order as publication: serialize retirement, activation and upload.
    const component = await client.query('SELECT id FROM material_components WHERE id=$1 FOR UPDATE', [componentId]);
    if (!component.rows[0]) return 'missing-component' as const;
    const asset = await client.query<{ id: string; active: boolean }>(
      'SELECT id,active FROM material_component_cad_assets WHERE component_id=$1 AND id=$2 FOR UPDATE', [componentId,assetId]);
    if (!asset.rows[0]) return 'missing-asset' as const;
    if (!asset.rows[0].active) return 'inactive' as const;
    await client.query('UPDATE material_component_cad_assets SET active=FALSE WHERE component_id=$1 AND id=$2 AND active', [componentId,assetId]);
    return 'retired' as const;
  });
  if (status === 'missing-component') { bad(res, 'MATERIAL_COMPONENT_NOT_FOUND', 404); return; }
  if (status === 'missing-asset') { bad(res, 'MATERIAL_CAD_NOT_FOUND', 404); return; }
  if (status === 'inactive') { bad(res, 'MATERIAL_CAD_ALREADY_INACTIVE', 409); return; }
  res.status(204).send();
}));

const activationInput = z.object({ expectedActiveAssetId: uuid.nullable() }).strict();
materialComponentsRouter.post('/:componentId/cad-assets/:assetId/activate', requireAdmin, safe(async (req, res) => {
  const { componentId, assetId } = req.params;
  if (!uuid.safeParse(componentId).success || !uuid.safeParse(assetId).success) { bad(res, 'INVALID_MATERIAL_CAD_ID'); return; }
  const parsed = activationInput.safeParse(req.body);
  if (!parsed.success) { bad(res, 'INVALID_CAD_ACTIVATION'); return; }
  const status = await withMaterialTransaction(async client => {
    const component = await client.query('SELECT id FROM material_components WHERE id=$1 FOR UPDATE', [componentId]);
    if (!component.rows[0]) return 'missing-component' as const;
    const target = await client.query('SELECT id FROM material_component_cad_assets WHERE component_id=$1 AND id=$2 FOR UPDATE', [componentId,assetId]);
    if (!target.rows[0]) return 'missing-asset' as const;
    const current = await client.query<{ id: string }>(
      'SELECT id FROM material_component_cad_assets WHERE component_id=$1 AND active FOR UPDATE', [componentId]);
    const activeId = current.rows[0]?.id ?? null;
    if (activeId !== parsed.data.expectedActiveAssetId) return 'stale' as const;
    if (activeId === assetId) return 'active' as const;
    // Deactivate before activation to respect the one-active-revision constraint.
    await client.query('UPDATE material_component_cad_assets SET active=FALSE WHERE component_id=$1 AND active', [componentId]);
    await client.query('UPDATE material_component_cad_assets SET active=TRUE WHERE component_id=$1 AND id=$2', [componentId,assetId]);
    return 'active' as const;
  });
  if (status === 'missing-component') { bad(res, 'MATERIAL_COMPONENT_NOT_FOUND', 404); return; }
  if (status === 'missing-asset') { bad(res, 'MATERIAL_CAD_NOT_FOUND', 404); return; }
  if (status === 'stale') { bad(res, 'MATERIAL_CAD_ACTIVE_CHANGED', 409); return; }
  res.json({ id: assetId, active: true });
}));

materialComponentsRouter.get('/:componentId/cad-assets/:assetId/download', safe(async (req, res) => {
  if (!uuid.safeParse(req.params.componentId).success || !uuid.safeParse(req.params.assetId).success) { bad(res, 'INVALID_MATERIAL_CAD_ID'); return; }
  const result = await pool.query<{ source_object_key: string }>('SELECT source_object_key FROM material_component_cad_assets WHERE component_id=$1 AND id=$2', [req.params.componentId,req.params.assetId]);
  if (!result.rows[0]) { bad(res, 'MATERIAL_CAD_NOT_FOUND', 404); return; }
  const stream = await getObjectStream(getProjectBucket(),result.rows[0].source_object_key);
  res.setHeader('Content-Type', 'application/step');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'attachment; filename="catalog-component.step"');
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}));

// Old tray attachment endpoints cannot add fitting identities to a straight.
// Retain a discovery response so old clients can move to the canonical API.
materialTrayCadRouter.all('/:trayId/cad-assets', (req, res) => {
  if (!uuid.safeParse(req.params.trayId).success) { bad(res, 'INVALID_MATERIAL_TRAY_ID'); return; }
  res.status(410).json({ code: 'USE_MATERIAL_COMPONENTS_CATALOG', endpoint: '/api/materials/components' });
});
materialTrayCadRouter.get('/:trayId/cad-assets/:assetId/download', safe(async (req, res) => {
  if (!uuid.safeParse(req.params.trayId).success || !uuid.safeParse(req.params.assetId).success) { bad(res, 'INVALID_MATERIAL_CAD_ID'); return; }
  const result = await pool.query<{ source_object_key: string }>('SELECT source_object_key FROM material_tray_cad_assets WHERE material_tray_id=$1 AND id=$2', [req.params.trayId,req.params.assetId]);
  if (!result.rows[0]) { bad(res, 'MATERIAL_CAD_NOT_FOUND', 404); return; }
  const stream = await getObjectStream(getProjectBucket(),result.rows[0].source_object_key);
  res.setHeader('Content-Type', 'application/step');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', 'attachment; filename="catalog-component.step"');
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}));
