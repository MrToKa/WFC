using PathFinder.Barriers;

namespace PathFinder.BarrierVerifier;

public sealed record MixedBarrierComponentMembership(string ComponentId, string Kind, IReadOnlyList<int> FragmentIds,
    IReadOnlyList<string> ParentSelectionIds, int TriangleCount, string SourceMembershipSha256);
public sealed record MixedBarrierVerifierEvidence(string CaptureId, BarrierVerifierScope Scope, int OriginalSurfaceComponents,
    int QualifiedClosedSolidComponents, int FragmentCount, int VertexCount, int TriangleCount,
    string OriginalGeometrySha256, string VerificationSha256, double NumericToleranceMetres, IReadOnlyList<MixedBarrierComponentMembership> ComponentMemberships)
{
    public string InputSchemaVersion => "wfc.pf.barrier-capture.v1";
    public string PolicyVersion => MixedBarrierKernel.PolicyVersion;
    public string Coverage => "provided-fragments-only";
    public string GeometryProvenance => "capture-bound-provided-original-triangles";
    public bool SdkCoverageVerified => false;
    public bool SdkSourceBytesVerified => false;
    public bool CurrentFrameVerified => false;
    public bool EngineeringAccepted => false;
    public bool OwnTerminalExemptionsSupported => false;
    public string Authority => "none";
}
public sealed record MixedBarrierVerifierReceipt(string Status, string? CaptureSha256, MixedBarrierVerifierEvidence? Evidence,
    IReadOnlyList<BarrierVerifierDiagnostic> Diagnostics)
{
    public string SchemaVersion => "wfc.pf.barrier-mixed-verification-result.v2";
    public string ProducerVersion => MixedBarrierCaptureVerifier.ProducerVersion;
}
public sealed record MixedBarrierCapture(MixedBarrierKernel Kernel, IReadOnlyList<MixedBarrierComponent> Components);
public sealed record MixedBarrierVerificationResult(MixedBarrierVerifierReceipt Receipt, MixedBarrierCapture? Qualified);
