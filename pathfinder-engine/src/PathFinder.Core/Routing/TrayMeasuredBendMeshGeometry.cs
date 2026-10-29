using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Vec = AddinRibbon.Routing.TrayMeshGeometry.Vec;
using MeshPort = AddinRibbon.Routing.TrayMeshGeometry.MeshPort;
using MeshBend = AddinRibbon.Routing.TrayMeshGeometry.MeshBend;
using SurfaceTriangle = AddinRibbon.Routing.TrayMeshGeometry.SurfaceTriangle;

namespace AddinRibbon.Routing
{
    // The opt-in proof retains original material. It does not fill the free
    // channel, perforated webs, or an unmeasured end section.
    internal static class TrayMeasuredBendMeshGeometry
    {
        internal const int MaximumWork = 2000000;
        private const int MaximumFaces = 512, MaximumVertices = 512, MaximumEdges = 512;
        private const int MaximumCandidates = 128, MaximumPieces = 512;
        private const double PlaneBand = .00025, SectionTolerance = .0005;
        private const double NormalTolerance = .0002, Weld = .00001, CoverageTolerance = .000001;

        internal sealed class Limit : Exception { internal Limit(string reason) : base(reason) { } }
        internal sealed class Domain
        {
            internal readonly TrayGeometryInput Input;
            internal readonly TrayMeshGeometry.Analysis Analysis;
            private readonly CancellationToken token;
            private int work, candidates;
            internal Domain(TrayGeometryInput input, TrayMeshGeometry.Analysis analysis, CancellationToken cancellation)
            {
                Input = input; Analysis = analysis; token = cancellation;
                if (analysis.Triangles.Count > 200000) throw new Limit("triangle domain exceeded");
            }
            internal void Charge(int count = 1)
            {
                token.ThrowIfCancellationRequested();
                if (count < 0 || work > MaximumWork - count) throw new Limit("measured triangle proof work exceeded");
                work += count;
            }
            internal void Candidate() { Charge(); if (++candidates > MaximumCandidates) throw new Limit("measured chain domain exceeded"); }
            internal Vec Local(Vec point) { return point - Analysis.Origin; }
            internal RoutePoint World(Vec point) { return (point + Analysis.Origin).Point; }
        }

