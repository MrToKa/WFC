import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { canonical, sha256, parseOutput, semantic, classifyError } from '../pathfinder-session/lib.mjs';

// Test-only driver. Production executor dependencies and limits are never replaced.
export const LIMITS = Object.freeze({ requests: 128, files: 256, fileBytes: 32 * 1024 ** 2,
  frozenBytes: 64 * 1024 ** 2, manifestBytes: 1024 ** 2, requestBytes: 1024 ** 2,
  responseBytes: 32 * 1024 ** 2, allResponsesBytes: 64 * 1024 ** 2,
  events: 16000, nodeSamples: 10000, receiptBytes: 16 * 1024 ** 2,
  defaultDeadlineMilliseconds: 480000, maximumDeadlineMilliseconds: 600000 });
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;

export function relativePath(value) {
  if (typeof value !== 'string' || !value.length || value.length > 512 || value.includes('\\')
    || value.includes('\0') || value.includes(':') || value.startsWith('/')
    || value.split('/').some(part => !part.length || part === '.' || part === '..')) fail('WORKLOAD_RELATIVE_PATH_INVALID');
  return value;
}

export function validateManifest(value) {
  if (!object(value) || value.schemaVersion !== 'wfc.pf.barrier-session-workload.v1'
    || value.sourceKind !== 'synthetic' || value.engineeringAccepted !== false || value.nativeParity !== 'not-performed'
    || value.trayCount !== 64 || value.maximumRouteCodes !== 64 || !object(value.geometry)
    || !Array.isArray(value.requests) || !integer(value.requests.length, 65, LIMITS.requests)
    || !Array.isArray(value.files) || !integer(value.files.length, 1, LIMITS.files)) fail('WORKLOAD_MANIFEST_INVALID');
  const files = new Map(); let bytes = 0;
  for (const entry of value.files) {
    if (!object(entry) || !SHA.test(entry.sha256 ?? '') || !integer(entry.bytes, 1, LIMITS.fileBytes)) fail('WORKLOAD_FILE_INVALID');
    const name = relativePath(entry.path);
    if (files.has(name)) fail('WORKLOAD_FILE_DUPLICATE');
    files.set(name, entry); bytes += entry.bytes;
  }
  if (bytes > LIMITS.frozenBytes) fail('WORKLOAD_FROZEN_BUDGET');
  const ids = new Set();
  for (const [index, entry] of value.requests.entries()) {
    if (!object(entry) || entry.index !== index || !UUID.test(entry.id ?? '') || ids.has(entry.id)
      || typeof entry.label !== 'string' || !entry.label || entry.label.length > 160
      || !['retirement', 'control'].includes(entry.population) || !object(value.geometry[entry.geometryKey])
      || !SHA.test(entry.requestSha256 ?? '') || !SHA.test(entry.contextSha256 ?? '')
      || !['calculated', 'refused'].includes(entry.expectedStatus)
      || !Array.isArray(entry.expectedStatuses) || !entry.expectedStatuses.length
      || !entry.expectedStatuses.every(status => ['calculated', 'no_path', 'resource_limit'].includes(status))
      || !Array.isArray(entry.expectedBarrierStatuses) || !entry.expectedBarrierStatuses.length
      || !entry.expectedBarrierStatuses.every(status => ['clear', 'bypassed', 'no-barriers-declared', 'blocked', 'search-incomplete', 'indeterminate'].includes(status))
      || !(entry.equivalenceGroup === null || typeof entry.equivalenceGroup === 'string' && entry.equivalenceGroup.length <= 160)) fail('WORKLOAD_REQUEST_DESCRIPTOR_INVALID');
    const file = files.get(relativePath(entry.requestPath));
    if (!file || file.sha256 !== entry.requestSha256 || file.bytes > LIMITS.requestBytes) fail('WORKLOAD_REQUEST_NOT_FROZEN');
    if (entry.expectedStatus === 'calculated' && canonical(entry.expectedStatuses) !== '["calculated"]'
      || entry.expectedStatus === 'refused' && entry.expectedStatuses.includes('calculated')) fail('WORKLOAD_EXPECTATION_INVALID');
    ids.add(entry.id);
  }
  const indices = (key, minimum, maximum) => {
    const entries = value[key];
    if (!Array.isArray(entries) || !integer(entries.length, minimum, maximum) || new Set(entries).size !== entries.length
      || !entries.every(index => integer(index, 0, value.requests.length - 1))) fail('WORKLOAD_POPULATION_INVALID');
    return entries;
  };
  const population = indices('retirementPopulationIndices', 65, LIMITS.requests);
  indices('oneShotIndices', 4, 8);
  if (!population.every((index, at) => index === at && value.requests[index].population === 'retirement'
    && value.requests[index].expectedStatus === 'calculated')) fail('WORKLOAD_RETIREMENT_POPULATION_INVALID');
  for (const descriptor of Object.values(value.geometry)) {
    if (!object(descriptor) || !object(descriptor.context) || !files.has(relativePath(descriptor.manifestPath))
      || !(descriptor.capturePath === null || files.has(relativePath(descriptor.capturePath)))) fail('WORKLOAD_GEOMETRY_INVALID');
  }
  return value;
}

