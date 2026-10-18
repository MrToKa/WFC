import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware.js';
import { artifactSchema, bindLocationSchema, createLocationSchema, revision, uuid } from '../pathfinder/contracts.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { createPathFinderRepository } from '../pathfinder/repository.js';

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
pathfinderRouter.get('/state',async (req,res) => {
  try {const {projectId,actorId} = identity(req); res.json(await repository.state(projectId,actorId));} catch(error){failure(res,error);}
});
pathfinderRouter.post('/locations',async (req,res) => {
  try {const {projectId,actorId} = identity(req); res.status(201).json(await repository.createLocation(projectId,actorId,createLocationSchema.parse(req.body)));} catch(error){failure(res,error);}
});
pathfinderRouter.put('/locations/:locationId/binding',async (req,res) => {
  try {const {projectId,actorId} = identity(req); res.json(await repository.bindLocation(projectId,actorId,uuid.parse(req.params.locationId),bindLocationSchema.parse(req.body)));} catch(error){failure(res,error);}
});
pathfinderRouter.put('/locations/:locationId',async (req,res) => {
  try {const {projectId,actorId} = identity(req); res.json(await repository.updateLocation(projectId,actorId,uuid.parse(req.params.locationId),createLocationSchema.parse(req.body)));} catch(error){failure(res,error);}
});
pathfinderRouter.post('/artifacts',async (req,res) => {
  try {const {projectId,actorId} = identity(req); res.status(201).json(await repository.ingestArtifact(projectId,actorId,artifactSchema.parse(req.body)));} catch(error){failure(res,error);}
});
const matchSchema = z.object({expectedRegistryRevision:revision}).strict();
pathfinderRouter.post('/match',async (req,res) => {
  try {const {projectId,actorId} = identity(req); res.json(await repository.match(projectId,actorId,matchSchema.parse(req.body).expectedRegistryRevision));} catch(error){failure(res,error);}
});
