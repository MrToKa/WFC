import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { load, ownership, demoLogin, ROOT, fail } from './runtime-lib.mjs';

// Deliberately malformed canonical data; no accepted artifact is created.
const state = await load(); await ownership(state);
if (state.project !== 'wfc-pathfinder-local' || state.port !== 5190) fail('PF_TRANSPORT_OWNED_DEMO_REQUIRED');
const token = await demoLogin(state), route = `/api/projects/${state.demo.projectId}/pathfinder/artifacts`;
function headersOnly(bytes, bearer) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = http.request({ host: '127.0.0.1', port: state.port, method: 'POST', path: route,
      headers: { 'Content-Length': bytes, 'Content-Type': 'application/json', Connection: 'close', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) } }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 65536) req.destroy(Error('PF_TRANSPORT_RESPONSE_LIMIT')); else chunks.push(chunk); });
      response.on('end', () => { clearTimeout(deadline); resolve({ status: response.statusCode, sentBodyBytes: 0, declaredBodyBytes: bytes, milliseconds: Date.now() - started, code: (() => { try { return JSON.parse(Buffer.concat(chunks)).code ?? null; } catch { return null; } })() }); });
    });
    const deadline = setTimeout(() => req.destroy(Error('PF_TRANSPORT_PREBODY_TIMEOUT')), 5000);
    req.on('error', error => { clearTimeout(deadline); reject(error); }); req.flushHeaders();
  });
}
const auth = await fetch(`http://127.0.0.1:${state.port}/api/projects/${state.demo.projectId}/pathfinder/authorization`, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) });
if (auth.status !== 204 || await auth.text() !== '') fail('PF_TRANSPORT_AUTHORIZATION_CONTROL_FAILED');
const unauthorized = await headersOnly(11 * 1024 ** 2);
if (unauthorized.status !== 401 || unauthorized.code !== 'UNAUTHORIZED') fail('PF_TRANSPORT_PREBODY_AUTH_FAILED');
const overLimit = await headersOnly(256 * 1024 ** 2 + 1, token);
if (overLimit.status !== 413 || overLimit.code !== 'ARTIFACT_LIMIT') fail('PF_TRANSPORT_SIZE_LIMIT_FAILED');
const body = JSON.stringify({ invalidCanonicalSnapshot: 'A'.repeat(11 * 1024 ** 2) });
const actual = await fetch(`http://127.0.0.1:${state.port}${route}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(30000) });
const text = await actual.text(); let invalid;
try { invalid = JSON.parse(text); } catch { fail('PF_TRANSPORT_API_RESPONSE_INVALID'); }
if (actual.status !== 400 || invalid.code !== 'INVALID_PATHFINDER_REQUEST') fail('PF_TRANSPORT_API_SCHEMA_NOT_REACHED');
const receipt = { schemaVersion: 1, status: 'PASS', recordedAtUtc: new Date().toISOString(), sourceProject: state.project, images: state.images,
  scope: 'Only the isolated loopback Nginx artifact-upload path; intentionally invalid body, no accepted artifact writes.',
  checks: { currentAdminAuthorization: auth.status, unauthorizedHeadersOnly: unauthorized, overLimitHeadersOnly: overLimit,
    actualBodyAboveOld10MiBLimit: { status: actual.status, code: invalid.code, bodyBytes: Buffer.byteLength(body) } },
  limits: ['An actual 11MiB invalid JSON-schema request reached the backend; this is not an accepted 64MiB geometry capture or full 256MiB capacity benchmark.', 'The 256MiB+1 rejection sent headers only; no oversized body was allocated or uploaded.'] };
const evidence = path.join(ROOT, 'docs/pathfinder/runtime/artifact-transport-' + Date.now() + '.json');
await fs.writeFile(evidence, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ status: 'PASS', evidence }));
