using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Barriers;

internal static class Fixtures
{
    internal sealed record Mesh(BarrierPoint[] Vertices, int[] Indices);
    internal static string Id(int value) => "00000000-0000-4000-8000-" + value.ToString("x12");
    internal static BarrierPoint P(double x, double y = 0, double z = 0) => new(x, y, z);
    internal static Mesh Box(double x0 = 0, double x1 = .2, double y0 = -2, double y1 = 2, double z0 = -2, double z1 = 2)
    {
        BarrierPoint[] vertices = [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0),
            P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)];
        var indices = new List<int>();
        Quad(indices, 0, 3, 2, 1); Quad(indices, 4, 5, 6, 7); Quad(indices, 0, 1, 5, 4);
        Quad(indices, 3, 7, 6, 2); Quad(indices, 0, 4, 7, 3); Quad(indices, 1, 2, 6, 5);
        return new(vertices, indices.ToArray());
    }
    internal static Mesh Frame()
    {
        (double Y, double Z)[] outer = [(-2, -2), (2, -2), (2, 2), (-2, 2)];
        (double Y, double Z)[] inner = [(-.6, -.8), (.6, -.8), (.6, .8), (-.6, .8)];
        var vertices = new List<BarrierPoint>();
        foreach (double x in new[] { 0d, .2 }) { vertices.AddRange(outer.Select(p => P(x, p.Y, p.Z))); vertices.AddRange(inner.Select(p => P(x, p.Y, p.Z))); }
        var indices = new List<int>();
        for (var i = 0; i < 4; i++) { int j = (i + 1) % 4; Quad(indices, i, 4 + i, 4 + j, j); Quad(indices, 8 + i, 8 + j, 12 + j, 12 + i); Quad(indices, i, j, 8 + j, 8 + i); Quad(indices, 4 + i, 12 + i, 12 + j, 4 + j); }
        return new(vertices.ToArray(), indices.ToArray());
    }
    internal static Mesh Merge(params Mesh[] meshes)
    {
        var vertices = new List<BarrierPoint>(); var indices = new List<int>();
        foreach (var mesh in meshes) { int offset = vertices.Count; vertices.AddRange(mesh.Vertices); indices.AddRange(mesh.Indices.Select(i => i + offset)); }
        return new(vertices.ToArray(), indices.ToArray());
    }
    internal static JsonObject Capture(Mesh? mesh = null, bool splitTriangles = false, bool sharedParents = false)
    {
        mesh ??= Box(); string[] parents = sharedParents ? [Id(201), Id(202)] : [Id(201)];
        var pieces = splitTriangles ? Enumerable.Range(0, mesh.Indices.Length / 3).Select(i =>
            new Mesh(mesh.Indices.Skip(i * 3).Take(3).Select(index => mesh.Vertices[index]).ToArray(), [0, 1, 2])).ToArray() : [mesh];
        var fragments = pieces.Select((part, at) => new
        {
            source = new { fragmentId = at + 1, ownerObjectId = "dbid:10", parentSelectionIds = parents, sourceUnits = "m", metresPerSourceUnit = 1,
                sourceToWorldMetres = new[] { 1d, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 }, transformSha256 = new string('2', 64) },
            bounds = new { minimum = new[] { part.Vertices.Min(p => p.X), part.Vertices.Min(p => p.Y), part.Vertices.Min(p => p.Z) },
                maximum = new[] { part.Vertices.Max(p => p.X), part.Vertices.Max(p => p.Y), part.Vertices.Max(p => p.Z) } },
            verticesMetres = part.Vertices.Select(p => new[] { p.X, p.Y, p.Z }).ToArray(), triangleIndices = part.Indices,
        }).ToArray();
        return (JsonObject)JsonSerializer.SerializeToNode(new
        {
            schemaVersion = "wfc.pf.barrier-capture.v1", captureId = Id(101),
            scope = new { projectId = Id(102), modelVersionId = Id(103), contentFingerprint = new string('1', 64), selectionRevision = "1",
                captureFrameId = Id(104), captureFrameSha256 = new string('3', 64), coordinateFrame = "canonical-world-metres" },
            selectedParents = parents.Select((id, at) => new { selectionId = id, kind = "wall", objectId = "dbid:" + (at + 10), dbId = at + 10,
                externalId = (string?)null, name = "selected wall", identityBasis = "version-local-only", inclusion = "own-and-all-descendant-fragments" }).ToArray(),
            fragments, observation = new { state = "reported-complete", verification = "unverified", enumeratedFragmentIds = Enumerable.Range(1, pieces.Length).ToArray(),
                unavailableFragmentIds = Array.Empty<int>(), enumerationSha256 = new string('4', 64) },
        })!;
    }
    internal static byte[] Bytes(JsonNode node) => JsonSerializer.SerializeToUtf8Bytes(node);
    private static void Quad(List<int> indices, int a, int b, int c, int d) => indices.AddRange([a, b, c, a, c, d]);
}
