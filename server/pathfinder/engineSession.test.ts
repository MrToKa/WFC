// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  createConfiguredEngineExecutor,
  createSessionEngineExecutor,
  engineSessionPolicy,
  type EngineSessionDependencies,
  type EngineSessionEvent,
} from './engineSession.js';
import { runEngine } from './engine.js';
import { syntheticDrillingRuntime } from './calculationFixtures.js';

const VERSION = 'pathfinder.engine.session.v1',
  HASH = 'a'.repeat(64),
  ENGINE = '45c24bf5f433f13e102600b36f20327c77961d0a';
const ready = () => ({
  schemaVersion: VERSION,
  type: 'ready',
  runnerSha256: HASH,
  engineVersion: ENGINE,
  maxInputBytes: 1048576,
  maxOutputBytes: 33554432,
});
const frame = (value: unknown) => {
  const b = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)),
    h = Buffer.alloc(4);
  h.writeUInt32BE(b.length);
  return Buffer.concat([h, b]);
};
const request = () => ({
  requestId: randomUUID(),
  timeoutMilliseconds: 30000,
  operation: 'calculate',
});
const answer = (input: Record<string, unknown>, ordinal: number) => ({
  schemaVersion: VERSION,
  type: 'result',
  response: {
    schemaVersion: 'pathfinder.model.response.v1',
    requestId: input.requestId,
    status: 'no_path',
    message: 'No path.',
    engineeringAccepted: false,
  },
  session: {
    requestOrdinal: ordinal,
    preparedReuse: ordinal === 1 ? 'disk' : 'memory',
    retireAfterResponse: false,
  },
});
type Fake = EventEmitter & {
  pid: number;
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: Writable;
  dead: boolean;
  requests: Array<Record<string, unknown>>;
};
type Setup = {
  ready?: (child: Fake) => void;
  reply?: (child: Fake, input: Record<string, unknown>, ordinal: number) => void;
  rss?: () => Promise<number>;
  reap?: boolean;
  hash?: () => Promise<string>;
  groupGone?: () => Promise<boolean>;
};
const clients: Array<ReturnType<typeof createSessionEngineExecutor>> = [];
function setup(options: Setup = {}) {
  const children: Fake[] = [],
    events: EngineSessionEvent[] = [];
  const dependencies: EngineSessionDependencies = {
    runnerHash: options.hash ?? (async () => HASH),
    residentBytes: options.rss ?? (async () => 1024),
    spawn: () => {
      const child = new EventEmitter() as Fake;
      child.pid = 1000 + children.length;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.dead = false;
      child.requests = [];
      children.push(child);
      child.stdin = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          const size = chunk.readUInt32BE(),
            input = JSON.parse(chunk.subarray(4).toString()) as Record<string, unknown>;
          if (size !== chunk.length - 4) throw Error('Invalid test request framing');
          child.requests.push(input);
          queueMicrotask(() => {
            if (options.reply) options.reply(child, input, child.requests.length);
            else child.stdout.write(frame(answer(input, child.requests.length)));
          });
          callback();
        },
      });
      queueMicrotask(() => {
        if (options.ready) options.ready(child);
        else child.stdout.write(frame(ready()));
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
    kill: async (value) => {
      const child = value as unknown as Fake;
      if (options.reap !== false && !child.dead) {
        child.dead = true;
        child.emit('close', null, 'SIGKILL');
      }
    },
    groupGone:
      options.groupGone ??
      (async (pid) => children.some((child) => child.pid === pid && child.dead)),
  };
  const client = createSessionEngineExecutor(
    { observe: (event) => events.push(event) },
    dependencies,
  );
  clients.push(client);
  process.env.PF_ENGINE_DLL = 'C:/owned/runner.dll';
  return { client, children, events, dependencies };
}
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete process.env.PF_ENGINE_DLL;
});
describe('private bounded session transport', () => {
  it.each(['protected-response-to-legacy','legacy-response-to-protected'] as const)('rejects %s without relabeling or reusing its lane',async kind=>{
    const scope={projectId:randomUUID(),modelVersionId:randomUUID(),contentFingerprint:'c'.repeat(64),selectionRevision:'1',captureFrameId:randomUUID(),captureFrameSha256:'d'.repeat(64),coordinateFrame:'canonical-world-metres' as const};
    const context=syntheticDrillingRuntime(scope);
    const {client,children}=setup({reply:(child,input,ordinal)=>{
      const wrapper=answer(input,ordinal);
      if(kind==='protected-response-to-legacy')Object.assign(wrapper.response,{schemaVersion:'pathfinder.model.response.v3',status:'invalid_request',barriers:{schemaVersion:'wfc.pf.barrier-execution.v1',context,
        proof:null,directSecondary:null,qualification:null,connectors:{from:null,to:null},diagnostics:{status:'unavailable',reasonCode:'SYNTHETIC_REFUSAL',searchComplete:false,candidatesTruncated:false,pairAttempts:0,collisionQueries:0,work:'0',plannerAttempts:0,straightPairAttempts:0,localEdgeChecks:0,localPhaseUsed:false,straightPhaseTruncated:false}}});
      child.stdout.write(frame(wrapper));
    }});
    await expect(client.execute({...request(),schemaVersion:kind==='legacy-response-to-protected'?'pathfinder.model.runner.v2':'pathfinder.model.runner.v1'},new AbortController().signal)).rejects.toMatchObject({code:'ENGINE_RESPONSE_VERSION'});
    expect(children[0].dead).toBe(true);
  });
  it('reuses one lane, unwraps unchanged responses and reports cache telemetry only privately', async () => {
    const { client, children, events } = setup();
    const first = await client.execute(request(), new AbortController().signal),
      second = await client.execute(request(), new AbortController().signal);
    expect(children).toHaveLength(1);
    expect(first.status).toBe('no_path');
    expect(second).not.toHaveProperty('session');
    expect(events.filter((e) => e.type === 'result')).toMatchObject([
      { requestOrdinal: 1, preparedReuse: 'disk' },
      { requestOrdinal: 2, preparedReuse: 'memory' },
    ]);
  });
  it('accepts fragmented header/body bytes without treating transport chunks as frames', async () => {
    const emit = (child: Fake, bytes: Buffer) => {
      for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
    };
    const { client } = setup({
      ready: (c) => emit(c, frame(ready())),
      reply: (c, r, n) => emit(c, frame(answer(r, n))),
    });
    expect((await client.execute(request(), new AbortController().signal)).status).toBe('no_path');
  });
  it.each([
    ['wrong binary', () => ({ ...ready(), runnerSha256: 'b'.repeat(64) })],
    ['wrong Core', () => ({ ...ready(), engineVersion: 'wrong' })],
    ['unknown ready field', () => ({ ...ready(), secret: true })],
    ['wrong limit', () => ({ ...ready(), maxOutputBytes: 1 })],
  ])('rejects handshake %s before dispatch and reaps the lane', async (_name, make) => {
    const { client, children } = setup({ ready: (c) => c.stdout.write(frame(make())) });
    await expect(client.execute(request(), new AbortController().signal)).rejects.toBeDefined();
    expect(children[0].dead).toBe(true);
    expect(children[0].requests).toHaveLength(0);
  });
  it.each([
    [
      'wrong response ID',
      (r: Record<string, unknown>, n: number) => {
        const a = answer(r, n);
        a.response.requestId = randomUUID();
        return frame(a);
      },
    ],
    ['wrong ordinal', (r: Record<string, unknown>, n: number) => frame(answer(r, n + 1))],
    [
      'unknown wrapper field',
      (r: Record<string, unknown>, n: number) => frame({ ...answer(r, n), other: 1 }),
    ],
    [
      'duplicate escaped member',
      (r: Record<string, unknown>, n: number) =>
        frame(
          Buffer.from(
            JSON.stringify(answer(r, n)).replace(
              '"type":"result"',
              '"type":"result","\\u0074ype":"result"',
            ),
          ),
        ),
    ],
    ['invalid UTF8', () => frame(Buffer.from([0xff]))],
    [
      'valid result plus partial unsolicited next frame',
      (r: Record<string, unknown>, n: number) =>
        Buffer.concat([frame(answer(r, n)), Buffer.from([0])]),
    ],
    [
      'oversized frame',
      () => {
        const h = Buffer.alloc(4);
        h.writeUInt32BE(33554433);
        return h;
      },
    ],
    ['empty frame', () => Buffer.alloc(4)],
  ])('rejects %s without returning a positive result', async (_name, make) => {
    const { client, children } = setup({ reply: (c, r, n) => c.stdout.write(make(r, n)) });
    await expect(client.execute(request(), new AbortController().signal)).rejects.toBeDefined();
    expect(children[0].dead).toBe(true);
  });
  it('rejects concurrent work immediately without a hidden queue or second dispatch', async () => {
    let release: () => void = () => undefined;
    const { client, children } = setup({
      reply: (c, r, n) => {
        release = () => c.stdout.write(frame(answer(r, n)));
      },
    });
    const active = client.execute(request(), new AbortController().signal);
    await vi.waitFor(() => expect(children[0]?.requests).toHaveLength(1));
    await expect(client.execute(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ENGINE_SESSION_BUSY',
    });
    expect(children).toHaveLength(1);
    release();
    await active;
  });
  it('pre-cancellation never spawns; cancellation during startup kills before returning', async () => {
    const cancellation = new AbortController();
    cancellation.abort();
    const { client, children } = setup({ ready: () => undefined });
    await expect(client.execute(request(), cancellation.signal)).rejects.toBeDefined();
    expect(children).toHaveLength(0);
    const current = new AbortController(),
      outcome = client.execute(request(), current.signal).catch((e) => e);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    current.abort();
    expect(await outcome).toMatchObject({ code: 'CALCULATION_CANCELLED' });
    expect(children[0].dead).toBe(true);
  });
  it('cancellation after dispatch reaps first and the next request gets a new lane', async () => {
    const cancellation = new AbortController();
    let held = true;
    const { client, children } = setup({
      reply: (c, r, n) => {
        if (!held) c.stdout.write(frame(answer(r, n)));
      },
    });
    const outcome = client.execute(request(), cancellation.signal).catch((e) => e);
    await vi.waitFor(() => expect(children[0]?.requests).toHaveLength(1));
    cancellation.abort();
    expect(await outcome).toMatchObject({ code: 'CALCULATION_CANCELLED' });
    expect(children[0].dead).toBe(true);
    held = false;
    await client.execute(request(), new AbortController().signal);
    expect(children).toHaveLength(2);
  });
  it('close during pre-spawn hashing rejects active work and never spawns late', async () => {
    let hash!: (value: string) => void;
    const { client, children } = setup({
      hash: () =>
        new Promise((resolve) => {
          hash = resolve;
        }),
    });
    const outcome = client.execute(request(), new AbortController().signal).catch((e) => e);
    await client.close();
    expect(await outcome).toMatchObject({ code: 'ENGINE_SESSION_CLOSED' });
    hash(HASH);
    await Promise.resolve();
    expect(children).toHaveLength(0);
    await expect(client.execute(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ENGINE_SESSION_CLOSED',
    });
  });
  it('handles asynchronous spawn errors when no PID was created', async () => {
    const h = setup();
    const spawn = h.dependencies.spawn;
    h.dependencies.spawn = (dll) => {
      const child = spawn(dll);
      Object.defineProperty(child, 'pid', { value: undefined });
      queueMicrotask(() =>
        child.emit('error', Object.assign(Error('missing dotnet'), { code: 'ENOENT' })),
      );
      return child;
    };
    await expect(h.client.execute(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ENGINE_PROCESS_FAILED',
    });
  });
  it('close during an active request reaps and rejects work before resolving shutdown', async () => {
    const { client, children } = setup({ reply: () => undefined });
    const pending = client.execute(request(), new AbortController().signal).catch((cause) => cause);
    await vi.waitFor(() => expect(children[0]?.requests).toHaveLength(1));
    await client.close();
    expect(await pending).toMatchObject({ code: 'ENGINE_SESSION_CLOSED' });
    expect(children[0].dead).toBe(true);
  });
  it('ignores late bytes from a retired lane without contaminating its replacement', async () => {
    let held = true;
    const { client, children } = setup({
      reply: (child, input, ordinal) => {
        if (!held) child.stdout.write(frame(answer(input, ordinal)));
      },
    });
    const cancellation = new AbortController();
    const pending = client.execute(request(), cancellation.signal).catch((cause) => cause);
    await vi.waitFor(() => expect(children[0]?.requests).toHaveLength(1));
    cancellation.abort();
    await pending;
    held = false;
    children[0].stdout.write(frame(answer(children[0].requests[0], 1)));
    expect((await client.execute(request(), new AbortController().signal)).status).toBe('no_path');
    expect(children).toHaveLength(2);
  });
  it('counts startup time against the original request deadline', async () => {
    vi.useFakeTimers();
    const { client, children } = setup({ ready: () => undefined });
    const outcome = client
      .execute({ ...request(), timeoutMilliseconds: 100 }, new AbortController().signal)
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(101);
    expect(await outcome).toMatchObject({ code: 'ENGINE_DEADLINE' });
    expect(children[0].requests).toHaveLength(0);
    expect(children[0].dead).toBe(true);
  });
  it('hard Node deadline retires a silent worker without resetting or replaying the request', async () => {
    vi.useFakeTimers();
    const { client, children } = setup({ reply: () => undefined });
    const outcome = client
      .execute({ ...request(), timeoutMilliseconds: 100 }, new AbortController().signal)
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(1601);
    expect(await outcome).toMatchObject({ code: 'ENGINE_DEADLINE' });
    expect(children).toHaveLength(1);
    expect(children[0].requests).toHaveLength(1);
    expect(children[0].dead).toBe(true);
  });
  it('startup has a separate 5-second bound', async () => {
    vi.useFakeTimers();
    const { client, children } = setup({ ready: () => undefined });
    const outcome = client.execute(request(), new AbortController().signal).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await outcome).toMatchObject({ code: 'ENGINE_SESSION_STARTUP_DEADLINE' });
    expect(children[0].dead).toBe(true);
  });
  it('retireAfterResponse accepts a complete result followed by expected EOF', async () => {
    const { client, children } = setup({
      reply: (c, r, n) => {
        const a = answer(r, n);
        a.session.retireAfterResponse = true;
        c.stdout.write(frame(a));
        c.dead = true;
        c.emit('close', 0, null);
      },
    });
    expect((await client.execute(request(), new AbortController().signal)).status).toBe('no_path');
    expect(children[0].dead).toBe(true);
    await client.execute(request(), new AbortController().signal);
    expect(children).toHaveLength(2);
  });
  it('rotates after 64 dispatches and before remaining lifetime cannot cover a request', async () => {
    const { client, children } = setup();
    for (let n = 0; n < 64; n++) await client.execute(request(), new AbortController().signal);
    expect(children).toHaveLength(1);
    expect(children[0].dead).toBe(true);
    await client.execute(request(), new AbortController().signal);
    expect(children).toHaveLength(2);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + engineSessionPolicy.lifetimeMilliseconds);
    await client.execute(request(), new AbortController().signal);
    expect(children).toHaveLength(3);
  });
  it('retires an idle lane', async () => {
    vi.useFakeTimers();
    const { client, children } = setup();
    await client.execute(request(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(30001);
    expect(children[0].dead).toBe(true);
    await client.execute(request(), new AbortController().signal);
    expect(children).toHaveLength(2);
  });
  it('fails closed on unsupported RSS observation and on actual observed over-budget RSS', async () => {
    for (const rss of [
      async () => {
        throw Error('unsupported');
      },
      async () => engineSessionPolicy.rssBytes + 1,
    ]) {
      const { client, children } = setup({ rss });
      await expect(client.execute(request(), new AbortController().signal)).rejects.toMatchObject({
        code: expect.stringMatching(/^ENGINE_SESSION_RSS_/),
      });
      expect(children[0].dead).toBe(true);
    }
  });
  it('lifetime stderr quota and unsolicited idle bytes retire the lane', async () => {
    const { client, children } = setup();
    await client.execute(request(), new AbortController().signal);
    children[0].stderr.write(Buffer.alloc(65537));
    await vi.waitFor(() => expect(children[0].dead).toBe(true));
    await client.execute(request(), new AbortController().signal);
    children[1].stdout.write(Buffer.from([1]));
    await vi.waitFor(() => expect(children[1].dead).toBe(true));
  });
  it('a truncated response followed by child crash is never accepted', async () => {
    const { client } = setup({
      reply: (c, r, n) => {
        c.stdout.write(frame(answer(r, n)).subarray(0, 12));
        c.dead = true;
        c.emit('close', 1, null);
      },
    });
    await expect(client.execute(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ENGINE_SESSION_PROCESS_FAILED',
    });
  });
  it('does not admit a replacement when root closed but an owned group member remains', async () => {
    vi.useFakeTimers();
    const { client, children } = setup({
      groupGone: async () => false,
      reply: (c, r, n) => {
        const a = answer(r, n);
        a.session.retireAfterResponse = true;
        c.stdout.write(frame(a));
        c.dead = true;
        c.emit('close', 0, null);
      },
    });
    const outcome = client.execute(request(), new AbortController().signal).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10001);
    expect(children[0].dead).toBe(true);
    expect(await outcome).toMatchObject({ code: 'ENGINE_SESSION_REAP_FAILED' });
    await expect(client.execute(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ENGINE_SESSION_REAP_FAILED',
    });
    expect(children).toHaveLength(1);
  });
  it.each(['kill','groupGone'] as const)('normalizes an unknown %s join failure before any replacement can start', async phase => {
    const h=setup({reply:(child,input,ordinal)=>{
      if(phase==='groupGone'){
        const response=answer(input,ordinal);response.session.retireAfterResponse=true;
        child.stdout.write(frame(response));child.dead=true;child.emit('close',0,null);
      }
    }});
    if(phase==='kill')h.dependencies.kill=async()=>{throw new Error('Private process transport failure.');};
    else h.dependencies.groupGone=async()=>{throw new Error('Private process transport failure.');};
    const abort=new AbortController(),outcome=h.client.execute(request(),abort.signal).catch(error=>error);
    await vi.waitFor(()=>expect(h.children).toHaveLength(1));
    if(phase==='kill')abort.abort();
    expect(await outcome).toMatchObject({code:'ENGINE_SESSION_REAP_FAILED'});
    await expect(h.client.execute(request(),new AbortController().signal)).rejects.toMatchObject({code:'ENGINE_SESSION_REAP_FAILED'});
    await expect(h.client.close()).rejects.toMatchObject({code:'ENGINE_SESSION_REAP_FAILED'});
    expect(h.children).toHaveLength(1);
  });
  it('waits for the entire group before returning a retiring response', async () => {
    vi.useFakeTimers();
    let gone = false;
    const { client, children } = setup({
      groupGone: async () => gone,
      reply: (c, r, n) => {
        const a = answer(r, n);
        a.session.retireAfterResponse = true;
        c.stdout.write(frame(a));
        c.dead = true;
        c.emit('close', 0, null);
      },
    });
    let resolved = false;
    const pending = client.execute(request(), new AbortController().signal).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(false);
    await expect(client.execute(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ENGINE_SESSION_BUSY',
    });
    gone = true;
    await vi.advanceTimersByTimeAsync(21);
    await pending;
    expect(resolved).toBe(true);
    expect(children).toHaveLength(1);
  });
  it('does not return a completed DTO when cancellation arrives during retirement join', async () => {
    vi.useFakeTimers();
    let gone = false;
    const { client, children } = setup({
      groupGone: async () => gone,
      reply: (child, input, ordinal) => {
        const response = answer(input, ordinal);
        response.session.retireAfterResponse = true;
        child.stdout.write(frame(response));
        child.dead = true;
        child.emit('close', 0, null);
      },
    });
    const cancellation = new AbortController();
    const pending = client.execute(request(), cancellation.signal).catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(1);
    cancellation.abort();
    gone = true;
    await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toMatchObject({ code: 'CALCULATION_CANCELLED' });
    expect(children).toHaveLength(1);
  });
  it('does not reset the original deadline while a completed DTO waits for retirement', async () => {
    vi.useFakeTimers();
    let gone = false;
    const { client, children } = setup({
      groupGone: async () => gone,
      reply: (child, input, ordinal) => {
        const response = answer(input, ordinal);
        response.session.retireAfterResponse = true;
        child.stdout.write(frame(response));
        child.dead = true;
        child.emit('close', 0, null);
      },
    });
    const pending = client
      .execute({ ...request(), timeoutMilliseconds: 100 }, new AbortController().signal)
      .catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(1700);
    gone = true;
    await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toMatchObject({ code: 'ENGINE_DEADLINE' });
    expect(children).toHaveLength(1);
  });
  it('applies the request byte bound before spawn', async () => {
    const { client, children } = setup();
    await expect(
      client.execute({ ...request(), extra: 'x'.repeat(1048576) }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ENGINE_INPUT_BUDGET' });
    expect(children).toHaveLength(0);
  });
  it('observes later over-budget RSS and discards the interrupted lane', async () => {
    vi.useFakeTimers();
    let reads = 0;
    const { client, children } = setup({
      rss: async () => (++reads === 1 ? 1024 : engineSessionPolicy.rssBytes + 1),
      reply: () => undefined,
    });
    const outcome = client.execute(request(), new AbortController().signal).catch((e) => e);
    await vi.advanceTimersByTimeAsync(101);
    expect(await outcome).toMatchObject({ code: 'ENGINE_SESSION_RSS_LIMIT' });
    expect(children[0].dead).toBe(true);
  });
  it('bounds cumulative stderr across requests', async () => {
    const { client, children } = setup();
    await client.execute(request(), new AbortController().signal);
    children[0].stderr.write(Buffer.alloc(40000));
    await client.execute(request(), new AbortController().signal);
    children[0].stderr.write(Buffer.alloc(30000));
    await vi.waitFor(() => expect(children[0].dead).toBe(true));
  });
  it.each(['deadline_exceeded', 'resource_limit', 'invalid_request'])(
    'retires visibly on %s without automatic replay',
    async (status) => {
      const { client, children } = setup({
        reply: (c, r, n) => {
          const a = answer(r, n);
          a.response.status = status;
          c.stdout.write(frame(a));
        },
      });
      expect((await client.execute(request(), new AbortController().signal)).status).toBe(status);
      expect(children).toHaveLength(1);
      expect(children[0].requests).toHaveLength(1);
      expect(children[0].dead).toBe(true);
    },
  );
  it('an unreaped lane poisons the executor and cannot be replaced', async () => {
    vi.useFakeTimers();
    const { client, children } = setup({ reap: false, reply: () => undefined });
    const cancellation = new AbortController(),
      outcome = client.execute(request(), cancellation.signal).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1);
    cancellation.abort();
    await vi.advanceTimersByTimeAsync(10001);
    expect(await outcome).toMatchObject({ code: 'ENGINE_SESSION_REAP_FAILED' });
    await expect(client.execute(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ENGINE_SESSION_REAP_FAILED',
    });
    expect(children).toHaveLength(1);
  });
  it('keeps one-shot default and refuses an unknown configured mode', async () => {
    vi.stubEnv('PF_ENGINE_MODE', undefined);
    expect(createConfiguredEngineExecutor().execute).toBe(runEngine);
    vi.stubEnv('PF_ENGINE_MODE', 'oneshot');
    await createConfiguredEngineExecutor().close();
    vi.stubEnv('PF_ENGINE_MODE', 'invented');
    expect(() => createConfiguredEngineExecutor()).toThrow('PATHFINDER_ENGINE_MODE_INVALID');
  });
});
