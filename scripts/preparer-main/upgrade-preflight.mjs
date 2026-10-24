// SP-6 clone-only migration and image rollback qualification. No application or
// database initializer is imported into this operator/capture process.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDocker, environment, writePrivateJson } from './foundation/docker.mjs';
import { withBoundedDockerExecution, cleanupBoundedDockerHelper, getBoundedDockerCleanup } from './foundation/docker-bounds.mjs';
import { assertCanonicalPath, hashFile } from './foundation/archives.mjs';
import { verifyArchive as verifyPostgresArchive } from './pg-root-archives.mjs';
import { writeJsonNew } from './foundation/manifest.mjs';
import { OFFLINE_SEED_BOUNDS, canonicalSha256 } from './offline-seed.mjs';
import { verifyColdSeed, verifiedPostgresDataIdentity, recoveryCloneWitness } from './recovery.mjs';
import { capturePublicGlobals, validatePublicGlobals, GLOBAL_SQL_V2 } from './recovery-leaves/global-sql-v2.mjs';
import { compareCurrentInventories, currentInventoryCanonicalHash, currentInventorySchemaMetadata } from './recovery-leaves/current-inventory-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, SHA = /^[a-f0-9]{64}$/, IMAGE = /^sha256:[a-f0-9]{64}$/;
const need = (value, code) => { if (!value) throw Object.assign(Error(code), { code }); };
const same = (a, b) => canonicalSha256(a) === canonicalSha256(b);
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const safeCode = error => /^[A-Z0-9_]{3,80}$/.test(error?.code ?? '') ? error.code : 'UPGRADE_PREFLIGHT_FAILED';
const mount = (source, target, readOnly = true, type = 'bind') => ({ Type: type, Source: source, Target: target, ReadOnly: readOnly });
const pin = async filename => ({ path: filename, ...await hashFile(filename) });
const active = value => value?.State?.Running === true || value?.State?.Restarting === true;
export const UPGRADE_BOUNDS = Object.freeze({ ...OFFLINE_SEED_BOUNDS, archiveOwnership: undefined, helperMemoryBytes: 1024 ** 3 });
const CLEANUP_BOUNDS = Object.freeze({ ...UPGRADE_BOUNDS, operationTimeoutMs: 600000, commandTimeoutMs: 180000, requestTimeoutMs: 180000, helperTimeoutMs: 180000 });
const NEW_TABLE = 'model_package_archives';
const RELATIONS = Object.freeze([NEW_TABLE, NEW_TABLE + '_pkey', NEW_TABLE + '_storage_prefix_key', NEW_TABLE + '_version']);
// Same clone-only read-only cluster adjunct as recovery.mjs. OIDs and vacuum
// counters are excluded; role credentials remain only in private evidence.
const CLUSTER_SQL = Object.freeze({
  roles: `SELECT to_jsonb(r)-'oid' value FROM pg_authid r ORDER BY rolname COLLATE "C"`,
  memberships: `SELECT jsonb_build_object('role',r.rolname,'member',m.rolname,'grantor',g.rolname,'adminOption',a.admin_option,'inheritOption',a.inherit_option,'setOption',a.set_option) value FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor ORDER BY r.rolname COLLATE "C",m.rolname COLLATE "C",g.rolname COLLATE "C"`,
  database: `SELECT (to_jsonb(d)-ARRAY['oid','datdba','dattablespace','datacl','datfrozenxid','datminmxid'])||jsonb_build_object('owner',pg_get_userbyid(d.datdba),'tablespace',t.spcname,'acl',COALESCE((SELECT jsonb_agg(jsonb_build_object('grantor',g.rolname,'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY g.rolname COLLATE "C",(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE r.rolname END) COLLATE "C",x.privilege_type COLLATE "C",x.is_grantable) FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) x LEFT JOIN pg_roles g ON g.oid=x.grantor LEFT JOIN pg_roles r ON r.oid=x.grantee),'[]'::jsonb)) value FROM pg_database d JOIN pg_tablespace t ON t.oid=d.dattablespace WHERE d.datname=current_database()`,
  settings: `SELECT jsonb_build_object('database',COALESCE(d.datname,'*'),'role',COALESCE(r.rolname,'*'),'settings',s.setconfig) value FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase LEFT JOIN pg_roles r ON r.oid=s.setrole WHERE s.setdatabase=0 OR d.datname=current_database() ORDER BY COALESCE(d.datname,'*') COLLATE "C",COALESCE(r.rolname,'*') COLLATE "C"`,
});

