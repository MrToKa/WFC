using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Adapter;
using PathFinder.Model;

internal sealed record FittedTraceExportRequest
{
    public required string SchemaVersion { get; init; }
    public required string ExportId { get; init; }
    public required int MaxBytes { get; init; }
}
internal sealed record FittedTraceCounts(int Objects, int Segments, int Diagnostics, int Points, int Ports);
internal sealed record FittedTraceEngine(string Version, string RunnerSha256, string ModelModuleSha256,
    string CoreModuleSha256, string AdapterModuleSha256);
internal sealed record FittedTraceReference(string SchemaVersion, string ExportId, string Sha256, long Bytes,
    FittedTraceCounts Counts, FittedTraceEngine Engine, string RulesSha256, string SnapshotSha256, string PreparedKey);

/** Read-only projection of the actual prepared result; it never changes Core inputs or cache order. */
internal static class FittedTraceExporter
{
    internal const int MaximumBytes = 32 * 1024 * 1024;
    internal const long MaximumTransientBytes = 128L * 1024 * 1024;
    internal const int MaximumEntries = 129;
    internal const string Schema = "wfc.pf.fitted-trace.v1";
    internal const string RequestSchema = "wfc.pf.fitted-trace-export-request.v1";
    internal const string ReferenceSchema = "wfc.pf.fitted-trace-reference.v1";
    internal const string Measurement = "wfc.pf.fitted-polyline-length.v1";

    internal static void Validate(FittedTraceExportRequest request)
    {
        if (request.SchemaVersion != RequestSchema || !Guid.TryParseExact(request.ExportId, "D", out var id)
            || id.ToString("D") != request.ExportId || request.MaxBytes is < 1024 or > MaximumBytes)
            throw new ArgumentException("Invalid fitted trace export request.");
    }

