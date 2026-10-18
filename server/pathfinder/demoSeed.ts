import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { pathToFileURL } from 'node:url';
import { createPathFinderRepository, lockProject, requireTransactionalAdmin, transaction } from './repository.js';
import { PathFinderError } from './errors.js';
import { syntheticStraightSnapshot } from './syntheticFixture.js';
import { uuid } from './contracts.js';

/** CLI-only; there is deliberately no route exposing this function or accepting a proof. */
export async function seedSyntheticDemo(pool:Pool,input:{projectId:string;modelVersionId:string;actorId:string}) {
  if (process.env.PF_LOCAL_DEMO !== 'true') throw new PathFinderError('SYNTHETIC_DEMO_DISABLED',403);
  const {projectId,modelVersionId,actorId} = {projectId:uuid.parse(input.projectId),modelVersionId:uuid.parse(input.modelVersionId),actorId:uuid.parse(input.actorId)};
  const fixture = await transaction(pool,async client => {
    if ((await client.query('SELECT current_database() AS name')).rows[0]?.name !== 'wfc_pathfinder_local') throw new PathFinderError('ISOLATED_DEMO_DATABASE_REQUIRED',403);
    await lockProject(client,projectId); await requireTransactionalAdmin(client,actorId);
    const project = (await client.query('SELECT project_number,name FROM projects WHERE id=$1',[projectId])).rows[0];
    if (!project.project_number.startsWith('PF-SYNTHETIC-') || !project.name.startsWith('Synthetic PathFinder')) throw new PathFinderError('SYNTHETIC_PROJECT_MARKER_REQUIRED',403);
    const existing = await client.query('SELECT 1 FROM cables WHERE project_id=$1 LIMIT 1',[projectId]);
    if (existing.rows.length) throw new PathFinderError('SYNTHETIC_PROJECT_NOT_EMPTY',409);
    const model = (await client.query(`SELECT v.content_fingerprint,s.selection_revision::text FROM model_versions v JOIN project_model_selections s ON s.project_id=v.project_id AND s.active_model_version_id=v.id
      WHERE v.project_id=$1 AND v.id=$2 AND v.state='ready' AND v.health='healthy'`,[projectId,modelVersionId])).rows[0];
    if (!model) throw new PathFinderError('ACTIVE_MODEL_REQUIRED',409);
    await client.query('INSERT INTO pf_synthetic_projects(project_id,fixture_id) VALUES($1,$2)',[projectId,'pf-local-straight-v1']);
    await client.query('UPDATE projects SET secondary_tray_length=5,end_connection_length=6,additional_bending_percent=10 WHERE id=$1',[projectId]);
    const typeId = randomUUID(); await client.query('INSERT INTO cable_types(id,project_id,name,purpose) VALUES($1,$2,$3,$4)',[typeId,projectId,'PF Synthetic Control Fixture','Explicit synthetic local demonstration']);
    const cableIds = [randomUUID(),randomUUID()];
    for (let i=0;i<2;i++) await client.query(`INSERT INTO cables(id,project_id,cable_id,cable_type_id,mto,tag,from_location,to_location,install_length)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[cableIds[i],projectId,i+1,typeId,i ? 'Control' : 'Instrumentation',`SYNTHETIC-${i+1}`,
      i ? '=PF-SYNTHETIC-TO' : '=PF-SYNTHETIC-FROM',i ? '=PF-SYNTHETIC-FROM' : '=PF-SYNTHETIC-TO',i ? 44 : 33]);
    const registry = (await client.query('SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1',[projectId])).rows[0].registry_revision;
    return {model,registry,cableIds};
  });
  const registry = createPathFinderRepository(pool);
  const who = {userId:actorId,loginId:randomUUID(),loginExpiresAt:Date.now()+60*60*1000};
  const artifact = await registry.ingestArtifact(projectId,who,{modelVersionId,expectedSelectionRevision:fixture.model.selection_revision,expectedRegistryRevision:fixture.registry,
    snapshot:syntheticStraightSnapshot(projectId,modelVersionId,fixture.model.content_fingerprint)});
  await transaction(pool,async client => {
    await lockProject(client,projectId); await requireTransactionalAdmin(client,actorId);
    const saved = (await client.query('SELECT snapshot_sha256,capture FROM pf_artifacts WHERE project_id=$1 AND id=$2 FOR SHARE',[projectId,artifact.artifactId])).rows[0];
    if (saved?.snapshot_sha256 !== artifact.snapshotSha256 || saved.capture?.sourceKind !== 'synthetic' || saved.capture?.adapterVersion !== 'pf-local-straight-v1') throw new PathFinderError('SYNTHETIC_PROOF_MISMATCH',409);
    await client.query('INSERT INTO pf_synthetic_proofs(project_id,artifact_id,fixture_id,snapshot_sha256) VALUES($1,$2,$3,$4)',[projectId,artifact.artifactId,'pf-local-straight-v1',artifact.snapshotSha256]);
  });
  const matched = await registry.match(projectId,who,artifact.registryRevision);
  return {scope:'local-synthetic-fixture',projectId,modelVersionId,cableIds:fixture.cableIds,artifactId:artifact.artifactId,snapshotSha256:artifact.snapshotSha256,registryRevision:matched.registryRevision,
    message:'Only the known synthetic 10-metre straight fixture is accepted for local demonstration. Real model engineering acceptance remains blocked.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [projectId,modelVersionId,actorId] = process.argv.slice(2);
  const {pool} = await import('../db.js');
  try {console.log(JSON.stringify(await seedSyntheticDemo(pool,{projectId,modelVersionId,actorId})));}
  catch(error) {console.error(error instanceof PathFinderError ? error.message : 'Synthetic fixture seeding failed.'); process.exitCode=1;}
  finally {await pool.end();}
}
