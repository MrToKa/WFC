// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeEnvelope } from '../../viewer-runtime/protocol.mjs';
import { createManagedProducerControl, MANAGED_CONTROL_LIMITS, type ManagedProducerControl } from './managedProducerControl.js';
import { PathFinderError } from './errors.js';

const id = (n: number) => `ee800000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const services: ManagedProducerControl[] = [];
const guard = <T>(promise: Promise<T>) => { void promise.catch(() => undefined); return promise; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const configuration = { key: 'a'.repeat(64), owner: id(1), project: 'wfc-pathfinder-local-abcdef123456', image: 'sha256:' + 'b'.repeat(64), runtimeInventorySha256: 'c'.repeat(64) };
  const control = createManagedProducerControl(configuration); services.push(control);
  const identity = { instanceId: id(2), projectId: id(3), modelVersionId: id(4), loadId: id(5), sessionId: id(6) };
  const resources = { projectId: identity.projectId, modelVersionId: identity.modelVersionId, sessionId: identity.sessionId, capability: 'd'.repeat(43) };
  const live = { allowed: true }, authorize = vi.fn(async () => { if (!live.allowed) throw new PathFinderError('TEST_GRANT_REVOKED', 403); });
  const input = { identity, resources, authorize };
  const { sessionId: _session, ...binding } = identity;
  const command = (requestId = id(7)) => ({ channel: 'wfc-routings-viewer', protocolVersion: 1, ...binding, requestId, type: 'READ_PREPARATION_OBJECTS',
    payload: { schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: 'names', names: ['/B001'], rootObjectId: null, cursor: 0, limit: 128 } }) as BridgeEnvelope;
  const response = (envelope = command()) => ({ ...envelope, type: 'PREPARATION_OBJECTS', payload: { schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: 'names', names: ['/B001'], rootObjectId: null,
    cursor: 0, matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', indexedObjectCount: 1, propertyScan: null, objects: [], nextCursor: null, complete: true } }) as BridgeEnvelope;
  const proof = { joined: true as const, removed: true as const, containerId: 'e'.repeat(64) };
  return { control, configuration, identity, resources, live, authorize, input, command, response, proof };
}
afterEach(() => { for (const control of services.splice(0)) control.stop(); vi.useRealTimers(); });

describe('private managed producer control ownership, cancellation and acknowledgements', () => {
  it('starts disabled and cannot manufacture an attempt or current grant', async () => {
    const control = createManagedProducerControl(); services.push(control);
    expect(control.configured).toBe(false); await expect(control.claim()).resolves.toBeNull();
    expect(() => control.authenticate('a'.repeat(64))).toThrow();
    await expect(control.register(fixture().input)).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_BUSY' });
  });
  it.each([undefined, 'Bearer human-login', 'b'.repeat(64), { userId: id(3), isAdmin: true }])('accepts no human or unknown host credential %j', credential => {
    const f = fixture(); expect(() => f.control.authenticate(credential)).toThrow(expect.objectContaining({ code: 'MANAGED_CONTROL_AUTH_REQUIRED' }));
    expect(() => f.control.authenticate(f.configuration.key)).not.toThrow();
  });
  it('binds one exact project/model/session and exposes resources only to the internal host claim', async () => {
    const f = fixture(); await expect(f.control.register({ ...f.input, resources: { ...f.resources, modelVersionId: id(99) } })).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_SCOPE_INVALID' });
    const handle = await f.control.register(f.input), claim = await f.control.claim();
    expect(claim).toMatchObject({ attemptId: handle.attemptId, identity: f.identity, resources: f.resources, owner: f.configuration.owner, image: f.configuration.image });
    expect(handle).not.toHaveProperty('resources'); expect(JSON.stringify(handle)).not.toContain(f.resources.capability);
    await expect(f.control.register(f.input)).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_BUSY' });
  });
  it('does not register work when the live grant closure refuses', async () => {
    const f = fixture(); f.live.allowed = false; await expect(f.control.register(f.input)).rejects.toMatchObject({ code: 'TEST_GRANT_REVOKED' }); expect(f.control.snapshot.attemptId).toBeNull();
  });
  it.each(['joined', 'quarantined'])('returns no claim for %s cleanup history without reauthorizing released work', async state => {
    const f = fixture(), handle = await f.control.register(f.input);
    if (state === 'joined') await f.control.joined(handle.attemptId, f.proof); else await f.control.fault(handle.attemptId);
    f.live.allowed = false; f.authorize.mockClear();
    await expect(f.control.claim()).resolves.toBeNull(); expect(f.authorize).not.toHaveBeenCalled();
  });
  it.each(['projectId', 'modelVersionId', 'loadId', 'instanceId'])('refuses a bridge command for another %s before enqueue', async field => {
    const f = fixture(), handle = await f.control.register(f.input);
    await expect(handle.exchange({ ...f.command(), [field]: id(99) })).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_COMMAND_INVALID' });
    expect((await f.control.next(handle.attemptId)).command).toBeNull();
  });
  it('exchanges one exact capture response and replays a lost reply ACK without executing it twice', async () => {
    const f = fixture(), handle = await f.control.register(f.input), command = f.command(), waiting = guard(handle.exchange(command)); await flush();
    expect((await f.control.next(handle.attemptId)).command).toMatchObject({ kind: 'exchange', envelope: command });
    const reply = { requestId: command.requestId, value: f.response(command) };
    await expect(f.control.reply(handle.attemptId, reply)).resolves.toEqual({ acknowledged: true, duplicate: false }); await expect(waiting).resolves.toEqual(reply.value);
    f.live.allowed = false; await expect(f.control.reply(handle.attemptId, reply)).resolves.toEqual({ acknowledged: true, duplicate: true });
    await expect(f.control.reply(handle.attemptId, { ...reply, value: { ...reply.value, requestId: id(99) } })).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_REPLY_CONFLICT' });
  });
  it('rechecks authority before publishing a reply and does not resolve revoked data', async () => {
    const f = fixture(), handle = await f.control.register(f.input), command = f.command(), waiting = guard(handle.exchange(command)); await flush(); f.live.allowed = false;
    await expect(f.control.reply(handle.attemptId, { requestId: command.requestId, value: f.response(command) })).rejects.toMatchObject({ code: 'TEST_GRANT_REVOKED' });
    await expect(waiting).rejects.toMatchObject({ code: 'TEST_GRANT_REVOKED' });
    await expect(f.control.joined(handle.attemptId, f.proof)).resolves.toMatchObject({ acknowledged: true, duplicate: false });
  });
  it('quarantines an unacknowledged outcome, yet accepts a later exact positive host join proof', async () => {
    vi.useFakeTimers(); const f = fixture(), handle = await f.control.register(f.input), waiting = guard(handle.exchange(f.command())); await flush();
    await vi.advanceTimersByTimeAsync(MANAGED_CONTROL_LIMITS.operationMilliseconds+MANAGED_CONTROL_LIMITS.initializeMilliseconds); await expect(waiting).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_OUTCOME_UNKNOWN' });
    f.live.allowed = false; await expect(f.control.fault(handle.attemptId)).resolves.toEqual({ quarantined: true });
    await expect(f.control.joined(handle.attemptId, f.proof)).resolves.toEqual({ acknowledged: true, duplicate: false }); await expect(handle.close()).resolves.toEqual({ joined: true });
  });
  it('bounds the first exchange by sequential host startup plus one operation and grants no startup allowance twice', async () => {
    vi.useFakeTimers(); const f = fixture(), handle = await f.control.register(f.input), firstCommand = f.command(), first = guard(handle.exchange(firstCommand)); await flush();
    expect(MANAGED_CONTROL_LIMITS.initializeMilliseconds).toBe(495000);
    expect(MANAGED_CONTROL_LIMITS.initializeMilliseconds + MANAGED_CONTROL_LIMITS.operationMilliseconds).toBe(675000);
    let settled = false; void first.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(675000 - 1);
    expect(settled).toBe(false); expect(f.control.snapshot.quarantined).toBe(false);
    await f.control.reply(handle.attemptId, { requestId: firstCommand.requestId, value: f.response(firstCommand) }); await first;
    const second = guard(handle.exchange(f.command(id(8)))); await flush();
    const refused = expect(second).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_OUTCOME_UNKNOWN' });
    await vi.advanceTimersByTimeAsync(MANAGED_CONTROL_LIMITS.operationMilliseconds); await refused;
    expect(f.control.snapshot).toMatchObject({ quarantined: true, joined: false }); expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for an exact independent host join after a data fault and never reopens data', async () => {
    vi.useFakeTimers(); const f = fixture(), handle = await f.control.register(f.input), command = f.command(), waiting = guard(handle.exchange(command)); await flush();
    await f.control.fault(handle.attemptId); await expect(waiting).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_OUTCOME_UNKNOWN' });
    f.live.allowed = false; const closing = guard(handle.close()); let settled = false;
    void closing.then(() => { settled = true; }, () => { settled = true; }); await flush();
    const cleanup = await f.control.next(handle.attemptId); expect(cleanup.command?.kind).toBe('close'); expect(cleanup.quarantined).toBe(true);
    // A second host fault cannot discard the independent join waiter.
    await f.control.fault(handle.attemptId); await vi.advanceTimersByTimeAsync(MANAGED_CONTROL_LIMITS.joinMilliseconds - 1);
    expect(settled).toBe(false); expect(f.control.snapshot.joined).toBe(false);
    await expect(handle.exchange(f.command(id(8)))).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_STATE_INVALID' });
    await expect(f.control.reply(handle.attemptId, { requestId: command.requestId, value: f.response(command) })).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_REPLY_INVALID' });
    await expect(f.control.register(f.input)).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_BUSY' });
    await f.control.joined(handle.attemptId, f.proof); await expect(closing).resolves.toEqual({ joined: true });
    expect(vi.getTimerCount()).toBe(0); expect(f.control.snapshot).toMatchObject({ joined: true, quarantined: true });
  });
  it('retains quarantine when no independent host join arrives within the cleanup deadline', async () => {
    vi.useFakeTimers(); const f = fixture(), handle = await f.control.register(f.input), command = f.command(), waiting = guard(handle.exchange(command)); await flush();
    await f.control.fault(handle.attemptId); await expect(waiting).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_OUTCOME_UNKNOWN' });
    const closing = guard(handle.close()); await flush(); const refused = expect(closing).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_OUTCOME_UNKNOWN' });
    await vi.advanceTimersByTimeAsync(MANAGED_CONTROL_LIMITS.joinMilliseconds); await refused;
    expect(f.control.snapshot).toMatchObject({ joined: false, quarantined: true }); expect(vi.getTimerCount()).toBe(0);
    await expect(f.control.register(f.input)).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_BUSY' });
    await expect(f.control.reply(handle.attemptId, { requestId: command.requestId, value: f.response(command) })).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_REPLY_INVALID' });
    await f.control.joined(handle.attemptId, f.proof);
    // Later truthful evidence does not retroactively change the expired caller outcome.
    await expect(handle.close()).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_OUTCOME_UNKNOWN' });
    expect(f.control.snapshot.joined).toBe(true);
  });
  it('keeps an expired data exchange failed while its separate cleanup waits for join', async () => {
    vi.useFakeTimers(); const f = fixture(), handle = await f.control.register(f.input), command = f.command(), waiting = guard(handle.exchange(command)); await flush();
    const refused = expect(waiting).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_OUTCOME_UNKNOWN' });
    await vi.advanceTimersByTimeAsync(MANAGED_CONTROL_LIMITS.initializeMilliseconds + MANAGED_CONTROL_LIMITS.operationMilliseconds); await refused;
    const closing = guard(handle.close()); await flush(); expect((await f.control.next(handle.attemptId)).command?.kind).toBe('close');
    await expect(f.control.reply(handle.attemptId, { requestId: command.requestId, value: f.response(command) })).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_REPLY_INVALID' });
    await f.control.joined(handle.attemptId, f.proof); await expect(closing).resolves.toEqual({ joined: true });
    await expect(waiting).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_OUTCOME_UNKNOWN' }); expect(vi.getTimerCount()).toBe(0);
  });
  it('close after revocation cancels pending data and queues cleanup without a new permission check', async () => {
    const f = fixture(), handle = await f.control.register(f.input), waiting = guard(handle.exchange(f.command())); await flush(); f.live.allowed = false;
    const closing = guard(handle.close()); await flush(); await expect(waiting).rejects.toMatchObject({ code: 'MANAGED_CAPTURE_CLOSED' });
    const next = await f.control.next(handle.attemptId); expect(next.command?.kind).toBe('close');
    await f.control.reply(handle.attemptId, { requestId: next.command!.requestId, value: f.proof }); await expect(closing).resolves.toEqual({ joined: true });
  });
  it('independent joined proof settles only cleanup and never resolves pending capture with the proof', async () => {
    const f = fixture(), handle = await f.control.register(f.input), waiting = guard(handle.exchange(f.command())); await flush(); f.live.allowed = false;
    await f.control.joined(handle.attemptId, f.proof); await expect(waiting).rejects.toMatchObject({ code: 'MANAGED_CAPTURE_CLOSED' });
    await expect(handle.close()).resolves.toEqual({ joined: true }); expect(f.control.snapshot.joined).toBe(true);
  });
  it('retains exact positive join ACKs across a new active attempt and rejects conflicting container evidence', async () => {
    const f = fixture(), old = await f.control.register(f.input); await f.control.joined(old.attemptId, f.proof);
    const fresh = await f.control.register(f.input); expect(f.control.snapshot.attemptId).toBe(fresh.attemptId);
    f.live.allowed = false; await expect(f.control.joined(old.attemptId, f.proof)).resolves.toEqual({ acknowledged: true, duplicate: true });
    await expect(f.control.joined(old.attemptId, { ...f.proof, containerId: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_JOIN_CONFLICT' });
    expect(f.control.snapshot).toMatchObject({ attemptId: fresh.attemptId, joined: false });
  });
  it.each([{ joined: false }, { removed: false }, { containerId: 'e'.repeat(64) + '\n' }, { extra: 'ignored' }])('refuses incomplete or inexact positive join proof %j', async change => {
    const f = fixture(), handle = await f.control.register(f.input);
    await expect(f.control.joined(handle.attemptId, { ...f.proof, ...change })).rejects.toBeDefined(); expect(f.control.snapshot.joined).toBe(false);
  });
  it('serializes the pending slot after async authority checks rather than overwriting a concurrent command', async () => {
    const f = fixture(), handle = await f.control.register(f.input); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); f.authorize.mockImplementation(async () => gate);
    const first = guard(handle.exchange(f.command(id(40)))), second = guard(handle.exchange(f.command(id(41)))); release(); await flush();
    await expect(second).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_STATE_INVALID' });
    const next = await f.control.next(handle.attemptId); expect(next.command?.requestId).toBe(id(40));
    await f.control.reply(handle.attemptId, { requestId: id(40), value: f.response(f.command(id(40))) }); await expect(first).resolves.toMatchObject({ requestId: id(40) });
  });
  it('a delayed reply cannot clear a replacement cleanup command after its grant await', async () => {
    const f = fixture(), handle = await f.control.register(f.input), waiting = guard(handle.exchange(f.command())); await flush();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); f.authorize.mockImplementationOnce(async () => gate);
    const reply = guard(f.control.reply(handle.attemptId, { requestId: id(7), value: f.response() })); await flush();
    const closing = guard(handle.close()); await flush(); release(); await expect(reply).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_REPLY_INVALID' });
    const next = await f.control.next(handle.attemptId); expect(next.command?.kind).toBe('close'); await expect(waiting).rejects.toMatchObject({ code: 'MANAGED_CAPTURE_CLOSED' });
    await f.control.joined(handle.attemptId, f.proof); await expect(closing).resolves.toEqual({ joined: true });
  });
  it('limits retained joined attempts without confusing an old reply with the active attempt', async () => {
    const f = fixture(), ids: string[] = [];
    for (let i = 0; i < 17; i++) { const handle = await f.control.register(f.input); ids.push(handle.attemptId); await f.control.joined(handle.attemptId, f.proof); }
    await expect(f.control.joined(ids[0], f.proof)).rejects.toMatchObject({ code: 'MANAGED_PRODUCER_ATTEMPT_NOT_FOUND' });
    await expect(f.control.joined(ids[1], f.proof)).resolves.toMatchObject({ duplicate: true }); expect(f.control.snapshot.attemptId).toBe(ids[16]);
  });
  it('keeps cleanup available when the exact exchange budget is exhausted', async () => {
    const f=fixture(),handle=await f.control.register(f.input);
    for(let i=0;i<MANAGED_CONTROL_LIMITS.messages;i++){
      const command=f.command(id(10000+i)),waiting=guard(handle.exchange(command));await flush();
      await f.control.reply(handle.attemptId,{requestId:command.requestId,value:f.response(command)});await waiting;
    }
    await expect(handle.exchange(f.command(id(99999)))).rejects.toMatchObject({code:'MANAGED_PRODUCER_MESSAGE_LIMIT'});
    const closing=guard(handle.close());await flush();const next=await f.control.next(handle.attemptId);
    expect(next.command?.kind).toBe('close');await f.control.joined(handle.attemptId,f.proof);await expect(closing).resolves.toEqual({joined:true});
  });
});
