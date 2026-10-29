using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

namespace AddinRibbon.Routing
{
    /// <summary>Detached lookup of an explicitly ordered route, without equipment attachment legs.</summary>
    public static class RouteLookupCalculator
    {
        private static readonly Regex Token = new Regex(@"^[A-Za-z0-9][A-Za-z0-9_.-]*$",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        /// <summary>Ignores SECONDARY markers and coalesces adjacent identical route labels.</summary>
        public static IReadOnlyList<string> Parse(string text)
        {
            if (string.IsNullOrWhiteSpace(text))
                throw new ArgumentException("Enter a route, for example /C135/C134/C133.", "text");
            var codes = new List<string>();
            foreach (string part in text.Trim().Split('/'))
            {
                string value = part.Trim();
                if (value.Length == 0) continue;
                if (!Token.IsMatch(value))
                    throw new ArgumentException("Invalid route name: " + value + ". Separate route names with /.", "text");
                if (StringComparer.OrdinalIgnoreCase.Equals(value, "SECONDARY")) continue;
                string code = "/" + value.ToUpperInvariant();
                if (codes.Count == 0 || !StringComparer.Ordinal.Equals(codes[codes.Count - 1], code)) codes.Add(code);
            }
            if (codes.Count == 0)
                throw new ArgumentException("The route contains no tray names after ignoring SECONDARY.", "text");
            return new ReadOnlyCollection<string>(codes);
        }

        public static RouteResult Calculate(IEnumerable<TraySegment> segments, IReadOnlyList<string> orderedCodes,
            RoutingOptions options = null, CancellationToken cancellationToken = default(CancellationToken))
        {
            return RouteCalculator.CalculateLookup(segments, orderedCodes, options, cancellationToken);
        }
    }

