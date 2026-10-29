using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using AddinRibbon.Routing;

// Test-only PF-0 fixture replay. Routing calculations run in the referenced extracted DLL.
// Invalid/internal synthetic cases here are not production transport DTOs.
internal static class FrozenReplay
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    internal static object Evaluate(string kind, JsonElement input)
    {
        try
        {
            switch (kind)
            {
                case "calculate":
                    var route = new RouteCalculator().Calculate(Segments(input), Point(input.GetProperty("from")),
                        Point(input.GetProperty("to")), (CableCategory)input.GetProperty("category").GetInt32(), Options(input));
                    if (input.TryGetProperty("reverse", out var reverse) && reverse.GetBoolean()) route = route.Reverse();
                    return new { status = "returned", route = Route(route) };
                case "lookup":
                    var lookup = RouteLookupCalculator.Calculate(Segments(input),
                        RouteLookupCalculator.Parse(input.GetProperty("routing").GetString()), Options(input));
                    if (input.TryGetProperty("reverse", out var reverseLookup) && reverseLookup.GetBoolean()) lookup = lookup.Reverse();
                    return new { status = "returned", route = Route(lookup) };
                case "design":
                    var value = input.GetProperty("route");
                    var synthetic = new RouteResult(value.GetProperty("success").GetBoolean(), "",
                        new[] { "/C001" }, new[] { "synthetic-tray" }, new RoutePoint[0],
                        value.GetProperty("lengthMeters").GetDouble(), value.GetProperty("fromDistanceMeters").GetDouble(),
                        value.GetProperty("toDistanceMeters").GetDouble(), value.GetProperty("fromRequiresSecondary").GetBoolean(),
                        value.GetProperty("toRequiresSecondary").GetBoolean());
                    if (input.TryGetProperty("reverse", out var reverseDesign) && reverseDesign.GetBoolean()) synthetic = synthetic.Reverse();
                    var settings = input.GetProperty("projectSettings");
                    var design = CableDesignLength.Calculate(synthetic, Decimal(settings, "connectionSpareMeters"),
                        Decimal(settings, "secondaryLengthMeters"), Decimal(settings, "increasePercent"));
                    return new { status = "returned", lengthBeforePercentageMeters = D(design.LengthBeforePercentageMeters),
                        unroundedLengthMeters = D(design.UnroundedLengthMeters), designLengthMeters = D(design.DesignLengthMeters) };
                case "parse":
                    return new { status = "returned", codes = RouteLookupCalculator.Parse(input.GetProperty("routing").GetString()) };
                case "name":
                    var names = input.GetProperty("leafToRootNames").EnumerateArray()
                        .Select(name => name.ValueKind == JsonValueKind.Null ? null : name.GetString()).ToArray();
                    return new { status = "returned", routeCode = RouteNameResolver.Resolve(names),
                        ownerIndex = RouteNameResolver.OwnerIndex(names) };
                case "geometry":
                    var built = TrayGeometryBuilder.Build(input.GetProperty("geometry").EnumerateArray().Select(Geometry));
                    return new { status = "returned", validatedBends = built.ValidatedBends, fallbackBends = built.FallbackBends,
                        validatedStraights = built.ValidatedStraights, fallbackStraights = built.FallbackStraights,
                        fallbackClearances = built.FallbackClearances, diagnostics = built.Diagnostics,
                        segments = built.Segments.Select(Segment).ToArray() };
                case "geometry-route":
                    var measured = TrayGeometryBuilder.Build(input.GetProperty("geometry").EnumerateArray().Select(Geometry));
                    var measuredRoute = new RouteCalculator().Calculate(measured.Segments, Point(input.GetProperty("from")),
                        Point(input.GetProperty("to")), (CableCategory)input.GetProperty("category").GetInt32(), Options(input));
                    return new { status = "returned", validatedBends = measured.ValidatedBends, fallbackBends = measured.FallbackBends,
                        validatedStraights = measured.ValidatedStraights, fallbackStraights = measured.FallbackStraights,
                        fallbackClearances = measured.FallbackClearances, diagnostics = measured.Diagnostics,
                        segments = measured.Segments.Select(Segment).ToArray(), route = Route(measuredRoute) };
                default: throw new ArgumentException("Unknown fixture kind.");
            }
        }
        catch (ArgumentException error)
        {
            return new { status = "exception", exceptionType = error.GetType().Name, parameter = error.ParamName };
        }
    }

    private static decimal Decimal(JsonElement value, string name)
    { return decimal.Parse(value.GetProperty(name).GetString(), NumberStyles.Number, Invariant); }
    private static string D(decimal value) { return value.ToString("G29", Invariant); }
    private static RoutePoint Point(JsonElement value)
    { var coordinates = value.EnumerateArray().Select(number => number.GetDouble()).ToArray(); return new RoutePoint(coordinates[0], coordinates[1], coordinates[2]); }
    private static double[] Point(RoutePoint value) { return new[] { value.X, value.Y, value.Z }; }

    private static RoutingOptions Options(JsonElement input)
    {
        var options = input.GetProperty("options");
        return new RoutingOptions {
            ConnectionToleranceMeters = options.GetProperty("connectionToleranceMeters").GetDouble(),
            SampleSpacingMeters = options.GetProperty("sampleSpacingMeters").GetDouble(),
            SecondaryDistanceMeters = options.GetProperty("secondaryDistanceMeters").GetDouble(),
            PreferVerticalApproach = options.GetProperty("preferVerticalApproach").GetBoolean(),
            MaxGraphNodes = options.GetProperty("maxGraphNodes").GetInt32(),
            MaxGraphConnections = options.GetProperty("maxGraphConnections").GetInt32()
        };
    }

    private static TraySegment[] Segments(JsonElement input)
    {
        return input.GetProperty("segments").EnumerateArray().Select(value => new TraySegment(
            value.GetProperty("id").GetString(), value.GetProperty("name").GetString(),
            (CableCategory)value.GetProperty("categories").GetInt32(), value.GetProperty("points").EnumerateArray().Select(Point),
            value.GetProperty("connectionsAtEndsOnly").GetBoolean())).ToArray();
    }

    private static TrayGeometryInput Geometry(JsonElement value)
    {
        var faces = value.GetProperty("faceExtents").EnumerateArray().Select(face => new TrayFaceExtent(
            (TrayBoxFace)face.GetProperty("face").GetInt32(), Point(face.GetProperty("minimum")),
            Point(face.GetProperty("maximum")), face.GetProperty("sampleCount").GetInt32())).ToArray();
        TrayMeshData mesh = null;
        var fragments = value.GetProperty("meshFragments");
        if (fragments.ValueKind != JsonValueKind.Null)
            mesh = new TrayMeshData(fragments.EnumerateArray().Select(fragment => new TrayMeshFragment(
                fragment.GetProperty("vertices").EnumerateArray().Select(Point),
                fragment.GetProperty("triangleIndices").EnumerateArray().Select(index => index.GetInt32()))));
        return new TrayGeometryInput(value.GetProperty("id").GetString(), value.GetProperty("routeName").GetString(),
            (CableCategory)value.GetProperty("categories").GetInt32(), value.GetProperty("shapeName").GetString(),
            Point(value.GetProperty("minimum")), Point(value.GetProperty("maximum")), faces, mesh);
    }

    internal static object Route(RouteResult value)
    {
        return new { success = value.Success, message = value.Message, routeText = value.RouteText,
            routeCodes = value.RouteCodes, segmentIds = value.SegmentIds,
            pathPoints = value.PathPoints.Select(Point).ToArray(), lengthMeters = value.LengthMeters,
            lengthRoundTrip = value.LengthMeters.ToString("R", Invariant),
            fromDistanceMeters = value.FromDistanceMeters, toDistanceMeters = value.ToDistanceMeters,
            fromRequiresSecondary = value.FromRequiresSecondary, toRequiresSecondary = value.ToRequiresSecondary,
            connectionGapCount = value.ConnectionGapCount, connectionGapLengthMeters = value.ConnectionGapLengthMeters };
    }

    private static object Segment(TraySegment value)
    {
        return new { id = value.Id, name = value.Name, routeCode = value.RouteCode,
            categories = (int)value.AllowedCategories, points = value.Points.Select(Point).ToArray(),
            connectionsAtEndsOnly = value.ConnectionsAtEndsOnly, connectionSurfaceCount = value.ConnectionSurfaces.Count,
            verifiedPorts = value.VerifiedPorts.Select(port => new { point = Point(port.Point), outward = Point(port.Outward),
                u = Point(port.U), v = Point(port.V), width = port.Width, height = port.Height }).ToArray() };
    }
}
