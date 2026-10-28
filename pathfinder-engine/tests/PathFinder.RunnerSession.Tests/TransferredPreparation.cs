using System.Reflection;
using System.Text;
using System.Text.Json.Nodes;
using PathFinder.Model;

namespace PathFinder.RunnerSession.Tests;

internal static partial class TestProgram
{
    private static async Task TransferredPreparation(string filename, string digest, string corpusRoot, string work, PreparedExecution baseline)
    {
        Directory.CreateDirectory(work);
        var cacheRoot = Path.Combine(work, "cache"); var cache = new FittedModelCache(cacheRoot);
        CheckedModelSnapshot Read(FittedModelCache reader)
        { using var source = reader.ReadSourceFile(filename, digest); return reader.ReadCheckedSnapshot(source, Corpus.Project, Corpus.Model); }
        Check("transferred-input-no-public-construction", typeof(PreparedExecutionInput).GetConstructors().Length == 0);
        Check("transferred-input-no-public-mutable-data", typeof(PreparedExecutionInput).GetProperties().All(property =>
            property.PropertyType == typeof(string) || property.PropertyType == typeof(bool) || property.PropertyType == typeof(ModelIdentity)));
        Check("transferred-input-has-no-snapshot-token-reference", typeof(PreparedExecutionInput).GetFields(BindingFlags.NonPublic | BindingFlags.Instance)
            .All(field => field.FieldType != typeof(ModelSnapshot) && field.FieldType != typeof(CheckedModelSnapshot) && field.FieldType != typeof(VerifiedSnapshotSource)));
        var checkedInput = Read(cache);
        var detached = cache.TransferForExecution(checkedInput);
        Check("transfer-clears-owned-dto-reference", typeof(CheckedModelSnapshot).GetField("snapshot", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(checkedInput) is null);
        Throws<InvalidOperationException>("consumed-token-reusable-cold-path-refused", () => cache.GetOrBuildExecution(checkedInput));
        Throws<InvalidOperationException>("consumed-token-repeated-transfer-refused", () => cache.TransferForExecution(checkedInput));
        Throws<InvalidOperationException>("consumed-token-lookup-refused", () => checkedInput.ResolveLookup("/BC001"));
        var cold = cache.GetOrBuildExecution(detached);
        Check("transferred-cold-exact-model-key-order-ports-surfaces", Fitted(cold.Prepared) == Fitted(baseline.Prepared)
            && cold.Model == baseline.Model && cold.SourceSha256 == digest && cold.RequiresCategoryAssignment == baseline.RequiresCategoryAssignment);
        Throws<InvalidOperationException>("consumed-token-warm-cache-hit-cannot-authorize", () => cache.GetOrBuildExecution(checkedInput));
        var warm = cache.GetOrBuildExecution(detached);
        Check("transferred-input-exact-warm-model-reference", ReferenceEquals(cold.Prepared, warm.Prepared));
        var diskCache = new FittedModelCache(cacheRoot); var disk = diskCache.GetOrBuildExecution(diskCache.TransferForExecution(Read(diskCache)));
        Check("transferred-disk-restores-exact-canonical-surfaces", disk.Prepared.LoadedFromDisk && Fitted(cold.Prepared) == Fitted(disk.Prepared));
        var session = new global::SessionExecutionContext(); var sessionInput = cache.TransferForExecution(Read(cache));
        session.Prepare(cacheRoot, sessionInput, CancellationToken.None);
        Check("transferred-session-retains-compact-current-model", session.TryReusePlanning(cacheRoot, digest, Corpus.Project, Corpus.Model, null, CancellationToken.None, out var reused)
            && Fitted(reused!.Prepared) == Fitted(cold.Prepared));
        session.SelectBarrierKey("synthetic-memory-refusal-context"); session.StoreBarriers(new global::PreparedBarriers(null, null));
        var memoryRequest = new Request { SchemaVersion = "pathfinder.model.runner.v1", RequestId = Guid.NewGuid().ToString("D"), Operation = "calculate",
            ProjectId = Corpus.Project, ModelVersionId = Corpus.Model, TimeoutMilliseconds = 30000 };
        var memoryRefusal = System.Text.Json.JsonSerializer.SerializeToElement(global::Program.WorkerCalculation(memoryRequest,
            () => throw new OutOfMemoryException("Synthetic injected failure."), session));
        Check("managed-oom-discards-previously-reusable-planning-and-barrier-context", memoryRefusal.GetProperty("status").GetString() == "resource_limit"
            && session.BarrierCache is null && session.Reuse == "none"
            && !session.TryReusePlanning(cacheRoot, digest, Corpus.Project, Corpus.Model, null, CancellationToken.None, out _));

        var reusable = Read(cache); cache.GetOrBuildExecution(reusable); cache.GetOrBuildExecution(reusable);
        Check("normal-checked-api-remains-reusable-until-explicit-transfer", Fitted(cache.GetOrBuildExecution(cache.TransferForExecution(reusable)).Prepared) == Fitted(cold.Prepared));
        var differentLimits = new FittedModelCache(Path.Combine(work, "other-limits"), new ModelLimits { MaximumObjects = 1_000_001 });
        Throws<ArgumentException>("transferred-input-cannot-cross-validation-limits", () => differentLimits.GetOrBuildExecution(detached));
        var intact = Read(cache);
        Throws<ArgumentException>("transfer-limit-refusal-before-consumption", () => differentLimits.TransferForExecution(intact));
        Throws<ArgumentException>("transfer-unknown-rules-before-consumption", () => cache.TransferForExecution(intact, new ModelBuildRules { Version = "unknown" }));
        Throws<ArgumentException>("transfer-unknown-exclusion-before-consumption", () => cache.TransferForExecution(intact, new ModelBuildRules { ExcludedObjectIds = ["not-in-snapshot"] }));
        using (var cancelled = new CancellationTokenSource())
        {
            cancelled.Cancel(); Throws<OperationCanceledException>("transfer-cancellation-before-take", () => cache.TransferForExecution(intact, cancellation: cancelled.Token));
        }
        Check("refused-pretransfer-validation-keeps-token-usable", Fitted(cache.GetOrBuildExecution(intact).Prepared) == Fitted(cold.Prepared));
        using (var cancelled = new CancellationTokenSource())
        {
            var cancellationCache = new FittedModelCache(Path.Combine(work, "cancelled-transfer"), observer: phase =>
            { if (phase == PreparationMemoryPhase.BeforePrepareInputs) cancelled.Cancel(); });
            var cancelledInput = Read(cancellationCache);
            Throws<OperationCanceledException>("transfer-cancellation-after-take", () => cancellationCache.TransferForExecution(cancelledInput, cancellation: cancelled.Token));
            Throws<InvalidOperationException>("failed-posttake-transfer-is-consumed", () => cancellationCache.GetOrBuildExecution(cancelledInput));
            Check("cancelled-transfer-cannot-publish-fitted-cache", Directory.GetFiles(Path.Combine(work, "cancelled-transfer")).Length == 0);
        }
        var raced = Read(cache);
        var transfers = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Task.Run(() =>
        {
            try { return cache.TransferForExecution(raced); }
            catch (InvalidOperationException) { return null; }
        })));
        Check("racing-transfer-has-exactly-one-owner", transfers.Count(value => value is not null) == 1);
        Check("racing-transfer-winner-preserves-exact-mesh", Fitted(cache.GetOrBuildExecution(transfers.Single(value => value is not null)!).Prepared) == Fitted(cold.Prepared));

