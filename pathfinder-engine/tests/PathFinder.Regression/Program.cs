using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using AddinRibbon.Routing;

internal static class Program
{
    private static int passed;
    private static readonly RouteCalculator Calculator = new RouteCalculator();

    private static int Main(string[] args)
    {
        try
        {
            Run("Full route names and piece suffixes", CodeParsing);
            Run("A continuous polyline and middle projections", LongPolylineProjection);
            Run("Sparse graphs retain long geometry without length-dependent nodes", SparseGeometry);
            Run("Exactly two metres and both secondary markers", SecondaryBoundary);
            Run("Disconnected network does not fabricate a path", Disconnected);
            Run("Exact skew contact and AABB gaps at the tolerance boundary", ExactContacts);
            Run("Right-angle route length follows its joint at both tolerances", RightAngleLength);
            Run("Known 3D diagonal polyline length and interior junction", DiagonalAndInteriorJunction);
            Run("Parallel overlapping centreline contacts avoid artificial detours", ParallelOverlap);
            Run("Physical bend ports retain all curve vertices and interior object attachment", PhysicalBendPorts);
            Run("Port-only segments retain port projections, gaps and paired curves", PortContacts);
            Run("One connection gap wins over two shorter gaps and a shorter cable", ConnectionGapCountPreference);
            Run("Equal connection counts choose the smallest summed gap distance", ConnectionGapDistancePreference);
            Run("Tied gap count and gap distance choose the shortest cable", ConnectionGapLengthTiebreaker);
            Run("Continuous contact, tray travel and endpoint legs do not count as gaps", ContinuousConnectionGapMetrics);
            Run("Connection gap metrics survive Reverse and repeated requests", ConnectionGapRepeatability);
            Run("Micrometre contact noise remains physical length but not a gap", ConnectionGapNoiseBoundary);
            Run("Category filtering rejects a forbidden bridge", Categories);
            Run("Ordered transitions retain a route re-entry", Reentry);
            Run("Reverse swaps attachments and is an involution", Reversal);
            Run("Repeated requests cannot accumulate graph edges", Repeatability);
            Run("Invalid data and a graph size limit are handled", InvalidAndNodeLimit);
            Run("Dense overlapping geometry stops at a connection limit", DenseConnections);
            Run("Rejected overlapping bounds stop at a candidate limit", CandidateLimit);
            Run("One thousand coincident pieces avoid repeated sample scans", DensePerformance);
            Run("Long parallel pieces use centre distribution in the AABB tree", ParallelDistribution);
            Run("Cancellation before and during calculation", Cancellation);
            Run("45 x 45 intersecting grid performance", GridPerformance);
            GeometryTests.Run(Run);
            EndpointApproachTests.Run(Run);
            VerifiedPortTests.Run(Run);
            MeshClearanceTests.Run(Run);
            DesignLengthTests.Run(Run);
            RouteNameResolverTests.Run(Run);
            RouteLookupTests.Run(Run);
            if (args.Length > 0) Run("Excel report tray code fixtures", () => ExcelCodes(args[0]));
            Console.WriteLine("All " + passed + " routing regression checks passed.");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("FAIL: " + ex);
            return 1;
        }
    }

    private static void Run(string name, Action action)
    {
        var timer = Stopwatch.StartNew();
        action();
        passed++;
        Console.WriteLine("PASS: " + name + " (" + timer.ElapsedMilliseconds + " ms)");
    }

    private static RoutePoint P(double x, double y = 0, double z = 0) { return new RoutePoint(x, y, z); }
    private static TraySegment T(string id, string name, CableCategory categories, params RoutePoint[] points)
    {
        return new TraySegment(id, name, categories, points);
    }
    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
    private static void Near(double expected, double actual, string message)
    {
        Assert(Math.Abs(expected - actual) < 0.000001, message + " Expected " + expected + ", got " + actual);
    }
    private static void Throws<TException>(Action action) where TException : Exception
    {
        try { action(); }
        catch (TException) { return; }
        throw new InvalidOperationException("Expected " + typeof(TException).Name);
    }

    private static void CodeParsing()
    {
        foreach (string code in new[] { "A007", "B102", "BC001", "C007", "DFB007", "DFBC009", "DFC042", "DFV010", "VFD011", "B102-1", "DFBC001-2" })
        {
            Assert(RouteCodeParser.Parse("Cable Tray /" + code + " [geometry]") == "/" + code, code);
            Assert(RouteCodeParser.Parse("Cable Tray " + code.ToLowerInvariant()) == "/" + code, code + " lowercase");
        }
        Assert(RouteCodeParser.Parse("root /B002 child /BC050-2") == "/BC050-2", "Final route code must win.");
        Assert(RouteCodeParser.Parse("x") == "/X", "Short names must not crash.");
        Assert(RouteCodeParser.Parse(null) == "/UNNAMED", "Missing names must not crash.");
        string named;
        Assert(!RouteCodeParser.TryParseNamedCode("ABC001 screw", out named), "Embedded codes must not override a route ancestor.");
        Assert(RouteCodeParser.TryParseNamedCode("Tray /DFBC007", out named) && named == "/DFBC007",
            "A complete code must remain available without fallback parsing.");
    }

