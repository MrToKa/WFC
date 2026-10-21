import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createAPSProvider, createEngineerCostProvider } from '../index.mjs';
import { createPreparerService } from './service.mjs';
import { createWorkspaceSecurity, WorkspaceSecurityError } from './workspace-security.mjs';
import { readConfiguration, loadPrivateAPSConfiguration } from './config.mjs';
import { createJournal, UUID, digest } from './io.mjs';
import { bad, safeError, ServiceError } from './errors.mjs';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const PROJECT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGES = {
  AUTODESK_SETTINGS_REQUIRED: 'Администратор трябва да запази Autodesk ключовете и да потвърди Free плана.',
  AUTODESK_ACCESS_FAILED: 'Autodesk отказа достъп. Проверете ключовете, региона и правата на приложението.',
  AUTODESK_RATE_LIMIT: 'Autodesk ограничи заявките. Изчакайте и опитайте проверката отново.',
  AUTODESK_CHECK_REQUIRED: 'Първо проверете достъпа до Autodesk.',
  CONFIGURATION_CHANGED: 'Настройките на Autodesk са променени. Проверете достъпа отново.',
  WFC_IMPORT_FAILED: 'WFC не завърши записа. ZIP файлът е запазен; продължете, за да повторите само записа.',
  GENERATION_TIMEOUT: 'Обработката още не е завършила. Може да продължите от същата заявка.',
};
class WorkspaceError extends Error {
  constructor(code, status = 409) { super(MESSAGES[code]); this.code = code; this.status = status; }
}
function errorDTO(error) {
  if (error instanceof WorkspaceError || error instanceof WorkspaceSecurityError) return { code: error.code, message: error.message };
  return safeError(error);
}
function send(res, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); res.end(bytes);
}
async function json(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) bad('INVALID_REQUEST');
  let bytes = 0; const parts = [];
  for await (const part of req) { bytes += part.length; if (bytes > 16384) bad('INVALID_REQUEST', 413); parts.push(part); }
  try { const value = JSON.parse(Buffer.concat(parts).toString('utf8')); if (!value || Object.getPrototypeOf(value) !== Object.prototype) bad('INVALID_REQUEST'); return value; }
  catch { bad('INVALID_REQUEST'); }
}
function exact(value, keys) { if (Object.keys(value).some(key => !keys.includes(key))) bad('INVALID_REQUEST'); return value; }
async function boundedJSON(response) {
  const parts = []; let bytes = 0;
  for await (const part of response.body || []) { bytes += part.length; if (bytes > 2 * 1024 * 1024) { await response.body?.cancel?.().catch(() => {}); bad('PROVIDER_RESPONSE_INVALID', 502); } parts.push(Buffer.from(part)); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { bad('PROVIDER_RESPONSE_INVALID', 502); }
}

/** WFC-authenticated public gateway. The existing durable conversion service is
 * private to this process on loopback. No legacy unauthenticated routes are
 * forwarded, and no credentials or remote addresses enter public job records. */
export async function createWorkspaceService(options = {}) {
  const config = options.config || options.configuration || readConfiguration(options.env);
  if (!config.wfcOrigin) bad('INVALID_REQUEST');
  const journal = await createJournal(path.join(config.dataDirectory, 'workspace-journal'), { instanceId: config.instanceId || null });
  let security;
  try {
    security = await createWorkspaceSecurity({ directory: path.join(config.dataDirectory, 'workspace-private'), wfcOrigin: config.wfcOrigin,
      publicOrigin: config.publicOrigin, seedAPSConfiguration: options.seedAPSConfiguration || loadPrivateAPSConfiguration(options.env),
      ...(options.wfcFetch ? { fetch: options.wfcFetch } : {}) });
  } catch (error) { await journal.close(); throw error; }
  const generations = new Map(), uploads = new Map(), requests = new Map();
  try {
    for (const row of await journal.list('operations')) {
      if (!UUID.test(row.id) || !PROJECT.test(row.ownerId) || !PROJECT.test(row.projectId) || !['running', 'needs-view', 'interrupted', 'failed', 'complete'].includes(row.status)) bad('STORE_CORRUPT', 500);
      if (row.status === 'running') { row.status = 'interrupted'; row.error = { code: 'OPERATION_INTERRUPTED', message: 'Работата е прекъсната. Влезте и продължете от запазеното състояние.' }; await journal.write('operations', row.id, row); }
      generations.set(row.id, row);
    }
    for (const row of await journal.list('uploads')) uploads.set(row.uploadId, row);
    for (const row of await journal.list('requests')) requests.set(row.requestId, row);
  } catch (error) { await journal.close(); throw error; }
  const csrf = randomBytes(32).toString('base64url'), shutdown = new AbortController();
  let origin = config.publicOrigin, inner = null, innerToken, innerRevision = null, innerOpening = null, active = null, closing = false;
  let access = { state: 'blocked', access: false, quotaKnown: false, message: 'Проверете достъпа до Autodesk.' };
  const apsFetch = options.apsFetch || globalThis.fetch;
  function authorization() {
    const settings = security.privateSettings();
    if (!settings?.enabled || !settings.freePlanConfirmed || !access.access || access.configurationId !== settings.configurationId) return { enabled: false };
    return { enabled: true, configurationId: settings.configurationId, accountHash: sha('aps-account:' + settings.clientId),
      applicationHash: sha(settings.clientId), bucketHash: sha(settings.bucket), region: settings.region,
      freePlanConfirmedBy: settings.freePlanConfirmedBy, freePlanConfirmedAt: settings.freePlanConfirmedAt };
  }
  function readySettings() {
    const settings = security.privateSettings();
    if (!settings?.enabled || !settings.freePlanConfirmed) throw new WorkspaceError('AUTODESK_SETTINGS_REQUIRED');
    return settings;
  }
  async function checkAutodesk() {
    const settings = readySettings();
    // This verifies OAuth and the application's storage access. Autodesk does
    // not expose an exact monthly remaining-conversion balance here.
    let response;
    try {
      response = await apsFetch('https://developer.api.autodesk.com/authentication/v2/token', { method: 'POST', redirect: 'manual',
        headers: { Authorization: 'Basic ' + Buffer.from(settings.clientId + ':' + settings.clientSecret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'data:read data:create data:write bucket:create bucket:read' }).toString(), signal: AbortSignal.timeout(20000) });
      if (!response.ok) { await response.body?.cancel(); throw new WorkspaceError(response.status === 429 ? 'AUTODESK_RATE_LIMIT' : 'AUTODESK_ACCESS_FAILED'); }
      const token = await boundedJSON(response);
      if (typeof token.access_token !== 'string' || !token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new WorkspaceError('AUTODESK_ACCESS_FAILED');
      response = await apsFetch('https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURIComponent(settings.bucket) + '/details', {
        redirect: 'manual', headers: { Authorization: 'Bearer ' + token.access_token, 'x-ads-region': settings.region }, signal: AbortSignal.timeout(20000) });
      // A missing bucket may be created by the guarded core at Generate time.
      if (![200, 404].includes(response.status)) { await response.body?.cancel(); throw new WorkspaceError(response.status === 429 ? 'AUTODESK_RATE_LIMIT' : 'AUTODESK_ACCESS_FAILED'); }
      const bucketExists = response.status === 200;
      const details = await boundedJSON(response);
      if (bucketExists && (details.bucketKey !== settings.bucket || details.bucketOwner !== settings.clientId)) throw new WorkspaceError('AUTODESK_ACCESS_FAILED');
      if (security.privateSettings()?.configurationId !== settings.configurationId) throw new WorkspaceError('CONFIGURATION_CHANGED');
      access = { state: 'ready', access: true, quotaKnown: false, configurationId: settings.configurationId, checkedAt: now(), bucketExists,
        message: 'Достъпът до Autodesk работи. Точният оставащ месечен лимит не е достъпен чрез API; Autodesk решава дали да приеме конверсията.' };
      return access;
    } catch (error) {
      const safe = error instanceof WorkspaceError ? error : new WorkspaceError('AUTODESK_ACCESS_FAILED');
      access = { state: 'blocked', access: false, quotaKnown: false, checkedAt: now(), message: safe.message };
      throw safe;
    }
  }
  async function ensureInner({ localOnly = false } = {}) {
    // Existing verified artifacts remain usable when cloud work is disabled.
    // A private runtime with blocked cost authority performs no startup calls.
    const settings = localOnly ? security.privateSettings() : readySettings();
    if (!settings) throw new WorkspaceError('AUTODESK_SETTINGS_REQUIRED');
    if (inner && innerRevision === settings.configurationId) return inner;
    if (innerOpening) return innerOpening;
    innerOpening = (async () => {
      if (inner) await inner.close(); inner = null;
      const configuration = { ...config, mode: 'live', port: 0, host: '127.0.0.1', publicOrigin: 'http://127.0.0.1:0', liveReuseOnly: false };
      const createLiveRuntime = async ({ store, packageApi }) => {
        const namespace = { account: 'team-' + sha('aps-account:' + settings.clientId), application: 'app-' + sha(settings.clientId) };
        const costProvider = await createEngineerCostProvider({ store, signingKeyPath: path.join(config.dataDirectory, 'workspace-private', 'cost.key'), getAuthorization: authorization });
        const provider = createAPSProvider({ ...settings, namespace, packageApi, authorizeRead: costProvider.reserveRead, reuseOnly: false,
          objectKeysBySource: { '11b2739d92020ee58a52a4e793cf8fd538fb30758eb42176aba93ac7319b048a': 'aalborg-11b2739d92020ee58a52a4e793cf8fd538fb30758eb42176aba93ac7319b048a.nwd' },
          ...(options.apsTestTransport ? { testTransport: options.apsTestTransport } : {}) });
        return { provider, costProvider, namespace, region: settings.region, logicalBucket: 'target-' + sha(settings.bucket) };
      };
      const service = await (options.createInnerService || createPreparerService)({ configuration, createLiveRuntime });
      try { await service.listen(); innerToken = (await (await fetch(service.address + '/api/config')).json()).csrfToken; }
      catch (error) { await service.close(); throw error; }
      inner = service; innerRevision = settings.configurationId; return inner;
    })();
    try { return await innerOpening; } finally { innerOpening = null; }
  }
  async function innerRequest(route, { method = 'GET', input, body, requestId = randomUUID(), headers = {} } = {}) {
    const service = await ensureInner({ localOnly: method === 'GET' });
    const response = await fetch(service.address + route, { method, redirect: 'manual', signal: shutdown.signal,
      headers: { ...(method !== 'GET' ? { Origin: service.address, 'X-Preparer-Token': innerToken, 'X-Request-Id': requestId } : {}),
        ...(input ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(input ? { body: JSON.stringify(input) } : body ? { body, duplex: 'half' } : {}) });
    return response;
  }
  async function innerJSON(route, options) {
    const response = await innerRequest(route, options), value = await boundedJSON(response);
    if (!response.ok) throw new ServiceError(value.error?.code || 'PROVIDER_FAILURE', response.status);
    return value;
  }
  const dto = row => ({ id: row.id, label: row.label, projectId: row.projectId, status: row.status, stage: row.stage,
    error: row.error || null, job: row.job || null, wfcVersionId: row.wfcVersionId || null, updatedAt: row.updatedAt });
  async function save(row) { row.updatedAt = now(); await journal.write('operations', row.id, row); generations.set(row.id, row); }
  async function own(auth, row) {
    if (!row || row.ownerId !== auth.user.id && !auth.user.isAdmin) bad('NOT_FOUND', 404);
    await security.requireProject(auth, row.projectId); return row;
  }
  async function updateJob(row) { row.job = (await innerJSON('/api/jobs/' + row.jobId)).job; await save(row); return row.job; }
  async function perform(row, phase, route, input) {
    row.stage = phase;
    if (!row.steps[phase]) row.steps[phase] = { requestId: randomUUID() };
    await save(row);
    const step = row.steps[phase];
    let op;
    if (step.operationId) op = (await innerJSON('/api/operations/' + step.operationId)).operation;
    else { op = (await innerJSON(route, { method: 'POST', input, requestId: step.requestId })).operation; step.operationId = op.operationId; await save(row); }
    while (['queued', 'running'].includes(op.status)) {
      if (Date.now() > row.deadline) throw new WorkspaceError('GENERATION_TIMEOUT');
      await delay(options.operationPollMs || 500, undefined, { signal: shutdown.signal });
      op = (await innerJSON('/api/operations/' + op.operationId)).operation;
      if (op.jobId) { try { row.job = (await innerJSON('/api/jobs/' + op.jobId)).job; await save(row); } catch {} }
    }
    if (op.status === 'interrupted') {
      if (phase === 'capture' && op.jobId) {
        try { row.job = (await innerJSON('/api/jobs/' + op.jobId)).job; row.jobId = op.jobId; step.done = true; await save(row); return op; }
        catch (error) { if (error.code !== 'JOB_MISSING' && error.code !== 'NOT_FOUND') throw error; }
      }
      delete row.steps[phase]; await save(row);
      return perform(row, phase, route, input);
    }
    if (op.status !== 'succeeded') {
      // Retrying creates a fresh local action identity; the core's immutable
      // submission WAL still forbids a second uncertain Autodesk submission.
      delete row.steps[phase]; await save(row);
      throw new ServiceError(op.error?.code || (op.status === 'interrupted' ? 'OPERATION_INTERRUPTED' : 'PROVIDER_FAILURE'), 409);
    }
    step.done = true; if (op.jobId) row.jobId = op.jobId; await save(row); return op;
  }
  async function action(row, name, extra = {}, key = name) {
    return perform(row, key, '/api/jobs/' + row.jobId + '/actions', { action: name, ...extra });
  }
  async function approve(row) {
    // Renewal is automatic and local; this is not a new Autodesk permission.
    const key = 'approval-' + (row.approvals = (row.approvals || 0) + 1);
    await action(row, 'approve-cost', {}, key);
  }
  async function wfcImport(row, auth) {
    row.stage = 'saving-to-wfc'; await save(row);
    await own(auth, row);
    if (!row.importId) {
      const pkg = row.job?.facts?.package;
      if (!pkg || !/^[a-f0-9]{64}$/.test(pkg.sha256) || !Number.isSafeInteger(pkg.bytes)) bad('ARTIFACT_INVALID', 409);
      row.importKey ||= randomUUID(); await save(row);
      const archive = await innerRequest('/api/artifacts/' + row.jobId + '/package');
      if (!archive.ok || Number(archive.headers.get('content-length')) !== pkg.bytes) { await archive.body?.cancel(); bad('ARTIFACT_INVALID', 409); }
      let response;
      try {
        response = await security.request(auth, '/api/projects/' + row.projectId + '/model-imports', { method: 'POST',
          headers: { 'Content-Type': 'application/zip', 'Content-Length': String(pkg.bytes), 'X-Package-SHA256': pkg.sha256, 'Idempotency-Key': row.importKey },
          body: archive.body, signal: shutdown.signal, timeoutMs: 900000 });
        const value = await boundedJSON(response);
        if (!response.ok || !PROJECT.test(value.importId)) throw new WorkspaceError('WFC_IMPORT_FAILED');
        row.importId = value.importId; await save(row);
      } finally { if (!archive.body?.locked) await archive.body?.cancel().catch(() => {}); }
    }
    for (;;) {
      await own(auth, row);
      const response = await security.request(auth, '/api/projects/' + row.projectId + '/model-imports/' + row.importId, { signal: shutdown.signal });
      const value = await boundedJSON(response), job = value.job;
      if (job?.state === 'failed') {
        row.failedImportIds = [...(row.failedImportIds || []), row.importId];
        delete row.importId; delete row.importKey; await save(row);
        throw new WorkspaceError('WFC_IMPORT_FAILED');
      }
      if (!response.ok || !job) throw new WorkspaceError('WFC_IMPORT_FAILED');
      if (job.state === 'complete') {
        if (!PROJECT.test(job.modelVersionId)) throw new WorkspaceError('WFC_IMPORT_FAILED');
        row.wfcVersionId = job.modelVersionId; row.status = 'complete'; row.stage = 'complete'; row.error = null; await save(row); return;
      }
      if (Date.now() > row.deadline) throw new WorkspaceError('GENERATION_TIMEOUT');
      await delay(options.importPollMs || 1500, undefined, { signal: shutdown.signal });
    }
  }
  async function generate(row, auth) {
    try {
      await own(auth, row);
      // Import-only retry works even when Autodesk is unavailable.
      if (!row.job?.facts?.package) {
        await checkAutodesk(); await ensureInner();
        if (!row.jobId) {
          await perform(row, 'capture', row.inputId ? '/api/jobs/capture-known' : '/api/jobs/capture', { label: row.label, ...(row.inputId ? { inputId: row.inputId } : { uploadId: row.uploadId }) });
        }
        let job = await updateJob(row);
        if (!job.facts.package) {
          await approve(row); job = await updateJob(row);
          if (!job.facts.submission || job.facts.submission.phase === 'none') { await own(auth, row); await action(row, 'prepare'); job = await updateJob(row); }
          while (job.facts.submission?.phase !== 'complete') {
            if (job.facts.submission?.phase === 'failed') throw new ServiceError('DERIVATIVE_FAILED', 409);
            if (Date.now() > row.deadline) throw new WorkspaceError('GENERATION_TIMEOUT');
            await own(auth, row); await approve(row);
            await action(row, 'reconcile', {}, 'reconcile-' + (row.polls = (row.polls || 0) + 1)); job = await updateJob(row);
            if (job.facts.submission?.phase !== 'complete') await delay(options.derivativePollMs || 15000, undefined, { signal: shutdown.signal });
          }
          if (!row.rootId) {
            if (job.roots.length > 1) { row.status = 'needs-view'; row.stage = 'choose-view'; await save(row); return; }
            if (job.roots.length !== 1) throw new ServiceError('UNSUPPORTED_PROFILE', 409);
            row.rootId = job.roots[0].rootId; await save(row);
          }
          await own(auth, row); await approve(row);
          if (job.facts.download?.status !== 'downloaded') await action(row, 'download', { rootId: row.rootId }, 'download-' + row.rootId);
          await updateJob(row);
          await action(row, 'package'); await updateJob(row);
        }
      }
      await wfcImport(row, auth);
    } catch (error) {
      row.status = closing ? 'interrupted' : 'failed'; row.error = errorDTO(error);
      await save(row).catch(() => {});
    }
  }
  function launch(row, auth) {
    if (active) bad('OPERATION_BUSY', 409);
    const promise = generate(row, auth).finally(() => { if (active?.id === row.id) active = null; });
    active = { id: row.id, promise };
  }
  let mutations = Promise.resolve();
  function serialize(action) { const result = mutations.then(action); mutations = result.catch(() => {}); return result; }
  async function route(req, res) {
    if (closing) bad('SHUTTING_DOWN', 503);
    if (req.headers.host !== new URL(origin).host) bad('HOST_DENIED', 403);
    const url = new URL(req.url, origin), route = url.pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const mutation = !['GET', 'HEAD'].includes(req.method);
    if (mutation && (req.headers.origin !== origin || req.headers['x-preparer-csrf'] !== csrf)) bad('CSRF_DENIED', 403);
    if (route === '/health' && req.method === 'GET') { send(res, 200, { status: 'ok', mode: 'live', authentication: 'wfc' }); return; }
    if (req.method === 'GET' && ['/', '/web/workspace.mjs', '/web/workspace.css'].includes(route)) {
      const name = route === '/' ? 'workspace.html' : route.slice(5), bytes = await fs.readFile(path.join(WEB, name));
      res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); res.end(bytes); return;
    }
    if (route === '/api/session/login' && req.method === 'POST') { const input = exact(await json(req), ['email', 'password']); send(res, 200, await security.login(req, res, input)); return; }
    if (route === '/api/session' && req.method === 'GET') {
      try { const auth = await security.authenticate(req); send(res, 200, { authenticated: true, user: auth.user, csrfToken: csrf, settings: await security.getSettings(auth), autodesk: access }); }
      catch (error) { if (error.code !== 'AUTH_REQUIRED' && error.code !== 'ENGINEER_REQUIRED') throw error; send(res, 200, { authenticated: false, csrfToken: csrf }); }
      return;
    }
    const auth = await security.authenticate(req);
    if (route === '/api/session/logout' && req.method === 'POST') { await json(req); await security.logout(req, res); send(res, 200, { ok: true }); return; }
    if (route === '/api/settings' && req.method === 'GET') { send(res, 200, await security.getSettings(auth)); return; }
    if (route === '/api/settings' && req.method === 'PUT') {
      const input = await json(req);
      await serialize(async () => { if (active) bad('OPERATION_BUSY', 409); const result = await security.saveSettings(auth, input); access = { state: 'blocked', access: false, quotaKnown: false, message: 'Настройките са запазени. Проверете достъпа до Autodesk.' }; send(res, 200, result); }); return;
    }
    if (route === '/api/projects' && req.method === 'GET') { send(res, 200, { projects: await security.listProjects(auth) }); return; }
    if (route === '/api/autodesk/check' && req.method === 'POST') { await json(req); send(res, 200, await checkAutodesk()); return; }
    if (route === '/api/sources' && req.method === 'GET') {
      const settings = security.privateSettings();
      send(res, 200, settings?.enabled && settings.freePlanConfirmed ? await innerJSON('/api/source-inputs') : { inputs: [] }); return;
    }
    if (route === '/api/uploads' && req.method === 'POST' && url.search === '?kind=nwd') {
      const requestId = req.headers['x-request-id']; if (!UUID.test(requestId || '')) bad('INVALID_REQUEST');
      await serialize(async () => {
        const previous = requests.get(requestId);
        if (previous && (previous.type !== 'upload' || previous.ownerId !== auth.user.id)) bad('REQUEST_CONFLICT', 409);
        if (!previous) {
          const reservation = { requestId, ownerId: auth.user.id, type: 'upload' };
          await journal.write('requests', requestId, reservation); requests.set(requestId, reservation);
        }
      });
      const value = await innerJSON('/api/uploads?kind=nwd', { method: 'POST', body: req, requestId, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': req.headers['x-file-name'] || '', ...(req.headers['content-length'] ? { 'Content-Length': req.headers['content-length'] } : {}) } });
      const receipt = { uploadId: value.uploadId, ownerId: auth.user.id }; await journal.write('uploads', receipt.uploadId, receipt); uploads.set(receipt.uploadId, receipt);
      send(res, 200, value); return;
    }
    if (route === '/api/generations' && req.method === 'GET') {
      const rows = [];
      for (const row of generations.values()) if (row.ownerId === auth.user.id || auth.user.isAdmin) { try { await security.requireProject(auth, row.projectId); rows.push(dto(row)); } catch (error) { if (error.code !== 'PROJECT_FORBIDDEN') throw error; } }
      send(res, 200, { generations: rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }); return;
    }
    if (route === '/api/generations' && req.method === 'POST') {
      const input = exact(await json(req), ['projectId', 'uploadId', 'inputId', 'label']);
      if (!PROJECT.test(input.projectId || '') || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 200 || /[\x00-\x1f]|https?:\/\/|bearer|access_token|client_secret/i.test(input.label) || !!input.uploadId === !!input.inputId || input.uploadId && !UUID.test(input.uploadId) || input.inputId && !/^[0-9a-f]{64}$/.test(input.inputId)) bad('INVALID_REQUEST');
      const requestId = req.headers['x-request-id']; if (!UUID.test(requestId || '')) bad('INVALID_REQUEST');
      await serialize(async () => {
        const identity = digest(input), previous = requests.get(requestId);
        if (previous) { if (previous.type !== 'generation' || previous.ownerId !== auth.user.id || previous.identity !== identity) bad('REQUEST_CONFLICT', 409); const row = await own(auth, generations.get(previous.id)); send(res, 202, { generation: dto(row) }); return; }
        if (active) bad('OPERATION_BUSY', 409);
        await security.requireProject(auth, input.projectId);
        if (input.uploadId && uploads.get(input.uploadId)?.ownerId !== auth.user.id) bad('NOT_FOUND', 404);
        if (!authorization().enabled) throw new WorkspaceError('AUTODESK_CHECK_REQUIRED');
        const row = { id: randomUUID(), ownerId: auth.user.id, ...input, label: input.label.trim(), status: 'running', stage: 'starting', steps: {}, createdAt: now(), updatedAt: now(), deadline: Date.now() + 6 * 60 * 60 * 1000 };
        await save(row);
        const receipt = { requestId, ownerId: auth.user.id, type: 'generation', id: row.id, identity };
        try { await journal.write('requests', requestId, receipt); requests.set(requestId, receipt); }
        catch (error) { row.status = 'interrupted'; row.error = errorDTO(error); await save(row).catch(() => {}); throw error; }
        launch(row, auth); send(res, 202, { generation: dto(row) });
      }); return;
    }
    const match = /^\/api\/generations\/([0-9a-f-]+)\/(resume|package)$/.exec(route);
    if (match && UUID.test(match[1])) {
      const row = await own(auth, generations.get(match[1]));
      if (match[2] === 'resume' && req.method === 'POST') {
        const input = exact(await json(req), ['rootId']);
        await serialize(async () => {
          if (active || row.status === 'running' || row.status === 'complete') bad('OPERATION_BUSY', 409);
          if (input.rootId !== undefined) { if (!row.job?.roots?.some(root => root.rootId === input.rootId)) bad('INVALID_REQUEST'); row.rootId = input.rootId; }
          if (row.status === 'needs-view' && !row.rootId) bad('INVALID_REQUEST');
          row.status = 'running'; row.error = null; row.deadline = Date.now() + 6 * 60 * 60 * 1000; await save(row); launch(row, auth); send(res, 202, { generation: dto(row) });
        }); return;
      }
      if (match[2] === 'package' && req.method === 'GET') {
        if (!row.job?.facts?.package) bad('NOT_FOUND', 404);
        const response = await innerRequest('/api/artifacts/' + row.jobId + '/package');
        if (!response.ok) { await response.body?.cancel(); bad('ARTIFACT_INVALID', 409); }
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': response.headers.get('content-length'), 'Content-Disposition': `attachment; filename="model-${row.id}.zip"`, 'Cache-Control': 'no-store' });
        await pipeline(Readable.fromWeb(response.body), res); return;
      }
    }
    bad('NOT_FOUND', 404);
  }
  const sockets = new Set();
  const server = http.createServer((req, res) => { route(req, res).catch(error => { if (res.headersSent) res.destroy(); else send(res, error.status || 500, { error: errorDTO(error) }); }); });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  let closePromise;
  return { server, mode: 'live', get address() { return origin; },
    async listen() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); }); if (config.port === 0) origin = 'http://127.0.0.1:' + server.address().port; return origin; },
    close() {
      return closePromise ||= (async () => { closing = true; shutdown.abort(); if (innerOpening) await innerOpening.catch(() => {}); if (inner) await inner.close(); await active?.promise;
        await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); for (const socket of sockets) socket.destroy(); }); await mutations; await journal.close(); })();
    },
  };
}
