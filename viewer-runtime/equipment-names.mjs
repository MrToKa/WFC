// Model-name adapter only. Project location/alias identity remains unchanged.
export const EQUIPMENT_NAME_MATCHING_POLICY = 'wfc.pf.equipment-model-leading-slash.v1';

const own = (value, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && !descriptor.get && !descriptor.set ? descriptor.value : undefined;
};
const internal = value => typeof value === 'string' && /^__(?:child|parent|ref|reference|internal|instanceof|viewable_in|externalref|dbid|node_flags)__$/i.test(value.trim());
/** Read only an object's own human scalar properties. SDK structural links,
 * explicitly hidden/internal rows, containers and accessors are not evidence.
 * Custom human labels are deliberately unrestricted. Normalization belongs to
 * modelEquipmentMatchKeys, identically for SDK and canonical snapshot values.
 */
export function humanScalarPropertyValues(properties) {
  if (!Array.isArray(properties)) return [];
  const values = [];
  for (const property of properties) {
    if (!property || typeof property !== 'object' || Array.isArray(property) || ![Object.prototype, null].includes(Object.getPrototypeOf(property))) continue;
    if (['hidden', 'isHidden', 'isInternal'].some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(property, key);
      return descriptor && (descriptor.get || descriptor.set || descriptor.value !== false && descriptor.value !== 0 && descriptor.value !== undefined);
    }) || ['displayCategory', 'category', 'attributeName', 'displayName', 'name'].some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(property, key);
      return descriptor && (descriptor.get || descriptor.set) || internal(own(property, key));
    })) continue;
    const display = Object.getOwnPropertyDescriptor(property, 'displayValue'), value = display ? own(property, 'displayValue') : own(property, 'value');
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) values.push(String(value));
  }
  return values;
}

/** Item GUID and source identify parts of the same source object, never a Tag
 * alone. Keep raw model IDs separate; the host retains every candidate and its
 * visibility/bounds before deciding whether a complete group is assignable.
 */
export function equipmentObjectIdentity(properties) {
  if (!Array.isArray(properties)) return null;
  const guids = new Set(), sources = new Set(); let invalid = false;
  const key = value => typeof value === 'string' ? value.normalize('NFKC').replace(/[\s_.-]/g, '').toLowerCase() : '';
  for (const property of properties) {
    if (!property || typeof property !== 'object' || Array.isArray(property) || ![Object.prototype, null].includes(Object.getPrototypeOf(property))) continue;
    if (['displayCategory', 'category'].some(name => internal(own(property, name)))) continue;
    const labels = ['displayName', 'attributeName', 'name'].map(name => key(own(property, name)));
    // SDK categories are exporter/localization text, not a stable Item label.
    const itemGuid = labels.some(name => ['guid', 'globalid', 'ifcguid'].includes(name));
    const sourceFile = labels.some(name => ['sourcefile', 'sourcefilename', 'quelldatei'].includes(name));
    if (!itemGuid && !sourceFile) continue;
    const descriptor = Object.getOwnPropertyDescriptor(property, 'displayValue') ?? Object.getOwnPropertyDescriptor(property, 'value');
    const value = descriptor && !descriptor.get && !descriptor.set ? descriptor.value : undefined;
    if (typeof value !== 'string') { invalid = true; continue; }
    if (itemGuid) {
      const normalized = value.normalize('NFC').trim().replace(/^\{(.*)\}$/, '$1').toLowerCase();
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(normalized)) invalid = true;
      else guids.add(normalized);
    }
    if (sourceFile) {
      const normalized = value.normalize('NFC').trim().replaceAll('\\', '/').toLowerCase();
      if (!normalized || normalized.length > 1024 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) invalid = true;
      else sources.add(normalized);
    }
  }
  return !invalid && guids.size === 1 && sources.size === 1 ? { guid: [...guids][0], sourceFile: [...sources][0] } : null;
}

/** Preserve the exact normalized model key and one explicit SVF decoration.
 * Never interpret internal/trailing slashes, repeated leading slashes, numeric
 * suffixes or engineering punctuation as equivalent project identities.
 */
export function modelEquipmentMatchKeys(value) {
  const exact = String(value ?? '').normalize('NFC').trim().toUpperCase();
  if (!exact) return [];
  return exact.startsWith('/') && exact.length > 1 && exact[1] !== '/'
    ? [exact, exact.slice(1)]
    : [exact];
}
