using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using PathFinder.Adapter;
using PathFinder.Model;

namespace PathFinder.CapacityBench;

internal static class Input
{
    internal const int MaximumManifestBytes = 65536;
    internal const int MaximumSnapshotBytes = 256 * 1024 * 1024;
    internal const int MaximumOutputBytes = 2 * 1024 * 1024;
    internal static JsonSerializerOptions Json { get; } = new(PathfinderAdapter.JsonOptions);
    internal static string Hash(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    internal static string HashValue(object value) => Hash(JsonSerializer.SerializeToUtf8Bytes(value, Json));
    internal static void Duplicates(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject())
            { if (!seen.Add(property.Name)) throw new ArgumentException("Duplicate JSON member."); Duplicates(property.Value); }
        }
        else if (value.ValueKind == JsonValueKind.Array) foreach (var child in value.EnumerateArray()) Duplicates(child);
    }
    internal static byte[] ReadFile(string filename, int limit)
    {
        AbsoluteSafePath(filename);
        var info = new FileInfo(filename);
        if (!info.Exists || info.Length < 1 || info.Length > limit) throw new ArgumentException("Input file is missing or outside its byte budget.");
        using var stream = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var output = new MemoryStream(); var buffer = new byte[8192]; int count;
        while ((count = stream.Read(buffer)) > 0)
        { if (output.Length + count > limit) throw new ArgumentException("Input file exceeds its byte budget."); output.Write(buffer, 0, count); }
        return output.ToArray();
    }
    internal static BenchManifest ReadManifest(string filename)
    {
        var bytes = ReadFile(filename, MaximumManifestBytes);
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 48 }); Duplicates(document.RootElement);
        var settings = document.RootElement.GetProperty("request").GetProperty("projectSettings");
        foreach (var name in new[] { "secondaryTrayLength", "endConnectionLength", "additionalBendingPercent" })
        {
            var value = settings.GetProperty(name);
            if (value.ValueKind != JsonValueKind.String && !(name == "secondaryTrayLength" && value.ValueKind == JsonValueKind.Null))
                throw new ArgumentException("Project Details decimal values must be explicit decimal strings, or null SECONDARY.");
            if (value.ValueKind == JsonValueKind.String && value.GetString()!.Length > 100) throw new ArgumentException("Decimal token outside budget.");
        }
        var manifest = JsonSerializer.Deserialize<BenchManifest>(bytes, Json) ?? throw new ArgumentException("Manifest cannot be null.");
        Validate(manifest);
        if (!Within(manifest.Snapshot.Path, System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(filename))!))
            throw new ArgumentException("Copied snapshot must be below the manifest's mounted input directory.");
        return manifest;
    }
    internal static void Validate(BenchManifest manifest)
    {
        if (manifest.SchemaVersion != "pathfinder.capacity.input.v1" || string.IsNullOrWhiteSpace(manifest.Label) || manifest.Label.Length > 200 || manifest.Label.Any(char.IsControl))
            throw new ArgumentException("Unsupported manifest version or label.");
        if (manifest.Snapshot is null || manifest.Request is null || manifest.Request.Options is null || manifest.Request.ProjectSettings is null)
            throw new ArgumentException("Snapshot and explicit calculation/settings inputs are required.");
        if (!Regex.IsMatch(manifest.Snapshot.Sha256, "^[a-f0-9]{64}$") || !Regex.IsMatch(manifest.Snapshot.ContentSha256, "^[a-f0-9]{64}$")
            || !Guid.TryParseExact(manifest.Snapshot.ProjectId, "D", out _) || !Guid.TryParseExact(manifest.Snapshot.ModelVersionId, "D", out _))
            throw new ArgumentException("Snapshot identity or SHA256 is invalid.");
        AbsoluteSafePath(manifest.Snapshot.Path);
        if (manifest.RepeatQueries is < 1 or > 64 || manifest.CaseTimeoutMilliseconds is < 100 or > 60000
            || manifest.TotalTimeoutMilliseconds < manifest.CaseTimeoutMilliseconds || manifest.TotalTimeoutMilliseconds > 300000
            || manifest.SyntheticSizes is null || manifest.SyntheticSizes.Length is < 1 or > 4 || manifest.SyntheticSizes.Distinct().Count() != manifest.SyntheticSizes.Length
            || manifest.SyntheticSizes.Any(size => size is not (8 or 64 or 256 or 1024))) throw new ArgumentException("Benchmark work/time/size budget is invalid.");
        ValidateRequest(manifest.Request);
    }
    internal static void ValidateRequest(CalculationInput request)
    {
        if (request.Category is not ("MV" or "LV" or "Control" or "Instrumentation")) throw new ArgumentException("Unknown category.");
        foreach (var point in new[] { request.From, request.To }) if (point is null || point.Length != 3 || point.Any(value => !double.IsFinite(value) || Math.Abs(value) > 1e9)) throw new ArgumentException("Finite bounded endpoints are required.");
        var o = request.Options;
        if (!double.IsFinite(o.ConnectionToleranceMeters) || o.ConnectionToleranceMeters <= 0 || o.ConnectionToleranceMeters > 100
            || !double.IsFinite(o.SampleSpacingMeters) || o.SampleSpacingMeters <= 0 || o.SampleSpacingMeters > 100
            || !double.IsFinite(o.SecondaryDistanceMeters) || o.SecondaryDistanceMeters < 0 || o.SecondaryDistanceMeters > 1e6
            || o.MaxGraphNodes is < 2 or > 1000000 || o.MaxGraphConnections is < 1 or > 4000000) throw new ArgumentException("Routing options are outside existing server guards.");
        if (request.ConnectionGap is null || request.ConnectionGap.Length > 100 || !double.TryParse(request.ConnectionGap, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var gap)
            || !double.IsFinite(gap) || gap <= 0 || gap != o.ConnectionToleranceMeters) throw new ArgumentException("Frozen Project Details gap must match explicit routing options.");
        var s = request.ProjectSettings;
        if (!long.TryParse(s.Revision, NumberStyles.None, CultureInfo.InvariantCulture, out var revision) || revision < 0 || s.SecondaryTrayLength < 0 || s.EndConnectionLength < 0 || s.AdditionalBendingPercent < 0)
            throw new ArgumentException("Project Details revision or allowances are invalid.");
    }
    internal static byte[] Snapshot(SnapshotInput input, CancellationToken token)
    {
        token.ThrowIfCancellationRequested(); var bytes = ReadFile(input.Path, MaximumSnapshotBytes);
        if (Hash(bytes) != input.Sha256) throw new ArgumentException("Copied snapshot SHA256 mismatch before parsing.");
        var snapshot = SnapshotReader.Read(bytes, cancellation: token);
        if (snapshot.Model.ProjectId != input.ProjectId || snapshot.Model.ModelVersionId != input.ModelVersionId || snapshot.Model.ContentSha256 != input.ContentSha256)
            throw new ArgumentException("Copied snapshot project/model/content identity mismatch.");
        if (snapshot.Capture.LookupRouteCodes is not null) throw new ArgumentException("Capacity calculation requires a planning snapshot, not an independent lookup artifact.");
        return bytes;
    }
    internal static void AbsoluteSafePath(string filename)
    {
        if (string.IsNullOrWhiteSpace(filename) || !System.IO.Path.IsPathFullyQualified(filename)) throw new ArgumentException("Absolute paths are required.");
        for (var current = System.IO.Path.GetFullPath(filename); current is not null; current = System.IO.Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new ArgumentException("Benchmark paths cannot cross symlinks or reparse points.");
    }
    internal static bool Within(string filename, string root) => System.IO.Path.GetFullPath(filename).StartsWith(System.IO.Path.GetFullPath(root).TrimEnd(System.IO.Path.DirectorySeparatorChar) + System.IO.Path.DirectorySeparatorChar,
        OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
    internal static void CreateWorkRoot(string root)
    {
        AbsoluteSafePath(root); var full = System.IO.Path.GetFullPath(root);
        if (System.IO.Path.GetDirectoryName(full) is null || File.Exists(full) || Directory.Exists(full)) throw new ArgumentException("Work root must be a new absent child directory.");
        Directory.CreateDirectory(full);
        using var ownership = new FileStream(System.IO.Path.Combine(full, ".capacity-owned"), FileMode.CreateNew, FileAccess.Write);
        ownership.Write(JsonSerializer.SerializeToUtf8Bytes(new { schemaVersion = "pathfinder.capacity.work.v1", nonce = Guid.NewGuid(), createdAtUtc = DateTimeOffset.UtcNow }, Json));
    }
    internal static void NewFile(string filename, ReadOnlySpan<byte> bytes)
    { AbsoluteSafePath(filename); using var output = new FileStream(filename, FileMode.CreateNew, FileAccess.Write, FileShare.None); output.Write(bytes); output.Flush(true); }
}
