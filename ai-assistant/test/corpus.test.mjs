import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareCorpus, initCorpus, readCorpus, manifestPages, PROJECT, sha } from '../lib/corpus.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1cAAAAASUVORK5CYII=', 'base64');
const havePoppler = ['pdfinfo', 'pdftotext', 'pdftoppm'].every(command => spawnSync(command, ['-v'], { windowsHide: true }).status === 0);

// A complete, locally synthetic one-page PDF; no customer source or network.
function syntheticPdf() {
  const content = 'BT /F1 16 Tf 30 100 Td (Synthetic   pump   P100) Tj 0 -25 Td (Second   label   P200) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let body = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
async function workspace(run, memory = false) {
  const root = await mkdtemp(join(tmpdir(), 'wfc-corpus-test-'));
  const source = join(root, 'host-source'), native = join(root, 'native-cache');
  await mkdir(source); await mkdir(native);
  const db = new DatabaseSync(memory ? ':memory:' : join(native, 'corpus.sqlite')); initCorpus(db);
  try { await run({ root, source, native, db }); }
  finally { db.close(); await rm(root, { recursive: true, force: true }); }
}
function rows(db, table) { return db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count; }

test('normal PNG entry point stages beside SQLite, preserves original ID and removes private copy', () => workspace(async ({ source, native, db }) => {
  const path = join(source, 'actual-name.png'); await writeFile(path, png);
  let stagedCopyObserved = false;
  const wrapped = { location: () => db.location(), exec: sql => db.exec(sql), prepare(sql) {
    const statement = db.prepare(sql);
    if (!sql.startsWith('INSERT OR IGNORE INTO pages')) return statement;
    return { run(...args) {
      const jobs = readdirSync(native).filter(name => name.startsWith('.wfc-ai-prepare-'));
      assert.equal(jobs.length, 1);
      const files = readdirSync(join(native, jobs[0])); assert.deepEqual(files, ['source-0.png']);
      assert.deepEqual(readFileSync(join(native, jobs[0], files[0])), png); stagedCopyObserved = true;
      return statement.run(...args);
    } };
  } };
  const result = await prepareCorpus(wrapped, [path]); assert.equal(stagedCopyObserved, true);
  assert.deepEqual(result.documents, [{ id: 'actual-name.png', sha256: sha(png), pages: 1 }]);
  const index = readCorpus(db, result.corpusId); assert.equal(index.projectId, PROJECT);
  const [manifest] = [...manifestPages(db, index)];
  assert.equal(manifest.documents[0].id, 'actual-name.png'); assert.equal(manifest.documents[0].pages[0].width, 1);
  assert.equal(manifest.documents[0].pages[0].text, '');
  assert.equal((await readdir(native)).some(name => name.startsWith('.wfc-ai-prepare-')), false);
  assert.deepEqual(await readFile(path), png);
}));
test('deterministic PNG preparation reuses digest and persists through SQLite restart', () => workspace(async ({ source, native, db }) => {
  const path = join(source, 'image.png'); await writeFile(path, png);
  const first = await prepareCorpus(db, [path]), second = await prepareCorpus(db, [path]);
  assert.deepEqual(first, second); assert.equal(rows(db, 'pages'), 1); assert.equal(rows(db, 'corpora'), 1);
  const reopened = new DatabaseSync(join(native, 'corpus.sqlite'));
  try { assert.equal([...manifestPages(reopened, readCorpus(reopened, first.corpusId))].length, 1); }
  finally { reopened.close(); }
}));
test('memory SQLite uses temporary staging and retains normal caller interface', () => workspace(async ({ source, db }) => {
  const path = join(source, 'notes.txt'); await writeFile(path, 'Synthetic P100\fSynthetic P200');
  const result = await prepareCorpus(db, [path]); assert.equal(result.totalPages, 2);
  assert.deepEqual([...manifestPages(db, readCorpus(db, result.corpusId))].map(m => m.documents[0].pages[0].page), [1, 2]);
}, true));
test('real small synthetic PDF plus PNG renders normally and repeated digests are stable', { skip: !havePoppler && 'Poppler unavailable on this host' }, () => workspace(async ({ source, db, native }) => {
  const pdf = join(source, 'a-synthetic.pdf'), image = join(source, 'b-synthetic.png');
  await writeFile(pdf, syntheticPdf()); await writeFile(image, png);
  const start = performance.now(); const first = await prepareCorpus(db, [image, pdf]);
  const elapsed = Math.round(performance.now() - start); const second = await prepareCorpus(db, [pdf, image]);
  assert.deepEqual(first, second); assert.equal(first.totalPages, 2);
  const manifests = [...manifestPages(db, readCorpus(db, first.corpusId))];
  assert.match(manifests[0].documents[0].pages[0].text, /Synthetic pump P100/);
  assert.equal(/[ \t]{2,}/.test(manifests[0].documents[0].pages[0].text), false);
  const extractedText = manifests[0].documents[0].pages[0].text;
  const originalText = spawnSync('pdftotext', ['-f','1','-l','1','-layout','-enc','UTF-8',pdf,'-'], { windowsHide: true }).stdout.toString('utf8').replaceAll('\f','');
  assert.deepEqual(extractedText.match(/\S+/g), originalText.match(/\S+/g));
  assert.equal((extractedText.match(/\n/g) ?? []).length, (originalText.match(/\n/g) ?? []).length);
  assert.match(manifests[0].documents[0].pages[0].imageDataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(manifests[1].documents[0].id, 'b-synthetic.png');
  assert.equal((await readdir(native)).some(name => name.startsWith('.wfc-ai-prepare-')), false);
  console.log(`Synthetic PDF+PNG prepare: ${elapsed}ms (local staging; not a customer-PDF benchmark).`);
}));
test('partial unsupported set rolls back all pages and corpus; retry starts clean', () => workspace(async ({ source, db, native }) => {
  const good = join(source, 'a.png'), bad = join(source, 'z.unsupported'); await writeFile(good, png); await writeFile(bad, 'not an accepted source');
  await assert.rejects(prepareCorpus(db, [good, bad]), { code: 'UNSUPPORTED_DOCUMENT_FORMAT' });
  assert.equal(rows(db, 'pages'), 0); assert.equal(rows(db, 'corpora'), 0);
  assert.equal((await readdir(native)).some(name => name.startsWith('.wfc-ai-prepare-')), false);
  assert.equal((await prepareCorpus(db, [good])).totalPages, 1);
}));
test('conversion failure rolls back and removes staged PDF', { skip: !havePoppler && 'Poppler unavailable on this host' }, () => workspace(async ({ source, db, native }) => {
  const path = join(source, 'broken.pdf'); await writeFile(path, '%PDF-1.4\nnot a valid PDF');
  await assert.rejects(prepareCorpus(db, [path]), { code: 'DOCUMENT_CONVERSION_FAILED' });
  assert.equal(rows(db, 'pages'), 0); assert.equal(rows(db, 'corpora'), 0);
  assert.equal((await readdir(native)).some(name => name.startsWith('.wfc-ai-prepare-')), false);
}));
test('source content changes during preparation are rejected before commit', () => workspace(async ({ source, db, native }) => {
  const path = join(source, 'a.png'); await writeFile(path, png);
  const wrapped = { location: () => db.location(), exec: sql => db.exec(sql), prepare(sql) {
    const statement = db.prepare(sql);
    if (!sql.startsWith('INSERT OR IGNORE INTO pages')) return statement;
    return { run(...args) { writeFileSync(path, Buffer.concat([png, Buffer.from('changed')])); return statement.run(...args); } };
  } };
  await assert.rejects(prepareCorpus(wrapped, [path]), { code: 'DOCUMENT_CHANGED_DURING_PREPARATION' });
  assert.equal(rows(db, 'pages'), 0); assert.equal(rows(db, 'corpora'), 0);
  assert.equal((await readdir(native)).some(name => name.startsWith('.wfc-ai-prepare-')), false);
}));
test('invalid caller paths and duplicate source names fail without publishing', () => workspace(async ({ source, db }) => {
  for (const paths of [[], [null], [''], [join(source, 'a.png'), join(source, 'A.png')]]) await assert.rejects(prepareCorpus(db, paths));
  assert.equal(rows(db, 'pages'), 0); assert.equal(rows(db, 'corpora'), 0);
}));
