using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Adapter;
using PathFinder.Model;

namespace PathFinder.CapacityBench;

internal static class Benchmark
{
    private sealed record Answer(RouteResult Route, CableDesignLength? Design, string EffectiveCategory, JsonElement Semantic, string Hash, string? Issue);
    private sealed record Measured<T>(T? Value, Phase Phase) where T : class;
    internal static object Run(BenchManifest manifest, string root, string manifestSha256)
    {
        using var deadline = new CancellationTokenSource(manifest.TotalTimeoutMilliseconds);
        var stopwatch = Stopwatch.StartNew();
        var sourceBytes = Input.Snapshot(manifest.Snapshot, deadline.Token);
        var snapshot = SnapshotReader.Read(sourceBytes, cancellation: deadline.Token);
        var inputs = new List<DatasetInput> { new(manifest.Label, snapshot.Capture.SourceKind == "synthetic" ? "synthetic" : "copied-real", manifest.Snapshot, manifest.Request, null) };
        foreach (var size in manifest.SyntheticSizes) inputs.Add(Synthetic.Create(root, size, manifest.Request));
        var results = new List<object>(); var allPassed = true;
        foreach (var input in inputs)
        {
            var result = RunDataset(input, root, results.Count, manifest, deadline.Token);
            results.Add(result.Value); allPassed &= result.Passed;
        }
        (object Value, bool Passed) controls;
        try { controls = Controls(inputs[1], manifest, deadline.Token); }
        catch (OperationCanceledException) { controls = (new { status = "TIMEOUT", reason = "Total deadline expired during controls; preceding dataset outcomes are retained." }, false); }
        catch (Exception error) when (Controlled(error)) { controls = (new { status = "FAIL", reason = Safe(error.Message) }, false); }
        allPassed &= controls.Passed;
        var unchanged = Input.Hash(Input.ReadFile(manifest.Snapshot.Path, Input.MaximumSnapshotBytes)) == manifest.Snapshot.Sha256;
        allPassed &= unchanged;
        return new
        {
            schemaVersion = "pathfinder.capacity.result.v1", recordedAtUtc = DateTimeOffset.UtcNow, status = allPassed ? "PASS" : "FAIL",
            manifestSha256, manifest, workRoot = root, wallMilliseconds = stopwatch.Elapsed.TotalMilliseconds, inputSnapshotUnchanged = unchanged,
            environment = new { framework = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription, platform = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
                architecture = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(), processorCount = Environment.ProcessorCount, processId = Environment.ProcessId },
            assemblies = new[] { Assembly.GetExecutingAssembly(), typeof(FittedModelCache).Assembly, typeof(RouteCalculator).Assembly, typeof(PathfinderAdapter).Assembly }
                .Select(assembly => new { name = assembly.GetName().Name, version = assembly.GetName().Version?.ToString(), sha256 = Input.Hash(Input.ReadFile(assembly.Location, Input.MaximumSnapshotBytes)) }).ToArray(),
            datasets = results, controls = controls.Value,
            scope = new { engineVersion = FittedModelCache.EngineVersion, calculationMode = "calculate", lookup = "NOT_MEASURED", graphReuse = "NOT_IMPLEMENTED; unchanged core builds graph for every query",
                memoryReuse = "same PreparedModel benchmark only; production still uses one-shot ModelRunner", wholePlantCapacity = "NOT_ESTABLISHED", nativeParity = "NOT_PERFORMED", engineeringAcceptance = false,
                queryReuseScope = "Repeated identical endpoints/category/options within each dataset; query-order, changed-endpoint and changed-category independence are not established.",
                timeoutScope = "Cooperative phase/total cancellation only; the external orchestrator owns the hard process/container deadline.",
                workflowCompatibility = "Synthetic chains with more than100 route codes are mathematical Core capacity probes, not proof of WFC Viewer/Apply compatibility.",
                semanticHashFormat = "recursive-ordinal-key canonical .NET JSON; full baseline objects retained for independent Node canonicalization without numeric rounding",
                memoryScope = "own benchmark process only; current/lifetime peak working set and process-wide managed allocations, not per-phase isolated peak or child-tree RSS",
                coldDefinition = "Cold means no fitted disk/memory cache for that dataset. Input was already hashed, parsed and validated; process/JIT/OS caches are shared across sequential datasets.",
                queryMeasurementScope = "Unchanged Calculate plus design calculation, expected checks and full canonical semantic serialization/hash; this is not an isolated search-only timer.",
                jitWarmup = "No explicit warmup is added. Prevalidation and earlier cases can warm JIT/OS caches. Repetitions can reuse mesh-clearance proof caches; fresh production-process timings are measured separately." }
        };
    }
    private static (object Value, bool Passed) RunDataset(DatasetInput input, string root, int index, BenchManifest manifest, CancellationToken total)
    {
        var phases = new List<Phase>(); var passed = true; string? coldHash = null;
        object? preparedInfo = null; byte[]? bytes = null;
        try { bytes = Input.Snapshot(input.Snapshot, total); }
        catch (Exception error) when (Controlled(error) || error is OperationCanceledException)
        { return (new { input, status = error is OperationCanceledException ? "TIMEOUT" : "FAIL", message = Safe(error.Message), phases, prepared = preparedInfo }, false); }
        var cacheRoot = Path.Combine(root, "cache-" + index);
        var cold = Measure("cold-fit", 0, manifest, total, token => new FittedModelCache(cacheRoot).GetOrBuild(bytes, cancellation: token)); phases.Add(cold.Phase);
        if (cold.Value is null || cold.Phase.Status != "PASS") return (new { input, status = "FAIL", phases, prepared = preparedInfo }, false);
        if (cold.Value.LoadedFromDisk) passed = false;
        preparedInfo = new { cold.Value.Key, cold.Value.SnapshotSha256, cold.Value.RulesSha256, cold.Value.Readiness, cold.Value.Counts, cold.Value.CacheScope,
            objectCount = cold.Value.Objects.Count, segmentCount = cold.Value.Segments.Count, diagnosticCount = cold.Value.Diagnostics.Count,
            diagnostics = cold.Value.Diagnostics.Take(32).Select(Safe).ToArray(), diagnosticsTruncated = cold.Value.Diagnostics.Count > 32, engineeringAccepted = false };
        var first = Measure("cold-query", 0, manifest, total, token => Calculate(cold.Value, input.Request, input.Expected, token), emitSemantic: true); phases.Add(first.Phase);
        if (first.Value is not null) coldHash = first.Value.Hash;
        passed &= first.Phase.Status == "PASS";
        var warmCache = new FittedModelCache(cacheRoot);
        var warm = Measure("warm-disk-fit", 0, manifest, total, token => warmCache.GetOrBuild(bytes, cancellation: token)); phases.Add(warm.Phase);
        if (warm.Value is null || warm.Phase.Status != "PASS") return (new { input, status = "FAIL", phases, prepared = preparedInfo }, false);
        passed &= warm.Value.LoadedFromDisk;
        var diskQuery = Measure("warm-disk-query", 0, manifest, total, token => Calculate(warm.Value, input.Request, input.Expected, token), coldHash); phases.Add(diskQuery.Phase);
        passed &= diskQuery.Phase.Status == "PASS" && diskQuery.Phase.MatchesCold == true;
        var memory = Measure("memory-fit-hit", 0, manifest, total, token => warmCache.GetOrBuild(bytes, cancellation: token));
        var sameReference = memory.Value is not null && ReferenceEquals(memory.Value, warm.Value);
        phases.Add(memory.Phase with { ReusesPreparedReference = sameReference });
        if (memory.Value is null || memory.Phase.Status != "PASS") return (new { input, status = "FAIL", phases, prepared = preparedInfo }, false);
        var memoryHit = memory.Value; passed &= sameReference;
        for (var iteration = 1; iteration <= manifest.RepeatQueries; iteration++)
        {
            var query = Measure("memory-query", iteration, manifest, total, token => Calculate(memoryHit, input.Request, input.Expected, token), coldHash, sameReference: sameReference);
            phases.Add(query.Phase); passed &= query.Phase.Status == "PASS" && query.Phase.MatchesCold == true;
            if (total.IsCancellationRequested) break;
        }
        var unchanged = Input.Hash(Input.ReadFile(input.Snapshot.Path, Input.MaximumSnapshotBytes)) == input.Snapshot.Sha256; passed &= unchanged;
        return (new { input, status = passed ? "PASS" : "FAIL", inputUnchanged = unchanged, prepared = preparedInfo, phases }, passed);
    }
    private static Answer Calculate(PreparedModel prepared, CalculationInput input, ExpectedSynthetic? expected, CancellationToken token)
    {
        var category = input.Category switch { "MV" => CableCategory.MV, "LV" => CableCategory.LV, "Control" or "Instrumentation" => CableCategory.Control, _ => throw new ArgumentException("Unknown category.") };
        var route = new RouteCalculator().Calculate(prepared.Segments, Point(input.From), Point(input.To), category, Options(input.Options), token);
        token.ThrowIfCancellationRequested(); CableDesignLength? design = null; string? issue = null;
        if (!route.Success) issue = route.Message;
        else if ((route.FromRequiresSecondary || route.ToRequiresSecondary) && input.ProjectSettings.SecondaryTrayLength is null) issue = "Project Details SECONDARY length is required.";
        else design = CableDesignLength.Calculate(route, input.ProjectSettings.EndConnectionLength, input.ProjectSettings.SecondaryTrayLength ?? 0, input.ProjectSettings.AdditionalBendingPercent);
        if (expected is not null && (route.LengthMeters != expected.LengthMeters || !route.SegmentIds.ToHashSet(StringComparer.Ordinal).SetEquals(
                Enumerable.Range(0, expected.SegmentCount).Select(index => "synthetic:capacity:" + index.ToString("D6", CultureInfo.InvariantCulture)))
            || route.FromDistanceMeters != 0 || route.ToDistanceMeters != 0 || route.FromRequiresSecondary || route.ToRequiresSecondary
            || route.ConnectionGapCount != 0 || route.ConnectionGapLengthMeters != 0 || design?.DesignLengthMeters.ToString("0", CultureInfo.InvariantCulture) != expected.DesignLengthMeters))
            issue = "Independent mathematical chain length/design/segments/approach/gap expectation failed.";
        var semantic = Canonical(new { route, design = design is null ? null : new { lengthBeforePercentageMeters = Decimal(design.LengthBeforePercentageMeters),
            unroundedLengthMeters = Decimal(design.UnroundedLengthMeters), designLengthMeters = Decimal(design.DesignLengthMeters) }, effectiveCategory = category.ToString() });
        return new(route, design, category.ToString(), semantic, Input.Hash(System.Text.Encoding.UTF8.GetBytes(semantic.GetRawText())), issue);
    }
    internal static JsonElement Canonical(object value)
    {
        var raw = JsonSerializer.SerializeToUtf8Bytes(value, Input.Json); using var document = JsonDocument.Parse(raw);
        using var stream = new MemoryStream(); using (var writer = new Utf8JsonWriter(stream)) Sort(document.RootElement, writer);
        using var canonical = JsonDocument.Parse(stream.ToArray()); return canonical.RootElement.Clone();
    }
    private static void Sort(JsonElement value, Utf8JsonWriter writer)
    {
        if (value.ValueKind == JsonValueKind.Object) { writer.WriteStartObject(); foreach (var property in value.EnumerateObject().OrderBy(property => property.Name, StringComparer.Ordinal)) { writer.WritePropertyName(property.Name); Sort(property.Value, writer); } writer.WriteEndObject(); }
        else if (value.ValueKind == JsonValueKind.Array) { writer.WriteStartArray(); foreach (var child in value.EnumerateArray()) Sort(child, writer); writer.WriteEndArray(); }
        else value.WriteTo(writer);
    }
    private static string Decimal(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
    private static RoutePoint Point(double[] point) => new(point[0], point[1], point[2]);
    private static RoutingOptions Options(EngineOptions value) => new() { ConnectionToleranceMeters = value.ConnectionToleranceMeters, SampleSpacingMeters = value.SampleSpacingMeters,
        SecondaryDistanceMeters = value.SecondaryDistanceMeters, PreferVerticalApproach = value.PreferVerticalApproach, MaxGraphNodes = value.MaxGraphNodes, MaxGraphConnections = value.MaxGraphConnections };
    private static Measured<T> Measure<T>(string name, int iteration, BenchManifest manifest, CancellationToken total, Func<CancellationToken, T> operation,
        string? coldHash = null, bool emitSemantic = false, bool sameReference = false) where T : class
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(total); timeout.CancelAfter(manifest.CaseTimeoutMilliseconds);
        var watch = Stopwatch.StartNew(); var allocated = GC.GetTotalAllocatedBytes(true); using var process = Process.GetCurrentProcess(); var cpu = process.TotalProcessorTime;
        T? value = null; var status = "PASS"; var message = "Completed.";
        try { timeout.Token.ThrowIfCancellationRequested(); value = operation(timeout.Token); timeout.Token.ThrowIfCancellationRequested(); }
        catch (OperationCanceledException) { status = "TIMEOUT"; message = total.IsCancellationRequested ? "Total benchmark deadline exceeded." : "Phase deadline exceeded."; }
        catch (Exception error) when (Controlled(error)) { status = "FAIL"; message = Safe(error.Message); }
        watch.Stop(); process.Refresh(); var metrics = new Metrics(watch.Elapsed.TotalMilliseconds, (process.TotalProcessorTime - cpu).TotalMilliseconds,
            Math.Max(0, GC.GetTotalAllocatedBytes(true) - allocated), process.WorkingSet64, process.PeakWorkingSet64, process.PrivateMemorySize64);
        var answer = value as Answer; bool? matches = coldHash is null || answer is null ? null : answer.Hash == coldHash;
        if (answer?.Issue is not null || matches == false) { status = "FAIL"; message = answer?.Issue ?? "Route/design semantics differ from the cold query."; }
        return new(value, new(name, iteration, status, Safe(message), metrics, emitSemantic ? answer?.Semantic : null, answer?.Hash, matches, (value as PreparedModel)?.LoadedFromDisk, sameReference));
    }
    private static (object Value, bool Passed) Controls(DatasetInput input, BenchManifest manifest, CancellationToken total)
    {
        if (total.IsCancellationRequested) return (new { status = "NOT_RUN", reason = "Total deadline ended before controls." }, false);
        var bytes = Input.Snapshot(input.Snapshot, total); var directory = Path.Combine(Path.GetDirectoryName(input.Snapshot.Path)!, "control-cache");
        var prepared = new FittedModelCache(directory).GetOrBuild(bytes, cancellation: total);
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel(); var preCancelled = false;
        try { _ = new RouteCalculator().Calculate(prepared.Segments, Point(input.Request.From), Point(input.Request.To), CableCategory.Control, Options(input.Request.Options), cancelled.Token); }
        catch (OperationCanceledException) { preCancelled = true; }
        var constrained = Options(input.Request.Options); constrained.MaxGraphNodes = 2;
        var failure = new RouteCalculator().Calculate(prepared.Segments, Point(input.Request.From), Point(input.Request.To), CableCategory.Control, constrained, total);
        var limitObserved = !failure.Success && failure.Message.Contains("node limit", StringComparison.OrdinalIgnoreCase);
        using var during = CancellationTokenSource.CreateLinkedTokenSource(total); var observed = false; var signalledDuringEnumeration = false; var watch = Stopwatch.StartNew();
        IEnumerable<TraySegment> CancelDuringEnumeration()
        { var index = 0; foreach (var segment in prepared.Segments) { if (++index == 2) { signalledDuringEnumeration = true; during.Cancel(); } yield return segment; } }
        try { _ = new RouteCalculator().Calculate(CancelDuringEnumeration(), Point(input.Request.From), Point(input.Request.To), CableCategory.Control, Options(input.Request.Options), during.Token); }
        catch (OperationCanceledException) { observed = true; }
        var passed = preCancelled && limitObserved && observed && signalledDuringEnumeration;
        return (new { status = passed ? "PASS" : "FAIL", preCancelledObserved = preCancelled, cancellationDuringInputEnumeration = observed, cancellationMilliseconds = watch.Elapsed.TotalMilliseconds,
            cancellationScope = "Deterministically cancelled when the unchanged core enumerates the second eligible segment; no claim of deepest-search interruption latency.",
            graphBudgetFailureObserved = limitObserved, graphBudgetFailure = new { maxGraphNodes = 2, failure.Success, failure.Message }, effectiveDefaultBudgets = input.Request.Options,
            note = "Only negative-control graph budget is lowered. No production/default capacity ceiling is raised." }, passed);
    }
    internal static bool Controlled(Exception error) => error is ArgumentException or IOException or InvalidOperationException or OverflowException or JsonException or UnauthorizedAccessException;
    private static string Safe(string value) => value.Length <= 2048 ? value : value[..2048];
}
