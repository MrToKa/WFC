const $ = id => document.getElementById(id);
const state = { session: null, credentials: null, autodesk: null, projects: [], sources: [], generations: [], roots: new Map(), busy: false, timer: null, leaseTimer: null, polling: false, epoch: 0, pageId: null, closing: false, requests: new Set() };
const STATUS = { running: 'In progress', 'needs-view': 'Choose a view', interrupted: 'Interrupted', failed: 'Action needed', complete: 'Saved in WFC' };
const STAGE = { queued: 'Waiting…', capture: 'Saving the source model…', capturing: 'Saving the source model…', 'approve-cost': 'Checking permission…', approve: 'Checking permission…', preparing: 'Uploading and preparing in Autodesk…', prepare: 'Uploading and preparing in Autodesk…', uploading: 'Uploading to Autodesk…', submitted: 'Autodesk is processing the model…', translating: 'Autodesk is processing the model…', conversion: 'Autodesk is processing the model…', wait: 'Autodesk is processing the model…', waiting: 'Autodesk is processing the model…', download: 'Downloading SVF files…', downloading: 'Downloading SVF files…', package: 'Creating and checking the ZIP package…', packaging: 'Creating and checking the ZIP package…', verify: 'Checking the prepared model…', importing: 'Saving the model and ZIP package in WFC…', import: 'Saving the model and ZIP package in WFC…', 'wfc-import': 'Saving the model and ZIP package in WFC…', complete: 'The model and ZIP package are saved in WFC.', 'needs-view': 'Choose the 3D view to prepare.', interrupted: 'Preparation was interrupted. Continue from the saved progress.', failed: 'Preparation has stopped.' };
const ERRORS = { AUTH_REQUIRED: 'Sign in again with your WFC administrator account.', AUTH_INVALID: 'The email or password is incorrect.', ENGINEER_REQUIRED: 'A WFC administrator account is required.', ADMIN_REQUIRED: 'Only WFC administrators can use Model Preparer.', WFC_UNAVAILABLE: 'WFC is unavailable. Try again when the connection is restored.', PROJECT_FORBIDDEN: 'You cannot save to this project. Choose another project.', SETTINGS_INVALID: 'Check the Autodesk application details.', CREDENTIALS_REQUIRED: 'Enter your Autodesk keys and check Autodesk for this page.', CREDENTIAL_SESSION_REQUIRED: 'Enter your Autodesk keys and check Autodesk for this page.', CREDENTIAL_SESSION_EXPIRED: 'The Autodesk connection for this page has expired. Check Autodesk again.', CREDENTIALS_EXPIRED: 'The Autodesk connection for this page has expired. Check Autodesk again.', CREDENTIALS_INVALID: 'Check the Autodesk keys entered on this page.', CREDENTIALS_MISMATCH: 'These Autodesk credentials do not match the saved job. Use the keys that started it.', SECURITY_STORE_INVALID: 'The sign-in store could not be read. Contact your administrator.', CSRF_DENIED: 'This page has expired. Reload it and try again.', INVALID_REQUEST: 'Check the details you entered.', OPERATION_BUSY: 'Another model is being prepared. Wait for it to finish.', CLOUD_CLOSED: 'Check Autodesk access and confirm the APS Free plan.', COST_BLOCKED: 'This preparation is not currently authorized. Check Autodesk.', COST_EXPIRED: 'Check Autodesk access again before continuing.', SUBMISSION_UNKNOWN: 'Autodesk may already be processing this model. Continue checking its status.', DERIVATIVE_FAILED: 'Autodesk could not convert this model.', DERIVATIVE_AMBIGUOUS: 'Choose a 3D view for this model.', PROVIDER_FAILURE: 'Autodesk did not return a successful result. Check the connection and try continuing.', UPLOAD_LIMIT: 'Choose an NWD file no larger than 2 GB.', UPLOAD_INVALID: 'Choose a valid NWD file.', NETWORK_UNCERTAIN: 'The connection was interrupted. Check the saved results before starting this model again.', NETWORK: 'The application is unavailable. Check the connection and try again.' };
Object.assign(ERRORS, { CREDENTIAL_SESSION_LIMIT: 'Too many credential pages are open. Close an unused page and try again.', AUTODESK_SETTINGS_REQUIRED: 'Enter your Autodesk keys and confirm APS Free on this page.', AUTODESK_ACCESS_FAILED: 'Autodesk denied access. Check your keys and application permissions.', AUTODESK_RATE_LIMIT: 'Autodesk limited the requests. Wait before checking again.', AUTODESK_CHECK_REQUIRED: 'Check Autodesk on this page before continuing.', CONFIGURATION_CHANGED: 'Use the same Autodesk application keys that started this model.', WFC_IMPORT_FAILED: 'WFC could not save the model. The ZIP is retained; continue to retry saving.', GENERATION_TIMEOUT: 'Processing has not finished. Continue the saved job to check its progress.' });
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function feedback(message, error = false) { $('feedback').textContent = message; $('feedback').className = `feedback${error ? ' error' : ''}`; $('feedback').hidden = !message; }
function errorText(error) { return ERRORS[error?.code] || 'The operation did not finish. Check its status before continuing.'; }
function date(value) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(parsed) : ''; }
function bytes(value) { return Number.isFinite(value) ? `${(value / 1024 ** 2).toLocaleString('en-GB', { maximumFractionDigits: 1 })} MB` : ''; }
function requestId() { if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID(); if (typeof globalThis.crypto?.getRandomValues !== 'function') return null; const data = globalThis.crypto.getRandomValues(new Uint8Array(16)); data[6] = data[6] & 15 | 64; data[8] = data[8] & 63 | 128; const hex = Array.from(data, value => value.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`; }
function current(epoch) { return epoch === state.epoch && !state.closing; }
function hasCredentials() { return Boolean(state.credentials?.leaseToken && Date.parse(state.credentials.expiresAt) > Date.now()); }
function checkedCredentials(value) {
  if (typeof value?.leaseToken !== 'string' || !value.leaseToken || value.pageId !== state.pageId || value.ownerId !== state.session?.user?.id || value.configured !== true || value.freePlanConfirmed !== true || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw { code: 'CREDENTIALS_REQUIRED' };
  return Object.freeze({ leaseToken: value.leaseToken, pageId: value.pageId, leaseId: value.leaseId, configurationId: value.configurationId, ownerId: value.ownerId, expiresAt: value.expiresAt, configured: true, freePlanConfirmed: true });
}
function ready() { return state.session?.authenticated === true && state.session?.user?.isAdmin === true && hasCredentials() && state.autodesk?.state === 'ready'; }
function releaseCredentials(credentials = state.credentials, pageId = state.pageId) {
  if (!credentials?.leaseToken || !pageId) return;
  // Page-close delivery is best effort; the server also expires unused leases.
  const headers = new Headers({ 'Content-Type': 'application/json', 'X-Preparer-Credentials': credentials.leaseToken, 'X-Preparer-Page': pageId, 'X-Preparer-CSRF': state.session?.csrfToken || '' });
  const id = requestId(); if (id) headers.set('X-Request-Id', id);
  void fetch('/api/credential-sessions/current', { method: 'DELETE', headers, body: '{}', credentials: 'same-origin', redirect: 'error', cache: 'no-store', keepalive: true }).catch(() => {});
}
function invalidateCredentials({ clear = false, close = false } = {}) {
  releaseCredentials(); state.epoch++; state.credentials = null; state.autodesk = null; state.closing = close;
  for (const controller of state.requests) controller.abort(); state.requests.clear();
  clearTimeout(state.leaseTimer); clearTimeout(state.timer); state.leaseTimer = null; state.timer = null; state.polling = false; state.busy = false; $('generate-button').textContent = 'Generate →';
  if (clear) { $('client-id').value = ''; $('client-secret').value = ''; $('free-confirmed').checked = false; $('region').value = 'EMEA'; $('bucket').value = ''; }
  renderAutodesk();
}
async function api(route, options = {}) {
  const epoch = state.epoch, pageId = state.pageId, method = options.method || 'GET', mutation = method !== 'GET', headers = new Headers(options.headers);
  if (!current(epoch)) throw { code: 'STALE_RESPONSE' };
  if (options.credentialBound && !hasCredentials()) throw { code: 'CREDENTIALS_REQUIRED' };
  if (state.credentials?.leaseToken) headers.set('X-Preparer-Credentials', state.credentials.leaseToken);
  if (pageId) headers.set('X-Preparer-Page', pageId);
  if (mutation) { headers.set('X-Preparer-CSRF', state.session?.csrfToken || ''); const id = requestId(); if (!id) throw { code: 'CSRF_DENIED' }; headers.set('X-Request-Id', id); }
  if (options.json !== undefined) headers.set('Content-Type', 'application/json');
  const controller = new AbortController(); state.requests.add(controller);
  try {
    let response;
    try { response = await fetch(route, { method, headers, signal: controller.signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store', ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : options.body !== undefined ? { body: options.body } : {}) }); }
    catch { throw { code: current(epoch) ? mutation ? 'NETWORK_UNCERTAIN' : 'NETWORK' : 'STALE_RESPONSE' }; }
    let result; try { result = await response.json(); } catch { throw { code: current(epoch) ? mutation ? 'NETWORK_UNCERTAIN' : 'NETWORK' : 'STALE_RESPONSE' }; }
    if (!current(epoch)) { if (options.credentialRegistration && result?.credentials) releaseCredentials(result.credentials, pageId); throw { code: 'STALE_RESPONSE' }; }
    if (!response.ok) {
      const error = result.error && typeof result.error === 'object' ? result.error : { code: typeof result.code === 'string' ? result.code : 'UNKNOWN' };
      if (route !== '/api/session/login' && (error.code === 'AUTH_REQUIRED' || error.code === 'ADMIN_REQUIRED')) { showLogin(); feedback(errorText(error), true); }
      else if (error.code === 'CREDENTIAL_SESSION_REQUIRED') { invalidateCredentials(); feedback(errorText(error), true); renderGenerations(); schedulePoll(); }
      throw error;
    }
    return result;
  } finally { state.requests.delete(controller); }
}
function showLogin() {
  invalidateCredentials({ clear: true }); state.pageId = requestId(); state.session = { ...state.session, authenticated: false }; state.projects = []; state.sources = []; state.generations = []; state.roots.clear();
  $('model-file').value = ''; $('known-source').value = ''; $('model-label').value = ''; $('file-label').textContent = 'Choose an NWD file'; $('account-name').textContent = ''; $('generations-list').replaceChildren();
  $('workspace-screen').hidden = true; $('account').hidden = true; $('login-screen').hidden = false; $('initial-loading').hidden = true;
}
function busy(value, label) { state.busy = value; $('generate-button').textContent = value ? label || 'Preparing…' : 'Generate →'; renderAvailability(); }
function renderAvailability() {
  const active = state.generations.some(row => row.status === 'running');
  $('generate-button').disabled = state.busy || active || !ready() || !state.projects.length; $('check-autodesk').disabled = state.busy;
  $('generate-help').textContent = state.busy ? 'Keep this page open while the request is sent.' : active ? 'Your model is being prepared. Follow its progress in My models.' : !state.projects.length ? 'You need permission to save to at least one WFC project.' : !ready() ? 'Enter your Autodesk keys and check Autodesk first.' : 'Ready to generate. The result will be saved in the selected project.';
}
function renderAutodesk() {
  const result = state.autodesk, connected = ready(); $('connection-indicator').className = `state-indicator${result ? connected ? ' ready' : ' blocked' : ''}`;
  $('connection-summary').textContent = connected ? `Connected for this page${result.checkedAt ? ` · ${date(result.checkedAt)}` : ''}. You can generate a model.` : result ? 'Preparation is not yet authorized. Check the Autodesk keys and APS Free confirmation.' : 'Enter your own Autodesk keys each time you open this page, then check the connection.';
  $('quota-note').hidden = !result; $('quota-note').textContent = 'This check cannot report your exact remaining request allowance. Autodesk applies your account limits.';
  $('check-autodesk').textContent = connected ? 'Check Autodesk again ↗' : 'Check Autodesk ↗'; renderAvailability();
}
function renderInputs() {
  const selected = $('project').value; $('project').replaceChildren(element('option', 'Choose a project')); $('project').firstChild.value = '';
  for (const project of state.projects) { const option = element('option', `${project.projectNumber ? project.projectNumber + ' · ' : ''}${project.name}`); option.value = project.id; $('project').append(option); }
  if (state.projects.some(project => project.id === selected)) $('project').value = selected; else if (state.projects.length === 1) $('project').value = state.projects[0].id;
  $('project-help').textContent = state.projects.length ? 'Projects you have permission to save to.' : 'No writable projects are available. Contact your WFC administrator.';
  const selectedSource = $('known-source').value; $('known-source').replaceChildren(element('option', 'Choose an available file')); $('known-source').firstChild.value = '';
  for (const input of state.sources) { const option = element('option', `${input.name} · ${bytes(input.bytes)}`); option.value = input.inputId; $('known-source').append(option); }
  if (state.sources.some(source => source.inputId === selectedSource)) $('known-source').value = selectedSource; $('source-field').hidden = !state.sources.length; renderAvailability();
}
function progress(generation) { if (generation.status === 'complete') return 100; const phase = generation.stage || generation.job?.status || ''; if (/import|wfc/.test(phase)) return 92; if (/package|verify|packag/.test(phase)) return 80; if (/download/.test(phase)) return 64; if (/wait|translat|submit|convert/.test(phase)) return 43; if (/prepar|upload/.test(phase)) return 25; return 9; }
function renderGenerations() {
  $('generation-count').textContent = state.generations.length; $('empty-results').hidden = state.generations.length > 0; $('generations-list').replaceChildren();
  for (const generation of [...state.generations].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))) {
    const card = element('article', undefined, 'generation'), top = element('div', undefined, 'generation-top'), identity = element('div'); identity.append(element('h3', generation.label || '3D model'));
    const project = state.projects.find(row => row.id === generation.projectId); identity.append(element('p', [project?.name, date(generation.updatedAt)].filter(Boolean).join(' · '), 'generation-date'));
    top.append(identity, element('span', STATUS[generation.status] || 'In progress', `status-pill ${generation.status || ''}`)); card.append(top);
    const track = element('div', undefined, 'progress-track'); track.append(element('span', undefined, `progress-${progress(generation)}`)); track.setAttribute('aria-hidden', 'true'); card.append(track);
    const dynamicStage = String(generation.stage || '').startsWith('approval-') ? STAGE.approve : String(generation.stage || '').startsWith('reconcile-') ? STAGE.wait : String(generation.stage || '').startsWith('download-') ? STAGE.download : generation.stage === 'saving-to-wfc' ? STAGE.import : null;
    const stageText = generation.status === 'complete' ? STAGE.complete : generation.status === 'needs-view' ? STAGE['needs-view'] : STAGE[generation.stage] || dynamicStage || STAGE[generation.job?.status] || STAGE[generation.status] || 'Preparing the model…'; card.append(element('p', stageText, 'generation-stage'));
    if (generation.error) card.append(element('p', errorText(typeof generation.error === 'string' ? { code: generation.error } : generation.error), 'generation-error'));
    const actions = element('div', undefined, 'generation-actions');
    if (generation.status === 'needs-view') {
      const roots = generation.job?.roots || [], select = element('select'); select.setAttribute('aria-label', '3D view for ' + (generation.label || 'this model'));
      for (const [index, root] of roots.entries()) { const option = element('option', root.label || `3D view ${index + 1}`); option.value = root.rootId; select.append(option); }
      if (roots.some(root => root.rootId === state.roots.get(generation.id))) select.value = state.roots.get(generation.id); select.addEventListener('change', () => state.roots.set(generation.id, select.value));
      const resume = element('button', 'Continue with this view', 'button primary'); resume.type = 'button'; resume.disabled = !roots.length || state.busy || !ready(); resume.addEventListener('click', () => resumeGeneration(generation.id, select.value)); actions.append(select, resume);
    } else if (['failed', 'interrupted'].includes(generation.status)) { const resume = element('button', 'Continue', 'button secondary'); resume.type = 'button'; resume.disabled = state.busy || !ready(); resume.addEventListener('click', () => resumeGeneration(generation.id)); actions.append(resume); }
    if (generation.job?.facts?.package || generation.status === 'complete') { const link = element('a', 'Download ZIP ↓', 'button secondary'); link.href = `/api/generations/${encodeURIComponent(generation.id)}/package`; link.download = ''; actions.append(link); if (generation.status !== 'complete') card.append(element('p', 'The ZIP package is ready. Saving to WFC can continue from this result.', 'generation-stage')); }
    if (actions.childNodes.length) card.append(actions); $('generations-list').append(card);
  }
  renderAvailability();
}
async function loadGenerations() { const data = await api('/api/generations'), generations = Array.isArray(data.generations) ? data.generations : []; if (JSON.stringify(generations) !== JSON.stringify(state.generations)) { state.generations = generations; renderGenerations(); } }
async function loadWorkspace() {
  if (state.session?.user?.isAdmin !== true) { showLogin(); feedback(ERRORS.ADMIN_REQUIRED, true); return; }
  $('login-screen').hidden = true; $('workspace-screen').hidden = false; $('account').hidden = false; $('initial-loading').hidden = true; $('settings-panel').hidden = false;
  const user = state.session.user; $('account-name').textContent = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  // Session responses never supply Autodesk credentials or connection readiness.
  renderAutodesk();
  const [projects, sources, generations] = await Promise.all([api('/api/projects'), hasCredentials() ? api('/api/sources', { credentialBound: true }) : Promise.resolve({ inputs: [] }), api('/api/generations')]);
  state.projects = Array.isArray(projects.projects) ? projects.projects : []; state.sources = Array.isArray(sources.inputs) ? sources.inputs : []; state.generations = Array.isArray(generations.generations) ? generations.generations : []; renderInputs(); renderGenerations(); schedulePoll();
}
function schedulePoll() { clearTimeout(state.timer); if (state.session?.authenticated && !state.closing) state.timer = setTimeout(poll, state.generations.some(row => row.status === 'running') ? 2000 : 8000); }
async function poll() {
  if (state.polling || !state.session?.authenticated || state.closing) return; const epoch = state.epoch; state.polling = true;
  try { if (!document.hidden) { await loadGenerations(); $('connection-status').textContent = ''; } }
  catch (error) { if (current(epoch)) $('connection-status').textContent = error.code === 'AUTH_REQUIRED' ? '' : 'Progress is temporarily unavailable.'; }
  finally { if (current(epoch)) { state.polling = false; schedulePoll(); } }
}
function scheduleRenewal() { clearTimeout(state.leaseTimer); if (hasCredentials() && !state.closing) state.leaseTimer = setTimeout(renewCredentials, Math.max(1, Math.min(30000, Date.parse(state.credentials.expiresAt) - Date.now()))); }
async function renewCredentials() {
  const epoch = state.epoch; if (state.closing) return; if (!hasCredentials()) { invalidateCredentials(); feedback(ERRORS.CREDENTIALS_EXPIRED, true); renderGenerations(); schedulePoll(); return; }
  try { const result = await api('/api/credential-sessions/renew', { method: 'POST', json: {}, credentialBound: true }); state.credentials = checkedCredentials(result.credentials); scheduleRenewal(); }
  catch (error) { if (current(epoch)) { invalidateCredentials(); feedback(errorText(error), true); renderGenerations(); schedulePoll(); } }
}
async function checkAutodesk(event) {
  event?.preventDefault(); if (state.busy || state.session?.user?.isAdmin !== true) return;
  if (!$('client-id').value.trim() || !$('client-secret').value || !$('free-confirmed').checked) { feedback('Enter both Autodesk keys and confirm APS Free before checking.', true); return; }
  invalidateCredentials(); const epoch = state.epoch; busy(true, 'Checking…'); $('check-autodesk').textContent = 'Checking…'; feedback('');
  try {
    const bucket = $('bucket').value.trim();
    const result = await api('/api/credential-sessions', { method: 'POST', credentialRegistration: true, json: { pageId: state.pageId, clientId: $('client-id').value.trim(), clientSecret: $('client-secret').value, region: $('region').value || 'EMEA', ...(bucket ? { bucket } : {}), freePlanConfirmed: $('free-confirmed').checked } });
    state.credentials = checkedCredentials(result.credentials); scheduleRenewal(); state.autodesk = await api('/api/autodesk/check', { method: 'POST', json: {}, credentialBound: true }); renderAutodesk();
    if (state.autodesk.state !== 'ready') feedback('Preparation is not yet authorized. Check your Autodesk keys and APS Free confirmation.', true);
    else { const [sources, projects] = await Promise.all([api('/api/sources', { credentialBound: true }), api('/api/projects')]); state.sources = Array.isArray(sources.inputs) ? sources.inputs : []; state.projects = Array.isArray(projects.projects) ? projects.projects : []; renderInputs(); }
  } catch (error) { if (current(epoch)) { invalidateCredentials(); feedback(errorText(error), true); renderGenerations(); schedulePoll(); } }
  finally { if (current(epoch)) { busy(false); renderAutodesk(); renderGenerations(); schedulePoll(); } }
}
async function resumeGeneration(id, rootId) {
  if (state.busy) return; if (!ready()) { feedback(ERRORS.CREDENTIALS_REQUIRED, true); return; } const epoch = state.epoch; busy(true, 'Continuing…'); feedback('');
  try { await api(`/api/generations/${encodeURIComponent(id)}/resume`, { method: 'POST', json: rootId ? { rootId } : {}, credentialBound: true }); await loadGenerations(); schedulePoll(); }
  catch (error) { if (current(epoch)) { feedback(errorText(error), true); if (error.code === 'NETWORK_UNCERTAIN') await loadGenerations().catch(() => {}); } }
  finally { if (current(epoch)) { busy(false); renderGenerations(); } }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); invalidateCredentials({ clear: true }); const epoch = state.epoch, button = $('login-button'); button.disabled = true; button.textContent = 'Signing in…'; feedback('');
  try { await api('/api/session/login', { method: 'POST', json: { email: $('email').value.trim(), password: $('password').value } }); $('password').value = ''; state.session = await api('/api/session'); await loadWorkspace(); }
  catch (error) { if (current(epoch)) feedback(errorText(error), true); }
  finally { $('password').value = ''; button.disabled = false; button.textContent = 'Sign in'; }
});
$('logout').addEventListener('click', async () => {
  invalidateCredentials({ clear: true }); const epoch = state.epoch;
  try { await api('/api/session/logout', { method: 'POST', json: {} }); showLogin(); state.session = await api('/api/session'); feedback(''); }
  catch (error) { if (current(epoch)) { showLogin(); feedback(errorText(error), true); } }
});
$('settings-form').addEventListener('submit', checkAutodesk);
$('check-autodesk').addEventListener('click', checkAutodesk);
for (const id of ['client-id', 'client-secret', 'region', 'bucket', 'free-confirmed']) $(id).addEventListener('input', () => { invalidateCredentials(); if (id !== 'free-confirmed') $('free-confirmed').checked = false; renderGenerations(); schedulePoll(); });
$('model-file').addEventListener('change', () => { const file = $('model-file').files[0]; $('file-label').textContent = file ? `${file.name} · ${bytes(file.size)}` : 'Choose an NWD file'; if (file) { $('known-source').value = ''; if (!$('model-label').value.trim()) $('model-label').value = file.name.replace(/\.nwd$/i, '').slice(0, 160); } });
$('known-source').addEventListener('change', () => { const source = state.sources.find(input => input.inputId === $('known-source').value); if (source) { $('model-file').value = ''; $('file-label').textContent = 'Choose an NWD file'; if (!$('model-label').value.trim()) $('model-label').value = source.name.replace(/\.nwd$/i, '').slice(0, 160); } });
$('generate-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy || !ready()) return; const file = $('model-file').files[0], inputId = $('known-source').value;
  if (!file && !inputId) { feedback('Choose an NWD file or an available server model.', true); return; } if (file && (!/\.nwd$/i.test(file.name) || file.size < 1 || file.size > 2147483648)) { feedback(ERRORS.UPLOAD_LIMIT, true); return; }
  const epoch = state.epoch; busy(true, file ? 'Uploading file…' : 'Starting…'); feedback('');
  try { const input = { projectId: $('project').value, label: $('model-label').value.trim() }; if (file) { const upload = await api('/api/uploads?kind=nwd', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file, credentialBound: true }); input.uploadId = upload.uploadId; } else input.inputId = inputId; await api('/api/generations', { method: 'POST', json: input, credentialBound: true }); $('model-file').value = ''; $('known-source').value = ''; $('file-label').textContent = 'Choose an NWD file'; $('model-label').value = ''; await loadGenerations(); schedulePoll(); feedback('Preparation has started. The model and ZIP package will be saved in WFC automatically.'); }
  catch (error) { if (current(epoch)) { feedback(errorText(error), true); if (error.code === 'NETWORK_UNCERTAIN') await loadGenerations().catch(() => {}); } }
  finally { if (current(epoch)) busy(false); }
});
$('refresh-generations').addEventListener('click', async () => { const epoch = state.epoch; try { await loadGenerations(); feedback(''); } catch (error) { if (current(epoch)) feedback(errorText(error), true); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.session?.authenticated) { if (state.credentials && !hasCredentials()) { invalidateCredentials(); renderGenerations(); } poll(); } });
window.addEventListener('pagehide', () => { invalidateCredentials({ clear: true, close: true }); state.pageId = null; });
window.addEventListener('pageshow', async event => {
  if (!event.persisted) return;
  invalidateCredentials({ clear: true }); state.pageId = requestId(); const epoch = state.epoch;
  try { state.session = await api('/api/session'); if (state.session.authenticated) await loadWorkspace(); else showLogin(); }
  catch (error) { if (current(epoch)) { showLogin(); feedback(errorText(error), true); } }
});
state.pageId = requestId(); $('client-id').value = ''; $('client-secret').value = ''; $('region').value = 'EMEA'; $('bucket').value = ''; $('free-confirmed').checked = false;
try { if (!state.pageId) throw { code: 'CSRF_DENIED' }; state.session = await api('/api/session'); if (state.session.authenticated) await loadWorkspace(); else showLogin(); }
catch (error) { if (error.code !== 'STALE_RESPONSE') { $('initial-loading').hidden = true; showLogin(); feedback(errorText(error), true); } }
