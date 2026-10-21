import { describe, expect, it } from 'vitest';
import {
  RECALCULATION_LIMITS, planRecalculationImpact, recalculationCommandCanonicalJson,
  recalculationCommandSchema, recalculationContextSchema, recalculationErrorSchema,
  recalculationReceiptSchema, recalculationReasonSchema, type RecalculationCommand,
  recalculationPreferencesSchema, backgroundRecalculationPreferencesSchema, recalculationDomainSchema,
} from './pathfinderRecalculation.js';
import {
  RECALCULATION_FIXTURE_ACTOR, RECALCULATION_FIXTURE_KEY, recalculationEnableFixture, recalculationFixture,
} from './pathfinderRecalculationFixtures.js';

const enabled = () => recalculationFixture({
  controlRevision: '1', desiredGeneration: '3', enrolledGeneration: '2', enabled: true, status: 'blocked',
  preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60_000,
  authority: { kind: 'current-login', actorId: RECALCULATION_FIXTURE_ACTOR, expiresAt: '2026-01-01T00:30:00.000Z', currentLogin: true },
  reasonCodes: ['ENDPOINT_BINDING_REQUIRED'], total: 3, readyCables: 2, blockedCables: 1,
});
const barrierIntent = (drillThroughWalls = false) => {
  const scope = { projectId: RECALCULATION_FIXTURE_KEY, modelVersionId: RECALCULATION_FIXTURE_ACTOR, contentFingerprint: 'a'.repeat(64),
    selectionRevision: '3', captureFrameId: RECALCULATION_FIXTURE_KEY, captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  return { schemaVersion: 'wfc.pf.barrier-admission-intent.v1' as const, scope, expectedRegistryRevision: '4',
    expectedSnapshot: { snapshotId: RECALCULATION_FIXTURE_KEY, scope, registryRevision: '4', contentSha256: 'c'.repeat(64), mode: 'explicit-empty' as const }, drillThroughWalls };
};

describe('R7 bounded current-login public contracts', () => {
  it('preserves historical preference bytes while binding a complete optional barrier choice', () => {
    const legacy = recalculationEnableFixture(), command = { ...legacy, preferences: { ...legacy.preferences, barrierRouting: barrierIntent() } };
    expect(recalculationPreferencesSchema.parse(legacy.preferences)).not.toHaveProperty('barrierRouting');
    expect(JSON.parse(recalculationCommandCanonicalJson(legacy))).toEqual(legacy);
    expect(recalculationCommandSchema.parse(command)).toEqual(command);
    expect(recalculationCommandCanonicalJson(command)).not.toBe(recalculationCommandCanonicalJson(legacy));
    expect(recalculationDomainSchema.parse('barriers')).toBe('barriers');
  });
  it('allows explicit drilling only in general scoped preferences, refusing background enable without stripping it', () => {
    const preferences = { ...recalculationEnableFixture().preferences, barrierRouting: barrierIntent(true) };
    expect(recalculationPreferencesSchema.parse(preferences).barrierRouting?.drillThroughWalls).toBe(true);
    expect(backgroundRecalculationPreferencesSchema.safeParse(preferences).success).toBe(false);
    expect(recalculationCommandSchema.safeParse({ ...recalculationEnableFixture(), preferences }).success).toBe(false);
    for (const barrierRouting of [null, { ...barrierIntent(), drillThroughWalls: undefined }, { ...barrierIntent(), unexpected: true }])
      expect(recalculationPreferencesSchema.safeParse({ ...preferences, barrierRouting }).success).toBe(false);
  });
  it('distinguishes 30 minute authority from the 30 second coherent collection budget', () => {
    expect(RECALCULATION_LIMITS.authorityMilliseconds).toBe(30 * 60_000);
    expect(RECALCULATION_LIMITS.collectionMilliseconds).toBe(30_000);
    expect(RECALCULATION_LIMITS.cables).toBe(10_000);
    expect(RECALCULATION_LIMITS.neededLocations).toBe(20_000);
    expect(RECALCULATION_LIMITS.dependencyBytes).toBe(32 * 1024 ** 2);
    expect(RECALCULATION_LIMITS.neededLocationBytes).toBe(32 * 1024 ** 2);
    expect(RECALCULATION_LIMITS.cableChunk).toBe(250);
    expect(RECALCULATION_LIMITS.headChunk).toBe(500);
    expect(RECALCULATION_LIMITS.itemQuantum).toBe(1);
  });
  it('keeps a blocked, complete project scope explicit rather than converting it to a successful empty batch', () => {
    const context = enabled();
    expect(context.status).toBe('blocked');
    expect(context.readyCables).toBe(2);
    expect(context.blockedCables).toBe(1);
    expect(context.reasonCodes).toEqual(['ENDPOINT_BINDING_REQUIRED']);
    expect(context.desiredGeneration).toBe('3');
    expect(context.enrolledGeneration).toBe('2');
  });
  it('requires explicit preferences and timeout only on enable', () => {
    const input = recalculationEnableFixture();
    expect(recalculationCommandSchema.parse(input)).toEqual(input);
    const { preferences: _prefs, timeoutMilliseconds: _timeout, ...missing } = input;
    expect(recalculationCommandSchema.safeParse(missing).success).toBe(false);
    for (const action of ['pause', 'resume', 'retry', 'disable'] as const) {
      const command: RecalculationCommand = { schemaVersion: input.schemaVersion, action, expectedControlRevision: '1', idempotencyKey: input.idempotencyKey, reason: input.reason };
      expect(recalculationCommandSchema.parse(command)).toEqual(command);
      expect(recalculationCommandSchema.safeParse({ ...command, preferences: input.preferences }).success).toBe(false);
      expect(recalculationCommandSchema.safeParse({ ...command, timeoutMilliseconds: input.timeoutMilliseconds }).success).toBe(false);
    }
  });
  it('never accepts caller authority, indefinite grants or a silently truncated cable subset', () => {
    for (const extra of [{ actorId: RECALCULATION_FIXTURE_ACTOR }, { loginId: RECALCULATION_FIXTURE_KEY }, { bearer: 'synthetic-not-a-token' }, { expiresAt: '2099-01-01T00:00:00.000Z' }, { cableIds: [RECALCULATION_FIXTURE_KEY] }, { grant: true }]) expect(recalculationCommandSchema.safeParse({ ...recalculationEnableFixture(), ...extra }).success).toBe(false);
    expect(recalculationContextSchema.safeParse({ ...enabled(), authority: { ...enabled().authority, token: 'synthetic-not-a-token' } }).success).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity, -1, 1_000_001])('rejects a nonfinite/out-of-bound secondary distance %s', distance => {
    const input = recalculationEnableFixture();
    expect(recalculationCommandSchema.safeParse({ ...input, preferences: { ...input.preferences, secondaryDistanceMeters: distance } }).success).toBe(false);
  });
  it.each([99, 120_001, 60_000.5, NaN, Infinity])('rejects unsupported timeout %s', timeoutMilliseconds => {
    expect(recalculationCommandSchema.safeParse({ ...recalculationEnableFixture(), timeoutMilliseconds }).success).toBe(false);
  });
  it('refuses partial progress that exceeds its bounded complete scope', () => {
    for (const change of [{ completed: 4 }, { readyCables: 3, blockedCables: 1 }, { total: 10_001 }, { enrolledGeneration: '4' }, { desiredGeneration: '9223372036854775808' }]) expect(recalculationContextSchema.safeParse({ ...enabled(), ...change }).success).toBe(false);
  });
  it('retains a finite other-login identity as display metadata without making it current authority', () => {
    const context = enabled();
    expect(recalculationContextSchema.parse({ ...context, authority: { ...context.authority, currentLogin: false } }).authority?.currentLogin).toBe(false);
    expect(recalculationContextSchema.safeParse({ ...context, authority: { ...context.authority, loginId: RECALCULATION_FIXTURE_KEY } }).success).toBe(false);
  });
  it('preserves exact command identity while canonicalizing member order', () => {
    const a = recalculationEnableFixture(), b = Object.fromEntries(Object.entries(a).reverse()) as RecalculationCommand;
    expect(recalculationCommandCanonicalJson(a)).toBe(recalculationCommandCanonicalJson(b));
    expect(recalculationCommandCanonicalJson({ ...a, reason: a.reason + ' ' })).not.toBe(recalculationCommandCanonicalJson(a));
  });
  it('allows historical replay context without pretending it is a fresh control revision', () => {
    const historical = { schemaVersion: 'wfc.pf.recalculation-command-receipt.v1', duplicate: true, context: recalculationFixture() };
    expect(recalculationReceiptSchema.parse(historical).context.controlRevision).toBe('0');
    expect(enabled().controlRevision).toBe('1');
  });
  it('keeps unknown outcomes distinct from definite refusal', () => {
    const error = { schemaVersion: 'wfc.pf.recalculation-error.v1', code: 'RECALCULATION_COMMIT_OUTCOME_UNKNOWN', message: 'Keep the exact command and reconcile current state.', outcome: 'unknown', currentControlRevision: null };
    expect(recalculationErrorSchema.parse(error).outcome).toBe('unknown');
    expect(recalculationErrorSchema.safeParse({ ...error, outcome: 'success' }).success).toBe(false);
  });
  it('rejects escaped control/surrogate reason text and noncanonical scalar endings', () => {
    for (const reason of ['', '  ', 'bad\nreason', '\ud800']) expect(recalculationCommandSchema.safeParse({ ...recalculationEnableFixture(), reason }).success).toBe(false);
    for (const change of [{ expectedControlRevision: '1\n' }, { idempotencyKey: RECALCULATION_FIXTURE_KEY + '\n' }, { expectedControlRevision: '01' }]) expect(recalculationCommandSchema.safeParse({ ...recalculationEnableFixture(), ...change }).success).toBe(false);
    expect(recalculationReasonSchema.safeParse('MODEL_CHANGED\n').success).toBe(false);
  });
  it('uses explicit unique opcode reasons and requires preferences/timeouts together', () => {
    expect(recalculationContextSchema.safeParse({ ...enabled(), reasonCodes: ['ENDPOINT_BINDING_REQUIRED', 'ENDPOINT_BINDING_REQUIRED'] }).success).toBe(false);
    expect(recalculationContextSchema.safeParse({ ...enabled(), preferences: null }).success).toBe(false);
    expect(recalculationContextSchema.safeParse({ ...enabled(), timeoutMilliseconds: null }).success).toBe(false);
    expect(recalculationContextSchema.safeParse({ ...enabled(), paused: true, enabled: false }).success).toBe(false);
  });
});

describe('conservative engineering impact planning only', () => {
  it('ignores drawing layout, bbox declared-length and full audit refreshes as PF scheduling inputs', () => {
    expect(planRecalculationImpact(['drawing-only', 'declared-length-only'])).toEqual({ schedule: false, scope: 'none', mode: null });
  });
  it('offers only a design candidate for allowance changes; it does not authorize route reuse', () => {
    expect(planRecalculationImpact(['allowances-only', 'drawing-only', 'allowances-only'])).toEqual({ schedule: true, scope: 'all-project-ready', mode: 'design-only-candidate' });
  });
  it.each(['model', 'geometry', 'routing', 'endpoints', 'gap', 'preferences', 'cables', 'engine', 'manual', 'unknown'] as const)('%s forces full conservative routing even when mixed with allowances', change => {
    expect(planRecalculationImpact(['allowances-only', change])).toEqual({ schedule: true, scope: 'all-project-ready', mode: 'full-route' });
  });
  it('does not narrow new-shortcut or uncertain reachability impact to previously traversed routes', () => {
    expect(planRecalculationImpact(['routing']).scope).toBe('all-project-ready');
    expect(planRecalculationImpact(['unknown']).scope).toBe('all-project-ready');
  });
  it('does not mutate source event ordering or silently trim an excessive event set', () => {
    const input = ['drawing-only', 'routing'] as const;
    planRecalculationImpact(input);
    expect(input).toEqual(['drawing-only', 'routing']);
    expect(() => planRecalculationImpact(Array.from({ length: 10_001 }, () => 'routing' as const))).toThrow();
  });
});
