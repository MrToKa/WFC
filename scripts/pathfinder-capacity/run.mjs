import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDocker, publicContainer } from '../operations/docker.mjs';
import { IMAGE, UUID, sha256, canonical, parseOutput, validateManifest, validateResponse, stableContainerMetadata, assertContainer, fail } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRATCH = path.join(ROOT, 'pathfinder-engine/.scratch');
const comparePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
function contained(parent, target) { const relative = path.relative(path.resolve(parent), path.resolve(target)); return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
async function checkedPath(filename, { directory = false, parent = SCRATCH } = {}) {
  const target = path.resolve(filename); if (!contained(parent, target)) fail('CAPACITY_PATH_OUTSIDE_OWN_SCRATCH');
  const real = await fs.realpath(target); if (comparePath(real) !== comparePath(target)) fail('CAPACITY_SYMLINK_REFUSED');
  const stat = await fs.lstat(target); if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail('CAPACITY_REGULAR_PATH_REQUIRED');
  return target;
}
async function readJson(filename, maximum) { const stat = await fs.stat(filename); if (stat.size < 1 || stat.size > maximum) fail('CAPACITY_INPUT_SIZE_LIMIT'); return parseOutput(await fs.readFile(filename), maximum); }
async function readBytes(filename, maximum) { const stat = await fs.stat(filename); if (stat.size < 1 || stat.size > maximum) fail('CAPACITY_INPUT_SIZE_LIMIT'); return await fs.readFile(filename); }
async function writeNew(filename, value) { await fs.writeFile(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function args() {
  const values = {}, allowed = new Set(['--manifest', '--reference', '--bench']);
  for (let at = 2; at < process.argv.length; at += 2) { const key = process.argv[at]; if (!allowed.has(key) || values[key] || !process.argv[at + 1]) fail('CAPACITY_ARGUMENT_INVALID'); values[key] = process.argv[at + 1]; }
  if ([...allowed].some(key => !values[key])) fail('CAPACITY_ARGUMENT_REQUIRED'); return values;
}
async function sourceBinding(docker, reference) {
  const source = reference.source;
  if (!source || !IMAGE.test(source.apiImage ?? '') || !UUID.test(source.owner ?? '') || source.project !== 'wfc-pathfinder-local' || !/^[a-f0-9]{64}$/.test(source.apiId ?? '') || !/^[a-f0-9]{64}$/.test(source.postgresId ?? '')) fail('CAPACITY_SOURCE_BINDING_INVALID');
  const api = await docker.inspect(source.apiId), postgres = await docker.inspect(source.postgresId), image = await docker.inspectImage(source.apiImage);
  for (const item of [api, postgres]) if (item.Config?.Labels?.['wfc.pathfinder.owner'] !== source.owner || item.Config?.Labels?.['wfc.pathfinder.project'] !== source.project || item.Config?.Labels?.['wfc.pathfinder.isolated'] !== 'true' || !item.State.Running) fail('CAPACITY_SOURCE_OWNERSHIP_INVALID');
  if (api.Image !== source.apiImage || image.Config?.Labels?.['wfc.pathfinder.owner'] !== source.owner || image.Config?.Labels?.['wfc.pathfinder.project'] !== source.project) fail('CAPACITY_SOURCE_IMAGE_INVALID');
  if (api.HostConfig.Memory !== 4 * 1024 ** 3 || api.HostConfig.PidsLimit !== 256) fail('CAPACITY_SOURCE_CEILING_CHANGED');
  return { api: stableContainerMetadata(publicContainer(api)), postgres: stableContainerMetadata(publicContainer(postgres)), apiResourceCeilings: { memoryBytes: api.HostConfig.Memory, pids: api.HostConfig.PidsLimit }, image: { id: image.Id, architecture: image.Architecture, os: image.Os, created: image.Created } };
}
async function main() {
  const options = args(), manifestPath = await checkedPath(options['--manifest']), referencePath = await checkedPath(options['--reference']), bench = await checkedPath(options['--bench'], { directory: true });
  const originalManifestBytes = await readBytes(manifestPath, 1024 ** 2), originalReferenceBytes = await readBytes(referencePath, 32 * 1024 ** 2);
  const manifest = validateManifest(parseOutput(originalManifestBytes, 1024 ** 2)), reference = parseOutput(originalReferenceBytes, 32 * 1024 ** 2);
  const snapshotPath = await checkedPath(manifest.snapshot.path, { parent: path.dirname(manifestPath) }), snapshotStat = await fs.stat(snapshotPath);
  if (snapshotStat.size < 1 || snapshotStat.size > 256 * 1024 ** 2 || reference.snapshotSha256 !== manifest.snapshot.sha256 || reference.assertions?.referenceIsCurrent !== true || reference.assertions?.fromToBindingsExact !== true || reference.assertions?.engineeringAccepted !== false || reference.assertions?.applyPerformed !== false) fail('CAPACITY_REFERENCE_INVALID');
  const deps = reference.reference?.dependencies, currentSettings = manifest.request.projectSettings;
  if (!deps || deps.projectId !== manifest.snapshot.projectId || deps.modelVersionId !== manifest.snapshot.modelVersionId || deps.snapshotSha256 !== manifest.snapshot.sha256 || deps.contentFingerprint !== manifest.snapshot.contentSha256 || deps.input?.reverse !== false || deps.input?.category !== manifest.request.category || canonical(deps.from?.point) !== canonical(manifest.request.from) || canonical(deps.to?.point) !== canonical(manifest.request.to) || canonical(deps.options) !== canonical(manifest.request.options) || canonical(deps.settings) !== canonical({ ...currentSettings, connectionGap: manifest.request.connectionGap })) fail('CAPACITY_REFERENCE_DEPENDENCY_MISMATCH');
  validateResponse(reference.reference.result, { requestId: reference.reference.result?.requestId });
  const snapshotBytes = await fs.readFile(snapshotPath); if (sha256(snapshotBytes) !== manifest.snapshot.sha256) fail('CAPACITY_SNAPSHOT_HASH_CHANGED');
  const files = await fs.readdir(bench, { withFileTypes: true }); let benchBytes = 0; const benchHashes = [], omittedAppHosts = [];
  if (!files.length || files.length > 128) fail('CAPACITY_PUBLISH_LIMIT');
  for (const file of files) { if (!file.isFile() || !/\.(dll|json|pdb)$/.test(file.name) && file.name !== 'PathFinder.CapacityBench.exe') fail('CAPACITY_PUBLISH_CONTENT_REFUSED'); const absolute = await checkedPath(path.join(bench, file.name)), stat = await fs.stat(absolute); benchBytes += stat.size; if (stat.size < 1 || benchBytes > 64 * 1024 ** 2) fail('CAPACITY_PUBLISH_LIMIT'); const bytes = await fs.readFile(absolute), descriptor = { file: file.name, bytes: bytes.length, sha256: sha256(bytes) }; if (file.name.endsWith('.exe')) omittedAppHosts.push(descriptor); else benchHashes.push(descriptor); }
  if (benchBytes > 64 * 1024 ** 2 || !files.some(file => file.name === 'PathFinder.CapacityBench.dll')) fail('CAPACITY_PUBLISH_LIMIT');
  const docker = await createDocker(), sourceBefore = await sourceBinding(docker, reference), owner = randomUUID(), token = owner.replaceAll('-', '').slice(0, 12), project = 'wfc-pathfinder-local-' + token;
  const scratch = path.join(SCRATCH, 'capacity-run-' + owner); await fs.mkdir(scratch); await writeNew(path.join(scratch, 'capacity-owner.json'), { format: 'WFC-PF-CAPACITY', owner, project, createdAt: new Date().toISOString(), root: ROOT, scratch });
  const input = path.join(scratch, 'input'), tools = path.join(scratch, 'tools'), work = path.join(scratch, 'work'), benchCopy = path.join(scratch, 'bench'); await Promise.all([fs.mkdir(input), fs.mkdir(tools), fs.mkdir(work), fs.mkdir(benchCopy)]); await fs.mkdir(path.join(input, 'snapshots'));
  for (const item of benchHashes) { const target = path.join(benchCopy, item.file); await fs.copyFile(path.join(bench, item.file), target, constants.COPYFILE_EXCL); if (sha256(await fs.readFile(target)) !== item.sha256) fail('CAPACITY_BENCH_COPY_CHANGED'); }
  const copiedSnapshot = path.join(input, 'snapshots', path.basename(snapshotPath)); await fs.copyFile(snapshotPath, copiedSnapshot, constants.COPYFILE_EXCL);
  if (sha256(await fs.readFile(copiedSnapshot)) !== manifest.snapshot.sha256 || sha256(await fs.readFile(snapshotPath)) !== manifest.snapshot.sha256) fail('CAPACITY_COPY_HASH_CHANGED');
  const containerManifest = structuredClone(manifest); containerManifest.snapshot.path = '/input/snapshots/' + path.basename(snapshotPath);
  await writeNew(path.join(input, 'manifest.json'), containerManifest); await writeNew(path.join(input, 'reference.json'), reference.reference.result);
  await writeNew(path.join(input, 'control.json'), { schemaVersion: 'pathfinder.capacity.container.v1', manifest: '/input/manifest.json', reference: '/input/reference.json', wholeRunTimeoutMilliseconds: 600000, productionWarmQueries: 2 });
  for (const name of ['lib.mjs', 'process.mjs', 'sampler.mjs']) await fs.copyFile(path.join(ROOT, 'scripts/pathfinder-capacity', name), path.join(tools, name), constants.COPYFILE_EXCL);
  const mounts = [{ Type: 'bind', Source: input, Target: '/input', ReadOnly: true }, { Type: 'bind', Source: benchCopy, Target: '/bench', ReadOnly: true }, { Type: 'bind', Source: tools, Target: '/tools', ReadOnly: true }, { Type: 'bind', Source: work, Target: '/work', ReadOnly: false }];
  const name = 'wfc-pf-capacity-' + token, config = { Image: sourceBefore.image.id, User: '1000:1000', WorkingDir: '/work', Entrypoint: ['node', '/tools/sampler.mjs'], Cmd: ['/input/control.json'], Env: ['NODE_OPTIONS=--max-old-space-size=256', 'HOME=/tmp', 'TMPDIR=/tmp', 'DOTNET_CLI_HOME=/tmp/dotnet', 'DOTNET_CLI_TELEMETRY_OPTOUT=1', 'DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1'], Labels: { 'wfc.pathfinder.owner': owner, 'wfc.pathfinder.project': project, 'wfc.pathfinder.isolated': 'true', 'wfc.pathfinder.capacity': 'true' }, HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Mounts: mounts, Memory: 4 * 1024 ** 3, MemorySwap: 4 * 1024 ** 3, PidsLimit: 256, NanoCpus: 2e9, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], Init: true, Tmpfs: { '/tmp': 'rw,nosuid,nodev,noexec,size=67108864,mode=1777' } } };
  const receipt = { schemaVersion: 'pathfinder.capacity.orchestration.v1', startedAt: new Date().toISOString(), owner, project, scratch, sourceBefore, input: { manifestSha256: sha256(originalManifestBytes), referenceSha256: sha256(originalReferenceBytes), snapshotSha256: manifest.snapshot.sha256, snapshotBytes: snapshotStat.size }, bench: { sourcePath: bench, path: benchCopy, files: benchHashes, omittedWindowsAppHosts: omittedAppHosts }, image: sourceBefore.image, resourceCeilings: { memoryBytes: 4 * 1024 ** 3, pids: 256, cpuCount: 2, network: 'none', readonlyRoot: true, wholeContainerDeadlineMilliseconds: 660000 }, status: 'FAIL', cleanup: { status: 'NOT_RUN' } };
  let expected, timer, externallyTimedOut = false, interrupted = false, interruptReject;
  const interrupt = () => { interrupted = true; interruptReject?.(Object.assign(new Error('CAPACITY_INTERRUPTED'), { code: 'CAPACITY_INTERRUPTED' })); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const interruption = new Promise((_, reject) => { interruptReject = reject; }); interruption.catch(() => undefined);
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { externallyTimedOut = true; reject(Object.assign(new Error('CAPACITY_WHOLE_CONTAINER_DEADLINE'), { code: 'CAPACITY_WHOLE_CONTAINER_DEADLINE' })); }, 660000); }); deadline.catch(() => undefined);
  try {
    const created = await docker.create(name, config); expected = { id: created.Id, name, image: config.Image, owner, project, mounts };
    assertContainer(await docker.inspect(created.Id), expected); receipt.container = { ...expected, mounts: mounts.map(m => ({ ...m })) };
    if (externallyTimedOut || interrupted) fail(externallyTimedOut ? 'CAPACITY_WHOLE_CONTAINER_DEADLINE' : 'CAPACITY_INTERRUPTED');
    await docker.start(created.Id);
    const exited = await Promise.race([docker.wait(created.Id), deadline, interruption]); clearTimeout(timer);
    const finished = assertContainer(await docker.inspect(created.Id), expected); receipt.exit = { code: exited.StatusCode, oomKilled: finished.State.OOMKilled, error: finished.State.Error ? 'CONTAINER_STATE_ERROR' : null };
    const resultPath = await checkedPath(path.join(work, 'result.json'), { parent: scratch }), result = await readJson(resultPath, 16 * 1024 ** 2);
    if (result.schemaVersion !== 'pathfinder.capacity.measurements.v1' || !['PASS', 'PARTIAL', 'FAIL'].includes(result.status)) fail('CAPACITY_RESULT_SCHEMA_INVALID');
    receipt.measurements = { path: resultPath, sha256: sha256(await fs.readFile(resultPath)), status: result.status, benchmark: result.benchmark?.status, productionDatasets: result.production?.length ?? 0 };
    receipt.status = exited.StatusCode === 0 && !finished.State.OOMKilled ? result.status : 'FAIL';
  } catch (error) { receipt.error = error.code ?? 'CAPACITY_ORCHESTRATION_FAILED'; receipt.status = 'FAIL'; }
  finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    if (expected) {
      try {
        let actual = assertContainer(await docker.inspect(expected.id), expected);
        if (actual.State.Running) { await docker.request('POST', '/containers/' + expected.id + '/kill?signal=KILL'); await docker.wait(expected.id); actual = assertContainer(await docker.inspect(expected.id), expected); }
        await docker.remove(expected.id);
        const remaining = await docker.inspect(expected.id).catch(() => null); if (remaining) fail('CAPACITY_CONTAINER_REMAINS');
        receipt.cleanup = { status: 'PASS', containerId: expected.id, containerAbsent: true, externalDeadlineFired: externallyTimedOut, interrupted, volumesCreated: 0, networksCreated: 0, imagesCreated: 0, filesDeleted: 0 };
      } catch (error) { receipt.cleanup = { status: 'FAIL', code: error.code ?? 'CAPACITY_RETIREMENT_FAILED' }; receipt.status = 'FAIL'; }
    }
    try {
      receipt.sourceAfter = await sourceBinding(docker, reference); receipt.sourceBindingsUnchanged = canonical(receipt.sourceAfter) === canonical(sourceBefore);
      receipt.inputsUnchanged = sha256(await fs.readFile(manifestPath)) === receipt.input.manifestSha256 && sha256(await fs.readFile(referencePath)) === receipt.input.referenceSha256 && sha256(await fs.readFile(snapshotPath)) === receipt.input.snapshotSha256;
      receipt.publishedBenchUnchanged = (await Promise.all([...benchHashes, ...omittedAppHosts].map(async item => sha256(await fs.readFile(path.join(bench, item.file))) === item.sha256))).every(Boolean);
      if (!receipt.sourceBindingsUnchanged || !receipt.inputsUnchanged || !receipt.publishedBenchUnchanged) { receipt.status = 'FAIL'; receipt.preservationFailure = true; }
    } catch (error) { receipt.status = 'FAIL'; receipt.preservationCheckError = error.code ?? 'CAPACITY_PRESERVATION_CHECK_FAILED'; }
    receipt.finishedAt = new Date().toISOString(); await writeNew(path.join(scratch, 'orchestration.json'), receipt);
  }
  console.log(JSON.stringify({ status: receipt.status, scratch, receipt: path.join(scratch, 'orchestration.json'), measurements: receipt.measurements, cleanup: receipt.cleanup, error: receipt.error })); process.exitCode = receipt.status === 'FAIL' ? 1 : 0;
}
main().catch(error => { console.error(JSON.stringify({ status: 'FAIL', code: error.code ?? 'CAPACITY_SETUP_FAILED' })); process.exitCode = 1; });
