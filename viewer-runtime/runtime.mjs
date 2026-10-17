import { validateBootstrap } from './protocol.mjs';
import { createRuntimeBridge } from './bridge.mjs';
import { createViewerAdapter } from './adapter.mjs';

const status = document.getElementById('runtime-status');
const evidence = document.getElementById('runtime-evidence');
const bootstrap = validateBootstrap(window.location.search);
if (!bootstrap || window.parent === window) {
  status.textContent = 'Open this viewer from WFC.';
} else {
  const adapter = createViewerAdapter({ window, container: document.getElementById('viewer-container'), onEvidence(facts) {
    evidence.textContent = `Geometry: ${facts.fragmentCount}; identifiers: ${facts.nodeCount}; properties: ${facts.propertiesCount}.`;
    for (const [key, value] of Object.entries(facts)) evidence.dataset[key] = String(value);
  } });
  const bridge = createRuntimeBridge({ window, bootstrap, adapter, onState(state) {
    status.textContent = state.phase === 'loaded' ? 'The model and its identifiers are loaded.' : state.phase === 'route' ? `Drawable segments: ${state.drawableCount}; lines: ${state.lineCount}.` : state.phase === 'disposed' ? 'The viewer has been closed.' : state.phase === 'error' ? 'The viewer stopped because of an error.' : 'Preparing the local viewer…';
  } });
  window.addEventListener('pagehide', () => bridge.dispose(), { once: true });
}
