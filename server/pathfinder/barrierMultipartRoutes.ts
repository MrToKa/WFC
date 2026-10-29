import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { barrierMultipartCanonicalJson } from '../../shared/pathfinderBarrierMultipart.js';
import { BARRIER_MULTIPART_SESSION_LIMITS as L, barrierMultipartCancelCommandSchema, barrierMultipartReconcileCommandSchema, barrierMultipartCompleteProducerCommandSchema,
  barrierMultipartStagePageCommandSchema, barrierMultipartStagePartCommandSchema, barrierMultipartStageSealCommandSchema } from '../../shared/pathfinderBarrierMultipartSessions.js';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { requireViewerOrigin, viewerCookieSecret, viewerHttpPolicy, type ViewerHttpPolicy } from '../viewerSessions/http.js';
import { ViewerSessionError } from '../viewerSessions/errors.js';
import { barrierMultipartAdmissionBodySchema, createProtectedBarrierMultipartRepository, resolveBarrierMultipartViewerPrincipal,
  type BarrierMultipartViewerIdentity } from './barrierMultipartContext.js';
import type { BarrierMultipartRepositoryAdapters } from './barrierMultipartRepository.js';
import { PathFinderError } from './errors.js';
import { parsePolicyJson } from './policyJson.js';

export const BARRIER_MULTIPART_HTTP_LIMITS = Object.freeze({ activeParts: 1, activeControls: 4, commandHeaderBytes: 4096,
  requestMilliseconds: 60000, contextBytes: 262144, qualification: 'NOT_MEASURED' } as const);
export const BARRIER_MULTIPART_COMMAND_HEADER = 'x-wfc-barrier-command';
type ContextFactory = typeof createProtectedBarrierMultipartRepository;
type Options = { storage: BarrierMultipartRepositoryAdapters['storage']; policy?: ViewerHttpPolicy;
  /** Trusted server/test seams only. No request-body callbacks. */
  resolvePrincipal?: typeof resolveBarrierMultipartViewerPrincipal; createContext?: ContextFactory };
const fail = (code: string, status = 400): never => { throw new PathFinderError(code, status); };
function errorResponse(res: Response, error: unknown): void {
  const failure = error instanceof PathFinderError ? error : error instanceof ViewerSessionError ? new PathFinderError('BARRIER_MULTIPART_VIEWER_ACCESS_DENIED', error.status)
    : error instanceof z.ZodError ? new PathFinderError('BARRIER_MULTIPART_REQUEST_INVALID', 400)
      : new PathFinderError('BARRIER_MULTIPART_OUTCOME_UNKNOWN', 500, 'The multipart operation could not be confirmed. Retain the exact command.');
  if (!res.destroyed && !res.headersSent) res.status(failure.status).json({ code: failure.code, error: failure.message });
}
function oneHeader(req: Request, name: string, required = false): string | undefined {
  const values: string[] = [];
  for (let at = 0; at < req.rawHeaders.length; at += 2) if (req.rawHeaders[at].toLowerCase() === name) values.push(req.rawHeaders[at + 1]);
  if (values.length > 1 || required && values.length !== 1) fail('BARRIER_MULTIPART_HEADER_INVALID'); return values[0];
}
export function parseBarrierMultipartCommandHeader(req: Request) {
  const value = oneHeader(req, BARRIER_MULTIPART_COMMAND_HEADER, true)!;
  if (!value.length || value.length > BARRIER_MULTIPART_HTTP_LIMITS.commandHeaderBytes || /[^\x20-\x7e]/u.test(value)) fail('BARRIER_MULTIPART_HEADER_INVALID');
  const command = barrierMultipartStagePartCommandSchema.parse(parsePolicyJson(Buffer.from(value, 'ascii'), { maxBytes: 4096 }));
  if (barrierMultipartCanonicalJson(command) !== value) fail('BARRIER_MULTIPART_HEADER_INVALID'); return command;
}
function content(req: Request, type: 'json' | 'part', maximum: number, expected?: number): void {
  const declared = oneHeader(req, 'content-length'), encoding = oneHeader(req, 'content-encoding'), media = oneHeader(req, 'content-type', true)!;
  if (encoding !== undefined || (type === 'part' ? media !== 'application/octet-stream' : !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(media))) fail('BARRIER_MULTIPART_CONTENT_TYPE', 415);
  if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$(?![\s\S])/u.test(declared) || BigInt(declared) > BigInt(maximum)
    || expected !== undefined && BigInt(declared) !== BigInt(expected))) fail('BARRIER_MULTIPART_BODY_LIMIT', 413);
}
async function readBody(req: Request, maximum: number, signal: AbortSignal, expected?: number): Promise<Buffer> {
  signal.throwIfAborted(); const target = expected === undefined ? undefined : Buffer.allocUnsafe(expected), chunks: Buffer[] = []; let total = 0;
  const abort = () => req.destroy(); signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of req) {
      signal.throwIfAborted(); const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += bytes.length;
      if (total > maximum || expected !== undefined && total > expected) fail('BARRIER_MULTIPART_BODY_LIMIT', 413);
      if (target) bytes.copy(target, total - bytes.length); else chunks.push(bytes);
    }
    signal.throwIfAborted(); if (expected !== undefined && total !== expected) fail('BARRIER_MULTIPART_BODY_LIMIT', 413);
    return target ?? Buffer.concat(chunks, total);
  } finally { signal.removeEventListener('abort', abort); }
}
/** Mount on the exact Viewer cookie prefix BEFORE generic Viewer/session JSON
 * routers. No v1 event/body ceiling or application initializer is changed here. */
