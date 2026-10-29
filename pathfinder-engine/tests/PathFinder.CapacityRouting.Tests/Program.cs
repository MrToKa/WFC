using System.Text.Json;
using AddinRibbon.Routing;

internal static class Program
{
    private static readonly List<object> Checks = [];
    private static int failures;
    private static RoutePoint P(double x, double y = 0) => new(x, y, 0);
    private static TraySegment Tray(string code, params RoutePoint[] points) => new(code, code, CableCategory.Control, points);
    private static void Need(bool value, string reason = "Capacity routing assertion failed.")
    { if (!value) throw new InvalidOperationException(reason); }
    private static void Test(string name, Action action)
    { try { action(); Checks.Add(new { name, status = "PASS" }); } catch (Exception e) { failures++; Checks.Add(new { name, status = "FAIL", message = e.Message }); } }
    private static RoutingOptions Options() => new() { ConnectionToleranceMeters = .1, SampleSpacingMeters = .125,
        SecondaryDistanceMeters = 2, PreferVerticalApproach = false, MaxGraphNodes = 10000, MaxGraphConnections = 30000 };
    private static readonly TraySegment[] Diamond = [
        Tray("/C001", P(0), P(1)), Tray("/BC100", P(1), P(9)),
        Tray("/BC200", P(1), P(1,5), P(9,5), P(9)), Tray("/C002", P(9), P(10)),
    ];
    private static RouteCollisionObservation Clear(RoutePoint a, RoutePoint b, CancellationToken token) =>
        new(RouteCollisionStatus.Clear, null, "SYNTHETIC_CLEAR", 1);
    private static RouteResult Route(IEnumerable<TraySegment> trays) => new RouteCalculator().Calculate(trays, P(0), P(10), CableCategory.Control, Options());
    private static int Main()
    {
        Test("diamond chooses longer available branch after a per-query exclusion", () => {
            var first = Route(Diamond); Need(first.Success && first.RouteCodes.Contains("/BC100"));
            var alternate = Route(CapacityRouting.Filter(Diamond, ["/BC100"]));
            Need(alternate.Success && alternate.RouteCodes.Contains("/BC200") && !alternate.RouteCodes.Contains("/BC100"));
            Need(alternate.LengthMeters > first.LengthMeters);
            Need(Route(Diamond).RouteText == first.RouteText, "Exclusions mutated the retained prepared input.");
        });
        Test("all excluded trays produce no route", () => {
            var route = Route(CapacityRouting.Filter(Diamond, Diamond.Select(t => t.RouteCode).ToArray()));
            Need(!route.Success && route.RouteCodes.Count == 0);
        });
        Test("omitted and empty exclusions retain original objects", () => {
            Need(ReferenceEquals(Diamond, CapacityRouting.Filter(Diamond, null!)));
            Need(ReferenceEquals(Diamond, CapacityRouting.Filter(Diamond, [])));
        });
        Test("distance decision uses original nearest trays before capacity filtering", () => {
            var original = new[] { Tray("/BC001", P(0), P(10)), Tray("/BC002", P(0,10), P(10,10)) };
            var value = CapacityRouting.CalculateSecondaryWithLocalApproaches(original, ["/BC001"], P(0), P(1), CableCategory.Control,
                Clear, Options(), drillThroughWalls:true);
            Need(!value.SecondaryEvaluation.DistanceQualified);
            Need(value.SecondaryEvaluation.DistanceDecision.NearestFromMeters == 0);
            Need(value.SecondaryEvaluation.DistanceDecision.EligibleTrays == 2);
            Need(value.LocalApproaches.RouteEvaluation.Route.Success && value.LocalApproaches.RouteEvaluation.Route.RouteCodes.Contains("/BC002"));
        });
        Test("genuine direct SECONDARY remains available when no trays may be traversed", () => {
            var far = new[] { Tray("/BC001", P(0,10), P(10,10)) };
            var value = CapacityRouting.CalculateSecondaryWithLocalApproaches(far, ["/BC001"], P(0), P(1), CableCategory.Control,
                Clear, Options());
            Need(value.SecondaryEvaluation.DistanceQualified && value.SecondaryEvaluation.DirectDisposition == "clear");
            Need(value.LocalApproaches.RouteEvaluation.Route.Success && value.LocalApproaches.RouteEvaluation.Route.RouteCodes.All(code => code == "/SECONDARY"));
            Need(value.LocalApproaches.RouteEvaluation.FinalChecks.Count == 1);
        });
        Test("constrained alternate retains checks for its actual clear geometry", () => {
            var value = CapacityRouting.CalculateSecondaryWithLocalApproaches(Diamond, ["/BC100"], P(0), P(10), CableCategory.Control,
                Clear, Options(), interTrayManeuvers:true);
            var route = value.LocalApproaches.RouteEvaluation.Route;
            Need(route.Success && !route.RouteCodes.Contains("/BC100"));
            Need(value.LocalApproaches.RouteEvaluation.FinalChecks.Count == route.PathPoints.Count - 1);
            Need(value.LocalApproaches.RouteEvaluation.FinalChecks.All(check => check.Observation.Status == RouteCollisionStatus.Clear));
        });
        Test("bounded exclusions reject malformed, duplicate and oversized lists", () => {
            foreach (var codes in new[] { new[] { "/bc100" }, new[] { "/BC100\n" }, new[] { "/BC100", "/BC100" }, new[] { "BC100" },
                new[] { "/" + new string('A',256) }, Enumerable.Range(0,4097).Select(i => "/BC"+i).ToArray() }) {
                bool rejected = false; try { CapacityRouting.ValidateExcludedRouteCodes(codes); } catch (ArgumentException) { rejected = true; }
                Need(rejected);
            }
            CapacityRouting.ValidateExcludedRouteCodes(Enumerable.Range(0,4096).Select(i => "/BC"+i).ToArray());
        });
        Test("exclusions do not bypass original constrained input limits", () => {
            var value = CapacityRouting.CalculateWithLocalApproaches(Diamond, Diamond.Select(t => t.RouteCode).ToArray(), P(0), P(10),
                CableCategory.Control, Clear, Options(), new ConstrainedRoutingLimits { MaxInputTrays = 1 });
            Need(!value.RouteEvaluation.Route.Success && value.RouteEvaluation.Reason == "INPUT_TRAY_LIMIT");
        });
        Test("load balancing chooses a longer underloaded branch without blocking either branch", () => {
            var route = new RouteCalculator().CalculateLoadBalanced(Diamond, P(0), P(10), CableCategory.Control,
                [new("/BC100", 10)], Options());
            Need(route.Success && route.RouteCodes.Contains("/BC200") && !route.RouteCodes.Contains("/BC100"));
            var actual = Route(CapacityRouting.Filter(Diamond, ["/BC100"]));
            Need(route.LengthMeters == actual.LengthMeters && route.LengthMeters == 20, "Selection cost leaked into physical length.");
            Need(route.PathPoints.SequenceEqual(actual.PathPoints));
        });
        Test("omitted empty and all-unit weights retain the full original result", () => {
            var old = JsonSerializer.Serialize(Route(Diamond));
            foreach (var costs in new IReadOnlyList<RouteCostMultiplier>?[] { null, [], [new("/BC100", 1)] }) {
                var route = new RouteCalculator().CalculateLoadBalanced(Diamond, P(0), P(10), CableCategory.Control, costs!, Options());
                Need(old == JsonSerializer.Serialize(route));
            }
            var baseline = CapacityRouting.CalculateWithLocalApproaches(Diamond, [], P(0), P(10), CableCategory.Control, Clear, Options());
            var uniform = CapacityRouting.CalculateWithLocalApproaches(Diamond, [], P(0), P(10), CableCategory.Control, Clear, Options(),
                routeCostMultipliers: [new("/BC100", 1)]);
            Need(JsonSerializer.Serialize(baseline) == JsonSerializer.Serialize(uniform));
        });
        Test("weighted constrained search retains actual clear final checks and measured length", () => {
            var value = CapacityRouting.CalculateSecondaryWithLocalApproaches(Diamond, [], P(0), P(10), CableCategory.Control,
                Clear, Options(), interTrayManeuvers:true, routeCostMultipliers: [new("/BC100", 10)]);
            var evaluated = value.LocalApproaches.RouteEvaluation;
            Need(evaluated.Route.Success && evaluated.Route.RouteCodes.Contains("/BC200") && evaluated.Route.LengthMeters == 20);
            Need(evaluated.FinalChecks.Count == evaluated.Route.PathPoints.Count - 1);
            Need(evaluated.FinalChecks.All(check => check.Observation.Status == RouteCollisionStatus.Clear));
            Need(!value.SecondaryEvaluation.DistanceQualified);
        });
        Test("preferred weighted branch cannot bypass an obstructing wall", () => {
            RouteCollisionObservation Wall(RoutePoint a, RoutePoint b, CancellationToken token) =>
                new(a.Y > 4 && b.Y > 4 ? RouteCollisionStatus.Blocked : RouteCollisionStatus.Clear, null, "SYNTHETIC_WALL", 1);
            var value = CapacityRouting.CalculateWithLocalApproaches(Diamond, [], P(0), P(10), CableCategory.Control, Wall,
                Options(), interTrayManeuvers:true, routeCostMultipliers: [new("/BC100", 10)]);
            Need(value.RouteEvaluation.Route.Success && value.RouteEvaluation.Route.RouteCodes.Contains("/BC100"));
            Need(!value.RouteEvaluation.Route.RouteCodes.Contains("/BC200"));
            Need(value.RouteEvaluation.FinalChecks.All(check => check.Observation.Status == RouteCollisionStatus.Clear));
        });
        Test("same destination preference joins a common trunk using its own valid From prefix", () => {
            var network = Diamond.Append(Tray("/C003", P(0,-5), P(0))).ToArray();
            var weights = new[] { new RouteCostMultiplier("/BC100", 10) };
            var first = new RouteCalculator().CalculateLoadBalanced(network, P(0), P(10), CableCategory.Control, weights, Options());
            var other = new RouteCalculator().CalculateLoadBalanced(network, P(0,-5), P(10), CableCategory.Control, weights, Options());
            Need(first.Success && other.Success && first.RouteCodes.Contains("/BC200") && other.RouteCodes.Contains("/BC200"));
            Need(!first.RouteCodes.Contains("/C003") && other.RouteCodes.Contains("/C003"));
            Need(other.PathPoints[0].Equals(P(0,-5)) && other.LengthMeters == first.LengthMeters + 5);
        });
        Test("weighted query retains category permission and drilling uses true physical length", () => {
            var forbidden = new TraySegment("forbidden", "/BC999", CableCategory.LV, [P(1), P(9)]);
            var route = new RouteCalculator().CalculateLoadBalanced(Diamond.Append(forbidden), P(0), P(10), CableCategory.Control,
                [new("/BC100", 10)], Options());
            Need(route.Success && route.RouteCodes.Contains("/BC200") && !route.RouteCodes.Contains("/BC999"));
            var drilled = CapacityRouting.CalculateWithLocalApproaches(Diamond, [], P(0), P(10), CableCategory.Control,
                (_,_,_) => throw new InvalidOperationException("Drilling called the oracle."), Options(), drillThroughWalls:true,
                routeCostMultipliers:[new("/BC100", 10)]);
            Need(drilled.RouteEvaluation.Route.RouteText == route.RouteText && drilled.RouteEvaluation.Route.LengthMeters == 20);
            Need(drilled.RouteEvaluation.CollisionQueries == 0);
        });
        Test("weights retain original direct-secondary decision and original gap precedence", () => {
            var far = new[] { Tray("/BC001", P(0,10), P(10,10)) };
            var value = CapacityRouting.CalculateSecondaryWithLocalApproaches(far, [], P(0), P(1), CableCategory.Control,
                Clear, Options(), routeCostMultipliers: [new("/BC001", 1000)]);
            Need(value.SecondaryEvaluation.DistanceQualified && value.LocalApproaches.RouteEvaluation.Route.RouteText == "/SECONDARY");
            var network = new[] { Tray("/C001", P(0),P(1)), Tray("/BC100",P(1),P(9)),
                Tray("/BC200",P(1,.05),P(1,5),P(9,5),P(9,.05)), Tray("/C002",P(9),P(10)) };
            var route = new RouteCalculator().CalculateLoadBalanced(network, P(0), P(10), CableCategory.Control,
                [new("/BC100", 1000)], Options());
            Need(route.Success && route.RouteCodes.Contains("/BC100") && route.ConnectionGapCount == 0);
        });
        Test("route weights enforce count canonical uniqueness and finite positive bounded costs", () => {
            foreach (var costs in new[] { new[] { new RouteCostMultiplier("/bc001", 2) },
                new[] { new RouteCostMultiplier("/BC001", 2), new RouteCostMultiplier("/BC001", 3) },
                new[] { new RouteCostMultiplier("/BC001", double.NaN) }, new[] { new RouteCostMultiplier("/BC001", double.PositiveInfinity) },
                new[] { new RouteCostMultiplier("/BC001", .999) }, new[] { new RouteCostMultiplier("/BC001", 1000.01) },
                Enumerable.Range(0,4097).Select(i => new RouteCostMultiplier("/BC"+i,2)).ToArray() }) {
                bool rejected = false; try { LoadBalancedRouting.ValidateRouteCostMultipliers(costs); } catch (ArgumentException) { rejected = true; }
                Need(rejected);
            }
            LoadBalancedRouting.ValidateRouteCostMultipliers(Enumerable.Range(0,4096).Select(i => new RouteCostMultiplier("/BC"+i,1000)).ToArray());
        });
        Console.WriteLine(JsonSerializer.Serialize(new { status = failures == 0 ? "PASS" : "FAIL", passed = Checks.Count - failures, failed = failures, checks = Checks }));
        return failures == 0 ? 0 : 1;
    }
}
