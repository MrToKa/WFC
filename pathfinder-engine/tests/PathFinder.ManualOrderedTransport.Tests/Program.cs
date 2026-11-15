using System.Buffers.Binary;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

var checks = new List<object>(); var failed = 0;
if (args is not ["--runner", var runner, "--work-root", var root] || !Path.IsPathFullyQualified(runner) || !File.Exists(runner)
    || !Path.IsPathFullyQualified(root) || File.Exists(root) || Directory.Exists(root)) return 2;
Directory.CreateDirectory(root);
void Need(bool value, string message = "Assertion failed") { if (!value) throw new InvalidOperationException(message); }
async Task Check(string name, Func<Task> body) { try { await body(); checks.Add(new { name, status = "PASS" }); }
    catch (Exception e) { failed++; checks.Add(new { name, status = "FAIL", detail = e.ToString() }); } }
JsonObject Manual(JsonObject original, string text = "/BC001/BC002/BC003") { var request = original.DeepClone().AsObject(); request["requestId"] = Fixtures.FreshId();
    request["manualRouteConstraint"] = new JsonObject { ["schemaVersion"] = "pathfinder.manual-ordered-route.v1", ["routeText"] = text }; return request; }
Process Start(string? mode = null) { var info = new ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true,
    RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true }; info.ArgumentList.Add(runner);
    if (mode is not null) info.ArgumentList.Add(mode); info.Environment["PF_ROOT"] = root;
    return Process.Start(info) ?? throw new IOException("Runner did not start"); }
async Task<JsonElement> OneShot(JsonObject request) { using var process = Start(); using var deadline = new CancellationTokenSource(40000);
    var output = process.StandardOutput.ReadToEndAsync(deadline.Token); var errors = process.StandardError.ReadToEndAsync(deadline.Token);
    try { await process.StandardInput.WriteAsync(request.ToJsonString()); process.StandardInput.Close(); await process.WaitForExitAsync(deadline.Token);
        var json = await output; var error = await errors; File.WriteAllText(Path.Combine(root, request["requestId"] + ".request.json"), request.ToJsonString());
        File.WriteAllText(Path.Combine(root, request["requestId"] + ".response.json"), json); Need(process.ExitCode == 0, error);
        using var parsed = JsonDocument.Parse(json); return parsed.RootElement.Clone(); }
    finally { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(); } } }
string Status(JsonElement value) => value.GetProperty("status").GetString()!;
void Success(JsonElement value, string route) { Need(Status(value) == "calculated", value.GetRawText());
    Need(value.GetProperty("route").GetProperty("routeText").GetString() == route, value.GetRawText());
    Need(value.GetProperty("lengthLedger").GetProperty("schemaVersion").GetString() == "wfc.pf.length-components.v1", value.GetRawText());
    var reason = value.GetProperty("barriers").GetProperty("diagnostics").GetProperty("reasonCode").GetString()!;
    Need(reason.StartsWith("MANUAL_ORDERED") || reason == "DRILLING_BYPASS");
    Need(value.GetProperty("design").GetProperty("designLengthMeters").GetString() == "14", value.GetRawText()); }
var baseline = Fixtures.Request(root, [(0, 2, 0, .1), (2, 4, 0, .1), (4, 6, 0, .1)]);
baseline["from"] = Fixtures.Point(.5, -1); baseline["to"] = Fixtures.Point(5.5, 1);
var legacy = Fixtures.Store(root, Fixtures.Box(100, 101));
var mixed = MixedRuntimeFixtures.Store(root, Fixtures.Transform(MixedRuntimeFixtures.Wall(), p => Fixtures.P(p.X + 100, p.Y, p.Z)));
var empty = MixedRuntimeFixtures.Store(root, null);
await Check("legacy protected manual constraint calculates full endpoint route and final proof", async () => {
    var value = await OneShot(Manual(MixedRuntimeFixtures.Protected(baseline, legacy.Context))); Success(value, "/BC001/BC002/BC003");
    Need(value.GetProperty("barriers").GetProperty("proof").GetProperty("status").GetString() == "clear-selected-scope"); });
