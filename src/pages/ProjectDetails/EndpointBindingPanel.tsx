import { generateId } from '@/utils/generateId';
import { useEffect, useRef, useState } from 'react';
import {
  Body1,
  Button,
  Caption1,
  Field,
  Input,
  Spinner,
  Textarea,
} from '@fluentui/react-components';
import { isCanonicalPoint, type PickedPoint } from '../../../viewer-runtime/protocol.mjs';
import { useEndpointBinding } from './hooks/useEndpointBinding';
import type {
  EndpointBindingWrite,
  EndpointBindingReceipt,
} from '@/api/pathfinderEndpointBindings';
import { EndpointBindingHistory } from './EndpointBindingHistory';

export type EndpointBindingPanelProps = {
  projectId: string | null;
  loadedProjectId: string | null;
  token: string | null;
  isAdmin: boolean;
  locationId: string | null;
  initialName?: string;
  contextKey: string;
  pickPoint: () => Promise<PickedPoint | null>;
  cancelPicking: () => void;
  onSaved?: (receipt: EndpointBindingReceipt) => void | Promise<void>;
  onAuthorityLost?: () => void;
  onRecoveryPendingChange?: (pending: boolean) => void;
};
type ObjectRef = { traceId: string; objectRevisionId: string; recordSha256: string };
type Draft = {
  name: string;
  aliases: string;
  coordinates: [string, string, string];
  mode: 'fixed-world' | 'object-derived' | 'object-attached';
  derivation: 'manual-world-point' | 'picked-surface-point';
  object: ObjectRef | null;
  objectName: string | null;
  reason: string;
};
const fresh = (name = ''): Draft => ({
  name,
  aliases: '',
  coordinates: ['', '', ''],
  mode: 'fixed-world',
  derivation: 'manual-world-point',
  object: null,
  objectName: null,
  reason: '',
});
const modes = [
  { value: 'fixed-world', label: 'Fixed world coordinates' },
  { value: 'object-attached', label: 'Follow model object' },
  { value: 'object-derived', label: 'Object-derived anchor' },
] as const;
const button = {
  maxWidth: '100%',
  whiteSpace: 'normal' as const,
  textAlign: 'left' as const,
  overflowWrap: 'anywhere' as const,
};
export function EndpointBindingPanel(props: EndpointBindingPanelProps) {
  return props.isAdmin ? <AdminEndpointBindingPanel {...props} /> : null;
}
function AdminEndpointBindingPanel(props: EndpointBindingPanelProps) {
  const [newId, setNewId] = useState(() => generateId());
  const locationId = props.locationId ?? newId;
  const binding = useEndpointBinding({ ...props, locationId });
  const [draft, setDraft] = useState<Draft>(() => fresh(props.initialName));
  const [picking, setPicking] = useState(false),
    [pickError, setPickError] = useState<string | null>(null);
  const generation = useRef(0),
    dirty = useRef(false),
    seeded = useRef<string | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;
  useEffect(() => {
    latestProps.current.onRecoveryPendingChange?.(
      Boolean(binding.recoveryPending || binding.unknown),
    );
  }, [binding.recoveryPending, binding.unknown]);
  useEffect(
    () => () => {
      latestProps.current.onRecoveryPendingChange?.(false);
    },
    [],
  );
  const identity = JSON.stringify([
    props.projectId,
    props.loadedProjectId,
    props.token,
    props.isAdmin,
    props.locationId,
    props.initialName,
    props.contextKey,
  ]);
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  useEffect(() => {
    generation.current++;
    dirty.current = false;
    seeded.current = null;
    setDraft(fresh(props.initialName));
    setPicking(false);
    setPickError(null);
    return () => {
      generation.current++;
      latestProps.current.cancelPicking();
    };
  }, [identity, props.initialName]);
  useEffect(() => {
    if (!props.locationId) setNewId(generateId());
  }, [props.projectId, props.loadedProjectId, props.token, props.locationId]);
  const context = binding.context;
  useEffect(() => {
    if (!context || dirty.current) return;
    const seed = `${context.locationId}:${context.registryRevision}`;
    if (seeded.current === seed) return;
    seeded.current = seed;
    const point = context.head?.pointProjectMetres ?? context.legacy?.pointProjectMetres;
    setDraft({
      ...fresh(context.location?.name ?? props.initialName),
      aliases: context.location?.aliases.join('\n') ?? '',
      mode: context.head?.mode ?? 'fixed-world',
      object: context.head?.sourceObject ?? null,
      objectName: context.head?.sourceObject?.objectRevisionId ?? null,
      coordinates: point ? (point.map(String) as Draft['coordinates']) : ['', '', ''],
    });
  }, [context, props.initialName]);
  const locked =
    binding.busy || binding.unknown || binding.conflict || picking || !context?.current;
  const change = (patch: Partial<Draft>) => {
    if (locked) return;
    dirty.current = true;
    setDraft((previous) => ({ ...previous, ...patch }));
  };
  const pick = async () => {
    if (locked) return;
    const current = ++generation.current,
      pickedIdentity = identity;
    setPicking(true);
    setPickError(null);
    try {
      const result = await props.pickPoint();
      if (current !== generation.current || latestIdentity.current !== pickedIdentity || !result)
        return;
      dirty.current = true;
      const candidate = binding.objects?.objects.find(
        (object) => object.objectId === `dbid:${result.objectId}`,
      );
      setDraft((previous) => ({
        ...previous,
        mode: 'fixed-world',
        coordinates: result.point.map(String) as Draft['coordinates'],
        derivation: 'picked-surface-point',
        object:
          candidate && context?.current?.traceId
            ? {
                traceId: context.current.traceId,
                objectRevisionId: candidate.id,
                recordSha256: candidate.recordSha256,
              }
            : null,
        objectName: `dbid:${result.objectId}`,
      }));
    } catch (error) {
      if (current === generation.current)
        setPickError(error instanceof Error ? error.message : 'The point could not be selected.');
    } finally {
      if (current === generation.current) setPicking(false);
    }
  };
  const point = draft.coordinates.map((value) => (value.trim() ? Number(value) : NaN));
  const capability = context?.capabilities.find((value) => value.mode === draft.mode);
  const canSave =
    !locked &&
    Boolean(
      draft.name.trim() &&
        draft.reason.trim() &&
        capability?.supported &&
        draft.mode !== 'object-attached' &&
        (draft.mode === 'fixed-world'
          ? isCanonicalPoint(point) && point.every((value) => Math.abs(value) <= 1e9)
          : draft.object),
    );
  const save = async () => {
    const current = context?.current;
    if (!canSave || !context || !current) return;
    const common = {
      schemaVersion: 'wfc.pf.endpoint-binding-write.v1',
      expectedRegistryRevision: context.registryRevision,
      expectedLocationRevision: context.location?.revision ?? null,
      expectedHeadId: context.head?.id ?? null,
      expectedSelectionRevision: current.selectionRevision,
      modelVersionId: current.modelVersionId,
      aggregateId: current.aggregateId,
      projectionSha256: current.projectionSha256,
      captureFrameId: current.captureFrameId,
      idempotencyKey: generateId(),
      reason: draft.reason.trim(),
      location: {
        name: draft.name.normalize('NFC').trim(),
        aliases: [
          ...new Set(
            draft.aliases
              .split(/\r?\n/)
              .map((alias) => alias.normalize('NFC').trim())
              .filter(Boolean),
          ),
        ],
      },
    };
    const command =
      draft.mode === 'object-derived'
        ? {
            ...common,
            mode: 'object-derived',
            object: draft.object!,
            anchorRule: 'equipment-bottom-aabb.v1',
          }
        : {
            ...common,
            mode: 'fixed-world',
            pointProjectMetres: point,
            derivation: draft.derivation,
            provenanceObject: draft.object,
          };
    await binding.save(command as EndpointBindingWrite);
  };
  const evaluateMigration = () => {
    const current = context?.current,
      head = context?.head;
    if (locked || !context?.location || !current || !head || !draft.reason.trim()) return;
    void binding.evaluateMigration({
      schemaVersion: 'wfc.pf.endpoint-migration-write.v1',
      sourceBindingId: head.id,
      expectedRegistryRevision: context.registryRevision,
      expectedLocationRevision: context.location.revision,
      expectedHeadId: head.id,
      expectedSelectionRevision: current.selectionRevision,
      targetModelVersionId: current.modelVersionId,
      targetAggregateId: current.aggregateId,
      targetProjectionSha256: current.projectionSha256,
      targetCaptureFrameId: current.captureFrameId,
      objectDecisionId: null,
      frameDecisionId: null,
      idempotencyKey: generateId(),
      reason: draft.reason.trim(),
    });
  };
  const decision = binding.migration;
  const canConfirmMigration =
    !locked &&
    Boolean(
      decision?.evaluation.proposal &&
        decision.evaluation.targetPointProjectMetres &&
        ['carried-fixed', 'carried-rigid', 'rederived'].includes(decision.evaluation.disposition) &&
        decision.expectedRegistryRevision === context?.registryRevision &&
        decision.expectedLocationRevision === context?.location?.revision &&
        decision.sourceHeadId === context?.head?.id &&
        decision.target.aggregateId === context?.current?.aggregateId &&
        draft.reason.trim(),
    );
  const confirmMigration = () => {
    if (!decision || !canConfirmMigration) return;
    void binding.confirmMigration(decision.id, {
      schemaVersion: 'wfc.pf.endpoint-migration-confirm.v1',
      expectedDecisionSha256: decision.contentSha256,
      expectedRegistryRevision: decision.expectedRegistryRevision,
      expectedLocationRevision: decision.expectedLocationRevision,
      expectedHeadId: decision.sourceHeadId,
      expectedSelectionRevision: decision.target.selectionRevision,
      idempotencyKey: generateId(),
      reason: draft.reason.trim(),
    });
  };
  return (
    <section
      aria-label="Shared endpoint binding"
      style={{
        display: 'grid',
        gap: 10,
        minWidth: 0,
        overflowWrap: 'anywhere',
        wordBreak: 'normal',
      }}
    >
      <h3 style={{ margin: 0 }}>Shared endpoint</h3>
      <Body1>
        One saved location and its aliases are reused at From or To across all project cables.
      </Body1>
      {context ? (
        <p>
          Used by {context.usage.distinctCables} cables: {context.usage.fromOccurrences} From and{' '}
          {context.usage.toOccurrences} To occurrences.
        </p>
      ) : null}
      {binding.busy ? <Spinner size="tiny" label="Reading or saving shared endpoint" /> : null}
      {binding.error ? <p role="alert">{binding.error}</p> : null}
      {pickError ? <p role="alert">{pickError}</p> : null}
      {binding.unknown ? (
        <Button style={button} disabled={binding.busy} onClick={() => void binding.retry()}>
          Reconcile same save
        </Button>
      ) : null}
      {binding.conflict ? (
        <Button
          style={button}
          disabled={binding.busy}
          onClick={() => {
            dirty.current = false;
            seeded.current = null;
            void binding.discardRefresh();
          }}
        >
          Discard changes and refresh
        </Button>
      ) : null}
      {!context?.current && !binding.busy ? (
        <p>A current prepared network is required before confirming a point.</p>
      ) : null}
      {context?.legacy && !context.head ? (
        <p>This historical point needs explicit confirmation in the current capture frame.</p>
      ) : null}
      {context?.head ? (
        <p>
          Current saved mode: {modes.find((mode) => mode.value === context.head?.mode)?.label}.
          Readiness: {context.readiness.status}.
        </p>
      ) : null}
      <Field label="Location name">
        <Input
          aria-label="Location name"
          disabled={locked}
          value={draft.name}
          onChange={(_, data) => change({ name: data.value })}
        />
      </Field>
      <Field label="Aliases" hint="One alias per line. Every alias uses this same binding.">
        <Textarea
          aria-label="Location aliases"
          disabled={locked}
          value={draft.aliases}
          onChange={(_, data) => change({ aliases: data.value })}
        />
      </Field>
      <fieldset disabled={locked} style={{ minWidth: 0, margin: 0 }}>
        <legend>Point behavior</legend>
        {modes.map((mode) => {
          const supported = context?.capabilities.find((value) => value.mode === mode.value);
          return (
            <div key={mode.value} style={{ marginBottom: 8 }}>
              <label>
                <input
                  type="radio"
                  name={`endpoint-mode-${locationId}`}
                  checked={draft.mode === mode.value}
                  disabled={!supported?.supported || mode.value === 'object-attached'}
                  onChange={() =>
                    change({
                      mode: mode.value,
                      ...(mode.value === 'object-derived'
                        ? { object: null, objectName: null }
                        : {}),
                    })
                  }
                />{' '}
                {mode.label}
              </label>
              {!supported?.supported || mode.value === 'object-attached' ? (
                <p style={{ margin: '4px 0' }}>
                  {mode.value === 'object-attached'
                    ? 'A verified object-local frame and durable attachment evidence are required. This capture does not provide them.'
                    : 'This mode is currently unavailable.'}{' '}
                  {supported?.reasonCodes
                    .map((reason) => reason.toLowerCase().replaceAll('_', ' '))
                    .join('; ')}
                </p>
              ) : null}
            </div>
          );
        })}
      </fieldset>
      {draft.mode === 'fixed-world' ? (
        <>
          <p>
            Confirm this point in the current capture frame. Cross-revision frame alignment is not
            established.
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {(['X', 'Y', 'Z'] as const).map((axis, index) => (
              <Field key={axis} label={`${axis} (m)`}>
                <Input
                  aria-label={`Endpoint ${axis} in metres`}
                  disabled={locked}
                  value={draft.coordinates[index]}
                  onChange={(_, data) =>
                    change({
                      coordinates: draft.coordinates.map((value, at) =>
                        at === index ? data.value : value,
                      ) as Draft['coordinates'],
                      derivation: 'manual-world-point',
                      object: null,
                      objectName: null,
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <Button style={button} disabled={locked} onClick={() => void pick()}>
            Pick surface point in 3D
          </Button>
          <Caption1>
            {draft.derivation === 'picked-surface-point'
              ? 'Picked surface point'
              : 'Manual world point'}
            {draft.objectName ? ` · ${draft.objectName} (provenance only)` : ''}
          </Caption1>
        </>
      ) : (
        <p>
          The server calculates the equipment bounding-box bottom centre from the exact saved
          object. This approximate anchor is not a verified physical terminal.
        </p>
      )}
      {picking ? (
        <>
          <p>Click a surface in the model. Dragging continues to navigate.</p>
          <Button
            style={button}
            onClick={() => {
              generation.current++;
              props.cancelPicking();
              setPicking(false);
            }}
          >
            Cancel point picking
          </Button>
        </>
      ) : null}
      {context?.current?.traceId ? (
        <details>
          <summary>Saved model objects</summary>
          <Button style={button} disabled={locked} onClick={() => void binding.loadObjects()}>
            Load saved objects
          </Button>
          {binding.objects?.objects.map((object) => (
            <article
              key={object.id}
              style={{
                border: '1px solid #ccc',
                borderRadius: 6,
                padding: 8,
                marginTop: 8,
                minWidth: 0,
              }}
            >
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {object.name}
                <br />
                {object.objectId}
              </p>
              <Button
                style={button}
                disabled={
                  locked ||
                  object.geometryRole === 'hierarchy' ||
                  (draft.mode === 'object-derived' && object.geometryRole !== 'object')
                }
                onClick={() =>
                  change({
                    object: {
                      traceId: binding.objects!.traceId,
                      objectRevisionId: object.id,
                      recordSha256: object.recordSha256,
                    },
                    objectName: object.name,
                  })
                }
              >
                Choose object {object.objectId}
              </Button>
            </article>
          ))}
          {binding.objects ? (
            <>
              <Button
                style={button}
                disabled={locked || binding.objects.offset === 0}
                onClick={() =>
                  void binding.loadObjects(
                    Math.max(0, binding.objects!.offset - binding.objects!.limit),
                  )
                }
              >
                Previous objects
              </Button>
              <Button
                style={button}
                disabled={locked || binding.objects.nextOffset === null}
                onClick={() => void binding.loadObjects(binding.objects!.nextOffset!)}
              >
                Next objects
              </Button>
            </>
          ) : null}
          {draft.objectName ? <p>Selected object: {draft.objectName}</p> : null}
        </details>
      ) : null}
      <Field label="Reason for confirmation">
        <Textarea
          aria-label="Reason for confirmation"
          disabled={locked}
          value={draft.reason}
          onChange={(_, data) => change({ reason: data.value })}
        />
      </Field>
      <Button style={button} appearance="primary" disabled={!canSave} onClick={() => void save()}>
        Confirm shared endpoint
      </Button>
      <Button
        style={button}
        disabled={binding.busy || binding.unknown || picking}
        onClick={() => {
          dirty.current = false;
          seeded.current = null;
          void binding.discardRefresh();
        }}
      >
        Discard draft and refresh
      </Button>
      {context?.head &&
      context.current &&
      context.head.aggregateId !== context.current.aggregateId ? (
        <details>
          <summary>Review carry to the current model</summary>
          <p>
            The old point remains history. Carrying it requires reviewed frame and identity
            evidence; names and reused object numbers do not establish a match.
          </p>
          <Button
            style={button}
            disabled={locked || !draft.reason.trim()}
            onClick={evaluateMigration}
          >
            Evaluate carry with available evidence
          </Button>
        </details>
      ) : null}
      {decision ? (
        <article
          aria-label="Endpoint migration review"
          style={{
            border: '1px solid #ccc',
            padding: 10,
            borderRadius: 6,
            minWidth: 0,
            overflowWrap: 'anywhere',
          }}
        >
          <h4>Carry review</h4>
          <p>{decision.evaluation.disposition.replaceAll('-', ' ')}</p>
          <dl>
            <dt>Old point (m)</dt>
            <dd style={{ margin: '0 0 8px' }}>
              {decision.evaluation.sourcePointProjectMetres.join(', ')}
            </dd>
            <dt>Old point in the target frame (m)</dt>
            <dd style={{ margin: '0 0 8px' }}>
              {decision.evaluation.sourcePointInTargetFrameMetres?.join(', ') ??
                'Unavailable; comparable coordinate-frame evidence is missing.'}
            </dd>
            <dt>Proposed point (m)</dt>
            <dd style={{ margin: '0 0 8px' }}>
              {decision.evaluation.targetPointProjectMetres?.join(', ') ??
                'Unavailable; the old binding has not been moved.'}
            </dd>
            <dt>Displacement (m)</dt>
            <dd style={{ margin: '0 0 8px' }}>
              {decision.evaluation.displacementMetres ?? 'Unavailable'}
            </dd>
          </dl>
          <p>
            {decision.evaluation.reasonCodes
              .map((reason) => reason.toLowerCase().replaceAll('_', ' '))
              .join('; ')}
          </p>
          <Button style={button} disabled={!canConfirmMigration} onClick={confirmMigration}>
            Confirm reviewed carry
          </Button>
        </article>
      ) : null}
      <EndpointBindingHistory
        history={binding.history}
        busy={binding.busy || binding.unknown || picking}
        onPage={binding.historyPage}
      />
    </section>
  );
}
