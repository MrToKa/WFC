using System.Buffers.Binary;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Barriers;

internal static partial class Program
{
    private static readonly List<object> Checks = [];
    private static int failures, diagnosticSerial;
    private static void Need(bool value, string detail = "Synthetic assertion failed.") { if (!value) throw new InvalidOperationException(detail); }
    private static void Equal<T>(T expected, T observed) { Need(EqualityComparer<T>.Default.Equals(expected, observed), $"Expected {expected}; observed {observed}."); }
    private static async Task Check(string name, Func<Task> action)
    {
        var timer = Stopwatch.StartNew();
        try { await action(); Checks.Add(new { name, status = "PASS", elapsedMilliseconds = timer.Elapsed.TotalMilliseconds }); }
        catch (Exception error) { failures++; Checks.Add(new { name, status = "FAIL", elapsedMilliseconds = timer.Elapsed.TotalMilliseconds, detail = error.GetType().Name + ": " + error.Message }); }
    }
    private static async Task<int> Main(string[] args)
    {
        if (args is ["--workload", "--work-root", var workloadRoot]) return GenerateWorkload(workloadRoot);
        if (args is ["--verify-workload", "--manifest", var manifest, "--responses", var responses])
            return VerifyWorkload(manifest, responses, null);
        if (args is ["--verify-workload", "--manifest", var fullManifest, "--responses", var fullResponses, "--oneshot-responses", var oneShotResponses])
            return VerifyWorkload(fullManifest, fullResponses, oneShotResponses);
        if (args is not ["--runner", var runner, "--work-root", var work] || !Path.IsPathFullyQualified(runner) || !File.Exists(runner)
            || !Path.IsPathFullyQualified(work) || Directory.Exists(work) || File.Exists(work)) return 2;
        Directory.CreateDirectory(work); var timer = Stopwatch.StartNew();
        try { await Transport(runner, work); }
        catch (Exception error) { failures++; Checks.Add(new { name = "independent-transport-fixture-harness", status = "FAIL", detail = error.GetType().Name + ": " + error.Message }); }
        Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.barrier-runtime-checks.v1", status = failures == 0 ? "PASS" : "FAIL",
            passed = Checks.Count - failures, failed = failures, elapsedMilliseconds = timer.Elapsed.TotalMilliseconds, checks = Checks,
            scope = "independently authored small closed wall/tunnel/floor raw captures through actual one-shot/session runner; not actual SDK/plant capacity",
            runnerSha256 = Fixtures.Hash(File.ReadAllBytes(runner)), engineeringAccepted = false, nativeParity = "not-performed" }));
        return failures == 0 ? 0 : 1;
    }
    private static JsonObject Protected(JsonObject request, JsonObject context)
    { var copy = (JsonObject)request.DeepClone(); copy["requestId"] = Fixtures.FreshId(); copy["barriers"] = context.DeepClone(); return copy; }
    private static string Status(JsonElement value) => value.GetProperty("status").GetString()!;
    private static JsonElement Execution(JsonElement value) => value.GetProperty("barriers");
    private static string Diagnostic(JsonElement value) => Execution(value).GetProperty("diagnostics").GetProperty("status").GetString()!;
    private static BarrierPoint[] Points(JsonElement value) => value.GetProperty("route").GetProperty("pathPoints").EnumerateArray()
        .Select(p => new BarrierPoint(p.GetProperty("x").GetDouble(), p.GetProperty("y").GetDouble(), p.GetProperty("z").GetDouble())).ToArray();
    private static string RouteHash(BarrierPoint[] points)
    {
        string Bits(double value) { Span<byte> bytes = stackalloc byte[8]; BinaryPrimitives.WriteInt64LittleEndian(bytes, value == 0 ? 0L : BitConverter.DoubleToInt64Bits(value)); return Convert.ToHexString(bytes).ToLowerInvariant(); }
        var bits = points.Select(p => new[] { Bits(p.X), Bits(p.Y), Bits(p.Z) }).ToArray();
        var input = JsonSerializer.SerializeToNode(new { schemaVersion = "wfc.pf.route-binary64-le.v1", pointBits = bits })!;
        return Fixtures.Hash(Fixtures.Canonical(input));
    }
    private static void ExactSuccessful(JsonElement value, JsonObject context, Fixtures.Stored? physical = null)
    {
        Equal("pathfinder.model.response.v3", value.GetProperty("schemaVersion").GetString());
        Need(Status(value) == "calculated", "Expected calculated; observed " + Status(value) + "; message: " + Message(value));
        Need(!value.GetProperty("engineeringAccepted").GetBoolean()); var execution = Execution(value);
        Equal(Fixtures.Canonical(context), Fixtures.Canonical(JsonNode.Parse(execution.GetProperty("context").GetRawText())));
        var proof = execution.GetProperty("proof"); Equal("wfc.pf.barrier-check-proof.v2", proof.GetProperty("schemaVersion").GetString());
        var points = Points(value); Need(points.Length > 0); Equal(RouteHash(points), proof.GetProperty("routeSha256").GetString());
        Equal(points.Length, proof.GetProperty("routePointCount").GetInt32()); Equal(Math.Max(1, points.Length - 1), proof.GetProperty("totalSegments").GetInt32());
        Need(!proof.GetProperty("engineeringAccepted").GetBoolean());
        if (Diagnostic(value) == "clear")
        {
            Equal("clear-selected-scope", proof.GetProperty("status").GetString()); Equal(Math.Max(1, points.Length - 1), proof.GetProperty("checkedSegments").GetInt32());
            var verified = physical?.Qualification ?? throw new InvalidOperationException("A physical successful route needs independent raw fixture qualification.");
            var qualified = verified.Qualified ?? throw new InvalidOperationException("The raw fixture was not qualified.");
            var qualification = execution.GetProperty("qualification");
            Equal(verified.Receipt.CaptureSha256, qualification.GetProperty("captureSha256").GetString());
            var evidence = verified.Receipt.Evidence ?? throw new InvalidOperationException("Qualified fixture evidence was missing.");
            Equal(evidence.VerificationSha256, qualification.GetProperty("pureVerificationSha256").GetString());
            Equal(evidence.DecompositionSha256, qualification.GetProperty("decompositionSha256").GetString());
            for (int index = 0; index < Math.Max(1, points.Length - 1); index++)
                Equal(BarrierSegmentStatus.Clear, qualified.Kernel.CheckSegment(points[index], points[Math.Min(index + 1, points.Length - 1)]).Status);
        }
        else
        {
            Need(Diagnostic(value) is "bypassed" or "no-barriers-declared"); Equal(0, proof.GetProperty("checkedSegments").GetInt32());
            Equal(JsonValueKind.Null, execution.GetProperty("qualification").ValueKind);
        }
    }
    private static void Refused(JsonElement value, bool validContext = true)
    {
        Need(Status(value) != "calculated", "A protected refusal returned a computed legacy result.");
        Need(!value.GetProperty("engineeringAccepted").GetBoolean());
        if (!validContext) return;
        Equal("pathfinder.model.response.v3", value.GetProperty("schemaVersion").GetString());
        Need(Diagnostic(value) is "blocked" or "indeterminate" or "search-incomplete" or "unavailable");
        Need(Execution(value).GetProperty("proof").ValueKind == JsonValueKind.Null, "A refused routing search cannot invent a successful final-polyline proof.");
    }
    private static string Message(JsonElement value)
    { var text = value.TryGetProperty("message", out var property) ? property.GetString() ?? "" : "<no message>"; return text.Length <= 1024 ? text : text[..1024]; }
    private static async Task MalformedRefusal(string runner, string root, JsonObject request)
    {
        try { Refused(await OneShot(runner, root, request), false); }
        catch (RunnerProcessRefusal error) when (error.ExitCode == 2 && error.StdoutBytes == 0)
        { /* An actual empty-output process refusal is retained as such, never manufactured into a computed JSON response. */ }
    }
    private static string Payload(JsonElement value)
    {
        var node = JsonNode.Parse(value.GetRawText())!.AsObject();
        return Fixtures.Canonical(new JsonObject(node.Where(p => new[] { "schemaVersion", "status", "route", "design", "lengthLedger", "barriers" }.Contains(p.Key))
            .Select(p => KeyValuePair.Create(p.Key, p.Value?.DeepClone()))));
    }
    private static string LegacyPayload(JsonElement value)
    {
        var node = JsonNode.Parse(value.GetRawText())!.AsObject();
        return Fixtures.Canonical(new JsonObject(node.Where(p => new[] { "route", "design", "lengthLedger" }.Contains(p.Key))
            .Select(p => KeyValuePair.Create(p.Key, p.Value?.DeepClone()))));
    }
    private static async Task Transport(string runner, string root)
    {
        var baseline = Fixtures.Request(root); var far = Fixtures.Store(root, Fixtures.Box(10, 10.2));
        var wall = Fixtures.Store(root, Fixtures.Box()); var opening = Fixtures.Store(root, Fixtures.Opening()); var empty = Fixtures.Store(root, null);
        var clearRequest = Protected(baseline, far.Context); var openingRequest = Protected(baseline, opening.Context);
        var wallRequest = Protected(baseline, wall.Context); var emptyRequest = Protected(baseline, empty.Context);
        var legacyRequest = (JsonObject)baseline.DeepClone(); legacyRequest["schemaVersion"] = "pathfinder.model.runner.v1";
        JsonElement clear = default, throughOpening = default, legacy = default;
        await Check("v1 remains exact legacy without any barrier defaults", async () => {
            legacy = await OneShot(runner, root, legacyRequest); Equal("pathfinder.model.response.v1", legacy.GetProperty("schemaVersion").GetString());
            Equal("calculated", Status(legacy)); Need(!legacy.TryGetProperty("barriers", out _));
        });
        await Check("normal protected route has exact final checks and pure qualification distinct from B2 authority digest", async () => {
            clear = await OneShot(runner, root, clearRequest); ExactSuccessful(clear, far.Context, far);
            Equal(LegacyPayload(legacy), LegacyPayload(clear));
            Need(Execution(clear).GetProperty("qualification").GetProperty("pureVerificationSha256").GetString()
                != far.Manifest["geometry"]!["verification"]!["verificationSha256"]!.GetValue<string>());
        });
        await Check("signed-zero request retains core points while its durable proof survives JSON zero normalization", async () => {
            var request = Fixtures.Request(root); double negativeZero = BitConverter.Int64BitsToDouble(long.MinValue);
            request["from"] = Fixtures.Point(negativeZero, negativeZero); request["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1";
            var result = await OneShot(runner, root, Protected(request, far.Context)); ExactSuccessful(result, far.Context, far);
            bool HasNegativeZero(IEnumerable<BarrierPoint> points) => points.Any(point => new[] { point.X, point.Y, point.Z }
                .Any(coordinate => BitConverter.DoubleToInt64Bits(coordinate) == long.MinValue));
            Need(HasNegativeZero(Points(result)), "The fixture must actually retain a negative-zero coordinate from the unchanged core.");
            // JavaScript JSON.stringify (and durable JSON storage) retains zero's
            // value, not its sign. Model that numerical roundtrip independently;
            // neither the original core points nor any nonzero bit is modified.
            var persisted = JsonNode.Parse(result.GetRawText())!.AsObject();
            foreach (var point in persisted["route"]!["pathPoints"]!.AsArray())
                foreach (string axis in new[] { "x", "y", "z" })
                    if (point![axis]!.GetValue<double>() == 0) point[axis] = 0d;
            using var restored = JsonDocument.Parse(persisted.ToJsonString());
            Need(!HasNegativeZero(Points(restored.RootElement))); ExactSuccessful(restored.RootElement, far.Context, far);
            Equal(Execution(result).GetProperty("proof").GetProperty("routeSha256").GetString(),
                Execution(restored.RootElement).GetProperty("proof").GetProperty("routeSha256").GetString());
            Need(RouteHash([Fixtures.P(1e-200)]) != RouteHash([Fixtures.P(0)])
                && RouteHash([Fixtures.P(double.Epsilon)]) != RouteHash([Fixtures.P(0)]), "Nonzero subnormal/underflow inputs must retain their exact bits.");
        });
        await Check("real closed tunnel opening admits exact physical route", async () => {
            throughOpening = await OneShot(runner, root, openingRequest); ExactSuccessful(throughOpening, opening.Context, opening);
        });
        await Check("solid closed wall refuses the same crossing instead of using its legacy geometric shortcut", async () => {
            var value = await OneShot(runner, root, wallRequest); Refused(value);
            Need(Execution(value).GetProperty("qualification").ValueKind == JsonValueKind.Object);
        });
        await Check("explicit-empty is distinguished from actual triangle clearance and preserves original ledger", async () => {
            var value = await OneShot(runner, root, emptyRequest); ExactSuccessful(value, empty.Context); Equal("no-barriers-declared", Diagnostic(value));
            Equal(LegacyPayload(legacy), LegacyPayload(value));
        });
        var drillContext = (JsonObject)wall.Context.DeepClone(); drillContext["binding"]!["policy"]!["drillThroughWalls"] = true;
        drillContext["binding"]!["policySha256"] = Fixtures.Hash(Fixtures.Canonical(drillContext["binding"]!["policy"]));
        var drillRequest = Protected(baseline, drillContext);
        await Check("explicit drilling bypasses a verified solid wall without claiming a collision-clear result", async () => {
            var value = await OneShot(runner, root, drillRequest); ExactSuccessful(value, drillContext); Equal("bypassed", Diagnostic(value));
            Equal(0, Execution(value).GetProperty("diagnostics").GetProperty("collisionQueries").GetInt32()); Equal(LegacyPayload(legacy), LegacyPayload(value));
        });
        await Check("unpublished context allows only explicit bypass and does not fabricate a manifest or capture", async () => {
            var admitted = Fixtures.UnpublishedBypass(); var value = await OneShot(runner, root, Protected(baseline, admitted)); ExactSuccessful(value, admitted);
            Equal(JsonValueKind.Null, Execution(value).GetProperty("context").GetProperty("storage").ValueKind);
        });
        await Check("explicit drilling without an eligible tray remains unavailable and cannot fabricate a successful proof", async () => {
            var request = Protected(baseline, drillContext); request["rules"] = new JsonObject { ["version"] = "pf2.rules.v1",
                ["categoryMappingVersion"] = "wfc-mto-v1", ["excludedObjectIds"] = new JsonArray("segment-1") };
            var value = await OneShot(runner, root, request); Refused(value); Equal("unavailable", Diagnostic(value));
            Need(Execution(value).GetProperty("context").GetProperty("binding").GetProperty("policy").GetProperty("drillThroughWalls").GetBoolean());
            Equal(0, Execution(value).GetProperty("diagnostics").GetProperty("collisionQueries").GetInt32());
        });
        await Check("farther accessible eligible tray wins over a nearer tray across the wall", async () => {
            var request = Fixtures.Request(root, [(.3, 3, 0, .1), (-3, -.1, 1, .1)]); request["from"] = Fixtures.Point(-.2); request["to"] = Fixtures.Point(-.1);
            var value = await OneShot(runner, root, Protected(request, wall.Context)); ExactSuccessful(value, wall.Context, wall);
            Need(value.GetProperty("route").GetProperty("segmentIds").EnumerateArray().All(p => p.GetString() != "segment-1"));
        });
        await Check("offset real opening creates bounded local bends whose final polyline remains physically clear", async () => {
            var request = Fixtures.Request(root, [(.75, 1.5, .75, .1)]); request["from"] = Fixtures.Point(-.75, .75); request["to"] = Fixtures.Point(1.5, .75);
            var value = await OneShot(runner, root, Protected(request, opening.Context)); ExactSuccessful(value, opening.Context, opening);
            Need(Execution(value).GetProperty("diagnostics").GetProperty("localPhaseUsed").GetBoolean());
            Need(Execution(value).GetProperty("diagnostics").GetProperty("localEdgeChecks").GetInt32() > 0);
            Need(Execution(value).GetProperty("connectors").GetProperty("from").GetProperty("isDetour").GetBoolean());
        });
        await Check("horizontal floor with an actual closed opening permits the vertical approach", async () => {
            var floor = Fixtures.Store(root, Fixtures.Transform(Fixtures.Opening(), p => Fixtures.P(p.Y, p.Z, p.X)));
            var request = Fixtures.Request(root, [(0, 3, 0, 1)]); request["from"] = Fixtures.Point(0, 0, -1); request["to"] = Fixtures.Point(3, 0, 1);
            var value = await OneShot(runner, root, Protected(request, floor.Context)); ExactSuccessful(value, floor.Context, floor);
        });
        await Check("solid floor blocks cross-floor approaches even when a different storey tray is geometrically near", async () => {
            var floor = Fixtures.Store(root, Fixtures.Box(-20, 20, -20, 20, 0, .2));
            var request = Fixtures.Request(root, [(0, 3, 0, 1)]); request["from"] = Fixtures.Point(0, 0, -1); request["to"] = Fixtures.Point(3, 0, 1);
            Refused(await OneShot(runner, root, Protected(request, floor.Context)));
        });
        await Check("distance-qualified blocked direct chord falls back to trays with the actual tray ledger", async () => {
            var request = Fixtures.Request(root, [(-.1, .3, 0, .1)]); request["from"] = Fixtures.Point(-.1, .75); request["to"] = Fixtures.Point(.3, .75);
            request["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1";
            var value = await OneShot(runner, root, Protected(request, opening.Context)); ExactSuccessful(value, opening.Context, opening);
            var decision = Execution(value).GetProperty("directSecondary"); Equal("tray-network", decision.GetProperty("mode").GetString());
            Equal("blocked", decision.GetProperty("directCheck").GetProperty("status").GetString());
            Equal("DIRECT_SECONDARY_BLOCKED_TRAY_FALLBACK", decision.GetProperty("reasonCode").GetString());
            Equal("wfc.pf.length-components.v1", value.GetProperty("lengthLedger").GetProperty("schemaVersion").GetString());
            Equal("8", value.GetProperty("design").GetProperty("designLengthMeters").GetString());
        });
        await Check("reverse physically checked path hashes its reversed exact ordered coordinates", async () => {
            var request = (JsonObject)openingRequest.DeepClone(); request["reverse"] = true;
            var value = await OneShot(runner, root, request); ExactSuccessful(value, opening.Context, opening);
            Need(Points(value).SequenceEqual(Points(throughOpening).Reverse())); Equal(LegacyPayload(value) == LegacyPayload(throughOpening), false);
            Equal(value.GetProperty("design").GetRawText(), throughOpening.GetProperty("design").GetRawText());
        });
        await Check("reversed underflow-zero direct candidate retains exact new From singleton and one occupancy check", async () => {
            var request = Fixtures.Request(root, [(0, 1, 5, .1)]); request["from"] = Fixtures.Point(0, 0, 0); request["to"] = Fixtures.Point(1e-200, 0, 0);
            request["reverse"] = true; request["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1";
            var value = await OneShot(runner, root, Protected(request, far.Context)); ExactSuccessful(value, far.Context, far);
            var points = Points(value); Equal(1, points.Length); Equal(BitConverter.DoubleToInt64Bits(1e-200), BitConverter.DoubleToInt64Bits(points[0].X));
            Equal("direct-secondary", Execution(value).GetProperty("directSecondary").GetProperty("mode").GetString());
            Equal("wfc.pf.length-components.v2", value.GetProperty("lengthLedger").GetProperty("schemaVersion").GetString());
        });
        foreach (string kind in new[] { "missing-manifest", "missing-capture", "capture-corrupt", "manifest-corrupt", "cross-project-file", "cross-intent-copy" })
        {
            await Check("owned immutable storage refusal never downgrades: " + kind, async () => {
                var stored = Fixtures.Store(root, Fixtures.Opening()); var admitted = (JsonObject)stored.Context.DeepClone();
                if (kind == "missing-manifest") admitted["storage"]!["manifest"]!["blobId"] = Fixtures.FreshId();
                if (kind == "missing-capture") admitted["storage"]!["capture"]!["blobId"] = Fixtures.FreshId();
                if (kind == "capture-corrupt") File.AppendAllText(stored.CapturePath, " ");
                if (kind == "manifest-corrupt") File.AppendAllText(stored.ManifestPath, " ");
                if (kind == "cross-project-file") { var foreign = Path.Combine(root, "barriers", Fixtures.Id(999), admitted["storage"]!["intentId"]!.GetValue<string>()); Directory.CreateDirectory(foreign); File.Move(stored.ManifestPath, Path.Combine(foreign, Path.GetFileName(stored.ManifestPath))); }
                if (kind == "cross-intent-copy")
                {
                    // Exact bytes and their hashes are unchanged. A different
                    // storage intent still cannot borrow another capture's ID.
                    string originalDirectory = Path.GetDirectoryName(stored.ManifestPath)!, wrongIntent = Fixtures.FreshId();
                    string copiedDirectory = Path.Combine(root, "barriers", Fixtures.Project, wrongIntent); Directory.CreateDirectory(copiedDirectory);
                    var files = Directory.EnumerateFiles(originalDirectory, "*.json", SearchOption.TopDirectoryOnly).ToArray(); Need(files.Length is > 0 and <= 4);
                    foreach (string file in files) File.Copy(file, Path.Combine(copiedDirectory, Path.GetFileName(file)));
                    admitted["storage"]!["intentId"] = wrongIntent;
                }
                Refused(await OneShot(runner, root, Protected(baseline, admitted)));
            });
        }
        foreach (string kind in new[] { "missing-barriers", "missing-drill", "profile-tamper", "profile-rehashed", "policy-tamper", "snapshot-frame", "unknown-context-field", "client-path", "version-v999", "v2-design", "v1-with-barriers" })
        {
            await Check("malformed protected request refuses without calculated legacy fallback: " + kind, async () => {
                var request = (JsonObject)openingRequest.DeepClone();
                if (kind == "missing-barriers") request.Remove("barriers");
                if (kind == "missing-drill") request["barriers"]!["binding"]!["policy"]!.AsObject().Remove("drillThroughWalls");
                if (kind.StartsWith("profile", StringComparison.Ordinal)) { request["barriers"]!["profile"]!["localConnectors"]!["stepMeters"] = .5; if (kind == "profile-rehashed") request["barriers"]!["profileSha256"] = Fixtures.Hash(Fixtures.Canonical(request["barriers"]!["profile"])); }
                if (kind == "policy-tamper") request["barriers"]!["binding"]!["policy"]!["drillThroughWalls"] = true;
                if (kind == "snapshot-frame") request["barriers"]!["binding"]!["snapshot"]!["scope"]!["captureFrameId"] = Fixtures.Id(998);
                if (kind == "unknown-context-field") request["barriers"]!["engineeringAccepted"] = true;
                if (kind == "client-path") request["barriers"]!["storage"]!["manifest"]!["blobId"] = "../foreign";
                if (kind == "version-v999") request["schemaVersion"] = "pathfinder.model.runner.v999";
                if (kind == "v2-design") { request["operation"] = "design"; request["route"] = new JsonObject { ["success"] = true, ["lengthMeters"] = 1, ["fromDistanceMeters"] = 0, ["toDistanceMeters"] = 0, ["fromRequiresSecondary"] = false, ["toRequiresSecondary"] = false }; }
                if (kind == "v1-with-barriers") request["schemaVersion"] = "pathfinder.model.runner.v1";
                await MalformedRefusal(runner, root, request);
            });
        }
        await Check("an incoherent source fingerprint cannot borrow qualified walls from a different planning model", async () => {
            var request = (JsonObject)openingRequest.DeepClone(); var scope = request["barriers"]!["binding"]!["scope"]!.AsObject(); scope["contentFingerprint"] = new string('0', 64);
            request["barriers"]!["binding"]!["snapshot"]!["scope"] = scope.DeepClone(); Refused(await OneShot(runner, root, request));
        });
        await Check("outer deadline refuses without completed collision proof", async () => {
            var request = (JsonObject)openingRequest.DeepClone(); request["timeoutMilliseconds"] = 1;
            var value = await OneShot(runner, root, request); Refused(value); Equal("deadline_exceeded", Status(value));
        });
        await Check("coherent but geometrically open original capture is independently refused, rather than trusting B2-shaped claims", async () => {
            var stored = Fixtures.Store(root, Fixtures.Opening()); MakeOpen(stored);
            var value = await OneShot(runner, root, Protected(baseline, stored.Context)); Refused(value);
            Equal("BARRIER_QUALIFICATION_REFUSED", Execution(value).GetProperty("diagnostics").GetProperty("reasonCode").GetString());
        });
        await Check("session interleaves real scope/policy/empty/legacy changes and never reuses a wrong barrier kernel", async () => {
            using var session = await Session.Start(runner, root);
            void VerifyRequest(JsonObject request, JsonElement value)
            {
                if (ReferenceEquals(request, wallRequest)) { Refused(value); Need(Execution(value).GetProperty("qualification").ValueKind == JsonValueKind.Object, "Wall refusal did not reach actual geometry qualification."); }
                else if (ReferenceEquals(request, legacyRequest)) { Equal("calculated", Status(value)); Equal("pathfinder.model.response.v1", value.GetProperty("schemaVersion").GetString()); Need(!value.TryGetProperty("barriers", out _)); }
                else if (ReferenceEquals(request, drillRequest)) ExactSuccessful(value, drillContext);
                else if (ReferenceEquals(request, emptyRequest)) ExactSuccessful(value, empty.Context);
                else if (ReferenceEquals(request, clearRequest)) ExactSuccessful(value, far.Context, far);
                else ExactSuccessful(value, opening.Context, opening);
            }
            foreach (var request in new[] { openingRequest, wallRequest, drillRequest, openingRequest, emptyRequest, legacyRequest, clearRequest, openingRequest })
            {
                var expected = await OneShot(runner, root, request); var actual = await session.Query(request);
                VerifyRequest(request, expected); VerifyRequest(request, actual); Equal(Payload(expected), Payload(actual));
            }
            await session.Finish();
        });
        await Check("a session rechecks raw immutable bytes before accepting its previously qualified barrier cache", async () => {
            var stored = Fixtures.Store(root, Fixtures.Opening()); var request = Protected(baseline, stored.Context); var original = File.ReadAllBytes(stored.CapturePath);
            using var session = await Session.Start(runner, root); ExactSuccessful(await session.Query(request), stored.Context, stored);
            File.AppendAllText(stored.CapturePath, " "); Refused(await session.Query(request));
            File.WriteAllBytes(stored.CapturePath, original); ExactSuccessful(await session.Query(request), stored.Context, stored); await session.Finish();
        });
        await Check("new owned session/restart reproduces exact protected route/proof without hidden prior lane state", async () => {
            ExactSuccessful(throughOpening, opening.Context, opening);
            using var session = await Session.Start(runner, root); var actual = await session.Query(openingRequest); ExactSuccessful(actual, opening.Context, opening);
            Equal(Payload(throughOpening), Payload(actual)); await session.Finish();
        });
    }
    private static void MakeOpen(Fixtures.Stored stored)
    {
        var indices = stored.Capture["fragments"]![0]!["triangleIndices"]!.AsArray(); for (var i = 0; i < 3; i++) indices.RemoveAt(indices.Count - 1);
        var captureBytes = Fixtures.Bytes(stored.Capture); File.WriteAllBytes(stored.CapturePath, captureBytes);
        stored.Context["storage"]!["capture"]!["sha256"] = Fixtures.Hash(captureBytes); stored.Context["storage"]!["capture"]!["bytes"] = captureBytes.Length;
        stored.Manifest["capture"]!["payloadSha256"] = Fixtures.Hash(captureBytes); stored.Manifest["geometry"]!["verification"]!["verifiedCaptureSha256"] = Fixtures.Hash(captureBytes);
        var fragment = stored.Manifest["geometry"]!["fragments"]![0]!; fragment["triangles"] = indices.Count / 3;
        var mesh = new JsonObject { ["verticesMetres"] = stored.Capture["fragments"]![0]!["verticesMetres"]!.DeepClone(), ["triangleIndices"] = indices.DeepClone() };
        var meshBytes = Fixtures.Bytes(mesh); fragment["mesh"]!["sha256"] = Fixtures.Hash(meshBytes); fragment["mesh"]!["bytes"] = meshBytes.Length;
        stored.Manifest.Remove("contentSha256"); stored.Manifest["contentSha256"] = Fixtures.Hash(Fixtures.Canonical(stored.Manifest));
        var manifestBytes = Fixtures.Bytes(stored.Manifest); File.WriteAllBytes(stored.ManifestPath, manifestBytes);
        stored.Context["binding"]!["snapshot"]!["contentSha256"] = stored.Manifest["contentSha256"]!.DeepClone();
        stored.Context["storage"]!["manifest"]!["sha256"] = Fixtures.Hash(manifestBytes); stored.Context["storage"]!["manifest"]!["bytes"] = manifestBytes.Length;
    }
    private static Process Spawn(string runner, string root, string? mode = null)
    {
        var info = new ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.ArgumentList.Add(runner); if (mode is not null) info.ArgumentList.Add(mode); info.Environment["PF_ROOT"] = root;
        return Process.Start(info) ?? throw new IOException("Owned runner process did not start.");
    }
    private static string NewDiagnostic(string root, string kind, JsonObject? request = null)
    {
        string directory = Path.Combine(root, "transport-diagnostics", kind + "-" + Interlocked.Increment(ref diagnosticSerial).ToString("D4"));
        Directory.CreateDirectory(directory);
        if (request is not null)
        {
            var bytes = Encoding.UTF8.GetBytes(request.ToJsonString()); Need(bytes.Length <= 1048576, "Synthetic request exceeded the real control-message ceiling.");
            File.WriteAllBytes(Path.Combine(directory, "request.json"), bytes);
        }
        return directory;
    }
    private static async Task<byte[]> ReadCaptured(Stream input, string path, int maximum, CancellationToken token)
    {
        await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 32768, true);
        using var memory = new MemoryStream(); var buffer = new byte[32768];
        for (int count; (count = await input.ReadAsync(buffer, token)) != 0;)
        {
            int allowed = Math.Min(count, maximum - checked((int)memory.Length));
            if (allowed > 0) { await file.WriteAsync(buffer.AsMemory(0, allowed), token); memory.Write(buffer, 0, allowed); }
            if (allowed != count) throw new InvalidDataException("Owned transport output exceeded its explicit capture ceiling: " + path);
        }
        return memory.ToArray();
    }
    private sealed class RunnerProcessRefusal(int exitCode, int stdoutBytes, string directory)
        : IOException($"Owned runner exited {exitCode} with {stdoutBytes} stdout bytes; exact bounded evidence: {directory}")
    { internal int ExitCode { get; } = exitCode; internal int StdoutBytes { get; } = stdoutBytes; }
    private static async Task<JsonElement> OneShot(string runner, string root, JsonObject request)
    {
        string evidence = NewDiagnostic(root, "one-shot", request); var timer = Stopwatch.StartNew();
        using var process = Spawn(runner, root); using var deadline = new CancellationTokenSource(40000);
        var output = ReadCaptured(process.StandardOutput.BaseStream, Path.Combine(evidence, "stdout.json"), 33554432, deadline.Token);
        var error = ReadCaptured(process.StandardError.BaseStream, Path.Combine(evidence, "stderr.txt"), 65536, deadline.Token);
        try { await process.StandardInput.WriteAsync(request.ToJsonString()); process.StandardInput.Close(); await process.WaitForExitAsync(deadline.Token);
            var bytes = await output; _ = await error;
            if (process.ExitCode != 0 || bytes.Length == 0) throw new RunnerProcessRefusal(process.ExitCode, bytes.Length, evidence);
            using var json = JsonDocument.Parse(bytes); return json.RootElement.Clone(); }
        finally
        {
            if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(); }
            try { await Task.WhenAll(output, error); } catch { /* Exact bounded prefixes remain in their files on refusal/timeout. */ }
            File.WriteAllText(Path.Combine(evidence, "process.json"), JsonSerializer.Serialize(new { process.Id, process.ExitCode,
                elapsedMilliseconds = timer.Elapsed.TotalMilliseconds, requestId = request["requestId"]?.GetValue<string>(), maximumStdoutBytes = 33554432, maximumStderrBytes = 65536 }));
        }
    }
    private sealed class Session : IDisposable
    {
        private Process process; private Task<byte[]> errors; private readonly string runner, root; private string sessionDirectory;
        private int ordinal; private bool finished, retired;
        private Session(Process value, string runnerPath, string workRoot)
        {
            process = value; runner = runnerPath; root = workRoot; sessionDirectory = NewDiagnostic(root, "session-process");
            errors = ReadCaptured(process.StandardError.BaseStream, Path.Combine(sessionDirectory, "stderr.txt"), 65536, CancellationToken.None);
        }
        internal static async Task<Session> Start(string runner, string root)
        {
            var session = new Session(Spawn(runner, root, "--session-supervisor"), runner, root);
            try { using var deadline = new CancellationTokenSource(10000); await session.Ready(deadline.Token); return session; }
            catch { session.Dispose(); throw; }
        }
        private async Task Ready(CancellationToken token)
        { var ready = await ReadFrame(process.StandardOutput.BaseStream, token, Path.Combine(sessionDirectory, "ready")); Equal("pathfinder.engine.session.v1", ready.GetProperty("schemaVersion").GetString()); Equal("ready", ready.GetProperty("type").GetString()); }
        internal async Task<JsonElement> Query(JsonObject request)
        {
            using var deadline = new CancellationTokenSource(40000);
            if (retired)
            {
                await process.WaitForExitAsync(deadline.Token); _ = await errors; Equal(0, process.ExitCode); process.Dispose();
                process = Spawn(runner, root, "--session-supervisor"); sessionDirectory = NewDiagnostic(root, "session-process");
                errors = ReadCaptured(process.StandardError.BaseStream, Path.Combine(sessionDirectory, "stderr.txt"), 65536, CancellationToken.None);
                ordinal = 0; retired = false; await Ready(deadline.Token);
            }
            string evidence = NewDiagnostic(root, "session-request", request);
            await WriteFrame(process.StandardInput.BaseStream, Encoding.UTF8.GetBytes(request.ToJsonString()), deadline.Token);
            var envelope = await ReadFrame(process.StandardOutput.BaseStream, deadline.Token, Path.Combine(evidence, "stdout")); Equal("result", envelope.GetProperty("type").GetString());
            Equal(++ordinal, envelope.GetProperty("session").GetProperty("requestOrdinal").GetInt32());
            retired = envelope.GetProperty("session").GetProperty("retireAfterResponse").GetBoolean();
            File.WriteAllText(Path.Combine(evidence, "process.json"), JsonSerializer.Serialize(new { process.Id, ordinal, retireAfterResponse = retired,
                stderrPath = Path.Combine(sessionDirectory, "stderr.txt"), maximumStdoutBytes = 33554432, maximumStderrBytes = 65536 }));
            var response = envelope.GetProperty("response"); Equal(request["requestId"]!.GetValue<string>(), response.GetProperty("requestId").GetString()); return response.Clone();
        }
        internal async Task Finish()
        { process.StandardInput.Close(); using var deadline = new CancellationTokenSource(10000); await process.WaitForExitAsync(deadline.Token); _ = await errors; Equal(0, process.ExitCode); finished = true; }
        public void Dispose() { if (!finished && !process.HasExited) { process.Kill(true); process.WaitForExit(); } process.Dispose(); }
    }
    private static async Task WriteFrame(Stream stream, byte[] bytes, CancellationToken token)
    { var header = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(header, (uint)bytes.Length); await stream.WriteAsync(header, token); await stream.WriteAsync(bytes, token); await stream.FlushAsync(token); }
    private static async Task<JsonElement> ReadFrame(Stream stream, CancellationToken token, string? capturePath = null)
    { var header = new byte[4]; await stream.ReadExactlyAsync(header, token); uint size = BinaryPrimitives.ReadUInt32BigEndian(header); Need(size is > 0 and <= 33554432);
        var bytes = new byte[checked((int)size)]; await stream.ReadExactlyAsync(bytes, token);
        if (capturePath is not null) { File.WriteAllBytes(capturePath + ".json", bytes); File.WriteAllBytes(capturePath + ".frame.bin", header.Concat(bytes).ToArray()); }
        using var json = JsonDocument.Parse(bytes); return json.RootElement.Clone(); }
}
