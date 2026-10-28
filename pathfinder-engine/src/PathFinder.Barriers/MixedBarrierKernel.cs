using System.Buffers.Binary;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace PathFinder.Barriers;

public enum MixedBarrierComponentKind { OriginalSurface, QualifiedClosedSolid }
public enum MixedBarrierSegmentStatus { Clear, Blocked, Indeterminate }
public sealed record MixedFragmentProvenance(int FragmentId, string OwnerObjectId, IReadOnlyList<string> ParentSelectionIds,
    string SourceSha256, string TransformSha256, string SourceUnits, double MetresPerSourceUnit, IReadOnlyList<long> SourceToWorldBits);
public sealed record MixedFragmentInput(MixedFragmentProvenance Source, IReadOnlyList<BarrierPoint> Vertices, IReadOnlyList<int> TriangleIndices);
public readonly record struct MixedOriginalTriangle(MixedFragmentProvenance Source, int LocalTriangleIndex,
    int OriginalVertexA, int OriginalVertexB, int OriginalVertexC, BarrierPoint A, BarrierPoint B, BarrierPoint C);
public sealed record MixedBarrierComponent(string Id, MixedBarrierComponentKind Kind, IReadOnlyList<MixedOriginalTriangle> Triangles);
public sealed record MixedBarrierSummary(int ComponentCount, int OriginalSurfaceComponents, int QualifiedClosedSolidComponents,
    int FragmentCount, int VertexCount, int TriangleCount, string OriginalGeometrySha256, long EstimatedBytes, double NumericToleranceMetres)
{
    public string PolicyVersion => MixedBarrierKernel.PolicyVersion;
    public string GeometryProvenance => "capture-bound-provided-original-triangles";
    public bool SdkSourceBytesVerified => false;
    public bool GlobalModelCoverageVerified => false;
    public bool OwnTerminalExemptionsSupported => false;
    public bool PhysicalCableRadiusChecked => false;
}
public sealed record MixedBarrierBuildLimits
{
    public int MaximumFragments { get; init; } = 8192;
    public int MaximumParents { get; init; } = 128;
    public BarrierLimits Geometry { get; init; } = new();
}
public sealed record MixedBarrierBuildResult(BarrierBuildStatus Status, MixedBarrierKernel? Kernel, IReadOnlyList<BarrierDiagnostic> Diagnostics, long Work);
public sealed record MixedBarrierQueryLimits
{
    public long MaximumWork { get; init; } = 2_000_000;
    public int MaximumMilliseconds { get; init; } = 10_000;
}
public sealed record MixedBarrierWitness(string ComponentId, MixedBarrierComponentKind Kind, string ContactKind, MixedOriginalTriangle? Triangle);
public sealed record MixedBarrierSegmentResult(MixedBarrierSegmentStatus Status, string Reason, long Work, MixedBarrierWitness? Witness = null)
{
    public string PolicyVersion => MixedBarrierKernel.PolicyVersion;
    public string Domain => "provided-original-triangle-surface-contact-and-independently-qualified-closed-solid-occupancy";
    public bool GlobalModelCoverageVerified => false;
    public bool PhysicalCableRadiusChecked => false;
    public bool OwnTerminalExemptionsSupported => false;
}

