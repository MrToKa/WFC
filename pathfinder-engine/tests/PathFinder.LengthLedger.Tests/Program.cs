using System.Buffers.Binary;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using AddinRibbon.Routing;
using PathFinder.Adapter;
using PathFinder.RunnerSession.Tests;

namespace PathFinder.LengthLedger.Tests;

internal static class TestProgram
{
    private static readonly List<object> Checks = [];
    private static readonly Dictionary<int, Task<byte[]>> SessionErrors = [];
    private static int failures;
    private static void Require(bool pass, string message = "Expected assertion did not hold.") { if (!pass) throw new InvalidOperationException(message); }
    private static void Equal<T>(T expected, T actual) => Require(EqualityComparer<T>.Default.Equals(expected, actual), $"Expected {expected}; received {actual}.");
    private static void Reject<T>(Action action) where T : Exception
    { try { action(); } catch (T) { return; } throw new InvalidOperationException("Expected " + typeof(T).Name); }
    private static void Run(string name, Action action)
    { try { action(); Checks.Add(new { name, status = "PASS" }); } catch (Exception error) { failures++; Checks.Add(new { name, status = "FAIL", error = error.GetType().Name, detail = error.Message[..Math.Min(512, error.Message.Length)] }); } }
    private static async Task Run(string name, Func<Task> action)
    { try { await action(); Checks.Add(new { name, status = "PASS" }); } catch (Exception error) { failures++; Checks.Add(new { name, status = "FAIL", error = error.GetType().Name, detail = error.Message[..Math.Min(512, error.Message.Length)] }); } }
    private static ProjectSettingsSnapshot Settings(decimal? secondary = 5m, decimal end = 6m, decimal percent = 10m, string revision = "1") =>
        new() { Revision = revision, SecondaryTrayLength = secondary, EndConnectionLength = end, AdditionalBendingPercent = percent };
    private static LengthLedgerResult Saved(double length, double from, double to, bool fromSecondary, bool toSecondary, ProjectSettingsSnapshot settings)
    {
        var expected = SavedRouteDesign.Calculate(length, from, to, fromSecondary, toSecondary, settings.EndConnectionLength, settings.SecondaryTrayLength ?? 0m, settings.AdditionalBendingPercent);
        var observed = LengthLedgerObserver.CalculateRetained(length, from, to, fromSecondary, toSecondary, settings);
        Equal(expected.LengthBeforePercentageMeters, observed.Design.LengthBeforePercentageMeters);
        Equal(expected.UnroundedLengthMeters, observed.Design.UnroundedLengthMeters); Equal(expected.DesignLengthMeters, observed.Design.DesignLengthMeters);
        Equal(expected.LengthBeforePercentageMeters.ToString("0.############################", CultureInfo.InvariantCulture), observed.Ledger.BeforePercentageMeters);
        Equal(expected.UnroundedLengthMeters.ToString("0.############################", CultureInfo.InvariantCulture), observed.Ledger.UnroundedMeters);
        Equal(expected.DesignLengthMeters.ToString("0.############################", CultureInfo.InvariantCulture), observed.Ledger.DesignLengthMeters);
        return observed;
    }
    private static void Direct()
    {
        Run("zero SECONDARY ends retain both measured approaches and add spare once", () => {
            var value = Saved(100.01, 2, 3, false, false, Settings(50));
            Equal(0, value.Ledger.SecondaryEnds); Equal("0", value.Ledger.From.RemovedApproachMeters); Equal("0", value.Ledger.To.RemovedApproachMeters);
            Equal("0", value.Ledger.ReplacementMeters); Equal("100.01", value.Ledger.BeforeClampMeters); Equal("106.01", value.Ledger.BeforePercentageMeters);
            Equal("10.601", value.Ledger.BendingIncrementMeters); Equal("116.611", value.Ledger.UnroundedMeters); Equal("0.389", value.Ledger.CeilingIncrementMeters);
        });
        Run("From SECONDARY replaces only the consumed From decimal cast", () => {
            var value = Saved(94.249, 2.710, 1.075, true, false, Settings());
            Equal("94.249", value.Ledger.RawLengthDecimalMeters); Equal("2.71", value.Ledger.From.RemovedApproachMeters); Equal("0", value.Ledger.To.RemovedApproachMeters);
            Equal("91.539", value.Ledger.BeforeClampMeters); Equal(1, value.Ledger.SecondaryEnds); Equal("5", value.Ledger.ReplacementMeters); Equal("113", value.Ledger.DesignLengthMeters);
        });
        Run("To SECONDARY replaces only the consumed To decimal cast", () => {
            var value = Saved(94.249, 2.710, 1.075, false, true, Settings());
            Equal("0", value.Ledger.From.RemovedApproachMeters); Equal("1.075", value.Ledger.To.RemovedApproachMeters); Equal(1, value.Ledger.SecondaryEnds);
        });
        Run("both SECONDARY ends and zero replacement preserve the authoritative totals", () => {
            var value = Saved(20, 3, 4, true, true, Settings(5, 6, 0)); Equal(2, value.Ledger.SecondaryEnds); Equal("10", value.Ledger.ReplacementMeters); Equal("29", value.Ledger.DesignLengthMeters);
            var zero = Saved(20, 3, 4, true, true, Settings(0, 6, 0)); Equal("0", zero.Ledger.ReplacementMeters); Equal("19", zero.Ledger.DesignLengthMeters);
        });
        Run("missing S with no SECONDARY stays null and does not cast unused oversized approaches", () => {
            var value = Saved(1.2345678901234567, double.MaxValue, double.MaxValue, false, false, Settings(null, 0, 0));
            Require(value.Ledger.Settings.SecondaryTrayLengthMeters is null); Equal("0", value.Ledger.ReplacementMeters);
            Equal("0", value.Ledger.From.RemovedApproachMeters); Equal("0", value.Ledger.To.RemovedApproachMeters);
            Equal((decimal)1.2345678901234567, decimal.Parse(value.Ledger.RawLengthDecimalMeters, CultureInfo.InvariantCulture));
            var json = JsonSerializer.SerializeToElement(value.Ledger, PathfinderAdapter.JsonOptions);
            Equal(BitConverter.DoubleToInt64Bits(double.MaxValue), BitConverter.DoubleToInt64Bits(json.GetProperty("raw").GetProperty("fromDistanceMeters").GetDouble()));
        });
        Run("flagged oversized approaches and missing required S keep the existing refusal", () => {
            Reject<ArgumentException>(() => LengthLedgerObserver.CalculateRetained(1, double.MaxValue, 0, true, false, Settings()));
            Reject<ArgumentException>(() => LengthLedgerObserver.CalculateRetained(1, 0, 0, true, false, Settings(null)));
        });
        Run("minus one micrometre equality clamps while below the boundary refuses", () => {
            var value = Saved(0, 0.000001, 0, true, false, Settings(0, 0, 0));
            Equal("-0.000001", value.Ledger.BeforeClampMeters); Equal("0.000001", value.Ledger.ClampAdjustmentMeters); Equal("0", value.Ledger.AfterClampMeters);
            Reject<ArgumentException>(() => LengthLedgerObserver.CalculateRetained(0, 0.000001000001, 0, true, false, Settings(0, 0, 0)));
        });
        Run("exact ceiling boundaries and decimal minimum component", () => {
            Equal("0", Saved(10, 0, 0, false, false, Settings(0, 0, 0)).Ledger.CeilingIncrementMeters);
            Equal("11", Saved(10.00001, 0, 0, false, false, Settings(0, 0, 0)).Ledger.DesignLengthMeters);
            var value = Saved(0, 0, 0, false, false, Settings(null, 0.0000000000000000000000000001m, 0));
            Equal("0.0000000000000000000000000001", value.Ledger.BeforePercentageMeters); Equal("1", value.Ledger.DesignLengthMeters);
        });
        Run("canonical settings text removes decimal scale without using binary64 settings", () => {
            var value = Saved(2, 0, 0, false, false, Settings(7.00m, 5.000m, 10.0m, "9223372036854775807"));
            Equal("7", value.Ledger.Settings.SecondaryTrayLengthMeters); Equal("5", value.Ledger.Settings.EndConnectionLengthMeters); Equal("10", value.Ledger.Settings.AdditionalBendingPercent);
            Equal("9223372036854775807", value.Ledger.SettingsRevision); Require(JsonSerializer.SerializeToUtf8Bytes(value.Ledger, PathfinderAdapter.JsonOptions).Length < LengthLedgerObserver.MaximumUtf8Bytes);
            var maximum = Saved(0, 0, 0, false, false, Settings(decimal.MaxValue, decimal.MaxValue, 0, "9223372036854775807"));
            Equal(decimal.MaxValue.ToString(CultureInfo.InvariantCulture), maximum.Ledger.DesignLengthMeters);
            Require(JsonSerializer.SerializeToUtf8Bytes(maximum.Ledger, PathfinderAdapter.JsonOptions).Length <= 8192);
        });
        Run("opted-in revision and raw-value boundaries are strict", () => {
            foreach (var revision in new[] { "", "01", "-1", "+1", " 1", "9223372036854775808", new string('1', 257), "opaque-old-revision" })
                Reject<ArgumentException>(() => LengthLedgerObserver.CalculateRetained(1, 0, 0, false, false, Settings(revision: revision)));
            foreach (var raw in new[] { double.NaN, double.PositiveInfinity, -1d })
                Reject<ArgumentException>(() => LengthLedgerObserver.CalculateRetained(1, raw, 0, false, false, Settings()));
        });
        Run("cancellation refuses before an opted-in result can be returned", () => {
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            Reject<OperationCanceledException>(() => LengthLedgerObserver.CalculateRetained(1, 0, 0, false, false, Settings(), cancelled.Token));
        });
        Run("full route keeps actual gap metrics and never adds gaps a second time", () => {
            var trays = new[] { new TraySegment("a", "/A001", CableCategory.Control, [new RoutePoint(0, 0, 0), new RoutePoint(1, 0, 0)]),
                new TraySegment("b", "/A002", CableCategory.Control, [new RoutePoint(1.4, 0, 0), new RoutePoint(2.4, 0, 0)]) };
            var route = new RouteCalculator().Calculate(trays, new RoutePoint(0, 0, 0), new RoutePoint(2.4, 0, 0), CableCategory.Control,
                new RoutingOptions { ConnectionToleranceMeters = .5, SampleSpacingMeters = .125, SecondaryDistanceMeters = 2 });
            Require(route.Success); Equal(1, route.ConnectionGapCount); Require(Math.Abs(route.ConnectionGapLengthMeters - .4) < 1e-9);
            var settings = Settings(null, 0, 0); var expected = CableDesignLength.Calculate(route, 0, 0, 0);
            var value = LengthLedgerObserver.Calculate(route, settings);
            Equal(expected.UnroundedLengthMeters, value.Design.UnroundedLengthMeters); Equal("already-in-raw-geometry", value.Ledger.GapAccounting);
            Equal((decimal)route.LengthMeters, decimal.Parse(value.Ledger.BeforePercentageMeters, CultureInfo.InvariantCulture));
            var reversed = LengthLedgerObserver.Calculate(route.Reverse(), settings); Equal(value.Design.DesignLengthMeters, reversed.Design.DesignLengthMeters);
        });
        Run("ledger serializes only the frozen fixed object and canonical amount strings", () => {
            var value = Saved(94.249, 2.710, 1.075, true, false, Settings()); var json = JsonSerializer.SerializeToElement(value.Ledger, PathfinderAdapter.JsonOptions);
            var names = new[] { "schemaVersion", "formulaVersion", "settingsRevision", "raw", "rawLengthDecimalMeters", "from", "to", "settings", "secondaryEnds", "replacementMeters", "beforeClampMeters", "clampAdjustmentMeters", "afterClampMeters", "beforePercentageMeters", "bendingIncrementMeters", "unroundedMeters", "ceilingIncrementMeters", "designLengthMeters", "gapAccounting" };
            Require(names.Order(StringComparer.Ordinal).SequenceEqual(json.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal)));
            Equal("wfc.pf.length-components.v1", json.GetProperty("schemaVersion").GetString()); Equal("pathfinder-45c24bf5", json.GetProperty("formulaVersion").GetString());
            foreach (var name in names.Where(n => n.EndsWith("Meters", StringComparison.Ordinal))) Equal(JsonValueKind.String, json.GetProperty(name).ValueKind);
            Require(JsonSerializer.SerializeToUtf8Bytes(value.Ledger, PathfinderAdapter.JsonOptions).Length <= 8192);
        });
    }

    private static async Task<int> Main(string[] args)
    {
        if (args is not ["--runner", var runner, "--work-root", var work] || !Path.IsPathFullyQualified(runner) || !File.Exists(runner) ||
            !Path.IsPathFullyQualified(work) || Directory.Exists(work) || File.Exists(work)) return 2;
        Direct(); Directory.CreateDirectory(work);
        try { await Transports(runner, work); }
        catch (Exception error) { failures++; Checks.Add(new { name = "transport-harness", status = "FAIL", error = error.GetType().Name, detail = error.Message[..Math.Min(512, error.Message.Length)] }); }
        Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.length-ledger-checks.v1", status = failures == 0 ? "PASS" : "FAIL",
            scope = "synthetic direct Core observations and actual one-shot/session Runner transports; no native or engineering acceptance", checks = Checks,
            passed = Checks.Count - failures, failed = failures, engineeringAccepted = false, nativeParity = "not-performed" }));
        return failures == 0 ? 0 : 1;
    }

    private static async Task Transports(string runner, string work)
    {
        var root = Path.Combine(work, "corpus"); using var corpus = JsonDocument.Parse(File.ReadAllBytes(Corpus.Emit(root)));
        JsonObject Request(string label) => (JsonObject)JsonNode.Parse(corpus.RootElement.GetProperty("cases").EnumerateArray().Single(c => c.GetProperty("label").GetString() == label).GetProperty("request").GetRawText())!;
        var calculate = Request("A baseline chain"); var design = Request("Retained design interleaved");
        JsonElement? plainCalculate = null, plainDesign = null;
        foreach (var (label, request) in new[] { ("calculate", calculate), ("design", design) })
        {
            await Run(label + " absent/false preserves historical response exactly", async () => {
                var absent = await OneShot(runner, root, request.ToJsonString()); request["includeLengthLedger"] = false;
                var disabled = await OneShot(runner, root, request.ToJsonString()); Equal("calculated", absent.GetProperty("status").GetString());
                Require(!absent.TryGetProperty("lengthLedger", out _) && !disabled.TryGetProperty("lengthLedger", out _)); Equal(Semantic(absent), Semantic(disabled));
                if (label == "calculate") plainCalculate = absent; else { plainDesign = absent; Equal(absent.GetRawText(), disabled.GetRawText()); }
            });
            await Run(label + " true emits matching strict ledger and no historical field changes", async () => {
                request["includeLengthLedger"] = true; var observed = await OneShot(runner, root, request.ToJsonString()); Ledger(observed);
                Equal(Semantic((label == "calculate" ? plainCalculate : plainDesign)!.Value), Semantic(observed, removeLedger: true));
            });
        }
        foreach (var operation in new[] { "prepare", "lookup", "lookup-plan" })
            await Run("false flag leaves historical " + operation + " response unchanged", async () => {
                var request = operation == "lookup" ? Request("Ordered lookup interleaved") : Request("A baseline chain"); request["operation"] = operation;
                if (operation == "lookup-plan") request = new JsonObject {
                    ["schemaVersion"] = "pathfinder.model.runner.v1", ["requestId"] = request["requestId"]!.GetValue<string>(),
                    ["projectId"] = request["projectId"]!.GetValue<string>(), ["modelVersionId"] = request["modelVersionId"]!.GetValue<string>(),
                    ["operation"] = "lookup-plan", ["routeText"] = "/BC001/BC002", ["timeoutMilliseconds"] = 30000 };
                var absent = await OneShot(runner, root, request.ToJsonString()); request["includeLengthLedger"] = false;
                var disabled = await OneShot(runner, root, request.ToJsonString());
                Require(!absent.TryGetProperty("lengthLedger", out _) && !disabled.TryGetProperty("lengthLedger", out _)); Equal(Semantic(absent), Semantic(disabled));
                Equal(operation == "prepare" ? "prepared" : operation == "lookup-plan" ? "lookup_planned" : "calculated", absent.GetProperty("status").GetString());
            });
        await Run("old opaque settings revision remains valid without the flag", async () => {
            var old = Request("Retained design interleaved"); old["projectSettings"]!["revision"] = "opaque-old-revision";
            var accepted = await OneShot(runner, root, old.ToJsonString()); Equal("calculated", accepted.GetProperty("status").GetString()); Require(!accepted.TryGetProperty("lengthLedger", out _));
            old["includeLengthLedger"] = true; Refused(await OneShot(runner, root, old.ToJsonString()), "invalid_request");
        });
        foreach (var label in new[] { "Gap small", "Explicit core graph budget", "SECONDARY approach" })
            await Run("opted-in legitimate failure has no ledger: " + label, async () => {
                var request = Request(label); request["includeLengthLedger"] = true;
                var expected = label == "Gap small" ? "no_path" : label == "Explicit core graph budget" ? "resource_limit" : "settings_required";
                if (label == "SECONDARY approach") request["projectSettings"]!["secondaryTrayLength"] = null;
                Refused(await OneShot(runner, root, request.ToJsonString()), expected);
            });
        foreach (var operation in new[] { "prepare", "lookup", "lookup-plan" })
            await Run("true flag refuses unsupported operation " + operation, async () => {
                var request = Request("A baseline chain"); request["operation"] = operation; request["includeLengthLedger"] = true;
                Refused(await OneShot(runner, root, request.ToJsonString()), "invalid_request");
            });
        foreach (var (label, node) in new (string, JsonNode?)[] { ("string", JsonValue.Create("true")), ("number", JsonValue.Create(1)), ("null", null) })
            await Run("strict boolean flag refuses " + label, async () => {
                var request = Request("Retained design interleaved"); request["includeLengthLedger"] = node?.DeepClone(); Refused(await OneShot(runner, root, request.ToJsonString()), "invalid_request");
            });
        await Run("duplicate and unknown ledger input members refuse", async () => {
            var request = Request("Retained design interleaved"); request["includeLengthLedger"] = true;
            var text = request.ToJsonString(); Refused(await OneShot(runner, root, text[..^1] + ",\"includeLengthLedger\":false}"), "invalid_request");
            request["lengthLedger"] = new JsonObject(); Refused(await OneShot(runner, root, request.ToJsonString()), "invalid_request");
        });
        await Run("retained route stays strict and does not accept invented gap metrics", async () => {
            var request = Request("Retained design interleaved"); request["includeLengthLedger"] = true; request["route"]!["connectionGapCount"] = 0;
            Refused(await OneShot(runner, root, request.ToJsonString()), "invalid_request");
        });
        await Run("exact settings converter rejects underflow and normalizes harmless decimal scale", async () => {
            var request = Request("Retained design interleaved"); request["includeLengthLedger"] = true; request["projectSettings"]!["endConnectionLength"] = "0.00000000000000000000000000001";
            Refused(await OneShot(runner, root, request.ToJsonString()), "invalid_request"); request["projectSettings"]!["endConnectionLength"] = "7.00";
            var value = await OneShot(runner, root, request.ToJsonString()); Ledger(value); Equal("7", value.GetProperty("lengthLedger").GetProperty("settings").GetProperty("endConnectionLengthMeters").GetString());
        });
        await Run("session and one-shot expose identical opted-in results and allow flag interleaving", async () => {
            using var session = await Start(runner, root); var ordinal = 0;
            try {
                foreach (var request in new[] { calculate, design, Request("A baseline chain"), Request("Retained design interleaved") }) {
                    if (ordinal == 2) request["includeLengthLedger"] = false;
                    if (ordinal == 3) { request["includeLengthLedger"] = true; request["projectSettings"]!["revision"] = "2"; request["projectSettings"]!["endConnectionLength"] = "3.25"; }
                    var expected = await OneShot(runner, root, request.ToJsonString()); var result = await Query(session, request.ToJsonString(), ++ordinal);
                    var response = result.GetProperty("response"); Equal(Semantic(expected), Semantic(response));
                    if (request["includeLengthLedger"]?.GetValue<bool>() == true) Ledger(response); else Require(!response.TryGetProperty("lengthLedger", out _));
                }
            } finally { await Stop(session); }
        });
        await Run("session rejects an invalid opted-in flag without publishing a response", async () => {
            using var session = await Start(runner, root); var bad = Request("Retained design interleaved"); bad["includeLengthLedger"] = "true";
            try {
                await WriteFrame(session.StandardInput.BaseStream, Encoding.UTF8.GetBytes(bad.ToJsonString()), CancellationToken.None); session.StandardInput.Close();
                using var deadline = new CancellationTokenSource(10000); await session.WaitForExitAsync(deadline.Token); Require(session.ExitCode != 0);
                var output = await ReadFrame(session.StandardOutput.BaseStream, deadline.Token); Require(output is null);
            } finally { await Stop(session); }
        });
    }

    private static void Ledger(JsonElement response)
    {
        Equal("calculated", response.GetProperty("status").GetString()); var ledger = response.GetProperty("lengthLedger"); var design = response.GetProperty("design");
        Equal("wfc.pf.length-components.v1", ledger.GetProperty("schemaVersion").GetString()); Equal("pathfinder-45c24bf5", ledger.GetProperty("formulaVersion").GetString());
        Equal(design.GetProperty("lengthBeforePercentageMeters").GetString(), ledger.GetProperty("beforePercentageMeters").GetString());
        Equal(design.GetProperty("unroundedLengthMeters").GetString(), ledger.GetProperty("unroundedMeters").GetString());
        Equal(design.GetProperty("designLengthMeters").GetString(), ledger.GetProperty("designLengthMeters").GetString());
        Require(Encoding.UTF8.GetByteCount(ledger.GetRawText()) <= LengthLedgerObserver.MaximumUtf8Bytes); Equal("already-in-raw-geometry", ledger.GetProperty("gapAccounting").GetString());
    }
    private static void Refused(JsonElement response, string status) { Equal(status, response.GetProperty("status").GetString()); Require(!response.TryGetProperty("lengthLedger", out _)); }
    private static Process Spawn(string runner, string root, string? mode)
    {
        var start = new ProcessStartInfo("dotnet") { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add(runner); if (mode is not null) start.ArgumentList.Add(mode); start.Environment["PF_ROOT"] = root;
        return Process.Start(start) ?? throw new IOException("The owned Runner did not start.");
    }
    private static async Task<JsonElement> OneShot(string runner, string root, string request)
    {
        using var process = Spawn(runner, root, null); using var deadline = new CancellationTokenSource(40000);
        var stdout = ReadBounded(process.StandardOutput.BaseStream, 32 * 1024 * 1024, deadline.Token); var stderr = ReadBounded(process.StandardError.BaseStream, 65536, deadline.Token);
        try {
            await process.StandardInput.BaseStream.WriteAsync(Encoding.UTF8.GetBytes(request), deadline.Token); process.StandardInput.Close();
            await process.WaitForExitAsync(deadline.Token); var bytes = await stdout; Require((await stderr).Length == 0); Equal(0, process.ExitCode);
            using var json = JsonDocument.Parse(bytes); return json.RootElement.Clone();
        } finally {
            if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); }
            try { await Task.WhenAll(stdout, stderr); } catch { /* The original bounded I/O failure remains the test result. */ }
        }
    }
    private static async Task<Process> Start(string runner, string root)
    {
        var process = Spawn(runner, root, "--session-supervisor");
        SessionErrors.Add(process.Id, ReadBounded(process.StandardError.BaseStream, 65536, CancellationToken.None));
        try {
            using var deadline = new CancellationTokenSource(10000); var bytes = await ReadFrame(process.StandardOutput.BaseStream, deadline.Token);
            using var ready = JsonDocument.Parse(bytes ?? throw new EndOfStreamException()); Equal("ready", ready.RootElement.GetProperty("type").GetString());
            Equal(Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(runner))).ToLowerInvariant(), ready.RootElement.GetProperty("runnerSha256").GetString());
            return process;
        } catch { await Stop(process); process.Dispose(); throw; }
    }
    private static async Task<JsonElement> Query(Process process, string request, int ordinal)
    {
        using var deadline = new CancellationTokenSource(40000); await WriteFrame(process.StandardInput.BaseStream, Encoding.UTF8.GetBytes(request), deadline.Token);
        var bytes = await ReadFrame(process.StandardOutput.BaseStream, deadline.Token); using var document = JsonDocument.Parse(bytes ?? throw new EndOfStreamException());
        Equal("pathfinder.engine.session.v1", document.RootElement.GetProperty("schemaVersion").GetString()); Equal(ordinal, document.RootElement.GetProperty("session").GetProperty("requestOrdinal").GetInt32());
        using var input = JsonDocument.Parse(request); Equal(input.RootElement.GetProperty("requestId").GetString(), document.RootElement.GetProperty("response").GetProperty("requestId").GetString());
        return document.RootElement.Clone();
    }
    private static async Task Stop(Process process)
    {
        try {
            if (!process.HasExited) {
                process.StandardInput.Close(); using var deadline = new CancellationTokenSource(10000);
                try { await process.WaitForExitAsync(deadline.Token); }
                catch (OperationCanceledException) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); throw new IOException("The session did not join after EOF."); }
            }
        } finally { if (SessionErrors.Remove(process.Id, out var errors)) Require((await errors).Length == 0); }
    }
    private static async Task<byte[]> ReadBounded(Stream stream, int maximum, CancellationToken token)
    {
        using var bytes = new MemoryStream(); var buffer = new byte[16384]; int count;
        while ((count = await stream.ReadAsync(buffer, token)) != 0) { if (bytes.Length + count > maximum) throw new IOException("The test stream exceeded its budget."); await bytes.WriteAsync(buffer.AsMemory(0, count), token); }
        return bytes.ToArray();
    }
    private static async Task WriteFrame(Stream stream, byte[] bytes, CancellationToken token)
    {
        Require(bytes.Length is > 0 and <= 1048576); var header = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(header, (uint)bytes.Length);
        await stream.WriteAsync(header, token); await stream.WriteAsync(bytes, token); await stream.FlushAsync(token);
    }
    private static async Task<byte[]?> ReadFrame(Stream stream, CancellationToken token)
    {
        var header = new byte[4]; var first = await stream.ReadAsync(header, token); if (first == 0) return null;
        await stream.ReadExactlyAsync(header.AsMemory(first), token); var size = BinaryPrimitives.ReadUInt32BigEndian(header); Require(size is > 0 and <= 33554432);
        var bytes = new byte[(int)size]; await stream.ReadExactlyAsync(bytes, token); return bytes;
    }
    private static string Semantic(JsonElement element, bool removeLedger = false)
    {
        var value = (JsonObject)JsonNode.Parse(element.GetRawText())!; if (removeLedger) value.Remove("lengthLedger");
        if (value["prepared"] is JsonObject prepared) prepared.Remove("loadedFromDisk");
        return Canonical(value);
    }
    private static string Canonical(JsonNode? value) => value switch {
        null => "null", JsonObject obj => "{" + string.Join(",", obj.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => JsonSerializer.Serialize(p.Key) + ":" + Canonical(p.Value))) + "}",
        JsonArray array => "[" + string.Join(",", array.Select(Canonical)) + "]", _ => value.ToJsonString()
    };
}
