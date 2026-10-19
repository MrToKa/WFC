import { useEffect, useState } from 'react';
import { Button, Field, Input, Textarea } from '@fluentui/react-components';
import {
  revisionComparisonDecisionWriteSchema,
  type RevisionComparisonChange,
  type RevisionComparisonManifest,
  type RevisionComparisonContext,
} from '../../../shared/pathfinderRevisionComparison';
import type {
  RevisionComparisonDecisionHead,
  RevisionComparisonDecisionWrite,
  RevisionDecisionHeadQuery,
} from '@/api/pathfinderRevisionChanges';

type Props = {
  manifest: RevisionComparisonManifest;
  change: RevisionComparisonChange | null;
  capabilities: RevisionComparisonContext['capabilities'];
  head: RevisionComparisonDecisionHead | null;
  headQueryKey: string | null;
  disabled: boolean;
  onLoadHead: (query: RevisionDecisionHeadQuery) => void | Promise<void>;
  onSave: (command: RevisionComparisonDecisionWrite) => void | Promise<void>;
};
const button = { maxWidth: '100%', whiteSpace: 'normal' as const, textAlign: 'left' as const };
const identifiers = (value: string) => value.split(/[\s,]+/u).filter(Boolean);
export function RevisionMappingReview({
  manifest,
  change,
  capabilities,
  head,
  headQueryKey,
  disabled,
  onLoadHead,
  onSave,
}: Props) {
  const [kind, setKind] = useState<
    'object-mapping' | 'frame-mapping' | 'binding-frame-qualification'
  >('object-mapping');
  const [sources, setSources] = useState(''),
    [targets, setTargets] = useState(''),
    [disposition, setDisposition] = useState('');
  const [matrix, setMatrix] = useState(''),
    [projectFrame, setProjectFrame] = useState(''),
    [numericalTolerance, setNumericalTolerance] = useState(''),
    [engineeringTolerance, setEngineeringTolerance] = useState('');
  const [bindingId, setBindingId] = useState(''),
    [bindingSha, setBindingSha] = useState(''),
    [frameDecisionId, setFrameDecisionId] = useState('');
  const [evidence, setEvidence] = useState(''),
    [reason, setReason] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [loadedDraft, setLoadedDraft] = useState<string | null>(null);
  const selectionKey = JSON.stringify([manifest.id, change?.rowIndex]);
  useEffect(() => {
    setSources(change?.sourceObjectRevisionIds.join('\n') ?? '');
    setTargets('');
    setDisposition('');
    setEvidence('');
    setReason('');
    setReviewed(false);
    setLoadedDraft(null);
    setMatrix('');
    setProjectFrame('');
    setNumericalTolerance('');
    setEngineeringTolerance('');
    setBindingId('');
    setBindingSha('');
    setFrameDecisionId('');
  }, [selectionKey]);
  const query: RevisionDecisionHeadQuery =
    kind === 'object-mapping'
      ? { kind, sourceObjectRevisionIds: identifiers(sources) }
      : kind === 'frame-mapping'
        ? { kind }
        : { kind, sourceBindingId: bindingId.trim() };
  const body =
    kind === 'object-mapping'
      ? {
          sourceObjectRevisionIds: identifiers(sources),
          targetObjectRevisionIds: identifiers(targets),
          disposition,
          evidenceText: evidence.trim(),
        }
      : kind === 'frame-mapping'
        ? {
            sourceCaptureFrameId: manifest.source.captureFrameId,
            targetCaptureFrameId: manifest.target.captureFrameId,
            qualifiedProjectFrameId: projectFrame.trim(),
            sourceCaptureToTargetCaptureMetres: matrix.trim()
              ? matrix
                  .trim()
                  .split(/[\s,]+/u)
                  .map(Number)
              : [],
            numericalTolerance: numericalTolerance.trim() ? Number(numericalTolerance) : NaN,
            engineeringToleranceMetres: engineeringTolerance.trim()
              ? Number(engineeringTolerance)
              : null,
            evidenceText: evidence.trim(),
          }
        : {
            sourceBindingId: bindingId.trim(),
            sourceBindingSha256: bindingSha.trim(),
            sourceCaptureFrameId: manifest.source.captureFrameId,
            frameDecisionId: frameDecisionId.trim(),
            qualifiedProjectFrameId: projectFrame.trim(),
            evidenceText: evidence.trim(),
          };
  const draftKey = JSON.stringify([kind, body, reason]);
  const command = {
    schemaVersion: 'wfc.pf.revision-comparison-decision-write.v1' as const,
    kind,
    body,
    expectedComparisonRevision: head?.comparisonRevision ?? manifest.comparisonRevision,
    expectedHeadId: head?.head?.id ?? null,
    idempotencyKey: '11111111-1111-1111-1111-111111111111',
    reason: reason.trim(),
  };
  const supported =
    kind === 'object-mapping'
      ? capabilities.reviewedObjectMapping
      : kind === 'frame-mapping'
        ? capabilities.reviewedFrameMapping
        : capabilities.bindingFrameQualification;
  const valid = revisionComparisonDecisionWriteSchema.safeParse(command).success;
  const canSave =
    !disabled &&
    supported &&
    reviewed &&
    valid &&
    Boolean(
      head &&
        head.comparisonId === manifest.id &&
        headQueryKey === JSON.stringify(query) &&
        loadedDraft === draftKey,
    );
  const edit = (action: () => void) => {
    action();
    setReviewed(false);
    setLoadedDraft(null);
  };
  const save = () => {
    if (!canSave) return;
    const parsed = revisionComparisonDecisionWriteSchema.parse({
      ...command,
      idempotencyKey: crypto.randomUUID(),
    });
    void onSave(parsed);
  };
  return (
    <section
      aria-label="Explicit revision mapping review"
      style={{ display: 'grid', gap: 8, minWidth: 0, overflowWrap: 'anywhere' }}
    >
      <h4>Review revision evidence</h4>
      <p>
        A manual correspondence records your reviewed association. It does not establish an
        object-local frame, prove native identity or enable Follow model object.
      </p>
      <Field label="Review type">
        <select
          aria-label="Revision review type"
          disabled={disabled}
          value={kind}
          onChange={(event) => edit(() => setKind(event.target.value as typeof kind))}
        >
          <option value="object-mapping">Object correspondence</option>
          <option value="frame-mapping">Coordinate-frame mapping</option>
          <option value="binding-frame-qualification">Binding frame qualification</option>
        </select>
      </Field>
      {!supported ? (
        <p>This review type is unavailable under the current server capabilities.</p>
      ) : null}
      {kind === 'object-mapping' ? (
        <>
          <Field
            label="Old object revision IDs"
            hint="One exact saved revision ID per line. Multiple old objects must be reviewed explicitly."
          >
            <Textarea
              aria-label="Old object revision IDs"
              disabled={disabled}
              value={sources}
              onChange={(_, data) => edit(() => setSources(data.value))}
            />
          </Field>
          <Field label="New object revision IDs">
            <Textarea
              aria-label="New object revision IDs"
              disabled={disabled}
              value={targets}
              onChange={(_, data) => edit(() => setTargets(data.value))}
            />
          </Field>
          {change?.candidates.map((candidate) => (
            <label key={candidate.objectRevisionId}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={identifiers(targets).includes(candidate.objectRevisionId)}
                onChange={(event) =>
                  edit(() =>
                    setTargets(
                      (event.target.checked
                        ? [...identifiers(targets), candidate.objectRevisionId]
                        : identifiers(targets).filter((id) => id !== candidate.objectRevisionId)
                      ).join('\n'),
                    ),
                  )
                }
              />{' '}
              Candidate {candidate.objectRevisionId}
              <br />
              {candidate.reasonCodes
                .map((code) => code.toLowerCase().replaceAll('_', ' '))
                .join('; ')}
            </label>
          ))}
          <Field label="Reviewed relationship">
            <select
              aria-label="Reviewed relationship"
              value={disposition}
              disabled={disabled}
              onChange={(event) => edit(() => setDisposition(event.target.value))}
            >
              <option value="">Choose a relationship</option>
              {[
                'unique',
                'missing',
                'ambiguous',
                'split',
                'merged',
                'replaced',
                'deformed',
                'connector-missing',
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll('-', ' ')}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : kind === 'frame-mapping' ? (
        <>
          <p>
            Enter a reviewed source-to-target rigid transform in metres. No identity transform or
            tolerance is supplied automatically. This is an explicit human frame decision.
          </p>
          <Field label="Reviewed transform: 16 column-major numbers">
            <Textarea
              aria-label="Reviewed source to target matrix"
              disabled={disabled}
              value={matrix}
              onChange={(_, data) => edit(() => setMatrix(data.value))}
            />
          </Field>
          <Field label="Numerical validation tolerance">
            <Input
              aria-label="Numerical validation tolerance"
              disabled={disabled}
              value={numericalTolerance}
              onChange={(_, data) => edit(() => setNumericalTolerance(data.value))}
            />
          </Field>
          <Field label="Engineering tolerance in metres (leave empty if unestablished)">
            <Input
              aria-label="Engineering tolerance in metres"
              disabled={disabled}
              value={engineeringTolerance}
              onChange={(_, data) => edit(() => setEngineeringTolerance(data.value))}
            />
          </Field>
        </>
      ) : (
        <>
          <p>
            This qualifies only the exact old binding and capture frame using an existing reviewed
            frame decision. Object-local attachment evidence remains separate.
          </p>
          <Field label="Source binding ID">
            <Input
              aria-label="Source binding ID"
              disabled={disabled}
              value={bindingId}
              onChange={(_, data) => edit(() => setBindingId(data.value))}
            />
          </Field>
          <Field label="Source binding SHA-256">
            <Input
              aria-label="Source binding SHA-256"
              disabled={disabled}
              value={bindingSha}
              onChange={(_, data) => edit(() => setBindingSha(data.value))}
            />
          </Field>
          <Field label="Reviewed frame decision ID">
            <Input
              aria-label="Reviewed frame decision ID"
              disabled={disabled}
              value={frameDecisionId}
              onChange={(_, data) => edit(() => setFrameDecisionId(data.value))}
            />
          </Field>
        </>
      )}
      {kind !== 'object-mapping' ? (
        <Field label="Reviewed common project frame ID">
          <Input
            aria-label="Reviewed common project frame ID"
            disabled={disabled}
            value={projectFrame}
            onChange={(_, data) => edit(() => setProjectFrame(data.value))}
          />
        </Field>
      ) : null}
      <Field label="Evidence reviewed">
        <Textarea
          aria-label="Revision evidence reviewed"
          disabled={disabled}
          value={evidence}
          onChange={(_, data) => edit(() => setEvidence(data.value))}
        />
      </Field>
      <Field label="Decision reason">
        <Textarea
          aria-label="Revision decision reason"
          disabled={disabled}
          value={reason}
          onChange={(_, data) => edit(() => setReason(data.value))}
        />
      </Field>
      <Button
        style={button}
        disabled={disabled || !supported || !valid}
        onClick={() => {
          setLoadedDraft(draftKey);
          setReviewed(false);
          void onLoadHead(query);
        }}
      >
        Load current review state
      </Button>
      {head && headQueryKey === JSON.stringify(query) && loadedDraft === draftKey ? (
        <p>
          {head.head
            ? `Replacing reviewed decision ${head.head.id}`
            : 'No previous decision exists for this exact review subject.'}{' '}
          · Revision {head.comparisonRevision}
        </p>
      ) : null}
      <label>
        <input
          type="checkbox"
          disabled={
            disabled ||
            !supported ||
            !head ||
            loadedDraft !== draftKey ||
            headQueryKey !== JSON.stringify(query)
          }
          checked={reviewed}
          onChange={(event) => setReviewed(event.target.checked)}
        />{' '}
        I reviewed these exact objects or frame evidence and the stated reason.
      </label>
      <Button style={button} disabled={!canSave} onClick={save}>
        Save reviewed decision
      </Button>
    </section>
  );
}
