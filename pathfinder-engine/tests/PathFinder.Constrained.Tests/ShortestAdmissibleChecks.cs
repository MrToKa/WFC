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
    private static TraySegment[] Network(double shortHeight = 0, double longGap = .125)
    {
        const double shortGap = .125;
        var trays = new List<TraySegment> { Port("00_FROM", P(-1), P(0)), Port("99_TO", P(80), P(81)) };
        for (var i = 0; i < 8; i++)
        {
            var points = new List<RoutePoint>(); if (i == 0) points.Add(P(0));
            points.Add(P(i * 10 + (i == 0 ? 0 : shortGap), -shortHeight)); points.Add(P((i + 1) * 10, -shortHeight));
            if (i == 7) points.Add(P(80)); trays.Add(Port("SHORT" + i, points.ToArray()));
        }
        for (var i = 0; i < 6; i++)
        {
            var points = new List<RoutePoint>(); if (i == 0) points.Add(P(0));
            points.Add(P(i * 12 + (i == 0 ? 0 : longGap), 5)); points.Add(P(i == 5 ? 80 : (i + 1) * 12, 5));
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
    private static void LowerGap(RouteResult route)
    {
        Need(route.Success && route.SegmentIds.Contains("LONG0") && !route.SegmentIds.Contains("SHORT0"), "The larger gap sum won.");
        Need(route.ConnectionGapCount == 5 && Math.Abs(route.ConnectionGapLengthMeters - .625) < 1e-9, "Unexpected gap ledger.");
        Need(Math.Abs(route.LengthMeters - 92) < 1e-9, "The selected route lost its actual cable length.");
    }
    internal static void Run(Action<string, Action> run)
    {
        run("smaller total gap wins over a physically shorter admissible corridor", () =>
        {
            var route = Calculator.Calculate(Network(), P(-1), P(81), CableCategory.Control, Options()); LowerGap(route);
            var inverse = Calculator.Calculate(Network().Reverse(), P(81), P(-1), CableCategory.Control, Options()); LowerGap(inverse);
            Need(inverse.RouteText == route.Reverse().RouteText, "Reversing the query changed the chosen corridor.");
        });
        run("the shorter gap between the same two trays wins when clear", () =>
        {
            var trays = new[] { Port("A1", P(0), P(0, 5), P(1, 5)), Port("B1", P(.2), P(5), P(5, 5), P(1.05, 5)) };
            var clear = Calculator.CalculateConstrained(trays, P(0), P(.2), CableCategory.Control,
                Query(Kernel(Box("far", x0: 100, x1: 101))), Options());
            Need(clear.Status == ConstrainedRouteStatus.Clear && Math.Abs(clear.Route.ConnectionGapLengthMeters - .05) < 1e-9,
                "Cable length took priority over the smaller gap between the same trays.");
            var blocked = Calculator.CalculateConstrained(trays, P(0), P(.2), CableCategory.Control,
                Query(Kernel(Box("gap-wall", x0: 1.01, x1: 1.04, y0: 4.99, y1: 5.01))), Options());
            Need(blocked.Status == ConstrainedRouteStatus.Clear && Math.Abs(blocked.Route.ConnectionGapLengthMeters - .2) < 1e-9,
                "A blocked smaller gap displaced the next clear connection.");
        });
        run("smaller total gap still wins after actual closed-material filtering", () =>
        {
            var kernel = Kernel(Box("far", x0: 100, x1: 101));
            var result = Calculator.CalculateConstrained(Network(), P(-1), P(81), CableCategory.Control, Query(kernel), Options());
            Need(result.Status == ConstrainedRouteStatus.Clear, "The selected physical path was not proved clear."); LowerGap(result.Route);
            foreach (var pair in result.Route.PathPoints.Zip(result.Route.PathPoints.Skip(1)))
                Need(kernel.CheckSegment(B(pair.First), B(pair.Second)).Status == BarrierSegmentStatus.Clear, "A selected segment crosses material.");
        });
        run("a blocked smaller-gap corridor yields to the larger admissible gaps", () =>
        {
            var kernel = Kernel(Box("long-wall", x0: 34, x1: 36, y0: 4, y1: 6));
            var result = Calculator.CalculateConstrained(Network(), P(-1), P(81), CableCategory.Control, Query(kernel), Options());
            Need(result.Status == ConstrainedRouteStatus.Clear, "Gap priority admitted blocked material or rejected the valid detour.");
            Short(result.Route);
        });
        run("the smallest-gap route survives graph memory and serialized recipe reuse", () =>
        {
            var cache = new GraphPreparationCache(); RouteResult first;
            using (cache.BeginRequest("gap-first")) first = Calculator.Calculate(Network(), P(-1), P(81), CableCategory.Control, Options()); LowerGap(first);
            for (var i = 0; i < 2; i++) using (cache.BeginRequest("gap-first"))
            {
                var next = Calculator.Calculate(Network().Reverse(), P(-1), P(81), CableCategory.Control, Options()); LowerGap(next);
                Need(JsonSerializer.Serialize(first) == JsonSerializer.Serialize(next), "A cached graph changed the selected route.");
            }
            var restored = new GraphPreparationCache(); Need(restored.Import("gap-first", cache.Export("gap-first")), "Fixture graph import failed.");
            using (restored.BeginRequest("gap-first")) LowerGap(Calculator.Calculate(Network(), P(-1), P(81), CableCategory.Control, Options()));
        });
        run("gap count breaks ties when gap sum and physical length are equal", () =>
        {
            var route = Calculator.Calculate(Network(shortHeight: 5, longGap: .175), P(-1), P(81), CableCategory.Control, Options());
            Need(route.Success && route.LengthMeters == 92 && route.ConnectionGapCount == 5 && route.SegmentIds.Contains("LONG0"),
                "An exactly equal physical length did not retain the fewer-gap tie-break.");
        });
        run("soft balancing cannot displace a route with smaller admissible gaps", () =>
        {
            var costs = Enumerable.Range(0, 6).Select(i => new RouteCostMultiplier("/LONG" + i, 1000)).ToArray();
            var cache = new GraphPreparationCache();
            for (var i = 0; i < 2; i++) using (cache.BeginRequest("weighted-gap"))
                LowerGap(Calculator.CalculateLoadBalanced(Network(), P(-1), P(81), CableCategory.Control, costs, Options()));
            var kernel = Kernel(Box("far", x0: 100, x1: 101));
            var protectedRoute = CapacityRouting.CalculateWithLocalApproaches(Network(), [], P(-1), P(81), CableCategory.Control,
                Query(kernel), Options(), routeCostMultipliers: costs);
            Need(protectedRoute.RouteEvaluation.Status == ConstrainedRouteStatus.Clear, "The weighted physical path was not clear.");
            LowerGap(protectedRoute.RouteEvaluation.Route);
            Need(protectedRoute.RouteEvaluation.FinalChecks.All(check => check.Observation.Status == RouteCollisionStatus.Clear),
                "Weights bypassed a final physical clearance check.");
        });
        run("soft balancing breaks equal-gap and equal-length ties without caching old weights", () =>
        {
            var cache = new GraphPreparationCache();
            var penalizeShort = Enumerable.Range(0, 8).Select(i => new RouteCostMultiplier("/SHORT" + i, 100)).ToArray();
            var penalizeLong = Enumerable.Range(0, 6).Select(i => new RouteCostMultiplier("/LONG" + i, 100)).ToArray();
            using (cache.BeginRequest("equal-physical-soft-tie"))
            {
                var value = Calculator.CalculateLoadBalanced(Network(shortHeight: 5, longGap: .175), P(-1), P(81), CableCategory.Control, penalizeShort, Options());
                Need(value.Success && value.LengthMeters == 92 && value.SegmentIds.Contains("LONG0"), "Equal physical paths ignored soft preference.");
            }
            using (var request = cache.BeginRequest("equal-physical-soft-tie"))
            {
                var value = Calculator.CalculateLoadBalanced(Network(shortHeight: 5, longGap: .175), P(-1), P(81), CableCategory.Control, penalizeLong, Options());
                Need(value.Success && value.LengthMeters == 92 && value.SegmentIds.Contains("SHORT0") && value.ConnectionGapCount == 7,
                    "Old weights or fewer gaps displaced the equal-physical soft preference.");
                Need(request.Diagnostics.BasisMemoryHits > 0, "The test did not exercise reusable graph contacts.");
            }
        });
    }
}
