import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import childProcess from 'node:child_process';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { withBoundedDockerExecution, getBoundedDockerCleanup, hasBoundedDockerExecution, boundedDockerCommand, boundedDockerRequest } from './docker-bounds.mjs';
import { command, createDocker } from './docker.mjs';

const IMAGE = 'sha256:' + 'a'.repeat(64), ID = 'b'.repeat(64), SOCKET = '/synthetic-docker.sock';
const policy = extra => ({ operationTimeoutMs: 2000, commandTimeoutMs: 1000, requestTimeoutMs: 100, helperTimeoutMs: 1000, helperMemoryBytes: 64 * 1024 ** 2, pidsLimit: 32, nanoCpus: 1_000_000_000, tmpBytes: 1024 ** 2, archiveOutputBytes: 32 * 1024 ** 2, ...extra });
const code = expected => cause => cause?.code === expected;
async function failure(operation) { try { await operation(); assert.fail('Expected refusal.'); } catch (cause) { return cause; } }
function processFixture({ bytes = Buffer.from('synthetic'), exitCode = 0, witness = 'valid', hang = false, closeOnKill = true, afterMarker, spawnFailure = false, stderrFailure = false } = {}) {
  const observed = { calls: [], killed: 0, input: Buffer.alloc(0), outputs: [] };
  const spawn = (_program, args, options) => {
    observed.calls.push({ args, options });
    const child = new EventEmitter(); child.pid = spawnFailure ? undefined : 12345;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const inputs = []; child.stdin.on('data', chunk => inputs.push(Buffer.from(chunk)));
    let closed = false;
    const close = (status, signal) => { if (closed) return; closed = true; child.stdout.end(); child.stderr.end(); child.emit('exit', status, signal); child.emit('close', status, signal); };
    child.kill = () => { observed.killed++; if (closeOnKill) queueMicrotask(() => close(null, 'SIGTERM')); return true; };
    child.stdin.once('finish', () => {
      observed.input = Buffer.concat(inputs);
      if (hang) return;
      setImmediate(() => {
        if (spawnFailure) { child.emit('error', Error('synthetic spawn failure')); close(-2, null); return; }
        if (closed) return;
        if (stderrFailure) { child.stderr.emit('error', Error('synthetic stderr pipe failure')); return; }
        child.stdout.write(bytes);
        const marker = args.find(value => value.includes('WFC_BOUND_EXEC_'))?.match(/WFC_BOUND_EXEC_[a-f0-9-]+/)?.[0];
        if (marker && witness !== 'absent') {
          const value = '\n' + (witness === 'wrong' ? 'WFC_BOUND_EXEC_wrong' : marker) + ':' + (witness === 'mismatch' ? exitCode + 1 : exitCode) + '\n';
          child.stderr.write(witness === 'truncated' ? value.slice(0, -1) : witness === 'duplicate' ? value + value : witness === 'extra-newline' ? value + '\n' : witness === 'high-bit' ? Buffer.from(value).map((byte, at, bytes) => at === bytes.length - 2 ? byte | 128 : byte) : value);
        }
        if (afterMarker) { afterMarker(); return; }
        child.stdout.end(); child.stderr.end(); setImmediate(() => close(exitCode, null));
      });
    });
    return child;
  };
  return { observed, spawn, write(filename, options) { observed.outputs.push({ filename, options, chunks: [] }); const output = observed.outputs.at(-1); return new Writable({ write(bytes, _encoding, done) { output.chunks.push(Buffer.from(bytes)); done(); } }); } };
}

