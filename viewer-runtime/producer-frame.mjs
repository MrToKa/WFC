import { validateBootstrap } from './protocol.mjs';
import { createRuntimeBridge } from './bridge.mjs';
import { createViewerAdapter } from './adapter.mjs';

// A separate fixed entry point selects capture-only transport. The normal frame
// never accepts a caller-provided resource URL, token or mode in its bootstrap.
const bootstrap = validateBootstrap(window.location.search);
const status = document.getElementById('runtime-status');
if (!bootstrap || window.parent === window) status.textContent = 'Open this model from the managed preparation service.';
else {
  const adapter=createViewerAdapter({window,container:document.getElementById('viewer-container')});
  const bridge=createRuntimeBridge({window,bootstrap,adapter,resourceMode:'producer',onState(state){status.textContent=state.phase;}});
  window.addEventListener('pagehide',()=>bridge.dispose(),{once:true});
}
