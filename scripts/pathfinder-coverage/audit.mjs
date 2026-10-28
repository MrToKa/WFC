import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { parseOutput, canonical, sha256, SHA, UUID } from '../pathfinder-capacity/lib.mjs';
import { retainedManifest } from './retained.mjs';

export const LIMITS = Object.freeze({ parts: 512, partBytes: 2 * 1024 ** 2, totalPartBytes: 512 * 1024 ** 2,
  objects: 1_000_000, fragments: 5_000_000, depth: 512, metadataRows: 10_000, snapshotObjects: 4096,
  snapshotBytes: 64 * 1024 ** 2, outputBytes: 2 * 1024 ** 2, elapsedMilliseconds: 120_000, rssBytes: 1536 * 1024 ** 2 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const text = (value, max = 8192) => typeof value === 'string' && value.length <= max;
const point = value => Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9);
const matrix = value => Array.isArray(value) && value.length === 16 && value.every(v => typeof v === 'number' && Number.isFinite(v)) && value[3] === 0 && value[7] === 0 && value[11] === 0 && value[15] === 1;
const exact = (value, keys) => object(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const digest = value => sha256(canonical(value));
const equal = (a, b) => canonical(a) === canonical(b);
const idNumber = value => typeof value === 'string' && /^dbid:(?:0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value.slice(5))) ? Number(value.slice(5)) : null;
const requireThat = (condition, code, detail = {}) => { if (!condition) throw Object.assign(new Error(code), { code, detail }); };
const count = (target, key, amount = 1) => { target[key] = (target[key] ?? 0) + amount; };
const boundedSamples = values => [...values].slice(0, 16);

/** Relative paths are intentionally strict; all existing ancestors are checked for links. */
export async function safePath(root, relative, { output = false } = {}) {
  requireThat(path.isAbsolute(root), 'ABSOLUTE_ROOT_REQUIRED');
  requireThat(text(relative, 1024) && relative.length > 0 && !path.isAbsolute(relative) && !relative.includes('\\') && relative.split('/').every(v => v && v !== '.' && v !== '..' && !v.includes(':')), 'UNSAFE_PATH', { relative });
  const resolvedRoot = path.resolve(root), resolved = path.resolve(resolvedRoot, relative);
  requireThat(resolved.startsWith(resolvedRoot + path.sep), 'PATH_ESCAPE');
  let current = path.parse(resolvedRoot).root;
  for (const element of resolved.slice(current.length).split(path.sep)) {
    current = path.join(current, element);
    try {
      const stat = await fs.lstat(current);
      requireThat(!stat.isSymbolicLink(), 'LINK_FORBIDDEN', { path: current });
      requireThat(current === resolved ? (output ? false : stat.isFile()) : stat.isDirectory(), output && current === resolved ? 'OUTPUT_EXISTS' : 'PATH_TYPE', { path: current });
    } catch (error) {
      if (error.code === 'ENOENT' && output && current === resolved) return resolved;
      throw error;
    }
  }
  return resolved;
}

function validateManifest(manifest) {
  requireThat(exact(manifest, ['schemaVersion', 'label', 'inventory', 'snapshot', 'metadata', 'productionMatching']) && manifest.schemaVersion === 'pathfinder.coverage.input.v1' && text(manifest.label, 160) && manifest.label.trim(), 'MANIFEST_SCHEMA');
  for (const key of ['inventory', 'metadata']) requireThat(exact(manifest[key], ['path', 'sha256']) && SHA.test(manifest[key].sha256 ?? ''), 'MANIFEST_INPUT', { input: key });
  requireThat(exact(manifest.snapshot, ['path', 'sha256', 'artifactId', 'projectId', 'modelVersionId', 'contentSha256']) && SHA.test(manifest.snapshot.sha256 ?? '') && SHA.test(manifest.snapshot.contentSha256 ?? '') && ['artifactId', 'projectId', 'modelVersionId'].every(key => UUID.test(manifest.snapshot[key] ?? '')), 'MANIFEST_SNAPSHOT');
  const p = manifest.productionMatching;
  requireThat(exact(p, ['path', 'sha256', 'errorsPath', 'errorsSha256']) && SHA.test(p.sha256 ?? '') && SHA.test(p.errorsSha256 ?? ''), 'MANIFEST_MATCHING');
  // Code is executable: a custom manifest may relocate only the exact reviewed production bytes.
  requireThat(p.sha256 === retainedManifest.productionMatching.sha256 && p.errorsSha256 === retainedManifest.productionMatching.errorsSha256, 'UNAPPROVED_MATCHING_CODE');
  requireThat(path.posix.basename(p.path) === 'matching.js' && path.posix.basename(p.errorsPath) === 'errors.js' && path.posix.dirname(p.path) === path.posix.dirname(p.errorsPath), 'MATCHING_DEPENDENCY_PATH');
  return manifest;
}

async function checkedBytes(root, input, maximum, trace) {
  const filename = await safePath(root, input.path), stat = await fs.stat(filename);
  requireThat(stat.size > 0 && stat.size <= maximum, 'INPUT_SIZE', { path: input.path, actualBytes: stat.size, maximumBytes: maximum });
  const bytes = await fs.readFile(filename), actual = sha256(bytes);
  requireThat(bytes.length === stat.size && actual === input.sha256, 'INPUT_HASH', { path: input.path, expectedSha256: input.sha256, actualSha256: actual, bytes: bytes.length });
  trace.push({ path: input.path, bytes: bytes.length, sha256: actual });
  return bytes;
}

async function matchingModule(root, input, trace) {
  const bytes = await checkedBytes(root, input, 128 * 1024, trace);
  await checkedBytes(root, { path: input.errorsPath, sha256: input.errorsSha256 }, 64 * 1024, trace);
  requireThat([...bytes.toString().matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"];?$/gm)].map(x => x[1]).join() === './errors.js', 'MATCHING_IMPORTS');
  const module = await import(pathToFileURL(await safePath(root, input.path)).href);
  requireThat(equal(Object.keys(module).sort(), ['matchLocation', 'normalizeLocation', 'objectMatchNames', 'validateSnapshotStructure']), 'MATCHING_EXPORTS');
  return module;
}

function checkBudget(start) {
  requireThat(performance.now() - start <= LIMITS.elapsedMilliseconds, 'AUDIT_DEADLINE');
  requireThat(process.memoryUsage().rss <= LIMITS.rssBytes, 'AUDIT_MEMORY_LIMIT', { rssBytes: process.memoryUsage().rss, maximumBytes: LIMITS.rssBytes });
}

function validateInventoryReceipt(value) {
  requireThat(object(value) && value.schemaVersion === 'pathfinder.converted.inventory.v1' && text(value.captureId, 128) && value.captureId.length > 0, 'INVENTORY_SCHEMA');
  requireThat(integer(value.objectCount, 1, LIMITS.objects) && integer(value.sdkFragmentCount, 0, LIMITS.fragments) && integer(value.fragmentAssociations, 0, LIMITS.fragments) && integer(value.externalIdentityObjectCount, 0, LIMITS.objects + 1), 'INVENTORY_COUNTS');
  requireThat(Array.isArray(value.parts) && integer(value.parts.length, 1, LIMITS.parts) && value.inventoryComplete === true && value.geometryComplete === false && value.propertiesComplete === false, 'INVENTORY_COMPLETENESS');
  requireThat(SHA.test(value.package?.contentFingerprint ?? '') && SHA.test(value.package?.packageSha256 ?? '') && UUID.test(value.package?.packageId ?? '') && SHA.test(value.package?.source?.sha256 ?? ''), 'INVENTORY_IDENTITY');
  const names = new Set(); let bytes = 0;
  for (let i = 0; i < value.parts.length; i++) {
    const part = value.parts[i];
    requireThat(exact(part, ['name', 'bytes', 'sha256']) && part.name === `${value.captureId}-${String(i).padStart(4, '0')}.json` && !names.has(part.name) && integer(part.bytes, 1, LIMITS.partBytes) && SHA.test(part.sha256 ?? ''), 'PART_DECLARATION', { partIndex: i });
    names.add(part.name); bytes += part.bytes;
  }
  requireThat(bytes <= LIMITS.totalPartBytes, 'INVENTORY_TOTAL_SIZE', { bytes });
}

/** Keeps hierarchy/name/identity indexes only. Each raw part is released before the next. */
async function inventoryIndex(root, receipt, input, trace, result, start, normalizer) {
  const objects = new Map(), names = new Map(), external = new Map(), fragmentOwners = new Int32Array(receipt.sdkFragmentCount).fill(-1);
  const allIdsHash = createHash('sha256'); let bytes = 0, associations = 0, withFragments = 0, withExternalIds = 0, minimumDbId = Infinity, maximumDbId = -Infinity;
  const flags = { nativeHidden: {}, displayHidden: {}, displayOff: {}, planningVisibilityEvidence: {} };
  const directory = path.posix.dirname(input.path);
  const actualPartNames = (await fs.readdir(path.dirname(await safePath(root, input.path)))).filter(name => name.startsWith(receipt.captureId + '-') && name.endsWith('.json') && name !== `${receipt.captureId}-receipt.json`).sort();
  requireThat(equal(actualPartNames, receipt.parts.map(part => part.name).sort()), 'PART_FILE_SET', { declaredParts: receipt.parts.length, actualParts: actualPartNames.length, unexpected: boundedSamples(actualPartNames.filter(name => !receipt.parts.some(part => part.name === name))) });
  for (let i = 0; i < receipt.parts.length; i++) {
    checkBudget(start); const declared = receipt.parts[i], relative = `${directory}/${declared.name}`;
    result.currentInput = relative;
    const raw = await checkedBytes(root, { path: relative, sha256: declared.sha256 }, LIMITS.partBytes, trace), part = parseOutput(raw, LIMITS.partBytes);
    requireThat(raw.length === declared.bytes, 'PART_BYTE_COUNT', { partIndex: i, expected: declared.bytes, actual: raw.length }); bytes += raw.length;
    requireThat(exact(part, ['schemaVersion', 'captureId', 'offset', 'objects']) && part.schemaVersion === 'pathfinder.converted.inventory-part.v1' && part.captureId === receipt.captureId && part.offset === objects.size && Array.isArray(part.objects) && part.objects.length > 0 && part.objects.length <= 2048 && (i === receipt.parts.length - 1 || part.objects.length === 2048), 'PART_OFFSET_OR_SCHEMA', { partIndex: i, expectedOffset: objects.size, actualOffset: part.offset });
    for (const item of part.objects) {
      const dbId = item.dbId, parent = item.parentId === null ? null : idNumber(item.parentId);
      requireThat(exact(item, ['id', 'dbId', 'parentId', 'name', 'childCount', 'externalIds', 'fragmentIds', 'nativeHidden', 'planningVisibilityEvidence', 'displayHidden', 'displayOff']) && integer(dbId, 0, 2147483647) && item.id === `dbid:${dbId}` && (item.parentId === null || parent !== null) && text(item.name) && integer(item.childCount, 0, receipt.objectCount), 'OBJECT_SCHEMA', { partIndex: i, dbId });
      requireThat(!objects.has(dbId), 'DUPLICATE_OBJECT_ID', { partIndex: i, dbId });
      requireThat(Array.isArray(item.externalIds) && item.externalIds.length <= 256 && item.externalIds.every(v => text(v, 2048) && v.length > 0) && new Set(item.externalIds).size === item.externalIds.length && Array.isArray(item.fragmentIds) && item.fragmentIds.length <= LIMITS.fragments, 'OBJECT_ASSOCIATIONS', { dbId });
      requireThat((item.nativeHidden === null || typeof item.nativeHidden === 'boolean') && (item.planningVisibilityEvidence === null || text(item.planningVisibilityEvidence, 256)) && typeof item.displayHidden === 'boolean' && typeof item.displayOff === 'boolean', 'VISIBILITY_SCHEMA', { dbId });
      const record = { dbId, parent, name: item.name, childCount: item.childCount, externalIds: item.externalIds, fragments: item.fragmentIds, actualChildren: 0, depth: 0, descendants: 0, geometryOwners: item.fragmentIds.length ? 1 : 0, descendantFragments: item.fragmentIds.length };
      objects.set(dbId, record); minimumDbId = Math.min(minimumDbId, dbId); maximumDbId = Math.max(maximumDbId, dbId);
      if (item.fragmentIds.length) withFragments++; if (item.externalIds.length) withExternalIds++;
      const normalizedName = normalizer(item.name); if (normalizedName) { const entry = names.get(normalizedName); if (entry) { entry.count++; if (entry.ids.length < 16) entry.ids.push(dbId); } else names.set(normalizedName, { count: 1, ids: [dbId] }); }
      for (const externalId of item.externalIds) { const owner = external.get(externalId); if (owner) { owner.count++; if (owner.ids.length < 16) owner.ids.push(dbId); } else external.set(externalId, { count: 1, ids: [dbId] }); }
      for (const fragment of item.fragmentIds) {
        requireThat(integer(fragment, 0, receipt.sdkFragmentCount - 1), 'FRAGMENT_RANGE', { dbId, fragment, sdkFragmentCount: receipt.sdkFragmentCount });
        requireThat(fragmentOwners[fragment] === -1, 'DUPLICATE_FRAGMENT', { dbId, fragment, previousDbId: fragmentOwners[fragment] });
        fragmentOwners[fragment] = dbId; associations++; requireThat(associations <= LIMITS.fragments, 'FRAGMENT_BUDGET');
      }
      for (const key of Object.keys(flags)) count(flags[key], String(item[key]));
    }
    result.progress = { partsChecked: i + 1, objectsIndexed: objects.size, bytesChecked: bytes, fragmentAssociationsChecked: associations };
  }
  requireThat(objects.size === receipt.objectCount && associations === receipt.fragmentAssociations, 'INVENTORY_COUNT_MISMATCH', { objects: objects.size, declaredObjects: receipt.objectCount, associations, declaredAssociations: receipt.fragmentAssociations });
  const ordered = [...objects.keys()].sort((a, b) => a - b), missingDbIdExamples = []; let missingDbIds = 0;
  // Report gaps within the declared mapping range separately from the observed min/max.
  const mappingLimit = receipt.externalIdentityObjectCount;
  let previous = 0;
  for (const id of [...ordered.filter(v => v > 0), Math.max(mappingLimit, maximumDbId) + 1]) {
    const gap = id - previous - 1; if (gap > 0) { missingDbIds += gap; for (let next = previous + 1; next < id && missingDbIdExamples.length < 16; next++) missingDbIdExamples.push(next); }
    previous = id;
  }
  for (const id of ordered) allIdsHash.update(`${id}\n`);
  const duplicateNames = [...names].filter(([, v]) => v.count > 1), duplicateExternalIds = [...external].filter(([, v]) => v.count > 1);
  result.inventory = { status: 'PASS', partsChecked: receipt.parts.length, bytesChecked: bytes, objects: objects.size, fragments: receipt.sdkFragmentCount, fragmentAssociations: associations, objectsWithFragments: withFragments, objectsWithExternalIds: withExternalIds,
    fragmentIdsUnassociated: [...fragmentOwners].filter(v => v === -1).length, minimumDbId, maximumDbId, sortedDbIdsSha256: allIdsHash.digest('hex'),
    missingDbIdsWithinOneToMaxDeclaredMappingOrObserved: missingDbIds, missingDbIdExamples, mappingRangeDeclarationOnly: true,
    externalIdentityObjectCountDeclaration: mappingLimit, declarationDifference: mappingLimit - objects.size,
    identityDeclarationReconciliation: { status: 'BLOCKED', reason: 'Receipt declares property-database mapping count; retained inventory alone does not identify the mapping-only object.' },
    names: { normalizedDistinct: names.size, duplicateGroups: duplicateNames.length, duplicateObjectOccurrences: duplicateNames.reduce((s, [, v]) => s + v.count, 0), examples: duplicateNames.slice(0, 16).map(([name, value]) => ({ normalizedNameSha256: sha256(name), ...value })) },
    externalIds: { distinct: external.size, duplicateGroups: duplicateExternalIds.length, examples: duplicateExternalIds.slice(0, 16).map(([identity, value]) => ({ identitySha256: sha256(identity), ...value })) }, visibility: flags };
  return { objects, names, fragmentOwners };
}

export function hierarchyAudit(objects, start = performance.now()) {
  const roots = [];
  let iterations = 0;
  for (const item of objects.values()) {
    if (++iterations % 2048 === 0) checkBudget(start);
    if (item.parent === null) roots.push(item); else { const parent = objects.get(item.parent); requireThat(parent, 'ORPHAN_OBJECT', { dbId: item.dbId, parentDbId: item.parent }); parent.actualChildren++; }
  }
  requireThat(roots.length > 0, 'ROOT_MISSING'); let maximumDepth = 0;
  for (const item of objects.values()) {
    if (++iterations % 2048 === 0) checkBudget(start);
    const chain = [], seen = new Set(); let current = item;
    while (current && !current.depth) { requireThat(!seen.has(current.dbId), 'HIERARCHY_CYCLE', { dbId: item.dbId, cycleAt: current.dbId }); requireThat(chain.length < LIMITS.depth, 'HIERARCHY_DEPTH', { dbId: item.dbId }); seen.add(current.dbId); chain.push(current); current = current.parent === null ? null : objects.get(current.parent); }
    let depth = current?.depth ?? 0;
    for (let i = chain.length - 1; i >= 0; i--) { chain[i].depth = ++depth; requireThat(depth <= LIMITS.depth, 'HIERARCHY_DEPTH', { dbId: chain[i].dbId }); maximumDepth = Math.max(maximumDepth, depth); }
    requireThat(item.actualChildren === item.childCount, 'CHILD_COUNT_MISMATCH', { dbId: item.dbId, declared: item.childCount, actual: item.actualChildren });
  }
  for (const item of [...objects.values()].sort((a, b) => b.depth - a.depth)) if (item.parent !== null) { const parent = objects.get(item.parent); parent.descendants += item.descendants + 1; parent.geometryOwners += item.geometryOwners; parent.descendantFragments += item.descendantFragments; }
  const summary = item => ({ id: `dbid:${item.dbId}`, name: item.name, children: item.actualChildren, descendants: item.descendants, objectsWithFragmentsIncludingSelf: item.geometryOwners, fragmentsIncludingSelf: item.descendantFragments });
  const rootIds = new Set(roots.map(root => root.dbId)), rootChildren = [...objects.values()].filter(item => rootIds.has(item.parent));
  return { status: 'PASS', rootCount: roots.length, roots: roots.slice(0, 128).map(summary), rootIdsSha256: digest(roots.map(root => root.dbId).sort((a, b) => a - b)), rootsTruncated: roots.length > 128, maximumDepth, topLevelGroups: rootChildren.length, topLevelGroupSummary: rootChildren.slice(0, 128).map(summary), topLevelGroupsTruncated: rootChildren.length > 128, terminalObjects: [...objects.values()].filter(item => item.actualChildren === 0).length };
}

function transformAudit(receipt, snapshot) {
  const metadata = receipt.metadata, coordinates = snapshot.coordinates;
  requireThat(object(metadata) && object(coordinates) && metadata.distanceUnit === 'm' && metadata.metresPerDisplayUnit === 1 && equal(metadata.upVector, [0, 0, 1]) && point(metadata.globalOffsetMetres) && matrix(metadata.displayToWorldMetres), 'INVENTORY_COORDINATES');
  requireThat(coordinates.vertexFrame === 'canonical-world-metres' && coordinates.sourceUnits === 'm' && coordinates.metresPerSourceUnit === 1 && matrix(coordinates.sourceToWorldMetres) && matrix(coordinates.displayToWorldMetres) && point(coordinates.globalOffsetMetres), 'SNAPSHOT_COORDINATES');
  requireThat(equal(coordinates.globalOffsetMetres, metadata.globalOffsetMetres) && equal(coordinates.displayToWorldMetres, metadata.displayToWorldMetres), 'TRANSFORM_INCONSISTENCY');
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  requireThat(equal(coordinates.sourceToWorldMetres, identity) && equal(metadata.sourceToWorldMetres, identity) && equal(metadata.placementTransform, identity) && (metadata.modelTransform === null || equal(metadata.modelTransform, identity)), 'SOURCE_PLACEMENT_INCONSISTENCY');
  requireThat(equal(metadata.displayToWorldMetres, [...identity.slice(0, 12), ...metadata.globalOffsetMetres, 1]), 'DISPLAY_OFFSET_INCONSISTENCY');
  return { status: 'PASS', scope: 'Internal retained declarations only; vertices are read without applying any transform.', vertexFrame: coordinates.vertexFrame, sourceUnits: coordinates.sourceUnits, metresPerSourceUnit: coordinates.metresPerSourceUnit, globalOffsetMetres: coordinates.globalOffsetMetres, sourceToWorldMetres: coordinates.sourceToWorldMetres, displayToWorldMetres: coordinates.displayToWorldMetres, nativeTransformProof: 'NOT_PERFORMED_NOT_REQUIRED_BY_USER', sourceLinkVerified: snapshot.capture.sourceLinkVerified, unitsVerified: snapshot.capture.unitsVerified, transformsVerified: snapshot.capture.transformsVerified };
}

function snapshotAudit(snapshot, expected, receipt, index, production) {
  requireThat(snapshot.schemaVersion === 'pathfinder.model.snapshot.v1' && object(snapshot.model) && snapshot.model.projectId === expected.projectId && snapshot.model.modelVersionId === expected.modelVersionId && snapshot.model.contentSha256 === expected.contentSha256 && receipt.package.contentFingerprint === expected.contentSha256, 'SNAPSHOT_IDENTITY');
  requireThat(Array.isArray(snapshot.objects) && integer(snapshot.objects.length, 1, LIMITS.snapshotObjects) && object(snapshot.capture) && snapshot.capture.sourceKind === 'converted', 'SNAPSHOT_SCHEMA_OR_LIMIT');
  requireThat(['inventoryComplete', 'geometryComplete', 'unitsVerified', 'transformsVerified', 'planningVisibilityKnown', 'sourceLinkVerified'].every(key => typeof snapshot.capture[key] === 'boolean') && !('lookupRouteCodes' in snapshot.capture), 'SNAPSHOT_CAPTURE_PURPOSE');
  const selected = new Map(), roles = {}, categorySources = {}, categorySets = {}, exclusions = {}, boundaryIds = new Set(); let fragments = 0, vertices = 0, triangles = 0;
  for (const item of snapshot.objects) {
    requireThat(object(item) && idNumber(item.id) === item.dbId && (item.parentId === null || idNumber(item.parentId) !== null) && text(item.name) && ['hierarchy', 'routing-leaf', 'object'].includes(item.geometryRole) && Array.isArray(item.leafToRootNames) && item.leafToRootNames.every(v => text(v)) && Array.isArray(item.fragments) && Array.isArray(item.properties) && Array.isArray(item.allowedCategories) && item.allowedCategories.every(v => ['MV', 'LV', 'Control'].includes(v)) && typeof item.planningExcluded === 'boolean' && [null, true, false].includes(item.nativeHidden), 'SNAPSHOT_OBJECT_SCHEMA', { id: item.id });
    requireThat(!selected.has(item.id), 'DUPLICATE_SELECTED_OBJECT', { id: item.id }); selected.set(item.id, item);
    requireThat(['unassigned', 'explicit-planning', 'native-reference-selection', 'synthetic'].includes(item.categoryAssignmentSource) && (item.categoryAssignmentSource !== 'unassigned' || item.allowedCategories.length === 0), 'SNAPSHOT_CATEGORY_EVIDENCE', { id: item.id });
    const retained = index.objects.get(item.dbId);
    requireThat(retained && retained.parent === (item.parentId === null ? null : idNumber(item.parentId)) && retained.name === item.name, 'SELECTED_IDENTITY_JOIN', { id: item.id });
    requireThat(typeof item.externalId === 'string' && retained.externalIds.includes(item.externalId), 'SELECTED_EXTERNAL_JOIN', { id: item.id });
    for (const property of item.properties) requireThat(object(property) && text(property.name) && text(property.value, 65536), 'SNAPSHOT_PROPERTY_SCHEMA', { id: item.id });
    requireThat(object(item.bounds) && point(item.bounds.minimum) && point(item.bounds.maximum) && item.bounds.minimum.every((v, axis) => v <= item.bounds.maximum[axis]), 'SNAPSHOT_BOUNDS', { id: item.id });
    const actualChain = []; let current = retained;
    while (current) { actualChain.push(current.name); current = current.parent === null ? null : index.objects.get(current.parent); }
    requireThat(equal(actualChain, item.leafToRootNames), 'SELECTED_ANCESTOR_NAMES', { id: item.id, inventoryDepth: actualChain.length, selectedDepth: item.leafToRootNames.length });
    if (item.routeBoundaryId !== undefined) { const boundary = idNumber(item.routeBoundaryId); requireThat(item.geometryRole === 'routing-leaf' && boundary !== null && !('routeName' in item) && !('shapeName' in item), 'ROUTE_BOUNDARY_SCHEMA', { id: item.id }); let ancestor = retained, found = false; while (ancestor) { if (ancestor.dbId === boundary) found = true; ancestor = ancestor.parent === null ? null : index.objects.get(ancestor.parent); } requireThat(found, 'ROUTE_BOUNDARY_NOT_ANCESTOR', { id: item.id, routeBoundaryId: item.routeBoundaryId }); boundaryIds.add(boundary); }
    for (const fragment of item.fragments) {
      const fid = typeof fragment.id === 'string' && /^fragment:(?:0|[1-9][0-9]*)$/.test(fragment.id) ? Number(fragment.id.slice(9)) : null;
      requireThat(fid !== null && retained.fragments.includes(fid) && index.fragmentOwners[fid] === item.dbId, 'SELECTED_FRAGMENT_JOIN', { id: item.id, fragmentId: fragment.id });
      requireThat(Array.isArray(fragment.vertices) && fragment.vertices.length >= 3 && fragment.vertices.every(point) && Array.isArray(fragment.triangleIndices) && fragment.triangleIndices.length >= 3 && fragment.triangleIndices.length % 3 === 0 && fragment.triangleIndices.every(v => integer(v, 0, fragment.vertices.length - 1)), 'SNAPSHOT_MESH', { id: item.id, fragmentId: fragment.id });
      requireThat(fragment.transformAlreadyApplied === true && (fragment.fragmentToWorldMetres === null || matrix(fragment.fragmentToWorldMetres)), 'SNAPSHOT_FRAGMENT_TRANSFORM', { id: item.id, fragmentId: fragment.id });
      requireThat(fragment.vertices.every(vertex => vertex.every((coordinate, axis) => coordinate >= item.bounds.minimum[axis] - 1e-6 && coordinate <= item.bounds.maximum[axis] + 1e-6)), 'SNAPSHOT_VERTEX_OUTSIDE_BOUNDS', { id: item.id, fragmentId: fragment.id });
      fragments++; vertices += fragment.vertices.length; triangles += fragment.triangleIndices.length / 3;
      requireThat(fragments <= 100_000 && vertices <= 5_000_000 && triangles <= 5_000_000, 'SNAPSHOT_MESH_BUDGET');
    }
    count(roles, item.geometryRole); count(categorySources, item.categoryAssignmentSource ?? 'absent'); count(categorySets, [...item.allowedCategories].sort().join('+') || 'none'); count(exclusions, String(item.planningExcluded));
  }
  const visibility = production.validateSnapshotStructure(snapshot), visibilityCounts = {};
  for (const value of visibility.values()) count(visibilityCounts, value);
  const selectedRoots = [...boundaryIds].sort((a, b) => a - b).map(id => { const retained = index.objects.get(id); const capturedDescendants = snapshot.objects.filter(o => { let node = index.objects.get(o.dbId); while (node) { if (node.dbId === id) return true; node = node.parent === null ? null : index.objects.get(node.parent); } return false; }); return { id: `dbid:${id}`, name: retained.name, inventoryDescendants: retained.descendants, inventoryFragmentOwnersIncludingSelf: retained.geometryOwners, inventoryFragmentsIncludingSelf: retained.descendantFragments, selectedObjectsIncludingSelf: capturedDescendants.length, selectedRoutingLeaves: capturedDescendants.filter(o => o.geometryRole === 'routing-leaf').length }; });
  return { result: { status: 'PASS', artifactId: expected.artifactId, projectId: expected.projectId, modelVersionId: expected.modelVersionId, contentSha256: expected.contentSha256, objects: snapshot.objects.length, roles, categoryAssignmentSources: categorySources, categorySets, planningExcluded: exclusions, effectiveVisibility: visibilityCounts,
    fragments, vertices, triangles, inventoryObjectsNotSelected: index.objects.size - snapshot.objects.length, selectedObjectFraction: snapshot.objects.length / index.objects.size,
    selectedObjectInventoryFragmentAssociations: snapshot.objects.reduce((n, o) => n + index.objects.get(o.dbId).fragments.length, 0), selectedRoots,
    qualification: 'Only explicit selected capture is computationally scoped. Other names/fragments do not establish tray eligibility, categories, geometry, bounds or properties.' }, selected, visibility };
}

/** Read-only approximation of the retained registry read; no DB state or artifact inventory is invented. */
export function endpointAudit(metadata, expected, snapshot, index, selectedInfo, production, start = performance.now()) {
  requireThat(exact(metadata, ['schemaVersion', 'cables', 'locations', 'aliases', 'bindings', 'selection']) && metadata.schemaVersion === 'pathfinder.coverage.retained-metadata.v1', 'METADATA_SCHEMA');
  for (const key of ['cables', 'locations', 'aliases', 'bindings', 'selection']) requireThat(Array.isArray(metadata[key]) && metadata[key].length <= LIMITS.metadataRows, 'METADATA_BUDGET', { collection: key });
  const selections = new Map(), locations = new Map(), aliases = new Map(), aliasesByLocation = new Map(), bindings = new Map();
  const rowsByProject = {}, bindingAssessments = [], knownArtifact = expected.artifactId;
  for (const row of metadata.selection) { requireThat(UUID.test(row.project_id ?? '') && UUID.test(row.active_model_version_id ?? '') && SHA.test(row.content_fingerprint ?? '') && !selections.has(row.project_id) && text(row.selection_revision, 256) && /^[0-9]+$/.test(row.selection_revision), 'SELECTION_SCHEMA'); selections.set(row.project_id, row); }
  const current = selections.get(expected.projectId);
  requireThat(current && current.active_model_version_id === expected.modelVersionId && current.content_fingerprint === expected.contentSha256 && current.state === 'ready' && current.health === 'healthy', 'METADATA_SELECTED_IDENTITY');
  for (const row of metadata.locations) { requireThat(UUID.test(row.id ?? '') && UUID.test(row.project_id ?? '') && text(row.name, 500) && row.name.trim() && !locations.has(row.id) && selections.has(row.project_id), 'LOCATION_SCHEMA'); locations.set(row.id, row); count(rowsByProject, row.project_id); }
  for (const row of metadata.aliases) {
    const location = locations.get(row.location_id), key = `${row.project_id}\0${row.normalized_alias}`;
    requireThat(location && location.project_id === row.project_id, 'CROSS_PROJECT_ALIAS', { locationId: row.location_id });
    requireThat(text(row.display_alias, 500) && text(row.normalized_alias, 500) && row.normalized_alias.length > 0 && row.normalized_alias === production.normalizeLocation(row.display_alias), 'ALIAS_NORMALIZATION', { locationId: row.location_id });
    requireThat(!aliases.has(key), 'DUPLICATE_PROJECT_ALIAS', { locationId: row.location_id }); aliases.set(key, row);
    const local = aliasesByLocation.get(row.location_id) ?? []; local.push(row.display_alias); aliasesByLocation.set(row.location_id, local);
  }
  for (const row of metadata.bindings) {
    const location = locations.get(row.location_id), selection = selections.get(row.project_id);
    requireThat(location && location.project_id === row.project_id, 'CROSS_PROJECT_BINDING', { locationId: row.location_id });
    requireThat(UUID.test(row.model_version_id ?? '') && (row.artifact_id === null || UUID.test(row.artifact_id ?? '')) && point(row.point) && row.coordinate_frame === 'canonical-world-metres' && ['manual', 'automatic'].includes(row.source) && text(row.derivation, 500) && Number.isFinite(Date.parse(row.confirmed_at)), 'BINDING_SCHEMA', { locationId: row.location_id });
    let assessment = row.model_version_id !== selection.active_model_version_id ? 'stale-model' : row.project_id !== expected.projectId ? 'artifact-currentness-unavailable' : row.artifact_id !== null && row.artifact_id !== knownArtifact ? 'stale-against-selected-artifact' : 'current-against-retained-selected-artifact';
    if (assessment === 'current-against-retained-selected-artifact' && row.object_id !== null) {
      const selected = selectedInfo.selected.get(row.object_id);
      requireThat(selected && selected.geometryRole !== 'hierarchy' && selectedInfo.visibility.get(selected.id) !== 'hidden' && (row.external_id === null || row.external_id === selected.externalId), 'BINDING_OBJECT_JOIN', { locationId: row.location_id, objectId: row.object_id });
    }
    const entry = { ...row, assessment }; const previous = bindings.get(row.location_id);
    if (!previous || Number(row.model_version_id === selection.active_model_version_id) > Number(previous.model_version_id === selection.active_model_version_id) || (row.model_version_id === selection.active_model_version_id) === (previous.model_version_id === selection.active_model_version_id) && Date.parse(row.confirmed_at) > Date.parse(previous.confirmed_at)) bindings.set(row.location_id, entry);
    bindingAssessments.push({ projectId: row.project_id, locationId: row.location_id, modelVersionId: row.model_version_id, artifactId: row.artifact_id, source: row.source, coordinateFrame: row.coordinate_frame, pointSha256: digest(row.point), assessment });
  }
  const dtosByProject = new Map(), selectedByName = new Map();
  for (const location of locations.values()) {
    const binding = bindings.get(location.id), known = binding && binding.assessment !== 'artifact-currentness-unavailable';
    const rows = dtosByProject.get(location.project_id) ?? [];
    rows.push({ id: location.id, name: location.name, aliases: aliasesByLocation.get(location.id) ?? [], binding: known ? { status: binding.assessment === 'current-against-retained-selected-artifact' ? 'confirmed' : 'stale' } : null }); dtosByProject.set(location.project_id, rows);
  }
  for (const item of snapshot.objects) for (const name of production.objectMatchNames(item)) { const candidates = selectedByName.get(name) ?? []; candidates.push(item); selectedByName.set(name, candidates); }
  const endpointUses = new Map(), outputs = [], cableIds = new Set(), matchCache = new Map();
  for (const cable of metadata.cables) {
    checkBudget(start);
    requireThat(UUID.test(cable.id ?? '') && UUID.test(cable.project_id ?? '') && selections.has(cable.project_id) && !cableIds.has(cable.id) && [cable.from_location, cable.to_location].every(v => v === null || text(v, 500)), 'CABLE_SCHEMA'); cableIds.add(cable.id);
    const real = cable.project_id === expected.projectId, selection = selections.get(cable.project_id);
    const dtos = dtosByProject.get(cable.project_id) ?? [];
    for (const direction of ['from', 'to']) {
      const value = cable[`${direction}_location`], normalized = value ? production.normalizeLocation(value) : '', matchKey = `${cable.project_id}\0${normalized}`;
      let match = matchCache.get(matchKey); if (!match) { match = production.matchLocation(value, dtos, Boolean(selection.active_model_version_id)); matchCache.set(matchKey, match); }
      const raw = real && normalized ? index.names.get(normalized) : null;
      const selectedMatches = real && normalized ? selectedByName.get(normalized) ?? [] : [];
      const cableCandidates = selectedMatches.filter(o => o.geometryRole === 'object' && selectedInfo.visibility.get(o.id) === 'visible'), pathCandidates = selectedMatches.filter(o => ['object', 'routing-leaf'].includes(o.geometryRole) && selectedInfo.visibility.get(o.id) !== 'hidden');
      const location = match.locationId ? locations.get(match.locationId) : null, binding = location ? bindings.get(location.id) : null;
      const knownRegistryStatus = binding?.assessment === 'artifact-currentness-unavailable' ? 'unknown-artifact-currentness' : match.locationId && !binding ? 'unknown-unbound-matching-state' : match.status;
      const record = { cableId: cable.id, projectId: cable.project_id, endpoint: direction, endpointTextSha256: sha256(value ?? ''), normalizedTextSha256: sha256(normalized), empty: !normalized,
        rawInventoryName: real ? { status: raw ? (raw.count === 1 ? 'unique' : 'ambiguous') : 'missing', candidates: raw?.count ?? 0, dbIdExamples: raw?.ids ?? [], propertiesNotAvailable: true, roleVisibilityEligibilityNotEstablished: true } : { status: 'NOT_RUN', reason: 'Different project/model; never matched to real inventory.' },
        selectedSharedAutomaticCandidates: real ? { count: cableCandidates.length, ids: cableCandidates.map(o => o.id), contract: 'visible role object only' } : null,
        selectedStandalonePathCandidates: real ? { count: pathCandidates.length, ids: pathCandidates.map(o => o.id), contract: 'role object or routing-leaf; visibility not hidden' } : null,
        recordedRegistry: { status: knownRegistryStatus, productionResultWithOmittedMatchingRows: match.status, locationId: match.locationId, source: binding?.source ?? null, assessment: binding?.assessment ?? null, derivedUsing: 'Pinned production matchLocation plus retained artifact-currentness qualification; live matching rows absent.' } };
      outputs.push(record);
      if (normalized) { const key = `${cable.project_id}\0${normalized}`, use = endpointUses.get(key) ?? { projectId: cable.project_id, normalizedTextSha256: sha256(normalized), uses: [], locationIds: new Set() }; use.uses.push({ cableId: cable.id, endpoint: direction }); if (match.locationId) use.locationIds.add(match.locationId); endpointUses.set(key, use); }
    }
  }
  const reused = [...endpointUses.values()].filter(x => x.uses.length > 1).map(x => ({ ...x, locationIds: [...x.locationIds], sameRecordedLocation: x.locationIds.size === 1 }));
  return { status: 'PASS', scope: 'All supplied QA rows only; no representative business cable list. Binding currentness is relative to the supplied selected artifact, not a live artifact query.', rows: { cables: metadata.cables.length, locations: metadata.locations.length, aliases: metadata.aliases.length, bindings: metadata.bindings.length, selection: metadata.selection.length }, realProjectCables: metadata.cables.filter(x => x.project_id === expected.projectId).length, otherProjectCables: metadata.cables.filter(x => x.project_id !== expected.projectId).length,
    normalization: 'Pinned production NFC -> trim -> uppercase; punctuation and leading zeroes preserved.', locationsByProject: rowsByProject, bindings: bindingAssessments, endpoints: outputs, repeatedEndpointKeys: reused,
    missingEvidence: ['No live artifact purpose/status/latest inventory or pf_location_matching rows.', 'Full inventory has no equipment bounds/meshes/properties/native visibility; name-only misses cannot establish property-alias misses.', 'Synthetic current artifact is not supplied; its bindings remain unknown rather than being falsely matched to the real model.'] };
}

async function sourceIdentity(root) {
  const own = ['scripts/pathfinder-coverage/audit.mjs', 'scripts/pathfinder-coverage/retained.mjs', 'scripts/pathfinder-capacity/lib.mjs'];
  const files = []; for (const filename of own) files.push({ path: filename, sha256: sha256(await fs.readFile(path.resolve(root, filename))) });
  const git = argument => { try { return execFileSync('git', argument, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim(); } catch { return null; } };
  return { branch: git(['branch', '--show-current']), commit: git(['rev-parse', 'HEAD']), sourceFiles: files, sourceSetSha256: digest(files) };
}

export async function runAudit({ root, output, manifest = retainedManifest, manifestPath = null, sourceRoot = fileURLToPath(new URL('../../', import.meta.url)) }) {
  const started = performance.now(), result = { schemaVersion: 'pathfinder.coverage.result.v1', startedAt: new Date().toISOString(), status: 'FAIL', technicalIntegrity: 'NOT_RUN', engineeringAcceptance: 'NOT_PERFORMED_USER_REVIEW_REQUIRED', nativeOracle: 'NOT_PERFORMED_NOT_REQUIRED_BY_USER', limits: LIMITS, inputs: [], checks: [] };
  let outputFilename;
  try {
    outputFilename = await safePath(root, output, { output: true });
    result.source = await sourceIdentity(sourceRoot);
    if (manifestPath !== null) { const filename = await safePath(root, manifestPath), stat = await fs.stat(filename); requireThat(stat.size <= 1024 ** 2, 'MANIFEST_SIZE'); const raw = await fs.readFile(filename); result.inputs.push({ path: manifestPath, bytes: raw.length, sha256: sha256(raw) }); manifest = parseOutput(raw, 1024 ** 2); }
    validateManifest(manifest); result.manifestSha256 = digest(manifest); result.label = manifest.label;
    result.currentPhase = 'production-matching'; const production = await matchingModule(root, manifest.productionMatching, result.inputs);
    result.checks.push({ name: 'production-matching-code-and-dependency', status: 'PASS' });
    result.currentPhase = 'inventory-receipt'; const receipt = parseOutput(await checkedBytes(root, manifest.inventory, 1024 ** 2, result.inputs), 1024 ** 2); validateInventoryReceipt(receipt);
    result.currentPhase = 'inventory-parts'; const index = await inventoryIndex(root, receipt, manifest.inventory, result.inputs, result, started, production.normalizeLocation);
    result.checks.push({ name: 'all-declared-parts-hashes-offsets-ids-fragments', status: 'PASS' });
    result.currentPhase = 'hierarchy'; result.hierarchy = hierarchyAudit(index.objects, started); checkBudget(started); result.checks.push({ name: 'parents-roots-cycles-depth-child-counts', status: 'PASS' });
    result.currentPhase = 'selected-snapshot'; result.currentInput = manifest.snapshot.path;
    const snapshot = parseOutput(await checkedBytes(root, manifest.snapshot, LIMITS.snapshotBytes, result.inputs), LIMITS.snapshotBytes), selected = snapshotAudit(snapshot, manifest.snapshot, receipt, index, production);
    result.selected = selected.result; result.checks.push({ name: 'selected-identities-ancestors-fragments-boundaries-mesh', status: 'PASS' });
    result.currentPhase = 'coordinates'; result.coordinates = transformAudit(receipt, snapshot); result.checks.push({ name: 'internal-coordinate-declarations-consistent-no-transform-applied', status: 'PASS' });
    result.currentPhase = 'retained-endpoints'; result.currentInput = manifest.metadata.path;
    const metadata = parseOutput(await checkedBytes(root, manifest.metadata, 8 * 1024 ** 2, result.inputs), 8 * 1024 ** 2);
    result.endpoints = endpointAudit(metadata, manifest.snapshot, snapshot, index, selected, production, started); result.checks.push({ name: 'all-retained-qa-project-scoped-aliases-bindings-endpoints', status: 'PASS' });
    checkBudget(started); result.technicalIntegrity = 'PASS'; result.status = 'PASS_WITH_GAPS';
    result.gaps = [{ name: 'external-map-vs-instance-tree-count-reconciliation', status: 'BLOCKED', reason: result.inventory.identityDeclarationReconciliation.reason },
      { name: 'full-model-computational-geometry-properties-visibility-and-category-coverage', status: 'BLOCKED', reason: 'Only the supplied explicit 52-object (or manifest-selected) scope has computational geometry; full inventory is hierarchy and fragment associations.' },
      { name: 'representative-business-endpoint-coverage', status: 'NOT_RUN', reason: 'Only supplied QA rows are retained.' },
      { name: 'whole-plant-routing-capacity-and-global-prebuilt-graph', status: 'NOT_RUN', reason: 'Metadata traversal is neither a product capture nor a graph/capacity test.' }];
    delete result.currentInput; delete result.currentPhase;
  } catch (error) {
    result.status = 'FAIL'; result.technicalIntegrity = 'FAIL'; result.failure = { code: error.code ?? 'AUDIT_ERROR', message: String(error.message).slice(0, 500), detail: error.detail ?? {}, phase: result.currentPhase ?? 'output-or-manifest', input: result.currentInput ?? null };
    result.checks.push({ name: result.currentPhase ?? 'output-or-manifest', status: 'FAIL', code: result.failure.code });
  }
  result.finishedAt = new Date().toISOString(); result.elapsedMilliseconds = performance.now() - started; result.memory = { ...process.memoryUsage(), peakRssBytes: process.resourceUsage().maxRSS * 1024 };
  let bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
  if (bytes.length > LIMITS.outputBytes) {
    // The oversize result is a real failed gate, not an exception that loses its proof.
    const summary = { schemaVersion: result.schemaVersion, startedAt: result.startedAt, finishedAt: result.finishedAt, elapsedMilliseconds: result.elapsedMilliseconds,
      status: 'FAIL', technicalIntegrity: 'FAIL', engineeringAcceptance: result.engineeringAcceptance, nativeOracle: result.nativeOracle,
      source: result.source, manifestSha256: result.manifestSha256, limits: LIMITS, inputs: result.inputs,
      failure: { code: 'RECEIPT_OUTPUT_LIMIT', phase: 'receipt-serialization', detail: { bytes: bytes.length, maximumBytes: LIMITS.outputBytes, inventoryObjects: result.inventory?.objects ?? null, endpointRows: result.endpoints?.endpoints?.length ?? null, previousStatus: result.status } },
      checks: [...result.checks, { name: 'receipt-output-budget', status: 'FAIL', code: 'RECEIPT_OUTPUT_LIMIT' }], memory: result.memory };
    Object.keys(result).forEach(key => { delete result[key]; }); Object.assign(result, summary); bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
  }
  // Exclusive creation preserves every earlier receipt, including failures. A supplied unsafe/existing output is never replaced.
  if (!outputFilename) outputFilename = await safePath(root, output, { output: true });
  await fs.writeFile(outputFilename, bytes, { flag: 'wx' });
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    const args = process.argv.slice(2), values = {};
    requireThat(args.length === 4 || args.length === 6, 'CLI_ARGUMENTS');
    for (let i = 0; i < args.length; i += 2) { requireThat(['--root', '--output', '--manifest'].includes(args[i]) && !values[args[i]] && args[i + 1], 'CLI_ARGUMENTS'); values[args[i]] = args[i + 1]; }
    requireThat(values['--root'] && values['--output'], 'CLI_ARGUMENTS');
    result = await runAudit({ root: values['--root'], output: values['--output'], manifestPath: values['--manifest'] ?? null });
    console.log(JSON.stringify({ schemaVersion: result.schemaVersion, status: result.status, technicalIntegrity: result.technicalIntegrity, output: values['--output'], failure: result.failure ?? null }));
    process.exitCode = result.status === 'FAIL' ? 2 : 0;
  } catch (error) { console.error(JSON.stringify({ status: 'FAIL', code: error.code ?? 'CLI_ERROR', message: String(error.message).slice(0, 500) })); process.exitCode = 2; }
}
