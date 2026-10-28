using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

namespace AddinRibbon.Routing
{
    public enum TrayGeometryFitPolicy { LegacyV1, MeasuredBendV2 }

    public enum TrayBoxFace { MinX, MaxX, MinY, MaxY, MinZ, MaxZ }

    /// <summary>Bounds of actual mesh vertices at one world-box face, in metres.</summary>
    public sealed class TrayFaceExtent
    {
        public TrayBoxFace Face { get; private set; }
        public RoutePoint Minimum { get; private set; }
        public RoutePoint Maximum { get; private set; }
        public int SampleCount { get; private set; }
        public TrayFaceExtent(TrayBoxFace face, RoutePoint minimum, RoutePoint maximum, int sampleCount)
        {
            if ((int)face < 0 || (int)face > 5) throw new ArgumentOutOfRangeException("face");
            TrayGeometryInput.ValidateBounds(minimum, maximum);
            if (sampleCount < 0) throw new ArgumentOutOfRangeException("sampleCount");
            Face = face; Minimum = minimum; Maximum = maximum; SampleCount = sampleCount;
        }
    }

    /// <summary>Detached geometry input; no native objects or coordinate-unit assumptions.</summary>
    public sealed class TrayGeometryInput
    {
        public string Id { get; private set; }
        public string RouteName { get; private set; }
        public CableCategory Categories { get; private set; }
        public string ShapeName { get; private set; }
        public RoutePoint Minimum { get; private set; }
        public RoutePoint Maximum { get; private set; }
        public IReadOnlyList<TrayFaceExtent> FaceExtents { get; private set; }
        public TrayMeshData Mesh { get; private set; }
        public TrayGeometryInput(string id, string routeName, CableCategory categories, string shapeName,
            RoutePoint minimum, RoutePoint maximum, IEnumerable<TrayFaceExtent> faceExtents = null)
            : this(id, routeName, categories, shapeName, minimum, maximum, faceExtents, null) { }