    private static void LongPolylineProjection()
    {
        var tray = T("long", "B102", CableCategory.LV, P(0), P(1000));
        var result = Calculator.Calculate(new[] { tray }, P(400, 1), P(410, 1), CableCategory.LV);
        Assert(result.Success, result.Message);
        Near(1, result.FromDistanceMeters, "Project to the interior, not an end.");
        Near(1, result.ToDistanceMeters, "Project to the interior, not an end.");
        Near(12, result.LengthMeters, "Polyline length must include attachment legs.");
        Assert(result.RouteText == "/B102", "One tray route expected.");
        var bent = T("bend", "BC001", CableCategory.Control, P(0), P(4), P(4, 4));
        result = Calculator.Calculate(new[] { bent }, P(1), P(4, 3), CableCategory.Control);
        Near(6, result.LengthMeters, "The path must follow the bend.");
    }

    private static void SparseGeometry()
    {
        var tray = T("long", "C135", CableCategory.Control, P(0), P(50000));
        foreach (double spacing in new[] { 0.001, 100.0 })
        {
            var result = Calculator.Calculate(new[] { tray }, P(1000, 1), P(2000, 1), CableCategory.Control,
                new RoutingOptions { MaxGraphNodes = 4, SampleSpacingMeters = spacing });
            Assert(result.Success, "Length must not consume graph nodes: " + result.Message);
            Near(1002, result.LengthMeters, "Sparse endpoint projections must retain the exact attachment and tray lengths.");
            Assert(result.PathPoints.Count == 4, "A straight path needs only its endpoints and two projections.");
        }
        var pieces = new[] { T("135", "C135", CableCategory.Control, P(0), P(10)),
            T("136", "C136", CableCategory.Control, P(10), P(10, 10)),
            T("137", "C137", CableCategory.Control, P(10, 10), P(20, 10)) };
        var path = Calculator.Calculate(pieces, P(0, -3), P(20, 10), CableCategory.Control);
        Assert(path.Success && path.RouteText == "/SECONDARY/C135/C136/C137", "Ordered route names and the first secondary leg must survive sparse routing.");
        Near(33, path.LengthMeters, "Every physical leg must remain in the sparse path.");
        Assert(path.PathPoints.Count == 5, "Intermediate samples must not inflate the displayed polyline.");
    }

    private static void SecondaryBoundary()
    {
        var tray = T("one", "BC001", CableCategory.LV | CableCategory.Control, P(0), P(10));
        var exactly = Calculator.Calculate(new[] { tray }, P(2, 2), P(8, 2), CableCategory.LV);
        Assert(exactly.Success && !exactly.FromRequiresSecondary && !exactly.ToRequiresSecondary,
            "Exactly 2 m must not be secondary.");
        Assert(exactly.RouteText == "/BC001", "Boundary marker is incorrect.");
        var beyond = Calculator.Calculate(new[] { tray }, P(2, 2.000001), P(8, -3), CableCategory.LV);
        Assert(beyond.RouteText == "/SECONDARY/BC001/SECONDARY", "Both endpoint markers required.");
        var fromOnly = Calculator.Calculate(new[] { tray }, P(2, 3), P(8, 1), CableCategory.LV);
        Assert(fromOnly.RouteText == "/SECONDARY/BC001", "Only From is secondary.");
    }

    private static void Disconnected()
    {
        var trays = new[] { T("a", "B001", CableCategory.LV, P(0), P(2)),
            T("b", "B002", CableCategory.LV, P(2.251), P(4)) };
        var result = Calculator.Calculate(trays, P(0), P(4), CableCategory.LV);
        Assert(!result.Success && result.RouteCodes.Count == 0, "A gap over tolerance cannot be crossed.");
        var diagnostic = Calculator.Calculate(trays, P(0, -3), P(4, 1), CableCategory.LV);
        Assert(!diagnostic.Success && diagnostic.Message.Contains("/B001 (3 m") &&
            diagnostic.Message.Contains("/B002 (1 m") && diagnostic.Message.Contains("0.25 m connection tolerance"),
            "A disconnected result must identify both nearest trays, attachment distances and the actual allowed gap.");
        var connected = new[] { trays[0], T("b", "B002", CableCategory.LV, P(2.25), P(4)) };
        Assert(Calculator.Calculate(connected, P(0), P(4), CableCategory.LV).Success,
            "A gap exactly at the connection tolerance is eligible.");
        var separatedByHeight = new[] { trays[0], T("b", "B002", CableCategory.LV, P(1, 0, 1), P(4, 0, 1)) };
        Assert(!Calculator.Calculate(separatedByHeight, P(0), P(4, 0, 1), CableCategory.LV).Success,
            "Routing must compare Z as well as X and Y.");
        var island = new[] { T("a", "C135", CableCategory.Control, P(0), P(0.1)),
            T("b", "C136", CableCategory.Control, P(0, 1), P(10, 1)),
            T("c", "C137", CableCategory.Control, P(10, 1), P(20, 1)) };
        Assert(!Calculator.Calculate(island, P(0), P(20, 1), CableCategory.Control).Success,
            "The nearest disconnected island must not silently attach to a different tray to manufacture success.");
    }

    private static void Categories()
    {
        var trays = new[] { T("a", "A001", CableCategory.MV, P(0), P(2)),
            T("bridge", "B001", CableCategory.LV, P(2), P(4)),
            T("c", "A002", CableCategory.MV, P(4), P(6)) };
        Assert(!Calculator.Calculate(trays, P(0), P(6), CableCategory.MV).Success,
            "MV must never travel through an LV-only bridge.");
        Assert(!Calculator.Calculate(trays, P(0), P(6), CableCategory.Control).Success,
            "An empty eligible set must fail clearly.");
        trays[1] = T("bridge", "BC001", CableCategory.MV | CableCategory.LV, P(2), P(4));
        var result = Calculator.Calculate(trays, P(0), P(6), CableCategory.MV);
        Assert(result.Success && result.RouteText == "/A001/BC001/A002", "Explicit flags govern eligibility.");
    }

