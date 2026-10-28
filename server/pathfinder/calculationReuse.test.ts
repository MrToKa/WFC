// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ENGINE_IDENTITY_POLICY_VERSIONS, ENGINE_IDENTITY_VERSION, engineIdentityContentHashInput } from '../../shared/pathfinderEngineIdentity.js';
import { geometryHash, hash, verifiedDesignOnlyChange } from './dependencies.js';
import { defaultOptions, type ComparisonDependencySnapshot, type CurrentDependencySnapshot } from './jobContracts.js';

const id = (n: number) => `ec000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
/** Synthetic v5 snapshots only; no retained route or mathematical output is fabricated. */
function fixture(): CurrentDependencySnapshot {
  const engineBody = { schemaVersion: 'wfc.pf.engine-identity.v1' as const, version: ENGINE_IDENTITY_VERSION, runnerSha256: '1'.repeat(64), modelModuleSha256: '2'.repeat(64), coreModuleSha256: '3'.repeat(64), adapterModuleSha256: '4'.repeat(64), derivationSha256: '5'.repeat(64), policyVersions: { ...ENGINE_IDENTITY_POLICY_VERSIONS } };
  const endpoint = (n: number) => ({ locationId: id(n), locationRevision: '2', bindingRevision: '3', point: [1, 2, 3] as [number, number, number], bindingId: id(n + 10), bindingContentSha256: 'b'.repeat(64), mode: 'fixed-world' as const, captureFrameId: id(5), qualifiedProjectFrameId: null, aggregateId: id(4), projectionSha256: 'd'.repeat(64), sourceObjectRevisionId: null, migrationDecisionId: null });
  return { schemaVersion: 'pathfinder.dependencies.v5', projectId: id(1), cableId: id(8), cableWriteRevision: '4', cableInputs: { fromLocation: 'From', toLocation: 'To', mto: 'Instrumentation', cableTypeId: id(9) }, registryRevision: '7',
    routing: { catalogRevision: '2', routingContentSha256: 'e'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'f'.repeat(64) }, model: { id: id(2), selectionRevision: '1', contentFingerprint: 'c'.repeat(64) }, artifact: { id: id(3), sha256: 'd'.repeat(64) },
    preparation: { aggregateId: id(4), geometryRevision: '2', captureFrameId: id(5), projectionSha256: 'd'.repeat(64) }, comparison: { comparisonId: id(90), comparisonRevision: '4', sourceAggregateId: id(91), targetAggregateId: id(4), decisionSetSha256: '6'.repeat(64), contentSha256: '7'.repeat(64) },
    settings: { revision: '3', connectionGap: '1', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' }, options: { ...defaultOptions, connectionToleranceMeters: 1 }, from: endpoint(6), to: endpoint(7), engineVersion: 'pathfinder-45c24bf5-pf1-modelrunner-v1', engineIdentity: { ...engineBody, contentSha256: hash(engineBody) } };
}
const allowances = (source: CurrentDependencySnapshot): CurrentDependencySnapshot => ({ ...structuredClone(source), settings: { ...source.settings, revision: '4', additionalBendingPercent: '11' } });

describe('exact v5 design-only admission predicate, not C# design execution', () => {
  it.each(['secondaryTrayLength', 'endConnectionLength', 'additionalBendingPercent'] as const)('allows only a %s allowance change with unchanged routing authority', field => {
    const previous = fixture(), current = structuredClone(previous); current.settings = { ...current.settings, revision: '4', [field]: '12' };
    expect(verifiedDesignOnlyChange(current, previous)).toBe(true); expect(geometryHash(current)).toBe(geometryHash(previous)); expect(hash(current)).not.toBe(hash(previous));
    expect(previous.settings.revision).toBe('3'); expect(previous.settings.additionalBendingPercent).toBe('10');
  });
  it('does not call an unchanged settings snapshot or a revision-only settings write design-only work', () => {
    const previous = fixture(); expect(verifiedDesignOnlyChange(previous, structuredClone(previous))).toBe(false); expect(verifiedDesignOnlyChange({ ...previous, settings: { ...previous.settings, revision: '4' } }, previous)).toBe(false);
  });
  it('never upgrades historical v4 provenance to a current design-reuse proof', () => {
    const current = allowances(fixture()), { schemaVersion: _v5, engineIdentity: _engine, ...historyBody } = fixture(), historical: ComparisonDependencySnapshot = { ...historyBody, schemaVersion: 'pathfinder.dependencies.v4' };
    expect(verifiedDesignOnlyChange(current, historical)).toBe(false); expect(verifiedDesignOnlyChange(historical, current)).toBe(false); expect(geometryHash(historical)).not.toBe(geometryHash(current));
  });
  it.each(['cableWriteRevision', 'registryRevision'] as const)('requires a new route after %s even if restored input values yield the same functional path hash', field => {
    const previous = fixture(), current = allowances(previous); current[field] = '99'; expect(verifiedDesignOnlyChange(current, previous)).toBe(false); expect(hash(current)).not.toBe(hash(previous));
  });
  it('requires a route for connection gap change and keeps the actual gap in supported options', () => {
    const previous = fixture(), current = allowances(previous); current.settings.connectionGap = '2'; current.options.connectionToleranceMeters = 2;
    expect(verifiedDesignOnlyChange(current, previous)).toBe(false); expect(geometryHash(current)).not.toBe(geometryHash(previous));
  });
  it.each(['preferVerticalApproach', 'secondaryDistanceMeters', 'sampleSpacingMeters', 'maxGraphNodes'] as const)('refuses changed %s preferences in a design-only request', field => {
    const previous = fixture(), current = allowances(previous); if (field === 'preferVerticalApproach') current.options[field] = !current.options[field]; else current.options[field] += 1;
    expect(verifiedDesignOnlyChange(current, previous)).toBe(false); expect(geometryHash(current)).not.toBe(geometryHash(previous));
  });
  it.each(['from', 'to'] as const)('retains exact %s point/mode/evidence authority even at identical raw coordinates', end => {
    const previous = fixture(), current = allowances(previous); current[end].bindingRevision = '4'; current[end].bindingId = id(100); current[end].bindingContentSha256 = 'a'.repeat(64);
    expect(current[end].point).toEqual(previous[end].point); expect(verifiedDesignOnlyChange(current, previous)).toBe(false); expect(geometryHash(current)).not.toBe(geometryHash(previous));
  });
  it.each(['runnerSha256', 'modelModuleSha256', 'coreModuleSha256', 'adapterModuleSha256', 'derivationSha256'] as const)('same label with changed %s forbids reuse and changes functional geometry identity', field => {
    const previous = fixture(), current = allowances(previous); current.engineIdentity[field] = 'a'.repeat(64); current.engineIdentity.contentSha256 = hash(engineIdentityContentHashInput(current.engineIdentity));
    expect(current.engineVersion).toBe(previous.engineVersion); expect(verifiedDesignOnlyChange(current, previous)).toBe(false); expect(geometryHash(current)).not.toBe(geometryHash(previous));
  });
  it.each(['model', 'artifact', 'preparation', 'routing', 'comparison', 'cable-input'] as const)('does not hide changed %s authority inside allowance-only work', field => {
    const previous = fixture(), current = allowances(previous);
    if (field === 'model') current.model.selectionRevision = '2'; if (field === 'artifact') current.artifact.id = id(103); if (field === 'preparation') current.preparation.geometryRevision = '3';
    if (field === 'routing') current.routing.routingPolicyRevision = '4'; if (field === 'comparison' && current.comparison) current.comparison.comparisonRevision = '5'; if (field === 'cable-input') current.cableInputs.mto = 'LV';
    expect(verifiedDesignOnlyChange(current, previous)).toBe(false); expect(geometryHash(current)).not.toBe(geometryHash(previous));
  });
  it('keeps drawing/full-catalog audit facts outside the explicit functional path projection', () => {
    const previous = fixture(), auditOnly = structuredClone(previous); Object.assign(auditOnly.routing, { drawingInputRevision: '99', drawingPolicyRevision: '9', catalogContentSha256: 'a'.repeat(64), sourceProjectionSha256: 'b'.repeat(64), dependencyFactsSha256: 'c'.repeat(64) });
    expect(geometryHash(auditOnly)).toBe(geometryHash(previous));
    // This malformed extra evidence is not promoted to authority by the reuse predicate.
    expect(verifiedDesignOnlyChange(allowances(auditOnly), previous)).toBe(false);
  });
});
