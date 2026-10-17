import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createBrowserBoundary, instrumentContext } from '../viewer-sessions/browser-policy.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function control(state, composeArgs, spec) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...composeArgs, '--profile', 'tests', 'run', '--rm', '--no-deps', '-T', 'tests', 'node', 'scripts/project-model-selection/fixture-control.mjs'], { cwd: state.projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', () => reject(Error('FIXTURE_CONTROL_START_FAILED')));
    child.once('close', code => {
      if (code !== 0) { reject(Error('FIXTURE_CONTROL_FAILED_' + code + ': ' + stderr.slice(-1200))); return; }
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); } catch { reject(Error('FIXTURE_CONTROL_RESPONSE_INVALID')); }
    });
    child.stdin.end(JSON.stringify(spec));
  });
}
async function login(page, base, credentials) {
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/^Email\s*\*?$/).fill(credentials.email);
  await page.getByLabel(/^Password\s*\*?$/).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30_000 });
}
const section = page => page.getByRole('region', { name: '3D model', exact: true });
const saveButton = page => section(page).getByRole('button', { name: 'Save', exact: true });
async function ready(page) {
  await section(page).getByText('Active model', { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => ![...document.querySelectorAll('[role="progressbar"]')].some(node => node.closest('section')?.textContent.includes('3D model')));
}
async function choose(page, model) {
  const dropdown = section(page).getByRole('combobox', { name: 'Model version', exact: true });
  await dropdown.click();
  const option = model === null ? page.getByRole('option', { name: 'No model', exact: true }) : page.getByRole('option').filter({ hasText: model.sourceName });
  assert.equal(await option.count(), 1); await option.click();
}
async function saved(page) {
  await section(page).getByText('Model selection saved.', { exact: true }).waitFor({ timeout: 600_000 });
  assert.equal(await saveButton(page).isDisabled(), true);
}
async function runMode({ browser, state, composeArgs, base, mode, attempt }) {
  const credentials = { email: `stage6-${randomUUID()}@fixture.invalid`, password: randomBytes(32).toString('base64url') };
  const reader = { email: `stage6-${randomUUID()}@fixture.invalid`, password: randomBytes(32).toString('base64url') };
  const facts = await control(state, composeArgs, { ...credentials, readerEmail: reader.email, readerPassword: reader.password });
  const boundary = await createBrowserBoundary({ allowedOrigins: [base] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', proxy: { server: boundary.server, bypass: '<-loopback>' } });
  const traffic = await instrumentContext(context, [base]);
  await context.addInitScript(({ projectId }) => {
    globalThis.__stage6LoadedEnvelopes = [];
    addEventListener('message', event => {
      if (event.origin !== location.origin || event.source !== document.querySelector('iframe[title="Protected 3D model"]')?.contentWindow) return;
      const message = event.data;
      if (message?.channel === 'wfc-routings-viewer' && message.type === 'MODEL_LOADED' && message.projectId === projectId) {
        // Only public identity fields from the exact frame; no descriptor URLs,
        // credentials or arbitrary worker diagnostics are retained.
        globalThis.__stage6LoadedEnvelopes.push({ modelVersionId: message.modelVersionId, loadId: message.loadId,
          instanceId: message.instanceId, nodeIndexReady: message.payload?.nodeIndexReady === true });
      }
    });
  }, { projectId: facts.projectId });
  const report = { mode, origin: base, startedAt: new Date().toISOString(), status: 'RUNNING', facts, cases: [], screenshots: [], mutations: [], metadataResponses: [] };
  const modelRoute = new RegExp(`/api/projects/${facts.projectId}/model-versions$`);
  context.on('request', request => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname.endsWith('/active-model')) {
      const body = request.postDataJSON(); report.mutations.push({ path: new URL(request.url()).pathname, modelVersionId: body.modelVersionId, expectedSelectionRevision: body.expectedSelectionRevision });
    }
  });
  context.on('response', response => {
    if (modelRoute.test(new URL(response.url()).pathname)) void response.headerValue('cache-control').then(value => report.metadataResponses.push({ status: response.status(), cacheControl: value }));
  });
  const step = async (name, work) => {
    const startedAt = new Date().toISOString(); console.log(JSON.stringify({ mode, case: name, status: 'RUNNING' }));
    try { await work(); report.cases.push({ name, status: 'PASS', startedAt, finishedAt: new Date().toISOString() }); }
    catch (error) { report.cases.push({ name, status: 'FAIL', startedAt, message: String(error.message).slice(0, 1500) }); throw error; }
  };
  const screenshot = async (page, label) => { const filename = `stage6-${attempt}-${mode}-${label}.png`; await page.screenshot({ path: path.join(state.evidenceDirectory, filename), fullPage: true }); report.screenshots.push(filename); };
  const page = await context.newPage(); let viewerPage, oldCookie;
  const details = `${base}/projects/${facts.projectId}`;
  try {
    await login(page, base, credentials);
    await step('Actual initial loading, authoritative no-selection and no default/no-op PATCH', async () => {
      const gate = deferred(); let held = false;
      await page.route(modelRoute, async route => { if (!held) { held = true; await gate.promise; } await route.continue(); });
      await page.goto(details, { waitUntil: 'domcontentloaded' });
      await section(page).getByText('Loading 3D models...', { exact: true }).waitFor();
      assert.equal(report.mutations.length, 0); gate.resolve(); await ready(page); await page.unroute(modelRoute);
      await section(page).getByText('No model selected', { exact: true }).waitFor(); assert.equal(await saveButton(page).isDisabled(), true);
      assert.equal(report.mutations.length, 0);
      assert.equal(traffic.observed.some(row => /\/viewer-runtime\/|\/sdk\//.test(row.pathname)), false);
      await screenshot(page, 'editor-no-selection');
    });
    await step('Keyboard explicit draft/save, one pending request and real authoritative response', async () => {
      await choose(page, facts.modelA); assert.equal(report.mutations.length, 0);
      const gate = deferred(), reached = deferred();
      const activeRoute = new RegExp(`/api/projects/${facts.projectId}/active-model$`);
      await page.route(activeRoute, async route => { const response = await route.fetch({ timeout: 600_000 }); reached.resolve(); await gate.promise; await route.fulfill({ response }); });
      await saveButton(page).focus(); await page.keyboard.press('Enter');
      await section(page).getByText('Saving model selection...', { exact: true }).waitFor();
      assert.equal(await section(page).getByRole('button', { name: 'Saving...', exact: true }).isDisabled(), true);
      await reached.promise; assert.equal(report.mutations.length, 1); gate.resolve(); await saved(page); await page.unroute(activeRoute);
      assert.equal(report.mutations[0].modelVersionId, facts.modelA.id); assert.equal(report.mutations[0].expectedSelectionRevision, 0);
      await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page); assert.equal(report.mutations.length, 1);
      await section(page).getByText('Status: Available', { exact: true }).waitFor(); await screenshot(page, 'editor-active');
    });
    if (mode === 'docker') await step('Real Aalborg harness session exists before the Details selection mutation', async () => {
      viewerPage = await context.newPage(); await viewerPage.goto(`${details}/viewer-harness`, { waitUntil: 'domcontentloaded' });
      await viewerPage.getByRole('button', { name: 'Load active model', exact: true }).click();
      await viewerPage.waitForFunction(() => document.querySelector('[data-testid="viewer-event"]')?.getAttribute('data-event-type') === 'MODEL_LOADED', null, { timeout: 600_000 });
      const event = await viewerPage.evaluate(() => globalThis.__stage6LoadedEnvelopes.at(-1)); assert.equal(event.modelVersionId, facts.modelA.id); assert.equal(event.nodeIndexReady, true);
      oldCookie = (await context.cookies()).find(cookie => cookie.name === 'wfc_viewer_session' && cookie.path.includes(facts.modelA.id)); assert.ok(oldCookie);
      report.loadedModelVersionId = event.modelVersionId;
      report.originalLoadId = event.loadId;
    });
    await step('Actual second-tab null + stale first-tab CAS409 never silently resubmits its draft', async () => {
      await page.bringToFront(); await ready(page); await choose(page, facts.modelB);
      const other = await context.newPage(); await other.goto(details, { waitUntil: 'domcontentloaded' }); await ready(other);
      await choose(other, null); await saveButton(other).click(); await saved(other);
      const before = report.mutations.length;
      const conflict = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/active-model') && response.status() === 409);
      // Dispatch the existing visible button event without refocusing the stale tab;
      // focus/reveal reconciliation is a separate case below.
      await saveButton(page).dispatchEvent('click'); await conflict;
      await section(page).getByText('The model selection changed elsewhere. Review the latest selection before saving.', { exact: true }).waitFor();
      assert.equal(report.mutations.length, before + 1); assert.equal(await saveButton(page).isDisabled(), true);
      await section(page).getByRole('button', { name: 'Keep my choice', exact: true }).click();
      await saveButton(page).click(); await saved(page); assert.equal(report.mutations.at(-1).modelVersionId, facts.modelB.id);
      await choose(page, facts.modelA); await saveButton(page).click(); await saved(page); await other.close();
    });
    if (mode === 'docker') await step('Away/back revision never revives old resource cookie; explicit fresh harness load uses current Aalborg', async () => {
      const denied = await context.request.get(base + oldCookie.path + 'resources/output/0/0.svf', { headers: { Cookie: `${oldCookie.name}=${oldCookie.value}`, Origin: base, 'Sec-Fetch-Site': 'same-origin' } });
      assert.equal(denied.status(), 409);
      await viewerPage.getByRole('button', { name: 'Close viewer', exact: true }).click();
      await viewerPage.getByRole('button', { name: 'Load active model', exact: true }).click();
      await viewerPage.waitForFunction(() => document.querySelector('[data-testid="viewer-event"]')?.getAttribute('data-event-type') === 'MODEL_LOADED', null, { timeout: 600_000 });
      const event = await viewerPage.evaluate(() => globalThis.__stage6LoadedEnvelopes.at(-1)); assert.equal(event.modelVersionId, facts.modelA.id); assert.equal(event.nodeIndexReady, true); assert.notEqual(event.loadId, report.originalLoadId);
      report.freshLoadId = event.loadId;
      const currentCookies = await context.cookies(); assert.ok(currentCookies.some(cookie => cookie.name === oldCookie.name && cookie.path !== oldCookie.path));
      await viewerPage.getByRole('button', { name: 'Close viewer', exact: true }).click(); await viewerPage.close(); viewerPage = null;
    });
    await step('Lost actual PATCH response reconciles by GET without replay or false Saved', async () => {
      await page.bringToFront(); await ready(page); await choose(page, null);
      const routePattern = new RegExp(`/api/projects/${facts.projectId}/active-model$`); let lost = false;
      await page.route(routePattern, async route => { if (lost) return route.continue(); lost = true; await route.fetch({ timeout: 600_000 }); await route.abort('failed'); });
      const before = report.mutations.length; await saveButton(page).click();
      await section(page).getByText('The save response could not be confirmed. Review the current server selection before saving again.', { exact: true }).waitFor();
      await section(page).getByText('No model selected', { exact: true }).waitFor(); assert.equal(report.mutations.length, before + 1);
      await page.unroute(routePattern); await section(page).getByRole('button', { name: 'Use latest selection', exact: true }).click();
      await choose(page, facts.modelA); await saveButton(page).click(); await saved(page);
    });
    await step('Actual unavailable variant returns503, activeA is preserved and unavailable option is disabled', async () => {
      await choose(page, facts.modelB);
      await control(state, composeArgs, { action: 'make-variant-unavailable', projectId: facts.projectId, modelVersionId: facts.modelB.id });
      const failed = page.waitForResponse(response => response.url().endsWith('/active-model') && response.status() === 503);
      await saveButton(page).click(); await failed;
      await section(page).getByText('This model is unavailable. The active selection has not been replaced.', { exact: true }).waitFor();
      await section(page).getByText('Status: Available', { exact: true }).waitFor();
      await section(page).getByRole('combobox', { name: 'Model version', exact: true }).click();
      const unavailable = page.getByRole('option').filter({ hasText: facts.modelB.sourceName }); assert.equal(await unavailable.getAttribute('aria-disabled'), 'true');
      await page.keyboard.press('Escape'); await screenshot(page, 'unavailable-variant');
    });
    await step('Read-only actual account sees active metadata with no editor controls or PATCH', async () => {
      // Use an independent login context so changing shared AuthContext storage
      // cannot change the editor session during this permission assertion.
      const readContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', proxy: { server: boundary.server, bypass: '<-loopback>' } });
      try {
        const readonly = await readContext.newPage(); let patches = 0; readonly.on('request', request => { if (request.method() === 'PATCH') patches++; });
        await login(readonly, base, reader); await readonly.goto(details, { waitUntil: 'domcontentloaded' }); await ready(readonly);
        await section(readonly).getByText('Read-only project access. Model selection cannot be changed.', { exact: true }).waitFor();
        assert.equal(await section(readonly).getByRole('combobox').count(), 0); assert.equal(await section(readonly).getByRole('button', { name: 'Save', exact: true }).count(), 0); assert.equal(patches, 0);
        await screenshot(readonly, 'read-only-active');
      } finally { await readContext.close(); }
    });
    await step('Empty project and failed GET are distinct; Retry returns authoritative metadata', async () => {
      await page.goto(`${base}/projects/${facts.emptyProjectId}`, { waitUntil: 'domcontentloaded' }); await ready(page);
      await section(page).getByText('No prepared models are available for this project.', { exact: true }).waitFor(); assert.equal(await saveButton(page).isDisabled(), true);
      // Keep the transient network fault active through focus/reveal refreshes.
      // Release it only at the user's actual Retry activation, before React
      // starts that GET; a one-request fault can disappear before the click.
      await page.addInitScript(() => {
        globalThis.__stage6ExplicitRetry = false;
        document.addEventListener('click', event => {
          const button = event.target instanceof Element ? event.target.closest('button') : null;
          if (button?.textContent.trim() === 'Retry' && button.closest('section')?.querySelector('h3')?.textContent === '3D model') globalThis.__stage6ExplicitRetry = true;
        }, true);
      });
      let failedReads = 0, releasedReads = 0;
      await page.route(modelRoute, async route => {
        const explicit = await page.evaluate(() => globalThis.__stage6ExplicitRetry === true).catch(() => false);
        if (!explicit) { failedReads++; return route.abort('failed'); }
        releasedReads++; return route.continue();
      });
      await page.goto(details, { waitUntil: 'domcontentloaded' }); await section(page).getByRole('button', { name: 'Retry', exact: true }).waitFor();
      await section(page).getByRole('button', { name: 'Retry', exact: true }).click(); await ready(page); await page.unroute(modelRoute);
      assert.ok(failedReads > 0); assert.ok(releasedReads > 0);
      report.retryFault = { failedReads, releasedReads, releasedByExplicitRetry: true };
    });
    assert.equal(traffic.blocked.length, 0); assert.equal(boundary.denied.length, 0); assert.equal(traffic.csp.length, 0);
    assert.ok(report.metadataResponses.length > 0); assert.ok(report.metadataResponses.every(row => /private/.test(row.cacheControl ?? '') && /no-store/.test(row.cacheControl ?? '')));
    report.status = 'PASS';
  } finally {
    if (viewerPage) await viewerPage.close();
    report.finishedAt = new Date().toISOString();
    report.network = { externalRequestsBlocked: traffic.blocked.length, boundaryDenials: boundary.denied.length, cspViolations: traffic.csp.length,
      origins: [...new Set(traffic.observed.map(row => row.origin))], requests: boundary.requests, workerCount: traffic.workers.length };
    if (report.status !== 'PASS') report.status = 'FAIL';
    await context.close(); await boundary.close();
    await fs.writeFile(path.join(state.evidenceDirectory, `stage6-browser-${attempt}-${mode}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  return report;
}
export async function runBrowserAcceptance({ state, composeArgs, playwrightModule, browserExecutable }) {
  if (!playwrightModule || !browserExecutable) throw Error('Explicit local Playwright and browser paths are required; nothing is downloaded.');
  const { chromium } = await import(pathToFileURL(path.resolve(playwrightModule)).href);
  const browser = await chromium.launch({ executablePath: path.resolve(browserExecutable), headless: true,
    args: ['--disable-background-networking', '--disable-quic', '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const attempt = Date.now() + '-' + randomUUID().slice(0, 8);
  const result = { startedAt: new Date().toISOString(), status: 'RUNNING', browser: browser.version(), browserExecutableSha256: createHash('sha256').update(await fs.readFile(browserExecutable)).digest('hex'), modes: [] };
  try {
    for (const [mode, port] of [['docker', state.proxyPort], ['development', state.devPort]]) result.modes.push(await runMode({ browser, state, composeArgs, base: `http://127.0.0.1:${port}`, mode, attempt }));
    result.status = 'PASS';
  } finally { result.finishedAt = new Date().toISOString(); if (result.status !== 'PASS') result.status = 'FAIL'; await browser.close(); await fs.writeFile(path.join(state.evidenceDirectory, `stage6-browser-${attempt}-summary.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); }
  console.log(JSON.stringify({ status: result.status, modes: result.modes.map(mode => ({ mode: mode.mode, cases: mode.cases.length })) }));
}
