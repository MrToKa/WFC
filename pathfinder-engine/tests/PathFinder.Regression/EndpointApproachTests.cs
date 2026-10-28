using System;
using System.Linq;
using AddinRibbon.Routing;

internal static class EndpointApproachTests
{
    public static void Run(Action<string, Action> run)
    {
        run("Vertical equipment approach prefers an aligned nearby tray", NearbyVertical);
        run("Vertical preference rejects remote storeys and respects the nearby band", NearbyLimit);
        run("Vertical pieces select the nearest height and exclude forbidden categories", VerticalAndCategories);
        run("Vertical approach length, SECONDARY and recalculated Reverse agree", LengthAndReverse);
    }

    private static RoutePoint P(double x, double y = 0, double z = 0) { return new RoutePoint(x, y, z); }
    private static TraySegment Tray(string id, string code, CableCategory category, params RoutePoint[] points)
    { return new TraySegment(id, code, category, points); }
    private static TraySegment[] Network()
    {
        return new[] {
            Tray("vertical", "/B001", CableCategory.LV, P(0), P(10)),
            Tray("side", "/B002", CableCategory.LV, P(0, 0.6, 0.4), P(10, 0.6, 0.4)),
            Tray("bridge", "/B003", CableCategory.LV, P(0), P(-1), P(-1, 0.6, 0.4), P(0, 0.6, 0.4)) };
    }
    private static RouteResult Calculate(TraySegment[] trays, bool vertical, double gap = 1,
        RoutePoint? from = null, RoutePoint? to = null)
    {
        return new RouteCalculator().Calculate(trays, from ?? P(1), to ?? P(8, 0, 1.2), CableCategory.LV,
            new RoutingOptions { ConnectionToleranceMeters = gap, SecondaryDistanceMeters = 1.1, PreferVerticalApproach = vertical });
    }
    private static void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static void Near(double expected, double actual) { Assert(Math.Abs(expected - actual) < 1e-9, "Expected " + expected + ", got " + actual); }

    private static void NearbyVertical()
    {
        var nearest = Calculate(Network(), false); var preferred = Calculate(Network(), true);
        Assert(nearest.Success && preferred.Success, "Both approaches must connect.");
        Assert(nearest.RouteCodes.Last() == "/B002", "Ordinary nearest 3D attaches to the side tray.");
        Assert(preferred.SegmentIds.SequenceEqual(new[] { "vertical" }), "The preferred approach must remain on the aligned tray.");
        Near(1, nearest.ToDistanceMeters); Near(1.2, preferred.ToDistanceMeters); Near(8.2, preferred.LengthMeters);
        Assert(preferred.ConnectionGapCount == 0, "An equipment leg must not count as an inter-tray gap.");
    }
    private static void NearbyLimit()
    {
        var rejected = Calculate(Network(), true, 0.199999);
        var boundary = Calculate(Network(), true, 0.2);
        Assert(rejected.Success && rejected.SegmentIds.Last() == "side", "A vertical approach outside the nearest-distance-plus-gap band cannot win.");
        Assert(boundary.Success && boundary.SegmentIds.Last() == "vertical", "The exact nearby boundary is included.");
        var far = Network().Concat(new[] { Tray("remote", "/B004", CableCategory.LV, P(0, 0, -100), P(10, 0, -100)) }).ToArray();
        Assert(Calculate(far, true).SegmentIds.SequenceEqual(new[] { "vertical" }), "A remote storey must not win its exact XY match.");
    }
    private static void VerticalAndCategories()
    {
        var trays = new[] {
            Tray("riser", "/B005", CableCategory.LV, P(0, 0, -5), P(0, 0, 5)),
            Tray("forbidden", "/C001", CableCategory.Control, P(0.1, 0, -5), P(0.1, 0, 5)) };
        var route = Calculate(trays, true, 1, P(0, 0, -1), P(0.1, 0, 2));
        Assert(route.Success && route.SegmentIds.SequenceEqual(new[] { "riser" }), "Forbidden alignment cannot be selected.");
        Near(0.1, route.ToDistanceMeters); Near(3.1, route.LengthMeters);
        Near(2, route.PathPoints[route.PathPoints.Count - 2].Z);
    }
    private static void LengthAndReverse()
    {
        var route = Calculate(Network(), true); var reverse = Calculate(Network(), true, 1, P(8, 0, 1.2), P(1));
        Assert(route.Success && reverse.Success && route.ToRequiresSecondary && !route.FromRequiresSecondary,
            "SECONDARY uses the actual selected approach length.");
        Assert(reverse.RouteText == route.Reverse().RouteText, "Recalculated reverse must use the same approach rule.");
        Near(route.LengthMeters, reverse.LengthMeters); Near(route.ToDistanceMeters, reverse.FromDistanceMeters);
        double measured = 0;
        for (int index = 1; index < route.PathPoints.Count; index++) measured += route.PathPoints[index - 1].DistanceTo(route.PathPoints[index]);
        Near(route.LengthMeters, measured);
    }
}
