using System;
using System.Collections.Generic;
using System.Numerics;

namespace AddinRibbon.Routing
{
    /// <summary>Fixed opt-in search domain, never a material or clearance tolerance.
    /// Every realized leg still requires the original collision oracle.</summary>
    public static class InterTrayOpeningManeuverPolicy
    {
        public const string Version = "wfc.pf.inter-tray-opening-maneuvers.v1";
        public const double MaximumOffsetMetres = .1;
        public const double FirstRadiusMetres = .05;
        public const double SecondRadiusMetres = .1;
        public const int MaximumEdgeAttempts = 64;
        public const int CandidateCount = 52;
        public const string DirectionVersion = "normalized-lexicographic-26.v1";
        public const string Domain = "blocked-inter-tray-chords-only";
        public const string Selection = "legacy-clear-upper-bound-lazy-selected-path.v1";
    }

    internal sealed class InterTrayOpeningPlan
    {
        internal readonly RoutePoint First, Last;
        internal readonly double Length;
        internal InterTrayOpeningPlan(RoutePoint first, RoutePoint last, double length)
        { First = first; Last = last; Length = length; }
    }

    /// <summary>One calculation, one exact oracle reference. The sparse cache has
    /// at most64 oriented entries and retains no collision witness. Null values
    /// mean only that this finite maneuver domain was conclusively exhausted.</summary>
    internal sealed class InterTrayOpeningContext
    {
        private readonly ConstrainedBudget budget;
        private readonly Dictionary<OpeningKey, InterTrayOpeningPlan> plans = new Dictionary<OpeningKey, InterTrayOpeningPlan>();
        private RouteCollisionQuery oracle;
        private bool hasOracle;
        internal int Attempts { get; private set; }
        internal InterTrayOpeningContext(ConstrainedBudget budget) { this.budget = budget; }

        internal InterTrayOpeningPlan Find(RouteCollisionQuery query, RoutePoint from, RoutePoint to, double minimumLength)
        {
            budget.Charge(1);
            if (!RoutePoint.IsFinite(minimumLength) || minimumLength < 0) throw new ConstrainedLimitException("INTER_TRAY_NONFINITE_LENGTH");
            if (!hasOracle) { oracle = query; hasOracle = true; }
            else if (!ReferenceEquals(oracle, query))
            {
                plans.Clear();
                // No geometry observed in a different oracle context can be
                // reused, including after an A -> B -> A delegate transition.
                throw new ConstrainedLimitException("INTER_TRAY_ORACLE_CONTEXT_CHANGED");
            }
            var key = new OpeningKey(from, to, minimumLength); InterTrayOpeningPlan cached;
            if (plans.TryGetValue(key, out cached)) { budget.Check(); return cached; }
            if (Attempts >= InterTrayOpeningManeuverPolicy.MaximumEdgeAttempts)
                throw new ConstrainedLimitException("INTER_TRAY_MANEUVER_ATTEMPT_LIMIT");
            Attempts++;
            bool uncertain = false;
            for (int radiusIndex = 0; radiusIndex < 2; radiusIndex++)
            {
                double radius = radiusIndex == 0 ? InterTrayOpeningManeuverPolicy.FirstRadiusMetres : InterTrayOpeningManeuverPolicy.SecondRadiusMetres;
                for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++)
                {
                    int dimensions = x * x + y * y + z * z; if (dimensions == 0) continue;
                    // Fixed-dimensional dyadic bounds below have a fixed maximum
                    // binary64 exponent spread, not input-sized integer work.
                    budget.Charge(64);
                    double scale = radius / Math.Sqrt(dimensions), dx = x * scale, dy = y * scale, dz = z * scale;
                    double ax = from.X + dx, ay = from.Y + dy, az = from.Z + dz;
                    double bx = to.X + dx, by = to.Y + dy, bz = to.Z + dz;
                    if (!RoutePoint.IsFinite(ax) || !RoutePoint.IsFinite(ay) || !RoutePoint.IsFinite(az)
                        || !RoutePoint.IsFinite(bx) || !RoutePoint.IsFinite(by) || !RoutePoint.IsFinite(bz)) continue;
                    var a = new RoutePoint(ax, ay, az); var b = new RoutePoint(bx, by, bz);
                    if (!WithinOffset(from, a) || !WithinOffset(to, b)) continue;
                    double first = from.DistanceTo(a), middle = a.DistanceTo(b), last = b.DistanceTo(to);
                    double length = first + middle + last;
                    // The stored original chord is the optimistic graph cost.
                    // Do not let binary64 summation create a lower replacement
                    // cost, even when exact geometric triangle inequality holds.
                    if (!RoutePoint.IsFinite(length) || length < minimumLength || first == 0 || last == 0) continue;
                    var one = budget.Query(query, from, a);
                    if (one.Status != RouteCollisionStatus.Clear) { uncertain |= one.Status == RouteCollisionStatus.Indeterminate; continue; }
                    var two = budget.Query(query, a, b);
                    if (two.Status != RouteCollisionStatus.Clear) { uncertain |= two.Status == RouteCollisionStatus.Indeterminate; continue; }
                    var three = budget.Query(query, b, to);
                    if (three.Status != RouteCollisionStatus.Clear) { uncertain |= three.Status == RouteCollisionStatus.Indeterminate; continue; }
                    budget.Check(); var result = new InterTrayOpeningPlan(a, b, length); plans.Add(key, result); return result;
                }
            }
            budget.Check(); if (!uncertain) plans.Add(key, null); return null;
        }

