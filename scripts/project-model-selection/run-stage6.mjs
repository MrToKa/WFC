import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import net from 'node:net';

const { values, positionals } = parseArgs({ options: {
  'run-dir': { type: 'string' }, port: { type: 'string', default: '18086' },
  'dev-port': { type: 'string', default: '15186' }, 'playwright-module': { type: 'string' }, 'browser-executable': { type: 'string' }, 'primary-zip': { type: 'string' }, 'secondary-zip': { type: 'string' },
}, allowPositionals: true, strict: true });
const action = positionals[0] ?? 'status';
if (!['init', 'build', 'start', 'status', 'regression', 'contracts', 'integration', 'browser', 'stop'].includes(action) || positionals.length > 1 || !values['run-dir']) {
  throw new Error('Usage: node scripts/project-model-selection/run-stage6.mjs init|build|start|status|regression|contracts|integration|browser|stop --run-dir ABSOLUTE_DIRECTORY [--port 18086] [--dev-port 15186] [--primary-zip FILE] [--secondary-zip FILE]');
}
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runDirectory = path.resolve(values['run-dir']);
if (runDirectory === projectRoot || runDirectory.startsWith(projectRoot + path.sep)) throw new Error('Fixture artifacts must be outside the WFC source directory.');
const statePath = path.join(runDirectory, 'fixture-state.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixtureProxy = (source) => 'upstream stage6_workers { server api:4000; server api2:4000; }\n' + source.replaceAll('proxy_pass http://api:4000;', 'proxy_pass http://stage6_workers;').replace('    client_max_body_size 10m;', '    client_max_body_size 10m;\n    add_header X-Stage4-Upstream $upstream_addr always;');
let state;
if (action === 'init') {
  const port = Number(values.port);
  const devPort = Number(values['dev-port']);
  if (![port,devPort].every(value => Number.isInteger(value) && value >= 1024 && value <= 65535) || port === devPort) throw new Error('Invalid isolated proxy/development port.');
  await fs.mkdir(runDirectory, { recursive: true });
  const runId = randomUUID();
  const token = runId.replaceAll('-', '').slice(0, 12);
  const artifactParent = 'C:/Users/todor.chankov/Documents/Codex/2026-10-16';
  const primaryZip = path.resolve(values['primary-zip'] ?? `${artifactParent}/routings-model-preparer-app-output/aalborg-svf-stage3.zip`);
  const secondaryZip = path.resolve(values['secondary-zip'] ?? `${artifactParent}/routings-model-package-output/aalborg-svf-v1.zip`);
  const packageInputs = [];
  for (const [filename, expectedBytes, expectedSha256] of [[primaryZip, 439112829, '8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5'], [secondaryZip, 439112840, 'e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922']]) {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Package input must be a regular local file.');
    const digest = createHash('sha256'); let bytes = 0;
    for await (const chunk of createReadStream(filename)) { bytes += chunk.length; digest.update(chunk); }
    const sha256 = digest.digest('hex');
    if (bytes !== expectedBytes || sha256 !== expectedSha256) throw new Error('Real Stage 4 package input differs from its pinned transport identity.');
    packageInputs.push({ filename, bytes, sha256, checkedAt: new Date().toISOString() });
  }
  const evidenceDirectory = path.join(runDirectory, 'evidence');
  await fs.mkdir(evidenceDirectory, { recursive: true });
  const productionProxy = await fs.readFile(path.join(projectRoot, 'docker/nginx.conf'), 'utf8');
  const proxyText = fixtureProxy(productionProxy);
  const proxyPath = path.join(runDirectory, 'proxy.conf');
  await fs.writeFile(proxyPath, proxyText, { flag: 'wx' });
  state = { schemaVersion: 1, runId, project: `wfc-project-model-selection-stage6-${token}`, createdAt: new Date().toISOString(), projectRoot, runDirectory,
    composeFile: path.join(projectRoot, 'scripts/project-model-selection/compose.stage6.yml'), envFile: path.join(runDirectory, 'fixture.env'), proxyPort: port, devPort: Number(values['dev-port']),
    images: { api: `wfc-project-model-selection-stage6-api:${token}`, web: `wfc-project-model-selection-stage6-web:${token}`, test: `wfc-project-model-selection-stage6-test:${token}` },
    evidenceDirectory, primaryZip, secondaryZip, packageInputs, proxyPath, productionProxySha256: hash(productionProxy), proxySha256: hash(proxyText), commands: [],
    credentials: 'Explicit synthetic disposable fixture values only; no existing .env or credential file is read or copied.' };
  const entries = { STAGE6_RUN_ID: runId, STAGE6_API_IMAGE: state.images.api, STAGE6_WEB_IMAGE: state.images.web, STAGE6_TEST_IMAGE: state.images.test,
    STAGE6_PROXY_PORT: port, STAGE6_DEV_PORT: state.devPort, STAGE6_ALLOWED_ORIGINS: `http://127.0.0.1:${port},http://127.0.0.1:${devPort}`, STAGE6_PROXY_CONFIG: proxyPath, STAGE6_PRIMARY_ZIP: primaryZip, STAGE6_SECONDARY_ZIP: secondaryZip, STAGE6_EVIDENCE_DIR: evidenceDirectory };
  for (const value of Object.values(entries)) if (/[\r\n'"#]/.test(String(value))) throw new Error('Unsupported fixture path character.');
  const envText = Object.entries(entries).map(([key, value]) => `${key}='${String(value).replaceAll('\\', '/')}'`).join('\n') + '\n';
  await fs.writeFile(state.envFile, envText, { flag: 'wx', mode: 0o600 });
  state.envFileSha256 = hash(envText);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: 'INITIALIZED', statePath, runId, project: state.project, proxyPort: port, devPort: Number(values['dev-port']), images: state.images }));
  process.exit(0);
}
state = JSON.parse(await fs.readFile(statePath, 'utf8'));
if (state.schemaVersion !== 1 || state.runDirectory !== runDirectory || state.projectRoot !== projectRoot || !/^wfc-project-model-selection-stage6-[a-f0-9]{12}$/.test(state.project) || !/^[a-f0-9-]{36}$/.test(state.runId)) throw new Error('Unrecognized isolated fixture state.');
const expectedToken = state.runId.replaceAll('-', '').slice(0, 12);
if (state.project !== `wfc-project-model-selection-stage6-${expectedToken}` || state.composeFile !== path.join(projectRoot, 'scripts/project-model-selection/compose.stage6.yml') || state.envFile !== path.join(runDirectory, 'fixture.env') || state.proxyPath !== path.join(runDirectory, 'proxy.conf') || state.evidenceDirectory !== path.join(runDirectory, 'evidence') || Object.entries(state.images).some(([kind, tag]) => tag !== `wfc-project-model-selection-stage6-${kind}:${expectedToken}`)) throw new Error('Isolated fixture lifecycle identity is inconsistent.');
if (hash(await fs.readFile(state.envFile)) !== state.envFileSha256) throw new Error('Synthetic fixture environment changed; refusing lifecycle operation.');
if (hash(await fs.readFile(state.proxyPath)) !== state.proxySha256) throw new Error('Fixture proxy configuration changed; refusing lifecycle operation.');
const save = () => fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
const composeArgs = ['compose', '--env-file', state.envFile, '--project-name', state.project, '--file', state.composeFile];
const inspect = (args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function assertOwnership() {
  for (const kind of ['container', 'volume', 'network']) {
    const args = kind === 'container' ? ['ps', '-a', '--no-trunc', '--filter', `label=com.docker.compose.project=${state.project}`, '--format', '{{.ID}}'] : [kind, 'ls', '--filter', `label=com.docker.compose.project=${state.project}`, '--format', kind === 'volume' ? '{{.Name}}' : '{{.ID}}'];
    const ids = inspect(args).split(/\r?\n/).filter(Boolean);
    for (const id of ids) {
      const value = inspect([kind === 'container' ? 'inspect' : kind, ...(kind === 'container' ? [] : ['inspect']), '--format', kind === 'container' ? '{{ index .Config.Labels "codex.stage6.project-model-selection-fixture" }}' : '{{ index .Labels "codex.stage6.project-model-selection-fixture" }}', id]);
      if (value !== state.runId) throw new Error('Foreign Docker ownership within fixture project; no mutation performed.');
    }
  }
}
async function command(args, name, { allowFailure = false } = {}) {
  const logPath = path.join(state.evidenceDirectory, `${Date.now()}-${name}.log`);
  const handle = await fs.open(logPath, 'wx');
  const record = { command: ['docker', ...args], startedAt: new Date().toISOString(), logPath };
  try {
    const child = spawn('docker', args, { cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let writeChain = Promise.resolve();
    const append = (data) => { writeChain = writeChain.then(() => handle.write(data)); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    record.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    await writeChain;
  } finally { record.completedAt = new Date().toISOString(); await handle.close(); state.commands.push(record); await save(); }
  console.log(JSON.stringify({ name, exitCode: record.exitCode, logPath }));
  if (record.exitCode !== 0 && !allowFailure) throw new Error(`Isolated ${name} failed; inspect its recorded log.`);
  return record.exitCode;
}
async function sourceInventory() {
  const files = [];
  const skipped = new Set(['.git', 'node_modules', '.data', 'dist', 'coverage', 'backups', 'docs']);
  const walk = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (skipped.has(entry.name) || entry.name.startsWith('.env') || entry.name === '.npmrc') continue;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Source inventory contains a link.');
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && (/\.(?:ts|tsx|[cm]?js|json|yml|yaml|conf|ps1|html|css|svg|woff2?|png|gz|bin)$/.test(entry.name) || full.includes(path.join('viewer-runtime','sdk')+path.sep) || ['Dockerfile', '.dockerignore', '.gitattributes'].includes(entry.name))) {
        const bytes = await fs.readFile(full); files.push({ path: path.relative(projectRoot, full).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  };
  await walk(projectRoot); files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0); return files;
}

assertOwnership();
if (action === 'build') {
  const buildStartedAt = new Date().toISOString();
  const buildKey = Date.now();
  const productionProxy = await fs.readFile(path.join(projectRoot, 'docker/nginx.conf'), 'utf8');
  const proxyText = fixtureProxy(productionProxy);
  if (state.proxySha256 !== hash(proxyText)) {
    await fs.copyFile(state.proxyPath, path.join(state.evidenceDirectory, `proxy-before-${buildKey}.conf`));
    await fs.writeFile(state.proxyPath, proxyText);
    state.proxySha256 = hash(proxyText); state.productionProxySha256 = hash(productionProxy); await save();
  }
  const before = await sourceInventory();
  const beforePath = path.join(state.evidenceDirectory, `build-${buildKey}-sources-before.json`);
  const afterPath = path.join(state.evidenceDirectory, `build-${buildKey}-sources-after.json`);
  await fs.writeFile(beforePath, JSON.stringify(before, null, 2) + '\n', { flag: 'wx' });
  for (const [kind, target] of [['api', 'api-runtime'], ['web', 'web-runtime'], ['test', 'test-runtime']]) {
    await command(['build', '--progress=plain', '--label', `codex.stage6.project-model-selection-fixture=${state.runId}`, '--build-arg', 'VITE_VIEWER_HARNESS=true', '--target', target, '--iidfile', path.join(state.evidenceDirectory, `${kind}-image.id`), '-t', state.images[kind], '-f', path.join(projectRoot, 'Dockerfile'), projectRoot], `build-${kind}`);
  }
  const after = await sourceInventory();
  await fs.writeFile(afterPath, JSON.stringify(after, null, 2) + '\n', { flag: 'wx' });
  if (state.build) { state.buildHistory ??= []; state.buildHistory.push(state.build); }
  state.build = { startedAt: buildStartedAt, completedAt: new Date().toISOString(), beforePath, afterPath, sourceInventoryStable: JSON.stringify(before) === JSON.stringify(after), sourceInventorySha256: hash(JSON.stringify(after)), images: {} };
  for (const [kind, tag] of Object.entries(state.images)) state.build.images[kind] = inspect(['image', 'inspect', '--format', '{{.Id}}', tag]);
  await save();
  if (!state.build.sourceInventoryStable) throw new Error('Source changed during build; rebuild after source freeze.');
} else if (action === 'start') {
  if (!state.build?.sourceInventoryStable) throw new Error('A stable production build is required before fixture startup.');
  const existing = inspect(['ps', '-a', '--filter', `label=com.docker.compose.project=${state.project}`, '--format', '{{.ID}}']);
  if (!existing) {
    const occupied = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: state.proxyPort });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false)); socket.setTimeout(1500, () => { socket.destroy(); resolve(true); });
    });
    if (occupied) throw new Error('Isolated proxy port is already occupied; no existing service was changed.');
  }
  await command([...composeArgs, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '300'], 'fixture-start');
  const response = await fetch(`http://127.0.0.1:${state.proxyPort}/health`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Isolated host proxy health check failed.');
  const devDeadline = Date.now() + 90_000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${state.devPort}/`, { signal: AbortSignal.timeout(3000) })).ok) break; } catch { /* Isolated Vite may still initialize. */ }
    if (Date.now() >= devDeadline) throw new Error('Isolated development same-origin server did not become ready.');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  state.startedAt = new Date().toISOString(); await save();
} else if (action === 'regression') {
  const regressionStartedAt = new Date().toISOString();
  const regressionKey = Date.now();
  const before = await sourceInventory(); const results = [];
  const imageId = inspect(['image', 'inspect', '--format', '{{.Id}}', state.images.test]);
  if (!state.build?.sourceInventoryStable || hash(JSON.stringify(before)) !== state.build.sourceInventorySha256) throw new Error('Regression source differs from the recorded stable build. Rebuild first.');
  const environment = ['-e', 'DATABASE_URL=postgresql://stage4:stage4-fixture-only@invalid.invalid:5432/not_used', '-e', 'JWT_SECRET=stage4-fixture-jwt-only', '-e', 'MINIO_ACCESS_KEY=stage4fixture', '-e', 'MINIO_SECRET_KEY=stage4-fixture-only'];
  const focusedTests = ["src/pages/ProjectDetails/hooks/useProjectTokenBinding.test.tsx","src/api/projectModels.test.ts","src/pages/ProjectDetails/hooks/useProjectModelSelection.test.ts","src/pages/ProjectDetails/ProjectModelSection.test.tsx","src/pages/ProjectDetails/DetailsTab.test.tsx","src/pages/ProjectDetails/hooks/useProjectDataRequests.test.tsx","src/ProjectAccess.test.tsx","src/viewer/ViewerController.test.ts","src/utils/cableLength.test.ts","src/pages/TrayDetails/loadAssessment.test.ts","src/pages/TrayDetails/hooks/useTrefoilClampSettings.test.tsx","src/pages/TrayDetails/trefoilClamps.test.ts"];
  for (const [name, args] of [['versions', ['node', '-e', 'console.log(JSON.stringify({node:process.version,uid:process.getuid(),network:"none"}))']], ['typecheck', ['npm', 'run', 'typecheck']], ['lint', ['npm', 'run', 'lint']], ['build', ['npm', 'run', 'build']], ['vitest', ['npm', 'test', '--', '--run', '--maxWorkers=1', '--minWorkers=1', ...focusedTests]]]) {
    const frontendTestEnvironment = name === 'vitest' ? ['-e', 'VITE_API_URL=http://localhost:4000'] : [];
    const exitCode = await command(['run', '--rm', '--network', 'none', '--cpus', '2', '--memory', '4g', '--pids-limit', '256', '--label', `codex.stage6.project-model-selection-fixture=${state.runId}`, ...environment, ...frontendTestEnvironment, state.images.test, ...args], `regression-${name}`, { allowFailure: true });
    results.push({ name, exitCode });
  }
  const after = await sourceInventory();
  const beforePath = path.join(state.evidenceDirectory, `regression-${regressionKey}-sources-before.json`);
  const afterPath = path.join(state.evidenceDirectory, `regression-${regressionKey}-sources-after.json`);
  if (state.regression) { state.regressionHistory ??= []; state.regressionHistory.push(state.regression); }
  const sameImage = imageId === inspect(['image', 'inspect', '--format', '{{.Id}}', state.images.test]);
  state.regression = { startedAt: regressionStartedAt, completedAt: new Date().toISOString(), imageId, imageUnchanged: sameImage, sourceInventoryStable: JSON.stringify(before) === JSON.stringify(after), beforePath, afterPath, results, status: results.every((r) => r.exitCode === 0) && JSON.stringify(before) === JSON.stringify(after) && sameImage ? 'PASS' : 'FAIL' };
  await fs.writeFile(beforePath, JSON.stringify(before, null, 2) + '\n', { flag: 'wx' });
  await fs.writeFile(afterPath, JSON.stringify(after, null, 2) + '\n', { flag: 'wx' }); await save();
  if (state.regression.status !== 'PASS') process.exitCode = 1;
} else if (action === 'contracts') {
  await command([...composeArgs, '--profile', 'tests', 'run', '--rm', '--no-deps', '-e', 'MODEL_REGISTRY_EVIDENCE=/evidence/selection-contracts-' + Date.now() + '.json', 'tests', 'node', 'scripts/project-model-selection/api-acceptance.mjs', '--contracts-only'], 'selection-metadata-contracts');
} else if (action === 'integration') {
  const attempt = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const mainEvidence = `/evidence/model-selection-integration-${attempt}.json`;
  const restartEvidence = `/evidence/model-selection-restart-${attempt}.json`;
  state.integrationAttempts ??= [];
  const attemptRecord = { attempt, startedAt: new Date().toISOString(), mainEvidence, restartEvidence, status: 'RUNNING' };
  state.integrationAttempts.push(attemptRecord); await save();
  try {
  await command([...composeArgs, '--profile', 'tests', 'run', '--rm', '--no-deps', '-e', `MODEL_REGISTRY_EVIDENCE=${mainEvidence}`, 'tests', 'node', 'scripts/project-model-selection/api-acceptance.mjs'], 'selection-http-integration');
  const workers = inspect([...composeArgs, 'ps', '-q', 'api', 'api2']).split(/\r?\n/).filter(Boolean);
  state.restartProof = { startedAt: new Date().toISOString(), before: workers.map((id) => ({ id, startedAt: inspect(['inspect', '--format', '{{.State.StartedAt}}', id]) })) };
  await save();
  await command([...composeArgs, 'restart', 'api', 'api2'], 'fixture-api-restart');
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (workers.length === 2 && workers.every((id) => inspect(['inspect', '--format', '{{.State.Health.Status}}', id]) === 'healthy')) break;
    if (Date.now() > deadline) throw new Error('Both isolated API workers did not become healthy after restart.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  state.restartProof.after = workers.map((id) => ({ id, startedAt: inspect(['inspect', '--format', '{{.State.StartedAt}}', id]) }));
  await command([...composeArgs, '--profile', 'tests', 'run', '--rm', '--no-deps', '-e', `MODEL_REGISTRY_EVIDENCE=${restartEvidence}`, '-e', `MODEL_REGISTRY_MAIN_EVIDENCE=${mainEvidence}`, 'tests', 'node', 'scripts/project-model-selection/api-acceptance.mjs', '--verify-restart'], 'selection-restart-integration');
  state.restartProof.completedAt = new Date().toISOString(); attemptRecord.status = 'PASS';
  } catch (error) { attemptRecord.status = 'FAIL'; throw error; }
  finally { attemptRecord.completedAt = new Date().toISOString(); await save(); }
} else if (action === 'browser') {
  const { runBrowserAcceptance } = await import('./browser-acceptance.mjs');
  await runBrowserAcceptance({ state, composeArgs, playwrightModule: values['playwright-module'], browserExecutable: values['browser-executable'] });
} else if (action === 'stop') {
  await command([...composeArgs, 'down', '--volumes', '--remove-orphans', '--timeout', '30'], 'fixture-stop');
  state.stoppedAt = new Date().toISOString(); await save();
} else {
  await command([...composeArgs, 'ps', '-a', '--format', 'json'], 'fixture-status');
}
console.log(JSON.stringify({ status: 'COMPLETE', action, statePath, project: state.project, images: state.build?.images }));

