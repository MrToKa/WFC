using System.Collections.ObjectModel;

namespace PathFinder.Barriers;

/// <summary>
/// Immutable centreline collision oracle for a bounded, explicitly selected set
/// of complete closed triangle solids. It does not plan detours, qualify cable
/// radius, infer walls or repair holes. A ready empty set is not admitted here;
/// an explicit no-barrier planning declaration belongs to the server contract.
/// </summary>
public sealed class BarrierCollisionKernel
{
    public const string CollisionVersion = "wfc.pf.triangle-centreline-collision.v1";
    public const string PolicyVersion = "wfc.pf.registered-triangle-barriers.v1";
    private const double MachineEpsilon = 2.2204460492503131e-16;
    private readonly BarrierLimits limits;
    private readonly Solid[] solids;
    private readonly Triangle[] triangles;
    private readonly int[] order;
    private readonly BvhNode[] nodes;
    private readonly double tolerance;
    public BarrierKernelSummary Summary { get; }

    private BarrierCollisionKernel(BarrierLimits limits, Solid[] solids, Triangle[] triangles,
        int[] order, BvhNode[] nodes, double tolerance, int vertices, long estimatedBytes)
    {
        this.limits = limits; this.solids = solids; this.triangles = triangles;
        this.order = order; this.nodes = nodes; this.tolerance = tolerance;
        Summary = new(solids.Length, vertices, triangles.Length, nodes.Length, estimatedBytes, tolerance);
    }

