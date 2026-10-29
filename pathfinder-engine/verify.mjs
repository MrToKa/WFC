import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const engine = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(engine, '..');
const receipt = path.join(root, 'docs/pathfinder/evidence/pf1/runs', new Date().toISOString().replaceAll(/[:.]/g, '-'));
fs.mkdirSync(receipt, { recursive: true });
const env = { ...process.env, DOTNET_CLI_HOME: path.join(engine, '.dotnet-home'),
  DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false' };
const checks = [
  ['runner-build', ['build', '--configuration', 'Release', 'pathfinder-engine/tools/PathFinder.LocalRunner/PathFinder.LocalRunner.csproj']],
  ['regression', ['run', '--configuration', 'Release', '--project', 'pathfinder-engine/tests/PathFinder.Regression/PathFinder.Regression.csproj']],
  ['parity', ['run', '--configuration', 'Release', '--project', 'pathfinder-engine/tests/PathFinder.Parity/PathFinder.Parity.csproj', '--', root, receipt]],
];
const results = [];
for (const [name, args] of checks) {
  const result = spawnSync('dotnet', args, { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(path.join(receipt, name + '.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  results.push({ name, exitCode: result.status, status: result.status === 0 ? 'PASS' : 'FAIL', error: result.error?.message });
  console.log(`${name}: ${result.status === 0 ? 'PASS' : 'FAIL'}`);
  if (result.status !== 0) break;
}
const status = results.length === checks.length && results.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL';
fs.writeFileSync(path.join(receipt, 'run.json'), JSON.stringify({ stage: 'PF-1', recordedAtUtc: new Date().toISOString(), status, results }, null, 2) + '\n');
console.log(`Evidence: ${receipt}`);
process.exitCode = status === 'PASS' ? 0 : 1;
