import { createHash } from 'node:crypto';
import { ENGINE_IDENTITY_VERSION, ENGINE_IDENTITY_POLICY_VERSIONS, engineIdentityBodySchema, engineIdentitySchema, engineIdentityCanonicalBody } from '../../shared/pathfinderEngineIdentity.js';
import { BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS, barrierEngineIdentityBodySchema, barrierEngineIdentitySchema, barrierEngineIdentityCanonicalBody } from '../../shared/pathfinderEngineIdentity.js';
import { BARRIER_RUNTIME_PROFILE, createBarrierRuntimePolicy, type BarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';
import { barrierCanonicalJson, type BarrierModelScope } from '../../shared/pathfinderBarriers.js';

/** Synthetic unit-test identity only. Never imported by admission, dispatch or production fallback. */
export function syntheticEngineIdentity() {
  const body=engineIdentityBodySchema.parse({schemaVersion:'wfc.pf.engine-identity.v1',version:ENGINE_IDENTITY_VERSION,
    runnerSha256:'a'.repeat(64),modelModuleSha256:'b'.repeat(64),coreModuleSha256:'c'.repeat(64),adapterModuleSha256:'d'.repeat(64),
    derivationSha256:'e'.repeat(64),policyVersions:ENGINE_IDENTITY_POLICY_VERSIONS});
  return engineIdentitySchema.parse({...body,contentSha256:createHash('sha256').update(engineIdentityCanonicalBody(body)).digest('hex')});
}
export function syntheticBarrierEngineIdentity() {
  const {schemaVersion:_version,contentSha256:_digest,...legacy}=syntheticEngineIdentity();
  const body=barrierEngineIdentityBodySchema.parse({...legacy,schemaVersion:'wfc.pf.engine-identity.v2',
    barriersModuleSha256:'f'.repeat(64),barrierVerifierModuleSha256:'1'.repeat(64),policyVersions:BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS});
  return barrierEngineIdentitySchema.parse({...body,contentSha256:createHash('sha256').update(barrierEngineIdentityCanonicalBody(body)).digest('hex')});
}
/** Explicit bypass fixture only; no physical geometry/protection is asserted. */
export function syntheticDrillingRuntime(scope:BarrierModelScope):BarrierRuntimeContext {
  const policy=createBarrierRuntimePolicy(true),digest=(value:unknown)=>createHash('sha256').update(barrierCanonicalJson(value)).digest('hex');
  return {schemaVersion:'wfc.pf.barrier-runtime.v1',binding:{scope,registryRevision:'1',snapshot:null,policy,policySha256:digest(policy)},
    profile:structuredClone(BARRIER_RUNTIME_PROFILE),profileSha256:digest(BARRIER_RUNTIME_PROFILE),storage:null};
}
