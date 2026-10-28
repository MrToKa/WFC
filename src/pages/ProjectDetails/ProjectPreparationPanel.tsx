import { useEffect, useRef, useState } from 'react';
import { Body1, Button, Field, Input, Spinner, tokens } from '@fluentui/react-components';
import type { usePathFinder } from './hooks/usePathFinder';
import { useProjectPreparation } from './hooks/useProjectPreparation';
import type { PreparationScope } from '../../../shared/pathfinderPreparation';
import { fetchRoutingPurposePolicy, type RoutingPurposePolicy } from '@/api/pathfinderPolicies';
import { trayDisplayTarget } from './trayDisplayTarget';

type Props = { pf: ReturnType<typeof usePathFinder>; active: boolean; onBusyChange?: (busy: boolean) => void; onNetworkReady?: (key: string) => void };
const searchText = (text: string) => text.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase().replace(/^\/+/, '');
const sameModel = (left: { modelVersionId: string | null; contentFingerprint: string | null; selectionRevision: string | null }, right: PreparationScope) =>
  left.modelVersionId === right.modelVersionId && left.contentFingerprint === right.contentFingerprint && left.selectionRevision === right.selectionRevision;

export function ProjectPreparationPanel({ pf, active, onBusyChange, onNetworkReady }: Props) {
  const state = useProjectPreparation(pf, active);
  const [query, setQuery] = useState('');
  const [reading, setReading] = useState<string | null>(null);
  const [display, setDisplay] = useState<{ owner: string; scope: string; trayId: string; status: 'showing' | 'shown' | 'failed' } | null>(null);
  const [selectionError, setSelectionError] = useState<{ trayId: string; message: string } | null>(null);
  const [permissions, setPermissions] = useState<{ owner: string; value: RoutingPurposePolicy } | null>(null);
  const pending = useRef<object | null>(null);
  const pendingDisplay = useRef<object | null>(null);
  const owner = JSON.stringify([pf.preparationAccess, state.context?.scope.modelVersionId,
    state.context?.scope.contentFingerprint, state.context?.scope.selectionRevision, pf.data?.activeModel, pf.preparationViewerGeneration, active]);
  const permissionOwner = JSON.stringify([pf.preparationAccess, state.context?.projectId,
    state.context?.scope.catalogRevision, state.context?.scope.routingPolicyRevision]);
  const context = state.context;
  const displayScope = JSON.stringify(context?.scope);
  const currentDisplay = display?.owner === owner && display.scope === displayScope ? display : null;
  const showPending = display?.owner === owner && display.status === 'showing';
  const modelCurrent = Boolean(context && pf.data?.activeModel && context.projectId === pf.preparationAccess?.projectId && sameModel(pf.data.activeModel, context.scope));
  const readyNotificationKey = active && state.networkReady && modelCurrent && context?.currentAggregate && pf.viewerPhase === 'ready'
    ? state.networkReadinessKey : null;
  useEffect(() => { if (readyNotificationKey) onNetworkReady?.(readyNotificationKey); }, [readyNotificationKey, onNetworkReady]);
  const latestOwner = useRef(owner), latestScope = useRef(state.context?.scope);
  latestOwner.current = owner; latestScope.current = state.context?.scope;
  useEffect(() => {
    pending.current = null; pendingDisplay.current = null; setReading(null); setDisplay(null); setSelectionError(null); setQuery('');
    return () => { pending.current = null; pendingDisplay.current = null; };
  }, [owner]);
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
    .some(value => searchText(value).includes(searchText(query)))) ?? [];
  const disabled = !active || pf.busy || pf.viewerPhase !== 'ready';
  const writeDisabled = disabled || working || showPending || state.loading;
  const disabledReason = !active ? 'Open Routes to use these controls.'
    : pf.viewerPhase === 'loading' ? 'The model is loading. Wait for it to finish.'
      : pf.viewerPhase === 'no-model' ? 'Load a model to use these controls.'
        : pf.viewerPhase !== 'ready' ? 'The model is not ready. Reload it to continue.'
          : pf.busy ? 'The model is busy. Wait for the current operation to finish.'
            : state.loading ? 'Reading the current tray status…'
              : state.busy ? 'Checking project trays. You can stop this check.'
                : reading ? 'Saving the selected tray and updating the network…'
                  : showPending ? 'Showing the tray in the model…'
                    : state.unknown ? 'An earlier tray update needs checking. Use Discover project tray candidates to continue.' : null;
  const show = async (trayId: string) => {
    if (!context || disabled || reading || !modelCurrent || pending.current || pendingDisplay.current) return;
    const target = trayDisplayTarget({ trayId, context, plan, discovery });
    if (!target.objectIds.length) return;
    const currentOwner = latestOwner.current, scope = { ...context.scope }, scopeKey = JSON.stringify(scope), ticket = {};
    const current = () => pendingDisplay.current === ticket && latestOwner.current === currentOwner
      && JSON.stringify(latestScope.current) === scopeKey;
    pendingDisplay.current = ticket; setDisplay({ owner: currentOwner, scope: scopeKey, trayId, status: 'showing' });
    try {
      const shown = await pf.showTray(scope, [...target.objectIds]);
      if (current()) setDisplay({ owner: currentOwner, scope: scopeKey, trayId, status: shown ? 'shown' : 'failed' });
    } catch {
      if (current()) setDisplay({ owner: currentOwner, scope: scopeKey, trayId, status: 'failed' });
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
      Discover project tray candidates
    </Button>
    {state.busy ? <Button onClick={state.pause} style={{ marginLeft: 8 }}>Stop checking</Button> : null}
    {disabledReason ? <p>{disabledReason}</p> : null}
    {working ? <Spinner size="tiny" label={state.progress ?? 'Checking trays and preparing the network…'} style={{ marginBlock: 12 }} />
      : saved ? <p role="status">Network ready. {found} of {context!.trays.length} trays assigned{found < context!.trays.length ? `; ${context!.trays.length - found} still need a model selection` : ''}.</p>
        : <p>Check the trays to prepare the routing network automatically.</p>}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.notice && !state.error && !working && !saved ? <p role="status">{state.notice}</p> : null}
    {context ? <>
      <Field label="Search project trays" style={{ marginBlock: 12 }}>
        <Input type="search" aria-label="Search project trays" placeholder="Tray name or purpose" value={query}
          onChange={(_, data) => setQuery(data.value)} />
      </Field>
      {!filtered.length ? <p>No project trays match this search.</p> : null}
      <div aria-label="Project trays" style={{ display: 'grid', gap: 12 }}>
        {filtered.map(tray => {
          const target = trayDisplayTarget({ trayId: tray.projectTrayId, context, plan, discovery });
          const unavailable = !modelCurrent ? 'Load the matching model before showing this tray.' : target.message;
          const showing = currentDisplay?.trayId === tray.projectTrayId && currentDisplay.status === 'showing';
          return <article key={tray.projectTrayId} aria-label={`Tray ${tray.rawName}`}
          style={{ border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: 6, padding: 12, minWidth: 0, overflowWrap: 'anywhere' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <h4 style={{ margin: '0 0 8px' }}>{tray.rawName}</h4>
            <span>{assigned(tray.projectTrayId) ? 'Assigned' : 'Not assigned'}</span>
          </div>
          <strong>Purpose and routing permission</strong>
          <p style={{ marginBlock: 8 }}>{tray.purposeKey ?? 'Missing purpose'}<br />
            {tray.policyState === 'configured' ? permissions?.owner === permissionOwner
              ? permissions.value.rules.find(rule => rule.purposeKey === tray.purposeKey)?.allowedCategories.join(', ') || 'Routing permitted'
              : 'Routing permitted' : tray.policyState === 'excluded' ? 'Excluded from routing' : 'Set routing permissions in Project Details'}
          </p>
          <Button disabled={disabled || Boolean(reading) || showPending || !modelCurrent || !target.objectIds.length}
            aria-label={`Show tray ${tray.rawName}`} onClick={() => void show(tray.projectTrayId)}
            style={{ width: '100%', whiteSpace: 'normal', marginBottom: 8 }}>
            {showing ? 'Showing tray…' : 'Show tray'}
          </Button>
          {unavailable ? <p style={{ marginBlock: 8 }}>{unavailable}</p> : null}
          {currentDisplay?.trayId === tray.projectTrayId && currentDisplay.status === 'shown' ? <p role="status">Tray shown in model.</p> : null}
          {currentDisplay?.trayId === tray.projectTrayId && currentDisplay.status === 'failed' ? <p role="alert">The tray could not be shown. Check the model and try again.</p> : null}
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
