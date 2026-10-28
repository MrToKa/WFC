// Executed only inside a newly labelled isolated helper container.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function artifactInventory(root) {
  if (!path.isAbsolute(root)) throw Error('PF_ARTIFACT_ROOT_INVALID');
  const files = []; let bytes = 0;
  async function walk(directory, prefix = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entry.isSymbolicLink()) throw Error('PF_ARTIFACT_LINK_REFUSED');
      const filename = path.join(directory, entry.name), relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(filename, relative + '/');
      else {
        const before = await fs.lstat(filename, { bigint: true });
        if (!entry.isFile() || before.nlink !== 1n || before.size > 2n * 1024n ** 3n || files.length >= 500000) throw Error('PF_ARTIFACT_LIMIT');
        const handle = await fs.open(filename, 'r'), digest = createHash('sha256');
        try { for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk); }
        finally { await handle.close(); }
        const after = await fs.lstat(filename, { bigint: true });
        if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) throw Error('PF_ARTIFACT_CHANGED');
        bytes += Number(before.size); if (bytes > 16 * 1024 ** 3) throw Error('PF_ARTIFACT_LIMIT');
        files.push({ path: relative, bytes: Number(before.size), sha256: digest.digest('hex') });
      }
    }
  }
  await walk(root);
  return { status: 'PASS', files, totalBytes: bytes, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== 'inventory') throw Error('PF_ARTIFACT_ARGUMENT_INVALID');
    console.log(JSON.stringify(await artifactInventory(process.argv[3])));
  } catch { console.log(JSON.stringify({ status: 'FAIL', code: 'PF_ARTIFACT_AUDIT_FAILED' })); process.exitCode = 1; }
}