    private static void RightAngleLength()
    {
        var trays = new[] { T("a", "B001", CableCategory.LV, P(-10), P(0)),
            T("b", "B002", CableCategory.LV, P(0), P(0, 10)) };
        foreach (double tolerance in new[] { 0.25, 1.30 })
        {
            var result = Calculator.Calculate(trays, P(-10), P(0, 10), CableCategory.LV,
                new RoutingOptions { ConnectionToleranceMeters = tolerance });
            Assert(result.Success, result.Message);
            Near(20, result.LengthMeters, "Nearby samples must not shortcut the right-angle joint.");
            Assert(result.PathPoints.Any(point => point.DistanceTo(P(0)) == 0), "The route must pass through its true joint.");
        }
    }

    private static void DiagonalAndInteriorJunction()
    {
        var trays = new[] { T("a", "B001", CableCategory.LV, P(0), P(3, 3, 3)),
            T("b", "BC001", CableCategory.LV, P(3, 3, 3), P(6, 6, 3)) };
        double expected = 3 * Math.Sqrt(3) + 3 * Math.Sqrt(2);
        var result = Calculator.Calculate(trays, P(0), P(6, 6, 3), CableCategory.LV,
            new RoutingOptions { ConnectionToleranceMeters = 1.30 });
        Assert(result.Success, result.Message);
        Near(expected, result.LengthMeters, "A 3D diagonal must retain all three coordinates and both legs.");
        var branch = new[] { T("a", "B001", CableCategory.LV, P(-5), P(5)),
            T("b", "BC001", CableCategory.LV, P(0), P(0, 5)) };
        result = Calculator.Calculate(branch, P(-4), P(0, 4), CableCategory.LV);
        Assert(result.Success && result.RouteText == "/B001/BC001", "An interior T contact must remain connected.");
        Near(8, result.LengthMeters, "The route must follow the interior junction.");
    }

    private static void ParallelOverlap()
    {
        foreach (bool reverseFirst in new[] { false, true })
        foreach (bool reverseLast in new[] { false, true })
        {
            var first = T("a", "B001", CableCategory.LV,
                reverseFirst ? P(10) : P(0), reverseFirst ? P(0) : P(10));
            var last = T("b", "B002", CableCategory.LV,
                reverseLast ? P(15) : P(5), reverseLast ? P(5) : P(15));
            var result = Calculator.Calculate(new[] { first, last }, P(9), P(14), CableCategory.LV);
            Assert(result.Success, result.Message);
            Near(5, result.LengthMeters, "Overlap must not force a trip to only its starting boundary.");
            var reversed = result.Reverse();
            Near(5, reversed.LengthMeters, "Overlap reversal must preserve length.");
        }
        var diagonal = new[] { T("a", "B001", CableCategory.LV, P(0), P(10, 10, 10)),
            T("b", "B002", CableCategory.LV, P(5, 5, 5), P(15, 15, 15)) };
        var diagonalResult = Calculator.Calculate(diagonal, P(9, 9, 9), P(14, 14, 14), CableCategory.LV);
        Assert(diagonalResult.Success, diagonalResult.Message);
        Near(5 * Math.Sqrt(3), diagonalResult.LengthMeters, "Rotated overlap must retain the true centreline length.");
    }

    private static RoutePoint[] QuarterCurve(double offsetX = 0, double offsetY = 0)
    {
        var points = Enumerable.Range(0, 19).Select(index =>
            P(offsetX + Math.Sin(index * Math.PI / 36), offsetY + 1 - Math.Cos(index * Math.PI / 36))).ToArray();
        points[0] = P(offsetX, offsetY); points[18] = P(offsetX + 1, offsetY + 1);
        return points;
    }

    private static double PolylineLength(IReadOnlyList<RoutePoint> points)
    {
        double length = 0;
        for (int index = 1; index < points.Count; index++) length += points[index - 1].DistanceTo(points[index]);
        return length;
    }

    private static void PhysicalBendPorts()
    {
        var arc = QuarterCurve();
        var bend = new TraySegment("b", "B002", CableCategory.LV | CableCategory.Control, arc, connectionsAtEndsOnly: true);
        var trays = new[] { T("a", "B001", CableCategory.LV, P(-10), arc[0]), bend,
            T("c", "B003", CableCategory.LV, arc[18], P(1, 11)) };
        var result = Calculator.Calculate(trays, P(-10), P(1, 11), CableCategory.LV,
            new RoutingOptions { ConnectionToleranceMeters = 0.25 });
        Assert(result.Success && result.RouteText == "/B001/B002/B003", result.Message);
        Near(20 + PolylineLength(arc), result.LengthMeters, "Straight neighbours must not shortcut a curve through nearby interior pieces.");
        Assert(result.PathPoints.Count == 21 && arc.All(vertex => result.PathPoints.Any(point => point.DistanceTo(vertex) < 1e-10)),
            "All nineteen curve vertices, including the physical ports, must remain in the displayed path.");
        var interior = Calculator.Calculate(new[] { bend }, arc[9], arc[18], CableCategory.Control);
        Assert(interior.Success && interior.PathPoints.Count == 10, "An object may attach to the interior of a port-only curve.");
        Near(PolylineLength(arc) / 2, interior.LengthMeters, "Interior object attachment must travel only the remaining physical curve.");
        var interiorBranch = T("branch", "B004", CableCategory.LV, arc[9], P(5, 5));
        Assert(!Calculator.Calculate(new[] { bend, trays[2], interiorBranch }, P(5, 5), P(1, 11), CableCategory.LV).Success,
            "A generic tray touching a curve side must not invent a physical bend port.");
    }