        var excludes = new ModelBuildRules { ExcludedObjectIds = ["segment-2", "segment-3"] };
        var excludedOld = cache.GetOrBuildExecution(Read(cache), excludes);
        var excludedNew = cache.GetOrBuildExecution(cache.TransferForExecution(Read(cache), new ModelBuildRules { ExcludedObjectIds = ["segment-3", "segment-2"] }));
        Check("transferred-rules-normalized-key-and-order-preserved", excludedOld.Prepared.Key != cold.Prepared.Key
            && Fitted(excludedOld.Prepared) == Fitted(excludedNew.Prepared) && excludedNew.Prepared.Segments.Count == 1);
        var callerExclusions = new[] { "segment-2" }; var callerRules = new ModelBuildRules { ExcludedObjectIds = callerExclusions };
        var rulesBoundInput = cache.TransferForExecution(Read(cache), callerRules);
        callerExclusions[0] = "segment-3";
        var rulesSession = new global::SessionExecutionContext();
        var rulesPrepared = rulesSession.Prepare(cacheRoot, rulesBoundInput, CancellationToken.None);
        Check("transferred-input-detaches-original-rules-array", rulesPrepared.Prepared.Segments.Select(segment => segment.Id).SequenceEqual(new[] { "segment-1", "segment-3" }));
        Check("transferred-session-reuse-derived-from-bound-rules", rulesSession.TryReusePlanning(cacheRoot, digest, Corpus.Project, Corpus.Model,
            new ModelBuildRules { ExcludedObjectIds = ["segment-2"] }, CancellationToken.None, out _));
        Check("transferred-session-mismatched-rules-never-retain-model", !rulesSession.TryReusePlanning(cacheRoot, digest, Corpus.Project, Corpus.Model,
            callerRules, CancellationToken.None, out _));
        var orderedSession = new global::SessionExecutionContext();
        orderedSession.Prepare(cacheRoot, cache.TransferForExecution(Read(cache), excludes), CancellationToken.None);
        Check("transferred-session-keeps-stricter-original-exclusion-order", !orderedSession.TryReusePlanning(cacheRoot, digest, Corpus.Project, Corpus.Model,
            new ModelBuildRules { ExcludedObjectIds = ["segment-3", "segment-2"] }, CancellationToken.None, out _));

