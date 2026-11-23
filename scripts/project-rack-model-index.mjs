// Build local instrument/rack evidence from an immutable SVF package and saved observations.
import pg from 'pg';
import { Client } from 'minio';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { rackPageProvesPair } from './rack-page-proof.mjs';
import { readCurrentEndpointBindingContext } from '../server/dist/server/pathfinder/endpointBindingRepository.js';

const [project, jobId, mode] = process.argv.slice(2);
const install = mode === '--install';
const must = (ok, why) => {
  if (!ok) throw Error(why);
};
const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = (b) => JSON.parse(b.toString('utf8').replace(/^\uFEFF/, ''));
const key = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .trim()
    .toUpperCase()
    .replace(/^\//, '');
const generationVersion = 'svf-visible-rack-pairs.v3';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
must(uuid.test(project) && uuid.test(jobId) && (!mode || install), 'Invalid local index arguments');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  // Release the shared scope reader's model and preparation locks before scanning the package.
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const scope = await readCurrentEndpointBindingContext(db, project);
  await db.query('COMMIT');
  must(scope?.traceId, 'No current prepared model scope');
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {
    rows: [job],
  } = await db.query(
    'SELECT observations, files FROM assistant_jobs WHERE project_id=$1 AND id=$2',
    [project, jobId],
  );
  const {
    rows: [m],
  } = await db.query(
    `SELECT m.*,s.selection_revision FROM model_versions m JOIN project_model_selections s ON s.project_id=m.project_id AND s.active_model_version_id=m.id WHERE s.project_id=$1 AND m.state='ready' AND m.health='healthy'`,
    [project],
  );
  must(
    job &&
      m &&
      m.id === scope.modelVersionId &&
      m.content_fingerprint === scope.contentFingerprint &&
      String(m.selection_revision) === scope.selectionRevision,
    'Job/model mismatch',
  );
  const indexPath = join(
    process.env.PF_ROOT || '/var/lib/wfc/pathfinder',
    'assistant-model-evidence',
    project,
    m.id,
    jobId + '.json',
  );
  const observationHash = hash(JSON.stringify([job.observations, job.files]));
  if (install) {
    let cached;
    try {
      cached = JSON.parse(await readFile(indexPath, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (
      cached?.projectId === project &&
      cached.jobId === jobId &&
      cached.generationVersion === generationVersion &&
      cached.observationHash === observationHash &&
      isDeepStrictEqual(cached.current, scope)
    ) {
      await db.end();
      process.exit(0);
    }
    // Remove obsolete input evidence before a rebuild, including when the new package is unsupported.
    if (cached) await rm(indexPath);
  }
  const {
    rows: [trace],
  } = await db.query('SELECT manifest FROM pf_geometry_trace_sets WHERE project_id=$1 AND id=$2', [
    project,
    scope.traceId,
  ]);
  must(
    trace?.manifest.captureFrameId === scope.captureFrameId &&
      trace.manifest.projection.sha256 === scope.projectionSha256,
    'Trace/frame mismatch',
  );
  const e = process.env,
    store = new Client({
      endPoint: e.MINIO_ENDPOINT,
      port: Number(e.MINIO_PORT || 9000),
      useSSL: e.MINIO_USE_SSL === 'true',
      accessKey: e.MINIO_ACCESS_KEY,
      secretKey: e.MINIO_SECRET_KEY,
    });
  const resourceHashes = {};
  async function resource(name) {
    const r = m.manifest.resources.filter((v) => v.path === 'resources/output/0/' + name);
    must(r.length === 1 && r[0].bytes <= 128 * 1024 * 1024, 'Missing or unsupported resource');
    const stream = await store.getObject(
      e.WFC_MODEL_BUCKET ?? 'wfc-models',
      m.storage_prefix + r[0].path,
    );
    const parts = [];
    let count = 0;
    for await (const b of stream) {
      count += b.length;
      must(count <= r[0].bytes, 'Unexpected asset size');
      parts.push(b);
    }
    const data = Buffer.concat(parts);
    resourceHashes[name] = hash(data);
    must(count === r[0].bytes && resourceHashes[name] === r[0].sha256, 'Asset checksum mismatch');
    return data;
  }
  const [attrs, avs, offsets, values] = await Promise.all(
    ['attrs', 'avs', 'offs', 'vals'].map(async (name) =>
      json(
        gunzipSync(await resource('objects_' + name + '.json.gz'), {
          maxOutputLength: 256 * 1024 * 1024,
        }),
      ),
    ),
  );
  function metadataFromZip(b) {
    const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
    must(end >= 0, 'SVF zip directory missing');
    const records = b.readUInt16LE(end + 10);
    let at = b.readUInt32LE(end + 16);
    for (let i = 0; i < records; i++) {
      must(b.readUInt32LE(at) === 0x02014b50, 'Invalid zip directory');
      const size = b.readUInt32LE(at + 20),
        method = b.readUInt16LE(at + 10),
        local = b.readUInt32LE(at + 42);
      const len = b.readUInt16LE(at + 28),
        name = b.toString('utf8', at + 46, at + 46 + len);
      at += 46 + len + b.readUInt16LE(at + 30) + b.readUInt16LE(at + 32);
      if (name !== 'metadata.json') continue;
      must(
        b.readUInt32LE(local) === 0x04034b50 && [0, 8].includes(method),
        'Invalid SVF metadata entry',
      );
      const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      const compressed = b.subarray(start, start + size);
      return json(
        method === 8
          ? inflateRawSync(compressed, { maxOutputLength: 4 * 1024 * 1024 })
          : compressed,
      ).metadata;
    }
    throw Error('No coordinate metadata');
  }
  const metadata = metadataFromZip(await resource('0.svf'));
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const scale = { m: 1, mm: 0.001 }[metadata['distance unit']?.value];
  must(
    scale &&
      eq(metadata['world up vector']?.XYZ, [0, 0, 1]) &&
      eq(metadata['custom values']?.refPointTransform, identity) &&
      eq(metadata['custom values']?.nwModelToWorldTransform, identity) &&
      metadata['view to model transform']?.type === 4,
    'Unsupported SVF placement',
  );
  const parentAttr = attrs.findIndex((v) => v?.[1] === '__parent__'),
    childAttr = attrs.findIndex((v) => v?.[1] === '__child__');
  must(
    parentAttr > 0 && childAttr > 0 && offsets.at(-1) * 2 <= avs.length && avs.length % 2 === 0,
    'Unsupported hierarchy table',
  );
  const n = offsets.length,
    parents = new Int32Array(n),
    childCounts = new Int32Array(n),
    edges = new Map();
  const children = new Map(),
    nodeFlags = new Map(),
    instances = new Map();
  const flagsAttr = attrs.findIndex((v) => v?.[1] === '__node_flags__'),
    instanceAttr = attrs.findIndex((v) => v?.[1] === '__instanceof__');
  for (let id = 1; id < n; id++) {
    const end = id + 1 < n ? 2 * offsets[id + 1] : avs.length;
    for (let o = 2 * offsets[id]; o < end; o += 2) {
      const kind = avs[o];
      if (kind === flagsAttr) nodeFlags.set(id, values[avs[o + 1]]);
      if (kind === instanceAttr) instances.set(id, values[avs[o + 1]]);
      if (kind !== parentAttr && kind !== childAttr) continue;
      const target = values[avs[o + 1]];
      must(
        Number.isInteger(target) && target > 0 && target < n && target !== id,
        'Invalid hierarchy target',
      );
      const parent = kind === parentAttr ? target : id,
        child = kind === parentAttr ? id : target;
      if (kind === childAttr) {
        const bucket = children.get(parent) ?? [];
        bucket.push(child);
        children.set(parent, bucket);
      }
      must(!parents[child] || parents[child] === parent, 'Multiple hierarchy parents');
      parents[child] = parent;
      edges.set(child, (edges.get(child) ?? 0) | (kind === parentAttr ? 1 : 2));
    }
  }
  for (const [child, basis] of edges) {
    must(basis === 3, 'Parent/child links disagree');
    childCounts[parents[child]]++;
  }
  const fragments = gunzipSync(await resource('FragmentList.pack'), {
    maxOutputLength: 512 * 1024 * 1024,
  });
  let cursor = 0;
  const byte = () => fragments.readUInt8(cursor++);
  function u32() {
    const value = fragments.readUInt32LE(cursor);
    cursor += 4;
    return value;
  }
  function varint() {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = byte();
      v += (b & 127) * 2 ** (7 * i);
      if (b < 128) return v;
    }
    throw Error('Oversized packed integer');
  }
  function string(len) {
    const value = fragments.toString('utf8', cursor, cursor + len);
    cursor += len;
    return value;
  }
  function f32() {
    const v = fragments.readFloatLE(cursor);
    cursor += 4;
    return v;
  }
  function f64() {
    const v = fragments.readDoubleLE(cursor);
    cursor += 8;
    return v;
  }
  must(
    string(u32()) === 'Autodesk.CloudPlatform.PackFile' && u32() === 2,
    'Unsupported fragment container',
  );
  const entryArea = cursor;
  cursor = fragments.length - 8;
  const offsetIndex = u32(),
    typeIndex = u32();
  cursor = typeIndex;
  must(
    varint() === 1 &&
      string(varint()) === 'Autodesk.CloudPlatform.Fragment' &&
      string(varint()) === 'Autodesk.CloudPlatform.FragmentData' &&
      varint() === 5 &&
      cursor === offsetIndex,
    'Unsupported fragment data version',
  );
  cursor = offsetIndex;
  const fragmentCount = varint(),
    offsetBase = cursor;
  must(offsetBase + 4 * fragmentCount === fragments.length - 8, 'Malformed fragment index');
  const fragmentCounts = new Uint32Array(n),
    visibleCounts = new Uint32Array(n);
  const fragmentVisibility = Buffer.alloc(fragmentCount);
  const extent = new Float64Array(6 * n);
  for (let id = 0; id < n; id++)
    for (let j = 0; j < 6; j++) extent[id * 6 + j] = j < 3 ? Infinity : -Infinity;
  function add(id, b) {
    for (let j = 0; j < 6; j++) {
      const i = id * 6 + j;
      extent[i] = j < 3 ? Math.min(extent[i], b[j]) : Math.max(extent[i], b[j]);
    }
  }
  const transformSizes = new Map([
    [0, 0],
    [1, 16],
    [2, 20],
    [3, 36],
    [5, 28],
  ]);
  for (let i = 0; i < fragmentCount; i++) {
    cursor = fragments.readUInt32LE(offsetBase + 4 * i);
    must(cursor >= entryArea && cursor < typeIndex && u32() === 0, 'Corrupt fragment type');
    const flags = byte();
    varint();
    varint(); // material and geometry metadata index
    const kind = byte();
    let translation = [0, 0, 0];
    if (kind !== 4) {
      must(transformSizes.has(kind), 'Unknown fragment transform');
      cursor += transformSizes.get(kind);
      translation = [f64(), f64(), f64()];
    }
    // V5 boxes already have fragment rotation/scale applied. Translation alone
    // is stored separately; rendering subtracts its global offset and WFC adds
    // the same offset back when exporting canonical project metres.
    const box = Array.from({ length: 6 }, (_, j) => (f32() + translation[j % 3]) * scale);
    const dbId = varint();
    // The native worker seeks to each dictionary offset; trailing per-entry
    // path metadata is not part of the fragment bounds or object ID.
    must(
      cursor <=
        (i + 1 < fragmentCount ? fragments.readUInt32LE(offsetBase + 4 * (i + 1)) : typeIndex),
      'Fragment overlaps next entry',
    );
    must(
      dbId > 0 &&
        dbId < n &&
        box.every(Number.isFinite) &&
        box.slice(0, 3).every((v, j) => v <= box[j + 3]),
      'Invalid source bounds or object ID',
    );
    add(dbId, box);
    fragmentCounts[dbId]++;
    if (flags & 1) {
      visibleCounts[dbId]++;
      fragmentVisibility[i] = 1;
    }
  }
  const leaves = [];
  for (let i = 1; i < n; i++) if (!childCounts[i]) leaves.push(i);
  for (let pos = 0; pos < leaves.length; pos++) {
    const id = leaves[pos],
      p = parents[id];
    if (!p) continue;
    if (fragmentCounts[id]) add(p, extent.subarray(id * 6, id * 6 + 6));
    fragmentCounts[p] += fragmentCounts[id];
    visibleCounts[p] += visibleCounts[id];
    if (--childCounts[p] === 0) leaves.push(p);
  }
  must(leaves.length === n - 1, 'Cyclic hierarchy');
  function boxFor(id) {
    return {
      minimum: Array.from(extent.subarray(6 * id, 6 * id + 3)),
      maximum: Array.from(extent.subarray(6 * id + 3, 6 * id + 6)),
    };
  }
  const bottom = (b) => [
    (b.minimum[0] + b.maximum[0]) / 2,
    (b.minimum[1] + b.maximum[1]) / 2,
    b.minimum[2],
  ];
  const geometryCount = leaves.filter((i) => fragmentCounts[i] > 0).length;
  const roots = leaves.filter((id) => !parents[id] && fragmentCounts[id]);
  must(roots.length === 1, 'Unexpected native roots');
  const walk = [roots[0]],
    nodeBytes = Buffer.alloc(16 + 9 * geometryCount + fragmentCount);
  nodeBytes.writeUInt32BE(1);
  nodeBytes.writeUInt32BE(geometryCount, 4);
  nodeBytes.writeUInt32BE(fragmentCount, 8);
  nodeBytes.writeUInt32BE(roots[0], 12);
  let rowCount = 0,
    authoredHiddenOrOff = 0;
  while (walk.length) {
    const id = walk.pop();
    const raw = nodeFlags.get(id) ?? nodeFlags.get(instances.get(id)) ?? 0;
    const flags = ((raw >>> 31) & 1) | (((raw >>> 30) & 1) << 1);
    if (flags) authoredHiddenOrOff++;
    const at = 16 + 9 * rowCount++;
    nodeBytes.writeUInt32BE(id, at);
    nodeBytes.writeUInt32BE(id === roots[0] ? 0xffffffff : parents[id], at + 4);
    nodeBytes[at + 8] = flags;
    const kids = children.get(id) ?? [];
    for (let j = kids.length - 1; j >= 0; j--) if (fragmentCounts[kids[j]]) walk.push(kids[j]);
  }
  must(rowCount === geometryCount, 'Visibility tree count differs from geometry tree');
  fragmentVisibility.copy(nodeBytes, 16 + 9 * rowCount);

  const visibilityScopeSha256 = hash(nodeBytes);
  function hiddenOnPath(id) {
    for (let p = id; p; p = parents[p]) {
      const flags = nodeFlags.get(p) ?? nodeFlags.get(instances.get(p)) ?? 0;
      if (flags >>> 30 !== 0) return true;
    }
    return false;
  }
  function fullyVisible(id) {
    if (!fragmentCounts[id] || visibleCounts[id] !== fragmentCounts[id] || hiddenOnPath(id))
      return false;
    const pending = [id];
    while (pending.length) {
      const current = pending.pop();
      for (const child of children.get(current) ?? []) {
        if (!fragmentCounts[child]) continue;
        if (hiddenOnPath(child)) return false;
        pending.push(child);
      }
    }
    return true;
  }
  const controls = (
    await db.query(
      `SELECT object_id,record->'geometry'->'bounds' AS box FROM pf_geometry_object_revisions WHERE project_id=$1 AND trace_id=$2 AND record->'geometry'->>'role'='routing-leaf'`,
      [project, scope.traceId],
    )
  ).rows;
  let maxBoundDeltaMetres = 0;
  for (const c of controls) {
    const id = Number(c.object_id.replace(/^dbid:/, ''));
    must(fragmentCounts[id] && c.box, 'Trace control missing');
    const b = boxFor(id);
    for (const k of ['minimum', 'maximum'])
      for (let j = 0; j < 3; j++)
        maxBoundDeltaMetres = Math.max(maxBoundDeltaMetres, Math.abs(b[k][j] - c.box[k][j]));
  }
  must(
    controls.length >= 3 && maxBoundDeltaMetres <= 0.001,
    'Coordinates not corroborated against current trace',
  );
  const names = Array(n),
    nameAttr = attrs.findIndex((a) => a?.[0] === 'name');
  for (let id = 1; id < n; id++)
    for (let j = offsets[id]; j < (offsets[id + 1] ?? avs.length / 2); j++)
      if (avs[j * 2] === nameAttr) names[id] = values[avs[j * 2 + 1]];
  const instruments = [],
    racks = [];
  // Identify branch roles only when the converted hierarchy supplies a unique, explicit family.
  // An unsupported language, naming convention or ambiguous collection falls back to normal WFC matching.
  const roles = new Set(names.filter((name) => typeof name === 'string').map(key));
  function branch(pattern) {
    const matches = [...roles].filter((name) => pattern.test(name));
    must(matches.length === 1, 'Project model branch unavailable');
    return matches[0];
  }
  const instrumentBranch = branch(/^(?:[A-Z0-9]+[_ -])*INSTRUMENTS$/u);
  const rackBranch = branch(/^(?:[A-Z0-9]+[_ -])*(?:INSTRUMENT|INST)[_ -]RACKS?$/u);
  for (let id = 1; id < n; id++) {
    const parent = key(names[parents[id]]);
    if (parent === key(instrumentBranch)) instruments.push(id);
    else if (parent === key(rackBranch)) racks.push(id);
  }
  must(instruments.length && racks.length, 'Project model branch unavailable');
  const intersects = (a, b) =>
    a.minimum.every((lo, j) => lo <= b.maximum[j] && b.minimum[j] <= a.maximum[j]);
  const entries = [],
    rejects = [];
  const documents = new Map();
  async function sourcePage(observation) {
    const file = job.files[observation.sourceIndex];
    if (
      !file ||
      file.name !== observation.file ||
      !file.key.startsWith('projects/' + project + '/') ||
      !/\.pdf$/i.test(file.name) ||
      !Number.isInteger(observation.page) ||
      observation.page < 1
    )
      return null;
    if (!documents.has(file.key)) {
      documents.set(file.key, null);
      try {
        const stream = await store.getObject(
          e.MINIO_BUCKET_PROJECTS ?? 'wfc-project-files',
          file.key,
        );
        const parts = [];
        let length = 0;
        for await (const part of stream) {
          length += part.length;
          if (length > 64 * 1024 * 1024) throw Error('Document limit');
          parts.push(part);
        }
        const pdf = Buffer.concat(parts);
        const pages = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', '-', '-'], {
          input: pdf,
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          timeout: 60000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).split('\f');
        documents.set(file.key, { sha256: hash(pdf), pages });
      } catch {
        /* A missing or unreadable source cannot corroborate a legacy finding. */
      }
    }
    const doc = documents.get(file.key),
      text = doc?.pages[observation.page - 1];
    if (!text || !rackPageProvesPair(text, key(observation.tag), key(observation.target)))
      return null;
    return {
      fileId: file.id,
      versionId: file.versionId,
      fileSha256: doc.sha256,
      sourceIndex: observation.sourceIndex,
      page: observation.page,
    };
  }
  const grouped = new Map();
  for (const finding of job.observations) {
    const id = key(finding.tag);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(finding);
  }
  // A pipe tapping point may have the exact tag. Retain its native type and bounded
  // hierarchy for a comparison with the mounted instrument, without exporting the model.
  const nativeType = attrs.findIndex((attr) => attr?.[0] === 'lcldrvm_props:lcldrvm_prop_type');
  const alternativesByTag = new Map();
  for (let id = 1; id < n; id++) {
    const tag = key(names[id]);
    if (!grouped.has(tag) || !fragmentCounts[id]) continue;
    const ids = alternativesByTag.get(tag) ?? [];
    ids.push(id);
    alternativesByTag.set(tag, ids);
  }
  function candidateEvidence(id, rackBounds) {
    let role = 'model object';
    for (let p = offsets[id]; p < (offsets[id + 1] ?? avs.length / 2); p++) {
      if (avs[p * 2] === nativeType && typeof values[avs[p * 2 + 1]] === 'string') {
        role = values[avs[p * 2 + 1]].slice(0, 100);
        break;
      }
    }
    const hierarchy = [];
    for (let p = parents[id]; p && hierarchy.length < 4; p = parents[p]) {
      if (typeof names[p] === 'string') hierarchy.unshift(names[p].slice(0, 160));
    }
    return {
      objectId: id,
      modelName: names[id],
      role,
      hierarchy,
      visible: fullyVisible(id),
      intersectsRack: intersects(boxFor(id), rackBounds),
    };
  }
  for (const obs of grouped.values()) {
    const proposal = obs[0];
    const { tag, target } = proposal;
    const reject = (reason) => rejects.push({ tag, target, reason });
    if (
      !obs.length ||
      obs.some(
        (o) => key(o.target) !== key(target) || o.branch || o.property || !o.evidence?.trim(),
      )
    ) {
      reject('conflicting or constrained document findings');
      continue;
    }
    if (key(tag) === key(target)) {
      reject('document does not specify a distinct rack');
      continue;
    }
    const matchedRacks = racks.filter((id) => key(names[id]) === key(target) && fullyVisible(id));
    if (matchedRacks.length !== 1) {
      reject('rack unavailable or ambiguous');
      continue;
    }
    const rack = matchedRacks[0],
      rackBounds = boxFor(rack);
    const visible = instruments.filter(
      (id) =>
        (key(names[id]) === key(tag) || key(names[id]).startsWith(key(tag) + '_')) &&
        fullyVisible(id),
    );
    const onRack = visible.filter((id) => intersects(boxFor(id), rackBounds));
    if (onRack.length !== 1) {
      reject(
        onRack.length
          ? 'multiple instruments on rack'
          : visible.length
            ? 'instrument outside rack'
            : 'visible instrument missing',
      );
      continue;
    }
    const dbId = onRack[0],
      bounds = boxFor(dbId);
    const documentSources = [];
    for (const finding of obs) documentSources.push(await sourcePage(finding));
    entries.push({
      tag,
      target,
      dbId,
      rackDbId: rack,
      point: bottom(bounds),
      bounds,
      rackBounds,
      modelName: names[dbId],
      rackName: names[rack],
      alternatives: (alternativesByTag.get(key(tag)) ?? [])
        .filter((id) => id !== dbId)
        .slice(0, 16)
        .map((id) => candidateEvidence(id, rackBounds)),
      verifiedDocumentPair: documentSources.every(Boolean),
      documentSources: documentSources.filter(Boolean),
      visibilityScopeSha256,
      sourceIndex: proposal.sourceIndex,
      page: proposal.page,
    });
  }
  const evidence = JSON.stringify({
    schemaVersion: 'wfc.local-rack-model-evidence.v1',
    generationVersion,
    observationHash,
    projectId: project,
    current: scope,
    jobId,
    modelLabel: m.label,
    visibilityScopeSha256,
    resourceHashes,
    visibilityBasis:
      'Authored fragment defaults and native ancestor hidden/off bits in the immutable source package',
    policy: {
      instrumentBranch,
      rackBranch,
      nameRule: 'tag or tag followed by underscore; immediate named children only',
      spatialRule: 'visible instrument and documented rack intersect in the current project frame',
    },
    controls: { count: controls.length, maxBoundDeltaMetres },
    objectCount: n - 1,
    entries,
    rejects,
  });
  if (install) {
    await mkdir(dirname(indexPath), { recursive: true, mode: 0o700 });
    const temp = indexPath + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temp, evidence, { flag: 'wx', mode: 0o600 });
      await rename(temp, indexPath);
    } finally {
      await rm(temp, { force: true });
    }
  } else console.log(evidence);
} finally {
  await db.end();
}
