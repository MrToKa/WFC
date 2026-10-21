import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOTS, MODES, SHA, UUID, boundedRead, canonical, digest, exact, fail, hashFile, noLinks, parseJson, relative, writeExclusive } from './common.mjs';

export function validateManifest(manifest) {
  exact(manifest, ['schemaVersion', 'kind', 'backupId', 'createdAt', 'container', 'image', 'roots', 'entries', 'audit', 'operatorFiles', 'configurationPolicy']);
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'preparer-stopped-backup' || !UUID.test(manifest.backupId) || !Number.isFinite(Date.parse(manifest.createdAt))) fail('INVALID_MANIFEST');
  exact(manifest.image, ['id', 'os', 'architecture', 'archive']);
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.image.id) || manifest.image.os !== 'linux' || !['amd64', 'arm64'].includes(manifest.image.architecture)) fail('WRONG_IMAGE');
  exact(manifest.image.archive, ['path', 'bytes', 'sha256']);
  if (manifest.image.archive.path !== 'image.tar' || !Number.isSafeInteger(manifest.image.archive.bytes) || manifest.image.archive.bytes < 1024 || !SHA.test(manifest.image.archive.sha256)) fail('INVALID_MANIFEST');
  if (!manifest.container || !MODES.includes(manifest.container.mode) || !/^sha256:[a-f0-9]{64}$/.test(manifest.container.imageId) || manifest.container.imageId !== manifest.image.id) fail('INVALID_MANIFEST');
  if (!Array.isArray(manifest.roots) || manifest.roots.length < 3 || manifest.roots.length > 6 || new Set(manifest.roots.map(root => root.role)).size !== manifest.roots.length) fail('INVALID_MANIFEST');
  for (const root of manifest.roots) { exact(root, ['role', 'virtualRoot', 'policy', 'mode', 'uid', 'gid']); if (ROOTS[root.role] !== root.virtualRoot || !['full', 'referenced-only'].includes(root.policy) || !Number.isInteger(root.mode) || root.mode < 0 || root.mode > 0o777 || ![0, 1000].includes(root.uid) || ![0, 1000].includes(root.gid)) fail('INVALID_MANIFEST'); }
  for (const role of ['data', 'work', 'outputs']) if (!manifest.roots.some(root => root.role === role && root.policy === 'full')) fail('INVALID_MANIFEST');
  if (!Array.isArray(manifest.entries) || manifest.entries.length > 200000) fail('LIMIT_EXCEEDED');
  const paths = new Set(); let totalBytes = 0;
  for (const item of manifest.entries) {
    if (!item || !manifest.roots.some(root => root.role === item.role)) fail('INVALID_MANIFEST');
    relative(item.path); const key = `${item.role}/${item.path}`; if (paths.has(key)) fail('INVALID_MANIFEST'); paths.add(key);
    if (!Number.isInteger(item.mode) || item.mode < 0 || item.mode > 0o777 || ![0, 1000].includes(item.uid) || ![0, 1000].includes(item.gid)) fail('INVALID_MANIFEST');
    if (item.type === 'directory') exact(item, ['role', 'path', 'type', 'mode', 'uid', 'gid']);
    else {
      exact(item, ['role', 'path', 'type', 'mode', 'uid', 'gid', 'bytes', 'sha256']);
      if (item.type !== 'file' || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > 32 * 1024 ** 3 || !SHA.test(item.sha256)) fail('INVALID_MANIFEST');
      totalBytes += item.bytes; if (!Number.isSafeInteger(totalBytes) || totalBytes > 256 * 1024 ** 3) fail('LIMIT_EXCEEDED');
    }
  }
  for (const item of manifest.entries) {
    const pieces = item.path.split('/'); pieces.pop();
    while (pieces.length) { const parent = manifest.entries.find(entry => entry.role === item.role && entry.path === pieces.join('/')); if (!parent || parent.type !== 'directory') fail('INVALID_MANIFEST'); pieces.pop(); }
  }
  if (!Array.isArray(manifest.operatorFiles) || manifest.operatorFiles.length < 1 || manifest.operatorFiles.length > 30) fail('INVALID_MANIFEST');
  const tools = new Set();
  for (const tool of manifest.operatorFiles) { exact(tool, ['path', 'bytes', 'sha256']); relative(tool.path); if (!/^operator\/[a-z-]+\.mjs$/.test(tool.path) || tools.has(tool.path) || !SHA.test(tool.sha256) || !Number.isSafeInteger(tool.bytes) || tool.bytes < 1 || tool.bytes > 1024 ** 2) fail('INVALID_MANIFEST'); tools.add(tool.path); }
  return manifest;
}
export async function publishManifest(root, manifest) {
  validateManifest(manifest); const text = `${canonical(manifest)}\n`;
  await writeExclusive(path.join(root, 'manifest.json'), text);
  // Completion is the last write, after full actual blob/tool/image readback.
  await verifyPayload(root, manifest);
  await writeExclusive(path.join(root, 'complete.json'), { schemaVersion: 1, backupId: manifest.backupId, manifestSha256: digest(text) });
}
export async function verifyBackup(root) {
  await noLinks(root, { directory: true });
  const complete = parseJson(await boundedRead(path.join(root, 'complete.json'), 4096)), bytes = await boundedRead(path.join(root, 'manifest.json'));
  exact(complete, ['schemaVersion', 'backupId', 'manifestSha256']);
  if (complete.schemaVersion !== 1 || !SHA.test(complete.manifestSha256) || digest(bytes) !== complete.manifestSha256) fail('BACKUP_CORRUPT');
  const manifest = validateManifest(parseJson(bytes)); if (manifest.backupId !== complete.backupId) fail('BACKUP_CORRUPT');
  const payload = await verifyPayload(root, manifest);
  return { manifest, manifestSha256: complete.manifestSha256, ...payload };
}
async function verifyPayload(root, manifest) {
  const objects = new Map();
  for (const item of manifest.entries.filter(item => item.type === 'file')) {
    if (objects.has(item.sha256) && objects.get(item.sha256) !== item.bytes) fail('BACKUP_CORRUPT'); objects.set(item.sha256, item.bytes);
  }
  const names = await fs.readdir(path.join(root, 'objects')); if (names.length !== objects.size || names.some(name => !objects.has(name))) fail('BACKUP_CORRUPT');
  for (const [sha256, expectedBytes] of objects) { const actual = await hashFile(path.join(root, 'objects', sha256)); if (actual.sha256 !== sha256 || actual.bytes !== expectedBytes) fail('BACKUP_CORRUPT'); }
  for (const artifact of [manifest.image.archive, ...manifest.operatorFiles]) {
    const actual = await hashFile(path.join(root, artifact.path)); if (actual.bytes !== artifact.bytes || actual.sha256 !== artifact.sha256) fail('BACKUP_CORRUPT');
  }
  return { objectCount: objects.size, uniqueBytes: [...objects.values()].reduce((a, b) => a + b, 0) };
}
