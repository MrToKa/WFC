import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ROOT, load, contained } from '../pathfinder-local/runtime-lib.mjs';
import { assertCanonicalPath } from '../operations/archives.mjs';
import { EXPECTED, LIMITS, fail, sha256, canonical, parseOutput, verifySeedInput, createSeedPlan, validateSeedPlan, validateSeedTarget, buildSeedProgram } from './seed-lib.mjs';

const SCRATCH = path.join(ROOT, 'pathfinder-engine/.scratch');
const EVIDENCE = path.join(ROOT, 'docs/pathfinder/evidence/copied-project');
const receipt = { schemaVersion: 'pathfinder.copied-project.seed-receipt.v1', status: 'FAIL', recordedAt: new Date().toISOString() };
let work, run, sequence = 0;
const requireThat = (ok, code) => { if (!ok) fail(code); };
const reference = (file, bytes) => ({ path: path.relative(ROOT, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes) });
async function readBounded(file, max) {
  await assertCanonicalPath(file); const stat = await fs.stat(file); requireThat(stat.size > 0 && stat.size <= max, 'SEED_FILE_BUDGET');
  const bytes = await fs.readFile(file); requireThat(bytes.length === stat.size, 'SEED_FILE_CHANGED'); return bytes;
}
async function writePrivate(file, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); return reference(file, bytes);
}
async function command(args, { input, maximum = 1024 ** 2, timeout = 10000 } = {}) {
  const result = await new Promise(resolve => {
    let child, done = false, stdout = [], stderr = [], outBytes = 0, errBytes = 0, timedOut = false, overflow = false, stdinError = false, spawnError = false;
    const finish = (code, signal) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, signal, timedOut, overflow, stdinError, spawnError, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }); };
    const timer = setTimeout(() => { timedOut = true; child?.kill('SIGKILL'); }, timeout);
    try { child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { spawnError = true; finish(null, null); return; }
    child.on('error', () => { spawnError = true; });
    child.stdin.on('error', () => { stdinError = true; });
    child.stdout.on('data', bytes => { const keep = Math.min(bytes.length, Math.max(0, maximum - outBytes)); if (keep) stdout.push(bytes.subarray(0, keep)); outBytes += bytes.length; if (outBytes > maximum) { overflow = true; child.kill('SIGKILL'); } });
    child.stderr.on('data', bytes => { const keep = Math.min(bytes.length, Math.max(0, LIMITS.stderrBytes - errBytes)); if (keep) stderr.push(bytes.subarray(0, keep)); errBytes += bytes.length; if (errBytes > LIMITS.stderrBytes) { overflow = true; child.kill('SIGKILL'); } });
    child.on('close', finish); child.stdin.end(input);
  });
  const prefix = String(++sequence).padStart(2, '0'), outFile = path.join(run, prefix + '-stdout.private.json'), errFile = path.join(run, prefix + '-stderr.private.txt');
  const out = await writePrivate(outFile, result.stdout), err = await writePrivate(errFile, result.stderr);
  const transport = { code: result.code, signal: result.signal, timedOut: result.timedOut, overflow: result.overflow, stdinError: result.stdinError, spawnError: result.spawnError, stdout: out, stderr: err };
  await writePrivate(path.join(run, prefix + '-transport.private.json'), transport);
  return { ...result, transport };
}
function successful(result) { return result.code === 0 && !result.timedOut && !result.overflow && !result.stdinError && !result.spawnError; }
const projection = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}},"labels":{{json .Config.Labels}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}}}';
async function inspectTarget() {
  const state = await load(path.join(ROOT, EXPECTED.runtime));
  const rows = [];
  for (const role of ['api', 'postgres', 'web']) {
    const observed = await command(['inspect', '--format', projection, EXPECTED.project + '-' + role + '-1']);
    requireThat(successful(observed), 'SEED_DOCKER_INSPECT_FAILED'); rows.push(parseOutput(observed.stdout, 1024 ** 2));
  }
  const observed = await command(['network', 'inspect', '--format', '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Labels}},"internal":{{json .Internal}},"containers":{{json .Containers}}}', EXPECTED.project + '_backend']);
  requireThat(successful(observed), 'SEED_DOCKER_NETWORK_FAILED'); const network = parseOutput(observed.stdout, 1024 ** 2);
  network.containers = Object.keys(network.containers ?? {});
  return validateSeedTarget(state, rows, network);
}
async function retainedSource() {
  return verifySeedInput(await readBounded(path.join(ROOT, EXPECTED.snapshot.path), LIMITS.inputBytes), await readBounded(path.join(ROOT, EXPECTED.receipt.path), LIMITS.receiptBytes));
}
try {
  const { values, positionals } = parseArgs({ strict: true, allowPositionals: true, options: { 'work-root': { type: 'string' }, plan: { type: 'string' }, 'plan-sha256': { type: 'string' } } });
  requireThat(positionals.length === 1 && ['plan', 'apply', 'verify'].includes(positionals[0]), 'SEED_MODE_REQUIRED');
  const mode = positionals[0]; receipt.mode = mode;
  const snapshot = await retainedSource();
  let plan, planBytes, planFile;
  if (mode === 'plan') {
    requireThat(values.plan === undefined && values['plan-sha256'] === undefined && typeof values['work-root'] === 'string' && path.isAbsolute(values['work-root']), 'SEED_PLAN_ARGUMENTS');
    work = path.resolve(values['work-root']); requireThat(contained(SCRATCH, work) && work !== SCRATCH, 'SEED_WORK_ROOT');
    await assertCanonicalPath(work, { directory: true, allowMissing: true }); await fs.mkdir(work);
    await writePrivate(path.join(work, 'owner.json'), { schemaVersion: 'pathfinder.copied-project.seed-owner.v1', owner: EXPECTED.owner, project: EXPECTED.project, work, createdAt: receipt.recordedAt });
    run = path.join(work, 'run-' + randomUUID()); await fs.mkdir(run);
    receipt.target = await inspectTarget(); plan = createSeedPlan(snapshot);
    planFile = path.join(work, 'plan.private.json'); receipt.plan = await writePrivate(planFile, plan); planBytes = await readBounded(planFile, LIMITS.planBytes);
    receipt.status = 'PLAN_READY'; receipt.operation = 'planned';
  } else {
    requireThat(values['work-root'] === undefined && typeof values.plan === 'string' && path.isAbsolute(values.plan) && /^[a-f0-9]{64}$/.test(values['plan-sha256'] ?? ''), 'SEED_EXEC_ARGUMENTS');
    planFile = path.resolve(values.plan); work = path.dirname(planFile);
    requireThat(contained(SCRATCH, work) && work !== SCRATCH && path.basename(planFile) === 'plan.private.json', 'SEED_PLAN_PATH');
    const owner = parseOutput(await readBounded(path.join(work, 'owner.json'), 4096), 4096);
    requireThat(owner.schemaVersion === 'pathfinder.copied-project.seed-owner.v1' && owner.owner === EXPECTED.owner && owner.project === EXPECTED.project && owner.work === work, 'SEED_PRIVATE_OWNER');
    planBytes = await readBounded(planFile, LIMITS.planBytes); requireThat(sha256(planBytes) === values['plan-sha256'], 'SEED_PLAN_HASH');
    plan = validateSeedPlan(parseOutput(planBytes, LIMITS.planBytes), snapshot); receipt.plan = reference(planFile, planBytes);
    run = path.join(work, 'run-' + randomUUID()); await fs.mkdir(run);
    receipt.target = await inspectTarget();
    const before = receipt.target;
    const result = await command(['exec', '-i', '--env', 'NODE_OPTIONS=', before.apiId, 'node', '--max-old-space-size=256', '--input-type=module', '-e', buildSeedProgram()],
      { input: JSON.stringify({ plan, mode, target: before }), maximum: LIMITS.outputBytes, timeout: LIMITS.hostMilliseconds });
    receipt.transport = result.transport; receipt.privateResult = result.transport.stdout;
    // Raw stdout/transport flags above are durable even when COMMIT acknowledgement was lost.
    requireThat(successful(result), 'SEED_HELPER_TRANSPORT');
    const observed = parseOutput(result.stdout, LIMITS.outputBytes);
    receipt.databaseOutcome = { status: observed.status, error: observed.error ?? null, phase: observed.phase, commitConfirmed: observed.commitConfirmed ?? false, outcome: observed.outcome ?? null };
    requireThat(observed.schemaVersion === 'pathfinder.copied-project.seed-result.v1' && observed.status === 'PASS' && observed.projectId === plan.newProject.id && observed.mode === mode && observed.commitConfirmed === true && observed.transportError === false && observed.syntheticMarker === false && canonical(observed.counts) === canonical({ projects: 1, types: 50, cables: 2140, selections: 1, pathfinderStates: 1 }) && ['created', 'already_seeded'].includes(observed.operation), 'SEED_DATABASE_RESULT');
    receipt.operation = observed.operation; receipt.counts = observed.counts; receipt.syntheticMarker = false;
    receipt.verifiedProjections = Object.fromEntries(Object.entries(observed.projections).map(([key, rows]) => [key, { count: rows.length, sha256: sha256(canonical(rows)) }]));
    requireThat(canonical(await inspectTarget()) === canonical(before), 'SEED_TARGET_CHANGED');
    await retainedSource(); requireThat(sha256(await readBounded(planFile, LIMITS.planBytes)) === sha256(planBytes), 'SEED_PLAN_CHANGED');
    receipt.status = 'PASS';
  }
  receipt.projectId = plan.newProject.id; receipt.source = { snapshotSha256: EXPECTED.snapshot.sha256, receiptSha256: EXPECTED.receipt.sha256 };
  receipt.privateWorkRoot = path.relative(ROOT, work).replaceAll('\\', '/');
} catch (error) {
  receipt.status = 'FAIL'; receipt.error = /^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code ?? '') ? error.code : 'SEED_TOOL_FAILURE';
  if (work && contained(SCRATCH, work)) receipt.privateWorkRoot = path.relative(ROOT, work).replaceAll('\\', '/');
  receipt.recovery = 'Retain the private plan and raw results. After investigating an uncertain operation, use explicit verify with the same plan/hash; do not generate replacement IDs or blindly retry apply.';
}
receipt.finishedAt = new Date().toISOString();
await fs.mkdir(EVIDENCE, { recursive: true }); const file = path.join(EVIDENCE, 'seed-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.json');
const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n'); if (bytes.length > LIMITS.receiptBytes) throw Error('SEED_RECEIPT_LIMIT');
await fs.writeFile(file, bytes, { flag: 'wx' });
console.log(JSON.stringify({ status: receipt.status, file: path.relative(ROOT, file).replaceAll('\\', '/'), projectId: receipt.projectId, plan: receipt.plan, error: receipt.error }));
process.exitCode = ['PASS', 'PLAN_READY'].includes(receipt.status) ? 0 : 2;
