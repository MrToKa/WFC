import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireProjectEdit } from '../middleware.js';
import { withTransaction } from '../utils/transaction.js';
import { changeProjectTrayPurpose, listProjectTrayPurposes, trayPurposeNameSchema, TrayPurposeError } from '../services/projectTrayPurposeService.js';

export const projectTrayPurposesRouter = Router({ mergeParams: true });
const nameBody = z.object({ name: trayPurposeNameSchema }).strict();
const renameBody = nameBody.extend({ nextName: trayPurposeNameSchema });
function failure(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Use a tray purpose name from 1 to 200 characters without control characters.', code: 'INVALID_TRAY_PURPOSE' });
  if (error instanceof TrayPurposeError) return res.status(error.status).json({ error: error.message, code: error.code });
  console.error('Project tray purpose error', error);
  return res.status(500).json({ error: 'Tray purposes could not be updated. Refresh and try again.' });
}
projectTrayPurposesRouter.get('/', async (req: Request, res: Response) => {
  try { res.json(await listProjectTrayPurposes(pool, req.params.projectId)); }
  catch (error) { failure(res, error); }
});
for (const [method, operation] of [['post', 'create'], ['patch', 'rename'], ['delete', 'delete']] as const) {
  projectTrayPurposesRouter[method]('/', requireProjectEdit, async (req: Request, res: Response) => {
    try {
      const body = (operation === 'rename' ? renameBody : nameBody).parse(req.body);
      res.json(await withTransaction(c => changeProjectTrayPurpose(c, req.params.projectId, req.userId!, { ...body, operation })));
    } catch (error) { failure(res, error); }
  });
}
