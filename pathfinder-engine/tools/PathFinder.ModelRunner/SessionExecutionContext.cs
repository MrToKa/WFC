using System.Text.Json;
using PathFinder.Model;

internal sealed class SessionExecutionContext
{
    private FittedModelCache? cache;
    private PreparedModel? previous;
    private string? identity;
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
    internal PreparedModel Prepare(string root, byte[] bytes, ModelBuildRules? rules, CancellationToken token)
    {
        // Deliberately stricter than the cache's normalized exclusion ordering. An
        // input change may miss memory reuse, but never broadens its authority.
        var next = root + "\n" + SnapshotReader.Sha256(bytes) + "\n"
            + SnapshotReader.Sha256(JsonSerializer.SerializeToUtf8Bytes(rules ?? new(), SnapshotReader.JsonOptions));
        if (identity != next) { cache = new FittedModelCache(root); previous = null; identity = next; }
        var result = cache!.GetOrBuild(bytes, rules, token);
        Reuse = ReferenceEquals(previous, result) ? "memory" : result.LoadedFromDisk ? "disk" : "build";
        previous = result;
        return result;
    }
}
