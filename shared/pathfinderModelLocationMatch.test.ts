import { describe, it, expect } from 'vitest';
import { modelLocationMatchAssignSchema } from './pathfinderModelLocationMatch.js';
import { endpointBindingSchema, endpointBindingWriteSchema } from './pathfinderEndpointBindings.js';
import { modelLocationMatchFixture } from '../server/pathfinder/modelLocationMatchFixtures.js';
import { endpointBindingFixture } from '../server/pathfinder/endpointBindingFixtures.js';

describe('strict model name observations', () => {
  it.each(['incomplete', 'omitted', 'count', 'duplicate', 'outside-page', 'point', 'half-bounds', 'zero-bounds', 'long-name', 'too-many-names'] as const)('refuses %s scans before a match write', async kind => {
    const f = await modelLocationMatchFixture(), command = f.command(), candidate = command.scan.candidates[0];
    let raw: unknown = command;
    if (kind === 'incomplete') raw = { ...command, scan: { ...command.scan, complete: false } };
    if (kind === 'omitted') raw = { ...command, scan: { ...command.scan, propertyScan: { ...command.scan.propertyScan, omittedObjectCount: 1 } } };
    if (kind === 'count') command.scan.indexedObjectCount++;
    if (kind === 'duplicate') command.scan.candidates.push(candidate);
    if (kind === 'outside-page') candidate.matchedNames = ['Foreign'];
    if (kind === 'point') candidate.bottomCentre = [99, 3, 3];
    if (kind === 'half-bounds') candidate.bottomCentre = null;
    if (kind === 'zero-bounds') { candidate.bounds = { minimum: [1, 1, 1], maximum: [1, 1, 1] }; candidate.bottomCentre = [1, 1, 1]; }
    if (kind === 'long-name') command.names[0] = 'x'.repeat(257);
    if (kind === 'too-many-names') command.names = Array.from({ length: 129 }, (_, i) => 'Name' + i);
    expect(modelLocationMatchAssignSchema.safeParse(raw).success).toBe(false);
  });
  it('requires the typed observation exclusively on the new fixed-world policy', async () => {
    const f = await modelLocationMatchFixture(); await f.repo.assign(f.projectId, f.who, f.command());
    const head = [...f.state.bindings.values()][0];
    expect(endpointBindingSchema.safeParse(head).success).toBe(true);
    expect(endpointBindingSchema.safeParse({ ...head, autoMatchEvidence: undefined }).success).toBe(false);
    expect(endpointBindingSchema.safeParse({ ...head, derivation: 'manual-world-point' }).success).toBe(false);
    expect(endpointBindingSchema.safeParse({ ...head, pointProjectMetres: [99, 3, 3] }).success).toBe(false);
    const { autoMatchEvidence, ...without } = head;
    expect(endpointBindingSchema.safeParse({ ...without, autoMatchEvidence: { ...autoMatchEvidence, current: { ...autoMatchEvidence!.current, captureFrameId: 'ed000000-0000-4000-8000-000000000999' } } }).success).toBe(false);
    const manual = endpointBindingFixture().command();
    expect(endpointBindingWriteSchema.safeParse(manual).success).toBe(true);
    expect(endpointBindingWriteSchema.safeParse({ ...manual, derivation: head.derivation, autoMatchEvidence }).success).toBe(false);
  });
});
