using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using AddinRibbon.Routing;
using Autodesk.Navisworks.Api;
using Autodesk.Navisworks.Api.ComApi;
using COM = Autodesk.Navisworks.Api.Interop.ComApi;

namespace AddinRibbon.Services
{
    // Native callbacks stay on the host thread. Only bounded indexed meshes and
    // face statistics, already in world-space metres, reach geometry fitting.
    internal static class TrayMeshReader
    {
        private const long MaximumPrimitives = 50000;
        private const int MaximumFragments = 64;
        private const double FaceBandMeters = 0.001;

        public static double[] ActiveTransform(ModelItem item)
        {
            using (var geometry = item.Geometry)
            using (var transform = geometry.ActiveTransform)
            using (var linear = transform.Linear)
            using (var translation = transform.Translation)
            {
                var values = new double[12];
                for (int row = 0; row < 3; row++)
                    for (int column = 0; column < 3; column++) values[row * 3 + column] = linear.Get(row, column);
                values[9] = translation.X; values[10] = translation.Y; values[11] = translation.Z;
                return values;
            }
        }

        public static IReadOnlyList<TrayFaceExtent> ReadFaces(ModelItem item, RoutePoint min, RoutePoint max,
            double metresPerUnit, CancellationToken token)
        { return ReadGeometry(item, min, max, metresPerUnit, token).Faces; }

        public static CapturedTrayMesh ReadGeometry(ModelItem item, RoutePoint min, RoutePoint max,
            double metresPerUnit, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (!RoutePoint.IsFinite(metresPerUnit) || metresPerUnit <= 0)
                throw new InvalidOperationException("Invalid native mesh coordinate scale.");
            using (var geometry = item.Geometry)
                if (geometry.PrimitiveCount > MaximumPrimitives) return CapturedTrayMesh.Empty;
            var faces = new FaceAccumulator(min, max, token);
            var meshes = new List<TrayMeshFragment>();
            var path = ComApiBridge.ToInwOaPath(item);
            int fragments = 0, triangles = 0;
            foreach (COM.InwOaFragment3 fragment in path.Fragments())
            {
                token.ThrowIfCancellationRequested();
                if (++fragments > MaximumFragments) return CapturedTrayMesh.Empty;
                var matrix = ReadArray(fragment.GetLocalToWorldMatrix().Matrix, 16);
                var reader = new PrimitiveReader(faces, matrix, metresPerUnit, MaximumPrimitives - triangles);
                fragment.GenerateSimplePrimitives(COM.nwEVertexProperty.eNONE, reader);
                triangles += reader.TriangleCount;
                if (reader.TriangleCount > 0) meshes.Add(reader.CreateMesh());
            }
            token.ThrowIfCancellationRequested();
            if (faces.OutsideBounds) return CapturedTrayMesh.Empty;
            return new CapturedTrayMesh(faces.Result(), meshes.Count == 0 ? null : new TrayMeshData(meshes));
        }

        internal sealed class CapturedTrayMesh
        {
            public static readonly CapturedTrayMesh Empty = new CapturedTrayMesh(new TrayFaceExtent[0], null);
            public readonly IReadOnlyList<TrayFaceExtent> Faces;
            public readonly TrayMeshData Mesh;
            public CapturedTrayMesh(IReadOnlyList<TrayFaceExtent> faces, TrayMeshData mesh)
            { Faces = faces; Mesh = mesh; }
        }

        private static double[] ReadArray(object value, int expected)
        {
            var array = value as Array;
            if (array == null || array.Rank != 1 || array.Length != expected)
                throw new InvalidOperationException("Unexpected native mesh coordinate array.");
            int start = array.GetLowerBound(0);
            var values = new double[expected];
            for (int index = 0; index < expected; index++)
            {
                values[index] = Convert.ToDouble(array.GetValue(start + index));
                if (!RoutePoint.IsFinite(values[index])) throw new InvalidOperationException("Native mesh coordinate array contains a non-finite value.");
            }
            return values;
        }

