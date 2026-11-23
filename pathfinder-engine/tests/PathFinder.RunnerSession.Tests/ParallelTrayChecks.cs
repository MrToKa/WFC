using AddinRibbon.Routing;

namespace PathFinder.RunnerSession.Tests;

internal static partial class TestProgram
{
    private static void ParallelTrayChecks()
    {
        RoutePoint Point(double x, double y = 0, double z = 0) => new(x, y, z);
        TraySegment Rail(string name, params RoutePoint[] points) => new(name, name, CableCategory.LV, points);
        var high = Rail("/RAIL-EAST", Point(0), Point(40));
        var low = Rail("/SPARE", Point(40, 0, .4), Point(0, 0, .4));
        ParallelTrayOccupancy Reading(TraySegment segment, double occupied) => new() { RouteCode = segment.RouteCode, OccupiedPercent = occupied };
        var request = new Request { SchemaVersion = "pathfinder.model.runner.v1", RequestId = "test", ProjectId = "test",
            ModelVersionId = "test", TimeoutMilliseconds = 60000, Category = "LV", Operation = "calculate",
            ParallelPowerTrayOccupancies = [Reading(high, 120), Reading(low, 15)] };
        RouteResult Run(Request input, TraySegment[] rails, double end = 40)
        {
            RouteResult Calculate(Request trial, CancellationToken cancellation) => new RouteCalculator().Calculate(
                CapacityRouting.Filter(PurposeRouting.Filter(rails, trial.AllowedPurposeRouteCodes, default), trial.ExcludedRouteCodes),
                Point(0), Point(end), CableCategory.LV, cancellationToken: cancellation);
            return ParallelTrayRouting.Select(input, rails, Calculate, r => r.Success ? r : null, default);
        }

        var chosen = Run(request, [high, low]);
        Check("A nearby reversed parallel section wins by known occupied area with measured equipment approaches",
            chosen.Success && chosen.RouteCodes.Contains(low.RouteCode) && Math.Abs(chosen.LengthMeters - 40.8) < 1e-8);
        var middle = Rail("/CLOSEST-SPARE", Point(0, 0, .2), Point(40, 0, .2));
        var three = request with { ParallelPowerTrayOccupancies = [Reading(high, 90), Reading(middle, 80), Reading(low, 10)] };
        Check("A closer moderately loaded peer does not conceal a better third rail",
            Run(three, [high, middle, low]).RouteCodes.Contains(low.RouteCode));
        Check("An unknown-capacity closer peer cannot hide a known lower-occupancy rail",
            Run(request, [high, middle, low]).RouteCodes.Contains(low.RouteCode));
        var original = Run(request with { ParallelPowerTrayOccupancies = null }, [high, low]);
        Check("Default request retains its nearest rail", original.RouteCodes.Contains(high.RouteCode));

        int calls = 0;
        RouteResult WaitForOptionalDeadline(Request trial, CancellationToken cancellation)
        {
            if (++calls == 1) return original;
            cancellation.WaitHandle.WaitOne();
            cancellation.ThrowIfCancellationRequested();
            throw new InvalidOperationException("The optional run should be interrupted.");
        }
        var fallback = ParallelTrayRouting.Select(request with { TimeoutMilliseconds = 800 }, [high, low],
            WaitForOptionalDeadline, route => route, default);
        Check("A slow optional comparison preserves the complete initial result", calls == 2 && ReferenceEquals(fallback, original));

        using var caller = new CancellationTokenSource();
        RouteResult CancelRequest(Request trial, CancellationToken cancellation)
        {
            if (trial.ExcludedRouteCodes is null) return original;
            caller.Cancel();
            cancellation.ThrowIfCancellationRequested();
            throw new InvalidOperationException("Caller cancellation should reach the trial.");
        }
        bool cancelled = false;
        try { ParallelTrayRouting.Select(request, [high, low], CancelRequest, route => route, caller.Token); }
        catch (OperationCanceledException) { cancelled = caller.IsCancellationRequested; }
        Check("Caller cancellation is never converted into a successful baseline", cancelled);
        var equal = Run(request with { ParallelPowerTrayOccupancies = [Reading(high, 15), Reading(low, 15)] }, [high, low]);
        Check("Equal occupancies retain the ordinary proposal", equal.RouteCodes.Contains(high.RouteCode));
        Check("Missing occupancy avoids a guessed alternative", Run(request with { ParallelPowerTrayOccupancies = [Reading(high, 90)] }, [high, low]).RouteCodes.Contains(high.RouteCode));
        Check("A purpose-forbidden rail is never considered", Run(request with { AllowedPurposeRouteCodes = [high.RouteCode] }, [high, low]).RouteCodes.Contains(high.RouteCode));
        Check("Existing exclusions survive alternate planning", Run(request with { ExcludedRouteCodes = [low.RouteCode] }, [high, low]).RouteCodes.Contains(high.RouteCode));
        var shortHigh = Rail(high.RouteCode, Point(0), Point(8));
        var shortLow = Rail(low.RouteCode, Point(0, 0, .4), Point(8, 0, .4));
        Check("A detour below two metres but above five percent keeps the original", Run(request, [shortHigh, shortLow], 8).RouteCodes.Contains(high.RouteCode));
        var detour = Rail(low.RouteCode, Point(0, 0, .4), Point(15, 0, .4), Point(25, 5, .4), Point(35, 0, .4), Point(100, 0, .4));
        var longHigh = Rail(high.RouteCode, Point(0), Point(100));
        Check("A detour below five percent but above two metres keeps the original", Run(request, [longHigh, detour], 100).RouteCodes.Contains(high.RouteCode));
        var sampled = Rail(low.RouteCode, Enumerable.Range(0, 161).Select(i => Point(i / 4.0, 0, .4)).ToArray());
        Check("Dense fitted line samples represent the same parallel rail", Run(request, [high, sampled]).RouteCodes.Contains(low.RouteCode));
        Check("A crossing and an adjacent end-to-end rail do not establish parallel overlap",
            !ParallelTrayRouting.Parallel(Point(0), Point(40), Point(8, -5), Point(8, 5)) &&
            !ParallelTrayRouting.Parallel(Point(0), Point(40), Point(40, .4), Point(80, .4)));
        Check("The parallel span must remain within one metre in world space",
            !ParallelTrayRouting.Parallel(Point(0), Point(40), Point(0, 0, 2), Point(40, 0, 2)));
    }
}
