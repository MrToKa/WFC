using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

namespace AddinRibbon.Routing
{
    /// <summary>An indexed triangle mesh fragment whose detached vertices are in world-space metres.</summary>
    public sealed class TrayMeshFragment
    {
        public IReadOnlyList<RoutePoint> Vertices { get; private set; }
        /// <summary>Three vertex indices per triangle; degenerate triangles may be ignored by geometry fitting.</summary>
        public IReadOnlyList<int> TriangleIndices { get; private set; }

        public TrayMeshFragment(IEnumerable<RoutePoint> vertices, IEnumerable<int> triangleIndices)
        {
            if (vertices == null) throw new ArgumentNullException("vertices");
            if (triangleIndices == null) throw new ArgumentNullException("triangleIndices");
            var points = vertices.ToArray();
            var indices = triangleIndices.ToArray();
            if (indices.Length % 3 != 0) throw new ArgumentException("Mesh triangles need three indices each.", "triangleIndices");
            foreach (int index in indices)
                if (index < 0 || index >= points.Length)
                    throw new ArgumentException("Mesh triangle index is outside the vertex array.", "triangleIndices");
            Vertices = new ReadOnlyCollection<RoutePoint>(points);
            TriangleIndices = new ReadOnlyCollection<int>(indices);
        }
    }

    /// <summary>Detached mesh evidence, retaining native fragment boundaries for geometry validation.</summary>
    public sealed class TrayMeshData
    {
        public IReadOnlyList<TrayMeshFragment> Fragments { get; private set; }
        public int VertexCount { get; private set; }
        public int TriangleCount { get; private set; }
        /// <summary>Conservative retained-data estimate for bounded native caches; excludes caller-owned source arrays.</summary>
        public long EstimatedBytes { get; private set; }

        public TrayMeshData(IEnumerable<TrayMeshFragment> fragments)
        {
            if (fragments == null) throw new ArgumentNullException("fragments");
            var copy = fragments.ToArray();
            if (copy.Any(fragment => fragment == null)) throw new ArgumentException("Mesh fragments cannot contain null.", "fragments");
            foreach (var fragment in copy)
            {
                VertexCount = checked(VertexCount + fragment.Vertices.Count);
                TriangleCount = checked(TriangleCount + fragment.TriangleIndices.Count / 3);
                EstimatedBytes += 256L + 24L * fragment.Vertices.Count + 4L * fragment.TriangleIndices.Count;
            }
            Fragments = new ReadOnlyCollection<TrayMeshFragment>(copy);
        }
    }
}
