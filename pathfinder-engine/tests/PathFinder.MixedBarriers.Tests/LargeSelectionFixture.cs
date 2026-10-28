using System.Text.Json;
using System.Text.Json.Nodes;
using System.Diagnostics;
using PathFinder.Barriers;
using PathFinder.BarrierVerifier;
using static Fixtures;
using static MixedFixtures;

internal static class LargeSelectionFixture
{
    internal static BarrierVerifierLimits Limits => new() { MaximumParents = 2048, MaximumComputationalMeshes = 2048 };
    internal static JsonObject CaptureMany(int count)
    {
        var seed = Capture(Wall()); var parents = new JsonArray(); var fragments = new JsonArray(); var enumerated = new JsonArray();
        for (int at = 0; at < count; at++)
        {
            string parentId = Id(10000 + at); int dbId = 10000 + at;
            var parent = seed["selectedParents"]![0]!.DeepClone();
            parent["selectionId"] = parentId; parent["objectId"] = "dbid:" + dbId; parent["dbId"] = dbId; parents.Add(parent);
            var mesh = at == 0 ? Ring() : Transform(Wall(), p => P(p.X + 100 + at * 3, p.Y, p.Z));
            var fragment = seed["fragments"]![0]!.DeepClone();
            fragment["source"]!["fragmentId"] = at + 1; fragment["source"]!["ownerObjectId"] = "dbid:" + dbId;
            fragment["source"]!["parentSelectionIds"] = new JsonArray(parentId);
            fragment["verticesMetres"] = JsonSerializer.SerializeToNode(mesh.Vertices.Select(p => new[] { p.X, p.Y, p.Z }));
            fragment["triangleIndices"] = JsonSerializer.SerializeToNode(mesh.Indices);
            fragment["bounds"] = JsonSerializer.SerializeToNode(new { minimum = new[] { mesh.Vertices.Min(p => p.X), mesh.Vertices.Min(p => p.Y), mesh.Vertices.Min(p => p.Z) },
                maximum = new[] { mesh.Vertices.Max(p => p.X), mesh.Vertices.Max(p => p.Y), mesh.Vertices.Max(p => p.Z) } });
            fragments.Add(fragment); enumerated.Add(at + 1);
        }
        seed["selectedParents"] = parents; seed["fragments"] = fragments; seed["observation"]!["enumeratedFragmentIds"] = enumerated; return seed;
    }
    internal static void Run(Action<string, Action> run, string? exportDirectory = null)
    {
        var bytes = Bytes(CaptureMany(2048)); MixedBarrierVerificationResult? qualified = null;
        void Need(bool value, string detail = "Large selection assertion failed.") { if (!value) throw new InvalidOperationException(detail); }
        run("explicit2048 capture qualifies all2048 disjoint original components under unchanged geometry budgets", () => {
            qualified = MixedBarrierCaptureVerifier.Verify(bytes, Limits, maximumReceiptBytes: 4194304);
            Need(qualified.Qualified is not null && qualified.Receipt.Status == "geometry-qualified", JsonSerializer.Serialize(qualified.Receipt));
            var evidence = qualified.Receipt.Evidence!;
            Need(evidence.FragmentCount == 2048 && evidence.ComponentMemberships.Count == 2048 && evidence.OriginalSurfaceComponents == 2048);
            Need(evidence.ComponentMemberships.SelectMany(c => c.ParentSelectionIds).Distinct().Count() == 2048);
            Need(qualified.Qualified!.Kernel.Summary.EstimatedBytes <= 134217728 && bytes.Length <= 33554432);
            byte[] receipt = MixedBarrierCaptureVerifier.ReceiptBytes(qualified.Receipt, 4194304); Need(receipt.Length > 65536 && receipt.Length <= 4194304);
        });
        run("explicit2048 kernel keeps actual opening clear and adjacent wall material blocked", () => {
            var kernel = qualified?.Qualified?.Kernel ?? throw new InvalidOperationException("Qualified fixture missing.");
            Need(kernel.CheckSegment(P(-1), P(1)).Status == MixedBarrierSegmentStatus.Clear);
            Need(kernel.CheckSegment(P(-1, 1), P(1, 1)).Status == MixedBarrierSegmentStatus.Blocked);
            Need(kernel.CheckSegment(P(102), P(104)).Status == MixedBarrierSegmentStatus.Blocked);
        });
        run("historical mixed and legacy verifiers retain128parent defaults and refuse2048capture", () => {
            Need(new BarrierVerifierLimits().MaximumParents == 128 && new BarrierVerifierLimits().MaximumComputationalMeshes == 256);
            Need(new MixedBarrierBuildLimits().MaximumParents == 128 && new BarrierLimits().MaximumMeshes == 256);
            Need(MixedBarrierCaptureVerifier.Verify(bytes).Qualified is null && BarrierCaptureVerifier.Verify(bytes).Qualified is null);
        });
        run("2049parents refuse in explicitly2048capture without truncation", () => {
            var result = MixedBarrierCaptureVerifier.Verify(Bytes(CaptureMany(2049)), Limits, maximumReceiptBytes: 4194304);
            Need(result.Qualified is null && result.Receipt.Status == "refused" && result.Receipt.Evidence is null);
        });
        run("2049disjoint components refuse independently even when they share justone selectedparent", () => {
            var capture = CaptureMany(2049); string parentId = capture["selectedParents"]![0]!["selectionId"]!.GetValue<string>();
            capture["selectedParents"] = new JsonArray(capture["selectedParents"]![0]!.DeepClone());
            foreach (var fragment in capture["fragments"]!.AsArray()) fragment!["source"]!["parentSelectionIds"] = new JsonArray(parentId);
            var result = MixedBarrierCaptureVerifier.Verify(Bytes(capture), Limits, maximumReceiptBytes: 4194304);
            Need(result.Qualified is null && result.Receipt.Diagnostics.Any(d => d.Code == "COMPONENT_LIMIT"));
        });
        run("explicit large mode never accepts a declaredlimit beyond2048", () => {
            foreach (var limit in new[] { Limits with { MaximumParents = 2049 }, Limits with { MaximumComputationalMeshes = 2049 } })
            {
                var result = MixedBarrierCaptureVerifier.Verify(bytes, limit, maximumReceiptBytes: 4194304);
                Need(result.Qualified is null && result.Receipt.Diagnostics.Any(d => d.Code == "INVALID_LIMITS"));
            }
        });
        run("larger verifier limits cannot silently expand the historical64KiBreceipt mode", () => {
            var result = MixedBarrierCaptureVerifier.Verify(bytes, Limits);
            Need(result.Qualified is null && result.Receipt.Diagnostics.Any(d => d.Code == "INVALID_LIMITS"));
            try { MixedBarrierCaptureVerifier.ReceiptBytes(qualified!.Receipt); }
            catch (Exception error) when (error.GetType().Name == "VerifierRefusal") { Need(error.Message.Contains("receipt byte bound", StringComparison.Ordinal)); return; }
            throw new InvalidOperationException("Historical receipt limit expanded.");
        });
        run("large selection membership allocations consume the unchanged estimated memory budget", () => {
            string[] parents = Enumerable.Range(0, 2048).Select(i => Id(10000 + i)).ToArray();
            var result = MixedBarrierKernel.Build([Input(Wall(), 1, parents)], new() { MaximumParents = 2048,
                Geometry = new() { MaximumMeshes = 2048, MaximumEstimatedBytes = 65536 } });
            Need(result.Kernel is null && result.Diagnostics.Any(d => d.Code == "ESTIMATED_MEMORY_LIMIT"));
        });
        run("onefragment sharing2048parents cannot amplify600componentmemberships beyond128MiB", () => {
            var pieces = Enumerable.Range(0, 600).Select(i => new Mesh([P(0, i * 3), P(0, i * 3 + 1), P(0, i * 3, 1)], [0, 1, 2])).ToArray();
            string[] parents = Enumerable.Range(0, 2048).Select(i => Id(10000 + i)).ToArray();
            var result = MixedBarrierKernel.Build([Input(Merge(pieces), 1, parents)], new() { MaximumParents = 2048, Geometry = new() { MaximumMeshes = 2048 } });
            Need(result.Kernel is null && result.Diagnostics.Any(d => d.Code == "ESTIMATED_MEMORY_LIMIT"));
        });
        run("explicit2048CLI emits one complete larger receipt for2048qualifiedcomponents", () => {
            var receipt = Cli(bytes, ["--mixed-v2-2048"], 4194304);
            Need(receipt.GetProperty("status").GetString() == "geometry-qualified" && receipt.GetProperty("captureSha256").GetString() == BarrierCaptureVerifier.Hash(bytes));
            Need(receipt.GetProperty("evidence").GetProperty("componentMemberships").GetArrayLength() == 2048);
        });
        run("historical mixedCLI retains128parent refusal on the identical2048capture", () => {
            var receipt = Cli(bytes, ["--mixed-v2"], 65536); Need(receipt.GetProperty("status").GetString() == "refused");
        });
        run("explicit2048CLI refuses2049parents instead of truncating a successfulreceipt", () => {
            var receipt = Cli(Bytes(CaptureMany(2049)), ["--mixed-v2-2048"], 4194304);
            Need(receipt.GetProperty("status").GetString() == "refused" && receipt.GetProperty("evidence").ValueKind == JsonValueKind.Null);
        });
        run("largeCLI mode requires the exactsingleexplicitargument", () => {
            var receipt = Cli([], ["--mixed-v2-2048", "--mixed-v2"], 65536);
            Need(receipt.GetProperty("status").GetString() == "refused" && receipt.GetProperty("schemaVersion").GetString() == "wfc.pf.barrier-verification-result.v1");
        });
        if (exportDirectory is not null) run("exports owned synthetic2048and2049 captures and independently checked receipt for Linux replay", () => {
            Need(Path.IsPathFullyQualified(exportDirectory) && !Directory.Exists(exportDirectory) && !File.Exists(exportDirectory), "Synthetic export must name a new absolute directory.");
            Directory.CreateDirectory(exportDirectory);
            void Write(string name, byte[] value) { using var stream = new FileStream(Path.Combine(exportDirectory, name), FileMode.CreateNew, FileAccess.Write); stream.Write(value); }
            var result = qualified ?? throw new InvalidOperationException("Qualified export fixture missing.");
            Write("capture-2048.json", bytes); var tooMany = Bytes(CaptureMany(2049)); Write("capture-2049.json", tooMany);
            byte[] receipt = MixedBarrierCaptureVerifier.ReceiptBytes(result.Receipt, 4194304); Write("receipt-2048.json", receipt);
            Write("summary.json", JsonSerializer.SerializeToUtf8Bytes(new { fixture = "synthetic-disjoint-original-wall-rings-and-surfaces", authority = "none", engineeringAccepted = false,
                parents = 2048, fragments = 2048, components = 2048, captureBytes = bytes.Length, captureSha256 = BarrierCaptureVerifier.Hash(bytes),
                receiptBytes = receipt.Length, receiptSha256 = BarrierCaptureVerifier.Hash(receipt), vertices = result.Receipt.Evidence!.VertexCount,
                triangles = result.Receipt.Evidence.TriangleCount, estimatedBytes = result.Qualified!.Kernel.Summary.EstimatedBytes,
                maximumBytes = 33554432, maximumEstimatedBytes = 134217728, maximumReceiptBytes = 4194304,
                refused2049CaptureBytes = tooMany.Length, refused2049CaptureSha256 = BarrierCaptureVerifier.Hash(tooMany),
                expectedOpening = "clear", expectedAdjacentMaterial = "blocked", oldMixedMode = "refused" }));
        });
    }
    private static JsonElement Cli(byte[] input, string[] arguments, int maximumBytes)
    {
        var info = new ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.ArgumentList.Add(typeof(MixedBarrierCaptureVerifier).Assembly.Location); foreach (string argument in arguments) info.ArgumentList.Add(argument);
        using var child = Process.Start(info) ?? throw new IOException("Synthetic verifier subprocess unavailable.");
        using var deadline = new CancellationTokenSource(30000);
        static async Task<byte[]> ReadBounded(Stream stream, int maximum, CancellationToken token)
        {
            using var memory = new MemoryStream(); byte[] buffer = new byte[32768];
            for (int read; (read = await stream.ReadAsync(buffer, token)) != 0;)
            { if (memory.Length + read > maximum) throw new IOException("Synthetic verifier output exceeded its declared ceiling."); memory.Write(buffer, 0, read); }
            return memory.ToArray();
        }
        var stdout = ReadBounded(child.StandardOutput.BaseStream, maximumBytes + 2, deadline.Token);
        var stderr = ReadBounded(child.StandardError.BaseStream, 65536, deadline.Token);
        try
        {
            child.StandardInput.BaseStream.WriteAsync(input, deadline.Token).AsTask().GetAwaiter().GetResult(); child.StandardInput.Close();
            child.WaitForExitAsync(deadline.Token).GetAwaiter().GetResult(); byte[] output = stdout.GetAwaiter().GetResult();
            if (child.ExitCode != 0 || stderr.GetAwaiter().GetResult().Length != 0) throw new IOException("Synthetic verifier subprocess refused its transport.");
            using var document = JsonDocument.Parse(output); return document.RootElement.Clone();
        }
        finally
        {
            if (!child.HasExited) { child.Kill(true); child.WaitForExit(); }
            try { Task.WhenAll(stdout, stderr).GetAwaiter().GetResult(); } catch { /* A failed bounded capture remains failed. */ }
        }
    }
}
