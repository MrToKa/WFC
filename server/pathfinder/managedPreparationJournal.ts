import fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { pathFinderRoot } from './storage.js';
import { canonicalPurposeJson, policyUuidSchema, policyHashSchema, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { calculationGrantLeaseClaimSchema } from './calculationGrantRepository.js';
import { calculationGrantAuthoritySchema } from './calculationAuthority.js';
import { managedPreparationCheckpointSchema } from './managedPreparationWorkflow.js';
import { PathFinderError } from './errors.js';

export const MANAGED_PREPARATION_JOURNAL_LIMITS = Object.freeze({ files: 4096, records: 128, recordBytes: 96 * 1024 ** 2, totalBytes: 1024 ** 3 });
const identitySchema = z.object({ instanceId: policyUuidSchema, projectId: policyUuidSchema, modelVersionId: policyUuidSchema, loadId: policyUuidSchema, sessionId: policyUuidSchema }).strict();
export const managedPreparationOwnerSchema = z.object({ schemaVersion: z.literal('wfc.pf.private-managed-preparation-owner.v1'), id: policyUuidSchema,
  revision: policyRevisionSchema, projectId: policyUuidSchema, sourceSha256: policyHashSchema, claim: calculationGrantLeaseClaimSchema,
  authority: calculationGrantAuthoritySchema.nullable(), identity: identitySchema.nullable(), attemptId: policyUuidSchema.nullable(),
  phase: z.enum(['claim-intent', 'claimed', 'session-intent', 'register-intent', 'running', 'joined', 'release-intent', 'released', 'blocked', 'quarantined']),
  joined: z.boolean(), resourceRevoked: z.boolean(), leaseReleased: z.boolean(), notified: z.boolean(),
  checkpoint: managedPreparationCheckpointSchema.nullable(), reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$(?![\s\S])/).nullable(),
}).strict().superRefine((value, context) => {
  if (value.claim.projectId !== value.projectId || value.claim.operation !== 'prepare' || value.authority &&
    Object.entries(value.claim).some(([key, field]) => (value.authority as unknown as Record<string, unknown>)[key] !== field) ||
    value.identity && (value.identity.projectId !== value.projectId || value.identity.modelVersionId !== value.claim.modelVersionId) ||
    value.checkpoint && value.checkpoint.projectId !== value.projectId || value.leaseReleased && (!value.authority || !value.joined || !value.resourceRevoked) ||
    value.notified && !value.leaseReleased)
    context.addIssue({ code: 'custom', message: 'Exact private ownership and confirmed cleanup must agree.' });
});
export type ManagedPreparationOwner = z.infer<typeof managedPreparationOwnerSchema>;
export interface ManagedPreparationJournal {
  list(): Promise<ManagedPreparationOwner[]>;
  save(previous: ManagedPreparationOwner | null, next: ManagedPreparationOwner): Promise<ManagedPreparationOwner>;
}
const fail = (code: string): never => { throw new PathFinderError(code, 503); };
const same = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
const privateOwner = (stat: Stats) => process.platform === 'win32' || (stat.mode & 0o077) === 0 &&
  (typeof process.getuid !== 'function' || stat.uid === process.getuid());

/** Append-only private revisions. Publication never replaces or deletes an
 * uncertain owner, checkpoint or previous revision. Callers serialize one writer. */
