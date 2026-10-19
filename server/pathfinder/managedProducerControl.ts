import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import express,{Router} from 'express';
import {z} from 'zod';
import {validateEnvelope,type BridgeEnvelope} from '../../viewer-runtime/protocol.mjs';
import {policyUuidSchema,policyHashSchema,canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy.js';
import {parsePolicyJson} from './policyJson.js';
import {PathFinderError} from './errors.js';
import type {ProducerResourceIdentity} from './producerResourceService.js';
import {requireViewerOrigin,viewerHttpPolicy} from '../viewerSessions/http.js';

const identitySchema=z.object({instanceId:policyUuidSchema,projectId:policyUuidSchema,modelVersionId:policyUuidSchema,loadId:policyUuidSchema,sessionId:policyUuidSchema}).strict();
type Identity=z.infer<typeof identitySchema>;
const digest=(v:string)=>createHash('sha256').update(v).digest();
const fail=(code:string,status=409):never=>{throw new PathFinderError(code,status,'The private managed producer is unavailable or changed.');};
const commands=new Set(['READ_PREPARATION_OBJECTS','START_MODEL_CAPTURE','READ_MODEL_CAPTURE']);
export const MANAGED_CONTROL_LIMITS=Object.freeze({bodyBytes:96*1024,messages:4096,initializeMilliseconds:495000,operationMilliseconds:180000,joinMilliseconds:30000});
type Command={requestId:string;kind:'exchange';envelope:BridgeEnvelope}|{requestId:string;kind:'close'};
type Pending={command:Command;resolve(value:unknown):void;reject(error:unknown):void;timer:ReturnType<typeof setTimeout>};
type Attempt={id:string;identity:Identity;resources:ProducerResourceIdentity;authorize():Promise<void>;pending:Pending|null;
 replies:Map<string,string>;closing:boolean;joined:boolean;quarantined:boolean;containerId:string|null;messages:number;joinSha256?:string};
export type ManagedControlConfiguration={key:string;owner:string;project:string;image:string;runtimeInventorySha256:string};
/** Private installation worker transport only. It cannot create a grant,
 * choose a project/model, author locations, calculate, Review or Apply. */
export function createManagedProducerControl(configuration?:ManagedControlConfiguration){
  if(configuration&&(!/^[a-f0-9]{64}$/.test(configuration.key)||!policyUuidSchema.safeParse(configuration.owner).success||
    !/^wfc-pathfinder-local-[a-f0-9]{12}$/.test(configuration.project)||!/^sha256:[a-f0-9]{64}$/.test(configuration.image)||!policyHashSchema.safeParse(configuration.runtimeInventorySha256).success))fail('MANAGED_CONTROL_CONFIGURATION',503);
  let active:Attempt|undefined,stopped=false;
  const retained=new Map<string,Attempt>();
  const authorize=async(attempt:Attempt)=>{try{await attempt.authorize();}catch(error){
    attempt.closing=true;const pending=attempt.pending;
    if(pending?.command.kind==='exchange'){clearTimeout(pending.timer);attempt.pending=null;pending.reject(error);}
    throw error;
  }};
  const check=async(id?:string,cleanup=false)=>{if(stopped||!configuration) return fail('MANAGED_PRODUCER_NOT_CONFIGURED',503);
    const attempt=id?retained.get(id):active;
    if(!attempt)return fail('MANAGED_PRODUCER_ATTEMPT_NOT_FOUND',404);if(!cleanup)await authorize(attempt);return attempt;};
  const service={
    get configured(){return Boolean(configuration)&&!stopped;},
    get snapshot(){return{configured:this.configured,attemptId:active?.id??null,quarantined:active?.quarantined??false,joined:active?.joined??false};},
    authenticate(value:unknown){if(!configuration||typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)||!timingSafeEqual(digest(value),digest(configuration.key)))fail('MANAGED_CONTROL_AUTH_REQUIRED',401);},
    async register(input:{identity:Identity;resources:ProducerResourceIdentity;authorize():Promise<void>}){
      if(!this.configured||active&&!active.joined)return fail('MANAGED_PRODUCER_BUSY',503);
      const identity=identitySchema.parse(input.identity);
      if(identity.projectId!==input.resources.projectId||identity.modelVersionId!==input.resources.modelVersionId||identity.sessionId!==input.resources.sessionId)fail('MANAGED_PRODUCER_SCOPE_INVALID');
      await input.authorize();
      if(active&&!active.joined)return fail('MANAGED_PRODUCER_BUSY',503);
      if(retained.size>=16){const oldest=[...retained.values()].find(value=>value.joined);if(!oldest)return fail('MANAGED_PRODUCER_RETENTION_LIMIT',503);retained.delete(oldest.id);}
      const attempt:Attempt={id:randomUUID(),identity:Object.freeze(identity),resources:{...input.resources},authorize:input.authorize,pending:null,replies:new Map(),closing:false,joined:false,quarantined:false,containerId:null,messages:0};active=attempt;retained.set(attempt.id,attempt);
      const enqueue=async(kind:'exchange'|'close',envelope?:BridgeEnvelope)=>{
        if(active!==attempt||attempt.pending||attempt.joined||kind==='exchange'&&(attempt.quarantined||attempt.closing))return fail('MANAGED_PRODUCER_STATE_INVALID');
        if(kind!=='close')await authorize(attempt);
        if(active!==attempt||attempt.pending||attempt.joined||kind==='exchange'&&(attempt.quarantined||attempt.closing))return fail('MANAGED_PRODUCER_STATE_INVALID');
        if(kind==='exchange'&&++attempt.messages>MANAGED_CONTROL_LIMITS.messages)return fail('MANAGED_PRODUCER_MESSAGE_LIMIT',413);
        const command:Command=kind==='close'?{requestId:randomUUID(),kind}:{requestId:envelope!.requestId,kind,envelope:envelope!};
        // The first exchange is queued before the host can create and initialize
        // the isolated SDK. Give that one operation a separate bounded startup
        // allowance: 45s Docker startup plus the managed client's 450s bound
        // for sequential HELLO/INIT/LOAD. Including this first 180s exchange is
        // 675s, within the independent 15-minute helper/lease wall limits.
        // Later operations retain their ordinary data deadline.
        const timeout=kind==='close'?MANAGED_CONTROL_LIMITS.joinMilliseconds:MANAGED_CONTROL_LIMITS.operationMilliseconds+(attempt.messages===1?MANAGED_CONTROL_LIMITS.initializeMilliseconds:0);
        const reply=new Promise<unknown>((resolve,reject)=>{const timer=setTimeout(()=>{attempt.quarantined=true;attempt.pending=null;reject(new PathFinderError('MANAGED_PRODUCER_OUTCOME_UNKNOWN',503));},timeout);timer.unref();attempt.pending={command,resolve,reject,timer};});
        return reply;
      };
      let closing:Promise<{joined:true}>|undefined;
      return{attemptId:attempt.id,identity:attempt.identity,
        async exchange(envelope:BridgeEnvelope){if(!validateEnvelope(envelope,'parent-to-frame')||!commands.has(envelope.type)||['instanceId','projectId','modelVersionId','loadId'].some(key=>envelope[key as keyof BridgeEnvelope]!==identity[key as keyof Identity]))return fail('MANAGED_PRODUCER_COMMAND_INVALID');return enqueue('exchange',envelope);},
        close():Promise<{joined:true}>{return closing??=(async()=>{attempt.closing=true;if(attempt.joined)return{joined:true};
          // Superseded data cannot be acknowledged as cleanup. Cancel its waiter
          // while retaining the exact attempt for the host's independent join.
          if(attempt.pending?.command.kind==='exchange'){const prior=attempt.pending;clearTimeout(prior.timer);attempt.pending=null;prior.reject(new PathFinderError('MANAGED_CAPTURE_CLOSED',409));}
          await enqueue('close');if(!attempt.joined)return fail('MANAGED_PRODUCER_JOIN_UNKNOWN',503);return{joined:true};})();},
      };
    },
    async claim(){if(!active||active.joined||active.quarantined)return null;const attempt=await check();if(attempt.joined||attempt.quarantined)return null;
      return{attemptId:attempt.id,identity:attempt.identity,resources:attempt.resources,owner:configuration!.owner,project:configuration!.project,image:configuration!.image,runtimeInventorySha256:configuration!.runtimeInventorySha256};},
    async next(id:string){const attempt=await check(policyUuidSchema.parse(id),true);if(attempt.pending?.command.kind!=='close')await authorize(attempt);return{command:attempt.pending?.command??null,quarantined:attempt.quarantined,joined:attempt.joined};},
    async reply(id:string,raw:unknown){
      const attempt=await check(policyUuidSchema.parse(id),true),input=z.object({requestId:policyUuidSchema,value:z.unknown()}).strict().parse(raw),sha=createHash('sha256').update(canonicalPurposeJson(input)).digest('hex');
      const previous=attempt.replies.get(input.requestId);if(previous){if(previous!==sha)return fail('MANAGED_PRODUCER_REPLY_CONFLICT');return{acknowledged:true,duplicate:true};}
      const pending=attempt.pending;if(!pending||pending.command.requestId!==input.requestId)return fail('MANAGED_PRODUCER_REPLY_INVALID');
      if(pending.command.kind==='exchange'){
        await authorize(attempt);
        if(attempt.pending!==pending||attempt.quarantined||attempt.closing)return fail('MANAGED_PRODUCER_REPLY_INVALID');
        const response=validateEnvelope(input.value,'frame-to-parent');if(!response||response.requestId!==input.requestId||['instanceId','projectId','modelVersionId','loadId'].some(key=>response[key as keyof BridgeEnvelope]!==attempt.identity[key as keyof Identity]))return fail('MANAGED_PRODUCER_REPLY_INVALID');
      }else{
        const joined=z.object({joined:z.literal(true),removed:z.literal(true),containerId:z.string().length(64).regex(/^[a-f0-9]{64}$/)}).strict().parse(input.value);
        attempt.joined=true;attempt.containerId=joined.containerId;
      }
      // Recheck after parsing and before acknowledging a private worker result.
      if(pending.command.kind!=='close')await authorize(attempt);
      const after=attempt.replies.get(input.requestId);if(after){if(after!==sha)return fail('MANAGED_PRODUCER_REPLY_CONFLICT');return{acknowledged:true,duplicate:true};}
      if(attempt.pending!==pending||pending.command.kind==='exchange'&&attempt.quarantined)return fail('MANAGED_PRODUCER_REPLY_INVALID');
      attempt.replies.set(input.requestId,sha);clearTimeout(pending.timer);attempt.pending=null;pending.resolve(input.value);return{acknowledged:true,duplicate:false};
    },
    async joined(id:string,raw:unknown){
      const attempt=await check(policyUuidSchema.parse(id),true),proof=z.object({joined:z.literal(true),removed:z.literal(true),containerId:z.string().length(64).regex(/^[a-f0-9]{64}$/)}).strict().parse(raw);
      const sha=createHash('sha256').update(canonicalPurposeJson(proof)).digest('hex');
      if(attempt.joinSha256){if(attempt.joinSha256!==sha)return fail('MANAGED_PRODUCER_JOIN_CONFLICT');return{acknowledged:true,duplicate:true};}
      if(attempt.containerId&&attempt.containerId!==proof.containerId)return fail('MANAGED_PRODUCER_JOIN_CONFLICT');
      attempt.joinSha256=sha;attempt.containerId=proof.containerId;attempt.joined=true;attempt.closing=true;
      if(attempt.pending){const prior=attempt.pending;clearTimeout(prior.timer);attempt.pending=null;
        if(prior.command.kind==='close')prior.resolve(proof);else prior.reject(new PathFinderError('MANAGED_CAPTURE_CLOSED',409));}
      return{acknowledged:true,duplicate:false};
    },
    async fault(id:string){const attempt=await check(policyUuidSchema.parse(id),true);attempt.quarantined=true;
      // A data fault is not physical join evidence. Keep any cleanup waiter so
      // the independently stopped host can still supply its exact join proof.
      if(attempt.pending?.command.kind==='exchange'){clearTimeout(attempt.pending.timer);attempt.pending.reject(new PathFinderError('MANAGED_PRODUCER_OUTCOME_UNKNOWN',503));attempt.pending=null;}
      return{quarantined:true};},
    stop(){stopped=true;if(active?.pending){clearTimeout(active.pending.timer);active.pending.reject(new PathFinderError('MANAGED_PRODUCER_OUTCOME_UNKNOWN',503));active.pending=null;}if(active&&!active.joined)active.quarantined=true;},
  };return service;
}
export type ManagedProducerControl=ReturnType<typeof createManagedProducerControl>;
export function createManagedProducerControlRouter(service:ManagedProducerControl){
  const router=Router(),prefix='/api/pathfinder-producer-control',policy=viewerHttpPolicy();
  router.use((req,res,next)=>{
    if(!req.originalUrl.split('?')[0].startsWith(prefix)){next();return;}
    res.setHeader('Cache-Control','private, no-store');
    try{const names=req.rawHeaders.filter((_,index)=>index%2===0).filter(name=>name.toLowerCase()==='x-wfc-pf-control-key');
      if(names.length!==1||req.header('authorization')||req.header('cookie'))return fail('MANAGED_CONTROL_AUTH_REQUIRED',401);
      service.authenticate(req.header('x-wfc-pf-control-key'));requireViewerOrigin(req,policy,false);
      if(Object.keys(req.query).length)fail('MANAGED_CONTROL_REQUEST_INVALID',400);
      if(req.method==='POST'&&(req.header('content-type')!=='application/json'||(req.header('content-encoding')??'identity')!=='identity'))fail('MANAGED_CONTROL_REQUEST_INVALID',415);
      next();
    }catch(error){const e=error instanceof PathFinderError?error:new PathFinderError('MANAGED_CONTROL_AUTH_REQUIRED',401);res.status(e.status).json({code:e.code});}
  });
  router.get(prefix+'/claim',async(_req,res)=>{try{res.json({attempt:await service.claim()});}catch(error){res.status((error as PathFinderError).status??503).json({code:'MANAGED_CONTROL_UNAVAILABLE'});}});
  router.get(prefix+'/:attemptId/next',async(req,res)=>{try{res.json(await service.next(req.params.attemptId));}catch(error){res.status((error as PathFinderError).status??503).json({code:'MANAGED_CONTROL_UNAVAILABLE'});}});
  router.post(prefix+'/:attemptId/reply',express.raw({type:()=>true,limit:MANAGED_CONTROL_LIMITS.bodyBytes,inflate:false}),async(req,res)=>{
    try{if(!Buffer.isBuffer(req.body))return fail('MANAGED_CONTROL_REQUEST_INVALID',400);res.json(await service.reply(req.params.attemptId,parsePolicyJson(req.body,{maxBytes:MANAGED_CONTROL_LIMITS.bodyBytes})));}
    catch(error){res.status((error as PathFinderError).status??503).json({code:'MANAGED_CONTROL_REPLY_UNCONFIRMED'});}
  });
  router.post(prefix+'/:attemptId/fault',express.raw({type:()=>true,limit:128,inflate:false}),async(req,res)=>{try{if(!Buffer.isBuffer(req.body)||req.body.toString()!=='{}')return fail('MANAGED_CONTROL_REQUEST_INVALID',400);res.json(await service.fault(req.params.attemptId));}catch(error){res.status((error as PathFinderError).status??503).json({code:'MANAGED_CONTROL_UNAVAILABLE'});}});
  router.post(prefix+'/:attemptId/joined',express.raw({type:()=>true,limit:1024,inflate:false}),async(req,res)=>{try{if(!Buffer.isBuffer(req.body))return fail('MANAGED_CONTROL_REQUEST_INVALID',400);res.json(await service.joined(req.params.attemptId,parsePolicyJson(req.body,{maxBytes:1024})));}catch(error){res.status((error as PathFinderError).status??503).json({code:'MANAGED_CONTROL_JOIN_UNCONFIRMED'});}});
  // Claim the entire prefix so an unknown operation cannot fall through to a
  // human API, ordinary application write or a second body parser.
  router.use((req,res,next)=>{if(req.originalUrl.split('?')[0].startsWith(prefix))res.status(405).json({code:'MANAGED_CONTROL_METHOD_UNSUPPORTED'});else next();});
  return router;
}
