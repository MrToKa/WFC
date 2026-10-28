import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { deliveryPath, excludedDeliveryPath, parseDeliveryTree, assertDeliveryStatus, materializeDelivery, collectDeliveryOutputs } from './delivery-context.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const oid = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const code = value => error => error.code === value;
const json = filename => fs.readFile(filename, 'utf8').then(JSON.parse);
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'preparer-delivery-source-test-')); await fs.mkdir(path.join(root, '.preparer-work'));
  t.after(async () => { assert.equal(path.dirname(root), parent); await fs.rm(root, { recursive: true, force: true }); });
  const files = new Map(Object.entries({
    'package.json': '{"dependencies":{}}\n', 'package-lock.json': '{"lockfileVersion":3}\n',
    '.dockerignore': '.preparer-work\n.env\n', '.env': 'PRIVATE_ENV_MUST_NOT_COPY', '.env.example': 'EXAMPLE_NOT_IMAGE_INPUT',
    '.preparer-work/private-companion.json': 'PRIVATE_COMPANION_MUST_NOT_COPY', 'node_modules/private.js': 'PRIVATE_DEPENDENCY', 'backups/business.json': 'PRIVATE_BUSINESS_ROWS',
    'src/main.tsx': 'export const source = "frozen";\n', 'docker/nginx.conf': 'server { listen 80; }\n', 'Template files/template.txt': 'public product template\n',
    'scripts/preparer-main/delivery.runtime.Dockerfile': 'ARG API_BASE\nARG WEB_BASE\nFROM ${API_BASE}\n',
    'model-preparer/index.mjs': 'export const api = true;\n', 'model-preparer/package.json': '{"type":"module"}\n', 'model-preparer/lib/core.mjs': 'export const core = true;\n',
    'model-preparer/app/server.mjs': 'export const server = true;\n', 'model-preparer/app/workspace-service.mjs': 'export const workspace = true;\n', 'model-preparer/app/workspace-security.mjs': 'export const admin = true;\n', 'model-preparer/app/page-credentials.mjs': 'export const memoryOnly = true;\n',
    'model-preparer/web/workspace.html': '<!doctype html><title>Model preparer</title>', 'model-preparer/deployment/Dockerfile': 'FROM node-base\n', 'model-preparer/deployment/.dockerignore': '**\n!Dockerfile\n',
    'server/vendor/routings-model-package/index.mjs': 'export const packageApi = true;\n', 'server/vendor/routings-model-package/package.json': '{"type":"module"}\n', 'server/vendor/routings-model-package/lib/pack.mjs': 'export const packModel = true;\n',
  }).map(([name, value]) => [name, Buffer.from(value)]));
  const objects = new Map([...files.values()].map(bytes => [oid(bytes), bytes])), state = { revision: 'a'.repeat(40), tree: 'b'.repeat(40), baseline: 'c'.repeat(40), dirty: Buffer.alloc(0), driftDependency: false, corruptBlob: false, extraTree: '' }, calls = [];
  const git = async args => {
    calls.push(args);
    if (args[0] === 'rev-parse') return Buffer.from((args[2] === 'HEAD^{commit}' ? state.revision : args[2] === 'HEAD^{tree}' ? state.tree : state.baseline) + '\n');
    if (args[0] === 'status') return state.dirty;
    if (args[0] === 'show') { const split = args[1].indexOf(':'), revision = args[1].slice(0, split), name = args[1].slice(split + 1); return state.driftDependency && revision === state.baseline ? Buffer.from('changed original dependency') : files.get(name); }
    if (args[0] === 'ls-tree') return Buffer.from([...files].map(([name, bytes]) => '100644 blob ' + oid(bytes) + '\t' + name + '\0').join('') + state.extraTree);
    if (args[0] === 'cat-file') return state.corruptBlob ? Buffer.from('corrupted object') : objects.get(args[2]);
    throw Error('unexpected Git leaf: ' + args[0]);
  };
  for (const name of ['package.json', 'package-lock.json']) await fs.writeFile(path.join(root, name), files.get(name));
  const operationDirectory = path.join(root, '.preparer-work', 'sp-delivery-' + randomUUID()), args = { operationDirectory }, options = { root, git };
  const outputs = async () => {
    for (const [name, value] of Object.entries({ 'dist/index.html': '<title>WFC</title>', 'dist/assets/main.js': 'compiled-client', 'server/dist/server/index.js': 'compiled-server', 'server/dist/server/vendor/routings-model-package/index.mjs': 'compiled-verifier' })) { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); }
  };
  return { root, files, state, calls, args, options, operationDirectory, outputs };
}