        // The guard covers included objects that cannot be fitted because their
        // route label is missing; checking only the final mesh would lose it.
        var categoryNode = JsonNode.Parse(File.ReadAllBytes(filename))!.AsObject();
        categoryNode["objects"]![1]!["categoryAssignmentSource"] = "unassigned";
        categoryNode["objects"]![1]!["allowedCategories"] = new JsonArray();
        // An absent override still resolves the pinned display-name fallback
        // '/FTUBE'. An explicit empty label exercises the missing-label branch.
        categoryNode["objects"]![1]!["routeName"] = "";
        categoryNode["objects"]![1]!["leafToRootNames"] = new JsonArray("FTUBE");
        var categoryBytes = Encoding.UTF8.GetBytes(categoryNode.ToJsonString()); var categoryFile = Path.Combine(work, "category.json"); File.WriteAllBytes(categoryFile, categoryBytes);
        CheckedModelSnapshot Category()
        { using var source = cache.ReadSourceFile(categoryFile, Hash(categoryBytes)); return cache.ReadCheckedSnapshot(source, Corpus.Project, Corpus.Model); }
        var categoryOld = cache.GetOrBuildExecution(Category()); var categoryNew = cache.GetOrBuildExecution(cache.TransferForExecution(Category()));
        Check("transferred-missing-label-unassigned-included-object-still-blocks", categoryOld.RequiresCategoryAssignment && categoryNew.RequiresCategoryAssignment
            && Fitted(categoryOld.Prepared) == Fitted(categoryNew.Prepared) && categoryNew.Prepared.Segments.Count == 2
            && categoryNew.Prepared.Diagnostics.Any(value => value.StartsWith("segment-2: missing_route_label", StringComparison.Ordinal)),
            new { reusableRequiresCategory = categoryOld.RequiresCategoryAssignment, transferredRequiresCategory = categoryNew.RequiresCategoryAssignment,
                sameFittedModel = Fitted(categoryOld.Prepared) == Fitted(categoryNew.Prepared), fittedIds = categoryNew.Prepared.Segments.Select(segment => segment.Id).ToArray(),
                diagnostics = categoryNew.Prepared.Diagnostics.ToArray() });
        var categoryExcluded = cache.GetOrBuildExecution(cache.TransferForExecution(Category(), new ModelBuildRules { ExcludedObjectIds = ["segment-2"] }));
        Check("transferred-excluded-unassigned-object-does-not-block", !categoryExcluded.RequiresCategoryAssignment);
        categoryNode["objects"]![1]!["nativeHidden"] = true; categoryBytes = Encoding.UTF8.GetBytes(categoryNode.ToJsonString()); File.WriteAllBytes(categoryFile, categoryBytes);
        Check("transferred-hidden-unassigned-object-does-not-block", !cache.GetOrBuildExecution(cache.TransferForExecution(Category())).RequiresCategoryAssignment);

