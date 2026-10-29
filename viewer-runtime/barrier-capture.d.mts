import type { BarrierCapture, BarrierModelScope } from '../shared/pathfinderBarriers.js';

export interface BarrierCaptureRequest {
  captureId: string;
  scope: BarrierModelScope;
  selectedParents: BarrierCapture['selectedParents'];
}
export interface BarrierFrameObservation {
  schemaVersion: 'wfc.pf.barrier-frame-observation.v1';
  projectId: string; modelVersionId: string; contentFingerprint: string; loadId: string;
  sdkVersion: '7.130.0'; matrixPrecision: 'binary64'; coordinateFrame: 'canonical-world-metres';
  sourceUnits: string; metresPerDisplayUnit: number; upVector: [number, number, number];
  globalOffsetDisplayUnits: [number, number, number]; globalOffsetMetres: [number, number, number];
  displayToWorldMetres: number[]; modelTransform: number[] | null; placementTransform: number[] | null;
  contentSha256: string;
}
export type BarrierCaptureEvent = {
  type: 'metadata'; captureId: string; schemaVersion: 'wfc.pf.barrier-capture.events.v1';
  scope: BarrierModelScope; selectedParentCount: number; frameObservation: BarrierFrameObservation;
} | { type: 'capture-part'; captureId: string; partIndex: number; final: boolean; text: string }
  | { type: 'complete'; captureId: string; captureSha256: string; fragmentCount: number; vertexCount: number; triangleCount: number };
export const BARRIER_CAPTURE_VIEWER_LIMITS: Readonly<{
  requestBytes: number; eventBytes: number; totalBytes: number; events: number; selectedParents: number;
  fragments: number; vertices: number; triangles: number; closureObjects: number; enumerationWork: number;
  depth: number; milliseconds: number; callbackMilliseconds: number;
}>;
export function barrierCanonicalJson(value: unknown): string;
export function barrierFrameObservationHashInput(value: BarrierFrameObservation): Omit<BarrierFrameObservation, 'contentSha256'>;
export function barrierEnumerationHashInput(capture: BarrierCapture): unknown;
export function validateBarrierCaptureRequest(value: unknown): value is BarrierCaptureRequest;
export function validateBarrierFrameObservation(value: unknown): value is BarrierFrameObservation;
export function validateBarrierCaptureEvent(value: unknown): value is BarrierCaptureEvent;
export function captureSelectedBarriers(viewer: unknown, request: BarrierCaptureRequest, options: {
  loadId: string; signal?: AbortSignal; onProgress?: (value: { phase: 'index' | 'geometry'; loaded: number; total: number }) => void;
  startedAt?: number; eventLimit?: number;
}): AsyncGenerator<BarrierCaptureEvent, void>;
export function createBarrierCaptureAssembler(options: { expectedRequest: BarrierCaptureRequest; loadId?: string; eventLimit?: number }): {
  accept(event: unknown): void;
  finish(): Promise<{ capture: BarrierCapture; frameObservation: BarrierFrameObservation }>;
};
