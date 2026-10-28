using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Barriers;
using PathFinder.BarrierVerifier;

// Test-only generation and a separately invoked raw-triangle output oracle.
// No production algorithm, protocol budget or frozen expectation is modified.
internal static partial class Program
{
    private const string WorkloadVersion = "wfc.pf.barrier-session-workload.v1";
    private const int MaximumWorkloadRequests = 128, MaximumWorkloadFiles = 256;
    private const long MaximumWorkloadFileBytes = 32L * 1024 * 1024;

    private static int GenerateWorkload(string work)
    {
        if (!Path.IsPathFullyQualified(work) || Directory.Exists(work) || File.Exists(work)) return 2;
        try
        {
            Directory.CreateDirectory(work);
            var pieces = new List<Fixtures.Mesh> { Fixtures.Opening() };
            for (int at = 0; at < 64; at++)
            {
                double x = 10 + 2 * (at % 8), y = 10 + 2 * (at / 8);
                pieces.Add(Fixtures.Box(x, x + .5, y, y + .5, 10, 10.5));
            }
            var vertices = new List<BarrierPoint>(); var indices = new List<int>();
            foreach (var piece in pieces)
            {
                int offset = vertices.Count; vertices.AddRange(piece.Vertices);
                indices.AddRange(piece.Indices.Select(index => checked(index + offset)));
            }
            Equal(528, vertices.Count); Equal(800, indices.Count / 3);
            var physical = Fixtures.Store(work, new(vertices.ToArray(), indices.ToArray()));
            var physicalEvidence = physical.Qualification!.Receipt.Evidence!;
            Equal(65, physicalEvidence.ComputationalMeshes);
            var wall = Fixtures.Store(work, Fixtures.Box());
            var empty = Fixtures.Store(work, null);
            Equal(BarrierSegmentStatus.Clear, physical.Qualification!.Qualified!.Kernel.CheckSegment(Fixtures.P(-1, 0, .1), Fixtures.P(3, 0, .1)).Status);
            Equal(BarrierSegmentStatus.Blocked, wall.Qualification!.Qualified!.Kernel.CheckSegment(Fixtures.P(-1, 0, .1), Fixtures.P(3, 0, .1)).Status);
            var main = Fixtures.Request(work, Enumerable.Range(0, 64).Select(at => ((double)at, at + 1d, 0d, .1)).ToArray());
            var small = Fixtures.Request(work);
            var requests = new JsonArray(); Directory.CreateDirectory(Path.Combine(work, "requests"));

            void Add(JsonObject basis, JsonObject context, string label, string geometryKey, string population,
                string expectedStatus, string[] expectedBarrierStatuses, string? equivalenceGroup = null,
                string[]? expectedStatuses = null)
            {
                int index = requests.Count;
                var request = Protected(basis, context);
                request["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1";
                string relative = $"requests/{index:D3}.json"; var bytes = Fixtures.Bytes(request);
                File.WriteAllBytes(Path.Combine(work, relative.Replace('/', Path.DirectorySeparatorChar)), bytes);
                requests.Add(new JsonObject {
                    ["index"] = index, ["id"] = request["requestId"]!.DeepClone(), ["label"] = label,
                    ["requestPath"] = relative, ["requestSha256"] = Fixtures.Hash(bytes), ["population"] = population,
                    ["geometryKey"] = geometryKey, ["contextSha256"] = Fixtures.Hash(Fixtures.Canonical(context)),
                    ["expectedStatus"] = expectedStatus,
                    ["expectedStatuses"] = new JsonArray((expectedStatuses ?? [expectedStatus]).Select(s => (JsonNode?)JsonValue.Create(s)).ToArray()),
                    ["expectedBarrierStatus"] = expectedBarrierStatuses.Length == 1 ? expectedBarrierStatuses[0] : null,
                    ["expectedBarrierStatuses"] = new JsonArray(expectedBarrierStatuses.Select(s => (JsonNode?)JsonValue.Create(s)).ToArray()),
                    ["equivalenceGroup"] = equivalenceGroup,
                });
            }

            for (int index = 0; index < 65; index++)
            {
                int pair = index % 16; string category = new[] { "LV", "Control", "Instrumentation" }[index % 3];
                bool reverse = index % 4 == 3;
                var request = (JsonObject)main.DeepClone(); request["category"] = category;
                request["from"] = Fixtures.Point(-.75 - .125 * (pair % 4), -.15 + .1 * (pair / 4));
                request["to"] = Fixtures.Point(61 + .125 * pair, -.1 + .1 * (pair % 3));
                request["reverse"] = reverse;
                Add(request, physical.Context, $"retirement-{index:D3}-pair-{pair:D2}-{category}", "tunnel-and-boxes", "retirement",
                    "calculated", ["clear"], $"pair-{pair}-{category}-reverse-{reverse}");
            }
            Add(small, wall.Context, "solid-wall-refusal", "wall", "control", "refused",
                ["blocked", "search-incomplete", "indeterminate"], expectedStatuses: ["no_path", "resource_limit"]);
            var drill = (JsonObject)wall.Context.DeepClone(); drill["binding"]!["policy"]!["drillThroughWalls"] = true;
            drill["binding"]!["policySha256"] = Fixtures.Hash(Fixtures.Canonical(drill["binding"]!["policy"]));
            Add(small, drill, "explicit-drilling-bypass", "wall", "control", "calculated", ["bypassed"]);
            Add(small, empty.Context, "explicit-empty-scope", "empty", "control", "calculated", ["no-barriers-declared"]);
            var returnMain = (JsonObject)main.DeepClone(); returnMain["category"] = "LV";
            returnMain["from"] = Fixtures.Point(-.75, -.15); returnMain["to"] = Fixtures.Point(61, -.1); returnMain["reverse"] = false;
            Add(returnMain, physical.Context, "return-to-original-protected-scope", "tunnel-and-boxes", "control", "calculated", ["clear"], "pair-0-LV-reverse-False");
            // Identical semantic inputs after context switches must reproduce the
            // exact ordered points, ledger and proof, not just the final length.
            var geometries = new JsonObject {
                ["tunnel-and-boxes"] = GeometryDescriptor(work, physical, 528, 800),
                ["wall"] = GeometryDescriptor(work, wall, 8, 12), ["empty"] = GeometryDescriptor(work, empty, 0, 0),
            };
            var files = new JsonArray(Directory.EnumerateFiles(work, "*.json", SearchOption.AllDirectories)
                .OrderBy(path => Path.GetRelativePath(work, path), StringComparer.Ordinal).Select(path => {
                    var bytes = File.ReadAllBytes(path);
                    return (JsonNode)new JsonObject { ["path"] = Relative(work, path), ["sha256"] = Fixtures.Hash(bytes), ["bytes"] = bytes.Length };
                }).ToArray());
            Need(files.Count <= MaximumWorkloadFiles);
            var manifest = new JsonObject {
                ["schemaVersion"] = WorkloadVersion, ["scope"] = "bounded independently authored synthetic session workload; not actual plant/civil/SDK or engineering acceptance",
                ["engineeringAccepted"] = false, ["nativeParity"] = "not-performed", ["sourceKind"] = "synthetic",
                ["rootLayout"] = "PF_ROOT is the manifest directory; all referenced paths are immutable relative paths",
                ["trayCount"] = 64, ["maximumRouteCodes"] = 64, ["distinctRetirementEndpointPairs"] = 16,
                ["categories"] = new JsonArray("LV", "Control", "Instrumentation"), ["geometry"] = geometries,
                ["retirementPopulationIndices"] = new JsonArray(Enumerable.Range(0, 65).Select(i => (JsonNode?)JsonValue.Create(i)).ToArray()),
                ["oneShotIndices"] = new JsonArray(0, 1, 15, 65, 66, 68), ["requests"] = requests, ["files"] = files,
            };
            string manifestPath = Path.Combine(work, "manifest.json"); var manifestBytes = Fixtures.Bytes(manifest); File.WriteAllBytes(manifestPath, manifestBytes);
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.barrier-session-workload-generation.v1", status = "PASS",
                manifestPath, manifestSha256 = Fixtures.Hash(manifestBytes), requests = requests.Count, retirementRequests = 65,
                distinctRetirementEndpointPairs = 16, trayCount = 64, physicalEvidence.ComputationalMeshes,
                sourceVertices = vertices.Count, sourceTriangles = indices.Count / 3, engineeringAccepted = false, nativeParity = "not-performed" }));
            return 0;
        }
        catch (Exception error) { return WorkloadFailure("generation", error); }
    }

    private static JsonObject GeometryDescriptor(string root, Fixtures.Stored stored, int vertices, int triangles)
    {
        var evidence = stored.Qualification?.Receipt.Evidence;
        return new JsonObject {
            ["context"] = stored.Context.DeepClone(), ["manifestPath"] = Relative(root, stored.ManifestPath),
            ["capturePath"] = evidence is null ? null : Relative(root, stored.CapturePath),
            ["sourceVertices"] = vertices, ["sourceTriangles"] = triangles, ["sourceFragments"] = evidence is null ? 0 : 1,
            ["computationalMeshes"] = evidence?.ComputationalMeshes ?? 0,
            ["verifiedVertices"] = evidence?.VertexCount ?? 0, ["verifiedTriangles"] = evidence?.TriangleCount ?? 0,
            ["captureSha256"] = stored.Qualification?.Receipt.CaptureSha256,
            ["pureVerificationSha256"] = evidence?.VerificationSha256, ["decompositionSha256"] = evidence?.DecompositionSha256,
        };
    }
    private static string Relative(string root, string path) => Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/');
    private static string ContainedWorkloadPath(string root, string relative)
    {
        Need(relative.Length is > 0 and <= 512 && !Path.IsPathRooted(relative) && !relative.Contains('\\')
            && relative.Split('/').All(part => part.Length > 0 && part is not "." and not ".."), "Invalid immutable workload path.");
        string full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        Need(full.StartsWith(Path.TrimEndingDirectorySeparator(root) + Path.DirectorySeparatorChar,
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal), "Workload path escaped its root.");
        return full;
    }
    private static byte[] BoundedRead(string path, long limit)
    {
        Need(Path.IsPathFullyQualified(path), "An absolute evidence path is required.");
        var info = new FileInfo(path); Need(info.Exists && info.Length is > 0 && info.Length <= limit, "Evidence file is absent or over its bound.");
        Need((info.Attributes & FileAttributes.ReparsePoint) == 0, "Evidence files must be retained regular files.");
        var bytes = File.ReadAllBytes(path); Need(bytes.Length <= limit); return bytes;
    }

    private static int VerifyWorkload(string manifestPath, string responsesPath, string? oneShotPath)
    {
        try
        {
            var manifestBytes = BoundedRead(manifestPath, 1024 * 1024);
            var manifest = JsonNode.Parse(manifestBytes)!.AsObject(); Equal(WorkloadVersion, manifest["schemaVersion"]!.GetValue<string>());
            Need(manifest["engineeringAccepted"]!.GetValue<bool>() == false); Equal("synthetic", manifest["sourceKind"]!.GetValue<string>());
            string root = Path.GetDirectoryName(Path.GetFullPath(manifestPath))!;
            var files = manifest["files"]!.AsArray(); Need(files.Count is > 0 and <= MaximumWorkloadFiles);
            var inventory = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            foreach (var entry in files)
            {
                string relative = entry!["path"]!.GetValue<string>();
                var bytes = BoundedRead(ContainedWorkloadPath(root, relative), MaximumWorkloadFileBytes);
                Equal(entry["bytes"]!.GetValue<int>(), bytes.Length); Equal(entry["sha256"]!.GetValue<string>(), Fixtures.Hash(bytes));
                Need(inventory.TryAdd(relative, bytes), "Duplicate immutable file inventory entry.");
            }
            byte[] Inventoried(string relative) => inventory.TryGetValue(relative, out var bytes) ? bytes : throw new InvalidOperationException("Required workload file is not in its frozen inventory.");
            var geometries = new Dictionary<string, Fixtures.Stored>(StringComparer.Ordinal);
            foreach (var (key, node) in manifest["geometry"]!.AsObject())
            {
                var descriptor = node!.AsObject(); var context = descriptor["context"]!.AsObject();
                string relativeManifest = descriptor["manifestPath"]!.GetValue<string>(); var rawManifest = Inventoried(relativeManifest);
                var retainedManifest = JsonNode.Parse(rawManifest)!.AsObject();
                Equal(context["storage"]!["manifest"]!["sha256"]!.GetValue<string>(), Fixtures.Hash(rawManifest));
                Equal(context["storage"]!["manifest"]!["bytes"]!.GetValue<int>(), rawManifest.Length);
                BarrierVerificationResult? verified = null; var capture = new JsonObject(); string capturePath = "";
                if (descriptor["capturePath"] is { } captureNode)
                {
                    string relativeCapture = captureNode.GetValue<string>(); var rawCapture = Inventoried(relativeCapture);
                    capturePath = ContainedWorkloadPath(root, relativeCapture); capture = JsonNode.Parse(rawCapture)!.AsObject();
                    verified = BarrierCaptureVerifier.Verify(rawCapture);
                    Need(verified.Qualified is not null && verified.Receipt.Status == "geometry-qualified", "Retained raw triangles did not independently qualify.");
                    var evidence = verified.Receipt.Evidence!;
                    Equal(descriptor["captureSha256"]!.GetValue<string>(), Fixtures.Hash(rawCapture));
                    Equal(context["storage"]!["capture"]!["sha256"]!.GetValue<string>(), Fixtures.Hash(rawCapture));
                    Equal(context["storage"]!["capture"]!["bytes"]!.GetValue<int>(), rawCapture.Length);
                    Equal(descriptor["pureVerificationSha256"]!.GetValue<string>(), evidence.VerificationSha256);
                    Equal(descriptor["decompositionSha256"]!.GetValue<string>(), evidence.DecompositionSha256);
                    Equal(descriptor["computationalMeshes"]!.GetValue<int>(), evidence.ComputationalMeshes);
                    Equal(descriptor["verifiedVertices"]!.GetValue<int>(), evidence.VertexCount);
                    Equal(descriptor["verifiedTriangles"]!.GetValue<int>(), evidence.TriangleCount);
                    var fragments = capture["fragments"]!.AsArray(); Equal(descriptor["sourceFragments"]!.GetValue<int>(), fragments.Count);
                    Equal(descriptor["sourceVertices"]!.GetValue<int>(), fragments.Sum(fragment => fragment!["verticesMetres"]!.AsArray().Count));
                    Equal(descriptor["sourceTriangles"]!.GetValue<int>(), fragments.Sum(fragment => fragment!["triangleIndices"]!.AsArray().Count / 3));
                }
                else Equal("explicit-empty", retainedManifest["geometry"]!["mode"]!.GetValue<string>());
                geometries.Add(key, new(context, capture, retainedManifest, capturePath, ContainedWorkloadPath(root, relativeManifest), verified));
            }
            var population = manifest["retirementPopulationIndices"]!.AsArray().Select(value => value!.GetValue<int>()).ToArray();
            Need(population.Length >= 65 && population.Distinct().Count() == population.Length);
            var descriptors = manifest["requests"]!.AsArray(); Need(descriptors.Count is >= 65 and <= MaximumWorkloadRequests);
            var requests = new Dictionary<int, (JsonObject Descriptor, JsonObject Request)>();
            var endpointPairs = new HashSet<string>(StringComparer.Ordinal); var categories = new HashSet<string>(StringComparer.Ordinal);
            var snapshots = new HashSet<string>(StringComparer.Ordinal);
            foreach (var node in descriptors)
            {
                var descriptor = node!.AsObject(); int index = descriptor["index"]!.GetValue<int>();
                var rawRequest = Inventoried(descriptor["requestPath"]!.GetValue<string>());
                Equal(descriptor["requestSha256"]!.GetValue<string>(), Fixtures.Hash(rawRequest));
                var request = JsonNode.Parse(rawRequest)!.AsObject(); Equal("pathfinder.model.runner.v2", request["schemaVersion"]!.GetValue<string>());
                Equal(descriptor["id"]!.GetValue<string>(), request["requestId"]!.GetValue<string>());
                Equal(descriptor["contextSha256"]!.GetValue<string>(), Fixtures.Hash(Fixtures.Canonical(request["barriers"])));
                Need(requests.TryAdd(index, (descriptor, request)), "Duplicate planned request index.");
                var rawSnapshot = Inventoried("snapshots/" + request["snapshotId"]!.GetValue<string>() + ".json");
                Equal(request["snapshotSha256"]!.GetValue<string>(), Fixtures.Hash(rawSnapshot));
                if (population.Contains(index))
                {
                    Equal("retirement", descriptor["population"]!.GetValue<string>()); Equal("calculated", descriptor["expectedStatus"]!.GetValue<string>());
                    endpointPairs.Add(Fixtures.Canonical(new JsonArray(request["from"]!.DeepClone(), request["to"]!.DeepClone())));
                    categories.Add(request["category"]!.GetValue<string>()); snapshots.Add(request["snapshotSha256"]!.GetValue<string>());
                    var objects = JsonNode.Parse(rawSnapshot)!["objects"]!.AsArray(); Equal(64, objects.Count);
                    Equal(64, objects.Select(obj => obj!["routeName"]!.GetValue<string>()).Distinct().Count());
                }
            }
            Need(population.All(requests.ContainsKey)); Equal(16, endpointPairs.Count); Equal(1, snapshots.Count);
            Need(categories.SetEquals(["LV", "Control", "Instrumentation"]));
            var actual = ReadWorkloadResponses(responsesPath, "session", requests, requests.Keys.ToHashSet(), geometries);
            var expectedOneShot = manifest["oneShotIndices"]!.AsArray().Select(node => node!.GetValue<int>()).ToHashSet();
            Need(expectedOneShot.Count is >= 4 and <= 8 && expectedOneShot.All(requests.ContainsKey));
            var oneShot = ReadWorkloadResponses(oneShotPath ?? responsesPath, "oneshot", requests, expectedOneShot, geometries);
            foreach (var index in expectedOneShot) Equal(Payload(actual[index]), Payload(oneShot[index]));
            foreach (var group in requests.Where(entry => entry.Value.Descriptor["equivalenceGroup"] is not null)
                .GroupBy(entry => entry.Value.Descriptor["equivalenceGroup"]!.GetValue<string>(), StringComparer.Ordinal))
            {
                string? prior = null;
                foreach (var entry in group) { string payload = Payload(actual[entry.Key]); if (prior is not null) Equal(prior, payload); prior = payload; }
            }
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.barrier-session-independent-verification.v1", status = "PASS",
                manifestSha256 = Fixtures.Hash(manifestBytes), planned = requests.Count, verified = actual.Count, oneShotCompared = oneShot.Count,
                retirementPopulation = population.Length, distinctEndpointPairs = endpointPairs.Count, categories = categories.Order().ToArray(),
                verifiedClearSegments = actual.Values.Where(value => Status(value) == "calculated" && Diagnostic(value) == "clear").Sum(value => Math.Max(1, Points(value).Length - 1)),
                scope = "retained synthetic raw triangles and exact ordered response polylines; centreline-only; not actual civil/SDK coverage,2140 capacity,native parity or engineering acceptance",
                engineeringAccepted = false, nativeParity = "not-performed" }));
            return 0;
        }
        catch (Exception error) { return WorkloadFailure("independent-verification", error); }
    }

    private static Dictionary<int, JsonElement> ReadWorkloadResponses(string path, string mode,
        Dictionary<int, (JsonObject Descriptor, JsonObject Request)> requests, HashSet<int> required,
        Dictionary<string, Fixtures.Stored> geometries)
    {
        using var document = JsonDocument.Parse(BoundedRead(path, 128L * 1024 * 1024));
        var rows = document.RootElement; bool wrapped = rows.ValueKind == JsonValueKind.Object;
        if (wrapped)
        {
            Equal("wfc.pf.barrier-session-responses.v1", rows.GetProperty("schemaVersion").GetString());
            rows = rows.GetProperty("responses");
        }
        Need(rows.ValueKind == JsonValueKind.Array && rows.GetArrayLength() <= 2 * MaximumWorkloadRequests);
        var values = new Dictionary<int, JsonElement>();
        foreach (var entry in rows.EnumerateArray())
        {
            if (wrapped)
            {
                string actualMode = entry.GetProperty("mode").GetString()!; Need(actualMode is "session" or "oneshot", "Unknown measurement mode.");
                if (actualMode != mode) continue;
            }
            int index = entry.GetProperty("index").GetInt32(); Need(required.Contains(index) && requests.ContainsKey(index), "Unexpected result index.");
            var (descriptor, request) = requests[index]; string id = descriptor["id"]!.GetValue<string>();
            Equal(id, entry.GetProperty("requestId").GetString()); var response = entry.GetProperty("response");
            Equal(id, response.GetProperty("requestId").GetString()); Need(values.TryAdd(index, response.Clone()), "Duplicate response index.");
            var statuses = descriptor["expectedStatuses"]!.AsArray().Select(node => node!.GetValue<string>()).ToArray();
            Need(statuses.Contains(Status(response)), "Unexpected status for " + descriptor["label"]!.GetValue<string>() + ": " + Status(response));
            Need(descriptor["expectedBarrierStatuses"]!.AsArray().Any(node => node!.GetValue<string>() == Diagnostic(response)), "Unexpected barrier diagnostic.");
            var context = request["barriers"]!.AsObject(); var physical = geometries[descriptor["geometryKey"]!.GetValue<string>()];
            if (Status(response) == "calculated")
            {
                ExactSuccessful(response, context, physical);
                string category = request["category"]!.GetValue<string>(); Equal(category == "Instrumentation" ? "Control" : category, response.GetProperty("effectiveCategory").GetString());
                bool reverse = request["reverse"]?.GetValue<bool>() == true; var points = Points(response);
                BarrierPoint ExpectedPoint(string end) { var value = request[end]!; return Fixtures.P(value["x"]!.GetValue<double>(), value["y"]!.GetValue<double>(), value["z"]!.GetValue<double>()); }
                Equal(ExpectedPoint(reverse ? "to" : "from"), points[0]); Equal(ExpectedPoint(reverse ? "from" : "to"), points[^1]);
                Need(response.GetProperty("route").GetProperty("routeCodes").GetArrayLength() <= 64, "Route exceeded the declared code ceiling.");
            }
            else
            {
                Refused(response); Equal(Fixtures.Canonical(context), Fixtures.Canonical(JsonNode.Parse(Execution(response).GetProperty("context").GetRawText())));
                Need(Execution(response).GetProperty("qualification").ValueKind == JsonValueKind.Object, "Wall control never reached raw physical qualification.");
            }
        }
        Need(values.Keys.ToHashSet().SetEquals(required), "Not every planned response was retained; partial evidence cannot be PASS.");
        return values;
    }
    private static int WorkloadFailure(string phase, Exception error)
    {
        string detail = error.GetType().Name + ": " + error.Message;
        Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.barrier-session-workload-failure.v1", status = "FAIL", phase,
            detail = detail.Length > 2048 ? detail[..2048] : detail, engineeringAccepted = false, nativeParity = "not-performed" }));
        return 1;
    }
}
