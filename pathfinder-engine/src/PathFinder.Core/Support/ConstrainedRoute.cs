using System;
using System.Collections.Generic;
using System.Threading;

namespace AddinRibbon.Routing
{
    public sealed partial class RouteCalculator
    {
        /// <summary>Check straight endpoint approaches, every actual graph connector
        /// and the final exact polyline. Offset-opening detours are outside this
        /// bounded candidate domain. No collision kernel or viewer dependency.</summary>
        public ConstrainedRouteEvaluation CalculateConstrained(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
            CableCategory category, RouteCollisionQuery collision, RoutingOptions options = null,
            ConstrainedRoutingLimits limits = null, bool drillThroughWalls = false,
            CancellationToken cancellationToken = default(CancellationToken))
        {
            if (!drillThroughWalls && collision == null) throw new ArgumentNullException("collision");
            var frozenOptions = ConstrainedOptions(options);
            using (var budget = new ConstrainedBudget((limits ?? new ConstrainedRoutingLimits()).Snapshot(), cancellationToken))
            {
                try
                {
                    int pieces; var eligible = ConstrainedInputs(trays, category, budget, out pieces);
                    return CalculateConstrainedPrepared(eligible, from, to, category, collision, frozenOptions, drillThroughWalls, budget, pieces);
                }
                catch (ConstrainedLimitException error) { cancellationToken.ThrowIfCancellationRequested(); return budget.Failure(error.Reason); }
                catch (OperationCanceledException) { cancellationToken.ThrowIfCancellationRequested(); return budget.Failure("SEARCH_DEADLINE_EXCEEDED"); }
            }
        }

        internal static RoutingOptions ConstrainedOptions(RoutingOptions options)
        {
            options = options ?? new RoutingOptions(); options.Validate();
            return new RoutingOptions { ConnectionToleranceMeters = options.ConnectionToleranceMeters,
                SampleSpacingMeters = options.SampleSpacingMeters, SecondaryDistanceMeters = options.SecondaryDistanceMeters,
                PreferVerticalApproach = options.PreferVerticalApproach, MaxGraphNodes = options.MaxGraphNodes,
                MaxGraphConnections = options.MaxGraphConnections };
        }

        internal static List<TraySegment> ConstrainedInputs(IEnumerable<TraySegment> trays, CableCategory category,
            ConstrainedBudget budget, out int pieceCount)
        {
            if (trays == null) throw new ArgumentNullException("trays");
            if (category != CableCategory.LV && category != CableCategory.Control)
                throw new ArgumentException("Constrained routing requires LV or Control.", "category");
            var eligible = new List<TraySegment>(); var identifiers = new HashSet<string>(StringComparer.Ordinal);
            int count = 0; pieceCount = 0;
            foreach (var tray in trays)
            {
                budget.Charge(1); if (++count > budget.Limits.MaxInputTrays) throw new ConstrainedLimitException("INPUT_TRAY_LIMIT");
                if (tray == null) throw new ArgumentException("Tray snapshots cannot contain null entries.", "trays");
                if ((tray.AllowedCategories & category) != category) continue;
                if (!identifiers.Add(tray.Id)) throw new ArgumentException("Duplicate tray identifier: " + tray.Id, "trays");
                if (tray.Id.Length > 256) throw new ConstrainedLimitException("INPUT_IDENTITY_LIMIT");
                if (tray.Points.Count - 1 > budget.Limits.MaxInputPieces - pieceCount) throw new ConstrainedLimitException("INPUT_PIECE_LIMIT");
                pieceCount += tray.Points.Count - 1; budget.Charge(tray.Points.Count - 1); eligible.Add(tray);
            }
            eligible.Sort((left, right) => StringComparer.Ordinal.Compare(left.Id, right.Id)); budget.Check(); return eligible;
        }

