using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Vec = AddinRibbon.Routing.TrayMeshGeometry.Vec;
using MeshStraight = AddinRibbon.Routing.TrayMeshGeometry.MeshStraight;
using MeshPort = AddinRibbon.Routing.TrayMeshGeometry.MeshPort;
using MeshBend = AddinRibbon.Routing.TrayMeshGeometry.MeshBend;

namespace AddinRibbon.Routing
{
    // A planar circular tray bend may have straight tangent stubs at both ends.
    // Circle evidence comes from its surfaces; port positions come from its caps.
    // Neighbours validate those ports without supplying or moving their positions.
    internal static class TrayBendMeshGeometry
    {
        private const double FaceNormalTolerance = 0.0002;
        private const double FacePlaneTolerance = 0.00001;
        private const double RayTolerance = 0.0002;
        private const double GeometryTolerance = 0.0005;
        private const double PortBand = 0.00025;
        private const int MaximumFaces = 512;
        private const int MaximumRingPoints = 4096;
        private const double FiveDegrees = Math.PI / 36;

        internal static bool TryFit(TrayGeometryInput input, IEnumerable<MeshStraight> candidateStraights,
            CancellationToken token, out MeshBend bend, out string reason)
        {
            bend = null;
            reason = "mesh evidence is unavailable";
            if (input.Mesh == null || input.Mesh.TriangleCount == 0) return false;
            var analysis = new TrayMeshGeometry.Analysis(input, token);
            var triangles = Triangles(input, analysis.Origin, token);
            var straights = candidateStraights.ToArray();
            var fits = new List<MeshBend>();
            reason = "radial mesh surfaces do not prove a stable circular bend";
            foreach (var normal in Planes(analysis, token))
            {
                var u = Vec.Perpendicular(normal); var v = Vec.Cross(normal, u).Unit;
                var faces = Faces(triangles, normal, token);
                if (faces == null || faces.Count < 6) continue;
                var circles = Circles(faces, u, v, token);
                if (circles.Count == 0) continue;
                var ports = Ports(input, analysis, triangles, normal, straights, token);
                if (ports.Count < 2)
                { reason = "two measured cap sections with compatible neighbouring ports are required"; continue; }
                reason = "measured caps, tangent stubs and circular mesh sweep do not form a unique bend";
                foreach (var circle in circles)
                    for (int first = 0; first < ports.Count; first++)
                        for (int last = first + 1; last < ports.Count; last++)
                        {
                            token.ThrowIfCancellationRequested();
                            if (!ports[first].Neighbours.Any(a => ports[last].Neighbours.Any(b => a != b))) continue;
                            MeshBend fit;
                            if (!Fit(input, analysis.Origin, normal, u, v, circle, ports[first].Port, ports[last].Port, token, out fit)) continue;
                            if (!fits.Any(existing => Same(existing, fit))) fits.Add(fit);
                            if (fits.Count > 1)
                            { reason = "mesh evidence admits more than one circular bend and physical port pair"; return false; }
                        }
            }
            if (fits.Count == 0)
                return false;
            bend = fits[0]; reason = null; return true;
        }

        private static List<Vec> Planes(TrayMeshGeometry.Analysis analysis, CancellationToken token)
        {
            var candidates = new List<Vec>();
            // Width perpendicular to a vertical bend can exceed its in-plane
            // footprint. Only the subsequent radial/port proof establishes its
            // plane; a world-box thinness assumption cannot do so generally.
            foreach (var axis in analysis.Axes.OrderByDescending(a => a.Area).Take(32))
            {
                token.ThrowIfCancellationRequested();
                var n = axis.Direction;
                if (!candidates.Any(p => Math.Abs(Vec.Dot(p, n)) > 1 - 0.000001)) candidates.Add(n);
            }
            return candidates;
        }

        private static double Span(IEnumerable<Vec> points, Vec direction)
        {
            double low = double.PositiveInfinity, high = double.NegativeInfinity;
            foreach (var point in points)
            { double value = Vec.Dot(point, direction); low = Math.Min(low, value); high = Math.Max(high, value); }
            return high - low;
        }

