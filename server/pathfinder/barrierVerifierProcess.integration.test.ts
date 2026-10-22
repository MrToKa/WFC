// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BARRIER_CAPTURE_VERSION, barrierCanonicalJson, type BarrierCapture } from '../../shared/pathfinderBarriers.js';
import { barrierEnumerationHashInput } from '../../viewer-runtime/barrier-capture.mjs';
import { BarrierGeometryRefusal, barrierVerifierResultSchema, runBarrierVerifier } from './barrierVerifier.js';

/** Actual Node -> bounded stdin -> .NET9 -> strict receipt process tests.
 * Run this file with one test worker in the root-owned Linux fixture only.
 * Synthetic geometry proves neither SDK coverage nor project publication. */
const testDll = process.env.PF_B2_VERIFIER_TEST_DLL;
const originalDll = process.env.PF_BARRIER_VERIFIER_DLL;
const allowedDirectory = '/workspace/pathfinder-engine/.scratch/barrier-capture-20261021/artifacts/bin/PathFinder.BarrierVerifier/release';
const id = (n: number) => `b2200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const valueHash = (value: unknown) => sha256(Buffer.from(barrierCanonicalJson(value)));
function cubeCapture(): BarrierCapture {
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const capture: BarrierCapture = { schemaVersion: BARRIER_CAPTURE_VERSION, captureId: id(1),
    scope: { projectId: id(2), modelVersionId: id(3), contentFingerprint: 'a'.repeat(64), selectionRevision: '1',
      captureFrameId: id(4), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' },
    selectedParents: [{ selectionId: id(5), kind: 'wall', objectId: 'dbid:10', dbId: 10, externalId: null,
      name: 'Synthetic closed cube', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }],
    fragments: [{ source: { fragmentId: 1, ownerObjectId: 'dbid:10', parentSelectionIds: [id(5)], sourceUnits: 'm', metresPerSourceUnit: 1,
      sourceToWorldMetres: matrix, transformSha256: valueHash(matrix) }, bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] },
    verticesMetres: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    triangleIndices: [0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
      3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5] }],
    observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [1], unavailableFragmentIds: [],
      enumerationSha256: 'c'.repeat(64) } };
  capture.observation.enumerationSha256 = valueHash(barrierEnumerationHashInput(capture)); return capture;
}
const capture = cubeCapture(), bytes = Buffer.from(barrierCanonicalJson(capture));
function restoreConfiguration() {
  if (originalDll === undefined) delete process.env.PF_BARRIER_VERIFIER_DLL;
  else process.env.PF_BARRIER_VERIFIER_DLL = originalDll;
}

describe.runIf(Boolean(testDll) && process.platform === 'linux')('PF-B2 actual Linux .NET verifier process in the explicit owned artifact directory', () => {
  beforeAll(async () => {
    if (!testDll || !path.isAbsolute(testDll) || path.basename(testDll) !== 'PathFinder.BarrierVerifier.dll')
      throw Error('An explicit absolute verifier test DLL is required.');
    const resolved = path.resolve(testDll), relative = path.relative(allowedDirectory, resolved);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw Error('Refuse a verifier outside the root-owned barrier capture release artifacts.');
    if (await fs.realpath(resolved) !== resolved) throw Error('Refuse a symlinked verifier fixture.');
    const directory = path.dirname(resolved);
    for (const name of ['PathFinder.BarrierVerifier.dll', 'PathFinder.Barriers.dll', 'PathFinder.BarrierVerifier.deps.json', 'PathFinder.BarrierVerifier.runtimeconfig.json']) {
      const filename = path.join(directory, name), stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 64 * 1024 ** 2)
        throw Error('Verifier fixture closure is missing or unsafe.');
    }
  });
  beforeEach(() => { process.env.PF_BARRIER_VERIFIER_DLL = testDll!; });
  afterEach(restoreConfiguration);

  it('qualifies a real closed cube and binds its exact input bytes, counts and versioned strict receipt', async () => {
    const actual = await runBarrierVerifier(bytes, new AbortController().signal);
    expect(actual.implementationSha256).toMatch(/^[a-f0-9]{64}$/);
    const result = barrierVerifierResultSchema.parse(actual.result);
    expect(result).toMatchObject({ schemaVersion: 'wfc.pf.barrier-verification-result.v1', producerVersion: 'wfc.pf.barrier-verifier.v1',
      status: 'geometry-qualified', captureSha256: sha256(bytes), evidence: { captureId: capture.captureId, scope: capture.scope,
        computationalMeshes: 1, fragmentCount: 1, vertexCount: 8, triangleCount: 12,
        topology: 'qualified-closed-consistent-two-manifold', selfIntersection: 'bounded-verification-passed',
        coverage: 'provided-fragments-only', sdkCoverageVerified: false, engineeringAccepted: false } });
    expect(result.evidence?.decompositionSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence?.verificationSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence!.numericToleranceMetres).toBeGreaterThanOrEqual(1e-9);
    expect(result.evidence!.numericToleranceMetres).toBeLessThanOrEqual(1e-3);
  }, 20000);

  it('refuses an overlapping invocation deterministically while the first awaits its implementation fingerprint', async () => {
    // The lane is taken synchronously before the first filesystem await. There
    // is no timer race, sleeping or assumption about .NET startup duration.
    const first = runBarrierVerifier(bytes, new AbortController().signal);
    const second = runBarrierVerifier(bytes, new AbortController().signal);
    const [accepted, blocked] = await Promise.allSettled([first, second]);
    expect(accepted.status).toBe('fulfilled');
    expect(blocked).toMatchObject({ status: 'rejected', reason: { code: 'BARRIER_VERIFIER_BUSY' } });
    if (accepted.status !== 'fulfilled') throw accepted.reason;
    expect(accepted.value.result.status).toBe('geometry-qualified');
    // Completion must reap the real child and release the lane for later work.
    const next = await runBarrierVerifier(bytes, new AbortController().signal);
    expect(next.implementationSha256).toBe(accepted.value.implementationSha256);
    expect(next.result).toEqual(accepted.value.result);
  }, 30000);
  it('distinguishes a fully hashed logical open-shell refusal from verifier availability or process failure', async () => {
    const open = cubeCapture(); open.fragments[0].triangleIndices.splice(-3);
    const openBytes = Buffer.from(barrierCanonicalJson(open));
    const rejected = runBarrierVerifier(openBytes, new AbortController().signal);
    await expect(rejected).rejects.toBeInstanceOf(BarrierGeometryRefusal);
    await expect(rejected).rejects.toMatchObject({ code: 'BARRIER_GEOMETRY_REFUSED', captureSha256: sha256(openBytes),
      implementationSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    // A joined logical refusal releases the bounded lane for another invocation.
    expect((await runBarrierVerifier(bytes, new AbortController().signal)).result.status).toBe('geometry-qualified');
  }, 30000);

  it('refuses missing deployment configuration without starting the verifier lane', async () => {
    delete process.env.PF_BARRIER_VERIFIER_DLL;
    await expect(runBarrierVerifier(bytes, new AbortController().signal)).rejects.toMatchObject({ code: 'BARRIER_VERIFIER_NOT_CONFIGURED' });
    process.env.PF_BARRIER_VERIFIER_DLL = testDll!;
    expect((await runBarrierVerifier(bytes, new AbortController().signal)).result.status).toBe('geometry-qualified');
  }, 20000);

  it('honors cancellation before fingerprint or spawn and leaves the next invocation available', async () => {
    const controller = new AbortController(), reason = new DOMException('Synthetic before-start cancellation.', 'AbortError');
    controller.abort(reason);
    await expect(runBarrierVerifier(bytes, controller.signal)).rejects.toBe(reason);
    expect((await runBarrierVerifier(bytes, new AbortController().signal)).result.status).toBe('geometry-qualified');
  }, 20000);
});