        internal ConstrainedRouteEvaluation CalculateConstrainedPrepared(List<TraySegment> eligible, RoutePoint from, RoutePoint to,
            CableCategory category, RouteCollisionQuery collision, RoutingOptions options, bool drill,
            ConstrainedBudget budget, int pieceCount)
        {
            budget.Check();
            if (drill)
            {
                // Exact pinned strategy, with the same admitted category/options.
                var old = Calculate(eligible, from, to, category, options, budget.Token); budget.Check();
                return new ConstrainedRouteEvaluation(old, ConstrainedRouteStatus.Bypassed,
                    old.Success ? "DRILLING_BYPASS" : "LEGACY_ROUTING_FAILED", old.Success, budget);
            }
            if (eligible.Count == 0) return ConstrainedNoRoute(budget, "NO_ELIGIBLE_TRAYS");
            budget.Charge(2L * pieceCount);
            Projection first = FindNearest(eligible, from, budget.Token), last = FindNearest(eligible, to, budget.Token);
            if (!RoutePoint.IsFinite(first.Distance) || !RoutePoint.IsFinite(last.Distance))
                return new ConstrainedRouteEvaluation(RouteResult.Failure("The endpoint distances are outside the supported coordinate range."),
                    ConstrainedRouteStatus.Indeterminate, "NONFINITE_ENDPOINT_DISTANCE", false, budget);
            if (options.PreferVerticalApproach)
            {
                budget.Charge(2L * pieceCount);
                first = FindVerticalApproach(eligible, from, first, options.ConnectionToleranceMeters, budget.Token);
                last = FindVerticalApproach(eligible, to, last, options.ConnectionToleranceMeters, budget.Token);
            }
            var fromChecks = new Dictionary<Tuple<int, double>, RouteCollisionObservation>();
            var toChecks = new Dictionary<Tuple<int, double>, RouteCollisionObservation>();
            // This pair, its construction order and every remaining Edge are the
            // exact legacy choice. Other candidates never enter its initial graph.
            var result = ConstrainedPair(eligible, from, to, first, last, collision, options, budget, fromChecks, toChecks);
            if (result != null) return new ConstrainedRouteEvaluation(result, ConstrainedRouteStatus.Clear, "LEGACY_PAIR_CLEAR", true, budget);

            var fromCandidates = ConstrainedCandidates(eligible, from, collision, options, budget, fromChecks);
            var toCandidates = ConstrainedCandidates(eligible, to, collision, options, budget, toChecks);
            // Rank-sum visits both endpoint alternatives fairly; remaining ties
            // use From rank and then To rank. No global optimality claim.
            for (int sum = 0; sum <= fromCandidates.Count + toCandidates.Count - 2; sum++)
                for (int i = 0; i < fromCandidates.Count; i++)
                {
                    int j = sum - i; if (j < 0 || j >= toCandidates.Count) continue;
                    var a = fromCandidates[i]; var b = toCandidates[j];
                    if (SameProjection(a, first) && SameProjection(b, last)) continue;
                    result = ConstrainedPair(eligible, from, to, a, b, collision, options, budget, fromChecks, toChecks);
                    if (result != null) return new ConstrainedRouteEvaluation(result, ConstrainedRouteStatus.Clear,
                        "ACCESSIBLE_CANDIDATE_PAIR_CLEAR", !budget.CandidatesTruncated, budget);
                }
            if (budget.CandidatesTruncated) return budget.Failure("CANDIDATE_DOMAIN_TRUNCATED");
            return ConstrainedNoRoute(budget, "NO_CLEAR_CONNECTED_CANDIDATE_PAIR");
        }

