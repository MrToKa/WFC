// Compiled Node test; intentionally outside the frontend Vitest filename glob.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LIMITS, PackageError, packModel, verifyPackage } from '../vendor/routings-model-package/index.mjs';

// Fixed synthetic test bytes. This is not a production geometry sample or ZIP writer.
const SYNTHETIC_SVF = 'UEsDBBQAAAAAAE1iUF3ceDb+9gEAAPYBAAANAAAAbWFuaWZlc3QuanNvbnsiYWRza0lEIjp7InZlcnNpb24iOiIiLCJpZCI6IiIsInR5cGUiOiIiLCJzb3VyY2VTeXN0ZW0iOiIifSwibmFtZSI6IkxNViBNYW5pZmVzdCIsImFzc2V0cyI6W3sidHlwZXNldCI6IjIiLCJVUkkiOiIwLnBmIiwiaWQiOiIwLnBmIiwidHlwZSI6IkF1dG9kZXNrLkNsb3VkUGxhdGZvcm0uUGFja0ZpbGUiLCJzaXplIjo0MSwidXNpemUiOjIxfSx7IlVSSSI6ImVtYmVkOi9tZXRhZGF0YS5qc29uIiwiaWQiOiJtZXRhZGF0YS5qc29uIiwidHlwZSI6IkF1dG9kZXNrLkNsb3VkUGxhdGZvcm0uVmlld2luZ01ldGFkYXRhIiwic2l6ZSI6NjcsInVzaXplIjo2N31dLCJ0eXBlc2V0cyI6W3sidHlwZXMiOlt7ImNsYXNzIjoiQXV0b2Rlc2suQ2xvdWRQbGF0Zm9ybS5HZW9tZXRyeSIsInZlcnNpb24iOjEsInR5cGUiOiJBdXRvZGVzay5DbG91ZFBsYXRmb3JtLk9wZW5DVE0ifV0sImlkIjoiMiJ9XSwidG9vbGtpdHZlcnNpb24iOiJMTVZUSyA1LjAuMjYuMCIsIm1hbmlmZXN0dmVyc2lvbiI6Mn1QSwMEFAAAAAAATWJQXZmneoRDAAAAQwAAAA0AAABtZXRhZGF0YS5qc29ueyJ2ZXJzaW9uIjoiMS4wIiwibWV0YWRhdGEiOnsiZGVmYXVsdCBkaXNwbGF5IHVuaXQiOnsidmFsdWUiOiJtIn19fVBLAQIUABQAAAAAAE1iUF3ceDb+9gEAAPYBAAANAAAAAAAAAAAAAAAAAAAAAABtYW5pZmVzdC5qc29uUEsBAhQAFAAAAAAATWJQXZmneoRDAAAAQwAAAA0AAAAAAAAAAAAAAAAAIQIAAG1ldGFkYXRhLmpzb25QSwUGAAAAAAIAAgB2AAAAjwIAAAAA';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function fixture(t: { after(fn: () => Promise<void>): void }, options: { sourceText?: string; propertyText?: string } = {}) {
  const base = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(base, 'wfc-model-registry-package-'));
  t.after(async () => {
    const relative = path.relative(base, root);
    assert.ok(relative.startsWith('wfc-model-registry-package-') && !relative.includes(path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const modelDir = path.join(root, 'model'), sourceDir = path.join(root, 'source'), outputDir = path.join(root, 'packages');
  await fs.mkdir(path.join(modelDir, 'output', '0'), { recursive: true });
  await fs.mkdir(sourceDir); await fs.mkdir(outputDir);
  const source = path.join(sourceDir, 'synthetic.nwd');
  const sourceBytes = Buffer.from(options.sourceText || 'Explicit synthetic source fixture; no Autodesk upload.');
  await fs.writeFile(source, sourceBytes);
  const data = new Map<string, Buffer>([
    ['output/0/0.svf', Buffer.from(SYNTHETIC_SVF, 'base64')],
    ['output/0/0.pf', Buffer.from('H4sIAAAAAAAACgtITM52y8xJVUjLrCgpLUpVSEksSQQA8RQI6hUAAAA=', 'base64')],
    ['output/0/properties.db', Buffer.from('SQLite format 3\0' + (options.propertyText || 'synthetic-fixture-data'), 'ascii')],
  ]);
  for (const [name, bytes] of data) await fs.writeFile(path.join(modelDir, ...name.split('/')), bytes);
  await fs.writeFile(path.join(modelDir, 'model.json'), JSON.stringify({ name: path.basename(source), format: 'svf', entrypoint: '/model/output/0/0.svf', viewerVersion: '7.130.0', preparedAt: '2026-10-16T00:00:00.000Z', sourceBytes: sourceBytes.length, resourceCount: data.size, totalBytes: [...data.values()].reduce((sum, bytes) => sum + bytes.length, 0) }));
  await fs.writeFile(path.join(modelDir, 'integrity.json'), JSON.stringify(Object.fromEntries([...data].map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha256(bytes), transport: 'raw-http-v1' }]))));
  return { root, modelDir, source, data, output: (name: string) => path.join(outputDir, name + '.zip') };
}

