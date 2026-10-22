using System.Buffers.Binary;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Barriers;
using static MixedRuntimeFixtures;

internal static partial class Program
{
    private static readonly List<object> Checks = [];
    private static int failures, diagnosticSerial;
    private static void Need(bool value, string detail = "Mixed runtime assertion failed.") { if (!value) throw new InvalidOperationException(detail); }
    private static void Equal<T>(T expected, T actual) => Need(EqualityComparer<T>.Default.Equals(expected, actual), $"Expected {expected}; observed {actual}.");
    private static async Task Check(string name, Func<Task> action)
    { try { await action(); Checks.Add(new { name, status = "PASS", detail = "" }); } catch (Exception error) { failures++; Checks.Add(new { name, status = "FAIL", detail = error.GetType().Name + ": " + error.Message }); } }
    private static async Task<int> Main(string[] args)
    {
        if (args is not ["--runner", var runner, "--work-root", var work] || !Path.IsPathFullyQualified(runner) || !File.Exists(runner)
            || !Path.IsPathFullyQualified(work) || File.Exists(work) || Directory.Exists(work)) return 2;
        Directory.CreateDirectory(work);
        try { await Transport(runner, work); }
        catch (Exception error) { failures++; Checks.Add(new { name = "mixed-runtime-fixture", status = "FAIL", detail = error.GetType().Name + ": " + error.Message }); }
        Console.WriteLine(JsonSerializer.Serialize(new { status = failures == 0 ? "PASS" : "FAIL", passed = Checks.Count - failures, failed = failures, checks = Checks,
            scope = "Private independent synthetic mixed one-shot/session transport; no live SDK/frame, own-terminal or global catalog authority" }));
        return failures == 0 ? 0 : 1;
    }
    private static JsonElement Execution(JsonElement value) => value.GetProperty("barriers");
    private static string Status(JsonElement value) => value.GetProperty("status").GetString()!;
    private static BarrierPoint[] Points(JsonElement value) => value.GetProperty("route").GetProperty("pathPoints").EnumerateArray()
        .Select(point => new BarrierPoint(point.GetProperty("x").GetDouble(), point.GetProperty("y").GetDouble(), point.GetProperty("z").GetDouble())).ToArray();
    private static string RouteHash(BarrierPoint[] points)
    {
        string Bits(double value) { Span<byte> bytes = stackalloc byte[8]; BinaryPrimitives.WriteInt64LittleEndian(bytes, value == 0 ? 0L : BitConverter.DoubleToInt64Bits(value)); return Convert.ToHexString(bytes).ToLowerInvariant(); }
        var node = JsonSerializer.SerializeToNode(new { schemaVersion = "wfc.pf.route-binary64-le.v1", pointBits = points.Select(p => new[] { Bits(p.X), Bits(p.Y), Bits(p.Z) }).ToArray() });
        return Fixtures.Hash(Fixtures.Canonical(node));
    }
    private static void Refused(JsonElement value, bool validContext = true)
    {
        Need(Status(value) != "calculated", "An invalid or obstructed mixed route was calculated."); Need(!value.GetProperty("engineeringAccepted").GetBoolean());
        if (!validContext) return;
        Equal("pathfinder.model.response.v3", value.GetProperty("schemaVersion").GetString());
        Equal("wfc.pf.barrier-execution.v2", Execution(value).GetProperty("schemaVersion").GetString());
        Equal(JsonValueKind.Null, Execution(value).GetProperty("proof").ValueKind);
    }
    private static void Successful(JsonElement value, JsonObject context, MixedRuntimeFixtures.Stored? physical = null)
    {
        Equal("calculated", Status(value)); Equal("pathfinder.model.response.v3", value.GetProperty("schemaVersion").GetString());
        var execution = Execution(value); Equal("wfc.pf.barrier-execution.v2", execution.GetProperty("schemaVersion").GetString());
        Equal(Fixtures.Canonical(context), Fixtures.Canonical(JsonNode.Parse(execution.GetProperty("context").GetRawText())));
        Need(!execution.GetProperty("engineeringAccepted").GetBoolean() && !execution.GetProperty("ownTerminalExemptionsSupported").GetBoolean()); Equal("none", execution.GetProperty("authority").GetString());
        var proof = execution.GetProperty("proof"); var points = Points(value);
        Equal("wfc.pf.barrier-mixed-check-proof.v2", proof.GetProperty("schemaVersion").GetString()); Equal(Domain, proof.GetProperty("domain").GetString());
        Equal(RouteHash(points), proof.GetProperty("routeSha256").GetString()); Equal(points.Length, proof.GetProperty("routePointCount").GetInt32());
        Equal(Math.Max(1, points.Length - 1), proof.GetProperty("totalSegments").GetInt32());
        Need(!proof.GetProperty("globalModelCoverageVerified").GetBoolean() && !proof.GetProperty("physicalCableRadiusChecked").GetBoolean()
            && !proof.GetProperty("ownTerminalExemptionsSupported").GetBoolean() && !proof.GetProperty("engineeringAccepted").GetBoolean());
        string status = proof.GetProperty("status").GetString()!;
        if (status == "clear-selected-scope")
        {
            var stored = physical ?? throw new InvalidOperationException("Actual raw mixed fixture qualification required.");
            var result = stored.Qualified ?? throw new InvalidOperationException("Actual mixed verification result required.");
            var qualified = result.Qualified ?? throw new InvalidOperationException("Actual mixed kernel required.");
            var evidence = result.Receipt.Evidence ?? throw new InvalidOperationException("Exact mixed evidence required.");
            Equal(Math.Max(1, points.Length - 1), proof.GetProperty("checkedSegments").GetInt32());
            Equal(result.Receipt.CaptureSha256, execution.GetProperty("qualification").GetProperty("captureSha256").GetString());
            Equal(Fixtures.Canonical(JsonSerializer.SerializeToNode(evidence, MixedRuntimeFixtures.Json)), Fixtures.Canonical(JsonNode.Parse(execution.GetProperty("qualification").GetProperty("evidence").GetRawText())));
            for (int at = 0; at < Math.Max(1, points.Length - 1); at++) Equal(MixedBarrierSegmentStatus.Clear,
                qualified.Kernel.CheckSegment(points[at], points[Math.Min(at + 1, points.Length - 1)]).Status);
        }
        else
        {
            Need(status is "bypassed" or "no-barriers-declared"); Equal(0, proof.GetProperty("checkedSegments").GetInt32()); Equal(JsonValueKind.Null, execution.GetProperty("qualification").ValueKind);
        }
    }
    private static async Task Transport(string runner, string root)
    {
        var baseline = Fixtures.Request(root, [(-3, 3, 0, .1)]); baseline["from"] = Fixtures.Point(-2); baseline["to"] = Fixtures.Point(2);
        var wall = Store(root, Wall()); var opening = Store(root, Ring()); var far = Store(root, Fixtures.Transform(Wall(), p => Fixtures.P(p.X + 100, p.Y, p.Z)));
        var floor = Store(root, Fixtures.Transform(Wall(), p => Fixtures.P(p.Y, p.Z, p.X)));
        var floorOpening = Store(root, Fixtures.Transform(Ring(), p => Fixtures.P(p.Y, p.Z, p.X)));
        var solid = Store(root, Fixtures.Box(-4, 4, -4, 4, -4, 4)); var empty = Store(root, null);
        await Check("one-shot original open wall blocks crossing tray edges", async () => Refused(await OneShot(runner, root, Protected(baseline, wall.Context))));
        await Check("protected publication hash differs from pure hash while exact original opening remains clear", async () => {
            Need(opening.Manifest["geometry"]!["verification"]!["verificationSha256"]!.GetValue<string>() != opening.Qualified!.Receipt.Evidence!.VerificationSha256);
            Successful(await OneShot(runner, root, Protected(baseline, opening.Context)), opening.Context, opening);
        });
        await Check("original open floor blocks wrong-floor endpoint connectors", async () => {
            var request = Fixtures.Request(root); request["from"] = Fixtures.Point(0, 0, -1); request["to"] = Fixtures.Point(3);
            Refused(await OneShot(runner, root, Protected(request, floor.Context)));
        });
        await Check("actual original floor opening admits an endpoint connector", async () => {
            var request = Fixtures.Request(root); request["from"] = Fixtures.Point(0, 0, -1); request["to"] = Fixtures.Point(3);
            Successful(await OneShot(runner, root, Protected(request, floorOpening.Context)), floorOpening.Context, floorOpening);
        });
        await Check("closed-solid wholly internal route has no inferred own-terminal exemption", async () => Refused(await OneShot(runner, root, Protected(baseline, solid.Context))));
        await Check("explicit drilling authenticates mixed publication but claims bypass only", async () => {
            var stored = Store(root, Wall(), true); Successful(await OneShot(runner, root, Protected(baseline, stored.Context)), stored.Context);
        });
        await Check("explicit-empty mixed publication has separate nonphysical status", async () => Successful(await OneShot(runner, root, Protected(baseline, empty.Context)), empty.Context));
        await Check("unpublished explicit drilling never claims geometric qualification", async () => {
            var context = UnpublishedBypass(); Successful(await OneShot(runner, root, Protected(baseline, context)), context);
        });
        await Check("legacy v1 remains a distinct unchanged route lane", async () => {
            var old = Fixtures.Store(root, Fixtures.Box(100, 101)); var legacy = await OneShot(runner, root, Protected(baseline, old.Context));
            var mixed = await OneShot(runner, root, Protected(baseline, far.Context)); Successful(mixed, far.Context, far);
            Equal("calculated", Status(legacy)); Equal("wfc.pf.barrier-execution.v1", Execution(legacy).GetProperty("schemaVersion").GetString()); Equal(RouteHash(Points(legacy)), RouteHash(Points(mixed)));
        });
        await Check("blocked direct SECONDARY retains exact mixed blocking membership", async () => {
            var request = Fixtures.Request(root, [(10, 13, 0, .1)]); request["from"] = Fixtures.Point(-1); request["to"] = Fixtures.Point(1); request["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1";
            var value = await OneShot(runner, root, Protected(request, wall.Context)); Refused(value);
            var direct = Execution(value).GetProperty("directSecondary"); Equal("wfc.pf.mixed-constrained-direct-secondary.v2", direct.GetProperty("schemaVersion").GetString());
            var proof = direct.GetProperty("directCheck"); Equal("blocked", proof.GetProperty("status").GetString());
            var member = proof.GetProperty("blocking"); Equal("original-surface-contact", member.GetProperty("reason").GetString());
            Equal(wall.Qualified!.Receipt.Evidence!.ComponentMemberships[0].SourceMembershipSha256, member.GetProperty("sourceMembershipSha256").GetString()); Equal(JsonValueKind.Null, member.GetProperty("surfaceWitness").ValueKind);
        });
        await Check("direct SECONDARY through original opening remains exact and clear", async () => {
            var request = Fixtures.Request(root, [(10, 13, 0, .1)]); request["from"] = Fixtures.Point(-1); request["to"] = Fixtures.Point(1); request["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1";
            var value = await OneShot(runner, root, Protected(request, opening.Context)); Successful(value, opening.Context, opening);
            Equal("direct-secondary", Execution(value).GetProperty("directSecondary").GetProperty("mode").GetString());
        });
        await Check("reverse final polyline retains ordered mixed segment proof", async () => {
            var request = Protected(baseline, opening.Context); request["reverse"] = true; Successful(await OneShot(runner, root, request), opening.Context, opening);
        });
        await Check("self-consistent manifest with forged component hash refuses requalification", async () => {
            var stored = Store(root, Ring()); stored.Manifest["geometry"]!["verification"]!["componentMemberships"]![0]!["sourceMembershipSha256"] = new string('a', 64); Rehash(stored);
            Refused(await OneShot(runner, root, Protected(baseline, stored.Context)));
        });
        await Check("self-consistent manifest with forged original geometry hash refuses", async () => {
            var stored = Store(root, Ring()); stored.Manifest["geometry"]!["verification"]!["originalGeometrySha256"] = new string('b', 64); Rehash(stored);
            Refused(await OneShot(runner, root, Protected(baseline, stored.Context)));
        });
        await Check("old runtime tag cannot reinterpret new profile or fall back", async () => {
            var context = opening.Context.DeepClone().AsObject(); context["schemaVersion"] = "wfc.pf.barrier-runtime.v1";
            Refused(await OneShot(runner, root, Protected(baseline, context)), false);
        });
        await Check("rehashed altered frozen profile is refused", async () => {
            var context = opening.Context.DeepClone().AsObject(); context["profile"]!["qualification"]!["maximumTriangles"] = 250001;
            context["profileSha256"] = Fixtures.Hash(Fixtures.Canonical(context["profile"])); Refused(await OneShot(runner, root, Protected(baseline, context)), false);
        });
        await Check("capture scope cannot be replaced by a matching forged reference frame", async () => {
            var context = opening.Context.DeepClone().AsObject(); context["binding"]!["scope"]!["captureFrameId"] = Fixtures.FreshId();
            context["binding"]!["snapshot"]!["scope"] = context["binding"]!["scope"]!.DeepClone(); Refused(await OneShot(runner, root, Protected(baseline, context)));
        });
        await Check("revised binding and reference cannot reuse an older manifest", async () => {
            var context = opening.Context.DeepClone().AsObject(); context["binding"]!["registryRevision"] = "2"; context["binding"]!["snapshot"]!["registryRevision"] = "2";
            Refused(await OneShot(runner, root, Protected(baseline, context)));
        });
        await Check("one session alternates legacy and mixed scopes without stale kernel reuse", async () => {
            using var session = await Session.Start(runner, root); var old = Fixtures.Store(root, Fixtures.Box(100, 101));
            Successful(await session.Query(Protected(baseline, opening.Context)), opening.Context, opening);
            var legacy = await session.Query(Protected(baseline, old.Context)); Equal("calculated", Status(legacy)); Equal("wfc.pf.barrier-execution.v1", Execution(legacy).GetProperty("schemaVersion").GetString());
            Refused(await session.Query(Protected(baseline, wall.Context)));
            Successful(await session.Query(Protected(baseline, opening.Context)), opening.Context, opening); await session.Finish();
        });
        await Check("warm session authenticates capture bytes before reusing mixed qualification", async () => {
            var stored = Store(root, Ring()); using var session = await Session.Start(runner, root);
            Successful(await session.Query(Protected(baseline, stored.Context)), stored.Context, stored);
            byte[] saved = File.ReadAllBytes(stored.CapturePath); var changed = saved.ToArray(); changed[changed.Length / 2] ^= 1;
            try { File.WriteAllBytes(stored.CapturePath, changed); Refused(await session.Query(Protected(baseline, stored.Context))); }
            finally { File.WriteAllBytes(stored.CapturePath, saved); }
            Successful(await session.Query(Protected(baseline, stored.Context)), stored.Context, stored); await session.Finish();
        });
    }
}
