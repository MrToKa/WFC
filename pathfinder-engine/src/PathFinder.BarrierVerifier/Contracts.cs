using PathFinder.Barriers;

namespace PathFinder.BarrierVerifier;

public sealed record BarrierVerifierLimits
{
    public int MaximumBytes { get; init; } = 32 * 1024 * 1024;
    public int MaximumFragments { get; init; } = 8192;
    public int MaximumParents { get; init; } = 128;
    public int MaximumComputationalMeshes { get; init; } = 256;
    public int MaximumVertices { get; init; } = 500_000;
    public int MaximumTriangles { get; init; } = 250_000;
    public long MaximumWork { get; init; } = 40_000_000;
    public int MaximumMilliseconds { get; init; } = 60_000;
    public double NumericToleranceMetres { get; init; } = 1e-7;
}
public sealed record BarrierVerifierScope(string ProjectId, string ModelVersionId, string ContentFingerprint,
    string SelectionRevision, string CaptureFrameId, string CaptureFrameSha256, string CoordinateFrame);
public sealed record BarrierVerifierDiagnostic(string Code, string Message);
public sealed record BarrierVerifierEvidence(string CaptureId, BarrierVerifierScope Scope, int ComputationalMeshes,
    int FragmentCount, int VertexCount, int TriangleCount, string DecompositionSha256, string VerificationSha256,
    double NumericToleranceMetres)
{
    public string Topology => "qualified-closed-consistent-two-manifold";
    public string SelfIntersection => "bounded-verification-passed";
    public string Coverage => "provided-fragments-only";
    public bool SdkCoverageVerified => false;
    public bool EngineeringAccepted => false;
}
public sealed record BarrierVerifierReceipt(string Status, string? CaptureSha256, BarrierVerifierEvidence? Evidence,
    IReadOnlyList<BarrierVerifierDiagnostic> Diagnostics)
{
    public string SchemaVersion => "wfc.pf.barrier-verification-result.v1";
    public string ProducerVersion => BarrierCaptureVerifier.ProducerVersion;
}
public sealed record BarrierFragmentQualification(int FragmentId, IReadOnlyList<string> ParentSelectionIds,
    int Vertices, int Triangles, string SourceSha256);
public sealed record BarrierTriangleSource(int FragmentId, int LocalTriangleIndex, IReadOnlyList<string> ParentSelectionIds);
public sealed record QualifiedBarrierMesh(BarrierMeshInput Mesh, IReadOnlyList<BarrierTriangleSource> TriangleSources);
public sealed record QualifiedBarrierCapture(BarrierCollisionKernel Kernel, IReadOnlyList<QualifiedBarrierMesh> Meshes,
    IReadOnlyList<BarrierFragmentQualification> Fragments);
public sealed record BarrierVerificationResult(BarrierVerifierReceipt Receipt, QualifiedBarrierCapture? Qualified);