test('delivery paths reject traversal, absolute aliases, controls and Windows special names', () => {
  for (const name of ['../private', '/absolute', 'C:/secret', 'a\\secret', 'a/./b', 'a//b', 'a\nsecret', 'a/file.', 'NUL.txt', 'a:stream']) assert.throws(() => deliveryPath(name), code('DELIVERY_UNSAFE_PATH'));
  assert.equal(deliveryPath('Template files/A template.xlsx'), 'Template files/A template.xlsx');
});
test('private/runtime roots and all env files are excluded without reading values', () => {
  for (const name of ['.env', 'a/.env.test', '.git/config', '.data/models', '.preparer-work/seed.private.json', 'backups/database.dump', 'a/node_modules/key.js', 'dist/index.html', 'server/dist/index.js', 'public/viewer-runtime/runtime.js']) assert.equal(excludedDeliveryPath(name), true);
  assert.equal(excludedDeliveryPath('src/main.tsx'), false);
});
test('tree parser accepts only normal Git blobs and refuses symlink/submodule and case collisions', () => {
  const object = 'a'.repeat(40); assert.equal(parseDeliveryTree(Buffer.from('100644 blob ' + object + '\tsrc/main.ts\0')).length, 1);
  for (const row of ['120000 blob ' + object + '\tlinked\0', '160000 commit ' + object + '\tsubmodule\0', '100644 blob ' + object + '\t../escape\0', '100644 blob ' + object + '\tSrc/a.ts\0' + '100644 blob ' + object + '\tsrc/b.ts\0']) assert.throws(() => parseDeliveryTree(Buffer.from(row)));
});
test('clean gate rejects tracked/untracked product changes and renames but ignores private work', () => {
  assertDeliveryStatus(Buffer.from('?? .preparer-work/private.json\0?? .env\0'));
  for (const status of [' M src/main.ts\0', '?? server/routes/new.ts\0', 'R  .preparer-work/moved\0src/main.ts\0']) assert.throws(() => assertDeliveryStatus(Buffer.from(status)), code('DELIVERY_WORKTREE_DIRTY'));
});
test('snapshot contains frozen tracked source and separate allowlisted contexts, no private values', async t => {
  const f = await fixture(t), result = await materializeDelivery(f.args, f.options), manifest = await json(path.join(f.operationDirectory, 'snapshot.private.json'));
  assert.equal(result.revision, f.state.revision); assert.match(result.fingerprint, /^[a-f0-9]{64}$/); assert.equal(manifest.fingerprint, result.fingerprint);
  assert.equal(await fs.readFile(path.join(f.operationDirectory, 'preparer/app/page-credentials.mjs'), 'utf8'), f.files.get('model-preparer/app/page-credentials.mjs').toString());
  assert.deepEqual(await fs.readdir(path.join(f.operationDirectory, 'preview')), []);
  assert.equal((await json(path.join(f.operationDirectory, 'operation.private.json'))).mode, 'injected-test-only');
  assert.ok(manifest.files.every(row => !excludedDeliveryPath(row.path))); assert.doesNotMatch(JSON.stringify(manifest), /PRIVATE_ENV|PRIVATE_COMPANION|PRIVATE_BUSINESS/);
  await assert.rejects(fs.lstat(path.join(f.operationDirectory, 'source/.env')), { code: 'ENOENT' });
});
test('dependency drift refuses the thin baseline before creating an operation', async t => {
  const f = await fixture(t); f.state.driftDependency = true; await assert.rejects(materializeDelivery(f.args, f.options), code('DELIVERY_THIN_BASE_DEPENDENCIES_CHANGED')); await assert.rejects(fs.lstat(f.operationDirectory), { code: 'ENOENT' });
});
test('dirty untracked product input refuses before creating any context', async t => {
  const f = await fixture(t); f.state.dirty = Buffer.from('?? model-preparer/app/uncommitted.mjs\0'); await assert.rejects(materializeDelivery(f.args, f.options), code('DELIVERY_WORKTREE_DIRTY')); await assert.rejects(fs.lstat(f.operationDirectory), { code: 'ENOENT' });
});
test('object bytes must hash to the exact Git blob identity', async t => {
  const f = await fixture(t); f.state.corruptBlob = true; await assert.rejects(materializeDelivery(f.args, f.options), code('DELIVERY_GIT_BLOB_CHANGED')); assert.equal((await json(path.join(f.operationDirectory, 'snapshot-failure.private.json'))).status, 'FAIL');
});
test('existing operation directory is never reused or emptied', async t => {
  const f = await fixture(t); await fs.mkdir(f.operationDirectory); await fs.writeFile(path.join(f.operationDirectory, 'retained'), 'keep'); await assert.rejects(materializeDelivery(f.args, f.options), { code: 'EEXIST' }); assert.equal(await fs.readFile(path.join(f.operationDirectory, 'retained'), 'utf8'), 'keep');
});
test('compiled context contains only generated dist, server-dist, frozen templates and nginx', async t => {
  const f = await fixture(t); const source = await materializeDelivery(f.args, f.options); await f.outputs(); await fs.writeFile(path.join(f.root, '.env'), 'PRIVATE_HOST_RUNTIME_SECRET');
  const result = await collectDeliveryOutputs(f.args, f.options), manifest = await json(path.join(f.operationDirectory, 'compiled.private.json'));
  assert.equal(result.revision, source.revision); assert.equal(manifest.sourceFingerprint, source.fingerprint); assert.ok(manifest.files.every(row => /^(?:dist\/|server-dist\/|templates\/|nginx\.conf$|Dockerfile$)/.test(row.path)));
  assert.deepEqual((await fs.readdir(path.join(f.operationDirectory, 'compiled'))).sort(), ['Dockerfile', 'dist', 'nginx.conf', 'server-dist', 'templates']);
  assert.equal(await fs.readFile(path.join(f.operationDirectory, 'compiled/templates/template.txt'), 'utf8'), f.files.get('Template files/template.txt').toString());
});
test('a changed HEAD refuses collection before output files are copied', async t => {
  const f = await fixture(t); await materializeDelivery(f.args, f.options); await f.outputs(); f.state.revision = 'd'.repeat(40); await assert.rejects(collectDeliveryOutputs(f.args, f.options), code('DELIVERY_HEAD_CHANGED')); await assert.rejects(fs.lstat(path.join(f.operationDirectory, 'compiled')), { code: 'ENOENT' });
});
test('working lockfile changes are rejected even if an injected status lies', async t => {
  const f = await fixture(t); await materializeDelivery(f.args, f.options); await f.outputs(); await fs.appendFile(path.join(f.root, 'package-lock.json'), ' '); await assert.rejects(collectDeliveryOutputs(f.args, f.options), code('DELIVERY_WORKING_LOCK_CHANGED'));
});
test('frozen source tampering refuses collection using both sha256 and Git object pins', async t => {
  const f = await fixture(t); await materializeDelivery(f.args, f.options); await f.outputs(); await fs.writeFile(path.join(f.operationDirectory, 'source/src/main.tsx'), 'tampered'); await assert.rejects(collectDeliveryOutputs(f.args, f.options), code('DELIVERY_SOURCE_PINS_CHANGED'));
});
test('an unexpected private file in a named context cannot enter Docker COPY', async t => {
  const f = await fixture(t); await materializeDelivery(f.args, f.options); await f.outputs(); await fs.writeFile(path.join(f.operationDirectory, 'preparer/.env'), 'PRIVATE_EXTRA_CONTEXT_FILE'); await assert.rejects(collectDeliveryOutputs(f.args, f.options), code('DELIVERY_CONTEXT_EXTRA_FILE'));
});
test('a populated preview context is rejected instead of claiming an empty SDK', async t => {
  const f = await fixture(t); await materializeDelivery(f.args, f.options); await f.outputs(); await fs.writeFile(path.join(f.operationDirectory, 'preview/sdk.js'), 'unexpected'); await assert.rejects(collectDeliveryOutputs(f.args, f.options), code('DELIVERY_PREVIEW_NOT_EMPTY'));
});
test('compiled collection is a new immutable attempt and cannot overwrite previous output', async t => {
  const f = await fixture(t); await materializeDelivery(f.args, f.options); await f.outputs(); await collectDeliveryOutputs(f.args, f.options); await assert.rejects(collectDeliveryOutputs(f.args, f.options), { code: 'EEXIST' });
});
test('missing compiler products never produce a completion marker', async t => {
  const f = await fixture(t); await materializeDelivery(f.args, f.options); await f.outputs(); await fs.unlink(path.join(f.root, 'server/dist/server/index.js')); await assert.rejects(collectDeliveryOutputs(f.args, f.options), code('DELIVERY_COMPILED_INCOMPLETE')); await assert.rejects(fs.lstat(path.join(f.operationDirectory, 'compiled-complete.private.json')), { code: 'ENOENT' });
});
test('runtime recipe removes only its two explicit image directories and installs nothing', async () => {
  const source = await fs.readFile(path.join(HERE, 'delivery.runtime.Dockerfile'), 'utf8'), removals = source.split(/\r?\n/).filter(line => line.startsWith('RUN'));
  assert.deepEqual(removals, ['RUN rm -rf /app/server/dist', 'RUN rm -rf /usr/share/nginx/html']); assert.match(source, /FROM \$\{API_BASE\} AS api-runtime/); assert.match(source, /FROM \$\{WEB_BASE\} AS web-runtime/); assert.doesNotMatch(source, /npm ci|npm install|nginx:alpine|latest/);
});
