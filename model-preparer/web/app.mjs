const $ = id => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TERMINAL = new Set(['succeeded', 'failed', 'interrupted']);
const ACTIONS = {
  'approve-cost': 'Review cost', prepare: 'Prepare the model', reconcile: 'Check status',
  wait: 'Monitor processing', download: 'Download model resources', package: 'Build verified package',
  verify: 'Verify the package again', preview: 'Prepare 3D preview',
};
const TYPES = { ...ACTIONS, capture: 'Capturing the source', register: 'Verifying the ZIP package',
  'register-known': 'Registering the available package', 'capture-known': 'Capturing the available NWD', 'simulation-capture': 'Creating a synthetic source' };
const STATUS = {
  captured: 'Source captured', registered: 'Registered package', 'cost-blocked': 'Preparation blocked by cost review',
  uploading: 'Uploading', uploaded: 'Source uploaded', 'submission-unknown': 'Outcome unknown',
  submitted: 'Request submitted', translating: 'Processing', downloading: 'Downloading resources',
  downloaded: 'Resources downloaded', verifying: 'Package verification', packaged: 'Verified package',
  failed: 'Action failed', interrupted: 'Stopped locally', complete: 'Processing complete',
  queued: 'Queued', running: 'Running', succeeded: 'Completed', pending: 'Still processing',
  inprogress: 'Processing', 'not-found': 'No confirmed result',
};
const ERRORS = {
  LIVE_COST_UNVERIFIED: 'Live preparation requires a current review of the Autodesk Free plan and remaining allowance.',
  LIVE_PROOF_INVALID: 'The Autodesk plan review is missing, expired or does not match the configuration.',
  COST_BLOCKED: 'Current verifiable evidence of zero cost is required. Preparation is blocked.',
  COST_MISSING: 'Zero-cost evidence is missing.', COST_UNKNOWN: 'The cost or remaining allowance is not confirmed.',
  COST_EXPIRED: 'The cost review has expired. Request a new review.', COST_NONZERO: 'Zero cost has not been confirmed.',
  COST_QUOTA: 'The available approved allowance is insufficient.', COST_IDENTITY_MISMATCH: 'The cost review applies to a different operation.',
  COST_UNVERIFIABLE: 'The source of the cost review cannot be verified.',
  CLOUD_CLOSED: 'Live preparation is blocked. Local registration and preview of an existing package remain available.',
  LIVE_BLOCKED: 'The requirements for live preparation have not yet been met.',
  SOURCE_CHANGED: 'The source file changed while being captured. Choose a stable file.',
  SNAPSHOT_CHANGED: 'The saved source does not match the verified bytes. Preparation has stopped.',
  IDENTITY_MISMATCH: 'The source or operation identity does not match.',
  SUBMISSION_UNKNOWN: 'A submitted request has an unknown outcome. Check its status; do not submit another conversion.',
  DERIVATIVE_FAILED: 'Processing failed. Review the outcome; conversion will not be retried automatically.',
  DERIVATIVE_PENDING: 'The model is not ready to download yet.',
  DERIVATIVE_AMBIGUOUS: 'Select the 3D view you want to download.',
  READ_LIMIT: 'Processing is ongoing or the result is not confirmed. Check again.',
  LOCAL_ABORTED: 'Local work stopped. This does not confirm cancellation in Autodesk.',
  PACKAGE_ABORTED: 'Local verification stopped. The last good result is preserved.',
  DOWNLOAD_INCOMPLETE: 'The verified resource set is incomplete. Resume the download.',
  DOWNLOAD_PLAN_CHANGED: 'The download plan does not match the saved data. Review is required.',
  DOWNLOAD_INVALID: 'A resource or download plan failed validation.',
  PACKAGE_ADAPTER_FAILURE: 'The package failed validation. The previous good package is preserved.',
  PACKAGE_LIMIT_EXCEEDED: 'A size, resource count or time limit has been reached.',
  PACKAGE_INVALID: 'The package failed validation and cannot be previewed or exported.',
  PREVIEW_NOT_READY: 'Prepare the verified package for 3D preview first.',
  PREVIEW_UNAVAILABLE: 'Local preview is currently unavailable.',
  SDK_UNAVAILABLE: 'The verified local Viewer is missing. It will not be downloaded from the internet.',
  STORE_CORRUPT: 'The saved state is corrupt. Actions that change data are blocked.',
  STORE_WRITE_FAILED: 'The data could not be saved reliably. Check available disk space and access.',
  LOCK_BUSY: 'Another active or unidentified process owns the job. Wait or check recovery.',
  LOCK_OWNER_MISMATCH: 'The operation owner cannot be verified.',
  UNSAFE_PATH: 'The file is outside the permitted scope or uses an unsupported link.',
  INVALID_JOB: 'The source or version label is invalid.',
  JOB_MISSING: 'The job is no longer available.', JOB_EXISTS: 'This job already exists.',
  JOB_NOT_CAPTURED: 'The registered package has no history of a new remote conversion.',
  UNSUPPORTED_PROFILE: 'The model format or Viewer profile is not supported.',
  PROVIDER_FAILURE: 'The operation did not return a usable result. Check the saved state.',
  PROVIDER_RESPONSE_INVALID: 'The returned result does not match the expected format.',
  CONFIGURATION_INVALID: 'The local configuration is not ready.',
  REQUEST_CONFLICT: 'This action is already linked to a different request. Refresh the status.',
  OPERATION_BUSY: 'An operation is already running for this job.',
  ACTION_NOT_ALLOWED: 'This action is not allowed in the current state.',
  UPLOAD_TOO_LARGE: 'The file exceeds the permitted size.', UPLOAD_INCOMPLETE: 'The upload is incomplete. No ready job was created.',
  UPLOAD_MISSING: 'The uploaded source is no longer available. Select the file again.',
  NO_SPACE: 'There is not enough disk space to save the source.',
  REQUEST_UNCERTAIN: 'The connection was interrupted. The application will check the action identity without submitting it again.',
};

