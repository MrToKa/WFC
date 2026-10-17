// @vitest-environment node
import { createHash,randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Readable,PassThrough } from 'node:stream';
import fs from 'node:fs/promises';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach,describe,expect,it,vi } from 'vitest';
const settings=vi.hoisted(() => ({jwtSecret:'synthetic-viewer-unit-secret',objectStorage:{endpoint:'127.0.0.1',port:9000,useSSL:false,accessKey:'unit-only',secretKey:'unit-only'}}));
vi.mock('../config.js',() => ({config:settings}));
vi.mock('../db.js',() => ({pool:{}}));
import { signAccessToken } from '../auth.js';
import { createModelStorage,type ModelStorageClient } from '../modelRegistry/storage.js';
import { createViewerSessionRouter } from '../routes/viewerSessionRoutes.js';
import { ViewerSessionError } from './errors.js';
import { createViewerRuntime,type ViewerRuntime } from './runtime.js';
import type { ViewerSessionService } from './service.js';

const servers: Server[]=[],runtimes: ViewerRuntime[]=[];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()));
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve,reject) => {server.closeAllConnections();server.close(error => error ? reject(error) : resolve());})));
});
async function fixture() {
  const projectId=randomUUID(),modelVersionId=randomUUID(),sessionId=randomUUID(),loadId=randomUUID(),userId=randomUUID();
  const cookieSecret=Buffer.alloc(32,9).toString('base64url'),raw=Buffer.from([31,139,8,0,7,9,11,255]);
  const resource={path:'resources/output/0/raw.json.gz',bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};
  let stored=raw,reads=0;
  const client={statObject:vi.fn(async () => ({size:stored.length})),getObject:vi.fn(async () => {reads++;return Readable.from([stored]);})} as unknown as ModelStorageClient;
  const storage=createModelStorage({client,bucket:'unit-models'});
  const session={sessionId,projectId,modelVersionId,loadId,expiresAt:new Date(Date.now()+300000).toISOString(),absoluteExpiresAt:new Date(Date.now()+1800000).toISOString()};
  const version={id:modelVersionId,projectId,contentFingerprint:'b'.repeat(64),supportProfile:'svf-local-7.130.0-v1',format:'svf',sdkVersion:'7.130.0',entrypoint:'resources/output/0/0.svf',resourceCount:1,totalBytes:raw.length,storagePrefix:storage.prefix(projectId,modelVersionId),manifest:{resources:[resource]}};
  const service={create:vi.fn(async () => ({session,cookieSecret})),authorizeResource:vi.fn(async () => ({session,version})),renew:vi.fn(async () => session),revoke:vi.fn(async () => undefined),revokeLogin:vi.fn(async () => undefined),markUnavailable:vi.fn(async () => undefined)} as unknown as ViewerSessionService;
  const runtime=createViewerRuntime({service,storage});runtimes.push(runtime);
  const origins:string[]=[];
  const app=express();app.use(createViewerSessionRouter({runtime,policy:{origins,allowHttpLoopback:true,trustProxy:false}}));
  app.use((_req,res) => {res.status(404).end();});
  const server=await new Promise<Server>(resolve => {const server=app.listen(0,'127.0.0.1',() => resolve(server));});servers.push(server);
  const address=server.address();if (!address || typeof address==='string') throw new Error('Missing unit listener');
  const origin=`http://127.0.0.1:${address.port}`;origins.push(origin);
  const base=`/api/projects/${projectId}/model-versions/${modelVersionId}/viewer-sessions`,path=`${base}/${sessionId}/resources/output/0/raw.json.gz`;
  const headers={Origin:origin,Cookie:`wfc_viewer_session=${cookieSecret}`};
  return {raw,resource,storage,session,version,service,client,runtime,origin,base,path,headers,userId,reads:()=>reads,corrupt:()=>{stored=Buffer.alloc(raw.length,2);}};
}
describe('protected resources through the actual HTTP and full-hash storage boundary',() => {
  it('serves raw gzip bytes, truthful HEAD and ranges from a fully verified handle each time',async () => {
    const f=await fixture();
    const full=await fetch(f.origin+f.path,{headers:f.headers});
    expect(full.status).toBe(200);expect(Buffer.from(await full.arrayBuffer())).toEqual(f.raw);
    expect(full.headers.get('content-encoding')).toBeNull();expect(full.headers.get('cache-control')).toBe('private, no-store');
    const range=await fetch(f.origin+f.path,{headers:{...f.headers,Range:'bytes=1-3'}});
    expect(range.status).toBe(206);expect(range.headers.get('content-range')).toBe(`bytes 1-3/${f.raw.length}`);expect(Buffer.from(await range.arrayBuffer())).toEqual(f.raw.subarray(1,4));
    const head=await fetch(f.origin+f.path,{method:'HEAD',headers:{...f.headers,Range:'bytes=-2'}});
    expect(head.status).toBe(206);expect(head.headers.get('content-length')).toBe('2');expect(await head.text()).toBe('');
    expect(f.reads()).toBe(3);expect(f.service.authorizeResource).toHaveBeenCalledTimes(6);
    expect(full.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('serves SDK domain metadata through the same full-hash GET/HEAD/range boundary and refuses query overrides',async () => {
    const f=await fixture(),url=f.origin+f.path+'?domain='+encodeURIComponent(f.origin);
    const full=await fetch(url,{headers:f.headers});expect(full.status).toBe(200);expect(Buffer.from(await full.arrayBuffer())).toEqual(f.raw);expect(full.headers.get('content-encoding')).toBeNull();
    const range=await fetch(url,{headers:{...f.headers,Range:'bytes=1-3'}});expect(range.status).toBe(206);expect(Buffer.from(await range.arrayBuffer())).toEqual(f.raw.subarray(1,4));
    const head=await fetch(url,{method:'HEAD',headers:{...f.headers,Range:'bytes=-2'}});expect(head.status).toBe(206);expect(head.headers.get('content-length')).toBe('2');expect(await head.text()).toBe('');
    expect(f.reads()).toBe(3);expect(f.service.authorizeResource).toHaveBeenCalledTimes(6);
    for(const suffix of ['?domain='+encodeURIComponent('http://localhost:1'),'?domain='+encodeURIComponent(f.origin)+'&domain='+encodeURIComponent(f.origin),'?domain='+encodeURIComponent(f.origin)+'&Authorization=forbidden','?acmsession=forbidden']) {
      const denied=await fetch(f.origin+f.path+suffix,{headers:f.headers});expect(denied.status).toBe(400);expect(await denied.json()).toMatchObject({code:'INVALID_VIEWER_REQUEST'});
    }
    const descriptor=await fetch(`${f.origin}${f.base}/${f.session.sessionId}/descriptor?domain=${encodeURIComponent(f.origin)}`,{headers:f.headers});expect(descriptor.status).toBe(400);
    const wrongOrigin=await fetch(url,{headers:{...f.headers,Origin:'https://foreign.invalid'}});expect(wrongOrigin.status).toBe(403);
    expect(f.reads()).toBe(3);expect(f.service.authorizeResource).toHaveBeenCalledTimes(6);
  });
  it('refuses same-size corruption before any200/206/HEAD data and marks the model unavailable',async () => {
    const f=await fixture();f.corrupt();
    for (const method of ['GET','HEAD']) {
      const response=await fetch(f.origin+f.path,{method,headers:{...f.headers,Range:'bytes=0-1'}});
      expect(response.status).toBe(409);expect(response.headers.get('cache-control')).toBe('private, no-store');
      if(method==='GET')expect(await response.json()).toMatchObject({code:'MODEL_UNAVAILABLE'});
    }
    expect(f.service.markUnavailable).toHaveBeenCalledTimes(2);expect(f.reads()).toBe(2);
  });
  it('reauthorizes after full resource I/O, so a concurrent revoke sends no verified resource bytes',async () => {
    const f=await fixture();
    vi.mocked(f.service.authorizeResource).mockRejectedValueOnce(new ViewerSessionError('ACCESS_REVOKED',403));
    const before=await fetch(f.origin+f.path,{headers:f.headers});expect(before.status).toBe(403);expect(f.reads()).toBe(0);
    vi.mocked(f.service.authorizeResource).mockResolvedValueOnce({session:f.session,version:f.version} as never).mockRejectedValueOnce(new ViewerSessionError('SESSION_REVOKED',410));
    const during=await fetch(f.origin+f.path,{headers:f.headers});expect(during.status).toBe(410);expect(await during.json()).toMatchObject({code:'SESSION_REVOKED'});expect(f.reads()).toBe(1);
  });
  it('detects a truncated or overlong object stream despite a matching stat length',async () => {
    const f=await fixture();
    for(const data of [f.raw.subarray(0,3),Buffer.concat([f.raw,Buffer.from([1])])]) {
      vi.mocked(f.client.getObject).mockResolvedValueOnce(Readable.from([data]));
      const response=await fetch(f.origin+f.path,{headers:f.headers});
      expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'MODEL_UNAVAILABLE'});
    }
    expect(f.service.markUnavailable).toHaveBeenCalledTimes(2);
  });
  it('keeps a storage outage separate from corruption and reports no resource bytes or private messages',async () => {
    const f=await fixture();vi.mocked(f.client.getObject).mockRejectedValueOnce(new Error('PRIVATE-credential-bucket-details'));
    const response=await fetch(f.origin+f.path,{headers:f.headers});expect(response.status).toBe(502);
    const text=await response.text();expect(text).toContain('RESOURCE_FAILED');expect(text).not.toContain('PRIVATE-credential');
    expect(f.service.markUnavailable).not.toHaveBeenCalled();
  });
  it('aborts a stalled raw read, closes its private spool and allows shutdown to drain',async () => {
    const f=await fixture(),source=new PassThrough(),controller=new AbortController();
    vi.mocked(f.client.getObject).mockResolvedValueOnce(source);
    const pending=f.storage.readVerifiedResource(f.version.storagePrefix,f.resource,controller.signal);
    const checked=expect(pending).rejects.toMatchObject({code:'IMPORT_ABORTED'});
    await vi.waitFor(() => expect(f.client.getObject).toHaveBeenCalled());
    controller.abort();await checked;expect(source.destroyed).toBe(true);
    await f.runtime.close();
  });
  it('maps disk exhaustion to a safe507 before any body and releases the spool budget',async () => {
    const f=await fixture();vi.spyOn(fs,'mkdtemp').mockRejectedValueOnce(Object.assign(new Error('PRIVATE-temporary-path'),{code:'ENOSPC'}));
    const denied=await fetch(f.origin+f.path,{headers:f.headers});expect(denied.status).toBe(507);
    expect(await denied.json()).toMatchObject({code:'STORAGE_EXHAUSTED'});expect(f.service.markUnavailable).not.toHaveBeenCalled();
    const retry=await fetch(f.origin+f.path,{headers:f.headers});expect(retry.status).toBe(200);expect(Buffer.from(await retry.arrayBuffer())).toEqual(f.raw);
  });
  it('rejects invalid resource methods/paths/ranges without a public cache or SPA fallback',async () => {
    const f=await fixture();
    const multi=await fetch(f.origin+f.path,{headers:{...f.headers,Range:'bytes=0-1,3-4'}});expect(multi.status).toBe(416);expect(multi.headers.get('content-range')).toBe(`bytes */${f.raw.length}`);
    const missing=await fetch(f.origin+f.path.replace('raw.json.gz','absent.json.gz'),{headers:f.headers});expect(missing.status).toBe(404);
    const wrong=await fetch(f.origin+f.path,{method:'POST',headers:f.headers});expect(wrong.status).toBe(405);expect(wrong.headers.get('allow')).toBe('GET, HEAD');
    expect(f.reads()).toBe(0);
  });
  it('owns private case aliases and unknown global viewer paths before permissive CORS or HTML fallbacks',async () => {
    const f=await fixture();
    for(const path of [f.path.replace('/api/projects/','/API/PROJECTS/').replace('/viewer-sessions/','/VIEWER-SESSIONS/'),'/api/viewer-sessions/unknown','/API/VIEWER-SESSIONS/REVOKE-LOGIN']) {
      const response=await fetch(f.origin+path,{headers:f.headers});
      expect(response.status).toBe(404);expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(await response.json()).toMatchObject({code:'RESOURCE_NOT_FOUND'});
    }
    expect(f.service.authorizeResource).not.toHaveBeenCalled();expect(f.reads()).toBe(0);
  });
  it('creates path-scoped HttpOnly sessions with unique login tokens and refuses legacy viewer use',async () => {
    const f=await fixture(),a=signAccessToken(f.userId,'unit@fixture.invalid',false),b=signAccessToken(f.userId,'unit@fixture.invalid',false);
    expect(a.token).not.toBe(b.token);
    const response=await fetch(f.origin+f.base,{method:'POST',headers:{Origin:f.origin,Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:JSON.stringify({loadId:f.session.loadId})});
    expect(response.status).toBe(201);expect(await response.json()).toEqual(f.session);
    const cookie=response.headers.get('set-cookie');expect(cookie).toContain(`Path=${f.base}/${f.session.sessionId}/`);expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Strict');
    const legacy=jwt.sign({sub:f.userId,email:'unit@fixture.invalid'},settings.jwtSecret,{expiresIn:3600});
    const denied=await fetch(f.origin+f.base,{method:'POST',headers:{Origin:f.origin,Authorization:`Bearer ${legacy}`,'Content-Type':'application/json'},body:JSON.stringify({loadId:f.session.loadId})});
    expect(denied.status).toBe(401);expect(await denied.json()).toMatchObject({code:'LOGIN_REFRESH_REQUIRED'});expect(f.service.create).toHaveBeenCalledTimes(1);
  });
});
