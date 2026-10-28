using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using AddinRibbon.Routing;
using PathFinder.Adapter;

internal static class BoundaryTests
{
    internal static void Run(string root, Action<string, bool, string> check)
    {
        var fixturePath = Path.Combine(root, "docs/pathfinder/fixtures/pf-core-v1.inputs.json");
        using var fixtures = JsonDocument.Parse(File.ReadAllBytes(fixturePath));
        foreach (var item in fixtures.RootElement.GetProperty("cases").EnumerateArray())
        {
            var kind = item.GetProperty("kind").GetString();
            if (kind is not ("calculate" or "lookup" or "parse" or "name" or "geometry" or "geometry-route")) continue;
            var id = item.GetProperty("id").GetString();
            var request = ConvertFixture(kind, item.GetProperty("input"), id);
            var response = Execute(request);
            using var expectedDoc = JsonDocument.Parse(JsonSerializer.Serialize(FrozenReplay.Evaluate(kind, item.GetProperty("input"))));
            var expected = expectedDoc.RootElement;
            if (expected.GetProperty("status").GetString() == "exception")
            {
                check("adapter-fixture:" + id, response.Status is "invalid_request" or "no_path" or "core_rejected", response.Status);
                continue;
            }
            if (kind is "geometry" or "geometry-route")
            {
                var summary = response.Geometry;
                if (summary is null)
                {
                    check("adapter-fixture:" + id, false, response.Status + "; no geometry summary returned");
                    continue;
                }
                var normalized = JsonSerializer.SerializeToElement(new
                {
                    status = "returned", validatedBends = summary.ValidatedBends, fallbackBends = summary.FallbackBends,
                    validatedStraights = summary.ValidatedStraights, fallbackStraights = summary.FallbackStraights,
                    fallbackClearances = summary.FallbackClearances, diagnostics = summary.Diagnostics,
                    segments = summary.Segments.Select(s => new
                    {
                        id = s.Id, name = s.Name, routeCode = s.RouteCode, categories = (int)s.AllowedCategories,
                        points = s.Points.Select(p => new[] { p.X, p.Y, p.Z }), connectionsAtEndsOnly = s.ConnectionsAtEndsOnly,
                        connectionSurfaceCount = s.ConnectionSurfaceCount,
                        verifiedPorts = s.VerifiedPorts.Select(p => new { point = new[] { p.Point.X, p.Point.Y, p.Point.Z },
                            outward = new[] { p.Outward.X, p.Outward.Y, p.Outward.Z }, u = new[] { p.U.X, p.U.Y, p.U.Z },
                            v = new[] { p.V.X, p.V.Y, p.V.Z }, width = p.Width, height = p.Height })
                    })
                });
                var normalizedNode = JsonNode.Parse(normalized.GetRawText()).AsObject();
                if (kind == "geometry-route" && response.Route != null) normalizedNode["route"] = JsonSerializer.SerializeToNode(FrozenReplay.Route(response.Route));
                var differences = new List<string>();
                Program.Compare(expected, JsonSerializer.SerializeToElement(normalizedNode), id, differences);
                check("adapter-fixture:" + id, differences.Count == 0, response.Status + "; " + string.Join("; ", differences));
            }
            else if (kind is "calculate" or "lookup")
            {
                var expectedRoute = expected.GetProperty("route");
                var route = response.Route;
                var same = route != null && route.Success == expectedRoute.GetProperty("success").GetBoolean()
                    && route.RouteText == expectedRoute.GetProperty("routeText").GetString()
                    && route.SegmentIds.SequenceEqual(expectedRoute.GetProperty("segmentIds").EnumerateArray().Select(v => v.GetString()))
                    && Math.Abs(route.LengthMeters - expectedRoute.GetProperty("lengthMeters").GetDouble()) <= 1e-9
                    && route.PathPoints.Count == expectedRoute.GetProperty("pathPoints").GetArrayLength();
                if (same)
                    for (var i = 0; i < route.PathPoints.Count; i++)
                    {
                        var expectedPoint = expectedRoute.GetProperty("pathPoints")[i];
                        var actualPoint = route.PathPoints[i];
                        same &= Math.Abs(actualPoint.X - expectedPoint[0].GetDouble()) <= 1e-9
                            && Math.Abs(actualPoint.Y - expectedPoint[1].GetDouble()) <= 1e-9
                            && Math.Abs(actualPoint.Z - expectedPoint[2].GetDouble()) <= 1e-9;
                    }
                var differences = new List<string>();
                if (route != null) Program.Compare(expectedRoute, JsonSerializer.SerializeToElement(FrozenReplay.Route(route)), id, differences);
                check("adapter-fixture:" + id, same && differences.Count == 0, response.Status + "; full route compared; " + string.Join("; ", differences));
            }
            else
            {
                var json = JsonSerializer.SerializeToElement(response, PathfinderAdapter.JsonOptions);
                var value = kind == "parse" ? "codes" : "routeCode";
                var responseValue = kind == "parse" ? "parsedCodes" : "resolvedName";
                var matches = json.TryGetProperty(responseValue, out var actual) && actual.GetRawText() == expected.GetProperty(value).GetRawText();
                check("adapter-fixture:" + id, matches, response.Status + "; " + value);
            }
        }

        var baseline = Minimal();
        var valid = Execute(baseline);
        check("adapter-valid-calculation", valid.Route?.Success == true && Math.Abs(valid.Route.LengthMeters - 10) <= 1e-9, valid.Status);
        var instrumentation = Minimal();
        instrumentation["category"] = "Instrumentation";
        var mapped = Execute(instrumentation);
        check("instrumentation-control-parity", mapped.Route?.Success == true && mapped.Route.RouteText == valid.Route?.RouteText && mapped.Route.LengthMeters == valid.Route?.LengthMeters, mapped.Status);
        check("adapter-repeat-byte-stable", JsonSerializer.Serialize(valid, PathfinderAdapter.JsonOptions) == JsonSerializer.Serialize(Execute(Minimal()), PathfinderAdapter.JsonOptions), "same request serialized twice");
        check("design-allowances-not-geometric-length", valid.Design?.DesignLengthMeters == 13m && valid.Route?.LengthMeters == 10,
            "10m geometric + 2m spare, then 5%, ceiling = 13m");
        var missingSecondary = Minimal();
        missingSecondary["from"]["y"] = 3;
        missingSecondary["projectSettings"]["secondaryTrayLength"] = null;
        var secondaryRequired = Execute(missingSecondary);
        check("secondary-setting-required-when-used", secondaryRequired.Status == "settings_required" && secondaryRequired.Design is null, secondaryRequired.Status);
        var noSecondaryNeeded = Minimal();
        noSecondaryNeeded["projectSettings"]["secondaryTrayLength"] = null;
        check("nullable-secondary-not-used", Execute(noSecondaryNeeded).Status == "calculated", "No synthetic fallback/default inserted when SECONDARY is unused.");
        var missingLimitLabel = MissingLimitLabelRequest();
        var missingLimitResult = Execute(missingLimitLabel);
        check("missing-label-containing-limit-is-no-path", missingLimitResult.Status == "no_path", missingLimitResult.Status + "; code text must not be mistaken for a graph budget error.");

        var cases = new (string Name, Action<JsonObject> Mutate, string Expected)[]
        {
            ("schema-version", r => r["schemaVersion"] = "pathfinder.pf1.request.v999", "invalid_request"),
            ("missing-schema", r => r.Remove("schemaVersion"), "invalid_request"),
            ("unknown-operation", r => r["operation"] = "install", "invalid_request"),
            ("unknown-field", r => r["authority"] = "project-details", "invalid_request"),
            ("wrong-coordinate-system", r => r["coordinateSystem"] = "millimetres-y-up", "invalid_request"),
            ("category-missing", r => r.Remove("category"), "category_required"),
            ("category-unknown", r => r["category"] = "Unknown", "category_required"),
            ("category-numeric", r => r["category"] = 4, "invalid_request"),
            ("settings-missing", r => r.Remove("projectSettings"), "invalid_request"),
            ("settings-negative-spare", r => r["projectSettings"]["endConnectionLength"] = -1, "invalid_request"),
            ("settings-negative-percentage", r => r["projectSettings"]["additionalBendingPercent"] = -1, "invalid_request"),
            ("settings-negative-secondary", r => r["projectSettings"]["secondaryTrayLength"] = -1, "invalid_request"),
            ("settings-decimal-excess-precision", r => r["projectSettings"]["endConnectionLength"] = "0.1234567890123456789012345678901", "invalid_request"),
            ("settings-decimal-underflow", r => r["projectSettings"]["endConnectionLength"] = "0.00000000000000000000000000001", "invalid_request"),
            ("settings-decimal-overflow", r => r["projectSettings"]["endConnectionLength"] = "79228162514264337593543950336", "invalid_request"),
            ("settings-claimed-authority", r => r["projectSettings"]["source"] = "project-details", "invalid_request"),
            ("duplicate-segment-id", r => r["segments"].AsArray().Add(r["segments"][0].DeepClone()), "invalid_request"),
            ("empty-segment-id", r => r["segments"][0]["id"] = "", "invalid_request"),
            ("one-point-segment", r => r["segments"][0]["points"].AsArray().RemoveAt(1), "invalid_request"),
            ("unknown-tray-category", r => r["segments"][0]["allowedCategories"][0] = "LowVoltage", "invalid_request"),
            ("unknown-nested-field", r => r["segments"][0]["points"][0]["w"] = 1, "invalid_request"),
            ("negative-tolerance", r => r["options"]["connectionToleranceMeters"] = -1, "invalid_request"),
            ("zero-spacing", r => r["options"]["sampleSpacingMeters"] = 0, "invalid_request"),
            ("unbounded-graph-nodes", r => r["options"]["maxGraphNodes"] = int.MaxValue, "resource_limit"),
            ("unbounded-graph-connections", r => r["options"]["maxGraphConnections"] = int.MaxValue, "resource_limit"),
            ("zero-timeout", r => r["timeoutMilliseconds"] = 0, "invalid_request"),
            ("unbounded-timeout", r => r["timeoutMilliseconds"] = int.MaxValue, "invalid_request"),
            ("nonfinite-coordinate-string", r => r["from"]["x"] = "NaN", "invalid_request"),
            ("extreme-coordinate", r => r["from"]["x"] = double.MaxValue, "invalid_request"),
            ("missing-endpoint", r => r.Remove("from"), "invalid_request"),
            ("null-segments", r => r["segments"] = null, "invalid_request"),
            ("null-segment", r => r["segments"][0] = null, "invalid_request"),
            ("null-point", r => r["segments"][0]["points"][0] = null, "invalid_request"),
            ("null-options", r => r["options"] = null, "invalid_request"),
            ("null-project-settings", r => r["projectSettings"] = null, "invalid_request"),
            ("missing-setting-field", r => r["projectSettings"].AsObject().Remove("endConnectionLength"), "invalid_request"),
            ("invalid-port-frame", r => r["segments"][0]["verifiedPorts"] = JsonNode.Parse("[{\"point\":{\"x\":0,\"y\":0,\"z\":0},\"outward\":{\"x\":0,\"y\":0,\"z\":0},\"u\":{\"x\":0,\"y\":1,\"z\":0},\"v\":{\"x\":0,\"y\":0,\"z\":1},\"width\":1,\"height\":1}]"), "invalid_request"),
            ("duplicate-mapped-tray-categories", r => r["segments"][0]["allowedCategories"] = new JsonArray("Control", "Instrumentation"), "invalid_request"),
            ("fabricated-internal-design-route", r => r["route"] = new JsonObject { ["success"] = true, ["lengthMeters"] = 10 }, "invalid_request")
        };
        foreach (var test in cases)
        {
            var request = Minimal();
            test.Mutate(request);
            var result = Execute(request);
            check("adapter-rejects:" + test.Name, result.Status == test.Expected, $"expected={test.Expected};actual={result.Status}");
        }

        foreach (var (name, json) in new[]
        {
            ("malformed-json", "{not-json"),
            ("array-envelope", "[]"),
            ("null-envelope", "null"),
            ("duplicate-root-member", baseline.ToJsonString().Replace("\"requestId\":\"parity-boundary\"", "\"requestId\":\"first\",\"requestId\":\"second\"")),
            ("duplicate-nested-member", baseline.ToJsonString().Replace("\"x\":0", "\"x\":0,\"x\":1")),
            ("nonfinite-overflow", baseline.ToJsonString().Replace("\"x\":0", "\"x\":1e999")),
            ("decimal-token-excess-precision", baseline.ToJsonString().Replace("\"endConnectionLength\":2", "\"endConnectionLength\":0.1234567890123456789012345678901")),
            ("decimal-token-underflow", baseline.ToJsonString().Replace("\"endConnectionLength\":2", "\"endConnectionLength\":1e-29")),
            ("deep-json", new string('[', 100) + "0" + new string(']', 100)),
            ("trailing-json", baseline.ToJsonString() + "{}")
        })
        {
            var result = PathfinderAdapter.Execute(Encoding.UTF8.GetBytes(json));
            check("adapter-rejects:" + name, result.Status == "invalid_request", result.Status);
        }
        var invalidUtf8 = new byte[] { 0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x31, 0x7d };
        check("adapter-rejects:invalid-utf8", PathfinderAdapter.Execute(invalidUtf8).Status == "invalid_request", "malformed UTF-8 inside JSON name");
        var overBytes = new byte[PathfinderAdapter.MaximumRequestBytes + 1];
        check("adapter-rejects:request-byte-limit", PathfinderAdapter.Execute(overBytes).Status == "resource_limit", $"{overBytes.Length} bytes");
        check("adapter-rejects:empty-input", PathfinderAdapter.Execute(ReadOnlyMemory<byte>.Empty).Status == "resource_limit", "0 bytes");
        var tooManySegments = Minimal();
        tooManySegments["segments"] = new JsonArray(Enumerable.Range(0, 4097).Select(i =>
        {
            var segment = baseline["segments"][0].DeepClone();
            segment["id"] = "segment-" + i;
            return segment;
        }).ToArray());
        check("adapter-rejects:segment-count-limit", Execute(tooManySegments).Status == "resource_limit", "4097 segments > 4096 cap");
        var tooManyPoints = Minimal();
        tooManyPoints["segments"][0]["points"] = new JsonArray(Enumerable.Range(0, 8193).Select(i => (JsonNode)new JsonObject { ["x"] = i, ["y"] = 0, ["z"] = 0 }).ToArray());
        check("adapter-rejects:point-array-limit", Execute(tooManyPoints).Status == "invalid_request", "8193 points > 8192 per segment cap");
        var geometryFixture = fixtures.RootElement.GetProperty("cases").EnumerateArray().First(c => c.GetProperty("id").GetString() == "geometry-box-mesh-straight");
        var badMesh = ConvertFixture("geometry", geometryFixture.GetProperty("input"), "bad-index");
        badMesh["geometry"][0]["mesh"]["fragments"][0]["triangleIndices"][0] = int.MaxValue;
        check("adapter-rejects:triangle-index-range", Execute(badMesh).Status == "invalid_request", "Triangle index outside its own vertex buffer.");
        var duplicateGeometry = ConvertFixture("geometry", geometryFixture.GetProperty("input"), "duplicate-geometry");
        duplicateGeometry["geometry"].AsArray().Add(duplicateGeometry["geometry"][0].DeepClone());
        check("adapter-rejects:duplicate-geometry-id", Execute(duplicateGeometry).Status == "invalid_request", "Geometry identity uniqueness checked separately from segment DTO.");

        const string exactDecimal = "0.1000000000000000000000000001";
        var exactSettings = Minimal();
        exactSettings["projectSettings"]["endConnectionLength"] = exactDecimal;
        var decimalResult = Execute(exactSettings);
        var decimalResponse = JsonSerializer.SerializeToElement(decimalResult, PathfinderAdapter.JsonOptions);
        check("adapter-decimal-text-full-precision", decimalResult.ProjectSettings?.EndConnectionLength == decimal.Parse(exactDecimal, System.Globalization.CultureInfo.InvariantCulture)
            && decimalResponse.GetProperty("projectSettings").GetProperty("endConnectionLength").GetString() == exactDecimal,
            decimalResult.Status + "; exact base-10 snapshot retained across wire response");
        foreach (var (name, text) in new[] { ("removable-trailing-zeros", "0.10000000000000000000000000000000000"), ("numeric-exponent", "1e-1") })
        {
            var payload = Minimal().ToJsonString().Replace("\"endConnectionLength\":2", "\"endConnectionLength\":" + text);
            var result = PathfinderAdapter.Execute(Encoding.UTF8.GetBytes(payload));
            check("adapter-decimal-accepts:" + name, result.Status == "calculated" && result.ProjectSettings?.EndConnectionLength == 0.1m,
                result.Status + "; mathematically exact decimal");
        }
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var cancelled = PathfinderAdapter.Execute(Encoding.UTF8.GetBytes(Minimal().ToJsonString()), cancellation.Token);
        check("adapter-cancelled-before-work", cancelled.Status == "cancelled", cancelled.Status);
        var heavy = HeavyRequest();
        heavy["timeoutMilliseconds"] = 1;
        var deadlineWatch = Stopwatch.StartNew();
        var deadline = Execute(heavy);
        check("adapter-deadline-during-work", deadline.Status == "deadline_exceeded" && deadlineWatch.Elapsed < TimeSpan.FromSeconds(10),
            $"status={deadline.Status};elapsedMs={deadlineWatch.ElapsedMilliseconds};cooperative deadline after envelope validation");
        heavy["timeoutMilliseconds"] = 60000;
        var heavyUtf8 = Encoding.UTF8.GetBytes(heavy.ToJsonString());
        using var midCancellation = new CancellationTokenSource();
        midCancellation.CancelAfter(1);
        var midCancelled = PathfinderAdapter.Execute(heavyUtf8, midCancellation.Token);
        check("adapter-cancelled-during-work", midCancelled.Status == "cancelled", midCancelled.Status);

        TieCharacterization(check);
        RunCli(root, baseline, check);
    }

