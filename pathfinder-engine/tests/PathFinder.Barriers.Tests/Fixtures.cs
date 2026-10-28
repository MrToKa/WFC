using PathFinder.Barriers;

internal static class Fixtures
{
    internal static BarrierPoint P(double x, double y = 0, double z = 0) => new(x, y, z);

    internal static BarrierMeshInput Box(string id = "wall", double x0 = 0, double x1 = .2,
        double y0 = -2, double y1 = 2, double z0 = -2, double z1 = 2)
    {
        BarrierPoint[] vertices = [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0),
            P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)];
        var indices = new List<int>();
        Quad(indices, 0, 3, 2, 1); Quad(indices, 4, 5, 6, 7);
        Quad(indices, 0, 1, 5, 4); Quad(indices, 3, 7, 6, 2);
        Quad(indices, 0, 4, 7, 3); Quad(indices, 1, 2, 6, 5);
        return new(id, vertices, indices);
    }

    // One connected, watertight solid with an actual through-opening: 16 vertices,
    // 16 quads / 32 triangles. Front/back strips and inner tunnel faces are retained.
    internal static BarrierMeshInput ConnectedFrame(string id = "connected-frame")
    {
        (double Y, double Z)[] outer = [(-2, -2), (2, -2), (2, 2), (-2, 2)];
        (double Y, double Z)[] inner = [(-.6, -.8), (.6, -.8), (.6, .8), (-.6, .8)];
        var vertices = new List<BarrierPoint>();
        foreach (var x in new[] { 0d, .2 })
        {
            vertices.AddRange(outer.Select(p => P(x, p.Y, p.Z)));
            vertices.AddRange(inner.Select(p => P(x, p.Y, p.Z)));
        }
        var indices = new List<int>();
        for (var i = 0; i < 4; i++)
        {
            var j = (i + 1) % 4;
            Quad(indices, i, 4 + i, 4 + j, j);             // Front, outward -X.
            Quad(indices, 8 + i, 8 + j, 12 + j, 12 + i);  // Back, outward +X.
            Quad(indices, i, j, 8 + j, 8 + i);            // Outer walls.
            Quad(indices, 4 + i, 12 + i, 12 + j, 4 + j);  // Inner tunnel walls.
        }
        return new(id, vertices, indices);
    }

    internal static BarrierMeshInput[] SeparateFrame() =>
    [
        Box("bottom-bar", z1: -.8), Box("top-bar", z0: .8),
        Box("left-bar", y1: -.6, z0: -.8, z1: .8),
        Box("right-bar", y0: .6, z0: -.8, z1: .8)
    ];

    internal static BarrierMeshInput Transform(BarrierMeshInput mesh, Func<BarrierPoint, BarrierPoint> transform) =>
        mesh with { Vertices = mesh.Vertices.Select(transform).ToArray() };

    internal static BarrierPoint RotateTranslate(BarrierPoint p)
    {
        var c = Math.Sqrt(.5);
        return P(10 + c * p.X - c * p.Y, -20 + c * p.X + c * p.Y, 5 + p.Z);
    }

    internal static BarrierMeshInput Reverse(BarrierMeshInput mesh)
    {
        var indices = mesh.TriangleIndices.ToArray();
        for (var i = 0; i < indices.Length; i += 3) (indices[i + 1], indices[i + 2]) = (indices[i + 2], indices[i + 1]);
        return mesh with { TriangleIndices = indices };
    }

    internal static BarrierMeshInput UnsharedVertices(BarrierMeshInput mesh)
    {
        var vertices = mesh.TriangleIndices.Select(i => mesh.Vertices[i]).ToArray();
        return mesh with { Vertices = vertices, TriangleIndices = Enumerable.Range(0, vertices.Length).ToArray() };
    }

    internal static BarrierMeshInput Merge(string id, params BarrierMeshInput[] meshes)
    {
        var vertices = new List<BarrierPoint>(); var indices = new List<int>();
        foreach (var mesh in meshes)
        {
            var offset = vertices.Count;
            indices.AddRange(mesh.TriangleIndices.Select(i => i + offset));
            vertices.AddRange(mesh.Vertices);
        }
        return new(id, vertices, indices);
    }

    private static void Quad(List<int> indices, int a, int b, int c, int d)
    {
        indices.AddRange([a, b, c, a, c, d]);
    }
}