    private static void PortContacts()
    {
        foreach (bool portFirst in new[] { false, true })
        {
            var port = new TraySegment(portFirst ? "a" : "z", "B001", CableCategory.LV,
                new[] { P(0), P(10) }, connectionsAtEndsOnly: true);
            var rail = T("m", "B002", CableCategory.LV, P(0, -3), P(0, 3));
            var contact = Calculator.Calculate(new[] { port, rail }, P(10), P(0, 3), CableCategory.LV);
            Assert(contact.Success, contact.Message);
            Near(13, contact.LengthMeters, "A physical port may join an analytical interior projection of a generic tray.");
        }
        var arc = QuarterCurve();
        var bend = new TraySegment("b", "B002", CableCategory.LV, arc, connectionsAtEndsOnly: true);
        var gappedStraight = T("a", "B001", CableCategory.LV, P(-10), P(-0.015));
        var joined = Calculator.Calculate(new[] { gappedStraight, bend }, P(-10), arc[18], CableCategory.LV);
        Assert(joined.Success, joined.Message);
        Near(10 + PolylineLength(arc), joined.LengthMeters, "A real fifteen-millimetre port gap must be retained in the connector length.");
        Assert(!Calculator.Calculate(new[] { gappedStraight, bend }, P(-10), arc[18], CableCategory.LV,
            new RoutingOptions { ConnectionToleranceMeters = 0.005 }).Success, "A port gap above the selected tolerance must remain disconnected.");
        var nextArc = QuarterCurve(1, 1);
        var next = new TraySegment("c", "B003", CableCategory.LV, nextArc, connectionsAtEndsOnly: true);
        var paired = Calculator.Calculate(new[] { bend, next }, arc[0], nextArc[18], CableCategory.LV);
        Assert(paired.Success && paired.PathPoints.Count == 37, "Two port-only curves must join at their shared physical port and retain both curves.");
        Near(PolylineLength(arc) + PolylineLength(nextArc), paired.LengthMeters, "Port-to-port curve connections must retain both complete lengths.");
        var crossing = new[] { new TraySegment("a", "B001", CableCategory.LV, new[] { P(0), P(10) }, true),
            new TraySegment("b", "B002", CableCategory.LV, new[] { P(5, -5), P(5, 5) }, true) };
        Assert(!Calculator.Calculate(crossing, P(0), P(5, 5), CableCategory.LV).Success,
            "Two port-only segments crossing at their interiors must not connect.");
    }

    private static TraySegment Port(string id, string code, params RoutePoint[] points)
    {
        return new TraySegment(id, code, CableCategory.LV, points, connectionsAtEndsOnly: true);
    }

    // The two alternatives share only their (0,0) and (10,0) ports. Their gap
    // ports are separated by five metres in Y, well outside the 0.25 m tolerance.
    // End-only connections prevent the common polyline interiors from creating
    // a hybrid route or a shortcut to another branch's gap ports.
    private static TraySegment[] GapNetwork(params TraySegment[][] branches)
    {
        return new[] { Port("00-from", "B001", P(-2), P(0)), Port("99-to", "B002", P(10), P(12)) }
            .Concat(branches.SelectMany(branch => branch)).ToArray();
    }

    private static TraySegment[] LongTwoGapBranch(string prefix, double firstGap, double lastGap)
    {
        return new[] {
            Port(prefix + "-first", "B101", P(0), P(0, 5), P(3, 5)),
            Port(prefix + "-middle", "B102", P(3 + firstGap, 5), P(7, 5)),
            Port(prefix + "-last", "B103", P(7 + lastGap, 5), P(10, 5), P(10))
        };
    }

    private static TraySegment[] ShortTwoGapBranch(string prefix, double firstGap, double lastGap)
    {
        return new[] {
            Port(prefix + "-first", "B201", P(0), P(3)),
            Port(prefix + "-middle", "B202", P(3 + firstGap), P(7)),
            Port(prefix + "-last", "B203", P(7 + lastGap), P(10))
        };
    }

    private static TraySegment[] LongOneGapBranch()
    {
        // IDs deliberately sort after the less desirable two-gap short branch.
        return new[] {
            Port("z-one-first", "B111", P(0), P(0, 5), P(3, 5)),
            Port("z-one-last", "B112", P(3.2, 5), P(10, 5), P(10))
        };
    }

    private static RouteResult GapRoute(IEnumerable<TraySegment> trays, RoutePoint? from = null, RoutePoint? to = null)
    {
        return Calculator.Calculate(trays, from ?? P(-2), to ?? P(12), CableCategory.LV,
            new RoutingOptions { ConnectionToleranceMeters = 0.25 });
    }

