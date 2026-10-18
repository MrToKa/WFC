import type { ModelCaptureRequest } from './protocol.mjs';
export const MODEL_CAPTURE_LIMITS: Readonly<{ eventBytes: number; totalBytes: number; events: number; indexedObjects: number; objects: number; fragments: number; vertices: number; triangles: number; depth: number; properties: number; milliseconds: number }>;
export function captureSelectedModel(viewer: unknown, input: ModelCaptureRequest & { captureId: string; projectId: string; modelVersionId: string; contentFingerprint: string }, options?: { signal?: AbortSignal; onProgress?: (progress: Record<string, unknown>) => void }): AsyncGenerator<Record<string, unknown>, void>;
export function createModelCaptureAssembler(): { accept(event: unknown): void; finish(): unknown; summary(): Record<string, unknown> };
