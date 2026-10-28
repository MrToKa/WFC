import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createHash,randomUUID} from 'node:crypto';
import {crc32,deflateSync,gzipSync} from 'node:zlib';
import {writeZip} from '../../server/vendor/routings-model-package/lib/zip.mjs';
import {inspectSvfEnvelope,validateProfile,verifyPackage,computeFingerprint} from '../../server/vendor/routings-model-package/index.mjs';

const IMAGE='Autodesk.CloudPlatform.Image';
const sha=b=>createHash('sha256').update(b).digest('hex');
function chunk(type,data) {
  const bytes=Buffer.alloc(12+data.length);
  bytes.writeUInt32BE(data.length); bytes.write(type,4,'ascii'); data.copy(bytes,8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4,bytes.length-4)),bytes.length-4); return bytes;
}
function png(width=1,height=1) {
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
}
// Synthetic marker container for header validation, not a JPEG pixel decoder.
function jpeg({progressive=false,width=1,height=1}={}) {
  const sof=Buffer.from([0xff,progressive?0xc2:0xc0,0,11,8,0,0,0,0,1,1,0x11,0]);
  sof.writeUInt16BE(height,5);sof.writeUInt16BE(width,7);
  return Buffer.concat([Buffer.from([0xff,0xd8]),sof,Buffer.from([0xff,0xda,0,8,1,1,0,0,63,0,1,2,0xff,0,3,0xff,0xd9])]);
}
async function fixture(t,{name='texture.png',image=png(),uri=name,assetType=IMAGE,omitImage=false,omitDeclaration=false,chunkBytes}={}) {
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'svf-image-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const pf=gzipSync(Buffer.from('Geometry fixture')),metadata=Buffer.from('{"version":"1.0","metadata":{}}');
  const assets=[
    ...(!omitDeclaration?[{id:'image',type:assetType,URI:uri,size:image.length,usize:image.length}]:[]),
    {id:'geometry',type:'Autodesk.CloudPlatform.PackFile',URI:'0.pf',size:pf.length,usize:16,typeset:'2'},
    {id:'metadata',type:'Autodesk.CloudPlatform.ViewingMetadata',URI:'embed:/metadata.json',size:metadata.length,usize:metadata.length},
  ];
  const manifest={name:'LMV Manifest',toolkitversion:'LMVTK 5.0.43.0',manifestversion:2,adskID:{sourceSystem:'',type:'',id:'',version:''},
    assets,typesets:[{id:'2',types:[{class:'Autodesk.CloudPlatform.Geometry',type:'Autodesk.CloudPlatform.OpenCTM',version:1}]}]};
  const svfFile=path.join(root,'0.svf');
  await writeZip(svfFile,[{name:'manifest.json',data:Buffer.from(JSON.stringify(manifest))},{name:'metadata.json',data:metadata}]);
  const svf=await fs.readFile(svfFile),data=new Map([
    ['resources/output/0/0.svf',svf],['resources/output/0/0.pf',pf],['resources/output/0/properties.db',Buffer.from('SQLite format 3\0fixture')],
    ...(!omitImage?[[('resources/output/0/'+name),image]]:[]),
  ]);
  const resources=[...data].map(([p,b])=>({path:p,bytes:b.length,sha256:sha(b)})).sort((a,b)=>a.path<b.path?-1:1);
  const provider={resources,read:async p=>data.get(p),stream:p=>Readable.from(chunkBytes?Array.from({length:Math.ceil(data.get(p).length/chunkBytes)},(_,i)=>data.get(p).subarray(i*chunkBytes,(i+1)*chunkBytes)):[data.get(p)])};
  const portable={schemaVersion:1,packageId:randomUUID(),label:'Image resource fixture',source:{name:'synthetic.nwd',bytes:1,sha256:sha(Buffer.from('x')),identityBasis:'observed-local-file'},
    preparedAt:'2026-10-28T00:00:00.000Z',supportProfile:'svf-local-7.130.0-v1',format:'svf',sdkVersion:'7.130.0',entrypoint:'resources/output/0/0.svf',resources};
  portable.contentFingerprint=computeFingerprint(portable);
  const archive=path.join(root,'model.zip');
  await writeZip(archive,[{name:'manifest.json',data:Buffer.from(JSON.stringify(portable))},...[...data].map(([name,data])=>({name,data}))]);
  return {svf,data,provider,archive,portable};
}
for(const [label,options] of [
 ['PNG',{name:'texture.png',image:png()}],
 ['uppercase PNG',{name:'texture.PNG',image:png()}],
 ['JPEG',{name:'texture.jpg',image:jpeg()}],
 ['progressive JPEG',{name:'texture.jpeg',image:jpeg({progressive:true})}],
 ['one-byte PNG stream',{chunkBytes:1}],
]) {
  test('manifest-declared image survives inspection, closure and portable verification: '+label,async t=>{
    const f=await fixture(t,options),before=Buffer.from(f.svf);
    const plan=await inspectSvfEnvelope(f.svf);
    assert.ok(plan.resources.some(r=>r.assetType===IMAGE));
    const report=await validateProfile(f.provider);assert.equal(report.status,'PASS');assert.equal(report.closure.externalReferences,2);
    const verified=await verifyPackage(f.archive);assert.equal(verified.status,'PASS');assert.equal(verified.resourceCount,4);
    assert.deepEqual(f.svf,before);
    assert.equal(verified.package.sha256,sha(await fs.readFile(f.archive)));
  });
}
for(const [label,options,code] of [
 ['HTML disguised as PNG',{image:Buffer.from('<html>not an image</html>')},'EXECUTABLE_CONTENT'],
 ['wrong image signature',{image:Buffer.alloc(64)},'UNSUPPORTED_PROFILE'],
 ['JPEG in a PNG filename',{image:jpeg()},'UNSUPPORTED_PROFILE'],
 ['truncated PNG',{image:png().subarray(0,-2)},'UNSUPPORTED_PROFILE'],
 ['corrupt PNG CRC',{image:(()=>{const b=png();b[29]^=1;return b;})()},'UNSUPPORTED_PROFILE'],
 ['zero PNG width',{image:png(0,1)},'UNSUPPORTED_PROFILE'],
 ['oversized PNG dimensions',{image:png(65535,65535)},'PACKAGE_LIMIT_EXCEEDED'],
 ['truncated JPEG',{name:'texture.jpg',image:jpeg().subarray(0,-1)},'UNSUPPORTED_PROFILE'],
 ['oversized JPEG dimensions',{name:'texture.jpg',image:jpeg({width:65535,height:65535})},'PACKAGE_LIMIT_EXCEEDED'],
 ['undeclared image',{omitDeclaration:true},'RESOURCE_UNEXPECTED'],
 ['missing image',{omitImage:true},'RESOURCE_MISSING'],
 ['image attributed to a geometry type',{assetType:'Autodesk.CloudPlatform.PackFile'},'UNSUPPORTED_PROFILE'],
 ['gzip-wrapped PNG',{image:gzipSync(png())},'UNSUPPORTED_PROFILE'],
 ['SVG image',{name:'texture.svg',image:Buffer.from('<svg/>')},'UNSUPPORTED_PROFILE'],
]) {
  test('rejects '+label,async t=>{
    const f=await fixture(t,options);
    await assert.rejects(validateProfile(f.provider),{code});
  });
}
for(const uri of ['https://example.invalid/texture.png','../texture.png','nested/texture.png']) {
  test('image discovery rejects unsafe dependency '+uri,async t=>{
    const f=await fixture(t,{uri});
    await assert.rejects(inspectSvfEnvelope(f.svf),{code:uri.startsWith('https:')?'EXTERNAL_REFERENCE':'UNSAFE_PATH'});
  });
}