function daemonFixture({ lostCreate = false, emptyLostCreate = false, failStop = false, changeNonce = false, bodyNeverEnds = false, neverExits = false, failDelete = false, holdControl = false, endThrows = false, destroyCloseDelay = 0 } = {}) {
  const data = { containers: new Map(), calls: [], body: null, stops: 0, removals: 0, waits: 0, destroyCalls: 0, requestCloses: 0 };
  const request = (options, callback) => {
    const req = new EventEmitter(); let closed = false, destroyed = false, response;
    const close = () => { if (!closed) { closed = true; data.requestCloses++; req.emit('close'); } };
    req.destroy = () => { data.destroyCalls++; if (destroyed || closed) return; destroyed = true; queueMicrotask(() => { req.emit('error', Error('synthetic transport close')); if (destroyCloseDelay) setTimeout(close, destroyCloseDelay); else close(); }); };
    req.end = encoded => {
      if (endThrows) throw Error('synthetic synchronous end failure');
      setImmediate(() => {
      if (closed) return;
      const url = new URL(options.path.replace('/v1.47', ''), 'http://docker');
      const body = encoded ? JSON.parse(encoded.toString()) : undefined;
      data.calls.push({ method: options.method, route: url.pathname, query: url.search, body });
      const respond = (status, value, held = false) => {
        response = new EventEmitter(); response.statusCode = status; response.destroy = () => { response.emit('aborted'); };
        callback(response); queueMicrotask(() => { if (closed) return; if (value !== undefined) response.emit('data', Buffer.from(JSON.stringify(value))); if (!held) { response.emit('end'); close(); } });
      };
      if (url.pathname === '/containers/create') {
        data.body = body;
        if (!emptyLostCreate) data.containers.set(ID, { Id: ID, Name: '/' + url.searchParams.get('name'), Image: body.Image, Config: { Labels: { ...body.Labels } }, HostConfig: structuredClone(body.HostConfig), State: { Running: false, Pid: 0, ExitCode: 0, OOMKilled: false } });
        if (lostCreate || emptyLostCreate) return;
        return respond(201, { Id: ID });
      }
      if (url.pathname === '/containers/json') {
        const filters = JSON.parse(url.searchParams.get('filters')), candidates = [...data.containers.values()].filter(container => filters.label.every(item => { const at = item.indexOf('='); return container.Config.Labels[item.slice(0, at)] === item.slice(at + 1); }));
        return respond(200, candidates.map(container => ({ Id: container.Id })));
      }
      if (holdControl && /\/containers\/[a-f0-9]{64}\/(?:start|stop)$/.test(url.pathname)) return respond(200, { status: 'PASS' }, true);
      const match = /^\/containers\/([a-f0-9]{64})(?:\/(json|start|stop|wait))?$/.exec(url.pathname);
      if (match) {
        const container = data.containers.get(match[1]); if (!container) return respond(404, { message: 'synthetic absent' });
        if (match[2] === 'json') {
          if (changeNonce) container.Config.Labels['wfc.operations.bound.helper'] = 'foreign';
          if (container.State.Running && !neverExits && ++data.waits >= 2) { container.State.Running = false; container.State.Pid = 0; }
          return respond(200, container);
        }
        if (match[2] === 'start') { container.State.Running = true; container.State.Pid = 321; return respond(204); }
        if (match[2] === 'stop') { data.stops++; if (failStop) return respond(500, { message: 'synthetic stop failure' }); container.State.Running = false; container.State.Pid = 0; return respond(204); }
        if (options.method === 'DELETE') { data.removals++; if (failDelete) return respond(500, { message: 'synthetic delete failure' }); assert.equal(container.State.Running, false); assert.equal(container.State.Pid, 0); assert.equal(url.searchParams.get('force'), null); data.containers.delete(match[1]); return respond(204); }
      }
      return respond(200, { status: 'PASS' }, bodyNeverEnds);
      });
    };
    return req;
  };
  return { data, request, async create() { return await boundedDockerRequest(SOCKET, 'POST', '/containers/create?name=synthetic-owned', { Image: IMAGE, Labels: { private: 'PRIVATE_VALUE' }, HostConfig: { ReadonlyRootfs: false, Memory: 999, Privileged: true, CapAdd: ['SYS_ADMIN'] } }, {}, { request }); } };
}