        private sealed class Face
        {
            internal Vec Normal, Sum;
            internal double Plane, Area;
            internal readonly List<SurfaceTriangle> Triangles = new List<SurfaceTriangle>();
            internal Vec Center { get { return Sum / Area; } }
        }
        private sealed class Profile
        {
            internal readonly List<P2> Points = new List<P2>();
            internal readonly List<Line> Edges = new List<Line>();
            internal readonly List<Line> Flanges = new List<Line>();
            internal double Width, Height;
        }
        private sealed class EdgeCount
        {
            internal string A, B;
            internal int Count = 1;
        }
        private readonly struct P2
        {
            internal readonly double X, Y;
            internal P2(double x, double y) { X = x; Y = y; }
            internal double Length { get { return Math.Sqrt(X * X + Y * Y); } }
            public static P2 operator +(P2 a, P2 b) { return new P2(a.X + b.X, a.Y + b.Y); }
            public static P2 operator -(P2 a, P2 b) { return new P2(a.X - b.X, a.Y - b.Y); }
            public static P2 operator *(P2 a, double value) { return new P2(a.X * value, a.Y * value); }
        }
        private readonly struct Line
        {
            internal readonly P2 A, B;
            internal Line(P2 a, P2 b) { A = a; B = b; }
        }
        private static double Dot(P2 a, P2 b) { return a.X * b.X + a.Y * b.Y; }
        private static string Key(P2 p)
        {
            return Math.Round(p.X / Weld).ToString(System.Globalization.CultureInfo.InvariantCulture) + "," +
                Math.Round(p.Y / Weld).ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        private static string EdgeKey(string a, string b) { return StringComparer.Ordinal.Compare(a, b) <= 0 ? a + "|" + b : b + "|" + a; }

        private static Profile Cap(Domain domain, MeshPort port, Vec width, Vec height)
        {
            var origin = domain.Local(port.Center); double plane = Vec.Dot(origin, port.Outward);
            var vertices = new Dictionary<string, P2>(StringComparer.Ordinal);
            var raw = new List<Tuple<string, string>>(); int count = 0;
            foreach (var t in domain.Analysis.Triangles)
            {
                domain.Charge();
                if (Math.Abs(Vec.Dot(t.Normal, port.Outward)) < 1 - .00002 ||
                    new[] { t.A, t.B, t.C }.Any(p => Math.Abs(Vec.Dot(p, port.Outward) - plane) > PlaneBand)) continue;
                count++;
                var points = new[] { t.A, t.B, t.C }.Select(p => new P2(Vec.Dot(p - origin, width), Vec.Dot(p - origin, height))).ToArray();
                foreach (var p in points) vertices[Key(p)] = p;
                if (vertices.Count > MaximumVertices) throw new Limit("cap vertex domain exceeded");
                for (int i = 0; i < 3; i++) { string a = Key(points[i]), b = Key(points[(i + 1) % 3]); if (a != b) raw.Add(Tuple.Create(a, b)); }
            }
            if (count < 4) return null;
            var edges = new Dictionary<string, EdgeCount>(StringComparer.Ordinal);
            // Split only at existing collinear vertices. Tessellation T-junctions
            // must not become fictitious holes or overlapping material claims.
            foreach (var line in raw)
            {
                var a = vertices[line.Item1]; var b = vertices[line.Item2]; var d = b - a; double square = Dot(d, d);
                var split = new List<Tuple<double, string>>();
                foreach (var p in vertices)
                {
                    domain.Charge(); double t = Dot(p.Value - a, d) / square;
                    if (t >= -1e-8 && t <= 1 + 1e-8 && (p.Value - (a + d * t)).Length <= Weld) split.Add(Tuple.Create(t, p.Key));
                }
                split.Sort((x, y) => x.Item1.CompareTo(y.Item1));
                for (int i = 1; i < split.Count; i++)
                {
                    string x = split[i - 1].Item2, y = split[i].Item2; if (x == y) continue;
                    string k = EdgeKey(x, y); EdgeCount edge;
                    if (edges.TryGetValue(k, out edge)) edge.Count++;
                    else edges.Add(k, new EdgeCount { A = x, B = y });
                }
            }
            if (edges.Values.Any(e => e.Count > 2)) return null;
            var boundary = edges.Values.Where(e => e.Count == 1).ToArray();
            if (boundary.Length < 6 || boundary.Length > MaximumEdges) return null;
            var adjacent = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (var edge in boundary)
            {
                foreach (var pair in new[] { Tuple.Create(edge.A, edge.B), Tuple.Create(edge.B, edge.A) })
                { List<string> entries; if (!adjacent.TryGetValue(pair.Item1, out entries)) adjacent.Add(pair.Item1, entries = new List<string>()); entries.Add(pair.Item2); }
            }
            if (adjacent.Values.Any(v => v.Count != 2)) return null;
            double lowH = vertices.Values.Min(p => p.Y), highH = vertices.Values.Max(p => p.Y);
            var profile = new Profile { Width = vertices.Values.Max(p => p.X) - vertices.Values.Min(p => p.X), Height = highH - lowH };
            profile.Points.AddRange(vertices.Values); profile.Edges.AddRange(boundary.Select(e => new Line(vertices[e.A], vertices[e.B])));
            var visited = new HashSet<string>(StringComparer.Ordinal); var components = new List<Tuple<double, double>>();
            foreach (var seed in boundary)
            {
                if (visited.Contains(seed.A)) continue;
                var component = new HashSet<string>(StringComparer.Ordinal); var queue = new Queue<string>(); queue.Enqueue(seed.A);
                while (queue.Count != 0)
                { domain.Charge(); string k = queue.Dequeue(); if (!component.Add(k)) continue; visited.Add(k); foreach (var next in adjacent[k]) if (!component.Contains(next)) queue.Enqueue(next); }
                var points = component.Select(k => vertices[k]).ToArray();
                if (Math.Abs(points.Min(p => p.Y) - lowH) > Weld || Math.Abs(points.Max(p => p.Y) - highH) > Weld) return null;
                var flanges = boundary.Where(e => component.Contains(e.A)).Select(e => new Line(vertices[e.A], vertices[e.B])).Where(e =>
                    Math.Abs(e.A.Y - e.B.Y) <= Weld && Math.Abs(e.A.X - e.B.X) > Weld &&
                    (Math.Abs(e.A.Y - lowH) <= Weld || Math.Abs(e.A.Y - highH) <= Weld)).ToArray();
                if (!flanges.Any(e => Math.Abs(e.A.Y - lowH) <= Weld) || !flanges.Any(e => Math.Abs(e.A.Y - highH) <= Weld)) return null;
                profile.Flanges.AddRange(flanges); components.Add(Tuple.Create(points.Min(p => p.X), points.Max(p => p.X)));
            }
            // This proof class has two separated longitudinal rails; it does not
            // infer an axis for other cross-sections from their bounding box.
            if (components.Count != 2) return null;
            components.Sort((a, b) => a.Item1.CompareTo(b.Item1));
            return components[1].Item1 - components[0].Item2 > SectionTolerance ? profile : null;
        }

        private static bool EdgeCovered(Line line, List<Line> other, Domain domain)
        {
            var d = line.B - line.A; double square = Dot(d, d), span = d.Length;
            var intervals = new List<Tuple<double, double>>();
            foreach (var e in other)
            {
                domain.Charge(); double a = Dot(e.A - line.A, d) / square, b = Dot(e.B - line.A, d) / square;
                if ((e.A - (line.A + d * a)).Length > SectionTolerance || (e.B - (line.A + d * b)).Length > SectionTolerance) continue;
                intervals.Add(Tuple.Create(Math.Max(0, Math.Min(a, b)), Math.Min(1, Math.Max(a, b))));
            }
            intervals.Sort((a, b) => a.Item1.CompareTo(b.Item1)); double end = 0;
            foreach (var interval in intervals) { if (interval.Item2 < 0 || interval.Item1 > 1) continue; if (interval.Item1 - end > SectionTolerance / span) return false; end = Math.Max(end, interval.Item2); }
            return 1 - end <= SectionTolerance / span;
        }
        private static bool SameProfile(Profile first, Profile last, Domain domain)
        {
            if (first == null || last == null) return false;
            foreach (var pair in new[] { Tuple.Create(first, last), Tuple.Create(last, first) })
            {
                foreach (var p in pair.Item1.Points)
                { domain.Charge(pair.Item2.Points.Count); if (pair.Item2.Points.All(q => (p - q).Length > SectionTolerance)) return false; }
                foreach (var edge in pair.Item1.Edges) if (!EdgeCovered(edge, pair.Item2.Edges, domain)) return false;
            }
            return true;
        }
        private static List<Face> Faces(Domain domain, Vec width)
        {
            var result = new List<Face>();
            foreach (var t in domain.Analysis.Triangles)
            {
                domain.Charge(); if (Math.Abs(Vec.Dot(t.Normal, width)) > .0001) continue;
                double plane = Vec.Dot(t.Normal, t.Center); Face face = null;
                foreach (var f in result) { domain.Charge(); if ((t.Normal - f.Normal).Length <= NormalTolerance && Math.Abs(plane - f.Plane) <= .00001) { face = f; break; } }
                if (face == null) { if (result.Count == MaximumFaces) throw new Limit("measured plane domain exceeded"); result.Add(face = new Face { Normal = t.Normal, Plane = plane }); }
                face.Triangles.Add(t); face.Area += t.Area; face.Sum += t.Center * t.Area;
            }
            return result;
        }

        internal static List<MeshPort> TerminalCaps(Domain domain, MeshPort anchor, Vec normal)
        {
            var radial = Vec.Cross(normal, anchor.Outward).Unit;
            var near = domain.Analysis.Vertices.Where(p => Math.Abs(Vec.Dot(p - domain.Local(anchor.Center), anchor.Outward)) <= PlaneBand).ToArray();
            if (near.Length == 0) return new List<MeshPort>();
            double normalSize = near.Max(p => Vec.Dot(p, normal)) - near.Min(p => Vec.Dot(p, normal));
            double radialSize = near.Max(p => Vec.Dot(p, radial)) - near.Min(p => Vec.Dot(p, radial));
            bool widthAlongNormal = normalSize > radialSize;
            var width = widthAlongNormal ? normal : radial; var height = widthAlongNormal ? radial : normal;
            var profile = Cap(domain, anchor, width, height); var accepted = new List<MeshPort>();
            if (profile == null) return accepted;
            foreach (var face in Faces(domain, normal))
            {
                if (face.Triangles.Count < 4) continue;
                foreach (int sign in new[] { -1, 1 })
                {
                    domain.Charge(); var outward = face.Normal * sign; radial = Vec.Cross(normal, outward).Unit;
                    width = widthAlongNormal ? normal : radial; height = widthAlongNormal ? radial : normal;
                    var points = face.Triangles.SelectMany(t => new[] { t.A, t.B, t.C }).ToArray();
                    double plane = Vec.Dot(face.Center, outward), lowW = points.Min(p => Vec.Dot(p, width)), highW = points.Max(p => Vec.Dot(p, width)),
                        lowH = points.Min(p => Vec.Dot(p, height)), highH = points.Max(p => Vec.Dot(p, height));
                    var center = outward * plane + width * ((lowW + highW) * .5) + height * ((lowH + highH) * .5);
                    if ((domain.World(center).DistanceTo(anchor.Center.Point)) <= SectionTolerance && Vec.Dot(outward, anchor.Outward) > 1 - .00002) continue;
                    bool support = true;
                    foreach (var p in domain.Analysis.Vertices) { domain.Charge(); if (Vec.Dot(p - center, outward) > PlaneBand) { support = false; break; } }
                    if (!support) continue;
                    var port = new MeshPort(center + domain.Analysis.Origin, outward, width, height, highW - lowW, highH - lowH, face.Area);
                    if (!SameProfile(profile, Cap(domain, port, width, height), domain)) continue;
                    if (accepted.Any(p => (p.Center - port.Center).Length <= SectionTolerance && Vec.Dot(p.Outward, port.Outward) > 1 - .00002)) continue;
                    if (accepted.Count == 16) throw new Limit("terminal cap domain exceeded");
                    accepted.Add(new MeshPort(port.Center, outward, radial, normal,
                        widthAlongNormal ? port.Height : port.Width, widthAlongNormal ? port.Width : port.Height, face.Area));
                }
            }
            return accepted;
        }

        private static double Area(List<P2> p) { double value = 0; for (int i = 0; i < p.Count; i++) { var q = p[(i + 1) % p.Count]; value += p[i].X * q.Y - p[i].Y * q.X; } return Math.Abs(value) * .5; }
        private static double Cross(P2 a, P2 b) { return a.X * b.Y - a.Y * b.X; }
        private static List<P2> Clip(List<P2> p, P2 a, P2 b, bool inside, double epsilon)
        {
            var result = new List<P2>();
            for (int i = 0; i < p.Count; i++)
            {
                var x = p[i]; var y = p[(i + 1) % p.Count]; double vx = Cross(b - a, x - a), vy = Cross(b - a, y - a);
                bool ix = inside ? vx >= -epsilon : vx <= -epsilon, iy = inside ? vy >= -epsilon : vy <= -epsilon;
                if (ix) result.Add(x); if (ix != iy) result.Add(x + (y - x) * ((vx + epsilon) / (vx - vy)));
            }
            return result;
        }
        private static List<List<P2>> Subtract(List<P2> polygon, P2[] triangle)
        {
            var q = (P2[])triangle.Clone(); if (Cross(q[1] - q[0], q[2] - q[0]) < 0) Array.Reverse(q);
            var remaining = polygon; var result = new List<List<P2>>();
            for (int i = 0; i < 3; i++)
            {
                var a = q[i]; var b = q[(i + 1) % 3]; double epsilon = CoverageTolerance * (b - a).Length;
                var outside = Clip(remaining, a, b, false, epsilon); if (outside.Count >= 3 && Area(outside) > 1e-14) result.Add(outside);
                remaining = Clip(remaining, a, b, true, epsilon); if (remaining.Count < 3) break;
            }
            return result;
        }
        private static bool Covered(Domain domain, Vec[] quad)
        {
            var normal = Vec.Cross(quad[1] - quad[0], quad[3] - quad[0]); if (normal.Length < 1e-12) return true;
            normal = normal.Unit; var u = (quad[3] - quad[0]).Unit; var v = Vec.Cross(normal, u).Unit; var origin = quad[0];
            Func<Vec, P2> project = p => new P2(Vec.Dot(p - origin, u), Vec.Dot(p - origin, v));
            var pieces = new List<List<P2>> { quad.Select(project).ToList() };
            foreach (var t in domain.Analysis.Triangles)
            {
                domain.Charge(); if (Math.Abs(Vec.Dot(t.Normal, normal)) < 1 - .00002 || new[] { t.A, t.B, t.C }.Any(p => Math.Abs(Vec.Dot(p - origin, normal)) > SectionTolerance)) continue;
                var source = new[] { project(t.A), project(t.B), project(t.C) }; var next = new List<List<P2>>();
                foreach (var p in pieces) { domain.Charge(); next.AddRange(Subtract(p, source)); if (next.Count > MaximumPieces) throw new Limit("triangle coverage partition exceeded"); }
                pieces = next; if (pieces.Count == 0) return true;
            }
            return pieces.Sum(Area) <= 1e-12;
        }
        private static Vec Transport(Vec point, Vec width, Vec height, P2 profile) { return point + width * profile.X + height * profile.Y; }

        private static bool ClearOfOwnMesh(Domain domain, Vec[] points)
        {
            for (int leg = 1; leg < points.Length; leg++)
            {
                var a = points[leg - 1]; var d = points[leg] - a;
                foreach (var t in domain.Analysis.Triangles)
                {
                    domain.Charge(); var e1 = t.B - t.A; var e2 = t.C - t.A; var h = Vec.Cross(d, e2); double determinant = Vec.Dot(e1, h);
                    if (Math.Abs(determinant) < 1e-12)
                    {
                        double da = Vec.Dot(a - t.A, t.Normal), db = Vec.Dot(points[leg] - t.A, t.Normal);
                        bool coplanar = Math.Abs(da) <= CoverageTolerance && Math.Abs(db) <= CoverageTolerance;
                        if (!coplanar && ((da > CoverageTolerance && db > CoverageTolerance) || (da < -CoverageTolerance && db < -CoverageTolerance))) continue;
                        var u = e1.Unit; var v = Vec.Cross(t.Normal, u).Unit;
                        Func<Vec, P2> project = p => new P2(Vec.Dot(p - t.A, u), Vec.Dot(p - t.A, v));
                        var triangle = new[] { project(t.A), project(t.B), project(t.C) }; if (Cross(triangle[1] - triangle[0], triangle[2] - triangle[0]) < 0) Array.Reverse(triangle);
                        if (!coplanar)
                        {
                            // Raw determinants scale with triangle area. A tiny
                            // valid triangle can straddle a nearly parallel leg;
                            // use its unit plane rather than declaring it absent.
                            double at = da == db ? 0 : Math.Max(0, Math.Min(1, da / (da - db)));
                            var hit = project(a + d * at); bool inside = true;
                            for (int i = 0; i < 3; i++)
                            { var x = triangle[i]; var y = triangle[(i + 1) % 3]; if (Cross(y - x, hit - x) < -CoverageTolerance * (y - x).Length) { inside = false; break; } }
                            if (inside) return false;
                            continue;
                        }
                        var start = project(a); var end = project(points[leg]); double low = 0, high = 1;
                        for (int i = 0; i < 3; i++)
                        {
                            var x = triangle[i]; var y = triangle[(i + 1) % 3]; double epsilon = CoverageTolerance * (y - x).Length;
                            double first = Cross(y - x, start - x) + epsilon, last = Cross(y - x, end - x) + epsilon;
                            if (first < 0 && last < 0) { low = 1; high = 0; break; }
                            if (first < 0) low = Math.Max(low, first / (first - last)); if (last < 0) high = Math.Min(high, first / (first - last));
                        }
                        if (low <= high) return false;
                        continue;
                    }
                    var s = a - t.A; double x0 = Vec.Dot(s, h) / determinant; var q = Vec.Cross(s, e1); double x1 = Vec.Dot(d, q) / determinant, along = Vec.Dot(e2, q) / determinant;
                    if (x0 >= -1e-10 && x1 >= -1e-10 && x0 + x1 <= 1 + 1e-10 && along >= -1e-10 && along <= 1 + 1e-10) return false;
                }
            }
            return true;
        }

        internal static bool Clear(Domain domain, MeshBend bend)
        { return ClearOfOwnMesh(domain, bend.Points.Select(p => domain.Local(new Vec(p))).ToArray()); }

        internal static List<MeshBend> Miters(Domain domain, MeshPort first, MeshPort last)
        {
            var results = new List<MeshBend>(); var d0 = -first.Outward; var d1 = last.Outward; var crossed = Vec.Cross(d0, d1);
            if (crossed.Length < .01) return results;
            var width = crossed.Unit; var n0 = Vec.Cross(width, d0).Unit; var n1 = Vec.Cross(width, d1).Unit;
            var profile = Cap(domain, first, width, n0); var end = Cap(domain, last, width, n1);
            if (!SameProfile(profile, end, domain) || profile.Height <= .005 || profile.Width <= profile.Height) return results;
            var faces = Faces(domain, width); var firstPoint = domain.Local(first.Center); var lastPoint = domain.Local(last.Center);
            for (int i = 0; i < faces.Count; i++) for (int j = i + 1; j < faces.Count; j++)
            {
                domain.Charge(); var a = faces[i]; var b = faces[j]; if (Math.Abs(Vec.Dot(a.Normal, b.Normal)) < 1 - .00002) continue;
                var n = a.Normal; double pa = Vec.Dot(n, a.Center), pb = Vec.Dot(n, b.Center); if (Math.Abs(Math.Abs(pa - pb) - profile.Height) > SectionTolerance) continue;
                double middle = (pa + pb) * .5, x0 = Vec.Dot(n, d0), x1 = Vec.Dot(n, d1); if (Math.Abs(x0) < .01 || Math.Abs(x1) < .01) continue;
                double t0 = (middle - Vec.Dot(n, firstPoint)) / x0, t1 = (middle - Vec.Dot(n, lastPoint)) / x1; if (t0 <= SectionTolerance || t1 >= -SectionTolerance) continue;
                var q0 = firstPoint + d0 * t0; var q1 = lastPoint + d1 * t1; var delta = q1 - q0;
                if (delta.Length <= SectionTolerance || Math.Abs(Vec.Dot(delta, width)) > SectionTolerance) continue;
                var direction = delta.Unit; var nm = Vec.Cross(width, direction).Unit; if (Math.Abs(Vec.Dot(nm, n)) < 1 - .00002) continue;
                double sign = Math.Sign(Vec.Dot(Vec.Cross(d0, d1), width)); if (sign * Vec.Dot(Vec.Cross(d0, direction), width) < .001 || sign * Vec.Dot(Vec.Cross(direction, d1), width) < .001) continue;
                domain.Candidate(); var points = new[] { firstPoint, q0, q1, lastPoint };
                if (points.Any(p => !InBounds(domain, p))) continue;
                var frames = new[] { n0, (n0 + nm) / (1 + Vec.Dot(n0, nm)), (nm + n1) / (1 + Vec.Dot(nm, n1)), n1 };
                bool supported = true;
                for (int run = 0; run < 3 && supported; run++) foreach (var edge in profile.Flanges)
                {
                    var quad = new[] { Transport(points[run], width, frames[run], edge.A), Transport(points[run], width, frames[run], edge.B),
                        Transport(points[run + 1], width, frames[run + 1], edge.B), Transport(points[run + 1], width, frames[run + 1], edge.A) };
                    if (!Covered(domain, quad)) { supported = false; break; }
                }
                if (!supported || !ClearOfOwnMesh(domain, points)) continue;
                results.Add(new MeshBend(points.Select(domain.World).ToArray(), first, last));
            }
            return results;
        }
        private static bool InBounds(Domain domain, Vec p)
        {
            p += domain.Analysis.Origin; var a = domain.Input.Minimum; var b = domain.Input.Maximum;
            return p.X >= a.X - SectionTolerance && p.X <= b.X + SectionTolerance && p.Y >= a.Y - SectionTolerance && p.Y <= b.Y + SectionTolerance && p.Z >= a.Z - SectionTolerance && p.Z <= b.Z + SectionTolerance;
        }
    }
}