        var lookupFile = Path.Combine(corpusRoot, "snapshots", "20000000-0000-4000-8000-000000000004.json"); var lookupDigest = Hash(File.ReadAllBytes(lookupFile));
        CheckedModelSnapshot Lookup()
        { using var source = cache.ReadSourceFile(lookupFile, lookupDigest); return cache.ReadCheckedSnapshot(source, Corpus.Project, Corpus.Model); }
        var unresolved = Lookup();
        Throws<ArgumentException>("transfer-unresolved-independent-lookup-refused", () => cache.TransferForExecution(unresolved));
        var lookupReusable = unresolved.ResolveLookup("/bc001/BC001");
        var lookupOld = cache.GetOrBuildExecution(lookupReusable);
        var lookupInput = cache.TransferForExecution(Lookup().ResolveLookup("/bc001/BC001"));
        var lookupNew = cache.GetOrBuildExecution(lookupInput);
        // Pinned ordered lookup coalesces adjacent identical codes, including
        // case variants; this request therefore contains one canonical code.
        Check("transferred-lookup-preserves-purpose-derived-and-source-hashes", lookupInput.IndependentLookup && lookupNew.IndependentLookup
            && lookupNew.SourceSha256 == lookupDigest && lookupNew.Prepared.SnapshotSha256 != lookupDigest && Fitted(lookupNew.Prepared) == Fitted(lookupOld.Prepared)
            && lookupNew.LookupScope!.RequestedCodeCount == 1 && lookupNew.LookupScope.UniqueCodeCount == 1,
            new { inputIndependentLookup = lookupInput.IndependentLookup, outputIndependentLookup = lookupNew.IndependentLookup,
                sameSourceHash = lookupNew.SourceSha256 == lookupDigest, resolvedHashDiffers = lookupNew.Prepared.SnapshotSha256 != lookupDigest,
                sameFittedModel = Fitted(lookupNew.Prepared) == Fitted(lookupOld.Prepared), scope = lookupNew.LookupScope });
        var lookupSession = new global::SessionExecutionContext(); lookupSession.Prepare(cacheRoot, lookupInput, CancellationToken.None);
        Check("transferred-independent-lookup-never-planning-warm-shortcut", !lookupSession.TryReusePlanning(cacheRoot, lookupDigest, Corpus.Project, Corpus.Model, null, CancellationToken.None, out _));
        var firstWarning = lookupNew.LookupScope!.Warnings[0]; lookupNew.LookupScope.Warnings[0] = "caller mutation";
        Check("transferred-lookup-scope-defensive-warning-copy", lookupNew.LookupScope.Warnings[0] == firstWarning);
        var payload = Directory.GetFiles(cacheRoot, "*.fit.json").Single(path => Path.GetFileName(path).StartsWith(cold.Prepared.Key, StringComparison.Ordinal));
        File.WriteAllText(payload, "{}"); var corruptCache = new FittedModelCache(cacheRoot);
        Throws<InvalidDataException>("transferred-disk-corruption-still-refused", () => corruptCache.GetOrBuildExecution(corruptCache.TransferForExecution(Read(corruptCache))));
    }
}
