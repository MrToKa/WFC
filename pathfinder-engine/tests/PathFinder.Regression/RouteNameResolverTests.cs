using System;
using System.Linq;
using AddinRibbon.Routing;

internal static class RouteNameResolverTests
{
    public static void Run(Action<string, Action> run)
    {
        run("Digit-leading route IDs and qualified component owners", QualifiedNames);
        run("Logical route parents win above nested component ancestors", NestedComponents);
        run("Component aliases respect whole-word boundaries and selected roots", ComponentsAndBounds);
        run("Legacy route pieces, closest ancestors and fallback names survive", LegacyNames);
        run("Hierarchy labels leave fitted geometry and cable metrics unchanged", GeometryAndLength);
    }

    private static void Equal(string expected, string actual)
    { if (expected != actual) throw new InvalidOperationException("Expected " + expected + ", got " + actual); }
    private static void Assert(bool value, string message)
    { if (!value) throw new InvalidOperationException(message); }
    private static void Near(double expected, double actual)
    { Assert(Math.Abs(expected - actual) < 1e-9, "Cable metric changed: " + expected + " vs " + actual); }

    private static void QualifiedNames()
    {
        foreach (var pair in new[] {
            new[] { "/5LD04", "/5LD04" }, new[] { "/5ld10 AUTOMATION", "/5LD10" },
            new[] { "/5LD04/B1", "/5LD04" }, new[] { "BRANCH /5LD04/B1", "/5LD04" },
            new[] { "/ZONE2/5LD04/B1", "/5LD04" }, new[] { "/C107-7/B1", "/C107-7" },
            new[] { "/5LD04/B1_extra", "/5LD04" },
            new[] { "root /B002 child /BC050-2", "/BC050-2" } })
            Equal(pair[1], RouteCodeParser.Parse(pair[0]));
        string code;
        Assert(RouteCodeParser.TryParseNamedCode("/5LD04", out code), "Digit-leading parent was ignored.");
        Assert(RouteCodeParser.TryParseNamedCode(" 5ld04 ", out code) && code == "/5LD04", "A bare logical parent code was ignored.");
        Assert(RouteNameResolver.OwnerIndex(new[] { "Tube /B1", "5LD04", "/ZONE2" }) == 1,
            "Native lookup owner identity differs from the logical parent label.");
        Assert(!RouteCodeParser.TryParseNamedCode("/1234", out code), "An arbitrary number became a route code.");
    }

    private static void NestedComponents()
    {
        Equal("/5LD04", RouteNameResolver.Resolve(new[] {
            "Tube 1", "BRANCH /5LD04/B1", "/5LD04/B1", "/5LD04", "/MAN_CABLETRAYS_ZONE" }));
        Equal("/5LD04", RouteNameResolver.Resolve(new[] {
            "Tube /B1", "Branch /B1", "/5LD04", "/MAN_CABLETRAYS_ZONE" }));
        Equal("/DFB777", RouteNameResolver.Resolve(new[] {
            "FTUBE 3 of BRANCH 1 of PIPE /DFB777", "BRANCH 1 of PIPE /DFB777", "/DFB777", "/ROUTE_ZONE" }));
        Equal("/5LD10", RouteNameResolver.Resolve(new[] { "Elbow /B1", "/5LD10 AUTOMATION", "/ZONE2" }));
        Equal("/5LD04", RouteNameResolver.Resolve(new[] {
            "Tube /B1", "/ZONE2/5LD04/B1", "/5LD04", "/ZONE2" }));
        Equal("/5LD04", RouteNameResolver.Resolve(new[] { "FTUBE /B1", "/5LD04", "Tube /ZONE2" }));
        Equal("/5LD04", RouteNameResolver.Resolve(new[] { "FTUBE /B1", "/5LD04/B1_extra", "/5LD04" }));
    }

    private static void ComponentsAndBounds()
    {
        foreach (string component in new[] { "Tube", "FTUBE", "Straight", "Bend", "Elbow", "ELBO", "Branch",
            "BRAN", "TEE", "CROSS", "CROS", "REDUCER", "REDU", "COUPLING", "ADAPTER", "CAP" })
            Equal("/5LD04", RouteNameResolver.Resolve(new[] { component + " /B1", "/5LD04", "/ZONE2" }));
        foreach (string word in new[] { "TUBER", "BENDING", "ELBOWED", "BRANCHING" })
            Equal("/B1", RouteNameResolver.Resolve(new[] { word + " /B1", "/5LD04" }));
        Equal("/5LD04", RouteNameResolver.Resolve(new[] { "Tube /5LD04/B1", "/5LD04/B1" }));
        Equal("/B1", RouteNameResolver.Resolve(new[] { "Tube /B1" }));
        Assert(!TrayGeometryBuilder.IsStraight("BRANCH /5LD04/B1"), "Naming aliases changed shape classification.");
        Assert(!TrayGeometryBuilder.IsBendOrElbow("BRANCH /5LD04/B1"), "Branch was incorrectly fitted as a bend.");
    }

