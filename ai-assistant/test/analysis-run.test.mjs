import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCorpus, prepareCorpus, readCorpus, manifestPages } from '../lib/corpus.mjs';
import { runAnalysis } from '../lib/analysis-run.mjs';
import { buildInput, PROMPT_VERSION } from '../lib/diagram.mjs';

async function fixture(contents, execute) {
  const directory = await mkdtemp(join(tmpdir(), 'wfc-analysis-run-'));
  const filename = join(directory, 'state.sqlite');
  const db = new DatabaseSync(filename);
  try {
    initCorpus(db);
    const paths = [];
    for (let i = 0; i < contents.length; i++) {
      const path = join(directory, `synthetic-${i + 1}.txt`);
      await writeFile(path, contents[i]); paths.push(path);
    }
    const corpus = await prepareCorpus(db, paths);
    const manifests = [...manifestPages(db, readCorpus(db, corpus.corpusId))];
    const values = new Map();
    const cache = { async get(key) { return values.has(key) ? structuredClone(values.get(key)) : null; },
      async put(key, value) { values.set(key, structuredClone(value)); } };
    const options = { db, corpusId: corpus.corpusId, model: 'synthetic-model', cache, maxRequests: 20, maxOutputTokens: 12000 };
    await execute({ directory, filename, db, paths, corpus, manifests, values, cache, options });
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
}

function analysis(manifest, { unreadable = false, uncertain = false, unresolved = false } = {}) {
  const doc = manifest.documents[0], page = doc.pages[0];
  const evidence = [{ documentId: doc.id, page: page.page, basis: 'local-text', quote: page.text.trim(), bbox: null }];
  return { schemaVersion: 'wfc.ai.document-analysis.v1', projectId: manifest.projectId,
    coverage: [{ documentId: doc.id, page: page.page, status: unreadable ? 'unreadable' : 'analyzed', reason: unreadable ? 'Synthetic illegible source' : '' }],
    entities: unreadable ? [] : [{ id: 'pump', tag: 'P-1', kind: 'equipment', evidence }, { id: 'signal', tag: 'PTC-1', kind: 'signal', evidence }],
    relations: unreadable ? [] : [{ fromEntityId: 'signal', toEntityId: 'pump', type: 'ptc-of', status: uncertain ? 'uncertain' : 'supported', evidence }],
    unresolved: unresolved ? [{ reason: 'Synthetic ambiguous signal label', evidence }] : [] };
}

function reply(request, manifest, overrides = {}) {
  return { analysis: analysis(manifest), model: 'synthetic-model', responseId: 'resp_synthetic', requestId: request.requestId,
    providerRequestId: 'req_synthetic', attempts: 1, usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 }, ...overrides };
}

test('analyzes all pages of every supplied document and uses validated cache on restart', async () => {
  await fixture(['P-1 PTC-1\fP-1 OPEN-1', 'P-2 PTC-2'], async ({ options, manifests, values }) => {
    let calls = 0;
    const first = await runAnalysis({ ...options, adapter: { analyze: async request => reply(request, manifests[calls++]) } });
    assert.equal(first.status, 'analyzed');
    assert.equal(first.totalPages, 3);
    assert.equal(first.analyzedPages, 3);
    assert.equal(first.requestsUsed, 3);
    assert.deepEqual(first.usage, { inputTokens: 240, outputTokens: 60, totalTokens: 300 });
    assert.equal(first.usageComplete, true);
    assert.equal(values.size, 3);
    assert.deepEqual(first.pages.map(page => [page.documentId, page.page]), [['synthetic-1.txt', 1], ['synthetic-1.txt', 2], ['synthetic-2.txt', 1]]);
    for (const page of first.pages) assert.ok(values.get(page.cacheKey).analysis);
    const second = await runAnalysis({ ...options, adapter: { analyze: async () => assert.fail('cache replay must not call provider') } });
    assert.equal(second.status, 'analyzed');
    assert.equal(second.cacheHits, 3);
    assert.equal(second.requestsUsed, 3);
    assert.deepEqual(second.usage, first.usage);
    assert.equal(calls, 3);
  });
});

