import type { ModelCaptureRequest, ModelRouteRule, RoutingCategory } from './protocol.mjs';
export const CAPTURE_INPUT_LIMITS: Readonly<{ names: 4096; namesPerChunk: 256; chunks: 16; bytes: number; messageBytes: 65536; responses: 3000; milliseconds: 300000 }>;
export type ModelCapturePlanningRequest = { equipmentNames: string[] } & ({ routeRules: ModelRouteRule[]; routeCodes?: never; allowedCategories?: never; lookupRouteCodes?: never } | { routeCodes: string[]; allowedCategories: RoutingCategory[]; routeRules?: never; lookupRouteCodes?: never });
export interface ModelCaptureInputDescriptor { schemaVersion: 'wfc.capture.input.v1'; equipmentNameCount: number; chunkCount: number; inputUtf8Bytes: number; scopeSha256: string; equipmentNamesSha256: string }
export interface ModelCapturePropertyScan { indexedObjectCount: number; attemptedObjectCount: number; returnedObjectCount: number; omittedObjectCount: number; complete: boolean }
export interface ModelCaptureInputScope extends ModelCaptureInputDescriptor { propertyScan: ModelCapturePropertyScan | null }
export interface ModelCaptureInputAppend { captureId: string; equipmentOffset: number; equipmentNames: string[] }
export interface ModelCaptureInputAck { captureId: string; phase: 'receiving' | 'ready'; receivedNameCount: number; scopeSha256: string | null; equipmentNamesSha256: string | null }
export type ModelCaptureStagedStart = { captureId: string; input: ModelCaptureInputDescriptor } & ({ routeRules: ModelRouteRule[] } | { routeCodes: string[]; allowedCategories: RoutingCategory[] });
export interface ModelCaptureInputPlan { request: ModelCapturePlanningRequest; descriptor: ModelCaptureInputDescriptor; chunks: ModelCaptureInputAppend[]; startPayload: ModelCaptureStagedStart }
export function normalizeModelCapturePlanningInput(request: ModelCaptureRequest): ModelCapturePlanningRequest;
export function modelCaptureScopeBytes(request: ModelCaptureRequest): Uint8Array;
export function validateModelCaptureInputDescriptor(value: unknown): value is ModelCaptureInputDescriptor;
export function validateModelCaptureInputScope(value: unknown, options?: { allowPending?: boolean }): value is ModelCaptureInputScope;
export function isStagedModelCaptureStart(value: unknown): value is ModelCaptureStagedStart;
export function isModelCaptureInputAppend(value: unknown): value is ModelCaptureInputAppend;
export function validateModelCaptureInputAck(value: unknown): value is ModelCaptureInputAck;
export function planModelCaptureInput(request: ModelCaptureRequest, options: { captureId: string; envelopeIdentity: { instanceId: string; projectId: string; modelVersionId: string; loadId: string }; signal?: AbortSignal }): Promise<ModelCaptureInputPlan>;
export function createModelCaptureInputStage(start: ModelCaptureStagedStart, options?: { signal?: AbortSignal; isCurrent?: () => boolean; startedAt?: number }): { initialAck(): Promise<ModelCaptureInputAck>; append(value: ModelCaptureInputAppend): Promise<ModelCaptureInputAck>; request(): ModelCapturePlanningRequest & { captureId: string; inputScope: ModelCaptureInputDescriptor }; readonly ready: boolean; readonly remainingResponses: number; readonly startedAt: number };
