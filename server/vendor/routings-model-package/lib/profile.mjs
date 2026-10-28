import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { openZip } from './zip.mjs';
import { DEFAULT_LIMITS, resolveLimits } from './limits.mjs';
import { PackageError, fail } from './errors.mjs';
import { parseJson } from './json.mjs';
import { validateResourcePath, assertNoCaseCollisions } from './paths.mjs';

const PREFIX = 'resources/output/0/';
const ENTRY = PREFIX + '0.svf';
const PROPERTY_DB = PREFIX + 'properties.db';
const PLATFORM = 'Autodesk.CloudPlatform.';
// Producer versions observed in supported SVF-v2 inputs. Version membership
// never bypasses the independent asset, tuple, metadata or resource checks.
const SUPPORTED_TOOLKITS = new Set(['LMVTK 5.0.26.0', 'LMVTK 5.0.43.0']);
export const ASSET_TYPES = Object.freeze([
  'ProteinMaterials', ...[
    'FragmentList', 'GeometryMetadataList', 'InstanceTree', 'PackFile',
    'PropertyAttributes', 'PropertyAVs', 'PropertyIDs', 'PropertyOffsets',
    'PropertyValues', 'PropertyViewables', 'ViewingMetadata',
  ].map(name => PLATFORM + name),
]);
export const TYPESET_TUPLES = Object.freeze([
  ['Camera', 'CameraDefinition', 2], ['Light', 'LightDefinition', 1],
  ['Geometry', 'OpenCTM', 1], ['Geometry', 'Lines', 2],
  ['GeometryMetadata', 'GeometryMetadataData', 3], ['Fragment', 'FragmentData', 5],
  ['Instance', 'InstanceData', 2], ['InstanceTreeNode', 'InstanceTreeNodeData', 5],
  ['Set', 'SetData', 1], ['OverrideSets', 'OverrideSetsData', 1],
  ['Viewpoint', 'ViewpointDefinition', 1], ['NamedItemTree', 'NamedItemTreeNode', 1],
].map(([className, type, version]) => Object.freeze({ class: PLATFORM + className, type: PLATFORM + type, version })));
export const JSON_BASENAMES = Object.freeze([
  'Materials.json.gz', 'objects_attrs.json.gz', 'objects_avs.json.gz',
  'objects_ids.json.gz', 'objects_offs.json.gz', 'objects_vals.json.gz', 'objects_viewables.json.gz',
]);
const JSON_TYPES = new Map([
  ['ProteinMaterials', 'Materials.json.gz'],
  [PLATFORM + 'PropertyAttributes', 'objects_attrs.json.gz'],
  [PLATFORM + 'PropertyAVs', 'objects_avs.json.gz'],
  [PLATFORM + 'PropertyIDs', 'objects_ids.json.gz'],
  [PLATFORM + 'PropertyOffsets', 'objects_offs.json.gz'],
  [PLATFORM + 'PropertyValues', 'objects_vals.json.gz'],
  [PLATFORM + 'PropertyViewables', 'objects_viewables.json.gz'],
]);
const METADATA_FIELDS = new Set([
  'double sided geometry', 'navigation hint', 'world bounding box', 'world up vector',
  'world front vector', 'world north vector', 'distance unit', 'default display unit',
  'default camera', 'view to model transform', 'custom values',
]);

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function unsupported(message, details = {}) {
  // Emit only validator-owned messages and bounded technical identifiers.
  // Never log resource paths, URLs, URNs, model properties or credential values.
  const technical = {};
  for (const key of ['field', 'toolkitversion', 'manifestversion']) {
    const value = details[key];
    if (typeof value === 'string' && /^[A-Za-z0-9 ._-]{1,80}$/.test(value)) technical[key] = value;
    else if (typeof value === 'number' && Number.isSafeInteger(value)) technical[key] = value;
  }
  try { process.stderr.write(JSON.stringify({ event: 'svf-profile-rejected', reason: message, ...technical }) + '\n'); } catch {}
  fail('UNSUPPORTED_PROFILE', message, details);
}
function fields(value, required, optional = [], label = 'Object') {
  if (!object(value)) unsupported(`${label} must be an object.`);
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.has(key))) {
    unsupported(`${label} has missing or unsupported fields.`);
  }
}
function text(value) { return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value); }
function size(value) { return Number.isSafeInteger(value) && value >= 0; }
function tupleKey(value) { return `${value.class}\0${value.type}\0${value.version}`; }
function meterValue(value) {
  return object(value) && Object.keys(value).length === 1 && Object.hasOwn(value, 'value') && value.value === 'm';
}
function decodeJson(bytes, options) {
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('INVALID_MANIFEST', 'Nested JSON is not valid UTF-8.'); }
  return parseJson(source, options);
}

