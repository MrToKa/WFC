using System.Text.Json.Nodes;
using static MixedRuntimeFixtures;

internal static partial class Program
{
    private static JsonObject RetainedPairsContext(JsonObject original)
    {
        var context = MeasuredFitContext(original);
        context["profile"]!["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v7";
        context["profile"]!["routing"]!["maxPairs"] = 264;
        ProfileHash(context); return context;
    }
    private static async Task RetainedPairsProfileTransport(string runner, string root)
    {
        var request = Fixtures.Request(root, [(-3, 3, 0, .1)]);
        request["from"] = Fixtures.Point(-2); request["to"] = Fixtures.Point(2);
        var opening = Store(root, Ring()); var current = RetainedPairsContext(opening.Context);
        await Check("v7 preserves v6 measured preparation and exact checked route", async () => {
            var previous = await OneShot(runner, root, Protected(request, MeasuredFitContext(opening.Context)));
            var next = await OneShot(runner, root, Protected(request, current));
            Successful(previous, MeasuredFitContext(opening.Context), opening); Successful(next, current, opening);
            Equal(PreparedKey(previous), PreparedKey(next)); Equal(RouteHash(Points(previous)), RouteHash(Points(next)));
            var explicitRules = Protected(request, current); explicitRules["rules"] = Rules("pf2.rules.v2");
            var explicitResult = await OneShot(runner, root, explicitRules); Successful(explicitResult, current, opening);
            Equal(PreparedKey(next), PreparedKey(explicitResult));
        });
        foreach (int pairs in new[] { 64, 263, 265 })
            await Check("v7 refuses rehashed altered pair limit " + pairs, async () => {
                var changed = current.DeepClone().AsObject(); changed["profile"]!["routing"]!["maxPairs"] = pairs;
                ProfileHash(changed); Refused(await OneShot(runner, root, Protected(request, changed)), false);
            });
        await Check("v7 cannot borrow the historical v6 profile digest", async () => {
            var changed = current.DeepClone().AsObject(); changed["profileSha256"] = MeasuredFitContext(opening.Context)["profileSha256"]!.DeepClone();
            Refused(await OneShot(runner, root, Protected(request, changed)), false);
        });
        await Check("v7 refuses rules1 before source or prepared cache admission", async () => {
            var freshRoot = Path.Combine(root, "v7-rules1-refusal"); var fresh = Fixtures.Request(freshRoot, [(-3, 3, 0, .1)]);
            var stored = Store(freshRoot, Ring()); var bad = Protected(fresh, RetainedPairsContext(stored.Context)); bad["rules"] = Rules("pf2.rules.v1");
            var result = await OneShot(runner, freshRoot, bad); Refused(result);
            Need(result.GetProperty("message").GetString()!.Contains("requires explicit rules v2", StringComparison.Ordinal));
            Need(!Directory.Exists(Path.Combine(freshRoot, "cache")));
        });
        await Check("v7 retains actual material refusal without drilling", async () => {
            var wall = Store(root, Wall()); Refused(await OneShot(runner, root, Protected(request, RetainedPairsContext(wall.Context))));
        });
        await Check("v7 reaches a retained interior candidate while v6 remains bounded at64", async () => {
            var spans = new List<(double, double, double, double)>();
            for (int rank = 0; rank < 15; rank++) spans.Add((-.4, .4, rank * .7, .1));
            for (int rank = 0; rank < 15; rank++) spans.Add((99.6, 100.4, rank * .7, .1));
            spans.Add((49.6, 50.4, 0, .1));
            var dense = Fixtures.Request(root, spans.ToArray()); dense["from"] = Fixtures.Point(0); dense["to"] = Fixtures.Point(100);
            var remote = Store(root, Fixtures.Transform(Wall(), p => Fixtures.P(p.X + 1000, p.Y, p.Z)));
            var old = await OneShot(runner, root, Protected(dense, MeasuredFitContext(remote.Context)));
            Refused(old); Equal("CANDIDATE_PAIR_LIMIT", Execution(old).GetProperty("diagnostics").GetProperty("reasonCode").GetString());
            Equal(64, Execution(old).GetProperty("diagnostics").GetProperty("pairAttempts").GetInt32());
            var nextContext = RetainedPairsContext(remote.Context);
            var next = await OneShot(runner, root, Protected(dense, nextContext)); Successful(next, nextContext, remote);
            int attempts = Execution(next).GetProperty("diagnostics").GetProperty("pairAttempts").GetInt32();
            Need(attempts > 64 && attempts <= 264, "The regression must exercise candidates beyond the historical ceiling.");
        });
        await Check("warm session keeps v6-v7-v6 dispatch and measured preparation exact", async () => {
            using var session = await Session.Start(runner, root); var previous = MeasuredFitContext(opening.Context);
            var before = await session.Query(Protected(request, previous)); var next = await session.Query(Protected(request, current));
            var after = await session.Query(Protected(request, previous));
            Successful(before, previous, opening); Successful(next, current, opening); Successful(after, previous, opening);
            Equal(PreparedKey(before), PreparedKey(next)); Equal(PreparedKey(before), PreparedKey(after)); await session.Finish();
        });
    }
}
