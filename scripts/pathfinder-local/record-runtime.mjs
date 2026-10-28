import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, load, configuration, info } from './runtime-lib.mjs';
import { hashFile } from '../operations/archives.mjs';

const execute = promisify(execFile), state = await load();
const tests = await execute(process.execPath, ['--test', 'scripts/pathfinder-local/runtime.test.mjs'], { cwd: ROOT, windowsHide: true });
const files = ['docker/pathfinder.Dockerfile', 'docker/pathfinder.Dockerfile.dockerignore', 'docker/pathfinder.compose.yml', 'docker/pathfinder.nginx.conf', ...(await fs.readdir(path.join(ROOT, 'scripts/pathfinder-local'))).filter(name => name.endsWith('.mjs')).map(name => 'scripts/pathfinder-local/' + name)];
const priorRestores = [];
for (const name of (await fs.readdir(path.join(ROOT, 'docs/pathfinder/runtime'))).filter(name => /^restore-check-[0-9]+\.json$/.test(name))) {
  const value = JSON.parse(await fs.readFile(path.join(ROOT, 'docs/pathfinder/runtime', name), 'utf8'));
  if (value.status === 'PASS' && value.source?.project === state.project) priorRestores.push({ path: 'docs/pathfinder/runtime/' + name, at: value.checkedAt, backupId: value.restore.backupId, scope: 'Historical initial profile; not proof for later changed sources/images/data.' });
}
const receipt = { schemaVersion: 1, status: 'PASS', scope: 'Initial isolated runtime prerequisites and own model import; not final PF8 acceptance.', recordedAt: new Date().toISOString(), timezone: 'Europe/Kiev', revisionAtRecording: (await execute('git', ['rev-parse', 'HEAD'], { cwd: ROOT, windowsHide: true })).stdout.trim(), branchAtRecording: (await execute('git', ['branch', '--show-current'], { cwd: ROOT, windowsHide: true })).stdout.trim(), configuration: await configuration(state), runtime: await info(state), images: state.images, build: state.build, demo: state.demo, checks: { nodeTests: { result: 'PASS', output: tests.stdout }, imageBuild: state.build && state.images ? 'PASS_AT_RECORDED_BUILD_SCOPE' : 'NOT_RUN', firstBootstrap: state.demo ? 'PASS_AT_RECORDED_BOOTSTRAP_SCOPE' : 'NOT_RUN', actualPortableImportAndSelection: state.demo?.model ? 'PASS_AT_RECORDED_IMPORT_SCOPE' : 'NOT_RUN', authoritativeArtifactsBackupAndRestore: priorRestores.length ? 'HISTORICAL_PASS_ONLY; see scoped receipt' : 'NOT_RUN', finalApplicationIntegration: 'NOT_RUN' }, priorRestores, files: [] };
for (const file of files) receipt.files.push({ path: file, ...await hashFile(path.join(ROOT, file)) });
const output = path.join(ROOT, 'docs/pathfinder/runtime/runtime-initial-' + Date.now() + '.json'); await fs.writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ status: 'PASS', output }));
