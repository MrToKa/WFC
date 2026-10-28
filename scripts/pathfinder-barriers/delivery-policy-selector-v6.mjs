// Explicit v6 selection only. No SQL, Docker, startup or mutation at import/call.
import * as conservation from './migration-conservation-v6.mjs';

export const POST_B27_AUTOMATIC_PAIR_V6 = 'post-b27-automatic-pair-additive-v6';
const selected = Object.freeze({
  schemaVersion: 'wfc.pf.delivery-policy-selection.v1', profile: POST_B27_AUTOMATIC_PAIR_V6,
  qualifierFilename: 'migration-conservation-v6.mjs',
  qualifier: Object.freeze({ qualifyMigrationInventories: conservation.qualifyMigrationInventories,
    qualifyRuntimeInventories: conservation.qualifyRuntimeInventories, assertQualificationReceipt: conservation.assertQualificationReceipt }),
});
export function selectDeliveryPolicy(value) {
  const keys = value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? Reflect.ownKeys(value) : [];
  const exact = keys.length === 2 && ['schemaVersion', 'profile'].every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
  if (arguments.length !== 1 || !exact || value.schemaVersion !== selected.schemaVersion || value.profile !== POST_B27_AUTOMATIC_PAIR_V6)
    throw Object.assign(Error('V6_EXPLICIT_POLICY_REQUIRED'), { code: 'V6_EXPLICIT_POLICY_REQUIRED' });
  return selected;
}
