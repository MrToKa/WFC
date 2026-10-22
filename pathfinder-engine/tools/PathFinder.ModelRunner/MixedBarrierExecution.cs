using System.Text.Json;
using PathFinder.Barriers;
using PathFinder.BarrierVerifier;

internal static partial class Program
{
    private const string MixedDomain = "provided-original-triangle-surface-contact-and-independently-qualified-closed-solid-occupancy";
    private const string MixedProfileJson = """
    {"schemaVersion":"wfc.pf.barrier-runtime-profile.v2","routeHashVersion":"wfc.pf.route-binary64-le.v1","qualification":{"producerVersion":"wfc.pf.barrier-mixed-verifier.v2","geometryPolicy":"wfc.pf.original-surfaces-and-qualified-solids.v2","maximumBytes":33554432,"maximumFragments":8192,"maximumParents":128,"maximumComponents":256,"maximumVertices":500000,"maximumTriangles":250000,"maximumWork":40000000,"maximumMilliseconds":60000,"numericToleranceMetres":1e-7},"kernel":{"collisionVersion":"wfc.pf.mixed-original-triangle-centreline.v2","domain":"provided-original-triangle-surface-contact-and-independently-qualified-closed-solid-occupancy","ownTerminalExemptionsSupported":false,"maximumBvhNodes":500000,"maximumQueryWork":2000000,"maximumQueryMilliseconds":10000,"maximumEstimatedBytes":134217728,"bvhLeafSize":8,"maximumCoordinateMagnitudeMetres":1000000000},"routing":{"policyVersion":"wfc.pf.constrained-tray-routing.v1","candidateRankingVersion":"wfc.pf.accessible-piece-projections.v1","maxCandidatesPerEnd":16,"maxPairs":64,"maxCollisionQueries":100000,"maxWork":20000000,"timeoutMilliseconds":30000,"maxInputTrays":4096,"maxInputPieces":50000,"maxGraphNodes":100000,"maxGraphConnections":300000},"localConnectors":{"policyVersion":"wfc.pf.local-connector-lattice.v1","approachVersion":"wfc.pf.local-approach-routing.v1","domainVersion":"endpoint-tray-aabb-with-profile-padding.v1","stepMeters":0.25,"paddingMeters":1,"maxAxisSpanMeters":20,"maxNodes":4096,"maxEdgeChecks":16384,"maxPlans":8,"maxStraightPairs":8}}
    """;
    private static readonly JsonElement MixedProfile = JsonDocument.Parse(MixedProfileJson).RootElement.Clone();
    private static bool UsesMixedBarrierRuntime(Request request) => request.Barriers is { ValueKind: JsonValueKind.Object } value
        && value.TryGetProperty("schemaVersion", out var version) && version.ValueKind == JsonValueKind.String
        && version.GetString() == "wfc.pf.barrier-runtime.v2";
    private static JsonElement SupportedBarrierValue(Request request) => UsesMixedBarrierRuntime(request)
        ? MixedBarrierContext(request).Value : BarrierContext(request).Value;
    private static object SupportedBarrierFailure(Request request, string status, string reason, string message) => UsesMixedBarrierRuntime(request)
        ? MixedBarrierFailure(request, MixedBarrierContext(request), status, reason, message)
        : BarrierFailure(request, BarrierContext(request), status, reason, message);
    private static void MixedNoAuthority(JsonElement value)
    {
        if (value.GetProperty("engineeringAccepted").GetBoolean() || value.GetProperty("ownTerminalExemptionsSupported").GetBoolean()
            || BarrierString(value, "authority") != "none") throw new ArgumentException("Mixed geometry cannot grant engineering or terminal authority.");
    }
    private static MixedBarrierRuntimeContext MixedBarrierContext(Request request)
    {
        ValidateBarrierDefaults();
        var limits = new MixedBarrierBuildLimits(); var query = new MixedBarrierQueryLimits();
        if (limits.MaximumFragments != 8192 || limits.MaximumParents != 128 || query.MaximumWork != 2000000 || query.MaximumMilliseconds != 10000
            || MixedBarrierKernel.PolicyVersion != "wfc.pf.original-surfaces-and-qualified-solids.v2"
            || MixedBarrierKernel.CollisionVersion != "wfc.pf.mixed-original-triangle-centreline.v2"
            || MixedBarrierCaptureVerifier.ProducerVersion != "wfc.pf.barrier-mixed-verifier.v2")
            throw new ArgumentException("Mixed defaults no longer match the frozen explicit profile.");
        var value = request.Barriers ?? throw new ArgumentException("Mixed runtime is required.");
        BarrierFields(value, "schemaVersion", "binding", "profile", "profileSha256", "storage");
        if (BarrierString(value, "schemaVersion") != "wfc.pf.barrier-runtime.v2" || BarrierCanonical(value).Length > 65536
            || !BarrierEqual(value.GetProperty("profile"), MixedProfile) || BarrierDigest(value, "profileSha256") != BarrierHash(MixedProfile))
            throw new ArgumentException("Mixed runtime profile or digest mismatch.");
        var binding = value.GetProperty("binding"); BarrierFields(binding, "schemaVersion", "scope", "registryRevision", "snapshot", "policy", "policySha256");
        if (BarrierString(binding, "schemaVersion") != "wfc.pf.barrier-calculation-binding.v2") throw new ArgumentException("Mixed binding version mismatch.");
        var scope = binding.GetProperty("scope"); BarrierScope(scope, request); string revision = BarrierRevision(binding, "registryRevision");
        var policy = binding.GetProperty("policy"); BarrierFields(policy, "schemaVersion", "policyVersion", "collisionVersion", "drillThroughWalls", "numericToleranceMetres", "physicalClearance", "ownTerminalExemptionsSupported");
        var physical = policy.GetProperty("physicalClearance"); BarrierFields(physical, "mode", "radiusMetres", "diameterSource");
        bool drill = policy.GetProperty("drillThroughWalls").GetBoolean();
        if (BarrierString(policy, "schemaVersion") != "wfc.pf.barrier-routing-policy.v2" || BarrierString(policy, "policyVersion") != MixedBarrierKernel.PolicyVersion
            || BarrierString(policy, "collisionVersion") != MixedBarrierKernel.CollisionVersion || policy.GetProperty("numericToleranceMetres").GetDouble() != 1e-7
            || policy.GetProperty("ownTerminalExemptionsSupported").GetBoolean() || BarrierString(physical, "mode") != "centreline-only"
            || physical.GetProperty("radiusMetres").GetDouble() != 0 || BarrierString(physical, "diameterSource") != "not-qualified"
            || BarrierDigest(binding, "policySha256") != BarrierHash(policy)) throw new ArgumentException("Mixed routing policy mismatch.");
        var snapshot = binding.GetProperty("snapshot"); var storage = value.GetProperty("storage");
        if (snapshot.ValueKind == JsonValueKind.Null)
        {
            if (!drill || storage.ValueKind != JsonValueKind.Null) throw new ArgumentException("Only explicit admitted drilling may use an unpublished mixed scope.");
        }
        else
        {
            BarrierFields(snapshot, "schemaVersion", "geometryPolicy", "snapshotId", "scope", "registryRevision", "contentSha256", "mode");
            if (BarrierString(snapshot, "schemaVersion") != "wfc.pf.barrier-snapshot-reference.v2" || BarrierString(snapshot, "geometryPolicy") != MixedBarrierKernel.PolicyVersion
                || !BarrierEqual(scope, snapshot.GetProperty("scope")) || BarrierRevision(snapshot, "registryRevision") != revision
                || BarrierString(snapshot, "mode") is not ("mixed-mesh-set" or "explicit-empty")) throw new ArgumentException("Mixed snapshot reference mismatch.");
            _ = BarrierUuid(snapshot, "snapshotId"); _ = BarrierDigest(snapshot, "contentSha256");
            BarrierFields(storage, "intentId", "manifest", "capture"); _ = BarrierUuid(storage, "intentId"); BarrierBlob.Validate(storage.GetProperty("manifest"), 262144);
            if (BarrierString(snapshot, "mode") == "mixed-mesh-set") BarrierBlob.Validate(storage.GetProperty("capture"), 33554432);
            else if (storage.GetProperty("capture").ValueKind != JsonValueKind.Null) throw new ArgumentException("Explicit-empty mixed scope cannot carry a capture.");
        }
        return new(value.Clone(), binding.Clone(), scope.Clone(), snapshot.Clone(), storage.Clone(), drill);
    }
    private static object MixedBarrierFailure(Request request, MixedBarrierRuntimeContext context, string status, string reason, string message) => new
    {
        schemaVersion = "pathfinder.model.response.v3", request.RequestId, status, message, engineeringAccepted = false,
        barriers = new { schemaVersion = "wfc.pf.barrier-execution.v2", context = context.Value, proof = (object?)null, directSecondary = (object?)null,
            diagnostics = new { status = "unavailable", reasonCode = reason, searchComplete = false, candidatesTruncated = false, pairAttempts = 0,
                collisionQueries = 0, work = "0", plannerAttempts = 0, straightPairAttempts = 0, localEdgeChecks = 0, localPhaseUsed = false, straightPhaseTruncated = false },
            connectors = new { from = (object?)null, to = (object?)null }, qualification = (object?)null,
            engineeringAccepted = false, ownTerminalExemptionsSupported = false, authority = "none" }
    };
}
internal sealed record MixedBarrierRuntimeContext(JsonElement Value, JsonElement Binding, JsonElement Scope, JsonElement Snapshot, JsonElement Storage, bool Drill)
{
    internal string? Mode => Snapshot.ValueKind == JsonValueKind.Null ? null : Snapshot.GetProperty("mode").GetString();
}
