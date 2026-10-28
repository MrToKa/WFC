import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const [projectArg, packageArg, stagingArg] = process.argv.slice(2);
if (!projectArg || !packageArg || !stagingArg || process.argv.length !== 5) throw new Error('Use PROJECT_DIRECTORY PACKAGE_DIRECTORY NEW_STAGING_DIRECTORY.');
const project = await fs.realpath(projectArg), packageRoot = await fs.realpath(packageArg), staging = path.resolve(stagingArg);
if (project === packageRoot || staging === project || staging === packageRoot) throw new Error('Build roots must be distinct.');
await fs.mkdir(staging, { recursive: false, mode: 0o700 });
const records = [];
async function copyFile(root, relative, destinationRoot) {
  if (relative.split('/').some(part => part.startsWith('.env') || part === '..') || /\.(?:nwd|zip|svf|db|pf|pack|gz)$/i.test(relative)) throw new Error('Forbidden image input.');
  const source = path.join(root, ...relative.split('/')), stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || await fs.realpath(source) !== source || stat.size > 8 * 1024 ** 2) throw new Error('Unsafe source build input.');
  const destination = path.join(destinationRoot, ...relative.split('/')); await fs.mkdir(path.dirname(destination), { recursive: true });
  const bytes = await fs.readFile(source); await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o644 });
  records.push({ context: path.basename(destinationRoot), path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
async function copyTree(root, relative, destinationRoot, extensions) {
  const directory = path.join(root, relative);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const next = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error('Linked build inputs are forbidden.');
    if (entry.isDirectory()) await copyTree(root, next, destinationRoot, extensions);
    else if (extensions.includes(path.extname(entry.name))) await copyFile(root, next, destinationRoot);
    else throw new Error(`Unexpected build input: ${next}`);
  }
}
const preparer = path.join(staging, 'preparer'), packager = path.join(staging, 'package');
await fs.mkdir(preparer); await fs.mkdir(packager);
for (const file of ['index.mjs', 'package.json']) { await copyFile(project, file, preparer); await copyFile(packageRoot, file, packager); }
for (const dir of ['lib', 'app']) await copyTree(project, dir, preparer, ['.mjs']);
await copyTree(project, 'web', preparer, ['.mjs', '.js', '.css', '.html', '.svg', '.png']);
await copyTree(packageRoot, 'lib', packager, ['.mjs']);
await fs.writeFile(path.join(staging, 'build-input-inventory.json'), JSON.stringify({ schemaVersion: 1, nonce: randomUUID(), files: records }, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ status: 'PASS', preparerFiles: records.filter(file => file.context === 'preparer').length, packageFiles: records.filter(file => file.context === 'package').length, bytes: records.reduce((sum, file) => sum + file.bytes, 0) }) + '\n');