// Literal candidate additions, reviewed against server/modelRegistry/schema.ts.
// TEMP execution below obtains this PostgreSQL version's exact deparser output;
// actual candidate output never defines its own allowlist.
export const ARCHIVE_TABLE_DDL = `CREATE TEMP TABLE model_package_archives (
  import_id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  model_version_id UUID NOT NULL,
  storage_prefix TEXT NOT NULL UNIQUE,
  owner_token UUID NOT NULL,
  archive_sha256 TEXT NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  archive_bytes BIGINT NOT NULL CHECK (archive_bytes >= 0 AND archive_bytes <= 2147483648),
  published BOOLEAN NOT NULL DEFAULT FALSE,
  cleaned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (storage_prefix = 'archives/' || project_id::text || '/' || import_id::text || '/'),
  CHECK (NOT published OR cleaned_at IS NULL)
);`;
const ARCHIVE_INDEX_DDL = `CREATE INDEX model_package_archives_version ON model_package_archives(project_id,model_version_id,created_at,import_id) WHERE published=TRUE;`;
const ARCHIVE_TRIGGER_DDL = `CREATE TRIGGER protect_package_archive_ownership BEFORE UPDATE ON model_package_archives FOR EACH ROW EXECUTE FUNCTION protect_model_storage_ownership();`;
const sqlWhitespace = value => value.replace(/\s+/g, ' ').trim();
export function assertArchiveContractSource(source) {
  need(typeof source === 'string', 'UPGRADE_ARCHIVE_CONTRACT_SOURCE_CHANGED');
  const table = source.match(/CREATE TABLE IF NOT EXISTS model_package_archives \([\s\S]*?\);/g);
  const index = source.match(/CREATE INDEX IF NOT EXISTS model_package_archives_version[\s\S]*?;/g);
  const trigger = source.match(/CREATE TRIGGER protect_package_archive_ownership[\s\S]*?;/g);
  need(table?.length === 1 && index?.length === 1 && trigger?.length === 1
    && sqlWhitespace(table[0]) === sqlWhitespace(ARCHIVE_TABLE_DDL.replace('CREATE TEMP TABLE', 'CREATE TABLE IF NOT EXISTS'))
    && sqlWhitespace(index[0]) === sqlWhitespace(ARCHIVE_INDEX_DDL.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS'))
    && sqlWhitespace(trigger[0]) === sqlWhitespace(ARCHIVE_TRIGGER_DDL), 'UPGRADE_ARCHIVE_CONTRACT_SOURCE_CHANGED');
  return true;
}
export function upgradeResourceNames(operationId) {
  need(UUID.test(operationId ?? ''), 'UPGRADE_OPERATION_INVALID'); const prefix = 'wfc-preparer-sp6-' + operationId;
  return Object.freeze({ network: prefix, postgres: prefix + '-postgres', minio: prefix + '-minio', staging: prefix + '-staging', candidate: prefix + '-candidate', rollback: prefix + '-rollback' });
}
export function upgradeResourceIntents(operationId) {
  const names = upgradeResourceNames(operationId);
  return Object.freeze([['network', 'network'], ...['postgres', 'minio', 'staging'].map(role => ['volume', role]), ...['postgres', 'minio', 'candidate', 'rollback'].map(role => ['container', role])]
    .map(([kind, role]) => Object.freeze({ kind, role, name: names[role], state: 'not-attempted' })));
}
export function validateUpgradeResourceCleanup(operationId, observations) {
  const intents = upgradeResourceIntents(operationId);
  need(Array.isArray(observations) && observations.length === intents.length
    && new Set(observations.map(value => value?.kind + ':' + value?.role)).size === intents.length
    && intents.every(target => observations.some(value => record(value) && value.kind === target.kind && value.role === target.role && value.name === target.name
      && ['confirmed-absent', 'confirmed-removed'].includes(value.state))), 'UPGRADE_RESOURCE_REMOVAL_UNCONFIRMED');
  return true;
}
export function validateUpgradeArguments(value) {
  need(record(value) && Object.keys(value).sort().join(',') === 'candidateApiImage,captureImage,operationDirectory,productRevision,seedPath,seedSha256'
    && [value.operationDirectory, value.seedPath].every(item => typeof item === 'string' && path.isAbsolute(item))
    && SHA.test(value.seedSha256 ?? '') && IMAGE.test(value.candidateApiImage ?? '') && IMAGE.test(value.captureImage ?? '')
    && /^[a-f0-9]{40}$/.test(value.productRevision ?? ''), 'UPGRADE_ARGUMENT_INVALID');
  const name = path.basename(value.operationDirectory), operationId = name.slice('sp6-upgrade-'.length);
  need(name === 'sp6-upgrade-' + operationId && UUID.test(operationId), 'UPGRADE_OPERATION_INVALID'); return Object.freeze({ ...value, operationId });
}
export function assertCandidateRevision(image, productRevision) {
  need(/^[a-f0-9]{40}$/.test(productRevision ?? ''), 'UPGRADE_PRODUCT_REVISION_INVALID');
  for (const key of ['wfc.preparer.product-revision', 'wfc.preparer.revision', 'org.opencontainers.image.revision']) {
    const value = image.Config?.Labels?.[key]; if (value !== undefined) need(value === productRevision, 'UPGRADE_PRODUCT_REVISION_MISMATCH');
  }
}
export function assertUpgradeResource(value, expected) {
  const labels = value?.Labels ?? value?.Config?.Labels;
  need((value?.Name === expected.name || value?.Name === '/' + expected.name)
    && labels?.['wfc.preparer.upgrade.operation'] === expected.operationId && labels?.['wfc.preparer.upgrade.seed'] === expected.seedSha256
    && labels?.['wfc.preparer.upgrade.purpose'] === expected.purpose, 'UPGRADE_RESOURCE_OWNERSHIP_LOST'); return value;
}
export function assertUpgradeContainer(value, expected, { stopped = false } = {}) {
  assertUpgradeResource(value, expected);
  const planned = value.HostConfig?.Mounts, actual = value.Mounts;
  need(value.Id === expected.id && SHA.test(value.Id ?? '') && value.Image === expected.image && value.HostConfig?.NetworkMode === expected.networkId
    && value.HostConfig.RestartPolicy?.Name === 'no' && value.HostConfig.PublishAllPorts !== true && Object.keys(value.HostConfig.PortBindings ?? {}).length === 0
    && planned?.length === 1 && record(planned[0]) && planned[0].Type === 'volume' && planned[0].Source === expected.volume && planned[0].Target === expected.destination
    && (!Object.hasOwn(planned[0], 'ReadOnly') || planned[0].ReadOnly === false)
    && actual?.length === 1 && actual[0].Type === 'volume' && actual[0].Name === expected.volume && actual[0].Destination === expected.destination && actual[0].RW === true,
  'UPGRADE_CONTAINER_CHANGED');
  if (stopped) need(!active(value), 'UPGRADE_CONTAINER_NOT_STOPPED');
  else need(Object.keys(value.NetworkSettings?.Networks ?? {}).length === 1 && Object.values(value.NetworkSettings.Networks)[0].NetworkID === expected.networkId, 'UPGRADE_CONTAINER_NETWORK_CHANGED');
  return value;
}
async function readJson(filename, expectedSha256, maximum = 16 * 1024 ** 2) {
  await assertCanonicalPath(filename); const before = await fs.lstat(filename), bytes = await fs.readFile(filename);
  need(bytes.length > 0 && bytes.length <= maximum && (!expectedSha256 || createHash('sha256').update(bytes).digest('hex') === expectedSha256), 'UPGRADE_PRIVATE_FILE_CHANGED');
  const after = await fs.lstat(filename); need(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'UPGRADE_PRIVATE_FILE_CHANGED');
  try { const value = JSON.parse(bytes); need(record(value), 'UPGRADE_PRIVATE_JSON_INVALID'); return value; } catch { need(false, 'UPGRADE_PRIVATE_JSON_INVALID'); }
}
export function rewriteUpgradeEnvironment(sourceConfig, { names, jwtSecret }) {
  const ownerId = names?.postgres?.match(/^wfc-preparer-sp6-([a-f0-9-]{36})-postgres$/)?.[1];
  need(record(sourceConfig) && UUID.test(ownerId ?? '') && same(names, upgradeResourceNames(ownerId))
    && typeof jwtSecret === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(jwtSecret), 'UPGRADE_ENVIRONMENT_INVALID');
  const old = environment({ Config: sourceConfig }); let database;
  try { database = new URL(old.get('DATABASE_URL')); } catch { need(false, 'UPGRADE_CONNECTION_INVALID'); }
  need(['postgres:', 'postgresql:'].includes(database.protocol) && database.pathname === '/wfc_app' && !database.search && !database.hash && database.username && database.password, 'UPGRADE_CONNECTION_INVALID');
  database.hostname = names.postgres; database.port = '5432';
  const values = new Map([...old].filter(([key]) => !/^(?:APS_|AUTODESK_|PREPARER_|WFC_PREPARER_|WFC_PATHFINDER_|PATHFINDER_|PF_)/.test(key)));
  for (const [key, value] of Object.entries({ DATABASE_URL: database.href, MINIO_ENDPOINT: names.minio, MINIO_PORT: '9000', MINIO_USE_SSL: 'false',
    JWT_SECRET: jwtSecret, API_HOST: '0.0.0.0', API_PORT: '4000', API_USE_HTTPS: 'false', WFC_MODEL_IMPORT_ROOT: '/var/lib/wfc/model-imports',
    CLIENT_ORIGIN: 'http://127.0.0.1:5180', WFC_VIEWER_ALLOWED_ORIGINS: 'http://127.0.0.1:5180', WFC_VIEWER_ALLOW_HTTP_LOOPBACK: 'true',
    WFC_VIEWER_ALLOW_INSECURE_LAN_HTTP: 'false', WFC_VIEWER_TRUST_PROXY: 'false', HOME: '/tmp' })) values.set(key, value);
  need(values.get('JWT_SECRET') !== old.get('JWT_SECRET'), 'UPGRADE_SIGNING_SECRET_NOT_ROTATED');
  return [...values].map(([key, value]) => key + '=' + value);
}

// Readiness has a fixed own-operation DNS allowlist, no redirects, credentials or
// source endpoints. Each HTTP request has an absolute deadline and a body cap.
export async function probeUpgrade({ ownerId, role }, { request = http.request, signal } = {}) {
  const names = upgradeResourceNames(ownerId); need(['postgres', 'minio', 'candidate', 'rollback'].includes(role) && role !== 'postgres', 'UPGRADE_PROBE_ROLE_INVALID');
  const deadline = Date.now() + 120000, port = role === 'minio' ? 9000 : 4000, endpoint = role === 'minio' ? '/minio/health/ready' : '/health';
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const ok = await new Promise(resolve => {
      let done = false, timer; const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
      const req = request({ hostname: names[role], port, method: 'GET', path: endpoint, signal }, res => {
        const chunks = []; let bytes = 0; res.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) { req.destroy(); finish(false); } else chunks.push(Buffer.from(chunk)); });
        res.once('error', () => finish(false)); res.once('end', () => { let ready = res.statusCode === 200; if (ready && role !== 'minio') { try { ready = JSON.parse(Buffer.concat(chunks)).status === 'ok'; } catch { ready = false; } } finish(ready); });
      });
      req.once('error', () => finish(false)); if (!done) timer = setTimeout(() => { req.destroy(); finish(false); }, Math.max(1, Math.min(2000, deadline - Date.now()))); req.end();
    });
    if (ok) return { status: 'PASS', role, ownerId, publishedPorts: false };
    await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(250, deadline - Date.now()))));
  }
  need(false, 'UPGRADE_HEALTH_TIMEOUT');
}

