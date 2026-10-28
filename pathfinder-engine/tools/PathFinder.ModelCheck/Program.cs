using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Model;

internal static class Program
{
    private static readonly JsonSerializerOptions OutputJson = new() { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static async Task<int> Main(string[] args)
    {
        bool worker = args.Length > 0 && args[0] == "--worker";
        try
        {
            var options = Parse(worker ? args[1..] : args);
            if (!worker) return await Supervise(args, options.MaximumMilliseconds);
            return Execute(options);
        }
        catch (OperationCanceledException)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "pathfinder.modelcheck.result.v1", status = "deadline_exceeded" }));
            return 4;
        }
        catch (Exception error) when (error is ArgumentException or JsonException or IOException or InvalidOperationException or FormatException or OverflowException)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "pathfinder.modelcheck.result.v1", status = "invalid_input", message = error.Message }));
            return 2;
        }
    }

    private static int Execute(CheckOptions options)
    {
        using var cancellation = new CancellationTokenSource(options.MaximumMilliseconds);
        var stopwatch = Stopwatch.StartNew();
        var file = new FileInfo(options.Snapshot);
        var limits = new ModelLimits();
        if (!file.Exists || file.Length is < 1 || file.Length > limits.MaximumBytes) throw new ArgumentException("Snapshot file absent or outside the 256 MiB limit.");
        var bytes = ReadBounded(file.FullName, limits.MaximumBytes, cancellation.Token);
        var snapshot = SnapshotReader.Read(bytes, limits, cancellation.Token);
        var requestedCodes = RouteLookupCalculator.Parse(options.Route);
        var routingOptions = new RoutingOptions
        {
            ConnectionToleranceMeters = options.ToleranceMetres, SampleSpacingMeters = 0.125,
            SecondaryDistanceMeters = 2, PreferVerticalApproach = false,
            MaxGraphNodes = 500000, MaxGraphConnections = 2000000
        };
        var modelCache = new FittedModelCache(options.Cache, limits);
        var coldWatch = Stopwatch.StartNew();
        var prepared = modelCache.GetOrBuild(bytes, cancellation: cancellation.Token); coldWatch.Stop();
        var memoryWatch = Stopwatch.StartNew();
        var repeated = modelCache.GetOrBuild(bytes, cancellation: cancellation.Token); memoryWatch.Stop();
        var diskWatch = Stopwatch.StartNew();
        var restored = new FittedModelCache(options.Cache, limits).GetOrBuild(bytes, cancellation: cancellation.Token); diskWatch.Stop();
        var lookupWatch = Stopwatch.StartNew();
        var route = RouteLookupCalculator.Calculate(prepared.Segments, requestedCodes, routingOptions, cancellation.Token); lookupWatch.Stop();
        var repeatedRoute = RouteLookupCalculator.Calculate(restored.Segments, requestedCodes, routingOptions, cancellation.Token);
        var serializedRoute = JsonSerializer.Serialize(Route(route));
        bool sameRoute = serializedRoute == JsonSerializer.Serialize(Route(repeatedRoute));
        bool sameSegments = JsonSerializer.Serialize(prepared.Segments.Select(Segment)) == JsonSerializer.Serialize(restored.Segments.Select(Segment));
        bool checksPassed = ReferenceEquals(prepared, repeated) && restored.LoadedFromDisk && prepared.Counts == restored.Counts
            && prepared.Diagnostics.SequenceEqual(restored.Diagnostics) && sameSegments && sameRoute;
        var result = new
        {
            schemaVersion = "pathfinder.modelcheck.result.v1", observedAtUtc = DateTimeOffset.UtcNow,
            scope = snapshot.Capture.SourceKind == "converted" ? "actual-converted-selected-geometry-ordered-lookup-diagnostic" : "declared-" + snapshot.Capture.SourceKind + "-geometry-ordered-lookup-diagnostic",
            status = checksPassed ? route.Success ? "completed_route" : "completed_no_path" : "cache_consistency_failed",
            diagnosticChecksStatus = checksPassed ? "PASS" : "FAIL", engineeringAccepted = false,
            nativeConvertedParity = "NOT_ESTABLISHED; native reference comparison is separate",
            sourceSnapshot = new { path = file.FullName, bytes = bytes.Length, sha256 = SnapshotReader.Sha256(bytes) },
            model = snapshot.Model, capture = snapshot.Capture, coordinates = snapshot.Coordinates,
            counts = new
            {
                objects = snapshot.Objects.Length, routingLeaves = snapshot.Objects.Count(item => item.GeometryRole == "routing-leaf"),
                fragments = snapshot.Objects.Sum(item => item.Fragments.Length), vertices = snapshot.Objects.Sum(item => item.Fragments.Sum(fragment => fragment.Vertices.Length)),
                triangles = snapshot.Objects.Sum(item => item.Fragments.Sum(fragment => fragment.TriangleIndices.Length / 3)),
                fittedSegments = prepared.Segments.Count, fitting = prepared.Counts,
                unassignedCategoryObjects = snapshot.Objects.Count(item => item.CategoryAssignmentSource == "unassigned"),
                unknownNativeVisibilityObjects = prepared.Objects.Count(item => item.Visibility == "unknown")
            },
            readiness = prepared.Readiness, readyForEngineeringWrites = prepared.ReadyForEngineeringWrites,
            cache = new
            {
                prepared.Key, prepared.SnapshotSha256, prepared.RulesSha256, prepared.CacheScope,
                firstReadWasDiskHit = prepared.LoadedFromDisk, memoryHitSameReference = ReferenceEquals(prepared, repeated),
                restoredDiskHit = restored.LoadedFromDisk, sameSegments, sameRoute,
                sameCounters = prepared.Counts == restored.Counts, sameDiagnostics = prepared.Diagnostics.SequenceEqual(restored.Diagnostics)
            },
            performance = new
            {
                firstFitOrReadMilliseconds = coldWatch.Elapsed.TotalMilliseconds, memoryReadMilliseconds = memoryWatch.Elapsed.TotalMilliseconds,
                diskRestoreMilliseconds = diskWatch.Elapsed.TotalMilliseconds, lookupMilliseconds = lookupWatch.Elapsed.TotalMilliseconds,
                elapsedMilliseconds = stopwatch.Elapsed.TotalMilliseconds, peakWorkingSetBytes = Process.GetCurrentProcess().PeakWorkingSet64,
                hardWorkerBudgetMilliseconds = options.MaximumMilliseconds
            },
            calculationMode = "ordered-lookup-without-equipment-approaches-or-design-allowances",
            categoryPolicy = "No category assignment is invented. Ordered lookup uses the pinned core's label selection semantics.",
            projectSettings = (object?)null, designLength = (object?)null,
            requestedRouteText = options.Route, requestedCodes, explicitDiagnosticOptions = routingOptions,
            route = Route(route), fittedSegments = prepared.Segments.Select(Segment), diagnostics = prepared.Diagnostics
        };
        var output = Path.GetFullPath(options.Output);
        var directory = Path.GetDirectoryName(output) ?? throw new ArgumentException("Output parent required.");
        Directory.CreateDirectory(directory);
        if (File.Exists(output)) throw new ArgumentException("Output already exists; choose a unique receipt path.");
        var resultBytes = JsonSerializer.SerializeToUtf8Bytes(result, OutputJson);
        var temporary = output + "." + Guid.NewGuid().ToString("N") + ".tmp";
        using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        { stream.Write(resultBytes); stream.Flush(true); }
        cancellation.Token.ThrowIfCancellationRequested(); File.Move(temporary, output, false);
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            status = checksPassed ? route.Success ? "completed_route" : "completed_no_path" : "cache_consistency_failed",
            output, diagnosticChecks = checksPassed ? "PASS" : "FAIL", objects = snapshot.Objects.Length,
            fittedSegments = prepared.Segments.Count, routeSuccess = route.Success, routeLengthMetresR = R(route.LengthMeters),
            pathPoints = route.PathPoints.Count, readiness = prepared.Readiness, elapsedMilliseconds = stopwatch.Elapsed.TotalMilliseconds
        }));
        return !checksPassed ? 1 : route.Success ? 0 : 3;
    }

    private static async Task<int> Supervise(string[] args, int maximumMilliseconds)
    {
        var info = new ProcessStartInfo(Environment.ProcessPath ?? throw new InvalidOperationException("Process path unavailable."))
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        if (string.Equals(Path.GetFileNameWithoutExtension(info.FileName), "dotnet", StringComparison.OrdinalIgnoreCase)) info.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        info.ArgumentList.Add("--worker"); foreach (var argument in args) info.ArgumentList.Add(argument);
        using var process = Process.Start(info) ?? throw new InvalidOperationException("Could not start isolated diagnostic worker.");
        using var deadline = new CancellationTokenSource(maximumMilliseconds);
        try
        {
            var stdout = process.StandardOutput.ReadToEndAsync(deadline.Token);
            var stderr = process.StandardError.ReadToEndAsync(deadline.Token);
            await process.WaitForExitAsync(deadline.Token);
            Console.Write(await stdout); Console.Error.Write(await stderr);
            return process.ExitCode;
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(true);
            await process.WaitForExitAsync(CancellationToken.None);
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "pathfinder.modelcheck.result.v1", status = "deadline_exceeded", maximumMilliseconds }));
            return 4;
        }
        finally
        {
            if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); }
        }
    }

    private static CheckOptions Parse(string[] args)
    {
        if (args.Length == 0 || args.Length % 2 != 0) throw new ArgumentException("Expected --snapshot PATH --cache OWNED_PATH --route TEXT --output UNIQUE_PATH [--max-ms 120000] [--tolerance-metres 0.25].");
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < args.Length; index += 2)
            if (!values.TryAdd(args[index], args[index + 1]) || args[index] is not ("--snapshot" or "--cache" or "--route" or "--output" or "--max-ms" or "--tolerance-metres"))
                throw new ArgumentException("Unknown or duplicate command-line option.");
        string Required(string name) => values.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value) ? value : throw new ArgumentException("Missing " + name);
        var maximum = values.TryGetValue("--max-ms", out var timeout) ? int.Parse(timeout, CultureInfo.InvariantCulture) : 120000;
        if (maximum is < 1 or > 120000) throw new ArgumentException("Hard diagnostic budget must be between 1 and 120000ms.");
        var tolerance = values.TryGetValue("--tolerance-metres", out var rawTolerance) ? double.Parse(rawTolerance, CultureInfo.InvariantCulture) : 0.25;
        if (!double.IsFinite(tolerance) || tolerance <= 0 || tolerance > 1000) throw new ArgumentException("Invalid explicit diagnostic tolerance.");
        var route = Required("--route"); if (route.Length > 32768) throw new ArgumentException("Route text outside diagnostic byte budget.");
        return new(Path.GetFullPath(Required("--snapshot")), Path.GetFullPath(Required("--cache")), route, Path.GetFullPath(Required("--output")), maximum, tolerance);
    }
    private static byte[] ReadBounded(string path, int max, CancellationToken token)
    {
        using var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var output = new MemoryStream(); var chunk = new byte[8192];
        while (true)
        {
            token.ThrowIfCancellationRequested(); var read = source.Read(chunk); if (read == 0) break;
            if (output.Length + read > max) throw new ArgumentException("Snapshot grew beyond its byte budget."); output.Write(chunk, 0, read);
        }
        return output.ToArray();
    }
    private static string R(double value) => value.ToString("R", CultureInfo.InvariantCulture);
    private static double[] P(RoutePoint value) => [value.X, value.Y, value.Z];
    private static string[] PR(RoutePoint value) => [R(value.X), R(value.Y), R(value.Z)];
    private static object Route(RouteResult value) => new
    {
        value.Success, value.Message, value.RouteText, value.RouteCodes, value.SegmentIds,
        pathPoints = value.PathPoints.Select(P), pathPointsR = value.PathPoints.Select(PR),
        value.LengthMeters, lengthMetersR = R(value.LengthMeters), value.FromDistanceMeters, fromDistanceMetersR = R(value.FromDistanceMeters),
        value.ToDistanceMeters, toDistanceMetersR = R(value.ToDistanceMeters), value.FromRequiresSecondary, value.ToRequiresSecondary,
        value.ConnectionGapCount, value.ConnectionGapLengthMeters, connectionGapLengthMetersR = R(value.ConnectionGapLengthMeters)
    };
    private static object Segment(TraySegment value) => new
    {
        value.Id, value.Name, value.RouteCode, allowedCategories = (int)value.AllowedCategories, value.ConnectionsAtEndsOnly,
        points = value.Points.Select(P), pointsR = value.Points.Select(PR), connectionSurfaceCount = value.ConnectionSurfaces.Count,
        verifiedPorts = value.VerifiedPorts.Select(port => new { point = P(port.Point), pointR = PR(port.Point), outward = P(port.Outward), u = P(port.U), v = P(port.V), port.Width, port.Height })
    };
    private sealed record CheckOptions(string Snapshot, string Cache, string Route, string Output, int MaximumMilliseconds, double ToleranceMetres);
}
