using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

namespace AddinRibbon.Routing
{
    // Mesh evidence is deliberately fitted without route names, longest-axis or
    // principal-component assumptions: a short spool may be wider than its length.
    internal static class TrayMeshGeometry
    {
        internal const double PlaneBand = 0.00025;
        internal const double SectionTolerance = 0.0005;
        private const int MaximumSectionVertices = 512;

        internal static bool TryStraight(TrayGeometryInput input, CancellationToken token,
            out MeshStraight straight, out string reason)
        {
            straight = null;
            var fits = StraightCandidates(input, token, out reason);
            var proven = fits.Where(f => f.IsLongSeed).ToArray();
            if (proven.Length == 1) { straight = proven[0]; return true; }
            reason = fits.Count == 0 ? reason : "mesh sections admit more than one straight axis; neighboring port evidence is required";
            return false;
        }

        internal static List<MeshStraight> StraightCandidates(TrayGeometryInput input, CancellationToken token,
            out string reason)
        {
            reason = "mesh evidence is unavailable";
            var fits = new List<MeshStraight>();
            if (input.Mesh == null || input.Mesh.TriangleCount == 0) return fits;
            var analysis = new Analysis(input, token);
            foreach (var axisGroup in analysis.Axes.OrderByDescending(a => a.Area).Take(64))
            {
                token.ThrowIfCancellationRequested();
                var direction = axisGroup.Direction;
                double low = double.PositiveInfinity, high = double.NegativeInfinity;
                foreach (var point in analysis.Vertices)
                {
                    double value = Vec.Dot(point, direction);
                    low = Math.Min(low, value); high = Math.Max(high, value);
                }
                if (high - low < 0.00001) continue;
                var first = Distinct(analysis.Vertices.Where(p => Vec.Dot(p, direction) - low <= PlaneBand), token);
                var last = Distinct(analysis.Vertices.Where(p => high - Vec.Dot(p, direction) <= PlaneBand), token);
                if (first.Count < 6 || last.Count < 6 || first.Count > MaximumSectionVertices || last.Count > MaximumSectionVertices) continue;
                int firstFaces = 0, lastFaces = 0;
                double firstArea = 0, lastArea = 0;
                foreach (var face in analysis.Triangles)
                {
                    if (Math.Abs(Vec.Dot(face.Normal, direction)) < 1 - 0.0000001) continue;
                    double value = Vec.Dot(face.Center, direction);
                    if (Math.Abs(value - low) <= PlaneBand) { firstFaces++; firstArea += face.Area; }
                    if (Math.Abs(value - high) <= PlaneBand) { lastFaces++; lastArea += face.Area; }
                }
                if (firstFaces < 4 || lastFaces < 4 ||
                    !MatchingSections(first, last, direction * (high - low), token)) continue;
                var sectionAxis = analysis.Axes.OrderByDescending(a => a.Area)
                    .FirstOrDefault(a => Math.Abs(Vec.Dot(a.Direction, direction)) < 0.001);
                var u = sectionAxis == null ? Vec.Perpendicular(direction) :
                    (sectionAxis.Direction - direction * Vec.Dot(sectionAxis.Direction, direction)).Unit;
                var v = Vec.Cross(direction, u).Unit;
                var lowPort = Port(analysis.Origin, direction, low, u, v, first, -direction, firstArea);
                var highPort = Port(analysis.Origin, direction, high, u, v, last, direction, lastArea);
                // Multiple tessellation normals can describe the same extrusion.
                if (fits.Any(f => Math.Abs(Vec.Dot(f.Direction, direction)) > 1 - 0.000001)) continue;
                fits.Add(new MeshStraight(input, lowPort, highPort, direction));
            }
            if (!AddMeasuredInteriorCaps(input, analysis, fits, token))
            {
                fits.Clear();
                reason = "too many measured cap pairs for a unique straight axis";
                return fits;
            }
            reason = fits.Count == 0 ? "no repeated mesh end sections prove a straight extrusion" : null;
            return fits;
        }

