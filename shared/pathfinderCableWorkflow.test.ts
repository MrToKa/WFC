// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { notEvaluatedCalculationAvailability, type CalculationAvailability } from './pathfinderCalculationAvailability.js';
import {
  CABLE_WORKFLOW_LIMITS, cableWorkflowCalculationSchema, cableWorkflowPageSchema, cableWorkflowRowSchema,
  classifyCableCategory, classifyCableEndpoint, classifyCableInitialFill, classifyCableWorkflow,
  type CableWorkflowCalculation, type CableWorkflowRow,
} from './pathfinderCableWorkflow.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const available = (): CalculationAvailability => ({ status: 'confirmed-ready', pointAvailable: true,
  source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false });
const unavailable = (status: 'missing' | 'ambiguous' | 'saved-binding-required' | 'object-unverified' | 'preparation-required'): CalculationAvailability => ({
  status, pointAvailable: false, source: null, approximate: false, candidateObjectIds: [], reasonCode: status.toUpperCase().replaceAll('-', '_'), engineeringAccepted: false,
});
const calculation = (patch: Partial<CableWorkflowCalculation> = {}): CableWorkflowCalculation => ({
  jobId: null, jobStatus: null, itemState: null, outcome: 'not-evaluated', reasonCodes: [], errorCode: null, currentness: 'not-evaluated',
  proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false, ...patch,
});
const row = (patch: Partial<CableWorkflowRow> = {}): CableWorkflowRow => ({
  projectId: id(1), cable: { id: id(10), tag: '=SYNTHETIC-10', fromLocation: 'SYNTHETIC-A', toLocation: 'SYNTHETIC-B',
    routing: null, designLength: null, installLength: '123', cableWriteRevision: '7' },
  mto: 'Control', from: available(), to: available(), calculation: calculation(), ...patch,
});
const ready = (): CableWorkflowCalculation => calculation({ jobId: id(20), jobStatus: 'complete', itemState: 'complete', outcome: 'calculated',
  currentness: 'current', proposalId: id(21), proposalHash: 'a'.repeat(64), reviewable: true });

describe('explicit sealed v7 item display evidence',()=>{
  const proof=()=>({schemaVersion:'wfc.pf.sealed-cable-applicability.v1' as const,dependencyVersion:'pathfinder.dependencies.v7' as const,
    projectId:id(1),jobId:id(20),cableId:id(10),proposalId:id(21),dependencyHash:'b'.repeat(64),scope:'sealed-cable-item' as const});
  it.each(['queued','running'] as const)('allows a current completed cable under a %s parent only with its own exact proof',jobStatus=>{
    const value=row({calculation:{...ready(),jobStatus,itemApplicability:proof()}});
    expect(cableWorkflowRowSchema.safeParse(value).success).toBe(true);expect(classifyCableWorkflow(value).status).toBe('ready-for-review');
    expect(cableWorkflowRowSchema.safeParse({...value,calculation:{...value.calculation,itemApplicability:null}}).success).toBe(false);
  });
  it.each(['projectId','jobId','cableId','proposalId'] as const)('rejects exchanged %s proof ownership',field=>{
    const value=row({calculation:{...ready(),jobStatus:'running',itemApplicability:{...proof(),[field]:id(999)}}});
    expect(cableWorkflowRowSchema.safeParse(value).success).toBe(false);
  });
  it.each(['cancelled','failed'] as const)('does not make a %s parent reviewable',jobStatus=>{
    expect(cableWorkflowRowSchema.safeParse(row({calculation:{...ready(),jobStatus,itemApplicability:proof()}})).success).toBe(false);
  });
});

