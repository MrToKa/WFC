import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
async function regular(absolute, directory = false) {
  if (!path.isAbsolute(absolute)) fail('An absolute path is required.');
  for (let current = path.resolve(absolute); ; current = path.dirname(current)) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) fail('Control paths cannot cross links.');
    if (current === path.dirname(current)) break;
  }
  const stat = await fs.stat(absolute);
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail('A regular input path is required.');
  return stat;
}
async function run(dll, manifest, work) {
  const child = spawn('dotnet', [dll, '--manifest', manifest, '--work-root', work], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = []; let stdoutBytes = 0, stderrBytes = 0, reason = null;
  const stop = why => { reason ??= why; child.kill(); };
  const timer = setTimeout(() => stop('TIMEOUT'), 20000);
  child.stdout.on('data', bytes => { stdoutBytes += bytes.length; if (stdoutBytes > 2 * 1024 ** 2) stop('OUTPUT_LIMIT'); else chunks.push(bytes); });
  child.stderr.on('data', bytes => { stderrBytes += bytes.length; if (stderrBytes > 65536) stop('STDERR_LIMIT'); });
  const exit = await new Promise(resolve => { child.once('error', () => resolve({ code: null, error: 'SPAWN_FAILED' })); child.once('close', (code, signal) => resolve({ code, signal })); });
  clearTimeout(timer);
  const output = Buffer.concat(chunks); let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output)); } catch { /* Recorded as a failed control below. */ }
  return { ...exit, reason, stdoutBytes, stderrBytes, outputSha256: hash(output),
    responseSchemaVersion: value?.schemaVersion ?? null, responseStatus: value?.status ?? null,
    responseErrorCode: value?.error?.code ?? null,
    responseMessage: typeof value?.error?.message === 'string' ? value.error.message.slice(0, 512) : null,
    rejected: !reason && exit.code === 2 && value?.schemaVersion === 'pathfinder.capacity.result.v1' && value?.status === 'FAIL' && value?.error?.code === 'INVALID_INPUT' };
}

