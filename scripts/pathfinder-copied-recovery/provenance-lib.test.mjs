import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertNoAuth, sha, validateChain } from './provenance-lib.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const directory = 'private/synthetic-journal';
const refuses = (fn, code) => assert.throws(fn, error => error.code === code);
function fixture() {
  const intent = Buffer.from(JSON.stringify({ schemaVersion: 'synthetic.intent.v1', projectId: 'synthetic-project', archiveSha256: 'a'.repeat(64) }));
  let previous = digest(intent);
  const events = [], records = [];
  for (let sequence = 0; sequence < 67; sequence++) {
    const name = 'event-' + String(sequence).padStart(4, '0') + '.private.json';
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 'pathfinder.copied-project.import-event.v1', sequence, previousSha256: previous, stage: sequence === 66 ? 'complete' : 'observed', observation: { status: 'PASS', synthetic: true } }));
    previous = digest(bytes);
    events.push({ name, bytes });
    records.push({ path: directory + '/' + name, bytes: bytes.length, sha256: previous });
  }
  return { intent, events, expected: { events: 67, bytes: intent.length + events.reduce((sum, event) => sum + event.bytes.length, 0), finalSha256: previous, recordsSha256: digest(JSON.stringify(records)), intent: { sha256: digest(intent) } } };
}
const check = f => validateChain(f.intent, f.events, directory, f.expected);
function alter(f, index, patch) { f.events[index].bytes = Buffer.from(JSON.stringify({ ...JSON.parse(f.events[index].bytes), ...patch })); }