    public sealed partial class RouteCalculator
    {
        internal static RouteResult CalculateLookup(IEnumerable<TraySegment> trays, IReadOnlyList<string> orderedCodes,
            RoutingOptions options, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (trays == null) throw new ArgumentNullException("trays");
            if (orderedCodes == null) throw new ArgumentNullException("orderedCodes");
            var codes = RouteLookupCalculator.Parse(string.Concat(orderedCodes.Select(code =>
                "/" + (code ?? "").Trim().TrimStart('/'))));
            options = options ?? new RoutingOptions();
            options.Validate();
            double tolerance = options.ConnectionToleranceMeters;
            int maxNodes = options.MaxGraphNodes, maxConnections = options.MaxGraphConnections;
            var requested = new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase);
            var eligible = new List<TraySegment>();
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var tray in trays)
            {
                token.ThrowIfCancellationRequested();
                if (tray == null) throw new ArgumentException("Tray snapshots cannot contain null entries.", "trays");
                if (!requested.Contains(tray.RouteCode)) continue;
                if (!ids.Add(tray.Id)) throw new ArgumentException("Duplicate tray identifier: " + tray.Id, "trays");
                eligible.Add(tray);
            }
            eligible.Sort((left, right) => StringComparer.Ordinal.Compare(left.Id, right.Id));
            var present = new HashSet<string>(eligible.Select(tray => tray.RouteCode), StringComparer.OrdinalIgnoreCase);
            var missing = codes.Where(code => !present.Contains(code)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            if (missing.Length != 0)
                return RouteResult.Failure("No visible route geometry found for: " + string.Join(", ", missing) + ".");

            var nodes = new List<Node>();
            var pieces = new List<Piece>();
            var segmentNodes = new List<List<int>>();
            for (int segment = 0; segment < eligible.Count; segment++)
            {
                token.ThrowIfCancellationRequested();
                var tray = eligible[segment];
                var ordered = new List<int>();
                segmentNodes.Add(ordered);
                int offset = pieces.Count;
                double along = 0;
                for (int part = 0; part < tray.Points.Count - 1; part++)
                {
                    token.ThrowIfCancellationRequested();
                    var start = tray.Points[part];
                    var end = tray.Points[part + 1];
                    double length = start.DistanceTo(end);
                    if (!RoutePoint.IsFinite(length) || !RoutePoint.IsFinite(along + length))
                        return RouteResult.Failure("The selected tray geometry contains a length outside the supported coordinate range.");
                    if (length > 0)
                        pieces.Add(new Piece(segment, start, end, along, length, tray.ConnectionsAtEndsOnly,
                            pieces.Count == offset, tray.VerifiedPorts, tray.ConnectionSurfaces));
                    if (ordered.Count == 0 || nodes[ordered[ordered.Count - 1]].Along != along)
                    {
                        if (nodes.Count >= maxNodes) return NodeLimitFailure(maxNodes);
                        ordered.Add(nodes.Count);
                        nodes.Add(new Node(start, segment, along));
                    }
                    along += length;
                }
                if (pieces.Count == offset)
                    pieces.Add(new Piece(segment, tray.Points[0], tray.Points[0], 0, 0,
                        tray.ConnectionsAtEndsOnly, true, tray.VerifiedPorts, tray.ConnectionSurfaces));
                var lastPiece = pieces[pieces.Count - 1];
                lastPiece.SetEndPort();
                pieces[pieces.Count - 1] = lastPiece;
                if (nodes[ordered[ordered.Count - 1]].Along != along)
                {
                    if (nodes.Count >= maxNodes) return NodeLimitFailure(maxNodes);
                    ordered.Add(nodes.Count);
                    nodes.Add(new Node(tray.Points[tray.Points.Count - 1], segment, along));
                }
            }
            GraphLimit limit;
            if (!AddNeighbourConnections(nodes, pieces, segmentNodes, tolerance, maxNodes, maxConnections, token, out limit))
                return limit == GraphLimit.Connections ? ConnectionLimitFailure(maxConnections) :
                    limit == GraphLimit.Candidates ? CandidateLimitFailure(maxConnections) : NodeLimitFailure(maxNodes);
            if (!CloseLookupPolylines(nodes, segmentNodes, maxConnections, token))
                return ConnectionLimitFailure(maxConnections);

            // Without equipment endpoints, a single label uses its longest
            // terminal-to-terminal main chain. Shorter child branches remain unused.
            string endpointError;
            var starts = LookupTerminals(nodes, eligible, codes[0], token, out endpointError);
            if (starts == null) return RouteResult.Failure(endpointError);
            var ends = codes.Count == 1 ? starts : LookupTerminals(nodes, eligible, codes[codes.Count - 1], token, out endpointError);
            if (ends == null) return RouteResult.Failure(endpointError);
            int first = starts[0], last = starts[starts.Length - 1];
            long inferenceOperations = 0, inferenceLimit = CandidateLimit(maxConnections);
            if (codes.Count == 1)
            {
                if (!LookupDiameterEnds(nodes, eligible, starts, codes[0], token,
                    ref inferenceOperations, inferenceLimit, out first, out last, out endpointError))
                    return RouteResult.Failure(endpointError);
            }
            else
            {
                first = OuterLookupTerminal(nodes, eligible, starts, codes[0], codes[1], token,
                    ref inferenceOperations, inferenceLimit, out endpointError);
                if (first < 0) return RouteResult.Failure(endpointError);
                last = OuterLookupTerminal(nodes, eligible, ends, codes[codes.Count - 1], codes[codes.Count - 2], token,
                    ref inferenceOperations, inferenceLimit, out endpointError);
                if (last < 0) return RouteResult.Failure(endpointError);
            }
            PathCost cost;
            int reached;
            bool stateLimit;
            var path = OrderedLookupPath(nodes, eligible, codes, first, last, maxNodes, token,
                out cost, out reached, out stateLimit);
            if (stateLimit) return RouteResult.Failure("The ordered route exceeds the " + maxNodes + " lookup-state limit. Enter a shorter route.");
            if (path == null)
            {
                if (codes.Count == 1 || reached >= codes.Count - 1)
                    return RouteResult.Failure("Route " + codes[codes.Count - 1] + " is internally disconnected at " +
                        tolerance.ToString("0.###", CultureInfo.InvariantCulture) + " m Connection gap.");
                return RouteResult.Failure("The entered route cannot connect " + codes[reached] + " to " + codes[reached + 1] +
                    " at " + tolerance.ToString("0.###", CultureInfo.InvariantCulture) + " m Connection gap. No unlisted route is used.");
            }
            var resultCodes = new List<string>();
            var resultIds = new List<string>();
            var points = new List<RoutePoint>();
            foreach (int index in path)
            {
                var node = nodes[index];
                var tray = eligible[node.Segment];
                AppendTransition(resultCodes, tray.RouteCode);
                AppendTransition(resultIds, tray.Id);
                AppendPoint(points, node.Point);
            }
            if (points.Count < 2 || cost.PhysicalLength <= ConnectionGapEpsilonMeters)
                return RouteResult.Failure("The entered route does not define a non-zero tray path. Add connected route names.");
            return new RouteResult(true, "Entered path found.", resultCodes, resultIds, points,
                cost.PhysicalLength, 0, 0, false, false, cost.GapCount, cost.GapLength);
        }