describe('initial-fill display decision, never write authority', () => {
  it.each(['LV', 'Control', 'Instrumentation'])('offers only the two truly blank fields as a candidate for %s', mto => {
    for (const routing of [null, '', ' \t\r\n ', '\u00a0']) {
      const input = Object.freeze({ mto, routing, designLength: null });
      expect(classifyCableInitialFill(input)).toEqual({ mode: 'initial-fill-candidate', reasonCodes: [] });
    }
  });
  it.each([
    { routing: '/SYNTHETIC', designLength: null },
    { routing: null, designLength: 0 },
    { routing: ' ', designLength: '0' },
    { routing: '', designLength: '' },
    { routing: null, designLength: '20.25' },
    { routing: '/SYNTHETIC', designLength: 20 },
  ])('requires human review for defined/partial existing values %j', value => {
    expect(classifyCableInitialFill({ mto: 'LV', ...value }).mode).toBe('manual-review');
  });
  it.each([
    { routing: undefined, designLength: null },
    { routing: null, designLength: undefined },
    { routing: 0, designLength: null },
    { routing: null, designLength: NaN },
    { routing: null, designLength: Infinity },
    { routing: null, designLength: -Infinity },
    { routing: null, designLength: false },
    { routing: null, designLength: {} },
  ])('does not treat unavailable or malformed current values as blank %j', value => {
    expect(classifyCableInitialFill({ mto: 'Control', ...value }).mode).toBe('blocked');
  });
  it('excludes MV and blocks unknown categories without inventing a default', () => {
    expect(classifyCableInitialFill({ mto: 'MV', routing: null, designLength: null }).mode).toBe('excluded');
    for (const mto of [undefined, null, '', 'lv', 'Unknown', ' Control ']) {
      expect(classifyCableCategory(mto).status).toBe('blocked');
      expect(classifyCableInitialFill({ mto, routing: null, designLength: null }).mode).toBe('blocked');
    }
    expect(classifyCableCategory('Instrumentation')).toEqual({ status: 'eligible', routingCategory: 'Control', reasonCodes: [] });
  });
  it('never returns a permission or changes the current cable values', () => {
    const current = row(), before = structuredClone(current);
    expect(classifyCableInitialFill({ mto: undefined, ...current.cable })).toEqual({ mode: 'blocked', reasonCodes: ['CABLE_CATEGORY_REQUIRED'] });
    const decision = classifyCableInitialFill({ mto: current.mto, routing: current.cable.routing, designLength: current.cable.designLength });
    expect(Object.keys(decision).sort()).toEqual(['mode', 'reasonCodes']);
    expect(current).toEqual(before); expect(current.cable.installLength).toBe('123');
  });
});

describe('endpoint evidence remains independent of calculation outcomes', () => {
  it.each([null, undefined, {}, { status: 'missing' }, { ...available(), engineeringAccepted: true }])('keeps unknown/invalid evidence unevaluated: %j', value => {
    expect(classifyCableEndpoint(value)).toEqual({ status: 'not-evaluated', evidence: null, reasonCodes: ['AVAILABILITY_NOT_EVALUATED'] });
  });
  it('requires evaluated missing/ambiguous evidence before asking for endpoint resolution', () => {
    expect(classifyCableEndpoint(notEvaluatedCalculationAvailability()).status).toBe('not-evaluated');
    for (const status of ['missing', 'ambiguous', 'saved-binding-required', 'object-unverified'] as const)
      expect(classifyCableEndpoint(unavailable(status))).toMatchObject({ status: 'needs-resolution', evidence: { status } });
    expect(classifyCableEndpoint(unavailable('preparation-required')).status).toBe('blocked');
  });
  it('retains automatic point approximation and never converts it to engineering acceptance', () => {
    const automatic: CalculationAvailability = { status: 'automatic-ready', pointAvailable: true,
      source: 'automatic-model-candidate', approximate: true, candidateObjectIds: ['dbid:44'], reasonCode: null, engineeringAccepted: false };
    expect(classifyCableEndpoint(automatic)).toMatchObject({ status: 'ready', evidence: { approximate: true, engineeringAccepted: false } });
  });
});

