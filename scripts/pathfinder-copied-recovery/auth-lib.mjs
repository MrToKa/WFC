import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const LIMITS = Object.freeze({ requestMilliseconds: 15000, totalMilliseconds: 180000, responseBytes: 128 * 1024, resourceBytes: 2048, fileBytes: 2 * 1024 * 1024, journalBytes: 4 * 1024 * 1024, journalEvents: 64 });
export const PINS = Object.freeze({ projectId: '1af0f807-7653-40ea-8391-7eea6c54e7d4', modelVersionId: 'a613151e-c370-45c5-80f3-42ae58603b9a', fingerprint: 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34', resource: { path: 'resources/output/0/objects_attrs.json.gz', bytes: 997, sha256: 'ee4df15128a2ad51a42603ba7a0bbfb52b1bfbf2cee07139af1fac2545fdac57' } });
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
export const digest = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const need = (ok, code) => { if (!ok) throw Object.assign(Error(code), { code }); };
export const safeCode = error => /^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code ?? '') ? error.code : 'RECOVERY_AUTH_FAILED';
export function publicBinding(binding) {
  const { state, origin, resources } = binding;
  return { runtime: state.runtime, owner: state.owner, project: state.project, port: state.port, origin, containers: resources.containers.map(({ role, id, image, startedAt }) => ({ role, id, image, startedAt })).sort((a, b) => a.role.localeCompare(b.role)) };
}
export function sameSource(before, after) {
  need(before?.owner === after?.owner && before.runtime === after.runtime && before.project === after.project && before.port === 5191 && after.port === 5191 && before.origin === 'http://127.0.0.1:5191' && after.origin === before.origin, 'AUTH_SOURCE_CHANGED');
  const identity = value => value.containers.map(({ role, id, image }) => ({ role, id, image }));
  need(isDeepStrictEqual(identity(before), identity(after)), 'AUTH_SOURCE_CHANGED');
}
export function sameCurrent(before, after) {
  need(before.owner === after.owner && before.runtime === after.runtime && before.project === after.project && before.port === after.port && before.origin === after.origin && isDeepStrictEqual(before.containers.map(({ role, id, image }) => ({ role, id, image })), after.containers.map(({ role, id, image }) => ({ role, id, image }))), 'AUTH_BINDING_CHANGED');
}
export function resourcePin(snapshot) {
  need(snapshot?.model?.contentFingerprint === PINS.fingerprint && Array.isArray(snapshot.model.propertyResources) && snapshot.model.propertyResources.length === 5, 'AUTH_MANIFEST_PROVENANCE');
  const entries = snapshot.model.propertyResources.filter(value => value.path === PINS.resource.path);
  need(entries.length === 1 && isDeepStrictEqual(entries[0], PINS.resource), 'AUTH_MANIFEST_RESOURCE');
  return structuredClone(entries[0]);
}
export const basePath = () => `/api/projects/${PINS.projectId}/model-versions/${PINS.modelVersionId}/viewer-sessions`;
export const sessionPath = session => `${basePath()}/${session.sessionId}`;
function date(value) { const result = Date.parse(value); need(typeof value === 'string' && Number.isFinite(result), 'AUTH_SESSION_TIMING'); return result; }
export function sessionDto(value, loadId, now) {
  need(value?.projectId === PINS.projectId && value.modelVersionId === PINS.modelVersionId && value.loadId === loadId && UUID.test(value.sessionId ?? '') && UUID.test(loadId ?? ''), 'AUTH_SESSION_IDENTITY');
  const expires = date(value.expiresAt), absolute = date(value.absoluteExpiresAt);
  need(expires > now && absolute >= expires && expires <= now + 305000 && absolute <= now + 1805000, 'AUTH_SESSION_TIMING');
  return { sessionId: value.sessionId, projectId: value.projectId, modelVersionId: value.modelVersionId, loadId, expiresAt: value.expiresAt, absoluteExpiresAt: value.absoluteExpiresAt };
}
export function cookieFrom(headers, session) {
  const cookies = headers.setCookie;
  need(Array.isArray(cookies) && cookies.length === 1 && cookies[0].length <= 1024, 'AUTH_COOKIE');
  const parts = cookies[0].split(';').map(value => value.trim()), pair = parts.shift();
  need(/^wfc_viewer_session=[A-Za-z0-9_-]{43}$/.test(pair ?? ''), 'AUTH_COOKIE');
  const attributes = parts.map(value => value.toLowerCase());
  need(new Set(attributes.map(value => value.split('=')[0])).size === attributes.length && attributes.includes('httponly') && attributes.includes('samesite=strict') && !attributes.some(value => value === 'secure' || value.startsWith('domain=')) && parts.includes('Path=' + sessionPath(session) + '/') && attributes.some(value => /^max-age=[1-9][0-9]{0,2}$/.test(value)), 'AUTH_COOKIE_SCOPE');
  return pair;
}
function json(response) { try { return JSON.parse(response.bytes.toString('utf8')); } catch { need(false, 'AUTH_RESPONSE_JSON'); } }
function privateHeaders(response) { need(/(?:^|,)\s*private\s*,\s*no-store(?:$|,)/.test(response.headers.cacheControl ?? '') && response.headers.corp === 'same-origin' && response.headers.nosniff === 'nosniff', 'AUTH_PRIVATE_HEADERS'); }
export function descriptor(response, session) {
  need(response.status === 200, 'AUTH_DESCRIPTOR_STATUS'); privateHeaders(response);
  const value = json(response);
  need(value.projectId === PINS.projectId && value.modelVersionId === PINS.modelVersionId && value.loadId === session.loadId && value.contentFingerprint === PINS.fingerprint && value.supportProfile === 'svf-local-7.130.0-v1' && value.format === 'svf' && value.sdkVersion === '7.130.0' && value.entrypoint === 'resources/output/0/0.svf' && value.resourceCount === 342 && String(value.totalBytes) === '439007803', 'AUTH_DESCRIPTOR_IDENTITY');
  return value;
}
export function resource(response, pin) {
  need(response.status === 200 && response.bytes.length === pin.bytes && response.headers.contentLength === String(pin.bytes) && !response.headers.contentRange && (!response.headers.contentEncoding || response.headers.contentEncoding === 'identity') && digest(response.bytes) === pin.sha256, 'AUTH_RESOURCE_IDENTITY');
  privateHeaders(response); return { path: pin.path, bytes: response.bytes.length, sha256: digest(response.bytes) };
}
export function validateCapsule(value) {
  need(value?.schemaVersion === 'pathfinder.copied-recovery.auth-capsule.v1' && UUID.test(value.owner ?? '') && UUID.test(value.actorId ?? '') && UUID.test(value.loginId ?? '') && typeof value.bearer === 'string' && value.bearer.length <= 16384 && /^[A-Za-z0-9_.-]+$/.test(value.bearer) && /^wfc_viewer_session=[A-Za-z0-9_-]{43}$/.test(value.cookie ?? '') && HASH.test(value.resourceProvenance?.sha256 ?? '') && isDeepStrictEqual(value.resource, PINS.resource), 'AUTH_CAPSULE');
  sessionDto(value.session, value.session?.loadId, Date.parse(value.preparedAt));
  need(Number.isFinite(Date.parse(value.loginExpiresAt)) && value.source?.port === 5191 && value.source.origin === 'http://127.0.0.1:5191' && value.source.containers?.length === 5, 'AUTH_CAPSULE');
  return value;
}
export function allowedAuthMetadata(binding, fresh, runtime) {
  need(binding.state.port === 5192 && UUID.test(binding.state.restore?.backupId ?? '') && typeof runtime === 'string' && /^pathfinder-engine\/\.scratch\/copied-recovery-target-[a-f0-9-]{36}$/.test(runtime), 'AUTH_ALLOWED_TARGET');
  const secret = /^wfc_viewer_session=([A-Za-z0-9_-]{43})$/.exec(fresh.cookie ?? '')?.[1];
  need(secret && [fresh.actorId, fresh.loginId, fresh.session.sessionId, fresh.session.loadId].every(v => UUID.test(v ?? '')) && date(fresh.loginExpiresAt) >= date(fresh.session.absoluteExpiresAt), 'AUTH_ALLOWED_IDENTITY');
  return { schemaVersion: 'pathfinder.copied-recovery.allowed-auth.v1', target: { owner: binding.state.owner, runtime, project: binding.state.project, port: 5192, backupId: binding.state.restore.backupId }, actorId: fresh.actorId, loginId: fresh.loginId, sessionId: fresh.session.sessionId, loadId: fresh.session.loadId, projectId: PINS.projectId, modelVersionId: PINS.modelVersionId, loginExpiresAt: fresh.loginExpiresAt, sessionExpiresAt: fresh.session.expiresAt, sessionAbsoluteExpiresAt: fresh.session.absoluteExpiresAt, secretSha256: digest(secret) };
}
/** All non-login response bytes are journaled before validation, including rejection responses. */
export async function executeAuth({ mode, binding, capsule, resourceProvenance, io }) {
  need(['prepare-source', 'check-source', 'check-target'].includes(mode), 'AUTH_MODE');
  const startedAt = io.now(), deadline = startedAt + LIMITS.totalMilliseconds, outcomes = [];
  const active = () => need(!io.signal?.aborted && io.now() < deadline, 'AUTH_CANCELLED_OR_DEADLINE');
  const current = publicBinding(binding);
  if (mode !== 'prepare-source') validateCapsule(capsule);
  if (mode === 'check-source') sameSource(capsule.source, current);
  if (mode === 'check-target') need(current.port === 5192 && current.origin === 'http://127.0.0.1:5192' && current.owner !== capsule.source.owner && current.project !== capsule.source.project, 'AUTH_TARGET');
  if (mode === 'prepare-source') need(current.port === 5191 && current.origin === 'http://127.0.0.1:5191' && isDeepStrictEqual(resourceProvenance?.resource, PINS.resource), 'AUTH_SOURCE');
  const request = async (label, method, path, { bearer, cookie, body, binary = false, login = false } = {}) => {
    active(); need(path.startsWith('/api/') && !path.includes('..') && !path.includes('?'), 'AUTH_REQUEST_PATH');
    await io.append('request_started', { label, method, path, origin: current.origin, at: new Date(io.now()).toISOString() });
    let response;
    try { response = await io.request({ origin: current.origin, method, path, bearer, cookie, body, binary, signal: io.signal, milliseconds: Math.min(LIMITS.requestMilliseconds, deadline - io.now()) }); }
    catch (error) { await io.append('request_failed', { label, code: safeCode(error), at: new Date(io.now()).toISOString() }); throw error; }
    await io.append('response', login ? { label, status: response.status, bodyBytes: response.bytes.length, bodySha256: digest(response.bytes), at: new Date(io.now()).toISOString(), loginBodyOmitted: true } : { label, status: response.status, headers: response.headers, bodyBase64: response.bytes.toString('base64'), at: new Date(io.now()).toISOString() });
    active(); outcomes.push({ label, status: response.status, bytes: response.bytes.length, sha256: digest(response.bytes) }); return response;
  };
  const user = response => { need(response.status === 200, 'AUTH_USERS_ME'); const value = json(response); need(value.user?.id === binding.state.demo?.adminUserId && value.user.isAdmin === true, 'AUTH_ACTOR'); return value.user.id; };
  const positive = async credentials => {
    const loginStart = io.now(), response = await request('fresh_login', 'POST', '/api/auth/login', { body: credentials, login: true });
    need(response.status === 200, 'AUTH_LOGIN'); const value = json(response);
    need(value.user?.id === binding.state.demo?.adminUserId && value.user.isAdmin === true && UUID.test(value.user.id ?? '') && typeof value.token === 'string' && /^[A-Za-z0-9_.-]{10,16384}$/.test(value.token) && Number.isSafeInteger(value.expiresInSeconds) && value.expiresInSeconds > 0 && value.expiresInSeconds <= 604800, 'AUTH_LOGIN_IDENTITY');
    let claims; try { claims = JSON.parse(Buffer.from(value.token.split('.')[1], 'base64url').toString('utf8')); } catch { need(false, 'AUTH_LOGIN_CLAIMS'); }
    // Decode only our just-returned token for row provenance; /me and Viewer POST independently authenticate it.
    need(claims?.sub === value.user.id && UUID.test(claims.jti ?? '') && Number.isSafeInteger(claims.exp) && claims.exp * 1000 > io.now(), 'AUTH_LOGIN_CLAIMS');
    const auth = { actorId: value.user.id, loginId: claims.jti, bearer: value.token, loginExpiresAt: new Date(Math.min(claims.exp * 1000, loginStart + value.expiresInSeconds * 1000)).toISOString(), loadId: io.uuid() };
    await io.checkpoint('login', auth); user(await request('fresh_users_me', 'GET', '/api/users/me', { bearer: auth.bearer }));
    const created = await request('fresh_viewer_session', 'POST', basePath(), { bearer: auth.bearer, body: { loadId: auth.loadId } });
    need(created.status === 201, 'AUTH_SESSION_CREATE'); privateHeaders(created);
    const session = sessionDto(json(created), auth.loadId, io.now()), cookie = cookieFrom(created.headers, session);
    await io.checkpoint('session', { ...auth, session, cookie });
    descriptor(await request('fresh_descriptor', 'GET', sessionPath(session) + '/descriptor', { cookie }), session);
    resource(await request('fresh_resource', 'GET', sessionPath(session) + '/' + PINS.resource.path, { cookie, binary: true }), PINS.resource);
    return { ...auth, session, cookie };
  };
  let result, targetAuth;
  if (mode === 'prepare-source') {
    const auth = await positive(await io.credentials());
    result = { schemaVersion: 'pathfinder.copied-recovery.auth-capsule.v1', owner: io.owner, preparedAt: new Date(io.now()).toISOString(), source: current, actorId: auth.actorId, loginId: auth.loginId, bearer: auth.bearer, cookie: auth.cookie, loginExpiresAt: auth.loginExpiresAt, session: auth.session, resource: PINS.resource, resourceProvenance };
    validateCapsule(result);
  } else {
    need(io.now() < Date.parse(capsule.loginExpiresAt), 'AUTH_SOURCE_BEARER_EXPIRED');
    if (mode === 'check-source') {
      user(await request('source_old_users_me', 'GET', '/api/users/me', { bearer: capsule.bearer }));
      descriptor(await request('source_old_descriptor', 'GET', sessionPath(capsule.session) + '/descriptor', { cookie: capsule.cookie }), capsule.session);
      resource(await request('source_old_resource', 'GET', sessionPath(capsule.session) + '/' + capsule.resource.path, { cookie: capsule.cookie, binary: true }), capsule.resource);
      need(io.now() < Date.parse(capsule.session.expiresAt), 'AUTH_SOURCE_SESSION_EXPIRED');
    } else {
      const denied = await request('target_old_bearer', 'GET', '/api/users/me', { bearer: capsule.bearer });
      need(denied.status === 401 && io.now() < Date.parse(capsule.loginExpiresAt), 'AUTH_JWT_ROTATION_NOT_PROVED');
      const revoked = await request('target_old_cookie', 'GET', sessionPath(capsule.session) + '/descriptor', { cookie: capsule.cookie });
      need(revoked.status === 410 && json(revoked).code === 'SESSION_REVOKED', 'AUTH_PERSISTENT_FENCE_NOT_PROVED'); privateHeaders(revoked);
      const fresh = await positive(await io.credentials());
      need(fresh.actorId === capsule.actorId && fresh.session.sessionId !== capsule.session.sessionId && fresh.cookie !== capsule.cookie && fresh.bearer !== capsule.bearer, 'AUTH_FRESH_IDENTITY');
      result = { actorId: fresh.actorId, loginId: fresh.loginId, sessionId: fresh.session.sessionId, projectId: PINS.projectId, modelVersionId: PINS.modelVersionId, loadId: fresh.session.loadId, expiresAt: fresh.session.expiresAt, absoluteExpiresAt: fresh.session.absoluteExpiresAt };
      targetAuth = fresh;
    }
  }
  active(); sameCurrent(current, publicBinding(await io.guard())); active();
  if (mode === 'prepare-source') await io.checkpoint('capsule', result);
  if (mode === 'check-target') await io.checkpoint('allowed-auth', allowedAuthMetadata(binding, targetAuth, io.runtimeRelative));
  return { status: 'PASS', mode, startedAt: new Date(startedAt).toISOString(), finishedAt: new Date(io.now()).toISOString(), binding: current, sourceBefore: capsule?.source ?? current, originalSession: mode === 'prepare-source' ? result.session : capsule.session, originalLoginExpiresAt: mode === 'prepare-source' ? result.loginExpiresAt : capsule.loginExpiresAt, outcomes, freshTargetSession: mode === 'check-target' ? result : null, capsule: mode === 'prepare-source' ? result : null, expiryChanged: false, renewed: false, deletedSessions: 0 };
}

export function makeOwner() { return randomUUID(); }

export async function boundedRequest(input, fetcher = fetch) {
  need(['http://127.0.0.1:5191', 'http://127.0.0.1:5192'].includes(input.origin) && input.path.startsWith('/api/') && !/[?#\\\r\n]/.test(input.path) && !input.path.includes('..') && ['GET', 'POST'].includes(input.method) && Number.isInteger(input.milliseconds) && input.milliseconds > 0 && input.milliseconds <= LIMITS.requestMilliseconds, 'AUTH_HTTP_SCOPE');
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(input.milliseconds)]) : AbortSignal.timeout(input.milliseconds);
  const headers = { Origin: input.origin, 'Sec-Fetch-Site': 'same-origin', Accept: input.binary ? 'application/octet-stream' : 'application/json' };
  if (input.bearer) headers.Authorization = 'Bearer ' + input.bearer;
  if (input.cookie) headers.Cookie = input.cookie;
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  need(body === undefined || Buffer.byteLength(body) <= 4096, 'AUTH_REQUEST_BOUND');
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try { response = await fetcher(input.origin + input.path, { method: input.method, headers, body, signal, redirect: 'error', credentials: 'omit' }); }
  catch { need(false, signal.aborted ? 'AUTH_HTTP_DEADLINE_OR_CANCEL' : 'AUTH_HTTP_TRANSPORT'); }
  const limit = input.binary ? LIMITS.resourceBytes : LIMITS.responseBytes, chunks = []; let size = 0;
  const reader = response.body?.getReader();
  try {
    if (reader) for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; const bytes = Buffer.from(part.value); size += bytes.length; need(size <= limit, 'AUTH_HTTP_RESPONSE_BOUND'); chunks.push(bytes); }
    signal.throwIfAborted();
  } catch (error) { await reader?.cancel().catch(() => {}); throw Object.assign(Error(safeCode(error)), { code: signal.aborted ? 'AUTH_HTTP_DEADLINE_OR_CANCEL' : safeCode(error) }); }
  finally { reader?.releaseLock(); }
  const selected = { cacheControl: response.headers.get('cache-control'), corp: response.headers.get('cross-origin-resource-policy'), nosniff: response.headers.get('x-content-type-options'), contentLength: response.headers.get('content-length'), contentRange: response.headers.get('content-range'), contentEncoding: response.headers.get('content-encoding'), setCookie: response.headers.getSetCookie() };
  need(Buffer.byteLength(JSON.stringify(selected)) <= 8192, 'AUTH_HTTP_HEADER_BOUND');
  return { status: response.status, bytes: Buffer.concat(chunks), headers: selected };
}
