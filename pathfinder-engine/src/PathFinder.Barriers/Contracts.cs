namespace PathFinder.Barriers;

/// <summary>Canonical right-handed Z-up world coordinates, in metres.</summary>
public readonly record struct BarrierPoint(double X, double Y, double Z);

/// <summary>
/// One complete connected closed solid shell. Separate shells must be supplied as
/// separate records. Complete describes extraction coverage, not topology proof.
/// The kernel copies and independently qualifies all supplied vertices/triangles.
/// </summary>
public sealed record BarrierMeshInput(string Id, IReadOnlyList<BarrierPoint> Vertices,
    IReadOnlyList<int> TriangleIndices, bool Complete = true);

/// <summary>Resource ceilings, not evidence that an entire converted model fits.</summary>
public sealed record BarrierLimits
{
    public int MaximumMeshes { get; init; } = 256;
    public int MaximumTriangles { get; init; } = 250_000;
    public int MaximumVertices { get; init; } = 500_000;
    public int MaximumBvhNodes { get; init; } = 500_000;
    public long MaximumBuildWork { get; init; } = 40_000_000;
    public long MaximumQueryWork { get; init; } = 2_000_000;
    public int MaximumBuildMilliseconds { get; init; } = 60_000;
    public int MaximumQueryMilliseconds { get; init; } = 10_000;
    public long MaximumEstimatedBytes { get; init; } = 128L * 1024 * 1024;
    public int BvhLeafSize { get; init; } = 8;
    public double NumericToleranceMeters { get; init; } = 0.0000001;
    public double MaximumCoordinateMagnitude { get; init; } = 1_000_000_000;
}

public enum BarrierBuildStatus { Ready, Refused }
public enum BarrierSegmentStatus { Clear, Blocked, Indeterminate }
public sealed record BarrierDiagnostic(string Code, string Message, string? BarrierId = null);
public sealed record BarrierBuildResult(BarrierBuildStatus Status, BarrierCollisionKernel? Kernel,
    IReadOnlyList<BarrierDiagnostic> Diagnostics, long Work);
public sealed record BarrierSegmentResult(BarrierSegmentStatus Status, string? BarrierId, string Reason, long Work);

/// <summary>Describes the qualified domain; it is not a claim of physical cable clearance.</summary>
public sealed record BarrierKernelSummary(int MeshCount, int VertexCount, int TriangleCount, int BvhNodeCount,
    long EstimatedBytes, double NumericToleranceMeters)
{
    public string PolicyVersion => BarrierCollisionKernel.PolicyVersion;
    public string CollisionVersion => BarrierCollisionKernel.CollisionVersion;
    public string Scope => "centreline-versus-qualified-closed-triangle-solids";
    public bool PhysicalCableRadiusChecked => false;
}
