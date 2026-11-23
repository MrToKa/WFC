import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIAdapter, OpenAIAdapterError } from '../lib/openai.mjs';

const key = 'sk-local-test-never-a-real-key';
const input = [{ role: 'developer', content: [{ type: 'input_text', text: 'Return document evidence as JSON.' }] },
  { role: 'user', content: [{ type: 'input_text', text: 'SYNTHETIC DOCUMENT: PTC is associated with pump P-1.' }] }];
const schema = { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } }, required: ['tags'], additionalProperties: false };
const request = () => ({ input, schema, requestId: 'synthetic-request-1' });
const body = (overrides = {}) => ({ id: 'resp_synthetic', status: 'completed', model: 'configured-test-model',
  output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify({ tags: ['P-1'] }) }] }],
  usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 }, ...overrides });
const response = (value = body(), options = {}) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_synthetic' }, ...options });
const adapter = (fetchImpl, options = {}) => createOpenAIAdapter({ apiKey: key, model: 'configured-test-model', fetchImpl, sleepImpl: async () => {}, ...options });
const isCode = expected => error => {
  assert.ok(error instanceof OpenAIAdapterError);
  assert.equal(error.code, expected);
  assert.equal(error.message, expected);
  assert.equal(JSON.stringify(error).includes(key), false);
  return true;
};

test('uses official Responses structured output contract and returns safe provenance/usage', async () => {
  const result = await adapter(async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.headers['X-Client-Request-Id'], 'synthetic-request-1');
    const wire = JSON.parse(options.body);
    assert.equal(wire.store, false);
    assert.equal(wire.background, false);
    assert.deepEqual(wire.tools, []);
    assert.deepEqual(wire.input, input);
    assert.equal(Object.hasOwn(wire, 'reasoning'), false);
    assert.deepEqual(wire.text.format, { type: 'json_schema', name: 'wfc_document_analysis', strict: true, schema });
    return response();
  }).analyze(request());
  assert.deepEqual(result, { analysis: { tags: ['P-1'] }, responseId: 'resp_synthetic', requestId: 'synthetic-request-1',
    providerRequestId: 'req_synthetic', attempts: 1, model: 'configured-test-model',
    usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 } });
});

test('optional reasoning effort uses the documented Responses field and rejects unsupported values locally', async () => {
  for (const reasoningEffort of ['none', 'low', 'medium', 'high', 'xhigh', 'max']) {
    const client = adapter(async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body).reasoning, { effort: reasoningEffort });
      return response();
    }, { reasoningEffort });
    await client.analyze(request());
  }
  for (const reasoningEffort of ['minimal', 'ultra', '', null, 1, { effort: 'low' }]) {
    assert.throws(() => adapter(() => assert.fail('Unexpected dispatch'), { reasoningEffort }), isCode('OPENAI_CONFIG_INVALID'));
  }
});

test('missing key/model and invalid configuration fail before network', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(); };
  await assert.rejects(createOpenAIAdapter({ fetchImpl }).analyze(request()), isCode('OPENAI_KEY_REQUIRED'));
  await assert.rejects(createOpenAIAdapter({ apiKey: key, fetchImpl }).analyze(request()), isCode('OPENAI_MODEL_REQUIRED'));
  await assert.rejects(createOpenAIAdapter({ apiKey: `${key}\n`, model: 'test', fetchImpl }).analyze(request()), isCode('OPENAI_KEY_INVALID'));
  assert.throws(() => createOpenAIAdapter({ baseUrl: 'https://other.invalid/v1', fetchImpl }), isCode('OPENAI_ENDPOINT_INVALID'));
  assert.throws(() => createOpenAIAdapter({ timeoutMs: 0, fetchImpl }), isCode('OPENAI_CONFIG_INVALID'));
  assert.equal(calls, 0);
});