    private static void ConnectionGapCountPreference()
    {
        var longer = LongOneGapBranch();
        var shorter = ShortTwoGapBranch("a-two", 0.05, 0.05);
        var oneOnly = GapRoute(GapNetwork(longer));
        var twoOnly = GapRoute(GapNetwork(shorter));
        Assert(oneOnly.Success && twoOnly.Success, "Both isolated alternatives must genuinely connect.");
        Assert(oneOnly.ConnectionGapCount == 1 && twoOnly.ConnectionGapCount == 2, "The isolated branch gap counts are known independently.");
        Near(0.2, oneOnly.ConnectionGapLengthMeters, "The one-gap branch crosses its full twenty-centimetre separation.");
        Near(0.1, twoOnly.ConnectionGapLengthMeters, "The two-gap branch has two five-centimetre separations.");
        Near(24, oneOnly.LengthMeters, "The one-gap alternative has a five-metre outward and return detour.");
        Near(14, twoOnly.LengthMeters, "The two-gap alternative follows the shorter straight corridor.");
        var chosen = GapRoute(GapNetwork(longer, shorter));
        Assert(chosen.Success && chosen.SegmentIds.Contains("z-one-first") && !chosen.SegmentIds.Any(id => id.StartsWith("a-two")),
            "One gap must win even when it has a greater total gap distance and a longer cable.");
        Assert(chosen.ConnectionGapCount == 1, "The preferred path must report its actual one gap.");
        Near(0.2, chosen.ConnectionGapLengthMeters, "Preferred one-gap distance.");
        Near(24, chosen.LengthMeters, "Gap-count priority must not secretly retain the shorter cable path.");
    }

    private static void ConnectionGapDistancePreference()
    {
        var lowerTotal = LongTwoGapBranch("z-low-total", 0.05, 0.05);
        var higherTotal = ShortTwoGapBranch("a-high-total", 0.03, 0.20);
        var lowOnly = GapRoute(GapNetwork(lowerTotal));
        var highOnly = GapRoute(GapNetwork(higherTotal));
        Assert(lowOnly.Success && highOnly.Success && lowOnly.ConnectionGapCount == 2 && highOnly.ConnectionGapCount == 2,
            "Both alternatives must connect through exactly two actual gaps.");
        Near(0.1, lowOnly.ConnectionGapLengthMeters, "Two five-centimetre gaps sum to ten centimetres.");
        Near(0.23, highOnly.ConnectionGapLengthMeters, "The branch with the smallest single gap still has the larger sum.");
        Near(24, lowOnly.LengthMeters, "Smaller total gaps require the longer tray corridor.");
        Near(14, highOnly.LengthMeters, "Larger total gaps permit the shorter tray corridor.");
        var chosen = GapRoute(GapNetwork(lowerTotal, higherTotal));
        Assert(chosen.Success && chosen.SegmentIds.Contains("z-low-total-middle") && !chosen.SegmentIds.Any(id => id.StartsWith("a-high-total")),
            "Equal gap counts must compare the sum of all gap distances before cable length or the smallest individual gap.");
        Assert(chosen.ConnectionGapCount == 2, "Preferred path gap count.");
        Near(0.1, chosen.ConnectionGapLengthMeters, "Preferred path total gap distance.");
        Near(24, chosen.LengthMeters, "Smaller total gap distance outranks the shorter cable route.");
    }

    private static void ConnectionGapLengthTiebreaker()
    {
        var longer = LongTwoGapBranch("a-long", 0.05, 0.05);
        var shorter = ShortTwoGapBranch("z-short", 0.05, 0.05);
        var longOnly = GapRoute(GapNetwork(longer));
        var shortOnly = GapRoute(GapNetwork(shorter));
        Assert(longOnly.Success && shortOnly.Success && longOnly.ConnectionGapCount == shortOnly.ConnectionGapCount,
            "The alternatives must have matching gap counts.");
        Assert(longOnly.ConnectionGapLengthMeters == shortOnly.ConnectionGapLengthMeters,
            "Using identical X gap coordinates makes summed gap distances exactly equal, without a rounding-biased preference.");
        foreach (var input in new[] { GapNetwork(longer, shorter), GapNetwork(shorter, longer).Reverse().ToArray() })
        {
            var chosen = GapRoute(input);
            Assert(chosen.Success && chosen.SegmentIds.Contains("z-short-middle") && !chosen.SegmentIds.Any(id => id.StartsWith("a-long")),
                "When both gap objectives tie, the shorter physical cable must win despite worse lexical IDs or input order.");
            Assert(chosen.ConnectionGapCount == 2, "Tied count must remain two.");
            Near(0.1, chosen.ConnectionGapLengthMeters, "Tied gap-distance metric.");
            Near(14, chosen.LengthMeters, "Third objective is total cable length.");
        }
    }

    private static void ContinuousConnectionGapMetrics()
    {
        var continuous = new[] {
            T("a", "B301", CableCategory.LV, P(0), P(10)),
            T("b", "B302", CableCategory.LV, P(5), P(15)),
            T("c", "B303", CableCategory.LV, P(15), P(15, 10))
        };
        var connected = Calculator.Calculate(continuous, P(1), P(15, 9), CableCategory.LV);
        Assert(connected.Success && connected.ConnectionGapCount == 0, "Overlapping and coincident cross-tray contacts are gap-free.");
        Near(0, connected.ConnectionGapLengthMeters, "Continuous contact must not report positive gap distance.");
        Near(23, connected.LengthMeters, "Continuous contacts still preserve physical tray travel.");
        var longTray = T("long", "B304", CableCategory.LV, P(0), P(1000), P(1000, 1000));
        var withLegs = Calculator.Calculate(new[] { longTray }, P(0, -3), P(1000, 1003), CableCategory.LV);
        Assert(withLegs.Success && withLegs.FromRequiresSecondary && withLegs.ToRequiresSecondary, "Both real attachment legs exceed two metres.");
        Assert(withLegs.ConnectionGapCount == 0 && withLegs.ConnectionGapLengthMeters == 0,
            "Long along-tray edges and From/To attachment legs never become cross-tray gaps.");
        Near(2006, withLegs.LengthMeters, "Along-tray travel and attachment legs remain in physical cable length.");
    }