test('uncertain relations and unresolved findings are reported without hiding clear analyzed pages', async () => {
  await fixture(['P-1 PTC-1'], async ({ options, manifests }) => {
    const result = await runAnalysis({ ...options, adapter: { analyze: async request => reply(request, manifests[0], { analysis: analysis(manifests[0], { uncertain: true, unresolved: true }) }) } });
    assert.equal(result.status, 'analyzed');
    assert.equal(result.pages[0].unresolvedCount, 1);
    assert.equal(result.pages[0].uncertainRelations, 1);
  });
});

test('unreadable analysis and empty page sources prevent corpus readiness', async () => {
  await fixture(['P-1 PTC-1\f   '], async ({ options, manifests }) => {
    let calls = 0;
    const result = await runAnalysis({ ...options, adapter: { analyze: async request => { calls++; return reply(request, manifests[0], { analysis: analysis(manifests[0], { unreadable: true }) }); } } });
    assert.equal(result.status, 'incomplete');
    assert.equal(result.analyzedPages, 0);
    assert.equal(result.pages[0].reason, 'ANALYSIS_UNREADABLE_PAGE');
    assert.equal(result.pages[1].reason, 'ANALYSIS_PAGE_SOURCE_EMPTY');
    assert.equal(calls, 1);
  });
});

test('persistent request limit cannot be silently raised by restarting the corpus', async () => {
  await fixture(['P-1 PTC-1\fP-2 PTC-2'], async ({ options, manifests }) => {
    let calls = 0;
    const adapter = { analyze: async request => reply(request, manifests[calls++]) };
    const first = await runAnalysis({ ...options, adapter, maxRequests: 1 });
    assert.equal(first.status, 'incomplete');
    assert.equal(first.pages[1].reason, 'ANALYSIS_REQUEST_BUDGET_EXHAUSTED');
    const second = await runAnalysis({ ...options, adapter, maxRequests: 100 });
    assert.equal(second.maxRequests, 1);
    assert.equal(second.requestsUsed, 1);
    assert.equal(second.cacheHits, 1);
    assert.equal(calls, 1);
  });
});

test('unknown dispatch outcomes are durable, not resent, and stop further provider calls', async () => {
  await fixture(['P-1 PTC-1\fP-2 PTC-2'], async ({ options }) => {
    let calls = 0;
    const adapter = { analyze: async () => { calls++; throw Object.assign(new Error('hostile secret text'), { code: 'OPENAI_RESPONSE_UNKNOWN', attempts: 1, outcomeUnknown: true }); } };
    const first = await runAnalysis({ ...options, adapter });
    assert.equal(first.status, 'incomplete');
    assert.equal(first.pages[0].status, 'blocked');
    assert.equal(first.pages[1].status, 'not-requested');
    assert.equal(first.usageComplete, false);
    assert.equal(first.unreportedRequests, 1);
    assert.equal(JSON.stringify(first).includes('hostile secret text'), false);
    const second = await runAnalysis({ ...options, adapter });
    assert.equal(second.pages[0].reason, 'OPENAI_RESPONSE_UNKNOWN');
    assert.equal(second.pages[1].status, 'not-requested');
    assert.equal(calls, 1);
  });
});

test('missing key releases a pre-dispatch reservation; a known auth rejection can be retried later', async () => {
  await fixture(['P-1 PTC-1\fP-2 PTC-2'], async ({ options, manifests }) => {
    let calls = 0;
    const noKey = await runAnalysis({ ...options, adapter: { analyze: async () => { calls++; throw Object.assign(new Error('OPENAI_KEY_REQUIRED'), { code: 'OPENAI_KEY_REQUIRED', attempts: 0 }); } } });
    assert.equal(noKey.requestsUsed, 0);
    assert.equal(calls, 1);
    const rejected = await runAnalysis({ ...options, adapter: { analyze: async () => { calls++; throw Object.assign(new Error('OPENAI_AUTHENTICATION_FAILED'), { code: 'OPENAI_AUTHENTICATION_FAILED', attempts: 1 }); } } });
    assert.equal(rejected.requestsUsed, 1);
    assert.equal(rejected.pages[1].status, 'not-requested');
    let page = 0;
    const accepted = await runAnalysis({ ...options, adapter: { analyze: async request => reply(request, manifests[page++]) } });
    assert.equal(accepted.status, 'analyzed');
    assert.equal(accepted.requestsUsed, 3);
  });
});

