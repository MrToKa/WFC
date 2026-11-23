using System.Diagnostics;
using AddinRibbon.Routing;

internal sealed record ParallelTrayOccupancy
{
    public required string RouteCode { get; init; }
    public required double OccupiedPercent { get; init; }
}

/// <summary>Compare complete native calculations for nearby parallel fitted tray sections.
/// An alternate owns its own geometry, barrier proof and equipment approaches.</summary>
internal static class ParallelTrayRouting
{
    private const int MaximumTrials = 3;
    private const int MaximumPieceComparisons = 200000;
    private const double MaximumSpacingMeters = 1.0;
    private const double MinimumOverlapMeters = 1.0;
    private const double MinimumDirectionCosine = 0.985; // Within ten degrees in 3D.
    private const double MaximumExtraLengthMeters = 2.0;
    private const double MaximumExtraLengthFraction = 0.05;

    internal static void Validate(ParallelTrayOccupancy[] readings)
    {
        if (readings.Length > LoadBalancedRouting.MaximumRouteCosts ||
            readings.Any(row => row is null || !double.IsFinite(row.OccupiedPercent) || row.OccupiedPercent < 0))
            throw new ArgumentException("Parallel tray occupancies require bounded, finite nonnegative readings.");
        CapacityRouting.ValidateExcludedRouteCodes(readings.Select(row => row.RouteCode).ToArray());
    }

    internal static T Select<T>(Request request, IEnumerable<TraySegment> segments,
        Func<Request, CancellationToken, T> calculate, Func<T, RouteResult?> acceptedRoute, CancellationToken token, long? requestStart = null)
    {
        long initialStart = Stopwatch.GetTimestamp();
        T initial = calculate(request, token);
        double observedTrialMs = Stopwatch.GetElapsedTime(initialStart).TotalMilliseconds;
        if (request.ParallelPowerTrayOccupancies is not { Length: >= 2 } readings ||
            acceptedRoute(initial) is not { Success: true, SegmentIds.Count: > 0 } baseline)
            return initial;
        var occupancy = readings.ToDictionary(row => row.RouteCode, row => row.OccupiedPercent, StringComparer.Ordinal);
        var excluded = new HashSet<string>(request.ExcludedRouteCodes ?? [], StringComparer.Ordinal);
        if (excluded.Count >= CapacityRouting.MaximumExcludedRouteCodes) return initial;
        long started = requestStart ?? initialStart;
        double OptionalTimeRemaining() => request.TimeoutMilliseconds - Stopwatch.GetElapsedTime(started).TotalMilliseconds - 250;
        double remaining = OptionalTimeRemaining();
        if (remaining <= observedTrialMs) return initial;
        // Reserve time to return the initial result inside the original deadline. The
        // optional token is shared by geometry discovery and all alternative searches.
        using var trialDeadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        trialDeadline.CancelAfter(TimeSpan.FromMilliseconds(remaining));
        var originals = baseline.RouteCodes.ToHashSet(StringComparer.Ordinal);
        Dictionary<string, Dictionary<string, string>> peers;
        try { peers = FindPeers(request, segments, baseline, originals, occupancy, excluded, trialDeadline.Token); }
        catch (OperationCanceledException) when (trialDeadline.IsCancellationRequested && !token.IsCancellationRequested) { return initial; }
        var ranked = (from source in peers
                      from target in source.Value.Values.Distinct(StringComparer.Ordinal)
                      where occupancy.TryGetValue(target, out var fill) && fill < occupancy[source.Key]
                      orderby occupancy[source.Key] - occupancy[target] descending, source.Key ascending, target ascending
                      select (Original: source.Key, Target: target)).Take(MaximumTrials);
        T best = initial;
        double bestGain = 0, bestLength = baseline.LengthMeters;
        double maxLength = baseline.LengthMeters + Math.Min(MaximumExtraLengthMeters, baseline.LengthMeters * MaximumExtraLengthFraction);
        foreach (var (code, target) in ranked)
        {
            token.ThrowIfCancellationRequested();
            var matches = peers[code];
            var trialExclusions = new HashSet<string>(excluded, StringComparer.Ordinal) { code };
            foreach (var peer in matches.Values)
                if (peer != target) trialExclusions.Add(peer);
            if (trialExclusions.Count > CapacityRouting.MaximumExcludedRouteCodes) continue;
            if (OptionalTimeRemaining() <= observedTrialMs) break;
            long trialStart = Stopwatch.GetTimestamp();
            T alternate;
            try { alternate = calculate(request with { ExcludedRouteCodes = [.. trialExclusions.Order(StringComparer.Ordinal)] }, trialDeadline.Token); }
            catch (OperationCanceledException) when (trialDeadline.IsCancellationRequested && !token.IsCancellationRequested) { break; }
            token.ThrowIfCancellationRequested();
            if (trialDeadline.IsCancellationRequested) break;
            observedTrialMs = Math.Max(observedTrialMs, Stopwatch.GetElapsedTime(trialStart).TotalMilliseconds);
            if (acceptedRoute(alternate) is not { Success: true } route || route.LengthMeters > maxLength ||
                route.RouteCodes.Contains(code, StringComparer.Ordinal)) continue;
            if (!route.SegmentIds.Any(id => matches.TryGetValue(id, out var peer) && peer == target)) continue;
            // Compare the changed sections only. A common trunk may dominate both paths.
            double largestNewLoad = occupancy[target];
            foreach (var added in route.RouteCodes.Where(c => c != "/SECONDARY" && !originals.Contains(c)))
            {
                if (!occupancy.TryGetValue(added, out double occupied)) { largestNewLoad = double.PositiveInfinity; break; }
                largestNewLoad = Math.Max(largestNewLoad, occupied);
            }
            double gain = occupancy[code] - largestNewLoad;
            if (gain > 0 && (gain > bestGain || gain == bestGain && route.LengthMeters < bestLength))
            {
                best = alternate; bestLength = route.LengthMeters; bestGain = gain;
            }
        }
        return best;
    }

