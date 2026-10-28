using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using AddinRibbon.Routing;
using PathFinder.Model;

internal static class FitPolicyTests
{
    internal static void Run(JsonObject fixture, string scratch, Action<string, bool, string> check, Action<string, Action> reject)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(fixture, SnapshotReader.JsonOptions);
        string Hash(string value) => SnapshotReader.Sha256(Encoding.UTF8.GetBytes(value));
        var limits = new ModelLimits(); var legacyRules = new ModelBuildRules();
        var nextRules = new ModelBuildRules { Version = "pf2.rules.v2" };
        var cacheRoot = Path.Combine(scratch, "fit-policy"); var cache = new FittedModelCache(cacheRoot);
        var legacy = cache.GetOrBuild(bytes);
        string RulesHash(ModelBuildRules rules) => SnapshotReader.Sha256(JsonSerializer.SerializeToUtf8Bytes(new { rules, limits }, SnapshotReader.JsonOptions));
        check("fit-policy-legacy-key-remains-original-v1", legacy.Key == Hash("pf2.fitted-cache.v1\n" + FittedModelCache.EngineVersion
            + "\n" + SnapshotReader.Sha256(bytes) + "\n" + RulesHash(legacyRules)), "No new policy/module fields enter historical rules or cache identity.");
        var next = cache.GetOrBuild(bytes, nextRules);
        var implementation = Hash(SnapshotReader.Sha256(File.ReadAllBytes(typeof(TrayGeometryBuilder).Assembly.Location)) + "\n"
            + SnapshotReader.Sha256(File.ReadAllBytes(typeof(FittedModelCache).Assembly.Location)));
        string NextKey(string digest) => Hash("pf2.fitted-cache.v2\n" + FittedModelCache.EngineVersion + "\n" + SnapshotReader.Sha256(bytes)
            + "\n" + RulesHash(nextRules) + "\n" + "wfc.pf.measured-bend-mesh-fitting.v2" + "\n" + digest);
        check("fit-policy-v2-binds-actual-core-and-model-bytes", next.Key == NextKey(implementation) && next.Key != NextKey(new string('0', 64))
            && next.Key != legacy.Key, "New namespace, rules and actual fitting modules prevent historical or different-implementation hits.");
        check("fit-policy-v2-warm-cache-is-current-reference", ReferenceEquals(next, cache.GetOrBuild(bytes, nextRules)), "Serialized rules2 selects its own memory entry.");
        var disk = new FittedModelCache(cacheRoot).GetOrBuild(bytes, nextRules);
        check("fit-policy-v2-disk-preserves-points-ports-and-counts", disk.LoadedFromDisk && Geometry(next) == Geometry(disk), "The same implementation restores the exact detached geometry.");
        check("fit-policy-v1-after-v2-restores-original-key-and-geometry", Geometry(legacy) == Geometry(cache.GetOrBuild(bytes))
            && legacy.Key == cache.GetOrBuild(bytes, new ModelBuildRules()).Key, "An explicit v2 calculation does not change the default.");
        reject("fit-policy-unreviewed-rules-refused", () => cache.GetOrBuild(bytes, new ModelBuildRules { Version = "pf2.rules.v3" }));

        var filename = Path.Combine(scratch, "fit-policy-source.json"); File.WriteAllBytes(filename, bytes);
        CheckedModelSnapshot Read(FittedModelCache reader)
        {
            using var source = reader.ReadSourceFile(filename, SnapshotReader.Sha256(bytes));
            var model = SnapshotReader.Read(bytes).Model;
            return reader.ReadCheckedSnapshot(source, model.ProjectId, model.ModelVersionId);
        }
        var transferred = cache.TransferForExecution(Read(cache), nextRules);
        var policy = typeof(PreparedExecutionInput).GetProperty("FitPolicy", BindingFlags.NonPublic | BindingFlags.Instance)!;
        check("fit-policy-transfer-retains-explicit-core-policy", (TrayGeometryFitPolicy)policy.GetValue(transferred)! == TrayGeometryFitPolicy.MeasuredBendV2
            && cache.GetOrBuildExecution(transferred).Prepared.Key == next.Key, "Opaque transfer keeps policy without retaining a snapshot token.");
        var digestField = typeof(PreparedExecutionInput).GetField("<FittingImplementationSha256>k__BackingField", BindingFlags.NonPublic | BindingFlags.Instance)!;
        digestField.SetValue(transferred, new string('0', 64));
        reject("fit-policy-transfer-refuses-changed-implementation-before-warm-hit", () => cache.GetOrBuildExecution(transferred));
    }
    private static string Geometry(PreparedModel value) => JsonSerializer.Serialize(new { value.Key, value.Counts,
        segments = value.Segments.Select(s => new { s.Id, s.Points, s.VerifiedPorts, s.ConnectionsAtEndsOnly,
            surfaces = s.ConnectionSurfaces.Select(c => new { c.Minimum, c.Maximum, c.TriangleCount }) }) }, SnapshotReader.JsonOptions);
}