test('invalid paid evidence is never resent, records usage and does not stop unaffected pages', async () => {
  await fixture(['P-1 PTC-1\fP-2 PTC-2'], async ({ options, manifests, db, values }) => {
    let calls = 0;
    const first = await runAnalysis({ ...options, adapter: { analyze: async request => {
      const index = calls++, result = reply(request, manifests[index]);
      if (index === 0) result.analysis.relations[0].toEntityId = 'orphan-not-present';
      return result;
    } } });
    assert.equal(first.status, 'incomplete');
    assert.equal(first.pages[0].reason, 'ANALYSIS_ENTITY_NOT_FOUND');
    assert.equal(first.pages[1].status, 'analyzed');
    assert.deepEqual(first.usage, { inputTokens: 160, outputTokens: 40, totalTokens: 200 });
    const saved = db.prepare('SELECT q.*,a.input_tokens,a.reason FROM ai_analysis_quarantine q JOIN ai_analysis_attempts a ON a.id=q.attempt_id').get();
    assert.equal(saved.document_id, manifests[0].documents[0].id);
    assert.equal(saved.document_sha256, manifests[0].documents[0].sha256);
    assert.equal(saved.page, 1);
    assert.equal(JSON.parse(saved.payload).relations[0].toEntityId, 'orphan-not-present');
    assert.equal(saved.input_tokens, 80);
    assert.equal(values.has(first.pages[0].cacheKey), false);
    const second = await runAnalysis({ ...options, adapter: { analyze: async () => assert.fail('invalid paid evidence must not be resent') } });
    assert.equal(second.pages[0].status, 'blocked');
    assert.equal(second.cacheHits, 1);
    assert.equal(calls, 2);
  });
});

test('SQLite receipt recovers interrupted cache publication without a second paid call', async () => {
  await fixture(['P-1 PTC-1'], async ({ options, manifests, cache }) => {
    let calls = 0;
    const adapter = { analyze: async request => { calls++; return reply(request, manifests[0]); } };
    const first = await runAnalysis({ ...options, adapter, cache: { get: cache.get, put: async () => { throw Object.assign(new Error('private disk info'), { code: 'CACHE_UNAVAILABLE' }); } } });
    assert.equal(first.status, 'incomplete');
    assert.equal(first.pages[0].status, 'cache-error');
    const second = await runAnalysis({ ...options, adapter });
    assert.equal(second.status, 'analyzed');
    assert.equal(second.pages[0].source, 'receipt');
    assert.equal(second.cacheHits, 1);
    assert.equal(calls, 1);
  });
});

test('invalid cache is not accepted and does not trigger another paid request', async () => {
  await fixture(['P-1 PTC-1'], async ({ options, manifests, values }) => {
    const first = await runAnalysis({ ...options, adapter: { analyze: async request => reply(request, manifests[0]) } });
    values.get(first.pages[0].cacheKey).analysis.coverage = [];
    const second = await runAnalysis({ ...options, adapter: { analyze: async () => assert.fail('corrupt cache must not cause paid retry') } });
    assert.equal(second.status, 'incomplete');
    assert.equal(second.pages[0].status, 'invalid');
  });
});

