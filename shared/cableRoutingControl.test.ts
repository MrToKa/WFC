import { describe, expect, it } from 'vitest';
import { applyCableRoutingMutation, automaticRoutingWriteAllowed, cableRoutingTone, effectiveCableRouting, emptyRoutingControl,
  executionRoutingReasons, latchExecutionRouting, releaseExecutionRouting, routingSegments, routingTextsMatch } from './cableRoutingControl';
const facts = { installLength: null, pullDate: null, connectedFrom: null, connectedTo: null, tested: null };
const manual = () => ({ ...emptyRoutingControl(), manualRouting: '/B001/B002', manualProtected: true });
describe('explicit cable routing intentions', () => {
  it('separates automatic output from protected selected routing', () => {
    expect(effectiveCableRouting(manual(), '/B003')).toBe('/B001/B002');
    expect(automaticRoutingWriteAllowed(manual(), facts)).toBe(false);
    expect(effectiveCableRouting(emptyRoutingControl(), '/B003')).toBe('/B003');
    expect(automaticRoutingWriteAllowed(emptyRoutingControl(), facts)).toBe(true);
  });
  it.each([false, true])('absent import column changes nothing (protect=%s)', protect => {
    const result = applyCableRoutingMutation({ control: manual(), facts, automaticRouting: '/B003', mutation: { kind: 'import', present: false, routing: null, protect } });
    expect(result.control).toEqual(manual()); expect(result.changed).toBe(false);
  });
  it('blank unprotected import is no-op but protected blank releases manual routing', () => {
    const input = { control: manual(), facts, automaticRouting: '/B003' };
    expect(applyCableRoutingMutation({ ...input, mutation: { kind: 'import', present: true, routing: ' ', protect: false } }).control).toEqual(manual());
    const cleared = applyCableRoutingMutation({ ...input, mutation: { kind: 'import', present: true, routing: '', protect: true } });
    expect(cleared.control.manualProtected).toBe(false); expect(effectiveCableRouting(cleared.control, '/B003')).toBe('/B003');
  });
  it('manual edits protect by default, uncheck and deletion select automatic fallback', () => {
    const input = { control: emptyRoutingControl(), facts, automaticRouting: '/B003' };
    const edited = applyCableRoutingMutation({ ...input, mutation: { kind: 'manual', routing: '/B001' } }).control;
    expect(edited.manualProtected).toBe(true);
    const unchecked = applyCableRoutingMutation({ ...input, control: edited, mutation: { kind: 'manual', routing: '/B001', manualProtected: false } }).control;
    expect(effectiveCableRouting(unchecked, '/B003')).toBe('/B003');
    const cleared = applyCableRoutingMutation({ ...input, control: edited, mutation: { kind: 'manual', routing: '' } }).control;
    expect(effectiveCableRouting(cleared, null)).toBeNull();
  });
  it.each([false, true])('filled import accepts value and never removes existing protection (%s)', protect => {
    expect(applyCableRoutingMutation({ control: manual(), facts, automaticRouting: null, mutation: { kind: 'import', present: true, routing: '/B004', protect } }).control)
      .toMatchObject({ manualRouting: '/B004', manualProtected: true });
  });
  it.each(['installLength', 'pullDate', 'connectedFrom', 'connectedTo', 'tested'] as const)('every execution fact protects route: %s', key => {
    const recorded = { ...facts, [key]: key === 'installLength' ? 12 : '2026-11-15' };
    const locked = latchExecutionRouting(manual(), recorded, '/B001/B002');
    expect(automaticRoutingWriteAllowed(locked, recorded)).toBe(false);
    expect(effectiveCableRouting(locked, '/B009')).toBe('/B001/B002');
    const refused = applyCableRoutingMutation({ control: locked, facts: recorded, automaticRouting: '/B009', mutation: { kind: 'import', present: true, routing: null, protect: true } });
    expect(refused.blockedReasons).toHaveLength(1); expect(refused.control).toEqual(locked);
  });
  it('clearing execution dates does not remove a latched lock; explicit reason required after facts cleared', () => {
    const locked = latchExecutionRouting(manual(), { ...facts, pullDate: '2026-11-15' }, '/B001/B002');
    expect(executionRoutingReasons(facts, locked.executionLocked)).toEqual(['EXECUTION_LOCK_RETAINED']);
    expect(automaticRoutingWriteAllowed(locked, facts)).toBe(false);
    expect(() => releaseExecutionRouting(locked, facts, '')).toThrow('ROUTING_UNLOCK_REASON_REQUIRED');
    expect(() => releaseExecutionRouting(locked, { ...facts, tested: '2026-11-15' }, 'Correction')).toThrow('ROUTING_EXECUTION_FACTS_PRESENT');
    expect(releaseExecutionRouting(locked, facts, 'Corrected execution report')).toMatchObject({ executionLocked: false });
  });
  it('records all reasons and freezes even a missing route without inventing automatic fallback', () => {
    const recorded = { ...facts, installLength: 10, pullDate: '2026-11-15', tested: '2026-11-15' };
    expect(executionRoutingReasons(recorded)).toHaveLength(3);
    const locked = latchExecutionRouting(emptyRoutingControl(), recorded, null);
    expect(effectiveCableRouting(locked, '/B099')).toBeNull();
  });
  it('zero installation length is not installation; preserves ordered repeated route occurrences', () => {
    expect(executionRoutingReasons({ ...facts, installLength: 0 })).toEqual([]);
    expect(routingSegments('/B001/ B002 /B001/SECONDARY')).toEqual(['B001', 'B002', 'B001', 'SECONDARY']);
    expect(routingTextsMatch('/B001/B002/B001', '/B001/B002')).toBe(false);
    expect(routingTextsMatch('/B001/ B002', '/B001/B002')).toBe(true);
  });
  it('displays valid automatic routes independently of the manual input length bound', () => {
    const longRoute = '/' + 'BC182/'.repeat(4000);
    expect(effectiveCableRouting(emptyRoutingControl(), longRoute)).toBe(longRoute);
    expect(cableRoutingTone(emptyRoutingControl(), longRoute)).toBe('automatic');
    expect(routingTextsMatch(longRoute, longRoute)).toBe(true);
  });
  it('marks the actual imported unprotected route when it differs from the calculated route', () => {
    expect(cableRoutingTone(emptyRoutingControl(), '/AUTO', false, '/IMPORTED')).toBe('warning');
  });
  it('invalid input cannot silently alter a route', () => {
    expect(() => routingSegments('/B001\u0000/B002')).toThrow();
    expect(() => routingSegments('x'.repeat(16385))).toThrow();
  });
  it('warning outranks execution, manual and automatic palette semantics', () => {
    expect(cableRoutingTone(emptyRoutingControl(), '/A')).toBe('automatic');
    expect(cableRoutingTone(manual(), '/B001/B002')).toBe('manual');
    const locked = latchExecutionRouting(manual(), { ...facts, pullDate: '2026-11-15' }, '/B001/B002');
    expect(cableRoutingTone(locked, '/B001/B002')).toBe('execution');
    expect(cableRoutingTone(locked, '/X')).toBe('warning');
    expect(cableRoutingTone(emptyRoutingControl(), null, true)).toBe('warning');
  });
});
