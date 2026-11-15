using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Adapter;
using PathFinder.Barriers;
using static Fixtures;

var checks = new List<object>(); var geometryEvidence = new List<object>(); int failed = 0;
void Run(string name, Action body) { try { body(); checks.Add(new { name, status = "PASS" }); } catch (Exception e) { failed++; checks.Add(new { name, status = "FAIL", detail = e.Message }); } }
void Need(bool value, string message = "Assertion failed") { if (!value) throw new InvalidOperationException(message); }
void Near(double expected, double actual) => Need(Math.Abs(expected - actual) < 1e-9, $"Expected {expected}, got {actual}");
void Reject(string text, string code) { try { ManualOrderedRoute.Parse(text); } catch (ArgumentException e) { Need(e.Message.Contains(code)); return; } throw new InvalidOperationException("Expected rejection: " + code); }
RouteCollisionQuery clear = (_, _, _) => new(RouteCollisionStatus.Clear, null, "Checked clear fixture.", 1);
RoutingOptions Options(double secondary = 2) => new() { ConnectionToleranceMeters = .01, SampleSpacingMeters = .125, SecondaryDistanceMeters = secondary,
    PreferVerticalApproach = false, MaxGraphNodes = 100000, MaxGraphConnections = 300000 };
LocalApproachRouteEvaluation Calc(TraySegment[] trays, string text, RoutePoint from, RoutePoint to, RouteCollisionQuery? oracle = null,
    ConstrainedRoutingLimits? limits = null, bool drill = false, CancellationToken token = default) => new RouteCalculator().CalculateManualOrdered(trays, text, from, to,
        CableCategory.Control, oracle ?? clear, Options(), limits, drillThroughWalls: drill, cancellationToken: token);
ProjectSettingsSnapshot settings = new() { Revision = "1", SecondaryTrayLength = 7, EndConnectionLength = 6, AdditionalBendingPercent = 10 };
TraySegment[] Chain() => [Tray("A", P(0), P(2)), Tray("B", P(2), P(4)), Tray("C", P(4), P(6))];

Run("parser preserves nonadjacent physical occurrences and terminal approach notation", () => {
    Need(ManualOrderedRoute.Parse(" /SECONDARY/a/B/a/SECONDARY ").SequenceEqual(new[] { "/A", "/B", "/A" }));
});
foreach (var pair in new[] { ("/A/A", "ADJACENT_REPEAT"), ("/A/SECONDARY/B", "INTERIOR_SECONDARY"), ("/SECONDARY", "PHYSICAL_TRAY_REQUIRED"),
    ("/SECONDARY/SECONDARY", "PHYSICAL_TRAY_REQUIRED"), ("/A\0/B", "INVALID_TOKEN"), (string.Join('/', Enumerable.Repeat("A/B", 51)), "CODE_LIMIT"), (new string('A', 16385), "TEXT_REQUIRED_OR_LIMIT") })
    Run("parser rejects unsupported manual semantics " + pair.Item2, () => Reject(pair.Item1, pair.Item2));

