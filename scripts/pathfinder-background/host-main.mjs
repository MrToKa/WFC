import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, openWork, safePath, writePrivate, runCommand } from '../pathfinder-tray-catalog/guard-io.mjs';
import { assertProducerProfile } from './container-profile.mjs';
import { validateManagedIdentity } from './managed-runner.mjs';
import { createHostProofJournal } from './host-proof-journal.mjs';
import { runManagedHostWorker } from './host-worker.mjs';

export const HOST_MAIN_LIMITS = Object.freeze({ configurationBytes: 16384, seccompBytes: 512 * 1024, stopBytes: 4096, observations: 256, attempts: 256, workFiles: 8192, stopPollMilliseconds: 500 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$(?![\s\S])/;
const SHA = /^[a-f0-9]{64}$(?![\s\S])/;
const IMAGE = /^sha256:[a-f0-9]{64}$(?![\s\S])/;
const PROJECT = /^wfc-pathfinder-local-[a-f0-9]{12}$(?![\s\S])/;
const CONFIGURATION = 'managed-host-config.private.json', STOP = 'managed-host-stop.private.json';
const fail = code => Object.assign(new Error(code), { code });
const need = (condition, code) => { if (!condition) throw fail(code); };
const sha = raw => createHash('sha256').update(raw).digest('hex');
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && !descriptor.get && !descriptor.set;
});
const normalize = value => plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : Array.isArray(value) ? value.map(normalize) : value;
const canonical = value => JSON.stringify(normalize(value));
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.nlink, stat.mode, stat.uid, stat.gid, stat.mtimeNs, stat.ctimeNs].join(':');
const safeCode = error => typeof error?.code === 'string' && /^PRODUCER_[A-Z0-9_]{1,95}$(?![\s\S])/.test(error.code) ? error.code : 'PRODUCER_HOST_PERSISTENCE_OR_RUNTIME_FAILED';
const fatal = error => {
  const result = error && typeof error === 'object' ? error : fail('PRODUCER_HOST_PERSISTENCE_OR_RUNTIME_FAILED');
  if (!Object.hasOwn(result, 'fatalCleanup')) Object.defineProperty(result, 'fatalCleanup', { value: true, enumerable: false }); return result;
};

/** Configuration is deliberately a flat string-only object. Reject duplicate
 * keys before JSON.parse could hide a substituted credential or scope. */
