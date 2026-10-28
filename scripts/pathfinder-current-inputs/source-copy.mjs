import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EXPECTED, LIMITS, METADATA_FORMAT, PROBE_PROGRAM, buildReadProgram, buildIdentityProgram, buildProjectIdentityProgram, validateContainers, validateProbe, validateBinding, validateSnapshot, validateSqlIdentity, validateProjectIdentity, projectionHashes, canonical, parseOutput, sha256, fail } from './source-lib.mjs';

const TOOL_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const sourceFiles = ['Dockerfile', 'package-lock.json', 'docker-compose.app.yml', 'docker-compose.yml', 'server/db.ts', 'server/config.ts', 'server/modelRegistry/schema.ts', 'server/models/cable.ts'];
const ownFiles = ['source-copy.mjs', 'source-lib.mjs', 'source-lib.test.mjs', 'README-source.md'];
const assert = (condition, code) => { if (!condition) fail(code); };
const relativeSafe = value => typeof value === 'string' && value.length > 0 && value.length < 1024 && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes(':'));

export async function safePath(root, relative, mode = 'file') {
  assert(path.isAbsolute(root) && relativeSafe(relative), 'SOURCE_PATH_INVALID');
  const absolute = path.resolve(root, relative); assert(absolute.startsWith(path.resolve(root) + path.sep), 'SOURCE_PATH_ESCAPE');
  let current = path.parse(absolute).root;
  for (const element of absolute.slice(current.length).split(path.sep)) {
    current = path.join(current, element);
    try { const stat = await fs.lstat(current); assert(!stat.isSymbolicLink(), 'SOURCE_LINK_FORBIDDEN'); assert(current === absolute ? (mode === 'new' || mode === 'new-directory' ? false : mode === 'directory' ? stat.isDirectory() : stat.isFile()) : stat.isDirectory(), mode.startsWith('new') && current === absolute ? 'SOURCE_OUTPUT_EXISTS' : 'SOURCE_PATH_TYPE'); }
    catch (error) { if (error.code === 'ENOENT' && current === absolute && mode.startsWith('new')) return absolute; throw error; }
  }
  return absolute;
}
export async function writeExclusive(root, relative, value) {
  const filename = await safePath(root, relative, 'new'), bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const handle = await fs.open(filename, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  const saved = await fs.readFile(filename); assert(sha256(saved) === sha256(bytes), 'SOURCE_FILE_READBACK');
  return { path: relative, bytes: saved.length, sha256: sha256(saved) };
}

/** Fixed exec argv/stdin. Stderr is never emitted/persisted; only its size/hash are diagnostics. */
export function runCommand(command, args, { input = '', maximum = 256 * 1024, timeout = 10000, cwd = TOOL_ROOT } = {}) {
  return new Promise(resolve => {
    let child; try { child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { resolve({ exitCode: null, error: 'SOURCE_PROCESS_START', stdout: Buffer.alloc(0), stderrBytes: 0, stderrSha256: sha256('') }); return; }
    const chunks = [], errors = []; let size = 0, errorSize = 0, error = null;
    const timer = setTimeout(() => { error = 'SOURCE_PROCESS_DEADLINE'; child.kill(); }, timeout); timer.unref();
    child.stdout.on('data', raw => { size += raw.length; if (size <= maximum) chunks.push(raw); else { error = 'SOURCE_PROCESS_OUTPUT_BUDGET'; child.kill(); } });
    child.stderr.on('data', raw => { errorSize += raw.length; if (errorSize <= LIMITS.stderrBytes) errors.push(raw); else { error = 'SOURCE_PROCESS_STDERR_BUDGET'; child.kill(); } });
    child.on('error', () => { error = 'SOURCE_PROCESS_START'; }); child.stdin.on('error', () => { error ??= 'SOURCE_PROCESS_STDIN'; });
    child.on('close', (exitCode, signal) => { clearTimeout(timer); resolve({ exitCode, signal, error, stdout: Buffer.concat(chunks), stdoutBytesObserved: size, stderrBytes: errorSize, stderrSha256: sha256(Buffer.concat(errors)), stderrTruncated: errorSize > LIMITS.stderrBytes }); });
    child.stdin.end(input);
  });
}
async function inspectContainers() {
  const run = await runCommand('docker', ['inspect', '--format', METADATA_FORMAT, EXPECTED.backend.id, EXPECTED.postgres.id]);
  assert(run.exitCode === 0 && !run.error && run.stderrBytes === 0, 'SOURCE_METADATA_PROCESS');
  const rows = run.stdout.toString('utf8').trim().split(/\r?\n/).map(line => parseOutput(Buffer.from(line), 128 * 1024));
  return validateContainers(rows);
}
async function probeBackend() {
  const run = await runCommand('docker', ['exec', '-i', '--workdir', '/app', '--env', 'NODE_OPTIONS=', EXPECTED.backend.id, 'node', '--input-type=module'], { input: PROBE_PROGRAM });
  assert(run.exitCode === 0 && !run.error && run.stderrBytes === 0, 'SOURCE_ENDPOINT_PROBE_PROCESS');
  return validateProbe(parseOutput(run.stdout, 64 * 1024));
}
async function sourceIdentity() {
  const git = async args => { const run = await runCommand('git', ['-C', EXPECTED.sourceRoot, ...args]); assert(run.exitCode === 0 && !run.error, 'SOURCE_REVISION_PROCESS'); return run.stdout.toString('utf8').trim(); };
  const revision = await git(['rev-parse', 'HEAD']), branch = await git(['branch', '--show-current']), status = await git(['status', '--porcelain=v1']);
  assert(revision === EXPECTED.revision && branch === 'main' && status === '', 'SOURCE_CHECKOUT_IDENTITY');
  const files = []; for (const relative of sourceFiles) { const filename = await safePath(EXPECTED.sourceRoot, relative); files.push({ path: relative, sha256: sha256(await fs.readFile(filename)) }); }
  return { revision, branch, clean: true, files, sourceSetSha256: sha256(canonical(files)) };
}
async function inspectCurrent(ownerId) {
  const containers = await inspectContainers(); const endpoint = await probeBackend();
  const source = await sourceIdentity();
  return { schemaVersion: 'pathfinder.current-inputs.binding.v1', ownerId, recordedAt: new Date().toISOString(), containers, endpoint, source };
}
function comparableBinding(binding) { return { containers: binding.containers, endpoint: binding.endpoint, source: binding.source }; }
async function ownIdentity() {
  const files = []; for (const name of ownFiles) { const relative = 'scripts/pathfinder-current-inputs/' + name; files.push({ path: relative, sha256: sha256(await fs.readFile(path.join(TOOL_ROOT, relative))) }); }
  return { files, sourceSetSha256: sha256(canonical(files)) };
}
function compactSource(binding) {
  const { containers } = binding;
  const brief = id => { const value = containers.find(x => x.id === id); return { id: value.id, name: value.name, image: value.image, startedAt: value.startedAt }; };
  return { revision: binding.source.revision, branch: binding.source.branch, sourceSetSha256: binding.source.sourceSetSha256,
    backend: brief(EXPECTED.backend.id), postgres: brief(EXPECTED.postgres.id), binding: { route: 'Docker Desktop host published port to exact PostgreSQL container', ...EXPECTED.endpoint, dns: binding.endpoint.addresses } };
}

/** Save raw stdout durably before parsing/validating. Every gate failure gets a separate durable compact failure. */
export async function persistCapture(root, work, phase, run) {
  const raw = await writeExclusive(root, `${work}/${phase}.private.json`, run.stdout);
  const metadata = { schemaVersion: 'pathfinder.current-inputs.capture-result.v1', phase, raw, exitCode: run.exitCode, signal: run.signal ?? null, processError: run.error ?? null, stderrBytes: run.stderrBytes, stderrSha256: run.stderrSha256, status: 'FAIL' };
  try {
    const snapshot = parseOutput(run.stdout, LIMITS.outputBytes);
    if (snapshot.schemaVersion === 'pathfinder.current-inputs.source-error.v1' && snapshot.status === 'FAIL') fail(/^[A-Z0-9_]{1,80}$/.test(snapshot.code ?? '') ? snapshot.code : 'SOURCE_COPY_PROCESS');
    assert(run.exitCode === 0 && !run.error && run.stderrBytes === 0, 'SOURCE_COPY_PROCESS');
    validateSnapshot(snapshot, phase); metadata.status = 'PASS'; metadata.projection = projectionHashes(snapshot);
    await writeExclusive(root, `${work}/${phase}-capture.private.json`, metadata);
    return { snapshot, raw, metadata };
  } catch (error) {
    metadata.failure = { code: error.code ?? 'SOURCE_CAPTURE_INVALID' };
    const metadataRef = await writeExclusive(root, `${work}/${phase}-capture.private.json`, metadata);
    throw Object.assign(new Error(metadata.failure.code), { code: metadata.failure.code, capture: { raw, metadata: metadataRef } });
  }
}
export function compareProjections(captures) {
  const [before, copy, after] = captures.map(x => projectionHashes(x.snapshot)), groups = {};
  for (const key of Object.keys(before)) groups[key] = { before: before[key], copy: copy[key], after: after[key], unchanged: canonical(before[key]) === canonical(copy[key]) && canonical(copy[key]) === canonical(after[key]) };
  return { status: Object.values(groups).every(x => x.unchanged) ? 'PASS' : 'FAIL_EXTERNAL_OR_UNEXPLAINED_CHANGE', groups };
}

export async function execute({ mode, root, receipt, work, bindingPath, bindingSha256 }) {
  assert(path.resolve(root).toLowerCase() === TOOL_ROOT.toLowerCase(), 'SOURCE_ISOLATED_ROOT_REQUIRED');
  await safePath(root, receipt, 'new');
  const result = { schemaVersion: mode === 'inspect' ? 'pathfinder.current-inputs.inspection-receipt.v1' : mode === 'identity' ? 'pathfinder.current-inputs.identity-receipt.v1' : mode === 'project-identity' ? 'pathfinder.current-inputs.project-identity-receipt.v1' : 'pathfinder.current-inputs.source-receipt.v1', recordedAt: new Date().toISOString(), status: 'FAIL', privateSnapshot: null, checks: [], scope: mode === 'identity' ? 'Only SQL endpoint/read-only identity observation; no project, model, cable or other business SELECT.' : mode === 'project-identity' ? 'Only guarded target and bounded Aalborg/HPU discovery project id/number/name observation; no allowance, model, cable, customer or other business SELECT.' : 'Original project engineering-only read-only source copy; no application bootstrap/storage/business writes.', limits: LIMITS };
  let binding;
  try {
    result.tool = await ownIdentity();
    if (mode === 'inspect') {
      assert(/^pathfinder-engine\/\.scratch\/current-inputs-[a-f0-9-]{32,36}$/.test(work ?? ''), 'SOURCE_WORK_ROOT');
      const destination = await safePath(root, work, 'new-directory'); await fs.mkdir(destination, { mode: 0o700 });
      const ownerId = randomUUID(); await writeExclusive(root, work + '/owner.json', { schemaVersion: 'pathfinder.current-inputs.owner.v1', ownerId, createdAt: new Date().toISOString(), scope: 'Owned private read-only source-copy evidence. Not original app storage.' });
      binding = await inspectCurrent(ownerId); validateBinding(binding);
      result.bindingFile = await writeExclusive(root, work + '/binding.private.json', binding); result.source = compactSource(binding); result.status = 'PASS'; result.dbQueries = 'NOT_RUN';
      result.checks.push({ name: 'exact-source-containers-networks-published-port-endpoint-modules-checkout', status: 'PASS' });
    } else {
      assert(['copy', 'identity', 'project-identity'].includes(mode) && typeof bindingSha256 === 'string' && /^[a-f0-9]{64}$/.test(bindingSha256), 'SOURCE_COPY_ARGUMENTS');
      const filename = await safePath(root, bindingPath), bytes = await fs.readFile(filename);
      assert(bytes.length <= 128 * 1024 && sha256(bytes) === bindingSha256, 'SOURCE_BINDING_FILE_HASH'); binding = validateBinding(parseOutput(bytes, 128 * 1024));
      work = path.posix.dirname(bindingPath);
      assert(/^pathfinder-engine\/\.scratch\/current-inputs-[a-f0-9-]{32,36}$/.test(work) && path.posix.basename(bindingPath) === 'binding.private.json', 'SOURCE_OWNED_BINDING_PATH');
      const owner = parseOutput(await fs.readFile(await safePath(root, work + '/owner.json')), 8192); assert(owner.schemaVersion === 'pathfinder.current-inputs.owner.v1' && owner.ownerId === binding.ownerId, 'SOURCE_WORK_OWNER');
      const current = await inspectCurrent(binding.ownerId); assert(canonical(comparableBinding(current)) === canonical(comparableBinding(binding)), 'SOURCE_PRECONDITION_CHANGED'); result.source = compactSource(binding);
      result.checks.push({ name: 'source-and-endpoint-reverified-before-connection', status: 'PASS' });
      if (mode === 'identity' || mode === 'project-identity') {
        const input = mode === 'identity' ? buildIdentityProgram(binding) : buildProjectIdentityProgram(binding);
        const run = await runCommand('docker', ['exec', '-i', '--workdir', '/app', '--env', 'NODE_OPTIONS=', EXPECTED.backend.id, 'node', '--max-old-space-size=256', '--input-type=module'], { input, timeout: LIMITS.processMilliseconds, maximum: 65536 });
        result.rawIdentity = await writeExclusive(root, work + '/' + mode + '.private.json', run.stdout);
        result.process = { exitCode: run.exitCode, signal: run.signal ?? null, error: run.error ?? null, stderrBytes: run.stderrBytes, stderrSha256: run.stderrSha256 };
        assert(run.exitCode === 0 && !run.error && run.stderrBytes === 0, 'SOURCE_IDENTITY_PROCESS');
        const observation = parseOutput(run.stdout, 65536);
        if (mode === 'identity') { validateSqlIdentity(observation); result.identity = observation.identity; result.endpointGuard = 'NOT_EVALUATED: observation only; existing copy identity guard remains unchanged'; result.businessQueries = 'NOT_RUN'; }
        else { validateProjectIdentity(observation); result.projectObservation = { targetCount: observation.targetRows.length, discoveryCount: observation.discoveryRows.length, overflow: observation.discoveryOverflow }; result.endpointGuard = 'PASS: existing exact canonical SQL endpoint/read-only predicates'; result.modelCableAllowanceQueries = 'NOT_RUN'; result.projectCopyGuard = 'UNCHANGED: observation does not select another project or relax the exact project name guard'; }
        result.checks.push({ name: 'identity-only-whitelisted-observation-saved-before-assertion', status: 'PASS' }); result.status = 'PASS';
      } else {
      const captures = []; result.captures = [];
      for (const phase of ['before', 'copy', 'after']) {
        const input = buildReadProgram(binding, phase);
        const run = await runCommand('docker', ['exec', '-i', '--workdir', '/app', '--env', 'NODE_OPTIONS=', EXPECTED.backend.id, 'node', '--max-old-space-size=256', '--input-type=module'], { input, timeout: LIMITS.processMilliseconds, maximum: LIMITS.outputBytes });
        try { const capture = await persistCapture(root, work, phase, run); captures.push(capture); result.captures.push(capture.raw); }
        catch (error) { if (error.capture) { result.captures.push(error.capture.raw); result.failedCapture = error.capture; } throw error; }
      }
      // Record every raw phase and the full comparison BEFORE deciding whether an external edit occurred.
      result.preservation = compareProjections(captures); result.captures = captures.map(x => x.raw);
      const diff = await writeExclusive(root, work + '/preservation.private.json', result.preservation); result.preservationReceipt = diff;
      const afterBinding = await inspectCurrent(binding.ownerId); await writeExclusive(root, work + '/binding-after.private.json', afterBinding);
      result.sourceMetadataUnchanged = canonical(comparableBinding(afterBinding)) === canonical(comparableBinding(binding));
      assert(result.preservation.status === 'PASS', 'SOURCE_CONCURRENT_OR_UNEXPLAINED_CHANGE'); assert(result.sourceMetadataUnchanged, 'SOURCE_POSTCONDITION_CHANGED');
      result.privateSnapshot = await writeExclusive(root, work + '/current-inputs.private.json', await fs.readFile(await safePath(root, captures[1].raw.path)));
      result.checkedModelFingerprint = captures[1].snapshot.model.contentFingerprint; result.cableCount = captures[1].snapshot.cables.length;
      result.checks.push({ name: 'three-read-only-project-model-resource-cable-snapshots', status: 'PASS' }, { name: 'raw-captures-and-comparison-durable-before-assertion', status: 'PASS' }, { name: 'before-copy-after-projections-source-metadata-unchanged', status: 'PASS' }); result.status = 'PASS';
      }
    }
  } catch (error) { result.failure = { code: /^[A-Z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'SOURCE_TOOL_FAILED' }; result.checks.push({ name: 'source-copy-gate', status: 'FAIL', code: result.failure.code }); }
  result.finishedAt = new Date().toISOString();
  const bounded = Buffer.byteLength(JSON.stringify(result)) <= LIMITS.receiptBytes ? result : { schemaVersion: result.schemaVersion, recordedAt: result.recordedAt, finishedAt: result.finishedAt, status: 'FAIL', privateSnapshot: null, failure: { code: 'SOURCE_RECEIPT_BUDGET' }, tool: result.tool, captures: result.captures, bindingFile: result.bindingFile };
  const saved = await writeExclusive(root, receipt, bounded);
  if (bounded !== result) return { status: 'FAIL', receipt: saved, privateSnapshot: null, bindingFile: result.bindingFile ?? null, failure: bounded.failure };
  return { status: result.status, receipt: saved, privateSnapshot: result.privateSnapshot, bindingFile: result.bindingFile ?? null, failure: result.failure ?? null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2), input = { mode };
    assert(['inspect', 'copy', 'identity', 'project-identity'].includes(mode) && args.length % 2 === 0, 'SOURCE_ARGUMENTS');
    const names = { '--root': 'root', '--receipt': 'receipt', '--work-root': 'work', '--binding': 'bindingPath', '--binding-sha256': 'bindingSha256' };
    for (let i = 0; i < args.length; i += 2) { assert(names[args[i]] && !input[names[args[i]]] && args[i + 1], 'SOURCE_ARGUMENTS'); input[names[args[i]]] = args[i + 1]; }
    assert(input.root && input.receipt, 'SOURCE_ARGUMENTS');
    assert(mode === 'inspect' ? input.work && !input.bindingPath && !input.bindingSha256 : input.bindingPath && input.bindingSha256 && !input.work, 'SOURCE_ARGUMENTS');
    const result = await execute(input); console.log(JSON.stringify(result)); process.exitCode = result.status === 'PASS' ? 0 : 2;
  } catch (error) { console.error(JSON.stringify({ status: 'FAIL', code: /^[A-Z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'SOURCE_TOOL_FAILED' })); process.exitCode = 2; }
}
