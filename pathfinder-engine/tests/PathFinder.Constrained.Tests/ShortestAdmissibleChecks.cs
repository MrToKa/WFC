using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Barriers;
using static Fixtures;

internal static class ShortestAdmissibleChecks
{
    private static readonly RouteCalculator Calculator = new();
    private static void Need(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    private static RoutingOptions Options() => new() { ConnectionToleranceMeters = .25, PreferVerticalApproach = false };
    private static TraySegment Port(string id, params RoutePoint[] points) => new(id, "/" + id, CableCategory.Control, points, true);
    private static TraySegment[] Network(double shortHeight = 0, double gap = .125)
    {
        var trays = new List<TraySegment> { Port("00_FROM", P(-1), P(0)), Port("99_TO", P(80), P(81)) };
        for (var i = 0; i < 8; i++)
        {
            var points = new List<RoutePoint>(); if (i == 0) points.Add(P(0));
            points.Add(P(i * 10 + (i == 0 ? 0 : gap), -shortHeight)); points.Add(P((i + 1) * 10, -shortHeight));
            if (i == 7) points.Add(P(80)); trays.Add(Port("SHORT" + i, points.ToArray()));
        }
        for (var i = 0; i < 6; i++)
        {
            var points = new List<RoutePoint>(); if (i == 0) points.Add(P(0));
            points.Add(P(i * 12 + (i == 0 ? 0 : gap), 5)); points.Add(P(i == 5 ? 80 : (i + 1) * 12, 5));
            if (i == 5) points.Add(P(80)); trays.Add(Port("LONG" + i, points.ToArray()));
        }
        return trays.ToArray();
    }
    private static RouteCollisionQuery Query(BarrierCollisionKernel kernel) => (a, b, token) =>
    {
        var result = kernel.CheckSegment(B(a), B(b), token);
        return new(result.Status switch { BarrierSegmentStatus.Clear => RouteCollisionStatus.Clear,
            BarrierSegmentStatus.Blocked => RouteCollisionStatus.Blocked, _ => RouteCollisionStatus.Indeterminate }, result.BarrierId, result.Reason, result.Work);
    };
    private static void Short(RouteResult route)
    {
        Need(route.Success && route.ConnectionGapCount == 7 && route.SegmentIds.Contains("SHORT0") && !route.SegmentIds.Contains("LONG0"),
            "The longer five-gap corridor displaced the shorter seven-gap corridor.");
        Need(Math.Abs(route.LengthMeters - 82) < 1e-9, "Unexpected physical cable distance.");
        Need(Math.Abs(route.PathPoints.Zip(route.PathPoints.Skip(1), (a, b) => a.DistanceTo(b)).Sum() - route.LengthMeters) < 1e-9,
            "The reported physical distance does not match the exact returned polyline.");
    }
    internal static void Run(Action<string, Action> run)
    {
        run("shortest admissible seven-gap corridor beats longer five-gap corridor", () =>
        {
            var route = Calculator.Calculate(Network(), P(-1), P(81), CableCategory.Control, Options()); Short(route);
            var inverse = Calculator.Calculate(Network().Reverse(), P(81), P(-1), CableCategory.Control, Options()); Short(inverse);
            Need(inverse.RouteText == route.Reverse().RouteText, "Reversing the query changed the chosen corridor.");
        });
        run("physical distance outranks gaps after actual closed-material filtering", () =>
        {
            var kernel = Kernel(Box("far", x0: 100, x1: 101));
            var result = Calculator.CalculateConstrained(Network(), P(-1), P(81), CableCategory.Control, Query(kernel), Options());
            Need(result.Status == ConstrainedRouteStatus.Clear, "The selected physical path was not proved clear."); Short(result.Route);
            foreach (var pair in result.Route.PathPoints.Zip(result.Route.PathPoints.Skip(1)))
                Need(kernel.CheckSegment(B(pair.First), B(pair.Second)).Status == BarrierSegmentStatus.Clear, "A selected segment crosses material.");
        });
        run("blocked shortest corridor yields to the longer admissible corridor", () =>
        {
            var kernel = Kernel(Box("short-wall", x0: 34, x1: 36, y0: -1, y1: 1));
            var result = Calculator.CalculateConstrained(Network(), P(-1), P(81), CableCategory.Control, Query(kernel), Options());
            Need(result.Status == ConstrainedRouteStatus.Clear && result.Route.Success && result.Route.SegmentIds.Contains("LONG0")
                && !result.Route.SegmentIds.Contains("SHORT0") && result.Route.ConnectionGapCount == 5,
                "Shortest priority admitted blocked material or rejected the valid detour.");
            Need(Math.Abs(result.Route.LengthMeters - 92) < 1e-9, "The fallback's actual geometry changed.");
        });
        run("physical-distance optimum survives graph memory and serialized recipe reuse", () =>
        {
            var cache = new GraphPreparationCache(); RouteResult first;
            using (cache.BeginRequest("physical-first")) first = Calculator.Calculate(Network(), P(-1), P(81), CableCategory.Control, Options()); Short(first);
            for (var i = 0; i < 2; i++) using (cache.BeginRequest("physical-first"))
            {
                var next = Calculator.Calculate(Network().Reverse(), P(-1), P(81), CableCategory.Control, Options()); Short(next);
                Need(JsonSerializer.Serialize(first) == JsonSerializer.Serialize(next), "A cached graph changed the selected route.");
            }
            var restored = new GraphPreparationCache(); Need(restored.Import("physical-first", cache.Export("physical-first")), "Fixture graph import failed.");
            using (restored.BeginRequest("physical-first")) Short(Calculator.Calculate(Network(), P(-1), P(81), CableCategory.Control, Options()));
        });
        run("gap count remains a deterministic tie-break only at equal physical distance", () =>
        {
            var route = Calculator.Calculate(Network(shortHeight: 5), P(-1), P(81), CableCategory.Control, Options());
            Need(route.Success && route.LengthMeters == 92 && route.ConnectionGapCount == 5 && route.SegmentIds.Contains("LONG0"),
                "An exactly equal physical length did not retain the fewer-gap tie-break.");
        });
        run("soft balancing cannot displace a shorter admissible seven-gap cable", () =>
        {
            var costs = Enumerable.Range(0, 8).Select(i => new RouteCostMultiplier("/SHORT" + i, 1000)).ToArray();
            var cache = new GraphPreparationCache();
            for (var i = 0; i < 2; i++) using (cache.BeginRequest("weighted-physical"))
                Short(Calculator.CalculateLoadBalanced(Network(), P(-1), P(81), CableCategory.Control, costs, Options()));
            var kernel = Kernel(Box("far", x0: 100, x1: 101));
            var protectedRoute = CapacityRouting.CalculateWithLocalApproaches(Network(), [], P(-1), P(81), CableCategory.Control,
                Query(kernel), Options(), routeCostMultipliers: costs);
            Need(protectedRoute.RouteEvaluation.Status == ConstrainedRouteStatus.Clear, "The weighted physical path was not clear.");
            Short(protectedRoute.RouteEvaluation.Route);
            Need(protectedRoute.RouteEvaluation.FinalChecks.All(check => check.Observation.Status == RouteCollisionStatus.Clear),
                "Weights bypassed a final physical clearance check.");
        });
        run("soft balancing chooses among equal physical lengths before gap-count ties without caching old weights", () =>
        {
            var cache = new GraphPreparationCache();
            var penalizeShort = Enumerable.Range(0, 8).Select(i => new RouteCostMultiplier("/SHORT" + i, 100)).ToArray();
            var penalizeLong = Enumerable.Range(0, 6).Select(i => new RouteCostMultiplier("/LONG" + i, 100)).ToArray();
            using (cache.BeginRequest("equal-physical-soft-tie"))
            {
                var value = Calculator.CalculateLoadBalanced(Network(shortHeight: 5), P(-1), P(81), CableCategory.Control, penalizeShort, Options());
                Need(value.Success && value.LengthMeters == 92 && value.SegmentIds.Contains("LONG0"), "Equal physical paths ignored soft preference.");
            }
            using (var request = cache.BeginRequest("equal-physical-soft-tie"))
            {
                var value = Calculator.CalculateLoadBalanced(Network(shortHeight: 5), P(-1), P(81), CableCategory.Control, penalizeLong, Options());
                Need(value.Success && value.LengthMeters == 92 && value.SegmentIds.Contains("SHORT0") && value.ConnectionGapCount == 7,
                    "Old weights or fewer gaps displaced the equal-physical soft preference.");
                Need(request.Diagnostics.BasisMemoryHits > 0, "The test did not exercise reusable graph contacts.");
            }
        });
    }
}