        // A named tube assembly may contain bolts behind its real end plane.
        // Interior measured cap pairs are candidates only; neighbouring physical
        // port evidence must validate them before they become route geometry.
        private static bool AddMeasuredInteriorCaps(TrayGeometryInput input, Analysis analysis,
            List<MeshStraight> fits, CancellationToken token)
        {
            foreach (var axis in analysis.Axes.OrderByDescending(a => a.Area).Take(64))
            {
                token.ThrowIfCancellationRequested();
                var direction = axis.Direction;
                var planes = new List<CapPlane>(); int work = 0;
                foreach (var face in analysis.Triangles)
                {
                    if ((++work & 255) == 0) token.ThrowIfCancellationRequested();
                    if (Math.Abs(Vec.Dot(face.Normal, direction)) < 1 - 0.0000001) continue;
                    double d = Vec.Dot(face.Center, direction);
                    var plane = planes.FirstOrDefault(p => Math.Abs(p.Position - d) <= PlaneBand);
                    if (plane == null)
                    {
                        if (planes.Count == 64) { planes.Clear(); break; }
                        plane = new CapPlane(d); planes.Add(plane);
                    }
                    plane.Add(face, d);
                }
                var sectionAxis = analysis.Axes.OrderByDescending(a => a.Area)
                    .FirstOrDefault(a => Math.Abs(Vec.Dot(a.Direction, direction)) < 0.001);
                var u = sectionAxis == null ? Vec.Perpendicular(direction) :
                    (sectionAxis.Direction - direction * Vec.Dot(sectionAxis.Direction, direction)).Unit;
                var v = Vec.Cross(direction, u).Unit;
                foreach (var plane in planes)
                    plane.Section = plane.FaceCount < 4 ? null : Distinct(analysis.Vertices.Where(point =>
                        Math.Abs(Vec.Dot(point, direction) - plane.Position) <= PlaneBand), token);
                planes = planes.Where(p => p.Section != null && p.Section.Count >= 6 && p.Section.Count <= MaximumSectionVertices)
                    .OrderBy(p => p.Position).ToList();
                for (int first = 0; first < planes.Count; first++)
                    for (int last = first + 1; last < planes.Count; last++)
                    {
                        token.ThrowIfCancellationRequested();
                        var a = planes[first]; var b = planes[last];
                        double distance = b.Position - a.Position;
                        if (distance < 0.00001 || !MatchingSections(a.Section, b.Section, direction * distance, token)) continue;
                        var start = Port(analysis.Origin, direction, a.Position, u, v, a.Section, -direction, a.Area);
                        var end = Port(analysis.Origin, direction, b.Position, u, v, b.Section, direction, b.Area);
                        if (fits.Any(f => (f.Start.Center - start.Center).Length < SectionTolerance &&
                            (f.End.Center - end.Center).Length < SectionTolerance)) continue;
                        fits.Add(new MeshStraight(input, start, end, direction, false));
                        if (fits.Count > 32) return false;
                    }
            }
            return true;
        }

        private sealed class CapPlane
        {
            private double weightedPosition;
            internal double Position { get { return Area == 0 ? weightedPosition : weightedPosition / Area; } }
            internal double Area;
            internal int FaceCount;
            internal readonly List<Vec> Points = new List<Vec>();
            internal List<Vec> Section;
            internal CapPlane(double position) { weightedPosition = position; }
            internal void Add(SurfaceTriangle triangle, double position)
            {
                if (Area == 0) weightedPosition = 0;
                weightedPosition += position * triangle.Area; Area += triangle.Area; FaceCount++;
                Points.Add(triangle.A); Points.Add(triangle.B); Points.Add(triangle.C);
            }
        }

