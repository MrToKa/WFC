import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { fittedTracePortSchema } from '../../shared/pathfinderGeometryTrace.js';
import { getInstanceCadPorts } from '../../shared/cadLengths.js';
import { MATE_OPPOSING_FACE } from '../../shared/cadPocPorts.js';
import {
  composeTransform,
  invertTransform,
  normalizeQuaternion,
  validatePosition,
  type RigidTransform,
} from '../../shared/cadTransforms.js';
import {
  groupInputs,
  networkOptions,
  publicationTransaction,
  routePort,
  validateCadAttachment,
  PublicationError,
  type PublicationInstance,
} from './routePublication.js';

const uuid = z.string().uuid();
const attachmentSchema = z
  .object({
    instanceId: uuid,
    portName: z.enum(['start', 'end']),
    targetObjectRevisionId: uuid,
    targetPortIndex: z.number().int().min(0).max(1),
  })
  .strict();
export const cadRouteAlignmentInputSchema = z
  .object({
    expectedRevision: z.number().int().positive().max(2147483646),
    attachment: attachmentSchema,
  })
  .strict();
type TargetPort = z.infer<typeof fittedTracePortSchema>;
type Endpoint = { instanceId: string; portName: 'start' | 'end' };
const refuse = (code: string, message: string, status = 409): never => {
  throw new PathFinderError(code, status, message);
};
const world = (row: PublicationInstance): RigidTransform => ({
  position: { x: row.x_mm, y: row.y_mm, z: row.z_mm },
  rotation: { x: row.qx, y: row.qy, z: row.qz, w: row.qw },
});

/** A physical port frame is a proper rotation, never a reflection or a scale. */
export function cadNetworkPortTransform(raw: TargetPort): RigidTransform {
  const parsed = fittedTracePortSchema.safeParse(raw);
  if (!parsed.success)
    return refuse(
      'CAD_ROUTE_INVALID_TARGET_FRAME',
      'The network port has no verified orthonormal frame.',
    );
  const { u, v, outward: n, pointMetres } = parsed.data;
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (cross.some((value, index) => Math.abs(value - n[index]) > 1e-5))
    return refuse('CAD_ROUTE_INVALID_TARGET_FRAME', 'The network port frame must be right-handed.');
  const m11 = u[0],
    m12 = v[0],
    m13 = n[0],
    m21 = u[1],
    m22 = v[1],
    m23 = n[1],
    m31 = u[2],
    m32 = v[2],
    m33 = n[2];
  const trace = m11 + m22 + m33;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    w = s / 4;
    x = (m32 - m23) / s;
    y = (m13 - m31) / s;
    z = (m21 - m12) / s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    w = (m32 - m23) / s;
    x = s / 4;
    y = (m12 + m21) / s;
    z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    w = (m13 - m31) / s;
    x = (m12 + m21) / s;
    y = s / 4;
    z = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    w = (m21 - m12) / s;
    x = (m13 + m31) / s;
    y = (m23 + m32) / s;
    z = s / 4;
  }
  return {
    position: validatePosition({
      x: pointMetres[0] * 1000,
      y: pointMetres[1] * 1000,
      z: pointMetres[2] * 1000,
    }),
    rotation: normalizeQuaternion({ x, y, z, w }),
  };
}

/** One rigid delta preserves every member's geometry, length and internal mating frame. */
export function computeCadRouteAlignment(
  instances: PublicationInstance[],
  endpoint: Endpoint,
  target: TargetPort,
) {
  if (!instances.length || instances.length > 32)
    return refuse('CAD_ROUTE_PART_LIMIT', 'Align 1–32 verified route components.');
  const source = instances.find((row) => row.id === endpoint.instanceId);
  if (!source) return refuse('CAD_ROUTE_ATTACHMENT_STALE', 'Choose a current route endpoint.');
  const localPort = getInstanceCadPorts(
    source.original_filename,
    source.source_sha256,
    source.cut_length_mm,
  ).find((port) => port.id === endpoint.portName);
  if (!localPort) return refuse('CAD_ROUTE_INVALID_PORT', 'Choose a verified route endpoint.');
  const targetWorld = cadNetworkPortTransform(target);
  if (Math.abs(target.widthMetres - 0.3) > 0.001 || Math.abs(target.heightMetres - 0.06) > 0.001)
    return refuse(
      'CAD_ROUTE_ATTACHMENT_PROFILE_MISMATCH',
      'The route and network connection profiles must match.',
    );
  const desired = composeTransform(targetWorld, MATE_OPPOSING_FACE);
  const sourceWorld = composeTransform(world(source), localPort.local);
  const delta = composeTransform(desired, invertTransform(sourceWorld));
  const aligned = instances.map((row) => ({
    id: row.id,
    revision: row.revision,
    transform: composeTransform(delta, world(row)),
  }));
  const moved = aligned.find((row) => row.id === source.id)!;
  validateCadAttachment(
    routePort(
      {
        ...source,
        x_mm: moved.transform.position.x,
        y_mm: moved.transform.position.y,
        z_mm: moved.transform.position.z,
        qx: moved.transform.rotation.x,
        qy: moved.transform.rotation.y,
        qz: moved.transform.rotation.z,
        qw: moved.transform.rotation.w,
      },
      endpoint.portName,
    ),
    target,
  );
  return aligned;
}

