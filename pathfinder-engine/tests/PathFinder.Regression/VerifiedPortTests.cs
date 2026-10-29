using System;
using System.Collections.Generic;
using System.Linq;
using AddinRibbon.Routing;

internal static class VerifiedPortTests
{
    private const double MeshSeam = 0.000007;

    internal static void Run(Action<string, Action> run)
    {
        run("Verified opposed physical ports retain a seven-micrometre seam without a gap", VerifiedSeam);
        run("Unverified and one-sided seven-micrometre seams remain counted gaps", UnverifiedSeam);
        run("Wrong measured normals or sections cannot prove continuous contact", IncompatiblePorts);
        run("An interior junction cannot borrow verified endpoint continuity", InteriorJunction);
        run("Compatible physical ports fifteen millimetres apart remain a gap", PhysicalGap);
        run("Multiple proven mesh seams beat a shorter physical shortcut", ProvenBranch);
        run("Nanometre gap-sum noise ties ranking while real micrometre differences remain decisive", GapRankingPrecision);
    }

    private static RoutePoint P(double x, double y = 0, double z = 0) { return new RoutePoint(x, y, z); }
    private static RouteConnectionPort Port(RoutePoint point, double direction, double width = 0.64, double height = 0.10)
    { return new RouteConnectionPort(point, P(direction), P(0, 1), P(0, 0, 1), width, height); }
    private static TraySegment Tray(string id, string code, RoutePoint[] points, params RouteConnectionPort[] ports)
    { return new TraySegment(id, code, CableCategory.Control, points, true, ports); }
    private static RouteResult Calculate(IEnumerable<TraySegment> trays, RoutePoint first, RoutePoint last)
    {
        return new RouteCalculator().Calculate(trays, first, last, CableCategory.Control,
            new RoutingOptions { ConnectionToleranceMeters = 0.025 });
    }
    private static void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static void Near(double expected, double actual, string message)
    { Assert(Math.Abs(expected - actual) < 1e-9, message + ": expected " + expected + ", got " + actual); }
    private static void Metrics(RouteResult route, int count, double gap, double length)
    {
        Assert(route.Success, route.Message);
        Assert(route.ConnectionGapCount == count, "Unexpected physical connection-gap count.");
        Near(gap, route.ConnectionGapLengthMeters, "Summed gap distance");
        Near(length, route.LengthMeters, "Total physical cable length");
        double independent = route.PathPoints.Zip(route.PathPoints.Skip(1), (a, b) => a.DistanceTo(b)).Sum();
        Near(length, independent, "Returned geometry must preserve the raw seam distance");
    }
    private static TraySegment[] Pair(RouteConnectionPort first, RouteConnectionPort last, double seam = MeshSeam)
    {
        return new[] {
            Tray("first", "/C001", new[] { P(0), P(1) }, first == null ? new RouteConnectionPort[0] : new[] { first }),
            Tray("last", "/C002", new[] { P(1 + seam), P(2 + seam) }, last == null ? new RouteConnectionPort[0] : new[] { last }) };
    }

