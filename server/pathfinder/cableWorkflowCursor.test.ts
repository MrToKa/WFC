// @vitest-environment node
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCableWorkflowCursor } from './cableWorkflowCursor.js';
import { CABLE_WORKFLOW_LIMITS } from '../../shared/pathfinderCableWorkflow.js';
import type { JobPrincipal } from './jobContracts.js';

const id = (value: number) => `ab000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const now = Date.UTC(2026, 9, 20, 18), projectId = id(1), last = id(4), queryHash = 'a'.repeat(64), contextHash = 'b'.repeat(64);
const key = Buffer.alloc(32, 0x42); // Synthetic key, never an application credential.
const principal = (): JobPrincipal => ({ userId: id(2), loginId: id(3), loginExpiresAt: now + 60_000 });
const payload = () => [1, projectId, last, queryHash, contextHash];
function signed(body: Buffer, who = principal()) {
  const signature = createHmac('sha256', key).update('wfc.pf.cable-workflow-cursor.v1\n')
    .update(`${who.userId}\n${who.loginId}\n${who.loginExpiresAt}\n`).update(body).digest();
  return Buffer.concat([body, signature]).toString('base64url');
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe('private query/context/principal-bound cable workflow scan cursors', () => {
  it('round-trips a bounded canonical scan boundary without including bearer credentials', () => {
    const cursor = createCableWorkflowCursor(key), who = principal(), encoded = cursor.encode(projectId, last, queryHash, contextHash, who);
    expect(encoded.length).toBeLessThanOrEqual(CABLE_WORKFLOW_LIMITS.cursorCharacters); expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor.decode(encoded, projectId, queryHash, contextHash, who)).toBe(last);
    expect(Buffer.from(encoded, 'base64url').subarray(0, -32).toString('utf8')).toBe(JSON.stringify(payload()));
    expect(cursor.decode(undefined, projectId, queryHash, contextHash, who)).toBeNull();
  });

  it('permits exact same-scope replay for Previous page instead of consuming a one-use token', () => {
    const cursor = createCableWorkflowCursor(key), who = principal(), encoded = cursor.encode(projectId, last, queryHash, contextHash, who);
    expect(cursor.decode(encoded, projectId, queryHash, contextHash, who)).toBe(last);
    expect(cursor.decode(encoded, projectId, queryHash, contextHash, who)).toBe(last);
  });

  it.each([
    ['project', id(8), queryHash, contextHash, principal()],
    ['query', projectId, 'c'.repeat(64), contextHash, principal()],
    ['context', projectId, queryHash, 'd'.repeat(64), principal()],
    ['account', projectId, queryHash, contextHash, { ...principal(), userId: id(8) }],
    ['login', projectId, queryHash, contextHash, { ...principal(), loginId: id(8) }],
    ['exact signed expiry', projectId, queryHash, contextHash, { ...principal(), loginExpiresAt: now + 120_000 }],
  ] as const)('refuses a cursor reused with a different %s', (_label, project, query, context, who) => {
    const cursor = createCableWorkflowCursor(key), encoded = cursor.encode(projectId, last, queryHash, contextHash, principal());
    expect(() => cursor.decode(encoded, project, query, context, who)).toThrow(expect.objectContaining({ code: 'WORKFLOW_CURSOR_INVALID', status: 409 }));
  });

  it('refuses a cursor from a different server key', () => {
    const cursor = createCableWorkflowCursor(key), encoded = cursor.encode(projectId, last, queryHash, contextHash, principal());
    expect(() => createCableWorkflowCursor(Buffer.alloc(32, 0x43)).decode(encoded, projectId, queryHash, contextHash, principal())).toThrow(expect.objectContaining({ code: 'WORKFLOW_CURSOR_INVALID' }));
  });

  it('rejects a changed scan boundary even when the body remains valid JSON', () => {
    const cursor = createCableWorkflowCursor(key), encoded = cursor.encode(projectId, last, queryHash, contextHash, principal()), bytes = Buffer.from(encoded, 'base64url');
    const changed = Buffer.from(JSON.stringify([1, projectId, id(8), queryHash, contextHash]));
    const tampered = Buffer.concat([changed, bytes.subarray(-32)]).toString('base64url');
    expect(() => cursor.decode(tampered, projectId, queryHash, contextHash, principal())).toThrow(expect.objectContaining({ code: 'WORKFLOW_CURSOR_INVALID' }));
  });

  it('rejects signature changes independently of otherwise valid canonical input', () => {
    const cursor = createCableWorkflowCursor(key), bytes = Buffer.from(cursor.encode(projectId, last, queryHash, contextHash, principal()), 'base64url'); bytes[bytes.length - 1] ^= 1;
    expect(() => cursor.decode(bytes.toString('base64url'), projectId, queryHash, contextHash, principal())).toThrow(expect.objectContaining({ code: 'WORKFLOW_CURSOR_INVALID' }));
  });

  it.each(['', 'YWJj=', 'not+base64', 'not/base64', 'abc\n', 'x'.repeat(CABLE_WORKFLOW_LIMITS.cursorCharacters + 1), Buffer.alloc(32).toString('base64url')])(
    'refuses malformed or oversized cursor transport %s', raw => {
      expect(() => createCableWorkflowCursor(key).decode(raw, projectId, queryHash, contextHash, principal())).toThrow(expect.objectContaining({ code: 'WORKFLOW_CURSOR_INVALID' }));
    });

  it('refuses noncanonical base64url aliases of exactly the same signed bytes', () => {
    const cursor = createCableWorkflowCursor(key), encoded = cursor.encode(projectId, last, queryHash, contextHash, principal()), bytes = Buffer.from(encoded, 'base64url');
    const alias = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'].map(character => encoded.slice(0, -1) + character)
      .find(candidate => candidate !== encoded && Buffer.from(candidate, 'base64url').equals(bytes));
    expect(alias).toBeDefined();
    expect(() => cursor.decode(alias!, projectId, queryHash, contextHash, principal())).toThrow(expect.objectContaining({ code: 'WORKFLOW_CURSOR_INVALID' }));
  });

  it.each([
    ['whitespace', Buffer.from(' ' + JSON.stringify(payload()))],
    ['unsupported version', Buffer.from(JSON.stringify([2, projectId, last, queryHash, contextHash]))],
    ['extra payload member', Buffer.from(JSON.stringify([...payload(), 'extra']))],
    ['missing payload member', Buffer.from(JSON.stringify(payload().slice(0, -1)))],
    ['invalid UUID', Buffer.from(JSON.stringify([1, projectId, 'not-a-cable', queryHash, contextHash]))],
    ['malformed JSON', Buffer.from('not json')],
    ['invalid UTF-8', Buffer.from([0xff, 0xfe, 0xfd])],
  ] as const)('refuses correctly signed but invalid %s', (_label, body) => {
    expect(() => createCableWorkflowCursor(key).decode(signed(body), projectId, queryHash, contextHash, principal())).toThrow(expect.objectContaining({ code: 'WORKFLOW_CURSOR_INVALID' }));
  });

  it.each(['encode', 'decode', 'first-page decode'] as const)('checks signed login expiry before %s', operation => {
    const cursor = createCableWorkflowCursor(key), who = principal(), encoded = cursor.encode(projectId, last, queryHash, contextHash, who);
    vi.setSystemTime(who.loginExpiresAt);
    const read = () => operation === 'encode' ? cursor.encode(projectId, last, queryHash, contextHash, who)
      : cursor.decode(operation === 'first-page decode' ? undefined : encoded, projectId, queryHash, contextHash, who);
    expect(read).toThrow(expect.objectContaining({ code: 'LOGIN_EXPIRED', status: 401 }));
  });

  it.each([0, 1, 31])('refuses private cursor keys shorter than32bytes (%s)', bytes => {
    expect(() => createCableWorkflowCursor(Buffer.alloc(bytes))).toThrow();
  });

  it.each([
    [id(1), 'not-a-cable', queryHash, contextHash], ['not-a-project', last, queryHash, contextHash],
    [projectId, last, 'bad-hash', contextHash], [projectId, last, queryHash, 'b'.repeat(63)],
  ])('never emits a cursor for invalid scope input %j', (project, cable, query, context) => {
    expect(() => createCableWorkflowCursor(key).encode(project, cable, query, context, principal())).toThrow();
  });
});