test('two connections cannot dispatch the same cache key, even across different corpus sets', async () => {
  await fixture(['P-1 PTC-1'], async ({ options, manifests, filename, paths, directory, db }) => {
    const extra = join(directory, 'synthetic-extra.txt');
    await writeFile(extra, 'P-2 PTC-2');
    const otherCorpus = await prepareCorpus(db, [...paths, extra]);
    const otherManifests = [...manifestPages(db, readCorpus(db, otherCorpus.corpusId))];
    const db2 = new DatabaseSync(filename);
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    let started;
    const dispatched = new Promise(resolve => { started = resolve; });
    let firstCalls = 0, otherCalls = 0;
    try {
      const first = runAnalysis({ ...options, adapter: { analyze: async request => { firstCalls++; started(); await pending; return reply(request, manifests[0]); } } });
      await dispatched;
      const second = await runAnalysis({ ...options, db: db2, corpusId: otherCorpus.corpusId, adapter: { analyze: async request => { otherCalls++; return reply(request, otherManifests[1]); } } });
      assert.equal(second.pages[0].status, 'blocked');
      assert.equal(second.pages[1].status, 'analyzed');
      assert.equal(firstCalls, 1);
      assert.equal(otherCalls, 1);
      finish();
      assert.equal((await first).status, 'analyzed');
      const replay = await runAnalysis({ ...options, db: db2, corpusId: otherCorpus.corpusId, adapter: { analyze: async () => assert.fail('cross-corpus cached claims must not resend') } });
      assert.equal(replay.status, 'analyzed');
      assert.equal(replay.cacheHits, 2);
    } finally { finish(); db2.close(); }
  });
});

test('corrupt source page is accounted for while another supplied document can still be analyzed', async () => {
  await fixture(['P-1 PTC-1', 'P-2 PTC-2'], async ({ options, manifests, db, corpus }) => {
    const index = readCorpus(db, corpus.corpusId);
    db.prepare('UPDATE pages SET payload=? WHERE digest=?').run('{}', index.documents[0].pages[0]);
    let calls = 0;
    const result = await runAnalysis({ ...options, adapter: { analyze: async request => { calls++; return reply(request, manifests[1]); } } });
    assert.equal(result.totalPages, 2);
    assert.equal(result.pages.length, 2);
    assert.equal(result.pages[0].status, 'invalid-source');
    assert.equal(result.pages[1].status, 'analyzed');
    assert.equal(result.status, 'incomplete');
    assert.equal(calls, 1);
  });
});

test('adapter retry/output misconfiguration is visible and stops subsequent paid requests', async () => {
  await fixture(['P-1 PTC-1\fP-2 PTC-2'], async ({ options, manifests }) => {
    let calls = 0;
    const result = await runAnalysis({ ...options, adapter: { analyze: async request => { calls++; return reply(request, manifests[0], { attempts: 2 }); } } });
    assert.equal(result.status, 'incomplete');
    assert.equal(result.stopReason, 'ANALYSIS_ADAPTER_RETRY_CONFIGURATION');
    assert.equal(result.requestsUsed, 2);
    assert.equal(result.pages[1].status, 'not-requested');
    assert.equal(calls, 1);
  });
});

test('confirmed 429/503 rejections get one bounded retry with a separate durable admission', async () => {
  for (const httpStatus of [429, 503]) {
    await fixture(['P-1 PTC-1'], async ({ options, manifests, db }) => {
      let calls = 0;
      const requestIds = [], delays = [];
      const result = await runAnalysis({ ...options, sleepImpl: async milliseconds => delays.push(milliseconds), adapter: { analyze: async request => {
        calls++; requestIds.push(request.requestId);
        if (calls === 1) throw Object.assign(new Error('synthetic rejection'), {
          code: httpStatus === 429 ? 'OPENAI_RATE_LIMIT' : 'OPENAI_SERVICE_UNAVAILABLE', httpStatus, attempts: 1, outcomeUnknown: false,
        });
        return reply(request, manifests[0]);
      } } });
      assert.equal(result.status, 'analyzed');
      assert.equal(result.requestsUsed, 2);
      assert.equal(calls, 2);
      assert.notEqual(requestIds[0], requestIds[1]);
      assert.deepEqual(delays, [httpStatus === 429 ? 10000 : 250]);
      assert.equal(db.prepare('SELECT COUNT(*) count FROM ai_analysis_attempts').get().count, 2);
    });
  }
});

test('confirmed retry exhaustion is durable across restart and stops other page requests', async () => {
  await fixture(['P-1 PTC-1\fP-2 PTC-2'], async ({ options }) => {
    let calls = 0;
    const adapter = { analyze: async () => { calls++; throw Object.assign(new Error('synthetic rejection'), { code: 'OPENAI_RATE_LIMIT', httpStatus: 429, attempts: 1 }); } };
    const first = await runAnalysis({ ...options, adapter, sleepImpl: async () => {} });
    assert.equal(calls, 2);
    assert.equal(first.stopReason, 'ANALYSIS_RETRY_LIMIT_REACHED');
    assert.equal(first.pages[1].status, 'not-requested');
    const second = await runAnalysis({ ...options, adapter, sleepImpl: async () => {} });
    assert.equal(calls, 2);
    assert.equal(second.requestsUsed, 2);
    assert.equal(second.stopReason, 'ANALYSIS_RETRY_LIMIT_REACHED');
  });
});

