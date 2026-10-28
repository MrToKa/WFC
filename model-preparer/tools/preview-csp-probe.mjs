import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'";
const script = `document.addEventListener('securitypolicyviolation',e=>{let n=document.getElementById('result');n.textContent=JSON.stringify({directive:e.violatedDirective,blocked:e.blockedURI==='eval'?'eval':new URL(e.blockedURI,location.href).origin,sample:e.sample});});let s=document.createElement('script');s.src='/sdk/viewer3D.min.js';s.onload=()=>{document.getElementById('loaded').textContent='SDK loaded';Autodesk.Viewing.Initializer({env:'Local',offline:'true',useADP:false,disableAnalytics:true,shouldInitializeAuth:false,useCookie:false,language:'en',lmvResourceRoot:'/sdk/'},()=>{let v=new Autodesk.Viewing.GuiViewer3D(document.getElementById('viewer'));document.getElementById('loaded').textContent='Viewer start:'+v.start();});};s.onerror=()=>{document.getElementById('loaded').textContent='SDK load failed';};document.head.append(s);`;
const server = http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',csp);
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local SDK CSP diagnosis</title><link rel="stylesheet" href="/sdk/style.min.css"><h1>Local SDK CSP diagnosis</h1><p id="result">No violation observed</p><p id="loaded">Loading</p><div id="viewer" style="width:900px;height:600px"></div><script src="/probe.mjs" type="module"></script>');}
  else if(req.url==='/probe.mjs'){res.setHeader('Content-Type','text/javascript');res.end(script);}
  else if(/^\/sdk\/[a-zA-Z0-9_./-]+$/.test(req.url)&&!req.url.includes('..')){let file=req.url.slice(5);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');try{res.end(await fs.readFile(path.join(new URL('../deployment/preview-runtime/',import.meta.url).pathname.slice(1),file)));}catch{res.statusCode=404;res.end();}}
  else {res.statusCode=404;res.end();}
});
server.listen(8084,'127.0.0.1',()=>console.log('LOCAL_CSP_PROBE_READY'));
process.on('SIGINT',()=>server.close());
process.on('SIGTERM',()=>server.close());
