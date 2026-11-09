// Assignment correspondence only. Matching an object never proves unchanged
// geometry, current connectivity, or engineering acceptance of its new revision.
export const TRAY_IDENTITY_LIMITS = Object.freeze({ requests: 32, pageBytes: 24576, responseBytes: 32768, indexedObjects: 1000000,
  batch: 256, propertiesPerRow: 16384, scannedProperties: 32000000, indexBytes: 256 * 1024 ** 2, timeoutMs: 300000 });
const models = new WeakMap();
const fail = code => Object.assign(new Error('The model object identities could not be checked completely.'), { code });
const abort = () => new DOMException('Operation cancelled.', 'AbortError');
const id = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined);
const validText = (value, max = 1024) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const guid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const validIdentity = value => exact(value, ['externalId', 'guid', 'sourceFile'])
  && (value.externalId === null || validText(value.externalId)) && (value.guid === null || guid(value.guid))
  && (value.sourceFile === null || validText(value.sourceFile));
const bytesFit = (value, limit = TRAY_IDENTITY_LIMITS.pageBytes) => new TextEncoder().encode(JSON.stringify(value)).length <= limit;
const hasKey = value => value.externalId !== null || value.guid !== null;
export function validateTrayIdentityRequest(value) {
  return exact(value, ['schemaVersion', 'identities']) && value.schemaVersion === 'wfc.pf.tray-identity-request.v1'
    && Array.isArray(value.identities) && value.identities.length > 0 && value.identities.length <= TRAY_IDENTITY_LIMITS.requests
    && value.identities.every(identity => validIdentity(identity) && hasKey(identity)) && bytesFit(value);
}
export function validateTrayIdentityResponse(value) {
  return exact(value, ['schemaVersion', 'matches']) && value.schemaVersion === 'wfc.pf.tray-identity-response.v1'
    && Array.isArray(value.matches) && value.matches.length > 0 && value.matches.length <= TRAY_IDENTITY_LIMITS.requests
    && value.matches.every(match => exact(match, ['identity', 'status', 'objectIds']) && validIdentity(match.identity) && hasKey(match.identity)
      && ['unique', 'missing', 'ambiguous', 'unavailable'].includes(match.status) && Array.isArray(match.objectIds)
      && match.objectIds.every(id) && new Set(match.objectIds).size === match.objectIds.length
      && (match.status === 'unique' ? match.objectIds.length === 1 : match.status === 'ambiguous' ? match.objectIds.length === 2 : match.objectIds.length === 0)) && bytesFit(value, TRAY_IDENTITY_LIMITS.responseBytes);
}
function operation(options) {
  const started = Date.now();
  return () => { if (options.signal?.aborted) throw abort(); options.check?.();
    if (Date.now() - started > TRAY_IDENTITY_LIMITS.timeoutMs) throw fail('TRAY_IDENTITY_TIMEOUT'); };
}
function call(action, options, check) {
  check();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancelled);
      try { check(); if (error) throw error; resolve(value); } catch (cause) { reject(cause); } };
    const cancelled = () => finish(abort());
    const timer = setTimeout(() => finish(fail('TRAY_IDENTITY_TIMEOUT')), 45000);
    options.signal?.addEventListener('abort', cancelled, { once: true });
    try { action(value => finish(null, value), () => finish(fail('TRAY_IDENTITY_READ_FAILED'))); } catch { finish(fail('TRAY_IDENTITY_READ_FAILED')); }
  });
}
async function inventory(model, options, check) {
  let state = models.get(model); if (!state) { state = {}; models.set(model, state); }
  if (state.inventory) return state.inventory;
  const tree = await call((yes, no) => model.getObjectTree(yes, no), options, check), root = tree.getRootId();
  const ids = [root], seen = new Set(ids);
  tree.enumNodeChildren(root, value => { check(); if (!seen.has(value)) { seen.add(value); ids.push(value); }
    if (!id(value) || ids.length > TRAY_IDENTITY_LIMITS.indexedObjects) throw fail('TRAY_IDENTITY_INDEX_LIMIT'); return false; }, true);
  if (!id(root)) throw fail('TRAY_IDENTITY_READ_FAILED');
  const mapping = await call((yes, no) => model.getExternalIdMapping(yes, no), options, check);
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw fail('TRAY_IDENTITY_READ_FAILED');
  const byExternal = new Map(), externalById = new Map(); let count = 0, charged = 0;
  for (const key of Object.keys(mapping)) {
    check(); const objectId = own(mapping, key);
    if (++count > TRAY_IDENTITY_LIMITS.indexedObjects) throw fail('TRAY_IDENTITY_INDEX_LIMIT');
    if (!validText(key) || !id(objectId) || !seen.has(objectId)) continue;
    charged += 192 + key.length * 2; if (charged > TRAY_IDENTITY_LIMITS.indexBytes) throw fail('TRAY_IDENTITY_INDEX_LIMIT');
    byExternal.set(key, objectId); externalById.set(objectId, externalById.has(objectId) ? null : key);
  }
  check(); state.inventory = { ids, seen, byExternal, externalById }; return state.inventory;
}
function structuralRelation(property) {
  // SDK 7.130.0 exposes hidden hierarchy links as ordinary properties when
  // ignoreHidden is false. Large aggregation nodes can have thousands of them.
  const name = own(property, 'attributeName'), hidden = own(property, 'hidden');
  return (hidden === true || hidden === 1) && own(property, 'type') === 11 && id(own(property, 'displayValue'))
    && ((name === 'child' && own(property, 'displayCategory') === '__child__')
      || (name === 'parent' && own(property, 'displayCategory') === '__parent__'));
}
function propertyIdentity(props, count, check) {
  const guids = new Set(), sources = new Set(); let invalidGuid = false, invalidSource = false, metadataCount = 0;
  for (let at = 0; at < count; at++) {
    if ((at & 255) === 0) check();
    const property = props[at];
    if (structuralRelation(property)) continue;
    if (++metadataCount > TRAY_IDENTITY_LIMITS.propertiesPerRow) throw fail('TRAY_IDENTITY_ROW_LIMIT');
    const rawName = own(property, 'displayName') ?? own(property, 'attributeName');
    if (typeof rawName !== 'string') continue;
    const key = rawName.normalize('NFKC').replace(/[\s_.-]/g, '').toLowerCase(), value = own(property, 'displayValue');
    if (['guid', 'globalid', 'ifcguid'].includes(key)) {
      const normalizedGuid = typeof value === 'string' ? value.normalize('NFC').trim().replace(/^\{(.*)\}$/, '$1').toLowerCase() : null;
      if (!guid(normalizedGuid)) invalidGuid = true; else guids.add(normalizedGuid);
    } else if (['sourcefile', 'sourcefilename', 'quelldatei'].includes(key)) {
      if (!validText(value)) invalidSource = true; else sources.add(value.normalize('NFC').trim().replaceAll('\\', '/').toLowerCase());
    }
  }
  return { guid: !invalidGuid && guids.size === 1 ? [...guids][0] : null,
    sourceFile: !invalidSource && sources.size === 1 ? [...sources][0] : null };
}
async function propertyRows(model, ids, options, check, budget) {
  const rows = await call((yes, no) => model.getBulkProperties(ids, { ignoreHidden: false, needsExternalId: false }, yes, no), options, check);
  if (!Array.isArray(rows) || rows.length > ids.length) throw fail('TRAY_IDENTITY_READ_FAILED');
  const allowed = new Set(ids), found = new Map();
  for (const row of rows) { check(); const objectId = own(row, 'dbId'), props = own(row, 'properties');
    if (!allowed.has(objectId) || found.has(objectId) || !Array.isArray(props)) throw fail('TRAY_IDENTITY_READ_FAILED');
    // Charge raw entries, including hierarchy links, before iterating. Exempting
    // structural links from the metadata quota must not bypass the scan budget.
    const count = props.length;
    if (count > budget.remaining) throw fail('TRAY_IDENTITY_INDEX_LIMIT');
    budget.remaining -= count;
    found.set(objectId, propertyIdentity(props, count, check)); }
  return found;
}
export async function readTrayObjectIdentities(model, objectIds, options = {}) {
  if (!Array.isArray(objectIds) || objectIds.length > 512 || !objectIds.every(id) || new Set(objectIds).size !== objectIds.length) throw fail('TRAY_IDENTITY_SCOPE_INVALID');
  const check = operation(options), index = await inventory(model, options, check), found = new Map(), budget = { remaining: TRAY_IDENTITY_LIMITS.scannedProperties };
  if (!objectIds.every(objectId => index.seen.has(objectId))) throw fail('TRAY_IDENTITY_SCOPE_INVALID');
  for (let start = 0; start < objectIds.length; start += TRAY_IDENTITY_LIMITS.batch) {
    const rows = await propertyRows(model, objectIds.slice(start, start + TRAY_IDENTITY_LIMITS.batch), options, check, budget);
    for (const [key, value] of rows) found.set(key, value);
  }
  check(); return objectIds.map(objectId => ({ objectId, identity: { externalId: index.externalById.get(objectId) ?? null,
    guid: found.get(objectId)?.guid ?? null, sourceFile: found.get(objectId)?.sourceFile ?? null } }));
}
async function guidIndex(model, inventory, options, check, budget) {
  const state = models.get(model); if (state.guids) return state.guids;
  const byGuid = new Map(); let complete = true, charged = 0;
  for (let start = 0; start < inventory.ids.length; start += TRAY_IDENTITY_LIMITS.batch) {
    const batch = inventory.ids.slice(start, start + TRAY_IDENTITY_LIMITS.batch), rows = await propertyRows(model, batch, options, check, budget);
    if (rows.size !== batch.length) complete = false;
    for (const [objectId, value] of rows) {
      if (!value.guid) continue;
      charged += 256 + (value.sourceFile?.length ?? 0) * 2; if (charged > TRAY_IDENTITY_LIMITS.indexBytes) throw fail('TRAY_IDENTITY_INDEX_LIMIT');
      const list = byGuid.get(value.guid) ?? []; list.push({ objectId, sourceFile: value.sourceFile }); byGuid.set(value.guid, list);
    }
    await new Promise(resolve => setTimeout(resolve, 0)); check();
  }
  const result = { complete, byGuid }; if (complete) state.guids = result; return result;
}
const sourceKey = value => value === null ? null : value.normalize('NFC').trim().replaceAll('\\', '/').toLowerCase();
export async function resolveTrayObjectIdentities(model, identities, options = {}) {
  if (!validateTrayIdentityRequest({ schemaVersion: 'wfc.pf.tray-identity-request.v1', identities })) throw fail('TRAY_IDENTITY_SCOPE_INVALID');
  const check = operation(options), index = await inventory(model, options, check), budget = { remaining: TRAY_IDENTITY_LIMITS.scannedProperties };
  const matches = [], candidates = identities.map(identity => identity.externalId === null ? undefined : index.byExternal.get(identity.externalId));
  const verifyIds = [...new Set(candidates.filter((value, at) => value !== undefined && (identities[at].guid !== null || identities[at].sourceFile !== null)))];
  const verified = verifyIds.length ? await propertyRows(model, verifyIds, options, check, budget) : new Map();
  let guids;
  for (let at = 0; at < identities.length; at++) {
    check(); const identity = { ...identities[at] }, external = candidates[at], observed = verified.get(external);
    if (external !== undefined && (identity.guid === null || observed?.guid === identity.guid.toLowerCase())
      && (identity.sourceFile === null || observed?.sourceFile === sourceKey(identity.sourceFile))) {
      matches.push({ identity, status: 'unique', objectIds: [external] }); continue;
    }
    if (identity.guid === null) { matches.push({ identity, status: external === undefined ? 'missing' : 'unavailable', objectIds: [] }); continue; }
    guids ??= await guidIndex(model, index, options, check, budget);
    const eligible = (guids.byGuid.get(identity.guid.toLowerCase()) ?? []).filter(value => identity.sourceFile === null || value.sourceFile === sourceKey(identity.sourceFile));
    const objectIds = eligible.slice(0, 2).map(value => value.objectId);
    matches.push({ identity, status: !guids.complete ? 'unavailable' : objectIds.length > 1 ? 'ambiguous' : objectIds.length ? 'unique' : 'missing', objectIds: guids.complete ? objectIds : [] });
  }
  check();
  if (!validateTrayIdentityResponse({ schemaVersion: 'wfc.pf.tray-identity-response.v1', matches })) throw fail('TRAY_IDENTITY_RESULT_INVALID');
  return matches;
}