function validateMetadata(value) {
  fields(value, ['version', 'metadata'], [], 'Embedded metadata');
  if (value.version !== '1.0' || !object(value.metadata)) unsupported('Unsupported embedded metadata version or structure.');
  for (const [name, record] of Object.entries(value.metadata)) {
    if (!METADATA_FIELDS.has(name)) unsupported('Unknown metadata field.', { field: name });
    if (name === 'world bounding box') {
      fields(record, ['minXYZ', 'maxXYZ'], [], 'World bounding box');
      for (const coordinates of [record.minXYZ, record.maxXYZ]) {
        if (!Array.isArray(coordinates) || coordinates.length !== 3 || !coordinates.every(Number.isFinite)) unsupported('Invalid bounding-box coordinates.');
      }
    } else if (name.startsWith('world ') && name.endsWith(' vector')) {
      fields(record, ['XYZ'], [], 'World direction');
      if (!Array.isArray(record.XYZ) || record.XYZ.length !== 3 || !record.XYZ.every(Number.isFinite)) unsupported('Invalid world direction.');
    } else if (name === 'custom values') {
      fields(record, [], ['refPointTransform', 'angleToTrueNorth', 'nwModelToWorldTransform'], 'Custom metadata');
      for (const [key, item] of Object.entries(record)) {
        if (key === 'angleToTrueNorth') { if (!Number.isFinite(item)) unsupported('Invalid north angle.'); }
        else if (!Array.isArray(item) || item.length !== 12 || !item.every(Number.isFinite)) unsupported('Invalid transform metadata.');
      }
    } else if (name === 'default camera') {
      fields(record, ['index'], [], 'Default camera');
      if (!size(record.index)) unsupported('Invalid default camera index.');
    } else if (name === 'view to model transform') {
      fields(record, ['type'], [], 'View transform');
      if (!size(record.type)) unsupported('Unsupported view transform.');
    } else {
      fields(record, ['value'], [], 'Metadata value');
      const expected = name === 'double sided geometry' ? 'boolean' : 'string';
      if (typeof record.value !== expected) unsupported('Invalid metadata value type.', { field: name });
    }
  }
}

