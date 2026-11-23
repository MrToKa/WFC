import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initCorpus, prepareCorpus, manifestPages, readCorpus, PROJECT, fail } from './lib/corpus.mjs';
import { initLocalReports, importFacts, latestFacts, readReport, saveReport } from './lib/fact-store.mjs';
import { createAnalysisCache } from './lib/cache.mjs';
import { runAnalysis } from './lib/analysis-run.mjs';
import { createOpenAIAdapter } from './lib/openai.mjs';
import { summarizeEquipment } from './lib/diagram.mjs';
import { summarizeKnownFacts } from './lib/wfc-baseline.mjs';

export const MODEL = 'gpt-6.1-terra';
const DEFAULT_ROOT = '/var/lib/wfc-ai/cache';
const MAX_OUTPUT_TOKENS = 12000;

function readSecret(file, code) {
  try {
    const value = readFileSync(file, 'utf8').trim();
    if (value.length <= 4096 && /^[!-~]+$/.test(value)) return value;
  } catch {}
  fail(code);
}

function liveProvider() {
  return createOpenAIAdapter({
    apiKey: readSecret('/run/secrets/openai-api-key', 'OPENAI_KEY_REQUIRED'),
    model: MODEL, maxAttempts: 1, maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: 180000,
  });
}

export async function main([command, ...args], { root = DEFAULT_ROOT, input = process.stdin, provider = liveProvider } = {}) {
  if (command === 'inventory') {
    const { createWfcReadClient } = await import('./lib/wfc-read.mjs');
    return createWfcReadClient({
      projectId: PROJECT, baseUrl: 'http://host.docker.internal:5181',
      token: readSecret('/run/secrets/wfc-read-token', 'WFC_USER_TOKEN_REQUIRED'),
    }).inventory();
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(root, 'documents.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout=10000; PRAGMA synchronous=FULL;');
    initCorpus(db);
    initLocalReports(db);
    if (command === 'prepare') return await prepareCorpus(db, args);
    if (command === 'import-facts') return await importFacts(db, input);
    if (command === 'report' && args.length === 1) return readReport(db, args[0]);
    if (command !== 'preflight' && command !== 'analyze') fail('DOCUMENT_COMMAND_UNKNOWN');
    if (args.length !== 1) fail('CORPUS_ID_REQUIRED');
    const corpusId = args[0];
    const index = readCorpus(db, corpusId);
    const { id: factsId, facts } = latestFacts(db);
    // Verify the entire supplied document set and the local WFC snapshot before the first request.
    let totalPages = 0, visualPages = 0;
    for (const manifest of manifestPages(db, index)) {
      totalPages++;
      if (manifest.documents[0].pages[0].imageDataUrl) visualPages++;
    }
    const baseline = { factsId, capturedAt: facts.capturedAt, cables: facts.cables.length, endpointNames: facts.endpoints.length };
    if (command === 'preflight') {
      return { corpusId, projectId: PROJECT, baseline,
        documents: index.documents.map(d => ({ documentId: d.id, sha256: d.sha256, pages: d.pages.length })),
        totalPages, visualPages, model: MODEL, externalRequests: 0, endpointWrites: 0 };
    }
    const cache = createAnalysisCache(join(root, 'analysis'));
    const result = await runAnalysis({
      db, corpusId, model: MODEL, cache, adapter: provider(),
      maxRequests: Math.min(4096, totalPages + 8), maxOutputTokens: MAX_OUTPUT_TOKENS, concurrency: 3, awaitCooldown: true,
    });
    let equipment = null, reconciliation = null;
    if (result.status === 'analyzed') {
      const analyses = [];
      for (const page of result.pages) analyses.push((await cache.get(page.cacheKey)).analysis);
      equipment = summarizeEquipment(analyses);
      reconciliation = summarizeKnownFacts(facts, equipment);
    }
    const reportId = saveReport(db, {
      schemaVersion: 'wfc.ai.project-review.v1', projectId: PROJECT, baseline,
      documents: index.documents.map(({ id, sha256, pages }) => ({ id, sha256, pages: pages.length })),
      documentAnalysis: result, equipment, reconciliation, endpointWrites: 0,
    });
    return { reportId, corpusId, baseline, status: result.status, totalPages, analyzedPages: result.analyzedPages,
      cacheHits: result.cacheHits, requestsUsed: result.requestsUsed, usage: result.usage, usageComplete: result.usageComplete, grant: result.grant,
      ...(result.stopReason ? { stopReason: result.stopReason } : {}), combinedReviewAvailable: reconciliation !== null, endpointWrites: 0 };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'incomplete') process.exitCode = 2;
  }).catch(error => {
    const code = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,90}$/.test(error.code) ? error.code : 'LOCAL_OPERATION_FAILED';
    console.error(JSON.stringify({ error: code }));
    process.exitCode = 1;
  });
}
