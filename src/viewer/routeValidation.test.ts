import { describe, expect, it } from 'vitest';
import { parseRouting } from '../../viewer-runtime/protocol.mjs';
import { aggregateRouteCheck, buildProjectRouteCheck, createLocalRouteCheck, parseRouteInput, RouteValidationError, type RouteAttempt, type RouteIdentity } from './routeValidation';
import type { ViewerEvent } from './ViewerController';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const attempt = (rawRouting = '/BC1/SECONDARY/BC1'): RouteAttempt => ({ protocolVersion: 1, instanceId: uuid(1), projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), requestId: uuid(5), operationId: uuid(6), rawRouting, source: 'manual', cableId: null });
const identity = (value: RouteAttempt): RouteIdentity => ({ protocolVersion: 1, instanceId: value.instanceId, projectId: value.projectId, modelVersionId: value.modelVersionId, loadId: value.loadId, requestId: value.requestId });
const trays = (...names: string[]) => names.map((name, index) => ({ id: uuid(index + 100), projectId: uuid(2), name }));
function model(value: RouteAttempt, states?: { state: 'found' | 'missing' | 'ambiguous'; matchCount: number; drawable: boolean }[], lineCount = 1): ViewerEvent {
  const parsed = parseRouting(value.rawRouting);
  const segments = parsed.segments.map((segment, index) => ({ ...segment, model: states?.[index] ?? { state: 'found', matchCount: 1, drawable: true } }));
  const drawableCount = segments.filter(segment => segment.model.drawable).length;
  return { type: 'ROUTE_RESULT', requestId: value.requestId, identity: identity(value), payload: { rawRouting: value.rawRouting, source: value.source, cableId: value.cableId, segments, ignored: parsed.ignored, drawableCount, lineCount: drawableCount ? lineCount : 0, warnings: [] } };
}
const found = { state: 'found', matchCount: 1, drawable: true } as const;
const noGeometry = { state: 'found', matchCount: 1, drawable: false } as const;
const missing = { state: 'missing', matchCount: 0, drawable: false } as const;
const ambiguous = { state: 'ambiguous', matchCount: 2, drawable: false } as const;

describe('canonical route parser facade', () => {
  it('preserves raw text, NFKC/case, repeats and marker-inclusive occurrence indices', () => {
    const parsed = parseRouteInput(' // bc１ / Secondary // BC1 / ');
    expect(parsed.status).toBe('valid');
    expect(parsed.segments).toEqual([{ segmentIndex: 0, token: 'bc１', key: 'BC1' }, { segmentIndex: 2, token: 'BC1', key: 'BC1' }]);
    expect(parsed.ignored).toEqual([{ segmentIndex: 1, token: 'Secondary', reason: 'SECONDARY' }]);
  });
  it('enforces 8000/8001 UTF-16 and 100/101 nonmarker boundaries without changing the parser', () => {
    expect(parseRouteInput('A'.repeat(8000)).status).toBe('valid'); expect(parseRouteInput('A'.repeat(8001)).status).toBe('invalid');
    expect(parseRouteInput(Array(100).fill('BC1/SECONDARY').join('/')).segments).toHaveLength(100);
    expect(parseRouteInput(Array(101).fill('BC1').join('/')).status).toBe('invalid');
    expect(parseRouteInput('😀'.repeat(4000)).status).toBe('valid'); expect(parseRouteInput('😀'.repeat(4001)).status).toBe('invalid');
  });
  it.each(['BC1／BC2', 'BC\u0000X', 'BC\nX', '／'])('rejects normalized invalid key %j', raw => {
    expect(parseRouteInput(raw)).toMatchObject({ status: 'invalid', segments: [], ignored: [] });
  });
  it('distinguishes no input from ignored markers while both are empty and preserve the text', () => {
    expect(parseRouteInput(null)).toMatchObject({ status: 'empty', rawRouting: '', ignored: [] });
    expect(parseRouteInput(' /// ')).toMatchObject({ status: 'empty', ignored: [] });
    expect(parseRouteInput('/SECONDARY/secondary')).toMatchObject({ status: 'empty', ignored: [{ segmentIndex: 0, token: 'SECONDARY', reason: 'SECONDARY' }, { segmentIndex: 1, token: 'secondary', reason: 'SECONDARY' }] });
  });
});