Run("single required tray uses partial length plus real equipment approaches", () => {
    var r = Calc([Tray("A", P(0), P(10))], "/A", P(2, -1), P(8, 1)).RouteEvaluation;
    Need(r.Route.Success, r.Reason); Near(8, r.Route.LengthMeters); Near(1, r.Route.FromDistanceMeters); Near(1, r.Route.ToDistanceMeters);
    Need(r.Route.PathPoints[0].X == 2 && r.Route.PathPoints[^1].X == 8);
    Need(r.FinalChecks.Count == r.Route.PathPoints.Count - 1);
});
Run("same endpoint geometry uses identical ordinary length formula and ledger", () => {
    var trays = Chain(); var from = P(.5, -1); var to = P(5.5, 1);
    var manual = Calc(trays, "/A/B/C", from, to).RouteEvaluation.Route;
    var automatic = new RouteCalculator().CalculateConstrainedWithLocalApproaches(trays, from, to, CableCategory.Control, clear, Options()).RouteEvaluation.Route;
    Need(manual.Success && automatic.Success); Near(automatic.LengthMeters, manual.LengthMeters);
    var m = LengthLedgerObserver.Calculate(manual, settings); var a = LengthLedgerObserver.Calculate(automatic, settings);
    Need(m.Design.DesignLengthMeters == a.Design.DesignLengthMeters);
    Need(JsonSerializer.Serialize(m.Ledger) == JsonSerializer.Serialize(a.Ledger));
});
Run("mandatory middle tray cannot be skipped by a shorter unlisted route", () => {
    TraySegment[] trays = [Tray("A", P(0), P(3)), Tray("B", P(3), P(3, 5)), Tray("C", P(3, 5), P(6, 5)), Tray("D", P(0), P(6, 5))];
    var r = Calc(trays, "/A/B/C", P(0), P(6, 5)).RouteEvaluation.Route;
    Need(r.Success); Need(r.RouteText == "/A/B/C", r.RouteText); Near(11, r.LengthMeters);
    Need(!r.RouteText.Contains("/D"));
});
Run("nonadjacent repeat traverses physical intermediate tray instead of zero distance label hopping", () => {
    TraySegment[] trays = [Tray("A", P(0), P(4)), Tray("B", P(2), P(2, 2))];
    var r = Calc(trays, "/A/B/A", P(0), P(4)).RouteEvaluation.Route;
    Need(r.Success, r.Message); Need(r.RouteText == "/A/B/A", r.RouteText); Need(r.LengthMeters > 4, "B must contribute real distance");
});
Run("missing renamed category-restricted and capacity-filtered required trays refuse", () => {
    var missing = Calc(Chain(), "/A/MISSING/C", P(0), P(6)).RouteEvaluation;
    Need(!missing.Route.Success && missing.Reason == "MANUAL_ROUTE_REQUIRED_TRAY_UNAVAILABLE"); Need(missing.Route.Message.Contains("/MISSING"));
    TraySegment[] restricted = [Tray("A", P(0), P(2)), new("B", "/B", CableCategory.LV, new[] { P(2), P(4) }), Tray("C", P(4), P(6))];
    Need(!Calc(restricted, "/A/B/C", P(0), P(6)).RouteEvaluation.Route.Success);
    var filtered = CapacityRouting.Filter(Chain(), new[] { "/B" }).ToArray();
    Need(!Calc(filtered, "/A/B/C", P(0), P(6)).RouteEvaluation.Route.Success);
});
Run("disconnected mandatory trays do not become a free routing result", () => {
    var r = Calc([Tray("A", P(0), P(2)), Tray("B", P(10), P(12))], "/A/B", P(0), P(12), drill: true).RouteEvaluation;
    Need(!r.Route.Success);
});
Run("registered actual closed mesh blocks crossing and keeps no valid length", () => {
    var kernel = Kernel(Box("wall", 2.9, 3.1, -10, 10, -10, 10));
    RouteCollisionQuery oracle = (from, to, token) => { var check = kernel.CheckSegment(B(from), B(to), token);
        return new(check.Status == BarrierSegmentStatus.Clear ? RouteCollisionStatus.Clear : check.Status == BarrierSegmentStatus.Blocked ? RouteCollisionStatus.Blocked : RouteCollisionStatus.Indeterminate,
            check.BarrierId, check.Reason, check.Work); };
    var r = Calc(Chain(), "/A/B/C", P(0), P(6), oracle).RouteEvaluation;
    Need(!r.Route.Success, "Must not cross the wall or silently substitute another route");
});
Run("indeterminate queries cannot produce a checked manual route", () => {
    Need(!Calc(Chain(), "/A/B/C", P(0), P(6), (_, _, _) => new(RouteCollisionStatus.Indeterminate, null, "Unavailable fixture.", 1)).RouteEvaluation.Route.Success);
});
Run("endpoint in registered material is refused independently of mandatory tray availability", () => {
    var kernel = Kernel(Box("endpoint", -.25, .25, -.25, .25, -.25, .25));
    RouteCollisionQuery oracle = (from, to, token) => { var check = kernel.CheckSegment(B(from), B(to), token);
        return new(check.Status == BarrierSegmentStatus.Clear ? RouteCollisionStatus.Clear : check.Status == BarrierSegmentStatus.Blocked ? RouteCollisionStatus.Blocked : RouteCollisionStatus.Indeterminate,
            check.BarrierId, check.Reason, check.Work); };
    var r = Calc([Tray("A", P(1), P(6))], "/A", P(0), P(6), oracle).RouteEvaluation;
    Need(!r.Route.Success && r.Reason == "FROM_ENDPOINT_IN_BARRIER", r.Reason);
});
foreach (var example in new[] {
    (RouteCollisionStatus.Blocked, RouteCollisionStatus.Clear, "FROM_ENDPOINT_IN_BARRIER"),
    (RouteCollisionStatus.Clear, RouteCollisionStatus.Blocked, "TO_ENDPOINT_IN_BARRIER"),
    (RouteCollisionStatus.Blocked, RouteCollisionStatus.Blocked, "BOTH_ENDPOINTS_IN_BARRIER"),
    (RouteCollisionStatus.Blocked, RouteCollisionStatus.Indeterminate, "ENDPOINT_IN_BARRIER"),
    (RouteCollisionStatus.Indeterminate, RouteCollisionStatus.Blocked, "ENDPOINT_IN_BARRIER") })
    Run("manual endpoint diagnostic preserves exact side evidence " + example, () => {
        var from = P(0); var to = P(6); var observedFrom = false; var observedTo = false;
        RouteCollisionQuery oracle = (a, b, _) => {
            var same = a.X == b.X && a.Y == b.Y && a.Z == b.Z;
            var status = RouteCollisionStatus.Blocked;
            if (same && a.X == from.X) { observedFrom = true; status = example.Item1; }
            else if (same && a.X == to.X) { observedTo = true; status = example.Item2; }
            else if (same) status = RouteCollisionStatus.Clear;
            return new(status, null, "Synthetic exact occupancy observation.", 1);
        };
        var value = Calc([Tray("A", P(1), P(5))], "/A", from, to, oracle).RouteEvaluation;
        Need(!value.Route.Success && observedFrom && observedTo, value.Reason);
        Need(value.Reason == example.Item3, value.Reason);
    });
