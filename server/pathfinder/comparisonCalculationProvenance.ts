import {revisionComparisonScopeSchema,type RevisionComparisonScope} from '../../shared/pathfinderRevisionComparison.js';
import {endpointCalculationPreparationSchema} from './endpointCalculationProvenance.js';

/** Null is explicit server-owned not-required authority, never a missing/pending head. */
export type ComparisonCalculationScope = RevisionComparisonScope | null;
export function hasCurrentComparisonCalculationProvenance(value:unknown):boolean {
  if(!value||typeof value!=='object')return false;
  const input=value as Record<string,unknown>;
  if(input.schemaVersion!=='pathfinder.dependencies.v4'||!Object.prototype.hasOwnProperty.call(input,'comparison'))return false;
  const preparation=endpointCalculationPreparationSchema.safeParse(input.preparation);
  if(!preparation.success)return false;
  if(input.comparison===null)return true;
  const scope=revisionComparisonScopeSchema.safeParse(input.comparison);
  return scope.success&&scope.data.sourceAggregateId!==scope.data.targetAggregateId&&scope.data.targetAggregateId===preparation.data.aggregateId;
}
