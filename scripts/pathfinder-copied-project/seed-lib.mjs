import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, parseOutput, validateSnapshot } from '../pathfinder-current-inputs/source-lib.mjs';

export { canonical, parseOutput };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const SEED_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const EXPECTED = Object.freeze({
  runtime: 'pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600',
  owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46', project: 'wfc-pathfinder-local-0cba87606e9b', port: 5191,
  apiImage: 'sha256:dce12a1f5ab6311bbaf04defb7277ff0d50fee36e29e49d47234e5bf4ea405fe',
  webImage: 'sha256:561d51c3dd5ecb88459c17013890f9cd30089bb0760ccb9c5ff0ec3ade39f285',
  pgImage: 'sha256:9a2e0383c38afd52cff14eeefe2b806fcde406b317002cd13ce513d309942751',
  snapshot: { path: 'pathfinder-engine/.scratch/current-inputs-2b20a8ae-a435-4d4d-aec4-005bb021a715/current-inputs.private.json', bytes: 922311, sha256: '0a84d1327950d4bd1d8420661f526cf1c97fdec5dbaaca71c429bf3e0c3bd897' },
  receipt: { path: 'docs/pathfinder/evidence/current-inputs/source-copy-fullname-20261018T1533Z.json', sha256: 'a1c9e90a2c48e9da4d619cc3a4d5a90c1a9c2ae2c4b91fc99c9d396f5aba2c02' },
  description: 'Isolated engineering review copy. Original cable routes and lengths were not copied. Calculated proposals require manual review.',
});
export const LIMITS = Object.freeze({ inputBytes: 2 * 1024 ** 2, planBytes: 2 * 1024 ** 2, outputBytes: 16 * 1024 ** 2, stderrBytes: 32768, childMilliseconds: 55000, hostMilliseconds: 60000, receiptBytes: 131072 });
export const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireThat = (ok, code) => { if (!ok) fail(code); };
const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const exact = (x, keys) => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).sort().join() === [...keys].sort().join();
const equal = (a, b) => canonical(a) === canonical(b);

/** Uses only retained bytes; this function never connects to either application. */
export function validateSeedSource(snapshot) {
  validateSnapshot(snapshot, 'copy');
  requireThat(snapshot.cables.length === 2140, 'SEED_SOURCE_COUNTS');
  requireThat(snapshot.project.endConnectionLength !== null && snapshot.project.additionalBendingPercent !== null, 'SEED_REQUIRED_ALLOWANCE');
  const types = new Map();
  for (const cable of snapshot.cables) {
    requireThat(uuid(cable.cableTypeId) && cable.typeProjectId === snapshot.project.id && typeof cable.typeName === 'string' && cable.typeName.trim().length > 0, 'SEED_TYPE_REQUIRED');
    requireThat(['MV', 'LV', 'Control', 'Instrumentation'].includes(cable.mto), 'SEED_CATEGORY_REQUIRED');
    requireThat(!types.has(cable.cableTypeId) || types.get(cable.cableTypeId) === cable.typeName, 'SEED_TYPE_CONFLICT');
    types.set(cable.cableTypeId, cable.typeName);
  }
  requireThat(types.size === 50, 'SEED_TYPE_COUNTS');
  return snapshot;
}

export function verifySeedInput(snapshotBytes, receiptBytes) {
  requireThat(snapshotBytes.length === EXPECTED.snapshot.bytes && sha256(snapshotBytes) === EXPECTED.snapshot.sha256, 'SEED_SOURCE_HASH');
  requireThat(sha256(receiptBytes) === EXPECTED.receipt.sha256, 'SEED_RECEIPT_HASH');
  const receipt = parseOutput(receiptBytes, LIMITS.receiptBytes);
  requireThat(receipt.schemaVersion === 'pathfinder.current-inputs.source-receipt.v1' && receipt.status === 'PASS' && receipt.preservation?.status === 'PASS' && equal(receipt.privateSnapshot, EXPECTED.snapshot), 'SEED_RECEIPT_BINDING');
  const snapshot = validateSeedSource(parseOutput(snapshotBytes, LIMITS.inputBytes));
  requireThat(receipt.checkedModelFingerprint === snapshot.model.contentFingerprint, 'SEED_RECEIPT_MODEL');
  return snapshot;
}