        private static List<Triangle> Triangles(TrayGeometryInput input, Vec origin, CancellationToken token)
        {
            var triangles = new List<Triangle>();
            int count = 0;
            foreach (var fragment in input.Mesh.Fragments)
                for (int offset = 0; offset < fragment.TriangleIndices.Count; offset += 3)
                {
                    if ((++count & 255) == 0) token.ThrowIfCancellationRequested();
                    var a = new Vec(fragment.Vertices[fragment.TriangleIndices[offset]]) - origin;
                    var b = new Vec(fragment.Vertices[fragment.TriangleIndices[offset + 1]]) - origin;
                    var c = new Vec(fragment.Vertices[fragment.TriangleIndices[offset + 2]]) - origin;
                    var cross = Vec.Cross(b - a, c - a); double size = cross.Length;
                    if (size < 0.0000000001 || !RoutePoint.IsFinite(size)) continue;
                    triangles.Add(new Triangle(a, b, c, TrayMeshGeometry.Canonical(cross / size), size * 0.5));
                }
            return triangles;
        }

        private static List<Face> Faces(List<Triangle> triangles, Vec normal, CancellationToken token)
        {
            var faces = new List<Face>(); int count = 0;
            foreach (var triangle in triangles)
            {
                if ((++count & 127) == 0) token.ThrowIfCancellationRequested();
                if (Math.Abs(Vec.Dot(triangle.Normal, normal)) > 0.0001) continue;
                double plane = Vec.Dot(triangle.Normal, triangle.Center);
                Face face = null;
                foreach (var existing in faces)
                    if ((existing.Normal - triangle.Normal).LengthSquared <= FaceNormalTolerance * FaceNormalTolerance
                        && Math.Abs(existing.Plane - plane) <= FacePlaneTolerance) { face = existing; break; }
                if (face == null)
                {
                    if (faces.Count >= MaximumFaces) return null;
                    face = new Face(triangle.Normal, plane); faces.Add(face);
                }
                face.Area += triangle.Area; face.Sum += triangle.Center * triangle.Area;
                face.Vertices.Add(triangle.A); face.Vertices.Add(triangle.B); face.Vertices.Add(triangle.C);
            }
            return faces;
        }

        private static List<Circle> Circles(List<Face> faces, Vec u, Vec v, CancellationToken token)
        {
            var votes = new Dictionary<Grid2, Vote>(); int work = 0;
            double extent = Math.Max(Span(faces.Select(f => f.Center), u), Span(faces.Select(f => f.Center), v));
            double maximumDistance = 100 * Math.Max(extent, 0.01);
            for (int first = 0; first < faces.Count; first++)
                for (int last = first + 1; last < faces.Count; last++)
                {
                    if ((++work & 255) == 0) token.ThrowIfCancellationRequested();
                    var a = Perpendicular(faces[first].Normal, u, v);
                    var b = Perpendicular(faces[last].Normal, u, v);
                    double determinant = a.X * b.Y - a.Y * b.X;
                    if (Math.Abs(determinant) < 0.04) continue;
                    var pa = Project(faces[first].Center, u, v); var pb = Project(faces[last].Center, u, v);
                    double da = Dot(a, pa), db = Dot(b, pb);
                    var center = new Point2((da * b.Y - a.Y * db) / determinant, (a.X * db - da * b.X) / determinant);
                    if (!Finite(center) || center.Length > maximumDistance) continue;
                    var key = new Grid2(center, 0.001); Vote vote;
                    if (!votes.TryGetValue(key, out vote)) { vote = new Vote(); votes.Add(key, vote); }
                    vote.Count++; vote.Sum += center;
                }
            var result = new List<Circle>();
            int largest = votes.Count == 0 ? 0 : votes.Values.Max(p => p.Count);
            foreach (var vote in votes.Values.Where(p => p.Count >= Math.Max(6, largest / 4)).OrderByDescending(p => p.Count).Take(8))
            {
                token.ThrowIfCancellationRequested();
                var seed = vote.Sum / vote.Count;
                var inliers = faces.Where(f => Math.Abs(Dot(Perpendicular(f.Normal, u, v), seed - Project(f.Center, u, v))) <= RayTolerance).ToList();
                if (inliers.Count < 6) continue;
                var directions = new List<Vec>();
                foreach (var face in inliers)
                    if (!directions.Any(n => Math.Abs(Vec.Dot(n, face.Normal)) > 1 - 0.00001)) directions.Add(face.Normal);
                if (directions.Count < 3) continue;
                double[,] matrix = new double[2, 2]; var right = new double[2];
                foreach (var face in inliers)
                {
                    var q = Perpendicular(face.Normal, u, v); double d = Dot(q, Project(face.Center, u, v));
                    matrix[0, 0] += face.Area * q.X * q.X; matrix[0, 1] += face.Area * q.X * q.Y;
                    matrix[1, 0] += face.Area * q.Y * q.X; matrix[1, 1] += face.Area * q.Y * q.Y;
                    right[0] += face.Area * q.X * d; right[1] += face.Area * q.Y * d;
                }
                double[] solved;
                if (!Solve(matrix, right, out solved)) continue;
                seed = new Point2(solved[0], solved[1]);
                if (inliers.Any(f => Math.Abs(Dot(Perpendicular(f.Normal, u, v), seed - Project(f.Center, u, v))) > RayTolerance)) continue;
                var points = new List<Point2>(); var seen = new HashSet<Grid2>();
                foreach (var face in inliers)
                    foreach (var vertex in face.Vertices)
                    {
                        if ((++work & 255) == 0) token.ThrowIfCancellationRequested();
                        var point = Project(vertex, u, v);
                        if (seen.Add(new Grid2(point, 0.00000001))) points.Add(point);
                        if (points.Count > MaximumRingPoints) break;
                    }
                if (points.Count < 8 || points.Count > MaximumRingPoints) continue;
                Circle circle;
                if (!Refine(points, seed, token, out circle)) continue;
                if (!result.Any(c => (c.Center - circle.Center).Length <= GeometryTolerance)) result.Add(circle);
            }
            return result;
        }