test('compiled runtime contains the exact pinned public module, independent of CWD', async () => {
  assert.equal(Number(process.versions.node.split('.')[0]), 24);
  const root = fileURLToPath(new URL('../vendor/routings-model-package/', import.meta.url));
  const names = ['index.mjs', 'lib/errors.mjs', 'lib/io.mjs', 'lib/json.mjs', 'lib/limits.mjs', 'lib/manifest.mjs', 'lib/pack.mjs', 'lib/paths.mjs', 'lib/profile.mjs', 'lib/verify.mjs', 'lib/zip.mjs', 'package.json'];
  let canonical = '', totalBytes = 0;
  for (const name of names) {
    const bytes = await fs.readFile(path.join(root, ...name.split('/')));
    totalBytes += bytes.length; canonical += `${name}\t${bytes.length}\t${sha256(bytes)}\n`;
  }
  assert.equal(totalBytes, 119784);
  assert.equal(sha256(Buffer.from(canonical)), '450f217aaf23411b9232f076ccd5eb28e46aaccc2662927723640bf2134855bf');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).engines.node, '>=24 <25');
});

test('public verifier relocates an independently extracted synthetic model without its source file', async t => {
  const f = await fixture(t), output = f.output('first');
  const packed = await packModel({ modelDir: f.modelDir, source: f.source, output, label: 'Synthetic registry fixture' });
  await fs.unlink(f.source);
  const extractTo = path.join(f.root, 'verified-extraction');
  const report = await verifyPackage(output, { extractTo, expectedFingerprint: packed.contentFingerprint });
  assert.equal(report.status, 'PASS'); assert.equal(report.resourceCount, 3);
  assert.equal(report.manifest.source.identityBasis, 'observed-local-file');
  assert.equal(report.extraction?.hashesCompared, 3);
  for (const [name, bytes] of f.data) assert.deepEqual(await fs.readFile(path.join(extractTo, 'resources', ...name.split('/'))), bytes);
  assert.equal(report.package.sha256, sha256(await fs.readFile(output)));
  await assert.rejects(verifyPackage(output, { extractTo }), { code: 'OUTPUT_EXISTS' });
});

test('package transport and cosmetic identity do not redefine the verified content fingerprint', async t => {
  const f = await fixture(t);
  const first = await packModel({ modelDir: f.modelDir, source: f.source, output: f.output('first'), label: 'Synthetic one', packageId: randomUUID(), preparedAt: '2026-10-16T00:00:00.000Z' });
  const second = await packModel({ modelDir: f.modelDir, source: f.source, output: f.output('second'), label: 'Synthetic two', packageId: randomUUID(), preparedAt: '2026-10-16T00:00:01.000Z' });
  assert.notEqual(first.package.sha256, second.package.sha256);
  assert.notEqual(first.manifest.packageId, second.manifest.packageId);
  assert.equal(first.contentFingerprint, second.contentFingerprint);
  assert.deepEqual(first.manifest.source, second.manifest.source);
});

test('the public boundary retains fixed limits and cancellation rather than accepting caller widening', async t => {
  const f = await fixture(t), output = f.output('limits');
  await packModel({ modelDir: f.modelDir, source: f.source, output, label: 'Synthetic limits fixture' });
  assert.equal(DEFAULT_LIMITS.maxArchiveBytes, 2147483648); assert.equal(DEFAULT_LIMITS.maxMs, 600000);
  await assert.rejects(verifyPackage(output, { limits: { maxArchiveBytes: DEFAULT_LIMITS.maxArchiveBytes + 1 } }), { code: 'INVALID_MANIFEST' });
  const controller = new AbortController(); controller.abort();
  const extractTo = path.join(f.root, 'cancelled-extraction');
  await assert.rejects(verifyPackage(output, { extractTo, signal: controller.signal }), { code: 'PACKAGE_ABORTED' });
  await assert.rejects(fs.stat(extractTo), { code: 'ENOENT' });
  const corrupt = path.join(f.root, 'corrupt.zip'); await fs.writeFile(corrupt, Buffer.from('Explicit invalid ZIP fixture.'));
  await assert.rejects(verifyPackage(corrupt), error => error instanceof PackageError && typeof error.code === 'string');
});
