import type { BarrierPackedPartDescriptor, BarrierPackedExpectedRange } from '../shared/pathfinderBarrierPackedGeometry.js';
import type { BarrierFrameObservation } from './barrier-capture.mjs';
import type { BarrierMultipartSha256, BarrierMultipartGeometryRange, BarrierMultipartPlanRecord, BarrierMultipartFragment } from '../shared/pathfinderBarrierMultipart.js';
export const BARRIER_PACKED_GEOMETRY_FORMAT: typeof import('../shared/pathfinderBarrierPackedGeometry.js').BARRIER_PACKED_GEOMETRY_FORMAT;
export type BarrierPackedOwnedRange = {sourceVertexIds:Uint32Array;localVertices:Float64Array;originalIndices:Uint32Array;
  originalTransform:Float64Array;worldTransform:Float64Array;canonicalTransform:Float64Array};
export function barrierPackedRangeBinaryBytes(vertices:number,triangles:number):number;
export function barrierPackedDescriptorBytes(descriptor:BarrierPackedPartDescriptor):Uint8Array;
export function barrierPackedDescriptorHashInput(descriptor:BarrierPackedPartDescriptor):{domain:'wfc.pf.barrier-packed-mesh.v1/descriptor';value:BarrierPackedPartDescriptor};
export function barrierPackedMeasureDescriptor(descriptor:BarrierPackedPartDescriptor):{headerBytes:number;descriptorBytes:number;binaryBytes:number;totalBytes:number;plannedEncodedBytesUpperBound:number;vertices:number;triangles:number;rangeCount:number;fragmentRefs:number};
/** Trusted expectations originate from sealed streams. Parsing alone grants no authority. */
export function encodeBarrierPackedPart(options:{descriptor:BarrierPackedPartDescriptor;expectedRanges:BarrierPackedExpectedRange[];frameObservation:BarrierFrameObservation;
  readRange:(range:BarrierMultipartGeometryRange,placement:BarrierMultipartPlanRecord,fragment:BarrierMultipartFragment)=>Promise<BarrierPackedOwnedRange>|BarrierPackedOwnedRange;
  signal?:AbortSignal;sha256?:BarrierMultipartSha256}):Promise<Uint8Array>;
