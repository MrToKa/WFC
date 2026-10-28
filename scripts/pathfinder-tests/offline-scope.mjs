// Observe actual local policy/network configuration without contacting Autodesk.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inspect = (kind, ...names) => JSON.parse(execFileSync('docker', [kind, 'inspect', ...names], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 }));
const api = JSON.parse(execFileSync('docker', ['inspect', 'wfc-pathfinder-local-api-1'], { encoding: 'utf8', windowsHide: true }))[0];
assert.equal(api.Config.Labels['wfc.pathfinder.isolated'], 'true');
const networkNames = Object.keys(api.NetworkSettings.Networks), networks = inspect('network', ...networkNames);
assert.equal(networks.length, 1); assert.ok(networks.every(value => value.Internal)); assert.deepEqual(api.HostConfig.PortBindings, {});
const response = await fetch('http://127.0.0.1:5190/viewer-runtime/7.130.0/index.html'); assert.equal(response.status, 200);
const csp = response.headers.get('content-security-policy') ?? '';
assert.match(csp, /connect-src 'self'(?:;|$)/); assert.match(csp, /script-src 'self'(?:;|$)/); assert.match(csp, /font-src 'self' data:(?:;|$)/);
const html = await response.text();
assert.equal(/(?:src|href)\s*=\s*["']https?:\/\//i.test(html), false);
const adapter = await fetch('http://127.0.0.1:5190/viewer-runtime/7.130.0/adapter.mjs'); assert.equal(adapter.status, 200);
const code = await adapter.text(); assert.ok(code.includes("env: 'Local'") && code.includes("offline: 'true'") && code.includes('disableAnalytics: true'));
const result = { schemaVersion: 'pathfinder.local-offline-scope.v1', observedAtUtc: new Date().toISOString(), status: 'PASS',
  scope: 'actual-local-viewer-CSP-and-private-backend-network-plus-successful-local-routing-evidence;not-host-network-disconnection',
  apiImage: api.Image, apiNetworks: networks.map(value => ({ name: value.Name, internal: value.Internal })), apiPublishedPorts: [],
  viewerHttp: response.status, scriptPolicy: 'self', connectionPolicy: 'self', fontPolicy: 'self/data', externalHtmlAssets: false, localInitializerAndAnalyticsDisabled: true,
  actualRoutingEvidence: ['actual-capture-1792289114650.json', 'settings-reuse-1792289459485.json'],
  autodeskOrNativeHostInvokedByThisCheck: false, hostInternetDisabled: false,
  limits: ['The entire host/browser was not disconnected from the Internet.', 'This does not prove native geometry parity or whole-plant capacity.'] };
const output = path.join(root, 'docs/pathfinder/evidence/pf7', `offline-scope-${Date.now()}.json`); await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, status: 'PASS', privateBackendNetworks: networks.length, viewerCloudConnectionsAllowed: false, hostNetworkDisconnectionClaimed: false }));
