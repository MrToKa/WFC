import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createDocker, command, jsonCommand } from '../operations/docker.mjs';
import { assertCanonicalPath, hashFile } from '../operations/archives.mjs';
import { load, ownership, verifyBackup, contained, ROOT, fail } from './runtime-lib.mjs';

const { values } = parseArgs({ strict: true, options: { 'final-drill': { type: 'string' }, 'old-backup': { type: 'string' } } });
if (!values['final-drill'] || !values['old-backup']) fail('PF_CLEANUP_EXACT_EVIDENCE_REQUIRED');
const state = await load(); await ownership(state);
const finalPath = path.resolve(values['final-drill']);
if (!contained(path.join(ROOT, 'docs/pathfinder/runtime'), finalPath)) fail('PF_CLEANUP_EVIDENCE_OUTSIDE_SCOPE');
await assertCanonicalPath(finalPath); const final = JSON.parse(await fs.readFile(finalPath, 'utf8'));
if (final.status !== 'PASS' || final.sourceProject !== state.project || final.retirement?.status !== 'PASS' || final.retirement.resources.containers.length || final.retirement.resources.volumes.length || final.retirement.resources.networks.length || JSON.stringify(final.sourceImages) !== JSON.stringify(state.images)) fail('PF_CLEANUP_VERIFIED_FINAL_REQUIRED');
const currentBackup = await verifyBackup(final.backup);
if (currentBackup.manifest.backupId !== final.backupId || currentBackup.manifest.sourceOwner !== state.owner) fail('PF_CLEANUP_FINAL_BACKUP_CHANGED');

// This is the exact PF3-only backup created by this agent, not a general
// directory deletion facility. Keep its compact manifest/receipts for history.
const oldPath = path.resolve(values['old-backup']), expectedOld = path.join(ROOT, 'pathfinder-engine/.scratch/pf-runtime-backup-20261018-initial');
if (oldPath !== expectedOld || !contained(path.join(ROOT, 'pathfinder-engine/.scratch'), oldPath) || oldPath === currentBackup.directory) fail('PF_CLEANUP_OLD_BACKUP_OUTSIDE_SCOPE');
const old = await verifyBackup(oldPath);
if (old.manifest.backupId !== '719a6017-60d2-457c-8c79-f511af8590f9' || old.manifest.sourceOwner !== state.owner || old.manifest.sourceProject !== state.project) fail('PF_CLEANUP_BACKUP_OWNERSHIP_REQUIRED');
const targets = [];
for (const item of old.manifest.files) {
  const absolute = path.resolve(oldPath, item.path);
  if (!contained(oldPath, absolute) || path.dirname(absolute) !== oldPath) fail('PF_CLEANUP_FILE_OUTSIDE_BACKUP');
  await assertCanonicalPath(absolute); const stat = await fs.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.bytes || (await hashFile(absolute)).sha256 !== item.sha256) fail('PF_CLEANUP_BACKUP_FILE_CHANGED');
  targets.push({ absolute, bytes: item.bytes, sha256: item.sha256 });
}
const docker = await createDocker(), allContainers = await docker.containers(), retained = new Set(Object.values(state.images));
const images = [], ids = new Set((await command(['image', 'ls', '--quiet', '--no-trunc'])).toString().trim().split(/\s+/));
for (const id of ids) {
  if (!id || retained.has(id) || allContainers.some(container => container.Image === id)) continue;
  const image = (await jsonCommand(['image', 'inspect', id]))[0], labels = image.Config?.Labels, tags = image.RepoTags ?? [];
  if (labels?.['wfc.pathfinder.owner'] !== state.owner || labels?.['wfc.pathfinder.project'] !== state.project || !tags.length || tags.some(tag => !new RegExp(`^wfc-pathfinder-(api|web):${state.owner.replaceAll('-', '').slice(0, 12)}-[a-z0-9-]+$`).test(tag))) continue;
  images.push({ id, tags, bytes: image.Size });
}
const receipt = { schemaVersion: 1, status: 'IN_PROGRESS', recordedAtUtc: new Date().toISOString(), scope: 'Exact superseded PF3 backup data archives and unreferenced images carrying this isolated owner; no recursive directory deletion or Docker prune.', finalDrill: finalPath, retainedBackup: currentBackup.directory, retainedBackupId: final.backupId, retiredBackup: oldPath, removedFiles: [], removedImages: [], limits: ['Build cache, real capture/native inputs, all original containers/images and both denied historical scratch children remain untouched.', 'Image sizes are reported sizes, not a claim of reclaimed physical layer bytes.'] };
const evidence = path.join(ROOT, 'docs/pathfinder/runtime/cleanup-' + Date.now() + '.json');
await fs.writeFile(evidence, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
for (const file of targets) { await fs.unlink(file.absolute); receipt.removedFiles.push(file); await fs.writeFile(evidence, JSON.stringify(receipt, null, 2) + '\n'); }
await fs.writeFile(path.join(oldPath, 'archive-retired.json'), JSON.stringify({ schemaVersion: 1, backupId: old.manifest.backupId, status: 'SUPERSEDED_ARCHIVES_REMOVED', replacedByBackupId: final.backupId, retainedManifest: 'manifest.json', evidence, at: new Date().toISOString() }) + '\n', { flag: 'wx' });
for (const image of images) {
  if ((await docker.containers()).some(container => container.Image === image.id)) fail('PF_CLEANUP_IMAGE_BECAME_REFERENCED');
  // No force: Docker itself refuses use by any remaining dependent container.
  // Remove exact owned tags individually: a single unused ID may have several
  // candidate aliases, for which Docker refuses an ID-only removal without force.
  for (const tag of image.tags) {
    const current = (await jsonCommand(['image', 'inspect', tag]))[0];
    if (current.Id !== image.id || current.Config.Labels?.['wfc.pathfinder.owner'] !== state.owner || current.Config.Labels?.['wfc.pathfinder.project'] !== state.project) fail('PF_CLEANUP_IMAGE_TAG_CHANGED');
    await command(['image', 'rm', tag]);
  }
  receipt.removedImages.push(image); await fs.writeFile(evidence, JSON.stringify(receipt, null, 2) + '\n');
}
receipt.status = 'PASS'; receipt.removedArchiveBytes = receipt.removedFiles.reduce((sum, item) => sum + item.bytes, 0);
await fs.writeFile(evidence, JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify({ status: 'PASS', evidence, removedArchiveBytes: receipt.removedArchiveBytes, removedImages: receipt.removedImages.length }));
