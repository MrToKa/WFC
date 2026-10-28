// @vitest-environment node
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import type {Pool} from 'pg';
import type {Response} from 'express';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createCalculationGrantRouter,sendCalculationGrantError} from './calculationGrantRoutes.js';
import type {CalculationGrantRepository} from './calculationGrantRepository.js';
import {CALCULATION_GRANT_LIMITS} from '../../shared/pathfinderCalculationGrant.js';
import {PathFinderError} from './errors.js';
const mocks=vi.hoisted(()=>({verify:vi.fn(),authorize:vi.fn(),context:vi.fn(),command:vi.fn()}));
vi.mock('../auth.js',()=>({verifyAccessToken:mocks.verify}));
const id=(n:number)=>`ea800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const command=()=>({schemaVersion:'wfc.pf.calculation-grant-command.v1',action:'enable',expectedControlRevision:'0',idempotencyKey:id(4),reason:'Synthetic explicit grant activation',preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeoutMilliseconds:60000});
beforeEach(()=>{vi.resetAllMocks();mocks.verify.mockReturnValue({sub:id(1),jti:id(2),exp:Math.floor(Date.now()/1000)+3600});mocks.authorize.mockResolvedValue(undefined);mocks.context.mockResolvedValue({synthetic:'context'});mocks.command.mockResolvedValue({synthetic:'command'});});
/** Express is invoked with in-memory streams only; no HTTP listener/network or database. */
function request({url='/calculation-grants/context',method='GET',token='Bearer synthetic',length,type='application/json',encoding,body,query={}}:
  {url?:string;method?:string;token?:string|null;length?:string;type?:string;encoding?:string;body?:string;query?:Record<string,string>}={}){
  const bytes=body===undefined?null:Buffer.from(body),headers:Record<string,string>={'content-type':type};if(token!==null)headers.authorization=token;if(length!==undefined)headers['content-length']=length;else if(bytes)headers['content-length']=String(bytes.length);if(encoding)headers['content-encoding']=encoding;
  const req=Object.assign(bytes?Readable.from([bytes]):{on:vi.fn(),once:vi.fn(),read:vi.fn(()=>{throw new Error('Body must remain unread.');})},
    {url,originalUrl:url,baseUrl:'',path:url,method,params:{projectId:id(3)},query,headers,header:(key:string)=>headers[key.toLowerCase()]}),
    res=Object.assign(new EventEmitter(),{locals:{},statusCode:200,writableEnded:false,destroyed:false,setHeader:vi.fn(),status(n:number){this.statusCode=n;return this;},json:vi.fn(),end:vi.fn()}),
    router=createCalculationGrantRouter({} as Pool,mocks as unknown as CalculationGrantRepository);
  const run=()=>new Promise<void>((resolve,reject)=>{res.json.mockImplementation(()=>{res.writableEnded=true;resolve();return res;});
    (router as unknown as {handle:(req:unknown,res:unknown,done:(error:unknown)=>void)=>void}).handle(req,res,error=>error?reject(error):resolve());});return{req,res,run};
}
describe('calculation grant human management boundaries',()=>{
  it('checks current human authority on GET and does not intercept other project operations',async()=>{
    const r=request();await r.run();expect(mocks.authorize).toHaveBeenCalledOnce();expect(mocks.context).toHaveBeenCalledWith(id(3),expect.objectContaining({userId:id(1),loginId:id(2)}));
    const other=request({url:'/recalculations/context'});await other.run();expect(other.res.json).not.toHaveBeenCalled();
  });
  it.each([null,'Bearer invalid'] as const)('denies unauthenticated grant creation before any oversized body read: %s',async token=>{
    if(token)mocks.verify.mockImplementation(()=>{throw new Error('Invalid token.');});const r=request({url:'/calculation-grants/commands',method:'POST',token,length:'99999999'});await r.run();
    expect(r.res.statusCode).toBe(401);expect(r.req.on).not.toHaveBeenCalled();expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it('denies current nonadmin before revealing command size',async()=>{
    mocks.authorize.mockRejectedValue(new PathFinderError('ADMIN_REQUIRED',403));const r=request({method:'POST',length:'99999999'});await r.run();expect(r.res.statusCode).toBe(403);expect(r.req.on).not.toHaveBeenCalled();
  });
  it.each(['01','-1','1\n',String(CALCULATION_GRANT_LIMITS.controlBytes+1)])('refuses invalid declared size %s before reading',async length=>{
    const r=request({url:'/calculation-grants/commands',method:'POST',length});await r.run();expect(r.res.statusCode).toBe(413);expect(r.req.on).not.toHaveBeenCalled();
  });
  it.each([{type:'text/plain'},{encoding:'gzip'}])('refuses noncanonical transport %j',async options=>{
    const r=request({url:'/calculation-grants/commands',method:'POST',...options});await r.run();expect(r.res.statusCode).toBe(415);expect(r.req.on).not.toHaveBeenCalled();
  });
  it.each(['duplicate','service-token','review','unlimited','actor','missing-preferences'] as const)('refuses strict %s management input',async kind=>{
    let body=JSON.stringify(command());if(kind==='duplicate')body=body.replace('{','{"\\u0072eason":"shadow",');if(kind==='service-token')body=JSON.stringify({...command(),ownerToken:'a'.repeat(64)});
    if(kind==='review')body=body.replace('"enable"','"review"');if(kind==='unlimited')body=body.replace('"timeoutMilliseconds":60000','"timeoutMilliseconds":120001');if(kind==='actor')body=JSON.stringify({...command(),issuerId:id(9)});
    if(kind==='missing-preferences'){const value=command() as Record<string,unknown>;delete value.preferences;body=JSON.stringify(value);}
    const r=request({url:'/calculation-grants/commands',method:'POST',body});await r.run();expect(r.res.statusCode).toBe(400);expect(mocks.command).not.toHaveBeenCalled();
  });
  it('passes only the exact strict command, authenticated principal and cancellation signal',async()=>{
    const input=command(),r=request({url:'/calculation-grants/commands',method:'POST',body:JSON.stringify(input)});await r.run();
    expect(mocks.command).toHaveBeenCalledExactlyOnceWith(id(3),expect.objectContaining({userId:id(1),loginId:id(2)}),input,expect.any(AbortSignal));
  });
  it('owns case-varied prefixes and denies unknown management query parameters',async()=>{
    const varied=request({url:'/Calculation-Grants/Context'});await varied.run();expect(varied.res.statusCode).toBe(405);
    for(const method of ['GET','POST']){const r=request({url:method==='GET'?'/calculation-grants/context':'/calculation-grants/commands',method,query:{authority:'foreign'},body:method==='POST'?JSON.stringify(command()):undefined});await r.run();expect(r.res.statusCode).toBe(400);}
  });
  it('reports unknown COMMIT honestly and omits private implementation details',()=>{
    for(const [error,status,outcome] of [[new Error('Private SQL and secret owner token'),500,'unknown'],[new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN',503),503,'unknown'],[new PathFinderError('ADMIN_REQUIRED',403),403,'refused']] as const){
      const r=request();sendCalculationGrantError(r.res as unknown as Response,error);expect(r.res.statusCode).toBe(status);expect(r.res.json.mock.calls[0][0].outcome).toBe(outcome);expect(JSON.stringify(r.res.json.mock.calls)).not.toContain('Private SQL');
    }
  });
});
