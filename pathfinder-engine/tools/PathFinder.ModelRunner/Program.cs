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
            return await Emit(WorkerCalculation(request, () => Execute(request, deadline.Token)));
        }
        catch (OperationCanceledException) { return await Emit(Failure(request, "deadline_exceeded", "Calculation deadline exceeded.")); }
        catch (OutOfMemoryException) { return await Emit(Failure(request, "resource_limit", WorkerMemoryPolicy.RefusalMessage)); }
        catch (SessionBudgetException error) { return await Emit(Failure(request, "resource_limit", error.Message)); }
        catch (Exception error) when (error is ArgumentException or JsonException or IOException or InvalidDataException or InvalidOperationException or OverflowException or FormatException or KeyNotFoundException or System.ComponentModel.Win32Exception)
        { return await Emit(Failure(request, "invalid_request", error is IOException ? "An owned input or cache file could not be read." : error.Message)); }
    }

    // The same managed-allocation refusal boundary is used by both launch modes.
    // If refusal serialization itself cannot allocate, process/protocol failure
    // remains fail-closed; no partial response is promoted to a calculation.
    internal static object WorkerCalculation(Request request, Func<object> calculation, SessionExecutionContext? session = null)
    {
        try { return calculation(); }
        catch (OutOfMemoryException)
        {
            session?.Discard();
            return Failure(request, "resource_limit", WorkerMemoryPolicy.RefusalMessage);
        }
    }

    internal static ProcessStartInfo WorkerStartInfo(string mode)
    {
        if (mode is not ("--worker" or "--session-worker")) throw new ArgumentException("Unknown worker launch mode.");
        var info = new ProcessStartInfo(Environment.ProcessPath ?? throw new InvalidOperationException("Process path unavailable."))
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        if (Path.GetFileNameWithoutExtension(info.FileName).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) info.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        info.ArgumentList.Add(mode);
        WorkerMemoryPolicy.Configure(info);
        return info;
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
            if (request.DirectSecondaryPolicy is not null)
            {
                var effectiveCategory = request.Category == "Instrumentation" ? "Control" : request.Category;
                var decision = route.DirectSecondary ?? throw new ArgumentException("A retained opted-in route requires its exact direct SECONDARY decision.");
                decision.Validate();
                if (decision.Mode == "direct-secondary")
                {
                    if (route.LengthMeters != decision.DistanceMeters || route.FromDistanceMeters != 0 || route.ToDistanceMeters != 0 || route.FromRequiresSecondary || route.ToRequiresSecondary)
                        throw new ArgumentException("Retained direct SECONDARY metrics do not match their decision.");
                    var observed = DirectSecondaryLengthObserver.Calculate(decision, settings, token);
                    if (request.IncludeLengthLedger) return new { schemaVersion = "pathfinder.model.response.v2", request.RequestId, status = "calculated",
                        message = "Direct SECONDARY design allowances recalculated from retained geometry.", effectiveCategory, design = observed.Design, lengthLedger = observed.Ledger, directSecondary = decision, engineeringAccepted = false };
                    return new { schemaVersion = "pathfinder.model.response.v2", request.RequestId, status = "calculated",
                        message = "Direct SECONDARY design allowances recalculated from retained geometry.", effectiveCategory, design = observed.Design, directSecondary = decision, engineeringAccepted = false };
                }
                if ((route.FromRequiresSecondary || route.ToRequiresSecondary) && settings.SecondaryTrayLength is null)
                    return Failure(request, "settings_required", "Project Details SECONDARY length is required.");
                if (request.IncludeLengthLedger)
                {
                    var observed = LengthLedgerObserver.CalculateRetained(route.LengthMeters, route.FromDistanceMeters, route.ToDistanceMeters, route.FromRequiresSecondary, route.ToRequiresSecondary, settings, token);
                    return new { schemaVersion = "pathfinder.model.response.v2", request.RequestId, status = "calculated", message = "Design allowances recalculated from retained geometry.",
                        effectiveCategory, design = observed.Design, lengthLedger = observed.Ledger, directSecondary = decision, engineeringAccepted = false };
                }
                var retainedDesign = SavedRouteDesign.Calculate(route.LengthMeters, route.FromDistanceMeters, route.ToDistanceMeters, route.FromRequiresSecondary, route.ToRequiresSecondary,
                    settings.EndConnectionLength, settings.SecondaryTrayLength ?? 0m, settings.AdditionalBendingPercent);
                token.ThrowIfCancellationRequested();
                return new { schemaVersion = "pathfinder.model.response.v2", request.RequestId, status = "calculated", message = "Design allowances recalculated from retained geometry.",
                    effectiveCategory, design = retainedDesign, directSecondary = decision, engineeringAccepted = false };
            }
            if ((route.FromRequiresSecondary || route.ToRequiresSecondary) && settings.SecondaryTrayLength is null)
                return Failure(request, "settings_required", "Project Details SECONDARY length is required.");
            if (request.IncludeLengthLedger)
            {
                var observed = LengthLedgerObserver.CalculateRetained(route.LengthMeters, route.FromDistanceMeters,
                    route.ToDistanceMeters, route.FromRequiresSecondary, route.ToRequiresSecondary, settings, token);
                return new { schemaVersion = "pathfinder.model.response.v1", request.RequestId, status = "calculated", message = "Design allowances recalculated from retained geometry.",
                    design = observed.Design, lengthLedger = observed.Ledger, engineeringAccepted = false };
            }
            var design = SavedRouteDesign.Calculate(route.LengthMeters, route.FromDistanceMeters,
                route.ToDistanceMeters, route.FromRequiresSecondary, route.ToRequiresSecondary,
                settings.EndConnectionLength, settings.SecondaryTrayLength ?? 0m, settings.AdditionalBendingPercent);
            token.ThrowIfCancellationRequested();
            return new { schemaVersion = "pathfinder.model.response.v1", request.RequestId, status = "calculated", message = "Design allowances recalculated from retained geometry.", design, engineeringAccepted = false };
        }

        var root = OwnedRoot();
        if (request.SchemaVersion == "pathfinder.model.runner.v2") session?.SelectBarrierKey(BarrierHash(BarrierContext(request).Value));
        var snapshots = SafeChild(root, "snapshots", create: false);
        var input = SafeChild(snapshots, request.SnapshotId + ".json", create: false);
        var cacheRoot = SafeChild(root, "cache", create: true);
        var execution = PrepareSnapshot(input, cacheRoot, request, token, session);
        var prepared = execution.Prepared; var model = execution.Model; var lookupScope = execution.LookupScope;
        var summary = new
        {
            prepared.Key, prepared.Readiness, prepared.Counts, prepared.CacheScope, prepared.LoadedFromDisk,
            objectCount = prepared.Objects.Count, segmentCount = prepared.Segments.Count,
            diagnosticCount = prepared.Diagnostics.Count,
            diagnostics = prepared.Diagnostics.Take(2048).ToArray(), diagnosticsTruncated = prepared.Diagnostics.Count > 2048,
            engineeringAccepted = false
        };
        if (request.Operation == "prepare")
        {
            if (request.FittedTraceExport is { } exportRequest)
            {
                var trace = FittedTraceExporter.Export(root, prepared, exportRequest, token);
                return new
                {
                    schemaVersion = "pathfinder.model.response.v1", request.RequestId, status = "prepared",
                    message = "Fitted computational artifact prepared; engineering acceptance is a separate gate.",
                    Model = model,
                    prepared = new { prepared.Key, prepared.Readiness, prepared.Counts, prepared.CacheScope, prepared.LoadedFromDisk,
                        objectCount = prepared.Objects.Count, segmentCount = prepared.Segments.Count,
                        diagnosticCount = prepared.Diagnostics.Count, diagnostics = prepared.Diagnostics.Take(2048).ToArray(),
                        diagnosticsTruncated = prepared.Diagnostics.Count > 2048, engineeringAccepted = false, traceExport = trace },
                    engineeringAccepted = false
                };
            }
            return new
            {
                schemaVersion = "pathfinder.model.response.v1", request.RequestId, status = "prepared",
                message = "Fitted computational artifact prepared; engineering acceptance is a separate gate.",
                Model = model, prepared = summary, engineeringAccepted = false
            };
        }
        var category = request.Category switch
        {
            "MV" => CableCategory.MV, "LV" => CableCategory.LV,
            "Control" or "Instrumentation" => CableCategory.Control, _ => CableCategory.None
        };
        if (request.Operation == "calculate" && category == CableCategory.None) return Failure(request, "category_required", "Resolve the cable category before calculation.");
        if (request.Operation == "calculate" && execution.RequiresCategoryAssignment)
            return Failure(request, "model_needs_review", "Assign explicit planning categories to the selected routing geometry.");
        var options = request.Options ?? throw new ArgumentException("Explicit routing options are required.");
        var routeOptions = new RoutingOptions
        {
            ConnectionToleranceMeters = options.ConnectionToleranceMeters, SampleSpacingMeters = options.SampleSpacingMeters,
            SecondaryDistanceMeters = options.SecondaryDistanceMeters, PreferVerticalApproach = options.PreferVerticalApproach,
            MaxGraphNodes = options.MaxGraphNodes, MaxGraphConnections = options.MaxGraphConnections
        };
        PreparationMemoryTrace.Observe(PreparationMemoryPhase.BeforeQuery);
        if (request.SchemaVersion == "pathfinder.model.runner.v2")
            return ExecuteBarrierRoute(request, root, model, prepared, summary, routeOptions, token, session);
        DirectSecondaryDecision? directSecondary = null;
        RouteResult routeResult;
        if (request.Operation == "calculate" && request.DirectSecondaryPolicy is not null)
        {
            var evaluated = DirectSecondaryRoute.Evaluate(prepared.Segments, Point(request.From), Point(request.To), category, routeOptions, token);
            directSecondary = DirectSecondaryDecision.Capture(evaluated);
            routeResult = evaluated.IsDirect ? evaluated.DirectRoute : new RouteCalculator().Calculate(prepared.Segments, Point(request.From), Point(request.To), category, routeOptions, token);
        }
        else routeResult = request.Operation == "lookup"
            ? RouteLookupCalculator.Calculate(prepared.Segments, RouteLookupCalculator.Parse(request.RouteText), routeOptions, token)
            : new RouteCalculator().Calculate(prepared.Segments, Point(request.From), Point(request.To), category, routeOptions, token);
        token.ThrowIfCancellationRequested();
        if (request.Reverse)
        {
            directSecondary = directSecondary?.Reverse();
            // A binary64 zero-length direct line retains one exact From point.
            // Recreate that point after reversing even when tiny deltas underflow.
            routeResult = directSecondary?.Mode == "direct-secondary" ? directSecondary.DirectRoute() : routeResult.Reverse();
        }
        CableDesignLength? resultDesign = null;
        object? lengthLedger = null;
        var status = routeResult.Success ? "calculated" : IsCoreResourceLimit(routeResult.Message) ? "resource_limit" : "no_path";
        if (routeResult.Success && request.Operation == "calculate")
        {
            if (settings is null) throw new ArgumentException("Project Details settings are required.");
            if (directSecondary?.Mode == "direct-secondary")
            {
                if (request.IncludeLengthLedger)
                {
                    var observed = DirectSecondaryLengthObserver.Calculate(directSecondary, settings, token);
                    resultDesign = observed.Design; lengthLedger = observed.Ledger;
                }
                else resultDesign = CableDesignLength.Calculate(routeResult, settings.EndConnectionLength, 0m, settings.AdditionalBendingPercent);
            }
            else if ((routeResult.FromRequiresSecondary || routeResult.ToRequiresSecondary) && settings.SecondaryTrayLength is null)
                status = "settings_required";
            else if (request.IncludeLengthLedger)
            {
                var observed = LengthLedgerObserver.Calculate(routeResult, settings, token);
                resultDesign = observed.Design; lengthLedger = observed.Ledger;
            }
            else resultDesign = CableDesignLength.Calculate(routeResult, settings.EndConnectionLength,
                settings.SecondaryTrayLength ?? 0m, settings.AdditionalBendingPercent);
        }
        if (directSecondary is not null)
        {
            // Only an executed route result has the v2 strategy transport.
            // Operational/settings failures retain the established v1 failure boundary.
            if (status is not ("calculated" or "no_path"))
                return Failure(request, status, status == "settings_required" ? "Project Details SECONDARY length is required." : routeResult.Message);
            if (lengthLedger is not null) return new
            {
                schemaVersion = "pathfinder.model.response.v2", request.RequestId, status, message = routeResult.Message,
                Model = model, prepared = summary, effectiveCategory = category.ToString(), route = routeResult, design = resultDesign,
                projectSettings = settings, engineeringAccepted = false, lookupScope, usedConnectionGapMeters = (double?)null, lengthLedger, directSecondary
            };
            return new
            {
                schemaVersion = "pathfinder.model.response.v2", request.RequestId, status,
                message = status == "settings_required" ? "Project Details SECONDARY length is required." : routeResult.Message,
                Model = model, prepared = summary, effectiveCategory = category.ToString(), route = routeResult, design = resultDesign,
                projectSettings = settings, engineeringAccepted = false, lookupScope, usedConnectionGapMeters = (double?)null, directSecondary
            };
        }
        if (lengthLedger is not null) return new
        {
            schemaVersion = "pathfinder.model.response.v1", request.RequestId, status,
            message = routeResult.Message,
            Model = model, prepared = summary, effectiveCategory = category.ToString(),
            route = routeResult, design = resultDesign, projectSettings = settings,
            engineeringAccepted = false, lookupScope,
            usedConnectionGapMeters = (double?)null, lengthLedger
        };
        return new
        {
            schemaVersion = "pathfinder.model.response.v1", request.RequestId, status,
            message = status == "settings_required" ? "Project Details SECONDARY length is required."
                : request.Operation == "lookup" && routeResult.Success ? "Ordered lookup calculated without equipment approaches or full cable design allowances." : routeResult.Message,
            Model = model, prepared = summary, effectiveCategory = request.Operation == "lookup" ? null : category.ToString(),
            route = routeResult, design = resultDesign, projectSettings = settings,
            engineeringAccepted = false, lookupScope,
            usedConnectionGapMeters = request.Operation == "lookup" ? options.ConnectionToleranceMeters : (double?)null
        };
    }

    // Scope both the private source buffer and checked DTO to preparation. The
    // returned execution contains exact fitted geometry and small source guards,
    // never the large deserialized snapshot or a previously calculated route.
    private static PreparedExecution PrepareSnapshot(string input, string cacheRoot, Request request,
        CancellationToken token, SessionExecutionContext? session)
    {
        // Expected identity may evict old geometry before allocating new bytes;
        // it can never authorize reuse without the following exact file hash.
        session?.SelectPlanningSource(cacheRoot, request.SnapshotSha256!, request.Rules, token);
        var reader = new FittedModelCache(cacheRoot, observer: PreparationMemoryTrace.Observer);
        using var source = reader.ReadSourceFile(input, request.SnapshotSha256!, token);
        if (session is not null && session.TryReusePlanning(cacheRoot, source.Sha256, request.ProjectId, request.ModelVersionId,
            request.Rules, token, out var retained))
        { source.Dispose(); PreparationMemoryTrace.Observe(PreparationMemoryPhase.RawDisposed); return retained!; }
        var checkedSnapshot = reader.ReadCheckedSnapshot(source, request.ProjectId, request.ModelVersionId, token);
        // Strict checked DTO/hash metadata is detached from the original bytes.
        // Do not overlap the large source buffer with physical mesh fitting.
        source.Dispose();
        PreparationMemoryTrace.Observe(PreparationMemoryPhase.RawDisposed);
        if (checkedSnapshot.IndependentLookup)
        {
            if (request.Operation != "lookup") throw new ArgumentException("Independent lookup geometry cannot be used for planning preparation or cable calculation.");
            checkedSnapshot = checkedSnapshot.ResolveLookup(request.RouteText!, token);
        }
        // Explicit transfer empties the checked token and returns from all
        // DTO-to-mesh conversion frames before fitting allocates its working set.
        var detachedInput = reader.TransferForExecution(checkedSnapshot, request.Rules, token);
        PreparationMemoryTrace.Observe(PreparationMemoryPhase.SnapshotTransferred);
        return session is null ? reader.GetOrBuildExecution(detachedInput, token)
            : session.Prepare(cacheRoot, detachedInput, token);
    }

    private static void Validate(Request r)
    {
        if (r.SchemaVersion is not ("pathfinder.model.runner.v1" or "pathfinder.model.runner.v2") || !Guid.TryParseExact(r.RequestId, "D", out _) ||
            !Guid.TryParseExact(r.ProjectId, "D", out _) || !Guid.TryParseExact(r.ModelVersionId, "D", out _) ||
            r.Operation is not ("prepare" or "calculate" or "design" or "lookup" or "lookup-plan") || r.TimeoutMilliseconds is < 1 or > 120000)
            throw new ArgumentException("Unknown schema, operation, identity, hash or deadline.");
        if (r.SchemaVersion == "pathfinder.model.runner.v2")
        {
            if (r.Operation != "calculate" || r.Category is not ("LV" or "Control" or "Instrumentation") || r.ProjectSettings is null
                || r.Options is null || r.Route is not null || r.FittedTraceExport is not null)
                throw new ArgumentException("Protected runtime v2 accepts only a fresh supported non-MV calculation; design-only reuse is unavailable.");
            _ = Point(r.From); _ = Point(r.To); _ = BarrierContext(r);
        }
        else if (r.Barriers is not null) throw new ArgumentException("Barrier contexts require protected runtime v2; legacy fallback is prohibited.");
        if (r.IncludeLengthLedger && r.Operation is not ("calculate" or "design"))
            throw new ArgumentException("Length-component ledgers apply only to calculate and design operations.");
        if (r.DirectSecondaryPolicy is not null && (r.DirectSecondaryPolicy != DirectSecondaryRoute.PolicyVersion || r.Operation is not ("calculate" or "design")
            || r.Category is not ("LV" or "Control" or "Instrumentation"))) throw new ArgumentException("Direct SECONDARY requires the explicit supported policy and a non-MV calculation category.");
        if (r.Route?.DirectSecondary is not null && (r.Operation != "design" || r.DirectSecondaryPolicy is null)) throw new ArgumentException("A retained direct decision requires its opted-in design operation.");
        if (r.Operation == "lookup-plan")
        {
            if (r.SnapshotId is not null || r.SnapshotSha256 is not null || r.Options is not null || r.ProjectSettings is not null
                || r.Rules is not null || r.Category is not null || r.From is not null || r.To is not null || r.Route is not null || r.Reverse)
                throw new ArgumentException("Lookup planning only accepts model identity, route text and its bounded deadline.");
        }
        else if (!Guid.TryParseExact(r.SnapshotId, "D", out _) || r.SnapshotSha256 is null || !Regex.IsMatch(r.SnapshotSha256, "^[a-f0-9]{64}$"))
            throw new ArgumentException("Immutable snapshot identity and hash are required.");
        if (r.Reverse && r.Operation is not ("calculate" or "lookup")) throw new ArgumentException("Reverse applies only to calculated paths or ordered lookup.");
        if (r.FittedTraceExport is { } export)
        {
            if (r.Operation != "prepare") throw new ArgumentException("Fitted trace export only applies to preparation.");
            FittedTraceExporter.Validate(export);
        }
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
    private static object Failure(Request? r, string status, string message)
    {
        if (r?.SchemaVersion == "pathfinder.model.runner.v2")
        {
            try { return BarrierFailure(r, BarrierContext(r), status, status switch { "deadline_exceeded" => "RUNTIME_DEADLINE_EXCEEDED",
                "resource_limit" => "RUNTIME_RESOURCE_LIMIT", _ => "RUNTIME_CONTEXT_UNAVAILABLE" }, message); }
            catch (Exception error) when (error is ArgumentException or JsonException or IOException or InvalidDataException or InvalidOperationException or KeyNotFoundException or FormatException) { }
        }
        return new { schemaVersion = "pathfinder.model.response.v1", requestId = r?.RequestId, status, message, engineeringAccepted = false };
    }
    private static async Task<int> Emit(object value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, Json);
        if (bytes.Length > MaximumOutput) bytes = JsonSerializer.SerializeToUtf8Bytes(Failure(null, "resource_limit", "Output exceeds the byte budget."), Json);
        await Console.OpenStandardOutput().WriteAsync(bytes); Console.WriteLine();
        return 0; // Callers must inspect the closed status field, not infer success from process exit.
    }
    private static async Task<int> Supervise(byte[] input, Request request)
    {
        var info = WorkerStartInfo("--worker");
        using var process = Process.Start(info) ?? throw new InvalidOperationException("Worker could not start.");
        using var deadline = new CancellationTokenSource(request.TimeoutMilliseconds);
        using var guardStop = new CancellationTokenSource();
        var memoryFault = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var memoryGuard = SessionMemory(process, memoryFault, guardStop.Token);
        Task<byte[]>? stdout = null, stderr = null;
        var ownedInput = process.StandardInput.BaseStream;
        var ownedOutput = process.StandardOutput.BaseStream;
        var ownedError = process.StandardError.BaseStream;
        try
        {
            stdout = ReadBounded(ownedOutput, MaximumOutput, deadline.Token);
            stderr = ReadBounded(ownedError, 65536, deadline.Token);
            await ownedInput.WriteAsync(input, deadline.Token); process.StandardInput.Close();
            var exited = process.WaitForExitAsync(deadline.Token);
            if (await Task.WhenAny(exited, memoryFault.Task).WaitAsync(deadline.Token) == memoryFault.Task)
                throw new SessionBudgetException(await memoryFault.Task);
            await exited;
            var result = await stdout; _ = await stderr;
            if (process.ExitCode != 0 || result.Length == 0) throw new InvalidOperationException("Worker failed without a valid result.");
            using var parsed = JsonDocument.Parse(result);
            ValidateResponseVersion(parsed.RootElement, request);
            await Console.OpenStandardOutput().WriteAsync(result); return 0;
        }
        finally
        {
            try
            {
                if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); }
            }
            finally
            {
                // Kill/reap precedes I/O retirement. Observe both bounded readers
                // even after a deadline, RSS fault, oversized pipe or failed
                // stdin write; no unobserved task survives normal supervision.
                guardStop.Cancel(); deadline.Cancel();
                foreach (var pipe in new[] { ownedInput, ownedOutput, ownedError })
                    try { pipe.Dispose(); } catch (Exception error) when (error is IOException or ObjectDisposedException) { }
                var joined = Task.WhenAll(stdout ?? Task.FromResult(Array.Empty<byte>()), stderr ?? Task.FromResult(Array.Empty<byte>()));
                try
                {
                    try { await joined.WaitAsync(TimeSpan.FromMilliseconds(SessionProtocol.StartupMilliseconds)); }
                    catch (TimeoutException)
                    {
                        _ = joined.ContinueWith(task => { _ = task.Exception; }, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);
                        throw new SessionBudgetException("Worker output reader retirement could not be confirmed.");
                    }
                    catch (Exception) when (joined.IsCompleted) { _ = joined.Exception; }
                }
                finally { await memoryGuard; }
            }
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
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool IncludeLengthLedger { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DirectSecondaryPolicy { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public FittedTraceExportRequest? FittedTraceExport { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonElement? Barriers { get; init; }
}
internal sealed record RetainedRoute
{
    public required bool Success { get; init; }
    public required double LengthMeters { get; init; }
    public required double FromDistanceMeters { get; init; }
    public required double ToDistanceMeters { get; init; }
    public required bool FromRequiresSecondary { get; init; }
    public required bool ToRequiresSecondary { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public DirectSecondaryDecision? DirectSecondary { get; init; }
}