    private static void ConnectionGapRepeatability()
    {
        var trays = GapNetwork(LongOneGapBranch(), ShortTwoGapBranch("a-two", 0.05, 0.05));
        var from = P(-2, -3); var to = P(12, -1);
        var baseline = GapRoute(trays, from, to);
        Assert(baseline.Success && baseline.FromRequiresSecondary && !baseline.ToRequiresSecondary, "The fixture has one secondary attachment leg.");
        Assert(baseline.ConnectionGapCount == 1, "Only the selected cross-tray gap counts.");
        Near(0.2, baseline.ConnectionGapLengthMeters, "Attachment distances are excluded from the gap sum.");
        Near(28, baseline.LengthMeters, "Both attachment lengths remain in the total.");
        var reverse = baseline.Reverse();
        Assert(reverse.ConnectionGapCount == baseline.ConnectionGapCount && reverse.ConnectionGapLengthMeters == baseline.ConnectionGapLengthMeters,
            "Reverse must preserve both gap metrics.");
        Assert(!reverse.FromRequiresSecondary && reverse.ToRequiresSecondary, "Reverse still swaps endpoint markers.");
        Near(baseline.LengthMeters, reverse.LengthMeters, "Reverse must preserve physical length.");
        var twice = reverse.Reverse();
        Assert(twice.RouteText == baseline.RouteText && twice.ConnectionGapCount == baseline.ConnectionGapCount
            && twice.ConnectionGapLengthMeters == baseline.ConnectionGapLengthMeters, "Two reversals restore the original route and metrics.");
        for (int request = 0; request < 4; request++)
        {
            var current = GapRoute(request % 2 == 0 ? trays : trays.Reverse().ToArray(), from, to);
            Assert(current.Success && current.RouteText == baseline.RouteText && current.SegmentIds.SequenceEqual(baseline.SegmentIds),
                "Repeated requests and input order changes must select the same branch.");
            Assert(current.ConnectionGapCount == baseline.ConnectionGapCount && current.ConnectionGapLengthMeters == baseline.ConnectionGapLengthMeters,
                "Gap metrics must not accumulate between requests.");
            Near(baseline.LengthMeters, current.LengthMeters, "Repeated physical length.");
        }
        var recalculatedReverse = GapRoute(trays, to, from);
        Assert(recalculatedReverse.Success && recalculatedReverse.ConnectionGapCount == baseline.ConnectionGapCount,
            "A new reversed request must optimize the same actual-gap count.");
        Near(baseline.ConnectionGapLengthMeters, recalculatedReverse.ConnectionGapLengthMeters, "Recalculated reverse gap sum.");
        Near(baseline.LengthMeters, recalculatedReverse.LengthMeters, "Recalculated reverse length.");
    }

    private static void ConnectionGapNoiseBoundary()
    {
        Assert(RouteCalculator.ConnectionGapEpsilonMeters == 1e-6, "The documented contact noise threshold must remain one micrometre.");
        foreach (double noise in new[] { 0.0, 0.5e-6, 1e-6, 2e-6 })
        {
            var trays = new[] { Port("a", "B401", P(-1), P(0)), Port("b", "B402", P(noise), P(1 + noise)) };
            var result = Calculator.Calculate(trays, P(-1), P(1 + noise), CableCategory.LV);
            Assert(result.Success, result.Message);
            Assert(result.ConnectionGapCount == (noise > 1e-6 ? 1 : 0), "Only separation strictly over one micrometre counts as a gap: " + noise);
            Assert(Math.Abs(result.ConnectionGapLengthMeters - (noise > 1e-6 ? noise : 0)) < 1e-12,
                "Qualifying gap distance must exclude contact noise, including the exact epsilon boundary.");
            Assert(Math.Abs(result.LengthMeters - (2 + noise)) < 1e-12,
                "Sub-micrometre noise still contributes its physical length; coarse tolerances must not mask its loss.");
        }
    }

    private static void ExactContacts()
    {
        // Neither polyline has a regular sample at the true nearest contact.
        // The gap in Z is exactly the tolerance, so sample distances are all too large.
        var horizontal = T("a", "B001", CableCategory.LV, P(-1, 0.0625), P(1, 0.0625));
        var vertical = T("b", "BC001", CableCategory.LV, P(0.0625, -1, 0.25), P(0.0625, 1, 0.25));
        var result = Calculator.Calculate(new[] { horizontal, vertical }, P(-1, 0.0625), P(0.0625, 1, 0.25), CableCategory.LV);
        Assert(result.Success && result.RouteText == "/B001/BC001", "An exact continuous-polyline contact must be found.");
        Assert(result.PathPoints.Any(point => point.DistanceTo(P(0.0625, 0.0625)) == 0),
            "The exact projection contact must be inserted on the first tray.");
        Assert(result.PathPoints.Any(point => point.DistanceTo(P(0.0625, 0.0625, 0.25)) == 0),
            "The exact projection contact must be inserted on the second tray.");
        var outside = T("b", "BC001", CableCategory.LV, P(0.0625, -1, 0.250001), P(0.0625, 1, 0.250001));
        Assert(!Calculator.Calculate(new[] { horizontal, outside }, P(-1, 0.0625), P(0.0625, 1, 0.250001), CableCategory.LV).Success,
            "Exact contacts must not widen the configured gap tolerance.");
        var origin = T("a", "B001", CableCategory.LV, P(0), P(0));
        var diagonalGap = T("b", "BC001", CableCategory.LV, P(0.15, 0.20), P(0.15, 0.20));
        Assert(Calculator.Calculate(new[] { origin, diagonalGap }, P(0), P(0.15, 0.20), CableCategory.LV).Success,
            "The AABB query must retain an exact Euclidean tolerance contact.");
        var excessiveGap = T("b", "BC001", CableCategory.LV, P(0.15, 0.200001), P(0.15, 0.200001));
        Assert(!Calculator.Calculate(new[] { origin, excessiveGap }, P(0), P(0.15, 0.200001), CableCategory.LV).Success,
            "Bounds overlapping on individual axes do not prove an allowable 3D connection.");
    }