        // Compare exact differences between the stored binary64 endpoint values
        // to the rational 1/10m sphere. A rounded sqrt or nominal offset would
        // admit some realized .1m candidates just outside the published domain.
        internal static bool WithinOffset(RoutePoint from, RoutePoint to)
        {
            double[] values = { from.X, from.Y, from.Z, to.X, to.Y, to.Z };
            int minimum = 0; bool any = false;
            var mantissas = new BigInteger[6]; var exponents = new int[6];
            for (int i = 0; i < 6; i++)
            {
                long bits = BitConverter.DoubleToInt64Bits(values[i]); long fraction = bits & 0x000fffffffffffffL;
                int field = (int)((bits >> 52) & 2047);
                if (field == 2047) return false;
                long mantissa = field == 0 ? fraction : fraction | 0x0010000000000000L;
                if (bits < 0) mantissa = -mantissa;
                mantissas[i] = mantissa; exponents[i] = field == 0 ? -1074 : field - 1075;
                if (mantissa != 0 && (!any || exponents[i] < minimum)) { minimum = exponents[i]; any = true; }
            }
            if (!any) return true;
            BigInteger sum = BigInteger.Zero;
            for (int i = 0; i < 3; i++)
            {
                BigInteger a = mantissas[i].IsZero ? BigInteger.Zero : mantissas[i] << (exponents[i] - minimum);
                BigInteger b = mantissas[i + 3].IsZero ? BigInteger.Zero : mantissas[i + 3] << (exponents[i + 3] - minimum);
                BigInteger delta = b - a; sum += delta * delta;
            }
            if (minimum >= 0) return (sum * 100 << (2 * minimum)) <= BigInteger.One;
            return sum * 100 <= (BigInteger.One << (-2 * minimum));
        }