test('allows inline page images but refuses remote image fetching and extra input fields', async () => {
  let calls = 0;
  const client = adapter(async () => { calls++; return response(); });
  const imageInput = [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'high' }] }];
  await client.analyze({ ...request(), input: imageInput });
  await assert.rejects(client.analyze({ ...request(), input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://example.invalid/customer.png' }] }] }), isCode('OPENAI_INPUT_INVALID'));
  await assert.rejects(client.analyze({ ...request(), input: [{ ...input[0], tools: ['execute'] }] }), isCode('OPENAI_INPUT_INVALID'));
  assert.equal(calls, 1);
});

test('refusal and incomplete results cannot be treated as analysis', async () => {
  await assert.rejects(adapter(async () => response(body({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: `do not leak ${key}` }] }] }))).analyze(request()), isCode('OPENAI_REFUSAL'));
  await assert.rejects(adapter(async () => response(body({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))).analyze(request()), isCode('OPENAI_RESPONSE_INCOMPLETE'));
  await assert.rejects(adapter(async () => response(body({ status: 'failed', error: { message: key } }))).analyze(request()), isCode('OPENAI_RESPONSE_FAILED'));
});

test('missing, multiple, non-JSON, array and tool outputs are rejected', async () => {
  const cases = [
    [body({ output: [] }), 'OPENAI_OUTPUT_MISSING'],
    [body({ output: [body().output[1], body().output[1]] }), 'OPENAI_MULTIPLE_OUTPUTS'],
    [body({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{}' }, { type: 'output_text', text: '{}' }] }] }), 'OPENAI_MULTIPLE_OUTPUTS'],
    [body({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: key }] }] }), 'OPENAI_OUTPUT_INVALID'],
    [body({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '[]' }] }] }), 'OPENAI_OUTPUT_INVALID'],
    [body({ output: [{ type: 'function_call', name: 'assign_endpoint', arguments: '{}' }] }), 'OPENAI_UNEXPECTED_OUTPUT'],
  ];
  for (const [value, code] of cases) await assert.rejects(adapter(async () => response(value)).analyze(request()), isCode(code));
});

test('invalid usage is rejected so budget accounting cannot silently undercount', async () => {
  for (const usage of [null, { input_tokens: -1, output_tokens: 2, total_tokens: 1 },
    { input_tokens: 1, output_tokens: 2, total_tokens: 4 }, { input_tokens: 1.5, output_tokens: 2, total_tokens: 3.5 },
    { input_tokens: 1, output_tokens: 2 }]) {
    await assert.rejects(adapter(async () => response(body({ usage }))).analyze(request()), isCode('OPENAI_USAGE_INVALID'));
  }
});

test('401 is not retried and hostile provider errors are discarded', async () => {
  let calls = 0;
  const client = adapter(async () => { calls++; return response({ error: { message: `credentials ${key}` } }, { status: 401 }); });
  await assert.rejects(client.analyze(request()), error => { isCode('OPENAI_AUTHENTICATION_FAILED')(error); assert.equal(error.attempts, 1); assert.equal(error.httpStatus, 401); return true; });
  assert.equal(calls, 1);
});

test('known 429/transient failures retry only within the configured attempt bound', async () => {
  let calls = 0;
  const delays = [];
  const client = adapter(async () => {
    calls++;
    return calls < 3 ? response({ error: 'rate' }, { status: calls === 1 ? 429 : 503, headers: { 'retry-after': '2.75' } }) : response();
  }, { sleepImpl: async milliseconds => { delays.push(milliseconds); } });
  assert.equal((await client.analyze(request())).attempts, 3);
  assert.deepEqual(delays, [2750, 2750]);
  calls = 0;
  await assert.rejects(adapter(async () => { calls++; return response({}, { status: 429 }); }, { maxAttempts: 2 }).analyze(request()), isCode('OPENAI_RATE_LIMIT'));
  assert.equal(calls, 2);
});

