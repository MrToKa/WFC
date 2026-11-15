using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Text.RegularExpressions;
using System.Threading;

namespace AddinRibbon.Routing
{
    public static class ManualOrderedRoute
    {
        public const string SchemaVersion = "pathfinder.manual-ordered-route.v1";
        public const int MaximumTextCharacters = 16384;
        public const int MaximumPhysicalCodes = 100;
        private static readonly Regex Token = new Regex(@"\A[A-Za-z0-9][A-Za-z0-9_.-]*\z", RegexOptions.CultureInvariant);

        /// <summary>Terminal SECONDARY denotes the checked equipment approaches.
        /// Reserve flags still use the ordinary distance threshold. Interior and
        /// adjacent repeated tokens cannot establish additional physical distance.</summary>
        public static IReadOnlyList<string> Parse(string text)
        {
            if (string.IsNullOrWhiteSpace(text) || text.Length > MaximumTextCharacters)
                throw new ArgumentException("MANUAL_ROUTE_TEXT_REQUIRED_OR_LIMIT");
            var tokens = new List<string>();
            foreach (var part in text.Trim().Split('/'))
            {
                var value = part.Trim(); if (value.Length == 0) continue;
                if (value.Length > 255 || !Token.IsMatch(value)) throw new ArgumentException("MANUAL_ROUTE_INVALID_TOKEN: " + value);
                tokens.Add(value.ToUpperInvariant());
                if (tokens.Count > MaximumPhysicalCodes + 2) throw new ArgumentException("MANUAL_ROUTE_CODE_LIMIT");
            }
            if (tokens.Count > 0 && tokens[0] == "SECONDARY") tokens.RemoveAt(0);
            if (tokens.Count > 0 && tokens[tokens.Count - 1] == "SECONDARY") tokens.RemoveAt(tokens.Count - 1);
            if (tokens.Count == 0) throw new ArgumentException("MANUAL_ROUTE_PHYSICAL_TRAY_REQUIRED");
            if (tokens.Count > MaximumPhysicalCodes) throw new ArgumentException("MANUAL_ROUTE_CODE_LIMIT");
            var codes = new List<string>();
            foreach (var token in tokens)
            {
                if (token == "SECONDARY") throw new ArgumentException("MANUAL_ROUTE_INTERIOR_SECONDARY_UNSUPPORTED");
                var code = "/" + token;
                if (codes.Count > 0 && codes[codes.Count - 1] == code) throw new ArgumentException("MANUAL_ROUTE_ADJACENT_REPEAT_AMBIGUOUS: " + code);
                codes.Add(code);
            }
            return new ReadOnlyCollection<string>(codes);
        }
    }

