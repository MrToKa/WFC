using System.Text.Json;
using PathFinder.Model;

internal sealed class SessionExecutionContext
{
    private FittedModelCache? cache;
    private PreparedExecution? previous;
    private string? identity;
    private string? sourceIdentity;
    private string? barrierIdentity;
    internal PreparedBarriers? BarrierCache { get; private set; }
    internal void SelectBarrierKey(string next)
    {
        // At most one qualified kernel is retained; discard a superseded scope
        // before reading/allocating its replacement. File hashes are rechecked
        // by the caller even when this immutable qualification can be reused.
        if (barrierIdentity != next) { BarrierCache = null; barrierIdentity = next; }
    }
    internal void StoreBarriers(PreparedBarriers value) => BarrierCache = value;
    internal string Reuse { get; private set; } = "none";
    internal void BeginRequest() => Reuse = "none";
    internal void Discard()
    {
        cache = null; previous = null; identity = null; sourceIdentity = null;
        BarrierCache = null; barrierIdentity = null; Reuse = "none";
    }
    private static string BoundIdentity(string root, string sha256, string rulesSha256) => root + "\n" + sha256 + "\n" + rulesSha256;
    private static string Identity(string root, string sha256, ModelBuildRules? rules) => BoundIdentity(root, sha256,
        SnapshotReader.Sha256(JsonSerializer.SerializeToUtf8Bytes(rules ?? new(), SnapshotReader.JsonOptions)));
    internal void SelectPlanningSource(string root, string expectedSourceSha256, ModelBuildRules? rules, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (sourceIdentity != Identity(root, expectedSourceSha256, rules))
        { cache = null; previous = null; identity = null; sourceIdentity = null; }
    }
    internal bool TryReusePlanning(string root, string sourceSha256, string projectId, string modelVersionId,
        ModelBuildRules? rules, CancellationToken token, out PreparedExecution? execution)
    {
        token.ThrowIfCancellationRequested(); execution = null;
        SelectPlanningSource(root, sourceSha256, rules, token);
        if (previous is null) return false;
        if (previous.Model.ProjectId != projectId || previous.Model.ModelVersionId != modelVersionId)
            throw new ArgumentException("Snapshot project/model identity mismatch.");
        // Dedicated lookup must resolve its ordered logical-owner scope on every
        // request. It can never use planning's raw-source shortcut.
        if (previous.IndependentLookup) return false;
        Reuse = "memory"; execution = previous; return true;
    }
    internal PreparedExecution Prepare(string root, CheckedModelSnapshot source, ModelBuildRules? rules, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        // Deliberately stricter than normalized exclusion ordering. The fitted
        // identity uses resolved lookup bytes; original file identity is separate.
        var next = Identity(root, source.Sha256, rules);
        if (identity != next) { cache = new FittedModelCache(root, observer: PreparationMemoryTrace.Observer); previous = null; identity = next; }
        var result = cache!.GetOrBuildExecution(source, rules, token);
        Reuse = ReferenceEquals(previous?.Prepared, result.Prepared) ? "memory" : result.Prepared.LoadedFromDisk ? "disk" : "build";
        previous = result;
        sourceIdentity = Identity(root, result.SourceSha256, rules);
        return result;
    }
    internal PreparedExecution Prepare(string root, PreparedExecutionInput source, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var next = BoundIdentity(root, source.Sha256, source.RulesContextSha256);
        if (identity != next) { cache = new FittedModelCache(root, observer: PreparationMemoryTrace.Observer); previous = null; identity = next; }
        var result = cache!.GetOrBuildExecution(source, token);
        Reuse = ReferenceEquals(previous?.Prepared, result.Prepared) ? "memory" : result.Prepared.LoadedFromDisk ? "disk" : "build";
        previous = result;
        sourceIdentity = BoundIdentity(root, result.SourceSha256, source.RulesContextSha256);
        return result;
    }
}
