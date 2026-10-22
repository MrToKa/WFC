// Root-only B9 operator. Importing this module performs no runtime operations.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROOT, validateState } from '../pathfinder-local/runtime-lib.mjs';
import { assertCanonicalPath, hashFile } from '../operations/archives.mjs';
import { writePrivateJson } from '../operations/docker.mjs';

export const SOURCE = Object.freeze({ owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46', project: 'wfc-pathfinder-local-0cba87606e9b',
  runtime: path.join(ROOT, 'pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600'), port: 5191 });
export const PHASES = Object.freeze(['backup', 'restore-quarantine', 'candidate-build', 'target-migration', 'target-runtime', 'update-source', 'source-runtime', 'retire-target']);
const SELF = fileURLToPath(import.meta.url), SCRATCH = path.join(ROOT, 'pathfinder-engine/.scratch');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$(?![\s\S])/, SHA = /^[a-f0-9]{64}$(?![\s\S])/;
const IMAGE = /^sha256:[a-f0-9]{64}$(?![\s\S])/;
export const need = (value, code) => { if (!value) throw Object.assign(Error(code), { code }); };
export const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
export const same = (left, right) => canonical(left) === canonical(right);
export const digest = value => createHash('sha256').update(value).digest('hex');
/** Additive optional policy binding. An absent field is the unchanged B9 mode;
 * a present malformed/unknown binding never falls back to that mode. */