export function latencySummary(values) {
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) fail('LATENCY_POPULATION_INVALID');
  const ordered = [...values].sort((a, b) => a - b);
  if (!ordered.length) return { count: 0, medianMilliseconds: null, p95Milliseconds: null, maximumMilliseconds: null };
  const middle = Math.floor(ordered.length / 2);
  return { count: ordered.length, medianMilliseconds: ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2,
    p95Milliseconds: ordered[Math.ceil(ordered.length * .95) - 1], maximumMilliseconds: ordered.at(-1) };
}

/** Full decoded DTO, excluding only request identity and fitted-model disk flag.
 * All path points, category, messages, strategy, diagnostics, ledger and proof remain. */
export const semanticDigest = response => sha256(canonical(semantic(response)));

export function expectedOutcome(descriptor, response) {
  return descriptor.expectedStatuses.includes(response.status)
    && descriptor.expectedBarrierStatuses.includes(response.barriers?.diagnostics?.status)
    && (descriptor.expectedStatus !== 'calculated' || response.route?.success === true && response.design != null)
    && (descriptor.expectedStatus !== 'refused' || response.route?.success !== true);
}

export function parseCli(args) {
  const values = {};
  for (let at = 0; at < args.length; at += 2) {
    const key = args[at];
    if (!['--manifest', '--output', '--built-root', '--deadline-ms'].includes(key)
      || key in values || !args[at + 1] || args[at + 1].startsWith('--')) fail('QUALIFICATION_ARGUMENT_INVALID');
    values[key] = args[at + 1];
  }
  for (const key of ['--manifest', '--output', '--built-root']) if (!path.isAbsolute(values[key] ?? '')) fail('QUALIFICATION_ABSOLUTE_PATH_REQUIRED');
  const deadline = values['--deadline-ms'] === undefined ? LIMITS.defaultDeadlineMilliseconds : Number(values['--deadline-ms']);
  if (!integer(deadline, 30000, LIMITS.maximumDeadlineMilliseconds)) fail('QUALIFICATION_DEADLINE_INVALID');
  return { manifest: path.resolve(values['--manifest']), output: path.resolve(values['--output']),
    builtRoot: path.resolve(values['--built-root']), deadline };
}

