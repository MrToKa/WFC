import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sdkRoot = path.join(root, 'viewer-runtime/sdk/7.130.0');
const manifest = JSON.parse(await fs.readFile(path.join(sdkRoot, 'vendor-manifest.json'), 'utf8'));
const sdkFiles = [];
for (const [name, expected] of Object.entries(manifest.files)) {
  const bytes = await fs.readFile(path.join(sdkRoot, name));
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== expected.bytes || sha256 !== expected.sha256) throw new Error('SDK resource differs: ' + name);
  sdkFiles.push({ name, bytes: bytes.length, sha256 });
}
const checks = [];
const base = process.argv[2] ?? 'http://127.0.0.1:5185';
const bootResponse = await fetch(base + '/bootstrap.json');
const boot = await bootResponse.json();
const check = (name, pass, detail) => { checks.push({ name, status: pass ? 'PASS' : 'FAIL', detail }); if (!pass) throw new Error(name); };
check('isolated-bootstrap', bootResponse.status === 200 && boot.sdkVersion === '7.130.0', 'Copied verified package exposed at an independent loopback listener.');
check('network-csp', bootResponse.headers.get('content-security-policy')?.includes("connect-src 'self'") && bootResponse.headers.get('content-security-policy')?.includes("font-src 'self'"), 'External connection and font origins are blocked by the capture page policy.');
const rejected = await fetch(base + '/capture?name=unauthorized.json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
check('write-authorization', rejected.status === 403, 'Missing origin/token rejected before writes.');
const escaped = await fetch(base + '/capture?name=../outside.json', { method: 'POST', headers: { origin: base, 'x-capture-token': boot.token, 'content-type': 'application/json' }, body: '{}' });
check('write-path-boundary', escaped.status === 400, 'Traversal capture name rejected.');
const unlisted = await fetch(base + '/model/manifest.json');
check('model-resource-allowlist', unlisted.status === 404, 'Only hash-verified listed resource paths can be served.');
const wrongSchema = await fetch(base + '/capture?name=wrong-schema.json', { method: 'POST', headers: { origin: base, 'x-capture-token': boot.token, 'content-type': 'application/json' }, body: '{"schemaVersion":"wrong"}' });
check('write-schema-boundary', wrongSchema.status === 400, 'Unrelated payload schema rejected.');
const result = { schemaVersion: 'pathfinder.converted.local-checks.v1', observedAt: new Date().toISOString(), status: 'PASS', sdkVersion: manifest.version, sdkFiles, checks, packageSha256: boot.package.packageSha256,
  limitations: ['HTTP and pinned SDK integrity checks only; no browser or native/converted geometry parity is implied.'] };
const destination = path.join(root, 'docs/pathfinder/evidence/pf2', `converted-local-checks-${Date.now()}.json`);
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.writeFile(destination, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, checks: checks.length, sdkFiles: sdkFiles.length, destination }));
