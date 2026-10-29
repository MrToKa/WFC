using System.Collections.ObjectModel;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using AddinRibbon.Routing;

namespace PathFinder.Model;

/// <summary>Versioned fitted geometry cache. RouteCalculator still constructs its graph per call.</summary>
public sealed class FittedModelCache
{
    // Pinned native RoutingSession.FindShapeName; the selected root bounds its search.
    private static readonly Regex SelectedShapeName = new(@"(?<![A-Za-z0-9])(?:BEND|ELBOW|FTUBE|TUBE|STRAIGHT)(?![A-Za-z0-9])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    public const string EngineVersion = "45c24bf5f433f13e102600b36f20327c77961d0a";
    public const string MeasuredBendRulesVersion = "pf2.rules.v2";
    public const string MeasuredBendPolicyVersion = "wfc.pf.measured-bend-mesh-fitting.v2";
    private readonly string root;
    private readonly ModelLimits limits;
    private readonly Action<PreparationMemoryPhase>? observer;
    private readonly object gate = new();
    private readonly Dictionary<string, PreparedModel> memory = new(StringComparer.Ordinal);
    private readonly Queue<string> order = new();

    public FittedModelCache(string ownedCacheDirectory, ModelLimits? limits = null, Action<PreparationMemoryPhase>? observer = null)
    {
        this.limits = limits ?? new();
        this.observer = observer;
        if (this.limits.MaximumCachedModels < 1 || this.limits.MaximumBytes < 1024) throw new ArgumentException("Invalid cache resource limits.");
        root = Path.GetFullPath(ownedCacheDirectory);
        Directory.CreateDirectory(root);
        if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("Cache root cannot be a reparse point.");
    }

    private void Observe(PreparationMemoryPhase phase)
    {
        try { observer?.Invoke(phase); } catch { /* Optional diagnostics never alter calculation or validation. */ }
    }

    public PreparedModel GetOrBuild(ReadOnlyMemory<byte> snapshotJson, ModelBuildRules? rules = null, CancellationToken cancellation = default)
    {
        cancellation.ThrowIfCancellationRequested();
        if (snapshotJson.Length == 0 || snapshotJson.Length > limits.MaximumBytes) throw new ArgumentException("Snapshot byte budget exceeded.");
        // This legacy public API accepts caller-owned memory. Detach before hash
        // and validation so it cannot populate a fitted entry under other bytes.
        var owned = new byte[snapshotJson.Length];
        for (var offset = 0; offset < owned.Length; offset += 65536)
        { cancellation.ThrowIfCancellationRequested(); snapshotJson.Span.Slice(offset, Math.Min(65536, owned.Length - offset)).CopyTo(owned.AsSpan(offset)); }
        var sha256 = SnapshotReader.Sha256(owned);
        Observe(PreparationMemoryPhase.BeforeStrictParse);
        var snapshot = SnapshotReader.ReadWithPhases(owned, limits, cancellation, observer);
        Observe(PreparationMemoryPhase.StrictParse);
        var checkedInput = new CheckedModelSnapshot(snapshot, sha256, sha256, limits, false);
        return GetOrBuildChecked(checkedInput, rules, cancellation);
    }

    /// <summary>Read one exact regular source file into one private buffer. File
    /// bytes are never returned to a caller and no claimed SHA authorizes them.</summary>
    public VerifiedSnapshotSource ReadSourceFile(string filename, string expectedSha256, CancellationToken cancellation = default)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!Path.IsPathFullyQualified(filename)) throw new ArgumentException("An absolute snapshot path is required.");
        var before = new FileInfo(filename); before.Refresh();
        if (!before.Exists || (before.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0
            || before.Length < 1 || before.Length > limits.MaximumBytes) throw new ArgumentException("Snapshot is missing or exceeds the byte budget.");
        long length = before.Length; var written = before.LastWriteTimeUtc; var created = before.CreationTimeUtc;
        using var input = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.SequentialScan);
        if (input.Length != length) throw new IOException("Snapshot changed before reading.");
        var bytes = new byte[checked((int)length)];
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        for (var offset = 0; offset < bytes.Length;)
        {
            cancellation.ThrowIfCancellationRequested();
            int count = input.Read(bytes.AsSpan(offset, Math.Min(65536, bytes.Length - offset)));
            if (count == 0) throw new IOException("Snapshot was truncated while reading.");
            hash.AppendData(bytes, offset, count); offset += count;
        }
        cancellation.ThrowIfCancellationRequested();
        if (input.ReadByte() != -1 || input.Length != length) throw new IOException("Snapshot grew while reading.");
        var after = new FileInfo(filename); after.Refresh();
        if (!after.Exists || (after.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0
            || after.Length != length || after.LastWriteTimeUtc != written || after.CreationTimeUtc != created) throw new IOException("Snapshot file changed while reading.");
        var sha256 = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
        if (sha256 != expectedSha256) throw new ArgumentException("Snapshot hash does not match the immutable artifact.");
        cancellation.ThrowIfCancellationRequested(); Observe(PreparationMemoryPhase.SourceRead); return new(bytes, sha256, limits);
    }

