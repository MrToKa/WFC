import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--target') throw new Error('Use --source SDK_DIRECTORY --target NEW_RUNTIME_DIRECTORY.');
const source = path.resolve(args[1]), target = path.resolve(args[3]);
const font = '/sdk/res/fonts/arimo-v29-latin_latin-ext-regular.woff';
const sha = value => createHash('sha256').update(value).digest('hex');
async function noLinks(file, directory = false) {
  const absolute = path.resolve(file), root = path.parse(absolute).root;
  let current = root;
  for (const component of ['', ...path.relative(root, absolute).split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    const stat = await fs.lstat(current), last = current === absolute;
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1) || (!stat.isDirectory() && !stat.isFile()) || ((!last || directory) && !stat.isDirectory())) throw new Error('SDK deployment requires regular files and canonical link-free directories.');
    const resolved = await fs.realpath(current);
    if ((process.platform === 'win32' ? resolved.toLowerCase() : resolved) !== (process.platform === 'win32' ? current.toLowerCase() : current)) throw new Error('SDK path alias is unsupported.');
  }
}
async function fileHash(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function inventory(root, relative = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Linked SDK input is unsupported.');
    if (entry.isDirectory()) result.push(...await inventory(root, next));
    else if (entry.isFile()) result.push(next);
    else throw new Error('Special SDK input is unsupported.');
  }
  return result.sort();
}
await noLinks(source, true); await noLinks(path.dirname(target), true);
if (source === target || target.startsWith(source + path.sep) || source.startsWith(target + path.sep)) throw new Error('SDK source and deployment target must be disjoint.');
const manifestPath = path.join(source, 'vendor-manifest.json'); await noLinks(manifestPath);
if ((await fs.stat(manifestPath)).size > 4 * 1024 ** 2) throw new Error('SDK inventory is too large.');
const manifestBytes = await fs.readFile(manifestPath), manifest = JSON.parse(manifestBytes);
if (sha(manifestBytes) !== '747540a153fb18809c428d8ed177aa8a296cff1b5175ab85445e0a2ebdb36d75') throw new Error('Trusted SDK source inventory fingerprint differs.');
if (manifest.version !== '7.130.0' || !manifest.files || typeof manifest.files !== 'object') throw new Error('Only trusted SDK 7.130.0 is supported.');
const names = Object.keys(manifest.files).sort(), files = [];
if (names.length !== 206) throw new Error('Trusted SDK inventory count differs.');
if (JSON.stringify(await inventory(source)) !== JSON.stringify([...names, 'vendor-manifest.json'].sort())) throw new Error('SDK source contains missing or unlisted files.');
for (const name of names) {
  if (!/^[A-Za-z0-9_.\/-]+$/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase().startsWith('.env')) || name.startsWith('/') || name.includes('\\')) throw new Error('Unsafe SDK inventory path.');
  const file = path.join(source, ...name.split('/')); await noLinks(file);
  const declared = manifest.files[name], stat = await fs.stat(file), hash = await fileHash(file);
  if (stat.size !== declared.bytes || hash !== declared.sha256) throw new Error(`Trusted SDK inventory mismatch: ${name}`);
  files.push({ path: name, bytes: stat.size, sourceSha256: hash, deployedSha256: hash, adaptation: 'none' });
}
let substitutions = 0;
const css = await fs.readFile(path.join(source, 'style.min.css'), 'utf8');
const deployedCss = css.replace(/https:\/\/fonts\.autodesk\.com\/[^)"'\s]+/g, () => { substitutions++; return font; });
if (substitutions !== 54 || /https?:\/\//.test(deployedCss)) throw new Error('SDK stylesheet external URL policy differs.');
const cssRecord = files.find(file => file.path === 'style.min.css');
cssRecord.deployedSha256 = sha(deployedCss); cssRecord.deployedBytes = Buffer.byteLength(deployedCss); cssRecord.adaptation = '54 external font URLs replaced with local existing Arimo WOFF';
const provenance = { schemaVersion: 1, sdkVersion: '7.130.0', source: manifest.source, originalSourceDirectory: source, sourceManifestSha256: sha(manifestBytes), originalFilesModified: false,
  localFont: font, substitutions, sourceAssetCount: files.length, sourceAssetBytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
try {
  await fs.stat(target); await noLinks(target, true);
  if (JSON.stringify(await inventory(target)) !== JSON.stringify([...names, 'deployment-provenance.json'].sort())) throw new Error('Deployment runtime contains missing or unlisted files.');
  const existing = JSON.parse(await fs.readFile(path.join(target, 'deployment-provenance.json'), 'utf8'));
  if (JSON.stringify(existing) !== JSON.stringify(provenance)) throw new Error('Existing runtime provenance differs; select a new target.');
  for (const file of files) { const deployed = path.join(target, ...file.path.split('/')); await noLinks(deployed); if (await fileHash(deployed) !== file.deployedSha256) throw new Error('Existing runtime bytes differ.'); }
  process.stdout.write(JSON.stringify({ status: 'PASS', reused: true, ...{ version: provenance.sdkVersion, assets: files.length, sourceBytes: provenance.sourceAssetBytes, fontReplacements: substitutions, cssSourceSha256: cssRecord.sourceSha256, cssDeployedSha256: cssRecord.deployedSha256 } }) + '\n');
} catch (error) {
  if (error.code !== 'ENOENT' || await fs.stat(target).then(() => true, () => false)) throw error;
  const staging = target + `.stage-${randomUUID()}`; await fs.mkdir(staging, { mode: 0o700 }); let committed = false;
  try {
    for (const file of files) {
      const destination = path.join(staging, ...file.path.split('/')); await fs.mkdir(path.dirname(destination), { recursive: true });
      if (file.path === 'style.min.css') await fs.writeFile(destination, deployedCss, { flag: 'wx' });
      else await fs.copyFile(path.join(source, ...file.path.split('/')), destination, 1);
      if (await fileHash(destination) !== file.deployedSha256) throw new Error('SDK copy readback differs.');
    }
    await fs.writeFile(path.join(staging, 'deployment-provenance.json'), JSON.stringify(provenance, null, 2) + '\n', { flag: 'wx' });
    // Recheck all original files after copying; only the deployment copy changes.
    for (const file of files) if (await fileHash(path.join(source, ...file.path.split('/'))) !== file.sourceSha256) throw new Error('Original SDK changed during deployment preparation.');
    await fs.rename(staging, target); committed = true;
    process.stdout.write(JSON.stringify({ status: 'PASS', reused: false, version: provenance.sdkVersion, assets: files.length, sourceBytes: provenance.sourceAssetBytes, fontReplacements: substitutions, cssSourceSha256: cssRecord.sourceSha256, cssDeployedSha256: cssRecord.deployedSha256 }) + '\n');
  } finally { if (!committed && path.dirname(staging) === path.dirname(target)) await fs.rm(staging, { recursive: true, force: true }); }
}
