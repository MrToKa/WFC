using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Barriers;
using static Fixtures;

internal static class Program
{
    private static readonly List<object> Checks = [];
    private static int failures;
    private static readonly RouteCalculator Calculator = new();

    private static int Main(string[] args)
    {
        if (args.Length != 0) return 2;
        LegacyParity(); PhysicalRoutes(); ConnectorGeometry(); DirectStrategy(); RefusalAndBudgets();
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = "wfc.pf.constrained-routing-checks.v1", status = failures == 0 ? "PASS" : "FAIL",
            passed = Checks.Count - failures, failed = failures,
            scope = "Synthetic Core support with real qualified closed-triangle kernel queries; no actual converted model, SDK capture, cable writes or engineering acceptance",
            engineeringAccepted = false, nativeParity = "not-performed", physicalCableRadiusChecked = false, checks = Checks
        }));
        return failures == 0 ? 0 : 1;
    }

    private static void Run(string name, Action body)
    {
        try { body(); Checks.Add(new { name, status = "PASS", detail = "" }); }
        catch (Exception error) { failures++; Checks.Add(new { name, status = "FAIL", detail = error.GetType().Name + ": " + error.Message }); }
    }
    private static void Need(bool value, string message = "Synthetic assertion failed.")
    {
        if (!value) throw new InvalidOperationException(message);
    }
    private static void Equal<T>(T expected, T observed) => Need(EqualityComparer<T>.Default.Equals(expected, observed), $"Expected {expected}; observed {observed}.");
    private static void Reject<T>(Action body) where T : Exception
    {
        try { body(); } catch (T) { return; }
        throw new InvalidOperationException("Expected " + typeof(T).Name + ".");
    }
    private static void Bits(double expected, double observed) => Equal(BitConverter.DoubleToInt64Bits(expected), BitConverter.DoubleToInt64Bits(observed));
    private static void DecimalBits(decimal expected, decimal observed) => Need(decimal.GetBits(expected).SequenceEqual(decimal.GetBits(observed)), $"Decimal representations differ: {expected} / {observed}.");
    private static RoutingOptions Options(bool vertical = false, double tolerance = .25, double secondary = 2) => new()
    {
        ConnectionToleranceMeters = tolerance, SampleSpacingMeters = .125, SecondaryDistanceMeters = secondary,
        PreferVerticalApproach = vertical, MaxGraphNodes = 100_000, MaxGraphConnections = 300_000
    };
    private static RouteCollisionQuery Query(BarrierCollisionKernel kernel, Action<RoutePoint, RoutePoint>? observe = null) => (from, to, token) =>
    {
        observe?.Invoke(from, to); var result = kernel.CheckSegment(B(from), B(to), token);
        return new(result.Status switch
        {
            BarrierSegmentStatus.Clear => RouteCollisionStatus.Clear,
            BarrierSegmentStatus.Blocked => RouteCollisionStatus.Blocked,
            _ => RouteCollisionStatus.Indeterminate
        }, result.BarrierId, result.Reason, result.Work);
    };
    private static RouteCollisionQuery FarQuery() => Query(Kernel(Box("unrelated-solid", x0: 100, x1: 101)));
    private static ConstrainedRouteEvaluation Route(TraySegment[] trays, RoutePoint from, RoutePoint to, RouteCollisionQuery query,
        RoutingOptions? options = null, ConstrainedRoutingLimits? limits = null, bool drill = false, CancellationToken token = default) =>
        Calculator.CalculateConstrained(trays, from, to, CableCategory.Control, query, options ?? Options(), limits, drill, token);
    private static ConstrainedSecondaryEvaluation Secondary(TraySegment[] trays, RoutePoint from, RoutePoint to, RouteCollisionQuery query,
        RoutingOptions? options = null, ConstrainedRoutingLimits? limits = null, bool drill = false, CancellationToken token = default) =>
        ConstrainedSecondaryRoute.Calculate(trays, from, to, CableCategory.Control, query, options ?? Options(), limits, drill, token);
    private static void Clear(ConstrainedRouteEvaluation result, BarrierCollisionKernel kernel)
    {
        Equal(ConstrainedRouteStatus.Clear, result.Status); Need(result.Route.Success);
        Need(result.Blocking is null, "A successful final route must not expose a rejected search candidate as its blocking witness.");
        Need(result.Route.PathPoints.Count > 0, "A successful route has no exact points.");
        for (var i = 0; i < Math.Max(1, result.Route.PathPoints.Count - 1); i++)
        {
            var first = result.Route.PathPoints[i]; var last = result.Route.PathPoints[Math.Min(i + 1, result.Route.PathPoints.Count - 1)];
            Equal(BarrierSegmentStatus.Clear, kernel.CheckSegment(B(first), B(last)).Status);
        }
    }
    private static void NotSuccess(ConstrainedRouteEvaluation result)
    {
        Need(!result.Route.Success, "An obstruction/uncertainty cannot produce a successful route.");
        Need(result.Status is not (ConstrainedRouteStatus.Clear or ConstrainedRouteStatus.Bypassed));
        Need(!string.IsNullOrWhiteSpace(result.Reason), "A refusal needs a diagnostic.");
    }
    private static void ExactRoute(RouteResult expected, RouteResult observed)
    {
        Equal(expected.Success, observed.Success); Equal(expected.Message, observed.Message); Equal(expected.RouteText, observed.RouteText);
        Need(expected.RouteCodes.SequenceEqual(observed.RouteCodes)); Need(expected.SegmentIds.SequenceEqual(observed.SegmentIds));
        Equal(expected.PathPoints.Count, observed.PathPoints.Count);
        for (var i = 0; i < expected.PathPoints.Count; i++)
        {
            Bits(expected.PathPoints[i].X, observed.PathPoints[i].X); Bits(expected.PathPoints[i].Y, observed.PathPoints[i].Y); Bits(expected.PathPoints[i].Z, observed.PathPoints[i].Z);
        }
        Bits(expected.LengthMeters, observed.LengthMeters); Bits(expected.FromDistanceMeters, observed.FromDistanceMeters); Bits(expected.ToDistanceMeters, observed.ToDistanceMeters);
        Equal(expected.FromRequiresSecondary, observed.FromRequiresSecondary); Equal(expected.ToRequiresSecondary, observed.ToRequiresSecondary);
        Equal(expected.ConnectionGapCount, observed.ConnectionGapCount); Bits(expected.ConnectionGapLengthMeters, observed.ConnectionGapLengthMeters);
        foreach (var settings in new[] { (S: 7m, E: 5m, P: 10m), (S: 0m, E: 0m, P: 0m), (S: 7.125m, E: 1.001m, P: 12.5m) })
        {
            var first = CableDesignLength.Calculate(expected, settings.E, settings.S, settings.P);
            var second = CableDesignLength.Calculate(observed, settings.E, settings.S, settings.P);
            DecimalBits(first.LengthBeforePercentageMeters, second.LengthBeforePercentageMeters);
            DecimalBits(first.UnroundedLengthMeters, second.UnroundedLengthMeters);
            DecimalBits(first.DesignLengthMeters, second.DesignLengthMeters);
        }
    }
    private static TraySegment Port(string id, RoutePoint[] points, params RouteConnectionPort[] ports) =>
        new(id, "/" + id, CableCategory.Control, points, true, ports);

    private static void LegacyParity()
    {
        var cases = new (string Name, TraySegment[] Trays, RoutePoint From, RoutePoint To, RoutingOptions Options)[]
        {
            ("straight interior endpoint splits", [Tray("A", P(0), P(10))], P(2.123, .75), P(8.987, -.3), Options()),
            ("corner and SECONDARY approaches", [Tray("A", P(0), P(0, 5), P(8, 5))], P(-3), P(8, 8), Options()),
            ("parallel overlap attachment stations", [Tray("B", P(0, .1), P(12, .1)), Tray("A", P(0), P(12))], P(3), P(9, .1), Options()),
            ("zero-length tray vertices", [Tray("A", P(0), P(0), P(4), P(4))], P(1, .2), P(3, .2), Options()),
            ("bounded vertical preference", [Tray("A", P(1), P(0, 0, 1.1))], P(0), P(0, 0, 2), Options(true, 1)),
            ("zero-length result", [Tray("A", P(-1), P(-1))], P(-1), P(-1), Options()),
            ("positive measured gap", [Port("A", [P(-2), P(-.1)]), Port("B", [P(.1), P(2)])], P(-2), P(2), Options()),
            ("sub-micrometre gap rank", [Port("A", [P(-2), P(-.0000004)]), Port("B", [P(.0000004), P(2)])], P(-2), P(2), Options())
        };
        foreach (var item in cases) Run("unobstructed exact legacy bits and decimal outputs: " + item.Name, () =>
        {
            var legacy = Calculator.Calculate(item.Trays, item.From, item.To, CableCategory.Control, item.Options);
            Need(legacy.Success, "Legacy fixture is disconnected."); var value = Route(item.Trays, item.From, item.To, FarQuery(), item.Options);
            Equal(ConstrainedRouteStatus.Clear, value.Status); Equal(1, value.PairAttempts); ExactRoute(legacy, value.Route);
        });
        Run("remaining edges retain gap-count priority over shorter physical length", () =>
        {
            var trays = new[] { Port("00-from", [P(-2), P(0)]), Port("99-to", [P(10), P(12)]),
                Port("z-one-first", [P(0), P(0, 5), P(3, 5)]), Port("z-one-last", [P(3.2, 5), P(10, 5), P(10)]),
                Port("a-two-first", [P(0), P(3)]), Port("a-two-middle", [P(3.05), P(7)]), Port("a-two-last", [P(7.05), P(10)]) };
            var legacy = Calculator.Calculate(trays, P(-2), P(12), CableCategory.Control, Options());
            Need(legacy.Success && legacy.ConnectionGapCount == 1 && legacy.SegmentIds.Contains("z-one-first"));
            ExactRoute(legacy, Route(trays, P(-2), P(12), FarQuery()).Route);
        });
        Run("equal-cost tie retains ordinal node order across input permutations", () =>
        {
            var a = Tray("A", P(-2), P(-2, 2), P(2, 2), P(2)); var b = Tray("B", P(-2), P(-2, -2), P(2, -2), P(2));
            var legacy = Calculator.Calculate([b, a], P(-2), P(2), CableCategory.Control, Options()); Need(legacy.Success);
            ExactRoute(legacy, Route([a, b], P(-2), P(2), FarQuery()).Route);
            ExactRoute(legacy, Route([b, a], P(-2), P(2), FarQuery()).Route);
        });
    }

    private static void PhysicalRoutes()
    {
        Run("solid wall rejects a tray internal edge through its actual material", () =>
        {
            var kernel = Kernel(Box()); var trays = new[] { Tray("A", P(-1), P(1)) };
            Need(Calculator.Calculate(trays, P(-1), P(1), CableCategory.Control, Options()).Success);
            var result = Route(trays, P(-1), P(1), Query(kernel)); NotSuccess(result); Equal(ConstrainedRouteStatus.Blocked, result.Status);
        });
        Run("actual watertight wall tunnel permits the exact legacy polyline", () =>
        {
            var kernel = Kernel(Opening()); var trays = new[] { Tray("A", P(-1), P(1)) };
            var result = Route(trays, P(-1), P(1), Query(kernel)); Clear(result, kernel);
            ExactRoute(Calculator.Calculate(trays, P(-1), P(1), CableCategory.Control, Options()), result.Route);
        });
        Run("wall material beside its opening remains blocked", () =>
        {
            var kernel = Kernel(Opening()); NotSuccess(Route([Tray("A", P(-1, 1), P(1, 1))], P(-1, 1), P(1, 1), Query(kernel)));
        });
        Run("XY alternative reaches the real opening even when vertical preference is disabled", () =>
        {
            var kernel = Kernel(Opening()); var from = P(-1, 0, 1.5); var to = P(3, 0, 3); var station = P(1);
            var trays = new[] { Tray("A-sloped", station, to) }; var options = Options(false);
            var legacy = Calculator.Calculate(trays, from, to, CableCategory.Control, options); Need(legacy.Success);
            // Closest-3D station crosses the front face at Z=5/6, outside the
            // opening; the XY station crosses it at Z=.75, inside the tunnel.
            Equal(BarrierSegmentStatus.Blocked, kernel.CheckSegment(B(from), B(legacy.PathPoints[1])).Status);
            Equal(BarrierSegmentStatus.Clear, kernel.CheckSegment(B(from), B(station)).Status);
            var result = Route(trays, from, to, Query(kernel), options); Clear(result, kernel);
            Need(!options.PreferVerticalApproach); Need(result.Route.PathPoints.Any(point => Same(point, station)));
            Bits(2.5, result.Route.FromDistanceMeters); Need(result.PairAttempts > 1);
        });
        Run("floor opening permits vertical travel without filling its bounding box", () =>
        {
            var kernel = Kernel(Transform(Opening("floor-opening"), p => B(p.Y, p.Z, p.X)));
            var trays = new[] { Tray("A", P(0, 0, -1), P(0, 0, 1)) }; Clear(Route(trays, P(0, 0, -1), P(0, 0, 1), Query(kernel)), kernel);
        });
        Run("floor blocks the same vertical path outside the real opening", () =>
        {
            var kernel = Kernel(Transform(Opening("floor-opening"), p => B(p.Y, p.Z, p.X)));
            NotSuccess(Route([Tray("A", P(1, 0, -1), P(1, 0, 1))], P(1, 0, -1), P(1, 0, 1), Query(kernel)));
        });
        Run("nearest opposite-side tray yields to a farther accessible tray", () =>
        {
            var kernel = Kernel(Box("wall", y0: -5, y1: 5)); var from = P(-.2); var to = P(-.2, 4);
            var trays = new[] { Tray("A-nearest", P(.3), P(.3, 4)), Tray("B-accessible", P(-2), P(-2, 4)) };
            var original = Calculator.Calculate(trays, from, to, CableCategory.Control, Options()); Need(original.SegmentIds.Contains("A-nearest"));
            var result = Route(trays, from, to, Query(kernel)); Clear(result, kernel); Need(result.Route.SegmentIds.Contains("B-accessible"));
            Need(!result.Route.SegmentIds.Contains("A-nearest")); Bits(1.8, result.Route.FromDistanceMeters); Bits(1.8, result.Route.ToDistanceMeters);
            Equal(4, result.Route.PathPoints.Count); Bits(-2, result.Route.PathPoints[1].X); Bits(-2, result.Route.PathPoints[2].X);
        });
        Run("vertical preference cannot attach through a floor to the upper storey", () =>
        {
            var kernel = Kernel(Box("floor", x0: -10, x1: 10, y0: -10, y1: 10, z0: 0, z1: .2));
            var trays = new[] { Tray("A-upstairs", P(-2, 0, .4), P(2, 0, .4)), Tray("B-downstairs", P(-2, 2, -1), P(2, 2, -1)) };
            var from = P(-1, 0, -1); var to = P(1, 0, -1); var result = Route(trays, from, to, Query(kernel), Options(true));
            Clear(result, kernel); Need(result.Route.SegmentIds.Contains("B-downstairs")); Need(result.Route.PathPoints.All(point => point.Z == -1));
        });
        Run("blocked internal shortcut is removed before Dijkstra chooses a clear detour", () =>
        {
            var kernel = Kernel(Box("wall", x0: -.1, x1: .1, y0: -.5, y1: .5));
            var trays = new[] { Port("A-shortcut", [P(-2), P(2)]), Port("B-detour", [P(-2), P(-2, 2), P(2, 2), P(2)]) };
            var result = Route(trays, P(-2), P(2), Query(kernel)); Clear(result, kernel);
            Need(result.Route.SegmentIds.Contains("B-detour")); Bits(8, result.Route.LengthMeters);
        });
        Run("alternative candidates are deterministic under input permutations", () =>
        {
            var kernel = Kernel(Box("wall", y0: -5, y1: 5)); var from = P(-.2); var to = P(-.2, 4);
            var a = Tray("A-blocked", P(.3), P(.3, 4)); var b = Tray("B-safe", P(-2), P(-2, 4)); var c = Tray("C-safe-tie", P(-2), P(-2, 4));
            var first = Route([a, b, c], from, to, Query(kernel)); var last = Route([c, a, b], from, to, Query(kernel));
            Clear(first, kernel); Clear(last, kernel); ExactRoute(first.Route, last.Route); Equal(first.PairAttempts, last.PairAttempts);
        });
        Run("final exact polyline is independently rechecked after graph filtering", () =>
        {
            var kernel = Kernel(Box("remote", x0: 100, x1: 101)); var calls = new List<(RoutePoint From, RoutePoint To)>();
            var result = Route([Tray("A", P(0), P(5), P(5, 3))], P(0), P(5, 3), Query(kernel, (a, b) => calls.Add((a, b))));
            Clear(result, kernel);
            for (var i = 1; i < result.Route.PathPoints.Count; i++)
            {
                var a = result.Route.PathPoints[i - 1]; var b = result.Route.PathPoints[i];
                Need(calls.Count(call => Same(call.From, a) && Same(call.To, b) || Same(call.From, b) && Same(call.To, a)) >= 2,
                    "A final polyline edge was not queried independently of graph filtering.");
            }
        });
    }

    private static bool Same(RoutePoint first, RoutePoint last) => first.X == last.X && first.Y == last.Y && first.Z == last.Z;
    private static void ConnectorGeometry()
    {
        Run("positive cross-tray connector crossing a wall cannot survive as a valid gap", () =>
        {
            var kernel = Kernel(Box("gap-wall", x0: -.05, x1: .05)); var trays = new[] { Port("A", [P(-2), P(-.1)]), Port("B", [P(.1), P(2)]) };
            var legacy = Calculator.Calculate(trays, P(-2), P(2), CableCategory.Control, Options()); Need(legacy.Success && legacy.ConnectionGapCount == 1);
            NotSuccess(Route(trays, P(-2), P(2), Query(kernel)));
        });
        Run("zero-ranked sub-micrometre connector still receives a physical collision query", () =>
        {
            const double halfGap = .0000004;
            var kernel = Kernel(Box("tiny-gap-wall", x0: -.0000002, x1: .0000002, y0: -.001, y1: .001, z0: -.001, z1: .001));
            var first = P(-halfGap); var last = P(halfGap); var calls = new List<(RoutePoint From, RoutePoint To)>();
            var trays = new[] { Port("A", [P(-1), first]), Port("B", [last, P(1)]) };
            var legacy = Calculator.Calculate(trays, P(-1), P(1), CableCategory.Control, Options()); Need(legacy.Success); Equal(0, legacy.ConnectionGapCount);
            var result = Route(trays, P(-1), P(1), Query(kernel, (a, b) => calls.Add((a, b)))); NotSuccess(result);
            Need(calls.Any(call => Same(call.From, first) && Same(call.To, last) || Same(call.From, last) && Same(call.To, first)), "Tiny contact was skipped because it has zero gap rank.");
        });
        Run("verified opposing ports with zero measured gap rank still check their real centreline connector", () =>
        {
            var first = P(-.0002); var last = P(.0002); var u = P(0, 1); var v = P(0, 0, 1);
            var a = Port("A", [P(-1), first], new RouteConnectionPort(first, P(1), u, v, .0001, .0001));
            var b = Port("B", [last, P(1)], new RouteConnectionPort(last, P(-1), u, v, .0001, .0001));
            var kernel = Kernel(Box("port-wall", x0: -.00005, x1: .00005, y0: -.001, y1: .001, z0: -.001, z1: .001));
            var legacy = Calculator.Calculate([a, b], P(-1), P(1), CableCategory.Control, Options()); Need(legacy.Success); Equal(0, legacy.ConnectionGapCount); Bits(0, legacy.ConnectionGapLengthMeters);
            var calls = new List<(RoutePoint From, RoutePoint To)>(); NotSuccess(Route([a, b], P(-1), P(1), Query(kernel, (x, y) => calls.Add((x, y)))));
            Need(calls.Any(call => Same(call.From, first) && Same(call.To, last) || Same(call.From, last) && Same(call.To, first)));
        });
        Run("one-point result has an explicit occupancy check", () =>
        {
            var kernel = Kernel(Box()); var calls = new List<(RoutePoint From, RoutePoint To)>(); var point = P(-1);
            var result = Route([Tray("A", point, point)], point, point, Query(kernel, (a, b) => calls.Add((a, b))));
            Clear(result, kernel); Equal(1, result.Route.PathPoints.Count); Need(calls.Any(call => Same(call.From, point) && Same(call.To, point)));
        });
        Run("one-point result within a solid cannot become an unchecked success", () =>
        {
            var kernel = Kernel(Box()); var point = P(.1); var result = Route([Tray("A", point, point)], point, point, Query(kernel));
            NotSuccess(result); Equal(ConstrainedRouteStatus.Blocked, result.Status); Need(result.CollisionQueries > 0);
        });
    }

    private static void DirectStrategy()
    {
        Run("distance-qualified direct SECONDARY crossing a wall falls back to a clear tray route", () =>
        {
            var kernel = Kernel(Box("wall", y0: -1, y1: 1, z0: -1, z1: 1)); var trays = new[] { Tray("A", P(-1, 3), P(1, 3)) };
            var value = Secondary(trays, P(-1), P(1), Query(kernel)); Need(value.DistanceQualified); Equal("blocked", value.DirectDisposition);
            Need(value.DirectCollision is not null); Equal(RouteCollisionStatus.Blocked, value.DirectCollision!.Status); Clear(value.RouteEvaluation, kernel);
            Need(value.RouteEvaluation.Route.SegmentIds.Contains("A")); Bits(8, value.RouteEvaluation.Route.LengthMeters);
            var design = CableDesignLength.Calculate(value.RouteEvaluation.Route, 5m, 7m, 10m);
            Equal(21m, design.LengthBeforePercentageMeters); Equal(23.1m, design.UnroundedLengthMeters); Equal(24m, design.DesignLengthMeters);
        });
        Run("clear qualifying direct line preserves original 3D length and one end reserve", () =>
        {
            var trays = new[] { Tray("A", P(100, 100, 100), P(101, 100, 100)) }; var value = Secondary(trays, P(0), P(0, 3, 4), FarQuery());
            Need(value.DistanceQualified); Equal("clear", value.DirectDisposition); Equal(ConstrainedRouteStatus.Clear, value.RouteEvaluation.Status);
            Need(value.RouteEvaluation.Blocking is null);
            ExactRoute(DirectSecondaryRoute.Evaluate(trays, P(0), P(0, 3, 4), CableCategory.Control, Options()).DirectRoute, value.RouteEvaluation.Route);
            var design = CableDesignLength.Calculate(value.RouteEvaluation.Route, 2m, 999m, 10m);
            Equal(7m, design.LengthBeforePercentageMeters); Equal(7.7m, design.UnroundedLengthMeters); Equal(8m, design.DesignLengthMeters);
        });
        Run("equal direct and nearest approach distances do not acquire a shortcut", () =>
        {
            var trays = new[] { Tray("A", P(0, 1), P(1, 1)) }; var value = Secondary(trays, P(0), P(1), FarQuery());
            Need(!value.DistanceQualified); Equal("not-qualified", value.DirectDisposition);
            ExactRoute(Calculator.Calculate(trays, P(0), P(1), CableCategory.Control, Options()), value.RouteEvaluation.Route);
        });
        Run("direct distance decision remains true nearest before vertical preference", () =>
        {
            var trays = new[] { Tray("A", P(1), P(0, 0, 1.1)) }; var value = Secondary(trays, P(0), P(.9), FarQuery(), Options(true, 1));
            var old = DirectSecondaryRoute.Evaluate(trays, P(0), P(.9), CableCategory.Control, Options(true, 1));
            Equal(old.IsDirect, value.DistanceQualified); Bits(old.NearestFromMeters!.Value, value.DistanceDecision.NearestFromMeters!.Value); Need(!value.DistanceQualified);
        });
        Run("explicit drilling preserves original network result and executes no collision queries", () =>
        {
            var trays = new[] { Tray("A", P(-1), P(1)) }; var queries = 0;
            RouteCollisionObservation MustNotQuery(RoutePoint a, RoutePoint b, CancellationToken token) { queries++; throw new InvalidOperationException("Bypass queried a barrier."); }
            var value = Route(trays, P(-1), P(1), MustNotQuery, drill: true); Equal(ConstrainedRouteStatus.Bypassed, value.Status); Equal(0, queries); Equal(0, value.CollisionQueries);
            Need(value.Blocking is null);
            ExactRoute(Calculator.Calculate(trays, P(-1), P(1), CableCategory.Control, Options()), value.Route);
        });
        Run("explicit drilling preserves the original qualifying direct strategy without querying walls", () =>
        {
            var trays = new[] { Tray("A", P(-1, 3), P(1, 3)) }; var queries = 0;
            RouteCollisionObservation MustNotQuery(RoutePoint a, RoutePoint b, CancellationToken token) { queries++; throw new InvalidOperationException("Bypass queried a barrier."); }
            var value = Secondary(trays, P(-1), P(1), MustNotQuery, drill: true); Equal("bypassed", value.DirectDisposition); Need(value.DistanceQualified);
            Equal(ConstrainedRouteStatus.Bypassed, value.RouteEvaluation.Status); Equal(0, queries);
            Need(value.RouteEvaluation.Blocking is null);
            ExactRoute(DirectSecondaryRoute.Evaluate(trays, P(-1), P(1), CableCategory.Control, Options()).DirectRoute, value.RouteEvaluation.Route);
        });
        Run("uncertain direct line cannot become clear or silently route through a barrier", () =>
        {
            var value = Secondary([Tray("A", P(-1, 3), P(1, 3))], P(-1), P(1), (a, b, token) => new(RouteCollisionStatus.Indeterminate, null, "Synthetic unavailable query.", 1));
            Need(value.DistanceQualified); Equal("indeterminate", value.DirectDisposition); NotSuccess(value.RouteEvaluation); Equal(ConstrainedRouteStatus.Indeterminate, value.RouteEvaluation.Status);
        });
    }

    private static void RefusalAndBudgets()
    {
        var trays = new[] { Tray("A", P(0), P(10)) };
        Run("uncertain graph query cannot authorize a clear route", () =>
        {
            var result = Route(trays, P(0), P(10), (a, b, token) => new(RouteCollisionStatus.Indeterminate, "shell:unknown", "Synthetic uncertain oracle.", 1));
            NotSuccess(result); Equal(ConstrainedRouteStatus.Indeterminate, result.Status);
        });
        Run("invalid negative oracle work cannot evade the global budget", () =>
        {
            var result = Route(trays, P(0), P(10), (a, b, token) => new(RouteCollisionStatus.Clear, null, "Invalid accounting.", -1)); NotSuccess(result);
        });
        Run("collision query limit is shared across approaches graph and final validation", () =>
        {
            var result = Route(trays, P(0), P(10), FarQuery(), limits: new() { MaxCollisionQueries = 1 });
            NotSuccess(result); Equal(ConstrainedRouteStatus.SearchIncomplete, result.Status); Need(result.CollisionQueries <= 1);
        });
        Run("oracle work contributes to a global budget and cannot reset per edge", () =>
        {
            var calls = 0;
            var result = Route(trays, P(0), P(10), (a, b, token) => { calls++; return new(RouteCollisionStatus.Clear, null, "Synthetic counted query.", 20); }, limits: new() { MaxWork = 10 });
            NotSuccess(result); Equal(ConstrainedRouteStatus.SearchIncomplete, result.Status); Equal(1, calls);
            Need(result.Work >= 20 && result.Work > 10, "Already performed oracle work was dropped when it exceeded the remaining budget.");
        });
        Run("oracle work overflow saturates and refuses instead of wrapping to a usable budget", () =>
        {
            var calls = 0;
            var result = Route(trays, P(0), P(10), (a, b, token) => { calls++; return new(RouteCollisionStatus.Clear, null, "Synthetic overflow query.", long.MaxValue); }, limits: new() { MaxWork = 100 });
            NotSuccess(result); Equal(ConstrainedRouteStatus.SearchIncomplete, result.Status); Equal(1, calls); Equal(long.MaxValue, result.Work);
        });
        Run("pair budget exhaustion reports incomplete search instead of no path", () =>
        {
            var networks = new[] { Tray("A-start", P(-1), P(1)), Tray("B-end", P(9), P(11)), Tray("C-connected", P(0, 5), P(10, 5)) };
            var result = Route(networks, P(0), P(10), FarQuery(), limits: new() { MaxPairs = 1 });
            NotSuccess(result); Equal(ConstrainedRouteStatus.SearchIncomplete, result.Status); Need(!result.SearchComplete); Need(result.PairAttempts <= 1);
        });
        Run("candidate truncation cannot claim exhaustive blockage", () =>
        {
            var networks = new[] { Tray("A-start", P(-1), P(1)), Tray("B-end", P(9), P(11)), Tray("C-connected", P(0, 5), P(10, 5)) };
            var result = Route(networks, P(0), P(10), FarQuery(), limits: new() { MaxCandidatesPerEnd = 1 });
            NotSuccess(result); Equal(ConstrainedRouteStatus.SearchIncomplete, result.Status); Need(result.CandidatesTruncated && !result.SearchComplete);
        });
        Run("the same disconnected first pair succeeds when alternatives have enough budget", () =>
        {
            var kernel = Kernel(Box("remote", x0: 100, x1: 101));
            var networks = new[] { Tray("A-start", P(-1), P(1)), Tray("B-end", P(9), P(11)), Tray("C-connected", P(0, 5), P(10, 5)) };
            var result = Route(networks, P(0), P(10), Query(kernel)); Clear(result, kernel); Need(result.PairAttempts > 1);
        });
        Run("single shared direct-plus-network query budget cannot reset after direct blockage", () =>
        {
            var kernel = Kernel(Box("wall", y0: -1, y1: 1)); var value = Secondary([Tray("A", P(-1, 3), P(1, 3))], P(-1), P(1), Query(kernel), limits: new() { MaxCollisionQueries = 1 });
            Need(value.DistanceQualified); Equal("blocked", value.DirectDisposition); NotSuccess(value.RouteEvaluation); Equal(ConstrainedRouteStatus.SearchIncomplete, value.RouteEvaluation.Status);
        });
        Run("already cancelled network calculation throws before any oracle work", () =>
        {
            using var cancellation = new CancellationTokenSource(); cancellation.Cancel(); var calls = 0;
            Reject<OperationCanceledException>(() => Route(trays, P(0), P(10), (a, b, token) => { calls++; return new(RouteCollisionStatus.Clear, null, "Unused.", 0); }, token: cancellation.Token)); Equal(0, calls);
        });
        Run("cancellation during an actual kernel callback cannot return success", () =>
        {
            using var cancellation = new CancellationTokenSource(); var real = FarQuery(); var calls = 0;
            Reject<OperationCanceledException>(() => Route(trays, P(0), P(10), (a, b, token) =>
            { calls++; var result = real(a, b, token); cancellation.Cancel(); token.ThrowIfCancellationRequested(); return result; }, token: cancellation.Token)); Need(calls > 0);
        });
        Run("caller cancellation wins when the same callback also returns over-budget work", () =>
        {
            using var cancellation = new CancellationTokenSource(); var real = FarQuery(); var calls = 0;
            Reject<OperationCanceledException>(() => Route(trays, P(0), P(10), (a, b, token) =>
            {
                calls++; var result = real(a, b, token); cancellation.Cancel();
                return new(result.Status, result.ShellId, result.Reason, 1_000);
            }, limits: new() { MaxWork = 100 }, token: cancellation.Token)); Equal(1, calls);
        });
        Run("already cancelled direct evaluation cannot return a bypass or shortcut", () =>
        {
            using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
            Reject<OperationCanceledException>(() => Secondary([Tray("A", P(0, 10), P(1, 10))], P(0), P(1), FarQuery(), drill: true, token: cancellation.Token));
        });
        Run("one absolute deadline applies to a callback returning after the deadline", () =>
        {
            var calls = 0;
            var result = Route(trays, P(0), P(10), (a, b, token) => { calls++; Thread.Sleep(25); return new(RouteCollisionStatus.Clear, null, "Delayed synthetic oracle.", 37); }, limits: new() { TimeoutMilliseconds = 10 });
            NotSuccess(result); Equal(ConstrainedRouteStatus.SearchIncomplete, result.Status);
            if (calls > 0) Need(result.Work >= 37, "A late oracle's reported performed work was omitted from the deadline refusal.");
        });
        Run("input tray limit refuses before an oversized graph can be built", () =>
        {
            var result = Route([Tray("A", P(0), P(1)), Tray("B", P(1), P(2))], P(0), P(2), FarQuery(), limits: new() { MaxInputTrays = 1 });
            NotSuccess(result); Equal(ConstrainedRouteStatus.SearchIncomplete, result.Status); Equal(0, result.CollisionQueries);
        });
        Run("input piece limit is independent of the tray count", () =>
        {
            var result = Route([Tray("A", P(0), P(1), P(2))], P(0), P(2), FarQuery(), limits: new() { MaxInputPieces = 1 });
            NotSuccess(result); Equal(ConstrainedRouteStatus.SearchIncomplete, result.Status); Equal(0, result.CollisionQueries);
        });
        Run("graph node cap is a resource refusal instead of a physical no-path claim", () =>
        {
            var result = Route([Tray("A", P(0), P(1), P(2))], P(0), P(2), FarQuery(), limits: new() { MaxGraphNodes = 2 });
            NotSuccess(result); Equal(ConstrainedRouteStatus.SearchIncomplete, result.Status); Need(!result.SearchComplete);
        });
        Run("graph connection cap remains active independently of node count", () =>
        {
            var result = Route([Tray("A", P(0), P(1), P(2))], P(0), P(2), FarQuery(), limits: new() { MaxGraphConnections = 1 });
            NotSuccess(result); Equal(ConstrainedRouteStatus.SearchIncomplete, result.Status);
        });
        Run("constrained ceiling snapshot never mutates the caller's legacy options", () =>
        {
            var options = new RoutingOptions(); var query = FarQuery();
            var result = Route(trays, P(0), P(10), query, options); Equal(ConstrainedRouteStatus.Clear, result.Status);
            Equal(500_000, options.MaxGraphNodes); Equal(2_000_000, options.MaxGraphConnections);
            Bits(.25, options.ConnectionToleranceMeters); Bits(.125, options.SampleSpacingMeters); Bits(2, options.SecondaryDistanceMeters);
        });
        Run("eligible duplicate and null tray guards stay active", () =>
        {
            Reject<ArgumentException>(() => Route([trays[0], trays[0]], P(0), P(10), FarQuery()));
            Reject<ArgumentException>(() => Route([null!], P(0), P(10), FarQuery()));
        });
        Run("MV is excluded from the new non-MV constrained entry point", () =>
        {
            Reject<ArgumentException>(() => Calculator.CalculateConstrained(trays, P(0), P(10), CableCategory.MV, FarQuery(), Options()));
        });
    }
}
