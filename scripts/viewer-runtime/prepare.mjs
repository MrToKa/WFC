import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { RUNTIME_FILES, validateRuntimeModuleClosure } from './module-closure.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = path.join(ROOT, 'viewer-runtime');
const SDK = path.join(SOURCE, 'sdk', '7.130.0');
const DESTINATION = path.join(ROOT, 'public', 'viewer-runtime', '7.130.0');
const MANIFEST_SHA = '747540a153fb18809c428d8ed177aa8a296cff1b5175ab85445e0a2ebdb36d75';
const GEOMETRY_SHA = '4d10d66dca31f10b82926693a0e7438e68f448047f3f991baabb82f6ed2573fa';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const refuse = code => { throw new Error(code); };
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

async function safePath(filename, { directory = false, create = false } = {}) {
  const absolute = path.resolve(filename), root = path.parse(absolute).root;
  let current = root;
  const parts = path.relative(root, absolute).split(path.sep).filter(Boolean);
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = path.join(current, parts[index]);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) { if (!create || error.code !== 'ENOENT') throw error; await fs.mkdir(current); stat = await fs.lstat(current); }
    if (stat.isSymbolicLink() || !samePath(await fs.realpath(current), current)) refuse('VIEWER_RUNTIME_UNSAFE_PATH');
    if (index < parts.length - 1 || directory) { if (!stat.isDirectory()) refuse('VIEWER_RUNTIME_UNSAFE_PATH'); }
    else if (!stat.isFile() || stat.nlink !== 1) refuse('VIEWER_RUNTIME_UNSAFE_PATH');
  }
}

async function inventory(root, allowed) {
  const found = new Set();
  async function walk(directory, prefix = '') {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + item.name;
      if (item.isSymbolicLink()) refuse('VIEWER_RUNTIME_UNSAFE_PATH');
      if (item.isDirectory()) {
        if (![...allowed].some(name => name.startsWith(relative + '/'))) refuse('VIEWER_RUNTIME_UNEXPECTED_FILE');
        await walk(path.join(directory, item.name), relative + '/');
      } else if (!item.isFile() || !allowed.has(relative)) refuse('VIEWER_RUNTIME_UNEXPECTED_FILE');
      else found.add(relative);
    }
  }
  await walk(root); return found;
}

async function checkedBytes(filename, expected) {
  await safePath(filename);
  const bytes = await fs.readFile(filename);
  if (expected && (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256)) refuse('VIEWER_RUNTIME_HASH_MISMATCH');
  return bytes;
}

async function loadSdk(root) {
  await safePath(root, { directory: true });
  const bytes = await checkedBytes(path.join(root, 'vendor-manifest.json'));
  if (digest(bytes) !== MANIFEST_SHA) refuse('VIEWER_RUNTIME_MANIFEST_MISMATCH');
  const manifest = JSON.parse(bytes);
  const entries = Object.entries(manifest.files);
  if (manifest.version !== '7.130.0' || entries.length !== 206 || entries.reduce((sum, [, file]) => sum + file.bytes, 0) !== 82552768) refuse('VIEWER_RUNTIME_MANIFEST_MISMATCH');
  const files = entries.map(([name, file]) => {
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(name) || name.split('/').some(part => part === '.' || part === '..') || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) refuse('VIEWER_RUNTIME_MANIFEST_MISMATCH');
    return { path: name, ...file };
  });
  const allowed = new Set(['vendor-manifest.json', ...files.map(file => file.path)]);
  const found = await inventory(root, allowed);
  if (found.size !== allowed.size) refuse('VIEWER_RUNTIME_FILE_MISSING');
  for (const file of files) await checkedBytes(path.join(root, ...file.path.split('/')), file);
  return [...files, { path: 'vendor-manifest.json', bytes: bytes.length, sha256: MANIFEST_SHA }];
}

