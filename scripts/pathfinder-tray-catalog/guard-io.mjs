import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { EXPECTED, METADATA_FORMAT, PROBE_PROGRAM, validateContainers, validateProbe, validateBinding, canonical } from '../pathfinder-current-inputs/source-lib.mjs';
import { bind as recoveryBind, SOURCE } from '../pathfinder-copied-recovery/binding.mjs';
import { validateSourceProjection } from './source-lib.mjs';

export const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const LIMITS = Object.freeze({ timeout: 45000, helperTimeout: 35000, outputBytes: 64 * 1024 ** 2, stderrBytes: 32768, inputBytes: 90 * 1024 ** 2, objectBytes: 64 * 1024 ** 2, totalBytes: 256 * 1024 ** 2, files: 512 });
export const ORIGINAL_STORAGE = Object.freeze({ id: '6ad45aea3b8f180629fd43f9be9f9ab4c6c1d99dbcda72612cb60a2b2e623705', name: '/wfc-minio', image: 'sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e', startedAt: '2026-10-17T09:48:41.528161291Z' });
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const LABEL = /^[a-z][a-z0-9-]{0,95}$/;
const handles = new WeakSet();
const demand = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => canonical(a) === canonical(b);
const json = raw => { try { return JSON.parse(raw.toString('utf8')); } catch { demand(false, 'CATALOG_IO_JSON'); } };
const safeRelative = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every(x => x && x !== '.' && x !== '..' && !x.includes(':'));

/** Refuse links, traversal and hard-linked files, including all existing ancestors. */
export async function safePath(root, relative, mode = 'file') {
  demand(path.isAbsolute(root) && safeRelative(relative) && ['file', 'directory', 'new', 'new-directory'].includes(mode), 'CATALOG_IO_PATH');
  const absolute = path.resolve(root, relative), base = path.resolve(root);
  demand(absolute.startsWith(base + path.sep), 'CATALOG_IO_ESCAPE');
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      demand(!stat.isSymbolicLink(), 'CATALOG_IO_LINK');
      if (current === absolute) {
        demand(!mode.startsWith('new'), 'CATALOG_IO_EXISTS');
        demand(mode === 'directory' ? stat.isDirectory() : stat.isFile() && stat.nlink === 1, 'CATALOG_IO_TYPE');
      } else demand(stat.isDirectory(), 'CATALOG_IO_PARENT');
    } catch (error) { if (error.code === 'ENOENT' && current === absolute && mode.startsWith('new')) return absolute; throw error; }
  }
  return absolute;
}

/** Fixed argv, no shell, bounded capture. Stderr content never leaves this process. */
export function runCommand(command, args, { input = Buffer.alloc(0), timeout = 10000, maximum = 256 * 1024, stderrMaximum = LIMITS.stderrBytes, cwd = ROOT, signal } = {}) {
  demand(typeof command === 'string' && Array.isArray(args) && args.every(x => typeof x === 'string'), 'CATALOG_IO_ARGV');
  demand(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= LIMITS.timeout && Number.isSafeInteger(maximum) && maximum >= 0 && maximum <= LIMITS.inputBytes && Number.isSafeInteger(stderrMaximum) && stderrMaximum >= 0 && stderrMaximum <= LIMITS.stderrBytes, 'CATALOG_IO_LIMIT');
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  demand(bytes.length <= LIMITS.inputBytes, 'CATALOG_IO_INPUT_BUDGET');
  return new Promise(resolve => {
    let child, error = null, outBytes = 0, errBytes = 0, settled = false;
    const chunks = [], stderrHash = createHash('sha256');
    const finish = (exitCode = null, childSignal = null) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      resolve({ exitCode, signal: childSignal, error, stdout: Buffer.concat(chunks), stdoutBytesObserved: outBytes, stderrBytes: errBytes, stderrSha256: stderrHash.digest('hex') });
    };
    let timer, killTimer;
    const stop = code => { error ??= code; child?.kill(); killTimer ??= setTimeout(() => finish(null, 'UNKNOWN'), 1000); };
    const abort = () => stop('CATALOG_IO_ABORTED');
    if (signal?.aborted) { error = 'CATALOG_IO_ABORTED'; finish(); return; }
    try { child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '' } }); }
    catch { error = 'CATALOG_IO_START'; finish(); return; }
    timer = setTimeout(() => stop('CATALOG_IO_DEADLINE'), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { if(settled)return;const remaining = Math.max(0, maximum - outBytes); if (remaining) chunks.push(chunk.subarray(0, remaining)); outBytes += chunk.length; if (outBytes > maximum) stop('CATALOG_IO_OUTPUT_BUDGET'); });
    child.stderr.on('data', chunk => { if(settled)return;errBytes += chunk.length; stderrHash.update(chunk); if (errBytes > stderrMaximum) stop('CATALOG_IO_STDERR_BUDGET'); });
    child.on('error', () => { error ??= 'CATALOG_IO_START'; });
    child.on('close', finish);
    child.stdin.on('error', () => { error ??= 'CATALOG_IO_STDIN'; });
    child.stdin.end(bytes);
  });
}
const success = run => demand(run.exitCode === 0 && !run.error && run.stderrBytes === 0, 'CATALOG_IO_PROCESS');

