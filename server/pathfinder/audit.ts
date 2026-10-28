import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { PathFinderError } from './errors.js';

export async function locationAuditState(client:PoolClient,projectId:string,locationId:string):Promise<unknown> {
  const location = (await client.query(`SELECT id,name,revision::text FROM pf_locations WHERE project_id=$1 AND id=$2`,[projectId,locationId])).rows[0];
  if (!location) return null;
  const aliases = await client.query('SELECT display_alias FROM pf_location_aliases WHERE project_id=$1 AND location_id=$2 ORDER BY normalized_alias',[projectId,locationId]);
  return {...location,aliases:aliases.rows.map(row => row.display_alias)};
}
export async function bindingAuditState(client:PoolClient,projectId:string,locationId:string,modelVersionId:string):Promise<unknown> {
  return (await client.query(`SELECT model_version_id,revision::text,point,object_id,external_id,source,derivation,coordinate_frame
    FROM pf_location_bindings WHERE project_id=$1 AND location_id=$2 AND model_version_id=$3`,[projectId,locationId,modelVersionId])).rows[0] ?? null;
}
export async function recordLocationEvent(client:PoolClient,input:{projectId:string;locationId:string;modelVersionId?:string;actorId:string;kind:'create'|'update'|'bind'|'auto_create'|'auto_bind';before:unknown;after:unknown}):Promise<void> {
  const data = JSON.stringify({before:input.before,after:input.after});
  if (Buffer.byteLength(data,'utf8') > 240000) throw new PathFinderError('LOCATION_AUDIT_BUDGET',413);
  await client.query(`INSERT INTO pf_location_events(id,project_id,location_id,model_version_id,actor_id,kind,registry_revision,event_data)
    SELECT $1,$2,$3,$4,$5,$6,s.registry_revision+1,$7 FROM pf_project_state s WHERE s.project_id=$2`,
  [randomUUID(),input.projectId,input.locationId,input.modelVersionId ?? null,input.actorId,input.kind,data]);
}