export async function inputControls({ dll, manifest: manifestFile, workRoot }) {
  await regular(dll); await regular(manifestFile); await regular(path.dirname(workRoot), true);
  if (!path.isAbsolute(workRoot)) fail('An absolute fresh work-root is required.');
  try { await fs.lstat(workRoot); fail('Control work-root already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const originalBytes = await fs.readFile(manifestFile);
  if (originalBytes.length > 65536) fail('Source manifest exceeds the control input budget.');
  const original = JSON.parse(originalBytes); await regular(original.snapshot.path);
  const sourceStat = await fs.stat(original.snapshot.path);
  if (sourceStat.size < 1 || sourceStat.size > 256 * 1024 ** 2) fail('Copied snapshot is outside budget.');
  const bytes = await fs.readFile(original.snapshot.path);
  if (hash(bytes) !== original.snapshot.sha256) fail('Source snapshot hash does not match.');
  await fs.mkdir(workRoot); await fs.writeFile(path.join(workRoot, '.capacity-controls-owned'), randomUUID(), { flag: 'wx' });
  const snapshot = path.join(workRoot, 'copied-snapshot.json'); await fs.writeFile(snapshot, bytes, { flag: 'wx' });
  const baseline = structuredClone(original); baseline.snapshot.path = snapshot;
  const specs = [
    ['duplicate-member', value => JSON.stringify(value).replace('{', '{"label":"duplicate",')],
    ['unknown-nested-member', value => { value.request.projectSettings.unexpected = true; }],
    ['nonfinite-overflow-coordinate', value => JSON.stringify(value).replace('"from":[', '"from":[1e400,').replace(/1e400,[^,]+,/, '1e400,')],
    ['wrong-point-arity', value => { value.request.from = [0, 0]; }],
    ['snapshot-hash-mismatch', value => { value.snapshot.sha256 = '0'.repeat(64); }],
    ['snapshot-project-mismatch', value => { value.snapshot.projectId = randomUUID(); }],
    ['snapshot-content-mismatch', value => { value.snapshot.contentSha256 = '0'.repeat(64); }],
    ['snapshot-outside-input-root', value => { value.snapshot.path = original.snapshot.path; }],
    ['conflicting-project-gap', value => { value.request.connectionGap = '0.5'; value.request.options.connectionToleranceMeters = 1; }],
    ['numeric-project-decimal', value => { value.request.projectSettings.endConnectionLength = 5; }],
    ['negative-project-allowance', value => { value.request.projectSettings.endConnectionLength = '-1'; }],
    ['unknown-category', value => { value.request.category = 'Unknown'; }],
    ['graph-node-budget', value => { value.request.options.maxGraphNodes = 1000001; }],
    ['repeat-budget', value => { value.repeatQueries = 65; }],
    ['oversized-manifest', () => ' '.repeat(65537)],
    ['preexisting-work-root', () => undefined],
    ['independent-lookup-purpose', value => { value.snapshot.path = path.join(workRoot, 'lookup-purpose.json'); value.snapshot.sha256 = lookupHash; }],
  ];
  const lookup = JSON.parse(bytes);
  lookup.capture.lookupRouteCodes = ['/DFB018-1']; lookup.capture.adapterVersion = 'wfc.protected-lookup-capture.v1';
  lookup.capture.sourceKind = 'converted';
  for (const key of ['inventoryComplete', 'geometryComplete', 'unitsVerified', 'transformsVerified', 'planningVisibilityKnown', 'sourceLinkVerified']) lookup.capture[key] = false;
  for (const object of lookup.objects) {
    object.nativeHidden = null; object.planningExcluded = false; object.routeName = null; object.shapeName = null; delete object.routeBoundaryId;
    object.categoryAssignmentSource = object.geometryRole === 'routing-leaf' ? 'lookup-all-categories' : 'unassigned';
    object.allowedCategories = object.geometryRole === 'routing-leaf' ? ['MV', 'LV', 'Control'] : [];
  }
  const lookupBytes = Buffer.from(JSON.stringify(lookup)), lookupHash = hash(lookupBytes);
  await fs.writeFile(path.join(workRoot, 'lookup-purpose.json'), lookupBytes, { flag: 'wx' });
  const checks = [];
  for (const [name, mutate] of specs) {
    const value = structuredClone(baseline), serialized = mutate(value), filename = path.join(workRoot, name + '.json');
    await fs.writeFile(filename, typeof serialized === 'string' ? serialized : JSON.stringify(value), { flag: 'wx' });
    const target = path.join(workRoot, 'work-' + name);
    if (name === 'preexisting-work-root') { await fs.mkdir(target); await fs.writeFile(path.join(target, 'sentinel'), 'preserve-existing-control', { flag: 'wx' }); }
    const result = await run(dll, filename, target);
    const exists = await fs.stat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    const preserved = name === 'preexisting-work-root' ? exists && await fs.readFile(path.join(target, 'sentinel'), 'utf8') === 'preserve-existing-control' : !exists;
    const purposeGuard = name !== 'independent-lookup-purpose' || result.responseMessage?.includes('planning snapshot') === true;
    checks.push({ name, status: result.rejected && preserved && purposeGuard ? 'PASS' : 'FAIL', inputSha256: hash(await fs.readFile(filename)), preflightWorkRootPreserved: preserved, result });
  }
  const receipt = { schemaVersion: 'pathfinder.capacity.input-controls.v1', observedAtUtc: new Date().toISOString(),
    status: checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL', sourceManifestSha256: hash(originalBytes),
    snapshotSha256: hash(bytes), executableSha256: hash(await fs.readFile(dll)), checks,
    scope: 'New benchmark CLI rejection controls; not model engineering or application acceptance. Files remain below fresh owned scratch; no live runtime access.' };
  await fs.writeFile(path.join(workRoot, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), expected = ['--dll', '--manifest', '--work-root'];
  if (args.length !== 6 || args.filter((_, i) => i % 2 === 0).some((key, i) => key !== expected[i])) fail('Usage: --dll ABSOLUTE_DLL --manifest ABSOLUTE_JSON --work-root ABSOLUTE_NEW_CHILD');
  const result = await inputControls({ dll: args[1], manifest: args[3], workRoot: args[5] });
  console.log(JSON.stringify(result)); process.exitCode = result.status === 'PASS' ? 0 : 1;
}
