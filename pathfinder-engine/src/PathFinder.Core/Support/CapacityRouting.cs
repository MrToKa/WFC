using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading;

namespace AddinRibbon.Routing
{
    /// <summary>Per-query exclusions affect tray traversal only. They never
    /// refit the model or change the nearest-original-tray SECONDARY decision.</summary>
    public static class CapacityRouting
    {
        public const int MaximumExcludedRouteCodes = 4096;
        public const int MaximumRouteCodeLength = 256;
        private static readonly Regex CanonicalCode = new Regex(@"\A/[A-Z0-9][A-Z0-9_.-]*\z",
            RegexOptions.CultureInvariant);

        public static void ValidateExcludedRouteCodes(IReadOnlyList<string> excludedRouteCodes)
        {
            if (excludedRouteCodes == null) return;
            if (excludedRouteCodes.Count > MaximumExcludedRouteCodes)
                throw new ArgumentException("Capacity route exclusions exceed their bounded count.");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var code in excludedRouteCodes)
                if (code == null || code.Length > MaximumRouteCodeLength || !CanonicalCode.IsMatch(code) || !seen.Add(code))
                    throw new ArgumentException("Capacity route exclusions require unique canonical route codes.");
        }

        public static IEnumerable<TraySegment> Filter(IEnumerable<TraySegment> trays, IReadOnlyList<string> excludedRouteCodes,
            CancellationToken cancellationToken = default(CancellationToken))
        {
            if (trays == null) throw new ArgumentNullException("trays");
            ValidateExcludedRouteCodes(excludedRouteCodes);
            if (excludedRouteCodes == null || excludedRouteCodes.Count == 0) return trays;
            var excluded = new HashSet<string>(excludedRouteCodes, StringComparer.Ordinal);
            var available = new List<TraySegment>();
            foreach (var tray in trays)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (tray == null) throw new ArgumentException("Tray snapshots cannot contain null entries.", "trays");
                if (!excluded.Contains(tray.RouteCode)) available.Add(tray);
            }
            return available;
        }

        public static LocalApproachRouteEvaluation CalculateWithLocalApproaches(IEnumerable<TraySegment> trays,
            IReadOnlyList<string> excludedRouteCodes, RoutePoint from, RoutePoint to, CableCategory category,
            RouteCollisionQuery collision, RoutingOptions options = null, ConstrainedRoutingLimits limits = null,
            LocalConnectorOptions localOptions = null, bool drillThroughWalls = false,
            CancellationToken cancellationToken = default(CancellationToken), bool interTrayManeuvers = false,
            IReadOnlyList<RouteCostMultiplier> routeCostMultipliers = null)
        {
            ValidateExcludedRouteCodes(excludedRouteCodes);
            var costs = LoadBalancedRouting.Snapshot(routeCostMultipliers);
            if ((excludedRouteCodes == null || excludedRouteCodes.Count == 0) && costs == null)
                return interTrayManeuvers
                    ? new RouteCalculator().CalculateConstrainedWithLocalApproachesAndInterTrayManeuvers(trays, from, to, category,
                        collision, options, limits, localOptions, drillThroughWalls, cancellationToken)
                    : new RouteCalculator().CalculateConstrainedWithLocalApproaches(trays, from, to, category,
                        collision, options, limits, localOptions, drillThroughWalls, cancellationToken);
            if (!drillThroughWalls && collision == null) throw new ArgumentNullException("collision");
            var frozen = RouteCalculator.ConstrainedOptions(options);
            var profile = (localOptions ?? new LocalConnectorOptions()).Snapshot();
            using (var budget = new ConstrainedBudget((limits ?? new ConstrainedRoutingLimits()).Snapshot(), cancellationToken,
                interTrayManeuvers && !drillThroughWalls))
            {
                budget.RouteCosts = costs;
                var context = new LocalConnectorContext(profile, budget);
                try
                {
                    int originalPieces;
                    var original = RouteCalculator.ConstrainedInputs(trays, category, budget, out originalPieces);
                    var excluded = new HashSet<string>(excludedRouteCodes ?? new string[0], StringComparer.Ordinal);
                    var available = new List<TraySegment>();
                    int availablePieces = 0;
                    foreach (var tray in original)
                    {
                        budget.Charge(1);
                        if (excluded.Contains(tray.RouteCode)) continue;
                        available.Add(tray);
                        availablePieces += tray.Points.Count - 1;
                    }
                    return new RouteCalculator().CalculateLocalPrepared(available, from, to, category, collision,
                        frozen, drillThroughWalls, context, availablePieces);
                }
                catch (ConstrainedLimitException error)
                { cancellationToken.ThrowIfCancellationRequested(); return RouteCalculator.LocalResult(budget.Failure(error.Reason), context); }
                catch (LocalConnectorLimitException error)
                { cancellationToken.ThrowIfCancellationRequested(); return RouteCalculator.LocalResult(budget.Failure(error.Reason), context); }
                catch (OperationCanceledException)
                { cancellationToken.ThrowIfCancellationRequested(); return RouteCalculator.LocalResult(budget.Failure("SEARCH_DEADLINE_EXCEEDED"), context); }
            }
        }

        public static LocalSecondaryEvaluation CalculateSecondaryWithLocalApproaches(IEnumerable<TraySegment> trays,
            IReadOnlyList<string> excludedRouteCodes, RoutePoint from, RoutePoint to, CableCategory category,
            RouteCollisionQuery collision, RoutingOptions options = null, ConstrainedRoutingLimits limits = null,
            LocalConnectorOptions localOptions = null, bool drillThroughWalls = false,
            CancellationToken cancellationToken = default(CancellationToken), bool finalReverse = false,
            bool interTrayManeuvers = false, IReadOnlyList<RouteCostMultiplier> routeCostMultipliers = null)
        {
            ValidateExcludedRouteCodes(excludedRouteCodes);
            var costs = LoadBalancedRouting.Snapshot(routeCostMultipliers);
            if ((excludedRouteCodes == null || excludedRouteCodes.Count == 0) && costs == null)
                return interTrayManeuvers
                    ? ConstrainedSecondaryRoute.CalculateWithLocalApproachesAndInterTrayManeuvers(trays, from, to, category,
                        collision, options, limits, localOptions, drillThroughWalls, cancellationToken, finalReverse)
                    : ConstrainedSecondaryRoute.CalculateWithLocalApproaches(trays, from, to, category,
                        collision, options, limits, localOptions, drillThroughWalls, cancellationToken, finalReverse);
            if (!drillThroughWalls && collision == null) throw new ArgumentNullException("collision");
            var frozen = RouteCalculator.ConstrainedOptions(options);
            var profile = (localOptions ?? new LocalConnectorOptions()).Snapshot();
            using (var budget = new ConstrainedBudget((limits ?? new ConstrainedRoutingLimits()).Snapshot(), cancellationToken,
                interTrayManeuvers && !drillThroughWalls))
            {
                budget.RouteCosts = costs;
                var context = new LocalConnectorContext(profile, budget);
                DirectSecondaryEvaluation distance = null;
                RouteCollisionObservation direct = null;
                string disposition = "unavailable";
                Func<LocalApproachRouteEvaluation, LocalSecondaryEvaluation> wrap = local => new LocalSecondaryEvaluation(
                    new ConstrainedSecondaryEvaluation(distance, direct, disposition, local.RouteEvaluation), local);
                try
                {
                    int originalPieces;
                    var original = RouteCalculator.ConstrainedInputs(trays, category, budget, out originalPieces);
                    budget.Charge(2L * originalPieces);
                    distance = DirectSecondaryRoute.Evaluate(original, from, to, category, frozen, budget.Token);
                    budget.Check();
                    disposition = distance.IsDirect ? "unavailable" : "not-qualified";
                    if (distance.IsDirect)
                    {
                        if (drillThroughWalls)
                        {
                            disposition = "bypassed";
                            return wrap(RouteCalculator.LocalResult(new ConstrainedRouteEvaluation(distance.DirectRoute,
                                ConstrainedRouteStatus.Bypassed, "DRILLING_BYPASS", true, budget), context));
                        }
                        budget.FinalChecks.Clear();
                        var directFrom = finalReverse && distance.DirectRoute.PathPoints.Count == 1 ? to : from;
                        direct = budget.FinalQuery(collision, directFrom, distance.DirectRoute.PathPoints.Count == 1 ? directFrom : to);
                        disposition = direct.Status == RouteCollisionStatus.Clear ? "clear"
                            : direct.Status == RouteCollisionStatus.Blocked ? "blocked" : "indeterminate";
                        if (direct.Status == RouteCollisionStatus.Clear)
                            return wrap(RouteCalculator.LocalResult(new ConstrainedRouteEvaluation(distance.DirectRoute,
                                ConstrainedRouteStatus.Clear, "DIRECT_SECONDARY_CLEAR", true, budget), context));
                    }
                    var excluded = new HashSet<string>(excludedRouteCodes ?? new string[0], StringComparer.Ordinal);
                    var available = new List<TraySegment>();
                    int availablePieces = 0;
                    foreach (var tray in original)
                    {
                        budget.Charge(1);
                        if (excluded.Contains(tray.RouteCode)) continue;
                        available.Add(tray);
                        availablePieces += tray.Points.Count - 1;
                    }
                    return wrap(new RouteCalculator().CalculateLocalPrepared(available, from, to, category, collision,
                        frozen, drillThroughWalls, context, availablePieces));
                }
                catch (ConstrainedLimitException error)
                { cancellationToken.ThrowIfCancellationRequested(); return wrap(RouteCalculator.LocalResult(budget.Failure(error.Reason), context)); }
                catch (LocalConnectorLimitException error)
                { cancellationToken.ThrowIfCancellationRequested(); return wrap(RouteCalculator.LocalResult(budget.Failure(error.Reason), context)); }
                catch (OperationCanceledException)
                { cancellationToken.ThrowIfCancellationRequested(); return wrap(RouteCalculator.LocalResult(budget.Failure("SEARCH_DEADLINE_EXCEEDED"), context)); }
            }
        }
    }
}
