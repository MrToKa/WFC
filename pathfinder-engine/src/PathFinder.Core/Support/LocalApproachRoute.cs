using System;
using System.Collections.Generic;
using System.Threading;

namespace AddinRibbon.Routing
{
    public sealed partial class RouteCalculator
    {
        public LocalApproachRouteEvaluation CalculateConstrainedWithLocalApproaches(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
            CableCategory category, RouteCollisionQuery collision, RoutingOptions options = null, ConstrainedRoutingLimits limits = null,
            LocalConnectorOptions localOptions = null, bool drillThroughWalls = false, CancellationToken cancellationToken = default(CancellationToken))
        {
            return CalculateLocalEntry(trays, from, to, category, collision, options, limits, localOptions, drillThroughWalls, cancellationToken, false);
        }

        /// <summary>The explicit bounded opening-maneuver strategy. Existing clear
        /// graph is a strict-cost upper bound; only blocked cross-tray chords may
        /// use the fixed original-geometry checked improvement domain.</summary>
        public LocalApproachRouteEvaluation CalculateConstrainedWithLocalApproachesAndInterTrayManeuvers(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
            CableCategory category, RouteCollisionQuery collision, RoutingOptions options = null, ConstrainedRoutingLimits limits = null,
            LocalConnectorOptions localOptions = null, bool drillThroughWalls = false, CancellationToken cancellationToken = default(CancellationToken))
        {
            return CalculateLocalEntry(trays, from, to, category, collision, options, limits, localOptions, drillThroughWalls, cancellationToken, true);
        }

        private LocalApproachRouteEvaluation CalculateLocalEntry(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
            CableCategory category, RouteCollisionQuery collision, RoutingOptions options, ConstrainedRoutingLimits limits,
            LocalConnectorOptions localOptions, bool drillThroughWalls, CancellationToken cancellationToken, bool interTrayManeuvers)
        {
            if (!drillThroughWalls && collision == null) throw new ArgumentNullException("collision");
            var frozen = ConstrainedOptions(options); var profile = (localOptions ?? new LocalConnectorOptions()).Snapshot();
            using (var budget = new ConstrainedBudget((limits ?? new ConstrainedRoutingLimits()).Snapshot(), cancellationToken, interTrayManeuvers && !drillThroughWalls))
            {
                var context = new LocalConnectorContext(profile, budget);
                try
                {
                    int pieces; var eligible = ConstrainedInputs(trays, category, budget, out pieces);
                    return CalculateLocalPrepared(eligible, from, to, category, collision, frozen, drillThroughWalls, context, pieces);
                }
                catch (ConstrainedLimitException error) { cancellationToken.ThrowIfCancellationRequested(); return LocalResult(budget.Failure(error.Reason), context); }
                catch (LocalConnectorLimitException error) { cancellationToken.ThrowIfCancellationRequested(); return LocalResult(budget.Failure(error.Reason), context); }
                catch (OperationCanceledException) { cancellationToken.ThrowIfCancellationRequested(); return LocalResult(budget.Failure("SEARCH_DEADLINE_EXCEEDED"), context); }
            }
        }

        internal static LocalApproachRouteEvaluation LocalResult(ConstrainedRouteEvaluation route, LocalConnectorContext context,
            RouteConnectorPlan from = null, RouteConnectorPlan to = null)
        { return new LocalApproachRouteEvaluation(route, from, to, context, context.StraightPairs, context.LocalPhaseUsed, context.StraightPhaseTruncated); }

