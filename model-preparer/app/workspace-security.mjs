import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { safePath } from './io.mjs';
import { createPageCredentials } from './page-credentials.mjs';

const COOKIE = 'preparer_session';
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGES = {
  AUTH_REQUIRED: 'Sign in with your WFC administrator account.',
  AUTH_INVALID: 'The WFC email or password is incorrect.',
  ADMIN_REQUIRED: 'A current WFC administrator account is required.',
  PROJECT_FORBIDDEN: 'You do not have permission to update this WFC project.',
  WFC_UNAVAILABLE: 'WFC could not be reached. Try again when the connection is restored.',
  SETTINGS_INVALID: 'Enter complete Autodesk credentials for this page.',
  CREDENTIAL_SESSION_REQUIRED: 'Enter your Autodesk credentials again on this page.',
  CREDENTIAL_SESSION_LIMIT: 'Too many open credential pages. Close an unused page and try again.',
  SECURITY_STORE_INVALID: 'The private login store could not be verified.',
  INVALID_REQUEST: 'The request is invalid.',
};
export class WorkspaceSecurityError extends Error {
  constructor(code, status = 400) { super(MESSAGES[code] || MESSAGES.INVALID_REQUEST); this.name = 'WorkspaceSecurityError'; this.code = code; this.status = status; }
}
function fail(code, status) { throw new WorkspaceSecurityError(code, status); }
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
function fixedOrigin(value) {
  let parsed; try { parsed = new URL(value); } catch { fail('SETTINGS_INVALID'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) fail('SETTINGS_INVALID');
  return parsed.origin;
}
function checkedUser(value) {
  if (!plain(value) || typeof value.id !== 'string' || !UUID.test(value.id) || typeof value.email !== 'string' || value.email.length > 254 || !['basic', 'technician', 'engineer', 'admin'].includes(value.role) || typeof value.isAdmin !== 'boolean') fail('WFC_UNAVAILABLE', 503);
  // Only the current database flag grants administrator access, never a role label.
  return Object.freeze({ id: value.id, email: value.email, role: value.role, isAdmin: value.isAdmin, firstName: typeof value.firstName === 'string' ? value.firstName.slice(0, 200) : null, lastName: typeof value.lastName === 'string' ? value.lastName.slice(0, 200) : null });
}
function admin(user) { if (user.isAdmin !== true) fail('ADMIN_REQUIRED', 403); }
async function responseJson(response) {
  try {
    let text;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = []; let bytes = 0;
      try { for (;;) { const row = await reader.read(); if (row.done) break; bytes += row.value.byteLength; if (bytes > 1024 * 1024) { await reader.cancel(); fail('WFC_UNAVAILABLE', 503); } chunks.push(Buffer.from(row.value)); } }
      finally { reader.releaseLock(); }
      text = Buffer.concat(chunks).toString('utf8');
    } else text = await response.text();
    if (Buffer.byteLength(text) > 1024 * 1024) fail('WFC_UNAVAILABLE', 503);
    const result = JSON.parse(text); if (!plain(result)) fail('WFC_UNAVAILABLE', 503); return result;
  } catch { fail('WFC_UNAVAILABLE', 503); }
}

/** Only encrypted WFC login tokens are durable. APS credentials and capabilities
 * are process-local; the legacy workspace.enc APS record is never opened.
 * WFC passwords are used only for the login exchange and are never persisted.
 */
