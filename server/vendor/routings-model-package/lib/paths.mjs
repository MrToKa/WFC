import fs from 'node:fs/promises';
import path from 'node:path';
import { fail } from './errors.mjs';

const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

export function validateArchivePath(value, { allowDirectory = false } = {}) {
  if (typeof value !== 'string' || !value || value.length > 1024 || !/^[A-Za-z0-9._/ -]+$/.test(value) || value.startsWith('/')) {
    fail('UNSAFE_PATH', 'Archive paths must be canonical relative ASCII paths.', { path: value });
  }
  const directory = value.endsWith('/');
  if (directory && !allowDirectory) fail('UNSAFE_PATH', 'A file path cannot end with a slash.', { path: value });
  // Spaces are supported only for raster resource files and their directory records.
  if (value.includes(' ') && !(value.startsWith('resources/output/0/') &&
    (directory || /\.(?:png|jpe?g)$/i.test(value)))) {
    fail('UNSAFE_PATH', 'Spaces are supported only in raster resource paths.', { path: value });
  }
  const parts = (directory ? value.slice(0, -1) : value).split('/');
  for (const segment of parts) {
    if (!segment || segment === '.' || segment === '..' || segment.length > 255 || /[. ]$/.test(segment) || reserved.test(segment)) {
      fail('UNSAFE_PATH', 'Unsafe, reserved or noncanonical path segment.', { path: value, segment });
    }
  }
  return value;
}

export function validateResourcePath(value) {
  validateArchivePath(value);
  if (!value.startsWith('resources/') || value === 'resources/') {
    fail('UNSAFE_PATH', 'Model resources must be below resources/.', { path: value });
  }
  return value;
}

export function assertNoCaseCollisions(paths) {
  const seen = new Map();
  const prefixes = new Map();
  for (const value of paths) {
    validateArchivePath(value, { allowDirectory: true });
    const key = value.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) fail('UNSAFE_PATH', 'Duplicate or case-colliding archive path.', { path: value, previous: seen.get(key) });
    seen.set(key, value);
    const parts = value.replace(/\/$/, '').split('/');
    for (let index = 0; index < parts.length; index++) {
      const prefix = parts.slice(0, index + 1).join('/');
      const directory = index < parts.length - 1 || value.endsWith('/');
      const folded = prefix.toLowerCase();
      const previous = prefixes.get(folded);
      if (previous && (previous.path !== prefix || previous.directory !== directory)) {
        fail('UNSAFE_PATH', 'Case-colliding directory or file/parent path conflict.', { path: value, previous: previous.path });
      }
      prefixes.set(folded, { path: prefix, directory });
    }
  }
}

// Inspection only: callers still need exclusive staging and stable/open-file
// checks around IO. lstat/realpath cannot promise protection against a hostile
// process changing paths between inspection and use.
export async function assertLocalNoLinks(value, { directory = false } = {}) {
  const absolute = path.resolve(value);
  const root = path.parse(absolute).root;
  const parts = path.relative(root, absolute).split(path.sep).filter(Boolean);
  let current = root;
  const inspect = async (candidate, final) => {
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      fail('UNSAFE_PATH', 'Symlinks, junctions and special local files are unsupported.', { path: candidate });
    }
    if (stat.isFile() && stat.nlink !== 1) fail('UNSAFE_PATH', 'Hard-linked source files are unsupported.', { path: candidate });
    if (!final && !stat.isDirectory()) fail('UNSAFE_PATH', 'A source ancestor must be a directory.', { path: candidate });
    if (final && (directory ? !stat.isDirectory() : !stat.isFile())) {
      fail('UNSAFE_PATH', directory ? 'Expected a local directory.' : 'Expected a regular local file.', { path: candidate });
    }
    const real = await fs.realpath(candidate);
    const normalize = (p) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
    if (normalize(real) !== normalize(candidate)) fail('UNSAFE_PATH', 'A local path resolves outside its canonical location.', { path: candidate });
    return stat;
  };
  await inspect(root, parts.length === 0);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    await inspect(current, index === parts.length - 1);
  }
  return absolute;
}
