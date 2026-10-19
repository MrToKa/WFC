// Model-name adapter only. Project location/alias identity remains unchanged.
export const EQUIPMENT_NAME_MATCHING_POLICY = 'wfc.pf.equipment-model-leading-slash.v1';

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
