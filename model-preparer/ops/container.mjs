import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOTS, canonical, fail, hashFile, noLinks, parseJson, putBlob, relative, writeExclusive } from './common.mjs';
import { auditState } from './state.mjs';
import { verifyBackup } from './manifest.mjs';

async function copyTree(bundle, role, root, entries, selected = null) {
  await noLinks(root, { directory: true });
  const seen = new Set(); let count = 0;
  const visit = async (file, rel) => {
    const stat = await fs.lstat(file); if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory() || stat.isFile() && stat.nlink !== 1) fail('UNSAFE_PATH');
    if (!rel) { for (const name of (await fs.readdir(file)).sort()) await visit(path.join(file, name), name); return; }
    relative(rel); if (++count > 200000 || seen.has(rel)) fail('LIMIT_EXCEEDED'); seen.add(rel);
    const base = { role, path: rel, mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid };
    if (stat.isDirectory()) { entries.push({ ...base, type: 'directory' }); for (const name of (await fs.readdir(file)).sort()) await visit(path.join(file, name), `${rel}/${name}`); }
    else { if (selected && !selected.has(rel)) return; entries.push({ ...base, type: 'file', ...await putBlob(bundle, file) }); }
  };
  if (selected) {
    const directories = new Set();
    for (const name of [...selected].sort()) { const pieces = relative(name).split('/'); pieces.pop(); while (pieces.length) { directories.add(pieces.join('/')); pieces.pop(); } }
    for (const name of [...directories].sort((a, b) => a.length - b.length)) { const stat = await noLinks(path.join(root, ...name.split('/')), { directory: true }); entries.push({ role, path: name, type: 'directory', mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid }); }
    for (const name of [...selected].sort()) await visit(path.join(root, ...relative(name).split('/')), name);
  } else await visit(root, '');
}
export async function capture(bundle, roots = ROOTS) {
  const audit = await auditState({ roots });
  const entries = [];
  for (const role of ['data', 'work', 'outputs']) await copyTree(bundle, role, roots[role], entries);
  for (const role of ['imports', 'sources', 'proof']) if (roots[role]) {
    const selected = new Set(audit.references.filter(item => item.role === role).map(item => item.path));
    await copyTree(bundle, role, roots[role], entries, selected);
  }
  // A second complete state audit catches changes across the stopped capture.
  const after = await auditState({ roots, verifyPackages: false }); if (canonical(after) !== canonical(audit)) fail('INPUT_CHANGED');
  const rootMetadata = await Promise.all(Object.keys(roots).map(async role => { const stat = await noLinks(roots[role], { directory: true }); return { role, virtualRoot: ROOTS[role], policy: ['data', 'work', 'outputs'].includes(role) ? 'full' : 'referenced-only', mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid }; }));
  await writeExclusive(path.join(bundle, 'capture.json'), { roots: rootMetadata, entries, audit });
  return { namespaces: audit.namespaces.length, jobs: audit.jobs.length, files: entries.filter(item => item.type === 'file').length };
}
export async function plan(roots = ROOTS) {
  const audit = await auditState({ roots, verifyPackages: false }); let bytes = 0, files = 0;
  const visit = async file => {
    const stat = await fs.lstat(file); if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) fail('UNSAFE_PATH');
    if (stat.isDirectory()) for (const name of await fs.readdir(file)) await visit(path.join(file, name));
    else { if (++files > 200000 || stat.nlink !== 1) fail('LIMIT_EXCEEDED'); bytes += stat.size; }
  };
  for (const role of ['data', 'work', 'outputs']) await visit(roots[role]);
  for (const item of audit.references.filter(item => ['imports', 'sources', 'proof'].includes(item.role))) bytes += item.bytes;
  return { bytes, files, namespaces: audit.namespaces.length, jobs: audit.jobs.length };
}
export async function restorePayload(bundle, roots = ROOTS) {
  const { manifest } = await verifyBackup(bundle);
  for (const root of manifest.roots) { const target = roots[root.role]; if (!target) fail('MISSING_RESTORE_ROOT'); await noLinks(target, { directory: true }); if ((await fs.readdir(target)).length) fail('NONEMPTY_TARGET'); }
  for (const item of manifest.entries.filter(item => item.type === 'directory').sort((a, b) => a.path.split('/').length - b.path.split('/').length)) {
    const target = path.join(roots[item.role], ...relative(item.path).split('/')); await fs.mkdir(target, { mode: item.mode }); await fs.chown(target, item.uid, item.gid); await fs.chmod(target, item.mode);
  }
  for (const item of manifest.entries.filter(item => item.type === 'file')) {
    const target = path.join(roots[item.role], ...relative(item.path).split('/')); await noLinks(path.dirname(target), { directory: true });
    await fs.copyFile(path.join(bundle, 'objects', item.sha256), target, fs.constants.COPYFILE_EXCL); await fs.chown(target, item.uid, item.gid); await fs.chmod(target, item.mode);
    const check = await hashFile(target); if (check.bytes !== item.bytes || check.sha256 !== item.sha256) fail('RESTORE_COPY_CHANGED');
  }
  for (const root of manifest.roots) {
    const target = roots[root.role]; await fs.chown(target, root.uid, root.gid); await fs.chmod(target, root.mode);
    const stat = await noLinks(target, { directory: true });
    if (stat.uid !== root.uid || stat.gid !== root.gid || (stat.mode & 0o777) !== root.mode) fail('RESTORE_ROOT_METADATA_CHANGED');
  }
  const audit = await auditState({ roots }); if (canonical(audit) !== canonical(manifest.audit)) fail('RESTORE_STATE_CHANGED');
  return { status: 'verified-quarantine', namespaces: audit.namespaces, jobs: audit.jobs, references: audit.references.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    if (Number(process.versions.node.split('.')[0]) !== 24) fail('NODE24_REQUIRED');
    const [action, bundle = '/bundle'] = process.argv.slice(2);
    const roots = { ...ROOTS }; for (const role of ['imports', 'sources', 'proof']) { try { await fs.lstat(roots[role]); } catch (error) { if (error.code === 'ENOENT') delete roots[role]; else throw error; } }
    const result = action === 'capture' ? await capture(bundle, roots) : action === 'restore' ? await restorePayload(bundle, roots) : action === 'audit' ? await auditState({ roots }) : action === 'plan' ? await plan(roots) : fail('INVALID_COMMAND');
    process.stdout.write(`${canonical(result)}\n`);
  } catch (error) { process.stderr.write(`${JSON.stringify({ code: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'OPERATIONS_FAILED' })}\n`); process.exitCode = 1; }
}
