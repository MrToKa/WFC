import fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { pathFinderRoot } from './storage.js';
import type { GrantJobClaimRecovery } from './grantWorkerAuthority.js';
import { calculationGrantLeaseClaimSchema } from './calculationGrantRepository.js';
import { calculationGrantProvenanceSchema } from '../../shared/pathfinderCalculationGrant.js';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { PathFinderError } from './errors.js';

export const GRANT_WORKER_RECOVERY_LIMITS = Object.freeze({ entries: 4096, bytes: 16384 });
export type GrantWorkerRecoveryKey = { projectId: string; jobId: string };
export type GrantWorkerRecoveryAdapter = {
  read(key: GrantWorkerRecoveryKey): Promise<GrantJobClaimRecovery | null>;
  retain(value: GrantJobClaimRecovery): Promise<unknown>;
  retire(value: GrantJobClaimRecovery): Promise<void>;
};
const recordSchema = z.object({ schemaVersion: z.literal('wfc.pf.private-grant-claim-recovery.v1'),
  jobId: policyUuidSchema, projectId: policyUuidSchema, provenance: calculationGrantProvenanceSchema,
  claim: calculationGrantLeaseClaimSchema }).strict().refine(v =>
    v.claim.operation === 'calculate' && v.claim.projectId === v.projectId && v.provenance.projectId === v.projectId &&
    v.claim.grantId === v.provenance.grantId && v.claim.grantRevision === v.provenance.grantRevision &&
    v.claim.grantEpoch === v.provenance.grantEpoch && v.claim.installationEpoch === v.provenance.installationEpoch);
const fail = (code: string): never => { throw new PathFinderError(code, 503); };
const equal = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
function record(value: GrantJobClaimRecovery) {
  const parsed = recordSchema.safeParse({ schemaVersion: 'wfc.pf.private-grant-claim-recovery.v1', ...value });
  if (!parsed.success) return fail('CALCULATION_GRANT_RECOVERY_INVALID');
  return parsed.data;
}
function privateOwner(stat: Stats): boolean {
  return process.platform === 'win32' || (stat.mode & 0o077) === 0 &&
    (typeof process.getuid !== 'function' || stat.uid === process.getuid());
}
async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
async function directory(): Promise<string> {
  const root = await pathFinderRoot(), directory = path.join(root, 'grant-claim-recovery');
  let created = false;
  try { await fs.mkdir(directory, { mode: 0o700 }); created = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !privateOwner(stat) || await fs.realpath(directory) !== path.resolve(directory))
    return fail('CALCULATION_GRANT_RECOVERY_PATH');
  if (created) await syncDirectory(root);
  return directory;
}
async function entries(directory: string): Promise<string[]> {
  const handle = await fs.opendir(directory), names: string[] = [];
  // opendir, rather than unbounded readdir, also bounds a malformed/full private directory.
  for await (const entry of handle) {
    if (names.length >= GRANT_WORKER_RECOVERY_LIMITS.entries) return fail('CALCULATION_GRANT_RECOVERY_LIMIT');
    names.push(entry.name);
  }
  return names;
}
function key(value: GrantWorkerRecoveryKey): GrantWorkerRecoveryKey {
  return { projectId: policyUuidSchema.parse(value.projectId), jobId: policyUuidSchema.parse(value.jobId) };
}
async function readFile(filename: string): Promise<{ value: GrantJobClaimRecovery; bytes: Buffer; stat: Stats }> {
  const before = await fs.lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > GRANT_WORKER_RECOVERY_LIMITS.bytes || !privateOwner(before))
    return fail('CALCULATION_GRANT_RECOVERY_PATH');
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev ||
      opened.size > GRANT_WORKER_RECOVERY_LIMITS.bytes || !privateOwner(opened)) return fail('CALCULATION_GRANT_RECOVERY_PATH');
    const bytes = await handle.readFile();
    if (bytes.length > GRANT_WORKER_RECOVERY_LIMITS.bytes) return fail('CALCULATION_GRANT_RECOVERY_LIMIT');
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { return fail('CALCULATION_GRANT_RECOVERY_INVALID'); }
    const parsed = recordSchema.safeParse(raw);
    if (!parsed.success || !bytes.equals(Buffer.from(canonicalPurposeJson(parsed.data)))) return fail('CALCULATION_GRANT_RECOVERY_INVALID');
    const { schemaVersion: _version, ...value } = parsed.data;
    const frozen = Object.freeze({ ...value, provenance: Object.freeze({ ...value.provenance }), claim: Object.freeze({ ...value.claim }) });
    return { value: frozen, bytes, stat: opened };
  } finally { await handle.close(); }
}
async function locate(directory: string, raw: GrantWorkerRecoveryKey) {
  const selected = key(raw), names = await entries(directory);
  const canonical = selected.projectId + '-' + selected.jobId + '.json';
  // Read the original job/lease filename as well; do not strand an earlier private unknown-ACK intent.
  const candidates = names.filter(name => name === canonical ||
    name.startsWith(selected.jobId + '-') && /^[a-f0-9-]+\.json$/.test(name));
  let result: Awaited<ReturnType<typeof readFile>> & { filename: string } | undefined;
  for (const name of candidates) {
    const filename = path.join(directory, name), loaded = await readFile(filename);
    if (loaded.value.projectId !== selected.projectId || loaded.value.jobId !== selected.jobId)
      return fail('CALCULATION_GRANT_RECOVERY_CONFLICT');
    if (result) return fail('CALCULATION_GRANT_RECOVERY_CONFLICT');
    result = { ...loaded, filename };
  }
  return { result, count: names.length, filename: path.join(directory, canonical) };
}

