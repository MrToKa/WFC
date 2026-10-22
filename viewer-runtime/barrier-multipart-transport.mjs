// Direct protected-frame staging. There is deliberately no general URL/fetch API.
import { BARRIER_MULTIPART_PRODUCER_PROFILE as PROFILE, BARRIER_MULTIPART_TRANSPORT_LIMITS as L,
  barrierMultipartTransportCanonical as canonical, barrierMultipartContextHashInput,
  validateBarrierMultipartStart, validateBarrierMultipartContext, validateBarrierMultipartSession,
  validateBarrierMultipartAdmitCommand, validateBarrierMultipartPage, validateBarrierMultipartSeal,
  validateBarrierMultipartProducerCompletionEvidence, validateBarrierMultipartCompleteProducerCommand, validateBarrierMultipartProducerCompletionReceipt,
  barrierMultipartProducerPartChainSeedHashInput, barrierMultipartProducerPartChainStepHashInput, barrierMultipartProducerPartChainFinalHashInput } from './barrier-multipart-protocol.mjs';
import { barrierCanonicalJson, barrierFrameObservationHashInput, validateBarrierFrameObservation } from './barrier-capture.mjs';

const E = new TextEncoder(), kinds = ['nodes', 'fragments', 'geometry-ranges', 'plan'];
const uuid = v => typeof v === 'string' && v.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(v);
const hash = v => typeof v === 'string' && v.length === 64 && /^[a-f0-9]{64}$/u.test(v);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))
  && Reflect.ownKeys(v).length === keys.length && keys.every(k => { const d = Object.getOwnPropertyDescriptor(v, k); return d && 'value' in d; });
const copy = v => JSON.parse(canonical(v));
const frozen = v => { if (v && typeof v === 'object') { for (const x of Object.values(v)) frozen(x); Object.freeze(v); } return v; };
const without = (v, key) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== key));
const same = (a, b) => canonical(a) === canonical(b);
const fail = (code, status) => { throw Object.assign(Error(code), { code, ...(status === undefined ? {} : { status }) }); };
const need = (value, code = 'BARRIER_MULTIPART_TRANSPORT_INVALID') => { if (!value) fail(code); };
const abortError = () => new DOMException('Protected multipart transport stopped.', 'AbortError');

async function responseJson(response, expectedUrl, maximum) {
  need(response && typeof response.status === 'number' && response.redirected !== true && (!response.url || response.url === expectedUrl), 'BARRIER_MULTIPART_RESPONSE');
  const type = response.headers?.get('content-type') ?? '';
  need(/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(type), 'BARRIER_MULTIPART_RESPONSE');
  const length = response.headers.get('content-length');
  need(length === null || /^(?:0|[1-9][0-9]*)$/u.test(length) && BigInt(length) <= BigInt(maximum), 'BARRIER_MULTIPART_RESPONSE_LIMIT');
  need(response.body && typeof response.body.getReader === 'function', 'BARRIER_MULTIPART_RESPONSE');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break;
      need(next.value instanceof Uint8Array && size + next.value.byteLength <= maximum, 'BARRIER_MULTIPART_RESPONSE_LIMIT');
      chunks.push(next.value.slice()); size += next.value.byteLength;
    }
  } finally { try { void reader.cancel().catch(() => {}); } catch { /* already closed */ } try { reader.releaseLock(); } catch { /* aborting native read */ } }
  if (length !== null) need(BigInt(length) === BigInt(size), 'BARRIER_MULTIPART_RESPONSE_LIMIT');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let result; try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('BARRIER_MULTIPART_RESPONSE'); }
  if (response.status < 200 || response.status >= 300) {
    const code = typeof result?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(result.code) ? result.code : 'BARRIER_MULTIPART_HTTP_REFUSED';
    fail(code, response.status);
  }
  return result;
}

/** All arguments are supplied by the owning bridge, never deserialized control
 * fields. Server authorization, exact cookie/context and immutable storage remain
 * authoritative; browser checks grant no geometry or publication authority. */