        private static ConstrainedRouteEvaluation ConstrainedNoRoute(ConstrainedBudget budget, string reason)
        {
            bool uncertain = budget.SawIndeterminate;
            return new ConstrainedRouteEvaluation(RouteResult.Failure("No verified route was found in the straight-approach candidate domain. " + reason + "."),
                uncertain ? ConstrainedRouteStatus.Indeterminate : ConstrainedRouteStatus.Blocked, reason, !uncertain, budget);
        }
        private static bool SameProjection(Projection a, Projection b) { return a.Segment == b.Segment && a.Along == b.Along; }
        private static RouteCollisionObservation ConstrainedApproach(RoutePoint endpoint, Projection projection, RouteCollisionQuery collision,
            ConstrainedBudget budget, Dictionary<Tuple<int, double>, RouteCollisionObservation> checkedPoints)
        {
            var key = Tuple.Create(projection.Segment, projection.Along); RouteCollisionObservation result;
            if (!checkedPoints.TryGetValue(key, out result)) { result = budget.Query(collision, endpoint, projection.Point); checkedPoints.Add(key, result); }
            return result;
        }

        private static List<Projection> ConstrainedCandidates(List<TraySegment> trays, RoutePoint target, RouteCollisionQuery collision,
            RoutingOptions options, ConstrainedBudget budget, Dictionary<Tuple<int, double>, RouteCollisionObservation> checkedPoints, bool requireClear = true)
        {
            var seen = new HashSet<Tuple<int, double>>(); var clear = new List<Projection>();
            for (int segment = 0; segment < trays.Count; segment++)
            {
                double along = 0; var points = trays[segment].Points;
                for (int part = 0; part < points.Count - 1; part++)
                {
                    budget.Charge(1); var a = points[part]; var b = points[part + 1];
                    double x = b.X - a.X, y = b.Y - a.Y, z = b.Z - a.Z, squared = x * x + y * y + z * z;
                    double length = Math.Sqrt(squared);
                    if (!RoutePoint.IsFinite(length)) throw new ConstrainedLimitException("NONFINITE_TRAY_LENGTH");
                    double fraction = squared == 0 ? 0 : Clamp(((target.X - a.X) * x + (target.Y - a.Y) * y + (target.Z - a.Z) * z) / squared);
                    ConstrainedAddCandidate(clear, seen, checkedPoints, target, segment, part, along, length, a, b, fraction, collision, budget, requireClear);
                    // Once the exact legacy pair fails, both straight candidate
                    // families remain discoverable. The preference flag changes
                    // only accessible-window ranking, never their availability.
                    double horizontal = x * x + y * y;
                    fraction = horizontal == 0 ? (z == 0 ? 0 : Clamp((target.Z - a.Z) / z))
                        : Clamp(((target.X - a.X) * x + (target.Y - a.Y) * y) / horizontal);
                    ConstrainedAddCandidate(clear, seen, checkedPoints, target, segment, part, along, length, a, b, fraction, collision, budget, requireClear);
                    along += length;
                    if (!RoutePoint.IsFinite(along)) throw new ConstrainedLimitException("NONFINITE_TRAY_LENGTH");
                }
            }
            if (clear.Count == 0) return clear;
            double nearest = double.PositiveInfinity; foreach (var candidate in clear) if (candidate.Distance < nearest) nearest = candidate.Distance;
            double window = nearest + options.ConnectionToleranceMeters; if (!RoutePoint.IsFinite(window)) window = double.MaxValue;
            int logarithm = 1; for (int n = clear.Count; n > 1; n >>= 1) logarithm++;
            budget.Charge((long)clear.Count * logarithm);
            clear.Sort((a, b) => {
                if (options.PreferVerticalApproach)
                {
                    bool aNear = a.Distance <= window, bNear = b.Distance <= window;
                    if (aNear != bNear) return aNear ? -1 : 1;
                    if (aNear) { int horizontal = HorizontalDistance(a.Point, target).CompareTo(HorizontalDistance(b.Point, target)); if (horizontal != 0) return horizontal; }
                }
                int distance = a.Distance.CompareTo(b.Distance); if (distance != 0) return distance;
                int segment = a.Segment.CompareTo(b.Segment); if (segment != 0) return segment;
                int station = a.Along.CompareTo(b.Along); return station != 0 ? station : a.Part.CompareTo(b.Part);
            }); budget.Check();
            if (clear.Count > budget.Limits.MaxCandidatesPerEnd)
            { budget.CandidatesTruncated = true; clear.RemoveRange(budget.Limits.MaxCandidatesPerEnd, clear.Count - budget.Limits.MaxCandidatesPerEnd); }
            return clear;
        }

