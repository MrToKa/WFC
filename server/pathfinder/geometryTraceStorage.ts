import fs from 'node:fs/promises';
import path from 'node:path';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { fittedTraceExportSchema, fittedTraceReferenceSchema, GEOMETRY_TRACE_LIMITS, type FittedTraceReference } from '../../shared/pathfinderGeometryTrace.js';
import { pathFinderRoot } from './storage.js';
import { storePreparationBytes } from './preparationStorage.js';
import { geometryTraceBytesHash } from './geometryTraceBuilder.js';
import { PathFinderError } from './errors.js';
import { parsePolicyJson } from './policyJson.js';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

const fail = (code = 'GEOMETRY_EXPORT_INTEGRITY', status = 409): never => { throw new PathFinderError(code, status); };
let exporting = false;
async function sync(directory: string) { const h = await fs.open(directory, 'r'); try { await h.sync(); } finally { await h.close(); } }
async function exportDirectory(): Promise<string> { const root = await pathFinderRoot(), directory = path.join(root, 'fitted-traces'); await fs.mkdir(directory, { mode: 0o700 }).catch(e => { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }); const stat = await fs.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== path.resolve(directory)) return fail(); await sync(root); return directory; }
async function admittedExport(exportId: string): Promise<boolean> {
  policyUuidSchema.parse(exportId); const directory = await exportDirectory(), entries = await fs.readdir(directory); let bytes = 0, existing = false;
  if (entries.length > GEOMETRY_TRACE_LIMITS.transientEntries) return fail('GEOMETRY_EXPORT_TRANSIENT_LIMIT', 413);
  for (const entry of entries) {
    const target = path.join(directory, entry), stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || await fs.realpath(target) !== path.resolve(target)) return fail();
    if (entry === 'quota.lock') { if (stat.size > 4096) return fail(); continue; }
    if (!/^[0-9a-f-]{36}\.(?:json|tmp)$(?![\s\S])/.test(entry) || !policyUuidSchema.safeParse(entry.slice(0, 36)).success || stat.size > GEOMETRY_TRACE_LIMITS.exportBytes) return fail();
    bytes += stat.size;
    if (entry === exportId + '.tmp') return fail('GEOMETRY_EXPORT_INCOMPLETE');
    if (entry === exportId + '.json') existing = true;
  }
  if (bytes + (existing ? 0 : GEOMETRY_TRACE_LIMITS.exportBytes) > GEOMETRY_TRACE_LIMITS.transientBytes) return fail('GEOMETRY_EXPORT_TRANSIENT_LIMIT', 413);
  return existing;
}
/** Cooperates with the engine's persistent cross-process quota lock; no overwrite or orphan deletion. */
export async function withFittedExportAllowance<T>(exportId: string, operation: (existing: boolean) => Promise<T>): Promise<T> {
  if (exporting) return fail('GEOMETRY_EXPORT_BUSY', 503); exporting = true;
  try { return await operation(await admittedExport(exportId)); } finally { exporting = false; }
}
export async function readFittedExport(exportId: string, expected?: FittedTraceReference) {
  policyUuidSchema.parse(exportId); const directory = await exportDirectory(), filename = path.join(directory, exportId + '.json'), stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > GEOMETRY_TRACE_LIMITS.exportBytes || await fs.realpath(filename) !== path.resolve(filename)) return fail();
  const bytes = await fs.readFile(filename); if (bytes.length !== stat.size) return fail();
  let parsed: unknown; try { parsed = parsePolicyJson(bytes, { maxBytes: GEOMETRY_TRACE_LIMITS.exportBytes }); } catch { return fail(); }
  const payload = fittedTraceExportSchema.parse(parsed), sha256 = geometryTraceBytesHash(bytes);
  if (payload.exportId !== exportId) return fail();
  const reference = fittedTraceReferenceSchema.parse({ schemaVersion: 'wfc.pf.fitted-trace-reference.v1', exportId, sha256, bytes: bytes.length, counts: payload.counts, engine: payload.engine, rulesSha256: payload.rulesSha256, snapshotSha256: payload.snapshotSha256, preparedKey: payload.preparedKey });
  if (expected && JSON.stringify(reference) !== JSON.stringify(fittedTraceReferenceSchema.parse(expected))) return fail();
  return { bytes, payload, reference };
}
export async function adoptFittedExport(projectId: string, sessionId: string, blobId: string, value: Awaited<ReturnType<typeof readFittedExport>>) {
  const blob = await storePreparationBytes(projectId, sessionId, blobId, value.bytes, GEOMETRY_TRACE_LIMITS.exportBytes);
  if (blob.sha256 !== value.reference.sha256 || blob.bytes !== value.reference.bytes) return fail(); return blob;
}
/** Only after adoption: remove the exact exclusive final export whose bytes were proved. */
export async function discardAdoptedFittedExport(value: Awaited<ReturnType<typeof readFittedExport>>): Promise<void> {
  const current = await readFittedExport(value.reference.exportId, value.reference);
  if (!current.bytes.equals(value.bytes)) return fail();
  const directory = await exportDirectory(); await fs.unlink(path.join(directory, value.reference.exportId + '.json')); await sync(directory);
}
/** Receipt-bound cleanup streams exact adopted bytes without parsing geometry on the HTTP loop. */
export async function discardAdoptedFittedExportReference(expected: FittedTraceReference): Promise<void> {
  fittedTraceReferenceSchema.parse(expected); const directory = await exportDirectory(), filename = path.join(directory, expected.exportId + '.json'), before = await fs.lstat(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size !== BigInt(expected.bytes) || await fs.realpath(filename) !== path.resolve(filename)) return fail();
  const digest = createHash('sha256'); let bytes = 0; for await (const chunk of createReadStream(filename)) { bytes += chunk.length; if (bytes > expected.bytes) return fail(); digest.update(chunk); }
  const after = await fs.lstat(filename, { bigint: true }); if (bytes !== expected.bytes || digest.digest('hex') !== expected.sha256 || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1n || after.size !== before.size || after.isSymbolicLink()) return fail();
  await fs.unlink(filename); await sync(directory);
}