export function createManagedPreparationJournal(): ManagedPreparationJournal {
  const sync = async (directory: string) => { const handle = await fs.open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); } };
  const directory = async () => {
    const root = await pathFinderRoot(), dir = path.join(root, 'managed-preparation-recovery'); let created = false;
    try { await fs.mkdir(dir, { mode: 0o700 }); created = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !privateOwner(stat) || await fs.realpath(dir) !== path.resolve(dir)) return fail('MANAGED_PREPARATION_JOURNAL_PATH');
    if (created) await sync(root); return dir;
  };
  const scan = async (dir: string) => {
    const names: { name: string; id: string; revision: bigint }[] = []; let totalBytes = 0;
    const opened = await fs.opendir(dir);
    for await (const entry of opened) {
      const match = /^([a-f0-9-]{36})\.([0-9]{20})\.json$/.exec(entry.name);
      if (!match || !policyUuidSchema.safeParse(match[1]).success || names.length >= MANAGED_PREPARATION_JOURNAL_LIMITS.files || !entry.isFile() || entry.isSymbolicLink()) return fail('MANAGED_PREPARATION_JOURNAL_PATH');
      const stat = await fs.lstat(path.join(dir, entry.name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !privateOwner(stat) || stat.size > MANAGED_PREPARATION_JOURNAL_LIMITS.recordBytes) return fail('MANAGED_PREPARATION_JOURNAL_PATH');
      totalBytes += stat.size; if (totalBytes > MANAGED_PREPARATION_JOURNAL_LIMITS.totalBytes) return fail('MANAGED_PREPARATION_JOURNAL_LIMIT');
      names.push({ name: entry.name, id: match[1], revision: BigInt(match[2]) });
    }
    const heads = new Map<string, (typeof names)[number]>();
    for (const item of names) if (!heads.has(item.id) || heads.get(item.id)!.revision < item.revision) heads.set(item.id, item);
    if (heads.size > MANAGED_PREPARATION_JOURNAL_LIMITS.records) return fail('MANAGED_PREPARATION_JOURNAL_LIMIT');
    return { names, heads, totalBytes };
  };
  const read = async (dir: string, name: string) => {
    const filename = path.join(dir, name), before = await fs.lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !privateOwner(before) || before.size > MANAGED_PREPARATION_JOURNAL_LIMITS.recordBytes) return fail('MANAGED_PREPARATION_JOURNAL_PATH');
    const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.ino !== before.ino || stat.dev !== before.dev || !privateOwner(stat) || stat.size > MANAGED_PREPARATION_JOURNAL_LIMITS.recordBytes) return fail('MANAGED_PREPARATION_JOURNAL_PATH');
      const bytes = await handle.readFile(); if (bytes.length !== stat.size) return fail('MANAGED_PREPARATION_JOURNAL_INTEGRITY');
      let raw: unknown; try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('MANAGED_PREPARATION_JOURNAL_INVALID'); }
      const value = managedPreparationOwnerSchema.parse(raw);
      if (name !== `${value.id}.${value.revision.padStart(20, '0')}.json` || !bytes.equals(Buffer.from(canonicalPurposeJson(value)))) return fail('MANAGED_PREPARATION_JOURNAL_INTEGRITY');
      return { value, bytes };
    } finally { await handle.close(); }
  };
  return {
    async list() {
      const dir = await directory(), scanned = await scan(dir), values: ManagedPreparationOwner[] = [];
      for (const item of [...scanned.heads.values()].sort((a, b) => a.id.localeCompare(b.id))) values.push((await read(dir, item.name)).value);
      return values;
    },
    async save(previous, raw) {
      const next = managedPreparationOwnerSchema.parse(raw), dir = await directory(), scanned = await scan(dir), latest = scanned.heads.get(next.id);
      const bytes = Buffer.from(canonicalPurposeJson(next));
      if (bytes.length > MANAGED_PREPARATION_JOURNAL_LIMITS.recordBytes) return fail('MANAGED_PREPARATION_JOURNAL_LIMIT');
      if (latest) {
        const prior = (await read(dir, latest.name)).value;
        if (same(prior, next)) return prior;
        if (!previous || !same(prior, managedPreparationOwnerSchema.parse(previous))) return fail('MANAGED_PREPARATION_JOURNAL_CONFLICT');
      } else if (previous || next.revision !== '0') return fail('MANAGED_PREPARATION_JOURNAL_CONFLICT');
      if (previous && (next.revision !== (BigInt(previous.revision) + 1n).toString() || next.projectId !== previous.projectId || next.sourceSha256 !== previous.sourceSha256 ||
        !same(next.claim, previous.claim) || previous.authority && !same(next.authority, previous.authority) || previous.identity && !same(next.identity, previous.identity) ||
        previous.attemptId && next.attemptId !== previous.attemptId || previous.joined && !next.joined || previous.resourceRevoked && !next.resourceRevoked || previous.leaseReleased && !next.leaseReleased))
        return fail('MANAGED_PREPARATION_JOURNAL_CONFLICT');
      if (scanned.names.length >= MANAGED_PREPARATION_JOURNAL_LIMITS.files || scanned.totalBytes + bytes.length > MANAGED_PREPARATION_JOURNAL_LIMITS.totalBytes ||
        !latest && scanned.heads.size >= MANAGED_PREPARATION_JOURNAL_LIMITS.records) return fail('MANAGED_PREPARATION_JOURNAL_LIMIT');
      const filename = path.join(dir, `${next.id}.${next.revision.padStart(20, '0')}.json`); let handle;
      try { handle = await fs.open(filename, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (!(await read(dir, path.basename(filename))).bytes.equals(bytes)) return fail('MANAGED_PREPARATION_JOURNAL_CONFLICT'); }
      finally { await handle?.close(); }
      await sync(dir); return next;
    },
  };
}