export function seedProject(snapshot, id) {
  return { id, projectNumber: 'PF-COPY-' + id.replaceAll('-', '').slice(0, 12), name: snapshot.project.name + ' — copied engineering inputs',
    customer: 'Isolated local engineering review', description: EXPECTED.description,
    secondaryTrayLength: snapshot.project.secondaryTrayLength, endConnectionLength: snapshot.project.endConnectionLength,
    additionalBendingPercent: snapshot.project.additionalBendingPercent, connectionGap: '1' };
}
export function createSeedPlan(snapshot, { makeUuid = randomUUID, now = new Date().toISOString() } = {}) {
  validateSeedSource(snapshot);
  const used = new Set([snapshot.project.id, snapshot.model.id, snapshot.model.packageId, ...snapshot.cables.flatMap(c => [c.id, c.cableTypeId])]);
  const fresh = () => { const id = makeUuid(); requireThat(uuid(id) && !used.has(id), 'SEED_UUID_COLLISION'); used.add(id); return id; };
  const id = fresh(), typeNames = new Map(snapshot.cables.map(c => [c.cableTypeId, c.typeName]));
  const types = [...typeNames].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([sourceId, name]) => ({ sourceId, id: fresh(), name }));
  const byType = new Map(types.map(t => [t.sourceId, t.id]));
  const plan = { schemaVersion: 'pathfinder.copied-project.seed-plan.v1', id, createdAt: now,
    target: Object.fromEntries(['runtime', 'owner', 'project', 'port', 'apiImage', 'webImage'].map(k => [k, EXPECTED[k]])),
    source: { snapshot: { ...EXPECTED.snapshot }, receipt: { ...EXPECTED.receipt }, projectId: snapshot.project.id, modelVersionId: snapshot.model.id, contentFingerprint: snapshot.model.contentFingerprint },
    newProject: seedProject(snapshot, id), types,
    cables: snapshot.cables.map(c => ({ sourceId: c.id, id: fresh(), cableId: c.cableId, typeId: byType.get(c.cableTypeId), revision: c.revision, mto: c.mto, tag: c.tag, fromLocation: c.fromLocation, toLocation: c.toLocation })) };
  return validateSeedPlan(plan, snapshot);
}
export function validateSeedPlan(plan, snapshot) {
  validateSeedSource(snapshot);
  requireThat(exact(plan, ['schemaVersion', 'id', 'createdAt', 'target', 'source', 'newProject', 'types', 'cables']) && plan.schemaVersion === 'pathfinder.copied-project.seed-plan.v1' && uuid(plan.id) && typeof plan.createdAt === 'string' && Number.isFinite(Date.parse(plan.createdAt)), 'SEED_PLAN_SCHEMA');
  requireThat(equal(plan.target, Object.fromEntries(['runtime', 'owner', 'project', 'port', 'apiImage', 'webImage'].map(k => [k, EXPECTED[k]]))), 'SEED_PLAN_TARGET');
  requireThat(equal(plan.source, { snapshot: EXPECTED.snapshot, receipt: EXPECTED.receipt, projectId: snapshot.project.id, modelVersionId: snapshot.model.id, contentFingerprint: snapshot.model.contentFingerprint }), 'SEED_PLAN_SOURCE');
  requireThat(equal(plan.newProject, seedProject(snapshot, plan.id)) && Array.isArray(plan.types) && plan.types.length === 50 && Array.isArray(plan.cables) && plan.cables.length === 2140, 'SEED_PLAN_PROJECT');
  const forbidden = new Set([snapshot.project.id, snapshot.model.id, snapshot.model.packageId, ...snapshot.cables.flatMap(c => [c.id, c.cableTypeId])]), used = new Set();
  for (const id of [plan.id, ...plan.types.map(t => t.id), ...plan.cables.map(c => c.id)]) { requireThat(uuid(id) && !forbidden.has(id) && !used.has(id), 'SEED_UUID_COLLISION'); used.add(id); }
  const sourceTypes = [...new Map(snapshot.cables.map(c => [c.cableTypeId, c.typeName]))].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  plan.types.forEach((t, i) => requireThat(exact(t, ['sourceId', 'id', 'name']) && t.sourceId === sourceTypes[i][0] && t.name === sourceTypes[i][1], 'SEED_PLAN_TYPE'));
  const byType = new Map(plan.types.map(t => [t.sourceId, t.id]));
  plan.cables.forEach((c, i) => { const s = snapshot.cables[i]; requireThat(equal(c, { sourceId: s.id, id: c.id, cableId: s.cableId, typeId: byType.get(s.cableTypeId), revision: s.revision, mto: s.mto, tag: s.tag, fromLocation: s.fromLocation, toLocation: s.toLocation }), 'SEED_PLAN_CABLE'); });
  requireThat(Buffer.byteLength(JSON.stringify(plan)) <= LIMITS.planBytes, 'SEED_PLAN_BUDGET');
  return plan;
}

