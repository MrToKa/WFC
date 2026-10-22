import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BARRIER_LIMITS, BARRIER_COLLISION_VERSION, barrierModelScopeSchema } from '../../shared/pathfinderBarriers.js';
import { MIXED_BARRIER_COLLISION_VERSION, mixedBarrierVerifierReceiptSchema,
  type MixedBarrierVerifierReceipt } from '../../shared/pathfinderBarrierMixed.js';
import { policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { parsePolicyJson } from './policyJson.js';
import { PathFinderError } from './errors.js';

export const barrierVerifierResultSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-verification-result.v1'), producerVersion: z.literal('wfc.pf.barrier-verifier.v1'),
  status: z.enum(['geometry-qualified', 'refused']), captureSha256: policyHashSchema.nullable(),
  evidence: z.object({ captureId: policyUuidSchema, scope: barrierModelScopeSchema,
    computationalMeshes: z.number().int().positive().max(BARRIER_LIMITS.computationalMeshes),
    fragmentCount: z.number().int().positive().max(BARRIER_LIMITS.fragments),
    vertexCount: z.number().int().positive().max(BARRIER_LIMITS.vertices), triangleCount: z.number().int().positive().max(BARRIER_LIMITS.triangles),
    decompositionSha256: policyHashSchema, verificationSha256: policyHashSchema,
    topology: z.literal('qualified-closed-consistent-two-manifold'), selfIntersection: z.literal('bounded-verification-passed'),
    numericToleranceMetres: z.number().finite().min(1e-9).max(1e-3), coverage: z.literal('provided-fragments-only'),
    sdkCoverageVerified: z.literal(false), engineeringAccepted: z.literal(false),
  }).strict().nullable(), diagnostics: z.array(z.object({ code: z.string().min(1).max(96), message: z.string().max(2048) }).strict()).max(64),
}).strict();
export type BarrierVerifierResult = z.infer<typeof barrierVerifierResultSchema>;
const refuse = (code: string): never => { throw new PathFinderError(code, 503, 'Barrier geometry could not be qualified within its bounded verifier.'); };
/** Logical refusal of one fully hashed input by the unchanged, joined verifier.
 * Operational failures never construct this server-internal evidence type. */
export class BarrierGeometryRefusal extends PathFinderError {
  readonly captureSha256: string;
  readonly implementationSha256: string;
  constructor(captureSha256: string, implementationSha256: string, mode: 'closed-v1' | 'mixed-v2' = 'closed-v1') {
    super('BARRIER_GEOMETRY_REFUSED', 503, mode === 'closed-v1' ? 'The selected geometry did not qualify as supported closed obstacles.'
      : 'The selected geometry did not qualify as supported original surfaces and closed obstacles.');
    this.captureSha256 = policyHashSchema.parse(captureSha256);
    this.implementationSha256 = policyHashSchema.parse(implementationSha256);
  }
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** An exited Linux task can remain in /proc until its child close is delivered.
 * It has no resident address space, but this observation never confirms reaping. */
export function verifierResidentObservation(status: string): { state: 'resident'; bytes: number } | { state: 'exited' } | { state: 'unavailable' } {
  const resident = /^VmRSS:\s*(\d+)\s+kB\s*$/m.exec(status);
  if (resident) {
    const bytes = Number(resident[1]) * 1024;
    return Number.isSafeInteger(bytes) && bytes >= 0 ? { state: 'resident', bytes } : { state: 'unavailable' };
  }
  return /^State:\s+[ZX]\s*(?:\([^\r\n]*\))?\s*$/m.test(status) ? { state: 'exited' } : { state: 'unavailable' };
}

/** Hash the deployed executable closure before/after invocation. No request paths or shell. */
async function implementation(dll: string, mode: 'closed-v1' | 'mixed-v2'): Promise<string> {
  if (!path.isAbsolute(dll) || path.basename(dll) !== 'PathFinder.BarrierVerifier.dll') return refuse('BARRIER_VERIFIER_NOT_CONFIGURED');
  const directory = path.dirname(dll), sum = createHash('sha256');
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(await fs.realpath(current)) !== current) return refuse('BARRIER_VERIFIER_PATH');
    if (path.dirname(current) === current) break;
  }
  for (const name of ['PathFinder.BarrierVerifier.dll', 'PathFinder.Barriers.dll', 'PathFinder.BarrierVerifier.deps.json', 'PathFinder.BarrierVerifier.runtimeconfig.json']) {
    const filename = path.join(directory, name), stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 64 * 1024 ** 2) return refuse('BARRIER_VERIFIER_PATH');
    const bytes = await fs.readFile(filename); if (bytes.length !== stat.size) return refuse('BARRIER_VERIFIER_CHANGED');
    sum.update(name + '\n' + bytes.length + '\n').update(bytes).update('\n');
  }
  return sum.update(mode === 'closed-v1' ? BARRIER_COLLISION_VERSION : MIXED_BARRIER_COLLISION_VERSION).digest('hex');
}

/** The deployed verifier is Linux-only until another RSS monitor is qualified.
 * Separate lane is globally serialized; it must not overlap the PF engine lane
 * in a combined resource claim. This function claims only its own process bound. */
