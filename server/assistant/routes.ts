import { receiveTaskDocuments, saveTaskDocuments, discardTaskDocuments } from './taskDocuments.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { z } from 'zod';
import { pool } from '../db.js';
import { transaction } from '../pathfinder/transactions.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { requestPrincipal } from '../pathfinder/auth.js';
import {
  endpointBindingTransaction,
  readCurrentEndpointBindingContext,
} from '../pathfinder/endpointBindingRepository.js';
import {
  assistantText,
  assistantStart,
  type AssistantFile,
} from '../../shared/projectAssistant.js';
import { getObjectStream, getProjectBucket } from '../services/objectStorageService.js';

import { applySavedProposal, runLocalAssignment } from './assignmentWorkflow.js';
import { requireProjectEdit } from '../middleware.js';
export const assistantRouter = Router({ mergeParams: true });
assistantRouter.use((req, res, next) =>
  req.method === 'GET' || req.method === 'HEAD' ? next() : requireProjectEdit(req, res, next),
);
const conflict = (message: string): never => {
  throw new PathFinderError('ASSISTANT_CONFLICT', 409, message);
};
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch((error) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid assistant input' });
        return;
      }
      if (error instanceof PathFinderError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      console.error('Project assistant operation failed', error);
      res.status(500).json({ error: 'Assistant operation failed' });
    });
  };
