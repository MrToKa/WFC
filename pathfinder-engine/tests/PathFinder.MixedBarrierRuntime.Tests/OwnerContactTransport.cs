using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.BarrierVerifier;
using static MixedRuntimeFixtures;

internal static partial class Program
{
    // Independent synthetic counterpart of adjacent CAD panels whose shared
    // end faces have opposite diagonals. No customer capture is published here.
    private static Stored StoreOwnerContact(string root)
    {
        var stored = Store(root, Fixtures.Box(-1, 0, -1, 1, -1, 1));
        var second = Fixtures.Box(0, 1, -1, 1, -1, 1);
        int[] oppositeDiagonal = [4, 7, 3, 4, 3, 0];
        oppositeDiagonal.CopyTo(second.Indices, 24);
        var capture = stored.Capture;
        var parent = capture["selectedParents"]![0]!.DeepClone().AsObject();
        string selectionId = Fixtures.FreshId();
        parent["selectionId"] = selectionId; parent["objectId"] = "dbid:20"; parent["dbId"] = 20;
        capture["selectedParents"]!.AsArray().Add(parent);
        var fragment = capture["fragments"]![0]!.DeepClone().AsObject();
        fragment["source"]!["fragmentId"] = 12; fragment["source"]!["ownerObjectId"] = "dbid:20";
        fragment["source"]!["parentSelectionIds"] = new JsonArray(selectionId);
        fragment["verticesMetres"] = new JsonArray(second.Vertices.Select(p => (JsonNode)Fixtures.Array([p.X, p.Y, p.Z])).ToArray());
        fragment["triangleIndices"] = new JsonArray(second.Indices.Select(i => (JsonNode?)JsonValue.Create(i)).ToArray());
        fragment["bounds"] = new JsonObject { ["minimum"] = Fixtures.Array([0, -1, -1]), ["maximum"] = Fixtures.Array([1, 1, 1]) };
        capture["fragments"]!.AsArray().Add(fragment);
        capture["observation"]!["enumeratedFragmentIds"] = new JsonArray(11, 12);
        capture["observation"]!["enumerationSha256"] = Fixtures.Hash("independent two-panel enumeration");
        byte[] captureBytes = Fixtures.Bytes(capture);
        var qualified = MixedBarrierCaptureVerifier.Verify(captureBytes);
        var evidence = qualified.Receipt.Evidence ?? throw new InvalidOperationException("Owner contact refused: " + JsonSerializer.Serialize(qualified.Receipt.Diagnostics));
        Need(qualified.Qualified is not null && evidence.QualifiedClosedSolidComponents == 2 && evidence.OriginalSurfaceComponents == 0);
        File.WriteAllBytes(stored.CapturePath, captureBytes);
        stored.Context["storage"]!["capture"]!["sha256"] = Fixtures.Hash(captureBytes);
        stored.Context["storage"]!["capture"]!["bytes"] = captureBytes.Length;
        stored.Manifest["capture"]!["payloadSha256"] = Fixtures.Hash(captureBytes);
        stored.Manifest["selectedParents"] = capture["selectedParents"]!.DeepClone();
        var meshBytes = Fixtures.Bytes(new JsonObject { ["verticesMetres"] = fragment["verticesMetres"]!.DeepClone(), ["triangleIndices"] = fragment["triangleIndices"]!.DeepClone() });
        string meshId = Fixtures.FreshId();
        File.WriteAllBytes(Path.Combine(Path.GetDirectoryName(stored.CapturePath)!, meshId + ".json"), meshBytes);
        stored.Manifest["geometry"]!["fragments"]!.AsArray().Add(new JsonObject {
            ["source"] = fragment["source"]!.DeepClone(), ["bounds"] = fragment["bounds"]!.DeepClone(),
            ["mesh"] = Fixtures.Blob(meshId, meshBytes), ["vertices"] = second.Vertices.Length, ["triangles"] = second.Indices.Length / 3,
        });
        var verification = stored.Manifest["geometry"]!["verification"]!;
        verification["verifiedCaptureSha256"] = Fixtures.Hash(captureBytes);
        verification["originalGeometrySha256"] = evidence.OriginalGeometrySha256;
        verification["verificationSha256"] = Fixtures.Hash("independent protected contact panels:" + evidence.VerificationSha256);
        verification["componentMemberships"] = JsonSerializer.SerializeToNode(evidence.ComponentMemberships, MixedRuntimeFixtures.Json);
        var result = stored with { Qualified = qualified }; Rehash(result); return result;
    }
    private static async Task OwnerContactTransport(string runner, string root)
    {
        await Check("actual runner retains face-touching owner solids with opposite cap diagonals and blocks both interiors", async () => {
            var stored = StoreOwnerContact(root); var evidence = stored.Qualified!.Receipt.Evidence!;
            Equal(24, evidence.TriangleCount); Equal(2, evidence.FragmentCount);
            foreach (var sample in new[] { (X: -.5, Component: 0), (X: .5, Component: 1), (X: 0d, Component: -1) }) {
                var request = Fixtures.Request(root, [(10, 13, 0, .1)]);
                request["from"] = Fixtures.Point(sample.X, -.2); request["to"] = Fixtures.Point(sample.X, .2);
                request["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1";
                var response = await OneShot(runner, root, Protected(request, stored.Context)); Refused(response);
                var direct = Execution(response).GetProperty("directSecondary").GetProperty("directCheck");
                Equal("blocked", direct.GetProperty("status").GetString());
                var witness = direct.GetProperty("blocking"); Equal("qualified-closed-solid", witness.GetProperty("kind").GetString());
                if (sample.Component >= 0) Equal(evidence.ComponentMemberships[sample.Component].SourceMembershipSha256, witness.GetProperty("sourceMembershipSha256").GetString());
            }
            var clear = Fixtures.Request(root, [(-3, 3, 2, .1)]);
            clear["from"] = Fixtures.Point(-2, 2); clear["to"] = Fixtures.Point(2, 2);
            Successful(await OneShot(runner, root, Protected(clear, stored.Context)), stored.Context, stored);
        });
    }
}
