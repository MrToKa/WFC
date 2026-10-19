import type { ComputationalSnapshot, LocationDto, LocationMatch, SnapshotObject } from './contracts.js';
import { PathFinderError } from './errors.js';
import { modelEquipmentMatchKeys } from '../../viewer-runtime/equipment-names.mjs';

/** Exact project identity; preserve punctuation, leading zeroes and display spelling. */
export function normalizeLocation(value: string): string {
  return value.normalize('NFC').trim().toUpperCase();
}
export function matchLocation(value: string | null, locations: LocationDto[], hasActiveModel: boolean): LocationMatch {
  if (!value || !normalizeLocation(value)) return { status: 'missing', locationId: null, candidates: [] };
  const key = normalizeLocation(value);
  const candidates = locations.filter(location => [location.name, ...location.aliases].some(alias => normalizeLocation(alias) === key));
  if (candidates.length !== 1) return { status: candidates.length ? 'ambiguous' : 'missing', locationId: null, candidates: candidates.map(x => x.id) };
  const location = candidates[0];
  if (!location.binding) return {status:location.matching?.status === 'ambiguous' || location.matching?.status === 'unverified' ? 'ambiguous' : 'missing',locationId:location.id,candidates:location.matching?.candidateObjectIds ?? []};
  return { status: location.binding?.status === 'confirmed' && hasActiveModel ? 'matched' : 'stale', locationId: location.id, candidates: [location.id] };
}
export function objectMatchNames(object: SnapshotObject): string[] {
  return [...new Set([object.name, ...object.properties.filter(property => /^(tag|name|equipment[ _-]?tag|equipment[ _-]?name|location)$/i.test(property.name)).map(property => property.value)]
    .flatMap(modelEquipmentMatchKeys))];
}
export function validateSnapshotStructure(snapshot: ComputationalSnapshot): Map<string, 'visible' | 'hidden' | 'unknown'> {
  const objects = new Map<string, SnapshotObject>(), dbIds = new Set<number>(), fragments = new Set<string>();
  let fragmentCount = 0, vertexCount = 0, triangleCount = 0;
  for (const object of snapshot.objects) {
    if (objects.has(object.id) || object.dbId != null && dbIds.has(object.dbId)) throw new PathFinderError('DUPLICATE_OBJECT_ID');
    objects.set(object.id, object); if (object.dbId != null) dbIds.add(object.dbId);
    if (object.categoryAssignmentSource === 'unassigned' && object.allowedCategories.length) throw new PathFinderError('UNASSIGNED_CATEGORY');
    if (new Set(object.allowedCategories).size !== object.allowedCategories.length) throw new PathFinderError('DUPLICATE_CATEGORY');
    if (object.geometryRole === 'hierarchy' && object.fragments.length) throw new PathFinderError('HIERARCHY_HAS_GEOMETRY');
    for (const fragment of object.fragments) {
      if (fragments.has(fragment.id)) throw new PathFinderError('DUPLICATE_FRAGMENT_ID');
      fragments.add(fragment.id); fragmentCount++; vertexCount += fragment.vertices.length; triangleCount += fragment.triangleIndices.length / 3;
    }
  }
  if (fragmentCount > 100_000 || vertexCount > 5_000_000 || triangleCount > 5_000_000) throw new PathFinderError('SNAPSHOT_BUDGET',413);
  const visibility = new Map<string, 'visible' | 'hidden' | 'unknown'>(), depths = new Map<string, number>();
  for (const object of snapshot.objects) {
    if (object.parentId && objects.get(object.parentId)?.geometryRole === 'routing-leaf') throw new PathFinderError('ROUTING_LEAF_HAS_CHILD');
    const chain: SnapshotObject[] = [], seen = new Set<string>(); let current: SnapshotObject | undefined = object;
    let inherited: 'visible' | 'hidden' | 'unknown' = 'visible', depth = 0;
    while (current) {
      if (visibility.has(current.id)) { inherited = visibility.get(current.id)!; depth = depths.get(current.id)!; break; }
      if (seen.has(current.id) || chain.length >= 512) throw new PathFinderError('INVALID_HIERARCHY');
      seen.add(current.id); chain.push(current);
      if (!current.parentId) break;
      const parent = objects.get(current.parentId);
      if (!parent) {
        if (snapshot.capture.inventoryComplete) throw new PathFinderError('MISSING_PARENT');
        inherited = 'unknown'; break;
      }
      current = parent;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const item = chain[i]; depth++; if (depth > 512) throw new PathFinderError('INVALID_HIERARCHY');
      inherited = inherited === 'hidden' || item.nativeHidden === true || item.planningExcluded ? 'hidden'
        : inherited === 'unknown' || item.nativeHidden === null ? 'unknown' : 'visible';
      visibility.set(item.id, inherited); depths.set(item.id, depth);
    }
  }
  if (snapshot.capture.unitsVerified && (!snapshot.coordinates.metresPerSourceUnit || snapshot.coordinates.sourceUnits === 'unknown')) throw new PathFinderError('UNVERIFIED_UNITS');
  if (snapshot.capture.transformsVerified && !snapshot.coordinates.sourceToWorldMetres) throw new PathFinderError('UNVERIFIED_TRANSFORM');
  if (snapshot.capture.sourceLinkVerified && !snapshot.model.sourceContentSha256) throw new PathFinderError('UNVERIFIED_SOURCE');
  for (const matrix of [snapshot.coordinates.sourceToWorldMetres, snapshot.coordinates.displayToWorldMetres]) {
    if (matrix && (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1)) throw new PathFinderError('NON_AFFINE_TRANSFORM');
  }
  return visibility;
}