function readStored(key, fallback) { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function writeStored(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* The server remains authoritative. */ } }
function removeStored(key) { try { sessionStorage.removeItem(key); } catch {} }
const state = {
  config: null, jobs: [], inputs: [], sources: [], selected: readStored('preparer.selected.v1', null), operations: new Map(),
  requests: readStored('preparer.requests.v1', []), watching: readStored('preparer.operations.v1', []),
  resume: readStored('preparer.upload.v1', null), previews: new Map(Object.entries(readStored('preparer.previews.v1', {}))),
  busy: false, refreshing: false, pollBusy: false, transfer: null, globalOperation: null, roots: new Map(),
  inFlightRequests: new Set(),
};
if (!Array.isArray(state.requests)) state.requests = [];
if (!Array.isArray(state.watching)) state.watching = [];
if (!UUID.test(state.selected ?? '')) state.selected = null;

function node(tag, text, className) { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result; }
function bytes(value) { if (!Number.isFinite(value) || value < 0) return '—'; const units = ['B', 'KiB', 'MiB', 'GiB']; let i = 0; while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; } return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: i ? 1 : 0 }).format(value)} ${units[i]}`; }
function count(value) { return Number.isSafeInteger(value) && value >= 0 ? new Intl.NumberFormat('en-GB').format(value) : '—'; }
function date(value) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(parsed) : '—'; }
function statusLabel(value) { return STATUS[value] ?? 'Checking status'; }
function statusClass(value) { return ['packaged', 'registered', 'downloaded', 'succeeded', 'complete'].includes(value) ? 'success' : ['failed'].includes(value) ? 'error' : ['cost-blocked', 'submission-unknown', 'interrupted'].includes(value) ? 'warning' : ''; }
function errorText(error) { const code = typeof error?.code === 'string' && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : 'PROVIDER_FAILURE'; return `${ERRORS[code] ?? 'The action did not complete. Check its status and available actions.'} (${code})`; }
function showFeedback(message, warning = false) { $('feedback').textContent = message; $('feedback').className = warning ? 'notice' : 'feedback'; $('feedback').hidden = false; }
function clearFeedback() { $('feedback').hidden = true; }
function makeError(code) { const error = new Error(code); error.code = code; return error; }

function createRequestId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  // LAN HTTP may omit randomUUID while still providing secure random bytes.
  if (typeof cryptoApi?.getRandomValues !== 'function') throw makeError('CONFIGURATION_INVALID');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readJson(url, options = {}) {
  let response;
  try { response = await fetch(url, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', ...options }); }
  catch (error) { if (options.signal?.aborted) throw makeError('LOCAL_ABORTED'); throw makeError('REQUEST_UNCERTAIN'); }
  let data;
  try { data = await response.json(); } catch { throw makeError('PROVIDER_RESPONSE_INVALID'); }
  if (!response.ok) { const error = makeError(data?.error?.code ?? 'PROVIDER_FAILURE'); throw error; }
  return data;
}
function persistRequests() { state.requests = state.requests.slice(-30); writeStored('preparer.requests.v1', state.requests); }
function finishRequest(id) { state.requests = state.requests.filter(item => item.requestId !== id); persistRequests(); }
function saveResume(value) { state.resume = value; if (value) writeStored('preparer.upload.v1', value); else removeStored('preparer.upload.v1'); renderResume(); }
async function post(url, body, type, metadata = {}, { file, signal } = {}) {
  if (!state.config || typeof state.config.csrfToken !== 'string') throw makeError('CONFIGURATION_INVALID');
  const requestId = createRequestId();
  state.inFlightRequests.add(requestId);
  state.requests.push({ requestId, type, createdAt: new Date().toISOString(), ...metadata }); persistRequests();
  const headers = { 'X-Preparer-Token': state.config.csrfToken, 'X-Request-Id': requestId, 'Content-Type': file ? 'application/octet-stream' : 'application/json' };
  if (file) headers['X-File-Name'] = encodeURIComponent(file.name);
  try {
    const result = await readJson(url, { method: 'POST', headers, body: file ?? JSON.stringify(body), signal });
    // Persist the received identity before clearing the request journal.
    if (result.operation) { consumeOperation(result.operation); if (['capture', 'register'].includes(type)) saveResume(null); }
    else if (result.uploadId) saveResume({ ...result, kind: metadata.kind, label: metadata.label });
    finishRequest(requestId);
    return result;
  } catch (error) {
    if (error.code !== 'REQUEST_UNCERTAIN') finishRequest(requestId);
    throw error;
  } finally { state.inFlightRequests.delete(requestId); }
}
function saveWatching() {
  const retained = state.watching.filter(item => !state.operations.has(item.operationId));
  const active = [...state.operations.values()].filter(item => !TERMINAL.has(item.status)).map(item => ({ operationId: item.operationId, type: item.type, jobId: item.jobId }));
  state.watching = [...new Map([...retained, ...active].map(item => [item.operationId, item])).values()];
  writeStored('preparer.operations.v1', state.watching);
}
function safePreview(url, jobId) { return typeof url === 'string' && UUID.test(jobId ?? '') && url === `/preview/${jobId}`; }
function consumeOperation(operation, announce = false) {
  if (!operation || !UUID.test(operation.operationId ?? '')) throw makeError('PROVIDER_RESPONSE_INVALID');
  const before = state.operations.get(operation.operationId);
  state.operations.set(operation.operationId, operation);
  if (!TERMINAL.has(operation.status) && (!operation.jobId || !state.jobs.some(job => job.jobId === operation.jobId))) state.globalOperation = operation.operationId;
  if (TERMINAL.has(operation.status)) {
    if (state.globalOperation === operation.operationId) state.globalOperation = null;
    const jobId = operation.result?.jobId ?? operation.jobId;
    if (UUID.test(jobId ?? '') && ['capture', 'capture-known', 'register', 'register-known', 'simulation-capture'].includes(operation.type)) {
      state.selected = jobId; writeStored('preparer.selected.v1', jobId);
    }
    if (safePreview(operation.result?.previewUrl, jobId)) {
      state.previews.set(jobId, operation.result.previewUrl); writeStored('preparer.previews.v1', Object.fromEntries(state.previews));
    }
    if ((announce || before && !TERMINAL.has(before.status)) && operation.error) showFeedback(errorText(operation.error), ['READ_LIMIT', 'LOCAL_ABORTED'].includes(operation.error.code));
  }
  saveWatching(); renderGlobalOperation(); renderSelectedJob();
}
function activeOperation(job) {
  const own = [...state.operations.values()].find(item => item.jobId === job.jobId && !TERMINAL.has(item.status));
  return own ?? (job.operationId ? state.operations.get(job.operationId) : null);
}
function setBusy(value) { state.busy = value; renderControls(); renderSelectedJob(); }
function renderControls() {
  const simulation = state.config?.mode === 'simulation';
  $('capture-form').hidden = false; $('nwd-file').closest('.file-field').hidden = simulation;
  $('capture-button').hidden = simulation; $('simulation-input').hidden = !simulation;
  $('source-choice').hidden = simulation || !state.sources.length;
  $('known-source').disabled = state.busy || !state.config;
  for (const id of ['capture-button', 'register-button', 'simulation-capture', 'resume-upload-button']) $(id).disabled = state.busy || !state.config;
  $('known-register-button').disabled = state.busy || !$('known-input').value || !state.config;
  $('refresh').disabled = state.refreshing;
}
function renderResume() {
  const usable = state.resume && typeof state.resume.uploadId === 'string' && ['nwd', 'package'].includes(state.resume.kind);
  $('resume-upload').hidden = !usable;
  if (usable) {
    $('resume-upload-label').textContent = `Saved local source: ${state.resume.name} · ${bytes(state.resume.bytes)}. Job creation is not yet confirmed.`;
    $('resume-upload-button').textContent = state.resume.kind === 'nwd' ? 'Continue creating the job' : 'Continue registration';
    if (state.resume.kind === 'nwd' && !$('version-label').value) $('version-label').value = state.resume.label ?? '';
  }
}
function renderConfig() {
  const config = state.config, mode = config?.mode;
  const labels = { closed: 'Local mode', simulation: 'Simulation', live: 'Autodesk APS' };
  $('mode-badge').textContent = labels[mode] ?? 'Unknown mode';
  $('mode-badge').className = `badge ${mode === 'simulation' ? 'warning' : mode === 'live' ? 'success' : ''}`;
  const notice = $('mode-notice'); notice.replaceChildren(); notice.hidden = false;
  notice.className = `notice ${mode === 'simulation' ? 'simulation' : mode === 'live' ? 'live' : ''}`;
  notice.append(node('strong', labels[mode] ?? 'Configuration is not verified'));
  notice.append(node('span', mode === 'simulation' ? 'Synthetic inputs and a simulated cost review. These results do not demonstrate a real NWD conversion.' : mode === 'live' ? config.livePolicy?.reuseOnly !== false ? 'This instance only reuses existing Autodesk results. A cost review and explicit action are still required.' : 'New uploads and conversions were enabled at startup. Each preparation requires a current cost review and explicit action.' : 'You can capture a source or register and preview an existing package. Live conversion remains blocked until its requirements are met.'));
  const cost = config.cost ?? {};
  $('cost-summary').textContent = mode === 'simulation' ? 'The cost review in this mode is simulated and applies only to synthetic jobs.' : ['verified', 'allowed', 'ready'].includes(cost.state) ? `The current review permits the verified operations${cost.expiresAt ? ` until ${date(cost.expiresAt)}` : ''}.` : cost.code ? errorText(cost) : 'There is no current verified approval for live preparation.';
  $('configuration-list').replaceChildren();
  for (const key of ['APS_CLIENT_ID', 'APS_CLIENT_SECRET', 'APS_REGION', 'APS_BUCKET']) {
    const item = config.configuration?.[key] ?? {}, row = node('div', undefined, `config-row ${item.valid === true ? '' : 'invalid'}`);
    row.append(node('strong', key), node('span', item.present !== true ? 'Missing' : item.valid !== true ? 'Invalid' : 'Present and valid')); $('configuration-list').append(row);
  }
  $('runtime-summary').textContent = config.previewRuntime?.available === true ? `Local Viewer ${config.previewRuntime.sdkVersion ?? '7.130.0'} is available.` : 'The local Viewer is not yet available. It will not be downloaded automatically.';
  const max = config.limits?.maxUploadBytes ?? config.limits?.maxFileBytes;
  $('limits-summary').textContent = `${max ? `Source size limit: ${bytes(max)}. ` : ''}Opening or refreshing this page does not start preparation.`;
  renderControls(); renderResume();
}
function renderInputs() {
  const select = $('known-input'), previous = select.value; select.replaceChildren();
  select.append(node('option', state.inputs.length ? 'Select an available package to verify' : 'No packages are available in the permitted directory'));
  select.firstChild.value = '';
  for (const item of state.inputs) { const option = node('option', `${item.name} · ${bytes(item.bytes)}`); option.value = item.inputId; select.append(option); }
  if (state.inputs.some(item => item.inputId === previous)) select.value = previous;
  renderControls();
}
function renderSources() {
  const select = $('known-source'), previous = select.value; select.replaceChildren();
  const empty = node('option', 'Select an available NWD'); empty.value = ''; select.append(empty);
  for (const item of state.sources) { const option = node('option', `${item.name} · ${bytes(item.bytes)}`); option.value = item.inputId; select.append(option); }
  if (state.sources.some(item => item.inputId === previous)) select.value = previous;
  renderControls();
}
function renderJobs() {
  const focusedJob = $('jobs-list').contains(document.activeElement) ? document.activeElement?.dataset?.jobId : null;
  $('jobs-count').textContent = count(state.jobs.length); $('jobs-empty').hidden = state.jobs.length > 0;
  $('jobs-list').replaceChildren();
  for (const job of state.jobs) {
    const wrapper = node('div'); wrapper.setAttribute('role', 'listitem');
    const button = node('button', undefined, 'job-item'); button.type = 'button'; button.dataset.jobId = job.jobId; button.setAttribute('aria-current', String(job.jobId === state.selected));
    button.append(node('span', job.label ?? 'Unlabelled', 'job-label'));
    const meta = node('span', undefined, 'job-item-meta'); meta.append(node('span', statusLabel(job.status), `badge ${statusClass(job.status)}`), node('span', job.mode === 'simulation' ? 'Simulation' : date(job.createdAt)));
    button.append(meta); button.addEventListener('click', () => { state.selected = job.jobId; writeStored('preparer.selected.v1', job.jobId); renderJobs(); renderSelectedJob(); $('job-title').focus(); }); wrapper.append(button); $('jobs-list').append(wrapper);
  }
  if (focusedJob && UUID.test(focusedJob)) $('jobs-list').querySelector(`[data-job-id="${focusedJob}"]`)?.focus({ preventScroll: true });
}
function addFact(label, value) { const item = node('div', undefined, 'fact'); item.append(node('span', label, 'fact-label'), node('span', value, 'fact-value')); $('facts').append(item); }
function operationCounts(operation) {
  const values = operation?.counts ?? {}, output = [];
  const names = { completedResources: 'Verified resources', resources: 'Resources', resourceCount: 'Resources', bytes: 'Bytes saved', uploadedBytes: 'Bytes uploaded', downloadedBytes: 'Bytes downloaded', attempts: 'Attempts', reads: 'Checks' };
  for (const [key, value] of Object.entries(values)) if (Number.isSafeInteger(value) && value >= 0 && names[key]) output.push(`${names[key]}: ${/bytes/i.test(key) ? bytes(value) : count(value)}`);
  return output.join(' · ') || 'The current phase is shown; no measured completion percentage is available.';
}
function renderSelectedJob() {
  const focusedAction = $('actions').contains(document.activeElement) ? document.activeElement?.dataset?.action : null;
  const focusedStop = document.activeElement === $('stop-button');
  const job = state.jobs.find(item => item.jobId === state.selected);
  $('job-detail').hidden = !job; $('welcome').hidden = Boolean(job);
  if (!job) return;
  const facts = job.facts ?? {}, operation = activeOperation(job), active = operation && !TERMINAL.has(operation.status);
  $('job-kind').textContent = job.kind === 'registered' ? 'Registered existing package' : job.mode === 'simulation' ? 'Synthetic test job' : 'Preparation job';
  $('job-title').textContent = job.label ?? 'Unlabelled'; $('job-status').textContent = statusLabel(job.status); $('job-status').className = `badge ${statusClass(job.status)}`;
  $('job-source').textContent = `${facts.source?.name ?? 'Capturing the source'}${facts.source?.bytes ? ` · ${bytes(facts.source.bytes)}` : ''} · ${date(job.updatedAt)}`;
  const phases = job.kind === 'registered' ? [['Package verification', Boolean(facts.package), false], ['3D preview', state.previews.has(job.jobId), active && operation.type === 'preview'], ['Download', Boolean(facts.package), false]] : [['Source', Boolean(facts.source), false], ['Cost', facts.cost?.allowed === true || Boolean(facts.upload), job.status === 'cost-blocked'], ['Conversion', facts.submission?.phase === 'complete', ['uploading', 'uploaded', 'submission-unknown', 'submitted', 'translating'].includes(job.status)], ['Resources', facts.download?.status === 'downloaded', job.status === 'downloading'], ['Package', Boolean(facts.package), ['verifying', 'packaged', 'registered'].includes(job.status)]];
  $('phase-list').replaceChildren();
  phases.forEach(([label, done, current], index) => { const item = node('li', label, done ? 'done' : current ? 'active' : ''); item.dataset.number = String(index + 1); if (current) item.setAttribute('aria-current', 'step'); $('phase-list').append(item); });
  $('job-error').hidden = !job.error; if (job.error) $('job-error').textContent = errorText(job.error);
  const context = [];
  if (job.mode === 'simulation') context.push('This job uses synthetic inputs. Its simulated approval and result do not carry over to live mode.');
  if (facts.submission?.phase === 'submission-unknown' || job.status === 'submission-unknown') context.push('The request may already have been accepted. Check its status next; a new conversion will not be submitted.');
  if (job.status === 'interrupted') context.push('Local work stopped. Saved upload and submission records and checkpoints remain; remote cancellation is not confirmed.');
  if (facts.submission?.phase === 'complete' && !facts.download) context.push('Remote processing is complete. The model resources still need to be downloaded and verified locally.');
  if (job.kind === 'registered') context.push('The existing package was verified locally. No history of a new upload or conversion was created.');
  $('job-context').hidden = context.length === 0; $('job-context').textContent = context.join(' ');
  $('operation-panel').hidden = !active;
  if (active) { $('operation-title').textContent = `${TYPES[operation.type] ?? 'Local operation'} — ${STATUS[operation.phase] ?? statusLabel(operation.status)}`; $('operation-counts').textContent = operationCounts(operation); $('operation-id').textContent = `Operation ${operation.operationId}`; $('stop-button').disabled = state.busy; }
  $('facts').replaceChildren();
  if (facts.source) addFact('Verified source', bytes(facts.source.bytes));
  if (facts.upload) addFact('Uploading', statusLabel(facts.upload.status));
  if (facts.submission) { addFact('Submitted requests', count(facts.submission.attempts)); addFact('Result checks', count(facts.submission.reads)); }
  if (facts.download) addFact('Verified resources', count(facts.download.completedResources));
  if (facts.package) addFact('Package resources', count(facts.package.resourceCount));
  const roots = Array.isArray(job.roots) ? job.roots : [], select = $('root-select');
  $('root-field').hidden = roots.length === 0;
  const rootsSignature = JSON.stringify([job.jobId, roots]);
  if (select.dataset.roots !== rootsSignature) {
    select.replaceChildren();
    const empty = node('option', roots.length > 1 ? 'Select a 3D view…' : 'Select a view'); empty.value = ''; select.append(empty);
    for (const root of roots) { const option = node('option', root.label ?? root.rootId); option.value = root.rootId; select.append(option); }
    select.dataset.roots = rootsSignature;
  }
  const selectedRoot = state.roots.get(job.jobId) ?? (roots.length === 1 ? roots[0].rootId : '');
  select.value = roots.some(root => root.rootId === selectedRoot) ? selectedRoot : '';
  select.disabled = Boolean(active) || state.busy;
  $('actions').replaceChildren();
  for (const action of job.allowedActions ?? []) {
    if (!Object.hasOwn(ACTIONS, action)) continue;
    const button = node('button', ACTIONS[action], `button ${['prepare', 'download', 'package', 'preview'].includes(action) ? 'primary' : ''}`); button.type = 'button'; button.dataset.action = action;
    button.disabled = state.busy || Boolean(active) || action === 'download' && roots.length > 1 && !select.value;
    if (action === 'download' && roots.length > 1 && !select.value) button.title = 'Select a 3D view first';
    button.addEventListener('click', () => runAction(action)); $('actions').append(button);
  }
  $('recover-dead').disabled = Boolean(active) || state.busy;
  $('result-panel').hidden = !facts.package;
  if (facts.package) {
    $('result-summary').textContent = `${count(facts.package.resourceCount)} resources · ZIP ${bytes(facts.package.bytes)}. The package identity and provenance are preserved.`;
    $('package-link').href = `/api/artifacts/${job.jobId}/package`; $('report-link').href = `/api/artifacts/${job.jobId}/report`;
    const preview = state.previews.get(job.jobId); $('preview-link').hidden = !safePreview(preview, job.jobId); if (safePreview(preview, job.jobId)) $('preview-link').href = preview;
  }
  $('identity-list').replaceChildren();
  for (const [key, value] of [['Job', job.jobId], ['Mode', job.mode], ['Source SHA-256', facts.source?.sha256], ['Package', facts.package?.packageId], ['ZIP SHA-256', facts.package?.sha256], ['Fingerprint', facts.package?.contentFingerprint], ['Created', date(job.createdAt)], ['Updated', date(job.updatedAt)]]) if (value) $('identity-list').append(node('dt', key), node('dd', String(value)));
  if (focusedAction && Object.hasOwn(ACTIONS, focusedAction)) {
    const replacement = $('actions').querySelector(`[data-action="${focusedAction}"]`);
    if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
    else $('job-title').focus({ preventScroll: true });
  }
  if (focusedStop && !active) $('job-title').focus({ preventScroll: true });
}
function renderGlobalOperation() {
  const operation = state.operations.get(state.globalOperation);
  $('global-operation').hidden = !state.transfer && (!operation || TERMINAL.has(operation.status));
  if (state.transfer) $('global-operation-label').textContent = `Uploading ${state.transfer.name} · ${bytes(state.transfer.bytes)}. The source is not ready yet.`;
  else if (operation && !TERMINAL.has(operation.status)) $('global-operation-label').textContent = `${TYPES[operation.type] ?? 'Local operation'} — ${statusLabel(operation.status)}`;
  $('global-stop').disabled = state.busy && !state.transfer && !operation;
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true; renderControls();
  try {
    const freshConfig = await readJson('/api/config');
    const changedConfig = JSON.stringify({mode:state.config?.mode,requestedMode:state.config?.requestedMode,livePolicy:state.config?.livePolicy,configuration:state.config?.configuration,cost:state.config?.cost}) !== JSON.stringify({mode:freshConfig.mode,requestedMode:freshConfig.requestedMode,livePolicy:freshConfig.livePolicy,configuration:freshConfig.configuration,cost:freshConfig.cost});
    state.config = freshConfig; if (changedConfig) renderConfig();
    const result = await readJson('/api/jobs'); state.jobs = Array.isArray(result.jobs) ? result.jobs.filter(job => UUID.test(job.jobId ?? '')) : [];
    if (!state.selected && state.jobs.length) { state.selected = state.jobs[0].jobId; writeStored('preparer.selected.v1', state.selected); }
    for (const job of state.jobs) if (UUID.test(job.operationId ?? '') && !state.operations.has(job.operationId)) state.watching.push({ operationId: job.operationId });
    renderJobs(); renderSelectedJob();
    const connected = 'Connected to the local application.';
    if ($('connection-status').textContent !== connected) $('connection-status').textContent = connected;
    $('connection-status').title = `Last checked: ${new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium' }).format(new Date())}`;
  } catch (error) { $('connection-status').textContent = errorText(error); }
  finally { state.refreshing = false; renderControls(); }
}
async function recoverRequests() {
  for (const pending of [...state.requests]) {
    if (state.inFlightRequests.has(pending.requestId)) continue;
    if (!UUID.test(pending.requestId ?? '')) { finishRequest(pending.requestId); continue; }
    try {
      const result = await readJson(`/api/requests/${pending.requestId}`);
      if (result.operation) { consumeOperation(result.operation); finishRequest(pending.requestId); if (['capture', 'register'].includes(pending.type)) saveResume(null); }
      else if (result.upload) { saveResume({ ...result.upload, kind: pending.kind, label: pending.label }); finishRequest(pending.requestId); }
      else if (result.request?.status === 'interrupted') { finishRequest(pending.requestId); showFeedback('The previous upload was interrupted. Select the source again; no ready job was created.', true); }
    } catch (error) {
      if (['REQUEST_MISSING', 'JOB_MISSING', 'NOT_FOUND'].includes(error.code)) {
        const createdAt = Date.parse(pending.createdAt);
        if (Number.isFinite(createdAt) && Date.now() - createdAt < 30000) continue;
        finishRequest(pending.requestId); showFeedback('No operation is confirmed for the previous action. Check the list before starting another action.', true);
      }
    }
  }
}
async function poll() {
  if (state.pollBusy) return;
  state.pollBusy = true;
  try {
    await recoverRequests();
    const ids = new Set([...state.watching.map(item => item.operationId), ...state.jobs.map(job => job.operationId)].filter(id => UUID.test(id ?? '')));
    for (const id of ids) {
      try { const result = await readJson(`/api/operations/${id}`); consumeOperation(result.operation); }
      catch (error) { $('connection-status').textContent = errorText(error); }
    }
    await refresh();
  } finally { state.pollBusy = false; }
}
async function beginOperation(route, body, type, metadata = {}) {
  const result = await post(route, body, type, metadata);
  consumeOperation(result.operation, true); await refresh();
  return result.operation;
}
async function finishUpload() {
  const upload = state.resume;
  if (!upload) return;
  const type = upload.kind === 'nwd' ? 'capture' : 'register';
  await beginOperation(`/api/jobs/${type}`, upload.kind === 'nwd' ? { uploadId: upload.uploadId, label: upload.label } : { uploadId: upload.uploadId }, type);
  saveResume(null);
}
async function uploadFile(file, kind, label) {
  if (!file || kind === 'nwd' && !/\.nwd$/i.test(file.name) || kind === 'package' && !/\.zip$/i.test(file.name)) throw makeError('INVALID_JOB');
  const max = state.config?.limits?.maxUploadBytes ?? state.config?.limits?.maxFileBytes;
  if (!file.size || max && file.size > max) throw makeError('UPLOAD_TOO_LARGE');
  const controller = new AbortController(); state.transfer = { name: file.name, bytes: file.size, controller }; renderGlobalOperation();
  try {
    const upload = await post(`/api/uploads?kind=${kind}`, null, 'upload', { kind, label }, { file, signal: controller.signal });
    saveResume({ ...upload, kind, label });
  } finally { state.transfer = null; renderGlobalOperation(); }
  await finishUpload();
}
async function perform(task) {
  if (state.busy) return;
  clearFeedback(); setBusy(true);
  try { await task(); }
  catch (error) { showFeedback(errorText(error), ['LOCAL_ABORTED', 'READ_LIMIT', 'REQUEST_UNCERTAIN'].includes(error.code)); }
  finally { setBusy(false); renderGlobalOperation(); }
}
async function runAction(action) {
  const job = state.jobs.find(item => item.jobId === state.selected);
  if (!job || !job.allowedActions?.includes(action)) return;
  const rootId = $('root-select').value;
  if (action === 'download' && job.roots?.length > 1 && !rootId) { $('root-select').focus(); return; }
  await perform(async () => {
    const body = { action }; if (action === 'download' && rootId) body.rootId = rootId; if ($('recover-dead').checked) body.recoverDead = true;
    await beginOperation(`/api/jobs/${job.jobId}/actions`, body, action, { jobId: job.jobId });
  });
}
async function cancelOperation(operation) {
  if (!operation || TERMINAL.has(operation.status)) return;
  clearFeedback();
  try {
    const result = await post(`/api/operations/${operation.operationId}/cancel`, {}, 'cancel', { jobId: operation.jobId });
    consumeOperation(result.operation); showFeedback('Stopping local work was requested. This does not confirm cancellation of processing in Autodesk.', true);
  } catch (error) { showFeedback(errorText(error)); }
}