        internal LocalApproachRouteEvaluation CalculateLocalPrepared(List<TraySegment> eligible, RoutePoint from, RoutePoint to, CableCategory category,
            RouteCollisionQuery collision, RoutingOptions options, bool drill, LocalConnectorContext context, int pieceCount)
        {
            var budget = context.Budget;
            if (drill || eligible.Count == 0)
                return LocalResult(CalculateConstrainedPrepared(eligible, from, to, category, collision, options, drill, budget, pieceCount), context);
            budget.Charge(2L * pieceCount);
            Projection first = FindNearest(eligible, from, budget.Token), last = FindNearest(eligible, to, budget.Token);
            if (!RoutePoint.IsFinite(first.Distance) || !RoutePoint.IsFinite(last.Distance))
                return LocalResult(budget.Failure("NONFINITE_ENDPOINT_DISTANCE"), context);
            if (options.PreferVerticalApproach)
            {
                budget.Charge(2L * pieceCount);
                first = FindVerticalApproach(eligible, from, first, options.ConnectionToleranceMeters, budget.Token);
                last = FindVerticalApproach(eligible, to, last, options.ConnectionToleranceMeters, budget.Token);
            }
            var fromChecks = new Dictionary<Tuple<int, double>, RouteCollisionObservation>();
            var toChecks = new Dictionary<Tuple<int, double>, RouteCollisionObservation>();
            RouteResult route; int pairBase = budget.Pairs;
            try { route = ConstrainedPair(eligible, from, to, first, last, collision, options, budget, fromChecks, toChecks); }
            finally { context.StraightPairs = budget.Pairs - pairBase; }
            if (route != null) return LocalResult(new ConstrainedRouteEvaluation(route, ConstrainedRouteStatus.Clear, "LEGACY_PAIR_CLEAR", true, budget), context);
            var fromClear = ConstrainedCandidates(eligible, from, collision, options, budget, fromChecks);
            var toClear = ConstrainedCandidates(eligible, to, collision, options, budget, toChecks);
            foreach (var pair in LocalPairs(fromClear, toClear))
            {
                if (SameProjection(pair.Item1, first) && SameProjection(pair.Item2, last)) continue;
                if (context.StraightPairs >= context.Options.MaxStraightPairs) { context.StraightPhaseTruncated = true; break; }
                try { route = ConstrainedPair(eligible, from, to, pair.Item1, pair.Item2, collision, options, budget, fromChecks, toChecks); }
                finally { context.StraightPairs = budget.Pairs - pairBase; }
                if (route != null) return LocalResult(new ConstrainedRouteEvaluation(route, ConstrainedRouteStatus.Clear,
                    "ACCESSIBLE_STRAIGHT_PAIR_CLEAR", !budget.CandidatesTruncated, budget), context);
            }
            context.LocalPhaseUsed = true;
            // Only exact occupancy can establish this conclusive endpoint refusal.
            var fromOccupancy = context.Query(collision, from, from); var toOccupancy = context.Query(collision, to, to);
            if (fromOccupancy.Status == RouteCollisionStatus.Blocked || toOccupancy.Status == RouteCollisionStatus.Blocked)
                return LocalResult(new ConstrainedRouteEvaluation(RouteResult.Failure("A cable endpoint lies in registered barrier material."),
                    ConstrainedRouteStatus.Blocked, "ENDPOINT_IN_BARRIER", true, budget), context);
            if (fromOccupancy.Status != RouteCollisionStatus.Clear || toOccupancy.Status != RouteCollisionStatus.Clear)
                return LocalResult(new ConstrainedRouteEvaluation(RouteResult.Failure("Cable endpoint occupancy could not be verified."),
                    ConstrainedRouteStatus.Indeterminate, "ENDPOINT_OCCUPANCY_INDETERMINATE", false, budget), context);
            var fromTargets = ConstrainedCandidates(eligible, from, collision, options, budget, fromChecks, false);
            var toTargets = ConstrainedCandidates(eligible, to, collision, options, budget, toChecks, false);
            var fromPlans = new Dictionary<Tuple<int, double, double, double, double>, RouteConnectorPlan>();
            var toPlans = new Dictionary<Tuple<int, double, double, double, double>, RouteConnectorPlan>();
            var localPairs = context.Options.UseNearestAnchoredSearch ? NearestAnchoredPairs(fromTargets, toTargets) : LocalPairs(fromTargets, toTargets);
            foreach (var pair in localPairs)
            {
                budget.BeginPair(); var a = pair.Item1; var b = pair.Item2; RouteConnectorPlan usedFrom, usedTo;
                route = ConstrainedPairGraph(eligible, from, to, a, b, collision, options, budget,
                    target => LocalPlan(fromPlans, from, a, target, collision, context),
                    target => LocalPlan(toPlans, to, b, target, collision, context), out usedFrom, out usedTo);
                if (route != null) return LocalResult(new ConstrainedRouteEvaluation(route, ConstrainedRouteStatus.Clear,
                    "LOCAL_APPROACH_PAIR_CLEAR", !budget.CandidatesTruncated && !context.StraightPhaseTruncated, budget), context, usedFrom, usedTo);
            }
            return LocalResult(budget.Failure(context.Limited ? "LOCAL_PLAN_OR_EDGE_LIMIT" : "LOCAL_CANDIDATE_DOMAIN_EXHAUSTED"), context);
        }

