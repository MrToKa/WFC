import { useEffect, useRef, useState } from 'react';
import { Body1, Button, Field, Input, Spinner, tokens } from '@fluentui/react-components';
import type { usePathFinder } from './hooks/usePathFinder';
import { useProjectPreparation } from './hooks/useProjectPreparation';
import { preparationResolutionMatchesScope, type PreparationScope, type PreparationPlan } from '../../../shared/pathfinderPreparation';
import { fetchRoutingPurposePolicy, type RoutingPurposePolicy } from '@/api/pathfinderPolicies';
import { trayDisplayTarget } from './trayDisplayTarget';
import { formatPreparationDiagnostics } from './preparationDiagnostics';

type Props = { pf: ReturnType<typeof usePathFinder>; active: boolean; onBusyChange?: (busy: boolean) => void; onNetworkReady?: (key: string) => void };
const searchText = (text: string) => text.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase().replace(/^\/+/, '');
const sameModel = (left: { modelVersionId: string | null; contentFingerprint: string | null; selectionRevision: string | null }, right: PreparationScope) =>
  left.modelVersionId === right.modelVersionId && left.contentFingerprint === right.contentFingerprint && left.selectionRevision === right.selectionRevision;

export function ProjectPreparationPanel({ pf, active, onBusyChange, onNetworkReady }: Props) {
  const state = useProjectPreparation(pf, active);
  const [query, setQuery] = useState('');
  const [reading, setReading] = useState<string | null>(null);
  const [display, setDisplay] = useState<{ owner: string; scope: string; trayId: string; status: 'showing' | 'shown' | 'failed' | 'hiding' | 'hide-failed' } | null>(null);
  const [showError, setShowError] = useState<{ owner: string; scope: string; trayId: string } | null>(null);
  const [selectionError, setSelectionError] = useState<{ trayId: string; message: string } | null>(null);
  const [permissions, setPermissions] = useState<{ owner: string; value: RoutingPurposePolicy } | null>(null);
  const pending = useRef<object | null>(null);
  const pendingDisplay = useRef<object | null>(null);
  const ownedPeek = useRef<{ restore: () => Promise<boolean> } | null>(null);
  const owner = JSON.stringify([pf.preparationAccess, state.context?.scope.modelVersionId,
    state.context?.scope.contentFingerprint, state.context?.scope.selectionRevision, pf.data?.activeModel, pf.preparationViewerGeneration, active]);
  const permissionOwner = JSON.stringify([pf.preparationAccess, state.context?.projectId,
    state.context?.scope.catalogRevision, state.context?.scope.routingPolicyRevision]);
  const context = state.context;
  const displayScope = JSON.stringify(context?.scope);
  const currentDisplay = display?.owner === owner && display.scope === displayScope ? display : null;
  const currentShowError = showError?.owner === owner && showError.scope === displayScope ? showError : null;
  const displayPending = display?.owner === owner && (display.status === 'showing' || display.status === 'hiding');
  const modelCurrent = Boolean(context && pf.data?.activeModel && context.projectId === pf.preparationAccess?.projectId && sameModel(pf.data.activeModel, context.scope));
  const readyNotificationKey = active && state.networkReady && modelCurrent && context?.currentAggregate && pf.viewerPhase === 'ready'
    ? state.networkReadinessKey : null;
  useEffect(() => { if (readyNotificationKey) onNetworkReady?.(readyNotificationKey); }, [readyNotificationKey, onNetworkReady]);
  const latestOwner = useRef(owner), latestScope = useRef(state.context?.scope);
  latestOwner.current = owner; latestScope.current = state.context?.scope;
  useEffect(() => {
    pending.current = null; pendingDisplay.current = null; setReading(null); setDisplay(null); setShowError(null); setSelectionError(null); setQuery('');
    return () => { pending.current = null; pendingDisplay.current = null; };
  }, [owner]);
  useEffect(() => {
    pendingDisplay.current = null; setDisplay(null); setShowError(null);
    return () => { pendingDisplay.current = null; };
  }, [displayScope]);
  useEffect(() => () => {
    const peek = ownedPeek.current; ownedPeek.current = null;
    if (peek) void peek.restore().catch(() => {});
  }, [owner, displayScope]);
  const working = state.busy || Boolean(reading);
  useEffect(() => {
    onBusyChange?.(working);
    return () => onBusyChange?.(false);
  }, [working, onBusyChange]);
  useEffect(() => {
    const abort = new AbortController(), context = state.context, access = pf.preparationAccess;
    if (permissions?.owner === permissionOwner) return () => abort.abort();
    if (state.enabled && active && context && access?.token && context.projectId === access.projectId) {
      void fetchRoutingPurposePolicy(context.projectId, access.token, abort.signal).then(value => {
        if (!abort.signal.aborted && value.projectId === context.projectId && value.catalogRevision === context.scope.catalogRevision
          && value.routingPolicyRevision === context.scope.routingPolicyRevision) setPermissions({ owner: permissionOwner, value });
      }, () => {});
    }
    return () => abort.abort();
  }, [permissionOwner, state.enabled, active, state.context, pf.preparationAccess, permissions]);
  if (!state.enabled) return <Body1>Current administrator project access is required.</Body1>;
  const discovery = context && state.discovery && sameModel(state.discovery, context.scope) ? state.discovery : null;
  const plan = context && state.session?.plan.projectId === context.projectId && sameModel(state.session.plan, context.scope) ? state.session.plan : null;
  const saved = Boolean(state.networkReady && modelCurrent && pf.viewerPhase === 'ready' && context?.currentAggregate && sameModel(context.currentAggregate, context.scope)
    && context.currentAggregate.catalogRevision === context.scope.catalogRevision
    && context.currentAggregate.routingContentSha256 === context.scope.routingContentSha256
    && context.currentAggregate.routingPolicyRevision === context.scope.routingPolicyRevision
    && context.currentAggregate.routingPolicySha256 === context.scope.routingPolicySha256
    && context.currentAggregate.resolutionRevision === context.scope.resolutionRevision);
  const diagnosticPlan = plan && context && (Object.keys(context.scope) as Array<keyof PreparationScope>).every(key => plan[key] === context.scope[key]) ? plan : null;
  const currentDiagnostics: PreparationPlan['diagnostics'] = context && modelCurrent ? context.trays.flatMap(tray => {
    if (tray.policyState === 'configured' || tray.policyState === 'excluded'
      || context.resolutions.some(item => item.projectTrayId === tray.projectTrayId && item.mode === 'exclude' && preparationResolutionMatchesScope(item.scope, context.scope))) return [];
    return [{ code: tray.policyState === 'unconfigured' ? 'PURPOSE_UNCONFIGURED' : 'TRAY_POLICY_INVALID', projectTrayIds: [tray.projectTrayId], objectIds: [], message: '' }];
  }) : [];
  const blockers = context && !saved && !working && modelCurrent
    ? formatPreparationDiagnostics([...currentDiagnostics, ...(diagnosticPlan?.diagnostics ?? [])], context.trays) : [];
  const assigned = (trayId: string) => {
    if (!context || !modelCurrent) return false;
    const resolution = context.resolutions.find(item => item.projectTrayId === trayId && sameModel(item.scope, context.scope));
    if (resolution) return resolution.mode === 'roots' && resolution.rootObjectIds.length > 0;
    const matches = discovery?.trays.find(item => item.projectTrayId === trayId)?.candidateRootObjectIds;
    if (matches) return matches.length === 1;
    return Boolean(plan?.requestedScope.trays.some(item => item.projectTrayId === trayId && item.orderedRootObjectIds.length));
  };
  const found = context?.trays.filter(tray => assigned(tray.projectTrayId)).length ?? 0;
  const filtered = context?.trays.filter(tray => !query.trim() || [tray.rawName, tray.routeName, tray.purposeKey ?? '']
    .some(value => searchText(value).includes(searchText(query))))
    .sort((a, b) => a.rawName.localeCompare(b.rawName, undefined, { numeric: true, sensitivity: 'base' })) ?? [];
  const disabled = !active || pf.busy || pf.viewerPhase !== 'ready';
  const writeDisabled = disabled || working || displayPending || state.loading;
  const disabledReason = !active ? 'Open Routes to use these controls.'
    : pf.viewerPhase === 'loading' ? 'The model is loading. Wait for it to finish.'
      : pf.viewerPhase === 'no-model' ? 'Load a model to use these controls.'
        : pf.viewerPhase !== 'ready' ? 'The model is not ready. Reload it to continue.'
          : pf.busy ? 'The model is busy. Wait for the current operation to finish.'
            : state.loading ? 'Reading the current tray status…'
              : state.busy ? state.unknown ? 'Checking the earlier tray update. You can stop this check.' : 'Checking project trays. You can stop this check.'
                : reading ? 'Saving the selected tray and updating the network…'
                  : displayPending ? display?.status === 'hiding' ? 'Restoring the normal model view…' : 'Showing the tray in the model…'
                    : state.unknown ? 'An earlier tray update needs checking. Use Retry tray update to continue.' : null;
  const show = async (trayId: string) => {
    if (!context || disabled || reading || !modelCurrent || pending.current || pendingDisplay.current) return;
    const target = trayDisplayTarget({ trayId, context, plan, discovery });
    if (!target.objectIds.length) return;
    const currentOwner = latestOwner.current, scope = { ...context.scope }, scopeKey = JSON.stringify(scope), ticket = {};
    const current = () => pendingDisplay.current === ticket && latestOwner.current === currentOwner
      && JSON.stringify(latestScope.current) === scopeKey;
    const previousPeek = ownedPeek.current, previousDisplay = currentDisplay, peek = { restore: () => pf.hideTray(scope) };
    const failedDisplay = previousDisplay ?? { owner: currentOwner, scope: scopeKey, trayId, status: 'failed' as const };
    ownedPeek.current = peek;
    pendingDisplay.current = ticket; setShowError(null); setDisplay({ owner: currentOwner, scope: scopeKey, trayId, status: 'showing' });
    try {
      const shown = await pf.showTray(scope, [...target.objectIds]);
      if (current()) {
        if (!shown) {
          ownedPeek.current = previousPeek ?? peek;
          setShowError({ owner: currentOwner, scope: scopeKey, trayId });
        }
        setDisplay(shown ? { owner: currentOwner, scope: scopeKey, trayId, status: 'shown' } : failedDisplay);
      }
    } catch {
      if (current()) {
        ownedPeek.current = previousPeek ?? peek;
        setDisplay(failedDisplay); setShowError({ owner: currentOwner, scope: scopeKey, trayId });
      }
    } finally {
      if (pendingDisplay.current === ticket) {
        const completedInScope = current(); pendingDisplay.current = null;
        if (!completedInScope && latestOwner.current === currentOwner) setDisplay(null);
      }
    }
  };
  const hide = async (trayId: string) => {
    if (!context || disabled || reading || !modelCurrent || pending.current || pendingDisplay.current
      || currentDisplay?.trayId !== trayId || !['shown', 'failed', 'hide-failed'].includes(currentDisplay.status)) return;
    const currentOwner = latestOwner.current, scope = { ...context.scope }, scopeKey = JSON.stringify(scope), ticket = {};
    const current = () => pendingDisplay.current === ticket && latestOwner.current === currentOwner
      && JSON.stringify(latestScope.current) === scopeKey;
    const peek = ownedPeek.current; ownedPeek.current = null;
    pendingDisplay.current = ticket; setShowError(null); setDisplay({ owner: currentOwner, scope: scopeKey, trayId, status: 'hiding' });
    try {
      const hidden = await pf.hideTray(scope);
      if (current()) {
        if (!hidden) ownedPeek.current = peek;
        setDisplay(hidden ? null : { owner: currentOwner, scope: scopeKey, trayId, status: 'hide-failed' });
      }
    } catch {
      if (current()) {
        ownedPeek.current = peek;
        setDisplay({ owner: currentOwner, scope: scopeKey, trayId, status: 'hide-failed' });
      }
    } finally {
      if (pendingDisplay.current === ticket) {
        const completedInScope = current(); pendingDisplay.current = null;
        if (!completedInScope && latestOwner.current === currentOwner) setDisplay(null);
      }
    }
  };
  const assign = async (trayId: string) => {
    if (!context || writeDisabled || !modelCurrent || state.unknown || pending.current || pendingDisplay.current) return;
    const currentOwner = latestOwner.current, scope = { ...context.scope }, ticket = {};
    const current = () => pending.current === ticket && latestOwner.current === currentOwner;
    const evidence = discovery?.objects ?? plan?.objectManifest ?? [];
    const knownRoots = new Set([...(discovery?.trays.flatMap(item => item.candidateRootObjectIds) ?? []),
      ...(plan?.requestedScope.trays.flatMap(item => item.orderedRootObjectIds) ?? []),
      ...context.resolutions.filter(item => item.mode === 'roots' && sameModel(item.scope, context.scope)).flatMap(item => item.rootObjectIds)]);
    pending.current = ticket; setReading(trayId); setSelectionError(null);
    try {
      const selected = await pf.runProjectPreparation(scope, async viewer => {
        const roots = await viewer.readTrayRootSelection();
        // A first assignment can precede discovery. Unknown selected roots need
        // exact current-node evidence; another tray's ancestry is insufficient.
        const requireMetadata = roots.objects.some(object => !knownRoots.has(`dbid:${object.objectId}`)
          && !evidence.some(saved => saved.objectId === `dbid:${object.objectId}` && saved.parentId !== null));
        const metadata = requireMetadata ? await viewer.readSelection() : null;
        if (requireMetadata && !metadata) throw new Error('The selected model objects could not be verified. Select the physical tray again.');
        return { ...roots, metadata };
      });
      if (!current()) return;
      if (JSON.stringify(latestScope.current) !== JSON.stringify(scope)) throw new Error('The project changed. Check the trays again, then select this tray.');
      if (!selected.objects.length) throw new Error('Select the matching tray in the model first.');
      const globalRoots = new Set(evidence
        .filter(object => object.parentId === null && !knownRoots.has(object.objectId)).map(object => object.objectId));
      const roots = selected.objects.map(object => `dbid:${object.objectId}`);
      if (selected.metadata) {
        const selectedIds = new Set(selected.objects.map(object => object.objectId));
        if (selected.metadata.objects.length !== selectedIds.size || selected.metadata.objects.some(object => !selectedIds.has(object.objectId)))
          throw new Error('The model selection changed. Select the matching tray again.');
        for (const object of selected.metadata.objects) if (object.parentId === null && !knownRoots.has(`dbid:${object.objectId}`)) globalRoots.add(`dbid:${object.objectId}`);
      }
      if (roots.some(id => globalRoots.has(id))) throw new Error('Select the physical tray instead of the whole model.');
      await state.assignTray(trayId, roots);
    } catch (error) {
      if (current()) setSelectionError({ trayId, message: error instanceof Error ? error.message : 'The model selection could not be assigned. Try again.' });
    } finally {
      if (current()) { pending.current = null; setReading(null); }
    }
  };
  return <section aria-label="Project tray preparation">
    <Button appearance="primary" disabled={writeDisabled} onClick={() => void state.checkTrays()}>
      {state.unknown ? state.busy ? 'Checking tray update…' : 'Retry tray update' : 'Discover project tray candidates'}
    </Button>
    {state.busy ? <Button onClick={state.pause} style={{ marginLeft: 8 }}>Stop checking</Button> : null}
    {disabledReason ? <p>{disabledReason}</p> : null}
    {working ? <Spinner size="tiny" label={state.progress ?? (state.unknown ? 'Checking the earlier tray update…' : 'Checking trays and preparing the network…')} style={{ marginBlock: 12 }} />
      : saved ? <p role="status">Network ready. {found} of {context!.trays.length} trays assigned{found < context!.trays.length ? `; ${context!.trays.length - found} still need a model selection` : ''}.</p>
        : <p>Check the trays to prepare the routing network automatically.</p>}
    {blockers.length ? <div role="alert" aria-label="Network preparation blockers">
      <p>Network preparation is blocked. Assigned objects are saved; resolve these issues, then choose Discover project tray candidates again.</p>
      <ul>{blockers.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul>
    </div> : state.error ? <p role="alert">{state.error}</p> : null}
    {state.notice && !state.error && !working && !saved ? <p role="status">{state.notice}</p> : null}
    {context ? <>
      <Field label="Search project trays" style={{ marginBlock: 12 }}>
        <Input type="search" aria-label="Search project trays" placeholder="Tray name or purpose" value={query}
          onChange={(_, data) => setQuery(data.value)} />
      </Field>
      {!filtered.length ? <p>No project trays match this search.</p> : null}
      <div aria-label="Project trays" style={{ display: 'grid', gap: 12 }}>
        {filtered.map(tray => {
          const isAssigned = assigned(tray.projectTrayId);
          const target = trayDisplayTarget({ trayId: tray.projectTrayId, context, plan, discovery });
          const unavailable = !modelCurrent ? 'Load the matching model before showing this tray.' : target.message;
          const showing = currentDisplay?.trayId === tray.projectTrayId && currentDisplay.status === 'showing';
          const hiding = currentDisplay?.trayId === tray.projectTrayId && currentDisplay.status === 'hiding';
          const canHide = currentDisplay?.trayId === tray.projectTrayId && ['shown', 'hiding', 'hide-failed'].includes(currentDisplay.status);
          return <article key={tray.projectTrayId} aria-label={`Tray ${tray.rawName}`}
          style={{ border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: 6, padding: 12, minWidth: 0, overflowWrap: 'anywhere' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <h4 style={{ margin: '0 0 8px' }}>{tray.rawName}</h4>
            <span>{isAssigned ? 'Assigned' : 'Not assigned'}</span>
          </div>
          {isAssigned ? <dl style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '4px 8px', margin: '0 0 12px' }}>
            <dt>Type</dt><dd style={{ margin: 0 }}>{tray.details ? tray.details.type || 'Not specified' : 'Not available'}</dd>
            <dt>Width × height</dt><dd style={{ margin: 0 }}>{tray.details?.widthMm ?? '—'} × {tray.details?.heightMm ?? '—'} mm</dd>
          </dl> : null}
          <strong>Purpose and routing permission</strong>
          <p style={{ marginBlock: 8 }}>{tray.purposeKey ?? 'Missing purpose'}<br />
            {tray.policyState === 'configured' ? permissions?.owner === permissionOwner
              ? permissions.value.rules.find(rule => rule.purposeKey === tray.purposeKey)?.allowedCategories.join(', ') || 'Routing permitted'
              : 'Routing permitted' : tray.policyState === 'excluded' ? 'Excluded from routing' : 'Set routing permissions in Project Details'}
          </p>
          {blockers.filter(issue => issue.trayIds.includes(tray.projectTrayId)).map(issue => <p key={issue.code} style={{ color: tokens.colorPaletteRedForeground1, marginBlock: 8 }}>{issue.message}</p>)}
          <Button disabled={disabled || Boolean(reading) || displayPending || !modelCurrent || (!canHide && !target.objectIds.length)}
            aria-label={`${canHide ? 'Hide' : 'Show'} tray ${tray.rawName}`} onClick={() => void (canHide ? hide(tray.projectTrayId) : show(tray.projectTrayId))}
            style={{ width: '100%', whiteSpace: 'normal', marginBottom: 8 }}>
            {showing ? 'Showing tray…' : hiding ? 'Hiding tray…' : canHide ? 'Hide' : 'Show tray'}
          </Button>
          {unavailable ? <p style={{ marginBlock: 8 }}>{unavailable}</p> : null}
          {currentDisplay?.trayId === tray.projectTrayId && currentDisplay.status === 'shown' ? <p role="status">Tray shown in model.</p> : null}
          {currentShowError?.trayId === tray.projectTrayId ? <p role="alert">The tray could not be shown. Check the model and try again.</p> : null}
          {currentDisplay?.trayId === tray.projectTrayId && currentDisplay.status === 'failed' ? <Button
            disabled={disabled || Boolean(reading) || displayPending || !modelCurrent} aria-label={`Hide tray ${tray.rawName}`}
            onClick={() => void hide(tray.projectTrayId)} style={{ width: '100%', whiteSpace: 'normal', marginBottom: 8 }}>
            Hide
          </Button> : null}
          {currentDisplay?.trayId === tray.projectTrayId && currentDisplay.status === 'hide-failed' ? <p role="alert">The normal model view could not be restored. Check the model and select Hide to try again.</p> : null}
          <Button disabled={writeDisabled || !modelCurrent || state.unknown} aria-label={`Use current model selection for ${tray.rawName}`}
            onClick={() => void assign(tray.projectTrayId)} style={{ width: '100%', whiteSpace: 'normal' }}>
            {reading === tray.projectTrayId ? 'Assigning tray…' : 'Use current model selection'}
          </Button>
          {selectionError?.trayId === tray.projectTrayId ? <p role="alert">{selectionError.message}</p> : null}
        </article>;
        })}
      </div>
    </> : null}
  </section>;
}
