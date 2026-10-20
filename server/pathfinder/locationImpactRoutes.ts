import type { Request,Response } from 'express';
import { z } from 'zod';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { requestPrincipal } from './auth.js';
import { PathFinderError } from './errors.js';
import type { LocationImpactRepository } from './locationImpactRepository.js';

const pageQuery=z.object({beforeId:policyUuidSchema.optional(),limit:z.coerce.number().int().min(1).max(100).optional()}).strict();
/** Bounded authenticated GETs; no schema initialization, engine invocation or full-state projection. */
export function createLocationImpactReadHandlers(repository:Pick<LocationImpactRepository,'progress'|'list'>){
  const handle=(read:(req:Request,signal:AbortSignal)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
    const controller=new AbortController(),disconnected=()=>controller.abort(),closed=()=>{if(!res.writableEnded)controller.abort();};
    let timer:ReturnType<typeof setTimeout>|undefined;
    const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{const error=new PathFinderError('LOCATION_IMPACT_READ_DEADLINE',503);controller.abort(error);reject(error);},15000);});
    req.once('aborted',disconnected);res.once('close',closed);res.setHeader('Cache-Control','private, no-store');
    try{
      const value=await Promise.race([read(req,controller.signal),expired]);controller.signal.throwIfAborted();
      if(Buffer.byteLength(JSON.stringify(value))>1024*1024)throw new PathFinderError('LOCATION_IMPACT_RESPONSE_LIMIT',413);
      if(!res.destroyed&&!res.writableEnded)res.json(value);
    }catch(error){
      const safe=error instanceof PathFinderError?error:error instanceof z.ZodError?new PathFinderError('INVALID_LOCATION_IMPACT_REQUEST',400):new PathFinderError('LOCATION_IMPACT_READ_UNAVAILABLE',503);
      if(!res.destroyed&&!res.writableEnded)res.status(safe.status).json({code:safe.code,error:safe.status===401?'Sign in again.':safe.status===403?'Administrator access required.':'Affected cable progress is unavailable. Refresh the current calculation.'});
    }finally{if(timer)clearTimeout(timer);req.removeListener('aborted',disconnected);res.removeListener('close',closed);}
  };
  return {list:handle((req,signal)=>repository.list(policyUuidSchema.parse(req.params.projectId),requestPrincipal(req),pageQuery.parse(req.query),signal)),
    progress:handle((req,signal)=>{z.object({}).strict().parse(req.query);return repository.progress(policyUuidSchema.parse(req.params.projectId),requestPrincipal(req),policyUuidSchema.parse(req.params.impactId),signal);})};
}