test('classifies only known billing, model and schema rejections without resending', async () => {
  for (const [status, detail, expected] of [
    [429, { code: 'insufficient_quota', type: 'insufficient_quota' }, 'OPENAI_INSUFFICIENT_QUOTA'],
    [429, { type: 'credit_balance_exhausted' }, 'OPENAI_CREDIT_EXHAUSTED'],
    [429, { code: 'billing_hard_limit_reached' }, 'OPENAI_SPEND_LIMIT'],
    [404, { code: 'model_not_found', param: 'model' }, 'OPENAI_MODEL_UNAVAILABLE'],
    [400, { code: 'invalid_json_schema', param: 'text.format.schema' }, 'OPENAI_SCHEMA_REJECTED'],
    [400, { code: 'invalid_value', param: 'text.format.schema' }, 'OPENAI_SCHEMA_REJECTED'],
    [400, { code: key, type: 'customer-tag', param: 'customer.file.name' }, 'OPENAI_REQUEST_REJECTED'],
  ]) {
    let calls = 0;
    await assert.rejects(adapter(async () => {
      calls++;
      return response({ error: { ...detail, message: key } }, { status });
    }).analyze(request()), error => {
      isCode(expected)(error);
      assert.equal(error.httpStatus, status);
      assert.equal(error.providerCode, detail.code === key ? null : detail.code ?? null);
      assert.equal(error.providerType, detail.type === 'customer-tag' ? null : detail.type ?? null);
      assert.equal(error.providerParam, detail.param === 'customer.file.name' ? null : detail.param ?? null);
      assert.equal(error.analysis, undefined);
      assert.equal(error.outcomeUnknown, false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('keeps only validated usage, safe diagnostics and a nonenumerable parsed candidate on paid failures', async () => {
  for (const [value, code, candidate] of [
    [body({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), 'OPENAI_RESPONSE_INCOMPLETE', { tags: ['P-1'] }],
    [body({ usage: {} }), 'OPENAI_USAGE_INVALID', { tags: ['P-1'] }],
    [body({ id: key }), 'OPENAI_RESPONSE_INVALID', { tags: ['P-1'] }],
    [body({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: key }] }] }), 'OPENAI_OUTPUT_INVALID', undefined],
    [body({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: key }] }] }), 'OPENAI_REFUSAL', undefined],
  ]) {
    await assert.rejects(adapter(async () => response(value)).analyze(request()), error => {
      isCode(code)(error);
      assert.deepEqual(error.analysis, candidate);
      assert.equal(Object.keys(error).includes('analysis'), false);
      assert.equal(error.incompleteReason, value.incomplete_details?.reason ?? null);
      assert.deepEqual(error.usage, value.usage.total_tokens ? { inputTokens: 80, outputTokens: 20, totalTokens: 100 } : null);
      assert.equal(error.responseId, value.id === key ? null : value.id);
      assert.equal(error.model, value.model);
      return true;
    });
  }
  for (const hostile of [{ tags: [key] }, { unrelated: 'private' }, { tags: [], extraneous: 'private' }]) {
    const output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(hostile) }] }];
    await assert.rejects(adapter(async () => response(body({ status: 'incomplete', incomplete_details: { reason: key }, output }))).analyze(request()), error => {
      isCode('OPENAI_RESPONSE_INCOMPLETE')(error);
      assert.equal(error.incompleteReason, null);
      assert.equal(error.analysis, undefined);
      return true;
    });
  }
});