        private readonly struct OpeningKey : IEquatable<OpeningKey>
        {
            private readonly long ax, ay, az, bx, by, bz, minimumLength;
            internal OpeningKey(RoutePoint a, RoutePoint b, double minimumLength)
            { ax = BitConverter.DoubleToInt64Bits(a.X); ay = BitConverter.DoubleToInt64Bits(a.Y); az = BitConverter.DoubleToInt64Bits(a.Z);
                bx = BitConverter.DoubleToInt64Bits(b.X); by = BitConverter.DoubleToInt64Bits(b.Y); bz = BitConverter.DoubleToInt64Bits(b.Z);
                this.minimumLength = BitConverter.DoubleToInt64Bits(minimumLength); }
            public bool Equals(OpeningKey b) { return ax == b.ax && ay == b.ay && az == b.az && bx == b.bx && by == b.by && bz == b.bz && minimumLength == b.minimumLength; }
            public override bool Equals(object b) { return b is OpeningKey && Equals((OpeningKey)b); }
            public override int GetHashCode()
            { unchecked { int h = 17; h = h * 31 + ax.GetHashCode(); h = h * 31 + ay.GetHashCode(); h = h * 31 + az.GetHashCode();
                h = h * 31 + bx.GetHashCode(); h = h * 31 + by.GetHashCode(); h = h * 31 + bz.GetHashCode(); return h * 31 + minimumLength.GetHashCode(); } }
        }
    }

    public sealed partial class RouteCalculator
    {
        private struct BlockedInterTrayEdge
        {
            internal readonly Edge Edge;
            internal readonly int RetainedBefore;
            internal BlockedInterTrayEdge(Edge edge, int retainedBefore) { Edge = edge; RetainedBefore = retainedBefore; }
        }

        private static long DirectedOpeningKey(int from, int to) { return ((long)from << 32) | (uint)to; }

        private static List<int> OpeningFallback(List<Node> nodes, int first, int last,
            Dictionary<int, List<BlockedInterTrayEdge>> blocked, RouteCollisionQuery collision, ConstrainedBudget budget,
            long directedEdges, List<int> incumbent, PathCost incumbentCost,
            out PathCost cost, out Dictionary<long, InterTrayOpeningPlan> repairs)
        {
            repairs = new Dictionary<long, InterTrayOpeningPlan>(); var pending = new HashSet<long>();
            // Merge backwards in place. RetainedBefore refers to the unchanged
            // clear adjacency, so original edge order survives without quadratic
            // List.Insert work or a duplicate whole graph.
            for (int node = 0; node < nodes.Count; node++)
            {
                List<BlockedInterTrayEdge> restore; if (!blocked.TryGetValue(node, out restore)) continue;
                var edges = nodes[node].Edges; int read = edges.Count - 1, next = restore.Count - 1;
                for (int i = 0; i < restore.Count; i++) edges.Add(default(Edge));
                for (int write = edges.Count - 1; write >= 0; write--)
                {
                    budget.Charge(1);
                    if (next >= 0 && read < restore[next].RetainedBefore)
                    { var edge = restore[next--].Edge; edges[write] = edge; pending.Add(DirectedOpeningKey(node, edge.Node)); }
                    else edges[write] = edges[read--];
                }
            }
            while (true)
            {
                budget.Charge(nodes.Count + directedEdges);
                var path = ShortestPath(nodes, first, last, budget.Token, out cost); budget.Check();
                // Only a strictly cheaper verified candidate may displace the
                // original clear graph. Equal costs retain its exact path and
                // adjacency tie choice; unknown chords are lower bounds only.
                if (incumbent != null && (path == null || cost.CompareTo(incumbentCost) >= 0))
                { cost = incumbentCost; return incumbent; }
                if (path == null) return null;
                bool changed = false;
                for (int i = 1; i < path.Count; i++)
                {
                    budget.Charge(1); int from = path[i - 1], to = path[i]; long key = DirectedOpeningKey(from, to);
                    if (!pending.Remove(key)) continue;
                    var edges = nodes[from].Edges; int position = -1;
                    for (int j = 0; j < edges.Count; j++) { budget.Charge(1); if (edges[j].Node == to) { position = j; break; } }
                    if (position < 0) throw new InvalidOperationException("Selected opening edge is missing.");
                    var original = edges[position]; InterTrayOpeningPlan plan;
                    try { plan = budget.InterTray.Find(collision, nodes[from].Point, nodes[to].Point, original.Length); }
                    catch (ConstrainedLimitException error) when (incumbent != null && error.Reason == "INTER_TRAY_MANEUVER_ATTEMPT_LIMIT")
                    {
                        // This is only the local optional improvement ceiling.
                        // Global work/query/deadline limits still propagate, and
                        // the caller must freshly recheck every incumbent leg.
                        budget.Check(); budget.RouteInterTrayImprovementLimited = true; cost = incumbentCost; return incumbent;
                    }
                    if (plan == null) edges.RemoveAt(position);
                    else
                    {
                        // Surface gap eligibility and integer rank stay exactly
                        // as measured. Only traveled physical length changes.
                        edges[position] = new Edge(to, plan.Length, original.GapCount, original.GapDistance); repairs.Add(key, plan);
                    }
                    changed = true; break;
                }
                // Any removal or actual-cost update invalidates the old shortest
                // path/cost. Unknown chords are only optimistic lower bounds.
                if (!changed) return path;
            }
        }
    }
}