$('capture-form').addEventListener('submit', event => { event.preventDefault(); const file = $('nwd-file').files[0], inputId = $('known-source').value, label = $('version-label').value.trim(); if (state.config?.mode === 'simulation') { if (!label) { $('version-label').focus(); return; } perform(() => beginOperation('/api/simulation/capture', { label }, 'simulation-capture')); return; } if ((!file && !inputId) || !label) { showFeedback('Select an NWD file and enter a version label.'); ((!file && !inputId) ? $('nwd-file') : $('version-label')).focus(); return; } if (inputId) perform(() => beginOperation('/api/jobs/capture-known', { inputId, label }, 'capture-known')); else perform(() => uploadFile(file, 'nwd', label)); });
$('register-form').addEventListener('submit', event => { event.preventDefault(); perform(() => uploadFile($('package-file').files[0], 'package')); });
$('known-form').addEventListener('submit', event => { event.preventDefault(); const inputId = $('known-input').value; if (inputId) perform(() => beginOperation('/api/jobs/register-known', { inputId }, 'register-known')); });
$('known-input').addEventListener('change', renderControls);
$('simulation-capture').addEventListener('click', () => { const label = $('version-label').value.trim(); if (!label) { showFeedback('Enter a label for the synthetic version.'); $('version-label').focus(); return; } perform(() => beginOperation('/api/simulation/capture', { label }, 'simulation-capture')); });
$('root-select').addEventListener('change', () => { state.roots.set(state.selected, $('root-select').value); const button = $('actions').querySelector('[data-action="download"]'); if (button) button.disabled = state.busy || !$('root-select').value; });
$('refresh').addEventListener('click', () => { clearFeedback(); poll(); });
$('stop-button').addEventListener('click', () => cancelOperation(activeOperation(state.jobs.find(job => job.jobId === state.selected) ?? {})));
$('global-stop').addEventListener('click', () => { if (state.transfer) { state.transfer.controller.abort(); showFeedback('The upload stopped locally. No ready job is confirmed.', true); } else cancelOperation(state.operations.get(state.globalOperation)); });
$('resume-upload-button').addEventListener('click', () => perform(finishUpload));
$('discard-upload-button').addEventListener('click', () => saveResume(null));
$('nwd-file').addEventListener('change', () => { const file = $('nwd-file').files[0]; if (file) $('known-source').value = ''; $('nwd-description').textContent = file ? `${file.name} · ${bytes(file.size)}` : 'The file is streamed to the local application.'; });
$('known-source').addEventListener('change', () => { if ($('known-source').value) { $('nwd-file').value = ''; $('nwd-description').textContent = 'The file is streamed to the local application.'; } });

async function start() {
  try {
    state.config = await readJson('/api/config'); renderConfig();
    const imports = await readJson('/api/imports'); state.inputs = Array.isArray(imports.inputs) ? imports.inputs : []; renderInputs();
    const sources = await readJson('/api/source-inputs'); state.sources = Array.isArray(sources.inputs) ? sources.inputs : []; renderSources();
    await poll();
  } catch (error) { showFeedback(errorText(error)); $('connection-status').textContent = 'The application is not ready. Check the local service, then refresh the page.'; }
}
let timer;
function schedulePoll() { clearTimeout(timer); timer = setTimeout(async () => { if (!document.hidden && state.config) await poll(); schedulePoll(); }, 1500); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.config) poll(); });
window.addEventListener('pagehide', () => clearTimeout(timer));
await start(); schedulePoll();