async function restrictiveDirectory(directory) {
  if (process.platform !== 'win32') { await fs.chmod(directory, 0o700); return; }
  const quoted = value => "'" + value.replaceAll("'", "''") + "'";
  const code = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$p=${quoted(directory)};$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow);$acl=[System.IO.Directory]::GetAccessControl($p);$acl.SetAccessRuleProtection($true,$false);foreach($r in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){$acl.RemoveAccessRuleSpecific($r)};$acl.AddAccessRule($rule);[System.IO.Directory]::SetAccessControl($p,$acl);$check=[System.IO.Directory]::GetAccessControl($p);if(-not $check.AreAccessRulesProtected){throw 'ACL'};foreach($r in $check.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($r.IdentityReference.Value -ne $sid.Value -or $r.AccessControlType -ne 'Allow'){throw 'ACL'}};'PRIVATE'`;
  const result = await runCommand('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')]);
  success(result); demand(result.stdout.toString().trim() === 'PRIVATE', 'CATALOG_IO_ACL');
}
async function verifyPrivateDirectory(directory) {
  if (process.platform !== 'win32') { const stat = await fs.stat(directory); demand((stat.mode & 0o077) === 0, 'CATALOG_IO_ACL'); return; }
  const quoted = "'" + directory.replaceAll("'", "''") + "'";
  const code = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=[System.IO.Directory]::GetAccessControl(${quoted});$rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]);if(-not $acl.AreAccessRulesProtected -or @($rules).Count -lt 1){throw 'ACL'};foreach($r in $rules){if($r.IdentityReference.Value -ne $sid.Value -or $r.AccessControlType -ne 'Allow'){throw 'ACL'}};'PRIVATE'`;
  const result = await runCommand('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')]);success(result);demand(result.stdout.toString().trim()==='PRIVATE','CATALOG_IO_ACL');
}