        private static void ConstrainedAddCandidate(List<Projection> clear, HashSet<Tuple<int, double>> seen,
            Dictionary<Tuple<int, double>, RouteCollisionObservation> checkedPoints, RoutePoint target,
            int segment, int part, double along, double length, RoutePoint a, RoutePoint b, double fraction,
            RouteCollisionQuery collision, ConstrainedBudget budget, bool requireClear)
        {
            var point = RoutePoint.Interpolate(a, b, fraction); double distance = point.DistanceTo(target), station = along + length * fraction;
            if (!RoutePoint.IsFinite(distance) || !RoutePoint.IsFinite(station)) throw new ConstrainedLimitException("NONFINITE_CANDIDATE");
            if (!seen.Add(Tuple.Create(segment, station))) return;
            var projection = new Projection { Segment = segment, Part = part, Along = station, Point = point, Distance = distance };
            if (!requireClear || ConstrainedApproach(target, projection, collision, budget, checkedPoints).Status == RouteCollisionStatus.Clear) clear.Add(projection);
        }

        private static RouteResult ConstrainedPair(List<TraySegment> eligible, RoutePoint from, RoutePoint to, Projection first, Projection last,
            RouteCollisionQuery collision, RoutingOptions options, ConstrainedBudget budget,
            Dictionary<Tuple<int, double>, RouteCollisionObservation> fromChecks,
            Dictionary<Tuple<int, double>, RouteCollisionObservation> toChecks)
        {
            budget.BeginPair();
            var firstCheck = ConstrainedApproach(from, first, collision, budget, fromChecks);
            var lastCheck = ConstrainedApproach(to, last, collision, budget, toChecks);
            if (firstCheck.Status != RouteCollisionStatus.Clear || lastCheck.Status != RouteCollisionStatus.Clear) return null;
            RouteConnectorPlan unusedFrom, unusedTo;
            return ConstrainedPairGraph(eligible, from, to, first, last, collision, options, budget, null, null, out unusedFrom, out unusedTo);
        }

