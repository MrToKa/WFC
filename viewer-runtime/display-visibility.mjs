// SDK display visibility only. Native visibility remains unknown.
export const DISPLAY_VISIBILITY_SCHEMA = 'wfc.pf.sdk-display-visibility.v1';
export const EQUIPMENT_VISIBILITY_POLICY = 'wfc.pf.project-exact-candidates.v3';
const maximum = 1000000, depth = 512;
const fail = () => { throw Object.assign(new Error('Complete current SDK display visibility is required for automatic endpoints.'), { code: 'PREPARATION_VISIBILITY_UNAVAILABLE' }); };
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
const bool = value => typeof value === 'boolean' ? value : fail();
export const sameDisplayVisibility = (first, second) => first?.schemaVersion === DISPLAY_VISIBILITY_SCHEMA && second?.schemaVersion === DISPLAY_VISIBILITY_SCHEMA && first.basis === 'sdk-display-before-pf-appearance' && second.basis === first.basis && /^[a-f0-9]{64}$/.test(first.contentSha256 ?? '') && first.contentSha256 === second.contentSha256;

/** Fresh bounded observation. No cache can turn an earlier hidden row into a
 * current unique endpoint, nor mistake PF isolation for the user's baseline. */
export async function captureDisplayVisibility(viewer, tree, ids, { check = () => {}, pause = async () => {}, indexById } = {}) {
  check(); const model = viewer?.model, fragments = model?.getFragmentList?.();
  if (!model || !Array.isArray(ids) || ids.length < 1 || ids.length > maximum || !ids.every(integer) || typeof tree?.isNodeHidden !== 'function' || typeof tree.isNodeOff !== 'function' || typeof tree.getNodeParentId !== 'function' || typeof tree.enumNodeChildren !== 'function' || typeof tree.enumNodeFragments !== 'function' || typeof fragments?.isFragVisible !== 'function' || typeof fragments.getCount !== 'function') fail();
  const count = fragments.getCount(), root = tree.getRootId();
  if (!integer(count) || count > maximum || !ids.includes(root)) fail();
  const byId = indexById ?? new Map();
  if (indexById && (!(indexById instanceof Map) || indexById.size !== ids.length)) fail();
  for (let index = 0; index < ids.length; index++) { check(); const id = ids[index]; if (indexById ? byId.get(id) !== index : byId.has(id)) fail(); if (!indexById) byId.set(id, index); }
  const nodes = new Uint8Array(ids.length), visibleFragments = new Uint8Array(count);
  // Fixed big-endian layout: version/counts/root, then [id,parent,flags] and
  // fragment visibility by exact SDK fragment index. It has no property data.
  const bytes = new Uint8Array(16 + ids.length * 9 + count), data = new DataView(bytes.buffer);
  let lastYield = performance.now();
  data.setUint32(0, 1); data.setUint32(4, ids.length); data.setUint32(8, count); data.setUint32(12, root);
  for (let index = 0; index < ids.length; index++) {
    check(); if (viewer.model !== model) fail(); const id = ids[index], parent = tree.getNodeParentId(id);
    if (id !== root && (!integer(parent) || !byId.has(parent) || parent === id)) fail();
    const flags = (bool(tree.isNodeHidden(id)) ? 1 : 0) | (bool(tree.isNodeOff(id)) ? 2 : 0); nodes[index] = flags;
    const offset = 16 + index * 9; data.setUint32(offset, id); data.setUint32(offset + 4, id === root ? 0xffffffff : parent); bytes[offset + 8] = flags;
    if (index % 8192 === 0 && performance.now() - lastYield >= 16) { await pause(); lastYield = performance.now(); }
  }
  for (let id = 0; id < count; id++) { check(); visibleFragments[id] = bool(fragments.isFragVisible(id)) ? 1 : 0; bytes[16 + ids.length * 9 + id] = visibleFragments[id]; if (id % 8192 === 0 && performance.now() - lastYield >= 16) { await pause(); lastYield = performance.now(); } }
  check(); if (viewer.model !== model) fail();
  const contentSha256 = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join(''); check(); if (viewer.model !== model) fail();
  const scope = Object.freeze({ schemaVersion: DISPLAY_VISIBILITY_SCHEMA, basis: 'sdk-display-before-pf-appearance', contentSha256 });
  function lineage(id) {
    const seen = new Set(); let current = id;
    while (true) { check(); if (!byId.has(current) || seen.has(current) || seen.size >= depth) fail(); seen.add(current); if (nodes[byId.get(current)]) return null; if (current === root) return seen.size; const parent = tree.getNodeParentId(current); if (!integer(parent) || parent === current) fail(); current = parent; }
  }
  function equipmentEligibility(id) {
    check(); if (viewer.model !== model || !byId.has(id)) fail(); const checkedAncestorCount = lineage(id); if (checkedAncestorCount === null) return null;
    const found = new Set(), descendants = new Set([id]); let allowed = true;
    const inspect = child => {
      check(); if (!byId.has(child)) fail(); if (nodes[byId.get(child)]) allowed = false;
      tree.enumNodeFragments(child, fragment => { check(); if (!integer(fragment) || fragment >= count) fail(); found.add(fragment); if (!visibleFragments[fragment]) allowed = false; if (found.size > maximum) fail(); }, false);
    };
    inspect(id); tree.enumNodeChildren(id, child => { check(); if (!byId.has(child) || descendants.has(child)) fail(); descendants.add(child); if (descendants.size > maximum) fail(); inspect(child); return false; }, true);
    if (!allowed) return null;
    if (!found.size) {
      if (typeof tree.getNodeBox !== 'function') return null;
      for (const transform of [model.getModelTransform?.(), model.getPlacementTransform?.()]) if (transform && (!transform.elements || transform.elements.length !== 16 || Array.from(transform.elements).some((value, index) => value !== (index % 5 === 0 ? 1 : 0)))) return null;
      const bounds = new Float64Array(6).fill(NaN); tree.getNodeBox(id, bounds);
      if (!Array.from(bounds).every(Number.isFinite) || ![0, 1, 2].every(axis => bounds[axis] <= bounds[axis + 3])) return null;
    }
    return { schemaVersion: 'wfc.pf.equipment-eligibility.v1', matchingPolicyVersion: EQUIPMENT_VISIBILITY_POLICY, visibilityScopeSha256: scope.contentSha256, visibility: 'visible', checkedAncestorCount, fragmentStatus: found.size ? 'all-visible' : 'geometry-free-node-bounds', fragmentCount: found.size };
  }
  return { scope, equipmentEligibility, refresh: () => captureDisplayVisibility(viewer, tree, ids, { check, pause, indexById: byId }) };
}
