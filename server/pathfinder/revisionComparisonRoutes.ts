import express, { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { policyUuidSchema, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { REVISION_COMPARISON_LIMITS, revisionComparisonCreateSchema, revisionComparisonDecisionWriteSchema, revisionComparisonErrorSchema } from '../../shared/pathfinderRevisionComparison.js';
import { verifyAccessToken } from '../auth.js';
import { requestPrincipal } from './auth.js';
import { PathFinderError } from './errors.js';
import { parsePolicyJson } from './policyJson.js';
import type { RevisionComparisonRepository } from './revisionComparisonRepository.js';

export function sendRevisionComparisonError(res: Response, error: unknown): void {
  const rawStatus = (error as { status?: number } | null)?.status;
  const safe = error instanceof PathFinderError ? error
    : error instanceof z.ZodError || rawStatus === 400 ? new PathFinderError('INVALID_REVISION_COMPARISON_REQUEST',400,'The revision comparison request is invalid.')
    : rawStatus === 413 ? new PathFinderError('REVISION_COMPARISON_BODY_LIMIT',413,'The comparison request exceeds its limit.')
    : rawStatus === 415 ? new PathFinderError('REVISION_COMPARISON_ENCODING_UNSUPPORTED',415,'Use uncompressed UTF-8 application/json.')
    : new PathFinderError('REVISION_COMPARISON_OUTCOME_UNKNOWN',500,'The comparison operation could not be confirmed. Retain its exact command for reconciliation.');
  res.setHeader('Cache-Control','private, no-store');
  res.status(safe.status).json(revisionComparisonErrorSchema.parse({schemaVersion:'wfc.pf.revision-comparison-error.v1',code:safe.code,message:safe.message,outcome:safe.status>=500?'unknown':'refused'}));
}
const offset = z.string().refine(v=>/^(?:0|[1-9][0-9]{0,6})$/.exec(v)?.[0]===v&&Number(v)<=1_000_000).transform(Number);
const limit = z.string().refine(v=>/^(?:[1-9]|[1-9][0-9]|100)$/.exec(v)?.[0]===v).transform(Number);
const ids = z.string().max(3700).transform(v=>v.split(',')).pipe(z.array(policyUuidSchema).min(1).max(100).refine(v=>new Set(v).size===v.length));
export const revisionDecisionHeadQuerySchema = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('object-mapping'),sourceObjectRevisionIds:ids}).strict(),
  z.object({kind:z.literal('frame-mapping')}).strict(),
  z.object({kind:z.literal('binding-frame-qualification'),sourceBindingId:policyUuidSchema}).strict(),
]);

/** Mount before generic JSON. Every malformed/case-varied owned suffix stays guarded. */
export function createRevisionComparisonRouter(_pool: Pool, repository: RevisionComparisonRepository): Router {
  const router=Router({mergeParams:true,caseSensitive:true});
  const project=(req:Request)=>policyUuidSchema.parse(req.params.projectId),comparison=(req:Request)=>policyUuidSchema.parse(req.params.comparisonId);
  router.use(async(req,res,next)=>{
    if(!/^\/revision-comparisons(?:\/|$)/i.test(req.path)){next('router');return;}
    res.setHeader('Cache-Control','private, no-store');const bearer=/^Bearer\s+(\S+)$/i.exec((req.header('authorization')??'').trim())?.[1];
    if(!bearer){sendRevisionComparisonError(res,new PathFinderError('AUTHENTICATION_REQUIRED',401));return;}
    try{const p=verifyAccessToken(bearer);req.userId=policyUuidSchema.parse(p.sub);req.loginId=policyUuidSchema.parse(p.jti);if(!Number.isSafeInteger(p.exp))throw Error('expiry');req.loginExpiresAt=p.exp!*1000;}
    catch{sendRevisionComparisonError(res,new PathFinderError('LOGIN_REVOKED',401));return;}
    try{
      await repository.authorize(project(req),requestPrincipal(req));
      if(['POST','PUT','PATCH'].includes(req.method)){
        const length=req.header('content-length');
        if(length!==undefined&&(!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(length)||BigInt(length)>BigInt(REVISION_COMPARISON_LIMITS.controlBytes))){res.setHeader('Connection','close');throw new PathFinderError('REVISION_COMPARISON_BODY_LIMIT',413);}
        if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.header('content-type')??''))throw new PathFinderError('REVISION_COMPARISON_CONTENT_TYPE_REQUIRED',415);
        if((req.header('content-encoding')??'identity').toLowerCase()!=='identity')throw new PathFinderError('REVISION_COMPARISON_ENCODING_UNSUPPORTED',415);
      }next();
    }catch(error){sendRevisionComparisonError(res,error);}
  });
  const empty=(req:Request)=>z.object({}).strict().parse(req.query);
  const body=(req:Request)=>{if(!Buffer.isBuffer(req.body))throw new PathFinderError('INVALID_REVISION_COMPARISON_REQUEST',400);return parsePolicyJson(req.body,{maxBytes:REVISION_COMPARISON_LIMITS.controlBytes});};
  const raw=express.raw({type:()=>true,limit:REVISION_COMPARISON_LIMITS.controlBytes,inflate:false});
  const read=(operation:(req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{try{res.json(await operation(req));}catch(error){sendRevisionComparisonError(res,error);}};
  const write=(operation:(req:Request,signal:AbortSignal)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
    const controller=new AbortController(),closed=()=>{if(!res.writableEnded)controller.abort();};res.once('close',closed);
    try{empty(req);res.json(await operation(req,controller.signal));}catch(error){if(!res.destroyed)sendRevisionComparisonError(res,error);}finally{res.removeListener('close',closed);}
  };
  router.get('/revision-comparisons/context',read(req=>{empty(req);return repository.context(project(req),requestPrincipal(req));}));
  router.get('/revision-comparisons',read(req=>repository.list(project(req),requestPrincipal(req),z.object({offset:offset.optional(),limit:limit.optional()}).strict().parse(req.query))));
  router.post('/revision-comparisons',raw,write((req,signal)=>repository.create(project(req),requestPrincipal(req),revisionComparisonCreateSchema.parse(body(req)),signal)));
  router.get('/revision-comparisons/:comparisonId',read(req=>{empty(req);return repository.get(project(req),requestPrincipal(req),comparison(req));}));
  router.get('/revision-comparisons/:comparisonId/changes',read(req=>repository.changes(project(req),requestPrincipal(req),comparison(req),z.object({offset:offset.optional(),limit:limit.optional()}).strict().parse(req.query))));
  router.get('/revision-comparisons/:comparisonId/decisions',read(req=>repository.history(project(req),requestPrincipal(req),comparison(req),z.object({beforeRevision:policyRevisionSchema.optional(),limit:limit.optional()}).strict().parse(req.query))));
  router.get('/revision-comparisons/:comparisonId/decision-head',read(req=>repository.decisionHead(project(req),requestPrincipal(req),comparison(req),revisionDecisionHeadQuerySchema.parse(req.query))));
  router.post('/revision-comparisons/:comparisonId/decisions',raw,write((req,signal)=>repository.decide(project(req),requestPrincipal(req),comparison(req),revisionComparisonDecisionWriteSchema.parse(body(req)),signal)));
  router.use((_req,res)=>sendRevisionComparisonError(res,new PathFinderError('REVISION_COMPARISON_METHOD_UNSUPPORTED',405)));
  router.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>sendRevisionComparisonError(res,error));return router;
}
