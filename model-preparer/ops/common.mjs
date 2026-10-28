import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export class OperationsError extends Error { constructor(code) { super(code); this.name = 'OperationsError'; this.code = code; } }
export const fail = code => { throw new OperationsError(code); };
export const SHA = /^[a-f0-9]{64}$/;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const MODES = ['closed', 'simulation', 'live'];
export const ROOTS = Object.freeze({ data: '/var/lib/preparer/data', work: '/var/lib/preparer/work', outputs: '/var/lib/preparer/outputs', imports: '/imports', sources: '/sources', proof: '/proof' });
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  fail('INVALID_SERIALIZABLE_VALUE');
}
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const inside = (root, file) => { const rel = path.relative(root, file); return rel === '' || !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`); };
export function relative(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\\') || value.includes(':') || /[\x00-\x1f\x7f]/.test(value)
    || value.startsWith('/') || value.split('/').some(piece => !piece || piece === '.' || piece === '..' || /[ .]$/.test(piece))) fail('UNSAFE_PATH');
  return value;
}
export function parseJson(text, maxBytes = 32 * 1024 ** 2) {
  if (Buffer.isBuffer(text)) { if (text.length > maxBytes) fail('LIMIT_EXCEEDED'); try { text = new TextDecoder('utf-8', { fatal: true }).decode(text); } catch { fail('INVALID_JSON'); } }
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes) fail('LIMIT_EXCEEDED');
  let offset = 0;
  const skip = () => { while (/[\x20\t\r\n]/.test(text[offset] ?? '') && offset < text.length) offset++; };
  const string = () => {
    const start = offset++; let escaped = false;
    while (offset < text.length) {
      const character = text[offset++];
      if (!escaped && character === '"') { try { return JSON.parse(text.slice(start, offset)); } catch { fail('INVALID_JSON'); } }
      if (!escaped && character.charCodeAt(0) < 32) fail('INVALID_JSON');
      escaped = !escaped && character === '\\';
    }
    fail('INVALID_JSON');
  };
  const value = depth => {
    if (depth > 64) fail('LIMIT_EXCEEDED'); skip(); const character = text[offset];
    if (character === '"') return string();
    if (character === '{') {
      offset++; skip(); const result = {}, keys = new Set(); if (text[offset] === '}') { offset++; return result; }
      for (;;) {
        skip(); if (text[offset] !== '"') fail('INVALID_JSON'); const key = string(); if (keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('INVALID_JSON'); keys.add(key);
        skip(); if (text[offset++] !== ':') fail('INVALID_JSON'); result[key] = value(depth + 1); skip();
        const next = text[offset++]; if (next === '}') return result; if (next !== ',') fail('INVALID_JSON');
      }
    }
    if (character === '[') {
      offset++; skip(); const result = []; if (text[offset] === ']') { offset++; return result; }
      for (;;) { result.push(value(depth + 1)); skip(); const next = text[offset++]; if (next === ']') return result; if (next !== ',') fail('INVALID_JSON'); }
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(offset));
    if (!match) fail('INVALID_JSON'); offset += match[0].length; const result = JSON.parse(match[0]); if (typeof result === 'number' && !Number.isFinite(result)) fail('INVALID_JSON'); return result;
  };
  const result = value(0); skip(); if (offset !== text.length) fail('INVALID_JSON'); return result;
}
export function exact(value, fields) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) fail('INVALID_MANIFEST');
}
export async function noLinks(file, { directory = false, absent = false } = {}) {
  if (!path.isAbsolute(file) || file !== path.resolve(file)) fail('UNSAFE_PATH');
  let current = path.parse(file).root;
  const pieces = file.slice(current.length).split(path.sep).filter(Boolean);
  for (let n = 0; n < pieces.length; n++) {
    current = path.join(current, pieces[n]); let stat;
    try { stat = await fs.lstat(current); } catch (error) { if (absent && error.code === 'ENOENT' && n === pieces.length - 1) return null; throw error; }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || stat.isFile() && stat.nlink !== 1) fail('UNSAFE_PATH');
    if (n < pieces.length - 1 && !stat.isDirectory()) fail('UNSAFE_PATH');
  }
  const stat = await fs.lstat(file); if (directory !== stat.isDirectory()) fail('UNSAFE_PATH');
  if (await fs.realpath(file) !== file) fail('UNSAFE_PATH'); return stat;
}
export const sameStamp = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
export async function run(command, args, { input, cwd, maxBytes = 32 * 1024 ** 2, timeoutMs = 1_800_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '', total = 0;
    const timer = setTimeout(() => { child.kill(); reject(new OperationsError('COMMAND_TIMEOUT')); }, timeoutMs);
    const add = (which, chunk) => { total += chunk.length; if (total > maxBytes) { child.kill(); reject(new OperationsError('COMMAND_OUTPUT_LIMIT')); return; } if (which === 'out') stdout += chunk; else stderr += chunk; };
    child.stdout.on('data', chunk => add('out', chunk)); child.stderr.on('data', chunk => add('err', chunk));
    child.once('error', () => { clearTimeout(timer); reject(new OperationsError('COMMAND_FAILED')); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0) { const error = new OperationsError('COMMAND_FAILED'); error.stderr = stderr; reject(error); } else resolve(stdout); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
export async function secureDirectory(file, { create = false } = {}) {
  if (create) { await noLinks(path.dirname(file), { directory: true }); await fs.mkdir(file, { mode: 0o700 }); }
  await noLinks(file, { directory: true });
  if (process.platform === 'win32') {
    // Fixed code, with the literal path carried over stdin rather than shell interpolation.
    const script = `$ErrorActionPreference='Stop';$opsPath=[Console]::In.ReadToEnd();$opsUser=[Security.Principal.WindowsIdentity]::GetCurrent().User;$opsSystem=[Security.Principal.SecurityIdentifier]::new('S-1-5-18');$opsAcl=[Security.AccessControl.DirectorySecurity]::new();$opsAcl.SetOwner($opsUser);$opsAcl.SetAccessRuleProtection($true,$false);foreach($opsSid in @($opsUser,$opsSystem)){$opsRule=[Security.AccessControl.FileSystemAccessRule]::new($opsSid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);$opsAcl.AddAccessRule($opsRule)};[IO.Directory]::SetAccessControl($opsPath,$opsAcl);$opsCheck=[IO.Directory]::GetAccessControl($opsPath);$opsRules=@($opsCheck.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));if(!$opsCheck.AreAccessRulesProtected -or $opsRules.Count -ne 2 -or @($opsRules|Where-Object{$_.IdentityReference.Value -notin @($opsUser.Value,$opsSystem.Value) -or $_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne 'FullControl'}).Count){throw 'PRIVATE_ACL_FAILED'}`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { input: file });
  } else { await fs.chmod(file, 0o700); if ((await fs.stat(file)).mode & 0o077) fail('PRIVATE_PERMISSIONS_FAILED'); }
}
export async function writeExclusive(file, value, mode = 0o600) {
  const handle = await fs.open(file, 'wx', mode); try { await handle.writeFile(typeof value === 'string' || Buffer.isBuffer(value) ? value : `${canonical(value)}\n`); await handle.sync(); } finally { await handle.close(); }
}
export async function hashFile(file, { maxBytes = 32 * 1024 ** 3 } = {}) {
  const before = await noLinks(file); if (before.size > maxBytes) fail('LIMIT_EXCEEDED');
  const handle = await fs.open(file, 'r'); let bytes = 0; const hash = createHash('sha256');
  try { if (!sameStamp(before, await handle.stat())) fail('INPUT_CHANGED'); for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; if (bytes > maxBytes) fail('LIMIT_EXCEEDED'); hash.update(chunk); }
    if (bytes !== before.size || !sameStamp(before, await handle.stat()) || !sameStamp(before, await fs.lstat(file))) fail('INPUT_CHANGED');
    return { bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
export async function boundedRead(file, maxBytes = 32 * 1024 ** 2) {
  const before = await noLinks(file); if (before.size > maxBytes) fail('LIMIT_EXCEEDED');
  const handle = await fs.open(file, 'r');
  try { if (!sameStamp(before, await handle.stat())) fail('INPUT_CHANGED'); const chunks = []; let size = 0; for await (const chunk of handle.createReadStream({ autoClose: false })) { size += chunk.length; if (size > maxBytes) fail('LIMIT_EXCEEDED'); chunks.push(chunk); }
    if (!sameStamp(before, await handle.stat()) || !sameStamp(before, await fs.lstat(file))) fail('INPUT_CHANGED'); return Buffer.concat(chunks, size); }
  finally { await handle.close(); }
}
export async function putBlob(root, file) {
  const objects = path.join(root, 'objects'); await fs.mkdir(objects, { recursive: true, mode: 0o700 }); await noLinks(objects, { directory: true });
  const before = await noLinks(file), input = await fs.open(file, 'r'), temporary = path.join(objects, `.capture-${randomUUID()}.tmp`), output = await fs.open(temporary, 'wx', 0o600);
  const hash = createHash('sha256'); let bytes = 0;
  try {
    if (!sameStamp(before, await input.stat())) fail('INPUT_CHANGED');
    for await (const chunk of input.createReadStream({ autoClose: false })) { bytes += chunk.length; if (bytes > 32 * 1024 ** 3) fail('LIMIT_EXCEEDED'); hash.update(chunk); await output.writeFile(chunk); }
    if (!sameStamp(before, await input.stat()) || !sameStamp(before, await fs.lstat(file)) || bytes !== before.size) fail('INPUT_CHANGED');
    await output.sync(); const sha256 = hash.digest('hex'), destination = path.join(objects, sha256);
    try { await fs.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL); } catch (error) { if (error.code !== 'EEXIST') throw error; const existing = await hashFile(destination); if (existing.sha256 !== sha256 || existing.bytes !== bytes) fail('BACKUP_CORRUPT'); }
    return { bytes, sha256 };
  } finally { await input.close(); await output.close(); await fs.rm(temporary, { force: true }); }
}
