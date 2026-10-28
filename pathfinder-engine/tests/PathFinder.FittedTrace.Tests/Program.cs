using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Model;

namespace PathFinder.FittedTrace.Tests;

internal static class TestProgram
{
    private static readonly List<object> Checks = [];
    private static int failures;
    private static void Check(string name, bool passed) { Checks.Add(new { name, status = passed ? "PASS" : "FAIL" }); if (!passed) failures++; }
    private static void Reject(string name, Action operation, Type? expected = null)
    {
        try { operation(); Check(name, false); }
        catch (Exception error) { Check(name, expected is null || expected.IsInstanceOfType(error)); }
    }
    private static readonly FittedTraceExportRequest Request = new() { SchemaVersion = FittedTraceExporter.RequestSchema, ExportId = "d0000000-0000-4000-8000-000000000001", MaxBytes = FittedTraceExporter.MaximumBytes };
    private static byte[] Encode(PreparedModel prepared, FittedTraceExportRequest? request = null)
    {
        using var bytes = new MemoryStream();
        var reference = FittedTraceExporter.Write(bytes, prepared, request ?? Request, FittedTraceExporter.Engine(CancellationToken.None), CancellationToken.None);
        var result = bytes.ToArray();
        Check("stream-hash-and-byte-reference", reference.Bytes == result.Length && reference.Sha256 == Convert.ToHexString(SHA256.HashData(result)).ToLowerInvariant());
        return result;
    }
    private static int Main(string[] args)
    {
        if (args is not ["--work-root", var work] || !Path.IsPathFullyQualified(work) || Directory.Exists(work)) return 2;
        Directory.CreateDirectory(work);
        try
        {
            var source = Snapshot(); var bytes = JsonSerializer.SerializeToUtf8Bytes(source, SnapshotReader.JsonOptions);
            var cachePath = Path.Combine(work, "cache"); var cache = new FittedModelCache(cachePath);
            var cold = cache.GetOrBuild(bytes); var warm = cache.GetOrBuild(bytes); var disk = new FittedModelCache(cachePath).GetOrBuild(bytes);
            Check("fresh-memory-disk-real-fit-modes", !cold.LoadedFromDisk && ReferenceEquals(cold, warm) && disk.LoadedFromDisk);
            var first = Encode(cold); Check("identical-cold-memory-disk-export", first.SequenceEqual(Encode(warm)) && first.SequenceEqual(Encode(disk)));
            var before = new RouteCalculator().Calculate(cold.Segments, new RoutePoint(0, 0, 0.5), new RoutePoint(10, 0, 0.5), CableCategory.Control);
            _ = Encode(cold);
            var after = new RouteCalculator().Calculate(cold.Segments, new RoutePoint(0, 0, 0.5), new RoutePoint(10, 0, 0.5), CableCategory.Control);
            Check("export-does-not-change-routing-math-order", before.Success && after.Success && before.LengthMeters == after.LengthMeters && before.PathPoints.SequenceEqual(after.PathPoints) && before.RouteText == after.RouteText);
            var ordered = Ordered(); var exported = Encode(ordered); using var parsed = JsonDocument.Parse(exported);
            var segment = parsed.RootElement.GetProperty("segments")[0];
            Check("exact-segment-point-port-order", segment.GetProperty("objectId").GetString() == "dbid:9" && segment.GetProperty("pointsMetres")[0][0].GetDouble() == 3 && segment.GetProperty("pointsMetres")[2][1].GetDouble() == 4 && segment.GetProperty("ports")[0].GetProperty("pointMetres")[0].GetDouble() == 3);
            var sum = ordered.Segments[0].Points[0].DistanceTo(ordered.Segments[0].Points[1]) + ordered.Segments[0].Points[1].DistanceTo(ordered.Segments[0].Points[2]);
            Check("csharp-left-to-right-length-round-trip", segment.GetProperty("geometricLengthMetres").GetDouble() == sum && segment.GetProperty("geometricLengthRoundTrip").GetString() == sum.ToString("R", CultureInfo.InvariantCulture));
            var diagonal = parsed.RootElement.GetProperty("segments")[1];
            Check("binary64-diagonal-length-and-unsorted-membership", diagonal.GetProperty("objectId").GetString() == "dbid:2" && diagonal.GetProperty("geometricLengthMetres").GetDouble() == 2 * Math.Sqrt(3) && diagonal.GetProperty("geometricLengthRoundTrip").GetString() == (2 * Math.Sqrt(3)).ToString("R", CultureInfo.InvariantCulture));
            Check("full-diagnostics-not-truncated", parsed.RootElement.GetProperty("diagnostics").GetArrayLength() == 2051 && parsed.RootElement.GetProperty("counts").GetProperty("diagnostics").GetInt32() == 2051);
            Check("classification-and-engineering-not-invented", segment.GetProperty("fitStatus").GetString() == "unknown" && !parsed.RootElement.GetProperty("engineeringAccepted").GetBoolean());
            var engine = parsed.RootElement.GetProperty("engine");
            Check("actual-module-digests", engine.GetProperty("runnerSha256").GetString() == Hash(typeof(global::Program).Assembly.Location) && engine.EnumerateObject().Where(p => p.Name != "version").All(p => p.Value.GetString() is { Length: 64 } value && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f')));
            foreach (var invalid in new[] { Request with { SchemaVersion = "unknown" }, Request with { ExportId = "../escape" }, Request with { ExportId = Request.ExportId.ToUpperInvariant() }, Request with { MaxBytes = 1023 }, Request with { MaxBytes = FittedTraceExporter.MaximumBytes + 1 } }) Reject("strict-export-request", () => FittedTraceExporter.Validate(invalid), typeof(ArgumentException));
            Reject("unknown-export-request-fields-rejected", () => JsonSerializer.Deserialize<FittedTraceExportRequest>("{\"schemaVersion\":\"wfc.pf.fitted-trace-export-request.v1\",\"exportId\":\"" + Request.ExportId + "\",\"maxBytes\":1024,\"path\":\"foreign\"}", SnapshotReader.JsonOptions), typeof(JsonException));
            Reject("stream-byte-budget-no-truncation", () => Encode(ordered, Request with { MaxBytes = 1024 }), typeof(ArgumentException));
            using (var cancelled = new CancellationTokenSource()) { cancelled.Cancel(); Reject("cancel-before-stream", () => FittedTraceExporter.Write(Stream.Null, cold, Request, FittedTraceExporter.Engine(CancellationToken.None), cancelled.Token), typeof(OperationCanceledException)); }
            Reject("transient-byte-admission-before-write", () => FittedTraceExporter.AdmitTransient(FittedTraceExporter.MaximumTransientBytes - 1023, 1, 1024), typeof(IOException));
            Reject("transient-entry-admission-before-write", () => FittedTraceExporter.AdmitTransient(0, FittedTraceExporter.MaximumEntries, 1024), typeof(IOException));
            FileCases(work, cold);
            OrdinaryPrepare(work, bytes);
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.fitted-trace-test-receipt.v1", scope = "isolated-synthetic-CSharp;directory-sync-callback-mocked;actual-Linux-durability-NOT_RUN", status = failures == 0 ? "PASS" : "FAIL", passed = Checks.Count - failures, failed = failures, checks = Checks }));
            return failures == 0 ? 0 : 1;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 2; }
    }
    private static void FileCases(string work, PreparedModel prepared)
    {
        var root = Path.GetFullPath(Path.Combine(work, "owned")); Directory.CreateDirectory(root); var synced = new List<string>();
        var first = FittedTraceExporter.Export(root, prepared, Request, CancellationToken.None, synced.Add);
        var directory = Path.Combine(root, "fitted-traces"); var final = Path.Combine(directory, Request.ExportId + ".json");
        var exact = File.ReadAllBytes(final); var replay = FittedTraceExporter.Export(root, prepared, Request, CancellationToken.None, synced.Add);
        Check("exclusive-write-readback-and-exact-replay", first == replay && exact.SequenceEqual(File.ReadAllBytes(final)) && !File.Exists(Path.Combine(directory, Request.ExportId + ".tmp")));
        Check("directory-sync-boundaries-invoked", synced.Count >= 6 && synced[0] == root && synced[^1] == directory);
        File.AppendAllText(final, " "); Reject("foreign-or-tampered-target-no-overwrite", () => FittedTraceExporter.Export(root, prepared, Request, CancellationToken.None, synced.Add), typeof(IOException));
        Check("tampered-target-retained", File.ReadAllBytes(final).Length == exact.Length + 1);
        var incomplete = Request with { ExportId = Guid.NewGuid().ToString("D") }; var temporary = Path.Combine(directory, incomplete.ExportId + ".tmp"); File.WriteAllText(temporary, "partial");
        Reject("incomplete-crash-path-preserved", () => FittedTraceExporter.Export(root, prepared, incomplete, CancellationToken.None, synced.Add), typeof(IOException)); Check("incomplete-bytes-not-deleted", File.ReadAllText(temporary) == "partial");
        var syncRoot = Path.Combine(work, "sync-failure"); Directory.CreateDirectory(syncRoot); var syncRequest = Request with { ExportId = Guid.NewGuid().ToString("D") };
        Reject("failed-final-directory-sync-is-not-success", () => FittedTraceExporter.Export(syncRoot, prepared, syncRequest, CancellationToken.None, path => { if (File.Exists(Path.Combine(path, syncRequest.ExportId + ".json"))) throw new IOException("Synthetic final directory sync failure"); }), typeof(IOException));
        Check("uncertain-final-file-retained", File.Exists(Path.Combine(syncRoot, "fitted-traces", syncRequest.ExportId + ".json")));
        Check("completed-file-reconciles-after-sync-ack-loss", FittedTraceExporter.Export(syncRoot, prepared, syncRequest, CancellationToken.None, _ => { }).ExportId == syncRequest.ExportId);
        var cancelledRoot = Path.Combine(work, "cancelled"); Directory.CreateDirectory(cancelledRoot); var cancelledRequest = Request with { ExportId = Guid.NewGuid().ToString("D") };
        using (var cancellation = new CancellationTokenSource())
        {
            Reject("cancelled-partial-write-preserves-owned-temporary", () => FittedTraceExporter.Export(cancelledRoot, prepared, cancelledRequest, cancellation.Token, path => { if (File.Exists(Path.Combine(path, cancelledRequest.ExportId + ".tmp"))) cancellation.Cancel(); }), typeof(OperationCanceledException));
            Check("cancelled-stage-never-acknowledged-or-deleted", File.Exists(Path.Combine(cancelledRoot, "fitted-traces", cancelledRequest.ExportId + ".tmp")) && !File.Exists(Path.Combine(cancelledRoot, "fitted-traces", cancelledRequest.ExportId + ".json")));
        }
        var unknown = Path.Combine(directory, "unknown.foreign"); File.WriteAllText(unknown, "retain");
        Reject("unknown-staging-child-preserved", () => FittedTraceExporter.Export(root, prepared, Request with { ExportId = Guid.NewGuid().ToString("D") }, CancellationToken.None, synced.Add), typeof(IOException)); Check("unknown-file-not-deleted", File.ReadAllText(unknown) == "retain");
    }
    private static void OrdinaryPrepare(string work, byte[] snapshot)
    {
        var root = Path.Combine(work, "ordinary"); Directory.CreateDirectory(Path.Combine(root, "snapshots")); var id = Guid.NewGuid().ToString("D");
        File.WriteAllBytes(Path.Combine(root, "snapshots", id + ".json"), snapshot); Environment.SetEnvironmentVariable("PF_ROOT", root);
        var request = new Request { SchemaVersion = "pathfinder.model.runner.v1", RequestId = Guid.NewGuid().ToString("D"), ProjectId = Snapshot().Model.ProjectId, ModelVersionId = Snapshot().Model.ModelVersionId, Operation = "prepare", SnapshotId = id, SnapshotSha256 = SnapshotReader.Sha256(snapshot), TimeoutMilliseconds = 10000 };
        var execute = typeof(global::Program).GetMethod("Execute", BindingFlags.NonPublic | BindingFlags.Static)!;
        using var response = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(execute.Invoke(null, [request, CancellationToken.None, null]), SnapshotReader.JsonOptions));
        var summary = response.RootElement.GetProperty("prepared");
        Check("ordinary-prepare-shape-unchanged", summary.EnumerateObject().Select(p => p.Name).SequenceEqual(new[] { "key", "readiness", "counts", "cacheScope", "loadedFromDisk", "objectCount", "segmentCount", "diagnosticCount", "diagnostics", "diagnosticsTruncated", "engineeringAccepted" }) && !Directory.Exists(Path.Combine(root, "fitted-traces")));
        var validate = typeof(global::Program).GetMethod("Validate", BindingFlags.NonPublic | BindingFlags.Static)!;
        Reject("export-for-nonprepare-refused", () => validate.Invoke(null, [request with { Operation = "calculate", FittedTraceExport = Request }]), typeof(TargetInvocationException));
    }
    private static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
    private static PreparedModel Ordered()
    {
        RoutePoint[] points = [new(3, 0, 0), new(0, 0, 0), new(0, 4, 0)];
        RouteConnectionPort[] ports = [new(points[0], new(1, 0, 0), new(0, 1, 0), new(0, 0, 1), 0.2, 0.1), new(points[^1], new(0, 1, 0), new(1, 0, 0), new(0, 0, 1), 0.2, 0.1)];
        return new(new string('a', 64), new string('b', 64), new string('c', 64), Snapshot().Model.ProjectId, Snapshot().Model.ModelVersionId, new string('d', 64), "needs_review", [new TraySegment("dbid:9", "/B009", CableCategory.MV | CableCategory.Control, points, true, ports), new TraySegment("dbid:2", "/B002", CableCategory.Control, [new(0, 0, 0), new(1, 1, 1), new(2, 2, 2)])], [new("dbid:9", null, 9, "Synthetic bend", "routing-leaf", "/B009", "BEND", "unknown", new(0, 0, 0)), new("dbid:2", null, 2, "Synthetic diagonal", "routing-leaf", "/B002", "STRAIGHT", "unknown", new(0, 0, 0))], new(0, 1, 0, 1, 0), Enumerable.Range(0, 2051).Select(i => "Synthetic diagnostic " + i).ToArray(), false);
    }
    private static ModelSnapshot Snapshot() => new()
    {
        SchemaVersion = "pathfinder.model.snapshot.v1", Model = new() { ProjectId = "d0000000-0000-4000-8000-000000000002", ModelVersionId = "d0000000-0000-4000-8000-000000000003", ContentSha256 = new string('a', 64) },
        Capture = new() { AdapterVersion = "synthetic-fitted-trace-test", SourceKind = "synthetic", InventoryComplete = false, GeometryComplete = false, UnitsVerified = false, TransformsVerified = false, PlanningVisibilityKnown = false, SourceLinkVerified = false, EvidenceSha256 = [] },
        Coordinates = new() { VertexFrame = "canonical-world-metres", SourceUnits = "m", MetresPerSourceUnit = 1, SourceToWorldMetres = null, GlobalOffsetMetres = [0, 0, 0], DisplayToWorldMetres = AffineTransform.Identity },
        Objects = [new() { Id = "dbid:1", DbId = 1, Name = "STRAIGHT", GeometryRole = "routing-leaf", LeafToRootNames = ["STRAIGHT", "/B001"], Properties = [], NativeHidden = null, PlanningExcluded = false, RouteName = "/B001", ShapeName = "STRAIGHT", CategoryAssignmentSource = "synthetic", AllowedCategories = ["Control"], Bounds = new() { Minimum = [0, -0.5, 0], Maximum = [10, 0.5, 1] }, Fragments = [] }]
    };
}
