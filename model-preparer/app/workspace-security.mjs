import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { safePath } from './io.mjs';

const COOKIE = 'preparer_session';
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGES = {
  AUTH_REQUIRED: 'Sign in with your WFC engineer account.',
  AUTH_INVALID: 'The WFC email or password is incorrect.',
  ENGINEER_REQUIRED: 'A current WFC engineer or administrator account is required.',
  ADMIN_REQUIRED: 'Only a WFC administrator can change Autodesk credentials.',
  PROJECT_FORBIDDEN: 'You do not have permission to update this WFC project.',
  WFC_UNAVAILABLE: 'WFC could not be reached. Try again when the connection is restored.',
  SETTINGS_INVALID: 'The Autodesk settings are incomplete or invalid.',
  SECURITY_STORE_INVALID: 'The private settings store could not be verified.',
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
  // WFC's /users/me reads the current database role. Never trust stale JWT roles.
  const role = value.isAdmin ? 'admin' : value.role;
  return Object.freeze({ id: value.id, email: value.email, role, isAdmin: role === 'admin', firstName: typeof value.firstName === 'string' ? value.firstName.slice(0, 200) : null, lastName: typeof value.lastName === 'string' ? value.lastName.slice(0, 200) : null });
}
function engineer(user) { if (!['engineer', 'admin'].includes(user.role)) fail('ENGINEER_REQUIRED', 403); }
function checkedSettings(input) {
  if (!plain(input) || typeof input.clientId !== 'string' || !/^[A-Za-z0-9_-]{8,256}$/.test(input.clientId) || typeof input.clientSecret !== 'string' || input.clientSecret.length < 8 || input.clientSecret.length > 512 || /[\x00-\x20\x7f]/.test(input.clientSecret) || !['EMEA', 'US'].includes(input.region) || typeof input.bucket !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(input.bucket)) fail('SETTINGS_INVALID');
  return { clientId: input.clientId, clientSecret: input.clientSecret, region: input.region, bucket: input.bucket };
}
function configurationId(settings) {
  return hash(JSON.stringify({ ...checkedSettings(settings), enabled: settings.enabled, revision: settings.revision, freePlanConfirmed: settings.freePlanConfirmed, freePlanConfirmedBy: settings.freePlanConfirmedBy, freePlanConfirmedAt: settings.freePlanConfirmedAt }));
}
function storedSettings(input) {
  checkedSettings(input);
  if (typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.revision) || input.revision < 1 || !Number.isSafeInteger(input.updatedAt) || typeof input.freePlanConfirmed !== 'boolean' || input.configurationId !== configurationId(input)) fail('SECURITY_STORE_INVALID', 500);
  if (input.freePlanConfirmed ? typeof input.freePlanConfirmedBy !== 'string' || !UUID.test(input.freePlanConfirmedBy) || typeof input.freePlanConfirmedAt !== 'string' || !Number.isFinite(Date.parse(input.freePlanConfirmedAt)) || new Date(input.freePlanConfirmedAt).toISOString() !== input.freePlanConfirmedAt : input.freePlanConfirmedBy !== null || input.freePlanConfirmedAt !== null) fail('SECURITY_STORE_INVALID', 500);
  return input;
}
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

/** Private, single-service-owner store. It makes no network request at startup.
 * The enclosing service journal owns the process lease for this data directory.
 * WFC passwords are used only for the login exchange and are never persisted.
 */
