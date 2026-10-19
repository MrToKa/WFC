import { z } from 'zod';
import { canonicalPurposeJson, policyHashSchema } from './pathfinderPurposePolicy.js';

/** Existing Core source label; actual module digests are required independently. */
export const ENGINE_IDENTITY_VERSION = '45c24bf5f433f13e102600b36f20327c77961d0a' as const;
/** Numeric/routing/projection names are newly declared R7 wrapper contracts. */
export const ENGINE_IDENTITY_POLICY_VERSIONS = Object.freeze({
  numeric: 'wfc.pf.binary64-decimal-design.v1',
  routing: 'wfc.pf.core-routing.v1',
  fitting: 'pf2.rules.v1',
  projection: 'wfc.pf.model-runner-v1-projection.v1',
  categoryMapping: 'wfc-mto-v1',
} as const);

export const engineIdentityPoliciesSchema = z.object({
  numeric: z.literal(ENGINE_IDENTITY_POLICY_VERSIONS.numeric),
  routing: z.literal(ENGINE_IDENTITY_POLICY_VERSIONS.routing),
  fitting: z.literal(ENGINE_IDENTITY_POLICY_VERSIONS.fitting),
  projection: z.literal(ENGINE_IDENTITY_POLICY_VERSIONS.projection),
  categoryMapping: z.literal(ENGINE_IDENTITY_POLICY_VERSIONS.categoryMapping),
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