describe('cable workflow status is a display projection', () => {
  it('separates unrequested calculation from unevaluated endpoint availability', () => {
    expect(classifyCableWorkflow(row())).toEqual({ status: 'needs-routing', reasonCodes: ['CALCULATION_NOT_REQUESTED'] });
    expect(classifyCableWorkflow(row({ from: notEvaluatedCalculationAvailability() })).status).toBe('blocked');
    expect(classifyCableWorkflow(undefined)).toEqual({ status: 'blocked', reasonCodes: ['WORKFLOW_EVIDENCE_UNAVAILABLE'] });
  });
  it.each(['queued', 'running'] as const)('shows %s progress without relabeling unknown endpoints as missing', jobStatus => {
    const input = row({ from: notEvaluatedCalculationAvailability(), calculation: calculation({ jobId: id(20), jobStatus, itemState: jobStatus === 'queued' ? 'waiting' : 'running' }) });
    expect(classifyCableWorkflow(input).status).toBe('calculating');
    expect(classifyCableEndpoint(input.from).status).toBe('not-evaluated');
  });
  it('does not label a blocked missing-From item calculating merely because sibling cables are running', () => {
    const input = row({ from: unavailable('missing'), calculation: calculation({ jobId: id(20), jobStatus: 'running',
      itemState: 'blocked', outcome: 'locations-required', reasonCodes: ['FROM_POINT_REQUIRED'] }) });
    expect(classifyCableWorkflow(input)).toEqual({ status: 'needs-routing', reasonCodes: ['FROM_POINT_REQUIRED', 'MISSING'] });
    expect(classifyCableEndpoint(input.from)).toMatchObject({ status: 'needs-resolution', evidence: { status: 'missing' } });
  });
  it('preserves a settings refusal for a blocked item in an otherwise active job', () => {
    const input = row({ calculation: calculation({ jobId: id(20), jobStatus: 'running', itemState: 'blocked',
      outcome: 'settings-required', reasonCodes: ['PROJECT_ALLOWANCES_REQUIRED'], errorCode: 'SETTINGS_UNAVAILABLE' }) });
    expect(classifyCableWorkflow(input)).toEqual({ status: 'blocked', reasonCodes: ['PROJECT_ALLOWANCES_REQUIRED', 'SETTINGS_UNAVAILABLE', 'SETTINGS_REQUIRED'] });
  });
  it('distinguishes an already calculated item awaiting sibling completion without relaxing Review', () => {
    const input = row({ calculation: { ...ready(), jobStatus: 'running', reviewable: false } });
    expect(classifyCableWorkflow(input)).toEqual({ status: 'blocked', reasonCodes: ['CALCULATED_AWAITING_JOB_COMPLETION'] });
    expect(cableWorkflowRowSchema.safeParse({ ...input, calculation: { ...input.calculation, reviewable: true } }).success).toBe(false);
    expect(classifyCableWorkflow(row({ calculation: calculation({ jobId: id(20), jobStatus: 'running' }) })))
      .toEqual({ status: 'blocked', reasonCodes: ['CALCULATION_ITEM_NOT_EVALUATED'] });
  });
  it.each([
    ['deadline-exceeded', 'ENGINE_TIMEOUT', 'CALCULATION_DEADLINE_EXCEEDED'],
    ['resource-limit', 'ENGINE_GEOMETRY_LIMIT', 'CALCULATION_RESOURCE_LIMIT'],
    ['category-required', 'UNSUPPORTED_CATEGORY', 'CABLE_CATEGORY_REQUIRED'],
    ['model-required', 'ACTIVE_MODEL_UNAVAILABLE', 'MODEL_REQUIRED'],
  ] as const)('retains bounded %s diagnostics instead of a generic not-ready label', (outcome, errorCode, derived) => {
    const input = row({ calculation: calculation({ jobId: id(20), jobStatus: 'complete', itemState: 'complete', outcome,
      reasonCodes: ['ENGINE_REFUSED'], errorCode }) });
    expect(classifyCableWorkflow(input)).toEqual({ status: 'blocked', reasonCodes: ['ENGINE_REFUSED', errorCode, derived] });
  });
  it('exposes a current complete proposal for review without authorizing automatic overwrite', () => {
    const input = row({ cable: { ...row().cable, routing: '/EXISTING', designLength: '0' }, calculation: ready() });
    expect(classifyCableWorkflow(input)).toEqual({ status: 'ready-for-review', reasonCodes: [] });
    expect(classifyCableInitialFill({ mto: input.mto, ...input.cable }).mode).toBe('manual-review');
    expect(classifyCableWorkflow(input)).not.toHaveProperty('canApply');
  });
  it('requires explicit current accepted-result evidence for up-to-date rather than the presence of old values', () => {
    const input = row({ cable: { ...row().cable, routing: '/EXISTING', designLength: '20' } });
    expect(classifyCableWorkflow(input).status).toBe('needs-routing');
    expect(classifyCableWorkflow({ ...input, calculation: calculation({ currentness: 'current', acceptedMatchesCurrent: true }) }).status).toBe('up-to-date');
    expect(classifyCableWorkflow(row({ calculation: calculation({ currentness: 'current', acceptedMatchesCurrent: true }) })).status).toBe('blocked');
  });
  it('keeps no-path, stale, cancellation and failed jobs distinguishable from missing endpoints', () => {
    for (const [outcome, reason] of [['no-path', 'NO_PATH'], ['stale', 'CALCULATION_STALE']] as const)
      expect(classifyCableWorkflow(row({ calculation: calculation({ jobId: id(20), jobStatus: 'complete', outcome }) })))
        .toEqual({ status: 'needs-routing', reasonCodes: [reason] });
    for (const jobStatus of ['cancelled', 'failed'] as const)
      expect(classifyCableWorkflow(row({ calculation: calculation({ jobId: id(20), jobStatus }) })).status).toBe('blocked');
    expect(classifyCableWorkflow(row({ calculation: calculation({ jobId: id(20), jobStatus: 'complete', outcome: 'no-path', currentness: 'unavailable' }) })))
      .toEqual({ status: 'blocked', reasonCodes: ['CALCULATION_CURRENTNESS_UNAVAILABLE'] });
    expect(classifyCableWorkflow(row({ from: unavailable('missing') }))).toEqual({ status: 'needs-routing', reasonCodes: ['MISSING'] });
  });
  it('cannot classify MV/unknown categories as ready even when a complete proposal is supplied', () => {
    expect(classifyCableWorkflow(row({ mto: 'MV', calculation: ready() })).status).toBe('excluded');
    expect(classifyCableWorkflow(row({ mto: 'Other', calculation: ready() })).status).toBe('blocked');
  });
});

