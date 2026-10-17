import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const scratch = path.join(root, 'pathfinder-engine/.scratch/pf2-converted');
const captureRoot = path.join(scratch, 'captures');
const port = Number(process.env.PF_CAPTURE_PORT ?? 5185);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid isolated capture port.');
const token = crypto.randomBytes(32).toString('hex');
const verification = JSON.parse(await fs.readFile(path.join(scratch, 'package-verification.json'), 'utf8'));
await fs.mkdir(captureRoot, { recursive: true });
if ((await fs.lstat(captureRoot)).isSymbolicLink()) throw new Error('Capture output must not be a link.');
const manifest = verification.manifest;
let totalSavedBytes = 0;
let reservedBytes = 0;
const maximumBody = 32 * 1024 * 1024;
const maximumSaved = 2 * 1024 * 1024 * 1024;
for (const name of await fs.readdir(captureRoot)) {
  const stat = await fs.lstat(path.join(captureRoot, name));
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Capture directory contains an unexpected non-regular file.');
  totalSavedBytes += stat.size;
}
if (totalSavedBytes > maximumSaved) throw new Error('Retained captures already exceed the explicit byte budget.');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const send = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
async function staticFile(res, base, name) {
  const target = path.resolve(base, name);
  if (target !== base && !target.startsWith(base + path.sep)) return send(res, 403, { error: 'Path rejected.' });
  const stat = await fs.stat(target);
  if (!stat.isFile()) return send(res, 404, { error: 'File not found.' });
  res.writeHead(200, { 'content-type': contentTypes[path.extname(target)] ?? 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  createReadStream(target).pipe(res);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'");
  let reserved = 0;
  try {
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return send(res, 403, { error: 'Loopback host required.' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/bootstrap.json') return send(res, 200, {
      token, package: { packageId: manifest.packageId, contentFingerprint: manifest.contentFingerprint, packageSha256: verification.package.sha256, source: manifest.source, entrypoint: '/model/' + manifest.entrypoint },
      limits: { maximumBody, maximumSaved }, sdkVersion: '7.130.0'
    });
    if (req.method === 'POST' && url.pathname === '/capture') {
      if (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-capture-token'] !== token || !String(req.headers['content-type']).startsWith('application/json')) return send(res, 403, { error: 'Same-origin capture token required.' });
      const name = url.searchParams.get('name');
      if (!name || !/^[a-z0-9][a-z0-9_.-]{0,119}\.json$/.test(name)) return send(res, 400, { error: 'Invalid capture name.' });
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maximumBody || totalSavedBytes + reservedBytes + chunk.length > maximumSaved) return send(res, 413, { error: 'Explicit capture byte budget exceeded.' });
        reserved += chunk.length; reservedBytes += chunk.length;
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const data = JSON.parse(body.toString('utf8'));
      if (!String(data.schemaVersion).startsWith('pathfinder.converted.')) return send(res, 400, { error: 'Unsupported capture schema.' });
      await fs.writeFile(path.join(captureRoot, name), body, { flag: 'wx' });
      totalSavedBytes += size;
      return send(res, 201, { name, bytes: size, sha256: crypto.createHash('sha256').update(body).digest('hex') });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });
    if (url.pathname === '/') return await staticFile(res, here, 'index.html');
    if (url.pathname === '/capture.mjs') return await staticFile(res, here, 'capture.mjs');
    if (url.pathname.startsWith('/sdk/')) return await staticFile(res, path.join(root, 'viewer-runtime/sdk/7.130.0'), decodeURIComponent(url.pathname.slice(5)));
    if (url.pathname.startsWith('/model/')) {
      const name = decodeURIComponent(url.pathname.slice(7));
      if (!manifest.resources.some(resource => resource.path === name)) return send(res, 404, { error: 'Unlisted model resource.' });
      return await staticFile(res, path.join(scratch, 'package'), name);
    }
    send(res, 404, { error: 'Route not found.' });
  } catch (error) { send(res, error.code === 'EEXIST' ? 409 : error.code === 'ENOENT' ? 404 : 400, { error: error.message }); }
  finally { reservedBytes -= reserved; }
});
server.requestTimeout = 120000;
server.headersTimeout = 10000;
server.listen(port, '127.0.0.1', () => console.log(`PF-2 isolated converted capture ready: http://127.0.0.1:${port} (PID ${process.pid})`));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