        private static bool Refine(List<Point2> points, Point2 seed, CancellationToken token, out Circle circle)
        {
            circle = null;
            var groups = points.GroupBy(p => (long)Math.Round((p - seed).Length / 0.001)).Where(g => g.Count() >= 3).ToList();
            if (groups.Count < 2 || groups.Count > 24) return false;
            int size = 2 + groups.Count;
            var matrix = new double[size, size]; var right = new double[size]; int processed = 0;
            for (int group = 0; group < groups.Count; group++)
                foreach (var original in groups[group])
                {
                    if ((++processed & 127) == 0) token.ThrowIfCancellationRequested();
                    var point = original - seed;
                    var row = new[] { 2 * point.X, 2 * point.Y, 1.0 }; var indices = new[] { 0, 1, group + 2 };
                    double value = point.LengthSquared;
                    for (int i = 0; i < 3; i++)
                    {
                        right[indices[i]] += row[i] * value;
                        for (int j = 0; j < 3; j++) matrix[indices[i], indices[j]] += row[i] * row[j];
                    }
                }
            double[] solution;
            if (!Solve(matrix, right, out solution)) return false;
            var delta = new Point2(solution[0], solution[1]); var center = seed + delta;
            var retained = new List<Point2>(); var radii = new List<double>();
            for (int group = 0; group < groups.Count; group++)
            {
                double squared = solution[group + 2] + delta.LengthSquared;
                if (!RoutePoint.IsFinite(squared) || squared <= 0) return false;
                double radius = Math.Sqrt(squared);
                foreach (var point in groups[group])
                {
                    if (Math.Abs((point - center).Length - radius) > GeometryTolerance * 0.5) return false;
                    retained.Add(point);
                }
                if (!radii.Any(r => Math.Abs(r - radius) < 0.001)) radii.Add(radius);
            }
            if (!Finite(center) || radii.Count < 2 || radii.Max() - radii.Min() < 0.005) return false;
            circle = new Circle(center, retained, radii.Min(), radii.Max()); return true;
        }

