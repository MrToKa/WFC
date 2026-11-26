import type { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { withMaterialTransaction } from '../services/materialAuditPool.js';
import { materialIdentityConflict, isMaterialIdentityConflict } from '../utils/materialIdentity.js';
import { createMaterialTrayInstallationMaterialSchema } from '../validators.js';
import { pagePrompt, requestPageAssistant } from './pageRequest.js';

type MaterialInput = z.infer<typeof createMaterialTrayInstallationMaterialSchema>;
const requestSchema = z.object({ prompt: pagePrompt }).strict();
const sourceField = createMaterialTrayInstallationMaterialSchema.shape.source;
const materialBatch = (prompt: string) => z.array(
  z.record(z.unknown()).transform((row) =>
    Object.fromEntries(Object.entries(row).filter(([field, value]) => {
      if (value === null) return false;
      if (field !== 'source') return true;
      return typeof value === 'string' && sourceField.safeParse(value).success && prompt.includes(value.trim());
    })),
  ).pipe(createMaterialTrayInstallationMaterialSchema),
).max(25);

export function registerMaterialAssistant(
  router: Router,
  catalog: string,
  insert: (client: PoolClient, data: MaterialInput) => Promise<unknown>,
) {
  router.post('/assistant', authenticate, requireAdmin, async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid assistant request.' });
      return;
    }

    try {
      const output = await requestPageAssistant(parsed.data.prompt, '/materials', catalog);
      const batch = materialBatch(parsed.data.prompt).safeParse(output.materials);
      if (!batch.success) {
        const issue = batch.error.issues[0];
        res.status(422).json({ error: `Invalid material data at ${issue.path.join('.')}. ${issue.message}` });
        return;
      }

      const rows = batch.data;
      if (rows.length) {
        await withMaterialTransaction(async (client) => {
          const actor = await client.query<{ is_admin: boolean }>(
            'SELECT is_admin FROM users WHERE id = $1 FOR SHARE', [req.userId],
          );
          if (!actor.rows[0]?.is_admin) {
            throw new PathFinderError('ASSISTANT_CATALOG_FORBIDDEN', 403, 'Catalog changes require administrator access.');
          }
          for (const row of rows) await insert(client, row);
        });
      }

      res.status(rows.length ? 201 : 200).json({ answer: output.answer, created: rows.length });
    } catch (error) {
      if (error instanceof PathFinderError) {
        res.status(error.status).json({ error: error.message });
      } else if (isMaterialIdentityConflict(error)) {
        res.status(409).json({ error: materialIdentityConflict });
      } else {
        console.error('Material assistant operation failed', error);
        res.status(500).json({ error: 'Material assistant operation failed.' });
      }
    }
  });
}