async function canonicalExisting(filename, kind) {
  const resolved = path.resolve(filename), stat = await fs.lstat(resolved);
  if (stat.isSymbolicLink() || await fs.realpath(resolved) !== resolved
    || kind === 'file' && !stat.isFile() || kind === 'directory' && !stat.isDirectory()) fail('QUALIFICATION_PATH_UNSAFE');
  return resolved;
}
async function boundedRead(filename, maximum) {
  await canonicalExisting(filename, 'file');
  const before = await fs.lstat(filename, { bigint: true });
  if (before.size <= 0n || before.size > BigInt(maximum) || before.nlink !== 1n) fail('QUALIFICATION_FILE_BUDGET');
  const bytes = await fs.readFile(filename), after = await fs.lstat(filename, { bigint: true });
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || before.mtimeNs !== after.mtimeNs || after.nlink !== 1n || bytes.length !== Number(before.size)) fail('QUALIFICATION_FILE_CHANGED');
  return bytes;
}
const childPath = (root, relative) => path.join(root, ...relativePath(relative).split('/'));
async function inventory(root, manifest) {
  const output = [];
  for (const file of manifest.files) {
    const bytes = await boundedRead(childPath(root, file.path), LIMITS.fileBytes);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) fail('WORKLOAD_FROZEN_FILE_CHANGED');
    output.push({ ...file });
  }
  return output;
}
async function processIdentity(pid) {
  const text = await fs.readFile(`/proc/${pid}/stat`, 'utf8'), end = text.lastIndexOf(')'), begin = text.indexOf('(');
  const fields = text.slice(end + 1).trim().split(/\s+/);
  if (begin < 0 || end < begin || Number(text.slice(0, begin).trim()) !== pid || fields.length < 20
    || !/^[0-9]+$/.test(fields[19])) fail('PROCESS_IDENTITY_UNAVAILABLE');
  return { pid, parentPid: Number(fields[1]), processGroup: Number(fields[2]), startTicks: fields[19], state: fields[0] };
}
function groupGone(pid) {
  try { process.kill(-pid, 0); return false; } catch (error) { return error?.code === 'ESRCH'; }
}
async function cgroupMemory() {
  // Container cgroup counters are separate from the sampled production process-tree guard.
  try {
    const [events, maximum] = await Promise.all([fs.readFile('/sys/fs/cgroup/memory.events', 'utf8'), fs.readFile('/sys/fs/cgroup/memory.max', 'utf8')]);
    const counters = {};
    for (const line of events.trim().split('\n')) {
      const [key, count] = line.trim().split(/\s+/);
      if (!/^[a-z_]+$/.test(key) || !/^[0-9]+$/.test(count)) fail('CGROUP_COUNTER_INVALID');
      counters[key] = count;
    }
    return { status: 'OBSERVED', counters, memoryMax: maximum.trim() };
  } catch { return { status: 'NOT_AVAILABLE' }; }
}

