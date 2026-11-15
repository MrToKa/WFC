import { z } from 'zod';
import { normalizeRouting } from '../../shared/cableRoutingControl.js';
import type { BarrierDependencySnapshot } from './jobContracts.js';
import { PathFinderError } from './errors.js';

export const manualRouteConstraintSchema = z.object({ schemaVersion: z.literal('pathfinder.manual-ordered-route.v1'),
  routeText: z.string().min(1).max(16384) }).strict();
export type ManualRouteConstraint = z.infer<typeof manualRouteConstraintSchema>;
/** Match the native parser's physical occurrence order, including /A/B/A. */
export function manualPhysicalCodes(text: string, nativeOutput = false): string[] {
  let parsed:string|null;
  try{parsed=nativeOutput ? text.length <= 25604 && !/[\u0000-\u001f\u007f-\u009f]/u.test(text) ? text : null : normalizeRouting(text);}
  catch{throw new PathFinderError('MANUAL_ROUTE_INVALID_TEXT',409);}
  if (!parsed) throw new PathFinderError('MANUAL_ROUTE_TEXT_REQUIRED_OR_LIMIT', 409);
  const tokens = parsed.split('/').map(value => value.trim()).filter(Boolean);
  if (tokens.length > 102) throw new PathFinderError('MANUAL_ROUTE_CODE_LIMIT', 409);
  if (tokens.some(value => value.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value))) throw new PathFinderError('MANUAL_ROUTE_INVALID_TOKEN', 409);
  const codes = tokens.map(value => value.toUpperCase());
  if (codes[0] === 'SECONDARY') codes.shift();
  if (codes.at(-1) === 'SECONDARY') codes.pop();
  if (!codes.length) throw new PathFinderError('MANUAL_ROUTE_PHYSICAL_TRAY_REQUIRED', 409);
  if (codes.length > 100) throw new PathFinderError('MANUAL_ROUTE_CODE_LIMIT', 409);
  if (codes.includes('SECONDARY')) throw new PathFinderError('MANUAL_ROUTE_INTERIOR_SECONDARY_UNSUPPORTED', 409);
  if (codes.some((code, at) => at > 0 && codes[at - 1] === code)) throw new PathFinderError('MANUAL_ROUTE_ADJACENT_REPEAT_AMBIGUOUS', 409);
  return codes.map(code => '/' + code);
}
/** A separate version prevents a constrained result from acquiring Auto
 * publication or effective Routing write authority through ordinary v8. */
export type ManualRoutingDependencies = {
  schemaVersion: 'pathfinder.manual-route.dependencies.v1'; manualRevision: string;
  constraint: ManualRouteConstraint; protected: BarrierDependencySnapshot;
  capacity: { occupancySha256: string; restrictionEnabled: boolean; excludedRouteCodes: string[] } | null;
};
