import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export class CadRouteRevisionError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}

/** Preserve physical links on outside components by leaving that route published. */
export async function assertCadRouteRevisionHasNoExternalMates(
  client: PoolClient, projectId: string, designId: string, routeId: string,
): Promise<void> {
  const connections = await client.query(`WITH members AS (
      SELECT instance_id FROM cad_route_group_members WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3
    ) SELECT 1 FROM cad_design_connections c
  LEFT JOIN members s ON s.instance_id=c.source_instance_id
  LEFT JOIN members t ON t.instance_id=c.target_instance_id
  WHERE c.project_id=$1 AND c.design_id=$2 AND (s.instance_id IS NULL)<>(t.instance_id IS NULL)
    LIMIT 1`,[projectId,designId,routeId]);
  if (connections.rows.length) throw new CadRouteRevisionError('CAD_ROUTE_REVISION_EXTERNAL_MATES',
    'This route has a physical connection to a component outside its group. Route revisions require physical connections to stay within the same route group.');
}

/** Call under the design write lock. The source geometry stays published and immutable. */
export async function startCadRouteRevision(
  client: PoolClient, projectId: string, designId: string, parentId: string, expectedRevision: number, userId: string | null,
): Promise<{ id: string; created: boolean }> {
  const parent = (await client.query<{ revision: number; status: string; publication: { attachments?: unknown[] } | null }>(`SELECT revision,status,publication FROM cad_route_groups
    WHERE project_id=$1 AND design_id=$2 AND id=$3 FOR UPDATE`,[projectId,designId,parentId])).rows[0];
  if (!parent) throw new CadRouteRevisionError('CAD_ROUTE_NOT_FOUND','Route group not found.',404);
  if (parent.revision !== expectedRevision) throw new CadRouteRevisionError('STALE_CAD_ROUTE','The route changed. Reload it before starting a revision.');
  if (parent.status !== 'published') throw new CadRouteRevisionError('CAD_ROUTE_NOT_PUBLISHED','Publish the route before creating a revision.');

  const existing = (await client.query<{ id: string }>(`SELECT id FROM cad_route_groups
    WHERE project_id=$1 AND design_id=$2 AND revision_of_route_id=$3`,[projectId,designId,parentId])).rows[0];
  if (existing) return { id:existing.id,created:false };
  if (parent.publication?.attachments?.length) {
    throw new CadRouteRevisionError('CAD_ROUTE_REVISION_ATTACHMENTS',
      'This route has explicit network attachments that must be preserved. Revision editing is unavailable for this route.');
  }
  await assertCadRouteRevisionHasNoExternalMates(client,projectId,designId,parentId);

  const id = randomUUID();
  const temporaryTag = `CAD-REV-${id.toUpperCase()}`;
  await client.query(`INSERT INTO cad_route_groups
      (id,project_id,design_id,name,tag,color,purpose,created_by,revision_of_route_id,revision_base_number)
    SELECT $4,project_id,design_id,$5,$5,color,purpose,$6,id,revision FROM cad_route_groups
    WHERE project_id=$1 AND design_id=$2 AND id=$3`,[projectId,designId,parentId,id,temporaryTag,userId]);
  await client.query(`WITH copies AS MATERIALIZED (
      SELECT gen_random_uuid() AS copy_id,i.* FROM cad_design_instances i JOIN cad_route_group_members m
        ON m.project_id=i.project_id AND m.design_id=i.design_id AND m.instance_id=i.id
      WHERE m.project_id=$1 AND m.design_id=$2 AND m.route_group_id=$3
    ), inserted AS (
      INSERT INTO cad_design_instances
        (id,project_id,design_id,catalog_item_id,x_mm,y_mm,z_mm,qx,qy,qz,qw,cut_length_mm,created_by,created_at)
      SELECT copy_id,project_id,design_id,catalog_item_id,x_mm,y_mm,z_mm,qx,qy,qz,qw,cut_length_mm,$5,created_at
        FROM copies ORDER BY created_at,id RETURNING id
    ) INSERT INTO cad_route_revision_instances(project_id,design_id,route_group_id,instance_id,original_instance_id)
     SELECT $1,$2,$4,c.copy_id,c.id FROM copies c JOIN inserted i ON i.id=c.copy_id`,[projectId,designId,parentId,id,userId]);
  await client.query(`INSERT INTO cad_route_group_members(project_id,design_id,route_group_id,instance_id)
    SELECT project_id,design_id,route_group_id,instance_id FROM cad_route_revision_instances
    WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3`,[projectId,designId,id]);
  await client.query(`INSERT INTO cad_design_connections
      (id,project_id,design_id,source_instance_id,source_catalog_item_id,source_port_id,target_instance_id,target_catalog_item_id,target_port_id)
    SELECT gen_random_uuid(),c.project_id,c.design_id,s.instance_id,c.source_catalog_item_id,c.source_port_id,
      t.instance_id,c.target_catalog_item_id,c.target_port_id FROM cad_design_connections c
    JOIN cad_route_revision_instances s ON s.project_id=c.project_id AND s.design_id=c.design_id
      AND s.route_group_id=$3 AND s.original_instance_id=c.source_instance_id
    JOIN cad_route_revision_instances t ON t.project_id=c.project_id AND t.design_id=c.design_id
      AND t.route_group_id=$3 AND t.original_instance_id=c.target_instance_id
    WHERE c.project_id=$1 AND c.design_id=$2`,[projectId,designId,id]);
  await client.query(`INSERT INTO cad_route_transition_links
      (id,project_id,design_id,route_group_id,source_instance_id,source_port_name,target_instance_id,target_port_name,kind)
    SELECT gen_random_uuid(),l.project_id,l.design_id,$4,s.instance_id,l.source_port_name,t.instance_id,l.target_port_name,l.kind
    FROM cad_route_transition_links l
    JOIN cad_route_revision_instances s ON s.project_id=l.project_id AND s.design_id=l.design_id
      AND s.route_group_id=$4 AND s.original_instance_id=l.source_instance_id
    JOIN cad_route_revision_instances t ON t.project_id=l.project_id AND t.design_id=l.design_id
      AND t.route_group_id=$4 AND t.original_instance_id=l.target_instance_id
    WHERE l.project_id=$1 AND l.design_id=$2 AND l.route_group_id=$3`,[projectId,designId,parentId,id]);
  return { id,created:true };
}

