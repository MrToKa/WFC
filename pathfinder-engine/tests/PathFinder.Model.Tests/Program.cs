using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using AddinRibbon.Routing;
using PathFinder.Model;

internal static class Program
{
    private static readonly List<object> Checks = [];
    private static readonly List<string> Failures = [];
    private static int Main(string[] args)
    {
        try
        {
            var root = args.Length > 0 ? Path.GetFullPath(args[0]) : FindRoot();
            var scratch = Path.Combine(root, "pathfinder-engine/.scratch/model-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(scratch);
            var watch = Stopwatch.StartNew();
            Transforms();
            var fixture = Fixture();
            var bytes = Bytes(fixture);
            var reader = SnapshotReader.Read(bytes);
            Check("strict-canonical-snapshot", reader.Objects.Length == 1 && reader.Coordinates.VertexFrame == "canonical-world-metres", "Synthetic fixture admitted through strict transport.");
            var cacheDirectory = Path.Combine(scratch, "main");
            var cache = new FittedModelCache(cacheDirectory);
            var cold = cache.GetOrBuild(bytes);
            Check("cold-fitted-cache-build", cold.Segments.Count == 1 && !cold.LoadedFromDisk, cold.CacheScope);
            Check("synthetic-proof-not-engineering-authorization", !cold.ReadyForEngineeringWrites, cold.Readiness);
            var warm = cache.GetOrBuild(bytes);
            Check("warm-reuses-fitted-instance", ReferenceEquals(cold, warm), "Same fitted geometry objects retained; graph is not cached.");
            var restarted = new FittedModelCache(cacheDirectory).GetOrBuild(bytes);
            Check("disk-restores-centerline-and-port-cache", restarted.LoadedFromDisk && Equivalent(cold, restarted), restarted.CacheScope);
            Check("canonical-not-transformed-twice", cold.Segments[0].Points.Min(p => p.X) == 0 && cold.Segments[0].Points.Max(p => p.X) == 10, "Recorded source matrix includes a large translation; already canonical vertices remain unchanged.");
            Check("equipment-bottom-world-aabb", cold.Objects[0].BottomCentreMetres.X == 5 && cold.Objects[0].BottomCentreMetres.Y == 0 && cold.Objects[0].BottomCentreMetres.Z == 0,
                "Centre of bottom visible canonical AABB, Z-up.");
            Check("graph-built-per-calculation", cold.CacheScope.EndsWith("graph-per-calculation", StringComparison.Ordinal), "No prepared reusable graph claim.");
            var beforeRoute = new RouteCalculator().Calculate(cold.Segments, new RoutePoint(0, 0, 0), new RoutePoint(10, 0, 0), CableCategory.Control);
            var restoredRoute = new RouteCalculator().Calculate(restarted.Segments, new RoutePoint(0, 0, 0), new RoutePoint(10, 0, 0), CableCategory.Control);
            Check("restored-route-geometric-parity", beforeRoute.Success && restoredRoute.Success && beforeRoute.LengthMeters == restoredRoute.LengthMeters && beforeRoute.RouteText == restoredRoute.RouteText,
                "Full route generated from cold/restored fitted segments.");
            Invalidation(fixture, cache, cold);
            Visibility(fixture, scratch);
            InvalidInputs(fixture);
            HierarchyDepth(fixture);
            RouteBoundaryTests.Run(fixture, scratch, Check, (name, action) => Reject(name, action));
            QueuedCancellation(fixture, scratch);
            CacheFailures(fixture, scratch);
            FrozenGeometry(root, scratch);
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            Reject("cancel-before-read", () => SnapshotReader.Read(bytes, cancellation: cancelled.Token), typeof(OperationCanceledException));
            Reject("cancel-before-cache", () => cache.GetOrBuild(bytes, cancellation: cancelled.Token), typeof(OperationCanceledException));
            var evidence = Path.Combine(root, "docs/pathfinder/evidence/pf2"); Directory.CreateDirectory(evidence);
            var result = new
            {
                stage = "PF-2", scope = "synthetic-model-contract-transform-fitted-cache", status = Failures.Count == 0 ? "PASS" : "FAIL",
                observedAtUtc = DateTimeOffset.UtcNow, passedChecks = Checks.Count - Failures.Count, failedChecks = Failures.Count,
                elapsedMilliseconds = watch.ElapsedMilliseconds, peakWorkingSetBytes = Process.GetCurrentProcess().PeakWorkingSet64,
                scratchDirectory = scratch, sourceSnapshotSha256 = SnapshotReader.Sha256(bytes),
                realNativeConvertedParity = "NOT_ESTABLISHED_BY_SYNTHETIC_TESTS", reusableRoutingGraph = false,
                limits = new ModelLimits(), checks = Checks, failures = Failures
            };
            var resultJson = JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n";
            File.WriteAllText(Path.Combine(evidence, "model-tests-" + DateTimeOffset.UtcNow.ToString("yyyyMMddTHHmmssfffZ") + ".json"), resultJson);
            File.WriteAllText(Path.Combine(evidence, "model-tests-latest.json"), resultJson);
            Console.WriteLine($"PF-2 model: {Checks.Count - Failures.Count}/{Checks.Count} checks passed.");
            foreach (var failure in Failures) Console.Error.WriteLine(failure);
            return Failures.Count == 0 ? 0 : 1;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 2; }
    }
    private static void Transforms()
    {
        double[] matrix = [0, 0.001, 0, 0, 0, 0, 0.001, 0, 0.001, 0, 0, 0, 1000000, -2000000, 3000000, 1];
        var original = new RoutePoint(1000, 2000, 3000);
        var canonical = AffineTransform.Apply(matrix, original);
        Check("unit-axis-root-composition", canonical.X == 1000003 && canonical.Y == -1999999 && canonical.Z == 3000002, "Nontrivial axis permutation, millimetres to metres, root placement.");
        var roundtrip = AffineTransform.Apply(AffineTransform.Inverse(matrix), canonical);
        Check("inverse-binary64-large-root", roundtrip.DistanceTo(original) < 1e-6, $"roundTripErrorSourceUnits={roundtrip.DistanceTo(original):R}");
        var offset = new RoutePoint(999999, -2000001, 2999999);
        var display = AffineTransform.WorldToDisplay(canonical, offset);
        Check("global-offset-once", display.X == 4 && display.Y == 2 && display.Z == 3 && AffineTransform.DisplayToWorld(display, offset).DistanceTo(canonical) == 0,
            "pDisplay = pWorld - offset; inverse adds once.");
        var inverseProduct = AffineTransform.Multiply(AffineTransform.Inverse(matrix), matrix);
        var productPoint = AffineTransform.Apply(inverseProduct, original);
        Check("affine-composition-roundtrip", productPoint.DistanceTo(original) < 1e-6, "Column-major matrix composition tested in binary64.");
        Check("double-application-detectable", AffineTransform.Apply(matrix, canonical).DistanceTo(canonical) > 1, "Second source/root application changes canonical coordinates and is prohibited by boundary.");
        Reject("singular-matrix", () => AffineTransform.Validate(new double[16]));
        var perspective = AffineTransform.Identity; perspective[3] = 1;
        Reject("perspective-matrix", () => AffineTransform.Validate(perspective));
        var nan = AffineTransform.Identity; nan[0] = double.NaN;
        Reject("nonfinite-matrix", () => AffineTransform.Validate(nan));
    }
    private static void Invalidation(JsonObject fixture, FittedModelCache cache, PreparedModel baseline)
    {
        foreach (var (name, edit) in new (string, Action<JsonObject>)[]
        {
            ("model-version", j => j["model"]!["modelVersionId"] = "model-2"),
            ("content", j => j["model"]!["contentSha256"] = new string('b', 64)),
            ("source-adapter", j => j["capture"]!["adapterVersion"] = "synthetic-adapter-v2"),
            ("visibility", j => j["objects"]![0]!["nativeHidden"] = true),
            ("category", j => j["objects"]![0]!["allowedCategories"] = new JsonArray("MV")),
            ("display-offset", j => j["coordinates"]!["globalOffsetMetres"]![0] = 1234)
        })
        {
            var changed = (JsonObject)fixture.DeepClone(); edit(changed);
            Check("cache-invalidates:" + name, cache.GetOrBuild(Bytes(changed)).Key != baseline.Key, "Changed snapshot evidence participates in cache key.");
        }
        var excluded = cache.GetOrBuild(Bytes(fixture), new ModelBuildRules { ExcludedObjectIds = ["tray-1"] });
        Check("cache-invalidates:explicit-exclusion", excluded.Key != baseline.Key && excluded.Segments.Count == 0, "Exclusion identities/version are hash-bound.");
        Reject("unknown-exclusion", () => cache.GetOrBuild(Bytes(fixture), new ModelBuildRules { ExcludedObjectIds = ["unknown"] }));
        Reject("unknown-rule-version", () => cache.GetOrBuild(Bytes(fixture), new ModelBuildRules { Version = "future-unreviewed-v2" }));
        var inventory = (JsonObject)fixture.DeepClone(); var equipment = inventory["objects"]![0]!.DeepClone();
        equipment["id"] = "equipment-2"; equipment["dbId"] = 2; equipment["geometryRole"] = "object"; equipment["fragments"] = new JsonArray();
        inventory["objects"]!.AsArray().Add(equipment);
        var multiExcluded = cache.GetOrBuild(Bytes(inventory), new ModelBuildRules { ExcludedObjectIds = ["tray-1", "equipment-2"] });
        Check("multiple-exclusions-validated-against-object-index", multiExcluded.Objects.All(item => item.Visibility == "excluded") && multiExcluded.Segments.Count == 0,
            "All valid identities are resolved through one ordinal object index, including non-tray objects.");
        Reject("unknown-exclusion-after-valid-identities", () => cache.GetOrBuild(Bytes(inventory), new ModelBuildRules { ExcludedObjectIds = ["tray-1", "equipment-2", "zz-unknown"] }));
    }
    private static void Visibility(JsonObject fixture, string scratch)
    {
        var hidden = (JsonObject)fixture.DeepClone();
        var rootObject = hidden["objects"]![0]!.DeepClone();
        rootObject["id"] = "root"; rootObject["routeName"] = null; rootObject["name"] = "Root";
        rootObject["geometryRole"] = "hierarchy";
        rootObject["leafToRootNames"] = new JsonArray("Root"); rootObject["nativeHidden"] = true; rootObject["fragments"] = new JsonArray(); rootObject["dbId"] = 2;
        hidden["objects"]![0]!["parentId"] = "root";
        hidden["objects"]!.AsArray().Add(rootObject);
        var excluded = new FittedModelCache(Path.Combine(scratch, "hidden")).GetOrBuild(Bytes(hidden));
        Check("effective-native-hidden-ancestor", excluded.Segments.Count == 0 && excluded.Objects.First(x => x.Id == "tray-1").Visibility == "hidden", "Native hidden ancestor excludes visible child.");
        var unknown = (JsonObject)fixture.DeepClone(); unknown["objects"]![0]!["nativeHidden"] = null;
        unknown["capture"]!["planningVisibilityKnown"] = false;
        var provisional = new FittedModelCache(Path.Combine(scratch, "unknown")).GetOrBuild(Bytes(unknown));
        Check("unknown-native-visibility-not-display-hidden", provisional.Segments.Count == 1 && provisional.Readiness == "needs_review" && provisional.Objects[0].Visibility == "unknown", "Unknown native planning state is reported, provisionally fitted and never promoted by Ghost visibility.");
        var partial = (JsonObject)fixture.DeepClone(); partial["capture"]!["inventoryComplete"] = false; partial["capture"]!["geometryComplete"] = false; partial["objects"]![0]!["parentId"] = "uncaptured-root";
        var selected = new FittedModelCache(Path.Combine(scratch, "partial")).GetOrBuild(Bytes(partial));
        Check("partial-selection-explicit-readiness", selected.Readiness == "needs_review" && selected.Diagnostics.Any(d => d.Contains("partial", StringComparison.Ordinal)), "Partial captures never claim whole-model readiness.");
        var ambiguous = (JsonObject)fixture.DeepClone(); var duplicate = ambiguous["objects"]![0]!.DeepClone(); duplicate["id"] = "tray-2"; duplicate["dbId"] = 2; duplicate["fragments"] = new JsonArray();
        ambiguous["objects"]![0]!["externalId"] = "same-guid"; duplicate["externalId"] = "same-guid"; ambiguous["objects"]!.AsArray().Add(duplicate);
        var ambiguity = new FittedModelCache(Path.Combine(scratch, "ambiguous")).GetOrBuild(Bytes(ambiguous));
        Check("external-id-ambiguity-preserved", ambiguity.Objects.Count == 2 && ambiguity.Diagnostics.Any(d => d.StartsWith("Ambiguous external identity", StringComparison.Ordinal)), "External IDs never collapse distinct version-local instances.");
        var unassigned = (JsonObject)fixture.DeepClone(); unassigned["objects"]![0]!["categoryAssignmentSource"] = "unassigned"; unassigned["objects"]![0]!["allowedCategories"] = new JsonArray();
        var noCategory = new FittedModelCache(Path.Combine(scratch, "category-required")).GetOrBuild(Bytes(unassigned));
        Check("category-is-explicit-planning-input", noCategory.Segments[0].AllowedCategories == CableCategory.None && noCategory.Diagnostics.Any(d => d.Contains("category_required", StringComparison.Ordinal)), "Missing assignment remains unresolved, without inference from tray properties.");
        var ownerInventory = (JsonObject)fixture.DeepClone();
        var owner = ownerInventory["objects"]![0]!.DeepClone(); owner["id"] = "tray-owner"; owner["dbId"] = 2;
        owner["geometryRole"] = "hierarchy"; owner["name"] = "Owner /BC001"; owner["routeName"] = "/BC001";
        owner["leafToRootNames"] = new JsonArray("Owner /BC001", "Root"); owner["fragments"] = new JsonArray();
        ownerInventory["objects"]![0]!["parentId"] = "tray-owner"; ownerInventory["objects"]!.AsArray().Add(owner);
        var ownerModel = new FittedModelCache(Path.Combine(scratch, "owner-role")).GetOrBuild(Bytes(ownerInventory));
        Check("hierarchy-owner-never-inherits-fallback-tray", ownerModel.Objects.Count == 2 && ownerModel.Segments.Count == 1
            && ownerModel.Segments[0].Id == "tray-1" && ownerModel.Objects.Single(item => item.Id == "tray-owner").GeometryRole == "hierarchy",
            "A named logical tray owner and its physical leaf must not both become routing geometry.");
        var equipmentInventory = (JsonObject)fixture.DeepClone(); equipmentInventory["objects"]![0]!["geometryRole"] = "object";
        var equipment = new FittedModelCache(Path.Combine(scratch, "equipment-role")).GetOrBuild(Bytes(equipmentInventory));
        Check("generic-object-keeps-equipment-anchor-not-tray", equipment.Segments.Count == 0 && equipment.Objects[0].GeometryRole == "object"
            && equipment.Objects[0].BottomCentreMetres.X == 5, "A physical equipment object with inherited tray labels remains an object/anchor candidate.");
        var missingMeshLeaf = (JsonObject)fixture.DeepClone(); missingMeshLeaf["objects"]![0]!["fragments"] = new JsonArray();
        var fallbackLeaf = new FittedModelCache(Path.Combine(scratch, "leaf-fallback")).GetOrBuild(Bytes(missingMeshLeaf));
        Check("explicit-routing-leaf-preserves-diagnosed-empty-mesh-fallback", fallbackLeaf.Segments.Count == 1 && fallbackLeaf.Readiness == "needs_review"
            && fallbackLeaf.Diagnostics.Any(d => d.Contains("no retained fragment mesh", StringComparison.Ordinal)), "Only an explicitly selected leaf can retain the existing intentional mesh fallback.");
    }
    private static void InvalidInputs(JsonObject fixture)
    {
        foreach (var (name, edit) in new (string, Action<JsonObject>)[]
        {
            ("unknown-schema", j => j["schemaVersion"] = "unrecognized"), ("unknown-field", j => j["ignored"] = true),
            ("missing-geometry-role", j => j["objects"]![0]!.AsObject().Remove("geometryRole")),
            ("unknown-geometry-role", j => j["objects"]![0]!["geometryRole"] = "auto-inferred"),
            ("hierarchy-with-physical-mesh", j => j["objects"]![0]!["geometryRole"] = "hierarchy"),
            ("routing-leaf-with-child", j =>
            {
                var child = j["objects"]![0]!.DeepClone(); child["id"] = "child"; child["dbId"] = 2; child["parentId"] = "tray-1";
                child["fragments"] = new JsonArray(); j["objects"]!.AsArray().Add(child);
            }),
            ("source-space-not-canonical", j => j["coordinates"]!["vertexFrame"] = "fragment-local"),
            ("unapplied-transform", j => j["objects"]![0]!["fragments"]![0]!["transformAlreadyApplied"] = false),
            ("missing-source-matrix-with-verified-transform", j => j["coordinates"]!["sourceToWorldMetres"] = null),
            ("unknown-units-claimed-verified", j => j["coordinates"]!["sourceUnits"] = "unknown"),
            ("missing-source-sha-claimed-linked", j => j["model"]!["sourceContentSha256"] = null),
            ("bad-hash", j => j["model"]!["contentSha256"] = "not-a-sha"),
            ("duplicate-object", j => j["objects"]!.AsArray().Add(j["objects"]![0]!.DeepClone())),
            ("null-object", j => j["objects"]![0] = null),
            ("parent-cycle", j => j["objects"]![0]!["parentId"] = "tray-1"),
            ("missing-parent-complete", j => j["objects"]![0]!["parentId"] = "uncaptured-root"),
            ("inverted-bounds", j => j["objects"]![0]!["bounds"]!["minimum"]![0] = 11),
            ("vertex-outside-bounds", j => j["objects"]![0]!["fragments"]![0]!["vertices"]![0]![0] = -10),
            ("triangle-index-range", j => j["objects"]![0]!["fragments"]![0]!["triangleIndices"]![0] = 99),
            ("triangle-triplet-count", j => j["objects"]![0]!["fragments"]![0]!["triangleIndices"]!.AsArray().Add(0)),
            ("unknown-category", j => j["objects"]![0]!["allowedCategories"]![0] = "LVSG"),
            ("mapped-category-duplicate", j => j["objects"]![0]!["allowedCategories"] = new JsonArray("Control", "Instrumentation")),
            ("inferred-category-unassigned", j => j["objects"]![0]!["categoryAssignmentSource"] = "unassigned")
        })
        {
            var changed = (JsonObject)fixture.DeepClone(); edit(changed); Reject("snapshot-rejects:" + name, () => SnapshotReader.Read(Bytes(changed)));
        }
        Reject("duplicate-json-member", () => SnapshotReader.Read(Encoding.UTF8.GetBytes(fixture.ToJsonString().Replace("\"schemaVersion\":", "\"schemaVersion\":\"duplicate\",\"schemaVersion\":"))));
        Reject("numeric-overflow", () => SnapshotReader.Read(Encoding.UTF8.GetBytes(fixture.ToJsonString().Replace("\"metresPerSourceUnit\":1", "\"metresPerSourceUnit\":1e999"))));
        Reject("object-limit", () => SnapshotReader.Read(Bytes(fixture), new ModelLimits { MaximumObjects = 0 }));
        Reject("vertex-limit", () => SnapshotReader.Read(Bytes(fixture), new ModelLimits { MaximumVertices = 2 }));
        Reject("triangle-limit", () => SnapshotReader.Read(Bytes(fixture), new ModelLimits { MaximumTriangles = 0 }));
        Reject("byte-limit", () => SnapshotReader.Read(Bytes(fixture), new ModelLimits { MaximumBytes = 10 }));
    }
    private static void HierarchyDepth(JsonObject fixture)
    {
        foreach (var reverse in new[] { false, true })
        {
            var chain = (JsonObject)fixture.DeepClone();
            var objects = Enumerable.Range(0, 4).Select(index =>
            {
                var item = fixture["objects"]![0]!.DeepClone(); item["id"] = "depth-" + index;
                item["parentId"] = index == 0 ? null : "depth-" + (index - 1); item["dbId"] = index;
                item["geometryRole"] = "hierarchy"; item["fragments"] = new JsonArray(); item["leafToRootNames"] = new JsonArray("short-evidence");
                return item;
            }).ToArray();
            chain["objects"] = new JsonArray((reverse ? objects.Reverse() : objects).ToArray());
            Reject("hierarchy-total-depth-" + (reverse ? "deep-first" : "root-first"), () => SnapshotReader.Read(Bytes(chain), new ModelLimits { MaximumDepth = 3 }));
            var accepted = SnapshotReader.Read(Bytes(chain), new ModelLimits { MaximumDepth = 4 });
            Check("hierarchy-exact-depth-" + (reverse ? "deep-first" : "root-first"), accepted.Objects.Length == 4, "Actual linked depth limit is independent of inventory ordering and short name evidence.");
        }
    }
    private static void QueuedCancellation(JsonObject fixture, string scratch)
    {
        var cache = new FittedModelCache(Path.Combine(scratch, "queued-cancel"));
        var field = typeof(FittedModelCache).GetField("gate", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!;
        var preparationGate = field.GetValue(cache)!;
        using var cancellation = new CancellationTokenSource();
        Task<bool>? waiting = null;
        Monitor.Enter(preparationGate);
        try
        {
            waiting = Task.Run(() =>
            {
                try { cache.GetOrBuild(Bytes(fixture), cancellation: cancellation.Token); return false; }
                catch (OperationCanceledException) { return true; }
            });
            cancellation.CancelAfter(50);
            Check("cancel-while-waiting-for-other-model-fit", waiting.Wait(2000) && waiting.Result,
                "An explicitly held preparation gate cannot postpone cancellation until the other fit completes.");
        }
        finally { Monitor.Exit(preparationGate); }
        waiting.GetAwaiter().GetResult();
    }
    private static void CacheFailures(JsonObject fixture, string scratch)
    {
        var bytes = Bytes(fixture); var corruptionRoot = Path.Combine(scratch, "corrupt");
        var built = new FittedModelCache(corruptionRoot).GetOrBuild(bytes);
        var payload = Path.Combine(corruptionRoot, built.Key + ".fit.json"); File.AppendAllText(payload, "corrupt");
        Reject("disk-cache-corruption-detected", () => new FittedModelCache(corruptionRoot).GetOrBuild(bytes), typeof(InvalidDataException));
        Check("corrupt-cache-preserved-for-inspection", File.ReadAllText(payload).EndsWith("corrupt", StringComparison.Ordinal), "Corrupt entry was not silently overwritten.");
        var incompleteRoot = Path.Combine(scratch, "incomplete"); var incomplete = new FittedModelCache(incompleteRoot).GetOrBuild(bytes);
        File.Delete(Path.Combine(incompleteRoot, incomplete.Key + ".manifest.json"));
        Reject("disk-cache-incomplete-publication-detected", () => new FittedModelCache(incompleteRoot).GetOrBuild(bytes), typeof(InvalidDataException));
        var staleRoot = Path.Combine(scratch, "stale-manifest"); var stale = new FittedModelCache(staleRoot).GetOrBuild(bytes);
        var manifestPath = Path.Combine(staleRoot, stale.Key + ".manifest.json");
        File.WriteAllText(manifestPath, File.ReadAllText(manifestPath).Replace(FittedModelCache.EngineVersion, "wrong-engine-version"));
        Reject("disk-cache-engine-version-mismatch", () => new FittedModelCache(staleRoot).GetOrBuild(bytes), typeof(InvalidDataException));
    }
    private static void FrozenGeometry(string root, string scratch)
    {
        using var inputs = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(root, "docs/pathfinder/fixtures/pf-core-v1.inputs.json")));
        foreach (var item in inputs.RootElement.GetProperty("cases").EnumerateArray().Where(x => x.GetProperty("kind").GetString() is "geometry" or "geometry-route"))
        {
            var id = item.GetProperty("id").GetString()!;
            var snapshot = Fixture(); var objects = new JsonArray(); var index = 0;
            foreach (var geometry in item.GetProperty("input").GetProperty("geometry").EnumerateArray())
            {
                var value = snapshot["objects"]![0]!.DeepClone(); value["id"] = geometry.GetProperty("id").GetString(); value["dbId"] = ++index;
                value["name"] = geometry.GetProperty("shapeName").GetString(); value["shapeName"] = geometry.GetProperty("shapeName").GetString();
                value["routeName"] = geometry.GetProperty("routeName").GetString();
                value["allowedCategories"] = CategoryArray(geometry.GetProperty("categories").GetInt32());
                value["bounds"] = new JsonObject { ["minimum"] = JsonNode.Parse(geometry.GetProperty("minimum").GetRawText()), ["maximum"] = JsonNode.Parse(geometry.GetProperty("maximum").GetRawText()) };
                value["faceExtents"] = new JsonArray(geometry.GetProperty("faceExtents").EnumerateArray().Select(f => (JsonNode)new JsonObject
                {
                    ["face"] = ((TrayBoxFace)f.GetProperty("face").GetInt32()).ToString(), ["sampleCount"] = f.GetProperty("sampleCount").GetInt32(),
                    ["bounds"] = new JsonObject { ["minimum"] = JsonNode.Parse(f.GetProperty("minimum").GetRawText()), ["maximum"] = JsonNode.Parse(f.GetProperty("maximum").GetRawText()) }
                }).ToArray());
                var fragments = new JsonArray(); var fragmentIndex = 0;
                if (geometry.GetProperty("meshFragments").ValueKind != JsonValueKind.Null)
                    foreach (var fragment in geometry.GetProperty("meshFragments").EnumerateArray()) fragments.Add(new JsonObject
                    {
                        ["id"] = id + "-" + index + "-" + fragmentIndex++, ["vertices"] = JsonNode.Parse(fragment.GetProperty("vertices").GetRawText()),
                        ["triangleIndices"] = JsonNode.Parse(fragment.GetProperty("triangleIndices").GetRawText()), ["transformAlreadyApplied"] = true,
                        ["fragmentToWorldMetres"] = JsonSerializer.SerializeToNode(AffineTransform.Identity)
                    });
                value["fragments"] = fragments; objects.Add(value);
            }
            snapshot["objects"] = objects; var bytes = Bytes(snapshot);
            var cacheRoot = Path.Combine(scratch, id); var cold = new FittedModelCache(cacheRoot).GetOrBuild(bytes);
            var restored = new FittedModelCache(cacheRoot).GetOrBuild(bytes);
            Check("frozen-mesh-fitted-cache-parity:" + id, Equivalent(cold, restored), "Cold fitting equals restored centerlines, ports, surfaces and diagnostics.");
            if (item.GetProperty("kind").GetString() == "geometry-route")
            {
                var input = item.GetProperty("input"); var options = JsonSerializer.Deserialize<RoutingOptions>(input.GetProperty("options").GetRawText(), SnapshotReader.JsonOptions)!;
                // Core options have defaults; copy every explicit frozen value instead of relying on deserialization of private members.
                options.ConnectionToleranceMeters = input.GetProperty("options").GetProperty("connectionToleranceMeters").GetDouble();
                var from = AffineTransform.Point(input.GetProperty("from").EnumerateArray().Select(x => x.GetDouble()).ToArray());
                var to = AffineTransform.Point(input.GetProperty("to").EnumerateArray().Select(x => x.GetDouble()).ToArray());
                var category = (CableCategory)input.GetProperty("category").GetInt32();
                var first = new RouteCalculator().Calculate(cold.Segments, from, to, category, options);
                var last = new RouteCalculator().Calculate(restored.Segments, from, to, category, options);
                Check("frozen-route-restored-cache-parity:" + id, first.Success && last.Success && first.LengthMeters == last.LengthMeters && first.RouteText == last.RouteText && first.PathPoints.SequenceEqual(last.PathPoints),
                    "Exact path points and binary64 totals remain unchanged after disk reconstruction.");
            }
        }
    }
    private static bool Equivalent(PreparedModel first, PreparedModel second) => first.Counts == second.Counts && first.Diagnostics.SequenceEqual(second.Diagnostics)
        && JsonSerializer.Serialize(first.Segments.Select(s => new { s.Id, s.Name, s.RouteCode, s.Points, s.AllowedCategories, s.VerifiedPorts, s.ConnectionsAtEndsOnly, surfaces = s.ConnectionSurfaces.Count }))
        == JsonSerializer.Serialize(second.Segments.Select(s => new { s.Id, s.Name, s.RouteCode, s.Points, s.AllowedCategories, s.VerifiedPorts, s.ConnectionsAtEndsOnly, surfaces = s.ConnectionSurfaces.Count }));
    private static JsonArray CategoryArray(int value)
    {
        var result = new JsonArray(); foreach (var (flag, name) in new[] { (1, "MV"), (2, "LV"), (4, "Control") }) if ((value & flag) != 0) result.Add(name); return result;
    }
    private static byte[] Bytes(JsonObject value) => Encoding.UTF8.GetBytes(value.ToJsonString());
    private static void Check(string name, bool condition, string detail)
    {
        Checks.Add(new { name, status = condition ? "PASS" : "FAIL", detail }); if (!condition) Failures.Add(name + ": " + detail);
    }
    private static void Reject(string name, Action action, Type? exactType = null)
    {
        try { action(); Check(name, false, "Expected a controlled rejection."); }
        catch (Exception error) when (error is ArgumentException or JsonException or InvalidDataException or OperationCanceledException)
        { Check(name, exactType is null || error.GetType() == exactType, error.GetType().Name + ": " + error.Message); }
    }
    private static JsonObject Fixture() => JsonNode.Parse("""
        {"schemaVersion":"pathfinder.model.snapshot.v1",
         "model":{"projectId":"project-1","modelVersionId":"model-1","contentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sourceContentSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
         "capture":{"adapterVersion":"synthetic-adapter-v1","sourceKind":"synthetic","inventoryComplete":true,"geometryComplete":true,"unitsVerified":true,"transformsVerified":true,"planningVisibilityKnown":true,"sourceLinkVerified":true,"evidenceSha256":[]},
         "coordinates":{"vertexFrame":"canonical-world-metres","sourceUnits":"metres","metresPerSourceUnit":1,"sourceToWorldMetres":[1,0,0,0,0,1,0,0,0,0,1,0,1000000,2000000,3000000,1],"globalOffsetMetres":[1000000,2000000,3000000],"displayToWorldMetres":[1,0,0,0,0,1,0,0,0,0,1,0,1000000,2000000,3000000,1]},
         "objects":[{"id":"tray-1","parentId":null,"externalId":null,"dbId":1,"name":"STRAIGHT","geometryRole":"routing-leaf","leafToRootNames":["STRAIGHT","/BC001","Root"],"properties":[],"nativeHidden":false,"planningExcluded":false,"routeName":"/BC001","shapeName":"STRAIGHT","categoryAssignmentSource":"synthetic","allowedCategories":["Control"],"bounds":{"minimum":[0,-0.5,0],"maximum":[10,0.5,1]},"fragments":[{"id":"fragment-1","vertices":[[0,-0.5,0],[10,-0.5,0],[0,0.5,0]],"triangleIndices":[0,1,2],"fragmentToWorldMetres":[1,0,0,0,0,1,0,0,0,0,1,0,1000000,2000000,3000000,1],"transformAlreadyApplied":true}]}]}
        """)!.AsObject();
    private static string FindRoot()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory); current is not null; current = current.Parent)
            if (File.Exists(Path.Combine(current.FullName, "docs/pathfinder/fixtures/pf-core-v1.inputs.json"))) return current.FullName;
        throw new DirectoryNotFoundException("Pass the isolated WFC worktree as argument.");
    }
}