        internal static Dictionary<string, MeshStraight> ResolveStraights(
            Dictionary<string, List<MeshStraight>> candidates, Dictionary<string, MeshBend> bends,
            IReadOnlyList<TrayGeometryInput> inputs, CancellationToken token)
        {
            var resolved = new Dictionary<string, MeshStraight>(StringComparer.Ordinal);
            var ports = new PortIndex();
            foreach (var pair in candidates)
            {
                token.ThrowIfCancellationRequested();
                var seeds = pair.Value.Where(f => f.IsLongSeed).ToArray();
                var fit = seeds.Length == 1 ? seeds[0] : null;
                if (fit == null) continue;
                resolved.Add(pair.Key, fit); ports.Add(fit.Input, fit.Start); ports.Add(fit.Input, fit.End);
            }
            foreach (var input in inputs)
            {
                MeshBend bend;
                if (!bends.TryGetValue(input.Id, out bend)) continue;
                ports.Add(input, bend.Start); ports.Add(input, bend.End);
            }
            bool changed;
            do
            {
                changed = false;
                foreach (var pair in candidates)
                {
                    token.ThrowIfCancellationRequested();
                    if (resolved.ContainsKey(pair.Key)) continue;
                    MeshStraight accepted = null;
                    bool ambiguous = false;
                    foreach (var fit in pair.Value)
                    {
                        if (!ports.Matches(fit.Input, fit.Start, token) && !ports.Matches(fit.Input, fit.End, token)) continue;
                        if (accepted != null) { ambiguous = true; break; }
                        accepted = fit;
                    }
                    if (accepted == null || ambiguous) continue;
                    resolved.Add(pair.Key, accepted);
                    ports.Add(accepted.Input, accepted.Start); ports.Add(accepted.Input, accepted.End);
                    changed = true;
                }
            } while (changed);
            return resolved;
        }

        internal static bool SameSection(MeshPort first, MeshPort last)
        {
            double lowFirst = Math.Min(first.Width, first.Height), highFirst = Math.Max(first.Width, first.Height);
            double lowLast = Math.Min(last.Width, last.Height), highLast = Math.Max(last.Width, last.Height);
            return Math.Abs(lowFirst - lowLast) <= Math.Max(0.003, Math.Max(lowFirst, lowLast) * 0.05) &&
                Math.Abs(highFirst - highLast) <= Math.Max(0.003, Math.Max(highFirst, highLast) * 0.05);
        }

        private sealed class PortIndex
        {
            private readonly Dictionary<PortCell, List<PortEntry>> cells = new Dictionary<PortCell, List<PortEntry>>();
            internal void Add(TrayGeometryInput input, MeshPort port)
            {
                var key = new PortCell(port.Center);
                List<PortEntry> entries;
                if (!cells.TryGetValue(key, out entries)) { entries = new List<PortEntry>(); cells.Add(key, entries); }
                entries.Add(new PortEntry(input, port));
            }
            internal bool Matches(TrayGeometryInput input, MeshPort port, CancellationToken token)
            {
                var key = new PortCell(port.Center);
                int checkedEntries = 0;
                for (int x = -1; x <= 1; x++)
                    for (int y = -1; y <= 1; y++)
                        for (int z = -1; z <= 1; z++)
                        {
                            List<PortEntry> entries;
                            if (!cells.TryGetValue(new PortCell(key.X + x, key.Y + y, key.Z + z), out entries)) continue;
                            foreach (var entry in entries)
                            {
                                if ((++checkedEntries & 255) == 0) token.ThrowIfCancellationRequested();
                                if (entry.Input.Id == input.Id || (entry.Input.Categories & input.Categories) == CableCategory.None) continue;
                                if (Vec.Dot(port.Outward, entry.Port.Outward) > -0.999 || !SameSection(port, entry.Port)) continue;
                                if ((port.Center - entry.Port.Center).Length <= TrayGeometryBuilder.PortToleranceMeters) return true;
                            }
                        }
                return false;
            }
        }

        private sealed class PortEntry
        {
            internal readonly TrayGeometryInput Input;
            internal readonly MeshPort Port;
            internal PortEntry(TrayGeometryInput input, MeshPort port) { Input = input; Port = port; }
        }

        private struct PortCell : IEquatable<PortCell>
        {
            internal readonly long X, Y, Z;
            internal PortCell(Vec point) : this((long)Math.Floor(point.X / TrayGeometryBuilder.PortToleranceMeters),
                (long)Math.Floor(point.Y / TrayGeometryBuilder.PortToleranceMeters),
                (long)Math.Floor(point.Z / TrayGeometryBuilder.PortToleranceMeters)) { }
            internal PortCell(long x, long y, long z) { X = x; Y = y; Z = z; }
            public bool Equals(PortCell other) { return X == other.X && Y == other.Y && Z == other.Z; }
            public override bool Equals(object value) { return value is PortCell && Equals((PortCell)value); }
            public override int GetHashCode() { unchecked { return ((X.GetHashCode() * 397) ^ Y.GetHashCode()) * 397 ^ Z.GetHashCode(); } }
        }

