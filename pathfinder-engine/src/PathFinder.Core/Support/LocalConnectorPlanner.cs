using System;
using System.Collections.Generic;
using System.Threading;

namespace AddinRibbon.Routing
{
    public static class LocalConnectorPlanner
    {
        public static RouteConnectorPlan Plan(RoutePoint from, RoutePoint to, RouteCollisionQuery collision,
            LocalConnectorDomain domain, LocalConnectorOptions options = null, ConstrainedRoutingLimits limits = null,
            CancellationToken cancellationToken = default(CancellationToken))
        {
            if (collision == null) throw new ArgumentNullException("collision");
            if (domain == null) throw new ArgumentNullException("domain");
            var frozen = (options ?? new LocalConnectorOptions()).Snapshot(); var frozenDomain = domain.Snapshot();
            using (var budget = new ConstrainedBudget((limits ?? new ConstrainedRoutingLimits()).Snapshot(), cancellationToken))
            {
                var context = new LocalConnectorContext(frozen, budget);
                try { return PlanPrepared(from, to, collision, frozenDomain, context); }
                catch (ConstrainedLimitException error) { cancellationToken.ThrowIfCancellationRequested(); return Failure(from, to, frozenDomain, context, error.Reason); }
                catch (OperationCanceledException) { cancellationToken.ThrowIfCancellationRequested(); return Failure(from, to, frozenDomain, context, "SEARCH_DEADLINE_EXCEEDED"); }
            }
        }

        internal static RouteConnectorPlan PlanPrepared(RoutePoint from, RoutePoint to, RouteCollisionQuery collision,
            LocalConnectorDomain domain, LocalConnectorContext context)
        {
            int oldChecks = context.EdgeChecks, oldQueries = context.Budget.Queries; long oldWork = context.Budget.Work;
            double direct = from.DistanceTo(to);
            if (!RoutePoint.IsFinite(direct)) throw new ArgumentException("Local connector endpoint distance must be finite.");
            Func<LocalConnectorStatus, string, IEnumerable<RoutePoint>, double, RouteConnectorPlan> result = (status, reason, points, length) =>
                new RouteConnectorPlan(status, reason, points, length, direct, domain, context.EdgeChecks - oldChecks,
                    context.Budget.Queries - oldQueries, context.Budget.Work - oldWork);
            if (context.Plans >= context.Options.MaxPlans) { context.Limited = true; return result(LocalConnectorStatus.SearchIncomplete, "LOCAL_PLAN_LIMIT", null, 0); }
            context.Plans++; context.Budget.Charge(1);
            if (!SupportedDomain(domain, from, to, context.Options)) return result(LocalConnectorStatus.SearchIncomplete, "LOCAL_DOMAIN_UNSUPPORTED", null, 0);
            try
            {
                var first = context.Query(collision, from, from);
                if (first.Status == RouteCollisionStatus.Blocked) return result(LocalConnectorStatus.Blocked, "FROM_ENDPOINT_IN_BARRIER", null, 0);
                if (first.Status != RouteCollisionStatus.Clear) return result(LocalConnectorStatus.Indeterminate, "FROM_OCCUPANCY_INDETERMINATE", null, 0);
                if (!Same(from, to))
                {
                    var last = context.Query(collision, to, to);
                    if (last.Status == RouteCollisionStatus.Blocked) return result(LocalConnectorStatus.Blocked, "TO_ENDPOINT_IN_BARRIER", null, 0);
                    if (last.Status != RouteCollisionStatus.Clear) return result(LocalConnectorStatus.Indeterminate, "TO_OCCUPANCY_INDETERMINATE", null, 0);
                }
                var straight = Same(from, to) ? first : context.Query(collision, from, to);
                if (straight.Status == RouteCollisionStatus.Clear)
                {
                    var points = Same(from, to) ? new[] { from } : new[] { from, to };
                    return Finalize(points, collision, context, result, "STRAIGHT_CONNECTOR_CLEAR");
                }
                var grid = Grid.Create(domain, context.Options.MaxNodes);
                if (grid == null) return result(LocalConnectorStatus.SearchIncomplete, "LOCAL_GRID_NODE_LIMIT", null, 0);
                var costs = new double[grid.Count + 2]; var previous = new int[costs.Length]; var settled = new bool[costs.Length];
                for (int i = 0; i < costs.Length; i++) { costs[i] = double.PositiveInfinity; previous[i] = -1; }
                var queue = new Heap(); var checkedEdges = new Dictionary<long, RouteCollisionStatus>();
                checkedEdges.Add(1, straight.Status); costs[0] = 0; queue.Add(new Entry(0, 0, direct));
                Func<int, RoutePoint> point = index => index == 0 ? from : index == 1 ? to : grid.Point(index - 2);
                Action<int, int> relax = (source, target) => {
                    context.Budget.Charge(1); if (settled[target]) return;
                    long key = ((long)Math.Min(source, target) << 32) | (uint)Math.Max(source, target); RouteCollisionStatus status;
                    if (!checkedEdges.TryGetValue(key, out status))
                    { status = context.Query(collision, point(source), point(target)).Status; checkedEdges.Add(key, status); }
                    if (status != RouteCollisionStatus.Clear) return;
                    double candidate = costs[source] + point(source).DistanceTo(point(target));
                    if (!RoutePoint.IsFinite(candidate)) throw new LocalConnectorLimitException("LOCAL_NONFINITE_LENGTH");
                    if (candidate < costs[target])
                    {
                        costs[target] = candidate; previous[target] = source;
                        if (queue.Count >= context.Options.MaxNodes + context.Options.MaxEdgeChecks) throw new LocalConnectorLimitException("LOCAL_QUEUE_LIMIT");
                        queue.Add(new Entry(target, candidate, candidate + point(target).DistanceTo(to)));
                    }
                };
                while (queue.Count != 0)
                {
                    context.Budget.Charge(1); var entry = queue.Take();
                    if (settled[entry.Index] || entry.Cost != costs[entry.Index]) continue;
                    settled[entry.Index] = true;
                    if (entry.Index == 1)
                    {
                        var indices = new List<int>(); for (int index = 1; index >= 0; index = previous[index]) indices.Add(index);
                        indices.Reverse(); var points = new List<RoutePoint>();
                        foreach (int index in indices) { var value = point(index); if (points.Count == 0 || !Same(points[points.Count - 1], value)) points.Add(value); }
                        return Finalize(points, collision, context, result, "LOCAL_CONNECTOR_CLEAR");
                    }
                    relax(entry.Index, 1); // Exact checked visibility to the goal, never an unchecked shortcut.
                    if (entry.Index == 0) foreach (int index in grid.Corners(from)) relax(0, index + 2);
                    else foreach (int index in grid.Neighbours(entry.Index - 2)) relax(entry.Index, index + 2);
                }
                return result(LocalConnectorStatus.SearchIncomplete, "LOCAL_GRID_EXHAUSTED", null, 0);
            }
            catch (LocalConnectorLimitException error) { context.Limited = true; return result(LocalConnectorStatus.SearchIncomplete, error.Reason, null, 0); }
        }