        private static bool SameLookupCode(List<Node> nodes, List<TraySegment> trays, int first, int last)
        {
            return StringComparer.OrdinalIgnoreCase.Equals(trays[nodes[first].Segment].RouteCode, trays[nodes[last].Segment].RouteCode);
        }

        private static bool CloseLookupPolylines(List<Node> nodes, List<List<int>> segmentNodes,
            int maxConnections, CancellationToken token)
        {
            long connections = nodes.Sum(node => (long)node.Edges.Count) / 2;
            foreach (var ordered in segmentNodes)
            {
                token.ThrowIfCancellationRequested();
                if (ordered.Count < 2) continue;
                int first = ordered[0], last = ordered[ordered.Count - 1];
                // The repeated first point of one closed polyline is a seam,
                // not permission to connect unrelated coincident tray geometry.
                if (nodes[first].Point.DistanceTo(nodes[last].Point) > ConnectionGapEpsilonMeters
                    || nodes[first].Edges.Any(edge => edge.Node == last)) continue;
                if (connections >= maxConnections) return false;
                Connect(nodes, first, last, nodes[first].Point.DistanceTo(nodes[last].Point));
                connections++;
            }
            return true;
        }

        /// <summary>Contracts coincident physical contacts so a joint is not mistaken for a branch.</summary>
        private static int[] LookupTerminals(List<Node> nodes, List<TraySegment> trays, string code,
            CancellationToken token, out string error)
        {
            error = null;
            var parent = Enumerable.Range(0, nodes.Count).ToArray();
            for (int first = 0; first < nodes.Count; first++)
            {
                if ((first & 127) == 0) token.ThrowIfCancellationRequested();
                if (!StringComparer.OrdinalIgnoreCase.Equals(trays[nodes[first].Segment].RouteCode, code)) continue;
                foreach (var edge in nodes[first].Edges)
                {
                    token.ThrowIfCancellationRequested();
                    if (edge.Length <= ConnectionGapEpsilonMeters && SameLookupCode(nodes, trays, first, edge.Node))
                    {
                        int a = LookupRoot(parent, first), b = LookupRoot(parent, edge.Node);
                        if (a != b) parent[Math.Max(a, b)] = Math.Min(a, b);
                    }
                }
            }
            var links = new Dictionary<int, HashSet<int>>();
            for (int first = 0; first < nodes.Count; first++)
            {
                if ((first & 127) == 0) token.ThrowIfCancellationRequested();
                if (!StringComparer.OrdinalIgnoreCase.Equals(trays[nodes[first].Segment].RouteCode, code)) continue;
                int a = LookupRoot(parent, first);
                HashSet<int> neighbors;
                if (!links.TryGetValue(a, out neighbors)) links.Add(a, neighbors = new HashSet<int>());
                foreach (var edge in nodes[first].Edges)
                {
                    token.ThrowIfCancellationRequested();
                    if (SameLookupCode(nodes, trays, first, edge.Node))
                    {
                        int b = LookupRoot(parent, edge.Node);
                        if (a != b) neighbors.Add(b);
                    }
                }
            }
            var terminals = links.Where(pair => pair.Value.Count == 1).Select(pair => pair.Key).OrderBy(value => value).ToArray();
            var visited = new HashSet<int>();
            if (links.Count != 0)
            {
                var pending = new Stack<int>();
                pending.Push(links.Keys.Min());
                while (pending.Count > 0)
                {
                    token.ThrowIfCancellationRequested();
                    int node = pending.Pop();
                    if (!visited.Add(node)) continue;
                    foreach (int next in links[node]) pending.Push(next);
                }
            }
            if (visited.Count != links.Count)
            {
                error = "Route " + code + " has disconnected geometry at the current Connection gap. A partial logical route cannot be shown as a complete path.";
                return null;
            }
            if (terminals.Length < 2) terminals = links.Keys.ToArray();
            Array.Sort(terminals, (first, last) => CompareLookupGeometry(nodes, trays, first, last));
            return terminals;
        }

