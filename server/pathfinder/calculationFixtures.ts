import { createHash } from 'node:crypto';
import { ENGINE_IDENTITY_VERSION, ENGINE_IDENTITY_POLICY_VERSIONS, engineIdentityBodySchema, engineIdentitySchema, engineIdentityCanonicalBody } from '../../shared/pathfinderEngineIdentity.js';

/** Synthetic unit-test identity only. Never imported by admission, dispatch or production fallback. */
export function syntheticEngineIdentity() {
  const body=engineIdentityBodySchema.parse({schemaVersion:'wfc.pf.engine-identity.v1',version:ENGINE_IDENTITY_VERSION,
    runnerSha256:'a'.repeat(64),modelModuleSha256:'b'.repeat(64),coreModuleSha256:'c'.repeat(64),adapterModuleSha256:'d'.repeat(64),
    derivationSha256:'e'.repeat(64),policyVersions:ENGINE_IDENTITY_POLICY_VERSIONS});
  return engineIdentitySchema.parse({...body,contentSha256:createHash('sha256').update(engineIdentityCanonicalBody(body)).digest('hex')});
}