        private static List<PortEvidence> Ports(TrayGeometryInput input, TrayMeshGeometry.Analysis analysis,
            List<Triangle> triangles, Vec normal, IEnumerable<MeshStraight> candidates, CancellationToken token)
        {
            var ports = new List<PortEvidence>(); int processed = 0;
            foreach (var straight in candidates)
            {
                if ((++processed & 31) == 0) token.ThrowIfCancellationRequested();
                if (straight.Input.Id == input.Id || (straight.Input.Categories & input.Categories) == CableCategory.None) continue;
                foreach (var neighbor in new[] { straight.Start, straight.End })
                {
                    if (!NearBounds(input, neighbor.Center, TrayGeometryBuilder.PortToleranceMeters)) continue;
                    var outward = -neighbor.Outward;
                    if (Math.Abs(Vec.Dot(outward, normal)) > 0.002) continue;
                    outward = (outward - normal * Vec.Dot(outward, normal)).Unit;
                    foreach (var port in MeasuredCaps(analysis, triangles, normal, outward, neighbor, token))
                    {
                        if ((port.Center - neighbor.Center).Length > TrayGeometryBuilder.PortToleranceMeters
                            || Vec.Dot(port.Outward, neighbor.Outward) > -1 + 0.00002 || !Compatible(port, neighbor)) continue;
                        var evidence = ports.FirstOrDefault(p => (p.Port.Center - port.Center).Length <= GeometryTolerance
                            && Vec.Dot(p.Port.Outward, port.Outward) > 1 - 0.00001);
                        if (evidence == null) { evidence = new PortEvidence(port); ports.Add(evidence); }
                        evidence.Neighbours.Add(straight.Input.Id);
                        if (ports.Count > 16) return new List<PortEvidence>();
                    }
                }
            }
            return ports;
        }

        private static List<MeshPort> MeasuredCaps(TrayMeshGeometry.Analysis analysis, List<Triangle> triangles,
            Vec bendNormal, Vec outward, MeshPort neighbor, CancellationToken token)
        {
            // A fitting or support can extend beyond the tray's physical cap.
            // The neighbour only selects nearby measured triangle planes; every
            // port coordinate and section dimension still comes from this mesh.
            double target = Vec.Dot(neighbor.Center - analysis.Origin, outward);
            var groups = new List<CapPlane>(); int work = 0;
            foreach (var triangle in triangles)
            {
                if ((++work & 255) == 0) token.ThrowIfCancellationRequested();
                if (Math.Abs(Vec.Dot(triangle.Normal, outward)) < 1 - 0.00002) continue;
                double plane = Vec.Dot(triangle.Center, outward);
                if (Math.Abs(plane - target) > TrayGeometryBuilder.PortToleranceMeters + PortBand
                    || Math.Abs(Vec.Dot(triangle.A, outward) - plane) > PortBand
                    || Math.Abs(Vec.Dot(triangle.B, outward) - plane) > PortBand
                    || Math.Abs(Vec.Dot(triangle.C, outward) - plane) > PortBand) continue;
                var group = groups.FirstOrDefault(g => Math.Abs(g.Plane - plane) <= PortBand);
                if (group == null)
                {
                    if (groups.Count >= 64) return new List<MeshPort>();
                    group = new CapPlane(plane); groups.Add(group);
                }
                group.Triangles.Add(triangle);
            }
            var ports = new List<MeshPort>();
            foreach (var group in groups)
            {
                token.ThrowIfCancellationRequested();
                var caps = group.Triangles; Vec normalSum = new Vec(); double area = 0;
                foreach (var triangle in caps)
                {
                    area += triangle.Area;
                    normalSum += triangle.Normal * (Vec.Dot(triangle.Normal, outward) < 0 ? -triangle.Area : triangle.Area);
                }
                if (caps.Count < 4 || area < 0.0000000001 || normalSum.Length < 0.0000000001) continue;
                var measuredOutward = (normalSum - bendNormal * Vec.Dot(normalSum, bendNormal)).Unit;
                var widthAxis = Vec.Cross(bendNormal, measuredOutward).Unit;
                var heightAxis = Vec.Cross(measuredOutward, widthAxis).Unit;
                double plane = caps.Sum(t => t.Area * Vec.Dot(t.Center, measuredOutward)) / area;
                double minU = double.PositiveInfinity, maxU = double.NegativeInfinity;
                double minV = double.PositiveInfinity, maxV = double.NegativeInfinity;
                bool planar = true;
                foreach (var triangle in caps)
                    foreach (var point in new[] { triangle.A, triangle.B, triangle.C })
                    {
                        if (Math.Abs(Vec.Dot(point, measuredOutward) - plane) > PortBand) planar = false;
                        double pu = Vec.Dot(point, widthAxis), pv = Vec.Dot(point, heightAxis);
                        minU = Math.Min(minU, pu); maxU = Math.Max(maxU, pu);
                        minV = Math.Min(minV, pv); maxV = Math.Max(maxV, pv);
                    }
                if (!planar || maxU - minU < 0.01 || maxV - minV < 0.00001) continue;
                var center = analysis.Origin + measuredOutward * plane + widthAxis * ((minU + maxU) * 0.5) + heightAxis * ((minV + maxV) * 0.5);
                ports.Add(new MeshPort(center, measuredOutward, widthAxis, heightAxis, maxU - minU, maxV - minV, area));
            }
            return ports;
        }

