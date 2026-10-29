using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Model;

internal static class InputScopeTests
{
    internal static void Run(JsonObject fixture, Action<string, bool, string> check, Action<string, Action> reject)
    {
        var input = JsonNode.Parse("""
            {"schemaVersion":"wfc.capture.input.v1","equipmentNameCount":1527,"chunkCount":6,"inputUtf8Bytes":70438,
             "scopeSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
             "equipmentNamesSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
             "propertyScan":{"indexedObjectCount":438155,"attemptedObjectCount":438155,"returnedObjectCount":392674,"omittedObjectCount":45481,"complete":false}}
            """)!.AsObject();
        byte[] Bytes(JsonNode node) => Encoding.UTF8.GetBytes(node.ToJsonString());
        var current = (JsonObject)fixture.DeepClone(); current["capture"]!["inputScope"] = input.DeepClone();
        var capture = current["capture"]!.AsObject(); capture["sourceKind"] = "converted"; capture["adapterVersion"] = "wfc.protected-selected-capture.v1";
        foreach (var flag in new[] { "inventoryComplete", "geometryComplete", "unitsVerified", "transformsVerified", "planningVisibilityKnown", "sourceLinkVerified" }) capture[flag] = false;
        var parsed = SnapshotReader.Read(Bytes(current));
        check("input-scope-incomplete-sdk-coverage-retained", parsed.Capture.InputScope?.PropertyScan.Complete == false && parsed.Capture.InputScope.EquipmentNameCount == 1527,
            "Synthetic descriptor exercises actual-size input counts; SDK omission remains unknown, not engineering acceptance.");
        var roundtrip = SnapshotReader.Read(JsonSerializer.SerializeToUtf8Bytes(parsed, SnapshotReader.JsonOptions));
        check("input-scope-roundtrip-hashes-counts", roundtrip.Capture.InputScope == parsed.Capture.InputScope, "Recorded counts/digests survive strict C# serialization.");
        var legacy = SnapshotReader.Read(Bytes(fixture));
        check("input-scope-legacy-omits-field", !JsonSerializer.Serialize(legacy, SnapshotReader.JsonOptions).Contains("inputScope", StringComparison.Ordinal), "Historical capture remains unchanged when provenance is absent.");
        foreach (var (name, edit) in new (string, Action<JsonObject>)[]
        {
            ("unknown-schema", value => value["schemaVersion"] = "future"),
            ("too-many-names", value => value["equipmentNameCount"] = 4097),
            ("too-many-chunks", value => value["chunkCount"] = 17),
            ("too-few-chunks", value => value["chunkCount"] = 5),
            ("zero-chunks-nonempty", value => value["chunkCount"] = 0),
            ("too-many-bytes", value => value["inputUtf8Bytes"] = 1048577),
            ("bad-hash", value => value["scopeSha256"] = "abc"),
            ("bad-names-hash", value => value["equipmentNamesSha256"] = new string('G', 64)),
            ("missing-final-scan", value => value["propertyScan"] = null),
            ("forged-complete", value => value["propertyScan"]!["complete"] = true),
            ("returned-above-attempted", value => value["propertyScan"]!["returnedObjectCount"] = 438156),
            ("attempted-above-index", value => value["propertyScan"]!["attemptedObjectCount"] = 438156),
            ("negative-returned", value => value["propertyScan"]!["returnedObjectCount"] = -1),
            ("wrong-omissions", value => value["propertyScan"]!["omittedObjectCount"] = 0),
            ("unknown-member", value => value["engineeringAccepted"] = true),
        })
        {
            var invalid = (JsonObject)current.DeepClone(); edit(invalid["capture"]!["inputScope"]!.AsObject());
            reject("input-scope-rejects-" + name, () => SnapshotReader.Read(Bytes(invalid)));
        }
        var complete = (JsonObject)current.DeepClone(); var scan = complete["capture"]!["inputScope"]!["propertyScan"]!;
        scan["returnedObjectCount"] = 438155; scan["omittedObjectCount"] = 0; scan["complete"] = true;
        check("input-scope-sdk-row-closure", SnapshotReader.Read(Bytes(complete)).Capture.InputScope!.PropertyScan.Complete, "SDK row closure alone grants no native proof.");
        foreach (var flag in new[] { "inventoryComplete", "geometryComplete", "unitsVerified", "transformsVerified", "planningVisibilityKnown", "sourceLinkVerified" })
        {
            var forged = (JsonObject)current.DeepClone(); forged["capture"]![flag] = true;
            reject("input-scope-no-forged-" + flag, () => SnapshotReader.Read(Bytes(forged)));
        }
    }
}
