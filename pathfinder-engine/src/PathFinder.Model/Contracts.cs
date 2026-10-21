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
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public string[]? LookupRouteCodes { get; init; }
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public CaptureInputScope? InputScope { get; init; }
}
// Recorded request/SDK-row coverage is provenance, not native or engineering proof.
public sealed record CaptureInputScope
{
    public required string SchemaVersion { get; init; }
    public required int EquipmentNameCount { get; init; }
    public required int ChunkCount { get; init; }
    public required int InputUtf8Bytes { get; init; }
    public required string ScopeSha256 { get; init; }
    public required string EquipmentNamesSha256 { get; init; }
    public required CapturePropertyScan PropertyScan { get; init; }
}
public sealed record CapturePropertyScan
{
    public required int IndexedObjectCount { get; init; }
    public required int AttemptedObjectCount { get; init; }
    public required int ReturnedObjectCount { get; init; }
    public required int OmittedObjectCount { get; init; }
    public required bool Complete { get; init; }
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
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public EquipmentEligibility? EquipmentEligibility { get; init; }
}
// Current SDK display evidence is not native visibility or engineering approval.
public sealed record EquipmentEligibility
{
    public required string SchemaVersion { get; init; }
    public required string MatchingPolicyVersion { get; init; }
    public required string VisibilityScopeSha256 { get; init; }
    public required string Visibility { get; init; }
    public required int CheckedAncestorCount { get; init; }
    public required string FragmentStatus { get; init; }
    public required int FragmentCount { get; init; }
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

/// <summary>Fixed optional diagnostic stages, without model or request data.</summary>
public enum PreparationMemoryPhase
{
    SourceRead, BeforeStrictParse, BeforeTokenValidation, AfterTokenValidation,
    BeforeTypedDeserialize, AfterTypedDeserialize, BeforeSemanticValidation, AfterSemanticValidation,
    StrictParse, RawDisposed, BeforePrepareInputs, AfterPrepareInputs, SnapshotTransferred,
    BeforeCoreFit, AfterCoreFit, BeforeDiskRestore, AfterDiskRestore, BeforeQuery
}

/// <summary>Owned exact file bytes. No caller-owned array or claimed hash can
/// construct this source. Dispose drops its large buffer before graph execution.</summary>
public sealed class VerifiedSnapshotSource : IDisposable
{
    private byte[]? bytes;
    internal VerifiedSnapshotSource(byte[] bytes, string sha256, ModelLimits limits)
    { this.bytes = bytes; Sha256 = sha256; Limits = limits; }
    public string Sha256 { get; }
    internal ModelLimits Limits { get; }
    internal ReadOnlyMemory<byte> Bytes => bytes ?? throw new ObjectDisposedException(nameof(VerifiedSnapshotSource));
    public void Dispose() => bytes = null;
}

/// <summary>Opaque strict reader result. Mutable snapshot arrays remain inside
/// this assembly; only checked bytes and the existing lookup resolver create it.</summary>
public sealed class CheckedModelSnapshot
{
    private ModelSnapshot? snapshot;
    internal CheckedModelSnapshot(ModelSnapshot snapshot, string sha256, string sourceSha256, ModelLimits limits,
        bool independentLookup, LookupScopeSummary? lookupScope = null)
    { this.snapshot = snapshot; Sha256 = sha256; SourceSha256 = sourceSha256; Limits = limits; IndependentLookup = independentLookup; Scope = lookupScope; }
    internal ModelSnapshot Snapshot => Volatile.Read(ref snapshot) ?? throw new InvalidOperationException("The checked snapshot was explicitly transferred for execution.");
    internal ModelSnapshot TakeForExecution() => Interlocked.Exchange(ref snapshot, null)
        ?? throw new InvalidOperationException("The checked snapshot was explicitly transferred for execution.");
    public string Sha256 { get; }
    internal string SourceSha256 { get; }
    internal ModelLimits Limits { get; }
    internal LookupScopeSummary? Scope { get; }
    public bool IndependentLookup { get; }
    public CheckedModelSnapshot ResolveLookup(string routeText, CancellationToken cancellation = default)
    {
        cancellation.ThrowIfCancellationRequested();
        var current = Snapshot;
        if (!IndependentLookup) throw new ArgumentException("A dedicated independent lookup capture is required.");
        var resolved = LookupScopeResolver.Resolve(current, LookupScopeResolver.Plan(routeText, cancellation), Limits, cancellation);
        var bytes = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(resolved.Snapshot, SnapshotReader.JsonOptions);
        if (bytes.Length > Limits.MaximumBytes) throw new ArgumentException("Snapshot byte budget exceeded.");
        cancellation.ThrowIfCancellationRequested();
        return new(resolved.Snapshot, SnapshotReader.Sha256(bytes), SourceSha256, Limits, true, resolved.Scope);
    }
}

/// <summary>Opaque detached fitting input. Only the strict checked-source cache
/// factory can create it; no mutable snapshot, raw bytes, or Core mesh arrays are
/// exposed. Rules, validation limits and the fitted cache key are bound at creation.</summary>
public sealed class PreparedExecutionInput
{
    internal PreparedExecutionInput(ModelIdentity model, string sha256, string sourceSha256, ModelLimits limits,
        bool independentLookup, LookupScopeSummary? scope, string key, string rulesHash, string rulesContextSha256, TrayGeometryInput[] inputs,
        PreparedObject[] objects, string[] diagnostics, bool needsReview, bool requiresCategoryAssignment)
    { Model = model; Sha256 = sha256; SourceSha256 = sourceSha256; Limits = limits; IndependentLookup = independentLookup;
        Scope = scope; Key = key; RulesHash = rulesHash; RulesContextSha256 = rulesContextSha256; Inputs = inputs; Objects = objects; Diagnostics = diagnostics;
        NeedsReview = needsReview; RequiresCategoryAssignment = requiresCategoryAssignment; }
    public ModelIdentity Model { get; }
    public string Sha256 { get; }
    public string SourceSha256 { get; }
    public bool IndependentLookup { get; }
    public string RulesContextSha256 { get; }
    internal ModelLimits Limits { get; }
    internal LookupScopeSummary? Scope { get; }
    internal string Key { get; }
    internal string RulesHash { get; }
    internal TrayGeometryInput[] Inputs { get; }
    internal PreparedObject[] Objects { get; }
    internal string[] Diagnostics { get; }
    internal bool NeedsReview { get; }
    internal bool RequiresCategoryAssignment { get; }
}

/// <summary>Small trusted source guards plus exact fitted geometry. No raw
/// snapshot/byte arrays or calculated cable route are retained by a session.</summary>
public sealed class PreparedExecution
{
    private readonly LookupScopeSummary? lookupScope;
    internal PreparedExecution(PreparedModel prepared, ModelIdentity model, string sourceSha256,
        bool independentLookup, bool requiresCategoryAssignment, LookupScopeSummary? lookupScope)
    { Prepared = prepared; Model = model; SourceSha256 = sourceSha256; IndependentLookup = independentLookup;
        RequiresCategoryAssignment = requiresCategoryAssignment; this.lookupScope = lookupScope; }
    public PreparedModel Prepared { get; }
    public ModelIdentity Model { get; }
    public string SourceSha256 { get; }
    public bool IndependentLookup { get; }
    public bool RequiresCategoryAssignment { get; }
    public LookupScopeSummary? LookupScope => lookupScope is null ? null : lookupScope with { Warnings = lookupScope.Warnings.ToArray() };
}
