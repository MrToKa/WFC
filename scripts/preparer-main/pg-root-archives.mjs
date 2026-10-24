// Dedicated PostgreSQL 18 volume-root format. Copied from foundation/archives.mjs
// SHA256 2f0f89696c13a66eaab0bc4006b57240944fac5be01cf6d88518b4674c5f5066.
// The generic archive remains unchanged and continues to reject every link.
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
export const PG_ROOT_ARCHIVE_FORMAT = 'WFCPGROOT';
export const PG_ROOT_ARCHIVE_VERSION = 2;
const MAGIC = Buffer.from('WFCPG02\n');
const PG_VERSION_PATH = '18/docker/PG_VERSION';
const PG_VERSION_BYTES = Buffer.from('18\n');
const PG_VERSION_HASH = createHash('sha256').update(PG_VERSION_BYTES).digest('hex');
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const CHUNK = 1024 * 1024;
export const DEFAULT_ARCHIVE_LIMITS = Object.freeze({ maxMembers: 1_000_000, maxHeaderBytes: 32_768,
  maxMetadataBytes: 256 * 1024 ** 2, maxFileBytes: 8 * 1024 ** 4, maxTotalBytes: 32 * 1024 ** 4, maxDepth: 128 });
export class ArchiveError extends Error {
  constructor(code) { super(code); this.name = 'ArchiveError'; this.code = code; }
}
const fail = code => { throw new ArchiveError(code); };
const abort = signal => { if (signal?.aborted) fail('ARCHIVE_INTERRUPTED'); };
const canonical = value => Buffer.from(JSON.stringify(value));
const stamp = stat => [stat.dev,stat.ino,stat.size,stat.nlink,stat.mode,stat.uid,stat.gid,stat.mtimeNs,stat.ctimeNs].join(':');
const samePath = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function limitsFor(input = {}) {
  const result = { ...DEFAULT_ARCHIVE_LIMITS, ...input };
  for (const [key,value] of Object.entries(result)) if (!(key in DEFAULT_ARCHIVE_LIMITS) || !Number.isSafeInteger(value) || value < 1) fail('ARCHIVE_LIMIT_INVALID');
  return result;
}
export function validateMemberPath(value, { root = false } = {}) {
  if (root && value === '') return '';
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 16_384 || value.startsWith('/') ||
      /^[a-z]:/i.test(value) || /[\\\u0000-\u001f\u007f]/u.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..' || Buffer.byteLength(part) > 255)) fail('ARCHIVE_UNSAFE_PATH');
  return value;
}
export async function assertCanonicalPath(input, { directory = false, allowMissing = false } = {}) {
  const resolved = path.resolve(input);
  const parsed = path.parse(resolved); let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current,part);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) { if (allowMissing && error.code === 'ENOENT' && current === resolved) return resolved; throw error; }
    if (stat.isSymbolicLink()) fail('ARCHIVE_LINK_REJECTED');
  }
  const stat = await fs.lstat(resolved);
  if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) fail('ARCHIVE_TYPE_REJECTED');
  if (!samePath(await fs.realpath(resolved),resolved)) fail('ARCHIVE_LINK_REJECTED');
  return resolved;
}
function closedAlias(value) {
  if (value.path !== 'data' || value.type !== 'symlink' || value.target !== '.' || value.nlink !== 1 || value.mode !== 0o777 || value.uid !== 0 || value.gid !== 0) fail('ARCHIVE_PG_ALIAS_INVALID');
}
function pgEntries(entries) {
  const direct = entries.filter(entry => entry.path && !entry.path.includes('/'));
  const directory = entries.find(entry => entry.path === '18'), data = entries.find(entry => entry.path === 'data');
  const pgdata = entries.find(entry => entry.path === '18/docker'), version = entries.find(entry => entry.path === PG_VERSION_PATH);
  if (direct.length !== 2 || directory?.type !== 'directory' || !data || pgdata?.type !== 'directory' || version?.type !== 'file' || version.bytes !== PG_VERSION_BYTES.length || version.sha256 !== PG_VERSION_HASH) fail('ARCHIVE_PG_LAYOUT_INVALID');
  closedAlias(data);
  for (const entry of entries) if (entry.path && entry.path !== 'data' && entry.path !== '18' && !entry.path.startsWith('18/')) fail('ARCHIVE_PG_LAYOUT_INVALID');
}
async function aliasStat(filename) {
  await assertCanonicalPath(path.dirname(filename), { directory: true });
  const stat = await fs.lstat(filename, { bigint: true });
  if (!stat.isSymbolicLink()) fail('ARCHIVE_PG_ALIAS_INVALID');
  closedAlias({ path: 'data', type: 'symlink', target: await fs.readlink(filename), nlink: Number(stat.nlink), mode: Number(stat.mode) & 0o777, uid: Number(stat.uid), gid: Number(stat.gid) });
  if (stamp(stat) !== stamp(await fs.lstat(filename, { bigint: true }))) fail('ARCHIVE_SOURCE_CHANGED');
  return stat;
}
async function pgRoot(source) {
  if (process.platform !== 'linux') fail('ARCHIVE_PG_PLATFORM_REQUIRED');
  const root = await assertCanonicalPath(source, { directory: true });
  if ((await fs.readdir(root)).sort().join('|') !== '18|data') fail('ARCHIVE_PG_LAYOUT_INVALID');
  await assertCanonicalPath(path.join(root, '18'), { directory: true });
  await assertCanonicalPath(path.join(root, '18', 'docker'), { directory: true });
  await aliasStat(path.join(root, 'data'));
  const version = path.join(root, ...PG_VERSION_PATH.split('/')); await assertCanonicalPath(version);
  const handle = await fs.open(version, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(PG_VERSION_BYTES.length) || !(await handle.readFile()).equals(PG_VERSION_BYTES)) fail('ARCHIVE_PG_LAYOUT_INVALID');
    if (stamp(before) !== stamp(await handle.stat({ bigint: true })) || stamp(before) !== stamp(await fs.lstat(version, { bigint: true }))) fail('ARCHIVE_SOURCE_CHANGED');
  } finally { await handle.close(); }
  return root;
}
function collisionTable() {
  const names = new Map();
  return (name,type) => {
    const key = name.normalize('NFC').toLowerCase();
    if (names.has(key)) fail('ARCHIVE_DUPLICATE_MEMBER');
    if (name) {
      const parts = name.split('/'); parts.pop(); const parent = parts.join('/');
      const known = names.get(parent.normalize('NFC').toLowerCase());
      if (!known || known.name !== parent || known.type !== 'directory') fail('ARCHIVE_PARENT_INVALID');
    } else if (names.size || type !== 'directory') fail('ARCHIVE_ROOT_INVALID');
    names.set(key,{ name,type });
  };
}
async function writeAll(handle,bytes) {
  let offset = 0;
  while (offset < bytes.length) { const result = await handle.write(bytes,offset,bytes.length-offset); if (!result.bytesWritten) fail('ARCHIVE_WRITE_FAILED'); offset += result.bytesWritten; }
}
export function createBufferedArchiveWriter(handle){
  const buffer=Buffer.allocUnsafe(CHUNK);let used=0;
  const flush=async()=>{if(used){await writeAll(handle,buffer.subarray(0,used));used=0;}};
  return{flush,async write(bytes,offset,length){let copied=0;while(copied<length){const count=Math.min(buffer.length-used,length-copied);bytes.copy(buffer,used,offset+copied,offset+copied+count);used+=count;copied+=count;if(used===buffer.length)await flush();}return{bytesWritten:length};}};
}
async function writeHeader(handle,value,limits) {
  const bytes = canonical(value); if (bytes.length > limits.maxHeaderBytes) fail('ARCHIVE_LIMIT_EXCEEDED');
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); await writeAll(handle,length); await writeAll(handle,bytes);
  return 4+bytes.length;
}
async function hashHandle(handle,size,signal,write) {
  const digest = createHash('sha256'),buffer = Buffer.allocUnsafe(CHUNK); let position = 0;
  while (position < size) {
    abort(signal); const count = Math.min(buffer.length,size-position),read = await handle.read(buffer,0,count,position);
    if (!read.bytesRead) fail('ARCHIVE_TRUNCATED');
    const chunk = buffer.subarray(0,read.bytesRead); digest.update(chunk); if (write) await write(chunk); position += read.bytesRead;
  }
  return digest.digest('hex');
}
export async function hashFile(filename,{ signal } = {}) {
  await assertCanonicalPath(filename); const handle = await fs.open(filename,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { const before = await handle.stat({ bigint:true }),sha256 = await hashHandle(handle,Number(before.size),signal); const after = await handle.stat({ bigint:true });
    await assertCanonicalPath(filename);
    if (stamp(before) !== stamp(after) || stamp(before) !== stamp(await fs.lstat(filename,{ bigint:true }))) fail('ARCHIVE_SOURCE_CHANGED');
    return { bytes:Number(before.size),sha256 };
  } finally { await handle.close(); }
}
export async function measureDirectory(source,{signal}={}){
  const root=await pgRoot(source),register=collisionTable();let files=0,members=0,totalBytes=0;
  const visit=async(absolute,name,depth)=>{
    abort(signal);validateMemberPath(name,{root:members===0});if(++members>DEFAULT_ARCHIVE_LIMITS.maxMembers||depth>DEFAULT_ARCHIVE_LIMITS.maxDepth)fail('ARCHIVE_LIMIT_EXCEEDED');
    const stat=await fs.lstat(absolute,{bigint:true});
    if(stat.isSymbolicLink()){if(name!=='data')fail('ARCHIVE_TYPE_REJECTED');register(name,'symlink');await aliasStat(absolute);return;}
    if(!stat.isDirectory()&&!stat.isFile()||stat.isFile()&&stat.nlink!==1n)fail('ARCHIVE_TYPE_REJECTED');
    if((Number(stat.mode)&0o7000)!==0)fail('ARCHIVE_MODE_REJECTED');
    register(name,stat.isDirectory()?'directory':'file');
    if(stat.isFile()){const size=Number(stat.size);files++;totalBytes+=size;if(!Number.isSafeInteger(size)||!Number.isSafeInteger(totalBytes)||size>DEFAULT_ARCHIVE_LIMITS.maxFileBytes||totalBytes>DEFAULT_ARCHIVE_LIMITS.maxTotalBytes)fail('ARCHIVE_LIMIT_EXCEEDED');}
    else for(const child of await fs.readdir(absolute))await visit(path.join(absolute,child),name?name+'/'+child:child,depth+1);
  };
  await visit(root,'',0);await pgRoot(root);const stat=await fs.statfs(root,{bigint:true});return{status:'PASS',files,members,totalBytes,availableBytes:String(stat.bavail*stat.bsize)};
}
export async function captureArchive(source,filename,{ limits: input,signal } = {}) {
  const limits = limitsFor(input),root = await pgRoot(source),target = path.resolve(filename);
  const relative = path.relative(root,target); if (!relative.startsWith('..'+path.sep) && relative !== '..' && !path.isAbsolute(relative)) fail('ARCHIVE_TARGET_INSIDE_SOURCE');
  await assertCanonicalPath(path.dirname(target),{ directory:true });
  const output = await fs.open(target,constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),0o600);
  const sink=createBufferedArchiveWriter(output);
  const entries = [],identities = [],register = collisionTable(); let totalBytes = 0,metadataBytes = 0;
  try {
    await writeAll(sink,MAGIC);
    const visit = async (absolute,name) => {
      abort(signal); if (entries.length >= limits.maxMembers || name.split('/').length > limits.maxDepth) fail('ARCHIVE_LIMIT_EXCEEDED');
      validateMemberPath(name,{ root:entries.length===0 });
      const stat = await fs.lstat(absolute,{ bigint:true });
      if (stat.isSymbolicLink() ? name !== 'data' : !stat.isFile() && !stat.isDirectory() || stat.isFile() && stat.nlink !== 1n) fail('ARCHIVE_TYPE_REJECTED');
      if ((Number(stat.mode)&0o7000) !== 0) fail('ARCHIVE_MODE_REJECTED');
      const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file'; register(name,type);
      const common = { path:name,type,mode:Number(stat.mode)&0o777,uid:Number(stat.uid),gid:Number(stat.gid),mtimeNs:String(stat.mtimeNs) };
      if (type === 'symlink') {
        const header = { ...common,target:await fs.readlink(absolute),nlink:Number(stat.nlink) }; closedAlias(header);
        if (stamp(stat) !== stamp(await fs.lstat(absolute,{bigint:true}))) fail('ARCHIVE_SOURCE_CHANGED');
        metadataBytes += await writeHeader(sink,header,limits); entries.push(header); identities.push({ absolute,stamp:stamp(stat) });
      } else if (type === 'directory') {
        metadataBytes += await writeHeader(sink,common,limits); entries.push(common); identities.push({ absolute,stamp:stamp(stat) });
        const children = (await fs.readdir(absolute)).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
        for (const child of children) await visit(path.join(absolute,child),name ? name+'/'+child : child);
      } else {
        const bytes = Number(stat.size); totalBytes += bytes;
        if (!Number.isSafeInteger(bytes) || bytes > limits.maxFileBytes || totalBytes > limits.maxTotalBytes) fail('ARCHIVE_LIMIT_EXCEEDED');
        const input = await fs.open(absolute,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          if (stamp(stat) !== stamp(await input.stat({ bigint:true }))) fail('ARCHIVE_SOURCE_CHANGED');
          const sha256 = await hashHandle(input,bytes,signal),header = { ...common,bytes,sha256 };
          metadataBytes += await writeHeader(sink,header,limits); const copied = await hashHandle(input,bytes,signal,chunk=>writeAll(sink,chunk));
          if (copied !== sha256 || stamp(stat) !== stamp(await input.stat({ bigint:true })) || stamp(stat) !== stamp(await fs.lstat(absolute,{ bigint:true }))) fail('ARCHIVE_SOURCE_CHANGED');
          entries.push(header); identities.push({ absolute,stamp:stamp(stat) });
        } finally { await input.close(); }
      }
      if (metadataBytes > limits.maxMetadataBytes) fail('ARCHIVE_LIMIT_EXCEEDED');
    };
    await visit(root,'');
    pgEntries(entries);
    for (const identity of identities) if (identity.stamp !== stamp(await fs.lstat(identity.absolute,{ bigint:true }))) fail('ARCHIVE_SOURCE_CHANGED');
    await writeAll(sink,Buffer.alloc(4)); await writeHeader(sink,{ format:PG_ROOT_ARCHIVE_FORMAT,version:PG_ROOT_ARCHIVE_VERSION,members:entries.length,files:entries.filter(entry=>entry.type==='file').length,totalBytes },limits);
    await sink.flush();
    await output.sync();
  } finally { await output.close(); }
  return { format:PG_ROOT_ARCHIVE_FORMAT,version:PG_ROOT_ARCHIVE_VERSION,...await hashFile(target,{ signal }),members:entries.length,files:entries.filter(entry=>entry.type==='file').length,totalBytes };
}
function validateHeader(value,index,limits) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['file','directory','symlink'].includes(value.type)) fail('ARCHIVE_TYPE_REJECTED');
  const keys = ['path','type','mode','uid','gid','mtimeNs',...(value.type==='file'?['bytes','sha256']:value.type==='symlink'?['target','nlink']:[])];
  if (Object.keys(value).join('|') !== keys.join('|')) fail('ARCHIVE_HEADER_INVALID');
  validateMemberPath(value.path,{ root:index===0 });
  if (!Number.isInteger(value.mode) || value.mode<0 || value.mode>0o777 || !Number.isInteger(value.uid) || value.uid<0 || value.uid>0xfffffffe ||
      !Number.isInteger(value.gid) || value.gid<0 || value.gid>0xfffffffe || typeof value.mtimeNs !== 'string' || !/^-?[0-9]{1,22}$/.test(value.mtimeNs) || value.path.split('/').length>limits.maxDepth) fail('ARCHIVE_HEADER_INVALID');
  if (value.type==='file' && (!Number.isSafeInteger(value.bytes) || value.bytes<0 || value.bytes>limits.maxFileBytes || !/^[a-f0-9]{64}$/.test(value.sha256))) fail('ARCHIVE_HEADER_INVALID');
  if (value.type==='symlink') closedAlias(value);
}
async function scan(handle,{ limits,signal,expectedSha256 }) {
  const stat = await handle.stat({ bigint:true }),size = Number(stat.size),digest = createHash('sha256'); let position=0,metadataBytes=0,totalBytes=0;
  if (!Number.isSafeInteger(size) || size > limits.maxTotalBytes + limits.maxMetadataBytes + MAGIC.length + 8) fail('ARCHIVE_LIMIT_EXCEEDED');
  const entries=[],register=collisionTable();
  const cache=Buffer.allocUnsafe(CHUNK);let cacheStart=0,cacheLength=0;
  const read = async count => {
    if (!Number.isSafeInteger(count) || count<0 || position+count>size) fail('ARCHIVE_TRUNCATED');
    const buffer=Buffer.allocUnsafe(count);let done=0;
    while(done<count){
      abort(signal);
      if(position<cacheStart||position>=cacheStart+cacheLength){cacheStart=position;const value=await handle.read(cache,0,Math.min(cache.length,size-position),position);if(!value.bytesRead)fail('ARCHIVE_TRUNCATED');cacheLength=value.bytesRead;}
      const available=Math.min(count-done,cacheStart+cacheLength-position);cache.copy(buffer,done,position-cacheStart,position-cacheStart+available);done+=available;position+=available;
    }
    digest.update(buffer);return buffer;
  };
  if (!(await read(MAGIC.length)).equals(MAGIC)) fail('ARCHIVE_FORMAT_INVALID');
  const header = async length => {
    if (length<2 || length>limits.maxHeaderBytes) fail('ARCHIVE_LIMIT_EXCEEDED');metadataBytes+=length+4;if(metadataBytes>limits.maxMetadataBytes)fail('ARCHIVE_LIMIT_EXCEEDED');
    const raw=await read(length);let value;try{value=JSON.parse(UTF8.decode(raw));}catch{fail('ARCHIVE_HEADER_INVALID');}
    if(!canonical(value).equals(raw))fail('ARCHIVE_HEADER_INVALID');return value;
  };
  for(;;){
    const length=(await read(4)).readUInt32BE();
    if(length===0){const footer=await header((await read(4)).readUInt32BE());const expected={format:PG_ROOT_ARCHIVE_FORMAT,version:PG_ROOT_ARCHIVE_VERSION,members:entries.length,files:entries.filter(value=>value.type==='file').length,totalBytes};if(!canonical(footer).equals(canonical(expected))||position!==size||entries.length===0)fail('ARCHIVE_FOOTER_INVALID');pgEntries(entries);break;}
    if(entries.length>=limits.maxMembers)fail('ARCHIVE_LIMIT_EXCEEDED');const value=await header(length);validateHeader(value,entries.length,limits);register(value.path,value.type);
    const entry={...value,offset:position};entries.push(entry);
    if(value.type==='file'){
      totalBytes+=value.bytes;if(!Number.isSafeInteger(totalBytes)||totalBytes>limits.maxTotalBytes)fail('ARCHIVE_LIMIT_EXCEEDED');const fileDigest=createHash('sha256');let left=value.bytes;
      while(left){const chunk=await read(Math.min(CHUNK,left));fileDigest.update(chunk);left-=chunk.length;}
      if(fileDigest.digest('hex')!==value.sha256)fail('ARCHIVE_MEMBER_HASH_MISMATCH');
    }
  }
  const sha256=digest.digest('hex');if(expectedSha256!==undefined&&(!/^[a-f0-9]{64}$/.test(expectedSha256)||sha256!==expectedSha256))fail('ARCHIVE_HASH_MISMATCH');
  if(stamp(stat)!==stamp(await handle.stat({bigint:true})))fail('ARCHIVE_SOURCE_CHANGED');
  return{format:PG_ROOT_ARCHIVE_FORMAT,version:PG_ROOT_ARCHIVE_VERSION,bytes:size,sha256,members:entries.length,files:entries.filter(value=>value.type==='file').length,totalBytes,entries};
}
export async function verifyArchive(filename,{ limits:input,signal,expectedSha256 }={}) {
  await assertCanonicalPath(filename);const handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{return await scan(handle,{limits:limitsFor(input),signal,expectedSha256});}finally{await handle.close();}
}
async function metadata(filename,entry) {
  if(entry.type==='symlink'){
    // Every operation here acts on the link itself. Never chmod or stat its target.
    const before=await aliasStat(filename),ns=BigInt(entry.mtimeNs),absolute=ns<0n?-ns:ns,seconds=absolute/1_000_000_000n,remainder=absolute%1_000_000_000n;
    await fs.lchown(filename,entry.uid,entry.gid);
    await fs.lutimes(filename,Number(ns)/1e9,Number(ns)/1e9);
    await execute('touch',['--no-dereference','--no-create','-m','--date=@'+(ns<0n?'-':'')+seconds+'.'+String(remainder).padStart(9,'0'),filename],{windowsHide:true});
    const after=await aliasStat(filename);
    if(after.dev!==before.dev||after.ino!==before.ino||after.mtimeNs!==ns||(Number(after.mode)&0o777)!==entry.mode||Number(after.uid)!==entry.uid||Number(after.gid)!==entry.gid)fail('ARCHIVE_METADATA_MISMATCH');
    return;
  }
  if(process.platform==='linux')await fs.chown(filename,entry.uid,entry.gid);
  await fs.chmod(filename,entry.mode);
  const ns=BigInt(entry.mtimeNs),absolute=ns<0n?-ns:ns,seconds=absolute/1_000_000_000n,remainder=absolute%1_000_000_000n;
  if(process.platform==='linux'){
    // Debian operations image supplies coreutils; unlike floating-point utimes this retains nanoseconds.
    await execute('touch',['--no-dereference','--no-create','-m','--date=@'+(ns<0n?'-':'')+seconds+'.'+String(remainder).padStart(9,'0'),filename],{windowsHide:true});
    const after=await fs.stat(filename,{bigint:true});if(after.mtimeNs!==ns)fail('ARCHIVE_METADATA_MISMATCH');
  }else await fs.utimes(filename,Number(ns)/1e9,Number(ns)/1e9);
}
export async function restoreArchive(filename,target,{ limits:input,signal,expectedSha256 }={}) {
  if(process.platform!=='linux')fail('ARCHIVE_PG_PLATFORM_REQUIRED');
  if(!/^[a-f0-9]{64}$/.test(expectedSha256??''))fail('ARCHIVE_EXPECTED_HASH_REQUIRED');
  await assertCanonicalPath(filename);const root=await assertCanonicalPath(target,{directory:true});
  if((await fs.readdir(root)).length)fail('ARCHIVE_TARGET_NOT_EMPTY');
  const handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await handle.stat({bigint:true}),report=await scan(handle,{limits:limitsFor(input),signal,expectedSha256});
    for(const entry of report.entries){
      abort(signal);const destination=entry.path?path.join(root,...entry.path.split('/')):root;
      await assertCanonicalPath(path.dirname(destination),{directory:true});
      if(entry.type==='directory'){if(entry.path)await fs.mkdir(destination,{mode:0o700});continue;}
      if(entry.type==='symlink'){closedAlias(entry);await fs.symlink('.',destination);await aliasStat(destination);continue;}
      const output=await fs.open(destination,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);
      try{const digest=createHash('sha256');let position=entry.offset,left=entry.bytes;const buffer=Buffer.allocUnsafe(CHUNK);
        while(left){abort(signal);const result=await handle.read(buffer,0,Math.min(buffer.length,left),position);if(!result.bytesRead)fail('ARCHIVE_TRUNCATED');const chunk=buffer.subarray(0,result.bytesRead);digest.update(chunk);await writeAll(output,chunk);position+=chunk.length;left-=chunk.length;}
        if(digest.digest('hex')!==entry.sha256)fail('ARCHIVE_MEMBER_HASH_MISMATCH');await output.sync();
      }finally{await output.close();}
    }
    await assertCanonicalPath(filename);
    if(stamp(before)!==stamp(await handle.stat({bigint:true}))||stamp(before)!==stamp(await fs.lstat(filename,{bigint:true})))fail('ARCHIVE_SOURCE_CHANGED');
    for(const entry of [...report.entries].reverse())await metadata(entry.path?path.join(root,...entry.path.split('/')):root,entry);
    return{...report,entries:undefined,status:'PASS',targetFresh:true,fullOuterHashVerifiedBeforeWrites:true};
  }finally{await handle.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,source,target,expectedSha256]=process.argv.slice(2);
  try{let result;if(command==='capture'&&source&&target)result=await captureArchive(source,target);else if(command==='restore'&&source&&target&&expectedSha256)result=await restoreArchive(source,target,{expectedSha256});else if(command==='verify'&&source)result=await verifyArchive(source,{expectedSha256:target});else if(command==='measure'&&source)result=await measureDirectory(source);else fail('ARCHIVE_ARGUMENT_INVALID');console.log(JSON.stringify({status:'PASS',...result,entries:undefined}));}
  catch(error){console.log(JSON.stringify({status:'FAIL',code:error instanceof ArchiveError?error.code:'ARCHIVE_IO_FAILURE'}));process.exitCode=1;}
}