async function guardDatabase(pool) {
  const result = await pool.query(`SELECT current_database() name,(SELECT count(*)::text FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()) others`);
  need(result.rows.length === 1 && result.rows[0].name === 'wfc_app' && result.rows[0].others === '0', 'UPGRADE_FOREIGN_DATABASE_CLIENT');
}
function tempSchemaMetadataQuery(source) {
  const match = source.match(/const TABLE_SCHEMA_SQL = `([\s\S]*?)`;/g);
  need(match?.length === 1, 'UPGRADE_SCHEMA_QUERY_SOURCE_CHANGED');
  const sql = match[0].slice('const TABLE_SCHEMA_SQL = `'.length, -2), marker = "n.nspname='public' AND c.relname=$1";
  need(sql.split(marker).length === 2, 'UPGRADE_SCHEMA_QUERY_SOURCE_CHANGED'); return sql.replace(marker, 'n.oid=pg_my_temp_schema() AND c.relname=$1');
}
export function normalizeArchiveTempContract(metadata, relations, temporarySchema) {
  need(record(metadata) && /^pg_temp_[0-9]+$/.test(temporarySchema) && Array.isArray(relations)
    && same(relations.map(row => row.name).sort(), [...RELATIONS].sort()), 'UPGRADE_ARCHIVE_CONTRACT_INVALID');
  const clone = structuredClone(metadata), prefix = temporarySchema + '.';
  for (const kind of ['constraints', 'indexes', 'triggers']) for (const row of clone.definitions[kind]) row.definition = row.definition.split(prefix).join('public.');
  need(same(clone.primaryKey, ['import_id']) && clone.columns.length === 10, 'UPGRADE_ARCHIVE_CONTRACT_INVALID');
  return { schema: { table: NEW_TABLE, columns: clone.columns, primaryKey: clone.primaryKey, keyMode: 'primary-key', definitions: clone.definitions },
    relations: relations.map(row => { need(row.persistence === 't', 'UPGRADE_ARCHIVE_CONTRACT_INVALID'); return { ...row, persistence: 'p' }; }) };
}
async function prepareClone(pool, ownerId) {
  await guardDatabase(pool); const client = await pool.connect(); let begun = false;
  try {
    await client.query('BEGIN'); begun = true; await client.query("SET LOCAL statement_timeout='30000ms';SET LOCAL lock_timeout='3000ms';SET LOCAL search_path=pg_catalog,public;SET LOCAL timezone='UTC'");
    const tables = (await client.query("SELECT to_regclass('public.model_package_archives') archives,to_regclass('public.viewer_login_bindings') logins,to_regclass('public.viewer_resource_sessions') sessions,to_regprocedure('public.protect_model_storage_ownership()') protector")).rows[0];
    need(tables?.archives === null && tables.logins && tables.sessions && tables.protector, 'UPGRADE_BASELINE_SCHEMA_UNEXPECTED');
    const source = await fs.readFile(HERE === '/operator' ? '/schema/schema.ts' : path.join(ROOT, 'server', 'modelRegistry', 'schema.ts'), 'utf8'); assertArchiveContractSource(source);
    const leafSource = await fs.readFile(path.join(HERE, 'recovery-leaves', 'losslessInventory.ts'), 'utf8');
    await client.query(ARCHIVE_TABLE_DDL); await client.query(ARCHIVE_INDEX_DDL); await client.query(ARCHIVE_TRIGGER_DDL);
    const temporarySchema = (await client.query('SELECT nspname name FROM pg_namespace WHERE oid=pg_my_temp_schema()')).rows[0]?.name;
    const metadata = (await client.query(tempSchemaMetadataQuery(leafSource), [NEW_TABLE, 1024 * 1024])).rows[0]?.metadata;
    const relations = (await client.query(GLOBAL_SQL_V2.relations.replace("n.nspname='public'", 'n.oid=pg_my_temp_schema()'))).rows.map(row => row.value);
    const contract = normalizeArchiveTempContract(metadata, relations, temporarySchema);
    await client.query('DROP TABLE pg_temp.model_package_archives');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('wfc.preparer.upgrade.fence.v1',0))");
    const sessions = await client.query("UPDATE public.viewer_resource_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),revoke_reason=COALESCE(revoke_reason,'logout') WHERE revoked_at IS NULL");
    const logins = await client.query('UPDATE public.viewer_login_bindings SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE revoked_at IS NULL');
    const remaining = (await client.query("SELECT (SELECT count(*) FROM public.viewer_resource_sessions WHERE revoked_at IS NULL)+(SELECT count(*) FROM public.viewer_login_bindings WHERE revoked_at IS NULL) active")).rows[0]?.active;
    need(remaining === '0' || remaining === 0, 'UPGRADE_VIEWER_FENCE_INCOMPLETE');
    await client.query('COMMIT'); begun = false;
    return { status: 'PASS', ownerId, contract, contractSqlSha256: canonicalSha256([ARCHIVE_TABLE_DDL, ARCHIVE_INDEX_DDL, ARCHIVE_TRIGGER_DDL]),
      fence: { sessionsRevoked: sessions.rowCount, loginsRevoked: logins.rowCount, activeRestoredBindings: 0, loginRowsDeleted: 0, runtimeJwtRotationRequired: true, viewerSessionSecrets: 'All restored leases revoked; future sessions generate new random secrets.' } };
  } finally { if (begun) await client.query('ROLLBACK').catch(() => {}); client.release(); }
}
/** Fixed clone-only helper. Its private connection file cannot name a source. */
export async function captureUpgradeClone({ directory, ownerId, connectionPath, prepare = false }, { poolFactory } = {}) {
  const names = upgradeResourceNames(ownerId); need(path.isAbsolute(directory ?? '') && path.isAbsolute(connectionPath ?? '') && typeof prepare === 'boolean', 'UPGRADE_CAPTURE_ARGUMENT_INVALID');
  const connection = await readJson(connectionPath, undefined, 32768);
  need(Object.keys(connection).sort().join(',') === 'database,host,password,port,user' && connection.host === names.postgres && connection.port === 5432 && connection.database === 'wfc_app'
    && ['user', 'password'].every(key => typeof connection[key] === 'string' && connection[key].length > 0), 'UPGRADE_CAPTURE_CONNECTION_SCOPE');
  need(process.versions.node === '24.22.0' || poolFactory !== undefined, 'UPGRADE_CAPTURE_NODE_VERSION');
  const pool = poolFactory ? poolFactory(connection) : new (createRequire('/app/package.json')('pg').Pool)({ ...connection, max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 1000, query_timeout: 30000, application_name: 'wfc-sp6-clone-capture' });
  try {
    await assertCanonicalPath(path.dirname(directory), { directory: true }); await fs.mkdir(directory, { mode: 0o700 }); await guardDatabase(pool);
    if (prepare) { const result = await prepareClone(pool, ownerId); await writeJsonNew(path.join(directory, 'prepare.private.json'), result); return result; }
    const { captureLosslessInventory } = await import('./recovery-leaves/losslessInventory.ts');
    const raw = await captureLosslessInventory(pool, { allowedRoot: directory, directory: path.join(directory, 'raw'), ownerId }); await guardDatabase(pool);
    const globals = await capturePublicGlobals(pool); need(globals.unsupportedObjects.length === 0, 'UPGRADE_GLOBAL_UNSUPPORTED'); await guardDatabase(pool);
    await writeJsonNew(path.join(directory, 'globals.private.json'), globals);
    const client = await pool.connect(); let begun = false; const cluster = { schemaVersion: 'wfc.preparer.upgrade-cluster-context.v1' };
    try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); begun = true; await client.query("SET LOCAL statement_timeout='15000ms';SET LOCAL timezone='UTC'");
      for (const [kind, text] of Object.entries(CLUSTER_SQL)) { const result = await client.query(text); need(result.rows.length <= 10000, 'UPGRADE_CLUSTER_METADATA_LIMIT'); cluster[kind] = result.rows.map(row => row.value); }
      need(cluster.database.length === 1 && Buffer.byteLength(JSON.stringify(cluster)) <= 8 * 1024 ** 2, 'UPGRADE_CLUSTER_METADATA_LIMIT'); await client.query('COMMIT'); begun = false;
    } finally { if (begun) await client.query('ROLLBACK').catch(() => {}); client.release(); }
    await guardDatabase(pool); await writeJsonNew(path.join(directory, 'cluster.private.json'), cluster);
    const summary = { status: 'PASS', ownerId, rawContentSha256: raw.contentSha256, rawCatalogSha256: raw.catalogSha256, globalSqlSha256: canonicalSha256(globals), clusterContextSha256: canonicalSha256(cluster), tables: raw.tables.length };
    await writeJsonNew(path.join(directory, 'capture.private.json'), summary); return summary;
  } finally { await pool.end(); }
}

