using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

namespace AddinRibbon.Routing
{
    [Flags]
    public enum CableCategory
    {
        None = 0,
        MV = 1,
        LV = 2,
        Control = 4,
        All = MV | LV | Control
    }

    /// <summary>Detached coordinates in metres; never retains a Navisworks object.</summary>
    public struct RoutePoint
    {
        public double X { get; private set; }
        public double Y { get; private set; }
        public double Z { get; private set; }

        public RoutePoint(double x, double y, double z)
        {
            if (!IsFinite(x) || !IsFinite(y) || !IsFinite(z))
                throw new ArgumentException("Route coordinates must be finite.");
            X = x;
            Y = y;
            Z = z;
        }

        public double DistanceTo(RoutePoint other)
        {
            double x = X - other.X, y = Y - other.Y, z = Z - other.Z;
            return Math.Sqrt(x * x + y * y + z * z);
        }

        internal static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        internal static RoutePoint Interpolate(RoutePoint first, RoutePoint last, double fraction)
        {
            return new RoutePoint(first.X + (last.X - first.X) * fraction,
                first.Y + (last.Y - first.Y) * fraction,
                first.Z + (last.Z - first.Z) * fraction);
        }
    }

    /// <summary>Measured physical end section of a mesh-validated tray, in world-space metres.</summary>
    public sealed class RouteConnectionPort
    {
        public RoutePoint Point { get; private set; }
        public RoutePoint Outward { get; private set; }
        public RoutePoint U { get; private set; }
        public RoutePoint V { get; private set; }
        public double Width { get; private set; }
        public double Height { get; private set; }
        public RouteConnectionPort(RoutePoint point, RoutePoint outward, RoutePoint u, RoutePoint v, double width, double height)
        {
            if (!RoutePoint.IsFinite(width) || !RoutePoint.IsFinite(height) || width <= 0 || height <= 0)
                throw new ArgumentException("Measured port section dimensions must be finite and positive.");
            if (Math.Abs(Dot(outward, outward) - 1) > 1e-6 || Math.Abs(Dot(u, u) - 1) > 1e-6
                || Math.Abs(Dot(v, v) - 1) > 1e-6 || Math.Abs(Dot(outward, u)) > 1e-6
                || Math.Abs(Dot(outward, v)) > 1e-6 || Math.Abs(Dot(u, v)) > 1e-6)
                throw new ArgumentException("Measured port directions must form an orthonormal frame.");
            Point = point; Outward = outward; U = u; V = v; Width = width; Height = height;
        }
        internal static double Dot(RoutePoint a, RoutePoint b) { return a.X * b.X + a.Y * b.Y + a.Z * b.Z; }
    }

    public sealed class TraySegment
    {
        public string Id { get; private set; }
        public string Name { get; private set; }
        public string RouteCode { get; private set; }
        public CableCategory AllowedCategories { get; private set; }
        public IReadOnlyList<RoutePoint> Points { get; private set; }
        /// <summary>Cross-tray connections use only the physical first/last ports; object projection may use the interior.</summary>
        public bool ConnectionsAtEndsOnly { get; private set; }
        public IReadOnlyList<RouteConnectionPort> VerifiedPorts { get; private set; }
        /// <summary>Measured mesh surfaces: one clipped straight body or two bend end sections.</summary>
        public IReadOnlyList<TrayMeshClearance> ConnectionSurfaces { get; private set; }

        public TraySegment(string id, string name, CableCategory allowedCategories,
            IEnumerable<RoutePoint> points) : this(id, name, allowedCategories, points, false) { }

        public TraySegment(string id, string name, CableCategory allowedCategories,
            IEnumerable<RoutePoint> points, bool connectionsAtEndsOnly = false)
            : this(id, name, allowedCategories, points, connectionsAtEndsOnly, null) { }

        public TraySegment(string id, string name, CableCategory allowedCategories,
            IEnumerable<RoutePoint> points, bool connectionsAtEndsOnly, IEnumerable<RouteConnectionPort> verifiedPorts)
            : this(id, name, allowedCategories, points, connectionsAtEndsOnly, verifiedPorts, null) { }

