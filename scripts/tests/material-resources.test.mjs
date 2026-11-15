import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { crc32, deflateSync, gzipSync } from 'node:zlib';
import { writeZip } from '../../server/vendor/routings-model-package/lib/zip.mjs';
import { inspectSvfEnvelope, validateProfile, verifyPackage, computeFingerprint } from '../../server/vendor/routings-model-package/index.mjs';

const PREFIX = 'resources/output/0/', IMAGE = 'Autodesk.CloudPlatform.Image';
const sha = b => createHash('sha256').update(b).digest('hex');
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, b.length - 4)), b.length - 4); return b;
}
function png() {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0,255,0,0,255]))), chunk('IEND', Buffer.alloc(0))]);
}
function documents() {
  const scene = { SceneUnit: 8193, YIsUp: 0 };
  const simple = { name: 'LMVTK Simple Materials', version: '1.0', scene, materials: {
    group: { version: 2, userassets: ['shader'], materials: {
      shader: { tag: '', proteinType: '', definition: 'SimplePhong', transparent: false,
        textures: { generic_diffuse: { connections: ['bitmap'] } },
        properties: { booleans: { generic_is_metal: false }, integers: { mode: 4 },
          scalars: { generic_glossiness: { units: '', values: [32] } },
          colors: { generic_diffuse: { values: [{ r: 1, g: 1, b: 1, a: 1 }] } } } },
      bitmap: { tag: '', definition: 'UnifiedBitmap', properties: {
        uris: { unifiedbitmap_Bitmap: { values: ['Texture Folder/Fixture Logo.png'] } },
        booleans: { texture_URepeat: true }, integers: { texture_MapChannel: 1 },
        scalars: { texture_UScale: { units: '', values: [1] } },
      } },
    } },
  } };
  const protein = { name: 'LMVTK Protein Materials', version: '1.0', scene, materials: {
    group: { version: 2, userassets: ['catalog'], materials: {
      catalog: { tag: '', definition: 'Generic', transparent: false, categories: ['Default'], keywords: ['material'],
        properties: {
          integers: { mode: { values: [4] } }, booleans: { Hidden: { values: [false] } },
          scalars: { generic_glossiness: { units: '', values: [0.5] } },
          colors: { generic_diffuse: { values: [{ r: 1, g: 1, b: 1, a: 1 }], connections: ['bitmap'] } },
          strings: { description: { values: ['Synthetic catalog metadata'] } },
          uris: { thumbnail: { values: ['Mats/Generic/not-a-model-texture.png'] } },
          textures: { generic_diffuse: { connections: ['bitmap'] } }, references: {},
          choicelists: { shared: { values: [0] } }, uuids: { version: { values: [''] } },
        } },
      bitmap: { tag: '', definition: 'UnifiedBitmap', keywords: [''], categories: [''],
        properties: { uris: { thumbnail: { values: ['maps/catalog-thumbnail.png'] },
          unifiedbitmap_Bitmap: { values: ['catalog/unused-bitmap.png'] } }, textures: {}, references: {} } },
    } },
    fallback: { version: 2, userassets: ['simple'], materials: {
      simple: { tag: '', proteinType: '', definition: 'SimplePhong', transparent: false, textures: {}, properties: {} },
    } },
  } };
  return { simple, protein };
}
async function fixture(t, options = {}) {
  const base = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(base, 'svf-materials-test-'));
  t.after(async () => { assert.equal(path.dirname(root), base); assert.ok(path.basename(root).startsWith('svf-materials-test-')); await fs.rm(root, { recursive: true, force: true }); });
  const docs = documents(); options.mutate?.(docs);
  const image = png(), data = new Map([
    [PREFIX + 'Texture Folder/Fixture Logo.png', image],
    [PREFIX + 'properties.db', Buffer.from('SQLite format 3\0synthetic fixture')],
    [PREFIX + 'Materials.json.gz', gzipSync(Buffer.from(JSON.stringify(docs.simple)))],
    [PREFIX + 'ProteinMaterials.json.gz', gzipSync(Buffer.from(JSON.stringify(docs.protein)))],
  ]);
  const properties = { PropertyAttributes: 'attrs', PropertyAVs: 'avs', PropertyIDs: 'ids',
    PropertyOffsets: 'offs', PropertyValues: 'vals', PropertyViewables: 'viewables' };
  const metadata = Buffer.from(options.metadataText ?? '{"version":"1.0","metadata":{}}');
  const assets = [{ id: 'image-id', type: IMAGE, URI: 'Texture Folder/Fixture Logo.png', size: image.length, usize: image.length }];
  for (const [basename, doc] of [['Materials.json.gz', docs.simple], ['ProteinMaterials.json.gz', docs.protein]]) {
    assets.push({ id: basename, type: 'ProteinMaterials', URI: basename, size: data.get(PREFIX + basename).length, usize: Buffer.byteLength(JSON.stringify(doc)) });
  }
  for (const [type, suffix] of Object.entries(properties)) {
    const URI = 'objects_' + suffix + '.json.gz', raw = gzipSync(Buffer.from('[]'));
    data.set(PREFIX + URI, raw);
    assets.push({ id: URI, type: 'Autodesk.CloudPlatform.' + type, URI, size: raw.length, usize: 0 });
  }
  assets.push({ id: 'metadata', type: 'Autodesk.CloudPlatform.ViewingMetadata', URI: 'embed:/metadata.json', size: metadata.length, usize: metadata.length });
  options.mutateAssets?.(assets, data);
  const manifest = { name: 'LMV Manifest', toolkitversion: 'LMVTK 5.0.43.0', manifestversion: 2,
    adskID: { sourceSystem: '', type: '', id: '', version: '' }, assets, typesets: [] };
  const file = path.join(root, '0.svf');
  await writeZip(file, [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'metadata.json', data: metadata }]);
  data.set(PREFIX + '0.svf', await fs.readFile(file));
  options.after?.(data);
  const resources = [...data].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha(bytes) })).sort((a, b) => a.path < b.path ? -1 : 1);
  const provider = { resources, read: async p => data.get(p), stream: p => {
    const raw = data.get(p); return Readable.from(options.chunkBytes ? Array.from({ length: Math.ceil(raw.length / options.chunkBytes) },
      (_, i) => raw.subarray(i * options.chunkBytes, (i + 1) * options.chunkBytes)) : [raw]);
  } };
  const portable = { schemaVersion: 1, packageId: randomUUID(), label: 'Synthetic material fixture',
    source: { name: 'synthetic.nwd', bytes: 1, sha256: sha(Buffer.from('x')), identityBasis: 'observed-local-file' },
    preparedAt: '2026-10-29T00:00:00.000Z', supportProfile: 'svf-local-7.130.0-v1', format: 'svf',
    sdkVersion: '7.130.0', entrypoint: PREFIX + '0.svf', resources };
  portable.contentFingerprint = computeFingerprint(portable);
  const archive = path.join(root, 'model.zip');
  await writeZip(archive, [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(portable)) }, ...[...data].map(([name, data]) => ({ name, data }))]);
  return { root, data, provider, archive };
}
test('both material files, six zero-usize property files and a declared nested bitmap verify without changing raw bytes', async t => {
  const f = await fixture(t), before = new Map([...f.data].map(([p, b]) => [p, Buffer.from(b)]));
  const plan = await inspectSvfEnvelope(f.data.get(PREFIX + '0.svf'));
  assert.ok(plan.resources.some(r => r.path === 'output/0/ProteinMaterials.json.gz' && r.assetType === 'ProteinMaterials'));
  const result = await validateProfile(f.provider);
  assert.equal(result.status, 'PASS'); assert.equal(result.structuredJsonCount, 8);
  assert.equal(result.materialTextureBindings, 1); assert.equal(result.materialReferencedImages, 1);
  assert.equal((await verifyPackage(f.archive)).status, 'PASS');
  for (const [name, raw] of f.data) assert.deepEqual(raw, before.get(name));
});
test('active material textures can resolve a declared image asset ID as in the pinned Viewer', async t => {
  const f = await fixture(t, { mutate: ({ simple }) => { simple.materials.group.materials.bitmap.properties.uris.unifiedbitmap_Bitmap.values[0] = 'IMAGE-ID'; } });
  assert.equal((await validateProfile(f.provider)).materialReferencedImages, 1);
});
test('texture and material verification remains correct across one-byte raw stream chunks', async t => {
  const f = await fixture(t, { chunkBytes: 1 });
  assert.equal((await validateProfile(f.provider)).status, 'PASS');
});
for (const [label, mutate, code = 'UNSUPPORTED_PROFILE'] of [
  ['unknown Protein version', ({ protein }) => { protein.version = '2.0'; }],
  ['wrong document name', ({ protein }) => { protein.name = 'LMVTK Simple Materials'; }],
  ['Prism material', ({ protein }) => { protein.materials.group.materials.catalog.definition = 'PrismOpaque'; }],
  ['unknown definition', ({ simple }) => { simple.materials.group.materials.shader.definition = 'ScriptMaterial'; }],
  ['Generic in an active simple document', ({ simple }) => { simple.materials.group.materials.shader.definition = 'Generic'; }],
  ['missing local texture node', ({ simple }) => { simple.materials.group.materials.shader.textures.generic_diffuse.connections[0] = 'absent'; }],
  ['texture connected to a non-bitmap', ({ simple }) => { simple.materials.group.materials.shader.textures.generic_diffuse.connections[0] = 'shader'; }],
  ['unsupported texture slot', ({ simple }) => { simple.materials.group.materials.shader.textures.runtime = simple.materials.group.materials.shader.textures.generic_diffuse; }],
  ['absent image URI', ({ simple }) => { delete simple.materials.group.materials.bitmap.properties.uris; }],
  ['undeclared image', ({ simple }) => { simple.materials.group.materials.bitmap.properties.uris.unifiedbitmap_Bitmap.values[0] = 'missing.png'; }, 'RESOURCE_MISSING'],
  ['external texture', ({ simple }) => { simple.materials.group.materials.bitmap.properties.uris.unifiedbitmap_Bitmap.values[0] = 'https://example.invalid/private.png'; }, 'EXTERNAL_REFERENCE'],
  ['data URI texture', ({ simple }) => { simple.materials.group.materials.bitmap.properties.uris.unifiedbitmap_Bitmap.values[0] = 'data:image/png;base64,aaaa'; }, 'EXTERNAL_REFERENCE'],
  ['parent texture', ({ simple }) => { simple.materials.group.materials.bitmap.properties.uris.unifiedbitmap_Bitmap.values[0] = '../image.png'; }, 'UNSAFE_PATH'],
  ['encoded separator texture', ({ simple }) => { simple.materials.group.materials.bitmap.properties.uris.unifiedbitmap_Bitmap.values[0] = 'Texture%2FFolder.png'; }, 'UNSAFE_PATH'],
  ['unknown URI field', ({ simple }) => { simple.materials.group.materials.bitmap.properties.uris.script = { values: ['runtime.js'] }; }],
  ['cyclic Protein graph', ({ protein }) => { protein.materials.group.materials.catalog.properties.references.self = { connections: ['catalog'] }; }],
  ['broken Protein graph', ({ protein }) => { protein.materials.group.materials.catalog.properties.textures.generic_diffuse.connections[0] = 'absent'; }],
  ['invalid boolean array', ({ protein }) => { protein.materials.group.materials.catalog.properties.booleans.Hidden.values[0] = 'false'; }],
  ['invalid choice value', ({ protein }) => { protein.materials.group.materials.catalog.properties.choicelists.shared.values[0] = 0.5; }],
  ['unknown material field', ({ protein }) => { protein.materials.group.materials.catalog.script = 'never executed'; }],
]) {
  test('rejects ' + label, async t => {
    const f = await fixture(t, { mutate });
    await assert.rejects(validateProfile(f.provider), { code });
  });
}
test('positive Protein inflated sizes remain mandatory assertions', async t => {
  const f = await fixture(t, { mutateAssets: assets => { assets.find(a => a.URI === 'ProteinMaterials.json.gz').usize++; } });
  await assert.rejects(validateProfile(f.provider), { code: 'RESOURCE_SIZE_MISMATCH' });
});
test('Protein filename/type bindings remain exact during envelope inspection', async t => {
  const f = await fixture(t, { mutateAssets: assets => { assets.find(a => a.URI === 'ProteinMaterials.json.gz').type = 'Autodesk.CloudPlatform.PropertyValues'; } });
  await assert.rejects(inspectSvfEnvelope(f.data.get(PREFIX + '0.svf')), { code: 'UNSUPPORTED_PROFILE' });
});
test('a supplemental Protein document cannot replace the active simple material document', async t => {
  const f = await fixture(t, { mutateAssets: (assets, data) => { assets.splice(assets.findIndex(a => a.URI === 'Materials.json.gz'), 1); data.delete(PREFIX + 'Materials.json.gz'); } });
  await assert.rejects(validateProfile(f.provider), { code: 'UNSUPPORTED_PROFILE' });
});
test('corrupt Protein gzip is rejected before a package is ready', async t => {
  const f = await fixture(t, { after: data => { const b = data.get(PREFIX + 'ProteinMaterials.json.gz'); b[b.length - 5] ^= 1; } });
  await assert.rejects(validateProfile(f.provider), { code: 'GZIP_INVALID' });
});

