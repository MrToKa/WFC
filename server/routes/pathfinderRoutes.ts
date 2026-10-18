import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware.js';
import { artifactSchema, bindLocationSchema, createLocationSchema, revision, uuid } from '../pathfinder/contracts.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { createPathFinderRepository } from '../pathfinder/repository.js';
import { getPathFinderRuntime } from '../pathfinder/runtime.js';
import { applySchema, createJobSchema, lookupSchema, lookupPlanSchema, reviewSchema } from '../pathfinder/jobContracts.js';
import { principalTransaction, requestPrincipal as principal } from '../pathfinder/auth.js';
import { previewSchema } from '../pathfinder/previews.js';

export const pathfinderRouter = Router({mergeParams:true});
pathfinderRouter.use(requireAdmin,(_req,res,next) => {res.setHeader('Cache-Control','private, no-store'); next();});
const repository = createPathFinderRepository(pool);
function identity(req: Request): {projectId:string;actorId:string} {
  return {projectId:uuid.parse(req.params.projectId),actorId:uuid.parse(req.userId)};
}
function failure(res: Response,error: unknown): void {
  if (error instanceof z.ZodError) {res.status(400).json({code:'INVALID_PATHFINDER_REQUEST',error:'Invalid PathFinder request.'}); return;}
  const safe = error instanceof PathFinderError ? error : new PathFinderError('PATHFINDER_FAILURE',500,'PathFinder operation failed.');
  if (!(error instanceof PathFinderError)) console.error('PathFinder operation failed',error);
  res.status(safe.status).json({code:safe.code,error:safe.message});
}
/** Body-free proxy preflight uses exactly the same current-principal boundary as PF writes. */
pathfinderRouter.get('/authorization',async(req,res)=>{
  try {const {projectId}=identity(req);await principalTransaction(pool,projectId,principal(req),async()=>undefined);res.status(204).end();}catch(error){failure(res,error);}
});
pathfinderRouter.get('/state',async (req,res) => {
  try {const {projectId} = identity(req); res.json({...await repository.state(projectId,principal(req)),...await getPathFinderRuntime().jobs.state(projectId,principal(req))});} catch(error){failure(res,error);}
});
pathfinderRouter.post('/locations',async (req,res) => {
  try {const {projectId} = identity(req); res.status(201).json(await repository.createLocation(projectId,principal(req),createLocationSchema.parse(req.body)));} catch(error){failure(res,error);}
});
pathfinderRouter.put('/locations/:locationId/binding',async (req,res) => {
  try {const {projectId} = identity(req); res.json(await repository.bindLocation(projectId,principal(req),uuid.parse(req.params.locationId),bindLocationSchema.parse(req.body)));} catch(error){failure(res,error);}
});
pathfinderRouter.put('/locations/:locationId',async (req,res) => {
  try {const {projectId} = identity(req); res.json(await repository.updateLocation(projectId,principal(req),uuid.parse(req.params.locationId),createLocationSchema.parse(req.body)));} catch(error){failure(res,error);}
});
pathfinderRouter.post('/artifacts',async (req,res) => {
  try {const {projectId} = identity(req); res.status(201).json(await repository.ingestArtifact(projectId,principal(req),artifactSchema.parse(req.body)));} catch(error){failure(res,error);}
});
const matchSchema = z.object({expectedRegistryRevision:revision}).strict();
pathfinderRouter.post('/match',async (req,res) => {
  try {const {projectId} = identity(req); res.json(await repository.match(projectId,principal(req),matchSchema.parse(req.body).expectedRegistryRevision));} catch(error){failure(res,error);}
});
pathfinderRouter.post('/jobs',async (req,res) => {
  try {const {projectId} = identity(req); res.status(202).json(await getPathFinderRuntime().jobs.create(projectId,principal(req),createJobSchema.parse(req.body)));} catch(error){failure(res,error);}
});
pathfinderRouter.get('/jobs/:jobId',async (req,res) => {
  try {const {projectId} = identity(req); res.json(await getPathFinderRuntime().jobs.get(projectId,principal(req),uuid.parse(req.params.jobId)));} catch(error){failure(res,error);}
});
pathfinderRouter.delete('/jobs/:jobId',async (req,res) => {
  try {const {projectId} = identity(req); res.json(await getPathFinderRuntime().jobs.cancel(projectId,principal(req),uuid.parse(req.params.jobId)));} catch(error){failure(res,error);}
});
pathfinderRouter.get('/proposals/:proposalId',async (req,res) => {
  try {const {projectId} = identity(req); res.json(await getPathFinderRuntime().jobs.proposal(projectId,principal(req),uuid.parse(req.params.proposalId)));} catch(error){failure(res,error);}
});
pathfinderRouter.post('/proposals/:proposalId/review',async (req,res) => {
  try {const {projectId} = identity(req); res.json(await getPathFinderRuntime().jobs.review(projectId,principal(req),uuid.parse(req.params.proposalId),reviewSchema.parse(req.body).expectedProposalHash));} catch(error){failure(res,error);}
});
pathfinderRouter.post('/proposals/:proposalId/apply',async (req,res) => {
  try {const {projectId} = identity(req); res.json(await getPathFinderRuntime().apply(projectId,principal(req),uuid.parse(req.params.proposalId),applySchema.parse(req.body)));} catch(error){failure(res,error);}
});
pathfinderRouter.post('/lookups/plan',async(req,res)=>{
  const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if (!res.writableEnded) controller.abort();};
  req.once('aborted',abort);res.once('close',closed);
  try {const {projectId}=identity(req);res.json(await getPathFinderRuntime().lookups.plan(projectId,principal(req),lookupPlanSchema.parse(req.body),controller.signal));}catch(error){failure(res,error);}
  finally {req.off('aborted',abort);res.off('close',closed);}
});
pathfinderRouter.post('/lookups',async (req,res) => {
  try {const {projectId}=identity(req);res.status(202).json(await getPathFinderRuntime().lookups.create(projectId,principal(req),lookupSchema.parse(req.body)));} catch(error){failure(res,error);}
});
pathfinderRouter.get('/lookups/:jobId',async (req,res) => {
  try {const {projectId}=identity(req);res.json(await getPathFinderRuntime().lookups.get(projectId,principal(req),uuid.parse(req.params.jobId)));} catch(error){failure(res,error);}
});
pathfinderRouter.post('/previews',async (req,res) => {
  try {const {projectId}=identity(req);res.status(202).json(await getPathFinderRuntime().previews.create(projectId,principal(req),previewSchema.parse(req.body)));} catch(error){failure(res,error);}
});
pathfinderRouter.get('/previews/:jobId',async (req,res) => {
  try {const {projectId}=identity(req);res.json(await getPathFinderRuntime().previews.get(projectId,principal(req),uuid.parse(req.params.jobId)));} catch(error){failure(res,error);}
});
