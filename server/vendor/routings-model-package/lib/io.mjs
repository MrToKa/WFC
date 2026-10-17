import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fail, PackageError } from './errors.mjs';
import { assertLocalNoLinks } from './paths.mjs';

export function checkAbort(signal) {
  if (signal?.aborted) fail('PACKAGE_ABORTED', 'Operation cancelled or its time limit expired.');
}

export function decodeJsonText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail('INVALID_MANIFEST', 'JSON metadata must be valid UTF-8; replacement decoding is forbidden.'); }
}

export function contained(root, candidate) {
  const a = path.resolve(root).toLowerCase();
  const b = path.resolve(candidate).toLowerCase();
  return b === a || b.startsWith(a + path.sep);
}

export async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function hashStream(stream, { maxBytes, expectedBytes, signal } = {}) {
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      checkAbort(signal);
      bytes += chunk.length;
      if (maxBytes !== undefined && bytes > maxBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Stream byte limit exceeded.', { maxBytes, bytes });
      if (expectedBytes !== undefined && bytes > expectedBytes) fail('RESOURCE_SIZE_MISMATCH', 'Resource contains more bytes than declared.');
      hash.update(chunk);
    }
  } catch (error) { checkAbort(signal); throw error; }
  finally { stream.destroy(); }
  if (expectedBytes !== undefined && bytes !== expectedBytes) fail('RESOURCE_SIZE_MISMATCH', 'Resource byte count does not match its manifest.', { expectedBytes, bytes });
  return { bytes, sha256: hash.digest('hex') };
}

export async function hashFile(file, options = {}) {
  checkAbort(options.signal);
  await assertLocalNoLinks(file);
  const before = await fs.stat(file);
  const result = await hashStream(createReadStream(file, { signal: options.signal }), options);
  const after = await fs.stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || result.bytes !== before.size) {
    fail('RESOURCE_CHANGED', 'Input changed while it was being read.', { file });
  }
  return result;
}

export async function readBounded(file, maxBytes, signal) {
  checkAbort(signal);
  const chunks = [];
  let total = 0;
  await assertLocalNoLinks(file);
  const stream = createReadStream(file, { signal });
  try {
    for await (const chunk of stream) {
      checkAbort(signal); total += chunk.length;
      if (total > maxBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Metadata size limit exceeded.', { file, maxBytes });
      chunks.push(chunk);
    }
  } catch (error) { checkAbort(signal); throw error; }
  finally { stream.destroy(); }
  return Buffer.concat(chunks, total);
}

export async function ensureOutputParent(file, forbiddenRoots = []) {
  const target = path.resolve(file);
  for (const root of forbiddenRoots) if (contained(root, target)) fail('UNSAFE_PATH', 'Output/staging must be outside every input directory.', { target });
  let ancestor = path.dirname(target);
  while (!(await exists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) fail('UNSAFE_PATH', 'No safe output ancestor exists.');
    ancestor = parent;
  }
  await assertLocalNoLinks(ancestor, { directory: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await assertLocalNoLinks(path.dirname(target), { directory: true });
  if (await exists(target)) await assertLocalNoLinks(target);
  return target;
}

// Publish a completed file without ever overwriting an existing destination.
// Both files are in the same parent volume. Link makes the complete bytes visible
// atomically; removing the staging name immediately restores a single link.
export async function publishFile(staged, target) {
  try { await fs.link(staged, target); await fs.unlink(staged); }
  catch (error) {
    if (error.code === 'EEXIST') fail('OUTPUT_EXISTS', 'Destination already exists; it was preserved.', { target });
    if (error instanceof PackageError) throw error;
    if (error.code === 'ENOSPC') fail('STORAGE_EXHAUSTED', 'No space for publication.');
    fail('PUBLICATION_FAILED', 'Atomic no-overwrite publication failed; the existing package was preserved.', { target, cause: error.code });
  }
}

export async function writeJsonAtomic(file, data, { replace = false, forbiddenRoots = [] } = {}) {
  const target = await ensureOutputParent(file, forbiddenRoots);
  const temp = path.join(path.dirname(target), `.report-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (replace) {
      if (await exists(target)) await assertLocalNoLinks(target);
      await fs.rename(temp, target);
    } else await publishFile(temp, target);
  } finally { await fs.rm(temp, { force: true }); }
}

export async function extractVerified(zip, manifest, target, signal) {
  const destination = path.resolve(target);
  if (await exists(destination)) fail('OUTPUT_EXISTS', 'Extraction requires a new isolated directory.', { destination });
  await ensureOutputParent(destination);
  await fs.mkdir(destination, { mode: 0o700 });
  const listed = ['manifest.json', ...manifest.resources.map(resource => resource.path)];
  try {
    for (const name of listed) {
      checkAbort(signal);
      const output = path.join(destination, ...name.split('/'));
      await fs.mkdir(path.dirname(output), { recursive: true });
      await assertLocalNoLinks(path.dirname(output), { directory: true });
      const source = zip.stream(name, { signal });
      const digest = createHash('sha256'); let count = 0;
      const record = manifest.resources.find(resource => resource.path === name);
      const meter = new Transform({ transform(chunk, encoding, callback) {
        count += chunk.length;
        if (record && count > record.bytes) return callback(new PackageError('RESOURCE_SIZE_MISMATCH', 'Extraction exceeded manifest size.'));
        digest.update(chunk); callback(null, chunk);
      } });
      const { createWriteStream } = await import('node:fs');
      await pipeline(source, meter, createWriteStream(output, { flags: 'wx', mode: 0o600 }), { signal });
      const sha256 = digest.digest('hex');
      if (record && (count !== record.bytes || sha256 !== record.sha256)) fail('RESOURCE_HASH_MISMATCH', 'Extracted resource failed independent stream comparison.', { path: name });
    }
  } catch (error) {
    // This root was created by this operation and cannot contain pre-existing data.
    await fs.rm(destination, { recursive: true, force: true }); throw error;
  }
  return { directory: destination, resourceCount: manifest.resources.length, hashesCompared: manifest.resources.length, status: 'PASS' };
}
