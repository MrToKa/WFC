using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using AddinRibbon.Routing;

internal static class MeshClearanceTests
{
    internal static void Run(Action<string, Action> run)
    {
        run("Triangle face clearance retains independently verified surface witnesses", ParallelFaces);
        run("Triangle surface clearance is symmetric", Symmetry);
        run("Physical clearance above the cutoff remains disconnected", AboveCutoff);
        run("Physical clearance exactly at the cutoff is eligible", ExactCutoff);
        run("An edge piercing a triangle interior has zero physical clearance", Crossing);
        run("Coplanar overlapping triangle surfaces have zero clearance", CoplanarOverlap);
        run("Known rectangular bodies use empty clearance rather than centre spacing", BoxClearance);
        run("Coplanar disjoint triangles retain their real edge clearance", Disjoint);
        run("Measured body cap planes exclude protruding support hardware", Hardware);
        run("Measured body clipping preserves actual surfaces and distances", BodySurfaces);
        run("A bend clearance surface retains only its selected physical end", BendEnd);
        run("Contact with a remote bend body cannot authorize a different end", RemoteBendBody);
        run("A hollow profile remains open when its mesh is section-clipped", HollowProfile);
        run("Missing degenerate triangle evidence cannot assert a zero gap", Degenerate);
        run("Triangle build and query honor cancellation before returning a witness", Cancellation);
        run("Localized station queries preserve distinct tied parallel contacts", LocalStations);
        run("Routing qualifies by physical clearance while retaining raw cable centreline length", PhysicalGapGraph);
        run("Equal gap counts prefer the shorter physical clearance over the shorter axis jump", SurfaceGapOrdering);
        run("Parallel physical clearances retain the shortest contact at either overlap end", ParallelContactGraph);
        run("End-only mesh connections cannot bypass the middle of a bend", EndOnlyGraph);
        run("Cached surface misses respect changing cutoffs and exact minima", GlobalCacheCutoffs);
        run("Surface caches swap witnesses and distinguish new geometry instances", CacheIdentityAndReverse);
        run("Localized station caches include complete frames and dimensions", StationCacheValues);
        run("Cancellation remains effective on successful cached surface proofs", CachedCancellation);
        run("Per-surface peer and station proof caches remain bounded", BoundedCaches);
        run("Tied directional surface witnesses survive canonical and reciprocal cache lookups", TiedDirectionalContacts);
        run("Open-profile route length is independent of cold and reversed cache prewarming", TiedContactGraph);
    }

