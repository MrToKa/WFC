import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DOCUMENT_PARSER_VERSION as prepVersion, validateManifest } from './evidence.mjs';

export const PROJECT = 'da667921-1f13-4c1d-9f87-063d127b98ce';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function fail(code) { throw Object.assign(new Error(code), { code }); }
const MAX_PAGES = 4096;
const MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.txt', '.csv', '.tsv']);

async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Poppler repeatedly seeks inside PDFs. Stage one sequential source read onto
 * the database's native filesystem instead of doing those seeks on a host mount.
 * Only the explicitly supplied source is copied; its original ID stays unchanged. */
async function stageSource(source, destination) {
  const hash = createHash('sha256'); let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_DOCUMENT_BYTES) { callback(Object.assign(new Error('DOCUMENT_FILE_INVALID'), { code: 'DOCUMENT_FILE_INVALID' })); return; }
      hash.update(chunk); callback(null, chunk);
    },
  });
  await pipeline(createReadStream(source), meter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  if (!bytes) fail('DOCUMENT_FILE_INVALID');
  return hash.digest('hex');
}

async function removeStagedFile(path) {
  await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
function poppler(command, args, maxBuffer) {
  try {
    return execFileSync(command, args, { timeout: 120000, maxBuffer, windowsHide: true,
      stdio: ['ignore','pipe','pipe'], env: { ...process.env, LC_ALL: 'C' } });
  } catch { fail('DOCUMENT_CONVERSION_FAILED'); }
}
function dimensions(bytes, format) {
  if (format === 'png' && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a','hex'))
    && bytes.toString('ascii',12,16) === 'IHDR') return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (format === 'jpeg' && bytes.readUInt16BE(0) === 0xffd8) {
    let pos = 2;
    while (pos + 9 < bytes.length && bytes[pos++] === 255) {
      while (pos < bytes.length && bytes[pos] === 255) pos++;
      const marker = bytes[pos++], length = bytes.readUInt16BE(pos);
      if ([0xc0,0xc1,0xc2].includes(marker)) return [bytes.readUInt16BE(pos+5),bytes.readUInt16BE(pos+3)];
      if (length < 2 || marker === 0xda) break;
      pos += length;
    }
  }
  fail('UNREADABLE_DOCUMENT_IMAGE');
}
function imagePage(page, text, bytes, format) {
  if (bytes.length < 16 || bytes.length > 5 * 1024 * 1024) fail('DOCUMENT_IMAGE_LIMIT');
  const [width,height] = dimensions(bytes,format);
  return { page,text,width,height,imageDataUrl: 'data:image/' + format + ';base64,' + bytes.toString('base64') };
}
export async function* extract(path, ext) {
  if (ext === '.pdf') {
    const match = /^Pages:\s+(\d+)\s*$/m.exec(poppler('pdfinfo',[path],256000).toString());
    const total = Number(match?.[1]);
    if (!Number.isSafeInteger(total) || total < 1 || total > MAX_PAGES) fail('DOCUMENT_PAGE_COUNT_INVALID');
    for (let i=1;i<=total;i++) {
      const range = ['-f',String(i),'-l',String(i)];
      const text = poppler('pdftotext',[...range,'-layout','-enc','UTF-8',path,'-'],1000000)
        // Geometry remains in the image. Remove horizontal layout padding, not
        // words or line breaks, so dense P&IDs fit the bounded text contract.
        .toString('utf8').replaceAll('\f','').replace(/[ \t]+/g, ' ').replace(/ +(\r?$)/gm, '$1');
      const bytes = poppler('pdftoppm',[...range,'-scale-to','3500','-jpeg','-jpegopt','quality=90','-singlefile',path],5*1024*1024);
      yield imagePage(i,text,bytes,'jpeg');
    }
  } else if (['.png','.jpg','.jpeg'].includes(ext)) {
    if ((await stat(path)).size > 5*1024*1024) fail('DOCUMENT_IMAGE_LIMIT');
    yield imagePage(1,'',await readFile(path),ext === '.png' ? 'png' : 'jpeg');
  } else if (['.txt','.csv','.tsv'].includes(ext)) {
    if ((await stat(path)).size > 1000000) fail('DOCUMENT_TEXT_LIMIT');
    const content = new TextDecoder('utf-8',{fatal:true}).decode(await readFile(path));
    let n=0;
    for (const text of content.split('\f')) yield { page:++n,text,width:1,height:1 };
  } else fail('UNSUPPORTED_DOCUMENT_FORMAT');
}

export function initCorpus(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS pages (digest TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS corpora (id TEXT PRIMARY KEY, inventory TEXT NOT NULL);`);
}
export async function prepareCorpus(db, paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 256
    || paths.some(path => typeof path !== 'string' || !path.trim())) fail('DOCUMENT_SET_INVALID');
  const files = paths.map(path => resolve(path)).sort();
  if (new Set(files.map(path => basename(path).toLowerCase())).size !== files.length) fail('DUPLICATE_DOCUMENT_NAME');
  const documents = [];
  const insert = db.prepare('INSERT OR IGNORE INTO pages VALUES (?,?)');
  const databasePath = typeof db.location === 'function' ? db.location() : null;
  const stagingParent = databasePath ? dirname(resolve(databasePath)) : tmpdir();
  const stagingDirectory = await mkdtemp(join(stagingParent, '.wfc-ai-prepare-'));
  let transactionActive = false;
  try {
    db.exec('BEGIN IMMEDIATE'); transactionActive = true;
    let count = 0;
    for (const [documentIndex, path] of files.entries()) {
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size > MAX_DOCUMENT_BYTES || metadata.size === 0) fail('DOCUMENT_FILE_INVALID');
      const extension = extname(path).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) fail('UNSUPPORTED_DOCUMENT_FORMAT');
      const stagedPath = join(stagingDirectory, 'source-' + documentIndex + extension);
      try {
        const doc = { id: basename(path), sha256: await stageSource(path, stagedPath), pages: [] };
        for await (const page of extract(stagedPath, extension)) {
          if (++count > MAX_PAGES) fail('DOCUMENT_SET_PAGE_LIMIT');
          validateManifest(singlePage(doc, page));
          const payload = JSON.stringify(page), digest = sha(payload);
          insert.run(digest, payload);
          doc.pages.push(digest);
        }
        documents.push(doc);
      } finally {
        await removeStagedFile(stagedPath);
      }
    }
    // Recheck the complete set immediately before publication, including earlier
    // sources that could have changed while a later document was rendering.
    for (const [index, path] of files.entries()) {
      if (await fileHash(path) !== documents[index].sha256) fail('DOCUMENT_CHANGED_DURING_PREPARATION');
    }
    const inventory = JSON.stringify({ prepVersion, projectId: PROJECT, documents });
    const id = sha(inventory);
    db.prepare('INSERT OR IGNORE INTO corpora VALUES (?,?)').run(id, inventory);
    db.exec('COMMIT'); transactionActive = false;
    return { corpusId: id, documents: documents.map(d => ({ id: d.id, sha256: d.sha256, pages: d.pages.length })), totalPages: count };
  } catch (error) {
    if (transactionActive) db.exec('ROLLBACK');
    throw error;
  } finally {
    // No recursive deletion: the private directory contains only the one staged
    // file already unlinked above. Retry uses a fresh path after process restart.
    await rmdir(stagingDirectory);
  }
}
function singlePage(doc,page) {
  return {schemaVersion:'wfc.ai.document-manifest.v1',projectId:PROJECT,documents:[{id:doc.id,sha256:doc.sha256,pages:[page]}]};
}
export function readCorpus(db,id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) fail('CORPUS_ID_REQUIRED');
  const record = db.prepare('SELECT inventory FROM corpora WHERE id=?').get(id);
  if (!record || sha(record.inventory)!==id) fail('CORPUS_MISSING_OR_CORRUPT');
  const index=JSON.parse(record.inventory);
  if (index.projectId!==PROJECT || index.prepVersion!==prepVersion) fail('CORPUS_SCOPE_CHANGED');
  return index;
}
export function* manifestPages(db,index) {
  const get=db.prepare('SELECT payload FROM pages WHERE digest=?');
  for (const doc of index.documents) {
    for (const [i,digest] of doc.pages.entries()) {
      const raw=get.get(digest);
      if (!raw || sha(raw.payload)!==digest) fail('CORPUS_PAGE_CORRUPT');
      const page=JSON.parse(raw.payload);
      if (page.page !== i+1) fail('CORPUS_PAGE_ORDER_INVALID');
      yield validateManifest(singlePage(doc,page));
    }
  }
}
