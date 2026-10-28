// @vitest-environment node
import http,{ type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>{
  process.env.DATABASE_URL='postgresql://unused.invalid/pathfinder-transport-test';process.env.JWT_SECRET='isolated-transport-test-value';process.env.MINIO_ACCESS_KEY='isolated-test';process.env.MINIO_SECRET_KEY='isolated-transport-test-value';
  return {query:vi.fn(),connect:vi.fn(),create:vi.fn(),plan:vi.fn(),admin:true,revoked:false,project:true};
});
vi.mock('../db.js',()=>({pool:{query:mocks.query,connect:mocks.connect}}));
vi.mock('../auth.js',async original=>({...await original<typeof import('../auth.js')>(),verifyAccessToken:()=>({sub:'11111111-1111-4111-8111-111111111111',jti:'22222222-2222-4222-8222-222222222222',email:'transport@test.invalid',exp:2_000_000_000,isAdmin:true})}));
vi.mock('./runtime.js',()=>({getPathFinderRuntime:()=>({lookups:{create:mocks.create,plan:mocks.plan}})}));
import { createApp } from '../app.js';
import { syntheticLookupSnapshot } from './lookupFixture.js';
const projectId='33333333-3333-4333-8333-333333333333',modelId='44444444-4444-4444-8444-444444444444';
let server:Server,origin:string;
beforeAll(async()=>{server=createApp().listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;});
afterAll(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
beforeEach(()=>{
  vi.clearAllMocks();mocks.admin=true;mocks.revoked=false;mocks.project=true;mocks.create.mockResolvedValue({jobId:modelId,duplicate:false});
  mocks.query.mockImplementation(async(sql:string)=>{
    if(sql==='SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE')return {rows:mocks.project?[{id:projectId}]:[]};
    if(sql.startsWith('SELECT is_admin'))return {rows:[{is_admin:mocks.admin,role:'admin'}]};
    if(sql.startsWith('SELECT user_id,expires_at'))return {rows:[{user_id:'11111111-1111-4111-8111-111111111111',expires_at:new Date(2_000_000_000_000),revoked_at:mocks.revoked?new Date():null}]};
    return {rows:[]};
  });mocks.connect.mockResolvedValue({query:mocks.query,release:vi.fn()});
});
function headersOnly(endpoint:string,length:number,bearer=true):Promise<number> {
  return new Promise((resolve,reject)=>{
    const request=http.request(origin+`/api/projects/${projectId}/pathfinder/`+endpoint,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':length,Connection:'close',...(bearer?{Authorization:'Bearer test'}:{})}},response=>{
      const status=response.statusCode!;response.resume();response.once('end',()=>{resolve(status);request.destroy();});
    });request.on('error',reject);request.setTimeout(3000,()=>request.destroy(Error('No pre-body response')));request.flushHeaders();
  });
}
describe('lookup scoped large-body middleware through the actual app',()=>{
  it('rejects anonymous, demoted, revoked and missing-project uploads before receiving any declared body',async()=>{
    expect(await headersOnly('lookups',11*1024*1024,false)).toBe(401);expect(mocks.query).not.toHaveBeenCalled();
    mocks.admin=false;expect(await headersOnly('lookups',11*1024*1024)).toBe(403);
    mocks.admin=true;mocks.revoked=true;expect(await headersOnly('lookups',11*1024*1024)).toBe(401);
    mocks.revoked=false;mocks.project=false;expect(await headersOnly('lookups',11*1024*1024)).toBe(404);expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects an authorized capture above 256 MiB from headers alone',async()=>{
    expect(await headersOnly('lookups',256*1024*1024+1)).toBe(413);expect(mocks.create).not.toHaveBeenCalled();
  });
  it('admits a bounded snapshot larger than the ordinary JSON limit without broadening the parser endpoint',async()=>{
    const snapshot=syntheticLookupSnapshot(projectId,modelId,'a'.repeat(64));
    snapshot.objects[0].properties=Array.from({length:100},(_,index)=>({category:'Fixture',name:String(index),value:'x'.repeat(2048)}));
    const body=JSON.stringify({routeText:'/BC001',reverse:false,expectedSelectionRevision:'3',snapshot});expect(Buffer.byteLength(body)).toBeGreaterThan(100*1024);
    const response=await fetch(origin+`/api/projects/${projectId}/pathfinder/lookups`,{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body});
    expect(response.status).toBe(202);expect(mocks.create).toHaveBeenCalledTimes(1);expect(mocks.create.mock.calls[0][2].snapshot.objects[0].properties).toHaveLength(100);
    const small=await fetch(origin+`/api/projects/${projectId}/pathfinder/lookups/plan`,{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body});
    expect(small.status).toBe(413);expect(mocks.plan).not.toHaveBeenCalled();
  });
});