async function revisionCloneIds(client: PoolClient, projectId: string, designId: string, draftId: string): Promise<string[]> {
  const result = await client.query<{ instance_id: string }>(`SELECT instance_id FROM cad_route_revision_instances
    WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3 ORDER BY instance_id`,[projectId,designId,draftId]);
  return result.rows.map(row => row.instance_id);
}

async function deleteInstances(client: PoolClient, projectId: string, designId: string, ids: string[]): Promise<void> {
  if (ids.length) await client.query(`DELETE FROM cad_design_instances
    WHERE project_id=$1 AND design_id=$2 AND id=ANY($3::uuid[])`,[projectId,designId,ids]);
}

/** Delete only copies we created. Existing components added to the draft survive. */
export async function discardCadRouteRevision(
  client: PoolClient, projectId: string, designId: string, draftId: string, expectedRevision: number,
): Promise<void> {
  const draft = (await client.query<{ revision: number }>(`SELECT revision FROM cad_route_groups
    WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision_of_route_id IS NOT NULL FOR UPDATE`,[projectId,designId,draftId])).rows[0];
  if (!draft) throw new CadRouteRevisionError('CAD_ROUTE_REVISION_NOT_FOUND','Route revision draft not found.',404);
  if (draft.revision !== expectedRevision) throw new CadRouteRevisionError('STALE_CAD_ROUTE','The draft changed. Reload it before discarding.');
  const clones = await revisionCloneIds(client,projectId,designId,draftId);
  await client.query('DELETE FROM cad_route_groups WHERE project_id=$1 AND design_id=$2 AND id=$3',[projectId,designId,draftId]);
  await deleteInstances(client,projectId,designId,clones);
}

