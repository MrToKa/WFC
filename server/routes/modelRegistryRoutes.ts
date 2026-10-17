import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireProjectEdit } from '../middleware.js';
import { pool } from '../db.js';
import { ModelRegistryError } from '../modelRegistry/errors.js';
import { getModelRegistry } from '../modelRegistry/runtime.js';
import { toImportDto } from '../modelRegistry/types.js';

const modelRegistryRouter = Router({ mergeParams: true });
// Selection metadata is private and must be revalidated by every consumer.
modelRegistryRouter.use((req, res, next) => {
  if ((['GET', 'HEAD'].includes(req.method) && /^\/model-versions\/?$/i.test(req.path)) ||
      (req.method === 'PATCH' && /^\/active-model\/?$/i.test(req.path))) {
    res.setHeader('Cache-Control', 'private, no-store');
  }
  next();
});
const uuid = z.string().uuid();
function reportError(res: Response, error: unknown): void {
  const safe = error instanceof ModelRegistryError ? error : new ModelRegistryError('REGISTRY_FAILURE', 500);
  res.status(safe.status).json({ error: safe.message, code: safe.code });
}
function identifier(value: unknown): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new ModelRegistryError('INVALID_IMPORT_REQUEST');
  return parsed.data.toLowerCase();
}
function project(req: Request): string { return identifier(req.params.projectId); }

// nginx auth_request runs this edit-only gate before reading a large import body.
// It neither creates an import nor accepts any package bytes.
modelRegistryRouter.get('/model-import-authorization', requireProjectEdit, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const exists = await pool.query('SELECT 1 FROM projects WHERE id=$1', [project(req)]);
    if (!exists.rows.length) throw new ModelRegistryError('PROJECT_NOT_FOUND', 404);
    res.status(204).end();
  } catch (error) { reportError(res, error); }
});

modelRegistryRouter.get('/model-versions', async (req, res) => {
  try { res.json(await getModelRegistry().listVersions(project(req))); }
  catch (error) { reportError(res, error); }
});
modelRegistryRouter.get('/model-imports/:importId', async (req, res) => {
  try {
    const job = await getModelRegistry().getImport(project(req), identifier(req.params.importId));
    const conflict = job.failure && ['PACKAGE_ID_CONFLICT', 'PROVENANCE_CONFLICT'].includes(job.failure.code);
    res.status(conflict ? 409 : 200).json({ job, ...(conflict ? { code: job.failure?.code, error: job.failure?.message } : {}) });
  }
  catch (error) { reportError(res, error); }
});
modelRegistryRouter.post('/model-imports', requireProjectEdit, async (req, res) => {
  try {
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/zip' || req.headers['content-encoding']) {
      throw new ModelRegistryError('INVALID_CONTENT_TYPE', 415);
    }
    const idempotencyKey = uuid.safeParse(req.header('idempotency-key'));
    const sha = req.header('x-package-sha256');
    const length = req.header('content-length');
    if (!idempotencyKey.success || !sha || !/^[a-f0-9]{64}$/.test(sha) || length !== undefined && !/^[0-9]+$/.test(length)) {
      throw new ModelRegistryError('INVALID_IMPORT_REQUEST');
    }
    if (!req.userId) throw new ModelRegistryError('INVALID_IMPORT_REQUEST', 401);
    const result = await getModelRegistry().receive(req, {
      projectId: project(req), requestedBy: req.userId, idempotencyKey: idempotencyKey.data,
      archiveSha256: sha, expectedBytes: length === undefined ? null : Number(length),
      continueUpload: () => { if (req.headers.expect?.toLowerCase() === '100-continue' && !res.headersSent) res.writeContinue(); },
    });
    // Early idempotency responses intentionally leave the second body unconsumed.
    if (!req.complete) res.setHeader('Connection', 'close');
    const conflict = result.job.failure && ['PACKAGE_ID_CONFLICT', 'PROVENANCE_CONFLICT'].includes(result.job.failure.code);
    res.status(conflict ? 409 : result.status).json({ importId: result.job.id, duplicate: result.job.duplicate || result.status === 200 && result.job.state === 'complete',
      modelVersionId: result.job.modelVersionId, job: toImportDto(result.job),
      ...(conflict ? { code: result.job.failure?.code, error: result.job.failure?.message } : {}) });
  } catch (error) {
    if (!req.complete) res.setHeader('Connection', 'close');
    reportError(res, error);
  }
});
const selection = z.object({ modelVersionId: uuid.nullable(), expectedSelectionRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
modelRegistryRouter.patch('/active-model', requireProjectEdit, async (req, res) => {
  try {
    const body = selection.safeParse(req.body);
    if (!body.success) throw new ModelRegistryError('INVALID_IMPORT_REQUEST');
    if (!req.userId) throw new ModelRegistryError('IMPORT_ACCESS_REVOKED', 403);
    res.json({ selection: await getModelRegistry().selectModel(project(req), body.data.modelVersionId, body.data.expectedSelectionRevision, req.userId) });
  } catch (error) { reportError(res, error); }
});
export { modelRegistryRouter };
