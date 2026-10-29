using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using AddinRibbon.Routing;
using PathFinder.Adapter;
using PathFinder.Barriers;
using PathFinder.BarrierVerifier;
using PathFinder.Model;

// This private transport accepts server-owned opaque immutable artifacts. It is
// not an actor/SDK-authority service and never treats a supplied box as a solid.
internal static partial class Program
{
    private const string BarrierProfileJson = """
    {"schemaVersion":"wfc.pf.barrier-runtime-profile.v1","routeHashVersion":"wfc.pf.route-binary64-le.v1","qualification":{"producerVersion":"wfc.pf.barrier-verifier.v1","maximumBytes":33554432,"maximumFragments":8192,"maximumParents":128,"maximumComputationalMeshes":256,"maximumVertices":500000,"maximumTriangles":250000,"maximumWork":40000000,"maximumMilliseconds":60000,"numericToleranceMetres":1e-7},"kernel":{"collisionVersion":"wfc.pf.triangle-centreline-collision.v1","maximumBvhNodes":500000,"maximumQueryWork":2000000,"maximumQueryMilliseconds":10000,"maximumEstimatedBytes":134217728,"bvhLeafSize":8,"maximumCoordinateMagnitudeMetres":1000000000},"routing":{"policyVersion":"wfc.pf.constrained-tray-routing.v1","candidateRankingVersion":"wfc.pf.accessible-piece-projections.v1","maxCandidatesPerEnd":16,"maxPairs":64,"maxCollisionQueries":100000,"maxWork":20000000,"timeoutMilliseconds":30000,"maxInputTrays":4096,"maxInputPieces":50000,"maxGraphNodes":100000,"maxGraphConnections":300000},"localConnectors":{"policyVersion":"wfc.pf.local-connector-lattice.v1","approachVersion":"wfc.pf.local-approach-routing.v1","domainVersion":"endpoint-tray-aabb-with-profile-padding.v1","stepMeters":0.25,"paddingMeters":1,"maxAxisSpanMeters":20,"maxNodes":4096,"maxEdgeChecks":16384,"maxPlans":8,"maxStraightPairs":8}}
    """;
    private static readonly JsonElement BarrierProfile = JsonDocument.Parse(BarrierProfileJson).RootElement.Clone();
    private static string BarrierHash(ReadOnlySpan<byte> value) => Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
    private static string BarrierHash(JsonElement value) => BarrierHash(BarrierCanonical(value));
    private static byte[] BarrierCanonical(JsonElement value, string? omitRoot = null)
    {
        using var memory = new MemoryStream();
        using var writer = new Utf8JsonWriter(memory, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        Write(value, true); writer.Flush();
        return memory.ToArray();
        void Write(JsonElement item, bool root = false)
        {
            switch (item.ValueKind)
            {
                case JsonValueKind.Object:
                    writer.WriteStartObject();
                    foreach (var property in item.EnumerateObject().OrderBy(property => property.Name, StringComparer.Ordinal))
                    { if (root && property.Name == omitRoot) continue; writer.WritePropertyName(property.Name); Write(property.Value); }
                    writer.WriteEndObject(); break;
                case JsonValueKind.Array: writer.WriteStartArray(); foreach (var element in item.EnumerateArray()) Write(element); writer.WriteEndArray(); break;
                case JsonValueKind.Number: writer.WriteRawValue(BarrierJsNumber(item.GetDouble())); break;
                case JsonValueKind.String: writer.WriteRawValue(BarrierJsString(item.GetString()!)); break;
                default: item.WriteTo(writer); break;
            }
        }
    }
    private static string BarrierJsString(string value)
    {
        var output = new StringBuilder(value.Length + 2).Append('"');
        foreach (char character in value)
            switch (character)
            {
                case '"': output.Append("\\\""); break; case '\\': output.Append("\\\\"); break;
                case '\b': output.Append("\\b"); break; case '\t': output.Append("\\t"); break; case '\n': output.Append("\\n"); break;
                case '\f': output.Append("\\f"); break; case '\r': output.Append("\\r"); break;
                default: if (character < 32) output.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture)); else output.Append(character); break;
            }
        return output.Append('"').ToString();
    }
    // Canonical JS uses shortest round-trip decimal digits, lower-case exponents
    // and fixed notation for exponents -6..20. Route coordinates use bits instead.
    private static string BarrierJsNumber(double value)
    {
        if (!double.IsFinite(value)) throw new ArgumentException("Barrier numbers must be finite.");
        if (value == 0) return "0";
        var text = value.ToString("R", CultureInfo.InvariantCulture).ToLowerInvariant(); int at = text.IndexOf('e');
        if (at < 0) return text;
        int exponent = int.Parse(text[(at + 1)..], CultureInfo.InvariantCulture);
        string mantissa = text[..at], sign = mantissa.StartsWith('-') ? "-" : "";
        if (sign.Length != 0) mantissa = mantissa[1..];
        if (exponent < -6 || exponent >= 21) return sign + mantissa + "e" + (exponent >= 0 ? "+" : "") + exponent.ToString(CultureInfo.InvariantCulture);
        int dot = mantissa.IndexOf('.'); if (dot < 0) dot = mantissa.Length;
        string digits = mantissa.Replace(".", "", StringComparison.Ordinal); int position = dot + exponent;
        return sign + (position <= 0 ? "0." + new string('0', -position) + digits : position >= digits.Length
            ? digits + new string('0', position - digits.Length) : digits[..position] + "." + digits[position..]);
    }
    private static bool BarrierEqual(JsonElement first, JsonElement second) => BarrierCanonical(first).AsSpan().SequenceEqual(BarrierCanonical(second));
    private static void BarrierFields(JsonElement value, params string[] names) => SessionProtocol.Fields(value, names);
    private static string BarrierString(JsonElement value, string name) => value.GetProperty(name).GetString() ?? throw new ArgumentException("Barrier text is required.");
    private static string BarrierUuid(JsonElement value, string name)
    {
        string text = BarrierString(value, name);
        if (!Regex.IsMatch(text, "^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\\z", RegexOptions.CultureInvariant)) throw new ArgumentException("Barrier UUID rejected.");
        return text;
    }
    private static string BarrierDigest(JsonElement value, string name)
    {
        string text = BarrierString(value, name);
        if (!Regex.IsMatch(text, "^[a-f0-9]{64}\\z", RegexOptions.CultureInvariant)) throw new ArgumentException("Barrier digest rejected.");
        return text;
    }
    private static string BarrierRevision(JsonElement value, string name)
    {
        string text = BarrierString(value, name);
        if (!Regex.IsMatch(text, "^(?:0|[1-9][0-9]{0,18})\\z", RegexOptions.CultureInvariant)
            || !long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out _)) throw new ArgumentException("Barrier revision rejected.");
        return text;
    }
    private static void BarrierScope(JsonElement scope, Request request)
    {
        BarrierFields(scope, "projectId", "modelVersionId", "contentFingerprint", "selectionRevision", "captureFrameId", "captureFrameSha256", "coordinateFrame");
        if (BarrierUuid(scope, "projectId") != request.ProjectId || BarrierUuid(scope, "modelVersionId") != request.ModelVersionId
            || BarrierString(scope, "coordinateFrame") != "canonical-world-metres") throw new ArgumentException("Barrier scope differs from the requested model.");
        _ = BarrierDigest(scope, "contentFingerprint"); _ = BarrierRevision(scope, "selectionRevision");
        _ = BarrierUuid(scope, "captureFrameId"); _ = BarrierDigest(scope, "captureFrameSha256");
    }
    private static BarrierRuntimeContext BarrierContext(Request request)
    {
        ValidateBarrierDefaults();
        var value = request.Barriers ?? throw new ArgumentException("The protected calculation requires its exact barrier context.");
        BarrierFields(value, "schemaVersion", "binding", "profile", "profileSha256", "storage");
        if (BarrierString(value, "schemaVersion") != "wfc.pf.barrier-runtime.v1" || BarrierCanonical(value).Length > 65536
            || !BarrierEqual(value.GetProperty("profile"), BarrierProfile) || BarrierDigest(value, "profileSha256") != BarrierHash(BarrierProfile))
            throw new ArgumentException("Barrier runtime profile or digest mismatch.");
        var binding = value.GetProperty("binding"); BarrierFields(binding, "scope", "registryRevision", "snapshot", "policy", "policySha256");
        var scope = binding.GetProperty("scope"); BarrierScope(scope, request); string revision = BarrierRevision(binding, "registryRevision");
        var policy = binding.GetProperty("policy"); BarrierFields(policy, "schemaVersion", "policyVersion", "drillThroughWalls", "collisionVersion", "numericToleranceMetres", "physicalClearance");
        var physical = policy.GetProperty("physicalClearance"); BarrierFields(physical, "mode", "radiusMetres", "diameterSource");
        bool drill = policy.GetProperty("drillThroughWalls").GetBoolean();
        if (BarrierString(policy, "schemaVersion") != "wfc.pf.barrier-routing-policy.v1" || BarrierString(policy, "policyVersion") != "wfc.pf.registered-triangle-barriers.v1"
            || BarrierString(policy, "collisionVersion") != BarrierCollisionKernel.CollisionVersion || policy.GetProperty("numericToleranceMetres").GetDouble() != 1e-7
            || BarrierString(physical, "mode") != "centreline-only" || physical.GetProperty("radiusMetres").GetDouble() != 0
            || BarrierString(physical, "diameterSource") != "not-qualified" || BarrierDigest(binding, "policySha256") != BarrierHash(policy))
            throw new ArgumentException("Barrier routing policy or digest mismatch.");
        var snapshot = binding.GetProperty("snapshot"); var storage = value.GetProperty("storage");
        if (snapshot.ValueKind == JsonValueKind.Null)
        { if (!drill || storage.ValueKind != JsonValueKind.Null) throw new ArgumentException("Only explicit drilling may use an unpublished scope."); }
        else
        {
            BarrierFields(snapshot, "snapshotId", "scope", "registryRevision", "contentSha256", "mode");
            _ = BarrierUuid(snapshot, "snapshotId"); _ = BarrierDigest(snapshot, "contentSha256");
            if (!BarrierEqual(scope, snapshot.GetProperty("scope")) || BarrierRevision(snapshot, "registryRevision") != revision
                || BarrierString(snapshot, "mode") is not ("mesh-set" or "explicit-empty")) throw new ArgumentException("Barrier snapshot reference differs from its scope/revision.");
            BarrierFields(storage, "intentId", "manifest", "capture"); _ = BarrierUuid(storage, "intentId");
            BarrierBlob.Validate(storage.GetProperty("manifest"), 262144);
            bool mesh = BarrierString(snapshot, "mode") == "mesh-set";
            if (mesh) BarrierBlob.Validate(storage.GetProperty("capture"), 33554432);
            else if (storage.GetProperty("capture").ValueKind != JsonValueKind.Null) throw new ArgumentException("An empty scope cannot have a capture.");
        }
        return new(value.Clone(), binding.Clone(), scope.Clone(), snapshot.Clone(), storage.Clone(), drill);
    }
    private static void ValidateBarrierDefaults()
    {
        // An implementation default changing under an unchanged transport
        // profile must refuse, rather than silently executing a different bound.
        var verifier = new BarrierVerifierLimits(); var kernel = new BarrierLimits();
        var routing = new ConstrainedRoutingLimits(); var local = new LocalConnectorOptions();
        if (verifier.MaximumBytes != 33554432 || verifier.MaximumFragments != 8192 || verifier.MaximumParents != 128
            || verifier.MaximumComputationalMeshes != 256 || verifier.MaximumVertices != 500000 || verifier.MaximumTriangles != 250000
            || verifier.MaximumWork != 40000000 || verifier.MaximumMilliseconds != 60000 || verifier.NumericToleranceMetres != 1e-7
            || kernel.MaximumMeshes != 256 || kernel.MaximumVertices != 500000 || kernel.MaximumTriangles != 250000 || kernel.MaximumBvhNodes != 500000
            || kernel.MaximumBuildWork != 40000000 || kernel.MaximumBuildMilliseconds != 60000 || kernel.MaximumQueryWork != 2000000
            || kernel.MaximumQueryMilliseconds != 10000 || kernel.MaximumEstimatedBytes != 134217728 || kernel.BvhLeafSize != 8
            || kernel.NumericToleranceMeters != 1e-7 || kernel.MaximumCoordinateMagnitude != 1e9
            || routing.MaxCandidatesPerEnd != 16 || routing.MaxPairs != 64 || routing.MaxCollisionQueries != 100000 || routing.MaxWork != 20000000
            || routing.TimeoutMilliseconds != 30000 || routing.MaxInputTrays != 4096 || routing.MaxInputPieces != 50000
            || routing.MaxGraphNodes != 100000 || routing.MaxGraphConnections != 300000 || local.StepMeters != .25 || local.PaddingMeters != 1
            || local.MaxAxisSpanMeters != 20 || local.MaxNodes != 4096 || local.MaxEdgeChecks != 16384 || local.MaxPlans != 8 || local.MaxStraightPairs != 8
            || BarrierCaptureVerifier.ProducerVersion != "wfc.pf.barrier-verifier.v1" || BarrierCollisionKernel.CollisionVersion != "wfc.pf.triangle-centreline-collision.v1"
            || ConstrainedRouteEvaluation.PolicyVersion != "wfc.pf.constrained-tray-routing.v1" || ConstrainedRouteEvaluation.CandidateRankingVersion != "wfc.pf.accessible-piece-projections.v1"
            || RouteConnectorPlan.PolicyVersion != "wfc.pf.local-connector-lattice.v1" || LocalApproachRouteEvaluation.PolicyVersion != "wfc.pf.local-approach-routing.v1")
            throw new ArgumentException("Barrier implementation defaults no longer match the frozen runtime profile.");
    }
    private static string BarrierRouteHash(IReadOnlyList<RoutePoint> points)
    {
        if (points.Count is < 1 or > 200001) throw new ArgumentException("Exact protected route points exceed their bound.");
        var bits = points.Select(point => new[] { Bits(point.X), Bits(point.Y), Bits(point.Z) }).ToArray();
        return BarrierHash(JsonSerializer.SerializeToElement(new { schemaVersion = "wfc.pf.route-binary64-le.v1", pointBits = bits }, Json));
        static string Bits(double value)
        {
            if (!double.IsFinite(value) || Math.Abs(value) > 1e9) throw new ArgumentException("Protected route point is out of range.");
            // JSON/JSONB preserves numerical zero, not its sign. The durable
            // route identity normalizes only signed zero; every nonzero finite
            // coordinate retains its exact binary64 bits. Core points/math stay
            // unchanged, including subnormal values and underflow decisions.
            Span<byte> bytes = stackalloc byte[8]; BinaryPrimitives.WriteInt64LittleEndian(bytes, value == 0 ? 0L : BitConverter.DoubleToInt64Bits(value));
            return Convert.ToHexString(bytes).ToLowerInvariant();
        }
    }
    internal static void ValidateResponseVersion(JsonElement response, Request request)
    {
        string? version = response.GetProperty("schemaVersion").GetString();
        if (request.SchemaVersion == "pathfinder.model.runner.v2")
        {
            if (version != "pathfinder.model.response.v3" || request.Barriers is not { } expected
                || !BarrierEqual(expected, response.GetProperty("barriers").GetProperty("context")))
                throw new InvalidDataException("Protected worker response was downgraded or its context changed.");
        }
        else if (version is not ("pathfinder.model.response.v1" or "pathfinder.model.response.v2")
            || version == "pathfinder.model.response.v2" && request.DirectSecondaryPolicy is null)
            throw new InvalidDataException("Worker response schema mismatch.");
        if (response.GetProperty("requestId").GetString() != request.RequestId || response.GetProperty("engineeringAccepted").GetBoolean())
            throw new InvalidDataException("Worker response identity mismatch.");
    }
}

internal sealed record BarrierRuntimeContext(JsonElement Value, JsonElement Binding, JsonElement Scope, JsonElement Snapshot, JsonElement Storage, bool Drill)
{
    internal string? Mode => Snapshot.ValueKind == JsonValueKind.Null ? null : Snapshot.GetProperty("mode").GetString();
}
internal sealed record BarrierBlob(string Id, string Sha256, int Bytes)
{
    internal static void Validate(JsonElement value, int maximum)
    {
        SessionProtocol.Fields(value, "blobId", "sha256", "bytes");
        if (!Regex.IsMatch(value.GetProperty("blobId").GetString() ?? "", "^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\\z") || !Regex.IsMatch(value.GetProperty("sha256").GetString() ?? "", "^[a-f0-9]{64}\\z")
            || value.GetProperty("bytes").GetInt32() is < 1 || value.GetProperty("bytes").GetInt32() > maximum) throw new ArgumentException("Barrier opaque blob reference rejected.");
    }
    internal static BarrierBlob Parse(JsonElement value) => new(value.GetProperty("blobId").GetString()!, value.GetProperty("sha256").GetString()!, value.GetProperty("bytes").GetInt32());
}