function flatStringObject(raw, maximum, code) {
  need(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= maximum, code);
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw fail(code); }
  let offset = 0; const values = Object.create(null), keys = new Set();
  const whitespace = () => { while (/[ \t\r\n]/.test(text[offset] ?? 'x')) offset++; };
  const token = () => {
    whitespace(); const match = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[a-fA-F0-9]{4}))*"/.exec(text.slice(offset));
    need(match, code); offset += match[0].length; return JSON.parse(match[0]);
  };
  whitespace(); need(text[offset++] === '{', code); whitespace();
  while (text[offset] !== '}') {
    const key = token(); need(!keys.has(key), code); keys.add(key); whitespace();
    need(text[offset++] === ':', code); values[key] = token(); whitespace();
    if (text[offset] === '}') break; need(text[offset++] === ',', code); whitespace(); need(text[offset] !== '}', code);
  }
  need(text[offset++] === '}', code); whitespace(); need(offset === text.length, code); return { ...values };
}
export function parseManagedHostConfiguration(raw) {
  need(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= HOST_MAIN_LIMITS.configurationBytes, 'PRODUCER_HOST_CONFIGURATION_LIMIT');
  const result = flatStringObject(raw, HOST_MAIN_LIMITS.configurationBytes, 'PRODUCER_HOST_CONFIGURATION_INVALID'), expected = ['key', 'owner', 'project', 'image', 'runtimeInventorySha256', 'workPath', 'seccompSha256'];
  need(exact(result, expected) && Object.values(result).every(value => typeof value === 'string') && SHA.test(result.key) && UUID.test(result.owner) && PROJECT.test(result.project) &&
    IMAGE.test(result.image) && SHA.test(result.runtimeInventorySha256) && SHA.test(result.seccompSha256) && result.workPath.length > 0 && result.workPath.length <= 4096, 'PRODUCER_HOST_CONFIGURATION_INVALID');
  return Object.freeze(result);
}
export function parseHostMainArguments(argv) {
  need(Array.isArray(argv) && argv.length === 2 && argv[0] === '--configuration' && typeof argv[1] === 'string' && path.isAbsolute(argv[1]) && path.basename(argv[1]) === CONFIGURATION,
    'PRODUCER_HOST_ARGUMENTS_INVALID');
  return Object.freeze({ configurationPath: path.resolve(argv[1]) });
}
async function privateFileAcl(filename) {
  if (process.platform !== 'win32') return;
  const quoted = "'" + filename.replaceAll("'", "''") + "'";
  const code = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=[System.IO.File]::GetAccessControl(${quoted});$rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]);if(@($rules).Count -lt 1){throw 'ACL'};foreach($r in $rules){if($r.IdentityReference.Value -ne $sid.Value -or $r.AccessControlType -ne 'Allow'){throw 'ACL'}};'PRIVATE'`;
  const run = await runCommand('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')]);
  need(run.exitCode === 0 && !run.error && run.stderrBytes === 0 && run.stdout.toString().trim() === 'PRIVATE', 'PRODUCER_HOST_PRIVATE_ACL');
}
async function readBounded(filename, maximum, privateFile = true) {
  if (privateFile) await privateFileAcl(filename);
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && before.size > 0n && before.size <= BigInt(maximum), 'PRODUCER_HOST_PRIVATE_FILE_INVALID');
    if (privateFile && process.platform !== 'win32') need((before.mode & 0o077n) === 0n, 'PRODUCER_HOST_PRIVATE_ACL');
    const buffer = Buffer.alloc(maximum + 1); let size = 0;
    while (size < buffer.length) { const part = await handle.read(buffer, size, buffer.length - size, size); if (!part.bytesRead) break; size += part.bytesRead; }
    const after = await handle.stat({ bigint: true }), located = await fs.lstat(filename, { bigint: true });
    need(size <= maximum && BigInt(size) === before.size && !located.isSymbolicLink() && stamp(before) === stamp(after) && stamp(before) === stamp(located) && samePath(await fs.realpath(filename), path.resolve(filename)), 'PRODUCER_HOST_PRIVATE_FILE_CHANGED');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
export async function loadManagedHostConfiguration(configurationPath, { root = ROOT } = {}) {
  const args = parseHostMainArguments(['--configuration', configurationPath]), directory = path.dirname(args.configurationPath), work = await openWork(directory, { root });
  const raw = await readBounded(await safePath(work.directory, CONFIGURATION), HOST_MAIN_LIMITS.configurationBytes), configuration = parseManagedHostConfiguration(raw);
  const rebound = await openWork(configuration.workPath, { root }); need(samePath(rebound.directory, work.directory) && rebound.owner === work.owner, 'PRODUCER_HOST_CONFIGURATION_SCOPE');
  const seccompPath = await safePath(root, 'docker/pathfinder-producer/seccomp-default.json'), seccompBytes = await readBounded(seccompPath, HOST_MAIN_LIMITS.seccompBytes, false);
  need(sha(seccompBytes) === configuration.seccompSha256, 'PRODUCER_HOST_SECCOMP_INTEGRITY');
  return { configuration, work, configurationSha256: sha(raw), seccompBytes, seccompSha256: configuration.seccompSha256 };
}
const ownValue = (value, key) => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && !descriptor.get && !descriptor.set ? descriptor.value : undefined; };
export function sanitizeManagedHostObservation(value) {
  need(plain(value), 'PRODUCER_HOST_OBSERVATION_INVALID'); const type = ownValue(value, 'type');
  need(typeof type === 'string' && /^[a-z][a-z-]{0,31}$(?![\s\S])/.test(type), 'PRODUCER_HOST_OBSERVATION_INVALID');
  const result = { type };
  for (const key of ['attemptId', 'containerId']) { const item = ownValue(value, key); if (typeof item === 'string' && (key === 'attemptId' ? UUID : SHA).test(item)) result[key] = item; }
  const state = ownValue(value, 'state'); if (['idle', 'creating', 'starting', 'running', 'stopping', 'joined', 'quarantined'].includes(state)) result.state = state;
  for (const key of ['code', 'faultCode', 'quarantineCode']) { const item = ownValue(value, key); if (typeof item === 'string' && /^PRODUCER_[A-Z0-9_]{1,95}$(?![\s\S])/.test(item)) result[key] = item; }
  for (const key of ['exitCode', 'stderrBytes','resourceRequests','resourceBytes','resourceHandles']) { const item = ownValue(value, key); if (Number.isSafeInteger(item) && item >= 0 && item <= 2 ** 32) result[key] = item; }
  const removed = ownValue(value, 'removed'); if (typeof removed === 'boolean') result.removed = removed;
  return Object.freeze(result);
}
function recoveryProof(value) {
  need(exact(value, ['attemptId', 'proof']) && UUID.test(value.attemptId ?? '') && exact(value.proof, ['joined', 'removed', 'containerId']) &&
    value.proof.joined === true && value.proof.removed === true && SHA.test(value.proof.containerId ?? ''), 'PRODUCER_HOST_RECOVERY_PROOF_INVALID');
  return { attemptId: value.attemptId, proof: { joined: true, removed: true, containerId: value.proof.containerId } };
}

/** The CLI uses fixed production dependencies. Dependency seams exist for
 * isolated tests; no command-line evaluator, URL, image, key or script exists. */
export async function runManagedHostMain(argv, { root = ROOT, runWorker = runManagedHostWorker, createJournal = createHostProofJournal, listenForSignals = true } = {}) {
  const { configurationPath } = parseHostMainArguments(argv), loaded = await loadManagedHostConfiguration(configurationPath, { root });
  const { configuration, work, configurationSha256, seccompBytes, seccompSha256 } = loaded;
  const journal = await createJournal({ workPath: configuration.workPath, owner: configuration.owner, project: configuration.project, image: configuration.image, runtimeInventorySha256: configuration.runtimeInventorySha256 }, { root });
  const runId = randomUUID(), startedAt = new Date().toISOString(), controller = new AbortController(), attempts = new Map();
  const lifecycle = { schemaVersion: 'wfc.pf.managed-host-lifecycle.v1', runId, workOwner: work.owner, owner: configuration.owner, project: configuration.project, image: configuration.image,
    runtimeInventorySha256: configuration.runtimeInventorySha256, configurationSha256, pid: process.pid, startedAt };
  await writePrivate(work, `managed-host-${runId}-started`, lifecycle);
  let failure, stopReason = null, observationCount = 0, observationsDropped = 0, observationQueue = Promise.resolve(), workerResult;
  const abort = reason => { stopReason ??= reason; controller.abort(); };
  const refusePersistence = error => { failure ??= fatal(error); abort('persistence-failure'); };
  const checkStop = async () => {
    let filename; try { filename = await safePath(work.directory, STOP); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const raw = await readBounded(filename, HOST_MAIN_LIMITS.stopBytes), value = flatStringObject(raw, HOST_MAIN_LIMITS.stopBytes, 'PRODUCER_HOST_STOP_INVALID');
    need(exact(value, ['schemaVersion', 'owner', 'configurationSha256']) && value.schemaVersion === 'wfc.pf.managed-host-stop.v1' && value.owner === configuration.owner && value.configurationSha256 === configurationSha256, 'PRODUCER_HOST_STOP_INVALID');
    abort('private-stop-request');
  };
  const beforeStart = async input => {
    try {
      controller.signal.throwIfAborted(); await checkStop(); controller.signal.throwIfAborted();
      need(exact(input, ['attemptId', 'identity', 'profile']) && UUID.test(input.attemptId ?? ''), 'PRODUCER_HOST_INTENT_INVALID');
      const identity = validateManagedIdentity(input.identity); assertProducerProfile(input.profile); const profile = input.profile;
      need(profile.attemptId === input.attemptId && profile.owner === configuration.owner && profile.project === configuration.project && profile.image === configuration.image && profile.mode === 'run' && profile.seccomp.baselineSha256 === seccompSha256, 'PRODUCER_HOST_INTENT_SCOPE');
      const files = await fs.readdir(work.directory); need(files.length <= HOST_MAIN_LIMITS.workFiles && files.filter(name => /^managed-host-attempt-/.test(name)).length < HOST_MAIN_LIMITS.attempts, 'PRODUCER_HOST_INTENT_LIMIT');
      const intent = { schemaVersion: 'wfc.pf.managed-host-attempt-intent.v1', runId, workOwner: work.owner, owner: configuration.owner, project: configuration.project, image: configuration.image,
        runtimeInventorySha256: configuration.runtimeInventorySha256, configurationSha256, attemptId: input.attemptId, identity, recordedAt: new Date().toISOString(),
        profile: { schemaVersion: profile.schemaVersion, name: profile.name, mode: profile.mode, configurationSha256: sha(canonical(profile.config)), seccomp: profile.seccomp } };
      // An old intent may describe an unjoined helper from another daemon.
      // A failed exclusive write must retain that uncertainty in the final state.
      attempts.set(input.attemptId, { attemptId: input.attemptId, containerId: null, joined: false, removed: false });
      try { await writePrivate(work, `managed-host-attempt-${input.attemptId}`, intent); }
      catch (error) { if (error.code === 'CATALOG_IO_EXISTS' || error.code === 'EEXIST') throw fail('PRODUCER_HOST_RECOVERY_REQUIRED'); throw error; }
      controller.signal.throwIfAborted();
    } catch (error) { throw fatal(error); }
  };
  const observe = raw => {
    try {
      const event = sanitizeManagedHostObservation(raw), attempt = event.attemptId ? attempts.get(event.attemptId) : undefined;
      if (event.attemptId) need(attempt, 'PRODUCER_HOST_OBSERVATION_SCOPE');
      if (attempt) { if (event.containerId) { need(!attempt.containerId || attempt.containerId === event.containerId, 'PRODUCER_HOST_OBSERVATION_SCOPE'); attempt.containerId = event.containerId; }
        if (event.state === 'joined') attempt.joined = true; if (event.removed === true) attempt.removed = true; }
      if (observationCount >= HOST_MAIN_LIMITS.observations) { observationsDropped++; return; }
      const sequence = ++observationCount, record = { schemaVersion: 'wfc.pf.managed-host-observation.v1', runId, configurationSha256, sequence, observedAt: new Date().toISOString(), ...event };
      observationQueue = observationQueue.then(() => writePrivate(work, `managed-host-${runId}-observation-${String(sequence).padStart(3, '0')}`, record));
      void observationQueue.catch(refusePersistence);
    } catch (error) { refusePersistence(error); }
  };
  const signalHandler = signal => () => abort(signal);
  const interrupt = signalHandler('SIGINT'), terminate = signalHandler('SIGTERM');
  if (listenForSignals) { process.on('SIGINT', interrupt); process.on('SIGTERM', terminate); }
  let polling;
  try {
    await checkStop();
    polling = (async () => { while (!controller.signal.aborted) { try { await delay(HOST_MAIN_LIMITS.stopPollMilliseconds, undefined, { signal: controller.signal }); if (!controller.signal.aborted) await checkStop(); }
      catch (error) { if (!controller.signal.aborted) refusePersistence(error); } } })();
    if (!controller.signal.aborted) workerResult = await runWorker({ configuration, seccompBytes, seccompSha256, journal, beforeStart, signal: controller.signal, observe });
  } catch (error) {
    // A secondary cleanup failure can contain the only exact physical join
    // proof. Never replace or discard that carrier with an earlier log error.
    if (error?.recoveryProof) failure = error; else failure ??= error;
  }
  finally { abort(stopReason ?? 'worker-finished'); await polling; if (listenForSignals) { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); } }
  try { await observationQueue; } catch (error) { failure ??= error; }
  let preservedRecoveryProof = false;
  if (failure?.recoveryProof) {
    try {
      const proof = recoveryProof(failure.recoveryProof); await writePrivate(work, `managed-host-${runId}-recovery-proof`, { schemaVersion: 'wfc.pf.managed-host-recovery-proof.v1', runId,
        workOwner: work.owner, owner: configuration.owner, project: configuration.project, image: configuration.image, runtimeInventorySha256: configuration.runtimeInventorySha256, configurationSha256, ...proof });
      const attempt = attempts.get(proof.attemptId); if (attempt) { attempt.containerId = proof.proof.containerId; attempt.joined = true; attempt.removed = true; } preservedRecoveryProof = true;
    } catch (error) { Object.defineProperty(failure, 'recoveryPersistenceCode', { value: safeCode(error), enumerable: false }); }
  }
  let pendingProofs = null; try { pendingProofs = (await journal.list()).length; } catch (error) { failure ??= error; }
  const joined = [...attempts.values()].every(value => value.joined && value.removed) && pendingProofs === 0;
  const final = { ...lifecycle, finishedAt: new Date().toISOString(), state: joined ? 'joined' : 'quarantined', stopped: true, stopReason,
    operationErrorCode: failure ? safeCode(failure) : workerResult?.lastErrorCode ?? null, captureQualified: false,
    observationCount, observationsDropped, attempts: [...attempts.values()], pendingProofs, preservedRecoveryProof };
  try { await writePrivate(work, `managed-host-${runId}-final`, final); } catch (error) { failure ??= error; }
  if (failure) throw failure;
  return Object.freeze({ stopped: true, state: final.state, runId, configurationSha256, pendingProofs, operationErrorCode: final.operationErrorCode });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runManagedHostMain(process.argv.slice(2)).then(result => {
    process.stdout.write(JSON.stringify({ stopped: true, state: result.state, code: result.operationErrorCode }) + '\n');
  }).catch(error => { process.exitCode = 1; process.stdout.write(JSON.stringify({ stopped: true, state: 'quarantined', code: safeCode(error) }) + '\n'); });
}