/** Closed, nonsecret Docker projections supplied by either additive tool. */
export function validateSeedTarget(state, containers, network) {
  requireThat(state?.root === SEED_ROOT && state.runtime === path.join(SEED_ROOT, EXPECTED.runtime) && state.owner === EXPECTED.owner && state.project === EXPECTED.project && state.port === EXPECTED.port && state.images?.api === EXPECTED.apiImage && state.images?.web === EXPECTED.webImage, 'SEED_TARGET_STATE');
  requireThat(Array.isArray(containers) && containers.length === 3, 'SEED_TARGET_CONTAINERS');
  const roles = ['api', 'postgres', 'web'], result = {};
  for (const role of roles) {
    const row = containers.find(c => c.name === '/' + state.project + '-' + role + '-1');
    requireThat(row && /^[a-f0-9]{64}$/.test(row.id ?? '') && row.running === true && typeof row.startedAt === 'string' && Number.isFinite(Date.parse(row.startedAt)) && row.image === (role === 'postgres' ? EXPECTED.pgImage : EXPECTED[role + 'Image']), 'SEED_TARGET_IDENTITY');
    requireThat(row.labels?.['wfc.pathfinder.owner'] === state.owner && row.labels?.['wfc.pathfinder.project'] === state.project && row.labels?.['wfc.pathfinder.isolated'] === 'true' && row.labels?.['com.docker.compose.project'] === state.project && row.labels?.['com.docker.compose.service'] === role, 'SEED_TARGET_LABELS');
    requireThat(equal(Object.keys(row.networks ?? {}).sort(), (role === 'web' ? [state.project + '_backend', state.project + '_front'] : [state.project + '_backend']).sort()), 'SEED_TARGET_NETWORK');
    const mounts = role === 'api' ? [['staging', '/var/lib/wfc/model-imports'], ['pathfinder', '/var/lib/wfc/pathfinder']] : role === 'postgres' ? [['postgres', '/var/lib/postgresql']] : [];
    requireThat(Array.isArray(row.mounts) && row.mounts.length === mounts.length && mounts.every(([name, destination]) => row.mounts.some(m => m.Type === 'volume' && m.Name === state.project + '_' + name && m.Destination === destination && m.RW === true)), 'SEED_TARGET_MOUNTS');
    const ports = Object.values(row.ports ?? {}).flat();
    requireThat(role === 'web' ? ports.length === 1 && ports[0].HostIp === '127.0.0.1' && ports[0].HostPort === '5191' : ports.length === 0, 'SEED_TARGET_PORT');
    result[role] = row;
  }
  const backend = state.project + '_backend';
  requireThat(network?.name === backend && /^[a-f0-9]{64}$/.test(network.id ?? '') && network.internal === true && network.labels?.['wfc.pathfinder.owner'] === state.owner && network.labels?.['wfc.pathfinder.project'] === state.project && network.labels?.['wfc.pathfinder.isolated'] === 'true' && Array.isArray(network.containers) && roles.every(role => network.containers.includes(result[role].id)) && roles.every(role => result[role].networks[backend].NetworkID === network.id), 'SEED_TARGET_BACKEND');
  const address = result.postgres.networks[backend].IPAddress;
  requireThat(typeof address === 'string' && /^172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}$/.test(address), 'SEED_TARGET_ADDRESS');
  return { owner: state.owner, project: state.project, port: 5191, apiId: result.api.id, apiImage: result.api.image, pgId: result.postgres.id, pgImage: result.postgres.image, webId: result.web.id, webImage: result.web.image, backendNetworkId: network.id, serverAddress: address, startedAt: Object.fromEntries(roles.map(role => [role, result[role].startedAt])) };
}