export function validateArchiveAddition(before, after, contract, globalsBefore, globalsAfter) {
  need(record(contract?.schema) && Array.isArray(contract.relations) && contract.schema.table === NEW_TABLE
    && !before.tables.some(row => row.table === NEW_TABLE), 'UPGRADE_BASELINE_ARCHIVE_TABLE_PRESENT');
  const additions = after.tables.filter(row => !before.tables.some(prior => prior.table === row.table));
  need(additions.length === 1 && additions[0].table === NEW_TABLE && additions[0].rows === '0' && additions[0].rawBytes === '0'
    && additions[0].file.bytes === '0' && additions[0].file.sha256 === createHash('sha256').digest('hex')
    && same(currentInventorySchemaMetadata(additions[0]), contract.schema), 'UPGRADE_UNDECLARED_SCHEMA_ADDITION');
  need(before.tables.every(row => after.tables.some(next => next.table === row.table)), 'UPGRADE_OLD_TABLE_REMOVED');
  const newRelations = globalsAfter.relations.filter(row => !globalsBefore.relations.some(prior => prior.name === row.name));
  need(same(newRelations, contract.relations), 'UPGRADE_ARCHIVE_GLOBAL_CONTRACT_MISMATCH');
  const projectedGlobals = { ...globalsAfter, relations: globalsAfter.relations.filter(row => !RELATIONS.includes(row.name)) };
  need(same(projectedGlobals, globalsBefore), 'UPGRADE_OLD_GLOBAL_SQL_CHANGED'); return projectedGlobals;
}
/** New explicitly derived receipt; original capture manifests/files are never
 * rewritten. Only the reviewed empty table is removed from this projection. */
export async function projectOldTables(sourceDirectory, destination, ownerId) {
  need(UUID.test(ownerId ?? '') && path.isAbsolute(sourceDirectory) && path.isAbsolute(destination), 'UPGRADE_PROJECTION_ARGUMENT_INVALID');
  await compareCurrentInventories(sourceDirectory, sourceDirectory, { comparison: 'exact', beforeOwnerId: ownerId, afterOwnerId: ownerId });
  const original = await readJson(path.join(sourceDirectory, 'manifest.json'));
  const excluded = original.tables.filter(table => table.table === NEW_TABLE);
  need(excluded.length === 1 && excluded[0].rows === '0' && excluded[0].rawBytes === '0' && excluded[0].file.bytes === '0', 'UPGRADE_NONEMPTY_TABLE_PROJECTION_FORBIDDEN');
  await fs.mkdir(destination, { mode: 0o700 }); const inventoryId = randomUUID(), copies = [], tables = [];
  for (const table of original.tables.filter(row => row.table !== NEW_TABLE)) {
    const filename = 'table-' + String(tables.length).padStart(4, '0') + '.ndjson', from = path.join(sourceDirectory, table.file.path), to = path.join(destination, filename);
    await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL); const actual = await hashFile(to);
    need(actual.sha256 === table.file.sha256 && String(actual.bytes) === table.file.bytes, 'UPGRADE_PROJECTION_FILE_CHANGED');
    copies.push({ source: await pin(from), derived: await pin(to) }); tables.push({ ...table, file: { ...table.file, path: filename } });
  }
  const body = { ...original, inventoryId, tables, catalogSha256: currentInventoryCanonicalHash(tables.map(currentInventorySchemaMetadata)) };
  delete body.contentSha256;
  await writeJsonNew(path.join(destination, '.owner.json'), { schemaVersion: 'wfc.operations.lossless-owner.v1', ownerId, inventoryId });
  await writeJsonNew(path.join(destination, 'manifest.json'), { ...body, contentSha256: currentInventoryCanonicalHash(body) });
  await writeJsonNew(path.join(destination, 'projection.private.json'), { schemaVersion: 'wfc.preparer.upgrade-old-table-projection.v1', ownerId,
    sourceManifest: await pin(path.join(sourceDirectory, 'manifest.json')), derivedManifest: await pin(path.join(destination, 'manifest.json')),
    excluded: { table: NEW_TABLE, policy: 'Only the separately contract-verified new empty table; original capture retained unchanged.' }, copies });
  return { directory: destination, provenance: await pin(path.join(destination, 'projection.private.json')) };
}

