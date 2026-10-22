import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id } from './barrier-multipart-fixture.mjs';
import { createBarrierMultipartRuntime } from '../barrier-multipart-runtime.mjs';
import { BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE } from '../barrier-multipart-protocol.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const hold = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function setup(produce = async function* () {}) {
  const f = fixture(), control = new AbortController(), writes = [], read = [], facts = { opened: 0, observed: 0, current: true, pending: [], completions: 0 };
  const status = { intentId: f.session.id, state: 'admitted', sessionRevision: '0', counts: { pages: 0, seals: 0, parts: 0 },
    roots: { nodes: null, fragments: null, 'geometry-ranges': null, plan: null }, authority: 'none', qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED' };
  const writer = { context: f.context, snapshot: () => structuredClone(status), pending: () => facts.pending,
    async stage(value) { writes.push(value); if (value.kind === 'seal') { status.counts.seals++; status.roots[value.seal.kind] = 'b'.repeat(64); } else if (value.kind === 'part') status.counts.parts++; else status.counts.pages++; status.state = 'staging'; status.sessionRevision = String(Number(status.sessionRevision) + 1); },
    async *readPages(kind) { read.push(kind); yield { synthetic: kind }; },
    async completeProducer(evidence) { facts.completions++; status.sessionRevision = String(Number(status.sessionRevision) + 1);
      return { schemaVersion: 'wfc.pf.barrier-multipart-producer-completion-receipt.v2', intentId: f.session.id, scopeSha256: f.session.scopeSha256, profileSha256: f.session.profileSha256,
        ...evidence, partsSha256: 'c'.repeat(64), commandSha256: 'd'.repeat(64), sessionRevision: status.sessionRevision, recordedAt: new Date().toISOString(), duplicate: false,
        completionProvenance: 'protected-producer-reported', sdkSourceBytesVerified: false, qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' }; },
    async cancel() { status.state = 'cancelled'; } };
  const transport = { async open() { facts.opened++; return writer; } };
  const descriptor = { projectId: id(1), modelVersionId: id(2), loadId: id(4), contentFingerprint: f.frame.contentFingerprint };
  const runtime = createBarrierMultipartRuntime({}, { descriptor, signal: control.signal, isCurrent: () => facts.current, produce,
    async observe() { facts.observed++; return f.frame; } });
  return { ...f, runtime, transport, writer, status, writes, read, facts, control, descriptor };
}
const seals = async function* (_viewer, options) {
  for (const kind of ['nodes', 'fragments', 'geometry-ranges', 'plan']) yield { kind: 'seal', seal: { kind, ...(kind === 'plan' ? { totals: { parts: 1 } } : {}) } };
  yield { kind: 'part', partIndex: 0, planSealSha256: 'b'.repeat(64), bytes: new Uint8Array([1]) };
  yield { kind: 'producer-complete', evidence: { contextSha256: options.packedContext.contextSha256, frameSha256: options.frameObservation.contentSha256,
    roots: Object.fromEntries(['nodes', 'fragments', 'geometry-ranges', 'plan'].map(k => [k, 'b'.repeat(64)])), partCount: 1, bookendProfile: BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE } };
};

test('frame observation uses only the exact loaded tuple and never starts a producer', async () => {
  const f = setup(seals);
  try {
    const request = { projectId: f.descriptor.projectId, modelVersionId: f.descriptor.modelVersionId, contentFingerprint: f.descriptor.contentFingerprint };
    assert.equal((await f.runtime.readFrame(request)).frameObservation, f.frame);
    await assert.rejects(f.runtime.readFrame({ ...request, contentFingerprint: 'b'.repeat(64) }), { code: 'MODEL_SELECTION_CHANGED' });
    assert.equal(f.facts.observed, 1); assert.equal(f.facts.opened, 0);
  } finally { f.runtime.dispose(); }
});
test('start ACK does not wait for the long producer, one writer provides backpressure and status has no publication authority', async () => {
  const gate = hold(); let started = false, seeded;
  const f = setup(async function* (_viewer, options) { started = true; seeded = options; await gate.promise; yield* seals(_viewer, options); });
  try {
    const ack = await f.runtime.start(f.start, f.transport);
    assert.equal(started, true); assert.equal(ack.counts.seals, 0); assert.equal(ack.authority, 'none');
    assert.equal(seeded.startedAt, Date.parse(f.session.createdAt));
    for await (const _ of seeded.readPages('nodes')) { /* exact stored stream */ }
    assert.deepEqual(f.read, ['nodes']);
    await assert.rejects(f.runtime.start({ ...f.start, intentId: id(999) }, f.transport), { code: 'BARRIER_MULTIPART_BUSY' });
    gate.resolve(); await turn();
    assert.equal(f.runtime.status({ intentId: f.session.id }).counts.seals, 4);
    assert.equal(f.runtime.status({ intentId: f.session.id }).counts.parts, 1);
    assert.equal(f.runtime.status({ intentId: f.session.id }).geometryValidation, 'NOT_VALIDATED');
    assert.equal(f.facts.completions, 1);
    await f.runtime.start(f.start, f.transport); assert.equal(f.facts.opened, 1);
  } finally { gate.resolve(); f.runtime.dispose(); }
});
test('four seals without all planned exact part receipts cannot complete the packed producer', async () => {
  for (const wrong of [false, true]) {
    const f = setup(async function* (viewer, options) { for await (const event of seals(viewer, options)) {
      if (event.kind !== 'part') yield event;
      else if (wrong) yield { ...event, partIndex: 1 };
    } });
    try { await f.runtime.start(f.start, f.transport); await turn();
      assert.throws(() => f.runtime.status({ intentId: f.session.id }), { code: 'BARRIER_MULTIPART_FAILED' });
      assert.equal(f.status.counts.seals, 4); assert.equal(f.status.counts.parts, 0);
    } finally { f.runtime.dispose(); }
  }
});
test('clean EOF without terminal evidence, premature evidence, duplicates and trailing data cannot send completion', async () => {
  for (const mode of ['missing', 'early', 'duplicate', 'trailing', 'late-failure', 'wrong-context']) {
    const f = setup(async function* (viewer, options) {
      const events = []; for await (const event of seals(viewer, options)) events.push(event);
      const last = events.at(-1);
      if (mode === 'early') { yield last; return; }
      for (const event of events) { if (event === last && mode === 'missing') continue;
        yield event === last && mode === 'wrong-context' ? { ...event, evidence: { ...event.evidence, contextSha256: 'e'.repeat(64) } } : event; }
      if (mode === 'duplicate') yield last;
      if (mode === 'trailing') yield { kind: 'page', page: {} };
      if (mode === 'late-failure') throw Error('failed after terminal event');
    });
    try { await f.runtime.start(f.start, f.transport); await turn();
      assert.throws(() => f.runtime.status({ intentId: f.session.id }), { code: 'BARRIER_MULTIPART_FAILED' }); assert.equal(f.facts.completions, 0);
    } finally { f.runtime.dispose(); }
  }
});
test('the terminal witness waits for the last exact part ACK and durable completion waits for EOF', async () => {
  const ack = hold(), eof = hold(); let returnedFromPart = false;
  const f = setup(async function* (viewer, options) { yield* seals(viewer, options); await eof.promise; });
  const stage = f.writer.stage;
  f.writer.stage = async value => { if (value.kind === 'part') { await ack.promise; returnedFromPart = true; } return stage(value); };
  try { await f.runtime.start(f.start, f.transport); await turn(); assert.equal(returnedFromPart, false); assert.equal(f.facts.completions, 0);
    ack.resolve(); await turn(); assert.equal(returnedFromPart, true); assert.equal(f.facts.completions, 0);
    eof.resolve(); await turn(); assert.equal(f.facts.completions, 1); assert.equal(f.runtime.status({ intentId: f.session.id }).authority, 'none');
  } finally { ack.resolve(); eof.resolve(); f.runtime.dispose(); }
});
test('unknown completion retains its exact command and only explicit receipt reconciliation clears the local failure', async () => {
  const f = setup(seals), complete = f.writer.completeProducer; let retained;
  f.writer.completeProducer = async evidence => { retained = await complete(evidence); f.facts.pending.push({ command: { schemaVersion: 'wfc.pf.barrier-multipart-complete-producer.v2', idempotencyKey: id(997) } }); throw Error('lost completion ACK'); };
  f.writer.reconcile = async key => { assert.equal(key, id(997)); f.facts.pending = []; return { ...retained, duplicate: true }; };
  try { await f.runtime.start(f.start, f.transport); await turn();
    assert.throws(() => f.runtime.status({ intentId: f.session.id }), { code: 'BARRIER_MULTIPART_RECONCILE_REQUIRED' }); assert.equal(f.facts.completions, 1);
    await f.runtime.reconcile({ intentId: f.session.id }); assert.equal(f.runtime.status({ intentId: f.session.id }).state, 'staging'); assert.equal(f.facts.completions, 1);
  } finally { f.runtime.dispose(); }
});
test('a malformed completion ACK never becomes local completion', async () => {
  const f = setup(seals), complete = f.writer.completeProducer;
  f.writer.completeProducer = async evidence => ({ ...await complete(evidence), sdkSourceBytesVerified: true });
  try { await f.runtime.start(f.start, f.transport); await turn(); assert.throws(() => f.runtime.status({ intentId: f.session.id }), { code: 'BARRIER_MULTIPART_FAILED' }); }
  finally { f.runtime.dispose(); }
});

test('currentness is checked again when the producer resolves after its last acknowledged part', async () => {
  const f = setup(async function* (viewer, options) { yield* seals(viewer, options); f.facts.current = false; });
  try {
    await f.runtime.start(f.start, f.transport); await turn();
    // Re-enable the synthetic status probe so it observes the retained job error.
    f.facts.current = true;
    assert.equal(f.status.counts.parts, 1);
    assert.throws(() => f.runtime.status({ intentId: f.session.id }), { code: 'BARRIER_MULTIPART_FAILED' });
    assert.equal(f.status.authority, 'none');
  } finally { f.runtime.dispose(); }
});
test('cancel aborts and joins the exact producer before acknowledging cancellation', async () => {
  let stopped = false;
  const f = setup(async function* (_viewer, { signal }) { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); stopped = true; });
  try {
    await f.runtime.start(f.start, f.transport);
    const value = await f.runtime.cancel({ intentId: f.session.id });
    assert.equal(stopped, true); assert.equal(value.state, 'cancelled'); assert.equal(f.runtime.status({ intentId: f.session.id }).state, 'cancelled');
    await assert.rejects(f.runtime.cancel({ intentId: id(991) }), { code: 'BARRIER_MULTIPART_CONTEXT_CHANGED' });
  } finally { f.runtime.dispose(); }
});
test('incomplete or failed generation remains recoverable and never seals a complete capture', async () => {
  for (const produce of [async function* () {}, async function* () { throw Error('private source contents'); }]) {
    const f = setup(produce);
    try {
      await f.runtime.start(f.start, f.transport); await turn();
      assert.throws(() => f.runtime.status({ intentId: f.session.id }), { code: 'BARRIER_MULTIPART_FAILED' });
      assert.equal(f.status.counts.seals, 0);
      await assert.rejects(f.runtime.start(f.start, f.transport), { code: 'BARRIER_MULTIPART_RECONCILE_REQUIRED' });
    } finally { f.runtime.dispose(); }
  }
});
test('unknown upload stays retained and blocks replacement without replaying a write', async () => {
  const f = setup(seals); f.writer.stage = async () => { f.facts.pending.push({ command: { idempotencyKey: id(992) } }); throw Error('unknown acknowledgement'); };
  try {
    await f.runtime.start(f.start, f.transport); await turn();
    assert.throws(() => f.runtime.status({ intentId: f.session.id }), { code: 'BARRIER_MULTIPART_RECONCILE_REQUIRED' });
    await assert.rejects(f.runtime.start({ ...f.start, intentId: id(991) }, f.transport), { code: 'BARRIER_MULTIPART_BUSY' });
    assert.equal(f.facts.opened, 1); assert.equal(f.facts.pending.length, 1);
    const reconciled = []; f.writer.reconcile = async key => { reconciled.push(key); f.facts.pending = []; };
    await f.runtime.reconcile({ intentId: f.session.id }); assert.deepEqual(reconciled, [id(992)]);
    assert.equal(f.facts.pending.length, 0); assert.equal(f.facts.opened, 1);
    await f.runtime.cancel({ intentId: f.session.id });
  } finally { f.runtime.dispose(); }
});
test('physical model or frame changes retain terminal model-selection semantics', async () => {
  for (const code of ['BARRIER_MULTIPART_MODEL_CHANGED', 'BARRIER_MULTIPART_FRAME_CHANGED']) {
    const f = setup(async function* () { throw Object.assign(Error('private'), { code }); });
    try { await f.runtime.start(f.start, f.transport); await turn(); assert.throws(() => f.runtime.status({ intentId: f.session.id }), { code: 'MODEL_SELECTION_CHANGED' });
      await assert.rejects(f.runtime.start(f.start, f.transport), { code: 'MODEL_SELECTION_CHANGED' });
      await assert.rejects(f.runtime.cancel({ intentId: f.session.id }), { code: 'MODEL_SELECTION_CHANGED' });
      await assert.rejects(f.runtime.reconcile({ intentId: f.session.id }), { code: 'MODEL_SELECTION_CHANGED' }); }
    finally { f.runtime.dispose(); }
  }
});
test('model disposal stops an in-flight producer and does not consume the following page', async () => {
  const gate = hold(); let consumed = 0;
  const f = setup(async function* () { await gate.promise; consumed++; yield { kind: 'page', page: {} }; consumed++; });
  await f.runtime.start(f.start, f.transport); f.control.abort(); gate.resolve(); await turn();
  assert.equal(consumed, 1); assert.equal(f.writes.length, 0); assert.throws(() => f.runtime.status({ intentId: f.session.id }), { name: 'AbortError' });
});
test('a model change detected while cancellation joins cannot acknowledge a durable cancellation', async () => {
  const f = setup(async function* (_viewer, { signal }) {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    throw Object.assign(Error('changed during join'), { code: 'BARRIER_MULTIPART_MODEL_CHANGED' });
  });
  try {
    await f.runtime.start(f.start, f.transport);
    await assert.rejects(f.runtime.cancel({ intentId: f.session.id }), { code: 'MODEL_SELECTION_CHANGED' });
    assert.notEqual(f.status.state, 'cancelled');
  } finally { f.runtime.dispose(); }
});
test('expired, staged, wrong loaded contexts and a pre-aborted command never start work', async () => {
  for (const change of [f => { f.context.context.effectiveDeadline = new Date(Date.now() - 1).toISOString(); },
    f => { f.session.state = 'staging'; }, f => { f.command.scope.modelLoadId = id(991); }]) {
    let calls = 0; const f = setup(async function* () { calls++; }); change(f);
    try { await assert.rejects(f.runtime.start(f.start, f.transport)); assert.equal(calls, 0); } finally { f.runtime.dispose(); }
  }
  const f = setup(seals), abort = new AbortController(); abort.abort();
  try { await assert.rejects(f.runtime.start(f.start, f.transport, abort.signal), { name: 'AbortError' }); assert.equal(f.facts.opened, 0); }
  finally { f.runtime.dispose(); }
});