    public static BarrierBuildResult Build(IEnumerable<BarrierMeshInput> meshes, BarrierLimits? limits = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        limits ??= new(); var budget = new Budget(limits.MaximumBuildWork, limits.MaximumBuildMilliseconds, cancellationToken);
        try
        {
            ValidateLimits(limits);
            if (meshes is null) throw Refusal("invalid_mesh", "A bounded explicit set of selected meshes is required.");
            var inputs = new List<BarrierMeshInput>();
            foreach (var mesh in meshes)
            {
                budget.Spend();
                if (inputs.Count >= limits.MaximumMeshes) throw Refusal("resource_limit", "Selected mesh count exceeds its limit.");
                if (mesh is null) throw Refusal("invalid_mesh", "A selected mesh cannot be null.");
                if (mesh.Id is null || mesh.Id.Length is < 1 or > 256 || string.IsNullOrWhiteSpace(mesh.Id))
                    throw Refusal("invalid_identity", "Selected solid IDs must be unique nonempty bounded strings.");
                inputs.Add(mesh);
            }
            if (inputs.Count == 0) throw Refusal("empty_scope", "No selected solids were supplied; walls have not been checked.");
            inputs.Sort((a, b) => { budget.Spend(); return StringComparer.Ordinal.Compare(a.Id, b.Id); });
            var all = new List<Triangle>(); var solidList = new List<Solid>(); var ids = new HashSet<string>(StringComparer.Ordinal);
            var originalVertices = 0; var copiedTriangles = 0; double magnitude = 1;
            // Copy before qualification; a caller's later edits cannot mutate the kernel.
            var copied = new List<(string Id, V[] Vertices, int[] Indices)>();
            foreach (var input in inputs)
            {
                budget.Spend();
                if (!ids.Add(input.Id))
                    throw Refusal("invalid_identity", "Selected solid IDs must be unique nonempty bounded strings.", input.Id);
                if (!input.Complete) throw Refusal("incomplete_geometry", "Incomplete selected geometry cannot clear a route.", input.Id);
                if (input.Vertices is null || input.TriangleIndices is null || input.Vertices.Count < 4
                    || input.TriangleIndices.Count < 12 || input.TriangleIndices.Count % 3 != 0)
                    throw Refusal("invalid_mesh", "A closed solid needs complete vertices and indexed triangles.", input.Id);
                originalVertices = checked(originalVertices + input.Vertices.Count);
                if (originalVertices > limits.MaximumVertices || input.TriangleIndices.Count / 3 > limits.MaximumTriangles - copiedTriangles)
                    throw Refusal("resource_limit", "Selected vertex or triangle count exceeds its limit.", input.Id);
                copiedTriangles += input.TriangleIndices.Count / 3;
                CheckMemory(limits, originalVertices, copiedTriangles, 0);
                var vertices = new V[input.Vertices.Count]; var indices = new int[input.TriangleIndices.Count];
                for (var i = 0; i < vertices.Length; i++)
                {
                    budget.Spend(); var p = new V(input.Vertices[i]);
                    if (!Geometry.Valid(p, limits.MaximumCoordinateMagnitude)) throw Refusal("nonfinite_geometry", "Finite world-metre vertices within the coordinate limit are required.", input.Id);
                    vertices[i] = p;
                    magnitude = Math.Max(magnitude, Math.Max(Math.Abs(p.X), Math.Max(Math.Abs(p.Y), Math.Abs(p.Z))));
                }
                for (var i = 0; i < indices.Length; i++)
                {
                    budget.Spend(); int value = input.TriangleIndices[i];
                    if (value < 0 || value >= vertices.Length) throw Refusal("invalid_index", "A triangle index is outside its selected mesh vertices.", input.Id);
                    indices[i] = value;
                }
                copied.Add((input.Id, vertices, indices));
            }
            // This guards binary64 resolution at large world translations. It is
            // numerical conservatism, never a physical cable radius/clearance.
            double effectiveTolerance = Math.Max(limits.NumericToleranceMeters, 64 * MachineEpsilon * magnitude);
            foreach (var item in copied)
            {
                budget.Spend(); int start = all.Count;
                var qualified = Qualify(item.Id, item.Vertices, item.Indices, solidList.Count, effectiveTolerance, budget);
                all.AddRange(qualified);
                var bounds = qualified[0].Bounds;
                foreach (var triangle in qualified) { budget.Spend(); bounds = Box.Union(bounds, triangle.Bounds); }
                solidList.Add(new(item.Id, start, qualified.Length, bounds));
            }
            var array = all.ToArray(); var order = Enumerable.Range(0, array.Length).ToArray();
            var bvh = new List<BvhNode>();
            BuildNode(array, order, 0, order.Length, bvh, limits, originalVertices, budget);
            long bytes = CheckMemory(limits, originalVertices, array.Length, bvh.Count);
            var nodes = bvh.ToArray();
            ValidateEmbedding(array, order, nodes, solidList, effectiveTolerance, budget);
            budget.Checkpoint();
            return new(BarrierBuildStatus.Ready,
                new(limits, solidList.ToArray(), array, order, nodes, effectiveTolerance, originalVertices, bytes),
                Array.Empty<BarrierDiagnostic>(), budget.Work);
        }
        catch (GeometryRefusal error)
        {
            return new(BarrierBuildStatus.Refused, null, new ReadOnlyCollection<BarrierDiagnostic>([error.Diagnostic]), budget.Work);
        }
        catch (InvalidOperationException error) when (error.InnerException is GeometryRefusal)
        {
            // Array.Sort wraps comparer failures; preserve the closed refusal
            // boundary when a deterministic BVH-sort work budget is exhausted.
            var refusal = (GeometryRefusal)error.InnerException;
            return new(BarrierBuildStatus.Refused, null, new ReadOnlyCollection<BarrierDiagnostic>([refusal.Diagnostic]), budget.Work);
        }
        catch (InvalidOperationException error) when (error.InnerException is OperationCanceledException)
        {
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error.InnerException).Throw();
            throw;
        }
        catch (OverflowException)
        {
            return new(BarrierBuildStatus.Refused, null, new ReadOnlyCollection<BarrierDiagnostic>([new("resource_limit", "Geometry arithmetic or count budget overflowed.")]), budget.Work);
        }
        catch (GeometryUncertaintyException error)
        {
            return new(BarrierBuildStatus.Refused, null, new ReadOnlyCollection<BarrierDiagnostic>([new("arithmetic_uncertainty", error.Message)]), budget.Work);
        }
    }

    public BarrierSegmentResult CheckSegment(BarrierPoint from, BarrierPoint to, CancellationToken token = default)
    {
        token.ThrowIfCancellationRequested(); var budget = new Budget(limits.MaximumQueryWork, limits.MaximumQueryMilliseconds, token);
        var first = new V(from); var last = new V(to);
        if (!Geometry.Valid(first, limits.MaximumCoordinateMagnitude) || !Geometry.Valid(last, limits.MaximumCoordinateMagnitude))
            return new(BarrierSegmentStatus.Indeterminate, null, "Finite canonical world-metre segment endpoints within the coordinate limit are required.", 0);
        try
        {
            var bounds = Box.Of(first, last); var stack = new Stack<int>(); stack.Push(0);
            // Queries farther from the origin can demand a larger binary64 guard.
            double queryMagnitude = Math.Max(Math.Max(Math.Abs(first.X), Math.Max(Math.Abs(first.Y), Math.Abs(first.Z))),
                Math.Max(Math.Abs(last.X), Math.Max(Math.Abs(last.Y), Math.Abs(last.Z))));
            double guard = Math.Max(tolerance, 64 * MachineEpsilon * queryMagnitude);
            while (stack.Count > 0)
            {
                budget.Spend(); var node = nodes[stack.Pop()];
                if (!node.Bounds.Overlaps(bounds, guard)) continue;
                if (node.Count == 0) { stack.Push(node.Right); stack.Push(node.Left); continue; }
                for (var offset = 0; offset < node.Count; offset++)
                {
                    budget.Spend(); var triangle = triangles[order[node.Start + offset]];
                    if (!triangle.Bounds.Overlaps(bounds, guard)) continue;
                    budget.Spend(8);
                    double scale = Math.Max(Geometry.Longest(triangle), Math.Max((first - triangle.A).Length, (last - triangle.A).Length));
                    double uncertainty = Geometry.ArithmeticGuard(triangle, scale);
                    if (!double.IsFinite(uncertainty) || uncertainty > guard)
                    {
                        budget.Checkpoint();
                        return new(BarrierSegmentStatus.Indeterminate, solids[triangle.Solid].Id,
                            "Segment/triangle arithmetic is too poorly conditioned for the numeric tolerance; no clear certificate was produced.", budget.Work);
                    }
                    if (Geometry.Touches(first, last, triangle, guard))
                    {
                        budget.Checkpoint();
                        return new(BarrierSegmentStatus.Blocked, solids[triangle.Solid].Id, "The cable centreline touches or crosses the selected solid surface within numeric tolerance.", budget.Work);
                    }
                }
            }
            // Crossing tests alone cannot find a segment wholly inside a solid.
            // A topologically qualified oriented closed shell permits a complete
            // solid-angle winding sum, including the void of an actual tunnel.
            foreach (var solid in solids)
            {
                budget.Spend();
                foreach (var point in first == last ? new[] { first } : new[] { first, last })
                {
                    if (!solid.Bounds.Contains(point, guard)) continue;
                    double sum = 0, correction = 0;
                    for (var offset = 0; offset < solid.Count; offset++)
                    {
                        budget.Spend(2); var triangle = triangles[solid.Start + offset];
                        double uncertainty = Geometry.ArithmeticGuard(triangle, Math.Max(Geometry.Longest(triangle), (point - triangle.A).Length));
                        if (!double.IsFinite(uncertainty) || uncertainty > guard)
                        {
                            budget.Checkpoint();
                            return new(BarrierSegmentStatus.Indeterminate, solid.Id,
                                "Solid-containment arithmetic is too poorly conditioned for the numeric tolerance; no clear certificate was produced.", budget.Work);
                        }
                        double term = Geometry.SolidAngle(point, triangle) - correction;
                        double next = sum + term; correction = (next - sum) - term; sum = next;
                    }
                    double winding = Math.Abs(sum) / (4 * Math.PI);
                    if (!double.IsFinite(winding) || Math.Min(winding, Math.Abs(winding - 1)) > 0.000001)
                    {
                        budget.Checkpoint();
                        return new(BarrierSegmentStatus.Indeterminate, solid.Id, "Solid containment is numerically ambiguous; no clear certificate was produced.", budget.Work);
                    }
                    if (winding > 0.5)
                    {
                        budget.Checkpoint();
                        return new(BarrierSegmentStatus.Blocked, solid.Id, "A cable endpoint is inside the selected closed solid.", budget.Work);
                    }
                }
            }
            budget.Checkpoint();
            return new(BarrierSegmentStatus.Clear, null, "The centreline is clear of the supplied qualified selected solids; physical cable radius was not checked.", budget.Work);
        }
        catch (GeometryRefusal error)
        {
            return new(BarrierSegmentStatus.Indeterminate, error.Diagnostic.BarrierId,
                "Collision query did not complete: " + error.Diagnostic.Message, budget.Work);
        }
        catch (GeometryUncertaintyException error)
        {
            return new(BarrierSegmentStatus.Indeterminate, null, error.Message, budget.Work);
        }
    }

    private static void ValidateLimits(BarrierLimits value)
    {
        if (value.MaximumMeshes is < 1 or > 2048 || value.MaximumVertices is < 4 or > 500_000
            || value.MaximumTriangles is < 4 or > 250_000 || value.MaximumBvhNodes is < 1 or > 500_000
            || value.MaximumBuildWork is < 1 or > 40_000_000 || value.MaximumQueryWork is < 1 or > 2_000_000
            || value.MaximumEstimatedBytes is < 1 or > 134_217_728
            || value.MaximumBuildMilliseconds is < 1 or > 60_000 || value.MaximumQueryMilliseconds is < 1 or > 10_000
            || value.BvhLeafSize is < 1 or > 64 || !double.IsFinite(value.NumericToleranceMeters)
            || value.NumericToleranceMeters is < 1e-9 or > 0.001 || !double.IsFinite(value.MaximumCoordinateMagnitude)
            || value.MaximumCoordinateMagnitude is <= 0 or > 1e9)
            throw Refusal("invalid_limits", "Explicit finite supported geometry/work/memory limits are required.");
    }

    private static long CheckMemory(BarrierLimits limits, int vertices, int triangles, int nodes)
    {
        // Conservative accounting includes temporary input/weld/topology arrays;
        // it is not an OS RSS measurement or a whole-plant capacity claim.
        long estimate = checked(4096L + vertices * 192L + triangles * 256L + nodes * 96L);
        if (estimate > limits.MaximumEstimatedBytes) throw Refusal("resource_limit", "Estimated geometry/BVH memory exceeds its limit.");
        return estimate;
    }

    private static Triangle[] Qualify(string id, V[] source, int[] indices, int solid, double tolerance, Budget budget)
    {
        var weld = new Dictionary<V, int>(); var vertices = new List<V>(); var mapped = new int[source.Length];
        for (var i = 0; i < source.Length; i++)
        {
            budget.Spend(); var point = source[i];
            if (!weld.TryGetValue(point, out int index)) { index = vertices.Count; weld.Add(point, index); vertices.Add(point); }
            mapped[i] = index;
        }
        var triangles = new Triangle[indices.Length / 3]; var edges = new Dictionary<(int, int), EdgeUse>();
        var duplicate = new HashSet<(int, int, int)>(); var incident = new List<int>[vertices.Count];
        for (var i = 0; i < incident.Length; i++) incident[i] = new();
        var adjacent = new List<int>[triangles.Length];
        for (var local = 0; local < triangles.Length; local++)
        {
            budget.Spend(); adjacent[local] = new();
            int a = mapped[indices[local * 3]], b = mapped[indices[local * 3 + 1]], c = mapped[indices[local * 3 + 2]];
            var triangle = new Triangle(vertices[a], vertices[b], vertices[c], solid, local, a, b, c);
            double longest = Geometry.Longest(triangle);
            if (a == b || b == c || a == c || !double.IsFinite(longest) || longest <= tolerance
                || triangle.Normal.Length / longest <= tolerance)
                throw Refusal("degenerate_geometry", "A triangle is degenerate or below the supported numeric resolution; it was not removed or repaired.", id);
            double arithmeticGuard = Geometry.ArithmeticGuard(triangle, longest);
            if (!double.IsFinite(arithmeticGuard) || arithmeticGuard > tolerance)
                throw Refusal("ill_conditioned_geometry", "Triangle aspect and scale exceed the supported arithmetic resolution for this numeric tolerance.", id);
            var sorted = new[] { a, b, c }; Array.Sort(sorted);
            if (!duplicate.Add((sorted[0], sorted[1], sorted[2]))) throw Refusal("duplicate_triangle", "A solid contains repeated coincident triangles.", id);
            triangles[local] = triangle;
            for (var edge = 0; edge < 3; edge++)
            {
                budget.Spend(); int x = triangle.IndexAt(edge), y = triangle.IndexAt((edge + 1) % 3);
                incident[x].Add(local); var key = (Math.Min(x, y), Math.Max(x, y)); int direction = x < y ? 1 : -1;
                if (!edges.TryGetValue(key, out var use)) edges.Add(key, new(local, direction, -1));
                else
                {
                    if (use.Second >= 0) throw Refusal("nonmanifold_geometry", "A solid edge belongs to more than two triangles.", id);
                    if (use.Direction == direction) throw Refusal("inconsistent_winding", "Triangle orientations must be consistent across every shared edge; a wholly reversed shell is supported.", id);
                    edges[key] = use with { Second = local };
                }
            }
        }
        foreach (var use in edges.Values)
        {
            budget.Spend();
            if (use.Second < 0) throw Refusal("open_geometry", "The selected surface is not an exactly welded closed solid; open/surface-only data cannot clear routes.", id);
            adjacent[use.First].Add(use.Second); adjacent[use.Second].Add(use.First);
        }
        var seen = new bool[triangles.Length]; var queue = new Queue<int>(); queue.Enqueue(0); seen[0] = true; int connected = 0;
        while (queue.Count > 0)
        {
            budget.Spend(); int current = queue.Dequeue(); connected++;
            foreach (int next in adjacent[current]) if (!seen[next]) { seen[next] = true; queue.Enqueue(next); }
        }
        if (connected != triangles.Length) throw Refusal("disconnected_shells", "Supply each connected closed shell as a separate solid; disconnected or nested shells are not inferred.", id);
        // Edge multiplicity alone misses pinched/bow-tie vertices. Qualify each
        // incident face fan as one cycle without a heuristic weld or repair.
        var marks = new int[triangles.Length]; int stamp = 0;
        for (var vertex = 0; vertex < incident.Length; vertex++)
        {
            budget.Spend(); var faces = incident[vertex]; if (faces.Count == 0) continue;
            stamp++; queue.Enqueue(faces[0]); marks[faces[0]] = stamp; int fan = 0;
            while (queue.Count > 0)
            {
                budget.Spend(); int current = queue.Dequeue(); fan++;
                foreach (int next in adjacent[current])
                {
                    budget.Spend(); var t = triangles[next];
                    if (marks[next] == stamp || t.Ia != vertex && t.Ib != vertex && t.Ic != vertex) continue;
                    marks[next] = stamp; queue.Enqueue(next);
                }
            }
            if (fan != faces.Count) throw Refusal("nonmanifold_vertex", "A solid vertex has disconnected incident face fans.", id);
        }
        // Translation-relative signed volume guards collapsed shells. The sign
        // can be either orientation; no global preferred winding is imposed.
        var origin = triangles[0].A; double volume6 = 0, correction = 0;
        foreach (var triangle in triangles)
        {
            budget.Spend(); double term = V.Dot(triangle.A - origin, V.Cross(triangle.B - origin, triangle.C - origin)) - correction;
            double next = volume6 + term; correction = (next - volume6) - term; volume6 = next;
        }
        if (!double.IsFinite(volume6) || Math.Abs(volume6) <= tolerance * tolerance * tolerance)
            throw Refusal("collapsed_solid", "The qualified shell has zero or numerically unsupported signed volume.", id);
        return triangles;
    }

    private static int BuildNode(Triangle[] triangles, int[] order, int start, int count,
        List<BvhNode> nodes, BarrierLimits limits, int vertices, Budget budget)
    {
        budget.Spend();
        if (nodes.Count >= limits.MaximumBvhNodes) throw Refusal("resource_limit", "BVH node count exceeds its limit.");
        CheckMemory(limits, vertices, triangles.Length, nodes.Count + 1);
        int index = nodes.Count; nodes.Add(default);
        var bounds = triangles[order[start]].Bounds;
        for (var offset = 1; offset < count; offset++) { budget.Spend(); bounds = Box.Union(bounds, triangles[order[start + offset]].Bounds); }
        if (count <= limits.BvhLeafSize) nodes[index] = new(bounds, start, count, -1, -1);
        else
        {
            int axis = bounds.LongestAxis;
            Array.Sort(order, start, count, Comparer<int>.Create((a, b) =>
            {
                budget.Spend(); int result = triangles[a].Bounds.Centre(axis).CompareTo(triangles[b].Bounds.Centre(axis));
                return result != 0 ? result : a.CompareTo(b);
            }));
            int firstCount = count / 2;
            int left = BuildNode(triangles, order, start, firstCount, nodes, limits, vertices, budget);
            int right = BuildNode(triangles, order, start + firstCount, count - firstCount, nodes, limits, vertices, budget);
            nodes[index] = new(bounds, 0, 0, left, right);
        }
        return index;
    }

    private static void ValidateEmbedding(Triangle[] triangles, int[] order, BvhNode[] nodes,
        List<Solid> solids, double tolerance, Budget budget)
    {
        for (var index = 0; index < triangles.Length; index++)
        {
            budget.Spend(); var first = triangles[index]; var stack = new Stack<int>(); stack.Push(0);
            while (stack.Count > 0)
            {
                budget.Spend(); var node = nodes[stack.Pop()]; if (!node.Bounds.Overlaps(first.Bounds, tolerance)) continue;
                if (node.Count == 0) { stack.Push(node.Right); stack.Push(node.Left); continue; }
                for (var offset = 0; offset < node.Count; offset++)
                {
                    budget.Spend(); int otherIndex = order[node.Start + offset]; if (otherIndex <= index) continue;
                    var other = triangles[otherIndex]; if (first.Solid != other.Solid || !first.Bounds.Overlaps(other.Bounds, tolerance)) continue;
                    var shared = new List<V>(2);
                    for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++)
                        if (first.IndexAt(a) == other.IndexAt(b)) shared.Add(first.At(a));
                    bool Allowed(V value) => shared.Count == 1 ? (value - shared[0]).Length <= tolerance
                        : shared.Count == 2 && (value - Geometry.ClosestOnSegment(value, shared[0], shared[1])).Length <= tolerance;
                    for (var edge = 0; edge < 6; edge++)
                    {
                        budget.Spend(8); var source = edge < 3 ? first : other; var target = edge < 3 ? other : first; int side = edge % 3;
                        double scale = Math.Max(Geometry.Longest(target), Math.Max((source.At(side) - target.A).Length,
                            (source.At((side + 1) % 3) - target.A).Length));
                        double uncertainty = Geometry.ArithmeticGuard(target, scale);
                        if (!double.IsFinite(uncertainty) || uncertainty > tolerance)
                            throw Refusal("ill_conditioned_geometry", "Self-intersection qualification is too poorly conditioned at the triangle-pair scale for this numeric tolerance.", solids[first.Solid].Id);
                        foreach (var contact in Geometry.SegmentContacts(source.At(side), source.At((side + 1) % 3), target, tolerance))
                            if (!Allowed(contact.First) || !Allowed(contact.Second))
                                throw Refusal("self_intersection", "The closed shell self-intersects, overlaps or has nonadjacent surfaces within numeric tolerance.", solids[first.Solid].Id);
                    }
                }
            }
        }
    }

    private readonly record struct Solid(string Id, int Start, int Count, Box Bounds);
    private readonly record struct EdgeUse(int First, int Direction, int Second);
    private readonly record struct BvhNode(Box Bounds, int Start, int Count, int Left, int Right);
    private static GeometryRefusal Refusal(string code, string message, string? id = null) => new(new(code, message, id));
    private sealed class GeometryRefusal(BarrierDiagnostic diagnostic) : Exception(diagnostic.Message)
    {
        internal BarrierDiagnostic Diagnostic { get; } = diagnostic;
    }
    private sealed class Budget(long maximum, int maximumMilliseconds, CancellationToken token)
    {
        private readonly long started = System.Diagnostics.Stopwatch.GetTimestamp();
        private long checkAt;
        internal long Work { get; private set; }
        internal void Checkpoint()
        {
            token.ThrowIfCancellationRequested();
            if (System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds >= maximumMilliseconds)
                throw Refusal("deadline_exceeded", "The cooperative geometry deadline was exceeded.");
        }
        internal void Spend(long amount = 1)
        {
            if (Work >= checkAt) { Checkpoint(); checkAt = Work + 256; }
            if (amount > maximum - Work) throw Refusal("resource_limit", "The deterministic geometry work budget was exhausted.");
            Work += amount;
        }
    }
}
