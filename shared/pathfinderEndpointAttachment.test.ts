import { describe, expect, it } from 'vitest';
import { deriveEndpointLocalPoint, deriveEquipmentBottomAnchor, evaluateEndpointMigration, transformEndpointPoint, validateEndpointRigidTransform } from './pathfinderEndpointAttachment.js';
import { endpointBindingFixture, endpointMigrationFixture, endpointTestId, endpointTestMatrix } from './pathfinderEndpointFixtures.js';

describe('pure explicitly qualified synthetic attachment mechanics', () => {
  it('rotates/translates a retained local point once without modifying frozen inputs or granting confirmation', () => {
    const f = endpointMigrationFixture(), before = structuredClone(f), result = evaluateEndpointMigration(f);
    expect(result).toMatchObject({ disposition: 'carried-rigid', status: 'suggested', targetPointProjectMetres: [8, 22, 34], displacementVectorMetres: [5, 20, 30], requiresConfirmation: true });
    expect(result.proposal?.attachment?.localPointMetres).toEqual([2, 2, 4]); expect(f).toEqual(before);
    expect(result.evidenceIds).toContain(f.targetObject!.qualifiedAttachment!.id);
  });
  it('fixed-world ignores moving object placement when the reviewed common frame remains identical', () => {
    const f = endpointMigrationFixture('fixed-world'); f.objectMapping = null; f.sourceObject = null; f.targetObject = null;
    expect(evaluateEndpointMigration(f)).toMatchObject({ disposition: 'carried-fixed', targetPointProjectMetres: f.sourceBinding.pointProjectMetres, displacementMetres: 0 });
  });
  it('changes coordinates only once under a reviewed capture-frame mapping, independently of object motion', () => {
    const f = endpointMigrationFixture('fixed-world'); f.frameMapping!.sourceCaptureToTargetCaptureMetres = endpointTestMatrix([100, 0, 0]);
    expect(evaluateEndpointMigration(f)).toMatchObject({ sourcePointProjectMetres: [3, 2, 4], sourcePointInTargetFrameMetres: [103, 2, 4], targetPointProjectMetres: [103, 2, 4], displacementVectorMetres: [0, 0, 0], displacementMetres: 0 });
  });
  it('qualified rotated-frame displacement compares normalized source coordinates rather than raw frame components', () => {
    const f = endpointMigrationFixture(); f.frameMapping!.sourceCaptureToTargetCaptureMetres = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(evaluateEndpointMigration(f)).toMatchObject({ sourcePointProjectMetres: [3, 2, 4], sourcePointInTargetFrameMetres: [-2, 3, 4], targetPointProjectMetres: [8, 22, 34], displacementVectorMetres: [10, 19, 30], displacementMetres: Math.hypot(10, 19, 30) });
  });
  it('inverse-transforms a picked world point using the reviewed rigid basis', () => {
    const f = endpointMigrationFixture(), evidence = f.targetObject!.qualifiedAttachment!, world: [number, number, number] = [8, 22, 34];
    const local = deriveEndpointLocalPoint(evidence, world, f.validationPolicy); expect(local).toEqual([2, 2, 4]); expect(transformEndpointPoint(evidence.objectLocalToProjectMetres, local)).toEqual(world);
  });
  it('rederives an explicitly approximate bottom-AABB anchor from the exact unique target', () => {
    const f = endpointMigrationFixture('object-derived'); expect(evaluateEndpointMigration(f)).toMatchObject({ disposition: 'rederived', targetPointProjectMetres: [25, 35, 40], proposal: { derivation: 'equipment-bottom-aabb.v1', sourceObject: f.targetObject!.reference } });
    expect(deriveEquipmentBottomAnchor({ minimum: [1, 2, 3], maximum: [5, 8, 9] })).toEqual([3, 5, 3]);
  });
  it('two unknown shape signatures never prove unchanged geometry', () => {
    const f = endpointMigrationFixture('object-derived'); f.sourceObject!.intrinsicShapeSha256 = null; f.targetObject!.intrinsicShapeSha256 = null; f.sourceObject!.worldRepresentationSha256 = null; f.targetObject!.worldRepresentationSha256 = null;
    expect(evaluateEndpointMigration(f)).toMatchObject({ disposition: 'suggested-review', targetPointProjectMetres: null, reasonCodes: ['SHAPE_CHANGE_OR_UNKNOWN_REQUIRES_REVIEW'] });
  });
  it('changed shape at the same AABB requires review instead of silently deriving a new confirmed endpoint', () => {
    const f = endpointMigrationFixture('object-derived'); f.targetObject!.bounds = structuredClone(f.sourceObject!.bounds); f.targetObject!.intrinsicShapeSha256 = '0'.repeat(64);
    expect(evaluateEndpointMigration(f).disposition).toBe('suggested-review');
  });
  it.each(['scale', 'shear', 'reflection', 'singular', 'ill-conditioned', 'perspective', 'nan'] as const)('refuses %s rather than qualifying a transform', kind => {
    const f = endpointMigrationFixture(), matrix = endpointTestMatrix();
    if (kind === 'scale') matrix[0] = 2; if (kind === 'shear') matrix[4] = .5; if (kind === 'reflection') matrix[0] = -1; if (kind === 'singular') matrix[0] = 0; if (kind === 'ill-conditioned') matrix[0] = 1e-12; if (kind === 'perspective') matrix[3] = .1; if (kind === 'nan') matrix[12] = NaN;
    expect(validateEndpointRigidTransform(matrix, f.validationPolicy).supported).toBe(false);
  });
  it.each(['frame', 'review', 'common-id', 'frame-scope', 'policy', 'source-unconfirmed'] as const)('retains unsupported/stale state for missing %s evidence', kind => {
    const f = endpointMigrationFixture(); if (kind === 'frame') f.frameMapping = null; if (kind === 'review') f.frameMapping!.qualification = 'unverified'; if (kind === 'common-id') f.frameMapping!.qualifiedProjectFrameId = endpointTestId(99); if (kind === 'frame-scope') f.frameMapping!.sourceCaptureFrameId = endpointTestId(99); if (kind === 'policy') f.validationPolicy = null; if (kind === 'source-unconfirmed') f.sourceBinding.status = 'stale';
    const r = evaluateEndpointMigration(f); expect(r.targetPointProjectMetres).toBeNull(); expect(r.requiresConfirmation).toBe(true); expect(r.status).not.toBe('confirmed');
  });
  it.each(['missing', 'ambiguous', 'split', 'merged', 'replaced', 'deformed', 'connector-missing'] as const)('preserves %s mapping disposition without selecting/averaging candidates', disposition => {
    const f = endpointMigrationFixture(); f.objectMapping!.disposition = disposition; if (disposition === 'ambiguous') f.objectMapping!.targetObjectRevisionIds.push(endpointTestId(99));
    const r = evaluateEndpointMigration(f); expect(r.disposition).toBe(disposition); expect(r.targetPointProjectMetres).toBeNull(); expect(r.candidateObjectRevisionIds).toEqual(f.objectMapping!.targetObjectRevisionIds);
  });
  it.each(['candidate', 'foreign-project', 'foreign-old-id', 'foreign-new-id', 'foreign-frame'] as const)('refuses %s ownership/identity evidence', kind => {
    const f = endpointMigrationFixture(); if (kind === 'candidate') f.objectMapping!.qualification = 'candidate-only'; if (kind === 'foreign-project') f.targetObject!.projectId = endpointTestId(99); if (kind === 'foreign-old-id') f.sourceObject!.reference.objectRevisionId = endpointTestId(99); if (kind === 'foreign-new-id') f.targetObject!.reference.objectRevisionId = endpointTestId(99); if (kind === 'foreign-frame') f.targetObject!.captureFrameId = endpointTestId(99);
    expect(evaluateEndpointMigration(f).targetPointProjectMetres).toBeNull();
  });
  it.each(['basis', 'logical', 'document', 'instance', 'entity', 'shape', 'deformation', 'source-point', 'target-transform'] as const)('refuses %s attachment evidence without a nearest/name/dbId fallback', kind => {
    const f = endpointMigrationFixture(), target = f.targetObject!.qualifiedAttachment!;
    if (kind === 'basis') f.targetObject!.qualifiedAttachment = null; if (kind === 'logical') target.logicalObjectId = endpointTestId(99); if (kind === 'document') target.sourceDocumentId = 'another-document'; if (kind === 'instance') target.sourceInstancePath = 'another-instance'; if (kind === 'entity') target.stableExportEntityId = 'another-entity'; if (kind === 'shape') target.intrinsicShapeSha256 = '0'.repeat(64); if (kind === 'deformation') target.deformation = 'unknown'; if (kind === 'source-point') f.sourceBinding.pointProjectMetres = [4, 2, 4]; if (kind === 'target-transform') target.objectLocalToProjectMetres[0] = 2;
    expect(evaluateEndpointMigration(f).targetPointProjectMetres).toBeNull();
  });
  it('follows an actual durable connector but refuses its absence or changed local geometry', () => {
    const f = endpointMigrationFixture(); f.sourceBinding.derivation = 'durable-connector.v1'; f.sourceBinding.attachment!.connectorId = 'terminal-A';
    expect(evaluateEndpointMigration(f).disposition).toBe('carried-rigid'); f.targetObject!.qualifiedAttachment!.connectors = []; expect(evaluateEndpointMigration(f).disposition).toBe('connector-missing');
    f.targetObject!.qualifiedAttachment!.connectors = [{ id: 'terminal-A', localPointMetres: [3, 2, 4] }]; expect(evaluateEndpointMigration(f).disposition).toBe('deformed');
  });
  it('real-style all-null qualified identity/frame facts remain unsupported, including a genuine zero point', () => {
    const f = endpointMigrationFixture('fixed-world'); f.sourceBinding = endpointBindingFixture(); f.sourceBinding.pointProjectMetres = [0, 0, 0]; f.frameMapping = null;
    expect(evaluateEndpointMigration(f)).toMatchObject({ disposition: 'frame-unverified', sourcePointProjectMetres: [0, 0, 0], targetPointProjectMetres: null });
  });
  it('does not invent an engineering tolerance or silently accept an absent numeric policy', () => {
    const f = endpointMigrationFixture(); expect(f.validationPolicy!.engineeringToleranceMetres).toBeNull(); expect(validateEndpointRigidTransform(endpointTestMatrix(), null).supported).toBe(false);
  });
  it('refuses contradictory nonnull shape evidence between an object sidecar and its qualified attachment', () => {
    const f = endpointMigrationFixture(); f.targetObject!.intrinsicShapeSha256 = '0'.repeat(64); expect(evaluateEndpointMigration(f)).toMatchObject({ disposition: 'deformed', reasonCodes: ['CONTRADICTORY_SHAPE_EVIDENCE'] });
  });
});
