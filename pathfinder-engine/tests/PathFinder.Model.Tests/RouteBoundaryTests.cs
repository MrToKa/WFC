using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Model;

internal static class RouteBoundaryTests
{
    internal static void Run(JsonObject fixture, string scratch, Action<string, bool, string> check, Action<string, Action> reject)
    {
        byte[] Bytes(JsonObject value) => Encoding.UTF8.GetBytes(value.ToJsonString());
        var selected = (JsonObject)fixture.DeepClone();
        var leaf = selected["objects"]![0]!.AsObject();
        leaf["id"] = "leaf"; leaf["name"] = "Mesh"; leaf["parentId"] = "selected";
        leaf.Remove("routeName"); leaf.Remove("shapeName"); leaf["routeBoundaryId"] = "selected";
        leaf["leafToRootNames"] = new JsonArray("Mesh", "/BC007 Straight", "/DFB999");
        JsonObject Parent(string id, string? parent, string name, int dbId, params string[] names)
        {
            var value = (JsonObject)leaf.DeepClone(); value["id"] = id; value["parentId"] = parent; value["name"] = name; value["dbId"] = dbId;
            value["externalId"] = null; value["geometryRole"] = "hierarchy"; value.Remove("routeBoundaryId");
            value["fragments"] = new JsonArray(); value["allowedCategories"] = new JsonArray(); value["categoryAssignmentSource"] = "unassigned";
            value["leafToRootNames"] = new JsonArray(names.Select(name => (JsonNode?)JsonValue.Create(name)).ToArray()); return value;
        }
        selected["objects"]!.AsArray().Add(Parent("selected", "root", "/BC007 Straight", 2, "/BC007 Straight", "/DFB999"));
        selected["objects"]!.AsArray().Add(Parent("root", null, "/DFB999", 3, "/DFB999"));
        var cache = new FittedModelCache(Path.Combine(scratch, "route-boundary"));
        var result = cache.GetOrBuild(Bytes(selected)); var prepared = result.Objects.Single(value => value.Id == "leaf");
        check("selected-boundary-canonical-route-resolver", prepared.ResolvedRouteName == "/BC007", "Canonical resolver is bounded to the selected ancestor; an outside logical route cannot win.");
        check("selected-boundary-native-shape-search", prepared.ShapeName == "/BC007 Straight", "Pinned native FindShapeName chooses the nearest shape inside the same selected boundary.");
        var self = (JsonObject)selected.DeepClone(); self["objects"]![0]!["routeBoundaryId"] = "leaf";
        var selfResult = cache.GetOrBuild(Bytes(self)); var selfObject = selfResult.Objects.Single(value => value.Id == "leaf");
        check("selected-boundary-self-stops-ancestor-search", selfObject.ResolvedRouteName == "/MESH" && selfObject.ShapeName == "Mesh", "Direct leaf selection preserves canonical fallback without taking its ancestor's name.");
        check("selected-boundary-invalidates-fitted-cache", result.Key != selfResult.Key, "The selected root participates in the snapshot content hash.");
        var restored = new FittedModelCache(Path.Combine(scratch, "route-boundary")).GetOrBuild(Bytes(selected));
        check("selected-boundary-disk-restores-identical-labels", restored.LoadedFromDisk && restored.Objects.Single(value => value.Id == "leaf").ResolvedRouteName == prepared.ResolvedRouteName, "Cold and restored model metadata agree.");
        foreach (var (name, edit) in new (string, Action<JsonObject>)[]
        {
            ("missing", value => value["objects"]![0]!["routeBoundaryId"] = "absent"),
            ("nonancestor", value => { value["objects"]!.AsArray().Add(Parent("sibling", "root", "Sibling", 4, "Sibling", "/DFB999")); value["objects"]![0]!["routeBoundaryId"] = "sibling"; }),
            ("competing-route", value => value["objects"]![0]!["routeName"] = "/BC999"),
            ("competing-shape", value => value["objects"]![0]!["shapeName"] = "BEND"),
            ("hierarchy-role", value => value["objects"]![1]!["routeBoundaryId"] = "root"),
            ("forged-chain-name", value => value["objects"]![0]!["leafToRootNames"]![1] = "/BC999"),
        })
        {
            var bad = (JsonObject)selected.DeepClone(); edit(bad); reject("selected-boundary-rejects-" + name, () => SnapshotReader.Read(Bytes(bad)));
        }
        var legacy = SnapshotReader.Read(Bytes(fixture));
        check("selected-boundary-legacy-serialization-omits-new-field", !JsonSerializer.Serialize(legacy, SnapshotReader.JsonOptions).Contains("routeBoundaryId", StringComparison.Ordinal), "The optional field never adds null members to legacy snapshots.");
    }
}