/** New task-owned evidence only; never opens/deletes any pre-existing work directory. */
export async function ownWork({ root = ROOT, id = randomUUID() } = {}) {
  demand(UUID.test(id), 'CATALOG_IO_OWNER');
  const relative = 'pathfinder-engine/.scratch/tray-catalog-' + id;
  const directory = await safePath(root, relative, 'new-directory');
  await fs.mkdir(directory, { mode: 0o700 }); await restrictiveDirectory(directory);
  const work = Object.freeze({ root: path.resolve(root), relative, directory, owner: id });
  await writePrivate(work, 'owner', { schemaVersion: 'wfc.pf.catalog-work.v1', owner: id, createdAt: new Date().toISOString(), private: true });
  return work;
}
/** Reopen only an already private, task-owned directory. Does not repair ACLs. */
export async function openWork(location, { root = ROOT } = {}) {
  demand(typeof location === 'string','CATALOG_IO_WORK_PATH');
  const relative = path.isAbsolute(location) ? path.relative(root,location).split(path.sep).join('/') : location;
  const match = /^pathfinder-engine\/\.scratch\/tray-catalog-([a-f0-9-]{36})$/.exec(relative);
  demand(match && UUID.test(match[1]),'CATALOG_IO_WORK_PATH');
  const directory = await safePath(root,relative,'directory');await verifyPrivateDirectory(directory);
  const work = Object.freeze({root:path.resolve(root),relative,directory,owner:match[1]});
  const marker = json(await fs.readFile(await safePath(directory,'owner.private.json')));
  demand(marker.schemaVersion==='wfc.pf.catalog-work.v1'&&marker.owner===work.owner&&marker.private===true,'CATALOG_IO_WORK_OWNER');
  return work;
}
async function assertWork(work) {
  demand(work && UUID.test(work.owner) && work.relative === 'pathfinder-engine/.scratch/tray-catalog-' + work.owner && path.resolve(work.directory) === path.resolve(work.root, work.relative), 'CATALOG_IO_WORK');
  await safePath(work.root, work.relative, 'directory');
  try { const value = json(await fs.readFile(await safePath(work.directory,'owner.private.json'))); demand(value.schemaVersion === 'wfc.pf.catalog-work.v1' && value.owner === work.owner, 'CATALOG_IO_WORK_OWNER'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; demand(!await fs.readdir(work.directory).then(x => x.length), 'CATALOG_IO_WORK_UNOWNED'); }
}
export async function writePrivate(work, label, value) {
  demand(LABEL.test(label), 'CATALOG_IO_LABEL'); await assertWork(work);
  const relative = label + '.private.json', filename = await safePath(work.directory, relative, 'new');
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  demand(bytes.length <= LIMITS.inputBytes, 'CATALOG_IO_FILE_BUDGET');
  const handle = await fs.open(filename, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  const ref = { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
  demand(sha256(await readPrivate(work, ref)) === ref.sha256, 'CATALOG_IO_READBACK');
  return ref;
}
export async function readPrivate(work, ref) {
  demand(ref && SHA.test(ref.sha256) && Number.isSafeInteger(ref.bytes) && ref.bytes >= 0 && ref.bytes <= LIMITS.inputBytes && /^[a-z][a-z0-9-]{0,95}\.private\.json$/.test(ref.path), 'CATALOG_IO_REF');
  const bytes = await fs.readFile(await safePath(work.directory, ref.path));
  demand(bytes.length === ref.bytes && sha256(bytes) === ref.sha256, 'CATALOG_IO_REF_HASH'); return bytes;
}

async function dockerContext() {
  const first = await runCommand('docker', ['context', 'show']); success(first);
  const name = first.stdout.toString().trim(); demand(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name), 'CATALOG_IO_CONTEXT_NAME');
  const probe = await runCommand('docker', ['--context', name, 'context', 'inspect', name, '--format', '{{(index .Endpoints "docker").Host}}']); success(probe);
  const endpoint = probe.stdout.toString().trim(); demand(endpoint.startsWith('npipe:////./pipe/') || endpoint.startsWith('unix://'), 'CATALOG_IO_CONTEXT_REMOTE');
  demand(!process.env.DOCKER_HOST||process.env.DOCKER_HOST===endpoint,'CATALOG_IO_CONTEXT_ENV');
  demand(!process.env.DOCKER_CONTEXT||process.env.DOCKER_CONTEXT===name,'CATALOG_IO_CONTEXT_ENV');
  return { name, endpoint };
}
async function verifyContext(context) { demand(same(await dockerContext(), context), 'CATALOG_IO_CONTEXT_CHANGED'); }
async function docker(context, args, options) { return runCommand('docker', ['--context', context.name, ...args], options); }
function sealBinding(binding) { const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))freeze(item);Object.freeze(value)}return value};const result=freeze(binding);handles.add(result);return result; }
function validBinding(binding, kind) { demand(handles.has(binding) && (!kind || binding.kind === kind), 'CATALOG_IO_BINDING_REQUIRED'); }
export function validateOperation(kind,mutating) { demand(['original','target'].includes(kind)&&typeof mutating==='boolean','CATALOG_IO_OPERATION');demand(kind!=='original'||mutating===false,'CATALOG_IO_ORIGINAL_MUTATION');return true; }
export function watchdogProgram(program, milliseconds = LIMITS.helperTimeout) {
  demand(typeof program === 'string' && Buffer.byteLength(program) <= 2 * 1024 ** 2 && Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= LIMITS.helperTimeout, 'CATALOG_IO_PROGRAM');
  // Reviewed helpers use dynamic imports, allowing this watchdog to exist before any import/input.
  return `const __wfcPfR1GuardTimer=setTimeout(()=>{process.exit(124)},${milliseconds});try{\n${program}\n}finally{clearTimeout(__wfcPfR1GuardTimer)}`;
}
/** Only this tiny fixed bootstrap is an argv value; reviewed code travels on bounded stdin. */
export function helperBootstrap(milliseconds = LIMITS.helperTimeout) {
  demand(Number.isSafeInteger(milliseconds)&&milliseconds>0&&milliseconds<=LIMITS.helperTimeout,'CATALOG_IO_LIMIT');
  return `const __wfcPfR1GuardTimer=setTimeout(()=>process.exit(124),${milliseconds});try{const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>${LIMITS.inputBytes})throw 0;chunks.push(chunk)}const packet=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!packet||Object.keys(packet).sort().join()!=='input,program'||typeof packet.program!=='string'||Buffer.byteLength(packet.program)>2097152||!packet.input||typeof packet.input!=='object'||Array.isArray(packet.input))throw 0;globalThis.__wfcPfR1Input=packet.input;const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;await new AsyncFunction(packet.program)()}catch{process.exitCode=2;process.stdout.write(JSON.stringify({status:'FAIL',code:'CATALOG_IO_HELPER_FAILED'}))}finally{delete globalThis.__wfcPfR1Input;clearTimeout(__wfcPfR1GuardTimer)}`;
}
async function helperRaw(binding, program, input, options = {}) {
  validBinding(binding); await verifyContext(binding.context);
  demand(typeof program==='string'&&Buffer.byteLength(program)<=2*1024**2,'CATALOG_IO_PROGRAM');
  const result = await docker(binding.context, ['exec', '-i', '--workdir', '/app', '--env', 'NODE_OPTIONS=', binding.containerId, 'node', '--max-old-space-size=512', '--input-type=module', '-e', helperBootstrap(options.helperTimeout ?? LIMITS.helperTimeout)], { input: Buffer.from(JSON.stringify({program,input:input??{}})), timeout: options.timeout ?? LIMITS.timeout, maximum: options.outputBytes ?? LIMITS.outputBytes, stderrMaximum: options.stderrBytes ?? LIMITS.stderrBytes, signal: options.signal });
  return result;
}
/** Raw output and sanitized transport are durable before ANY caller parsing/assertion. */
export async function runFixedHelper({ work, binding, program, input = {}, label, limits = {}, mutating = false }) {
  demand(LABEL.test(label), 'CATALOG_IO_LABEL'); validBinding(binding);validateOperation(binding.kind,mutating);await assertWork(work);
  const run = await helperRaw(binding, program, input, limits);
  const capture = await persistTransport({work,bindingKind:binding.kind,containerId:binding.containerId,program,input,label,run,mutating});
  // Context changes fail after saving potentially useful/lost-ack evidence.
  try { await verifyContext(binding.context); } catch (error) { throw Object.assign(error, { rawRef:capture.rawRef, transportRef:capture.transportRef, outcome:mutating?'UNCERTAIN':'FAIL' }); }
  return capture;
}
/** Separate durable transport boundary, also exercised with synthetic subprocess output. */
export async function persistTransport({work,bindingKind,containerId,program,input,label,run,mutating=false}) {
  demand(['original','target'].includes(bindingKind)&&/^[a-f0-9]{64}$/.test(containerId)&&Buffer.isBuffer(run?.stdout)&&LABEL.test(label),'CATALOG_IO_CAPTURE');
  const rawRef = await writePrivate(work, label + '-raw', run.stdout);
  const transport = { schemaVersion: 'wfc.pf.catalog-transport.v1', bindingKind, containerId, label, programSha256: sha256(program), inputSha256: sha256(canonical(input)), exitCode: run.exitCode, signal: run.signal, error: run.error, stdoutBytesObserved: run.stdoutBytesObserved, stderrBytes: run.stderrBytes, stderrSha256: run.stderrSha256, raw: rawRef, outcome: run.exitCode === 0 && !run.error && run.stderrBytes === 0 ? 'TRANSPORT_OK' : mutating ? 'UNCERTAIN' : 'FAIL' };
  const transportRef = await writePrivate(work, label + '-transport', transport);
  return { raw: run.stdout, rawRef, transportRef, transport };
}
export function requireTransport(capture) { demand(capture?.transport?.outcome === 'TRANSPORT_OK', capture?.transport?.outcome === 'UNCERTAIN' ? 'CATALOG_IO_UNCERTAIN' : 'CATALOG_IO_TRANSPORT'); return capture; }

