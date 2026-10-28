import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { parseOutput, validateManifest, validateResponse, sha256, canonical, routeDigest, fail } from './lib.mjs';
import { measureProcess, publicMeasurement } from './process.mjs';

const MAX_OUTPUT = 32 * 1024 ** 2, MAX_RETAINED_OUTPUTS = 256 * 1024 ** 2;
let retainedBytes = 0;
async function readJson(filename, maximum) { const stat = await fs.lstat(filename); if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) fail('CAPACITY_INPUT_FILE_INVALID'); return parseOutput(await fs.readFile(filename), maximum); }
async function writeOutput(filename, bytes) { retainedBytes += bytes.length; if (retainedBytes > MAX_RETAINED_OUTPUTS) fail('CAPACITY_RETAINED_OUTPUT_LIMIT'); await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o600 }); }
async function immutableSnapshot(input) {
  const real = await fs.realpath(input.path); if (real !== input.path || !(real.startsWith('/input/snapshots/') || real.startsWith('/work/bench/inputs/'))) fail('CAPACITY_SNAPSHOT_PATH_INVALID');
  const stat = await fs.lstat(real); if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 256 * 1024 ** 2) fail('CAPACITY_SNAPSHOT_SIZE_INVALID');
  const bytes = await fs.readFile(real); if (sha256(bytes) !== input.sha256) fail('CAPACITY_SNAPSHOT_HASH_CHANGED'); return bytes;
}
function validateBench(result, manifest) {
  if (result.schemaVersion !== 'pathfinder.capacity.result.v1' || !['PASS', 'FAIL'].includes(result.status) || !Array.isArray(result.datasets) || result.datasets.length !== 1 + manifest.syntheticSizes.length || result.inputSnapshotUnchanged !== true || result.scope?.engineeringAcceptance !== false || !Array.isArray(result.assemblies)) fail('CAPACITY_BENCH_RESULT_INVALID');
  for (const [index, dataset] of result.datasets.entries()) {
    if (!dataset.input || !Array.isArray(dataset.phases) || !['PASS', 'FAIL'].includes(dataset.status)) fail('CAPACITY_BENCH_DATASET_INVALID');
    validateManifest({ ...manifest, label: dataset.input.label, snapshot: dataset.input.snapshot, request: dataset.input.request });
    if (index === 0 ? dataset.input.kind !== 'copied-real' : dataset.input.kind !== 'synthetic') fail('CAPACITY_BENCH_KIND_INVALID');
    for (const phase of dataset.phases) {
      if (!['cold-fit', 'cold-query', 'warm-disk-fit', 'warm-disk-query', 'memory-fit-hit', 'memory-query'].includes(phase.name) || !['PASS', 'FAIL', 'TIMEOUT', 'CANCELLED', 'NOT_RUN'].includes(phase.status) || !phase.metrics || !Number.isFinite(phase.metrics.wallMilliseconds) || phase.metrics.wallMilliseconds < 0) fail('CAPACITY_BENCH_PHASE_INVALID');
    }
    if (dataset.status === 'PASS') {
      const phases = dataset.phases, cold = phases.find(p => p.name === 'cold-query'), coldFit = phases.find(p => p.name === 'cold-fit'), warmFit = phases.find(p => p.name === 'warm-disk-fit'), hit = phases.find(p => p.name === 'memory-fit-hit'), memories = phases.filter(p => p.name === 'memory-query');
      if (phases.some(p => p.status !== 'PASS') || !cold?.semantic || coldFit?.loadedFromDisk !== false || warmFit?.loadedFromDisk !== true || hit?.reusesPreparedReference !== true || memories.length !== manifest.repeatQueries || memories.some(p => p.matchesCold !== true || p.reusesPreparedReference !== true)) fail('CAPACITY_BENCH_PHASE_PROOF_INVALID');
      validateResponse({ ...cold.semantic, schemaVersion: 'pathfinder.model.response.v1', requestId: 'baseline', status: 'calculated', engineeringAccepted: false, prepared: { loadedFromDisk: false, engineeringAccepted: false } }, { requestId: 'baseline' });
    }
  }
  return result;
}
async function processControls(signal) {
  const checks = [], aborted = new AbortController(); aborted.abort();
  const before = await measureProcess(process.execPath, ['-e', 'process.exit(99)'], { signal: aborted.signal });
  checks.push({ name: 'pre-cancelled process does not spawn', status: before.status === 'CANCELLED' && !before.spawned ? 'PASS' : 'FAIL', observation: publicMeasurement(before) });
  const treeScript = "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});setInterval(()=>{},1000)";
  const timeout = await measureProcess(process.execPath, ['-e', treeScript], { timeoutMilliseconds: 250, signal });
  checks.push({ name: 'hard deadline retires the observed owned process group', status: timeout.status === 'TIMEOUT' && timeout.sampling.sawDescendant && timeout.cleanup.groupGone ? 'PASS' : 'FAIL', observation: publicMeasurement(timeout) });
  const overflow = await measureProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(4096));setInterval(()=>{},1000)"], { maximumOutputBytes: 1024, signal });
  checks.push({ name: 'oversized stdout is rejected without a false full-output hash', status: overflow.status === 'OUTPUT_LIMIT' && overflow.outputSha256 === null && overflow.cleanup.groupGone ? 'PASS' : 'FAIL', observation: publicMeasurement(overflow) });
  return checks;
}
function productionRequest(dataset, snapshotId, timeoutMilliseconds) {
  return { schemaVersion: 'pathfinder.model.runner.v1', requestId: randomUUID(), operation: 'calculate', projectId: dataset.snapshot.projectId, modelVersionId: dataset.snapshot.modelVersionId, snapshotId, snapshotSha256: dataset.snapshot.sha256, timeoutMilliseconds, category: dataset.request.category,
    from: Object.fromEntries(['x', 'y', 'z'].map((key, i) => [key, dataset.request.from[i]])), to: Object.fromEntries(['x', 'y', 'z'].map((key, i) => [key, dataset.request.to[i]])), projectSettings: dataset.request.projectSettings, options: dataset.request.options };
}
async function main() {
  const control = await readJson(process.argv[2], 1024 ** 2);
  if (control.schemaVersion !== 'pathfinder.capacity.container.v1' || control.manifest !== '/input/manifest.json' || control.reference !== '/input/reference.json' || control.wholeRunTimeoutMilliseconds !== 600000 || control.productionWarmQueries !== 2) fail('CAPACITY_CONTROL_INVALID');
  const manifestBytes = await fs.readFile(control.manifest), manifest = validateManifest(parseOutput(manifestBytes, 1024 ** 2)), reference = await readJson(control.reference, MAX_OUTPUT);
  validateResponse(reference, { requestId: reference.requestId });
  const started = performance.now(), controller = new AbortController(), deadlineAt = Date.now() + control.wholeRunTimeoutMilliseconds, timer = setTimeout(() => controller.abort(), control.wholeRunTimeoutMilliseconds);
  const result = { schemaVersion: 'pathfinder.capacity.measurements.v1', startedAt: new Date().toISOString(), status: 'FAIL', manifestSha256: sha256(manifestBytes), production: [], processControls: [], benchmark: null,
    methodology: { sampledProcessTreeRss: '20ms nominal interval, sequential non-atomic /proc VmRSS reads. Sampled tree RSS estimate may miss short peaks; exact coincident peak is unproved. Sampling overhead is included. Supervisor/descendant separate maxima must not be summed.', productionMode: 'Fresh .NET supervisor and owned worker on every query. Cold=empty fitted cache, warm=same disk cache in a new process. No endpoint graph reuse.', directBenchMode: 'Same PreparedModel references benchmarked separately; not implemented in the production worker.', wholePlantCapacity: 'NOT_ESTABLISHED', lookupTiming: 'NOT_MEASURED', nativeParity: 'NOT_PERFORMED', engineeringAcceptance: false } };
  try {
    result.processControls = await processControls(controller.signal);
    const benchmarkRun = await measureProcess('dotnet', ['/bench/PathFinder.CapacityBench.dll', '--manifest', control.manifest, '--work-root', '/work/bench'], { timeoutMilliseconds: manifest.totalTimeoutMilliseconds + 10000, maximumOutputBytes: 2 * 1024 ** 2, signal: controller.signal });
    result.benchmark = { measurement: publicMeasurement(benchmarkRun), status: benchmarkRun.status, fullOutputPath: '/work/bench.stdout.json' };
    if (!['PASS', 'EXIT_FAILED'].includes(benchmarkRun.status)) fail('CAPACITY_BENCH_PROCESS_INCOMPLETE');
    await writeOutput('/work/bench.stdout.json', benchmarkRun.output);
    const benchmark = validateBench(parseOutput(benchmarkRun.output, 2 * 1024 ** 2), manifest); result.benchmark.status = benchmark.status; result.benchmark.receiptSha256 = sha256(benchmarkRun.output); result.benchmark.datasetCount = benchmark.datasets.length;
    if (benchmarkRun.code !== (benchmark.status === 'PASS' ? 0 : 1)) fail('CAPACITY_BENCH_EXIT_MISMATCH');
    const realCold = benchmark.datasets[0].phases.find(p => p.name === 'cold-query');
    result.existingRealReference = { expectedSemanticSha256: routeDigest(reference), directSemanticSha256: realCold?.semantic ? routeDigest(realCold.semantic) : null, matches: Boolean(realCold?.semantic && routeDigest(realCold.semantic) === routeDigest(reference)) };
    if (!result.existingRealReference.matches) fail('CAPACITY_DIRECT_REAL_REFERENCE_MISMATCH');
    await fs.mkdir('/work/production');
    let hardFailure = result.processControls.some(check => check.status !== 'PASS') || benchmark.status === 'FAIL' || benchmark.controls?.status === 'FAIL';
    let partial = benchmark.status !== 'PASS' || benchmark.controls?.status !== 'PASS';
    for (const [index, item] of benchmark.datasets.entries()) {
      const dataset = item.input, cold = item.phases.find(p => p.name === 'cold-query'), entry = { label: dataset.label, kind: dataset.kind, status: 'NOT_RUN', queries: [], baselineSemanticSha256: cold?.semantic ? routeDigest(cold.semantic) : null };
      result.production.push(entry);
      if (!cold?.semantic || item.status !== 'PASS') { entry.reason = 'No successful complete direct baseline; scaling failure is retained in the benchmark receipt.'; partial = true; continue; }
      const bytes = await immutableSnapshot(dataset.snapshot), root = '/work/production/case-' + index, snapshotId = randomUUID(); await fs.mkdir(root); await fs.mkdir(root + '/snapshots'); await fs.writeFile(root + '/snapshots/' + snapshotId + '.json', bytes, { flag: 'wx' });
      let entryFailure = false, interrupted = false;
      for (let query = 0; query <= control.productionWarmQueries; query++) {
        const remaining = deadlineAt - Date.now(); if (remaining < 5000 || controller.signal.aborted) { interrupted = true; partial = true; break; }
        const request = productionRequest(dataset, snapshotId, Math.min(manifest.caseTimeoutMilliseconds, remaining - 1000)), input = JSON.stringify(request), requestPath = root + '/request-' + query + '.json';
        await writeOutput(requestPath, Buffer.from(input));
        const measured = await measureProcess('dotnet', ['/opt/pathfinder/PathFinder.ModelRunner.dll'], { input, env: { PF_ROOT: root }, timeoutMilliseconds: Math.min(request.timeoutMilliseconds + 5000, remaining), maximumOutputBytes: MAX_OUTPUT, signal: controller.signal });
        const observation = { phase: query === 0 ? 'one-shot-cold' : 'one-shot-disk-warm', iteration: query, status: measured.status, requestSha256: sha256(input), measurement: publicMeasurement(measured), responsePath: root + '/response-' + query + '.json' };
        entry.queries.push(observation);
        if (measured.status !== 'PASS') {
          if (['TIMEOUT', 'CANCELLED'].includes(measured.status)) { interrupted = true; partial = true; }
          else { entryFailure = true; observation.status = 'FAIL'; }
          observation.reason = 'No complete successful process output; not labelled a query success.'; break;
        }
        await writeOutput(observation.responsePath, measured.output);
        const response = validateResponse(parseOutput(measured.output, MAX_OUTPUT), request); observation.responseStatus = response.status;
        if (response.status !== 'calculated') {
          if (['resource_limit', 'deadline_exceeded'].includes(response.status)) { interrupted = true; partial = true; }
          else { observation.status = 'FAIL'; entryFailure = true; }
          break;
        }
        observation.semanticSha256 = routeDigest(response); observation.matchesDirectFullRouteAndDesign = observation.semanticSha256 === entry.baselineSemanticSha256;
        observation.matchesExistingRealReference = dataset.kind === 'copied-real' ? observation.semanticSha256 === result.existingRealReference.expectedSemanticSha256 : null;
        observation.loadedFromDisk = response.prepared.loadedFromDisk; observation.cacheStateExpected = response.prepared.loadedFromDisk === (query > 0); observation.fullPathPointCount = response.route.pathPoints.length;
        observation.segmentIdCount = response.route.segmentIds.length; observation.lengthMeters = response.route.lengthMeters; observation.designLengthMeters = response.design.designLengthMeters;
        observation.queryThroughputPerSecond = measured.wallMilliseconds > 0 ? 1000 / measured.wallMilliseconds : null;
        if (!observation.matchesDirectFullRouteAndDesign || observation.matchesExistingRealReference === false || !observation.cacheStateExpected || !measured.cleanup.groupGone || !measured.sampling.sawDescendant) { observation.status = 'FAIL'; entryFailure = true; }
      }
      entry.inputSnapshotUnchanged = sha256(await fs.readFile(root + '/snapshots/' + snapshotId + '.json')) === dataset.snapshot.sha256;
      entry.status = entryFailure || !entry.inputSnapshotUnchanged ? 'FAIL' : interrupted ? 'PARTIAL' : 'PASS'; hardFailure ||= entry.status === 'FAIL';
      const warm = entry.queries.filter(q => q.phase === 'one-shot-disk-warm' && q.status === 'PASS' && q.responseStatus === 'calculated'); entry.diskWarmThroughputQueriesPerSecond = warm.length ? 1000 * warm.length / warm.reduce((sum, q) => sum + q.measurement.wallMilliseconds, 0) : null;
      if (index === 0 && Date.now() + 5000 < deadlineAt) {
        const cancellation = new AbortController(), request = productionRequest(dataset, snapshotId, manifest.caseTimeoutMilliseconds);
        const measured = await measureProcess('dotnet', ['/opt/pathfinder/PathFinder.ModelRunner.dll'], { input: JSON.stringify(request), env: { PF_ROOT: root }, signal: cancellation.signal, timeoutMilliseconds: 5000, onSample: observed => { if (observed.descendants > 0) cancellation.abort(); } });
        const check = { name: 'cancellation retires an actually observed production .NET supervisor/worker group', status: measured.status === 'CANCELLED' && measured.sampling.sawDescendant && measured.cleanup.groupGone ? 'PASS' : 'FAIL', observation: publicMeasurement(measured) }; result.processControls.push(check); hardFailure ||= check.status !== 'PASS';
      }
    }
    result.status = hardFailure ? 'FAIL' : partial ? 'PARTIAL' : 'PASS';
  } catch (error) { result.error = error.code ?? 'CAPACITY_MEASUREMENT_FAILED'; result.status = 'FAIL'; }
  finally {
    clearTimeout(timer); result.wholeDeadlineReached = controller.signal.aborted;
    try { const peak = Number((await fs.readFile('/sys/fs/cgroup/memory.peak', 'utf8')).trim()); result.containerCgroupMemoryPeakBytes = Number.isFinite(peak) ? peak : null; result.containerCgroupPeakScope = 'Lifetime of this complete test container, including Node sampler, benchmark and all sequential children. Not per-query and not source API usage.'; } catch { result.containerCgroupMemoryPeakBytes = null; }
    result.wallMilliseconds = performance.now() - started; result.retainedRequestResponseBytes = retainedBytes; result.finishedAt = new Date().toISOString();
    await fs.writeFile('/work/result.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ status: result.status, result: '/work/result.json', datasets: result.production.length, error: result.error })); process.exitCode = result.status === 'FAIL' ? 1 : 0;
}
main().catch(error => { console.error(JSON.stringify({ status: 'FAIL', code: error.code ?? 'CAPACITY_SETUP_FAILED' })); process.exitCode = 1; });
