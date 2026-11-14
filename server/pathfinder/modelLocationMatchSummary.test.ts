import { describe, expect, it } from 'vitest';
import { modelLocationMatchFixture } from './modelLocationMatchFixtures.js';
import { endpointFixtureId as id } from './endpointBindingFixtures.js';
import { MODEL_LOCATION_MATCH_LIMITS, type ModelLocationMatchAssign } from '../../shared/pathfinderModelLocationMatch.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { endpointBindingHash } from './endpointBindingRepository.js';

function page(command: ModelLocationMatchAssign, names: string[], key: string) {
  return { ...command, idempotencyKey: key, names, scan: { ...command.scan,
    candidates: command.scan.candidates.filter(candidate => candidate.matchedNames.some(name => names.includes(name))) } };
}

/** These fixtures use ordinary integer numbers. jsonb text adds one space
 * after separators outside strings; key ordering does not change its size. */
function jsonbTextBytes(value: unknown) {
  const text = canonicalPurposeJson(value); let quoted = false, escaped = false, spaces = 0;
  for (const character of text) {
    if (escaped) { escaped = false; continue; }
    if (quoted && character === '\\') { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && [',', ':'].includes(character)) spaces++;
  }
  return Buffer.byteLength(text) + spaces;
}

function useDatabaseTextSizes(f: Awaited<ReturnType<typeof modelLocationMatchFixture>>) {
  const original = f.query.getMockImplementation()!;
  f.query.mockImplementation(async (sql, args) => {
    const result = await original(sql, args);
    if (sql.startsWith('/* model-location-match:summary-index */')) return { rows: result.rows.map(row => {
      const saved = f.state.commands.get(row.actor_id + ':' + row.idempotency_key)!;
      return { ...row, request_bytes: jsonbTextBytes(saved.request), receipt_bytes: jsonbTextBytes(saved.receipt) };
    }) };
    if (sql.startsWith('/* model-location-match:summary-command */')) return { rows: result.rows.map(row => ({ ...row,
      request: jsonbTextBytes(row.request) <= Number(/octet_length\(request::text\)<=(\d+)/.exec(sql)?.[1]) ? row.request : null,
      receipt: jsonbTextBytes(row.receipt) <= Number(/octet_length\(receipt::text\)<=(\d+)/.exec(sql)?.[1]) ? row.receipt : null,
    })) };
    return result;
  });
}