        private static int CompareLookupGeometry(List<Node> nodes, List<TraySegment> trays, int first, int last)
        {
            var a = nodes[first].Point; var b = nodes[last].Point;
            int order = a.X.CompareTo(b.X);
            if (order == 0) order = a.Y.CompareTo(b.Y);
            if (order == 0) order = a.Z.CompareTo(b.Z);
            if (order == 0) order = StringComparer.Ordinal.Compare(trays[nodes[first].Segment].Id, trays[nodes[last].Segment].Id);
            if (order == 0) order = nodes[first].Along.CompareTo(nodes[last].Along);
            return order == 0 ? first.CompareTo(last) : order;
        }

        private static bool LookupDiameterEnds(List<Node> nodes, List<TraySegment> trays, int[] terminals,
            string code, CancellationToken token, ref long operations, long limit,
            out int first, out int last, out string error)
        {
            first = terminals[0]; last = terminals[terminals.Length - 1]; error = null;
            if (terminals.Length <= 2) return true;
            double longest = double.NegativeInfinity;
            for (int a = 0; a < terminals.Length - 1; a++)
            {
                bool exhausted;
                var costs = LookupCostsFrom(nodes, trays, new[] { terminals[a] }, code, token,
                    ref operations, limit, out exhausted);
                if (exhausted) { error = LookupInferenceLimitMessage(code, limit); return false; }
                for (int b = a + 1; b < terminals.Length; b++)
                {
                    token.ThrowIfCancellationRequested();
                    if (++operations > limit) { error = LookupInferenceLimitMessage(code, limit); return false; }
                    double length = costs[terminals[b]].PhysicalLength;
                    if (!RoutePoint.IsFinite(length))
                    {
                        error = "Route " + code + " is internally disconnected between its candidate ends.";
                        return false;
                    }
                    if (length > longest + ConnectionGapEpsilonMeters)
                    { longest = length; first = terminals[a]; last = terminals[b]; }
                }
            }
            return true;
        }

        private static int LookupRoot(int[] parent, int value)
        {
            int root = value;
            while (parent[root] != root) root = parent[root];
            while (parent[value] != value) { int next = parent[value]; parent[value] = root; value = next; }
            return root;
        }

        private static int OuterLookupTerminal(List<Node> nodes, List<TraySegment> trays, int[] terminals,
            string code, string neighbor, CancellationToken token, ref long operations, long limit, out string error)
        {
            error = null;
            var contacts = new HashSet<int>();
            for (int index = 0; index < nodes.Count; index++)
            {
                if ((index & 127) == 0) token.ThrowIfCancellationRequested();
                if (!StringComparer.OrdinalIgnoreCase.Equals(trays[nodes[index].Segment].RouteCode, code)) continue;
                foreach (var edge in nodes[index].Edges)
                {
                    token.ThrowIfCancellationRequested();
                    if (!StringComparer.OrdinalIgnoreCase.Equals(trays[nodes[edge.Node].Segment].RouteCode, neighbor)) continue;
                    contacts.Add(index); break;
                }
            }
            if (contacts.Count == 0)
            {
                error = "No connection between " + code + " and " + neighbor + " at the current Connection gap.";
                return -1;
            }
            bool exhausted;
            var costs = LookupCostsFrom(nodes, trays, contacts, code, token, ref operations, limit, out exhausted);
            if (exhausted) { error = LookupInferenceLimitMessage(code, limit); return -1; }
            int selected = -1;
            double longest = double.NegativeInfinity;
            foreach (int terminal in terminals)
            {
                token.ThrowIfCancellationRequested();
                double length = costs[terminal].PhysicalLength;
                if (!RoutePoint.IsFinite(length))
                { error = "Route " + code + " is internally disconnected from " + neighbor + "."; return -1; }
                if (length > longest + ConnectionGapEpsilonMeters)
                { longest = length; selected = terminal; }
            }
            return selected;
        }

        private static string LookupInferenceLimitMessage(string code, long limit)
        {
            return "Route " + code + " exceeds the " + limit + " endpoint-inference work limit. Enter more specific route names or select a smaller route area.";
        }

