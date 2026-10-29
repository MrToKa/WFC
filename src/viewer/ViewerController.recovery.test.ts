import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ViewerController, type ViewerEvent } from './ViewerController';
import { invalidateViewerLogin } from './loginLifecycle';

const projectId = '11111111-1111-4111-8111-111111111111';
const modelVersionId = '22222222-2222-4222-8222-222222222222';
const selected = () => Response.json({ selection: { activeModelVersionId: modelVersionId, selectionRevision: 1 } });
let controllers: ViewerController[];
beforeEach(() => { controllers = []; vi.stubGlobal('crypto', webcrypto); vi.useFakeTimers(); });
afterEach(() => {
  controllers.forEach(controller => controller.dispose()); vi.runOnlyPendingTimers(); vi.useRealTimers();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

async function loaded(duration = 300_000, absoluteDuration = 1_800_000) {
  const container = document.createElement('div'); document.body.append(container);
  const events: ViewerEvent[] = [], token = crypto.randomUUID();
  const controller = new ViewerController({ container, projectId, token, onEvent: event => events.push(event) });
  controllers.push(controller);
  let session: { sessionId: string; projectId: string; modelVersionId: string; loadId: string; expiresAt: string; absoluteExpiresAt: string };
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    if (options?.method === 'DELETE') return new Response(null, { status: 204 });
    if (String(url).endsWith('/renew')) return Response.json({ ...session, expiresAt: new Date(Date.now() + duration).toISOString() });
    if (options?.method === 'POST') {
      session = { sessionId: crypto.randomUUID(), projectId, modelVersionId, loadId: JSON.parse(String(options.body)).loadId,
        expiresAt: new Date(Date.now() + duration).toISOString(), absoluteExpiresAt: new Date(Date.now() + absoluteDuration).toISOString() };
      return Response.json(session);
    }
    return selected();
  });
  const baseline = fetch.getMockImplementation()!;
  function message(type: string, payload: Record<string, unknown>, requestId: string, identity: Record<string, unknown> = {}) {
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: controller.iframe.contentWindow, data: {
      channel: 'wfc-routings-viewer', protocolVersion: 1, instanceId: controller.instanceId, projectId,
      modelVersionId: null, loadId: null, requestId, type, payload, ...identity,
    } }));
  }
  function ready() {
    const send = vi.spyOn(controller.iframe.contentWindow!, 'postMessage');
    message('HELLO', { supportedProtocolVersions: [1], sdkVersion: '7.130.0' }, crypto.randomUUID());
    message('RUNTIME_READY', { sdkVersion: '7.130.0' }, send.mock.calls[0][0].requestId);
    return send;
  }
  function acknowledge(send: ReturnType<typeof ready>) {
    const command = send.mock.calls.find(call => call[0].type === 'LOAD_MODEL')![0];
    message('MODEL_LOADED', { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: true }, command.requestId,
      { modelVersionId, loadId: command.loadId });
  }
  const send = ready(); await controller.load(modelVersionId); acknowledge(send);
  const selectionCalls = () => fetch.mock.calls.filter(call => String(call[0]).endsWith('/model-versions'));
  const renewalCalls = () => fetch.mock.calls.filter(call => String(call[0]).endsWith('/renew'));
  const createCalls = () => fetch.mock.calls.filter(call => call[1]?.method === 'POST' && !String(call[0]).endsWith('/renew'));
  return { controller, events, fetch, baseline, token, send, ready, acknowledge, selectionCalls, renewalCalls, createCalls,
    session: () => session!, terminal: () => events.filter(event => event.type === 'ERROR' && event.payload.operation === 'viewer') };
}

