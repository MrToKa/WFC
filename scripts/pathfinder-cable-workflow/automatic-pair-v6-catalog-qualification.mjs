// ROOT may execute this read-only operator against an already owned disposable
// U7 database. The catalog is real PostgreSQL 18; the pre-addition baseline is
// derived in memory. This is not a real migration or an application/engine test.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { validatePairSqlFixture, loadOwnedPairSqlFixture } from './pair-sql-qualification.mjs';
import { capturePublicGlobals } from '../pathfinder-barriers/global-sql-v2.mjs';
import { V6_MIGRATION_POLICY, qualifyMigrationFacts } from '../pathfinder-barriers/migration-conservation-v6.mjs';
import { compareCurrentInventories, currentInventoryCanonicalHash, currentInventorySchemaMetadata } from '../pathfinder-copied-recovery/current-inventory-lib.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const KIND = 'synthetic-cable-workflow-u7';
const need = (condition, code) => { if (!condition) throw Object.assign(Error(code), { code }); };
const sha = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => currentInventoryCanonicalHash(a) === currentInventoryCanonicalHash(b);
export const V6_CATALOG_INVENTORY = Object.freeze({
  path: path.join(ROOT, 'pathfinder-engine/.scratch/b25-20abf31d-22a4-4fcb-a080-713b5c4ade03/qualified-losslessInventory.mjs'),
  sha256: 'c97d4cf5613e7e9f6497027344256536c1078d3c8499a952bab7eaeefc9f1e82',
});
export const validateAutomaticPairV6CatalogFixture = (config, filename) => validatePairSqlFixture(config, filename);

/** Validate the complete actual catalog before removing only the declared
 * pristine additions. No database operation or raw-row numeric parsing occurs. */
export function deriveSimulatedV6Before(actual) {
  need(actual && typeof actual === 'object' && !Array.isArray(actual) && Object.getPrototypeOf(actual) === Object.prototype
    && Reflect.ownKeys(actual).length === 2 && ['manifest', 'globals'].every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(actual, key); return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
    }), 'U7_V6_CATALOG_FACTS');
  const self = qualifyMigrationFacts({ before: actual, after: actual, pristine: actual });
  need(self.status === 'PASS' && self.newTables.length === 0 && self.managedChanges.length === 0, 'U7_V6_CATALOG_NOT_PRISTINE');
  need(/^18[0-9]{4}$/.test(actual.manifest.database.serverVersionNum), 'U7_V6_POSTGRES_18_REQUIRED');
  const before = structuredClone(actual), tables = new Set(V6_MIGRATION_POLICY.newTables);
  const indexes = new Set(Object.values(V6_MIGRATION_POLICY.addedIndexes).flat());
  const removed = before.manifest.tables.filter(table => tables.has(table.table));
  need(removed.length === 2 && removed.every(table => table.rows === '0' && table.rawBytes === '0'), 'U7_V6_PAIR_ROWS_NOT_EMPTY');
  before.manifest.tables = before.manifest.tables.filter(table => !tables.has(table.table)).map((table, index) => ({ ...table,
    // These are simulated facts, not a materialized raw inventory directory.
    file: { ...table.file, path: `table-${String(index).padStart(4, '0')}.ndjson` },
  }));
  const removedRelations = before.globals.relations.filter(row => tables.has(row.name) || indexes.has(row.name));
  need(removedRelations.length === tables.size + indexes.size
    && removedRelations.every(row => tables.has(row.name) ? row.kind === 'r' : row.kind === 'i'), 'U7_V6_DECLARED_RELATIONS');
  before.globals.relations = before.globals.relations.filter(row => !tables.has(row.name) && !indexes.has(row.name));
  const removedRoutines = before.globals.routines.filter(row => row.name === V6_MIGRATION_POLICY.addedRoutine);
  need(removedRoutines.length === 1 && removedRoutines[0].arguments === '' && removedRoutines[0].kind === 'f', 'U7_V6_DECLARED_ROUTINE');
  before.globals.routines = before.globals.routines.filter(row => row.name !== V6_MIGRATION_POLICY.addedRoutine);
  for (const table of before.manifest.tables) table.schemaSha256 = currentInventoryCanonicalHash(currentInventorySchemaMetadata(table));
  before.manifest.catalogSha256 = currentInventoryCanonicalHash(before.manifest.tables.map(currentInventorySchemaMetadata));
  const { contentSha256, ...body } = before.manifest; before.manifest.contentSha256 = currentInventoryCanonicalHash(body);
  return { before, removed: { tables: [...tables], indexes: [...indexes].sort(), routines: [V6_MIGRATION_POLICY.addedRoutine] }, self };
}

