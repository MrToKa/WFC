import { createHash, randomBytes } from 'node:crypto';

export const CREDENTIAL_LEASE_TTL_MS = 120000;
export const CREDENTIAL_HEARTBEAT_MS = 30000;
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const opaque = () => randomBytes(32).toString('hex');

export class PageCredentialError extends Error {
  constructor(code, status = 400) {
    super(code === 'SETTINGS_INVALID' ? 'Enter complete Autodesk credentials for this page.' : 'Enter your Autodesk credentials again on this page.');
    this.name = 'PageCredentialError'; this.code = code; this.status = status;
  }
}

/** Process-local capabilities only. No environment, filesystem, database or token cache. */
export function createPageCredentials({ clock = { now: () => Date.now() }, fail = (code, status) => { throw new PageCredentialError(code, status); }, assertAuthority = () => {} } = {}) {
  const epoch = opaque(), leases = new Map(), bindings = new WeakMap(), listeners = new Set();
  let closed = false;
  const now = () => { const value = clock.now(); if (!Number.isSafeInteger(value) || value < 0) fail('CREDENTIAL_SESSION_REQUIRED', 401); return value; };
  function identity(authority) {
    if (!plain(authority) || typeof authority.loginId !== 'string' || !authority.loginId || typeof authority.ownerId !== 'string' || !authority.ownerId || !/^[a-f0-9]{64}$/.test(authority.ownerKey || '') || !Number.isSafeInteger(authority.expiresAt) || authority.expiresAt <= now()) fail('AUTH_REQUIRED', 401);
    assertAuthority(authority); return authority;
  }
  function page(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) fail('SETTINGS_INVALID', 400); return value; }
  function credentials(authority, input) {
    if (!plain(input) || Object.keys(input).some(key => !['pageId', 'clientId', 'clientSecret', 'region', 'bucket', 'freePlanConfirmed'].includes(key)) || typeof input.clientId !== 'string' || !/^[A-Za-z0-9_-]{8,256}$/.test(input.clientId) || typeof input.clientSecret !== 'string' || input.clientSecret.length < 8 || input.clientSecret.length > 512 || /[\x00-\x20\x7f]/.test(input.clientSecret) || typeof input.freePlanConfirmed !== 'boolean') fail('SETTINGS_INVALID', 400);
    const region = input.region === undefined ? 'EMEA' : input.region;
    const bucket = input.bucket === undefined ? 'wfc-' + hash(authority.ownerId + ':' + input.clientId).slice(0, 48) : input.bucket;
    if (!['EMEA', 'US'].includes(region) || typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(bucket)) fail('SETTINGS_INVALID', 400);
    return { pageId: page(input.pageId), clientId: input.clientId, clientSecret: input.clientSecret, region, bucket, freePlanConfirmed: input.freePlanConfirmed };
  }
  function revoke(lease, reason) {
    if (lease.revoked) return;
    lease.revoked = true; leases.delete(lease.key);
    lease.clientId = null; lease.clientSecret = null;
    lease.controller.abort();
    const event = Object.freeze({ ownerId: lease.ownerId, ownerKey: lease.ownerKey, leaseId: lease.leaseId, configurationId: lease.configurationId, pageId: lease.pageId, reason });
    for (const listener of listeners) {
      try { const cleanup = listener(event); if (cleanup && typeof cleanup.then === 'function') Promise.resolve(cleanup).catch(() => {}); }
      catch { /* Cleanup callbacks cannot restore a revoked capability. */ }
    }
  }
  function check(lease) {
    if (!lease || closed || lease.revoked) fail('CREDENTIAL_SESSION_REQUIRED', 401);
    if (now() >= lease.expiresAt || now() >= lease.sessionExpiresAt) { revoke(lease, 'expired'); fail('CREDENTIAL_SESSION_REQUIRED', 401); }
    try { assertAuthority({ loginId: lease.loginId, ownerId: lease.ownerId, ownerKey: lease.ownerKey, expiresAt: lease.sessionExpiresAt }); }
    catch (error) { revoke(lease, 'authorization_changed'); throw error; }
    return lease;
  }
  function resolve(authority, leaseToken, pageId) {
    identity(authority); page(pageId);
    const lease = typeof leaseToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(leaseToken) ? leases.get(hash(epoch + ':' + leaseToken)) : null;
    if (!lease || lease.loginId !== authority.loginId || lease.ownerId !== authority.ownerId || lease.ownerKey !== authority.ownerKey || lease.pageId !== pageId) fail('CREDENTIAL_SESSION_REQUIRED', 401);
    return check(lease);
  }
  function bound(binding) { return check(binding && typeof binding === 'object' ? bindings.get(binding)?.lease : null); }
  function metadata(lease) { return Object.freeze({ ownerId: lease.ownerId, ownerKey: lease.ownerKey, leaseId: lease.leaseId, configurationId: lease.configurationId, applicationFingerprint: lease.applicationFingerprint, pageId: lease.pageId, expiresAt: new Date(lease.expiresAt).toISOString(), signal: lease.controller.signal }); }
  function dto(lease, leaseToken) { return Object.freeze({ leaseToken, pageId: lease.pageId, leaseId: lease.leaseId, configurationId: lease.configurationId, ownerId: lease.ownerId, configured: true, freePlanConfirmed: lease.freePlanConfirmed, expiresAt: new Date(lease.expiresAt).toISOString() }); }
  function sweep() { for (const lease of leases.values()) if (now() >= lease.expiresAt || now() >= lease.sessionExpiresAt) revoke(lease, 'expired'); }
  const timer = setInterval(sweep, 1000); timer.unref?.();
  return Object.freeze({
    open(authority, input) {
      if (closed) fail('CREDENTIAL_SESSION_REQUIRED', 401);
      identity(authority); const settings = credentials(authority, input); sweep();
      for (const lease of leases.values()) if (lease.loginId === authority.loginId && lease.pageId === settings.pageId) revoke(lease, 'replaced');
      if (leases.size >= 1000) fail('CREDENTIAL_SESSION_LIMIT', 503);
      const leaseToken = randomBytes(32).toString('base64url'), createdAt = now();
      const lease = { ...settings, ...authority, key: hash(epoch + ':' + leaseToken), leaseId: opaque(), configurationId: opaque(), applicationFingerprint: hash(settings.clientId), createdAt, sessionExpiresAt: authority.expiresAt, expiresAt: Math.min(createdAt + CREDENTIAL_LEASE_TTL_MS, authority.expiresAt), freePlanConfirmedBy: settings.freePlanConfirmed ? authority.ownerId : null, freePlanConfirmedAt: settings.freePlanConfirmed ? new Date(createdAt).toISOString() : null, revoked: false, controller: new AbortController() };
      leases.set(lease.key, lease); return dto(lease, leaseToken);
    },
    binding(authority, leaseToken, pageId, { projectId = null } = {}) {
      if (projectId !== null && (typeof projectId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId))) fail('INVALID_REQUEST', 400);
      const lease = resolve(authority, leaseToken, pageId), binding = Object.freeze({}); bindings.set(binding, { lease, projectId }); return binding;
    },
    authority(binding) { const lease = bound(binding); return Object.freeze({ loginId: lease.loginId, ownerId: lease.ownerId, ownerKey: lease.ownerKey, expiresAt: lease.sessionExpiresAt, projectId: bindings.get(binding).projectId }); },
    assert(binding) { return metadata(bound(binding)); },
    settings(binding) { const lease = bound(binding); return Object.freeze({ ...metadata(lease), clientId: lease.clientId, clientSecret: lease.clientSecret, region: lease.region, bucket: lease.bucket, enabled: true, freePlanConfirmed: lease.freePlanConfirmed, freePlanConfirmedBy: lease.freePlanConfirmedBy, freePlanConfirmedAt: lease.freePlanConfirmedAt }); },
    renew(authority, leaseToken, pageId) { const lease = resolve(authority, leaseToken, pageId); lease.expiresAt = Math.min(now() + CREDENTIAL_LEASE_TTL_MS, lease.sessionExpiresAt); return dto(lease, leaseToken); },
    revoke(authority, leaseToken, pageId) { const lease = resolve(authority, leaseToken, pageId); revoke(lease, 'page_closed'); return Object.freeze({ revoked: true }); },
    revokeLogin(loginId, reason = 'logout') { for (const lease of leases.values()) if (lease.loginId === loginId) revoke(lease, reason); },
    revokeBinding(binding, reason = 'authorization_changed') { const lease = binding && typeof binding === 'object' ? bindings.get(binding)?.lease : null; if (lease) revoke(lease, reason); },
    onRevoked(callback) { if (typeof callback !== 'function') throw new TypeError('A cleanup callback is required.'); listeners.add(callback); return () => listeners.delete(callback); },
    close() { if (closed) return; closed = true; clearInterval(timer); for (const lease of leases.values()) revoke(lease, 'service_closed'); listeners.clear(); },
  });
}