describe('pure project index and combined result', () => {
  it('uses the same key normalization for full project names and counts collisions without deduping route occurrences', () => {
    const input = attempt();
    const db = buildProjectRouteCheck(input, trays(' bc１ ', '/BC1/', 'BC001'));
    expect(db.segments.map(value => value.project)).toEqual([{ state: 'ambiguous', matchCount: 2 }, { state: 'ambiguous', matchCount: 2 }]);
    expect(db.segments.map(value => value.segmentIndex)).toEqual([0, 2]); expect(db.ignored[0].segmentIndex).toBe(1);
    expect(aggregateRouteCheck(input, model(input), db).status).toBe('partial');
  });
  it('does not expand an invalid DB name containing a slash into several matching trays', () => {
    const input = attempt('BC1/BC2'); const db = buildProjectRouteCheck(input, trays('BC1/BC2', 'BC\u0000X'));
    expect(db.segments.map(value => value.project.state)).toEqual(['missing', 'missing']);
  });
  it('produces complete only when every occurrence exists in both checks, is drawable and has a line', () => {
    const input = attempt(); const result = aggregateRouteCheck(input, model(input), buildProjectRouteCheck(input, trays('ＢＣ１')));
    expect(result).toMatchObject({ status: 'complete', databaseCheck: 'available', drawableCount: 2, lineCount: 1, projectId: input.projectId, modelVersionId: input.modelVersionId, loadId: input.loadId, requestId: input.requestId });
    expect(result.segments.map(value => value.segmentIndex)).toEqual([0, 2]); expect(result.ignored).toEqual([{ segmentIndex: 1, token: 'SECONDARY', reason: 'SECONDARY' }]);
    expect(Object.keys(result).sort()).toEqual(['protocolVersion', 'projectId', 'modelVersionId', 'loadId', 'requestId', 'source', 'cableId', 'rawRouting', 'status', 'databaseCheck', 'segments', 'ignored', 'drawableCount', 'lineCount', 'warnings'].sort());
  });
  it('keeps model geometry when the same identifier is missing only in the project DB', () => {
    const input = attempt('BC1/BC2'); const result = aggregateRouteCheck(input, model(input), buildProjectRouteCheck(input, trays('BC1')));
    expect(result.status).toBe('partial'); expect(result.drawableCount).toBe(2); expect(result.segments[1]).toMatchObject({ project: { state: 'missing', matchCount: 0 }, model: found });
    expect(result.warnings).toContainEqual({ code: 'PROJECT_MISSING', segmentIndex: 1, message: 'BC2 does not exist in this project.' });
  });
  it('keeps independent project exists when the model is missing, ambiguous or uniquely named without geometry', () => {
    for (const state of [missing, ambiguous, noGeometry]) {
      const input = attempt('BC1/BC2'); const result = aggregateRouteCheck(input, model(input, [found, state]), buildProjectRouteCheck(input, trays('BC1', 'BC2')));
      expect(result.status).toBe('partial'); expect(result.segments[1]).toMatchObject({ project: { state: 'exists', matchCount: 1 }, model: state });
    }
  });
  it('reports DB failure as unavailable for every occurrence without converting it into missing or removing geometry', () => {
    const input = attempt(); const result = aggregateRouteCheck(input, model(input), buildProjectRouteCheck(input, null));
    expect(result.status).toBe('partial'); expect(result.databaseCheck).toBe('unavailable'); expect(result.drawableCount).toBe(2);
    expect(result.segments.every(value => value.project.state === 'unavailable' && value.project.matchCount === null)).toBe(true);
    expect(result.warnings.some(value => value.code === 'PROJECT_CHECK_UNAVAILABLE')).toBe(true); expect(result.warnings.some(value => value.code === 'PROJECT_MISSING')).toBe(false);
  });
  it('distinguishes none from found and makes drawable-but-lineCount-zero partial', () => {
    const input = attempt('BC1'); const db = buildProjectRouteCheck(input, trays('BC1'));
    const none = aggregateRouteCheck(input, model(input, [noGeometry]), db); expect(none.status).toBe('none'); expect(none.segments[0].model.state).toBe('found');
    expect(aggregateRouteCheck(input, model(input, [found], 0), db).status).toBe('partial');
  });
  it('retains approximation warnings even when every name satisfies complete', () => {
    const input = attempt('BC1'), event = model(input);
    event.payload.warnings = [{ code: 'UNMODELLED_CONNECTOR', segmentIndex: null, message: 'An approximate connection.' }];
    const result = aggregateRouteCheck(input, event, buildProjectRouteCheck(input, trays('BC1')));
    expect(result.status).toBe('complete'); expect(result.warnings).toEqual(event.payload.warnings);
  });
  it('makes local invalid/empty results without claiming an available database check or inventing model matches', () => {
    const invalid = createLocalRouteCheck(attempt('A'.repeat(8001))); expect(invalid.status).toBe('invalid'); expect(invalid.rawRouting).toHaveLength(8001); expect(invalid.segments).toEqual([]);
    const empty = createLocalRouteCheck(attempt('/SECONDARY/')); expect(empty.status).toBe('empty'); expect(empty.ignored).toHaveLength(1); expect(empty.warnings[0].code).toBe('SECONDARY_ONLY'); expect(empty.databaseCheck).toBe('unavailable');
    expect(createLocalRouteCheck(attempt(' /// ')).warnings[0].message).toBe('Enter a route.');
    expect(() => createLocalRouteCheck(attempt('BC1'))).toThrow(RouteValidationError);
  });
  it('supports an exact empty model event without treating markers as missing', () => {
    const input = attempt('/SECONDARY/'); const result = aggregateRouteCheck(input, model(input), buildProjectRouteCheck(input, []));
    expect(result.status).toBe('empty'); expect(result.drawableCount).toBe(0); expect(result.segments).toEqual([]); expect(result.ignored).toHaveLength(1);
  });
  it('detaches output data from the source DB/model objects', () => {
    const input = attempt('BC1'), event = model(input), db = buildProjectRouteCheck(input, trays('BC1'));
    const result = aggregateRouteCheck(input, event, db); db.segments[0].project.state = 'missing'; (event.payload.segments as { token: string }[])[0].token = 'changed';
    expect(result.segments[0].project.state).toBe('exists'); expect(result.segments[0].token).toBe('BC1');
  });
});