    private static void Reentry()
    {
        var trays = new[] { T("a1", "B001", CableCategory.LV, P(0), P(2)),
            T("b", "BC001", CableCategory.LV, P(2), P(4)),
            T("a2", "B001", CableCategory.LV, P(4), P(6)) };
        var result = Calculator.Calculate(trays, P(0), P(6), CableCategory.LV);
        Assert(result.Success && result.RouteText == "/B001/BC001/B001", "Re-entry cannot be globally deduplicated.");
        Assert(result.SegmentIds.SequenceEqual(new[] { "a1", "b", "a2" }), "Highlight order must retain every segment.");
    }

    private static void Reversal()
    {
        var trays = new[] { T("a", "B001", CableCategory.LV, P(0), P(2)),
            T("b", "DFB007-1", CableCategory.LV, P(2), P(4)) };
        var original = Calculator.Calculate(trays, P(0, 3), P(4, 1), CableCategory.LV);
        var reverse = original.Reverse();
        Assert(reverse.RouteText == "/DFB007-1/B001/SECONDARY", "Reverse must swap ordered route markers.");
        Near(original.LengthMeters, reverse.LengthMeters, "Reverse preserves total distance.");
        Near(original.FromDistanceMeters, reverse.ToDistanceMeters, "Reverse swaps attachment distances.");
        Assert(reverse.PathPoints.First().DistanceTo(original.PathPoints.Last()) == 0, "Reverse swaps point order.");
        Assert(reverse.Reverse().RouteText == original.RouteText, "Reverse twice returns original route.");
        Assert(reverse.Reverse().SegmentIds.SequenceEqual(original.SegmentIds), "Reverse twice returns original IDs.");
    }

    private static void Repeatability()
    {
        var trays = new[] { T("a", "B001", CableCategory.LV, P(0), P(3)),
            T("b", "BC002", CableCategory.LV, P(3), P(6)) };
        var baseline = Calculator.Calculate(trays, P(1), P(5), CableCategory.LV);
        for (int i = 0; i < 30; i++)
        {
            var current = Calculator.Calculate(i % 2 == 0 ? trays : trays.Reverse(), P(1), P(5), CableCategory.LV);
            Assert(current.RouteText == baseline.RouteText, "Stable routing independent of input enumeration order.");
            Near(baseline.LengthMeters, current.LengthMeters, "No graph accumulation between requests.");
            Assert(current.PathPoints.Count == baseline.PathPoints.Count, "No accumulated path points.");
        }
    }

    private static void InvalidAndNodeLimit()
    {
        Throws<ArgumentException>(() => P(double.NaN));
        Throws<ArgumentException>(() => T("", "B001", CableCategory.LV, P(0), P(1)));
        Throws<ArgumentException>(() => T("a", "B001", CableCategory.LV, P(0)));
        var tray = T("a", "B001", CableCategory.LV, P(0), P(5));
        Throws<ArgumentException>(() => Calculator.Calculate(new[] { tray }, P(0), P(1), CableCategory.All));
        Throws<ArgumentException>(() => Calculator.Calculate(new[] { tray }, P(0), P(1), CableCategory.LV,
            new RoutingOptions { ConnectionToleranceMeters = 0 }));
        var detailed = T("detailed", "B001", CableCategory.LV,
            Enumerable.Range(0, 21).Select(index => P(index, index % 2)).ToArray());
        var limited = Calculator.Calculate(new[] { detailed }, P(0), P(20), CableCategory.LV,
            new RoutingOptions { MaxGraphNodes = 10 });
        Assert(!limited.Success && limited.Message.Contains("node limit"), "Oversized geometry must stop cleanly.");
        var zero = T("zero", "B001", CableCategory.LV, P(0), P(0));
        var same = Calculator.Calculate(new[] { zero }, P(0), P(0), CableCategory.LV);
        Assert(same.Success && same.RouteText == "/B001" && same.LengthMeters == 0, "A degenerate leaf must be safe.");
        var extreme = Calculator.Calculate(new[] { T("range", "B001", CableCategory.LV, P(0), P(1)) },
            P(1e308), P(0), CableCategory.LV);
        Assert(!extreme.Success && extreme.Message.Contains("coordinate range"), "Overflowing endpoint distance must fail cleanly.");
        Assert(extreme.LengthMeters == 0 && extreme.ConnectionGapCount == 0 && extreme.ConnectionGapLengthMeters == 0,
            "Range failure must keep finite zero result metrics.");
    }

