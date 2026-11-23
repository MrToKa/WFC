import { randomUUID } from 'node:crypto';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_ERROR_BYTES = 16 * 1024;
const rejectionCodes = new Map([
  ['insufficient_quota', 'OPENAI_INSUFFICIENT_QUOTA'],
  ['insufficient_credits', 'OPENAI_CREDIT_EXHAUSTED'],
  ['credit_balance_exhausted', 'OPENAI_CREDIT_EXHAUSTED'],
  ['billing_hard_limit_reached', 'OPENAI_SPEND_LIMIT'],
  ['organization_spend_limit_exceeded', 'OPENAI_SPEND_LIMIT'],
  ['project_spend_limit_exceeded', 'OPENAI_SPEND_LIMIT'],
  ['model_not_found', 'OPENAI_MODEL_UNAVAILABLE'],
  ['unsupported_model', 'OPENAI_MODEL_UNAVAILABLE'],
  ['model_not_supported', 'OPENAI_MODEL_UNAVAILABLE'],
  ['invalid_json_schema', 'OPENAI_SCHEMA_REJECTED'],
]);
const providerCodes = new Set([...rejectionCodes.keys(), 'invalid_api_key', 'invalid_value', 'unsupported_value',
  'unsupported_parameter', 'rate_limit_exceeded', 'invalid_request_error', 'server_error']);
const providerTypes = new Set([...rejectionCodes.keys(), 'invalid_request_error', 'authentication_error',
  'permission_error', 'rate_limit_error', 'tokens', 'requests', 'server_error', 'billing_error']);
const providerParams = new Set(['model', 'input', 'text.format', 'text.format.schema', 'response_format',
  'response_format.json_schema.schema', 'max_output_tokens', 'service_tier', 'reasoning.effort']);
const incompleteReasons = new Set(['max_output_tokens', 'content_filter']);
const reasoningEfforts = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

/** Codes are safe to log. Provider error bodies and credentials are never retained. */
export class OpenAIAdapterError extends Error {
  constructor(code, { attempts = 0, outcomeUnknown = false, requestId = null, providerRequestId = null, httpStatus = null,
    providerCode = null, providerType = null, providerParam = null, incompleteReason = null,
    responseId = null, model = null, usage = null, retryAfterMs = null, rateLimits = null } = {}) {
    super(code);
    this.name = 'OpenAIAdapterError';
    this.code = code;
    this.attempts = attempts;
    this.outcomeUnknown = outcomeUnknown;
    this.requestId = requestId;
    this.providerRequestId = providerRequestId;
    this.httpStatus = httpStatus;
    Object.assign(this, { providerCode, providerType, providerParam, incompleteReason, responseId, model, usage, retryAfterMs, rateLimits });
  }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedInteger = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const safeId = (value, secret) => typeof value === 'string' && ID.test(value) && !value.includes(secret) ? value : null;
const allowed = (value, values, secret) => values.has(value) && !value.includes(secret) ? value : null;

function providerMetadata(error, secret) {
  return { providerCode: allowed(error?.code, providerCodes, secret), providerType: allowed(error?.type, providerTypes, secret),
    providerParam: allowed(error?.param, providerParams, secret) };
}

function rejectionCode(status, metadata) {
  if (status === 401) return 'OPENAI_AUTHENTICATION_FAILED';
  if (status === 403) return 'OPENAI_ACCESS_DENIED';
  if (status >= 500) return status === 503 ? 'OPENAI_SERVICE_UNAVAILABLE' : 'OPENAI_RESPONSE_UNKNOWN';
  const classified = rejectionCodes.get(metadata.providerCode) ?? rejectionCodes.get(metadata.providerType);
  if (classified) return classified;
  if (status === 400 && ['text.format.schema', 'response_format.json_schema.schema'].includes(metadata.providerParam)) return 'OPENAI_SCHEMA_REJECTED';
  return status === 429 ? 'OPENAI_RATE_LIMIT' : 'OPENAI_REQUEST_REJECTED';
}

function cancelBody(response) {
  try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch { /* No response content is logged. */ }
}

function defaultSleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('ABORTED')); return; }
    const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('ABORTED')); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function wait(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error('ABORTED'));
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new Error('ABORTED')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

