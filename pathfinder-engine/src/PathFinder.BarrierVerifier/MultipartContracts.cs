using System.Text.Json.Serialization;

namespace PathFinder.BarrierVerifier;

/// <summary>Local packed-byte refusal ceilings, not measured model capacity.</summary>
public sealed record PackedPartLimits
{
    public int MaximumBytes { get; init; } = 33_554_432;
    public int MaximumRanges { get; init; } = 8192;
    public int MaximumVertices { get; init; } = 500_000;
    public int MaximumTriangles { get; init; } = 250_000;
    public int MaximumFrameBytes { get; init; } = 65_536;
    public long MaximumWork { get; init; } = 40_000_000;
    public int MaximumMilliseconds { get; init; } = 60_000;
}

public sealed record PackedProducerProfile
{
    public required string SchemaVersion { get; init; }
    public required string SdkVersion { get; init; }
    public required string TriangleOrder { get; init; }
    public required string GeometryDigest { get; init; }
    public required string Visibility { get; init; }
}
public sealed record PackedPartRoots
{
    public required string Nodes { get; init; }
    public required string Fragments { get; init; }
    [JsonPropertyName("geometry-ranges")]
    public required string GeometryRanges { get; init; }
    public required string Plan { get; init; }
}
public sealed record PackedPartContext
{
    public required string SchemaVersion { get; init; }
    public required string CodecVersion { get; init; }
    public required string IntentId { get; init; }
    public required string ContextSha256 { get; init; }
    public required string ScopeSha256 { get; init; }
    public required string ProfileSha256 { get; init; }
    public required string FrameSha256 { get; init; }
    public required PackedProducerProfile ProducerProfile { get; init; }
    public required PackedPartRoots Roots { get; init; }
    public required uint PartIndex { get; init; }
    public required string SourceGeometryProvenance { get; init; }
    public required bool SdkSourceBytesVerified { get; init; }
}
public sealed record PackedExpectedPart
{
    public required PackedPartContext Context { get; init; }
    public required uint RangeCount { get; init; }
    public required long PlannedEncodedBytesUpperBound { get; init; }
}
public sealed record PackedGeometryRange
{
    public required uint FragmentOrdinal { get; init; }
    public required uint TriangleStart { get; init; }
    public required uint TriangleCount { get; init; }
    public required uint ReferencedVertexCount { get; init; }
    public required string SourceVertexIdsSha256 { get; init; }
    public required string SourceIndicesSha256 { get; init; }
    public required string SourceGeometrySha256 { get; init; }
    public required string TransformSha256 { get; init; }
    public required string MembershipMask { get; init; }
}
public sealed record PackedPlanPlacement
{
    public required uint PartIndex { get; init; }
    public required uint RangeOrdinal { get; init; }
    public required uint FragmentOrdinal { get; init; }
    public required uint TriangleStart { get; init; }
    public required uint TriangleCount { get; init; }
    public required uint ReferencedVertexCount { get; init; }
    public required string RangeSha256 { get; init; }
    public required long PlannedEncodedBytesUpperBound { get; init; }
}
public sealed record PackedFragment
{
    public required uint FragmentId { get; init; }
    public required uint OwnerNodeOrdinal { get; init; }
    public required uint OwnerDbId { get; init; }
    public required string MembershipMask { get; init; }
    public required string Primitive { get; init; }
    public required string? SourceGeometrySha256 { get; init; }
    public required string? TransformSha256 { get; init; }
    public required uint SourceVertexCount { get; init; }
    public required uint SourceTriangleCount { get; init; }
}
public sealed record PackedExpectedRange
{
    public required PackedPlanPlacement Placement { get; init; }
    public required PackedGeometryRange Range { get; init; }
    public required PackedFragment Fragment { get; init; }
}

/// <summary>The caller supplies trusted sealed-page tuples and the exact durable
/// part receipt. Shape parsing does not make these inputs authoritative. The
/// cursor must itself be bounded/cancellable; it is consumed once in lockstep.</summary>
public sealed record PackedPartExpectedDescriptor
{
    public required PackedExpectedPart Part { get; init; }
    public required string PayloadSha256 { get; init; }
    public required int PayloadBytes { get; init; }
    public required ReadOnlyMemory<byte> FrameHashInputUtf8 { get; init; }
    public required string FrameSha256 { get; init; }
    public required IEnumerable<PackedExpectedRange> Ranges { get; init; }
}
public sealed record PackedPartCounts(int Ranges, int FragmentRefs, int Vertices, int Triangles, int Bytes);
public sealed record PackedPartValidationReport(PackedPartContext Context, string DescriptorSha256,
    string PayloadSha256, PackedPartCounts Counts)
{
    public string SchemaVersion => "wfc.pf.barrier-packed-validation.v1";
    public string GeometryValidation => "STRUCTURAL_ONLY";
    public string Qualification => "NOT_MEASURED";
    public string Authority => "none";
    public string SourceGeometryProvenance => "protected-producer-reported";
    public bool SdkSourceBytesVerified => false;
}
public sealed class PackedPartRefusalException(string code) : ArgumentException("Packed structural validation refused: " + code)
{
    public string Code { get; } = code;
}
