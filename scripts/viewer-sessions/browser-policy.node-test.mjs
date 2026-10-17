import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBrowserBoundary } from './browser-policy.mjs';

test('isolated proxy streams only exact loopback origins and never retains credentials or query values', async () => {
  const target = http.createServer((request, response) => { response.setHeader('Content-Type', 'application/octet-stream'); response.end(Buffer.from([0x1f, 0x8b, 8, 1])); });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${target.address().port}`, boundary = await createBrowserBoundary({ allowedOrigins: [origin] });
  try {
    const request = (url, headers = {}) => new Promise((resolve, reject) => {
      const proxy = new URL(boundary.server), call = http.request({ host: proxy.hostname, port: proxy.port, path: url, headers }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) })); }); call.once('error', reject); call.end();
    });
    const allowed = await request(origin + '/resources/a.pf?private=never-evidence', { Cookie: 'secret-cookie', Authorization: 'Bearer secret-token' });
    assert.equal(allowed.status, 200); assert.deepEqual(allowed.bytes, Buffer.from([0x1f, 0x8b, 8, 1]));
    assert.equal((await request('http://example.invalid/remote')).status, 403);
    assert.equal((await request('http://user:pass@127.0.0.1:' + target.address().port + '/')).status, 403);
    const evidence = JSON.stringify({ requests: boundary.requests, denied: boundary.denied });
    for (const secret of ['secret-cookie', 'secret-token', 'never-evidence', 'user:pass']) assert.equal(evidence.includes(secret), false);
    assert.equal(boundary.requests.length, 1); assert.equal(boundary.denied.length, 2);
  } finally { await boundary.close(); await new Promise(resolve => target.close(resolve)); }
});

test('CONNECT permits only the exact fixture authority and retains no tunnel credentials',async()=>{
  const target=http.createServer((_request,response)=>response.end('owned-fixture-tunnel'));
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
  const authority='127.0.0.1:'+target.address().port,boundary=await createBrowserBoundary({allowedOrigins:['http://'+authority]});
  const connect=destination=>new Promise((resolve,reject)=>{
    const proxy=new URL(boundary.server),request=http.request({hostname:proxy.hostname,port:proxy.port,method:'CONNECT',path:destination});
    request.once('connect',(response,socket,head)=>resolve({response,socket,head}));request.once('error',reject);request.end();
  });
  try {
    const tunnel=await connect(authority);assert.equal(tunnel.response.statusCode,200);
    const reply=await new Promise((resolve,reject)=>{
      const chunks=[tunnel.head];tunnel.socket.on('data',chunk=>chunks.push(chunk));tunnel.socket.once('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));tunnel.socket.once('error',reject);
      tunnel.socket.write('GET / HTTP/1.1\r\nHost: '+authority+'\r\nConnection: close\r\n\r\n');
    });
    assert.match(reply,/owned-fixture-tunnel/);tunnel.socket.destroy();
    for(const destination of ['localhost:'+target.address().port,'localhost:5173','203.0.113.1:443','secret:credential@'+authority,authority+'/other']) {
      const denied=await connect(destination);assert.equal(denied.response.statusCode,403);denied.socket.destroy();
    }
    assert.equal(boundary.requests.length,1);assert.equal(boundary.requests[0].origin,'http://'+authority);assert.equal(boundary.denied.length,5);
    assert.equal(JSON.stringify(boundary.denied).includes('secret:credential'),false);
  }finally{await boundary.close();await new Promise(resolve=>target.close(resolve));}
});
