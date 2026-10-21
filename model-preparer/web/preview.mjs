const statusNode = document.getElementById('preview-status');
const errorNode = document.getElementById('preview-error');
const loadingNode = document.getElementById('viewer-loading');
const result = { status: 'loading', sdkVersion: '7.130.0', geometryLoaded: false, propertiesLoaded: false,
  fragments: 0, objects: 0, propertyCount: 0, externalAttempts: [], cspViolations: [], resourceOrigins: [] };
window.previewReady = result;
let viewer, disposed = false, observationChain = Promise.resolve(), lastObservationSignature = null;
const nativeFetch = window.fetch.bind(window), nativeOpen = XMLHttpRequest.prototype.open;
function publish() {
  result.resourceOrigins = [...new Set(performance.getEntriesByType('resource').filter(item => /^https?:/.test(item.name)).map(item => new URL(item.name).origin))];
  const integrity = document.getElementById('preview-integrity');
  integrity.textContent = result.propertiesLoaded ? `${result.propertyCount} properties on the selected object · ${result.externalAttempts.length} external requests · ${result.cspViolations.length} blocked resources` : '';
  integrity.dataset.geometryLoaded = String(result.geometryLoaded);
  integrity.dataset.propertiesLoaded = String(result.propertiesLoaded);
  integrity.dataset.fragments = String(result.fragments);
  integrity.dataset.objects = String(result.objects);
  integrity.dataset.propertyCount = String(result.propertyCount);
  integrity.dataset.propertyErrorKind = result.propertyErrorKind || '';
  integrity.dataset.externalRequests = String(result.externalAttempts.length);
  integrity.dataset.cspViolations = String(result.cspViolations.length);
  integrity.dataset.cspDirectives = [...new Set(result.cspViolations.map(item => item.directive))].join(',');
  integrity.dataset.cspOrigins = [...new Set(result.cspViolations.map(item => item.origin))].join(',');
  integrity.dataset.resourceOrigins = result.resourceOrigins.join(',');
  window.dispatchEvent(new CustomEvent('preparer:preview-state', { detail: { ...result } }));
}
function recordBrowserObservation() {
  if (!result.jobId || !['PASS', 'FAIL'].includes(result.status)) return;
  const payload = {jobId:result.jobId,sdkVersion:result.sdkVersion,previewStatus:result.status,geometryLoaded:result.geometryLoaded,propertiesLoaded:result.propertiesLoaded,geometryCount:result.fragments,propertyCount:result.propertyCount,cspViolationCount:result.cspViolations.length,externalRequestCount:result.externalAttempts.length};
  const signature = JSON.stringify(payload);
  observationChain = observationChain.catch(() => {}).then(async () => {
    if (signature === lastObservationSignature) return;
    try {
    const configResponse = await nativeFetch('/api/config', {cache:'no-store',credentials:'same-origin',redirect:'error'});
    if (!configResponse.ok) return;
    const config = await configResponse.json();
    const response = await nativeFetch('/api/browser-evidence', {method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json','X-Preparer-Token':config.csrfToken,'X-Request-Id':crypto.randomUUID()},body:signature});
    if (response.ok) lastObservationSignature = signature;
    document.getElementById('preview-integrity').dataset.observationRecorded = String(response.ok);
    } catch { document.getElementById('preview-integrity').dataset.observationRecorded = 'false'; }
  });
}
function fail(message) {
  if (disposed) return;
  result.status = 'FAIL'; statusNode.textContent = 'Preview is not ready';
  errorNode.textContent = message; errorNode.hidden = false; loadingNode.hidden = true;
  document.getElementById('fit-model').disabled = true; document.getElementById('preview-export').hidden = true; publish(); recordBrowserObservation();
}
function inspect(url) {
  const parsed = new URL(url, location.href);
  if (parsed.origin !== location.origin && !['blob:', 'data:'].includes(parsed.protocol)) {
    result.externalAttempts.push(parsed.origin); fail('An external resource was blocked. Preview requires the complete verified local Viewer.');
    throw new Error('External resource blocked');
  }
}
window.fetch = function (input, options) { inspect(typeof input === 'string' || input instanceof URL ? input : input.url); return nativeFetch(input, options); };
XMLHttpRequest.prototype.open = function (method, url, ...rest) { inspect(url); return nativeOpen.call(this, method, url, ...rest); };
document.addEventListener('securitypolicyviolation', event => {
  result.cspViolations.push({ directive: event.violatedDirective, origin: (() => { if (['inline','eval','data','blob',''].includes(event.blockedURI)) return event.blockedURI || 'redacted'; try { return new URL(event.blockedURI).origin; } catch { return 'blocked'; } })() });
  fail('A local Viewer resource was blocked by the access policy. Check the runtime configuration.');
});
window.addEventListener('error', () => fail('An error occurred in the local 3D preview. Check the package and Viewer runtime.'));
window.addEventListener('unhandledrejection', () => fail('The local 3D preview did not complete. Check the package and Viewer runtime.'));

function loadScript(src) {
  return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.append(script); });
}
function setLoading(message) { statusNode.textContent = message; document.getElementById('viewer-loading-label').textContent = message; }
function complete() {
  if (disposed || result.status === 'FAIL') return;
  if (result.fragments < 1 || result.propertyCount < 1 || result.externalAttempts.length || result.cspViolations.length) { fail('The geometry and properties have not been confirmed as fully local.'); return; }
  result.status = 'PASS'; loadingNode.hidden = true;
  statusNode.textContent = 'Geometry and properties are ready. Select an object to inspect its data.';
  const format = value => new Intl.NumberFormat('en-GB').format(value);
  document.getElementById('preview-facts').textContent = `${format(result.fragments)} geometry fragments · ${format(result.objects)} objects · local Viewer 7.130.0`;
  document.getElementById('fit-model').disabled = false;
  document.getElementById('preview-export').hidden = false; publish();
  void recordBrowserObservation();
}
async function start() {
  const match = /^\/preview\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/.exec(location.pathname);
  if (!match) { fail('No valid verified model was selected. Return to the job list.'); return; }
  const jobId = match[1]; result.jobId = jobId;
  const response = await nativeFetch(`/api/artifacts/${jobId}/preview`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  if (!response.ok) { fail('The preview is not prepared or the package failed validation. Return to the job and prepare the 3D preview again.'); return; }
  const descriptor = await response.json();
  if (descriptor.sdkVersion !== '7.130.0' || descriptor.jobId !== jobId || descriptor.modelUrl !== `/preview-resources/${jobId}/resources/output/0/0.svf`) { fail('The model profile or local address does not match the verified Viewer.'); return; }
  result.contentFingerprint = descriptor.contentFingerprint; result.resourceCount = descriptor.resourceCount;
  document.getElementById('preview-export').href = `/api/artifacts/${jobId}/package`;
  setLoading('Loading the verified local Viewer…'); await loadScript('/sdk/viewer3D.min.js');
  const V = window.Autodesk?.Viewing;
  if (!V) { fail('The verified local Viewer 7.130.0 is unavailable.'); return; }
  V.Initializer({ env: 'Local', offline: 'true', useADP: false, disableAnalytics: true, shouldInitializeAuth: false,
    useCookie: false, language: 'en', lmvResourceRoot: '/sdk/' }, () => {
    if (disposed || result.status === 'FAIL') return;
    viewer = new V.GuiViewer3D(document.getElementById('viewer'));
    if (viewer.start() !== 0) { fail('The 3D preview could not start. Check WebGL support in your browser.'); return; }
    viewer.setTheme('light-theme'); setLoading('Loading local geometry…');
    viewer.addEventListener(V.ERROR_EVENT, () => fail('A model resource could not be loaded. The preview is not verified.'));
    viewer.addEventListener(V.GEOMETRY_LOADED_EVENT, () => {
      if (disposed || result.status === 'FAIL') return;
      result.geometryLoaded = true; result.fragments = viewer.model.getFragmentList().getCount();
      // Keep source materials/colors; these are the proven light display settings.
      viewer.setLightPreset(7); viewer.setQualityLevel(false, true); viewer.impl.setTonemapMethod(1); viewer.impl.setTonemapExposureBias(1);
      viewer.fitToView(); viewer.resize(); setLoading('Geometry loaded. Checking properties…'); publish();
      viewer.model.getObjectTree(tree => {
        let leaf;
        tree.enumNodeChildren(tree.getRootId(), id => { result.objects++; if (leaf === undefined && tree.getChildCount(id) === 0 && tree.getNodeName(id)) leaf = id; }, true);
        if (leaf === undefined) { fail('No object is available to verify the model properties.'); return; }
        viewer.getProperties(leaf, properties => { result.propertiesLoaded = true; result.propertyCount = properties.properties?.length ?? 0; result.propertyDbId = leaf; viewer.select(leaf); const panel = viewer.getPropertyPanel(); if (panel) { panel.setProperties(properties.properties || []); panel.setVisible(true); } complete(); }, () => fail('The local model properties could not be loaded.'));
      }, error => {
        // Record only a bounded diagnostic kind; worker messages may contain
        // model data and must not be forwarded to the page or service report.
        result.propertyErrorKind = typeof error?.err === 'string' ? 'structured-data-error' : 'resource-unavailable';
        fail('The local object tree could not be loaded.');
      });
    });
    viewer.loadModel(new URL(descriptor.modelUrl, location.href).href, {}, () => {}, () => fail('The local model could not be loaded. Check the package and its resources.'));
    document.getElementById('fit-model').addEventListener('click', () => viewer.fitToView());
    window.addEventListener('resize', () => viewer?.resize());
  });
}
window.addEventListener('pagehide', () => { disposed = true; viewer?.finish(); });
try { await start(); } catch { fail('The local preview could not start. Check the application and verified package.'); }
