import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fittedTraceReferenceSchema, geometryRuntimeFingerprintSchema, GEOMETRY_TRACE_LIMITS } from '../../shared/pathfinderGeometryTrace.js';
import type { GeometryTraceAdapters } from './geometryTraceRepository.js';
import type { EngineExecutor } from './engineSession.js';
import { preparedUnionResponseSchema } from './preparationPublisher.js';
import { PathFinderError } from './errors.js';

const VERSION = '45c24bf5f433f13e102600b36f20327c77961d0a';
const failure = (code: string): never => { throw new PathFinderError(code, 503, 'The geometry trace implementation is unavailable or changed.'); };
const prepared = preparedUnionResponseSchema.shape.prepared.extend({ traceExport: fittedTraceReferenceSchema });
const responseSchema = preparedUnionResponseSchema.extend({ prepared });
const inputSchema = z.object({ projectId: z.string().uuid(), modelVersionId: z.string().uuid(), snapshotId: z.string().uuid(), snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/), exportId: z.string().uuid(), maxBytes: z.number().int().min(1024).max(GEOMETRY_TRACE_LIMITS.exportBytes) }).strict();
async function readImplementation(filename: string, maximum: number): Promise<Buffer> {
  const resolved = path.resolve(filename);
  // All ancestors are canonical: a symlinked parent must not redefine the pinned implementation.
  for (let current = path.dirname(resolved); ; current = path.dirname(current)) {
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(await fs.realpath(current)) !== current) return failure('GEOMETRY_TRACE_IMPLEMENTATION_PATH');
    if (path.dirname(current) === current) break;
  }
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > maximum) return failure('GEOMETRY_TRACE_IMPLEMENTATION_PATH');
  const bytes = await fs.readFile(resolved);
  if (bytes.length !== stat.size) return failure('GEOMETRY_TRACE_IMPLEMENTATION_CHANGED');
  return bytes;
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Fingerprint actual executable modules and the compiled derivation, never a caller label. */
export async function geometryTraceRuntimeFingerprint() {
  const dll = process.env.PF_ENGINE_DLL;
  if (!dll || !path.isAbsolute(dll) || path.basename(dll) !== 'PathFinder.ModelRunner.dll') return failure('GEOMETRY_TRACE_ENGINE_NOT_CONFIGURED');
  const directory = path.dirname(dll), hashes: Record<string, string> = {};
  for (const name of ['PathFinder.ModelRunner.dll', 'PathFinder.Model.dll', 'PathFinder.Core.dll', 'PathFinder.Adapter.dll']) hashes[name] = digest(await readImplementation(path.join(directory, name), 64 * 1024 ** 2));
  const derivation = createHash('sha256');
  const names = ['./geometryTraceEngine.js', './geometryTraceBuilder.js', './geometryTraceRepository.js', './geometryTraceStorage.js', './geometryTraceWorker.js', './geometryTraceThread.js', './preparationStorage.js', './contracts.js', './matching.js', './policyJson.js', '../../shared/pathfinderGeometryTrace.js', '../../shared/pathfinderPreparation.js', '../../shared/preparationMerge.js', '../../shared/pathfinderPurposePolicy.js', '../../viewer-runtime/capture-evidence.mjs'];
  for (const name of names) {
    const bytes = await readImplementation(fileURLToPath(new URL(name, import.meta.url)), 4 * 1024 ** 2);
    derivation.update(name + '\n' + bytes.length + '\n').update(bytes).update('\n');
  }
  return geometryRuntimeFingerprintSchema.parse({ version: VERSION, runnerSha256: hashes['PathFinder.ModelRunner.dll'], modelModuleSha256: hashes['PathFinder.Model.dll'], coreModuleSha256: hashes['PathFinder.Core.dll'], adapterModuleSha256: hashes['PathFinder.Adapter.dll'], derivationSha256: derivation.digest('hex') });
}

/** Reuse the advisory-owned serialized preparation lane; this creates no second engine. */
export function createGeometryTraceEngine(execute: EngineExecutor['execute']): GeometryTraceAdapters {
  return {
    getRuntimeFingerprint: geometryTraceRuntimeFingerprint,
    async exportFittedTrace(raw, signal) {
      const input = inputSchema.parse(raw); signal.throwIfAborted();
      const before = await geometryTraceRuntimeFingerprint(), requestId = randomUUID();
      const response = responseSchema.parse(await execute({ schemaVersion: 'pathfinder.model.runner.v1', requestId, operation: 'prepare', projectId: input.projectId, modelVersionId: input.modelVersionId, snapshotId: input.snapshotId, snapshotSha256: input.snapshotSha256, timeoutMilliseconds: 120000, fittedTraceExport: { schemaVersion: 'wfc.pf.fitted-trace-export-request.v1', exportId: input.exportId, maxBytes: input.maxBytes } }, signal));
      signal.throwIfAborted(); const reference = response.prepared.traceExport;
      const { derivationSha256: _derivation, ...engine } = before;
      if (response.requestId !== requestId || response.model.projectId !== input.projectId || response.model.modelVersionId !== input.modelVersionId || reference.exportId !== input.exportId || reference.snapshotSha256 !== input.snapshotSha256 || reference.preparedKey !== response.prepared.key || reference.bytes > input.maxBytes || JSON.stringify(reference.engine) !== JSON.stringify(engine)) return failure('GEOMETRY_TRACE_ENGINE_IDENTITY');
      if (JSON.stringify(await geometryTraceRuntimeFingerprint()) !== JSON.stringify(before)) return failure('GEOMETRY_TRACE_IMPLEMENTATION_CHANGED');
      return reference;
    },
  };
}
