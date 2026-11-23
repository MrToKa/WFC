import { createHash, randomUUID } from 'node:crypto';
import { PROJECT, readCorpus, manifestPages } from './corpus.mjs';
import { analysisCacheKey, validateAnalysis, ANALYSIS_SCHEMA } from './evidence.mjs';
import { PROMPT_VERSION, buildInput } from './diagram.mjs';

const SCHEMA_VERSION = 'wfc.ai.document-analysis.v1';
const RECEIPT_VERSION = 'wfc.ai.analysis-receipt.v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const integer = (n, max = 1_000_000_000) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const safeCode = (error, fallback) => typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code) ? error.code : fallback;
const knownRejections = new Set(['OPENAI_AUTHENTICATION_FAILED', 'OPENAI_ACCESS_DENIED', 'OPENAI_RATE_LIMIT', 'OPENAI_SERVICE_UNAVAILABLE', 'OPENAI_REQUEST_REJECTED',
  'OPENAI_CREDIT_EXHAUSTED', 'OPENAI_INSUFFICIENT_QUOTA', 'OPENAI_SPEND_LIMIT', 'OPENAI_MODEL_UNAVAILABLE', 'OPENAI_SCHEMA_REJECTED']);
const beforeDispatch = new Set(['OPENAI_KEY_REQUIRED', 'OPENAI_KEY_INVALID', 'OPENAI_MODEL_REQUIRED', 'OPENAI_INPUT_INVALID', 'OPENAI_INPUT_TOO_LARGE', 'OPENAI_CONFIG_INVALID', 'OPENAI_ENDPOINT_INVALID', 'OPENAI_CANCELLED']);

const GRANT_LIMIT_MICRO_USD = 70_000_000;
const MAX_INLINE_RETRY_MS = 120_000;
const MAX_TRANSIENT_REJECTIONS = 2;
const TERRA_MODEL = 'gpt-6.1-terra';
// The production adapter is pinned to Terra. Reserve its full 922k input window at
// $5/M (including long context and cache writes) plus 12k output at $7.50/M:
// $4.70 per dispatched attempt. Use integer microdollars rounded up on settlement.
const terraCharge = (inputTokens, outputTokens) => Math.ceil(5 * inputTokens + 7.5 * outputTokens);
const worstCharge = maxOutputTokens => terraCharge(922_000, maxOutputTokens);
const pricedModel = model => model === TERRA_MODEL || model === 'synthetic-model';