export async function qualifyUpgrade(argumentValue, { docker: supplied, signal } = {}) {
  const args = validateUpgradeArguments(argumentValue), verified = await verifyColdSeed(args.seedPath, args.seedSha256), names = upgradeResourceNames(args.operationId);
  const parent = await assertCanonicalPath(path.join(ROOT, '.preparer-work'), { directory: true });
  need(path.resolve(args.operationDirectory) === path.join(parent, 'sp6-upgrade-' + args.operationId), 'UPGRADE_OPERATION_INVALID');
  need(args.candidateApiImage !== verified.intent.source.roles.api.image, 'UPGRADE_CANDIDATE_SAME_IMAGE');
  await fs.mkdir(args.operationDirectory, { mode: 0o700 }); const file = name => path.join(args.operationDirectory, name);
  const labels = purpose => ({ 'wfc.preparer.upgrade.operation': args.operationId, 'wfc.preparer.upgrade.seed': args.seedSha256, 'wfc.preparer.upgrade.purpose': purpose });
  const resource = purpose => ({ operationId: args.operationId, seedSha256: args.seedSha256, purpose, name: names[purpose] });
  const evidence = [], proof = async (name, value) => { await writeJsonNew(file(name), value); const pinned = await pin(file(name)); evidence.push(pinned); return pinned; };
  const intents = upgradeResourceIntents(args.operationId), ledger = new Map(intents.map(value => [value.kind + ':' + value.role, { ...value }]));
  const noteResource = async (kind, role, state, details = {}) => {
    const key = kind + ':' + role; need(ledger.has(key), 'UPGRADE_RESOURCE_INTENT_INVALID');
    const next = { ...ledger.get(key), ...details, state }; ledger.set(key, next);
    await proof('resource-' + kind + '-' + role + '-' + state + '.private.json', next); return next;
  };
  const closure = [];
  for (const name of ['upgrade-preflight.mjs', 'recovery.mjs', 'offline-seed.mjs', 'pg-root-archives.mjs', 'foundation/docker.mjs', 'foundation/docker-bounds.mjs', 'foundation/archives.mjs', 'foundation/manifest.mjs',
    'recovery-leaves/provenance.json', 'recovery-leaves/losslessInventory.ts', 'recovery-leaves/current-inventory-lib.mjs', 'recovery-leaves/global-sql-v2.mjs']) closure.push(await pin(path.join(HERE, name)));
  const schemaPath = path.join(ROOT, 'server', 'modelRegistry', 'schema.ts'); closure.push(await pin(schemaPath)); assertArchiveContractSource(await fs.readFile(schemaPath, 'utf8'));
  await proof('begin.private.json', { schemaVersion: 'wfc.preparer.upgrade-attempt.v1', operationId: args.operationId, seed: await pin(args.seedPath),
    productRevision: args.productRevision, candidateApiImage: args.candidateApiImage, rollbackApiImage: verified.intent.source.roles.api.image, captureImage: args.captureImage,
    productionQualification: supplied === undefined, sourceClosure: closure, sourceRuntimeAccess: false, startedAt: new Date().toISOString() });
  const lockPath = path.join(parent, 'main5180-upgrade-preflight.lock');
  await writeJsonNew(lockPath, { schemaVersion: 'wfc.preparer.upgrade-lock.v1', operationId: args.operationId, operationDirectory: args.operationDirectory, seedSha256: args.seedSha256 }); const lockPin = await pin(lockPath);
  let docker, network, connection, minioIdentity, pgIdentity, jwtSecret, result, primary, cleanupSafe = false;
  const volumes = new Map(), containers = new Map(); let witnessSequence = 0;
  const check = () => signal?.throwIfAborted();
  const checkContainer = async (role, stopped = false) => {
    check(); const expected = containers.get(role), actual = await docker.inspect(expected.id);
    await proof('guard-' + String(++witnessSequence).padStart(3, '0') + '-' + role + '.private.json', { expected, actual: recoveryCloneWitness(actual) });
    return assertUpgradeContainer(actual, expected, { stopped });
  };
  const checkNetwork = async () => {
    const current = await docker.request('GET', '/networks/' + network.Id); assertUpgradeResource(current, resource('network'));
    need(current.Id === network.Id && current.Internal === true && current.Driver === 'bridge'
      && same(Object.keys(current.Containers ?? {}).sort(), [...containers.values()].map(value => value.id).sort()), 'UPGRADE_FOREIGN_NETWORK_CLIENT');
  };
  const createContainer = async (role, image, config, volume, destination) => {
    check(); await noteResource('container', role, 'pending', { image, volume, destination });
    const created = await docker.create(names[role], { ...config, Image: image, Labels: labels(role), HostConfig: { NetworkMode: network.Id,
      Mounts: [mount(volume, destination, false, 'volume')], PortBindings: {}, PublishAllPorts: false, RestartPolicy: { Name: 'no' } } });
    await noteResource('container', role, 'acknowledged', { id: typeof created?.Id === 'string' ? created.Id : null });
    need(SHA.test(created?.Id ?? '') && !Object.values(verified.intent.source.roles).some(value => value.id === created.Id), 'UPGRADE_CONTAINER_INVALID');
    containers.set(role, { ...resource(role), id: created.Id, image, volume, destination, networkId: network.Id }); await checkContainer(role, true);
    await noteResource('container', role, 'admitted', { id: created.Id });
    await docker.start(created.Id); await checkContainer(role); await checkNetwork(); return created.Id;
  };
  const helperProbe = async role => {
    const observed = await docker.run(args.captureImage, { network: network.Id, labels: labels('probe-' + role), mounts: [mount(HERE, '/operator')],
      cmd: ['node', '--experimental-strip-types', '/operator/upgrade-preflight.mjs', 'probe', '--owner', args.operationId, '--role', role] });
    need(observed.status === 'PASS', 'UPGRADE_HEALTH_FAILED'); await checkContainer(role); await checkNetwork(); return observed;
  };
  const capture = async (name, prepare = false) => {
    await checkContainer('postgres'); await checkNetwork();
    const observed = await docker.run(args.captureImage, { network: network.Id, labels: labels('capture-' + name),
      mounts: [mount(HERE, '/operator'), mount(path.dirname(schemaPath), '/schema'), mount(args.operationDirectory, '/proof', false)],
      cmd: ['node', '--experimental-strip-types', '/operator/upgrade-preflight.mjs', prepare ? 'prepare' : 'capture', '--directory', '/proof/' + name, '--owner', args.operationId, '--connection', '/proof/connection.private.json'] });
    await proof(name + '-stdout.private.json', observed); need(observed?.status === 'PASS', 'UPGRADE_CAPTURE_FAILED'); await checkNetwork();
    return { directory: file(name), summary: observed };
  };
  const compareStage = async (baseline, current, contract, name) => {
    const before = await readJson(path.join(baseline.directory, 'raw', 'manifest.json')), after = await readJson(path.join(current.directory, 'raw', 'manifest.json'));
    const priorGlobals = validatePublicGlobals(await readJson(path.join(baseline.directory, 'globals.private.json'))), currentGlobals = validatePublicGlobals(await readJson(path.join(current.directory, 'globals.private.json')));
    const validated = await compareCurrentInventories(path.join(current.directory, 'raw'), path.join(current.directory, 'raw'), { comparison: 'exact', beforeOwnerId: args.operationId, afterOwnerId: args.operationId, signal });
    need(validated.status === 'PASS', 'UPGRADE_CAPTURE_INVALID');
    const projectedGlobals = validateArchiveAddition(before, after, contract, priorGlobals, currentGlobals);
    need(same(await readJson(path.join(baseline.directory, 'cluster.private.json')), await readJson(path.join(current.directory, 'cluster.private.json'))), 'UPGRADE_CLUSTER_CONTEXT_CHANGED');
    const projection = await projectOldTables(path.join(current.directory, 'raw'), file(name + '-old-tables'), args.operationId);
    evidence.push(projection.provenance);
    const compared = await compareCurrentInventories(path.join(baseline.directory, 'raw'), projection.directory, { comparison: 'exact', beforeOwnerId: args.operationId, afterOwnerId: args.operationId, signal });
    await proof(name + '-comparison.private.json', { ...compared, newEmptyTableSchema: 'PASS', oldGlobalSql: same(projectedGlobals, priorGlobals) ? 'PASS' : 'FAIL', oldClusterContext: 'PASS', projection });
    need(compared.status === 'PASS', 'UPGRADE_OLD_BUSINESS_OR_SCHEMA_CHANGED'); return await pin(file(name + '-comparison.private.json'));
  };
  try {
    await withBoundedDockerExecution(OFFLINE_SEED_BOUNDS, async () => {
      docker = supplied ?? await createDocker();
      const sourceEnv = environment({ Config: verified.companion.roles.api.config }), postgresEnv = environment({ Config: verified.companion.roles.postgres.config }), storageEnv = environment({ Config: verified.companion.roles.minio.config });
      const imageIds = [verified.intent.source.roles.postgres.image, verified.intent.source.roles.minio.image, verified.intent.source.roles.api.image, args.candidateApiImage, args.captureImage];
      const images = await Promise.all(imageIds.map(value => docker.inspectImage(value)));
      need(images.every((image, index) => image.Id === imageIds[index] && image.Os === 'linux' && image.Architecture === 'amd64'), 'UPGRADE_IMAGE_INVALID');
      assertCandidateRevision(images[3], args.productRevision);
      need(images[4].Id === args.captureImage && images[4].Config?.Labels?.['wfc.preparer.sp1.capture-node-base'] === verified.intent.helperImage
        && images[4].Config.Labels['wfc.preparer.sp1.capture-dependency-base'] === verified.intent.source.roles.api.image, 'UPGRADE_CAPTURE_IMAGE_INVALID');
      for (const image of [images[2], images[3]]) need(image.Config?.WorkingDir === '/app' && Array.isArray(image.Config?.Cmd) && image.Config.Cmd[0] === 'node' && image.Config.Cmd.length === 2
        && /^server\/dist\/server\/index\.js$/.test(image.Config.Cmd[1]), 'UPGRADE_API_IMAGE_PROFILE_INVALID');
      const postgresArchive = verified.seed.archives.find(value => value.role === 'postgres'), scanned = await verifyPostgresArchive(postgresArchive.file.path, { expectedSha256: postgresArchive.file.sha256, signal });
      pgIdentity = verifiedPostgresDataIdentity(postgresEnv.get('PGDATA'), scanned.entries);
      let originalConnection; try { originalConnection = new URL(sourceEnv.get('DATABASE_URL')); } catch { need(false, 'UPGRADE_CONNECTION_INVALID'); }
      connection = { host: names.postgres, port: 5432, user: decodeURIComponent(originalConnection.username), password: decodeURIComponent(originalConnection.password), database: 'wfc_app' };
      need(connection.user && connection.password && originalConnection.pathname === '/wfc_app' && (postgresEnv.get('POSTGRES_USER') || 'postgres') === connection.user, 'UPGRADE_CONNECTION_INVALID');
      minioIdentity = { user: verified.companion.roles.minio.config.User || images[1].Config?.User || '', rootUser: storageEnv.get('MINIO_ROOT_USER') || storageEnv.get('MINIO_ACCESS_KEY'), rootPassword: storageEnv.get('MINIO_ROOT_PASSWORD') || storageEnv.get('MINIO_SECRET_KEY') };
      need([minioIdentity.rootUser, minioIdentity.rootPassword].every(value => typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f]/.test(value)), 'UPGRADE_STORAGE_CREDENTIALS_REQUIRED');
      jwtSecret = randomBytes(48).toString('base64url'); rewriteUpgradeEnvironment(verified.companion.roles.api.config, { names, jwtSecret });
      const required = BigInt(Math.ceil(verified.seed.archives.reduce((total, archive) => total + archive.totalBytes * 2.2, 0) + 2 * 1024 ** 3)), available = await fs.statfs(args.operationDirectory, { bigint: true });
      need(required > 0n && available.bavail * available.bsize >= required, 'UPGRADE_SPACE_INSUFFICIENT'); await proof('space.private.json', { requiredHostBytes: String(required), availableHostBytes: String(available.bavail * available.bsize), dockerVolumeCapacity: 'UNPROVEN; allocation failure is fatal' });
      const existingNetworks = await docker.request('GET', '/networks'), existingVolumes = await docker.request('GET', '/volumes'), existingContainers = await docker.request('GET', '/containers/json?all=1');
      need(Array.isArray(existingNetworks) && !existingNetworks.some(value => value.Name === names.network) && Array.isArray(existingVolumes.Volumes)
        && !existingVolumes.Volumes.some(value => [names.postgres, names.minio, names.staging].includes(value.Name)) && Array.isArray(existingContainers)
        && !existingContainers.some(value => value.Names?.some(name => Object.values(names).includes(name.replace(/^\//, '')))), 'UPGRADE_TARGET_EXISTS');
      await proof('resource-intents.private.json', { operationId: args.operationId, names, intents, labels: labels('network'),
        images: { postgres: verified.intent.source.roles.postgres.image, minio: verified.intent.source.roles.minio.image, candidate: args.candidateApiImage, rollback: verified.intent.source.roles.api.image }, sourceRuntimeAccess: false, publishedPorts: false });
      await noteResource('network', 'network', 'pending');
      const made = await docker.request('POST', '/networks/create', { Name: names.network, Driver: 'bridge', Internal: true, Attachable: false, CheckDuplicate: true, Labels: labels('network') });
      await noteResource('network', 'network', 'acknowledged', { id: typeof made?.Id === 'string' ? made.Id : null });
      need(SHA.test(made?.Id ?? ''), 'UPGRADE_NETWORK_INVALID'); network = { Id: made.Id };
      network = await docker.request('GET', '/networks/' + made.Id); await checkNetwork(); await noteResource('network', 'network', 'admitted', { id: network.Id });
      for (const [role, archiveRole] of [['postgres', 'postgres'], ['minio', 'minio'], ['staging', 'staging']]) {
        check(); await noteResource('volume', role, 'pending');
        const acknowledged = await docker.request('POST', '/volumes/create', { Name: names[role], Driver: 'local', Labels: labels(role) });
        await noteResource('volume', role, 'acknowledged', { acknowledgedName: typeof acknowledged?.Name === 'string' ? acknowledged.Name : null });
        assertUpgradeResource(acknowledged, resource(role)); const created = await docker.request('GET', '/volumes/' + encodeURIComponent(names[role])); assertUpgradeResource(created, resource(role));
        need(created.Driver === 'local' && Object.keys(created.Options ?? {}).length === 0 && same(created, acknowledged), 'UPGRADE_VOLUME_INVALID'); volumes.set(role, created);
        await noteResource('volume', role, 'admitted');
        const archive = verified.seed.archives.find(value => value.role === archiveRole), command = ['node', archiveRole === 'postgres' ? 'scripts/operations/pg-root-archives.mjs' : 'scripts/operations/archives.mjs'];
        const archiveLabels = { ...labels('archive-' + role), 'wfc.preparer.sp1.operation': args.operationId, 'wfc.preparer.sp1.purpose': 'offline-seed-archive' };
        const restored = await docker.run(verified.intent.helperImage, { network: 'none', labels: archiveLabels, mounts: [mount(verified.directory, '/backup'), mount(created.Name, '/target', false, 'volume')], cmd: [...command, 'restore', '/backup/' + archiveRole + '.wfcops', '/target', archive.file.sha256] });
        need(restored.status === 'PASS' && restored.targetFresh === true && restored.fullOuterHashVerifiedBeforeWrites === true && restored.sha256 === archive.file.sha256, 'UPGRADE_COLD_RESTORE_FAILED');
        const directory = file(role + '-prestart'); await fs.mkdir(directory, { mode: 0o700 });
        const recaptured = await docker.run(verified.intent.helperImage, { network: 'none', labels: archiveLabels, mounts: [mount(created.Name, '/source', true, 'volume'), mount(directory, '/backup', false)], cmd: [...command, 'capture', '/source', '/backup/' + archiveRole + '.wfcops'] });
        need(recaptured.status === 'PASS' && recaptured.sha256 === archive.file.sha256 && same(await hashFile(path.join(directory, archiveRole + '.wfcops')), { sha256: archive.file.sha256, bytes: archive.file.bytes }), 'UPGRADE_PRESTART_BYTES_CHANGED');
        await proof(role + '-seed-proof.private.json', { volume: created, seed: archive.file, recapture: await pin(path.join(directory, archiveRole + '.wfcops')), exactBeforeStartup: true });
      }
      cleanupSafe = true;
    });
    const migration = await withBoundedDockerExecution(UPGRADE_BOUNDS, async () => {
      await createContainer('postgres', verified.intent.source.roles.postgres.image, { User: pgIdentity.user, Entrypoint: [], Env: ['PGDATA=' + pgIdentity.pgdata], Cmd: ['postgres', '-D', pgIdentity.pgdata, '-c', 'listen_addresses=*', '-c', 'unix_socket_directories=/tmp'] }, names.postgres, '/var/lib/postgresql');
      for (let attempt = 0;; attempt++) { try { await docker.command(['exec', containers.get('postgres').id, 'pg_isready', '--host=/tmp', '--username=' + connection.user, '--dbname=wfc_app'], { signal, maxBytes: 65536 }); break; } catch (error) { if (attempt >= 59) throw error; await new Promise(resolve => setTimeout(resolve, 500)); } }
      await createContainer('minio', verified.intent.source.roles.minio.image, { User: minioIdentity.user, Entrypoint: [], Cmd: ['minio', 'server', '/data', '--address', ':9000', '--console-address', ':9001'],
        Env: ['HOME=/tmp', 'MINIO_ROOT_USER=' + minioIdentity.rootUser, 'MINIO_ROOT_PASSWORD=' + minioIdentity.rootPassword, 'MINIO_BROWSER=off', 'MINIO_UPDATE=off'] }, names.minio, '/data');
      await helperProbe('minio'); await writePrivateJson(file('connection.private.json'), connection);
      await capture('prepare', true); const preparation = await readJson(file('prepare/prepare.private.json')); need(preparation.status === 'PASS' && preparation.ownerId === args.operationId, 'UPGRADE_PREPARATION_INVALID');
      const baseline = await capture('baseline');
      const startup = async (role, imageId) => {
        const image = await docker.inspectImage(imageId), env = rewriteUpgradeEnvironment(verified.companion.roles.api.config, { names, jwtSecret });
        await writePrivateJson(file(role + '-runtime.private.json'), { image: imageId, env, targetId: args.operationId, publishedPorts: false });
        await createContainer(role, imageId, { User: image.Config.User || '', WorkingDir: '/app', Entrypoint: [], Cmd: image.Config.Cmd, Env: env }, names.staging, '/var/lib/wfc/model-imports');
        const health = await helperProbe(role), id = containers.get(role).id; await checkContainer(role);
        await cleanupBoundedDockerHelper(id); const gone = await docker.request('GET', '/containers/json?all=1'); need(!gone.some(value => value.Id === id), 'UPGRADE_API_STOP_UNCONFIRMED'); containers.delete(role); await checkNetwork();
        await proof(role + '-startup.private.json', { image: imageId, id, health, stoppedJoinedAndRemovedBeforeCapture: true, publishedPorts: false });
      };
      await startup('candidate', args.candidateApiImage); const upgraded = await capture('candidate-after');
      const upgradeComparison = await compareStage(baseline, upgraded, preparation.contract, 'candidate');
      await startup('rollback', verified.intent.source.roles.api.image); const rolledBack = await capture('rollback-after');
      const rollbackComparison = await compareStage(baseline, rolledBack, preparation.contract, 'rollback');
      return { baseline, upgraded, rolledBack, expectedContract: await pin(file('prepare/prepare.private.json')), upgradeComparison, rollbackComparison };
    });
    cleanupSafe = true;
    for (const expected of closure) need(same(await pin(expected.path), expected), 'UPGRADE_SOURCE_CHANGED');
    for (const expected of evidence) need(same(await pin(expected.path), expected), 'UPGRADE_EVIDENCE_CHANGED');
    await verifyColdSeed(args.seedPath, args.seedSha256);
    result = { schemaVersion: 'wfc.preparer.api-upgrade-preflight.v1', status: 'PASS', operationId: args.operationId, productionQualification: supplied === undefined,
      productRevision: args.productRevision, seed: await pin(args.seedPath), candidateApiImage: args.candidateApiImage, rollbackApiImage: verified.intent.source.roles.api.image, captureImage: args.captureImage,
      sourceClosure: closure, evidence, ...migration, candidateHealth: 'PASS', oldBusinessDataAndSchema: 'PASS', oldGlobalSql: 'PASS', oldClusterContext: 'PASS', declaredNewEmptyArchiveTable: 'PASS',
      oldImageRollbackStartup: 'PASS', sourceRuntimeAccess: false, publishedPorts: false, realDeployment: 'NOT_RUN', browserAcceptance: 'NOT_RUN', completedAt: new Date().toISOString() };
  } catch (error) { primary = error; cleanupSafe = getBoundedDockerCleanup(error)?.status === 'PASS'; }
  let cleanup = { status: 'UNCONFIRMED', resourcesRetained: true };
  if (docker && cleanupSafe) try {
    cleanup = await withBoundedDockerExecution(CLEANUP_BOUNDS, async () => {
      const readOrAbsent = async route => { try { return await docker.request('GET', route); } catch (error) { if (error.statusCode === 404 && error.definitive === true) return null; throw error; } };
      const volumeNames = intents.filter(value => value.kind === 'volume').map(value => value.name), containerNames = intents.filter(value => value.kind === 'container').map(value => value.name);
      const all = await docker.request('GET', '/containers/json?all=1'); need(Array.isArray(all), 'UPGRADE_CLEANUP_OBSERVATION_INVALID');
      for (const summary of all.filter(value => value.Names?.some(name => containerNames.includes(name.replace(/^\//, ''))))) {
        const actual = await docker.inspect(summary.Id), intended = intents.find(value => value.kind === 'container' && actual.Name === '/' + value.name);
        await proof('cleanup-unexpected-container-' + String(++witnessSequence).padStart(3, '0') + '.private.json', { intended, actual: recoveryCloneWitness(actual) });
        // Bounded scope cleanup must already have joined/removed all creates.
        // A surviving or replaced name is ambiguous; never delete it by name.
        need(false, 'UPGRADE_CONTAINER_REMAINS');
      }
      need(!all.some(value => value.Mounts?.some(item => volumeNames.includes(item.Name))), 'UPGRADE_VOLUME_ATTACHED');
      for (const target of intents.filter(value => value.kind === 'container')) await noteResource('container', target.role, 'confirmed-absent');
      // Inspect every intended name, including acknowledgements that failed
      // admission. Missing map entries cannot silently disappear from cleanup.
      for (const target of [...intents.filter(value => value.kind === 'volume')].reverse()) {
        const current = await readOrAbsent('/volumes/' + encodeURIComponent(target.name));
        if (!current) { await noteResource('volume', target.role, 'confirmed-absent'); continue; }
        assertUpgradeResource(current, resource(target.role)); need(current.Driver === 'local' && Object.keys(current.Options ?? {}).length === 0, 'UPGRADE_VOLUME_INVALID');
        const admitted = volumes.get(target.role); if (admitted) need(same(current, admitted), 'UPGRADE_VOLUME_CHANGED');
        await noteResource('volume', target.role, 'cleanup-admitted', { inspectedName: current.Name });
        await docker.request('DELETE', '/volumes/' + encodeURIComponent(current.Name));
        need(await readOrAbsent('/volumes/' + encodeURIComponent(target.name)) === null, 'UPGRADE_VOLUME_REMOVAL_UNCONFIRMED');
        await noteResource('volume', target.role, 'confirmed-removed');
      }
      const networkIntent = ledger.get('network:network'), reference = SHA.test(networkIntent.id ?? '') ? networkIntent.id : names.network;
      const currentNetwork = await readOrAbsent('/networks/' + encodeURIComponent(reference));
      if (currentNetwork) {
        assertUpgradeResource(currentNetwork, resource('network'));
        need(SHA.test(currentNetwork.Id ?? '') && (!SHA.test(networkIntent.id ?? '') || currentNetwork.Id === networkIntent.id)
          && currentNetwork.Internal === true && currentNetwork.Driver === 'bridge' && Object.keys(currentNetwork.Containers ?? {}).length === 0, 'UPGRADE_NETWORK_ATTACHED');
        await noteResource('network', 'network', 'cleanup-admitted', { id: currentNetwork.Id });
        await docker.request('DELETE', '/networks/' + currentNetwork.Id);
        need(await readOrAbsent('/networks/' + currentNetwork.Id) === null, 'UPGRADE_NETWORK_REMOVAL_UNCONFIRMED');
        await noteResource('network', 'network', 'confirmed-removed');
      } else await noteResource('network', 'network', 'confirmed-absent');
      const remainingVolumes = await docker.request('GET', '/volumes'), remainingNetworks = await docker.request('GET', '/networks');
      const remainingContainers = await docker.request('GET', '/containers/json?all=1');
      need(Array.isArray(remainingVolumes.Volumes) && Array.isArray(remainingNetworks) && Array.isArray(remainingContainers)
        && !remainingVolumes.Volumes.some(value => volumeNames.includes(value.Name)) && !remainingNetworks.some(value => value.Id === networkIntent.id || value.Name === names.network)
        && !remainingContainers.some(value => value.Names?.some(name => containerNames.includes(name.replace(/^\//, '')))), 'UPGRADE_RESOURCE_REMOVAL_UNCONFIRMED');
      const intendedResources = [...ledger.values()]; validateUpgradeResourceCleanup(args.operationId, intendedResources);
      return { status: 'PASS', resourcesRetained: false, sourceRuntimeAccess: false, intendedResources };
    });
  } catch (error) { primary ??= error; cleanup = { status: 'UNCONFIRMED', resourcesRetained: true, code: safeCode(error) }; }
  await proof('cleanup.private.json', cleanup);
  if (primary || !result || cleanup.status !== 'PASS') { const cause = primary ?? Object.assign(Error('UPGRADE_INCOMPLETE'), { code: 'UPGRADE_INCOMPLETE' });
    await writeJsonNew(file('failure.private.json'), { status: 'FAIL', operationId: args.operationId, code: safeCode(cause), cleanup, sourceLockRetained: true }); throw cause; }
  result.cleanup = cleanup; result.evidence = evidence; await writeJsonNew(file('qualification.private.json'), result);
  const terminal = await proof('complete.private.json', { schemaVersion: 'wfc.preparer.upgrade-complete.v1', status: 'PASS', operationId: args.operationId,
    qualification: await pin(file('qualification.private.json')), sourceLockRelease: { state: 'pending', source: lockPin, archivedPath: file('source-lock-released.private.json') } });
  let releaseAttempted = false;
  try {
    need(same(await pin(lockPath), lockPin), 'UPGRADE_LOCK_CHANGED');
    try { await fs.lstat(file('source-lock-released.private.json')); need(false, 'UPGRADE_LOCK_RELEASE_DESTINATION_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    releaseAttempted = true; await fs.rename(lockPath, file('source-lock-released.private.json'));
    need(same(await pin(file('source-lock-released.private.json')), { ...lockPin, path: file('source-lock-released.private.json') }), 'UPGRADE_LOCK_RELEASE_UNCONFIRMED');
    try { await fs.lstat(lockPath); need(false, 'UPGRADE_LOCK_RELEASE_UNCONFIRMED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    need(same(await pin(terminal.path), terminal), 'UPGRADE_TERMINAL_CHANGED'); return { ...result, terminal, sourceLockReleased: true };
  } catch (error) { await writeJsonNew(file('finalization-failure.private.json'), { status: 'FAIL', operationId: args.operationId, code: safeCode(error), terminal,
    sourceLockState: releaseAttempted ? 'UNCONFIRMED' : 'retained' }); throw error; }
}

/** Deployment reads a full finalized gate, not a historical status-only claim. */
export async function verifyUpgradeQualification(filename, sha256) {
  need(path.isAbsolute(filename ?? '') && path.basename(filename) === 'qualification.private.json' && SHA.test(sha256 ?? ''), 'UPGRADE_GATE_ARGUMENT_INVALID');
  const value = await readJson(filename, sha256), directory = path.dirname(filename);
  need(value.schemaVersion === 'wfc.preparer.api-upgrade-preflight.v1' && value.status === 'PASS' && value.productionQualification === true
    && UUID.test(value.operationId ?? '') && path.basename(directory) === 'sp6-upgrade-' + value.operationId && /^[a-f0-9]{40}$/.test(value.productRevision ?? '')
    && IMAGE.test(value.candidateApiImage ?? '') && IMAGE.test(value.rollbackApiImage ?? '') && IMAGE.test(value.captureImage ?? '')
    && value.candidateHealth === 'PASS' && value.oldBusinessDataAndSchema === 'PASS' && value.oldGlobalSql === 'PASS' && value.oldClusterContext === 'PASS' && value.declaredNewEmptyArchiveTable === 'PASS'
    && value.oldImageRollbackStartup === 'PASS' && value.cleanup?.status === 'PASS' && value.cleanup.resourcesRetained === false
    && value.sourceRuntimeAccess === false && value.publishedPorts === false && Array.isArray(value.sourceClosure) && value.sourceClosure.length >= 12
    && Array.isArray(value.evidence) && value.evidence.length >= 1, 'UPGRADE_GATE_NOT_QUALIFIED');
  validateUpgradeResourceCleanup(value.operationId, value.cleanup.intendedResources);
  for (const name of ['failure.private.json', 'finalization-failure.private.json']) {
    try { await fs.lstat(path.join(directory, name)); need(false, 'UPGRADE_GATE_FAILED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const verifyPin = async expected => { need(record(expected) && typeof expected.path === 'string' && SHA.test(expected.sha256 ?? ''), 'UPGRADE_GATE_PIN_INVALID'); need(same(await pin(expected.path), expected), 'UPGRADE_GATE_FILE_CHANGED'); };
  for (const expected of [...value.sourceClosure, ...value.evidence, value.seed, value.upgradeComparison, value.rollbackComparison, value.expectedContract]) await verifyPin(expected);
  for (const expected of [value.upgradeComparison, value.rollbackComparison]) {
    const comparison = await readJson(expected.path, expected.sha256);
    need(comparison.status === 'PASS' && comparison.comparison === 'exact' && comparison.newEmptyTableSchema === 'PASS' && comparison.oldGlobalSql === 'PASS' && comparison.oldClusterContext === 'PASS', 'UPGRADE_GATE_COMPARISON_FAILED');
  }
  for (const [role, image] of [['candidate', value.candidateApiImage], ['rollback', value.rollbackApiImage]]) {
    const startupPath = path.join(directory, role + '-startup.private.json'), startupPin = await pin(startupPath), startup = await readJson(startupPath, startupPin.sha256);
    need(startup.image === image && SHA.test(startup.id ?? '') && startup.health?.status === 'PASS' && startup.health.operationId === value.operationId
      && startup.stoppedJoinedAndRemovedBeforeCapture === true && startup.publishedPorts === false, 'UPGRADE_GATE_STARTUP_UNPROVEN');
    need(value.evidence.some(item => same(item, startupPin)), 'UPGRADE_GATE_STARTUP_UNPROVEN');
  }
  const terminal = await readJson(path.join(directory, 'complete.private.json'));
  need(terminal.schemaVersion === 'wfc.preparer.upgrade-complete.v1' && terminal.status === 'PASS' && terminal.operationId === value.operationId
    && same(terminal.qualification, await pin(filename)) && terminal.sourceLockRelease?.state === 'pending'
    && terminal.sourceLockRelease.archivedPath === path.join(directory, 'source-lock-released.private.json'), 'UPGRADE_GATE_TERMINAL_INVALID');
  const release = terminal.sourceLockRelease;
  need(same(await pin(release.archivedPath), { ...release.source, path: release.archivedPath }), 'UPGRADE_GATE_LOCK_RELEASE_UNCONFIRMED');
  try { await fs.lstat(release.source.path); need(false, 'UPGRADE_GATE_LOCK_RELEASE_UNCONFIRMED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...value, sourceLockReleased: true, terminal: await pin(path.join(directory, 'complete.private.json')) };
}

export async function main(args) {
  let result;
  if (args.length === 13 && args[0] === 'qualify' && args[1] === '--operation' && args[3] === '--seed' && args[5] === '--seed-sha256' && args[7] === '--candidate-api-image' && args[9] === '--capture-image' && args[11] === '--product-revision')
    result = await qualifyUpgrade({ operationDirectory: args[2], seedPath: args[4], seedSha256: args[6], candidateApiImage: args[8], captureImage: args[10], productRevision: args[12] });
  else if (args.length === 5 && args[0] === 'probe' && args[1] === '--owner' && args[3] === '--role') result = await probeUpgrade({ ownerId: args[2], role: args[4] });
  else if (args.length === 7 && ['prepare', 'capture'].includes(args[0]) && args[1] === '--directory' && args[3] === '--owner' && args[5] === '--connection')
    result = await captureUpgradeClone({ directory: args[2], ownerId: args[4], connectionPath: args[6], prepare: args[0] === 'prepare' });
  else need(false, 'UPGRADE_ARGUMENT_INVALID');
  console.log(JSON.stringify({ status: result.status, operationId: result.operationId ?? result.ownerId ?? null, sourceRuntimeAccess: false, publishedPorts: false,
    ...(result.role ? { role: result.role } : {}),
    ...(result.rawContentSha256 ? { rawContentSha256: result.rawContentSha256, globalSqlSha256: result.globalSqlSha256, clusterContextSha256: result.clusterContextSha256, tables: result.tables } : {}) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.log(JSON.stringify({ status: 'FAIL', code: safeCode(error) })); process.exitCode = 1; });