test('a transient retry cannot bypass the persisted global request budget', async () => {
  await fixture(['P-1 PTC-1'], async ({ options }) => {
    let calls = 0;
    const adapter = { analyze: async () => { calls++; throw Object.assign(new Error('synthetic rejection'), { code: 'OPENAI_SERVICE_UNAVAILABLE', httpStatus: 503, attempts: 1 }); } };
    const result = await runAnalysis({ ...options, maxRequests: 1, adapter, sleepImpl: async () => {} });
    assert.equal(result.status, 'incomplete');
    assert.equal(result.pages[0].reason, 'ANALYSIS_REQUEST_BUDGET_EXHAUSTED');
    assert.equal(result.requestsUsed, 1);
    assert.equal(calls, 1);
  });
});

test('case-wide grant counts historical and pending sends across prompt, corpus and model', async () => {
  await fixture(['P-1 PTC-1'], async ({ options, manifests, paths, db, directory, filename }) => {
    // An earlier model/prompt/corpus has 13 unmetered, potentially charged dispatches ($61.10).
    await runAnalysis({ ...options, adapter: { analyze: async request => reply(request, manifests[0]) } });
    const seed = db.prepare('SELECT * FROM ai_analysis_budgets').get();
    db.prepare('UPDATE ai_analysis_budgets SET prompt_version=? WHERE id=?').run('older-prompt', seed.id);
    const insert = db.prepare(`INSERT INTO ai_analysis_attempts (id,budget_id,cache_key,request_id,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`);
    for (let n=0;n<13;n++) insert.run('old-'+n,seed.id,'cache-'+n,'request-'+n,'dispatched','old','old');
    const extra = join(directory, 'synthetic-extra.txt');
    await writeFile(extra, 'P-2 PTC-2');
    const another = await prepareCorpus(db, [...paths, extra]);
    const db2 = new DatabaseSync(filename);
    let unblock, started;
    const pending = new Promise(resolve => { unblock = resolve; });
    const ready = new Promise(resolve => { started = resolve; });
    try {
      const first = runAnalysis({ ...options, model: 'gpt-6.1-terra', adapter: { analyze: async request => {
        started(); await pending; return reply(request, manifests[0]);
      } } });
      await ready;
      const second = await runAnalysis({ ...options, model: 'gpt-6.1-terra', corpusId: another.corpusId, db: db2,
        adapter: { analyze: async () => assert.fail('exposure would exceed $70') } });
      assert.equal(second.pages[1].reason, 'ANALYSIS_GRANT_BUDGET_EXHAUSTED');
      assert.equal(second.grant.reservedMicroUsd, 65_800_000);
      assert.equal(second.grant.meteredUpperMicroUsd, 550);
      unblock();
      assert.equal((await first).grant.reservedMicroUsd, 61_100_000);
    } finally { unblock(); db2.close(); }
  });
});

test('paid adapter errors retain semantic evidence and metering; quota rejections release all reserved funds', async () => {
  await fixture(['P-1 PTC-1\fP-2 PTC-2\fP-3 PTC-3'], async ({ options, manifests, db }) => {
    let calls = 0;
    const result = await runAnalysis({ ...options, model: 'gpt-6.1-terra', adapter: { analyze: async () => {
      if (++calls === 1) throw Object.assign(new Error('unsafe details'), { code: 'OPENAI_RESPONSE_INCOMPLETE',
        analysis: analysis(manifests[0]), usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
        responseId: 'resp_paid', attempts: 1 });
      throw Object.assign(new Error('quota'), { code: 'OPENAI_INSUFFICIENT_QUOTA', httpStatus: 429, attempts: 1 });
    } } });
    assert.equal(calls, 2);
    assert.equal(result.stopReason, 'OPENAI_INSUFFICIENT_QUOTA');
    assert.equal(result.usageComplete, true);
    assert.deepEqual(result.grant, { ceilingMicroUsd: 70_000_000, meteredUpperMicroUsd: 73, reservedMicroUsd: 0, unreportedRequests: 0 });
    const saved = db.prepare('SELECT a.response_id,q.payload FROM ai_analysis_quarantine q JOIN ai_analysis_attempts a ON q.attempt_id=a.id').get();
    assert.equal(saved.response_id, 'resp_paid');
    assert.deepEqual(JSON.parse(saved.payload), analysis(manifests[0]));
  });
});

