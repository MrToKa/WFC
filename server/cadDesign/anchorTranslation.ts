import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { rotateVector, validatePosition, type Vec3 } from '../../shared/cadTransforms.js';
import { requireProjectEdit } from '../middleware.js';
import { withCadRouteDesignTransaction } from './routeGroupsRoutes.js';
import { networkOptions } from './routePublication.js';

const uuid = z.string().uuid();
const revision = z.number().int().positive().max(2147483646);
const point = z.object({ x: z.number().finite().min(-1e9).max(1e9), y: z.number().finite().min(-1e9).max(1e9), z: z.number().finite().min(-1e9).max(1e9) }).strict();
export const cadAnchorTranslationSchema = z.object({
  anchor: z.object({ instanceId: uuid, localPointMm: point }).strict(),
  targetPointMm: point,
  instances: z.array(z.object({ id: uuid, expectedRevision: revision }).strict()).min(1).max(200),
  route: z.object({ id: uuid, expectedRevision: revision }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.instances.map(row => row.id)).size !== value.instances.length)
    ctx.addIssue({ code: 'custom', path: ['instances'], message: 'Choose each section only once.' });
  if (!value.instances.some(row => row.id === value.anchor.instanceId))
    ctx.addIssue({ code: 'custom', path: ['anchor'], message: 'The anchor must belong to the selection.' });
});

type Instance = { id: string; revision: number; x_mm: number; y_mm: number; z_mm: number; qx: number; qy: number; qz: number; qw: number };
type Group = { id: string; revision: number; status: string };
type Link = { id: string; source_instance_id: string; target_instance_id: string };
type PhysicalLink = Link & { source_catalog_item_id: string; source_port_id: string; target_catalog_item_id: string; target_port_id: string; created_at: Date | string };
class TranslationError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
const refuse = (code: string, message: string, status = 409): never => { throw new TranslationError(code, message, status); };

/** Geometry-independent translation: no manufacturer ports or inferred fitting frame. */
export function translateCadAnchor(instances: Instance[], anchor: { instanceId: string; localPointMm: Vec3 }, targetPointMm: Vec3) {
  const source = instances.find(row => row.id === anchor.instanceId);
  if (!source) return refuse('CAD_ANCHOR_NOT_SELECTED', 'Choose a point on a selected section.', 400);
  validatePosition(targetPointMm);
  const offset = rotateVector(anchor.localPointMm, { x: source.qx, y: source.qy, z: source.qz, w: source.qw });
  const sourcePoint = validatePosition({ x: source.x_mm + offset.x, y: source.y_mm + offset.y, z: source.z_mm + offset.z });
  const delta = { x: targetPointMm.x - sourcePoint.x, y: targetPointMm.y - sourcePoint.y, z: targetPointMm.z - sourcePoint.z };
  return instances.map(row => ({ id: row.id, revision: row.revision, positionMm: validatePosition({ x: row.x_mm + delta.x, y: row.y_mm + delta.y, z: row.z_mm + delta.z }) }));
}

export const cadAnchorTranslationRouter = Router({ mergeParams: true });
cadAnchorTranslationRouter.get('/designs/:designId/placement-targets', requireProjectEdit,
  (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const { projectId, designId } = req.params;
      if (![projectId, designId].every(value => uuid.safeParse(value).success))
        return refuse('INVALID_CAD_SELECTION', 'Choose a current project and design.', 400);
      const targets = await withCadRouteDesignTransaction(projectId, designId, async client => {
        const model = (await client.query<{ model_version_id: string }>('SELECT model_version_id FROM cad_designs WHERE project_id=$1 AND id=$2', [projectId, designId])).rows[0];
        const { options } = await networkOptions(client, projectId, model.model_version_id, false);
        return options.map(option => ({ objectId: option.objectId, objectRevisionId: option.objectRevisionId,
          portIndex: option.portIndex, pointMm: validatePosition({ x: option.pointMetres[0] * 1000, y: option.pointMetres[1] * 1000, z: option.pointMetres[2] * 1000 }),
          label: `${option.routeCode} · object ${option.objectId} · end ${option.portIndex + 1}` }));
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ targets });
    })().catch((error: unknown) => {
      const domain = error as { code?: string; status?: number; message?: string };
      if (typeof domain.code === 'string' && (domain.status || domain.code === 'INACTIVE_DESIGN')) {
        res.status(domain.status ?? 409).json({ code: domain.code, message: domain.message }); return;
      }
      next(error);
    });
  });
