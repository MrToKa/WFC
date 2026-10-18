using PathFinder.Adapter;

namespace PathFinder.CapacityBench;

internal sealed record BenchManifest
{
    public required string SchemaVersion { get; init; }
    public required string Label { get; init; }
    public required SnapshotInput Snapshot { get; init; }
    public required CalculationInput Request { get; init; }
    public required int RepeatQueries { get; init; }
    public required int CaseTimeoutMilliseconds { get; init; }
    public required int TotalTimeoutMilliseconds { get; init; }
    public required int[] SyntheticSizes { get; init; }
}
internal sealed record SnapshotInput
{
    public required string Path { get; init; }
    public required string Sha256 { get; init; }
    public required string ProjectId { get; init; }
    public required string ModelVersionId { get; init; }
    public required string ContentSha256 { get; init; }
}
internal sealed record CalculationInput
{
    public required string Category { get; init; }
    public required double[] From { get; init; }
    public required double[] To { get; init; }
    public required EngineOptions Options { get; init; }
    public required ProjectSettingsSnapshot ProjectSettings { get; init; }
    public required string ConnectionGap { get; init; }
}
internal sealed record DatasetInput(string Label, string Kind, SnapshotInput Snapshot,
    CalculationInput Request, ExpectedSynthetic? Expected);
internal sealed record ExpectedSynthetic(double LengthMeters, string DesignLengthMeters, int SegmentCount,
    double FromDistanceMeters = 0, double ToDistanceMeters = 0, bool FromRequiresSecondary = false,
    bool ToRequiresSecondary = false, int ConnectionGapCount = 0, double ConnectionGapLengthMeters = 0);
internal sealed record Metrics(double WallMilliseconds, double CpuMilliseconds, long ManagedAllocatedBytes,
    long CurrentWorkingSetBytes, long LifetimePeakWorkingSetBytes, long PrivateMemoryBytes);
internal sealed record Phase(string Name, int Iteration, string Status, string Message, Metrics Metrics,
    object? Semantic, string? SemanticSha256, bool? MatchesCold, bool? LoadedFromDisk,
    bool ReusesPreparedReference);
