// Read-only source/environment audit. Only the explicitly named PF-1 receipt is written.
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
  windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  encoding: binary ? null : 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
});
const git = (repo, ...args) => run('git', ['-C', repo, ...args]).trim();
const lines = value => value.trim() ? value.trim().split(/\r?\n/).map(x => x.trim()) : [];
const check = (condition, message) => { if (!condition) throw new Error(message); };
const checks = [];
const audit = (name, action) => {
  try { checks.push({ name, status: 'PASS', details: action() }); }
  catch (error) { checks.push({ name, status: 'FAIL', message: error.message }); }
};
const baseline = json(path.join(evidence, '00-start-state.json'));
const provenance = json(path.join(engine, 'source-provenance.json'));
const manifest = json(path.join(root, 'docs/pathfinder/fixtures/pf-core-v1.manifest.json'));

audit('extracted-core-and-original-regression-source-bytes', () => {
  check(provenance.coreFiles.length === 11, 'Expected eleven core sources');
  for (const item of provenance.coreFiles) {
    const actual = fs.readFileSync(path.join(engine, item.path));
    const original = fs.readFileSync(path.join(baseline.referencePathFinder.path, item.sourcePath));
    check(actual.equals(original), `Extracted bytes differ: ${item.path}`);
    check(hash(actual) === item.sha256, `Provenance differs: ${item.path}`);
    check(manifest.coreSources.some(p => p.path === item.sourcePath && p.sha256 === item.sha256), 'Frozen source hash missing');
  }
  const testFiles = manifest.harnessSources.filter(p => p.path.endsWith('.cs'));
  for (const item of testFiles) {
    const actual = fs.readFileSync(path.join(engine, 'tests/PathFinder.Regression', path.basename(item.path)));
    check(hash(actual) === item.sha256, `Original harness source differs: ${item.path}`);
  }
  return { core: provenance.coreFiles.length, originalRegressionSources: testFiles.length };
});

audit('staged-core-and-original-regression-byte-integrity', () => {
  const sources = [
    ...provenance.coreFiles.map(p => ({ file: 'pathfinder-engine/' + p.path, sha256: p.sha256 })),
    ...manifest.harnessSources.filter(p => p.path.endsWith('.cs')).map(p => ({
      file: 'pathfinder-engine/tests/PathFinder.Regression/' + path.basename(p.path), sha256: p.sha256 })),
  ];
  for (const item of sources) {
    const blob = run('git', ['-C', root, 'show', ':' + item.file], true);
    check(hash(blob) === item.sha256, `Git index changed source bytes: ${item.file}`);
  }
  return { stagedSourceCount: sources.length };
});

audit('frozen-pf0-files-preserved', () => {
  const pinned = '23741d1f485248ddb519f9e04e0b7856cc0e3def';
  const files = git(root, 'ls-tree', '-r', '--name-only', pinned, '--', 'docs/pathfinder').split(/\r?\n/)
    .filter(file => file !== 'docs/pathfinder/00-validation-matrix.md');
  for (const file of files) {
    const original = run('git', ['-C', root, 'show', `${pinned}:${file}`], true);
    check(fs.readFileSync(path.join(root, file)).equals(original), `Frozen PF-0 delivery changed: ${file}`);
  }
  // The matrix is append-only. Compare its original content after newline normalization.
  const matrix = 'docs/pathfinder/00-validation-matrix.md';
  const before = run('git', ['-C', root, 'show', `${pinned}:${matrix}`]).replaceAll('\r\n', '\n').trimEnd();
  const after = fs.readFileSync(path.join(root, matrix), 'utf8').replaceAll('\r\n', '\n');
  check(after.startsWith(before), 'Original matrix content was rewritten');
  return { unchangedFiles: files.length, originalMatrixContentPreserved: true };
});

audit('original-checkouts-and-local-changes-preserved', () => {
  const results = [];
  for (const name of ['originalWfc', 'referencePathFinder', 'oldPathFinder']) {
    const before = baseline[name];
    const actual = { head: git(before.path, 'rev-parse', 'HEAD'), branch: git(before.path, 'branch', '--show-current'),
      status: lines(git(before.path, 'status', '--porcelain=v1', '--untracked-files=all')) };
    check(actual.head === before.head && actual.branch === before.branch, `${name} head/branch changed`);
    check(JSON.stringify(actual.status) === JSON.stringify(before.status.map(x => x.trim())), `${name} working files changed`);
    results.push({ name, ...actual });
  }
  for (const item of baseline.oldPathFinderDirtyFiles) {
    const bytes = fs.readFileSync(path.join(baseline.oldPathFinder.path, item.path));
    check(hash(bytes) === item.sha256 && bytes.length === item.bytes, `Preserved local modification differs: ${item.path}`);
  }
  return results;
});

audit('original-container-identities-images-and-start-times-preserved', () => {
  const ids = lines(run('docker', ['ps', '-aq']));
  const rows = ids.length ? lines(run('docker', ['inspect', '--format',
    '{{.Id}}|{{.Name}}|{{.Image}}|{{.State.Status}}|{{.State.StartedAt}}', ...ids])).sort() : [];
  check(JSON.stringify(rows) === JSON.stringify([...baseline.docker.containerRows].sort()), 'Container inventory or start state changed');
  return { count: rows.length, environmentOrCredentialsRead: false, databaseContentAudit: false, stageContainersCreated: 0 };
});

const report = {
  schemaVersion: 1, stage: 'PF-1', observedAtUtc: new Date().toISOString(),
  baseCommit: git(root, 'rev-parse', 'HEAD'), branch: git(root, 'branch', '--show-current'),
  sourceProvenanceSha256: hash(fs.readFileSync(path.join(engine, 'source-provenance.json'))),
  status: checks.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL', checks,
  inheritedCleanup: { status: 'BLOCKED', reason: 'PF-0 removal denied: blocked by policy', retried: false,
    path: '.pf0-work/core-1f723e37-f152-4a60-9b1e-46adc6c3179c' },
  globalSdkStateAuditClaimed: false,
};
fs.mkdirSync(path.join(evidence, 'pf1'), { recursive: true });
fs.writeFileSync(path.join(evidence, 'pf1/source-preservation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : 1;
