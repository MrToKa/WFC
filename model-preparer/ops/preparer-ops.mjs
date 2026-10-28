import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOTS, MODES, SHA, UUID, boundedRead, canonical, digest, exact, fail, hashFile, inside, noLinks, parseJson, secureDirectory, writeExclusive } from './common.mjs';
import { publishManifest, verifyBackup } from './manifest.mjs';
import { inspectImageArchive } from './image-archive.mjs';
import { assertStoppedExclusive, checkPlatform, containerFacts, docker, helper, imageFacts, readiness, requireFreePort, sameRoots } from './docker.mjs';

const operatorRoot = path.dirname(import.meta.filename), sourceRoot = path.dirname(operatorRoot);
const TOOL_FILES = ['common.mjs', 'manifest.mjs', 'state.mjs', 'image-archive.mjs', 'container.mjs', 'docker.mjs', 'preparer-ops.mjs'];
const PATH_FLAGS = ['--destination-root', '--backup', '--target-root', '--target'];
const help = `Preparer stopped backup / verified fresh restore — Node24, offline Docker IDs
inventory --container NAME_OR_ID
backup --container NAME_OR_ID --destination-root NEW_PRIVATE_PARENT [--stop]
verify --backup BACKUP_DIRECTORY
restore --backup BACKUP_DIRECTORY --target-root NEW_PRIVATE_DIRECTORY [--port 18093]
start --target PRIVATE_TARGET [--expose-local]
stop --target PRIVATE_TARGET

Backup saves all namespaces and required references only after stopped/exclusive validation.
--stop authorizes stopping only the named source; its original state is restored in finally.
Restore stays quarantined. Start defaults network:none; --expose-local explicitly binds its
recorded new loopback port. All restored providers remain closed with no APS credentials.
No overwrite, automatic lock recovery, ledger repair, build, pull or price-proof renewal.
`;
function args(argv) {
  const result = {}, command = argv.shift(); if (!['inventory', 'backup', 'verify', 'restore', 'start', 'stop'].includes(command)) fail('INVALID_COMMAND');
  const allowed = new Set(['--container', ...PATH_FLAGS, '--port', '--stop', '--expose-local']);
  for (let n = 0; n < argv.length; n++) { const key = argv[n]; if (!allowed.has(key) || Object.hasOwn(result, key)) fail('INVALID_ARGUMENTS'); result[key] = ['--stop', '--expose-local'].includes(key) ? true : argv[++n]; if (result[key] === undefined) fail('INVALID_ARGUMENTS'); }
  for (const key of PATH_FLAGS) if (result[key] && (typeof result[key] !== 'string' || !path.isAbsolute(result[key]) || result[key] !== path.resolve(result[key]))) fail('UNSAFE_PATH');
  const byCommand = { inventory: ['--container'], backup: ['--container', '--destination-root', '--stop'], verify: ['--backup'], restore: ['--backup', '--target-root', '--port'], start: ['--target', '--expose-local'], stop: ['--target'] };
  if (Object.keys(result).some(key => !byCommand[command].includes(key))) fail('INVALID_ARGUMENTS');
  return { command, flags: result };
}
async function privateNew(file) {
  if (!file || inside(sourceRoot, file) || file.split(path.sep).some(piece => ['evidence', '.git', 'public'].includes(piece.toLowerCase()))) fail('PRIVATE_DESTINATION_REQUIRED');
  await secureDirectory(file, { create: true }); return file;
}
export async function backup({ container, destinationRoot, stop = false, dockerCommand = docker }) {
  // Trusted in-process command seam for a real stop-then-transport-error drill;
  // the CLI never accepts a command/module/function from operator input.
  if (typeof dockerCommand !== 'function') fail('INVALID_ARGUMENTS');
  const initial = await containerFacts(container), backupId = randomUUID();
  await noLinks(destinationRoot, { directory: true }); await secureDirectory(destinationRoot);
  if (inside(sourceRoot, destinationRoot) || destinationRoot.split(path.sep).some(piece => ['evidence', '.git', 'public'].includes(piece.toLowerCase()))) fail('PRIVATE_DESTINATION_REQUIRED');
  const bundle = await privateNew(path.join(destinationRoot, `preparer-${backupId}`));
  await writeExclusive(path.join(bundle, 'incomplete.json'), { schemaVersion: 1, backupId, startedAt: new Date().toISOString() });
  let stoppedByUs = false, completed = false;
  const receipt = { schemaVersion: 1, backupId, status: 'incomplete', initialRunning: initial.running, sourceContainerId: initial.id, imageId: initial.imageId, startedAt: new Date().toISOString(), serviceRestored: false };
  try {
    const image = await imageFacts(initial.imageId); await checkPlatform(image);
    if (initial.running) { if (!stop) fail('SOURCE_RUNNING'); stoppedByUs = true; receipt.stopRequested = true; await dockerCommand(['stop', '--time', '45', initial.id]); }
    const stopped = await assertStoppedExclusive(initial);
    if (stopped.exitCode !== 0 || stopped.oomKilled) fail('UNCLEAN_STOP');
    await fs.mkdir(path.join(bundle, 'operator'), { mode: 0o700 });
    const operatorFiles = [];
    for (const name of TOOL_FILES) { const destination = path.join(bundle, 'operator', name); await noLinks(path.join(operatorRoot, name)); await fs.copyFile(path.join(operatorRoot, name), destination, fs.constants.COPYFILE_EXCL); operatorFiles.push({ path: `operator/${name}`, ...await hashFile(destination) }); }
    const planned = await helper({ image: initial.imageId, operatorRoot: path.join(bundle, 'operator'), bundle, roots: initial.roots, action: 'plan', label: backupId });
    const disk = await fs.statfs(bundle), freeBytes = disk.bavail * disk.bsize, requiredBytes = Math.ceil((planned.bytes + image.size) * 1.1) + 64 * 1024 ** 2;
    receipt.diskPrerequisite = { freeBytes, requiredBytes, basis: 'All three payload roots plus referenced external bytes plus uncompressed image size, 10 percent margin and64MiB metadata.' };
    if (freeBytes < requiredBytes) fail('INSUFFICIENT_DISK_SPACE');
    const captured = await helper({ image: initial.imageId, operatorRoot: path.join(bundle, 'operator'), bundle, roots: initial.roots, action: 'capture', label: backupId });
    await assertStoppedExclusive(initial);
    await dockerCommand(['image', 'save', '--output', path.join(bundle, 'image.tar'), initial.imageId]);
    const archive = await hashFile(path.join(bundle, 'image.tar')); await inspectImageArchive(path.join(bundle, 'image.tar'), initial.imageId);
    const capture = parseJson(await fs.readFile(path.join(bundle, 'capture.json')));
    const manifest = { schemaVersion: 1, kind: 'preparer-stopped-backup', backupId, createdAt: new Date().toISOString(), container: stopped,
      image: { id: image.id, os: image.os, architecture: image.architecture, archive: { path: 'image.tar', ...archive } }, roots: capture.roots, entries: capture.entries, audit: capture.audit, operatorFiles,
      configurationPolicy: { credentials: 'Not copied. Deliver the operator configuration separately through a protected channel; restored target has no APS values.',
        signingKey: 'Exact private data blob retained; never published in evidence.', proof: 'Historical proof and referenced observations retained as provenance; never renew or enable capability.',
        sources: 'Only exact matching original NWDs needed by captured jobs are included when locally present; private captured snapshots supply the immutable job input. Unreferenced source/import catalog files are outside capture scope.' } };
    await publishManifest(bundle, manifest); const verified = await verifyBackup(bundle); completed = true;
    Object.assign(receipt, { status: 'complete', manifestSha256: verified.manifestSha256, objectCount: verified.objectCount, uniqueBytes: verified.uniqueBytes, captured });
  } finally {
    if (stoppedByUs) { try { const current = await containerFacts(initial.id); if (current.instanceId !== initial.instanceId || current.imageId !== initial.imageId || current.mode !== initial.mode || !sameRoots(current.roots, initial.roots)) fail('SOURCE_CHANGED'); if (!current.running) await dockerCommand(['start', initial.id]); receipt.restartReadiness = await readiness(initial.id, initial.mode); receipt.serviceRestored = true; } catch { receipt.serviceRestored = false; completed = false; receipt.status = 'incomplete'; } }
    else receipt.serviceRestored = !initial.running;
    receipt.completedAt = new Date().toISOString(); await writeExclusive(path.join(bundle, 'operation.json'), receipt);
    if (!completed) { try { await fs.unlink(path.join(bundle, 'complete.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    if (stoppedByUs && !receipt.serviceRestored) fail('SOURCE_RESTART_FAILED');
  }
  return { ...receipt, bundle };
}
export async function verify(bundle) { const result = await verifyBackup(bundle); const image = await inspectImageArchive(path.join(bundle, 'image.tar'), result.manifest.image.id); if (image.os !== result.manifest.image.os || image.architecture !== result.manifest.image.architecture) fail('WRONG_PLATFORM'); return { status: 'PASS', backupId: result.manifest.backupId, manifestSha256: result.manifestSha256, objectCount: result.objectCount, uniqueBytes: result.uniqueBytes, image }; }
async function readTarget(target) {
  await noLinks(target, { directory: true }); const marker = parseJson(await boundedRead(path.join(target, 'target.json')));
  exact(marker, ['schemaVersion', 'owner', 'project', 'targetRoot', 'backup', 'backupId', 'manifestSha256', 'imageId', 'mode', 'port', 'roots', 'status', 'instanceId', 'containerName']);
  if (marker.schemaVersion !== 1 || !UUID.test(marker.owner) || marker.project !== `preparer-ops-restore-${marker.owner.replaceAll('-', '').slice(0, 12)}` || marker.targetRoot !== target
    || !UUID.test(marker.backupId) || !SHA.test(marker.manifestSha256) || !/^sha256:[a-f0-9]{64}$/.test(marker.imageId) || !MODES.includes(marker.mode) || !UUID.test(marker.instanceId)
    || marker.containerName !== `${marker.project}-preparer` || !Number.isSafeInteger(marker.port) || marker.port < 1024 || marker.port > 65535) fail('FOREIGN_TARGET');
  for (const [role, root] of Object.entries(marker.roots)) {
    exact(root, ['role', 'virtualRoot', 'type', 'source']); if (root.role !== role || ROOTS[role] !== root.virtualRoot) fail('FOREIGN_TARGET');
    if (['data', 'work', 'outputs'].includes(role)) {
      if (root.type !== 'volume' || root.source !== `${marker.project}-${role}`) fail('FOREIGN_TARGET');
      const labels = parseJson(Buffer.from(await docker(['volume', 'inspect', root.source, '--format', '{{json .Labels}}'])));
      if (labels?.['com.docker.compose.project'] !== marker.project || labels?.['routings.preparer.ops.owner'] !== marker.owner) fail('FOREIGN_VOLUME');
    } else if (root.type !== 'bind' || root.source !== path.join(target, role)) fail('FOREIGN_TARGET');
  }
  if (['data', 'work', 'outputs'].some(role => !marker.roots[role])) fail('FOREIGN_TARGET');
  return marker;
}
export async function restore({ bundle, targetRoot, port = 18093 }) {
  const verified = await verifyBackup(bundle), manifest = verified.manifest;
  const archived = await inspectImageArchive(path.join(bundle, 'image.tar'), manifest.image.id);
  if (archived.os !== manifest.image.os || archived.architecture !== manifest.image.architecture) fail('WRONG_PLATFORM');
  await checkPlatform(manifest.image); await requireFreePort(port);
  if (inside(bundle, targetRoot) || inside(targetRoot, bundle)) fail('UNSAFE_PATH');
  await privateNew(targetRoot); const owner = randomUUID(), project = `preparer-ops-restore-${owner.replaceAll('-', '').slice(0, 12)}`;
  await writeExclusive(path.join(targetRoot, 'allocation.json'), { schemaVersion: 1, owner, project, backupId: manifest.backupId, targetRoot, status: 'allocating-quarantine', expectedVolumes: ['data', 'work', 'outputs'].map(role => `${project}-${role}`) });
  if ((await docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])).trim()) fail('FOREIGN_TARGET');
  await docker(['image', 'load', '--input', path.join(bundle, 'image.tar')]); const actualImage = await imageFacts(manifest.image.id);
  if (actualImage.os !== manifest.image.os || actualImage.architecture !== manifest.image.architecture) fail('WRONG_PLATFORM');
  const roots = {};
  for (const root of manifest.roots) {
    if (['data', 'work', 'outputs'].includes(root.role)) {
      const volume = `${project}-${root.role}`;
      try { await docker(['volume', 'inspect', volume, '--format', '{{.Name}}']); fail('FOREIGN_VOLUME'); } catch (error) { if (error.code !== 'COMMAND_FAILED') throw error; }
      await docker(['volume', 'create', '--label', `com.docker.compose.project=${project}`, '--label', `routings.preparer.ops.owner=${owner}`, volume]);
      roots[root.role] = { role: root.role, virtualRoot: root.virtualRoot, type: 'volume', source: volume };
    } else {
      const folder = path.join(targetRoot, root.role); await fs.mkdir(folder, { mode: 0o700 }); roots[root.role] = { role: root.role, virtualRoot: root.virtualRoot, type: 'bind', source: folder };
    }
  }
  const marker = { schemaVersion: 1, owner, project, targetRoot, backup: bundle, backupId: manifest.backupId, manifestSha256: verified.manifestSha256,
    imageId: manifest.image.id, mode: manifest.container.mode, port, roots, status: 'quarantine', instanceId: randomUUID(), containerName: `${project}-preparer` };
  await writeExclusive(path.join(targetRoot, 'target.json'), marker);
  const result = await helper({ image: manifest.image.id, operatorRoot: path.join(bundle, 'operator'), bundle, roots, action: 'restore', writable: true, label: owner });
  await writeExclusive(path.join(targetRoot, 'verified.json'), { schemaVersion: 1, owner, manifestSha256: verified.manifestSha256, result });
  return { status: 'verified-quarantine', targetRoot, project, backupId: manifest.backupId, mode: marker.mode, namespaceJobs: result.jobs, cloudCapability: 'closed', port };
}
export async function start(target, exposeLocal = false) {
  const marker = await readTarget(target), verified = parseJson(await boundedRead(path.join(target, 'verified.json')));
  if (verified.owner !== marker.owner || verified.manifestSha256 !== marker.manifestSha256) fail('UNVERIFIED_TARGET');
  const backup = await verifyBackup(marker.backup); if (backup.manifestSha256 !== marker.manifestSha256) fail('BACKUP_CORRUPT');
  const ids = (await docker(['ps', '-a', '--filter', `name=^/${marker.containerName}$`, '--format', '{{.ID}}'])).trim();
  if (ids) {
    const facts = await containerFacts(ids); if (facts.project !== marker.project || facts.owner !== marker.owner || facts.mode !== marker.mode || facts.instanceId !== marker.instanceId || facts.imageId !== marker.imageId || !sameRoots(facts.roots, marker.roots)) fail('FOREIGN_TARGET');
    const expectedPorts = exposeLocal ? { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(marker.port) }] } : {};
    if (canonical(facts.ports ?? {}) !== canonical(expectedPorts) || facts.networkMode !== (exposeLocal ? 'bridge' : 'none')) fail('TARGET_EXPOSURE_CHANGED');
    if (facts.running) return { status: 'started', containerId: facts.id, reused: true, integrityScope: 'Original verified restore plus exact current bindings; active payload full audit requires a stopped service.', readiness: await readiness(facts.id, marker.mode, { requireClosed: true }) };
  }
  const audit = await helper({ image: marker.imageId, operatorRoot: path.join(marker.backup, 'operator'), bundle: marker.backup, roots: marker.roots, action: 'audit', label: marker.owner });
  if (!ids) { if (canonical(audit.jobs) !== canonical(verified.result.jobs)) fail('RESTORE_STATE_CHANGED'); }
  else {
    for (const original of verified.result.namespaces) { const current = audit.namespaces.find(value => value.mode === original.mode); if (!current || current.coreStoreId !== original.coreStoreId || current.serviceStoreId !== original.serviceStoreId) fail('RESTORE_LINEAGE_CHANGED'); }
    for (const original of verified.result.jobs) { const current = audit.jobs.find(value => value.mode === original.mode && value.jobId === original.jobId); if (!current || current.kind !== original.kind || current.frozenDigest !== original.frozenDigest) fail('RESTORE_LINEAGE_CHANGED'); }
  }
  if (ids) { await docker(['start', ids]); return { status: 'started', containerId: ids, reused: true, readiness: await readiness(ids, marker.mode, { requireClosed: true }) }; }
  if (exposeLocal) await requireFreePort(marker.port);
  const args = ['run', '--detach', '--pull', 'never', '--name', marker.containerName, '--hostname', 'routings-preparer', '--init', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--restart', 'no',
    '--label', `com.docker.compose.project=${marker.project}`, '--label', 'com.docker.compose.service=preparer', '--label', `routings.preparer.ops.owner=${marker.owner}`,
    '--label', `routings.preparer.mode=${marker.mode}`, '--label', `routings.preparer.instance=${marker.instanceId}`,
    '--tmpfs', '/tmp:size=256m,mode=1777', '--network', exposeLocal ? 'bridge' : 'none'];
  if (exposeLocal) args.push('--publish', `127.0.0.1:${marker.port}:8080`);
  for (const root of Object.values(marker.roots)) args.push('--mount', `type=${root.type},source=${root.source},target=${root.virtualRoot}${root.type === 'bind' ? ',readonly' : ''}`);
  for (const [name, value] of Object.entries({ PREPARER_MODE: marker.mode, PREPARER_INSTANCE_ID: marker.instanceId, PREPARER_HOST: '0.0.0.0', PREPARER_PORT: '8080', PREPARER_PUBLIC_ORIGIN: `http://127.0.0.1:${marker.port}`,
    PREPARER_DATA_DIR: ROOTS.data, PREPARER_WORK_DIR: ROOTS.work, PREPARER_OUTPUT_DIR: ROOTS.outputs, PREPARER_PACKAGE_MODULE: '/opt/package/index.mjs', PREPARER_SDK_DIR: '/opt/preview/sdk',
    ...(marker.roots.imports ? { PREPARER_IMPORT_ROOT: ROOTS.imports } : {}), ...(marker.roots.sources ? { PREPARER_SOURCE_ROOT: ROOTS.sources } : {}), PREPARER_LIVE_REUSE_ONLY: 'true' })) args.push('--env', `${name}=${value}`);
  args.push(marker.imageId); const containerId = (await docker(args)).trim();
  return { status: 'started', containerId, exposedLoopback: exposeLocal, requestedNamespace: marker.mode, providerCapability: 'closed', startupAPSInputs: 0, readiness: await readiness(containerId, marker.mode, { requireClosed: true }) };
}
export async function stop(target) { const marker = await readTarget(target), facts = await containerFacts(marker.containerName); if (facts.project !== marker.project || facts.owner !== marker.owner || facts.mode !== marker.mode || facts.instanceId !== marker.instanceId || facts.imageId !== marker.imageId || !sameRoots(facts.roots, marker.roots)) fail('FOREIGN_TARGET'); if (facts.running) await docker(['stop', '--time', '45', facts.id]); const stopped = await assertStoppedExclusive(facts); return { status: 'stopped', exitCode: stopped.exitCode, volumesPreserved: true }; }
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { process.stdout.write(help); return 0; }
  try {
    if (Number(process.versions.node.split('.')[0]) !== 24) fail('NODE24_REQUIRED'); const { command, flags } = args([...argv]); let result;
    if (command === 'inventory') { const facts = await containerFacts(flags['--container']); result = { status: 'PASS', ...facts }; }
    else if (command === 'backup') result = await backup({ container: flags['--container'], destinationRoot: flags['--destination-root'], stop: Boolean(flags['--stop']) });
    else if (command === 'verify') result = await verify(flags['--backup']);
    else if (command === 'restore') result = await restore({ bundle: flags['--backup'], targetRoot: flags['--target-root'], port: Number(flags['--port'] || 18093) });
    else if (command === 'start') result = await start(flags['--target'], Boolean(flags['--expose-local']));
    else result = await stop(flags['--target']);
    process.stdout.write(`${JSON.stringify(result)}\n`); return 0;
  } catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'OPERATIONS_FAILED' })}\n`); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