assistantRouter.get(
  '/',
  handle(async (req, res) => {
    const project = req.params.projectId;
    const [rules, selected, jobs] = await Promise.all([
      pool.query('SELECT rules,revision FROM assistant_rules WHERE project_id=$1', [project]),
      pool.query(
        'SELECT active_model_version_id AS id FROM project_model_selections WHERE project_id=$1',
        [project],
      ),
      pool.query(
        `SELECT id,author,status,instructions,rules,created_at,error,proposals,applied,progress,previous_job_id,answers,follow_up_mode,conversation_answer,workflow_grant IS NOT NULL AS automatic_assignment,workflow_state,workflow_summary,
       CASE WHEN follow_up_mode='results' THEN 0 ELSE jsonb_array_length(files) END AS total,tokens,estimated_usd::float8 AS estimated_usd,
       CASE WHEN follow_up_mode<>'results' AND status IN ('running','failed') THEN files->progress->>'name' END AS current_file,
       scope->>'modelVersionId' AS model_id FROM assistant_jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 30`,
        [project],
      ),
    ]);
    res.set('Cache-Control', 'no-store').json({
      rules: rules.rows[0]?.rules ?? '',
      revision: rules.rows[0]?.revision ?? 0,
      modelVersionId: selected.rows[0]?.id ?? null,
      jobs: jobs.rows,
    });
  }),
);
assistantRouter.put(
  '/rules',
  handle(async (req, res) => {
    const { rules, revision } = z
      .object({ rules: assistantText, revision: z.number().int().nonnegative() })
      .parse(req.body);
    const updated = await pool.query(
      `INSERT INTO assistant_rules(project_id,rules,revision) SELECT $1,$2,1 WHERE $3::int=0
    ON CONFLICT DO NOTHING RETURNING revision`,
      [req.params.projectId, rules, revision],
    );
    if (updated.rowCount) {
      res.json({ revision: 1 });
      return;
    }
    const result = await pool.query(
      'UPDATE assistant_rules SET rules=$2,revision=revision+1 WHERE project_id=$1 AND revision=$3 RETURNING revision',
      [req.params.projectId, rules, revision],
    );
    if (!result.rowCount) conflict('Project instructions changed. Reload before saving.');
    res.json(result.rows[0]);
  }),
);
assistantRouter.post(
  '/jobs',
  receiveTaskDocuments,
  handle(async (req, res) => {
    const data = assistantStart.parse(req.body);
    const mode = data.followUpMode ?? 'documents';
    const pid = req.params.projectId;
    if (!process.env.WFC_ASSISTANT_URL) {
      res
        .status(503)
        .json({ error: 'Project assistant worker is not configured on this installation' });
      return;
    }
    const automatic = data.automaticAssignment;
    if (automatic && (data.previousJobId || mode !== 'documents'))
      return conflict('Automatic assignment requires a new document analysis');
    if (automatic && !req.isAdmin) throw new PathFinderError('ADMIN_REQUIRED', 403);
    const who = automatic ? requestPrincipal(req) : null;
    const stored: AssistantFile[] = [];
    const save = async (c: import('pg').PoolClient) => {
      await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [pid]);
      const existing = (
        await c.query(
          'SELECT id,author,instructions,scope,files,rules_revision,previous_job_id,follow_up_mode,workflow_grant FROM assistant_jobs WHERE id=$1 AND project_id=$2',
          [data.id, pid],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.author !== req.userId ||
          Boolean(existing.workflow_grant) !== Boolean(automatic) ||
          (automatic &&
            existing.workflow_grant?.replaceConflicting !== automatic.replaceConflicting) ||
          existing.instructions !== data.instructions ||
          existing.scope.modelVersionId !== data.modelVersionId ||
          existing.rules_revision !== data.rulesRevision ||
          existing.previous_job_id !== (data.previousJobId ?? null) ||
          existing.follow_up_mode !== mode ||
          ((!data.previousJobId || data.files.length > 0) &&
            JSON.stringify(existing.files.map((f: AssistantFile) => [f.id, f.versionId])) !==
              JSON.stringify(data.files.map((f) => [f.id, f.versionId])))
        )
          conflict('Job identifier already used');
        return false;
      }
      let scope =
        mode === 'documents' ? await readCurrentEndpointBindingContext(c, pid) : undefined;
      if (mode === 'documents' && (!scope?.traceId || scope.modelVersionId !== data.modelVersionId))
        conflict('Prepare the active 3D model before starting this task.');
      const rules = (
        await c.query('SELECT rules,revision FROM assistant_rules WHERE project_id=$1 FOR SHARE', [
          pid,
        ])
      ).rows[0];
      if ((rules?.revision ?? 0) !== data.rulesRevision)
        conflict('Project instructions changed. Reload the page.');
      const files: AssistantFile[] = [];
      if (data.previousJobId) {
        const previous = (
          await c.query<{ files: AssistantFile[]; scope: typeof scope }>(
            "SELECT files,scope FROM assistant_jobs WHERE project_id=$1 AND id=$2 AND status='review'",
            [pid, data.previousJobId],
          )
        ).rows[0];
        if (!previous?.files.length) return conflict('Избери завършен анализ от този проект.');
        if (mode === 'results') {
          scope = previous.scope;
          if (!scope || scope.modelVersionId !== data.modelVersionId)
            conflict('Предишният анализ е променен. Обнови страницата.');
        }
        for (const file of data.files.length ? [] : previous.files) {
          if (mode === 'results' || file.taskDocument) {
            files.push(file);
            continue;
          }
          const available = await c.query(
            `SELECT 1 FROM project_files f WHERE f.project_id=$1 AND f.id=$2 AND
              (f.object_key=$3 OR EXISTS (
                SELECT 1 FROM project_file_versions v WHERE v.project_file_id=f.id AND v.object_key=$3
              ))`,
            [pid, file.id, file.key],
          );
          if (!available.rowCount)
            conflict(
              `Документът „${file.name}“ от предишната задача вече не е наличен. Избери документите за нов анализ.`,
            );
          files.push(file);
        }
      }
      files.push(...stored);
      for (const selected of stored.length ? [] : data.files) {
        const row = (
          await c.query(
            `SELECT f.file_name AS name,f.object_key AS key,f.uploaded_at AS stamp FROM project_files f
       WHERE f.project_id=$1 AND f.id=$2 AND $3::uuid IS NULL UNION ALL
       SELECT v.file_name,v.object_key,v.created_at FROM project_file_versions v JOIN project_files f ON f.id=v.project_file_id
       WHERE f.project_id=$1 AND f.id=$2 AND v.id=$3`,
            [pid, selected.id, selected.versionId],
          )
        ).rows[0];
        if (
          !row ||
          !['.pdf', '.png', '.jpeg', '.jpg', '.csv'].includes(
            path.extname(row.name).toLowerCase(),
          ) ||
          (!selected.versionId &&
            (!selected.uploadedAt || new Date(row.stamp).toISOString() !== selected.uploadedAt)) ||
          files.some((f) => f.key === row.key)
        )
          conflict('Choose distinct supported document revisions from this project.');
        files.push({ ...selected, name: row.name, key: row.key });
      }
      await c.query(
        'INSERT INTO assistant_jobs(id,project_id,author,rules,rules_revision,instructions,scope,files,previous_job_id,follow_up_mode,workflow_grant,workflow_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          data.id,
          pid,
          req.userId,
          rules?.rules ?? '',
          data.rulesRevision,
          data.instructions,
          scope,
          JSON.stringify(files),
          data.previousJobId ?? null,
          mode,
          who && automatic
            ? {
                loginId: who.loginId,
                loginExpiresAt: who.loginExpiresAt,
                replaceConflicting: automatic.replaceConflicting,
              }
            : null,
          automatic ? 'pending' : null,
        ],
      );
      return true;
    };
    try {
      if (req.is('multipart/form-data')) {
        await saveTaskDocuments(pid, data.id, req.files as Express.Multer.File[], data.files, stored);
      }
      const created = who ? await endpointBindingTransaction(pool, pid, who, save) : await transaction(pool, save);
      if (!created) await discardTaskDocuments(stored);
    } catch (error) {
      if (!(error instanceof PathFinderError && error.code.endsWith('COMMIT_OUTCOME_UNKNOWN'))) {
        await discardTaskDocuments(stored);
      }
      throw error;
    }
    res.status(202).json({ id: data.id });
  }),
);
assistantRouter.post(
  '/jobs/:job/resume',
  handle(async (req, res) => {
    const id = z.string().uuid().parse(req.params.job);
    const pid = req.params.projectId;
    const job = (
      await pool.query(
        'SELECT workflow_grant FROM assistant_jobs WHERE project_id=$1 AND id=$2 AND author=$3',
        [pid, id, req.userId],
      )
    ).rows[0];
    const result = job?.workflow_grant
      ? await endpointBindingTransaction(pool, pid, requestPrincipal(req), async (c) => {
          const who = requestPrincipal(req);
          return c.query(
            "UPDATE assistant_jobs SET status='queued',error=NULL,workflow_state='pending',workflow_grant=workflow_grant || $4::jsonb WHERE project_id=$1 AND id=$2 AND author=$3 AND status='failed' RETURNING id",
            [
              pid,
              id,
              who.userId,
              JSON.stringify({ loginId: who.loginId, loginExpiresAt: who.loginExpiresAt }),
            ],
          );
        })
      : await pool.query(
          "UPDATE assistant_jobs SET status='queued',error=NULL WHERE project_id=$1 AND id=$2 AND author=$3 AND status='failed' AND workflow_grant IS NULL RETURNING id",
          [pid, id, req.userId],
        );
    if (!result.rowCount) conflict('Only the task author can resume a failed task.');
    res.json(result.rows[0]);
  }),
);
assistantRouter.get(
  '/jobs/:job/source/:index',
  handle(async (req, res) => {
    const index = z.coerce.number().int().min(0).max(24).parse(req.params.index);
    const file = (
      await pool.query(
        'SELECT files->$3::int AS f FROM assistant_jobs WHERE project_id=$1 AND id=$2',
        [req.params.projectId, z.string().uuid().parse(req.params.job), index],
      )
    ).rows[0]?.f as AssistantFile | undefined;
    if (!file) {
      res.sendStatus(404);
      return;
    }
    const ext = path.extname(file.name).toLowerCase();
    res.set({
      'Content-Type':
        ext === '.pdf'
          ? 'application/pdf'
          : ext === '.png'
            ? 'image/png'
            : ext === '.csv'
              ? 'text/plain'
              : 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private,no-store',
    });
    const stream = await getObjectStream(getProjectBucket(), file.key);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }),
);
assistantRouter.post(
  '/jobs/:job/apply',
  handle(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    const result = await applySavedProposal(
      req.params.projectId,
      z.string().uuid().parse(req.params.job),
      id,
      requestPrincipal(req),
      false,
    );
    res.json({ impact: result.impact });
  }),
);

assistantRouter.post(
  '/jobs/:job/recheck',
  handle(async (req, res) => {
    const input = z
      .object({
        autoApply: z.boolean(),
        providerReview: z.boolean().default(false),
        replaceConflicting: z.boolean().default(false),
        tag: z.string().trim().min(1).max(500).optional(),
      })
      .strict()
      .parse(req.body);
    if (input.replaceConflicting && !input.autoApply)
      return conflict('Replacement requires automatic application');
    if ((input.providerReview || input.replaceConflicting) && !req.isAdmin)
      throw new PathFinderError('ADMIN_REQUIRED', 403);
    const pid = req.params.projectId,
      jobId = z.string().uuid().parse(req.params.job);
    const who = requestPrincipal(req);
    res.json(await runLocalAssignment(pid, jobId, who, input));
  }),
);
