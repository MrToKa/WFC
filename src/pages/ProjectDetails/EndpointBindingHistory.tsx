import { Button } from '@fluentui/react-components';
import type { EndpointBindingHistory as History } from '@/api/pathfinderEndpointBindings';
type Props = {
  history: History | null;
  busy: boolean;
  onPage: (beforeRevision: string | null) => void | Promise<void>;
};
const label = (mode: string) =>
  mode === 'fixed-world'
    ? 'Fixed world coordinates'
    : mode === 'object-derived'
      ? 'Object-derived anchor (approximate)'
      : 'Follow model object';
export function EndpointBindingHistory({ history, busy, onPage }: Props) {
  return (
    <details>
      <summary>Shared endpoint history</summary>
      {!history?.bindings.length ? (
        <p>No confirmed endpoint history is available.</p>
      ) : (
        history.bindings.map((binding) => (
          <article
            key={binding.id}
            aria-label={`Binding revision ${binding.bindingRevision}`}
            style={{
              border: '1px solid #ccc',
              borderRadius: 6,
              padding: 10,
              marginTop: 8,
              minWidth: 0,
              wordBreak: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            <h4 style={{ margin: '0 0 8px' }}>
              Revision {binding.bindingRevision} · {label(binding.mode)}
            </h4>
            <dl style={{ margin: 0 }}>
              <dt>Status</dt>
              <dd style={{ margin: '0 0 8px' }}>{binding.status}</dd>
              <dt>Point (m)</dt>
              <dd style={{ margin: '0 0 8px' }}>{binding.pointProjectMetres.join(', ')}</dd>
              <dt>Previous point (m)</dt>
              <dd style={{ margin: '0 0 8px' }}>
                {binding.priorPointProjectMetres?.join(', ') ?? 'No previous point'}
              </dd>
              <dt>Displacement (m)</dt>
              <dd style={{ margin: '0 0 8px' }}>
                {binding.displacementBasis === 'unverified-frames'
                  ? 'Unavailable: the previous and current coordinate frames are different or unverified. Physical displacement has not been established.'
                  : binding.displacementBasis === 'none'
                    ? 'Not applicable; there is no previous point.'
                    : binding.displacementMetres === null ||
                        binding.displacementVectorMetres === null
                      ? 'Unavailable; comparable displacement evidence is missing.'
                      : `${binding.displacementMetres}; vector ${binding.displacementVectorMetres.join(', ')}`}
              </dd>
              <dt>Previous capture frame</dt>
              <dd style={{ margin: '0 0 8px' }}>
                {binding.priorCaptureFrameId ??
                  (binding.priorPointProjectMetres
                    ? 'Unknown historical frame'
                    : 'No previous capture frame')}
              </dd>
              {binding.displacementBasis === 'same-capture-frame' ? (
                <>
                  <dt>Displacement basis</dt>
                  <dd style={{ margin: '0 0 8px' }}>
                    Same capture frame; common engineering-frame qualification remains separate.
                  </dd>
                </>
              ) : null}
              <dt>How the point was determined</dt>
              <dd style={{ margin: '0 0 8px' }}>{binding.derivation}</dd>
              <dt>Confirmation</dt>
              <dd style={{ margin: '0 0 8px' }}>
                {binding.confirmedAt ?? 'Not confirmed'}
                <br />
                {binding.confirmedBy ?? 'No confirming administrator'}
              </dd>
              <dt>Reason</dt>
              <dd style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{binding.reason}</dd>
              <dt>Capture frame</dt>
              <dd style={{ margin: '0 0 8px' }}>{binding.captureFrameId}</dd>
              <dt>Common project frame</dt>
              <dd style={{ margin: '0 0 8px' }}>
                {binding.qualifiedProjectFrameId ??
                  'Unverified; this confirmation does not establish cross-revision alignment.'}
              </dd>
            </dl>
            {binding.sourceObject ? (
              <details>
                <summary>Saved object evidence</summary>
                <p>
                  Trace {binding.sourceObject.traceId}
                  <br />
                  Object revision {binding.sourceObject.objectRevisionId}
                  <br />
                  Record SHA-256 {binding.sourceObject.recordSha256}
                </p>
                {binding.mode === 'fixed-world' ? (
                  <p>The object is provenance only. This point does not follow it.</p>
                ) : null}
              </details>
            ) : null}
          </article>
        ))
      )}
      <Button disabled={busy} onClick={() => void onPage(null)}>
        Latest history
      </Button>
      <Button
        disabled={busy || !history?.nextBeforeRevision}
        onClick={() => history?.nextBeforeRevision && void onPage(history.nextBeforeRevision)}
      >
        Older history
      </Button>
    </details>
  );
}