    private static Dictionary<string, Dictionary<string, string>> FindPeers(Request request, IEnumerable<TraySegment> segments,
        RouteResult baseline, HashSet<string> originals, Dictionary<string, double> occupancy, HashSet<string> excluded, CancellationToken token)
    {
        var usedIds = baseline.SegmentIds.ToHashSet(StringComparer.Ordinal);
        var eligible = PurposeRouting.Filter(segments, request.AllowedPurposeRouteCodes, token)
            .Where(s => s.AllowedCategories.HasFlag(CableCategory.LV) && !excluded.Contains(s.RouteCode)).ToArray();
        var alternatives = eligible.Where(s => !originals.Contains(s.RouteCode)).ToArray();
        // A code may cover multiple separated pieces. Record compatible physical segment IDs
        // so taking an unrelated piece with the same name cannot qualify an alternate.
        var peers = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
        int comparisons = 0;
        var fittedRuns = new Dictionary<string, List<Line>>(StringComparer.Ordinal);
        List<Line> Runs(TraySegment segment)
        {
            if (!fittedRuns.TryGetValue(segment.Id, out var lines))
                fittedRuns.Add(segment.Id, lines = StraightRuns(segment.Points, token));
            return lines;
        }
        foreach (var used in eligible.Where(s => usedIds.Contains(s.Id) && occupancy.ContainsKey(s.RouteCode)))
        {
            foreach (var other in alternatives)
            {
                token.ThrowIfCancellationRequested();
                if (++comparisons > MaximumPieceComparisons) return [];
                // Even a fuller or unknown peer can be the engine's nearest attachment.
                // Include it for targeted exclusions, never as evidence of spare capacity.
                bool parallel = false;
                foreach (var source in Runs(used))
                {
                    foreach (var candidate in Runs(other))
                    {
                        if (++comparisons > MaximumPieceComparisons) return [];
                        if (Parallel(source.Start, source.End, candidate.Start, candidate.End)) { parallel = true; break; }
                    }
                    if (parallel) break;
                }
                if (!parallel) continue;
                if (!peers.TryGetValue(used.RouteCode, out var group)) peers.Add(used.RouteCode, group = new(StringComparer.Ordinal));
                group[other.Id] = other.RouteCode;
            }
        }
        return peers;
    }

    internal readonly record struct Line(RoutePoint Start, RoutePoint End);

    // Fitting may sample a single straight rail at short intervals. Merge collinear
    // forward edges before measuring overlap, preserving every physical bend.
    internal static List<Line> StraightRuns(IReadOnlyList<RoutePoint> points, CancellationToken token)
    {
        var runs = new List<Line>();
        if (points.Count < 2) return runs;
        var start = points[0];
        var end = start;
        double ux = 0, uy = 0, uz = 0;
        for (int i = 1; i < points.Count; i++)
        {
            token.ThrowIfCancellationRequested();
            var next = points[i];
            double dx = next.X - end.X, dy = next.Y - end.Y, dz = next.Z - end.Z;
            double length = end.DistanceTo(next);
            if (length == 0) continue;
            double alignment = (dx * ux + dy * uy + dz * uz) / length;
            if (alignment < 1 - 1e-9)
            {
                if (start.DistanceTo(end) > 0) runs.Add(new(start, end));
                start = end;
                ux = dx / length; uy = dy / length; uz = dz / length;
            }
            end = next;
        }
        if (start.DistanceTo(end) > 0) runs.Add(new(start, end));
        return runs;
    }

    internal static bool Parallel(RoutePoint a, RoutePoint b, RoutePoint c, RoutePoint d)
    {
        double length = a.DistanceTo(b), otherLength = c.DistanceTo(d);
        if (!double.IsFinite(length) || !double.IsFinite(otherLength) || Math.Min(length, otherLength) < MinimumOverlapMeters) return false;
        double ux = (b.X - a.X) / length, uy = (b.Y - a.Y) / length, uz = (b.Z - a.Z) / length;
        double Station(RoutePoint p) => (p.X - a.X) * ux + (p.Y - a.Y) * uy + (p.Z - a.Z) * uz;
        double start = Station(c), end = Station(d), span = end - start;
        if (Math.Abs(span) < otherLength * MinimumDirectionCosine) return false;
        double low = Math.Max(0, Math.Min(start, end)), high = Math.Min(length, Math.Max(start, end));
        if (high - low < Math.Max(MinimumOverlapMeters, Math.Min(length, otherLength) * 0.5)) return false;
        double Spacing(double station)
        {
            double t = (station - start) / span;
            double x = c.X - a.X + t * (d.X - c.X) - station * ux;
            double y = c.Y - a.Y + t * (d.Y - c.Y) - station * uy;
            double z = c.Z - a.Z + t * (d.Z - c.Z) - station * uz;
            return Math.Sqrt(x*x + y*y + z*z);
        }
        double first = Spacing(low), last = Spacing(high);
        return Math.Max(first, last) <= MaximumSpacingMeters && Math.Min(first, last) > 0.01;
    }
}