        [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
        private sealed class PrimitiveReader : COM.InwSimplePrimitivesCB
        {
            private readonly FaceAccumulator faces;
            private readonly double[] matrix;
            private readonly double scale;
            private readonly long triangleLimit;
            private readonly List<RoutePoint> vertices = new List<RoutePoint>();
            private readonly List<int> triangleIndices = new List<int>();
            private readonly Dictionary<RoutePoint, int> vertexIndices = new Dictionary<RoutePoint, int>(new PointComparer());
            public int TriangleCount { get { return triangleIndices.Count / 3; } }
            public PrimitiveReader(FaceAccumulator faces, double[] matrix, double scale, long triangleLimit)
            { this.faces = faces; this.matrix = matrix; this.scale = scale; this.triangleLimit = triangleLimit; }
            private RoutePoint World(COM.InwSimpleVertex vertex)
            {
                var coordinates = vertex.coord as Array;
                if (coordinates == null || coordinates.Rank != 1 || coordinates.Length != 3)
                    throw new InvalidOperationException("Unexpected native mesh vertex coordinate array.");
                int start = coordinates.GetLowerBound(0);
                double x = Convert.ToDouble(coordinates.GetValue(start));
                double y = Convert.ToDouble(coordinates.GetValue(start + 1));
                double z = Convert.ToDouble(coordinates.GetValue(start + 2));
                double w = x * matrix[3] + y * matrix[7] + z * matrix[11] + matrix[15];
                if (!RoutePoint.IsFinite(x) || !RoutePoint.IsFinite(y) || !RoutePoint.IsFinite(z) || !RoutePoint.IsFinite(w) || w == 0)
                    throw new InvalidOperationException("Invalid native fragment transform or vertex coordinates.");
                double worldX = (x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12]) / w * scale;
                double worldY = (x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13]) / w * scale;
                double worldZ = (x * matrix[2] + y * matrix[6] + z * matrix[10] + matrix[14]) / w * scale;
                if (!RoutePoint.IsFinite(worldX) || !RoutePoint.IsFinite(worldY) || !RoutePoint.IsFinite(worldZ))
                    throw new InvalidOperationException("Native mesh world coordinates exceed the supported range.");
                var point = new RoutePoint(worldX, worldY, worldZ);
                faces.Add(point);
                return point;
            }
            private int Index(COM.InwSimpleVertex vertex)
            {
                var point = World(vertex);
                int index;
                if (vertexIndices.TryGetValue(point, out index)) return index;
                index = vertices.Count;
                vertices.Add(point); vertexIndices.Add(point, index);
                return index;
            }
            public void Triangle(COM.InwSimpleVertex first, COM.InwSimpleVertex second, COM.InwSimpleVertex third)
            {
                if (TriangleCount >= triangleLimit) throw new NotSupportedException("Native tray mesh exceeds the primitive capture limit.");
                triangleIndices.Add(Index(first)); triangleIndices.Add(Index(second)); triangleIndices.Add(Index(third));
            }
            public void Line(COM.InwSimpleVertex first, COM.InwSimpleVertex second) { World(first); World(second); }
            public void Point(COM.InwSimpleVertex vertex) { World(vertex); }
            public void SnapPoint(COM.InwSimpleVertex vertex) { World(vertex); }
            public TrayMeshFragment CreateMesh() { return new TrayMeshFragment(vertices, triangleIndices); }
        }

        private sealed class PointComparer : IEqualityComparer<RoutePoint>
        {
            public bool Equals(RoutePoint first, RoutePoint second)
            { return first.X == second.X && first.Y == second.Y && first.Z == second.Z; }
            public int GetHashCode(RoutePoint point)
            {
                unchecked { return ((point.X.GetHashCode() * 397) ^ point.Y.GetHashCode()) * 397 ^ point.Z.GetHashCode(); }
            }
        }

        private sealed class FaceAccumulator
        {
            private readonly RoutePoint min, max;
            private readonly CancellationToken token;
            private readonly double[][] low = new double[6][], high = new double[6][];
            private readonly int[] count = new int[6];
            private int vertices;
            private bool outsideBounds;
            public bool OutsideBounds { get { return outsideBounds; } }
            public FaceAccumulator(RoutePoint min, RoutePoint max, CancellationToken token)
            {
                this.min = min; this.max = max; this.token = token;
                for (int face = 0; face < 6; face++)
                {
                    low[face] = new[] { double.PositiveInfinity, double.PositiveInfinity, double.PositiveInfinity };
                    high[face] = new[] { double.NegativeInfinity, double.NegativeInfinity, double.NegativeInfinity };
                }
            }
            public void Add(RoutePoint point)
            {
                if ((++vertices & 255) == 0) token.ThrowIfCancellationRequested();
                if (point.X < min.X - FaceBandMeters || point.X > max.X + FaceBandMeters
                    || point.Y < min.Y - FaceBandMeters || point.Y > max.Y + FaceBandMeters
                    || point.Z < min.Z - FaceBandMeters || point.Z > max.Z + FaceBandMeters) { outsideBounds = true; return; }
                Accumulate(0, Math.Abs(point.X - min.X), point); Accumulate(1, Math.Abs(point.X - max.X), point);
                Accumulate(2, Math.Abs(point.Y - min.Y), point); Accumulate(3, Math.Abs(point.Y - max.Y), point);
                Accumulate(4, Math.Abs(point.Z - min.Z), point); Accumulate(5, Math.Abs(point.Z - max.Z), point);
            }
            private void Accumulate(int face, double distance, RoutePoint point)
            {
                if (distance > FaceBandMeters) return;
                count[face]++;
                low[face][0] = Math.Min(low[face][0], point.X); high[face][0] = Math.Max(high[face][0], point.X);
                low[face][1] = Math.Min(low[face][1], point.Y); high[face][1] = Math.Max(high[face][1], point.Y);
                low[face][2] = Math.Min(low[face][2], point.Z); high[face][2] = Math.Max(high[face][2], point.Z);
            }
            public IReadOnlyList<TrayFaceExtent> Result()
            {
                if (outsideBounds) return new TrayFaceExtent[0]; // Reject incompatible unit/transform conventions.
                var result = new List<TrayFaceExtent>();
                for (int face = 0; face < 6; face++)
                    if (count[face] > 0) result.Add(new TrayFaceExtent((TrayBoxFace)face,
                        new RoutePoint(low[face][0], low[face][1], low[face][2]),
                        new RoutePoint(high[face][0], high[face][1], high[face][2]), count[face]));
                return result;
            }
        }
    }
}
