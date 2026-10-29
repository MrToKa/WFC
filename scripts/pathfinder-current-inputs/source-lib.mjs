import { createHash } from 'node:crypto';
import { canonical, parseOutput } from '../pathfinder-capacity/lib.mjs';

export { canonical, parseOutput };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const EXPECTED = Object.freeze({
  sourceRoot: 'C:/Users/todor.chankov/source/WFC', revision: 'e1ef20202598bb4d3d78e4772cbbb9747ec23a00',
  projectId: '0c0007c9-d73f-4d13-bc87-601c544727b7', projectName: 'HPU Aalborg 2023', projectNumber: 'P230039 / H.7500062',
  contentFingerprint: 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34',
  backend: { id: 'f65cc58eea401f9c80de3be44342c3a6157f48fd6468a4d5a6b3df8ceeaac427', name: '/wfc-app-backend-1', image: 'sha256:481326351dbfa8acc86afe4d2543a1b96a05d523dd95a4715928f7f25418854f', startedAt: '2026-10-17T12:24:29.337651343Z', network: 'wfc-app_application', networkId: '244a6a5729e44f81ef9d1715948c56724e61c81eda9256ec203e9d3ce6794324', address: '172.22.0.2' },
  postgres: { id: '2f1d30dd30411bf8b7e873b893d1a87a064cd618651d1f2646b8c5d739f72f36', name: '/wfc_app', image: 'sha256:9a2e0383c38afd52cff14eeefe2b806fcde406b317002cd13ce513d309942751', startedAt: '2026-10-16T14:08:28.33027284Z', network: 'bridge', networkId: '483dccde42561d1b683ca438c01ada274eee00be1da916333661d10bb2fdf0c4', address: '172.17.0.2' },
  endpoint: { host: 'host.docker.internal', port: '5434', database: 'wfc_app', serverAddress: '172.17.0.2', serverPort: 5432 },
});
export const LIMITS = Object.freeze({ rows: 100000, outputBytes: 64 * 1024 ** 2, childMilliseconds: 35000, processMilliseconds: 45000, stderrBytes: 32768, receiptBytes: 128 * 1024 });
export const PROPERTIES = Object.freeze([
  { path: 'resources/output/0/objects_attrs.json.gz', bytes: 997, sha256: 'ee4df15128a2ad51a42603ba7a0bbfb52b1bfbf2cee07139af1fac2545fdac57' },
  { path: 'resources/output/0/objects_avs.json.gz', bytes: 4650361, sha256: '7932608146d33fc615ee6c434f9d737ce7cdd492c1a7dd8f7b2eb151a97797b4' },
  { path: 'resources/output/0/objects_ids.json.gz', bytes: 1155258, sha256: 'c0e00414833748b518ef32092affe3ccd380aa712859846a6b8f894305c1c5bb' },
  { path: 'resources/output/0/objects_offs.json.gz', bytes: 1137003, sha256: '9be8c2f8a07b056b2ba713e7896ce8d71dc0b28c5ecd99d0246023267a216de8' },
  { path: 'resources/output/0/objects_vals.json.gz', bytes: 2443733, sha256: 'ef38e808230ffc76a7669b50f3dd7ab990cf2c5026aa37900c78ae2fb949a733' },
]);
export const fail = code => { throw Object.assign(new Error(code), { code }); };
const assert = (condition, code) => { if (!condition) fail(code); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).sort().join() === [...keys].sort().join();
const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const text = x => x === null || typeof x === 'string' && x.length <= 65536;
const decimal = x => x === null || typeof x === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(x) && x.length <= 128;