describe('bounded workflow DTOs', () => {
  it('refuses incoherent proposal references and premature reviewable/current evidence', () => {
    const valid = ready(); expect(cableWorkflowCalculationSchema.safeParse(valid).success).toBe(true);
    for (const patch of [{ jobId: null }, { jobStatus: 'running' }, { proposalHash: null }, { proposalId: null },
      { currentness: 'changed' }, { outcome: 'not-evaluated' }, { itemState: 'running' }, { itemState: null }])
      expect(cableWorkflowCalculationSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
    expect(cableWorkflowRowSchema.safeParse(row({ from: unavailable('missing'), calculation: valid })).success).toBe(false);
    expect(cableWorkflowCalculationSchema.safeParse(calculation({ acceptedMatchesCurrent: true })).success).toBe(false);
  });
  it('bounds diagnostic codes and rejects per-item/job contradictions before displaying progress', () => {
    const base = calculation({ jobId: id(20), jobStatus: 'running', itemState: 'waiting' });
    expect(cableWorkflowCalculationSchema.safeParse(base).success).toBe(true);
    for (const patch of [{ jobId: null, jobStatus: null }, { jobStatus: 'complete' }, { outcome: 'settings-required' },
      { reasonCodes: ['DUPLICATE', 'DUPLICATE'] }, { reasonCodes: ['bad-code'] }, { errorCode: 'X'.repeat(97) },
      { reasonCodes: Array.from({ length: 65 }, (_, n) => `REASON_${n}`) }])
      expect(cableWorkflowCalculationSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    expect(cableWorkflowCalculationSchema.parse({ ...base, reasonCodes: Array.from({ length: 64 }, (_, n) => `REASON_${n}`), errorCode: 'ENGINE_DEADLINE' }).reasonCodes).toHaveLength(64);
  });
  it('retains exact revisions/length text and rejects invented authority fields', () => {
    const input = row({ cable: { ...row().cable, designLength: '0', cableWriteRevision: '9223372036854775807' } });
    expect(cableWorkflowRowSchema.parse(input)).toEqual(input);
    expect(cableWorkflowRowSchema.safeParse({ ...input, canApply: true }).success).toBe(false);
    expect(cableWorkflowCalculationSchema.safeParse({ ...ready(), mandate: true }).success).toBe(false);
    for (const designLength of ['', undefined, NaN, Infinity])
      expect(cableWorkflowRowSchema.safeParse({ ...input, cable: { ...input.cable, designLength } }).success).toBe(false);
  });
  it('allows exactly100 sorted owned matches and refuses overflow, duplicates, foreign scope and omitted matching rows', () => {
    const rows = Array.from({ length: CABLE_WORKFLOW_LIMITS.pageSize }, (_, n) => row({ cable: { ...row().cable, id: id(1000 + n) } }));
    const page = { schemaVersion: 'wfc.pf.cable-workflow-page.v1', projectId: id(1), querySha256: 'a'.repeat(64), contextSha256: 'b'.repeat(64),
      scannedCount: 100, scannedThroughCableId: rows.at(-1)!.cable.id, rows, nextCursor: 'c3ludGhldGljLW5leHQ' };
    expect(cableWorkflowPageSchema.parse(page).rows).toHaveLength(100);
    for (const patch of [{ rows: [...rows, row()] }, { rows: [rows[0], rows[0]] }, { rows: [rows[1], rows[0]] },
      { rows: [row({ projectId: id(2) })] }, { scannedThroughCableId: id(9999) }, { scannedCount: 99 },
      { rows: [row({ cable: { ...row().cable, id: id(9999) } })] }])
      expect(cableWorkflowPageSchema.safeParse({ ...page, ...patch }).success).toBe(false);
  });
  it('continues a fully scanned empty filtered page instead of claiming no matching cables remain', () => {
    const page = { schemaVersion: 'wfc.pf.cable-workflow-page.v1', projectId: id(1), querySha256: 'a'.repeat(64), contextSha256: 'b'.repeat(64),
      scannedCount: 200, scannedThroughCableId: id(2000), rows: [], nextCursor: 'c3ludGhldGljLW5leHQ' };
    expect(cableWorkflowPageSchema.parse(page)).toEqual(page);
    for (const patch of [{ scannedCount: 201 }, { scannedCount: -1 }, { scannedCount: 1.5 }, { scannedThroughCableId: null },
      { scannedCount: 0 }, { scannedCount: 0, scannedThroughCableId: null }])
      expect(cableWorkflowPageSchema.safeParse({ ...page, ...patch }).success).toBe(false);
  });
  it('represents exhausted empty scans with no cursor and retains scanned nonmatches on a final empty page', () => {
    const page = { schemaVersion: 'wfc.pf.cable-workflow-page.v1', projectId: id(1), querySha256: 'a'.repeat(64), contextSha256: 'b'.repeat(64),
      scannedCount: 0, scannedThroughCableId: null, rows: [], nextCursor: null };
    expect(cableWorkflowPageSchema.parse(page)).toEqual(page);
    expect(cableWorkflowPageSchema.safeParse({ ...page, scannedCount: 12, scannedThroughCableId: id(20) }).success).toBe(true);
    expect(cableWorkflowPageSchema.safeParse({ ...page, rows: [row()] }).success).toBe(false);
    expect(cableWorkflowPageSchema.safeParse({ ...page, nextCursor: 'YW5vdGhlcg' }).success).toBe(false);
  });
  it('requires exact bounded query/context hashes and opaque base64url cursor text', () => {
    const page = { schemaVersion: 'wfc.pf.cable-workflow-page.v1', projectId: id(1), querySha256: 'a'.repeat(64), contextSha256: 'b'.repeat(64),
      scannedCount: 1, scannedThroughCableId: id(10), rows: [row()], nextCursor: 'a'.repeat(512) };
    expect(cableWorkflowPageSchema.parse(page).nextCursor).toHaveLength(512);
    for (const patch of [{ querySha256: 'A'.repeat(64) }, { querySha256: 'a'.repeat(63) }, { contextSha256: 'b'.repeat(64) + '\n' },
      { nextCursor: '' }, { nextCursor: 'a'.repeat(513) }, { nextCursor: 'ZGF0YQ==' }, { nextCursor: 'YWJj\n' },
      { nextCursor: 'path/unsafe' }, { nextAfterCableId: id(10) }])
      expect(cableWorkflowPageSchema.safeParse({ ...page, ...patch }).success).toBe(false);
  });
});