        private static bool Compatible(MeshPort first, MeshPort last)
        {
            double width = Math.Abs(Vec.Dot(first.U, last.U)) * last.Width + Math.Abs(Vec.Dot(first.U, last.V)) * last.Height;
            double height = Math.Abs(Vec.Dot(first.V, last.U)) * last.Width + Math.Abs(Vec.Dot(first.V, last.V)) * last.Height;
            return Math.Abs(width - first.Width) <= Math.Max(GeometryTolerance, first.Width * 0.05)
                && Math.Abs(height - first.Height) <= Math.Max(GeometryTolerance, first.Height * 0.05);
        }

        private static bool Fit(TrayGeometryInput input, Vec origin, Vec normal, Vec u, Vec v, Circle circle,
            MeshPort first, MeshPort last, CancellationToken token, out MeshBend bend)
        {
            bend = null;
            if (!CompatibleSections(first, last)) return false;
            var center = origin + u * circle.Center.X + v * circle.Center.Y;
            double h0 = Vec.Dot(first.Center - center, normal), h1 = Vec.Dot(last.Center - center, normal);
            if (Math.Abs(h0 - h1) > GeometryTolerance) return false;
            var p0 = first.Center - center - normal * h0; var p1 = last.Center - center - normal * h1;
            double stub0 = Vec.Dot(p0, first.Outward), stub1 = Vec.Dot(p1, last.Outward);
            if (stub0 < -GeometryTolerance || stub1 < -GeometryTolerance) return false;
            var radial0 = p0 - first.Outward * stub0; var radial1 = p1 - last.Outward * stub1;
            double radius0 = radial0.Length, radius1 = radial1.Length;
            if (!RoutePoint.IsFinite(radius0 + radius1) || radius0 < 0.025 || Math.Abs(radius0 - radius1) > GeometryTolerance) return false;
            double radius = (radius0 + radius1) * 0.5;
            if (radius <= circle.MinimumRadius + GeometryTolerance || radius >= circle.MaximumRadius - GeometryTolerance) return false;
            var begin = radial0 / radius0; var end = radial1 / radius1;
            double sign = Vec.Dot(Vec.Cross(normal, begin), -first.Outward) >= 0 ? 1 : -1;
            if (Vec.Dot(Vec.Cross(normal, begin) * sign, -first.Outward) < 1 - 0.00002
                || Vec.Dot(Vec.Cross(normal, end) * sign, last.Outward) < 1 - 0.00002) return false;
            double sweep = Math.Atan2(Vec.Dot(normal, Vec.Cross(begin, end)), Vec.Dot(begin, end));
            if (sweep * sign < 0) sweep += sign * 2 * Math.PI;
            if (Math.Abs(sweep) < 0.02 || Math.Abs(sweep) > 2 * Math.PI - 0.02) return false;
            if (!Covers(circle, begin, normal, u, v, sweep)) return false;
            int steps = (int)Math.Ceiling(Math.Abs(sweep) / FiveDegrees);
            var points = new List<RoutePoint>();
            Append(points, first.Center);
            for (int step = 0; step <= steps; step++)
            {
                token.ThrowIfCancellationRequested();
                double fraction = step / (double)steps, angle = sweep * fraction;
                var direction = begin * Math.Cos(angle) + Vec.Cross(normal, begin) * Math.Sin(angle);
                var point = center + direction * (radius0 + (radius1 - radius0) * fraction) + normal * (h0 + (h1 - h0) * fraction);
                if (!NearBounds(input, point, GeometryTolerance)) return false;
                Append(points, point);
            }
            Append(points, last.Center);
            bend = new MeshBend(points.ToArray(), first, last); return true;
        }

