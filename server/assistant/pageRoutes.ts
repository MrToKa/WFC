import { Router } from 'express';
import { z } from 'zod';
import { authenticate, loadCurrentUserRole } from '../middleware.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { pagePrompt, requestPageAssistant } from './pageRequest.js';

export const pageAssistantRouter = Router();

pageAssistantRouter.post('/page', authenticate, loadCurrentUserRole, async (req, res) => {
  const parsed = z.object({
    prompt: pagePrompt,
    page: z.string().regex(/^[/a-zA-Z0-9-]+$/).max(100),
  }).strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid assistant request.' });
    return;
  }
  try {
    const { answer } = await requestPageAssistant(parsed.data.prompt, parsed.data.page);
    res.set('Cache-Control', 'no-store').json({ answer });
  } catch (error) {
    if (!(error instanceof PathFinderError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
});