export function assertConservationPolicy(config) {
  if (!Object.hasOwn(config, 'qualificationPolicy')) return null;
  const binding = config.qualificationPolicy;
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value'); });
  need(exact(binding, ['schemaVersion', 'selection', 'selector', 'qualifier'])
    && binding.schemaVersion === 'wfc.pf.owned-update-policy-binding.v1'
    && exact(binding.selection, ['schemaVersion', 'profile']) && binding.selection.schemaVersion === 'wfc.pf.delivery-policy-selection.v1'
    && binding.selection.profile === 'post-b9-no-ddl-conservation-v4', 'B9_CONSERVATION_POLICY_INVALID');
  need(config.directory === path.join(SCRATCH, 'barrier-delivery-' + config.operationId), 'B9_CONSERVATION_POLICY_OPERATION_REQUIRED');
  for (const [key, filename] of [['selector', 'delivery-policy-selector-v4.mjs'], ['qualifier', 'migration-conservation-v4.mjs']]) {
    const record = binding[key];
    need(exact(record, ['path', 'bytes', 'sha256']) && record.path === path.join(ROOT, 'scripts/pathfinder-barriers', filename)
      && Number.isSafeInteger(record.bytes) && record.bytes > 0 && record.bytes <= 4 * 1024 ** 2 && SHA.test(record.sha256 ?? '')
      && Array.isArray(config.sourceClosure) && config.sourceClosure.filter(row => row.path === record.path).length === 1
      && same(config.sourceClosure.find(row => row.path === record.path), record), 'B9_CONSERVATION_POLICY_CLOSURE_REQUIRED');
  }
  return binding;
}
export function assertPhasePolicyBinding(config, result) {
  const binding = assertConservationPolicy(config);
  need(binding ? Object.hasOwn(result, 'qualificationPolicy') && same(result.qualificationPolicy, binding)
    : !Object.hasOwn(result, 'qualificationPolicy'), 'B9_PHASE_POLICY_BINDING_CHANGED');
}
export function assertSource(state) {
  need(state?.owner === SOURCE.owner && state.project === SOURCE.project && state.runtime === SOURCE.runtime && state.port === 5191, 'B9_EXACT_SOURCE_REQUIRED');
  return validateState(state, SOURCE.runtime);
}
export function assertOperation(config, directory) {
  need(config?.schemaVersion === 'wfc.pf.owned-update.v3' && UUID.test(config.operationId ?? '') && same(config.source, SOURCE)
    && config.directory === path.resolve(directory) && path.dirname(config.directory) === SCRATCH
    && ['barrier-delivery-' + config.operationId, 'barrier-delivery-20261021-' + config.operationId].includes(path.basename(config.directory))
    && config.targetRuntime === path.join(config.directory, 'restore-5192') && config.backup === path.join(config.directory, 'backup')
    && config.companion === path.join(config.directory, 'backup-companion.private.json')
    && SHA.test(config.operatorSha256 ?? '') && Array.isArray(config.sourceClosure) && config.sourceClosure.length > 0, 'B9_OPERATION_INVALID');
  assertConservationPolicy(config); return config;
}
export function assertTarget(config, state) {
  assertOperation(config, config.directory);
  need(state?.runtime === config.targetRuntime && state.runtime !== SOURCE.runtime && state.port === 5192 && UUID.test(state.owner ?? '')
    && state.owner !== SOURCE.owner && state.project !== SOURCE.project && state.project !== 'wfc-pathfinder-local', 'B9_PROTECTED_TARGET_REFUSED');
  return validateState(state, state.runtime);
}
export function assertCandidate(value) {
  need(value && Object.keys(value).sort().join() === 'api,web' && IMAGE.test(value.api) && IMAGE.test(value.web), 'B9_CANDIDATE_REQUIRED'); return value;
}
export function assertTransition(phase, passes, attempted) {
  const index = PHASES.indexOf(phase); need(index >= 0, 'B9_PHASE_INVALID');
  need(!attempted, 'B9_PHASE_ALREADY_BEGUN_INSPECT_REQUIRED');
  need(['init', ...PHASES.slice(0, index)].every(name => passes[name]?.status === 'PASS'), 'B9_PREREQUISITE_REQUIRED');
  if (index > PHASES.indexOf('candidate-build')) assertCandidate(passes['candidate-build'].result.candidate);
  for (const gate of ['target-migration', 'target-runtime']) if (index > PHASES.indexOf(gate))
    need(same(passes[gate].result.candidate, passes['candidate-build'].result.candidate), 'B9_QUALIFIED_CANDIDATE_CHANGED');
}
export async function pin(filename) {
  await assertCanonicalPath(filename); const stat = await fs.lstat(filename);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'B9_PIN_REGULAR_FILE_REQUIRED');
  return { path: filename, ...await hashFile(filename) };
}
async function exists(filename) { return fs.lstat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }); }
async function readJson(filename) {
  const record = await pin(filename); need(record.bytes <= 32 * 1024 ** 2, 'B9_PRIVATE_RECORD_LIMIT');
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}
async function verifyPins(records) {
  need(Array.isArray(records) && records.length <= 128, 'B9_PINS_INVALID');
  for (const record of records) need(same(await pin(record.path), record), 'B9_PIN_CHANGED');
}
async function load(directory) {
  await assertCanonicalPath(directory, { directory: true });
  const config = assertOperation(await readJson(path.join(directory, 'operation.private.json')), directory);
  need((await fs.readFile(path.join(directory, 'operation.sha256'), 'utf8')).trim() === (await pin(path.join(directory, 'operation.private.json'))).sha256,
    'B9_CONFIG_CHANGED');
  need((await pin(SELF)).sha256 === config.operatorSha256, 'B9_OPERATOR_CHANGED'); await verifyPins(config.sourceClosure);
  return config;
}
async function readPasses(config) {
  const result = {};
  for (const phase of ['init', ...PHASES]) {
    need(!await exists(path.join(config.directory, phase + '.failed.private.json')), 'B9_FAILED_OPERATION_INSPECT_REQUIRED');
    const filename = path.join(config.directory, phase + '.pass.private.json');
    if (!await exists(filename)) continue;
    const value = await readJson(filename);
    need(value.schemaVersion === 'wfc.pf.owned-update-phase.v3' && value.operationId === config.operationId
      && value.phase === phase && value.status === 'PASS' && value.result?.status === 'PASS', 'B9_PASS_SCOPE_INVALID');
    assertPhasePolicyBinding(config, value.result);
    await verifyPins(value.prerequisites); await verifyPins(value.result.evidence ?? []); result[phase] = value;
  }
  return result;
}
export async function claimBuildChild(config) {
  const passes = await readPasses(config);
  assertTransition('candidate-build', passes, false);
  need(!passes['candidate-build'], 'B9_BUILD_ALREADY_COMPLETE');
  const lockFile = path.join(config.directory, 'phase.lock'), beginFile = path.join(config.directory, 'candidate-build.begin.private.json');
  const lock = await readJson(lockFile), begin = await readJson(beginFile);
  need(lock.schemaVersion === 'wfc.pf.owned-update-lock.v3' && lock.operationId === config.operationId && lock.phase === 'candidate-build'
    && UUID.test(lock.nonce ?? '') && Number.isSafeInteger(lock.pid) && lock.pid > 0
    && ['schemaVersion', 'operationId', 'phase', 'nonce', 'pid'].every(key => same(begin[key], lock[key]))
    && begin.status === 'BEGIN', 'B9_BUILD_PARENT_SCOPE_CHANGED');
  const expected = await Promise.all(['init', 'backup', 'restore-quarantine'].map(name => pin(path.join(config.directory, name + '.pass.private.json'))));
  need(same(begin.prerequisites, expected), 'B9_BUILD_PREREQUISITES_CHANGED');
  // A child that dies before publishing its result remains an attempt forever.
  // The parent BEGIN alone cannot authorize another build with uncertain effects.
  await writePrivateJson(path.join(config.directory, 'candidate-build.child.begin.private.json'), {
    schemaVersion: 'wfc.pf.owned-update-child.v3', operationId: config.operationId, phase: 'candidate-build', status: 'BEGIN',
    parentLock: lock, parentBegin: await pin(beginFile), prerequisites: expected, pid: process.pid, at: new Date().toISOString() });
  need(same(await readJson(lockFile), lock), 'B9_BUILD_PARENT_SCOPE_CHANGED');
}
export async function executePhase(config, phase, runtime) {
  const passes = await readPasses(config), begin = path.join(config.directory, phase + '.begin.private.json');
  assertTransition(phase, passes, await exists(begin));
  const prerequisites = await Promise.all(['init', ...PHASES.slice(0, PHASES.indexOf(phase))].map(name => pin(path.join(config.directory, name + '.pass.private.json'))));
  const lock = { schemaVersion: 'wfc.pf.owned-update-lock.v3', operationId: config.operationId, phase, nonce: randomUUID(), pid: process.pid };
  await writePrivateJson(path.join(config.directory, 'phase.lock'), lock);
  await writePrivateJson(begin, { ...lock, status: 'BEGIN', prerequisites, at: new Date().toISOString() });
  try {
    const supplied = await runtime.execute(phase, config, passes), binding = assertConservationPolicy(config);
    need(!Object.hasOwn(supplied ?? {}, 'qualificationPolicy'), 'B9_ADAPTER_POLICY_OVERRIDE_REFUSED');
    const result = binding ? { ...supplied, qualificationPolicy: binding } : supplied;
    need(result?.status === 'PASS' && Array.isArray(result.evidence), 'B9_PHASE_RESULT_INVALID');
    await verifyPins(prerequisites); await verifyPins(config.sourceClosure); await verifyPins(result.evidence);
    if (phase === 'candidate-build') assertCandidate(result.candidate);
    if (['target-migration', 'target-runtime', 'update-source', 'source-runtime'].includes(phase))
      need(same(result.candidate, passes['candidate-build'].result.candidate), 'B9_CANDIDATE_CHANGED');
    await writePrivateJson(path.join(config.directory, phase + '.pass.private.json'), { schemaVersion: 'wfc.pf.owned-update-phase.v3',
      operationId: config.operationId, phase, status: 'PASS', prerequisites, result, at: new Date().toISOString() });
    need(same(await readJson(path.join(config.directory, 'phase.lock')), lock), 'B9_PHASE_LOCK_CHANGED');
    await fs.unlink(path.join(config.directory, 'phase.lock'));
    return { status: 'PASS', operationId: config.operationId, phase, next: PHASES[PHASES.indexOf(phase) + 1] ?? null };
  } catch (error) {
    await writePrivateJson(path.join(config.directory, phase + '.failed.private.json'), { schemaVersion: 'wfc.pf.owned-update-failure.v3',
      operationId: config.operationId, phase, status: 'FAIL', code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'B9_PHASE_FAILED',
      uncertain: true, automaticRetry: false, at: new Date().toISOString() }); throw error;
  }
}
export async function main(argv, suppliedRuntime) {
  const [phase, ...args] = argv, options = {};
  need(args.length % 2 === 0, 'B9_ARGUMENTS');
  for (let index = 0; index < args.length; index += 2) {
    need(['--operation', '--qualified-inventory', '--inventory-sha', '--conservation-policy'].includes(args[index]) && !Object.hasOwn(options, args[index]), 'B9_ARGUMENTS');
    options[args[index]] = args[index + 1];
  }
  need(typeof options['--operation'] === 'string' && path.isAbsolute(options['--operation']), 'B9_EXPLICIT_OPERATION_REQUIRED');
  const directory = path.resolve(options['--operation']);
  if (phase !== 'init') need(Object.keys(options).length === 1, 'B9_ARGUMENTS');
  if (Object.hasOwn(options, '--conservation-policy')) need(options['--conservation-policy'] === 'post-b9-no-ddl-conservation-v4', 'B9_CONSERVATION_POLICY_INVALID');
  const runtime = suppliedRuntime ?? (await import('./owned-update-v3-runtime.mjs')).createConcreteRuntime();
  if (phase === 'init') return await runtime.initialize(directory, options['--qualified-inventory'], options['--inventory-sha'],
    ...(Object.hasOwn(options, '--conservation-policy') ? [options['--conservation-policy']] : []));
  const config = await load(directory);
  if (phase === '__candidate-build') return await runtime.buildChild(config);
  if (phase === 'status') { const passes = await readPasses(config); return { status: 'READ_ONLY', operationId: config.operationId,
    phases: await Promise.all(PHASES.map(async name => ({ phase: name, passed: Boolean(passes[name]), attempted: await exists(path.join(directory, name + '.begin.private.json')) }))) }; }
  return await executePhase(config, phase, runtime);
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).then(value => process.stdout.write(JSON.stringify(value) + '\n'),
  error => { process.stderr.write(JSON.stringify({ status: 'FAIL', code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'B9_OPERATOR_FAILED', inspectRequired: true }) + '\n'); process.exitCode = 1; });
