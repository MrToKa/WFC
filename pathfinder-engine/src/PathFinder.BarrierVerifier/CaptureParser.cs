using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace PathFinder.BarrierVerifier;

internal static class CaptureParser
{
    internal static JsonSerializerOptions Json { get; } = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow, MaxDepth = 48,
        NumberHandling = JsonNumberHandling.Strict,
    };
    private static readonly Regex Uuid = new("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\\z", RegexOptions.CultureInvariant);
    private static readonly Regex Hash = new("^[a-f0-9]{64}\\z", RegexOptions.CultureInvariant);
    private static readonly Regex Revision = new("^(?:0|[1-9][0-9]{0,18})\\z", RegexOptions.CultureInvariant);
    private static readonly Regex ObjectId = new("^dbid:(?:0|[1-9][0-9]*)\\z", RegexOptions.CultureInvariant);

    internal static (Capture Value, Dictionary<int, string> SourceHashes) Parse(ReadOnlyMemory<byte> bytes, BarrierVerifierLimits limits, VerifierBudget budget)
    {
        if (bytes.Length is < 1 || bytes.Length > limits.MaximumBytes) throw new VerifierRefusal("CAPTURE_BYTES_LIMIT", "Capture bytes exceed the declared bound.");
        _ = new UTF8Encoding(false, true).GetCharCount(bytes.Span);
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 48 });
        RejectDuplicates(document.RootElement, budget);
        Preflight(document.RootElement, limits, budget);
        var capture = JsonSerializer.Deserialize<Capture>(bytes.Span, Json) ?? throw new VerifierRefusal("INVALID_CAPTURE", "Capture is required.");
        if (capture.SchemaVersion != "wfc.pf.barrier-capture.v1") Fail("Unsupported capture schema.");
        Id(capture.CaptureId); var scope = capture.Scope ?? throw new VerifierRefusal("INVALID_CAPTURE", "Scope is required.");
        Id(scope.ProjectId); Id(scope.ModelVersionId); Digest(scope.ContentFingerprint); Id(scope.CaptureFrameId); Digest(scope.CaptureFrameSha256);
        if (scope.CoordinateFrame != "canonical-world-metres" || scope.SelectionRevision is null || scope.SelectionRevision.Length > 19
            || !Revision.IsMatch(scope.SelectionRevision) || !long.TryParse(scope.SelectionRevision, out _)) Fail("Invalid canonical model/frame scope.");
        if (capture.SelectedParents is null || capture.SelectedParents.Length is < 1 || capture.SelectedParents.Length > limits.MaximumParents)
            Fail("Selected parent count is outside its limit.");
        var parents = new HashSet<string>(StringComparer.Ordinal); var objects = new HashSet<string>(StringComparer.Ordinal);
        foreach (var parent in capture.SelectedParents!)
        {
            budget.Spend(); if (parent is null) Fail("Selected parent cannot be null.");
            Id(parent!.SelectionId); Object(parent.ObjectId); Text(parent.Name, 2048); if (parent.ExternalId is not null) Text(parent.ExternalId, 2048);
            if (!parents.Add(parent.SelectionId) || !objects.Add(parent.ObjectId) || parent.DbId < 0 || parent.ObjectId != "dbid:" + parent.DbId
                || parent.Kind is not ("wall" or "partition" or "floor" or "ceiling" or "obstacle") || parent.IdentityBasis != "version-local-only"
                || parent.Inclusion != "own-and-all-descendant-fragments") Fail("Selected parent identities or membership are inconsistent.");
        }
        if (capture.Fragments is null || capture.Fragments.Length > limits.MaximumFragments) Fail("Fragment count is outside its limit.");
        var observation = capture.Observation ?? throw new VerifierRefusal("INVALID_CAPTURE", "Unverified capture observation is required.");
        Digest(observation.EnumerationSha256);
        if (observation.Verification != "unverified" || observation.State is not ("reported-complete" or "partial")) Fail("Capture observation must remain unverified.");
        var enumerated = UniqueIds(observation.EnumeratedFragmentIds, limits.MaximumFragments, budget);
        var unavailable = UniqueIds(observation.UnavailableFragmentIds, limits.MaximumFragments, budget);
        if (observation.State != "reported-complete" || unavailable.Count != 0)
            throw new VerifierRefusal("PARTIAL_CAPTURE", "An incomplete observation cannot qualify the selected geometry. Reported completeness still needs independent SDK closure verification.");
        var fragments = new HashSet<int>(); var representedParents = new HashSet<string>(StringComparer.Ordinal); int vertices = 0, triangles = 0;
        foreach (var fragment in capture.Fragments!)
        {
            budget.Spend(); if (fragment is null || fragment.Source is null || fragment.Bounds is null) Fail("Fragment sections cannot be null.");
            var source = fragment!.Source!;
            if (source.FragmentId < 0 || !fragments.Add(source.FragmentId) || !enumerated.Contains(source.FragmentId)) Fail("Fragment IDs must be unique and close over the observation.");
            Object(source.OwnerObjectId); Text(source.SourceUnits, 64); Digest(source.TransformSha256);
            if (!double.IsFinite(source.MetresPerSourceUnit) || source.MetresPerSourceUnit is <= 0 or > 1_000_000) Fail("Source unit scale is invalid.");
            Matrix(source.SourceToWorldMetres);
            if (source.ParentSelectionIds is null || source.ParentSelectionIds.Length is < 1 || source.ParentSelectionIds.Length > limits.MaximumParents) Fail("Fragment parent membership is invalid.");
            var memberships = new HashSet<string>(StringComparer.Ordinal);
            foreach (var parent in source.ParentSelectionIds!)
            {
                budget.Spend(); Id(parent);
                if (!parents.Contains(parent) || !memberships.Add(parent)) Fail("Fragment parent membership must be unique and in scope.");
                representedParents.Add(parent);
            }
            Point(fragment.Bounds!.Minimum); Point(fragment.Bounds.Maximum);
            for (var axis = 0; axis < 3; axis++) if (fragment.Bounds.Minimum[axis] > fragment.Bounds.Maximum[axis]) Fail("Fragment bounds are inverted.");
            if (fragment.VerticesMetres is null || fragment.VerticesMetres.Length < 3 || fragment.TriangleIndices is null
                || fragment.TriangleIndices.Length < 3 || fragment.TriangleIndices.Length % 3 != 0) Fail("Indexed triangles are required.");
            vertices = checked(vertices + fragment.VerticesMetres!.Length); triangles = checked(triangles + fragment.TriangleIndices!.Length / 3);
            if (vertices > limits.MaximumVertices || triangles > limits.MaximumTriangles) throw new VerifierRefusal("GEOMETRY_COUNT_LIMIT", "Aggregate vertices or triangles exceed the bound.");
            foreach (var point in fragment.VerticesMetres)
            {
                budget.Spend(); Point(point);
                for (var axis = 0; axis < 3; axis++) if (point[axis] < fragment.Bounds.Minimum[axis] || point[axis] > fragment.Bounds.Maximum[axis]) Fail("Fragment bounds do not contain a vertex.");
            }
            for (var at = 0; at < fragment.TriangleIndices.Length; at += 3)
            {
                budget.Spend(); int a = fragment.TriangleIndices[at], b = fragment.TriangleIndices[at + 1], c = fragment.TriangleIndices[at + 2];
                if (a < 0 || b < 0 || c < 0 || a >= fragment.VerticesMetres.Length || b >= fragment.VerticesMetres.Length || c >= fragment.VerticesMetres.Length
                    || a == b || b == c || a == c) Fail("Triangle indices are invalid.");
            }
        }
        if (!fragments.SetEquals(enumerated) || fragments.Count == 0 || !representedParents.SetEquals(parents))
            Fail("Captured fragments do not structurally close over every reported parent and enumerated fragment.");
        var sourceHashes = new Dictionary<int, string>();
        foreach (var item in document.RootElement.GetProperty("fragments").EnumerateArray())
        {
            budget.Spend(); var source = item.GetProperty("source");
            sourceHashes.Add(source.GetProperty("fragmentId").GetInt32(), BarrierCaptureVerifier.Hash(Encoding.UTF8.GetBytes(source.GetRawText())));
        }
        return (capture, sourceHashes);
    }

    private static void RejectDuplicates(JsonElement value, VerifierBudget budget)
    {
        budget.Spend();
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject())
            {
                if (names.Count >= 32) Fail("Object member count exceeds the capture protocol bound.");
                if (!names.Add(property.Name)) Fail("Duplicate JSON members are not allowed.");
                RejectDuplicates(property.Value, budget);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array) foreach (var item in value.EnumerateArray()) RejectDuplicates(item, budget);
    }
    private static void Preflight(JsonElement root, BarrierVerifierLimits limits, VerifierBudget budget)
    {
        JsonElement Array(JsonElement owner, string property, int minimum, int maximum)
        {
            budget.Spend();
            if (owner.ValueKind != JsonValueKind.Object || !owner.TryGetProperty(property, out var array) || array.ValueKind != JsonValueKind.Array)
                throw new VerifierRefusal("INVALID_CAPTURE", "Capture requires an array field: " + property + ".");
            int count = array.GetArrayLength();
            if (count < minimum || count > maximum) throw new VerifierRefusal("ARRAY_COUNT_LIMIT", "Capture array count exceeds its declared bound: " + property + ".");
            return array;
        }
        JsonElement Object(JsonElement owner, string property)
        {
            budget.Spend();
            if (owner.ValueKind != JsonValueKind.Object || !owner.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.Object)
                throw new VerifierRefusal("INVALID_CAPTURE", "Capture requires an object field: " + property + ".");
            return value;
        }
        _ = Array(root, "selectedParents", 1, limits.MaximumParents);
        var observation = Object(root, "observation");
        _ = Array(observation, "enumeratedFragmentIds", 0, limits.MaximumFragments);
        _ = Array(observation, "unavailableFragmentIds", 0, limits.MaximumFragments);
        int vertices = 0, triangles = 0;
        foreach (var fragment in Array(root, "fragments", 0, limits.MaximumFragments).EnumerateArray())
        {
            budget.Spend(); var source = Object(fragment, "source"); var bounds = Object(fragment, "bounds");
            _ = Array(source, "parentSelectionIds", 1, limits.MaximumParents);
            _ = Array(source, "sourceToWorldMetres", 16, 16);
            _ = Array(bounds, "minimum", 3, 3); _ = Array(bounds, "maximum", 3, 3);
            var points = Array(fragment, "verticesMetres", 3, limits.MaximumVertices);
            var indices = Array(fragment, "triangleIndices", 3, limits.MaximumTriangles * 3);
            vertices = checked(vertices + points.GetArrayLength());
            int count = indices.GetArrayLength(); if (count % 3 != 0) Fail("Triangle index count must be divisible by three.");
            triangles = checked(triangles + count / 3);
            if (vertices > limits.MaximumVertices || triangles > limits.MaximumTriangles)
                throw new VerifierRefusal("GEOMETRY_COUNT_LIMIT", "Aggregate geometry exceeds its bound before DTO allocation.");
            foreach (var point in points.EnumerateArray())
            {
                budget.Spend(); if (point.ValueKind != JsonValueKind.Array || point.GetArrayLength() != 3) Fail("A point must contain exactly three coordinates.");
            }
        }
    }
    private static HashSet<int> UniqueIds(int[]? values, int maximum, VerifierBudget budget)
    {
        if (values is null || values.Length > maximum) { Fail("Observation IDs exceed their bound."); return []; }
        var ids = new HashSet<int>(); foreach (var id in values) { budget.Spend(); if (id < 0 || !ids.Add(id)) Fail("Observation IDs must be unique nonnegative integers."); } return ids;
    }
    private static void Id(string? value) { if (value is null || value.Length != 36 || !Uuid.IsMatch(value)) Fail("A lower-case UUID is required."); }
    private static void Digest(string? value) { if (value is null || value.Length != 64 || !Hash.IsMatch(value)) Fail("A lower-case SHA256 is required."); }
    private static void Object(string? value) { if (value is null || value.Length is < 6 or > 16 || !ObjectId.IsMatch(value) || !int.TryParse(value.AsSpan(5), out _)) Fail("A version-local object ID is required."); }
    private static void Text(string? value, int maximum)
    {
        if (value is null || value.Length < 1 || value.Length > maximum) { Fail("Text exceeds its bound."); return; }
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i]; if (c < 32 || c is >= '\u007f' and <= '\u009f') Fail("Control characters are not allowed.");
            if (char.IsHighSurrogate(c)) { if (i + 1 >= value.Length || !char.IsLowSurrogate(value[++i])) Fail("Unpaired surrogates are not allowed."); }
            else if (char.IsLowSurrogate(c)) Fail("Unpaired surrogates are not allowed.");
        }
    }
    private static void Point(double[]? values)
    {
        if (values is null || values.Length != 3 || values.Any(v => !double.IsFinite(v) || Math.Abs(v) > 1e9)) Fail("A finite canonical-metre point is required.");
    }
    private static void Matrix(double[]? values)
    {
        if (values is null || values.Length != 16 || values.Any(v => !double.IsFinite(v) || Math.Abs(v) > 1e9)) { Fail("A finite affine matrix is required."); return; }
        if (values[3] != 0 || values[7] != 0 || values[11] != 0 || values[15] != 1) Fail("Matrix must be column-major affine.");
        double determinant = values[0] * (values[5] * values[10] - values[9] * values[6]) - values[4] * (values[1] * values[10] - values[9] * values[2]) + values[8] * (values[1] * values[6] - values[5] * values[2]);
        if (!double.IsFinite(determinant) || determinant == 0) Fail("Matrix must be nonsingular.");
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Fail(string message) => throw new VerifierRefusal("INVALID_CAPTURE", message);
}

