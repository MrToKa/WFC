import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { cadRouteGroupInputSchema, cadRouteGroupUpdateSchema, cadRouteGroupDeleteSchema, type CadRouteGroup } from '../../shared/cadRouteGroups.js';
import { pool } from '../db.js';
import { requireProjectEdit } from '../middleware.js';
import { PublicationError } from './routePublication.js';
import { synchronizeCadTrayExportsAfterTransfer } from './routeTrayExports.js';

export const cadRouteGroupsRouter = Router({ mergeParams: true });
const uuid = z.string().uuid();
const synchronizeTraysSchema = z.object({ expectedModelVersionId: uuid }).strict();
const sectionAssignmentSchema = z.object({
  instanceId: uuid,
  expectedRevision: z.number().int().positive().max(2147483646),
  sourceRouteId: uuid.nullable(),
  expectedSourceRevision: z.number().int().positive().max(2147483646).optional(),
}).strict().refine(value => value.sourceRouteId === null
  ? value.expectedSourceRevision === undefined : value.expectedSourceRevision !== undefined);
class RouteGroupError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
const safe = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    void handler(req,res).catch((error: unknown) => {
      if (error instanceof RouteGroupError) { res.status(error.status).json({ code: error.code }); return; }
      if (error instanceof PublicationError) { res.status(error.status).json({ code: error.code, message: error.message }); return; }
      const code = (error as { code?: string })?.code;
      if (code === '23505') { res.status(409).json({ code: 'CAD_ROUTE_TAG_OR_MEMBER_CONFLICT' }); return; }
      if (code === '23503' && (error as { constraint?: string }).constraint?.startsWith('cad_route_tray_exports')) {
        res.status(409).json({ code: 'CAD_ROUTE_TRAY_EXPORT_EXISTS', message: 'Remove the linked entry from the Trays list before removing this route group.' }); return;
      }
      if (code === '23503') { res.status(409).json({ code: 'CAD_ROUTE_MEMBERSHIP_CONFLICT' }); return; }
      if (code === '40P01' || code === '40001') { res.status(409).json({ code: 'CAD_DESIGN_CONFLICT' }); return; }
      next(error);
    });
  };
const routeSelect = `SELECT g.id,g.name,g.tag,g.color,g.purpose,g.revision,g.status,
  g.project_tray_id AS "projectTrayId",
  (SELECT e.tray_id FROM cad_route_tray_exports e
    WHERE e.project_id=g.project_id AND e.design_id=g.design_id AND e.route_group_id=g.id) AS "exportedTrayId",
  CASE WHEN g.status='published' THEN 'automatic' ELSE NULL END AS "networkMode",
  COALESCE((SELECT jsonb_agg(m.instance_id::text ORDER BY m.instance_id) FROM cad_route_group_members m
    WHERE m.project_id=g.project_id AND m.design_id=g.design_id AND m.route_group_id=g.id),'[]'::jsonb) AS "instanceIds"
  FROM cad_route_groups g`;
const validateParams = (req: Request): void => {
  if (![req.params.projectId,req.params.designId,...(req.params.routeId ? [req.params.routeId] : [])].every(value => uuid.safeParse(value).success))
    throw new RouteGroupError('INVALID_CAD_ROUTE_ID',400);
};
/** All writers, including publication, lock the design first. Selection and model
 * share locks preserve active healthy provenance until the transaction commits. */
