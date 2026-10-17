// Read-only preservation checks; writes only a fresh PF-2 receipt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const engine = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(engine, '..');
const evidence = path.join(root, 'docs/pathfinder/evidence');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const run = (exe, args, binary = false) => execFileSync(exe, args, {
  windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  encoding: binary ? null : 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
});
const git = (repo, ...args) => run('git', ['-C', repo, ...args]).trim();
const lines = value => value.trim() ? value.trim().split(/\r?\n/).map(x => x.trim()) : [];
const check = (condition, message) => { if (!condition) throw new Error(message); };
const baseline = json(path.join(evidence, '00-start-state.json'));
const provenance = json(path.join(engine, 'source-provenance.json'));
const manifest = json(path.join(root, 'docs/pathfinder/fixtures/pf-core-v1.manifest.json'));
const checks = [];
const audit = (name, action) => {
  try { checks.push({ name, status: 'PASS', details: action() }); }
  catch (error) { checks.push({ name, status: 'FAIL', message: error.message }); }
};

audit('unchanged-core-and-original-regression-sources', () => {
  check(provenance.coreFiles.length === 11, 'Expected eleven core sources');
  for (const item of provenance.coreFiles) {
    check(hash(fs.readFileSync(path.join(engine, item.path))) === item.sha256, item.path);
    check(hash(run('git', ['-C', root, 'show', ':' + 'pathfinder-engine/' + item.path], true)) === item.sha256, `Index: ${item.path}`);
  }
  const tests = manifest.harnessSources.filter(item => item.path.endsWith('.cs'));
  for (const item of tests) check(hash(fs.readFileSync(path.join(engine, 'tests/PathFinder.Regression', path.basename(item.path)))) === item.sha256, item.path);
  return { coreFiles: 11, originalTestFiles: tests.length };
});

audit('frozen-pf0-deliveries-preserved', () => {
  const pinned = '23741d1f485248ddb519f9e04e0b7856cc0e3def';
  const files = lines(git(root, 'ls-tree', '-r', '--name-only', pinned, '--', 'docs/pathfinder'));
  for (const file of files) {
    const before = run('git', ['-C', root, 'show', `${pinned}:${file}`], true);
    const after = fs.readFileSync(path.join(root, file));
    if (file.endsWith('/00-validation-matrix.md')) {
      check(after.toString('utf8').replaceAll('\r\n', '\n').startsWith(before.toString('utf8').replaceAll('\r\n', '\n').trimEnd()), 'Frozen matrix prefix changed');
    } else check(after.equals(before), `Frozen delivery changed: ${file}`);
  }
  return { files: files.length, matrixAppendOnly: true, validationGeneratorsRun: false };
});

audit('native-oracle-pinned-source-bytes-preserved', () => {
  const directory = path.join(engine, 'tools/PathFinder.NativeOracle');
  const native = json(path.join(directory, 'source-provenance.json'));
  check(native.files.length === 14, 'Expected fourteen native oracle source copies');
  for (const item of native.files) {
    const bytes = fs.readFileSync(path.join(directory, item.path));
    check(bytes.length === item.bytes && hash(bytes) === item.sha256, `Native pin: ${item.path}`);
    const relative = 'pathfinder-engine/tools/PathFinder.NativeOracle/' + item.path;
    check(hash(run('git', ['-C', root, 'show', ':' + relative], true)) === item.sha256, `Native index pin: ${item.path}`);
  }
  return { pinnedFiles: native.files.length, canonicalCommit: native.commit };
});

audit('original-checkouts-and-dirty-files-preserved', () => {
  const results = [];
  for (const name of ['originalWfc', 'referencePathFinder', 'oldPathFinder']) {
    const before = baseline[name];
    const actual = { head: git(before.path, 'rev-parse', 'HEAD'), branch: git(before.path, 'branch', '--show-current'),
      status: lines(git(before.path, 'status', '--porcelain=v1', '--untracked-files=all')) };
    check(actual.head === before.head && actual.branch === before.branch, `${name} revision changed`);
    check(JSON.stringify(actual.status) === JSON.stringify(before.status.map(x => x.trim())), `${name} working files changed`);
    results.push({ name, ...actual });
  }
  for (const item of baseline.oldPathFinderDirtyFiles) {
    const bytes = fs.readFileSync(path.join(baseline.oldPathFinder.path, item.path));
    check(hash(bytes) === item.sha256 && bytes.length === item.bytes, `Dirty file changed: ${item.path}`);
  }
  return results;
});

audit('original-container-inventory-images-and-start-times-preserved', () => {
  const ids = lines(run('docker', ['ps', '-aq']));
  const rows = ids.length ? lines(run('docker', ['inspect', '--format',
    '{{.Id}}|{{.Name}}|{{.Image}}|{{.State.Status}}|{{.State.StartedAt}}', ...ids])).sort() : [];
  check(JSON.stringify(rows) === JSON.stringify([...baseline.docker.containerRows].sort()), 'Container inventory/start state changed');
  return { containerCount: rows.length, stageContainersCreated: 0, credentialsOrEnvironmentRead: false,
    databaseContentAudit: false, databaseOrStorageWritesPerformed: false };
});

const sourceFiles = lines(git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', 'pathfinder-engine'));
const sources = sourceFiles.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) }));
const report = {
  schemaVersion: 'pathfinder.isolation-audit.v1', stage: 'PF-2', observedAtUtc: new Date().toISOString(),
  checkedBaseCommit: git(root, 'rev-parse', 'HEAD'), branch: git(root, 'branch', '--show-current'),
  scope: 'local-source-and-original-environment-preservation;not-native-model-parity',
  status: checks.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL', checks, sources,
  sourceSetSha256: hash(Buffer.from(JSON.stringify(sources))),
  inheritedCleanup: { status: 'BLOCKED', reason: 'Two earlier removals denied: blocked by policy', retried: false,
    retained: ['.pf0-work/core-1f723e37-f152-4a60-9b1e-46adc6c3179c', '.pf2-work/model-tests-2733f823d57d477ba5e338a7d9a08cc9'] },
  noPushPullRequestMergeOrDeployment: true,
};
const output = path.join(evidence, 'pf2', `isolation-${Date.now()}.json`);
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, status: report.status, checks: checks.map(({ name, status }) => ({ name, status })), sourceSetSha256: report.sourceSetSha256 }));
process.exitCode = report.status === 'PASS' ? 0 : 1;