    private static AdapterResponse Execute(JsonObject request) => PathfinderAdapter.Execute(Encoding.UTF8.GetBytes(request.ToJsonString()));

    private static JsonObject HeavyRequest()
    {
        var request = Minimal();
        request["segments"] = new JsonArray(Enumerable.Range(0, 40).Select(segment => (JsonNode)new JsonObject
        {
            ["id"] = "heavy-" + segment, ["name"] = "/BC" + (1000 + segment), ["allowedCategories"] = new JsonArray("Control"),
            ["points"] = new JsonArray(Enumerable.Range(0, 1000).Select(point => (JsonNode)new JsonObject
            {
                ["x"] = point, ["y"] = segment * 10, ["z"] = 0
            }).ToArray()), ["connectionsAtEndsOnly"] = false
        }).ToArray());
        return request;
    }

    private static JsonObject MissingLimitLabelRequest()
    {
        var request = Minimal();
        request["operation"] = "lookup";
        request.Remove("category");
        request.Remove("from");
        request.Remove("to");
        request["routeText"] = "/LIMIT1";
        return request;
    }

    private static JsonObject Minimal() => JsonNode.Parse("""
        {"schemaVersion":"pathfinder.pf1.request.v1","requestId":"parity-boundary","operation":"calculate",
         "timeoutMilliseconds":30000,"coordinateSystem":"right-handed-z-up-metres",
         "projectSettings":{"revision":"synthetic-parity-1","secondaryTrayLength":3,"endConnectionLength":2,"additionalBendingPercent":5},
         "options":{"connectionToleranceMeters":0.25,"sampleSpacingMeters":0.125,"secondaryDistanceMeters":2,"preferVerticalApproach":false,"maxGraphNodes":100000,"maxGraphConnections":250000},
         "category":"Control","from":{"x":0,"y":0,"z":0},"to":{"x":10,"y":0,"z":0},
         "segments":[{"id":"tray-1","name":"/BC001","allowedCategories":["Control"],"points":[{"x":0,"y":0,"z":0},{"x":10,"y":0,"z":0}],"connectionsAtEndsOnly":false}]}
        """).AsObject();

