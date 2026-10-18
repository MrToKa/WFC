import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import type { artifactSchema, bindLocationSchema, createLocationSchema, LocationDto } from './contracts.js';
import { PathFinderError } from './errors.js';
import { matchLocation, normalizeLocation, objectMatchNames, validateSnapshotStructure } from './matching.js';
import { storeSnapshot } from './storage.js';
import type { JobPrincipal } from './jobContracts.js';
import { principalTransaction } from './auth.js';
export { transaction } from './transactions.js';
import { bindingAuditState, locationAuditState, recordLocationEvent } from './audit.js';

type Row = Record<string, any>;
export async function requireTransactionalAdmin(client: PoolClient, actorId: string): Promise<void> {
  const result = await client.query<{is_admin:boolean}>('SELECT is_admin FROM users WHERE id=$1 FOR SHARE',[actorId]);
  if (result.rows[0]?.is_admin !== true) throw new PathFinderError('ADMIN_REQUIRED',403,'Administrator access required.');
}
export async function lockProject(client: PoolClient, projectId: string): Promise<void> {
  const project = await client.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE',[projectId]);
  if (!project.rows.length) throw new PathFinderError('PROJECT_NOT_FOUND',404);
}
async function registryTransaction<T>(pool:Pool,projectId:string,who:JobPrincipal,operation:(client:PoolClient) => Promise<T>):Promise<T> {
  return principalTransaction(pool,projectId,who,operation);
}
async function stateRevision(client: PoolClient, projectId: string, expected?: string): Promise<string> {
  const row = (await client.query<Row>('SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1 FOR UPDATE',[projectId])).rows[0];
  if (!row) throw new PathFinderError('PROJECT_NOT_FOUND',404);
  if (expected !== undefined && row.registry_revision !== expected) throw new PathFinderError('REGISTRY_CONFLICT',409,'The location registry changed. Refresh and retry.');
  return row.registry_revision;
}
export async function bumpRegistry(client: PoolClient, projectId: string): Promise<string> {
  return (await client.query<Row>('UPDATE pf_project_state SET registry_revision=registry_revision+1,updated_at=NOW() WHERE project_id=$1 RETURNING registry_revision::text',[projectId])).rows[0].registry_revision;
}
export async function activeModel(client: PoolClient, projectId: string, expectedId?: string, expectedRevision?: string): Promise<Row> {
  const row = (await client.query<Row>(`SELECT s.active_model_version_id,s.selection_revision::text,v.content_fingerprint,v.state,v.health
    FROM project_model_selections s LEFT JOIN model_versions v ON v.id=s.active_model_version_id AND v.project_id=s.project_id WHERE s.project_id=$1`,[projectId])).rows[0];
  if (!row) throw new PathFinderError('PROJECT_NOT_FOUND',404);
  if (expectedId !== undefined && row.active_model_version_id !== expectedId || expectedRevision !== undefined && row.selection_revision !== expectedRevision)
    throw new PathFinderError('MODEL_SELECTION_CONFLICT',409,'The active model changed. Refresh and retry.');
  if (expectedId && (row.state !== 'ready' || row.health !== 'healthy')) throw new PathFinderError('MODEL_UNAVAILABLE',409);
  return row;
}
export async function latestArtifact(client: PoolClient, projectId: string, modelVersionId: string | null): Promise<Row | null> {
  if (!modelVersionId) return null;
  return (await client.query<Row>('SELECT * FROM pf_artifacts WHERE project_id=$1 AND model_version_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[projectId,modelVersionId])).rows[0] ?? null;
}
async function locations(client: PoolClient, projectId: string, modelId: string | null, artifactId: string | null): Promise<LocationDto[]> {
  const rows = await client.query<Row>(`SELECT l.id,l.name,l.revision::text,
    COALESCE((SELECT jsonb_agg(a.display_alias ORDER BY a.normalized_alias) FROM pf_location_aliases a WHERE a.project_id=l.project_id AND a.location_id=l.id),'[]'::jsonb) AS aliases,
    b.model_version_id,b.revision::text AS binding_revision,b.point,b.object_id,b.external_id,b.source,b.artifact_id,b.derivation,b.coordinate_frame,
    m.status AS matching_status,m.candidate_object_ids
    FROM pf_locations l LEFT JOIN LATERAL(SELECT * FROM pf_location_bindings b WHERE b.project_id=l.project_id AND b.location_id=l.id
      ORDER BY (b.model_version_id=$2) DESC,b.confirmed_at DESC LIMIT 1) b ON TRUE
    LEFT JOIN pf_location_matches m ON m.project_id=l.project_id AND m.location_id=l.id AND m.model_version_id=$2
    WHERE l.project_id=$1 ORDER BY l.name,l.id`,[projectId,modelId]);
  return rows.rows.map(row => ({id:row.id,name:row.name,aliases:row.aliases,revision:row.revision,
    ...(row.matching_status ? {matching:{status:row.matching_status,candidateObjectIds:row.candidate_object_ids}} : {}),binding:row.model_version_id ? {
    modelVersionId:row.model_version_id,revision:row.binding_revision,point:row.point,objectId:row.object_id,externalId:row.external_id,source:row.source,derivation:row.derivation,coordinateFrame:row.coordinate_frame,
    status:row.model_version_id === modelId && (!row.artifact_id || row.artifact_id === artifactId) ? 'confirmed' : 'stale',
  } : null}));
}
export function createPathFinderRepository(pool: Pool) {
  return {
    pool,
    async state(projectId: string, who: JobPrincipal) {
      return registryTransaction(pool,projectId,who,async client => {
        const model = await activeModel(client,projectId), artifact = await latestArtifact(client,projectId,model.active_model_version_id);
        const registry = await client.query<Row>('SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1',[projectId]);
        const setting = (await client.query<Row>('SELECT pf_settings_revision::text,connection_gap::text,secondary_tray_length::text,end_connection_length::text,additional_bending_percent::text FROM projects WHERE id=$1',[projectId])).rows[0];
        const list = await locations(client,projectId,model.active_model_version_id,artifact?.id ?? null);
        const cables = await client.query<Row>(`SELECT id,cable_id,tag,from_location,to_location,mto,routing,design_length,install_length,cable_write_revision::text
          FROM cables WHERE project_id=$1 ORDER BY cable_id,id LIMIT 100001`,[projectId]);
        if (cables.rows.length > 100000) throw new PathFinderError('PROJECT_CABLE_BUDGET',413);
        return {schemaVersion:1,projectId,registryRevision:registry.rows[0].registry_revision,
          activeModel:{modelVersionId:model.active_model_version_id,selectionRevision:model.selection_revision,contentFingerprint:model.content_fingerprint ?? null},
          settings:{revision:setting.pf_settings_revision,connectionGap:setting.connection_gap,secondaryTrayLength:setting.secondary_tray_length,endConnectionLength:setting.end_connection_length,additionalBendingPercent:setting.additional_bending_percent},
          cables:cables.rows.map(cable => ({id:cable.id,cableId:cable.cable_id,tag:cable.tag,fromLocation:cable.from_location,toLocation:cable.to_location,mto:cable.mto,
            routing:cable.routing,designLength:cable.design_length,installLength:cable.install_length,cableWriteRevision:cable.cable_write_revision,
            fromMatch:matchLocation(cable.from_location,list,Boolean(model.active_model_version_id)),toMatch:matchLocation(cable.to_location,list,Boolean(model.active_model_version_id))})),
          locations:list,artifacts:artifact ? [{id:artifact.id,modelVersionId:artifact.model_version_id,snapshotSha256:artifact.snapshot_sha256,objectCount:artifact.object_count,
            engineeringAccepted:false,readiness:'needs_review',capture:artifact.capture,coordinates:artifact.coordinates,createdAt:artifact.created_at}] : [],jobs:[],proposals:[]};
      });
    },
    async createLocation(projectId: string, who: JobPrincipal, input: z.infer<typeof createLocationSchema>) {
      const actorId = who.userId;
      return registryTransaction(pool,projectId,who,async client => {
        await stateRevision(client,projectId,input.expectedRegistryRevision);
        const values = [...new Map([input.name,...input.aliases].map(name => [normalizeLocation(name),name.normalize('NFC').trim()])).entries()];
        if (values.some(([key]) => !key)) throw new PathFinderError('INVALID_LOCATION');
        const conflict = await client.query('SELECT location_id FROM pf_location_aliases WHERE project_id=$1 AND normalized_alias=ANY($2::text[])',[projectId,values.map(([key]) => key)]);
        if (conflict.rows.length) throw new PathFinderError('LOCATION_ALIAS_CONFLICT',409,'A name or alias already belongs to another project location.');
        const id = randomUUID(); await client.query('INSERT INTO pf_locations(id,project_id,name,created_by) VALUES($1,$2,$3,$4)',[id,projectId,input.name.normalize('NFC'),actorId]);
        for (const [normalized,display] of values) await client.query('INSERT INTO pf_location_aliases(project_id,normalized_alias,display_alias,location_id) VALUES($1,$2,$3,$4)',[projectId,normalized,display,id]);
        await recordLocationEvent(client,{projectId,locationId:id,actorId,kind:'create',before:null,after:await locationAuditState(client,projectId,id)});
        return {locationId:id,registryRevision:await bumpRegistry(client,projectId)};
      });
    },
    async bindLocation(projectId: string, who: JobPrincipal, locationId: string, input: z.infer<typeof bindLocationSchema>) {
      const actorId = who.userId;
      return registryTransaction(pool,projectId,who,async client => {
        await stateRevision(client,projectId,input.expectedRegistryRevision);
        await activeModel(client,projectId,input.modelVersionId,input.expectedSelectionRevision);
        if (!(await client.query('SELECT id FROM pf_locations WHERE project_id=$1 AND id=$2 FOR UPDATE',[projectId,locationId])).rows.length) throw new PathFinderError('LOCATION_NOT_FOUND',404);
        const previousBinding = await bindingAuditState(client,projectId,locationId,input.modelVersionId);
        const artifact = await latestArtifact(client,projectId,input.modelVersionId);
        if (input.objectId) {
          if (!artifact) throw new PathFinderError('MODEL_INDEX_REQUIRED',409);
          const object = (await client.query<Row>('SELECT * FROM pf_model_objects WHERE project_id=$1 AND artifact_id=$2 AND object_id=$3',[projectId,artifact.id,input.objectId])).rows[0];
          if (!object || object.geometry_role === 'hierarchy' || object.visibility === 'hidden' || input.externalId !== null && input.externalId !== object.external_id)
            throw new PathFinderError('INVALID_LOCATION_OBJECT',409);
        } else if (input.externalId) throw new PathFinderError('OBJECT_ID_REQUIRED');
        await client.query(`INSERT INTO pf_location_bindings(project_id,location_id,model_version_id,artifact_id,point,object_id,external_id,source,confirmed_by,derivation)
          VALUES($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9) ON CONFLICT(project_id,location_id,model_version_id) DO UPDATE
          SET artifact_id=EXCLUDED.artifact_id,point=EXCLUDED.point,object_id=EXCLUDED.object_id,external_id=EXCLUDED.external_id,source='manual',
            revision=pf_location_bindings.revision+1,confirmed_by=EXCLUDED.confirmed_by,confirmed_at=NOW(),derivation=EXCLUDED.derivation`,
        [projectId,locationId,input.modelVersionId,artifact?.id ?? null,JSON.stringify(input.point),input.objectId,input.externalId,actorId,input.derivation ?? 'manual-world-point']);
        await client.query('UPDATE pf_locations SET revision=revision+1,updated_at=NOW() WHERE project_id=$1 AND id=$2',[projectId,locationId]);
        await recordLocationEvent(client,{projectId,locationId,modelVersionId:input.modelVersionId,actorId,kind:'bind',before:previousBinding,after:await bindingAuditState(client,projectId,locationId,input.modelVersionId)});
        return {locationId,registryRevision:await bumpRegistry(client,projectId)};
      });
    },
    async updateLocation(projectId: string, who: JobPrincipal, locationId: string, input: z.infer<typeof createLocationSchema>) {
      const actorId = who.userId;
      return registryTransaction(pool,projectId,who,async client => {
        await stateRevision(client,projectId,input.expectedRegistryRevision);
        if (!(await client.query('SELECT id FROM pf_locations WHERE project_id=$1 AND id=$2 FOR UPDATE',[projectId,locationId])).rows.length) throw new PathFinderError('LOCATION_NOT_FOUND',404);
        const previousLocation = await locationAuditState(client,projectId,locationId);
        const values = [...new Map([input.name,...input.aliases].map(name => [normalizeLocation(name),name.normalize('NFC').trim()])).entries()];
        const conflict = await client.query('SELECT location_id FROM pf_location_aliases WHERE project_id=$1 AND location_id<>$2 AND normalized_alias=ANY($3::text[])',[projectId,locationId,values.map(([key]) => key)]);
        if (conflict.rows.length) throw new PathFinderError('LOCATION_ALIAS_CONFLICT',409,'A name or alias already belongs to another project location.');
        await client.query('DELETE FROM pf_location_aliases WHERE project_id=$1 AND location_id=$2',[projectId,locationId]);
        for (const [normalized,display] of values) await client.query('INSERT INTO pf_location_aliases(project_id,normalized_alias,display_alias,location_id) VALUES($1,$2,$3,$4)',[projectId,normalized,display,locationId]);
        await client.query('UPDATE pf_locations SET name=$3,revision=revision+1,updated_at=NOW() WHERE project_id=$1 AND id=$2',[projectId,locationId,input.name.normalize('NFC')]);
        await recordLocationEvent(client,{projectId,locationId,actorId,kind:'update',before:previousLocation,after:await locationAuditState(client,projectId,locationId)});
        return {locationId,registryRevision:await bumpRegistry(client,projectId)};
      });
    },
    async ingestArtifact(projectId: string, who: JobPrincipal, input: z.infer<typeof artifactSchema>) {
      const actorId = who.userId;
      const snapshot = {...input.snapshot,model:{...input.snapshot.model,projectId,modelVersionId:input.modelVersionId}};
      const visibility = validateSnapshotStructure(snapshot);
      return registryTransaction(pool,projectId,who,async client => {
        await stateRevision(client,projectId,input.expectedRegistryRevision);
        const model = await activeModel(client,projectId,input.modelVersionId,input.expectedSelectionRevision);
        if (snapshot.model.contentSha256 !== model.content_fingerprint) throw new PathFinderError('MODEL_FINGERPRINT_CONFLICT',409);
        const id = randomUUID(), saved = await storeSnapshot(id,snapshot);
        await client.query(`INSERT INTO pf_artifacts(id,project_id,model_version_id,content_fingerprint,snapshot_sha256,snapshot_bytes,capture,coordinates,object_count,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,projectId,input.modelVersionId,model.content_fingerprint,saved.sha256,saved.bytes,snapshot.capture,snapshot.coordinates,snapshot.objects.length,actorId]);
        for (let start = 0; start < snapshot.objects.length; start += 1000) {
          const chunk = snapshot.objects.slice(start,start+1000).map(object => ({object_id:object.id,external_id:object.externalId ?? null,db_id:object.dbId ?? null,name:object.name,
            geometry_role:object.geometryRole,anchor:[(object.bounds.minimum[0]+object.bounds.maximum[0])/2,(object.bounds.minimum[1]+object.bounds.maximum[1])/2,object.bounds.minimum[2]],
            visibility:visibility.get(object.id),match_names:objectMatchNames(object)}));
          if (chunk.some(object => object.anchor.some(value => !Number.isFinite(value)))) throw new PathFinderError('NON_FINITE_ANCHOR');
          await client.query(`INSERT INTO pf_model_objects(project_id,artifact_id,object_id,external_id,db_id,name,geometry_role,anchor,visibility,match_names)
            SELECT $1,$2,x.object_id,x.external_id,x.db_id,x.name,x.geometry_role,x.anchor,x.visibility,x.match_names
            FROM jsonb_to_recordset($3::jsonb) AS x(object_id text,external_id text,db_id int,name text,geometry_role text,anchor jsonb,visibility text,match_names jsonb)`,[projectId,id,JSON.stringify(chunk)]);
        }
        return {artifactId:id,snapshotSha256:saved.sha256,engineeringAccepted:false,registryRevision:await bumpRegistry(client,projectId)};
      });
    },
    async match(projectId: string, who: JobPrincipal, expectedRegistryRevision: string) {
      const actorId = who.userId;
      return registryTransaction(pool,projectId,who,async client => {
        await stateRevision(client,projectId,expectedRegistryRevision);
        const model = await activeModel(client,projectId), artifact = await latestArtifact(client,projectId,model.active_model_version_id);
        const endpoints = (await client.query<{name:string}>(`SELECT DISTINCT value AS name FROM cables c CROSS JOIN LATERAL (VALUES(c.from_location),(c.to_location)) e(value)
          WHERE c.project_id=$1 AND value IS NOT NULL AND btrim(value)<>'' LIMIT 100001`,[projectId])).rows;
        if (endpoints.length > 100000) throw new PathFinderError('PROJECT_CABLE_BUDGET',413);
        let created = 0, bound = 0;
        for (const endpoint of endpoints) {
          const normalized = normalizeLocation(endpoint.name); if (!normalized) continue;
          let locationId = (await client.query<Row>('SELECT location_id FROM pf_location_aliases WHERE project_id=$1 AND normalized_alias=$2',[projectId,normalized])).rows[0]?.location_id;
          if (!locationId) {
            locationId = randomUUID(); created++;
            await client.query('INSERT INTO pf_locations(id,project_id,name,created_by) VALUES($1,$2,$3,$4)',[locationId,projectId,endpoint.name.normalize('NFC').trim(),actorId]);
            await client.query('INSERT INTO pf_location_aliases(project_id,normalized_alias,display_alias,location_id) VALUES($1,$2,$3,$4)',[projectId,normalized,endpoint.name.normalize('NFC').trim(),locationId]);
            await recordLocationEvent(client,{projectId,locationId,actorId,kind:'auto_create',before:null,after:await locationAuditState(client,projectId,locationId)});
          }
        }
        if (artifact) {
          const list = await locations(client,projectId,model.active_model_version_id,artifact.id);
          for (const location of list) {
            if (location.binding && (location.binding.modelVersionId === model.active_model_version_id && location.binding.source === 'manual' || location.binding.status === 'confirmed')) continue;
            const names = [...new Set([location.name,...location.aliases].map(normalizeLocation))];
            const candidates = await client.query<Row>(`SELECT * FROM pf_model_objects WHERE project_id=$1 AND artifact_id=$2 AND geometry_role='object'
              AND match_names ?| $3::text[] ORDER BY object_id LIMIT 3`,[projectId,artifact.id,names]);
            if (candidates.rows.length !== 1 || candidates.rows[0].visibility !== 'visible') {
              await client.query(`INSERT INTO pf_location_matches(project_id,location_id,model_version_id,status,candidate_object_ids) VALUES($1,$2,$3,$4,$5)
                ON CONFLICT(project_id,location_id,model_version_id) DO UPDATE SET status=EXCLUDED.status,candidate_object_ids=EXCLUDED.candidate_object_ids`,
              [projectId,location.id,model.active_model_version_id,candidates.rows.length > 1 ? 'ambiguous' : candidates.rows.length ? 'unverified' : 'missing',JSON.stringify(candidates.rows.map(row => row.object_id))]);
              continue;
            }
            const object = candidates.rows[0]; bound++;
            const previousBinding = await bindingAuditState(client,projectId,location.id,model.active_model_version_id);
            await client.query(`INSERT INTO pf_location_bindings(project_id,location_id,model_version_id,artifact_id,point,object_id,external_id,source,confirmed_by,derivation)
              VALUES($1,$2,$3,$4,$5,$6,$7,'automatic',$8,'equipment-bottom-aabb') ON CONFLICT(project_id,location_id,model_version_id) DO UPDATE
              SET artifact_id=EXCLUDED.artifact_id,point=EXCLUDED.point,object_id=EXCLUDED.object_id,external_id=EXCLUDED.external_id,source='automatic',
                revision=pf_location_bindings.revision+1,confirmed_by=EXCLUDED.confirmed_by,confirmed_at=NOW(),derivation=EXCLUDED.derivation WHERE pf_location_bindings.source<>'manual'`,
            [projectId,location.id,model.active_model_version_id,artifact.id,JSON.stringify(object.anchor),object.object_id,object.external_id,actorId]);
            await recordLocationEvent(client,{projectId,locationId:location.id,modelVersionId:model.active_model_version_id,actorId,kind:'auto_bind',before:previousBinding,after:await bindingAuditState(client,projectId,location.id,model.active_model_version_id)});
            await client.query('DELETE FROM pf_location_matches WHERE project_id=$1 AND location_id=$2 AND model_version_id=$3',[projectId,location.id,model.active_model_version_id]);
          }
        }
        return {createdLocations:created,matchedLocations:bound,registryRevision:created || bound ? await bumpRegistry(client,projectId) : expectedRegistryRevision};
      });
    },
  };
}
export type PathFinderRepository = ReturnType<typeof createPathFinderRepository>;
