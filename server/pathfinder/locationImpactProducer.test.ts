// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLocationImpactProducer } from './locationImpactProducer.js';
import { PathFinderError } from './errors.js';
describe('bounded location impact producer; synthetic adapters only', () => {
  it('admits committed work without a browser and stops when nothing remains', async () => {
    const claimNext = vi.fn().mockResolvedValueOnce({ impactId: 'synthetic' }).mockResolvedValue(null), enrollClaim = vi.fn().mockResolvedValue({ status: 'enrolled' });
    const p = createLocationImpactProducer({ claimNext, enrollClaim }); await p.tick(); expect(enrollClaim).toHaveBeenCalledTimes(1); expect(claimNext).toHaveBeenCalledTimes(2); await p.stop();
  });
  it('never dispatches more than five admissions in a tick', async () => { const claimNext = vi.fn().mockResolvedValue({}), enrollClaim = vi.fn().mockResolvedValue({}); const p = createLocationImpactProducer({ claimNext, enrollClaim }); await p.tick(); expect(enrollClaim).toHaveBeenCalledTimes(5); await p.stop(); });
  it('single-flights concurrent ticks and does no work after stop', async () => {
    let done!: (value: null) => void; const claimNext = vi.fn().mockReturnValue(new Promise(resolve => { done = resolve; })), enrollClaim = vi.fn(); const p = createLocationImpactProducer({ claimNext, enrollClaim });
    const first = p.tick(), second = p.tick(); expect(first).toBe(second); done(null); await first; await p.stop(); await p.tick(); expect(claimNext).toHaveBeenCalledTimes(1);
  });
  it('reports bounded errors without letting a failed observer kill later work', async () => {
    const claimNext = vi.fn().mockRejectedValueOnce(new PathFinderError('LOCATION_IMPACT_AUTHORITY_EXPIRED', 409)).mockResolvedValue(null), enrollClaim = vi.fn(), onError = vi.fn(() => { throw Error('observer'); });
    const p = createLocationImpactProducer({ claimNext, enrollClaim }, { onError }); await p.tick(); expect(p.lastErrorCode).toBe('LOCATION_IMPACT_OBSERVER_FAILED'); expect(onError).toHaveBeenCalledWith('LOCATION_IMPACT_AUTHORITY_EXPIRED'); await p.stop();
  });
  it.each([0, 249, 15001, NaN])('refuses unbounded polling interval%s', pollMilliseconds => expect(() => createLocationImpactProducer({ claimNext: vi.fn(), enrollClaim: vi.fn() }, { pollMilliseconds })).toThrow());
});
