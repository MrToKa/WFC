// Read-only Git index audit plus a receipt in this isolated documentation tree.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const evidenceRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(evidenceRoot, '../../..');
const run = args => execFileSync('git', ['-C', root, ...args], { windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const receiptRelative = 'docs/pathfinder/evidence/04-git-index-integrity.json';
const receipt = {
  schemaVersion: 1, observedAtUtc: new Date().toISOString(), status: 'PASS',
  scope: 'Git-staged delivery closure and pinned raw bytes; no runtime/native parity claim',
  initialWhitespaceCheck: 'FAIL for captured CRLF/EOF bytes under plain whitespace rules; no fixture bytes rewritten; scoped CR/EOF attributes then applied',
  finalWhitespaceCheck: 'NOT_RUN', files: [],
};
try {
  const staged = run(['ls-files', '-z', '--', 'docs/pathfinder']).toString('utf8').split('\0').filter(Boolean);
  const changed = run(['diff', '--cached', '--name-only', '-z']).toString('utf8').split('\0').filter(Boolean);
  if (changed.some(file => !file.startsWith('docs/pathfinder/'))) throw new Error('Non-documentation staged changes');
  const logs = ['pf-core-release.log', 'pf-core-geometry-capture.log', 'pf-core-golden-extraction.log', 'pf-core-golden-repeat.log', 'pf-core-schema-validation.log'];
  for (const log of logs) if (!staged.includes('docs/pathfinder/evidence/' + log)) throw new Error('Required log not staged: ' + log);
  for (const file of staged) {
    if (file === receiptRelative) continue; // Avoid a self-hash cycle.
    const rawPinned = file.startsWith('docs/pathfinder/fixtures/') || file.startsWith('docs/pathfinder/evidence/') || file === 'docs/pathfinder/00-parity-fixtures.md';
    if (!rawPinned) continue;
    const disk = fs.readFileSync(path.join(root, file));
    const index = run(['show', ':' + file]);
    if (!disk.equals(index)) throw new Error('Pinned index bytes differ: ' + file);
    receipt.files.push({ path: file, bytes: disk.length, sha256: hash(disk), indexBytesMatch: true });
  }
  run(['diff', '--cached', '--check']);
  receipt.finalWhitespaceCheck = 'PASS';
  receipt.requiredLogsStaged = logs.length;
  receipt.stagedFileCountAtObservation = staged.length;
  receipt.pinnedRawFileCount = receipt.files.length;
  receipt.temporaryCopyStaged = staged.some(file => file.startsWith('.pf0-work/'));
} catch (error) {
  receipt.status = 'FAIL';
  receipt.error = String(error.message || error);
}
fs.writeFileSync(path.join(root, receiptRelative), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ status: receipt.status, finalWhitespaceCheck: receipt.finalWhitespaceCheck, requiredLogsStaged: receipt.requiredLogsStaged, pinnedRawFileCount: receipt.pinnedRawFileCount, stagedFileCountAtObservation: receipt.stagedFileCountAtObservation, error: receipt.error }, null, 2));
process.exitCode = receipt.status === 'PASS' ? 0 : 1;