        internal static RouteConnectorPlan Failure(RoutePoint from, RoutePoint to, LocalConnectorDomain domain, LocalConnectorContext context, string reason)
        {
            double direct = from.DistanceTo(to); if (!RoutePoint.IsFinite(direct)) throw new ArgumentException("Local endpoint distance must be finite.");
            return new RouteConnectorPlan(LocalConnectorStatus.SearchIncomplete, reason, null, 0, direct, domain,
                context.EdgeChecks, context.Budget.Queries, context.Budget.Work);
        }
        private static RouteConnectorPlan Finalize(IEnumerable<RoutePoint> source, RouteCollisionQuery collision, LocalConnectorContext context,
            Func<LocalConnectorStatus, string, IEnumerable<RoutePoint>, double, RouteConnectorPlan> result, string reason)
        {
            var points = new List<RoutePoint>(source); double length = 0;
            for (int i = 0; i < Math.Max(1, points.Count - 1); i++)
            {
                context.Budget.Charge(1); var a = points[i]; var b = points[Math.Min(i + 1, points.Count - 1)];
                if (context.FreshQuery(collision, a, b).Status != RouteCollisionStatus.Clear)
                    return result(LocalConnectorStatus.Indeterminate, "FINAL_CONNECTOR_RECHECK_FAILED", null, 0);
                length += a.DistanceTo(b);
            }
            if (!RoutePoint.IsFinite(length)) throw new LocalConnectorLimitException("LOCAL_NONFINITE_LENGTH");
            return result(LocalConnectorStatus.Clear, reason, points, length);
        }
        private static bool Same(RoutePoint a, RoutePoint b) { return a.X == b.X && a.Y == b.Y && a.Z == b.Z; }
        private static bool SupportedDomain(LocalConnectorDomain domain, RoutePoint from, RoutePoint to, LocalConnectorOptions options)
        {
            var min = domain.Minimum; var max = domain.Maximum;
            return domain.Contains(from) && domain.Contains(to) && domain.StepMeters <= options.StepMeters
                && Math.Abs(min.X) <= 1e9 && Math.Abs(min.Y) <= 1e9 && Math.Abs(min.Z) <= 1e9
                && Math.Abs(max.X) <= 1e9 && Math.Abs(max.Y) <= 1e9 && Math.Abs(max.Z) <= 1e9
                && max.X - min.X <= options.MaxAxisSpanMeters && max.Y - min.Y <= options.MaxAxisSpanMeters && max.Z - min.Z <= options.MaxAxisSpanMeters;
        }

