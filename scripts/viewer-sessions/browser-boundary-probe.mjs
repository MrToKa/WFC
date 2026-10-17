import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createBrowserBoundary } from './browser-policy.mjs';

const { values }=parseArgs({ options:{ 'playwright-module':{ type:'string' },'browser-executable':{ type:'string' },evidence:{ type:'string' } },strict:true });
assert.ok(values['playwright-module']&&values['browser-executable']&&values.evidence,'Explicit local tools and unique evidence path are required.');
const { chromium }=await import(pathToFileURL(path.resolve(values['playwright-module'])).href);
let workerCookieObserved=false;
const target=http.createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');
  if(request.url==='/worker.js') { response.setHeader('Content-Type','text/javascript'); response.end("const local=await fetch('/worker-cookie').then(r=>r.json());let external;try{const r=await fetch('http://203.0.113.1/worker-egress-probe');external=r.status}catch{external='blocked'}postMessage({local,external});"); }
  else if(request.url==='/worker-cookie') { workerCookieObserved=(request.headers.cookie??'').includes('probe_http_only=local-test'); response.setHeader('Content-Type','application/json'); response.end(JSON.stringify({ cookie:workerCookieObserved })); }
  else { response.setHeader('Content-Type','text/html'); response.setHeader('Set-Cookie','probe_http_only=local-test; HttpOnly; SameSite=Strict; Path=/'); response.end("<!doctype html><title>Isolated browser boundary probe</title><script>const w=new Worker('/worker.js',{type:'module'});w.onmessage=e=>{document.title='done';document.body.textContent=JSON.stringify(e.data)};</script>"); }
});
await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${target.address().port}`,boundary=await createBrowserBoundary({ allowedOrigins:[origin] });
const browser=await chromium.launch({ executablePath:path.resolve(values['browser-executable']),headless:true,args:['--disable-background-networking','--disable-quic','--no-first-run','--no-default-browser-check'] });
const report={ schemaVersion:1,startedAt:new Date().toISOString(),browser:browser.version(),status:'RUNNING',scope:'Independent positive control of browser-wide worker proxy enforcement; no WFC/SDK/APS/real credentials.',requests:[],workers:[] };
try {
  const context=await browser.newContext({ serviceWorkers:'block',proxy:{ server:boundary.server,bypass:'<-loopback>' } });
  context.on('request',request=>{ const url=new URL(request.url()); report.requests.push({ origin:url.origin,pathname:url.pathname,resourceType:request.resourceType() }); });
  const page=await context.newPage(); page.on('worker',worker=>report.workers.push(worker.url()));
  await page.goto(origin); await page.waitForFunction(()=>document.title==='done');
  const result=JSON.parse(await page.locator('body').textContent());
  assert.equal(workerCookieObserved,true); assert.equal(result.local.cookie,true);
  assert.ok(boundary.requests.some(value=>value.pathname==='/worker-cookie'));
  assert.ok(boundary.denied.some(value=>value.origin==='http://203.0.113.1'&&value.pathname==='/worker-egress-probe'));
  assert.ok(report.workers.length>0); assert.ok(report.requests.some(value=>value.pathname==='/worker-cookie'));
  assert.ok(!report.requests.some(value=>value.resourceType==='serviceworker'));
  report.status='PASS'; report.workerHttpOnlyCookieObserved=true; report.externalWorkerDeniedBeforeForward=true;
  await context.close();
} catch(error) { report.status='FAIL'; report.failure=String(error.message); throw error; }
finally { await browser.close(); await boundary.close(); await new Promise(resolve=>target.close(resolve)); report.finishedAt=new Date().toISOString(); report.proxyRequests=boundary.requests; report.proxyDenied=boundary.denied; await fs.writeFile(values.evidence,JSON.stringify(report,null,2)+'\n',{ flag:'wx' }); }
console.log(JSON.stringify({ status:report.status,browser:report.browser,workerHttpOnlyCookieObserved:report.workerHttpOnlyCookieObserved,externalWorkerDeniedBeforeForward:report.externalWorkerDeniedBeforeForward }));