describe('persisted current-model matching summary', () => {
  it('restores complete saved counts and results without submitting any new command', async () => {
    const f = await modelLocationMatchFixture(); await f.repo.assign(f.projectId, f.who, f.command());
    const before = structuredClone(f.state), calls = f.query.mock.calls.length;
    const summary = await f.repo.summary(f.projectId, f.who);
    expect(summary).toMatchObject({ complete: true, context: { namesSha256: f.context.namesSha256 },
      counts: { searched: 3, found: 3, assigned: 3, preserved: 0, manualAttention: 0 } });
    expect(summary.results.map(result => result.name)).toEqual(f.context.names); expect(f.state).toEqual(before);
    expect(f.query.mock.calls.slice(calls).filter(([sql]) => /\b(?:INSERT|UPDATE|DELETE)\b/.test(sql.replace(/FOR (?:NO KEY )?UPDATE/g, '')))).toEqual([]);
    expect(f.query.mock.calls.slice(calls).filter(([sql]) => sql.startsWith('/* model-location-match:summary-command */'))).toHaveLength(1);
  });
  it('keeps confirmed partial pages partial and never invents the remaining outcomes', async () => {
    const f = await modelLocationMatchFixture(), command = f.command();
    await f.repo.assign(f.projectId, f.who, page(command, command.names.slice(0, 2), id(701)));
    const summary = await f.repo.summary(f.projectId, f.who);
    expect(summary).toMatchObject({ complete: false, counts: { searched: 2, found: 2, assigned: 2, preserved: 0, manualAttention: 0 } });
    expect(summary.context.names).toHaveLength(3); expect(summary.results).toHaveLength(2);
  });
  it('uses the latest successful receipt per name without losing earlier completed pages', async () => {
    const f = await modelLocationMatchFixture(); await f.repo.assign(f.projectId, f.who, f.command());
    const second = f.command(); await f.repo.assign(f.projectId, f.who, page(second, second.names.slice(0, 1), id(702)));
    const summary = await f.repo.summary(f.projectId, f.who);
    expect(summary).toMatchObject({ complete: true, counts: { searched: 3, found: 3, assigned: 2, preserved: 1, manualAttention: 0 } });
    expect(summary.results.map(result => result.status)).toEqual(['preserved', 'assigned', 'assigned']);
  });
  it('counts names found in the model separately from assignments and manual attention', async () => {
    const f = await modelLocationMatchFixture(), command = f.command(), [first, second] = command.scan.candidates;
    command.scan.candidates = [{ ...first, bounds: null, bottomCentre: null }, second, { ...second, objectId: 100 }];
    await f.repo.assign(f.projectId, f.who, command);
    expect(await f.repo.summary(f.projectId, f.who)).toMatchObject({ complete: true,
      counts: { searched: 3, found: 2, assigned: 0, preserved: 0, manualAttention: 3 },
      results: [{ status: 'unavailable' }, { status: 'ambiguous' }, { status: 'missing' }] });
  });
  it.each(['model', 'names'] as const)('excludes old results when the current %s scope changes', async kind => {
    const f = await modelLocationMatchFixture(); await f.repo.assign(f.projectId, f.who, f.command());
    if (kind === 'model') f.state.selectedRevision = '2';
    else f.state.cables.push({ id: id(20), from_location: 'NEW-TAG', to_location: null });
    const summary = await f.repo.summary(f.projectId, f.who);
    expect(summary.results).toEqual([]); expect(summary.complete).toBe(false);
    expect(summary.counts).toEqual({ searched: 0, found: 0, assigned: 0, preserved: 0, manualAttention: 0 });
  });
  it('retains the same logical name scope after case changes and displays the current project spelling', async () => {
    const f = await modelLocationMatchFixture(); await f.repo.assign(f.projectId, f.who, f.command());
    for (const cable of f.state.cables) {
      if (cable.from_location) cable.from_location = cable.from_location.toLowerCase();
      if (cable.to_location) cable.to_location = cable.to_location.toLowerCase();
    }
    const summary = await f.repo.summary(f.projectId, f.who);
    expect(summary.complete).toBe(true); expect(summary.counts.searched).toBe(3);
    expect(summary.results.map(result => result.name)).toEqual(summary.context.names);
  });
  it('restores all 4096 logical names across metadata pages after newer receipts use case-only spelling variants', async () => {
    const f = await modelLocationMatchFixture(), template = f.command();
    f.state.cables = Array.from({ length: MODEL_LOCATION_MATCH_LIMITS.names }, (_, index) => ({
      id: id(index + 1000), from_location: `TAG-${String(index).padStart(4, '0')}`, to_location: null,
    }));
    const context = await f.repo.context(f.projectId, f.who);
    for (let offset = 0; offset < context.names.length; offset += MODEL_LOCATION_MATCH_LIMITS.pageNames) {
      await f.repo.assign(f.projectId, f.who, { ...template, namesSha256: context.namesSha256,
        idempotencyKey: id(offset + 8000), names: context.names.slice(offset, offset + MODEL_LOCATION_MATCH_LIMITS.pageNames),
        scan: { ...template.scan, candidates: [] } });
    }
    const intermediate = f.state.cables[0].from_location!.replace('TAG', 'Tag');
    f.state.cables[0].from_location = intermediate;
    await f.repo.assign(f.projectId, f.who, { ...template, namesSha256: context.namesSha256,
      idempotencyKey: id(12999), names: [intermediate], scan: { ...template.scan, candidates: [] } });
    const renamed = f.state.cables[0].from_location!.toLowerCase();
    f.state.cables[0].from_location = renamed;
    const changed = await f.repo.context(f.projectId, f.who);
    expect(changed.namesSha256).toBe(context.namesSha256);
    await f.repo.assign(f.projectId, f.who, { ...template, namesSha256: changed.namesSha256,
      idempotencyKey: id(13000), names: [renamed], scan: { ...template.scan,
        candidates: [{ objectId: 1, name: renamed, matchedNames: [renamed], bounds: null, bottomCentre: null }] } });
    const calls = f.query.mock.calls.length, before = structuredClone(f.state);
    const summary = await f.repo.summary(f.projectId, f.who);
    expect(summary).toMatchObject({ complete: true, counts: { searched: 4096, found: 1, assigned: 0, preserved: 0, manualAttention: 4096 } });
    expect(summary.results).toHaveLength(4096);
    expect(summary.results.find(result => result.name === renamed)).toMatchObject({ status: 'unavailable', candidateObjectIds: [1] });
    expect(f.query.mock.calls.slice(calls).filter(([sql]) => sql.startsWith('/* model-location-match:summary-index */'))
      .map(([, args]) => args?.[3])).toEqual([0, 4097]);
    expect(f.state).toEqual(before);
  }, 15_000);
  it('refuses tampered command evidence rather than presenting its receipt as a saved result', async () => {
    const f = await modelLocationMatchFixture(), command = f.command(); await f.repo.assign(f.projectId, f.who, command);
    f.state.commands.get(f.who.userId + ':' + command.idempotencyKey)!.request_sha256 = '0'.repeat(64);
    await expect(f.repo.summary(f.projectId, f.who)).rejects.toMatchObject({ code: 'MODEL_LOCATION_MATCH_SUMMARY_INTEGRITY' });
  });
  it('rejects oversized saved command metadata before materializing command bodies', async () => {
    const f = await modelLocationMatchFixture(), original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, args) => sql.startsWith('/* model-location-match:summary-index */')
      ? { rows: [{ actor_id: f.who.userId, idempotency_key: id(701), name: f.context.names[0], request_bytes: 2 * MODEL_LOCATION_MATCH_LIMITS.bodyBytes + 1, receipt_bytes: 100 }] }
      : original(sql, args));
    await expect(f.repo.summary(f.projectId, f.who)).rejects.toMatchObject({ code: 'MODEL_LOCATION_MATCH_SUMMARY_LIMIT' });
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith('/* model-location-match:summary-command */'))).toBe(false);
  });
  it('restores an admitted near-limit command whose jsonb text exceeds the canonical admission limit', async () => {
    const f = await modelLocationMatchFixture(), command = page(f.command(), f.context.names.slice(0, 1), id(701)), first = command.scan.candidates[0];
    command.scan.indexedObjectCount = 4096;
    command.scan.propertyScan = { attemptedObjectCount: 4096, returnedObjectCount: 4096, omittedObjectCount: 0, complete: true };
    command.scan.candidates = Array.from({ length: 2216 }, (_, index) => ({ ...first, objectId: index + 1, name: 'X'.repeat(350) }));
    await f.repo.assign(f.projectId, f.who, command);
    const saved = f.state.commands.get(f.who.userId + ':' + command.idempotencyKey)!;
    expect(Buffer.byteLength(canonicalPurposeJson(saved.request))).toBeLessThanOrEqual(MODEL_LOCATION_MATCH_LIMITS.bodyBytes);
    expect(jsonbTextBytes(saved.request)).toBeGreaterThan(MODEL_LOCATION_MATCH_LIMITS.bodyBytes);
    useDatabaseTextSizes(f);
    const summary = await f.repo.summary(f.projectId, f.who);
    expect(summary).toMatchObject({ complete: false, counts: { searched: 1, found: 1, assigned: 0, preserved: 0, manualAttention: 1 } });
    expect(summary.results[0].candidateObjectIds).toHaveLength(2216);
  });
  it('retains the original canonical request limit despite accepting database text overhead', async () => {
    const f = await modelLocationMatchFixture(), command = f.command(); await f.repo.assign(f.projectId, f.who, command);
    const saved = f.state.commands.get(f.who.userId + ':' + command.idempotencyKey)!, request = saved.request as { command: ModelLocationMatchAssign };
    request.command.scan.candidates[0].name = 'X'.repeat(2048);
    request.command.scan.candidates = Array.from({ length: 500 }, (_, index) => ({ ...request.command.scan.candidates[0], objectId: index + 1 }));
    saved.request_sha256 = endpointBindingHash(saved.request);
    expect(Buffer.byteLength(canonicalPurposeJson(saved.request))).toBeGreaterThan(MODEL_LOCATION_MATCH_LIMITS.bodyBytes);
    expect(jsonbTextBytes(saved.request)).toBeLessThan(2 * MODEL_LOCATION_MATCH_LIMITS.bodyBytes);
    useDatabaseTextSizes(f);
    await expect(f.repo.summary(f.projectId, f.who)).rejects.toMatchObject({ code: 'MODEL_LOCATION_MATCH_SUMMARY_LIMIT' });
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith('/* model-location-match:summary-command */'))).toBe(true);
  });
});
