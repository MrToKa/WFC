using System.Text.Json.Nodes;
using static MixedRuntimeFixtures;

internal static partial class Program
{
    // Independent frozen protocol fixture, without production profile constants.
    private static JsonObject ExpandedCandidatesContext(JsonObject original)
    {
        var context = RetainedPairsContext(original);
        context["profile"]!["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v8";
        context["profile"]!["routing"]!["maxCandidatesPerEnd"] = 64;
        context["profile"]!["routing"]!["maxPairs"] = 4104;
        ProfileHash(context); return context;
    }
    private static async Task ExpandedCandidatesProfileTransport(string runner, string root)
    {
        var request = Fixtures.Request(root, [(-3, 3, 0, .1)]);
        request["from"] = Fixtures.Point(-2); request["to"] = Fixtures.Point(2);
        var opening = Store(root, Ring()); var current = ExpandedCandidatesContext(opening.Context);
        await Check("v8 preserves v7 measured preparation and exact checked route", async () => {
            var previous = await OneShot(runner, root, Protected(request, RetainedPairsContext(opening.Context)));
            var next = await OneShot(runner, root, Protected(request, current));
            Successful(previous, RetainedPairsContext(opening.Context), opening); Successful(next, current, opening);
            Equal(PreparedKey(previous), PreparedKey(next)); Equal(RouteHash(Points(previous)), RouteHash(Points(next)));
            var explicitRules = Protected(request, current); explicitRules["rules"] = Rules("pf2.rules.v2");
            var explicitResult = await OneShot(runner, root, explicitRules); Successful(explicitResult, current, opening);
            Equal(PreparedKey(next), PreparedKey(explicitResult));
        });
        foreach (var change in new[] { (Candidates: 16, Pairs: 4104), (Candidates: 63, Pairs: 4104),
            (Candidates: 65, Pairs: 4104), (Candidates: 64, Pairs: 264), (Candidates: 64, Pairs: 4103), (Candidates: 64, Pairs: 4105) })
            await Check($"v8 refuses rehashed altered search limits {change.Candidates}/{change.Pairs}", async () => {
                var changed = current.DeepClone().AsObject(); changed["profile"]!["routing"]!["maxCandidatesPerEnd"] = change.Candidates;
                changed["profile"]!["routing"]!["maxPairs"] = change.Pairs; ProfileHash(changed);
                Refused(await OneShot(runner, root, Protected(request, changed)), false);
            });
        await Check("v8 cannot borrow the historical v7 profile digest", async () => {
            var changed = current.DeepClone().AsObject(); changed["profileSha256"] = RetainedPairsContext(opening.Context)["profileSha256"]!.DeepClone();
            Refused(await OneShot(runner, root, Protected(request, changed)), false);
        });
        await Check("v8 refuses rules1 before prepared cache admission", async () => {
            var freshRoot = Path.Combine(root, "v8-rules1-refusal"); var fresh = Fixtures.Request(freshRoot, [(-3, 3, 0, .1)]);
            var stored = Store(freshRoot, Ring()); var bad = Protected(fresh, ExpandedCandidatesContext(stored.Context)); bad["rules"] = Rules("pf2.rules.v1");
            var result = await OneShot(runner, freshRoot, bad); Refused(result);
            Need(result.GetProperty("message").GetString()!.Contains("requires explicit rules v2", StringComparison.Ordinal));
            Need(!Directory.Exists(Path.Combine(freshRoot, "cache")));
        });
        await Check("v8 retains actual material refusal without drilling", async () => {
            var wall = Store(root, Wall()); Refused(await OneShot(runner, root, Protected(request, ExpandedCandidatesContext(wall.Context))));
        });
        await Check("v8 reaches From candidate rank41 while v7 exhausts its retained sixteen", async () => {
            var spans = new List<(double, double, double, double)>();
            for (int rank = 0; rank < 41; rank++) spans.Add((-.4, .4, rank * .7, .1));
            for (int rank = 0; rank < 64; rank++) spans.Add((99.6, 100.4, (rank + 1) * .7, .1));
            spans.Add((98.6, 99.4, 0, .1));
            var dense = Fixtures.Request(root, spans.ToArray()); dense["from"] = Fixtures.Point(0); dense["to"] = Fixtures.Point(100);
            var remote = Store(root, Fixtures.Transform(Wall(), p => Fixtures.P(p.X + 1000, p.Y, p.Z)));
            var historical = RetainedPairsContext(remote.Context);
            var old = await OneShot(runner, root, Protected(dense, historical)); Refused(old);
            Equal("LOCAL_CANDIDATE_DOMAIN_EXHAUSTED", Execution(old).GetProperty("diagnostics").GetProperty("reasonCode").GetString());
            Need(Execution(old).GetProperty("diagnostics").GetProperty("candidatesTruncated").GetBoolean());
            Equal(264, Execution(old).GetProperty("diagnostics").GetProperty("pairAttempts").GetInt32());
            var expanded = ExpandedCandidatesContext(remote.Context);
            var next = await OneShot(runner, root, Protected(dense, expanded)); Successful(next, expanded, remote);
            int attempts = Execution(next).GetProperty("diagnostics").GetProperty("pairAttempts").GetInt32();
            Need(attempts > 64 && attempts <= 4104, "The regression must exercise the expanded candidate domain.");
        });
        await Check("warm session keeps v7-v8-v7 dispatch and measured preparation exact", async () => {
            using var session = await Session.Start(runner, root); var previous = RetainedPairsContext(opening.Context);
            var before = await session.Query(Protected(request, previous)); var next = await session.Query(Protected(request, current));
            var after = await session.Query(Protected(request, previous));
            Successful(before, previous, opening); Successful(next, current, opening); Successful(after, previous, opening);
            Equal(PreparedKey(before), PreparedKey(next)); Equal(PreparedKey(before), PreparedKey(after)); await session.Finish();
        });
    }
}