function validateMaterials(value) {
  fields(value, ['name', 'version', 'scene', 'materials'], [], 'Materials root');
  if (value.name !== 'LMVTK Simple Materials' || value.version !== '1.0') unsupported('Unsupported material name or version.');
  fields(value.scene, ['SceneUnit', 'YIsUp'], [], 'Material scene');
  if (!size(value.scene.SceneUnit) || ![0, 1].includes(value.scene.YIsUp) || !object(value.materials)) unsupported('Unsupported material scene or records.');
  let count = 0;
  for (const outer of Object.values(value.materials)) {
    fields(outer, ['version', 'userassets', 'materials'], [], 'Material group');
    if (outer.version !== 2 || !Array.isArray(outer.userassets) || !outer.userassets.every(text) || !object(outer.materials)) unsupported('Unsupported material group shape.');
    for (const id of outer.userassets) if (!Object.hasOwn(outer.materials, id)) unsupported('Material userasset points to an absent inner material.');
    for (const inner of Object.values(outer.materials)) {
      fields(inner, ['tag', 'proteinType', 'definition', 'properties', 'transparent', 'textures'], [], 'Inner material');
      if (typeof inner.tag !== 'string' || typeof inner.proteinType !== 'string' || inner.definition !== 'SimplePhong' || typeof inner.transparent !== 'boolean') unsupported('Unsupported inner material definition.');
      if (!object(inner.textures) || Object.keys(inner.textures).length !== 0) unsupported('V1 permits only empty material texture maps.');
      fields(inner.properties, [], ['integers', 'booleans', 'scalars', 'colors'], 'Material properties');
      for (const [kind, properties] of Object.entries(inner.properties)) {
        if (!object(properties)) unsupported('Invalid material property category.');
        for (const entry of Object.values(properties)) {
          if (kind === 'integers') { if (!Number.isSafeInteger(entry)) unsupported('Invalid integer material property.'); }
          else if (kind === 'booleans') { if (typeof entry !== 'boolean') unsupported('Invalid boolean material property.'); }
          else if (kind === 'scalars') {
            fields(entry, ['units', 'values'], [], 'Material scalar');
            if (typeof entry.units !== 'string' || !Array.isArray(entry.values) || !entry.values.every(Number.isFinite)) unsupported('Invalid scalar material property.');
          } else {
            fields(entry, ['values'], [], 'Material color');
            if (!Array.isArray(entry.values)) unsupported('Invalid color material property.');
            for (const color of entry.values) {
              fields(color, ['r', 'g', 'b', 'a'], [], 'Material RGBA');
              if (!Object.values(color).every(Number.isFinite)) unsupported('Invalid RGBA material value.');
            }
          }
        }
      }
      count++;
    }
  }
  return count;
}

function sniffBinary(prefix, path) {
  const hex = prefix.subarray(0, 4).toString('hex');
  if (prefix.subarray(0, 2).toString('ascii') === 'MZ' || [
    '7f454c46', '0061736d', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe',
  ].includes(hex)) fail('EXECUTABLE_CONTENT', 'Executable content is not a model data resource.', { path });
  const start = prefix.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(?:#!|<!doctype\s+html|<html\b|<script\b|(?:import|export)\s|(?:var|let|const)\s+[A-Za-z_$]|function\s*[A-Za-z_$ (])/i.test(start)) {
    fail('EXECUTABLE_CONTENT', 'Script or HTML content is not a binary model resource.', { path });
  }
  if (['504b0304', '504b0506', '504b0708'].includes(hex) || prefix.subarray(0, 6).toString('hex') === '377abcaf271c' || prefix.subarray(0, 4).toString('ascii') === 'Rar!') {
    unsupported('An unrecognized nested container cannot be treated as terminal model data.', { path });
  }
}

