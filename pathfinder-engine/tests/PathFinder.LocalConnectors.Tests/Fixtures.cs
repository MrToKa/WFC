using AddinRibbon.Routing;
using PathFinder.Barriers;

internal static class Fixtures
{
    internal static RoutePoint P(double x, double y = 0, double z = 0) => new(x, y, z);
    internal static BarrierPoint B(RoutePoint point) => new(point.X, point.Y, point.Z);
    internal static BarrierPoint B(double x, double y = 0, double z = 0) => new(x, y, z);
    internal static TraySegment Tray(string id, params RoutePoint[] points) => new(id, "/" + id, CableCategory.Control, points);
    internal static BarrierMeshInput Box(string id = "wall", double x0 = 0, double x1 = .2,
        double y0 = -2, double y1 = 2, double z0 = -2, double z1 = 2)
    {
        BarrierPoint[] vertices = [B(x0, y0, z0), B(x1, y0, z0), B(x1, y1, z0), B(x0, y1, z0),
            B(x0, y0, z1), B(x1, y0, z1), B(x1, y1, z1), B(x0, y1, z1)];
        var indices = new List<int>();
        Quad(indices, 0, 3, 2, 1); Quad(indices, 4, 5, 6, 7);
        Quad(indices, 0, 1, 5, 4); Quad(indices, 3, 7, 6, 2);
        Quad(indices, 0, 4, 7, 3); Quad(indices, 1, 2, 6, 5);
        return new(id, vertices, indices);
    }
    internal static BarrierMeshInput Opening(string id = "opening", double halfWidth = .6, double halfHeight = .8)
    {
        (double Y, double Z)[] outer = [(-2, -2), (2, -2), (2, 2), (-2, 2)];
        (double Y, double Z)[] inner = [(-halfWidth, -halfHeight), (halfWidth, -halfHeight), (halfWidth, halfHeight), (-halfWidth, halfHeight)];
        var vertices = new List<BarrierPoint>();
        foreach (var x in new[] { 0d, .2 })
        {
            vertices.AddRange(outer.Select(p => B(x, p.Y, p.Z)));
            vertices.AddRange(inner.Select(p => B(x, p.Y, p.Z)));
        }
        var indices = new List<int>();
        for (var i = 0; i < 4; i++)
        {
            var j = (i + 1) % 4;
            Quad(indices, i, 4 + i, 4 + j, j); Quad(indices, 8 + i, 8 + j, 12 + j, 12 + i);
            Quad(indices, i, j, 8 + j, 8 + i); Quad(indices, 4 + i, 12 + i, 12 + j, 4 + j);
        }
        return new(id, vertices, indices);
    }
    internal static BarrierMeshInput Transform(BarrierMeshInput mesh, Func<BarrierPoint, BarrierPoint> transform) =>
        mesh with { Vertices = mesh.Vertices.Select(transform).ToArray() };
    internal static BarrierCollisionKernel Kernel(params BarrierMeshInput[] meshes)
    {
        var built = BarrierCollisionKernel.Build(meshes);
        if (built.Status != BarrierBuildStatus.Ready || built.Kernel is null)
            throw new InvalidOperationException("Synthetic closed-mesh fixture did not independently qualify: "
                + string.Join("; ", built.Diagnostics.Select(value => value.Code + ": " + value.Message)));
        return built.Kernel;
    }
    private static void Quad(List<int> indices, int a, int b, int c, int d) => indices.AddRange([a, b, c, a, c, d]);
}
