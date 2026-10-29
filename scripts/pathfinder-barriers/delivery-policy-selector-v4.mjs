// Explicit policy selection only. No Docker, SQL, HTTP or mutation at import/call.
import * as conservation from './migration-conservation-v4.mjs';

export const POST_B9_NO_DDL_V4 = 'post-b9-no-ddl-conservation-v4';
const selected = Object.freeze({
  schemaVersion: 'wfc.pf.delivery-policy-selection.v1',
  profile: POST_B9_NO_DDL_V4,
  qualifierFilename: 'migration-conservation-v4.mjs',
  qualifier: Object.freeze({
    qualifyMigrationInventories: conservation.qualifyMigrationInventories,
    qualifyRuntimeInventories: conservation.qualifyRuntimeInventories,
    assertQualificationReceipt: conservation.assertQualificationReceipt,
  }),
});

/** There is no default, old-B9 fallback, caller path, override or relaxed mode. */
export function selectDeliveryPolicy(value) {
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype ? Reflect.ownKeys(value) : [];
  const exact = keys.length === 2 && ['schemaVersion', 'profile'].every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
  if (arguments.length !== 1 || !exact || value.schemaVersion !== selected.schemaVersion || value.profile !== POST_B9_NO_DDL_V4) {
    throw Object.assign(Error('V4_EXPLICIT_POLICY_REQUIRED'), { code: 'V4_EXPLICIT_POLICY_REQUIRED' });
  }
  return selected;
}
