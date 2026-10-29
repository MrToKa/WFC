using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using AddinRibbon.Routing;

// One owner per native session; a one-shot request receives the same bounded
// durable behavior with a transient owner. Endpoints never enter its identity.
internal sealed class GraphPreparationRuntime
{
    private readonly GraphPreparationCache cache = new(4, GraphPreparationStore.MaximumPayloadBytes);
    private static readonly Lazy<string> CoreIdentity = new(() => Convert.ToHexString(SHA256.HashData(
        File.ReadAllBytes(typeof(GraphPreparationCache).Assembly.Location))).ToLowerInvariant());
    private string? root, identity;
    private long persistedRevision = -1;

    internal GraphPreparationLease Begin(string cacheRoot, string preparedIdentity, string requestId,
        double preparationMilliseconds, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        bool enabled = Environment.GetEnvironmentVariable("PF_ENGINE_GRAPH_CACHE") == "1";
        string restore = enabled ? "memory" : "disabled";
        // Actual algorithm bytes participate in durable invalidation. A future
        // core upgrade cannot reuse a same-version recipe by accident. Current
        // geometry is independently checked by the core on every admission.
        if (enabled)
        {
            try { preparedIdentity = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
                "wfc.pf.graph-runtime.v1\n" + preparedIdentity + "\n" + GraphPreparationCache.Version + "\n" + CoreIdentity.Value))).ToLowerInvariant(); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException)
            { enabled = false; restore = "unavailable"; }
        }
        double restoreMilliseconds = 0;
        GraphPreparationStore? store = null;
        if (enabled)
        {
            try
            {
                store = new GraphPreparationStore(cacheRoot);
                if (root != cacheRoot || identity != preparedIdentity)
                {
                    cache.Clear(); root = cacheRoot; identity = preparedIdentity; persistedRevision = -1;
                    var clock = Stopwatch.StartNew();
                    var loaded = store.Read(preparedIdentity, token); restore = loaded.Disposition;
                    if (loaded.Payload is not null)
                    {
                        if (cache.Import(preparedIdentity, loaded.Payload, token)) persistedRevision = cache.Revision;
                        else restore = "invalid";
                    }
                    restoreMilliseconds = clock.Elapsed.TotalMilliseconds;
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException
                or ArgumentException or InvalidOperationException or OverflowException)
            { store = null; identity = null; enabled = false; restore = "unavailable"; }
        }
        return new GraphPreparationLease(cache, store, cache.BeginRequest(preparedIdentity, enabled), preparedIdentity,
            requestId, preparationMilliseconds, restoreMilliseconds, restore, persistedRevision,
            revision => persistedRevision = revision, token);
    }
}

internal sealed class GraphPreparationLease : IDisposable
{
    private readonly GraphPreparationCache cache;
    private readonly GraphPreparationStore? store;
    private readonly GraphPreparationRequest request;
    private readonly string identity, requestId, restore;
    private readonly double preparationMilliseconds, restoreMilliseconds;
    private readonly long persistedRevision;
    private readonly Action<long> persisted;
    private readonly CancellationToken token;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private bool disposed;

    internal GraphPreparationLease(GraphPreparationCache cache, GraphPreparationStore? store, GraphPreparationRequest request,
        string identity, string requestId, double preparationMilliseconds, double restoreMilliseconds, string restore,
        long persistedRevision, Action<long> persisted, CancellationToken token)
    {
        this.cache = cache; this.store = store; this.request = request; this.identity = identity; this.requestId = requestId;
        this.preparationMilliseconds = preparationMilliseconds; this.restoreMilliseconds = restoreMilliseconds; this.restore = restore;
        this.persistedRevision = persistedRevision; this.persisted = persisted; this.token = token;
    }

    public void Dispose()
    {
        if (disposed) return; disposed = true;
        double calculationMilliseconds = clock.Elapsed.TotalMilliseconds;
        double publicationMilliseconds = 0; string publication = "unchanged";
        try
        {
            // No export / filesystem work on a memory hit. Cancelled requests
            // retain no newly published disk artifact. The core publishes only
            // immutable completed recipes and independently checked observations.
            if (store is not null && !token.IsCancellationRequested && cache.Revision != persistedRevision)
            {
                var publicationClock = Stopwatch.StartNew(); long revision = cache.Revision;
                var bytes = cache.Export(identity, token);
                if (bytes is not null)
                {
                    publication = store.Write(identity, bytes, token);
                    if (publication == "written") persisted(revision);
                }
                else publication = "empty";
                publicationMilliseconds = publicationClock.Elapsed.TotalMilliseconds;
            }
        }
        // A diagnostic/cache failure must never replace a valid engineering
        // result. Cancellation itself is still checked by the request owner.
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException
            or ArgumentException or InvalidOperationException or OverflowException or OperationCanceledException)
        { publication = "unavailable"; }
        finally
        {
            request.Dispose();
            GraphPreparationTrace.Observe(requestId, preparationMilliseconds, restoreMilliseconds, calculationMilliseconds,
                publicationMilliseconds, restore, publication, request.Diagnostics);
        }
    }
}
