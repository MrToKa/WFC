/** Compact read-only before/after evidence for independent lookup UI work. No storage or workflow writes. */
import { pathToFileURL } from 'node:url';
import { pool } from '../db.js';
import { hash } from './dependencies.js';
const allowedProjects=['105913f0-7ee4-45f2-bfd8-2c01f9be9f2a','54cfad40-bd12-41e9-ab24-d90bdaafc993'];
export async function auditLookupProject(projectId:string) {
  if(process.env.PF_LOCAL_DEMO!=='true'||!allowedProjects.includes(projectId))throw Error('Only the owned isolated demonstration projects can be audited.');
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity=(await client.query('SELECT current_database() AS database,inet_server_addr()::text AS address,inet_server_port() AS port')).rows[0];if(identity.database!=='wfc_pathfinder_local')throw Error('Separate PathFinder database required.');
    const summary:Record<string,{count:number;sha256:string}>={};
    const statements:Record<string,string>={
      settings:'SELECT id,connection_gap::text,secondary_tray_length::text,end_connection_length::text,additional_bending_percent::text,pf_settings_revision::text FROM projects WHERE id=$1',
      selection:'SELECT project_id,active_model_version_id,selection_revision::text FROM project_model_selections WHERE project_id=$1',
      registry:'SELECT project_id,registry_revision::text FROM pf_project_state WHERE project_id=$1',
      planningArtifacts:"SELECT * FROM pf_artifacts WHERE project_id=$1 AND purpose='planning' ORDER BY created_at,id LIMIT 20001",
      locations:'SELECT * FROM pf_locations WHERE project_id=$1 ORDER BY id LIMIT 20001',
      aliases:'SELECT * FROM pf_location_aliases WHERE project_id=$1 ORDER BY normalized_alias LIMIT 20001',
      bindings:'SELECT * FROM pf_location_bindings WHERE project_id=$1 ORDER BY location_id,model_version_id LIMIT 20001',
      modelObjects:'SELECT * FROM pf_model_objects WHERE project_id=$1 ORDER BY artifact_id,object_id LIMIT 20001',
      cables:'SELECT * FROM cables WHERE project_id=$1 ORDER BY id LIMIT 20001',
      proposals:'SELECT * FROM pf_proposals WHERE project_id=$1 ORDER BY id LIMIT 20001',
      reviews:'SELECT * FROM pf_reviews WHERE project_id=$1 ORDER BY id LIMIT 20001',
      applies:'SELECT * FROM pf_apply_receipts WHERE project_id=$1 ORDER BY id LIMIT 20001',
    };
    let latestPlanningArtifact:Record<string,unknown>|null=null,registryRevision:string|null=null,selectedModelId:string|null=null;
    const planningArtifactList:Array<Record<string,unknown>>=[];
    for(const [name,statement] of Object.entries(statements)) {
      const rows=(await client.query(statement,[projectId])).rows;if(rows.length>20000)throw Error('Audit row budget exceeded for '+name);
      summary[name]={count:rows.length,sha256:hash(JSON.parse(JSON.stringify(rows)))};
      if(name==='registry')registryRevision=rows[0]?.registry_revision??null;
      if(name==='selection')selectedModelId=rows[0]?.active_model_version_id??null;
      if(name==='planningArtifacts')for(const artifact of rows){const entry={id:artifact.id,modelVersionId:artifact.model_version_id,snapshotSha256:artifact.snapshot_sha256,objectCount:artifact.object_count};planningArtifactList.push(entry);if(artifact.model_version_id===selectedModelId)latestPlanningArtifact=entry;}
    }
    await client.query('COMMIT');return {schemaVersion:'pathfinder.lookup.audit.v1',recordedAtUtc:new Date().toISOString(),projectId,scope:'isolated database; repeatable read-only snapshot',database:identity,
      registryRevision,latestPlanningArtifact,planningArtifactList,planningArtifactsAndWorkflow:summary,nativeParity:'NOT_PERFORMED; no Apply or engineering acceptance asserted'};
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await auditLookupProject(process.argv[2])));}catch(error){console.error(error instanceof Error?error.message:'Lookup audit failed.');process.exitCode=1;}finally{await pool.end();}}
