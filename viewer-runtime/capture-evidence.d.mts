export interface CaptureObservation<T> {
  status: 'observed' | 'derived' | 'unavailable';
  value: T | null;
  api: string;
  reason: string | null;
}
export type EvidencePoint = [number, number, number];
export type EvidenceMatrix = number[];
export interface CaptureEvidenceBinding {
  projectId: string;
  modelVersionId: string;
  contentFingerprint: string;
  selectionRevision: string | null;
  loadId: string | null;
  captureId: string;
  sessionId: string | null;
  partId: string | null;
  planSha256: string | null;
  coordinateFrameId: string | null;
  partPayloadSha256: string | null;
}
export interface CompletedCaptureEvidence {
  schemaVersion: 'wfc.pf.completed-capture-evidence.v1';
  binding: CaptureEvidenceBinding;
  observations: {
    sdkVersion: string;
    matrixPrecision: 'binary64';
    sourceUnitLabel: CaptureObservation<string>;
    metresPerDisplayUnit: CaptureObservation<number>;
    upVector: CaptureObservation<EvidencePoint>;
    globalOffsetDisplayUnits: CaptureObservation<EvidencePoint>;
    globalOffsetMetres: CaptureObservation<EvidencePoint>;
    displayToWorldMetres: CaptureObservation<EvidenceMatrix>;
    legacySourceToWorldMetres: CaptureObservation<EvidenceMatrix>;
    modelTransform: CaptureObservation<EvidenceMatrix>;
    placementTransform: CaptureObservation<EvidenceMatrix>;
    objectLocalFrame: null;
    sourceDocumentId: null;
    sourceInstancePath: null;
    stableExportEntityId: null;
  };
  fragments: {
    objectId: string;
    fragmentId: string;
    originalWorldMatrix: CaptureObservation<EvidenceMatrix>;
    displayWorldMatrix: CaptureObservation<EvidenceMatrix>;
    canonicalMatrix: CaptureObservation<EvidenceMatrix>;
    transformAlreadyApplied: true;
  }[];
  diagnostics: string[];
  sha256: string;
}
export interface CompletedModelCaptureSummary extends Record<string, unknown> {
  completedEvidence?: CompletedCaptureEvidence;
}
export const CAPTURE_EVIDENCE_LIMITS: Readonly<{
  bytes: number;
  fragments: 4096;
  diagnostics: 256;
}>;
export function canonicalCaptureEvidenceJson(value: unknown): string;
export function validateCompletedCaptureEvidence(value: unknown): value is CompletedCaptureEvidence;
export function completedCaptureEvidenceHash(value: CompletedCaptureEvidence): Promise<string>;
export function createCompletedCaptureEvidence(
  input: Omit<CompletedCaptureEvidence, 'sha256'>,
): Promise<CompletedCaptureEvidence>;
export function verifyCompletedCaptureEvidence(value: unknown): Promise<boolean>;
export function bindCompletedCaptureEvidence(
  value: CompletedCaptureEvidence,
  binding: { selectionRevision: string | null; partPayloadSha256: string | null },
): Promise<CompletedCaptureEvidence>;