await Check("mixed protected manual constraint calculates full endpoint route and original surface proof", async () => {
    var value = await OneShot(Manual(MixedRuntimeFixtures.Protected(baseline, mixed.Context))); Success(value, "/BC001/BC002/BC003");
    Need(value.GetProperty("barriers").GetProperty("proof").GetProperty("status").GetString() == "clear-selected-scope"); });
await Check("explicit empty still dispatches manual rather than unconstrained routing", async () => {
    Success(await OneShot(Manual(MixedRuntimeFixtures.Protected(baseline, empty.Context))), "/BC001/BC002/BC003"); });
await Check("capacity excluded mandatory tray cannot be substituted", async () => {
    var request = Manual(MixedRuntimeFixtures.Protected(baseline, mixed.Context)); request["excludedRouteCodes"] = new JsonArray("/BC002");
    var value = await OneShot(request); Need(Status(value) == "no_path", value.GetRawText());
    Need(value.GetProperty("barriers").GetProperty("diagnostics").GetProperty("reasonCode").GetString() == "MANUAL_ROUTE_REQUIRED_TRAY_UNAVAILABLE"); });
await Check("manual direct SECONDARY option cannot bypass an unknown mandatory label", async () => {
    var request = Manual(MixedRuntimeFixtures.Protected(baseline, mixed.Context), "/MISSING"); request["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1";
    request["from"] = Fixtures.Point(0, 10); request["to"] = Fixtures.Point(1, 10);
    var value = await OneShot(request); Need(Status(value) == "no_path", value.GetRawText());
    Need(value.GetProperty("barriers").GetProperty("directSecondary").ValueKind == JsonValueKind.Null); });
await Check("registered original wall refuses manual crossing with no successful design", async () => {
    var wall = MixedRuntimeFixtures.Store(root, Fixtures.Transform(MixedRuntimeFixtures.Wall(), p => Fixtures.P(p.X + 3, p.Y, p.Z)));
    var value = await OneShot(Manual(MixedRuntimeFixtures.Protected(baseline, wall.Context))); Need(Status(value) != "calculated", value.GetRawText());
    Need(!value.GetProperty("route").GetProperty("success").GetBoolean()); Need(value.GetProperty("design").ValueKind == JsonValueKind.Null); });
await Check("authenticated opening profile retains manual order and exact original-surface final proof", async () => {
    var request = Fixtures.Request(root, [(-2, -.1, 0, .1), (.1, 2, 0, .1)]);
    request["from"] = Fixtures.Point(-1.5, 0, .1); request["to"] = Fixtures.Point(1.5, 0, .1);
    var opening = MixedRuntimeFixtures.Store(root, Fixtures.Transform(MixedRuntimeFixtures.Ring(), p => Fixtures.P(p.X, p.Y, p.Z * .75 + .75)));
    var context = opening.Context.DeepClone().AsObject(); context["profile"]!["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v3";
    context["profile"]!["interTrayManeuvers"] = JsonNode.Parse("""
    {"policyVersion":"wfc.pf.inter-tray-opening-maneuvers.v1","maximumOffsetMetres":0.1,"radiiMetres":[0.05,0.1],"directionVersion":"normalized-lexicographic-26.v1","maximumEdgeAttempts":64,"candidateCount":52,"domain":"blocked-inter-tray-chords-only","selection":"legacy-clear-upper-bound-lazy-selected-path.v1"}
    """); context["profileSha256"] = Fixtures.Hash(Fixtures.Canonical(context["profile"]));
    var value = await OneShot(Manual(MixedRuntimeFixtures.Protected(request, context), "/BC001/BC002")); Need(Status(value) == "calculated", value.GetRawText());
    Need(value.GetProperty("route").GetProperty("routeText").GetString() == "/BC001/BC002");
    Need(value.GetProperty("barriers").GetProperty("diagnostics").GetProperty("reasonCode").GetString()!.Contains("INTER_TRAY_OPENING_MANEUVER_V1"));
    var points = value.GetProperty("route").GetProperty("pathPoints").EnumerateArray().Select(p => Fixtures.P(p.GetProperty("x").GetDouble(), p.GetProperty("y").GetDouble(), p.GetProperty("z").GetDouble())).ToArray();
    Need(points.Any(p => p.Z > .15)); var kernel = opening.Qualified!.Qualified!.Kernel;
    foreach (var pair in points.Zip(points.Skip(1))) Need(kernel.CheckSegment(pair.First, pair.Second).Status == PathFinder.Barriers.MixedBarrierSegmentStatus.Clear);
    Need(value.GetProperty("barriers").GetProperty("proof").GetProperty("checkedSegments").GetInt32() == points.Length - 1);
});
foreach (var item in new[] { ("adjacent repetition", "/BC001/BC001"), ("interior SECONDARY", "/BC001/SECONDARY/BC003") })
    await Check("strict transport refuses " + item.Item1, async () => Need(Status(await OneShot(Manual(MixedRuntimeFixtures.Protected(baseline, mixed.Context), item.Item2))) == "invalid_request"));
await Check("reverse cannot alter declared manual order", async () => { var request = Manual(MixedRuntimeFixtures.Protected(baseline, mixed.Context)); request["reverse"] = true;
    Need(Status(await OneShot(request)) == "invalid_request"); });
await Check("legacy unprotected transport cannot accept manual constraint", async () => { var request = Manual(baseline); request["schemaVersion"] = "pathfinder.model.runner.v1";
    Need(Status(await OneShot(request)) == "invalid_request"); });
async Task<JsonElement> ReadFrame(Stream stream, CancellationToken token) { var header = new byte[4]; await stream.ReadExactlyAsync(header, token);
    var size = BinaryPrimitives.ReadUInt32BigEndian(header); Need(size is > 0 and <= 33554432); var bytes = new byte[checked((int)size)];
    await stream.ReadExactlyAsync(bytes, token); using var parsed = JsonDocument.Parse(bytes); return parsed.RootElement.Clone(); }
await Check("warm session keeps automatic and manual requests isolated with exact proof", async () => {
    using var process = Start("--session-supervisor"); using var deadline = new CancellationTokenSource(60000); var errors = process.StandardError.ReadToEndAsync(deadline.Token);
    try { Need((await ReadFrame(process.StandardOutput.BaseStream, deadline.Token)).GetProperty("type").GetString() == "ready");
        foreach (var request in new[] { MixedRuntimeFixtures.Protected(baseline, mixed.Context), Manual(MixedRuntimeFixtures.Protected(baseline, mixed.Context)),
            Manual(MixedRuntimeFixtures.Protected(baseline, mixed.Context), "/BC001/MISSING/BC003"), Manual(MixedRuntimeFixtures.Protected(baseline, mixed.Context)) }) {
            var bytes = Encoding.UTF8.GetBytes(request.ToJsonString()); var header = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(header, (uint)bytes.Length);
            await process.StandardInput.BaseStream.WriteAsync(header, deadline.Token); await process.StandardInput.BaseStream.WriteAsync(bytes, deadline.Token);
            await process.StandardInput.BaseStream.FlushAsync(deadline.Token); var envelope = await ReadFrame(process.StandardOutput.BaseStream, deadline.Token);
            Need(envelope.GetProperty("type").GetString() == "result", envelope.GetRawText()); var value = envelope.GetProperty("response");
            if (request["manualRouteConstraint"]?["routeText"]?.GetValue<string>().Contains("MISSING") == true) Need(Status(value) == "no_path");
            else if (request.ContainsKey("manualRouteConstraint")) Success(value, "/BC001/BC002/BC003"); else Need(Status(value) == "calculated");
            Need(!envelope.GetProperty("session").GetProperty("retireAfterResponse").GetBoolean(), envelope.GetRawText()); }
        process.StandardInput.Close(); await process.WaitForExitAsync(deadline.Token); Need(process.ExitCode == 0, await errors); }
    finally { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(); } } });
Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.manual-ordered-transport-checks.v1", status = failed == 0 ? "PASS" : "FAIL", passed = checks.Count - failed, failed, checks }));
return failed == 0 ? 0 : 1;
