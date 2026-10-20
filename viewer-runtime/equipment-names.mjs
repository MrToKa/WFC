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
      return descriptor && (descriptor.get || descriptor.set || descriptor.value !== false && descriptor.value !== undefined);
    }) || ['displayCategory', 'category', 'attributeName', 'displayName', 'name'].some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(property, key);
      return descriptor && (descriptor.get || descriptor.set) || internal(own(property, key));
    })) continue;
    const display = Object.getOwnPropertyDescriptor(property, 'displayValue'), value = display ? own(property, 'displayValue') : own(property, 'value');
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) values.push(String(value));
  }
  return values;
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