    public CheckedModelSnapshot ReadCheckedSnapshot(VerifiedSnapshotSource source, string projectId, string modelVersionId,
        CancellationToken cancellation = default)
    {
        cancellation.ThrowIfCancellationRequested();
        if (source.Limits != limits) throw new ArgumentException("Snapshot validation limits differ from the fitted cache.");
        Observe(PreparationMemoryPhase.BeforeStrictParse);
        var snapshot = SnapshotReader.ReadWithPhases(source.Bytes, limits, cancellation, observer);
        if (snapshot.Model.ProjectId != projectId || snapshot.Model.ModelVersionId != modelVersionId)
            throw new ArgumentException("Snapshot project/model identity mismatch.");
        Observe(PreparationMemoryPhase.StrictParse);
        return new(snapshot, source.Sha256, source.Sha256, limits, snapshot.Capture.LookupRouteCodes is not null);
    }

    public PreparedExecution GetOrBuildExecution(CheckedModelSnapshot source, ModelBuildRules? rules = null, CancellationToken cancellation = default)
    {
        // Reusable compatibility path. Only the explicitly named transfer below
        // consumes a token; callers retaining this token retain its checked DTO.
        var normalized = NormalizeRules(source, rules, cancellation, out var rulesContextSha256);
        var snapshot = source.Snapshot;
        ValidateExecutionScope(snapshot, normalized, cancellation);
        var identity = CacheIdentity(source.Sha256, normalized, cancellation);
        while (!Monitor.TryEnter(gate, 50)) cancellation.ThrowIfCancellationRequested();
        try
        {
            cancellation.ThrowIfCancellationRequested();
            if (memory.TryGetValue(identity.Key, out var retained))
            {
                var included = retained.Objects.Where(item => item.GeometryRole == "routing-leaf" && item.Visibility is not ("hidden" or "excluded"))
                    .Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
                bool required = snapshot.Objects.Any(item => included.Contains(item.Id)
                    && (item.CategoryAssignmentSource == "unassigned" || item.AllowedCategories.Length == 0));
                return new(retained, snapshot.Model, source.SourceSha256, source.IndependentLookup, required, source.Scope);
            }
        }
        finally { Monitor.Exit(gate); }
        return GetOrBuildExecution(ExecutionInput(source, snapshot, normalized, rulesContextSha256, cancellation), cancellation);
    }

    /// <summary>Explicitly consume one checked token and detach its exact Core
    /// mesh plus compact metadata before fitting. Limits/rules/lookup/exclusion
    /// validation and cancellation before the atomic take leave the token valid.
    /// Once taken, any later failure/cancellation leaves it consumed; a racing
    /// second transfer cannot acquire the DTO. No fitting happens in this frame.</summary>
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    public PreparedExecutionInput TransferForExecution(CheckedModelSnapshot source, ModelBuildRules? rules = null,
        CancellationToken cancellation = default)
    {
        var normalized = NormalizeRules(source, rules, cancellation, out var rulesContextSha256);
        ValidateExecutionScope(source.Snapshot, normalized, cancellation);
        cancellation.ThrowIfCancellationRequested();
        var snapshot = source.TakeForExecution();
        return ExecutionInput(source, snapshot, normalized, rulesContextSha256, cancellation);
    }