Run("bypass is explicit and keeps ordered mandatory traversals", () => {
    var r = Calc(Chain(), "/A/B/C", P(0), P(6), (_, _, _) => new(RouteCollisionStatus.Blocked, "wall", "Blocked fixture.", 1), drill: true).RouteEvaluation;
    Need(r.Route.Success && r.Status == ConstrainedRouteStatus.Bypassed); Need(r.Route.RouteText == "/A/B/C");
});
Run("SECONDARY ends use real measured approaches and normal reserve replacement", () => {
    var r = Calc([Tray("A", P(0), P(10))], "/SECONDARY/A/SECONDARY", P(2, -3), P(8, 4)).RouteEvaluation.Route;
    Need(r.Success && r.FromRequiresSecondary && r.ToRequiresSecondary); Near(13, r.LengthMeters);
    var observed = LengthLedgerObserver.Calculate(r, settings);
    Need(observed.Ledger.SecondaryEnds == 2); Need(observed.Design.DesignLengthMeters == 29);
});
Run("BC182 mandatory used span expands five to seven metres and full native design changes thirty-two to thirty-five", () => {
    const string manualText = "/A/BC182/C";
    var five = Tray("BC182", P(0), P(5));
    // Add two actual one-metre sections while preserving both connection ports.
    // No other tray, equipment point, routing option or formula input changes.
    var seven = Tray("BC182", P(0), P(0, 1), P(5, 1), P(5));
    var a = Tray("A", P(-2), P(0)); var c = Tray("C", P(5), P(7));
    var from = P(-2, -3); var to = P(7, 4);
    Near(5, five.Points.Zip(five.Points.Skip(1), (first, last) => first.DistanceTo(last)).Sum());
    Near(7, seven.Points.Zip(seven.Points.Skip(1), (first, last) => first.DistanceTo(last)).Sum());
    var before = Calc([a, five, c], manualText, from, to).RouteEvaluation;
    var after = Calc([a, seven, c], manualText, from, to).RouteEvaluation;
    Need(before.Route.Success && after.Route.Success, before.Reason + " / " + after.Reason);
    Need(ManualOrderedRoute.Parse(before.Route.RouteText).SequenceEqual(ManualOrderedRoute.Parse(manualText)));
    Need(before.Route.RouteText == after.Route.RouteText && before.Route.RouteText == "/SECONDARY/A/BC182/C/SECONDARY");
    Near(16, before.Route.LengthMeters); Near(18, after.Route.LengthMeters);
    foreach (var value in new[] { before, after }) {
        Near(3, value.Route.FromDistanceMeters); Near(4, value.Route.ToDistanceMeters);
        Need(value.Route.FromRequiresSecondary && value.Route.ToRequiresSecondary);
        Need(value.FinalChecks.Count == value.Route.PathPoints.Count - 1);
        Near(value.Route.LengthMeters, value.Route.PathPoints.Zip(value.Route.PathPoints.Skip(1), (first, last) => first.DistanceTo(last)).Sum());
    }
    Need(after.Route.PathPoints.Any(point => point.X == 0 && point.Y == 1) && after.Route.PathPoints.Any(point => point.X == 5 && point.Y == 1));
    var oldLength = LengthLedgerObserver.Calculate(before.Route, settings); var newLength = LengthLedgerObserver.Calculate(after.Route, settings);
    Need(oldLength.Ledger.RawLengthDecimalMeters == "16" && newLength.Ledger.RawLengthDecimalMeters == "18");
    Need(oldLength.Ledger.From.RemovedApproachMeters == "3" && oldLength.Ledger.To.RemovedApproachMeters == "4");
    Need(newLength.Ledger.From.RemovedApproachMeters == "3" && newLength.Ledger.To.RemovedApproachMeters == "4");
    Need(oldLength.Ledger.SecondaryEnds == 2 && newLength.Ledger.SecondaryEnds == 2);
    Need(oldLength.Ledger.ReplacementMeters == "14" && newLength.Ledger.ReplacementMeters == "14");
    Need(oldLength.Ledger.BeforeClampMeters == "9" && newLength.Ledger.BeforeClampMeters == "11");
    Need(oldLength.Ledger.BeforePercentageMeters == "29" && newLength.Ledger.BeforePercentageMeters == "31");
    Need(oldLength.Ledger.BendingIncrementMeters == "2.9" && newLength.Ledger.BendingIncrementMeters == "3.1");
    Need(oldLength.Ledger.UnroundedMeters == "31.9" && newLength.Ledger.UnroundedMeters == "34.1");
    Need(oldLength.Ledger.CeilingIncrementMeters == "0.1" && newLength.Ledger.CeilingIncrementMeters == "0.9");
    Need(oldLength.Design.DesignLengthMeters == 32 && newLength.Design.DesignLengthMeters == 35);
    geometryEvidence.Add(new { scenario = "BC182-used-mandatory-span", manualText, manualInputUnchanged = true,
        beforeTrayMetres = 5, afterTrayMetres = 7, before = oldLength.Ledger, after = newLength.Ledger });
});
Run("BC182 straight extension recomputes the actual approach and secondary threshold instead of adding nominal metres", () => {
    var five = Calc([Tray("BC182", P(0), P(5))], "/BC182", P(0, -1), P(7, 1)).RouteEvaluation.Route;
    var seven = Calc([Tray("BC182", P(0), P(7))], "/BC182", P(0, -1), P(7, 1)).RouteEvaluation.Route;
    Need(five.Success && seven.Success); Near(6 + Math.Sqrt(5), five.LengthMeters); Near(9, seven.LengthMeters);
    Near(Math.Sqrt(5), five.ToDistanceMeters); Near(1, seven.ToDistanceMeters);
    Need(five.ToRequiresSecondary && !seven.ToRequiresSecondary);
    Need(ManualOrderedRoute.Parse(five.RouteText).SequenceEqual(new[] { "/BC182" }) && ManualOrderedRoute.Parse(seven.RouteText).SequenceEqual(new[] { "/BC182" }));
    var before = LengthLedgerObserver.Calculate(five, settings); var after = LengthLedgerObserver.Calculate(seven, settings);
    Need(before.Ledger.BeforePercentageMeters == "19" && before.Ledger.UnroundedMeters == "20.9" && before.Design.DesignLengthMeters == 21);
    Need(after.Ledger.BeforePercentageMeters == "15" && after.Ledger.UnroundedMeters == "16.5" && after.Design.DesignLengthMeters == 17);
    geometryEvidence.Add(new { scenario = "BC182-straight-extension-secondary-threshold", manualText = "/BC182", manualInputUnchanged = true,
        beforeTrayMetres = 5, afterTrayMetres = 7, before = before.Ledger, after = after.Ledger });
});
Run("BC182 extension outside the used partial span leaves the full native ledger and design unchanged", () => {
    const string manualText = "/BC182";
    var from = P(1, -3); var to = P(3, 4);
    var before = Calc([Tray("BC182", P(0), P(5))], manualText, from, to).RouteEvaluation.Route;
    var after = Calc([Tray("BC182", P(0), P(7))], manualText, from, to).RouteEvaluation.Route;
    Need(before.Success && after.Success); Near(9, before.LengthMeters); Near(9, after.LengthMeters);
    Need(before.RouteText == after.RouteText && before.RouteText == "/SECONDARY/BC182/SECONDARY");
    Need(JsonSerializer.Serialize(before.PathPoints) == JsonSerializer.Serialize(after.PathPoints));
    var oldLength = LengthLedgerObserver.Calculate(before, settings); var newLength = LengthLedgerObserver.Calculate(after, settings);
    Need(JsonSerializer.Serialize(oldLength.Ledger) == JsonSerializer.Serialize(newLength.Ledger));
    Need(oldLength.Ledger.BeforeClampMeters == "2" && oldLength.Ledger.ReplacementMeters == "14");
    Need(oldLength.Ledger.BeforePercentageMeters == "22" && oldLength.Ledger.UnroundedMeters == "24.2");
    Need(oldLength.Design.DesignLengthMeters == 25 && newLength.Design.DesignLengthMeters == 25);
    geometryEvidence.Add(new { scenario = "BC182-extension-outside-used-partial-span", manualText, manualInputUnchanged = true,
        beforeTrayMetres = 5, afterTrayMetres = 7, usedPhysicalTrayMetres = 2, before = oldLength.Ledger, after = newLength.Ledger });
});
Run("resource ceiling and cancellation remain bounded", () => {
    var r = Calc(Chain(), "/A/B/C", P(0), P(6), limits: new() { MaxWork = 1 }).RouteEvaluation;
    Need(!r.Route.Success && r.Reason == "SEARCH_WORK_LIMIT");
    using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
    try { Calc(Chain(), "/A/B/C", P(0), P(6), token: cancelled.Token); } catch (OperationCanceledException) { return; }
    throw new InvalidOperationException("Cancellation was ignored");
});
Run("manual ordered path repairs only inter-tray chord through a real opening and checks all final legs", () => {
    var kernel = Kernel(Opening());
    TraySegment[] trays = [new("A", "/A", CableCategory.Control, new[] { P(-1, 0, -.815), P(-.1, 0, -.815) }, true),
        new("B", "/B", CableCategory.Control, new[] { P(.3, 0, -.775), P(1, 0, -.775) }, true),
        Tray("UNLISTED-SHORTCUT", P(-1, 0, -.815), P(1, 0, -.775))];
    RouteCollisionQuery oracle = (from, to, token) => { var check = kernel.CheckSegment(B(from), B(to), token);
        return new(check.Status == BarrierSegmentStatus.Clear ? RouteCollisionStatus.Clear : check.Status == BarrierSegmentStatus.Blocked ? RouteCollisionStatus.Blocked : RouteCollisionStatus.Indeterminate,
            check.BarrierId, check.Reason, check.Work); };
    var options = Options(); options.ConnectionToleranceMeters = .5;
    var r = new RouteCalculator().CalculateManualOrdered(trays, "/A/B", trays[0].Points[0], trays[1].Points[1], CableCategory.Control, oracle,
        options, localOptions: new() { MaxStraightPairs = 1, MaxPlans = 1, MaxNodes = 2 }, interTrayManeuvers: true).RouteEvaluation;
    Need(r.Route.Success, r.Reason); Need(r.Route.RouteText == "/A/B"); Need(r.Reason.Contains("INTER_TRAY_OPENING_MANEUVER_V1"));
    Need(r.Route.PathPoints.Count >= 6); Near(r.Route.PathPoints.Zip(r.Route.PathPoints.Skip(1), (a, b) => a.DistanceTo(b)).Sum(), r.Route.LengthMeters);
    Need(r.FinalChecks.Count == r.Route.PathPoints.Count - 1);
    foreach (var pair in r.Route.PathPoints.Zip(r.Route.PathPoints.Skip(1))) Need(kernel.CheckSegment(B(pair.First), B(pair.Second)).Status == BarrierSegmentStatus.Clear);
});
Run("blocked straight equipment approach can use checked local detour without changing mandatory code", () => {
    var kernel = Kernel(Opening()); var from = P(-.75, 1); var to = P(.75, 1.5);
    RouteCollisionQuery oracle = (a, b, token) => { var check = kernel.CheckSegment(B(a), B(b), token);
        return new(check.Status == BarrierSegmentStatus.Clear ? RouteCollisionStatus.Clear : check.Status == BarrierSegmentStatus.Blocked ? RouteCollisionStatus.Blocked : RouteCollisionStatus.Indeterminate,
            check.BarrierId, check.Reason, check.Work); };
    var r = new RouteCalculator().CalculateManualOrdered([Tray("A", P(.75, 1), to)], "/A", from, to, CableCategory.Control, oracle, Options(),
        localOptions: new() { UseNearestAnchoredSearch = true });
    Need(r.RouteEvaluation.Route.Success, r.RouteEvaluation.Reason); Need(r.FromConnector is not null && r.FromConnector.IsDetour, "From local plan must detour");
    Need(ManualOrderedRoute.Parse(r.RouteEvaluation.Route.RouteText).SequenceEqual(new[] { "/A" }), r.RouteEvaluation.Route.RouteText);
    Need(r.RouteEvaluation.FinalChecks.Count == r.RouteEvaluation.Route.PathPoints.Count - 1, "Final checks must match the polyline");
    foreach (var pair in r.RouteEvaluation.Route.PathPoints.Zip(r.RouteEvaluation.Route.PathPoints.Skip(1))) Need(kernel.CheckSegment(B(pair.First), B(pair.Second)).Status == BarrierSegmentStatus.Clear);
});
Run("shared native deadline refuses a delayed query without producing a length", () => {
    RouteCollisionQuery slow = (_, _, _) => { Thread.Sleep(25); return new(RouteCollisionStatus.Clear, null, "Delayed clear fixture.", 1); };
    var r = Calc(Chain(), "/A/B/C", P(0), P(6), slow, new() { TimeoutMilliseconds = 1 }).RouteEvaluation;
    Need(!r.Route.Success && r.Reason == "SEARCH_DEADLINE_EXCEEDED", r.Reason);
});
Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "wfc.pf.manual-ordered-native-checks.v1", status = failed == 0 ? "PASS" : "FAIL", passed = checks.Count - failed, failed, checks, geometryEvidence }));
return failed == 0 ? 0 : 1;