export async function createWorkspaceSecurity({ directory, wfcOrigin, publicOrigin = 'http://127.0.0.1', fetch: fetchImpl = globalThis.fetch, clock = { now: () => Date.now() } } = {}) {
  const origin = fixedOrigin(wfcOrigin), cookieSecure = new URL(fixedOrigin(publicOrigin)).protocol === 'https:';
  if (typeof fetchImpl !== 'function' || typeof clock?.now !== 'function' || typeof directory !== 'string' || !path.isAbsolute(directory)) fail('SETTINGS_INVALID');
  await safePath(directory, { directory: true, create: true });
  if (process.platform !== 'win32') await fs.chmod(directory, 0o700);
  const keyPath = path.join(directory, 'workspace.key'), statePath = path.join(directory, 'workspace-auth-v2.enc');
  try { const handle = await fs.open(keyPath, 'wx', 0o600); try { await handle.writeFile(randomBytes(32)); await handle.sync(); } finally { await handle.close(); } }
  catch (error) { if (error.code !== 'EEXIST') fail('SECURITY_STORE_INVALID', 500); }
  let key;
  try { const file = await safePath(keyPath); if (file.stat.size !== 32 || process.platform !== 'win32' && (file.stat.mode & 0o077)) fail('SECURITY_STORE_INVALID', 500); key = await fs.readFile(keyPath); }
  catch { fail('SECURITY_STORE_INVALID', 500); }
  let state = { schemaVersion: 2, wfcOrigin: origin, sessions: {} }, serial = Promise.resolve();
  const invalidSessions = new Set(), authBindings = new WeakMap();
  const aad = Buffer.from('routings-model-preparer/workspace-security/v2/' + origin);
  const now = () => { const value = clock.now(); if (!Number.isSafeInteger(value) || value < 0) fail('SECURITY_STORE_INVALID', 500); return value; };
  function envelope(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({ schemaVersion: 2, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }) + '\n';
  }
  function decode(bytes) {
    try {
      const value = JSON.parse(bytes.toString('utf8'));
      if (!plain(value) || Object.keys(value).sort().join(',') !== 'ciphertext,iv,schemaVersion,tag' || value.schemaVersion !== 2 || ['iv', 'tag', 'ciphertext'].some(field => typeof value[field] !== 'string' || Buffer.from(value[field], 'base64').toString('base64') !== value[field])) fail('SECURITY_STORE_INVALID', 500);
      const iv = Buffer.from(value.iv, 'base64'), tag = Buffer.from(value.tag, 'base64'); if (iv.length !== 12 || tag.length !== 16) fail('SECURITY_STORE_INVALID', 500);
      const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(aad); decipher.setAuthTag(tag);
      const decoded = JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
      if (!plain(decoded) || Object.keys(decoded).sort().join(',') !== 'schemaVersion,sessions,wfcOrigin' || decoded.schemaVersion !== 2 || decoded.wfcOrigin !== origin || !plain(decoded.sessions) || Object.keys(decoded.sessions).length > 1000) fail('SECURITY_STORE_INVALID', 500);
      for (const [id, session] of Object.entries(decoded.sessions)) if (!/^[0-9a-f]{64}$/.test(id) || !plain(session) || Object.keys(session).sort().join(',') !== 'createdAt,expiresAt,ownerId,token' || !UUID.test(session.ownerId || '') || typeof session.token !== 'string' || !session.token || session.token.length > 16384 || /[\x00-\x20\x7f]/.test(session.token) || !Number.isSafeInteger(session.expiresAt) || !Number.isSafeInteger(session.createdAt) || session.createdAt < 0 || session.expiresAt <= session.createdAt || session.expiresAt - session.createdAt > MAX_SESSION_MS) fail('SECURITY_STORE_INVALID', 500);
      return decoded;
    } catch { fail('SECURITY_STORE_INVALID', 500); }
  }
  async function write(value) {
    const temp = path.join(directory, '.workspace-auth-' + randomBytes(16).toString('hex') + '.tmp');
    let handle;
    try {
      // Check both existing destinations before replacing; linked stores fail closed.
      await safePath(directory, { directory: true });
      try { await safePath(statePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const encrypted = envelope(value); if (Buffer.byteLength(encrypted) > MAX_STATE_BYTES) fail('SECURITY_STORE_INVALID', 500);
      handle = await fs.open(temp, 'wx', 0o600); await handle.writeFile(encrypted); await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temp, statePath);
      if (process.platform !== 'win32') { const dir = await fs.open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
    } catch { fail('SECURITY_STORE_INVALID', 500); }
    finally { await handle?.close().catch(() => {}); await fs.unlink(temp).catch(() => {}); }
  }
  async function mutate(fn) {
    const next = serial.then(async () => { const updated = structuredClone(state), result = await fn(updated); await write(updated); state = updated; return result; });
    serial = next.catch(() => {}); return next;
  }
  try { const file = await safePath(statePath); if (file.stat.size > MAX_STATE_BYTES || process.platform !== 'win32' && (file.stat.mode & 0o077)) fail('SECURITY_STORE_INVALID', 500); state = decode(await fs.readFile(statePath)); }
  catch (error) { if (error.code !== 'ENOENT') fail('SECURITY_STORE_INVALID', 500); }
  function sessionId(req) {
    const cookies = String(req?.headers?.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(COOKIE + '='));
    if (cookies.length !== 1) return null; const id = cookies[0].slice(COOKIE.length + 1); return /^[A-Za-z0-9_-]{43}$/.test(id) ? hash(id) : null;
  }
  function setCookie(res, id, expiresAt) {
    const cookie = `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${id ? Math.max(0, Math.floor((expiresAt - now()) / 1000)) : 0}${cookieSecure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', cookie);
  }
  function liveSession(id, expectedOwner) {
    const session = id && !invalidSessions.has(id) && state.sessions[id];
    if (!session || now() >= session.expiresAt || expectedOwner && session.ownerId !== expectedOwner) fail('AUTH_REQUIRED', 401);
    return session;
  }
  const ownerKeyFor = ownerId => hash(origin + '\n' + ownerId);
  const pages = createPageCredentials({ clock, fail, assertAuthority(authority) { const session = liveSession(authority.loginId, authority.ownerId); if (session.expiresAt !== authority.expiresAt || ownerKeyFor(session.ownerId) !== authority.ownerKey) fail('AUTH_REQUIRED', 401); } });
  async function invalidate(id, reason, remove = true) {
    pages.revokeLogin(id, reason);
    if (remove && state.sessions[id]) { invalidSessions.add(id); await mutate(value => { delete value.sessions[id]; }); invalidSessions.delete(id); }
  }
  async function sendRequest(endpoint, options = {}) {
    if (typeof endpoint !== 'string' || !endpoint.startsWith('/api/') || endpoint.includes('\\') || endpoint.includes('#')) fail('INVALID_REQUEST');
    const target = new URL(endpoint, origin); if (target.origin !== origin || !target.pathname.startsWith('/api/')) fail('INVALID_REQUEST');
    const { timeoutMs = 15000, ...transportOptions } = options;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900000) fail('INVALID_REQUEST');
    try {
      return await fetchImpl(target.href, { ...transportOptions, redirect: 'manual', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
    } catch { fail('WFC_UNAVAILABLE', 503); }
  }
  async function currentUser(token) {
    const response = await sendRequest('/api/users/me', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if ([401, 403].includes(response.status)) fail('AUTH_REQUIRED', 401);
    if (response.status !== 200) fail('WFC_UNAVAILABLE', 503);
    return checkedUser((await responseJson(response)).user);
  }
  async function authenticateId(id) {
    let session;
    try { session = liveSession(id); } catch (error) { if (id && state.sessions[id]) await invalidate(id, 'expired'); throw error; }
    let user;
    try {
      user = await currentUser(session.token); admin(user);
      const current = liveSession(id, user.id); if (current.token !== session.token || current.createdAt !== session.createdAt) fail('AUTH_REQUIRED', 401);
    } catch (error) { await invalidate(id, error.code === 'WFC_UNAVAILABLE' ? 'authority_unavailable' : 'authorization_changed', error.code !== 'WFC_UNAVAILABLE'); throw error; }
    const auth = Object.freeze({ user, token: session.token, expiresAt: new Date(session.expiresAt).toISOString() }); authBindings.set(auth, id); return auth;
  }
  function authority(auth) {
    const loginId = auth && typeof auth === 'object' ? authBindings.get(auth) : null;
    const session = liveSession(loginId, auth?.user?.id); admin(auth.user);
    return { loginId, ownerId: session.ownerId, ownerKey: ownerKeyFor(session.ownerId), expiresAt: session.expiresAt };
  }
  async function refreshed(auth) { return authenticateId(authority(auth).loginId); }
  async function request(auth, endpoint, options = {}) {
    const current = await refreshed(auth), headers = new Headers(options.headers); headers.set('Authorization', `Bearer ${current.token}`);
    const streaming = options.body && (typeof options.body.pipe === 'function' || typeof options.body.getReader === 'function' || typeof options.body[Symbol.asyncIterator] === 'function');
    authority(current); return sendRequest(endpoint, { ...options, ...(streaming ? { duplex: 'half' } : {}), headers });
  }
  async function checkedProject(auth, projectId) {
    if (typeof projectId !== 'string' || !UUID.test(projectId)) fail('INVALID_REQUEST');
    const response = await request(auth, '/api/projects/' + encodeURIComponent(projectId));
    if ([401, 403, 404].includes(response.status)) fail('PROJECT_FORBIDDEN', 403);
    if (response.status !== 200) fail('WFC_UNAVAILABLE', 503);
    const project = (await responseJson(response)).project;
    authority(auth); if (!plain(project) || project.id !== projectId || project.canEdit !== true) fail('PROJECT_FORBIDDEN', 403);
    return Object.freeze({ id: project.id, name: String(project.name || '').slice(0, 300), projectNumber: String(project.projectNumber || '').slice(0, 100), canEdit: true });
  }
  async function establishSession(req, res, token, user, lifetimeSeconds) {
    const id = randomBytes(32).toString('base64url'), createdAt = now(), expiresAt = createdAt + Math.min(MAX_SESSION_MS, lifetimeSeconds * 1000), previous = sessionId(req);
    const removed = [];
    if (previous && state.sessions[previous]) { removed.push(previous); invalidSessions.add(previous); pages.revokeLogin(previous, 'login_replaced'); }
    for (const [key, session] of Object.entries(state.sessions)) if (session.expiresAt <= createdAt) { removed.push(key); invalidSessions.add(key); pages.revokeLogin(key, 'expired'); }
    await mutate(value => { for (const [key, session] of Object.entries(value.sessions)) if (session.expiresAt <= createdAt || key === previous) delete value.sessions[key]; if (Object.keys(value.sessions).length >= 1000) fail('WFC_UNAVAILABLE', 503); value.sessions[hash(id)] = { token, ownerId: user.id, createdAt, expiresAt }; });
    for (const key of removed) invalidSessions.delete(key);
    setCookie(res, id, expiresAt); return Object.freeze({ user, expiresAt: new Date(expiresAt).toISOString() });
  }
  return Object.freeze({
    async login(req, res, input) {
      if (!plain(input) || Object.keys(input).sort().join(',') !== 'email,password' || typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254 || typeof input.password !== 'string' || !input.password.length || input.password.length > 1024) fail('AUTH_INVALID', 401);
      const response = await sendRequest('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: input.email, password: input.password }) });
      if ([400, 401, 403].includes(response.status)) fail('AUTH_INVALID', 401); if (response.status !== 200) fail('WFC_UNAVAILABLE', 503);
      const reply = await responseJson(response);
      if (typeof reply.token !== 'string' || !reply.token || reply.token.length > 16384 || /[\x00-\x20\x7f]/.test(reply.token) || !Number.isSafeInteger(reply.expiresInSeconds) || reply.expiresInSeconds < 1) fail('WFC_UNAVAILABLE', 503);
      const user = await currentUser(reply.token); admin(user);
      return establishSession(req, res, reply.token, user, reply.expiresInSeconds);
    },
    async adoptLogin(req, res, token) {
      if (typeof token !== 'string' || !token || token.length > 16384 || /[\x00-\x20\x7f]/.test(token)) fail('AUTH_INVALID', 401);
      // WFC validates the token and current role; no decoded JWT role or client
      // supplied owner/expiry becomes authority. Every later use rechecks WFC.
      const user = await currentUser(token); admin(user);
      return establishSession(req, res, token, user, MAX_SESSION_MS / 1000);
    },
    authenticate: req => authenticateId(sessionId(req)),
    async logout(req, res) { const id = sessionId(req); if (id) await invalidate(id, 'logout'); setCookie(res, '', 0); },
    ownerKey: auth => authority(auth).ownerKey,
    async openCredentialSession(auth, input) { const current = await refreshed(auth); return pages.open(authority(current), input); },
    credentialSession: (auth, leaseToken, pageId, options) => pages.binding(authority(auth), leaseToken, pageId, options),
    async refreshBinding(binding) {
      const expected = pages.authority(binding);
      try { const current = await authenticateId(expected.loginId); if (current.user.id !== expected.ownerId) fail('AUTH_REQUIRED', 401); if (expected.projectId !== null) await checkedProject(current, expected.projectId); return pages.assert(binding); }
      catch (error) { pages.revokeBinding(binding, error.code === 'PROJECT_FORBIDDEN' ? 'project_forbidden' : 'authorization_changed'); throw error; }
    },
    assertBinding: binding => pages.assert(binding),
    privateSettings: binding => pages.settings(binding),
    async renewCredentialSession(auth, leaseToken, pageId) { const current = await refreshed(auth); return pages.renew(authority(current), leaseToken, pageId); },
    revokeCredentialSession: (auth, leaseToken, pageId) => pages.revoke(authority(auth), leaseToken, pageId),
    onLeaseRevoked: callback => pages.onRevoked(callback),
    async listProjects(auth) {
      const response = await request(auth, '/api/projects'); if (response.status !== 200) fail('WFC_UNAVAILABLE', 503);
      const data = await responseJson(response); authority(auth); if (!Array.isArray(data.projects) || data.projects.length > 10000) fail('WFC_UNAVAILABLE', 503);
      return data.projects.filter(project => plain(project) && UUID.test(project.id || '') && project.canEdit === true).map(project => ({ id: project.id, name: String(project.name || '').slice(0, 300), projectNumber: String(project.projectNumber || '').slice(0, 100), canEdit: true }));
    },
    requireProject: checkedProject,
    request,
    close: () => pages.close(),
  });
}
