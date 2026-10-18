import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PathFinderError } from './errors.js';
import { uuid } from './contracts.js';

export async function pathFinderRoot(): Promise<string> {
  const root = process.env.PF_ROOT;
  if (!root || !path.isAbsolute(root)) throw new PathFinderError('PATHFINDER_STORAGE_NOT_CONFIGURED',503);
  await fs.mkdir(root,{recursive:true});
  if ((await fs.lstat(root)).isSymbolicLink() || await fs.realpath(root) !== path.resolve(root)) throw new PathFinderError('UNSAFE_PATHFINDER_STORAGE',503);
  return root;
}
export async function snapshotFilename(id: string): Promise<string> {
  const safe = uuid.parse(id), root = await pathFinderRoot();
  const directory = path.join(root,'snapshots'); await fs.mkdir(directory,{recursive:true});
  if ((await fs.lstat(directory)).isSymbolicLink() || await fs.realpath(directory) !== path.resolve(directory)) throw new PathFinderError('UNSAFE_PATHFINDER_STORAGE',503);
  return path.join(directory,`${safe}.json`);
}
export async function storeSnapshot(id: string, value: unknown): Promise<{sha256:string;bytes:number}> {
  const bytes = Buffer.from(JSON.stringify(value,(_key,item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new PathFinderError('NON_FINITE_SNAPSHOT');
    return item;
  }));
  if (bytes.length > 256 * 1024 * 1024) throw new PathFinderError('SNAPSHOT_BUDGET',413);
  const filename = await snapshotFilename(id), temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary,'wx',0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  // Link publishes without replacing another artifact. Unique server UUIDs are the only names admitted.
  await fs.link(temporary,filename); await fs.unlink(temporary);
  return {sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
export async function readSnapshot(id: string, expectedHash: string): Promise<Buffer> {
  const filename = await snapshotFilename(id), stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 256 * 1024 * 1024) throw new PathFinderError('ARTIFACT_INTEGRITY',409);
  const value = await fs.readFile(filename);
  if (createHash('sha256').update(value).digest('hex') !== expectedHash) throw new PathFinderError('ARTIFACT_INTEGRITY',409);
  return value;
}
