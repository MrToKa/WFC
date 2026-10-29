using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using AddinRibbon.Routing;

internal static class RouteLookupTests
{
    internal static void Run(Action<string, Action> run)
    {
        run("Lookup parsing ignores every case-insensitive SECONDARY and preserves re-entry", Parsing);
        run("Lookup parsing reports empty, marker-only and malformed input", InvalidParsing);
        run("Lookup follows entered codes despite a shorter unlisted shortcut", OrderedRoutes);
        run("Lookup does not skip a listed route at an available direct contact", NoSkippedStage);
        run("Lookup selects only the required internal branch through a logical route", InternalBranch);
        run("Lookup single route follows every curve vertex between its unique ends", SingleRoute);
        run("Lookup main spans handle forks, tied ends and closed loops while rejecting disconnected geometry", AmbiguousEnds);
        run("Lookup reports every missing visible route name", MissingNames);
        run("Lookup names the failing pair and never uses an unlisted bridge", DisconnectedPair);
        run("Lookup uses current physical surface clearance and retains centreline connectors", PhysicalClearance);
        run("Lookup preserves nonconsecutive re-entry in its ordered result", Reentry);
        run("Lookup reverses route order and remains deterministic across requests", Reversal);
        run("Lookup handles cancellation, graph and ordered-state limits", LimitsAndCancellation);
    }