function validateSvfManifest(value, resources, archive) {
  fields(value, ['name', 'toolkitversion', 'manifestversion', 'adskID', 'assets', 'typesets'], [], 'SVF manifest');
  if (value.name !== 'LMV Manifest' || !SUPPORTED_TOOLKITS.has(value.toolkitversion) || value.manifestversion !== 2) unsupported('Unsupported SVF toolkit or manifest version.', { toolkitversion: value.toolkitversion, manifestversion: value.manifestversion });
  fields(value.adskID, ['sourceSystem', 'type', 'id', 'version'], [], 'SVF adskID');
  if (!Object.values(value.adskID).every(item => typeof item === 'string') || !Array.isArray(value.assets) || !Array.isArray(value.typesets)) unsupported('Invalid SVF declaration arrays.');
  const tuples = new Set(TYPESET_TUPLES.map(tupleKey));
  const typesets = new Set();
  for (const item of value.typesets) {
    fields(item, ['id', 'types'], [], 'SVF typeset');
    if (!text(item.id) || typesets.has(item.id) || !Array.isArray(item.types) || item.types.length === 0) unsupported('Invalid or duplicate SVF typeset.');
    typesets.add(item.id);
    const seenTuples = new Set();
    for (const type of item.types) {
      fields(type, ['class', 'type', 'version'], [], 'SVF type tuple');
      if (typeof type.class !== 'string' || typeof type.type !== 'string' || !Number.isSafeInteger(type.version) || !tuples.has(tupleKey(type)) || seenTuples.has(tupleKey(type))) unsupported('Unsupported or duplicate SVF type tuple.');
      seenTuples.add(tupleKey(type));
    }
  }
  const ids = new Set(), uris = new Set(), references = new Map();
  let embedded = 0;
  for (const asset of value.assets) {
    fields(asset, ['id', 'type', 'URI', 'size', 'usize'], ['typeset'], 'SVF asset');
    if (!text(asset.id) || !text(asset.URI) || !ASSET_TYPES.includes(asset.type) || !size(asset.size) || !size(asset.usize)) unsupported('Invalid or unsupported SVF asset.');
    if (ids.has(asset.id) || uris.has(asset.URI)) fail('INVALID_MANIFEST', 'Duplicate SVF asset ID or URI.');
    ids.add(asset.id); uris.add(asset.URI);
    if (Object.hasOwn(asset, 'typeset') && (!text(asset.typeset) || !typesets.has(asset.typeset))) unsupported('SVF asset has an absent or invalid typeset reference.');
    if (asset.URI === 'embed:/metadata.json') {
      if (asset.type !== PLATFORM + 'ViewingMetadata') unsupported('Invalid embedded metadata asset type.');
      const entry = archive.entries.get('metadata.json');
      if (!entry || entry.isDirectory) fail('RESOURCE_MISSING', 'SVF embedded metadata.json is absent.');
      if (asset.size !== entry.compressedBytes || asset.usize !== entry.bytes) fail('RESOURCE_SIZE_MISMATCH', 'Embedded compressed/uncompressed metadata sizes do not match its ZIP entry.');
      embedded++;
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:|^\/\//.test(asset.URI)) fail('EXTERNAL_REFERENCE', 'SVF loader URI must not contain a scheme or network destination.');
    if (!/^[A-Za-z0-9._-]+$/.test(asset.URI) || asset.URI === '.' || asset.URI === '..') fail('UNSAFE_PATH', 'SVF loader URI must be a canonical sibling basename.');
    const resolved = PREFIX + asset.URI;
    validateResourcePath(resolved);
    if (resolved === ENTRY || resolved === PROPERTY_DB || asset.type === PLATFORM + 'ViewingMetadata') unsupported('Unsupported external SVF asset target.', { path: resolved });
    const resource = resources.get(resolved);
    if (!resource) fail('RESOURCE_MISSING', 'A declared SVF sibling resource is missing.', { path: resolved });
    if (asset.size !== resource.bytes) fail('RESOURCE_SIZE_MISMATCH', 'SVF asset raw size differs from the portable resource record.', { path: resolved });
    if (JSON_TYPES.has(asset.type)) {
      if (asset.URI !== JSON_TYPES.get(asset.type)) unsupported('Unknown JSON asset type/basename binding.', { path: resolved });
    } else if (!/\.(pf|bin|pack)$/.test(asset.URI)) unsupported('Unsupported binary asset suffix.', { path: resolved });
    references.set(resolved, asset);
  }
  if (embedded !== 1) fail('RESOURCE_MISSING', 'SVF must declare exactly one embed:/metadata.json asset.');
  for (const resource of resources.values()) {
    if (resource.path !== ENTRY && resource.path !== PROPERTY_DB && !references.has(resource.path)) {
      fail('RESOURCE_UNEXPECTED', 'A resource is outside the supported SVF closure.', { path: resource.path });
    }
  }
  return { references, assetCount: value.assets.length, typesetCount: typesets.size };
}

/** Inspect only a bounded supported SVF envelope for dependency discovery.
 * External records are declarations, not verified files: callers must obtain
 * all resources and run validateProfile before publishing a ready package. */
export async function inspectSvfEnvelope(svfBytes, { limits = DEFAULT_LIMITS, signal } = {}) {
  limits = resolveLimits(limits);
  const started = Date.now(), deadline = started + limits.maxMs;
  function check() {
    if (signal?.aborted) fail('PACKAGE_ABORTED', 'SVF inspection was cancelled.');
    if (Date.now() > deadline) fail('PACKAGE_LIMIT_EXCEEDED', 'SVF inspection exceeded its time limit.');
  }
  check();
  if (!Buffer.isBuffer(svfBytes)) fail('INVALID_MANIFEST', 'SVF inspection requires raw Buffer bytes.');
  if (svfBytes.length > limits.maxNestedBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'SVF container exceeds the nested resource limit.');
  const archive = await openZip(svfBytes, { limits, signal });
  const embeddedEntries = [];
  let totalInflated = 0;
  try {
    const permitted = new Set(['manifest.json', 'metadata.json', 'scene/', 'geometry/', 'material/']);
    for (const entry of archive.entries.values()) {
      if (!permitted.has(entry.name) || entry.isDirectory && entry.bytes !== 0) unsupported('Unsupported embedded SVF archive entry.', { entry: entry.name });
    }
    async function jsonEntry(name, allowDuplicate) {
      const entry = archive.entries.get(name);
      if (!entry || entry.isDirectory) fail('RESOURCE_MISSING', 'Required embedded SVF entry is absent.', { entry: name });
      const cap = Math.min(limits.maxNestedBytes, limits.maxManifestBytes);
      if (entry.bytes > cap || entry.bytes > Math.max(1, entry.compressedBytes) * limits.maxExpansionRatio) fail('PACKAGE_LIMIT_EXCEEDED', 'Embedded SVF entry exceeds inspection limits.', { entry: name });
      const bytes = await archive.read(name, { maxBytes: cap });
      check(); totalInflated += bytes.length;
      if (totalInflated > limits.maxNestedTotalBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'SVF inspection exceeds the aggregate inflated limit.');
      embeddedEntries.push({ name, rawCompressedBytes: entry.compressedBytes, inflatedBytes: bytes.length });
      return decodeJson(bytes, { maxDepth: limits.maxDepth, allowDuplicate });
    }
    const manifest = await jsonEntry('manifest.json');
    if (!Array.isArray(manifest.assets)) unsupported('Invalid SVF asset declarations.');
    if (manifest.assets.length + 1 > limits.maxFiles) fail('PACKAGE_LIMIT_EXCEEDED', 'Declared SVF resources exceed the count limit.');
    const declared = new Map([[ENTRY, { path: ENTRY, bytes: svfBytes.length }], [PROPERTY_DB, { path: PROPERTY_DB, bytes: 0 }]]);
    let declaredBytes = svfBytes.length;
    for (const asset of manifest.assets) {
      if (typeof asset?.URI !== 'string' || asset.URI.startsWith('embed:')) continue;
      const resourcePath = PREFIX + asset.URI;
      if (!size(asset.size) || asset.size > limits.maxFileBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Declared SVF resource size exceeds its limit.');
      declaredBytes += asset.size;
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes > limits.maxTotalResourceBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Declared SVF resources exceed the aggregate raw limit.');
      declared.set(resourcePath, { path: resourcePath, bytes: asset.size });
    }
    const info = validateSvfManifest(manifest, declared, archive);
    assertNoCaseCollisions([...declared.keys()]);
    let duplicateMeterUnit = 0;
    const metadata = await jsonEntry('metadata.json', ({ path, key, previous, value }) => {
      if (path === '$.metadata["default display unit"]' && key === 'default display unit' && meterValue(previous) && meterValue(value) && duplicateMeterUnit++ === 0) return true;
      return false;
    });
    validateMetadata(metadata); check();
    return {
      status: 'INSPECTED', supportProfile: 'svf-local-7.130.0-v1', toolkitVersion: manifest.toolkitversion,
      manifestVersion: manifest.manifestversion, resourceClosureVerified: false,
      resources: [...info.references.values()].map(asset => ({ path: 'output/0/' + asset.URI,
        bytes: asset.size, inflatedBytes: asset.usize, assetType: asset.type })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
      additionalResources: ['output/0/properties.db'], assetCount: info.assetCount, typesetCount: info.typesetCount,
      embeddedEntries, durationMs: Date.now() - started,
    };
  } finally { await archive.close(); }
}

/** Inspect loader declarations and bounded containers. Raw SHA verification is
 * performed by the provider's caller; terminal PackFiles/SQLite are not executed
 * or interpreted as arbitrary semantic data. No dependency is fetched. */
export async function validateProfile(provider, { limits = DEFAULT_LIMITS, signal } = {}) {
  limits = resolveLimits(limits);
  const started = Date.now(), deadline = started + limits.maxMs;
  function check() {
    if (signal?.aborted) fail('PACKAGE_ABORTED', 'Profile verification was cancelled.');
    if (Date.now() > deadline) fail('PACKAGE_LIMIT_EXCEEDED', 'Profile verification exceeded the time limit.');
  }
  check();
  if (!provider || !Array.isArray(provider.resources) || typeof provider.read !== 'function' || typeof provider.stream !== 'function') fail('INVALID_MANIFEST', 'Profile requires a resource provider.');
  const resources = new Map();
  assertNoCaseCollisions(provider.resources.map(item => item.path));
  let totalRaw = 0;
  for (const resource of provider.resources) {
    validateResourcePath(resource.path);
    if (!resource.path.startsWith(PREFIX) || resource.path.slice(PREFIX.length).includes('/')) unsupported('Resources must be direct output/0 siblings.');
    if (!size(resource.bytes) || resource.bytes > limits.maxFileBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Invalid or over-limit raw resource size.', { path: resource.path });
    totalRaw += resource.bytes;
    if (!Number.isSafeInteger(totalRaw) || totalRaw > limits.maxTotalResourceBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Raw resource aggregate exceeds its limit.');
    const basename = resource.path.slice(PREFIX.length);
    if (resource.path !== ENTRY && resource.path !== PROPERTY_DB && !JSON_BASENAMES.includes(basename) && !/\.(pf|bin|pack)$/.test(basename)) {
      if (/\.(js|mjs|html?|css|wasm|exe|dll|ps1|sh)$/i.test(basename)) fail('EXECUTABLE_CONTENT', 'Runtime or executable files are forbidden in model resources.');
      unsupported('Unknown model resource suffix or basename.', { path: resource.path });
    }
    resources.set(resource.path, resource);
  }
  if (resources.size > limits.maxFiles) fail('PACKAGE_LIMIT_EXCEEDED', 'Too many model resources.');
  if (!resources.has(ENTRY) || !resources.has(PROPERTY_DB)) fail('RESOURCE_MISSING', 'The entry SVF and additional properties.db are required.');
  if (resources.get(ENTRY).bytes > limits.maxNestedBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'SVF container exceeds the nested resource limit.');
  let nestedInflatedBytes = 0, terminalInflatedBytes = 0;
  const gzip = [], embeddedEntries = [];
  function addNested(bytes) {
    nestedInflatedBytes += bytes;
    if (nestedInflatedBytes > limits.maxNestedTotalBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Inspected nested content exceeds the aggregate inflated limit.');
  }
  const svfBytes = await provider.read(ENTRY, { maxBytes: limits.maxNestedBytes });
  check();
  if (svfBytes.length !== resources.get(ENTRY).bytes) fail('RESOURCE_SIZE_MISMATCH', 'Entry SVF raw byte size differs from its resource record.');
  const archive = await openZip(svfBytes, { limits, signal });
  let manifestInfo;
  try {
    const permitted = new Set(['manifest.json', 'metadata.json', 'scene/', 'geometry/', 'material/']);
    for (const entry of archive.entries.values()) {
      if (!permitted.has(entry.name) || (entry.isDirectory && entry.bytes !== 0)) unsupported('Unsupported embedded SVF archive entry.', { entry: entry.name });
    }
    async function jsonEntry(name, allowDuplicate) {
      const entry = archive.entries.get(name);
      if (!entry || entry.isDirectory) fail('RESOURCE_MISSING', 'Required embedded SVF entry is absent.', { entry: name });
      if (entry.bytes > limits.maxNestedBytes || entry.bytes > Math.max(1, entry.compressedBytes) * limits.maxExpansionRatio) fail('PACKAGE_LIMIT_EXCEEDED', 'Embedded SVF entry exceeds inflated limits.', { entry: name });
      const bytes = await archive.read(name, { maxBytes: limits.maxNestedBytes });
      check();
      addNested(bytes.length);
      embeddedEntries.push({ name, rawCompressedBytes: entry.compressedBytes, inflatedBytes: bytes.length });
      return decodeJson(bytes, { maxDepth: limits.maxDepth, allowDuplicate });
    }
    const manifest = await jsonEntry('manifest.json');
    manifestInfo = validateSvfManifest(manifest, resources, archive);
    let duplicateMeterUnit = 0;
    const metadata = await jsonEntry('metadata.json', ({ path, key, previous, value }) => {
      if (path === '$.metadata["default display unit"]' && key === 'default display unit' && meterValue(previous) && meterValue(value) && duplicateMeterUnit++ === 0) return true;
      return false;
    });
    validateMetadata(metadata);
  } finally { await archive.close(); }

  // Nested metadata uses its 256 MiB/1 GiB bounds. Opaque binary terminal gzip
  // is integrity-streamed without retention under the independent resource
  // bounds. Counting it as nested metadata would reject the agreed snapshot.
  async function inspectResource(resource, structured) {
    check();
    const original = provider.stream(resource.path);
    const iterator = original[Symbol.asyncIterator]();
    // A stalled source must not make the total deadline depend on the next
    // arriving chunk. Destroying the stream settles a pending iterator read.
    const timeout = setTimeout(() => original.destroy(new PackageError('PACKAGE_LIMIT_EXCEEDED', 'Profile verification exceeded the time limit.')), Math.max(1, deadline - Date.now()));
    const abort = () => original.destroy(new PackageError('PACKAGE_ABORTED', 'Profile verification was cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    let first, rawBytes = 0;
    const rawPrefix = [], chunks = [], prefixChunks = [];
    let rawPrefixLength = 0, prefixLength = 0, inflatedBytes = 0, compressed = false;
    try {
      do { check(); first = await iterator.next(); } while (!first.done && first.value.length === 0);
      if (first.done) unsupported('Empty model data resource.', { path: resource.path });
      let head = Buffer.from(first.value);
      // A provider may emit arbitrarily small chunks. Detect the envelope from
      // two actual bytes rather than assuming the first stream chunk is large.
      while (head.length < 2) {
        check();
        const next = await iterator.next();
        if (next.done) break;
        head = Buffer.concat([head, Buffer.from(next.value)]);
      }
      compressed = head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
      if (structured && !compressed) fail('GZIP_INVALID', 'Recognized JSON resources must retain their raw gzip envelope.', { path: resource.path });
      const input = Readable.from((async function* () {
        let item = { done: false, value: head };
        while (!item.done) {
          check();
          const bytes = Buffer.from(item.value);
          rawBytes += bytes.length;
          if (rawBytes > resource.bytes || rawBytes > limits.maxFileBytes) fail('RESOURCE_SIZE_MISMATCH', 'Stream exceeds the declared raw size.', { path: resource.path });
          if (rawPrefixLength < 1024) { const part = bytes.subarray(0, 1024 - rawPrefixLength); rawPrefix.push(part); rawPrefixLength += part.length; }
          yield bytes;
          item = await iterator.next();
        }
      })(), { objectMode: false });
      const decoded = compressed ? input.pipe(createGunzip()) : input;
      const forwardError = error => decoded.destroy(error);
      if (compressed) input.once('error', forwardError);
      try {
        for await (const item of decoded) {
          check();
          const bytes = Buffer.from(item);
          inflatedBytes += bytes.length;
          const cap = structured ? limits.maxNestedBytes : limits.maxFileBytes;
          if (inflatedBytes > cap || (compressed && inflatedBytes > Math.max(1, resource.bytes) * limits.maxExpansionRatio)) fail('PACKAGE_LIMIT_EXCEEDED', 'Resource inflation exceeds its byte or ratio limit.', { path: resource.path });
          if (structured) addNested(bytes.length);
          else {
            terminalInflatedBytes += bytes.length;
            if (terminalInflatedBytes > limits.maxTotalResourceBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Terminal data streaming exceeds the computational aggregate limit.');
          }
          if (prefixLength < 1024) { const part = bytes.subarray(0, 1024 - prefixLength); prefixChunks.push(part); prefixLength += part.length; }
          if (structured) chunks.push(bytes);
        }
      } finally {
        input.removeListener('error', forwardError);
        input.destroy(); decoded.destroy();
      }
      if (rawBytes !== resource.bytes) fail('RESOURCE_SIZE_MISMATCH', 'Stream raw size differs from its resource record.', { path: resource.path });
      const declaration = manifestInfo.references.get(resource.path);
      // Some property declarations use zero as an unspecified inflated size.
      // Positive usize is an envelope assertion, never a raw-byte substitute.
      if (declaration?.usize > 0 && declaration.usize !== inflatedBytes) fail('RESOURCE_SIZE_MISMATCH', 'SVF declared inflated size differs from the integrity stream.', { path: resource.path });
      const prefix = Buffer.concat(prefixChunks);
      sniffBinary(Buffer.concat(rawPrefix), resource.path);
      if (!structured) sniffBinary(prefix, resource.path);
      if (resource.path === PROPERTY_DB && (compressed || !prefix.subarray(0, 16).equals(Buffer.from('SQLite format 3\0', 'ascii')))) unsupported('properties.db must be a raw SQLite format-3 data file.');
      if (compressed) gzip.push({ path: resource.path, rawBytes, inflatedBytes, structured, status: 'PASS' });
      return structured ? decodeJson(Buffer.concat(chunks, inflatedBytes), { maxDepth: limits.maxDepth }) : null;
    } catch (error) {
      if (error instanceof PackageError) throw error;
      if (signal?.aborted) fail('PACKAGE_ABORTED', 'Profile verification was cancelled.');
      if (error?.code?.startsWith('Z_')) fail('GZIP_INVALID', 'Corrupt or truncated raw gzip resource.', { path: resource.path });
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      original.destroy();
      await iterator.return?.();
    }
  }

  let materialMaps = 0, structuredJsonCount = 0;
  for (const resource of resources.values()) {
    if (resource.path === ENTRY) continue;
    const basename = resource.path.slice(PREFIX.length), structured = JSON_BASENAMES.includes(basename);
    const data = await inspectResource(resource, structured);
    if (structured) structuredJsonCount++;
    if (basename === 'Materials.json.gz') materialMaps += validateMaterials(data);
  }
  check();
  return {
    status: 'PASS', supportProfile: 'svf-local-7.130.0-v1',
    closure: { status: 'PASS', externalReferences: manifestInfo.references.size, embeddedReferences: 1, additionalResources: ['properties.db'], assetCount: manifestInfo.assetCount, typesetCount: manifestInfo.typesetCount },
    sizes: { rawResourceBytes: totalRaw, resourceCount: resources.size, nestedInflatedBytes, terminalInflatedBytes, inspectedNestedScope: 'SVF entries and recognized gzip JSON', terminalScope: 'Opaque binary/property integrity streams; no semantic execution' },
    embeddedEntries, structuredJsonCount, emptyMaterialTextureMaps: materialMaps,
    gzip: { status: 'PASS', count: gzip.length, resources: gzip },
    durationMs: Date.now() - started,
  };
}
