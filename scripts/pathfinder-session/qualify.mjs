import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSessionEngineExecutor, engineSessionPolicy } from '/app/server/dist/server/pathfinder/engineSession.js';
import { runEngine } from '/app/server/dist/server/pathfinder/engine.js';
import { canonical, sha256, parseOutput, fail, validateCorpus, digest, equality, processRows, descendants, waitGone, classifyError } from './lib.mjs';

const mode = process.argv[2], modes = ['age', 'mixed', 'policy', 'rss', 'deadline'];
if (!modes.includes(mode)) fail('SESSION_MODE_INVALID');
const output = '/work/result.json', root = '/work/data';
const receipt = { schemaVersion: 'pathfinder.session.qualification.v1', mode, startedAt: new Date().toISOString(), status: 'FAIL', policy: engineSessionPolicy, checks: [], samples: [], events: [], scope: { sampledRss: 'Process-tree RSS estimate from sequential /proc reads; may miss short peaks; exact peak unproved.', graphPerQuery: true, noDatabase: true, noApply: true } };
let executor, sampleTimer, sampling = false, maximumRss = 0;
const observe = event => receipt.events.push({ ...event, atMilliseconds: performance.now(), at: new Date().toISOString() });
const fresh = request => ({ ...structuredClone(request), requestId: randomUUID() });
const write = async () => { const bytes = Buffer.from(JSON.stringify(receipt)); if (bytes.length > 32 * 1024 ** 2) fail('SESSION_RECEIPT_LIMIT'); await fs.writeFile(output, bytes); };
const check = (name, value, detail = {}) => { receipt.checks.push({ ...detail, name, status: value ? 'PASS' : 'FAIL' }); if (!value) fail('SESSION_CHECK_' + name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')); };
function create() { return createSessionEngineExecutor({ observe }); }
async function timed(request, kind, lane = executor, signal = new AbortController().signal) {
  const invocation = fresh(request), started = performance.now();
  const result = kind === 'fresh' ? await runEngine(invocation, signal, pid => observe({ type: 'oneshot-spawn', pid })) : await lane.execute(invocation, signal);
  const elapsed = performance.now() - started;
  receipt.samples.push({ kind, label: request._label ?? null, requestId: invocation.requestId, milliseconds: elapsed, semanticSha256: digest(result), response: result });
  return result;
}
async function close() { if (executor) { await executor.close(); executor = null; } }
async function rejection(promise) { try { await promise; return null; } catch (error) { return classifyError(error); } }
async function dispatchRequest(request, callback) {
  const before = receipt.events.length, promise = executor.execute(fresh(request), new AbortController().signal);
  const end = performance.now() + 6000;
  while (!receipt.events.slice(before).some(e => e.type === 'dispatch') && performance.now() < end) await new Promise(r => setTimeout(r, 1));
  const dispatch = receipt.events.slice(before).find(e => e.type === 'dispatch');
  if (!dispatch) { await promise.catch(() => undefined); fail('SESSION_DISPATCH_NOT_OBSERVED'); }
  await callback(dispatch, promise); return promise;
}
try {
  await fs.cp('/qualification/input', root, { recursive: true, errorOnExist: true, force: false });
  const corpus = validateCorpus(parseOutput(await fs.readFile(path.join(root, 'manifest.json')), 1024 ** 2));
  const baseline = corpus.cases.find(c => c.request.operation === 'calculate' && c.expectedStatus === 'calculated') ?? corpus.cases[0];
  receipt.input = { corpusSha256: sha256(await fs.readFile(path.join(root, 'manifest.json'))), cases: corpus.cases.length, baseline: baseline.label };
  process.env.PF_ROOT = root;
  executor = create();
  sampleTimer = setInterval(async () => {
    if (sampling) return; sampling = true;
    try { const rows = await processRows(), pids = new Set(receipt.events.filter(e => e.type === 'spawn').map(e => e.pid)); for (const pid of pids) { const tree = descendants(rows, pid), bytes = tree.reduce((sum, row) => sum + row.rssBytes, 0); maximumRss = Math.max(maximumRss, bytes); if (tree.length && receipt.samples.length < 30000) receipt.processSamples ??= []; if (tree.length && receipt.processSamples.length < 30000) receipt.processSamples.push({ atMilliseconds: performance.now(), rootPid: pid, bytes, processes: tree }); } } finally { sampling = false; }
  }, 50);
  if (mode === 'age') {
    const ageRequest = { ...baseline.request, timeoutMilliseconds: 5000 };
    const first = await timed(ageRequest, 'session'), firstPid = receipt.events.find(e => e.type === 'spawn').pid;
    check('initial-calculated', first.status === baseline.expectedStatus);
    const start = receipt.events.find(e => e.type === 'spawn').atMilliseconds;
    while (performance.now() - start < engineSessionPolicy.lifetimeMilliseconds + 500) {
      const remaining = engineSessionPolicy.lifetimeMilliseconds + 500 - (performance.now() - start);
      await new Promise(r => setTimeout(r, Math.min(20000, remaining)));
      await timed(ageRequest, 'session');
      receipt.ageProgressMilliseconds = performance.now() - start; await write();
    }
    await timed(ageRequest, 'session');
    const pids = [...new Set(receipt.events.filter(e => e.type === 'spawn').map(e => e.pid))];
    const ageRetirement = receipt.events.find(e => e.type === 'retire' && e.pid === firstPid);
    check('actual-ten-minute-age-recycled', pids.length >= 2 && ageRetirement && ageRetirement.atMilliseconds - start >= engineSessionPolicy.lifetimeMilliseconds - ageRequest.timeoutMilliseconds - 1000 && performance.now() - start >= engineSessionPolicy.lifetimeMilliseconds, { observedAgeMilliseconds: performance.now() - start, retirementAgeMilliseconds: ageRetirement?.atMilliseconds - start, reason: ageRetirement?.reason, requestDeadlineHeadroomMilliseconds: ageRequest.timeoutMilliseconds, pids });
    check('aged-group-gone', await waitGone(firstPid));
  } else if (mode === 'deadline') {
    await timed(baseline.request,'session');
    const old = receipt.events.length, oldPid = receipt.events.filter(e=>e.type==='spawn').at(-1).pid;
    const started = performance.now(); let response = null, code = null;
    try { response = await executor.execute(fresh({...baseline.request,timeoutMilliseconds:1}),new AbortController().signal); } catch(error) { code=classifyError(error); }
    const dispatched = receipt.events.slice(old).some(e=>e.type==='dispatch');
    check('real-one-ms-deadline-fenced', response?.status==='deadline_exceeded'||code==='ENGINE_DEADLINE', {dispatched,status:response?.status??null,code,milliseconds:performance.now()-started});
    check('real-deadline-group-gone',await waitGone(oldPid));
    check('real-deadline-next-recovers',(await timed(baseline.request,'session')).status===baseline.expectedStatus);
    await close(); process.env.PF_ENGINE_DLL='/qualification/deadline/NoResponseLane.dll'; executor=create();
    check('no-response-fixture-ready',(await timed(baseline.request,'session')).status==='prepared');
    const fixturePid=receipt.events.filter(e=>e.type==='spawn').at(-1).pid, fixtureStart=performance.now(), fixtureBefore=receipt.events.length;
    const hardCode=await rejection(executor.execute(fresh({...baseline.request,timeoutMilliseconds:100}),new AbortController().signal));
    const elapsed=performance.now()-fixtureStart;
    check('actual-node-hard-deadline',hardCode==='ENGINE_DEADLINE'&&elapsed>=1500&&elapsed<10000&&receipt.events.slice(fixtureBefore).some(e=>e.type==='dispatch'&&e.requestOrdinal===2),{code:hardCode,milliseconds:elapsed,testOnlyNoResponseFixture:true});
    check('hard-deadline-whole-group-gone',await waitGone(fixturePid)); await close();
    process.env.PF_ENGINE_DLL='/opt/pathfinder/PathFinder.ModelRunner.dll'; executor=create();
    check('hard-deadline-next-real-recovers',(await timed(baseline.request,'session')).status===baseline.expectedStatus);
  } else if (mode === 'rss') {
    receipt.scope.fakeFixtureOnly = true;
    const code = await rejection(executor.execute(fresh({ ...baseline.request, timeoutMilliseconds: 10000 }), new AbortController().signal));
    const pids = receipt.events.filter(e => e.type === 'spawn').map(e => e.pid), rss = receipt.events.filter(e => e.type === 'rss');
    check('actual-rss-threshold-crossed', rss.some(e => e.bytes > engineSessionPolicy.rssBytes), { maximumObservedGuardBytes: Math.max(0, ...rss.map(e => e.bytes)), code });
    check('rss-rejected', code === 'ENGINE_SESSION_RSS_LIMIT', { code });
    check('rss-whole-group-reaped', pids.length === 1 && await waitGone(pids[0]));
  } else if (mode === 'policy') {
    for (let index = 0; index < 65; index++) { const result = await timed(baseline.request, 'session'); check('count-query-' + (index + 1), result.status === baseline.expectedStatus); }
    const spawns = receipt.events.filter(e => e.type === 'spawn');
    check('count-64-recycles', spawns.length === 2 && receipt.events.some(e => e.type === 'result' && e.requestOrdinal === 64 && e.retireAfterResponse));
    check('count-old-group-gone', await waitGone(spawns[0].pid));
    await close(); executor = create();
    await timed(baseline.request, 'session'); const idlePid = receipt.events.filter(e => e.type === 'spawn').at(-1).pid;
    await new Promise(r => setTimeout(r, 31500));
    check('actual-idle-retired', await waitGone(idlePid)); await timed(baseline.request, 'session');
    check('idle-next-new-pid', receipt.events.filter(e => e.type === 'spawn').at(-1).pid !== idlePid);
    await close(); executor = create();
    const abort = new AbortController(), before = receipt.events.length;
    const pending = executor.execute(fresh(baseline.request), abort.signal), pendingOutcome = rejection(pending);
    while (!receipt.events.slice(before).some(e => e.type === 'dispatch')) await new Promise(r => setTimeout(r, 1));
    const cancelPid = receipt.events.slice(before).find(e => e.type === 'dispatch').pid;
    const busyCode = await rejection(executor.execute(fresh(baseline.request), new AbortController().signal));
    check('concurrent-rejected-without-dispatch', busyCode === 'ENGINE_SESSION_BUSY', { code: busyCode });
    abort.abort(); const cancelCode = await pendingOutcome;
    check('cancel-fenced', cancelCode === 'CALCULATION_CANCELLED', { code: cancelCode }); check('cancel-group-gone', await waitGone(cancelPid));
    check('cancel-next-recovers', (await timed(baseline.request, 'session')).status === baseline.expectedStatus);
    await close(); executor = create();
    const old = receipt.events.length, crashPromise = executor.execute(fresh(baseline.request), new AbortController().signal), crashOutcome = rejection(crashPromise);
    while (!receipt.events.slice(old).some(e => e.type === 'dispatch')) await new Promise(r => setTimeout(r, 1));
    const crashPid = receipt.events.slice(old).find(e => e.type === 'dispatch').pid;
    process.kill(-crashPid, 'SIGKILL'); const crashCode = await crashOutcome;
    check('crash-rejected-no-replay', Boolean(crashCode) && receipt.events.slice(old).filter(e => e.type === 'dispatch').length === 1, { code: crashCode }); check('crash-group-gone', await waitGone(crashPid));
    check('crash-next-recovers', (await timed(baseline.request, 'session')).status === baseline.expectedStatus);
  } else {
    const real = parseOutput(await fs.readFile('/qualification/real/request.json'), 1024 ** 2), reference = parseOutput(await fs.readFile('/qualification/real/reference.json'), 32 * 1024 ** 2);
    await fs.copyFile('/qualification/real/snapshot.json', path.join(root, 'snapshots', real.snapshotId + '.json'));
    const first = await timed(real, 'fresh'); check('real-existing-reference-route-design', canonical({ route: first.route, design: first.design, effectiveCategory: first.effectiveCategory }) === canonical({ route: reference.route, design: reference.design, effectiveCategory: reference.effectiveCategory }));
    const variants = [real, { ...real, from: first.route.pathPoints[Math.floor(first.route.pathPoints.length / 3)] }, real];
    for (let index = 0; index < variants.length; index++) { const oracle = await timed(variants[index], 'fresh'), actual = await timed(variants[index], 'session'); check('real-varied-' + index, equality(oracle, actual)); }
    const realResultEvents = receipt.events.filter(e => e.type === 'result'); check('actual-real-memory-reuse', realResultEvents.length === 3 && realResultEvents.slice(1).every(e => e.preparedReuse === 'memory') && new Set(realResultEvents.map(e => e.pid)).size === 1);
    const oracles = new Map();
    for (const item of corpus.cases) { const oracle = await timed(item.request, 'fresh'); oracles.set(item.label, oracle); const actual = await timed(item.request, 'session'); check('forward-' + item.label, equality(oracle, actual), { expectedStatus: item.expectedStatus, actualStatus: actual.status }); if (item.expectedStatus) check('expected-' + item.label, actual.status === item.expectedStatus); if (item.expectedLengthMeters !== null) check('length-' + item.label, actual.route?.lengthMeters === item.expectedLengthMeters); }
    await close(); executor = create();
    for (const item of [...corpus.cases].reverse()) { const actual = await timed(item.request, 'session'); check('reverse-order-' + item.label, equality(oracles.get(item.label), actual)); }
  }
  await close();
  const pids = [...new Set(receipt.events.filter(e => e.type === 'spawn').map(e => e.pid))];
  check('all-groups-reaped', (await Promise.all(pids.map(pid => waitGone(pid)))).every(Boolean), { pids });
  receipt.status = 'PASS';
} catch (error) { receipt.error = classifyError(error); receipt.status = 'FAIL'; }
finally { clearInterval(sampleTimer); try { await close(); } catch (error) { receipt.cleanupError = classifyError(error); receipt.status = 'FAIL'; } receipt.maximumSampledTreeRssEstimateBytes = maximumRss; receipt.finishedAt = new Date().toISOString(); await write(); }
console.log(JSON.stringify({ status: receipt.status, mode, checks: receipt.checks.length, error: receipt.error, output }));
process.exitCode = receipt.status === 'PASS' ? 0 : 1;
