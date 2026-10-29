import type { BarrierMultipartScope, BarrierMultipartProfile, BarrierMultipartNodePage, BarrierMultipartFragmentPage,
  BarrierMultipartGeometryRangePage, BarrierMultipartPlanPage, BarrierMultipartNodeSeal, BarrierMultipartFragmentSeal,
  BarrierMultipartRangeSeal, BarrierMultipartPlanSeal, BarrierMultipartHashDomain, BarrierMultipartSha256 } from '../shared/pathfinderBarrierMultipart.js';

export const BARRIER_MULTIPART_PLANNER_PROFILE: BarrierMultipartProfile;
export function barrierPlanCanonical(value: unknown, maximumBytes?: number): string;
export function barrierPlanHash(domain: BarrierMultipartHashDomain, value: unknown, sha256?: BarrierMultipartSha256, signal?: AbortSignal): Promise<string>;
export function barrierRangePlannedBytes(referencedVertices: number, triangles: number): number;
export type BarrierFragmentSplitHint = { triangleStart: number; triangleCount: number; referencedVertexCountUpperBound: number;
  plannedEncodedBytesUpperBound: number; admitted: false; authority: 'none'; qualification: 'NOT_MEASURED' };
/** Count-based hints only. A protected range inventory and a new immutable plan are still required. */
export function planBarrierFragmentSplitHints(options: { sourceVertices: number; sourceTriangles: number; profile: BarrierMultipartProfile }): Generator<BarrierFragmentSplitHint, void>;
export type BarrierMultipartPlannerOptions = { scope: BarrierMultipartScope; profile: BarrierMultipartProfile;
  nodeSeal: BarrierMultipartNodeSeal; fragmentSeal: BarrierMultipartFragmentSeal; rangeSeal: BarrierMultipartRangeSeal;
  nodePages: AsyncIterable<BarrierMultipartNodePage> | Iterable<BarrierMultipartNodePage>;
  fragmentPages: AsyncIterable<BarrierMultipartFragmentPage> | Iterable<BarrierMultipartFragmentPage>;
  geometryRangePages: AsyncIterable<BarrierMultipartGeometryRangePage> | Iterable<BarrierMultipartGeometryRangePage>;
  sha256?: BarrierMultipartSha256; signal?: AbortSignal };
export type BarrierMultipartPlannerEvent = { kind: 'plan-page'; page: BarrierMultipartPlanPage } | { kind: 'plan-seal'; seal: BarrierMultipartPlanSeal };
/** Draft pages never authorize capture publication, geometry qualification or calculation. */
export function planBarrierMultipart(options: BarrierMultipartPlannerOptions): AsyncGenerator<BarrierMultipartPlannerEvent, void>;