export async function qualify(options) {
  if (process.platform !== 'linux') fail('QUALIFICATION_REQUIRES_LINUX_DEFAULTS');
  await canonicalExisting(options.builtRoot, 'directory');
  await canonicalExisting(path.dirname(options.output), 'directory');
  try { await fs.lstat(options.output); fail('QUALIFICATION_NEW_OUTPUT_REQUIRED'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const root = await canonicalExisting(path.dirname(options.manifest), 'directory');
  if (options.output === root || root.startsWith(options.output + path.sep)
    || options.output.startsWith(root + path.sep) || options.output === options.builtRoot
    || options.output.startsWith(options.builtRoot + path.sep) || options.builtRoot.startsWith(options.output + path.sep)) fail('QUALIFICATION_OUTPUT_BOUNDARY');
  if (!process.env.PF_ROOT || await canonicalExisting(process.env.PF_ROOT, 'directory') !== root) fail('QUALIFICATION_PF_ROOT_MISMATCH');
  if (!path.isAbsolute(process.env.PF_ENGINE_DLL ?? '')) fail('QUALIFICATION_ENGINE_DLL_REQUIRED');
  await fs.mkdir(options.output, { recursive: false, mode: 0o700 });
  const started = performance.now(), controller = new AbortController();
  const receipt = { schemaVersion: 'wfc.pf.barrier-session-qualification.v1', startedAt: new Date().toISOString(), status: 'FAIL',
    node: { version: process.version, platform: process.platform, arch: process.arch, pid: process.pid },
    scope: { sourceKind: 'synthetic', actualAalborg: 'NOT_RUN', nativeParity: 'NOT_RUN', engineeringAccepted: false,
      independentRawTriangleVerifier: 'NOT_RUN_SEPARATE_COMMAND_REQUIRED', noDatabase: true, noApply: true,
      transport: 'actual production Linux default session executor; no dependency injection or increased limits',
      sampledMemory: '100ms sequential supervisor/worker process-tree RSS; Node measured separately; short peaks and whole-container exact peak unproved',
      perChildExitCodes: 'NOT_EXPOSED by production observer; close and process-group absence recorded separately',
      fittedReuse: 'preparedReuse describes fitted planning model only; not barrier I/O or qualification bypass' },
    bounds: LIMITS, checks: [], failures: [], observations: [], events: [], nodeSamples: [], processIdentities: [], processGroups: [],
    outerDeadlineMilliseconds: options.deadline };
  const responses = { schemaVersion: 'wfc.pf.barrier-session-responses.v1', responses: [] };
  const identityTasks = [], identities = new Map();
  let executor, timer, nodeTimer, manifest, manifestBytes, totalResponseBytes = 0, finished = false;
  const at = () => performance.now() - started;
  const recordFailure = (stage, error) => {
    if (receipt.failures.length < 256) receipt.failures.push({ stage, code: classifyError(error), atMilliseconds: at() });
  };
  const check = (name, pass, detail = {}) => {
    receipt.checks.push({ name, status: pass ? 'PASS' : 'FAIL', ...detail });
    if (!pass) fail('QUALIFICATION_CHECK_' + name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
  };
  const save = async () => {
    for (const [name, value, maximum] of [['responses.json', responses, LIMITS.allResponsesBytes], ['receipt.json', receipt, LIMITS.receiptBytes]]) {
      const bytes = Buffer.from(JSON.stringify(value));
      if (bytes.length > maximum) fail('QUALIFICATION_OUTPUT_BUDGET');
      // The directory was created absent by this invocation. A killed checkpoint
      // leaves its prior complete evidence file, rather than a truncated JSON file.
      const temporary = path.join(options.output, name + '.pending');
      const handle = await fs.open(temporary, 'w', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, path.join(options.output, name));
    }
  };
  const abort = () => controller.abort(new Error('QUALIFICATION_INTERRUPTED'));
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  const observe = event => {
    if (receipt.events.length >= LIMITS.events) { recordFailure('telemetry', { code: 'QUALIFICATION_EVENT_BUDGET' }); controller.abort(); return; }
    receipt.events.push({ ...event, atMilliseconds: at() });
    if (event.type === 'spawn') {
      const task = processIdentity(event.pid).then(identity => { identities.set(event.pid, identity); })
        .catch(error => recordFailure('process-identity', error));
      identityTasks.push(task);
    }
  };
  const nodeSample = () => {
    if (receipt.nodeSamples.length >= LIMITS.nodeSamples) { recordFailure('telemetry', { code: 'QUALIFICATION_NODE_SAMPLE_BUDGET' }); controller.abort(); return; }
    receipt.nodeSamples.push({ atMilliseconds: at(), rssBytes: process.memoryUsage().rss });
  };
  try {
    timer = setTimeout(() => { recordFailure('outer-deadline', { code: 'QUALIFICATION_OUTER_DEADLINE' }); controller.abort(); }, options.deadline);
    nodeSample(); nodeTimer = setInterval(nodeSample, 100);
    receipt.cgroupBefore = await cgroupMemory();
    manifestBytes = await boundedRead(options.manifest, LIMITS.manifestBytes);
    manifest = validateManifest(parseOutput(manifestBytes, LIMITS.manifestBytes));
    receipt.workload = { manifestSha256: sha256(manifestBytes), requests: manifest.requests.length, retirementRequests: manifest.retirementPopulationIndices.length,
      oneShotIndices: manifest.oneShotIndices, trayCount: manifest.trayCount, geometry: Object.fromEntries(Object.entries(manifest.geometry)
        .map(([key, descriptor]) => [key, Object.fromEntries(Object.entries(descriptor).filter(([field]) => !['context', 'manifestPath', 'capturePath'].includes(field)))])) };
    receipt.frozenFilesBefore = await inventory(root, manifest);
    receipt.driverSources = [];
    for (const relative of ['./qualify-session.mjs', '../pathfinder-session/lib.mjs', '../pathfinder-capacity/lib.mjs']) {
      const bytes = await boundedRead(fileURLToPath(new URL(relative, import.meta.url)), LIMITS.fileBytes);
      receipt.driverSources.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length });
    }
    const modules = {};
    receipt.builtModules = [];
    for (const [key, relative] of Object.entries({ session: 'server/pathfinder/engineSession.js', engine: 'server/pathfinder/engine.js',
      contracts: 'server/pathfinder/jobContracts.js', strategy: 'server/pathfinder/barrierStrategy.js', ledger: 'server/pathfinder/lengthLedger.js' })) {
      const filename = childPath(options.builtRoot, relative), bytes = await boundedRead(filename, LIMITS.fileBytes);
      receipt.builtModules.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length });
      modules[key] = await import(pathToFileURL(filename).href);
    }
    const runner = await boundedRead(process.env.PF_ENGINE_DLL, LIMITS.fileBytes);
    receipt.runner = { sha256: sha256(runner), bytes: runner.length };
    receipt.policy = modules.session.engineSessionPolicy;
    check('unchanged-default-policy', receipt.policy.requests === 64 && receipt.policy.rssBytes === 512 * 1024 ** 2
      && receipt.policy.rssIntervalMilliseconds === 100 && receipt.policy.startupMilliseconds === 5000
      && receipt.policy.idleMilliseconds === 30000 && receipt.policy.lifetimeMilliseconds === 600000 && receipt.policy.joinMilliseconds === 10000);
    const requests = new Map(), endpointPairs = new Set(), categories = new Set(), snapshotHashes = new Set();
    for (const descriptor of manifest.requests) {
      const bytes = await boundedRead(childPath(root, descriptor.requestPath), LIMITS.requestBytes);
      if (sha256(bytes) !== descriptor.requestSha256) fail('WORKLOAD_REQUEST_CHANGED');
      const request = parseOutput(bytes, LIMITS.requestBytes);
      if (request.schemaVersion !== 'pathfinder.model.runner.v2' || request.operation !== 'calculate' || request.requestId !== descriptor.id
        || request.includeLengthLedger !== true || !integer(request.timeoutMilliseconds, 1, 120000)
        || !object(request.from) || !object(request.to) || !object(request.barriers)
        || sha256(canonical(request.barriers)) !== descriptor.contextSha256) fail('WORKLOAD_INVOCATION_INVALID');
      if (manifest.retirementPopulationIndices.includes(descriptor.index)) {
        endpointPairs.add(canonical([request.from, request.to])); categories.add(request.category); snapshotHashes.add(request.snapshotSha256);
      }
      const snapshotFile = manifest.files.find(file => file.path === `snapshots/${request.snapshotId}.json`);
      if (!snapshotFile || snapshotFile.sha256 !== request.snapshotSha256) fail('WORKLOAD_SNAPSHOT_NOT_FROZEN');
      requests.set(descriptor.index, request);
    }
    receipt.workload.distinctRetirementEndpointPairs = endpointPairs.size;
    receipt.workload.categories = [...categories].sort();
    check('varied-retirement-inputs', endpointPairs.size >= 16 && snapshotHashes.size === 1
      && canonical([...categories].sort()) === '["Control","Instrumentation","LV"]');
    // No second dependencies argument: these are actual production Linux defaults.
    executor = modules.session.createSessionEngineExecutor({ observe });
    const invoke = async (descriptor, mode) => {
      controller.signal.throwIfAborted();
      const request = structuredClone(requests.get(descriptor.index)), before = receipt.events.length, begin = performance.now();
      const observation = { index: descriptor.index, requestId: request.requestId, label: descriptor.label, population: descriptor.population,
        mode, category: request.category, outcome: 'FAILED' };
      receipt.observations.push(observation);
      try {
        const raw = mode === 'session' ? await executor.execute(request, controller.signal)
          : await modules.engine.runEngine(request, controller.signal, pid => { observation.pid = pid; observation.processIdentityTask = identityTasks.length;
            identityTasks.push(processIdentity(pid).then(identity => identities.set(pid, identity)).catch(error => recordFailure('oneshot-identity', error))); });
        observation.milliseconds = performance.now() - begin;
        const responseBytes = Buffer.byteLength(JSON.stringify(raw)); totalResponseBytes += responseBytes;
        if (responseBytes > LIMITS.responseBytes || totalResponseBytes > LIMITS.allResponsesBytes - 32768) fail('QUALIFICATION_RESPONSE_BUDGET');
        responses.responses.push({ index: descriptor.index, requestId: request.requestId, mode, response: raw });
        const response = modules.contracts.engineResponseSchema.parse(raw);
        if (response.schemaVersion !== 'pathfinder.model.response.v3' || response.requestId !== request.requestId) fail('QUALIFICATION_RESPONSE_IDENTITY');
        modules.strategy.requireBarrierEngineStrategy(response, { context: request.barriers, category: request.category,
          fromPoint: [request.from.x, request.from.y, request.from.z], toPoint: [request.to.x, request.to.y, request.to.z], reverse: request.reverse === true });
        modules.ledger.requireCalculationLengthLedger(response, { ...request.projectSettings, connectionGap: String(request.options.connectionToleranceMeters) });
        if (!expectedOutcome(descriptor, response)) fail('QUALIFICATION_EXPECTED_OUTCOME');
        observation.status = response.status; observation.barrierStatus = response.barriers.diagnostics.status;
        observation.semanticSha256 = semanticDigest(response); observation.responseBytes = responseBytes;
        if (mode === 'session') {
          const events = receipt.events.slice(before), dispatch = events.filter(event => event.type === 'dispatch' && event.requestId === request.requestId);
          const results = events.filter(event => event.type === 'result' && event.requestId === request.requestId);
          if (dispatch.length !== 1 || results.length !== 1 || dispatch[0].pid !== results[0].pid
            || dispatch[0].requestOrdinal !== results[0].requestOrdinal) fail('QUALIFICATION_DISPATCH_NOT_EXACTLY_ONCE');
          Object.assign(observation, { pid: results[0].pid, requestOrdinal: results[0].requestOrdinal, preparedReuse: results[0].preparedReuse,
            retireAfterResponse: results[0].retireAfterResponse, startupIncluded: events.some(event => event.type === 'ready' && event.pid === results[0].pid) });
        }
        observation.outcome = 'PASS';
        return response;
      } catch (error) { observation.milliseconds ??= performance.now() - begin; observation.errorCode = classifyError(error); recordFailure(`${mode}-${descriptor.index}`, error); throw error; }
      finally { await save(); }
    };
    const sessionResults = new Map();
    for (const descriptor of manifest.requests) sessionResults.set(descriptor.index, await invoke(descriptor, 'session'));
    await executor.close(); executor = null;
    for (const index of manifest.oneShotIndices) {
      const response = await invoke(manifest.requests[index], 'oneshot');
      check(`matched-oneshot-${index}`, semanticDigest(response) === semanticDigest(sessionResults.get(index)), { index });
    }
    const equivalents = new Map();
    for (const descriptor of manifest.requests) if (descriptor.equivalenceGroup !== null) {
      const digest = semanticDigest(sessionResults.get(descriptor.index)), previous = equivalents.get(descriptor.equivalenceGroup);
      if (previous && previous !== digest) fail('QUALIFICATION_EQUIVALENT_INPUT_CHANGED');
      equivalents.set(descriptor.equivalenceGroup, digest);
    }
    const population = receipt.observations.filter(row => row.mode === 'session' && manifest.retirementPopulationIndices.includes(row.index));
    const first = population.slice(0, 64), next = population[64];
    check('actual-64-request-retirement', population.length >= 65 && first.every((row, index) => row.pid === first[0].pid && row.requestOrdinal === index + 1)
      && first.at(-1).retireAfterResponse === true && next.pid !== first[0].pid && next.requestOrdinal === 1
      && receipt.events.some(event => event.type === 'retire' && event.pid === first[0].pid)
      && receipt.events.some(event => event.type === 'closed' && event.pid === first[0].pid));
    check('ready-identities-match-retained-runner', receipt.events.filter(event => event.type === 'ready').length >= 2
      && receipt.events.filter(event => event.type === 'ready').every(event => event.runnerSha256 === receipt.runner.sha256));
    finished = true;
  } catch (error) { recordFailure('driver', error); }
  finally {
    clearTimeout(timer); clearInterval(nodeTimer); nodeSample();
    if (executor) try { await executor.close(); receipt.executorClose = 'PASS'; } catch (error) { recordFailure('executor-close', error); receipt.executorClose = 'FAIL'; }
    else receipt.executorClose = finished ? 'PASS' : 'NOT_STARTED_OR_CLOSED';
    await Promise.all(identityTasks);
    receipt.processIdentities = [...identities.values()];
    const pids = new Set([...receipt.events.filter(event => event.type === 'spawn').map(event => event.pid),
      ...receipt.observations.filter(row => row.mode === 'oneshot' && row.pid).map(row => row.pid)]);
    receipt.processGroups = [...pids].map(pid => ({ pid, groupGone: groupGone(pid),
      mode: receipt.events.some(event => event.type === 'spawn' && event.pid === pid) ? 'session' : 'oneshot',
      closedEvent: receipt.events.some(event => event.type === 'closed' && event.pid === pid),
      oneshotRunEngineResolved: receipt.observations.some(row => row.mode === 'oneshot' && row.pid === pid && row.outcome === 'PASS'), exitCode: 'NOT_EXPOSED' }));
    if ([...pids].some(pid => !identities.has(pid)) || receipt.processGroups.some(group => !group.groupGone || group.mode === 'session' && !group.closedEvent))
      recordFailure('process-join', { code: 'QUALIFICATION_PROCESS_IDENTITY_OR_JOIN_UNPROVEN' });
    receipt.cgroupAfter = await cgroupMemory();
    if (receipt.cgroupBefore?.status === 'OBSERVED' && receipt.cgroupAfter.status === 'OBSERVED') {
      receipt.cgroupOomDeltas = Object.fromEntries(['oom', 'oom_kill', 'oom_group_kill'].map(key => [key,
        String(BigInt(receipt.cgroupAfter.counters[key] ?? '0') - BigInt(receipt.cgroupBefore.counters[key] ?? '0'))]));
      if (Object.values(receipt.cgroupOomDeltas).some(delta => delta !== '0')) recordFailure('cgroup-oom', { code: 'QUALIFICATION_OOM_OBSERVED' });
    }
    try {
      if (manifest) receipt.frozenFilesAfter = await inventory(root, manifest);
      if (manifestBytes && sha256(await boundedRead(options.manifest, LIMITS.manifestBytes)) !== sha256(manifestBytes)) fail('WORKLOAD_MANIFEST_CHANGED');
      for (const module of receipt.builtModules ?? []) if (sha256(await boundedRead(childPath(options.builtRoot, module.path), LIMITS.fileBytes)) !== module.sha256) fail('QUALIFICATION_BUILT_MODULE_CHANGED');
      for (const source of receipt.driverSources ?? []) if (sha256(await boundedRead(fileURLToPath(new URL(source.path, import.meta.url)), LIMITS.fileBytes)) !== source.sha256) fail('QUALIFICATION_DRIVER_SOURCE_CHANGED');
      if (receipt.runner && sha256(await boundedRead(process.env.PF_ENGINE_DLL, LIMITS.fileBytes)) !== receipt.runner.sha256) fail('QUALIFICATION_RUNNER_CHANGED');
    } catch (error) { recordFailure('final-input-integrity', error); }
    const session = receipt.observations.filter(row => row.mode === 'session'), retirement = session.filter(row => row.population === 'retirement');
    receipt.latencyPopulations = { definition: 'elapsed execute/runEngine time, including startup or retirement join when it occurred; failures retained',
      allSession: latencySummary(session.map(row => row.milliseconds)), retirement: latencySummary(retirement.map(row => row.milliseconds)),
      startupIncluded: latencySummary(session.filter(row => row.startupIncluded).map(row => row.milliseconds)),
      fittedMemoryReuse: latencySummary(session.filter(row => row.preparedReuse === 'memory').map(row => row.milliseconds)),
      oneShot: latencySummary(receipt.observations.filter(row => row.mode === 'oneshot').map(row => row.milliseconds)),
      readyStartup: latencySummary(receipt.events.filter(event => event.type === 'ready').map(event => {
        const spawn = receipt.events.find(candidate => candidate.type === 'spawn' && candidate.pid === event.pid);
        return event.atMilliseconds - (spawn?.atMilliseconds ?? event.atMilliseconds);
      })) };
    const rss = receipt.events.filter(event => event.type === 'rss');
    receipt.memory = { exactPeak: false, sampleIntervalMilliseconds: 100, combinedEngineSamples: rss.length,
      maximumSampledSupervisorWorkerRssBytes: rss.length ? Math.max(...rss.map(event => event.bytes)) : null,
      nodeSamples: receipt.nodeSamples.length, maximumSampledNodeRssBytes: Math.max(...receipt.nodeSamples.map(sample => sample.rssBytes)),
      oneShotProcessRss: 'NOT_SAMPLED_BY_PRODUCTION_CALCULATE_EXECUTOR', containerExitAndOomInspect: 'NOT_RUN_REQUIRES_ROOT_OUTER_RECEIPT' };
    if (!rss.length && session.length) recordFailure('rss', { code: 'QUALIFICATION_ENGINE_RSS_UNOBSERVED' });
    if (rss.some(event => event.thresholdBytes !== 512 * 1024 ** 2 || event.bytes > event.thresholdBytes)) recordFailure('rss', { code: 'QUALIFICATION_ENGINE_RSS_LIMIT' });
    receipt.counts = { plannedSession: manifest?.requests.length ?? null, actualSession: session.length,
      plannedOneShot: manifest?.oneShotIndices.length ?? null, actualOneShot: receipt.observations.length - session.length,
      successfulCalculated: receipt.observations.filter(row => row.outcome === 'PASS' && row.status === 'calculated').length,
      expectedTypedRefusals: receipt.observations.filter(row => row.outcome === 'PASS' && row.status !== 'calculated').length,
      failures: receipt.observations.filter(row => row.outcome !== 'PASS').length,
      byMode: Object.fromEntries(['session', 'oneshot'].map(mode => [mode, {
        calculated: receipt.observations.filter(row => row.mode === mode && row.outcome === 'PASS' && row.status === 'calculated').length,
        expectedTypedRefusals: receipt.observations.filter(row => row.mode === mode && row.outcome === 'PASS' && row.status !== 'calculated').length,
        failed: receipt.observations.filter(row => row.mode === mode && row.outcome !== 'PASS').length }])),
      sessionSupervisorProcesses: new Set(receipt.events.filter(event => event.type === 'spawn').map(event => event.pid)).size,
      fittedReuse: Object.fromEntries(['none', 'build', 'disk', 'memory'].map(kind => [kind, session.filter(row => row.preparedReuse === kind).length])) };
    receipt.elapsedMilliseconds = at(); receipt.finishedAt = new Date().toISOString();
    receipt.status = finished && !controller.signal.aborted && !receipt.failures.length ? 'PASS' : 'FAIL';
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
    await save();
  }
  return { status: receipt.status, output: options.output, counts: receipt.counts, elapsedMilliseconds: receipt.elapsedMilliseconds };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await qualify(parseCli(process.argv.slice(2))); process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = result.status === 'PASS' ? 0 : 1; }
  catch (error) { process.stderr.write(JSON.stringify({ status: 'FAIL', code: classifyError(error) }) + '\n'); process.exitCode = 1; }
}
