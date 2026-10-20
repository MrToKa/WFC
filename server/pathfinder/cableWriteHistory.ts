import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {PathFinderError} from './errors.js';
/** Caller has already authorized and atomically updated the exact cable pair. */
export async function recordPathFinderCableHistory(client:PoolClient,input:{projectId:string;cableId:string;actorId:string}):Promise<void>{
  const result=await client.query(`INSERT INTO cable_versions(id,cable_id,version_number,change_type,change_source,cable_number,revision,mto,tag,cable_type_id,cable_type_name,
    from_location,to_location,routing,delivery,design_length,install_length,pull_date,connected_from,connected_to,tested,changed_by,changed_by_snapshot)
    SELECT $1,c.id,COALESCE((SELECT MAX(v.version_number) FROM cable_versions v WHERE v.cable_id=c.id),0)+1,'update','pathfinder',c.cable_id,c.revision,c.mto,c.tag,c.cable_type_id,ct.name,
    c.from_location,c.to_location,c.routing,c.delivery,c.design_length,c.install_length,c.pull_date,c.connected_from,c.connected_to,c.tested,$4,
    (SELECT jsonb_build_object('id',u.id,'firstName',u.first_name,'lastName',u.last_name,'email',u.email) FROM users u WHERE u.id=$4)
    FROM cables c JOIN cable_types ct ON ct.id=c.cable_type_id WHERE c.project_id=$2 AND c.id=$3 RETURNING id`,[randomUUID(),input.projectId,input.cableId,input.actorId]);
  if(result.rows.length!==1)throw new PathFinderError('CABLE_HISTORY_WRITE_REQUIRED',409);
}
