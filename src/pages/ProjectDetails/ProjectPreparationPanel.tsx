import { useEffect, useRef, useState } from 'react';
import { Body1, Button, Caption1, Field, Spinner, Textarea } from '@fluentui/react-components';
import type { usePathFinder } from './hooks/usePathFinder';
import { useProjectPreparation } from './hooks/useProjectPreparation';
import { routingPurposeDisplayLabels } from '@/components/RoutingPurposePolicyCard';
import { PREPARATION_LIMITS } from '../../../shared/pathfinderPreparation';
import {GeometryTracePanel} from './GeometryTracePanel';
import { ModelRevisionChangesPanel } from './ModelRevisionChangesPanel';

type Props = {
  pf: ReturnType<typeof usePathFinder>;
  active: boolean;
  onBusyChange?: (busy: boolean) => void;
};
export function ProjectPreparationPanel({ pf, active, onBusyChange }: Props) {
  const state = useProjectPreparation(pf, active);
  const [chosen, setChosen] = useState<Record<string, string[]>>({}),
    [reasons, setReasons] = useState<Record<string, string>>({}),
    [commandReason, setCommandReason] = useState('');
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null),
    [page, setPage] = useState(0);
  const [comparisonPending, setComparisonPending] = useState(false);
  const scopeKey = JSON.stringify([pf.preparationAccess, state.context?.scope]);
  const latestScope = useRef(scopeKey);
  latestScope.current = scopeKey;
  useEffect(() => {
    setChosen({});
    setReasons({});
    setSelectionNotice(null);
    setPage(0);
  }, [scopeKey]);
  useEffect(() => {
    onBusyChange?.(state.busy || comparisonPending);
    return () => onBusyChange?.(false);
  }, [state.busy, comparisonPending, onBusyChange]);
  if (!state.enabled)
    return <Body1>Current administrator project access is required for project preparation.</Body1>;
  const context = state.context,
    session = state.session,
    canChange = state.canMutate && active;
  const variants = routingPurposeDisplayLabels(context?.trays.map((tray) => tray.purposeKey) ?? []);
  const partsReady = Boolean(
    session &&
      session.coverage.requestedScopeComplete &&
      session.coverage.committedParts === session.coverage.expectedParts &&
      session.coverage.expectedParts > 0,
  );
  const copySelection = async (trayId: string) => {
    const captured = latestScope.current;
    if (!context) return;
    const selected = await pf
      .runProjectPreparation(context.scope, (viewer) => viewer.readSelection())
      .catch(() => null);
    if (captured !== latestScope.current) return;
    if (!selected?.objects.length) {
      setSelectionNotice('Select the intended model objects, then read the current selection.');
      return;
    }
    setChosen((value) => ({
      ...value,
      [trayId]: selected.objects.map((item) => `dbid:${item.objectId}`),
    }));
    setSelectionNotice(
      'Selection copied into the resolution draft. Confirm its physical ownership and give a reason before saving.',
    );
  };
  return (
    <section aria-label="Project tray purposes preparation">
      <h3>Project tray purposes</h3>
      <p>
        Complete staged captures are limited to{' '}
        {PREPARATION_LIMITS.validationInputBytes / 1024 / 1024} MiB for validation. Committed parts
        remain available when collection is paused or refused.
      </p>
      <Body1>
        Discover exact model candidates for the project tray catalog. Routing categories come from
        the saved administrator permissions in Details.
      </Body1>
      <Caption1>
        Manual resolutions confirm physical ownership. They do not grant routing permissions.
        Published preparation covers the requested project scope; it does not claim whole-plant or
        native engineering acceptance.
      </Caption1>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <Button disabled={state.busy} onClick={() => void state.refresh()}>
          Refresh preparation status
        </Button>
        <Button
          appearance="primary"
          disabled={!canChange || pf.viewerPhase !== 'ready'}
          onClick={() => void state.discover()}
        >
          Discover project tray candidates
        </Button>
        <Button
          disabled={!canChange || !state.discovery?.complete}
          onClick={() => void state.freezePlan()}
        >
          Freeze reviewed preparation plan
        </Button>
        <Button disabled={state.busy || pf.viewerPhase === 'loading'} onClick={pf.reloadViewer}>
          Reload protected model
        </Button>
      </div>
      {state.loading ? <Spinner size="tiny" label="Loading current preparation..." /> : null}
      {state.busy ? (
        <Spinner size="tiny" label={state.progress ?? 'Working on project preparation...'} />
      ) : null}
      {state.notice ? <p role="status">{state.notice}</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.conflict ? (
        <p role="alert">
          Refresh and review the current project state before submitting a new command.
        </p>
      ) : null}
      {state.unknown ? (
        <div role="alert">
          <p>
            The exact pending command is retained. New changes are frozen until its outcome is
            reconciled.
          </p>
          <Button
            disabled={state.cancelBusy || (state.busy && !state.cancellationPending)}
            onClick={() => void state.retry()}
          >
            Retry the same preparation command
          </Button>
        </div>
      ) : null}
      {state.busy ? <Button onClick={state.pause}>Pause local collection</Button> : null}
      {selectionNotice ? <p role="status">{selectionNotice}</p> : null}
      <details><summary>Traceability</summary><GeometryTracePanel pf={pf} active={active} aggregate={context?.currentAggregate??null}/></details>
      <details><summary>Model revision changes</summary><ModelRevisionChangesPanel
        projectId={pf.preparationAccess?.projectId ?? null} loadedProjectId={pf.preparationAccess?.loadedProjectId ?? null}
        token={pf.preparationAccess?.token ?? null} isAdmin={Boolean(pf.preparationAccess?.isAdmin)} active={active}
        contextKey={JSON.stringify([pf.data?.activeModel, context?.currentAggregate?.id, pf.preparationViewerGeneration])}
        onDecisionSaved={() => pf.refresh()} onAuthorityLost={() => { pf.cancelOperation(); pf.refresh(); }}
        onRecoveryPendingChange={setComparisonPending}
      /></details>
      {context ? (
        <>
          <p>
            {context.trays.length} project trays · {context.endpointNames.length} project endpoint
            names · Routing policy revision {context.scope.routingPolicyRevision}
          </p>
          {context.currentAggregate ? (
            <p>
              Current published network: geometry revision{' '}
              {context.currentAggregate.geometryRevision}. Its complete previous aggregate is
              retained until a replacement is published.
            </p>
          ) : (
            <p>No project-prepared network has been published.</p>
          )}
          {context.diagnostics.length ? (
            <ul aria-label="Project routing diagnostics">
              {context.diagnostics.map((item, index) => (
                <li key={index}>{item.message}</li>
              ))}
            </ul>
          ) : null}
          {state.discovery ? (
            <p role="status">
              Discovery: {state.discovery.objects.length} inventory records. Candidate pagination{' '}
              {state.discovery.complete ? 'complete' : 'incomplete'}.{' '}
              {state.discovery.propertyScan
                ? `Endpoint properties: ${state.discovery.propertyScan.returnedObjectCount} of ${state.discovery.propertyScan.attemptedObjectCount} returned; ${state.discovery.propertyScan.omittedObjectCount} unavailable.`
                : 'No endpoint property search was requested.'}
            </p>
          ) : null}
          <section
            aria-label="Project tray candidate coverage"
            style={{ display: 'grid', gap: 12, minWidth: 0 }}
          >
            {context.trays.slice(page * 25, (page + 1) * 25).map((tray) => {
              const matches = state.discovery?.trays.find(
                (value) => value.projectTrayId === tray.projectTrayId,
              )?.candidateRootObjectIds;
              const resolution = context.resolutions.find(
                (value) => value.projectTrayId === tray.projectTrayId,
              );
              const selected = chosen[tray.projectTrayId] ?? [];
              const reason = reasons[tray.projectTrayId] ?? '';
              const purpose = tray.purposeKey ?? 'Missing purpose',
                variant = tray.purposeKey ? variants.get(tray.purposeKey) : undefined;
              const label = `${tray.rawName} (${tray.projectTrayId})`;
              return (
                <article
                  key={tray.projectTrayId}
                  aria-label={`Tray coverage for ${label}`}
                  style={{
                    border: '1px solid #ccc',
                    borderRadius: 6,
                    padding: 12,
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    wordBreak: 'normal',
                  }}
                >
                  <h4
                    style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {tray.rawName}
                  </h4>
                  <dl style={{ margin: 0, display: 'grid', gap: 16, minWidth: 0 }}>
                    <div style={{ minWidth: 0 }}>
                      <dt style={{ fontWeight: 600, marginBottom: 6 }}>
                        Purpose and routing permission
                      </dt>
                      <dd style={{ margin: 0, minWidth: 0, display: 'grid', gap: 8 }}>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{purpose}</span>
                        {variant ? (
                          <div>
                            {variant.variant} · Spaces shown as dots: {variant.exactSpacing}
                          </div>
                        ) : null}
                        <div>
                          {tray.policyState === 'configured'
                            ? tray.allowedCategories.join(', ')
                            : tray.policyState === 'excluded'
                              ? 'Excluded'
                              : tray.policyState === 'unconfigured'
                                ? 'Unconfigured'
                                : 'Invalid purpose'}
                        </div>
                        {tray.diagnosticCodes.map((code) => (
                          <div key={code}>{code.replaceAll('_', ' ').toLowerCase()}</div>
                        ))}
                      </dd>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <dt style={{ fontWeight: 600, marginBottom: 6 }}>
                        Exact candidates and coverage
                      </dt>
                      <dd style={{ margin: 0, minWidth: 0, display: 'grid', gap: 8 }}>
                        {matches === undefined
                          ? 'Not yet discovered'
                          : matches.length === 0
                            ? 'Missing exact candidate'
                            : matches.length === 1
                              ? 'One exact candidate'
                              : 'Multiple physical roots require explicit confirmation'}
                        <ul>
                          {matches?.map((id) => (
                            <li key={id}>
                              <label>
                                <input
                                  type="checkbox"
                                  aria-label={`Confirm ${id} for ${label}`}
                                  checked={selected.includes(id)}
                                  disabled={!canChange}
                                  onChange={(event) =>
                                    setChosen((value) => ({
                                      ...value,
                                      [tray.projectTrayId]: event.target.checked
                                        ? [...selected, id]
                                        : selected.filter((item) => item !== id),
                                    }))
                                  }
                                />
                                {state.discovery?.objects.find((value) => value.objectId === id)
                                  ?.name ?? 'Model object'}{' '}
                                · {id}
                              </label>
                            </li>
                          ))}
                        </ul>
                        {resolution ? (
                          <div>
                            Saved{' '}
                            {resolution.mode === 'exclude'
                              ? 'exclusion'
                              : `${resolution.rootObjectIds.length} confirmed roots`}
                            : {resolution.reason}
                            <br />
                            Saved {resolution.createdAt} by administrator {resolution.actorId}
                          </div>
                        ) : null}
                      </dd>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <dt style={{ fontWeight: 600, marginBottom: 6 }}>
                        Audited manual resolution
                      </dt>
                      <dd style={{ margin: 0, minWidth: 0, display: 'grid', gap: 8 }}>
                        <Button
                          size="small"
                          style={{
                            width: '100%',
                            maxWidth: '100%',
                            minWidth: 0,
                            whiteSpace: 'normal',
                            textAlign: 'left',
                            justifyContent: 'flex-start',
                          }}
                          disabled={!canChange || pf.viewerPhase !== 'ready'}
                          onClick={() => void copySelection(tray.projectTrayId)}
                        >
                          Use current model selection
                        </Button>
                        <p>
                          {selected.length} roots in this draft
                          {selected.length ? `: ${selected.join(', ')}` : ''}
                        </p>
                        <Field label={`Resolution reason for ${tray.rawName}`}>
                          <Textarea
                            aria-label={`Resolution reason for ${label}`}
                            maxLength={2048}
                            value={reason}
                            disabled={!canChange}
                            onChange={(_, data) =>
                              setReasons((value) => ({
                                ...value,
                                [tray.projectTrayId]: data.value,
                              }))
                            }
                          />
                        </Field>
                        <Button
                          size="small"
                          style={{
                            width: '100%',
                            maxWidth: '100%',
                            minWidth: 0,
                            whiteSpace: 'normal',
                            textAlign: 'left',
                            justifyContent: 'flex-start',
                          }}
                          disabled={!canChange || !selected.length || !reason.trim()}
                          onClick={() =>
                            void state.resolve(tray.projectTrayId, 'roots', selected, reason.trim())
                          }
                        >
                          Save confirmed roots
                        </Button>
                        <Button
                          size="small"
                          style={{
                            width: '100%',
                            maxWidth: '100%',
                            minWidth: 0,
                            whiteSpace: 'normal',
                            textAlign: 'left',
                            justifyContent: 'flex-start',
                          }}
                          disabled={!canChange || !reason.trim()}
                          onClick={() =>
                            void state.resolve(tray.projectTrayId, 'exclude', [], reason.trim())
                          }
                        >
                          Exclude from this preparation scope
                        </Button>
                        <Button
                          size="small"
                          style={{
                            width: '100%',
                            maxWidth: '100%',
                            minWidth: 0,
                            whiteSpace: 'normal',
                            textAlign: 'left',
                            justifyContent: 'flex-start',
                          }}
                          disabled={!canChange || !resolution || !reason.trim()}
                          onClick={() =>
                            void state.resolve(tray.projectTrayId, 'reset', [], reason.trim())
                          }
                        >
                          Reset saved resolution
                        </Button>
                      </dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </section>
          {context.trays.length > 25 ? (
            <div>
              <Button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
                Previous tray coverage
              </Button>
              <span>
                {' '}
                Page {page + 1} of {Math.ceil(context.trays.length / 25)}{' '}
              </span>
              <Button
                disabled={(page + 1) * 25 >= context.trays.length}
                onClick={() => setPage((value) => value + 1)}
              >
                Next tray coverage
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {state.index?.sessions.length ? (
        <details>
          <summary>Saved preparations</summary>
          <ul>
            {state.index.sessions.map((item) => (
              <li key={item.id}>
                {item.createdAt} · {item.state}{' '}
                <Button
                  size="small"
                  disabled={!canChange}
                  onClick={() => void state.loadSession(item.id)}
                >
                  Open preparation {item.id.slice(0, 8)}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {session ? (
        <div aria-label="Frozen preparation plan">
          <h4>Frozen preparation</h4>
          <p>
            {session.state} · Revision {session.sessionRevision} · Plan{' '}
            <span title={session.plan.orderedPlanSha256}>
              {session.plan.orderedPlanSha256.slice(0, 16)}
            </span>
          </p>
          <p>
            {session.coverage.committedParts} of {session.coverage.expectedParts} parts committed ·{' '}
            {session.plan.requestedScope.orderedPhysicalLeafIds.length} physical leaves ·{' '}
            {session.plan.requestedScope.endpointNames.length} endpoint names
          </p>
          <p>
            Endpoint binding readiness:{' '}
            {
              session.plan.requestedScope.endpointEvidence.filter(
                (item) => item.status !== 'unique_candidate',
              ).length
            }{' '}
            names need later resolution. Complete geometry capture does not confirm equipment
            bindings.
          </p>
          <ul aria-label="Endpoint candidate evidence">
            {session.plan.requestedScope.endpointEvidence.map((item) => (
              <li key={item.name}>
                {item.name}: {item.status.replaceAll('_', ' ')} ({item.candidateObjectIds.length}{' '}
                candidates)
              </li>
            ))}
          </ul>
          <Caption1>
            Arrival order does not change the frozen part order. Resume reuses committed parts;
            partial captures never become the current network.
          </Caption1>
          {session.failure ? <p role="alert">{session.failure.message}</p> : null}
          {session.plan.diagnostics.length ? (
            <ul aria-label="Frozen plan diagnostics">
              {session.plan.diagnostics.map((item, index) => (
                <li key={index}>{item.message}</li>
              ))}
            </ul>
          ) : null}
          <Field label="Preparation command reason">
            <Textarea
              aria-label="Preparation command reason"
              maxLength={2048}
              value={commandReason}
              disabled={!canChange && !state.publishPending && session.state !== 'validating'}
              onChange={(_, value) => setCommandReason(value.value)}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              disabled={
                !canChange ||
                pf.viewerPhase !== 'ready' ||
                !['planned', 'collecting'].includes(session.state) ||
                session.plan.diagnostics.length > 0
              }
              onClick={() => void state.collect()}
            >
              Resume collection
            </Button>
            <Button
              appearance="primary"
              disabled={
                !canChange ||
                !partsReady ||
                !['collecting', 'planned'].includes(session.state) ||
                !commandReason.trim()
              }
              onClick={() => void state.publish(commandReason.trim())}
            >
              Validate and publish complete network
            </Button>
            <Button
              disabled={
                state.cancelBusy ||
                (!canChange && !state.publishPending && session.state !== 'validating') ||
                !['planned', 'collecting', 'validating'].includes(session.state) ||
                !commandReason.trim()
              }
              onClick={() =>
                void (state.publishPending || session.state === 'validating'
                  ? state.cancelActive(commandReason.trim())
                  : state.cancel(commandReason.trim()))
              }
            >
              Cancel frozen preparation
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