export async function withCadRouteDesignTransaction<T>(projectId: string, designId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const design = await client.query(`SELECT d.id FROM cad_designs d
      JOIN project_model_selections s ON s.project_id=d.project_id AND s.active_model_version_id=d.model_version_id
      JOIN model_versions v ON v.project_id=d.project_id AND v.id=d.model_version_id
      WHERE d.project_id=$1 AND d.id=$2 AND d.status='proposed' AND v.state='ready' AND v.health='healthy'
      FOR UPDATE OF d FOR SHARE OF s,v`,[projectId,designId]);
    if (!design.rows[0]) throw new RouteGroupError('INACTIVE_DESIGN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
const readRoute = async (client: PoolClient, projectId: string, designId: string, id: string): Promise<CadRouteGroup> => {
  const result = await client.query<CadRouteGroup>(`${routeSelect} WHERE g.project_id=$1 AND g.design_id=$2 AND g.id=$3`,[projectId,designId,id]);
  if (!result.rows[0]) throw new RouteGroupError('CAD_ROUTE_NOT_FOUND',404);
  return result.rows[0];
};
async function validateMembers(client: PoolClient, projectId: string, designId: string, ids: string[], routeId: string): Promise<void> {
  const members = await client.query<{ id: string }>(`SELECT id FROM cad_design_instances
    WHERE project_id=$1 AND design_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR SHARE`,[projectId,designId,ids]);
  if (members.rows.length !== ids.length) throw new RouteGroupError('CAD_ROUTE_MEMBERS_NOT_IN_DESIGN',400);
  const assignments = await client.query(`SELECT instance_id FROM cad_route_group_members
    WHERE project_id=$1 AND instance_id=ANY($2::uuid[]) AND route_group_id<>$3 LIMIT 1`,[projectId,ids,routeId]);
  if (assignments.rows[0]) throw new RouteGroupError('CAD_INSTANCE_ALREADY_GROUPED');
}
async function replaceMembers(client: PoolClient, projectId: string, designId: string, routeId: string, ids: string[]): Promise<void> {
  // Keep retained membership rows intact: installation transitions reference
  // them with cascading FKs and must survive ordinary route metadata edits.
  await client.query(`DELETE FROM cad_route_group_members
    WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3 AND NOT (instance_id=ANY($4::uuid[]))`,[projectId,designId,routeId,ids]);
  await client.query(`INSERT INTO cad_route_group_members(project_id,design_id,route_group_id,instance_id)
    SELECT $1::uuid,$2::uuid,$3::uuid,value FROM unnest($4::uuid[]) AS value
    ON CONFLICT (route_group_id,instance_id) DO NOTHING`,[projectId,designId,routeId,ids]);
}
const touchDesign = (client: PoolClient, projectId: string, designId: string) => client.query('UPDATE cad_designs SET revision=revision+1,updated_at=now() WHERE project_id=$1 AND id=$2',[projectId,designId]);

cadRouteGroupsRouter.get('/designs/:designId/routes', safe(async (req,res) => {
  validateParams(req);
  const routes = await withCadRouteDesignTransaction(req.params.projectId,req.params.designId,async client => {
    const result = await client.query<CadRouteGroup>(`${routeSelect} WHERE g.project_id=$1 AND g.design_id=$2 ORDER BY g.created_at,g.id`,[req.params.projectId,req.params.designId]);
    return result.rows;
  });
  res.setHeader('Cache-Control','private, no-store');
  res.json({ routes });
}));
// Repair earlier saved draft projections before a new base network captures its
// catalogue. Context reads and the later immutable network proof stay read-only.
cadRouteGroupsRouter.post('/designs/:designId/synchronize-trays', requireProjectEdit, safe(async (req,res) => {
  validateParams(req);
  const parsed=synchronizeTraysSchema.safeParse(req.body);
  if(!parsed.success) throw new RouteGroupError('INVALID_CAD_TRAY_SYNCHRONIZATION',400);
  const {projectId,designId}=req.params;
  const result=await withCadRouteDesignTransaction(projectId,designId,async client=>{
    const design=(await client.query<{model_version_id:string}>('SELECT model_version_id FROM cad_designs WHERE project_id=$1 AND id=$2',[projectId,designId])).rows[0];
    if(!design||design.model_version_id.toLowerCase()!==parsed.data.expectedModelVersionId.toLowerCase()) throw new RouteGroupError('INACTIVE_DESIGN');
    const routes=(await client.query<{id:string}>(`SELECT g.id FROM cad_route_groups g JOIN cad_route_tray_exports e
      ON e.project_id=g.project_id AND e.design_id=g.design_id AND e.route_group_id=g.id
      WHERE g.project_id=$1 AND g.design_id=$2 AND g.status='draft' ORDER BY g.id LIMIT 1001 FOR UPDATE OF g`,[projectId,designId])).rows;
    if(routes.length>1000) throw new RouteGroupError('CAD_ROUTE_GROUP_LIMIT');
    for(const route of routes) await synchronizeCadTrayExportsAfterTransfer(client,projectId,designId,null,route.id,req.userId!);
    return {designId,modelVersionId:design.model_version_id,synchronizedRoutes:routes.length};
  });
  res.setHeader('Cache-Control','private, no-store');res.json(result);
}));
cadRouteGroupsRouter.post('/designs/:designId/routes', requireProjectEdit, safe(async (req,res) => {
  validateParams(req);
  const parsed = cadRouteGroupInputSchema.safeParse(req.body);
  if (!parsed.success) throw new RouteGroupError('INVALID_CAD_ROUTE',400);
  const value = parsed.data, projectId = req.params.projectId, designId = req.params.designId, id = randomUUID();
  const route = await withCadRouteDesignTransaction(projectId,designId,async client => {
    await validateMembers(client,projectId,designId,value.instanceIds,id);
    await client.query(`INSERT INTO cad_route_groups(id,project_id,design_id,name,tag,color,purpose,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[id,projectId,designId,value.name,value.tag,value.color,value.purpose,req.userId ?? null]);
    await replaceMembers(client,projectId,designId,id,value.instanceIds);
    await touchDesign(client,projectId,designId);
    return readRoute(client,projectId,designId,id);
  });
  res.setHeader('Cache-Control','private, no-store');
  res.status(201).json({ route });
}));
cadRouteGroupsRouter.post('/designs/:designId/routes/:routeId/sections', requireProjectEdit, safe(async (req,res) => {
  validateParams(req);
  const parsed = sectionAssignmentSchema.safeParse(req.body);
  if (!parsed.success) throw new RouteGroupError('INVALID_CAD_SECTION_ASSIGNMENT',400);
  const value = parsed.data, projectId = req.params.projectId, designId = req.params.designId, id = req.params.routeId;
  const route = await withCadRouteDesignTransaction(projectId,designId,async client => {
    const target = await readRoute(client,projectId,designId,id);
    if (target.revision !== value.expectedRevision) throw new RouteGroupError('STALE_CAD_ROUTE');
    if (target.status !== 'draft') throw new RouteGroupError('CAD_ROUTE_PUBLISHED');
    const instance = await client.query<{ id: string }>(`SELECT id FROM cad_design_instances
      WHERE project_id=$1 AND design_id=$2 AND id=$3 FOR SHARE`,[projectId,designId,value.instanceId]);
    if (!instance.rows[0]) throw new RouteGroupError('CAD_ROUTE_MEMBERS_NOT_IN_DESIGN',400);
    const membership = await client.query<{ routeGroupId: string }>(`SELECT route_group_id AS "routeGroupId" FROM cad_route_group_members
      WHERE project_id=$1 AND design_id=$2 AND instance_id=$3 FOR UPDATE`,[projectId,designId,value.instanceId]);
    const sourceId = membership.rows[0]?.routeGroupId ?? null;
    if (sourceId?.toLowerCase() !== value.sourceRouteId?.toLowerCase()) throw new RouteGroupError('STALE_CAD_SECTION_ASSIGNMENT');
    if (sourceId?.toLowerCase() === id.toLowerCase()) throw new RouteGroupError('CAD_SECTION_ALREADY_IN_ROUTE');
    if (target.instanceIds.length >= 200) throw new RouteGroupError('CAD_ROUTE_MEMBER_LIMIT');
    if (sourceId) {
      const source = await readRoute(client,projectId,designId,sourceId);
      if (source.revision !== value.expectedSourceRevision) throw new RouteGroupError('STALE_CAD_SOURCE_ROUTE');
      if (source.status !== 'draft') throw new RouteGroupError('CAD_ROUTE_PUBLISHED');
      // The design lock serializes membership writers. Remove the old ownership
      // before inserting the new one; the unique project/member key stays enforced.
      // Keep an empty source draft when its final section is moved.
      await client.query(`DELETE FROM cad_route_group_members
        WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3 AND instance_id=$4`,[projectId,designId,sourceId,value.instanceId]);
      const changedSource = await client.query(`UPDATE cad_route_groups SET revision=revision+1,updated_at=now()
        WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision=$4 AND status='draft' RETURNING id`,
      [projectId,designId,sourceId,value.expectedSourceRevision]);
      if (!changedSource.rows[0]) throw new RouteGroupError('STALE_CAD_SOURCE_ROUTE');
    }
    await client.query(`INSERT INTO cad_route_group_members(project_id,design_id,route_group_id,instance_id)
      VALUES ($1,$2,$3,$4)`,[projectId,designId,id,value.instanceId]);
    const changedTarget = await client.query(`UPDATE cad_route_groups SET revision=revision+1,updated_at=now()
      WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision=$4 AND status='draft' RETURNING id`,
    [projectId,designId,id,value.expectedRevision]);
    if (!changedTarget.rows[0]) throw new RouteGroupError('STALE_CAD_ROUTE');
    await synchronizeCadTrayExportsAfterTransfer(client,projectId,designId,sourceId,id,req.userId!);
    await touchDesign(client,projectId,designId);
    return readRoute(client,projectId,designId,id);
  });
  res.setHeader('Cache-Control','private, no-store');
  res.json({ route });
}));
cadRouteGroupsRouter.patch('/designs/:designId/routes/:routeId', requireProjectEdit, safe(async (req,res) => {
  validateParams(req);
  const parsed = cadRouteGroupUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw new RouteGroupError('INVALID_CAD_ROUTE',400);
  const value = parsed.data, projectId = req.params.projectId, designId = req.params.designId, id = req.params.routeId;
  const route = await withCadRouteDesignTransaction(projectId,designId,async client => {
    const current = await client.query<{ revision: number; status: string }>('SELECT revision,status FROM cad_route_groups WHERE project_id=$1 AND design_id=$2 AND id=$3 FOR UPDATE',[projectId,designId,id]);
    if (!current.rows[0]) throw new RouteGroupError('CAD_ROUTE_NOT_FOUND',404);
    if (current.rows[0].revision !== value.expectedRevision) throw new RouteGroupError('STALE_CAD_ROUTE');
    if (current.rows[0].status === 'published') {
      const saved = await readRoute(client,projectId,designId,id);
      const memberKey = (ids: string[]) => [...ids].map(member => member.toLowerCase()).sort().join(',');
      if (saved.name !== value.name || saved.tag !== value.tag || saved.purpose !== value.purpose
        || memberKey(saved.instanceIds) !== memberKey(value.instanceIds)) throw new RouteGroupError('CAD_ROUTE_PUBLISHED');
      // Presentation color is independent of the immutable published topology,
      // Materials selection and project tray. Keep their proof exactly intact.
      const recolored = await client.query(`UPDATE cad_route_groups SET color=$5,revision=revision+1,updated_at=now()
        WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision=$4 AND status='published' RETURNING id`,
      [projectId,designId,id,value.expectedRevision,value.color]);
      if (!recolored.rows[0]) throw new RouteGroupError('STALE_CAD_ROUTE');
      await touchDesign(client,projectId,designId);
      return readRoute(client,projectId,designId,id);
    }
    if (current.rows[0].status !== 'draft') throw new RouteGroupError('CAD_ROUTE_PUBLISHED');
    await validateMembers(client,projectId,designId,value.instanceIds,id);
    const updated = await client.query(`UPDATE cad_route_groups SET name=$5,tag=$6,color=$7,purpose=$8,revision=revision+1,updated_at=now()
      WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision=$4 AND status='draft' RETURNING id`,
    [projectId,designId,id,value.expectedRevision,value.name,value.tag,value.color,value.purpose]);
    if (!updated.rows[0]) throw new RouteGroupError('STALE_CAD_ROUTE');
    await replaceMembers(client,projectId,designId,id,value.instanceIds);
    await synchronizeCadTrayExportsAfterTransfer(client,projectId,designId,null,id,req.userId!);
    await touchDesign(client,projectId,designId);
    return readRoute(client,projectId,designId,id);
  });
  res.setHeader('Cache-Control','private, no-store');
  res.json({ route });
}));
cadRouteGroupsRouter.delete('/designs/:designId/routes/:routeId', requireProjectEdit, safe(async (req,res) => {
  validateParams(req);
  const parsed = cadRouteGroupDeleteSchema.safeParse(req.body);
  if (!parsed.success) throw new RouteGroupError('INVALID_CAD_ROUTE_REVISION',400);
  const projectId = req.params.projectId, designId = req.params.designId, id = req.params.routeId;
  await withCadRouteDesignTransaction(projectId,designId,async client => {
    const current = await client.query<{ revision: number; status: string; project_tray_id: string | null }>('SELECT revision,status,project_tray_id FROM cad_route_groups WHERE project_id=$1 AND design_id=$2 AND id=$3 FOR UPDATE',[projectId,designId,id]);
    if (!current.rows[0]) throw new RouteGroupError('CAD_ROUTE_NOT_FOUND',404);
    if (current.rows[0].revision !== parsed.data.expectedRevision) throw new RouteGroupError('STALE_CAD_ROUTE');
    if (current.rows[0].status !== 'draft' || current.rows[0].project_tray_id) throw new RouteGroupError('CAD_ROUTE_PUBLISHED');
    const deleted = await client.query(`DELETE FROM cad_route_groups WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision=$4 AND status='draft' RETURNING id`,[projectId,designId,id,parsed.data.expectedRevision]);
    if (!deleted.rows[0]) throw new RouteGroupError('STALE_CAD_ROUTE');
    await touchDesign(client,projectId,designId);
  });
  res.status(204).send();
}));
