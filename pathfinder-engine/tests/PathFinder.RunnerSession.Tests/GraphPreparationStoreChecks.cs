using System.Text;

namespace PathFinder.RunnerSession.Tests;

internal static partial class TestProgram
{
    private static void GraphPreparationStoreChecks(string work)
    {
        string cacheRoot = Path.Combine(work, "graph-store"); Directory.CreateDirectory(cacheRoot);
        var store = new GraphPreparationStore(cacheRoot);
        string key = new('a', 64); byte[] payload = Encoding.UTF8.GetBytes("immutable-completed-graph-recipe");
        Check("graph-store-miss-is-optional", store.Read(key, default).Disposition == "missing");
        Check("graph-store-atomic-write", store.Write(key, payload, default) == "written");
        var loaded = store.Read(key, default);
        Check("graph-store-exact-roundtrip", loaded.Disposition == "disk" && loaded.Payload!.SequenceEqual(payload));
        string path = Path.Combine(cacheRoot, "graph-v1", key + ".graph");
        var corrupt = File.ReadAllBytes(path); corrupt[^1] ^= 1; File.WriteAllBytes(path, corrupt);
        Check("graph-store-checksum-refuses-corruption", store.Read(key, default).Disposition == "invalid");
        Check("graph-store-corrupt-entry-can-be-rebuilt", store.Write(key, payload, default) == "written" && store.Read(key, default).Payload!.SequenceEqual(payload));
        File.WriteAllBytes(path, payload);
        Check("graph-store-partial-publication-refused", store.Read(key, default).Disposition == "invalid");
        Check("graph-store-replaces-partial-publication", store.Write(key, payload, default) == "written");
        using (var fileLock = new FileStream(Path.Combine(cacheRoot, "graph-v1", "publication.lock"), FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            Check("graph-store-other-publisher-never-blocks-query", store.Write(new string('b', 64), payload, default) == "unavailable");
        Check("graph-store-one-entry-size-bounded", store.Write(key, new byte[GraphPreparationStore.MaximumPayloadBytes + 1], default) == "oversize");
        for (int index = 0; index < 7; index++)
            Check("graph-store-publish-" + index, store.Write(index.ToString("x64"), payload, default) == "written");
        Check("graph-store-entry-eviction-bounded", Directory.GetFiles(Path.Combine(cacheRoot, "graph-v1"), "*.graph").Length == GraphPreparationStore.MaximumEntries);
        Check("graph-store-latest-survives-eviction", store.Read(6.ToString("x64"), default).Payload!.SequenceEqual(payload));
        string foreign = Path.Combine(cacheRoot, "graph-v1", "keep-user-file.txt"); File.WriteAllText(foreign, "untouched");
        store.Write(key, payload, default);
        Check("graph-store-cleanup-only-owned-artifacts", File.ReadAllText(foreign) == "untouched");
        string abandoned = Path.Combine(cacheRoot, "graph-v1", new string('f', 32) + ".tmp");
        File.WriteAllText(abandoned, "incomplete-old-publication");
        Check("graph-store-crash-temporary-cleaned", store.Write(key, payload, default) == "written" && !File.Exists(abandoned));
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        try { store.Write(key, payload, cancelled.Token); Check("graph-store-cancel-before-publication", false); }
        catch (OperationCanceledException) { Check("graph-store-cancel-before-publication", true); }
        try { store.Read(key, cancelled.Token); Check("graph-store-cancel-before-load", false); }
        catch (OperationCanceledException) { Check("graph-store-cancel-before-load", true); }
        try { store.Read("../escape", default); Check("graph-store-key-cannot-escape-root", false); }
        catch (ArgumentException) { Check("graph-store-key-cannot-escape-root", true); }
        // Recreate the store to simulate process retirement/restart.
        Check("graph-store-survives-owner-restart", new GraphPreparationStore(cacheRoot).Read(key, default).Payload!.SequenceEqual(payload));
        string quotaRoot = Path.Combine(Path.GetFullPath(work), "graph-store-quota");
        if (Directory.Exists(quotaRoot)) throw new IOException("Quota fixture must be newly owned.");
        Directory.CreateDirectory(quotaRoot);
        try
        {
            var quota = new GraphPreparationStore(quotaRoot); var maximum = new byte[GraphPreparationStore.MaximumPayloadBytes];
            maximum[0] = 73; maximum[^1] = 29;
            for (int index = 0; index < 4; index++)
                Check("graph-store-maximum-payload-publish-" + index, quota.Write(index.ToString("x64"), maximum, default) == "written");
            var largest = quota.Read(3.ToString("x64"), default);
            Check("graph-store-exact-maximum-payload-roundtrip", largest.Payload is not null && largest.Payload.SequenceEqual(maximum));
            var files = Directory.GetFiles(Path.Combine(quotaRoot, "graph-v1"), "*.graph").Select(path => new FileInfo(path)).ToArray();
            Check("graph-store-byte-quota-includes-envelope", files.Length <= GraphPreparationStore.MaximumEntries
                && files.Sum(file => file.Length) <= GraphPreparationStore.MaximumDirectoryBytes && files.Length == 3);
        }
        finally
        {
            // This fixture was created above, has no child directories except
            // this exact store directory, and is removed without recursion.
            string artifactRoot = Path.Combine(quotaRoot, "graph-v1");
            if (Directory.Exists(artifactRoot))
            {
                foreach (string own in Directory.GetFiles(artifactRoot)) File.Delete(own);
                Directory.Delete(artifactRoot);
            }
            Directory.Delete(quotaRoot);
        }
    }
}
