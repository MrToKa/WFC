import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id } from './barrier-multipart-fixture.mjs';
import { createBarrierMultipartRuntime } from '../barrier-multipart-runtime.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const hold = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function setup(produce = async function* () {}) {
  const f = fixture(), control = new AbortController(), writes = [], read = [], facts = { opened: 0, observed: 0, current: true, pending: [] };
  const status = { intentId: f.session.id, state: 'admitted', sessionRevision: '0', counts: { pages: 0, seals: 0, parts: 0 },
    roots: { nodes: null, fragments: null, 'geometry-ranges': null, plan: null }, authority: 'none', qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED' };
  const writer = { context: f.context, snapshot: () => structuredClone(status), pending: () => facts.pending,
    async stage(value) { writes.push(value); if (value.kind === 'seal') { status.counts.seals++; status.roots[value.seal.kind] = 'b'.repeat(64); } else status.counts.pages++; status.state = 'staging'; status.sessionRevision = String(Number(status.sessionRevision) + 1); },
    async *readPages(kind) { read.push(kind); yield { synthetic: kind }; },
    async cancel() { status.state = 'cancelled'; } };
  const transport = { async open() { facts.opened++; return writer; } };
  const descriptor = { projectId: id(1), modelVersionId: id(2), loadId: id(4), contentFingerprint: f.frame.contentFingerprint };
  const runtime = createBarrierMultipartRuntime({}, { descriptor, signal: control.signal, isCurrent: () => facts.current, produce,
    async observe() { facts.observed++; return f.frame; } });
  return { ...f, runtime, transport, writer, status, writes, read, facts, control, descriptor };
}
const seals = async function* () { for (const kind of ['nodes', 'fragments', 'geometry-ranges', 'plan']) yield { kind: 'seal', seal: { kind } }; };

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
  const f = setup(async function* (_viewer, options) { started = true; seeded = options; await gate.promise; yield* seals(); });
  try {
    const ack = await f.runtime.start(f.start, f.transport);
    assert.equal(started, true); assert.equal(ack.counts.seals, 0); assert.equal(ack.authority, 'none');
    assert.equal(seeded.startedAt, Date.parse(f.session.createdAt));
    for await (const _ of seeded.readPages('nodes')) { /* exact stored stream */ }
    assert.deepEqual(f.read, ['nodes']);
    await assert.rejects(f.runtime.start({ ...f.start, intentId: id(999) }, f.transport), { code: 'BARRIER_MULTIPART_BUSY' });
    gate.resolve(); await turn();
    assert.equal(f.runtime.status({ intentId: f.session.id }).counts.seals, 4);
    assert.equal(f.runtime.status({ intentId: f.session.id }).geometryValidation, 'NOT_VALIDATED');
    await f.runtime.start(f.start, f.transport); assert.equal(f.facts.opened, 1);
  } finally { gate.resolve(); f.runtime.dispose(); }
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
