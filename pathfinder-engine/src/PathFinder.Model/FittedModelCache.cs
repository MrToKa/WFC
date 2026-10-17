using System.Collections.ObjectModel;
using System.Text;
using System.Text.Json;
using AddinRibbon.Routing;

namespace PathFinder.Model;

/// <summary>Versioned fitted geometry cache. RouteCalculator still constructs its graph per call.</summary>
public sealed class FittedModelCache
{
    public const string EngineVersion = "45c24bf5f433f13e102600b36f20327c77961d0a";
    private readonly string root;
    private readonly ModelLimits limits;
    private readonly object gate = new();
    private readonly Dictionary<string, PreparedModel> memory = new(StringComparer.Ordinal);
    private readonly Queue<string> order = new();

    public FittedModelCache(string ownedCacheDirectory, ModelLimits? limits = null)
    {
        this.limits = limits ?? new();
        if (this.limits.MaximumCachedModels < 1 || this.limits.MaximumBytes < 1024) throw new ArgumentException("Invalid cache resource limits.");
        root = Path.GetFullPath(ownedCacheDirectory);
        Directory.CreateDirectory(root);
        if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("Cache root cannot be a reparse point.");
    }

    public PreparedModel GetOrBuild(ReadOnlyMemory<byte> snapshotJson, ModelBuildRules? rules = null, CancellationToken cancellation = default)
    {
        cancellation.ThrowIfCancellationRequested();
        if (snapshotJson.Length == 0 || snapshotJson.Length > limits.MaximumBytes) throw new ArgumentException("Snapshot byte budget exceeded.");
        rules ??= new();
        if (rules.Version != "pf2.rules.v1" || rules.CategoryMappingVersion != "wfc-mto-v1" || rules.ExcludedObjectIds is null
            || rules.ExcludedObjectIds.Any(string.IsNullOrWhiteSpace) || rules.ExcludedObjectIds.Length > limits.MaximumObjects
            || rules.ExcludedObjectIds.Distinct(StringComparer.Ordinal).Count() != rules.ExcludedObjectIds.Length)
            throw new ArgumentException("Unknown rules or invalid exclusion identities.");
        rules = rules with { ExcludedObjectIds = rules.ExcludedObjectIds.Order(StringComparer.Ordinal).ToArray() };
        var snapshotHash = SnapshotReader.Sha256(snapshotJson.Span);
        var rulesHash = SnapshotReader.Sha256(JsonSerializer.SerializeToUtf8Bytes(new { rules, limits }, SnapshotReader.JsonOptions));
        var key = SnapshotReader.Sha256(Encoding.UTF8.GetBytes("pf2.fitted-cache.v1\n" + EngineVersion + "\n" + snapshotHash + "\n" + rulesHash));
        while (!Monitor.TryEnter(gate, 50)) cancellation.ThrowIfCancellationRequested();
        try
        {
            cancellation.ThrowIfCancellationRequested();
            if (memory.TryGetValue(key, out var hit)) return hit;
            var snapshot = SnapshotReader.Read(snapshotJson, limits, cancellation);
            var objectIdentities = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in snapshot.Objects) { cancellation.ThrowIfCancellationRequested(); objectIdentities.Add(item.Id); }
            foreach (var excludedId in rules.ExcludedObjectIds)
            {
                cancellation.ThrowIfCancellationRequested();
                if (!objectIdentities.Contains(excludedId)) throw new ArgumentException("Exclusion references unknown object identity.");
            }
            var state = PrepareInputs(snapshot, rules, cancellation);
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
                var restored = Restore(payload, state.Inputs, cancellation);
                result = Result(snapshot, key, snapshotHash, rulesHash, restored, payload.Counts, state.Objects,
                    state.Diagnostics.Concat(payload.Diagnostics).ToArray(), state.NeedsReview || HasFallback(payload.Counts), true);
            }
            else
            {
                var built = TrayGeometryBuilder.Build(state.Inputs, cancellation);
                var counts = new GeometryCounts(built.ValidatedBends, built.FallbackBends, built.ValidatedStraights, built.FallbackStraights, built.FallbackClearances);
                var payload = new FitPayload(built.Segments.Select(Save).ToArray(), counts, built.Diagnostics.ToArray());
                var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, SnapshotReader.JsonOptions);
                if (bytes.Length > limits.MaximumBytes) throw new ArgumentException("Fitted-cache payload budget exceeded.");
                var manifest = new CacheManifest("pf2.fitted-cache.v1", key, snapshotHash, rulesHash, EngineVersion, SnapshotReader.Sha256(bytes));
                WriteAtomic(payloadPath, bytes, cancellation);
                WriteAtomic(manifestPath, JsonSerializer.SerializeToUtf8Bytes(manifest, SnapshotReader.JsonOptions), cancellation);
                result = Result(snapshot, key, snapshotHash, rulesHash, built.Segments, counts, state.Objects,
                    state.Diagnostics.Concat(built.Diagnostics).ToArray(), state.NeedsReview || HasFallback(counts), false);
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
        foreach (var duplicate in snapshot.Objects.Where(x => x.ExternalId is not null).GroupBy(x => x.ExternalId, StringComparer.Ordinal).Where(group => group.Count() > 1))
        { review = true; diagnostics.Add("Ambiguous external identity: " + duplicate.Key + "; version-local IDs remain distinct."); }
        foreach (var item in snapshot.Objects)
        {
            cancellation.ThrowIfCancellationRequested();
            var routeName = item.RouteName ?? RouteNameResolver.Resolve(item.LeafToRootNames);
            var shapeName = item.ShapeName ?? item.Name;
            var bottom = new RoutePoint((item.Bounds.Minimum[0] + item.Bounds.Maximum[0]) / 2,
                (item.Bounds.Minimum[1] + item.Bounds.Maximum[1]) / 2, item.Bounds.Minimum[2]);
            var state = item.PlanningExcluded || excluded.Contains(item.Id) ? "excluded" : visibility[item.Id];
            objects.Add(new PreparedObject(item.Id, item.ExternalId, item.DbId, item.Name, item.GeometryRole, routeName, shapeName, state, bottom));
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
        return new InputState(inputs.ToArray(), objects.ToArray(), diagnostics.ToArray(), review);
    }

