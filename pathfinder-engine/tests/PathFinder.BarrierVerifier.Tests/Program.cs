using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Barriers;
using PathFinder.BarrierVerifier;
using static Fixtures;

internal static class Program
{
    private static readonly List<object> Checks = []; private static int failures;
    private static int Main()
    {
        Run("closed wall qualifies provided geometry without SDK authority", () => { var r = Ready(Capture()); Need(r.Receipt.Evidence!.ComputationalMeshes == 1); Need(!r.Receipt.Evidence.SdkCoverageVerified && !r.Receipt.Evidence.EngineeringAccepted); Need(r.Receipt.Evidence.Coverage == "provided-fragments-only"); Status(r, P(-1), P(1), BarrierSegmentStatus.Blocked); });
        Run("generic obstacle kind preserves opening geometry and provided-only qualification", () => { var capture = Capture(Frame(), splitTriangles: true); capture["selectedParents"]![0]!["kind"] = "obstacle"; var r = Ready(capture); Need(r.Receipt.Evidence!.ComputationalMeshes == 1 && !r.Receipt.Evidence.SdkCoverageVerified && !r.Receipt.Evidence.EngineeringAccepted); Status(r, P(-1), P(1), BarrierSegmentStatus.Clear); Status(r, P(-1, 1), P(1, 1), BarrierSegmentStatus.Blocked); });
        Run("existing structural kinds remain supported and undeclared obstacle kinds refuse", () => { foreach (string kind in new[] { "wall", "partition", "floor", "ceiling" }) { var capture = Capture(); capture["selectedParents"]![0]!["kind"] = kind; Ready(capture); } foreach (string kind in new[] { "pipe", "tank", "mixed", "Obstacle", "", "unknown" }) { var capture = Capture(); capture["selectedParents"]![0]!["kind"] = kind; Refused(capture); } });
        Run("triangles across twelve fragments exact-weld into one closed shell", () => { var r = Ready(Capture(splitTriangles: true)); Need(r.Qualified!.Fragments.Count == 12 && r.Qualified.Meshes.Count == 1); Need(r.Qualified.Meshes[0].TriangleSources.Select(s => s.FragmentId).Distinct().Count() == 12); Status(r, P(-1), P(1), BarrierSegmentStatus.Blocked); });
        Run("one fragment shared by overlapping selections is processed once", () => { var r = Ready(Capture(sharedParents: true)); Need(r.Receipt.Evidence!.FragmentCount == 1 && r.Receipt.Evidence.TriangleCount == 12); Need(r.Qualified!.Meshes[0].TriangleSources.All(s => s.ParentSelectionIds.Count == 2)); });
        Run("connected watertight frame preserves actual opening", () => { var r = Ready(Capture(Frame())); Status(r, P(-1), P(1), BarrierSegmentStatus.Clear); Status(r, P(-1, 1), P(1, 1), BarrierSegmentStatus.Blocked); Status(r, P(.1), P(.1), BarrierSegmentStatus.Clear); });
        Run("partitioned connected frame preserves actual opening", () => Status(Ready(Capture(Frame(), splitTriangles: true)), P(-1), P(1), BarrierSegmentStatus.Clear));
        Run("two disconnected noncontained solids decompose with provenance", () => { var r = Ready(Capture(Merge(Box(), Box(x0: 5, x1: 5.2)))); Need(r.Qualified!.Meshes.Count == 2); Need(r.Qualified.Meshes.All(m => m.TriangleSources.Count == 12)); });
        Run("inner closed shell is refused instead of filling a possible cavity", () => Refused(Capture(Merge(Box(-3, 3, -3, 3, -3, 3), Box(-1, 1, -1, 1, -1, 1)))));
        Run("explicitly partial observation cannot qualify", () => MutateRefuse(n => n["observation"]!["state"] = "partial"));
        Run("unavailable fragment cannot qualify", () => MutateRefuse(n => n["observation"]!["unavailableFragmentIds"] = new JsonArray(1)));
        Run("missing enumerated fragment refuses", () => MutateRefuse(n => n["observation"]!["enumeratedFragmentIds"] = new JsonArray(1, 2)));
        Run("duplicate fragment ID refuses", () => { var n = Capture(splitTriangles: true); n["fragments"]![1]!["source"]!["fragmentId"] = 1; Refused(n); });
        Run("duplicate parent membership refuses", () => MutateRefuse(n => n["fragments"]![0]!["source"]!["parentSelectionIds"] = new JsonArray(Id(201), Id(201))));
        Run("foreign parent membership refuses", () => MutateRefuse(n => n["fragments"]![0]!["source"]!["parentSelectionIds"] = new JsonArray(Id(999))));
        Run("unknown claimed ready authority refuses", () => MutateRefuse(n => n["ready"] = true));
        Run("unknown verified observation authority refuses", () => MutateRefuse(n => n["observation"]!["verification"] = "verified"));
        Run("scope trailing newline revision refuses", () => MutateRefuse(n => n["scope"]!["selectionRevision"] = "1\n"));
        Run("scope overflowing revision refuses", () => MutateRefuse(n => n["scope"]!["selectionRevision"] = "9223372036854775808"));
        Run("source owner newline refuses", () => MutateRefuse(n => n["fragments"]![0]!["source"]!["ownerObjectId"] = "dbid:10\n"));
        Run("source singular transform refuses", () => MutateRefuse(n => n["fragments"]![0]!["source"]!["sourceToWorldMetres"]![0] = 0));
        Run("wrong coordinate frame refuses", () => MutateRefuse(n => n["scope"]!["coordinateFrame"] = "viewer-display"));
        Run("open triangles refuse instead of fabricating a wall", () => { var b = Box(); Refused(Capture(b with { Indices = b.Indices.Skip(3).ToArray() })); });
        Run("repeated physical triangle refuses rather than silent removal", () => { var b = Box(); Refused(Capture(b with { Indices = b.Indices.Concat(b.Indices.Take(3)).ToArray() })); });
        Run("one reversed triangle refuses", () => { var b = Box(); var indices = b.Indices.ToArray(); (indices[0], indices[1]) = (indices[1], indices[0]); Refused(Capture(b with { Indices = indices })); });
        Run("bounds excluding a vertex refuse", () => MutateRefuse(n => n["fragments"]![0]!["bounds"]!["minimum"]![0] = .1));
        Run("out of range triangle index refuses", () => MutateRefuse(n => n["fragments"]![0]!["triangleIndices"]![0] = 100));
        Run("raw exact input bytes determine capture hash", () => { var bytes = Bytes(Capture()); var extra = bytes.Concat(new byte[] { 10 }).ToArray(); var a = BarrierCaptureVerifier.Verify(bytes); var b = BarrierCaptureVerifier.Verify(extra); Need(a.Receipt.Status == "geometry-qualified" && b.Receipt.Status == "geometry-qualified"); Need(a.Receipt.CaptureSha256 == BarrierCaptureVerifier.Hash(bytes) && b.Receipt.CaptureSha256 == BarrierCaptureVerifier.Hash(extra)); Need(a.Receipt.CaptureSha256 != b.Receipt.CaptureSha256); });
        Run("deterministic raw input repeats decomposition and verification digests", () => { var bytes = Bytes(Capture(Frame(), true)); var a = BarrierCaptureVerifier.Verify(bytes); var b = BarrierCaptureVerifier.Verify(bytes); Need(a.Receipt.Evidence!.DecompositionSha256 == b.Receipt.Evidence!.DecompositionSha256 && a.Receipt.Evidence.VerificationSha256 == b.Receipt.Evidence.VerificationSha256); });
        Run("perfragment counts and source hashes are retained", () => { var r = Ready(Capture(splitTriangles: true)); Need(r.Qualified!.Fragments.All(f => f.Vertices == 3 && f.Triangles == 1 && f.SourceSha256.Length == 64)); });
        Run("strict duplicate JSON members refuse", () => { string text = Encoding.UTF8.GetString(Bytes(Capture())); RefusedBytes(Encoding.UTF8.GetBytes(text.Replace("\"schemaVersion\":", "\"schemaVersion\":\"other\",\"schemaVersion\":", StringComparison.Ordinal))); });
        Run("malformed UTF8 refuses", () => RefusedBytes([255, 255]));
        Run("unpaired escaped surrogate refuses", () => { string text = Encoding.UTF8.GetString(Bytes(Capture())); RefusedBytes(Encoding.UTF8.GetBytes(text.Replace("selected wall", "\\ud800", StringComparison.Ordinal))); });
        Run("nonfinite JSON magnitude refuses", () => { string text = Encoding.UTF8.GetString(Bytes(Capture())); RefusedBytes(Encoding.UTF8.GetBytes(text.Replace("\"metresPerSourceUnit\":1", "\"metresPerSourceUnit\":1e309", StringComparison.Ordinal))); });
        Run("truncated input refuses", () => { var bytes = Bytes(Capture()); RefusedBytes(bytes[..^1]); });
        Run("many tiny point arrays refuse before DTO or kernel allocation", () =>
        {
            var node = Capture(); string original = node["fragments"]![0]!["verticesMetres"]!.ToJsonString();
            string text = Encoding.UTF8.GetString(Bytes(node));
            string excessive = "[" + string.Join(",", Enumerable.Repeat("[0,0,0]", 500_001)) + "]";
            var bytes = Encoding.UTF8.GetBytes(text.Replace(original, excessive, StringComparison.Ordinal));
            Need(bytes.Length < 32 * 1024 * 1024);
            var result = BarrierCaptureVerifier.Verify(bytes);
            Need(result.Qualified is null && result.Receipt.Status == "refused" && result.Receipt.Diagnostics.Any(d => d.Code == "ARRAY_COUNT_LIMIT"));
        });
        Run("scalar root refuses as user data rather than throwing", () => RefusedBytes(Encoding.UTF8.GetBytes("42")));
        Run("missing required field refuses", () => { var n = Capture(); n.Remove("captureId"); Refused(n); });
        Run("vertex quota refuses", () => Refused(Capture(), new() { MaximumVertices = 7 }));
        Run("triangle quota refuses", () => Refused(Capture(), new() { MaximumTriangles = 11 }));
        Run("fragment quota refuses", () => Refused(Capture(splitTriangles: true), new() { MaximumFragments = 1 }));
        Run("parent quota refuses", () => Refused(Capture(sharedParents: true), new() { MaximumParents = 1 }));
        Run("shell quota refuses", () => Refused(Capture(Merge(Box(), Box(5, 5.2))), new() { MaximumComputationalMeshes = 1 }));
        Run("work budget refuses", () => Refused(Capture(), new() { MaximumWork = 1 }));
        Run("invalid deadline refuses", () => Refused(Capture(), new() { MaximumMilliseconds = 0 }));
        Run("bytes quota refuses without hashing truncated data", () => { var bytes = Bytes(Capture()); var r = BarrierCaptureVerifier.Verify(bytes, new() { MaximumBytes = bytes.Length - 1 }); Need(r.Receipt.Status == "refused" && r.Receipt.CaptureSha256 is null && r.Qualified is null); });
        Run("already cancelled verifier throws", () => { using var c = new CancellationTokenSource(); c.Cancel(); try { BarrierCaptureVerifier.Verify(Bytes(Capture()), cancellationToken: c.Token); } catch (OperationCanceledException) { return; } throw new InvalidOperationException("Cancellation was ignored."); });
        Run("receipt has bounded closed geometry-only protocol", () => { var bytes = BarrierCaptureVerifier.ReceiptBytes(Ready(Capture()).Receipt); Need(bytes.Length < BarrierCaptureVerifier.MaximumReceiptBytes); using var doc = JsonDocument.Parse(bytes); Need(doc.RootElement.GetProperty("schemaVersion").GetString() == "wfc.pf.barrier-verification-result.v1"); Need(!doc.RootElement.GetProperty("evidence").GetProperty("sdkCoverageVerified").GetBoolean()); });
        Run("CLI verifies exact stdin and emits one bounded receipt", () => { var bytes = Bytes(Capture()); var output = Cli(bytes, []); using var doc = JsonDocument.Parse(output); Need(doc.RootElement.GetProperty("status").GetString() == "geometry-qualified" && doc.RootElement.GetProperty("captureSha256").GetString() == BarrierCaptureVerifier.Hash(bytes)); });
        Run("CLI rejects arbitrary filesystem arguments", () => { using var doc = JsonDocument.Parse(Cli([], ["C:/not-a-verifier-input.json"])); Need(doc.RootElement.GetProperty("status").GetString() == "refused"); });
        Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.barrier-verifier-tests.v1", status = failures == 0 ? "PASS" : "FAIL", passed = Checks.Count - failures, failed = failures,
            scope = "synthetic fragment qualification and bounded stdin protocol; no SDK coverage, storage publication or engineering acceptance", checks = Checks }));
        return failures == 0 ? 0 : 1;
    }
    private static void Run(string name, Action action) { try { action(); Checks.Add(new { name, status = "PASS", detail = "" }); } catch (Exception e) { failures++; Checks.Add(new { name, status = "FAIL", detail = e.GetType().Name + ": " + e.Message }); } }
    private static void Need(bool condition) { if (!condition) throw new InvalidOperationException("Synthetic verifier assertion failed."); }
    private static BarrierVerificationResult Ready(JsonNode capture) { var result = BarrierCaptureVerifier.Verify(Bytes(capture)); Need(result.Receipt.Status == "geometry-qualified" && result.Qualified is not null && result.Receipt.Evidence is not null); return result; }
    private static void Refused(JsonNode capture, BarrierVerifierLimits? limits = null) { var result = BarrierCaptureVerifier.Verify(Bytes(capture), limits); Need(result.Receipt.Status == "refused" && result.Qualified is null && result.Receipt.Evidence is null && result.Receipt.Diagnostics.Count > 0); }
    private static void RefusedBytes(byte[] capture) { var result = BarrierCaptureVerifier.Verify(capture); Need(result.Receipt.Status == "refused" && result.Qualified is null && result.Receipt.Diagnostics.Count > 0); }
    private static void MutateRefuse(Action<JsonObject> mutate) { var node = Capture(); mutate(node); Refused(node); }
    private static void Status(BarrierVerificationResult result, BarrierPoint first, BarrierPoint last, BarrierSegmentStatus expected) => Need(result.Qualified!.Kernel.CheckSegment(first, last).Status == expected);
    private static byte[] Cli(byte[] input, string[] args)
    {
        var info = new ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.ArgumentList.Add(typeof(BarrierCaptureVerifier).Assembly.Location); foreach (var arg in args) info.ArgumentList.Add(arg);
        using var child = Process.Start(info) ?? throw new InvalidOperationException("Verifier CLI did not start.");
        using var timeout = new CancellationTokenSource(10_000);
        try
        {
            var output = child.StandardOutput.ReadToEndAsync(timeout.Token); var errors = child.StandardError.ReadToEndAsync(timeout.Token);
            child.StandardInput.BaseStream.Write(input); child.StandardInput.Close(); child.WaitForExitAsync(timeout.Token).GetAwaiter().GetResult();
            var text = output.GetAwaiter().GetResult(); Need(child.ExitCode == 0 && errors.GetAwaiter().GetResult().Length == 0);
            var bytes = Encoding.UTF8.GetBytes(text); Need(bytes.Length <= BarrierCaptureVerifier.MaximumReceiptBytes + 2); return bytes;
        }
        finally { if (!child.HasExited) child.Kill(entireProcessTree: true); }
    }
}