        private static bool CompatibleSections(MeshPort first, MeshPort last)
        {
            return Math.Abs(first.Width - last.Width) <= Math.Max(GeometryTolerance, first.Width * 0.05)
                && Math.Abs(first.Height - last.Height) <= Math.Max(GeometryTolerance, first.Height * 0.05);
        }

        private static bool Covers(Circle circle, Vec begin, Vec normal, Vec u, Vec v, double sweep)
        {
            double extent = Math.Abs(sweep), sign = Math.Sign(sweep);
            var angles = new List<double>();
            foreach (var point in circle.Points)
            {
                var delta = point - circle.Center; if (delta.Length < 0.00001) continue;
                var direction = (u * delta.X + v * delta.Y).Unit;
                double angle = sign * Math.Atan2(Vec.Dot(normal, Vec.Cross(begin, direction)), Vec.Dot(begin, direction));
                if (angle < -0.005) angle += 2 * Math.PI;
                if (angle > extent + 0.005) return false;
                angles.Add(Math.Max(0, Math.Min(extent, angle)));
            }
            if (angles.Count < 6) return false;
            angles.Sort();
            if (angles[0] > 0.01 || extent - angles[angles.Count - 1] > 0.01) return false;
            for (int index = 1; index < angles.Count; index++) if (angles[index] - angles[index - 1] > Math.PI / 9) return false;
            return true;
        }

        private static bool NearBounds(TrayGeometryInput input, Vec point, double tolerance)
        {
            return point.X >= input.Minimum.X - tolerance && point.X <= input.Maximum.X + tolerance
                && point.Y >= input.Minimum.Y - tolerance && point.Y <= input.Maximum.Y + tolerance
                && point.Z >= input.Minimum.Z - tolerance && point.Z <= input.Maximum.Z + tolerance;
        }

        private static void Append(List<RoutePoint> points, Vec point)
        { if (points.Count == 0 || points[points.Count - 1].DistanceTo(point.Point) > 0.000000001) points.Add(point.Point); }

        private static bool Same(MeshBend first, MeshBend last)
        {
            bool direct = (first.Start.Center - last.Start.Center).Length <= GeometryTolerance
                && (first.End.Center - last.End.Center).Length <= GeometryTolerance;
            bool reverse = (first.Start.Center - last.End.Center).Length <= GeometryTolerance
                && (first.End.Center - last.Start.Center).Length <= GeometryTolerance;
            if (!direct && !reverse) return false;
            // Equal ports alone do not prove equal curves: two different arcs
            // connecting the same ports must remain an ambiguous fit.
            double firstLength = Length(first.Points), lastLength = Length(last.Points);
            if (Math.Abs(firstLength - lastLength) > GeometryTolerance * 2) return false;
            for (int step = 0; step <= 32; step++)
            {
                double fraction = step / 32.0;
                var a = At(first.Points, firstLength * fraction);
                var b = At(last.Points, lastLength * (direct ? fraction : 1 - fraction));
                if ((a - b).Length > GeometryTolerance) return false;
            }
            return true;
        }

        private static double Length(RoutePoint[] points)
        {
            double length = 0;
            for (int index = 1; index < points.Length; index++) length += points[index - 1].DistanceTo(points[index]);
            return length;
        }

        private static Vec At(RoutePoint[] points, double distance)
        {
            for (int index = 1; index < points.Length; index++)
            {
                var first = new Vec(points[index - 1]); var last = new Vec(points[index]);
                double length = (last - first).Length;
                if (distance <= length && length > 0) return first + (last - first) * (distance / length);
                distance -= length;
            }
            return new Vec(points[points.Length - 1]);
        }

