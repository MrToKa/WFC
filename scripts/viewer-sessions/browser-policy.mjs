import http from 'node:http';
import net from 'node:net';
import { randomUUID, createHash } from 'node:crypto';

/** Browser-wide HTTP boundary. Dedicated workers use Chromium's same proxy. */
export async function createBrowserBoundary({ allowedOrigins }) {
  const allowed = new Set(allowedOrigins.map(value => {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw Error('Only explicit isolated loopback origins are allowed.');
    return parsed.origin;
  }));
  if (!allowed.size) throw Error('A browser boundary needs an isolated origin.');
  const requests = [], denied = [], sockets = new Set();
  const targetFor = raw => {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' || url.username || url.password || !allowed.has(url.origin)) return null;
      return url;
    } catch { return null; }
  };
  const safeTarget = raw => {
    try {
      const url = new URL(raw),known=new Set(['domain','acmsession','auth','token','access_token','v','version','timestamp']);
      const keys=[...url.searchParams.keys()].map(key=>known.has(key)?key:'unknown-sha256:'+createHash('sha256').update(key).digest('hex'));
      const result={ origin:url.origin,pathname:url.pathname,queryKeys:keys };
      if(url.searchParams.has('domain')) result.domainEqualsRequestOrigin=url.searchParams.getAll('domain').length===1&&url.searchParams.get('domain')===url.origin;
      return result;
    }
    catch { return { origin: 'invalid', pathname: 'invalid' }; }
  };
  const refuse = (raw, method, response) => {
    denied.push({ ...safeTarget(raw), method, at: new Date().toISOString() });
    response.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); response.end('Isolated browser egress denied.');
  };
  const server = http.createServer((request, response) => {
    const target = targetFor(request.url);
    if (!target) { refuse(request.url, request.method, response); return; }
    const record = { id: randomUUID(), ...safeTarget(target), method: request.method, startedAt: new Date().toISOString() };
    requests.push(record);
    const upstream = http.request(target, { method: request.method, headers: { ...request.headers, host: target.host } }, result => {
      record.status = result.statusCode;
      record.contentType = result.headers['content-type'] ?? null;
      record.contentLength = result.headers['content-length'] ?? null;
      record.contentEncoding = result.headers['content-encoding'] ?? null;
      response.writeHead(result.statusCode, result.headers); result.pipe(response);
      result.once('end', () => { record.completedAt = new Date().toISOString(); });
      result.once('error', () => { record.failed = true; response.destroy(); });
    });
    upstream.setTimeout(300_000, () => upstream.destroy(Error('Isolated browser upstream timeout.')));
    upstream.once('error', () => { record.failed = true; if (!response.headersSent) response.writeHead(502, { 'Cache-Control': 'no-store' }); response.end(); });
    request.once('aborted', () => upstream.destroy()); response.once('close', () => { if (!response.writableFinished) upstream.destroy(); });
    request.pipe(upstream);
  });
  server.on('connect', (request, socket, head) => {
    // Chromium also tunnels same-origin ws:// HMR through CONNECT. Only the
    // explicitly allowed HTTP fixture authority may receive that raw tunnel.
    const authority=String(request.url),target=targetFor('http://'+authority);
    if(!target||authority!==target.host||target.pathname!=='/'||target.search||target.hash) {
      denied.push({ ...safeTarget('https://'+authority),method:'CONNECT',at:new Date().toISOString() });
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return;
    }
    const record={id:randomUUID(),...safeTarget(target),method:'CONNECT',startedAt:new Date().toISOString()};requests.push(record);
    let connected=false;
    const upstream=net.connect(Number(target.port||80),target.hostname,()=>{
      connected=true;record.status=200;socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if(head.length)upstream.write(head);upstream.pipe(socket);socket.pipe(upstream);
    });
    upstream.setTimeout(300_000,()=>upstream.destroy(Error('Isolated fixture tunnel timeout.')));
    upstream.once('error',()=>{record.failed=true;if(!connected)socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');else socket.destroy();});
    socket.once('error',()=>upstream.destroy());socket.once('close',()=>upstream.destroy());
    sockets.add(upstream);upstream.once('close',()=>{record.completedAt=new Date().toISOString();sockets.delete(upstream);});
  });
  server.on('upgrade', (request, socket, head) => {
    const raw = String(request.url).replace(/^ws:/, 'http:');
    const target = targetFor(raw);
    if (!target) { denied.push({ ...safeTarget(raw), method: 'UPGRADE', at: new Date().toISOString() }); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const record = { id: randomUUID(), ...safeTarget(target), method: 'UPGRADE', startedAt: new Date().toISOString() }; requests.push(record);
    const upstream = net.connect(Number(target.port || 80), target.hostname, () => {
      const headers = { ...request.headers, host: target.host };
      upstream.write(`${request.method} ${target.pathname}${target.search} HTTP/${request.httpVersion}\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head); upstream.pipe(socket); socket.pipe(upstream);
    });
    upstream.once('error', () => { record.failed = true; socket.destroy(); }); socket.once('error', () => upstream.destroy()); socket.once('close', () => upstream.destroy());
    sockets.add(upstream); upstream.once('close', () => sockets.delete(upstream));
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    server: `http://127.0.0.1:${server.address().port}`, requests, denied,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); },
  };
}

export async function instrumentContext(context, allowedOrigins) {
  const allowed = new Set(allowedOrigins), observed = [], blocked = [], workers = [], csp = [], consoleErrors = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (allowed.has(url.origin)) return route.continue();
    blocked.push({ origin: url.origin, pathname: url.pathname, resourceType: request.resourceType() });
    return route.abort('blockedbyclient');
  });
  context.on('request', request => {
    const url = new URL(request.url());
    let frame = null; try { frame = request.frame().url().split('?')[0]; } catch { /* Worker requests may have no frame. */ }
    observed.push({ origin: url.origin, pathname: url.pathname, method: request.method(), resourceType: request.resourceType(), frame, serviceWorker: !!request.serviceWorker() });
  });
  context.on('page', page => {
    page.on('worker', worker => workers.push({ url: worker.url().split('?')[0], openedAt: new Date().toISOString() }));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().replace(/(?:Bearer\s+)[^\s]+/gi, 'Bearer [redacted]').slice(0, 1500)); });
  });
  await context.exposeBinding('__stage5Csp', (_source, value) => csp.push(value));
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      let origin; try { origin = new URL(event.blockedURI).origin; } catch { origin = event.blockedURI; }
      globalThis.__stage5Csp({ effectiveDirective: event.effectiveDirective, blockedOrigin: origin, disposition: event.disposition });
    });
  });
  return { observed, blocked, workers, csp, consoleErrors };
}