        public TraySegment(string id, string name, CableCategory allowedCategories,
            IEnumerable<RoutePoint> points, bool connectionsAtEndsOnly, IEnumerable<RouteConnectionPort> verifiedPorts,
            IEnumerable<TrayMeshClearance> connectionSurfaces)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("A tray needs a stable identifier.", "id");
            if (points == null) throw new ArgumentNullException("points");
            var copy = points.ToArray();
            if (copy.Length < 2) throw new ArgumentException("A tray polyline needs at least two points.", "points");
            if ((allowedCategories & ~CableCategory.All) != 0)
                throw new ArgumentException("Unknown cable category.", "allowedCategories");
            Id = id;
            Name = name ?? string.Empty;
            RouteCode = RouteCodeParser.Parse(Name);
            AllowedCategories = allowedCategories;
            Points = new ReadOnlyCollection<RoutePoint>(copy);
            ConnectionsAtEndsOnly = connectionsAtEndsOnly;
            var ports = (verifiedPorts ?? Enumerable.Empty<RouteConnectionPort>()).ToArray();
            if (ports.Length > 2 || ports.Any(p => p == null ||
                (p.Point.DistanceTo(copy[0]) > 1e-6 && p.Point.DistanceTo(copy[copy.Length - 1]) > 1e-6)))
                throw new ArgumentException("Verified ports must describe the physical first and/or last endpoint.", "verifiedPorts");
            VerifiedPorts = new ReadOnlyCollection<RouteConnectionPort>(ports);
            var surfaces = (connectionSurfaces ?? Enumerable.Empty<TrayMeshClearance>()).ToArray();
            if (surfaces.Any(s => s == null) || (surfaces.Length != 0 && surfaces.Length != (connectionsAtEndsOnly ? 2 : 1)))
                throw new ArgumentException("Connection surfaces must describe one straight body or both bend end sections.", "connectionSurfaces");
            ConnectionSurfaces = new ReadOnlyCollection<TrayMeshClearance>(surfaces);
        }
    }

    public sealed class RoutingOptions
    {
        public double ConnectionToleranceMeters { get; set; } = 0.25;
        public double SampleSpacingMeters { get; set; } = 0.125;
        public double SecondaryDistanceMeters { get; set; } = 2.0;
        /// <summary>Prefer the least horizontal offset among approaches within one connection tolerance of the nearest 3D approach.</summary>
        public bool PreferVerticalApproach { get; set; }
        public int MaxGraphNodes { get; set; } = 500000;
        public int MaxGraphConnections { get; set; } = 2000000;

        internal void Validate()
        {
            if (!RoutePoint.IsFinite(ConnectionToleranceMeters) || ConnectionToleranceMeters <= 0)
                throw new ArgumentException("Connection tolerance must be greater than zero.");
            if (!RoutePoint.IsFinite(SampleSpacingMeters) || SampleSpacingMeters <= 0)
                throw new ArgumentException("Sample spacing must be greater than zero.");
            if (!RoutePoint.IsFinite(SecondaryDistanceMeters) || SecondaryDistanceMeters < 0)
                throw new ArgumentException("Secondary distance cannot be negative.");
            if (MaxGraphNodes < 2) throw new ArgumentException("Graph node limit must be at least two.");
            if (MaxGraphConnections < 1) throw new ArgumentException("Graph connection limit must be at least one.");
        }
    }

    public sealed class RouteResult
    {
        public bool Success { get; private set; }
        public string Message { get; private set; }
        public string RouteText { get; private set; }
        public IReadOnlyList<string> RouteCodes { get; private set; }
        public IReadOnlyList<string> SegmentIds { get; private set; }
        public IReadOnlyList<RoutePoint> PathPoints { get; private set; }
        /// <summary>Includes both endpoint-to-tray attachment distances.</summary>
        public double LengthMeters { get; private set; }
        public double FromDistanceMeters { get; private set; }
        public double ToDistanceMeters { get; private set; }
        public bool FromRequiresSecondary { get; private set; }
        public bool ToRequiresSecondary { get; private set; }
        /// <summary>Cross-tray gaps greater than RouteCalculator.ConnectionGapEpsilonMeters; excludes equipment attachment legs.</summary>
        public int ConnectionGapCount { get; private set; }
        /// <summary>Sum of measured surface clearances, or centreline distances where mesh evidence is unavailable. Cable length retains full centreline connectors.</summary>
        public double ConnectionGapLengthMeters { get; private set; }

        internal RouteResult(bool success, string message, IEnumerable<string> codes,
            IEnumerable<string> ids, IEnumerable<RoutePoint> points, double length,
            double fromDistance, double toDistance, bool fromSecondary, bool toSecondary)
            : this(success, message, codes, ids, points, length, fromDistance, toDistance,
                fromSecondary, toSecondary, 0, 0) { }

        internal RouteResult(bool success, string message, IEnumerable<string> codes,
            IEnumerable<string> ids, IEnumerable<RoutePoint> points, double length,
            double fromDistance, double toDistance, bool fromSecondary, bool toSecondary,
            int connectionGapCount = 0, double connectionGapLengthMeters = 0)
        {
            Success = success;
            Message = message;
            RouteCodes = new ReadOnlyCollection<string>(codes.ToArray());
            SegmentIds = new ReadOnlyCollection<string>(ids.ToArray());
            PathPoints = new ReadOnlyCollection<RoutePoint>(points.ToArray());
            LengthMeters = length;
            FromDistanceMeters = fromDistance;
            ToDistanceMeters = toDistance;
            FromRequiresSecondary = fromSecondary;
            ToRequiresSecondary = toSecondary;
            ConnectionGapCount = connectionGapCount;
            ConnectionGapLengthMeters = connectionGapLengthMeters;
            RouteText = string.Concat(RouteCodes);
        }

        internal static RouteResult Failure(string message)
        {
            return new RouteResult(false, message, new string[0], new string[0],
                new RoutePoint[0], 0, 0, 0, false, false);
        }

        public RouteResult Reverse()
        {
            return new RouteResult(Success, Message, RouteCodes.Reverse(), SegmentIds.Reverse(),
                PathPoints.Reverse(), LengthMeters, ToDistanceMeters, FromDistanceMeters,
                ToRequiresSecondary, FromRequiresSecondary, ConnectionGapCount, ConnectionGapLengthMeters);
        }
    }
}
