import { describe, expect, it, vi } from 'vitest';
import { TrayReportGeneration } from './trayReportGeneration';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return {promise, resolve}; }
describe('frozen tray report generation', () => {
  it('refuses upload when the same tray changes drawing or chart inputs during an awaited read', async () => {
    let identity = 'same-login/same-tray/snapshot-A/chart-A'; const read = deferred<string>(); const upload = vi.fn();
    const generation = new TrayReportGeneration(identity, () => identity);
    const flow = (async () => { const content = await generation.wait(read.promise); generation.assertCurrent(); upload(content); })();
    identity = 'same-login/same-tray/snapshot-A/chart-B'; read.resolve('captured A');
    await expect(flow).rejects.toThrow('inputs changed'); expect(upload).not.toHaveBeenCalled();
  });
  it('fences a snapshot refresh during asynchronous file encoding immediately before commit', async () => {
    let identity = 'snapshot-A'; const encode = deferred<string>(); const upload = vi.fn();
    const generation = new TrayReportGeneration(identity, () => identity);
    const flow = (async () => { const base64 = await generation.wait(encode.promise); generation.assertCurrent(); upload({base64}); })();
    identity = 'snapshot-B'; encode.resolve('immutable-image-A');
    await expect(flow).rejects.toThrow(); expect(upload).not.toHaveBeenCalled();
  });
  it('cancels old-login continuations and allows stable frozen data without reading changed live canvas state', async () => {
    const wait = deferred<void>(); let liveCanvas = 'A'; const capturedCanvas = liveCanvas; const upload = vi.fn();
    const generation = new TrayReportGeneration('snapshot-A', () => 'snapshot-A');
    const flow = (async () => { await generation.wait(wait.promise); generation.assertCurrent(); upload(capturedCanvas); })();
    liveCanvas = 'B'; wait.resolve(); await flow;
    expect(liveCanvas).toBe('B'); expect(upload).toHaveBeenCalledWith('A');
    generation.cancel(); await expect(generation.wait(Promise.resolve())).rejects.toThrow();
  });
});
