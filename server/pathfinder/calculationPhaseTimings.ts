/** Root-controlled, bounded diagnostics. Never part of a result or write authority. */
export type CalculationPhase = 'authority' | 'admission' | 'snapshot-read' | 'native' | 'settlement' | 'release';
type PhaseValue = { calls: number; milliseconds: number };
export type CalculationTimingRecord = {
  schemaVersion: 'wfc.pf.calculation-phase-timings.v1';
  jobId: string;
  outcome: 'completed' | 'deferred' | 'failed';
  wallMilliseconds: number;
  phases: Partial<Record<CalculationPhase, PhaseValue>>;
};
let emittedRows = 0, emittedBytes = 0;
const boundedSink = (record: CalculationTimingRecord): void => {
  if (emittedRows >= 64) return;
  const line = JSON.stringify(record) + '\n', bytes = Buffer.byteLength(line);
  if (bytes > 4096 || emittedBytes + bytes > 65536) return;
  emittedRows++; emittedBytes += bytes;
  process.stderr.write(line);
};
/** Timings are process-local estimates, not transaction timestamps or exact peaks.
 * A broken clock/sink cannot change the wrapped operation's result or exception. */
export function createCalculationPhaseTimings(jobId: unknown, options: {
  enabled?: boolean; now?: () => number; emit?: (record: CalculationTimingRecord) => void;
} = {}) {
  const enabled = (options.enabled ?? process.env.PF_CALCULATION_PHASES === '1')
    && typeof jobId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(jobId);
  const now = options.now ?? (() => performance.now()), phases: Partial<Record<CalculationPhase, PhaseValue>> = {};
  let finished = false;
  const clock = (): number => { try { const value = now(); return Number.isFinite(value) ? value : 0; } catch { return 0; } };
  const started = enabled ? clock() : 0;
  return {
    async measure<T>(phase: CalculationPhase, work: () => Promise<T>): Promise<T> {
      if (!enabled || finished) return work();
      const at = clock();
      try { return await work(); }
      finally {
        const previous = phases[phase] ?? { calls: 0, milliseconds: 0 };
        phases[phase] = { calls: Math.min(previous.calls + 1, 1_000_000),
          milliseconds: Math.min(86_400_000, previous.milliseconds + Math.max(0, clock() - at)) };
      }
    },
    finish(outcome: CalculationTimingRecord['outcome']): void {
      if (!enabled || finished) return;
      finished = true;
      try { (options.emit ?? boundedSink)({ schemaVersion: 'wfc.pf.calculation-phase-timings.v1', jobId: jobId as string,
        outcome, wallMilliseconds: Math.min(86_400_000, Math.max(0, clock() - started)), phases }); } catch { /* Optional sink only. */ }
    },
  };
}
