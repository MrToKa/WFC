import { performance } from 'node:perf_hooks';
import { canonical, sha256, UUID, SHA } from '../pathfinder-capacity/lib.mjs';

export const LIMITS = Object.freeze({ cables: 100000, keys: 200000, objects: 1000000, properties: 10000000,
  work: 50000000, depth: 512, associations: 5000000, compressedBytes: 64 * 1024 ** 2,
  decodedBytes: 128 * 1024 ** 2, totalDecodedBytes: 256 * 1024 ** 2, inputBytes: 128 * 1024 ** 2,
  privateOutputBytes: 256 * 1024 ** 2, publicOutputBytes: 128 * 1024, milliseconds: 180000, rssBytes: 1536 * 1024 ** 2 });
export const fail = code => { throw Object.assign(new Error(code), { code }); };
export const requireThat = (value, code) => { if (!value) fail(code); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const string = (value, maximum = 8192) => typeof value === 'string' && value.length <= maximum;
const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const nullableText = value => value === null || string(value);
const decimal = value => value === null || string(value, 100) && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value);
export function makeBudget(limits = LIMITS) {
  const started = performance.now(); let work = 0;
  return (amount = 1) => {
    work += amount; requireThat(work <= limits.work, 'CANDIDATE_WORK_LIMIT');
    if (work % 1024 < amount) {
      requireThat(performance.now() - started <= limits.milliseconds, 'CANDIDATE_DEADLINE');
      requireThat(process.memoryUsage().rss <= limits.rssBytes, 'CANDIDATE_MEMORY_LIMIT');
    }
  };
}

export function validateCurrentInput(value, normalizer, { projectId, projectName, projectNumber, contentFingerprint } = {}) {
  requireThat(object(value) && value.schemaVersion === 'pathfinder.current-inputs.snapshot.v1' && object(value.project) && object(value.selection) && object(value.model) && Array.isArray(value.cables), 'CURRENT_INPUT_SCHEMA');
  const p = value.project, m = value.model, s = value.selection;
  requireThat(UUID.test(p.id ?? '') && string(p.name, 500) && (p.projectNumber === null || string(p.projectNumber, 500)) && ['secondaryTrayLength', 'endConnectionLength', 'additionalBendingPercent'].every(key => decimal(p[key])), 'CURRENT_PROJECT_SCHEMA');
  requireThat((!projectId || p.id === projectId) && (projectName === undefined || p.name === projectName) && (projectNumber === undefined || p.projectNumber === projectNumber), 'CURRENT_PROJECT_IDENTITY');
  requireThat(UUID.test(m.id ?? '') && m.projectId === p.id && s.activeModelVersionId === m.id && /^(?:0|[1-9][0-9]*)$/.test(s.selectionRevision ?? '') && SHA.test(m.contentFingerprint ?? '') && UUID.test(m.packageId ?? '') && m.supportProfile === 'svf-local-7.130.0-v1' && m.sdkVersion === '7.130.0' && m.entrypoint === 'resources/output/0/0.svf' && m.state === 'ready' && m.health === 'healthy', 'CURRENT_SELECTED_MODEL');
  requireThat(!contentFingerprint || m.contentFingerprint === contentFingerprint, 'CURRENT_CONTENT_BINDING');
  requireThat(Array.isArray(m.propertyResources) && m.propertyResources.length === 5, 'CURRENT_PROPERTY_RESOURCES');
  const resources = new Set(); for (const row of m.propertyResources) { requireThat(object(row) && string(row.path) && !resources.has(row.path) && integer(row.bytes, 1, LIMITS.compressedBytes) && SHA.test(row.sha256 ?? ''), 'CURRENT_PROPERTY_RESOURCE'); resources.add(row.path); }
  requireThat(value.cables.length <= LIMITS.cables, 'CURRENT_CABLE_BUDGET'); const ids = new Set(), numbers = new Set();
  for (const c of value.cables) {
    const missingType = c?.cableTypeId === null && c?.typeProjectId === null && c?.typeName === null;
    const joinedType = UUID.test(c?.cableTypeId ?? '') && c?.typeProjectId === p.id && string(c?.typeName);
    requireThat(object(c) && UUID.test(c.id ?? '') && c.projectId === p.id && !ids.has(c.id) && integer(c.cableId) && !numbers.has(c.cableId) && (missingType || joinedType) && ['tag', 'fromLocation', 'toLocation', 'mto', 'revision'].every(key => nullableText(c[key])) && string(c.updatedAt, 100) && Number.isFinite(Date.parse(c.updatedAt)), 'CURRENT_CABLE_SCHEMA');
    ids.add(c.id); numbers.add(c.cableId);
  }
  return value;
}