        private static IEnumerable<Tuple<Projection, Projection>> LocalPairs(List<Projection> first, List<Projection> last)
        {
            for (int sum = 0; sum <= first.Count + last.Count - 2; sum++)
                for (int i = 0; i < first.Count; i++) { int j = sum - i; if (j >= 0 && j < last.Count) yield return Tuple.Create(first[i], last[j]); }
        }
        private static IEnumerable<Tuple<Projection, Projection>> NearestAnchoredPairs(List<Projection> first, List<Projection> last)
        {
            foreach (var ranks in NearestAnchoredPairRanks(first.Count, last.Count))
                yield return Tuple.Create(first[ranks.Item1], last[ranks.Item2]);
        }
        private static IEnumerable<Tuple<int, int>> NearestAnchoredPairRanks(int firstCount, int lastCount)
        {
            if (firstCount == 0 || lastCount == 0) yield break;
            // Cover every retained alternative at either end against the other
            // nearest candidate before interior rank-sum pairs can consume the
            // shared pair budget. This changes order only, never graph topology
            // or the retained candidate domain, and claims no global optimum.
            yield return Tuple.Create(0, 0);
            for (int rank = 1; rank < Math.Max(firstCount, lastCount); rank++)
            {
                if (rank < lastCount) yield return Tuple.Create(0, rank);
                if (rank < firstCount) yield return Tuple.Create(rank, 0);
            }
            for (int sum = 2; sum <= firstCount + lastCount - 2; sum++)
                for (int i = 1; i < firstCount; i++)
                {
                    int j = sum - i;
                    if (j > 0 && j < lastCount) yield return Tuple.Create(i, j);
                }
        }
        private static RouteConnectorPlan LocalPlan(Dictionary<Tuple<int, double, double, double, double>, RouteConnectorPlan> cache,
            RoutePoint endpoint, Projection projection, RoutePoint actualStation, RouteCollisionQuery collision, LocalConnectorContext context)
        {
            var key = Tuple.Create(projection.Segment, projection.Along, actualStation.X, actualStation.Y, actualStation.Z); RouteConnectorPlan plan;
            if (!cache.TryGetValue(key, out plan))
            { plan = LocalConnectorPlanner.PlanPrepared(endpoint, actualStation, collision, context.Options.Domain(endpoint, actualStation), context,
                context.Options.UseNearestAnchoredSearch); cache.Add(key, plan); }
            return plan;
        }
    }

    public static partial class ConstrainedSecondaryRoute
    {
        public static LocalSecondaryEvaluation CalculateWithLocalApproaches(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
            CableCategory category, RouteCollisionQuery collision, RoutingOptions options = null, ConstrainedRoutingLimits limits = null,
            LocalConnectorOptions localOptions = null, bool drillThroughWalls = false, CancellationToken cancellationToken = default(CancellationToken),
            bool finalReverse = false)
        {
            return CalculateLocalEntry(trays, from, to, category, collision, options, limits, localOptions, drillThroughWalls, cancellationToken, finalReverse, false);
        }

