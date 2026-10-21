using System.Buffers.Binary;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PathFinder.RunnerSession.Tests;

internal static partial class TestProgram
{
    private static readonly List<object> Checks = [];
    private static int failures;
    private static void Check(string label, bool pass, object? detail = null) { Checks.Add(new { label, status = pass ? "PASS" : "FAIL", detail }); if (!pass) failures++; }
    private static async Task<int> Main(string[] args)
    {
        if (args is ["--worker-memory-probe"])
        {
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.worker-memory-probe.v1",
                gcTotalAvailableMemoryBytes = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes }));
            return 0;
        }
        if (args is ["--memory-phase-probe", var phaseRoot])
        {
            if (!Path.IsPathFullyQualified(phaseRoot) || !Directory.Exists(phaseRoot)) return 2;
            Environment.SetEnvironmentVariable("PF_ROOT", phaseRoot);
            for (var index = 0; index < 40; index++) PreparationMemoryTrace.Observe(PathFinder.Model.PreparationMemoryPhase.BeforeQuery);
            return 0;
        }
        if (args is ["--emit-corpus", var corpus]) { Console.WriteLine(Corpus.Emit(Path.GetFullPath(corpus))); return 0; }
        if (args is not ["--runner", var runner, "--work-root", var work] || !Path.IsPathFullyQualified(runner) || !Path.IsPathFullyQualified(work) || Directory.Exists(work)) return 2;
        Directory.CreateDirectory(work); var manifest = Corpus.Emit(Path.Combine(work, "corpus"));
        try
        {
            await Protocol();
            await WorkerMemoryPolicyChecks();
            using var doc = JsonDocument.Parse(File.ReadAllBytes(manifest));
            await CheckedPreparation(runner, Path.GetDirectoryName(manifest)!, Path.Combine(work, "checked-preparation"),
                doc.RootElement.GetProperty("cases")[0].GetProperty("request"));
            Process? session = null; var ordinal = 0; var observedPids = new HashSet<int>();
            try
            {
                foreach (var item in doc.RootElement.GetProperty("cases").EnumerateArray())
                {
                    var request = item.GetProperty("request"); var label = item.GetProperty("label").GetString()!;
                    var bytes = Encoding.UTF8.GetBytes(request.GetRawText());
                    var expected = await OneShot(runner, Path.GetDirectoryName(manifest)!, bytes);
                    if (session is null) { session = await Start(runner, Path.GetDirectoryName(manifest)!); observedPids.Add(session.Id); ordinal = 0; }
                    var actual = await Query(session, bytes, request.GetProperty("requestId").GetString()!, ++ordinal);
                    var response = actual.GetProperty("response");
                    Check("full-semantic-parity: " + label, Semantic(expected) == Semantic(response));
                    if (item.GetProperty("expectedStatus").ValueKind == JsonValueKind.String) Check("independent-status: " + label, response.GetProperty("status").GetString() == item.GetProperty("expectedStatus").GetString(), response.GetProperty("status").GetString());
                    if (item.GetProperty("expectedLengthMeters").ValueKind == JsonValueKind.Number)
                        Check("known-mathematical-length: " + label, response.TryGetProperty("route", out var route) && Math.Abs(route.GetProperty("lengthMeters").GetDouble() - item.GetProperty("expectedLengthMeters").GetDouble()) < 1e-12);
                    if (label == "A repeated after B") Check("actual-prepared-reference-reuse", actual.GetProperty("session").GetProperty("preparedReuse").GetString() == "memory", new { pid = session.Id, ordinal });
                    if (actual.GetProperty("session").GetProperty("retireAfterResponse").GetBoolean()) { await Stop(session); session.Dispose(); session = null; }
                }
                Check("resource-retirement-uses-new-process", observedPids.Count >= 2, observedPids.ToArray());
            }
            finally { if (session is not null) { await Stop(session); session.Dispose(); } }
            for (var pass = 1; pass <= 3; pass++) await CountRetirement(runner, Path.GetDirectoryName(manifest)!, doc.RootElement.GetProperty("cases")[16].GetProperty("request"), pass);
            await InvalidProcesses(runner, Path.GetDirectoryName(manifest)!);
            await FaultRecovery(runner, Path.GetDirectoryName(manifest)!, doc.RootElement.GetProperty("cases")[0].GetProperty("request"));
        }
        catch (Exception error) { Check("unexpected-test-fault", false, new { type = error.GetType().Name, error.Message }); }
        var receipt = new { schemaVersion = "pathfinder.runner.session.tests.v1", recordedAtUtc = DateTimeOffset.UtcNow, status = failures == 0 ? "PASS" : "FAIL", passed = Checks.Count - failures, failed = failures, runnerSha256 = Hash(File.ReadAllBytes(runner)), manifest, scope = "synthetic-runner-protocol-and-mixed-semantics-not-native-or-full-plant", checks = Checks };
        File.WriteAllText(Path.Combine(work, "result.json"), JsonSerializer.Serialize(receipt, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(JsonSerializer.Serialize(new { receipt.status, receipt.passed, receipt.failed, receipt = Path.Combine(work, "result.json") })); return failures == 0 ? 0 : 1;
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant();
    private static async Task Protocol()
    {
        async Task Reject(string name, byte[] bytes, int maximum = 100)
        {
            try { _ = await SessionProtocol.ReadFrame(new MemoryStream(bytes), maximum, CancellationToken.None); Check(name, false); }
            catch (Exception error) when (error is IOException or InvalidDataException or JsonException or DecoderFallbackException) { Check(name, true, error.GetType().Name); }
        }
        var stream = new MemoryStream(); await SessionProtocol.WriteFrame(stream, Encoding.UTF8.GetBytes("{\"ok\":true}"), 100, CancellationToken.None); stream.Position = 0;
        Check("BE32-exact-roundtrip", Encoding.UTF8.GetString((await SessionProtocol.ReadFrame(stream, 100, CancellationToken.None))!) == "{\"ok\":true}");
        Check("clean-EOF", await SessionProtocol.ReadFrame(new MemoryStream(), 100, CancellationToken.None) is null);
        await Reject("partial-prefix", [0, 0]); await Reject("partial-payload", [0,0,0,4,123]); await Reject("zero-frame", [0,0,0,0]);
        await Reject("unsigned-frame-cap-before-allocation", [255,255,255,255]);
        await Reject("invalid-UTF8", [0,0,0,3,34,255,34]);
        var duplicate = Encoding.UTF8.GetBytes("{\"x\":1,\"x\":2}"); var prefixed = new byte[4 + duplicate.Length]; BinaryPrimitives.WriteUInt32BigEndian(prefixed, (uint)duplicate.Length); duplicate.CopyTo(prefixed, 4); await Reject("duplicate-member", prefixed);
        try { SessionProtocol.ValidateReady(Encoding.UTF8.GetBytes("{}")); Check("closed-ready", false); } catch (InvalidDataException) { Check("closed-ready", true); }
    }
    private static Process Spawn(string runner, string root, string? mode)
    {
        var start = new ProcessStartInfo("dotnet") { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add(runner); if (mode is not null) start.ArgumentList.Add(mode); start.Environment["PF_ROOT"] = root;
        var process = Process.Start(start)!; _ = process.StandardError.ReadToEndAsync(); return process;
    }
    private static async Task<Process> Start(string runner, string root)
    {
        var process = Spawn(runner, root, "--session-supervisor");
        try { using var deadline = new CancellationTokenSource(10000); var ready = await SessionProtocol.ReadFrame(process.StandardOutput.BaseStream, SessionProtocol.MaximumOutput, deadline.Token); SessionProtocol.ValidateReady(ready!); return process; }
        catch { await Stop(process); process.Dispose(); throw; }
    }
    private static async Task<JsonElement> Query(Process process, byte[] bytes, string requestId, int ordinal)
    {
        using var deadline = new CancellationTokenSource(40000);
        await SessionProtocol.WriteFrame(process.StandardInput.BaseStream, bytes, SessionProtocol.MaximumInput, deadline.Token);
        var response = await SessionProtocol.ReadFrame(process.StandardOutput.BaseStream, SessionProtocol.MaximumOutput, deadline.Token) ?? throw new EndOfStreamException("Session exited before result.");
        return SessionProtocol.ValidateResult(response, requestId, ordinal);
    }
    private static async Task<JsonElement> OneShot(string runner, string root, byte[] bytes)
    {
        using var process = Spawn(runner, root, null); using var deadline = new CancellationTokenSource(40000);
        var stdout = process.StandardOutput.ReadToEndAsync(deadline.Token);
        try
        {
            await process.StandardInput.BaseStream.WriteAsync(bytes, deadline.Token); process.StandardInput.Close(); await process.WaitForExitAsync(deadline.Token);
            using var document = JsonDocument.Parse(await stdout); if (process.ExitCode != 0) throw new IOException("One-shot process failed."); return document.RootElement.Clone();
        }
        finally { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(); } }
    }
    private static async Task Stop(Process process)
    {
        try { process.StandardInput.Close(); } catch (IOException) { }
        using var deadline = new CancellationTokenSource(7000);
        try { await process.WaitForExitAsync(deadline.Token); }
        catch (OperationCanceledException) { process.Kill(true); await process.WaitForExitAsync(); Check("lane-shutdown-required-hard-kill", false); }
    }
    private static async Task CountRetirement(string runner, string root, JsonElement design, int pass)
    {
        using var process = await Start(runner, root);
        for (var ordinal = 1; ordinal <= 64; ordinal++)
        {
            var request = JsonNode.Parse(design.GetRawText())!; request["requestId"] = Guid.NewGuid().ToString("D");
            var result = await Query(process, Encoding.UTF8.GetBytes(request.ToJsonString()), request["requestId"]!.GetValue<string>(), ordinal);
            Check("request-count-pass-" + pass + "-ordinal-" + ordinal, result.GetProperty("session").GetProperty("retireAfterResponse").GetBoolean() == (ordinal == 64));
        }
        using var deadline = new CancellationTokenSource(7000); await process.WaitForExitAsync(deadline.Token); Check("64-count-clean-retirement-pass-" + pass, process.ExitCode == 0);
    }
    private static async Task InvalidProcesses(string runner, string root)
    {
        foreach (var (label, frame) in new[] { ("partial-frame-process-refusal", new byte[] {0,0}), ("oversize-process-refusal", new byte[] {255,255,255,255}), ("duplicate-process-refusal", Frame("{\"a\":1,\"a\":2}")) })
        {
            using var process = await Start(runner, root); await process.StandardInput.BaseStream.WriteAsync(frame); process.StandardInput.Close();
            using var deadline = new CancellationTokenSource(7000); await process.WaitForExitAsync(deadline.Token); Check(label, process.ExitCode != 0);
        }
    }
    private static async Task FaultRecovery(string runner, string root, JsonElement baseline)
    {
        JsonNode Request() { var value = JsonNode.Parse(baseline.GetRawText())!; value["requestId"] = Guid.NewGuid().ToString("D"); return value; }
        async Task Terminal(string label, JsonNode request, string status)
        {
            using var process = await Start(runner, root);
            var result = await Query(process, Encoding.UTF8.GetBytes(request.ToJsonString()), request["requestId"]!.GetValue<string>(), 1);
            Check(label + " status", result.GetProperty("response").GetProperty("status").GetString() == status);
            Check(label + " retires", result.GetProperty("session").GetProperty("retireAfterResponse").GetBoolean());
            using var timeout = new CancellationTokenSource(7000); await process.WaitForExitAsync(timeout.Token);
            Check(label + " process joined", process.HasExited && process.ExitCode == 0);
        }
        var deadline = Request(); deadline["timeoutMilliseconds"] = 1; await Terminal("independent-dotnet-hard-deadline", deadline, "deadline_exceeded");
        var cross = Request(); cross["projectId"] = Guid.NewGuid().ToString("D"); await Terminal("cross-project-input", cross, "invalid_request");
        var wrongHash = Request(); wrongHash["snapshotSha256"] = new string('0', 64); await Terminal("wrong-snapshot-SHA", wrongHash, "invalid_request");
        using (var process = await Start(runner, root))
        {
            var request = Request(); var bytes = Encoding.UTF8.GetBytes(request.ToJsonString());
            _ = await Query(process, bytes, request["requestId"]!.GetValue<string>(), 1);
            var path = Path.Combine(root, "snapshots", request["snapshotId"]!.GetValue<string>() + ".json"); var original = File.ReadAllBytes(path);
            try
            {
                File.WriteAllBytes(path, original.Concat(new byte[] {32}).ToArray()); request["requestId"] = Guid.NewGuid().ToString("D");
                var refused = await Query(process, Encoding.UTF8.GetBytes(request.ToJsonString()), request["requestId"]!.GetValue<string>(), 2);
                Check("memory-hit-cannot-bypass-immutable-file-SHA", refused.GetProperty("response").GetProperty("status").GetString() == "invalid_request" && refused.GetProperty("session").GetProperty("retireAfterResponse").GetBoolean());
            }
            finally { File.WriteAllBytes(path, original); await Stop(process); }
        }
        using (var process = await Start(runner, root))
        {
            var first = Request(); var second = Request();
            await SessionProtocol.WriteFrame(process.StandardInput.BaseStream, Encoding.UTF8.GetBytes(first.ToJsonString()), SessionProtocol.MaximumInput, CancellationToken.None);
            await SessionProtocol.WriteFrame(process.StandardInput.BaseStream, Encoding.UTF8.GetBytes(second.ToJsonString()), SessionProtocol.MaximumInput, CancellationToken.None);
            using var timeout = new CancellationTokenSource(7000); await process.WaitForExitAsync(timeout.Token);
            Check("pipelined-input-refuses-and-joins", process.ExitCode != 0);
            Check("pipelined-input-publishes-no-false-result", await SessionProtocol.ReadFrame(process.StandardOutput.BaseStream, SessionProtocol.MaximumOutput, timeout.Token) is null);
        }
        foreach (var (label, partial) in new[] { ("partial-prefix", new byte[] {0}), ("partial-payload", new byte[] {0,0,0,20,123}) })
        {
            using var process = await Start(runner, root); var request = Request();
            await SessionProtocol.WriteFrame(process.StandardInput.BaseStream, Encoding.UTF8.GetBytes(request.ToJsonString()), SessionProtocol.MaximumInput, CancellationToken.None);
            await process.StandardInput.BaseStream.WriteAsync(partial); await process.StandardInput.BaseStream.FlushAsync();
            // Keep stdin open: retirement must not depend on completing B or EOF.
            using var timeout = new CancellationTokenSource(7000); await process.WaitForExitAsync(timeout.Token);
            Check("pipelined-" + label + "-joined-with-open-input", process.ExitCode != 0);
            Check("pipelined-" + label + "-publishes-no-A", await SessionProtocol.ReadFrame(process.StandardOutput.BaseStream, SessionProtocol.MaximumOutput, timeout.Token) is null);
        }
        using (var process = await Start(runner, root))
        {
            var first = Request(); var second = Request();
            var a = await Query(process, Encoding.UTF8.GetBytes(first.ToJsonString()), first["requestId"]!.GetValue<string>(), 1);
            var b = await Query(process, Encoding.UTF8.GetBytes(second.ToJsonString()), second["requestId"]!.GetValue<string>(), 2);
            Check("immediate-B-after-received-A-is-legal", a.GetProperty("response").GetProperty("status").GetString() == "calculated" && b.GetProperty("response").GetProperty("status").GetString() == "calculated" && b.GetProperty("session").GetProperty("preparedReuse").GetString() == "memory");
            await Stop(process);
        }
        using (var process = await Start(runner, root))
        {
            var request = Request(); request["clientCachePath"] = "forbidden";
            await SessionProtocol.WriteFrame(process.StandardInput.BaseStream, Encoding.UTF8.GetBytes(request.ToJsonString()), SessionProtocol.MaximumInput, CancellationToken.None);
            using var timeout = new CancellationTokenSource(7000); await process.WaitForExitAsync(timeout.Token); Check("unknown-request-member-refusal", process.ExitCode != 0);
        }
        using (var process = await Start(runner, root))
        {
            var request = Request(); var result = await Query(process, Encoding.UTF8.GetBytes(request.ToJsonString()), request["requestId"]!.GetValue<string>(), 1);
            Check("new-lane-valid-after-terminal-faults", result.GetProperty("response").GetProperty("status").GetString() == "calculated" && result.GetProperty("session").GetProperty("preparedReuse").GetString() == "disk");
            await Stop(process);
        }
    }
    private static byte[] Frame(string text) { var bytes = Encoding.UTF8.GetBytes(text); var result = new byte[bytes.Length + 4]; BinaryPrimitives.WriteUInt32BigEndian(result, (uint)bytes.Length); bytes.CopyTo(result, 4); return result; }
    private static string Semantic(JsonElement response)
    {
        var semantic = new JsonObject();
        foreach (var property in response.EnumerateObject().Where(p => p.Name != "requestId")) semantic[property.Name] = JsonNode.Parse(property.Value.GetRawText());
        if (semantic["prepared"] is JsonObject prepared) prepared.Remove("loadedFromDisk");
        return Canonical(semantic);
    }
    private static string Canonical(JsonNode? value) => value switch
    {
        null => "null", JsonObject obj => "{" + string.Join(",", obj.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => JsonSerializer.Serialize(p.Key) + ":" + Canonical(p.Value))) + "}",
        JsonArray array => "[" + string.Join(",", array.Select(Canonical)) + "]", _ => value.ToJsonString()
    };
}