async function canonical(filename, directory = false) {
  need(path.isAbsolute(filename) && path.resolve(filename) === filename, 'U7_V6_CATALOG_PATH');
  for (let current = filename;; current = path.dirname(current)) {
    const stat = await fs.lstat(current);
    need(!stat.isSymbolicLink() && (current === filename && !directory ? stat.isFile() && stat.nlink === 1 : stat.isDirectory())
      && path.resolve(await fs.realpath(current)) === current, 'U7_V6_CATALOG_PATH');
    if (path.dirname(current) === current) break;
  }
}
async function pin(filename, maximum = 4 * 1024 ** 2) {
  await canonical(filename); const before = await fs.lstat(filename, { bigint: true });
  need(before.size > 0n && before.size <= BigInt(maximum), 'U7_V6_SOURCE_BYTES'); const bytes = await fs.readFile(filename);
  const after = await fs.lstat(filename, { bigint: true });
  need(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs
    && before.ctimeNs === after.ctimeNs && before.size === BigInt(bytes.length), 'U7_V6_SOURCE_CHANGED');
  return { path: filename, bytes: bytes.length, sha256: sha(bytes) };
}
const pinSources = async files => Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, filename]) => [name, await pin(filename)])));
const safeCode = error => typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code) ? error.code : 'U7_V6_CATALOG_QUALIFICATION_FAILED';

/** No initialization/bootstrap is called. All database connections default to
 * read-only and the inventory/global readers additionally open READ ONLY txs. */
