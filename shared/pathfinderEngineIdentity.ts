import { z } from 'zod';
import { canonicalPurposeJson, policyHashSchema } from './pathfinderPurposePolicy.js';
import { DIRECT_SECONDARY_POLICY } from './pathfinderDirectSecondary.js';

/** Existing Core source label; actual module digests are required independently. */
export const ENGINE_IDENTITY_VERSION = '45c24bf5f433f13e102600b36f20327c77961d0a' as const;
/** Numeric/routing/projection names are newly declared R7 wrapper contracts. */
export const ENGINE_IDENTITY_POLICY_VERSIONS = Object.freeze({
  numeric: 'wfc.pf.binary64-decimal-design.v1',
  routing: 'wfc.pf.core-routing.v1',
  fitting: 'pf2.rules.v1',
  projection: 'wfc.pf.model-runner-v1-projection.v1',
  categoryMapping: 'wfc-mto-v1',
  directSecondary: DIRECT_SECONDARY_POLICY,
} as const);

export const engineIdentityPoliciesSchema = z.object({
  numeric: z.literal(ENGINE_IDENTITY_POLICY_VERSIONS.numeric),
  routing: z.literal(ENGINE_IDENTITY_POLICY_VERSIONS.routing),
  fitting: z.literal(ENGINE_IDENTITY_POLICY_VERSIONS.fitting),
  projection: z.literal(ENGINE_IDENTITY_POLICY_VERSIONS.projection),
  categoryMapping: z.literal(ENGINE_IDENTITY_POLICY_VERSIONS.categoryMapping),
  // Absence is the historical strategy; never insert a default into retained identities.
  directSecondary: z.literal(DIRECT_SECONDARY_POLICY).optional(),
}).strict();

export const engineIdentityBodySchema = z.object({
  schemaVersion: z.literal('wfc.pf.engine-identity.v1'),
  version: z.literal(ENGINE_IDENTITY_VERSION),
  runnerSha256: policyHashSchema,
  modelModuleSha256: policyHashSchema,
  coreModuleSha256: policyHashSchema,
  adapterModuleSha256: policyHashSchema,
  /** Actual calculation-specific TS projection implementation, not drawing/audit code. */
  derivationSha256: policyHashSchema,
  policyVersions: engineIdentityPoliciesSchema,
}).strict();
export const engineIdentitySchema = engineIdentityBodySchema.extend({ contentSha256: policyHashSchema }).strict();
export type EngineIdentityBody = z.infer<typeof engineIdentityBodySchema>;
export type EngineIdentity = z.infer<typeof engineIdentitySchema>;

/** Additive barrier runner identity. Historical v1 bodies/readers above retain
 * their exact four-module fields, policy values and content hashes. */
export const BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS = Object.freeze({ ...ENGINE_IDENTITY_POLICY_VERSIONS,
  projection: 'wfc.pf.model-runner-v2-barrier-projection.v1',
  barriers: 'wfc.pf.triangle-centreline-collision.v1',
  qualification: 'wfc.pf.barrier-verifier.v1',
  constrainedRouting: 'wfc.pf.constrained-tray-routing.v1',
  localConnectors: 'wfc.pf.local-approach-routing.v1',
  runtimeProfile: 'wfc.pf.barrier-runtime-profile.v1',
} as const);
export const barrierEngineIdentityBodySchema = engineIdentityBodySchema.omit({ schemaVersion: true, policyVersions: true }).extend({
  schemaVersion: z.literal('wfc.pf.engine-identity.v2'), barriersModuleSha256: policyHashSchema,
  barrierVerifierModuleSha256: policyHashSchema,
  policyVersions: engineIdentityPoliciesSchema.extend({
    projection: z.literal(BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS.projection), directSecondary: z.literal(DIRECT_SECONDARY_POLICY),
    barriers: z.literal(BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS.barriers), qualification: z.literal(BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS.qualification),
    constrainedRouting: z.literal(BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS.constrainedRouting), localConnectors: z.literal(BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS.localConnectors),
    runtimeProfile: z.literal(BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS.runtimeProfile),
  }).strict(),
}).strict();
export const barrierEngineIdentitySchema = barrierEngineIdentityBodySchema.extend({ contentSha256: policyHashSchema }).strict();
export type BarrierEngineIdentityBody = z.infer<typeof barrierEngineIdentityBodySchema>;
export type BarrierEngineIdentity = z.infer<typeof barrierEngineIdentitySchema>;
export type CalculationEngineIdentity = EngineIdentity | BarrierEngineIdentity;

export function barrierEngineIdentityCanonicalBody(identity: BarrierEngineIdentity | BarrierEngineIdentityBody): string {
  if (Object.prototype.hasOwnProperty.call(identity, 'contentSha256')) {
    const { contentSha256: _digest, ...body } = barrierEngineIdentitySchema.parse(identity);
    return canonicalPurposeJson(body);
  }
  return canonicalPurposeJson(barrierEngineIdentityBodySchema.parse(identity));
}
export function verifyBarrierEngineIdentity(identity: unknown, hashCanonicalString: (value: string) => string): identity is BarrierEngineIdentity {
  const parsed = barrierEngineIdentitySchema.safeParse(identity);
  try { return parsed.success && hashCanonicalString(barrierEngineIdentityCanonicalBody(parsed.data)) === parsed.data.contentSha256; }
  catch { return false; }
}

/** Both creation and verification use exactly this validated, detached body. */
export function engineIdentityContentHashInput(identity: EngineIdentity | EngineIdentityBody): EngineIdentityBody {
  if (Object.prototype.hasOwnProperty.call(identity, 'contentSha256')) {
    const { contentSha256: _digest, ...body } = engineIdentitySchema.parse(identity);
    return body;
  }
  return engineIdentityBodySchema.parse(identity);
}

export function engineIdentityCanonicalBody(identity: EngineIdentity | EngineIdentityBody): string {
  return canonicalPurposeJson(engineIdentityContentHashInput(identity));
}

/** Hash implementation is supplied by the server/browser; this module performs no IO. */
export function verifyEngineIdentity(identity: unknown, hashCanonicalString: (value: string) => string): identity is EngineIdentity {
  const parsed = engineIdentitySchema.safeParse(identity);
  if (!parsed.success) return false;
  try {
    const digest = hashCanonicalString(engineIdentityCanonicalBody(parsed.data));
    return policyHashSchema.safeParse(digest).success && digest === parsed.data.contentSha256;
  } catch { return false; }
}
