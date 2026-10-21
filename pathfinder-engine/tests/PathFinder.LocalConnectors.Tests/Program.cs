using System.Diagnostics;
using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Barriers;
using static Fixtures;

internal static class Program
{
    private static readonly List<object> Checks = [];
    private static readonly RouteCalculator Calculator = new();
    private static int failures;
    private static long? numericPreflightAllocatedBytes;
    private static int Main(string[] args)
    {
        if (args.Length != 0) return 2;
        var elapsed = Stopwatch.StartNew();
        Standalone(); Integrated(); LegacyAndSecondary(); BudgetsAndRefusals(); elapsed.Stop();
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = "wfc.pf.local-connectors-checks.v1", status = failures == 0 ? "PASS" : "FAIL",
            passed = Checks.Count - failures, failed = failures, elapsedMilliseconds = elapsed.Elapsed.TotalMilliseconds,
            currentProcessPeakWorkingSet64 = Process.GetCurrentProcess().PeakWorkingSet64,
            numericPreflightAllocatedBytes,
            scope = "Synthetic bounded local-approach search against actual qualified closed-triangle solids; no converted-model or maximum-capacity qualification",
            physicalCableRadiusChecked = false, engineeringAccepted = false, nativeParity = "not-performed", checks = Checks
        }));
        return failures == 0 ? 0 : 1;
    }
    private static void Run(string name, Action body)
    {
        try { body(); Checks.Add(new { name, status = "PASS", detail = "" }); }
        catch (Exception error) { failures++; Checks.Add(new { name, status = "FAIL", detail = error.GetType().Name + ": " + error.Message }); }
    }
    private static void Need(bool value, string detail = "Synthetic assertion failed.") { if (!value) throw new InvalidOperationException(detail); }
    private static void Equal<T>(T expected, T actual) => Need(EqualityComparer<T>.Default.Equals(expected, actual), $"Expected {expected}; observed {actual}.");
    private static void Bits(double expected, double actual) => Equal(BitConverter.DoubleToInt64Bits(expected), BitConverter.DoubleToInt64Bits(actual));
    private static void Reject<T>(Action body) where T : Exception
    {
        try { body(); } catch (T) { return; } throw new InvalidOperationException("Expected " + typeof(T).Name + ".");
    }
    private static bool Same(RoutePoint a, RoutePoint b) => a.X == b.X && a.Y == b.Y && a.Z == b.Z;
    private static double Length(IReadOnlyList<RoutePoint> points)
    {
        double length = 0; for (var i = 1; i < points.Count; i++) length += points[i - 1].DistanceTo(points[i]); return length;
    }
    private static RoutingOptions Options(double secondary = 2) => new()
    {
        ConnectionToleranceMeters = .25, SampleSpacingMeters = .125, SecondaryDistanceMeters = secondary,
        MaxGraphNodes = 100_000, MaxGraphConnections = 300_000
    };
    private static RouteCollisionQuery Query(BarrierCollisionKernel kernel, Action<RoutePoint, RoutePoint>? observe = null) => (from, to, token) =>
    {
        observe?.Invoke(from, to); var value = kernel.CheckSegment(B(from), B(to), token);
        return new(value.Status switch { BarrierSegmentStatus.Clear => RouteCollisionStatus.Clear, BarrierSegmentStatus.Blocked => RouteCollisionStatus.Blocked, _ => RouteCollisionStatus.Indeterminate },
            value.BarrierId, value.Reason, value.Work);
    };
    private static LocalConnectorDomain Domain() => new(P(-1, 0, -.5), P(1, 2, .5), .25);
    private static RouteConnectorPlan Plan(RoutePoint from, RoutePoint to, RouteCollisionQuery query, LocalConnectorDomain? domain = null,
        LocalConnectorOptions? options = null, ConstrainedRoutingLimits? limits = null, CancellationToken token = default) =>
        LocalConnectorPlanner.Plan(from, to, query, domain ?? Domain(), options, limits, token);
    private static LocalApproachRouteEvaluation Route(TraySegment[] trays, RoutePoint from, RoutePoint to, RouteCollisionQuery query,
        RoutingOptions? routing = null, ConstrainedRoutingLimits? limits = null, LocalConnectorOptions? local = null, bool drill = false, CancellationToken token = default) =>
        Calculator.CalculateConstrainedWithLocalApproaches(trays, from, to, CableCategory.Control, query, routing ?? Options(), limits, local, drill, token);
    private static LocalSecondaryEvaluation Secondary(TraySegment[] trays, RoutePoint from, RoutePoint to, RouteCollisionQuery query,
        bool drill = false, LocalConnectorOptions? local = null, ConstrainedRoutingLimits? limits = null) =>
        ConstrainedSecondaryRoute.CalculateWithLocalApproaches(trays, from, to, CableCategory.Control, query, Options(), limits, local, drill);
    private static void ExactClear(IReadOnlyList<RoutePoint> points, BarrierCollisionKernel kernel)
    {
        Need(points.Count > 0);
        for (var i = 0; i < Math.Max(1, points.Count - 1); i++)
            Equal(BarrierSegmentStatus.Clear, kernel.CheckSegment(B(points[i]), B(points[Math.Min(i + 1, points.Count - 1)])).Status);
    }
    private static void ClearPlan(RouteConnectorPlan plan, RoutePoint from, RoutePoint to, BarrierCollisionKernel kernel)
    {
        Equal(LocalConnectorStatus.Clear, plan.Status); Need(plan.Points.Count > 0);
        Need(Same(from, plan.Points[0]) && Same(to, plan.Points[^1]), "Planner replaced an endpoint or tray station.");
        Bits(Length(plan.Points), plan.LengthMeters); Bits(from.DistanceTo(to), plan.DirectDistanceMeters); ExactClear(plan.Points, kernel);
    }
    private static void ClearRoute(LocalApproachRouteEvaluation value, BarrierCollisionKernel kernel)
    {
        Equal(ConstrainedRouteStatus.Clear, value.RouteEvaluation.Status); Need(value.RouteEvaluation.Route.Success && value.RouteEvaluation.Blocking is null);
        ExactClear(value.RouteEvaluation.Route.PathPoints, kernel);
    }
    private static void Incomplete(RouteConnectorPlan plan)
    {
        Equal(LocalConnectorStatus.SearchIncomplete, plan.Status); Need(!plan.SearchComplete);
        Need(!string.IsNullOrWhiteSpace(plan.Reason));
    }
    private static void ExactRoute(RouteResult expected, RouteResult actual)
    {
        Equal(expected.Success, actual.Success); Equal(expected.Message, actual.Message); Equal(expected.RouteText, actual.RouteText);
        Need(expected.RouteCodes.SequenceEqual(actual.RouteCodes)); Need(expected.SegmentIds.SequenceEqual(actual.SegmentIds)); Equal(expected.PathPoints.Count, actual.PathPoints.Count);
        for (var i = 0; i < expected.PathPoints.Count; i++) { Bits(expected.PathPoints[i].X, actual.PathPoints[i].X); Bits(expected.PathPoints[i].Y, actual.PathPoints[i].Y); Bits(expected.PathPoints[i].Z, actual.PathPoints[i].Z); }
        Bits(expected.LengthMeters, actual.LengthMeters); Bits(expected.FromDistanceMeters, actual.FromDistanceMeters); Bits(expected.ToDistanceMeters, actual.ToDistanceMeters);
        Equal(expected.FromRequiresSecondary, actual.FromRequiresSecondary); Equal(expected.ToRequiresSecondary, actual.ToRequiresSecondary);
        Equal(expected.ConnectionGapCount, actual.ConnectionGapCount); Bits(expected.ConnectionGapLengthMeters, actual.ConnectionGapLengthMeters);
        foreach (var settings in new[] { (S: 7m, E: 5m, P: 10m), (S: 0m, E: 0m, P: 0m), (S: 7.125m, E: 1.001m, P: 12.5m) })
        {
            var a = CableDesignLength.Calculate(expected, settings.E, settings.S, settings.P); var b = CableDesignLength.Calculate(actual, settings.E, settings.S, settings.P);
            Need(decimal.GetBits(a.LengthBeforePercentageMeters).SequenceEqual(decimal.GetBits(b.LengthBeforePercentageMeters)));
            Need(decimal.GetBits(a.UnroundedLengthMeters).SequenceEqual(decimal.GetBits(b.UnroundedLengthMeters)));
            Need(decimal.GetBits(a.DesignLengthMeters).SequenceEqual(decimal.GetBits(b.DesignLengthMeters)));
        }
    }

    private static void Standalone()
    {
        Run("offset wall opening requires turns and every accepted segment clears the actual tunnel", () =>
        {
            var kernel = Kernel(Opening()); var from = P(-.75, 1); var to = P(.75, 1);
            Equal(BarrierSegmentStatus.Blocked, kernel.CheckSegment(B(from), B(to)).Status);
            var plan = Plan(from, to, Query(kernel)); ClearPlan(plan, from, to, kernel);
            Need(plan.IsDetour && plan.Points.Count > 2 && plan.LengthMeters > plan.DirectDistanceMeters);
            Need(plan.Points.Any(point => point.Y < .6), "The connector did not reach the real opening.");
        });
        Run("rotated floor opening requires lateral movement before changing storey", () =>
        {
            var kernel = Kernel(Transform(Opening("floor"), point => B(point.Y, point.Z, point.X)));
            var from = P(1, 0, -.75); var to = P(1, 0, .75); var domain = new LocalConnectorDomain(P(0, -.5, -1), P(2, .5, 1), .25);
            Equal(BarrierSegmentStatus.Blocked, kernel.CheckSegment(B(from), B(to)).Status);
            var plan = Plan(from, to, Query(kernel), domain); ClearPlan(plan, from, to, kernel); Need(plan.IsDetour && plan.Points.Any(point => point.X < .6));
        });
        Run("offset closed tunnel near one million metres retains exact endpoint coordinates and real collision checks", () =>
        {
            const double shift = 1_000_000;
            var kernel = Kernel(Transform(Opening("translated-opening"), point => B(point.X + shift, point.Y + shift, point.Z + shift)));
            var from = P(shift - .75, shift + 1, shift); var to = P(shift + .75, shift + 1, shift);
            var domain = new LocalConnectorDomain(P(shift - 1, shift, shift - .5), P(shift + 1, shift + 2, shift + .5), .25);
            Equal(BarrierSegmentStatus.Blocked, kernel.CheckSegment(B(from), B(to)).Status);
            var plan = Plan(from, to, Query(kernel), domain); ClearPlan(plan, from, to, kernel); Need(plan.IsDetour);
            Bits(from.X, plan.Points[0].X); Bits(from.Y, plan.Points[0].Y); Bits(from.Z, plan.Points[0].Z);
            Bits(to.X, plan.Points[^1].X); Bits(to.Y, plan.Points[^1].Y); Bits(to.Z, plan.Points[^1].Z);
        });
        Run("unobstructed standalone chord stays exact without a gratuitous detour", () =>
        {
            var kernel = Kernel(Opening()); var from = P(-.75); var to = P(.75);
            var plan = Plan(from, to, Query(kernel), new(P(-1, -.5, -.5), P(1, .5, .5), .25)); ClearPlan(plan, from, to, kernel);
            Need(!plan.IsDetour); Equal(2, plan.Points.Count); Bits(1.5, plan.LengthMeters);
        });
        Run("zero-length exterior connector receives a point-occupancy check", () =>
        {
            var kernel = Kernel(Opening()); var point = P(-.75, 1); var calls = new List<(RoutePoint A, RoutePoint B)>();
            var plan = Plan(point, point, Query(kernel, (a, b) => calls.Add((a, b)))); ClearPlan(plan, point, point, kernel);
            Need(calls.Any(call => Same(call.A, point) && Same(call.B, point))); Bits(0, plan.LengthMeters);
        });
        Run("endpoint inside wall material cannot be escaped by a lattice shortcut", () =>
        {
            var kernel = Kernel(Opening()); var plan = Plan(P(.1, 1), P(.75, 1), Query(kernel));
            Need(plan.Status is not LocalConnectorStatus.Clear); Need(!string.IsNullOrWhiteSpace(plan.Reason)); Equal(0, plan.Points.Count);
        });
        Run("opening rim is material contact and cannot become a passable endpoint", () =>
        {
            var kernel = Kernel(Opening()); var from = P(.1, .6); Equal(BarrierSegmentStatus.Blocked, kernel.CheckSegment(B(from), B(from)).Status);
            var plan = Plan(from, P(.75, .6), Query(kernel)); Need(plan.Status is not LocalConnectorStatus.Clear); Equal(0, plan.Points.Count);
        });
        Run("finite domain excluding the real hole reports incomplete rather than physical no path", () =>
        {
            var kernel = Kernel(Opening()); var domain = new LocalConnectorDomain(P(-1, .75, -.5), P(1, 1.5, .5), .25);
            Incomplete(Plan(P(-.75, 1), P(.75, 1), Query(kernel), domain));
        });
        Run("sealed wall lattice exhaustion is not a certificate that no physical route exists", () =>
        {
            var kernel = Kernel(Box()); Incomplete(Plan(P(-.75, 1), P(.75, 1), Query(kernel)));
        });
        Run("narrow off-domain opening is not invented from an obstacle bounding box", () =>
        {
            var kernel = Kernel(Opening("narrow", .02, .02)); var domain = new LocalConnectorDomain(P(-1, .25, -.5), P(1, 1.5, .5), .25);
            Incomplete(Plan(P(-.75, 1), P(.75, 1), Query(kernel), domain));
        });
        Run("repeated local searches retain identical ordered points lengths and counters", () =>
        {
            var kernel = Kernel(Opening()); var from = P(-.75, 1); var to = P(.75, 1);
            var first = Plan(from, to, Query(kernel)); var last = Plan(from, to, Query(kernel)); ClearPlan(first, from, to, kernel); ClearPlan(last, from, to, kernel);
            Equal(JsonSerializer.Serialize(first), JsonSerializer.Serialize(last));
        });
        Run("successful connector points remain immutable after being returned", () =>
        {
            var kernel = Kernel(Opening()); var from = P(-.75, 1); var to = P(.75, 1); var plan = Plan(from, to, Query(kernel)); ClearPlan(plan, from, to, kernel);
            Need(plan.Points is IList<RoutePoint>); Reject<NotSupportedException>(() => ((IList<RoutePoint>)plan.Points)[0] = P(100));
            Need(Same(plan.Points[0], from)); ExactClear(plan.Points, kernel);
        });
    }

    private static void Integrated()
    {
        Run("B4 repairs a blocked approach while preserving exact tray geometry", () =>
        {
            var kernel = Kernel(Opening()); var from = P(-.75, 1); var to = P(.75, 1.5); var trays = new[] { Tray("A", P(.75, 1), to) };
            var straight = Calculator.CalculateConstrained(trays, from, to, CableCategory.Control, Query(kernel), Options()); Need(!straight.Route.Success);
            var value = Route(trays, from, to, Query(kernel)); ClearRoute(value, kernel); Need(value.LocalPhaseUsed && value.PlannerAttempts > 0);
            Need(value.FromConnector is not null); ClearPlan(value.FromConnector!, from, P(.75, 1), kernel); Need(value.FromConnector!.IsDetour);
            Need(value.RouteEvaluation.Route.SegmentIds.SequenceEqual(new[] { "A" }));
        });
        Run("both endpoint detours preserve bottom anchors and exact measured approach lengths", () =>
        {
            var kernel = Kernel(Opening("west"), Transform(Opening("east"), point => B(point.X + 2, point.Y, point.Z)));
            var from = P(-.75, 1); var to = P(2.75, 1); var trays = new[] { Tray("A", P(.75, 1), P(1.25, 1)) };
            var value = Route(trays, from, to, Query(kernel), Options(.5)); ClearRoute(value, kernel);
            Need(value.FromConnector is not null && value.ToConnector is not null);
            var first = value.FromConnector!; var last = value.ToConnector!; ClearPlan(first, from, P(.75, 1), kernel); ClearPlan(last, to, P(1.25, 1), kernel);
            Need(first.IsDetour && last.IsDetour); Need(value.PlannerAttempts >= 2);
            var route = value.RouteEvaluation.Route; Bits(first.LengthMeters, route.FromDistanceMeters); Bits(last.LengthMeters, route.ToDistanceMeters);
            Need(route.FromRequiresSecondary && route.ToRequiresSecondary); Need(Same(route.PathPoints[0], from) && Same(route.PathPoints[^1], to));
            Need(route.PathPoints.Any(point => Same(point, first.Points[1])) && route.PathPoints.Any(point => Same(point, last.Points[1])));
            Need(Math.Abs(route.LengthMeters - (.5 + first.LengthMeters + last.LengthMeters)) < 1e-12, "Detour lengths were lost or added twice.");
            Equal(0, route.ConnectionGapCount); Bits(0, route.ConnectionGapLengthMeters);
            decimal before = (decimal)route.LengthMeters; before -= (decimal)first.LengthMeters; before -= (decimal)last.LengthMeters; before = Math.Max(0m, before) + 2 * 7m + 5m;
            var design = CableDesignLength.Calculate(route, 5m, 7m, 10m); Equal(before, design.LengthBeforePercentageMeters);
            Equal(before * 1.1m, design.UnroundedLengthMeters); Equal(decimal.Ceiling(before * 1.1m), design.DesignLengthMeters);
        });
        Run("one shared planner-attempt ceiling covers both cable ends", () =>
        {
            var kernel = Kernel(Opening("west"), Transform(Opening("east"), point => B(point.X + 2, point.Y, point.Z)));
            var value = Route([Tray("A", P(.75, 1), P(1.25, 1))], P(-.75, 1), P(2.75, 1), Query(kernel), local: new() { MaxPlans = 1 });
            Need(!value.RouteEvaluation.Route.Success); Equal(ConstrainedRouteStatus.SearchIncomplete, value.RouteEvaluation.Status); Need(value.PlannerAttempts <= 1);
        });
        Run("local search has reserved room after the bounded straight phase", () =>
        {
            var kernel = Kernel(Opening()); var to = P(.75, 1.5);
            var value = Route([Tray("A", P(.75, 1), to)], P(-.75, 1), to, Query(kernel), limits: new() { MaxPairs = 2 }, local: new() { MaxStraightPairs = 1 });
            ClearRoute(value, kernel); Need(value.LocalPhaseUsed); Need(value.StraightPairAttempts <= 1 && value.RouteEvaluation.PairAttempts <= 2);
        });
        Run("local planning never detours an internal tray edge off its fitted geometry", () =>
        {
            var kernel = Kernel(Opening()); var from = P(-.75, 1); var to = P(.75, 1);
            var value = Route([Tray("A-crossing", from, to)], from, to, Query(kernel)); Need(!value.RouteEvaluation.Route.Success);
            Need(value.RouteEvaluation.Status is not (ConstrainedRouteStatus.Clear or ConstrainedRouteStatus.Bypassed));
        });
        Run("final route keeps detour waypoints instead of smoothing to the obstructed chord", () =>
        {
            var kernel = Kernel(Opening()); var from = P(-.75, 1); var to = P(.75, 1.5);
            var value = Route([Tray("A", P(.75, 1), to)], from, to, Query(kernel)); ClearRoute(value, kernel);
            Need(value.FromConnector is not null && value.FromConnector.Points.Count > 2);
            Equal(BarrierSegmentStatus.Blocked, kernel.CheckSegment(B(from), B(value.FromConnector!.Points[^1])).Status);
            Need(value.RouteEvaluation.Route.PathPoints.Count > 3); ExactClear(value.RouteEvaluation.Route.PathPoints, kernel);
        });
        Run("integrated local route and endpoint plans remain deterministic", () =>
        {
            var kernel = Kernel(Opening()); var from = P(-.75, 1); var to = P(.75, 1.5); var tray = Tray("A", P(.75, 1), to);
            var first = Route([tray], from, to, Query(kernel)); var last = Route([tray], from, to, Query(kernel)); ClearRoute(first, kernel); ClearRoute(last, kernel);
            ExactRoute(first.RouteEvaluation.Route, last.RouteEvaluation.Route); Equal(first.PlannerAttempts, last.PlannerAttempts);
            Equal(JsonSerializer.Serialize(first.FromConnector), JsonSerializer.Serialize(last.FromConnector));
        });
    }

    private static void LegacyAndSecondary()
    {
        Run("unobstructed first pair remains bitwise and decimal-identical without local work", () =>
        {
            var kernel = Kernel(Box("remote", x0: 100, x1: 101)); var from = P(2.123, .75); var to = P(8.987, -.3); var trays = new[] { Tray("A", P(0), P(10)) };
            var legacy = Calculator.Calculate(trays, from, to, CableCategory.Control, Options()); var value = Route(trays, from, to, Query(kernel)); ClearRoute(value, kernel);
            ExactRoute(legacy, value.RouteEvaluation.Route); Equal(0, value.PlannerAttempts); Need(!value.LocalPhaseUsed);
        });
        Run("clear B3 alternative stays preferred over a new local connector", () =>
        {
            var kernel = Kernel(Opening()); var from = P(-.2, 1); var to = P(-.2, 1.5);
            var trays = new[] { Tray("A-blocked", P(.3, 1), P(.3, 1.5)), Tray("B-clear", P(-1, 1), P(-1, 1.5)) };
            var b3 = Calculator.CalculateConstrained(trays, from, to, CableCategory.Control, Query(kernel), Options()); Need(b3.Route.Success);
            var value = Route(trays, from, to, Query(kernel)); ClearRoute(value, kernel); ExactRoute(b3.Route, value.RouteEvaluation.Route);
            Equal(0, value.PlannerAttempts); Need(!value.LocalPhaseUsed);
        });
        Run("explicit drilling bypass calls neither obstacle oracle nor local planner", () =>
        {
            var trays = new[] { Tray("A", P(-1), P(1)) }; var calls = 0;
            RouteCollisionObservation MustNotQuery(RoutePoint from, RoutePoint to, CancellationToken token) { calls++; throw new InvalidOperationException("Bypass queried an obstacle."); }
            var value = Route(trays, P(-1), P(1), MustNotQuery, drill: true); Equal(0, calls); Equal(0, value.PlannerAttempts); Need(!value.LocalPhaseUsed);
            Equal(ConstrainedRouteStatus.Bypassed, value.RouteEvaluation.Status); ExactRoute(Calculator.Calculate(trays, P(-1), P(1), CableCategory.Control, Options()), value.RouteEvaluation.Route);
        });
        Run("clear direct SECONDARY remains the original two-point 3D strategy", () =>
        {
            var kernel = Kernel(Box("remote", x0: 100, x1: 101)); var trays = new[] { Tray("A", P(0, 5), P(1, 5)) };
            var value = Secondary(trays, P(0), P(1), Query(kernel)); Equal("clear", value.SecondaryEvaluation.DirectDisposition);
            ExactRoute(DirectSecondaryRoute.Evaluate(trays, P(0), P(1), CableCategory.Control, Options()).DirectRoute, value.SecondaryEvaluation.RouteEvaluation.Route);
            Need(value.LocalApproaches is null || value.LocalApproaches.PlannerAttempts == 0);
        });
        Run("blocked direct chord falls back to trays and never becomes a direct SECONDARY detour", () =>
        {
            var kernel = Kernel(Opening()); var trays = new[] { Tray("A", P(-.75, 3), P(.75, 3)) };
            var value = Secondary(trays, P(-.75, 1), P(.75, 1), Query(kernel)); var secondary = value.SecondaryEvaluation;
            Need(secondary.DistanceQualified); Equal("blocked", secondary.DirectDisposition); Equal(ConstrainedRouteStatus.Clear, secondary.RouteEvaluation.Status);
            Need(secondary.RouteEvaluation.Route.SegmentIds.Contains("A")); Need(secondary.RouteEvaluation.Route.RouteText != "/SECONDARY");
            Bits(1.5, secondary.DistanceDecision.DistanceMeters); ExactClear(secondary.RouteEvaluation.Route.PathPoints, kernel);
        });
        Run("drilling preserves the direct decision with zero oracle and planner calls", () =>
        {
            var calls = 0; RouteCollisionObservation MustNotQuery(RoutePoint from, RoutePoint to, CancellationToken token) { calls++; throw new InvalidOperationException("Bypass queried an obstacle."); }
            var trays = new[] { Tray("A", P(-.75, 3), P(.75, 3)) }; var value = Secondary(trays, P(-.75, 1), P(.75, 1), MustNotQuery, drill: true);
            Equal(0, calls); Equal("bypassed", value.SecondaryEvaluation.DirectDisposition); Need(value.LocalApproaches is null || value.LocalApproaches.PlannerAttempts == 0);
            ExactRoute(DirectSecondaryRoute.Evaluate(trays, P(-.75, 1), P(.75, 1), CableCategory.Control, Options()).DirectRoute, value.SecondaryEvaluation.RouteEvaluation.Route);
        });
    }

    private static void BudgetsAndRefusals()
    {
        Run("documented local profile is explicit finite search guidance", () =>
        {
            var options = new LocalConnectorOptions(); Bits(.25, options.StepMeters); Bits(1, options.PaddingMeters); Bits(20, options.MaxAxisSpanMeters);
            Equal(4096, options.MaxNodes); Equal(16384, options.MaxEdgeChecks); Equal(8, options.MaxPlans); Equal(8, options.MaxStraightPairs);
        });
        Run("admitted lattice node ceiling refuses rather than silently enlarging its budget", () =>
        {
            var kernel = Kernel(Opening()); Incomplete(Plan(P(-.75, 1), P(.75, 1), Query(kernel), options: new() { MaxNodes = 8 }));
        });
        Run("local edge ceiling counts failed collision attempts", () =>
        {
            var kernel = Kernel(Opening()); var plan = Plan(P(-.75, 1), P(.75, 1), Query(kernel), options: new() { MaxEdgeChecks = 1 });
            Incomplete(plan); Need(plan.EdgeChecks <= 1);
        });
        Run("global collision queries cover straight and lattice phases together", () =>
        {
            var kernel = Kernel(Opening()); var plan = Plan(P(-.75, 1), P(.75, 1), Query(kernel), limits: new() { MaxCollisionQueries = 1 });
            Incomplete(plan); Need(plan.Queries <= 1);
        });
        Run("integrated straight work and local work consume the same query allowance", () =>
        {
            var kernel = Kernel(Opening()); var calls = 0; var query = Query(kernel, (a, b) => calls++); var to = P(.75, 1.5);
            var value = Route([Tray("A", P(.75, 1), to)], P(-.75, 1), to, query, limits: new() { MaxCollisionQueries = 10 });
            Need(!value.RouteEvaluation.Route.Success); Equal(ConstrainedRouteStatus.SearchIncomplete, value.RouteEvaluation.Status);
            Need(value.LocalPhaseUsed && value.PlannerAttempts > 0); Need(calls <= 10); Equal(calls, value.RouteEvaluation.CollisionQueries);
        });
        Run("smaller-step lattice preflight refuses excessive node counts before allocation", () =>
        {
            var kernel = Kernel(Opening()); var domain = new LocalConnectorDomain(P(-1, 0, -.5), P(1, 2, .5), 1e-9);
            Incomplete(Plan(P(-.75, 1), P(.75, 1), Query(kernel), domain, new() { StepMeters = 1e-9 }));
        });
        Run("tiny-step lattice near one billion metres refuses before any huge search allocation", () =>
        {
            const double shift = 1_000_000_000 - 10;
            var kernel = Kernel(Transform(Opening("near-coordinate-bound"), point => B(point.X + shift, point.Y + shift, point.Z + shift)));
            var from = P(shift - .75, shift + 1, shift); var to = P(shift + .75, shift + 1, shift);
            var domain = new LocalConnectorDomain(P(shift - 1, shift, shift - .5), P(shift + 1, shift + 2, shift + .5), 1e-9);
            Equal(BarrierSegmentStatus.Clear, kernel.CheckSegment(B(from), B(from)).Status);
            Equal(BarrierSegmentStatus.Clear, kernel.CheckSegment(B(to), B(to)).Status);
            Equal(BarrierSegmentStatus.Blocked, kernel.CheckSegment(B(from), B(to)).Status);
            var before = GC.GetAllocatedBytesForCurrentThread(); var plan = Plan(from, to, Query(kernel), domain, new() { StepMeters = 1e-9 });
            numericPreflightAllocatedBytes = GC.GetAllocatedBytesForCurrentThread() - before;
            Incomplete(plan); Equal(0, plan.Points.Count); Need(!plan.IsDetour); Need(plan.Queries <= 4);
            Need(numericPreflightAllocatedBytes is >= 0 and < 4 * 1024 * 1024,
                "A rejected oversized lattice allocated at least four MiB on the synchronous planning thread.");
        });
        Run("explicit domain cannot silently coarsen a tighter supplied search step", () =>
        {
            var kernel = Kernel(Opening()); var plan = Plan(P(-.75, 1), P(.75, 1), Query(kernel), Domain(), new() { StepMeters = .125 });
            Incomplete(plan); Equal(0, plan.Queries);
        });
        Run("local caller options are snapshotted instead of changed by phase reservation", () =>
        {
            var kernel = Kernel(Opening()); var options = new LocalConnectorOptions(); var to = P(.75, 1.5);
            var value = Route([Tray("A", P(.75, 1), to)], P(-.75, 1), to, Query(kernel), local: options); ClearRoute(value, kernel);
            Equal(8, options.MaxStraightPairs); Equal(8, options.MaxPlans); Equal(16384, options.MaxEdgeChecks); Bits(.25, options.StepMeters); Bits(1, options.PaddingMeters);
        });
        Run("global performed-work budget cannot reset inside a local search", () =>
        {
            var calls = 0; var plan = Plan(P(-.75, 1), P(.75, 1), (from, to, token) => { calls++; return new(RouteCollisionStatus.Blocked, "shell:test", "Synthetic counted work.", 20); }, limits: new() { MaxWork = 10 });
            Incomplete(plan); Equal(1, calls); Need(plan.Work >= 20);
        });
        Run("uncertain oracle cannot turn unsearched space into a clear connector", () =>
        {
            var plan = Plan(P(-.75, 1), P(.75, 1), (from, to, token) => new(RouteCollisionStatus.Indeterminate, null, "Synthetic unavailable geometry.", 1));
            Need(plan.Status is not LocalConnectorStatus.Clear); Need(!string.IsNullOrWhiteSpace(plan.Reason));
        });
        Run("caller cancellation before planning throws without any oracle work", () =>
        {
            using var cancellation = new CancellationTokenSource(); cancellation.Cancel(); var calls = 0;
            Reject<OperationCanceledException>(() => Plan(P(-.75, 1), P(.75, 1), (from, to, token) => { calls++; return new(RouteCollisionStatus.Clear, null, "Unused.", 0); }, token: cancellation.Token)); Equal(0, calls);
        });
        Run("caller cancellation inside an actual kernel query aborts local planning", () =>
        {
            using var cancellation = new CancellationTokenSource(); var real = Query(Kernel(Opening())); var calls = 0;
            Reject<OperationCanceledException>(() => Plan(P(-.75, 1), P(.75, 1), (from, to, token) =>
            { calls++; var result = real(from, to, token); cancellation.Cancel(); return result; }, token: cancellation.Token)); Equal(1, calls);
        });
        Run("one absolute deadline includes a late local collision callback", () =>
        {
            var calls = 0; var plan = Plan(P(-.75, 1), P(.75, 1), (from, to, token) => { calls++; Thread.Sleep(25); return new(RouteCollisionStatus.Clear, null, "Late synthetic oracle.", 37); }, limits: new() { TimeoutMilliseconds = 10 });
            Incomplete(plan); if (calls > 0) Need(plan.Work >= 37);
        });
        Run("new local routing entry still excludes MV", () =>
        {
            Reject<ArgumentException>(() => Calculator.CalculateConstrainedWithLocalApproaches([Tray("A", P(0), P(1))], P(0), P(1), CableCategory.MV, Query(Kernel(Opening()))));
        });
    }
}
