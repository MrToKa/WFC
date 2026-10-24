import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createPageCredentials, PageCredentialError, CREDENTIAL_LEASE_TTL_MS, CREDENTIAL_HEARTBEAT_MS } from '../app/page-credentials.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const code = value => error => error instanceof PageCredentialError && error.code === value;
const owner = '380e4cb8-32ea-4ae0-92fa-4011a5abe0a0';
function fixture(t) {
  const control = { now: 1793000000000, active: true }, authority = { loginId: 'fixture-login', ownerId: owner, ownerKey: sha(owner), expiresAt: control.now + 3600000 };
  const store = createPageCredentials({ clock: { now: () => control.now }, assertAuthority(value) { if (!control.active || value.loginId !== authority.loginId || value.ownerId !== authority.ownerId) throw new PageCredentialError('AUTH_REQUIRED', 401); } });
  t.after(() => store.close());
  const input = { pageId: randomUUID(), clientId: 'fixture-client-id', clientSecret: 'PRIVATE_PAGE_SECRET', freePlanConfirmed: true };
  const dto = store.open(authority, input), binding = store.binding(authority, dto.leaseToken, dto.pageId);
  return { control, authority, store, input, dto, binding };
}

test('memory lease DTO is frozen and contains no keys or application identifier', t => {
  const f = fixture(t); assert.ok(Object.isFrozen(f.dto)); assert.ok(Object.isFrozen(f.binding)); assert.deepEqual(Object.keys(f.binding), []);
  assert.doesNotMatch(JSON.stringify(f.dto), /PRIVATE|clientId|clientSecret|fixture-client|applicationFingerprint/);
  assert.equal(f.store.settings(f.binding).region, 'EMEA'); assert.equal(f.store.settings(f.binding).bucket, 'wfc-' + sha(owner + ':' + f.input.clientId).slice(0, 48));
  assert.equal(f.store.settings(f.binding).clientSecret, f.input.clientSecret); assert.equal(f.store.settings(f.binding).applicationFingerprint, sha(f.input.clientId));
  assert.equal(CREDENTIAL_LEASE_TTL_MS, 120000); assert.equal(CREDENTIAL_HEARTBEAT_MS, 30000);
});

test('lease expiry boundary rejects sync use and heartbeat cannot resurrect it', t => {
  const f = fixture(t), signal = f.store.assert(f.binding).signal;
  f.control.now += CREDENTIAL_LEASE_TTL_MS - 1; assert.equal(f.store.assert(f.binding).ownerId, owner);
  f.control.now += 1; assert.throws(() => f.store.settings(f.binding), code('CREDENTIAL_SESSION_REQUIRED')); assert.equal(signal.aborted, true);
  assert.throws(() => f.store.renew(f.authority, f.dto.leaseToken, f.dto.pageId), code('CREDENTIAL_SESSION_REQUIRED'));
});

test('heartbeat extends only a live lease and never exceeds login expiry', t => {
  const f = fixture(t); f.control.now += 30000;
  const renewed = f.store.renew(f.authority, f.dto.leaseToken, f.dto.pageId); assert.equal(Date.parse(renewed.expiresAt), f.control.now + 120000);
  const short = { ...f.authority, expiresAt: f.control.now + 40000 }, dto = f.store.open(short, { ...f.input, pageId: randomUUID() }); assert.equal(Date.parse(dto.expiresAt), short.expiresAt);
});

test('same page replacement revokes every old binding before exposing a new capability', t => {
  const f = fixture(t), events = [], signal = f.store.assert(f.binding).signal; f.store.onRevoked(event => { assert.equal(signal.aborted, true); events.push(event); });
  const replacement = f.store.open(f.authority, f.input); assert.notEqual(replacement.configurationId, f.dto.configurationId); assert.notEqual(replacement.leaseId, f.dto.leaseId);
  assert.throws(() => f.store.settings(f.binding), code('CREDENTIAL_SESSION_REQUIRED')); assert.equal(events.length, 1); assert.equal(events[0].reason, 'replaced');
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|clientSecret|clientId|leaseToken/);
});

test('foreign owner, login, page, process and copied bindings cannot access secrets', t => {
  const f = fixture(t);
  for (const authority of [{ ...f.authority, loginId: 'different-login' }, { ...f.authority, ownerId: 'foreign-owner' }]) assert.throws(() => f.store.binding(authority, f.dto.leaseToken, f.dto.pageId));
  assert.throws(() => f.store.binding(f.authority, f.dto.leaseToken, randomUUID()), code('CREDENTIAL_SESSION_REQUIRED'));
  assert.throws(() => f.store.settings({ ...f.binding }), code('CREDENTIAL_SESSION_REQUIRED'));
  const other = createPageCredentials({ clock: { now: () => f.control.now } }); t.after(() => other.close()); assert.throws(() => other.binding(f.authority, f.dto.leaseToken, f.dto.pageId), code('CREDENTIAL_SESSION_REQUIRED'));
});

test('authority loss revokes immediately and later restoration cannot restore a lease', t => {
  const f = fixture(t), signal = f.store.assert(f.binding).signal; f.control.active = false;
  assert.throws(() => f.store.assert(f.binding), code('AUTH_REQUIRED')); assert.equal(signal.aborted, true); f.control.active = true;
  assert.throws(() => f.store.settings(f.binding), code('CREDENTIAL_SESSION_REQUIRED'));
});

test('explicit complete fields are required and invalid input never inherits an earlier secret', t => {
  const f = fixture(t);
  for (const input of [{ ...f.input, clientSecret: '' }, { ...f.input, clientId: '' }, { ...f.input, clientSecret: undefined }, { ...f.input, freePlanConfirmed: undefined }, { ...f.input, region: '' }, { ...f.input, bucket: '' }, { ...f.input, remembered: true }]) assert.throws(() => f.store.open(f.authority, input), code('SETTINGS_INVALID'));
  assert.equal(f.store.settings(f.binding).clientSecret, f.input.clientSecret);
});

test('explicit bucket is validated and free-plan declaration belongs to this credential revision', t => {
  const f = fixture(t), dto = f.store.open(f.authority, { ...f.input, bucket: 'explicit-bucket', region: 'US', freePlanConfirmed: false });
  const settings = f.store.settings(f.store.binding(f.authority, dto.leaseToken, dto.pageId)); assert.equal(settings.bucket, 'explicit-bucket'); assert.equal(settings.region, 'US'); assert.equal(settings.freePlanConfirmed, false); assert.equal(settings.freePlanConfirmedBy, null); assert.equal(settings.freePlanConfirmedAt, null);
  assert.notEqual(dto.configurationId, f.dto.configurationId);
});

test('cleanup callback failures cannot retain credentials; service close is idempotent', t => {
  const f = fixture(t), signal = f.store.assert(f.binding).signal; f.store.onRevoked(() => { throw new Error('cleanup failed'); }); f.store.close(); f.store.close();
  assert.equal(signal.aborted, true); assert.throws(() => f.store.settings(f.binding), code('CREDENTIAL_SESSION_REQUIRED')); assert.throws(() => f.store.open(f.authority, f.input), code('CREDENTIAL_SESSION_REQUIRED'));
});
