using System.Buffers.Binary;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using AddinRibbon.Routing;
using PathFinder.Adapter;
using PathFinder.RunnerSession.Tests;

internal static class Program
{
    private static readonly List<object> Checks = [];
    private static int failures;
    private static void Check(string name, bool pass, string detail = "") { Checks.Add(new { name, status = pass ? "PASS" : "FAIL", detail }); if (!pass) failures++; }
    private static void Run(string name, Action action) { try { action(); Check(name, true); } catch (Exception e) { Check(name, false, e.GetType().Name + ": " + e.Message); } }
    private static void Need(bool value) { if (!value) throw new InvalidOperationException("Synthetic assertion failed."); }
    private static void Equal<T>(T a, T b) { if (!EqualityComparer<T>.Default.Equals(a, b)) throw new InvalidOperationException($"Expected {a}; observed {b}."); }
    private static void Reject<T>(Action action) where T : Exception { try { action(); } catch (T) { return; } throw new InvalidOperationException("Expected " + typeof(T).Name); }
    private static RoutePoint P(double x, double y = 0, double z = 0) => new(x, y, z);
    private static TraySegment Tray(string id, CableCategory category, params RoutePoint[] points) => new(id, "/" + id, category, points);
    private static RoutingOptions Options(bool vertical = false) => new() { ConnectionToleranceMeters = 1, SampleSpacingMeters = .125, SecondaryDistanceMeters = 2, PreferVerticalApproach = vertical };
    private static ProjectSettingsSnapshot Settings(decimal? secondary = 999, decimal end = 2, decimal percent = 10) => new() { Revision = "2", SecondaryTrayLength = secondary, EndConnectionLength = end, AdditionalBendingPercent = percent };
    private static DirectSecondaryEvaluation Evaluate(TraySegment[] trays, RoutePoint from, RoutePoint to, bool vertical = false) => DirectSecondaryRoute.Evaluate(trays, from, to, CableCategory.Control, Options(vertical));
    private static DirectSecondaryDecision Decision(double distance = 1) => DirectSecondaryDecision.Capture(Evaluate([Tray("A", CableCategory.Control, P(0, 100), P(100, 100))], P(0), P(distance)));
    private static void Pure()
    {
        Run("strict From-only OR branch", () => { var v = Evaluate([Tray("A", CableCategory.Control, P(2, -1), P(2, 1))], P(0), P(1)); Need(v.IsDirect); Equal("from-approach", v.Comparison); Equal(2d, v.NearestFromMeters); Equal(1d, v.NearestToMeters); });
        Run("strict To-only OR branch", () => { var v = Evaluate([Tray("A", CableCategory.Control, P(-1, -1), P(-1, 1))], P(0), P(1)); Need(v.IsDirect); Equal("to-approach", v.Comparison); });
        Run("both strict branches", () => { var v = Evaluate([Tray("A", CableCategory.Control, P(0, 5), P(1, 5))], P(0), P(1)); Need(v.IsDirect); Equal("both", v.Comparison); });
        Run("equality on both ends never selects direct", () => { var v = Evaluate([Tray("A", CableCategory.Control, P(0, 1), P(1, 1))], P(0), P(1)); Need(!v.IsDirect); Equal<string?>(null, v.Comparison); });
        Run("shorter only than a long graph detour is insufficient", () => {
            var trays = new[] { Tray("A", CableCategory.Control, P(0, 1), P(0, 100), P(1, 100), P(1, 1)) };
            var v = Evaluate(trays, P(0), P(1)); Need(!v.IsDirect); var route = new RouteCalculator().Calculate(trays, P(0), P(1), CableCategory.Control, Options()); Need(route.Success && route.LengthMeters > v.DistanceMeters);
        });
        Run("true nearest is measured before vertical preference", () => {
            var trays = new[] { Tray("A", CableCategory.Control, P(1), P(0, 0, 1.1)) }; var from = P(0); var to = P(.9);
            var v = Evaluate(trays, from, to, true); var straight = new RouteCalculator().Calculate(trays, from, to, CableCategory.Control, Options());
            var vertical = new RouteCalculator().Calculate(trays, from, to, CableCategory.Control, Options(true));
            Need(straight.Success && vertical.Success && !v.IsDirect); Equal(straight.FromDistanceMeters, v.NearestFromMeters); Need(vertical.FromDistanceMeters > v.DistanceMeters && v.DistanceMeters > v.NearestFromMeters);
        });
        Run("eligible category geometry alone controls nearest distances", () => {
            var trays = new[] { Tray("NEAR", CableCategory.LV, P(0), P(1)), Tray("FAR", CableCategory.Control, P(0, 5), P(1, 5)) };
            var v = Evaluate(trays, P(0), P(1)); Need(v.IsDirect); Equal(1, v.EligibleTrays); Equal(5d, v.NearestFromMeters);
        });
        Run("missing eligible geometry stays unavailable rather than Infinity", () => { var v = Evaluate([Tray("A", CableCategory.LV, P(0), P(1))], P(0), P(.1)); Need(!v.IsDirect); Equal(0, v.EligibleTrays); Need(v.NearestFromMeters is null && v.NearestToMeters is null && v.DirectRoute is null); DirectSecondaryDecision.Capture(v).Validate(); });
        Run("MV and category combinations do not gain shortcut access", () => { foreach (var category in new[] { CableCategory.MV, CableCategory.None, CableCategory.All }) Reject<ArgumentException>(() => DirectSecondaryRoute.Evaluate([], P(0), P(1), category)); });
        Run("no fixed direct-distance maximum is introduced", () => { var v = Evaluate([Tray("A", CableCategory.Control, P(0, 10000), P(1000, 10000))], P(0), P(1000)); Need(v.IsDirect); Equal(1000d, v.DirectRoute.LengthMeters); });
        Run("actual 3D distance and points are retained without invented tray IDs or gaps", () => {
            var v = Evaluate([Tray("A", CableCategory.Control, P(100, 100, 100), P(101, 100, 100))], P(0), P(0, 3, 4)); var route = v.DirectRoute;
            Equal(5d, route.LengthMeters); Equal("/SECONDARY", route.RouteText); Equal("/SECONDARY", route.RouteCodes.Single()); Equal(0, route.SegmentIds.Count); Equal(2, route.PathPoints.Count);
            Equal(0d, route.FromDistanceMeters); Equal(0d, route.ToDistanceMeters); Need(!route.FromRequiresSecondary && !route.ToRequiresSecondary); Equal(0, route.ConnectionGapCount); Equal(0d, route.ConnectionGapLengthMeters);
        });
        Run("zero direct distance emits one exact endpoint", () => { var v = Evaluate([Tray("A", CableCategory.Control, P(5), P(6))], P(0), P(0)); Need(v.IsDirect); Equal(0d, v.DirectRoute.LengthMeters); Equal(1, v.DirectRoute.PathPoints.Count); });
        Run("tiny underflow follows the existing Core binary64 metric", () => { var v = Evaluate([Tray("A", CableCategory.Control, P(5), P(6))], P(0), P(1e-200)); Equal(0d, v.DistanceMeters); DirectSecondaryDecision.Capture(v).Validate(); });
        Run("ordinal ordering and tied minima are deterministic", () => {
            var first = Tray("Z", CableCategory.Control, P(0, 2), P(1, 2)); var second = Tray("A", CableCategory.Control, P(0, -2), P(1, -2));
            Equal(JsonSerializer.Serialize(DirectSecondaryDecision.Capture(Evaluate([first, second], P(0), P(1)))), JsonSerializer.Serialize(DirectSecondaryDecision.Capture(Evaluate([second, first], P(0), P(1)))));
        });
        Run("duplicate eligible IDs and null trays preserve normal guards", () => { var a = Tray("A", CableCategory.Control, P(0), P(1)); Reject<ArgumentException>(() => Evaluate([a, a], P(0), P(1))); Reject<ArgumentException>(() => Evaluate([null!], P(0), P(1))); });
        Run("duplicate ineligible IDs remain irrelevant", () => { var a = Tray("A", CableCategory.LV, P(0), P(1)); Equal(0, Evaluate([a, a], P(0), P(1)).EligibleTrays); });
        Run("invalid options and nonfinite computed distance refuse before a shortcut", () => { Reject<ArgumentException>(() => DirectSecondaryRoute.Evaluate([], P(0), P(1), CableCategory.Control, new() { MaxGraphNodes = 1 })); Reject<ArgumentException>(() => Evaluate([], P(1e308), P(-1e308))); });
        Run("cancelled enumeration cannot return a shortcut", () => { using var c = new CancellationTokenSource(); IEnumerable<TraySegment> Input() { yield return Tray("A", CableCategory.Control, P(5), P(6)); c.Cancel(); yield return Tray("B", CableCategory.Control, P(7), P(8)); } Reject<OperationCanceledException>(() => DirectSecondaryRoute.Evaluate(Input(), P(0), P(1), CableCategory.Control, Options(), c.Token)); });
        Run("already cancelled direct evaluation refuses immediately", () => { using var c = new CancellationTokenSource(); c.Cancel(); Reject<OperationCanceledException>(() => DirectSecondaryRoute.Evaluate([], P(0), P(1), CableCategory.Control, Options(), c.Token)); });
        Run("direct design casts D then adds E once, applies P and ceilings", () => { var v = DirectSecondaryLengthObserver.Calculate(Decision(94.249), Settings(999, 5, 10)); Equal("94.249", v.Ledger.RawLengthDecimalMeters); Equal("99.249", v.Ledger.BeforePercentageMeters); Equal("109.1739", v.Ledger.UnroundedMeters); Equal("110", v.Ledger.DesignLengthMeters); });
        Run("S is unused audit data including missing and zero settings", () => { var expected = DirectSecondaryLengthObserver.Calculate(Decision(5), Settings(null, 2, 0)); Equal("7", expected.Ledger.DesignLengthMeters); foreach (var s in new decimal?[] { 0, 999 }) { var actual = DirectSecondaryLengthObserver.Calculate(Decision(5), Settings(s, 2, 0)); Equal(expected.Design.DesignLengthMeters, actual.Design.DesignLengthMeters); Equal(0, actual.Ledger.SecondaryEnds); Equal("0", actual.Ledger.ReplacementMeters); Need(!actual.Ledger.From.RequiresSecondary && !actual.Ledger.To.RequiresSecondary); } });
        Run("zero distance still adds E once before percentage", () => { var v = DirectSecondaryLengthObserver.Calculate(Decision(0), Settings(null, 5, 10)); Equal("5", v.Ledger.BeforePercentageMeters); Equal("5.5", v.Ledger.UnroundedMeters); Equal("6", v.Ledger.DesignLengthMeters); });
        Run("direct ledger is a distinct bounded version with exact decision", () => { var v = DirectSecondaryLengthObserver.Calculate(Decision(), Settings()); var bytes = JsonSerializer.SerializeToUtf8Bytes(v.Ledger, PathfinderAdapter.JsonOptions); using var json = JsonDocument.Parse(bytes); Equal("wfc.pf.length-components.v2", json.RootElement.GetProperty("schemaVersion").GetString()); Equal("direct-secondary-3d.v1", json.RootElement.GetProperty("formulaVersion").GetString()); Equal("direct-secondary", json.RootElement.GetProperty("directSecondary").GetProperty("mode").GetString()); Need(bytes.Length <= 8192); });
        Run("reversal swaps only endpoint evidence and comparison", () => { var v = DirectSecondaryDecision.Capture(Evaluate([Tray("A", CableCategory.Control, P(2, -1), P(2, 1))], P(0), P(1))); var r = v.Reverse(); r.Validate(); Equal("to-approach", r.Comparison); Equal(v.DistanceMeters, r.DistanceMeters); Need(v.FromPoint.SequenceEqual(r.ToPoint)); Equal(v.NearestFromMeters, r.NearestToMeters); });
        foreach (var field in new[] { "frame", "schema", "policy", "mode", "distance", "from", "nearest", "comparison", "count" }) Run("retained forged decision rejected: " + field, () => {
            var d = Decision(); var bad = field switch { "frame" => d with { CoordinateFrame = "display" }, "schema" => d with { SchemaVersion = "other" }, "policy" => d with { PolicyVersion = "other" }, "mode" => d with { Mode = "tray-network" }, "distance" => d with { DistanceMeters = 2 }, "from" => d with { FromPoint = [double.NaN, 0, 0] }, "nearest" => d with { NearestFromMeters = double.PositiveInfinity }, "comparison" => d with { Comparison = null }, _ => d with { EligibleTrays = 0 } }; Reject<ArgumentException>(bad.Validate);
        });
        Run("decimal overflow and cancellation preserve Core refusal", () => { Reject<OverflowException>(() => DirectSecondaryLengthObserver.Calculate(Decision(), Settings(null, decimal.MaxValue, 100))); using var c = new CancellationTokenSource(); c.Cancel(); Reject<OperationCanceledException>(() => DirectSecondaryLengthObserver.Calculate(Decision(), Settings(), c.Token)); });
    }