        private static RouteResult ConstrainedPairGraph(List<TraySegment> eligible, RoutePoint from, RoutePoint to, Projection first, Projection last,
            RouteCollisionQuery collision, RoutingOptions options, ConstrainedBudget budget,
            Func<RoutePoint, RouteConnectorPlan> fromPlanner, Func<RoutePoint, RouteConnectorPlan> toPlanner,
            out RouteConnectorPlan fromPlan, out RouteConnectorPlan toPlan)
        {
            fromPlan = null; toPlan = null;
            int maxNodes = Math.Min(options.MaxGraphNodes, budget.Limits.MaxGraphNodes);
            int maxConnections = Math.Min(options.MaxGraphConnections, budget.Limits.MaxGraphConnections);
            var nodes = new List<Node>(); var pieces = new List<Piece>(); var segmentNodes = new List<List<int>>();
            int firstNode = -1, lastNode = -1;
            // Deliberately the pinned graph construction arithmetic/order. Each
            // candidate pair gets a fresh graph and its own original initialNodes.
            for (int segmentIndex = 0; segmentIndex < eligible.Count; segmentIndex++)
            {
                budget.Charge(1); var tray = eligible[segmentIndex]; int pieceOffset = pieces.Count;
                var vertices = new List<Vertex>(); var orderedNodes = new List<int>(); segmentNodes.Add(orderedNodes); double along = 0;
                for (int part = 0; part < tray.Points.Count - 1; part++)
                {
                    budget.Charge(1); var start = tray.Points[part]; var end = tray.Points[part + 1]; double length = start.DistanceTo(end);
                    if (!RoutePoint.IsFinite(length)) throw new ConstrainedLimitException("NONFINITE_TRAY_LENGTH");
                    if (length > 0) pieces.Add(new Piece(segmentIndex, start, end, along, length,
                        tray.ConnectionsAtEndsOnly, pieces.Count == pieceOffset, tray.VerifiedPorts, tray.ConnectionSurfaces));
                    vertices.Add(new Vertex(along, start)); along += length;
                }
                if (pieces.Count == pieceOffset) pieces.Add(new Piece(segmentIndex, tray.Points[0], tray.Points[0], 0, 0,
                    tray.ConnectionsAtEndsOnly, true, tray.VerifiedPorts, tray.ConnectionSurfaces));
                var lastPiece = pieces[pieces.Count - 1]; lastPiece.SetEndPort(); pieces[pieces.Count - 1] = lastPiece;
                vertices.Add(new Vertex(along, tray.Points[tray.Points.Count - 1]));
                if (first.Segment == segmentIndex) vertices.Add(new Vertex(first.Along, first.Point));
                if (last.Segment == segmentIndex) vertices.Add(new Vertex(last.Along, last.Point));
                vertices.Sort((left, right) => left.Along.CompareTo(right.Along));
                int previous = -1; double previousAlong = double.NaN;
                foreach (var vertex in vertices)
                {
                    budget.Charge(1); int index;
                    if (previous >= 0 && vertex.Along == previousAlong) index = previous;
                    else
                    {
                        if (nodes.Count >= maxNodes) throw new ConstrainedLimitException("GRAPH_NODE_LIMIT");
                        index = nodes.Count; nodes.Add(new Node(vertex.Point, segmentIndex, vertex.Along)); orderedNodes.Add(index);
                        previous = index; previousAlong = vertex.Along;
                    }
                    if (first.Segment == segmentIndex && vertex.Along == first.Along) firstNode = index;
                    if (last.Segment == segmentIndex && vertex.Along == last.Along) lastNode = index;
                }
            }
            GraphLimit limit;
            if (!AddNeighbourConnections(nodes, pieces, segmentNodes, options.ConnectionToleranceMeters, maxNodes, maxConnections, budget.Token, out limit))
                throw new ConstrainedLimitException(limit == GraphLimit.Connections ? "GRAPH_CONNECTION_LIMIT" : limit == GraphLimit.Candidates ? "GRAPH_CANDIDATE_LIMIT" : "GRAPH_NODE_LIMIT");
            budget.Check();
            if (fromPlanner != null && toPlanner != null)
            {
                // Plan against the actual stored graph stations. Equal-Along
                // legacy vertices can select a different floating representation
                // from an interpolated projection; do not add an unmeasured join.
                fromPlan = fromPlanner(nodes[firstNode].Point); toPlan = toPlanner(nodes[lastNode].Point);
                if (fromPlan.Status != LocalConnectorStatus.Clear || toPlan.Status != LocalConnectorStatus.Clear) return null;
            }
            var checkedEdges = new Dictionary<long, RouteCollisionStatus>(); long directedEdges = 0, blockedCount = 0;
            var blocked = budget.InterTray == null ? null : new Dictionary<int, List<BlockedInterTrayEdge>>();
            for (int index = 0; index < nodes.Count; index++)
            {
                var edges = nodes[index].Edges; int retained = 0;
                for (int read = 0; read < edges.Count; read++)
                {
                    budget.Charge(1); var edge = edges[read]; directedEdges++;
                    long key = ((long)Math.Min(index, edge.Node) << 32) | (uint)Math.Max(index, edge.Node); RouteCollisionStatus status;
                    if (!checkedEdges.TryGetValue(key, out status))
                    {
                        status = budget.Query(collision, nodes[index].Point, nodes[edge.Node].Point).Status;
                        checkedEdges.Add(key, status);
                    }
                    // Retain the existing Edge struct verbatim, including its
                    // Length, GapDistance, integer GapRank and adjacency ordering.
                    if (status == RouteCollisionStatus.Clear) edges[retained++] = edge;
                    else if (blocked != null && status == RouteCollisionStatus.Blocked && nodes[index].Segment != nodes[edge.Node].Segment)
                    {
                        if (++blockedCount > 2L * maxConnections) throw new ConstrainedLimitException("INTER_TRAY_DESCRIPTOR_LIMIT");
                        List<BlockedInterTrayEdge> list;
                        if (!blocked.TryGetValue(index, out list)) { list = new List<BlockedInterTrayEdge>(); blocked.Add(index, list); }
                        list.Add(new BlockedInterTrayEdge(edge, retained));
                    }
                }
                if (retained < edges.Count) edges.RemoveRange(retained, edges.Count - retained);
            }
            budget.Charge(nodes.Count + directedEdges); PathCost graphCost;
            var path = ShortestPath(nodes, firstNode, lastNode, budget.Token, out graphCost); budget.Check();
            Dictionary<long, InterTrayOpeningPlan> repairs = null;
            if (path == null && blocked != null && blocked.Count != 0)
                path = OpeningFallback(nodes, firstNode, lastNode, blocked, collision, budget, directedEdges, out graphCost, out repairs);
            if (path == null) return null;
            budget.RouteUsedInterTrayManeuver = false;
            var codes = new List<string>(); var segmentIds = new List<string>(); var points = new List<RoutePoint> { from };
            double fromDistance = fromPlan == null ? first.Distance : fromPlan.LengthMeters;
            double toDistance = toPlan == null ? last.Distance : toPlan.LengthMeters;
            bool fromSecondary = fromDistance > options.SecondaryDistanceMeters, toSecondary = toDistance > options.SecondaryDistanceMeters;
            if (fromPlan != null) foreach (var point in fromPlan.Points) AppendPoint(points, point);
            if (fromSecondary) codes.Add("/SECONDARY");
            for (int pathIndex = 0; pathIndex < path.Count; pathIndex++)
            {
                int index = path[pathIndex]; InterTrayOpeningPlan maneuver;
                if (pathIndex > 0 && repairs != null && repairs.TryGetValue(DirectedOpeningKey(path[pathIndex - 1], index), out maneuver))
                {
                    AppendPoint(points, maneuver.First); AppendPoint(points, maneuver.Last); budget.RouteUsedInterTrayManeuver = true;
                }
                budget.Charge(1); var node = nodes[index]; var segment = eligible[node.Segment];
                AppendTransition(codes, segment.RouteCode); AppendTransition(segmentIds, segment.Id); AppendPoint(points, node.Point);
            }
            if (toPlan == null) AppendPoint(points, to);
            else for (int index = toPlan.Points.Count - 1; index >= 0; index--) AppendPoint(points, toPlan.Points[index]);
            if (toSecondary) codes.Add("/SECONDARY");
            double total = graphCost.PhysicalLength + fromDistance + toDistance;
            if (!RoutePoint.IsFinite(total)) throw new ConstrainedLimitException("NONFINITE_ROUTE_LENGTH");
            var route = new RouteResult(true, "Path calculated.", codes, segmentIds, points, total, fromDistance, toDistance,
                fromSecondary, toSecondary, graphCost.GapCount, graphCost.GapLength);
            return ConstrainedFinalClear(route, collision, budget) ? route : null;
        }

        internal static bool ConstrainedFinalClear(RouteResult route, RouteCollisionQuery collision, ConstrainedBudget budget)
        {
            budget.FinalChecks.Clear();
            if (route.PathPoints.Count == 0) { budget.SawIndeterminate = true; return false; }
            if (route.PathPoints.Count == 1)
                return budget.FinalQuery(collision, route.PathPoints[0], route.PathPoints[0]).Status == RouteCollisionStatus.Clear;
            for (int index = 1; index < route.PathPoints.Count; index++)
            {
                budget.Charge(1);
                if (budget.FinalQuery(collision, route.PathPoints[index - 1], route.PathPoints[index]).Status != RouteCollisionStatus.Clear) return false;
            }
            return true;
        }
    }
}
