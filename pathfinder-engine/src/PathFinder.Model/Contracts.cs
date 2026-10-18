using AddinRibbon.Routing;

namespace PathFinder.Model;

public sealed record ModelSnapshot
{
    public required string SchemaVersion { get; init; }
    public required ModelIdentity Model { get; init; }
    public required CaptureEvidence Capture { get; init; }
    public required CoordinateEvidence Coordinates { get; init; }
    public required SnapshotObject[] Objects { get; init; }
}
public sealed record ModelIdentity
{
    public required string ProjectId { get; init; }
    public required string ModelVersionId { get; init; }
    public required string ContentSha256 { get; init; }
    public string? SourceContentSha256 { get; init; }
}
public sealed record CaptureEvidence
{
    public required string AdapterVersion { get; init; }
    public required string SourceKind { get; init; }
    public required bool InventoryComplete { get; init; }
    public required bool GeometryComplete { get; init; }
    public required bool UnitsVerified { get; init; }
    public required bool TransformsVerified { get; init; }
    public required bool PlanningVisibilityKnown { get; init; }
    public required bool SourceLinkVerified { get; init; }
    public required string[] EvidenceSha256 { get; init; }
}
public sealed record CoordinateEvidence
{
    public required string VertexFrame { get; init; }
    public required string SourceUnits { get; init; }
    public required double? MetresPerSourceUnit { get; init; }
    public required double[]? SourceToWorldMetres { get; init; }
    public required double[] GlobalOffsetMetres { get; init; }
    public required double[] DisplayToWorldMetres { get; init; }
}
public sealed record ObjectProperty
{
    public required string Category { get; init; }
    public required string Name { get; init; }
    public required string Value { get; init; }
}
public sealed record SnapshotBounds
{
    public required double[] Minimum { get; init; }
    public required double[] Maximum { get; init; }
}
public sealed record SnapshotFace
{
    public required string Face { get; init; }
    public required SnapshotBounds Bounds { get; init; }
    public required int SampleCount { get; init; }
}
public sealed record SnapshotFragment
{
    public required string Id { get; init; }
    public required double[][] Vertices { get; init; }
    public required int[] TriangleIndices { get; init; }
    public required double[]? FragmentToWorldMetres { get; init; }
    public required bool TransformAlreadyApplied { get; init; }
}
public sealed record SnapshotObject
{
    public required string Id { get; init; }
    public string? ParentId { get; init; }
    public string? ExternalId { get; init; }
    public int? DbId { get; init; }
    public required string Name { get; init; }
    public required string GeometryRole { get; init; }
    public required string[] LeafToRootNames { get; init; }
    public required ObjectProperty[] Properties { get; init; }
    public required bool? NativeHidden { get; init; }
    public required bool PlanningExcluded { get; init; }
    public string? RouteName { get; init; }
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public string? RouteBoundaryId { get; init; }
    public string? ShapeName { get; init; }
    public required string CategoryAssignmentSource { get; init; }
    public required string[] AllowedCategories { get; init; }
    public required SnapshotBounds Bounds { get; init; }
    public required SnapshotFragment[] Fragments { get; init; }
    public SnapshotFace[]? FaceExtents { get; init; }
}

public sealed record ModelLimits
{
    // These are explicit resource ceilings, not a claim that the real model fits them.
    public int MaximumBytes { get; init; } = 256 * 1024 * 1024;
    public int MaximumObjects { get; init; } = 1_000_000;
    public int MaximumFragments { get; init; } = 100_000;
    public int MaximumVertices { get; init; } = 5_000_000;
    public int MaximumTriangles { get; init; } = 5_000_000;
    public int MaximumDepth { get; init; } = 512;
    public int MaximumPropertiesPerObject { get; init; } = 1024;
    public int MaximumCachedModels { get; init; } = 2;
}
public sealed record ModelBuildRules
{
    public string Version { get; init; } = "pf2.rules.v1";
    public string CategoryMappingVersion { get; init; } = "wfc-mto-v1";
    public string[] ExcludedObjectIds { get; init; } = [];
}
public sealed record PreparedObject(string Id, string? ExternalId, int? DbId, string Name, string GeometryRole,
    string? ResolvedRouteName, string ShapeName, string Visibility, RoutePoint BottomCentreMetres);
public sealed record GeometryCounts(int ValidatedBends, int FallbackBends, int ValidatedStraights,
    int FallbackStraights, int FallbackClearances);
public sealed record PreparedModel(string Key, string SnapshotSha256, string RulesSha256,
    string ProjectId, string ModelVersionId, string ContentSha256,
    string Readiness, IReadOnlyList<TraySegment> Segments, IReadOnlyList<PreparedObject> Objects,
    GeometryCounts Counts, IReadOnlyList<string> Diagnostics, bool LoadedFromDisk)
{
    public string CacheScope => "fitted-centerlines-ports-and-canonical-mesh;surface-bvh-reconstructed-on-disk-load;graph-per-calculation";
    public bool ReadyForEngineeringWrites => false; // A PF-2 snapshot is not an authorization/parity acceptance token.
}