async function copy(root, destination, files, { immutable = false } = {}) {
  await safePath(destination, { directory: true, create: true });
  for (const file of files) {
    const filename = path.join(destination, ...file.path.split('/'));
    await safePath(path.dirname(filename), { directory: true, create: true });
    const bytes = await checkedBytes(path.join(root, ...file.path.split('/')), file);
    try {
      await safePath(filename);
      const existing = await fs.readFile(filename);
      if (digest(existing) === file.sha256 && existing.length === file.bytes) continue;
      if (immutable) refuse('VIEWER_RUNTIME_DESTINATION_MISMATCH');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Only known generated files are replaced. No source or unknown file is removed.
    await fs.writeFile(filename, bytes);
    await checkedBytes(filename, file);
  }
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) refuse('VIEWER_RUNTIME_REQUIRES_NODE_24');
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--source' || !path.isAbsolute(args[1]))) refuse('VIEWER_RUNTIME_INVALID_ARGUMENT');
  if (args.length) {
    const files = await loadSdk(args[1]);
    await safePath(SDK, { directory: true, create: true });
    await inventory(SDK, new Set(files.map(file => file.path)));
    await copy(args[1], SDK, files, { immutable: true });
  }
  const sdkFiles = await loadSdk(SDK);
  const files = [];
  for (const name of RUNTIME_FILES) {
    const bytes = await checkedBytes(path.join(SOURCE, name));
    const sha256 = digest(bytes);
    if (name === 'route-geometry.mjs' && sha256 !== GEOMETRY_SHA) refuse('VIEWER_RUNTIME_GEOMETRY_CHANGED');
    files.push({ path: name, bytes: bytes.length, sha256 });
  }
  const moduleClosure = await validateRuntimeModuleClosure(RUNTIME_FILES, async name => (await checkedBytes(path.join(SOURCE, name))).toString('utf8'));
  const css = (await checkedBytes(path.join(SDK, 'style.min.css'))).toString('utf8');
  let substitutions = 0;
  const localCss = Buffer.from(css.replace(/https:\/\/fonts\.autodesk\.com\/[^)"'\s]+/g, () => {
    substitutions++; return './sdk/res/fonts/arimo-v29-latin_latin-ext-regular.woff';
  }));
  if (substitutions !== 54 || /https?:\/\//.test(localCss.toString('utf8'))) refuse('VIEWER_RUNTIME_FONT_POLICY_MISMATCH');
  const derivedCss = { path: 'style.local.css', bytes: localCss.length, sha256: digest(localCss) };
  const publicFiles = [...files, derivedCss, ...sdkFiles.map(file => ({ ...file, path: 'sdk/' + file.path }))];
  await safePath(DESTINATION, { directory: true, create: true });
  await inventory(DESTINATION, new Set([...publicFiles.map(file => file.path), 'runtime-inventory.json']));
  await copy(SOURCE, DESTINATION, files);
  await copy(SDK, path.join(DESTINATION, 'sdk'), sdkFiles, { immutable: true });
  const cssTarget = path.join(DESTINATION, derivedCss.path);
  try { await safePath(cssTarget); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(cssTarget, localCss);
  await checkedBytes(cssTarget, derivedCss);
  const report = { schemaVersion: 1, sdkVersion: '7.130.0', vendorManifestSha256: MANIFEST_SHA, sdkFileCount: 206, sdkBytes: 82552768,
    moduleClosure,
    stylesheet: { source: 'sdk/style.min.css', sourceSha256: digest(Buffer.from(css)), deployed: derivedCss.path, deployedSha256: derivedCss.sha256,
      substitutions, localFont: './sdk/res/fonts/arimo-v29-latin_latin-ext-regular.woff', originalModified: false },
    fileCount: publicFiles.length, totalBytes: publicFiles.reduce((sum, file) => sum + file.bytes, 0), files: publicFiles };
  const target = path.join(DESTINATION, 'runtime-inventory.json');
  try { await safePath(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const encoded = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  const previous = await fs.readFile(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (!previous?.equals(encoded)) await fs.writeFile(target, encoded);
  console.log(JSON.stringify({ status: 'PASS', sdkVersion: report.sdkVersion, sdkFileCount: report.sdkFileCount, sdkBytes: report.sdkBytes, fileCount: report.fileCount, totalBytes: report.totalBytes, inventorySha256: digest(await fs.readFile(target)) }));
}

main().catch(error => {
  const code = typeof error?.message === 'string' && /^VIEWER_RUNTIME_[A-Z_]+$/.test(error.message) ? error.message : 'VIEWER_RUNTIME_PREPARE_FAILED';
  console.error(JSON.stringify({ error: { code } })); process.exitCode = 1;
});
