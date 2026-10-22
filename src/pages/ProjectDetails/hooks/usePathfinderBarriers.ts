import { useCallback, useEffect, useRef, useState } from 'react';
import { beginBarrierCapture, changeBarrierRegistry, getBarrierRegistry, getBarrierSnapshot, getLatestBarrierSnapshot,
  getBarrierCommandRecovery, closeBarrierCommand } from '@/api/pathfinderBarriers';
import { BARRIER_LIMITS, barrierCanonicalJson, barrierCaptureSchema, barrierSelectedParentSchema, type BarrierCapture } from '../../../../shared/pathfinderBarriers';
import { MIXED_BARRIER_POLICY, mixedBarrierCaptureCommandSchema as barrierCaptureCommandSchema,
  mixedBarrierRegistryCommandSchema as barrierRegistryCommandSchema } from '../../../../shared/pathfinderBarrierMixed';
import { supportedBarrierSnapshotReference, type AnyBarrierRegistry as BarrierRegistry, type AnyBarrierSnapshot as BarrierSnapshot } from '../../../../shared/pathfinderBarrierSupported';
import type { usePathFinder, ProjectPreparationViewer } from './usePathFinder';
import { barrierCaptureErrorMessage } from '../../../../viewer-runtime/barrier-capture-errors.mjs';
import { barrierFrameObservationHashInput, validateBarrierFrameObservation } from '../../../../viewer-runtime/barrier-capture.mjs';
import { barrierPendingHash, clearPendingBarrierCommand, createBarrierCommandSentinel, matchBarrierCaptureOutcome,
  createPendingBarrierRecoveryTarget, matchPendingBarrierCommandRecovery,
  readPendingBarrierCommand, retainPendingBarrierCommand, sealPendingBarrierCommand, type BarrierPendingCommand } from './barrierPendingPublication';

export type BarrierSelectedParent = BarrierCapture['selectedParents'][number];
export type BarrierAuthoringPhase = 'idle' | 'loading' | 'capturing' | 'publishing' | 'ready' | 'partial' | 'refused' | 'unknown' | 'stale';
export type BarrierAuthoringState = { registry: BarrierRegistry | null; dirty: boolean; pending: boolean };
export type BarrierAuthoringOptions = {
  projectId: string | null; loadedProjectId: string | null; token: string | null; isAdmin: boolean;
  pf: Pick<ReturnType<typeof usePathFinder>, 'data' | 'viewerPhase' | 'preparationViewerGeneration' | 'readSelection' | 'runProjectPreparation' | 'busy'>;
};
type CaptureCommand = Parameters<typeof beginBarrierCapture>[2];
type EmptyCommand = Extract<Parameters<typeof changeBarrierRegistry>[2], { action: 'declare-empty' }>;
type Intent = Awaited<ReturnType<typeof beginBarrierCapture>>['intent'];
type Observation = Awaited<ReturnType<ProjectPreparationViewer['captureBarriers']>>;
type Pending = (({ type: 'capture'; command: CaptureCommand; intent?: Intent; observation?: Observation; writeStarted: boolean }
  | { type: 'empty'; command: EmptyCommand; writeStarted: boolean }) & { retention?: BarrierPendingCommand }
  | { type: 'restored'; retention: BarrierPendingCommand; writeStarted: boolean }
  | { type: 'storage-blocked'; writeStarted: boolean }) & { recoveryOnly?: boolean };
export type SavedBarrierSelection = { manifest: BarrierSnapshot; status: 'current' | 'recapture-required' | 'unavailable' };
type View = { key: string; registry: BarrierRegistry | null; manifest: BarrierSnapshot | null; draftParents: BarrierSelectedParent[];
  saved: SavedBarrierSelection | null; draftBase: Pick<BarrierRegistry, 'scope' | 'registryRevision'> | null;
  phase: BarrierAuthoringPhase; message: string | null; error: string | null; busy: boolean; pending: boolean; changed: boolean };
type Context = { key: string; abort: AbortController; closed: boolean };
const initial = (key: string): View => ({ key, registry: null, manifest: null, saved: null, draftBase: null, draftParents: [], phase: 'idle', message: null, error: null, busy: false, pending: false, changed: false });
const same = (a: unknown, b: unknown) => barrierCanonicalJson(a) === barrierCanonicalJson(b);
const failure = (message: string, code: string) => Object.assign(new Error(message), { code });
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function errorStatus(error: unknown): number | null {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : null;
}
function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
}
function manifestMatches(registry: BarrierRegistry, manifest: BarrierSnapshot) {
  const ref = registry.snapshot;
  return !!ref && same(ref, supportedBarrierSnapshotReference(manifest))
    && same(registry.selectedParents, manifest.selectedParents);
}