        private static MeshPort Port(Vec origin, Vec direction, double plane, Vec u, Vec v,
            List<Vec> section, Vec outward, double area)
        {
            double minU = double.PositiveInfinity, maxU = double.NegativeInfinity;
            double minV = double.PositiveInfinity, maxV = double.NegativeInfinity;
            foreach (var point in section)
            {
                double cu = Vec.Dot(point, u), cv = Vec.Dot(point, v);
                minU = Math.Min(minU, cu); maxU = Math.Max(maxU, cu);
                minV = Math.Min(minV, cv); maxV = Math.Max(maxV, cv);
            }
            var center = origin + direction * plane + u * ((minU + maxU) * 0.5) + v * ((minV + maxV) * 0.5);
            return new MeshPort(center, outward, u, v, maxU - minU, maxV - minV, area);
        }

        private static List<Vec> Distinct(IEnumerable<Vec> source, CancellationToken token)
        {
            var result = new List<Vec>();
            var seen = new HashSet<GridKey>();
            int count = 0;
            foreach (var point in source)
            {
                if ((++count & 255) == 0) token.ThrowIfCancellationRequested();
                if (seen.Add(new GridKey(point, 0.00001))) result.Add(point);
                if (result.Count > MaximumSectionVertices) break;
            }
            return result;
        }

        private static bool MatchingSections(List<Vec> first, List<Vec> last, Vec translation, CancellationToken token)
        {
            return Matches(first, last, translation, token) && Matches(last, first, -translation, token);
        }

        private static bool Matches(List<Vec> first, List<Vec> last, Vec translation, CancellationToken token)
        {
            for (int index = 0; index < first.Count; index++)
            {
                if ((index & 31) == 0) token.ThrowIfCancellationRequested();
                Vec target = first[index] + translation;
                bool found = false;
                foreach (var point in last)
                    if ((target - point).LengthSquared <= SectionTolerance * SectionTolerance) { found = true; break; }
                if (!found) return false;
            }
            return true;
        }

        internal sealed class MeshStraight
        {
            internal readonly TrayGeometryInput Input;
            internal readonly MeshPort Start, End;
            internal readonly Vec Direction;
            private readonly bool maySeed;
            internal bool IsLongSeed { get { return maySeed && (End.Center - Start.Center).Length >= 3 * Math.Max(Start.Width, Start.Height); } }
            internal MeshStraight(TrayGeometryInput input, MeshPort start, MeshPort end, Vec direction, bool maySeed = true)
            { Input = input; Start = start; End = end; Direction = direction; this.maySeed = maySeed; }
        }

        internal sealed class MeshBend
        {
            internal readonly RoutePoint[] Points;
            internal readonly MeshPort Start, End;
            internal MeshBend(RoutePoint[] points, MeshPort start, MeshPort end)
            { Points = points; Start = start; End = end; }
        }

        internal sealed class MeshPort
        {
            internal readonly Vec Center, Outward, U, V;
            internal readonly double Width, Height;
            internal readonly double Area;
            internal MeshPort(Vec center, Vec outward, Vec u, Vec v, double width, double height, double area)
            { Center = center; Outward = outward; U = u; V = v; Width = width; Height = height; Area = area; }
        }

        internal sealed class Analysis
        {
            internal readonly Vec Origin;
            internal readonly List<Vec> Vertices = new List<Vec>();
            internal readonly List<SurfaceTriangle> Triangles = new List<SurfaceTriangle>();
            internal readonly List<AxisGroup> Axes;
            internal Analysis(TrayGeometryInput input, CancellationToken token)
            {
                Origin = new Vec(input.Minimum) + (new Vec(input.Maximum) - new Vec(input.Minimum)) * 0.5;
                var groups = new Dictionary<GridKey, AxisGroup>();
                int processed = 0;
                foreach (var fragment in input.Mesh.Fragments)
                {
                    var vertices = fragment.Vertices.Select(p => new Vec(p) - Origin).ToArray();
                    var used = new bool[vertices.Length];
                    for (int offset = 0; offset < fragment.TriangleIndices.Count; offset += 3)
                    {
                        if ((++processed & 255) == 0) token.ThrowIfCancellationRequested();
                        int first = fragment.TriangleIndices[offset], second = fragment.TriangleIndices[offset + 1], third = fragment.TriangleIndices[offset + 2];
                        var a = vertices[first]; var b = vertices[second]; var c = vertices[third];
                        var cross = Vec.Cross(b - a, c - a);
                        double size = cross.Length;
                        if (size < 0.0000000001 || !RoutePoint.IsFinite(size)) continue;
                        used[first] = used[second] = used[third] = true;
                        var normal = Canonical(cross / size);
                        var key = new GridKey(normal, 0.001);
                        AxisGroup group;
                        if (!groups.TryGetValue(key, out group)) { group = new AxisGroup(); groups.Add(key, group); }
                        group.Sum += normal * size; group.Area += size * 0.5;
                        Triangles.Add(new SurfaceTriangle(normal, (a + b + c) / 3, size * 0.5, vertices, first, second, third));
                    }
                    for (int index = 0; index < vertices.Length; index++) if (used[index]) Vertices.Add(vertices[index]);
                }
                Axes = groups.Values.ToList();
            }
        }