    private static void Cancellation()
    {
        var tray = T("a", "B001", CableCategory.LV, P(0), P(5));
        using (var source = new CancellationTokenSource())
        {
            source.Cancel();
            Throws<OperationCanceledException>(() => Calculator.Calculate(new[] { tray }, P(0), P(1),
                CableCategory.LV, cancellationToken: source.Token));
        }
        using (var source = new CancellationTokenSource())
        {
            var grid = MakeOverlappingBounds(2000);
            source.CancelAfter(5);
            Throws<OperationCanceledException>(() => Calculator.Calculate(grid, P(0), P(84, 84),
                CableCategory.LV, cancellationToken: source.Token));
        }
    }

    private static void DenseConnections()
    {
        var dense = Enumerable.Range(0, 100).Select(index =>
            T("dense" + index, "B001", CableCategory.LV, P(0), P(0))).ToArray();
        var result = Calculator.Calculate(dense, P(0), P(0), CableCategory.LV,
            new RoutingOptions { MaxGraphNodes = 500, MaxGraphConnections = 1000 });
        Assert(!result.Success && result.Message.Contains("connection limit"),
            "A node cap alone cannot prevent quadratic memory use for overlapping trays.");
    }

    private static List<TraySegment> MakeOverlappingBounds(int count)
    {
        return Enumerable.Range(0, count).Select(index =>
            T(index.ToString("D8"), "B001", CableCategory.LV,
                P(0, index), P(10000, 10000 + index))).ToList();
    }

    private static void CandidateLimit()
    {
        // Parallel lines are more than the allowed gap apart, but their long
        // diagonal AABBs overlap. An edge limit cannot bound these rejected pairs.
        var result = Calculator.Calculate(MakeOverlappingBounds(200), P(0), P(0, 199), CableCategory.LV,
            new RoutingOptions { MaxGraphNodes = 500, MaxGraphConnections = 500 });
        Assert(!result.Success && result.Message.Contains("candidate limit"),
            "Dense rejected geometry must stop without relying on accepted graph edges.");
    }

    private static void DensePerformance()
    {
        var dense = Enumerable.Range(0, 1000).Select(index =>
            T(index.ToString("D8"), "B001", CableCategory.LV, P(0), P(10))).ToArray();
        var timer = Stopwatch.StartNew();
        long allocated = GC.GetTotalAllocatedBytes(true);
        var result = Calculator.Calculate(dense, P(0), P(10), CableCategory.LV);
        Assert(result.Success, result.Message);
        Near(10, result.LengthMeters, "Dense coincident pieces must not alter length.");
        Assert(result.PathPoints.Count == 2, "Dense overlap must not add display samples.");
        Assert(timer.ElapsedMilliseconds < 15000, "Dense routing exceeded its bounded performance expectation.");
        Console.WriteLine("  1,000 coincident 10 m pieces; " + timer.ElapsedMilliseconds + " ms; " +
            ((GC.GetTotalAllocatedBytes(true) - allocated) / 1048576.0).ToString("0.0") + " MiB allocated.");
    }

    private static void ParallelDistribution()
    {
        const int count = 10000;
        // Lexical IDs scramble the spatial order. Splitting by world-box width
        // would choose constant X centres and create nearly useless partitions.
        var trays = Enumerable.Range(0, count).Select(index =>
            T(((index * 7919) % count).ToString("D8"), "B001", CableCategory.LV,
                P(0, index), P(100000, index))).ToArray();
        var timer = Stopwatch.StartNew();
        var result = Calculator.Calculate(trays, P(0, 42), P(100000, 42), CableCategory.LV);
        Assert(result.Success, result.Message);
        Near(100000, result.LengthMeters, "Long unconnected parallel pieces must preserve their own length.");
        Assert(result.PathPoints.Count == 2, "Long pieces must not consume sampled graph vertices.");
        Assert(timer.ElapsedMilliseconds < 10000, "AABB centre partitioning did not bound sparse parallel comparisons.");
        Console.WriteLine("  10,000 long parallel pieces in " + timer.ElapsedMilliseconds + " ms.");
    }

    private static List<TraySegment> MakeGrid(int size)
    {
        var result = new List<TraySegment>();
        for (int i = 0; i < size; i++)
        {
            result.Add(T("h" + i.ToString("000"), "B" + i.ToString("000"), CableCategory.LV,
                P(0, i), P(size - 1, i)));
            result.Add(T("v" + i.ToString("000"), "BC" + i.ToString("000"), CableCategory.LV,
                P(i), P(i, size - 1)));
        }
        return result;
    }

    private static void GridPerformance()
    {
        var timer = Stopwatch.StartNew();
        var result = Calculator.Calculate(MakeGrid(45), P(0), P(44, 44), CableCategory.LV);
        Assert(result.Success, result.Message);
        Near(88, result.LengthMeters, "An orthogonal grid must follow its centreline junctions without cutting corners.");
        Assert(timer.ElapsedMilliseconds < 30000, "Grid routing exceeded 30 seconds.");
        Console.WriteLine("  90 polylines; " + result.PathPoints.Count + " sparse path points; " + result.LengthMeters.ToString("0.000") + " m path.");
    }

    private static void ExcelCodes(string file)
    {
        using (var document = JsonDocument.Parse(File.ReadAllText(file)))
        {
            int count = 0;
            foreach (var tray in document.RootElement.GetProperty("tray_catalog").EnumerateArray())
            {
                string name = tray.GetProperty("name").GetString();
                Assert(RouteCodeParser.Parse("Cable tray /" + name + " geometry") == "/" + name.ToUpperInvariant(), name);
                count++;
            }
            Assert(count == 327, "Expected all 327 source-report tray names.");
            Console.WriteLine("  Verified " + count + " tray codes against the supplied report fixture.");
        }
    }
}
