export const CHANNEL: 'wfc-routings-viewer';
export const PROTOCOL_VERSION: 1;
export const SDK_VERSION: '7.130.0';
export const MAX_MESSAGE_BYTES: 65536;
export const MAX_PATH_POINTS: 20000;
export const MAX_PATH_CHUNK_POINTS: 128;
export const FRAME_PATH: '/viewer-runtime/7.130.0/index.html';
export const PARENT_TYPES: readonly string[];
export const FRAME_TYPES: readonly string[];
export type BridgeDirection = 'parent-to-frame' | 'frame-to-parent';
export interface BridgeEnvelope {
  channel: typeof CHANNEL; protocolVersion: 1; instanceId: string; projectId: string;
  modelVersionId: string | null; loadId: string | null; requestId: string;
  type: string; payload: Record<string, unknown>;
}
export interface RoutingOccurrence { segmentIndex: number; token: string; key: string }
export interface IgnoredOccurrence { segmentIndex: number; token: string; reason: 'SECONDARY' }
export interface ParsedRouting { segments: RoutingOccurrence[]; ignored: IgnoredOccurrence[] }
export interface RouteWarning { code: string; segmentIndex: number | null; message: string }
export interface ModelRouteSegment extends RoutingOccurrence {
  model: { state: 'found' | 'missing' | 'ambiguous'; matchCount: number; drawable: boolean };
}
export interface ModelRouteResultPayload {
  rawRouting: string; source: 'manual' | 'cable'; cableId: string | null;
  segments: ModelRouteSegment[]; ignored: IgnoredOccurrence[];
  drawableCount: number; lineCount: number; warnings: RouteWarning[];
}
export interface ViewerDescriptor {
  projectId: string; modelVersionId: string; loadId: string; contentFingerprint: string;
  supportProfile: 'svf-local-7.130.0-v1'; format: 'svf'; sdkVersion: '7.130.0';
  entrypoint: 'resources/output/0/0.svf'; resourceCount: number; totalBytes: number;
}
export type CanonicalPoint = [number, number, number];
export interface ComputedPath { pathId: string; points: CanonicalPoint[]; objectIds: number[] }
export type RoutingCategory = 'MV' | 'LV' | 'Control';
export interface ModelRouteRule { id: string; objectIds: number[]; allowedCategories: RoutingCategory[] }
export type ModelCaptureRequest = { equipmentNames: string[] } & (
  { routeCodes: string[]; allowedCategories: RoutingCategory[]; routeRules?: never; lookupRouteCodes?: never } |
  { routeRules: ModelRouteRule[]; routeCodes?: never; allowedCategories?: never; lookupRouteCodes?: never } |
  { lookupRouteCodes: string[]; routeCodes?: never; routeRules?: never; allowedCategories?: never }
);
export interface ModelCaptureProgress { index: number; type: string; objectCount?: number }
export interface PickedPoint { objectId: number; point: CanonicalPoint; derivation: 'picked-surface-point' }
export interface ViewerModelObject {
  objectId: number; parentId: number | null; name: string; externalId: string | null;
  bounds: { minimum: CanonicalPoint; maximum: CanonicalPoint } | null;
  bottomCentre: CanonicalPoint | null; derivation: 'display-aabb-bottom-centre'; nativeVisibility: 'unknown';
  properties: { name: string; value: string }[]; propertiesTruncated: boolean;
}
export interface ViewerModelObjectsPage {
  cursor: number; nextCursor: number | null; complete: boolean; query: string;
  coordinateFrame: 'world-metres-z-up'; metresPerDisplayUnit: number; globalOffsetMetres: CanonicalPoint;
  objects: ViewerModelObject[];
}
export interface ViewerSelection {
  coordinateFrame: 'world-metres-z-up'; metresPerDisplayUnit: number; globalOffsetMetres: CanonicalPoint;
  objects: ViewerModelObject[];
}
export function isCanonicalPoint(value: unknown): value is CanonicalPoint;
export function isUuid(value: unknown): value is string;
export function parseRouting(rawRouting: string): ParsedRouting;
export function normalizeRoutingKey(token: string): string;
export function validateBootstrap(search: string): { instanceId: string; projectId: string } | null;
export function validateDescriptor(value: unknown, identity: Pick<ViewerDescriptor, 'projectId' | 'modelVersionId' | 'loadId'>): ViewerDescriptor | null;
export function validateEnvelope(value: unknown, direction?: BridgeDirection): BridgeEnvelope | null;