        internal sealed class AxisGroup
        {
            internal Vec Sum;
            internal double Area;
            internal Vec Direction { get { return Sum.Unit; } }
        }

        internal struct SurfaceTriangle
        {
            internal readonly Vec Normal, Center;
            internal readonly double Area;
            private readonly Vec[] vertices;
            private readonly int first, second, third;
            internal Vec A { get { return vertices[first]; } }
            internal Vec B { get { return vertices[second]; } }
            internal Vec C { get { return vertices[third]; } }
            internal SurfaceTriangle(Vec normal, Vec center, double area, Vec[] vertices, int first, int second, int third)
            { Normal = normal; Center = center; Area = area; this.vertices = vertices; this.first = first; this.second = second; this.third = third; }
        }

        internal static Vec Canonical(Vec value)
        {
            double first = Math.Abs(value.X) > 0.00001 ? value.X : Math.Abs(value.Y) > 0.00001 ? value.Y : value.Z;
            return first < 0 ? -value : value;
        }

        private struct GridKey : IEquatable<GridKey>
        {
            private readonly long x, y, z;
            internal GridKey(Vec point, double size)
            { x = (long)Math.Round(point.X / size); y = (long)Math.Round(point.Y / size); z = (long)Math.Round(point.Z / size); }
            public bool Equals(GridKey other) { return x == other.x && y == other.y && z == other.z; }
            public override bool Equals(object value) { return value is GridKey && Equals((GridKey)value); }
            public override int GetHashCode() { unchecked { return ((x.GetHashCode() * 397) ^ y.GetHashCode()) * 397 ^ z.GetHashCode(); } }
        }

        internal struct Vec
        {
            internal readonly double X, Y, Z;
            internal Vec(double x, double y, double z) { X = x; Y = y; Z = z; }
            internal Vec(RoutePoint point) : this(point.X, point.Y, point.Z) { }
            internal double LengthSquared { get { return X * X + Y * Y + Z * Z; } }
            internal double Length { get { return Math.Sqrt(LengthSquared); } }
            internal Vec Unit { get { return this / Length; } }
            internal RoutePoint Point { get { return new RoutePoint(X, Y, Z); } }
            internal static double Dot(Vec a, Vec b) { return a.X * b.X + a.Y * b.Y + a.Z * b.Z; }
            internal static Vec Cross(Vec a, Vec b) { return new Vec(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X); }
            internal static Vec Perpendicular(Vec direction)
            {
                var axis = Math.Abs(direction.Z) < 0.8 ? new Vec(0, 0, 1) : new Vec(0, 1, 0);
                return Cross(direction, axis).Unit;
            }
            public static Vec operator +(Vec a, Vec b) { return new Vec(a.X + b.X, a.Y + b.Y, a.Z + b.Z); }
            public static Vec operator -(Vec a, Vec b) { return new Vec(a.X - b.X, a.Y - b.Y, a.Z - b.Z); }
            public static Vec operator -(Vec a) { return new Vec(-a.X, -a.Y, -a.Z); }
            public static Vec operator *(Vec a, double value) { return new Vec(a.X * value, a.Y * value, a.Z * value); }
            public static Vec operator /(Vec a, double value) { return new Vec(a.X / value, a.Y / value, a.Z / value); }
        }
    }
}