export async function createWorkspaceSecurity({ directory, wfcOrigin, publicOrigin = 'http://127.0.0.1', fetch: fetchImpl = globalThis.fetch, clock = { now: () => Date.now() }, seedAPSConfiguration } = {}) {
  const origin = fixedOrigin(wfcOrigin), cookieSecure = new URL(fixedOrigin(publicOrigin)).protocol === 'https:';
  if (typeof fetchImpl !== 'function' || typeof clock?.now !== 'function' || typeof directory !== 'string' || !path.isAbsolute(directory)) fail('SETTINGS_INVALID');
  await safePath(directory, { directory: true, create: true });
  if (process.platform !== 'win32') await fs.chmod(directory, 0o700);
  const keyPath = path.join(directory, 'workspace.key'), statePath = path.join(directory, 'workspace.enc');
  try { const handle = await fs.open(keyPath, 'wx', 0o600); try { await handle.writeFile(randomBytes(32)); await handle.sync(); } finally { await handle.close(); } }
  catch (error) { if (error.code !== 'EEXIST') fail('SECURITY_STORE_INVALID', 500); }
  let key;
  try { const file = await safePath(keyPath); if (file.stat.size !== 32 || process.platform !== 'win32' && (file.stat.mode & 0o077)) fail('SECURITY_STORE_INVALID', 500); key = await fs.readFile(keyPath); }
  catch { fail('SECURITY_STORE_INVALID', 500); }
  let state = { schemaVersion: 1, wfcOrigin: origin, settings: null, sessions: {} }, serial = Promise.resolve();
  const aad = Buffer.from('routings-model-preparer/workspace-security/v1/' + origin);
  const now = () => { const value = clock.now(); if (!Number.isSafeInteger(value) || value < 0) fail('SECURITY_STORE_INVALID', 500); return value; };
  function envelope(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({ schemaVersion: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }) + '\n';
  }
  function decode(bytes) {
    try {
      const value = JSON.parse(bytes.toString('utf8'));
      if (!plain(value) || Object.keys(value).sort().join(',') !== 'ciphertext,iv,schemaVersion,tag' || value.schemaVersion !== 1 || ['iv', 'tag', 'ciphertext'].some(field => typeof value[field] !== 'string' || Buffer.from(value[field], 'base64').toString('base64') !== value[field])) fail('SECURITY_STORE_INVALID', 500);
      const iv = Buffer.from(value.iv, 'base64'), tag = Buffer.from(value.tag, 'base64'); if (iv.length !== 12 || tag.length !== 16) fail('SECURITY_STORE_INVALID', 500);
      const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(aad); decipher.setAuthTag(tag);
      const decoded = JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
      if (!plain(decoded) || Object.keys(decoded).sort().join(',') !== 'schemaVersion,sessions,settings,wfcOrigin' || decoded.schemaVersion !== 1 || decoded.wfcOrigin !== origin || !plain(decoded.sessions) || Object.keys(decoded.sessions).length > 1000) fail('SECURITY_STORE_INVALID', 500);
      if (decoded.settings !== null) storedSettings(decoded.settings);
      for (const [id, session] of Object.entries(decoded.sessions)) if (!/^[0-9a-f]{64}$/.test(id) || !plain(session) || typeof session.token !== 'string' || !session.token || session.token.length > 16384 || /[\x00-\x20\x7f]/.test(session.token) || !Number.isSafeInteger(session.expiresAt) || !Number.isSafeInteger(session.createdAt) || session.expiresAt <= session.createdAt || session.expiresAt - session.createdAt > MAX_SESSION_MS) fail('SECURITY_STORE_INVALID', 500);
      return decoded;
    } catch { fail('SECURITY_STORE_INVALID', 500); }
  }
  async function write(value) {
    const temp = path.join(directory, '.workspace-' + randomBytes(16).toString('hex') + '.tmp');
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
  if (!state.settings && seedAPSConfiguration && Object.values(seedAPSConfiguration).some(Boolean)) {
    const settings = { ...checkedSettings(seedAPSConfiguration), enabled: true, revision: 1, freePlanConfirmed: false, freePlanConfirmedBy: null, freePlanConfirmedAt: null, updatedAt: now() };
    settings.configurationId = configurationId(settings); await mutate(value => { value.settings = settings; });
  }
  function sessionId(req) {
    const cookies = String(req?.headers?.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(COOKIE + '='));
    if (cookies.length !== 1) return null; const id = cookies[0].slice(COOKIE.length + 1); return /^[A-Za-z0-9_-]{43}$/.test(id) ? hash(id) : null;
  }
  function setCookie(res, id, expiresAt) {
    const cookie = `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${id ? Math.max(0, Math.floor((expiresAt - now()) / 1000)) : 0}${cookieSecure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', cookie);
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
  const authBindings = new WeakMap();
  async function authenticateId(id) {
    const session = id && state.sessions[id];
    if (!session || now() >= session.expiresAt) { if (session) await mutate(value => { delete value.sessions[id]; }); fail('AUTH_REQUIRED', 401); }
    let user;
    try { user = await currentUser(session.token); engineer(user); }
    catch (error) { if (['AUTH_REQUIRED', 'ENGINEER_REQUIRED'].includes(error.code)) await mutate(value => { delete value.sessions[id]; }); throw error; }
    const auth = Object.freeze({ user, token: session.token, expiresAt: new Date(session.expiresAt).toISOString() }); authBindings.set(auth, id); return auth;
  }
  async function refreshed(auth) { const id = authBindings.get(auth); if (!id) fail('AUTH_REQUIRED', 401); return authenticateId(id); }
  const masked = () => {
    if (!state.settings) return { configured: false, enabled: false, clientId: '', clientSecretSet: false, region: 'EMEA', bucket: '', revision: 0, configurationId: null, freePlanConfirmed: false, freePlanConfirmedBy: null, freePlanConfirmedAt: null, updatedAt: null };
    const { clientSecret, ...visible } = state.settings; return { ...visible, configured: true, clientSecretSet: true, updatedAt: new Date(state.settings.updatedAt).toISOString() };
  };
  async function request(auth, endpoint, options = {}) {
    const current = await refreshed(auth), headers = new Headers(options.headers); headers.set('Authorization', `Bearer ${current.token}`);
    const streaming = options.body && (typeof options.body.pipe === 'function' || typeof options.body.getReader === 'function' || typeof options.body[Symbol.asyncIterator] === 'function');
    return sendRequest(endpoint, { ...options, ...(streaming ? { duplex: 'half' } : {}), headers });
  }
  async function checkedProject(auth, projectId) {
    if (typeof projectId !== 'string' || !UUID.test(projectId)) fail('INVALID_REQUEST');
    const response = await request(auth, '/api/projects/' + encodeURIComponent(projectId));
    if ([401, 403, 404].includes(response.status)) fail('PROJECT_FORBIDDEN', 403);
    if (response.status !== 200) fail('WFC_UNAVAILABLE', 503);
    const project = (await responseJson(response)).project;
    if (!plain(project) || project.id !== projectId || project.canEdit !== true) fail('PROJECT_FORBIDDEN', 403);
    return { id: project.id, name: String(project.name || '').slice(0, 300), projectNumber: String(project.projectNumber || '').slice(0, 100), canEdit: true };
  }
  return Object.freeze({
    async login(req, res, input) {
      if (!plain(input) || Object.keys(input).sort().join(',') !== 'email,password' || typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254 || typeof input.password !== 'string' || !input.password.length || input.password.length > 1024) fail('AUTH_INVALID', 401);
      const response = await sendRequest('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: input.email, password: input.password }) });
      if ([400, 401, 403].includes(response.status)) fail('AUTH_INVALID', 401); if (response.status !== 200) fail('WFC_UNAVAILABLE', 503);
      const reply = await responseJson(response);
      if (typeof reply.token !== 'string' || !reply.token || reply.token.length > 16384 || /[\x00-\x20\x7f]/.test(reply.token) || !Number.isSafeInteger(reply.expiresInSeconds) || reply.expiresInSeconds < 1) fail('WFC_UNAVAILABLE', 503);
      const user = await currentUser(reply.token); engineer(user);
      const id = randomBytes(32).toString('base64url'), createdAt = now(), expiresAt = createdAt + Math.min(MAX_SESSION_MS, reply.expiresInSeconds * 1000), previous = sessionId(req);
      await mutate(value => { for (const [key, session] of Object.entries(value.sessions)) if (session.expiresAt <= createdAt || key === previous) delete value.sessions[key]; if (Object.keys(value.sessions).length >= 1000) fail('WFC_UNAVAILABLE', 503); value.sessions[hash(id)] = { token: reply.token, createdAt, expiresAt }; });
      setCookie(res, id, expiresAt); return { user, expiresAt: new Date(expiresAt).toISOString() };
    },
    authenticate: req => authenticateId(sessionId(req)),
    async logout(req, res) { const id = sessionId(req); if (id && state.sessions[id]) await mutate(value => { delete value.sessions[id]; }); setCookie(res, '', 0); },
    async getSettings(auth) { await refreshed(auth); return masked(); },
    async saveSettings(auth, input) {
      const current = await refreshed(auth); if (current.user.role !== 'admin') fail('ADMIN_REQUIRED', 403);
      if (!plain(input) || !Object.keys(input).length || Object.keys(input).some(key => !['clientId', 'clientSecret', 'region', 'bucket', 'freePlanConfirmed', 'enabled'].includes(key)) || input.freePlanConfirmed !== undefined && typeof input.freePlanConfirmed !== 'boolean' || input.enabled !== undefined && typeof input.enabled !== 'boolean') fail('SETTINGS_INVALID');
      await mutate(value => {
        const previous = value.settings, candidate = { ...(previous || {}), ...input }; if (input.clientSecret === '' && previous) candidate.clientSecret = previous.clientSecret;
        const checked = checkedSettings(candidate), credentialsChanged = !previous || Object.entries(checked).some(([field, fieldValue]) => fieldValue !== previous[field]);
        const confirmed = input.freePlanConfirmed === true || !credentialsChanged && input.freePlanConfirmed !== false && previous?.freePlanConfirmed === true;
        const settings = { ...checked, enabled: input.enabled ?? previous?.enabled ?? true, revision: (previous?.revision || 0) + 1, freePlanConfirmed: confirmed, freePlanConfirmedBy: confirmed ? input.freePlanConfirmed === true ? current.user.id : previous.freePlanConfirmedBy : null, freePlanConfirmedAt: confirmed ? input.freePlanConfirmed === true ? new Date(now()).toISOString() : previous.freePlanConfirmedAt : null, updatedAt: now() };
        settings.configurationId = configurationId(settings); value.settings = settings;
      }); return masked();
    },
    privateSettings() { return state.settings ? structuredClone(state.settings) : null; },
    async listProjects(auth) {
      const response = await request(auth, '/api/projects'); if (response.status !== 200) fail('WFC_UNAVAILABLE', 503);
      const data = await responseJson(response); if (!Array.isArray(data.projects) || data.projects.length > 10000) fail('WFC_UNAVAILABLE', 503);
      return data.projects.filter(project => plain(project) && UUID.test(project.id || '') && project.canEdit === true).map(project => ({ id: project.id, name: String(project.name || '').slice(0, 300), projectNumber: String(project.projectNumber || '').slice(0, 100), canEdit: true }));
    },
    requireProject: checkedProject,
    request,
  });
}
