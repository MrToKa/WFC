import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { assertCanonicalPath,hashFile,validateMemberPath } from './archives.mjs';

export class ManifestError extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new ManifestError(code);};
export const FORMAT='WFC-OFFLINE-BACKUP';
export const SCHEMA_VERSION=1;
export const canonical=value=>JSON.stringify(value);
export const sha256=value=>createHash('sha256').update(value).digest('hex');
function safeAnnotations(value){return value===undefined||value===null||typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([key,entry])=>/^containerd\.io\/distribution\.source\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(key)&&typeof entry==='string'&&entry.length<=255&&/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/.test(entry));}
export function validateImage(image){if(!image||!/^sha256:[a-f0-9]{64}$/.test(image.id??'')||image.os!=='linux'||!['amd64','arm64'].includes(image.architecture)||image.exportMode!=='id-only'&&!(typeof image.exportTag==='string'&&/^wfc-ops-bundle\/[0-9a-f-]{36}\/[a-z0-9-]+:[a-f0-9]{12}$/.test(image.exportTag)))fail('IMAGE_PROFILE_INVALID');return image;}
export function validateManifest(value){
  if(!value||value.format!==FORMAT||value.schemaVersion!==1||value.state!=='complete'||!/^[0-9a-f-]{36}$/.test(value.backupId??'')||value.profile!=='cold-wfc-pg-custom-minio-staging-v1'||!Array.isArray(value.files)||value.files.length<5||value.files.length>64||!Array.isArray(value.images)||value.images.length<4||value.images.length>16||!value.inventory||!value.source||!Array.isArray(value.source.containers))fail('MANIFEST_INVALID');
  const names=new Set();for(const file of value.files){validateMemberPath(file.path);if(file.path.includes('/')||names.has(file.path.toLowerCase())||!Number.isSafeInteger(file.bytes)||file.bytes<1||!/^[a-f0-9]{64}$/.test(file.sha256??'')||!['database','minio','staging','image','inventory','audit','source'].includes(file.role))fail('MANIFEST_FILE_INVALID');names.add(file.path.toLowerCase());}
  for(const role of ['database','minio','staging','inventory','audit'])if(value.files.filter(item=>item.role===role).length!==1)fail('MANIFEST_FILE_INVALID');
  const roles=new Set();for(const image of value.images){validateImage(image);if(roles.has(image.role)||!names.has(image.archive.toLowerCase())||value.files.find(file=>file.path===image.archive)?.role!=='image')fail('IMAGE_PROFILE_INVALID');roles.add(image.role);}
  for(const required of ['api','web','postgres','minio','helper'])if(!roles.has(required))fail('IMAGE_PROFILE_INVALID');
  if(!value.inventory.businessSha256||!value.inventory.registrySha256||value.source.cold!==true||value.source.writerCount<1||!Array.isArray(value.source.stopped))fail('MANIFEST_INVALID');
  return value;
}
export async function recordFile(directory,name,role){validateMemberPath(name);if(name.includes('/'))fail('MANIFEST_FILE_INVALID');return{path:name,role,...await hashFile(path.join(directory,name))};}
export async function writeJsonNew(filename,value){const handle=await fs.open(filename,'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}}
export async function completeBackup(directory,manifest){
  validateManifest(manifest);await assertCanonicalPath(directory,{directory:true});const filename=path.join(directory,'manifest.json');await writeJsonNew(filename,manifest);const identity=await hashFile(filename);
  await writeJsonNew(path.join(directory,'complete.json'),{format:FORMAT,schemaVersion:1,backupId:manifest.backupId,manifest:identity,state:'complete'});
  return identity;
}
export async function verifyBackup(directory){
  const root=await assertCanonicalPath(directory,{directory:true});let marker,manifest;
  try{const bytes=await fs.readFile(path.join(root,'complete.json'));if(bytes.length>4096)fail('BACKUP_INCOMPLETE');marker=JSON.parse(bytes);const raw=await fs.readFile(path.join(root,'manifest.json'));if(raw.length>1024**2)fail('MANIFEST_INVALID');manifest=JSON.parse(raw);}catch(error){if(error instanceof ManifestError)throw error;fail('BACKUP_INCOMPLETE');}
  validateManifest(manifest);const actual=await hashFile(path.join(root,'manifest.json'));
  if(marker.format!==FORMAT||marker.schemaVersion!==1||marker.state!=='complete'||marker.backupId!==manifest.backupId||marker.manifest?.sha256!==actual.sha256||marker.manifest?.bytes!==actual.bytes)fail('MANIFEST_HASH_MISMATCH');
  const allowed=new Set(['manifest.json','complete.json','incomplete.json','resume.json',...manifest.files.map(file=>file.path)]);
  for(const filename of await fs.readdir(root))if(!allowed.has(filename))fail('BACKUP_UNEXPECTED_FILE');
  for(const file of manifest.files){let found;try{found=await hashFile(path.join(root,file.path));}catch{fail('BACKUP_FILE_MISSING');}if(found.bytes!==file.bytes||found.sha256!==file.sha256)fail('BACKUP_FILE_HASH_MISMATCH');}
  return{directory:root,manifest,manifestIdentity:actual};
}
export async function assertFreshTarget(directory,project,port){
  if(!/^wfc-restore-[a-z0-9][a-z0-9-]{2,48}$/.test(project??''))fail('FRESH_PROJECT_REQUIRED');
  if(!Number.isInteger(port)||port<1024||port>65535)fail('RESTORE_PORT_INVALID');
  const target=path.resolve(directory);await assertCanonicalPath(path.dirname(target),{directory:true});
  try{await fs.lstat(target);fail('RESTORE_TARGET_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  return target;
}
export function newTargetMarker({backupId,project,port}){return{format:'WFC-RESTORE-TARGET',schemaVersion:1,targetId:randomUUID(),backupId,project,port,state:'quarantine',createdAt:new Date().toISOString()};}
export async function readTarget(directory){const root=await assertCanonicalPath(directory,{directory:true});let value;try{const raw=await fs.readFile(path.join(root,'target.json'));if(raw.length>65536)fail('OWNED_TARGET_REQUIRED');value=JSON.parse(raw);}catch{fail('OWNED_TARGET_REQUIRED');}if(value.format!=='WFC-RESTORE-TARGET'||value.schemaVersion!==1||!/^[0-9a-f-]{36}$/.test(value.targetId??'')||!/^wfc-restore-[a-z0-9-]+$/.test(value.project??''))fail('OWNED_TARGET_REQUIRED');return{root,marker:value};}

// Docker save is a tar envelope. Layer payloads are never extracted by this parser.
// Reject links, special entries, duplicate paths and tag injection before Docker load.
export async function verifyImageArchive(filename,image){
  validateImage(image);await assertCanonicalPath(filename);const handle=await fs.open(filename,'r');const size=(await handle.stat()).size;let position=0,members=0,zero=false;const names=new Set(),json=new Map();let metadata=0;
  const read=async(count,at)=>{const result=Buffer.alloc(count);let done=0;while(done<count){const r=await handle.read(result,done,count-done,at+done);if(!r.bytesRead)fail('IMAGE_ARCHIVE_TRUNCATED');done+=r.bytesRead;}return result;};
  const text=bytes=>bytes.subarray(0,bytes.indexOf(0)<0?bytes.length:bytes.indexOf(0)).toString('utf8');
  const octal=bytes=>{const value=text(bytes).trim();if(!/^[0-7]+$/.test(value||'0'))fail('IMAGE_ARCHIVE_INVALID');const n=parseInt(value||'0',8);if(!Number.isSafeInteger(n)||n<0)fail('IMAGE_ARCHIVE_INVALID');return n;};
  try{
    if(!Number.isSafeInteger(size)||size<1024||size%512)fail('IMAGE_ARCHIVE_INVALID');
    while(position<size){const header=await read(512,position);position+=512;if(header.every(byte=>byte===0)){zero=true;while(position<size){if(!(await read(Math.min(1024**2,size-position),position)).every(byte=>byte===0))fail('IMAGE_ARCHIVE_INVALID');position+=Math.min(1024**2,size-position);}break;}
      if(++members>1_000_000)fail('IMAGE_ARCHIVE_LIMIT');let checksum=0;for(let i=0;i<512;i++)checksum+=i>=148&&i<156?32:header[i];if(checksum!==octal(header.subarray(148,156)))fail('IMAGE_ARCHIVE_INVALID');
      const prefix=text(header.subarray(345,500)),base=text(header.subarray(0,100)),name=(prefix?prefix+'/':'')+base,type=String.fromCharCode(header[156]||48),bytes=octal(header.subarray(124,136));
      const normalized=type==='5'&&name.endsWith('/')?name.slice(0,-1):name;validateMemberPath(normalized);if(!['0','5'].includes(type)||names.has(normalized.toLowerCase())||type==='5'&&bytes!==0)fail('IMAGE_ARCHIVE_UNSAFE');names.add(normalized.toLowerCase());if(position+bytes>size)fail('IMAGE_ARCHIVE_TRUNCATED');
      if(type==='0'&&/^blobs\/sha256\/[a-f0-9]{64}$/.test(name)){const digest=createHash('sha256');for(let offset=0;offset<bytes;){const chunk=await read(Math.min(1024**2,bytes-offset),position+offset);digest.update(chunk);offset+=chunk.length;}if(digest.digest('hex')!==name.slice(-64))fail('IMAGE_BLOB_HASH_MISMATCH');}
      if(type==='0'&&(name==='manifest.json'||name.endsWith('.json')||/blobs\/sha256\/[a-f0-9]{64}$/.test(name)&&bytes<16*1024**2)){if(bytes>32*1024**2||(metadata+=bytes)>256*1024**2)fail('IMAGE_ARCHIVE_LIMIT');json.set(name,await read(bytes,position));}
      position+=Math.ceil(bytes/512)*512;
    }
    if(!zero)fail('IMAGE_ARCHIVE_TRUNCATED');let manifests;try{manifests=JSON.parse(json.get('manifest.json'));}catch{fail('IMAGE_ARCHIVE_INVALID');}
    if(!Array.isArray(manifests)||manifests.length!==1)fail('IMAGE_ARCHIVE_INVALID');const item=manifests[0];
    const safeTags=image.exportMode==='id-only'?(item.RepoTags===null||Array.isArray(item.RepoTags)&&item.RepoTags.length===0):Array.isArray(item.RepoTags)&&item.RepoTags.length===1&&item.RepoTags[0]===image.exportTag;
    if(!safeTags||typeof item.Config!=='string'||!Array.isArray(item.Layers)||!item.Layers.length)fail('IMAGE_TAG_UNSAFE');
    for(const member of [item.Config,...item.Layers]){validateMemberPath(member);if(!names.has(member.toLowerCase()))fail('IMAGE_ARCHIVE_INVALID');}
    const configRaw=json.get(item.Config);if(!configRaw)fail('IMAGE_ID_MISMATCH');
    const configId='sha256:'+sha256(configRaw);
    if(json.has('index.json')){let index;try{index=JSON.parse(json.get('index.json'));}catch{fail('IMAGE_ARCHIVE_INVALID');}if(!safeAnnotations(index.annotations)||!Array.isArray(index.manifests)||index.manifests.length!==1||index.manifests.some(item=>!safeAnnotations(item.annotations)))fail('IMAGE_TAG_UNSAFE');}
    if(configId!==image.id){
      const rootRaw=json.get('blobs/sha256/'+image.id.slice(7));if(!rootRaw||'sha256:'+sha256(rootRaw)!==image.id)fail('IMAGE_ID_MISMATCH');
      let index;try{index=JSON.parse(json.get('index.json'));}catch{fail('IMAGE_ARCHIVE_INVALID');}
      if(!safeAnnotations(index.annotations)||!Array.isArray(index.manifests)||index.manifests.length!==1||index.manifests[0].digest!==image.id||!safeAnnotations(index.manifests[0].annotations))fail('IMAGE_TAG_UNSAFE');
      const visited=new Set();let found=false;
      // Docker saves only present platforms of a registry index. Preserve the pinned
      // index identity, require the selected config to be reachable, and never fetch
      // absent platform blobs. Every included content-addressed blob was hashed above.
      const visit=(id,depth)=>{if(depth>8||!/^sha256:[a-f0-9]{64}$/.test(id))fail('IMAGE_ARCHIVE_INVALID');if(visited.has(id))return;visited.add(id);const raw=json.get('blobs/sha256/'+id.slice(7));if(!raw)return;if('sha256:'+sha256(raw)!==id)fail('IMAGE_ID_MISMATCH');let node;try{node=JSON.parse(raw);}catch{fail('IMAGE_ARCHIVE_INVALID');}if(node.config?.digest===configId)found=true;if(node.manifests){if(!Array.isArray(node.manifests)||node.manifests.length>128)fail('IMAGE_ARCHIVE_LIMIT');for(const child of node.manifests)visit(child.digest,depth+1);}};visit(image.id,0);if(!found)fail('IMAGE_ID_MISMATCH');
    }
    let config;try{config=JSON.parse(configRaw);}catch{fail('IMAGE_ARCHIVE_INVALID');}
    if(config.os!==image.os||config.architecture!==image.architecture)fail('IMAGE_PLATFORM_MISMATCH');
    return{status:'PASS',imageId:image.id,platform:image.os+'/'+image.architecture,members,tagIsolated:true};
  }finally{await handle.close();}
}
