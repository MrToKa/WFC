using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.BarrierVerifier;
using static MixedRuntimeFixtures;

internal static partial class Program
{
    private static async Task ObstacleReportTransport(string runner, string root)
    {
        var baseline = Fixtures.Request(root, [(-3, 3, 0, .1)]); baseline["from"] = Fixtures.Point(-2); baseline["to"] = Fixtures.Point(2);
        await Check("obstacle report lists numbered actual blockers on failed calculation", async () => {
            var stored = Store(root, Wall()); var result = await OneShot(runner, root, Protected(baseline, stored.Context)); Refused(result);
            var report = Execution(result).GetProperty("obstacleReport"); Equal("complete", report.GetProperty("status").GetString());
            Equal(0, report.GetProperty("crossedParentSelectionIds").GetArrayLength());
            Equal(Fixtures.Id(20), report.GetProperty("blockingParentSelectionIds")[0].GetString());
            Equal(10, report.GetProperty("selectedParents")[0].GetProperty("dbId").GetInt32());
            Need(result.GetProperty("message").GetString()!.Contains("Blocking obstacles: #10."));
        });
        await Check("drilling reports every crossed parent while preserving bypass proof", async () => {
            var stored = StoreTwoReportParents(root); var result = await OneShot(runner, root, Protected(baseline, stored.Context)); Successful(result, stored.Context);
            var report = Execution(result).GetProperty("obstacleReport"); Equal("complete", report.GetProperty("status").GetString());
            Equal(2, report.GetProperty("crossedParentSelectionIds").GetArrayLength());
            Equal(2, report.GetProperty("selectedParents").GetArrayLength()); Equal(0, report.GetProperty("blockingParentSelectionIds").GetArrayLength());
            Equal(report.GetProperty("totalSegments").GetInt32(), report.GetProperty("checkedSegments").GetInt32());
            Equal(10, report.GetProperty("selectedParents")[0].GetProperty("dbId").GetInt32());
            Equal(20, report.GetProperty("selectedParents")[1].GetProperty("dbId").GetInt32());
            Equal("dbid:20", report.GetProperty("selectedParents")[1].GetProperty("objectId").GetString());
        });
        await Check("connected multi-parent surface attributes only actually contacted parent", async () => {
            var stored = StoreTwoReportParents(root, adjacent: true); Equal(1, stored.Qualified!.Receipt.Evidence!.ComponentMemberships.Count);
            var result = await OneShot(runner, root, Protected(baseline, stored.Context)); Successful(result, stored.Context);
            var report = Execution(result).GetProperty("obstacleReport"); Equal("complete", report.GetProperty("status").GetString());
            Equal(1, report.GetProperty("crossedParentSelectionIds").GetArrayLength());
            Equal(Fixtures.Id(20), report.GetProperty("crossedParentSelectionIds")[0].GetString());
        });
        await Check("multi-parent shell containment remains partial without inventing parent crossings", async () => {
            var stored = StoreTwoReportParents(root, splitSolid: true); Equal(1, stored.Qualified!.Receipt.Evidence!.QualifiedClosedSolidComponents);
            var result = await OneShot(runner, root, Protected(baseline, stored.Context)); Successful(result, stored.Context);
            var report = Execution(result).GetProperty("obstacleReport"); Equal("partial", report.GetProperty("status").GetString());
            Equal(0, report.GetProperty("crossedParentSelectionIds").GetArrayLength());
            Equal("OBSTACLE_PARENT_ATTRIBUTION_INDETERMINATE", report.GetProperty("reasonCode").GetString());
        });
        await Check("ambiguous shell blockers are labeled associated selected objects", async () => {
            var stored = StoreTwoReportParents(root, splitSolid: true); var binding = stored.Context["binding"]!;
            binding["policy"]!["drillThroughWalls"] = false; binding["policySha256"] = Fixtures.Hash(Fixtures.Canonical(binding["policy"]));
            var result = await OneShot(runner, root, Protected(baseline, stored.Context)); Refused(result);
            var report = Execution(result).GetProperty("obstacleReport"); Equal("component-membership", report.GetProperty("blockingAttribution").GetString());
            Equal(2, report.GetProperty("blockingParentSelectionIds").GetArrayLength());
            Need(result.GetProperty("message").GetString()!.Contains("Selected objects associated with blocking geometry: #10, #20."));
        });
        await Check("drilling past distant obstacle does not report a false crossing", async () => {
            var stored = Store(root, Fixtures.Transform(Wall(), p => Fixtures.P(p.X + 100, p.Y, p.Z)), true);
            var result = await OneShot(runner, root, Protected(baseline, stored.Context)); Successful(result, stored.Context);
            var report = Execution(result).GetProperty("obstacleReport"); Equal("complete", report.GetProperty("status").GetString()); Equal(0, report.GetProperty("crossedParentSelectionIds").GetArrayLength());
        });
        await Check("unpublished drilling explicitly reports unavailable crossing checks", async () => {
            var context = UnpublishedBypass(); var result = await OneShot(runner, root, Protected(baseline, context)); Successful(result, context);
            var report = Execution(result).GetProperty("obstacleReport"); Equal("unavailable", report.GetProperty("status").GetString()); Equal(0, report.GetProperty("checkedSegments").GetInt32());
        });
        await Check("report qualification refusal preserves drilling result and reports uncertainty", async () => {
            var stored = Store(root, Wall(), true); stored.Manifest["geometry"]!["verification"]!["componentMemberships"]![0]!["sourceMembershipSha256"] = new string('a', 64); Rehash(stored);
            var result = await OneShot(runner, root, Protected(baseline, stored.Context)); Successful(result, stored.Context);
            Equal("unavailable", Execution(result).GetProperty("obstacleReport").GetProperty("status").GetString());
        });
        await Check("legacy drilling enumerates crossed selected closed solid", async () => {
            var stored = Fixtures.Store(root, Fixtures.Box(), true); var result = await OneShot(runner, root, Protected(baseline, stored.Context));
            Equal("calculated", Status(result)); var execution = Execution(result); Equal("bypassed", execution.GetProperty("proof").GetProperty("status").GetString());
            var report = execution.GetProperty("obstacleReport"); Equal("complete", report.GetProperty("status").GetString());
            Equal(Fixtures.Id(20), report.GetProperty("crossedParentSelectionIds")[0].GetString());
        });
    }
    private static Stored StoreTwoReportParents(string root, bool adjacent = false, bool splitSolid = false)
    {
        var stored = Store(root, splitSolid ? Fixtures.Box(-4,4,-4,4,-4,4) : Wall(), true);
        var capture = stored.Capture; var first = capture["fragments"]![0]!.AsObject(); var second = first.DeepClone().AsObject();
        second["source"]!["fragmentId"] = 12; second["source"]!["ownerObjectId"] = "dbid:20";
        second["source"]!["parentSelectionIds"] = new JsonArray(Fixtures.Id(21));
        if (splitSolid)
        {
            var indices = first["triangleIndices"]!.AsArray().Select(value => value!.GetValue<int>()).ToArray();
            first["triangleIndices"] = new JsonArray(indices.Take(18).Select(index => (JsonNode?)JsonValue.Create(index)).ToArray());
            second["triangleIndices"] = new JsonArray(indices.Skip(18).Select(index => (JsonNode?)JsonValue.Create(index)).ToArray());
        }
        else if (adjacent)
        {
            foreach (var vertex in second["verticesMetres"]!.AsArray()) vertex![1] = vertex[1]!.GetValue<double>() + 40;
            second["bounds"]!["minimum"]![1] = 20; second["bounds"]!["maximum"]![1] = 60;
        }
        else
        {
            foreach (var vertex in second["verticesMetres"]!.AsArray()) vertex![0] = .5;
            second["bounds"]!["minimum"]![0] = .5; second["bounds"]!["maximum"]![0] = .5;
        }
        capture["fragments"]!.AsArray().Add(second);
        var parent = capture["selectedParents"]![0]!.DeepClone().AsObject(); parent["selectionId"] = Fixtures.Id(21); parent["dbId"] = 20; parent["objectId"] = "dbid:20"; parent["name"] = "Second reporting wall";
        capture["selectedParents"]!.AsArray().Add(parent); capture["observation"]!["enumeratedFragmentIds"] = new JsonArray(11, 12);
        byte[] bytes = Fixtures.Bytes(capture); var verified = MixedBarrierCaptureVerifier.Verify(bytes); var evidence = verified.Receipt.Evidence!;
        Need(verified.Qualified is not null && evidence is not null); File.WriteAllBytes(stored.CapturePath, bytes);
        stored.Manifest["selectedParents"] = capture["selectedParents"]!.DeepClone(); stored.Manifest["capture"]!["payloadSha256"] = Fixtures.Hash(bytes);
        stored.Context["storage"]!["capture"] = Fixtures.Blob(stored.Context["storage"]!["capture"]!["blobId"]!.GetValue<string>(), bytes);
        var oldSummary = stored.Manifest["geometry"]!["fragments"]![0]!.DeepClone().AsObject(); var summaries = new JsonArray();
        foreach (var fragment in new[] {first, second})
        {
            var summary = oldSummary.DeepClone().AsObject(); summary["source"] = fragment["source"]!.DeepClone(); summary["bounds"] = fragment["bounds"]!.DeepClone();
            summary["vertices"] = fragment["verticesMetres"]!.AsArray().Count; summary["triangles"] = fragment["triangleIndices"]!.AsArray().Count / 3;
            var meshBytes = Fixtures.Bytes(new JsonObject { ["verticesMetres"] = fragment["verticesMetres"]!.DeepClone(), ["triangleIndices"] = fragment["triangleIndices"]!.DeepClone() });
            string blobId = Fixtures.FreshId(); summary["mesh"] = Fixtures.Blob(blobId, meshBytes); File.WriteAllBytes(Path.Combine(Path.GetDirectoryName(stored.CapturePath)!, blobId + ".json"), meshBytes); summaries.Add(summary);
        }
        stored.Manifest["geometry"]!["fragments"] = summaries;
        var verification = stored.Manifest["geometry"]!["verification"]!;
        verification["verifiedCaptureSha256"] = Fixtures.Hash(bytes); verification["originalGeometrySha256"] = evidence!.OriginalGeometrySha256;
        verification["componentMemberships"] = JsonSerializer.SerializeToNode(evidence.ComponentMemberships, MixedRuntimeFixtures.Json);
        var value = stored with { Qualified = verified }; Rehash(value); return value;
    }
}