    private static void LegacyNames()
    {
        foreach (string code in new[] { "C107-7", "DFBC002-2", "BC050-2", "A007", "B102-1" })
            Equal("/" + code, RouteNameResolver.Resolve(new[] { "Tube /B1", "/" + code, "/ZONE2" }));
        Equal("/BC050-2", RouteNameResolver.Resolve(new[] { "/BC050-2", "/C107-7", "/ZONE2" }));
        Equal("/BC222-1", RouteNameResolver.Resolve(new[] { "/BC222-1", "BRANCH 1 of PIPE /Copy-of-BC222", "/Copy-of-BC222" }));
        Equal("/B223-1", RouteNameResolver.Resolve(new[] { "/BEND_90_1_of_PIPE_B223", "BRANCH 1 of PIPE /B223-1", "/B223-1" }));
        Equal("/C107-7", RouteNameResolver.Resolve(new[] { "Unnamed geometry", "/C107-7", "/ZONE2" }));
        Equal("/ZONE", RouteNameResolver.Resolve(new[] { "Unnamed geometry", "Cable Route Zone" }));
        Equal("/UNNAMED", RouteNameResolver.Resolve(null));
    }

    private static RoutePoint P(double x, double y = 0, double z = 0) { return new RoutePoint(x, y, z); }
    private static TrayGeometryBuildResult Build(bool resolved)
    {
        string label = resolved ? RouteNameResolver.Resolve(new[] { "Tube /B1", "/5LD04/B1", "/5LD04", "/ROUTE_ZONE" }) : "/B1";
        return TrayGeometryBuilder.Build(new[] {
            new TrayGeometryInput("first", label, CableCategory.MV, "Tube", P(0, -0.2, -0.1), P(8, 0.2, 0.1)),
            new TrayGeometryInput("middle", label, CableCategory.MV, "Tube", P(8.3, -0.2, -0.1), P(12, 0.2, 0.1)),
            new TrayGeometryInput("last", label, CableCategory.MV, "Tube", P(12.3, -0.2, -0.1), P(18.5, 0.2, 0.1)) });
    }
    private static void GeometryAndLength()
    {
        var before = Build(false); var after = Build(true);
        Assert(before.Segments.Count == after.Segments.Count && before.Segments.Zip(after.Segments,
            (a, b) => a.Id == b.Id && a.Points.SequenceEqual(b.Points) && a.ConnectionsAtEndsOnly == b.ConnectionsAtEndsOnly
            && a.AllowedCategories == b.AllowedCategories && a.VerifiedPorts.Count == b.VerifiedPorts.Count
            && a.ConnectionSurfaces.Count == b.ConnectionSurfaces.Count).All(value => value), "Fitted geometry changed.");
        Assert(before.ValidatedBends == after.ValidatedBends && before.FallbackBends == after.FallbackBends
            && before.ValidatedStraights == after.ValidatedStraights && before.FallbackStraights == after.FallbackStraights
            && before.FallbackClearances == after.FallbackClearances, "Geometry diagnostics changed.");
        var options = new RoutingOptions { ConnectionToleranceMeters = 1, SecondaryDistanceMeters = 1.5 };
        var calculator = new RouteCalculator();
        var oldResult = calculator.Calculate(before.Segments, P(0, 0, 1.95), P(18.5, 0, 2.604), CableCategory.MV, options);
        var result = calculator.Calculate(after.Segments, P(0, 0, 1.95), P(18.5, 0, 2.604), CableCategory.MV, options);
        Assert(oldResult.Success && result.Success, result.Message);
        Equal("/SECONDARY/B1/SECONDARY", oldResult.RouteText);
        Equal("/SECONDARY/5LD04/SECONDARY", result.RouteText);
        Near(23.054, result.LengthMeters);
        Near(oldResult.LengthMeters, result.LengthMeters);
        Near(oldResult.FromDistanceMeters, result.FromDistanceMeters); Near(oldResult.ToDistanceMeters, result.ToDistanceMeters);
        Near(oldResult.ConnectionGapLengthMeters, result.ConnectionGapLengthMeters);
        Assert(oldResult.ConnectionGapCount == result.ConnectionGapCount && result.ConnectionGapCount == 2,
            "Connection gap count changed.");
        Assert(oldResult.PathPoints.SequenceEqual(result.PathPoints) && oldResult.SegmentIds.SequenceEqual(result.SegmentIds),
            "The selected 3D path changed.");
        Assert(CableDesignLength.Calculate(result, 6m, 6m, 5m).DesignLengthMeters == 39m
            && CableDesignLength.Calculate(oldResult, 6m, 6m, 5m).DesignLengthMeters == 39m, "Design length changed.");
        Equal("/SECONDARY/5LD04/SECONDARY", result.Reverse().RouteText);
    }
}
