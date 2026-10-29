using System.Text.Json;
using System.Text.Json.Nodes;
using static MixedRuntimeFixtures;

internal static partial class Program
{
    // Independently specified protocol fixture; never import production constants.
    private static JsonObject OpeningContext(JsonObject original)
    {
        var context = original.DeepClone().AsObject();
        context["profile"]!["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v3";
        context["profile"]!["interTrayManeuvers"] = JsonNode.Parse("""
        {"policyVersion":"wfc.pf.inter-tray-opening-maneuvers.v1","maximumOffsetMetres":0.1,"radiiMetres":[0.05,0.1],"directionVersion":"normalized-lexicographic-26.v1","maximumEdgeAttempts":64,"candidateCount":52,"domain":"blocked-inter-tray-chords-only","selection":"legacy-clear-upper-bound-lazy-selected-path.v1"}
        """);
        ProfileHash(context); return context;
    }
    private static void ProfileHash(JsonObject context) => context["profileSha256"] = Fixtures.Hash(Fixtures.Canonical(context["profile"]));
    private static JsonObject NearestAnchoredContext(JsonObject original)
    {
        var context = LargeSelectionContext(original); context["profile"]!["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v5";
        context["profile"]!["localSearch"] = JsonNode.Parse("""
        {"policyVersion":"wfc.pf.nearest-anchored-local-search.v1","pairOrder":"nearest-anchored-axes-then-rank-sum.v1","exactStraightPreflight":true}
        """);
        ProfileHash(context); return context;
    }
    private static async Task NearestAnchoredProfileTransport(string runner, string root)
    {
        var request = Fixtures.Request(root, [(-3, 3, 0, .1)]);
        request["from"] = Fixtures.Point(-2); request["to"] = Fixtures.Point(2);
        var opening = Store(root, Ring()); var current = NearestAnchoredContext(opening.Context);
        await Check("v5 exact local search profile authenticates original geometry and unchanged clear routes", async () => {
            var old = await OneShot(runner, root, Protected(request, LargeSelectionContext(opening.Context)));
            var next = await OneShot(runner, root, Protected(request, current));
            Successful(old, LargeSelectionContext(opening.Context), opening); Successful(next, current, opening);
            Equal(RouteHash(Points(old)), RouteHash(Points(next)));
            Equal(old.GetProperty("route").GetProperty("lengthMeters").GetDouble(), next.GetProperty("route").GetProperty("lengthMeters").GetDouble());
        });
        await Check("v5 retains original material refusal without drilling", async () => {
            var wall = Store(root, Wall()); Refused(await OneShot(runner, root, Protected(request, NearestAnchoredContext(wall.Context))));
        });
        foreach (var corruption in new[] { "order", "preflight", "policy", "extra", "missing" })
            await Check("rehashed v5 rejects local search profile corruption: " + corruption, async () => {
                var changed = current.DeepClone().AsObject(); var search = changed["profile"]!["localSearch"]!.AsObject();
                if (corruption == "order") search["pairOrder"] = "rank-sum";
                else if (corruption == "preflight") search["exactStraightPreflight"] = false;
                else if (corruption == "policy") search["policyVersion"] = "unreviewed.v2";
                else if (corruption == "extra") search["skipBarrierChecks"] = true;
                else changed["profile"]!.AsObject().Remove("localSearch");
                ProfileHash(changed); Refused(await OneShot(runner, root, Protected(request, changed)), false);
            });
        await Check("v5 cannot borrow a historical profile digest", async () => {
            var changed = current.DeepClone().AsObject(); changed["profileSha256"] = LargeSelectionContext(opening.Context)["profileSha256"]!.DeepClone();
            Refused(await OneShot(runner, root, Protected(request, changed)), false);
        });
        await Check("warm session keeps v2 through v5 explicit dispatch isolated", async () => {
            using var session = await Session.Start(runner, root);
            foreach (var context in new[] { opening.Context, OpeningContext(opening.Context), LargeSelectionContext(opening.Context), current, LargeSelectionContext(opening.Context), opening.Context })
                Successful(await session.Query(Protected(request, context)), context, opening);
            await session.Finish();
        });
    }
    private static async Task InterTrayProfileTransport(string runner, string root)
    {
        var request = Fixtures.Request(root, [(-3, 3, 0, .1)]);
        request["from"] = Fixtures.Point(-2); request["to"] = Fixtures.Point(2);
        var opening = Store(root, Ring()); var context = OpeningContext(opening.Context);
        await Check("explicit v3 opening profile authenticates actual original geometry", async () =>
            Successful(await OneShot(runner, root, Protected(request, context)), context, opening));
        await Check("v3 dispatch executes a checked inter-tray maneuver through an actual opening", async () => {
            var split = Fixtures.Request(root, [(-2, -.1, 0, .1), (.1, 2, 0, .1)]);
            split["from"] = Fixtures.Point(-1.5, 0, .1); split["to"] = Fixtures.Point(1.5, 0, .1);
            // Opening sill is z=.15; the unmodified z=.1 inter-tray chord hits material.
            var stored = Store(root, Fixtures.Transform(Ring(), p => Fixtures.P(p.X, p.Y, p.Z * .75 + .75)));
            var current = OpeningContext(stored.Context);
            var value = await OneShot(runner, root, Protected(split, current)); Successful(value, current, stored);
            Need(Execution(value).GetProperty("diagnostics").GetProperty("reasonCode").GetString()!.Contains("INTER_TRAY_OPENING_MANEUVER_V1", StringComparison.Ordinal));
            var points = Points(value); Need(points.Any(p => p.Z > .15), "Actual route must rise above the material sill.");
            double length = 0;
            for (int i = 1; i < points.Length; i++) length += Math.Sqrt(Math.Pow(points[i].X - points[i - 1].X, 2) + Math.Pow(points[i].Y - points[i - 1].Y, 2) + Math.Pow(points[i].Z - points[i - 1].Z, 2));
            Need(Math.Abs(length - value.GetProperty("route").GetProperty("lengthMeters").GetDouble()) < 1e-12, "Returned length must include the actual maneuver.");
        });
        await Check("v2 and opt-in v3 retain identical already-clear route points and length", async () => {
            var old = await OneShot(runner, root, Protected(request, opening.Context));
            var current = await OneShot(runner, root, Protected(request, context));
            Successful(old, opening.Context, opening); Successful(current, context, opening);
            Equal(RouteHash(Points(old)), RouteHash(Points(current)));
            Equal(old.GetProperty("route").GetProperty("lengthMeters").GetDouble(), current.GetProperty("route").GetProperty("lengthMeters").GetDouble());
        });
        await Check("v3 never bends a blocked within-tray edge through a solid wall", async () => {
            var stored = Store(root, Wall()); Refused(await OneShot(runner, root, Protected(request, OpeningContext(stored.Context))));
        });
        foreach (var corruption in new[] { "offset", "radius", "field", "missing" })
            await Check("rehashed v3 rejects maneuver profile corruption: " + corruption, async () => {
                var changed = context.DeepClone().AsObject(); var profile = changed["profile"]!["interTrayManeuvers"]!.AsObject();
                if (corruption == "offset") profile["maximumOffsetMetres"] = .100000001;
                else if (corruption == "radius") profile["radiiMetres"]![0] = .075;
                else if (corruption == "field") profile["ignoreWallContact"] = true;
                else profile.Remove("maximumEdgeAttempts");
                ProfileHash(changed); Refused(await OneShot(runner, root, Protected(request, changed)), false);
            });
        await Check("v3 cannot reuse an older profile digest", async () => {
            var changed = context.DeepClone().AsObject(); changed["profileSha256"] = opening.Context["profileSha256"]!.DeepClone();
            Refused(await OneShot(runner, root, Protected(request, changed)), false);
        });
        await Check("v3 drilling retains exact legacy bypass and claims no physical checks", async () => {
            var stored = Store(root, Wall(), true); var current = OpeningContext(stored.Context);
            var old = await OneShot(runner, root, Protected(request, stored.Context));
            var value = await OneShot(runner, root, Protected(request, current));
            Successful(old, stored.Context); Successful(value, current);
            Equal(RouteHash(Points(old)), RouteHash(Points(value)));
            Equal(0, Execution(value).GetProperty("proof").GetProperty("checkedSegments").GetInt32());
            Equal("bypassed", Execution(value).GetProperty("proof").GetProperty("status").GetString());
        });
        await Check("warm session alternates exact v2 and v3 contexts without profile leakage", async () => {
            using var session = await Session.Start(runner, root);
            Successful(await session.Query(Protected(request, opening.Context)), opening.Context, opening);
            Successful(await session.Query(Protected(request, context)), context, opening);
            Successful(await session.Query(Protected(request, opening.Context)), opening.Context, opening);
            await session.Finish();
        });
    }
}
