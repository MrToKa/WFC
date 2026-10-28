using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;

namespace AddinRibbon.Routing
{
    /// <summary>A positive query-local selection cost. It never changes measured geometry or cable length.</summary>
    public sealed class RouteCostMultiplier
    {
        public string RouteCode { get; private set; }
        public double Multiplier { get; private set; }
        public RouteCostMultiplier(string routeCode, double multiplier)
        { RouteCode = routeCode; Multiplier = multiplier; }
    }

    public static class LoadBalancedRouting
    {
        public const int MaximumRouteCosts = 4096;
        public const double MaximumMultiplier = 1000;
        public static void ValidateRouteCostMultipliers(IReadOnlyList<RouteCostMultiplier> costs)
        { Snapshot(costs); }

        internal static Dictionary<string, double> Snapshot(IReadOnlyList<RouteCostMultiplier> costs)
        {
            if (costs == null || costs.Count == 0) return null;
            if (costs.Count > MaximumRouteCosts) throw new ArgumentException("Route cost multipliers exceed their bounded count.");
            var codes = new List<string>(costs.Count);
            var weights = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var cost in costs)
            {
                if (cost == null || !RoutePoint.IsFinite(cost.Multiplier) || cost.Multiplier < 1 || cost.Multiplier > MaximumMultiplier)
                    throw new ArgumentException("Route cost multipliers must be finite values from 1 through 1000.");
                codes.Add(cost.RouteCode);
            }
            CapacityRouting.ValidateExcludedRouteCodes(codes);
            foreach (var cost in costs) if (cost.Multiplier != 1) weights.Add(cost.RouteCode, cost.Multiplier);
            return weights.Count == 0 ? null : weights;
        }
    }

    public sealed partial class RouteCalculator
    {
        // Detached weighted graph entry mirrors the pinned graph construction. Only path selection differs.
        public RouteResult CalculateLoadBalanced(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
            CableCategory category, IReadOnlyList<RouteCostMultiplier> routeCostMultipliers, RoutingOptions options = null,
            CancellationToken cancellationToken = default(CancellationToken))
        {
            return CalculateWithRouteCosts(trays, from, to, category, LoadBalancedRouting.Snapshot(routeCostMultipliers), options, cancellationToken);
        }

        internal RouteResult CalculateWithRouteCosts(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
            CableCategory category, Dictionary<string, double> costs, RoutingOptions options,
            CancellationToken cancellationToken)
        {
            if (costs == null) return Calculate(trays, from, to, category, options, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            if (trays == null) throw new ArgumentNullException("trays");
            if (category != CableCategory.MV && category != CableCategory.LV && category != CableCategory.Control)
                throw new ArgumentException("Select one cable category.", "category");
            options = options ?? new RoutingOptions();
            options.Validate();
            // Snapshot mutable UI options before doing background work.
            double tolerance = options.ConnectionToleranceMeters;
            double secondaryDistance = options.SecondaryDistanceMeters;
            int maxNodes = options.MaxGraphNodes;
            int maxConnections = options.MaxGraphConnections;
            bool preferVertical = options.PreferVerticalApproach;
            var eligible = new List<TraySegment>();
            var identifiers = new HashSet<string>(StringComparer.Ordinal);
            foreach (var tray in trays)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (tray == null) throw new ArgumentException("Tray snapshots cannot contain null entries.", "trays");
                if ((tray.AllowedCategories & category) != category) continue;
                if (!identifiers.Add(tray.Id))
                    throw new ArgumentException("Duplicate tray identifier: " + tray.Id, "trays");
                eligible.Add(tray);
            }
            eligible.Sort((left, right) => StringComparer.Ordinal.Compare(left.Id, right.Id));
            if (eligible.Count == 0) return RouteResult.Failure("No selected trays allow this cable category.");

            Projection first = FindNearest(eligible, from, cancellationToken);
            Projection last = FindNearest(eligible, to, cancellationToken);
            if (!RoutePoint.IsFinite(first.Distance) || !RoutePoint.IsFinite(last.Distance))
                return RouteResult.Failure("The endpoint distances are outside the supported coordinate range.");
            if (preferVertical)
            {
                first = FindVerticalApproach(eligible, from, first, tolerance, cancellationToken);
                last = FindVerticalApproach(eligible, to, last, tolerance, cancellationToken);
            }
            long graphStarted = GraphPreparationRequest.StartGraphAssembly();
            var nodes = new List<Node>();
            var pieces = new List<Piece>();
            var segmentNodes = new List<List<int>>();
            int firstNode = -1, lastNode = -1;
            for (int segmentIndex = 0; segmentIndex < eligible.Count; segmentIndex++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var tray = eligible[segmentIndex];
                int pieceOffset = pieces.Count;
                var vertices = new List<Vertex>();
                var orderedNodes = new List<int>();
                segmentNodes.Add(orderedNodes);
                double along = 0;
                for (int part = 0; part < tray.Points.Count - 1; part++)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var start = tray.Points[part];
                    var end = tray.Points[part + 1];
                    double length = start.DistanceTo(end);
                    if (!RoutePoint.IsFinite(length))
                        return RouteResult.Failure("The selected tray geometry contains a length outside the supported coordinate range.");
                    if (length > 0) pieces.Add(new Piece(segmentIndex, start, end, along, length,
                        tray.ConnectionsAtEndsOnly, pieces.Count == pieceOffset, tray.VerifiedPorts, tray.ConnectionSurfaces));
                    vertices.Add(new Vertex(along, start));
                    along += length;
                }
                if (pieces.Count == pieceOffset)
                    pieces.Add(new Piece(segmentIndex, tray.Points[0], tray.Points[0], 0, 0,
                        tray.ConnectionsAtEndsOnly, true, tray.VerifiedPorts, tray.ConnectionSurfaces));
                var lastPiece = pieces[pieces.Count - 1];
                lastPiece.SetEndPort();
                pieces[pieces.Count - 1] = lastPiece;
                vertices.Add(new Vertex(along, tray.Points[tray.Points.Count - 1]));
                if (first.Segment == segmentIndex) vertices.Add(new Vertex(first.Along, first.Point));
                if (last.Segment == segmentIndex) vertices.Add(new Vertex(last.Along, last.Point));
                vertices.Sort((left, right) => left.Along.CompareTo(right.Along));
                int previous = -1;
                double previousAlong = double.NaN;
                foreach (var vertex in vertices)
                {
                    // Equal abscissae are the same vertex, even at a zero-length piece.
                    int index;
                    if (previous >= 0 && vertex.Along == previousAlong) index = previous;
                    else
                    {
                        if (nodes.Count >= maxNodes) return NodeLimitFailure(maxNodes);
                        index = nodes.Count;
                        nodes.Add(new Node(vertex.Point, segmentIndex, vertex.Along));
                        orderedNodes.Add(index);
                        previous = index;
                        previousAlong = vertex.Along;
                    }
                    if (first.Segment == segmentIndex && vertex.Along == first.Along) firstNode = index;
                    if (last.Segment == segmentIndex && vertex.Along == last.Along) lastNode = index;
                }
            }

            GraphLimit limit;
            if (!AddNeighbourConnections(nodes, pieces, segmentNodes, tolerance, maxNodes,
                maxConnections, cancellationToken, out limit, graphStarted))
                return limit == GraphLimit.Connections ? ConnectionLimitFailure(maxConnections) :
                    limit == GraphLimit.Candidates ? CandidateLimitFailure(maxConnections) : NodeLimitFailure(maxNodes);
            PathCost graphCost;
            var path = SelectPath(nodes, firstNode, lastNode, cancellationToken, eligible, costs, out graphCost);
            if (path == null)
                return RouteResult.Failure("Selected From tray " + eligible[first.Segment].RouteCode +
                    " (" + first.Distance.ToString("0.###", CultureInfo.InvariantCulture) + " m from object) and To tray " +
                    eligible[last.Segment].RouteCode + " (" + last.Distance.ToString("0.###", CultureInfo.InvariantCulture) +
                    " m from object) are disconnected at " + tolerance.ToString("0.###", CultureInfo.InvariantCulture) +
                    " m connection tolerance. Check route assignments and geometry between these trays.");

            var codes = new List<string>();
            var segmentIds = new List<string>();
            var points = new List<RoutePoint> { from };
            bool fromSecondary = first.Distance > secondaryDistance;
            bool toSecondary = last.Distance > secondaryDistance;
            if (fromSecondary) codes.Add("/SECONDARY");
            foreach (int nodeIndex in path)
            {
                var node = nodes[nodeIndex];
                var segment = eligible[node.Segment];
                AppendTransition(codes, segment.RouteCode);
                AppendTransition(segmentIds, segment.Id);
                AppendPoint(points, node.Point);
            }
            AppendPoint(points, to);
            if (toSecondary) codes.Add("/SECONDARY");
            double totalLength = graphCost.PhysicalLength + first.Distance + last.Distance;
            if (!RoutePoint.IsFinite(totalLength))
                return RouteResult.Failure("The total cable length is outside the supported coordinate range.");
            return new RouteResult(true, "Path calculated.", codes, segmentIds, points,
                totalLength, first.Distance, last.Distance,
                fromSecondary, toSecondary, graphCost.GapCount, graphCost.GapLength);
        }

        private struct WeightedPathCost : IComparable<WeightedPathCost>
        {
            internal readonly PathCost Physical;
            internal readonly double SelectionLength;
            internal static readonly WeightedPathCost Unreachable = new WeightedPathCost(PathCost.Unreachable, double.PositiveInfinity);
            internal WeightedPathCost(PathCost physical, double selectionLength)
            { Physical = physical; SelectionLength = selectionLength; }
            internal WeightedPathCost Add(Edge edge, double multiplier)
            { return new WeightedPathCost(Physical.Add(edge), SelectionLength + edge.Length * multiplier); }
            public int CompareTo(WeightedPathCost other)
            {
                int compared = Physical.GapCount.CompareTo(other.Physical.GapCount);
                if (compared == 0) compared = Physical.GapRank.CompareTo(other.Physical.GapRank);
                if (compared == 0) compared = SelectionLength.CompareTo(other.SelectionLength);
                return compared != 0 ? compared : Physical.PhysicalLength.CompareTo(other.Physical.PhysicalLength);
            }
        }

        private struct WeightedQueueEntry
        {
            internal readonly int Node;
            internal readonly WeightedPathCost Cost;
            internal WeightedQueueEntry(int node, WeightedPathCost cost) { Node = node; Cost = cost; }
        }

        private sealed class WeightedMinHeap
        {
            private readonly List<WeightedQueueEntry> entries = new List<WeightedQueueEntry>();
            internal int Count { get { return entries.Count; } }
            private static bool Before(WeightedQueueEntry first, WeightedQueueEntry last)
            { int compared = first.Cost.CompareTo(last.Cost); return compared < 0 || compared == 0 && first.Node < last.Node; }
            internal void Add(WeightedQueueEntry entry)
            {
                entries.Add(entry); int child = entries.Count - 1;
                while (child > 0)
                {
                    int parent = (child - 1) / 2;
                    if (!Before(entries[child], entries[parent])) break;
                    var swap = entries[parent]; entries[parent] = entries[child]; entries[child] = swap; child = parent;
                }
            }
            internal WeightedQueueEntry RemoveFirst()
            {
                var result = entries[0]; var tail = entries[entries.Count - 1]; entries.RemoveAt(entries.Count - 1);
                if (entries.Count == 0) return result;
                entries[0] = tail; int parent = 0;
                while (true)
                {
                    int child = parent * 2 + 1;
                    if (child >= entries.Count) break;
                    if (child + 1 < entries.Count && Before(entries[child + 1], entries[child])) child++;
                    if (!Before(entries[child], entries[parent])) break;
                    var swap = entries[parent]; entries[parent] = entries[child]; entries[child] = swap; parent = child;
                }
                return result;
            }
        }

        private static double[] SelectionMultipliers(IReadOnlyList<TraySegment> eligible, Dictionary<string, double> costs)
        {
            var result = new double[eligible.Count];
            for (int i = 0; i < result.Length; i++)
            { double value; result[i] = costs != null && costs.TryGetValue(eligible[i].RouteCode, out value) ? value : 1; }
            return result;
        }

        private static double EdgeSelectionMultiplier(Node first, Node last, double[] multipliers)
        { return first.Segment == last.Segment ? multipliers[first.Segment] : 1; }

        private static List<int> SelectPath(List<Node> nodes, int first, int last, CancellationToken token,
            IReadOnlyList<TraySegment> eligible, Dictionary<string, double> costs, out PathCost cost)
        {
            if (costs == null) return ShortestPath(nodes, first, last, token, out cost);
            var multipliers = SelectionMultipliers(eligible, costs);
            var distance = Enumerable.Repeat(WeightedPathCost.Unreachable, nodes.Count).ToArray();
            var previous = Enumerable.Repeat(-1, nodes.Count).ToArray(); var settled = new bool[nodes.Count];
            var queue = new WeightedMinHeap(); distance[first] = new WeightedPathCost(new PathCost(0, 0, 0), 0);
            queue.Add(new WeightedQueueEntry(first, distance[first])); int visits = 0, relaxations = 0;
            while (queue.Count > 0)
            {
                if ((++visits & 127) == 0) token.ThrowIfCancellationRequested();
                var entry = queue.RemoveFirst();
                if (settled[entry.Node] || entry.Cost.CompareTo(distance[entry.Node]) > 0) continue;
                settled[entry.Node] = true; if (entry.Node == last) break;
                foreach (var edge in nodes[entry.Node].Edges)
                {
                    if ((++relaxations & 255) == 0) token.ThrowIfCancellationRequested();
                    if (settled[edge.Node]) continue;
                    var candidate = entry.Cost.Add(edge, EdgeSelectionMultiplier(nodes[entry.Node], nodes[edge.Node], multipliers));
                    if (!RoutePoint.IsFinite(candidate.SelectionLength) || !RoutePoint.IsFinite(candidate.Physical.GapLength)
                        || !RoutePoint.IsFinite(candidate.Physical.PhysicalLength)) continue;
                    if (candidate.CompareTo(distance[edge.Node]) >= 0) continue;
                    distance[edge.Node] = candidate; previous[edge.Node] = entry.Node;
                    queue.Add(new WeightedQueueEntry(edge.Node, candidate));
                }
            }
            token.ThrowIfCancellationRequested(); cost = distance[last].Physical;
            if (cost.GapCount == int.MaxValue) return null;
            var path = new List<int>(); for (int node = last; node >= 0; node = previous[node]) path.Add(node);
            path.Reverse(); return path;
        }

        private static WeightedPathCost PathSelectionCost(List<Node> nodes, List<int> path, PathCost physical,
            IReadOnlyList<TraySegment> eligible, Dictionary<string, double> costs, CancellationToken token)
        {
            var multipliers = SelectionMultipliers(eligible, costs); double selection = 0; int inspected = 0;
            for (int i = 1; i < path.Count; i++)
            {
                token.ThrowIfCancellationRequested(); var first = nodes[path[i - 1]]; bool found = false;
                foreach (var edge in first.Edges)
                {
                    if ((++inspected & 255) == 0) token.ThrowIfCancellationRequested();
                    if (edge.Node == path[i])
                    { selection += edge.Length * EdgeSelectionMultiplier(first, nodes[edge.Node], multipliers); found = true; break; }
                }
                if (!found) throw new InvalidOperationException("Selected route edge is missing.");
            }
            return new WeightedPathCost(physical, selection);
        }

        private static int CompareSelectedPaths(List<Node> nodes, List<int> first, PathCost firstCost,
            List<int> last, PathCost lastCost, IReadOnlyList<TraySegment> eligible, Dictionary<string, double> costs, CancellationToken token)
        {
            if (costs == null) return firstCost.CompareTo(lastCost);
            return PathSelectionCost(nodes, first, firstCost, eligible, costs, token)
                .CompareTo(PathSelectionCost(nodes, last, lastCost, eligible, costs, token));
        }
    }
}
