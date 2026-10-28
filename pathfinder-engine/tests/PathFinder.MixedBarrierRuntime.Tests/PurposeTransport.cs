using System.Text.Json;
using System.Text.Json.Nodes;
using static MixedRuntimeFixtures;

internal static partial class Program
{
    private static async Task PurposeTransport(string runner, string root)
    {
        var mixed = Store(root, null);
        var legacy = Fixtures.Store(root, Fixtures.Box(100, 101));
        JsonObject RequestFor(string lane, JsonObject source)
        {
            var request = lane switch
            {
                "mixed" => Protected(source, mixed.Context),
                "legacy-barrier" => Protected(source, legacy.Context),
                _ => source
            };
            request["schemaVersion"] = lane == "ordinary" ? "pathfinder.model.runner.v1" : "pathfinder.model.runner.v2";
            return request;
        }
        foreach (var lane in new[] { "ordinary", "legacy-barrier", "mixed" })
        {
            await Check(lane + " cable Purpose permission selects the network independently of its LV category", async () => {
                var source = Fixtures.Request(root); source["schemaVersion"] = "pathfinder.model.runner.v1";
                var allowed = RequestFor(lane, source); allowed["allowedPurposeRouteCodes"] = new JsonArray("/BC001");
                Equal("calculated", Status(await OneShot(runner, root, allowed)));
                var denied = allowed.DeepClone().AsObject(); denied["requestId"] = Fixtures.FreshId(); denied["allowedPurposeRouteCodes"] = new JsonArray();
                Equal("no_path", Status(await OneShot(runner, root, denied)));
            });
            await Check(lane + " nearest tray for direct SECONDARY uses cable Purpose permissions before capacity", async () => {
                var source = Fixtures.Request(root, [(0, 10, 0, .1), (0, 10, 10, .1)]);
                source["schemaVersion"] = "pathfinder.model.runner.v1";
                source["from"] = Fixtures.Point(0, 0, .1); source["to"] = Fixtures.Point(1, 0, .1);
                source["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1";
                var request = RequestFor(lane, source); request["allowedPurposeRouteCodes"] = new JsonArray("/BC002");
                // A VFD cable may use only the far tray. The nearer Power-only
                // tray must not distort its independent nearest-tray decision.
                request["excludedRouteCodes"] = new JsonArray("/BC002");
                var value = await OneShot(runner, root, request);
                Equal("calculated", Status(value));
                var decision = lane == "ordinary" ? value.GetProperty("directSecondary")
                    : Execution(value).GetProperty("directSecondary").GetProperty("distanceDecision");
                Equal("direct-secondary", decision.GetProperty("mode").GetString());
                Need(value.GetProperty("route").GetProperty("routeCodes").EnumerateArray().All(code => code.GetString() == "/SECONDARY"));
                var empty = request.DeepClone().AsObject(); empty["requestId"] = Fixtures.FreshId(); empty["allowedPurposeRouteCodes"] = new JsonArray();
                Equal("no_path", Status(await OneShot(runner, root, empty)));
            });
            await Check(lane + " weighted reverse and warm-cache alternatives cannot cross cable Purpose networks", async () => {
                using var session = await Session.Start(runner, root);
                // Coincident geometry deliberately exercises graph recipe reuse:
                // route identity, not spatial coincidence, owns the permission.
                var request = RequestFor(lane, Fixtures.Request(root, [(0, 3, 0, .1), (0, 3, 0, .1)]));
                request["from"] = Fixtures.Point(0, 0, .1); request["to"] = Fixtures.Point(3, 0, .1);
                request["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1";
                request["routeCostMultipliers"] = JsonNode.Parse("""[{"routeCode":"/BC001","multiplier":1},{"routeCode":"/BC002","multiplier":1000}]""");
                foreach (var code in new[] { "/BC001", "/BC002", "/BC001", "/BC002" })
                {
                    request["requestId"] = Fixtures.FreshId(); request["allowedPurposeRouteCodes"] = new JsonArray(code);
                    request["reverse"] = code == "/BC002";
                    var value = await session.Query(request); Equal("calculated", Status(value));
                    var codes = value.GetProperty("route").GetProperty("routeCodes").EnumerateArray().Select(item => item.GetString()).Where(item => item != "/SECONDARY").ToArray();
                    Need(codes.Length > 0 && codes.All(item => item == code), "Weighted query traversed another Purpose's coincident tray.");
                    var points = value.GetProperty("route").GetProperty("pathPoints");
                    Equal(code == "/BC002" ? 3d : 0d, points[0].GetProperty("x").GetDouble());
                    Equal(code == "/BC002" ? 0d : 3d, points[points.GetArrayLength()-1].GetProperty("x").GetDouble());
                }
                request["requestId"] = Fixtures.FreshId(); request["excludedRouteCodes"] = new JsonArray("/BC002");
                Equal("no_path", Status(await session.Query(request)));
                request["requestId"] = Fixtures.FreshId(); request.Remove("excludedRouteCodes");
                Equal("calculated", Status(await session.Query(request))); await session.Finish();
            });
        }
        await Check("warm prepared graph reuse cannot borrow another cable Purpose's trays", async () => {
            using var session = await Session.Start(runner, root);
            var request = Protected(Fixtures.Request(root), mixed.Context);
            request["allowedPurposeRouteCodes"] = new JsonArray("/BC001");
            Equal("calculated", Status(await session.Query(request)));
            request["requestId"] = Fixtures.FreshId(); request["allowedPurposeRouteCodes"] = new JsonArray();
            Equal("no_path", Status(await session.Query(request)));
            request["requestId"] = Fixtures.FreshId(); request["allowedPurposeRouteCodes"] = new JsonArray("/BC001");
            Equal("calculated", Status(await session.Query(request))); await session.Finish();
        });
        await Check("runner refuses malformed Purpose route permissions and non-calculation use", async () => {
            foreach (var codes in new[] { new JsonArray("/bc001"), new JsonArray("/BC001", "/BC001"), new JsonArray("/SECONDARY"), new JsonArray("/BC001\n") })
            {
                var request = Protected(Fixtures.Request(root), mixed.Context); request["allowedPurposeRouteCodes"] = codes;
                Equal("invalid_request", Status(await OneShot(runner, root, request)));
            }
            var prepare = Fixtures.Request(root); prepare["schemaVersion"] = "pathfinder.model.runner.v1";
            prepare["operation"] = "prepare"; prepare["includeLengthLedger"] = false; prepare["allowedPurposeRouteCodes"] = new JsonArray();
            Equal("invalid_request", Status(await OneShot(runner, root, prepare)));
        });
    }
}
