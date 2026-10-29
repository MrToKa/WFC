import { lengthLedgerSchema, canonicalDecimalString, type LengthLedger } from '../../shared/pathfinderLengthLedger.js';
import type { EngineResponse, ProjectSettings } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { directSecondaryDecisionSchema, directSecondaryRouteIssue } from '../../shared/pathfinderDirectSecondary.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';

/** The C# observer supplies components. Never recalculate its design in JS. */
export function requireCalculationLengthLedger(response: EngineResponse, settings: ProjectSettings): LengthLedger | null {
  if (response.status !== 'calculated' || !response.route?.success || response.design === null || response.design === undefined) {
    if (response.lengthLedger !== undefined) throw new PathFinderError('ENGINE_LENGTH_LEDGER_UNEXPECTED', 502);
    return null;
  }
  const fail = (): never => { throw new PathFinderError('ENGINE_LENGTH_LEDGER_INVALID', 502, 'The exact C# length components are missing or do not match this calculation.'); };
  const parsed = lengthLedgerSchema.safeParse(response.lengthLedger);
  if (!parsed.success) return fail();
  const ledger = parsed.data, route = response.route, design = response.design;
  try {
    if (ledger.schemaVersion === 'wfc.pf.length-components.v2') {
      const decision = response.schemaVersion === 'pathfinder.model.response.v2' ? directSecondaryDecisionSchema.safeParse(response.directSecondary)
        : response.schemaVersion === 'pathfinder.model.response.v3' && response.barriers.directSecondary?.mode === 'direct-secondary'
          ? directSecondaryDecisionSchema.safeParse(response.barriers.directSecondary.distanceDecision) : null;
      if (!decision?.success || canonicalPurposeJson(ledger.directSecondary) !== canonicalPurposeJson(decision.data)
        || directSecondaryRouteIssue(decision.data, { ...route, points: route.pathPoints.map(point => [point.x, point.y, point.z]) })) return fail();
    } else if (response.schemaVersion === 'pathfinder.model.response.v2' && response.directSecondary.mode === 'direct-secondary'
      || response.schemaVersion === 'pathfinder.model.response.v3' && response.barriers.directSecondary?.mode === 'direct-secondary') return fail();
    if (ledger.settingsRevision !== settings.revision
      || ledger.raw.lengthMeters !== route.lengthMeters || ledger.raw.fromDistanceMeters !== route.fromDistanceMeters || ledger.raw.toDistanceMeters !== route.toDistanceMeters
      || ledger.from.requiresSecondary !== route.fromRequiresSecondary || ledger.to.requiresSecondary !== route.toRequiresSecondary
      || ledger.beforePercentageMeters !== canonicalDecimalString(design.lengthBeforePercentageMeters)
      || ledger.unroundedMeters !== canonicalDecimalString(design.unroundedLengthMeters) || ledger.designLengthMeters !== canonicalDecimalString(design.designLengthMeters)
      || ledger.settings.secondaryTrayLengthMeters !== (settings.secondaryTrayLength === null ? null : canonicalDecimalString(settings.secondaryTrayLength))
      || ledger.settings.endConnectionLengthMeters !== canonicalDecimalString(settings.endConnectionLength)
      || ledger.settings.additionalBendingPercent !== canonicalDecimalString(settings.additionalBendingPercent)) return fail();
  } catch { return fail(); }
  return ledger;
}
