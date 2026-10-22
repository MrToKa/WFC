// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { verifierResidentObservation } from './barrierVerifier.js';

describe('bounded verifier resident observation', () => {
  it('retains actual resident usage even when a process is exiting', () => {
    expect(verifierResidentObservation('State:\tR (running)\nVmRSS:\t524289 kB\n')).toEqual({ state: 'resident', bytes: 524289 * 1024 });
    expect(verifierResidentObservation('State:\tZ (zombie)\nVmRSS:\t10 kB\n')).toEqual({ state: 'resident', bytes: 10240 });
  });
  it.each(['Z (zombie)', 'X (dead)'])('allows an exited %s sample to wait for child close', state => {
    expect(verifierResidentObservation(`Name:\tdotnet\nState:\t${state}\nPid:\t7\n`)).toEqual({ state: 'exited' });
  });
  it.each(['R (running)', 'S (sleeping)', 'D (disk sleep)', 'T (stopped)', ''])('refuses missing RSS for %s', state => {
    expect(verifierResidentObservation(`State:\t${state}\n`)).toEqual({ state: 'unavailable' });
  });
  it.each(['VmRSS:\t-1 kB\n', 'VmRSS:\t1 MB\n', 'VmRSS:\t9007199254740992 kB\n'])('refuses invalid resident sample %s', status => {
    expect(verifierResidentObservation(status)).toEqual({ state: 'unavailable' });
  });
});