export async function qualifyAutomaticPairV6Catalog(filename) {
  const owned = await loadOwnedPairSqlFixture(filename), { config, directory } = owned;
  validateAutomaticPairV6CatalogFixture(config, filename);
  const runId = randomUUID(), output = path.join(directory, 'automatic-pair-v6-catalog-qualification-' + runId + '.private.json');
  const reservation = await fs.open(output, 'wx', 0o600), runDirectory = path.join(directory, 'automatic-pair-v6-catalog-' + runId);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000), check = () => controller.signal.throwIfAborted();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 15000,
    query_timeout: 20000, idle_in_transaction_session_timeout: 30000, application_name: 'pf-u7-automatic-pair-v6-catalog-qualification',
    options: '-c default_transaction_read_only=on -c search_path=pg_catalog,public' });
  const checks = []; let sourcePins, actual, final, simulated, comparison, self, integrity;
  const files = { operator: fileURLToPath(import.meta.url), fixtureGuard: fileURLToPath(new URL('./pair-sql-qualification.mjs', import.meta.url)),
    inventory: V6_CATALOG_INVENTORY.path, inventorySource: path.join(ROOT, 'server/operations/losslessInventory.ts'),
    globals: fileURLToPath(new URL('../pathfinder-barriers/global-sql-v2.mjs', import.meta.url)),
    qualifier: fileURLToPath(new URL('../pathfinder-barriers/migration-conservation-v6.mjs', import.meta.url)),
    verifier: fileURLToPath(new URL('../pathfinder-copied-recovery/current-inventory-lib.mjs', import.meta.url)),
    pairSource: path.join(ROOT, 'server/pathfinder/automaticPairSchema.ts'), bootstrapSource: path.join(ROOT, 'server/pathfinder/schema.ts'),
    pairCompiled: path.join(config.compiledRoot, 'server/pathfinder/automaticPairSchema.js'), bootstrapCompiled: path.join(config.compiledRoot, 'server/pathfinder/schema.js'),
    databaseCompiled: path.join(config.compiledRoot, 'server/db.js') };
  const guard = async () => {
    check(); const rows = (await pool.query(`SELECT current_database() AS db,current_setting('default_transaction_read_only') AS read_only,
      current_setting('server_version_num') AS version,(SELECT count(*)::text FROM public.pfu7_fixture_owner) AS owners,
      EXISTS(SELECT 1 FROM public.pfu7_fixture_owner WHERE owner=$1 AND fixture_kind=$2) AS owned`, [config.owner, KIND])).rows;
    need(rows.length === 1 && rows[0].db === config.database && rows[0].owners === '1' && rows[0].owned === true
      && rows[0].read_only === 'on' && /^18[0-9]{4}$/.test(rows[0].version), 'U7_V6_CATALOG_OWNER');
  };
  const capture = async (label, reader) => {
    await guard(); const captureDirectory = path.join(runDirectory, label);
    const manifest = await reader.captureLosslessInventory(pool, { allowedRoot: runDirectory, directory: captureDirectory,
      ownerId: config.owner, signal: controller.signal, limits: { milliseconds: 120000, acquireMilliseconds: 5000 } });
    await guard(); const globals = await capturePublicGlobals(pool, { signal: controller.signal });
    const globalFile = path.join(runDirectory, label + '.globals.private.json'); await fs.writeFile(globalFile, JSON.stringify(globals) + '\n', { flag: 'wx', mode: 0o600 });
    const reference = { directory: captureDirectory, manifest: await pin(path.join(captureDirectory, 'manifest.json'), 16 * 1024 ** 2), globals: await pin(globalFile, 16 * 1024 ** 2) };
    return { facts: { manifest, globals }, reference };
  };
  try {
    await canonical(directory, true); await fs.mkdir(runDirectory, { mode: 0o700 }); await canonical(runDirectory, true);
    sourcePins = await pinSources(files);
    need(sourcePins.inventory.sha256 === V6_CATALOG_INVENTORY.sha256, 'U7_V6_QUALIFIED_INVENTORY_PIN');
    const reader = await import(pathToFileURL(V6_CATALOG_INVENTORY.path).href); need(typeof reader.captureLosslessInventory === 'function', 'U7_V6_INVENTORY_EXPORT');
    await guard(); actual = await capture('actual', reader);
    checks.push({ name: 'actual-PG18-public-catalog-read-with-owned-qualified-inventory', status: 'PASS' });
    self = qualifyMigrationFacts({ before: actual.facts, after: actual.facts, pristine: actual.facts });
    const derived = deriveSimulatedV6Before(actual.facts); simulated = derived.before;
    comparison = qualifyMigrationFacts({ before: simulated, after: actual.facts, pristine: actual.facts });
    need(comparison.status === 'PASS' && same(comparison.newTables, V6_MIGRATION_POLICY.newTables), 'U7_V6_CATALOG_ADDITIVE_COMPARISON');
    await fs.writeFile(path.join(runDirectory, 'simulated-before-facts.private.json'), JSON.stringify({ kind: 'simulated-before-facts', realMigration: false, facts: simulated }) + '\n', { flag: 'wx', mode: 0o600 });
    checks.push({ name: 'V6-first-addition-accepts-real-pristine-catalog-with-simulated-before', status: 'PASS' },
      { name: 'V6-idempotent-self-comparison-preserves-real-catalog', status: 'PASS' });
    final = await capture('final', reader);
    integrity = await compareCurrentInventories(actual.reference.directory, final.reference.directory, { comparison: 'exact',
      beforeOwnerId: config.owner, afterOwnerId: config.owner, signal: controller.signal });
    need(integrity.status === 'PASS' && same(actual.facts.globals, final.facts.globals), 'U7_V6_PUBLIC_CATALOG_CHANGED');
    await guard(); const reloaded = await loadOwnedPairSqlFixture(filename);
    need(reloaded.containerId === owned.containerId && reloaded.configSha256 === owned.configSha256 && same(sourcePins, await pinSources(files)), 'U7_V6_SOURCE_OR_OWNER_CHANGED');
    checks.push({ name: 'actual-public-schema-rows-keys-sequences-and-sources-unchanged', status: 'PASS' });
    const receipt = { schemaVersion: 'wfc.pf.u7-automatic-pair-v6-catalog-qualification.v1', status: 'PASS', owner: config.owner, runId,
      scope: { actualPg18PublicCatalog: true, simulatedBefore: true, realMigration: false, databaseMutations: false, applicationRuntime: false },
      configSha256: owned.configSha256, containerId: owned.containerId, sourcePins, checks, actual: actual.reference, final: final.reference,
      simulatedBeforeSha256: currentInventoryCanonicalHash(simulated), comparison, self, integrity };
    await reservation.writeFile(JSON.stringify(receipt, null, 2) + '\n'); await reservation.sync();
    console.log(JSON.stringify({ status: 'PASS', actualCatalog: true, simulatedBefore: true, realMigration: false, checks: checks.length, receipt: output })); return receipt;
  } catch (error) {
    const code = safeCode(error), receipt = { schemaVersion: 'wfc.pf.u7-automatic-pair-v6-catalog-qualification.v1', status: 'FAIL', owner: config.owner, runId,
      scope: { actualPg18PublicCatalog: true, simulatedBefore: true, realMigration: false, databaseMutations: false, applicationRuntime: false },
      configSha256: owned.configSha256, containerId: owned.containerId, sourcePins: sourcePins ?? null, checks, code,
      actual: actual?.reference ?? null, final: final?.reference ?? null, comparison: comparison ?? null, self: self ?? null };
    await reservation.writeFile(JSON.stringify(receipt, null, 2) + '\n'); await reservation.sync();
    console.log(JSON.stringify({ status: 'FAIL', actualCatalog: true, simulatedBefore: true, realMigration: false, code, checks: checks.length, receipt: output }));
    throw Object.assign(Error(code), { code });
  } finally { clearTimeout(timer); controller.abort(); await pool.end(); await reservation.close(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  need(process.argv.length === 4 && process.argv[2] === '--fixture', 'U7_V6_CATALOG_ARGUMENTS');
  await qualifyAutomaticPairV6Catalog(path.resolve(process.argv[3])).catch(() => { process.exitCode = 1; });
}
