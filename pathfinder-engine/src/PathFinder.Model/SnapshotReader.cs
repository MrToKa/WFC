using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using AddinRibbon.Routing;

namespace PathFinder.Model;

public static class SnapshotReader
{
    public static JsonSerializerOptions JsonOptions { get; } = Options();
    private static JsonSerializerOptions Options()
    {
        var value = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = false,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow, MaxDepth = 64,
            NumberHandling = JsonNumberHandling.Strict, TypeInfoResolver = new DefaultJsonTypeInfoResolver()
        };
        value.MakeReadOnly(); return value;
    }
    public static ModelSnapshot Read(ReadOnlyMemory<byte> bytes, ModelLimits? limits = null, CancellationToken cancellation = default)
    {
        limits ??= new();
        cancellation.ThrowIfCancellationRequested();
        if (bytes.Length == 0 || bytes.Length > limits.MaximumBytes) throw new ArgumentException("Snapshot byte budget exceeded.");
        using (var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 64 })) RejectDuplicates(document.RootElement, cancellation);
        var snapshot = JsonSerializer.Deserialize<ModelSnapshot>(bytes.Span, JsonOptions) ?? throw new ArgumentException("Snapshot cannot be null.");
        Validate(snapshot, limits, cancellation);
        return snapshot;
    }
    public static string Sha256(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    internal static void Validate(ModelSnapshot snapshot, ModelLimits limits, CancellationToken cancellation)
    {
        if (snapshot.SchemaVersion != "pathfinder.model.snapshot.v1") throw new ArgumentException("Unsupported snapshot schema.");
        if (snapshot.Model is null || snapshot.Capture is null || snapshot.Coordinates is null || snapshot.Objects is null)
            throw new ArgumentException("Snapshot sections cannot be null.");
        var model = snapshot.Model; var capture = snapshot.Capture; var coordinates = snapshot.Coordinates;
        Text(model.ProjectId, "projectId", 256); Text(model.ModelVersionId, "modelVersionId", 256); Hash(model.ContentSha256);
        if (model.SourceContentSha256 is not null) Hash(model.SourceContentSha256);
        Text(capture.AdapterVersion, "adapterVersion", 256);
        if (capture.SourceKind is not ("converted" or "native" or "synthetic")) throw new ArgumentException("Unknown sourceKind.");
        if (capture.EvidenceSha256 is null || capture.EvidenceSha256.Length > 256) throw new ArgumentException("Evidence hashes outside budget.");
        foreach (var value in capture.EvidenceSha256) Hash(value);
        if (capture.SourceLinkVerified && model.SourceContentSha256 is null) throw new ArgumentException("A verified source link needs its source content SHA256.");
        if (coordinates.VertexFrame != "canonical-world-metres") throw new ArgumentException("Only already canonical world-metre vertices are admitted; adapters must transform exactly once before the boundary.");
        Text(coordinates.SourceUnits, "sourceUnits", 64);
        if (coordinates.MetresPerSourceUnit is { } scale && (!double.IsFinite(scale) || scale <= 0 || scale > 1e9)) throw new ArgumentException("Invalid source unit scale.");
        if (capture.UnitsVerified && (coordinates.MetresPerSourceUnit is null || coordinates.SourceUnits == "unknown")) throw new ArgumentException("Verified units require a declared unit and positive scale.");
        if (coordinates.SourceToWorldMetres is not null) AffineTransform.Validate(coordinates.SourceToWorldMetres);
        if (capture.TransformsVerified && coordinates.SourceToWorldMetres is null) throw new ArgumentException("Verified transforms require a source-to-world matrix.");
        _ = AffineTransform.Point(coordinates.GlobalOffsetMetres); AffineTransform.Validate(coordinates.DisplayToWorldMetres);
        if (snapshot.Objects.Length == 0 || snapshot.Objects.Length > limits.MaximumObjects) throw new ArgumentException("Object count outside snapshot budget.");
        var ids = new HashSet<string>(StringComparer.Ordinal); var dbIds = new HashSet<int>(); var fragmentIds = new HashSet<string>(StringComparer.Ordinal);
        int fragments = 0, vertices = 0, triangles = 0;
        foreach (var item in snapshot.Objects)
        {
            cancellation.ThrowIfCancellationRequested();
            if (item is null) throw new ArgumentException("Object cannot be null.");
            Text(item.Id, "object.id", 256); if (!ids.Add(item.Id)) throw new ArgumentException("Duplicate version-local object identity.");
            if (item.ParentId is not null) Text(item.ParentId, "parentId", 256);
            if (item.ExternalId is not null) Text(item.ExternalId, "externalId", 1024);
            if (item.DbId is { } dbId && (dbId < 0 || !dbIds.Add(dbId))) throw new ArgumentException("Invalid/duplicate version-local dbId.");
            Text(item.Name, "object.name", 2048, true);
            if (item.GeometryRole is not ("hierarchy" or "object" or "routing-leaf")) throw new ArgumentException("Unknown object geometry role.");
            if (item.RouteName is not null) Text(item.RouteName, "routeName", 2048, true);
            if (item.RouteBoundaryId is not null)
            {
                Text(item.RouteBoundaryId, "routeBoundaryId", 256);
                if (item.GeometryRole != "routing-leaf" || item.RouteName is not null || item.ShapeName is not null)
                    throw new ArgumentException("A selected route boundary belongs only to a routing-leaf without competing route/shape labels.");
            }
            if (item.ShapeName is not null) Text(item.ShapeName, "shapeName", 2048, true);
            if (item.LeafToRootNames is null || item.LeafToRootNames.Length == 0 || item.LeafToRootNames.Length > limits.MaximumDepth) throw new ArgumentException("Hierarchy evidence outside budget.");
            foreach (var name in item.LeafToRootNames) Text(name, "hierarchyName", 2048, true);
            if (item.Properties is null || item.Properties.Length > limits.MaximumPropertiesPerObject) throw new ArgumentException("Property count outside budget.");
            foreach (var property in item.Properties)
            {
                if (property is null) throw new ArgumentException("Property cannot be null.");
                Text(property.Category, "property.category", 512, true); Text(property.Name, "property.name", 512, true); Text(property.Value, "property.value", 16384, true);
            }
            if (item.CategoryAssignmentSource is not ("explicit-planning" or "native-reference-selection" or "synthetic" or "unassigned")) throw new ArgumentException("Unknown category assignment source.");
            if (item.AllowedCategories is null || item.AllowedCategories.Length > 3) throw new ArgumentException("Invalid category assignment.");
            _ = Categories(item.AllowedCategories);
            if (item.CategoryAssignmentSource == "unassigned" && item.AllowedCategories.Length != 0) throw new ArgumentException("Unassigned category cannot contain inferred planning assignments.");
            Bounds(item.Bounds);
            if (item.Fragments is null) throw new ArgumentException("Fragments cannot be null.");
            if (item.GeometryRole == "hierarchy" && item.Fragments.Length != 0) throw new ArgumentException("Hierarchy-only objects cannot carry physical fragment meshes.");
            foreach (var fragment in item.Fragments)
            {
                cancellation.ThrowIfCancellationRequested();
                if (++fragments > limits.MaximumFragments || fragment is null) throw new ArgumentException("Fragment budget exceeded or null fragment.");
                Text(fragment.Id, "fragment.id", 256); if (!fragmentIds.Add(fragment.Id)) throw new ArgumentException("Duplicate version-local fragment identity.");
                if (!fragment.TransformAlreadyApplied) throw new ArgumentException("Canonical fragment has unapplied transforms; refuse a second or missing conversion.");
                if (fragment.FragmentToWorldMetres is not null) AffineTransform.Validate(fragment.FragmentToWorldMetres);
                if (capture.TransformsVerified && fragment.FragmentToWorldMetres is null) throw new ArgumentException("Verified capture needs fragment matrix evidence.");
                if (fragment.Vertices is null || fragment.TriangleIndices is null || fragment.Vertices.Length < 3 || fragment.TriangleIndices.Length % 3 != 0)
                    throw new ArgumentException("Invalid mesh arrays.");
                vertices = checked(vertices + fragment.Vertices.Length); triangles = checked(triangles + fragment.TriangleIndices.Length / 3);
                if (vertices > limits.MaximumVertices || triangles > limits.MaximumTriangles) throw new ArgumentException("Model mesh resource budget exceeded.");
                foreach (var value in fragment.Vertices)
                {
                    cancellation.ThrowIfCancellationRequested(); _ = AffineTransform.Point(value);
                    for (var axis = 0; axis < 3; axis++) if (value[axis] < item.Bounds.Minimum[axis] - 1e-6 || value[axis] > item.Bounds.Maximum[axis] + 1e-6)
                        throw new ArgumentException("Canonical vertex lies outside declared object world bounds.");
                }
                foreach (var index in fragment.TriangleIndices) if (index < 0 || index >= fragment.Vertices.Length) throw new ArgumentException("Triangle index outside its fragment vertices.");
            }
            var faces = item.FaceExtents ?? [];
            if (faces.Length > 6 || faces.Select(f => f?.Face).Distinct(StringComparer.Ordinal).Count() != faces.Length) throw new ArgumentException("Face evidence is duplicate/outside budget.");
            foreach (var face in faces)
            {
                if (face is null || !Enum.TryParse<TrayBoxFace>(face.Face, out var parsed) || !Enum.IsDefined(parsed) || face.Face != parsed.ToString() || face.SampleCount < 0)
                    throw new ArgumentException("Invalid face extent.");
                Bounds(face.Bounds);
            }
        }
        var parentIdentities = snapshot.Objects.Where(item => item.ParentId is not null).Select(item => item.ParentId!).ToHashSet(StringComparer.Ordinal);
        if (snapshot.Objects.Any(item => item.GeometryRole == "routing-leaf" && parentIdentities.Contains(item.Id)))
            throw new ArgumentException("A routing-leaf cannot be the parent of another inventory object.");
        _ = Visibility(snapshot, limits, cancellation); // Validates parents/cycles before any fitting or cache write.
        var byId = snapshot.Objects.ToDictionary(item => item.Id, StringComparer.Ordinal);
        foreach (var item in snapshot.Objects.Where(item => item.RouteBoundaryId is not null))
        {
            var chainNames = new List<string>(); var current = item; bool found = false;
            while (true)
            {
                cancellation.ThrowIfCancellationRequested();
                chainNames.Add(current.Name);
                if (current.Id == item.RouteBoundaryId) found = true;
                if (current.ParentId is null) break;
                if (!byId.TryGetValue(current.ParentId, out current!)) throw new ArgumentException("Selected route boundary hierarchy is incomplete.");
            }
            if (!found) throw new ArgumentException("Selected route boundary is not an ancestor of its physical leaf.");
            if (!chainNames.SequenceEqual(item.LeafToRootNames, StringComparer.Ordinal)) throw new ArgumentException("Selected route boundary hierarchy names disagree with parents.");
        }
    }

    internal static Dictionary<string, string> Visibility(ModelSnapshot snapshot, ModelLimits limits, CancellationToken cancellation)
    {
        var objects = snapshot.Objects.ToDictionary(x => x.Id, StringComparer.Ordinal);
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var depths = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var item in snapshot.Objects)
        {
            cancellation.ThrowIfCancellationRequested();
            if (result.ContainsKey(item.Id)) continue;
            var path = new List<SnapshotObject>(); var seen = new HashSet<string>(StringComparer.Ordinal);
            var current = item; string ancestor = "visible"; int ancestorDepth = 0;
            while (true)
            {
                if (result.TryGetValue(current.Id, out ancestor!)) { ancestorDepth = depths[current.Id]; break; }
                if (!seen.Add(current.Id) || path.Count >= limits.MaximumDepth) throw new ArgumentException("Cyclic or over-depth object hierarchy.");
                path.Add(current);
                if (current.ParentId is null) { ancestor = "visible"; break; }
                if (!objects.TryGetValue(current.ParentId, out var parent))
                {
                    if (snapshot.Capture.InventoryComplete) throw new ArgumentException("Complete inventory references a missing parent.");
                    ancestor = "unknown"; break;
                }
                current = parent;
            }
            for (var i = path.Count - 1; i >= 0; i--)
            {
                var node = path[i];
                if (++ancestorDepth > limits.MaximumDepth) throw new ArgumentException("Object hierarchy total depth exceeds its budget.");
                ancestor = ancestor == "hidden" || node.NativeHidden == true ? "hidden" : ancestor == "unknown" || node.NativeHidden is null ? "unknown" : "visible";
                result[node.Id] = ancestor;
                depths[node.Id] = ancestorDepth;
            }
        }
        return result;
    }
    internal static CableCategory Categories(IEnumerable<string> values)
    {
        var result = CableCategory.None;
        foreach (var value in values)
        {
            var mapped = value switch { "MV" => CableCategory.MV, "LV" => CableCategory.LV, "Control" or "Instrumentation" => CableCategory.Control, _ => throw new ArgumentException("Unknown planning category.") };
            if ((result & mapped) != 0) throw new ArgumentException("Duplicate mapped planning category."); result |= mapped;
        }
        return result;
    }
    private static void Bounds(SnapshotBounds bounds)
    {
        if (bounds is null) throw new ArgumentException("World bounds required.");
        _ = AffineTransform.Point(bounds.Minimum); _ = AffineTransform.Point(bounds.Maximum);
        for (var axis = 0; axis < 3; axis++) if (bounds.Minimum[axis] > bounds.Maximum[axis]) throw new ArgumentException("Inverted world bounds.");
    }
    private static void Text(string? value, string field, int max, bool empty = false)
    {
        if (value is null || value.Length > max || (!empty && string.IsNullOrWhiteSpace(value)) || value.Any(char.IsControl)) throw new ArgumentException(field + " invalid text.");
    }
    private static void Hash(string? value)
    {
        if (value is null || value.Length != 64 || value.Any(c => !char.IsAsciiHexDigit(c)) || value != value.ToLowerInvariant()) throw new ArgumentException("Invalid lowercase SHA256.");
    }
    private static void RejectDuplicates(JsonElement element, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name)) throw new ArgumentException("Duplicate JSON property.");
                RejectDuplicates(property.Value, cancellation);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array) foreach (var value in element.EnumerateArray()) RejectDuplicates(value, cancellation);
    }
}