test('bounds are opt-in and legacy command/create retain their original options', async t => {
  const originalSpawn = childProcess.spawn, originalRequest = http.request, proc = processFixture({ bytes: Buffer.from('unix://' + SOCKET) }), daemon = daemonFixture();
  t.mock.method(childProcess, 'spawn', proc.spawn); t.mock.method(http, 'request', daemon.request); syncBuiltinESMExports();
  try {
    assert.equal(hasBoundedDockerExecution(), false); assert.equal((await command(['context', 'inspect'])).toString(), 'unix://' + SOCKET);
    const docker = await createDocker(); await docker.create('synthetic-legacy', { Image: IMAGE, HostConfig: { ReadonlyRootfs: false } });
    assert.equal(daemon.data.body.HostConfig.ReadonlyRootfs, false); assert.equal(daemon.data.body.Labels?.['wfc.operations.bound.scope'], undefined);
    assert.equal(await withBoundedDockerExecution(policy(), async () => { assert.equal(hasBoundedDockerExecution(), true); return 42; }), 42); assert.equal(hasBoundedDockerExecution(), false);
  } finally { childProcess.spawn = originalSpawn; http.request = originalRequest; syncBuiltinESMExports(); }
});
for (const invalid of [{ unknown: 1 }, { operationTimeoutMs: Infinity }, { commandTimeoutMs: 0 }, { helperMemoryBytes: -1 }, { pidsLimit: 1.5 }, { nanoCpus: 0 }, { tmpBytes: 0 }, { archiveOutputBytes: 33 * 1024 ** 3 }, { requestTimeoutMs: 3000 }, { observe: 'not a callback' }, { archiveOwnership: true }, { toString: 1 }]) test('strict numeric policy refuses ' + Object.keys(invalid)[0], async () => { let called = false; await assert.rejects(withBoundedDockerExecution(policy(invalid), () => { called = true; }), code('DOCKER_BOUNDS_POLICY_INVALID')); assert.equal(called, false); });
test('observer failures do not change outcomes and forged cleanup metadata is rejected', async () => { assert.equal(await withBoundedDockerExecution(policy({ observe() { throw Error('observer'); } }), async () => 'okay'), 'okay'); assert.equal(getBoundedDockerCleanup(Object.assign(Error('forged'), { status: 'PASS' })), null); });
test('nested scope cannot escape ownership tracking', async () => { await assert.rejects(withBoundedDockerExecution(policy(), () => withBoundedDockerExecution(policy(), async () => undefined)), code('DOCKER_BOUNDS_SCOPE_INVALID')); });
test('manual API helper gets fixed security/resources and is positively removed at scope exit', async () => {
  const daemon = daemonFixture(), events = [];
  await withBoundedDockerExecution(policy({ observe: value => events.push(value) }), async () => { const created = await daemon.create(); assert.equal(created.Id, ID); });
  const host = daemon.data.body.HostConfig; assert.equal(host.Memory, 64 * 1024 ** 2); assert.equal(host.MemorySwap, host.Memory); assert.equal(host.NanoCpus, 1_000_000_000); assert.equal(host.PidsLimit, 32); assert.equal(host.ReadonlyRootfs, true); assert.equal(host.Privileged, false); assert.deepEqual(host.CapAdd, []); assert.deepEqual(host.CapDrop, ['ALL']); assert.deepEqual(host.SecurityOpt, ['no-new-privileges:true']); assert.match(host.Tmpfs['/tmp'], /size=1048576/);
  assert.equal(daemon.data.containers.size, 0); assert.equal(daemon.data.removals, 1); assert.equal(events.at(-2).status, 'PASS'); assert.equal(JSON.stringify(events).includes('PRIVATE_VALUE'), false);
});
test('tracked helper wait polls metadata until the same helper terminates', async () => {
  const daemon = daemonFixture();
  await withBoundedDockerExecution(policy(), async () => { const created = await daemon.create(); await boundedDockerRequest(SOCKET, 'POST', '/containers/' + created.Id + '/start', undefined, {}, daemon); const exited = await boundedDockerRequest(SOCKET, 'POST', '/containers/' + created.Id + '/wait?condition=not-running', undefined, {}, daemon); assert.equal(exited.StatusCode, 0); });
  assert.equal(daemon.data.calls.some(call => call.route.endsWith('/wait')), false); assert.equal(daemon.data.containers.size, 0);
});
test('one-shot tracked helper cannot restart after terminal wait cleared its original timer', async () => {
  const daemon = daemonFixture();
  await withBoundedDockerExecution(policy(), async () => {
    await daemon.create(); await boundedDockerRequest(SOCKET, 'POST', '/containers/' + ID + '/start', undefined, {}, daemon);
    await boundedDockerRequest(SOCKET, 'POST', '/containers/' + ID + '/wait', undefined, {}, daemon);
    await assert.rejects(boundedDockerRequest(SOCKET, 'POST', '/containers/' + ID + '/start', undefined, {}, daemon), code('DOCKER_HELPER_RESTART_REFUSED'));
    assert.equal(daemon.data.calls.filter(call => call.route.endsWith('/start')).length, 1); assert.equal(daemon.data.containers.get(ID).State.Running, false);
  });
  assert.equal(daemon.data.containers.size, 0);
});
test('helper deadline cannot be renewed by wait and cleanup positively stops it', async () => {
  const daemon = daemonFixture({ neverExits: true });
  const cause = await failure(() => withBoundedDockerExecution(policy({ helperTimeoutMs: 15 }), async () => { await daemon.create(); await boundedDockerRequest(SOCKET, 'POST', '/containers/' + ID + '/start', undefined, {}, daemon); await boundedDockerRequest(SOCKET, 'POST', '/containers/' + ID + '/wait', undefined, {}, daemon); }));
  assert.equal(cause.code, 'DOCKER_HELPER_TIMEOUT'); assert.equal(getBoundedDockerCleanup(cause).status, 'PASS'); assert.equal(daemon.data.stops, 1); assert.equal(daemon.data.containers.size, 0);
});
test('lost create acknowledgement reconciles exact nonce/name and removes only that helper', async () => {
  const daemon = daemonFixture({ lostCreate: true });
  const cause = await failure(() => withBoundedDockerExecution(policy({ requestTimeoutMs: 10 }), () => daemon.create()));
  assert.equal(cause.code, 'DOCKER_REQUEST_TIMEOUT'); assert.equal(getBoundedDockerCleanup(cause).status, 'PASS'); assert.equal(daemon.data.containers.size, 0); assert.equal(daemon.data.removals, 1); assert.equal(daemon.data.destroyCalls, 1);
});
test('empty nonce scan cannot prove that a timed-out create will never commit later', async () => {
  const daemon = daemonFixture({ emptyLostCreate: true });
  const cause = await failure(() => withBoundedDockerExecution(policy({ requestTimeoutMs: 10 }), () => daemon.create()));
  assert.equal(cause.code, 'DOCKER_SCOPE_CLEANUP_UNCONFIRMED'); assert.equal(getBoundedDockerCleanup(cause).status, 'UNCONFIRMED'); assert.equal(getBoundedDockerCleanup(cause).helpersRemoved, false); assert.equal(daemon.data.removals, 0); assert.equal(daemon.data.destroyCalls, 1);
});
test('foreign nonce replacement is never stopped or removed', async () => {
  const daemon = daemonFixture({ changeNonce: true }); const cause = await failure(() => withBoundedDockerExecution(policy(), () => daemon.create()));
  assert.equal(cause.code, 'DOCKER_SCOPE_CLEANUP_UNCONFIRMED'); assert.equal(daemon.data.stops, 0); assert.equal(daemon.data.removals, 0);
});
test('cleanup refusal retains primary error and never reports a safe scope', async () => {
  const daemon = daemonFixture({ failDelete: true }), original = Error('synthetic primary');
  const cause = await failure(() => withBoundedDockerExecution(policy(), async () => { await daemon.create(); throw original; }));
  assert.equal(cause.code, 'DOCKER_SCOPE_CLEANUP_UNCONFIRMED'); assert.equal(cause.cause.errors[0], original); assert.equal(getBoundedDockerCleanup(cause).helpersRemoved, false);
});
test('HTTP deadline covers a response body that never ends', async () => {
  const daemon = daemonFixture({ bodyNeverEnds: true });
  const cause = await failure(() => withBoundedDockerExecution(policy({ requestTimeoutMs: 10 }), () => boundedDockerRequest(SOCKET, 'GET', '/synthetic-body', undefined, {}, daemon)));
  assert.equal(cause.code, 'DOCKER_REQUEST_TIMEOUT'); assert.equal(getBoundedDockerCleanup(cause).commandsJoined, true); assert.equal(daemon.data.destroyCalls, 1);
});
test('synchronous request end failure still awaits the allocated transport close', async () => {
  const daemon = daemonFixture({ endThrows: true, destroyCloseDelay: 20 });
  const cause = await failure(() => withBoundedDockerExecution(policy(), () => boundedDockerRequest(SOCKET, 'GET', '/synthetic-end-failure', undefined, {}, daemon)));
  assert.equal(cause.code, 'DOCKER_REQUEST_FAILED'); assert.equal(daemon.data.destroyCalls, 1); assert.equal(daemon.data.requestCloses, 1); assert.equal(getBoundedDockerCleanup(cause).commandsJoined, true);
});
test('absolute command timeout kills and positively joins the synthetic CLI', async () => {
  const process = processFixture({ hang: true }), cause = await failure(() => withBoundedDockerExecution(policy({ commandTimeoutMs: 10 }), () => boundedDockerCommand(['version'], {}, process)));
  assert.equal(cause.code, 'DOCKER_COMMAND_TIMEOUT'); assert.equal(process.observed.killed, 1); assert.equal(getBoundedDockerCleanup(cause).status, 'PASS'); assert.equal(getBoundedDockerCleanup(cause).commandsJoined, true);
});
test('owned stderr pipe failure refuses through the positive CLI stop and join path', async () => {
  const process = processFixture({ stderrFailure: true });
  const cause = await failure(() => withBoundedDockerExecution(policy(), () => boundedDockerCommand(['version'], {}, process)));
  assert.equal(cause.code, 'DOCKER_STDERR_FAILED'); assert.equal(process.observed.killed, 1); assert.equal(getBoundedDockerCleanup(cause).commandsJoined, true); assert.equal(cause.message.includes('synthetic stderr pipe failure'), false);
});
test('already aborted caller never spawns a Docker CLI', async () => {
  let spawned = false; await assert.rejects(withBoundedDockerExecution(policy(), () => boundedDockerCommand(['version'], { signal: AbortSignal.abort() }, { spawn() { spawned = true; } })), code('OPERATIONS_INTERRUPTED')); assert.equal(spawned, false);
});
test('archive output is fresh wx streaming and capped independently of buffered output', async () => {
  const process = processFixture({ bytes: Buffer.from([0, 255, 1, 2]) });
  await withBoundedDockerExecution(policy({ archiveOutputBytes: 4 }), () => boundedDockerCommand(['image', 'save', '--output', '/synthetic/archive', IMAGE], {}, { ...process, createWriteStream: process.write }));
  assert.deepEqual(process.observed.calls[0].args, ['image', 'save', IMAGE]); assert.deepEqual(process.observed.outputs[0].options, { flags: 'wx', mode: 0o600 }); assert.deepEqual(Buffer.concat(process.observed.outputs[0].chunks), Buffer.from([0, 255, 1, 2]));
});
test('output overflow remains primary refusal after a positive child join', async () => {
  const process = processFixture({ bytes: Buffer.alloc(5) }); const cause = await failure(() => withBoundedDockerExecution(policy({ archiveOutputBytes: 4 }), () => boundedDockerCommand(['version'], { output: '/synthetic/out' }, { ...process, createWriteStream: process.write })));
  assert.equal(cause.code, 'DOCKER_OUTPUT_LIMIT'); assert.equal(getBoundedDockerCleanup(cause).commandsJoined, true);
});
test('PostgreSQL witness preserves binary stdin/stdout and positional SQL arguments', async () => {
  const binary = Buffer.from([0, 255, 128, 10, 0]), process = processFixture({ bytes: binary }), sql = 'SELECT `private`; $(untouched); "quoted"';
  const output = await withBoundedDockerExecution(policy(), () => boundedDockerCommand(['exec', '-i', ID, 'psql', '--command', sql], { input: Readable.from([binary]) }, process));
  assert.deepEqual(output, binary); assert.deepEqual(process.observed.input, binary);
  const args = process.observed.calls[0].args, script = args[args.indexOf('-c') + 1]; assert.equal(script.includes(sql), false); assert.equal(args.at(-1), sql); assert.match(script, /"\$@"/);
});
test('valid witnessed nonzero pg_isready is terminal failure and can be retried', async () => {
  const first = processFixture({ exitCode: 1 }), second = processFixture();
  await withBoundedDockerExecution(policy(), async () => { await assert.rejects(boundedDockerCommand(['exec', ID, 'pg_isready'], {}, first), code('DOCKER_COMMAND_FAILED')); await boundedDockerCommand(['exec', ID, 'pg_isready'], {}, second); });
});
for (const witness of ['absent', 'wrong', 'duplicate', 'truncated', 'mismatch', 'extra-newline', 'high-bit']) test('missing or contradictory remote witness refuses safe recovery: ' + witness, async () => {
  const process = processFixture({ witness }); const cause = await failure(() => withBoundedDockerExecution(policy(), () => boundedDockerCommand(['exec', ID, 'pg_dump'], {}, process)));
  assert.equal(cause.code, 'DOCKER_SCOPE_CLEANUP_UNCONFIRMED'); assert.equal(getBoundedDockerCleanup(cause).remoteExecUnknown, true);
});
test('abort after marker but before local close does not prove remote termination', async () => {
  const controller = new AbortController(), process = processFixture({ afterMarker: () => controller.abort() });
  const cause = await failure(() => withBoundedDockerExecution(policy(), () => boundedDockerCommand(['exec', ID, 'pg_dump'], { signal: controller.signal }, process)));
  assert.equal(getBoundedDockerCleanup(cause).remoteExecUnknown, true); assert.equal(cause.code, 'DOCKER_SCOPE_CLEANUP_UNCONFIRMED');
});
test('spawn failure without an owned process is refused and positively closed', async () => {
  const process = processFixture({ spawnFailure: true }); const cause = await failure(() => withBoundedDockerExecution(policy(), () => boundedDockerCommand(['exec', ID, 'pg_isready'], {}, process)));
  assert.equal(cause.code, 'DOCKER_UNAVAILABLE'); assert.equal(getBoundedDockerCleanup(cause).commandsJoined, true); assert.equal(getBoundedDockerCleanup(cause).remoteExecUnknown, false);
});
for (const args of [['exec', '--detach', ID, 'pg_dump'], ['exec', '--tty', ID, 'pg_dump'], ['exec', ID, 'sh', '-c', 'sleep 1 &'], ['exec', ID, 'pg_restore', '--jobs=2'], ['run', IMAGE]]) test('unbounded remote mode is refused before spawn: ' + args.join(' '), async () => {
  let spawned = false; await assert.rejects(withBoundedDockerExecution(policy(), () => boundedDockerCommand(args, {}, { spawn() { spawned = true; } }))); assert.equal(spawned, false);
});
test('callback that never joins cannot authorize source recovery', { timeout: 15_000 }, async () => {
  const cause = await failure(() => withBoundedDockerExecution(policy({ operationTimeoutMs: 10, commandTimeoutMs: 10, requestTimeoutMs: 10, helperTimeoutMs: 10 }), () => new Promise(() => undefined)));
  assert.equal(cause.code, 'DOCKER_SCOPE_CLEANUP_UNCONFIRMED'); assert.equal(getBoundedDockerCleanup(cause).operationJoined, false);
});
test('CLI without positive close keeps cleanup unconfirmed after termination attempt', { timeout: 15_000 }, async () => {
  const process = processFixture({ hang: true, closeOnKill: false });
  const cause = await failure(() => withBoundedDockerExecution(policy({ commandTimeoutMs: 10 }), () => boundedDockerCommand(['version'], {}, process)));
  assert.equal(cause.code, 'DOCKER_SCOPE_CLEANUP_UNCONFIRMED'); assert.equal(getBoundedDockerCleanup(cause).commandsJoined, false);
});
test('delayed event-loop timer cannot allow success beyond the monotonic operation deadline', async () => {
  const cause = await failure(() => withBoundedDockerExecution(policy({ operationTimeoutMs: 1, commandTimeoutMs: 1, requestTimeoutMs: 1, helperTimeoutMs: 1 }), async () => { const until = performance.now() + 8; while (performance.now() < until) { /* Simulate synchronous verification. */ } return 'late'; }));
  assert.equal(cause.code, 'DOCKER_OPERATION_TIMEOUT'); assert.equal(getBoundedDockerCleanup(cause).operationJoined, true);
});
test('unknown source stop outcome cannot authorize source resume after socket close', async () => {
  const daemon = daemonFixture({ holdControl: true });
  const cause = await failure(() => withBoundedDockerExecution(policy({ requestTimeoutMs: 10 }), () => boundedDockerRequest(SOCKET, 'POST', '/containers/' + 'f'.repeat(64) + '/stop?t=5', undefined, {}, daemon)));
  assert.equal(cause.code, 'DOCKER_SCOPE_CLEANUP_UNCONFIRMED'); assert.equal(getBoundedDockerCleanup(cause).unknownDockerMutation, true); assert.equal(daemon.data.destroyCalls, 1);
});
test('interrupted mutating compose CLI remains unknown after local child close', async () => {
  const process = processFixture({ hang: true }); const cause = await failure(() => withBoundedDockerExecution(policy({ commandTimeoutMs: 10 }), () => boundedDockerCommand(['compose', 'create'], {}, process)));
  assert.equal(cause.code, 'DOCKER_SCOPE_CLEANUP_UNCONFIRMED'); assert.equal(getBoundedDockerCleanup(cause).commandsJoined, true); assert.equal(getBoundedDockerCleanup(cause).unknownDockerMutation, true);
});
const volume = (Source, Target, ReadOnly) => ({ Type: 'volume', Source, Target, ReadOnly }), bind = (Source, Target, ReadOnly) => ({ Type: 'bind', Source, Target, ReadOnly });
for (const [operation, cmd, mounts, expected] of [
  ['capture', ['node', 'scripts/operations/archives.mjs', 'capture', '/source', '/backup/minio.wfcops'], [volume('own-source', '/source', true), bind('/own-backup', '/backup', false)], ['DAC_OVERRIDE']],
  ['restore', ['node', 'scripts/operations/archives.mjs', 'restore', '/backup/pathfinder.wfcops', '/target', 'a'.repeat(64)], [bind('/own-backup', '/backup', true), volume('own-target', '/target', false)], ['CHOWN', 'FOWNER', 'DAC_OVERRIDE']],
  ['measure', ['node', 'scripts/operations/archives.mjs', 'measure', '/source'], [volume('own-source', '/source', true)], ['DAC_OVERRIDE']],
  ['verify', ['node', 'scripts/operations/archives.mjs', 'verify', '/backup/staging.wfcops', 'a'.repeat(64)], [bind('/own-backup', '/backup', true)], []],
]) test('closed archive ownership profile grants only exact capabilities for ' + operation, async () => {
  const daemon = daemonFixture();
  await withBoundedDockerExecution(policy({ archiveOwnership: 'preserve-posix' }), () => boundedDockerRequest(SOCKET, 'POST', '/containers/create?name=synthetic-archive', { Image: IMAGE, User: '0', Cmd: cmd, HostConfig: { NetworkMode: 'none', Mounts: mounts } }, {}, daemon));
  assert.deepEqual(daemon.data.body.HostConfig.CapAdd, expected); assert.deepEqual(daemon.data.body.HostConfig.CapDrop, ['ALL']); assert.equal(daemon.data.body.HostConfig.ReadonlyRootfs, true);
});
test('wrong archive command never gains capabilities requested by caller', async () => {
  const daemon = daemonFixture();
  await withBoundedDockerExecution(policy({ archiveOwnership: 'preserve-posix' }), () => boundedDockerRequest(SOCKET, 'POST', '/containers/create?name=synthetic-other', { Image: IMAGE, User: '0', Cmd: ['node', '/untrusted.mjs'], HostConfig: { CapAdd: ['SYS_ADMIN'] } }, {}, daemon));
  assert.deepEqual(daemon.data.body.HostConfig.CapAdd, []);
});
test('archive ownership refuses wrong writable mount direction before daemon create', async () => {
  const daemon = daemonFixture();
  await assert.rejects(withBoundedDockerExecution(policy({ archiveOwnership: 'preserve-posix' }), () => boundedDockerRequest(SOCKET, 'POST', '/containers/create?name=synthetic-wrong', { Image: IMAGE, User: '0', Cmd: ['node', 'scripts/operations/archives.mjs', 'restore', '/backup/minio.wfcops', '/target', 'a'.repeat(64)], HostConfig: { NetworkMode: 'none', Mounts: [bind('/own-backup', '/backup', false), volume('own-target', '/target', false)] } }, {}, daemon)), code('DOCKER_ARCHIVE_CAPABILITY_SCOPE'));
  assert.equal(daemon.data.body, null);
});
const inventoryConfig=()=>({Image:IMAGE,User:'0',Cmd:['node','scripts/pathfinder-local/container-ops.mjs','inventory','/source'],HostConfig:{NetworkMode:'none',Mounts:[volume('synthetic-owned-pf','/source',true)],CapAdd:['SYS_ADMIN']}});
test('explicit ownership profile grants only DAC_OVERRIDE to the exact isolated read-only artifact inventory',async()=>{
  const daemon=daemonFixture();
  await withBoundedDockerExecution(policy({archiveOwnership:'preserve-posix'}),()=>boundedDockerRequest(SOCKET,'POST','/containers/create?name=synthetic-inventory',inventoryConfig(),{},daemon));
  assert.deepEqual(daemon.data.body.HostConfig.CapAdd,['DAC_OVERRIDE']);assert.deepEqual(daemon.data.body.HostConfig.CapDrop,['ALL']);assert.equal(daemon.data.body.HostConfig.ReadonlyRootfs,true);assert.equal(daemon.data.body.HostConfig.NetworkMode,'none');assert.equal(daemon.data.containers.size,0);
});
test('artifact inventory receives no added capability without the explicit ownership profile',async()=>{
  const daemon=daemonFixture();
  await withBoundedDockerExecution(policy(),()=>boundedDockerRequest(SOCKET,'POST','/containers/create?name=synthetic-inventory-default',inventoryConfig(),{},daemon));
  assert.deepEqual(daemon.data.body.HostConfig.CapAdd,[]);
});
for(const[title,alter]of [
  ['wrong operation',c=>{c.Cmd[2]='recover';}],
  ['extra command argument',c=>{c.Cmd.push('--apply');}],
  ['alternate source path',c=>{c.Cmd[3]='/other';}],
  ['writable source',c=>{c.HostConfig.Mounts[0].ReadOnly=false;}],
  ['host bind source',c=>{c.HostConfig.Mounts[0]=bind('/host-private','/source',true);}],
  ['extra mount',c=>{c.HostConfig.Mounts.push(volume('other','/other',true));}],
  ['network access',c=>{c.HostConfig.NetworkMode='bridge';}],
  ['alternate entrypoint',c=>{c.Entrypoint=['sh'];}],
  ['device access',c=>{c.HostConfig.Devices=[{PathOnHost:'/dev/synthetic'}];}],
  ['different user',c=>{c.User='1000:1000';}],
])test('artifact inventory capability refuses '+title+' before daemon create',async()=>{
  const daemon=daemonFixture(),config=inventoryConfig();alter(config);
  await assert.rejects(withBoundedDockerExecution(policy({archiveOwnership:'preserve-posix'}),()=>boundedDockerRequest(SOCKET,'POST','/containers/create?name=synthetic-inventory-refused',config,{},daemon)),code('DOCKER_ARCHIVE_CAPABILITY_SCOPE'));
  assert.equal(daemon.data.body,null);
});