    private ModelBuildRules NormalizeRules(CheckedModelSnapshot source, ModelBuildRules? rules, CancellationToken cancellation, out string rulesContextSha256)
    {
        cancellation.ThrowIfCancellationRequested();
        if (source.Limits != limits) throw new ArgumentException("Snapshot validation limits differ from the fitted cache.");
        rules ??= new();
        if (rules.ExcludedObjectIds is null || rules.ExcludedObjectIds.Length > limits.MaximumObjects)
            throw new ArgumentException("Unknown rules or invalid exclusion identities.");
        var captured = rules with { ExcludedObjectIds = rules.ExcludedObjectIds.ToArray() };
        if (captured.Version is not ("pf2.rules.v1" or MeasuredBendRulesVersion) || captured.CategoryMappingVersion != "wfc-mto-v1"
            || captured.ExcludedObjectIds.Any(string.IsNullOrWhiteSpace) || captured.ExcludedObjectIds.Length > limits.MaximumObjects
            || captured.ExcludedObjectIds.Distinct(StringComparer.Ordinal).Count() != captured.ExcludedObjectIds.Length)
            throw new ArgumentException("Unknown rules or invalid exclusion identities.");
        rulesContextSha256 = SnapshotReader.Sha256(JsonSerializer.SerializeToUtf8Bytes(captured, SnapshotReader.JsonOptions));
        return captured with { ExcludedObjectIds = captured.ExcludedObjectIds.Order(StringComparer.Ordinal).ToArray() };
    }

