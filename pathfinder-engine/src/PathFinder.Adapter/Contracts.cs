using System.Text.Json.Serialization;
using AddinRibbon.Routing;

namespace PathFinder.Adapter;

// These are strict transport DTOs, deliberately unrelated to the permissive PF-0 replay format.
public sealed record EngineRequest
{
    public required string SchemaVersion { get; init; }
    public required string RequestId { get; init; }
    public required string Operation { get; init; }
    public required int TimeoutMilliseconds { get; init; }
    public required string CoordinateSystem { get; init; }
    public required ProjectSettingsSnapshot ProjectSettings { get; init; }
    public required EngineOptions Options { get; init; }
    public string? Category { get; init; }
    public PointInput? From { get; init; }
    public PointInput? To { get; init; }
    public SegmentInput[]? Segments { get; init; }
    public GeometryInput[]? Geometry { get; init; }
    public string? RouteText { get; init; }
    public string[]? Names { get; init; }
    public bool Reverse { get; init; }
}

public sealed record ProjectSettingsSnapshot
{
    public required string Revision { get; init; }
    public required decimal? SecondaryTrayLength { get; init; }
    public required decimal EndConnectionLength { get; init; }
    public required decimal AdditionalBendingPercent { get; init; }
}

public sealed record EngineOptions
{
    public required double ConnectionToleranceMeters { get; init; }
    public required double SampleSpacingMeters { get; init; }
    public required double SecondaryDistanceMeters { get; init; }
    public required bool PreferVerticalApproach { get; init; }
    public required int MaxGraphNodes { get; init; }
    public required int MaxGraphConnections { get; init; }
}

public sealed record PointInput
{
    public required double X { get; init; }
    public required double Y { get; init; }
    public required double Z { get; init; }
}

public sealed record PortInput
{
    public required PointInput Point { get; init; }
    public required PointInput Outward { get; init; }
    public required PointInput U { get; init; }
    public required PointInput V { get; init; }
    public required double Width { get; init; }
    public required double Height { get; init; }
}

public sealed record SegmentInput
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string[] AllowedCategories { get; init; }
    public required PointInput[] Points { get; init; }
    public required bool ConnectionsAtEndsOnly { get; init; }
    public PortInput[]? VerifiedPorts { get; init; }
    public SurfaceInput[]? ConnectionSurfaces { get; init; }
}

public sealed record SurfaceInput
{
    public required MeshInput Mesh { get; init; }
    public required PortInput[] VerifiedPorts { get; init; }
    public required bool EndsOnly { get; init; }
}

public sealed record MeshInput { public required FragmentInput[] Fragments { get; init; } }
public sealed record FragmentInput
{
    public required PointInput[] Vertices { get; init; }
    public required int[] TriangleIndices { get; init; }
}

public sealed record GeometryInput
{
    public required string Id { get; init; }
    public required string RouteName { get; init; }
    public required string[] Categories { get; init; }
    public required string ShapeName { get; init; }
    public required PointInput Minimum { get; init; }
    public required PointInput Maximum { get; init; }
    public FaceInput[]? FaceExtents { get; init; }
    public MeshInput? Mesh { get; init; }
}

public sealed record FaceInput
{
    public required string Face { get; init; }
    public required PointInput Minimum { get; init; }
    public required PointInput Maximum { get; init; }
    public required int SampleCount { get; init; }
}

public sealed record GeometrySummary(
    IReadOnlyList<SegmentSummary> Segments, int ValidatedBends, int FallbackBends,
    int ValidatedStraights, int FallbackStraights, int FallbackClearances,
    IReadOnlyList<string> Diagnostics);
public sealed record SegmentSummary(string Id, string Name, string RouteCode,
    CableCategory AllowedCategories, IReadOnlyList<RoutePoint> Points, bool ConnectionsAtEndsOnly,
    IReadOnlyList<RouteConnectionPort> VerifiedPorts, int ConnectionSurfaceCount);

public sealed record AdapterResponse
{
    public string SchemaVersion { get; init; } = "pathfinder.pf1.response.v1";
    public string EngineVersion { get; init; } = "pathfinder-45c24bf5-pf1";
    public string AdapterVersion { get; init; } = "pf1.adapter.v1";
    public string CategoryMappingVersion { get; init; } = "wfc-mto-v1";
    public string? RequestId { get; init; }
    public string? Operation { get; init; }
    public required string Status { get; init; }
    public required string Message { get; init; }
    public string? EffectiveCategory { get; init; }
    public ProjectSettingsSnapshot? ProjectSettings { get; init; }
    public RouteResult? Route { get; init; }
    public CableDesignLength? Design { get; init; }
    public GeometrySummary? Geometry { get; init; }
    public IReadOnlyList<string>? ParsedCodes { get; init; }
    public string? ResolvedName { get; init; }
    public int? OwnerIndex { get; init; }
}