let running = false;
async function runVerifierMode(bytes: Buffer, signal: AbortSignal, mode: 'closed-v1' | 'mixed-v2'): Promise<{ result: BarrierVerifierResult | MixedBarrierVerifierReceipt; implementationSha256: string }> {
  signal.throwIfAborted();
  if (bytes.length < 1 || bytes.length > BARRIER_LIMITS.captureBytes) return refuse('BARRIER_VERIFIER_INPUT_LIMIT');
  const dll = process.env.PF_BARRIER_VERIFIER_DLL;
  if (!dll || process.platform !== 'linux') return refuse('BARRIER_VERIFIER_NOT_CONFIGURED');
  if (running) return refuse('BARRIER_VERIFIER_BUSY');
  running = true;
  let processJoined = true;
  try {
    const before = await implementation(dll, mode); signal.throwIfAborted();
    const child = spawn('dotnet', mode === 'closed-v1' ? [dll] : [dll, '--mixed-v2'], { shell: false, detached: true, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DOTNET_GCHeapHardLimit: '10000000', DOTNET_EnableDiagnostics: '0' } });
    processJoined = false;
    const resultBytes = await new Promise<Buffer>((resolve, reject) => {
      let settled = false, sampling = false, outputBytes = 0, errorBytes = 0, termination: Error | undefined, joinTimer: NodeJS.Timeout | undefined;
      const chunks: Buffer[] = [];
      const finish = (cause?: Error) => {
        if (settled) return; settled = true; clearTimeout(timer); clearInterval(monitor); signal.removeEventListener('abort', abort);
        if (cause) {
          termination = cause;
          if (!child.pid || processJoined) { processJoined = true; reject(cause); return; }
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          // Do not release the serialized lane before close/reap. An uncertain
          // join poisons the lane until restart instead of starting another child.
          joinTimer = setTimeout(() => reject(failure('BARRIER_VERIFIER_JOIN_UNCONFIRMED')), 10_000);
        }
        else resolve(Buffer.concat(chunks));
      };
      const failure = (code: string) => new PathFinderError(code, 503, 'Barrier verifier refused or exceeded its limits.');
      const abort = () => finish(new DOMException('Barrier verification cancelled.', 'AbortError'));
      const timer = setTimeout(() => finish(failure('BARRIER_VERIFIER_TIMEOUT')), 65_000);
      const monitor = setInterval(() => { if (settled || sampling || !child.pid) return; sampling = true;
        void fs.readFile('/proc/' + child.pid + '/status', 'utf8').then(status => {
          const observation = verifierResidentObservation(status);
          // An exited sample still waits for close/reap, output and all hashes.
          if (observation.state === 'unavailable') finish(failure('BARRIER_VERIFIER_RSS_UNAVAILABLE'));
          else if (observation.state === 'resident' && observation.bytes > 512 * 1024 ** 2) finish(failure('BARRIER_VERIFIER_RSS_LIMIT'));
        }).catch(cause => { if (!settled && (cause as NodeJS.ErrnoException).code !== 'ENOENT') finish(failure('BARRIER_VERIFIER_RSS_UNAVAILABLE')); })
          .finally(() => { sampling = false; }); }, 100);
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      child.stdout.on('data', (chunk: Buffer) => { outputBytes += chunk.length; if (outputBytes > 65536) finish(failure('BARRIER_VERIFIER_OUTPUT_LIMIT')); else chunks.push(chunk); });
      child.stderr.on('data', (chunk: Buffer) => { errorBytes += chunk.length; if (errorBytes > 65536) finish(failure('BARRIER_VERIFIER_STDERR_LIMIT')); });
      child.once('error', () => finish(failure('BARRIER_VERIFIER_START_FAILED')));
      child.stdin.on('error', () => finish(failure('BARRIER_VERIFIER_INPUT_FAILED')));
      child.once('close', code => { processJoined = true; clearTimeout(joinTimer);
        if (termination) reject(termination); else if (code === 0) finish(); else finish(failure('BARRIER_VERIFIER_REFUSED')); });
      if (!settled) child.stdin.end(bytes);
    });
    signal.throwIfAborted();
    const result = (mode === 'closed-v1' ? barrierVerifierResultSchema : mixedBarrierVerifierReceiptSchema).parse(parsePolicyJson(resultBytes, { maxBytes: 65536 }));
    if (await implementation(dll, mode) !== before || result.captureSha256 !== digest(bytes)) return refuse('BARRIER_VERIFIER_CHANGED');
    if (result.status === 'refused' && result.evidence === null) throw new BarrierGeometryRefusal(digest(bytes), before, mode);
    if (result.status !== 'geometry-qualified' || !result.evidence) return refuse('BARRIER_VERIFIER_RESULT_INVALID');
    return { result, implementationSha256: before };
  } finally { if (processJoined) running = false; }
}

/** Existing callers and injected v1 executors retain their original result type. */
export async function runBarrierVerifier(bytes: Buffer, signal: AbortSignal): Promise<{ result: BarrierVerifierResult; implementationSha256: string }> {
  const executed = await runVerifierMode(bytes, signal, 'closed-v1');
  return { ...executed, result: barrierVerifierResultSchema.parse(executed.result) };
}
/** This mode is selected only from the server's frozen explicit v2 intent. */
export async function runMixedBarrierVerifier(bytes: Buffer, signal: AbortSignal): Promise<{ result: MixedBarrierVerifierReceipt; implementationSha256: string }> {
  const executed = await runVerifierMode(bytes, signal, 'mixed-v2');
  return { ...executed, result: mixedBarrierVerifierReceiptSchema.parse(executed.result) };
}