export function createBarrierMultipartRouter(pool: Pool, options: Options): Router & { close(): Promise<void> } {
  const router = Router({ mergeParams: true, caseSensitive: true }), policy = options.policy ?? viewerHttpPolicy(),
    principal = options.resolvePrincipal ?? resolveBarrierMultipartViewerPrincipal, factory = options.createContext ?? createProtectedBarrierMultipartRepository;
  const active = new Map<AbortController, Promise<void>>(); let parts = 0, controls = 0, stopped = false;
  router.use((req, res) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const isPart = req.method === 'PUT' && /^\/[a-f0-9-]{36}\/parts\/?$/u.test(req.path);
    if (stopped || (isPart ? parts >= BARRIER_MULTIPART_HTTP_LIMITS.activeParts : controls >= BARRIER_MULTIPART_HTTP_LIMITS.activeControls)) {
      errorResponse(res, new PathFinderError(stopped ? 'BARRIER_MULTIPART_STOPPED' : 'BARRIER_MULTIPART_BUSY', 503)); return;
    }
    if (isPart) parts++; else controls++;
    const controller = new AbortController(), disconnected = () => { if (!res.writableEnded) controller.abort(); };
    const timer = setTimeout(() => controller.abort(), BARRIER_MULTIPART_HTTP_LIMITS.requestMilliseconds); res.once('close', disconnected);
    const work = Promise.resolve().then(async () => {
      const signal = controller.signal;
      try {
        const raw = req.originalUrl.split('?')[0];
        if (!/^\/api\/projects\/[a-f0-9-]{36}\/model-versions\/[a-f0-9-]{36}\/viewer-sessions\/[a-f0-9-]{36}\/barrier-multipart(?:\/|$)/u.test(raw)
          || req.originalUrl.includes('?') || raw.includes('%') || raw.includes('\\')) fail('BARRIER_MULTIPART_ROUTE_INVALID');
        requireViewerOrigin(req, policy, !['GET', 'HEAD'].includes(req.method));
        const identity: BarrierMultipartViewerIdentity = { projectId: policyUuidSchema.parse(req.params.projectId), modelVersionId: policyUuidSchema.parse(req.params.modelVersionId),
          viewerSessionId: policyUuidSchema.parse(req.params.sessionId), cookieSecret: viewerCookieSecret(oneHeader(req, 'cookie', true)) };
        const who = await principal(pool, identity, signal); signal.throwIfAborted();
        if (req.method === 'POST' && /^\/sessions\/?$/u.test(req.path)) {
          content(req, 'json', L.controlBytes); const input = barrierMultipartAdmissionBodySchema.parse(parsePolicyJson(await readBody(req, L.controlBytes, signal), { maxBytes: L.controlBytes }));
          const context = await factory(pool, { identity, who, storage: options.storage, admission: input, signal });
          res.json(await context.repository.admit(identity.projectId, who, input.command, signal)); return;
        }
        const match = /^\/([a-f0-9-]{36})(?:\/(context|pages|seals|parts|reconcile|cancel|producer-completion)(?:\/(nodes|fragments|geometry-ranges|plan)\/(0|[1-9][0-9]{0,4}))?)?\/?$/u.exec(req.path);
        if (!match) return fail('BARRIER_MULTIPART_METHOD_UNSUPPORTED', 405);
        const intentId = policyUuidSchema.parse(match[1]), action = match[2], context = await factory(pool, { identity, who, storage: options.storage, intentId, signal });
        if (req.method === 'GET' && (!action || action === 'context') && !match[3]) {
          const value = await context.context(); if (Buffer.byteLength(JSON.stringify(value)) > BARRIER_MULTIPART_HTTP_LIMITS.contextBytes) fail('BARRIER_MULTIPART_RESPONSE_LIMIT', 413);
          res.json(action ? value : value.session); return;
        }
        if (req.method === 'GET' && action === 'pages' && match[3] && match[4]) {
          res.json(await context.repository.readPage(identity.projectId, who, intentId, match[3] as 'nodes' | 'fragments' | 'geometry-ranges' | 'plan', Number(match[4]), signal)); return;
        }
        if (req.method === 'GET' && action === 'producer-completion' && !match[3]) {
          const value = await context.repository.readCompletion(identity.projectId, who, intentId, signal);
          if (Buffer.byteLength(JSON.stringify(value)) > L.controlBytes) fail('BARRIER_MULTIPART_RESPONSE_LIMIT', 413);
          res.json(value); return;
        }
        if (req.method === 'PUT' && action === 'parts' && !match[3]) {
          const command = parseBarrierMultipartCommandHeader(req); if (command.intentId !== intentId) fail('BARRIER_MULTIPART_CONTEXT_CHANGED', 409);
          content(req, 'part', L.partBytes, command.payload.bytes);
          res.json(await context.repository.stagePart(identity.projectId, who, command, await readBody(req, L.partBytes, signal, command.payload.bytes), signal)); return;
        }
        if (req.method === 'POST' && !match[3] && action !== undefined && ['pages', 'seals', 'reconcile', 'cancel', 'producer-completion'].includes(action)) {
          const maximum = action === 'pages' ? L.pageBytes + L.controlBytes : L.controlBytes; content(req, 'json', maximum);
          const input = parsePolicyJson(await readBody(req, maximum, signal), { maxBytes: maximum });
          const command = action === 'pages' ? barrierMultipartStagePageCommandSchema.parse(input) : action === 'seals' ? barrierMultipartStageSealCommandSchema.parse(input)
            : action === 'cancel' ? barrierMultipartCancelCommandSchema.parse(input)
              : action === 'producer-completion' ? barrierMultipartCompleteProducerCommandSchema.parse(input) : barrierMultipartReconcileCommandSchema.parse(input);
          if (command.intentId !== intentId) fail('BARRIER_MULTIPART_CONTEXT_CHANGED', 409);
          const value = action === 'pages' ? await context.repository.stagePage(identity.projectId, who, command, signal)
            : action === 'seals' ? await context.repository.stageSeal(identity.projectId, who, command, signal)
              : action === 'cancel' ? await context.repository.cancel(identity.projectId, who, command, signal)
                : action === 'producer-completion' ? await context.repository.completeProducer(identity.projectId, who, command, signal)
                : await context.repository.reconcile(identity.projectId, who, command, signal);
          res.json(value); return;
        }
        fail('BARRIER_MULTIPART_METHOD_UNSUPPORTED', 405);
      } catch (error) { errorResponse(res, signal.aborted && !(error instanceof PathFinderError) ? new PathFinderError('BARRIER_MULTIPART_REQUEST_CANCELLED', 408) : error); }
      finally { clearTimeout(timer); res.removeListener('close', disconnected); if (isPart) parts--; else controls--; active.delete(controller); }
    });
    active.set(controller, work);
  });
  return Object.assign(router, { async close() { stopped = true; for (const controller of active.keys()) controller.abort(); while (active.size) await Promise.allSettled([...active.values()]); } });
}