/** Authoring only. Neither published geometry nor this UI enables a collision-unaware calculation. */
export function usePathfinderBarriers(options: BarrierAuthoringOptions) {
  const model = options.pf.data?.activeModel;
  const key = JSON.stringify([options.projectId, options.loadedProjectId, options.token, options.isAdmin,
    model?.modelVersionId, model?.selectionRevision, model?.contentFingerprint, options.pf.preparationViewerGeneration]);
  const latest = useRef({ options, key }); latest.current = { options, key };
  const context = useRef<Context | null>(null), operation = useRef<AbortController | null>(null), locked = useRef(false);
  const pending = useRef<Pending | null>(null), denied = useRef(false);
  const [view, setView] = useState<View>(() => initial(key));
  const viewRef = useRef(view); viewRef.current = view;
  const [kind, setKind] = useState<BarrierSelectedParent['kind']>('wall'), [emptyReason, setEmptyReason] = useState('');
  const enabled = Boolean(options.isAdmin && options.token && options.projectId && options.projectId === options.loadedProjectId
    && model?.modelVersionId && model.contentFingerprint && options.pf.viewerPhase === 'ready' && options.pf.preparationViewerGeneration >= 0);
  const recoveryEnabled = Boolean(options.isAdmin && options.token && options.projectId && options.projectId === options.loadedProjectId);
  const currentView = view.key === key ? view : initial(key);
  const current = useCallback((run: Context) => {
    if (run.closed || run.abort.signal.aborted || context.current !== run || latest.current.key !== run.key)
      throw new DOMException('Barrier authoring context changed.', 'AbortError');
  }, []);
  const update = useCallback((run: Context, patch: Partial<View>) => {
    try {
      current(run);
      const next = { ...(viewRef.current.key === run.key ? viewRef.current : initial(run.key)), ...patch, key: run.key };
      viewRef.current = next; setView(next);
    } catch { /* Never expose an old scope. */ }
  }, [current]);
  const requireScope = useCallback((registry: BarrierRegistry, requireViewer = true) => {
    const access = latest.current.options, active = access.pf.data?.activeModel;
    if (!access.isAdmin || !access.token || access.projectId !== access.loadedProjectId || requireViewer && access.pf.viewerPhase !== 'ready'
      || registry.scope.projectId !== access.projectId || registry.scope.modelVersionId !== active?.modelVersionId
      || registry.scope.selectionRevision !== active.selectionRevision || registry.scope.contentFingerprint !== active.contentFingerprint)
      throw failure('The barrier registry no longer describes the current model. Refresh barriers.', 'BARRIER_CONTEXT_CHANGED');
  }, []);
  const read = useCallback(async (run: Context, signal: AbortSignal, requireViewer = true) => {
    const access = latest.current.options;
    const registry = await getBarrierRegistry(access.projectId!, access.token!, signal); signal.throwIfAborted(); current(run); requireScope(registry, requireViewer);
    const manifest = registry.snapshot ? await getBarrierSnapshot(access.projectId!, access.token!, registry.snapshot.snapshotId, signal) : null;
    signal.throwIfAborted(); current(run);
    if (manifest && !manifestMatches(registry, manifest)) throw failure('The published barrier manifest changed. Refresh barriers.', 'BARRIER_CONTEXT_CHANGED');
    return { registry, manifest };
  }, [current, requireScope]);
  const report = useCallback((run: Context, error: unknown, saved: Pending | null, definitiveWriteRefusal = false) => {
    // Old transport failures cannot mutate the new context's command or auth
    // latch merely because rendering that failure would already be ignored.
    try { current(run); } catch { return; }
    const status = errorStatus(error), code = errorCode(error);
    // A status/manifest GET or local context check cannot settle an earlier write.
    // Only a response from that first command attempt may prove its refusal;
    // an already uncertain attempt needs its exact same-key success receipt.
    if (saved && definitiveWriteRefusal) saved.writeStarted = false;
    const unknown = !!saved?.writeStarted;
    if (status === 401 || status === 403) {
      denied.current = true;
      if (!unknown) pending.current = null;
      update(run, { ...initial(run.key), phase: unknown ? 'unknown' : 'refused', pending: unknown,
        error: unknown ? 'Administrator access is unavailable and the saved command outcome is still unknown. The command has been retained; no replacement will be submitted.'
          : 'Current administrator access is required. Refresh your account to continue.' });
      return;
    }
    update(run, { busy: false, pending: !!saved, phase: unknown ? 'unknown' : code === 'BARRIER_CAPTURE_PARTIAL' ? 'partial' : code === 'BARRIER_CONTEXT_CHANGED' ? 'stale' : 'refused',
      error: unknown ? 'The command outcome is unknown. Its exact recovery binding is retained. Check the saved command outcome before changing this set.'
        : barrierCaptureErrorMessage(code) ?? (code === 'EXTRACTION_FAILED' || code?.startsWith('BARRIER_CAPTURE_')
          ? 'The selected barrier geometry could not be read completely. Check the selected objects or reduce the capture scope before starting a new command.'
          : error instanceof Error ? error.message : 'Barrier authoring could not be completed.') });
  }, [current, update]);
  const refresh = useCallback(async () => {
    const run = context.current;
    if (!enabled || !run || locked.current || denied.current) return;
    const controller = new AbortController(); operation.current = controller; locked.current = true;
    const signal = AbortSignal.any([run.abort.signal, controller.signal]);
    const previous = viewRef.current;
    // Last verified names are display history. Withhold current admission until
    // the entire registry/manifest read succeeds, including on a failed refresh.
    update(run, { busy: true, phase: 'loading', error: null, registry: null, manifest: null,
      saved: previous.saved ? { ...previous.saved, status: 'unavailable' } : null });
    try {
      const found = await read(run, signal); current(run);
      const keepDraft = previous.key === run.key && (previous.changed || pending.current !== null);
      const changedScope = keepDraft && previous.draftBase && (!same(previous.draftBase.scope, found.registry.scope)
        || previous.draftBase.registryRevision !== found.registry.registryRevision);
      const oldFrame = found.registry.state === 'stale';
      update(run, { ...found, saved: found.manifest ? { manifest: found.manifest, status: oldFrame ? 'recapture-required' : 'current' } : null,
        ...(!keepDraft ? { draftParents: oldFrame ? [] : found.registry.selectedParents, changed: false,
          draftBase: { scope: found.registry.scope, registryRevision: found.registry.registryRevision } } : {}),
        phase: pending.current ? pending.current.writeStarted ? 'unknown' : previous.phase === 'partial' ? 'partial' : 'refused'
          : changedScope ? 'stale' : found.registry.state === 'ready' ? 'ready' : found.registry.state === 'partial' ? 'partial' : 'idle',
        message: pending.current ? 'A saved command still needs reconciliation. Refresh does not submit or replace it.'
          : oldFrame ? 'The published set belongs to another model frame. Select current-model objects and save a new set; old object identifiers cannot be reused automatically.' : null, error: null });
    } catch (error) {
      report(run, error, pending.current);
      // History cannot restore current admission or settle an uncertain write.
      // Access denials never trigger another read or expose retained selections.
      if (errorStatus(error) !== 401 && errorStatus(error) !== 403 && errorCode(error) === 'BARRIER_CURRENT_FRAME_UNAVAILABLE') {
        try {
          current(run); signal.throwIfAborted();
          const access = latest.current.options;
          const savedManifest = await getLatestBarrierSnapshot(access.projectId!, access.token!, signal);
          signal.throwIfAborted(); current(run);
          update(run, { saved: savedManifest ? { manifest: savedManifest, status: 'unavailable' } : null,
            message: savedManifest ? 'Saved obstacles were restored for reference. Prepare the current model before checking or recapturing this set.'
              : 'No saved barrier snapshot was found. Current barrier readiness is unavailable.' });
        } catch (historyError) { report(run, historyError, pending.current); }
      }
    }
    finally { if (context.current === run) { locked.current = false; operation.current = null; update(run, { busy: false }); } }
  }, [current, enabled, read, report, update]);
  useEffect(() => {
    const run: Context = { key, abort: new AbortController(), closed: false };
    context.current = run; pending.current = { type: 'storage-blocked', writeStarted: true }; denied.current = false; locked.current = false; operation.current?.abort(); operation.current = null;
    const blank = { ...initial(key), busy: true, pending: true }; viewRef.current = blank; setView(blank); setEmptyReason(''); setKind('wall');
    void (async () => {
      try {
        const retained = options.projectId ? await readPendingBarrierCommand(sessionStorage, options.projectId) : null;
        current(run);
        pending.current = retained ? { type: 'restored', retention: retained, writeStarted: true } : null;
        update(run, { busy: false, pending: Boolean(retained), phase: retained ? 'unknown' : 'idle',
          message: retained ? 'A saved command needs an exact outcome check. Inspect it or explicitly close this command before starting a replacement. Reloading the Viewer does not resubmit it.' : null });
        if (enabled) void refresh();
      } catch { update(run, { busy: false, pending: true, phase: 'unknown', error: 'Barrier recovery storage is unavailable or changed. No new barrier command will be sent. Preserve this browser session for reconciliation.' }); }
    })();
    return () => { run.closed = true; run.abort.abort(); operation.current?.abort(); };
  }, [key, enabled, refresh, current, update, options.projectId]);

  const recoverCommand = useCallback(async (saved: Pending, close: boolean) => {
    const run = context.current, retained = 'retention' in saved ? saved.retention : undefined;
    if (!recoveryEnabled || !run || locked.current || denied.current || latest.current.options.pf.busy || pending.current !== saved || !retained) return;
    locked.current = true; const controller = new AbortController(); operation.current = controller;
    const signal = AbortSignal.any([run.abort.signal, controller.signal]); update(run, { busy: true, error: null, message: null, phase: 'loading' });
    let terminalConfirmed = false;
    try {
      const access = latest.current.options;
      const assertRetained = async () => {
        const actual = await readPendingBarrierCommand(sessionStorage, retained.projectId);
        signal.throwIfAborted(); current(run);
        if (pending.current !== saved || !same(actual, retained)) throw failure('The saved recovery record changed. It was retained and no replacement was submitted.', 'BARRIER_PENDING_COMMAND_CHANGED');
      };
      await assertRetained();
      const target = await createPendingBarrierRecoveryTarget(retained); signal.throwIfAborted(); current(run);
      // Current project-admin authority is checked independently by the server.
      // The original token hash remains unchanged and grants no continuation.
      if (close) {
        await assertRetained();
        // Write/readback precedes the close POST as well. A lost close ACK keeps
        // this same original record; inspect performs no replay or new capture.
        retainPendingBarrierCommand(sessionStorage, retained, retained);
        saved.writeStarted = true; saved.recoveryOnly = true;
      }
      const raw = close ? await closeBarrierCommand(retained.projectId, access.token!, target, signal)
        : await getBarrierCommandRecovery(retained.projectId, access.token!, target, signal);
      signal.throwIfAborted(); current(run);
      const outcome = await matchPendingBarrierCommandRecovery(retained, raw); signal.throwIfAborted(); current(run); await assertRetained();
      if (!outcome) { update(run, { phase: 'unknown', pending: true, message: 'No terminal outcome is recorded for this exact command. It remains locked. Inspect again or explicitly close this command; no replay or replacement was sent.' }); return; }
      terminalConfirmed = true;
      // Once Close may have committed, or an exact terminal is known, a live
      // original command must follow the same GET-only path as a restored one.
      // This flag grants no authority and never alters the persisted source.
      saved.recoveryOnly = true;
      const previous = viewRef.current;
      update(run, { registry: null, manifest: null, pending: true,
        saved: previous.saved ? { ...previous.saved, status: 'unavailable' } : null,
        message: 'The exact saved command outcome is confirmed. Refreshing the actual published barrier set before releasing this command…' });
      // Historical settlement never supplies current readiness. Read the real
      // registry and hash-verified manifest, without requiring a running Viewer.
      const found = await read(run, signal, false); signal.throwIfAborted(); current(run); await assertRetained();
      const draftBase = previous.draftBase, keepDraft = previous.changed && draftBase !== null;
      const changedScope = Boolean(previous.changed && draftBase && (!same(draftBase.scope, found.registry.scope)
        || draftBase.registryRevision !== found.registry.registryRevision));
      const oldFrame = found.registry.state === 'stale';
      clearPendingBarrierCommand(sessionStorage, retained); pending.current = null; saved.writeStarted = false;
      update(run, { ...found, pending: false, error: null,
        saved: found.manifest ? { manifest: found.manifest, status: oldFrame ? 'recapture-required' : 'current' } : null,
        ...(!keepDraft ? { draftParents: oldFrame ? [] : found.registry.selectedParents, changed: false,
          draftBase: { scope: found.registry.scope, registryRevision: found.registry.registryRevision } } : {}),
        phase: changedScope ? 'stale' : found.registry.state === 'ready' ? 'ready' : found.registry.state === 'partial' ? 'partial' : 'idle',
        message: outcome.outcome === 'closed'
          ? 'This exact command was closed. The actual published barrier set was refreshed and kept. You may edit the selection and save a new command.'
          : outcome.outcome === 'geometry-refused'
            ? 'The exact capture was refused. The actual published barrier set was refreshed and kept. You may change the selection and save a new command.'
            : 'The exact publication is confirmed and the actual published barrier set was refreshed. Current calculation readiness is checked separately.' });
    } catch (error) {
      report(run, error, saved);
      if (terminalConfirmed) update(run, { message: 'The exact command outcome was confirmed, but the current barrier set could not be refreshed. The saved recovery record remains locked. Inspect again after resolving the refresh error.' });
    }
    finally { if (context.current === run) { locked.current = false; operation.current = null; update(run, { busy: false }); } }
  }, [current, read, recoveryEnabled, report, update]);
  const inspect = useCallback(async () => { if (pending.current) await recoverCommand(pending.current, false); }, [recoverCommand]);
  const close = useCallback(async () => { if (pending.current) await recoverCommand(pending.current, true); }, [recoverCommand]);

  const addSelection = useCallback(async () => {
    const run = context.current, base = viewRef.current;
    if (!enabled || !run || latest.current.options.pf.busy || locked.current || denied.current || pending.current || !base.registry || base.key !== key || base.phase === 'stale') return;
    locked.current = true; const controller = new AbortController(); operation.current = controller;
    const signal = AbortSignal.any([run.abort.signal, controller.signal]); update(run, { busy: true, error: null });
    try {
      requireScope(base.registry);
      const before = await getBarrierRegistry(latest.current.options.projectId!, latest.current.options.token!, signal); signal.throwIfAborted(); current(run); requireScope(before);
      if (before.registryRevision !== base.registry.registryRevision || !same(before.scope, base.registry.scope))
        throw failure('Barrier scope changed before reading the selection. Discard the draft and refresh.', 'BARRIER_CONTEXT_CHANGED');
      const selection = await latest.current.options.pf.runProjectPreparation(base.registry.scope, viewer => viewer.readSelection(), signal); current(run);
      if (!selection || selection.objects.length === 0 || selection.objects.length > 16)
        throw new Error('Select between 1 and 16 objects in the Model Browser before adding barriers.');
      const draft = [...base.draftParents], known = new Set(draft.map(parent => parent.objectId));
      for (const object of selection.objects) {
        if (!Number.isInteger(object.objectId) || object.objectId <= 0) throw new Error('A selected Model Browser object has no valid parent identity.');
        const objectId = `dbid:${object.objectId}`;
        if (known.has(objectId)) continue;
        const parent = barrierSelectedParentSchema.parse({ selectionId: crypto.randomUUID(), kind, objectId, dbId: object.objectId,
          externalId: object.externalId, name: object.name, identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' });
        draft.push(parent); known.add(objectId);
      }
      if (draft.length > BARRIER_LIMITS.selectedParents) throw new Error(`At most ${BARRIER_LIMITS.selectedParents} unique parent objects can be registered.`);
      const after = await getBarrierRegistry(latest.current.options.projectId!, latest.current.options.token!, signal); signal.throwIfAborted(); current(run); requireScope(after);
      if (after.registryRevision !== before.registryRevision || !same(after.scope, before.scope))
        throw failure('Barrier scope changed while reading the selection. Discard the draft and refresh.', 'BARRIER_CONTEXT_CHANGED');
      current(run); update(run, { draftParents: draft, changed: !same(draft, base.registry.selectedParents),
        phase: 'idle', message: 'Draft updated. Save barrier set to capture every remaining parent and its descendant fragments.' });
    } catch (error) { report(run, error, null); }
    finally { if (context.current === run) { locked.current = false; operation.current = null; update(run, { busy: false }); } }
  }, [current, enabled, key, kind, report, requireScope, update]);
  const removeParent = useCallback((selectionId: string) => {
    const run = context.current, base = viewRef.current;
    if (!enabled || !run || locked.current || denied.current || pending.current || base.key !== key || !base.registry || base.phase === 'stale') return;
    const draft = base.draftParents.filter(parent => parent.selectionId !== selectionId);
    update(run, { draftParents: draft, changed: !same(draft, base.registry.selectedParents), error: null,
      message: draft.length ? 'Removal is a draft. Saving recaptures every remaining parent; the published set stays unchanged until success.'
        : 'To remove the last barrier, enter a reason and explicitly declare no barriers.' });
  }, [enabled, key, update]);

  const execute = useCallback(async (saved: Pending) => {
    if (saved.type === 'restored' || saved.recoveryOnly) { await recoverCommand(saved, false); return; }
    if (saved.type === 'storage-blocked') return;
    const run = context.current;
    if (!enabled || !run || latest.current.options.pf.busy || locked.current || denied.current || pending.current !== saved) return;
    locked.current = true; const controller = new AbortController(); operation.current = controller;
    const signal = AbortSignal.any([run.abort.signal, controller.signal]); update(run, { busy: true, pending: true, error: null, message: null });
    let definitiveWriteRefusal = false;
    try {
      const access = latest.current.options;
      const sentinel = saved.retention ?? await createBarrierCommandSentinel(saved.type === 'capture' ? 'capture-intent' : 'empty', saved.command, saved.command.scope, access.token!);
      current(run); signal.throwIfAborted();
      let confirmedReference: BarrierRegistry['snapshot'] = null;
      let terminalRefused = false;
      const send = async <T,>(invoke: () => Promise<T>, exactCommandResponse: boolean): Promise<T> => {
        const alreadyUnknown = saved.writeStarted;
        // Durable write/readback precedes every POST. Failure here prevents
        // dispatch and does not claim that a network write has started.
        retainPendingBarrierCommand(sessionStorage, sentinel, saved.retention ?? null);
        saved.retention = sentinel; saved.writeStarted = true;
        try { return await invoke(); }
        catch (error) {
          const status = errorStatus(error);
          definitiveWriteRefusal = !alreadyUnknown && exactCommandResponse && status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
          throw error;
        }
      };
      await access.pf.runProjectPreparation(saved.command.scope, async viewer => {
        viewer.assertCurrent(); current(run);
        const before = await getBarrierRegistry(access.projectId!, access.token!, signal); signal.throwIfAborted(); current(run); requireScope(before);
        if (!same(before.scope, saved.command.scope)) throw failure('The prepared model frame changed. The saved command cannot be replayed.', 'BARRIER_CONTEXT_CHANGED');
        // Retries submit the same command/key even if its successful commit advanced the head.
        if (saved.type === 'empty') {
          update(run, { phase: 'publishing' });
          const result = await send(() => changeBarrierRegistry(access.projectId!, access.token!, saved.command, signal), true); current(run); viewer.assertCurrent();
          if (!same(result.snapshot.scope, saved.command.scope) || result.snapshot.mode !== 'explicit-empty'
            || (saved.command.schemaVersion === 'wfc.pf.barrier-registry-command.v2') !== (result.schemaVersion === 'wfc.pf.barrier-publication-receipt.v2')) throw new Error('Barrier empty receipt differs from the saved command.');
          confirmedReference = result.snapshot; saved.writeStarted = false;
        } else {
          if (!saved.intent) {
            update(run, { phase: 'publishing' });
            const result = await send(() => beginBarrierCapture(access.projectId!, access.token!, saved.command, signal), true); current(run); viewer.assertCurrent();
            if (!same(result.intent.command, saved.command)) throw new Error('Barrier intent differs from the saved command.');
            const acknowledged = await sealPendingBarrierCommand({ ...saved.retention, kind: 'capture-intent', actorId: result.intent.createdBy,
              loginId: result.intent.loginId, intentId: result.intent.id, snapshotId: result.intent.snapshotId });
            current(run); signal.throwIfAborted(); retainPendingBarrierCommand(sessionStorage, acknowledged, saved.retention!);
            saved.retention = acknowledged; saved.intent = result.intent; saved.writeStarted = false;
            if (result.state === 'complete') {
              const manifest = await getBarrierSnapshot(access.projectId!, access.token!, result.intent.snapshotId, signal); current(run); viewer.assertCurrent();
              if ((saved.command.schemaVersion === 'wfc.pf.barrier-capture-command.v2') !== (manifest.schemaVersion === 'wfc.pf.barrier-snapshot.v2')
                || manifest.capture?.captureId !== result.intent.id || !same(manifest.scope, saved.command.scope)
                || !same(manifest.selectedParents, saved.command.selectedParents)) throw new Error('Completed capture receipt differs from the saved command.');
              confirmedReference = supportedBarrierSnapshotReference(manifest);
              return;
            }
          }
          if (!saved.observation) {
            update(run, { phase: 'capturing' });
            const observation = await viewer.captureBarriers({ captureId: saved.intent.id, scope: saved.command.scope, selectedParents: saved.command.selectedParents }); current(run);
            const capture = barrierCaptureSchema.parse(observation.capture);
            if (capture.captureId !== saved.intent.id || !same(capture.scope, saved.command.scope) || !same(capture.selectedParents, saved.command.selectedParents))
              throw new Error('Barrier capture differs from the saved selection.');
            if (capture.observation.state !== 'reported-complete') throw failure('Capture is partial. The previously published barrier set was kept.', 'BARRIER_CAPTURE_PARTIAL');
            saved.observation = observation;
          }
          update(run, { phase: 'publishing' });
          const capture = barrierCaptureSchema.parse(saved.observation!.capture), frame = saved.observation!.frameObservation;
          if (!validateBarrierFrameObservation(frame) || await barrierPendingHash(barrierFrameObservationHashInput(frame)) !== frame.contentSha256)
            throw new Error('Barrier pending frame differs from its integrity hash.');
          const retained = await sealPendingBarrierCommand({ ...saved.retention, kind: 'publication',
            actorId: saved.intent!.createdBy, loginId: saved.intent!.loginId, intentId: saved.intent!.id, snapshotId: saved.intent!.snapshotId,
            captureSha256: await barrierPendingHash(capture), frameSha256: frame.contentSha256, loadId: frame.loadId });
          if (retained.kind !== 'publication') throw new Error('Barrier pending publication is invalid.');
          current(run); signal.throwIfAborted(); viewer.assertCurrent();
          // Preflight cannot submit this publication. Once a PUT has started,
          // neither a later preflight failure nor a bare HTTP status can settle
          // its outcome; retain the exact intent and observation until receipt.
          const result = await viewer.publishBarriers(saved.intent!.id, saved.observation!, () => {
            retainPendingBarrierCommand(sessionStorage, retained, saved.retention ?? null);
            saved.retention = retained; saved.writeStarted = true;
          }, saved.command); current(run); viewer.assertCurrent();
          if (result.schemaVersion === 'wfc.pf.barrier-publication-refusal.v1') {
            if (!matchBarrierCaptureOutcome(retained, result)) throw new Error('Barrier refusal is not terminal.');
            clearPendingBarrierCommand(sessionStorage, retained); saved.retention = undefined; saved.writeStarted = false; pending.current = null;
            terminalRefused = true; return;
          }
          if ((saved.command.schemaVersion === 'wfc.pf.barrier-capture-command.v2') !== (result.schemaVersion === 'wfc.pf.barrier-publication-receipt.v2')
            || result.snapshot.snapshotId !== saved.intent.snapshotId
            || result.snapshot.mode !== (saved.command.schemaVersion === 'wfc.pf.barrier-capture-command.v2' ? 'mixed-mesh-set' : 'mesh-set')
            || !same(result.snapshot.scope, saved.command.scope)) throw new Error('Barrier publication receipt differs from the saved intent.');
          confirmedReference = result.snapshot; saved.writeStarted = false;
          clearPendingBarrierCommand(sessionStorage, retained); saved.retention = undefined; pending.current = null;
        }
      }, signal);
      signal.throwIfAborted(); current(run);
      if (terminalRefused) {
        update(run, { busy: false, pending: false, phase: 'refused', error: 'The exact barrier capture was refused by geometry verification. The previously published barrier set was kept. Change the selection before saving a new command.' });
        return;
      }
      const found = await read(run, signal); current(run);
      if (!found.manifest || found.registry.state !== 'ready' || !confirmedReference || !same(found.registry.snapshot, confirmedReference)
        || saved.type === 'capture' && (!saved.intent || found.manifest.snapshotId !== saved.intent.snapshotId
        || found.manifest.capture?.captureId !== saved.intent.id || !same(found.manifest.selectedParents, saved.command.selectedParents))
        || saved.type === 'empty' && (found.manifest.geometry.mode !== 'explicit-empty' || found.manifest.geometry.reason !== saved.command.reason))
        throw failure('The saved publication is no longer the current barrier set. Refresh and inspect it before changing the set.', 'BARRIER_CONTEXT_CHANGED');
      if (saved.retention) { clearPendingBarrierCommand(sessionStorage, saved.retention); saved.retention = undefined; }
      pending.current = null; setEmptyReason('');
      update(run, { ...found, saved: { manifest: found.manifest, status: 'current' }, draftParents: found.registry.selectedParents,
        draftBase: { scope: found.registry.scope, registryRevision: found.registry.registryRevision }, changed: false, pending: false, phase: 'ready',
        message: 'Barrier set published. Its coverage is limited to the registered objects. Calculation integration is not enabled by this authoring step.', error: null });
    } catch (error) {
      try { current(run); } catch { return; }
      if (definitiveWriteRefusal && saved.retention) {
        try { clearPendingBarrierCommand(sessionStorage, saved.retention); saved.retention = undefined; }
        catch { definitiveWriteRefusal = false; saved.writeStarted = true; }
      }
      report(run, error, pending.current, definitiveWriteRefusal);
    }
    finally { if (context.current === run) { locked.current = false; operation.current = null; update(run, { busy: false }); } }
  }, [current, enabled, read, recoverCommand, report, requireScope, update]);
  const save = useCallback(async () => {
    const run = context.current, base = viewRef.current;
    if (!enabled || !run || latest.current.options.pf.busy || locked.current || denied.current || pending.current || base.key !== key || !base.registry || base.phase === 'stale') return;
    try {
      requireScope(base.registry);
      let saved: Pending;
      if (base.draftParents.length) {
        const command = barrierCaptureCommandSchema.parse({ schemaVersion: 'wfc.pf.barrier-capture-command.v2', geometryPolicy: MIXED_BARRIER_POLICY, scope: base.registry.scope,
          expectedRegistryRevision: base.registry.registryRevision, idempotencyKey: crypto.randomUUID(), selectedParents: base.draftParents });
        saved = { type: 'capture', command: freeze(command), writeStarted: false };
      } else {
        const reason = emptyReason.trim();
        if (!reason) throw new Error('A reason is required to explicitly declare no barriers.');
        const command = barrierRegistryCommandSchema.parse({ schemaVersion: 'wfc.pf.barrier-registry-command.v2', geometryPolicy: MIXED_BARRIER_POLICY, action: 'declare-empty', scope: base.registry.scope,
          expectedRegistryRevision: base.registry.registryRevision, idempotencyKey: crypto.randomUUID(), reason });
        if (command.action !== 'declare-empty') return;
        saved = { type: 'empty', command: freeze(command), writeStarted: false };
      }
      // Parsing detaches every nested draft value before the first write. Retry never creates a key.
      pending.current = saved; update(run, { pending: true }); await execute(saved);
    } catch (error) { report(run, error, pending.current); }
  }, [emptyReason, enabled, execute, key, report, requireScope, update]);
  const retry = useCallback(async () => { if (pending.current) await execute(pending.current); }, [execute]);
  const cancel = useCallback(() => { operation.current?.abort(); }, []);
  const discardPending = useCallback(() => {
    const run = context.current, base = viewRef.current;
    if (!run || locked.current || base.key !== key || base.phase === 'unknown' || pending.current?.writeStarted || pending.current?.recoveryOnly) return;
    try {
      const retained = pending.current && 'retention' in pending.current ? pending.current.retention : undefined;
      if (retained) clearPendingBarrierCommand(sessionStorage, retained);
    } catch { update(run, { pending: true, phase: 'unknown', error: 'The retained command could not be removed exactly. No replacement will be submitted.' }); return; }
    pending.current = null;
    update(run, { pending: false, changed: false, draftParents: base.registry?.state === 'ready' ? base.registry.selectedParents : [],
      draftBase: base.registry ? { scope: base.registry.scope, registryRevision: base.registry.registryRevision } : null, phase: 'idle', error: null, message: null });
    void refresh();
  }, [key, refresh, update]);
  const canAuthor = enabled && !denied.current && !!currentView.registry && currentView.phase !== 'stale';
  const saved = pending.current;
  const canRetry = !denied.current && !currentView.busy && !options.pf.busy && currentView.pending && (saved?.type === 'restored' || saved?.recoveryOnly
    ? recoveryEnabled
    : saved?.type !== 'storage-blocked' && enabled && !denied.current);
  const canInspect = recoveryEnabled && !denied.current && !currentView.busy && !options.pf.busy && currentView.pending
    && !!saved && 'retention' in saved && !!saved.retention;
  const canDiscard = !currentView.busy && !options.pf.busy && !locked.current && currentView.phase !== 'unknown'
    && !saved?.writeStarted && !saved?.recoveryOnly && (currentView.pending || currentView.changed);
  return { ...currentView, kind, setKind, emptyReason, setEmptyReason, dirty: currentView.changed, canAuthor, canRetry, canInspect, canClose: canInspect, canDiscard,
    addSelection, removeParent, save, retry, inspect, close, cancel, refresh, discardPending };
}