/** A prior intent is never interpreted as proof that its engine process joined. */
export async function readGrantWorkerRecovery(raw: GrantWorkerRecoveryKey): Promise<GrantJobClaimRecovery | null> {
  return (await locate(await directory(), raw)).result?.value ?? null;
}
/** Persist and sync the exact private owner before the corresponding database claim is attempted. */
export async function retainGrantWorkerRecovery(value: GrantJobClaimRecovery): Promise<{ sha256: string; leaseId: string }> {
  const parsed = record(value), dir = await directory(), found = await locate(dir, parsed);
  const bytes = Buffer.from(canonicalPurposeJson(parsed));
  if (bytes.length > GRANT_WORKER_RECOVERY_LIMITS.bytes) return fail('CALCULATION_GRANT_RECOVERY_LIMIT');
  if (found.result) {
    if (!found.result.bytes.equals(bytes)) return fail('CALCULATION_GRANT_RECOVERY_CONFLICT');
  } else {
    if (found.count >= GRANT_WORKER_RECOVERY_LIMITS.entries) return fail('CALCULATION_GRANT_RECOVERY_LIMIT');
    let handle;
    try { handle = await fs.open(found.filename, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await readFile(found.filename)).bytes.equals(bytes)) return fail('CALCULATION_GRANT_RECOVERY_CONFLICT');
    } finally { await handle?.close(); }
    await syncDirectory(dir);
  }
  return { sha256: createHash('sha256').update(bytes).digest('hex'), leaseId: parsed.claim.leaseId };
}
/** Call only after a confirmed release or a serialized exact lookup proved that no claim exists. */
export async function retireGrantWorkerRecovery(value: GrantJobClaimRecovery): Promise<void> {
  const parsed = record(value), dir = await directory(), found = await locate(dir, parsed);
  if (!found.result) return;
  if (!equal(record(found.result.value), parsed)) return fail('CALCULATION_GRANT_RECOVERY_CONFLICT');
  const current = await fs.lstat(found.result.filename);
  if (!current.isFile() || current.isSymbolicLink() || current.ino !== found.result.stat.ino || current.dev !== found.result.stat.dev || current.nlink !== 1)
    return fail('CALCULATION_GRANT_RECOVERY_CONFLICT');
  await fs.unlink(found.result.filename); await syncDirectory(dir);
}
export const grantWorkerRecoveryAdapter: GrantWorkerRecoveryAdapter = {
  read: readGrantWorkerRecovery, retain: retainGrantWorkerRecovery, retire: retireGrantWorkerRecovery,
};
