using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Barriers;
using PathFinder.BarrierVerifier;
using PathFinder.Model;

internal static class Fixtures
{
    internal const string Project = "b6200000-0000-4000-8000-000000000001", Model = "b6200000-0000-4000-8000-000000000002";
    private static int next = 100;
    private static readonly double[] Identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    internal sealed record Mesh(BarrierPoint[] Vertices, int[] Indices);
    internal sealed record Stored(JsonObject Context, JsonObject Capture, JsonObject Manifest, string CapturePath, string ManifestPath,
        BarrierVerificationResult? Qualification);
    internal static string Id(int value) => "b6200000-0000-4000-8000-" + value.ToString("D12", CultureInfo.InvariantCulture);
    internal static string FreshId() => Id(Interlocked.Increment(ref next));
    internal static string Hash(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    internal static string Hash(string text) => Hash(Encoding.UTF8.GetBytes(text));
    internal static string Fingerprint => Hash("B6 independent synthetic fitted network");
    internal static BarrierPoint P(double x, double y = 0, double z = 0) => new(x, y, z);
    internal static JsonObject Point(double x, double y = 0, double z = .1) => new() { ["x"] = x, ["y"] = y, ["z"] = z };
    internal static JsonArray Array(IEnumerable<double> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
    private static void Quad(List<int> indices, int a, int b, int c, int d) => indices.AddRange([a, b, c, a, c, d]);
    internal static Mesh Box(double x0 = 0, double x1 = .2, double y0 = -2, double y1 = 2, double z0 = -2, double z1 = 2)
    {
        BarrierPoint[] vertices = [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0),
            P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)];
        var indices = new List<int>();
        Quad(indices, 0, 3, 2, 1); Quad(indices, 4, 5, 6, 7); Quad(indices, 0, 1, 5, 4);
        Quad(indices, 3, 7, 6, 2); Quad(indices, 0, 4, 7, 3); Quad(indices, 1, 2, 6, 5);
        return new(vertices, indices.ToArray());
    }
    // The closed tunnel is the independently authored B1/B3/B4 synthetic mesh,
    // including all original inner faces. Its box alone is never the obstacle.
    internal static Mesh Opening()
    {
        (double Y, double Z)[] outer = [(-2, -2), (2, -2), (2, 2), (-2, 2)];
        (double Y, double Z)[] inner = [(-.6, -.8), (.6, -.8), (.6, .8), (-.6, .8)];
        var vertices = new List<BarrierPoint>();
        foreach (double x in new[] { 0d, .2 }) { vertices.AddRange(outer.Select(p => P(x, p.Y, p.Z))); vertices.AddRange(inner.Select(p => P(x, p.Y, p.Z))); }
        var indices = new List<int>();
        for (var i = 0; i < 4; i++) { int j = (i + 1) % 4; Quad(indices, i, 4 + i, 4 + j, j); Quad(indices, 8 + i, 8 + j, 12 + j, 12 + i); Quad(indices, i, j, 8 + j, 8 + i); Quad(indices, 4 + i, 12 + i, 12 + j, 4 + j); }
        return new(vertices.ToArray(), indices.ToArray());
    }
    internal static Mesh Transform(Mesh mesh, Func<BarrierPoint, BarrierPoint> map) => new(mesh.Vertices.Select(map).ToArray(), mesh.Indices.ToArray());
    internal static JsonObject Scope() => new()
    {
        ["projectId"] = Project, ["modelVersionId"] = Model, ["contentFingerprint"] = Fingerprint, ["selectionRevision"] = "1",
        ["captureFrameId"] = Id(3), ["captureFrameSha256"] = Hash("independent canonical frame"), ["coordinateFrame"] = "canonical-world-metres",
    };
    internal static JsonObject Policy(bool drill = false) => JsonNode.Parse("""
        {"schemaVersion":"wfc.pf.barrier-routing-policy.v1","policyVersion":"wfc.pf.registered-triangle-barriers.v1","drillThroughWalls":false,
        "collisionVersion":"wfc.pf.triangle-centreline-collision.v1","numericToleranceMetres":1e-7,
        "physicalClearance":{"mode":"centreline-only","radiusMetres":0,"diameterSource":"not-qualified"}}
        """)!.AsObject().With("drillThroughWalls", JsonValue.Create(drill));
    // A deliberate frozen expected profile. This independent fixture never reads
    // production DTO constants to make a changed profile accidentally pass.
    internal static JsonObject Profile() => JsonNode.Parse("""
        {"schemaVersion":"wfc.pf.barrier-runtime-profile.v1","routeHashVersion":"wfc.pf.route-binary64-le.v1",
        "qualification":{"producerVersion":"wfc.pf.barrier-verifier.v1","maximumBytes":33554432,"maximumFragments":8192,"maximumParents":128,
        "maximumComputationalMeshes":256,"maximumVertices":500000,"maximumTriangles":250000,"maximumWork":40000000,"maximumMilliseconds":60000,"numericToleranceMetres":1e-7},
        "kernel":{"collisionVersion":"wfc.pf.triangle-centreline-collision.v1","maximumBvhNodes":500000,"maximumQueryWork":2000000,"maximumQueryMilliseconds":10000,
        "maximumEstimatedBytes":134217728,"bvhLeafSize":8,"maximumCoordinateMagnitudeMetres":1000000000},
        "routing":{"policyVersion":"wfc.pf.constrained-tray-routing.v1","candidateRankingVersion":"wfc.pf.accessible-piece-projections.v1","maxCandidatesPerEnd":16,
        "maxPairs":64,"maxCollisionQueries":100000,"maxWork":20000000,"timeoutMilliseconds":30000,"maxInputTrays":4096,"maxInputPieces":50000,"maxGraphNodes":100000,"maxGraphConnections":300000},
        "localConnectors":{"policyVersion":"wfc.pf.local-connector-lattice.v1","approachVersion":"wfc.pf.local-approach-routing.v1","domainVersion":"endpoint-tray-aabb-with-profile-padding.v1",
        "stepMeters":0.25,"paddingMeters":1,"maxAxisSpanMeters":20,"maxNodes":4096,"maxEdgeChecks":16384,"maxPlans":8,"maxStraightPairs":8}}
        """)!.AsObject();
    internal static JsonObject With(this JsonObject value, string key, JsonNode? entry) { value[key] = entry; return value; }
    internal static string Canonical(JsonNode? node)
    {
        if (node is null) return "null";
        if (node is JsonObject obj) return "{" + string.Join(",", obj.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => JsonSerializer.Serialize(p.Key) + ":" + Canonical(p.Value))) + "}";
        if (node is JsonArray array) return "[" + string.Join(",", array.Select(Canonical)) + "]";
        var json = node.ToJsonString();
        // Exact fixtures only use ordinary coordinates and one fixed 1e-7
        // tolerance; normalize its exponent spelling to the JS canonical form.
        if (double.TryParse(json, NumberStyles.Float, CultureInfo.InvariantCulture, out double number))
        {
            if (number == 0) return "0";
            var text = number.ToString("R", CultureInfo.InvariantCulture);
            int exponent = text.IndexOfAny(['E', 'e']);
            if (exponent >= 0) return text[..exponent] + "e" + int.Parse(text[(exponent + 1)..], CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture);
            return text;
        }
        return json;
    }
    internal static byte[] Bytes(JsonNode node) => Encoding.UTF8.GetBytes(Canonical(node));
    internal static JsonObject Blob(string id, byte[] bytes) => new() { ["blobId"] = id, ["sha256"] = Hash(bytes), ["bytes"] = bytes.Length };

    internal static Stored Store(string root, Mesh? mesh, bool drill = false)
    {
        string intent = FreshId(), snapshot = FreshId(), captureId = intent, manifestId = FreshId(), captureBlob = FreshId(), meshBlob = FreshId();
        string directory = Path.Combine(root, "barriers", Project, intent); Directory.CreateDirectory(directory);
        var policy = Policy(drill); var profile = Profile(); var scope = Scope();
        var parent = new JsonObject { ["selectionId"] = Id(20), ["kind"] = "wall", ["objectId"] = "dbid:10", ["dbId"] = 10,
            ["externalId"] = null, ["name"] = "Independent synthetic barrier parent", ["identityBasis"] = "version-local-only", ["inclusion"] = "own-and-all-descendant-fragments" };
        var capture = new JsonObject(); BarrierVerificationResult? qualified = null; byte[]? captureBytes = null;
        JsonObject geometry; JsonNode? captureReference = null;
        if (mesh is not null)
        {
            var source = new JsonObject { ["fragmentId"] = 11, ["ownerObjectId"] = "dbid:10", ["parentSelectionIds"] = new JsonArray(Id(20)),
                ["sourceUnits"] = "m", ["metresPerSourceUnit"] = 1, ["sourceToWorldMetres"] = Array(Identity), ["transformSha256"] = Hash(Canonical(Array(Identity))) };
            var bounds = new JsonObject { ["minimum"] = Array([mesh.Vertices.Min(p => p.X), mesh.Vertices.Min(p => p.Y), mesh.Vertices.Min(p => p.Z)]),
                ["maximum"] = Array([mesh.Vertices.Max(p => p.X), mesh.Vertices.Max(p => p.Y), mesh.Vertices.Max(p => p.Z)]) };
            var vertices = new JsonArray(mesh.Vertices.Select(p => (JsonNode)Array([p.X, p.Y, p.Z])).ToArray());
            var indices = new JsonArray(mesh.Indices.Select(i => (JsonNode?)JsonValue.Create(i)).ToArray());
            var fragment = new JsonObject { ["source"] = source, ["bounds"] = bounds, ["verticesMetres"] = vertices, ["triangleIndices"] = indices };
            capture = new JsonObject { ["schemaVersion"] = "wfc.pf.barrier-capture.v1", ["captureId"] = captureId, ["scope"] = scope.DeepClone(),
                ["selectedParents"] = new JsonArray(parent.DeepClone()), ["fragments"] = new JsonArray(fragment), ["observation"] = new JsonObject {
                    ["state"] = "reported-complete", ["verification"] = "unverified", ["enumeratedFragmentIds"] = new JsonArray(11),
                    ["unavailableFragmentIds"] = new JsonArray(), ["enumerationSha256"] = Hash("synthetic exact one-fragment enumeration") } };
            captureBytes = Bytes(capture); qualified = BarrierCaptureVerifier.Verify(captureBytes);
            if (qualified.Qualified is null || qualified.Receipt.Status != "geometry-qualified" || qualified.Receipt.Evidence is null)
                throw new InvalidOperationException("Independent raw fixture did not qualify: " + string.Join(";", qualified.Receipt.Diagnostics.Select(d => d.Code)));
            File.WriteAllBytes(Path.Combine(directory, captureBlob + ".json"), captureBytes);
            var meshDocument = new JsonObject { ["verticesMetres"] = vertices.DeepClone(), ["triangleIndices"] = indices.DeepClone() };
            var meshBytes = Bytes(meshDocument); File.WriteAllBytes(Path.Combine(directory, meshBlob + ".json"), meshBytes);
            var summary = new JsonObject { ["source"] = source.DeepClone(), ["bounds"] = bounds.DeepClone(), ["mesh"] = Blob(meshBlob, meshBytes),
                ["vertices"] = mesh.Vertices.Length, ["triangles"] = mesh.Indices.Length / 3 };
            geometry = new JsonObject { ["mode"] = "mesh-set", ["fragments"] = new JsonArray(summary), ["verification"] = new JsonObject {
                ["producerVersion"] = "wfc.pf.barrier-verifier.v1", ["selectionClosure"] = "complete-selected-scope",
                ["topology"] = "qualified-closed-consistent-two-manifold", ["selfIntersection"] = "bounded-verification-passed",
                ["computationalMeshes"] = qualified.Receipt.Evidence.ComputationalMeshes, ["verifiedCaptureSha256"] = Hash(captureBytes),
                // B2 authority/closure digest deliberately differs from pure geometry receipt.
                ["verificationSha256"] = Hash("synthetic fixture authority and closure evidence") } };
            captureReference = new JsonObject { ["captureId"] = captureId, ["payloadSha256"] = Hash(captureBytes) };
        }
        else geometry = new JsonObject { ["mode"] = "explicit-empty", ["declarationId"] = FreshId(),
            ["declaration"] = "administrator-declared-no-selected-barriers", ["reason"] = "Independent synthetic empty selected scope" };
        var manifest = new JsonObject { ["schemaVersion"] = "wfc.pf.barrier-snapshot.v1", ["snapshotId"] = snapshot,
            ["scope"] = scope.DeepClone(), ["registryRevision"] = "1", ["selectedParents"] = mesh is null ? new JsonArray() : new JsonArray(parent),
            ["capture"] = captureReference, ["geometry"] = geometry, ["coverage"] = "registered-selected-objects-only", ["engineeringAccepted"] = false };
        manifest["contentSha256"] = Hash(Canonical(manifest)); var manifestBytes = Bytes(manifest);
        string manifestPath = Path.Combine(directory, manifestId + ".json"); File.WriteAllBytes(manifestPath, manifestBytes);
        var binding = new JsonObject { ["scope"] = scope.DeepClone(), ["registryRevision"] = "1", ["snapshot"] = new JsonObject {
                ["snapshotId"] = snapshot, ["scope"] = scope.DeepClone(), ["registryRevision"] = "1", ["contentSha256"] = manifest["contentSha256"]!.DeepClone(), ["mode"] = mesh is null ? "explicit-empty" : "mesh-set" },
            ["policy"] = policy, ["policySha256"] = Hash(Canonical(policy)) };
        var context = new JsonObject { ["schemaVersion"] = "wfc.pf.barrier-runtime.v1", ["binding"] = binding, ["profile"] = profile,
            ["profileSha256"] = Hash(Canonical(profile)), ["storage"] = new JsonObject { ["intentId"] = intent, ["manifest"] = Blob(manifestId, manifestBytes),
                ["capture"] = captureBytes is null ? null : Blob(captureBlob, captureBytes) } };
        return new(context, capture, manifest, Path.Combine(directory, captureBlob + ".json"), manifestPath, qualified);
    }

    internal static JsonObject UnpublishedBypass()
    {
        var policy = Policy(true); var profile = Profile();
        return new JsonObject { ["schemaVersion"] = "wfc.pf.barrier-runtime.v1", ["binding"] = new JsonObject { ["scope"] = Scope(),
            ["registryRevision"] = "0", ["snapshot"] = null, ["policy"] = policy, ["policySha256"] = Hash(Canonical(policy)) },
            ["profile"] = profile, ["profileSha256"] = Hash(Canonical(profile)), ["storage"] = null };
    }

    internal static JsonObject Request(string root, (double Start, double End, double Y, double Z)[]? spans = null)
    {
        spans ??= [(0, 3, 0, .1)]; var snapshot = new ModelSnapshot {
            SchemaVersion = "pathfinder.model.snapshot.v1", Model = new() { ProjectId = Project, ModelVersionId = Model, ContentSha256 = Fingerprint,
                SourceContentSha256 = Hash("independent source NWD digest deliberately differs from model identity") },
            Capture = new() { AdapterVersion = "barrier-runtime.independent.synthetic.v1", SourceKind = "synthetic", InventoryComplete = true,
                GeometryComplete = true, UnitsVerified = true, TransformsVerified = true, PlanningVisibilityKnown = true, SourceLinkVerified = false, EvidenceSha256 = [] },
            Coordinates = new() { VertexFrame = "canonical-world-metres", SourceUnits = "metres", MetresPerSourceUnit = 1, SourceToWorldMetres = Identity,
                GlobalOffsetMetres = [0, 0, 0], DisplayToWorldMetres = Identity },
            Objects = spans.Select((span, index) => new SnapshotObject {
                Id = "segment-" + (index + 1), ParentId = null, Name = "FTUBE", GeometryRole = "routing-leaf", LeafToRootNames = ["FTUBE", "/BC" + (index + 1).ToString("D3")],
                Properties = [], NativeHidden = false, PlanningExcluded = false, RouteName = "/BC" + (index + 1).ToString("D3"), ShapeName = "FTUBE",
                CategoryAssignmentSource = "synthetic", AllowedCategories = ["MV", "LV", "Control"],
                Bounds = new() { Minimum = [span.Start, span.Y - .1, span.Z - .1], Maximum = [span.End, span.Y + .1, span.Z + .1] },
                Fragments = [new() { Id = "fragment-" + index, Vertices = [
                    [span.Start, span.Y-.1, span.Z-.1], [span.End, span.Y-.1, span.Z-.1], [span.End, span.Y+.1, span.Z-.1], [span.Start, span.Y+.1, span.Z-.1],
                    [span.Start, span.Y-.1, span.Z+.1], [span.End, span.Y-.1, span.Z+.1], [span.End, span.Y+.1, span.Z+.1], [span.Start, span.Y+.1, span.Z+.1]],
                    TriangleIndices = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5], FragmentToWorldMetres = Identity, TransformAlreadyApplied = true }]
            }).ToArray(),
        };
        string snapshotId = FreshId(); var bytes = JsonSerializer.SerializeToUtf8Bytes(snapshot, SnapshotReader.JsonOptions);
        Directory.CreateDirectory(Path.Combine(root, "snapshots")); File.WriteAllBytes(Path.Combine(root, "snapshots", snapshotId + ".json"), bytes);
        return new JsonObject { ["schemaVersion"] = "pathfinder.model.runner.v2", ["requestId"] = FreshId(), ["operation"] = "calculate", ["projectId"] = Project,
            ["modelVersionId"] = Model, ["snapshotId"] = snapshotId, ["snapshotSha256"] = Hash(bytes), ["timeoutMilliseconds"] = 30000,
            ["category"] = "Control", ["from"] = Point(-1), ["to"] = Point(3), ["includeLengthLedger"] = true,
            ["options"] = new JsonObject { ["connectionToleranceMeters"] = .5, ["sampleSpacingMeters"] = .125, ["secondaryDistanceMeters"] = 2,
                ["preferVerticalApproach"] = false, ["maxGraphNodes"] = 200000, ["maxGraphConnections"] = 1000000 },
            ["projectSettings"] = new JsonObject { ["revision"] = "1", ["secondaryTrayLength"] = "7", ["endConnectionLength"] = "5", ["additionalBendingPercent"] = "10" } };
    }
}