describe('Viewer lifecycle transient recovery', () => {
  it.each([408, 429, 500, 503, 'network'] as const)('rechecks selection after %s without recreating the iframe or granting a command early', async failure => {
    const s = await loaded(), original = s.controller.getLoadSnapshot(), count = s.selectionCalls().length;
    if (failure === 'network') s.fetch.mockRejectedValueOnce(new TypeError('Network unavailable'));
    else s.fetch.mockResolvedValueOnce(Response.json({ code: 'RESOURCE_FAILED' }, { status: failure }));
    const showing = s.controller.showRoute('BC1');
    await vi.advanceTimersByTimeAsync(249);
    expect(s.controller.getLoadSnapshot()).toEqual(original); expect(s.terminal()).toHaveLength(0);
    expect(s.send.mock.calls.some(call => call[0].type === 'SHOW_ROUTE')).toBe(false);
    expect(s.selectionCalls()).toHaveLength(count + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await showing).toBeTypeOf('string'); expect(s.selectionCalls()).toHaveLength(count + 2);
    expect(s.controller.getLoadSnapshot()).toEqual(original); expect(s.createCalls()).toHaveLength(1);
    expect(s.fetch.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false);
  });

  it('enforces the 15-second selection deadline when fetch ignores abort and ignores its late response after recovery', async () => {
    const s = await loaded(), original = s.controller.getLoadSnapshot();
    let finish!: (response: Response) => void, signal: AbortSignal | null | undefined;
    s.fetch.mockImplementationOnce((_url, options) => { signal = options?.signal; return new Promise<Response>(resolve => { finish = resolve; }); });
    const showing = s.controller.showRoute('BC1');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(signal?.aborted).toBe(true); expect(s.controller.getLoadSnapshot()).toEqual(original);
    await vi.advanceTimersByTimeAsync(250); expect(await showing).toBeTypeOf('string');
    finish(Response.json({ code: 'ACCESS_REVOKED' }, { status: 403 })); await vi.advanceTimersByTimeAsync(0);
    expect(s.controller.getLoadSnapshot()).toEqual(original); expect(s.terminal()).toHaveLength(0);
  });

  it('shares one in-flight selection request across focus, visibility and a gated route command without caching the next check', async () => {
    const s = await loaded(), count = s.selectionCalls().length;
    let finish!: (response: Response) => void;
    s.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
    const showing = s.controller.showRoute('BC1');
    expect(s.selectionCalls()).toHaveLength(count + 1);
    finish(selected()); expect(await showing).toBeTypeOf('string');
    await s.controller.showRoute('BC1'); expect(s.selectionCalls()).toHaveLength(count + 2);
  });

  it.each([
    ['401', () => Response.json({ code: 'AUTH_REQUIRED' }, { status: 401 }), 'AUTH_REQUIRED'],
    ['403', () => Response.json({ code: 'ACCESS_REVOKED' }, { status: 403 }), 'ACCESS_REVOKED'],
    ['409', () => Response.json({ code: 'MODEL_UNAVAILABLE' }, { status: 409 }), 'MODEL_UNAVAILABLE'],
    ['410', () => Response.json({ code: 'SESSION_EXPIRED' }, { status: 410 }), 'SESSION_EXPIRED'],
    ['changed revision', () => Response.json({ selection: { activeModelVersionId: modelVersionId, selectionRevision: 2 } }), 'MODEL_SELECTION_CHANGED'],
    ['changed model', () => Response.json({ selection: { activeModelVersionId: crypto.randomUUID(), selectionRevision: 1 } }), 'MODEL_SELECTION_CHANGED'],
    ['malformed selection', () => Response.json({ selection: {} }), 'ACCESS_CHECK_FAILED'],
    ['invalid JSON', () => new Response('{'), 'ACCESS_CHECK_FAILED'],
  ] as const)('fails closed immediately for %s without retry', async (_name, response, code) => {
    const s = await loaded(), count = s.selectionCalls().length;
    s.fetch.mockResolvedValueOnce(response());
    expect(await s.controller.showRoute('BC1')).toBeNull();
    expect(s.controller.getLoadSnapshot()).toBeNull(); expect(s.terminal().at(-1)?.payload.code).toBe(code);
    await vi.advanceTimersByTimeAsync(1_000); expect(s.selectionCalls()).toHaveLength(count + 1);
  });

  it('exhausts exactly two selection retries and reports a safe access-check failure', async () => {
    const s = await loaded(), count = s.selectionCalls().length;
    s.fetch.mockImplementation((url, options) => String(url).endsWith('/model-versions')
      ? Promise.resolve(Response.json({ code: 'RESOURCE_FAILED' }, { status: 503 })) : s.baseline(url, options));
    const showing = s.controller.showRoute('BC1'); await vi.advanceTimersByTimeAsync(999);
    expect(s.controller.getLoadSnapshot()?.ready).toBe(true); expect(s.selectionCalls()).toHaveLength(count + 2);
    await vi.advanceTimersByTimeAsync(1); expect(await showing).toBeNull();
    expect(s.selectionCalls()).toHaveLength(count + 3); expect(s.terminal().at(-1)?.payload.code).toBe('ACCESS_CHECK_FAILED');
    expect(s.controller.iframe.style.display).toBe('none');
  });

  it.each(['idle', 'absolute'] as const)('does not carry selection retries across the existing %s expiry', async expiry => {
    const s = await loaded(expiry === 'idle' ? 100 : 300_000, expiry === 'absolute' ? 100 : 1_800_000), count = s.selectionCalls().length;
    s.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const showing = s.controller.showRoute('BC1'); await vi.advanceTimersByTimeAsync(100);
    expect(await showing).toBeNull(); expect(s.selectionCalls()).toHaveLength(count + 1);
    expect(s.terminal().at(-1)?.payload.code).toBe('SESSION_EXPIRED');
  });

  it('does not accept an in-flight selection response after the existing session expiry', async () => {
    const s = await loaded(100); let finish!: (response: Response) => void;
    s.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const showing = s.controller.showRoute('BC1'); await vi.advanceTimersByTimeAsync(100);
    expect(await showing).toBeNull(); expect(s.terminal().at(-1)?.payload.code).toBe('SESSION_EXPIRED');
    finish(selected()); await vi.advanceTimersByTimeAsync(0); expect(s.controller.getLoadSnapshot()).toBeNull();
  });

  it.each(['dispose', 'logout', 'reload'] as const)('cancels selection retry delays on %s', async reason => {
    const s = await loaded(), count = s.selectionCalls().length;
    s.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const showing = s.controller.showRoute('BC1'); await vi.advanceTimersByTimeAsync(0);
    if (reason === 'dispose') s.controller.dispose();
    if (reason === 'logout') invalidateViewerLogin(s.token);
    if (reason === 'reload') {
      const loading = s.controller.load(modelVersionId), send = s.ready(); await loading; s.acknowledge(send);
    }
    expect(await showing).toBeNull(); await vi.advanceTimersByTimeAsync(1_000);
    expect(s.selectionCalls()).toHaveLength(count + (reason === 'reload' ? 2 : 1)); expect(s.terminal()).toHaveLength(0);
  });

  it.each(['selection', 'renewal'] as const)('cannot restore or terminate a replacement load from a stale %s response even when fetch ignores abort', async operation => {
    const s = await loaded(); let finish!: (response: Response) => void;
    let waiting: Promise<string | null> | undefined;
    if (operation === 'selection') {
      s.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
      waiting = s.controller.showRoute('BC1');
    } else {
      s.fetch.mockImplementation((url, options) => String(url).endsWith('/renew')
        ? new Promise<Response>(resolve => { finish = resolve; }) : s.baseline(url, options));
      await vi.advanceTimersByTimeAsync(180_000);
    }
    const staleSession = { ...s.session() }, loading = s.controller.load(modelVersionId), send = s.ready();
    await loading; s.acknowledge(send); const replacement = s.controller.getLoadSnapshot();
    if (waiting) expect(await waiting).toBeNull();
    finish(operation === 'selection' ? Response.json({ selection: { activeModelVersionId: crypto.randomUUID(), selectionRevision: 2 } })
      : Response.json({ ...staleSession, expiresAt: new Date(Date.now() + 300_000).toISOString() }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.controller.getLoadSnapshot()).toEqual(replacement); expect(s.terminal()).toHaveLength(0);
  });

  it.each([500, 503, 'network', 'timeout'] as const)('recovers the same session renewal after %s', async failure => {
    const s = await loaded(), original = s.controller.getLoadSnapshot(); let attempt = 0;
    s.fetch.mockImplementation((url, options) => {
      if (!String(url).endsWith('/renew') || attempt++ > 0) return s.baseline(url, options);
      if (failure === 'timeout') return new Promise<Response>(() => {});
      if (failure === 'network') return Promise.reject(new TypeError('Network unavailable'));
      return Promise.resolve(new Response(null, { status: failure }));
    });
    await vi.advanceTimersByTimeAsync(180_000 + (failure === 'timeout' ? 15_000 : 0));
    expect(s.controller.getLoadSnapshot()).toEqual(original); expect(s.renewalCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(s.renewalCalls()).toHaveLength(2); expect(s.createCalls()).toHaveLength(1);
    expect(s.controller.getLoadSnapshot()).toEqual(original); expect(s.terminal()).toHaveLength(0);
  });

  it.each([401, 403, 409, 410, 'malformed'] as const)('does not retry renewal authority or malformed failure %s', async failure => {
    const s = await loaded();
    s.fetch.mockImplementation((url, options) => String(url).endsWith('/renew') ? Promise.resolve(failure === 'malformed'
      ? Response.json({ ...s.session(), loadId: crypto.randomUUID() }) : Response.json({ code: 'AUTHORITY_FAILED' }, { status: failure })) : s.baseline(url, options));
    await vi.advanceTimersByTimeAsync(181_000);
    expect(s.renewalCalls()).toHaveLength(1); expect(s.controller.getLoadSnapshot()).toBeNull();
    expect(s.terminal().at(-1)?.payload.code).toBe(failure === 'malformed' ? 'SESSION_RENEW_FAILED' : 'AUTHORITY_FAILED');
  });

  it.each(['recovers', 'exhausts'] as const)('uses at most two same-session renewal retries when the server %s', async outcome => {
    const s = await loaded(), original = s.controller.getLoadSnapshot(); let attempt = 0;
    s.fetch.mockImplementation((url, options) => {
      if (!String(url).endsWith('/renew')) return s.baseline(url, options);
      if (++attempt <= 2 || outcome === 'exhausts') return Promise.resolve(new Response(null, { status: 503 }));
      return s.baseline(url, options);
    });
    await vi.advanceTimersByTimeAsync(180_999);
    expect(s.controller.getLoadSnapshot()).toEqual(original); expect(s.renewalCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); expect(s.renewalCalls()).toHaveLength(3); expect(s.createCalls()).toHaveLength(1);
    if (outcome === 'recovers') {
      expect(s.controller.getLoadSnapshot()).toEqual(original); expect(s.terminal()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(120_000); expect(s.controller.getLoadSnapshot()).toEqual(original);
    } else {
      expect(s.controller.getLoadSnapshot()).toBeNull(); expect(s.terminal().at(-1)?.payload.code).toBe('SESSION_RENEW_FAILED');
    }
  });

  it('cancels a pending same-session renewal backoff on logout', async () => {
    const s = await loaded(); s.fetch.mockImplementation((url, options) => String(url).endsWith('/renew')
      ? Promise.resolve(new Response(null, { status: 503 })) : s.baseline(url, options));
    await vi.advanceTimersByTimeAsync(180_000); invalidateViewerLogin(s.token); await vi.advanceTimersByTimeAsync(1_000);
    expect(s.renewalCalls()).toHaveLength(1); expect(s.controller.getLoadSnapshot()).toBeNull(); expect(s.terminal()).toHaveLength(0);
  });

  it('expires a renewal retry at the old session deadline without accepting a later server extension', async () => {
    const s = await loaded(180_100); let finish!: (response: Response) => void;
    s.fetch.mockImplementation((url, options) => String(url).endsWith('/renew')
      ? new Promise<Response>(resolve => { finish = resolve; }) : s.baseline(url, options));
    await vi.advanceTimersByTimeAsync(180_100);
    expect(s.terminal().at(-1)?.payload.code).toBe('SESSION_EXPIRED'); expect(s.renewalCalls()).toHaveLength(1);
    finish(Response.json({ ...s.session(), expiresAt: new Date(Date.now() + 300_000).toISOString() }));
    await vi.advanceTimersByTimeAsync(1_000); expect(s.controller.getLoadSnapshot()).toBeNull(); expect(s.createCalls()).toHaveLength(1);
  });

  it('does not retry initial session creation', async () => {
    const s = await loaded(); s.fetch.mockImplementation((url, options) => options?.method === 'POST'
      ? Promise.resolve(new Response(null, { status: 503 })) : s.baseline(url, options));
    const loading = s.controller.load(modelVersionId); s.ready(); await loading; await vi.advanceTimersByTimeAsync(1_000);
    expect(s.createCalls()).toHaveLength(2); expect(s.controller.getLoadSnapshot()).toBeNull();
  });
});
