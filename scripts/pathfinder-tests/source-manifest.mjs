// Read-only revision binding for combined local checks; no secrets or ignored inputs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const run = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const candidates = run('ls-files', '--cached', '--others', '--exclude-standard', '--', 'pathfinder-engine', 'server', 'src', 'viewer-runtime', 'scripts/pathfinder-local', 'scripts/pathfinder-tests', 'scripts/viewer-runtime/prepare.mjs', 'docker/pathfinder*').split(/\r?\n/).filter(Boolean);
const files = [...new Set(candidates)].sort().filter(file => fs.existsSync(path.join(root, file))).map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(root, file))) }));
const result = { schemaVersion: 'pathfinder.integration.source-manifest.v1', observedAtUtc: new Date().toISOString(), checkedBaseCommit: run('rev-parse', 'HEAD'), branch: run('branch', '--show-current'),
  sourceSetSha256: sha256(JSON.stringify(files)), files, scope: 'nonignored-local-source-bytes;not-functional-or-native-acceptance', secretsRead: false };
const output = path.join(root, 'docs/pathfinder/evidence/pf7', `sources-${Date.now()}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, files: files.length, sourceSetSha256: result.sourceSetSha256 }));