    internal static FittedTraceReference Export(string ownedRoot, PreparedModel prepared, FittedTraceExportRequest request,
        CancellationToken token, Action<string>? directorySync = null)
    {
        Validate(request); token.ThrowIfCancellationRequested();
        directorySync ??= SyncDirectory;
        var root = Path.GetFullPath(ownedRoot);
        if (!Path.IsPathFullyQualified(ownedRoot) || !Directory.Exists(root)) throw new ArgumentException("Explicit owned fitted trace root required.");
        RegularDirectory(root);
        var directory = Path.Combine(root, "fitted-traces");
        var existed = Directory.Exists(directory);
        if (!existed) Directory.CreateDirectory(directory);
        RegularDirectory(directory); directorySync(root);
        var lockPath = Path.Combine(directory, "quota.lock");
        if (File.Exists(lockPath)) RegularFile(lockPath);
        using var quota = OpenQuotaLock(lockPath, token);
        RegularFile(lockPath);
        if (quota.Length != 0) throw new IOException("Unknown fitted trace quota lock contents; preserve the file.");
        quota.Flush(true); directorySync(directory);
        long used = 0; var entries = 0;
        foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
        {
            token.ThrowIfCancellationRequested();
            if (++entries > MaximumEntries) throw new IOException("Fitted trace transient entry budget exceeded.");
            RegularFile(entry);
            var name = Path.GetFileName(entry);
            if (name != "quota.lock")
            {
                var extension = Path.GetExtension(name);
                if (extension is not (".json" or ".tmp") || !Guid.TryParseExact(Path.GetFileNameWithoutExtension(name), "D", out var id)
                    || id.ToString("D") + extension != name) throw new IOException("Unknown fitted trace staging file; preserve it.");
                var length = new FileInfo(entry).Length;
                if (length > MaximumBytes) throw new IOException("Fitted trace transient file budget exceeded.");
                used = checked(used + length);
            }
        }
        if (used > MaximumTransientBytes) throw new IOException("Fitted trace transient byte budget exceeded.");
        var final = Path.Combine(directory, request.ExportId + ".json");
        var temporary = Path.Combine(directory, request.ExportId + ".tmp");
        if (File.Exists(temporary)) throw new IOException("Incomplete fitted trace export exists; preserve and reconcile it.");
        var engine = Engine(token);
        if (File.Exists(final))
        {
            // Exact deterministic replay; a self-consistent foreign file is not enough.
            var expected = Write(Stream.Null, prepared, request, engine, token);
            var actual = FileHash(final, request.MaxBytes, token);
            if (actual.Bytes != expected.Bytes || actual.Sha256 != expected.Sha256)
                throw new IOException("Existing fitted trace export conflicts with the exact prepared result.");
            directorySync(directory); return expected;
        }
        AdmitTransient(used, entries, request.MaxBytes);
        // Exclusive creation and an atomic no-replace move retain uncertain crash files.
        // No exception path sweeps or deletes a temporary/final file.
        FittedTraceReference reference;
        using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536))
        {
            directorySync(directory);
            reference = Write(output, prepared, request, engine, token);
            output.Flush(true); token.ThrowIfCancellationRequested();
        }
        token.ThrowIfCancellationRequested();
        File.Move(temporary, final, false); directorySync(directory);
        var saved = FileHash(final, request.MaxBytes, token);
        if (saved.Bytes != reference.Bytes || saved.Sha256 != reference.Sha256) throw new IOException("Fitted trace readback mismatch.");
        return reference;
    }

    internal static void AdmitTransient(long used, int entries, int maximum)
    {
        if (used < 0 || entries < 0 || entries >= MaximumEntries || maximum is < 1024 or > MaximumBytes
            || used > MaximumTransientBytes - maximum) throw new IOException("Fitted trace transient admission budget exceeded.");
    }

    private static FileStream OpenQuotaLock(string path, CancellationToken token)
    {
        var watch = System.Diagnostics.Stopwatch.StartNew();
        while (true)
        {
            token.ThrowIfCancellationRequested();
            try { return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) when (watch.ElapsedMilliseconds < 3000) { token.WaitHandle.WaitOne(25); }
        }
    }

    internal static FittedTraceReference Write(Stream output, PreparedModel prepared, FittedTraceExportRequest request,
        FittedTraceEngine engine, CancellationToken token)
    {
        Validate(request); token.ThrowIfCancellationRequested();
        var pointCount = 0; var portCount = 0;
        foreach (var segment in prepared.Segments)
        { token.ThrowIfCancellationRequested(); pointCount = checked(pointCount + segment.Points.Count); portCount = checked(portCount + segment.VerifiedPorts.Count); }
        var counts = new FittedTraceCounts(prepared.Objects.Count, prepared.Segments.Count, prepared.Diagnostics.Count, pointCount, portCount);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        using var bounded = new BoundedHashStream(output, hash, request.MaxBytes, token);
        using (var json = new Utf8JsonWriter(bounded))
        {
            json.WriteStartObject(); json.WriteString("schemaVersion", Schema); json.WriteString("exportId", request.ExportId);
            json.WriteString("projectId", prepared.ProjectId); json.WriteString("modelVersionId", prepared.ModelVersionId);
            json.WriteString("contentFingerprint", prepared.ContentSha256); json.WriteString("snapshotSha256", prepared.SnapshotSha256);
            json.WriteString("preparedKey", prepared.Key); json.WriteString("rulesSha256", prepared.RulesSha256);
            json.WritePropertyName("engine"); JsonSerializer.Serialize(json, engine, SnapshotReader.JsonOptions);
            json.WriteString("measurementVersion", Measurement); json.WriteString("readiness", prepared.Readiness);
            json.WriteBoolean("engineeringAccepted", false);
            json.WritePropertyName("counts"); JsonSerializer.Serialize(json, counts, SnapshotReader.JsonOptions);
            json.WritePropertyName("geometryCounts"); JsonSerializer.Serialize(json, prepared.Counts, SnapshotReader.JsonOptions);
            json.WriteStartArray("objects"); var ordinal = 0;
            foreach (var item in prepared.Objects)
            {
                token.ThrowIfCancellationRequested(); json.WriteStartObject(); json.WriteNumber("orderIndex", ordinal++);
                json.WriteString("objectId", item.Id); json.WriteString("externalId", item.ExternalId);
                if (item.DbId is int db) json.WriteNumber("dbId", db); else json.WriteNull("dbId");
                json.WriteString("name", item.Name); json.WriteString("geometryRole", item.GeometryRole);
                json.WriteString("resolvedRouteName", item.ResolvedRouteName); json.WriteString("shapeName", item.ShapeName);
                json.WriteString("visibility", item.Visibility); Point(json, "bottomCentreMetres", item.BottomCentreMetres);
                json.WriteEndObject();
            }
            json.WriteEndArray(); json.WriteStartArray("segments"); ordinal = 0;
            foreach (var segment in prepared.Segments)
            {
                token.ThrowIfCancellationRequested(); json.WriteStartObject(); json.WriteNumber("orderIndex", ordinal++);
                json.WriteString("objectId", segment.Id); json.WriteString("name", segment.Name); json.WriteString("routeCode", segment.RouteCode);
                json.WriteNumber("allowedCategoryMask", (int)segment.AllowedCategories); json.WriteBoolean("connectionsAtEndsOnly", segment.ConnectionsAtEndsOnly);
                json.WriteStartArray("pointsMetres"); var length = 0d;
                for (var at = 0; at < segment.Points.Count; at++)
                {
                    token.ThrowIfCancellationRequested(); Point(json, null, segment.Points[at]);
                    if (at > 0) length += segment.Points[at - 1].DistanceTo(segment.Points[at]);
                }
                json.WriteEndArray(); json.WriteStartArray("ports");
                foreach (var port in segment.VerifiedPorts)
                {
                    token.ThrowIfCancellationRequested(); json.WriteStartObject(); Point(json, "pointMetres", port.Point);
                    Point(json, "outward", port.Outward); Point(json, "u", port.U); Point(json, "v", port.V);
                    Finite(json, "widthMetres", port.Width); Finite(json, "heightMetres", port.Height); json.WriteEndObject();
                }
                json.WriteEndArray(); json.WriteNumber("connectionSurfaceCount", segment.ConnectionSurfaces.Count);
                Finite(json, "geometricLengthMetres", length); json.WriteString("geometricLengthRoundTrip", length.ToString("R", CultureInfo.InvariantCulture));
                json.WriteString("fitStatus", "unknown"); json.WriteEndObject(); json.Flush();
            }
            json.WriteEndArray(); json.WriteStartArray("diagnostics");
            foreach (var diagnostic in prepared.Diagnostics) { token.ThrowIfCancellationRequested(); json.WriteStringValue(diagnostic); }
            json.WriteEndArray(); json.WriteEndObject(); json.Flush();
        }
        token.ThrowIfCancellationRequested();
        return new(ReferenceSchema, request.ExportId, Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(), bounded.Bytes,
            counts, engine, prepared.RulesSha256, prepared.SnapshotSha256, prepared.Key);
    }

    private static void Point(Utf8JsonWriter json, string? name, RoutePoint point)
    {
        if (name is null) json.WriteStartArray(); else json.WriteStartArray(name);
        foreach (var value in new[] { point.X, point.Y, point.Z })
        { if (!double.IsFinite(value)) throw new ArgumentException("Fitted trace coordinates must be finite."); json.WriteNumberValue(value); }
        json.WriteEndArray();
    }
    private static void Finite(Utf8JsonWriter json, string name, double value)
    { if (!double.IsFinite(value) || value < 0) throw new ArgumentException("Fitted trace measurement must be finite and nonnegative."); json.WriteNumber(name, value); }
    internal static FittedTraceEngine Engine(CancellationToken token) => new(FittedModelCache.EngineVersion,
        ModuleHash(typeof(FittedTraceExporter).Assembly, token), ModuleHash(typeof(FittedModelCache).Assembly, token),
        ModuleHash(typeof(TraySegment).Assembly, token), ModuleHash(typeof(PathfinderAdapter).Assembly, token));
    private static string ModuleHash(Assembly assembly, CancellationToken token) => FileHash(assembly.Location, MaximumBytes, token).Sha256;
    private static (string Sha256, long Bytes) FileHash(string path, int maximum, CancellationToken token)
    {
        RegularFile(path); var info = new FileInfo(path);
        if (info.Length is < 1 || info.Length > maximum) throw new IOException("Fitted trace file exceeds its byte budget.");
        using var stream = File.OpenRead(path); using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[65536]; long bytes = 0; int count;
        while ((count = stream.Read(buffer)) > 0)
        { token.ThrowIfCancellationRequested(); bytes += count; if (bytes > maximum) throw new IOException("Fitted trace file grew beyond its byte budget."); hash.AppendData(buffer, 0, count); }
        return (Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(), bytes);
    }
    private static void RegularDirectory(string path)
    { if ((File.GetAttributes(path) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != FileAttributes.Directory) throw new IOException("Fitted trace directory must be regular."); }
    private static void RegularFile(string path)
    { if ((File.GetAttributes(path) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0) throw new IOException("Fitted trace file must be regular."); }
    private static void SyncDirectory(string path)
    {
        if (!OperatingSystem.IsLinux()) throw new IOException("Durable fitted trace directory sync requires the qualified Linux runtime.");
        var descriptor = Native.Open(path, 0x10000 | 0x20000); // O_RDONLY | O_DIRECTORY | O_NOFOLLOW
        if (descriptor < 0) throw new IOException("Fitted trace directory sync could not open its owned directory.");
        try { if (Native.Fsync(descriptor) != 0) throw new IOException("Fitted trace directory sync failed."); }
        finally { Native.Close(descriptor); }
    }
    private static class Native
    {
        [DllImport("libc", EntryPoint = "open", SetLastError = true)] internal static extern int Open(string path, int flags);
        [DllImport("libc", EntryPoint = "fsync", SetLastError = true)] internal static extern int Fsync(int descriptor);
        [DllImport("libc", EntryPoint = "close", SetLastError = true)] internal static extern int Close(int descriptor);
    }
    private sealed class BoundedHashStream(Stream inner, IncrementalHash hash, int maximum, CancellationToken token) : Stream
    {
        internal long Bytes { get; private set; }
        public override bool CanRead => false; public override bool CanSeek => false; public override bool CanWrite => true;
        public override long Length => Bytes; public override long Position { get => Bytes; set => throw new NotSupportedException(); }
        public override void Flush() => inner.Flush();
        public override void Write(byte[] buffer, int offset, int count) => Write(buffer.AsSpan(offset, count));
        public override void Write(ReadOnlySpan<byte> buffer)
        {
            token.ThrowIfCancellationRequested();
            if (Bytes + buffer.Length > maximum) throw new ArgumentException("Fitted trace output exceeds its byte budget.");
            inner.Write(buffer); hash.AppendData(buffer); Bytes += buffer.Length;
        }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
    }
}
