using System.Diagnostics;
using System.Reflection;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using AddinRibbon.Routing;
using PathFinder.Adapter;
using PathFinder.Model;

// Private stdio worker. WFC owns actor/dependency/provenance authorization;
// this process owns strict input, immutable file hashes and C# computation.
internal static partial class Program
{
    private const int MaximumInput = 1024 * 1024;
    private const int MaximumOutput = 32 * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = CreateJson();
    private static JsonSerializerOptions CreateJson()
    {
        var options = new JsonSerializerOptions(PathfinderAdapter.JsonOptions);
        options.Converters.Insert(0, new CanonicalDecimalConverter());
        options.MakeReadOnly(); return options;
    }
    private sealed class CanonicalDecimalConverter : JsonConverter<decimal>
    {
        public override decimal Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
            ((JsonConverter<decimal>)PathfinderAdapter.JsonOptions.GetConverter(typeof(decimal))).Read(ref reader, type, PathfinderAdapter.JsonOptions);
        public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) =>
            writer.WriteStringValue(value.ToString("0.############################", CultureInfo.InvariantCulture));
    }
    private static async Task<int> Main(string[] args)
    {
        if (args is ["--session-supervisor"] or ["--session-worker"])
        {
            // Session stdout is framed protocol only, including on terminal faults.
            try { return args[0] == "--session-supervisor" ? await RunSessionSupervisor() : await RunSessionWorker(); }
            catch { return 2; }
        }
        Request? request = null;
        try
        {
            using var inputDeadline = new CancellationTokenSource(120000);
            var bytes = await ReadBounded(Console.OpenStandardInput(), MaximumInput, inputDeadline.Token);
            using (var document = JsonDocument.Parse(bytes)) RejectDuplicates(document.RootElement);
            request = JsonSerializer.Deserialize<Request>(bytes, Json) ?? throw new ArgumentException("A request is required.");
            Validate(request);
            if (args.Length == 0) return await Supervise(bytes, request);
            if (args is not ["--worker"]) throw new ArgumentException("Unsupported command arguments.");
            using var deadline = new CancellationTokenSource(request.TimeoutMilliseconds);
            return await Emit(Execute(request, deadline.Token));
        }
        catch (OperationCanceledException) { return await Emit(Failure(request, "deadline_exceeded", "Calculation deadline exceeded.")); }
        catch (Exception error) when (error is ArgumentException or JsonException or IOException or InvalidOperationException or OverflowException or System.ComponentModel.Win32Exception)
        { return await Emit(Failure(request, "invalid_request", error is IOException ? "An owned input or cache file could not be read." : error.Message)); }
    }

    private static object Execute(Request request, CancellationToken token, SessionExecutionContext? session = null)
    {
        var settings = request.ProjectSettings;
        if (request.Operation == "lookup-plan") return new
        {
            schemaVersion = "pathfinder.model.response.v1", request.RequestId, status = "lookup_planned",
            message = "Ordered route parsed by the pinned Path Finder lookup parser.",
            routeCodes = LookupScopeResolver.Plan(request.RouteText!, token).Distinct(StringComparer.Ordinal).ToArray(), engineeringAccepted = false
        };
        if (request.Operation == "design")
        {
            var route = request.Route ?? throw new ArgumentException("Retained route metrics are required.");
            if (!route.Success) throw new ArgumentException("A successfully calculated retained route is required.");
            if (settings is null) throw new ArgumentException("Project Details settings are required.");
            if ((route.FromRequiresSecondary || route.ToRequiresSecondary) && settings.SecondaryTrayLength is null)
                return Failure(request, "settings_required", "Project Details SECONDARY length is required.");
            var design = SavedRouteDesign.Calculate(route.LengthMeters, route.FromDistanceMeters,
                route.ToDistanceMeters, route.FromRequiresSecondary, route.ToRequiresSecondary,
                settings.EndConnectionLength, settings.SecondaryTrayLength ?? 0m, settings.AdditionalBendingPercent);
            token.ThrowIfCancellationRequested();
            return new { schemaVersion = "pathfinder.model.response.v1", request.RequestId, status = "calculated", message = "Design allowances recalculated from retained geometry.", design, engineeringAccepted = false };
        }

        var root = OwnedRoot();
        var snapshots = SafeChild(root, "snapshots", create: false);
        var input = SafeChild(snapshots, request.SnapshotId + ".json", create: false);
        var info = new FileInfo(input);
        if (!info.Exists || info.Length is < 1 or > 268435456) throw new ArgumentException("Snapshot is missing or exceeds the byte budget.");
        var snapshotBytes = ReadBounded(File.OpenRead(input), 268435456, token).GetAwaiter().GetResult();
        if (SnapshotReader.Sha256(snapshotBytes) != request.SnapshotSha256) throw new ArgumentException("Snapshot hash does not match the immutable artifact.");
        var snapshot = SnapshotReader.Read(snapshotBytes, cancellation: token);
        if (snapshot.Model.ProjectId != request.ProjectId || snapshot.Model.ModelVersionId != request.ModelVersionId)
            throw new ArgumentException("Snapshot project/model identity mismatch.");
        LookupScopeSummary? lookupScope = null;
        if (snapshot.Capture.LookupRouteCodes is not null)
        {
            if (request.Operation != "lookup") throw new ArgumentException("Independent lookup geometry cannot be used for planning preparation or cable calculation.");
            var resolved = LookupScopeResolver.Resolve(snapshot, LookupScopeResolver.Plan(request.RouteText!, token), cancellation: token);
            snapshot = resolved.Snapshot; lookupScope = resolved.Scope;
            snapshotBytes = JsonSerializer.SerializeToUtf8Bytes(snapshot, SnapshotReader.JsonOptions);
        }
        var cacheRoot = SafeChild(root, "cache", create: true);
        var prepared = session is null ? new FittedModelCache(cacheRoot).GetOrBuild(snapshotBytes, request.Rules, token)
            : session.Prepare(cacheRoot, snapshotBytes, request.Rules, token);
        var summary = new
        {
            prepared.Key, prepared.Readiness, prepared.Counts, prepared.CacheScope, prepared.LoadedFromDisk,
            objectCount = prepared.Objects.Count, segmentCount = prepared.Segments.Count,
            diagnosticCount = prepared.Diagnostics.Count,
            diagnostics = prepared.Diagnostics.Take(2048).ToArray(), diagnosticsTruncated = prepared.Diagnostics.Count > 2048,
            engineeringAccepted = false
        };
        if (request.Operation == "prepare") return new
        {
            schemaVersion = "pathfinder.model.response.v1", request.RequestId, status = "prepared",
            message = "Fitted computational artifact prepared; engineering acceptance is a separate gate.",
            snapshot.Model, prepared = summary, engineeringAccepted = false
        };
        var category = request.Category switch
        {
            "MV" => CableCategory.MV, "LV" => CableCategory.LV,
            "Control" or "Instrumentation" => CableCategory.Control, _ => CableCategory.None
        };
        if (request.Operation == "calculate" && category == CableCategory.None) return Failure(request, "category_required", "Resolve the cable category before calculation.");
        var includedRoutingObjects = prepared.Objects.Where(o => o.GeometryRole == "routing-leaf" && o.Visibility is not ("hidden" or "excluded"))
            .Select(o => o.Id).ToHashSet(StringComparer.Ordinal);
        if (request.Operation == "calculate" && snapshot.Objects.Any(o => includedRoutingObjects.Contains(o.Id) && (o.CategoryAssignmentSource == "unassigned" || o.AllowedCategories.Length == 0)))
            return Failure(request, "model_needs_review", "Assign explicit planning categories to the selected routing geometry.");
        var options = request.Options ?? throw new ArgumentException("Explicit routing options are required.");
        var routeOptions = new RoutingOptions
        {
            ConnectionToleranceMeters = options.ConnectionToleranceMeters, SampleSpacingMeters = options.SampleSpacingMeters,
            SecondaryDistanceMeters = options.SecondaryDistanceMeters, PreferVerticalApproach = options.PreferVerticalApproach,
            MaxGraphNodes = options.MaxGraphNodes, MaxGraphConnections = options.MaxGraphConnections
        };
        var routeResult = request.Operation == "lookup"
            ? RouteLookupCalculator.Calculate(prepared.Segments, RouteLookupCalculator.Parse(request.RouteText), routeOptions, token)
            : new RouteCalculator().Calculate(prepared.Segments, Point(request.From), Point(request.To), category, routeOptions, token);
        token.ThrowIfCancellationRequested();
        if (request.Reverse) routeResult = routeResult.Reverse();
        CableDesignLength? resultDesign = null;
        var status = routeResult.Success ? "calculated" : IsCoreResourceLimit(routeResult.Message) ? "resource_limit" : "no_path";
        if (routeResult.Success && request.Operation == "calculate")
        {
            if (settings is null) throw new ArgumentException("Project Details settings are required.");
            if ((routeResult.FromRequiresSecondary || routeResult.ToRequiresSecondary) && settings.SecondaryTrayLength is null)
                status = "settings_required";
            else resultDesign = CableDesignLength.Calculate(routeResult, settings.EndConnectionLength,
                settings.SecondaryTrayLength ?? 0m, settings.AdditionalBendingPercent);
        }
        return new
        {
            schemaVersion = "pathfinder.model.response.v1", request.RequestId, status,
            message = status == "settings_required" ? "Project Details SECONDARY length is required."
                : request.Operation == "lookup" && routeResult.Success ? "Ordered lookup calculated without equipment approaches or full cable design allowances." : routeResult.Message,
            snapshot.Model, prepared = summary, effectiveCategory = request.Operation == "lookup" ? null : category.ToString(),
            route = routeResult, design = resultDesign, projectSettings = settings,
            engineeringAccepted = false, lookupScope,
            usedConnectionGapMeters = request.Operation == "lookup" ? options.ConnectionToleranceMeters : (double?)null
        };
    }

    private static void Validate(Request r)
    {
        if (r.SchemaVersion != "pathfinder.model.runner.v1" || !Guid.TryParseExact(r.RequestId, "D", out _) ||
            !Guid.TryParseExact(r.ProjectId, "D", out _) || !Guid.TryParseExact(r.ModelVersionId, "D", out _) ||
            r.Operation is not ("prepare" or "calculate" or "design" or "lookup" or "lookup-plan") || r.TimeoutMilliseconds is < 1 or > 120000)
            throw new ArgumentException("Unknown schema, operation, identity, hash or deadline.");
        if (r.Operation == "lookup-plan")
        {
            if (r.SnapshotId is not null || r.SnapshotSha256 is not null || r.Options is not null || r.ProjectSettings is not null
                || r.Rules is not null || r.Category is not null || r.From is not null || r.To is not null || r.Route is not null || r.Reverse)
                throw new ArgumentException("Lookup planning only accepts model identity, route text and its bounded deadline.");
        }
        else if (!Guid.TryParseExact(r.SnapshotId, "D", out _) || r.SnapshotSha256 is null || !Regex.IsMatch(r.SnapshotSha256, "^[a-f0-9]{64}$"))
            throw new ArgumentException("Immutable snapshot identity and hash are required.");
        if (r.Reverse && r.Operation is not ("calculate" or "lookup")) throw new ArgumentException("Reverse applies only to calculated paths or ordered lookup.");
        if (r.Operation == "lookup-plan") _ = LookupScopeResolver.Plan(r.RouteText!);
        else if (r.Operation == "lookup")
        {
            // Existing planning-artifact lookup keeps its original text contract.
            // The stricter per-code capture ceiling is checked only by lookup-plan
            // and the dedicated captured-scope resolver.
            if (string.IsNullOrWhiteSpace(r.RouteText) || r.RouteText.Length > 8000 || RouteLookupCalculator.Parse(r.RouteText).Count > 100)
                throw new ArgumentException("Ordered lookup requires 1 to 100 route codes in at most 8000 characters.");
        }
        else if (r.RouteText is not null) throw new ArgumentException("Route text applies only to ordered lookup.");
        if (r.ProjectSettings is { } s && (s.Revision is null || s.Revision.Length is < 1 or > 256 || s.EndConnectionLength < 0 ||
            s.SecondaryTrayLength < 0 || s.AdditionalBendingPercent < 0)) throw new ArgumentException("Invalid Project Details settings.");
        if (r.Options is { } o && (!double.IsFinite(o.ConnectionToleranceMeters) || o.ConnectionToleranceMeters is < 0 or > 100 ||
            !double.IsFinite(o.SampleSpacingMeters) || o.SampleSpacingMeters is <= 0 or > 100 ||
            !double.IsFinite(o.SecondaryDistanceMeters) || o.SecondaryDistanceMeters is < 0 or > 1000000 ||
            o.MaxGraphNodes is < 1 or > 1000000 || o.MaxGraphConnections is < 1 or > 4000000))
            throw new ArgumentException("Routing options exceed finite resource bounds.");
    }
    private static bool IsCoreResourceLimit(string message) => message.Contains("routing-node limit", StringComparison.Ordinal)
        || message.Contains("routing-connection limit", StringComparison.Ordinal) || message.Contains("routing-candidate limit", StringComparison.Ordinal);
    private static RoutePoint Point(PointInput? point)
    {
        if (point is null || !new[] { point.X, point.Y, point.Z }.All(v => double.IsFinite(v) && Math.Abs(v) <= 1e9))
            throw new ArgumentException("A finite canonical world-metre point is required.");
        return new RoutePoint(point.X, point.Y, point.Z);
    }
    private static string OwnedRoot()
    {
        var value = Environment.GetEnvironmentVariable("PF_ROOT");
        if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value)) throw new ArgumentException("Explicit absolute PF_ROOT is required.");
        var root = Path.GetFullPath(value);
        if (!Directory.Exists(root) || (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("PF_ROOT must be an owned regular directory.");
        return root;
    }
    private static string SafeChild(string directory, string name, bool create)
    {
        var target = Path.GetFullPath(Path.Combine(directory, name));
        if (!target.StartsWith(directory.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new ArgumentException("Owned path rejected.");
        if (create) Directory.CreateDirectory(target);
        if ((File.Exists(target) || Directory.Exists(target)) && (File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0)
            throw new ArgumentException("Artifact/cache path cannot be a link.");
        return target;
    }
    private static object Failure(Request? r, string status, string message) => new
    { schemaVersion = "pathfinder.model.response.v1", requestId = r?.RequestId, status, message, engineeringAccepted = false };
    private static async Task<int> Emit(object value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, Json);
        if (bytes.Length > MaximumOutput) bytes = JsonSerializer.SerializeToUtf8Bytes(Failure(null, "resource_limit", "Output exceeds the byte budget."), Json);
        await Console.OpenStandardOutput().WriteAsync(bytes); Console.WriteLine();
        return 0; // Callers must inspect the closed status field, not infer success from process exit.
    }
    private static async Task<int> Supervise(byte[] input, Request request)
    {
        var info = new ProcessStartInfo(Environment.ProcessPath ?? throw new InvalidOperationException("Process path unavailable."))
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        if (Path.GetFileNameWithoutExtension(info.FileName).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) info.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        info.ArgumentList.Add("--worker");
        using var process = Process.Start(info) ?? throw new InvalidOperationException("Worker could not start.");
        using var deadline = new CancellationTokenSource(request.TimeoutMilliseconds);
        try
        {
            var stdout = ReadBounded(process.StandardOutput.BaseStream, MaximumOutput, deadline.Token);
            var stderr = ReadBounded(process.StandardError.BaseStream, 65536, deadline.Token);
            await process.StandardInput.BaseStream.WriteAsync(input, deadline.Token); process.StandardInput.Close();
            await process.WaitForExitAsync(deadline.Token);
            var result = await stdout; _ = await stderr;
            if (process.ExitCode != 0 || result.Length == 0) throw new InvalidOperationException("Worker failed without a valid result.");
            using var parsed = JsonDocument.Parse(result);
            if (parsed.RootElement.GetProperty("schemaVersion").GetString() != "pathfinder.model.response.v1") throw new InvalidOperationException("Worker response schema mismatch.");
            await Console.OpenStandardOutput().WriteAsync(result); return 0;
        }
        finally
        {
            if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); }
        }
    }
    private static async Task<byte[]> ReadBounded(Stream input, int maximum, CancellationToken token)
    {
        using (input)
        using (var memory = new MemoryStream())
        {
            var buffer = new byte[65536]; int count;
            while ((count = await input.ReadAsync(buffer.AsMemory(), token)) > 0)
            { if (memory.Length + count > maximum) throw new ArgumentException("Input or output exceeds the byte budget."); await memory.WriteAsync(buffer.AsMemory(0, count), token); }
            return memory.ToArray();
        }
    }
    private static void RejectDuplicates(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            { if (!seen.Add(property.Name)) throw new ArgumentException("Duplicate JSON member."); RejectDuplicates(property.Value); }
        }
        else if (element.ValueKind == JsonValueKind.Array) foreach (var child in element.EnumerateArray()) RejectDuplicates(child);
    }
}

internal sealed record Request
{
    public required string SchemaVersion { get; init; }
    public required string RequestId { get; init; }
    public required string Operation { get; init; }
    public required string ProjectId { get; init; }
    public required string ModelVersionId { get; init; }
    public string? SnapshotId { get; init; }
    public string? SnapshotSha256 { get; init; }
    public required int TimeoutMilliseconds { get; init; }
    public string? Category { get; init; }
    public PointInput? From { get; init; }
    public PointInput? To { get; init; }
    public EngineOptions? Options { get; init; }
    public ProjectSettingsSnapshot? ProjectSettings { get; init; }
    public ModelBuildRules? Rules { get; init; }
    public RetainedRoute? Route { get; init; }
    public string? RouteText { get; init; }
    public bool Reverse { get; init; }
}
internal sealed record RetainedRoute
{
    public required bool Success { get; init; }
    public required double LengthMeters { get; init; }
    public required double FromDistanceMeters { get; init; }
    public required double ToDistanceMeters { get; init; }
    public required bool FromRequiresSecondary { get; init; }
    public required bool ToRequiresSecondary { get; init; }
}
