import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const LIMITS = Object.freeze({ files: 20000, fileBytes: 64 * 1024 ** 2, totalBytes: 1024 ** 3, gitOutputBytes: 128 * 1024 ** 2, gitTimeoutMs: 300000 });
const need = (value, code) => { if (!value) throw Object.assign(Error(code), { code }); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blobOid = (bytes, oid) => createHash(oid.length === 40 ? 'sha1' : 'sha256').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const fingerprint = value => sha(canonical(value));
const plain = value => value !== null && Object.getPrototypeOf(value) === Object.prototype;
const failureCode = error => /^[A-Z0-9_]{3,80}$/.test(error?.code ?? '') ? error.code : 'DELIVERY_FAILED';
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

export function deliveryPath(value) {
  need(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096 && !/^[a-z]:/i.test(value)
    && !value.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[<>:"|?*]|[. ]$/.test(part)
      && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part) && Buffer.byteLength(part) <= 255), 'DELIVERY_UNSAFE_PATH');
  return value;
}
export function excludedDeliveryPath(value) {
  const parts = value.split('/').map(part => part.toLowerCase());
  return parts.some(part => ['.git', '.data', '.preparer-work', 'backups', 'node_modules', 'coverage'].includes(part) || /^\.env(?:\.|$)/.test(part))
    || parts[0] === 'dist' || parts[0] === 'server' && parts[1] === 'dist' || parts[0] === 'public' && parts[1] === 'viewer-runtime' || /\.log$/i.test(value);
}
function registry() {
  const seen = new Map();
  return (name, type = 'file') => { const parts = name.split('/');
    for (let at = 0; at < parts.length; at++) { const current = parts.slice(0, at + 1).join('/'), key = current.normalize('NFC').toLowerCase(), kind = at === parts.length - 1 ? type : 'directory', previous = seen.get(key);
      need(!previous || previous.name === current && previous.type === kind && kind === 'directory', 'DELIVERY_PATH_COLLISION'); seen.set(key, { name: current, type: kind }); }
  };
}
export function parseDeliveryTree(bytes) {
  need(Buffer.isBuffer(bytes) && bytes.length <= LIMITS.gitOutputBytes, 'DELIVERY_GIT_TREE_LIMIT');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); need(!text || text.endsWith('\0'), 'DELIVERY_GIT_TREE_INVALID');
  const result = [], register = registry();
  for (const row of text.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(row); need(match, 'DELIVERY_NORMAL_BLOB_REQUIRED');
    const name = deliveryPath(match[3]); if (excludedDeliveryPath(name)) continue;
    register(name); result.push({ path: name, mode: match[1], gitObjectId: match[2] }); need(result.length <= LIMITS.files, 'DELIVERY_FILE_LIMIT');
  }
  return result.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}
