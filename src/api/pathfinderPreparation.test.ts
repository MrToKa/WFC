// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPreparationContext,
  fetchPreparationSession,
  createPreparation,
  verifyPreparationSession,
  mutatePreparation,
  PreparationApiError,
  PREPARATION_REQUEST_TIMEOUT_MS,
} from './pathfinderPreparation';
import { preparationFixture, preparationIds as ids } from '../test/preparationFixtures';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('strict project preparation transport', () => {
  it.each([false, true])('accepts current tray details and older contexts without them: details=%s', async includeDetails => {
    const { context } = preparationFixture();
    if (includeDetails) context.trays[0].details = { type: 'Cable ladder RA 60', widthMm: 600, heightMm: 77 };
    const fetch = vi.fn().mockResolvedValue(Response.json(context)); vi.stubGlobal('fetch', fetch);
    await expect(fetchPreparationContext(ids.project, 'login')).resolves.toEqual(context);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('verifies frozen plan and part bindings without accepting foreign sessions or altered plan bytes', async () => {
    const { session } = preparationFixture();
    await expect(verifyPreparationSession(session, ids.project, ids.session)).resolves.toEqual(
      session,
    );
    await expect(
      verifyPreparationSession(
        { ...session, plan: { ...session.plan, objectOrder: [2, 1] } },
        ids.project,
      ),
    ).rejects.toThrow();
    await expect(verifyPreparationSession(session, ids.model)).rejects.toThrow();
  });
  it('rejects invalid identities, escaped duplicate JSON and unknown outgoing fields', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"x":1,"\\u0078":2}'));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchPreparationContext(ids.project + '\n', 'login')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(fetchPreparationContext(ids.project, 'login')).rejects.toThrow();
    await expect(
      createPreparation(ids.project, 'login', { unknown: true } as never),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses only fixed paths and refuses mismatched committed coverage', async () => {
    const { session, committed } = preparationFixture();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(session)));
    vi.stubGlobal('fetch', fetch);
    await fetchPreparationSession(ids.project, 'login', ids.session);
    expect(fetch.mock.calls[0][0]).toMatch(
      new RegExp(`/api/projects/${ids.project}/pathfinder/preparations/${ids.session}$`),
    );
    await expect(
      verifyPreparationSession({ ...session, parts: [committed] }, ids.project),
    ).rejects.toThrow();
  });
});

describe('bounded preparation request lifetime', () => {
  const publish = (signal?: AbortSignal) => mutatePreparation(ids.project, 'login', ids.session, 'publish', {
    schemaVersion: 'wfc.pf.preparation-mutation.v1', expectedSessionRevision: '0', idempotencyKey: ids.actor, reason: 'Synthetic publication control',
  }, signal);

  it('times out an abort-ignoring mutation fetch with unknown outcome and disposes a late body', async () => {
    vi.useFakeTimers();
    let resolveFetch!: (response: Response) => void;
    const fetch = vi.fn((_url: unknown, _options: RequestInit) => new Promise<Response>(resolve => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const pending = publish(), refused = expect(pending).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', status: null, outcome: 'unknown' });
    await vi.advanceTimersByTimeAsync(PREPARATION_REQUEST_TIMEOUT_MS);
    await refused;
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    resolveFetch({ body: { cancel } } as unknown as Response);
    await Promise.resolve(); await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds response-body reads and never awaits a stalled cancel promise', async () => {
    vi.useFakeTimers();
    const reader = { read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {})), cancel: vi.fn(() => new Promise<void>(() => {})), releaseLock: vi.fn() };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response));
    const pending = publish(), refused = expect(pending).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', outcome: 'unknown' });
    await vi.advanceTimersByTimeAsync(0); expect(reader.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PREPARATION_REQUEST_TIMEOUT_MS); await refused;
    expect(reader.cancel).toHaveBeenCalledTimes(1); expect(reader.releaseLock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['fetch', 'body'] as const)('preserves the caller abort reason during %s and removes its listener', async phase => {
    vi.useFakeTimers();
    const controller = new AbortController(), reason = new DOMException('Project context changed.', 'AbortError');
    const add = vi.spyOn(controller.signal, 'addEventListener'), remove = vi.spyOn(controller.signal, 'removeEventListener');
    const reader = { read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {})), cancel: vi.fn(async () => {}), releaseLock: vi.fn() };
    const fetch = phase === 'fetch' ? vi.fn(() => new Promise<Response>(() => {})) : vi.fn().mockResolvedValue({ ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response);
    vi.stubGlobal('fetch', fetch);
    const pending = fetchPreparationContext(ids.project, 'login', controller.signal), refused = expect(pending).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0); controller.abort(reason); await refused;
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]); expect(vi.getTimerCount()).toBe(0);
    if (phase === 'body') expect(reader.cancel).toHaveBeenCalledTimes(1);
  });

  it('refuses an already aborted caller before fetch or timer creation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(), reason = new DOMException('Paused.', 'AbortError'); controller.abort(reason);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(fetchPreparationContext(ids.project, 'login', controller.signal)).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('clears deadline and caller listener on success, preserving definite server refusal semantics', async () => {
    vi.useFakeTimers();
    const { context } = preparationFixture(), controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(context))).mockResolvedValueOnce(new Response(JSON.stringify({
      schemaVersion: 'wfc.pf.preparation-error.v1', code: 'PREPARATION_SCOPE_STALE', message: 'Refresh project preparation.', currentSessionRevision: null, outcome: 'refused',
    }), { status: 409 }));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchPreparationContext(ids.project, 'login', controller.signal)).resolves.toEqual(context);
    expect(remove).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    const refusal = publish();
    await expect(refusal).rejects.toBeInstanceOf(PreparationApiError);
    await expect(refusal).rejects.toMatchObject({ code: 'PREPARATION_SCOPE_STALE', status: 409, outcome: 'refused' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
