import { Worker, type WorkerOptions } from 'node:worker_threads';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PathFinderError } from './errors.js';
import { preparationStorageLockBuffer, releasePreparationStorageOwner } from './preparationStorage.js';
import { geometryTraceThreadInputSchema, geometryEvidenceThreadInputSchema, geometryTraceThreadMessageSchema, geometryTraceThreadResultSchema, geometryEvidenceThreadResultSchema, type GeometryTraceThreadInput, type GeometryEvidenceThreadInput, type GeometryThreadResult } from './geometryTraceThread.js';

export const geometryTraceWorkerPolicy = Object.freeze({ milliseconds: 120000, oldGenerationMiB: 512, rssBytes: 2 * 1024 ** 3, rssIntervalMilliseconds: 100, joinMilliseconds: 10000 });
export interface GeometryTraceWorkerThread { readonly threadId: number; on(event: 'message', handler: (message: unknown) => void): this; on(event: 'error', handler: (error: Error) => void): this; on(event: 'exit', handler: (code: number) => void): this; terminate(): Promise<number>; }
type Target = { filename: URL | string; options?: WorkerOptions };
export interface GeometryTraceWorkerDependencies { target: () => Promise<Target>; spawn: (filename: URL | string, options: WorkerOptions) => GeometryTraceWorkerThread; residentBytes: () => number; storageLockBuffer: SharedArrayBuffer; releaseStorageOwner: (threadId: number) => void; }
export type GeometryTraceWorkerInput = Omit<GeometryTraceThreadInput, 'schemaVersion' | 'requestId' | 'storageLockBuffer'>;
export type GeometryEvidenceWorkerInput = Omit<GeometryEvidenceThreadInput, 'schemaVersion' | 'requestId' | 'storageLockBuffer'>;
async function regular(url: URL) { try { const s = await fs.lstat(url); return s.isFile() && !s.isSymbolicLink(); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
export async function resolveGeometryTraceWorkerTarget(): Promise<Target> {
  const compiled = new URL('./geometryTraceThread.js', import.meta.url); if (await regular(compiled)) return { filename: compiled };
  const source = new URL('./geometryTraceThread.ts', import.meta.url); if (!new URL(import.meta.url).pathname.endsWith('.ts') || !await regular(source)) throw new PathFinderError('GEOMETRY_TRACE_WORKER_UNAVAILABLE', 503);
  const loader = import.meta.resolve('tsx/esm/api'); return { filename: `(async()=>{const{register}=await import(${JSON.stringify(loader)});register();await import(${JSON.stringify(source.href)});})().catch(()=>{process.exitCode=1;});`, options: { eval: true } };
}
/** Fixed executable and refs only. Unconfirmed termination quarantines its lane/lease. */
export function createGeometryTraceWorker(deps: GeometryTraceWorkerDependencies) {
  let occupied = false;
  return async (raw: GeometryTraceWorkerInput | GeometryEvidenceWorkerInput, signal: AbortSignal): Promise<GeometryThreadResult> => {
    signal.throwIfAborted(); if (occupied) throw new PathFinderError('GEOMETRY_TRACE_WORKER_BUSY', 503); occupied = true; let spawned = false;
    try {
      const input = 'exportId' in raw ? geometryTraceThreadInputSchema.parse({ ...raw, schemaVersion: 'wfc.pf.geometry-trace-thread.v1', requestId: randomUUID(), storageLockBuffer: deps.storageLockBuffer }) : geometryEvidenceThreadInputSchema.parse({ ...raw, schemaVersion: 'wfc.pf.geometry-evidence-thread.v1', requestId: randomUUID(), storageLockBuffer: deps.storageLockBuffer }), initial = deps.residentBytes();
      if (!Number.isFinite(initial) || initial < 0) throw new PathFinderError('GEOMETRY_TRACE_MEMORY_UNAVAILABLE', 503); if (initial >= geometryTraceWorkerPolicy.rssBytes) throw new PathFinderError('GEOMETRY_TRACE_MEMORY_LIMIT', 413);
      const target = await deps.target(); signal.throwIfAborted(); const worker = deps.spawn(target.filename, { ...target.options, execArgv: [], workerData: input, resourceLimits: { maxOldGenerationSizeMb: geometryTraceWorkerPolicy.oldGenerationMiB } }); spawned = true; const threadId = worker.threadId;
      return await new Promise((resolve, reject) => {
        let settled = false, exited = false, released = false, stopping = false, seen = false, result: GeometryThreadResult | undefined, stopError: Error | undefined;
        let timeout: ReturnType<typeof setTimeout>, rss: ReturnType<typeof setInterval>, join: ReturnType<typeof setTimeout> | undefined;
        const release = () => { if (!released) { released = true; deps.releaseStorageOwner(threadId); occupied = false; } };
        const cleanup = () => { clearTimeout(timeout); clearInterval(rss); if (join) clearTimeout(join); signal.removeEventListener('abort', abort); };
        const settle = (error?: Error) => { if (settled) return; settled = true; cleanup(); if (error) reject(error); else if (result) resolve(result); else reject(new PathFinderError('GEOMETRY_TRACE_WORKER_PROTOCOL', 502)); };
        const stop = (error?: Error) => { if (stopping || settled) return; stopping = true; stopError = error; clearTimeout(timeout); clearInterval(rss); join = setTimeout(() => { if (exited) { release(); settle(stopError); } else settle(new PathFinderError('GEOMETRY_TRACE_JOIN_UNCONFIRMED', 503)); }, geometryTraceWorkerPolicy.joinMilliseconds); void worker.terminate().then(() => { exited = true; release(); settle(stopError); }, () => { if (exited) { release(); settle(stopError); } else settle(new PathFinderError('GEOMETRY_TRACE_JOIN_UNCONFIRMED', 503)); }); };
        const abort = () => { const error = new DOMException('Geometry trace construction cancelled.', 'AbortError'); if (stopping && !settled) stopError = error; else stop(error); };
        worker.on('message', value => { if (settled) return; if (stopping) { if (seen) stopError = new PathFinderError('GEOMETRY_TRACE_WORKER_PROTOCOL', 502); return; } const parsed = geometryTraceThreadMessageSchema.safeParse(value); if (seen || !parsed.success || parsed.data.requestId !== input.requestId) { stop(new PathFinderError('GEOMETRY_TRACE_WORKER_PROTOCOL', 502)); return; } seen = true; if (parsed.data.type === 'error') { stop(new PathFinderError(parsed.data.code, parsed.data.code === 'GEOMETRY_TRACE_BUILD_LIMIT' ? 413 : 409)); return; } const output = parsed.data.result; if (input.schemaVersion === 'wfc.pf.geometry-trace-thread.v1' ? output.schemaVersion !== 'wfc.pf.geometry-trace-build-result.v1' || output.transientExport.exportId !== input.exportId : output.schemaVersion !== 'wfc.pf.geometry-evidence-validated.v1' || output.partId !== input.partId || output.validatedPartSha256 !== input.partBlob.sha256 || output.evidenceBlob.sha256 !== input.evidenceBlob.sha256) { stop(new PathFinderError('GEOMETRY_TRACE_WORKER_PROTOCOL', 502)); return; } result = output; stop(); });
        worker.on('error', () => { const error = new PathFinderError('GEOMETRY_TRACE_WORKER_FAILED', 503); if (stopping && !settled) stopError ??= error; else stop(error); });
        worker.on('exit', code => { exited = true; if (stopping) { if (settled) release(); return; } release(); if (code || !result) settle(new PathFinderError('GEOMETRY_TRACE_WORKER_FAILED', 503)); else settle(); });
        timeout = setTimeout(() => stop(new PathFinderError('GEOMETRY_TRACE_WORKER_TIMEOUT', 504)), geometryTraceWorkerPolicy.milliseconds);
        rss = setInterval(() => { try { const bytes = deps.residentBytes(); if (!Number.isFinite(bytes) || bytes < 0 || bytes >= geometryTraceWorkerPolicy.rssBytes) stop(new PathFinderError('GEOMETRY_TRACE_MEMORY_LIMIT', 413)); } catch { stop(new PathFinderError('GEOMETRY_TRACE_MEMORY_UNAVAILABLE', 503)); } }, geometryTraceWorkerPolicy.rssIntervalMilliseconds);
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      });
    } finally { if (!spawned) occupied = false; }
  };
}
const run = createGeometryTraceWorker({ target: resolveGeometryTraceWorkerTarget, spawn: (filename, options) => new Worker(filename, options), residentBytes: () => process.memoryUsage.rss(), storageLockBuffer: preparationStorageLockBuffer, releaseStorageOwner: releasePreparationStorageOwner });
export const runGeometryTraceWorker = async (input: GeometryTraceWorkerInput, signal: AbortSignal) => geometryTraceThreadResultSchema.parse(await run(input, signal));
export const runGeometryEvidenceWorker = async (input: GeometryEvidenceWorkerInput, signal: AbortSignal) => geometryEvidenceThreadResultSchema.parse(await run(input, signal));
