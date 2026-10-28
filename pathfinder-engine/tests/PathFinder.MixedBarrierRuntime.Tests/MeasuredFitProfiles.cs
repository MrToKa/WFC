using System.Text.Json;
using System.Text.Json.Nodes;
using static MixedRuntimeFixtures;

internal static partial class Program
{
    private static JsonObject MeasuredFitContext(JsonObject original)
    {
        var context = NearestAnchoredContext(original); context["profile"]!["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v6";
        context["profile"]!["geometryFitting"] = JsonNode.Parse("""
        {"policyVersion":"wfc.pf.measured-bend-mesh-fitting.v2","modelBuildRules":"pf2.rules.v2"}
        """);
        ProfileHash(context); return context;
    }
    private static JsonObject Rules(string version) => new() { ["version"] = version, ["categoryMappingVersion"] = "wfc-mto-v1", ["excludedObjectIds"] = new JsonArray() };
    private static string PreparedKey(JsonElement response) => response.GetProperty("prepared").GetProperty("key").GetString()!;
    private static async Task MeasuredFitProfileTransport(string runner, string root)
    {
        var request = Fixtures.Request(root, [(-3, 3, 0, .1)]); request["from"] = Fixtures.Point(-2); request["to"] = Fixtures.Point(2);
        var original = Store(root, Ring()); var current = MeasuredFitContext(original.Context);
        await Check("v6 exact fitting profile selects distinct rules2 cache before routing", async () => {
            var previous = await OneShot(runner, root, Protected(request, NearestAnchoredContext(original.Context)));
            var next = await OneShot(runner, root, Protected(request, current));
            Successful(previous, NearestAnchoredContext(original.Context), original); Successful(next, current, original);
            Need(PreparedKey(previous) != PreparedKey(next)); Equal(RouteHash(Points(previous)), RouteHash(Points(next)));
            var explicitRules = Protected(request, current); explicitRules["rules"] = Rules("pf2.rules.v2");
            var explicitResult = await OneShot(runner, root, explicitRules); Successful(explicitResult, current, original);
            Equal(PreparedKey(next), PreparedKey(explicitResult));
        });
        foreach (var corruption in new[] { "policy", "rules", "extra", "missing", "digest" })
            await Check("v6 refuses rehashed fitting profile corruption: " + corruption, async () => {
                var changed = current.DeepClone().AsObject(); var fit = changed["profile"]!["geometryFitting"]!.AsObject();
                if (corruption == "policy") fit["policyVersion"] = "unproved.v3";
                else if (corruption == "rules") fit["modelBuildRules"] = "pf2.rules.v1";
                else if (corruption == "extra") fit["trustBounds"] = true;
                else if (corruption == "missing") changed["profile"]!.AsObject().Remove("geometryFitting");
                ProfileHash(changed);
                if (corruption == "digest") changed["profileSha256"] = NearestAnchoredContext(original.Context)["profileSha256"]!.DeepClone();
                var bad = Protected(request, changed); bad["snapshotId"] = Guid.NewGuid().ToString("D");
                var result = await OneShot(runner, root, bad); Refused(result, false);
                Need(result.GetProperty("message").GetString()!.Contains("Mixed runtime profile or digest mismatch", StringComparison.Ordinal),
                    "An invalid v6 profile must refuse before attempting to read the deliberately absent snapshot.");
            });
        await Check("v6 explicit rules1 refuses before source or cache admission", async () => {
            var freshRoot = Path.Combine(root, "rules1-refusal"); var fresh = Fixtures.Request(freshRoot, [(-3, 3, 0, .1)]);
            var stored = Store(freshRoot, Ring()); var bad = Protected(fresh, MeasuredFitContext(stored.Context)); bad["rules"] = Rules("pf2.rules.v1");
            var result = await OneShot(runner, freshRoot, bad); Refused(result);
            Need(result.GetProperty("message").GetString()!.Contains("requires explicit rules v2", StringComparison.Ordinal));
            Need(!Directory.Exists(Path.Combine(freshRoot, "cache")), "Rejected rules cannot create a historical fitted entry.");
        });
        foreach (var historical in new[] { original.Context, OpeningContext(original.Context), LargeSelectionContext(original.Context), NearestAnchoredContext(original.Context) })
            await Check("historical mixed profile refuses explicit rules2: " + historical["profile"]!["schemaVersion"]!.GetValue<string>(), async () => {
                var bad = Protected(request, historical); bad["rules"] = Rules("pf2.rules.v2"); Refused(await OneShot(runner, root, bad));
            });
        await Check("v6 preserves actual wall refusal and unchanged collision caps", async () => {
            var wall = Store(root, Wall()); Refused(await OneShot(runner, root, Protected(request, MeasuredFitContext(wall.Context))));
            Equal(Fixtures.Canonical(NearestAnchoredContext(original.Context)["profile"]!["routing"]), Fixtures.Canonical(current["profile"]!["routing"]));
            Equal(Fixtures.Canonical(NearestAnchoredContext(original.Context)["profile"]!["localSearch"]), Fixtures.Canonical(current["profile"]!["localSearch"]));
        });
        await Check("v6 session switches v5-v6-v5 without a foreign prepared cache hit", async () => {
            using var session = await Session.Start(runner, root);
            var oldContext = NearestAnchoredContext(original.Context);
            var before = await session.Query(Protected(request, oldContext)); var next = await session.Query(Protected(request, current));
            var after = await session.Query(Protected(request, oldContext));
            Successful(before, oldContext, original); Successful(next, current, original); Successful(after, oldContext, original);
            Need(PreparedKey(before) != PreparedKey(next)); Equal(PreparedKey(before), PreparedKey(after)); await session.Finish();
        });
        await Check("standalone rules2 diagnostic cannot promote a v1 fitted trace", async () => {
            var diagnostic = request.DeepClone().AsObject(); diagnostic["schemaVersion"] = "pathfinder.model.runner.v1";
            diagnostic["operation"] = "prepare"; diagnostic.Remove("includeLengthLedger"); diagnostic["rules"] = Rules("pf2.rules.v2");
            var prepared = await OneShot(runner, root, diagnostic); Equal("prepared", Status(prepared));
            diagnostic["fittedTraceExport"] = new JsonObject { ["schemaVersion"] = "wfc.pf.fitted-trace-export-request.v1", ["exportId"] = Guid.NewGuid().ToString("D"), ["maxBytes"] = 1024 * 1024 };
            var refused = await OneShot(runner, root, diagnostic); Equal("invalid_request", Status(refused));
            Need(refused.GetProperty("message").GetString()!.Contains("without trace export", StringComparison.Ordinal));
        });
        await Check("omitted standalone and historical v5 rules remain exact rules1", async () => {
            var diagnostic = request.DeepClone().AsObject(); diagnostic["schemaVersion"] = "pathfinder.model.runner.v1";
            diagnostic["operation"] = "prepare"; diagnostic.Remove("includeLengthLedger");
            var omitted = await OneShot(runner, root, diagnostic); Equal("prepared", Status(omitted));
            diagnostic["rules"] = Rules("pf2.rules.v1");
            var explicitLegacy = await OneShot(runner, root, diagnostic); Equal("prepared", Status(explicitLegacy));
            Equal(PreparedKey(omitted), PreparedKey(explicitLegacy));
            var legacy = Protected(request, NearestAnchoredContext(original.Context));
            var defaultRoute = await OneShot(runner, root, legacy); legacy["rules"] = Rules("pf2.rules.v1");
            var explicitRoute = await OneShot(runner, root, legacy);
            Successful(defaultRoute, NearestAnchoredContext(original.Context), original); Successful(explicitRoute, NearestAnchoredContext(original.Context), original);
            Equal(PreparedKey(omitted), PreparedKey(defaultRoute)); Equal(PreparedKey(defaultRoute), PreparedKey(explicitRoute));
            Equal(RouteHash(Points(defaultRoute)), RouteHash(Points(explicitRoute)));
        });
    }
}