type Transition = {
  id: string; source_instance_id: string; source_port_name: string;
  target_instance_id: string; target_port_name: string; kind: string; created_at: Date;
};

/** Swap proposal geometry within the publication transaction; caller restores
 * the parent publication/tray before commit and validates the resulting network. */
export async function promoteCadRouteRevisionMembers(
  client: PoolClient, projectId: string, designId: string, parentId: string, draftId: string,
): Promise<void> {
  const locked = await client.query<{ id: string }>(`SELECT published.id FROM cad_route_groups published
    JOIN cad_route_groups edit ON edit.project_id=published.project_id AND edit.design_id=published.design_id
      AND edit.revision_of_route_id=published.id AND edit.revision_base_number=published.revision
    WHERE published.project_id=$1 AND published.design_id=$2 AND published.id=$3 AND edit.id=$4
      AND published.status='published' AND edit.status='draft' FOR UPDATE OF published,edit`,[projectId,designId,parentId,draftId]);
  if (!locked.rows[0]) throw new CadRouteRevisionError('STALE_CAD_ROUTE','The published route changed after this draft was started.');
  await assertCadRouteRevisionHasNoExternalMates(client,projectId,designId,parentId);
  await assertCadRouteRevisionHasNoExternalMates(client,projectId,designId,draftId);

  const memberships = await client.query<{ route_group_id: string; instance_id: string }>(`SELECT route_group_id,instance_id
    FROM cad_route_group_members WHERE project_id=$1 AND design_id=$2 AND route_group_id=ANY($3::uuid[]) ORDER BY instance_id`,
  [projectId,designId,[parentId,draftId]]);
  const originalIds = memberships.rows.filter(row => row.route_group_id === parentId.toLowerCase()).map(row => row.instance_id);
  const revisedIds = memberships.rows.filter(row => row.route_group_id === draftId.toLowerCase()).map(row => row.instance_id);
  if (!revisedIds.length) throw new CadRouteRevisionError('CAD_ROUTE_REVISION_EMPTY','Add components to the draft before publishing.');
  const transitions = await client.query<Transition>(`SELECT id,source_instance_id,source_port_name,target_instance_id,target_port_name,kind,created_at
    FROM cad_route_transition_links WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3 ORDER BY id`,[projectId,designId,draftId]);
  const remainingClones = (await revisionCloneIds(client,projectId,designId,draftId)).filter(id => !revisedIds.includes(id));

  // Published-member and transition guards apply to every ordinary write. The
  // design lock keeps this intermediate state private to the transaction.
  await client.query(`UPDATE cad_route_groups SET status='draft',project_tray_id=NULL
    WHERE project_id=$1 AND design_id=$2 AND id=$3`,[projectId,designId,parentId]);
  await client.query(`DELETE FROM cad_route_group_members
    WHERE project_id=$1 AND design_id=$2 AND route_group_id=ANY($3::uuid[])`,[projectId,designId,[parentId,draftId]]);
  await client.query('DELETE FROM cad_route_groups WHERE project_id=$1 AND design_id=$2 AND id=$3',[projectId,designId,draftId]);
  await deleteInstances(client,projectId,designId,[...originalIds,...remainingClones]);
  await client.query(`INSERT INTO cad_route_group_members(project_id,design_id,route_group_id,instance_id)
    SELECT $1,$2,$3,member FROM unnest($4::uuid[]) AS member`,[projectId,designId,parentId,revisedIds]);
  if (transitions.rows.length) await client.query(`INSERT INTO cad_route_transition_links
      (id,project_id,design_id,route_group_id,source_instance_id,source_port_name,target_instance_id,target_port_name,kind,created_at)
    SELECT id,$1,$2,$3,source_instance_id,source_port_name,target_instance_id,target_port_name,kind,created_at
    FROM jsonb_to_recordset($4::jsonb) AS t(id uuid,source_instance_id uuid,source_port_name text,
      target_instance_id uuid,target_port_name text,kind text,created_at timestamptz)`,[projectId,designId,parentId,JSON.stringify(transitions.rows)]);
}