/** Serialized fixed helper; testing injects only a fake Client, never a CLI bypass. */
export async function seedDatabase(config, testing) {
  const require = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { safeCode: code }); };
  const canonical = x => x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
  const same = (a, b) => canonical(a) === canonical(b), plan = config.plan, project = plan.newProject;
  let client, result, began = false, writes = false, commitAttempted = false, commitConfirmed = false, transportError = false, phase = 'connection';
  const connectionError = () => { transportError = true; };
  try {
    require(['apply', 'verify'].includes(config.mode) && plan.schemaVersion === 'pathfinder.copied-project.seed-plan.v1' && plan.types.length === 50 && plan.cables.length === 2140 && plan.target.owner === config.target.owner && plan.target.project === config.target.project && plan.target.port === 5191, 'SEED_HELPER_SCOPE');
    if (testing) client = testing.client;
    else {
      const { Client } = await import('pg'), { parse } = await import('pg-connection-string');
      const parsed = parse(process.env.DATABASE_URL ?? '');
      require(parsed.host === 'postgres' && parsed.port === '5432' && parsed.database === 'wfc_pathfinder_local' && parsed.user === 'pf_local' && /^[a-f0-9]{64}$/.test(parsed.password ?? ''), 'SEED_HELPER_ENDPOINT');
      client = new Client({ host: 'postgres', port: 5432, database: 'wfc_pathfinder_local', user: 'pf_local', password: parsed.password, connectionTimeoutMillis: 5000, query_timeout: 10000,
        application_name: 'wfc-copied-engineering-seed', options: '-c statement_timeout=8000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=10000 -c default_transaction_read_only=' + (config.mode === 'verify' ? 'on' : 'off') });
    }
    client.on('error', connectionError); await client.connect();
    await client.query(config.mode === 'verify' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE'); began = true;
    await client.query("SET LOCAL statement_timeout='8s'"); await client.query("SET LOCAL lock_timeout='3s'"); await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
    const identity = (await client.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('transaction_read_only') AS ro")).rows[0];
    require(identity?.database === 'wfc_pathfinder_local' && identity.address === config.target.serverAddress && identity.port === 5432 && identity.ro === (config.mode === 'verify' ? 'on' : 'off') && !transportError, 'SEED_SQL_IDENTITY');
    phase = 'preflight';
    require((await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked", ['wfc-copied-inputs:' + project.id])).rows[0]?.locked === true, 'SEED_BUSY');
    const exists = (await client.query('SELECT id,project_number FROM projects WHERE id=$1 OR project_number=$2' + (config.mode === 'apply' ? ' FOR SHARE' : ''), [project.id, project.projectNumber])).rows;
    require(exists.length <= 1 && (!exists.length || exists[0].id === project.id && exists[0].project_number === project.projectNumber), 'SEED_PROJECT_COLLISION');
    require((await client.query('SELECT project_id FROM pf_synthetic_projects WHERE project_id=$1', [project.id])).rows.length === 0, 'SEED_SYNTHETIC_REFUSED');
    require((await client.query('SELECT lower(name) AS name FROM unnest($1::text[]) AS n(name) GROUP BY lower(name) HAVING count(*)>1 LIMIT 1', [plan.types.map(t => t.name)])).rows.length === 0, 'SEED_TYPE_NAME_COLLISION');
    if (!exists.length) {
      require(config.mode === 'apply', 'SEED_NOT_FOUND');
      const collisions = (await client.query("SELECT id FROM cable_types WHERE id=ANY($1::uuid[]) UNION ALL SELECT id FROM cables WHERE id=ANY($2::uuid[]) LIMIT 1", [plan.types.map(t => t.id), plan.cables.map(c => c.id)])).rows;
      require(collisions.length === 0, 'SEED_ROW_ID_COLLISION'); phase = 'inserting'; writes = true;
      await client.query('INSERT INTO projects(id,project_number,name,customer,description,secondary_tray_length,end_connection_length,additional_bending_percent,connection_gap) VALUES($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric,$9::numeric)', [project.id, project.projectNumber, project.name, project.customer, project.description, project.secondaryTrayLength, project.endConnectionLength, project.additionalBendingPercent, project.connectionGap]);
      await client.query('INSERT INTO cable_types(id,project_id,name) SELECT id,$1::uuid,name FROM jsonb_to_recordset($2::jsonb) AS t(id uuid,name text)', [project.id, JSON.stringify(plan.types.map(t => ({ id: t.id, name: t.name })))]);
      for (let offset = 0; offset < plan.cables.length; offset += 500) {
        require(!transportError, 'SEED_CONNECTION_LOST');
        await client.query('INSERT INTO cables(id,project_id,cable_id,cable_type_id,revision,mto,tag,from_location,to_location,routing,design_length,install_length) SELECT id,$1::uuid,"cableId","typeId",revision,mto,tag,"fromLocation","toLocation",NULL,NULL,NULL FROM jsonb_to_recordset($2::jsonb) AS t(id uuid,"cableId" integer,"typeId" uuid,revision text,mto text,tag text,"fromLocation" text,"toLocation" text)', [project.id, JSON.stringify(plan.cables.slice(offset, offset + 500).map(({ sourceId: _sourceId, ...c }) => c))]);
      }
    }
    phase = 'verification';
    const projectRows = (await client.query('SELECT id,project_number AS "projectNumber",name,customer,description,secondary_tray_length::text AS "secondaryTrayLength",end_connection_length::text AS "endConnectionLength",additional_bending_percent::text AS "additionalBendingPercent",connection_gap::text AS "connectionGap" FROM projects WHERE id=$1', [project.id])).rows;
    require(projectRows.length === 1 && same(projectRows[0], project), 'SEED_PROJECT_MISMATCH');
    const types = (await client.query('SELECT id,name,tag,purpose,diameter_mm::text,weight_kg_per_m::text,from_location,to_location,routing,material,description,manufacturer,part_no,remarks,source_material_cable_type_id,change_log FROM cable_types WHERE project_id=$1 ORDER BY id LIMIT 51', [project.id])).rows;
    require(types.length === 50 && types.every(t => { const expected = plan.types.find(x => x.id === t.id); return expected && t.name === expected.name && Object.entries(t).every(([k, v]) => {
      if (['id', 'name'].includes(k)) return true;
      return k === 'change_log' ? Array.isArray(v) && !v.length : v === null;
    }); }), 'SEED_TYPES_MISMATCH');
    const cables = (await client.query('SELECT id,cable_id AS "cableId",cable_type_id AS "typeId",revision,mto,tag,from_location AS "fromLocation",to_location AS "toLocation",routing,design_length,install_length,delivery,pull_date::text,connected_from::text,connected_to::text,tested::text,materials_initialized,materials_customized,change_log,cable_write_revision::text AS "cableWriteRevision" FROM cables WHERE project_id=$1 ORDER BY cable_id,id LIMIT 2141', [project.id])).rows;
    require(cables.length === 2140 && cables.every((c, i) => { const { sourceId: _sourceId, ...expected } = plan.cables[i]; return same(c, { ...expected, routing: null, design_length: null, install_length: null, delivery: null, pull_date: null, connected_from: null, connected_to: null, tested: null, materials_initialized: false, materials_customized: false, change_log: [], cableWriteRevision: '0' }); }), 'SEED_CABLES_MISMATCH');
    const selections = (await client.query('SELECT active_model_version_id,selection_revision::text AS revision FROM project_model_selections WHERE project_id=$1', [project.id])).rows;
    const registries = (await client.query('SELECT registry_revision::text AS revision FROM pf_project_state WHERE project_id=$1', [project.id])).rows;
    require(selections.length === 1 && selections[0].active_model_version_id === null && selections[0].revision === '0' && registries.length === 1 && registries[0].revision === '0', 'SEED_INITIAL_STATE_MISMATCH');
    const unrelated = (await client.query('SELECT (SELECT count(*)::text FROM pf_locations WHERE project_id=$1) AS locations,(SELECT count(*)::text FROM model_versions WHERE project_id=$1) AS versions,(SELECT count(*)::text FROM pf_jobs WHERE project_id=$1) AS jobs,(SELECT count(*)::text FROM pf_synthetic_projects WHERE project_id=$1) AS synthetic', [project.id])).rows[0];
    require(unrelated && Object.values(unrelated).every(v => v === '0') && !transportError, 'SEED_UNEXPECTED_WORKFLOW');
    phase = 'commit'; commitAttempted = true; await client.query('COMMIT'); began = false; commitConfirmed = true;
    result = { schemaVersion: 'pathfinder.copied-project.seed-result.v1', status: 'PASS', operation: writes ? 'created' : 'already_seeded', mode: config.mode, phase, commitConfirmed, identity, projectId: project.id,
      counts: { projects: 1, types: 50, cables: 2140, selections: 1, pathfinderStates: 1 }, syntheticMarker: false, projections: { project: projectRows, types, cables, selections, registries }, transportError };
  } catch (error) {
    let rollbackConfirmed = false; if (began) try { await client.query('ROLLBACK'); rollbackConfirmed = true; began = false; } catch { /* Preserve uncertain outcome. */ }
    result = { schemaVersion: 'pathfinder.copied-project.seed-result.v1', status: 'FAIL', error: error.safeCode ?? 'SEED_DATABASE_FAILURE', phase, writesAttempted: writes, commitAttempted, commitConfirmed, rollbackConfirmed, transportError,
      outcome: commitAttempted && !commitConfirmed ? 'unknown' : rollbackConfirmed || !writes ? 'not_committed' : 'unknown' };
  } finally {
    // The listener stays installed through end; late connection errors cannot crash the helper.
    if (client) try { await client.end(); } catch { transportError = true; result = { ...result, status: 'FAIL', error: 'SEED_CLOSE_FAILED', outcome: commitConfirmed ? 'committed' : 'unknown' }; }
  }
  if (transportError) result = { ...result, status: 'FAIL', error: result.error ?? 'SEED_CONNECTION_LOST', transportError: true, outcome: commitConfirmed ? 'committed' : result.outcome ?? 'unknown' };
  return result;
}

export function buildSeedProgram() {
  return `const timer=setTimeout(()=>{process.stdout.write(JSON.stringify({schemaVersion:'pathfinder.copied-project.seed-result.v1',status:'FAIL',error:'SEED_HARD_DEADLINE',outcome:'unknown'})+String.fromCharCode(10),()=>process.exit(2));setTimeout(()=>process.exit(2),200);},${LIMITS.childMilliseconds});\ntry{let bytes=0,chunks=[];for await(const c of process.stdin){bytes+=c.length;if(bytes>${LIMITS.planBytes + 65536})throw Error('SEED_INPUT_LIMIT');chunks.push(c);}const config=JSON.parse(Buffer.concat(chunks).toString('utf8'));const result=await (${seedDatabase.toString()})(config);await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(result)+String.fromCharCode(10),e=>e?reject(e):resolve()));process.exitCode=result.status==='PASS'?0:2;clearTimeout(timer);}catch{process.stdout.write(JSON.stringify({schemaVersion:'pathfinder.copied-project.seed-result.v1',status:'FAIL',error:'SEED_HELPER_FAILURE',outcome:'unknown'})+String.fromCharCode(10),()=>process.exit(2));setTimeout(()=>process.exit(2),200);}`;
}