test('reports actual rate windows and safe numeric limits without retrying before the provider permits it', async () => {
  for (const [headers, expected] of [
    [{ 'retry-after': '900' }, 900000],
    [{ 'retry-after-ms': '42000', 'retry-after': '900' }, 42000],
    [{ 'retry-after-ms': '999999999999' }, 86400000],
    [{ 'retry-after': 'bad-date' }, null],
  ]) {
    let calls = 0;
    const client = adapter(async () => {
      calls++;
      return response({ error: { code: 'rate_limit_exceeded', type: 'tokens' } }, { status: 429, headers: {
        ...headers, 'x-ratelimit-remaining-requests': '4', 'x-ratelimit-limit-tokens': '20000',
        'x-ratelimit-remaining-tokens': key, 'x-unexpected': key,
      } });
    }, { maxAttempts: expected === null ? 1 : 2 });
    await assert.rejects(client.analyze(request()), error => {
      isCode('OPENAI_RATE_LIMIT')(error);
      assert.equal(error.retryAfterMs, expected);
      assert.deepEqual(error.rateLimits, { requestsRemaining: 4, tokenLimit: 20000 });
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('response size bounds apply to declared and streamed bodies', async () => {
  await assert.rejects(adapter(async () => response(body(), { headers: { 'content-length': '100000' } }), { maxResponseBytes: 100 }).analyze(request()), isCode('OPENAI_RESPONSE_TOO_LARGE'));
  await assert.rejects(adapter(async () => response(body()), { maxResponseBytes: 100 }).analyze(request()), isCode('OPENAI_RESPONSE_TOO_LARGE'));
  await assert.rejects(adapter(async () => new Response('not JSON')).analyze(request()), isCode('OPENAI_RESPONSE_INVALID'));
});

test('network failure and timeout after dispatch are unknown outcomes and never blindly retried', async () => {
  let calls = 0;
  await assert.rejects(adapter(async () => { calls++; throw new Error(`network ${key}`); }).analyze(request()), error => {
    isCode('OPENAI_RESPONSE_UNKNOWN')(error); assert.equal(error.outcomeUnknown, true); return true;
  });
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(adapter(() => { calls++; return new Promise(() => {}); }, { timeoutMs: 15 }).analyze(request()), error => {
    isCode('OPENAI_RESPONSE_UNKNOWN')(error); assert.equal(error.outcomeUnknown, true); return true;
  });
  assert.equal(calls, 1);
});

test('gateway/internal failures retain safe HTTP metadata and are not automatically resent', async () => {
  for (const status of [500, 502, 504]) {
    let calls = 0;
    await assert.rejects(adapter(async () => { calls++; return response({ error: { message: key } }, { status }); }).analyze(request()), error => {
      isCode('OPENAI_RESPONSE_UNKNOWN')(error);
      assert.equal(error.httpStatus, status);
      assert.equal(error.outcomeUnknown, true);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('deadline also covers a stalled response body', async () => {
  let calls = 0;
  let cancelled = false;
  await assert.rejects(adapter(async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } }));
  }, { timeoutMs: 15 }).analyze(request()), isCode('OPENAI_RESPONSE_UNKNOWN'));
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test('cancellation before dispatch makes no request; cancellation in flight remains unknown', async () => {
  let calls = 0;
  const first = new AbortController(); first.abort();
  await assert.rejects(adapter(async () => { calls++; return response(); }).analyze({ ...request(), signal: first.signal }), isCode('OPENAI_CANCELLED'));
  assert.equal(calls, 0);
  const second = new AbortController();
  await assert.rejects(adapter(() => { calls++; second.abort(); return new Promise(() => {}); }).analyze({ ...request(), signal: second.signal }), isCode('OPENAI_RESPONSE_UNKNOWN'));
  assert.equal(calls, 1);
});

test('cancellation during a known-error backoff does not pretend an in-flight result is unknown', async () => {
  let calls = 0;
  const controller = new AbortController();
  await assert.rejects(adapter(async () => { calls++; return response({}, { status: 429 }); }, {
    sleepImpl: async () => { controller.abort(); throw new Error(key); },
  }).analyze({ ...request(), signal: controller.signal }), error => {
    isCode('OPENAI_CANCELLED')(error); assert.equal(error.outcomeUnknown, false); return true;
  });
  assert.equal(calls, 1);
});