test('embedded metadata IDs cannot shadow an active image URI in the pinned Viewer lookup', async t => {
  const f = await fixture(t, { mutateAssets: assets => {
    assets.find(a => a.URI === 'embed:/metadata.json').id = 'Texture Folder/Fixture Logo.png';
  } });
  await assert.rejects(validateProfile(f.provider), { code: 'RESOURCE_MISSING' });
});
test('case-folded asset-ID ambiguity is refused before material image selection', async t => {
  const f = await fixture(t, { mutate: ({ simple }) => {
    simple.materials.group.materials.bitmap.properties.uris.unifiedbitmap_Bitmap.values[0] = 'image-id';
  }, mutateAssets: assets => { assets.find(a => a.URI === 'embed:/metadata.json').id = 'IMAGE-ID'; } });
  await assert.rejects(validateProfile(f.provider), { code: 'UNSUPPORTED_PROFILE' });
});

test('portable verification accepts the observed millimetre metadata pair and preserves its SVF bytes', async t => {
  const f = await fixture(t, { metadataText: '{"version":"1.0","metadata":{"default display unit":{"value":"mm"},"default display unit":{"value":"mm"}}}' });
  const before = Buffer.from(f.data.get(PREFIX + '0.svf'));
  assert.equal((await inspectSvfEnvelope(before)).status, 'INSPECTED');
  assert.equal((await verifyPackage(f.archive)).status, 'PASS');
  assert.deepEqual(f.data.get(PREFIX + '0.svf'), before);
});
test('portable verification rejects conflicting display units', async t => {
  const f = await fixture(t, { metadataText: '{"version":"1.0","metadata":{"default display unit":{"value":"m"},"default display unit":{"value":"mm"}}}' });
  await assert.rejects(verifyPackage(f.archive), { code: 'INVALID_MANIFEST' });
});
