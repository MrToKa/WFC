using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Model;

internal static class Program
{
    private static int passed;
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1 || !Path.IsPathFullyQualified(args[0])) throw new ArgumentException("Pass one owned absolute scratch directory.");
            var scratch = args[0]; Directory.CreateDirectory(scratch);
            var baseline = Snapshot();
            Check("native-parser-canonical-order-secondary-and-adjacent-duplicates", LookupScopeResolver.Plan("/bc001/SECONDARY/BC001/BC002/BC001").SequenceEqual(new[] { "/BC001", "/BC002", "/BC001" }));
            Reject("invalid-lookup-text", () => LookupScopeResolver.Plan("/BAD CODE"));
            Reject("secondary-only", () => LookupScopeResolver.Plan("/SECONDARY"));
            Reject("lookup-text-budget", () => LookupScopeResolver.Plan(new string('A', 8001)));
            Reject("lookup-code-count", () => LookupScopeResolver.Plan(string.Concat(Enumerable.Range(0, 101).Select(i => "/A" + i))));
            Reject("lookup-single-code-budget", () => LookupScopeResolver.Plan("/" + new string('A', 256)));
            var resolved = Resolve(baseline, "/BC001");
            Check("qualified-component-resolves-canonical-logical-owner", resolved.Snapshot.Objects.Single(item => item.Id == "leaf").RouteBoundaryId == "owner");
            Check("identity-geometry-and-unit-evidence-preserved", ReferenceEquals(resolved.Snapshot.Coordinates, baseline.Coordinates)
                && ReferenceEquals(resolved.Snapshot.Objects.Single(item => item.Id == "leaf").Fragments, baseline.Objects[0].Fragments)
                && resolved.Snapshot.Objects.Single(item => item.Id == "leaf").DbId == 1);
            Check("scope-counts-and-native-limitation", resolved.Scope.ResolvedOwnerCount == 1 && resolved.Scope.ResolvedLeafCount == 1 && resolved.Scope.Warnings.Any(value => value.Contains("native visibility")));
            var cache = new FittedModelCache(Path.Combine(scratch, "fit"));
            Reject("raw-discovery-cannot-bypass-resolver-fit", () => cache.GetOrBuild(Bytes(baseline)));
            var fitted = cache.GetOrBuild(Bytes(resolved.Snapshot));
            Check("all-categories-and-native-shape-are-retained", fitted.Segments.Count == 1 && fitted.Segments[0].AllowedCategories == CableCategory.All
                && fitted.Objects.Single(item => item.Id == "leaf").ShapeName == "FTUBE /BC001/123");
            var route = RouteLookupCalculator.Calculate(fitted.Segments, new[] { "/BC001" });
            Check("real-core-ordered-lookup-from-resolved-mesh", route.Success && route.LengthMeters > 0 && route.FromDistanceMeters == 0 && !route.FromRequiresSecondary);
            var disk = new FittedModelCache(Path.Combine(scratch, "fit")).GetOrBuild(Bytes(resolved.Snapshot));
            Check("resolved-byte-hash-and-cold-cache-identity", disk.LoadedFromDisk && fitted.Key == disk.Key && fitted.SnapshotSha256 == SnapshotReader.Sha256(Bytes(resolved.Snapshot)));
            var nested = baseline with { Objects = [baseline.Objects[0] with { ParentId = "nested", LeafToRootNames = ["FTUBE /BC001/123", "/BC001", "/BC001", "Plant"] },
                Parent("nested", "owner", "/BC001", 4, "/BC001", "/BC001", "Plant"), baseline.Objects[1], baseline.Objects[2]] };
            Check("nested-same-owner-wrappers-collapse", Resolve(nested, "/BC001").Snapshot.Objects.Single(item => item.Id == "leaf").RouteBoundaryId == "owner");
            var directComponent = baseline with { Objects = [baseline.Objects[0] with { ParentId = "root", LeafToRootNames = ["FTUBE /BC001/123", "Plant"] }, baseline.Objects[2]] };
            Check("qualified-component-can-be-selected-as-its-own-owner", Resolve(directComponent, "/BC001").Snapshot.Objects.Single(item => item.Id == "leaf").RouteBoundaryId == "leaf");
            var extra = baseline.Objects[0] with { Id = "extra", DbId = 5, Name = "/BC002", LeafToRootNames = ["/BC002", "/BC001", "Plant"],
                Fragments = [baseline.Objects[0].Fragments[0] with { Id = "fragment-extra" }] };
            var broad = baseline with { Objects = [..baseline.Objects, extra] };
            var filtered = Resolve(broad, "/BC001");
            Check("unrequested-nearer-logical-route-leaf-is-excluded", !filtered.Snapshot.Objects.Any(item => item.Id == "extra") && filtered.Scope.Warnings.Length == 2);
            var sameOwnerMoreGeometry = baseline.Objects[0] with { Id = "piece", DbId = 6, Name = "BEND /BC001/456", LeafToRootNames = ["BEND /BC001/456", "/BC001", "Plant"], Fragments = [baseline.Objects[0].Fragments[0] with { Id = "fragment-piece" }] };
            Check("all-visible-physical-pieces-of-one-owner-retained", Resolve(baseline with { Objects = [..baseline.Objects, sameOwnerMoreGeometry] }, "/BC001").Scope.ResolvedLeafCount == 2);
            var siblingOwner = Parent("other-owner", "root", "/BC001", 7, "/BC001", "Plant");
            var siblingLeaf = baseline.Objects[0] with { Id = "other-leaf", DbId = 8, ParentId = "other-owner", Fragments = [baseline.Objects[0].Fragments[0] with { Id = "fragment-other" }] };
            Reject("separate-branch-owner-ambiguity", () => Resolve(baseline with { Objects = [..baseline.Objects, siblingOwner, siblingLeaf] }, "/BC001"));
            Reject("absent-owner-or-no-geometry-is-not-guessed", () => Resolve(baseline with { Capture = baseline.Capture with { LookupRouteCodes = ["/BC999"] } }, "/BC999"));
            Reject("capture-scope-cannot-be-relabeled", () => Resolve(baseline, "/BC002"));
            var requestedTwice = Resolve(baseline, "/BC001/SECONDARY/BC001");
            Check("parser-adjacent-dedup-retains-one-query", requestedTwice.Scope.RequestedCodeCount == 1 && requestedTwice.Scope.UniqueCodeCount == 1);
            foreach (var (name, snapshot) in new (string, ModelSnapshot)[]
            {
                ("noncanonical-codes", baseline with { Capture = baseline.Capture with { LookupRouteCodes = ["bc001"] } }),
                ("native-proof", baseline with { Capture = baseline.Capture with { PlanningVisibilityKnown = true } }),
                ("adapter-marker-mismatch", baseline with { Capture = baseline.Capture with { AdapterVersion = "ordinary" } }),
                ("missing-marker", baseline with { Capture = baseline.Capture with { LookupRouteCodes = null } }),
                ("missing-parent", baseline with { Objects = baseline.Objects.Where(item => item.Id != "owner").ToArray() }),
                ("forged-chain", baseline with { Objects = [baseline.Objects[0] with { LeafToRootNames = ["FTUBE /BC001/123", "/BC002", "Plant"] }, ..baseline.Objects.Skip(1)] }),
                ("native-hidden-inferred", baseline with { Objects = [baseline.Objects[0] with { NativeHidden = false }, ..baseline.Objects.Skip(1)] }),
                ("planning-assignment", baseline with { Objects = [baseline.Objects[0] with { CategoryAssignmentSource = "explicit-planning" }, ..baseline.Objects.Skip(1)] }),
                ("category-filter", baseline with { Objects = [baseline.Objects[0] with { AllowedCategories = ["Control"] }, ..baseline.Objects.Skip(1)] }),
                ("invented-label", baseline with { Objects = [baseline.Objects[0] with { RouteName = "/BC001" }, ..baseline.Objects.Skip(1)] }),
                ("no-mesh", baseline with { Objects = [baseline.Objects[0] with { Fragments = [] }, ..baseline.Objects.Skip(1)] }),
                ("nonancestor-boundary", baseline with { Objects = [baseline.Objects[0] with { RouteBoundaryId = "absent" }, ..baseline.Objects.Skip(1)] }),
            }) Reject(name, () => SnapshotReader.Read(Bytes(snapshot)));
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            Reject("cancel-before-plan", () => LookupScopeResolver.Plan("/BC001", cancelled.Token), typeof(OperationCanceledException));
            Reject("cancel-before-resolution", () => LookupScopeResolver.Resolve(baseline, ["/BC001"], cancellation: cancelled.Token), typeof(OperationCanceledException));
            Reject("snapshot-object-budget", () => LookupScopeResolver.Resolve(baseline, ["/BC001"], new ModelLimits { MaximumObjects = 2 }));
            var legacy = baseline with { Capture = baseline.Capture with { AdapterVersion = "ordinary", LookupRouteCodes = null },
                Objects = [baseline.Objects[0] with { CategoryAssignmentSource = "unassigned", AllowedCategories = [] }, ..baseline.Objects.Skip(1)] };
            Check("legacy-serialization-omits-optional-lookup-scope", !System.Text.Encoding.UTF8.GetString(Bytes(SnapshotReader.Read(Bytes(legacy)))).Contains("lookupRouteCodes", StringComparison.Ordinal));
            Console.WriteLine(JsonSerializer.Serialize(new { status = "PASS", passedChecks = passed, scope = "independent-lookup-canonical-owner-contract-synthetic-only", nativeParity = "NOT_ESTABLISHED" }));
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
    private static LookupScopeResolution Resolve(ModelSnapshot snapshot, string text) => LookupScopeResolver.Resolve(snapshot, LookupScopeResolver.Plan(text));
    private static byte[] Bytes(ModelSnapshot snapshot) => JsonSerializer.SerializeToUtf8Bytes(snapshot, SnapshotReader.JsonOptions);
    private static void Check(string name, bool passedCheck) { if (!passedCheck) throw new InvalidOperationException(name); passed++; }
    private static void Reject(string name, Action action, Type? expected = null)
    {
        try { action(); } catch (Exception error) when (expected is null ? error is ArgumentException or JsonException : error.GetType() == expected) { passed++; return; }
        throw new InvalidOperationException("Expected rejection: " + name);
    }
    private static SnapshotObject Parent(string id, string? parent, string name, int dbId, params string[] names) => new()
    {
        Id = id, ParentId = parent, DbId = dbId, Name = name, GeometryRole = "hierarchy", LeafToRootNames = names,
        Properties = [], NativeHidden = null, PlanningExcluded = false, CategoryAssignmentSource = "unassigned", AllowedCategories = [],
        Bounds = new() { Minimum = [0, 0, 0], Maximum = [10, 1, 1] }, Fragments = []
    };
    private static ModelSnapshot Snapshot() => new()
    {
        SchemaVersion = "pathfinder.model.snapshot.v1", Model = new() { ProjectId = "project", ModelVersionId = "model", ContentSha256 = new string('a', 64) },
        Capture = new() { AdapterVersion = "wfc.protected-lookup-capture.v1", SourceKind = "converted", InventoryComplete = false, GeometryComplete = false,
            UnitsVerified = false, TransformsVerified = false, PlanningVisibilityKnown = false, SourceLinkVerified = false, EvidenceSha256 = [], LookupRouteCodes = ["/BC001"] },
        Coordinates = new() { VertexFrame = "canonical-world-metres", SourceUnits = "metres", MetresPerSourceUnit = 1,
            SourceToWorldMetres = AffineTransform.Identity, DisplayToWorldMetres = AffineTransform.Identity, GlobalOffsetMetres = [0, 0, 0] },
        Objects = [new() { Id = "leaf", ParentId = "owner", DbId = 1, Name = "FTUBE /BC001/123", GeometryRole = "routing-leaf", LeafToRootNames = ["FTUBE /BC001/123", "/BC001", "Plant"],
            Properties = [], NativeHidden = null, PlanningExcluded = false, CategoryAssignmentSource = "lookup-all-categories", AllowedCategories = ["MV", "LV", "Control"],
            Bounds = new() { Minimum = [0, 0, 0], Maximum = [10, 1, 1] }, Fragments = [new() { Id = "fragment", TransformAlreadyApplied = true, FragmentToWorldMetres = AffineTransform.Identity,
                Vertices = [[0,0,0],[10,0,0],[0,1,0],[10,1,0],[0,0,1],[10,0,1],[0,1,1],[10,1,1]], TriangleIndices = [0,1,2,1,3,2,4,6,5,5,6,7,0,4,1,1,4,5,2,3,6,3,7,6,0,2,4,2,6,4,1,5,3,3,5,7] }] },
            Parent("owner", "root", "/BC001", 2, "/BC001", "Plant"), Parent("root", null, "Plant", 3, "Plant")]
    };
}
