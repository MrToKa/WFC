import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRATCH = path.join(ROOT, 'pathfinder-engine/.scratch');
const IMAGE = 'sha256:9a2e0383c38afd52cff14eeefe2b806fcde406b317002cd13ce513d309942751';
const KIND = 'synthetic-cable-workflow-u7';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const run = promisify(execFile);
const refuse = code => { throw Object.assign(Error(code), { code }); };
const docker = async (args, env = process.env) => (await run('docker', args, { env, windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 ** 2 })).stdout.trim();
const json = (filename, value) => fs.writeFile(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

async function canonical(directory) {
  const absolute = path.resolve(directory);
  for (let part = absolute;; part = path.dirname(part)) {
    const stat = await fs.lstat(part);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(await fs.realpath(part)) !== part) refuse('U7_UNSAFE_DIRECTORY');
    if (path.dirname(part) === part) break;
  }
  return absolute;
}

function validateConfig(config, filename) {
  const directory = path.dirname(path.resolve(filename));
  if (config.schemaVersion !== 'wfc.pf.u7-chain-fixture.v1' || !UUID.test(config.owner)
    || path.dirname(directory) !== SCRATCH || path.basename(directory) !== 'cable-workflow-u7-' + config.owner
    || config.database !== 'wfc_pfu7_' + config.owner.replaceAll('-', '')
    || config.containerName !== 'pfu7-pg-' + config.owner.replaceAll('-', '').slice(0, 12)
    || config.compiledRoot !== path.join(ROOT, 'server/dist')
    || config.storageRoot !== path.join(directory, 'storage') || config.output !== path.join(directory, 'chain-receipt.private.json')) refuse('U7_FIXTURE_IDENTITY');
  const url = new URL(config.databaseUrl);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' + config.database
    || url.username !== 'pfu7' || !url.password || !/^[0-9]+$/.test(url.port)) refuse('U7_DATABASE_DESTINATION');
  return directory;
}

async function inspectOwned(config) {
  const [container] = JSON.parse(await docker(['inspect', config.containerName]));
  if (container.Name !== '/' + config.containerName || container.Image !== IMAGE
    || container.Config.Labels?.['wfc.pathfinder.owner'] !== config.owner
    || container.Config.Labels?.['wfc.pathfinder.fixture'] !== KIND
    || container.Mounts.some(mount => mount.Type !== 'tmpfs')
    || container.HostConfig.Privileged || container.HostConfig.RestartPolicy.Name !== 'no') refuse('U7_CONTAINER_OWNERSHIP');
  return container;
}

async function bootstrap(config) {
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 10000 });
  try {
    if ((await pool.query('SELECT current_database() AS name')).rows[0].name !== config.database) refuse('U7_DATABASE_IDENTITY');
    const existing = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
    if (existing.length) refuse('U7_DATABASE_NOT_EMPTY');
    await pool.query('CREATE TABLE public.pfu7_fixture_owner(owner uuid PRIMARY KEY,fixture_kind text NOT NULL)');
    await pool.query('INSERT INTO public.pfu7_fixture_owner VALUES($1,$2)', [config.owner, KIND]);
  } finally { await pool.end(); }
  // All required configuration is private fixture data, set before importing the
  // normal production initializer. No app, producer or HTTP server is started.
  Object.assign(process.env, { DATABASE_URL: config.databaseUrl, JWT_SECRET: config.jwtSecret,
    MINIO_ACCESS_KEY: config.minioAccessKey, MINIO_SECRET_KEY: config.minioSecretKey,
    MINIO_ENDPOINT: '127.0.0.1', MINIO_PORT: '1', MINIO_USE_SSL: 'false',
    PF_ROOT: config.storageRoot, PF_ENGINE_DLL: config.engineDll, PF_ENGINE_MODE: 'oneshot' });
  const db = await import(pathToFileURL(path.join(config.compiledRoot, 'server/db.js')).href);
  try { await db.initializeDatabase(); } finally { await db.shutdownDatabase(); }
}