test('bounded workers preserve page order and honor provider retry hints', async () => {
  await fixture(['P-1 PTC-1\fP-2 PTC-2\fP-3 PTC-3'], async ({ options, manifests }) => {
    let next = 0, active = 0, maximum = 0;
    const delays = [];
    const result = await runAnalysis({ ...options, concurrency: 2, sleepImpl: async ms => { delays.push(ms); },
      adapter: { analyze: async request => {
        const call = next++;
        if (call === 0) throw Object.assign(new Error('rate'), { code: 'OPENAI_RATE_LIMIT', httpStatus: 429, attempts: 1, retryAfterMs: 75000 });
        const index = [null, 1, 0, 2][call];
        maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setTimeout(resolve, call === 1 ? 10 : 1));
        active--;
        return reply(request, manifests[index]);
      } } });
    assert.equal(result.status, 'analyzed');
    assert.equal(maximum, 2);
    assert.deepEqual(result.pages.map(p => p.page), [1,2,3]);
    assert.deepEqual(delays, [75000]);
  });
});

test('long provider cooldown defers all new sends for the model across corpora and restarts', async () => {
  await fixture(['P-1 PTC-1'], async ({ options, manifests, db, filename, directory }) => {
    const calledAt = Date.now();
    const result = await runAnalysis({ ...options, adapter: { analyze: async () => {
      throw Object.assign(new Error('wait'), { code: 'OPENAI_RATE_LIMIT', httpStatus: 429, attempts: 1, retryAfterMs: 900000 });
    } }, sleepImpl: async () => assert.fail('long deferrals must return immediately') });
    assert.equal(result.pages[0].status, 'deferred');
    assert.equal(result.stopReason, 'ANALYSIS_PROVIDER_COOLDOWN');
    assert.ok(Date.parse(result.retryAt) >= calledAt + 900000);
    assert.equal(result.requestsUsed, 1);
    const other = join(directory, 'synthetic-extra.txt');
    await writeFile(other, 'P-2 PTC-2');
    const otherCorpus = await prepareCorpus(db, [other]);
    const db2 = new DatabaseSync(filename);
    try {
      const early = await runAnalysis({ ...options, db: db2, corpusId: otherCorpus.corpusId,
        adapter: { analyze: async () => assert.fail('persisted provider deferral must apply to this corpus') } });
      assert.equal(early.stopReason, 'ANALYSIS_PROVIDER_COOLDOWN');
      assert.equal(early.retryAt, result.retryAt);
      assert.equal(early.requestsUsed, 0);
      db2.prepare('UPDATE ai_analysis_attempts SET retry_at_ms=? WHERE retry_at_ms IS NOT NULL').run(calledAt-1);
      const resume = await runAnalysis({ ...options, db: db2, adapter: { analyze: async request => reply(request, manifests[0]) } });
      assert.equal(resume.status, 'analyzed');
      assert.equal(resume.requestsUsed, 2);
    } finally { db2.close(); }
  });
});

