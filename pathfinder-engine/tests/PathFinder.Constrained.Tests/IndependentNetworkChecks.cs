using AddinRibbon.Routing;
using PathFinder.Barriers;
using static Fixtures;

internal static class IndependentNetworkChecks
{
    private static readonly RouteCalculator Calculator = new();
    private static void Need(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    private static RoutingOptions Options() => new() { ConnectionToleranceMeters = .25, PreferVerticalApproach = false };
    private static TraySegment Chain(string id, bool independent, params RoutePoint[] points) => new(id, "/" + id,
        CableCategory.Control, points, true,
        [new(points[0], P(-1), P(0, 1), P(0, 0, 1), .3, .06),
         new(points[^1], P(1), P(0, 1), P(0, 0, 1), .3, .06)], null, independent);
    private static RouteResult Plain(TraySegment[] trays, RoutePoint from, RoutePoint to) =>
        Calculator.Calculate(trays, from, to, CableCategory.Control, Options());
    private static RouteCollisionQuery Query(BarrierCollisionKernel kernel) => (from, to, token) =>
    {
        var observation = kernel.CheckSegment(B(from), B(to), token);
        return new(observation.Status switch { BarrierSegmentStatus.Clear => RouteCollisionStatus.Clear,
            BarrierSegmentStatus.Blocked => RouteCollisionStatus.Blocked, _ => RouteCollisionStatus.Indeterminate },
            observation.BarrierId, observation.Reason, observation.Work);
    };

    internal static void Run(Action<string, Action> run)
    {
        AutomaticComponents(run);
        run("standalone CAD chain retains its own polyline and interior equipment projections", () =>
        {
            var route = Plain([Chain("CAD001", true, P(0), P(.6), P(.6, .6))], P(.1), P(.6, .5));
            Need(route.Success && route.SegmentIds.SequenceEqual(new[] { "CAD001" }), "Independent internal graph disappeared.");
            Need(Math.Abs(route.LengthMeters - 1) < 1e-9, "Polyline was replaced by a diagonal chord.");
        });
        run("standalone CAD chain cannot borrow a nearby base endpoint across connectionGap", () =>
        {
            var trays = new[] { Chain("BASE", false, P(-1), P(0)), Chain("CAD001", true, P(.01), P(1.21)) };
            Need(!Plain(trays, P(-1), P(1.21)).Success, "Distance fallback joined standalone to base.");
        });
        run("standalone CAD chain remains isolated at genuinely compatible coincident ports", () =>
        {
            var trays = new[] { Chain("BASE", false, P(-1), P(0)), Chain("CAD001", true, P(0), P(1.2)) };
            Need(!Plain(trays, P(-1), P(1.2)).Success, "Independent mode silently became attached at a physical port.");
            Need(Plain([trays[0], Chain("CAD001", false, P(0), P(1.2))], P(-1), P(1.2)).Success,
                "Historical attached behavior changed.");
        });
        run("two independent named chains do not gain implicit links to each other", () =>
        {
            Need(!Plain([Chain("CAD001", true, P(0), P(1.2)), Chain("CAD002", true, P(1.2), P(2.4))], P(0), P(2.4)).Success,
                "Different independent route groups merged.");
        });
        run("load-balanced graph respects standalone isolation", () =>
        {
            var route = Calculator.CalculateLoadBalanced([Chain("BASE", false, P(-1), P(0)), Chain("CAD001", true, P(.01), P(1.21))],
                P(-1), P(1.21), CableCategory.Control, [new("/BASE", 2)], Options());
            Need(!route.Success, "Weighted graph dropped independent identity.");
        });
        run("explicit ordered lookup cannot invent a standalone-to-base connector", () =>
        {
            var trays = new[] { Chain("BASE", false, P(-1), P(0)), Chain("CAD001", true, P(.01), P(1.21)) };
            Need(!RouteLookupCalculator.Calculate(trays, new[] { "/BASE", "/CAD001" }, Options()).Success,
                "Ordered lookup borrowed a proximity connector.");
            Need(RouteLookupCalculator.Calculate(trays, new[] { "/CAD001" }, Options()).Success,
                "A standalone route's own explicit lookup failed.");
        });
        run("same-cache attached and standalone graphs cannot reuse opposite connectivity", () =>
        {
            var cache = new GraphPreparationCache();
            TraySegment[] Network(bool independent) => [Chain("BASE", false, P(-1), P(0)), Chain("CAD001", independent, P(.01), P(1.21))];
            using (cache.BeginRequest("same-composite-test")) Need(Plain(Network(false), P(-1), P(1.21)).Success, "Attached baseline failed.");
            using (var independent = cache.BeginRequest("same-composite-test"))
            {
                Need(!Plain(Network(true), P(-1), P(1.21)).Success, "Attached cached contacts escaped isolation.");
                Need(independent.Diagnostics.BasisMemoryHits == 0, "Independent flag missing from graph fingerprint.");
            }
            using (var repeated = cache.BeginRequest("same-composite-test"))
            {
                Need(!Plain(Network(true), P(-1), P(1.21)).Success, "Repeated standalone graph gained a connection.");
                Need(repeated.Diagnostics.BasisMemoryHits > 0, "Standalone basis was not reusable.");
            }
        });
        run("constrained standalone route keeps active closed-material collision proof", () =>
        {
            var kernel = Kernel(Box("far-solid", x0: 20, x1: 21));
            var route = Calculator.CalculateConstrained([Chain("BASE", false, P(-1), P(0)), Chain("CAD001", true, P(.01), P(1.21))],
                P(.01), P(1.21), CableCategory.Control, Query(kernel), Options());
            Need(route.Status == ConstrainedRouteStatus.Clear && route.Route.Success
                && route.Route.SegmentIds.SequenceEqual(new[] { "CAD001" }), "Actual standalone route was not selected and checked.");
            for (var i = 1; i < route.Route.PathPoints.Count; i++)
                Need(kernel.CheckSegment(B(route.Route.PathPoints[i - 1]), B(route.Route.PathPoints[i])).Status == BarrierSegmentStatus.Clear,
                    "Reported route crosses actual material.");
        });
        run("persisted attached graph contacts cannot be imported as standalone connectivity", () =>
        {
            var attached = new GraphPreparationCache();
            using (attached.BeginRequest("same-import-test"))
                Need(Plain([Chain("BASE", false, P(-1), P(0)), Chain("CAD001", false, P(.01), P(1.21))], P(-1), P(1.21)).Success,
                    "Attached export baseline failed.");
            var persisted = attached.Export("same-import-test");
            var restored = new GraphPreparationCache(); Need(restored.Import("same-import-test", persisted), "Fixture graph import failed.");
            using var request = restored.BeginRequest("same-import-test");
            Need(!Plain([Chain("BASE", false, P(-1), P(0)), Chain("CAD001", true, P(.01), P(1.21))], P(-1), P(1.21)).Success,
                "Persisted attached contacts escaped isolation.");
            Need(request.Diagnostics.BasisImportedHits == 0, "Isolation did not partition persisted recipe identity.");
        });
        run("standalone mode never bypasses material cutting through its only route", () =>
        {
            var kernel = Kernel(Box("cutting-solid", x0: .5, x1: .7));
            var route = Calculator.CalculateConstrained([Chain("CAD001", true, P(0), P(1.2))], P(0), P(1.2),
                CableCategory.Control, Query(kernel), Options());
            Need(!route.Route.Success && route.Status != ConstrainedRouteStatus.Clear, "Independent route bypassed a real solid.");
        });
    }

    private static void AutomaticComponents(Action<string, Action> run)
    {
        TraySegment[] Network(double gap) => [Chain("BASE", false, P(-1), P(0)), Chain("CAD001", false, P(gap), P(gap + 1.2))];
        run("automatic CAD topology joins real endpoint gaps exactly at the project threshold", () =>
        {
            var route = Plain(Network(.25), P(-1), P(1.45));
            Need(route.Success && route.SegmentIds.SequenceEqual(new[] { "BASE", "CAD001" }), "Actual gap did not form the component.");
            Need(route.ConnectionGapCount == 1 && route.ConnectionGapLengthMeters == .25, "Physical gap was hidden as proved continuity.");
            Need(Math.Abs(route.LengthMeters - 2.45) < 1e-12, "Real connector was omitted from physical length.");
        });
        run("automatic CAD topology does not invent a link one representable step beyond project gap", () =>
        {
            Need(!Plain(Network(Math.BitIncrement(.25)), P(-1), P(Math.BitIncrement(.25) + 1.2)).Success,
                "A beyond-gap component was silently connected.");
        });
        run("changed project gap separates cached automatic CAD component topology", () =>
        {
            var cache = new GraphPreparationCache(); var network = Network(.25);
            using (cache.BeginRequest("automatic-same-geometry")) Need(Plain(network, P(-1), P(1.45)).Success, "Initial component failed.");
            using (var request = cache.BeginRequest("automatic-same-geometry"))
            {
                var lower = Options(); lower.ConnectionToleranceMeters = Math.BitDecrement(.25);
                Need(!Calculator.Calculate(network, P(-1), P(1.45), CableCategory.Control, lower).Success,
                    "Cached connectivity survived a smaller project gap.");
                Need(request.Diagnostics.BasisMemoryHits == 0, "Project gap missing from graph cache identity.");
            }
        });
        run("automatic disconnected CAD component routes its own consumers without base attachment", () =>
        {
            var network = Network(3); var result = Plain(network, P(3), P(4.2));
            Need(result.Success && result.SegmentIds.SequenceEqual(new[] { "CAD001" }), "Disconnected consumers could not use their own component.");
            Need(!Plain(network, P(-1), P(4.2)).Success, "Separate components gained an artificial link.");
        });
        run("automatic gap semantics retain profile mismatch as a measured gap rather than a proven seam", () =>
        {
            // Normal project-gap policy admits nearby physical endpoints even
            // without matching sections; only verified contact earns zero gap.
            var baseTray = new TraySegment("BASE", "/BASE", CableCategory.Control, new[] { P(-1), P(0) }, true,
                new[] { new RouteConnectionPort(P(0), P(1), P(0, 1), P(0, 0, 1), .6, .1) });
            var route = Plain([baseTray, Chain("CAD001", false, P(.2), P(1.4))], P(-1), P(1.4));
            Need(route.Success && route.ConnectionGapCount == 1 && Math.Abs(route.ConnectionGapLengthMeters - .2) < 1e-12,
                "Normal gap semantics changed or incompatible sections were relabeled continuous.");
        });
        run("automatic connected CAD/base route still proves every segment against active material", () =>
        {
            var kernel = Kernel(Box("far-solid", x0: 20, x1: 21));
            var result = Calculator.CalculateConstrained(Network(.2), P(-1), P(1.4), CableCategory.Control, Query(kernel), Options());
            Need(result.Status == ConstrainedRouteStatus.Clear && result.Route.Success
                && result.Route.SegmentIds.SequenceEqual(new[] { "BASE", "CAD001" }), "Normal automatic composite route was not checked.");
            for (var i = 1; i < result.Route.PathPoints.Count; i++)
                Need(kernel.CheckSegment(B(result.Route.PathPoints[i - 1]), B(result.Route.PathPoints[i])).Status == BarrierSegmentStatus.Clear,
                    "Composite route contains an unchecked material segment.");
        });
        run("automatic gap connectivity cannot traverse registered material inside that gap", () =>
        {
            var kernel = Kernel(Box("solid-in-gap", x0: .05, x1: .15));
            var result = Calculator.CalculateConstrained(Network(.2), P(-1), P(1.4), CableCategory.Control, Query(kernel), Options());
            Need(!result.Route.Success && result.Status != ConstrainedRouteStatus.Clear, "Project gap bypassed real barrier material.");
        });
    }
}
