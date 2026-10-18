import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ROOT, contained } from '../pathfinder-local/runtime-lib.mjs';
import { assertCanonicalPath } from '../operations/archives.mjs';
import { bind, SOURCE } from './binding.mjs';
import { LIMITS, PINS, digest, need, safeCode, makeOwner, resourcePin, validateCapsule, executeAuth, boundedRequest } from './auth-lib.mjs';

const relative = value => path.relative(ROOT, value).replaceAll('\\', '/');
const scratch = path.join(ROOT, 'pathfinder-engine/.scratch');
const sourceSnapshot = { path: 'pathfinder-engine/.scratch/current-inputs-2b20a8ae-a435-4d4d-aec4-005bb021a715/current-inputs.private.json', sha256: '0a84d1327950d4bd1d8420661f526cf1c97fdec5dbaaca71c429bf3e0c3bd897' };
async function read(file, limit = LIMITS.fileBytes) {
  await assertCanonicalPath(file); const before = await fs.stat(file);
  need(before.size > 0 && before.size <= limit, 'AUTH_FILE_BOUND');
  const bytes = await fs.readFile(file); const after = await fs.stat(file);
  need(bytes.length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs, 'AUTH_FILE_CHANGED'); return bytes;
}
async function durable(file, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); need(bytes.length <= LIMITS.fileBytes, 'AUTH_OUTPUT_BOUND');
  await assertCanonicalPath(path.dirname(file), { directory: true });
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  need(digest(await read(file)) === digest(bytes), 'AUTH_OUTPUT_READBACK');
  return { path: relative(file), bytes: bytes.length, sha256: digest(bytes) };
}
function resolveRelative(value, base, code) {
  need(typeof value === 'string' && value.length < 1024 && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every(p => p && p !== '.' && p !== '..'), code);
  const file = path.resolve(ROOT, value); need(contained(base, file) && file !== base, code); return file;
}
export async function main(argv = process.argv.slice(2)) {
  let receipt, output, append, work, marker, binding, capsuleRef = null;
  const controller = new AbortController(), interrupt = () => controller.abort(); process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(LIMITS.totalMilliseconds)]);
  try {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { work: { type: 'string' }, output: { type: 'string' }, capsule: { type: 'string' }, 'capsule-sha256': { type: 'string' }, runtime: { type: 'string' }, owner: { type: 'string' }, 'backup-id': { type: 'string' } } });
    const mode = positionals[0]; need(positionals.length === 1 && ['prepare-source', 'check-source', 'check-target'].includes(mode), 'AUTH_ARGUMENTS');
    output = resolveRelative(values.output, path.join(ROOT, 'docs/pathfinder/evidence/copied-recovery'), 'AUTH_OUTPUT_PATH');
    await assertCanonicalPath(path.dirname(output), { directory: true });
    await fs.access(output).then(() => need(false, 'AUTH_OUTPUT_EXISTS'), error => { if (error.code !== 'ENOENT') throw error; });
    work = resolveRelative(values.work, scratch, 'AUTH_WORK_PATH');
    need(path.dirname(work) === scratch && /^copied-recovery-auth-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(path.basename(work)), 'AUTH_WORK_PATH');
    await assertCanonicalPath(scratch, { directory: true }); await fs.mkdir(work, { mode: 0o700 });
    if (process.platform === 'win32') await promisify(execFile)('icacls', [work, '/inheritance:r', '/grant:r', process.env.USERDOMAIN + '\\' + process.env.USERNAME + ':(OI)(CI)(F)'], { windowsHide: true, timeout: 5000, maxBuffer: 8192, signal });
    marker = { schemaVersion: 'pathfinder.copied-recovery.auth-owner.v1', owner: makeOwner(), mode, createdAt: new Date().toISOString(), work: relative(work) };
    await durable(path.join(work, 'owner.private.json'), marker);
    const records = []; let previousSha256 = digest(marker), journalBytes = 0;
    append = async (type, value) => {
      need(records.length < LIMITS.journalEvents, 'AUTH_JOURNAL_BOUND');
      const entry = { schemaVersion: 'pathfinder.copied-recovery.auth-event.v1', sequence: records.length, previousSha256, type, recordedAt: new Date().toISOString(), value };
      const size = Buffer.byteLength(JSON.stringify(entry, null, 2) + '\n'); need(journalBytes + size <= LIMITS.journalBytes, 'AUTH_JOURNAL_BOUND');
      const ref = await durable(path.join(work, 'event-' + String(records.length).padStart(4, '0') + '.private.json'), entry); records.push(ref); previousSha256 = ref.sha256; journalBytes += ref.bytes;
    };
    receipt = { schemaVersion: 'pathfinder.copied-recovery.auth-receipt.v1', status: 'FAIL', mode, owner: marker.owner, work: relative(work), projectId: PINS.projectId, modelVersionId: PINS.modelVersionId, sourceFiles: await sourceHashes(), startedAt: marker.createdAt };
    let capsule;
    if (mode !== 'prepare-source') {
      const file = resolveRelative(values.capsule, scratch, 'AUTH_CAPSULE_PATH');
      need(path.basename(file) === 'capsule.private.json' && /^copied-recovery-auth-[a-f0-9-]{36}$/.test(path.basename(path.dirname(file))) && path.dirname(path.dirname(file)) === scratch && /^[a-f0-9]{64}$/.test(values['capsule-sha256'] ?? ''), 'AUTH_CAPSULE_PATH');
      const bytes = await read(file); need(digest(bytes) === values['capsule-sha256'], 'AUTH_CAPSULE_HASH'); capsule = validateCapsule(JSON.parse(bytes));
      const savedOwner = JSON.parse(await read(path.join(path.dirname(file), 'owner.private.json')));
      need(savedOwner.owner === capsule.owner && savedOwner.mode === 'prepare-source' && savedOwner.work === relative(path.dirname(file)), 'AUTH_CAPSULE_OWNER');
      need(capsule.source.owner === SOURCE.owner && capsule.source.project === SOURCE.project && capsule.source.runtime === path.resolve(ROOT, SOURCE.runtime), 'AUTH_CAPSULE_SOURCE');
      capsuleRef = { path: relative(file), bytes: bytes.length, sha256: digest(bytes) };
    } else need(!values.capsule && !values['capsule-sha256'], 'AUTH_ARGUMENTS');
    if (mode === 'check-target') need(values.runtime && values.owner && values['backup-id'], 'AUTH_TARGET_ARGUMENTS');
    else need(!values.runtime && !values.owner && !values['backup-id'], 'AUTH_SOURCE_ARGUMENTS');
    const bindingOptions = { runtime: mode === 'check-target' ? values.runtime : SOURCE.runtime, owner: mode === 'check-target' ? values.owner : SOURCE.owner, kind: mode === 'check-target' ? 'target' : 'source', backupId: values['backup-id'], signal };
    binding = await bind(bindingOptions);
    let resourceProvenance;
    if (mode === 'prepare-source') {
      const bytes = await read(path.join(ROOT, sourceSnapshot.path)); need(digest(bytes) === sourceSnapshot.sha256, 'AUTH_MANIFEST_HASH');
      resourceProvenance = { ...sourceSnapshot, bytes: bytes.length, resource: resourcePin(JSON.parse(bytes)) };
    }
    await append('binding', { runtime: relative(binding.state.runtime), owner: binding.state.owner, project: binding.state.project, origin: binding.origin, resources: binding.resources });
    const checkpoints = {};
    const result = await executeAuth({ mode, binding, capsule, resourceProvenance, io: {
      signal, owner: marker.owner, now: Date.now, uuid: makeOwner, append, request: boundedRequest, guard: () => bind(bindingOptions), runtimeRelative: relative(binding.state.runtime),
      checkpoint: async (name, value) => { checkpoints[name] = await durable(path.join(work, name + '.private.json'), value); },
      credentials: async () => {
        const value = JSON.parse(await read(path.join(binding.state.runtime, 'demo.private.json'), 8192));
        need(typeof value.email === 'string' && typeof value.password === 'string' && Object.keys(value).sort().join() === 'email,password' && value.email.length < 500 && value.password.length < 1000, 'AUTH_GENERATED_CREDENTIALS'); return value;
      }
    } });
    delete result.capsule;
    await append('completed', { mode, status: 'PASS', at: new Date().toISOString() });
    Object.assign(receipt, result, { work: relative(work), capsule: checkpoints.capsule ?? capsuleRef, allowedAuth: checkpoints['allowed-auth'] ?? null, checkpoints, journal: { events: records.length, bytes: journalBytes, finalSha256: previousSha256, recordsSha256: digest(records) } });
    need(!signal.aborted, 'AUTH_CANCELLED_OR_DEADLINE');
  } catch (error) {
    if (!receipt) receipt = { schemaVersion: 'pathfinder.copied-recovery.auth-receipt.v1', status: 'FAIL', startedAt: new Date().toISOString(), work: work ? relative(work) : null };
    receipt.status = 'FAIL'; receipt.error = safeCode(error); receipt.capsule = capsuleRef;
    if (append) try { await append('failed', { code: receipt.error, at: new Date().toISOString() }); } catch { receipt.journalFailure = true; }
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
  receipt.finishedAt = new Date().toISOString();
  if (output) { try { await durable(output, receipt); } catch { process.stdout.write(JSON.stringify({ schemaVersion: receipt.schemaVersion, status: 'FAIL', error: 'AUTH_RECEIPT_PERSISTENCE', work: receipt.work }) + '\n'); return 2; } }
  process.stdout.write(JSON.stringify(receipt) + '\n'); return receipt.status === 'PASS' ? 0 : 2;
}
async function sourceHashes() { return Promise.all(['auth.mjs', 'auth-lib.mjs', 'auth-lib.test.mjs', 'README-auth.md', 'binding.mjs'].map(async name => { const file = path.join(ROOT, 'scripts/pathfinder-copied-recovery', name); const bytes = await read(file); return { path: relative(file), sha256: digest(bytes), bytes: bytes.length }; })); }
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
