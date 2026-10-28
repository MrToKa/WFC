using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Model;

namespace PathFinder.RunnerSession.Tests;

internal static class Corpus
{
    internal const string Project = "10000000-0000-4000-8000-000000000001", Model = "10000000-0000-4000-8000-000000000002";
    private static readonly double[] Identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    internal static string Emit(string root)
    {
        if (!Path.IsPathFullyQualified(root) || Directory.Exists(root) || File.Exists(root)) throw new ArgumentException("A new absolute corpus root is required.");
        Directory.CreateDirectory(Path.Combine(root, "snapshots"));
        var chain = Snapshot([(0d, 2d, 0d), (2d, 4d, 0d), (4.4d, 6.4d, 0d)]);
        var tied = Snapshot([(0d, 6d, 0d), (0d, 6d, 1d)]) with { Model = new() { ProjectId = Project, ModelVersionId = "10000000-0000-4000-8000-000000000003", ContentSha256 = Hash("parallel-tied-v1") } };
        var changed = chain with { Objects = chain.Objects.Select((o, i) => i == 1 ? o with { AllowedCategories = ["LV"] } : o).ToArray() };
        var dedicatedLeaf = chain.Objects[0] with { Name = "FTUBE /BC001/123", ParentId = "lookup-owner", LeafToRootNames = ["FTUBE /BC001/123", "/BC001"], RouteName = null, ShapeName = null, NativeHidden = null, CategoryAssignmentSource = "lookup-all-categories" };
        var dedicated = chain with { Capture = new() { AdapterVersion = "wfc.protected-lookup-capture.v1", SourceKind = "converted", LookupRouteCodes = ["/BC001"], EvidenceSha256 = [], InventoryComplete = false, GeometryComplete = false, UnitsVerified = false, TransformsVerified = false, PlanningVisibilityKnown = false, SourceLinkVerified = false },
            Objects = [dedicatedLeaf, dedicatedLeaf with { Id = "lookup-owner", Name = "/BC001", ParentId = null, LeafToRootNames = ["/BC001"], GeometryRole = "hierarchy", Fragments = [], AllowedCategories = [], CategoryAssignmentSource = "unassigned" }] };
        var snapshots = new[] { chain, tied, changed, dedicated }; var descriptors = new List<object>();
        for (var index = 0; index < snapshots.Length; index++)
        {
            var id = "20000000-0000-4000-8000-" + (index + 1).ToString("D12"); var bytes = JsonSerializer.SerializeToUtf8Bytes(snapshots[index], SnapshotReader.JsonOptions);
            File.WriteAllBytes(Path.Combine(root, "snapshots", id + ".json"), bytes);
            descriptors.Add(new { id, sha256 = SnapshotReader.Sha256(bytes), modelVersionId = snapshots[index].Model.ModelVersionId });
        }
        var cases = new List<object>();
        JsonObject Request(int snapshot = 0, string operation = "calculate")
        {
            var descriptor = JsonSerializer.SerializeToElement(descriptors[snapshot]);
            return new JsonObject
            {
                ["schemaVersion"] = "pathfinder.model.runner.v1", ["requestId"] = Guid.NewGuid().ToString("D"), ["operation"] = operation,
                ["projectId"] = Project, ["modelVersionId"] = snapshots[snapshot].Model.ModelVersionId,
                ["snapshotId"] = descriptor.GetProperty("id").GetString(), ["snapshotSha256"] = descriptor.GetProperty("sha256").GetString(),
                ["timeoutMilliseconds"] = 30000, ["category"] = "Control", ["from"] = Point(0, 0, .1), ["to"] = Point(6.4, 0, .1),
                ["options"] = new JsonObject { ["connectionToleranceMeters"] = .5, ["sampleSpacingMeters"] = .125, ["secondaryDistanceMeters"] = 2,
                    ["preferVerticalApproach"] = true, ["maxGraphNodes"] = 200000, ["maxGraphConnections"] = 1000000 },
                ["projectSettings"] = new JsonObject { ["revision"] = "1", ["secondaryTrayLength"] = "5", ["endConnectionLength"] = "6", ["additionalBendingPercent"] = "10" }
            };
        }
        void Add(string label, JsonObject request, string? expectedStatus = null, double? expectedLengthMeters = null) => cases.Add(new { label, request, expectedStatus, expectedLengthMeters });
        var a = Request(); Add("A baseline chain", a, "calculated", 6.4);
        var b = Request(); b["from"] = Point(1, 0, .1); b["to"] = Point(5.4, 0, .1); Add("B different endpoints", b, "calculated", 4.4);
        Add("A repeated after B", Request(), "calculated", 6.4);
        var reverse = Request(); reverse["reverse"] = true; Add("Reverse A", reverse, "calculated", 6.4);
        foreach (var category in new[] { "MV", "LV", "Control", "Instrumentation" }) { var r = Request(); r["category"] = category; Add("Category " + category, r, "calculated", 6.4); }
        var small = Request(); small["options"]!["connectionToleranceMeters"] = .1; Add("Gap small", small, "no_path");
        Add("Gap large after small", Request(), "calculated", 6.4); var again = (JsonObject)small.DeepClone(); again["requestId"] = Guid.NewGuid().ToString("D"); Add("Gap small after large", again, "no_path");
        var approach = Request(); approach["from"] = Point(0, 0, 4); approach["options"]!["preferVerticalApproach"] = false; approach["options"]!["secondaryDistanceMeters"] = 2; Add("SECONDARY approach", approach, "calculated");
        var settings = Request(); settings["projectSettings"]!["revision"] = "2"; settings["projectSettings"]!["endConnectionLength"] = "3.25"; settings["projectSettings"]!["additionalBendingPercent"] = "12.5"; Add("Changed exact Details allowances", settings, "calculated", 6.4);
        var sample = Request(); sample["options"]!["sampleSpacingMeters"] = .4; sample["options"]!["preferVerticalApproach"] = false; Add("Different query options", sample, "calculated", 6.4);
        var lookup = Request(0, "lookup"); lookup.Remove("category"); lookup.Remove("from"); lookup.Remove("to"); lookup.Remove("projectSettings"); lookup["routeText"] = "/BC001/BC002/BC003"; Add("Ordered lookup interleaved", lookup, "calculated", 6.4);
        var lookupReverse = (JsonObject)lookup.DeepClone(); lookupReverse["requestId"] = Guid.NewGuid().ToString("D"); lookupReverse["reverse"] = true; Add("Reverse ordered lookup", lookupReverse, "calculated", 6.4);
        var design = Request(0, "design"); design.Remove("category"); design.Remove("from"); design.Remove("to"); design["route"] = new JsonObject { ["success"] = true, ["lengthMeters"] = 6.4, ["fromDistanceMeters"] = 0, ["toDistanceMeters"] = 0, ["fromRequiresSecondary"] = false, ["toRequiresSecondary"] = false }; Add("Retained design interleaved", design, "calculated");
        var excluded = Request(); excluded["rules"] = new JsonObject { ["version"] = "pf2.rules.v1", ["categoryMappingVersion"] = "wfc-mto-v1", ["excludedObjectIds"] = new JsonArray("segment-2") }; Add("Rules exclude middle", excluded, "no_path");
        Add("A after rules reset", Request(), "calculated", 6.4);
        foreach (var category in new[] { "MV", "LV", "Control" }) { var r = Request(2); r["category"] = category; Add("Changed snapshot category " + category, r, category == "LV" ? "calculated" : "no_path"); }
        var tie = Request(1); tie["from"] = Point(0, .5, .1); tie["to"] = Point(6, .5, .1); Add("Parallel tie A", tie, "calculated");
        var tieB = (JsonObject)tie.DeepClone(); tieB["requestId"] = Guid.NewGuid().ToString("D"); tieB["from"] = Point(1, 1, .1); tieB["to"] = Point(5, 0, .1); tieB["options"]!["connectionToleranceMeters"] = 1; Add("Parallel distinct attachment B", tieB, "calculated");
        var tieA = (JsonObject)tie.DeepClone(); tieA["requestId"] = Guid.NewGuid().ToString("D"); Add("Parallel tie A after B", tieA, "calculated");
        Add("Original model after alternate model", Request(), "calculated", 6.4);
        var budget = Request(); budget["options"]!["maxGraphNodes"] = 2; Add("Explicit core graph budget", budget, "resource_limit");
        Add("Valid A following resource retirement", Request(), "calculated", 6.4);
        var dedicatedLookup = Request(3, "lookup"); dedicatedLookup.Remove("category"); dedicatedLookup.Remove("from"); dedicatedLookup.Remove("to"); dedicatedLookup.Remove("projectSettings"); dedicatedLookup["routeText"] = "/bc001/BC001"; Add("Dedicated lookup scope", dedicatedLookup, "calculated", 2);
        Add("Dedicated lookup cannot become planning", Request(3), "invalid_request");
        Add("Valid planning after purpose refusal", Request(), "calculated", 6.4);
        var manifest = Path.Combine(root, "manifest.json"); File.WriteAllText(manifest, JsonSerializer.Serialize(new { schemaVersion = "pathfinder.runner.session.corpus.v1", scope = "synthetic-only-not-native-or-full-plant", cases }, new JsonSerializerOptions { WriteIndented = true })); return manifest;
    }
    private static JsonObject Point(double x, double y, double z) => new() { ["x"] = x, ["y"] = y, ["z"] = z };
    private static string Hash(string value) => SnapshotReader.Sha256(Encoding.UTF8.GetBytes(value));
    private static ModelSnapshot Snapshot((double Start, double End, double Y)[] spans) => new()
    {
        SchemaVersion = "pathfinder.model.snapshot.v1", Model = new() { ProjectId = Project, ModelVersionId = Model, ContentSha256 = Hash("runner-session-synthetic-v1") },
        Capture = new() { AdapterVersion = "runner-session.synthetic.v1", SourceKind = "synthetic", InventoryComplete = true, GeometryComplete = true, UnitsVerified = true, TransformsVerified = true, PlanningVisibilityKnown = true, SourceLinkVerified = false, EvidenceSha256 = [] },
        Coordinates = new() { VertexFrame = "canonical-world-metres", SourceUnits = "metres", MetresPerSourceUnit = 1, SourceToWorldMetres = Identity, GlobalOffsetMetres = [0, 0, 0], DisplayToWorldMetres = Identity },
        Objects = spans.Select((span, index) => new SnapshotObject
        {
            Id = "segment-" + (index + 1), ParentId = null, Name = "FTUBE", GeometryRole = "routing-leaf", LeafToRootNames = ["FTUBE", "/BC" + (index + 1).ToString("D3")], Properties = [], NativeHidden = false, PlanningExcluded = false,
            RouteName = "/BC" + (index + 1).ToString("D3"), ShapeName = "FTUBE", CategoryAssignmentSource = "synthetic", AllowedCategories = ["MV", "LV", "Control"],
            Bounds = new() { Minimum = [span.Start, span.Y - .1, 0], Maximum = [span.End, span.Y + .1, .2] },
            Fragments = [new() { Id = "fragment-" + index, Vertices = [[span.Start, span.Y-.1, 0], [span.End, span.Y-.1, 0], [span.End, span.Y+.1, 0], [span.Start, span.Y+.1, 0], [span.Start, span.Y-.1, .2], [span.End, span.Y-.1, .2], [span.End, span.Y+.1, .2], [span.Start, span.Y+.1, .2]],
                TriangleIndices = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5], FragmentToWorldMetres = Identity, TransformAlreadyApplied = true }]
        }).ToArray()
    };
}
