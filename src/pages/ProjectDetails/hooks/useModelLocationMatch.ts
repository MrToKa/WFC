import { generateId } from '@/utils/generateId';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canonicalPurposeJson, parsePurposeJson, policyUuidSchema } from '../../../../shared/pathfinderPurposePolicy';
import { normalizeEndpointLocation } from '../../../../shared/pathfinderEndpointBindings';
import { MODEL_LOCATION_MATCH_LIMITS, modelLocationMatchAssignSchema, type ModelLocationMatchResult } from '../../../../shared/pathfinderModelLocationMatch';
import { preparationEquipmentNameBatches } from '../../../../shared/collectPreparationDiscovery';
import {
  PREPARATION_MATCHING_POLICY, PREPARATION_VIEWER_LIMITS, validatePreparationDiscoveryPage,
  type PreparationDiscoveryObject, type PreparationDiscoveryRequest, type PreparationEndpointVisibility,
} from '../../../../viewer-runtime/preparation-input.mjs';
import {
  assignModelLocations, fetchModelLocationMatchContext, modelLocationMatchHash, ModelLocationMatchApiError, isModelLocationMatchBusy,
  type ModelLocationMatchAssign, type ModelLocationMatchContext, type ModelLocationMatchReceipt,
} from '@/api/pathfinderModelLocationMatch';
import type { usePathFinder, ProjectPreparationViewer } from './usePathFinder';

type PF = ReturnType<typeof usePathFinder>;
type Candidate = ModelLocationMatchAssign['scan']['candidates'][number];
type Scan = ModelLocationMatchAssign['scan'];
type Pending = { schemaVersion: 'wfc.pf.model-location-match-pending.v1'; projectId: string; accountId: string; command: ModelLocationMatchAssign; commandSha256: string };
type Continuation = { owner: string; context: ModelLocationMatchContext; scan: Scan; offset: number; revision: string; results: ModelLocationMatchResult[] };
type State = { owner: string; storageReady: boolean; busy: boolean; phase: 'idle' | 'context' | 'finding' | 'assigning';
  progress: string | null; error: string | null; notice: string | null; pending: Pending | null;
  results: ModelLocationMatchResult[]; totalNames: number; complete: boolean };
type Access = { pf: PF; accountId: string | null; active: boolean; onChanged?: () => void };
const prefix = 'wfc.pf.model-location-match.pending.v1:';
const initial = (owner: string): State => ({ owner, storageReady: false, busy: false, phase: 'idle', progress: null, error: null, notice: null, pending: null, results: [], totalNames: 0, complete: false });
const interrupted = () => new DOMException('Model location matching was cancelled or changed.', 'AbortError');
const keyFor = (projectId: string, accountId: string) => prefix + accountId + ':' + projectId;
function message(error: unknown) {
  if (error instanceof ModelLocationMatchApiError) return `${error.message} (${error.code}${error.status === null ? '' : `; HTTP ${error.status}`})`;
  if (error instanceof DOMException && error.name === 'AbortError') return `${error.message} (AbortError)`;
  return error instanceof Error ? error.message : 'Model location matching could not be completed.';
}
function sameModel(context: Pick<ModelLocationMatchContext, 'current'>, pf: PF) {
  const m = pf.data?.activeModel;
  return m?.modelVersionId === context.current.modelVersionId && m.selectionRevision === context.current.selectionRevision
    && m.contentFingerprint === context.current.contentFingerprint;
}
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(interrupted());
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(interrupted()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, milliseconds);
    signal.addEventListener('abort', aborted, { once: true });
  });
}
function matchesPending(value: Continuation | null, pending: Pending, owner: string): value is Continuation {
  return Boolean(value && value.owner === owner && value.context.namesSha256 === pending.command.namesSha256
    && value.revision === pending.command.expectedRegistryRevision
    && canonicalPurposeJson(value.context.current) === canonicalPurposeJson(pending.command.current)
    && canonicalPurposeJson(value.context.names.slice(value.offset, value.offset + pending.command.names.length)) === canonicalPurposeJson(pending.command.names));
}