    private static JsonObject ConvertFixture(string kind, JsonElement input, string id)
    {
        var request = Minimal();
        request["requestId"] = id;
        request["operation"] = kind;
        request.Remove("category");
        request.Remove("from");
        request.Remove("to");
        request.Remove("segments");
        if (input.TryGetProperty("options", out var options)) request["options"] = JsonNode.Parse(options.GetRawText());
        if (input.TryGetProperty("reverse", out var reverse)) request["reverse"] = reverse.GetBoolean();
        if (kind is "calculate" or "geometry-route")
        {
            request["category"] = Category(input.GetProperty("category").GetInt32());
            request["from"] = Point(input.GetProperty("from"));
            request["to"] = Point(input.GetProperty("to"));
        }
        if (kind is "calculate" or "lookup")
        {
            request["segments"] = new JsonArray(input.GetProperty("segments").EnumerateArray().Select(segment => (JsonNode)new JsonObject
            {
                ["id"] = segment.GetProperty("id").GetString(), ["name"] = segment.GetProperty("name").GetString(),
                ["allowedCategories"] = Categories(segment.GetProperty("categories").GetInt32()),
                ["points"] = new JsonArray(segment.GetProperty("points").EnumerateArray().Select(p => (JsonNode)Point(p)).ToArray()),
                ["connectionsAtEndsOnly"] = segment.GetProperty("connectionsAtEndsOnly").GetBoolean()
            }).ToArray());
        }
        if (kind is "parse" or "lookup") request["routeText"] = input.GetProperty("routing").GetString();
        if (kind == "name") request["names"] = JsonNode.Parse(input.GetProperty("leafToRootNames").GetRawText());
        if (kind is "geometry" or "geometry-route")
        {
            request["geometry"] = new JsonArray(input.GetProperty("geometry").EnumerateArray().Select(g => (JsonNode)new JsonObject
            {
                ["id"] = g.GetProperty("id").GetString(), ["routeName"] = g.GetProperty("routeName").GetString(),
                ["categories"] = Categories(g.GetProperty("categories").GetInt32()), ["shapeName"] = g.GetProperty("shapeName").GetString(),
                ["minimum"] = Point(g.GetProperty("minimum")), ["maximum"] = Point(g.GetProperty("maximum")),
                ["faceExtents"] = new JsonArray(g.GetProperty("faceExtents").EnumerateArray().Select(f => (JsonNode)new JsonObject
                {
                    ["face"] = ((TrayBoxFace)f.GetProperty("face").GetInt32()).ToString(), ["minimum"] = Point(f.GetProperty("minimum")),
                    ["maximum"] = Point(f.GetProperty("maximum")), ["sampleCount"] = f.GetProperty("sampleCount").GetInt32()
                }).ToArray()),
                ["mesh"] = g.GetProperty("meshFragments").ValueKind == JsonValueKind.Null ? null : new JsonObject
                {
                    ["fragments"] = new JsonArray(g.GetProperty("meshFragments").EnumerateArray().Select(f => (JsonNode)new JsonObject
                    {
                        ["vertices"] = new JsonArray(f.GetProperty("vertices").EnumerateArray().Select(p => (JsonNode)Point(p)).ToArray()),
                        ["triangleIndices"] = JsonNode.Parse(f.GetProperty("triangleIndices").GetRawText())
                    }).ToArray())
                }
            }).ToArray());
        }
        return request;
    }

