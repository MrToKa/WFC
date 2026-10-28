import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {writeZip} from '../../server/vendor/routings-model-package/lib/zip.mjs';
import {verifyPackage, computeFingerprint} from '../../server/vendor/routings-model-package/index.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, toolkitVersion, change = () => {}) {
  const base = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(base,'toolkit-portable-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const pf = gzipSync(Buffer.from('Synthetic geometry fixture'));
  const metadata = Buffer.from('{"version":"1.0","metadata":{"default display unit":{"value":"m"}}}');
  const svfManifest = {name:'LMV Manifest',toolkitversion:toolkitVersion,manifestversion:2,
    adskID:{sourceSystem:'',type:'',id:'',version:''},
    assets:[
      {id:'0.pf',type:'Autodesk.CloudPlatform.PackFile',URI:'0.pf',size:pf.length,usize:26,typeset:'2'},
      {id:'metadata',type:'Autodesk.CloudPlatform.ViewingMetadata',URI:'embed:/metadata.json',size:metadata.length,usize:metadata.length},
    ],
    typesets:[{id:'2',types:[{class:'Autodesk.CloudPlatform.Geometry',type:'Autodesk.CloudPlatform.OpenCTM',version:1}]}],
  };
  change(svfManifest);
  const svfFile = path.join(root,'0.svf');
  await writeZip(svfFile,[{name:'manifest.json',data:Buffer.from(JSON.stringify(svfManifest))},{name:'metadata.json',data:metadata}]);
  const resourceBytes = new Map([
    ['resources/output/0/0.svf',await fs.readFile(svfFile)],
    ['resources/output/0/0.pf',pf],
    ['resources/output/0/properties.db',Buffer.from('SQLite format 3\0synthetic properties')],
  ]);
  const resources = [...resourceBytes].map(([resourcePath,bytes])=>({path:resourcePath,bytes:bytes.length,sha256:sha(bytes)})).sort((a,b)=>a.path<b.path?-1:1);
  const manifest = {schemaVersion:1,packageId:randomUUID(),label:'Toolkit compatibility fixture',
    source:{name:'synthetic.nwd',bytes:1,sha256:sha(Buffer.from('x')),identityBasis:'observed-local-file'},
    preparedAt:'2026-10-28T00:00:00.000Z',supportProfile:'svf-local-7.130.0-v1',format:'svf',sdkVersion:'7.130.0',
    entrypoint:'resources/output/0/0.svf',resources};
  manifest.contentFingerprint = computeFingerprint(manifest);
  const filename=path.join(root,'package.zip');
  await writeZip(filename,[{name:'manifest.json',data:Buffer.from(JSON.stringify(manifest))},...[...resourceBytes].map(([name,data])=>({name,data}))]);
  return {filename,manifest};
}

for(const toolkit of ['LMVTK 5.0.26.0','LMVTK 5.0.43.0']) {
  test('public portable verifier accepts structurally valid '+toolkit,async t=>{
    const f=await fixture(t,toolkit);
    const result=await verifyPackage(f.filename,{expectedFingerprint:f.manifest.contentFingerprint});
    assert.equal(result.status,'PASS');
    assert.equal(result.resourceCount,3);
    assert.equal(result.manifest.contentFingerprint,f.manifest.contentFingerprint);
    assert.equal(result.package.sha256,sha(await fs.readFile(f.filename)));
  });
}
for(const [label,toolkit,change,code] of [
  ['unapproved producer','LMVTK 5.0.44.0',()=>{},'UNSUPPORTED_PROFILE'],
  ['unknown tuple in 5.0.43.0','LMVTK 5.0.43.0',m=>{m.typesets[0].types[0].version=100;},'UNSUPPORTED_PROFILE'],
  ['manifest v3 in 5.0.43.0','LMVTK 5.0.43.0',m=>{m.manifestversion=3;},'UNSUPPORTED_PROFILE'],
  ['external resource in 5.0.43.0','LMVTK 5.0.43.0',m=>{m.assets[0].URI='https://example.invalid/geometry.pf';},'EXTERNAL_REFERENCE'],
]) {
  test('public portable verifier rejects '+label,async t=>{
    const f=await fixture(t,toolkit,change);
    await assert.rejects(verifyPackage(f.filename),{code});
  });
}
