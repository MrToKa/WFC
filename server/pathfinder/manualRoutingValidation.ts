import { engineResponseSchema, type EngineResponse, type BarrierDependencySnapshot } from './jobContracts.js';
import { requireBarrierEngineStrategy } from './barrierStrategy.js';
import { requireCalculationLengthLedger } from './lengthLedger.js';
import type { ManualRoutingDependencies } from './manualRoutingContracts.js';
import { routingEngineCategory } from '../../shared/pathfinderCableEligibility.js';
import { hash } from './dependencies.js';
import { PathFinderError } from './errors.js';
import { z } from 'zod';
import { policyHashSchema, policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { isPermittedCablePurposeRoute } from '../../shared/routingCablePurposes.js';
const category = (d: BarrierDependencySnapshot) => d.cablePurposeRouting && !['MV','LV','Control','Instrumentation'].includes(d.cableInputs.mto ?? '')
  ? routingEngineCategory(d.cableInputs.mto) : d.cableInputs.mto;
/** Explicit constrained lane: it cannot grant an automatic result/write. */
export function validateManualRoutingResult(response: EngineResponse, d: ManualRoutingDependencies, requestId: string): number | null {
  if (response.requestId !== requestId) throw new PathFinderError('ENGINE_RESPONSE_IDENTITY', 502);
  if(d.schemaVersion!=='pathfinder.manual-route.dependencies.v1'||d.protected.schemaVersion!=='pathfinder.dependencies.v8')throw new PathFinderError('MANUAL_ROUTE_INPUT_VERSION',502);
  const p = d.protected;
  if(p.cablePurposeRouting && response.route?.success && !isPermittedCablePurposeRoute(response.route.routeCodes,p.cablePurposeRouting.allowedRouteCodes))
    throw new PathFinderError('MANUAL_ROUTE_PURPOSE_NOT_PERMITTED',502);
  requireBarrierEngineStrategy(response, { context: p.barriers, category: category(p), fromPoint: p.from.point, toPoint: p.to.point,
    ...(p.barriers.schemaVersion === 'wfc.pf.barrier-runtime.v2' ? { qualification: p.barrierQualification } : {}), manualRouteConstraint: d.constraint });
  const ledger = requireCalculationLengthLedger(response, p.settings);
  if (response.status !== 'calculated') return null;
  if (!ledger || !response.route?.success || ledger.schemaVersion !== 'wfc.pf.length-components.v1') throw new PathFinderError('MANUAL_ROUTE_LENGTH_UNVERIFIED', 502);
  const exact = response.design?.designLengthMeters;
  if (typeof exact !== 'string' || !/^(?:0|[1-9][0-9]{0,6})(?:[.]0+)?$/.test(exact) || Number(exact) > 1000000)
    throw new PathFinderError('MANUAL_ROUTE_LENGTH_OUTSIDE_LIMIT', 409);
  return Number(exact);
}
export const manualRoutingSourceSchema=z.object({schemaVersion:z.literal('pathfinder.manual-route.source.v1'),resultId:policyUuidSchema,
  projectId:policyUuidSchema,cableId:policyUuidSchema,manualRevision:policyRevisionSchema,generation:policyRevisionSchema,
  inputSha256:policyHashSchema,recordSha256:policyHashSchema,manualTextSha256:policyHashSchema,
  lengthMetres:z.number().int().min(0).max(1000000).nullable(),calculatedAt:z.string().datetime(),
  calculation:z.literal('ordered-full-cable-with-barriers-v1')}).strict();
export function buildManualRoutingSource(record:Record<string,any>,recordSha256:string){return manualRoutingSourceSchema.parse({
  schemaVersion:'pathfinder.manual-route.source.v1',resultId:record.id,projectId:record.projectId,cableId:record.cableId,
  manualRevision:record.manualRevision,generation:record.generation,inputSha256:record.inputSha256,recordSha256,
  manualTextSha256:hash(record.dependencies.constraint.routeText),lengthMetres:record.lengthMetres,calculatedAt:record.calculatedAt,
  calculation:'ordered-full-cable-with-barriers-v1'});}
export function verifiedManualRoutingReadLength(row: Record<string,any>, projectId: string): number|null {
  try {
    const r=manualRoutingSourceSchema.parse(row.manual_source_record);
    if(hash(r)!==row.manual_source_sha256 || r.recordSha256!==row.manual_result_sha256 || r.resultId!==row.manual_result_id
      || r.projectId!==projectId || r.cableId!==row.cable_id || r.manualRevision!==row.manual_revision || r.generation!==row.manual_generation
      || r.inputSha256!==row.manual_input_sha256 || r.manualTextSha256!==hash(row.manual_routing))return null;
    return r.lengthMetres!==null && r.lengthMetres===row.length_metres?r.lengthMetres:null;
  }catch{return null;}
}