    private static void VerifiedSeam()
    {
        var trays = Pair(Port(P(1), 1), Port(P(1 + MeshSeam), -1));
        var route = Calculate(trays, P(0), P(2 + MeshSeam));
        Metrics(route, 0, 0, 2 + MeshSeam);
        Assert(route.SegmentIds.SequenceEqual(new[] { "first", "last" }), "Both physical pieces must remain present.");
        var reverse = Calculate(trays, P(2 + MeshSeam), P(0));
        Metrics(reverse, 0, 0, route.LengthMeters);
        Assert(reverse.RouteText == route.Reverse().RouteText, "A measured seam changed when recalculated in reverse.");
        Metrics(Calculate(trays, P(0), P(2 + MeshSeam)), 0, 0, route.LengthMeters);
        // A section's U/V frame may be exchanged when its measured dimensions follow that exchange.
        var swapped = new RouteConnectionPort(P(1 + MeshSeam), P(-1), P(0, 0, 1), P(0, 1), .10, .64);
        Metrics(Calculate(Pair(Port(P(1), 1), swapped), P(0), P(2 + MeshSeam)), 0, 0, 2 + MeshSeam);
    }
    private static void UnverifiedSeam()
    {
        Metrics(Calculate(Pair(null, null), P(0), P(2 + MeshSeam)), 1, MeshSeam, 2 + MeshSeam);
        Metrics(Calculate(Pair(Port(P(1), 1), null), P(0), P(2 + MeshSeam)), 1, MeshSeam, 2 + MeshSeam);
    }
    private static void IncompatiblePorts()
    {
        Metrics(Calculate(Pair(Port(P(1), 1), Port(P(1 + MeshSeam), 1)), P(0), P(2 + MeshSeam)), 1, MeshSeam, 2 + MeshSeam);
        Metrics(Calculate(Pair(Port(P(1), 1), Port(P(1 + MeshSeam), -1, .30)), P(0), P(2 + MeshSeam)), 1, MeshSeam, 2 + MeshSeam);
        var perpendicular = new RouteConnectionPort(P(1 + MeshSeam), P(0, -1), P(1), P(0, 0, 1), .64, .10);
        Metrics(Calculate(Pair(Port(P(1), 1), perpendicular), P(0), P(2 + MeshSeam)), 1, MeshSeam, 2 + MeshSeam);
    }
    private static void InteriorJunction()
    {
        var trunk = new TraySegment("trunk", "/C003", CableCategory.Control, new[] { P(0), P(2) }, false,
            new[] { Port(P(0), -1), Port(P(2), 1) });
        var branch = Tray("branch", "/C004", new[] { P(1, MeshSeam), P(1, 1) },
            new RouteConnectionPort(P(1, MeshSeam), P(0, -1), P(1), P(0, 0, 1), .64, .10));
        Metrics(Calculate(new[] { trunk, branch }, P(0), P(1, 1)), 1, MeshSeam, 2);
    }
    private static void PhysicalGap()
    {
        const double gap = .015;
        Metrics(Calculate(Pair(Port(P(1), 1), Port(P(1 + gap), -1), gap), P(0), P(2 + gap)), 1, gap, 2 + gap);
    }
    private static void ProvenBranch()
    {
        var start = Tray("start", "/C005", new[] { P(0), P(1) }, Port(P(1), 1));
        var longBranch = Tray("proven-loop", "/C006",
            new[] { P(1 + MeshSeam), P(1.2), P(1.2, 3), P(3.8, 3), P(3.8), P(4) },
            Port(P(1 + MeshSeam), -1), Port(P(4), 1));
        var tail = Tray("tail", "/C007", new[] { P(4 + MeshSeam), P(5) }, Port(P(4 + MeshSeam), -1));
        var shortcut = Tray("physical-shortcut", "/C008", new[] { P(1), P(4 + MeshSeam - .015) },
            Port(P(1), -1), Port(P(4 + MeshSeam - .015), 1));
        var trays = new[] { start, longBranch, tail, shortcut };
        var route = Calculate(trays, P(0), P(5));
        Metrics(route, 0, 0, 11);
        Assert(route.SegmentIds.SequenceEqual(new[] { "start", "proven-loop", "tail" }),
            "The route skipped proved physical pieces to take the shorter genuine gap.");
        Metrics(Calculate(new[] { start, shortcut, tail }, P(0), P(5)), 1, .015, 5);
        var reverse = Calculate(trays, P(5), P(0));
        Metrics(reverse, 0, 0, 11);
        Assert(reverse.RouteText == route.Reverse().RouteText, "Proven-seam branch preference changed when reversed.");
    }
    private static void GapRankingPrecision()
    {
        Assert(RouteCalculator.GapRankingResolutionMeters == 1e-6, "The documented gap ranking precision changed.");
        foreach (double difference in new[] { 19e-9, 2e-6 })
        {
            const double lowGap = .01;
            var start = Tray("start", "/C011", new[] { P(0), P(1) });
            var tail = Tray("tail", "/C012", new[] { P(4), P(5) });
            var longFirst = Tray("a-long-first", "/C013", new[] { P(1), P(1, 4), P(2, 4) });
            var longLast = Tray("a-long-last", "/C014", new[] { P(2 + lowGap, 4), P(4, 4), P(4) });
            var shortFirst = Tray("z-short-first", "/C015", new[] { P(1), P(2) });
            var shortLast = Tray("z-short-last", "/C016", new[] { P(2 + lowGap + difference), P(4) });
            var trays = new[] { start, tail, longFirst, longLast, shortFirst, shortLast };
            bool preferShort = difference < RouteCalculator.GapRankingResolutionMeters;
            double actualSelectedGap = preferShort ? lowGap + difference : lowGap;
            foreach (var enumeration in new[] { trays, trays.Reverse().ToArray() })
            {
                var route = Calculate(enumeration, P(0), P(5));
                Assert(route.Success && route.ConnectionGapCount == 1, "The isolated alternatives each have exactly one gap.");
                Assert(route.SegmentIds.Contains(preferShort ? "z-short-first" : "a-long-first"),
                    "Gap ranking either amplified nineteen-nanometre noise or ignored a real two-micrometre difference.");
                Assert(!route.SegmentIds.Contains(preferShort ? "a-long-first" : "z-short-first"), "A shortcut crossed the isolated alternatives.");
                Assert(Math.Abs(route.ConnectionGapLengthMeters-actualSelectedGap)<1e-12,
                    "Reported physical gap distance was rounded to its ranking resolution.");
                Near(preferShort ? 5 : 13, route.LengthMeters, "Known branch cable length");
                Near(route.LengthMeters, route.PathPoints.Zip(route.PathPoints.Skip(1), (a,b)=>a.DistanceTo(b)).Sum(), "Returned physical geometry");
                var reverse = Calculate(enumeration, P(5), P(0));
                Assert(reverse.Success && reverse.RouteText == route.Reverse().RouteText && reverse.ConnectionGapCount == 1,
                    "Recalculated Reverse changed the nanometre tie preference.");
                Assert(Math.Abs(reverse.ConnectionGapLengthMeters-route.ConnectionGapLengthMeters)<1e-12,
                    "Recalculated Reverse changed the raw physical gap sum.");
                Near(route.LengthMeters,reverse.LengthMeters,"Recalculated Reverse physical length");
                Assert(route.Reverse().ConnectionGapLengthMeters == route.ConnectionGapLengthMeters, "Reverse rounded the raw metric.");
            }
        }
    }
}