    private static void ValidateExecutionScope(ModelSnapshot snapshot, ModelBuildRules rules, CancellationToken cancellation)
    {
        if (snapshot.Capture.LookupRouteCodes is not null && snapshot.Objects.Any(item => item.GeometryRole == "routing-leaf" && item.RouteBoundaryId is null))
            throw new ArgumentException("Independent lookup must resolve its bounded logical-owner scope before fitting geometry.");
        var objectIdentities = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in snapshot.Objects) { cancellation.ThrowIfCancellationRequested(); objectIdentities.Add(item.Id); }
        foreach (var excludedId in rules.ExcludedObjectIds)
        {
            cancellation.ThrowIfCancellationRequested();
            if (!objectIdentities.Contains(excludedId)) throw new ArgumentException("Exclusion references unknown object identity.");
        }
    }

    // This method must finish before Core fitting on the transfer path. Every
    // mesh constructor eagerly detaches vertices/indices; no deferred source
    // enumeration or SnapshotObject is retained in the returned opaque input.
    private PreparedExecutionInput ExecutionInput(CheckedModelSnapshot source, ModelSnapshot snapshot,
        ModelBuildRules rules, string rulesContextSha256, CancellationToken cancellation)
    {
        var snapshotHash = source.Sha256;
        var identity = CacheIdentity(snapshotHash, rules, cancellation);
        Observe(PreparationMemoryPhase.BeforePrepareInputs);
        var state = PrepareInputs(snapshot, rules, cancellation);
        Observe(PreparationMemoryPhase.AfterPrepareInputs);
        cancellation.ThrowIfCancellationRequested();
        return new(snapshot.Model, snapshotHash, source.SourceSha256, limits, source.IndependentLookup, source.Scope,
            identity.Key, identity.RulesHash, rulesContextSha256, state.Inputs, state.Objects, state.Diagnostics, state.NeedsReview, state.RequiresCategoryAssignment,
            rules.Version == MeasuredBendRulesVersion ? TrayGeometryFitPolicy.MeasuredBendV2 : TrayGeometryFitPolicy.LegacyV1, identity.ImplementationSha256);
    }

    private (string Key, string RulesHash, string? ImplementationSha256) CacheIdentity(string snapshotHash, ModelBuildRules rules, CancellationToken cancellation)
    {
        var rulesHash = SnapshotReader.Sha256(JsonSerializer.SerializeToUtf8Bytes(new { rules, limits }, SnapshotReader.JsonOptions));
        if (rules.Version == MeasuredBendRulesVersion)
        {
            var implementation = FittingImplementationSha256(cancellation);
            return (SnapshotReader.Sha256(Encoding.UTF8.GetBytes("pf2.fitted-cache.v2\n" + EngineVersion + "\n" + snapshotHash + "\n" + rulesHash
                + "\n" + MeasuredBendPolicyVersion + "\n" + implementation)), rulesHash, implementation);
        }
        var key = SnapshotReader.Sha256(Encoding.UTF8.GetBytes("pf2.fitted-cache.v1\n" + EngineVersion + "\n" + snapshotHash + "\n" + rulesHash));
        return (key, rulesHash, null);
    }

    // Only the new policy binds executable fitting bytes. Historical cache keys
    // remain byte-for-byte unchanged, including their rules/limits serialization.
    private static string FittingImplementationSha256(CancellationToken cancellation)
    {
        string Module(string filename)
        {
            var before = new FileInfo(filename); before.Refresh();
            if (!before.Exists || (before.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0
                || before.Length < 1 || before.Length > 64 * 1024 * 1024) throw new InvalidDataException("Fitting implementation module is unavailable.");
            var length = before.Length; var written = before.LastWriteTimeUtc;
            using var input = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.SequentialScan);
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[65536]; long read = 0;
            while (true)
            {
                cancellation.ThrowIfCancellationRequested(); int count = input.Read(buffer);
                if (count == 0) break; read += count;
                if (read > length) throw new InvalidDataException("Fitting implementation module changed.");
                hash.AppendData(buffer, 0, count);
            }
            var after = new FileInfo(filename); after.Refresh(); cancellation.ThrowIfCancellationRequested();
            if (read != length || !after.Exists || after.Length != length || after.LastWriteTimeUtc != written
                || (after.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0)
                throw new InvalidDataException("Fitting implementation module changed.");
            return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
        }
        return SnapshotReader.Sha256(Encoding.UTF8.GetBytes(Module(typeof(TrayGeometryBuilder).Assembly.Location) + "\n"
            + Module(typeof(FittedModelCache).Assembly.Location)));
    }

    private PreparedModel GetOrBuildChecked(CheckedModelSnapshot source, ModelBuildRules? rules, CancellationToken cancellation) =>
        GetOrBuildExecution(source, rules, cancellation).Prepared;

    public PreparedExecution GetOrBuildExecution(PreparedExecutionInput source, CancellationToken cancellation = default)
    {
        cancellation.ThrowIfCancellationRequested();
        if (source.Limits != limits) throw new ArgumentException("Snapshot validation limits differ from the fitted cache.");
        var prepared = GetOrBuildPrepared(source, cancellation);
        cancellation.ThrowIfCancellationRequested();
        return new(prepared, source.Model, source.SourceSha256, source.IndependentLookup, source.RequiresCategoryAssignment, source.Scope);
    }

    private PreparedModel GetOrBuildPrepared(PreparedExecutionInput source, CancellationToken cancellation)
    {
        if (source.FitPolicy == TrayGeometryFitPolicy.MeasuredBendV2
            && source.FittingImplementationSha256 != FittingImplementationSha256(cancellation))
            throw new InvalidDataException("Fitting implementation changed after the checked input was transferred.");
        var key = source.Key; var snapshotHash = source.Sha256; var rulesHash = source.RulesHash;
        while (!Monitor.TryEnter(gate, 50)) cancellation.ThrowIfCancellationRequested();
        try
        {
            cancellation.ThrowIfCancellationRequested();
            if (memory.TryGetValue(key, out var hit)) return hit;
            var payloadPath = CachePath(key, ".fit.json");
            var manifestPath = CachePath(key, ".manifest.json");
            PreparedModel result;
            if (File.Exists(payloadPath) || File.Exists(manifestPath))
            {
                if (!File.Exists(payloadPath) || !File.Exists(manifestPath)) throw new InvalidDataException("Incomplete fitted-cache entry; preserve and rebuild explicitly.");
                var manifest = JsonSerializer.Deserialize<CacheManifest>(ReadBounded(manifestPath, 8192, cancellation), SnapshotReader.JsonOptions)
                    ?? throw new InvalidDataException("Missing cache manifest.");
                if (manifest.SchemaVersion != "pf2.fitted-cache.v1" || manifest.Key != key || manifest.SnapshotSha256 != snapshotHash
                    || manifest.RulesSha256 != rulesHash || manifest.EngineVersion != EngineVersion) throw new InvalidDataException("Stale or mismatched fitted-cache manifest.");
                var bytes = ReadBounded(payloadPath, limits.MaximumBytes, cancellation);
                if (SnapshotReader.Sha256(bytes) != manifest.PayloadSha256) throw new InvalidDataException("Fitted-cache payload corruption detected.");
                var payload = JsonSerializer.Deserialize<FitPayload>(bytes, SnapshotReader.JsonOptions) ?? throw new InvalidDataException("Missing fit payload.");
                Observe(PreparationMemoryPhase.BeforeDiskRestore);
                var restored = Restore(payload, source.Inputs, cancellation);
                Observe(PreparationMemoryPhase.AfterDiskRestore);
                result = Result(source.Model, key, snapshotHash, rulesHash, restored, payload.Counts, source.Objects,
                    source.Diagnostics.Concat(payload.Diagnostics).ToArray(), source.NeedsReview || HasFallback(payload.Counts), true);
            }
            else
            {
                Observe(PreparationMemoryPhase.BeforeCoreFit);
                var built = source.FitPolicy == TrayGeometryFitPolicy.LegacyV1 ? TrayGeometryBuilder.Build(source.Inputs, cancellation)
                    : TrayGeometryBuilder.Build(source.Inputs, source.FitPolicy, cancellation);
                Observe(PreparationMemoryPhase.AfterCoreFit);
                var counts = new GeometryCounts(built.ValidatedBends, built.FallbackBends, built.ValidatedStraights, built.FallbackStraights, built.FallbackClearances);
                var payload = new FitPayload(built.Segments.Select(Save).ToArray(), counts, built.Diagnostics.ToArray());
                var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, SnapshotReader.JsonOptions);
                if (bytes.Length > limits.MaximumBytes) throw new ArgumentException("Fitted-cache payload budget exceeded.");
                var manifest = new CacheManifest("pf2.fitted-cache.v1", key, snapshotHash, rulesHash, EngineVersion, SnapshotReader.Sha256(bytes));
                WriteAtomic(payloadPath, bytes, cancellation);
                WriteAtomic(manifestPath, JsonSerializer.SerializeToUtf8Bytes(manifest, SnapshotReader.JsonOptions), cancellation);
                result = Result(source.Model, key, snapshotHash, rulesHash, built.Segments, counts, source.Objects,
                    source.Diagnostics.Concat(built.Diagnostics).ToArray(), source.NeedsReview || HasFallback(counts), false);
            }
            cancellation.ThrowIfCancellationRequested();
            while (memory.Count >= limits.MaximumCachedModels && order.Count > 0) memory.Remove(order.Dequeue());
            memory.Add(key, result); order.Enqueue(key);
            return result;
        }
        finally { Monitor.Exit(gate); }
    }

    private InputState PrepareInputs(ModelSnapshot snapshot, ModelBuildRules rules, CancellationToken cancellation)
    {
        var diagnostics = new List<string>(); var inputs = new List<TrayGeometryInput>(); var objects = new List<PreparedObject>();
        bool requiresCategoryAssignment = false;
        var capture = snapshot.Capture;
        bool review = !capture.InventoryComplete || !capture.GeometryComplete || !capture.UnitsVerified || !capture.TransformsVerified
            || !capture.PlanningVisibilityKnown || !capture.SourceLinkVerified;
        foreach (var (verified, diagnostic) in new[]
        {
            (capture.InventoryComplete, "Inventory is explicitly partial."), (capture.GeometryComplete, "Geometry capture is explicitly partial."),
            (capture.UnitsVerified, "Source unit conversion is unverified."), (capture.TransformsVerified, "Source/root/display transforms are unverified."),
            (capture.PlanningVisibilityKnown, "Native planning visibility is not established; display Ghost/isolation is never used as exclusion."),
            (capture.SourceLinkVerified, "Cryptographic/evidenced source-to-conversion correspondence is not established.")
        }) if (!verified) diagnostics.Add(diagnostic);
        var excluded = rules.ExcludedObjectIds.ToHashSet(StringComparer.Ordinal);
        var visibility = SnapshotReader.Visibility(snapshot, limits, cancellation);
        var byId = snapshot.Objects.ToDictionary(item => item.Id, StringComparer.Ordinal);
        foreach (var duplicate in snapshot.Objects.Where(x => x.ExternalId is not null).GroupBy(x => x.ExternalId, StringComparer.Ordinal).Where(group => group.Count() > 1))
        { review = true; diagnostics.Add("Ambiguous external identity: " + duplicate.Key + "; version-local IDs remain distinct."); }
        foreach (var item in snapshot.Objects)
        {
            cancellation.ThrowIfCancellationRequested();
            var routeNames = item.LeafToRootNames;
            if (item.RouteBoundaryId is not null)
            {
                var bounded = new List<string>(); var node = item;
                while (true)
                {
                    bounded.Add(node.Name);
                    if (node.Id == item.RouteBoundaryId) break;
                    node = byId[node.ParentId!]; // SnapshotReader has validated this ancestor boundary.
                }
                routeNames = bounded.ToArray();
            }
            var routeName = item.RouteName ?? RouteNameResolver.Resolve(routeNames);
            var shapeName = item.ShapeName ?? (item.RouteBoundaryId is null ? item.Name : routeNames.FirstOrDefault(name => SelectedShapeName.IsMatch(name)) ?? item.Name);
            var bottom = new RoutePoint((item.Bounds.Minimum[0] + item.Bounds.Maximum[0]) / 2,
                (item.Bounds.Minimum[1] + item.Bounds.Maximum[1]) / 2, item.Bounds.Minimum[2]);
            var state = item.PlanningExcluded || excluded.Contains(item.Id) ? "excluded" : visibility[item.Id];
            objects.Add(new PreparedObject(item.Id, item.ExternalId, item.DbId, item.Name, item.GeometryRole, routeName, shapeName, state, bottom));
            // All included PreparedObjects count, even when a missing route
            // label prevents fitting. This is the original write/category guard.
            if (item.GeometryRole == "routing-leaf" && state is not ("hidden" or "excluded")
                && (item.CategoryAssignmentSource == "unassigned" || item.AllowedCategories.Length == 0)) requiresCategoryAssignment = true;
            if (item.GeometryRole != "routing-leaf") continue;
            if (string.IsNullOrWhiteSpace(routeName))
            { review = true; diagnostics.Add(item.Id + ": missing_route_label for explicitly selected routing-leaf."); continue; }
            if (state is "hidden" or "excluded") { diagnostics.Add(item.Id + ": explicitly excluded from routing by native visibility/planning rules."); continue; }
            if (state == "unknown") { review = true; diagnostics.Add(item.Id + ": native ancestor visibility unknown; fitted provisionally, not engineering-ready."); }
            if (item.CategoryAssignmentSource == "unassigned" || item.AllowedCategories.Length == 0)
            { review = true; diagnostics.Add(item.Id + ": category_required; category assignments are planning inputs, never inferred from display properties."); }
            var mesh = Mesh(item);
            if (mesh is null) { review = true; diagnostics.Add(item.Id + ": no retained fragment mesh; any core fallback remains explicit."); }
            var faces = (item.FaceExtents ?? []).Select(face => new TrayFaceExtent(Enum.Parse<TrayBoxFace>(face.Face),
                AffineTransform.Point(face.Bounds.Minimum), AffineTransform.Point(face.Bounds.Maximum), face.SampleCount));
            inputs.Add(new TrayGeometryInput(item.Id, routeName, SnapshotReader.Categories(item.AllowedCategories), shapeName,
                AffineTransform.Point(item.Bounds.Minimum), AffineTransform.Point(item.Bounds.Maximum), faces, mesh));
        }
        if (inputs.Count == 0) { review = true; diagnostics.Add("No eligible route geometry was captured; this is not a prepared routing model."); }
        return new InputState(inputs.ToArray(), objects.ToArray(), diagnostics.ToArray(), review, requiresCategoryAssignment);
    }

    private static TrayMeshData? Mesh(SnapshotObject item) => item.Fragments.Length == 0 ? null : new TrayMeshData(item.Fragments.Select(fragment =>
        new TrayMeshFragment(fragment.Vertices.Select(AffineTransform.Point), fragment.TriangleIndices)));
    private static bool HasFallback(GeometryCounts counts) => counts.FallbackBends != 0 || counts.FallbackStraights != 0 || counts.FallbackClearances != 0;
    private static PreparedModel Result(ModelIdentity model, string key, string snapshotHash, string rulesHash, IReadOnlyList<TraySegment> segments,
        GeometryCounts counts, PreparedObject[] objects, string[] diagnostics, bool review, bool disk) =>
        new(key, snapshotHash, rulesHash, model.ProjectId, model.ModelVersionId, model.ContentSha256,
            review ? "needs_review" : "fitted_geometry_ready_native_parity_not_asserted", segments,
            new ReadOnlyCollection<PreparedObject>(objects), counts, new ReadOnlyCollection<string>(diagnostics), disk);

    private static FitSegment Save(TraySegment segment) => new(segment.Id, segment.Name, (int)segment.AllowedCategories,
        segment.Points.Select(P).ToArray(), segment.ConnectionsAtEndsOnly, segment.VerifiedPorts.Select(port =>
            new FitPort(P(port.Point), P(port.Outward), P(port.U), P(port.V), port.Width, port.Height)).ToArray(), segment.ConnectionSurfaces.Count);
    private static double[] P(RoutePoint point) => [point.X, point.Y, point.Z];
    private static IReadOnlyList<TraySegment> Restore(FitPayload payload, TrayGeometryInput[] inputs, CancellationToken cancellation)
    {
        if (payload.Segments is null || payload.Counts is null || payload.Diagnostics is null || payload.Segments.Length != inputs.Length)
            throw new InvalidDataException("Malformed cached geometry.");
        var values = inputs.ToDictionary(x => x.Id, StringComparer.Ordinal); var segments = new List<TraySegment>(); var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in payload.Segments)
        {
            cancellation.ThrowIfCancellationRequested();
            if (item is null || !values.TryGetValue(item.Id, out var input) || !seen.Add(item.Id) || item.Name != input.RouteName
                || item.Categories != (int)input.Categories || item.Points is null || item.Ports is null || item.Ports.Length > 2 || item.SurfaceCount is < 0 or > 2)
                throw new InvalidDataException("Cached segment does not match validated snapshot.");
            var ports = item.Ports.Select(port => new RouteConnectionPort(AffineTransform.Point(port.Point), AffineTransform.Point(port.Outward),
                AffineTransform.Point(port.U), AffineTransform.Point(port.V), port.Width, port.Height)).ToArray();
            var surfaces = new List<TrayMeshClearance>();
            if (item.SurfaceCount != 0)
            {
                IEnumerable<RouteConnectionPort[]> sets = item.EndsOnly ? ports.Select(port => new[] { port }) : new[] { ports };
                foreach (var set in sets)
                {
                    if (!TrayMeshClearance.TryCreate(input.Mesh, set, item.EndsOnly, cancellation, out var surface, out var reason))
                        throw new InvalidDataException("Cached physical-surface reconstruction failed: " + reason);
                    surfaces.Add(surface);
                }
                if (surfaces.Count != item.SurfaceCount) throw new InvalidDataException("Cached surface count mismatch.");
            }
            segments.Add(new TraySegment(item.Id, item.Name, input.Categories, item.Points.Select(AffineTransform.Point), item.EndsOnly, ports, surfaces));
        }
        return new ReadOnlyCollection<TraySegment>(segments);
    }
    private string CachePath(string key, string suffix)
    {
        var path = Path.GetFullPath(Path.Combine(root, key + suffix));
        if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Cache path escaped owned root.");
        if (File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Cache file cannot be a reparse point.");
        return path;
    }
    private static byte[] ReadBounded(string path, int max, CancellationToken cancellation)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > max) throw new InvalidDataException("Cache file exceeds byte budget.");
        using var buffer = new MemoryStream(); var chunk = new byte[8192];
        while (true)
        {
            cancellation.ThrowIfCancellationRequested(); var count = stream.Read(chunk);
            if (count == 0) break;
            if (buffer.Length + count > max) throw new InvalidDataException("Cache file grew beyond byte budget."); buffer.Write(chunk, 0, count);
        }
        return buffer.ToArray();
    }
    private void WriteAtomic(string path, byte[] bytes, CancellationToken cancellation)
    {
        var temporary = CachePath(Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N"), ".tmp");
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                for (var offset = 0; offset < bytes.Length; offset += 8192)
                { cancellation.ThrowIfCancellationRequested(); stream.Write(bytes, offset, Math.Min(8192, bytes.Length - offset)); }
                stream.Flush(true);
            }
            cancellation.ThrowIfCancellationRequested(); File.Move(temporary, path, false);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    private sealed record InputState(TrayGeometryInput[] Inputs, PreparedObject[] Objects, string[] Diagnostics, bool NeedsReview, bool RequiresCategoryAssignment);
    private sealed record CacheManifest(string SchemaVersion, string Key, string SnapshotSha256, string RulesSha256, string EngineVersion, string PayloadSha256);
    private sealed record FitPayload(FitSegment[] Segments, GeometryCounts Counts, string[] Diagnostics);
    private sealed record FitSegment(string Id, string Name, int Categories, double[][] Points, bool EndsOnly, FitPort[] Ports, int SurfaceCount);
    private sealed record FitPort(double[] Point, double[] Outward, double[] U, double[] V, double Width, double Height);
}
