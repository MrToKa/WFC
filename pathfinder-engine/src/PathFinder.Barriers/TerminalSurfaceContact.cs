namespace PathFinder.Barriers;

/// <summary>A route terminal may meet a surface, never consume its material.
/// This is not an own-object exemption: every other triangle and open segment
/// remains checked, and the default kernel query stays strictly contact-free.</summary>
internal static class TerminalSurfaceContact
{
    internal const string Policy = "wfc.pf.route-terminal-boundary-contact.v1";
    internal readonly record struct Decision(bool Contact, bool Allowed, bool FirstBoundary, bool LastBoundary);

    internal static Decision Check(V first, V last, Triangle triangle, double guard, BarrierPoint? terminalFrom, BarrierPoint? terminalTo,
        Action<long> spend, CancellationToken token)
    {
        if (!terminalFrom.HasValue && !terminalTo.HasValue)
        { bool touches = Geometry.Touches(first, last, triangle, guard); return new(touches, !touches, false, false); }
        bool firstTerminal = Terminal(first), lastTerminal = Terminal(last), firstBoundary = false, lastBoundary = false, contactFound = false;
        bool? firstExact = null, lastExact = null;
        double magnitude = 1;
        foreach (var p in new[] { first, last, triangle.A, triangle.B, triangle.C })
            magnitude = Math.Max(magnitude, Math.Max(Math.Abs(p.X), Math.Max(Math.Abs(p.Y), Math.Abs(p.Z))));
        // Incidence guard only, not the collision tolerance. A point merely
        // inside the existing collision tolerance is never promoted to boundary.
        double incidence = 64 * Geometry.MachineEpsilon * magnitude;
        double normalLength = triangle.Normal.Length;
        bool coplanar = first != last && Math.Abs(V.Dot(first - triangle.A, triangle.Normal)) <= incidence * normalLength
            && Math.Abs(V.Dot(last - triangle.A, triangle.Normal)) <= incidence * normalLength;
        foreach (var contact in Geometry.SegmentContacts(first, last, triangle, guard))
        {
            contactFound = true;
            if (coplanar) return new(true, false, false, false);
            bool atFirst = firstTerminal && (contact.First - first).Length <= incidence && (contact.Second - first).Length <= incidence
                && (firstExact ??= Exact(first));
            bool atLast = lastTerminal && (contact.First - last).Length <= incidence && (contact.Second - last).Length <= incidence
                && (lastExact ??= Exact(last));
            if (!atFirst && !atLast) return new(true, false, false, false);
            firstBoundary |= atFirst; lastBoundary |= atLast;
        }
        return new(contactFound, true, firstBoundary, lastBoundary);

        bool Terminal(V p) => terminalFrom is { } a && p == new V(a) || terminalTo is { } b && p == new V(b);
        bool Exact(V p) => MixedDyadicSurfaceContact.Check(new(p.X,p.Y,p.Z), new(p.X,p.Y,p.Z),
            new(triangle.A.X,triangle.A.Y,triangle.A.Z),new(triangle.B.X,triangle.B.Y,triangle.B.Z),new(triangle.C.X,triangle.C.Y,triangle.C.Z),
            incidence, spend, token) == MixedExactSurfaceStatus.Contact;
    }
}
