import { generateId } from '@/utils/generateId';
import { useEffect, useState } from 'react';
import { Button, Field, Spinner, Textarea } from '@fluentui/react-components';
import {
  useModelRevisionChanges,
  type ModelRevisionChangesAccess,
} from './hooks/useModelRevisionChanges';
import { RevisionMappingReview } from './RevisionMappingReview';
import type { RevisionComparisonCreate } from '@/api/pathfinderRevisionChanges';
type Props = ModelRevisionChangesAccess;
const button = {
  maxWidth: '100%',
  whiteSpace: 'normal' as const,
  textAlign: 'left' as const,
  overflowWrap: 'anywhere' as const,
};
const words = (value: string) => value.replaceAll('-', ' ').replaceAll('_', ' ').toLowerCase();
export function ModelRevisionChangesPanel(props: Props) {
  return props.isAdmin ? <AdminRevisionChangesPanel {...props} /> : null;
}
function AdminRevisionChangesPanel(props: Props) {
  const state = useModelRevisionChanges(props);
  const [sourceId, setSourceId] = useState(''),
    [targetId, setTargetId] = useState(''),
    [reason, setReason] = useState(''),
    [filter, setFilter] = useState(''),
    [selectedRow, setSelectedRow] = useState<number | null>(null);
  const context = state.context,
    manifest = state.manifest;
  const locked =
    state.busy || state.unknown || state.recoveryPending || state.conflict || !props.active;
  const source = context?.choices.find((choice) => choice.traceId === sourceId),
    target = context?.choices.find((choice) => choice.traceId === targetId);
  useEffect(() => {
    if (!state.recoveryPending && !state.unknown) {
      setSourceId('');
      setTargetId('');
      setReason('');
      setSelectedRow(null);
    }
  }, [props.contextKey, props.projectId, props.token]);
  useEffect(() => {
    setSelectedRow(null);
  }, [manifest?.id, state.page?.offset]);
  const pendingPair = state.pending?.kind === 'create' ? state.pending.body : null;
  const displayedSourceId = pendingPair?.source.traceId ?? sourceId,
    displayedTargetId = pendingPair?.target.traceId ?? targetId;
  const create = () => {
    if (
      locked ||
      !context?.capabilities.compare ||
      !source ||
      !target ||
      source.aggregateId === target.aggregateId ||
      !reason.trim()
    )
      return;
    const pair = (choice: typeof source) => ({
      aggregateId: choice.aggregateId,
      traceId: choice.traceId,
      projectionSha256: choice.projectionSha256,
      traceContentSha256: choice.traceContentSha256,
    });
    const command: RevisionComparisonCreate = {
      schemaVersion: 'wfc.pf.revision-comparison-create.v1',
      source: pair(source),
      target: pair(target),
      expectedComparisonRevision: context.comparisonRevision,
      idempotencyKey: generateId(),
      reason: reason.trim(),
    };
    void state.create(command);
  };
  const selected = state.page?.changes.find((change) => change.rowIndex === selectedRow) ?? null;
  const flags = [...new Set(state.page?.changes.flatMap((change) => change.flags) ?? [])];
  return (
    <section
      aria-label="Model revision changes"
      style={{
        display: 'grid',
        gap: 10,
        minWidth: 0,
        wordBreak: 'normal',
        overflowWrap: 'anywhere',
      }}
    >
      <h3 style={{ margin: 0 }}>Model revision changes</h3>
      <p>
        Compare two saved prepared scopes. Choosing a pair does not change the active model.
        Historical results remain history.
      </p>
      {state.busy ? <Spinner size="tiny" label="Reading or comparing saved revisions" /> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.unknown ? (
        <>
          <p>
            The exact command and pair are retained. Reconcile them before changing the comparison.
          </p>
          {state.pending?.kind === 'decision' ? (
            <p>
              Retained comparison {state.pending.comparisonId} · {words(state.pending.body.kind)}.
              Its exact review body and command key remain unchanged.
            </p>
          ) : null}
          <Button style={button} disabled={state.busy} onClick={() => void state.retry()}>
            Reconcile same comparison command
          </Button>
        </>
      ) : null}
      {state.conflict ? (
        <Button style={button} disabled={state.busy} onClick={() => void state.refresh()}>
          Discard draft and refresh comparison
        </Button>
      ) : null}
      {(['source', 'target'] as const).map((side) => (
        <Field key={side} label={side === 'source' ? 'Old saved revision' : 'New saved revision'}>
          <select
            style={{ maxWidth: '100%', minWidth: 0 }}
            aria-label={side === 'source' ? 'Old saved revision' : 'New saved revision'}
            disabled={locked || !context}
            value={side === 'source' ? displayedSourceId : displayedTargetId}
            onChange={(event) => {
              (side === 'source' ? setSourceId : setTargetId)(event.target.value);
              setSelectedRow(null);
            }}
          >
            <option value="">Choose a saved scope</option>
            {context?.choices.map((choice) => (
              <option key={choice.traceId} value={choice.traceId}>
                {choice.modelLabel} · geometry {choice.geometryRevision} · aggregate{' '}
                {choice.aggregateId} · {choice.createdAt}
              </option>
            ))}
          </select>
        </Field>
      ))}
      {[source, target].map((choice, index) =>
        choice ? (
          <article key={index} style={{ minWidth: 0 }}>
            <strong>{index === 0 ? 'Old' : 'New'} scope</strong>
            <p>
              {choice.coverage.includedObjects} included objects · {choice.coverage.excludedObjects ?? 'Unavailable'}{' '}
              exclusions. Requested scope{' '}
              {choice.coverage.requestedScopeComplete ? 'complete' : 'incomplete'}.
            </p>
            <p>
              Capture frame {choice.captureFrameId}. A capture frame does not establish a common
              engineering frame.
            </p>
          </article>
        ) : null,
      )}
      {context && context.choices.length < 2 ? (
        <p>
          Two different published prepared scopes with saved traces are required. A partial
          diagnostic scope does not represent the whole plant.
        </p>
      ) : null}
      <Field label="Comparison reason">
        <Textarea
          aria-label="Comparison reason"
          disabled={locked}
          value={reason}
          onChange={(_, data) => setReason(data.value)}
        />
      </Field>
      <Button
        style={button}
        disabled={
          locked ||
          !context?.capabilities.compare ||
          !source ||
          !target ||
          source.aggregateId === target.aggregateId ||
          !reason.trim()
        }
        onClick={create}
      >
        Compare saved revisions
      </Button>
      <Button
        style={button}
        disabled={state.busy || state.recoveryPending || state.unknown}
        onClick={() => void state.refresh()}
      >
        Refresh model revision changes
      </Button>
      <details>
        <summary>Saved comparisons</summary>
        {state.list?.comparisons.map((item) => (
          <article
            key={item.id}
            style={{
              border: '1px solid #ccc',
              padding: 8,
              borderRadius: 6,
              marginTop: 8,
              minWidth: 0,
            }}
          >
            <p>
              Comparison revision {item.comparisonRevision}
              <br />
              {item.source.modelVersionId} → {item.target.modelVersionId}
              <br />
              {item.counts.unresolved} unresolved · {item.createdAt}
            </p>
            <Button style={button} disabled={locked} onClick={() => void state.open(item.id)}>
              Open comparison {item.id.slice(0, 8)}
            </Button>
          </article>
        ))}
        {state.list ? (
          <>
            <Button
              style={button}
              disabled={locked || state.list.offset === 0}
              onClick={() => void state.listPage(Math.max(0, state.list!.offset - 25))}
            >
              Previous comparisons
            </Button>
            <Button
              style={button}
              disabled={locked || state.list.nextOffset === null}
              onClick={() => void state.listPage(state.list!.nextOffset!)}
            >
              Next comparisons
            </Button>
          </>
        ) : null}
      </details>
      {manifest ? (
        <>
          <article
            aria-label="Comparison readiness"
            style={{ border: '1px solid #ccc', padding: 10, borderRadius: 6, minWidth: 0 }}
          >
            <h4>Frozen comparison revision {manifest.comparisonRevision}</h4>
            <p>
              These base flags and readiness describe publication time. Later reviewed decisions are
              listed separately; they do not rewrite the saved geometry observations.
            </p>
            <p>
              {context?.current?.comparisonId === manifest.id
                ? 'This pair has the current project comparison token.'
                : 'This is a historical comparison; it is not current calculation authority.'}{' '}
              Current project comparison revision: {context?.comparisonRevision ?? 'Unavailable'}.
            </p>
            <p>
              {manifest.counts.sourceObjects} old objects · {manifest.counts.targetObjects} new
              objects · {manifest.counts.unresolved} unresolved
            </p>
            <dl>
              {Object.entries(manifest.readiness)
                .filter(([key]) => key !== 'reasonCodes')
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{words(key)}</dt>
                    <dd style={{ margin: '0 0 8px' }}>{words(value as string)}</dd>
                  </div>
                ))}
            </dl>
            <p>{manifest.readiness.reasonCodes.map(words).join('; ')}</p>
            <p>
              Comparison is not engineering acceptance. Each proposal still requires review and
              fresh Apply checks.
            </p>
          </article>
          <Field label="Filter this page">
            <select
              aria-label="Revision change filter"
              value={filter}
              disabled={locked}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="">All changes on this page</option>
              {flags.map((flag) => (
                <option key={flag} value={flag}>
                  {words(flag)}
                </option>
              ))}
            </select>
          </Field>
          <p>
            Flags are independent. An observed fitted-length difference is not by itself a proved
            physical length change. Unavailable frame or identity evidence remains unresolved.
          </p>
          <div aria-label="Saved revision change rows" style={{ display: 'grid', gap: 10 }}>
            {state.page?.changes
              .filter(
                (change) =>
                  !filter || change.flags.includes(filter as (typeof change.flags)[number]),
              )
              .map((change) => (
                <article
                  key={change.rowIndex}
                  aria-label={`Revision change ${change.rowIndex + 1}`}
                  style={{
                    border: '1px solid #ccc',
                    padding: 10,
                    borderRadius: 6,
                    minWidth: 0,
                    wordBreak: 'normal',
                  }}
                >
                  <h4>Change {change.rowIndex + 1}</h4>
                  <ul aria-label="Change flags">
                    {change.flags.map((flag) => (
                      <li key={flag}>{words(flag)}</li>
                    ))}
                  </ul>
                  <dl>
                    <dt>Old object revisions</dt>
                    <dd style={{ margin: '0 0 8px' }}>
                      {change.sourceObjectRevisionIds.join(', ') || 'None in this requested scope'}
                    </dd>
                    <dt>New object revisions</dt>
                    <dd style={{ margin: '0 0 8px' }}>
                      {change.targetObjectRevisionIds.join(', ') || 'No confirmed correspondence'}
                    </dd>
                    <dt>Correspondence basis</dt>
                    <dd style={{ margin: '0 0 8px' }}>
                      {words(change.relation.basis)} · {words(change.relation.disposition)}
                    </dd>
                    <dt>Observed fitted lengths (m)</dt>
                    <dd style={{ margin: '0 0 8px' }}>
                      {change.measurements.sourceFittedLengthMetres ?? 'Unavailable'} →{' '}
                      {change.measurements.targetFittedLengthMetres ?? 'Unavailable'}
                    </dd>
                    <dt>Observed fitted-length delta (m)</dt>
                    <dd style={{ margin: '0 0 8px' }}>
                      {change.measurements.fittedLengthDeltaMetres ?? 'Unavailable'}
                    </dd>
                    <dt>Declared length audit (mm)</dt>
                    <dd style={{ margin: '0 0 8px' }}>
                      {change.measurements.sourceDeclaredLengthMm ?? 'Unavailable'} →{' '}
                      {change.measurements.targetDeclaredLengthMm ?? 'Unavailable'}
                    </dd>
                    <dt>Physical displacement (m)</dt>
                    <dd style={{ margin: '0 0 8px' }}>
                      {change.measurements.displacementMetres ??
                        'Unavailable; comparable frame evidence is missing'}
                    </dd>
                  </dl>
                  <p>{change.reasonCodes.map(words).join('; ')}</p>
                  <p>
                    {change.candidates.length} candidate objects. Candidates do not establish
                    identity or automatic endpoint carry.
                  </p>
                  <details>
                    <summary>Evidence references</summary>
                    {change.evidenceReferences.map((reference) => (
                      <p key={`${reference.kind}:${reference.id}`}>
                        {words(reference.kind)} · {reference.id}
                        <br />
                        SHA-256 {reference.sha256}
                      </p>
                    ))}
                  </details>
                  <details>
                    <summary>Inspect saved old and new geometry</summary>
                    {change.sourceObjectRevisionIds.map((id) => (
                      <Button
                        key={id}
                        style={button}
                        disabled={locked}
                        onClick={() => void state.inspectObject('source', id)}
                      >
                        Inspect old object {id}
                      </Button>
                    ))}
                    {[
                      ...new Set([
                        ...change.targetObjectRevisionIds,
                        ...change.candidates.map((candidate) => candidate.objectRevisionId),
                      ]),
                    ].map((id) => (
                      <Button
                        key={id}
                        style={button}
                        disabled={locked}
                        onClick={() => void state.inspectObject('target', id)}
                      >
                        Inspect new object {id}
                      </Button>
                    ))}
                    <p>
                      Inspection reads historical server records. It does not highlight old object
                      numbers in the current viewer.
                    </p>
                  </details>
                  <Button
                    style={button}
                    disabled={locked}
                    onClick={() => setSelectedRow(change.rowIndex)}
                  >
                    Review change {change.rowIndex + 1}
                  </Button>
                </article>
              ))}
          </div>
          {state.page ? (
            <>
              <p>
                Showing {state.page.offset + (state.page.changes.length ? 1 : 0)}–
                {state.page.offset + state.page.changes.length} of {state.page.total} change rows.
              </p>
              <Button
                style={button}
                disabled={locked || state.page.offset === 0}
                onClick={() =>
                  void state.changesPage(Math.max(0, state.page!.offset - state.page!.limit))
                }
              >
                Previous changes
              </Button>
              <Button
                style={button}
                disabled={locked || state.page.nextOffset === null}
                onClick={() => void state.changesPage(state.page!.nextOffset!)}
              >
                Next changes
              </Button>
            </>
          ) : null}
          {state.objectDetail ? (
            <article
              aria-label="Saved comparison object geometry"
              style={{
                border: '1px solid #ccc',
                padding: 10,
                minWidth: 0,
                overflowWrap: 'anywhere',
              }}
            >
              <h4>{state.objectDetail.side === 'source' ? 'Old' : 'New'} saved object</h4>
              <p>
                {state.objectDetail.record.historicalModel.name}
                <br />
                {state.objectDetail.record.id}
              </p>
              <dl>
                <dt>Bounds minimum (m)</dt>
                <dd style={{ margin: '0 0 8px' }}>
                  {state.objectDetail.record.geometry.bounds.minimum.join(', ')}
                </dd>
                <dt>Bounds maximum (m)</dt>
                <dd style={{ margin: '0 0 8px' }}>
                  {state.objectDetail.record.geometry.bounds.maximum.join(', ')}
                </dd>
                <dt>Approximate equipment anchor (m)</dt>
                <dd style={{ margin: '0 0 8px' }}>
                  {state.objectDetail.record.geometry.equipmentAnchor?.pointMetres.join(', ') ??
                    'Unavailable'}
                </dd>
                <dt>Mesh SHA-256</dt>
                <dd style={{ margin: '0 0 8px' }}>
                  {state.objectDetail.record.geometry.mesh.sha256}
                </dd>
                <dt>Fitted length (m)</dt>
                <dd style={{ margin: '0 0 8px' }}>
                  {state.objectDetail.record.geometry.fitted?.geometricLengthRoundTrip ??
                    'Unavailable'}
                </dd>
              </dl>
              {state.objectDetail.record.geometry.fitted ? (
                <details>
                  <summary>Retained fitted geometry</summary>
                  <p>
                    First{' '}
                    {Math.min(5, state.objectDetail.record.geometry.fitted.pointsMetres.length)} of{' '}
                    {state.objectDetail.record.geometry.fitted.pointsMetres.length} retained axis
                    points (m).
                  </p>
                  {state.objectDetail.record.geometry.fitted.pointsMetres
                    .slice(0, 5)
                    .map((point, index) => (
                      <p key={index}>{point.join(', ')}</p>
                    ))}
                  <p>
                    {state.objectDetail.record.geometry.fitted.ports.length} retained ports. Port
                    observations do not establish the complete calculation connectivity graph.
                  </p>
                  {state.objectDetail.record.geometry.fitted.ports.map((port, index) => (
                    <pre key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {JSON.stringify(port)}
                    </pre>
                  ))}
                </details>
              ) : null}
              <p>
                Source identity, object-local basis and common-frame qualification remain as
                recorded; inspection grants no new qualification.
              </p>
            </article>
          ) : null}
          {context ? (
            <RevisionMappingReview
              manifest={manifest}
              change={selected}
              capabilities={context.capabilities}
              head={state.head}
              headQueryKey={state.headQueryKey}
              disabled={locked}
              onLoadHead={state.loadHead}
              onSave={(command) => state.decide(manifest.id, command)}
            />
          ) : null}
          <details>
            <summary>Reviewed decision history</summary>
            {state.history?.decisions.map((decision) => (
              <article
                key={decision.id}
                style={{ border: '1px solid #ccc', padding: 8, marginTop: 8, minWidth: 0 }}
              >
                <p>
                  {words(decision.kind)} · comparison revision {decision.comparisonRevision}
                  <br />
                  {decision.createdAt} · {decision.createdBy}
                </p>
                <p style={{ whiteSpace: 'pre-wrap' }}>{decision.reason}</p>
                <p>{words(decision.qualification)}</p>
              </article>
            ))}
            <Button style={button} disabled={locked} onClick={() => void state.historyPage(null)}>
              Latest decisions
            </Button>
            <Button
              style={button}
              disabled={locked || !state.history?.nextBeforeRevision}
              onClick={() => void state.historyPage(state.history!.nextBeforeRevision)}
            >
              Older decisions
            </Button>
          </details>
        </>
      ) : null}
    </section>
  );
}
