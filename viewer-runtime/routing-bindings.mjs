/** Protected-frame response contract. Never accepts mapping IDs from parent messages. */
export const ROUTING_BINDINGS_LIMITS = Object.freeze({ maps: 128, roots: 512, bytes: 28 * 1024 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => object(value) && Object.keys(value).length === fields.length &&
  fields.every(key => Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined);
const array = value => Array.isArray(value) && Object.keys(value).length === value.length;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
const root = value => typeof value === 'string' && /^dbid:(?:0|[1-9][0-9]*)$/.test(value) && value.length <= 16 && Number(value.slice(5)) <= 2147483647;

/** Descriptor shape stays closed and unchanged; server authorization pins the
 * session selection revision, and the frame pins its first value per load.
 */
export function parseRoutingBindings(value, descriptor, selectionRevision) {
  try {
    if (!exact(value, ['schemaVersion', 'modelVersionId', 'contentFingerprint', 'selectionRevision', 'aggregateId', 'bindings']) ||
        value.schemaVersion !== 'wfc.viewer.routing-bindings.v1' || !uuid(value.modelVersionId) ||
        value.modelVersionId !== descriptor?.modelVersionId || value.contentFingerprint !== descriptor?.contentFingerprint ||
        typeof value.contentFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentFingerprint) ||
        !revision(value.selectionRevision) || selectionRevision !== undefined && value.selectionRevision !== selectionRevision ||
        !(value.aggregateId === null || uuid(value.aggregateId)) || !array(value.bindings) || value.bindings.length > ROUTING_BINDINGS_LIMITS.maps ||
        value.aggregateId === null && value.bindings.length !== 0 || new TextEncoder().encode(JSON.stringify(value)).length > ROUTING_BINDINGS_LIMITS.bytes) return null;
    const routes = new Set(), roots = new Set(), bindings = [];
    for (const binding of value.bindings) {
      if (!exact(binding, ['routeName', 'rootObjectIds']) || typeof binding.routeName !== 'string' ||
          !/^\/[A-Z0-9][A-Z0-9_.-]*$/.test(binding.routeName) || binding.routeName.length > 500 || binding.routeName === '/SECONDARY' ||
          routes.has(binding.routeName) || !array(binding.rootObjectIds) || !binding.rootObjectIds.length) return null;
      routes.add(binding.routeName);
      for (const id of binding.rootObjectIds) {
        if (!root(id) || roots.has(id) || roots.size >= ROUTING_BINDINGS_LIMITS.roots) return null;
        roots.add(id);
      }
      bindings.push(Object.freeze({ routeName: binding.routeName, rootObjectIds: Object.freeze([...binding.rootObjectIds]) }));
    }
    return Object.freeze({ ...value, bindings: Object.freeze(bindings) });
  } catch { return null; }
}