    private static JsonObject Point(JsonElement point) => new() { ["x"] = point[0].GetDouble(), ["y"] = point[1].GetDouble(), ["z"] = point[2].GetDouble() };
    private static string Category(int value) => value switch { 1 => "MV", 2 => "LV", 4 => "Control", _ => "Unknown" };
    private static JsonArray Categories(int value)
    {
        var result = new JsonArray();
        foreach (var (flag, name) in new[] { (1, "MV"), (2, "LV"), (4, "Control") }) if ((value & flag) != 0) result.Add(name);
        return result;
    }

    private static void TieCharacterization(Action<string, bool, string> check)
    {
        var branches = new[]
        {
            new TraySegment("first", "/BC101", CableCategory.Control, new[] { new RoutePoint(0, 0, 0), new RoutePoint(10, 0, 0) }),
            new TraySegment("second", "/BC102", CableCategory.Control, new[] { new RoutePoint(0, 0, 0), new RoutePoint(10, 0, 0) })
        };
        var from = new RoutePoint(0, 0, 0);
        var to = new RoutePoint(10, 0, 0);
        var first = new RouteCalculator().Calculate(branches, from, to, CableCategory.Control);
        var repeated = new RouteCalculator().Calculate(branches, from, to, CableCategory.Control);
        var permuted = new RouteCalculator().Calculate(branches.Reverse(), from, to, CableCategory.Control);
        check("tie-same-input-stable", first.RouteText == repeated.RouteText && first.PathPoints.SequenceEqual(repeated.PathPoints), first.RouteText);
        check("tie-permutation-characterized", first.Success && permuted.Success && first.LengthMeters == permuted.LengthMeters,
            $"original={first.RouteText};permuted={permuted.RouteText};equalLength={first.LengthMeters:R};sameRouteNotRequired=true;preserve-core-ordering");
    }

