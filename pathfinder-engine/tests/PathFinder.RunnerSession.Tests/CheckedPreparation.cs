using System.Buffers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Model;

namespace PathFinder.RunnerSession.Tests;

internal static partial class TestProgram
{
    private static void Throws<T>(string label, Action action) where T : Exception
    {
        try { action(); Check(label, false); }
        catch (T) { Check(label, true); }
    }
    private static string Fitted(PreparedModel model) => JsonSerializer.Serialize(new {
        model.Key, model.SnapshotSha256, model.RulesSha256, model.ProjectId, model.ModelVersionId, model.ContentSha256,
        model.Readiness, model.Counts, model.Objects, model.Diagnostics,
        segments = model.Segments.Select(segment => new { segment.Id, segment.Name, segment.RouteCode,
            segment.AllowedCategories, segment.ConnectionsAtEndsOnly, segment.Points, segment.VerifiedPorts,
            surfaces = segment.ConnectionSurfaces.Select(surface => new { surface.Minimum, surface.Maximum, surface.TriangleCount }) })
    }, SnapshotReader.JsonOptions);

    private static async Task CheckedPreparation(string runner, string corpusRoot, string work, JsonElement baseline)
    {
        Directory.CreateDirectory(work);
        var bytes = File.ReadAllBytes(Path.Combine(corpusRoot, "snapshots", baseline.GetProperty("snapshotId").GetString()! + ".json"));
        string digest = Hash(bytes), filename = Path.Combine(work, "snapshot.json"), cacheRoot = Path.Combine(work, "cache");
        File.WriteAllBytes(filename, bytes); var cache = new FittedModelCache(cacheRoot);
        using var source = cache.ReadSourceFile(filename, digest);
        var input = cache.ReadCheckedSnapshot(source, Corpus.Project, Corpus.Model);
        var cold = cache.GetOrBuildExecution(input);
        Check("opaque-source-no-public-constructor", typeof(VerifiedSnapshotSource).GetConstructors().Length == 0);
        Check("opaque-checked-no-public-constructor", typeof(CheckedModelSnapshot).GetConstructors().Length == 0);
        Check("compact-execution-no-public-constructor", typeof(PreparedExecution).GetConstructors().Length == 0);
        Check("opaque-source-no-public-bytes-or-DTO", typeof(VerifiedSnapshotSource).GetProperties().All(property => property.PropertyType == typeof(string))
            && typeof(CheckedModelSnapshot).GetProperties().All(property => property.PropertyType == typeof(string) || property.PropertyType == typeof(bool)));
        Check("compact-execution-no-raw-snapshot", typeof(PreparedExecution).GetProperties().All(property => property.PropertyType != typeof(ModelSnapshot)
            && property.PropertyType != typeof(byte[]) && property.PropertyType != typeof(ReadOnlyMemory<byte>)));
        Check("checked-cold-keeps-exact-original-hash", cold.SourceSha256 == digest && cold.Prepared.SnapshotSha256 == digest && !cold.Prepared.LoadedFromDisk);
        var retained = cache.GetOrBuildExecution(input);
        Check("checked-cache-reuses-exact-prepared-reference", ReferenceEquals(cold.Prepared, retained.Prepared));
        await TransferredPreparation(filename, digest, corpusRoot, Path.Combine(work, "transferred"), cold);
        using var diskSource = new FittedModelCache(cacheRoot).ReadSourceFile(filename, digest);
        var diskCache = new FittedModelCache(cacheRoot); var diskInput = diskCache.ReadCheckedSnapshot(diskSource, Corpus.Project, Corpus.Model);
        var disk = diskCache.GetOrBuildExecution(diskInput);
        Check("checked-disk-retains-order-ports-surfaces-and-metadata", disk.Prepared.LoadedFromDisk && Fitted(cold.Prepared) == Fitted(disk.Prepared));
        var releasedCache = new FittedModelCache(Path.Combine(work, "source-released-before-fit"));
        using (var releasedSource = releasedCache.ReadSourceFile(filename, digest))
        {
            var detached = releasedCache.ReadCheckedSnapshot(releasedSource, Corpus.Project, Corpus.Model);
            releasedSource.Dispose();
            var afterRelease = releasedCache.GetOrBuildExecution(detached);
            Check("checked-cold-fit-after-source-buffer-release", !afterRelease.Prepared.LoadedFromDisk && Fitted(afterRelease.Prepared) == Fitted(cold.Prepared)
                && afterRelease.SourceSha256 == digest && afterRelease.Model == cold.Model && afterRelease.RequiresCategoryAssignment == cold.RequiresCategoryAssignment);
        }
        var session = new global::SessionExecutionContext(); session.Prepare(cacheRoot, input, null, CancellationToken.None);
        Check("compact-planning-context-has-current-reuse", session.TryReusePlanning(cacheRoot, digest, Corpus.Project, Corpus.Model, null, CancellationToken.None, out _));
        session.SelectPlanningSource(cacheRoot, new string('0', 64), null, CancellationToken.None);
        Check("changed-expected-source-only-evicts-never-authorizes", !session.TryReusePlanning(cacheRoot, digest, Corpus.Project, Corpus.Model, null, CancellationToken.None, out _));
        var otherLimits = new FittedModelCache(Path.Combine(work, "other-limits"), new ModelLimits { MaximumObjects = 1_000_001 });
        Throws<ArgumentException>("source-cannot-cross-validation-limits", () => otherLimits.ReadCheckedSnapshot(source, Corpus.Project, Corpus.Model));
        Throws<ArgumentException>("checked-token-cannot-cross-validation-limits", () => otherLimits.GetOrBuildExecution(input));
        Throws<ArgumentException>("checked-project-mismatch", () => cache.ReadCheckedSnapshot(source, Guid.NewGuid().ToString("D"), Corpus.Model));
        Throws<ArgumentException>("checked-model-mismatch", () => cache.ReadCheckedSnapshot(source, Corpus.Project, Guid.NewGuid().ToString("D")));
        Throws<ArgumentException>("file-hash-is-computed-never-claimed", () => cache.ReadSourceFile(filename, new string('0', 64)));
        using (var cancelled = new CancellationTokenSource())
        {
            cancelled.Cancel();
            Throws<OperationCanceledException>("source-read-honors-cancellation", () => cache.ReadSourceFile(filename, digest, cancelled.Token));
            Throws<OperationCanceledException>("checked-cache-honors-cancellation", () => cache.GetOrBuildExecution(input, cancellation: cancelled.Token));
        }
        using (var disposable = cache.ReadSourceFile(filename, digest))
        { disposable.Dispose(); Throws<ObjectDisposedException>("disposed-source-cannot-be-reparsed", () => cache.ReadCheckedSnapshot(disposable, Corpus.Project, Corpus.Model)); }
        var empty = Path.Combine(work, "empty.json"); File.WriteAllBytes(empty, []);
        Throws<ArgumentException>("source-empty-file-refused", () => cache.ReadSourceFile(empty, Hash([])));
        var partial = Path.Combine(work, "partial.json"); var partialBytes = bytes[..(bytes.Length / 2)]; File.WriteAllBytes(partial, partialBytes);
        using (var partialSource = cache.ReadSourceFile(partial, Hash(partialBytes)))
            Throws<JsonException>("partial-source-stays-strict", () => cache.ReadCheckedSnapshot(partialSource, Corpus.Project, Corpus.Model));

        // A public MemoryManager can mutate between hash and parse. The legacy
        // API must detach it so an opaque source never inherits a poisoned key.
        var poisoned = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(bytes).Replace("/BC001", "/XX001", StringComparison.Ordinal));
        using (var moving = new MutatingMemory(bytes, poisoned))
        {
            var guarded = new FittedModelCache(Path.Combine(work, "legacy-memory"));
            var legacy = guarded.GetOrBuild(moving.Input);
            using var original = guarded.ReadSourceFile(filename, digest);
            var exact = guarded.GetOrBuildExecution(guarded.ReadCheckedSnapshot(original, Corpus.Project, Corpus.Model));
            Check("caller-memory-cannot-poison-checked-cache", Fitted(legacy) == Fitted(exact.Prepared)
                && legacy.Objects[0].ResolvedRouteName == "/BC001" && legacy.SnapshotSha256 == digest);
        }
        var fitPayload = Directory.GetFiles(cacheRoot, "*.fit.json").Single(); File.WriteAllText(fitPayload, "{}");
        var corruptedCache = new FittedModelCache(cacheRoot);
        Throws<InvalidDataException>("checked-disk-corruption-remains-refused", () => corruptedCache.GetOrBuildExecution(input));
        var observedPhases = new List<PreparationMemoryPhase>();
        var observedCache = new FittedModelCache(Path.Combine(work, "phase-observer"), observer: observedPhases.Add);
        using (var observedSource = observedCache.ReadSourceFile(filename, digest))
            observedCache.GetOrBuildExecution(observedCache.ReadCheckedSnapshot(observedSource, Corpus.Project, Corpus.Model));
        Check("typed-phases-cover-token-deserialize-semantic-and-fit", new[] { PreparationMemoryPhase.SourceRead, PreparationMemoryPhase.BeforeStrictParse,
            PreparationMemoryPhase.BeforeTokenValidation, PreparationMemoryPhase.AfterTokenValidation, PreparationMemoryPhase.BeforeTypedDeserialize,
            PreparationMemoryPhase.AfterTypedDeserialize, PreparationMemoryPhase.BeforeSemanticValidation, PreparationMemoryPhase.AfterSemanticValidation,
            PreparationMemoryPhase.StrictParse, PreparationMemoryPhase.BeforePrepareInputs, PreparationMemoryPhase.AfterPrepareInputs,
            PreparationMemoryPhase.BeforeCoreFit, PreparationMemoryPhase.AfterCoreFit }.SequenceEqual(observedPhases));
        var throwingCache = new FittedModelCache(Path.Combine(work, "throwing-observer"), observer: _ => throw new InvalidOperationException("Synthetic diagnostic failure."));
        using (var throwingSource = throwingCache.ReadSourceFile(filename, digest))
            Check("throwing-observer-cannot-change-checked-fit", Fitted(throwingCache.GetOrBuildExecution(throwingCache.ReadCheckedSnapshot(throwingSource, Corpus.Project, Corpus.Model)).Prepared) == Fitted(cold.Prepared));
        using (var throwingPartial = throwingCache.ReadSourceFile(partial, Hash(partialBytes)))
            Throws<JsonException>("throwing-observer-cannot-replace-json-refusal", () => throwingCache.ReadCheckedSnapshot(throwingPartial, Corpus.Project, Corpus.Model));
        var semanticFile = Path.Combine(work, "semantic-invalid.json"); var semanticNode = JsonNode.Parse(bytes)!.AsObject();
        semanticNode["schemaVersion"] = "unsupported"; var semanticBytes = Encoding.UTF8.GetBytes(semanticNode.ToJsonString()); File.WriteAllBytes(semanticFile, semanticBytes);
        using (var throwingSemantic = throwingCache.ReadSourceFile(semanticFile, Hash(semanticBytes)))
            Throws<ArgumentException>("throwing-observer-cannot-replace-semantic-refusal", () => throwingCache.ReadCheckedSnapshot(throwingSemantic, Corpus.Project, Corpus.Model));
        await MemoryPhaseProbeChecks(Path.Combine(work, "phase-sinks"));