    private static RoutePoint P(double x, double y = 0, double z = 0) { return new RoutePoint(x, y, z); }
    private static TraySegment T(string id, string code, params RoutePoint[] points)
    { return new TraySegment(id, code, CableCategory.None, points); }
    private static void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static void Near(double expected, double actual, string message)
    { Assert(Math.Abs(expected - actual) < 1e-7, message + ": expected " + expected + ", got " + actual); }
    private static RouteResult Find(IEnumerable<TraySegment> trays, string text, double tolerance = .25, int nodes = 500000)
    { return RouteLookupCalculator.Calculate(trays, RouteLookupCalculator.Parse(text), new RoutingOptions { ConnectionToleranceMeters = tolerance, MaxGraphNodes = nodes }); }
    private static void Throws<TException>(Action action) where TException : Exception
    {
        try { action(); } catch (TException) { return; }
        throw new InvalidOperationException("Expected " + typeof(TException).Name);
    }
    private static void Parsing()
    {
        var codes = RouteLookupCalculator.Parse(" /Secondary/ c135 /SECONDARY/C134/secondary/C135/SECONDARY ");
        Assert(codes.SequenceEqual(new[] { "/C135", "/C134", "/C135" }), "Marker filtering or input order changed.");
        Assert(RouteLookupCalculator.Parse("\r\n/5ld04/\r\n5ld05-2/\r\n").SequenceEqual(new[] { "/5LD04", "/5LD05-2" }), "Paste whitespace or numeric-prefix labels failed.");
        Assert(RouteLookupCalculator.Parse("/C135/C135/C134").SequenceEqual(new[] { "/C135", "/C134" }), "Repeated adjacent labels describe one continuous route.");
    }
    private static void InvalidParsing()
    {
        foreach (string value in new[] { "", " ", "/secondary/SECONDARY", "/", "/C135 C134", "/C135;C134", "/C135/<C134>" })
            Throws<ArgumentException>(() => RouteLookupCalculator.Parse(value));
        Throws<ArgumentNullException>(() => RouteLookupCalculator.Calculate(null, new[] { "/C001" }));
    }
    private static TraySegment[] Network()
    {
        return new[] { T("start", "/C001", P(0), P(2)), T("bend", "/C002", P(2), P(2, 3), P(4, 3), P(4)),
            T("end", "/C003", P(4), P(6)), T("unlisted-shortcut", "/C999", P(2), P(4)) };
    }
    private static void OrderedRoutes()
    {
        var result = Find(Network(), "/SECONDARY/C001/C002/C003/Secondary", .05);
        Assert(result.Success, result.Message);
        Assert(result.RouteText == "/C001/C002/C003", "The entered sequence was changed.");
        Assert(!result.SegmentIds.Contains("unlisted-shortcut"), "An unlisted shorter route was used.");
        Near(12, result.LengthMeters, "All selected curve legs must remain.");
        Near(0, result.FromDistanceMeters + result.ToDistanceMeters, "Lookup invented equipment attachment legs.");
        Assert(!result.FromRequiresSecondary && !result.ToRequiresSecondary, "Lookup invented secondary legs.");
    }
    private static void NoSkippedStage()
    {
        var trays = new[] { T("start", "/C001", P(0), P(2)), T("middle", "/C002", P(2), P(2, 2), P(3, 2), P(3)),
            T("end", "/C003", P(3), P(5)) };
        var result = Find(trays, "/C001/C002/C003", 1.01);
        Assert(result.Success, result.Message);
        Assert(result.RouteText == "/C001/C002/C003" && result.SegmentIds.Contains("middle"), "A direct start/end gap skipped the listed middle route.");
        // Three labels can meet at one real joint. Naming the middle label must
        // not manufacture a branch excursion solely to give that stage length.
        var joint = Find(new[] { T("start", "/C001", P(-2), P(0)),
            T("joint-stage", "/C002", P(0), P(0, 4)), T("end", "/C003", P(0), P(2)) },
            "/C001/C002/C003", .05);
        Assert(joint.Success && joint.RouteText == "/C001/C002/C003", joint.Message);
        Assert(joint.SegmentIds.SequenceEqual(new[] { "start", "joint-stage", "end" }), "The entered physical-joint stage was lost.");
        Near(4, joint.LengthMeters, "A zero-length intermediate joint must not create a branch detour");
        Assert(joint.PathPoints.All(point => point.Y == 0), "Yellow line takes an artificial out-and-back trip down a joint branch.");
    }
    private static void InternalBranch()
    {
        var trays = new[] { T("start", "/C001", P(-2), P(0)), T("middle-left", "/C002", P(0), P(2)),
            T("middle-right", "/C002", P(2), P(4)), T("unused-branch", "/C002", P(2), P(2, 5)),
            T("end", "/C003", P(4), P(6)) };
        var result = Find(trays, "/C001/C002/C003", .05);
        Assert(result.Success, result.Message);
        Assert(result.SegmentIds.SequenceEqual(new[] { "start", "middle-left", "middle-right", "end" }), "Unused child branch was included.");
        Near(8, result.LengthMeters, "Branch-free route length");
        Assert(result.PathPoints.All(point => point.Y == 0), "Branch points entered the yellow line.");
        var outerFork = Find(new[] { T("start-left", "/C001", P(-4), P(0)),
            T("start-unused", "/C001", P(0), P(0, 1)), T("middle", "/C002", P(0), P(4)),
            T("end", "/C003", P(4), P(6)) }, "/C001/C002/C003", .05);
        Assert(outerFork.Success, outerFork.Message);
        Assert(outerFork.SegmentIds.SequenceEqual(new[] { "start-left", "middle", "end" }), "An outer fork must choose its farthest approach and omit its shorter spur.");
        Near(10, outerFork.LengthMeters, "Longest outer approach");
    }
    private static void SingleRoute()
    {
        var result = Find(new[] { T("a", "/5LD04", P(0), P(2), P(2, 2)), T("b", "/5LD04", P(2, 2), P(4, 2)) }, "/secondary/5ld04/SECONDARY", .05);
        Assert(result.Success, result.Message);
        Assert(result.RouteText == "/5LD04", "Single logical route name changed.");
        Near(6, result.LengthMeters, "Complete terminal-to-terminal polyline");
        Assert(result.PathPoints.Count == 4, "Actual bend vertices must remain in the line.");
    }
    private static void AmbiguousEnds()
    {
        var branch = new[] { T("a", "/5LD04", P(0), P(2)), T("b", "/5LD04", P(2), P(4)), T("fork", "/5LD04", P(2), P(2, 4)) };
        var fork = Find(branch, "/5LD04", .05);
        Assert(fork.Success, fork.Message);
        Near(6, fork.LengthMeters, "A fork must display its longest main span");
        Assert(fork.SegmentIds.SequenceEqual(new[] { "a", "fork" }), "Equal longest spans must use the deterministic geometry-first pair.");
        Assert(Find(branch.Reverse(), "/5LD04", .05).PathPoints.SequenceEqual(fork.PathPoints), "Tied endpoint selection depends on enumeration order.");
        var shortBranch = Find(new[] { T("a", "/5LD04", P(0), P(2)), T("b", "/5LD04", P(2), P(4)),
            T("unused", "/5LD04", P(2), P(2, 1)) }, "/5LD04", .05);
        Assert(shortBranch.Success && !shortBranch.SegmentIds.Contains("unused"), "A shorter spur entered the single-route main span.");
        Near(4, shortBranch.LengthMeters, "Main chain excludes the short branch");
        var closed = Find(new[] { T("loop", "/5LD04", P(0), P(2), P(2, 2), P(0, 2), P(0)) }, "/5LD04", .05);
        Assert(closed.Success, closed.Message);
        Near(4, closed.LengthMeters, "A loop uses its farthest geodesic span, with a real closing seam");
        Assert(closed.PathPoints[0].DistanceTo(P(0)) == 0 && closed.PathPoints[closed.PathPoints.Count - 1].DistanceTo(P(2, 2)) == 0,
            "A loop must use geometry-first diameter endpoints.");
        var disjoint = Find(new[] { T("a", "/5LD04", P(0), P(1)), T("b", "/5LD04", P(10), P(11)) }, "/5LD04", .05);
        Assert(!disjoint.Success && disjoint.Message.Contains("disconnected"), "Two disconnected same-name chains silently selected one.");
        var zero = Find(new[] { T("zero", "/5LD04", P(0), P(0)) }, "/5LD04", .05);
        Assert(!zero.Success && zero.Message.Contains("non-zero"), "Degenerate one-candidate geometry must return a clear failure.");
        var restrictedContact = Find(new[] {
            new TraySegment("a", "/5LD04", CableCategory.All, new[] { P(-2), P(0), P(2) }, true),
            new TraySegment("b", "/5LD04", CableCategory.All, new[] { P(0, -2), P(0), P(0, 2) }, true) }, "/5LD04", .05);
        Assert(!restrictedContact.Success && restrictedContact.Message.Contains("disconnected"), "Coincident port-only interiors invented a forbidden contact.");
    }
    private static void MissingNames()
    {
        var result = Find(new[] { T("existing", "/C001", P(0), P(1)) }, "/C001/C002/C003");
        Assert(!result.Success && result.Message.Contains("/C002") && result.Message.Contains("/C003"), "Every missing name must be reported.");
        Assert(result.PathPoints.Count == 0 && result.SegmentIds.Count == 0, "Failure returned a misleading partial path.");
    }
    private static void DisconnectedPair()
    {
        var trays = new[] { T("start", "/C001", P(0), P(2)), T("middle", "/C002", P(2), P(4)),
            T("end", "/C003", P(6), P(8)), T("bridge", "/C999", P(4), P(6)) };
        var result = Find(trays, "/C001/C002/C003", .25);
        Assert(!result.Success && result.Message.Contains("/C002") && result.Message.Contains("/C003"), "Failing route pair was not named.");
        Assert(result.SegmentIds.Count == 0, "An unlisted bridge or partial path was returned.");
    }
    private static TrayMeshClearance Box(double x0, double x1)
    {
        var vertices = new[] { P(x0, -.2, -.2), P(x1, -.2, -.2), P(x1, .2, -.2), P(x0, .2, -.2),
            P(x0, -.2, .2), P(x1, -.2, .2), P(x1, .2, .2), P(x0, .2, .2) };
        var mesh = new TrayMeshData(new[] { new TrayMeshFragment(vertices, new[] { 0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
            0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2 }) });
        TrayMeshClearance surface; string error;
        Assert(TrayMeshClearance.TryCreate(mesh, null, false, CancellationToken.None, out surface, out error), error);
        return surface;
    }
    private static void PhysicalClearance()
    {
        var first = new TraySegment("start", "/C001", CableCategory.All, new[] { P(0), P(1) }, false, null, new[] { Box(0, 1.2) });
        var last = new TraySegment("end", "/C002", CableCategory.All, new[] { P(2.1), P(3.1) }, false, null, new[] { Box(1.9, 3.1) });
        var accepted = Find(new[] { first, last }, "/C001/C002", .701);
        Assert(accepted.Success, accepted.Message);
        Near(.7, accepted.ConnectionGapLengthMeters, "Real surface gap");
        Near(3.1, accepted.LengthMeters, "Yellow line must retain the 1.1m axis connector");
        Assert(accepted.ConnectionGapCount == 1, "Physical connection gap count");
        Assert(!Find(new[] { first, last }, "/C001/C002", .699).Success, "A smaller current tolerance was ignored.");
    }
    private static void Reentry()
    {
        var trays = new[] { T("a", "/C001", P(0), P(2)), T("b", "/C002", P(2), P(4)) };
        var result = Find(trays, "/C001/C002/C001", .05);
        Assert(result.Success, result.Message);
        Assert(result.RouteText == "/C001/C002/C001", "Nonconsecutive same-code stages were merged.");
        Assert(result.SegmentIds.SequenceEqual(new[] { "a", "b", "a" }), "Re-entry selection order must remain.");
    }
    private static void Reversal()
    {
        var forward = Find(Network(), "/C001/C002/C003", .05);
        var reverse = Find(Network().Reverse(), "/C003/C002/C001", .05);
        Assert(forward.Success && reverse.Success, forward.Message + " " + reverse.Message);
        Assert(reverse.SegmentIds.SequenceEqual(forward.SegmentIds.Reverse()), "Reverse route did not reverse actual segments.");
        Near(forward.LengthMeters, reverse.LengthMeters, "Reverse length");
        for (int index = 0; index < 3; index++)
            Assert(Find(Network().Reverse(), "/C001/C002/C003", .05).PathPoints.SequenceEqual(forward.PathPoints), "Repeated calls depend on enumeration or old graph state.");
    }
    private static void LimitsAndCancellation()
    {
        using (var cancelled = new CancellationTokenSource())
        {
            cancelled.Cancel();
            Throws<OperationCanceledException>(() => RouteLookupCalculator.Calculate(Network(), new[] { "/C001" }, null, cancelled.Token));
        }
        var limited = Find(Network(), "/C001/C002/C003", .05, 2);
        Assert(!limited.Success && limited.Message.Contains("limit"), "Graph bounds were ignored.");
        var repeated = Find(new[] { T("a", "/C001", P(0), P(2)), T("b", "/C002", P(2), P(4)) },
            string.Concat(Enumerable.Range(0, 10).Select(index => index % 2 == 0 ? "/C001" : "/C002")), .05, 8);
        Assert(!repeated.Success && repeated.Message.Contains("lookup-state limit"), "Ordered state bounds were ignored.");
        Throws<ArgumentException>(() => Find(new[] { T("duplicate", "/C001", P(0), P(2)), T("duplicate", "/C001", P(2), P(4)) }, "/C001"));
        var star = new[] { T("a", "/C001", P(0), P(-2)), T("b", "/C001", P(0), P(2)),
            T("c", "/C001", P(0), P(0, -2)), T("d", "/C001", P(0), P(0, 2)) };
        var inferenceLimited = RouteLookupCalculator.Calculate(star, new[] { "/C001" },
            new RoutingOptions { ConnectionToleranceMeters = .001, MaxGraphConnections = 10 });
        Assert(!inferenceLimited.Success && inferenceLimited.Message.Contains("endpoint-inference work limit"), "Repeated endpoint queries exceeded their aggregate budget.");
    }
}