        public static LocalSecondaryEvaluation CalculateWithLocalApproachesAndInterTrayManeuvers(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
            CableCategory category, RouteCollisionQuery collision, RoutingOptions options = null, ConstrainedRoutingLimits limits = null,
            LocalConnectorOptions localOptions = null, bool drillThroughWalls = false, CancellationToken cancellationToken = default(CancellationToken),
            bool finalReverse = false)
        {
            return CalculateLocalEntry(trays, from, to, category, collision, options, limits, localOptions, drillThroughWalls, cancellationToken, finalReverse, true);
        }

        private static LocalSecondaryEvaluation CalculateLocalEntry(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
            CableCategory category, RouteCollisionQuery collision, RoutingOptions options, ConstrainedRoutingLimits limits,
            LocalConnectorOptions localOptions, bool drillThroughWalls, CancellationToken cancellationToken, bool finalReverse, bool interTrayManeuvers)
        {
            if (!drillThroughWalls && collision == null) throw new ArgumentNullException("collision");
            var frozen = RouteCalculator.ConstrainedOptions(options); var profile = (localOptions ?? new LocalConnectorOptions()).Snapshot();
            using (var budget = new ConstrainedBudget((limits ?? new ConstrainedRoutingLimits()).Snapshot(), cancellationToken, interTrayManeuvers && !drillThroughWalls))
            {
                var context = new LocalConnectorContext(profile, budget);
                DirectSecondaryEvaluation distance = null; RouteCollisionObservation direct = null; string disposition = "unavailable";
                Func<LocalApproachRouteEvaluation, LocalSecondaryEvaluation> wrap = local => new LocalSecondaryEvaluation(
                    new ConstrainedSecondaryEvaluation(distance, direct, disposition, local.RouteEvaluation), local);
                try
                {
                    int pieces; var eligible = RouteCalculator.ConstrainedInputs(trays, category, budget, out pieces);
                    budget.Charge(2L * pieces);
                    distance = DirectSecondaryRoute.Evaluate(eligible, from, to, category, frozen, budget.Token); budget.Check();
                    disposition = distance.IsDirect ? "unavailable" : "not-qualified";
                    if (distance.IsDirect)
                    {
                        if (drillThroughWalls)
                        {
                            disposition = "bypassed";
                            return wrap(RouteCalculator.LocalResult(new ConstrainedRouteEvaluation(distance.DirectRoute, ConstrainedRouteStatus.Bypassed,
                                "DRILLING_BYPASS", true, budget), context));
                        }
                        budget.FinalChecks.Clear();
                        // The runner's legacy reverse operation recreates a
                        // singleton direct From point at To even if a tiny
                        // nonzero delta underflows to binary64 zero distance.
                        // Certify that actual output point within this budget.
                        var directFrom = finalReverse && distance.DirectRoute.PathPoints.Count == 1 ? to : from;
                        direct = budget.FinalQuery(collision, directFrom, distance.DirectRoute.PathPoints.Count == 1 ? directFrom : to);
                        disposition = direct.Status == RouteCollisionStatus.Clear ? "clear" : direct.Status == RouteCollisionStatus.Blocked ? "blocked" : "indeterminate";
                        if (direct.Status == RouteCollisionStatus.Clear)
                            return wrap(RouteCalculator.LocalResult(new ConstrainedRouteEvaluation(distance.DirectRoute, ConstrainedRouteStatus.Clear,
                                "DIRECT_SECONDARY_CLEAR", true, budget), context));
                    }
                    return wrap(new RouteCalculator().CalculateLocalPrepared(eligible, from, to, category, collision, frozen, drillThroughWalls, context, pieces));
                }
                catch (ConstrainedLimitException error) { cancellationToken.ThrowIfCancellationRequested(); return wrap(RouteCalculator.LocalResult(budget.Failure(error.Reason), context)); }
                catch (LocalConnectorLimitException error) { cancellationToken.ThrowIfCancellationRequested(); return wrap(RouteCalculator.LocalResult(budget.Failure(error.Reason), context)); }
                catch (OperationCanceledException) { cancellationToken.ThrowIfCancellationRequested(); return wrap(RouteCalculator.LocalResult(budget.Failure("SEARCH_DEADLINE_EXCEEDED"), context)); }
            }
        }
    }
}
