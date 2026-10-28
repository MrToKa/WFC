/** Explicit local-operator bounds. No scope means the legacy Docker API is used.
 * API container creates in this scope are temporary helpers, not app services.
 * Source running-state recovery belongs to the caller outside an expired scope.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const storage = new AsyncLocalStorage(), proofs = new WeakMap();
const SCOPE = 'wfc.operations.bound.scope', NONCE = 'wfc.operations.bound.helper';
const ID = /^[a-f0-9]{64}$/, NAME = /^[a-z0-9][a-z0-9_.-]{0,120}$/;
const MiB = 1024 ** 2, GiB = 1024 ** 3, JOIN = 10_000, MAX_HELPERS = 64;
export class DockerBoundsError extends Error { constructor(code, options) { super(code, options); this.name = 'DockerBoundsError'; this.code = code; } }
const error = code => new DockerBoundsError(code);
export function isDockerBoundsError(value) { return value instanceof DockerBoundsError; }
function policyFor(raw) {
  const ranges = { operationTimeoutMs: [1, 14_400_000], commandTimeoutMs: [1, 3_600_000], requestTimeoutMs: [1, 3_600_000], helperTimeoutMs: [1, 3_600_000], helperMemoryBytes: [16 * MiB, 4 * GiB], pidsLimit: [1, 4096], nanoCpus: [1_000_000, 8_000_000_000], tmpBytes: [MiB, GiB], archiveOutputBytes: [1, 32 * GiB] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) || Object.keys(raw).some(key => !Object.hasOwn(ranges, key) && key !== 'observe' && key !== 'archiveOwnership')) throw error('DOCKER_BOUNDS_POLICY_INVALID');
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) if (!Number.isSafeInteger(raw[key]) || raw[key] < minimum || raw[key] > maximum) throw error('DOCKER_BOUNDS_POLICY_INVALID');
  if (['commandTimeoutMs', 'requestTimeoutMs', 'helperTimeoutMs'].some(key => raw[key] > raw.operationTimeoutMs) || raw.observe !== undefined && typeof raw.observe !== 'function' || raw.archiveOwnership !== undefined && raw.archiveOwnership !== 'preserve-posix') throw error('DOCKER_BOUNDS_POLICY_INVALID');
  return Object.freeze({ ...raw });
}
const remaining = state => Math.max(0, state.deadline - performance.now());
function observe(state, type, facts = {}) {
  try { state.policy.observe?.(Object.freeze({ type, scopeNonce: state.nonce, elapsedMilliseconds: performance.now() - state.started, ...facts })); } catch { /* A trusted observer cannot change operation or cleanup outcomes. */ }
}
function abort(state, reason) { if (!state.controller.signal.aborted) { state.reason = reason; state.controller.abort(reason); } }
function current() {
  const state = storage.getStore();
  if (!state) return null;
  if (remaining(state) <= 0) abort(state, error('DOCKER_OPERATION_TIMEOUT'));
  if (state.closing || state.controller.signal.aborted || remaining(state) <= 0 || state.remoteExecUnknown || state.unknownDockerMutation || !state.commandsJoined) throw state.reason ?? error('DOCKER_SCOPE_CLOSED');
  return state;
}
export function hasBoundedDockerExecution() { return storage.getStore() !== undefined; }
/** Immutable internal proof, not caller-supplied error metadata. */
export function getBoundedDockerCleanup(cause) { return cause && (typeof cause === 'object' || typeof cause === 'function') ? proofs.get(cause) ?? null : null; }
async function joinedWithin(promise, milliseconds = JOIN) {
  let timer;
  try { return await Promise.race([promise.then(value => ({ joined: true, value }), cause => ({ joined: true, cause })), new Promise(resolve => { timer = setTimeout(() => resolve({ joined: false }), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function retain(state, promise) { state.pending.add(promise); void promise.finally(() => state.pending.delete(promise)).catch(() => undefined); return promise; }

function witnessedExec(args) {
  if (args[0] !== 'exec' && !(args[0] === 'container' && args[1] === 'exec')) return null;
  let at = args[0] === 'container' ? 2 : 1;
  while (at < args.length && args[at].startsWith('-')) {
    const option = args[at++];
    if (option === '--') break;
    if (['-i', '--interactive'].includes(option)) continue;
    if (['-u', '--user', '-w', '--workdir', '-e', '--env'].includes(option)) { if (at >= args.length) throw error('DOCKER_EXEC_COMMAND_INVALID'); at++; continue; }
    if (/^--(?:user|workdir|env)=.+/.test(option)) continue;
    throw error('DOCKER_EXEC_COMMAND_INVALID');
  }
  if (!ID.test(args[at] ?? '') || at + 1 >= args.length) throw error('DOCKER_EXEC_COMMAND_INVALID');
  const command = args[at + 1], argumentsOnly = args.slice(at + 2);
  if (!['pg_dump', 'pg_restore', 'pg_isready', 'psql'].includes(command) || command === 'pg_restore' && argumentsOnly.some(value => value === '-j' || value.startsWith('-j') || value === '--jobs' || value.startsWith('--jobs='))) throw error('DOCKER_EXEC_COMMAND_INVALID');
  const nonce = randomUUID(), marker = 'WFC_BOUND_EXEC_' + nonce;
  // Only our random nonce enters shell source. Every command/path/SQL/value stays
  // positional. The fixed PostgreSQL child receives the original stdin/stdout.
  const script = '"$@"; wfc_code=$?; printf "\\n' + marker + ':%s\\n" "$wfc_code" >&2; exit "$wfc_code"';
  return { args: [...args.slice(0, at + 1), '/bin/sh', '-c', script, 'wfc-bounded-exec', command, ...argumentsOnly], marker };
}
function validWitness(bytes, witness, code, signal, interrupted) {
  if (!witness || interrupted || signal !== null || !Number.isInteger(code) || code < 0 || code > 255) return false;
  const marker = Buffer.from('\n' + witness.marker + ':'), at = bytes.indexOf(marker);
  if (at < 0 || bytes.indexOf(marker, at + 1) >= 0) return false;
  return bytes.subarray(at + marker.length).equals(Buffer.from(String(code) + '\n'));
}

export async function withBoundedDockerExecution(raw, operation) {
  const policy = policyFor(raw);
  if (typeof operation !== 'function' || storage.getStore()) throw error('DOCKER_BOUNDS_SCOPE_INVALID');
  const started = performance.now(), state = { policy, nonce: randomUUID(), started, deadline: started + policy.operationTimeoutMs, controller: new AbortController(), reason: null, closing: false, helpers: [], pending: new Set(), operationJoined: false, commandsJoined: true, remoteExecUnknown: false, unknownDockerMutation: false };
  return await storage.run(state, async () => {
    observe(state, 'scope-start');
    const timer = setTimeout(() => abort(state, error('DOCKER_OPERATION_TIMEOUT')), policy.operationTimeoutMs);
    let value, primary, failed = false;
    const operationResult = Promise.resolve().then(operation).then(result => { state.operationJoined = true; return { ok: true, value: result }; }, cause => { state.operationJoined = true; return { ok: false, cause }; });
    const interrupted = new Promise(resolve => state.controller.signal.addEventListener('abort', () => resolve({ interrupted: true }), { once: true }));
    try {
      const outcome = await Promise.race([operationResult, interrupted]);
      if (outcome.interrupted) { const joined = await joinedWithin(operationResult); if (joined.joined) state.operationJoined = true; failed = true; primary = state.reason; }
      else if (!outcome.ok) { failed = true; primary = outcome.cause; }
      else value = outcome.value;
    } finally {
      state.closing = true;
      // A callback must await its transports. Returning with live work is not a
      // successful operation; cancellation/join still precedes helper cleanup.
      if (state.pending.size) abort(state, state.reason ?? error('DOCKER_SCOPE_WORK_UNJOINED'));
      const transports = await joinedWithin(Promise.allSettled([...state.pending]));
      if (!transports.joined) state.commandsJoined = false;
    }
    const cleanupFailures = [];
    const cleanupDeadline = performance.now() + Math.min(600_000, Math.max(JOIN, state.helpers.length * (Math.min(policy.requestTimeoutMs, 10_000) * 6 + 10_000)));
    for (const helper of state.helpers) try { await cleanupHelper(state, helper, cleanupDeadline); } catch (cause) { cleanupFailures.push(cause); }
    for (const helper of state.helpers) clearTimeout(helper.timer);
    clearTimeout(timer);
    if (remaining(state) <= 0) abort(state, error('DOCKER_OPERATION_TIMEOUT'));
    if (!failed && state.controller.signal.aborted) { failed = true; primary = state.reason; }
    const proof = Object.freeze({ status: cleanupFailures.length || !state.operationJoined || !state.commandsJoined || state.remoteExecUnknown || state.unknownDockerMutation ? 'UNCONFIRMED' : 'PASS', scopeNonce: state.nonce, operationJoined: state.operationJoined, commandsJoined: state.commandsJoined, helpersRemoved: state.helpers.every(helper => helper.removed), remoteExecUnknown: state.remoteExecUnknown, unknownDockerMutation: state.unknownDockerMutation });
    observe(state, 'scope-cleanup', { status: proof.status, operationJoined: proof.operationJoined, commandsJoined: proof.commandsJoined, helpersRemoved: proof.helpersRemoved, remoteExecUnknown: proof.remoteExecUnknown, unknownDockerMutation: proof.unknownDockerMutation });
    if (proof.status !== 'PASS') {
      const cause = new DockerBoundsError('DOCKER_SCOPE_CLEANUP_UNCONFIRMED', { cause: new AggregateError([...(failed ? [primary] : []), ...cleanupFailures], 'Bounded Docker work is not positively joined and removed.') });
      proofs.set(cause, proof); throw cause;
    }
    if (failed) { const cause = primary && (typeof primary === 'object' || typeof primary === 'function') ? primary : new DockerBoundsError('DOCKER_OPERATION_FAILED', { cause: primary }); proofs.set(cause, proof); throw cause; }
    observe(state, 'scope-success'); return value;
  });
}

/** Fixed-code test seam accepts synthetic process/stream dependencies. */
export async function boundedDockerCommand(args, options = {}, dependencies = {}) {
  const state = current(); if (!state) throw error('DOCKER_BOUNDS_SCOPE_REQUIRED');
  if (options.signal?.aborted) throw error('OPERATIONS_INTERRUPTED');
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string' || value.length > 65536) || Buffer.byteLength(JSON.stringify(args)) > 2 * MiB) throw error('DOCKER_COMMAND_INVALID');
  if (['run', 'create'].includes(args[0]) || args[0] === 'container' && ['run', 'create'].includes(args[1])) throw error('DOCKER_UNTRACKED_HELPER_CREATE');
  args = [...args]; options = { ...options };
  if (args[0] === 'save') args = ['image', 'save', ...args.slice(1)];
  // Docker --output would write outside the bounded stdout pipeline. Preserve
  // exact image-save bytes through our fresh-file stream instead.
  if (args[0] === 'image' && args[1] === 'save' && args.some(value => value === '--output' || value.startsWith('--output=') || value.startsWith('-o'))) {
    if (args.length !== 5 || !['--output', '-o'].includes(args[2]) || options.output !== undefined || !ID.test(args[4].replace(/^sha256:/, ''))) throw error('DOCKER_ARCHIVE_COMMAND_INVALID');
    options.output = args[3]; args = ['image', 'save', args[4]];
  }
  const witness = witnessedExec(args); if (witness) args = witness.args;
  const readonlyCli = witness || ['inspect', 'ps', 'logs', 'version', 'info'].includes(args[0]) || args[0] === 'context' && ['inspect', 'show'].includes(args[1]) || ['image', 'volume', 'network'].includes(args[0]) && ['inspect', 'ls', 'save'].includes(args[1]);
  const maximum = options.output ? Math.min(state.policy.archiveOutputBytes, options.maxBytes ?? state.policy.archiveOutputBytes) : options.maxBytes ?? 16 * MiB;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > (options.output ? 32 * GiB : 32 * MiB)) throw error('DOCKER_OUTPUT_LIMIT_INVALID');
  const spawnProcess = dependencies.spawn ?? spawn, read = dependencies.createReadStream ?? createReadStream, write = dependencies.createWriteStream ?? createWriteStream;
  let child; try { child = spawnProcess('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { throw error('DOCKER_UNAVAILABLE'); }
  const controller = new AbortController(), chunks = [], stderrChunks = []; let stdoutBytes = 0, stderrBytes = 0, stopped = null, exitCode = null, exitSignal = null, closed = false;
  let resolveClose; const close = new Promise(resolve => { resolveClose = resolve; });
  const stop = cause => { if (stopped) return; stopped = cause; controller.abort(cause); try { child.kill(); } catch { /* Positive close below remains mandatory. */ } };
  child.once('error', () => stop(error('DOCKER_UNAVAILABLE')));
  child.once('close', (code, signal) => { closed = true; exitCode = code; exitSignal = signal; resolveClose(); });
  child.stderr.on('data', bytes => { stderrBytes += bytes.length; if (stderrBytes > 65536) stop(error('DOCKER_STDERR_LIMIT')); else stderrChunks.push(Buffer.from(bytes)); });
  child.stderr.on('error', () => stop(error('DOCKER_STDERR_FAILED')));
  child.stdin.on('error', () => stop(error('DOCKER_INPUT_FAILED')));
  const scopedAbort = () => stop(state.reason ?? error('DOCKER_OPERATION_TIMEOUT')), callerAbort = () => stop(error('OPERATIONS_INTERRUPTED'));
  state.controller.signal.addEventListener('abort', scopedAbort, { once: true }); options.signal?.addEventListener('abort', callerAbort, { once: true });
  const commandDeadline = performance.now() + Math.min(state.policy.commandTimeoutMs, Math.max(1, remaining(state)));
  const timer = setTimeout(() => stop(error('DOCKER_COMMAND_TIMEOUT')), Math.max(1, commandDeadline - performance.now()));
  const count = limit => new Transform({ transform(bytes, _encoding, callback) { stdoutBytes += bytes.length; callback(stdoutBytes > limit ? error('DOCKER_OUTPUT_LIMIT') : null, bytes); } });
  let reader = Promise.resolve(), writer = Promise.resolve();
  let inputBytes = 0;
  const inputCounter = new Transform({ transform(bytes, _encoding, callback) { inputBytes += bytes.length; callback(inputBytes > state.policy.archiveOutputBytes ? error('DOCKER_INPUT_LIMIT') : null, bytes); } });
  try {
    const sink = options.output ? write(options.output, { flags: 'wx', mode: 0o600 }) : new Writable({ write(bytes, _encoding, callback) { chunks.push(Buffer.from(bytes)); callback(); } });
    reader = pipeline(child.stdout, count(maximum), sink, { signal: controller.signal }).catch(cause => { stop(cause instanceof DockerBoundsError ? cause : error('DOCKER_OUTPUT_FAILED')); throw cause; });
    writer = options.input ? pipeline(typeof options.input === 'string' ? read(options.input) : options.input, inputCounter, child.stdin, { signal: controller.signal }).catch(cause => { stop(cause instanceof DockerBoundsError ? cause : error('DOCKER_INPUT_FAILED')); throw cause; }) : Promise.resolve(child.stdin.end());
  } catch (cause) { stop(error('DOCKER_COMMAND_IO_FAILED')); reader = Promise.reject(cause); }
  if (state.controller.signal.aborted) scopedAbort(); if (options.signal?.aborted) callerAbort();
  observe(state, 'command-start');
  const task = (async () => {
    try {
      // An absolute timer interrupts streams and the child; close is checked
      // separately so killing a local CLI is never mistaken for a joined child.
      const finished = stopped ? false : await Promise.race([close.then(() => true), new Promise(resolve => controller.signal.addEventListener('abort', () => resolve(false), { once: true }))]);
      if (!finished && !(await joinedWithin(close)).joined) { state.commandsJoined = false; throw error('DOCKER_CHILD_JOIN_UNCONFIRMED'); }
      const io = await joinedWithin(Promise.allSettled([reader, writer]));
      if (!io.joined) { state.commandsJoined = false; throw error('DOCKER_CHILD_JOIN_UNCONFIRMED'); }
      if (performance.now() >= commandDeadline) stop(error('DOCKER_COMMAND_TIMEOUT'));
      if (stopped) throw stopped;
      const rejected = io.value.find(item => item.status === 'rejected'); if (rejected) throw rejected.reason;
      if (witness && !validWitness(Buffer.concat(stderrChunks), witness, exitCode, exitSignal, false)) throw error('DOCKER_REMOTE_EXEC_OUTCOME_UNKNOWN');
      if (exitCode !== 0 || exitSignal !== null) throw error('DOCKER_COMMAND_FAILED');
      return Buffer.concat(chunks);
    } catch (cause) {
      if (witness && Number.isInteger(child.pid) && child.pid > 0 && !validWitness(Buffer.concat(stderrChunks), witness, exitCode, exitSignal, Boolean(stopped))) state.remoteExecUnknown = true;
      if (!readonlyCli && Number.isInteger(child.pid) && child.pid > 0) state.unknownDockerMutation = true;
      if (!closed) state.commandsJoined = false;
      if (stopped || state.remoteExecUnknown || state.unknownDockerMutation || !state.commandsJoined) abort(state, cause);
      throw cause;
    } finally { clearTimeout(timer); state.controller.signal.removeEventListener('abort', scopedAbort); options.signal?.removeEventListener('abort', callerAbort); observe(state, 'command-joined', { joined: closed, exitCode, signal: exitSignal, stdoutBytes, stderrBytes }); }
  })();
  // Stream failures are observed immediately even if close is delayed.
  void reader.catch(() => undefined); void writer.catch(() => undefined);
  return await retain(state, task);
}

/** Absolute HTTP deadline covers connect, headers and the entire response body.
 * Used directly for cleanup, without the expired AsyncLocalStorage signal.
 */
async function rawRequest(socketPath, method, route, body, { timeoutMs, signal, allowAbsent = false, request = http.request } = {}) {
  const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  if (encoded && encoded.length > 32 * MiB) throw error('DOCKER_REQUEST_INPUT_LIMIT');
  const deadline = performance.now() + timeoutMs;
  let req, timer, resolveClose, settled = false, response, requestDestroyed = false;
  const destroyRequest = () => { if (req && !requestDestroyed) { requestDestroyed = true; req.destroy(); } };
  const closed = new Promise(resolve => { resolveClose = resolve; });
  const result = new Promise((resolve, reject) => {
    const finish = (cause, value) => { if (settled) return; settled = true; cause ? reject(cause) : resolve(value); };
    const interrupt = code => { const cause = error(code); finish(cause); destroyRequest(); };
    timer = setTimeout(() => interrupt('DOCKER_REQUEST_TIMEOUT'), timeoutMs);
    const abortRequest = () => interrupt('DOCKER_OPERATION_TIMEOUT');
    signal?.addEventListener('abort', abortRequest, { once: true });
    try {
      req = request({ socketPath, path: '/v1.47' + route, method, headers: encoded ? { 'Content-Type': 'application/json', 'Content-Length': encoded.length } : {} }, res => {
        response = res; const chunks = []; let size = 0;
        res.on('data', bytes => { size += bytes.length; if (size > 32 * MiB) interrupt('DOCKER_OUTPUT_LIMIT'); else chunks.push(bytes); });
        res.once('error', () => finish(error('DOCKER_REQUEST_FAILED'))); res.once('aborted', () => finish(error('DOCKER_REQUEST_FAILED')));
        res.once('end', () => {
          if (allowAbsent && res.statusCode === 404) return finish(null, { absent: true });
          if (res.statusCode < 200 || res.statusCode >= 300) { const cause = error('DOCKER_REQUEST_FAILED'); cause.statusCode = res.statusCode; cause.definitive = true; return finish(cause); }
          const bytes = Buffer.concat(chunks); if (!bytes.length) return finish(null, null);
          try { finish(null, JSON.parse(bytes.toString('utf8'))); } catch { finish(error('DOCKER_RESPONSE_INVALID')); }
        });
      });
      req.once('error', () => finish(error('DOCKER_REQUEST_FAILED')));
      req.once('close', () => { signal?.removeEventListener('abort', abortRequest); resolveClose(); });
      req.end(encoded); if (signal?.aborted) abortRequest();
    } catch {
      finish(error('DOCKER_REQUEST_FAILED'));
      if (req) destroyRequest();
      else { signal?.removeEventListener('abort', abortRequest); resolveClose(); }
    }
  });
  let value, primary;
  try { value = await result; } catch (cause) { primary = cause; destroyRequest(); response?.destroy(); }
  clearTimeout(timer);
  if (!(await joinedWithin(closed)).joined) throw new DockerBoundsError('DOCKER_REQUEST_JOIN_UNCONFIRMED', { cause: primary });
  if (!primary && performance.now() >= deadline) primary = error('DOCKER_REQUEST_TIMEOUT');
  if (primary) throw primary; return value;
}

function archiveCapabilities(state, config) {
  if (state.policy.archiveOwnership !== 'preserve-posix') return [];
  const cmd = config.Cmd;
  const archiveScript = Array.isArray(cmd) && cmd[0] === 'node' && cmd[1] === 'scripts/operations/archives.mjs';
  const inventoryScript = Array.isArray(cmd) && cmd[0] === 'node' && cmd[1] === 'scripts/pathfinder-local/container-ops.mjs';
  if (!archiveScript && !inventoryScript) return [];
  const h = config.HostConfig ?? {}, mounts = h.Mounts;
  const roleFile = value => typeof value === 'string' && /^\/backup\/(?:minio|staging|pathfinder)\.wfcops$(?![\s\S])/.test(value);
  const exactMounts = wanted => Array.isArray(mounts) && mounts.length === wanted.length && wanted.every(([target, type, readOnly]) => mounts.filter(mount => mount.Target === target && mount.Type === type && mount.ReadOnly === readOnly && typeof mount.Source === 'string' && mount.Source.length > 0).length === 1);
  if (!['0', '0:0'].includes(config.User) || config.Entrypoint !== undefined && (!Array.isArray(config.Entrypoint) || config.Entrypoint.length) || h.NetworkMode !== 'none' || h.Binds?.length || h.VolumesFrom?.length || h.Devices?.length || h.DeviceRequests?.length) throw error('DOCKER_ARCHIVE_CAPABILITY_SCOPE');
  if (inventoryScript) {
    if (cmd.length === 4 && cmd[2] === 'inventory' && cmd[3] === '/source' && exactMounts([['/source', 'volume', true]])) return ['DAC_OVERRIDE'];
    throw error('DOCKER_ARCHIVE_CAPABILITY_SCOPE');
  }
  if (cmd[2] === 'capture' && cmd.length === 5 && cmd[3] === '/source' && roleFile(cmd[4]) && exactMounts([['/source', 'volume', true], ['/backup', 'bind', false]])) return ['DAC_OVERRIDE'];
  if (cmd[2] === 'restore' && cmd.length === 6 && roleFile(cmd[3]) && cmd[4] === '/target' && /^[a-f0-9]{64}$(?![\s\S])/.test(cmd[5]) && exactMounts([['/backup', 'bind', true], ['/target', 'volume', false]])) return ['CHOWN', 'FOWNER', 'DAC_OVERRIDE'];
  if (cmd[2] === 'measure' && cmd.length === 4 && cmd[3] === '/source' && exactMounts([['/source', 'volume', true]])) return ['DAC_OVERRIDE'];
  if (cmd[2] === 'verify' && cmd.length === 5 && roleFile(cmd[3]) && /^[a-f0-9]{64}$(?![\s\S])/.test(cmd[4]) && exactMounts([['/backup', 'bind', true]])) return [];
  throw error('DOCKER_ARCHIVE_CAPABILITY_SCOPE');
}
function helperConfig(state, route, raw, request) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || state.helpers.length >= MAX_HELPERS) throw error('DOCKER_HELPER_CONFIG_INVALID');
  const url = new URL(route, 'http://docker'), nonce = randomUUID(), name = url.searchParams.get('name') ?? 'wfc-bounded-' + nonce;
  if (!NAME.test(name) || typeof raw.Image !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(raw.Image)) throw error('DOCKER_HELPER_CONFIG_INVALID');
  url.searchParams.set('name', name);
  const config = JSON.parse(JSON.stringify(raw)), h = config.HostConfig ?? {}, capabilities = archiveCapabilities(state, config);
  for (const key of ['CpuPeriod', 'CpuQuota', 'CpusetCpus', 'CpusetMems', 'CpuShares', 'MemoryReservation', 'KernelMemory', 'MemorySwappiness']) delete h[key];
  config.Labels = { ...config.Labels, [SCOPE]: state.nonce, [NONCE]: nonce };
  config.HostConfig = { ...h, Memory: state.policy.helperMemoryBytes, MemorySwap: state.policy.helperMemoryBytes, NanoCpus: state.policy.nanoCpus, PidsLimit: state.policy.pidsLimit,
    ReadonlyRootfs: true, CapAdd: capabilities, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], Privileged: false, AutoRemove: false, RestartPolicy: { Name: 'no' },
    Tmpfs: { '/tmp': `rw,noexec,nosuid,nodev,size=${state.policy.tmpBytes},mode=1777` } };
  const record = { nonce, name, image: config.Image, config, socketPath: null, request, id: null, acknowledged: false, definitiveFailure: false, removed: false, timer: null, deadline: null, cleaning: null };
  state.helpers.push(record); observe(state, 'helper-intent', { helperNonce: nonce });
  return { record, config, route: url.pathname + url.search };
}
function assertOwned(state, helper, actual) {
  if (!actual || !ID.test(actual.Id ?? '') || helper.id && actual.Id !== helper.id || actual.Name !== '/' + helper.name || actual.Image !== helper.image || actual.Config?.Labels?.[SCOPE] !== state.nonce || actual.Config?.Labels?.[NONCE] !== helper.nonce) throw error('DOCKER_HELPER_OWNERSHIP_LOST');
  const capabilities = actual.HostConfig?.CapAdd ?? [];
  if (actual.HostConfig?.Memory !== state.policy.helperMemoryBytes || actual.HostConfig?.MemorySwap !== state.policy.helperMemoryBytes || actual.HostConfig?.NanoCpus !== state.policy.nanoCpus || actual.HostConfig?.PidsLimit !== state.policy.pidsLimit || actual.HostConfig?.ReadonlyRootfs !== true || actual.HostConfig?.Privileged !== false || !actual.HostConfig?.CapDrop?.includes('ALL') || !Array.isArray(capabilities) || JSON.stringify([...capabilities].sort()) !== JSON.stringify([...helper.config.HostConfig.CapAdd].sort()) || !actual.HostConfig?.SecurityOpt?.includes('no-new-privileges:true') || actual.HostConfig?.Tmpfs?.['/tmp'] !== helper.config.HostConfig.Tmpfs['/tmp']) throw error('DOCKER_HELPER_POLICY_CHANGED');
}
async function cleanupHelper(state, helper, deadline = performance.now() + 60_000) {
  if (helper.removed) return;
  if (helper.cleaning) return await helper.cleaning;
  const work = (async () => {
    const request = async (method, route, body, extra = {}) => {
      const left = deadline - performance.now(); if (left <= 0) throw error('DOCKER_HELPER_CLEANUP_TIMEOUT');
      return await rawRequest(helper.socketPath, method, route, body, { timeoutMs: Math.max(1, Math.min(10_000, state.policy.requestTimeoutMs, left)), request: helper.request, ...extra });
    };
    if (helper.definitiveFailure) { helper.removed = true; return; }
    if (!helper.id) {
      const candidates = await request('GET', '/containers/json?all=1&filters=' + encodeURIComponent(JSON.stringify({ label: [`${SCOPE}=${state.nonce}`, `${NONCE}=${helper.nonce}`] })));
      // An empty list after a lost POST response is not proof that a queued create
      // cannot complete later. Keep its unresolved intent and refuse safe resume.
      if (!Array.isArray(candidates) || candidates.length !== 1 || !ID.test(candidates[0].Id ?? '')) throw error('DOCKER_HELPER_CREATE_OUTCOME_UNKNOWN');
      helper.id = candidates[0].Id;
    }
    const route = '/containers/' + helper.id + '/json';
    let actual = await request('GET', route, undefined, { allowAbsent: true });
    if (actual?.absent) { if (!helper.acknowledged) throw error('DOCKER_HELPER_CREATE_OUTCOME_UNKNOWN'); helper.removed = true; return; }
    assertOwned(state, helper, actual);
    if (actual.State?.Running || actual.State?.Pid !== 0) {
      await request('POST', '/containers/' + helper.id + '/stop?t=5');
      actual = await request('GET', route); assertOwned(state, helper, actual);
    }
    if (actual.State?.Running !== false || actual.State?.Pid !== 0) throw error('DOCKER_HELPER_JOIN_UNCONFIRMED');
    observe(state, 'helper-stopped', { helperNonce: helper.nonce, containerId: helper.id });
    await request('DELETE', '/containers/' + helper.id + '?v=false');
    const gone = await request('GET', route, undefined, { allowAbsent: true }); if (!gone?.absent) throw error('DOCKER_HELPER_REMOVE_UNCONFIRMED');
    helper.removed = true; clearTimeout(helper.timer); observe(state, 'helper-removed', { helperNonce: helper.nonce, containerId: helper.id });
  })();
  helper.cleaning = work;
  try { await work; } finally { helper.cleaning = null; }
}
export async function cleanupBoundedDockerHelper(id) {
  const state = storage.getStore(); if (!state) throw error('DOCKER_BOUNDS_SCOPE_REQUIRED');
  const helper = state.helpers.find(value => value.id === id); if (!helper) throw error('DOCKER_HELPER_OWNERSHIP_LOST');
  return await cleanupHelper(state, helper);
}

export async function boundedDockerRequest(socketPath, method, route, body, options = {}, dependencies = {}) {
  const state = current(); if (!state) throw error('DOCKER_BOUNDS_SCOPE_REQUIRED');
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)) throw error('DOCKER_REQUEST_TIMEOUT_INVALID');
  const request = dependencies.request ?? http.request;
  if (method === 'DELETE') { const match = /^\/containers\/([a-f0-9]{64})\?v=false$/.exec(route), helper = match && state.helpers.find(value => value.id === match[1]); if (helper) return await cleanupHelper(state, helper); }
  let create;
  if (method === 'POST' && /^\/containers\/create(?:\?|$)/.test(route)) { create = helperConfig(state, route, body, request); create.record.socketPath = socketPath; route = create.route; body = create.config; }
  const target = /^\/containers\/([a-f0-9]{64})\/(start|wait)(?:\?|$)/.exec(route), helper = target && state.helpers.find(value => value.id === target[1]);
  if (helper && target[2] === 'start') {
    if (helper.deadline !== null) throw error('DOCKER_HELPER_RESTART_REFUSED');
    helper.deadline = performance.now() + state.policy.helperTimeoutMs;
    helper.timer = setTimeout(() => abort(state, error('DOCKER_HELPER_TIMEOUT')), state.policy.helperTimeoutMs);
  }
  if (helper && target[2] === 'wait') {
    const task = (async () => {
      for (;;) {
        current(); if (helper.deadline === null || performance.now() >= helper.deadline) { abort(state, error('DOCKER_HELPER_TIMEOUT')); throw state.reason; }
        const actual = await rawRequest(socketPath, 'GET', '/containers/' + helper.id + '/json', undefined, { timeoutMs: Math.max(1, Math.min(state.policy.requestTimeoutMs, remaining(state), helper.deadline - performance.now())), signal: state.controller.signal, request });
        assertOwned(state, helper, actual);
        if (actual.State?.Running === false && actual.State?.Pid === 0) { if (!Number.isInteger(actual.State.ExitCode) || actual.State.OOMKilled) throw error('DOCKER_HELPER_FAILED'); clearTimeout(helper.timer); return { StatusCode: actual.State.ExitCode }; }
        await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(1, helper.deadline - performance.now()))));
      }
    })().catch(cause => { if (cause.code === 'DOCKER_REQUEST_JOIN_UNCONFIRMED') state.commandsJoined = false; abort(state, cause); throw cause; });
    return await retain(state, task);
  }
  const task = (async () => {
    try {
      const value = await rawRequest(socketPath, method, route, body, { timeoutMs: Math.max(1, Math.min(state.policy.requestTimeoutMs, options.timeoutMs ?? state.policy.requestTimeoutMs, remaining(state))), signal: state.controller.signal, request });
      if (create) { if (!ID.test(value?.Id ?? '')) throw error('DOCKER_RESPONSE_INVALID'); create.record.id = value.Id; create.record.acknowledged = true; observe(state, 'helper-created', { helperNonce: create.record.nonce, containerId: value.Id }); }
      return value;
    } catch (cause) {
      if (cause.code === 'DOCKER_REQUEST_JOIN_UNCONFIRMED') state.commandsJoined = false;
      const containerId = /^\/containers\/([a-f0-9]{64})(?:\/|\?|$)/.exec(route)?.[1], ownedControl = containerId && state.helpers.some(value => value.id === containerId);
      if (!['GET', 'HEAD'].includes(method) && !create && !ownedControl && (!cause.definitive || cause.statusCode >= 500)) state.unknownDockerMutation = true;
      if (create && cause.definitive && cause.statusCode === 409) create.record.definitiveFailure = true;
      if (!cause.definitive || create && !create.record.definitiveFailure || state.unknownDockerMutation) abort(state, cause);
      throw cause;
    }
  })();
  return await retain(state, task);
}