    private static void RunCli(string root, JsonObject valid, Action<string, bool, string> check)
    {
        var runnerPath = Path.Combine(root, "pathfinder-engine/tools/PathFinder.LocalRunner/bin/Release/net9.0/PathFinder.LocalRunner.dll");
        if (!File.Exists(runnerPath))
        {
            check("cli-runner-built", false, "Build Release runner before parity harness: " + runnerPath);
            return;
        }
        var tests = new List<(string Name, string Payload, string Status, int ExitCode)>
        {
            ("valid", valid.ToJsonString(), "calculated", 0),
            ("malformed", "{bad", "invalid_request", 2),
            ("null-envelope", "null", "invalid_request", 2),
            ("array-envelope", "[]", "invalid_request", 2)
        };
        foreach (var timeout in new JsonNode[] { JsonValue.Create("60000"), null, JsonValue.Create(true), JsonValue.Create(1.5), new JsonObject() })
        {
            var request = (JsonObject)valid.DeepClone();
            request["timeoutMilliseconds"] = timeout;
            tests.Add(("timeout-" + (timeout?.GetValueKind().ToString() ?? "Null"), request.ToJsonString(), "invalid_request", 2));
        }
        var noPath = (JsonObject)valid.DeepClone();
        noPath["category"] = "MV";
        tests.Add(("no-path", noPath.ToJsonString(), "no_path", 3));
        tests.Add(("missing-limit-label", MissingLimitLabelRequest().ToJsonString(), "no_path", 3));
        var missingSecondary = (JsonObject)valid.DeepClone();
        missingSecondary["from"]["y"] = 3;
        missingSecondary["projectSettings"]["secondaryTrayLength"] = null;
        tests.Add(("settings-required", missingSecondary.ToJsonString(), "settings_required", 3));
        using var frozenInputs = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(root, "docs/pathfinder/fixtures/pf-core-v1.inputs.json")));
        var graphLimitFixture = frozenInputs.RootElement.GetProperty("cases").EnumerateArray().First(c => c.GetProperty("id").GetString() == "graph-node-limit");
        var limited = ConvertFixture("calculate", graphLimitFixture.GetProperty("input"), "cli-graph-budget");
        tests.Add(("graph-budget", limited.ToJsonString(), "resource_limit", 5));
        var hardDeadline = HeavyRequest();
        hardDeadline["timeoutMilliseconds"] = 1;
        tests.Add(("hard-deadline", hardDeadline.ToJsonString(), "deadline_exceeded", 4));
        foreach (var (name, payload, expectedStatus, expectedExitCode) in tests)
        {
            var info = new ProcessStartInfo("dotnet") { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            info.ArgumentList.Add(runnerPath);
            using var process = Process.Start(info);
            process.StandardInput.Write(payload);
            process.StandardInput.Close();
            var outputTask = process.StandardOutput.ReadToEndAsync();
            var errorTask = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(45000))
            {
                process.Kill(true);
                check("cli:" + name, false, "Process exceeded 45 second test bound and was terminated.");
                continue;
            }
            var output = outputTask.GetAwaiter().GetResult();
            var error = errorTask.GetAwaiter().GetResult();
            try
            {
                using var doc = JsonDocument.Parse(output);
                var status = doc.RootElement.GetProperty("status").GetString();
                check("cli:" + name, process.ExitCode == expectedExitCode && status == expectedStatus && doc.RootElement.GetProperty("schemaVersion").GetString() == "pathfinder.pf1.response.v1",
                    $"exit={process.ExitCode};status={status};stderr={error}");
                if (name == "valid")
                {
                    var route = doc.RootElement.GetProperty("route");
                    var design = doc.RootElement.GetProperty("design");
                    check("cli:full-result-roundtrip", route.GetProperty("lengthMeters").GetDouble() == 10
                        && route.GetProperty("pathPoints")[0].GetProperty("x").GetDouble() == 0
                        && route.GetProperty("pathPoints")[route.GetProperty("pathPoints").GetArrayLength() - 1].GetProperty("x").GetDouble() == 10
                        && design.GetProperty("designLengthMeters").GetString() == "13",
                        "Child worker result preserved (immutable core route and exact decimal strings).");
                }
            }
            catch (JsonException)
            {
                check("cli:" + name, false, $"Expected one JSON response; exit={process.ExitCode};stdout={output};stderr={error}");
            }
        }
    }
}
