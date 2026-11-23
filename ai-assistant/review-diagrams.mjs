import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL } from './cli.mjs';
import { createAnalysisCache } from './lib/cache.mjs';
import { readCorpus, PROJECT, sha } from './lib/corpus.mjs';
import { readReport, saveReport } from './lib/fact-store.mjs';
import { createOpenAIAdapter } from './lib/openai.mjs';
import { runAnalysis } from './lib/analysis-run.mjs';
import { compactAdapter, compactInput } from './lib/compact-diagram.mjs';

const root = '/var/lib/wfc-ai/cache';
const approvedCorpus = '4f73357891154b4edd27367c73a351213805b8628debe390ad194c9c499cede5';
const approvedPdf = '0b1db819d76e6ec2a2626b0bf8afc284136ab0842a944fabef9aa3324081bfe5';
const approvedImage = '11e3c1976910d2ab8b7ccac23293fb20639f638425d31f9be5c99d7c54b97ca0';

async function main([mode, primaryId, selection]) {
  if (!['compact', 'pump'].includes(mode) || !/^[0-9a-f]{64}$/.test(primaryId)) throw Error('A primary report and analysis mode are required');
  if (selection !== undefined && !/^[1-9]\d?(,[1-9]\d?)*$/.test(selection)) throw Error('Invalid PDF page selection');
  const chosen = selection && new Set(selection.split(',').map(Number));
  const db = new DatabaseSync(join(root, 'documents.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout=10000; PRAGMA synchronous=FULL');
    const primary = readReport(db, primaryId);
    if (primary.projectId !== PROJECT || primary.documentAnalysis?.corpusId !== approvedCorpus) throw Error('Primary report scope mismatch');
    const index = readCorpus(db, approvedCorpus);
    const pdf = index.documents.find(doc => doc.sha256 === approvedPdf && doc.pages.length === 52);
    const image = index.documents.find(doc => doc.sha256 === approvedImage && doc.pages.length === 1);
    if (index.documents.length !== 2 || !pdf || !image) throw Error('Approved document set mismatch');
    const original = new Map(primary.documentAnalysis.pages.filter(p => p.documentId === pdf.id).map(p => [p.page, p]));
    const focus = mode === 'pump';
    const wireDir = join(root, 'stage2-wire');
    mkdirSync(wireDir, { recursive: true, mode: 0o700 });
    const maxOutputTokens = focus ? 5200 : 9500;
    const provider = createOpenAIAdapter({ apiKey: readFileSync('/run/secrets/openai-api-key','utf8').trim(),
      model: MODEL, maxOutputTokens, timeoutMs: 300000, maxAttempts: 1, reasoningEffort: 'low' });
    const result = await runAnalysis({
      db, corpusId: approvedCorpus, model: MODEL, maxOutputTokens,
      maxRequests: focus ? 4 : 61, concurrency: focus ? 2 : 3, awaitCooldown: true,
      cache: createAnalysisCache(join(root, 'analysis')),
      promptVersion: focus ? 'wfc.ai.pump-group.v1' : 'wfc.ai.indexed-diagram.v1',
      inputBuilder: manifest => compactInput(manifest, focus),
      includePage: ({documentId, page}) => focus
        ? (documentId === image.id || documentId === pdf.id && page === 16)
        : documentId === pdf.id && original.get(page)?.status !== 'analyzed' && (!chosen || chosen.has(page)),
      adapter: compactAdapter(provider, { onWire(response, {manifest, requestId}) {
        // Only the output from this approved job is persisted. Source images, authorization
        // and the provider transport are never serialized with the response.
        const doc = manifest.documents[0];
        if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw Error('Invalid request identity');
        const output = JSON.stringify(response.analysis);
        if (output === undefined) return;
        const packet = { documentId: doc.id, documentSha256: doc.sha256, page: doc.pages[0].page,
          requestId, responseId: response.responseId, usage: response.usage, sha256: sha(output), output };
        writeFileSync(join(wireDir, requestId + '.json'), JSON.stringify(packet), { flag: 'wx', mode: 0o600 });
      } }),
    });
    const reportId = saveReport(db, { schemaVersion: 'wfc.ai.project-review.v1', projectId: PROJECT,
      baseline: primary.baseline, primaryReportId: primaryId, profile: mode, documents: primary.documents,
      equipment: null, reconciliation: null, endpointWrites: 0, documentAnalysis: result });
    console.log(JSON.stringify({ reportId, profile: mode, selected: result.selectedPages, analyzed: result.analyzedPages,
      failures: result.pages.filter(p => !['skipped','analyzed'].includes(p.status)).map(p => [p.page,p.status,p.reason]),
      requests: result.requestsUsed, usage: result.usage, grant: result.grant, stopReason: result.stopReason }));
  } finally { db.close(); }
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.code ?? error.name);
  process.exitCode = 1;
});
