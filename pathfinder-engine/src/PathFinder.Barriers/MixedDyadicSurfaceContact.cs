using System.Numerics;

namespace PathFinder.Barriers;

internal enum MixedExactSurfaceStatus { NoSurfaceContact, Contact, Indeterminate }

/// <summary>Bounded exact predicates on unchanged binary64 coordinates, used
/// only by the additive mixed original-surface lane. A nonintersection is not a
/// clearance proof: unresolved distance/tolerance cases remain indeterminate.</summary>
internal static class MixedDyadicSurfaceContact
{
    internal const string AlgorithmVersion = "wfc.pf.mixed-exact-dyadic-surface-contact.v1";
    private const int MaximumBits = 4096;
    private sealed class ExactLimit : Exception { }
    private readonly record struct D(BigInteger N, int E);
    private readonly record struct P(BigInteger X, BigInteger Y, BigInteger Z)
    { internal BigInteger Axis(int axis) => axis == 0 ? X : axis == 1 ? Y : Z; }
    private sealed class Arithmetic(Action<long> spend, CancellationToken token)
    {
        internal void Charge(long work = 1) { token.ThrowIfCancellationRequested(); spend(work); }
        private static long Bits(BigInteger value) => BigInteger.Abs(value).GetBitLength();
        private static void Bound(BigInteger value) { if (Bits(value) > MaximumBits) throw new ExactLimit(); }
        internal BigInteger Add(BigInteger a, BigInteger b) { Charge(1 + (Math.Max(Bits(a), Bits(b)) + 63) / 64); if (Math.Max(Bits(a), Bits(b)) >= MaximumBits) throw new ExactLimit(); var value = a + b; Bound(value); return value; }
        internal BigInteger Sub(BigInteger a, BigInteger b) { Charge(1 + (Math.Max(Bits(a), Bits(b)) + 63) / 64); if (Math.Max(Bits(a), Bits(b)) >= MaximumBits) throw new ExactLimit(); var value = a - b; Bound(value); return value; }
        internal BigInteger Mul(BigInteger a, BigInteger b)
        {
            long ab = Bits(a), bb = Bits(b); Charge(1 + ((ab + 63) / 64) * ((bb + 63) / 64));
            if (ab + bb > MaximumBits) throw new ExactLimit(); var value = a * b; Bound(value); return value;
        }
        internal BigInteger Shift(BigInteger value, int amount)
        { Charge(1 + (Bits(value) + Math.Max(0, amount) + 63) / 64); if (amount < 0 || amount > MaximumBits || Bits(value) + amount > MaximumBits) throw new ExactLimit(); return value << amount; }
        internal P Sub(P a, P b) => new(Sub(a.X, b.X), Sub(a.Y, b.Y), Sub(a.Z, b.Z));
        internal P Scale(P value, BigInteger factor) => new(Mul(value.X, factor), Mul(value.Y, factor), Mul(value.Z, factor));
        internal P Add(P a, P b) => new(Add(a.X, b.X), Add(a.Y, b.Y), Add(a.Z, b.Z));
        internal P Cross(P a, P b) => new(Sub(Mul(a.Y, b.Z), Mul(a.Z, b.Y)), Sub(Mul(a.Z, b.X), Mul(a.X, b.Z)), Sub(Mul(a.X, b.Y), Mul(a.Y, b.X)));
        internal BigInteger Dot(P a, P b) => Add(Add(Mul(a.X, b.X), Mul(a.Y, b.Y)), Mul(a.Z, b.Z));
        internal (P[] Points, BigInteger Tolerance) Grid(BarrierPoint[] points, double tolerance)
        {
            if (!double.IsFinite(tolerance) || tolerance <= 0 || points.Length is not (3 or 5)) throw new ExactLimit();
            var values = new D[points.Length * 3 + 1]; int at = 0, exponent = 0; bool any = false;
            foreach (var point in points)
            {
                if (!Geometry.Valid(new(point), 1e9)) throw new ExactLimit();
                foreach (double value in new[] { point.X, point.Y, point.Z }) values[at++] = Decode(value);
            }
            values[at] = Decode(tolerance);
            foreach (var value in values) if (value.N != 0) { exponent = any ? Math.Min(exponent, value.E) : value.E; any = true; }
            var integers = new BigInteger[values.Length];
            for (int i = 0; i < values.Length; i++) integers[i] = values[i].N == 0 ? BigInteger.Zero : Shift(values[i].N, values[i].E - exponent);
            var result = new P[points.Length];
            for (int i = 0; i < points.Length; i++) result[i] = new(integers[3 * i], integers[3 * i + 1], integers[3 * i + 2]);
            return (result, integers[^1]);
        }
        private D Decode(double value)
        {
            Charge(); if (!double.IsFinite(value)) throw new ExactLimit();
            ulong raw = unchecked((ulong)BitConverter.DoubleToInt64Bits(value)); int exponent = (int)((raw >> 52) & 2047);
            ulong fraction = raw & 0x000fffffffffffffUL, mantissa = exponent == 0 ? fraction : fraction | (1UL << 52);
            return new((raw >> 63) == 0 ? new BigInteger(mantissa) : -new BigInteger(mantissa), exponent == 0 ? -1074 : exponent - 1075);
        }
    }
    /// <summary>Exact altitude comparison; no tolerance relaxation, snapping,
    /// triangulation or surface-to-solid inference.</summary>
    internal static bool CertifyResolution(BarrierPoint a, BarrierPoint b, BarrierPoint c, double tolerance, Action<long> spend, CancellationToken token)
    {
        var math = new Arithmetic(spend, token);
        try
        {
            var (p, t) = math.Grid([a, b, c], tolerance); var ab = math.Sub(p[1], p[0]); var ac = math.Sub(p[2], p[0]); var bc = math.Sub(p[2], p[1]);
            var normal = math.Cross(ab, ac); var normalSquared = math.Dot(normal, normal);
            var longestSquared = BigInteger.Max(math.Dot(ab, ab), BigInteger.Max(math.Dot(ac, ac), math.Dot(bc, bc)));
            var toleranceSquared = math.Mul(t, t); math.Charge();
            return longestSquared > toleranceSquared && normalSquared > math.Mul(toleranceSquared, longestSquared);
        }
        catch (ExactLimit) { return false; }
    }
    internal static MixedExactSurfaceStatus Check(BarrierPoint from, BarrierPoint to, BarrierPoint a, BarrierPoint b, BarrierPoint c,
        double tolerance, Action<long> spend, CancellationToken token)
    {
        var math = new Arithmetic(spend, token);
        try
        {
            var (p, t) = math.Grid([from, to, a, b, c], tolerance); var first = p[0]; var last = p[1]; var triangle = p[2..];
            // Separation by more than the exact dyadic tolerance on ONE axis
            // proves Euclidean distance exceeds it. This is the only no-contact
            // fallback; an exact nonintersection alone never claims clearance.
            for (int axis = 0; axis < 3; axis++)
            {
                math.Charge(); var lo = BigInteger.Min(first.Axis(axis), last.Axis(axis)); var hi = BigInteger.Max(first.Axis(axis), last.Axis(axis));
                var triLo = BigInteger.Min(triangle[0].Axis(axis), BigInteger.Min(triangle[1].Axis(axis), triangle[2].Axis(axis)));
                var triHi = BigInteger.Max(triangle[0].Axis(axis), BigInteger.Max(triangle[1].Axis(axis), triangle[2].Axis(axis)));
                if (math.Sub(lo, triHi) > t || math.Sub(triLo, hi) > t) return MixedExactSurfaceStatus.NoSurfaceContact;
            }
            var ab = math.Sub(triangle[1], triangle[0]); var ac = math.Sub(triangle[2], triangle[0]); var normal = math.Cross(ab, ac);
            if (normal.X == 0 && normal.Y == 0 && normal.Z == 0) return MixedExactSurfaceStatus.Indeterminate;
            var d0 = math.Dot(math.Sub(first, triangle[0]), normal); var d1 = math.Dot(math.Sub(last, triangle[0]), normal);
            if (d0 == 0 && Inside(first, BigInteger.One) || d1 == 0 && Inside(last, BigInteger.One)) return MixedExactSurfaceStatus.Contact;
            if (d0.Sign != 0 && d1.Sign != 0 && d0.Sign != d1.Sign)
            {
                var denominator = math.Sub(d0, d1); var numerator = d0;
                if (denominator.Sign < 0) { denominator = -denominator; numerator = -numerator; }
                var hit = math.Add(math.Scale(first, denominator), math.Scale(math.Sub(last, first), numerator));
                if (Inside(hit, denominator)) return MixedExactSurfaceStatus.Contact;
            }
            if (d0 == 0 && d1 == 0)
            {
                int drop = normal.X != 0 ? 0 : normal.Y != 0 ? 1 : 2;
                int x = (drop + 1) % 3, y = (drop + 2) % 3;
                for (int edge = 0; edge < 3; edge++) if (Intersects(first, last, triangle[edge], triangle[(edge + 1) % 3], x, y)) return MixedExactSurfaceStatus.Contact;
            }
            math.Charge(); return MixedExactSurfaceStatus.Indeterminate;

            bool Inside(P pointNumerator, BigInteger denominator)
            {
                for (int edge = 0; edge < 3; edge++)
                {
                    var origin = triangle[edge]; var delta = math.Sub(triangle[(edge + 1) % 3], origin);
                    var relative = math.Sub(pointNumerator, math.Scale(origin, denominator));
                    if (math.Dot(math.Cross(delta, relative), normal).Sign < 0) return false;
                }
                return true;
            }
            bool Intersects(P p0, P p1, P q0, P q1, int x, int y)
            {
                foreach (int axis in new[] { x, y })
                {
                    math.Charge(); if (BigInteger.Max(p0.Axis(axis), p1.Axis(axis)) < BigInteger.Min(q0.Axis(axis), q1.Axis(axis))
                        || BigInteger.Max(q0.Axis(axis), q1.Axis(axis)) < BigInteger.Min(p0.Axis(axis), p1.Axis(axis))) return false;
                }
                int o0 = Orient(p0, p1, q0).Sign, o1 = Orient(p0, p1, q1).Sign, o2 = Orient(q0, q1, p0).Sign, o3 = Orient(q0, q1, p1).Sign;
                return o0 * o1 <= 0 && o2 * o3 <= 0;
                BigInteger Orient(P start, P end, P point) => math.Sub(math.Mul(math.Sub(end.Axis(x), start.Axis(x)), math.Sub(point.Axis(y), start.Axis(y))),
                    math.Mul(math.Sub(end.Axis(y), start.Axis(y)), math.Sub(point.Axis(x), start.Axis(x))));
            }
        }
        catch (ExactLimit) { return MixedExactSurfaceStatus.Indeterminate; }
    }
}