export function createBarrierMultipartTransport({ origin, projectId, modelVersionId, sessionId, loadId, isCurrent,
  fetchImpl = globalThis.fetch, sha256, randomUUID = () => globalThis.crypto.randomUUID(), signal: lifetime } = {}) {
  let parsed; try { parsed = new URL(origin); } catch { fail('BARRIER_MULTIPART_ORIGIN'); }
  need(['http:', 'https:'].includes(parsed.protocol) && parsed.origin === origin && !parsed.username && !parsed.password, 'BARRIER_MULTIPART_ORIGIN');
  need([projectId, modelVersionId, sessionId, loadId].every(uuid) && typeof isCurrent === 'function' && typeof fetchImpl === 'function' && typeof randomUUID === 'function');
  const base = origin + `/api/projects/${projectId}/model-versions/${modelVersionId}/viewer-sessions/${sessionId}/barrier-multipart/`;
  const current = () => { if (lifetime?.aborted || isCurrent() !== true) throw abortError(); };
  async function bounded(invoke, operationSignal, deadline = Infinity) {
    current(); if (operationSignal?.aborted) throw abortError();
    const remaining = Math.min(L.requestMilliseconds, deadline - Date.now()); need(remaining > 0, 'BARRIER_MULTIPART_DEADLINE');
    const timed = new AbortController(), combined = AbortSignal.any([timed.signal, ...(lifetime ? [lifetime] : []), ...(operationSignal ? [operationSignal] : [])]);
    const timer = setTimeout(() => timed.abort(), remaining); let onAbort;
    const stopped = new Promise((_resolve, reject) => { onAbort = () => reject(abortError()); combined.addEventListener('abort', onAbort, { once: true }); });
    try { const result = await Promise.race([Promise.resolve().then(() => { current(); if (combined.aborted) throw abortError(); return invoke(combined); }), stopped]);
      current(); if (combined.aborted) throw abortError(); need(Date.now() < deadline, 'BARRIER_MULTIPART_DEADLINE'); return result;
    } finally { clearTimeout(timer); combined.removeEventListener('abort', onAbort); }
  }
  async function digest(value, operationSignal, deadline, raw = false) {
    const bytes = raw ? value : E.encode(canonical(value));
    return bounded(async () => { const result = sha256 ? await sha256(bytes) : [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
      need(hash(result), 'BARRIER_MULTIPART_HASH'); return result; }, operationSignal, deadline);
  }
  const domainHash = (domain, value, operationSignal, deadline) => digest({ domain: 'wfc.pf.barrier-multipart.v2/' + domain, value }, operationSignal, deadline);
  const commandHash = (command, operationSignal, deadline) => digest({ domain: 'wfc.pf.barrier-multipart-session.v2/command', value: command }, operationSignal, deadline);
  const key = () => { const value = randomUUID(); need(uuid(value), 'BARRIER_MULTIPART_COMMAND_KEY'); return value; };
  async function request(suffix, { method = 'GET', json, bytes, header, signal } = {}, deadline) {
    const url = base + suffix;
    const headers = json === undefined ? bytes === undefined ? {} : { 'Content-Type': 'application/octet-stream', 'x-wfc-barrier-command': header }
      : { 'Content-Type': 'application/json' };
    const body = json === undefined ? bytes : canonical(json, L.commandBytes);
    return bounded(async combined => responseJson(await fetchImpl(url, { method, headers, body, signal: combined,
      credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', redirect: 'error' }), url, L.responseBytes), signal, deadline);
  }
  async function checkedContext(value, expected, operationSignal) {
    need(validateBarrierMultipartContext(value), 'BARRIER_MULTIPART_CONTEXT'); const c = copy(value), s = c.session, frame = c.context.frameObservation;
    const deadline = Date.parse(c.context.effectiveDeadline);
    need(s.id === expected.intentId && s.projectId === projectId && s.command.scope.modelScope.modelVersionId === modelVersionId && s.command.scope.modelLoadId === loadId
      && c.context.viewerSessionId === sessionId && frame.loadId === loadId && s.scopeSha256 === expected.scopeSha256 && s.profileSha256 === expected.profileSha256, 'BARRIER_MULTIPART_CONTEXT_CHANGED');
    need(await domainHash('scope', s.command.scope, operationSignal, deadline) === s.scopeSha256
      && await domainHash('profile', s.command.profile, operationSignal, deadline) === s.profileSha256
      && await commandHash(s.command, operationSignal, deadline) === s.requestSha256, 'BARRIER_MULTIPART_CONTEXT_HASH');
    const frameBytes = E.encode(barrierCanonicalJson(barrierFrameObservationHashInput(frame)));
    need(await digest(frameBytes, operationSignal, deadline, true) === frame.contentSha256, 'BARRIER_MULTIPART_CONTEXT_HASH');
    need(await digest(barrierMultipartContextHashInput(c), operationSignal, deadline) === c.context.contextSha256, 'BARRIER_MULTIPART_CONTEXT_HASH');
    // The old projection hash deliberately includes only canonical coordinates.
    need(await digest({ coordinateFrame: frame.coordinateFrame, displayToWorldMetres: frame.displayToWorldMetres, globalOffsetMetres: frame.globalOffsetMetres }, operationSignal, deadline)
      === s.command.scope.modelScope.captureFrameSha256, 'BARRIER_MULTIPART_CONTEXT_HASH');
    return c;
  }
  async function admit(command, frameObservation, { signal } = {}) {
    need(validateBarrierMultipartAdmitCommand(command) && validateBarrierFrameObservation(frameObservation), 'BARRIER_MULTIPART_ADMIT');
    const body = copy({ command, frameObservation, producerProfile: PROFILE });
    // The route's 64KiB ceiling includes the frame/profile envelope, not only
    // the B13b command. Refuse locally before issuing a possibly uncertain write.
    canonical(body, L.controlBytes);
    need(body.command.scope.modelScope.projectId === projectId && body.command.scope.modelScope.modelVersionId === modelVersionId && body.command.scope.modelLoadId === loadId
      && frameObservation.projectId === projectId && frameObservation.modelVersionId === modelVersionId && frameObservation.loadId === loadId, 'BARRIER_MULTIPART_CONTEXT_CHANGED');
    const receipt = await request('sessions', { method: 'POST', json: body, signal });
    need(exact(receipt, ['schemaVersion', 'session', 'duplicate']) && receipt.schemaVersion === 'wfc.pf.barrier-multipart-admit-receipt.v2'
      && typeof receipt.duplicate === 'boolean' && validateBarrierMultipartSession(receipt.session) && same(receipt.session.command, body.command), 'BARRIER_MULTIPART_RECEIPT');
    need(await commandHash(body.command, signal) === receipt.session.requestSha256
      && await domainHash('scope', body.command.scope, signal) === receipt.session.scopeSha256
      && await domainHash('profile', body.command.profile, signal) === receipt.session.profileSha256, 'BARRIER_MULTIPART_RECEIPT');
    return copy(receipt);
  }
  async function open(input, { signal } = {}) {
    need(validateBarrierMultipartStart(input), 'BARRIER_MULTIPART_START'); const start = copy(input);
    let context = await checkedContext(await request(start.intentId + '/context', { signal }), start, signal);
    need(context.session.sessionRevision === start.expectedSessionRevision, 'BARRIER_MULTIPART_SESSION_CHANGED');
    const original = frozen(copy(context)), deadline = Date.parse(original.context.effectiveDeadline), pending = new Map(), seals = new Map();
    let session = copy(context.session), busy = false, uploading = false, completion = null;
    let acknowledgedParts = 0, partChainPrevious = null, lastPartReceipt = null, partChainEligible = session.counts.parts === 0;
    context = undefined;
    const active = () => { current(); need(Date.now() < deadline, 'BARRIER_MULTIPART_DEADLINE'); };
    const exclusive = async work => { active(); need(!busy, 'BARRIER_MULTIPART_BACKPRESSURE'); busy = true; try { return await work(); } finally { busy = false; } };
    const baseCommand = revision => ({ intentId: session.id, expectedSessionRevision: revision, idempotencyKey: key(), scopeSha256: session.scopeSha256, profileSha256: session.profileSha256 });
    const snapshot = () => copy({ intentId: session.id, sessionRevision: session.sessionRevision, state: session.state, counts: session.counts, roots: session.roots,
      qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' });
    async function refresh(operationSignal) {
      const value = await checkedContext(await request(session.id + '/context', { signal: operationSignal }, deadline), start, operationSignal);
      need(value.context.contextSha256 === original.context.contextSha256 && same(value.session.principal, original.session.principal)
        && same(value.session.command, original.session.command) && value.session.requestSha256 === original.session.requestSha256
        && BigInt(value.session.sessionRevision) >= BigInt(session.sessionRevision), 'BARRIER_MULTIPART_CONTEXT_CHANGED');
      session = copy(value.session); return snapshot();
    }
    async function stageReceipt(value, item, operationSignal) {
      const c = item.command, isPage = 'page' in c, isSeal = 'seal' in c;
      const extra = isPage ? ['pageKind', 'index', 'firstOrdinal', 'recordCount', 'previousPageSha256', 'pageSha256'] : isSeal ? ['sealKind', 'sealSha256', 'pageCount', 'recordCount', 'tailPageSha256'] : ['partIndex', 'planSealSha256'];
      need(exact(value, ['schemaVersion', 'intentId', 'sessionRevision', 'commandSha256', 'scopeSha256', 'profileSha256', 'stored', 'duplicate', 'qualification', 'geometryValidation', 'authority', 'kind', ...extra])
        && value.schemaVersion === 'wfc.pf.barrier-multipart-stage-receipt.v2' && value.intentId === session.id && value.scopeSha256 === session.scopeSha256 && value.profileSha256 === session.profileSha256
        && value.commandSha256 === item.commandSha256 && value.sessionRevision === (BigInt(c.expectedSessionRevision) + 1n).toString() && typeof value.duplicate === 'boolean'
        && value.qualification === 'NOT_MEASURED' && value.geometryValidation === 'NOT_VALIDATED' && value.authority === 'none'
        && exact(value.stored, ['blobId', 'sha256', 'bytes', 'durability']) && uuid(value.stored.blobId) && value.stored.sha256 === item.rawSha256
        && value.stored.bytes === item.rawBytes && value.stored.durability === 'file-and-directory-fsynced', 'BARRIER_MULTIPART_RECEIPT');
      if (isPage) need(value.kind === 'page' && value.pageKind === c.page.kind && value.index === c.page.index && value.firstOrdinal === c.page.firstOrdinal
        && value.recordCount === c.page.records.length && value.previousPageSha256 === c.page.previousPageSha256 && value.pageSha256 === c.page.pageSha256, 'BARRIER_MULTIPART_RECEIPT');
      else if (isSeal) need(value.kind === 'seal' && value.sealKind === c.seal.kind && value.sealSha256 === c.seal.sealSha256 && value.pageCount === c.seal.pageCount
        && value.recordCount === c.seal.recordCount && value.tailPageSha256 === c.seal.tailPageSha256, 'BARRIER_MULTIPART_RECEIPT');
      else need(value.kind === 'part' && value.partIndex === c.partIndex && value.planSealSha256 === c.planSealSha256, 'BARRIER_MULTIPART_RECEIPT');
      // Only exact acknowledged parts enter this constant-space chain, once.
      // Opening an old writer cannot synthesize historical receipt evidence.
      let nextPartChain = null, repeatedPart = false;
      if (!isPage && !isSeal) {
        repeatedPart = value.partIndex === acknowledgedParts - 1 && lastPartReceipt !== null
          && same(without(value, 'duplicate'), without(lastPartReceipt, 'duplicate'));
        need(repeatedPart || value.partIndex === acknowledgedParts, 'BARRIER_MULTIPART_PART_ORDER');
        if (!repeatedPart && lastPartReceipt) need(BigInt(value.sessionRevision) > BigInt(lastPartReceipt.sessionRevision), 'BARRIER_MULTIPART_PART_ORDER');
        if (!repeatedPart && partChainEligible && kinds.every(k => hash(session.roots[k]))) {
          const seed = partChainPrevious ?? await digest(barrierMultipartProducerPartChainSeedHashInput({ intentId: session.id,
            contextSha256: original.context.contextSha256, scopeSha256: session.scopeSha256, profileSha256: session.profileSha256,
            frameSha256: original.context.frameObservation.contentSha256, roots: session.roots }), operationSignal, deadline);
          nextPartChain = await digest(barrierMultipartProducerPartChainStepHashInput(seed, value), operationSignal, deadline);
        }
      }
      if (BigInt(value.sessionRevision) > BigInt(session.sessionRevision)) {
        need(session.sessionRevision === c.expectedSessionRevision && session.state !== 'cancelled', 'BARRIER_MULTIPART_SESSION_CHANGED');
        const next = copy(session); next.sessionRevision = value.sessionRevision; next.state = 'staging'; next.counts[isPage ? 'pages' : isSeal ? 'seals' : 'parts']++;
        next.reservation.chargedBytes += 2 * item.rawBytes; next.reservation.chargedFiles += 2;
        need(next.reservation.chargedBytes <= next.reservation.bytes && next.reservation.chargedFiles <= next.reservation.files, 'BARRIER_MULTIPART_RECEIPT');
        if (isSeal) next.roots[c.seal.kind] = c.seal.sealSha256;
        session = next;
      }
      if (isSeal) seals.set(c.seal.kind, copy(c.seal));
      if (!isPage && !isSeal && !repeatedPart) { acknowledgedParts++; partChainPrevious = nextPartChain; lastPartReceipt = frozen(copy(value)); if (nextPartChain === null) partChainEligible = false; }
      return copy(value);
    }
    function completionReceipt(value, item) {
      const c = item?.command;
      need(validateBarrierMultipartProducerCompletionReceipt(value) && value.intentId === session.id && value.scopeSha256 === session.scopeSha256
        && value.profileSha256 === session.profileSha256 && value.contextSha256 === original.context.contextSha256
        && value.frameSha256 === original.context.frameObservation.contentSha256 && (session.state !== 'cancelled' || item !== undefined)
        && same(value.roots, session.roots) && value.partCount === session.counts.parts && session.counts.seals === 4
        && Date.parse(value.recordedAt) >= Date.parse(original.session.createdAt) && Date.parse(value.recordedAt) < deadline, 'BARRIER_MULTIPART_COMPLETION_RECEIPT');
      if (item) {
        need(value.commandSha256 === item.commandSha256 && value.sessionRevision === (BigInt(c.expectedSessionRevision) + 1n).toString()
          && ['contextSha256', 'frameSha256', 'partCount', 'partsSha256', 'bookendProfile'].every(k => value[k] === c[k]) && same(value.roots, c.roots)
          && (session.sessionRevision === c.expectedSessionRevision || session.sessionRevision === value.sessionRevision
            || session.state === 'cancelled' && BigInt(session.sessionRevision) > BigInt(value.sessionRevision)), 'BARRIER_MULTIPART_COMPLETION_RECEIPT');
        if (BigInt(value.sessionRevision) > BigInt(session.sessionRevision)) session.sessionRevision = value.sessionRevision;
      } else need(BigInt(value.sessionRevision) <= BigInt(session.sessionRevision), 'BARRIER_MULTIPART_COMPLETION_RECEIPT');
      if (completion) need(same(without(value, 'duplicate'), without(completion, 'duplicate')), 'BARRIER_MULTIPART_COMPLETION_RECEIPT');
      completion = frozen(copy(value)); return copy(value);
    }
    function cancelReceipt(value, item) {
      need(exact(value, ['schemaVersion', 'session', 'commandSha256', 'duplicate']) && value.schemaVersion === 'wfc.pf.barrier-multipart-cancel-receipt.v2'
        && value.commandSha256 === item.commandSha256 && typeof value.duplicate === 'boolean' && validateBarrierMultipartSession(value.session)
        && value.session.id === session.id && value.session.state === 'cancelled' && value.session.sessionRevision === (BigInt(item.command.expectedSessionRevision) + 1n).toString()
        && same(value.session.command, original.session.command) && same(value.session.principal, original.session.principal) && value.session.requestSha256 === original.session.requestSha256
        && value.session.scopeSha256 === session.scopeSha256 && value.session.profileSha256 === session.profileSha256
        && value.session.reservation.chargedBytes >= session.reservation.chargedBytes && value.session.reservation.chargedFiles >= session.reservation.chargedFiles
        && Object.keys(session.counts).every(k => value.session.counts[k] >= session.counts[k])
        && kinds.every(k => session.roots[k] === null || value.session.roots[k] === session.roots[k]), 'BARRIER_MULTIPART_RECEIPT');
      if (BigInt(value.session.sessionRevision) >= BigInt(session.sessionRevision)) session = copy(value.session);
      return copy(value);
    }
    async function sendWrite(command, wire, operationSignal, rawBytes, rawSha256) {
      need(pending.size < L.pendingCommands, 'BARRIER_MULTIPART_PENDING_REQUIRED');
      const commandSha256 = await commandHash(command, operationSignal, deadline), item = frozen({ command: copy(command), commandSha256, rawBytes, rawSha256 });
      need(!pending.has(command.idempotencyKey), 'BARRIER_MULTIPART_COMMAND_KEY'); pending.set(command.idempotencyKey, item);
      try { const result = await request(session.id + '/' + wire.suffix, { ...wire, signal: operationSignal }, deadline);
        active(); const receipt = command.schemaVersion === 'wfc.pf.barrier-multipart-cancel.v2' ? cancelReceipt(result, item)
          : command.schemaVersion === 'wfc.pf.barrier-multipart-complete-producer.v2' ? completionReceipt(result, item) : await stageReceipt(result, item, operationSignal);
        active(); pending.delete(command.idempotencyKey); return receipt;
      } catch (error) { try { error.uncertain = true; error.commandSha256 = commandSha256; } catch { /* frozen external errors */ } throw error; }
    }
    async function stage(event, { signal: operationSignal } = {}) {
      return exclusive(async () => {
        need(session.state !== 'cancelled' && pending.size === 0 && completion === null, 'BARRIER_MULTIPART_PENDING_REQUIRED');
        let c, body, header, raw, suffix;
        if (exact(event, ['kind', 'page']) && event.kind === 'page') {
          need(validateBarrierMultipartPage(event.page), 'BARRIER_MULTIPART_PAGE'); const page = copy(event.page);
          need(page.scopeSha256 === session.scopeSha256 && page.profileSha256 === session.profileSha256 && await domainHash('page', without(page, 'pageSha256'), operationSignal, deadline) === page.pageSha256, 'BARRIER_MULTIPART_PAGE_HASH');
          c = { ...baseCommand(session.sessionRevision), schemaVersion: 'wfc.pf.barrier-multipart-stage-page.v2', page }; raw = E.encode(canonical(page, L.pageBytes)); suffix = 'pages'; body = c;
        } else if (exact(event, ['kind', 'seal']) && event.kind === 'seal') {
          need(validateBarrierMultipartSeal(event.seal), 'BARRIER_MULTIPART_SEAL'); const seal = copy(event.seal);
          need(seal.scopeSha256 === session.scopeSha256 && seal.profileSha256 === session.profileSha256 && await domainHash('seal', without(seal, 'sealSha256'), operationSignal, deadline) === seal.sealSha256, 'BARRIER_MULTIPART_SEAL_HASH');
          c = { ...baseCommand(session.sessionRevision), schemaVersion: 'wfc.pf.barrier-multipart-stage-seal.v2', seal }; raw = E.encode(canonical(seal, L.pageBytes)); suffix = 'seals'; body = c;
        } else {
          need(exact(event, ['kind', 'partIndex', 'planSealSha256', 'bytes']) && event.kind === 'part' && Number.isSafeInteger(event.partIndex) && !Object.is(event.partIndex, -0)
            && event.partIndex >= 0 && event.partIndex < 1048576 && hash(event.planSealSha256) && event.planSealSha256 === session.roots.plan
            && event.partIndex === acknowledgedParts && session.counts.parts === acknowledgedParts
            && event.bytes instanceof Uint8Array && event.bytes.byteLength > 0 && event.bytes.byteLength <= L.partBytes, 'BARRIER_MULTIPART_PART');
          const partIndex = event.partIndex, planSealSha256 = event.planSealSha256;
          raw = new Uint8Array(event.bytes); const sha = await digest(raw, operationSignal, deadline, true);
          c = { ...baseCommand(session.sessionRevision), schemaVersion: 'wfc.pf.barrier-multipart-stage-part.v2', partIndex, planSealSha256, payload: { sha256: sha, bytes: raw.byteLength } };
          header = canonical(c, L.partHeaderBytes); need(!/[^\u0020-\u007e]/u.test(header), 'BARRIER_MULTIPART_PART_HEADER'); suffix = 'parts';
        }
        const rawSha256 = await digest(raw, operationSignal, deadline, true);
        return sendWrite(c, { suffix, method: suffix === 'parts' ? 'PUT' : 'POST', ...(body ? { json: body } : { bytes: raw, header }) }, operationSignal, raw.byteLength, rawSha256);
      });
    }
    async function completeProducer(input, { signal: operationSignal } = {}) {
      // Detach before any chain digest can yield to a mutating caller.
      need(validateBarrierMultipartProducerCompletionEvidence(input), 'BARRIER_MULTIPART_COMPLETION'); const evidence = copy(input);
      return exclusive(async () => {
        need(pending.size === 0 && completion === null && session.state === 'staging' && session.counts.seals === 4
          && evidence.contextSha256 === original.context.contextSha256 && evidence.frameSha256 === original.context.frameObservation.contentSha256
          && same(evidence.roots, session.roots) && evidence.partCount === session.counts.parts && acknowledgedParts === evidence.partCount
          && partChainEligible && hash(partChainPrevious) && seals.get('plan')?.totals.parts === evidence.partCount, 'BARRIER_MULTIPART_COMPLETION');
        const partsSha256 = await digest(barrierMultipartProducerPartChainFinalHashInput(partChainPrevious, acknowledgedParts), operationSignal, deadline);
        const command = { ...baseCommand(session.sessionRevision), schemaVersion: 'wfc.pf.barrier-multipart-complete-producer.v2', ...evidence, partsSha256 };
        need(validateBarrierMultipartCompleteProducerCommand(command), 'BARRIER_MULTIPART_COMPLETION');
        return sendWrite(command, { suffix: 'producer-completion', method: 'POST', json: command }, operationSignal, 0, null);
      });
    }
    async function readCompletion({ signal: operationSignal } = {}) {
      return exclusive(async () => {
        await refresh(operationSignal); need(session.state !== 'cancelled', 'BARRIER_MULTIPART_CANCELLED');
        const value = await request(session.id + '/producer-completion', { signal: operationSignal }, deadline);
        if (value === null) { need(completion === null, 'BARRIER_MULTIPART_COMPLETION_RECEIPT'); return null; }
        return completionReceipt(value);
      });
    }
    async function* readPages(kind, { signal: operationSignal } = {}) {
      need(kinds.includes(kind) && seals.has(kind), 'BARRIER_MULTIPART_STREAM_UNSEALED'); const seal = copy(seals.get(kind)); let previous = null, ordinal = 0;
      for (let index = 0; index < seal.pageCount; index++) {
        let page = await exclusive(() => request(session.id + '/pages/' + kind + '/' + index, { signal: operationSignal }, deadline));
        need(validateBarrierMultipartPage(page) && page.kind === kind && page.index === index && page.firstOrdinal === ordinal && page.previousPageSha256 === previous
          && page.scopeSha256 === session.scopeSha256 && page.profileSha256 === session.profileSha256, 'BARRIER_MULTIPART_PAGE');
        page = copy(page); need(await domainHash('page', without(page, 'pageSha256'), operationSignal, deadline) === page.pageSha256, 'BARRIER_MULTIPART_PAGE_HASH');
        ordinal += page.records.length; previous = page.pageSha256; active(); yield page; page = undefined;
      }
      need(ordinal === seal.recordCount && previous === seal.tailPageSha256, 'BARRIER_MULTIPART_STREAM_CHANGED');
    }
    async function cancel({ signal: operationSignal } = {}) {
      return exclusive(async () => {
        need(pending.size < L.pendingCommands, 'BARRIER_MULTIPART_PENDING_REQUIRED'); await refresh(operationSignal);
        need(session.state !== 'cancelled', 'BARRIER_MULTIPART_CANCELLED');
        const c = { ...baseCommand(session.sessionRevision), schemaVersion: 'wfc.pf.barrier-multipart-cancel.v2', reason: 'Cancelled from the protected Viewer.' };
        return sendWrite(c, { suffix: 'cancel', method: 'POST', json: c }, operationSignal, 0, null);
      });
    }
    async function reconcile(idempotencyKey, { signal: operationSignal } = {}) {
      return exclusive(async () => {
        need(uuid(idempotencyKey) && pending.has(idempotencyKey), 'BARRIER_MULTIPART_PENDING_REQUIRED'); const item = pending.get(idempotencyKey);
        const result = await request(session.id + '/reconcile', { method: 'POST', signal: operationSignal,
          json: { schemaVersion: 'wfc.pf.barrier-multipart-reconcile.v2', intentId: session.id, idempotencyKey, commandSha256: item.commandSha256 } }, deadline);
        const receipt = item.command.schemaVersion === 'wfc.pf.barrier-multipart-cancel.v2' ? cancelReceipt(result, item)
          : item.command.schemaVersion === 'wfc.pf.barrier-multipart-complete-producer.v2' ? completionReceipt(result, item) : await stageReceipt(result, item, operationSignal);
        pending.delete(idempotencyKey); return receipt;
      });
    }
    async function upload(events, { signal: operationSignal } = {}) {
      need(!uploading && events && (typeof events[Symbol.asyncIterator] === 'function' || typeof events[Symbol.iterator] === 'function'), 'BARRIER_MULTIPART_BACKPRESSURE');
      uploading = true; const iterator = events[Symbol.asyncIterator]?.() ?? events[Symbol.iterator](); let finished = false;
      try { for (;;) { let item = await bounded(() => iterator.next(), operationSignal, deadline); if (item.done) { finished = true; break; }
        await stage(item.value, { signal: operationSignal }); item = undefined;
      } return snapshot(); }
      finally { uploading = false; if (!finished && typeof iterator.return === 'function') { try { void Promise.resolve(iterator.return()).catch(() => {}); } catch { /* original refusal retained */ } } }
    }
    return Object.freeze({ context: original, snapshot, stage, readPages, completeProducer, readCompletion, cancel, reconcile, upload,
      completion: () => session.state === 'cancelled' ? null : completion && copy(completion),
      pending: () => [...pending.values()].map(copy), refresh: options => exclusive(() => refresh(options?.signal)) });
  }
  return Object.freeze({ admit, open });
}