describe('strict route pairing', () => {
  it('rejects malformed absent event/project collections with the controlled mismatch code', () => {
    const input = attempt(), event = model(input), db = buildProjectRouteCheck(input, trays('BC1'));
    for (const value of [null, undefined, { ...db, segments: null }, { ...db, ignored: null }, { ...db, ignored: [null] }]) {
      expect(() => aggregateRouteCheck(input, event, value as any)).toThrow(RouteValidationError);
    }
    expect(() => aggregateRouteCheck(input, null as any, db)).toThrow(RouteValidationError);
    expect(() => buildProjectRouteCheck(input, [null] as any)).toThrow(RouteValidationError);
  });
  it.each(['instanceId', 'projectId', 'modelVersionId', 'loadId', 'requestId'] as const)('rejects stale model %s even for identical text and all other matching identities', key => {
    const input = attempt(), event = model(input); event.identity = { ...event.identity!, [key]: uuid(99) };
    expect(() => aggregateRouteCheck(input, event, buildProjectRouteCheck(input, trays('BC1')))).toThrow(RouteValidationError);
  });
  it('rejects a stale DB operation and project/load identity and duplicated tray IDs', () => {
    const input = attempt(), db = buildProjectRouteCheck(input, trays('BC1')); db.operationId = uuid(99);
    expect(() => aggregateRouteCheck(input, model(input), db)).toThrow(RouteValidationError);
    const foreign = buildProjectRouteCheck(input, trays('BC1')); foreign.identity = { ...foreign.identity, projectId: uuid(99) };
    expect(() => aggregateRouteCheck(input, model(input), foreign)).toThrow(RouteValidationError);
    expect(() => buildProjectRouteCheck(input, [{ ...trays('BC1')[0], projectId: uuid(99) }])).toThrow(RouteValidationError);
    expect(() => buildProjectRouteCheck(input, [trays('BC1')[0], trays('BC1')[0]])).toThrow(RouteValidationError);
  });
  it('requires the returned SHOW request ID and model-only exact payload', () => {
    const input = attempt(), event = model(input), db = buildProjectRouteCheck(input, trays('BC1'));
    expect(() => aggregateRouteCheck(input, { ...event, requestId: uuid(99) }, db)).toThrow(RouteValidationError);
    expect(() => aggregateRouteCheck(input, { ...event, identity: undefined }, db)).toThrow(RouteValidationError);
    expect(() => aggregateRouteCheck(input, { ...event, payload: { ...event.payload, databaseCheck: 'available' } }, db)).toThrow(RouteValidationError);
  });
  it.each(['rawRouting', 'source', 'cableId'] as const)('rejects mismatched model or DB %s', key => {
    const input = attempt(), event = model(input), db = buildProjectRouteCheck(input, trays('BC1'));
    const other = key === 'rawRouting' ? 'bc1' : key === 'source' ? 'cable' : uuid(99);
    expect(() => aggregateRouteCheck(input, { ...event, payload: { ...event.payload, [key]: other } }, db)).toThrow(RouteValidationError);
    expect(() => aggregateRouteCheck(input, event, { ...db, [key]: other })).toThrow(RouteValidationError);
  });
  it('checks every token/key/index/ignored marker and DB state cardinality before combining', () => {
    const input = attempt();
    const changes = [(db: ReturnType<typeof buildProjectRouteCheck>) => { db.segments[1].token = 'bc1'; },
      (db: ReturnType<typeof buildProjectRouteCheck>) => { db.segments[1].key = 'BC2'; },
      (db: ReturnType<typeof buildProjectRouteCheck>) => { db.segments[1].segmentIndex = 1; },
      (db: ReturnType<typeof buildProjectRouteCheck>) => { db.ignored[0].token = 'secondary'; },
      (db: ReturnType<typeof buildProjectRouteCheck>) => { db.segments[0].project.matchCount = 2; },
      (db: ReturnType<typeof buildProjectRouteCheck>) => { db.databaseCheck = 'unavailable'; }];
    for (const change of changes) { const db = buildProjectRouteCheck(input, trays('BC1')); change(db); expect(() => aggregateRouteCheck(input, model(input), db)).toThrow(RouteValidationError); }
  });
  it('requires a cable ID for cable attempts and never combines a valid model with parser-invalid input', () => {
    const input = attempt(); expect(() => buildProjectRouteCheck({ ...input, source: 'cable' }, [])).toThrow(RouteValidationError);
    expect(() => aggregateRouteCheck({ ...input, rawRouting: 'BC／1' }, model(input), buildProjectRouteCheck(input, []))).toThrow(RouteValidationError);
  });
});
