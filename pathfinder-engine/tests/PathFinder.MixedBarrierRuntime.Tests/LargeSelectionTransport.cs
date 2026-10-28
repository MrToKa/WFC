using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.BarrierVerifier;
using static MixedRuntimeFixtures;

internal static partial class Program
{
    private static JsonObject LargeSelectionContext(JsonObject original)
    {
        var context = OpeningContext(original); context["profile"]!["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v4";
        context["profile"]!["qualification"]!["maximumParents"] = 2048;
        context["profile"]!["qualification"]!["maximumComponents"] = 2048;
        ProfileHash(context); return context;
    }
    private static Stored StoreLargeSelection(string root, bool opening)
    {
        var seed = Store(root, opening ? Ring() : Wall()); var capture = seed.Capture; var manifest = seed.Manifest;
        var parentTemplate = capture["selectedParents"]![0]!.DeepClone(); var fragmentTemplate = capture["fragments"]![0]!.DeepClone();
        var selected = new JsonArray(); var fragments = new JsonArray(); var summaries = new JsonArray(); var enumerated = new JsonArray();
        for (int at = 0; at < 2048; at++)
        {
            string parentId = Fixtures.Id(100000 + at); int dbId = 100000 + at;
            var parent = parentTemplate.DeepClone(); parent["selectionId"] = parentId; parent["objectId"] = "dbid:" + dbId; parent["dbId"] = dbId;
            selected.Add(parent);
            var mesh = at == 0 ? opening ? Ring() : Wall() : Fixtures.Transform(Wall(), p => Fixtures.P(p.X + 100 + at * 50, p.Y, p.Z));
            var fragment = fragmentTemplate.DeepClone();
            fragment["source"]!["fragmentId"] = at + 1; fragment["source"]!["ownerObjectId"] = "dbid:" + dbId;
            fragment["source"]!["parentSelectionIds"] = new JsonArray(parentId);
            fragment["verticesMetres"] = JsonSerializer.SerializeToNode(mesh.Vertices.Select(p => new[] { p.X, p.Y, p.Z }));
            fragment["triangleIndices"] = JsonSerializer.SerializeToNode(mesh.Indices);
            fragment["bounds"] = JsonSerializer.SerializeToNode(new { minimum = new[] { mesh.Vertices.Min(p => p.X), mesh.Vertices.Min(p => p.Y), mesh.Vertices.Min(p => p.Z) },
                maximum = new[] { mesh.Vertices.Max(p => p.X), mesh.Vertices.Max(p => p.Y), mesh.Vertices.Max(p => p.Z) } });
            byte[] meshBytes = Fixtures.Bytes(new JsonObject { ["verticesMetres"] = fragment["verticesMetres"]!.DeepClone(), ["triangleIndices"] = fragment["triangleIndices"]!.DeepClone() });
            string meshId = Fixtures.FreshId(); File.WriteAllBytes(Path.Combine(Path.GetDirectoryName(seed.CapturePath)!, meshId + ".json"), meshBytes);
            summaries.Add(new JsonObject { ["source"] = fragment["source"]!.DeepClone(), ["bounds"] = fragment["bounds"]!.DeepClone(),
                ["mesh"] = Fixtures.Blob(meshId, meshBytes), ["vertices"] = mesh.Vertices.Length, ["triangles"] = mesh.Indices.Length / 3 });
            fragments.Add(fragment); enumerated.Add(at + 1);
        }
        capture["selectedParents"] = selected; capture["fragments"] = fragments; capture["observation"]!["enumeratedFragmentIds"] = enumerated;
        byte[] captureBytes = Fixtures.Bytes(capture); File.WriteAllBytes(seed.CapturePath, captureBytes);
        var result = MixedBarrierCaptureVerifier.Verify(captureBytes, new() { MaximumParents = 2048, MaximumComputationalMeshes = 2048 }, maximumReceiptBytes: 4194304);
        var evidence = result.Receipt.Evidence ?? throw new InvalidOperationException("Large runtime fixture refused: " + JsonSerializer.Serialize(result.Receipt));
        Need(result.Qualified is not null && evidence.ComponentMemberships.Count == 2048);
        manifest["selectedParents"] = selected.DeepClone(); manifest["capture"]!["payloadSha256"] = Fixtures.Hash(captureBytes);
        manifest["geometry"]!["fragments"] = summaries;
        var verification = manifest["geometry"]!["verification"]!;
        verification["verifiedCaptureSha256"] = Fixtures.Hash(captureBytes); verification["originalGeometrySha256"] = evidence.OriginalGeometrySha256;
        verification["verificationSha256"] = Fixtures.Hash("independent protected large publication:" + evidence.VerificationSha256);
        verification["componentMemberships"] = JsonSerializer.SerializeToNode(evidence.ComponentMemberships, MixedRuntimeFixtures.Json);
        seed.Context["storage"]!["capture"]!["sha256"] = Fixtures.Hash(captureBytes); seed.Context["storage"]!["capture"]!["bytes"] = captureBytes.Length;
        var stored = new Stored(LargeSelectionContext(seed.Context), capture, manifest, seed.CapturePath, seed.ManifestPath, result);
        Rehash(stored); Need(new FileInfo(stored.ManifestPath).Length is > 262144 and <= 4194304); return stored;
    }
    private static async Task LargeSelectionTransport(string runner, string root)
    {
        var request = Fixtures.Request(root, [(-3, 3, 0, .1)]); request["from"] = Fixtures.Point(-2); request["to"] = Fixtures.Point(2);
        var opening = StoreLargeSelection(root, true);
        await Check("explicit v4 runtime requalifies2048 original components and routes through the actual opening", async () => {
            var value = await OneShot(runner, root, Protected(request, opening.Context)); Successful(value, opening.Context, opening);
            Equal(2048, Execution(value).GetProperty("qualification").GetProperty("evidence").GetProperty("componentMemberships").GetArrayLength());
        });
        foreach (bool oldOpening in new[] { false, true }) await Check("historical " + (oldOpening ? "v3" : "v2") + " runtime refuses2048manifest without expanding its bounds", async () => {
            var old = opening.Context.DeepClone().AsObject(); old["profile"] = Profile(); ProfileHash(old);
            if (oldOpening) old = OpeningContext(old);
            Refused(await OneShot(runner, root, Protected(request, old)), false);
        });
        await Check("v4 runtime keeps original wall contact blocked rather than treating a larger scope as empty", async () => {
            var wall = StoreLargeSelection(root, false); Refused(await OneShot(runner, root, Protected(request, wall.Context)));
        });
        await Check("v4 cannot widen unchanged triangle or memory limits even with a fresh profile hash", async () => {
            foreach (var section in new[] { "qualification", "kernel" })
            {
                var changed = opening.Context.DeepClone().AsObject();
                if (section == "qualification") changed["profile"]![section]!["maximumTriangles"] = 250001;
                else changed["profile"]![section]!["maximumEstimatedBytes"] = 134217729;
                ProfileHash(changed); Refused(await OneShot(runner, root, Protected(request, changed)), false);
            }
        });
        await Check("one session reuses the bounded2048scope then returns to historical v3 without profile leakage", async () => {
            using var session = await Session.Start(runner, root);
            Successful(await session.Query(Protected(request, opening.Context)), opening.Context, opening);
            Successful(await session.Query(Protected(request, opening.Context)), opening.Context, opening);
            var old = Store(root, Ring()); var context = OpeningContext(old.Context);
            Successful(await session.Query(Protected(request, context)), context, old); await session.Finish();
        });
    }
}
