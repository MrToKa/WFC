using System.Text.Json;
using System.Text.Json.Nodes;
using static MixedRuntimeFixtures;

internal static partial class Program
{
    private static async Task CapacityTransport(string runner, string root)
    {
        await PurposeTransport(runner, root);
        var empty = Store(root, null);
        await Check("capacity exclusions produce no path when every fitted tray is excluded", async () => {
            var request = Protected(Fixtures.Request(root), empty.Context);
            request["excludedRouteCodes"] = new JsonArray("/BC001");
            var value = await OneShot(runner, root, request); Refused(value); Equal("no_path", Status(value));
        });
        await Check("warm prepared cache remains reusable after a capacity exclusion", async () => {
            using var session = await Session.Start(runner, root);
            var baseline = Protected(Fixtures.Request(root), empty.Context);
            Successful(await session.Query(baseline), empty.Context);
            var excluded = baseline.DeepClone().AsObject(); excluded["requestId"] = Fixtures.FreshId();
            excluded["excludedRouteCodes"] = new JsonArray("/BC001"); Refused(await session.Query(excluded));
            baseline["requestId"] = Fixtures.FreshId(); Successful(await session.Query(baseline), empty.Context); await session.Finish();
        });
        await Check("capacity exclusions do not create a new direct SECONDARY qualification", async () => {
            var request = Fixtures.Request(root, [(0,10,0,.1),(0,10,10,.1)]);
            request["from"] = Fixtures.Point(0,0,.1); request["to"] = Fixtures.Point(1,0,.1);
            request["directSecondaryPolicy"] = "nearest-eligible-tray-or.v1";
            request["excludedRouteCodes"] = new JsonArray("/BC001");
            var value = await OneShot(runner, root, Protected(request, empty.Context));
            Successful(value, empty.Context);
            Equal("tray-network", Execution(value).GetProperty("directSecondary").GetProperty("mode").GetString());
            Need(!value.GetProperty("route").GetProperty("routeCodes").EnumerateArray().Any(code => code.GetString() == "/BC001"));
        });
        await Check("protected capacity exclusions retain the actual wall-checked route", async () => {
            var request = Fixtures.Request(root, [(-3,3,0,.1),(-3,3,3,.1)]);
            request["from"] = Fixtures.Point(-2,3,.1); request["to"] = Fixtures.Point(2,3,.1);
            request["excludedRouteCodes"] = new JsonArray("/BC001");
            var wall = Store(root, Fixtures.Transform(Wall(), point => Fixtures.P(point.X,point.Y/10,point.Z/10)));
            Successful(await OneShot(runner, root, Protected(request, wall.Context)), wall.Context, wall);
        });
        await Check("legacy protected and unprotected calculation honor per-query exclusions", async () => {
            var source = Fixtures.Request(root);
            var legacy = Fixtures.Store(root, Fixtures.Box(100,101));
            var protectedRequest = Protected(source, legacy.Context); protectedRequest["excludedRouteCodes"] = new JsonArray("/BC001");
            Equal("no_path", Status(await OneShot(runner, root, protectedRequest)));
            source["schemaVersion"] = "pathfinder.model.runner.v1"; source["excludedRouteCodes"] = new JsonArray("/BC001");
            Equal("no_path", Status(await OneShot(runner, root, source)));
        });
        await Check("runner refuses malformed capacity codes and exclusions on non-calculation operations", async () => {
            foreach (var codes in new[] { new JsonArray("/bc001"), new JsonArray("/BC001","/BC001"), new JsonArray("/BC001\n") }) {
                var request = Protected(Fixtures.Request(root), empty.Context); request["excludedRouteCodes"] = codes;
                Equal("invalid_request", Status(await OneShot(runner, root, request)));
            }
            var prepare = Fixtures.Request(root); prepare["schemaVersion"] = "pathfinder.model.runner.v1";
            prepare["operation"] = "prepare"; prepare["includeLengthLedger"] = false; prepare["excludedRouteCodes"] = new JsonArray();
            Equal("invalid_request", Status(await OneShot(runner, root, prepare)));
        });
        await Check("weighted protected opening route retains the exact actual geometry proof and physical length", async () => {
            var split = Fixtures.Request(root, [(-2, -.1, 0, .1), (.1, 2, 0, .1)]);
            split["from"] = Fixtures.Point(-1.5, 0, .1); split["to"] = Fixtures.Point(1.5, 0, .1);
            split["routeCostMultipliers"] = JsonNode.Parse("""[{"routeCode":"/BC001","multiplier":10},{"routeCode":"/BC002","multiplier":20}]""");
            var stored = Store(root, Fixtures.Transform(Ring(), p => Fixtures.P(p.X, p.Y, p.Z * .75 + .75)));
            var current = OpeningContext(stored.Context);
            var value = await OneShot(runner, root, Protected(split, current)); Successful(value, current, stored);
            Need(Execution(value).GetProperty("diagnostics").GetProperty("reasonCode").GetString()!.Contains("INTER_TRAY_OPENING_MANEUVER_V1", StringComparison.Ordinal));
            var points = Points(value); double length = 0;
            for (int i = 1; i < points.Length; i++) length += Math.Sqrt(Math.Pow(points[i].X-points[i-1].X,2)
                + Math.Pow(points[i].Y-points[i-1].Y,2) + Math.Pow(points[i].Z-points[i-1].Z,2));
            Need(Math.Abs(length - value.GetProperty("route").GetProperty("lengthMeters").GetDouble()) < 1e-12);
        });
        await Check("warm cached preparation accepts different query weights without changing geometry or length", async () => {
            using var session = await Session.Start(runner, root);
            var baseline = Protected(Fixtures.Request(root), empty.Context);
            var old = await session.Query(baseline); Successful(old, empty.Context);
            var weighted = baseline.DeepClone().AsObject(); weighted["requestId"] = Fixtures.FreshId();
            weighted["routeCostMultipliers"] = JsonNode.Parse("""[{"routeCode":"/BC001","multiplier":500}]""");
            var current = await session.Query(weighted); Successful(current, empty.Context);
            Equal(RouteHash(Points(old)), RouteHash(Points(current)));
            Equal(old.GetProperty("route").GetProperty("lengthMeters").GetDouble(), current.GetProperty("route").GetProperty("lengthMeters").GetDouble());
            baseline["requestId"] = Fixtures.FreshId(); Successful(await session.Query(baseline), empty.Context); await session.Finish();
        });
        await Check("legacy and protected runner reject invalid weights and non-calculation weighted operations", async () => {
            foreach (var weights in new[] { "[{\"routeCode\":\"/bc001\",\"multiplier\":2}]", "[{\"routeCode\":\"/BC001\",\"multiplier\":0}]",
                "[{\"routeCode\":\"/BC001\",\"multiplier\":1001}]", "[{\"routeCode\":\"/BC001\",\"multiplier\":2},{\"routeCode\":\"/BC001\",\"multiplier\":3}]",
                "[{\"routeCode\":\"/BC001\",\"multiplier\":2,\"ignoreWall\":true}]" }) {
                var request = Protected(Fixtures.Request(root), empty.Context); request["routeCostMultipliers"] = JsonNode.Parse(weights);
                Equal("invalid_request", Status(await OneShot(runner, root, request)));
            }
            var prepare = Fixtures.Request(root); prepare["schemaVersion"] = "pathfinder.model.runner.v1";
            prepare["operation"] = "prepare"; prepare["includeLengthLedger"] = false; prepare["routeCostMultipliers"] = new JsonArray();
            Equal("invalid_request", Status(await OneShot(runner, root, prepare)));
        });
    }
}