    public sealed partial class RouteCalculator
    {
        /// <summary>Full endpoint-to-endpoint cable geometry through the exact
        /// ordered physical codes. Never substitutes a free route or lookup length.</summary>
        public LocalApproachRouteEvaluation CalculateManualOrdered(IEnumerable<TraySegment> trays, string routeText,
            RoutePoint from, RoutePoint to, CableCategory category, RouteCollisionQuery collision,
            RoutingOptions options = null, ConstrainedRoutingLimits limits = null, LocalConnectorOptions localOptions = null,
            bool drillThroughWalls = false, CancellationToken cancellationToken = default(CancellationToken), bool interTrayManeuvers = false)
        {
            if (!drillThroughWalls && collision == null) throw new ArgumentNullException("collision");
            var frozen = ConstrainedOptions(options); var profile = (localOptions ?? new LocalConnectorOptions()).Snapshot();
            using (var budget = new ConstrainedBudget((limits ?? new ConstrainedRoutingLimits()).Snapshot(), cancellationToken, interTrayManeuvers && !drillThroughWalls))
            {
                var context = new LocalConnectorContext(profile, budget);
                try
                {
                    var codes = ManualOrderedRoute.Parse(routeText);
                    int pieces; var original = ConstrainedInputs(trays, category, budget, out pieces);
                    var wanted = new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase);
                    var eligible = original.FindAll(tray => wanted.Contains(tray.RouteCode));
                    foreach (var code in codes)
                        if (!eligible.Exists(tray => StringComparer.OrdinalIgnoreCase.Equals(code, tray.RouteCode)))
                            return LocalResult(new ConstrainedRouteEvaluation(RouteResult.Failure("Required manual route tray is unavailable: " + code),
                                ConstrainedRouteStatus.Blocked, "MANUAL_ROUTE_REQUIRED_TRAY_UNAVAILABLE", true, budget), context);
                    var fromCandidates = ManualCandidates(eligible, codes[0], from, collision, frozen, budget, !drillThroughWalls);
                    var toCandidates = ManualCandidates(eligible, codes[codes.Count - 1], to, collision, frozen, budget, !drillThroughWalls);
                    foreach (var pair in LocalPairs(fromCandidates, toCandidates))
                    {
                        if (context.StraightPairs >= context.Options.MaxStraightPairs) { context.StraightPhaseTruncated = true; break; }
                        budget.BeginPair(); context.StraightPairs++;
                        RouteConnectorPlan unusedFrom, unusedTo;
                        var route = ConstrainedPairGraph(eligible, from, to, pair.Item1, pair.Item2, collision, frozen, budget,
                            null, null, out unusedFrom, out unusedTo, drillThroughWalls, codes);
                        if (route != null) return LocalResult(new ConstrainedRouteEvaluation(route,
                            drillThroughWalls ? ConstrainedRouteStatus.Bypassed : ConstrainedRouteStatus.Clear,
                            drillThroughWalls ? "DRILLING_BYPASS" : "MANUAL_ORDERED_ROUTE_CLEAR", !budget.CandidatesTruncated, budget), context);
                    }
                    if (drillThroughWalls) return LocalResult(budget.Failure("MANUAL_ROUTE_DISCONNECTED"), context);
                    context.LocalPhaseUsed = true;
                    var fromOccupancy = context.Query(collision, from, from); var toOccupancy = context.Query(collision, to, to);
                    if (fromOccupancy.Status == RouteCollisionStatus.Blocked || toOccupancy.Status == RouteCollisionStatus.Blocked)
                        return LocalResult(new ConstrainedRouteEvaluation(RouteResult.Failure("A cable endpoint lies in registered barrier material."),
                            ConstrainedRouteStatus.Blocked, EndpointOccupancyReason(fromOccupancy.Status, toOccupancy.Status), true, budget), context);
                    if (fromOccupancy.Status != RouteCollisionStatus.Clear || toOccupancy.Status != RouteCollisionStatus.Clear)
                        return LocalResult(budget.Failure("ENDPOINT_OCCUPANCY_INDETERMINATE"), context);
                    var fromTargets = ManualCandidates(eligible, codes[0], from, collision, frozen, budget, false);
                    var toTargets = ManualCandidates(eligible, codes[codes.Count - 1], to, collision, frozen, budget, false);
                    var fromPlans = new Dictionary<Tuple<int, double, double, double, double>, RouteConnectorPlan>();
                    var toPlans = new Dictionary<Tuple<int, double, double, double, double>, RouteConnectorPlan>();
                    var localPairs = context.Options.UseNearestAnchoredSearch ? NearestAnchoredPairs(fromTargets, toTargets) : LocalPairs(fromTargets, toTargets);
                    foreach (var pair in localPairs)
                    {
                        budget.BeginPair(); var a = pair.Item1; var b = pair.Item2; RouteConnectorPlan usedFrom, usedTo;
                        var route = ConstrainedPairGraph(eligible, from, to, a, b, collision, frozen, budget,
                            target => LocalPlan(fromPlans, from, a, target, collision, context),
                            target => LocalPlan(toPlans, to, b, target, collision, context), out usedFrom, out usedTo, false, codes);
                        if (route != null) return LocalResult(new ConstrainedRouteEvaluation(route, ConstrainedRouteStatus.Clear,
                            "MANUAL_ORDERED_LOCAL_ROUTE_CLEAR", !budget.CandidatesTruncated && !context.StraightPhaseTruncated, budget), context, usedFrom, usedTo);
                    }
                    return LocalResult(budget.Failure(context.Limited ? "LOCAL_PLAN_OR_EDGE_LIMIT" : "MANUAL_ROUTE_CANDIDATE_DOMAIN_EXHAUSTED"), context);
                }
                catch (ConstrainedLimitException error) { cancellationToken.ThrowIfCancellationRequested(); return LocalResult(budget.Failure(error.Reason), context); }
                catch (LocalConnectorLimitException error) { cancellationToken.ThrowIfCancellationRequested(); return LocalResult(budget.Failure(error.Reason), context); }
                catch (OperationCanceledException) { cancellationToken.ThrowIfCancellationRequested(); return LocalResult(budget.Failure("SEARCH_DEADLINE_EXCEEDED"), context); }
            }
        }

