import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { sha256, parseOutput, fail, validateCorpus } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SCRATCH = path.join(ROOT, 'pathfinder-engine/.scratch');
const command = promisify(execFile), options = {};
for (let i = 2; i < process.argv.length; i += 2) { const key = process.argv[i]; if (!['--runner', '--fixture', '--real','--deadline'].includes(key) || options[key] || !process.argv[i + 1]) fail('SESSION_PREPARE_ARGUMENT'); options[key] = path.resolve(process.argv[i + 1]); }
if (!options['--runner'] || !options['--fixture'] || !options['--real']) fail('SESSION_PREPARE_ARGUMENT');
async function checked(filename, directory = false) {
  const target = path.resolve(filename), relative = path.relative(SCRATCH, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || (await fs.realpath(target)).toLowerCase() !== target.toLowerCase()) fail('SESSION_INPUT_PATH');
  const stat = await fs.lstat(target); if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) fail('SESSION_INPUT_REGULAR'); return target;
}
async function json(filename, maximum = 32 * 1024 ** 2) { const bytes = await fs.readFile(await checked(filename)); return parseOutput(bytes, maximum); }
async function write(filename, value) { await fs.writeFile(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
const root = path.join(SCRATCH, 'session-qualification-' + randomUUID()); await fs.mkdir(root);
await write(path.join(root, 'owner.json'), { format: 'WFC-PF-SESSION-QUALIFICATION', root, repository: ROOT, createdAt: new Date().toISOString() });
const bundle = path.join(root, 'bundle'); await fs.mkdir(bundle);
const receipt = { schemaVersion: 'pathfinder.session.bundle.v1', root, bundle, createdAt: new Date().toISOString(), files: [], omittedAppHosts: [], status: 'FAIL' };
try {
  const cliEnv = { ...process.env, DOTNET_CLI_HOME: path.join(root, 'sdkhome'), DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
  const types = await command(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', path.join(ROOT, 'server/tsconfig.json'), '--outDir', path.join(bundle, 'server')], { cwd: ROOT, env: cliEnv, windowsHide: true, timeout: 120000, maxBuffer: 1024 ** 2 });
  receipt.types = { status: 'PASS', stdoutBytes: Buffer.byteLength(types.stdout), stderrBytes: Buffer.byteLength(types.stderr) };
  const runner = await checked(options['--runner'], true), fixture = await checked(options['--fixture'], true), real = await checked(options['--real'], true);
  for (const [source, destination] of [[runner, 'runner'], [fixture, 'fixture'], ...(options['--deadline']?[[await checked(options['--deadline'],true),'deadline']]:[])]) {
    await fs.mkdir(path.join(bundle, destination));
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(dll|json|pdb|exe)$/.test(entry.name)) fail('SESSION_PUBLISH_FILE');
      const bytes = await fs.readFile(await checked(path.join(source, entry.name))), descriptor = { source: path.join(source, entry.name), file: destination + '/' + entry.name, bytes: bytes.length, sha256: sha256(bytes) };
      if (entry.name.endsWith('.exe')) receipt.omittedAppHosts.push(descriptor);
      else { await fs.writeFile(path.join(bundle, destination, entry.name), bytes, { flag: 'wx' }); receipt.files.push(descriptor); }
    }
  }
  await command('dotnet', [path.join(runner, 'PathFinder.RunnerSession.Tests.dll'), '--emit-corpus', path.join(bundle, 'input')], { env: cliEnv, windowsHide: true, timeout: 30000, maxBuffer: 1024 ** 2 });
  const corpus = validateCorpus(await json(path.join(bundle, 'input/manifest.json'))); receipt.corpusCases = corpus.cases.length;
  const manifest = await json(path.join(real, 'input/manifest.json')), reference = await json(path.join(real, 'reference.private.json'));
  if (reference.assertions?.referenceIsCurrent !== true || reference.assertions?.fromToBindingsExact !== true || reference.assertions?.applyPerformed !== false || reference.snapshotSha256 !== manifest.snapshot.sha256) fail('SESSION_REAL_REFERENCE');
  const snapshot = await fs.readFile(await checked(manifest.snapshot.path)); if (sha256(snapshot) !== manifest.snapshot.sha256) fail('SESSION_REAL_SNAPSHOT_HASH');
  const request = { schemaVersion: 'pathfinder.model.runner.v1', requestId: randomUUID(), operation: 'calculate', projectId: manifest.snapshot.projectId, modelVersionId: manifest.snapshot.modelVersionId, snapshotId: path.basename(manifest.snapshot.path, '.json'), snapshotSha256: manifest.snapshot.sha256, timeoutMilliseconds: 30000, category: manifest.request.category, from: Object.fromEntries(['x','y','z'].map((key,i) => [key,manifest.request.from[i]])), to: Object.fromEntries(['x','y','z'].map((key,i) => [key,manifest.request.to[i]])), options: manifest.request.options, projectSettings: manifest.request.projectSettings };
  await fs.mkdir(path.join(bundle, 'real')); await fs.writeFile(path.join(bundle, 'real/snapshot.json'), snapshot, { flag: 'wx' });
  await write(path.join(bundle, 'real/request.json'), request); await write(path.join(bundle, 'real/reference.json'), reference.reference.result);
  await write(path.join(bundle, 'source.json'), { source: reference.source, manifestSha256: sha256(await fs.readFile(path.join(real, 'input/manifest.json'))), referenceSha256: sha256(await fs.readFile(path.join(real, 'reference.private.json'))), snapshotSha256: manifest.snapshot.sha256 });
  for (const [folder, names] of [['pathfinder-session', ['lib.mjs','qualify.mjs']], ['pathfinder-capacity', ['lib.mjs']]]) {
    await fs.mkdir(path.join(bundle, 'scripts', folder), { recursive: true });
    for (const name of names) await fs.copyFile(path.join(ROOT, 'scripts', folder, name), path.join(bundle, 'scripts', folder, name));
  }
  async function walk(directory, relative = '') { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const rel = relative ? relative + '/' + entry.name : entry.name, absolute = path.join(directory, entry.name); if (entry.isDirectory()) await walk(absolute, rel); else if (entry.isFile()) { const bytes = await fs.readFile(absolute); receipt.files.push({ file: rel, sha256: sha256(bytes), bytes: bytes.length }); } else fail('SESSION_BUNDLE_REGULAR'); } }
  await walk(bundle); receipt.status = 'PASS';
} catch (error) { receipt.error = error.code ?? 'SESSION_PREPARE_FAILED'; }
await write(path.join(root, 'prepare.json'), receipt);
console.log(JSON.stringify({ status: receipt.status, root, bundle, error: receipt.error })); process.exitCode = receipt.status === 'PASS' ? 0 : 1;
