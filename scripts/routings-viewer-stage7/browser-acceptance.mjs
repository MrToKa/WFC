import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createBrowserBoundary, instrumentContext } from '../viewer-sessions/browser-policy.mjs';

const ROUTES = [
  '/DFB018-1/DFB011/DFB012/DFB013/B002/B107-1/B107-2/B107-3/BC025/BC022-2/SECONDARY',
  '/DFBC002-2/DFC001/DFC002/DFC003/C002/C107-1/C107-2/C107-3/BC025/BC023-4/SECONDARY',
];
const sha = value => createHash('sha256').update(value).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const credentials = () => ({ email: `stage7-${randomUUID()}@fixture.invalid`, password: randomBytes(32).toString('base64url') });
const region = page => page.getByRole('region', { name: 'Routings viewer', exact: true });
const result = page => page.getByTestId('routing-result');
const button = (page, name) => region(page).getByRole('button', { name, exact: true });
async function control(state, composeArgs, spec) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...composeArgs, '--profile', 'tests', 'run', '--rm', '--no-deps', '-T', 'tests', 'node', 'scripts/routings-viewer-stage7/fixture-control.mjs'], { cwd: state.projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', () => reject(Error('FIXTURE_CONTROL_START_FAILED')));
    child.once('close', code => {
      if (code !== 0) return reject(Error('FIXTURE_CONTROL_FAILED_' + code + ': ' + stderr.slice(-1200)));
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); } catch { reject(Error('FIXTURE_CONTROL_RESPONSE_INVALID')); }
    }); child.stdin.end(JSON.stringify(spec));
  });
}
async function login(page, base, account) {
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/^Email\s*\*?$/).fill(account.email); await page.getByLabel(/^Password\s*\*?$/).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30_000 });
}
const collector = ({ projectId }) => {
  globalThis.__stage7Events = [];
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== document.querySelector('[data-testid="routings-model-host"] iframe')?.contentWindow) return;
    const value = event.data;
    if (value?.channel !== 'wfc-routings-viewer' || value.projectId !== projectId || !['MODEL_LOADED', 'ROUTE_RESULT', 'ROUTE_ZOOMED', 'ROUTE_CLEARED', 'ERROR', 'REQUEST_CANCELLED'].includes(value.type)) return;
    // Only public protocol data from this exact frame; never URLs, headers,
    // cookies, credentials or private SDK/controller objects.
    const snapshot = { type: value.type, instanceId: value.instanceId, projectId: value.projectId,
      modelVersionId: value.modelVersionId, loadId: value.loadId, requestId: value.requestId, payload: value.payload };
    globalThis.__stage7Events.push(snapshot);
    globalThis.__stage7ObservedBridge?.(snapshot).catch(() => {});
  });
};
const eventCount = page => page.evaluate(() => globalThis.__stage7Events.length);
async function next(page, type, after = 0, timeout = 600_000, expected = null) {
  const matches = (value, type, expected) => value.type === type && (!expected ||
    ['instanceId', 'projectId', 'modelVersionId', 'loadId'].every(key => value[key] === expected[key]) &&
    value.payload.rawRouting === expected.rawRouting && value.payload.source === expected.source && value.payload.cableId === expected.cableId);
  await page.waitForFunction(({ type, after, expected }) => {
    const matches = value => value.type === type && (!expected ||
      ['instanceId', 'projectId', 'modelVersionId', 'loadId'].every(key => value[key] === expected[key]) &&
      value.payload.rawRouting === expected.rawRouting && value.payload.source === expected.source && value.payload.cableId === expected.cableId);
    const terminalPhase = document.querySelector('[data-testid="routings-viewer-status"]')?.getAttribute('data-phase');
    return globalThis.__stage7Events.slice(after).some(value => matches(value) || !expected && value.type === 'ERROR') || expected && ['error', 'login-required', 'access-denied', 'unavailable'].includes(terminalPhase);
  }, { type, after, expected }, { timeout });
  const events = await page.evaluate(after => globalThis.__stage7Events.slice(after), after);
  const value = events.find(value => matches(value, type, expected) || !expected && value.type === 'ERROR');
  if (!value) throw Error('VIEWER_UI_TERMINAL_BEFORE_CURRENT_ROUTE_RESULT');
  if (value.type === 'ERROR' && type !== 'ERROR') throw Error('VIEWER_' + value.payload.code);
  return value;
}
async function modelReady(page, facts, after = 0) {
  const value = await next(page, 'MODEL_LOADED', after); assert.equal(value.modelVersionId, facts.model.id); assert.equal(value.payload.nodeIndexReady, true);
  await button(page, 'Show route').waitFor(); await page.waitForFunction(() => !document.querySelector('[data-testid="routings-viewer-tab"] button')?.disabled);
  const frame = page.frames().find(value => value.url().includes('/viewer-runtime/7.130.0/index.html')); assert.ok(frame);
  const evidence = await frame.locator('#runtime-evidence').evaluate(node => ({ ...node.dataset }));
  assert.equal(evidence.geometryLoaded, 'true'); assert.equal(evidence.nodeIndexReady, 'true'); assert.equal(evidence.propertiesLoaded, 'true');
  assert.ok(Number(evidence.fragmentCount) > 600_000); assert.ok(Number(evidence.nodeCount) > 400_000); assert.ok(Number(evidence.propertiesCount) > 0);
  return { value, frame, evidence };
}
async function show(page, raw, expected, { keyboard = false } = {}) {
  const before = await eventCount(page), prior = await result(page).getAttribute('data-operation-id').catch(() => null);
  const loaded = await page.evaluate(() => globalThis.__stage7Events.filter(value => value.type === 'MODEL_LOADED').at(-1)); assert.ok(loaded);
  await region(page).getByRole('textbox', { name: 'Manual routing', exact: true }).fill(raw);
  if (keyboard) { await button(page, 'Show route').focus(); await page.keyboard.press('Enter'); } else await button(page, 'Show route').click();
  const model = await next(page, 'ROUTE_RESULT', before, 600_000, { instanceId: loaded.instanceId, projectId: loaded.projectId, modelVersionId: loaded.modelVersionId, loadId: loaded.loadId, rawRouting: raw, source: 'manual', cableId: null });
  assert.equal(model.payload.rawRouting, raw); assert.equal(model.payload.source, 'manual'); assert.equal(model.payload.cableId, null);
  await page.waitForFunction(({ expected, prior }) => {
    const value = document.querySelector('[data-testid="routing-result"]');
    return value?.getAttribute('data-route-status') === expected && value.getAttribute('data-operation-id') !== prior;
  }, { expected, prior }, { timeout: 30_000 });
  return model;
}
async function rows(page) {
  const details = result(page).locator('details'); if (await details.count() && await details.getAttribute('open') === null) await details.locator('summary').click();
  return result(page).locator('[data-segment-index]').evaluateAll(nodes => nodes.map(node => ({ index: Number(node.dataset.segmentIndex), key: node.dataset.routeKey, project: node.dataset.projectState, model: node.dataset.modelState, drawable: node.dataset.drawable })));
}
async function settleCanvas(page, frame) {
  const after = await eventCount(page); await button(page, 'Zoom to route').click(); await next(page, 'ROUTE_ZOOMED', after, 30_000); const canvas = frame.locator('canvas').first();
  await page.mouse.move(1, 1); await page.waitForTimeout(2000);
  let previous, samples = 0;
  for (; samples < 24; samples++) { const current = sha(await canvas.screenshot()); if (previous === current) return { samples: samples + 1, stableConsecutiveCanvasFrames: 2 }; previous = current; await page.waitForTimeout(250); }
  throw Error('CAMERA_NOT_SETTLED');
}
async function runMode({ browser, state, composeArgs, base, mode, attempt }) {
  const editor = credentials(), accounts = { reader: credentials(), technician: credentials(), readOnlyEngineer: credentials() };
  const facts = await control(state, composeArgs, { ...editor, ...accounts });
  const boundary = await createBrowserBoundary({ allowedOrigins: [base] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', proxy: { server: boundary.server, bypass: '<-loopback>' } });
  const traffic = await instrumentContext(context, [base]); await context.addInitScript(collector, { projectId: facts.projectId });
  const report = { schemaVersion: 1, mode, origin: base, startedAt: new Date().toISOString(), status: 'RUNNING', facts, cases: [], screenshots: [], trayReads: [], layout: [], bridgeEvents: [] };
  await context.exposeBinding('__stage7ObservedBridge', (_source, value) => { report.bridgeEvents.push(value); });
  const page = await context.newPage(); const details = `${base}/projects/${facts.projectId}`, target = details + '?tab=routings-viewer';
  const trayPattern = new RegExp(`/api/projects/${facts.projectId}/trays(?:\\?.*)?$`);
  const cableReads = [], frameRequests = [];
  context.on('request', request => {
    const url = new URL(request.url());
    if (/\/api\/projects\/[^/]+\/(?:cables|cable-types|tray-data)(?:\/|$)/.test(url.pathname) || url.pathname === '/api/cable-types' || url.pathname.startsWith('/api/materials/')) cableReads.push({ path: url.pathname, method: request.method() });
    if (url.pathname.includes('/viewer-runtime/')) frameRequests.push(url.pathname);
    if (url.pathname === `/api/projects/${facts.projectId}/trays`) report.trayReads.push({ method: request.method(), path: url.pathname, queryKeys: [...url.searchParams.keys()] });
  });
  const step = async (name, work) => {
    const startedAt = new Date().toISOString(); console.log(JSON.stringify({ mode, case: name, status: 'RUNNING' }));
    try { const evidence = await work(); report.cases.push({ name, status: 'PASS', startedAt, finishedAt: new Date().toISOString(), ...(evidence ?? {}) }); }
    catch (error) { report.cases.push({ name, status: 'FAIL', startedAt, message: String(error.message).slice(0, 1200) }); throw error; }
  };
  const screenshot = async label => { const filename = `stage7-${attempt}-${mode}-${label}.png`; await page.screenshot({ path: path.join(state.evidenceDirectory, filename), fullPage: true }); report.screenshots.push(filename); };
  try {
    await login(page, base, editor);
    let active;
    await step('Real Routings viewer direct-link/tab order, protected model/index/properties; no cable or cable-type fetch', async () => {
      cableReads.length = 0; await page.goto(target, { waitUntil: 'domcontentloaded' }); await region(page).waitFor();
      const tabs = page.getByRole('tablist', { name: 'Project sections', exact: true });
      const beforeTab = tabs.getByRole('tab', { name: 'Cables list', exact: true }), currentTab = tabs.getByRole('tab', { name: 'Routings viewer', exact: true }), afterTab = tabs.getByRole('tab', { name: 'Trays', exact: true });
      const currentHandle = await currentTab.elementHandle(), afterHandle = await afterTab.elementHandle();
      assert.equal(await beforeTab.evaluate((node, current) => node.nextElementSibling === current, currentHandle), true);
      assert.equal(await currentTab.evaluate((node, after) => node.nextElementSibling === after, afterHandle), true);
      await currentHandle.dispose(); await afterHandle.dispose();
      assert.equal(await page.getByRole('tab', { name: 'Routings viewer', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await region(page).getByRole('tab', { name: 'Cables', exact: true }).isDisabled(), true);
      active = await modelReady(page, facts); assert.equal(cableReads.length, 0); assert.equal(report.trayReads.length, 0);
      return { model: active.evidence, selectedVersionId: active.value.modelVersionId, cableOrCatalogRequests: 0, eagerTrayReads: 0, frameRequestCount: frameRequests.length };
    });
    await step('Two actual ten-segment routes combine fresh DB existence with drawable model geometry and settled continuous yellow lines', async () => {
      const results = [];
      for (let i = 0; i < ROUTES.length; i++) {
        const value = await show(page, ROUTES[i], 'complete', { keyboard: i === 0 }); assert.equal(value.payload.drawableCount, 10); assert.equal(value.payload.lineCount, 1); assert.equal(value.payload.ignored.length, 1);
        const observed = await rows(page); assert.equal(observed.length, 10); assert.ok(observed.every(row => row.project === 'exists' && row.model === 'found' && row.drawable === 'true'));
        const camera = await settleCanvas(page, active.frame); await screenshot('route-' + (i + 1) + '-settled'); results.push({ model: value.payload, rows: observed, camera });
      }
      assert.equal(cableReads.length, 0); return { results, trayReads: report.trayReads.length };
    });
    await step('Actual DB-only removal leaves model geometry drawable and reports the exact missing project tray', async () => {
      await control(state, composeArgs, { action: 'remove-model-tray', projectId: facts.projectId });
      try {
        const model = await show(page, ROUTES[1], 'partial'); assert.equal(model.payload.drawableCount, 10); assert.equal(model.payload.lineCount, 1);
        const observed = await rows(page), row = observed.find(value => value.key === 'DFC003'); assert.equal(row.project, 'missing'); assert.equal(row.model, 'found'); assert.equal(row.drawable, 'true');
        await result(page).getByText('DFC003 does not exist in this project', { exact: false }).waitFor(); await screenshot('actual-db-missing-model-drawable'); return { rows: observed, lineCount: 1 };
      } finally { await control(state, composeArgs, { action: 'restore-model-tray', projectId: facts.projectId }); }
    });
    await step('Actual normalized DB collision and DB-only identifier preserve separate per-occurrence model facts', async () => {
      await control(state, composeArgs, { action: 'add-collision', projectId: facts.projectId });
      try {
        await show(page, '/BC025/STAGE7_DB_ONLY/BC025/SECONDARY', 'partial'); const observed = await rows(page);
        assert.equal(observed.length, 3); assert.deepEqual(observed.map(row => row.index), [0, 1, 2]);
        assert.ok(observed.filter(row => row.key === 'BC025').every(row => row.project === 'ambiguous' && row.model === 'found' && row.drawable === 'true'));
        assert.equal(observed[1].project, 'exists'); assert.equal(observed[1].model, 'missing'); await screenshot('ambiguous-db-model-independent'); return { rows: observed };
      } finally { await control(state, composeArgs, { action: 'remove-collision', projectId: facts.projectId }); }
    });
    await step('DB network failure is unavailable, keeps current drawable line and never fabricates missing matches', async () => {
      let failedReads = 0; await page.route(trayPattern, route => { failedReads++; return route.abort('failed'); });
      try {
        const model = await show(page, ROUTES[0], 'partial'); assert.equal(model.payload.lineCount, 1);
        const observed = await rows(page); assert.ok(observed.every(row => row.project === 'unavailable' && row.model === 'found' && row.drawable === 'true')); assert.ok(failedReads > 0);
        await screenshot('db-unavailable-model-line-retained'); return { faultBasis: 'Browser transport abort of only fixture tray GET; not an authorization denial.', failedReads, rows: observed };
      } finally { await page.unroute(trayPattern); }
    });
    await step('New Show supersedes delayed DB reply; Clear cancels pending work and preserves text without stale status or zoom', async () => {
      const gate = deferred(), reached = deferred(); let first = true;
      let winning;
      await page.route(trayPattern, async route => { if (first) { first = false; const response = await route.fetch(); reached.resolve(); await gate.promise; await route.fulfill({ response }).catch(() => {}); } else await route.continue(); });
      try {
        await region(page).getByRole('textbox', { name: 'Manual routing', exact: true }).fill(ROUTES[0]); await button(page, 'Show route').click(); await reached.promise;
        winning = await show(page, ROUTES[1], 'complete'); const winningOperation = await result(page).getAttribute('data-operation-id'); gate.resolve(); await page.waitForTimeout(250);
        assert.equal(winning.payload.rawRouting, ROUTES[1]); assert.equal(await result(page).getAttribute('data-operation-id'), winningOperation); assert.ok((await rows(page)).some(row => row.key === 'DFC003'));
      } finally { gate.resolve(); await page.unroute(trayPattern); }
      const prior = await result(page).getAttribute('data-operation-id'); const repeated = await show(page, ROUTES[1], 'complete'); assert.notEqual(await result(page).getAttribute('data-operation-id'), prior); assert.notEqual(repeated.requestId, winning.requestId);
      const delayed = deferred(), inFlight = deferred(); await page.route(trayPattern, async route => { inFlight.resolve(); await delayed.promise; await route.continue().catch(() => {}); });
      try {
        await button(page, 'Show route').click(); await inFlight.promise; await button(page, 'Clear').click(); delayed.resolve(); await page.waitForTimeout(250);
        assert.equal(await region(page).getByRole('textbox', { name: 'Manual routing', exact: true }).inputValue(), ROUTES[1]); assert.equal(await button(page, 'Zoom to route').isDisabled(), true);
        assert.equal(await result(page).count(), 0);
      } finally { delayed.resolve(); await page.unroute(trayPattern); }
    });
    await step('Empty and invalid routes clear locally without a DB lookup or stale Zoom; repeated identifiers retain marker indices', async () => {
      for (const [raw, expected] of [['', 'empty'], ['/A／B', 'invalid']]) {
        const reads = report.trayReads.length;
        await region(page).getByRole('textbox', { name: 'Manual routing', exact: true }).fill(raw); await button(page, 'Show route').click();
        await page.waitForFunction(expected => document.querySelector('[data-testid="routing-result"]')?.getAttribute('data-route-status') === expected, expected);
        assert.equal(await button(page, 'Zoom to route').isDisabled(), true); assert.equal(report.trayReads.length, reads);
      }
      await show(page, '/BC025/SECONDARY/BC025', 'complete');
      const observed = await rows(page); assert.deepEqual(observed.map(value => value.index), [0, 2]); assert.ok(observed.every(value => value.key === 'BC025'));
      await show(page, '/STAGE7_DB_ONLY', 'none'); const dbOnly = await rows(page); assert.equal(dbOnly[0].project, 'exists'); assert.equal(dbOnly[0].model, 'missing'); assert.equal(await button(page, 'Zoom to route').isDisabled(), true);
      return { repeatedOccurrenceIndices: observed.map(value => value.index), invalidBasis: 'NFKC introduces an internal slash, which the canonical parser rejects.' };
    });
    await step('Responsive shell uses actual free space:320px desktop,280px medium,stacked narrow, short height and desktop zoom-equivalent metrics', async () => {
      await show(page, ROUTES[1], 'complete');
      for (const [width, height, column] of [[1440, 900, 320], [899, 700, 280], [639, 700, null], [1440, 560, 320]]) {
        await page.setViewportSize({ width, height }); await page.waitForTimeout(200);
        const layout = await page.getByTestId('routings-layout').evaluate(node => { const box = node.getBoundingClientRect(), css = getComputedStyle(node), canvas = node.querySelector('iframe')?.getBoundingClientRect(); return { width: innerWidth, height: innerHeight, top: box.top, bottom: box.bottom, columns: css.gridTemplateColumns.split(' ').map(Number.parseFloat), scrollWidth: document.documentElement.scrollWidth, canvasWidth: canvas?.width, canvasHeight: canvas?.height }; });
        assert.ok(layout.scrollWidth <= width + 1); assert.ok(layout.canvasWidth > 50 && layout.canvasHeight > 40);
        if (column !== null) { assert.ok(Math.abs(layout.columns[0] - column) < 2); assert.ok(layout.bottom <= height + 2); } else assert.equal(layout.columns.length, 1);
        report.layout.push(layout);
      }
      // Deliberately put the measured anchor below the viewport rather than
      // assuming that an arbitrary short height actually reaches this edge.
      await page.setViewportSize({ width: 899, height: 240 }); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200);
      const offscreen = await page.getByTestId('routings-viewer-tab').evaluate(node => ({ top: node.getBoundingClientRect().top, viewportBottom: visualViewport ? visualViewport.offsetTop + visualViewport.height : innerHeight }));
      assert.ok(offscreen.top >= offscreen.viewportBottom, 'The short-height fixture must actually place the long-heading viewer anchor below the visible viewport.');
      const input = region(page).getByRole('textbox', { name: 'Manual routing', exact: true }); await input.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const input = document.querySelector('textarea[aria-label="Manual routing"]'), header = document.querySelector('header');
        if (input && header) { const top = input.getBoundingClientRect().top, bottom = header.getBoundingClientRect().bottom; if (top < bottom) scrollBy(0, top - bottom); }
      }); await page.waitForTimeout(200);
      const scrolled = await page.getByTestId('routings-layout').evaluate(node => {
        const box = node.getBoundingClientRect(), header = document.querySelector('header')?.getBoundingClientRect(), input = node.querySelector('textarea')?.getBoundingClientRect(), frame = node.querySelector('iframe')?.getBoundingClientRect();
        return { top: box.top, height: box.height, scrollY, stickyHeaderBottom: header?.bottom, inputTop: input?.top, inputBottom: input?.bottom, frameHeight: frame?.height, columns: getComputedStyle(node).gridTemplateColumns.split(' ').map(Number.parseFloat), viewportHeight: innerHeight, scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
      });
      assert.ok(scrolled.height > 40 && scrolled.frameHeight > 40); assert.ok(Math.abs(scrolled.columns[0] - 280) < 2); assert.ok(scrolled.scrollWidth <= scrolled.viewportWidth + 1);
      assert.ok(scrolled.inputBottom > scrolled.stickyHeaderBottom && scrolled.inputTop < scrolled.viewportHeight);
      await button(page, 'Show route').scrollIntoViewIfNeeded(); await button(page, 'Show route').waitFor({ state: 'visible' });
      report.layout.push({ edge: 'Long heading initially below short viewport; actual scrolling triggers measured fallback and remeasurement.', beforeScroll: offscreen, afterScroll: scrolled }); await screenshot('short-height-scrolled-controls');
      await page.evaluate(() => scrollTo(0, 0));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1152, height: 800, deviceScaleFactor: 1.25, mobile: false }); await page.waitForTimeout(200);
      const zoom = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth, height: innerHeight, devicePixelRatio, visualViewportWidth: visualViewport?.width }));
      assert.equal(zoom.viewport, 1152); assert.equal(zoom.devicePixelRatio, 1.25); assert.ok(zoom.scrollWidth <= zoom.viewport + 1);
      report.layout.push({ mechanism: 'Chrome CDP desktop metrics:1152x800CSS pixels atDPR1.25, equivalent layout to1440x1000physical at125percent. Not a toolbar-zoom or CSSzoom claim.', ...zoom });
      await screenshot('responsive-zoom-equivalent'); await cdp.send('Emulation.clearDeviceMetricsOverride'); await cdp.detach(); await page.setViewportSize({ width: 1440, height: 1000 });
      const theme = page.getByRole('switch', { name: 'Toggle dark mode', exact: true });
      if (await theme.getAttribute('aria-checked') !== 'true') await theme.click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      const hostBackground = await page.getByTestId('routings-model-host').evaluate(node => getComputedStyle(node).backgroundColor); assert.equal(hostBackground, 'rgb(245, 245, 245)');
      await screenshot('dark-shell-light-viewer'); report.layout.push({ wfcTheme: 'dark', viewerHostBackground: hostBackground });
      await theme.click();
    });
    await step('Project-tab arrow keys and Enter activate adjacent sections; Back aborts the pending frame and Forward creates a fresh load', async () => {
      const projectTabs = page.getByRole('tablist', { name: 'Project sections', exact: true });
      await projectTabs.getByRole('tab', { name: 'Routings viewer', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
      await page.waitForURL(url => url.searchParams.get('tab') === 'trays');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="routings-model-host"] iframe').length === 0);
      const trayPanel = page.getByRole('tabpanel', { name: 'Trays', exact: true });
      await trayPanel.getByRole('combobox', { name: 'Select trays page', exact: true }).waitFor();
      assert.equal(await trayPanel.getByRole('button', { name: 'Next', exact: true }).isDisabled(), false);
      await trayPanel.getByRole('button', { name: 'Next', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Select trays page"]')?.textContent.includes('Page 2'));
      await trayPanel.getByRole('textbox', { name: 'Filter trays', exact: true }).fill('STAGE7-no-matching-tray');
      await trayPanel.getByText('No trays found', { exact: true }).waitFor();
      await projectTabs.getByRole('tab', { name: 'Trays', exact: true }).focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
      await page.waitForURL(url => url.searchParams.get('tab') === 'routings-viewer');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="routings-model-host"] iframe').length === 1);
      await page.goBack({ waitUntil: 'domcontentloaded' }); await page.waitForURL(url => url.searchParams.get('tab') === 'trays');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="routings-model-host"] iframe').length === 0);
      const beforeForward = await eventCount(page);
      await page.goForward({ waitUntil: 'domcontentloaded' }); await region(page).waitFor(); await modelReady(page, facts, beforeForward);
      await show(page, ROUTES[1], 'complete');
      const independent = await rows(page); assert.ok(independent.every(row => row.project === 'exists' && row.model === 'found' && row.drawable === 'true'));
      await screenshot('fresh-after-keyboard-and-history');
      return { keyboard: ['ArrowRight+Enter:Routings viewer→Trays', 'ArrowLeft+Enter:Trays→Routings viewer'], actualTraysPageVisited: 2, actualTrayFilter: 'STAGE7-no-matching-tray', filteredTableEmpty: true, independentFullSnapshotRoute: 'complete', backDisposedPendingFrame: true, forwardLoadedCurrentModel: true };
    });
    await step('Null then same-UUID reselect invalidates the old load; explicit Retry creates a fresh current controller', async () => {
      const old = await page.evaluate(() => globalThis.__stage7Events.filter(value => value.type === 'MODEL_LOADED').at(-1));
      await control(state, composeArgs, { action: 'set-selection', projectId: facts.projectId, selected: false });
      await page.bringToFront(); await page.evaluate(() => dispatchEvent(new Event('focus')));
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="routings-model-host"] iframe').length === 0, null, { timeout: 30_000 });
      await control(state, composeArgs, { action: 'set-selection', projectId: facts.projectId, selected: true });
      const beforeRetry = await eventCount(page); await button(page, 'Retry').click(); const fresh = await next(page, 'MODEL_LOADED', beforeRetry);
      assert.equal(fresh.modelVersionId, facts.model.id); assert.notEqual(fresh.instanceId, old.instanceId); assert.notEqual(fresh.loadId, old.loadId);
      return { oldLoadId: old.loadId, freshLoadId: fresh.loadId, sameModelVersionId: fresh.modelVersionId };
    });
    // Close the editor renderer before checking more accounts; each read role
    // demonstrates actual admission without holding several large models in RAM.
    await page.goto(details + '?tab=details'); await page.waitForFunction(() => document.querySelectorAll('iframe[title="Protected 3D model"]').length === 0);
    await step('Basic, technician and unassigned read-only engineer can enter the tab; actual grant revocation disposes the reader frame', async () => {
      const roles = [];
      for (const name of ['reader', 'technician', 'readOnlyEngineer']) {
        const childContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', proxy: { server: boundary.server, bypass: '<-loopback>' } });
        const childTraffic = await instrumentContext(childContext, [base]);
        try {
          const child = await childContext.newPage(); let created = 0;
          child.on('response', response => { if (response.request().method() === 'POST' && /\/viewer-sessions$/.test(new URL(response.url()).pathname) && response.status() === 201) created++; });
          await login(child, base, accounts[name]); await child.goto(target, { waitUntil: 'domcontentloaded' }); await region(child).waitFor();
          await child.waitForFunction(() => document.querySelector('[data-testid="routings-model-host"] iframe') !== null);
          const deadline = Date.now() + 30_000; while (!created && Date.now() < deadline) await child.waitForTimeout(100); assert.ok(created > 0);
          if (name === 'reader') {
            await control(state, composeArgs, { action: 'revoke-reader', projectId: facts.projectId, userId: facts.actorIds.reader });
            await child.evaluate(() => dispatchEvent(new Event('focus')));
            await child.waitForFunction(() => document.querySelectorAll('iframe[title="Protected 3D model"]').length === 0, null, { timeout: 30_000 });
            await screenshot('editor-after-reader-revocation');
          }
          roles.push({ name, resourceSessionsCreated: created, actualAccessRevocation: name === 'reader' });
        } finally {
          await childContext.close();
          for (const field of ['observed', 'blocked', 'workers', 'csp']) traffic[field].push(...childTraffic[field]);
        }
      } return { roles, basis: 'Actual login + protected resource-session201 per role; model loaded/index/geometry proven separately by the editor route cases.' };
    });
    await step('No selection, metadata transport failure and controlled401/403/404 remain distinct without creating an iframe', async () => {
      const emptyTarget = `${base}/projects/${facts.emptyProjectId}?tab=routings-viewer`;
      const metadata = new RegExp(`/api/projects/${facts.emptyProjectId}/model-versions$`);
      await page.goto(emptyTarget); await page.waitForFunction(() => document.querySelector('[data-testid="routings-viewer-status"]')?.getAttribute('data-phase') === 'no-model');
      assert.equal(await page.locator('iframe[title="Protected 3D model"]').count(), 0);
      await page.route(metadata, route => route.abort('failed'));
      await button(page, 'Retry').click(); await button(page, 'Retry').waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid="routings-viewer-status"]')?.getAttribute('data-phase') === 'error');
      await page.unroute(metadata); await button(page, 'Retry').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="routings-viewer-status"]')?.getAttribute('data-phase') === 'no-model');
      const statuses = [];
      for (const status of [401, 403, 404]) {
        await page.route(metadata, route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'Controlled isolated fixture access denial' }) }));
        await page.reload();
        const expected = status === 401 ? 'login-required' : 'access-denied';
        await page.waitForFunction(expected => document.querySelector('[data-testid="routings-viewer-status"]')?.getAttribute('data-phase') === expected, expected);
        assert.equal(await page.locator('iframe[title="Protected 3D model"]').count(), 0); assert.equal(await button(page, 'Retry').count(), status === 401 ? 0 : 1);
        statuses.push({ status, phase: expected }); await page.unroute(metadata);
      }
      return { statuses, basis: 'Browser-only controlled metadata status responses; actual corresponding server401/403/404 are verified by the API contract run, and actual current-grant revocation is the preceding browser case.' };
    });
    assert.equal(traffic.blocked.length, 0); assert.equal(boundary.denied.length, 0); assert.equal(traffic.csp.length, 0);
    report.status = 'PASS';
  } finally {
    report.finishedAt = new Date().toISOString(); if (report.status !== 'PASS') { report.status = 'FAIL'; await screenshot('failure').catch(() => {}); }
    report.network = { externalRequestsBlocked: traffic.blocked.length, boundaryDenials: boundary.denied.length, cspViolations: traffic.csp.length,
      origins: [...new Set(traffic.observed.map(row => row.origin))], requests: boundary.requests, workerCount: traffic.workers.length };
    await context.close(); await boundary.close(); await fs.writeFile(path.join(state.evidenceDirectory, `stage7-browser-${attempt}-${mode}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  } return report;
}
export async function runBrowserAcceptance({ state, composeArgs, playwrightModule, browserExecutable }) {
  if (!playwrightModule || !browserExecutable) throw Error('Explicit local Playwright and browser paths are required; no downloads.');
  const { chromium } = await import(pathToFileURL(path.resolve(playwrightModule)).href);
  const browser = await chromium.launch({ executablePath: path.resolve(browserExecutable), headless: true,
    args: ['--disable-background-networking', '--disable-quic', '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const attempt = Date.now() + '-' + randomUUID().slice(0, 8);
  const report = { startedAt: new Date().toISOString(), status: 'RUNNING', browser: browser.version(), browserExecutableSha256: sha(await fs.readFile(browserExecutable)), modes: [] };
  try { for (const [mode, port] of [['docker', state.proxyPort], ['development', state.devPort]]) report.modes.push(await runMode({ browser, state, composeArgs, base: `http://127.0.0.1:${port}`, mode, attempt })); report.status = 'PASS'; }
  finally { report.finishedAt = new Date().toISOString(); if (report.status !== 'PASS') report.status = 'FAIL'; await browser.close(); await fs.writeFile(path.join(state.evidenceDirectory, `stage7-browser-${attempt}-summary.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
  console.log(JSON.stringify({ status: report.status, modes: report.modes.map(value => ({ mode: value.mode, cases: value.cases.length })) }));
}