        private static List<Projection> ManualCandidates(List<TraySegment> eligible, string code, RoutePoint target,
            RouteCollisionQuery collision, RoutingOptions options, ConstrainedBudget budget, bool requireClear)
        {
            var subset = eligible.FindAll(tray => StringComparer.OrdinalIgnoreCase.Equals(code, tray.RouteCode));
            var candidates = ConstrainedCandidates(subset, target, collision, options, budget,
                new Dictionary<Tuple<int, double>, RouteCollisionObservation>(), requireClear);
            for (int index = 0; index < candidates.Count; index++)
            { var projection = candidates[index]; projection.Segment = eligible.IndexOf(subset[projection.Segment]); candidates[index] = projection; }
            return candidates;
        }

        private static List<int> ManualOrderedPath(List<Node> nodes, List<TraySegment> trays, IReadOnlyList<string> codes,
            int first, int last, ConstrainedBudget budget, out PathCost cost)
        {
            cost = PathCost.Unreachable;
            if (first < 0 || last < 0 || !StringComparer.OrdinalIgnoreCase.Equals(trays[nodes[first].Segment].RouteCode, codes[0])
                || !StringComparer.OrdinalIgnoreCase.Equals(trays[nodes[last].Segment].RouteCode, codes[codes.Count - 1])) return null;
            var states = new List<ManualState> { new ManualState(first, 0, false) { Cost = new PathCost(0, 0, 0) } };
            var indices = new Dictionary<long, int> { { first * 2L, 0 } }; var queue = new MinHeap();
            queue.Add(new QueueEntry(0, states[0].Cost)); int goal = -1;
            while (queue.Count > 0)
            {
                budget.Charge(1); var entry = queue.RemoveFirst(); var state = states[entry.Node];
                if (state.Settled || entry.Cost.CompareTo(state.Cost) > 0) continue;
                state.Settled = true;
                if (state.Node == last && state.Step == codes.Count - 1) { goal = entry.Node; break; }
                foreach (var edge in nodes[state.Node].Edges)
                {
                    budget.Charge(1); var code = trays[nodes[edge.Node].Segment].RouteCode; int step = state.Step;
                    bool traversed = state.Traversed || nodes[state.Node].Segment == nodes[edge.Node].Segment && edge.Length > 0;
                    if (!StringComparer.OrdinalIgnoreCase.Equals(code, codes[step]))
                    {
                        if (step + 1 >= codes.Count || !StringComparer.OrdinalIgnoreCase.Equals(code, codes[step + 1])) continue;
                        // An intermediate tray must contribute actual physical
                        // body distance, not merely a zero-distance label hop.
                        if (step > 0 && !state.Traversed) continue;
                        step++; traversed = false;
                    }
                    long key = ((long)step * nodes.Count + edge.Node) * 2 + (traversed ? 1 : 0); int next;
                    if (!indices.TryGetValue(key, out next))
                    {
                        if (states.Count >= budget.Limits.MaxGraphNodes) throw new ConstrainedLimitException("MANUAL_ROUTE_STATE_LIMIT");
                        next = states.Count; states.Add(new ManualState(edge.Node, step, traversed)); indices.Add(key, next);
                    }
                    var candidate = state.Cost.Add(edge); var target = states[next];
                    if (target.Settled || !RoutePoint.IsFinite(candidate.PhysicalLength) || !RoutePoint.IsFinite(candidate.GapLength)
                        || candidate.CompareTo(target.Cost) >= 0) continue;
                    target.Cost = candidate; target.Previous = entry.Node; queue.Add(new QueueEntry(next, candidate));
                }
            }
            if (goal < 0) return null;
            cost = states[goal].Cost; var path = new List<int>();
            for (int state = goal; state >= 0; state = states[state].Previous) { budget.Charge(1); path.Add(states[state].Node); }
            path.Reverse(); return path;
        }

        private sealed class ManualState
        {
            internal readonly int Node, Step;
            internal readonly bool Traversed;
            internal int Previous = -1;
            internal PathCost Cost = PathCost.Unreachable;
            internal bool Settled;
            internal ManualState(int node, int step, bool traversed) { Node = node; Step = step; Traversed = traversed; }
        }
    }
}