/** Endpoint-only discovery. Every requested name and SDK page contributes before any assignment. */
export async function collectModelLocationMatch(context: ModelLocationMatchContext, viewer: ProjectPreparationViewer,
  progress: (text: string) => void, signal: AbortSignal): Promise<Scan> {
  const objects = new Map<number, PreparationDiscoveryObject>();
  let visibilityScope: PreparationEndpointVisibility | undefined;
  let indexedObjectCount: number | null = null;
  let propertyScan: Scan['propertyScan'] | null = null;
  const encodedNames = new TextEncoder().encode(JSON.stringify(context.names)).byteLength;
  const indexNames = encodedNames <= PREPARATION_VIEWER_LIMITS.equipmentIndexNameBytes ? context.names : undefined;
  let completed = 0;
  for (const group of preparationEquipmentNameBatches(context.names)) {
    for (let start = 0; start < group.length; start += MODEL_LOCATION_MATCH_LIMITS.pageNames) {
      const names = group.slice(start, start + MODEL_LOCATION_MATCH_LIMITS.pageNames);
      let cursor = 0;
      for (;;) {
        viewer.assertCurrent(); if (signal.aborted) throw interrupted();
        progress(`Finding From/To locations: ${completed} of ${context.names.length} names checked; reading model page ${cursor}.`);
        const request: PreparationDiscoveryRequest = { schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: 'equipment', names,
          rootObjectId: null, cursor, limit: PREPARATION_VIEWER_LIMITS.pageObjects, includeAnchors: true,
          ...(visibilityScope ? { visibilityScope } : {}), ...(indexNames ? { indexNames } : {}) };
        const page = await viewer.discover(request); viewer.assertCurrent(); if (signal.aborted) throw interrupted();
        if (!validatePreparationDiscoveryPage(page) || page.mode !== 'equipment' || page.rootObjectId !== null || page.cursor !== cursor
          || page.includeAnchors !== true || page.matchingPolicyVersion !== PREPARATION_MATCHING_POLICY
          || canonicalPurposeJson(page.names) !== canonicalPurposeJson(names) || !page.propertyScan?.complete
          || page.propertyScan.omittedObjectCount !== 0 || page.propertyScan.attemptedObjectCount !== page.indexedObjectCount
          || page.propertyScan.returnedObjectCount !== page.indexedObjectCount)
          throw new Error('The From/To property scan is incomplete. No new assignment was submitted.');
        if (visibilityScope && canonicalPurposeJson(visibilityScope) !== canonicalPurposeJson(page.visibilityScope)
          || indexedObjectCount !== null && indexedObjectCount !== page.indexedObjectCount
          || propertyScan && canonicalPurposeJson(propertyScan) !== canonicalPurposeJson(page.propertyScan))
          throw new Error('The model inventory or visibility changed while finding locations. Find them again before assigning.');
        visibilityScope = page.visibilityScope; indexedObjectCount = page.indexedObjectCount;
        propertyScan = page.propertyScan as Scan['propertyScan'];
        for (const object of page.objects) {
          if (object.matchedNames.some(name => !names.includes(name))) throw new Error('A model candidate is outside the requested From/To names.');
          const before = objects.get(object.objectId);
          if (before) {
            const { matchedNames: _oldNames, ...previous } = before;
            const { matchedNames: _newNames, ...current } = object;
            if (canonicalPurposeJson(previous) !== canonicalPurposeJson(current)) throw new Error('A location object changed during the complete model scan.');
            objects.set(object.objectId, { ...object, matchedNames: [...new Set([...before.matchedNames, ...object.matchedNames])] });
          } else objects.set(object.objectId, object);
          if (objects.size > MODEL_LOCATION_MATCH_LIMITS.candidates) throw new Error('The location search found too many candidates to assign safely. Existing locations are unchanged.');
        }
        if (page.nextCursor === null) break;
        if (page.nextCursor <= cursor) throw new Error('The model returned an invalid location page cursor.');
        cursor = page.nextCursor;
      }
      completed += names.length;
    }
  }
  if (!visibilityScope || indexedObjectCount === null || !propertyScan) throw new Error('There are no project From/To names to search.');
  return { matchingPolicyVersion: PREPARATION_MATCHING_POLICY, visibilityScope, indexedObjectCount, propertyScan, complete: true,
    candidates: [...objects.values()].map((o): Candidate => ({ objectId: o.objectId, name: o.name, matchedNames: o.matchedNames,
      bounds: o.bounds ?? null, bottomCentre: o.bottomCentre ?? null })) };
}
export function modelLocationMatchPage(context: ModelLocationMatchContext, scan: Scan, names: string[], registryRevision: string): ModelLocationMatchAssign {
  const wanted = new Set(names.map(normalizeEndpointLocation));
  return modelLocationMatchAssignSchema.parse({ schemaVersion: 'wfc.pf.model-location-match-assign.v1', current: context.current,
    namesSha256: context.namesSha256, expectedRegistryRevision: registryRevision, idempotencyKey: generateId(), names,
    scan: { ...scan, candidates: scan.candidates.flatMap(candidate => {
      const matchedNames = candidate.matchedNames.filter(name => wanted.has(normalizeEndpointLocation(name)));
      return matchedNames.length ? [{ ...candidate, matchedNames }] : [];
    }) } });
}
async function stored(projectId: string, accountId: string): Promise<Pending | null> {
  const raw = localStorage.getItem(keyFor(projectId, accountId)); if (!raw) return null;
  if (raw.length > MODEL_LOCATION_MATCH_LIMITS.bodyBytes + 4096) throw new Error('Pending location assignment storage exceeds its supported size. Preserve it for recovery.');
  const value = parsePurposeJson(raw, { maximumBytes: MODEL_LOCATION_MATCH_LIMITS.bodyBytes + 4096 }) as Pending;
  if (!value || value.schemaVersion !== 'wfc.pf.model-location-match-pending.v1' || value.projectId !== projectId || value.accountId !== accountId
    || Object.keys(value).sort().join() !== 'accountId,command,commandSha256,projectId,schemaVersion') throw new Error('Pending location assignment storage is invalid. Preserve it for recovery.');
  const command = modelLocationMatchAssignSchema.parse(value.command);
  if (await modelLocationMatchHash(command) !== value.commandSha256) throw new Error('Pending location assignment storage could not be verified. Preserve it for recovery.');
  return { ...value, command };
}
export function useModelLocationMatch({ pf, accountId, active, onChanged }: Access) {
  const access = pf.preparationAccess;
  const projectId = access?.projectId ?? null, token = access?.token ?? null;
  const allowed = Boolean(access?.isAdmin && projectId && projectId === access.loadedProjectId && token && policyUuidSchema.safeParse(accountId).success);
  const owner = JSON.stringify([projectId, access?.loadedProjectId, accountId, token, access?.isAdmin,
    pf.data?.activeModel.modelVersionId, pf.data?.activeModel.selectionRevision, pf.data?.activeModel.contentFingerprint, pf.preparationViewerGeneration]);
  const [state, setState] = useState<State>(() => initial(owner));
  const current = state.owner === owner ? state : initial(owner);
  const data = useRef(current); data.current = current;
  const latest = useRef({ owner, allowed, active, pf, onChanged }); latest.current = { owner, allowed, active, pf, onChanged };
  const mounted = useRef(true), operation = useRef<AbortController | null>(null);
  const continuation = useRef<Continuation | null>(null);
  const live = useCallback(() => mounted.current && latest.current.owner === owner && latest.current.allowed, [owner]);
  const update = useCallback((change: Partial<State>) => { if (live()) setState(previous => ({ ...(previous.owner === owner ? previous : initial(owner)), ...change })); }, [live, owner]);
  useEffect(() => {
    mounted.current = true; let closed = false; operation.current?.abort(); operation.current = null; continuation.current = null; setState(initial(owner));
    if (allowed) void stored(projectId!, accountId!).then(pending => { if (!closed) update({ storageReady: true, pending,
      notice: pending ? 'A location assignment is unconfirmed. Retry the same saved assignment before starting again.' : null }); })
      .catch(error => { if (!closed) update({ storageReady: false, error: message(error) }); });
    return () => { closed = true; operation.current?.abort(); };
  }, [owner, allowed, projectId, accountId, update]);
  useEffect(() => { if (!active) operation.current?.abort(); }, [active]);
  useEffect(() => () => { mounted.current = false; operation.current?.abort(); }, []);
  const retain = useCallback(async (command: ModelLocationMatchAssign) => {
    const pending: Pending = { schemaVersion: 'wfc.pf.model-location-match-pending.v1', projectId: projectId!, accountId: accountId!, command,
      commandSha256: await modelLocationMatchHash(command) };
    const old = await stored(projectId!, accountId!);
    if (old && old.commandSha256 !== pending.commandSha256) throw new Error('Another location assignment is pending. Retry it before starting a new assignment.');
    localStorage.setItem(keyFor(projectId!, accountId!), canonicalPurposeJson(pending));
    if ((await stored(projectId!, accountId!))?.commandSha256 !== pending.commandSha256) throw new Error('The pending location assignment could not be retained. No assignment was submitted.');
    update({ pending }); return pending;
  }, [projectId, accountId, update]);
  const clear = useCallback(async (pending: Pending) => {
    if ((await stored(projectId!, accountId!))?.commandSha256 !== pending.commandSha256) throw new Error('Pending assignment storage changed. Preserve it for recovery.');
    localStorage.removeItem(keyFor(projectId!, accountId!)); update({ pending: null });
  }, [projectId, accountId, update]);
  const run = useCallback(async (retry: boolean) => {
    if (!live() || !latest.current.active || operation.current || !data.current.storageReady || !retry && data.current.pending) return;
    const abort = new AbortController(); operation.current = abort;
    let hadUnknownAttempt = false;
    update({ busy: true, error: null, notice: null, complete: false, ...(retry ? {} : { results: [], totalNames: 0 }) });
    const assertCurrent = () => { if (!live() || !latest.current.active || abort.signal.aborted || operation.current !== abort) throw interrupted(); };
    const sendExact = async (pending: Pending): Promise<ModelLocationMatchReceipt> => {
      const delays = [750, 2000];
      for (let attempt = 0; ; attempt++) {
        assertCurrent();
        try { const receipt = await assignModelLocations(projectId!, token!, pending.command, abort.signal); assertCurrent(); return receipt; }
        catch (error) {
          assertCurrent();
          if (error instanceof ModelLocationMatchApiError && error.outcome === 'unknown') hadUnknownAttempt = true;
          if (!isModelLocationMatchBusy(error) || attempt >= delays.length) throw error;
          const saved = continuation.current;
          const progress = saved?.owner === owner ? `${saved.offset} of ${saved.context.names.length} names confirmed. ` : '';
          update({ progress: `${progress}Project busy (${error.code}; HTTP ${error.status}). Retrying the same saved assignment ${attempt + 1} of ${delays.length}…` });
          await pause(delays[attempt], abort.signal);
        }
      }
    };
    const accept = async (saved: Continuation, pending: Pending, receipt: ModelLocationMatchReceipt) => {
      assertCurrent(); await clear(pending); assertCurrent();
      saved.revision = receipt.registryRevision; saved.offset += pending.command.names.length; saved.results.push(...receipt.results);
      update({ results: [...saved.results], totalNames: saved.context.names.length,
        progress: `From/To locations: ${saved.offset} of ${saved.context.names.length} checked and saved.` });
    };
    const finishPages = async (saved: Continuation, viewer: ProjectPreparationViewer) => {
      while (saved.offset < saved.context.names.length) {
        assertCurrent(); viewer.assertCurrent();
        let count = Math.min(MODEL_LOCATION_MATCH_LIMITS.pageNames, saved.context.names.length - saved.offset);
        let command = modelLocationMatchPage(saved.context, saved.scan, saved.context.names.slice(saved.offset, saved.offset + count), saved.revision);
        while (new TextEncoder().encode(JSON.stringify(command)).byteLength > MODEL_LOCATION_MATCH_LIMITS.bodyBytes && count > 1) {
          count = Math.ceil(count / 2); command = modelLocationMatchPage(saved.context, saved.scan, saved.context.names.slice(saved.offset, saved.offset + count), saved.revision);
        }
        if (new TextEncoder().encode(JSON.stringify(command)).byteLength > MODEL_LOCATION_MATCH_LIMITS.bodyBytes)
          throw new Error('One location has too many matching candidates to assign safely. Existing locations are retained.');
        update({ phase: 'assigning', progress: `Assigning From/To locations: ${saved.offset} of ${saved.context.names.length} checked…` });
        const pending = await retain(command); assertCurrent(); viewer.assertCurrent();
        const receipt = await sendExact(pending); viewer.assertCurrent(); await accept(saved, pending, receipt);
      }
      update({ complete: true, notice: 'From/To location matching finished. Existing manual assignments were kept. Routing calculations have not been started.' });
      continuation.current = null;
    };
    const fresh = async () => {
      continuation.current = null;
      update({ phase: 'context', results: [], totalNames: 0, progress: 'Reading current project From/To names…' });
      const context = await fetchModelLocationMatchContext(projectId!, token!, abort.signal); assertCurrent();
      if (!sameModel(context, latest.current.pf)) throw new Error('The active model changed. Load the current model before finding locations.');
      update({ totalNames: context.names.length });
      if (!context.names.length) { update({ complete: true, notice: 'There are no From/To names in this project.' }); return; }
      await latest.current.pf.runProjectPreparation(context.current, async viewer => {
        update({ phase: 'finding' });
        const scan = await collectModelLocationMatch(context, viewer, progress => update({ progress }), abort.signal); assertCurrent();
        const saved: Continuation = { owner, context, scan, offset: 0, revision: context.registryRevision, results: [] };
        continuation.current = saved; await finishPages(saved, viewer);
      }, abort.signal);
    };
    try {
      if (retry) {
        const pending = await stored(projectId!, accountId!); if (!pending) throw new Error('No saved location assignment remains. Find locations again.');
        if (!sameModel(pending.command, latest.current.pf)) throw new Error('The saved assignment belongs to another model. Load its model before retrying; its exact saved command is retained.');
        update({ phase: 'assigning', pending, progress: 'Checking the same saved location assignment…' });
        const saved = continuation.current;
        if (matchesPending(saved, pending, owner)) {
          await latest.current.pf.runProjectPreparation(saved.context.current, async viewer => {
            viewer.assertCurrent(); const receipt = await sendExact(pending); viewer.assertCurrent();
            await accept(saved, pending, receipt); await finishPages(saved, viewer);
          }, abort.signal);
        } else {
          const receipt = await sendExact(pending); await clear(pending); assertCurrent();
          update({ results: receipt.results, totalNames: receipt.results.length,
            notice: 'The saved assignment is confirmed. Reading the complete current model again to continue the project’s remaining locations.' });
          await fresh();
        }
      } else await fresh();
      assertCurrent(); latest.current.onChanged?.();
      await latest.current.pf.refreshState();
    } catch (error) {
      if (!live()) return;
      let pending: Pending | null = null;
      try { pending = await stored(projectId!, accountId!); }
      catch (storageError) { update({ storageReady: false, error: message(storageError) }); return; }
      // A retry refusal cannot settle an earlier unknown write, except this
      // serialized context check: the server has already checked its ledger.
      const contextRetired = error instanceof ModelLocationMatchApiError && error.outcome === 'refused'
        && error.status === 409 && error.code === 'MODEL_LOCATION_MATCH_CONTEXT_CHANGED';
      const firstRefusal = !retry && !hadUnknownAttempt && error instanceof ModelLocationMatchApiError && error.outcome === 'refused'
        && ![401, 403].includes(error.status ?? 0);
      if (pending && (firstRefusal || contextRetired)) { await clear(pending); pending = null; continuation.current = null; }
      update({ pending, error: pending ? `${message(error)} The assignment outcome is unconfirmed. Retry the same saved assignment to continue; no new calculation or replacement assignment was submitted.`
        : contextRetired ? 'The project, model or locations changed before this assignment was accepted. Find and assign locations again.'
          : error instanceof DOMException && error.name === 'AbortError' ? null : message(error),
        notice: !pending && error instanceof DOMException && error.name === 'AbortError' ? 'Location matching paused. Already saved assignments are retained.' : null });
      if (error instanceof ModelLocationMatchApiError && [401, 403].includes(error.status ?? 0)) latest.current.pf.refresh();
    } finally {
      if (operation.current === abort) operation.current = null;
      update({ busy: false, phase: 'idle' });
    }
  }, [live, update, projectId, token, accountId, clear, retain, owner]);
  return { ...current, allowed, canStart: allowed && active && current.storageReady && !current.busy && !current.pending && pf.viewerPhase === 'ready' && !pf.busy,
    start: () => run(false), retry: () => run(true), cancel: () => operation.current?.abort() };
}
