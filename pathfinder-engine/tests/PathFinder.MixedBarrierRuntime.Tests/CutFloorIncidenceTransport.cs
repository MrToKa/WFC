using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Barriers;
using PathFinder.BarrierVerifier;
using static MixedRuntimeFixtures;

internal static partial class Program
{
    private static Stored StoreCutFloorIncidence(string root)
    {
        // Use all original vertices/triangles; only the transport's synthetic
        // publication envelope is new. No source face or cutout is repaired.
        var mesh = CutFloorIncidenceFixture.Gvl24429669();
        var stored = Store(root, mesh);
        var capture = stored.Capture;
        var parent = capture["selectedParents"]![0]!;
        parent["kind"] = "floor"; parent["objectId"] = "dbid:29669"; parent["dbId"] = 29669;
        var source = capture["fragments"]![0]!["source"]!;
        source["fragmentId"] = 1961; source["ownerObjectId"] = "dbid:29669";
        source["sourceUnits"] = "mm"; source["metresPerSourceUnit"] = .001;
        source["sourceToWorldMetres"] = Fixtures.Array(CutFloorIncidenceFixture.SourceToWorldMetres());
        source["transformSha256"] = Fixtures.Hash(Fixtures.Canonical(source["sourceToWorldMetres"]));
        capture["observation"]!["enumeratedFragmentIds"] = new JsonArray(1961);
        capture["observation"]!["enumerationSha256"] = Fixtures.Hash("retained cut-floor fragment1961 enumeration");
        byte[] bytes = Fixtures.Bytes(capture);
        var result = MixedBarrierCaptureVerifier.Verify(bytes);
        var evidence = result.Receipt.Evidence ?? throw new InvalidOperationException("Original cut floor refused: " + JsonSerializer.Serialize(result.Receipt.Diagnostics));
        Need(result.Qualified is not null);
        Equal(82, evidence.VertexCount); Equal(68, evidence.TriangleCount);
        Equal(1, evidence.QualifiedClosedSolidComponents); Equal(0, evidence.OriginalSurfaceComponents);
        var originals = result.Qualified!.Kernel.Components.Single().Triangles.OrderBy(t => t.LocalTriangleIndex).ToArray();
        Equal(68, originals.Length);
        bool SameBits(BarrierPoint a, BarrierPoint b) => BitConverter.DoubleToInt64Bits(a.X) == BitConverter.DoubleToInt64Bits(b.X)
            && BitConverter.DoubleToInt64Bits(a.Y) == BitConverter.DoubleToInt64Bits(b.Y) && BitConverter.DoubleToInt64Bits(a.Z) == BitConverter.DoubleToInt64Bits(b.Z);
        for (int at = 0; at < originals.Length; at++) {
            var triangle = originals[at]; Equal(at, triangle.LocalTriangleIndex);
            Equal("dbid:29669", triangle.Source.OwnerObjectId); Equal(1961, triangle.Source.FragmentId);
            Need(triangle.Source.SourceToWorldBits.SequenceEqual(CutFloorIncidenceFixture.SourceToWorldMetres().Select(BitConverter.DoubleToInt64Bits)));
            Equal(mesh.Indices[at * 3], triangle.OriginalVertexA); Equal(mesh.Indices[at * 3 + 1], triangle.OriginalVertexB); Equal(mesh.Indices[at * 3 + 2], triangle.OriginalVertexC);
            Need(SameBits(triangle.A, mesh.Vertices[triangle.OriginalVertexA]) && SameBits(triangle.B, mesh.Vertices[triangle.OriginalVertexB]) && SameBits(triangle.C, mesh.Vertices[triangle.OriginalVertexC]));
        }
        File.WriteAllBytes(stored.CapturePath, bytes);
        stored.Context["storage"]!["capture"]!["sha256"] = Fixtures.Hash(bytes); stored.Context["storage"]!["capture"]!["bytes"] = bytes.Length;
        stored.Manifest["capture"]!["payloadSha256"] = Fixtures.Hash(bytes);
        stored.Manifest["selectedParents"] = capture["selectedParents"]!.DeepClone();
        stored.Manifest["geometry"]!["fragments"]![0]!["source"] = source.DeepClone();
        var verification = stored.Manifest["geometry"]!["verification"]!;
        verification["verifiedCaptureSha256"] = Fixtures.Hash(bytes); verification["originalGeometrySha256"] = evidence.OriginalGeometrySha256;
        verification["verificationSha256"] = Fixtures.Hash("independent protected original cut floor:" + evidence.VerificationSha256);
        verification["componentMemberships"] = JsonSerializer.SerializeToNode(evidence.ComponentMemberships, MixedRuntimeFixtures.Json);
        var updated = stored with { Qualified = result }; Rehash(updated); return updated;
    }
    private static JsonObject CutFloorRequest(string root, double x, double y, double firstZ, double lastZ)
    {
        var request = Fixtures.Request(root, [(100, 103, 0, .1)]);
        request["from"] = Fixtures.Point(x, y, firstZ); request["to"] = Fixtures.Point(x, y, lastZ);
        request["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1"; return request;
    }
    private static void CutFloorBlocked(JsonElement response, Stored stored, bool expectClearDetour = false)
    {
        var evaluation = Execution(response).GetProperty("directSecondary");
        var direct = evaluation.GetProperty("directCheck");
        Equal("blocked", direct.GetProperty("status").GetString());
        Equal("qualified-closed-solid", direct.GetProperty("blocking").GetProperty("kind").GetString());
        Equal(stored.Qualified!.Receipt.Evidence!.ComponentMemberships.Single().SourceMembershipSha256,
            direct.GetProperty("blocking").GetProperty("sourceMembershipSha256").GetString());
        if (expectClearDetour) {
            // The finite floor may be routed around using the far tray. Its
            // direct material crossing must stay blocked, and every segment of
            // the successful alternate route is independently checked here.
            Equal("tray-network", evaluation.GetProperty("mode").GetString());
            Successful(response, stored.Context, stored);
        } else Refused(response);
    }
    private static async Task CutFloorIncidenceTransport(string runner, string root)
    {
        await Check("actual runner requalifies original cut-floor cap incidence and preserves the opening material and closed interior", async () => {
            var stored = StoreCutFloorIncidence(root);
            var clear = CutFloorRequest(root, 2.7, 72.1, 19.8, 20.2);
            var crossing = CutFloorRequest(root, 1, 72.2, 19.8, 20.2);
            var interior = CutFloorRequest(root, 1, 72.2, 19.9985, 19.9985);
            Successful(await OneShot(runner, root, Protected(clear, stored.Context)), stored.Context, stored);
            CutFloorBlocked(await OneShot(runner, root, Protected(crossing, stored.Context)), stored, expectClearDetour: true);
            CutFloorBlocked(await OneShot(runner, root, Protected(interior, stored.Context)), stored);
            using var session = await Session.Start(runner, root);
            Successful(await session.Query(Protected(clear, stored.Context)), stored.Context, stored);
            CutFloorBlocked(await session.Query(Protected(crossing, stored.Context)), stored, expectClearDetour: true);
            CutFloorBlocked(await session.Query(Protected(interior, stored.Context)), stored);
            Successful(await session.Query(Protected(clear, stored.Context)), stored.Context, stored);
            await session.Finish();
        });
    }
}
