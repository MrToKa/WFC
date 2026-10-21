using System;
using System.Collections.Generic;
using System.Threading;

namespace AddinRibbon.Routing
{
    /// <summary>Distance qualification remains the exact original strict D&lt;F OR
    /// D&lt;T decision. Only a clear direct centreline, or an explicit drilling
    /// bypass, selects that strategy. Otherwise search accessible tray candidates.
    /// No design ledger/formula or endpoint coordinates are replaced here.</summary>
    public static partial class ConstrainedSecondaryRoute
    {
        public static ConstrainedSecondaryEvaluation Calculate(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
            CableCategory category, RouteCollisionQuery collision, RoutingOptions options = null,
            ConstrainedRoutingLimits limits = null, bool drillThroughWalls = false,
            CancellationToken cancellationToken = default(CancellationToken))
        {
            if (!drillThroughWalls && collision == null) throw new ArgumentNullException("collision");
            var frozenOptions = RouteCalculator.ConstrainedOptions(options);
            using (var budget = new ConstrainedBudget((limits ?? new ConstrainedRoutingLimits()).Snapshot(), cancellationToken))
            {
                DirectSecondaryEvaluation distance = null; RouteCollisionObservation direct = null; string disposition = "unavailable";
                try
                {
                    int pieces; var eligible = RouteCalculator.ConstrainedInputs(trays, category, budget, out pieces);
                    // Evaluate against all eligible fitted polylines, before any
                    // obstacle filtering or preferred-vertical substitution.
                    budget.Charge(2L * pieces);
                    distance = DirectSecondaryRoute.Evaluate(eligible, from, to, category, frozenOptions, budget.Token); budget.Check();
                    disposition = distance.IsDirect ? "unavailable" : "not-qualified";
                    if (distance.IsDirect)
                    {
                        if (drillThroughWalls)
                            return new ConstrainedSecondaryEvaluation(distance, null, "bypassed",
                                new ConstrainedRouteEvaluation(distance.DirectRoute, ConstrainedRouteStatus.Bypassed, "DRILLING_BYPASS", true, budget));
                        direct = budget.Query(collision, from, to);
                        disposition = direct.Status == RouteCollisionStatus.Clear ? "clear"
                            : direct.Status == RouteCollisionStatus.Blocked ? "blocked" : "indeterminate";
                        if (direct.Status == RouteCollisionStatus.Clear)
                        {
                            // This query checks the complete exact two-point
                            // polyline, or one occupancy primitive if coincident.
                            return new ConstrainedSecondaryEvaluation(distance, direct, disposition,
                                new ConstrainedRouteEvaluation(distance.DirectRoute, ConstrainedRouteStatus.Clear, "DIRECT_SECONDARY_CLEAR", true, budget));
                        }
                    }
                    var route = new RouteCalculator().CalculateConstrainedPrepared(eligible, from, to, category, collision,
                        frozenOptions, drillThroughWalls, budget, pieces);
                    return new ConstrainedSecondaryEvaluation(distance, direct, disposition, route);
                }
                catch (ConstrainedLimitException error)
                { cancellationToken.ThrowIfCancellationRequested(); return new ConstrainedSecondaryEvaluation(distance, direct, disposition, budget.Failure(error.Reason)); }
                catch (OperationCanceledException)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    return new ConstrainedSecondaryEvaluation(distance, direct, disposition, budget.Failure("SEARCH_DEADLINE_EXCEEDED"));
                }
            }
        }
    }
}
