import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAdmin } from '../middleware.js';
import { materialAuditPool as pool, withMaterialTransaction } from '../services/materialAuditPool.js';
import { getObjectStream, getProjectBucket, uploadObject, deleteObject } from '../services/objectStorageService.js';
import { convertStepToMesh } from '../cadDesign/converter.js';
import { hasStepEnvelope, MAX_STEP_BYTES } from '../cadDesign/stepFileValidation.js';

export const materialTrayCadRouter = Router();
const uuid = z.string().uuid();
const upload = multer({ storage: multer.memoryStorage(), limits: {
  fileSize: MAX_STEP_BYTES, files: 1, fields: 3, parts: 4,
} });
const metadata = z.object({
  partNumber: z.string().trim().min(1).max(160),
  componentKind: z.enum(['straight','bend','tee','reducer','connector','accessory','other']),
}).strict();
const safe = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => { void fn(req, res).catch(next); };

const bad = (res: Response, code: string, status = 400): void => {
  res.status(status).json({ code });
};

// Authenticated catalogue readers can inspect the current CAD versions.
// The source STEP bytes remain behind a server-side authenticated endpoint.
materialTrayCadRouter.get('/:trayId/cad-assets', safe(async (req, res) => {
  if (!uuid.safeParse(req.params.trayId).success) { bad(res, 'INVALID_MATERIAL_TRAY_ID'); return; }
  const exists = await pool.query('SELECT id FROM material_trays WHERE id=$1', [req.params.trayId]);
  if (!exists.rows[0]) { bad(res, 'MATERIAL_TRAY_NOT_FOUND', 404); return; }
  const rows = await pool.query(
    `SELECT id, part_number AS "partNumber", component_kind AS "componentKind",
            revision, original_filename AS "originalFilename",
            source_sha256 AS "sourceSha256", source_bytes AS "sourceBytes",
            mesh_metadata AS "meshMetadata", created_at AS "createdAt"
       FROM material_tray_cad_assets WHERE material_tray_id=$1 AND active
      ORDER BY part_number, id LIMIT 250`,
    [req.params.trayId],
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ assets: rows.rows });
}));

// Single immutable CAD revision upload, under the same existing MinIO bucket.
// The solid model is checked and converted in the isolated OCCT worker.
materialTrayCadRouter.post('/:trayId/cad-assets', requireAdmin, (req, res, next) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (error) {
      bad(res, error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
        ? 'STEP_FILE_TOO_LARGE' : 'INVALID_STEP_UPLOAD',
      error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
      return;
    }
    next();
  });
}, safe(async (req, res) => {
  const trayId = req.params.trayId;
  const parsed = metadata.safeParse({ partNumber: req.body?.partNumber, componentKind: req.body?.componentKind });
  if (!uuid.safeParse(trayId).success || !parsed.success || !req.file ||
      !hasStepEnvelope(req.file.originalname, req.file.buffer)) {
    bad(res, 'INVALID_MATERIAL_CAD_FILE'); return;
  }

  const sha = createHash('sha256').update(req.file.buffer).digest('hex');
  const existing = await pool.query(
    `SELECT id FROM material_tray_cad_assets
      WHERE material_tray_id=$1 AND part_number=$2 AND active AND source_sha256=$3`,
    [trayId, parsed.data.partNumber, sha],
  );
  if (existing.rows[0]) { res.status(200).json({ id: existing.rows[0].id, reused: true }); return; }

  const part = await pool.query('SELECT id FROM material_trays WHERE id=$1', [trayId]);
  if (!part.rows[0]) { bad(res, 'MATERIAL_TRAY_NOT_FOUND', 404); return; }

  const id = randomUUID();
  const sourceKey = `materials/trays/${trayId}/cad/${id}/original.step`;
  const meshKey = `materials/trays/${trayId}/cad/${id}/mesh.json`;
  const originalFilename = path.basename(req.file.originalname)
    .replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  const bucket = getProjectBucket();
  const converted = await convertStepToMesh(req.file.buffer);

  let stored = false;
  try {
    await uploadObject({ bucket, objectKey: sourceKey, data: req.file.buffer,
      size: req.file.size, contentType: 'application/step' });
    await uploadObject({ bucket, objectKey: meshKey, data: converted.bytes,
      size: converted.bytes.length, contentType: 'application/json' });
    stored = true;

    const result = await withMaterialTransaction(async client => {
      // Serialize revisions of the same catalogue tray. Old revisions are
      // retained even when a newer STEP is uploaded.
      const owner = await client.query('SELECT id FROM material_trays WHERE id=$1 FOR UPDATE', [trayId]);
      if (!owner.rows[0]) return { status: 'missing' as const };

      const current = await client.query<{ id: string; source_sha256: string }>(
        `SELECT id,source_sha256 FROM material_tray_cad_assets
          WHERE material_tray_id=$1 AND part_number=$2 AND active FOR UPDATE`,
        [trayId, parsed.data.partNumber],
      );
      if (current.rows[0]?.source_sha256 === sha) {
        return { status: 'reused' as const, id: current.rows[0].id };
      }
      const revision = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(revision),0)+1 AS next
           FROM material_tray_cad_assets WHERE material_tray_id=$1 AND part_number=$2`,
        [trayId, parsed.data.partNumber],
      );
      await client.query(
        `UPDATE material_tray_cad_assets SET active=FALSE
          WHERE material_tray_id=$1 AND part_number=$2 AND active`,
        [trayId, parsed.data.partNumber],
      );
      await client.query(
        `INSERT INTO material_tray_cad_assets
          (id,material_tray_id,part_number,component_kind,revision,original_filename,
           source_sha256,source_bytes,source_object_key,mesh_object_key,mesh_metadata,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
        [id, trayId, parsed.data.partNumber, parsed.data.componentKind,
          Number(revision.rows[0]?.next ?? 1), originalFilename, sha,
          req.file!.size, sourceKey, meshKey,
          JSON.stringify({ triangleCount: converted.mesh.triangleCount, solidCount: converted.mesh.solidCount,
            boundsMm: converted.mesh.boundsMm, units: converted.mesh.units }), req.userId ?? null],
      );
      return { status: 'created' as const, id };
    });

    if (result.status !== 'created') {
      await Promise.allSettled([deleteObject(bucket, sourceKey), deleteObject(bucket, meshKey)]);
    }
    if (result.status === 'missing') { bad(res, 'MATERIAL_TRAY_NOT_FOUND', 404); return; }
    res.status(result.status === 'created' ? 201 : 200).json({
      id: result.id, reused: result.status === 'reused',
      meshReady: true,
    });
  } catch (error) {
    if (stored) await Promise.allSettled([deleteObject(bucket, sourceKey), deleteObject(bucket, meshKey)]);
    throw error;
  }
}));

materialTrayCadRouter.get('/:trayId/cad-assets/:assetId/download', safe(async (req, res) => {
  if (!uuid.safeParse(req.params.trayId).success || !uuid.safeParse(req.params.assetId).success) {
    bad(res, 'INVALID_MATERIAL_CAD_ID'); return;
  }
  const result = await pool.query<{ original_filename: string; source_object_key: string }>(
    `SELECT original_filename,source_object_key FROM material_tray_cad_assets
      WHERE material_tray_id=$1 AND id=$2`,
    [req.params.trayId, req.params.assetId],
  );
  const row = result.rows[0];
  if (!row) { bad(res, 'MATERIAL_CAD_NOT_FOUND', 404); return; }
  const stream = await getObjectStream(getProjectBucket(), row.source_object_key);
  res.setHeader('Content-Type', 'application/step');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', 'attachment; filename="catalog-component.step"');
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}));
