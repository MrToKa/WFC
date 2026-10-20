import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ENGINE_IDENTITY_POLICY_VERSIONS, ENGINE_IDENTITY_VERSION, engineIdentityBodySchema,
  engineIdentityCanonicalBody, engineIdentityContentHashInput, engineIdentitySchema,
  verifyEngineIdentity, type EngineIdentity, type EngineIdentityBody,
} from './pathfinderEngineIdentity.js';

// Synthetic module digests exercise the contract only; they are not observed DLLs.
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const body = (): EngineIdentityBody => ({
  schemaVersion: 'wfc.pf.engine-identity.v1', version: ENGINE_IDENTITY_VERSION,
  runnerSha256: '1'.repeat(64), modelModuleSha256: '2'.repeat(64), coreModuleSha256: '3'.repeat(64),
  adapterModuleSha256: '4'.repeat(64), derivationSha256: '5'.repeat(64), policyVersions: { ...ENGINE_IDENTITY_POLICY_VERSIONS },
});
const complete = (input = body()): EngineIdentity => ({ ...input, contentSha256: sha(engineIdentityCanonicalBody(input)) });

describe('R7 exact engine implementation identity', () => {
  it('accepts the explicit current policy and exact five implementation digests', () => {
    expect(engineIdentitySchema.parse(complete())).toEqual(complete());
    expect(verifyEngineIdentity(complete(), sha)).toBe(true);
  });
  it('uses the same detached canonical body for creation and verification', () => {
    const value = complete(), projected = engineIdentityContentHashInput(value);
    expect(projected).toEqual(body());
    expect(engineIdentityCanonicalBody(value)).toBe(engineIdentityCanonicalBody(projected));
    expect(projected).not.toBe(value);
    expect(Object.hasOwn(projected, 'contentSha256')).toBe(false);
  });
  it.each(['runnerSha256', 'modelModuleSha256', 'coreModuleSha256', 'adapterModuleSha256', 'derivationSha256'] as const)('refuses unchanged labels with a changed %s and an old content hash', field => {
    const previous = complete(), changed = { ...previous, [field]: 'a'.repeat(64) };
    expect(changed.version).toBe(previous.version);
    expect(engineIdentitySchema.safeParse(changed).success).toBe(true);
    expect(verifyEngineIdentity(changed, sha)).toBe(false);
    const { contentSha256: _hash, ...changedBody } = changed;
    expect(complete(changedBody).contentSha256).not.toBe(previous.contentSha256);
  });
  it.each(['numeric', 'routing', 'fitting', 'projection', 'categoryMapping', 'directSecondary'] as const)('rejects unsupported %s policy rather than silently relabelling it', field => {
    const input = body();
    expect(engineIdentityBodySchema.safeParse({ ...input, policyVersions: { ...input.policyVersions, [field]: 'unrecognized.v2' } }).success).toBe(false);
  });
  it('preserves an old absent strategy without changing its canonical bytes or hash', () => {
    const current = body(), { directSecondary: _policy, ...historicalPolicies } = current.policyVersions;
    const historical = { ...current, policyVersions: historicalPolicies };
    const value = complete(historical), parsed = engineIdentitySchema.parse(value);
    expect(Object.hasOwn(parsed.policyVersions, 'directSecondary')).toBe(false);
    expect(engineIdentityCanonicalBody(parsed)).toBe(engineIdentityCanonicalBody(historical));
    expect(verifyEngineIdentity(parsed, sha)).toBe(true);
    expect(value.contentSha256).not.toBe(complete(current).contentSha256);
    expect(engineIdentitySchema.safeParse({ ...value, policyVersions: current.policyVersions }).success).toBe(true);
    expect(verifyEngineIdentity({ ...value, policyVersions: current.policyVersions }, sha)).toBe(false);
  });
  it.each(['runnerSha256', 'modelModuleSha256', 'coreModuleSha256', 'adapterModuleSha256', 'derivationSha256', 'contentSha256'] as const)('requires absolute canonical lowercase SHA in %s', field => {
    for (const invalid of ['a'.repeat(64) + '\n', 'A'.repeat(64), 'a'.repeat(63), ' a'.repeat(32)]) expect(engineIdentitySchema.safeParse({ ...complete(), [field]: invalid }).success).toBe(false);
  });
  it('rejects the old label alone and the R4 trace fingerprint as a calculation identity', () => {
    expect(engineIdentitySchema.safeParse({ version: ENGINE_IDENTITY_VERSION }).success).toBe(false);
    expect(engineIdentitySchema.safeParse({ ...body(), policyVersions: undefined }).success).toBe(false);
    expect(engineIdentitySchema.safeParse({ ...complete(), traceContentSha256: 'f'.repeat(64) }).success).toBe(false);
  });
  it('excludes its own content digest and rejects unapproved transitive audit/drawing inputs', () => {
    expect(engineIdentityCanonicalBody(complete())).not.toContain('contentSha256');
    for (const extra of [{ drawingInputRevision: '8' }, { catalogContentSha256: 'f'.repeat(64) }, { modulePath: '/caller/engine.dll' }, { bearer: 'synthetic-never-a-credential' }]) expect(engineIdentitySchema.safeParse({ ...complete(), ...extra }).success).toBe(false);
  });
  it('returns false on a bad hash implementation without exposing a partial identity', () => {
    expect(verifyEngineIdentity(complete(), () => 'A'.repeat(64))).toBe(false);
    expect(verifyEngineIdentity(complete(), () => { throw Error('Synthetic hash refusal'); })).toBe(false);
    expect(verifyEngineIdentity(null, sha)).toBe(false);
  });
  it('does not change numerical/source label policy when merely hashing the identity', () => {
    const value = body(), original = structuredClone(value);
    engineIdentityCanonicalBody(value);
    expect(value).toEqual(original);
    expect(value.policyVersions.fitting).toBe('pf2.rules.v1');
    expect(value.policyVersions.categoryMapping).toBe('wfc-mto-v1');
  });
});