        private static PathCost[] LookupCostsFrom(List<Node> nodes, List<TraySegment> trays, IEnumerable<int> starts,
            string code, CancellationToken token, ref long operations, long limit, out bool exhausted)
        {
            exhausted = false;
            operations += nodes.Count;
            if (operations > limit) { exhausted = true; return null; }
            var distance = Enumerable.Repeat(PathCost.Unreachable, nodes.Count).ToArray();
            var settled = new bool[nodes.Count];
            var queue = new MinHeap();
            foreach (int first in starts)
            {
                token.ThrowIfCancellationRequested();
                distance[first] = new PathCost(0, 0, 0);
                queue.Add(new QueueEntry(first, distance[first]));
            }
            while (queue.Count > 0)
            {
                token.ThrowIfCancellationRequested();
                var entry = queue.RemoveFirst();
                if (settled[entry.Node] || entry.Cost.CompareTo(distance[entry.Node]) > 0) continue;
                settled[entry.Node] = true;
                foreach (var edge in nodes[entry.Node].Edges)
                {
                    if (++operations > limit) { exhausted = true; return distance; }
                    if ((operations & 127) == 0) token.ThrowIfCancellationRequested();
                    if (!SameLookupCode(nodes, trays, entry.Node, edge.Node)) continue;
                    var candidate = entry.Cost.Add(edge);
                    if (settled[edge.Node] || !RoutePoint.IsFinite(candidate.PhysicalLength) || !RoutePoint.IsFinite(candidate.GapLength)
                        || candidate.CompareTo(distance[edge.Node]) >= 0) continue;
                    distance[edge.Node] = candidate;
                    queue.Add(new QueueEntry(edge.Node, candidate));
                }
            }
            token.ThrowIfCancellationRequested();
            return distance;
        }

        private sealed class LookupState
        {
            internal readonly int Node, Step;
            internal int Previous = -1;
            internal PathCost Cost = PathCost.Unreachable;
            internal bool Settled;
            internal LookupState(int node, int step) { Node = node; Step = step; }
        }

        /// <summary>Only same-code and next-code edges are legal; no normal shortest-path substitution.</summary>
        private static List<int> OrderedLookupPath(List<Node> nodes, List<TraySegment> trays, IReadOnlyList<string> codes,
            int first, int last, int maxStates, CancellationToken token,
            out PathCost cost, out int reached, out bool stateLimit)
        {
            cost = PathCost.Unreachable; reached = 0; stateLimit = false;
            var states = new List<LookupState> { new LookupState(first, 0) { Cost = new PathCost(0, 0, 0) } };
            var indices = new Dictionary<long, int> { { first, 0 } };
            var queue = new MinHeap();
            queue.Add(new QueueEntry(0, states[0].Cost));
            int goal = -1, visits = 0;
            while (queue.Count > 0)
            {
                if ((++visits & 127) == 0) token.ThrowIfCancellationRequested();
                var entry = queue.RemoveFirst();
                var state = states[entry.Node];
                if (state.Settled || entry.Cost.CompareTo(state.Cost) > 0) continue;
                state.Settled = true;
                reached = Math.Max(reached, state.Step);
                if (state.Node == last && state.Step == codes.Count - 1) { goal = entry.Node; break; }
                foreach (var edge in nodes[state.Node].Edges)
                {
                    token.ThrowIfCancellationRequested();
                    string code = trays[nodes[edge.Node].Segment].RouteCode;
                    int step = state.Step;
                    if (!StringComparer.OrdinalIgnoreCase.Equals(code, codes[step]))
                    {
                        if (step + 1 >= codes.Count || !StringComparer.OrdinalIgnoreCase.Equals(code, codes[step + 1])) continue;
                        step++;
                    }
                    long key = (long)step * nodes.Count + edge.Node;
                    int next;
                    if (!indices.TryGetValue(key, out next))
                    {
                        if (states.Count >= maxStates) { stateLimit = true; return null; }
                        next = states.Count;
                        states.Add(new LookupState(edge.Node, step));
                        indices.Add(key, next);
                    }
                    var candidate = state.Cost.Add(edge);
                    var target = states[next];
                    if (target.Settled || !RoutePoint.IsFinite(candidate.PhysicalLength) || !RoutePoint.IsFinite(candidate.GapLength)) continue;
                    if (candidate.CompareTo(target.Cost) >= 0) continue;
                    target.Cost = candidate;
                    target.Previous = entry.Node;
                    queue.Add(new QueueEntry(next, candidate));
                }
            }
            token.ThrowIfCancellationRequested();
            if (goal < 0) return null;
            cost = states[goal].Cost;
            var path = new List<int>();
            for (int state = goal; state >= 0; state = states[state].Previous) path.Add(states[state].Node);
            path.Reverse();
            return path;
        }
    }
}