export function validateContainers(containers) {
  assert(Array.isArray(containers) && containers.length === 2, 'SOURCE_CONTAINER_COUNT');
  for (const expected of [EXPECTED.backend, EXPECTED.postgres]) {
    const current = containers.find(x => x.id === expected.id), network = current?.networks?.[expected.network];
    assert(current && current.name === expected.name && current.image === expected.image && current.startedAt === expected.startedAt && current.running === true, 'SOURCE_CONTAINER_IDENTITY');
    assert(Object.keys(current.networks ?? {}).length === 1 && network?.NetworkID === expected.networkId && network.IPAddress === expected.address, 'SOURCE_CONTAINER_NETWORK');
    if (expected === EXPECTED.backend) assert(current.workingDirectory === '/app' && current.user === 'node', 'SOURCE_BACKEND_PROCESS_CONTEXT');
  }
  const postgres = containers.find(x => x.id === EXPECTED.postgres.id), ports = postgres.ports?.['5432/tcp'];
  assert(Array.isArray(ports) && ports.length === 2 && ports.every(x => x.HostPort === EXPECTED.endpoint.port) && ports.some(x => x.HostIp === '0.0.0.0') && ports.some(x => x.HostIp === '::') && Object.keys(postgres.ports).length === 1, 'SOURCE_PUBLISHED_PORT');
  return containers;
}
export function validateProbe(probe) {
  assert(object(probe) && probe.schemaVersion === 'pathfinder.current-inputs.endpoint-probe.v1' && probe.dbConnected === false && probe.host === EXPECTED.endpoint.host && probe.port === EXPECTED.endpoint.port && probe.database === EXPECTED.endpoint.database, 'SOURCE_ENDPOINT');
  assert(probe.pgVersion === '8.16.3' && probe.parserVersion === '2.9.1', 'SOURCE_PG_MODULE_VERSION');
  assert(Array.isArray(probe.addresses) && canonical([...probe.addresses].sort((a, b) => a.family - b.family)) === canonical([{ address: '192.168.65.254', family: 4 }, { address: 'fdc4:f303:9324::254', family: 6 }]), 'SOURCE_DESKTOP_DNS');
  return probe;
}
export function validateBinding(binding) {
  assert(object(binding) && binding.schemaVersion === 'pathfinder.current-inputs.binding.v1' && uuid(binding.ownerId) && binding.source?.revision === EXPECTED.revision && binding.source?.branch === 'main' && binding.source?.clean === true, 'SOURCE_BINDING_SCHEMA');
  validateContainers(binding.containers); validateProbe(binding.endpoint);
  return binding;
}
export function projectionHashes(snapshot) {
  return Object.fromEntries(['project', 'selection', 'model', 'cables'].map(key => [key, { count: Array.isArray(snapshot[key]) ? snapshot[key].length : snapshot[key] ? 1 : 0, sha256: sha256(canonical(snapshot[key])) }]));
}
export function validateSqlIdentity(result) {
  assert(exact(result, ['schemaVersion', 'status', 'identity']) && result.schemaVersion === 'pathfinder.current-inputs.sql-identity.v1' && result.status === 'OBSERVED', 'SOURCE_IDENTITY_SCHEMA');
  const identity = result.identity;
  assert(exact(identity, ['rawServerAddress', 'canonicalServerAddress', 'serverPort', 'database', 'readOnly', 'defaultReadOnly', 'isolation', 'transportError']) &&
    ['rawServerAddress', 'canonicalServerAddress'].every(key => identity[key] === null || typeof identity[key] === 'string' && identity[key].length <= 256) &&
    (identity.serverPort === null || Number.isSafeInteger(identity.serverPort) && identity.serverPort > 0 && identity.serverPort <= 65535) &&
    ['database', 'readOnly', 'defaultReadOnly', 'isolation'].every(key => typeof identity[key] === 'string' && identity[key].length <= 128) && typeof identity.transportError === 'boolean', 'SOURCE_IDENTITY_FIELDS');
  return result;
}
export function validateProjectIdentity(result) {
  assert(exact(result, ['schemaVersion', 'status', 'targetId', 'targetRows', 'discoveryRows', 'discoveryOverflow']) && result.schemaVersion === 'pathfinder.current-inputs.project-identity.v1' && result.status === 'OBSERVED' && result.targetId === EXPECTED.projectId, 'SOURCE_PROJECT_OBSERVATION_SCHEMA');
  const row = value => exact(value, ['id', 'projectNumber', 'name']) && uuid(value.id) && typeof value.projectNumber === 'string' && value.projectNumber.length <= 1000 && typeof value.name === 'string' && value.name.length <= 65536;
  assert(Array.isArray(result.targetRows) && result.targetRows.length <= 1 && result.targetRows.every(value => row(value) && value.id === EXPECTED.projectId), 'SOURCE_PROJECT_OBSERVATION_TARGET');
  assert(Array.isArray(result.discoveryRows) && result.discoveryRows.length <= 11 && result.discoveryRows.every(row) && new Set(result.discoveryRows.map(value => value.id)).size === result.discoveryRows.length && typeof result.discoveryOverflow === 'boolean' && result.discoveryOverflow === (result.discoveryRows.length > 10), 'SOURCE_PROJECT_OBSERVATION_DISCOVERY');
  assert(!result.discoveryOverflow, 'SOURCE_PROJECT_DISCOVERY_LIMIT');
  return result;
}
export function validateSnapshot(snapshot, phase) {
  assert(exact(snapshot, ['schemaVersion', 'project', 'selection', 'model', 'cables', 'source', 'transaction']) && snapshot.schemaVersion === 'pathfinder.current-inputs.snapshot.v1', 'SOURCE_SNAPSHOT_SCHEMA');
  const p = snapshot.project, m = snapshot.model, s = snapshot.selection;
  assert(exact(p, ['id', 'projectNumber', 'name', 'secondaryTrayLength', 'endConnectionLength', 'additionalBendingPercent']) && p.id === EXPECTED.projectId && typeof p.name === 'string' && p.name.normalize('NFC').trim().toUpperCase() === EXPECTED.projectName.toUpperCase() && p.projectNumber === EXPECTED.projectNumber, 'SOURCE_PROJECT_IDENTITY');
  assert(['secondaryTrayLength', 'endConnectionLength', 'additionalBendingPercent'].every(key => decimal(p[key])), 'SOURCE_DECIMAL_TRANSPORT');
  assert(exact(s, ['activeModelVersionId', 'selectionRevision']) && uuid(s.activeModelVersionId) && typeof s.selectionRevision === 'string' && /^(?:0|[1-9][0-9]{0,9})$/.test(s.selectionRevision) && BigInt(s.selectionRevision) <= 2147483647n, 'SOURCE_SELECTION');
  assert(exact(m, ['id', 'projectId', 'contentFingerprint', 'packageId', 'supportProfile', 'sdkVersion', 'entrypoint', 'state', 'health', 'propertyResources']) && m.id === s.activeModelVersionId && m.projectId === p.id && uuid(m.packageId) && m.contentFingerprint === EXPECTED.contentFingerprint && m.supportProfile === 'svf-local-7.130.0-v1' && m.sdkVersion === '7.130.0' && m.entrypoint === 'resources/output/0/0.svf' && m.state === 'ready' && m.health === 'healthy', 'SOURCE_MODEL_IDENTITY');
  assert(canonical(m.propertyResources) === canonical(PROPERTIES), 'SOURCE_PROPERTY_RESOURCE_BINDING');
  const tx = snapshot.transaction;
  assert(object(tx) && tx.phase === phase && tx.readOnly === 'on' && tx.defaultReadOnly === 'on' && tx.isolation === 'repeatable read' && tx.database === EXPECTED.endpoint.database && tx.serverAddress === EXPECTED.endpoint.serverAddress && tx.serverPort === EXPECTED.endpoint.serverPort && typeof tx.snapshot === 'string' && typeof tx.capturedAt === 'string', 'SOURCE_TRANSACTION_IDENTITY');
  assert(exact(snapshot.source, ['backendId', 'postgresId', 'revision', 'databaseHost', 'databasePort', 'database']) && snapshot.source.backendId === EXPECTED.backend.id && snapshot.source.postgresId === EXPECTED.postgres.id && snapshot.source.revision === EXPECTED.revision && snapshot.source.databaseHost === EXPECTED.endpoint.host && snapshot.source.databasePort === EXPECTED.endpoint.port && snapshot.source.database === EXPECTED.endpoint.database, 'SOURCE_SNAPSHOT_PROVENANCE');
  assert(Array.isArray(snapshot.cables) && snapshot.cables.length <= LIMITS.rows, 'SOURCE_CABLE_BUDGET');
  const ids = new Set(), numbers = new Set(); let previous = null;
  for (const cable of snapshot.cables) {
    assert(exact(cable, ['id', 'projectId', 'cableId', 'tag', 'fromLocation', 'toLocation', 'mto', 'cableTypeId', 'revision', 'updatedAt', 'typeName', 'typeProjectId']) && uuid(cable.id) && !ids.has(cable.id) && cable.projectId === p.id && Number.isSafeInteger(cable.cableId) && cable.cableId >= -2147483648 && cable.cableId <= 2147483647 && !numbers.has(cable.cableId), 'SOURCE_CABLE_IDENTITY');
    assert(cable.cableTypeId === null && cable.typeProjectId === null && cable.typeName === null || uuid(cable.cableTypeId) && cable.typeProjectId === p.id && typeof cable.typeName === 'string' && text(cable.typeName), 'SOURCE_CABLE_TYPE_OWNER');
    assert(['tag', 'fromLocation', 'toLocation', 'mto', 'revision'].every(key => text(cable[key])) && typeof cable.updatedAt === 'string' && cable.updatedAt.length <= 128 && Number.isFinite(Date.parse(cable.updatedAt)), 'SOURCE_CABLE_TEXT');
    assert(!previous || previous.cableId < cable.cableId || previous.cableId === cable.cableId && previous.id < cable.id, 'SOURCE_CABLE_ORDER');
    ids.add(cable.id); numbers.add(cable.cableId); previous = cable;
  }
  return snapshot;
}