const STORAGE_PROBE = `const dns=await import('node:dns/promises');const host=process.env.MINIO_ENDPOINT??'localhost',port=Number(process.env.MINIO_PORT??9000),useSSL=['1','true','yes','on'].includes((process.env.MINIO_USE_SSL??'false').trim().toLowerCase());if(!process.env.MINIO_ACCESS_KEY||!process.env.MINIO_SECRET_KEY)throw Error('STORAGE_CREDENTIALS');const addresses=await dns.lookup(host,{all:true});process.stdout.write(JSON.stringify({schemaVersion:'wfc.pf.catalog-storage-endpoint.v1',host,port,useSSL,projectBucket:process.env.MINIO_BUCKET_PROJECTS??'wfc-project-files',templateBucket:process.env.MINIO_BUCKET_TEMPLATES??'wfc-template-files',modelBucket:process.env.WFC_MODEL_BUCKET??'wfc-models',addresses:addresses.map(x=>({address:x.address,family:x.family}))}));`;
export function validateStorageProbe(probe, minio, kind) {
  demand(probe?.schemaVersion === 'wfc.pf.catalog-storage-endpoint.v1' && typeof probe.host === 'string' && probe.port === 9000 && probe.useSSL === false && Array.isArray(probe.addresses) && probe.addresses.length > 0 && probe.addresses.every(x => typeof x.address === 'string' && [4, 6].includes(x.family)), 'CATALOG_IO_STORAGE_PROBE');
  demand(['projectBucket', 'templateBucket', 'modelBucket'].every(key => /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(probe[key])) && new Set([probe.projectBucket,probe.templateBucket,probe.modelBucket]).size===3, 'CATALOG_IO_STORAGE_BUCKET');
  if (kind === 'original') {
    demand(minio?.id === ORIGINAL_STORAGE.id && minio.name === ORIGINAL_STORAGE.name && minio.image === ORIGINAL_STORAGE.image && minio.startedAt === ORIGINAL_STORAGE.startedAt && minio.running === true, 'CATALOG_IO_ORIGINAL_STORAGE');
    const published = probe.host === EXPECTED.endpoint.host && same([...probe.addresses].sort((a,b) => a.family-b.family), [{address:'192.168.65.254',family:4},{address:'fdc4:f303:9324::254',family:6}]) && minio.ports?.['9000/tcp']?.some(x => x.HostPort === '9000' && ['0.0.0.0','127.0.0.1'].includes(x.HostIp));
    const internal = Object.values(minio.networks ?? {}).some(n => n.NetworkID === EXPECTED.backend.networkId && probe.addresses.every(x => x.address === n.IPAddress));
    demand(published || internal, 'CATALOG_IO_SOURCE_STORAGE_ENDPOINT');
  } else demand(kind === 'target' && probe.host === 'minio' && probe.projectBucket === 'pf-local-project-files' && probe.templateBucket === 'pf-local-template-files' && probe.modelBucket==='pf-local-models'&& probe.addresses.every(x => x.address === minio.address), 'CATALOG_IO_TARGET_STORAGE_ENDPOINT');
  return probe;
}
async function endpointProbe(binding, program) { const result = await helperRaw(binding, program, {}, { outputBytes: 65536, helperTimeout: 7000, timeout: 10000 }); success(result); return json(result.stdout); }
async function inspectSource(context) {
  const result = await docker(context, ['inspect', '--format', METADATA_FORMAT, EXPECTED.backend.id, EXPECTED.postgres.id, ORIGINAL_STORAGE.id]); success(result);
  const all = result.stdout.toString().trim().split(/\r?\n/).map(x => json(Buffer.from(x)));
  demand(all.length === 3, 'CATALOG_IO_SOURCE_RESOURCE_COUNT'); validateContainers(all.slice(0, 2)); return all;
}
async function sourceIdentity() {
  const git = async args => { const run = await runCommand('git', ['-C', EXPECTED.sourceRoot, ...args]); success(run); return run.stdout.toString().trim(); };
  const revision = await git(['rev-parse', 'HEAD']), branch = await git(['branch', '--show-current']), status = await git(['status', '--porcelain=v1']);
  demand(revision === EXPECTED.revision && branch === 'main' && status === '', 'CATALOG_IO_ORIGINAL_CHECKOUT');
  const files = [];
  for (const relative of ['Dockerfile','package-lock.json','docker-compose.app.yml','docker-compose.yml','server/db.ts','server/config.ts','server/modelRegistry/schema.ts','server/models/cable.ts']) files.push({ path: relative, sha256: sha256(await fs.readFile(await safePath(EXPECTED.sourceRoot, relative))) });
  return { revision, branch, clean: true, files, sourceSetSha256: sha256(canonical(files)) };
}
export async function bindOriginal({ work, expectedBinding } = {}) {
  const context = await dockerContext(), containers = await inspectSource(context), source = await sourceIdentity();
  const temporary = sealBinding({ kind: 'original', context, containerId: EXPECTED.backend.id });
  const endpoint = validateProbe(await endpointProbe(temporary, PROBE_PROGRAM));
  const sourceBinding = validateBinding({ schemaVersion: 'pathfinder.current-inputs.binding.v1', ownerId: work?.owner ?? randomUUID(), recordedAt: new Date().toISOString(), containers: containers.slice(0, 2), endpoint, source });
  if (expectedBinding) { validateBinding(expectedBinding); demand(same({ containers: sourceBinding.containers, endpoint, source }, { containers: expectedBinding.containers, endpoint: expectedBinding.endpoint, source: expectedBinding.source }), 'CATALOG_IO_SOURCE_BINDING_CHANGED'); }
  const storage = validateStorageProbe(await endpointProbe(temporary, STORAGE_PROBE), containers[2], 'original');
  await verifyContext(context);
  const binding = sealBinding({ kind: 'original', context, containerId: EXPECTED.backend.id, sourceBinding, storage, storageContainer: containers[2] });
  if (work) await writePrivate(work, 'original-binding-' + randomUUID(), binding);
  return binding;
}
export async function bindTarget({ work, signal } = {}) {
  const context = await dockerContext();
  const bound = await recoveryBind({ runtime: SOURCE.runtime, kind: 'source', owner: SOURCE.owner, signal }); await verifyContext(context);
  const network = await docker(context, ['inspect', '--format', '{{json .NetworkSettings.Networks}}', bound.minio.id]); success(network);
  const minioAddress = json(network.stdout)[SOURCE.project + '_backend']?.IPAddress;
  const temporary = sealBinding({ kind: 'target', context, containerId: bound.api.id });
  const storage = validateStorageProbe(await endpointProbe(temporary, STORAGE_PROBE), { address: minioAddress }, 'target');
  const binding = sealBinding({ kind: 'target', context, containerId: bound.api.id, owner: SOURCE.owner, project: SOURCE.project, projectId: SOURCE.projectId, port: SOURCE.port, pgAddress: bound.pgAddress, serverAddress: bound.pgAddress, storage, resources: bound.resources, origin: bound.origin });
  if (work) await writePrivate(work, 'target-binding-' + randomUUID(), binding); return binding;
}