export function endpointKeys(snapshot, production) {
  const keys = new Map(), rawCategories = new Map(), rawTrimmedKeys = new Set(); let emptyUsages = 0, maxRawEndpointNameLength = 0, maxRawTrimmedEndpointNameLength = 0;
  const categoryCounts = { MV: 0, LV: 0, Control: 0, Instrumentation: 0, null: 0, unknown: 0 };
  for (const cable of snapshot.cables) {
    const rawKey = canonical(cable.mto); rawCategories.set(rawKey, { value: cable.mto, count: (rawCategories.get(rawKey)?.count ?? 0) + 1 });
    const category = cable.mto === null ? 'null' : Object.hasOwn(categoryCounts, cable.mto) && cable.mto !== 'unknown' && cable.mto !== 'null' ? cable.mto : 'unknown'; categoryCounts[category]++;
    for (const endpoint of ['from', 'to']) {
      const raw = cable[endpoint + 'Location'], key = raw === null ? '' : production.normalizeLocation(raw), rawTrimmed = raw?.trim() ?? ''; maxRawEndpointNameLength = Math.max(maxRawEndpointNameLength, raw?.length ?? 0);
      if (rawTrimmed) { rawTrimmedKeys.add(rawTrimmed); maxRawTrimmedEndpointNameLength = Math.max(maxRawTrimmedEndpointNameLength, rawTrimmed.length); }
      if (!key) { emptyUsages++; continue; }
      let row = keys.get(key); if (!row) { row = { normalizedKey: key, uses: [], candidates: new Map(), mappingOnlyCandidates: new Map() }; keys.set(key, row); }
      row.uses.push({ cableId: cable.id, endpoint, rawValue: raw });
    }
  }
  requireThat(keys.size <= LIMITS.keys, 'CURRENT_ENDPOINT_KEY_BUDGET');
  return { keys, emptyUsages, rawTrimmedDistinctEndpointCount: rawTrimmedKeys.size, maxRawEndpointNameLength, maxRawTrimmedEndpointNameLength, categoryCounts, rawCategories: [...rawCategories.values()], effectiveCategoryCounts: { MV: categoryCounts.MV, LV: categoryCounts.LV, Control: categoryCounts.Control + categoryCounts.Instrumentation, requiresResolution: categoryCounts.null + categoryCounts.unknown } };
}

/** JSON v1 PDB semantics from pinned SDK 7.130.0 worker, not general PDB support.
 * GB(offsets,1) adds a terminal slot; constructor fills it with avs.length/2.
 * getObjectProperties recursively reads the LAST instance source, hides inherited
 * hidden properties, and shadows by exact displayName (before NFC matching).
 */
