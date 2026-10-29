using System.Diagnostics;
using System.Text.Json;
using PathFinder.Barriers;
using static Fixtures;

internal static class Program
{
    private static readonly List<object> Checks = [];
    private static int failures;
    private static NumericPropertyStats? numericPropertyStats;
    private sealed record NumericPropertyStats(int Seed, int Trials, int Ready, int Refused, int Blocked, int Indeterminate, int CheckedSegments, int OrdinaryReady);

    private static int Main(string[] args)
    {
        if (args is ["--workload-smoke"]) return WorkloadSmoke();
        if (args.Length != 0) return 2;
        Geometry(); NumericProperties(); InvalidGeometry(); Limits(); Cancellation();
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = "wfc.pf.barrier-kernel-checks.v1",
            status = failures == 0 ? "PASS" : "FAIL",
            passed = Checks.Count - failures, failed = failures,
            scope = "Synthetic standalone whole-mesh barrier kernel checks only; no WFC routing, live model, openings survey or engineering acceptance",
            engineeringAccepted = false, nativeParity = "not-performed", numericPropertyStats, checks = Checks
        }));
        return failures == 0 ? 0 : 1;
    }

    private static int WorkloadSmoke()
    {
        var limits = new BarrierLimits();
        var buildClock = new Stopwatch(); var queryClock = new Stopwatch();
        BarrierKernelSummary? summary = null;
        long buildWork = 0, queryTotalWork = 0, maximumObservedQueryWork = 0;
        var queries = 0; var blocked = 0; var clear = 0; var indeterminate = 0;
        var mismatches = new List<object>(); string? error = null;
        try
        {
            var meshes = Enumerable.Range(0, 200).Select(i =>
            {
                var (x, y, z) = Origin(i);
                return Box("workload-" + i, x, x + .2, y - 2, y + 2, z - 2, z + 2);
            }).ToArray();
            buildClock.Start();
            var build = BarrierCollisionKernel.Build(meshes, limits);
            buildClock.Stop(); buildWork = build.Work; summary = build.Kernel?.Summary;
            Equal(BarrierBuildStatus.Ready, build.Status);
            Need(build.Kernel is not null, "Workload build did not return a kernel.");
            Equal(200, summary!.MeshCount); Equal(1600, summary.VertexCount); Equal(2400, summary.TriangleCount);
            var kernel = build.Kernel!;
            queryClock.Start();
            for (var i = 0; i < 2000; i++)
            {
                // Each pair exercises one solid, so all 200 are queried five times
                // with both a crossing segment and an unobstructed same-side segment.
                var index = (i / 2) % 200; var (x, y, z) = Origin(index);
                var expected = i % 2 == 0 ? BarrierSegmentStatus.Blocked : BarrierSegmentStatus.Clear;
                var result = kernel.CheckSegment(P(x - 1, y, z), P(expected == BarrierSegmentStatus.Blocked ? x + 1 : x - .5, y, z));
                queries++; queryTotalWork += result.Work;
                maximumObservedQueryWork = Math.Max(maximumObservedQueryWork, result.Work);
                if (result.Status == BarrierSegmentStatus.Blocked) blocked++;
                else if (result.Status == BarrierSegmentStatus.Clear) clear++;
                else indeterminate++;
                if (result.Status != expected && mismatches.Count < 8)
                    mismatches.Add(new { query = i, solid = index, expected = expected.ToString(), observed = result.Status.ToString(), result.Reason });
                Need(result.Work >= 0, "Workload query reported negative work.");
            }
            queryClock.Stop();
            Need(mismatches.Count == 0, "At least one workload query returned an unexpected status.");
            Equal(2000, queries); Equal(1000, blocked); Equal(1000, clear); Equal(0, indeterminate);
        }
        catch (Exception e) { error = e.GetType().Name + ": " + e.Message; }
        finally { buildClock.Stop(); queryClock.Stop(); }
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = "wfc.pf.barrier-kernel-workload-smoke.v1", status = error is null ? "PASS" : "FAIL",
            scope = "Synthetic 200-solid / 2400-triangle / 1600-vertex smoke with 2000 bounded centreline queries; not maximum-capacity qualification",
            maximumCapacityVerified = false, physicalCableRadiusChecked = false, engineeringAccepted = false, nativeParity = "not-performed",
            meshes = 200, vertices = 1600, triangles = 2400, queries, blocked, clear, indeterminate,
            limits, summary, buildMilliseconds = buildClock.Elapsed.TotalMilliseconds,
            queryTotalMilliseconds = queryClock.Elapsed.TotalMilliseconds, buildWork, queryTotalWork, maximumObservedQueryWork,
            currentProcessPeakWorkingSet64 = Process.GetCurrentProcess().PeakWorkingSet64, mismatches, error
        }));
        return error is null ? 0 : 1;

        static (double X, double Y, double Z) Origin(int index) => ((index % 10) * 10, ((index / 10) % 10) * 10, (index / 100) * 10);
    }

    private static void Run(string name, Action action)
    {
        try { action(); Checks.Add(new { name, status = "PASS", detail = "" }); }
        catch (Exception e) { failures++; Checks.Add(new { name, status = "FAIL", detail = e.GetType().Name + ": " + e.Message }); }
    }
    private static void Need(bool condition, string message = "Synthetic assertion failed.")
    {
        if (!condition) throw new InvalidOperationException(message);
    }
    private static void Equal<T>(T expected, T observed) => Need(EqualityComparer<T>.Default.Equals(expected, observed), $"Expected {expected}; observed {observed}.");
    private static void Cancelled(Action action)
    {
        try { action(); } catch (OperationCanceledException) { return; }
        throw new InvalidOperationException("Cancellation must not return a successful geometry decision.");
    }
    private static BarrierCollisionKernel Kernel(IEnumerable<BarrierMeshInput> meshes, BarrierLimits? limits = null)
    {
        var result = BarrierCollisionKernel.Build(meshes, limits);
        Equal(BarrierBuildStatus.Ready, result.Status);
        Need(result.Kernel is not null, "Ready build did not provide a kernel.");
        return result.Kernel!;
    }
    private static void Refused(IEnumerable<BarrierMeshInput> meshes, BarrierLimits? limits = null)
    {
        var result = BarrierCollisionKernel.Build(meshes, limits);
        Equal(BarrierBuildStatus.Refused, result.Status);
        Need(result.Kernel is null, "Refused build exposed a usable kernel.");
        Need(result.Diagnostics.Count > 0 && result.Diagnostics.All(d => !string.IsNullOrWhiteSpace(d.Code) && !string.IsNullOrWhiteSpace(d.Message)), "Refusal needs explicit diagnostics.");
    }
    private static void Segment(BarrierCollisionKernel kernel, BarrierPoint from, BarrierPoint to, BarrierSegmentStatus expected, string? barrierId = null)
    {
        var result = kernel.CheckSegment(from, to);
        Equal(expected, result.Status);
        Need(!string.IsNullOrWhiteSpace(result.Reason), "Segment result needs a reason.");
        Need(result.Work >= 0, "Reported work must be nonnegative.");
        if (barrierId is not null) Equal(barrierId, result.BarrierId);
    }
    private static void NeverClear(BarrierMeshInput mesh, BarrierPoint from, BarrierPoint to)
    {
        var build = BarrierCollisionKernel.Build([mesh]);
        if (build.Status == BarrierBuildStatus.Refused)
        {
            Need(build.Kernel is null && build.Diagnostics.Count > 0, "Conditioning refusal needs diagnostics and no usable kernel.");
            return;
        }
        Equal(BarrierBuildStatus.Ready, build.Status);
        Need(build.Kernel is not null, "Ready conditioning result needs a kernel.");
        var query = build.Kernel!.CheckSegment(from, to);
        Need(query.Status is BarrierSegmentStatus.Blocked or BarrierSegmentStatus.Indeterminate, "A segment through the poorly conditioned solid was reported clear.");
    }

    private static void Geometry()
    {
        Run("empty barrier scope refuses without a server-owned no-barrier declaration", () => Refused([]));
        Run("solid wall blocks a through segment and identifies barrier", () => Segment(Kernel([Box()]), P(-1), P(1), BarrierSegmentStatus.Blocked, "wall"));
        Run("wall crossing is independent of segment direction", () => Segment(Kernel([Box()]), P(1), P(-1), BarrierSegmentStatus.Blocked, "wall"));
        Run("unobstructed same-side approach is clear", () => Segment(Kernel([Box()]), P(-2, -1), P(-1, 1), BarrierSegmentStatus.Clear));
        Run("outside wall bounds remains clear", () => Segment(Kernel([Box()]), P(-1, 3), P(1, 3), BarrierSegmentStatus.Clear));
        Run("start inside a closed wall is blocked", () => Segment(Kernel([Box()]), P(.1), P(-1), BarrierSegmentStatus.Blocked));
        Run("end inside a closed wall is blocked", () => Segment(Kernel([Box()]), P(-1), P(.1), BarrierSegmentStatus.Blocked));
        Run("both endpoints inside a closed wall are blocked", () => Segment(Kernel([Box()]), P(.05), P(.15), BarrierSegmentStatus.Blocked));
        Run("zero-length interior point is blocked", () => Segment(Kernel([Box()]), P(.1), P(.1), BarrierSegmentStatus.Blocked));
        Run("zero-length exterior point is clear", () => Segment(Kernel([Box()]), P(-1), P(-1), BarrierSegmentStatus.Clear));
        Run("start on wall surface is blocked", () => Segment(Kernel([Box()]), P(0), P(-1), BarrierSegmentStatus.Blocked));
        Run("end on wall surface is blocked", () => Segment(Kernel([Box()]), P(-1), P(0), BarrierSegmentStatus.Blocked));
        Run("zero-length surface point is blocked", () => Segment(Kernel([Box()]), P(0), P(0), BarrierSegmentStatus.Blocked));
        Run("coplanar travel within a face is blocked", () => Segment(Kernel([Box()]), P(0, -.5, -.5), P(0, .5, .5), BarrierSegmentStatus.Blocked));
        Run("coplanar segment crossing a face boundary is blocked", () => Segment(Kernel([Box()]), P(0, -3), P(0, 3), BarrierSegmentStatus.Blocked));
        Run("coplanar travel outside the face remains clear", () => Segment(Kernel([Box()]), P(0, 3, -1), P(0, 3, 1), BarrierSegmentStatus.Clear));
        Run("edge contact is blocked", () => Segment(Kernel([Box()]), P(-1, -2), P(1, -2), BarrierSegmentStatus.Blocked));
        Run("vertex contact is blocked", () => Segment(Kernel([Box()]), P(-1, -2, -2), P(0, -2, -2), BarrierSegmentStatus.Blocked));
        Run("travel along a closed-solid edge is blocked", () => Segment(Kernel([Box()]), P(0, -2, -1), P(0, -2, 1), BarrierSegmentStatus.Blocked));
        Run("supported 0.1 mm thin wall is blocked", () => Segment(Kernel([Box(x1: .0001)]), P(-1), P(1), BarrierSegmentStatus.Blocked));
        Run("10 micrometre wall outside embedding guard can never be unsafe clear", () => NeverClear(Box(x1: .00001), P(-1), P(1)));
        Run("poorly conditioned huge-aspect solid can never produce unsafe clear", () => NeverClear(
            Box("ill-conditioned", x0: 0, x1: 1e9, y0: 0, y1: 1e-4, z0: 0, z1: 1e-3),
            P(.75e9, 2e-5, -.001), P(.75e9, 2e-5, .002)));
        Run("huge-aspect interior point can never produce unsafe clear", () => NeverClear(
            Box("ill-conditioned-point", x0: 0, x1: 1e9, y0: 0, y1: 1e-4, z0: 0, z1: 1e-3),
            P(.75e9, 2e-5, .0005), P(.75e9, 2e-5, .0005)));
        Run("rotated translated huge-aspect solid can never produce unsafe clear", () => NeverClear(
            Transform(Box("ill-conditioned-rotated", x0: 0, x1: 5e8, y0: 0, y1: 1e-4, z0: 0, z1: 1e-3), RotateTranslate),
            RotateTranslate(P(.75 * 5e8, 2e-5, -.001)), RotateTranslate(P(.75 * 5e8, 2e-5, .002))));
        Run("far endpoint conditioning cannot report clear through an ordinary wall", () =>
        {
            var result = Kernel([Box()]).CheckSegment(P(-1e8), P(1e8));
            Need(result.Status is BarrierSegmentStatus.Blocked or BarrierSegmentStatus.Indeterminate, "The long segment through an ordinary wall was reported clear.");
        });
        Run("whole reversed winding still blocks and contains", () => { var k = Kernel([Reverse(Box())]); Segment(k, P(-1), P(1), BarrierSegmentStatus.Blocked); Segment(k, P(.1), P(.1), BarrierSegmentStatus.Blocked); });
        Run("exact coordinate welding accepts triangle-local vertices", () => Segment(Kernel([UnsharedVertices(Box())]), P(-1), P(1), BarrierSegmentStatus.Blocked));
        Run("connected frame really contains 16 vertices and 32 triangles", () => { var f = ConnectedFrame(); Equal(16, f.Vertices.Count); Equal(96, f.TriangleIndices.Count); _ = Kernel([f]); });
        Run("connected watertight tunnel preserves actual opening", () => Segment(Kernel([ConnectedFrame()]), P(-1), P(1), BarrierSegmentStatus.Clear));
        Run("off-centre segment within actual tunnel remains clear", () => Segment(Kernel([ConnectedFrame()]), P(-1, .4, .5), P(1, .4, .5), BarrierSegmentStatus.Clear));
        Run("wall material beside tunnel blocks", () => Segment(Kernel([ConnectedFrame()]), P(-1, 1), P(1, 1), BarrierSegmentStatus.Blocked));
        Run("wall material above tunnel blocks", () => Segment(Kernel([ConnectedFrame()]), P(-1, 0, 1), P(1, 0, 1), BarrierSegmentStatus.Blocked));
        Run("tunnel rim contact is blocked", () => Segment(Kernel([ConnectedFrame()]), P(-1, .6), P(1, .6), BarrierSegmentStatus.Blocked));
        Run("opening point within solid bounding box is not contained", () => Segment(Kernel([ConnectedFrame()]), P(.1), P(.1), BarrierSegmentStatus.Clear));
        Run("point in connected frame material is contained", () => Segment(Kernel([ConnectedFrame()]), P(.1, 1), P(.1, 1), BarrierSegmentStatus.Blocked));
        Run("whole reversed connected tunnel preserves opening", () => Segment(Kernel([Reverse(ConnectedFrame())]), P(-1), P(1), BarrierSegmentStatus.Clear));
        Run("opening also survives exact coordinate welding", () => Segment(Kernel([UnsharedVertices(ConnectedFrame())]), P(-1), P(1), BarrierSegmentStatus.Clear));
        Run("separate closed frame bars preserve opening", () => Segment(Kernel(SeparateFrame()), P(-1), P(1), BarrierSegmentStatus.Clear));
        Run("separate closed frame bars still block material", () => Segment(Kernel(SeparateFrame()), P(-1, 1), P(1, 1), BarrierSegmentStatus.Blocked, "right-bar"));
        Run("floor slab with actual opening permits vertical passage", () => { var f = Transform(ConnectedFrame(), p => P(p.Y, p.Z, p.X)); Segment(Kernel([f]), P(0, 0, -1), P(0, 0, 1), BarrierSegmentStatus.Clear); });
        Run("floor slab blocks cable crossing outside its opening", () => { var f = Transform(ConnectedFrame(), p => P(p.Y, p.Z, p.X)); Segment(Kernel([f]), P(1, 0, -1), P(1, 0, 1), BarrierSegmentStatus.Blocked); });
        Run("translated rotated wall uses world geometry", () => Segment(Kernel([Transform(Box(), RotateTranslate)]), RotateTranslate(P(-1)), RotateTranslate(P(1)), BarrierSegmentStatus.Blocked));
        Run("translated rotated connected opening stays passable", () => Segment(Kernel([Transform(ConnectedFrame(), RotateTranslate)]), RotateTranslate(P(-1)), RotateTranslate(P(1)), BarrierSegmentStatus.Clear));
        Run("multiple barriers return actual obstructing identity", () => Segment(Kernel([Box("far", x0: 5, x1: 5.2), Box("near")]), P(-1), P(1), BarrierSegmentStatus.Blocked, "near"));
        Run("kernel does not mutate caller-owned vertex and index arrays", () => { var f = Box(); var vertices = f.Vertices.ToArray(); var indices = f.TriangleIndices.ToArray(); _ = Kernel([f]); Need(vertices.SequenceEqual(f.Vertices)); Need(indices.SequenceEqual(f.TriangleIndices)); });
        Run("later caller mutation cannot change an immutable built kernel", () =>
        {
            var f = Box(); var vertices = f.Vertices.ToArray(); var indices = f.TriangleIndices.ToArray();
            var k = Kernel([f with { Vertices = vertices, TriangleIndices = indices }]);
            Array.Fill(vertices, P(100, 100, 100)); Array.Fill(indices, 0);
            Segment(k, P(-1), P(1), BarrierSegmentStatus.Blocked, "wall");
        });
        Run("repeated segment checks retain the same deterministic answer", () =>
        {
            var k = Kernel([ConnectedFrame()]); var first = k.CheckSegment(P(-1, 1), P(1, 1));
            for (var i = 0; i < 5; i++) Equal(first, k.CheckSegment(P(-1, 1), P(1, 1)));
        });
    }

    private static void NumericProperties()
    {
        Run("seeded numeric property: 200 transformed solid trials never produce unsafe clear", () =>
        {
            const int seed = 0x5A17B1;
            var random = new Random(seed);
            var trials = 0; var ready = 0; var refused = 0; var blocked = 0;
            var indeterminate = 0; var checkedSegments = 0; var ordinaryReady = 0;
            try
            {
                for (var i = 0; i < 200; i++)
                {
                    var ordinary = i % 5 == 0;
                    var xLength = ordinary ? 1 + 9 * random.NextDouble() : Math.Pow(10, -2 + 7 * random.NextDouble());
                    var yLength = ordinary ? 1 + 9 * random.NextDouble() : xLength * Math.Pow(10, -5 + 5 * random.NextDouble());
                    var zLength = ordinary ? 1 + 9 * random.NextDouble() : xLength * Math.Pow(10, -5 + 5 * random.NextDouble());
                    var angle = 2 * Math.PI * random.NextDouble(); var cosine = Math.Cos(angle); var sine = Math.Sin(angle);
                    var translationRange = ordinary ? 100d : 1e6;
                    var tx = (2 * random.NextDouble() - 1) * translationRange;
                    var ty = (2 * random.NextDouble() - 1) * translationRange;
                    var tz = (2 * random.NextDouble() - 1) * translationRange;
                    BarrierPoint World(BarrierPoint p) => P(tx + cosine * p.X - sine * p.Y, ty + sine * p.X + cosine * p.Y, tz + p.Z);
                    var mesh = Transform(Box("numeric-" + i, 0, xLength, -yLength / 2, yLength / 2, -zLength / 2, zLength / 2), World);
                    trials++;
                    var build = BarrierCollisionKernel.Build([mesh]);
                    if (build.Status == BarrierBuildStatus.Refused)
                    {
                        refused++;
                        Need(build.Kernel is null && build.Diagnostics.Count > 0, $"Numeric trial {i} refused without explicit diagnostics.");
                        continue;
                    }
                    Equal(BarrierBuildStatus.Ready, build.Status);
                    Need(build.Kernel is not null, $"Numeric trial {i} is Ready without a kernel.");
                    ready++; if (ordinary) ordinaryReady++;
                    var centre = World(P(xLength / 2));
                    var queries = new[]
                    {
                        (From: World(P(-xLength / 2)), To: World(P(xLength * 1.5))),
                        (From: centre, To: centre)
                    };
                    foreach (var (from, to) in queries)
                    {
                        var query = build.Kernel!.CheckSegment(from, to); checkedSegments++;
                        if (query.Status == BarrierSegmentStatus.Blocked) blocked++;
                        else if (query.Status == BarrierSegmentStatus.Indeterminate) indeterminate++;
                        Need(query.Status is BarrierSegmentStatus.Blocked or BarrierSegmentStatus.Indeterminate,
                            $"Unsafe Clear in numeric trial {i}; lengths=({xLength:R},{yLength:R},{zLength:R}), angle={angle:R}, zeroLength={from == to}.");
                    }
                }
                Equal(200, trials); Equal(trials, ready + refused);
                Need(ready >= 20 && ordinaryReady >= 20, "Numeric property requires at least 20 ordinary Ready cases; blanket refusal cannot pass.");
                Equal(ready * 2, checkedSegments); Equal(checkedSegments, blocked + indeterminate);
            }
            finally { numericPropertyStats = new(seed, trials, ready, refused, blocked, indeterminate, checkedSegments, ordinaryReady); }
        });
    }

    private static void InvalidGeometry()
    {
        Run("incomplete selected mesh refuses", () => Refused([Box() with { Complete = false }]));
        Run("empty selected mesh refuses", () => Refused([new("empty", [], [])]));
        Run("unclosed mesh refuses", () => { var f = Box(); Refused([f with { TriangleIndices = f.TriangleIndices.Skip(3).ToArray() }]); });
        Run("duplicate same-winding triangle refuses", () => { var f = Box(); Refused([f with { TriangleIndices = f.TriangleIndices.Concat(f.TriangleIndices.Take(3)).ToArray() }]); });
        Run("duplicate reversed-winding triangle refuses", () => { var f = Box(); var a = f.TriangleIndices.Take(3).Reverse(); Refused([f with { TriangleIndices = f.TriangleIndices.Concat(a).ToArray() }]); });
        Run("one reversed face violates consistent orientation", () => { var f = Box(); var a = f.TriangleIndices.ToArray(); (a[1], a[2]) = (a[2], a[1]); Refused([f with { TriangleIndices = a }]); });
        Run("nonmanifold extra triangle refuses", () => { var f = Box(); Refused([f with { TriangleIndices = f.TriangleIndices.Concat(new[] { 0, 1, 6 }).ToArray() }]); });
        Run("intersecting closed shells in one mesh refuse", () => Refused([Merge("self-intersection", Box("a", x0: 0, x1: 1, y0: 0, y1: 1, z0: 0, z1: 1), Box("b", x0: .5, x1: 1.5, y0: .5, y1: 1.5, z0: .5, z1: 1.5))]));
        Run("connected closed topology with self-crossing surface refuses", () =>
        {
            var f = Box(); var vertices = f.Vertices.ToArray(); vertices[6] = P(.1, 0, -3);
            Refused([f with { Vertices = vertices }]);
        });
        Run("repeated index creates degenerate triangle and refuses", () => { var f = Box(); var a = f.TriangleIndices.ToArray(); a[2] = a[1]; Refused([f with { TriangleIndices = a }]); });
        Run("geometrically collapsed triangle refuses", () => { var f = Box(); var v = f.Vertices.ToArray(); v[1] = v[0]; Refused([f with { Vertices = v }]); });
        Run("out-of-range positive triangle index refuses", () => { var f = Box(); var a = f.TriangleIndices.ToArray(); a[0] = f.Vertices.Count; Refused([f with { TriangleIndices = a }]); });
        Run("negative triangle index refuses", () => { var f = Box(); var a = f.TriangleIndices.ToArray(); a[0] = -1; Refused([f with { TriangleIndices = a }]); });
        Run("trailing partial triangle refuses", () => { var f = Box(); Refused([f with { TriangleIndices = f.TriangleIndices.Concat(new[] { 0 }).ToArray() }]); });
        foreach (var value in new[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity })
        {
            var bad = value;
            Run("nonfinite vertex refuses: " + value, () => { var f = Box(); var v = f.Vertices.ToArray(); v[0] = P(bad); Refused([f with { Vertices = v }]); });
            Run("nonfinite segment is indeterminate: " + value, () => Segment(Kernel([Box()]), P(bad), P(1), BarrierSegmentStatus.Indeterminate));
        }
        Run("coordinate beyond configured magnitude refuses", () => Refused([Box(x0: 1e10, x1: 1e10 + 1)]));
        Run("query coordinate beyond configured magnitude is indeterminate", () => Segment(Kernel([Box()]), P(1e10), P(1), BarrierSegmentStatus.Indeterminate));
        Run("duplicate barrier identities refuse", () => Refused([Box(), Box(x0: 3, x1: 4)]));
        Run("empty barrier identity refuses", () => Refused([Box("")]));
    }

    private static void Limits()
    {
        Run("mesh count budget refuses rather than omitting barriers", () => Refused([Box("a"), Box("b", x0: 3, x1: 4)], new() { MaximumMeshes = 1 }));
        Run("triangle budget refuses rather than truncating geometry", () => Refused([Box()], new() { MaximumTriangles = 11 }));
        Run("vertex budget refuses rather than truncating geometry", () => Refused([Box()], new() { MaximumVertices = 7 }));
        Run("BVH node budget refuses rather than building partial tree", () => Refused([Box()], new() { BvhLeafSize = 1, MaximumBvhNodes = 1 }));
        Run("build work exhaustion refuses rather than accepting unchecked topology", () => Refused([Box()], new() { MaximumBuildWork = 1 }));
        Run("estimated allocation budget refuses before unbounded work", () => Refused([Box()], new() { MaximumEstimatedBytes = 1 }));
        Run("query work exhaustion is indeterminate, never clear", () => Segment(Kernel([Box()], new() { MaximumQueryWork = 1 }), P(-1), P(1), BarrierSegmentStatus.Indeterminate));
        Run("limited coordinate policy is applied to geometry", () => Refused([Box()], new() { MaximumCoordinateMagnitude = 1 }));
        Run("zero mesh budget is invalid", () => Refused([], new() { MaximumMeshes = 0 }));
        Run("zero triangle budget is invalid", () => Refused([], new() { MaximumTriangles = 0 }));
        Run("zero vertex budget is invalid", () => Refused([], new() { MaximumVertices = 0 }));
        Run("zero BVH node budget is invalid", () => Refused([], new() { MaximumBvhNodes = 0 }));
        Run("zero build work budget is invalid", () => Refused([], new() { MaximumBuildWork = 0 }));
        Run("zero query work budget is invalid", () => Refused([], new() { MaximumQueryWork = 0 }));
        Run("zero estimated byte budget is invalid", () => Refused([], new() { MaximumEstimatedBytes = 0 }));
        Run("zero BVH leaf size is invalid", () => Refused([], new() { BvhLeafSize = 0 }));
        Run("nonpositive numeric tolerance is invalid", () => Refused([], new() { NumericToleranceMeters = 0 }));
        Run("nonfinite numeric tolerance is invalid", () => Refused([], new() { NumericToleranceMeters = double.NaN }));
        Run("nonfinite maximum coordinate is invalid", () => Refused([], new() { MaximumCoordinateMagnitude = double.PositiveInfinity }));
    }

    private static void Cancellation()
    {
        Run("already cancelled build throws before returning usable kernel", () => { using var c = new CancellationTokenSource(); c.Cancel(); Cancelled(() => BarrierCollisionKernel.Build([Box()], cancellationToken: c.Token)); });
        Run("cancellation during mesh enumeration prevents ready build", () =>
        {
            using var c = new CancellationTokenSource();
            IEnumerable<BarrierMeshInput> Input() { yield return Box("a"); c.Cancel(); yield return Box("b", x0: 3, x1: 4); }
            Cancelled(() => BarrierCollisionKernel.Build(Input(), cancellationToken: c.Token));
        });
        Run("already cancelled segment query throws rather than reporting clear", () => { var k = Kernel([Box()]); using var c = new CancellationTokenSource(); c.Cancel(); Cancelled(() => k.CheckSegment(P(-1), P(1), c.Token)); });
    }
}