    private static TrayMeshData? Mesh(SnapshotObject item) => item.Fragments.Length == 0 ? null : new TrayMeshData(item.Fragments.Select(fragment =>
        new TrayMeshFragment(fragment.Vertices.Select(AffineTransform.Point), fragment.TriangleIndices)));
    private static bool HasFallback(GeometryCounts counts) => counts.FallbackBends != 0 || counts.FallbackStraights != 0 || counts.FallbackClearances != 0;
    private static PreparedModel Result(ModelSnapshot snapshot, string key, string snapshotHash, string rulesHash, IReadOnlyList<TraySegment> segments,
        GeometryCounts counts, PreparedObject[] objects, string[] diagnostics, bool review, bool disk) =>
        new(key, snapshotHash, rulesHash, snapshot.Model.ProjectId, snapshot.Model.ModelVersionId, snapshot.Model.ContentSha256,
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
    private sealed record InputState(TrayGeometryInput[] Inputs, PreparedObject[] Objects, string[] Diagnostics, bool NeedsReview);
    private sealed record CacheManifest(string SchemaVersion, string Key, string SnapshotSha256, string RulesSha256, string EngineVersion, string PayloadSha256);
    private sealed record FitPayload(FitSegment[] Segments, GeometryCounts Counts, string[] Diagnostics);
    private sealed record FitSegment(string Id, string Name, int Categories, double[][] Points, bool EndsOnly, FitPort[] Ports, int SurfaceCount);
    private sealed record FitPort(double[] Point, double[] Outward, double[] U, double[] V, double Width, double Height);
}