async function create() {
  await canonical(SCRATCH);
  const owner = randomUUID(), suffix = owner.replaceAll('-', ''), directory = path.join(SCRATCH, 'cable-workflow-u7-' + owner);
  await fs.mkdir(directory); await canonical(directory);
  await fs.mkdir(path.join(directory, 'storage'));
  const database = 'wfc_pfu7_' + suffix, containerName = 'pfu7-pg-' + suffix.slice(0, 12), password = randomBytes(24).toString('hex');
  await json(path.join(directory, 'owner.private.json'), { owner, kind: KIND, containerName, image: IMAGE, createdAt: new Date().toISOString() });
  await docker(['run', '--detach', '--pull=never', '--restart=no', '--name', containerName,
    '--label', 'wfc.pathfinder.owner=' + owner, '--label', 'wfc.pathfinder.fixture=' + KIND,
    '--memory=512m', '--memory-swap=512m', '--cpus=1', '--mount', 'type=tmpfs,destination=/var/lib/postgresql',
    '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER=pfu7',
    '--env', 'POSTGRES_DB=' + database, IMAGE, '-c', 'shared_buffers=64MB', '-c', 'max_connections=40'],
  { ...process.env, POSTGRES_PASSWORD: password });
  const partial = { owner, containerName }, container = await inspectOwned(partial);
  const ports = container.NetworkSettings.Ports['5432/tcp'];
  if (ports?.length !== 1 || ports[0].HostIp !== '127.0.0.1') refuse('U7_PORT_BINDING');
  const config = { schemaVersion: 'wfc.pf.u7-chain-fixture.v1', owner, database,
    databaseUrl: `postgresql://pfu7:${password}@127.0.0.1:${ports[0].HostPort}/${database}`,
    compiledRoot: path.join(ROOT, 'server/dist'), storageRoot: path.join(directory, 'storage'),
    engineDll: path.join(SCRATCH, 'equipment-visibility-u6a-5617da3b-234b-40ac-abae-1553bc92392f/artifacts/bin/PathFinder.ModelRunner/release/PathFinder.ModelRunner.dll'),
    output: path.join(directory, 'chain-receipt.private.json'), deadlineMilliseconds: 300000,
    containerName, jwtSecret: randomBytes(48).toString('hex'), minioAccessKey: 'pfu7fixture', minioSecretKey: randomBytes(32).toString('hex') };
  const filename = path.join(directory, 'fixture.private.json'); validateConfig(config, filename);
  await json(filename, config);
  const deadline = Date.now() + 60000;
  for (;;) {
    let probe;
    try {
      // pg_isready inside the container can see initdb's temporary server.
      // Require a host TCP connection before production schema initialization.
      probe = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 1000 });
      if ((await probe.query('SELECT current_database() AS name')).rows[0].name !== database) refuse('U7_DATABASE_IDENTITY');
      break;
    }
    catch { if (Date.now() >= deadline) refuse('U7_DATABASE_START_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 400)); }
    finally { await probe?.end(); }
  }
  await bootstrap(config);
  console.log(JSON.stringify({ status: 'READY', owner, containerId: container.Id, fixture: filename, synthetic: true }));
}

async function retire(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) refuse('U7_UNSAFE_CONFIG');
  const config = JSON.parse(await fs.readFile(filename, 'utf8')), directory = validateConfig(config, filename);
  await canonical(directory); const container = await inspectOwned(config);
  await docker(['rm', '--force', container.Id]); // Exact owned disposable fixture; no prune or volume deletion.
  await json(path.join(directory, 'retired.json'), { status: 'RETIRED', owner: config.owner, containerId: container.Id, at: new Date().toISOString() });
  await fs.unlink(filename); // Newly created fixture credentials only; evidence/storage retained.
  console.log(JSON.stringify({ status: 'RETIRED', owner: config.owner, containerId: container.Id }));
}

if (process.argv[2] === 'create' && process.argv.length === 3) await create();
else if (process.argv[2] === 'retire' && process.argv.length === 4) await retire(path.resolve(process.argv[3]));
else refuse('U7_FIXTURE_ARGUMENTS');