test('hash helper agrees with a known SHA256 vector', () => assert.equal(sha(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
test('plain synthetic provenance and project calculation inputs are allowed', () => {
  assert.equal(assertNoAuth({ source: { revision: 'abc123', project: { secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' } }, status: 'PASS', objectNames: ['motor', 'tray'], retryable: false, absent: null, count: 67 }), true);
});
test('safe nested JSON response bodies are scanned without changing their value', () => {
  const input = { body: JSON.stringify({ detail: JSON.stringify({ status: 'complete', modelVersionId: 'synthetic' }) }), rows: ['[1,true,null]'] };
  const before = JSON.stringify(input); assert.equal(assertNoAuth(input), true); assert.equal(JSON.stringify(input), before);
});
for (const key of ['password', 'token', 'accessToken', 'refreshToken', 'bearer', 'cookie', 'authorization', 'jwtSecret', 'databasePassword', 'storagePassword', 'secret', 'secretSha256', 'settings', 'credentials']) {
  test('sensitive nested key is refused: ' + key, () => refuses(() => assertNoAuth({ records: [{ response: { [key]: null } }] }), 'PROVENANCE_AUTH_KEY'));
}
test('authentication key guard is case insensitive', () => refuses(() => assertNoAuth({ outer: { PaSsWoRd: 'synthetic-only' } }), 'PROVENANCE_AUTH_KEY'));
test('a sensitive key in stringified JSON is refused', () => refuses(() => assertNoAuth({ body: JSON.stringify({ nested: [{ authorization: 'synthetic-only' }] }) }), 'PROVENANCE_AUTH_KEY'));
test('a sensitive key in twice-stringified nested JSON is refused', () => refuses(() => assertNoAuth({ body: JSON.stringify({ body: JSON.stringify({ Token: 'synthetic-only' }) }) }), 'PROVENANCE_AUTH_KEY'));
for (const [name, value] of [
  ['bearer', 'prefix Bearer synthetic-token suffix'],
  ['case-insensitive bearer', 'bearer synthetic-token'],
  ['JWT-shaped text', 'eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGlj.c2lnbmF0dXJl'],
  ['Viewer cookie', 'wfc_viewer_session=synthetic-only'],
  ['case-insensitive Viewer cookie', 'WFC_VIEWER_SESSION=synthetic-only'],
]) test('sensitive value guard refuses ' + name, () => refuses(() => assertNoAuth({ observations: [{ text: value }] }), 'PROVENANCE_AUTH_VALUE'));
test('malformed JSON-shaped benign string does not bypass a sensitive raw value', () => refuses(() => assertNoAuth({ body: '{invalid Bearer synthetic-token' }), 'PROVENANCE_AUTH_VALUE'));
test('malformed JSON-shaped benign string is allowed without inventing fields', () => assert.equal(assertNoAuth({ body: '{not-json' }), true));
test('depth64 is allowed but one deeper node is refused', () => {
  let allowed = null; for (let i = 0; i < 64; i++) allowed = { child: allowed };
  assert.equal(assertNoAuth(allowed), true);
  refuses(() => assertNoAuth({ child: allowed }), 'PROVENANCE_SCAN_BOUND');
});
test('wide untrusted JSON is bounded by scanned node count', () => refuses(() => assertNoAuth(Array(500000).fill(null)), 'PROVENANCE_SCAN_BOUND'));
test('a cyclic non-JSON input is still bounded', () => { const input = {}; input.child = input; refuses(() => assertNoAuth(input), 'PROVENANCE_SCAN_BOUND'); });

test('exact67-event synthetic chain matches independently constructed receipt pins', () => {
  const f = fixture(); const result = check(f);
  assert.deepEqual(result, { events: 67, bytes: f.expected.bytes, finalSha256: f.expected.finalSha256, recordsSha256: f.expected.recordsSha256 });
});
test('chain verification does not mutate source bytes, event order or receipt', () => {
  const f = fixture(), before = JSON.stringify({ events: f.events, expected: f.expected }), intentHash = digest(f.intent);
  check(f); assert.equal(JSON.stringify({ events: f.events, expected: f.expected }), before); assert.equal(digest(f.intent), intentHash);
});
test('a missing event is refused even when all remaining records are valid', () => { const f = fixture(); f.events.pop(); refuses(() => check(f), 'PROVENANCE_EVENT_COUNT'); });
test('an additional event is refused', () => { const f = fixture(); f.events.push(f.events[66]); refuses(() => check(f), 'PROVENANCE_EVENT_COUNT'); });
test('receipt must independently assert exactly67 events', () => { const f = fixture(); f.expected.events = 66; refuses(() => check(f), 'PROVENANCE_EVENT_COUNT'); });
test('non-array event input is refused', () => { const f = fixture(); f.events = { ...f.events, length: 67 }; refuses(() => check(f), 'PROVENANCE_EVENT_COUNT'); });
test('event filesystem order is verified', () => { const f = fixture(); [f.events[20], f.events[21]] = [f.events[21], f.events[20]]; refuses(() => check(f), 'PROVENANCE_CHAIN'); });
test('event filename is exact and does not accept path traversal', () => { const f = fixture(); f.events[0].name = '../event-0000.private.json'; refuses(() => check(f), 'PROVENANCE_CHAIN'); });
test('event filename requires zero padding and exact suffix', () => { const f = fixture(); f.events[1].name = 'event-1.private.json'; refuses(() => check(f), 'PROVENANCE_CHAIN'); });
test('duplicate event name cannot be substituted for another sequence', () => { const f = fixture(); f.events[22].name = f.events[21].name; refuses(() => check(f), 'PROVENANCE_CHAIN'); });
test('event schema is pinned', () => { const f = fixture(); alter(f, 5, { schemaVersion: 'other.v1' }); refuses(() => check(f), 'PROVENANCE_CHAIN'); });
test('event sequence must equal its position', () => { const f = fixture(); alter(f, 5, { sequence: 6 }); refuses(() => check(f), 'PROVENANCE_CHAIN'); });
test('event sequence numeric type is strict', () => { const f = fixture(); alter(f, 5, { sequence: '5' }); refuses(() => check(f), 'PROVENANCE_CHAIN'); });
test('the first event is pinned to exact intent bytes', () => { const f = fixture(); alter(f, 0, { previousSha256: '0'.repeat(64) }); refuses(() => check(f), 'PROVENANCE_CHAIN'); });
test('each event references the immediately preceding raw bytes', () => { const f = fixture(); alter(f, 34, { previousSha256: digest(f.events[32].bytes) }); refuses(() => check(f), 'PROVENANCE_CHAIN'); });
test('middle event content tamper is detected by the following link', () => { const f = fixture(); alter(f, 34, { observation: { status: 'FAIL', synthetic: true } }); refuses(() => check(f), 'PROVENANCE_CHAIN'); });
test('last event content tamper is detected by the trusted final pin', () => { const f = fixture(); alter(f, 66, { stage: 'tampered' }); refuses(() => check(f), 'PROVENANCE_CHAIN_PIN'); });
test('raw whitespace-only alteration is detected rather than canonicalized away', () => { const f = fixture(); f.events[66].bytes = Buffer.concat([f.events[66].bytes, Buffer.from('\n')]); refuses(() => check(f), 'PROVENANCE_CHAIN_PIN'); });
test('malformed event JSON fails verification', () => { const f = fixture(); f.events[4].bytes = Buffer.from('{invalid'); assert.throws(() => check(f), SyntaxError); });
test('trusted finalSHA cannot be replaced', () => { const f = fixture(); f.expected.finalSha256 = '0'.repeat(64); refuses(() => check(f), 'PROVENANCE_CHAIN_PIN'); });
test('total raw byte length includes the intent', () => { const f = fixture(); f.expected.bytes -= f.intent.length; refuses(() => check(f), 'PROVENANCE_CHAIN_PIN'); });
test('trusted intent SHA is independently checked', () => { const f = fixture(); f.expected.intent.sha256 = '0'.repeat(64); refuses(() => check(f), 'PROVENANCE_CHAIN_PIN'); });
test('record pin binds event path and directory identity', () => { const f = fixture(); refuses(() => validateChain(f.intent, f.events, 'other/synthetic-journal', f.expected), 'PROVENANCE_CHAIN_PIN'); });
test('record pin binds exact independently ordered path-byte-hash projection', () => {
  const f = fixture(); const records = f.events.map(event => ({ path: directory + '/' + event.name, bytes: event.bytes.length, sha256: digest(event.bytes) }));
  records.reverse(); f.expected.recordsSha256 = digest(JSON.stringify(records)); refuses(() => check(f), 'PROVENANCE_CHAIN_PIN');
});
test('altered intent bytes cannot retain the original chain', () => { const f = fixture(); f.intent = Buffer.concat([f.intent, Buffer.from(' ')]); refuses(() => check(f), 'PROVENANCE_CHAIN'); });