export function assertDeliveryStatus(bytes) {
  need(Buffer.isBuffer(bytes) && bytes.length <= 4 * 1024 ** 2, 'DELIVERY_GIT_STATUS_LIMIT');
  const rows = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\0');
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]; if (!row) continue;
    need(row.length >= 4 && row[2] === ' ', 'DELIVERY_GIT_STATUS_INVALID'); const name = deliveryPath(row.slice(3));
    const names = [name]; if (/[RC]/.test(row.slice(0, 2))) { need(index + 1 < rows.length && rows[index + 1], 'DELIVERY_GIT_STATUS_INVALID'); names.push(deliveryPath(rows[++index])); }
    need(names.every(excludedDeliveryPath), 'DELIVERY_WORKTREE_DIRTY');
  }
}
async function canonicalPath(value, directory = false) {
  need(typeof value === 'string' && path.isAbsolute(value), 'DELIVERY_PATH_INVALID');
  const target = path.resolve(value), drive = path.parse(target).root; let current = drive;
  for (const component of ['', ...path.relative(drive, target).split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    const stat = await fs.lstat(current); need(!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()) && (!stat.isFile() || stat.nlink === 1) && samePath(await fs.realpath(current), current), 'DELIVERY_LINK_REJECTED');
  }
  const stat = await fs.lstat(target); need(directory ? stat.isDirectory() : stat.isFile(), 'DELIVERY_TYPE_INVALID'); return target;
}
function localGit(root) {
  return (args, { maxBytes = LIMITS.gitOutputBytes } = {}) => new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-optional-locks', '-C', root, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    const chunks = []; let bytes = 0, oversized = false;
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) { oversized = true; child.kill(); } else chunks.push(chunk); });
    child.stderr.resume(); const timer = setTimeout(() => child.kill(), LIMITS.gitTimeoutMs);
    child.once('error', () => { clearTimeout(timer); reject(Object.assign(Error('DELIVERY_GIT_FAILED'), { code: 'DELIVERY_GIT_FAILED' })); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0 || oversized) reject(Object.assign(Error('DELIVERY_GIT_FAILED'), { code: 'DELIVERY_GIT_FAILED' })); else resolve(Buffer.concat(chunks)); });
  });
}
async function newJson(filename, value) { const handle = await fs.open(filename, 'wx', 0o600); try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); } }
async function fileIdentity(filename) {
  await canonicalPath(filename); const before = await fs.lstat(filename, { bigint: true }); need(before.size <= BigInt(LIMITS.fileBytes), 'DELIVERY_FILE_BYTES_LIMIT');
  const bytes = await fs.readFile(filename), after = await fs.lstat(filename, { bigint: true });
  need([before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs].join(':') === [after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].join(':'), 'DELIVERY_FILE_CHANGED');
  return { bytes, identity: { bytes: bytes.length, sha256: sha(bytes) } };
}
async function writeFileNew(root, relative, bytes, mode = 0o644) {
  deliveryPath(relative); await canonicalPath(root, true); const filename = path.join(root, ...relative.split('/'));
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 }); await canonicalPath(path.dirname(filename), true);
  const handle = await fs.open(filename, 'wx', mode); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  const copied = await fileIdentity(filename); need(copied.identity.bytes === bytes.length && copied.identity.sha256 === sha(bytes), 'DELIVERY_COPY_CHANGED'); return { path: relative, ...copied.identity };
}
async function gitIdentity(git) {
  const revision = (await git(['rev-parse', '--verify', 'HEAD^{commit}'], { maxBytes: 4096 })).toString().trim();
  const tree = (await git(['rev-parse', '--verify', 'HEAD^{tree}'], { maxBytes: 4096 })).toString().trim(); need(OID.test(revision) && OID.test(tree), 'DELIVERY_REVISION_INVALID');
  assertDeliveryStatus(await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'], { maxBytes: 4 * 1024 ** 2 })); return { revision, tree };
}
async function dependencyPins(git, revision) {
  const baselineRevision = (await git(['rev-parse', '--verify', '96e63f13^{commit}'], { maxBytes: 4096 })).toString().trim(); need(OID.test(baselineRevision), 'DELIVERY_BASELINE_UNAVAILABLE');
  const pins = [];
  for (const name of ['package.json', 'package-lock.json']) {
    const current = await git(['show', revision + ':' + name], { maxBytes: LIMITS.fileBytes }), original = await git(['show', baselineRevision + ':' + name], { maxBytes: LIMITS.fileBytes });
    need(Buffer.isBuffer(current) && Buffer.isBuffer(original) && current.equals(original), 'DELIVERY_THIN_BASE_DEPENDENCIES_CHANGED'); pins.push({ path: name, bytes: current.length, sha256: sha(current) });
  }
  return { baselineRevision, files: pins };
}
async function operationRoot(operationDirectory, root) {
  need(typeof operationDirectory === 'string' && path.isAbsolute(operationDirectory), 'DELIVERY_OPERATION_INVALID');
  const parent = await canonicalPath(path.join(root, '.preparer-work'), true), operationId = path.basename(operationDirectory).slice('sp-delivery-'.length);
  need(UUID.test(operationId) && samePath(path.resolve(operationDirectory), path.join(parent, 'sp-delivery-' + operationId)), 'DELIVERY_OPERATION_INVALID'); return { parent, operationId };
}
const SOURCE_CONTEXT_PREFIX = 'scripts/preparer-main/delivery.runtime.Dockerfile';
function selectedContext(name) {
  if (name === 'model-preparer/index.mjs' || name === 'model-preparer/package.json' || /^model-preparer\/(?:app|lib)\/.+\.mjs$/.test(name) || /^model-preparer\/web\/.+\.(?:mjs|js|css|html|svg|png)$/.test(name)) return { context: 'preparer', path: name.slice('model-preparer/'.length) };
  const prefix = 'server/vendor/routings-model-package/';
  if (name.startsWith(prefix) && (['index.mjs', 'package.json'].includes(name.slice(prefix.length)) || /^lib\/.+\.mjs$/.test(name.slice(prefix.length)))) return { context: 'package', path: name.slice(prefix.length) };
  if (['model-preparer/deployment/Dockerfile', 'model-preparer/deployment/.dockerignore'].includes(name)) return { context: 'deployment', path: path.basename(name) };
  return null;
}

/** No build, network call, environment file or runtime directory is read. */
export async function materializeDelivery({ operationDirectory }, options = {}) {
  const root = await canonicalPath(options.root ?? ROOT, true), git = options.git ?? localGit(root), owned = await operationRoot(operationDirectory, root);
  const head = await gitIdentity(git), dependencies = await dependencyPins(git, head.revision);
  const tree = parseDeliveryTree(await git(['ls-tree', '-r', '-z', '--full-tree', head.revision]));
  need(tree.some(item => item.path === SOURCE_CONTEXT_PREFIX), 'DELIVERY_RUNTIME_DOCKERFILE_MISSING');
  await fs.mkdir(operationDirectory, { mode: 0o700 });
  const marker = { schemaVersion: 'wfc.preparer.delivery-owner.v1', operationId: owned.operationId, root, revision: head.revision, tree: head.tree, mode: options.git || options.root ? 'injected-test-only' : 'production', createdAt: new Date().toISOString() };
  await newJson(path.join(operationDirectory, 'operation.private.json'), marker);
  try {
    for (const context of ['source', 'preparer', 'package', 'preview', 'deployment']) await fs.mkdir(path.join(operationDirectory, context), { mode: 0o700 });
    let totalBytes = 0; const files = [], contexts = [];
    for (const item of tree) {
      const bytes = await git(['cat-file', 'blob', item.gitObjectId], { maxBytes: LIMITS.fileBytes }); need(Buffer.isBuffer(bytes) && bytes.length <= LIMITS.fileBytes, 'DELIVERY_FILE_BYTES_LIMIT');
      need(blobOid(bytes, item.gitObjectId) === item.gitObjectId, 'DELIVERY_GIT_BLOB_CHANGED');
      totalBytes += bytes.length; need(totalBytes <= LIMITS.totalBytes, 'DELIVERY_TOTAL_BYTES_LIMIT');
      files.push({ ...item, ...await writeFileNew(path.join(operationDirectory, 'source'), item.path, bytes, item.mode === '100755' ? 0o755 : 0o644) });
      const selected = selectedContext(item.path);
      if (selected) contexts.push({ context: selected.context, ...await writeFileNew(path.join(operationDirectory, selected.context), selected.path, bytes) });
    }
    const runtimeSource = await fileIdentity(path.join(operationDirectory, 'source', ...SOURCE_CONTEXT_PREFIX.split('/')));
    contexts.push({ context: 'deployment', ...await writeFileNew(path.join(operationDirectory, 'deployment'), 'delivery.runtime.Dockerfile', runtimeSource.bytes) });
    for (const required of ['preparer/index.mjs', 'preparer/app/server.mjs', 'preparer/app/workspace-service.mjs', 'preparer/app/workspace-security.mjs', 'preparer/app/page-credentials.mjs', 'package/index.mjs', 'package/package.json', 'package/lib/pack.mjs', 'deployment/Dockerfile', 'deployment/.dockerignore']) need(contexts.some(item => item.context + '/' + item.path === required), 'DELIVERY_CONTEXT_INCOMPLETE');
    const workingLocks = []; for (const row of dependencies.files) workingLocks.push({ path: row.path, ...(await fileIdentity(path.join(root, row.path))).identity });
    need(fingerprint(await gitIdentity(git)) === fingerprint(head), 'DELIVERY_HEAD_CHANGED');
    const body = { schemaVersion: 'wfc.preparer.delivery-snapshot.v1', revision: head.revision, tree: head.tree, dependencies, files, contexts, workingLocks, preview: 'empty; workspace exposes no legacy preview' };
    const manifest = { ...body, fingerprint: fingerprint(body) }; need(Buffer.byteLength(JSON.stringify(manifest)) <= 16 * 1024 ** 2, 'DELIVERY_MANIFEST_LIMIT'); await newJson(path.join(operationDirectory, 'snapshot.private.json'), manifest);
    await newJson(path.join(operationDirectory, 'snapshot-complete.private.json'), { schemaVersion: 'wfc.preparer.delivery-snapshot-complete.v1', operationId: owned.operationId, manifest: (await fileIdentity(path.join(operationDirectory, 'snapshot.private.json'))).identity });
    return { operationDirectory, revision: head.revision, fingerprint: manifest.fingerprint };
  } catch (error) { await newJson(path.join(operationDirectory, 'snapshot-failure.private.json'), { status: 'FAIL', code: failureCode(error) }); throw error; }
}
async function readPrivateJson(filename) { const value = await fileIdentity(filename); need(value.identity.bytes <= 16 * 1024 ** 2, 'DELIVERY_MANIFEST_LIMIT'); try { const body = JSON.parse(value.bytes); need(plain(body), 'DELIVERY_MARKER_INVALID'); return { body, identity: value.identity }; } catch { need(false, 'DELIVERY_MARKER_INVALID'); } }
async function exactInventory(root, expected) {
  await canonicalPath(root, true); const files = new Set(expected), directories = new Set(), found = new Set();
  for (const name of files) { deliveryPath(name); const parts = name.split('/'); for (let at = 1; at < parts.length; at++) directories.add(parts.slice(0, at).join('/')); }
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const name = prefix + entry.name; deliveryPath(name); need(!entry.isSymbolicLink(), 'DELIVERY_CONTEXT_EXTRA_FILE');
      if (entry.isDirectory()) { need(directories.has(name), 'DELIVERY_CONTEXT_EXTRA_FILE'); await walk(path.join(directory, entry.name), name + '/'); }
      else { need(entry.isFile() && files.has(name) && !found.has(name), 'DELIVERY_CONTEXT_EXTRA_FILE'); found.add(name); }
    }
  }
  await walk(root); need(found.size === files.size, 'DELIVERY_CONTEXT_FILE_MISSING');
}
async function checkedSnapshot(operationDirectory, root, git, expectedMode) {
  const owned = await operationRoot(operationDirectory, root); await canonicalPath(operationDirectory, true);
  const marker = (await readPrivateJson(path.join(operationDirectory, 'operation.private.json'))).body;
  need(marker.schemaVersion === 'wfc.preparer.delivery-owner.v1' && marker.operationId === owned.operationId && samePath(marker.root, root) && marker.mode === expectedMode, 'DELIVERY_OWNER_INVALID');
  const snapshot = await readPrivateJson(path.join(operationDirectory, 'snapshot.private.json')), complete = (await readPrivateJson(path.join(operationDirectory, 'snapshot-complete.private.json'))).body;
  need(complete.schemaVersion === 'wfc.preparer.delivery-snapshot-complete.v1' && complete.operationId === owned.operationId && fingerprint(complete.manifest) === fingerprint(snapshot.identity), 'DELIVERY_SNAPSHOT_INCOMPLETE');
  const { fingerprint: expected, ...body } = snapshot.body; need(expected === fingerprint(body) && body.revision === marker.revision && body.tree === marker.tree && Array.isArray(body.files) && Array.isArray(body.contexts) && body.files.length <= LIMITS.files, 'DELIVERY_SNAPSHOT_INVALID');
  const head = await gitIdentity(git); need(head.revision === marker.revision && head.tree === marker.tree, 'DELIVERY_HEAD_CHANGED');
  need(fingerprint(await dependencyPins(git, head.revision)) === fingerprint(body.dependencies), 'DELIVERY_THIN_BASE_DEPENDENCIES_CHANGED');
  const tree = parseDeliveryTree(await git(['ls-tree', '-r', '-z', '--full-tree', head.revision]));
  need(fingerprint(tree) === fingerprint(body.files.map(({ path, mode, gitObjectId }) => ({ path, mode, gitObjectId }))), 'DELIVERY_SOURCE_PINS_CHANGED');
  await exactInventory(path.join(operationDirectory, 'source'), body.files.map(item => item.path));
  for (const context of ['preparer', 'package', 'deployment']) await exactInventory(path.join(operationDirectory, context), body.contexts.filter(item => item.context === context).map(item => item.path));
  for (const item of body.files) { const actual = await fileIdentity(path.join(operationDirectory, 'source', ...deliveryPath(item.path).split('/')));
    need(fingerprint(actual.identity) === fingerprint({ bytes: item.bytes, sha256: item.sha256 }) && blobOid(actual.bytes, item.gitObjectId) === item.gitObjectId, 'DELIVERY_SOURCE_PINS_CHANGED'); }
  for (const item of body.contexts) { need(['preparer', 'package', 'deployment'].includes(item.context), 'DELIVERY_CONTEXT_INVALID'); need(fingerprint((await fileIdentity(path.join(operationDirectory, item.context, ...deliveryPath(item.path).split('/')))).identity) === fingerprint({ bytes: item.bytes, sha256: item.sha256 }), 'DELIVERY_CONTEXT_CHANGED'); }
  need((await fs.readdir(path.join(operationDirectory, 'preview'))).length === 0, 'DELIVERY_PREVIEW_NOT_EMPTY');
  for (const item of body.workingLocks) need(fingerprint((await fileIdentity(path.join(root, deliveryPath(item.path)))).identity) === fingerprint({ bytes: item.bytes, sha256: item.sha256 }), 'DELIVERY_WORKING_LOCK_CHANGED');
  return { owned, marker, snapshot: body, fingerprint: expected };
}
async function copyOutputTree(source, destination, prefix, rows, counter) {
  await canonicalPath(source, true); const register = registry();
  async function walk(directory, relative = '') {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))) {
      const name = relative ? relative + '/' + entry.name : entry.name; deliveryPath(name); need(!excludedDeliveryPath(name) && !entry.isSymbolicLink(), 'DELIVERY_OUTPUT_UNSAFE');
      const filename = path.join(directory, entry.name); if (entry.isDirectory()) { register(name, 'directory'); await walk(filename, name); }
      else { need(entry.isFile(), 'DELIVERY_OUTPUT_UNSAFE'); register(name); const value = await fileIdentity(filename); counter.bytes += value.identity.bytes; counter.files++; need(counter.bytes <= LIMITS.totalBytes && counter.files <= LIMITS.files, 'DELIVERY_OUTPUT_LIMIT'); rows.push(await writeFileNew(destination, prefix + '/' + name, value.bytes)); }
    }
  }
  await walk(source);
}
export async function collectDeliveryOutputs({ operationDirectory }, options = {}) {
  const root = await canonicalPath(options.root ?? ROOT, true), git = options.git ?? localGit(root), expectedMode = options.git || options.root ? 'injected-test-only' : 'production', before = await checkedSnapshot(operationDirectory, root, git, expectedMode);
  const compiled = path.join(operationDirectory, 'compiled'); await fs.mkdir(compiled, { mode: 0o700 }); const files = [], counter = { bytes: 0, files: 0 };
  try {
    await copyOutputTree(path.join(root, 'dist'), compiled, 'dist', files, counter);
    await copyOutputTree(path.join(root, 'server/dist'), compiled, 'server-dist', files, counter);
    await copyOutputTree(path.join(operationDirectory, 'source', 'Template files'), compiled, 'templates', files, counter);
    files.push(await writeFileNew(compiled, 'nginx.conf', (await fileIdentity(path.join(operationDirectory, 'source/docker/nginx.conf'))).bytes));
    files.push(await writeFileNew(compiled, 'Dockerfile', (await fileIdentity(path.join(operationDirectory, 'deployment/delivery.runtime.Dockerfile'))).bytes));
    for (const required of ['dist/index.html', 'server-dist/server/index.js', 'server-dist/server/vendor/routings-model-package/index.mjs', 'nginx.conf', 'Dockerfile']) need(files.some(item => item.path === required), 'DELIVERY_COMPILED_INCOMPLETE');
    need(files.some(item => item.path.startsWith('templates/')), 'DELIVERY_TEMPLATES_MISSING');
    await exactInventory(compiled, files.map(item => item.path));
    const after = await checkedSnapshot(operationDirectory, root, git, expectedMode); need(after.fingerprint === before.fingerprint, 'DELIVERY_SNAPSHOT_CHANGED');
    const body = { schemaVersion: 'wfc.preparer.delivery-compiled.v1', revision: before.marker.revision, sourceFingerprint: before.fingerprint, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
    const manifest = { ...body, fingerprint: fingerprint(body) }; need(Buffer.byteLength(JSON.stringify(manifest)) <= 16 * 1024 ** 2, 'DELIVERY_MANIFEST_LIMIT'); await newJson(path.join(operationDirectory, 'compiled.private.json'), manifest);
    await newJson(path.join(operationDirectory, 'compiled-complete.private.json'), { schemaVersion: 'wfc.preparer.delivery-compiled-complete.v1', operationId: before.owned.operationId, manifest: (await fileIdentity(path.join(operationDirectory, 'compiled.private.json'))).identity });
    return { operationDirectory, revision: before.marker.revision, fingerprint: manifest.fingerprint };
  } catch (error) { await newJson(path.join(operationDirectory, 'compiled-failure.private.json'), { status: 'FAIL', code: failureCode(error) }); throw error; }
}
export async function main(args) {
  need(args.length === 3 && ['snapshot', 'outputs'].includes(args[0]) && args[1] === '--operation' && path.isAbsolute(args[2]), 'DELIVERY_ARGUMENT_INVALID');
  const result = await (args[0] === 'snapshot' ? materializeDelivery : collectDeliveryOutputs)({ operationDirectory: args[2] }); console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.log(JSON.stringify({ status: 'FAIL', code: failureCode(error) })); process.exitCode = 1; });