async function readBounded(response, limit, signal) {
  const declared = response.headers?.get('content-length');
  if (declared !== null && declared !== undefined && /^\d+$/.test(declared) && BigInt(declared) > BigInt(limit)) {
    cancelBody(response);
    throw new OpenAIAdapterError('OPENAI_RESPONSE_TOO_LARGE');
  }
  if (!response.body || typeof response.body.getReader !== 'function') throw new OpenAIAdapterError('OPENAI_RESPONSE_INVALID');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let complete = false;
  try {
    for (;;) {
      const part = await wait(reader.read(), signal);
      if (part.done) { complete = true; break; }
      if (!(part.value instanceof Uint8Array)) throw new OpenAIAdapterError('OPENAI_RESPONSE_INVALID');
      bytes += part.value.byteLength;
      if (bytes > limit) throw new OpenAIAdapterError('OPENAI_RESPONSE_TOO_LARGE');
      chunks.push(part.value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
    catch { throw new OpenAIAdapterError('OPENAI_RESPONSE_INVALID'); }
  } finally {
    if (!complete) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
    try { reader.releaseLock(); } catch {}
  }
}

function validateInput(input, schema) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 256 || !object(schema) || schema.type !== 'object') return false;
  return input.every(message => object(message) && ['system', 'developer', 'user'].includes(message.role)
    && Array.isArray(message.content) && message.content.length > 0 && message.content.length <= 512
    && Object.keys(message).every(key => ['role', 'content'].includes(key))
    && message.content.every(content => object(content) && (content.type === 'input_text'
      ? Object.keys(content).every(key => ['type', 'text'].includes(key)) && typeof content.text === 'string' && content.text.length > 0
      : content.type === 'input_image' && Object.keys(content).every(key => ['type', 'image_url', 'detail'].includes(key))
        && typeof content.image_url === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(content.image_url)
        && (content.detail === undefined || ['auto', 'low', 'high'].includes(content.detail)))));
}

function parseOutput(output) {
  if (!Array.isArray(output)) throw new OpenAIAdapterError('OPENAI_RESPONSE_INVALID');
  const texts = [];
  let messages = 0;
  let incomplete = false;
  for (const item of output) {
    if (!object(item)) throw new OpenAIAdapterError('OPENAI_RESPONSE_INVALID');
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) throw new OpenAIAdapterError('OPENAI_UNEXPECTED_OUTPUT');
    messages++;
    if (item.status !== undefined && item.status !== 'completed') incomplete = true;
    for (const content of item.content) {
      if (content?.type === 'refusal') throw new OpenAIAdapterError('OPENAI_REFUSAL');
      if (content?.type !== 'output_text' || typeof content.text !== 'string') throw new OpenAIAdapterError('OPENAI_UNEXPECTED_OUTPUT');
      texts.push(content.text);
    }
  }
  if (messages > 1 || texts.length > 1) throw new OpenAIAdapterError('OPENAI_MULTIPLE_OUTPUTS');
  if (messages !== 1 || texts.length !== 1 || texts[0].trim() === '') throw new OpenAIAdapterError('OPENAI_OUTPUT_MISSING');
  let analysis;
  try { analysis = JSON.parse(texts[0]); } catch { throw new OpenAIAdapterError('OPENAI_OUTPUT_INVALID'); }
  if (!object(analysis)) throw new OpenAIAdapterError('OPENAI_OUTPUT_INVALID');
  return { analysis, incomplete };
}

function safeUsage(usage) {
  if (!object(usage) || !['input_tokens', 'output_tokens', 'total_tokens'].every(key => boundedInteger(usage[key], 0, 1_000_000_000))
    || usage.total_tokens !== usage.input_tokens + usage.output_tokens) return null;
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens };
}