        // The real runner receives the same source twice, then a wrong request
        // identity. A compact warm hit must not omit the source identity guard.
        foreach (var field in new[] { "projectId", "modelVersionId" })
        {
            using var process = await Start(runner, corpusRoot);
            JsonObject Request() { var value = JsonNode.Parse(baseline.GetRawText())!.AsObject(); value["requestId"] = Guid.NewGuid().ToString("D"); return value; }
            var firstRequest = Request(); var first = await Query(process, Encoding.UTF8.GetBytes(firstRequest.ToJsonString()), firstRequest["requestId"]!.GetValue<string>(), 1);
            var warmRequest = Request(); var warm = await Query(process, Encoding.UTF8.GetBytes(warmRequest.ToJsonString()), warmRequest["requestId"]!.GetValue<string>(), 2);
            Check("warm-same-source-full-semantic-parity-" + field, Semantic(first.GetProperty("response")) == Semantic(warm.GetProperty("response"))
                && warm.GetProperty("session").GetProperty("preparedReuse").GetString() == "memory");
            var wrong = Request(); wrong[field] = Guid.NewGuid().ToString("D");
            var refused = await Query(process, Encoding.UTF8.GetBytes(wrong.ToJsonString()), wrong["requestId"]!.GetValue<string>(), 3);
            Check("warm-source-refuses-wrong-" + field, refused.GetProperty("response").GetProperty("status").GetString() == "invalid_request"
                && refused.GetProperty("session").GetProperty("retireAfterResponse").GetBoolean());
            await Stop(process);
        }
        // Category metadata is derived after explicit exclusion/native visibility,
        // exactly like the original Program guard, including a repeat warm hit.
        var categoryRoot = Path.Combine(work, "category-root"); Directory.CreateDirectory(Path.Combine(categoryRoot, "snapshots"));
        var node = JsonNode.Parse(bytes)!.AsObject(); node["objects"]![1]!["categoryAssignmentSource"] = "unassigned";
        node["objects"]![1]!["allowedCategories"] = new JsonArray();
        string categoryId = Guid.NewGuid().ToString("D"); var categoryBytes = Encoding.UTF8.GetBytes(node.ToJsonString());
        File.WriteAllBytes(Path.Combine(categoryRoot, "snapshots", categoryId + ".json"), categoryBytes);
        JsonObject CategoryRequest() { var value = JsonNode.Parse(baseline.GetRawText())!.AsObject(); value["requestId"] = Guid.NewGuid().ToString("D");
            value["snapshotId"] = categoryId; value["snapshotSha256"] = Hash(categoryBytes); return value; }
        using (var process = await Start(runner, categoryRoot))
        {
            for (var ordinal = 1; ordinal <= 2; ordinal++)
            {
                var request = CategoryRequest(); var categoryResult = await Query(process, Encoding.UTF8.GetBytes(request.ToJsonString()), request["requestId"]!.GetValue<string>(), ordinal);
                Check("category-required-included-leaf-" + ordinal, categoryResult.GetProperty("response").GetProperty("status").GetString() == "model_needs_review");
            }
            var excluded = CategoryRequest(); excluded["rules"] = new JsonObject { ["version"] = "pf2.rules.v1", ["categoryMappingVersion"] = "wfc-mto-v1", ["excludedObjectIds"] = new JsonArray("segment-2") };
            var result = await Query(process, Encoding.UTF8.GetBytes(excluded.ToJsonString()), excluded["requestId"]!.GetValue<string>(), 3);
            Check("category-required-does-not-block-explicitly-excluded-leaf", result.GetProperty("response").GetProperty("status").GetString() == "no_path");
            var hiddenNode = (JsonObject)node.DeepClone(); hiddenNode["objects"]![1]!["nativeHidden"] = true;
            var hiddenBytes = Encoding.UTF8.GetBytes(hiddenNode.ToJsonString()); var hiddenId = Guid.NewGuid().ToString("D");
            File.WriteAllBytes(Path.Combine(categoryRoot, "snapshots", hiddenId + ".json"), hiddenBytes);
            var hidden = CategoryRequest(); hidden["snapshotId"] = hiddenId; hidden["snapshotSha256"] = Hash(hiddenBytes);
            var hiddenResult = await Query(process, Encoding.UTF8.GetBytes(hidden.ToJsonString()), hidden["requestId"]!.GetValue<string>(), 4);
            Check("category-required-does-not-block-native-hidden-leaf", hiddenResult.GetProperty("response").GetProperty("status").GetString() == "no_path");
            await Stop(process);
        }
    }

    private sealed class MutatingMemory : MemoryManager<byte>
    {
        private readonly byte[] buffer, replacement; private int calls;
        internal MutatingMemory(byte[] original, byte[] replacement) { buffer = original.ToArray(); this.replacement = replacement; }
        internal ReadOnlyMemory<byte> Input => CreateMemory(buffer.Length);
        public override Span<byte> GetSpan() { if (++calls > 1) replacement.CopyTo(buffer, 0); return buffer; }
        public override MemoryHandle Pin(int elementIndex = 0) => throw new NotSupportedException();
        public override void Unpin() { }
        protected override void Dispose(bool disposing) { }
    }
}