        private static bool Solve(double[,] matrix, double[] right, out double[] solution)
        {
            int size = right.Length; solution = null;
            var augmented = new double[size, size + 1]; double scale = 0;
            for (int row = 0; row < size; row++)
            {
                for (int column = 0; column < size; column++) { augmented[row, column] = matrix[row, column]; scale = Math.Max(scale, Math.Abs(matrix[row, column])); }
                augmented[row, size] = right[row];
            }
            if (!RoutePoint.IsFinite(scale) || scale == 0) return false;
            for (int column = 0; column < size; column++)
            {
                int pivot = column;
                for (int row = column + 1; row < size; row++) if (Math.Abs(augmented[row, column]) > Math.Abs(augmented[pivot, column])) pivot = row;
                if (Math.Abs(augmented[pivot, column]) < scale * 0.000000000001) return false;
                for (int offset = column; offset <= size; offset++) { double value = augmented[column, offset]; augmented[column, offset] = augmented[pivot, offset]; augmented[pivot, offset] = value; }
                double divisor = augmented[column, column];
                for (int offset = column; offset <= size; offset++) augmented[column, offset] /= divisor;
                for (int row = 0; row < size; row++)
                {
                    if (row == column) continue;
                    double multiple = augmented[row, column];
                    for (int offset = column; offset <= size; offset++) augmented[row, offset] -= multiple * augmented[column, offset];
                }
            }
            solution = new double[size];
            for (int row = 0; row < size; row++) { solution[row] = augmented[row, size]; if (!RoutePoint.IsFinite(solution[row])) return false; }
            return true;
        }

        private static Point2 Project(Vec value, Vec u, Vec v) { return new Point2(Vec.Dot(value, u), Vec.Dot(value, v)); }
        private static Point2 Perpendicular(Vec value, Vec u, Vec v) { return new Point2(-Vec.Dot(value, v), Vec.Dot(value, u)); }
        private static double Dot(Point2 first, Point2 last) { return first.X * last.X + first.Y * last.Y; }
        private static bool Finite(Point2 point) { return RoutePoint.IsFinite(point.X) && RoutePoint.IsFinite(point.Y); }

        private sealed class Triangle
        {
            internal readonly Vec A, B, C, Normal, Center; internal readonly double Area;
            internal Triangle(Vec a, Vec b, Vec c, Vec normal, double area)
            { A = a; B = b; C = c; Normal = normal; Area = area; Center = (a + b + c) / 3; }
        }
        private sealed class Face
        {
            internal readonly Vec Normal; internal readonly double Plane; internal readonly List<Vec> Vertices = new List<Vec>();
            internal Vec Sum; internal double Area; internal Vec Center { get { return Sum / Area; } }
            internal Face(Vec normal, double plane) { Normal = normal; Plane = plane; }
        }
        private sealed class Vote { internal int Count; internal Point2 Sum; }
        private sealed class Circle
        {
            internal readonly Point2 Center; internal readonly List<Point2> Points; internal readonly double MinimumRadius, MaximumRadius;
            internal Circle(Point2 center, List<Point2> points, double minimum, double maximum)
            { Center = center; Points = points; MinimumRadius = minimum; MaximumRadius = maximum; }
        }
        private sealed class PortEvidence
        {
            internal readonly MeshPort Port; internal readonly HashSet<string> Neighbours = new HashSet<string>(StringComparer.Ordinal);
            internal PortEvidence(MeshPort port) { Port = port; }
        }
        private sealed class CapPlane
        {
            internal readonly double Plane;
            internal readonly List<Triangle> Triangles = new List<Triangle>();
            internal CapPlane(double plane) { Plane = plane; }
        }
        private struct Point2
        {
            internal readonly double X, Y; internal Point2(double x, double y) { X = x; Y = y; }
            internal double LengthSquared { get { return X * X + Y * Y; } } internal double Length { get { return Math.Sqrt(LengthSquared); } }
            public static Point2 operator +(Point2 a, Point2 b) { return new Point2(a.X + b.X, a.Y + b.Y); }
            public static Point2 operator -(Point2 a, Point2 b) { return new Point2(a.X - b.X, a.Y - b.Y); }
            public static Point2 operator /(Point2 a, double b) { return new Point2(a.X / b, a.Y / b); }
        }
        private struct Grid2 : IEquatable<Grid2>
        {
            private readonly long x, y;
            internal Grid2(Point2 point, double size) { x = (long)Math.Round(point.X / size); y = (long)Math.Round(point.Y / size); }
            public bool Equals(Grid2 other) { return x == other.x && y == other.y; }
            public override bool Equals(object value) { return value is Grid2 && Equals((Grid2)value); }
            public override int GetHashCode() { unchecked { return x.GetHashCode() * 397 ^ y.GetHashCode(); } }
        }
    }
}