function parseResponse(body, configuredModel, secret, schema) {
  if (!object(body)) throw new OpenAIAdapterError('OPENAI_RESPONSE_INVALID');
  const value = body.model ?? configuredModel;
  const model = typeof value === 'string' && MODEL.test(value) && !value.includes(secret) ? value : null;
  const metadata = { responseId: safeId(body.id, secret), model, usage: safeUsage(body.usage),
    incompleteReason: allowed(body.incomplete_details?.reason, incompleteReasons, secret), ...providerMetadata(body.error, secret) };
  let output;
  let outputError;
  try { output = parseOutput(body.output); } catch (error) { outputError = error; }
  let code = null;
  if (['incomplete', 'in_progress', 'queued'].includes(body.status)) code = 'OPENAI_RESPONSE_INCOMPLETE';
  else if (body.status !== 'completed') code = 'OPENAI_RESPONSE_FAILED';
  else if (!metadata.responseId || !model) code = 'OPENAI_RESPONSE_INVALID';
  else if (outputError) code = outputError.code;
  else if (output.incomplete) code = 'OPENAI_RESPONSE_INCOMPLETE';
  else if (!metadata.usage) code = 'OPENAI_USAGE_INVALID';
  if (code) {
    const error = new OpenAIAdapterError(code, metadata);
    // Only the separate local quarantine consumer gets parsed candidate data.
    // Normal error serialization contains validated metadata alone.
    if (output && Object.keys(output.analysis).length > 0
      && Object.keys(output.analysis).every(key => Object.hasOwn(schema.properties ?? {}, key))
      && !JSON.stringify(output.analysis).includes(JSON.stringify(secret).slice(1, -1))) {
      Object.defineProperty(error, 'analysis', { value: output.analysis });
    }
    throw error;
  }
  return { analysis: output.analysis, responseId: metadata.responseId, model, usage: metadata.usage };
}

function rateMetadata(response) {
  const boundedDelay = value => Math.min(86_400_000, Math.max(0, Math.ceil(value)));
  const ms = response.headers?.get('retry-after-ms');
  const seconds = response.headers?.get('retry-after');
  const numeric = /^\d{1,12}(?:\.\d{1,9})?$/;
  let retryAfterMs = null;
  if (numeric.test(ms)) retryAfterMs = boundedDelay(Number(ms));
  else if (numeric.test(seconds)) retryAfterMs = boundedDelay(Number(seconds) * 1000);
  else if (typeof seconds === 'string' && /^[A-Z][a-z]{2}, .{19,23} GMT$/.test(seconds)) {
    const timestamp = Date.parse(seconds);
    if (Number.isFinite(timestamp)) retryAfterMs = boundedDelay(timestamp - Date.now());
  }
  const rateLimits = {};
  for (const [field, header] of Object.entries({ requestLimit: 'x-ratelimit-limit-requests', requestsRemaining: 'x-ratelimit-remaining-requests',
    tokenLimit: 'x-ratelimit-limit-tokens', tokensRemaining: 'x-ratelimit-remaining-tokens' })) {
    const value = response.headers?.get(header);
    if (typeof value === 'string' && /^\d{1,12}$/.test(value)) rateLimits[field] = Number(value);
  }
  return { retryAfterMs, rateLimits: Object.keys(rateLimits).length ? rateLimits : null };
}

