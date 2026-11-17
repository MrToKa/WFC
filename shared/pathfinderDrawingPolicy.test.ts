// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAWING_MODES, drawingCategoryModesSchema, drawingPurposeWriteSchema, drawingPurposePolicySchema, drawingPolicySaveSchema, drawingPolicyHistorySchema, drawingPurposeDiagnostics, isDefaultDrawingModes, drawingErrorSchema, resolveDrawingPurposeMode, drawingPurposeModesSchema } from './pathfinderDrawingPolicy.js';
const id = '11111111-1111-4111-8111-111111111111';
const command = () => ({ schemaVersion: 'pathfinder.drawing-purpose-policy.write.v1', expectedCatalogRevision: '0', expectedRevision: '0', idempotencyKey: id, changes: [{ purposeKey: 'Shared', categoryModes: { ...DEFAULT_DRAWING_MODES, power: 'left' } }] });
describe('strict drawing-only policy contracts', () => {
  it('retains one mode per category and an explicit all-default reset', () => { expect(drawingPurposeWriteSchema.parse(command()).changes[0].categoryModes.power).toBe('left'); expect(isDefaultDrawingModes({ ...DEFAULT_DRAWING_MODES })).toBe(true); expect(isDefaultDrawingModes(drawingPurposeWriteSchema.parse(command()).changes[0].categoryModes)).toBe(false); expect(Object.isFrozen(DEFAULT_DRAWING_MODES)).toBe(true); });
  it.each([{ power: ['left', 'right'] }, { power: true }, { power: 'automatic' }, { power: 'Left' }, { LV: 'left' }])('rejects mutually incompatible modes or routing categories %j', patch => expect(drawingCategoryModesSchema.safeParse({ ...DEFAULT_DRAWING_MODES, ...patch }).success).toBe(false));
  it('requires all four exact category keys', () => { const { mv: _mv, ...partial } = DEFAULT_DRAWING_MODES; expect(drawingCategoryModesSchema.safeParse(partial).success).toBe(false); expect(drawingCategoryModesSchema.safeParse({ ...DEFAULT_DRAWING_MODES, control: 'right', extra: 'left' }).success).toBe(false); });
  it.each([{ expectedRevision: '01' }, { expectedRevision: '1\n' }, { expectedRevision: 1 }, { expectedRevision: '9223372036854775808' }, { idempotencyKey: id + '\n' }, { actorId: id }, { schemaVersion: 'other' }, { changes: [] }])('rejects noncanonical or extended write %j', patch => expect(drawingPurposeWriteSchema.safeParse({ ...command(), ...patch }).success).toBe(false));
  it('rejects duplicate purpose changes, reset operation bags and unnormalized keys', () => { const value = command(); expect(drawingPurposeWriteSchema.safeParse({ ...value, changes: [...value.changes, ...value.changes] }).success).toBe(false); expect(drawingPurposeWriteSchema.safeParse({ ...value, changes: [{ ...value.changes[0], operation: 'reset' }] }).success).toBe(false); expect(drawingPurposeWriteSchema.safeParse({ ...value, changes: [{ ...value.changes[0], purposeKey: ' Shared' }] }).success).toBe(false); });
  it('read and receipts remain in the drawing domain', () => { expect(drawingPurposePolicySchema.parse({ schemaVersion: 'pathfinder.drawing-purpose-policy.v1', projectId: id, catalogRevision: '3', drawingPolicyRevision: '4', rules: [] }).rules).toEqual([]); const receipt = { schemaVersion: 'pathfinder.policy-save.v1', projectId: id, domain: 'drawing', catalogRevision: '3', previousRevision: '2', revision: '3', auditId: id, duplicate: false }; expect(drawingPolicySaveSchema.parse(receipt).domain).toBe('drawing'); expect(drawingPolicySaveSchema.safeParse({ ...receipt, domain: 'routing' }).success).toBe(false); expect(drawingPolicyHistorySchema.parse({ schemaVersion: 'pathfinder.policy-history.v1', projectId: id, domain: 'drawing', events: [], nextBeforeRevision: null }).events).toEqual([]); });
  it('purpose authorability excludes unrelated name, route, dimension and future diagnostics', () => { const codes = ['MISSING_TRAY_PURPOSE', 'INVALID_TRAY_PURPOSE', 'PURPOSE_NORMALIZATION_COLLISION', 'TRAY_NAME_COLLISION', 'INVALID_TRAY_NAME', 'UNSUPPORTED_ROUTE_CODE', 'INVALID_DIMENSION', 'FUTURE_WARNING']; const diagnostics = codes.map(code => ({ code, projectTrayIds: [id], message: code })); expect(drawingPurposeDiagnostics(diagnostics).map(item => item.code)).toEqual(codes.slice(0, 3)); expect(diagnostics).toHaveLength(8); });
  it('ordinary drawing errors expose only drawing revisions and deny routing data', () => { const value = { schemaVersion: 'pathfinder.drawing-error.v1', code: 'DRAWING_STALE', message: 'Refresh the drawing.', currentRevisions: { catalogRevision: '0', drawingPolicyRevision: '1', drawingInputRevision: '2' } }; expect(drawingErrorSchema.parse(value).currentRevisions?.drawingInputRevision).toBe('2'); expect(drawingErrorSchema.safeParse({ ...value, currentRevisions: { ...value.currentRevisions, routingPolicyRevision: '3' } }).success).toBe(false); expect(drawingErrorSchema.safeParse({ ...value, code: 'DRAWING_STALE\n' }).success).toBe(false); });
});

