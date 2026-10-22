using System.Collections;
using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Barriers;
using static Fixtures;

internal static class Program
{
    private static readonly List<object> Checks = [];
    private static int failures;
    private static readonly RouteCalculator Calculator = new();
    private const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    private const BindingFlags Static = BindingFlags.Static | BindingFlags.NonPublic;
    private static readonly Assembly Core = typeof(RouteCalculator).Assembly;
    private static readonly Type BudgetType = Core.GetType("AddinRibbon.Routing.ConstrainedBudget", true)!;
    private static readonly Type OpeningType = Core.GetType("AddinRibbon.Routing.InterTrayOpeningContext", true)!;

    private static int Main(string[] args)
    {
        if (args.Length != 0) return 2;
        PublicGeometry(); ExactDomain(); BoundsAndFailures(); SelectedGraph();
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = "wfc.pf.inter-tray-maneuver-checks.v1", status = failures == 0 ? "PASS" : "FAIL",
            passed = Checks.Count - failures, failed = failures, policyVersion = InterTrayOpeningManeuverPolicy.Version,
            scope = "Synthetic original closed meshes and bounded Core graph/oracle regressions only; no Aalborg, SDK, runtime publication or business writes",
            engineeringAccepted = false, checks = Checks
        }));
        return failures == 0 ? 0 : 1;
    }
    private static void Run(string name, Action body)
    {
        try { body(); Checks.Add(new { name, status = "PASS", detail = "" }); }
        catch (Exception error) { failures++; Checks.Add(new { name, status = "FAIL", detail = error.GetType().Name + ": " + error.Message }); }
    }
    private static void Need(bool value, string message = "Synthetic assertion failed.")
    { if (!value) throw new InvalidOperationException(message); }
    private static void Equal<T>(T expected, T actual) => Need(EqualityComparer<T>.Default.Equals(expected, actual), $"Expected {expected}; actual {actual}.");
    private static bool Same(RoutePoint a, RoutePoint b) => BitConverter.DoubleToInt64Bits(a.X) == BitConverter.DoubleToInt64Bits(b.X)
        && BitConverter.DoubleToInt64Bits(a.Y) == BitConverter.DoubleToInt64Bits(b.Y) && BitConverter.DoubleToInt64Bits(a.Z) == BitConverter.DoubleToInt64Bits(b.Z);
    private static RoutingOptions Options() => new() { ConnectionToleranceMeters = .5, SampleSpacingMeters = .125, SecondaryDistanceMeters = 2, PreferVerticalApproach = false };
    private static LocalConnectorOptions Local() => new() { MaxStraightPairs = 1, MaxPlans = 1, MaxNodes = 2 };
    private static TraySegment Port(string id, params RoutePoint[] points) => new(id, "/" + id, CableCategory.Control, points, true);
    private static TraySegment[] Network() => [Port("A", P(-1, 0, -.815), P(-.1, 0, -.815)), Port("B", P(.3, 0, -.775), P(1, 0, -.775))];
    private static RouteCollisionObservation Observation(RouteCollisionStatus status, long work = 1) => new(status, status == RouteCollisionStatus.Blocked ? "synthetic" : null, "SYNTHETIC", work);
    private static RouteCollisionQuery Query(BarrierCollisionKernel kernel, Action<RoutePoint, RoutePoint>? observe = null) => (a, b, token) =>
    {
        observe?.Invoke(a, b); var result = kernel.CheckSegment(B(a), B(b), token);
        return new(result.Status switch { BarrierSegmentStatus.Clear => RouteCollisionStatus.Clear, BarrierSegmentStatus.Blocked => RouteCollisionStatus.Blocked,
            _ => RouteCollisionStatus.Indeterminate }, result.BarrierId, result.Reason, result.Work);
    };
    private static LocalApproachRouteEvaluation Route(TraySegment[] trays, RoutePoint from, RoutePoint to, RouteCollisionQuery query,
        bool enabled = true, bool drill = false, ConstrainedRoutingLimits? limits = null, CancellationToken token = default) => enabled
        ? Calculator.CalculateConstrainedWithLocalApproachesAndInterTrayManeuvers(trays, from, to, CableCategory.Control, query, Options(), limits, Local(), drill, token)
        : Calculator.CalculateConstrainedWithLocalApproaches(trays, from, to, CableCategory.Control, query, Options(), limits, Local(), drill, token);
    private static void ExactRoute(RouteResult expected, RouteResult actual)
    {
        Equal(expected.Success, actual.Success); Equal(expected.Message, actual.Message); Equal(expected.RouteText, actual.RouteText);
        Need(expected.SegmentIds.SequenceEqual(actual.SegmentIds)); Equal(expected.PathPoints.Count, actual.PathPoints.Count);
        for (int i = 0; i < expected.PathPoints.Count; i++) Need(Same(expected.PathPoints[i], actual.PathPoints[i]));
        Equal(BitConverter.DoubleToInt64Bits(expected.LengthMeters), BitConverter.DoubleToInt64Bits(actual.LengthMeters));
        Equal(BitConverter.DoubleToInt64Bits(expected.FromDistanceMeters), BitConverter.DoubleToInt64Bits(actual.FromDistanceMeters));
        Equal(BitConverter.DoubleToInt64Bits(expected.ToDistanceMeters), BitConverter.DoubleToInt64Bits(actual.ToDistanceMeters));
        Equal(expected.ConnectionGapCount, actual.ConnectionGapCount);
        Equal(BitConverter.DoubleToInt64Bits(expected.ConnectionGapLengthMeters), BitConverter.DoubleToInt64Bits(actual.ConnectionGapLengthMeters));
    }
    private static void Clear(ConstrainedRouteEvaluation result, BarrierCollisionKernel kernel)
    {
        Equal(ConstrainedRouteStatus.Clear, result.Status); Need(result.Route.Success); Need(result.SearchComplete);
        Equal(result.Route.PathPoints.Count - 1, result.FinalChecks.Count);
        for (int i = 1; i < result.Route.PathPoints.Count; i++)
        {
            var a = result.Route.PathPoints[i - 1]; var b = result.Route.PathPoints[i];
            Equal(BarrierSegmentStatus.Clear, kernel.CheckSegment(B(a), B(b)).Status);
            Need(Same(a, result.FinalChecks[i - 1].From) && Same(b, result.FinalChecks[i - 1].To));
            Need(result.FinalChecks[i - 1].Observation.Reason != "SEARCH_SEGMENT_REUSED");
        }
    }

    private static void PublicGeometry()
    {
        Run("blocked cross-tray chord clips the original opening sill and finite maneuver clears all actual legs", () =>
        {
            var kernel = Kernel(Opening()); var trays = Network(); var query = Query(kernel);
            Equal(BarrierSegmentStatus.Blocked, kernel.CheckSegment(B(trays[0].Points[1]), B(trays[1].Points[0])).Status);
            var result = Route(trays, trays[0].Points[0], trays[1].Points[1], query).RouteEvaluation;
            Clear(result, kernel); Need(result.Reason.EndsWith("_INTER_TRAY_OPENING_MANEUVER_V1", StringComparison.Ordinal));
            Need(result.Route.PathPoints.Count >= 6); Need(result.Route.RouteText.Contains("/A/B", StringComparison.Ordinal));
            var legacy = Calculator.Calculate(trays, trays[0].Points[0], trays[1].Points[1], CableCategory.Control, Options());
            Need(legacy.Success); Need(result.Route.LengthMeters > legacy.LengthMeters);
            Equal(legacy.ConnectionGapCount, result.Route.ConnectionGapCount);
            Equal(BitConverter.DoubleToInt64Bits(legacy.ConnectionGapLengthMeters), BitConverter.DoubleToInt64Bits(result.Route.ConnectionGapLengthMeters));
        });
        Run("reverse traversal reconstructs checked maneuver points in its actual ordered final polyline", () =>
        {
            var kernel = Kernel(Opening()); var trays = Network();
            var result = Route(trays, trays[1].Points[1], trays[0].Points[0], Query(kernel)).RouteEvaluation;
            Clear(result, kernel); Need(result.Reason.EndsWith("_INTER_TRAY_OPENING_MANEUVER_V1", StringComparison.Ordinal));
            Need(Same(trays[1].Points[1], result.Route.PathPoints[0])); Need(Same(trays[0].Points[0], result.Route.PathPoints[^1]));
        });
        Run("solid wall cannot be converted into an opening by the maneuver envelope", () =>
        {
            var kernel = Kernel(Box(x0: 0, x1: .2)); var trays = Network();
            var result = Route(trays, trays[0].Points[0], trays[1].Points[1], Query(kernel)).RouteEvaluation;
            Need(!result.Route.Success); Need(!result.SearchComplete); Equal(0, result.FinalChecks.Count);
        });
        Run("a second original barrier can block every otherwise open translated connector", () =>
        {
            var kernel = Kernel(Opening(), Box("before-opening", x0: -.09, x1: -.08)); var trays = Network();
            var result = Route(trays, trays[0].Points[0], trays[1].Points[1], Query(kernel)).RouteEvaluation;
            Need(!result.Route.Success); Need(!result.SearchComplete); Equal(0, result.FinalChecks.Count);
        });
        Run("new opt-in preserves the complete legacy clear graph route byte for byte", () =>
        {
            var kernel = Kernel(Box("far", x0: 100, x1: 101)); var trays = Network(); var q = Query(kernel);
            var old = Route(trays, trays[0].Points[0], trays[1].Points[1], q, enabled: false).RouteEvaluation;
            var current = Route(trays, trays[0].Points[0], trays[1].Points[1], q).RouteEvaluation;
            ExactRoute(old.Route, current.Route); Equal(old.Reason, current.Reason); Equal(old.CollisionQueries, current.CollisionQueries); Equal(old.Work, current.Work);
        });
        Run("drilling opt-in bypass remains byte-identical and never invokes the oracle", () =>
        {
            var trays = Network(); RouteCollisionObservation Fail(RoutePoint a, RoutePoint b, CancellationToken token) => throw new InvalidOperationException("Drill invoked oracle.");
            var old = Route(trays, trays[0].Points[0], trays[1].Points[1], Fail, enabled: false, drill: true).RouteEvaluation;
            var current = Route(trays, trays[0].Points[0], trays[1].Points[1], Fail, drill: true).RouteEvaluation;
            Equal(ConstrainedRouteStatus.Bypassed, current.Status); ExactRoute(old.Route, current.Route); Equal(old.Reason, current.Reason); Equal(0, current.CollisionQueries);
        });
        Run("within-tray obstruction is never bent by the inter-tray strategy", () =>
        {
            var kernel = Kernel(Box(x0: 0, x1: .2)); var trays = new[] { Tray("one", P(-1), P(1)) };
            var result = Route(trays, P(-1), P(1), Query(kernel)).RouteEvaluation;
            Need(!result.Route.Success); Need(!result.Reason.Contains("INTER_TRAY_OPENING_MANEUVER_V1", StringComparison.Ordinal));
        });
        Run("standalone secondary wrapper keeps direct clear strategy before any maneuver graph", () =>
        {
            RouteCollisionObservation ClearQuery(RoutePoint a, RoutePoint b, CancellationToken token) => Observation(RouteCollisionStatus.Clear);
            var trays = Network(); var old = ConstrainedSecondaryRoute.CalculateWithLocalApproaches(trays, P(-1, 3), P(1, 3), CableCategory.Control, ClearQuery, Options());
            var current = ConstrainedSecondaryRoute.CalculateWithLocalApproachesAndInterTrayManeuvers(trays, P(-1, 3), P(1, 3), CableCategory.Control, ClearQuery, Options());
            ExactRoute(old.LocalApproaches.RouteEvaluation.Route, current.LocalApproaches.RouteEvaluation.Route);
        });
    }

    private sealed class Probe : IDisposable
    {
        internal readonly object Budget;
        internal readonly object Context;
        internal Probe(ConstrainedRoutingLimits? limits = null, CancellationToken token = default)
        {
            Budget = Activator.CreateInstance(BudgetType, Private, null, [limits ?? new(), token, true], null)!;
            Context = BudgetType.GetField("InterTray", Private)!.GetValue(Budget)!;
        }
        internal object? Find(RouteCollisionQuery query, RoutePoint a, RoutePoint b) => Invoke(OpeningType.GetMethod("Find", Private)!, Context, [query, a, b]);
        internal int Attempts => (int)OpeningType.GetProperty("Attempts", Private)!.GetValue(Context)!;
        internal int Queries => (int)BudgetType.GetProperty("Queries", Private)!.GetValue(Budget)!;
        internal long Work => (long)BudgetType.GetProperty("Work", Private)!.GetValue(Budget)!;
        internal void CancelDeadline() => ((CancellationTokenSource)BudgetType.GetField("linked", Private)!.GetValue(Budget)!).Cancel();
        public void Dispose() => ((IDisposable)Budget).Dispose();
    }
    private static object? Invoke(MethodInfo method, object? target, object?[] args)
    {
        try { return method.Invoke(target, args); }
        catch (TargetInvocationException error) when (error.InnerException is not null) { ExceptionDispatchInfo.Capture(error.InnerException).Throw(); throw; }
    }
    private static void Refusal(string reason, Action body)
    {
        try { body(); }
        catch (Exception error) when (error.GetType().Name == "ConstrainedLimitException") { Equal(reason, error.Message); return; }
        throw new InvalidOperationException("Expected constrained refusal " + reason);
    }
    private static void ExactDomain()
    {
        Run("fixed policy has exactly two radii and52 ordered candidates", () =>
        {
            Equal(52, InterTrayOpeningManeuverPolicy.CandidateCount); Equal(64, InterTrayOpeningManeuverPolicy.MaximumEdgeAttempts);
            Equal(.05, InterTrayOpeningManeuverPolicy.FirstRadiusMetres); Equal(.1, InterTrayOpeningManeuverPolicy.SecondRadiusMetres);
            using var probe = new Probe(); var calls = new List<(RoutePoint A, RoutePoint B)>();
            RouteCollisionObservation Query(RoutePoint a, RoutePoint b, CancellationToken token) { calls.Add((a, b)); return Observation(RouteCollisionStatus.Clear); }
            Need(probe.Find(Query, P(0), P(1)) is not null); Equal(3, calls.Count);
            var scale = .05 / Math.Sqrt(3); Need(Same(P(-scale, -scale, -scale), calls[0].B));
            Need(Same(calls[0].B, calls[1].A) && Same(calls[1].B, calls[2].A));
        });
        Run("realized rational10cm sphere rejects rounded-up nominal axis offsets", () =>
        {
            var method = OpeningType.GetMethod("WithinOffset", Static)!;
            bool Within(RoutePoint a, RoutePoint b) => (bool)Invoke(method, null, [a, b])!;
            Need(Within(P(0), P(Math.BitDecrement(.1)))); Need(!Within(P(0), P(.1))); Need(!Within(P(0), P(Math.BitIncrement(.1))));
            Need(Within(P(double.MaxValue), P(double.MaxValue))); Need(!Within(P(double.MaxValue), P(-double.MaxValue)));
        });
        Run("oriented cache never aliases reverse or signed-zero endpoint bits", () =>
        {
            using var probe = new Probe(); var calls = 0;
            RouteCollisionObservation Query(RoutePoint a, RoutePoint b, CancellationToken token) { calls++; return Observation(RouteCollisionStatus.Clear); }
            var query = (RouteCollisionQuery)Query; var negativeZero = BitConverter.Int64BitsToDouble(long.MinValue);
            Need(probe.Find(query, P(0), P(1)) is not null); var first = calls;
            Need(probe.Find(query, P(0), P(1)) is not null); Equal(first, calls);
            Need(probe.Find(query, P(1), P(0)) is not null); Need(calls > first); var second = calls;
            Need(probe.Find(query, P(negativeZero), P(1)) is not null); Equal(3, probe.Attempts);
            // The search-segment memo may independently reuse identical realized
            // legs; the distinct oriented maneuver admission is what is asserted.
            Need(calls >= second);
        });
        Run("different oracle reference cannot reuse a retained maneuver", () =>
        {
            using var probe = new Probe(); RouteCollisionQuery a = (_, _, _) => Observation(RouteCollisionStatus.Clear);
            RouteCollisionQuery b = (_, _, _) => Observation(RouteCollisionStatus.Clear);
            Need(probe.Find(a, P(0), P(1)) is not null);
            Refusal("INTER_TRAY_ORACLE_CONTEXT_CHANGED", () => probe.Find(b, P(0), P(1)));
        });
        Run("separate calculations never share successful maneuver state", () =>
        {
            var calls = 0; RouteCollisionQuery query = (_, _, _) => { calls++; return Observation(RouteCollisionStatus.Clear); };
            using (var a = new Probe()) Need(a.Find(query, P(0), P(1)) is not null);
            Equal(3, calls); using (var b = new Probe()) Need(b.Find(query, P(0), P(1)) is not null); Equal(6, calls);
        });
    }

    private static void BoundsAndFailures()
    {
        Run("blocked finite domain is bounded and cached without claiming a physical impossibility", () =>
        {
            using var probe = new Probe(); var calls = 0;
            RouteCollisionQuery query = (_, _, _) => { calls++; return Observation(RouteCollisionStatus.Blocked); };
            Need(probe.Find(query, P(0), P(1)) is null); Need(calls > 0 && calls <= 52); var first = calls;
            Need(probe.Find(query, P(0), P(1)) is null); Equal(first, calls); Equal(1, probe.Attempts);
        });
        Run("indeterminate and oracle exceptions are not retained as a conclusive maneuver failure", () =>
        {
            using var probe = new Probe(); RouteCollisionQuery query = (_, _, _) => throw new InvalidOperationException("Synthetic failure");
            Need(probe.Find(query, P(0), P(1)) is null); Need(probe.Find(query, P(0), P(1)) is null); Equal(2, probe.Attempts);
        });
        Run("64 distinct edge attempts is a refusal ceiling across the entire calculation", () =>
        {
            using var probe = new Probe(); RouteCollisionQuery query = (_, _, _) => Observation(RouteCollisionStatus.Blocked, 0);
            for (int i = 0; i < 64; i++) Need(probe.Find(query, P(i * 3), P(i * 3 + 1)) is null);
            Equal(64, probe.Attempts); Refusal("INTER_TRAY_MANEUVER_ATTEMPT_LIMIT", () => probe.Find(query, P(1000), P(1001)));
        });
        Run("physical query ceiling is unchanged for maneuver legs", () =>
        {
            using var probe = new Probe(new() { MaxCollisionQueries = 1 }); RouteCollisionQuery query = (_, _, _) => Observation(RouteCollisionStatus.Clear);
            Refusal("COLLISION_QUERY_LIMIT", () => probe.Find(query, P(0), P(1))); Equal(1, probe.Queries);
        });
        Run("candidate dyadic and lookup work remain within original charged work ceiling", () =>
        {
            using var probe = new Probe(new() { MaxWork = 63 }); RouteCollisionQuery query = (_, _, _) => Observation(RouteCollisionStatus.Clear);
            Refusal("SEARCH_WORK_LIMIT", () => probe.Find(query, P(0), P(1))); Equal(0, probe.Queries);
        });
        Run("cache hit still observes original user cancellation", () =>
        {
            using var cancellation = new CancellationTokenSource(); using var probe = new Probe(token: cancellation.Token);
            RouteCollisionQuery query = (_, _, _) => Observation(RouteCollisionStatus.Clear); Need(probe.Find(query, P(0), P(1)) is not null);
            cancellation.Cancel(); try { probe.Find(query, P(0), P(1)); } catch (OperationCanceledException) { return; }
            throw new InvalidOperationException("Canceled cache lookup was admitted.");
        });
        Run("cache hit still observes original monotonic linked deadline", () =>
        {
            using var probe = new Probe(); RouteCollisionQuery query = (_, _, _) => Observation(RouteCollisionStatus.Clear);
            Need(probe.Find(query, P(0), P(1)) is not null); probe.CancelDeadline();
            Refusal("SEARCH_DEADLINE_EXCEEDED", () => probe.Find(query, P(0), P(1)));
        });
        Run("late final collision verdict cannot be hidden by maneuver/search reuse", () =>
        {
            var kernel = Kernel(Opening()); var real = Program.Query(kernel); var seen = new HashSet<string>();
            RouteCollisionObservation Query(RoutePoint a, RoutePoint b, CancellationToken token)
            {
                string Key(RoutePoint p) => string.Join(",", BitConverter.DoubleToInt64Bits(p.X), BitConverter.DoubleToInt64Bits(p.Y), BitConverter.DoubleToInt64Bits(p.Z));
                var key = Key(a) + "/" + Key(b); var answer = real(a, b, token);
                // Only repeated nonzero actual observations change; search cache
                // does not call here, whereas every returned final leg must.
                if (!Same(a, b) && !seen.Add(key) && answer.Status == RouteCollisionStatus.Clear) return Observation(RouteCollisionStatus.Blocked);
                return answer;
            }
            var trays = Network(); var result = Route(trays, trays[0].Points[0], trays[1].Points[1], Query).RouteEvaluation;
            Need(!result.Route.Success); Equal(0, result.FinalChecks.Count);
        });
    }

    private static void SelectedGraph()
    {
        Run("lazy selected edge cost increase reruns Dijkstra and preserves measured gap semantics", () =>
        {
            using var probe = new Probe(); var nodeType = typeof(RouteCalculator).GetNestedType("Node", BindingFlags.NonPublic)!;
            var edgeType = typeof(RouteCalculator).GetNestedType("Edge", BindingFlags.NonPublic)!;
            var blockedType = typeof(RouteCalculator).GetNestedType("BlockedInterTrayEdge", BindingFlags.NonPublic)!;
            var nodesType = typeof(List<>).MakeGenericType(nodeType); var nodes = (IList)Activator.CreateInstance(nodesType)!;
            var positions = new[] { P(-.2), P(.2), P(0, .04) };
            for (int i = 0; i < positions.Length; i++) nodes.Add(Activator.CreateInstance(nodeType, Private, null, [positions[i], i, 0d], null));
            object Edge(int destination, double length, int gap = 0, double measuredGap = 0) => Activator.CreateInstance(edgeType, Private, null, [destination, length, gap, measuredGap], null)!;
            IList Edges(int index) => (IList)nodeType.GetField("Edges", Private)!.GetValue(nodes[index])!;
            var side = positions[0].DistanceTo(positions[2]); Edges(0).Add(Edge(2, side)); Edges(2).Add(Edge(1, side));
            var lists = typeof(List<>).MakeGenericType(blockedType); var dictionaryType = typeof(Dictionary<,>).MakeGenericType(typeof(int), lists);
            var blocked = (IDictionary)Activator.CreateInstance(dictionaryType)!; var list = (IList)Activator.CreateInstance(lists)!;
            list.Add(Activator.CreateInstance(blockedType, Private, null, [Edge(1, .4), 0], null)); blocked.Add(0, list);
            RouteCollisionQuery query = (_, _, _) => Observation(RouteCollisionStatus.Clear, 0);
            object?[] args = [nodes, 0, 1, blocked, query, probe.Budget, 3L, null, null];
            var path = (IList)Invoke(typeof(RouteCalculator).GetMethod("OpeningFallback", Static)!, null, args)!;
            Equal(3, path.Count); Equal(0, (int)path[0]!); Equal(2, (int)path[1]!); Equal(1, (int)path[2]!);
            var cost = args[7]!; var costType = cost.GetType(); Equal(2 * side, (double)costType.GetField("PhysicalLength", Private)!.GetValue(cost)!);
            Equal(0, (int)costType.GetField("GapCount", Private)!.GetValue(cost)!);
            Equal(0d, (double)costType.GetField("GapLength", Private)!.GetValue(cost)!);
            // The repaired direct chord remains in the graph with its actual
            // increased length but is not allowed to retain stale shortest cost.
            var changed = Edges(0)[0]!; Need((double)edgeType.GetField("Length", Private)!.GetValue(changed)! > .4);
        });
    }
}
