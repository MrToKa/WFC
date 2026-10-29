import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runManagedHostWorker } from './host-worker.mjs';

const id = n => `ec900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORIGIN = 'http://127.0.0.1:5191', PREFIX = '/api/pathfinder-producer-control';
const error = code => Object.assign(new Error(code), { code });
const reply = value => ({ ok: true, status: 200, body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(value)); } } });
const proof = Object.freeze({ joined: true, removed: true, containerId: 'e'.repeat(64) });

/** Every external dependency is an in-memory fake. These tests cannot start
 * a helper, create a broker connection, issue HTTP or wait on a real clock. */
function fixture({ records = [] } = {}) {
  const configuration = { key: 'a'.repeat(64), owner: id(1), project: 'wfc-pathfinder-local-abcdef123456', image: 'sha256:' + 'b'.repeat(64), runtimeInventorySha256: 'c'.repeat(64) };
  const identity = { instanceId: id(2), projectId: id(3), modelVersionId: id(4), loadId: id(5), sessionId: id(6) };
  const attempt = { attemptId: id(7), identity, owner: configuration.owner, project: configuration.project, image: configuration.image, runtimeInventorySha256: configuration.runtimeInventorySha256,
    resources: { projectId: identity.projectId, modelVersionId: identity.modelVersionId, sessionId: identity.sessionId, capability: 'd'.repeat(43) } };
  const controller = new AbortController(), calls = [], observations = [], retainedInputs = [], retiredInputs = [], sentReplies = [], sentJoins = [];
  const flags = { retainFails: false, closeReplyFailures: 0, exchangeReplyFailures: 0, joinFailures: 0, openFailsWithJoinProof: false, beforeStartFails: false, abortOnClaim: false, allowRecoveryTick: false };
  let claims = 0, closeCalls = 0, exchanges = 0, opens = 0, beforeStarts = 0, outerDelays = 0;
  const commands = [{ kind: 'close', requestId: id(8) }];
  const seccompBytes = Buffer.from(JSON.stringify({ defaultAction: 'SCMP_ACT_ERRNO', syscalls: [{ names: ['read', 'write'], action: 'SCMP_ACT_ALLOW' }] }));
  const journal = {
    async list() { calls.push('journal-list'); return [...records]; },
    async retain(input) {
      calls.push('journal-retain'); retainedInputs.push(structuredClone(input)); if (flags.retainFails) throw error('PRODUCER_PROOF_JOURNAL_LIMIT');
      const existing = records.find(value => value.attemptId === input.attemptId); if (existing) { assert.deepEqual(existing.proof, input.proof); return existing; }
      const record = { schemaVersion: 'wfc.pf.host-join-proof.v1', workOwner: id(90), owner: configuration.owner, project: configuration.project, image: configuration.image,
        runtimeInventorySha256: configuration.runtimeInventorySha256, attemptId: input.attemptId, proof: structuredClone(input.proof), recordSha256: 'f'.repeat(64) };
      records.push(record); return record;
    },
    async retire(record, acknowledgement) {
      calls.push('journal-retire'); assert.equal(acknowledgement.acknowledged, true); assert.equal(typeof acknowledgement.duplicate, 'boolean');
      retiredInputs.push({ record: structuredClone(record), acknowledgement }); const index = records.findIndex(value => value.attemptId === record.attemptId);
      assert.ok(index >= 0); assert.deepEqual(records[index], record); records.splice(index, 1);
    },
  };
  const broker = { async request() { assert.fail('No resource RPC should occur in these ownership tests'); }, async dispose() { calls.push('broker-dispose'); } };
  const client = { async exchange(envelope) { calls.push('exchange'); exchanges++; return { ...envelope, type: 'PREPARATION_OBJECTS', payload: {
    schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: 'names', names: ['/B001'], rootObjectId: null, cursor: 0, matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1',
    indexedObjectCount: 1, propertyScan: null, objects: [], nextCursor: null, complete: true } }; },
    async close() { calls.push('client-close'); closeCalls++; return proof; } };
  const dependencies = {
    createBroker() { calls.push('create-broker'); return broker; },
    async openClient(options) {
      calls.push('open-client'); opens++; assert.ok(calls.indexOf('before-start') < calls.indexOf('open-client'));
      assert.equal(options.profile.attemptId, attempt.attemptId); assert.deepEqual(options.identity, identity); assert.equal(options.broker, broker);
      assert.equal(JSON.stringify(options.profile).includes(configuration.key), false); assert.equal(JSON.stringify(options.profile).includes(attempt.resources.capability), false);
      if (flags.openFailsWithJoinProof) { const failure = error('PRODUCER_CLIENT_CANCELLED'); Object.defineProperty(failure, 'joinProof', { value: proof, enumerable: false }); throw failure; }
      return client;
    },
    async fetch(url, init) {
      assert.ok(url.startsWith(ORIGIN + PREFIX + '/'), 'Only the fixed host control family may be requested');
      assert.equal(init.redirect, 'error'); assert.equal(init.headers.Origin, ORIGIN); assert.equal(init.headers['X-WFC-PF-Control-Key'], configuration.key);
      assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers.Cookie, undefined); assert.equal(init.headers['X-WFC-PF-Producer-Capability'], undefined);
      const suffix = url.slice((ORIGIN + PREFIX).length); calls.push('http' + suffix);
      if (suffix === '/claim') { claims++; if (flags.abortOnClaim) { controller.abort(); return reply({ attempt: null }); } return reply({ attempt: claims === 1 ? attempt : null }); }
      if (suffix === '/' + attempt.attemptId + '/next') { const command = commands.shift(); assert.ok(command, 'Unexpected extra command poll'); return reply({ command, joined: false, quarantined: false }); }
      if (suffix === '/' + attempt.attemptId + '/reply') {
        const body = JSON.parse(init.body); sentReplies.push(body);
        if (body.requestId === id(8) && flags.closeReplyFailures-- > 0 || body.requestId === id(9) && flags.exchangeReplyFailures-- > 0) throw error('PRODUCER_CONTROL_TIMEOUT');
        return reply({ acknowledged: true, duplicate: false });
      }
      if (suffix === '/' + attempt.attemptId + '/joined') {
        const body = JSON.parse(init.body); sentJoins.push(body); assert.deepEqual(body, proof);
        assert.ok(records.some(value => value.attemptId === attempt.attemptId && JSON.stringify(value.proof) === JSON.stringify(proof)), 'The exact proof must be durable before cleanup POST');
        if (flags.joinFailures-- > 0) throw error('PRODUCER_CONTROL_TIMEOUT'); return reply({ acknowledged: true, duplicate: sentJoins.length > 1 });
      }
      if (suffix === '/' + attempt.attemptId + '/fault') { assert.deepEqual(JSON.parse(init.body), {}); return reply({ quarantined: true }); }
      assert.fail('Unexpected fake control path');
    },
    async delay(milliseconds, _value, { signal } = {}) {
      calls.push('delay-' + milliseconds); if (milliseconds === 500 || milliseconds === 200) return;
      outerDelays++; if (flags.allowRecoveryTick && outerDelays === 1) return;
      controller.abort(); assert.ok(signal?.aborted); throw error('PRODUCER_TEST_STOP');
    },
  };
  const run = () => runManagedHostWorker({ configuration, seccompBytes, seccompSha256: createHash('sha256').update(seccompBytes).digest('hex'), journal, signal: controller.signal,
    async beforeStart(input) { calls.push('before-start'); beforeStarts++; assert.equal(input.attemptId, attempt.attemptId); assert.deepEqual(input.identity, identity);
      if (flags.beforeStartFails) { const failure = error('PRODUCER_HOST_RECOVERY_REQUIRED'); Object.defineProperty(failure, 'fatalCleanup', { value: true, enumerable: false }); throw failure; } },
    observe: value => observations.push(value) }, dependencies);
  return { configuration, identity, attempt, controller, calls, flags, commands, records, journal, dependencies, retainedInputs, retiredInputs, sentReplies, sentJoins, observations, run,
    get counts() { return { claims, closeCalls, exchanges, opens, beforeStarts, outerDelays }; } };
}

for (const phase of ['normal-close', 'startup-refusal']) test(`a proof persistence failure after ${phase} is fatal and exposes the exact private recovery proof`, { timeout: 2000 }, async () => {
  const f = fixture(); f.flags.retainFails = true; f.flags.openFailsWithJoinProof = phase === 'startup-refusal';
  let failure; try { await f.run(); assert.fail('Proof persistence failure must escape the daemon'); } catch (caught) { failure = caught; }
  assert.equal(failure.code, 'PRODUCER_JOIN_PROOF_PERSISTENCE_UNKNOWN'); assert.equal(failure.fatalCleanup, true);
  assert.deepEqual(failure.recoveryProof, { attemptId: f.attempt.attemptId, proof });
  assert.equal(Object.getOwnPropertyDescriptor(failure, 'recoveryProof').enumerable, false); assert.equal(Object.getOwnPropertyDescriptor(failure, 'fatalCleanup').enumerable, false);
  assert.equal(JSON.stringify(failure).includes(proof.containerId), false); assert.equal(JSON.stringify(failure).includes(f.configuration.key), false);
  assert.equal(f.counts.claims, 1); assert.equal(f.counts.opens, 1); assert.equal(f.counts.outerDelays, 0); assert.equal(f.sentJoins.length, 0); assert.equal(f.retiredInputs.length, 0);
  assert.deepEqual(f.retainedInputs, [{ attemptId: f.attempt.attemptId, proof }]);
  if (phase === 'normal-close') assert.deepEqual(f.sentReplies, [{ requestId: id(8), value: proof }]);
});

test('a lost cleanup ACK after a successful close ACK retains proof and records a refusal instead of silently succeeding', { timeout: 2000 }, async () => {
  const f = fixture(); f.flags.joinFailures = 1; const result = await f.run();
  assert.equal(result.lastErrorCode, 'PRODUCER_CONTROL_TIMEOUT'); assert.equal(f.records.length, 1); assert.equal(f.retiredInputs.length, 0);
  assert.deepEqual(f.records[0].proof, proof); assert.equal(f.counts.opens, 1); assert.equal(f.counts.closeCalls, 1); assert.equal(f.counts.claims, 1);
  assert.ok(f.calls.indexOf('journal-retain') < f.calls.indexOf('http/' + f.attempt.attemptId + '/joined'));
});

test('a lost close reply ACK never repeats physical close and still retains exact proof when the separate join ACK is lost', { timeout: 2000 }, async () => {
  const f = fixture(); f.flags.closeReplyFailures = 3; f.flags.joinFailures = 1; const result = await f.run();
  assert.equal(result.lastErrorCode, 'PRODUCER_CONTROL_TIMEOUT'); assert.equal(f.counts.closeCalls, 1); assert.equal(f.counts.opens, 1);
  assert.deepEqual(f.sentReplies, Array.from({ length: 3 }, () => ({ requestId: id(8), value: proof })));
  assert.deepEqual(f.sentJoins, [proof]); assert.deepEqual(f.records[0].proof, proof); assert.equal(f.retiredInputs.length, 0);
});

test('the next tick replays a retained join proof before another claim and retires only its successful ACK', { timeout: 2000 }, async () => {
  const f = fixture(); f.flags.joinFailures = 1; f.flags.allowRecoveryTick = true; await f.run();
  assert.deepEqual(f.sentJoins, [proof, proof]); assert.equal(f.records.length, 0); assert.equal(f.retiredInputs.length, 1); assert.equal(f.retiredInputs[0].acknowledgement.duplicate, true);
  assert.equal(f.counts.opens, 1); assert.equal(f.counts.closeCalls, 1); assert.equal(f.counts.claims, 2);
  const retirement = f.calls.indexOf('journal-retire'), secondClaim = f.calls.lastIndexOf('http/claim'); assert.ok(retirement < secondClaim);
});

test('a restarted daemon flushes an already durable proof without launching any helper or recapturing', { timeout: 2000 }, async () => {
  const before = fixture(); before.flags.joinFailures = 1; await before.run(); assert.equal(before.records.length, 1);
  const restarted = fixture({ records: before.records }); restarted.flags.abortOnClaim = true; await restarted.run();
  assert.deepEqual(restarted.sentJoins, [proof]); assert.equal(restarted.records.length, 0); assert.equal(restarted.counts.opens, 0); assert.equal(restarted.counts.beforeStarts, 0); assert.equal(restarted.counts.exchanges, 0);
  assert.ok(restarted.calls.indexOf('journal-retire') < restarted.calls.indexOf('http/claim'));
});

test('lost data reply ACK retries the exact response without rerunning capture before normal cleanup', { timeout: 2000 }, async () => {
  const f = fixture(); const { sessionId: _sessionId, ...identity } = f.identity;
  const envelope = { channel: 'wfc-routings-viewer', protocolVersion: 1, ...identity, requestId: id(9), type: 'READ_PREPARATION_OBJECTS',
    payload: { schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: 'names', names: ['/B001'], rootObjectId: null, cursor: 0, limit: 128 } };
  f.commands.unshift({ kind: 'exchange', requestId: id(9), envelope }); f.flags.exchangeReplyFailures = 2; await f.run();
  assert.equal(f.counts.exchanges, 1); const dataReplies = f.sentReplies.filter(value => value.requestId === id(9)); assert.equal(dataReplies.length, 3);
  for (const value of dataReplies) assert.deepEqual(value, dataReplies[0]); assert.equal(f.counts.closeCalls, 1); assert.equal(f.records.length, 0);
});

test('a duplicate durable intent refusal happens before opening a helper and exits through the fatal recovery path', { timeout: 2000 }, async () => {
  const f = fixture(); f.flags.beforeStartFails = true;
  await assert.rejects(f.run(), { code: 'PRODUCER_HOST_RECOVERY_REQUIRED' }); assert.equal(f.counts.opens, 0); assert.equal(f.counts.claims, 1);
  assert.equal(f.retainedInputs.length, 0); assert.equal(f.sentJoins.length, 0); assert.equal(f.counts.outerDelays, 0);
});
