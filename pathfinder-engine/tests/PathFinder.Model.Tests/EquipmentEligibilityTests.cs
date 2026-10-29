using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Model;

internal static class EquipmentEligibilityTests
{
    internal static void Run(JsonObject fixture, Action<string, bool, string> check, Action<string, Action> reject)
    {
        byte[] Bytes(JsonNode node) => Encoding.UTF8.GetBytes(node.ToJsonString());
        var baseline = (JsonObject)fixture.DeepClone(); var capture = baseline["capture"]!.AsObject(); capture["adapterVersion"] = "wfc.protected-selected-capture.v1"; capture["sourceKind"] = "converted";
        foreach (var flag in new[] { "inventoryComplete", "geometryComplete", "unitsVerified", "transformsVerified", "planningVisibilityKnown", "sourceLinkVerified" }) capture[flag] = false;
        var equipment = baseline["objects"]![0]!.AsObject(); equipment["geometryRole"] = "object"; equipment["nativeHidden"] = null; equipment["planningExcluded"] = false; equipment["categoryAssignmentSource"] = "unassigned"; equipment["allowedCategories"] = new JsonArray(); equipment["fragments"] = new JsonArray(); equipment["routeName"] = null; equipment["shapeName"] = null; equipment["leafToRootNames"] = new JsonArray("STRAIGHT");
        var proof = JsonNode.Parse("""{"schemaVersion":"wfc.pf.equipment-eligibility.v1","matchingPolicyVersion":"wfc.pf.project-exact-candidates.v3","visibilityScopeSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","visibility":"visible","checkedAncestorCount":1,"fragmentStatus":"all-visible","fragmentCount":2}""")!;
        equipment["equipmentEligibility"] = proof.DeepClone(); var parsed = SnapshotReader.Read(Bytes(baseline));
        check("equipment-eligibility-strict-visible-sdk-evidence", parsed.Objects[0].EquipmentEligibility?.FragmentCount == 2 && parsed.Objects[0].NativeHidden is null && !parsed.Capture.PlanningVisibilityKnown, "Display-only metadata does not manufacture native visibility or engineering authority.");
        var roundtrip = SnapshotReader.Read(JsonSerializer.SerializeToUtf8Bytes(parsed, SnapshotReader.JsonOptions)); check("equipment-eligibility-exact-roundtrip", roundtrip.Objects[0].EquipmentEligibility == parsed.Objects[0].EquipmentEligibility, "All immutable proof fields survive the strict C# boundary.");
        var aggregate = (JsonObject)baseline.DeepClone(); aggregate["capture"]!["adapterVersion"] = "wfc.project-preparation-aggregate.v1";
        check("equipment-eligibility-server-aggregate-retains-exact-proof", SnapshotReader.Read(Bytes(aggregate)).Objects[0].EquipmentEligibility == parsed.Objects[0].EquipmentEligibility, "The real server aggregate adapter preserves exact per-object display evidence.");
        foreach (var flag in new[] { "inventoryComplete", "geometryComplete", "unitsVerified", "transformsVerified", "planningVisibilityKnown", "sourceLinkVerified" }) { var invalid = (JsonObject)aggregate.DeepClone(); invalid["capture"]![flag] = true; reject("equipment-eligibility-aggregate-no-native-proof-" + flag, () => SnapshotReader.Read(Bytes(invalid))); }
        var nativeAggregate = (JsonObject)aggregate.DeepClone(); nativeAggregate["capture"]!["sourceKind"] = "native-reference"; reject("equipment-eligibility-aggregate-cannot-claim-native-source", () => SnapshotReader.Read(Bytes(nativeAggregate)));
        var nullProof = (JsonObject)baseline.DeepClone(); nullProof["objects"]![0]!["equipmentEligibility"] = null; reject("equipment-eligibility-explicit-null-refused", () => SnapshotReader.Read(Bytes(nullProof)));
        var missingParent = (JsonObject)baseline.DeepClone(); missingParent["objects"]![0]!["parentId"] = "absent-parent"; reject("equipment-eligibility-missing-parent-controlled-refusal", () => SnapshotReader.Read(Bytes(missingParent)));
        var legacy = SnapshotReader.Read(Bytes(fixture)); check("equipment-eligibility-legacy-absence-no-default", !JsonSerializer.Serialize(legacy, SnapshotReader.JsonOptions).Contains("equipmentEligibility", StringComparison.Ordinal), "No optional metadata is inserted into historical snapshots.");
        var noGeometry = (JsonObject)baseline.DeepClone(); noGeometry["objects"]![0]!["equipmentEligibility"]!["fragmentCount"] = 0; noGeometry["objects"]![0]!["equipmentEligibility"]!["fragmentStatus"] = "geometry-free-node-bounds";
        check("equipment-eligibility-geometry-free-sdk-bounds", SnapshotReader.Read(Bytes(noGeometry)).Objects[0].EquipmentEligibility?.FragmentCount == 0, "Finite snapshot bounds and explicit geometry-free evidence remain distinct from all-visible fragments.");
        foreach (var (name, mutate) in new (string, Action<JsonObject>)[] {
            ("schema", p => p["schemaVersion"] = "future"), ("old-policy", p => p["matchingPolicyVersion"] = "wfc.pf.project-exact-candidates.v2"),
            ("hash", p => p["visibilityScopeSha256"] = "bad"), ("visibility", p => p["visibility"] = "hidden"),
            ("zero-depth", p => p["checkedAncestorCount"] = 0), ("depth-limit", p => p["checkedAncestorCount"] = 513),
            ("actual-depth", p => p["checkedAncestorCount"] = 2), ("negative-fragments", p => p["fragmentCount"] = -1),
            ("fragment-limit", p => p["fragmentCount"] = 1000001), ("empty-all-visible", p => p["fragmentCount"] = 0),
            ("geometry-free-nonzero", p => p["fragmentStatus"] = "geometry-free-node-bounds"), ("partial", p => p["fragmentStatus"] = "partially-visible"),
            ("unknown-member", p => p["engineeringAccepted"] = true), ("missing-field", p => p.Remove("visibility")) }) {
            var invalid = (JsonObject)baseline.DeepClone(); mutate(invalid["objects"]![0]!["equipmentEligibility"]!.AsObject()); reject("equipment-eligibility-reject-" + name, () => SnapshotReader.Read(Bytes(invalid)));
        }
        foreach (var (name, mutate) in new (string, Action<JsonObject>)[] {
            ("native-hidden", p => p["nativeHidden"] = true), ("native-visible-claim", p => p["nativeHidden"] = false), ("excluded", p => p["planningExcluded"] = true), ("hierarchy-role", p => p["geometryRole"] = "hierarchy") }) {
            var invalid = (JsonObject)baseline.DeepClone(); mutate(invalid["objects"]![0]!.AsObject()); reject("equipment-eligibility-reject-" + name, () => SnapshotReader.Read(Bytes(invalid)));
        }
        foreach (var flag in new[] { "inventoryComplete", "geometryComplete", "unitsVerified", "transformsVerified", "planningVisibilityKnown", "sourceLinkVerified" }) {
            var invalid = (JsonObject)baseline.DeepClone(); invalid["capture"]![flag] = true; reject("equipment-eligibility-no-native-proof-" + flag, () => SnapshotReader.Read(Bytes(invalid)));
        }
        var parented = (JsonObject)baseline.DeepClone(); var parent = (JsonObject)parented["objects"]![0]!.DeepClone(); parent.Remove("equipmentEligibility"); parent["id"] = "parent"; parent["dbId"] = 2; parent["name"] = "Parent"; parent["geometryRole"] = "hierarchy"; parent["leafToRootNames"] = new JsonArray("Parent");
        parented["objects"]!.AsArray().Add(parent); parented["objects"]![0]!["parentId"] = "parent"; parented["objects"]![0]!["leafToRootNames"] = new JsonArray("STRAIGHT", "Parent"); parented["objects"]![0]!["equipmentEligibility"]!["checkedAncestorCount"] = 2;
        check("equipment-eligibility-exact-ancestor-closure", SnapshotReader.Read(Bytes(parented)).Objects[0].EquipmentEligibility?.CheckedAncestorCount == 2, "Proof includes the actual SDK object plus complete ancestor chain.");
        var mixed = (JsonObject)baseline.DeepClone(); var second = (JsonObject)mixed["objects"]![0]!.DeepClone(); second["id"] = "equipment-two"; second["dbId"] = 2; second["equipmentEligibility"]!["visibilityScopeSha256"] = new string('b', 64); mixed["objects"]!.AsArray().Add(second); reject("equipment-eligibility-reject-mixed-display-scopes", () => SnapshotReader.Read(Bytes(mixed)));
    }
}