        /// <summary>Index-only lazy lattice. Check finite dimensions/product before
        /// allocating the small search arrays; do not materialize a Cartesian mesh.</summary>
        private sealed class Grid
        {
            private readonly LocalConnectorDomain domain; private readonly int nx, ny, nz;
            internal int Count { get; private set; }
            private Grid(LocalConnectorDomain value, int x, int y, int z) { domain = value; nx = x; ny = y; nz = z; Count = x * y * z; }
            internal static Grid Create(LocalConnectorDomain domain, int maximum)
            {
                double x = Math.Ceiling((domain.Maximum.X - domain.Minimum.X) / domain.StepMeters) + 1;
                double y = Math.Ceiling((domain.Maximum.Y - domain.Minimum.Y) / domain.StepMeters) + 1;
                double z = Math.Ceiling((domain.Maximum.Z - domain.Minimum.Z) / domain.StepMeters) + 1;
                if (!RoutePoint.IsFinite(x) || !RoutePoint.IsFinite(y) || !RoutePoint.IsFinite(z)
                    || x < 1 || y < 1 || z < 1 || x > maximum || y > maximum || z > maximum || x * y * z > maximum - 2) return null;
                return new Grid(domain, (int)x, (int)y, (int)z);
            }
            internal RoutePoint Point(int index)
            {
                int x = index % nx, y = index / nx % ny, z = index / (nx * ny);
                return new RoutePoint(Math.Min(domain.Maximum.X, domain.Minimum.X + x * domain.StepMeters),
                    Math.Min(domain.Maximum.Y, domain.Minimum.Y + y * domain.StepMeters), Math.Min(domain.Maximum.Z, domain.Minimum.Z + z * domain.StepMeters));
            }
            internal IEnumerable<int> Neighbours(int index)
            {
                int x = index % nx, y = index / nx % ny, z = index / (nx * ny);
                if (x > 0) yield return index - 1; if (x + 1 < nx) yield return index + 1;
                if (y > 0) yield return index - nx; if (y + 1 < ny) yield return index + nx;
                if (z > 0) yield return index - nx * ny; if (z + 1 < nz) yield return index + nx * ny;
            }
            internal IEnumerable<int> Corners(RoutePoint point)
            {
                int x = Math.Min(nx - 1, (int)Math.Floor((point.X - domain.Minimum.X) / domain.StepMeters));
                int y = Math.Min(ny - 1, (int)Math.Floor((point.Y - domain.Minimum.Y) / domain.StepMeters));
                int z = Math.Min(nz - 1, (int)Math.Floor((point.Z - domain.Minimum.Z) / domain.StepMeters));
                for (int dz = 0; dz <= (z + 1 < nz ? 1 : 0); dz++)
                    for (int dy = 0; dy <= (y + 1 < ny ? 1 : 0); dy++)
                        for (int dx = 0; dx <= (x + 1 < nx ? 1 : 0); dx++) yield return x + dx + nx * (y + dy + ny * (z + dz));
            }
        }
        private struct Entry
        {
            internal readonly int Index; internal readonly double Cost, Priority;
            internal Entry(int index, double cost, double priority) { Index = index; Cost = cost; Priority = priority; }
            internal int Compare(Entry other) { int a = Priority.CompareTo(other.Priority); if (a != 0) return a; a = Cost.CompareTo(other.Cost); return a != 0 ? a : Index.CompareTo(other.Index); }
        }
        private sealed class Heap
        {
            private readonly List<Entry> values = new List<Entry>(); internal int Count { get { return values.Count; } }
            internal void Add(Entry item)
            {
                values.Add(item); int index = values.Count - 1;
                while (index > 0) { int parent = (index - 1) / 2; if (values[parent].Compare(item) <= 0) break; values[index] = values[parent]; index = parent; }
                values[index] = item;
            }
            internal Entry Take()
            {
                var first = values[0]; var last = values[values.Count - 1]; values.RemoveAt(values.Count - 1); if (values.Count == 0) return first;
                int index = 0;
                while (index * 2 + 1 < values.Count)
                { int child = index * 2 + 1; if (child + 1 < values.Count && values[child + 1].Compare(values[child]) < 0) child++;
                    if (last.Compare(values[child]) <= 0) break; values[index] = values[child]; index = child; }
                values[index] = last; return first;
            }
        }
    }
}