internal sealed record Capture
{
    public required string SchemaVersion { get; init; }
    public required string CaptureId { get; init; }
    public required BarrierVerifierScope Scope { get; init; }
    public required Parent[] SelectedParents { get; init; }
    public required Fragment[] Fragments { get; init; }
    public required Observation Observation { get; init; }
}
internal sealed record Parent
{
    public required string SelectionId { get; init; }
    public required string Kind { get; init; }
    public required string ObjectId { get; init; }
    public required int DbId { get; init; }
    public required string? ExternalId { get; init; }
    public required string Name { get; init; }
    public required string IdentityBasis { get; init; }
    public required string Inclusion { get; init; }
}
internal sealed record Fragment
{
    public required FragmentSource Source { get; init; }
    public required FragmentBounds Bounds { get; init; }
    public required double[][] VerticesMetres { get; init; }
    public required int[] TriangleIndices { get; init; }
}
internal sealed record FragmentSource
{
    public required int FragmentId { get; init; }
    public required string OwnerObjectId { get; init; }
    public required string[] ParentSelectionIds { get; init; }
    public required string SourceUnits { get; init; }
    public required double MetresPerSourceUnit { get; init; }
    public required double[] SourceToWorldMetres { get; init; }
    public required string TransformSha256 { get; init; }
}
internal sealed record FragmentBounds
{
    public required double[] Minimum { get; init; }
    public required double[] Maximum { get; init; }
}
internal sealed record Observation
{
    public required string State { get; init; }
    public required string Verification { get; init; }
    public required int[] EnumeratedFragmentIds { get; init; }
    public required int[] UnavailableFragmentIds { get; init; }
    public required string EnumerationSha256 { get; init; }
}