/** HTTP S3 SigV4, no SDK/application bootstrap, redirects or automatic retries. */
export function storageProgram() {
  return `const input=globalThis.__wfcPfR1Input;
const crypto=await import('node:crypto'),http=await import('node:http'),https=await import('node:https'),dns=await import('node:dns/promises');
const fail=code=>{throw Object.assign(Error(code),{safeCode:code})};const need=(ok,code)=>{if(!ok)fail(code)};
try{const endpoint=process.env.MINIO_ENDPOINT??'localhost',port=Number(process.env.MINIO_PORT??9000),ssl=['1','true','yes','on'].includes((process.env.MINIO_USE_SSL??'false').trim().toLowerCase()),projectBucket=process.env.MINIO_BUCKET_PROJECTS??'wfc-project-files',templateBucket=process.env.MINIO_BUCKET_TEMPLATES??'wfc-template-files';need(endpoint===input.endpoint.host&&port===input.endpoint.port&&ssl===input.endpoint.useSSL&&projectBucket===input.endpoint.projectBucket&&templateBucket===input.endpoint.templateBucket,'ENDPOINT_CHANGED');const addresses=await dns.lookup(endpoint,{all:true});const norm=x=>JSON.stringify(x.map(v=>({address:v.address,family:v.family})).sort((a,b)=>a.address.localeCompare(b.address)));need(norm(addresses)===norm(input.endpoint.addresses),'DNS_CHANGED');need(['HEAD','GET','PUT'].includes(input.method)&&['project','template'].includes(input.storageKind),'METHOD');need(input.kind==='target'||input.kind==='original'&&['HEAD','GET'].includes(input.method),'SOURCE_READONLY');need(typeof input.key==='string'&&input.key.length>0&&input.key.length<=4096&&!input.key.includes('\\0'),'KEY');
const bucket=input.storageKind==='project'?projectBucket:templateBucket,access=process.env.MINIO_ACCESS_KEY,secret=process.env.MINIO_SECRET_KEY;need(access&&secret,'CREDENTIALS');const body=input.method==='PUT'?Buffer.from(input.base64,'base64'):Buffer.alloc(0);need(body.length<=${LIMITS.objectBytes},'BODY_BUDGET');
const hex=x=>crypto.createHash('sha256').update(x).digest('hex'),hmac=(key,value)=>crypto.createHmac('sha256',key).update(value).digest(),enc=x=>encodeURIComponent(x).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());const uri='/'+enc(bucket)+'/'+input.key.split('/').map(enc).join('/'),now=new Date().toISOString().replace(/[:-]|\\.\\d{3}/g,''),day=now.slice(0,8),host=endpoint+':'+port;
const headers={host,'x-amz-content-sha256':hex(body),'x-amz-date':now};if(input.method==='PUT'){need(input.kind==='target'&&/^[a-f0-9-]{36}$/.test(input.owner)&&input.key.startsWith('pathfinder-tray-catalog/'+input.owner+'/'),'TARGET_KEY');need(hex(body)===input.sha256&&body.length===input.bytes,'BODY_HASH');headers['if-none-match']='*';headers['content-type']=input.contentType??'application/octet-stream';headers['x-amz-meta-wfc-pf-owner']=input.owner;headers['x-amz-meta-wfc-pf-source-sha256']=input.sha256;headers['x-amz-meta-wfc-pf-source-snapshot']=input.snapshotSha256;}
const names=Object.keys(headers).sort(),signed=names.join(';'),canonicalHeaders=names.map(k=>k+':'+String(headers[k]).trim().replace(/\\s+/g,' ')+'\\n').join(''),request=[input.method,uri,'',canonicalHeaders,signed,hex(body)].join('\\n'),scope=day+'/us-east-1/s3/aws4_request',signing=hmac(hmac(hmac(hmac('AWS4'+secret,day),'us-east-1'),'s3'),'aws4_request'),signature=crypto.createHmac('sha256',signing).update('AWS4-HMAC-SHA256\\n'+now+'\\n'+scope+'\\n'+hex(request)).digest('hex');headers.Authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+signed+', Signature='+signature;headers['Content-Length']=body.length;
const result=await new Promise((resolve,reject)=>{const req=(ssl?https:http).request({hostname:endpoint,port,path:uri,method:input.method,headers,timeout:15000},res=>{const saved=[];let bytes=0;res.on('data',c=>{bytes+=c.length;if(bytes>${LIMITS.objectBytes}){req.destroy();reject(Error('RESPONSE_BUDGET'));return}saved.push(c)});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(saved)}));res.on('error',reject)});req.on('timeout',()=>req.destroy(Error('REQUEST_TIMEOUT')));req.on('error',reject);req.end(body)});
need([200,204,404,412].includes(result.status),'HTTP_STATUS');if(input.method==='GET'){need(result.status===200,'OBJECT_MISSING');process.stdout.write(result.body)}else{process.stdout.write(JSON.stringify({status:result.status,bytes:result.status===404?null:Number(result.headers['content-length']??0),etag:result.headers.etag??null,contentType:result.headers['content-type']??null,versionId:result.headers['x-amz-version-id']??null,owner:result.headers['x-amz-meta-wfc-pf-owner']??null,sha256:result.headers['x-amz-meta-wfc-pf-source-sha256']??null,snapshotSha256:result.headers['x-amz-meta-wfc-pf-source-snapshot']??null}))}
}catch(error){process.exitCode=2;process.stdout.write(JSON.stringify({status:'FAIL',code:/^[A-Z0-9_]{1,80}$/.test(error.safeCode??'')?error.safeCode:'STORAGE_REQUEST_FAILED'}))}`;
}

