using System.Buffers.Binary;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Barriers;
using static Fixtures;

internal static class Program
{
    private static readonly List<object> Checks = [];
    private static int failures;
    private static readonly string Identity = new('a', 64);
    private static readonly string OtherIdentity = new('b', 64);
    private static readonly RouteCalculator Calculator = new();
    private static readonly TraySegment[] Chain = [Tray("C001", P(0), P(3)), Tray("C002", P(3), P(7)), Tray("C003", P(7), P(10))];
    private static readonly TraySegment[] Diamond = [Tray("C001", P(0), P(1)), Tray("BC100", P(1), P(9)),
        Tray("BC200", P(1), P(1, 5), P(9, 5), P(9)), Tray("C002", P(9), P(10))];

    private static int Main(string[] args)
    {
        if (args is ["--fingerprint-contract"]) return FingerprintContract();
        if (args is ["--benchmark"]) return Benchmark();
        if (args.Length != 0) return 2;
        PlainParity(); SelectionInputs(); LimitsAndCancellation(); ScopeAndBounds(); Persistence(); ConstrainedParity();
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = "wfc.pf.graph-reuse-checks.v1", status = failures == 0 ? "PASS" : "FAIL",
            passed = Checks.Count - failures, failed = failures,
            scope = "Synthetic exact before/cache parity, original closed-mesh opening and failure controls; not a real-model timing or engineering acceptance claim",
            checks = Checks
        }));
        return failures == 0 ? 0 : 1;
    }

    private static void Test(string name, Action body)
    {
        try { body(); Checks.Add(new { name, status = "PASS", detail = "" }); }
        catch (Exception error) { failures++; Checks.Add(new { name, status = "FAIL", detail = error.GetType().Name + ": " + error.Message }); }
    }
    private static void Need(bool condition, string reason = "Graph-reuse assertion failed.")
    { if (!condition) throw new InvalidOperationException(reason); }
    private static void Equal<T>(T expected, T actual, string reason = "Value differs.") => Need(EqualityComparer<T>.Default.Equals(expected, actual), reason + $" Expected {expected}; actual {actual}.");
    private static RoutingOptions Options(double tolerance = .1, int maxNodes = 10000, int maxConnections = 30000, bool vertical = false) =>
        new() { ConnectionToleranceMeters = tolerance, SampleSpacingMeters = .125, SecondaryDistanceMeters = 2,
            MaxGraphNodes = maxNodes, MaxGraphConnections = maxConnections, PreferVerticalApproach = vertical };
    private static string Semantic<T>(T value) => JsonSerializer.Serialize(value);
    private static void Exact(RouteResult expected, RouteResult actual)
    {
        Equal(Semantic(expected), Semantic(actual), "Full result changed.");
        Equal(BitConverter.DoubleToInt64Bits(expected.LengthMeters), BitConverter.DoubleToInt64Bits(actual.LengthMeters), "Physical length changed.");
        Equal(expected.PathPoints.Count, actual.PathPoints.Count);
        for (int i = 0; i < expected.PathPoints.Count; i++)
        {
            var a = expected.PathPoints[i]; var b = actual.PathPoints[i];
            Need(BitConverter.DoubleToInt64Bits(a.X) == BitConverter.DoubleToInt64Bits(b.X)
                && BitConverter.DoubleToInt64Bits(a.Y) == BitConverter.DoubleToInt64Bits(b.Y)
                && BitConverter.DoubleToInt64Bits(a.Z) == BitConverter.DoubleToInt64Bits(b.Z), "Ordered polyline coordinate bits changed.");
        }
    }
    private static T Without<T>(Func<T> calculate)
    {
        var cache = new GraphPreparationCache(); using var request = cache.BeginRequest(Identity, false);
        var result = calculate(); Equal(0L, Convert.ToInt64(request.Diagnostics.BasisBuilds), "Disabled cache built a basis.");
        return result;
    }
    private static RouteResult Route(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
        RoutingOptions? options = null, CableCategory category = CableCategory.Control, CancellationToken token = default) =>
        Calculator.Calculate(trays, from, to, category, options ?? Options(), token);
    private static void ExactAt(GraphPreparationCache cache, IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
        RoutingOptions? options = null, CableCategory category = CableCategory.Control, string? identity = null)
    {
        var expected = Without(() => Route(trays, from, to, options, category));
        using var request = cache.BeginRequest(identity ?? Identity);
        Exact(expected, Route(trays, from, to, options, category));
    }

    private sealed record Timing(double WholeMilliseconds, long AllocatedBytes, long BasisBuilds, long MemoryHits, long SurfaceQueries,
        long SurfaceHits, long CandidatePairs, double FingerprintMilliseconds, double TreeMilliseconds, double SurfaceMilliseconds,
        double GraphMilliseconds, long RetainedBytes);
    private static int FingerprintContract()
    {
        object Capture(string label, TraySegment[] trays, RoutePoint from, RoutePoint to)
        {
            var cache = new GraphPreparationCache(); RouteResult route;
            using (var request = cache.BeginRequest(Identity)) route = Route(trays, from, to);
            var payload = cache.Export(Identity); Need(payload is { Length: > 0 });
            using var stream = new MemoryStream(payload!); using var reader = new BinaryReader(stream);
            string Text() { int bytes = reader.ReadInt32(); return System.Text.Encoding.UTF8.GetString(reader.ReadBytes(bytes)); }
            var version = Text(); var owner = Text(); int count = reader.ReadInt32(); Need(count == 1); var fingerprint = Text();
            return new { label, version, owner, recipeCount = count, fingerprint, bytes = payload!.Length,
                artifactSha256 = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant(),
                routeSha256 = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Semantic(route)))).ToLowerInvariant() };
        }
        try
        {
            var cases = new[] { Capture("plain-chain", Chain, P(0), P(10)), Capture("physical-surfaces", SurfaceNetwork(), P(0), P(10, 1)) };
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.graph-fingerprint-contract.v1", status = "PASS",
                coreAssemblySha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(RouteCalculator).Assembly.Location))).ToLowerInvariant(), cases }));
            return 0;
        }
        catch (Exception error)
        { Console.WriteLine(JsonSerializer.Serialize(new { status = "FAIL", detail = error.GetType().Name + ": " + error.Message })); return 1; }
    }
    private static Timing Timed(GraphPreparationCache cache, Func<RouteResult> calculate, bool enabled, out RouteResult result)
    {
        using var request = cache.BeginRequest(Identity, enabled);
        long allocated = GC.GetAllocatedBytesForCurrentThread(); var watch = Stopwatch.StartNew(); result = calculate(); watch.Stop();
        var d = request.Diagnostics;
        return new(watch.Elapsed.TotalMilliseconds, GC.GetAllocatedBytesForCurrentThread() - allocated, d.BasisBuilds, d.BasisMemoryHits,
            d.SurfaceQueries, d.SurfaceCacheHits, d.CandidatePairs, d.FingerprintMilliseconds, d.TreeBuildMilliseconds,
            d.SurfaceMilliseconds, d.GraphMilliseconds, d.CacheBytes);
    }
    private static object TimingSummary(IReadOnlyList<Timing> values)
    {
        var ordered = values.OrderBy(v => v.WholeMilliseconds).ToArray();
        return new
        {
            runs = values.Count, medianMilliseconds = ordered[ordered.Length / 2].WholeMilliseconds,
            p95Milliseconds = ordered[Math.Min(ordered.Length - 1, (int)Math.Ceiling(ordered.Length * .95) - 1)].WholeMilliseconds,
            meanAllocatedBytes = values.Average(v => v.AllocatedBytes), basisBuilds = values.Sum(v => v.BasisBuilds),
            memoryHits = values.Sum(v => v.MemoryHits), surfaceQueries = values.Sum(v => v.SurfaceQueries), surfaceHits = values.Sum(v => v.SurfaceHits),
            candidatePairs = values.Sum(v => v.CandidatePairs), meanFingerprintMilliseconds = values.Average(v => v.FingerprintMilliseconds),
            meanTreeMilliseconds = values.Average(v => v.TreeMilliseconds), meanSurfaceMilliseconds = values.Average(v => v.SurfaceMilliseconds),
            meanGraphMilliseconds = values.Average(v => v.GraphMilliseconds), maximumRetainedBytes = values.Max(v => v.RetainedBytes)
        };
    }
    private static object BenchCase(string label, TraySegment[] trays, Func<int, (RoutePoint From, RoutePoint To)> endpoints, int repetitions = 12)
    {
        var original = new GraphPreparationCache(); var prepared = new GraphPreparationCache();
        // JIT and the pre-existing immutable surface proof caches are warmed for
        // both sides. This compares graph preparation, not accidental CLR startup.
        for (int i = 0; i < 3; i++) { var p = endpoints(i); _ = Without(() => Route(trays, p.From, p.To)); }
        var initial = endpoints(0); var cold = Timed(prepared, () => Route(trays, initial.From, initial.To), true, out var coldRoute);
        Exact(Without(() => Route(trays, initial.From, initial.To)), coldRoute);
        var baseline = new List<Timing>(); var warm = new List<Timing>();
        for (int i = 0; i < repetitions; i++)
        {
            var p = endpoints(i + 1); Func<RouteResult> calculate = () => Route(trays, p.From, p.To);
            Timing before, after; RouteResult expected, actual;
            if (i % 2 == 0) { before = Timed(original, calculate, false, out expected); after = Timed(prepared, calculate, true, out actual); }
            else { after = Timed(prepared, calculate, true, out actual); before = Timed(original, calculate, false, out expected); }
            Exact(expected, actual); Need(actual.Success, "Timing fixture has no route."); baseline.Add(before); warm.Add(after);
        }
        return new { label, trays = trays.Length, changedEndpoints = true, exactResults = true, cold, baseline = TimingSummary(baseline), warm = TimingSummary(warm) };
    }
    private static int Benchmark()
    {
        try
        {
            var sparse = Enumerable.Range(0, 240).Select(i => Tray("C" + i.ToString("D3"), P(i), P(i + 1))).ToArray();
            var grid = Enumerable.Range(0, 35).Select(i => Tray("H" + i.ToString("D2"), P(0, i), P(34, i)))
                .Concat(Enumerable.Range(0, 35).Select(i => Tray("V" + i.ToString("D2"), P(i, 0), P(i, 34)))).ToArray();
            var surfaces = Enumerable.Range(0, 28).Select(i =>
            {
                double y = .05 * i; var box = Box("mesh" + i, x0: 0, x1: 20, y0: y - .2, y1: y + .2, z0: -.03, z1: .03);
                var mesh = new TrayMeshData([new TrayMeshFragment(box.Vertices.Select(p => P(p.X, p.Y, p.Z)), box.TriangleIndices)]);
                Need(TrayMeshClearance.TryCreate(mesh, [], false, default, out var surface, out var reason), reason);
                return new TraySegment("M" + i.ToString("D2"), "/M" + i.ToString("D2"), CableCategory.Control,
                    [P(0, y), P(20, y)], false, [], [surface]);
            }).ToArray();
            var results = new[]
            {
                BenchCase("240 sparse consecutive trays", sparse, i => (P(.2 + .01 * (i % 10)), P(239.7 - .01 * (i % 10)))),
                BenchCase("35 by 35 intersecting grid", grid, i => (P(.3 + .02 * (i % 10), .2), P(33.7 - .02 * (i % 10), 33.8))),
                BenchCase("28 parallel trays with retained physical surfaces", surfaces,
                    i => (P(.3 + .02 * (i % 10), 0), P(19.7 - .02 * (i % 10), 1.35)))
            };
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.graph-reuse-synthetic-timing.v1", status = "PASS",
                scope = "Synthetic in-process RouteCalculator only, alternating original/prepared queries with changed endpoints; excludes Save, database, worker, popup and real-model runtime",
                results })); return 0;
        }
        catch (Exception error)
        { Console.WriteLine(JsonSerializer.Serialize(new { status = "FAIL", detail = error.GetType().Name + ": " + error.Message })); return 1; }
    }

    private static void PlainParity()
    {
        Test("cold and warm chain retain every result field and independent physical length", () =>
        {
            var cache = new GraphPreparationCache(); var expected = Without(() => Route(Chain, P(0), P(10)));
            Need(expected.Success); Equal(10d, expected.LengthMeters); Equal("/C001/C002/C003", expected.RouteText);
            using (var cold = cache.BeginRequest(Identity))
            { Exact(expected, Route(Chain, P(0), P(10))); Need(cold.Diagnostics.BasisBuilds > 0); }
            using (var warm = cache.BeginRequest(Identity))
            { Exact(expected, Route(Chain, P(0), P(10))); Need(warm.Diagnostics.BasisMemoryHits > 0); Equal(0L, Convert.ToInt64(warm.Diagnostics.BasisBuilds)); }
        });
        Test("new endpoints and reverse order reuse only static preparation", () =>
        {
            var cache = new GraphPreparationCache();
            foreach (var (from, to) in new[] { (P(0), P(10)), (P(2), P(8)), (P(8), P(2)), (P(1, -.25), P(9, .4)), (P(0), P(10)) })
                ExactAt(cache, Chain, from, to);
            using var final = cache.BeginRequest(Identity); var actual = Route(Chain, P(2), P(8));
            Need(final.Diagnostics.BasisMemoryHits > 0); Equal(6d, actual.LengthMeters); Equal(P(2), actual.PathPoints[0]); Equal(P(8), actual.PathPoints[^1]);
        });
        Test("parallel interior attachments remain endpoint-specific in A B A query order", () =>
        {
            var trays = new[] { Tray("A", P(0), P(10)), Tray("B", P(0, .2), P(10, .2)) };
            var cache = new GraphPreparationCache();
            foreach (var (from, to) in new[] { (P(3.125), P(6.875, .2)), (P(8.75), P(1.25, .2)),
                (P(1.25, .2), P(8.75)), (P(3.125), P(6.875, .2)) }) ExactAt(cache, trays, from, to, Options(.25));
        });
        Test("equal-cost branch choice and input sorting retain original tie order", () =>
        {
            var equal = new[] { Tray("START", P(0), P(1)), Tray("A", P(1), P(1, 2), P(9, 2), P(9)),
                Tray("B", P(1), P(1, -2), P(9, -2), P(9)), Tray("END", P(9), P(10)) };
            var expected = Without(() => Route(equal, P(0), P(10))); Need(expected.Success); Equal(14d, expected.LengthMeters);
            var cache = new GraphPreparationCache();
            ExactAt(cache, equal, P(0), P(10)); ExactAt(cache, equal.Reverse().ToArray(), P(0), P(10));
            ExactAt(cache, equal, P(10), P(0)); ExactAt(cache, equal, P(0), P(10));
        });
        Test("duplicate vertices and zero-length trays retain original station decisions", () =>
        {
            var trays = new[] { Tray("A", P(0), P(0), P(5)), Tray("B", P(5), P(5)), Tray("C", P(5), P(10), P(10)) };
            var cache = new GraphPreparationCache(); ExactAt(cache, trays, P(0), P(10));
            ExactAt(cache, trays, P(5), P(5)); ExactAt(cache, trays, P(2.3), P(7.9));
        });
        Test("vertical preferences and secondary thresholds remain query-specific", () =>
        {
            var trays = new[] { Tray("A", P(0), P(10)), Tray("B", P(0, .02, .1), P(10, .02, .1)) };
            var cache = new GraphPreparationCache(); var from = P(1, .01, .25); var to = P(9, .01, .25);
            ExactAt(cache, trays, from, to, Options(.25)); ExactAt(cache, trays, from, to, Options(.25, vertical: true));
            var changed = Options(.25); changed.SecondaryDistanceMeters = .01; ExactAt(cache, trays, from, to, changed);
        });
        Test("deterministic small-network corpus remains exact across changed query order", () =>
        {
            var random = new Random(738917); var cache = new GraphPreparationCache();
            for (int fixture = 0; fixture < 20; fixture++)
            {
                var trays = Enumerable.Range(0, 10).Select(i => Tray("C" + i.ToString("D3"), P(i), P(i + 1, i % 3 == 0 ? .025 : 0))).ToArray();
                for (int q = 0; q < 3; q++)
                {
                    var from = P(random.NextDouble() * 4, .01); var to = P(6 + random.NextDouble() * 4, -.01);
                    ExactAt(cache, trays, from, to, identity: fixture.ToString("D64"));
                }
            }
        });
    }

    private static void SelectionInputs()
    {
        Test("capacity exclusion changes eligible topology and returning restores the original", () =>
        {
            var cache = new GraphPreparationCache(); ExactAt(cache, Diamond, P(0), P(10));
            var filtered = CapacityRouting.Filter(Diamond, ["/BC100"]).ToArray();
            ExactAt(cache, filtered, P(0), P(10));
            using (var changed = cache.BeginRequest(Identity))
            { var actual = Route(filtered, P(0), P(10)); Need(actual.Success && actual.RouteCodes.Contains("/BC200") && !actual.RouteCodes.Contains("/BC100")); }
            ExactAt(cache, Diamond, P(0), P(10));
        });
        Test("selection weights remain query-local and never change physical distance", () =>
        {
            var cache = new GraphPreparationCache(); var weights = new[] { new RouteCostMultiplier("/BC100", 10) };
            Func<RouteResult> weighted = () => Calculator.CalculateLoadBalanced(Diamond, P(0), P(10), CableCategory.Control, weights, Options());
            var expected = Without(weighted); Need(expected.Success && expected.RouteCodes.Contains("/BC200")); Equal(20d, expected.LengthMeters);
            using (var cold = cache.BeginRequest(Identity)) Exact(expected, weighted());
            ExactAt(cache, Diamond, P(0), P(10));
            using (var warm = cache.BeginRequest(Identity)) { Exact(expected, weighted()); Need(warm.Diagnostics.BasisMemoryHits > 0); }
        });
        Test("category filtering cannot reuse permission from another cable", () =>
        {
            var trays = new[] { new TraySegment("A", "/A", CableCategory.Control, [P(0), P(10)]),
                new TraySegment("B", "/B", CableCategory.LV, [P(0, 5), P(10, 5)]) };
            var cache = new GraphPreparationCache(); ExactAt(cache, trays, P(0), P(10));
            ExactAt(cache, trays, P(0, 5), P(10, 5), category: CableCategory.LV);
            ExactAt(cache, trays, P(0), P(10), category: CableCategory.MV);
            ExactAt(cache, trays, P(0), P(10));
        });
        Test("changed point geometry with reused IDs and prepared namespace cannot replay old contacts", () =>
        {
            var cache = new GraphPreparationCache(); ExactAt(cache, Chain, P(0), P(10));
            var moved = new[] { Tray("C001", P(0), P(3)), Tray("C002", P(3, 5), P(7, 5)), Tray("C003", P(7), P(10)) };
            using var changed = cache.BeginRequest(Identity); var expected = Without(() => Route(moved, P(0), P(10)));
            var actual = Route(moved, P(0), P(10)); Exact(expected, actual); Need(!actual.Success);
            Need(changed.Diagnostics.BasisBuilds > 0);
        });
        Test("connection tolerance changes eligibility even under the same prepared namespace", () =>
        {
            var gap = new[] { Tray("A", P(0), P(1)), Tray("B", P(1.15), P(2)) }; var cache = new GraphPreparationCache();
            ExactAt(cache, gap, P(0), P(2), Options(.2));
            var strict = Without(() => Route(gap, P(0), P(2), Options(.1))); Need(!strict.Success);
            using (var request = cache.BeginRequest(Identity)) { Exact(strict, Route(gap, P(0), P(2), Options(.1))); Need(request.Diagnostics.BasisBuilds > 0); }
            ExactAt(cache, gap, P(0), P(2), Options(.2));
        });
        Test("physical ports and ends-only flags are part of preparation equivalence", () =>
        {
            var cache = new GraphPreparationCache(); var simple = new[] { Tray("A", P(0), P(10)), Tray("B", P(5, .05), P(5, 5)) };
            ExactAt(cache, simple, P(0), P(5, 5));
            var ports = new[] { new RouteConnectionPort(P(0), P(-1), P(0, 1), P(0, 0, 1), .3, .1),
                new RouteConnectionPort(P(10), P(1), P(0, 1), P(0, 0, 1), .3, .1) };
            var changed = new[] { new TraySegment("A", "/A", CableCategory.Control, [P(0), P(10)], true, ports), simple[1] };
            ExactAt(cache, changed, P(0), P(5, 5)); ExactAt(cache, simple, P(0), P(5, 5));
        });
        Test("retained surface measurements are reused and changed mesh content cannot alias", () =>
        {
            var cache = new GraphPreparationCache(); var first = SurfaceNetwork();
            ExactAt(cache, first, P(0), P(10, 1));
            using (var warm = cache.BeginRequest(Identity))
            { Exact(Without(() => Route(first, P(2), P(8, 1))), Route(first, P(2), P(8, 1))); Need(warm.Diagnostics.SurfaceCacheHits > 0); }
            var changed = SurfaceNetwork(true);
            using (var request = cache.BeginRequest(Identity))
            { Exact(Without(() => Route(changed, P(0), P(10, 1))), Route(changed, P(0), P(10, 1))); Need(request.Diagnostics.BasisBuilds > 0); }
            ExactAt(cache, first, P(0), P(10, 1));
        });
        Test("reversed surface construction order retains canonical tied witnesses", () =>
        {
            var cache = new GraphPreparationCache(); var first = SurfaceNetwork(); ExactAt(cache, first, P(0), P(10, 1));
            var reversed = SurfaceNetwork(reverseCreation: true);
            using var request = cache.BeginRequest(Identity);
            Exact(Without(() => Route(reversed, P(2), P(8, 1))), Route(reversed, P(2), P(8, 1)));
            Need(request.Diagnostics.BasisBuilds > 0, "Changed canonical surface ordering reused an incompatible witness recipe.");
        });
    }

    private static TraySegment[] SurfaceNetwork(bool changed = false, bool reverseCreation = false)
    {
        TrayMeshClearance Surface(double y, bool cut)
        {
            // The two folded surfaces have the same bounds and triangle count.
            // Only the original interior geometry changes.
            var vertices = new[] { P(0, y - .5), P(10, y - .5), P(10, y + .5), P(0, y + .5, .25),
                P(5, y, cut ? .2 : .1) };
            int[] triangles = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4];
            var mesh = new TrayMeshData([new TrayMeshFragment(vertices, triangles)]);
            Need(TrayMeshClearance.TryCreate(mesh, [], false, default, out var surface, out var reason), reason);
            return surface;
        }
        TrayMeshClearance a, b;
        if (reverseCreation) { b = Surface(1, false); a = Surface(0, changed); }
        else { a = Surface(0, changed); b = Surface(1, false); }
        return [new("A", "/A", CableCategory.Control, [P(0), P(10)], false, [], [a]),
            new("B", "/B", CableCategory.Control, [P(0, 1), P(10, 1)], false, [], [b])];
    }

    private static void LimitsAndCancellation()
    {
        Test("warm cache cannot bypass a lower graph node limit", () =>
        {
            var cache = new GraphPreparationCache(); ExactAt(cache, Chain, P(0), P(10));
            var small = Options(maxNodes: 2); var expected = Without(() => Route(Chain, P(0), P(10), small)); Need(!expected.Success);
            using var request = cache.BeginRequest(Identity); Exact(expected, Route(Chain, P(0), P(10), small));
        });
        Test("warm cache cannot bypass a lower graph connection or candidate limit", () =>
        {
            var dense = Enumerable.Range(0, 12).Select(i => Tray("C" + i.ToString("D2"), P(0, i * .001), P(2, i * .001))).ToArray();
            var cache = new GraphPreparationCache(); ExactAt(cache, dense, P(0), P(2));
            var small = Options(maxConnections: 1); var expected = Without(() => Route(dense, P(0), P(2), small)); Need(!expected.Success);
            using var request = cache.BeginRequest(Identity); Exact(expected, Route(dense, P(0), P(2), small));
        });
        Test("imported prior preparation respects tighter current limits before numerical revalidation", () =>
        {
            var dense = Enumerable.Range(0, 12).Select(i => Tray("C" + i.ToString("D2"), P(0, i * .001), P(2, i * .001))).ToArray();
            var source = new GraphPreparationCache(); ExactAt(source, dense, P(0), P(2)); var bytes = source.Export(Identity)!;
            foreach (var options in new[] { Options(maxConnections: 1), Options(maxConnections: 12), Options(maxNodes: 2) })
            {
                var restored = new GraphPreparationCache(); Need(restored.Import(Identity, bytes));
                var expected = Without(() => Route(dense, P(0), P(2), options)); Need(!expected.Success);
                using var request = restored.BeginRequest(Identity); Exact(expected, Route(dense, P(0), P(2), options));
                Equal(0L, request.Diagnostics.BasisImportedHits, "Large imported basis bypassed the active tighter limits.");
            }
        });
        Test("pre-cancelled request does not build or publish preparation", () =>
        {
            var cache = new GraphPreparationCache(); using var request = cache.BeginRequest(Identity);
            using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
            bool observed = false; try { _ = Route(Chain, P(0), P(10), token: cancellation.Token); } catch (OperationCanceledException) { observed = true; }
            Need(observed); Need(cache.Export(Identity) is null); Equal(0L, Convert.ToInt64(request.Diagnostics.BasisBuilds));
        });
        Test("cancellation during input enumeration propagates without contaminating the next query", () =>
        {
            var cache = new GraphPreparationCache(); using var cancellation = new CancellationTokenSource();
            IEnumerable<TraySegment> CancelledInput()
            { yield return Chain[0]; cancellation.Cancel(); yield return Chain[1]; }
            using (var request = cache.BeginRequest(Identity))
            {
                bool observed = false; try { _ = Route(CancelledInput(), P(0), P(10), token: cancellation.Token); } catch (OperationCanceledException) { observed = true; }
                Need(observed); Need(cache.Export(Identity) is null);
            }
            ExactAt(cache, Chain, P(0), P(10));
        });
        Test("constrained logical work and candidate limits are unchanged on warm preparation", () =>
        {
            var cache = new GraphPreparationCache(); var from = P(0); var to = P(10);
            ExactLocalAt(cache, Diamond, from, to, ClearQuery);
            foreach (var limits in new[] { new ConstrainedRoutingLimits { MaxWork = 1 },
                new ConstrainedRoutingLimits { MaxPairs = 1, MaxCandidatesPerEnd = 1 }, new ConstrainedRoutingLimits { MaxGraphNodes = 2 },
                new ConstrainedRoutingLimits { MaxGraphConnections = 1 }, new ConstrainedRoutingLimits { MaxInputTrays = 1 },
                new ConstrainedRoutingLimits { MaxCollisionQueries = 1 } }) ExactLocalAt(cache, Diamond, from, to, ClearQuery, limits: limits);
        });
    }

    private static void ScopeAndBounds()
    {
        Test("nested enabled disabled and other-owner scopes restore the original request", () =>
        {
            var cache = new GraphPreparationCache(); using var outer = cache.BeginRequest(Identity);
            var expected = Without(() => Route(Chain, P(0), P(10))); Exact(expected, Route(Chain, P(0), P(10)));
            using (var disabled = cache.BeginRequest(Identity, false))
            { Exact(expected, Route(Chain, P(0), P(10))); Equal(0L, Convert.ToInt64(disabled.Diagnostics.BasisBuilds)); }
            var other = new GraphPreparationCache(); using (var foreign = other.BeginRequest(OtherIdentity)) Exact(expected, Route(Chain, P(0), P(10)));
            long previous = Convert.ToInt64(outer.Diagnostics.BasisMemoryHits); Exact(expected, Route(Chain, P(0), P(10)));
            Need(outer.Diagnostics.BasisMemoryHits > previous); Need(cache.Export(OtherIdentity) is null);
        });
        Test("concurrent request contexts cannot exchange endpoints or diagnostics ownership", () =>
        {
            var cache = new GraphPreparationCache();
            var points = new[] { (P(0), P(10)), (P(2), P(8)), (P(8), P(2)), (P(3), P(9)) };
            var expected = points.Select(pair => Without(() => Route(Chain, pair.Item1, pair.Item2))).ToArray();
            var results = Task.WhenAll(points.Select((pair, index) => Task.Run(() =>
            {
                using var request = cache.BeginRequest(Identity); var value = Route(Chain, pair.Item1, pair.Item2);
                Exact(expected[index], value); Need(request.Diagnostics.GraphBuilds > 0); return value;
            }))).GetAwaiter().GetResult();
            Equal(points.Length, results.Length); ExactAt(cache, Chain, P(0), P(10));
        });
        Test("entry eviction bounds retained bytes and preserves future correctness", () =>
        {
            var cache = new GraphPreparationCache(1, 1024 * 1024);
            ExactAt(cache, Chain, P(0), P(10)); ExactAt(cache, Chain, P(2), P(8), identity: OtherIdentity);
            Need(cache.Export(Identity) is null, "Evicted prepared owner remains resident.");
            using var request = cache.BeginRequest(Identity); Exact(Without(() => Route(Chain, P(0), P(10))), Route(Chain, P(0), P(10)));
            Need(request.Diagnostics.CacheEntries <= 1 && request.Diagnostics.CacheBytes <= 1024 * 1024);
        });
        Test("a basis exceeding byte budget falls back safely without retention", () =>
        {
            var cache = new GraphPreparationCache(1, 1024);
            var chain = Enumerable.Range(0, 100).Select(i => Tray("C" + i.ToString("D3"), P(i), P(i + 1))).ToArray();
            using var request = cache.BeginRequest(Identity);
            Exact(Without(() => Route(chain, P(0), P(100))), Route(chain, P(0), P(100)));
            Need(request.Diagnostics.CacheBytes <= 1024); Need(cache.Export(Identity) is null);
        });
    }

    private static void Persistence()
    {
        Test("export and import restore preparation across cache instances with new endpoints", () =>
        {
            var source = new GraphPreparationCache(); ExactAt(source, Chain, P(0), P(10)); var bytes = source.Export(Identity);
            Need(bytes is { Length: > 0 }); var target = new GraphPreparationCache(); Need(target.Import(Identity, bytes!));
            using var request = target.BeginRequest(Identity); var expected = Without(() => Route(Chain, P(2), P(8)));
            Exact(expected, Route(Chain, P(2), P(8))); Need(request.Diagnostics.BasisImportedHits > 0); Equal(0L, Convert.ToInt64(request.Diagnostics.BasisBuilds));
        });
        Test("export and import preserve exact mesh-contact witnesses", () =>
        {
            var source = new GraphPreparationCache(); var first = SurfaceNetwork(); ExactAt(source, first, P(0), P(10, 1));
            var bytes = source.Export(Identity); Need(bytes is { Length: > 0 }); var restored = new GraphPreparationCache(); Need(restored.Import(Identity, bytes!));
            var reconstructed = SurfaceNetwork(); using var request = restored.BeginRequest(Identity);
            Exact(Without(() => Route(reconstructed, P(2), P(8, 1))), Route(reconstructed, P(2), P(8, 1)));
            Need(request.Diagnostics.BasisImportedHits > 0); Need(request.Diagnostics.SurfaceCacheHits > 0);
        });
        Test("disjoint reversed parallel pieces roundtrip without rejecting unused overlap fractions", () =>
        {
            var trays = new[] { Tray("A", P(0), P(1)), Tray("B", P(-2), P(-.1)) };
            var options = Options(.25); var expected = Without(() => Route(trays, P(1), P(-2), options));
            Need(expected.Success); Equal(3d, expected.LengthMeters);
            var source = new GraphPreparationCache(); ExactAt(source, trays, P(1), P(-2), options);
            var bytes = source.Export(Identity); Need(bytes is { Length: > 0 });
            var restored = new GraphPreparationCache(); Need(restored.Import(Identity, bytes!));
            using var request = restored.BeginRequest(Identity); Exact(expected, Route(trays, P(1), P(-2), options));
            Need(request.Diagnostics.BasisImportedHits > 0, "Legitimate disjoint parallel recipe was discarded rather than restored.");
        });
        Test("foreign namespace truncated corrupt trailing and empty artifacts refuse atomically", () =>
        {
            var source = new GraphPreparationCache(); ExactAt(source, Chain, P(0), P(10)); var bytes = source.Export(Identity)!;
            Need(bytes.Length > 16); var corrupt = bytes.ToArray(); corrupt[corrupt.Length / 2] ^= 0x40;
            var target = new GraphPreparationCache(); Need(!target.Import(OtherIdentity, bytes));
            foreach (var payload in new[] { Array.Empty<byte>(), bytes[..8], bytes[..^1], corrupt, bytes.Concat(new byte[] { 0 }).ToArray() })
            { Need(!target.Import(Identity, payload), "Invalid payload was admitted."); Need(target.Export(Identity) is null); }
            Need(target.Import(Identity, bytes)); var checksum = SHA256.HashData(target.Export(Identity)!);
            Need(!target.Import(Identity, corrupt)); Need(checksum.SequenceEqual(SHA256.HashData(target.Export(Identity)!)), "Rejected import changed a valid cached artifact.");
            ExactAt(target, Chain, P(0), P(10));
        });
        Test("imported geometry mismatch never authorizes replay under a reused namespace", () =>
        {
            var source = new GraphPreparationCache(); ExactAt(source, Chain, P(0), P(10)); var target = new GraphPreparationCache();
            Need(target.Import(Identity, source.Export(Identity)!));
            var replacement = new[] { Tray("C001", P(0), P(3)), Tray("C002", P(3, 1), P(7, 1)), Tray("C003", P(7), P(10)) };
            using var request = target.BeginRequest(Identity); Exact(Without(() => Route(replacement, P(0), P(10))), Route(replacement, P(0), P(10)));
            Need(request.Diagnostics.BasisBuilds > 0 && request.Diagnostics.BasisImportedHits == 0);
        });
        Test("cancelled import and export propagate and leave the valid cache intact", () =>
        {
            var source = new GraphPreparationCache(); ExactAt(source, Chain, P(0), P(10)); var bytes = source.Export(Identity)!;
            using var cancellation = new CancellationTokenSource(); cancellation.Cancel(); var target = new GraphPreparationCache();
            bool importCancelled = false; try { _ = target.Import(Identity, bytes, cancellation.Token); } catch (OperationCanceledException) { importCancelled = true; }
            bool exportCancelled = false; try { _ = source.Export(Identity, cancellation.Token); } catch (OperationCanceledException) { exportCancelled = true; }
            Need(importCancelled && exportCancelled); Need(target.Export(Identity) is null); Need(source.Export(Identity) is { Length: > 0 });
        });
        Test("structurally impossible records refuse even with a valid recomputed checksum", () =>
        {
            var source = new GraphPreparationCache(); ExactAt(source, Chain, P(0), P(10)); var bytes = source.Export(Identity)!;
            using var stream = new MemoryStream(bytes); using var reader = new BinaryReader(stream);
            void SkipText() { int length = reader.ReadInt32(); stream.Position += length; }
            SkipText(); SkipText(); Need(reader.ReadInt32() > 0); SkipText();
            int pieceCountAt = checked((int)stream.Position); int pieces = reader.ReadInt32();
            _ = reader.ReadInt32(); int pairCountAt = checked((int)stream.Position); Need(reader.ReadInt32() > 0);
            int firstPairAt = checked((int)stream.Position);
            var mutations = new Action<byte[]>[]
            {
                value => BinaryPrimitives.WriteInt32LittleEndian(value.AsSpan(pieceCountAt, 4), -1),
                value => BinaryPrimitives.WriteInt32LittleEndian(value.AsSpan(pairCountAt, 4), int.MaxValue),
                value => BinaryPrimitives.WriteInt32LittleEndian(value.AsSpan(firstPairAt, 4), -1),
                value => BinaryPrimitives.WriteInt32LittleEndian(value.AsSpan(firstPairAt + 4, 4), pieces),
                value => value[firstPairAt + 8] = 2,
                value => BinaryPrimitives.WriteInt64LittleEndian(value.AsSpan(firstPairAt + 10, 8), BitConverter.DoubleToInt64Bits(double.NaN)),
                value => BinaryPrimitives.WriteInt64LittleEndian(value.AsSpan(firstPairAt + 10, 8), BitConverter.DoubleToInt64Bits(1.01)),
            };
            foreach (var mutate in mutations)
            {
                var malformed = bytes.ToArray(); mutate(malformed); SHA256.HashData(malformed.AsSpan(0, malformed.Length - 32)).CopyTo(malformed, malformed.Length - 32);
                var target = new GraphPreparationCache(); Need(!target.Import(Identity, malformed)); Need(target.Export(Identity) is null);
            }
        });
        Test("imported and exported byte arrays cannot mutate retained preparation", () =>
        {
            var source = new GraphPreparationCache(); ExactAt(source, Chain, P(0), P(10)); var bytes = source.Export(Identity)!;
            var target = new GraphPreparationCache(); Need(target.Import(Identity, bytes)); Array.Fill(bytes, (byte)0);
            var secondExport = target.Export(Identity)!; var originalHash = SHA256.HashData(secondExport); Array.Fill(secondExport, (byte)0);
            Need(originalHash.SequenceEqual(SHA256.HashData(target.Export(Identity)!))); ExactAt(target, Chain, P(2), P(8));
        });
        Test("a checksummed but forged contact fraction is verified against current geometry before use", () =>
        {
            var source = new GraphPreparationCache(); ExactAt(source, Chain, P(0), P(10)); var bytes = source.Export(Identity)!;
            using var stream = new MemoryStream(bytes); using var reader = new BinaryReader(stream);
            void SkipText() { int length = reader.ReadInt32(); stream.Position += length; }
            SkipText(); SkipText(); Need(reader.ReadInt32() > 0); SkipText();
            _ = reader.ReadInt32(); _ = reader.ReadInt32(); Need(reader.ReadInt32() > 0);
            int fractionAt = checked((int)stream.Position) + 10;
            BinaryPrimitives.WriteInt64LittleEndian(bytes.AsSpan(fractionAt, 8), BitConverter.DoubleToInt64Bits(.3141592653589793));
            SHA256.HashData(bytes.AsSpan(0, bytes.Length - 32)).CopyTo(bytes, bytes.Length - 32);
            var target = new GraphPreparationCache(); Need(target.Import(Identity, bytes), "Test requires structurally admissible forged recipe.");
            using var request = target.BeginRequest(Identity); Exact(Without(() => Route(Chain, P(2), P(8))), Route(Chain, P(2), P(8)));
            Need(request.Diagnostics.BasisBuilds > 0, "Forged contacts were not rejected and rebuilt.");
        });
        Test("a checksummed but forged surface witness is rechecked against physical surfaces before use", () =>
        {
            var source = new GraphPreparationCache(); var trays = SurfaceNetwork(); ExactAt(source, trays, P(0), P(10, 1));
            var bytes = source.Export(Identity)!;
            using var stream = new MemoryStream(bytes); using var reader = new BinaryReader(stream);
            void SkipText() { int length = reader.ReadInt32(); stream.Position += length; }
            SkipText(); SkipText(); Need(reader.ReadInt32() > 0); SkipText(); _ = reader.ReadInt32(); _ = reader.ReadInt32();
            int pairs = reader.ReadInt32(); stream.Position += 42L * pairs; Need(reader.ReadInt32() > 0);
            _ = reader.ReadInt32(); _ = reader.ReadInt32(); Need(reader.ReadInt32() > 0);
            int distanceAt = checked((int)stream.Position); double old = reader.ReadDouble();
            BinaryPrimitives.WriteInt64LittleEndian(bytes.AsSpan(distanceAt, 8), BitConverter.DoubleToInt64Bits(old + .123));
            SHA256.HashData(bytes.AsSpan(0, bytes.Length - 32)).CopyTo(bytes, bytes.Length - 32);
            var target = new GraphPreparationCache(); Need(target.Import(Identity, bytes));
            var reconstructed = SurfaceNetwork(); using var request = target.BeginRequest(Identity);
            Exact(Without(() => Route(reconstructed, P(2), P(8, 1))), Route(reconstructed, P(2), P(8, 1)));
            Need(request.Diagnostics.BasisBuilds > 0, "Forged surface witness was not rejected and rebuilt.");
        });
    }

    private static RouteCollisionObservation ClearQuery(RoutePoint a, RoutePoint b, CancellationToken token) =>
        new(RouteCollisionStatus.Clear, null!, "SYNTHETIC_CLEAR", 1);
    private static RouteCollisionQuery Query(BarrierCollisionKernel kernel) => (a, b, token) =>
    {
        var checkedSegment = kernel.CheckSegment(B(a), B(b), token);
        return new(checkedSegment.Status switch { BarrierSegmentStatus.Clear => RouteCollisionStatus.Clear,
            BarrierSegmentStatus.Blocked => RouteCollisionStatus.Blocked, _ => RouteCollisionStatus.Indeterminate },
            checkedSegment.BarrierId, checkedSegment.Reason, checkedSegment.Work);
    };
    private static LocalApproachRouteEvaluation Local(TraySegment[] trays, RoutePoint from, RoutePoint to, RouteCollisionQuery query,
        bool drill = false, ConstrainedRoutingLimits? limits = null, RoutingOptions? options = null) =>
        Calculator.CalculateConstrainedWithLocalApproachesAndInterTrayManeuvers(trays, from, to, CableCategory.Control, query,
            options ?? Options(), limits, new LocalConnectorOptions { MaxStraightPairs = 1, MaxPlans = 1, MaxNodes = 2 }, drill);
    private static void ExactLocalAt(GraphPreparationCache cache, TraySegment[] trays, RoutePoint from, RoutePoint to, RouteCollisionQuery query,
        bool drill = false, ConstrainedRoutingLimits? limits = null, RoutingOptions? options = null)
    {
        var expected = Without(() => Local(trays, from, to, query, drill, limits, options));
        using var request = cache.BeginRequest(Identity); var actual = Local(trays, from, to, query, drill, limits, options);
        Exact(expected.RouteEvaluation.Route, actual.RouteEvaluation.Route);
        Equal(Semantic(expected), Semantic(actual), "Constrained result counters, status, checks, or connector result changed.");
    }
    private static void ConstrainedParity()
    {
        Test("clear constrained graph retains complete final proof and counters cold and warm", () =>
        {
            var cache = new GraphPreparationCache(); ExactLocalAt(cache, Diamond, P(0), P(10), ClearQuery);
            ExactLocalAt(cache, Diamond, P(2), P(8), ClearQuery); ExactLocalAt(cache, Diamond, P(0), P(10), ClearQuery);
        });
        Test("changed barrier oracle does not inherit a cached clear edge", () =>
        {
            var cache = new GraphPreparationCache(); var trays = new[] { Tray("A", P(-1), P(1)) };
            ExactLocalAt(cache, trays, P(-1), P(1), ClearQuery);
            var blocked = Query(Kernel(Box())); ExactLocalAt(cache, trays, P(-1), P(1), blocked);
            using (var request = cache.BeginRequest(Identity)) Need(!Local(trays, P(-1), P(1), blocked).RouteEvaluation.Route.Success);
            ExactLocalAt(cache, trays, P(-1), P(1), ClearQuery);
        });
        Test("original closed-mesh opening maneuver remains exact after other endpoint requests", () =>
        {
            var trays = new[] { new TraySegment("A", "/A", CableCategory.Control, [P(-1, 0, -.815), P(-.1, 0, -.815)], true),
                new TraySegment("B", "/B", CableCategory.Control, [P(.3, 0, -.775), P(1, 0, -.775)], true) };
            var query = Query(Kernel(Opening())); var cache = new GraphPreparationCache();
            var original = Without(() => Local(trays, trays[0].Points[0], trays[1].Points[1], query, options: Options(.5)));
            Need(original.RouteEvaluation.Route.Success && original.RouteEvaluation.Reason.Contains("INTER_TRAY_OPENING_MANEUVER", StringComparison.Ordinal));
            ExactLocalAt(cache, trays, trays[0].Points[0], trays[1].Points[1], query, options: Options(.5));
            ExactLocalAt(cache, trays, trays[1].Points[1], trays[0].Points[0], query, options: Options(.5));
            ExactLocalAt(cache, trays, trays[0].Points[0], trays[1].Points[1], query, options: Options(.5));
        });
        Test("solid wall cannot become an opening after a warm opening query", () =>
        {
            var trays = new[] { new TraySegment("A", "/A", CableCategory.Control, [P(-1, 0, -.815), P(-.1, 0, -.815)], true),
                new TraySegment("B", "/B", CableCategory.Control, [P(.3, 0, -.775), P(1, 0, -.775)], true) };
            var cache = new GraphPreparationCache(); ExactLocalAt(cache, trays, trays[0].Points[0], trays[1].Points[1], Query(Kernel(Opening())), options: Options(.5));
            ExactLocalAt(cache, trays, trays[0].Points[0], trays[1].Points[1], Query(Kernel(Box())), options: Options(.5));
        });
        Test("drilling remains independent of previous wall checks and never calls the oracle", () =>
        {
            var cache = new GraphPreparationCache(); ExactLocalAt(cache, Chain, P(0), P(10), ClearQuery);
            RouteCollisionObservation Never(RoutePoint a, RoutePoint b, CancellationToken token) => throw new InvalidOperationException("Drilling queried obstacles.");
            ExactLocalAt(cache, Chain, P(0), P(10), Never, drill: true); ExactLocalAt(cache, Chain, P(0), P(10), ClearQuery);
        });
        Test("indeterminate observation remains indeterminate on every query", () =>
        {
            var cache = new GraphPreparationCache();
            RouteCollisionObservation Unknown(RoutePoint a, RoutePoint b, CancellationToken token) => new(RouteCollisionStatus.Indeterminate, null!, "SYNTHETIC_UNKNOWN", 1);
            ExactLocalAt(cache, Chain, P(0), P(10), Unknown); ExactLocalAt(cache, Chain, P(0), P(10), Unknown);
            ExactLocalAt(cache, Chain, P(0), P(10), ClearQuery);
        });
        Test("capacity exclusions and dynamic weights keep full constrained evaluations exact", () =>
        {
            var cache = new GraphPreparationCache();
            foreach (var excluded in new[] { Array.Empty<string>(), new[] { "/BC100" }, new[] { "/BC100", "/BC200" } })
            {
                Func<LocalApproachRouteEvaluation> calculate = () => CapacityRouting.CalculateWithLocalApproaches(Diamond, excluded, P(0), P(10),
                    CableCategory.Control, ClearQuery, Options(), interTrayManeuvers: true, routeCostMultipliers: [new("/BC100", 10)]);
                var expected = Without(calculate); using var request = cache.BeginRequest(Identity); var actual = calculate();
                Equal(Semantic(expected), Semantic(actual)); Exact(expected.RouteEvaluation.Route, actual.RouteEvaluation.Route);
            }
        });
    }
}