export function propertyDecoder({ attrs, offs, avs, vals, ids }, budget = makeBudget()) {
  requireThat(Array.isArray(attrs) && attrs[0] === 0 && attrs.length <= 65536 && Array.isArray(offs) && Array.isArray(avs) && Array.isArray(vals) && Array.isArray(ids), 'PDB_JSON_V1_REQUIRED');
  requireThat(offs.length === ids.length && integer(ids.length, 2, LIMITS.objects + 1) && ids[0] === 0 && avs.length % 2 === 0 && avs.length / 2 <= LIMITS.properties && offs[0] === 0, 'PDB_ARRAY_COUNTS');
  const offsets = [...offs, avs.length / 2], definitions = new Map(); let instanceId, nameId;
  for (let i = 1; i < attrs.length; i++) {
    const a = attrs[i]; requireThat(Array.isArray(a) && a.length >= 7 && string(a[0]) && string(a[1]) && integer(a[2]) && (a[5] === null || string(a[5])) && integer(a[6]), 'PDB_ATTRIBUTE_SCHEMA');
    if (a[1] === '__instanceof__') { requireThat(instanceId === undefined, 'PDB_DUPLICATE_INSTANCE_ATTRIBUTE'); instanceId = i; }
    if (a[1] === '__name__') { requireThat(nameId === undefined, 'PDB_DUPLICATE_NAME_ATTRIBUTE'); nameId = i; }
    definitions.set(i, { name: a[5] || a[0], category: a[1], type: a[2], flags: a[6], hidden: Boolean(a[6] & 1) || ['__parent__', '__child__', '__viewable_in__', '__externalref__'].includes(a[1]) });
  }
  const external = new Set();
  for (let i = 0; i < offsets.length; i++) { budget(); requireThat(integer(offsets[i], 0, avs.length / 2) && (i === 0 || offsets[i] >= offsets[i - 1]), 'PDB_OFFSET_RANGE'); }
  for (let i = 1; i < ids.length; i++) { budget(); requireThat(string(ids[i], 2048) && ids[i].length && !external.has(ids[i]), 'PDB_EXTERNAL_ID'); external.add(ids[i]); }
  for (const value of vals) { budget(); requireThat(typeof value === 'string' && value.length <= 1024 * 1024 || typeof value === 'number' && Number.isFinite(value), 'PDB_VALUE_SCHEMA'); }
  const valueAt = (attributeId, valueId) => { const d = definitions.get(attributeId); requireThat(d && integer(valueId) && ((d.flags & 4) && d.type === 11 || valueId < vals.length), 'PDB_AV_REFERENCE'); return (d.flags & 4) && d.type === 11 ? valueId : vals[valueId]; };
  for (let i = 0; i < avs.length; i += 2) { budget(); requireThat(integer(avs[i], 1, attrs.length - 1), 'PDB_ATTRIBUTE_REFERENCE'); valueAt(avs[i], avs[i + 1]); }
  const cache = new Map(), visiting = new Set(), names = new Map(); let inheritanceObjects = 0;
  function properties(dbId, ignoreHidden = false, depth = 0) {
    budget(); requireThat(integer(dbId, 1, ids.length - 1), 'PDB_OBJECT_REFERENCE'); requireThat(depth < LIMITS.depth, 'PDB_INSTANCE_DEPTH');
    if (ignoreHidden && cache.has(dbId)) return cache.get(dbId);
    requireThat(!visiting.has(dbId), 'PDB_INSTANCE_CYCLE'); visiting.add(dbId);
    try {
      const local = []; let prototype, prototypeId, ownName;
      for (let at = offsets[dbId] * 2; at < offsets[dbId + 1] * 2; at += 2) {
        budget(); const attributeId = avs[at], d = definitions.get(attributeId), value = valueAt(attributeId, avs[at + 1]);
        if (attributeId === instanceId) { requireThat(integer(value, 1, ids.length - 1), 'PDB_INSTANCE_REFERENCE'); prototypeId = value; prototype = properties(value, true, depth + 1); }
        else if (attributeId === nameId) ownName = value;
        else if (!ignoreHidden || !d.hidden) local.push({ category: d.category, name: d.name, value: String(value), attributeId, originDbId: dbId });
      }
      if (prototype) { inheritanceObjects++; const ownNames = new Set(local.map(p => p.name)); for (const p of prototype) { budget(); if (!ownNames.has(p.name)) local.push(p); requireThat(local.length <= 100000, 'PDB_OBJECT_PROPERTY_BUDGET'); } }
      requireThat(local.length <= 100000, 'PDB_OBJECT_PROPERTY_BUDGET');
      names.set(dbId, ownName || names.get(prototypeId) || ''); if (ignoreHidden) cache.set(dbId, local); return local;
    } finally { visiting.delete(dbId); }
  }
  return { properties, pdbName: dbId => { if (!names.has(dbId)) properties(dbId); return String(names.get(dbId) ?? ''); }, externalId: dbId => ids[dbId], mappedObjectCount: ids.length - 1, definitions: [...definitions].map(([id, d]) => ({ attributeId: id, ...d })), stats: () => ({ prototypeObjectsCached: cache.size, inheritedReads: inheritanceObjects }) };
}

/** Candidate identity only; never a confirmed registry or geometric endpoint. */
export function addObjectCandidates(index, object, production, budget = makeBudget(), { treeReachable = true } = {}) {
  const names = production.objectMatchNames(object);
  for (const name of names) {
    budget(); const row = index.keys.get(name); if (!row) continue;
    const target = treeReachable ? row.candidates : row.mappingOnlyCandidates;
    if (!target.has(object.dbId)) { index.associations = (index.associations ?? 0) + 1; requireThat(index.associations <= LIMITS.associations, 'CANDIDATE_ASSOCIATION_BUDGET'); }
    target.set(object.dbId, { dbId: object.dbId, externalId: object.externalId, ...(treeReachable ? { treeName: object.name } : { propertyDbName: object.name }), treeReachable,
      matchingProperties: object.properties.filter(p => production.objectMatchNames({ name: '', properties: [p] }).includes(name)).map(p => ({ category: p.category, name: p.name, value: p.value, attributeId: p.attributeId, originDbId: p.originDbId })),
      treeNameMatches: production.normalizeLocation(object.name) === name });
  }
}