        public TrayGeometryInput(string id, string routeName, CableCategory categories, string shapeName,
            RoutePoint minimum, RoutePoint maximum, IEnumerable<TrayFaceExtent> faceExtents, TrayMeshData mesh)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("A tray needs a stable identifier.", "id");
            if ((categories & ~CableCategory.All) != 0) throw new ArgumentException("Unknown cable category.", "categories");
            ValidateBounds(minimum, maximum);
            var faces = (faceExtents ?? Enumerable.Empty<TrayFaceExtent>()).ToArray();
            if (faces.Any(f => f == null) || faces.Select(f => f.Face).Distinct().Count() != faces.Length)
                throw new ArgumentException("Mesh face evidence must contain at most one extent per face.", "faceExtents");
            Id = id; RouteName = routeName ?? string.Empty; Categories = categories;
            ShapeName = shapeName ?? string.Empty; Minimum = minimum; Maximum = maximum;
            FaceExtents = new ReadOnlyCollection<TrayFaceExtent>(faces);
            Mesh = mesh;
        }
        internal static void ValidateBounds(RoutePoint minimum, RoutePoint maximum)
        {
            if (minimum.X > maximum.X || minimum.Y > maximum.Y || minimum.Z > maximum.Z)
                throw new ArgumentException("Geometry minimum must not exceed its maximum.");
        }
    }

    public sealed class TrayGeometryBuildResult
    {
        public IReadOnlyList<TraySegment> Segments { get; private set; }
        public int ValidatedBends { get; private set; }
        public int FallbackBends { get; private set; }
        public int ValidatedStraights { get; private set; }
        public int FallbackStraights { get; private set; }
        public int FallbackClearances { get; private set; }
        public IReadOnlyList<string> Diagnostics { get; private set; }
        internal TrayGeometryBuildResult(List<TraySegment> segments, int validated, List<string> diagnostics)
            : this(segments, validated, diagnostics.Count, 0, 0, diagnostics) { }

        internal TrayGeometryBuildResult(List<TraySegment> segments, int validated, int fallbackBends,
            int validatedStraights, int fallbackStraights, List<string> diagnostics, int fallbackClearances = 0)
        {
            Segments = new ReadOnlyCollection<TraySegment>(segments);
            ValidatedBends = validated; FallbackBends = fallbackBends;
            ValidatedStraights = validatedStraights; FallbackStraights = fallbackStraights;
            FallbackClearances = fallbackClearances;
            Diagnostics = new ReadOnlyCollection<string>(diagnostics);
        }
    }

    /// <summary>
    /// Reconstructs typed straights and circular bends from measured mesh end
    /// sections and compatible neighboring ports. Legacy world-face quarter bends
    /// remain supported; unproved shapes retain a reported world-box approximation.
    /// </summary>
    public static class TrayGeometryBuilder
    {
        public const string MeasuredBendFittingPolicyVersion = "wfc.pf.measured-bend-mesh-fitting.v2";
        public const double PortToleranceMeters = 0.02;
        private const double FaceBandMeters = 0.003;
        private const double RadiusToleranceMeters = 0.002;
        private static readonly Regex BendName = new Regex(@"(?<![A-Za-z0-9])(?:BEND|ELBOW)(?![A-Za-z0-9])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly Regex StraightName = new Regex(@"(?<![A-Za-z0-9])(?:FTUBE|TUBE|STRAIGHT)(?![A-Za-z0-9])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public static bool IsBendOrElbow(string shapeName) { return BendName.IsMatch(shapeName ?? string.Empty); }
        public static bool IsStraight(string shapeName) { return StraightName.IsMatch(shapeName ?? string.Empty); }

        public static TrayGeometryBuildResult Build(IEnumerable<TrayGeometryInput> inputs,
            CancellationToken cancellationToken = default(CancellationToken))
        { return Build(inputs, TrayGeometryFitPolicy.LegacyV1, cancellationToken); }

        public static TrayGeometryBuildResult Build(IEnumerable<TrayGeometryInput> inputs,
            TrayGeometryFitPolicy fitPolicy, CancellationToken cancellationToken = default(CancellationToken))
        {
            if (fitPolicy != TrayGeometryFitPolicy.LegacyV1 && fitPolicy != TrayGeometryFitPolicy.MeasuredBendV2)
                throw new ArgumentOutOfRangeException("fitPolicy");
            if (inputs == null) throw new ArgumentNullException("inputs");
            var values = inputs.ToArray();
            if (values.Any(v => v == null)) throw new ArgumentException("Geometry inputs cannot be null.", "inputs");
            if (values.Select(v => v.Id).Distinct(StringComparer.Ordinal).Count() != values.Length)
                throw new ArgumentException("Geometry identifiers must be unique.", "inputs");
            var straightCandidates = new Dictionary<string, List<TrayMeshGeometry.MeshStraight>>(StringComparer.Ordinal);
            var straightReasons = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var input in values)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (IsBendOrElbow(input.ShapeName) || !IsStraight(input.ShapeName)) continue;
                string reason;
                straightCandidates.Add(input.Id, TrayMeshGeometry.StraightCandidates(input, cancellationToken, out reason));
                straightReasons.Add(input.Id, reason);
            }
            var meshBends = new Dictionary<string, TrayMeshGeometry.MeshBend>(StringComparer.Ordinal);
            var bendReasons = new Dictionary<string, string>(StringComparer.Ordinal);
            var candidates = straightCandidates.Values.SelectMany(fits => fits).ToArray();
            foreach (var input in values)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!IsBendOrElbow(input.ShapeName) || input.Mesh == null) continue;
                var adjacent = candidates.Where(fit => fit.Input.Id != input.Id &&
                    (fit.Input.Categories & input.Categories) != CableCategory.None &&
                    (NearBounds(input, fit.Start.Center) || NearBounds(input, fit.End.Center))).ToArray();
                TrayMeshGeometry.MeshBend bend;
                string reason;
                if (adjacent.Length > 128) reason = "too many neighboring mesh port candidates for a unique bend";
                else if (fitPolicy == TrayGeometryFitPolicy.MeasuredBendV2 ?
                    TrayBendMeshGeometry.TryFitMeasured(input, adjacent, cancellationToken, out bend, out reason) :
                    TrayBendMeshGeometry.TryFit(input, adjacent, cancellationToken, out bend, out reason))
                    meshBends.Add(input.Id, bend);
                bendReasons.Add(input.Id, reason);
            }
            var meshStraights = TrayMeshGeometry.ResolveStraights(straightCandidates, meshBends, values, cancellationToken);
            var ends = new EndpointIndex();
            foreach (var input in values)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (IsBendOrElbow(input.ShapeName) || !IsStraight(input.ShapeName)) continue;
                TrayMeshGeometry.MeshStraight meshStraight;
                var line = meshStraights.TryGetValue(input.Id, out meshStraight) ?
                    new[] { meshStraight.Start.Center.Point, meshStraight.End.Center.Point } : Fallback(input);
                int axis = LongestAxis(input);
                if (meshStraight != null)
                {
                    double x = Math.Abs(meshStraight.Direction.X), y = Math.Abs(meshStraight.Direction.Y), z = Math.Abs(meshStraight.Direction.Z);
                    if (Math.Max(x, Math.Max(y, z)) < 1 - 0.000001) continue;
                    axis = x >= y && x >= z ? 0 : y >= z ? 1 : 2;
                }
                if (line[0].DistanceTo(line[1]) == 0) continue;
                ends.Add(new StraightEnd(input, axis, line[0], line[1]));
                ends.Add(new StraightEnd(input, axis, line[1], line[0]));
            }
            var segments = new List<TraySegment>();
            var diagnostics = new List<string>();
            int validated = 0;
            int fallbackBends = 0;
            foreach (var input in values)
            {
                cancellationToken.ThrowIfCancellationRequested();
                RoutePoint[] points = Fallback(input);
                bool validatedBend = false;
                RouteConnectionPort[] verifiedPorts = null;
                if (IsBendOrElbow(input.ShapeName))
                {
                    string reason = null;
                    RoutePoint[] arc;
                    TrayMeshGeometry.MeshBend meshBend;
                    if (meshBends.TryGetValue(input.Id, out meshBend))
                    {
                        points = meshBend.Points; validated++; validatedBend = true;
                        verifiedPorts = new[] { ConnectionPort(meshBend.Start), ConnectionPort(meshBend.End) };
                    }
                    else if ((fitPolicy == TrayGeometryFitPolicy.LegacyV1 || input.Mesh == null) &&
                        TryBend(input, ends, cancellationToken, out arc, out reason))
                    {
                        points = arc; validated++; validatedBend = true;
                        if (input.Mesh != null && bendReasons.ContainsKey(input.Id))
                            diagnostics.Add(input.Id + ": " + bendReasons[input.Id] + "; using world-face quarter-circle approximation");
                    }
                    else
                    {
                        fallbackBends++;
                        diagnostics.Add(input.Id + ": " + (bendReasons.ContainsKey(input.Id) ? bendReasons[input.Id] : reason));
                    }
                }
                else if (IsStraight(input.ShapeName))
                {
                    TrayMeshGeometry.MeshStraight meshStraight;
                    if (meshStraights.TryGetValue(input.Id, out meshStraight))
                    {
                        points = new[] { meshStraight.Start.Center.Point, meshStraight.End.Center.Point };
                        verifiedPorts = new[] { ConnectionPort(meshStraight.Start), ConnectionPort(meshStraight.End) };
                    }
                    else if (input.Mesh != null)
                        diagnostics.Add(input.Id + ": " + (straightReasons[input.Id] ?? "straight axis needs unique neighboring port evidence"));
                }
                else diagnostics.Add(input.Id + ": shape has no validated tray centerline; using world-box-axis approximation");
                var connectionSurfaces = new List<TrayMeshClearance>();
                if (verifiedPorts != null && input.Mesh != null)
                {
                    foreach (var portSet in validatedBend ?
                        verifiedPorts.Select(port => new[] { port }) : new[] { verifiedPorts })
                    {
                        TrayMeshClearance surface;
                        string reason;
                        if (TrayMeshClearance.TryCreate(input.Mesh, portSet, validatedBend,
                            cancellationToken, out surface, out reason)) connectionSurfaces.Add(surface);
                        else
                        {
                            connectionSurfaces.Clear();
                            diagnostics.Add(input.Id + ": physical clearance evidence is unavailable; " + reason);
                            break;
                        }
                    }
                }
                else if (input.Mesh != null && !validatedBend)
                {
                    TrayMeshClearance surface;
                    string reason;
                    if (TrayMeshClearance.TryCreate(input.Mesh, null, false, cancellationToken,
                        out surface, out reason)) connectionSurfaces.Add(surface);
                    else diagnostics.Add(input.Id + ": physical clearance evidence is unavailable; " + reason);
                }
                segments.Add(new TraySegment(input.Id, input.RouteName, input.Categories, points,
                    validatedBend, verifiedPorts, connectionSurfaces));
            }
            return new TrayGeometryBuildResult(segments, validated, fallbackBends, meshStraights.Count,
                straightCandidates.Count - meshStraights.Count, diagnostics,
                segments.Count(segment => segment.ConnectionSurfaces.Count == 0));
        }

        private static RouteConnectionPort ConnectionPort(TrayMeshGeometry.MeshPort port)
        {
            return new RouteConnectionPort(port.Center.Point, port.Outward.Point, port.U.Point,
                port.V.Point, port.Width, port.Height);
        }

        private static bool NearBounds(TrayGeometryInput input, TrayMeshGeometry.Vec point)
        {
            return point.X >= input.Minimum.X - PortToleranceMeters && point.X <= input.Maximum.X + PortToleranceMeters &&
                point.Y >= input.Minimum.Y - PortToleranceMeters && point.Y <= input.Maximum.Y + PortToleranceMeters &&
                point.Z >= input.Minimum.Z - PortToleranceMeters && point.Z <= input.Maximum.Z + PortToleranceMeters;
        }

        private static bool TryBend(TrayGeometryInput input, EndpointIndex ends, CancellationToken token,
            out RoutePoint[] points, out string reason)
        {
            points = null; reason = "no uniquely validated pair of mesh ports and neighbouring straights";
            double[] size = Sizes(input);
            int normal = size[0] <= size[1] && size[0] <= size[2] ? 0 : size[1] <= size[2] ? 1 : 2;
            int first = (normal + 1) % 3, second = (normal + 2) % 3;
            if (first > second) { int swap = first; first = second; second = swap; }
            if (size[first] < 0.05 || size[second] < 0.05 || size[normal] > Math.Min(size[first], size[second]) * 0.5
                || Math.Abs(size[first] - size[second]) > PortToleranceMeters)
            { reason = "unsupported non-planar or non-square bend bounds"; return false; }
            var firstPorts = Ports(input, first, second, normal, ends).ToArray();
            var secondPorts = Ports(input, second, first, normal, ends).ToArray();
            int fits = 0;
            foreach (var start in firstPorts)
                foreach (var end in secondPorts)
                {
                    token.ThrowIfCancellationRequested();
                    double radiusFirst = Math.Abs(Value(end, first) - Value(start, first));
                    double radiusSecond = Math.Abs(Value(start, second) - Value(end, second));
                    if (radiusFirst < 0.025 || Math.Abs(radiusFirst - radiusSecond) > RadiusToleranceMeters
                        || Math.Abs(Value(start, normal) - Value(end, normal)) > FaceBandMeters) continue;
                    var arc = QuarterArc(start, end, first, second, normal);
                    if (!arc.All(p => Contains(input, p, FaceBandMeters))) continue;
                    fits++;
                    points = arc;
                }
            if (fits == 1) return true;
            points = null;
            if (fits > 1) reason = "ambiguous mesh ports admit more than one bend";
            else if (input.FaceExtents.Count == 0) reason = "mesh port evidence is unavailable";
            return false;
        }

        private static IEnumerable<RoutePoint> Ports(TrayGeometryInput input, int faceAxis, int perpendicular,
            int normal, EndpointIndex ends)
        {
            foreach (var face in input.FaceExtents)
            {
                if ((int)face.Face / 2 != faceAxis || face.SampleCount < 4) continue;
                bool maximum = (int)face.Face % 2 != 0;
                double plane = Value(maximum ? input.Maximum : input.Minimum, faceAxis);
                if (Math.Abs(Value(face.Minimum, faceAxis) - plane) > FaceBandMeters
                    || Math.Abs(Value(face.Maximum, faceAxis) - plane) > FaceBandMeters
                    || Value(face.Maximum, perpendicular) - Value(face.Minimum, perpendicular) < 0.01
                    || Value(face.Maximum, normal) - Value(face.Minimum, normal) < 0.00001
                    || !Contains(input, face.Minimum, FaceBandMeters) || !Contains(input, face.Maximum, FaceBandMeters)) continue;
                var centre = Midpoint(face.Minimum, face.Maximum);
                centre = Set(centre, faceAxis, plane);
                if (Math.Abs(Value(centre, normal) - (Value(input.Minimum, normal) + Value(input.Maximum, normal)) * 0.5) > FaceBandMeters) continue;
                double width = Value(face.Maximum, perpendicular) - Value(face.Minimum, perpendicular);
                double height = Value(face.Maximum, normal) - Value(face.Minimum, normal);
                bool hasNeighbour = ends.Near(centre).Any(end => end.Axis == faceAxis && end.Input.Id != input.Id
                    && (end.Input.Categories & input.Categories) != CableCategory.None
                    && end.Point.DistanceTo(centre) <= PortToleranceMeters
                    // A narrow sample band at an outer arc extremum is not an
                    // opening. Its occupied section must match the straight arm.
                    && Math.Abs(width - (Value(end.Input.Maximum, perpendicular) - Value(end.Input.Minimum, perpendicular))) <= Math.Max(FaceBandMeters, width * 0.05)
                    && Math.Abs(height - (Value(end.Input.Maximum, normal) - Value(end.Input.Minimum, normal))) <= Math.Max(FaceBandMeters, height * 0.05)
                    && (maximum ? Value(end.Other, faceAxis) > plane + FaceBandMeters : Value(end.Other, faceAxis) < plane - FaceBandMeters));
                if (hasNeighbour) yield return centre;
            }
        }

        private static RoutePoint[] QuarterArc(RoutePoint start, RoutePoint end, int first, int second, int normal)
        {
            var values = new RoutePoint[19];
            for (int index = 0; index <= 18; index++)
            {
                double fraction = index / 18.0, angle = fraction * Math.PI * 0.5;
                var point = start;
                point = Set(point, first, Value(start, first) + (Value(end, first) - Value(start, first)) * Math.Sin(angle));
                point = Set(point, second, Value(end, second) + (Value(start, second) - Value(end, second)) * Math.Cos(angle));
                point = Set(point, normal, Value(start, normal) + (Value(end, normal) - Value(start, normal)) * fraction);
                values[index] = point;
            }
            values[0] = start; values[18] = end;
            return values;
        }

        private static RoutePoint[] Fallback(TrayGeometryInput input)
        {
            var middle = Midpoint(input.Minimum, input.Maximum);
            int axis = LongestAxis(input);
            return new[] { Set(middle, axis, Value(input.Minimum, axis)), Set(middle, axis, Value(input.Maximum, axis)) };
        }
        private static int LongestAxis(TrayGeometryInput input)
        { double[] size = Sizes(input); return size[0] >= size[1] && size[0] >= size[2] ? 0 : size[1] >= size[2] ? 1 : 2; }
        private static double[] Sizes(TrayGeometryInput input)
        { return new[] { input.Maximum.X - input.Minimum.X, input.Maximum.Y - input.Minimum.Y, input.Maximum.Z - input.Minimum.Z }; }
        private static RoutePoint Midpoint(RoutePoint first, RoutePoint last)
        { return new RoutePoint(first.X * 0.5 + last.X * 0.5, first.Y * 0.5 + last.Y * 0.5, first.Z * 0.5 + last.Z * 0.5); }
        private static double Value(RoutePoint point, int axis) { return axis == 0 ? point.X : axis == 1 ? point.Y : point.Z; }
        private static RoutePoint Set(RoutePoint point, int axis, double value)
        { return new RoutePoint(axis == 0 ? value : point.X, axis == 1 ? value : point.Y, axis == 2 ? value : point.Z); }
        private static bool Contains(TrayGeometryInput input, RoutePoint point, double allowance)
        { return Enumerable.Range(0, 3).All(axis => Value(point, axis) >= Value(input.Minimum, axis) - allowance && Value(point, axis) <= Value(input.Maximum, axis) + allowance); }

        private sealed class StraightEnd
        {
            public readonly TrayGeometryInput Input; public readonly int Axis; public readonly RoutePoint Point, Other;
            public StraightEnd(TrayGeometryInput input, int axis, RoutePoint point, RoutePoint other)
            { Input = input; Axis = axis; Point = point; Other = other; }
        }
        private sealed class EndpointIndex
        {
            private readonly Dictionary<Tuple<double, double, double>, List<StraightEnd>> cells = new Dictionary<Tuple<double, double, double>, List<StraightEnd>>();
            private static Tuple<double, double, double> Key(RoutePoint point)
            { return Tuple.Create(Math.Floor(point.X / PortToleranceMeters), Math.Floor(point.Y / PortToleranceMeters), Math.Floor(point.Z / PortToleranceMeters)); }
            public void Add(StraightEnd end)
            { var key = Key(end.Point); List<StraightEnd> list; if (!cells.TryGetValue(key, out list)) cells.Add(key, list = new List<StraightEnd>()); list.Add(end); }
            public IEnumerable<StraightEnd> Near(RoutePoint point)
            {
                var key = Key(point);
                for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++)
                { List<StraightEnd> list; if (cells.TryGetValue(Tuple.Create(key.Item1 + x, key.Item2 + y, key.Item3 + z), out list)) foreach (var end in list) yield return end; }
            }
        }
    }
}
