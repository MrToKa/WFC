import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID, webcrypto } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';

const source = await fs.readFile(new URL('../web/workspace.mjs', import.meta.url), 'utf8');
const html = await fs.readFile(new URL('../web/workspace.html', import.meta.url), 'utf8');
const admin = { authenticated: true, csrfToken: 'fixture-csrf', user: { id: 'fixture-admin', email: 'admin@example.invalid', isAdmin: true, role: 'admin' } };
const credentialRoutes = new Set(['/api/credential-sessions/renew', '/api/autodesk/check', '/api/generations', '/api/generations/fixture-job/resume']);

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(check) { for (let count = 0; count < 50; count++) { if (check()) return; await setImmediate(); } assert.fail('Expected browser request did not arrive'); }

// Run the whole page script. No browser, live server, credentials or Autodesk call
// is involved: the fixture supplies DOM events, a manual clock and fake transport.
async function browser({ session = admin, generations = [], transport } = {}) {
  const elements = new Map(), windowListeners = new Map(), documentListeners = new Map(), timers = new Map(), calls = [];
  let nextTimer = 0, now = Date.now(), currentSession = structuredClone(session), rows = structuredClone(generations), latestCredentials;
  function node(tag = 'div') {
    const listeners = new Map();
    return { tagName: tag.toUpperCase(), value: '', files: [], children: [], checked: false, hidden: false, disabled: false, textContent: '', className: '', attributes: {},
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
      get firstChild() { return this.children[0]; }, get childNodes() { return this.children; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
      async emit(type, extra = {}) { for (const listener of listeners.get(type) || []) await listener({ preventDefault() {}, ...extra }); },
    };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  // Simulate fields restored by a browser: module startup must still empty them.
  get('client-id').value = 'restored-client-id'; get('client-secret').value = 'restored-client-secret';
  const document = { getElementById: get, createElement: node, hidden: false, addEventListener(type, listener) { documentListeners.set(type, listener); } };
  const fetch = async (route, options = {}) => {
    const call = { route, ...options, headers: new Headers(options.headers) }; calls.push(call);
    const custom = transport && await transport(call); if (custom !== undefined) return custom;
    if (route === '/api/session') return Response.json(currentSession);
    if (route === '/api/session/login') { currentSession = structuredClone(admin); return Response.json({ authenticated: true }); }
    if (route === '/api/session/logout') { currentSession = { authenticated: false, csrfToken: 'signed-out-csrf' }; return Response.json({ authenticated: false }); }
    if (route === '/api/projects') return Response.json({ projects: [{ id: 'fixture-project', name: 'Fixture project' }] });
    if (route === '/api/sources') return Response.json({ inputs: [{ inputId: 'fixture-source', name: 'fixture.nwd', bytes: 123 }] });
    if (route === '/api/generations' && (!options.method || options.method === 'GET')) return Response.json({ generations: rows });
    if (route === '/api/credential-sessions') {
      const input = JSON.parse(options.body);
      latestCredentials = { leaseToken: randomUUID(), leaseId: randomUUID(), pageId: input.pageId, configurationId: 'fixture-configuration', expiresAt: new Date(now + 120000).toISOString(), ownerId: currentSession.user.id, configured: true, freePlanConfirmed: input.freePlanConfirmed };
      return Response.json({ credentials: latestCredentials });
    }
    if (route === '/api/credential-sessions/renew') { latestCredentials = { ...latestCredentials, expiresAt: new Date(now + 120000).toISOString() }; return Response.json({ credentials: latestCredentials }); }
    if (route === '/api/credential-sessions/current') return Response.json({ revoked: true });
    if (route === '/api/autodesk/check') return Response.json({ state: 'ready', checkedAt: new Date(now).toISOString() });
    if (route === '/api/uploads?kind=nwd') return Response.json({ uploadId: 'fixture-upload' });
    if (route === '/api/generations' && options.method === 'POST') { rows = [{ id: 'fixture-job', label: 'Fixture model', status: 'running', stage: 'queued' }]; return Response.json({ generation: rows[0] }); }
    if (route === '/api/generations/fixture-job/resume') return Response.json({ resumed: true });
    throw new Error(`Unexpected fixture route ${route}`);
  };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const forbiddenStorage = new Proxy({}, { get() { assert.fail('The workspace must not access browser storage'); } });
  const context = vm.createContext({ document, window: { addEventListener(type, listener) { windowListeners.set(type, listener); } }, fetch, crypto: { randomUUID, getRandomValues: bytes => webcrypto.getRandomValues(bytes) }, Headers, AbortController, Date: ClockDate, Intl,
    localStorage: forbiddenStorage, sessionStorage: forbiddenStorage,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  const app = await vm.runInContext(`(async () => {\n${source}\nreturn { state, api, checkAutodesk, ready, poll, renewCredentials, renderGenerations, resumeGeneration };\n})()`, context);
  async function enterKeys(clientId = 'synthetic-client-id', clientSecret = 'synthetic-client-secret') {
    get('client-id').value = clientId; await get('client-id').emit('input');
    get('client-secret').value = clientSecret; await get('client-secret').emit('input');
    get('free-confirmed').checked = true; await get('free-confirmed').emit('input');
  }
  return { ...app, get, calls, timers, document, enterKeys,
    async check() { await get('settings-form').emit('submit'); },
    advance(ms) { now += ms; },
    async timer(delay) { const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay); assert.ok(entry, `No timer for ${delay} ms`); timers.delete(entry[0]); await entry[1].fn(); },
    async windowEvent(type, event = {}) { await windowListeners.get(type)?.(event); },
    async documentEvent(type) { await documentListeners.get(type)?.(); },
  };
}

test('page starts with empty manual keys and ignores saved settings or global readiness', async () => {
  const app = await browser({ session: { ...admin, settings: { clientId: 'old-global-id', clientSecret: 'old-global-secret', configured: true }, autodesk: { state: 'ready' } } });
  assert.equal(app.get('client-id').value, ''); assert.equal(app.get('client-secret').value, '');
  assert.equal(app.state.credentials, null); assert.equal(app.state.autodesk, null); assert.equal(app.ready(), false);
  assert.equal(app.get('generate-button').disabled, true);
  assert.equal(app.calls.some(call => call.route === '/api/settings' || call.route === '/api/credential-sessions'), false);
  assert.equal(app.calls.some(call => call.route === '/api/sources'), false);
  assert.equal(app.get('workspace-screen').hidden, false);
});

test('trusted current admin flag is required even when a role string says admin', async () => {
  for (const isAdmin of [false, undefined]) {
    const app = await browser({ session: { ...admin, user: { ...admin.user, isAdmin } } });
    assert.equal(app.get('workspace-screen').hidden, true); assert.equal(app.get('login-screen').hidden, false);
    assert.equal(app.calls.filter(call => call.route === '/api/projects').length, 0);
    assert.match(app.get('feedback').textContent, /Only WFC administrators/);
  }
});

test('Check Autodesk registers manually entered keys, then uses only the opaque lease token', async () => {
  const app = await browser(); await app.enterKeys(); await app.check();
  const registration = app.calls.find(call => call.route === '/api/credential-sessions'), input = JSON.parse(registration.body);
  assert.equal(input.clientId, 'synthetic-client-id'); assert.equal(input.clientSecret, 'synthetic-client-secret');
  assert.equal(input.pageId, app.state.pageId); assert.equal(input.region, 'EMEA'); assert.equal(Object.hasOwn(input, 'bucket'), false); assert.equal(input.freePlanConfirmed, true);
  const check = app.calls.find(call => call.route === '/api/autodesk/check');
  assert.equal(check.headers.get('X-Preparer-Credentials'), app.state.credentials.leaseToken);
  assert.notEqual(check.headers.get('X-Preparer-Credentials'), app.state.credentials.leaseId);
  assert.equal(check.headers.get('X-Preparer-Page'), app.state.pageId); assert.equal(check.headers.get('X-Preparer-CSRF'), admin.csrfToken);
  assert.equal(app.get('client-secret').value, 'synthetic-client-secret'); assert.equal(app.ready(), true);
  assert.equal(Object.hasOwn(app.state, 'clientSecret'), false);
  for (const call of app.calls.filter(row => row !== registration)) assert.equal(String(call.body || '').includes('synthetic-client-secret'), false);
});

test('both keys and APS Free confirmation are required before any registration', async () => {
  const app = await browser(); await app.check(); await app.enterKeys(); app.get('free-confirmed').checked = false; await app.check();
  assert.equal(app.calls.some(call => call.route === '/api/credential-sessions'), false); assert.equal(app.ready(), false);
});

test('credential edits revoke the old lease immediately and block further generation', async () => {
  const app = await browser(); await app.enterKeys(); await app.check(); const token = app.state.credentials.leaseToken, pageId = app.state.pageId;
  app.get('client-secret').value = 'replacement-synthetic-secret'; await app.get('client-secret').emit('input');
  assert.equal(app.state.credentials, null); assert.equal(app.state.autodesk, null); assert.equal(app.ready(), false); assert.equal(app.get('free-confirmed').checked, false);
  const release = app.calls.find(call => call.route === '/api/credential-sessions/current');
  assert.equal(release.method, 'DELETE'); assert.equal(release.keepalive, true); assert.equal(release.body, '{}'); assert.equal(release.headers.get('Content-Type'), 'application/json'); assert.equal(release.headers.get('X-Preparer-Credentials'), token); assert.equal(release.headers.get('X-Preparer-Page'), pageId);
  app.get('known-source').value = 'fixture-source'; await app.get('generate-form').emit('submit');
  assert.equal(app.calls.some(call => call.route === '/api/generations' && call.method === 'POST'), false);
});

test('ordinary hidden tabs retain page keys and renew access every thirty seconds', async () => {
  const app = await browser(); await app.enterKeys(); await app.check(); const token = app.state.credentials.leaseToken;
  app.document.hidden = true; await app.documentEvent('visibilitychange');
  assert.equal(app.get('client-secret').value, 'synthetic-client-secret'); assert.equal(app.state.credentials.leaseToken, token);
  app.advance(30000); await app.timer(30000);
  const renewal = app.calls.find(call => call.route === '/api/credential-sessions/renew');
  assert.equal(renewal.headers.get('X-Preparer-Credentials'), token); assert.equal(app.ready(), true);
  assert.equal(app.calls.some(call => call.route === '/api/credential-sessions/current'), false);
});

test('expired lease fails closed before Generate and cannot renew itself', async () => {
  const app = await browser(); await app.enterKeys(); await app.check(); app.advance(120001);
  app.get('known-source').value = 'fixture-source'; await app.get('generate-form').emit('submit');
  assert.equal(app.ready(), false); assert.equal(app.calls.some(call => call.route === '/api/generations' && call.method === 'POST'), false);
  await app.renewCredentials(); assert.equal(app.state.credentials, null);
  assert.equal(app.calls.some(call => call.route === '/api/credential-sessions/renew'), false);
});

test('renewal network failure clears readiness but retains manually entered page keys', async () => {
  const app = await browser({ transport(call) { if (call.route === '/api/credential-sessions/renew') throw new TypeError('Synthetic offline transport'); } });
  await app.enterKeys(); await app.check(); await app.renewCredentials();
  assert.equal(app.state.credentials, null); assert.equal(app.state.autodesk, null); assert.equal(app.get('client-secret').value, 'synthetic-client-secret');
  assert.equal(app.get('generate-button').disabled, true); assert.match(app.get('feedback').textContent, /connection was interrupted/i);
});

test('expired server credential session retains page keys, while loss of admin access clears them', async () => {
  for (const code of ['CREDENTIAL_SESSION_REQUIRED', 'ADMIN_REQUIRED']) {
    const app = await browser({ transport(call) { if (call.route === '/api/credential-sessions/renew') return Response.json({ error: { code } }, { status: code === 'ADMIN_REQUIRED' ? 403 : 401 }); } });
    await app.enterKeys(); await app.check(); await app.renewCredentials();
    assert.equal(app.state.credentials, null); assert.equal(app.ready(), false);
    assert.equal(app.get('client-secret').value, code === 'ADMIN_REQUIRED' ? '' : 'synthetic-client-secret');
    assert.equal(app.get('workspace-screen').hidden, code === 'ADMIN_REQUIRED');
  }
});

test('malformed credential renewal cannot retain readiness or arm another renewal', async () => {
  const app = await browser({ transport(call) { if (call.route === '/api/credential-sessions/renew') return Response.json({ credentials: { leaseToken: 'malformed-synthetic-token', pageId: call.headers.get('X-Preparer-Page'), ownerId: admin.user.id, configured: true, freePlanConfirmed: true, expiresAt: 'invalid-date' } }); } });
  await app.enterKeys(); await app.check(); await app.renewCredentials();
  assert.equal(app.state.credentials, null); assert.equal(app.get('generate-button').disabled, true); assert.equal([...app.timers.values()].some(timer => timer.delay === 30000), false);
});

test('pagehide clears keys synchronously and BFCache return starts a new empty page identity', async () => {
  const app = await browser(); await app.enterKeys(); await app.check(); const pageId = app.state.pageId;
  await app.windowEvent('pagehide');
  assert.equal(app.get('client-id').value, ''); assert.equal(app.get('client-secret').value, ''); assert.equal(app.state.credentials, null); assert.equal(app.state.closing, true); assert.equal(app.timers.size, 0);
  assert.equal(app.calls.find(call => call.route === '/api/credential-sessions/current').keepalive, true);
  // A browser may restore form values from BFCache independently of module state.
  app.get('client-secret').value = 'restored-after-close'; await app.windowEvent('pageshow', { persisted: true });
  assert.notEqual(app.state.pageId, pageId); assert.equal(app.get('client-secret').value, ''); assert.equal(app.state.closing, false); assert.equal(app.ready(), false);
});

test('logout clears credentials, selected files and owner data', async () => {
  const app = await browser({ generations: [{ id: 'fixture-job', status: 'complete', label: 'Fixture complete' }] });
  await app.enterKeys(); await app.check(); app.get('model-file').value = 'fixture.nwd'; app.get('model-label').value = 'Fixture';
  await app.get('logout').emit('click');
  assert.equal(app.get('client-id').value, ''); assert.equal(app.get('client-secret').value, ''); assert.equal(app.get('model-file').value, ''); assert.equal(app.get('model-label').value, '');
  assert.equal(app.state.generations.length, 0); assert.equal(app.state.projects.length, 0); assert.equal(app.get('workspace-screen').hidden, true);
});

test('late Autodesk response cannot restore readiness after a credential edit', async () => {
  const pending = deferred(); const app = await browser({ transport(call) { if (call.route === '/api/autodesk/check') return pending.promise; } });
  await app.enterKeys(); const checking = app.check(); await until(() => app.calls.some(call => call.route === '/api/autodesk/check'));
  const request = app.calls.find(call => call.route === '/api/autodesk/check'); app.get('client-secret').value = 'changed-synthetic-secret'; await app.get('client-secret').emit('input');
  assert.equal(request.signal.aborted, true); pending.resolve(Response.json({ state: 'ready' })); await checking;
  assert.equal(app.state.autodesk, null); assert.equal(app.state.credentials, null); assert.equal(app.ready(), false); assert.equal(app.state.busy, false);
});

test('late registration response is discarded and its old lease is released best effort', async () => {
  const pending = deferred(); const app = await browser({ transport(call) { if (call.route === '/api/credential-sessions') return pending.promise; } });
  await app.enterKeys(); const checking = app.check(); await until(() => app.calls.some(call => call.route === '/api/credential-sessions'));
  const pageId = app.state.pageId; await app.windowEvent('pagehide');
  pending.resolve(Response.json({ credentials: { leaseToken: 'late-synthetic-token', pageId, expiresAt: new Date(Date.now() + 120000).toISOString() } })); await checking;
  assert.equal(app.state.credentials, null); assert.equal(app.get('client-secret').value, '');
  const release = app.calls.find(call => call.route === '/api/credential-sessions/current'); assert.ok(release); assert.equal(release.headers.get('X-Preparer-Credentials'), 'late-synthetic-token'); assert.equal(release.headers.get('X-Preparer-Page'), pageId);
  assert.equal(app.calls.some(call => call.route === '/api/autodesk/check'), false);
});

test('late progress response cannot restore the previous owner data after logout', async () => {
  const pending = deferred(); let hold = false;
  const app = await browser({ transport(call) { if (hold && call.route === '/api/generations' && call.method === 'GET') return pending.promise; } });
  hold = true; const polling = app.poll(); await until(() => app.calls.filter(call => call.route === '/api/generations').length === 2);
  await app.get('logout').emit('click'); pending.resolve(Response.json({ generations: [{ id: 'fixture-stale', status: 'complete', label: 'Stale owner model' }] })); await polling;
  assert.equal(app.state.generations.length, 0); assert.equal(app.get('generations-list').children.length, 0); assert.equal(app.get('workspace-screen').hidden, true);
});

test('each page has its own keys and lease, while Generate and recovery carry its lease', async () => {
  const a = await browser(), b = await browser(); await a.enterKeys('synthetic-admin-a', 'synthetic-secret-a'); await b.enterKeys('synthetic-admin-b', 'synthetic-secret-b'); await a.check(); await b.check();
  assert.notEqual(a.state.pageId, b.state.pageId); assert.notEqual(a.state.credentials.leaseToken, b.state.credentials.leaseToken);
  a.get('known-source').value = 'fixture-source'; a.get('model-label').value = 'Fixture'; await a.get('generate-form').emit('submit'); await a.resumeGeneration('fixture-job');
  for (const call of a.calls.filter(call => credentialRoutes.has(call.route) && call.method === 'POST' && call.route !== '/api/credential-sessions')) {
    assert.equal(call.headers.get('X-Preparer-Credentials'), a.state.credentials.leaseToken); assert.equal(call.headers.get('X-Preparer-Page'), a.state.pageId); assert.equal(String(call.body || '').includes('synthetic-secret-b'), false);
  }
  assert.equal(b.get('client-secret').value, 'synthetic-secret-b');
});

test('completed ZIP uses an owner-authenticated local link without a credential token', async () => {
  const app = await browser({ generations: [{ id: 'fixture-job', status: 'complete', label: 'Fixture complete' }] });
  function walk(node) { return [node, ...node.children.flatMap(walk)]; }
  const link = walk(app.get('generations-list')).find(node => node.tagName === 'A');
  assert.ok(link); assert.equal(link.href, '/api/generations/fixture-job/package'); assert.equal(link.href.includes('lease'), false); assert.equal(app.state.credentials, null);
});

test('workspace copy is English and has no saved-key or browser-storage path', () => {
  assert.match(html, /<html lang="en">/); assert.doesNotMatch(html + source, /[а-яА-Я]/);
  assert.doesNotMatch(source, /['"]\/api\/settings['"]|localStorage|sessionStorage/);
  assert.doesNotMatch(html, /secret-saved|save-settings|Blank.*keeps/i);
  assert.match(html, /id="client-secret"[^>]*required/); assert.match(html, /Only WFC administrators/);
});