function init(db) {
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS ai_analysis_budgets (
      id TEXT PRIMARY KEY, corpus_id TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
      max_requests INTEGER NOT NULL, max_output_tokens INTEGER NOT NULL, requests_used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ai_analysis_claims (
      cache_key TEXT PRIMARY KEY, state TEXT NOT NULL, attempt_id TEXT,
      receipt TEXT, receipt_sha256 TEXT, reason TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_analysis_attempts (
      id TEXT PRIMARY KEY, budget_id TEXT NOT NULL, cache_key TEXT NOT NULL, request_id TEXT NOT NULL,
      state TEXT NOT NULL, provider_attempts INTEGER NOT NULL DEFAULT 1,
      response_id TEXT, provider_request_id TEXT, http_status INTEGER, retry_at_ms INTEGER, input_tokens INTEGER, output_tokens INTEGER,
      total_tokens INTEGER, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_analysis_quarantine (
      attempt_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, page INTEGER NOT NULL, document_sha256 TEXT NOT NULL,
      payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL);`);
  transaction(db, () => {
    const columns = new Set(db.prepare('PRAGMA table_info(ai_analysis_attempts)').all().map(column => column.name));
    if (!columns.has('http_status')) db.exec('ALTER TABLE ai_analysis_attempts ADD COLUMN http_status INTEGER');
    if (!columns.has('retry_at_ms')) db.exec('ALTER TABLE ai_analysis_attempts ADD COLUMN retry_at_ms INTEGER');
  });
}

function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function validUsage(value) {
  return value && integer(value.inputTokens) && integer(value.outputTokens) && integer(value.totalTokens)
    && value.totalTokens === value.inputTokens + value.outputTokens;
}

// All corpora accepted by this store belong to PROJECT. Count the persisted
// attempts across every corpus, model and prompt; a fresh version gets no new grant.
// Include historical rows created before the spend guard existed.
function grantExposure(db) {
  const rows = db.prepare(`SELECT a.state,a.provider_attempts,a.input_tokens,a.output_tokens,a.total_tokens,
    a.reason,b.model,b.max_output_tokens FROM ai_analysis_attempts a LEFT JOIN ai_analysis_budgets b ON b.id=a.budget_id`);
  const grant = { ceilingMicroUsd: GRANT_LIMIT_MICRO_USD, meteredUpperMicroUsd: 0, reservedMicroUsd: 0, unreportedRequests: 0 };
  for (const row of rows.iterate()) {
    if (row.provider_attempts === 0) continue;
    const knownUsage = validUsage({ inputTokens: row.input_tokens, outputTokens: row.output_tokens, totalTokens: row.total_tokens });
    const rejected = row.state === 'rejected' && knownRejections.has(row.reason);
    if (!knownUsage && rejected && row.provider_attempts === 1) continue;
    // Freeze new sends if an older potentially billable model cannot be priced.
    if (!pricedModel(row.model) || !integer(row.max_output_tokens, 128000) || row.max_output_tokens < 1) {
      grant.reservedMicroUsd += GRANT_LIMIT_MICRO_USD;
      grant.unreportedRequests += row.provider_attempts;
      continue;
    }
    const reservation = worstCharge(row.max_output_tokens);
    // If a misconfigured adapter made multiple sends, its receipt covers only the final one.
    const unreported = row.provider_attempts - (knownUsage || rejected ? 1 : 0);
    grant.unreportedRequests += unreported;
    grant.reservedMicroUsd += unreported * reservation;
    if (knownUsage) grant.meteredUpperMicroUsd += terraCharge(row.input_tokens, row.output_tokens);
  }
  return grant;
}

function validateReceipt(receipt, key, model, promptVersion, manifest) {
  if (!receipt || receipt.schemaVersion !== RECEIPT_VERSION || receipt.cacheKey !== key || receipt.model !== model
    || receipt.promptVersion !== promptVersion || receipt.analysisSchemaVersion !== SCHEMA_VERSION || !validUsage(receipt.usage)
    || typeof receipt.responseId !== 'string' || !receipt.responseId || typeof receipt.requestId !== 'string' || !receipt.requestId) fail('ANALYSIS_RECEIPT_INVALID');
  validateAnalysis(receipt.analysis, manifest);
  return receipt;
}

function completedFromDb(row, key, model, promptVersion, manifest) {
  if (!row.receipt || hash(row.receipt) !== row.receipt_sha256) fail('ANALYSIS_RECEIPT_CORRUPT');
  let value;
  try { value = JSON.parse(row.receipt); } catch { fail('ANALYSIS_RECEIPT_CORRUPT'); }
  return validateReceipt(value, key, model, promptVersion, manifest);
}

function resultFromReceipt(receipt, identity, source) {
  const unreadable = receipt.analysis.coverage.some(page => page.status !== 'analyzed');
  return { ...identity, status: unreadable ? 'unreadable' : 'analyzed',
    ...(unreadable ? { reason: 'ANALYSIS_UNREADABLE_PAGE' } : {}), source,
    entities: receipt.analysis.entities.length, relations: receipt.analysis.relations.length,
    unresolvedCount: receipt.analysis.unresolved.length,
    uncertainRelations: receipt.analysis.relations.filter(relation => relation.status !== 'supported').length };
}

function admit(db, budgetId, key, maxRequests) {
  return transaction(db, () => {
    const claim = db.prepare('SELECT * FROM ai_analysis_claims WHERE cache_key=?').get(key);
    if (claim && claim.state !== 'rejected') return { claim };
    const transientRejections = db.prepare(`SELECT COUNT(*) count FROM ai_analysis_attempts
      WHERE cache_key=? AND state='rejected' AND ((http_status=429 AND reason='OPENAI_RATE_LIMIT')
        OR (http_status=503 AND reason='OPENAI_SERVICE_UNAVAILABLE'))`).get(key).count;
    if (transientRejections >= MAX_TRANSIENT_REJECTIONS) return { reason: 'ANALYSIS_RETRY_LIMIT_REACHED' };
    const budget = db.prepare('SELECT * FROM ai_analysis_budgets WHERE id=?').get(budgetId);
    const cooldown = db.prepare(`SELECT MAX(a.retry_at_ms) until_ms FROM ai_analysis_attempts a
      JOIN ai_analysis_budgets b ON b.id=a.budget_id WHERE b.model=? AND a.retry_at_ms>?`).get(budget.model, Date.now());
    if (cooldown.until_ms) return { reason: 'ANALYSIS_PROVIDER_COOLDOWN', retryAtMs: cooldown.until_ms };
    if (budget.requests_used >= Math.min(maxRequests, budget.max_requests)) return { reason: 'ANALYSIS_REQUEST_BUDGET_EXHAUSTED' };
    if (!pricedModel(budget.model)) return { reason: 'ANALYSIS_MODEL_PRICING_UNKNOWN' };
    const grant = grantExposure(db);
    if (grant.meteredUpperMicroUsd + grant.reservedMicroUsd + worstCharge(budget.max_output_tokens) > GRANT_LIMIT_MICRO_USD) return { reason: 'ANALYSIS_GRANT_BUDGET_EXHAUSTED' };
    const id = randomUUID(), requestId = randomUUID(), now = new Date().toISOString();
    db.prepare('UPDATE ai_analysis_budgets SET requests_used=requests_used+1 WHERE id=?').run(budgetId);
    db.prepare(`INSERT INTO ai_analysis_attempts (id,budget_id,cache_key,request_id,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(id, budgetId, key, requestId, 'reserved', now, now);
    db.prepare(`INSERT INTO ai_analysis_claims (cache_key,state,attempt_id,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET state=excluded.state,attempt_id=excluded.attempt_id,
      receipt=NULL,receipt_sha256=NULL,reason=NULL,updated_at=excluded.updated_at`).run(key, 'reserved', id, now);
    return { id, requestId, transientRejections };
  });
}

function dispatched(db, key, attempt) {
  transaction(db, () => {
    const now = new Date().toISOString();
    const changed = db.prepare(`UPDATE ai_analysis_claims SET state='dispatched',updated_at=?
      WHERE cache_key=? AND attempt_id=? AND state='reserved'`).run(now, key, attempt.id).changes;
    if (changed !== 1) fail('ANALYSIS_CLAIM_CHANGED');
    db.prepare(`UPDATE ai_analysis_attempts SET state='dispatched',updated_at=? WHERE id=?`).run(now, attempt.id);
  });
}

function settle(db, key, attempt, { state, reason = null, response, receipt, release = false, manifest, retryAtMs = null }) {
  transaction(db, () => {
    const claim = db.prepare('SELECT attempt_id FROM ai_analysis_claims WHERE cache_key=?').get(key);
    if (claim?.attempt_id !== attempt.id) fail('ANALYSIS_CLAIM_CHANGED');
    const usage = validUsage(response?.usage) ? response.usage : null;
    const providerAttempts = integer(response?.attempts, 5) && response.attempts > 0 ? response.attempts : release ? 0 : 1;
    const previous = db.prepare('SELECT budget_id,provider_attempts FROM ai_analysis_attempts WHERE id=?').get(attempt.id);
    db.prepare('UPDATE ai_analysis_budgets SET requests_used=requests_used+? WHERE id=?')
      .run(providerAttempts - previous.provider_attempts, previous.budget_id);
    const raw = receipt ? JSON.stringify(receipt) : null;
    const now = new Date().toISOString();
    db.prepare(`UPDATE ai_analysis_attempts SET state=?,provider_attempts=?,response_id=?,provider_request_id=?,http_status=?,retry_at_ms=?,
      input_tokens=?,output_tokens=?,total_tokens=?,reason=?,updated_at=? WHERE id=?`).run(state, providerAttempts,
      typeof response?.responseId === 'string' ? response.responseId : null,
      typeof response?.providerRequestId === 'string' ? response.providerRequestId : null,
      integer(response?.httpStatus, 599) && response.httpStatus >= 100 ? response.httpStatus : null, retryAtMs,
      usage?.inputTokens ?? null, usage?.outputTokens ?? null, usage?.totalTokens ?? null, reason, now, attempt.id);
    if (state === 'blocked' && manifest && response?.analysis !== undefined) {
      // The adapter only supplies parsed semantic output, never headers or the raw HTTP body.
      // Link it to the exact source and the attempt's metering; claims and cache never consume it.
      const doc = manifest.documents[0];
      const payload = JSON.stringify(response.analysis);
      db.prepare(`INSERT INTO ai_analysis_quarantine (attempt_id,document_id,page,document_sha256,payload,payload_sha256)
        VALUES (?,?,?,?,?,?)`).run(attempt.id, doc.id, doc.pages[0].page, doc.sha256, payload, hash(payload));
    }
    db.prepare(`UPDATE ai_analysis_claims SET state=?,receipt=?,receipt_sha256=?,reason=?,updated_at=?
      WHERE cache_key=? AND attempt_id=?`).run(state, raw, raw ? hash(raw) : null, reason, now, key, attempt.id);
  });
}

function validateIndex(index) {
  if (index?.projectId !== PROJECT || !Array.isArray(index.documents) || !index.documents.length || index.documents.length > 256) fail('CORPUS_INDEX_INVALID');
  const names = new Set(); let pages = 0;
  for (const doc of index.documents) {
    if (typeof doc.id !== 'string' || !doc.id || names.has(doc.id) || !/^[a-f0-9]{64}$/.test(doc.sha256)
      || !Array.isArray(doc.pages) || !doc.pages.length || doc.pages.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) fail('CORPUS_INDEX_INVALID');
    names.add(doc.id); pages += doc.pages.length;
  }
  if (pages > 4096) fail('CORPUS_INDEX_INVALID');
  return pages;
}

/**
 * Calls a single-attempt adapter. The CLI must configure maxAttempts:1 and the
 * same maxOutputTokens. SQLite and cache belong to one shared persistent volume.
 * A dispatched claim has no expiry: a crash cannot prove no provider charge.
 */
export async function runAnalysis({ db, corpusId, model, cache, adapter, maxRequests = 180, maxOutputTokens = 12000, concurrency = 1,
  promptVersion = PROMPT_VERSION, inputBuilder = buildInput, includePage = () => true, awaitCooldown = false,
  sleepImpl = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(model)
    || !integer(maxRequests, 4096) || maxRequests < 1 || !integer(maxOutputTokens, 128000) || maxOutputTokens < 1
    || typeof cache?.get !== 'function' || typeof cache?.put !== 'function' || typeof adapter?.analyze !== 'function'
    || !integer(concurrency, 3) || concurrency < 1 || typeof sleepImpl !== 'function' || typeof awaitCooldown !== 'boolean'
    || typeof promptVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(promptVersion)
    || typeof includePage !== 'function' || typeof inputBuilder !== 'function'
    || (inputBuilder !== buildInput && promptVersion === PROMPT_VERSION)) fail('ANALYSIS_CONFIG_INVALID');
  const index = readCorpus(db, corpusId), totalPages = validateIndex(index);
  const selection = new Map();
  let selectedPages = 0;
  for (const doc of index.documents) {
    const selected = doc.pages.map((_, i) => {
      const include = includePage({ documentId: doc.id, page: i + 1 });
      if (typeof include !== 'boolean') fail('ANALYSIS_CONFIG_INVALID');
      if (include) selectedPages++;
      return include;
    });
    selection.set(doc.id, selected);
  }
  init(db);
  const budgetId = hash(JSON.stringify({ corpusId, model, promptVersion, schemaVersion: SCHEMA_VERSION }));
  db.prepare(`INSERT OR IGNORE INTO ai_analysis_budgets (id,corpus_id,model,prompt_version,max_requests,max_output_tokens)
    VALUES (?,?,?,?,?,?)`).run(budgetId, corpusId, model, promptVersion, maxRequests, maxOutputTokens);
  const budget = db.prepare('SELECT * FROM ai_analysis_budgets WHERE id=?').get(budgetId);
  const outputLimit = Math.min(maxOutputTokens, budget.max_output_tokens);
  // Raising the output limit after restart would invalidate the admitted cap.
  if (outputLimit !== maxOutputTokens) fail('ANALYSIS_OUTPUT_BUDGET_CHANGED');
  const pages = [];
  let cacheHits = 0, stopReason = null, retryAtMs = 0;

  async function pageAnalysis(manifest, identity) {
    const key = analysisCacheKey({ manifest, model, promptVersion, schemaVersion: SCHEMA_VERSION, parserVersion: index.prepVersion });
    identity = { ...identity, cacheKey: key };
    const claim = db.prepare('SELECT * FROM ai_analysis_claims WHERE cache_key=?').get(key);
    let cached;
    try { cached = await cache.get(key); }
    catch (error) { return { ...identity, status: 'cache-error', reason: safeCode(error, 'ANALYSIS_CACHE_UNAVAILABLE') }; }
    if (cached !== null && cached !== undefined) {
      try { validateReceipt(cached, key, model, promptVersion, manifest); }
      catch (error) { return { ...identity, status: 'invalid', reason: safeCode(error, 'ANALYSIS_CACHE_INVALID') }; }
      cacheHits++;
      return resultFromReceipt(cached, identity, 'cache');
    }
    if (claim?.state === 'complete') {
      try {
        const receipt = completedFromDb(claim, key, model, promptVersion, manifest);
        await cache.put(key, receipt);
        cacheHits++;
        return resultFromReceipt(receipt, identity, 'receipt');
      } catch (error) { return { ...identity, status: 'cache-error', reason: safeCode(error, 'ANALYSIS_RECEIPT_RECOVERY_FAILED') }; }
    }
    if (claim && claim.state !== 'rejected') {
      if (['OPENAI_RESPONSE_UNKNOWN', 'ANALYSIS_PROVIDER_OUTCOME_UNKNOWN'].includes(claim.reason)) stopReason = claim.reason;
      return { ...identity, status: 'blocked', reason: claim.reason ?? 'ANALYSIS_PRIOR_OUTCOME_PENDING' };
    }
    if (stopReason) return { ...identity, status: 'not-requested', reason: stopReason };
    async function resumeAfter(deadline) {
      try { await sleepImpl(Math.max(0, deadline - Date.now())); }
      catch { stopReason = 'ANALYSIS_RETRY_INTERRUPTED'; return { ...identity, status: 'not-requested', reason: stopReason }; }
      // Recheck the current claim, shared cooldown, remaining requests and grant before sending.
      return pageAnalysis(manifest, identity);
    }
    const page = manifest.documents[0]?.pages[0];
    if (!page || (!page.text.trim() && !page.imageDataUrl)) return { ...identity, status: 'unreadable', reason: 'ANALYSIS_PAGE_SOURCE_EMPTY' };
    let input;
    try { input = inputBuilder(manifest); }
    catch (error) { return { ...identity, status: 'invalid', reason: safeCode(error, 'ANALYSIS_INPUT_INVALID') }; }
    const attempt = admit(db, budgetId, key, maxRequests);
    if (attempt.claim) return { ...identity, status: 'blocked', reason: attempt.claim.reason ?? 'ANALYSIS_PRIOR_OUTCOME_PENDING' };
    if (attempt.retryAtMs && awaitCooldown) return resumeAfter(attempt.retryAtMs);
    if (attempt.reason) {
      stopReason ??= attempt.reason;
      if (attempt.retryAtMs) retryAtMs = Math.max(retryAtMs, attempt.retryAtMs);
      return { ...identity, status: 'not-requested', reason: attempt.reason };
    }
    dispatched(db, key, attempt);
    let response;
    try {
      response = await adapter.analyze({ input, schema: ANALYSIS_SCHEMA, requestId: attempt.requestId });
    } catch (error) {
      const reason = safeCode(error, 'ANALYSIS_PROVIDER_OUTCOME_UNKNOWN');
      const hasResponseOutput = error?.analysis !== undefined || validUsage(error?.usage) && error.usage.totalTokens > 0;
      const noDispatch = !hasResponseOutput && beforeDispatch.has(reason) && !error?.outcomeUnknown && (error?.attempts === undefined || error.attempts === 0);
      const rejected = noDispatch || !hasResponseOutput && knownRejections.has(reason) && !error?.outcomeUnknown;
      const transientRejection = rejected && ((reason === 'OPENAI_RATE_LIMIT' && error.httpStatus === 429)
        || (reason === 'OPENAI_SERVICE_UNAVAILABLE' && error.httpStatus === 503));
      const retryDelayMs = Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0
        ? Math.ceil(error.retryAfterMs) : error?.httpStatus === 429 ? 10000 : 250;
      const deferredUntil = transientRejection && retryDelayMs > MAX_INLINE_RETRY_MS ? Date.now() + retryDelayMs : null;
      settle(db, key, attempt, { state: rejected ? 'rejected' : 'blocked', reason, release: noDispatch, manifest, retryAtMs: deferredUntil,
        response: { attempts: noDispatch ? 0 : error?.attempts, providerRequestId: error?.providerRequestId,
          httpStatus: error?.httpStatus, usage: error?.usage, responseId: error?.responseId, analysis: error?.analysis } });
      if (transientRejection && attempt.transientRejections + 1 >= MAX_TRANSIENT_REJECTIONS) {
        stopReason = 'ANALYSIS_RETRY_LIMIT_REACHED';
        return { ...identity, status: 'rejected', reason };
      }
      if (deferredUntil && awaitCooldown) return resumeAfter(deferredUntil);
      if (deferredUntil) {
        retryAtMs = Math.max(retryAtMs, deferredUntil);
        stopReason = 'ANALYSIS_PROVIDER_COOLDOWN';
        return { ...identity, status: 'deferred', reason };
      }
      if (transientRejection) {
        try { await sleepImpl(retryDelayMs); }
        catch { stopReason = 'ANALYSIS_RETRY_INTERRUPTED'; return { ...identity, status: 'not-requested', reason: stopReason }; }
        // A fresh durable admission and a fresh request ID precede each send.
        return pageAnalysis(manifest, identity);
      }
      if (rejected || error?.outcomeUnknown || reason === 'ANALYSIS_PROVIDER_OUTCOME_UNKNOWN') stopReason = reason;
      return { ...identity, status: rejected ? 'rejected' : 'blocked', reason };
    }
    let receipt;
    try {
      if (!validUsage(response?.usage)) fail('ANALYSIS_USAGE_INVALID');
      if (response.attempts !== 1) fail('ANALYSIS_ADAPTER_RETRY_CONFIGURATION');
      if (response.usage.outputTokens > outputLimit) fail('ANALYSIS_OUTPUT_LIMIT_EXCEEDED');
      if (response.requestId !== attempt.requestId || typeof response.responseId !== 'string' || !response.responseId
        || typeof response.model !== 'string' || !response.model) fail('ANALYSIS_RESPONSE_PROVENANCE_INVALID');
      validateAnalysis(response.analysis, manifest);
      receipt = { schemaVersion: RECEIPT_VERSION, cacheKey: key, model, resolvedModel: response.model,
        promptVersion, analysisSchemaVersion: SCHEMA_VERSION, analysis: response.analysis,
        usage: response.usage, responseId: response.responseId, requestId: response.requestId,
        providerRequestId: response.providerRequestId ?? null };
    } catch (error) {
      const reason = safeCode(error, 'ANALYSIS_RESULT_INVALID');
      settle(db, key, attempt, { state: 'blocked', reason, response, manifest });
      if (['ANALYSIS_ADAPTER_RETRY_CONFIGURATION', 'ANALYSIS_OUTPUT_LIMIT_EXCEEDED'].includes(reason)) stopReason = reason;
      return { ...identity, status: 'invalid', reason };
    }
    // The durable receipt precedes cache publication. Restart can finish this
    // local step without another paid call after a crash or cache write failure.
    settle(db, key, attempt, { state: 'complete', response, receipt });
    try { await cache.put(key, receipt); }
    catch (error) { return { ...identity, status: 'cache-error', reason: safeCode(error, 'ANALYSIS_CACHE_PUBLICATION_FAILED') }; }
    return resultFromReceipt(receipt, identity, 'provider');
  }

  function* sourcePages() {
    for (const doc of index.documents) {
      const iterator = manifestPages(db, { ...index, documents: [doc] });
      const selected = selection.get(doc.id), lastSelected = selected.lastIndexOf(true);
      let sourceError = null;
      for (let i = 0; i < doc.pages.length; i++) {
        const identity = { documentId: doc.id, page: i + 1, cacheKey: null };
        let manifest;
        if (!sourceError && i <= lastSelected) {
          try {
            const next = iterator.next();
            if (next.done) fail('CORPUS_DOCUMENT_PARTIAL');
            manifest = next.value;
            if (manifest.documents.length !== 1 || manifest.documents[0].id !== doc.id
              || manifest.documents[0].pages.length !== 1 || manifest.documents[0].pages[0].page !== i + 1) fail('CORPUS_PAGE_ORDER_INVALID');
          } catch (error) { sourceError = safeCode(error, 'CORPUS_DOCUMENT_PARTIAL'); }
        }
        if (!selected[i]) yield { result: { ...identity, status: 'skipped' } };
        else if (sourceError) yield { result: { ...identity, status: 'invalid-source', reason: sourceError } };
        else yield { manifest, identity };
      }
    }
  }
  const work = sourcePages();
  let nextIndex = 0;
  async function worker() {
    for (const item of work) {
      const position = nextIndex++;
      pages[position] = item.result ?? await pageAnalysis(item.manifest, item.identity);
    }
  }
  const workers = await Promise.allSettled(Array.from({ length: Math.min(concurrency, totalPages) }, worker));
  for (const workerResult of workers) if (workerResult.status === 'rejected') throw workerResult.reason;
  const actualBudget = db.prepare('SELECT * FROM ai_analysis_budgets WHERE id=?').get(budgetId);
  const usage = db.prepare(`SELECT COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens,
    COALESCE(SUM(total_tokens),0) totalTokens,
    COALESCE(SUM(provider_attempts - CASE WHEN total_tokens IS NOT NULL
      OR (state='rejected' AND reason IN (${[...knownRejections].map(() => '?').join(',')})) THEN MIN(provider_attempts,1) ELSE 0 END),0) unreportedRequests
    FROM ai_analysis_attempts WHERE budget_id=?`).get(...knownRejections, budgetId);
  const analyzedPages = pages.filter(page => page.status === 'analyzed').length;
  return { corpusId, model, promptVersion, status: analyzedPages === totalPages ? 'analyzed' : 'incomplete',
    totalPages, selectedPages, analyzedPages, cacheHits, grant: grantExposure(db),
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens },
    usageScope: 'corpus-model-prompt-lifetime', usageComplete: usage.unreportedRequests === 0,
    unreportedRequests: usage.unreportedRequests, requestsUsed: actualBudget.requests_used,
    maxRequests: Math.min(maxRequests, actualBudget.max_requests), maxOutputTokens: outputLimit,
    ...(stopReason ? { stopReason } : {}), ...(retryAtMs ? { retryAt: new Date(retryAtMs).toISOString() } : {}), pages };
}