export function summarizeCandidates(snapshot, index) {
  const distinctKeys = { missing: 0, unique: 0, ambiguous: 0 }, usages = { missing: index.emptyUsages, unique: 0, ambiguous: 0 };
  let reusedKeys = 0, reusedUsages = 0, associations = 0, mappingOnlyMatchedKeys = 0, mappingOnlyAssociations = 0; const privateKeys = [];
  for (const row of index.keys.values()) {
    const status = row.candidates.size === 0 ? 'missing' : row.candidates.size === 1 ? 'unique' : 'ambiguous'; distinctKeys[status]++; usages[status] += row.uses.length; associations += row.candidates.size;
    if (row.uses.length > 1) { reusedKeys++; reusedUsages += row.uses.length; }
    if (row.mappingOnlyCandidates.size) { mappingOnlyMatchedKeys++; mappingOnlyAssociations += row.mappingOnlyCandidates.size; }
    privateKeys.push({ normalizedKey: row.normalizedKey, status, uses: row.uses, candidates: [...row.candidates.values()].sort((a, b) => a.dbId - b.dbId), mappingOnlyCandidates: [...row.mappingOnlyCandidates.values()].sort((a, b) => a.dbId - b.dbId), mappingOnlyReviewRequired: Boolean(row.mappingOnlyCandidates.size), confirmedBinding: false, geometryEligibility: 'NOT_ESTABLISHED', nativeVisibility: 'UNKNOWN', categoryEligibility: 'NOT_ESTABLISHED' });
  }
  requireThat(associations <= LIMITS.associations, 'CANDIDATE_ASSOCIATION_BUDGET');
  return { publicSummary: { cables: snapshot.cables.length, endpointUsages: snapshot.cables.length * 2, emptyUsages: index.emptyUsages, nonemptyUsages: snapshot.cables.length * 2 - index.emptyUsages, distinctNonemptyKeys: index.keys.size, distinctKeys, usages, reusedKeys, reusedUsages, candidateAssociations: associations, mappingOnlyMatchedKeys, mappingOnlyAssociations,
    candidateCountScope: 'Reachable tree metadata candidates only; mapping-only candidates are separately retained and require review.',
    rawTrimmedDistinctEndpointCount: index.rawTrimmedDistinctEndpointCount, maxRawEndpointNameLength: index.maxRawEndpointNameLength, maxRawTrimmedEndpointNameLength: index.maxRawTrimmedEndpointNameLength,
    existingRequestedCaptureLimits: { equipmentNames: 256, charactersPerRawName: 256, normalizedDistinctKeysExceedNamesLimit: index.keys.size > 256, rawTrimmedDistinctExceeds256: index.rawTrimmedDistinctEndpointCount > 256, maxRawNameExceedsCharactersLimit: index.maxRawEndpointNameLength > 256, maxRawTrimmedNameExceedsCharactersLimit: index.maxRawTrimmedEndpointNameLength > 256,
      allCableEndpointNamesFitCurrentUiNameAndLengthLimits: index.rawTrimmedDistinctEndpointCount <= 256 && index.maxRawTrimmedEndpointNameLength <= 256,
      scope: 'All copied cable endpoints only: Routes counts a case-sensitive raw trimmed Set and checks lengths before capture NFC dedup. Excludes standalone drafts, selected-cable narrowing, route-rule and geometry gates; not a product capture PASS.' },
    rawMtoCategories: index.categoryCounts, rawMtoDistinctValues: index.rawCategories.length, effectiveCategories: index.effectiveCategoryCounts,
    categorySource: 'Exact raw cable.mto only; Instrumentation uses Control. Unknown/null requires resolution; typeName is never a category source.' },
    privateResult: { schemaVersion: 'pathfinder.current-inputs.candidates.private.v1', projectId: snapshot.project.id, modelVersionId: snapshot.model.id, contentFingerprint: snapshot.model.contentFingerprint,
      keys: privateKeys, emptyEndpoints: snapshot.cables.flatMap(c => ['from', 'to'].filter(side => !c[side + 'Location']?.trim()).map(side => ({ cableId: c.id, endpoint: side, rawValue: c[side + 'Location'] }))), rawMto: index.rawCategories } };
}

export function validateSourceReceipt(receipt, input) {
  requireThat(object(receipt) && receipt.schemaVersion === 'pathfinder.current-inputs.source-receipt.v1' && receipt.status === 'PASS' && receipt.preservation?.status === 'PASS' && receipt.checkedModelFingerprint === input.contentFingerprint && receipt.privateSnapshot?.path === input.path && receipt.privateSnapshot?.bytes === input.bytes && receipt.privateSnapshot?.sha256 === input.sha256, 'SOURCE_RECEIPT_BINDING');
  return receipt;
}
export function packageIdentityObservation(model, retainedPackage) {
  requireThat(UUID.test(model.packageId ?? '') && UUID.test(retainedPackage.packageId ?? '') && model.contentFingerprint === retainedPackage.contentFingerprint, 'CANDIDATE_INVENTORY_CONTENT_BINDING');
  return { sourcePackageId: model.packageId, retainedPackageId: retainedPackage.packageId, packageIdsEqual: model.packageId === retainedPackage.packageId,
    authority: 'Exact converted content fingerprint plus five resource path/bytes/SHA pins; portable package UUID equality is diagnostic only.' };
}
export const digest = value => sha256(canonical(value));