cadAnchorTranslationRouter.post('/designs/:designId/translate-selection', requireProjectEdit,
  (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const { projectId, designId } = req.params;
      if (![projectId, designId].every(value => uuid.safeParse(value).success))
        return refuse('INVALID_CAD_SELECTION', 'Choose a current project and design.', 400);
      const parsed = cadAnchorTranslationSchema.safeParse(req.body);
      if (!parsed.success) return refuse('INVALID_CAD_ANCHOR_TRANSLATION', 'Choose a point, valid coordinates and current selected sections.', 400);
      const input = parsed.data;
      const ids = input.instances.map(row => row.id).sort();
      const selected = new Set(ids);
      const result = await withCadRouteDesignTransaction(projectId, designId, async client => {
        const rows = (await client.query<Instance>(`SELECT id,revision,x_mm,y_mm,z_mm,qx,qy,qz,qw FROM cad_design_instances
          WHERE project_id=$1 AND design_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE`, [projectId, designId, ids])).rows;
        if (rows.length !== ids.length || rows.some(row => input.instances.find(requested => requested.id === row.id)?.expectedRevision !== row.revision))
          return refuse('STALE_CAD_INSTANCE', 'The selection changed. Refresh and select the point again.');
        const groups = (await client.query<Group>(`SELECT g.id,g.revision,g.status FROM cad_route_groups g
          WHERE g.project_id=$1 AND g.design_id=$2 AND (g.id=$4::uuid OR EXISTS (
            SELECT 1 FROM cad_route_group_members m WHERE m.project_id=g.project_id AND m.design_id=g.design_id
            AND m.route_group_id=g.id AND m.instance_id=ANY($3::uuid[]))) ORDER BY g.id FOR UPDATE`, [projectId, designId, ids, input.route?.id ?? null])).rows;
        if (groups.some(group => group.status !== 'draft'))
          return refuse('CAD_ROUTE_PUBLISHED', 'Withdraw the published route before moving its sections.');
        if (input.route) {
          const group = groups.find(row => row.id === input.route!.id);
          if (!group || group.revision !== input.route.expectedRevision)
            return refuse('STALE_CAD_ROUTE', 'The route changed. Refresh and select it again.');
          const members = (await client.query<{ instance_id: string }>(`SELECT instance_id FROM cad_route_group_members
            WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3 ORDER BY instance_id`, [projectId, designId, group.id])).rows;
          if (members.length !== ids.length || members.some(row => !selected.has(row.instance_id)))
            return refuse('CAD_ROUTE_SELECTION_CHANGED', 'Select every current section of this route before moving it.');
        }
        const links = (await client.query<PhysicalLink>(`SELECT * FROM cad_design_connections WHERE project_id=$1 AND design_id=$2
          AND (source_instance_id=ANY($3::uuid[]) OR target_instance_id=ANY($3::uuid[])) ORDER BY id FOR UPDATE`, [projectId, designId, ids])).rows;
        const transitions = (await client.query<Link>(`SELECT id,source_instance_id,target_instance_id FROM cad_route_transition_links
          WHERE project_id=$1 AND design_id=$2 AND (source_instance_id=ANY($3::uuid[]) OR target_instance_id=ANY($3::uuid[]))
          ORDER BY id FOR UPDATE`, [projectId, designId, ids])).rows;
        if ([...links, ...transitions].some(link => !selected.has(link.source_instance_id) || !selected.has(link.target_instance_id)))
          return refuse('CAD_SELECTION_CONNECTED_OUTSIDE', 'Select all connected sections or disconnect the external connection before moving.');
        // Validate every destination before touching links or members. Rotations and cut lengths remain untouched.
        const moved = translateCadAnchor(rows, input.anchor, input.targetPointMm);
        if (links.length) {
          const removed = await client.query(`DELETE FROM cad_design_connections WHERE project_id=$1 AND design_id=$2 AND id=ANY($3::uuid[]) RETURNING id`, [projectId, designId, links.map(link => link.id)]);
          if (removed.rows.length !== links.length) return refuse('CAD_DESIGN_CONFLICT', 'Connections changed. Refresh and retry.');
        }
        const instances = [];
        for (const row of moved) {
          const p = row.positionMm;
          const updated = await client.query<{ id: string; revision: number }>(`UPDATE cad_design_instances SET x_mm=$5,y_mm=$6,z_mm=$7,revision=revision+1,updated_at=now()
            WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision=$4 RETURNING id,revision`, [projectId, designId, row.id, row.revision, p.x, p.y, p.z]);
          if (updated.rows.length !== 1) return refuse('STALE_CAD_INSTANCE', 'A selected section changed. Refresh and retry.');
          instances.push({ ...updated.rows[0], positionMm: p });
        }
        for (const link of links) await client.query(`INSERT INTO cad_design_connections(id,project_id,design_id,source_instance_id,source_catalog_item_id,source_port_id,
          target_instance_id,target_catalog_item_id,target_port_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [link.id, projectId, designId, link.source_instance_id, link.source_catalog_item_id, link.source_port_id, link.target_instance_id, link.target_catalog_item_id, link.target_port_id, link.created_at]);
        for (const group of groups) {
          const updated = await client.query(`UPDATE cad_route_groups SET revision=revision+1,updated_at=now()
            WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision=$4 AND status='draft' RETURNING id`, [projectId, designId, group.id, group.revision]);
          if (updated.rows.length !== 1) return refuse('STALE_CAD_ROUTE', 'The route changed. Refresh and retry.');
        }
        const route = input.route ? groups.find(group => group.id === input.route!.id)! : undefined;
        return { instances, ...(route ? { route: { id: route.id, revision: route.revision + 1 } } : {}) };
      });
      res.json(result);
    })().catch((error: unknown) => {
      if (error instanceof TranslationError) { res.status(error.status).json({ code: error.code, message: error.message }); return; }
      if (error instanceof RangeError) { res.status(422).json({ code: 'CAD_TRANSLATION_OUT_OF_BOUNDS', message: 'The moved selection would exceed supported model coordinates.' }); return; }
      const code = (error as { code?: string }).code;
      if (code === 'INACTIVE_DESIGN') { res.status(409).json({ code, message: 'Choose an active healthy proposed design.' }); return; }
      if (['40P01', '40001', '23505', '23514'].includes(code ?? '')) { res.status(409).json({ code: 'CAD_DESIGN_CONFLICT', message: 'The design or its connections changed. Refresh and retry.' }); return; }
      next(error);
    });
  });