/** Read-only complete current-object inventory; SDK is used only for bounded LIST. */
export function storageInventoryProgram() {
  return `const input=globalThis.__wfcPfR1Input;try{const dns=await import('node:dns/promises'),{Client}=await import('minio');const host=process.env.MINIO_ENDPOINT??'localhost',port=Number(process.env.MINIO_PORT??9000),useSSL=['1','true','yes','on'].includes((process.env.MINIO_USE_SSL??'false').trim().toLowerCase()),buckets={project:process.env.MINIO_BUCKET_PROJECTS??'wfc-project-files',template:process.env.MINIO_BUCKET_TEMPLATES??'wfc-template-files',model:process.env.WFC_MODEL_BUCKET??'wfc-models'},need=(x,c)=>{if(!x)throw Object.assign(Error(c),{safeCode:c})};need(host===input.endpoint.host&&port===input.endpoint.port&&useSSL===input.endpoint.useSSL&&Object.keys(buckets).every(k=>buckets[k]===input.endpoint[k+'Bucket']),'ENDPOINT_CHANGED');const addresses=await dns.lookup(host,{all:true}),norm=x=>JSON.stringify(x.map(v=>({address:v.address,family:v.family})).sort((a,b)=>a.address.localeCompare(b.address)));need(norm(addresses)===norm(input.endpoint.addresses),'DNS_CHANGED');need(process.env.MINIO_ACCESS_KEY&&process.env.MINIO_SECRET_KEY,'CREDENTIALS');const client=new Client({endPoint:host,port,useSSL,accessKey:process.env.MINIO_ACCESS_KEY,secretKey:process.env.MINIO_SECRET_KEY});const groups={};let total=0;for(const[k,bucket]of Object.entries(buckets)){const rows=[],stream=client.listObjectsV2(bucket,'',true);try{for await(const value of stream){need(typeof value.name==='string'&&Number.isSafeInteger(value.size)&&value.size>=0&&typeof value.etag==='string'&&value.lastModified instanceof Date,'LIST_ROW');rows.push({key:value.name,bytes:value.size,etag:value.etag,lastModified:value.lastModified.toISOString()});total++;need(rows.length<=20000&&total<=30000,'LIST_BUDGET')}}finally{stream.destroy()}rows.sort((a,b)=>a.key.localeCompare(b.key,'en'));need(new Set(rows.map(r=>r.key)).size===rows.length,'LIST_DUPLICATE');groups[k]={bucket,rows}}process.stdout.write(JSON.stringify({schemaVersion:'wfc.pf.catalog-storage-inventory.v1',groups,total}))}catch(error){process.exitCode=2;process.stdout.write(JSON.stringify({status:'FAIL',code:/^[A-Z0-9_]{1,80}$/.test(error.safeCode??'')?error.safeCode:'STORAGE_LIST_FAILED'}))}`;
}
export async function collectStorageInventory({work,binding,label='storage-inventory-'+randomUUID()}) {
  validBinding(binding);
  const capture=requireTransport(await runFixedHelper({work,binding,program:storageInventoryProgram(),input:{endpoint:binding.storage},label,limits:{outputBytes:16*1024**2}}));
  const value=json(capture.raw);demand(value?.schemaVersion==='wfc.pf.catalog-storage-inventory.v1'&&Object.keys(value.groups??{}).sort().join()==='model,project,template'&&Number.isSafeInteger(value.total)&&value.total>=0&&value.total<=30000,'CATALOG_IO_STORAGE_INVENTORY');
  let total=0;for(const kind of ['project','template','model']){const group=value.groups[kind];demand(group.bucket===binding.storage[kind+'Bucket']&&Array.isArray(group.rows)&&group.rows.length<=20000&&group.rows.every(x=>typeof x.key==='string'&&x.key.length>0&&x.key.length<=4096&&Number.isSafeInteger(x.bytes)&&x.bytes>=0&&typeof x.etag==='string'&&typeof x.lastModified==='string')&&new Set(group.rows.map(x=>x.key)).size===group.rows.length,'CATALOG_IO_STORAGE_INVENTORY_ROWS');total+=group.rows.length}
  demand(total===value.total,'CATALOG_IO_STORAGE_INVENTORY_TOTAL');return {value,rawRef:capture.rawRef,transportRef:capture.transportRef,sha256:sha256(canonical(value))};
}

