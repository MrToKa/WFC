/** Protected-frame response contract. Never accepts mapping IDs from parent messages. */
export const ROUTING_BINDINGS_LIMITS = Object.freeze({ maps: 128, roots: 512, bytes: 28 * 1024, cadBytes: 512 * 1024, cadPaths: 256, cadPoints: 32768 });
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
export function parseRoutingBindings(value, descriptor, selectionRevision, requestedKeys) {
  try {
    const requested = requestedKeys === undefined ? null : new Set(requestedKeys);
    const cad = value?.schemaVersion === 'wfc.viewer.routing-bindings.v2';
    if (!exact(value, ['schemaVersion', 'modelVersionId', 'contentFingerprint', 'selectionRevision', 'aggregateId', 'bindings', ...(cad ? ['cadBindings'] : [])]) ||
        !['wfc.viewer.routing-bindings.v1', 'wfc.viewer.routing-bindings.v2'].includes(value.schemaVersion) || !uuid(value.modelVersionId) ||
        value.modelVersionId !== descriptor?.modelVersionId || value.contentFingerprint !== descriptor?.contentFingerprint ||
        typeof value.contentFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentFingerprint) ||
        !revision(value.selectionRevision) || selectionRevision !== undefined && value.selectionRevision !== selectionRevision ||
        !(value.aggregateId === null || uuid(value.aggregateId)) || !array(value.bindings) || value.bindings.length > ROUTING_BINDINGS_LIMITS.maps ||
        value.aggregateId === null && value.bindings.length !== 0 || new TextEncoder().encode(JSON.stringify(value)).length > (cad ? ROUTING_BINDINGS_LIMITS.cadBytes : ROUTING_BINDINGS_LIMITS.bytes)) return null;
    const routes = new Set(), roots = new Set(), bindings = [];
    for (const binding of value.bindings) {
      if (!exact(binding, ['routeName', 'rootObjectIds']) || typeof binding.routeName !== 'string' ||
          !/^\/[A-Z0-9][A-Z0-9_.-]*$/.test(binding.routeName) || binding.routeName.length > 500 || binding.routeName === '/SECONDARY' ||
          routes.has(binding.routeName) || requested && !requested.has(binding.routeName.slice(1)) || !array(binding.rootObjectIds) || !binding.rootObjectIds.length) return null;
      routes.add(binding.routeName);
      for (const id of binding.rootObjectIds) {
        if (!root(id) || roots.has(id) || roots.size >= ROUTING_BINDINGS_LIMITS.roots) return null;
        roots.add(id);
      }
      bindings.push(Object.freeze({ routeName: binding.routeName, rootObjectIds: Object.freeze([...binding.rootObjectIds]) }));
    }
    const cadBindings = []; let pathCount = 0, pointCount = 0;
    if (cad) {
      if (!array(value.cadBindings) || !value.cadBindings.length || value.cadBindings.length > 100 || value.aggregateId === null) return null;
      for (const binding of value.cadBindings) {
        if (!exact(binding, ['routeName', 'paths']) || typeof binding.routeName !== 'string'
            || !/^\/[A-Z0-9][A-Z0-9_.-]{0,199}$/.test(binding.routeName) || binding.routeName === '/SECONDARY'
            || routes.has(binding.routeName) || requested && !requested.has(binding.routeName.slice(1)) || !array(binding.paths) || !binding.paths.length || binding.paths.length > 128) return null;
        routes.add(binding.routeName); const paths = [];
        for (const path of binding.paths) {
          if (!exact(path, ['pointsMetres', 'widthMetres']) || !array(path.pointsMetres) || path.pointsMetres.length < 2
              || !Number.isFinite(path.widthMetres) || path.widthMetres <= 0 || path.widthMetres > 1000
              || ++pathCount > ROUTING_BINDINGS_LIMITS.cadPaths || (pointCount += path.pointsMetres.length) > ROUTING_BINDINGS_LIMITS.cadPoints
              || !path.pointsMetres.every(point => array(point) && point.length === 3 && point.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9))) return null;
          paths.push(Object.freeze({ widthMetres: path.widthMetres, pointsMetres: Object.freeze(path.pointsMetres.map(point => Object.freeze([...point]))) }));
        }
        cadBindings.push(Object.freeze({ routeName: binding.routeName, paths: Object.freeze(paths) }));
      }
    }
    return Object.freeze({ ...value, bindings: Object.freeze(bindings), ...(cad ? { cadBindings: Object.freeze(cadBindings) } : {}) });
  } catch { return null; }
}
