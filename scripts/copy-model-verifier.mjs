import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';

const UPSTREAM_INVENTORY_SHA256 = '314818762db3ff18405091cb170f2a8c3fbab5b8595b319721ebfbd8a757389a';
const RUNTIME_INVENTORY_SHA256 = 'fc7c83371e17ba39a589b77f7d80358237ef60088c9a40353e3834ac84d9c52d';
const UPSTREAM_REVISION = 'b1c86f7c247580e1f5b41c38a1b9af1d2e290987';
const RUNTIME_FILES = [
  'index.mjs', 'lib/errors.mjs', 'lib/io.mjs', 'lib/json.mjs', 'lib/limits.mjs',
  'lib/manifest.mjs', 'lib/pack.mjs', 'lib/paths.mjs', 'lib/profile.mjs',
  'lib/verify.mjs', 'lib/zip.mjs', 'package.json',
];
const SOURCE = fileURLToPath(new URL('../server/vendor/routings-model-package/', import.meta.url));
const DESTINATION = fileURLToPath(new URL('../server/dist/server/vendor/routings-model-package/', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const refuse = code => { throw new Error(code); };

async function localPath(filename, { directory = false, create = false } = {}) {
  const resolved = path.resolve(filename), root = path.parse(resolved).root;
  let current = root;
  const parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = path.join(current, parts[index]);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      await fs.mkdir(current);
      stat = await fs.lstat(current);
    }
    if (stat.isSymbolicLink() || !samePath(await fs.realpath(current), current)) refuse('MODEL_VERIFIER_UNSAFE_PATH');
    const final = index === parts.length - 1;
    if (!final || directory) {
      if (!stat.isDirectory()) refuse('MODEL_VERIFIER_UNSAFE_PATH');
    } else if (!stat.isFile() || stat.nlink !== 1) refuse('MODEL_VERIFIER_UNSAFE_PATH');
  }
}

async function listedFiles(root, allowed) {
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) refuse('MODEL_VERIFIER_UNSAFE_PATH');
      if (entry.isDirectory()) {
        if (![...allowed].some(name => name.startsWith(relative + '/'))) refuse('MODEL_VERIFIER_UNEXPECTED_FILE');
        await walk(path.join(directory, entry.name), relative + '/');
      } else if (!entry.isFile() || !allowed.has(relative)) refuse('MODEL_VERIFIER_UNEXPECTED_FILE');
    }
  }
  await walk(root);
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) refuse('MODEL_VERIFIER_REQUIRES_NODE_24');
  await localPath(SOURCE, { directory: true });
  const provenance = JSON.parse(await fs.readFile(path.join(SOURCE, 'provenance.json'), 'utf8'));
  if (provenance.schemaVersion !== 1 || provenance.module !== 'routings-model-package' || provenance.version !== '1.0.0'
    || provenance.upstreamInventory?.sha256 !== UPSTREAM_INVENTORY_SHA256 || provenance.upstreamInventory.fileCount !== 24
    || provenance.upstreamInventory.totalBytes !== 216308 || provenance.runtimeInventorySha256 !== RUNTIME_INVENTORY_SHA256
    || provenance.fileCount !== 12 || provenance.totalBytes !== 106346 || !Array.isArray(provenance.files)
    || provenance.upstreamRevision?.repository !== 'MrToKa/routings-model-preparer'
    || provenance.upstreamRevision.path !== 'routings-model-package' || provenance.upstreamRevision.commit !== UPSTREAM_REVISION
    || provenance.files.length !== RUNTIME_FILES.length) refuse('MODEL_VERIFIER_INVENTORY_INVALID');
  let canonical = '';
  for (let index = 0; index < RUNTIME_FILES.length; index++) {
    const record = provenance.files[index];
    if (record?.path !== RUNTIME_FILES[index] || !Number.isSafeInteger(record.bytes) || record.bytes < 0
      || !/^[0-9a-f]{64}$/.test(record.sha256)) refuse('MODEL_VERIFIER_INVENTORY_INVALID');
    canonical += `${record.path}\t${record.bytes}\t${record.sha256}\n`;
  }
  if (sha256(Buffer.from(canonical)) !== RUNTIME_INVENTORY_SHA256) refuse('MODEL_VERIFIER_INVENTORY_INVALID');
  await listedFiles(SOURCE, new Set([...RUNTIME_FILES, 'index.d.mts', 'provenance.json']));
  for (const record of provenance.files) {
    const filename = path.join(SOURCE, ...record.path.split('/'));
    await localPath(filename);
    const bytes = await fs.readFile(filename);
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) refuse('MODEL_VERIFIER_SOURCE_HASH_MISMATCH');
  }
  await localPath(DESTINATION, { directory: true, create: true });
  await listedFiles(DESTINATION, new Set(RUNTIME_FILES));
  for (const record of provenance.files) {
    const source = path.join(SOURCE, ...record.path.split('/')), destination = path.join(DESTINATION, ...record.path.split('/'));
    await localPath(path.dirname(destination), { directory: true, create: true });
    try { await fs.copyFile(source, destination, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await localPath(destination);
    const bytes = await fs.readFile(destination);
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) refuse('MODEL_VERIFIER_DESTINATION_HASH_MISMATCH');
  }
  console.log(JSON.stringify({ module: provenance.module, version: provenance.version, files: 12, bytes: 106346, runtimeInventorySha256: RUNTIME_INVENTORY_SHA256 }));
}

main().catch(error => {
  const code = typeof error?.message === 'string' && /^MODEL_VERIFIER_[A-Z_]+$/.test(error.message) ? error.message : 'MODEL_VERIFIER_COPY_FAILED';
  console.error(JSON.stringify({ error: { code } }));
  process.exitCode = 1;
});
