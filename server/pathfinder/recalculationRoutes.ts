import express,{Router,type Request,type Response,type NextFunction} from 'express';
import type {Pool} from 'pg';
import {z} from 'zod';
import {RECALCULATION_LIMITS,recalculationCommandSchema,recalculationErrorSchema} from '../../shared/pathfinderRecalculation.js';
import {policyUuidSchema} from '../../shared/pathfinderPurposePolicy.js';
import {verifyAccessToken} from '../auth.js';
import {requestPrincipal} from './auth.js';
import {PathFinderError} from './errors.js';
import {parsePolicyJson} from './policyJson.js';
import type {RecalculationRepository} from './recalculationRepository.js';

export function sendRecalculationError(res:Response,error:unknown):void{
  const status=(error as {status?:number}|null)?.status;
  const safe=error instanceof PathFinderError?error:error instanceof z.ZodError||status===400?new PathFinderError('INVALID_RECALCULATION_REQUEST',400,'The recalculation command is invalid.'):
    status===413?new PathFinderError('RECALCULATION_BODY_LIMIT',413,'The recalculation command exceeds its limit.'):status===415?new PathFinderError('RECALCULATION_ENCODING_UNSUPPORTED',415,'Use uncompressed UTF-8 application/json.'):
    new PathFinderError('RECALCULATION_OUTCOME_UNKNOWN',500,'The command could not be confirmed. Retain its exact body and key, then reconcile.');
  res.setHeader('Cache-Control','private, no-store');res.status(safe.status).json(recalculationErrorSchema.parse({schemaVersion:'wfc.pf.recalculation-error.v1',code:safe.code,message:safe.message,outcome:safe.status>=500?'unknown':'refused',currentControlRevision:null}));
}
/** Mount under the project Path Finder prefix BEFORE the generic JSON parser. */
export function createRecalculationRouter(_pool:Pool,repository:RecalculationRepository):Router{
  const router=Router({mergeParams:true,caseSensitive:true});const project=(req:Request)=>policyUuidSchema.parse(req.params.projectId);
  router.use(async(req,res,next)=>{
    if(!/^\/recalculations(?:\/|$)/i.test(req.path)){next('router');return;}
    res.setHeader('Cache-Control','private, no-store');const bearer=/^Bearer\s+(\S+)$/i.exec((req.header('authorization')??'').trim())?.[1];
    if(!bearer){sendRecalculationError(res,new PathFinderError('AUTHENTICATION_REQUIRED',401));return;}
    try{const payload=verifyAccessToken(bearer);req.userId=policyUuidSchema.parse(payload.sub);req.loginId=policyUuidSchema.parse(payload.jti);if(!Number.isSafeInteger(payload.exp))throw new Error('Invalid expiry.');req.loginExpiresAt=payload.exp!*1000;}
    catch{sendRecalculationError(res,new PathFinderError('LOGIN_REVOKED',401));return;}
    try{
      await repository.authorize(project(req),requestPrincipal(req));
      if(['POST','PUT','PATCH'].includes(req.method)){
        const length=req.header('content-length');if(length!==undefined&&(!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(length)||BigInt(length)>BigInt(RECALCULATION_LIMITS.controlBytes))){res.setHeader('Connection','close');throw new PathFinderError('RECALCULATION_BODY_LIMIT',413);}
        if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.header('content-type')??''))throw new PathFinderError('RECALCULATION_CONTENT_TYPE_REQUIRED',415);
        if((req.header('content-encoding')??'identity').toLowerCase()!=='identity')throw new PathFinderError('RECALCULATION_ENCODING_UNSUPPORTED',415);
      }next();
    }catch(error){sendRecalculationError(res,error);}
  });
  const empty=(req:Request)=>z.object({}).strict().parse(req.query);
  router.get('/recalculations/context',async(req,res)=>{try{empty(req);res.json(await repository.context(project(req),requestPrincipal(req)));}catch(error){sendRecalculationError(res,error);}});
  router.post('/recalculations/commands',express.raw({type:()=>true,limit:RECALCULATION_LIMITS.controlBytes,inflate:false}),async(req,res)=>{
    const controller=new AbortController(),close=()=>{if(!res.writableEnded)controller.abort();};res.once('close',close);
    try{empty(req);if(!Buffer.isBuffer(req.body))throw new PathFinderError('INVALID_RECALCULATION_REQUEST',400);const command=recalculationCommandSchema.parse(parsePolicyJson(req.body,{maxBytes:RECALCULATION_LIMITS.controlBytes}));res.json(await repository.command(project(req),requestPrincipal(req),command,controller.signal));}
    catch(error){if(!res.destroyed)sendRecalculationError(res,error);}finally{res.removeListener('close',close);}
  });
  router.use((_req,res)=>sendRecalculationError(res,new PathFinderError('RECALCULATION_METHOD_UNSUPPORTED',405)));
  router.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>sendRecalculationError(res,error));return router;
}
