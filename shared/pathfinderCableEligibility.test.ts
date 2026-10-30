// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isPathFinderCableEligible, routingEngineCategory } from './pathfinderCableEligibility.js';

describe('Purpose-based routing with optional MTO metadata', () => {
  it.each([null, undefined, '', 'LV', 'Power', 'VFD', 'Plastic tubing', 'Unknown'])('allows MTO %s without changing it', mto => {
    expect(isPathFinderCableEligible(mto)).toBe(true);
    expect(routingEngineCategory(mto)).toBe('LV');
  });
  it.each(['Control', 'Instrumentation'])('preserves internal Control geometry compatibility for %s', mto => {
    expect(isPathFinderCableEligible(mto)).toBe(true);
    expect(routingEngineCategory(mto)).toBe('Control');
  });
  it('excludes only explicit MV while preserving its engine class', () => {
    expect(isPathFinderCableEligible('MV')).toBe(false);
    expect(routingEngineCategory('MV')).toBe('MV');
  });
});