type SavedConnection = {
  id: string;
  source_instance_id: string;
  source_catalog_item_id: string;
  source_port_id: string;
  target_instance_id: string;
  target_catalog_item_id: string;
  target_port_id: string;
  created_at: Date | string;
};
export const cadRouteAlignmentRouter = Router({ mergeParams: true });
cadRouteAlignmentRouter.post(
  '/designs/:designId/routes/:routeId/align',
  requireAdmin,
  (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const parsed = cadRouteAlignmentInputSchema.safeParse(req.body);
      if (!parsed.success)
        return refuse(
          'INVALID_CAD_ROUTE_ALIGNMENT',
          'Choose a current route revision, route end and existing network port.',
          400,
        );
      const result = await publicationTransaction(req, async (client) => {
        const { projectId, designId, routeId } = req.params;
        const { group, chain, instances } = await groupInputs(client, projectId, designId, routeId);
        if (group.revision !== parsed.data.expectedRevision)
          return refuse('STALE_CAD_ROUTE', 'The route changed. Refresh before aligning.');
        if (group.status !== 'draft')
          return refuse('CAD_ROUTE_PUBLISHED', 'Withdraw the route before moving it.');
        const endpoint = chain.endpoints.find(
          (port) =>
            port.instanceId === parsed.data.attachment.instanceId &&
            port.portName === parsed.data.attachment.portName,
        );
        if (!endpoint)
          return refuse('CAD_ROUTE_ATTACHMENT_STALE', 'Choose an open route endpoint.');
        const model = (
          await client.query<{ model_version_id: string }>(
            'SELECT model_version_id FROM cad_designs WHERE project_id=$1 AND id=$2',
            [projectId, designId],
          )
        ).rows[0];
        const { options } = await networkOptions(client, projectId, model.model_version_id);
        const target = options.find(
          (port) =>
            port.objectRevisionId === parsed.data.attachment.targetObjectRevisionId &&
            port.portIndex === parsed.data.attachment.targetPortIndex,
        );
        if (!target)
          return refuse(
            'CAD_ROUTE_ATTACHMENT_STALE',
            'Refresh the current network attachment choices.',
          );
        const aligned = computeCadRouteAlignment(
          instances,
          { instanceId: endpoint.instanceId, portName: endpoint.portName },
          target.port,
        );
        const memberIds = instances.map((row) => row.id);
        const links = (
          await client.query<SavedConnection>(
            `SELECT * FROM cad_design_connections WHERE project_id=$1 AND design_id=$2
          AND (source_instance_id=ANY($3::uuid[]) OR target_instance_id=ANY($3::uuid[])) ORDER BY id FOR UPDATE`,
            [projectId, designId, memberIds],
          )
        ).rows;
        if (
          links.length !== instances.length - 1 ||
          links.some(
            (link) =>
              !memberIds.includes(link.source_instance_id) ||
              !memberIds.includes(link.target_instance_id),
          )
        )
          return refuse(
            'CAD_ROUTE_CROSS_GROUP_CONNECTION',
            'All saved connections must remain inside this route.',
          );
        // Existing move guards remain active. Temporarily remove only these
        // locked internal links and restore their exact identities in one commit.
        if (links.length) {
          const removed = await client.query(
            'DELETE FROM cad_design_connections WHERE project_id=$1 AND design_id=$2 AND id=ANY($3::uuid[]) RETURNING id',
            [projectId, designId, links.map((link) => link.id)],
          );
          if (removed.rows.length !== links.length)
            return refuse(
              'CAD_DESIGN_CONFLICT',
              'The route connections changed. Refresh and retry.',
            );
        }
        for (const row of aligned) {
          const { position: p, rotation: q } = row.transform;
          const updated = await client.query(
            `UPDATE cad_design_instances SET x_mm=$5,y_mm=$6,z_mm=$7,qx=$8,qy=$9,qz=$10,qw=$11,revision=revision+1,updated_at=now()
            WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision=$4 RETURNING id`,
            [projectId, designId, row.id, row.revision, p.x, p.y, p.z, q.x, q.y, q.z, q.w],
          );
          if (updated.rows.length !== 1)
            return refuse('STALE_CAD_INSTANCE', 'A route component changed. Refresh and retry.');
        }
        for (const link of links)
          await client.query(
            `INSERT INTO cad_design_connections(id,project_id,design_id,source_instance_id,source_catalog_item_id,source_port_id,
          target_instance_id,target_catalog_item_id,target_port_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              link.id,
              projectId,
              designId,
              link.source_instance_id,
              link.source_catalog_item_id,
              link.source_port_id,
              link.target_instance_id,
              link.target_catalog_item_id,
              link.target_port_id,
              link.created_at,
            ],
          );
        const updated = await client.query(
          `UPDATE cad_route_groups SET revision=revision+1,updated_at=now()
          WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision=$4 AND status='draft' RETURNING id,revision`,
          [projectId, designId, routeId, group.revision],
        );
        if (updated.rows.length !== 1)
          return refuse('STALE_CAD_ROUTE', 'The route changed. Refresh before aligning.');
        // Each member UPDATE advances the owning design through its existing trigger.
        return { id: routeId, revision: group.revision + 1, status: 'draft' };
      });
      res.json(result);
    })().catch((error: unknown) => {
      if (error instanceof PathFinderError || error instanceof PublicationError) {
        res.status(error.status).json({ code: error.code, message: error.message });
        return;
      }
      const domain = error as { code?: string; status?: number; message?: string };
      if (domain.code === '40P01' || domain.code === '40001' || domain.code === '23505') {
        res
          .status(409)
          .json({ code: 'CAD_DESIGN_CONFLICT', message: 'The route changed. Refresh and retry.' });
        return;
      }
      if (error instanceof RangeError) {
        res
          .status(422)
          .json({
            code: 'CAD_ROUTE_ALIGNMENT_OUT_OF_BOUNDS',
            message: 'The aligned route would exceed the supported model coordinates.',
          });
        return;
      }
      next(error);
    });
  },
);
