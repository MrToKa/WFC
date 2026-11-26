import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { PathFinderError } from '../pathfinder/errors.js';
import { analyzeDocument } from './workerTransport.js';

export const pagePrompt = z.string().trim().min(1).max(12000);

export async function requestPageAssistant(prompt: string, page: string, catalog?: string) {
  const worker = process.env.WFC_ASSISTANT_URL;
  if (!worker) throw new PathFinderError('ASSISTANT_UNAVAILABLE', 503, 'AI Assistant is unavailable.');
  try {
    const secret = (await readFile('/run/secrets/assistant-token', 'utf8')).trim();
    const { status, result } = await analyzeDocument(
      new URL('/page-request', worker), secret, { prompt, page, catalog }, 120000,
    );
    if (status === 429) {
      throw new PathFinderError('ASSISTANT_BUSY', 429, 'AI Assistant is busy. Try again shortly.');
    }
    if (status !== 200) throw new Error('Assistant worker rejected the request.');
    return z.object({
      answer: z.string().trim().min(1).max(4000),
      materials: z.array(z.unknown()).max(25),
    }).parse(result);
  } catch (error) {
    if (error instanceof PathFinderError) throw error;
    throw new PathFinderError('ASSISTANT_REQUEST_FAILED', 502, 'AI Assistant could not complete the request.');
  }
}