/// <summary>Additive private mixed-domain foundation. Surface misses establish
/// no occupancy. Only independently qualified closed components get containment
/// checks. No inference of hidden model geometry, caps, thickness or terminal exits.</summary>
public sealed class MixedBarrierKernel
{
    public const string PolicyVersion = "wfc.pf.original-surfaces-and-qualified-solids.v2";
    public const string CollisionVersion = "wfc.pf.mixed-original-triangle-centreline.v2";
    private readonly Component[] components;
    private readonly double tolerance;
    private readonly long maximumQueryWork;
    private readonly int maximumQueryMilliseconds;
    public MixedBarrierSummary Summary { get; }
    public IReadOnlyList<MixedBarrierComponent> Components { get; }
    private MixedBarrierKernel(Component[] components, MixedBarrierSummary summary, BarrierLimits limits)
    {
        this.components = components; Summary = summary; tolerance = summary.NumericToleranceMetres;
        maximumQueryWork = limits.MaximumQueryWork; maximumQueryMilliseconds = limits.MaximumQueryMilliseconds;
        Components = Array.AsReadOnly(components.Select(value => new MixedBarrierComponent(value.Id, value.Kind,
            Array.AsReadOnly(value.Triangles.ToArray()))).ToArray());
    }
    public static MixedBarrierBuildResult Build(IEnumerable<MixedFragmentInput> input, MixedBarrierBuildLimits? limits = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested(); limits ??= new();
        var geometry = limits.Geometry ?? new(); var budget = new MixedBudget(geometry.MaximumBuildWork, geometry.MaximumBuildMilliseconds, cancellationToken);
        try
        {
            ValidateLimits(limits); if (input is null) Refuse("INVALID_FRAGMENTS", "A bounded explicit fragment set is required.");
            var fragments = new List<MixedFragmentInput>(); var ids = new HashSet<int>(); var allParents = new HashSet<string>(StringComparer.Ordinal); int vertexCount = 0, triangleCount = 0; long parentMemberships = 0; double magnitude = 1;
            bool largeSelection = limits.MaximumParents > 128 || geometry.MaximumMeshes > 256;
            foreach (var fragment in input!)
            {
                budget.Spend();
                if (fragments.Count >= limits.MaximumFragments) Refuse("FRAGMENT_LIMIT", "The fragment bound was exhausted.");
                if (fragment?.Source is null || fragment.Vertices is null || fragment.TriangleIndices is null) Refuse("INVALID_FRAGMENT", "Fragment sections are required.");
                var source = fragment!.Source;
                if (source.FragmentId < 0 || !ids.Add(source.FragmentId) || source.OwnerObjectId != "dbid:" + ParseOwner(source.OwnerObjectId)
                    || !Digest(source.SourceSha256) || !Digest(source.TransformSha256) || string.IsNullOrEmpty(source.SourceUnits) || source.SourceUnits.Length > 64
                    || !double.IsFinite(source.MetresPerSourceUnit) || source.MetresPerSourceUnit is <= 0 or > 1_000_000
                    || source.ParentSelectionIds is null || source.ParentSelectionIds.Count is < 1 || source.ParentSelectionIds.Count > limits.MaximumParents
                    || source.SourceToWorldBits is null || source.SourceToWorldBits.Count != 16) Refuse("INVALID_PROVENANCE", "Fragment provenance is invalid or exceeds its bound.");
                parentMemberships = checked(parentMemberships + source.ParentSelectionIds!.Count);
                if (largeSelection) Estimate(vertexCount, triangleCount, fragments.Count + 1, geometry, true, parentMemberships, allParents.Count);
                var parents = new string[source.ParentSelectionIds.Count]; var parentSet = new HashSet<string>(StringComparer.Ordinal);
                for (int at = 0; at < parents.Length; at++) { budget.Spend(); string parent = source.ParentSelectionIds[at]; if (!Uuid(parent) || !parentSet.Add(parent)) Refuse("INVALID_PROVENANCE", "Parent identities must be unique UUIDs."); allParents.Add(parent); if (allParents.Count > limits.MaximumParents) Refuse("PARENT_LIMIT", "The union of all fragment parent identities exceeds its bound."); parents[at] = parent; }
                Array.Sort(parents, StringComparer.Ordinal);
                var matrix = new long[16]; for (int at = 0; at < 16; at++) { budget.Spend(); matrix[at] = source.SourceToWorldBits![at]; if (!double.IsFinite(BitConverter.Int64BitsToDouble(matrix[at]))) Refuse("INVALID_PROVENANCE", "Matrix provenance must be finite."); }
                var ownedSource = new MixedFragmentProvenance(source.FragmentId, source.OwnerObjectId, Array.AsReadOnly(parents), source.SourceSha256,
                    source.TransformSha256, source.SourceUnits, source.MetresPerSourceUnit, Array.AsReadOnly(matrix));
                int vertices = fragment.Vertices!.Count, indices = fragment.TriangleIndices!.Count;
                if (vertices < 3 || indices < 3 || indices % 3 != 0 || vertices > geometry.MaximumVertices - vertexCount || indices / 3 > geometry.MaximumTriangles - triangleCount)
                    Refuse("GEOMETRY_COUNT_LIMIT", "Original vertices or triangle counts exceed the supported bound.");
                vertexCount += vertices; triangleCount += indices / 3; Estimate(vertexCount, triangleCount, fragments.Count + 1, geometry, largeSelection, parentMemberships, allParents.Count);
                var ownedVertices = new BarrierPoint[vertices]; var ownedIndices = new int[indices];
                for (int at = 0; at < vertices; at++)
                {
                    budget.Spend(); var point = fragment.Vertices[at];
                    if (!Valid(point, geometry.MaximumCoordinateMagnitude)) Refuse("INVALID_COORDINATE", "Finite canonical world-metre coordinates within the bound are required.");
                    ownedVertices[at] = point; magnitude = Math.Max(magnitude, Magnitude(point));
                }
                for (int at = 0; at < indices; at++) { budget.Spend(); int index = fragment.TriangleIndices[at]; if (index < 0 || index >= vertices) Refuse("INVALID_INDEX", "An original vertex index is outside its fragment."); ownedIndices[at] = index; }
                fragments.Add(new(ownedSource, Array.AsReadOnly(ownedVertices), Array.AsReadOnly(ownedIndices)));
            }
            if (fragments.Count == 0) Refuse("EMPTY_SCOPE", "No selected fragments were supplied.");
            fragments.Sort((a, b) => { budget.Spend(); return a.Source.FragmentId.CompareTo(b.Source.FragmentId); });
            double effectiveTolerance = Math.Max(geometry.NumericToleranceMeters, 64 * Geometry.MachineEpsilon * magnitude);
            var weld = new Dictionary<BarrierPoint, int>(); var points = new List<BarrierPoint>();
            var triangles = new List<Original>(); var edges = new Dictionary<(int, int), Edge>(); var unique = new HashSet<(int, int, int)>();
            foreach (var fragment in fragments)
            {
                var mapped = new int[fragment.Vertices.Count];
                for (int at = 0; at < mapped.Length; at++) { budget.Spend(); var point = fragment.Vertices[at]; if (!weld.TryGetValue(point, out int mappedId)) { mappedId = points.Count; points.Add(point); weld.Add(point, mappedId); } mapped[at] = mappedId; }
                for (int at = 0; at < fragment.TriangleIndices.Count; at += 3)
                {
                    budget.Spend(); int ia = fragment.TriangleIndices[at], ib = fragment.TriangleIndices[at + 1], ic = fragment.TriangleIndices[at + 2];
                    int a = mapped[ia], b = mapped[ib], c = mapped[ic];
                    if (a == b || b == c || a == c) Refuse("DEGENERATE_TRIANGLE", "Exact welding collapsed an original triangle; nothing was repaired or removed.");
                    var original = new MixedOriginalTriangle(fragment.Source, at / 3, ia, ib, ic, fragment.Vertices[ia], fragment.Vertices[ib], fragment.Vertices[ic]);
                    var primitive = Primitive(original); double longest = Geometry.Longest(primitive);
                    if (!double.IsFinite(longest) || longest <= effectiveTolerance || primitive.Normal.Length / longest <= effectiveTolerance) Refuse("DEGENERATE_TRIANGLE", "An original triangle is degenerate or below the supported numerical resolution.");
                    // Conditioning is resolved only after topology identifies an original surface or closed solid.
                    int x = Math.Min(a, Math.Min(b, c)), z = Math.Max(a, Math.Max(b, c)), y = a + b + c - x - z;
                    if (!unique.Add((x, y, z))) Refuse("DUPLICATE_TRIANGLE", "Coincident original triangles are ambiguous and are not deduplicated.");
                    int index = triangles.Count; triangles.Add(new(original, a, b, c)); AddEdge(a, b, index); AddEdge(b, c, index); AddEdge(c, a, index);
                }
            }
            var adjacency = new List<int>[triangles.Count]; for (int at = 0; at < adjacency.Length; at++) adjacency[at] = new();
            foreach (var edge in edges.Values) { budget.Spend(); if (edge.Second >= 0) { adjacency[edge.First].Add(edge.Second); adjacency[edge.Second].Add(edge.First); } }
            var seen = new bool[triangles.Count]; var componentOf = new int[triangles.Count]; var componentIds = new List<List<int>>();
            for (int at = 0; at < triangles.Count; at++)
            {
                budget.Spend(); if (seen[at]) continue;
                if (componentIds.Count >= geometry.MaximumMeshes) Refuse("COMPONENT_LIMIT", "The connected component bound was exhausted.");
                var local = new List<int>(); var queue = new Queue<int>(); queue.Enqueue(at); seen[at] = true;
                while (queue.Count > 0) { budget.Spend(); int next = queue.Dequeue(); local.Add(next); componentOf[next] = componentIds.Count; foreach (int neighbour in adjacency[next]) if (!seen[neighbour]) { seen[neighbour] = true; queue.Enqueue(neighbour); } }
                local.Sort((a, b) => { budget.Spend(); return a.CompareTo(b); }); componentIds.Add(local);
            }
            var boundary = new bool[componentIds.Count]; foreach (var edge in edges.Values) { budget.Spend(); if (edge.Second < 0) boundary[componentOf[edge.First]] = true; }
            // Original surfaces may contain separate face fans that touch only
            // at an original point, including fans reconnected elsewhere in the
            // same edge component. Preserve their triangles and exact contacts;
            // they never acquire solid occupancy. Any implicated closed component
            // still requires one connected fan and the unchanged solid verifier.
            var incident = new List<int>[points.Count]; for (int at = 0; at < incident.Length; at++) incident[at] = new();
            for (int at = 0; at < triangles.Count; at++) { budget.Spend(); var t = triangles[at]; incident[t.A].Add(at); incident[t.B].Add(at); incident[t.C].Add(at); }
            var marks = new int[triangles.Count]; int stamp = 0; var fanQueue = new Queue<int>();
            for (int vertex = 0; vertex < incident.Length; vertex++)
            {
                budget.Spend(); var faces = incident[vertex]; if (faces.Count == 0) continue;
                stamp++; marks[faces[0]] = stamp; fanQueue.Enqueue(faces[0]); int fan = 0;
                while (fanQueue.Count > 0)
                {
                    budget.Spend(); int current = fanQueue.Dequeue(); fan++;
                    foreach (int next in adjacency[current]) { budget.Spend(); var t = triangles[next]; if (marks[next] == stamp || t.A != vertex && t.B != vertex && t.C != vertex) continue; marks[next] = stamp; fanQueue.Enqueue(next); }
                }
                if (fan != faces.Count) foreach (int face in faces)
                {
                    budget.Spend();
                    if (!boundary[componentOf[face]]) Refuse("NONMANIFOLD_VERTEX", "An exactly welded vertex involving a closed component has disconnected original face fans.");
                }
            }
            var components = new List<Component>(); var closed = new List<BarrierMeshInput>(); int surfaceCount = 0; long componentParentMemberships = 0;
            for (int ordinal = 0; ordinal < componentIds.Count; ordinal++)
            {
                budget.Spend(); string id = "component:" + ordinal.ToString("D6", System.Globalization.CultureInfo.InvariantCulture); var original = new List<MixedOriginalTriangle>();
                var meshVertices = new List<BarrierPoint>(); var meshIndices = new List<int>(); var remap = new Dictionary<int, int>();
                var componentParents = largeSelection ? new HashSet<string>(StringComparer.Ordinal) : null;
                foreach (int index in componentIds[ordinal])
                {
                    budget.Spend(); var triangle = triangles[index]; original.Add(triangle.Value);
                    if (componentParents is not null) foreach (string parent in triangle.Value.Source.ParentSelectionIds) { budget.Spend(); componentParents.Add(parent); }
                    foreach (int old in new[] { triangle.A, triangle.B, triangle.C }) { budget.Spend(); if (!remap.TryGetValue(old, out int current)) { current = meshVertices.Count; meshVertices.Add(points[old]); remap.Add(old, current); } meshIndices.Add(current); }
                }
                if (componentParents is not null)
                {
                    componentParentMemberships = checked(componentParentMemberships + componentParents.Count);
                    Estimate(vertexCount, triangleCount, fragments.Count, geometry, true, parentMemberships + componentParentMemberships, allParents.Count, ordinal + 1);
                }
                var kind = boundary[ordinal] ? MixedBarrierComponentKind.OriginalSurface : MixedBarrierComponentKind.QualifiedClosedSolid;
                if (boundary[ordinal])
                {
                    foreach (var triangle in original)
                    {
                        budget.Spend(); var primitive = Primitive(triangle);
                        double uncertainty = Geometry.ArithmeticGuard(primitive, Geometry.Longest(primitive));
                        if ((!double.IsFinite(uncertainty) || uncertainty > effectiveTolerance)
                            && !MixedDyadicSurfaceContact.CertifyResolution(triangle.A, triangle.B, triangle.C, effectiveTolerance, budget.Spend, cancellationToken))
                            Refuse("SURFACE_RESOLUTION_UNCONFIRMED", "Exact original surface area/altitude could not be certified within unchanged tolerance and bounds.");
                    }
                }
                // Closed components still undergo the entire unchanged v1
                // qualification, including its original conditioning guard.
                // They cannot be downgraded into open surfaces on refusal.
                if (boundary[ordinal]) surfaceCount++; else closed.Add(new(id, meshVertices.AsReadOnly(), meshIndices.AsReadOnly()));
                components.Add(new(id, kind, original.ToArray(), Bounds.Of(meshVertices)));
            }
            // Contained closed bounds may describe a cavity. Preserve the same
            // conservative refusal as v1; never fill nested shells by union.
            for (int first = 0; first < components.Count; first++) for (int last = first + 1; last < components.Count; last++)
            {
                budget.Spend(); if (components[first].Kind != MixedBarrierComponentKind.QualifiedClosedSolid || components[last].Kind != MixedBarrierComponentKind.QualifiedClosedSolid) continue;
                if (components[first].Bounds.Contains(components[last].Bounds) || components[last].Bounds.Contains(components[first].Bounds)) Refuse("NESTED_OR_AMBIGUOUS_SHELLS", "Contained closed bounds may represent a cavity or ambiguous grouping.");
            }
            if (closed.Count > 0)
            {
                budget.Check(); var qualified = BarrierCollisionKernel.Build(closed, geometry with { MaximumBuildWork = budget.RemainingWork, MaximumBuildMilliseconds = budget.RemainingMilliseconds }, cancellationToken);
                budget.Spend(qualified.Work);
                if (qualified.Status != BarrierBuildStatus.Ready || qualified.Kernel is null) Refuse("CLOSED_SOLID_QUALIFICATION_REFUSED", "Independent unchanged closed-solid qualification refused: " + string.Join("; ", qualified.Diagnostics.Take(4).Select(value => value.Code)));
            }
            string sourceHash = SourceHash(components, fragments, budget);
            var summary = new MixedBarrierSummary(components.Count, surfaceCount, closed.Count, fragments.Count, vertexCount, triangleCount, sourceHash,
                Estimate(vertexCount, triangleCount, fragments.Count, geometry, largeSelection, parentMemberships + componentParentMemberships, allParents.Count, components.Count), effectiveTolerance);
            budget.Check(); return new(BarrierBuildStatus.Ready, new(components.ToArray(), summary, geometry), Array.Empty<BarrierDiagnostic>(), budget.Work);
            void AddEdge(int a, int b, int index)
            {
                budget.Spend(); var key = (Math.Min(a, b), Math.Max(a, b)); int direction = a < b ? 1 : -1;
                if (!edges.TryGetValue(key, out var edge)) edges.Add(key, new(index, -1, direction));
                else { if (edge.Second >= 0) Refuse("NONMANIFOLD_EDGE", "More than two original triangles share an exactly welded edge."); if (edge.Direction == direction) Refuse("INCONSISTENT_WINDING", "Adjacent original faces have inconsistent winding; no orientation repair was attempted."); edges[key] = edge with { Second = index }; }
            }
        }
        catch (MixedRefusal error) { return new(BarrierBuildStatus.Refused, null, Array.AsReadOnly(new[] { new BarrierDiagnostic(error.Code, error.Message) }), budget.Work); }
        catch (InvalidOperationException error) when (error.InnerException is MixedRefusal)
        {
            var refusal = (MixedRefusal)error.InnerException;
            return new(BarrierBuildStatus.Refused, null, Array.AsReadOnly(new[] { new BarrierDiagnostic(refusal.Code, refusal.Message) }), budget.Work);
        }
        catch (InvalidOperationException error) when (error.InnerException is OperationCanceledException)
        { System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error.InnerException).Throw(); throw; }
        catch (GeometryUncertaintyException error) { return new(BarrierBuildStatus.Refused, null, Array.AsReadOnly(new[] { new BarrierDiagnostic("ARITHMETIC_UNCERTAINTY", error.Message) }), budget.Work); }
        catch (OverflowException) { return new(BarrierBuildStatus.Refused, null, Array.AsReadOnly(new[] { new BarrierDiagnostic("RESOURCE_LIMIT", "Geometry arithmetic/count overflowed its bound.") }), budget.Work); }
    }
    public MixedBarrierSegmentResult CheckSegment(BarrierPoint from, BarrierPoint to, MixedBarrierQueryLimits? limits = null, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested(); limits ??= new() { MaximumWork = maximumQueryWork, MaximumMilliseconds = maximumQueryMilliseconds }; var budget = new MixedBudget(limits.MaximumWork, limits.MaximumMilliseconds, cancellationToken);
        if (limits.MaximumWork is < 1 or > 2_000_000 || limits.MaximumWork > maximumQueryWork || limits.MaximumMilliseconds is < 1 or > 10_000 || limits.MaximumMilliseconds > maximumQueryMilliseconds || !Valid(from, 1e9) || !Valid(to, 1e9)) return new(MixedBarrierSegmentStatus.Indeterminate, "INVALID_QUERY", 0);
        try
        {
            double guard = Math.Max(tolerance, 64 * Geometry.MachineEpsilon * Math.Max(Magnitude(from), Magnitude(to))); var first = new V(from); var last = new V(to);
            // Every component participates in contact. A closed-solid label may
            // add containment, never remove any original surface triangle.
            foreach (var component in components)
            {
                budget.Spend(); if (!component.Bounds.Overlaps(from, to, guard)) continue;
                foreach (var triangle in component.Triangles)
                {
                    budget.Spend(); if (!Bounds.Of(triangle).Overlaps(from, to, guard)) continue;
                    var contact = OriginalTriangleSurfaceContact.Check(from, to, triangle.A, triangle.B, triangle.C, tolerance, cancellationToken); budget.Spend(contact.Work);
                    if (contact.Status == OriginalTriangleContactStatus.Indeterminate)
                    {
                        if (component.Kind == MixedBarrierComponentKind.OriginalSurface)
                        {
                            var exact = MixedDyadicSurfaceContact.Check(from, to, triangle.A, triangle.B, triangle.C, guard, budget.Spend, cancellationToken);
                            if (exact == MixedExactSurfaceStatus.Contact) return Result(MixedBarrierSegmentStatus.Blocked, "ORIGINAL_TRIANGLE_EXACT_CONTACT", new(component.Id, component.Kind, "surface-contact", triangle));
                            if (exact == MixedExactSurfaceStatus.NoSurfaceContact) continue;
                        }
                        return Result(MixedBarrierSegmentStatus.Indeterminate, "TRIANGLE_ARITHMETIC_UNCERTAINTY");
                    }
                    if (contact.Status == OriginalTriangleContactStatus.Contact) return Result(MixedBarrierSegmentStatus.Blocked, "ORIGINAL_TRIANGLE_CONTACT", new(component.Id, component.Kind, "surface-contact", triangle));
                }
            }
            foreach (var component in components)
            {
                budget.Spend(); if (component.Kind != MixedBarrierComponentKind.QualifiedClosedSolid) continue;
                foreach (var point in first == last ? new[] { first } : new[] { first, last })
                {
                    if (!component.Bounds.Contains(new(point.X, point.Y, point.Z), guard)) continue;
                    double sum = 0, correction = 0;
                    foreach (var original in component.Triangles)
                    {
                        budget.Spend(2); var triangle = Primitive(original);
                        double uncertainty = Geometry.ArithmeticGuard(triangle, Math.Max(Geometry.Longest(triangle), (point - triangle.A).Length));
                        if (!double.IsFinite(uncertainty) || uncertainty > guard) return Result(MixedBarrierSegmentStatus.Indeterminate, "SOLID_CONTAINMENT_ARITHMETIC_UNCERTAINTY");
                        double term = Geometry.SolidAngle(point, triangle) - correction, next = sum + term; correction = (next - sum) - term; sum = next;
                    }
                    double winding = Math.Abs(sum) / (4 * Math.PI);
                    if (!double.IsFinite(winding) || Math.Min(winding, Math.Abs(winding - 1)) > .000001) return Result(MixedBarrierSegmentStatus.Indeterminate, "SOLID_CONTAINMENT_AMBIGUOUS");
                    if (winding > .5) return Result(MixedBarrierSegmentStatus.Blocked, "QUALIFIED_CLOSED_SOLID_OCCUPANCY", new(component.Id, component.Kind, "qualified-solid-occupancy", null));
                }
            }
            return Result(MixedBarrierSegmentStatus.Clear, "CLEAR_OF_PROVIDED_MIXED_GEOMETRY");
        }
        catch (MixedRefusal error) { return new(MixedBarrierSegmentStatus.Indeterminate, error.Code, budget.Work); }
        catch (GeometryUncertaintyException) { return new(MixedBarrierSegmentStatus.Indeterminate, "ARITHMETIC_UNCERTAINTY", budget.Work); }
        MixedBarrierSegmentResult Result(MixedBarrierSegmentStatus status, string reason, MixedBarrierWitness? witness = null) { budget.Check(); return new(status, reason, budget.Work, witness); }
    }
    private static Triangle Primitive(MixedOriginalTriangle t) => new(new(t.A), new(t.B), new(t.C), 0, t.LocalTriangleIndex, t.OriginalVertexA, t.OriginalVertexB, t.OriginalVertexC);
    private static bool Valid(BarrierPoint p, double maximum) => double.IsFinite(p.X) && double.IsFinite(p.Y) && double.IsFinite(p.Z) && Magnitude(p) <= maximum;
    private static double Magnitude(BarrierPoint p) => Math.Max(Math.Abs(p.X), Math.Max(Math.Abs(p.Y), Math.Abs(p.Z)));
    private static bool Digest(string value) => value is not null && value.Length == 64 && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static bool Uuid(string value) => value is not null && value.Length == 36 && Guid.TryParseExact(value, "D", out _) && value == value.ToLowerInvariant();
    private static int ParseOwner(string value) { if (value is null || !value.StartsWith("dbid:", StringComparison.Ordinal) || !int.TryParse(value.AsSpan(5), out int id) || id < 0) Refuse("INVALID_PROVENANCE", "A version-local owner dbId is required."); return int.Parse(value.AsSpan(5), System.Globalization.CultureInfo.InvariantCulture); }
    private static long Estimate(int vertices, int triangles, int fragments, BarrierLimits limits, bool largeSelection = false,
        long parentMemberships = 0, int parents = 0, int components = 0)
    {
        // Historical 128-parent profiles retain their exact estimate. The new
        // explicit capacity also budgets copied membership sets and components;
        // many overlapping parents cannot bypass the unchanged 128 MiB ceiling.
        long estimate = checked(4096L + vertices * 256L + triangles * 512L + fragments * 2048L
            + (largeSelection ? parentMemberships * 128L + parents * 96L + components * 1024L : 0));
        if (estimate > limits.MaximumEstimatedBytes) Refuse("ESTIMATED_MEMORY_LIMIT", largeSelection
            ? "Conservative temporary/copy/topology/membership memory exceeds the bound." : "Conservative temporary/copy/topology memory exceeds the bound."); return estimate;
    }
    private static void ValidateLimits(MixedBarrierBuildLimits limits)
    {
        var g = limits.Geometry; if (g is null || limits.MaximumFragments is < 1 or > 8192 || limits.MaximumParents is < 1 or > 2048
            || g.MaximumMeshes is < 1 or > 2048 || g.MaximumVertices is < 4 or > 500_000 || g.MaximumTriangles is < 4 or > 250_000
            || g.MaximumBuildWork is < 1 or > 40_000_000 || g.MaximumBuildMilliseconds is < 1 or > 60_000 || g.MaximumQueryWork is < 1 or > 2_000_000
            || g.MaximumQueryMilliseconds is < 1 or > 10_000 || g.MaximumEstimatedBytes is < 1 or > 134_217_728 || g.MaximumBvhNodes is < 1 or > 500_000
            || g.BvhLeafSize is < 1 or > 64 || !double.IsFinite(g.NumericToleranceMeters) || g.NumericToleranceMeters is < 1e-9 or > .001
            || !double.IsFinite(g.MaximumCoordinateMagnitude) || g.MaximumCoordinateMagnitude is <= 0 or > 1e9) Refuse("INVALID_LIMITS", "Supported finite bounded geometry limits are required.");
    }
    private static string SourceHash(List<Component> components, List<MixedFragmentInput> fragments, MixedBudget budget)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        void Number(long value) { Span<byte> bytes = stackalloc byte[8]; BinaryPrimitives.WriteInt64LittleEndian(bytes, value); hash.AppendData(bytes); }
        void Text(string value) { byte[] bytes = Encoding.UTF8.GetBytes(value); Number(bytes.Length); hash.AppendData(bytes); }
        void Point(BarrierPoint value) { Number(BitConverter.DoubleToInt64Bits(value.X)); Number(BitConverter.DoubleToInt64Bits(value.Y)); Number(BitConverter.DoubleToInt64Bits(value.Z)); }
        Text("wfc.pf.mixed-original-geometry.v2"); Number(fragments.Count);
        foreach (var fragment in fragments)
        {
            budget.Spend(); var source = fragment.Source; Number(source.FragmentId); Text(source.OwnerObjectId); Text(source.SourceSha256); Text(source.TransformSha256); Text(source.SourceUnits); Number(BitConverter.DoubleToInt64Bits(source.MetresPerSourceUnit));
            Number(source.ParentSelectionIds.Count); foreach (string parent in source.ParentSelectionIds) { budget.Spend(); Text(parent); }
            foreach (long bits in source.SourceToWorldBits) { budget.Spend(); Number(bits); }
            Number(fragment.Vertices.Count); foreach (var point in fragment.Vertices) { budget.Spend(); Point(point); }
            Number(fragment.TriangleIndices.Count); foreach (int index in fragment.TriangleIndices) { budget.Spend(); Number(index); }
        }
        Number(components.Count);
        foreach (var component in components) { budget.Spend(); Text(component.Id); Text(component.Kind.ToString()); Number(component.Triangles.Length); foreach (var t in component.Triangles) { budget.Spend(); Number(t.Source.FragmentId); Number(t.LocalTriangleIndex); Number(t.OriginalVertexA); Number(t.OriginalVertexB); Number(t.OriginalVertexC); Point(t.A); Point(t.B); Point(t.C); } }
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn] private static void Refuse(string code, string reason) => throw new MixedRefusal(code, reason);
    private sealed class MixedRefusal(string code, string reason) : Exception(reason) { internal string Code { get; } = code; }
    private sealed class MixedBudget(long maximum, int milliseconds, CancellationToken token)
    {
        private readonly long started = Stopwatch.GetTimestamp(); internal long Work { get; private set; }
        internal long RemainingWork { get { Check(); if (Work >= maximum) Refuse("WORK_LIMIT", "Build work was exhausted."); return maximum - Work; } }
        internal int RemainingMilliseconds { get { Check(); return Math.Max(1, milliseconds - (int)Stopwatch.GetElapsedTime(started).TotalMilliseconds); } }
        internal void Spend(long amount = 1) { Check(); if (amount < 0 || amount > maximum - Work) Refuse("WORK_LIMIT", "Deterministic geometry work was exhausted."); Work += amount; }
        internal void Check() { token.ThrowIfCancellationRequested(); if (Stopwatch.GetElapsedTime(started).TotalMilliseconds >= milliseconds) Refuse("DEADLINE_EXCEEDED", "The original cooperative geometry deadline was exceeded."); }
    }
    private sealed record Component(string Id, MixedBarrierComponentKind Kind, MixedOriginalTriangle[] Triangles, Bounds Bounds);
    private readonly record struct Original(MixedOriginalTriangle Value, int A, int B, int C);
    private readonly record struct Edge(int First, int Second, int Direction);
    private readonly record struct Bounds(BarrierPoint Minimum, BarrierPoint Maximum)
    {
        internal static Bounds Of(IReadOnlyList<BarrierPoint> points) => new(new(points.Min(p => p.X), points.Min(p => p.Y), points.Min(p => p.Z)), new(points.Max(p => p.X), points.Max(p => p.Y), points.Max(p => p.Z)));
        internal static Bounds Of(MixedOriginalTriangle t) => new(new(Math.Min(t.A.X, Math.Min(t.B.X, t.C.X)), Math.Min(t.A.Y, Math.Min(t.B.Y, t.C.Y)), Math.Min(t.A.Z, Math.Min(t.B.Z, t.C.Z))), new(Math.Max(t.A.X, Math.Max(t.B.X, t.C.X)), Math.Max(t.A.Y, Math.Max(t.B.Y, t.C.Y)), Math.Max(t.A.Z, Math.Max(t.B.Z, t.C.Z))));
        internal bool Contains(Bounds b) => Minimum.X <= b.Minimum.X && Maximum.X >= b.Maximum.X && Minimum.Y <= b.Minimum.Y && Maximum.Y >= b.Maximum.Y && Minimum.Z <= b.Minimum.Z && Maximum.Z >= b.Maximum.Z;
        internal bool Contains(BarrierPoint p, double guard) => p.X + guard >= Minimum.X && p.X <= Maximum.X + guard && p.Y + guard >= Minimum.Y && p.Y <= Maximum.Y + guard && p.Z + guard >= Minimum.Z && p.Z <= Maximum.Z + guard;
        internal bool Overlaps(BarrierPoint a, BarrierPoint b, double guard) => Math.Min(a.X, b.X) <= Maximum.X + guard && Math.Max(a.X, b.X) + guard >= Minimum.X && Math.Min(a.Y, b.Y) <= Maximum.Y + guard && Math.Max(a.Y, b.Y) + guard >= Minimum.Y && Math.Min(a.Z, b.Z) <= Maximum.Z + guard && Math.Max(a.Z, b.Z) + guard >= Minimum.Z;
    }
}