export function inventoryEntry(snapshot, file) {
  validateSourceProjection(snapshot);
  const match = snapshot.files.filter(entry => entry.table === file?.table && entry.id === file?.id);
  demand(match.length === 1 && same(match[0], file), 'CATALOG_IO_FILE_CLOSURE'); return match[0];
}
export async function readSourceObject({ work, binding, snapshotRef, file, label = 'source-file-' + randomUUID() }) {
  validBinding(binding, 'original'); const snapshot = json(await readPrivate(work, snapshotRef)); inventoryEntry(snapshot, file);
  demand(snapshot.files.length <= LIMITS.files, 'CATALOG_IO_FILES_BUDGET');
  const input = { endpoint: binding.storage, kind: 'original', storageKind: file.storageKind, key: file.objectKey };
  const invoke = (method, suffix, outputBytes = 65536) => runFixedHelper({work,binding,program:storageProgram(),input:{...input,method},label:label+'-'+suffix,limits:{outputBytes}});
  const before = json(requireTransport(await invoke('HEAD','before')).raw);
  demand(before.status === 200 && Number.isSafeInteger(before.bytes) && before.bytes >= 0 && before.bytes <= LIMITS.objectBytes && (file.sizeBytes === null || BigInt(file.sizeBytes) === BigInt(before.bytes)), 'CATALOG_IO_SOURCE_FILE_SIZE');
  const reservations=(await fs.readdir(work.directory)).filter(name=>/^file-budget-[a-z-]+-[a-f0-9-]{36}\.private\.json$/.test(name));let reserved=0,ownReservation=false;
  const reservationLabel='file-budget-'+file.table.replaceAll('_','-')+'-'+file.id;
  for(const name of reservations){const value=json(await fs.readFile(await safePath(work.directory,name)));demand(value.owner===work.owner&&SHA.test(value.snapshotSha256)&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=LIMITS.objectBytes,'CATALOG_IO_FILE_BUDGET_RECORD');reserved+=value.bytes;if(name===reservationLabel+'.private.json'){demand(value.snapshotSha256===snapshotRef.sha256&&value.bytes===before.bytes,'CATALOG_IO_FILE_BUDGET_CHANGED');ownReservation=true}}
  demand(reserved+(ownReservation?0:before.bytes)<=LIMITS.totalBytes,'CATALOG_IO_TOTAL_FILE_BUDGET');
  if(!ownReservation)await writePrivate(work,reservationLabel,{owner:work.owner,snapshotSha256:snapshotRef.sha256,bytes:before.bytes});
  const get = requireTransport(await invoke('GET','get', LIMITS.objectBytes));
  const after = json(requireTransport(await invoke('HEAD','after')).raw);
  demand(same(before, after) && get.raw.length === before.bytes, 'CATALOG_IO_SOURCE_FILE_CHANGED');
  const result = { table:file.table,sourceId:file.id,sourceObjectKey:file.objectKey,storageKind:file.storageKind,contentType:file.contentType,bytes:get.raw.length,sha256:sha256(get.raw),sourceSnapshotSha256:snapshotRef.sha256,bytesRef:get.rawRef,before,after };
  result.receiptRef = await writePrivate(work,label+'-receipt',result); return result;
}
export function filePlan(work, sourceFiles, targetIds) {
  demand(UUID.test(work.owner) && Array.isArray(sourceFiles) && sourceFiles.length <= LIMITS.files && Array.isArray(targetIds) && targetIds.length === sourceFiles.length && targetIds.every(x=>UUID.test(x)) && new Set(targetIds).size===targetIds.length, 'CATALOG_IO_FILE_PLAN');
  demand(new Set(sourceFiles.map(x=>x.table+':'+x.sourceId)).size===sourceFiles.length && sourceFiles.every(x=>['project_files','project_file_versions','template_files','template_file_versions'].includes(x.table)&&UUID.test(x.sourceId)&&Number.isSafeInteger(x.bytes)&&x.bytes>=0&&x.bytes<=LIMITS.objectBytes&&SHA.test(x.sha256)&&SHA.test(x.sourceSnapshotSha256)), 'CATALOG_IO_SOURCE_FILE_RECEIPT');
  demand(sourceFiles.reduce((n,x)=>n+x.bytes,0)<=LIMITS.totalBytes,'CATALOG_IO_TOTAL_FILE_BUDGET');
  const prefix='pathfinder-tray-catalog/'+work.owner+'/';
  return { owner:work.owner,prefix,entries:sourceFiles.map((source,index)=>({...source,targetId:targetIds[index],targetObjectKey:prefix+source.table+'/'+targetIds[index]})) };
}
function validatePlanEntry(work, entry) {
  demand(UUID.test(entry.targetId)&&UUID.test(entry.sourceId)&&SHA.test(entry.sha256)&&SHA.test(entry.sourceSnapshotSha256)&&['project_files','project_file_versions','template_files','template_file_versions'].includes(entry.table)&&entry.targetObjectKey==='pathfinder-tray-catalog/'+work.owner+'/'+entry.table+'/'+entry.targetId, 'CATALOG_IO_TARGET_KEY');
  demand(['project','template'].includes(entry.storageKind)&&entry.storageKind===(entry.table.startsWith('project_')?'project':'template')&&Number.isSafeInteger(entry.bytes)&&entry.bytes>=0&&entry.bytes<=LIMITS.objectBytes,'CATALOG_IO_TARGET_FILE');
}
export async function reconcileTargetObject({ work,binding,entry,label='reconcile-file-'+randomUUID() }) {
  validBinding(binding,'target');validatePlanEntry(work,entry);
  const input={endpoint:binding.storage,kind:'target',storageKind:entry.storageKind,key:entry.targetObjectKey};
  const head=json(requireTransport(await runFixedHelper({work,binding,program:storageProgram(),input:{...input,method:'HEAD'},label:label+'-head',limits:{outputBytes:65536}})).raw);
  if(head.status===404)return {status:'ABSENT'};
  demand(head.status===200&&head.bytes===entry.bytes&&head.owner===work.owner&&head.sha256===entry.sha256&&head.snapshotSha256===entry.sourceSnapshotSha256&&head.contentType===(entry.contentType??'application/octet-stream'),'CATALOG_IO_TARGET_OBJECT_CONFLICT');
  const capture=requireTransport(await runFixedHelper({work,binding,program:storageProgram(),input:{...input,method:'GET'},label:label+'-get',limits:{outputBytes:LIMITS.objectBytes}}));
  demand(capture.raw.length===entry.bytes&&sha256(capture.raw)===entry.sha256,'CATALOG_IO_TARGET_READBACK');
  const after=json(requireTransport(await runFixedHelper({work,binding,program:storageProgram(),input:{...input,method:'HEAD'},label:label+'-after',limits:{outputBytes:65536}})).raw);demand(same(head,after),'CATALOG_IO_TARGET_FILE_CHANGED');
  return {status:'PASS',table:entry.table,sourceId:entry.sourceId,targetId:entry.targetId,sourceObjectKey:entry.sourceObjectKey,targetObjectKey:entry.targetObjectKey,bytes:entry.bytes,sha256:entry.sha256,readbackSha256:sha256(capture.raw)};
}
export async function stageTargetObject({work,binding,entry,label='stage-file-'+randomUUID()}) {
  validBinding(binding,'target');validatePlanEntry(work,entry);
  const bytes=await readPrivate(work,entry.bytesRef);demand(bytes.length===entry.bytes&&sha256(bytes)===entry.sha256,'CATALOG_IO_SOURCE_BYTES');
  const existing=await reconcileTargetObject({work,binding,entry,label:label+'-pre'});
  if(existing.status==='PASS')return existing;
  await writePrivate(work,label+'-intent',{schemaVersion:'wfc.pf.catalog-file-intent.v1',owner:work.owner,entry,action:'SINGLE_CONDITIONAL_PUT',recordedAt:new Date().toISOString()});
  const capture=await runFixedHelper({work,binding,program:storageProgram(),input:{endpoint:binding.storage,kind:'target',storageKind:entry.storageKind,key:entry.targetObjectKey,method:'PUT',owner:work.owner,sha256:entry.sha256,snapshotSha256:entry.sourceSnapshotSha256,bytes:entry.bytes,contentType:entry.contentType,base64:bytes.toString('base64')},label:label+'-put',limits:{outputBytes:65536},mutating:true});
  requireTransport(capture);const result=json(capture.raw);demand([200,204,412].includes(result.status),'CATALOG_IO_PUT_UNCERTAIN');
  const readback=await reconcileTargetObject({work,binding,entry,label:label+'-post'});demand(readback.status==='PASS','CATALOG_IO_PUT_READBACK');return readback;
}
export async function finishFileManifest({work,plan,entries,label='files-staged'}) {
  demand(plan?.owner===work.owner&&plan.prefix==='pathfinder-tray-catalog/'+work.owner+'/'&&Array.isArray(entries)&&entries.length===plan.entries.length&&entries.every((entry,index)=>entry.table===plan.entries[index].table&&entry.sourceId===plan.entries[index].sourceId&&entry.targetId===plan.entries[index].targetId&&entry.targetObjectKey===plan.entries[index].targetObjectKey&&entry.bytes===plan.entries[index].bytes&&entry.sha256===plan.entries[index].sha256&&entry.readbackSha256===entry.sha256),'CATALOG_IO_MANIFEST');
  const normalized=entries.map(({table,sourceId,targetId,sourceObjectKey,targetObjectKey,bytes,sha256,readbackSha256})=>({table,sourceId,targetId,sourceObjectKey,targetObjectKey,bytes,sha256,readbackSha256}));
  const content={owner:work.owner,prefix:plan.prefix,entries:normalized};const manifestSha256=sha256(canonical(content));
  const receipt=await writePrivate(work,label,{schemaVersion:'wfc.pf.catalog-files-staged.v1',status:'PASS',...content,manifestSha256});
  return {status:'PASS',...content,manifestSha256,receiptSha256:receipt.sha256};
}
