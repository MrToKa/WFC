namespace PathFinder.BarrierVerifier;

/// <summary>Independent limits for a structural surface compilation. These do
/// not change v1 capture limits or establish measured model capacity.</summary>
public sealed record SurfaceCatalogLimits
{
    public int MaximumNodes { get; init; } = 1_048_576;
    public int MaximumFragments { get; init; } = 1_048_576;
    public int MaximumRanges { get; init; } = 16_777_216;
    public int MaximumParts { get; init; } = 1_048_576;
    public int MaximumPages { get; init; } = 65_536;
    public int PageTriangles { get; init; } = 4096;
    public long MaximumTriangles { get; init; } = 50_000_000;
    public long MaximumInputBytes { get; init; } = 8L * 1024 * 1024 * 1024;
    public long MaximumOutputBytes { get; init; } = 8L * 1024 * 1024 * 1024;
    public long MinimumFreeBytes { get; init; } = 64L * 1024 * 1024;
    public long MaximumWork { get; init; } = 1_000_000_000;
    public int MaximumMilliseconds { get; init; } = 900_000;
}
public sealed record SurfaceSealedStream
{
    public required ReadOnlyMemory<byte> SealUtf8 { get; init; }
    public required IEnumerable<ReadOnlyMemory<byte>> PagesUtf8 { get; init; }
}
public sealed record SurfacePartInput
{
    public required uint PartIndex { get; init; }
    public required ReadOnlyMemory<byte> Payload { get; init; }
    public required ReadOnlyMemory<byte> ReceiptUtf8 { get; init; }
}
/// <summary>One-pass streams exported from protected immutable stored evidence.
/// Pure file callers have no storage/currentness authority. Hash consistency
/// cannot independently prove SDK ancestry, source bytes or producer truth.</summary>
public sealed record SurfaceCatalogSource
{
    public required PackedPartContext Context { get; init; }
    public required int SelectedParentCount { get; init; }
    public required ReadOnlyMemory<byte> ScopeHashInputUtf8 { get; init; }
    public required ReadOnlyMemory<byte> ProfileHashInputUtf8 { get; init; }
    public required ReadOnlyMemory<byte> FrameHashInputUtf8 { get; init; }
    public required ReadOnlyMemory<byte> CompletionReceiptUtf8 { get; init; }
    public required SurfaceSealedStream Nodes { get; init; }
    public required SurfaceSealedStream Fragments { get; init; }
    public required SurfaceSealedStream GeometryRanges { get; init; }
    public required SurfaceSealedStream Plan { get; init; }
    public required IEnumerable<SurfacePartInput> Parts { get; init; }
    public Action? VerifyCurrent { get; init; }
}
public sealed record SurfaceCatalogCounts(uint Nodes, uint Fragments, uint Ranges, uint Parts, uint Pages,
    ulong Vertices, ulong Triangles, ulong InputBytes, ulong OutputBytes);
public sealed record SurfaceCatalogFile(string Sha256, ulong Bytes);
public sealed record SurfaceCatalogManifest
{
    public string SchemaVersion { get; init; } = "wfc.pf.barrier-surface-catalog.v1";
    public string GeometryPolicy { get; init; } = "original-triangles-structural-surface-data.v1";
    public string GeometryValidation { get; init; } = "STRUCTURAL_COMPLETE";
    public string Qualification { get; init; } = "NOT_MEASURED";
    public string Authority { get; init; } = "none";
    public string SourceGeometryProvenance { get; init; } = "protected-producer-reported";
    public string HierarchyMembershipProvenance { get; init; } = "protected-producer-reported";
    public bool SdkSourceBytesVerified { get; init; }
    public bool SolidOccupancyQualified { get; init; }
    public required PackedPartContext Context { get; init; }
    public required uint SelectedParentCount { get; init; }
    public required string CompletionReceiptSha256 { get; init; }
    public required string PartsSha256 { get; init; }
    public required SurfaceCatalogCounts Counts { get; init; }
    public required SurfaceCatalogFile Index { get; init; }
    public required SurfaceCatalogFile Ranges { get; init; }
    public required SurfaceCatalogFile RangeIndex { get; init; }
}
public sealed record SurfaceCatalogRange(uint RangeOrdinal, uint FragmentOrdinal, uint FragmentId, uint OwnerNodeOrdinal,
    uint OwnerDbId, string MembershipMask, uint PartIndex, uint TriangleStart, uint TriangleCount,
    uint ReferencedVertexCount, uint SourceVertexCount, uint SourceTriangleCount, string SourceGeometrySha256,
    string TransformSha256, string SourceVertexIdsSha256, string SourceIndicesSha256, string RangeSha256,
    string PayloadSha256, ReadOnlyMemory<byte> TransformBytes, string DescriptorSha256, string CommandSha256, string ReceiptSha256, ulong FirstGlobalTriangle);
public sealed class SurfaceCatalogRefusalException(string code) : ArgumentException("Surface catalog refused: " + code)
{
    public string Code { get; } = code;
}