/** This self-contained function is serialized to fixed stdin, never installed in the original container. */
export async function readSourceDatabase(config, testing) {
  const require = (ok, code, observation) => { if (!ok) throw Object.assign(new Error(code), { safeCode: code, ...(observation ? { observation } : {}) }); };
  let client, began = false, phase = 'endpoint', failureCode = null, failureObservation;
  try {
    const parser = testing?.parse ?? (await import('pg-connection-string')).parse;
    const pg = testing?.pg ?? (await import('pg')).default;
    const uri = testing ? testing.uri : process.env.DATABASE_URL;
    require(typeof uri === 'string' && uri.length > 0 && uri.length <= 8192, 'SOURCE_CONNECTION_CONFIGURATION');
    const url = new URL(uri); require(['postgres:', 'postgresql:'].includes(url.protocol), 'SOURCE_CONNECTION_PROTOCOL');
    // Reject alternate/socket/multihost and option indirection before creating a Client.
    require(url.hostname === config.endpoint.host && (url.port || '5432') === config.endpoint.port && decodeURIComponent(url.pathname.slice(1)) === config.endpoint.database, 'SOURCE_CONNECTION_ENDPOINT');
    require([...url.searchParams.keys()].every(key => ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'].includes(key)) && ![...url.searchParams.keys()].some(key => ['sslcert', 'sslkey', 'sslrootcert'].includes(key)), 'SOURCE_CONNECTION_PARAMETERS');
    const parsed = parser(uri);
    require(parsed && parsed.host === config.endpoint.host && String(parsed.port || '5432') === config.endpoint.port && parsed.database === config.endpoint.database && !('connectionString' in parsed), 'SOURCE_PARSED_ENDPOINT');
    const connection = { ...parsed, options: '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=20000', connectionTimeoutMillis: 5000, query_timeout: 20000, application_name: 'wfc-pathfinder-readonly-source-copy' };
    delete connection.connectionString;
    client = new pg.Client(connection);
    // A checked-out raw Client needs a listener throughout end(), even after a transport failure.
    let transportError = false; client.on('error', () => { transportError = true; });
    await client.connect(); phase = 'read-only-transaction';
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); began = true;
    await client.query("SET LOCAL statement_timeout = '15s'"); await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '20s'"); await client.query("SET LOCAL TIME ZONE 'UTC'");
    const tx = (await client.query(`SELECT current_database() AS database,inet_server_addr()::text AS "rawServerAddress",host(inet_server_addr()) AS "serverAddress",inet_server_port() AS "serverPort",
      current_setting('transaction_read_only') AS "readOnly",current_setting('default_transaction_read_only') AS "defaultReadOnly",
      current_setting('transaction_isolation') AS isolation,pg_current_snapshot()::text AS snapshot,CURRENT_TIMESTAMP::text AS "capturedAt"`)).rows[0];
    if (config.identityOnly === true) {
      const identity = { rawServerAddress: tx?.rawServerAddress ?? null, canonicalServerAddress: tx?.serverAddress ?? null, serverPort: tx?.serverPort ?? null,
        database: tx?.database ?? '', readOnly: tx?.readOnly ?? '', defaultReadOnly: tx?.defaultReadOnly ?? '', isolation: tx?.isolation ?? '', transportError };
      await client.query('COMMIT'); began = false;
      return { schemaVersion: 'pathfinder.current-inputs.sql-identity.v1', status: 'OBSERVED', identity };
    }
    require(tx && tx.database === config.endpoint.database && tx.serverAddress === config.endpoint.serverAddress && tx.serverPort === config.endpoint.serverPort && tx.readOnly === 'on' && tx.defaultReadOnly === 'on' && tx.isolation === 'repeatable read' && !transportError, 'SOURCE_SQL_SERVER_IDENTITY');
    if (config.projectIdentityOnly === true) {
      phase = 'project-identity';
      const targetRows = (await client.query(`SELECT id,project_number AS "projectNumber",name FROM projects WHERE id=$1::uuid LIMIT 2`, [config.projectId])).rows;
      const discoveryRows = (await client.query(`SELECT id,project_number AS "projectNumber",name FROM projects WHERE project_number ILIKE $1 OR name ILIKE $1 OR project_number ILIKE $2 OR name ILIKE $2 ORDER BY project_number,id LIMIT 11`, ['%Aalborg%', '%HPU%'])).rows;
      require(!transportError, 'SOURCE_CONNECTION_LOST'); await client.query('COMMIT'); began = false;
      return { schemaVersion: 'pathfinder.current-inputs.project-identity.v1', status: 'OBSERVED', targetId: config.projectId, targetRows, discoveryRows, discoveryOverflow: discoveryRows.length > 10 };
    }
    phase = 'project';
    const projects = (await client.query(`SELECT id,project_number AS "projectNumber",name,secondary_tray_length::text AS "secondaryTrayLength",
      end_connection_length::text AS "endConnectionLength",additional_bending_percent::text AS "additionalBendingPercent" FROM projects WHERE id=$1::uuid LIMIT 2`, [config.projectId])).rows;
    require(projects.length === 1 && projects[0].id === config.projectId && projects[0].projectNumber === config.projectNumber && typeof projects[0].name === 'string' && projects[0].name.normalize('NFC').trim().toUpperCase() === config.projectName.toUpperCase(), 'SOURCE_PROJECT_IDENTITY', { kind: 'project-identity', rows: projects.map(project => ({ id: project.id ?? null, projectNumber: project.projectNumber ?? null, name: project.name ?? null })) });
    phase = 'selection';
    const selections = (await client.query(`SELECT active_model_version_id AS "activeModelVersionId",selection_revision::text AS "selectionRevision" FROM project_model_selections WHERE project_id=$1::uuid LIMIT 2`, [config.projectId])).rows;
    require(selections.length === 1 && selections[0].activeModelVersionId, 'SOURCE_SELECTION');
    phase = 'model';
    const models = (await client.query(`SELECT m.id,m.project_id AS "projectId",m.content_fingerprint AS "contentFingerprint",m.package_id AS "packageId",
      m.support_profile AS "supportProfile",m.sdk_version AS "sdkVersion",m.entrypoint,m.state,m.health,
      (SELECT jsonb_agg(jsonb_build_object('path',r->>'path','bytes',(r->>'bytes')::bigint,'sha256',r->>'sha256') ORDER BY r->>'path')
       FROM jsonb_array_elements(m.manifest->'resources') r WHERE r->>'path'=ANY($3::text[])) AS "propertyResources"
      FROM model_versions m WHERE m.project_id=$1::uuid AND m.id=$2::uuid LIMIT 2`, [config.projectId, selections[0].activeModelVersionId, config.properties.map(x => x.path)])).rows;
    const modelIdentity = { kind: 'model-identity', rows: models.map(model => ({ id: model.id ?? null, projectId: model.projectId ?? null, contentFingerprint: model.contentFingerprint ?? null, packageId: model.packageId ?? null, state: model.state ?? null, health: model.health ?? null, propertyResources: model.propertyResources ?? null })) };
    require(models.length === 1 && models[0].id === selections[0].activeModelVersionId && models[0].projectId === config.projectId && models[0].contentFingerprint === config.contentFingerprint && models[0].state === 'ready' && models[0].health === 'healthy', 'SOURCE_MODEL_IDENTITY', modelIdentity);
    require(Array.isArray(models[0].propertyResources) && models[0].propertyResources.length === config.properties.length && models[0].propertyResources.every((resource, index) => resource.path === config.properties[index].path && resource.bytes === config.properties[index].bytes && resource.sha256 === config.properties[index].sha256 && Object.keys(resource).sort().join() === 'bytes,path,sha256'), 'SOURCE_PROPERTY_RESOURCE_BINDING', modelIdentity);
    phase = 'cable-budget';
    // Bound materialized text before returning it through pg/JSON; this projection copies no row text.
    const budget = (await client.query(`SELECT count(*)::integer AS count,COALESCE(sum(2048+6*(COALESCE(octet_length(tag),0)+COALESCE(octet_length(from_location),0)+COALESCE(octet_length(to_location),0)+COALESCE(octet_length(mto),0)+COALESCE(octet_length(revision),0)+COALESCE(octet_length("typeName"),0))),0)::text AS bytes
      FROM (SELECT c.tag,c.from_location,c.to_location,c.mto,c.revision,ct.name AS "typeName" FROM cables c LEFT JOIN cable_types ct ON ct.id=c.cable_type_id AND ct.project_id=c.project_id WHERE c.project_id=$1::uuid LIMIT 100001) bounded`, [config.projectId])).rows[0];
    require(budget && Number.isSafeInteger(budget.count) && budget.count <= config.rows, 'SOURCE_CABLE_BUDGET');
    require(typeof budget.bytes === 'string' && /^(?:0|[1-9][0-9]*)$/.test(budget.bytes) && BigInt(budget.bytes) <= BigInt(config.outputBytes - 65536), 'SOURCE_CABLE_BYTE_BUDGET');
    phase = 'cables';
    const cables = (await client.query(`SELECT c.id,c.project_id AS "projectId",c.cable_id AS "cableId",c.tag,c.from_location AS "fromLocation",c.to_location AS "toLocation",c.mto,
      c.cable_type_id AS "cableTypeId",c.revision,c.updated_at::text AS "updatedAt",ct.name AS "typeName",ct.project_id AS "typeProjectId"
      FROM cables c LEFT JOIN cable_types ct ON ct.id=c.cable_type_id AND ct.project_id=c.project_id WHERE c.project_id=$1::uuid ORDER BY c.cable_id,c.id LIMIT 100001`, [config.projectId])).rows;
    require(cables.length <= config.rows, 'SOURCE_CABLE_BUDGET'); require(cables.every(c => c.projectId === config.projectId && (c.cableTypeId === null && c.typeProjectId === null && c.typeName === null || typeof c.cableTypeId === 'string' && c.typeProjectId === config.projectId && typeof c.typeName === 'string')), 'SOURCE_CABLE_TYPE_OWNER');
    require(!transportError, 'SOURCE_CONNECTION_LOST');
    await client.query('COMMIT'); began = false;
    const result = { schemaVersion: 'pathfinder.current-inputs.snapshot.v1', project: projects[0], selection: selections[0], model: models[0], cables,
      source: { backendId: config.backendId, postgresId: config.postgresId, revision: config.revision, databaseHost: config.endpoint.host, databasePort: config.endpoint.port, database: config.endpoint.database }, transaction: { ...tx, phase: config.phase } };
    return result;
  } catch (error) {
    if (began) { try { await client.query('ROLLBACK'); } catch { /* Never mask the first sanitized failure. */ } }
    failureCode = /^[A-Z0-9_]{1,80}$/.test(error.safeCode ?? '') ? error.safeCode : 'SOURCE_DATABASE_READ_FAILED';
    failureObservation = error.observation;
    return { schemaVersion: 'pathfinder.current-inputs.source-error.v1', status: 'FAIL', phase, code: failureCode, ...(failureObservation ? { observation: failureObservation } : {}) };
  } finally { if (client) { try { await client.end(); } catch { return { schemaVersion: 'pathfinder.current-inputs.source-error.v1', status: 'FAIL', phase: 'close', code: failureCode ?? 'SOURCE_CONNECTION_CLOSE_FAILED', closeFailed: true, ...(failureObservation ? { observation: failureObservation } : {}) }; } } }
}

export function buildReadProgram(binding, phase) {
  validateBinding(binding); assert(['before', 'copy', 'after'].includes(phase), 'SOURCE_PHASE');
  const config = { endpoint: EXPECTED.endpoint, projectId: EXPECTED.projectId, projectName: EXPECTED.projectName, projectNumber: EXPECTED.projectNumber, contentFingerprint: EXPECTED.contentFingerprint,
    backendId: EXPECTED.backend.id, postgresId: EXPECTED.postgres.id, revision: EXPECTED.revision, properties: PROPERTIES, rows: LIMITS.rows, outputBytes: LIMITS.outputBytes, phase };
  return renderReadProgram(config);
}
export function buildIdentityProgram(binding) {
  validateBinding(binding);
  return renderReadProgram({ endpoint: EXPECTED.endpoint, identityOnly: true });
}
export function buildProjectIdentityProgram(binding) {
  validateBinding(binding);
  return renderReadProgram({ endpoint: EXPECTED.endpoint, projectIdentityOnly: true, projectId: EXPECTED.projectId });
}
function renderReadProgram(config) {
  return guardedProgram(`let result=await (${readSourceDatabase.toString()})(${JSON.stringify(config)});let text=JSON.stringify(result);if(Buffer.byteLength(text)>${LIMITS.outputBytes}){result={schemaVersion:'pathfinder.current-inputs.source-error.v1',status:'FAIL',phase:'output',code:'SOURCE_OUTPUT_BUDGET'};text=JSON.stringify(result);}await new Promise((resolve,reject)=>process.stdout.write(text+'\\n',error=>error?reject(error):resolve()));if(result.status==='FAIL')process.exitCode=2;`);
}

/** Shared generator permits a short no-DB watchdog test; production always uses the fixed limit. */
export function guardedProgram(body, milliseconds = LIMITS.childMilliseconds) {
  assert(typeof body === 'string' && Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= LIMITS.childMilliseconds, 'SOURCE_WATCHDOG_ARGUMENTS');
  return `const watchdog=setTimeout(()=>{const failure=JSON.stringify({schemaVersion:'pathfinder.current-inputs.source-error.v1',status:'FAIL',phase:'deadline',code:'SOURCE_IN_CONTAINER_DEADLINE'})+'\\n';process.stdout.write(failure,()=>process.exit(2));setTimeout(()=>process.exit(2),100);},${milliseconds});try{${body}}finally{clearTimeout(watchdog);}`;
}

export const METADATA_FORMAT = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},"workingDirectory":{{json .Config.WorkingDir}},"user":{{json .Config.User}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}},"extraHosts":{{json .HostConfig.ExtraHosts}}}';
export const PROBE_PROGRAM = guardedProgram(`try{const fs=await import('node:fs'),dns=await import('node:dns/promises');const uri=process.env.DATABASE_URL;if(!uri)throw 0;const u=new URL(uri);if(!['postgres:','postgresql:'].includes(u.protocol))throw 0;const host=u.hostname,port=u.port||'5432',database=decodeURIComponent(u.pathname.slice(1));const addresses=await dns.lookup(host,{all:true});const pg=JSON.parse(fs.readFileSync('/app/node_modules/pg/package.json','utf8'));const parser=JSON.parse(fs.readFileSync('/app/node_modules/pg-connection-string/package.json','utf8'));const result={schemaVersion:'pathfinder.current-inputs.endpoint-probe.v1',host,port,database,addresses:addresses.map(x=>({address:x.address,family:x.family})),pgVersion:pg.version,parserVersion:parser.version,dbConnected:false};await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(result)+'\\n',error=>error?reject(error):resolve()));}catch{await new Promise(resolve=>process.stdout.write(JSON.stringify({schemaVersion:'pathfinder.current-inputs.endpoint-probe.v1',status:'FAIL',code:'ENDPOINT_PROBE_FAILED',dbConnected:false})+'\\n',resolve));process.exitCode=2;}`, 7000);
