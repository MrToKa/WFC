import { useState } from 'react';
import { Button, Spinner, Body1 } from '@fluentui/react-components';
import type { usePathFinder } from './hooks/usePathFinder';
import { useGeometryTrace } from './hooks/useGeometryTrace';

type Props = {
  pf: ReturnType<typeof usePathFinder>;
  active: boolean;
  aggregate: { id: string; projection: { sha256: string } } | null;
};
const buttonStyle = {
  maxWidth: '100%',
  whiteSpace: 'normal' as const,
  textAlign: 'left' as const,
  justifyContent: 'flex-start',
  overflowWrap: 'anywhere' as const,
};
export function GeometryTracePanel({ pf, active, aggregate }: Props) {
  const trace = useGeometryTrace(pf, active),
    [diagnosticPage, setDiagnosticPage] = useState(0);
  if (!trace.enabled) return null;
  const disabled = trace.busy || trace.unknown || !active,
    object = trace.object;
  return (
    <section
      aria-label="Geometry traceability"
      style={{ minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'normal' }}
    >
      <h3>Traceability</h3>
      <Body1>
        Inspect immutable captured geometry and its measurement evidence. A capture frame is not a
        verified common engineering frame.
      </Body1>
      <div style={{ display: 'grid', gap: 8, marginTop: 12, minWidth: 0 }}>
        <Button
          style={buttonStyle}
          disabled={disabled || !aggregate}
          onClick={() => {
            if (aggregate) void trace.create(aggregate.id, aggregate.projection.sha256);
          }}
        >
          Create trace for published network
        </Button>
        <Button
          style={buttonStyle}
          disabled={trace.busy || !active}
          onClick={() => void trace.refresh()}
        >
          Refresh traceability
        </Button>
      </div>
      {trace.busy ? (
        <Spinner size="tiny" label="Reading or deriving immutable traceability..." />
      ) : null}
      {trace.error ? <p role="alert">{trace.error}</p> : null}
      {trace.unknown ? (
        <div role="alert">
          <p>
            The exact trace command is retained. New changes are frozen until its outcome is
            reconciled.
          </p>
          <Button style={buttonStyle} disabled={trace.busy} onClick={() => void trace.retry()}>
            Retry the same trace command
          </Button>
        </div>
      ) : null}
      <div aria-label="Saved geometry traces" style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {trace.list?.traces.map((item) => (
          <article
            key={item.id}
            style={{ border: '1px solid #ccc', borderRadius: 6, padding: 10, minWidth: 0 }}
          >
            <p>
              Saved {item.createdAt}
              <br />
              Geometry revision {item.geometryRevision}
              <br />
              {item.modelVersionId === pf.data?.activeModel.modelVersionId
                ? 'Loaded model'
                : 'Historical model'}{' '}
              · {item.counts.objects} objects
            </p>
            <Button
              style={buttonStyle}
              disabled={disabled}
              onClick={() => void trace.open(item.id)}
            >
              Open trace {item.id.slice(0, 8)}
            </Button>
          </article>
        ))}
      </div>
      {trace.list?.nextOffset !== null && trace.list?.nextOffset !== undefined ? (
        <Button
          style={buttonStyle}
          disabled={disabled}
          onClick={() => void trace.refresh(trace.list!.nextOffset!)}
        >
          More saved traces
        </Button>
      ) : null}
      {trace.manifest ? (
        <div aria-label="Saved trace provenance">
          <h4>Saved trace</h4>
          <p>
            Model {trace.manifest.modelVersionId}
            <br />
            Aggregate {trace.manifest.aggregateId}
            <br />
            Trace {trace.manifest.id}
          </p>
          <p>
            Source, placement and intrinsic identity are unqualified until their evidence is
            reviewed. Native parity has not been performed.
          </p>
          {!trace.page ? (
            <Button style={buttonStyle} disabled={disabled} onClick={() => void trace.objects(0)}>
              Load captured objects
            </Button>
          ) : null}
          <details>
            <summary>Full preparation diagnostics</summary>
            <p>
              {trace.manifest.counts.diagnostics} C# messages retained. These do not establish a
              verified common frame or native parity.
            </p>
            <Button
              style={buttonStyle}
              disabled={disabled}
              onClick={() => void trace.readDiagnostics(0)}
            >
              Read preparation diagnostics
            </Button>
            {trace.diagnostics ? (
              <>
                <ul>
                  {trace.diagnostics.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
                <p>
                  Messages {trace.diagnostics.offset + 1}–
                  {Math.min(
                    trace.diagnostics.offset + trace.diagnostics.items.length,
                    trace.diagnostics.total,
                  )}{' '}
                  of {trace.diagnostics.total}
                </p>
                <Button
                  style={buttonStyle}
                  disabled={disabled || trace.diagnostics.offset === 0}
                  onClick={() =>
                    void trace.readDiagnostics(
                      Math.max(0, trace.diagnostics!.offset - trace.diagnostics!.limit),
                    )
                  }
                >
                  Previous preparation diagnostics
                </Button>
                <Button
                  style={buttonStyle}
                  disabled={disabled || trace.diagnostics.nextOffset === null}
                  onClick={() => void trace.readDiagnostics(trace.diagnostics!.nextOffset!)}
                >
                  Next preparation diagnostics
                </Button>
              </>
            ) : null}
          </details>
        </div>
      ) : null}
      {trace.page ? (
        <section aria-label="Captured object revisions" style={{ display: 'grid', gap: 8 }}>
          {trace.page.objects.map((item) => (
            <article
              key={item.id}
              style={{ border: '1px solid #ccc', borderRadius: 6, padding: 10, minWidth: 0 }}
            >
              <h4 style={{ whiteSpace: 'pre-wrap', margin: '0 0 8px' }}>{item.name}</h4>
              <p>
                {item.geometryRole === 'routing-leaf'
                  ? 'Physical routing geometry'
                  : item.geometryRole === 'hierarchy'
                    ? 'Hierarchy context'
                    : 'Equipment or model object'}{' '}
                · {item.objectId}
              </p>
              <Button
                style={buttonStyle}
                disabled={disabled}
                onClick={() => {
                  setDiagnosticPage(0);
                  void trace.inspect(item.id);
                }}
              >
                Inspect object {item.objectId}
              </Button>
            </article>
          ))}
          <p>
            {trace.page.offset + 1}–
            {Math.min(trace.page.offset + trace.page.objects.length, trace.page.total)} of{' '}
            {trace.page.total} objects
          </p>
          <Button
            style={buttonStyle}
            disabled={disabled || trace.page.offset === 0}
            onClick={() => void trace.objects(Math.max(0, trace.page!.offset - trace.page!.limit))}
          >
            Previous objects
          </Button>
          <Button
            style={buttonStyle}
            disabled={disabled || trace.page.nextOffset === null}
            onClick={() => void trace.objects(trace.page!.nextOffset!)}
          >
            Next objects
          </Button>
        </section>
      ) : null}
      {object ? (
        <article
          aria-label="Immutable object trace"
          style={{
            border: '1px solid #ccc',
            borderRadius: 6,
            padding: 12,
            marginTop: 12,
            minWidth: 0,
            wordBreak: 'normal',
            overflowWrap: 'anywhere',
          }}
        >
          <h4 style={{ whiteSpace: 'pre-wrap' }}>{object.historicalModel.name}</h4>
          <dl style={{ margin: 0, display: 'grid', gap: 14, minWidth: 0 }}>
            <div>
              <dt>
                <strong>Source identity</strong>
              </dt>
              <dd style={{ margin: 0 }}>
                Version-local object: {object.identity.objectId}
                <br />
                External identity: {object.identity.externalId ?? 'Unavailable'}
                <br />
                Source document: Unavailable
                <br />
                Source instance: Unavailable
                <br />
                Stable exported entity: Unavailable
                <br />
                Cross-version logical identity: Unavailable
              </dd>
            </div>
            <div>
              <dt>
                <strong>Project purpose and routing permission</strong>
              </dt>
              <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {object.catalog.purposeKey ?? 'No project tray association'}
                <br />
                {object.catalog.allowedCategories.length
                  ? object.catalog.allowedCategories.join(', ')
                  : 'No routing categories'}
                <br />
                Historical model purposes:{' '}
                {object.historicalModel.observedModelPurposes.join(', ') || 'Unavailable'}
              </dd>
            </div>
            <div>
              <dt>
                <strong>Coordinates</strong>
              </dt>
              <dd style={{ margin: 0 }}>
                Canonical vertices: metres, already transformed once.
                <br />
                Captured unit label: {object.coordinates.sourceUnits}
                <br />
                Recorded unit scale: {object.coordinates.metresPerSourceUnit ?? 'Unavailable'}
                <br />
                Global offset in metres: {object.coordinates.globalOffsetMetres.join(', ')}
                <br />
                Object-local frame: Unavailable
                <br />
                Common engineering frame: Unverified
                <br />
                Legacy source transform is a normalization record; it does not establish native
                placement.
              </dd>
            </div>
            <div>
              <dt>
                <strong>Captured geometry</strong>
              </dt>
              <dd style={{ margin: 0 }}>
                Role: {object.geometry.role}
                <br />
                Minimum metres: {object.geometry.bounds.minimum.join(', ')}
                <br />
                Maximum metres: {object.geometry.bounds.maximum.join(', ')}
                <br />
                Mesh fragments: {object.geometry.mesh.fragments}
                <br />
                Mesh SHA: {object.geometry.mesh.sha256}
              </dd>
            </div>
            <div>
              <dt>
                <strong>Measured and declared lengths</strong>
              </dt>
              <dd style={{ margin: 0 }}>
                C# fitted polyline length:{' '}
                {object.geometry.fitted
                  ? `${object.geometry.fitted.geometricLengthRoundTrip} m`
                  : 'Unavailable'}
                <br />
                Fit classification: {object.geometry.fitted?.fitStatus ?? 'Unavailable'}
                <br />
                Declared project length:{' '}
                {object.audit.declaredLength?.valueMm === null || !object.audit.declaredLength
                  ? 'Unavailable'
                  : `${object.audit.declaredLength.valueMm} mm`}
                <br />
                Declared length is historical audit data and does not replace measured geometry.
              </dd>
            </div>
            <div>
              <dt>
                <strong>Provenance</strong>
              </dt>
              <dd style={{ margin: 0 }}>
                Session: {object.provenance.sessionId}
                <br />
                Captured parts: {object.provenance.partIds.length}
                <br />
                Completed observation records: {object.provenance.completedCaptureEvidence.length}
                <br />
                Parts without raw observations:{' '}
                {object.provenance.missingCaptureEvidencePartIds.length}
                <br />
                Projection SHA: {object.provenance.projectionSha256}
              </dd>
            </div>
          </dl>
          <details>
            <summary>Completed capture observations</summary>
            <p>
              Read only the immutable observations stored with this trace. Missing historical
              observations remain unavailable.
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {object.provenance.partIds
                .filter(
                  (partId) => !object.provenance.missingCaptureEvidencePartIds.includes(partId),
                )
                .map((partId, index) => (
                  <Button
                    key={partId}
                    style={buttonStyle}
                    disabled={disabled}
                    onClick={() => void trace.readEvidence(partId)}
                  >
                    Read observations for part {index + 1}
                  </Button>
                ))}
            </div>
            {trace.evidence ? (
              <div aria-label="Completed coordinate observations">
                <p>
                  Evidence SHA: {trace.evidence.sha256}
                  <br />
                  Load: {trace.evidence.binding.loadId}
                  <br />
                  {trace.evidence.fragments.length} fragment transform observations. Canonical
                  vertices were already transformed once.
                </p>
                <dl style={{ display: 'grid', gap: 12 }}>
                  {(
                    [
                      ['Unit label', trace.evidence.observations.sourceUnitLabel],
                      ['Metres per display unit', trace.evidence.observations.metresPerDisplayUnit],
                      ['Up direction', trace.evidence.observations.upVector],
                      [
                        'Global offset in display units',
                        trace.evidence.observations.globalOffsetDisplayUnits,
                      ],
                      ['Global offset in metres', trace.evidence.observations.globalOffsetMetres],
                      [
                        'Display to world transform',
                        trace.evidence.observations.displayToWorldMetres,
                      ],
                      [
                        'Legacy scale-only source transform',
                        trace.evidence.observations.legacySourceToWorldMetres,
                      ],
                      ['SDK model transform', trace.evidence.observations.modelTransform],
                      ['SDK placement transform', trace.evidence.observations.placementTransform],
                    ] as const
                  ).map(([label, observation]) => (
                    <div key={label}>
                      <dt>
                        <strong>{label}</strong> ·{' '}
                        {observation.status === 'observed'
                          ? 'Observed'
                          : observation.status === 'derived'
                            ? 'Derived'
                            : 'Unavailable'}
                      </dt>
                      <dd style={{ margin: 0 }}>
                        {observation.value === null
                          ? 'Unavailable'
                          : Array.isArray(observation.value)
                            ? observation.value.join(', ')
                            : String(observation.value)}
                        <br />
                        Basis: {observation.api}
                        {observation.reason ? (
                          <>
                            <br />
                            {observation.reason.replaceAll('_', ' ').toLowerCase()}
                          </>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </details>
          {object.geometry.fitted ? (
            <details>
              <summary>Ordered axis and ports</summary>
              <p>
                {object.geometry.fitted.pointsMetres.length} ordered points; showing the first{' '}
                {Math.min(5, object.geometry.fitted.pointsMetres.length)}.
              </p>
              <ol>
                {object.geometry.fitted.pointsMetres.slice(0, 5).map((point, index) => (
                  <li key={index}>{point.join(', ')} m</li>
                ))}
              </ol>
              <p>
                {object.geometry.fitted.ports.length} observed fitted ports. These are geometric
                measurements.
              </p>
            </details>
          ) : null}
          <details>
            <summary>Historical model properties</summary>
            <p>
              Showing first {Math.min(10, object.historicalModel.properties.length)} of{' '}
              {object.historicalModel.properties.length} recorded properties.
            </p>
            <dl>
              {object.historicalModel.properties.slice(0, 10).map((property, index) => (
                <div key={index}>
                  <dt>
                    {property.category} · {property.name}
                  </dt>
                  <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{property.value}</dd>
                </div>
              ))}
            </dl>
          </details>
          <h4>Diagnostics</h4>
          <p>{object.diagnostics.length} recorded warnings or limitations.</p>
          <ul>
            {object.diagnostics
              .slice(diagnosticPage * 20, (diagnosticPage + 1) * 20)
              .map((diagnostic, index) => (
                <li key={index}>{diagnostic}</li>
              ))}
          </ul>
          <Button
            style={buttonStyle}
            disabled={diagnosticPage === 0}
            onClick={() => setDiagnosticPage((value) => value - 1)}
          >
            Previous diagnostics
          </Button>
          <Button
            style={buttonStyle}
            disabled={(diagnosticPage + 1) * 20 >= object.diagnostics.length}
            onClick={() => setDiagnosticPage((value) => value + 1)}
          >
            Next diagnostics
          </Button>
        </article>
      ) : null}
    </section>
  );
}