    private static RoutePoint P(double x, double y = 0, double z = 0) { return new RoutePoint(x, y, z); }
    private static void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static void Near(double expected, double actual, string message)
    { Assert(Math.Abs(expected - actual) < 1e-9, message + ": expected " + expected + ", got " + actual); }
    private static TrayMeshData Mesh(params RoutePoint[] points)
    { return new TrayMeshData(new[] { new TrayMeshFragment(points, Enumerable.Range(0, points.Length)) }); }
    private static TrayMeshClearance Surface(TrayMeshData mesh, IEnumerable<RouteConnectionPort> ports = null, bool ends = false)
    {
        TrayMeshClearance surface; string reason;
        Assert(TrayMeshClearance.TryCreate(mesh, ports, ends, CancellationToken.None, out surface, out reason), reason);
        return surface;
    }
    private static TrayMeshClearanceResult Distance(TrayMeshClearance first, TrayMeshClearance last, double cutoff = 10)
    {
        TrayMeshClearanceResult result;
        Assert(first.TryDistanceTo(last, cutoff, CancellationToken.None, out result), "Expected an eligible physical clearance.");
        Near(result.DistanceMeters, result.FirstPoint.DistanceTo(result.SecondPoint), "Surface witness distance");
        return result;
    }
    private static TrayMeshClearance Plane()
    { return Surface(Mesh(P(0, 0), P(4, 0), P(0, 4))); }
    private static TrayMeshClearance Parallel()
    { return Surface(Mesh(P(1, 1, 2), P(2, 1, 2), P(1, 2, 2))); }
    private static void ParallelFaces() { Near(2, Distance(Plane(), Parallel()).DistanceMeters, "Face interior minimum"); }
    private static void Symmetry() { Near(2, Distance(Parallel(), Plane()).DistanceMeters, "Reversed minimum"); }
    private static void AboveCutoff()
    { TrayMeshClearanceResult result; Assert(!Plane().TryDistanceTo(Parallel(), 1.999, CancellationToken.None, out result), "A larger physical gap was accepted."); }
    private static void ExactCutoff() { Near(2, Distance(Plane(), Parallel(), 2).DistanceMeters, "Cutoff boundary"); }
    private static void Crossing() { Near(0, Distance(Plane(), Surface(Mesh(P(1, 1, -1), P(1, 1, 1), P(2, 2, 1)))).DistanceMeters, "Piercing edge"); }
    private static void CoplanarOverlap() { Near(0, Distance(Plane(), Surface(Mesh(P(1, 1), P(2, 1), P(1, 2)))).DistanceMeters, "Coplanar overlap"); }
    private static void BoxClearance() { Near(.75, Distance(Surface(Box(0, 1, 0, 1, 0, 1)), Surface(Box(1.75, 2.75, 0, 1, 0, 1))).DistanceMeters, "Empty space between boxes"); }
    private static void Disjoint() { Near(1, Distance(Surface(Mesh(P(0, 0), P(1, 0), P(0, 1))), Surface(Mesh(P(2, 0), P(3, 0), P(2, 1)))).DistanceMeters, "Disjoint edge clearance"); }
    private static RouteConnectionPort Port(double x, bool first, double y = 0, double width = 2)
    { return new RouteConnectionPort(P(x, y), P(first ? -1 : 1), P(0, 1), P(0, 0, 1), width, 2); }
    private static void Hardware()
    {
        var body = Box(0, 2, -1, 1, -1, 1); var support = Box(2, 3, -.1, .1, -.1, .1);
        var clipped = Surface(new TrayMeshData(body.Fragments.Concat(support.Fragments)), new[] { Port(0, true), Port(2, false) });
        Assert(clipped.Maximum.X < 2.001, "Support beyond a measured cap plane entered the physical channel body.");
    }
    private static void BodySurfaces()
    { Near(1, Distance(Surface(Box(0, 2, -1, 1, -1, 1), new[] { Port(0, true), Port(2, false) }), Surface(Box(3, 4, -1, 1, -1, 1))).DistanceMeters, "Clipped body distance"); }
    private static void BendEnd()
    { var end = Surface(Box(0, 2, -1, 1, -1, 1), new[] { Port(0, true) }, true); Assert(end.Maximum.X <= .000251, "A selected physical end retained the bend body."); }
    private static void RemoteBendBody()
    {
        var end = Surface(Box(0, 2, -1, 1, -1, 1), new[] { Port(0, true) }, true);
        TrayMeshClearanceResult result;
        Assert(!end.TryDistanceTo(Surface(Box(2, 3, -.5, .5, -.5, .5)), 1, CancellationToken.None, out result), "A remote body contact authorized the wrong end.");
    }
    private static void HollowProfile()
    {
        var open = Surface(Mesh(P(0, -2, 0), P(0, -1, 0), P(0, -1, 1), P(0, 1, 0), P(0, 2, 0), P(0, 1, 1)),
            new[] { new RouteConnectionPort(P(0, 0, .5), P(1), P(0, 1), P(0, 0, 1), 4, 1) }, true);
        Near(1, Distance(open, Surface(Mesh(P(0, 0, .25), P(0, 0, .5), P(.01, 0, .25)))).DistanceMeters, "An open channel must not be filled with a bounding rectangle");
    }
    private static void Degenerate()
    {
        TrayMeshClearance surface; string reason;
        Assert(!TrayMeshClearance.TryCreate(Mesh(P(0), P(1), P(2)), null, false, CancellationToken.None, out surface, out reason), "Degenerate evidence asserted a usable surface.");
    }
    private static void Cancellation()
    {
        var first = Plane(); var last = Parallel();
        using (var cancelled = new CancellationTokenSource())
        {
            cancelled.Cancel(); bool queryStopped = false, buildStopped = false;
            try { TrayMeshClearanceResult result; first.TryDistanceTo(last, 10, cancelled.Token, out result); }
            catch (OperationCanceledException) { queryStopped = true; }
            try { TrayMeshClearance surface; string reason; TrayMeshClearance.TryCreate(Mesh(P(0), P(1), P(0, 1)), null, false, cancelled.Token, out surface, out reason); }
            catch (OperationCanceledException) { buildStopped = true; }
            Assert(queryStopped && buildStopped, "Cancelled geometry work returned instead of stopping.");
        }
    }
    private static TraySegment Body(string id, string code, RoutePoint first, RoutePoint last, TrayMeshData mesh, bool measured = false)
    {
        RouteConnectionPort[] ports = null;
        if (measured)
        {
            double length = first.DistanceTo(last);
            var direction = P((last.X - first.X) / length, (last.Y - first.Y) / length, (last.Z - first.Z) / length);
            var u = Math.Abs(direction.Z) > .9 ? P(1) : P(0, 1);
            var v = Math.Abs(direction.Z) > .9 ? P(0, 1) : P(0, 0, 1);
            var vertices = mesh.Fragments.SelectMany(f => f.Vertices).ToArray();
            Func<RoutePoint, RoutePoint, double> dot = (p, q) => p.X * q.X + p.Y * q.Y + p.Z * q.Z;
            double width = vertices.Max(p => dot(p, u)) - vertices.Min(p => dot(p, u));
            double height = vertices.Max(p => dot(p, v)) - vertices.Min(p => dot(p, v));
            ports = new[] { new RouteConnectionPort(first, P(-direction.X, -direction.Y, -direction.Z), u, v, width, height),
                new RouteConnectionPort(last, direction, u, v, width, height) };
        }
        return new TraySegment(id, code, CableCategory.Control, new[] { first, last }, false, ports, new[] { Surface(mesh, ports) });
    }
    private static RouteResult Route(IEnumerable<TraySegment> trays, RoutePoint first, RoutePoint last, double tolerance)
    { return new RouteCalculator().Calculate(trays, first, last, CableCategory.Control, new RoutingOptions { ConnectionToleranceMeters = tolerance }); }
    private static void LocalStations()
    {
        var first = Surface(Box(0, 10, -.2, .2, -.2, .2));
        var last = Surface(Box(0, 10, .9, 1.3, -.2, .2));
        foreach (double x in new[] { 0.0, 10.0 })
        {
            TrayMeshClearanceResult result;
            Assert(first.TryDistanceAtSections(last, Port(x, true, 0, .4), Port(x, true, 1.1, .4), 1,
                CancellationToken.None, out result), "Local section query lost a valid physical overlap contact.");
            Near(.7, result.DistanceMeters, "Localized physical clearance");
            Near(result.DistanceMeters, result.FirstPoint.DistanceTo(result.SecondPoint), "Localized witness distance");
            Assert(Math.Abs(result.FirstPoint.X - x) <= .000251 && Math.Abs(result.SecondPoint.X - x) <= .000251,
                "A local station borrowed a remote minimum witness.");
        }
    }
    private static void PhysicalGapGraph()
    {
        var a = Body("vertical", "/C001", P(0, 0, 0), P(0, 0, 2), Box(-.2, .2, -.2, .2, 0, 2), true);
        var b = Body("horizontal", "/C002", P(-1, 1.1, 1), P(1, 1.1, 1), Box(-1, 1, .9, 1.3, .8, 1.2), true);
        var route = Route(new[] { a, b }, P(0, 0, 1), P(0, 1.1, 1), 1);
        Assert(route.Success, route.Message); Assert(route.ConnectionGapCount == 1, "Expected one physical gap.");
        Near(.7, route.ConnectionGapLengthMeters, "Gap cost must use physical empty clearance");
        Near(route.LengthMeters, route.PathPoints.Zip(route.PathPoints.Skip(1), (p, q) => p.DistanceTo(q)).Sum(), "Cable length must retain actual centreline connector geometry");
        Near(1.1, route.LengthMeters, "The cable must retain its shortest actual1.1m axis connection when local physical gap rank is tied");
        Assert(!Route(new[] { a, b }, P(0, 0, 1), P(0, 1.1, 1), .699).Success, "Real physical clearance above the selected threshold was accepted.");
    }
    private static void SurfaceGapOrdering()
    {
        var start = Body("start", "/C010", P(0), P(1), Box(0, 1, -.1, .1, -.1, .1));
        var end = Body("end", "/C013", P(5), P(6), Box(5, 6, -.1, .1, -.1, .1));
        var wider = Body("physical-preference", "/C011", P(1.5), P(4.5), Box(1.2, 4.8, -.1, .1, -.1, .1));
        var narrow = Body("axis-preference", "/C012", P(1.3), P(4.7), Box(1.3, 4.7, -.1, .1, -.1, .1));
        var route = Route(new[] { start, wider, narrow, end }, P(0), P(6), .6);
        Assert(route.Success, route.Message);
        Assert(route.SegmentIds.SequenceEqual(new[] { "start", "physical-preference", "end" }), "The smaller surface-gap sum must win over the smaller axis-jump sum.");
        Near(.4, route.ConnectionGapLengthMeters, "Summed physical gap preference");
        Near(6, route.LengthMeters, "Physical cable length must retain both.5m axis jumps");
    }
    private static void ParallelContactGraph()
    {
        var a = Body("parallel-a", "/C020", P(0), P(10), Box(0, 10, -.2, .2, -.2, .2), true);
        var b = Body("parallel-b", "/C021", P(0, 1.1), P(10, 1.1), Box(0, 10, .9, 1.3, -.2, .2), true);
        foreach (double x in new[] { 0.0, 5.0, 10.0 })
        {
            var route = Route(new[] { a, b }, P(x), P(x, 1.1), 1);
            Assert(route.Success, route.Message);
            Near(.7, route.ConnectionGapLengthMeters, "Parallel physical clearance");
            Near(1.1, route.LengthMeters, "A tied minimum must preserve the nearest overlap-end cable connection");
        }
    }
    private static void EndOnlyGraph()
    {
        var points = new[] { P(0), P(2), P(2, 2), P(4, 2) };
        var startPort = Port(0, true); var endPort = Port(4, false, 2);
        var bendMesh = new TrayMeshData(Box(0, 2, -.1, .1, -.1, .1).Fragments.Concat(Box(2, 4, 1.9, 2.1, -.1, .1).Fragments));
        var bend = new TraySegment("port-only", "/C030", CableCategory.Control, points, true, new[] { startPort, endPort },
            new[] { Surface(bendMesh, new[] { startPort }, true), Surface(bendMesh, new[] { endPort }, true) });
        var branch = Body("side-branch", "/C031", P(1, .3), P(1, 1), Box(.9, 1.1, .2, 1, -.1, .1));
        Assert(!Route(new[] { bend, branch }, P(0), P(1, 1), .25).Success, "A close body-side surface must not bypass measured bend end sections.");
    }
    private static void GlobalCacheCutoffs()
    {
        var first = Plane(); var last = Parallel(); TrayMeshClearanceResult result;
        Assert(!first.TryDistanceTo(last, 1, CancellationToken.None, out result), "A small cutoff accepted a distant mesh.");
        Assert(!first.TryDistanceTo(last, .5, CancellationToken.None, out result), "A cached negative proof accepted a smaller cutoff.");
        Assert(first.DistanceSearchCount == 1, "A stronger negative proof must avoid repeating the triangle search.");
        Near(2, Distance(first, last, 3).DistanceMeters, "A larger cutoff must retry rather than reuse an incomplete negative proof");
        Assert(first.DistanceSearchCount == 2, "A larger cutoff failed to repeat the exact search.");
        Near(2, Distance(first, last, 2).DistanceMeters, "Cached exact cutoff boundary");
        Assert(!first.TryDistanceTo(last, 1, CancellationToken.None, out result), "A cached exact minimum ignored the requested smaller cutoff.");
        Assert(first.DistanceSearchCount == 2, "An exact minimum should cover every subsequent cutoff.");
        var proofMargin = Plane(); var proofPeer = Parallel();
        Assert(!proofMargin.TryDistanceTo(proofPeer, 2 - .0000005, CancellationToken.None, out result),
            "The internal directional proof margin must not enlarge the user's clearance tolerance.");
        Near(2, Distance(proofMargin, proofPeer, 2).DistanceMeters, "A completed directional minimum remains reusable at the exact actual cutoff");
        Assert(proofMargin.DistanceSearchCount == 1, "A proof-margin exact result repeated its completed search.");
    }
    private static void CacheIdentityAndReverse()
    {
        var first = Plane(); var last = Parallel(); var forward = Distance(first, last);
        var reverse = Distance(last, first);
        Near(0, forward.FirstPoint.DistanceTo(reverse.SecondPoint), "Reversed cached first witness");
        Near(0, forward.SecondPoint.DistanceTo(reverse.FirstPoint), "Reversed cached second witness");
        Assert(last.DistanceSearchCount == 0, "Reversed peer lookup should reuse the completed proof.");
        var changed = Surface(Mesh(P(1, 1, 3), P(2, 1, 3), P(1, 2, 3)));
        Near(3, Distance(first, changed).DistanceMeters, "A new geometry instance must not borrow an old minimum");
        Assert(first.DistanceSearchCount == 2, "Distinct geometry reused a proof from another mesh instance.");
    }
    private static void StationCacheValues()
    {
        var first = Surface(Box(0, 10, -.2, .2, -.2, .2)); var last = Surface(Box(0, 10, .9, 1.3, -.2, .2));
        TrayMeshClearanceResult result;
        Assert(!first.TryDistanceAtSections(last, Port(0, true, 0, .4), Port(0, true, 1.1, .4), .6, CancellationToken.None, out result), "A station gap above its cutoff was accepted.");
        Assert(!first.TryDistanceAtSections(last, Port(0, true, 0, .4), Port(0, true, 1.1, .4), .5, CancellationToken.None, out result), "A negative station proof ignored a smaller cutoff.");
        Assert(first.StationSearchCount == 1, "Identical station values in new port objects must reuse a proof.");
        Assert(first.TryDistanceAtSections(last, Port(0, true, 0, .4), Port(0, true, 1.1, .4), 1, CancellationToken.None, out result), "A larger station cutoff reused a negative proof incorrectly.");
        Near(.7, result.DistanceMeters, "Larger station cutoff minimum");
        Assert(first.StationSearchCount == 2, "Larger station cutoff must finish a new exact query.");
        Assert(last.TryDistanceAtSections(first, Port(0, true, 1.1, .4), Port(0, true, 0, .4), 1, CancellationToken.None, out result), "Reverse station proof disappeared.");
        Assert(last.StationSearchCount == 0, "Reverse station query repeated the completed proof.");
        Assert(first.TryDistanceAtSections(last, Port(10, true, 0, .4), Port(10, true, 1.1, .4), 1, CancellationToken.None, out result), "Changed station point query failed.");
        Assert(first.StationSearchCount == 3, "Changed station points borrowed a remote proof.");
        var flipped = new RouteConnectionPort(P(10), P(-1), P(0, -1), P(0, 0, 1), .4, 2);
        Assert(first.TryDistanceAtSections(last, flipped, Port(10, true, 1.1, .4), 1, CancellationToken.None, out result), "Changed frame query failed.");
        Assert(first.StationSearchCount == 4, "Changed station frames borrowed a differently oriented proof.");
        Assert(first.TryDistanceAtSections(last, Port(10, true, 0, .6), Port(10, true, 1.1, .4), 1, CancellationToken.None, out result), "Changed section dimensions query failed.");
        Assert(first.StationSearchCount == 5, "Changed section dimensions borrowed a different clipping proof.");
    }
    private static void CachedCancellation()
    {
        var first = Plane(); var last = Parallel(); Distance(first, last);
        var body = Surface(Box(0, 10, -.2, .2, -.2, .2)); var other = Surface(Box(0, 10, .9, 1.3, -.2, .2));
        TrayMeshClearanceResult result;
        Assert(body.TryDistanceAtSections(other, Port(0, true, 0, .4), Port(0, true, 1.1, .4), 1, CancellationToken.None, out result), "Station cache setup failed.");
        using (var source = new CancellationTokenSource())
        {
            source.Cancel(); bool globalStopped = false, localStopped = false;
            try { first.TryDistanceTo(last, 10, source.Token, out result); } catch (OperationCanceledException) { globalStopped = true; }
            try { body.TryDistanceAtSections(other, Port(0, true, 0, .4), Port(0, true, 1.1, .4), 1, source.Token, out result); } catch (OperationCanceledException) { localStopped = true; }
            Assert(globalStopped && localStopped, "A successful cached proof bypassed cancellation.");
            Assert(first.DistanceSearchCount == 1 && body.StationSearchCount == 1, "Cancelled cache hits started geometry work.");
        }
    }
    private static void BoundedCaches()
    {
        var first = Surface(Box(0, 1, -.2, .2, -.2, .2));
        for (int index = 0; index < 140; index++)
            Distance(first, Surface(Box(index + 2, index + 3, -.2, .2, -.2, .2)), 200);
        Assert(first.CachedPeerProofCount == 128, "Peer proofs must remain within their128-entry bound.");
        var body = Surface(Box(0, 300, -.2, .2, -.2, .2)); var other = Surface(Box(0, 300, .9, 1.3, -.2, .2));
        long before = body.EstimatedBytes;
        for (int index = 0; index < 270; index++)
        {
            TrayMeshClearanceResult result;
            Assert(body.TryDistanceAtSections(other, Port(index, true, 0, .4), Port(index, true, 1.1, .4), 1, CancellationToken.None, out result), "Station cache bound setup failed.");
        }
        Assert(body.CachedStationProofCount == 256, "Station proofs must remain within their256-entry bound.");
        Assert(body.EstimatedBytes - before < 200000, "Bounded proofs retained an excessive amount of additional memory.");
    }
    private static void TiedDirectionalContacts()
    {
        var trays = OpenProfiles(); var first = trays[0].ConnectionSurfaces[0]; var last = trays[1].ConnectionSurfaces[0];
        var forward = Distance(first, last, 1); var reverse = Distance(last, first, 1);
        Assert(forward.Contacts.Count == 2 && reverse.Contacts.Count == 2, "Physically distinct tied directional contacts were discarded.");
        Near(.6875, forward.DistanceMeters, "Exact open-profile surface minimum");
        Assert(Math.Abs(forward.Contacts[0].FirstPoint.Z - forward.Contacts[1].FirstPoint.Z) > .09,
            "The two measured contacts must preserve their distinct physical station heights.");
        for (int index = 0; index < forward.Contacts.Count; index++)
        {
            var a = forward.Contacts[index]; var b = reverse.Contacts[index];
            Near(a.DistanceMeters, a.FirstPoint.DistanceTo(a.SecondPoint), "Each witness must retain its own actual physical distance");
            Near(0, a.FirstPoint.DistanceTo(b.SecondPoint), "Reciprocal contact first witness");
            Near(0, a.SecondPoint.DistanceTo(b.FirstPoint), "Reciprocal contact second witness");
        }
        var independentlyBuilt = OpenProfiles();
        var prewarmed = Distance(independentlyBuilt[1].ConnectionSurfaces[0], independentlyBuilt[0].ConnectionSurfaces[0], 1);
        for (int index = 0; index < forward.Contacts.Count; index++)
        {
            Near(0, forward.Contacts[index].FirstPoint.DistanceTo(prewarmed.Contacts[index].SecondPoint), "Fresh reversed-first lookup must use canonical witnesses");
            Near(0, forward.Contacts[index].SecondPoint.DistanceTo(prewarmed.Contacts[index].FirstPoint), "Canonical physical contacts changed with first caller");
        }
    }
    private static void TiedContactGraph()
    {
        double baseline = 0;
        foreach (int mode in new[] { 0, 1, 2 })
        {
            var trays = OpenProfiles(); var first = trays[0].ConnectionSurfaces[0]; var last = trays[1].ConnectionSurfaces[0];
            if (mode == 1) Distance(first, last, 1);
            if (mode == 2) Distance(last, first, 1);
            var route = Route(trays, P(0, 0, 3), P(1.5, 1, .0625), 1);
            Assert(route.Success, route.Message);
            Near(.6875, route.ConnectionGapLengthMeters, "Both contact stations have the same measured physical gap");
            // Binary-exact profile coordinates give an upper physical contact at
            // z=.109375. The cable must not take the lower tied contact at .015625.
            Assert(route.PathPoints.Any(p => Math.Abs(p.X) < 1e-9 && Math.Abs(p.Y) < 1e-9 && Math.Abs(p.Z - .109375) < 1e-9),
                "The shortest cable did not use the upper tied physical contact.");
            if (mode == 0) baseline = route.LengthMeters;
            else Near(baseline, route.LengthMeters, "Cache prewarming changed the physical cable length");
            Near(route.LengthMeters, route.PathPoints.Zip(route.PathPoints.Skip(1), (a, b) => a.DistanceTo(b)).Sum(), "Reported cable length must equal its returned geometry");
            var reverse = Route(trays, P(1.5, 1, .0625), P(0, 0, 3), 1);
            Near(route.LengthMeters, reverse.LengthMeters, "Recalculated Reverse changed the physical shortest route");
        }
    }
    private static TraySegment[] OpenProfiles()
    {
        return TrayGeometryBuilder.Build(new[] {
            ProfileInput("open-vertical", "/B001", P(0), P(0, 0, 3), P(1), P(0, 1)),
            ProfileInput("open-horizontal", "/B002", P(-1.5, 1, .0625), P(1.5, 1, .0625), P(0, 1), P(0, 0, 1))
        }).Segments.ToArray();
    }
    private static TrayGeometryInput ProfileInput(string id, string name, RoutePoint start, RoutePoint end, RoutePoint u, RoutePoint v)
    {
        const double width = .5, rail = .03125, height = .125, bevel = .015625;
        double half = rail * .5, h = height * .5;
        var profile = new[] { new[] { -half, -h + bevel }, new[] { -half + bevel, -h }, new[] { half - bevel, -h },
            new[] { half, -h + bevel }, new[] { half, h - bevel }, new[] { half - bevel, h }, new[] { -half + bevel, h }, new[] { -half, h - bevel } };
        var fragments = new List<TrayMeshFragment>();
        foreach (int side in new[] { -1, 1 })
        {
            var vertices = new List<RoutePoint>(); var triangles = new List<int>();
            foreach (var endpoint in new[] { start, end })
                foreach (var point in profile)
                {
                    double x = side * (width - rail) * .5 + point[0], y = point[1];
                    vertices.Add(P(endpoint.X + u.X * x + v.X * y, endpoint.Y + u.Y * x + v.Y * y, endpoint.Z + u.Z * x + v.Z * y));
                }
            for (int index = 1; index < 7; index++) triangles.AddRange(new[] { 0, index, index + 1, 8, 8 + index + 1, 8 + index });
            for (int index = 0; index < 8; index++)
            { int next = (index + 1) % 8; triangles.AddRange(new[] { index, next, 8 + next, index, 8 + next, 8 + index }); }
            fragments.Add(new TrayMeshFragment(vertices, triangles));
        }
        var mesh = new TrayMeshData(fragments); var all = fragments.SelectMany(f => f.Vertices).ToArray();
        return new TrayGeometryInput(id, name, CableCategory.Control, "FTUBE",
            P(all.Min(p => p.X), all.Min(p => p.Y), all.Min(p => p.Z)),
            P(all.Max(p => p.X), all.Max(p => p.Y), all.Max(p => p.Z)), null, mesh);
    }
    private static TrayMeshData Box(double x0, double x1, double y0, double y1, double z0, double z1)
    {
        var points = new[] { P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1) };
        return new TrayMeshData(new[] { new TrayMeshFragment(points, new[] { 0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2 }) });
    }
}