    private static async Task<int> Main(string[] args)
    {
        if (args is not ["--runner", var runner, "--work-root", var work] || !Path.IsPathFullyQualified(runner) || !File.Exists(runner) || !Path.IsPathFullyQualified(work) || Directory.Exists(work) || File.Exists(work)) return 2;
        Pure(); Directory.CreateDirectory(work);
        try { await Transport(runner, work); } catch (Exception e) { Check("transport-harness", false, e.GetType().Name + ": " + e.Message); }
        Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.direct-secondary-checks.v1", status = failures == 0 ? "PASS" : "FAIL", scope = "synthetic Core/Adapter checks plus actual owned one-shot/session runner transports; no native/model engineering acceptance", passed = Checks.Count - failures, failed = failures, checks = Checks, engineeringAccepted = false, nativeParity = "not-performed" }));
        return failures == 0 ? 0 : 1;
    }
    private static JsonObject Point(double x, double y, double z) => new() { ["x"] = x, ["y"] = y, ["z"] = z };
    private static async Task Transport(string runner, string work)
    {
        var root = Path.Combine(work, "corpus"); using var corpus = JsonDocument.Parse(File.ReadAllBytes(Corpus.Emit(root)));
        var baseline = JsonNode.Parse(corpus.RootElement.GetProperty("cases").EnumerateArray().Single(v => v.GetProperty("label").GetString() == "A baseline chain").GetProperty("request").GetRawText())!.AsObject();
        JsonObject Request(bool direct = true) { var v = (JsonObject)baseline.DeepClone(); v["requestId"] = Guid.NewGuid().ToString("D"); v["includeLengthLedger"] = true; if (direct) { v["directSecondaryPolicy"] = DirectSecondaryRoute.PolicyVersion; v["from"] = Point(.5, 10, .1); v["to"] = Point(.6, 10, .1); } return v; }
        var absent = Request(false); var legacy = await OneShot(runner, root, absent); var explicitNull = (JsonObject)absent.DeepClone(); explicitNull["directSecondaryPolicy"] = null; var nullValue = await OneShot(runner, root, explicitNull);
        Check("legacy absent/null remains responsev1 with identical route/design/ledger", legacy.GetProperty("schemaVersion").GetString() == "pathfinder.model.response.v1" && Payload(legacy) == Payload(nullValue) && !legacy.TryGetProperty("directSecondary", out _));
        var direct = Request(); var calculated = await OneShot(runner, root, direct);
        Check("opted direct calculation returns v2 and actual equipment line", calculated.GetProperty("schemaVersion").GetString() == "pathfinder.model.response.v2" && calculated.GetProperty("status").GetString() == "calculated" && calculated.GetProperty("route").GetProperty("routeText").GetString() == "/SECONDARY" && calculated.GetProperty("lengthLedger").GetProperty("schemaVersion").GetString() == "wfc.pf.length-components.v2");
        var decision = JsonNode.Parse(calculated.GetProperty("directSecondary").GetRawText())!;
        foreach (var category in new[] { "LV", "Control", "Instrumentation" }) { var r = Request(); r["category"] = category; var result = await OneShot(runner, root, r); Check("all nonMV device categories direct: " + category, result.GetProperty("status").GetString() == "calculated" && result.GetProperty("directSecondary").GetProperty("mode").GetString() == "direct-secondary"); }
        var mv = Request(); mv["category"] = "MV"; Check("MV optin refused", (await OneShot(runner, root, mv)).GetProperty("status").GetString() == "invalid_request");
        var fallback = Request(false); fallback["directSecondaryPolicy"] = DirectSecondaryRoute.PolicyVersion; var fallbackValue = await OneShot(runner, root, fallback);
        Check("opted network fallback preserves normal geometry and v1 ledger", fallbackValue.GetProperty("schemaVersion").GetString() == "pathfinder.model.response.v2" && fallbackValue.GetProperty("directSecondary").GetProperty("mode").GetString() == "tray-network" && Payload(legacy) == Payload(fallbackValue));
        var limited = (JsonObject)fallback.DeepClone(); limited["options"]!["maxGraphNodes"] = 2;
        var resourceFailure = await OneShot(runner, root, limited); Check("opted normal resource limit retains the v1 operational failure boundary", resourceFailure.GetProperty("schemaVersion").GetString() == "pathfinder.model.response.v1" && resourceFailure.GetProperty("status").GetString() == "resource_limit" && !resourceFailure.TryGetProperty("directSecondary", out _));
        var missingS = (JsonObject)fallback.DeepClone(); missingS["from"] = Point(0, 0, 4); missingS["options"]!["preferVerticalApproach"] = false; missingS["projectSettings"]!["secondaryTrayLength"] = null;
        var settingsFailure = await OneShot(runner, root, missingS); Check("opted normal missing S retains the v1 settings failure boundary", settingsFailure.GetProperty("schemaVersion").GetString() == "pathfinder.model.response.v1" && settingsFailure.GetProperty("status").GetString() == "settings_required" && !settingsFailure.TryGetProperty("directSecondary", out _));
        var reverse = (JsonObject)direct.DeepClone(); reverse["reverse"] = true; var reversed = await OneShot(runner, root, reverse);
        Check("reverse swaps direct points without changing design", calculated.GetProperty("directSecondary").GetProperty("fromPoint").GetRawText() == reversed.GetProperty("directSecondary").GetProperty("toPoint").GetRawText() && calculated.GetProperty("design").GetRawText() == reversed.GetProperty("design").GetRawText());
        var tinyReverse = Request(); tinyReverse["from"] = Point(0, 10, .1); tinyReverse["to"] = Point(1e-200, 10, .1); tinyReverse["reverse"] = true;
        var tiny = await OneShot(runner, root, tinyReverse); Check("reversed tiny binary64-zero direct line retains exact new From singleton", tiny.GetProperty("route").GetProperty("pathPoints").GetArrayLength() == 1 && tiny.GetProperty("route").GetProperty("pathPoints")[0].GetProperty("x").GetDouble() == 1e-200 && tiny.GetProperty("directSecondary").GetProperty("fromPoint")[0].GetDouble() == 1e-200);
        var design = Request(false); design["operation"] = "design"; design.Remove("from"); design.Remove("to"); design["directSecondaryPolicy"] = DirectSecondaryRoute.PolicyVersion;
        var route = calculated.GetProperty("route"); design["route"] = new JsonObject { ["success"] = true, ["lengthMeters"] = route.GetProperty("lengthMeters").GetDouble(), ["fromDistanceMeters"] = 0, ["toDistanceMeters"] = 0, ["fromRequiresSecondary"] = false, ["toRequiresSecondary"] = false, ["directSecondary"] = decision.DeepClone() };
        design["projectSettings"]!["secondaryTrayLength"] = null; design["projectSettings"]!["endConnectionLength"] = "2"; design["projectSettings"]!["additionalBendingPercent"] = "50";
        var retained = await OneShot(runner, root, design); Check("retained direct recalculates E/P without S and preserves exact decision", retained.GetProperty("status").GetString() == "calculated" && retained.GetProperty("directSecondary").GetRawText() == calculated.GetProperty("directSecondary").GetRawText() && retained.GetProperty("design").GetProperty("designLengthMeters").GetString() == "4");
        foreach (var category in new[] { "LV", "Control", "Instrumentation" }) { var r = (JsonObject)design.DeepClone(); r["category"] = category; var value = await OneShot(runner, root, r); Check("retained direct normalized category: " + category, value.GetProperty("effectiveCategory").GetString() == (category == "Instrumentation" ? "Control" : category)); }
        design["projectSettings"]!["secondaryTrayLength"] = "999"; var changedS = await OneShot(runner, root, design); Check("retained direct S change does not change design", retained.GetProperty("design").GetRawText() == changedS.GetProperty("design").GetRawText());
        var networkDesign = (JsonObject)design.DeepClone(); networkDesign["route"] = new JsonObject { ["success"] = true, ["lengthMeters"] = fallbackValue.GetProperty("route").GetProperty("lengthMeters").GetDouble(), ["fromDistanceMeters"] = fallbackValue.GetProperty("route").GetProperty("fromDistanceMeters").GetDouble(), ["toDistanceMeters"] = fallbackValue.GetProperty("route").GetProperty("toDistanceMeters").GetDouble(), ["fromRequiresSecondary"] = false, ["toRequiresSecondary"] = false, ["directSecondary"] = JsonNode.Parse(fallbackValue.GetProperty("directSecondary").GetRawText()) };
        Check("retained normal fallback remains v2 with exact network decision", (await OneShot(runner, root, networkDesign)).GetProperty("directSecondary").GetRawText() == fallbackValue.GetProperty("directSecondary").GetRawText());
        foreach (var kind in new[] { "distance", "frame", "flags", "missing-policy", "missing-decision" }) {
            var r = (JsonObject)design.DeepClone(); if (kind == "distance") r["route"]!["directSecondary"]!["distanceMeters"] = 2; if (kind == "frame") r["route"]!["directSecondary"]!["coordinateFrame"] = "display"; if (kind == "flags") r["route"]!["fromRequiresSecondary"] = true; if (kind == "missing-policy") r.Remove("directSecondaryPolicy"); if (kind == "missing-decision") r["route"]!.AsObject().Remove("directSecondary");
            Check("retained decision forgery refuses: " + kind, (await OneShot(runner, root, r)).GetProperty("status").GetString() == "invalid_request");
        }
        var noEligible = Request(); noEligible["rules"] = new JsonObject { ["version"] = "pf2.rules.v1", ["categoryMappingVersion"] = "wfc-mto-v1", ["excludedObjectIds"] = new JsonArray("segment-1", "segment-2", "segment-3") };
        var none = await OneShot(runner, root, noEligible); Check("missing real prepared eligible network never fabricates Infinity shortcut", none.GetProperty("status").GetString() == "no_path" && none.GetProperty("directSecondary").GetProperty("nearestFromMeters").ValueKind == JsonValueKind.Null);
        using var session = Start(runner, root, "--session-supervisor"); using var timeout = new CancellationTokenSource(30000);
        try {
            _ = await ReadFrame(session.StandardOutput.BaseStream, timeout.Token);
            foreach (var r in new[] { direct, design, fallback, networkDesign, absent }) {
                var expected = await OneShot(runner, root, r); await WriteFrame(session.StandardInput.BaseStream, Encoding.UTF8.GetBytes(r.ToJsonString()), timeout.Token);
                var envelope = await ReadFrame(session.StandardOutput.BaseStream, timeout.Token); var actual = envelope.GetProperty("response");
                Check("one-shot/session full strategy parity: " + r["operation"] + ":" + (r["directSecondaryPolicy"] is null ? "legacy" : r["from"] is null ? "retained" : "opted"), Payload(expected, true) == Payload(actual, true));
            }
            session.StandardInput.Close(); await session.WaitForExitAsync(timeout.Token); Check("session joins cleanly after interleaved legacy/direct/network retained requests", session.ExitCode == 0);
        } finally { if (!session.HasExited) { session.Kill(true); await session.WaitForExitAsync(); } }
    }
    private static string Payload(JsonElement value, bool direct = false) { var node = JsonNode.Parse(value.GetRawText())!.AsObject(); var keep = direct ? new[] { "schemaVersion", "status", "route", "design", "lengthLedger", "directSecondary", "engineeringAccepted" } : new[] { "route", "design", "lengthLedger" }; return new JsonObject(node.Where(p => keep.Contains(p.Key)).OrderBy(p => p.Key).Select(p => KeyValuePair.Create(p.Key, p.Value?.DeepClone()))).ToJsonString(); }
    private static Process Start(string runner, string root, params string[] args)
    {
        var info = new ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.ArgumentList.Add(runner); foreach (var arg in args) info.ArgumentList.Add(arg); info.Environment["PF_ROOT"] = root; return Process.Start(info) ?? throw new IOException("Owned runner failed to start.");
    }
    private static async Task<JsonElement> OneShot(string runner, string root, JsonObject request)
    {
        using var process = Start(runner, root); using var deadline = new CancellationTokenSource(30000); var output = process.StandardOutput.ReadToEndAsync(deadline.Token); var errors = process.StandardError.ReadToEndAsync(deadline.Token);
        try { await process.StandardInput.WriteAsync(request.ToJsonString()); process.StandardInput.Close(); await process.WaitForExitAsync(deadline.Token); var bytes = await output; _ = await errors; if (process.ExitCode != 0 || bytes.Length > 33554432) throw new IOException("Owned one-shot runner failed."); using var parsed = JsonDocument.Parse(bytes); return parsed.RootElement.Clone(); }
        finally { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(); } }
    }
    private static async Task WriteFrame(Stream output, byte[] bytes, CancellationToken token) { var header = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(header, (uint)bytes.Length); await output.WriteAsync(header, token); await output.WriteAsync(bytes, token); await output.FlushAsync(token); }
    private static async Task<JsonElement> ReadFrame(Stream input, CancellationToken token) { var header = new byte[4]; await input.ReadExactlyAsync(header, token); var size = BinaryPrimitives.ReadUInt32BigEndian(header); if (size is 0 or > 33554432) throw new IOException("Invalid owned frame size."); var bytes = new byte[size]; await input.ReadExactlyAsync(bytes, token); using var parsed = JsonDocument.Parse(bytes); return parsed.RootElement.Clone(); }
}
