// PF-0 document/example/preservation audit; no production or test-runtime writes.
// Run from any directory: node <this-file>. Source-control and Docker calls are read-only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const evidenceRoot = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(evidenceRoot, '..');
const worktree = path.resolve(docsRoot, '../..');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const checks = [];
const add = (name, action) => {
  try { checks.push({ name, status: 'PASS', details: action() }); }
  catch (error) { checks.push({ name, status: 'FAIL', error: String(error.message || error) }); }
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const walk = root => fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(root, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const command = (exe, args) => execFileSync(exe, args, {
  encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, windowsHide: true,
}).trim();
const git = (repo, ...args) => command('git', ['-C', repo, ...args]);
const normalizeLines = text => text.trim() ? text.trim().split(/\r?\n/) : [];
const start = readJson(path.join(evidenceRoot, '00-start-state.json'));
const coreSummary = readJson(path.join(evidenceRoot, 'pf-core-summary.json'));
const files = walk(docsRoot);

add('all-document-json-parses', () => {
  const jsonFiles = files.filter(file => file.endsWith('.json'));
  jsonFiles.forEach(readJson);
  return { count: jsonFiles.length };
});
add('five-required-stage-documents', () => {
  const names = ['00-baseline.md', '00-specification.md', '00-validation-matrix.md', '00-parity-fixtures.md', '00-stage-report.md'];
  for (const name of names) assert(fs.statSync(path.join(docsRoot, name)).size > 0, `Empty ${name}`);
  return names;
});
add('markdown-local-link-targets', () => {
  let count = 0;
  for (const file of files.filter(file => file.endsWith('.md'))) {
    const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const match of text.matchAll(/\[[^\]\r\n]*\]\(([^)\r\n]+)\)/g)) {
      let target = match[1].trim().replace(/^<|>$/g, '');
      if (/^(https?:|mailto:|#)/i.test(target)) continue;
      target = decodeURIComponent(target.split('#')[0]);
      if (!target) continue;
      target = target.replace(/:\d+$/, '');
      const resolved = path.isAbsolute(target) ? target : path.resolve(path.dirname(file), target);
      assert(fs.existsSync(resolved), `${path.relative(docsRoot, file)} -> ${target}`);
      count++;
    }
  }
  return { checkedTargetCount: count, fragmentExistenceClaimed: false, externalNetworkCheckClaimed: false };
});
add('pinned-source-links-target-current-reference-files', () => {
  const roots = {
    WFC: { sha: start.originalWfc.head, root: start.originalWfc.path },
    PathFinder: { sha: start.referencePathFinder.head, root: start.referencePathFinder.path },
  };
  let count = 0;
  for (const file of files.filter(file => file.endsWith('.md'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/https:\/\/github\.com\/MrToKa\/(WFC|PathFinder)\/blob\/([a-f0-9]{40})\/([^\s)#]+)(?:#L(\d+))?/g)) {
      const reference = roots[match[1]];
      assert(match[2] === reference.sha, `Unexpected pinned SHA ${match[2]}`);
      const source = path.join(reference.root, decodeURIComponent(match[3]));
      assert(fs.existsSync(source), `Missing source ${source}`);
      if (match[4]) assert(Number(match[4]) <= fs.readFileSync(source, 'utf8').split(/\r?\n/).length, `Line outside ${source}`);
      count++;
    }
  }
  return { checkedLinkCount: count, verifiesLineBoundsOnly: true };
});
add('illustrative-contract-invariants-not-engine-parity', () => {
  const example = readJson(path.join(docsRoot, 'contracts/examples.json'));
  assert(example.contractStatus === 'PROPOSED_NOT_IMPLEMENTED', 'Example claims implemented contract');
  assert(example.exampleStatus === 'ILLUSTRATIVE_NOT_CAPTURED_NOT_EXECUTED', 'Example claims captured output');
  const points = example.proposal.pathPointsMetres;
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(...points[i].map((value, axis) => value - points[i - 1][axis]));
  assert(length === 31 && example.proposal.lengths.geometricMetres === length, 'Illustrative path length mismatch');
  const settings = example.projectSettings;
  const values = example.proposal.lengths;
  const illustrative = Math.ceil((Math.max(0, length - values.replacedApproachesMetres) + values.secondaryCount * settings.secondaryTrayLength + settings.endConnectionLength) * (1 + settings.additionalBendingPercent / 100));
  assert(illustrative === 41 && values.designMetres === illustrative, 'Illustrative allowance mismatch');
  assert(example.cableInput.cableWriteRevision === example.proposedApplyCommand.expected.cableWriteRevision && example.proposal.basedOnCableWriteRevision === example.cableInput.cableWriteRevision, 'Write revision mismatch');
  assert(example.model.displayOffsetIncludedInMatrix === false && example.model.canonicalAxes === 'right-handed-z-up', 'Coordinate convention mismatch');
  assert(JSON.stringify(example.proposedApplyCommand.writeFields) === JSON.stringify(['routing', 'designLength']), 'Unexpected write fields');
  return { geometricMetres: length, designMetres: illustrative, engineExecutionClaimed: false };
});
add('frozen-core-manifest-artifact-and-source-hashes', () => {
  const fixtureRoot = path.join(docsRoot, 'fixtures');
  const manifest = readJson(path.join(fixtureRoot, 'pf-core-v1.manifest.json'));
  assert(manifest.coreCommit === start.referencePathFinder.head, 'Core commit mismatch');
  assert(manifest.caseCount === 43 && manifest.coreSources.length === 11 && manifest.harnessSources.length === 9, 'Unexpected reference inventory counts');
  for (const item of manifest.artifacts) {
    const file = path.resolve(fixtureRoot, item.path);
    assert(file.startsWith(fixtureRoot + path.sep), `Artifact escapes fixture root ${item.path}`);
    assert(fs.statSync(file).size === item.bytes && sha256(file) === item.sha256, `Artifact hash mismatch ${item.path}`);
  }
  const sources = [...manifest.coreSources, ...manifest.harnessSources, ...manifest.supportingSourcePins];
  for (const item of sources) {
    const file = path.resolve(start.referencePathFinder.path, item.path);
    assert(file.startsWith(path.resolve(start.referencePathFinder.path) + path.sep), 'Source escapes reference root');
    assert(fs.statSync(file).size === item.bytes && sha256(file) === item.sha256, `Source hash mismatch ${item.path}`);
    if ('copyMatches' in item) assert(item.copyMatches && item.isolatedCopySha256 === item.sha256, `Source copy mismatch ${item.path}`);
  }
  const inventoryFile = path.join(evidenceRoot, 'pf-core-source-inventory.json');
  assert(sha256(inventoryFile) === coreSummary.sourceCopies.sourceInventory.sha256, 'Source inventory receipt mismatch');
  assert(manifest.evidence.pureRelease.checks === 105 && manifest.evidence.extraction.expectedCases === 43 && manifest.evidence.extraction.repeatByteIdentical && manifest.evidence.schema.negativeControls === 6, 'Executed evidence summary mismatch');
  return { artifacts: manifest.artifacts.length, sourcePins: sources.length, coreFiles: 11, harnessFiles: 9, referenceCases: 43, repeatedEngineExecution: false };
});
add('original-repository-head-branch-status-preserved', () => {
  const observations = [];
  for (const key of ['originalWfc', 'referencePathFinder', 'oldPathFinder']) {
    const before = start[key];
    const actual = { head: git(before.path, 'rev-parse', 'HEAD'), branch: git(before.path, 'branch', '--show-current'), status: normalizeLines(git(before.path, 'status', '--porcelain=v1', '--untracked-files=all')) };
    assert(actual.head === before.head && actual.branch === before.branch, `${key} HEAD/branch changed`);
    // Preserve porcelain's leading spaces by comparing trimmed individual lines.
    assert(JSON.stringify(actual.status.map(x => x.trim())) === JSON.stringify(before.status.map(x => x.trim())), `${key} file status changed`);
    observations.push({ key, path: before.path, ...actual });
  }
  return observations;
});
add('old-pathfinder-local-file-bytes-preserved', () => {
  for (const item of start.oldPathFinderDirtyFiles) {
    const file = path.join(start.oldPathFinder.path, item.path);
    assert(sha256(file) === item.sha256 && fs.statSync(file).size === item.bytes, `Changed preserved file ${item.path}`);
  }
  return { files: start.oldPathFinderDirtyFiles.length };
});
add('isolated-branch-scoped-deliveries-and-known-retained-temp', () => {
  assert(git(worktree, 'branch', '--show-current') === 'pf-0-contracts-baseline-20261017', 'Wrong local branch');
  const cleanup = coreSummary.cleanup;
  assert(cleanup.status === 'BLOCKED' && cleanup.commandExecuted === false && cleanup.deletionMutations === 0 && cleanup.noRetry === true, 'Unknown cleanup condition');
  const retainedRoot = fs.realpathSync(cleanup.resolvedTarget);
  const retainedRelative = path.relative(worktree, retainedRoot).replaceAll('\\', '/');
  assert(retainedRelative === '.pf0-work/core-1f723e37-f152-4a60-9b1e-46adc6c3179c', 'Unexpected retained temporary target');
  const status = normalizeLines(git(worktree, 'status', '--porcelain=v1', '--untracked-files=all'));
  const paths = status.map(line => line.slice(3).replace(/^"|"$/g, '').replaceAll('\\', '/'));
  const unexpected = paths.filter(file => !file.startsWith('docs/pathfinder/') && !file.startsWith(retainedRelative + '/'));
  assert(unexpected.length === 0, `Unexpected worktree changes ${unexpected.join(', ')}`);
  return { branch: 'pf-0-contracts-baseline-20261017', changedFilesBeforeCommit: status.length, retainedTemporaryRoot: retainedRelative, cleanupStatus: 'BLOCKED', tempFilesAreNotDeliveries: true };
});
add('existing-container-identities-images-start-state-preserved', () => {
  assert(start.docker.available, 'Initial Docker observation unavailable');
  const ids = normalizeLines(command('docker', ['ps', '-aq']));
  const rows = ids.length ? normalizeLines(command('docker', ['inspect', '--format', '{{.Id}}|{{.Name}}|{{.Image}}|{{.State.Status}}|{{.State.StartedAt}}', ...ids])).sort() : [];
  assert(JSON.stringify(rows) === JSON.stringify([...start.docker.containerRows].sort()), 'Existing container inventory/state changed');
  return { count: rows.length, environmentRead: false, databaseContentAuditClaimed: false, newStageContainers: 0 };
});
checks.push({
  name: 'owned-temporary-copy-cleanup', status: 'BLOCKED',
  details: { ...coreSummary.cleanup, rootRetriedDeletion: false, workaroundUsed: false },
});

const report = {
  schemaVersion: 1, observedAtUtc: new Date().toISOString(),
  purpose: 'PF-0 documentation/example and original-environment preservation checks; not web/native parity',
  status: checks.some(check => check.status === 'FAIL') ? 'FAIL' : checks.some(check => check.status === 'BLOCKED') ? 'BLOCKED' : 'PASS',
  technicalStatus: checks.filter(check => check.name !== 'owned-temporary-copy-cleanup').every(check => check.status === 'PASS') ? 'PASS' : 'FAIL',
  // Audit receipts exclude one another from hash inventories to avoid a cycle.
  checks, jsonArtifactHashes: files.filter(file => file.endsWith('.json') && !['02-final-validation.json', '04-git-index-integrity.json'].includes(path.basename(file))).map(file => ({ path: path.relative(docsRoot, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: sha256(file) })),
};
fs.writeFileSync(path.join(evidenceRoot, '02-final-validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checks: checks.map(({ name, status, error }) => ({ name, status, error })) }, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : report.status === 'BLOCKED' ? 2 : 1;