describe('exact cable purpose positioning with historical fallback', () => {
  it('keeps legacy saved family modes while allowing an exact purpose default or side override', () => {
    const rule = { categoryModes: { ...DEFAULT_DRAWING_MODES, mv: 'left' as const, control: 'right' as const }, purposeModes: { Control: 'use-default' as const, 'Plastic tubing': 'left' as const } };
    expect(resolveDrawingPurposeMode(rule, 'Grounding')).toBe('left');
    expect(resolveDrawingPurposeMode(rule, 'Control')).toBe('use-default');
    expect(resolveDrawingPurposeMode(rule, 'Instrumentation control')).toBe('right');
    expect(resolveDrawingPurposeMode(rule, ' Plastic tubing ')).toBe('left');
    expect(resolveDrawingPurposeMode(undefined, 'New purpose')).toBe('use-default');
  });
  it('rejects malformed purpose keys and invalid sides while preserving NFC purpose identity', () => {
    expect(drawingPurposeModesSchema.parse({ 'Plastic tubing': 'right' })).toEqual({ 'Plastic tubing': 'right' });
    for (const value of [{ ' Plastic tubing': 'right' }, { 'Plastic tubing': 'Left' }, { 'Bad\nkey': 'left' }]) expect(drawingPurposeModesSchema.safeParse(value).success).toBe(false);
  });
  it('preserves valid purpose names that match JavaScript prototype properties', () => {
    const input = JSON.parse('{"__proto__":"right","constructor":"left","toString":"use-default"}');
    const parsed = drawingPurposeModesSchema.parse(input);
    expect(Object.keys(parsed)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(input));
    const rule = { categoryModes: { ...DEFAULT_DRAWING_MODES }, purposeModes: parsed };
    expect(resolveDrawingPurposeMode(rule, '__proto__')).toBe('right');
    expect(resolveDrawingPurposeMode(rule, 'constructor')).toBe('left');
    expect(resolveDrawingPurposeMode(rule, 'toString')).toBe('use-default');
    expect(drawingPurposeWriteSchema.parse({ ...command(), changes: [{ ...command().changes[0], purposeModes: input }] }).changes[0].purposeModes).toEqual(input);
    expect(drawingPurposeModesSchema.safeParse(JSON.parse('{"__proto__":"invalid"}')).success).toBe(false);
  });
  it('accepts null-prototype mode maps and enforces the entry bound', () => {
    const modes = Object.assign(Object.create(null), { Control: 'left' });
    expect(drawingPurposeModesSchema.parse(modes)).toEqual({ Control: 'left' });
    expect(drawingPurposeModesSchema.safeParse(Object.fromEntries(Array.from({ length: 4096 }, (_, i) => [`Purpose ${i}`, 'left']))).success).toBe(true);
    expect(drawingPurposeModesSchema.safeParse(Object.fromEntries(Array.from({ length: 4097 }, (_, i) => [`Purpose ${i}`, 'left']))).success).toBe(false);
    for (const input of [null, [], 'left', new Date(), 1]) expect(drawingPurposeModesSchema.safeParse(input).success).toBe(false);
  });
});
