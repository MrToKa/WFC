namespace PathFinder.Barriers;

public enum OriginalTriangleContactStatus { NoSurfaceContact, Contact, Indeterminate }
public sealed record OriginalTriangleContactResult(OriginalTriangleContactStatus Status, string Reason,
    double NumericGuardMeters, long Work, BarrierPoint? SegmentPoint = null, BarrierPoint? SurfacePoint = null);

/// <summary>Pure surface contact only. No topology, material occupancy, nearest/
/// first-exit ordering, cable radius, endpoint exception or routing authority.</summary>
public static class OriginalTriangleSurfaceContact
{
    public const string AlgorithmVersion = "wfc.pf.original-triangle-surface-contact.foundation.v1";
    public static OriginalTriangleContactResult Check(BarrierPoint from, BarrierPoint to,
        BarrierPoint a, BarrierPoint b, BarrierPoint c, double numericToleranceMeters = 1e-7,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!double.IsFinite(numericToleranceMeters) || numericToleranceMeters is < 1e-9 or > 1e-3)
            return new(OriginalTriangleContactStatus.Indeterminate, "INVALID_NUMERIC_TOLERANCE", 0, 0);
        var first = new V(from); var last = new V(to);
        var triangle = new Triangle(new(a), new(b), new(c), 0, 0, 0, 1, 2);
        if (!Geometry.Valid(first, 1e9) || !Geometry.Valid(last, 1e9)
            || !Geometry.Valid(triangle.A, 1e9) || !Geometry.Valid(triangle.B, 1e9) || !Geometry.Valid(triangle.C, 1e9))
            return new(OriginalTriangleContactStatus.Indeterminate, "UNSUPPORTED_COORDINATE", 0, 0);
        double magnitude = 1;
        foreach (var point in new[] { first, last, triangle.A, triangle.B, triangle.C })
            magnitude = Math.Max(magnitude, Math.Max(Math.Abs(point.X), Math.Max(Math.Abs(point.Y), Math.Abs(point.Z))));
        double guard = Math.Max(numericToleranceMeters, 64 * Geometry.MachineEpsilon * magnitude);
        try
        {
            // Exact existing conditioning rule. Never weaken it for an open surface.
            double scale = Math.Max(Geometry.Longest(triangle), Math.Max((first - triangle.A).Length, (last - triangle.A).Length));
            double uncertainty = Geometry.ArithmeticGuard(triangle, scale);
            if (!double.IsFinite(uncertainty) || uncertainty > guard)
                return new(OriginalTriangleContactStatus.Indeterminate, "TRIANGLE_ARITHMETIC_UNCERTAINTY", guard, 8);
            foreach (var contact in Geometry.SegmentContacts(first, last, triangle, guard))
            {
                cancellationToken.ThrowIfCancellationRequested();
                return new(OriginalTriangleContactStatus.Contact, "ORIGINAL_TRIANGLE_CONTACT", guard, 8,
                    new(contact.First.X, contact.First.Y, contact.First.Z), new(contact.Second.X, contact.Second.Y, contact.Second.Z));
            }
            cancellationToken.ThrowIfCancellationRequested();
            return new(OriginalTriangleContactStatus.NoSurfaceContact, "NO_ORIGINAL_TRIANGLE_CONTACT", guard, 8);
        }
        catch (GeometryUncertaintyException)
        { return new(OriginalTriangleContactStatus.Indeterminate, "TRIANGLE_ARITHMETIC_UNCERTAINTY", guard, 8); }
    }
}