/** Transport only: engineering evidence and project budgets are validated by the caller. */
export function createOpenAIAdapter({ apiKey, model, fetchImpl = globalThis.fetch, timeoutMs = 30_000,
  maxAttempts = 3, maxResponseBytes = 2_000_000, maxOutputTokens = 8000, reasoningEffort, sleepImpl = defaultSleep,
  baseUrl = 'https://api.openai.com/v1' } = {}) {
  if (!['https://api.openai.com/v1', 'https://api.openai.com/v1/'].includes(baseUrl)) throw new OpenAIAdapterError('OPENAI_ENDPOINT_INVALID');
  if (typeof fetchImpl !== 'function' || typeof sleepImpl !== 'function' || !boundedInteger(timeoutMs, 1, 300_000)
    || !boundedInteger(maxAttempts, 1, 5) || !boundedInteger(maxResponseBytes, 1, 16_000_000)
    || !boundedInteger(maxOutputTokens, 1, 128_000)
    || (reasoningEffort !== undefined && !reasoningEfforts.has(reasoningEffort))) throw new OpenAIAdapterError('OPENAI_CONFIG_INVALID');
  return Object.freeze({
    async analyze({ input, schema, requestId = randomUUID(), signal } = {}) {
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw new OpenAIAdapterError('OPENAI_KEY_REQUIRED');
      if (apiKey !== apiKey.trim() || !/^[\x21-\x7e]{1,4096}$/.test(apiKey)) throw new OpenAIAdapterError('OPENAI_KEY_INVALID');
      if (typeof model !== 'string' || !MODEL.test(model)) throw new OpenAIAdapterError('OPENAI_MODEL_REQUIRED');
      if (!safeId(requestId, apiKey) || !validateInput(input, schema)) throw new OpenAIAdapterError('OPENAI_INPUT_INVALID');
      let payload;
      try {
        payload = JSON.stringify({ model, input, store: false, background: false, tools: [],
          ...(reasoningEffort === undefined ? {} : { reasoning: { effort: reasoningEffort } }),
          max_output_tokens: maxOutputTokens, text: { format: { type: 'json_schema', name: 'wfc_document_analysis', strict: true, schema } } });
      } catch { throw new OpenAIAdapterError('OPENAI_INPUT_INVALID'); }
      if (Buffer.byteLength(payload, 'utf8') > MAX_INPUT_BYTES) throw new OpenAIAdapterError('OPENAI_INPUT_TOO_LARGE');
      if (signal !== undefined && !(signal instanceof AbortSignal)) throw new OpenAIAdapterError('OPENAI_INPUT_INVALID');
      if (signal?.aborted) throw new OpenAIAdapterError('OPENAI_CANCELLED', { requestId });
      const deadline = new AbortController();
      const expiresAt = Date.now() + timeoutMs;
      const timer = setTimeout(() => deadline.abort(), timeoutMs);
      const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
      let attempts = 0;
      let inFlight = false;
      let providerRequestId = null;
      try {
        for (;;) {
          if (combined.aborted) throw new OpenAIAdapterError('OPENAI_CANCELLED');
          attempts++;
          inFlight = true;
          const pending = Promise.resolve().then(() => fetchImpl(ENDPOINT, {
            method: 'POST', redirect: 'error', signal: combined,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': requestId },
            body: payload,
          }));
          // A fetch implementation may ignore AbortSignal; discard any late body.
          pending.then(response => { if (combined.aborted) cancelBody(response); }, () => {});
          const response = await wait(pending, combined);
          if (!response || !boundedInteger(response.status, 100, 599)) throw new OpenAIAdapterError('OPENAI_RESPONSE_INVALID');
          providerRequestId = safeId(response.headers?.get('x-request-id'), apiKey);
          if (response.status >= 200 && response.status < 300) {
            const body = await readBounded(response, maxResponseBytes, combined);
            inFlight = false;
            return { ...parseResponse(body, model, apiKey, schema), requestId, providerRequestId, attempts };
          }
          inFlight = false;
          let errorBody;
          try { errorBody = await readBounded(response, Math.min(maxResponseBytes, MAX_ERROR_BYTES), combined); }
          catch { /* An unreadable error body still has a known HTTP status. */ }
          const metadata = providerMetadata(errorBody?.error, apiKey);
          const code = rejectionCode(response.status, metadata);
          // A gateway/internal error may follow paid provider execution. Only
          // explicit rate/service rejection is eligible for a bounded retry.
          const retryable = code === 'OPENAI_RATE_LIMIT' || code === 'OPENAI_SERVICE_UNAVAILABLE';
          if (response.status === 429 || response.status === 503) Object.assign(metadata, rateMetadata(response));
          const delay = metadata.retryAfterMs ?? Math.min(250 * (2 ** (attempts - 1)), 3000);
          if (retryable && attempts < maxAttempts && !combined.aborted && Date.now() + delay < expiresAt) {
            await wait(Promise.resolve().then(() => sleepImpl(delay, combined)), combined);
            continue;
          }
          throw new OpenAIAdapterError(code, { ...metadata, outcomeUnknown: code === 'OPENAI_RESPONSE_UNKNOWN', httpStatus: response.status });
        }
      } catch (error) {
        if (error instanceof OpenAIAdapterError) {
          Object.assign(error, { attempts, requestId, providerRequestId });
          throw error;
        }
        throw new OpenAIAdapterError(inFlight ? 'OPENAI_RESPONSE_UNKNOWN' : combined.aborted ? 'OPENAI_CANCELLED' : 'OPENAI_REQUEST_FAILED',
          { attempts, requestId, providerRequestId, outcomeUnknown: inFlight });
      } finally { clearTimeout(timer); }
    },
  });
}
