namespace PathFinder.Barriers;

internal readonly record struct V(double X, double Y, double Z)
{
    internal V(BarrierPoint value) : this(value.X, value.Y, value.Z) { }
    public static V operator +(V a, V b) => new(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
    public static V operator -(V a, V b) => new(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
    public static V operator *(V a, double scale) => new(a.X * scale, a.Y * scale, a.Z * scale);
    internal double SquaredLength => Dot(this, this);
    internal double Length => Math.Sqrt(SquaredLength);
    internal double Axis(int axis) => axis == 0 ? X : axis == 1 ? Y : Z;
    internal static double Dot(V a, V b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;
    internal static V Cross(V a, V b) => new(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X);
    internal static V Min(V a, V b) => new(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Min(a.Z, b.Z));
    internal static V Max(V a, V b) => new(Math.Max(a.X, b.X), Math.Max(a.Y, b.Y), Math.Max(a.Z, b.Z));
}

internal readonly record struct Box(V Min, V Max)
{
    internal static Box Of(V a, V b) => new(V.Min(a, b), V.Max(a, b));
    internal static Box Union(Box a, Box b) => new(V.Min(a.Min, b.Min), V.Max(a.Max, b.Max));
    internal bool Overlaps(Box other, double tolerance) => Min.X <= other.Max.X + tolerance && Max.X + tolerance >= other.Min.X
        && Min.Y <= other.Max.Y + tolerance && Max.Y + tolerance >= other.Min.Y
        && Min.Z <= other.Max.Z + tolerance && Max.Z + tolerance >= other.Min.Z;
    internal bool Contains(V point, double tolerance) => point.X >= Min.X - tolerance && point.X <= Max.X + tolerance
        && point.Y >= Min.Y - tolerance && point.Y <= Max.Y + tolerance
        && point.Z >= Min.Z - tolerance && point.Z <= Max.Z + tolerance;
    internal int LongestAxis
    {
        get { var size = Max - Min; return size.X >= size.Y && size.X >= size.Z ? 0 : size.Y >= size.Z ? 1 : 2; }
    }
    internal double Centre(int axis) => Min.Axis(axis) + (Max.Axis(axis) - Min.Axis(axis)) / 2;
}

internal readonly record struct Triangle(V A, V B, V C, int Solid, int Local, int Ia, int Ib, int Ic)
{
    internal Box Bounds => Box.Union(Box.Of(A, B), Box.Of(C, C));
    internal V At(int index) => index == 0 ? A : index == 1 ? B : C;
    internal int IndexAt(int index) => index == 0 ? Ia : index == 1 ? Ib : Ic;
    internal V Normal => V.Cross(B - A, C - A);
}

internal readonly record struct Contact(V First, V Second);

internal static class Geometry
{
    internal const double MachineEpsilon = 2.2204460492503131e-16;
    internal static bool Valid(V point, double maximum) => double.IsFinite(point.X) && double.IsFinite(point.Y)
        && double.IsFinite(point.Z) && Math.Abs(point.X) <= maximum && Math.Abs(point.Y) <= maximum && Math.Abs(point.Z) <= maximum;

    internal static double Longest(Triangle t) => Math.Max((t.B - t.A).Length, Math.Max((t.C - t.A).Length, (t.C - t.B).Length));
    internal static double ShapeRatio(Triangle t) { double longest = Longest(t); return t.Normal.Length / (longest * longest); }
    internal static double ArithmeticGuard(Triangle t, double scale) => 256 * MachineEpsilon * scale / ShapeRatio(t);
    internal static bool Finite(V value) => double.IsFinite(value.X) && double.IsFinite(value.Y) && double.IsFinite(value.Z);
    private static V RequireFinite(V value)
    {
        if (!Finite(value)) throw new GeometryUncertaintyException("A collision arithmetic intermediate was not finite.");
        return value;
    }

    internal static V Closest(V p, Triangle t, double tolerance)
    {
        // Avoid subtracting nearly equal products of dot products (the usual
        // Voronoi-region formula can return an edge for an interior point on a
        // very long thin triangle). Projection and oriented edge cross products
        // have an explicit conditioning guard at build/query admission instead.
        var normal = t.Normal; double length = normal.Length;
        if (!double.IsFinite(length) || length == 0) throw new GeometryUncertaintyException("Triangle plane is numerically unsupported.");
        var unit = normal * (1 / length);
        var projected = RequireFinite(p - unit * V.Dot(p - t.A, unit));
        bool inside = true;
        for (var edge = 0; edge < 3; edge++)
        {
            var a = t.At(edge); var delta = t.At((edge + 1) % 3) - a;
            double side = V.Dot(V.Cross(delta, projected - a), unit);
            if (!double.IsFinite(side)) throw new GeometryUncertaintyException("Triangle halfspace is numerically unsupported.");
            if (side < -tolerance * delta.Length) inside = false;
        }
        if (inside) return projected;
        var best = ClosestOnSegment(p, t.A, t.B); double squared = (p - best).SquaredLength;
        for (var edge = 1; edge < 3; edge++)
        {
            var candidate = ClosestOnSegment(p, t.At(edge), t.At((edge + 1) % 3));
            double next = (p - candidate).SquaredLength;
            if (!double.IsFinite(next)) throw new GeometryUncertaintyException("Closest-edge distance is numerically unsupported.");
            if (next < squared) { best = candidate; squared = next; }
        }
        return RequireFinite(best);
    }

    internal static V ClosestOnSegment(V p, V a, V b)
    {
        var delta = b - a; double squared = delta.SquaredLength;
        return squared == 0 ? a : RequireFinite(a + delta * Math.Clamp(V.Dot(p - a, delta) / squared, 0, 1));
    }

    internal static Contact SegmentClosest(V a, V b, V c, V d)
    {
        var u = b - a; var v = d - c; var w = a - c;
        double aa = V.Dot(u, u), bb = V.Dot(u, v), cc = V.Dot(v, v), dd = V.Dot(u, w), ee = V.Dot(v, w);
        // The cross product avoids catastrophic subtraction for nearly parallel edges.
        var cross = V.Cross(u, v); double determinant = cross.SquaredLength;
        double s = aa == 0 ? 0 : determinant > 0 ? Math.Clamp(V.Dot(V.Cross(v, w), cross) / determinant, 0, 1) : 0;
        double t = cc == 0 ? 0 : (bb * s + ee) / cc;
        if (t < 0) { t = 0; s = aa == 0 ? 0 : Math.Clamp(-dd / aa, 0, 1); }
        else if (t > 1) { t = 1; s = aa == 0 ? 0 : Math.Clamp((bb - dd) / aa, 0, 1); }
        return new(RequireFinite(a + u * s), RequireFinite(c + v * t));
    }

    /// <summary>
    /// Contacts include near-surface tolerance, coplanar overlap and edge/vertex
    /// contact. Unlike a ray-only test, parallel/coplanar segments cannot escape.
    /// </summary>
    internal static IEnumerable<Contact> SegmentContacts(V a, V b, Triangle triangle, double tolerance)
    {
        double squaredTolerance = tolerance * tolerance;
        var closestA = Closest(a, triangle, tolerance); var closestB = Closest(b, triangle, tolerance);
        if ((a - closestA).SquaredLength <= squaredTolerance) yield return new(a, closestA);
        if ((b - closestB).SquaredLength <= squaredTolerance) yield return new(b, closestB);
        var normal = triangle.Normal;
        double first = V.Dot(a - triangle.A, normal), last = V.Dot(b - triangle.A, normal);
        double divisor = first - last;
        if (divisor != 0)
        {
            double fraction = first / divisor;
            if (double.IsFinite(fraction) && fraction >= 0 && fraction <= 1)
            {
                var hit = RequireFinite(a + (b - a) * fraction); var closest = Closest(hit, triangle, tolerance);
                if ((hit - closest).SquaredLength <= squaredTolerance) yield return new(hit, closest);
            }
        }
        for (var edge = 0; edge < 3; edge++)
        {
            var contact = SegmentClosest(a, b, triangle.At(edge), triangle.At((edge + 1) % 3));
            if ((contact.First - contact.Second).SquaredLength <= squaredTolerance) yield return contact;
        }
    }

    internal static bool Touches(V a, V b, Triangle triangle, double tolerance) => SegmentContacts(a, b, triangle, tolerance).Any();

    /// <summary>After full closed-oriented-shell qualification, winding classifies
    /// containment even when a segment never crosses the boundary. No sample rays.</summary>
    internal static double SolidAngle(V point, Triangle triangle)
    {
        var a = triangle.A - point; var b = triangle.B - point; var c = triangle.C - point;
        double la = a.Length, lb = b.Length, lc = c.Length;
        double numerator = V.Dot(a, V.Cross(b, c));
        double denominator = la * lb * lc + V.Dot(a, b) * lc + V.Dot(a, c) * lb + V.Dot(b, c) * la;
        return 2 * Math.Atan2(numerator, denominator);
    }
}

internal sealed class GeometryUncertaintyException(string message) : Exception(message);