test('focused questions preserve base receipts and document numbering, and recover their own version', async () => {
  await fixture(['P-1 PTC-1\fP-2 PTC-2'], async ({ options, manifests, values, db }) => {
    let page = 0;
    const base = await runAnalysis({ ...options, adapter: { analyze: async request => reply(request, manifests[page++]) } });
    let focusCalls = 0;
    const version = 'wfc.ai.synthetic-follow-up.v1';
    const focused = { ...options, promptVersion: version, includePage: ({ page }) => page === 2,
      inputBuilder: manifest => [...buildInput(manifest), { role: 'user', content: [{ type: 'input_text', text: 'Synthetic follow-up' }] }],
      adapter: { analyze: async request => {
        assert.equal(request.input.at(-1).content[0].text, 'Synthetic follow-up');
        focusCalls++; return reply(request, manifests[1]);
      } } };
    const first = await runAnalysis(focused);
    assert.equal(first.promptVersion, version);
    assert.equal(first.totalPages, 2);
    assert.equal(first.selectedPages, 1);
    assert.equal(first.analyzedPages, 1);
    assert.deepEqual(first.pages.map(p => [p.page,p.status]), [[1,'skipped'],[2,'analyzed']]);
    assert.equal(first.pages[0].cacheKey, null);
    assert.equal(first.requestsUsed, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_analysis_claims').get().n, 3);
    const baseKey = base.pages[1].cacheKey, focusKey = first.pages[1].cacheKey;
    assert.notEqual(baseKey, focusKey);
    assert.equal(values.get(baseKey).promptVersion, PROMPT_VERSION);
    assert.equal(values.get(focusKey).promptVersion, version);
    values.delete(focusKey);
    const replay = await runAnalysis(focused);
    assert.equal(replay.pages[1].source, 'receipt');
    values.get(focusKey).promptVersion = PROMPT_VERSION;
    assert.equal((await runAnalysis(focused)).pages[1].reason, 'ANALYSIS_RECEIPT_INVALID');
    for (const promptVersion of [PROMPT_VERSION, '', 'a'.repeat(129)]) {
      await assert.rejects(runAnalysis({ ...focused, promptVersion }), { code: 'ANALYSIS_CONFIG_INVALID' });
    }
    await assert.rejects(runAnalysis({ ...focused, includePage: () => 'true' }), { code: 'ANALYSIS_CONFIG_INVALID' });
    assert.equal(focusCalls, 1);
  });
});

test('operator automatically resumes a deferred page once within the same budgets', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  await fixture(['P-1 PTC-1'], async ({ options, manifests }) => {
    const sent = [], delays = [];
    const result = await runAnalysis({ ...options, awaitCooldown: true,
      sleepImpl: async ms => { delays.push(ms); t.mock.timers.tick(ms); },
      adapter: { analyze: async request => {
        sent.push(request.requestId);
        if (sent.length === 1) throw Object.assign(new Error('wait'), {
          code: 'OPENAI_RATE_LIMIT', attempts: 1, httpStatus: 429, retryAfterMs: 900000,
        });
        return reply(request, manifests[0]);
      } },
    });
    assert.equal(result.status, 'analyzed');
    assert.equal(result.requestsUsed, 2);
    assert.equal(result.grant.reservedMicroUsd, 0);
    assert.equal(result.usage.totalTokens, 100);
    assert.deepEqual(delays, [900000]);
    assert.equal(new Set(sent).size, 2);
  });
});

test('long transient rejections share the same retry limit across process restarts', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  await fixture(['P-1 PTC-1'], async ({ options }) => {
    let sends = 0, elapsed = 0;
    const job = { ...options, sleepImpl: async ms => { elapsed += ms; t.mock.timers.tick(ms); },
      adapter: { analyze: async () => {
        sends++;
        throw Object.assign(new Error('wait'), { code: 'OPENAI_SERVICE_UNAVAILABLE', httpStatus: 503, attempts: 1, retryAfterMs: 600000 });
      } },
    };
    assert.equal((await runAnalysis(job)).stopReason, 'ANALYSIS_PROVIDER_COOLDOWN');
    const second = await runAnalysis({ ...job, awaitCooldown: true });
    assert.equal(second.stopReason, 'ANALYSIS_RETRY_LIMIT_REACHED');
    assert.equal(elapsed, 600000);
    t.mock.timers.tick(600000);
    const third = await runAnalysis({ ...job, awaitCooldown: true });
    assert.equal(third.stopReason, 'ANALYSIS_RETRY_LIMIT_REACHED');
    assert.equal(third.requestsUsed, 2);
    assert.equal(third.grant.reservedMicroUsd, 0);
    assert.equal(sends, 2);
  });
});
