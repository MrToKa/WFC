import { describe, it, expect } from 'vitest';
import { modelLocationMatchAssignSchema } from './pathfinderModelLocationMatch.js';
import { endpointBindingSchema, endpointBindingWriteSchema, endpointModelMatchObjectGroupSchema, endpointModelMatchObjectIdentitySchema } from './pathfinderEndpointBindings.js';
import { cableEndpointConfirmedDisplaySelectionSchema } from './pathfinderCableEndpoints.js';
import { modelLocationMatchFixture } from '../server/pathfinder/modelLocationMatchFixtures.js';
import { endpointBindingFixture } from '../server/pathfinder/endpointBindingFixtures.js';

describe('strict model name observations', () => {
  const objectIdentity = { guid: '7586ffbb-1d0a-5942-b687-06884123c866', sourceFile: 'source/path/model.dwg' };
  it.each(['uppercase-guid', 'invalid-guid', 'uppercase-source', 'backslash-source', 'untrimmed-source', 'missing-source', 'control-source', 'large-source'] as const)(
    'rejects noncanonical %s identity evidence', kind => {
      const value: Record<string, unknown> = { ...objectIdentity };
      if (kind === 'uppercase-guid') value.guid = objectIdentity.guid.toUpperCase();
      if (kind === 'invalid-guid') value.guid = 'not-an-item-guid';
      if (kind === 'uppercase-source') value.sourceFile = 'SOURCE.dwg';
      if (kind === 'backslash-source') value.sourceFile = 'source\\model.dwg';
      if (kind === 'untrimmed-source') value.sourceFile = ' source.dwg ';
      if (kind === 'missing-source') delete value.sourceFile;
      if (kind === 'control-source') value.sourceFile = 'source\u0000.dwg';
      if (kind === 'large-source') value.sourceFile = 'x'.repeat(1025);
      expect(endpointModelMatchObjectIdentitySchema.safeParse(value).success).toBe(false);
    });
  it('accepts optional canonical identity while keeping legacy scans unchanged', async () => {
    const f = await modelLocationMatchFixture(), legacy = f.command();
    expect(modelLocationMatchAssignSchema.parse(legacy)).toEqual(legacy);
    legacy.scan.candidates[0].objectIdentity = objectIdentity;
    expect(modelLocationMatchAssignSchema.parse(legacy)).toEqual(legacy);
  });
  it.each([[1], [2, 1], [1, 1], [0, 1], Array.from({ length: 4097 }, (_, i) => i + 1)])('rejects invalid grouped member IDs %j', objectIds => {
    expect(endpointModelMatchObjectGroupSchema.safeParse({ ...objectIdentity, objectIds }).success).toBe(false);
  });
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
  it('requires a grouped binding and display to use their lowest member as representative', async () => {
    const f = await modelLocationMatchFixture(); await f.repo.assign(f.projectId, f.who, f.command());
    const head = [...f.state.bindings.values()][0], evidence = head.autoMatchEvidence!;
    expect(endpointBindingSchema.safeParse({ ...head, autoMatchEvidence: { ...evidence, objectGroup: { ...objectIdentity, objectIds: [evidence.sdkObjectId, 100] } } }).success).toBe(true);
    expect(endpointBindingSchema.safeParse({ ...head, autoMatchEvidence: { ...evidence, objectGroup: { ...objectIdentity, objectIds: [2, 100] } } }).success).toBe(false);
    const display = { source: 'confirmed-display-only', mode: 'fixed-world', sdkObjectId: 1, sdkObjectIds: [1, 100],
      pointProjectMetres: head.pointProjectMetres, current: evidence.current, bindingId: head.id, bindingContentSha256: head.contentSha256,
      commandSha256: evidence.commandSha256 };
    expect(cableEndpointConfirmedDisplaySelectionSchema.safeParse(display).success).toBe(true);
    for (const sdkObjectIds of [[100, 1], [2, 100], [1, 1]])
      expect(cableEndpointConfirmedDisplaySelectionSchema.safeParse({ ...display, sdkObjectIds }).success).toBe(false);
    const sdkObjectIds = Array.from({ length: 4096 }, (_, i) => i + 1);
    expect(endpointModelMatchObjectGroupSchema.safeParse({ ...objectIdentity, objectIds: sdkObjectIds }).success).toBe(true);
    expect(cableEndpointConfirmedDisplaySelectionSchema.safeParse({ ...display, sdkObjectIds }).success).toBe(true);
    expect(cableEndpointConfirmedDisplaySelectionSchema.safeParse({ ...display, sdkObjectIds: [...sdkObjectIds, 4097] }).success).toBe(false);
  });
});
