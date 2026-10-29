using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using AddinRibbon.Routing;

internal static class GeometryTests
{
    public static void Run(Action<string, Action> run)
    {
        run("Mesh-validated quarter bends in XY, XZ and YZ, with every turn orientation", PlanesAndTurns);
        run("Quarter bend length follows the arc and retains route categories", ArcLength);
        run("A rotated square elbow with unchanged bounds rejects obsolete ports", RotatedFaceEvidence);
        run("Missing mesh evidence or neighbouring straight arms cannot invent a bend", MissingEvidence);
        run("Ambiguous ports and unequal radii retain the fallback with diagnostics", UnsupportedFits);
        run("A small physical gap remains a gap after bend reconstruction", PhysicalGap);
        run("Only named elbows are fitted; axis fallback and cancellation are preserved", FallbackAndCancellation);
        run("Rotated three-dimensional straight meshes preserve physical ports and length", RotatedStraightMesh);
        run("An ambiguous short spool needs compatible neighboring physical ports", ShortSpoolMesh);
        run("Mesh straight fitting preserves small gaps and cable permissions", StraightMeshGapAndCategories);
        run("Circular mesh bends retain measured ports, tangent stubs and arbitrary turn angles", CircularMeshBends);
        run("A wide vertical bend and protruding cap hardware retain physical geometry", WideVerticalBendAndHardware);
        run("Circular mesh fitting preserves strict gaps and requires compatible neighboring arms", CircularMeshGapAndEvidence);
        run("Excessive repeated cap pairs cannot validate an incomplete straight candidate set", StraightCandidateLimit);
        run("Unproved centerlines can retain exact raw mesh clearance with a length diagnostic", RawSurfaceFallback);
        run("Measured bend policy is explicit and legacy miter behavior is retained", MeasuredMiterPolicy);
        run("Measured miter flanges survive rotation and input-output reversal", MeasuredMiterRotation);
        run("Missing measured flange material and decorative planes cannot invent a miter", MeasuredMiterMissingSupport);
        run("Competing supported miter chains and centreline material refuse fitting", MeasuredMiterAmbiguity);
        run("Measured terminal caps preserve circular guards and real attachment gaps", MeasuredTerminalCaps);
        run("Incomplete measured cap domains cannot be mistaken for a unique bend", MeasuredCapDomainLimit);
        run("Repeated exact cap contexts reuse only complete proofs within the same work ceiling", MeasuredCapCacheEquivalence);
        run("Exact direction selections preserve rotated circular caps and original triangle order", MeasuredDirectionIndexEquivalence);
    }

    private static void PlanesAndTurns()
    {
        foreach (var axes in new[] { new[] { 0, 1 }, new[] { 0, 2 }, new[] { 1, 2 } })
            foreach (int firstSign in new[] { -1, 1 })
                foreach (int secondSign in new[] { -1, 1 })
                {
                    var fixture = Create(axes[0], axes[1], firstSign, secondSign);
                    var result = TrayGeometryBuilder.Build(fixture.Inputs);
                    Assert(result.ValidatedBends == 1 && result.FallbackBends == 0, "A supported turn must have one validated bend.");
                    var arc = result.Segments[0].Points;
                    Assert(arc.Count == 19, "The quarter turn must retain all five-degree samples.");
                    Near(0, arc[0].DistanceTo(fixture.Start), 0.000001, "First physical mesh port.");
                    Near(0, arc[arc.Count - 1].DistanceTo(fixture.End), 0.000001, "Last physical mesh port.");
                    foreach (var point in arc)
                        Near(1, point.DistanceTo(fixture.Centre), 0.000001, "Each sample must remain on the quarter circle.");
                    Near(Math.PI * 0.5, Length(arc), 0.001, "Every plane and turn needs the same arc length.");
                }
    }

    private static void ArcLength()
    {
        var fixture = Create(0, 1, 1, -1);
        var built = TrayGeometryBuilder.Build(fixture.Inputs);
        var bend = built.Segments[0];
        Assert(bend.AllowedCategories == (CableCategory.LV | CableCategory.Control), "Geometry must preserve category permissions.");
        Assert(bend.Id == "bend" && bend.RouteCode == "/B002", "Geometry must preserve routing identifiers and codes.");
        double arcLength = Length(bend.Points);
        Assert(arcLength > fixture.Start.DistanceTo(fixture.End) + 0.15, "A straight chord must not replace the physical quarter arc.");
        var route = new RouteCalculator().Calculate(built.Segments, fixture.From, fixture.To, CableCategory.LV,
            new RoutingOptions { ConnectionToleranceMeters = 0.00001 });
        Assert(route.Success, route.Message);
        Near(4 + Math.PI * 0.5, route.LengthMeters, 0.001, "Routing must retain both straight arms and the bend length.");
        Assert(route.RouteText == "/B001/B002/B003", "The curve must connect the ordered route names.");
    }

    private static void RotatedFaceEvidence()
    {
        var fixture = Create(0, 1, 1, 1);
        var original = fixture.Inputs[0];
        var rotated = RotateFaces(original, 0, 1);
        var replacement = Input(original.Id, original.RouteName, original.ShapeName, original.Minimum, original.Maximum, rotated);
        var built = TrayGeometryBuilder.Build(new[] { replacement, fixture.Inputs[1], fixture.Inputs[2] });
        Assert(built.ValidatedBends == 0 && built.FallbackBends == 1, "Unchanged box bounds must not conceal changed physical openings.");
        Assert(built.Segments[0].Points.Count == 2, "Unsupported evidence must retain the fallback.");
        var shifted = original.FaceExtents.Select(face => new TrayFaceExtent(face.Face,
            Shift(face.Minimum, (int)face.Face / 2 == 0 ? 1 : 0, -0.1),
            Shift(face.Maximum, (int)face.Face / 2 == 0 ? 1 : 0, -0.1), face.SampleCount));
        replacement = Input(original.Id, original.RouteName, original.ShapeName, original.Minimum, original.Maximum, shifted);
        built = TrayGeometryBuilder.Build(new[] { replacement, fixture.Inputs[1], fixture.Inputs[2] });
        Assert(built.ValidatedBends == 0, "A neighbouring endpoint must match the occupied face centre.");
    }

    private static void MissingEvidence()
    {
        var fixture = Create(0, 2, 1, -1);
        var bend = fixture.Inputs[0];
        var missing = Input(bend.Id, bend.RouteName, bend.ShapeName, bend.Minimum, bend.Maximum);
        var result = TrayGeometryBuilder.Build(new[] { missing, fixture.Inputs[1], fixture.Inputs[2] });
        Assert(result.ValidatedBends == 0 && result.Diagnostics[0].Contains("unavailable"), "No mesh evidence must be reported.");
        result = TrayGeometryBuilder.Build(new[] { bend });
        Assert(result.ValidatedBends == 0, "Mesh evidence alone cannot infer physical connectivity.");
        result = TrayGeometryBuilder.Build(new[] { bend, fixture.Inputs[1] });
        Assert(result.ValidatedBends == 0, "One arm is insufficient.");
        var undersampled = bend.FaceExtents.Select(f => new TrayFaceExtent(f.Face, f.Minimum, f.Maximum, 2));
        var sparse = Input(bend.Id, bend.RouteName, bend.ShapeName, bend.Minimum, bend.Maximum, undersampled);
        result = TrayGeometryBuilder.Build(new[] { sparse, fixture.Inputs[1], fixture.Inputs[2] });
        Assert(result.ValidatedBends == 0, "An isolated face point is insufficient to identify a port.");
        var tangentBands = bend.FaceExtents.Select(f =>
        {
            int perpendicular = (int)f.Face / 2 == 0 ? 2 : 0;
            return new TrayFaceExtent(f.Face, Shift(f.Minimum, perpendicular, 0.18), Shift(f.Maximum, perpendicular, -0.18), 30);
        });
        var narrow = Input(bend.Id, bend.RouteName, bend.ShapeName, bend.Minimum, bend.Maximum, tangentBands);
        result = TrayGeometryBuilder.Build(new[] { narrow, fixture.Inputs[1], fixture.Inputs[2] });
        Assert(result.ValidatedBends == 0, "A narrow vertex band must match the neighbouring arm cross-section to count as a port.");
    }

    private static void UnsupportedFits()
    {
        var fixture = Create(0, 1, 1, 1);
        var bend = fixture.Inputs[0];
        var rotated = RotateFaces(bend, 0, 1).ToArray();
        var allFaces = Input(bend.Id, bend.RouteName, bend.ShapeName, bend.Minimum, bend.Maximum, bend.FaceExtents.Concat(rotated));
        var extraArms = rotated.Select((face, index) =>
        {
            int axis = (int)face.Face / 2;
            var centre = Midpoint(face.Minimum, face.Maximum);
            var outside = Shift(centre, axis, (int)face.Face % 2 == 0 ? -2 : 2);
            return Straight("extra" + index, "/B004", centre, outside, axis, 2);
        });
        var result = TrayGeometryBuilder.Build(new[] { allFaces, fixture.Inputs[1], fixture.Inputs[2] }.Concat(extraArms));
        Assert(result.ValidatedBends == 0 && result.Diagnostics[0].Contains("ambiguous"), "Multiple possible turns must be rejected.");
        var changedFace = bend.FaceExtents.Select(f => (int)f.Face / 2 == 1
            ? new TrayFaceExtent(f.Face, Shift(f.Minimum, 0, -0.05), Shift(f.Maximum, 0, -0.05), f.SampleCount) : f).ToArray();
        var unequal = Input(bend.Id, bend.RouteName, bend.ShapeName, bend.Minimum, bend.Maximum, changedFace);
        var movedEnd = Shift(fixture.End, 0, -0.05);
        var movedArm = Straight("out", "/B003", movedEnd, Shift(movedEnd, 1, -2), 1, 2);
        result = TrayGeometryBuilder.Build(new[] { unequal, fixture.Inputs[1], movedArm });
        Assert(result.ValidatedBends == 0, "Unequal radial offsets cannot be called a circular bend.");
        var thick = Input("bend", "/B002", "ELBOW", Shift(bend.Minimum, 2, -1), Shift(bend.Maximum, 2, 1), bend.FaceExtents);
        result = TrayGeometryBuilder.Build(new[] { thick, fixture.Inputs[1], fixture.Inputs[2] });
        Assert(result.ValidatedBends == 0, "A non-planar shape must not be fitted.");
    }

    private static void PhysicalGap()
    {
        var fixture = Create(0, 1, 1, 1);
        double gap = 0.015;
        var gapStart = Shift(fixture.Start, 0, -gap);
        var gapped = Straight("in", "/B001", gapStart, fixture.From, 0, 2);
        var result = TrayGeometryBuilder.Build(new[] { fixture.Inputs[0], gapped, fixture.Inputs[2] });
        Assert(result.ValidatedBends == 1, "A near neighbour can validate a physical mesh port.");
        Near(gap, result.Segments[0].Points[0].DistanceTo(gapStart), 0.000001, "The curve must retain its own physical endpoint.");
        var route = new RouteCalculator().Calculate(result.Segments, fixture.From, fixture.To, CableCategory.LV,
            new RoutingOptions { ConnectionToleranceMeters = 0.005 });
        Assert(!route.Success, "Geometry reconstruction must not bypass the configured strict gap limit.");
        var absent = Straight("in", "/B001", Shift(fixture.Start, 0, -0.03), fixture.From, 0, 2);
        result = TrayGeometryBuilder.Build(new[] { fixture.Inputs[0], absent, fixture.Inputs[2] });
        Assert(result.ValidatedBends == 0, "An endpoint outside the tight fitting tolerance cannot validate an arm.");
    }

    private static void FallbackAndCancellation()
    {
        var fixture = Create(1, 2, -1, -1);
        var bend = fixture.Inputs[0];
        var unnamed = Input(bend.Id, bend.RouteName, "unidentified geometry", bend.Minimum, bend.Maximum, bend.FaceExtents);
        var result = TrayGeometryBuilder.Build(new[] { unnamed, fixture.Inputs[1], fixture.Inputs[2] });
        Assert(result.ValidatedBends == 0 && result.FallbackBends == 0, "Only positively named bends may be fitted.");
        Assert(result.Segments[0].Points.Count == 2, "The existing straight fallback must remain available.");
        Assert(!TrayGeometryBuilder.IsBendOrElbow("BENDING support"), "A substring must not classify a bend.");
        Assert(TrayGeometryBuilder.IsBendOrElbow("ELBOW 1") && TrayGeometryBuilder.IsBendOrElbow("BEND 2"), "Known shape tokens must be accepted.");
        Assert(TrayGeometryBuilder.IsBendOrElbow("/BEND_30_1_of_PIPE_X") && TrayGeometryBuilder.IsStraight("/FTUBE_1"), "Underscores delimit semantic shape tokens.");
        using (var cancellation = new CancellationTokenSource())
        {
            cancellation.Cancel();
            try { TrayGeometryBuilder.Build(fixture.Inputs, cancellation.Token); }
            catch (OperationCanceledException) { return; }
            throw new InvalidOperationException("Cancelled geometry work must stop.");
        }
    }

    private static void RotatedStraightMesh()
    {
        var first = new RoutePoint(0, 0, 0);
        var direction = new TrayMeshGeometry.Vec(1, 2, 3).Unit;
        var last = (new TrayMeshGeometry.Vec(first) + direction * 5).Point;
        var input = MeshInput("mesh-straight", "/B001", "FTUBE_1", RailMesh(first, last, 0.64, 0.1));
        var built = TrayGeometryBuilder.Build(new[] { input });
        Assert(built.ValidatedStraights == 1 && built.FallbackStraights == 0, "A uniquely elongated mesh must validate the extrusion direction.");
        var line = built.Segments[0];
        Near(5, Length(line.Points), 0.000001, "A rotated world box must not shorten the real straight.");
        Near(0, Math.Min(line.Points[0].DistanceTo(first), line.Points[1].DistanceTo(first)), 0.000001, "First mesh port must stay at the physical end.");
        Near(0, Math.Min(line.Points[0].DistanceTo(last), line.Points[1].DistanceTo(last)), 0.000001, "Last mesh port must stay at the physical end.");
        Assert(line.AllowedCategories == (CableCategory.LV | CableCategory.Control), "Detached geometry must retain permissions.");
    }

    private static void ShortSpoolMesh()
    {
        var spool = MeshInput("spool", "/B002", "FTUBE_2", RailMesh(new RoutePoint(3, 0, 0), new RoutePoint(3.238, 0, 0), 0.64, 0.1));
        var isolated = TrayGeometryBuilder.Build(new[] { spool });
        Assert(isolated.ValidatedStraights == 0 && isolated.FallbackStraights == 1, "The short spool's matching height planes must not be mistaken for its axis.");
        Assert(isolated.Diagnostics.Count > 0, "An unresolved mesh ambiguity must be reported.");
        var arm = MeshInput("arm", "/B001", "FTUBE_1", RailMesh(new RoutePoint(0, 0, 0), new RoutePoint(3, 0, 0), 0.64, 0.1));
        var built = TrayGeometryBuilder.Build(new[] { spool, arm });
        Assert(built.ValidatedStraights == 2 && built.FallbackStraights == 0, "Matching opposed ports of a proven arm must resolve the short spool.");
        Near(0.238, Length(built.Segments[0].Points), 0.000001, "A spool wider than its length must retain the measured extrusion length.");
        var route = new RouteCalculator().Calculate(built.Segments, new RoutePoint(0, 0, 0), new RoutePoint(3.238, 0, 0), CableCategory.LV,
            new RoutingOptions { ConnectionToleranceMeters = 0.00001, PreferVerticalApproach = false });
        Assert(route.Success && route.RouteText == "/B001/B002", "The mesh-resolved spool must join its actual arm.");
        Near(3.238, route.LengthMeters, 0.000001, "Physical cable length must include the complete short spool.");
    }

    private static void StraightMeshGapAndCategories()
    {
        var arm = MeshInput("arm", "/B001", "FTUBE", RailMesh(new RoutePoint(0, 0, 0), new RoutePoint(3, 0, 0), 0.64, 0.1));
        var spool = MeshInput("spool", "/B002", "FTUBE", RailMesh(new RoutePoint(3.015, 0, 0), new RoutePoint(3.253, 0, 0), 0.64, 0.1));
        var built = TrayGeometryBuilder.Build(new[] { arm, spool });
        Assert(built.ValidatedStraights == 2, "A nearby matching physical port may validate a spool.");
        Near(0.015, built.Segments[0].Points.Min(p => built.Segments[1].Points.Min(q => p.DistanceTo(q))), 0.000001, "Geometry fitting must preserve a real gap.");
        var route = new RouteCalculator().Calculate(built.Segments, new RoutePoint(0, 0, 0), new RoutePoint(3.253, 0, 0), CableCategory.LV,
            new RoutingOptions { ConnectionToleranceMeters = 0.005, PreferVerticalApproach = false });
        Assert(!route.Success, "Mesh fitting must not bridge a gap beyond the configured limit.");
        var controlArm = new TrayGeometryInput(arm.Id, arm.RouteName, CableCategory.Control, arm.ShapeName, arm.Minimum, arm.Maximum, null, arm.Mesh);
        var lvSpool = new TrayGeometryInput(spool.Id, spool.RouteName, CableCategory.LV, spool.ShapeName, spool.Minimum, spool.Maximum, null, spool.Mesh);
        built = TrayGeometryBuilder.Build(new[] { controlArm, lvSpool });
        Assert(built.ValidatedStraights == 1 && built.FallbackStraights == 1, "A forbidden-category arm cannot resolve an ambiguous spool.");
    }

    private static void StraightCandidateLimit()
    {
        var fragments = Enumerable.Range(0, 11).SelectMany(index => RailMesh(
            new RoutePoint(index * 0.04, 0, 0), new RoutePoint(index * 0.04 + 0.02, 0, 0), 0.64, 0.1).Fragments);
        var input = MeshInput("repeated-caps", "/B001", "FTUBE", new TrayMeshData(fragments));
        var built = TrayGeometryBuilder.Build(new[] { input });
        Assert(built.ValidatedStraights == 0 && built.FallbackStraights == 1,
            "Stopping at a cap-pair limit must not turn an incomplete set into a unique accepted fit.");
        Assert(built.Diagnostics.Any(message => message.Contains("too many measured cap pairs")),
            "The rejected complexity limit must be reported explicitly.");
    }

    private static void RawSurfaceFallback()
    {
        var mesh = RailMesh(new RoutePoint(0, 0, 0), new RoutePoint(3, 0, 0), 0.64, 0.1);
        var unknown = MeshInput("unknown", "/B001", "unidentified tray geometry", mesh);
        var built = TrayGeometryBuilder.Build(new[] { unknown });
        Assert(built.ValidatedStraights == 0 && built.ValidatedBends == 0 && built.FallbackClearances == 0,
            "An unclassified shape may retain actual triangle clearance without claiming a proven centerline.");
        Assert(built.Segments[0].VerifiedPorts.Count == 0 && built.Segments[0].ConnectionSurfaces.Count == 1,
            "The raw surface must not invent measured end sections.");
        Assert(built.Diagnostics.Any(message => message.Contains("no validated tray centerline")),
            "Exact surface clearance must not conceal approximate cable length.");
        var unsupportedBend = MeshInput("unsupported", "/B002", "BEND", mesh);
        built = TrayGeometryBuilder.Build(new[] { unsupportedBend });
        Assert(built.FallbackBends == 1 && built.FallbackClearances == 0 && built.Segments[0].ConnectionSurfaces.Count == 1,
            "An unproved bend may retain the original surface without fitting a fictitious curve.");
        var noMesh = Input("absent", "/B003", "unidentified tray geometry", unknown.Minimum, unknown.Maximum);
        built = TrayGeometryBuilder.Build(new[] { noMesh });
        Assert(built.FallbackClearances == 1 && built.Segments[0].ConnectionSurfaces.Count == 0,
            "Missing actual triangles must expose centerline-clearance fallback.");
    }

    private static TrayGeometryInput MeshInput(string id, string route, string shape, TrayMeshData mesh)
    {
        var vertices = mesh.Fragments.SelectMany(f => f.Vertices).ToArray();
        return new TrayGeometryInput(id, route, CableCategory.LV | CableCategory.Control, shape,
            new RoutePoint(vertices.Min(p => p.X), vertices.Min(p => p.Y), vertices.Min(p => p.Z)),
            new RoutePoint(vertices.Max(p => p.X), vertices.Max(p => p.Y), vertices.Max(p => p.Z)), null, mesh);
    }

    private static void CircularMeshBends()
    {
        foreach (double degrees in new[] { 30.0, 90.0 })
        {
            var fixture = CircularMeshFixture(degrees, false, false);
            var built = TrayGeometryBuilder.Build(fixture.Inputs);
            Assert(built.ValidatedBends == 1 && built.ValidatedStraights == 2, "The circular surfaces and compatible cap sections must validate all three pieces: " + string.Join("; ", built.Diagnostics));
            var bend = built.Segments[0];
            Assert(bend.ConnectionsAtEndsOnly && bend.VerifiedPorts.Count == 2, "A measured bend must expose only its proven physical end sections.");
            Near(0, bend.Points.Min(p => p.DistanceTo(fixture.Start)), 0.000001, "The first cap stays at its own measured coordinate.");
            Near(0, bend.Points.Min(p => p.DistanceTo(fixture.End)), 0.000001, "The final cap stays at its own measured coordinate.");
            double radians = degrees * Math.PI / 180;
            Near(0.2 + radians, Length(bend.Points), 0.001, "The curve must retain both unequal tangent stubs and the circular arc.");
            var route = new RouteCalculator().Calculate(built.Segments, fixture.From, fixture.To, CableCategory.Control,
                new RoutingOptions { ConnectionToleranceMeters = 0.25, PreferVerticalApproach = false });
            Assert(route.Success && route.RouteText == "/B001/B002/B003", "Only the measured circular corridor can connect the three pieces.");
            Near(6.2 + radians, route.LengthMeters, 0.001, "Connection tolerance must not cut across internal arc samples.");
            Assert(route.ConnectionGapCount == 0 && route.ConnectionGapLengthMeters == 0, "Matching proven physical ports must remain continuous.");
            foreach (var point in bend.Points)
                Assert(route.PathPoints.Any(p => p.DistanceTo(point) < 0.000001), "The complete curve and both stubs must remain in the selected path.");
        }
    }

    private static void WideVerticalBendAndHardware()
    {
        var fixture = CircularMeshFixture(30, true, true);
        var built = TrayGeometryBuilder.Build(fixture.Inputs);
        Assert(built.ValidatedBends == 1 && built.ValidatedStraights == 2, "A wide vertical turn and a cap inside a hardware envelope need actual mesh evidence: " + string.Join("; ", built.Diagnostics));
        var bend = built.Segments[0];
        Near(0.2 + Math.PI / 6, Length(bend.Points), 0.001, "Extrusion width must not replace the bend plane.");
        Near(0, bend.Points.Min(p => p.DistanceTo(fixture.Start)), 0.000001, "Hardware must not move the first cap to the world-box extreme.");
        Near(0, bend.Points.Min(p => p.DistanceTo(fixture.End)), 0.000001, "Hardware must not move the final cap.");
    }

    private static void CircularMeshGapAndEvidence()
    {
        var fixture = CircularMeshFixture(30, false, false);
        var incoming = fixture.Inputs[1];
        var direction = (new TrayMeshGeometry.Vec(fixture.Start) - new TrayMeshGeometry.Vec(fixture.From)).Unit;
        var shifted = MeshInput("in", "/B001", "FTUBE", RailMesh(fixture.From,
            (new TrayMeshGeometry.Vec(fixture.Start) - direction * 0.015).Point, 0.64, 0.1));
        var built = TrayGeometryBuilder.Build(new[] { fixture.Inputs[0], shifted, fixture.Inputs[2] });
        Assert(built.ValidatedBends == 1, "A compatible near arm may validate the bend without supplying its port position.");
        Near(0, built.Segments[0].Points.Min(p => p.DistanceTo(fixture.Start)), 0.000001, "The physical cap must not snap across a gap.");
        var route = new RouteCalculator().Calculate(built.Segments, fixture.From, fixture.To, CableCategory.Control,
            new RoutingOptions { ConnectionToleranceMeters = 0.005, PreferVerticalApproach = false });
        Assert(!route.Success, "A fifteen-millimetre physical gap must fail a five-millimetre limit.");
        route = new RouteCalculator().Calculate(built.Segments, fixture.From, fixture.To, CableCategory.Control,
            new RoutingOptions { ConnectionToleranceMeters = 0.02, PreferVerticalApproach = false });
        Assert(route.Success && route.ConnectionGapCount == 1, "A permitted real gap must remain counted.");
        Near(0.015, route.ConnectionGapLengthMeters, 0.000001, "Measured ports cannot hide real gap length.");
        var missing = TrayGeometryBuilder.Build(new[] { fixture.Inputs[0], fixture.Inputs[1] });
        Assert(missing.ValidatedBends == 0 && missing.FallbackBends == 1, "One neighboring arm cannot prove both physical ports.");
        var incompatible = new TrayGeometryInput(incoming.Id, incoming.RouteName, CableCategory.MV, incoming.ShapeName,
            incoming.Minimum, incoming.Maximum, null, incoming.Mesh);
        var forbidden = TrayGeometryBuilder.Build(new[] { fixture.Inputs[0], incompatible, fixture.Inputs[2] });
        Assert(forbidden.ValidatedBends == 0, "Disjoint permissions cannot provide connectivity evidence.");
    }

    private static Fixture CircularMeshFixture(double degrees, bool vertical, bool hardware)
    {
        double sweep = degrees * Math.PI / 180;
        var start = new TrayMeshGeometry.Vec(1, -0.08, 0);
        var incoming = new TrayMeshGeometry.Vec(0, 1, 0);
        var radialEnd = new TrayMeshGeometry.Vec(Math.Cos(sweep), Math.Sin(sweep), 0);
        var outgoing = new TrayMeshGeometry.Vec(-Math.Sin(sweep), Math.Cos(sweep), 0);
        var end = radialEnd + outgoing * 0.12;
        Func<TrayMeshGeometry.Vec, TrayMeshGeometry.Vec> transform = p => vertical
            ? new TrayMeshGeometry.Vec(10 + p.X, 20 + p.Z, 30 + p.Y)
            : new TrayMeshGeometry.Vec(10 + p.X, 20 + p.Y, 30 + p.Z);
        var mesh = SweptRailMesh(sweep, transform);
        if (hardware)
        {
            // An unrelated support extends behind the complete physical cap;
            // it must affect bounds without supplying a new compatible opening.
            var support = TransformMesh(RailMesh((start - incoming * 0.15).Point,
                (start - incoming * 0.1).Point, 0.04, 0.025), transform);
            mesh = new TrayMeshData(mesh.Fragments.Concat(support.Fragments));
        }
        return new Fixture
        {
            Start = transform(start).Point, End = transform(end).Point,
            From = transform(start - incoming * 3).Point, To = transform(end + outgoing * 3).Point,
            Inputs = new[] {
                MeshInput("bend", "/B002", "BEND_" + degrees, mesh),
                MeshInput("in", "/B001", "FTUBE", TransformMesh(RailMesh((start - incoming * 3).Point, start.Point, 0.64, 0.1), transform)),
                MeshInput("out", "/B003", "FTUBE", TransformMesh(RailMesh(end.Point, (end + outgoing * 3).Point, 0.64, 0.1), transform)) }
        };
    }

    private static TrayMeshData TransformMesh(TrayMeshData mesh, Func<TrayMeshGeometry.Vec, TrayMeshGeometry.Vec> transform)
    {
        return new TrayMeshData(mesh.Fragments.Select(f => new TrayMeshFragment(
            f.Vertices.Select(p => transform(new TrayMeshGeometry.Vec(p)).Point), f.TriangleIndices)));
    }

    private static TrayMeshData SweptRailMesh(double sweep, Func<TrayMeshGeometry.Vec, TrayMeshGeometry.Vec> transform)
    {
        var centers = new List<TrayMeshGeometry.Vec> { new TrayMeshGeometry.Vec(1, -0.08, 0) };
        var across = new List<TrayMeshGeometry.Vec> { new TrayMeshGeometry.Vec(1, 0, 0) };
        int steps = (int)Math.Round(sweep / (Math.PI / 36));
        for (int step = 0; step <= steps; step++)
        {
            double angle = sweep * step / steps;
            var radial = new TrayMeshGeometry.Vec(Math.Cos(angle), Math.Sin(angle), 0);
            centers.Add(radial); across.Add(radial);
        }
        var endRadial = across[across.Count - 1];
        centers.Add(endRadial + new TrayMeshGeometry.Vec(-Math.Sin(sweep), Math.Cos(sweep), 0) * 0.12);
        across.Add(endRadial);
        const double width = 0.64, rail = 0.022, height = 0.1, bevel = 0.005;
        double half = rail * 0.5, h = height * 0.5;
        var profile = new[] { new[] { -half, -h + bevel }, new[] { -half + bevel, -h },
            new[] { half - bevel, -h }, new[] { half, -h + bevel }, new[] { half, h - bevel },
            new[] { half - bevel, h }, new[] { -half + bevel, h }, new[] { -half, h - bevel } };
        var fragments = new List<TrayMeshFragment>();
        foreach (int side in new[] { -1, 1 })
        {
            var vertices = new List<RoutePoint>(); var triangles = new List<int>();
            for (int row = 0; row < centers.Count; row++)
                foreach (var point in profile)
                    vertices.Add(transform(centers[row] + across[row] * (side * (width - rail) * 0.5 + point[0])
                        + new TrayMeshGeometry.Vec(0, 0, point[1])).Point);
            int last = (centers.Count - 1) * 8;
            for (int i = 1; i < 7; i++) { triangles.AddRange(new[] { 0, i, i + 1, last, last + i + 1, last + i }); }
            for (int row = 0; row < centers.Count - 1; row++)
                for (int i = 0; i < 8; i++)
                {
                    int first = row * 8 + i, next = row * 8 + (i + 1) % 8;
                    triangles.AddRange(new[] { first, next, next + 8, first, next + 8, first + 8 });
                }
            fragments.Add(new TrayMeshFragment(vertices, triangles));
        }
        return new TrayMeshData(fragments);
    }

    // Two bevelled longitudinal rails give genuinely ambiguous matching height
    // caps. Only neighboring physical-port evidence identifies a short spool.
    private static TrayMeshData RailMesh(RoutePoint start, RoutePoint end, double width, double height)
    {
        var origin = new TrayMeshGeometry.Vec(start);
        var direction = (new TrayMeshGeometry.Vec(end) - origin).Unit;
        double length = start.DistanceTo(end);
        var up = Math.Abs(direction.Z) < 0.9 ? new TrayMeshGeometry.Vec(0, 0, 1) : new TrayMeshGeometry.Vec(0, 1, 0);
        up = (up - direction * TrayMeshGeometry.Vec.Dot(up, direction)).Unit;
        var across = TrayMeshGeometry.Vec.Cross(up, direction).Unit;
        const double rail = 0.022, bevel = 0.005;
        double half = rail * 0.5, h = height * 0.5;
        var profile = new[] { new[] { -half, -h + bevel }, new[] { -half + bevel, -h },
            new[] { half - bevel, -h }, new[] { half, -h + bevel }, new[] { half, h - bevel },
            new[] { half - bevel, h }, new[] { -half + bevel, h }, new[] { -half, h - bevel } };
        var fragments = new List<TrayMeshFragment>();
        foreach (int side in new[] { -1, 1 })
        {
            var vertices = new List<RoutePoint>(); var triangles = new List<int>();
            for (int port = 0; port < 2; port++)
                foreach (var point in profile)
                    vertices.Add((origin + direction * (port * length) + across * (side * (width - rail) * 0.5 + point[0]) + up * point[1]).Point);
            for (int i = 1; i < 7; i++) { triangles.AddRange(new[] { 0, i, i + 1 }); triangles.AddRange(new[] { 8, 8 + i + 1, 8 + i }); }
            for (int i = 0; i < 8; i++)
            {
                int next = (i + 1) % 8;
                triangles.AddRange(new[] { i, next, 8 + next, i, 8 + next, 8 + i });
            }
            fragments.Add(new TrayMeshFragment(vertices, triangles));
        }
        return new TrayMeshData(fragments);
    }

    private static Fixture MeasuredFixture(Func<TrayMeshGeometry.Vec, TrayMeshGeometry.Vec> transform = null,
        Func<int, int, int, bool> include = null, bool secondChain = false, bool decorativeOnly = false)
    {
        transform = transform ?? (p => p);
        var p0 = new TrayMeshGeometry.Vec(0, 0, 0); var p1 = new TrayMeshGeometry.Vec(.35, .35, 0);
        var points = new[] { p0, new TrayMeshGeometry.Vec(.21, 0, 0), new TrayMeshGeometry.Vec(.35, .14, 0), p1 };
        var mesh = MeasuredSweep(points, true, include, transform);
        if (secondChain)
        {
            var alternate = MeasuredSweep(new[] { p0, new TrayMeshGeometry.Vec(.15, 0, 0), new TrayMeshGeometry.Vec(.35, .20, 0), p1 }, false,
                decorativeOnly ? (Func<int, int, int, bool>)((rail, run, edge) => rail == -1 && run == 1) : null, transform);
            mesh = new TrayMeshData(mesh.Fragments.Concat(alternate.Fragments));
        }
        var from = p0 - new TrayMeshGeometry.Vec(3, 0, 0); var to = p1 + new TrayMeshGeometry.Vec(0, .4, 0);
        return new Fixture { Start = transform(p0).Point, End = transform(p1).Point, From = transform(from).Point, To = transform(to).Point,
            Inputs = new[] { MeshInput("measured-bend", "/M2", "ELBOW", mesh),
                MeshInput("measured-in", "/M1", "FTUBE", MeasuredSweep(new[] { from, p0 }, true, null, transform)),
                MeshInput("measured-out", "/M3", "FTUBE", MeasuredSweep(new[] { p1, to }, true, null, transform)) } };
    }

    private static TrayMeshData MeasuredSweep(TrayMeshGeometry.Vec[] points, bool caps,
        Func<int, int, int, bool> include, Func<TrayMeshGeometry.Vec, TrayMeshGeometry.Vec> transform)
    {
        var directions = points.Skip(1).Select((p, i) => (p - points[i]).Unit).ToArray();
        var width = new TrayMeshGeometry.Vec(0, 0, 1);
        var normals = directions.Select(d => TrayMeshGeometry.Vec.Cross(width, d).Unit).ToArray();
        var frames = new TrayMeshGeometry.Vec[points.Length]; frames[0] = normals[0]; frames[frames.Length - 1] = normals[normals.Length - 1];
        for (int i = 1; i < frames.Length - 1; i++) frames[i] = (normals[i - 1] + normals[i]) / (1 + TrayMeshGeometry.Vec.Dot(normals[i - 1], normals[i]));
        var profile = new[] { new[] { -.011, -.045 }, new[] { -.006, -.05 }, new[] { .006, -.05 }, new[] { .011, -.045 },
            new[] { .011, .045 }, new[] { .006, .05 }, new[] { -.006, .05 }, new[] { -.011, .045 } };
        var fragments = new List<TrayMeshFragment>();
        foreach (int rail in new[] { -1, 1 })
        {
            var vertices = new List<RoutePoint>(); var triangles = new List<int>();
            for (int row = 0; row < points.Length; row++) foreach (var p in profile)
                vertices.Add(transform(points[row] + width * (rail * .309 + p[0]) + frames[row] * p[1]).Point);
            int last = (points.Length - 1) * 8;
            if (caps) for (int i = 1; i < 7; i++) triangles.AddRange(new[] { 0, i, i + 1, last, last + i + 1, last + i });
            for (int run = 0; run < points.Length - 1; run++) for (int edge = 0; edge < 8; edge++)
            {
                if (include != null && !include(rail, run, edge)) continue;
                int a = run * 8 + edge, b = run * 8 + (edge + 1) % 8;
                triangles.AddRange(new[] { a, b, b + 8, a, b + 8, a + 8 });
            }
            fragments.Add(new TrayMeshFragment(vertices, triangles));
        }
        return new TrayMeshData(fragments);
    }

    private static void MeasuredMiterPolicy()
    {
        var fixture = MeasuredFixture(); var legacy = TrayGeometryBuilder.Build(fixture.Inputs);
        var explicitLegacy = TrayGeometryBuilder.Build(fixture.Inputs, TrayGeometryFitPolicy.LegacyV1);
        Assert(legacy.ValidatedBends == 0 && explicitLegacy.ValidatedBends == 0, "The retained v1 proof must not fit a polygonal miter as a circle.");
        Assert(legacy.Segments.SelectMany(s => s.Points).SequenceEqual(explicitLegacy.Segments.SelectMany(s => s.Points)), "Explicit v1 and the old overload must preserve every point.");
        var measured = TrayGeometryBuilder.Build(fixture.Inputs, TrayGeometryFitPolicy.MeasuredBendV2);
        Assert(measured.ValidatedBends == 1 && measured.ValidatedStraights == 2, "The actual miter must validate its caps and resolve the short physical outgoing spool: " + string.Join("; ", measured.Diagnostics));
        Assert(measured.Segments[0].Points.Count == 4 && measured.Segments[0].VerifiedPorts.Count == 2, "A measured miter retains all three finite runs and only its two measured ports.");
        Near(.6179898987322333, Length(measured.Segments[0].Points), .000001, "Measured miter length.");
        bool rejected = false; try { TrayGeometryBuilder.Build(fixture.Inputs, (TrayGeometryFitPolicy)123); } catch (ArgumentOutOfRangeException) { rejected = true; }
        Assert(rejected, "Unknown fitting policies must refuse.");
    }
    private static void MeasuredMiterRotation()
    {
        var axis = new TrayMeshGeometry.Vec(1, 2, 3).Unit;
        Func<TrayMeshGeometry.Vec, TrayMeshGeometry.Vec> transform = p => p * Math.Cos(.93) + TrayMeshGeometry.Vec.Cross(axis, p) * Math.Sin(.93)
            + axis * (TrayMeshGeometry.Vec.Dot(axis, p) * (1 - Math.Cos(.93))) + new TrayMeshGeometry.Vec(123, -51, 87);
        var fixture = MeasuredFixture(transform); var built = TrayGeometryBuilder.Build(fixture.Inputs, TrayGeometryFitPolicy.MeasuredBendV2);
        Assert(built.ValidatedBends == 1, "The fitting proof cannot depend on world axes: " + string.Join("; ", built.Diagnostics));
        var forward = new RouteCalculator().Calculate(built.Segments, fixture.From, fixture.To, CableCategory.Control, new RoutingOptions { ConnectionToleranceMeters = .00001 });
        var reverse = new RouteCalculator().Calculate(built.Segments, fixture.To, fixture.From, CableCategory.Control, new RoutingOptions { ConnectionToleranceMeters = .00001 });
        Assert(forward.Success && reverse.Success, "Both physical directions must connect.");
        Near(forward.LengthMeters, reverse.LengthMeters, .000001, "Reversal preserves physical miter length.");
        using (var cancelled = new CancellationTokenSource()) { cancelled.Cancel(); bool stopped = false; try { TrayGeometryBuilder.Build(fixture.Inputs, TrayGeometryFitPolicy.MeasuredBendV2, cancelled.Token); } catch (OperationCanceledException) { stopped = true; } Assert(stopped, "Measured proof must honor cancellation."); }
    }
    private static void MeasuredMiterMissingSupport()
    {
        var missing = MeasuredFixture(null, (rail, run, edge) => !(rail == -1 && run == 1 && edge == 5));
        Assert(TrayGeometryBuilder.Build(missing.Inputs, TrayGeometryFitPolicy.MeasuredBendV2).ValidatedBends == 0, "Complete cap profiles and infinite planes cannot replace a missing physical flange.");
        var decorative = MeasuredFixture(null, null, true, true);
        Assert(TrayGeometryBuilder.Build(decorative.Inputs, TrayGeometryFitPolicy.MeasuredBendV2).ValidatedBends == 1, "One-sided decorative faces cannot prove an alternate complete two-rail chain.");
    }
    private static void MeasuredMiterAmbiguity()
    {
        var ambiguous = MeasuredFixture(null, null, true);
        Assert(TrayGeometryBuilder.Build(ambiguous.Inputs, TrayGeometryFitPolicy.MeasuredBendV2).ValidatedBends == 0, "Two complete supported chains remain ambiguous.");
        var fixture = MeasuredFixture(); var original = fixture.Inputs[0];
        foreach (int contact in new[] { 0, 1, 2 })
        {
            var vertices = contact == 1 ? new[] { new RoutePoint(.05, -.01, 0), new RoutePoint(.15, .01, 0), new RoutePoint(.15, -.01, 0) } : contact == 2 ?
                new[] { new RoutePoint(.095, .0000005, -.0000005), new RoutePoint(.105, -.0000005, -.0000005), new RoutePoint(.1, 0, .0000005) } :
                new[] { new RoutePoint(.1, -.02, -.02), new RoutePoint(.1, .02, -.02), new RoutePoint(.1, 0, .02) };
            var mesh = new TrayMeshData(original.Mesh.Fragments.Concat(new[] { new TrayMeshFragment(vertices, new[] { 0, 1, 2 }) }));
            fixture.Inputs[0] = MeshInput(original.Id, original.RouteName, original.ShapeName, mesh);
            Assert(TrayGeometryBuilder.Build(fixture.Inputs, TrayGeometryFitPolicy.MeasuredBendV2).ValidatedBends == 0, "A supported centreline must not touch original body material, including coplanar contact.");
        }
    }
    private static void MeasuredTerminalCaps()
    {
        var fixture = CircularMeshFixture(90, false, false);
        var oneArm = new[] { fixture.Inputs[0], fixture.Inputs[1] };
        Assert(TrayGeometryBuilder.Build(oneArm).ValidatedBends == 0, "The historical one-arm refusal stays exact.");
        var measured = TrayGeometryBuilder.Build(oneArm, TrayGeometryFitPolicy.MeasuredBendV2);
        Assert(measured.ValidatedBends == 1, "The new proof must measure the second congruent outward support cap: " + string.Join("; ", measured.Diagnostics));
        Assert(measured.Segments[0].VerifiedPorts.Count == 2, "A terminal fit retains both actual material sections.");
        Near(0, measured.Segments[0].Points.Min(p => p.DistanceTo(fixture.End)), .000001, "The terminal port cannot move to an interior join.");
        var bend = fixture.Inputs[0]; var outDirection = (new TrayMeshGeometry.Vec(fixture.To) - new TrayMeshGeometry.Vec(fixture.End)).Unit;
        var fitted = measured.Segments[0].Points; int middle = fitted.Count / 2;
        var centre = new TrayMeshGeometry.Vec(fitted[middle]); var tangent = (new TrayMeshGeometry.Vec(fitted[middle + 1]) - new TrayMeshGeometry.Vec(fitted[middle - 1])).Unit;
        var widthAxis = new TrayMeshGeometry.Vec(0, 0, 1); var across = TrayMeshGeometry.Vec.Cross(tangent, widthAxis).Unit;
        var plate = new TrayMeshFragment(new[] { (centre - widthAxis * .02 - across * .02).Point, (centre + widthAxis * .02 - across * .02).Point, (centre + across * .02).Point }, new[] { 0, 1, 2 });
        var obstructed = MeshInput(bend.Id, bend.RouteName, bend.ShapeName, new TrayMeshData(bend.Mesh.Fragments.Concat(new[] { plate })));
        Assert(TrayGeometryBuilder.Build(new[] { obstructed, fixture.Inputs[1] }, TrayGeometryFitPolicy.MeasuredBendV2).ValidatedBends == 0,
            "A new terminal-circle proof must refuse original cross-channel material away from its caps.");
        var hardwarePoint = new TrayMeshGeometry.Vec(fixture.End) + outDirection * .15;
        var hardware = new TrayMeshFragment(new[] { hardwarePoint.Point, (hardwarePoint + new TrayMeshGeometry.Vec(.002, 0, .001)).Point, (hardwarePoint + new TrayMeshGeometry.Vec(0, .002, .001)).Point }, new[] { 0, 1, 2 });
        var withHardware = MeshInput(bend.Id, bend.RouteName, bend.ShapeName, new TrayMeshData(bend.Mesh.Fragments.Concat(new[] { hardware })));
        Assert(TrayGeometryBuilder.Build(new[] { withHardware, fixture.Inputs[1] }, TrayGeometryFitPolicy.MeasuredBendV2).ValidatedBends == 0, "Unanchored hardware beyond a cap must refuse, not move or infer the terminal port.");
        var fragments = new List<TrayMeshFragment>(); var interiorVertices = new List<RoutePoint>(); var interiorTriangles = new List<int>();
        foreach (var fragment in bend.Mesh.Fragments)
        {
            var kept = new List<int>();
            for (int offset = 0; offset < fragment.TriangleIndices.Count; offset += 3)
            {
                var indices = fragment.TriangleIndices.Skip(offset).Take(3).ToArray();
                if (indices.All(i => Math.Abs(TrayMeshGeometry.Vec.Dot(new TrayMeshGeometry.Vec(fragment.Vertices[i]) - new TrayMeshGeometry.Vec(fixture.End), outDirection)) <= .00025))
                {
                    foreach (int i in indices) { interiorTriangles.Add(interiorVertices.Count); interiorVertices.Add((new TrayMeshGeometry.Vec(fragment.Vertices[i]) - outDirection * .08).Point); }
                }
                else kept.AddRange(indices);
            }
            fragments.Add(new TrayMeshFragment(fragment.Vertices, kept));
        }
        fragments.Add(new TrayMeshFragment(interiorVertices, interiorTriangles));
        var internalOnly = MeshInput(bend.Id, bend.RouteName, bend.ShapeName, new TrayMeshData(fragments));
        Assert(TrayGeometryBuilder.Build(new[] { internalOnly, fixture.Inputs[1] }, TrayGeometryFitPolicy.MeasuredBendV2).ValidatedBends == 0,
            "A congruent internal material join cannot replace the missing outward terminal cap.");
    }
    private static void MeasuredCapDomainLimit()
    {
        var fixture = CircularMeshFixture(90, false, false); var original = fixture.Inputs[0];
        var outward = (new TrayMeshGeometry.Vec(fixture.From) - new TrayMeshGeometry.Vec(fixture.Start)).Unit;
        var u = TrayMeshGeometry.Vec.Perpendicular(outward); var v = TrayMeshGeometry.Vec.Cross(outward, u).Unit;
        var fragments = original.Mesh.Fragments.ToList();
        for (int i = 0; i < 65; i++)
        {
            var centre = new TrayMeshGeometry.Vec(fixture.Start) + outward * (-.0192 + i * .0006);
            fragments.Add(new TrayMeshFragment(new[] { (centre - u * .001 - v * .001).Point, (centre + u * .001 - v * .001).Point, (centre + v * .001).Point }, new[] { 0, 1, 2 }));
        }
        fixture.Inputs[0] = MeshInput(original.Id, original.RouteName, original.ShapeName, new TrayMeshData(fragments));
        var measured = TrayGeometryBuilder.Build(fixture.Inputs, TrayGeometryFitPolicy.MeasuredBendV2);
        Assert(measured.ValidatedBends == 0 && measured.Diagnostics.Any(d => d.Contains("measured bend proof is incomplete") && d.Contains("cap plane domain")),
            "Exceeding the complete cap plane domain must refuse rather than omit competing candidates.");
        Assert(!TrayGeometryBuilder.Build(fixture.Inputs).Diagnostics.Any(d => d.Contains("measured bend proof is incomplete")), "Legacy cap limits keep their historical behavior.");
    }
    private static void MeasuredCapCacheEquivalence()
    {
        var fixture = CircularMeshFixture(90, false, false); var bend = fixture.Inputs[0];
        var noise = new TrayMeshFragment(new[] { new RoutePoint(.001, .001, .04), new RoutePoint(.0011, .001, .04), new RoutePoint(.001, .0011, .04) },
            Enumerable.Range(0, 10000).SelectMany(_ => new[] { 0, 1, 2 }));
        var augmented = MeshInput(bend.Id, bend.RouteName, bend.ShapeName, new TrayMeshData(bend.Mesh.Fragments.Concat(new[] { noise })));
        var inputs = new List<TrayGeometryInput> { augmented, fixture.Inputs[1], fixture.Inputs[2] };
        var arm = fixture.Inputs[1];
        for (int i = 0; i < 48; i++) inputs.Add(new TrayGeometryInput("repeated-arm-" + i, arm.RouteName, arm.Categories, arm.ShapeName, arm.Minimum, arm.Maximum, null, arm.Mesh));
        var legacy = TrayGeometryBuilder.Build(inputs); var measured = TrayGeometryBuilder.Build(inputs, TrayGeometryFitPolicy.MeasuredBendV2);
        Assert(legacy.ValidatedBends == 1 && measured.ValidatedBends == 1,
            "Repeated complete cap contexts must not exhaust proof work or omit independent neighbor checks: " + string.Join("; ", measured.Diagnostics));
        var a = legacy.Segments[0]; var b = measured.Segments[0];
        Assert(a.Points.Count == b.Points.Count && a.Points.Zip(b.Points, (x, y) => x.DistanceTo(y)).All(d => d < .000001), "Caching must preserve every retained circular point.");
        Assert(a.VerifiedPorts.Count == b.VerifiedPorts.Count, "The cache cannot synthesize or omit port evidence.");
        var miter = MeasuredFixture(); var incoming = miter.Inputs[1];
        var warm = MeshInput("warm-outside-distance", incoming.RouteName, incoming.ShapeName,
            TransformMesh(incoming.Mesh, p => p + new TrayMeshGeometry.Vec(0, 0, .025)));
        var wrongSection = MeshInput("wrong-section-same-plane", incoming.RouteName, incoming.ShapeName,
            TransformMesh(incoming.Mesh, p => new TrayMeshGeometry.Vec(p.X, p.Y, p.Z * .5)));
        Assert(TrayGeometryBuilder.Build(new[] { miter.Inputs[0], warm, wrongSection, miter.Inputs[2] }, TrayGeometryFitPolicy.MeasuredBendV2).ValidatedBends == 0,
            "A complete cached cap measurement cannot bypass each neighbor's independent distance and section compatibility.");
    }
    private static void MeasuredDirectionIndexEquivalence()
    {
        foreach (double angle in new[] { 0.0, .23, .93 }) foreach (bool reverseTriangles in new[] { false, true })
        {
            var fixture = CircularMeshFixture(90, false, false); var axis = new TrayMeshGeometry.Vec(1, -2, 3).Unit;
            Func<TrayMeshGeometry.Vec, TrayMeshGeometry.Vec> rotate = p => p * Math.Cos(angle) + TrayMeshGeometry.Vec.Cross(axis, p) * Math.Sin(angle)
                + axis * (TrayMeshGeometry.Vec.Dot(axis, p) * (1 - Math.Cos(angle))) + new TrayMeshGeometry.Vec(21, -13, 7);
            var inputs = fixture.Inputs.Select(input =>
            {
                var mesh = TransformMesh(input.Mesh, rotate);
                if (reverseTriangles) mesh = new TrayMeshData(mesh.Fragments.Reverse().Select(fragment => new TrayMeshFragment(fragment.Vertices,
                    Enumerable.Range(0, fragment.TriangleIndices.Count / 3).Reverse().SelectMany(i => fragment.TriangleIndices.Skip(i * 3).Take(3)))));
                return MeshInput(input.Id, input.RouteName, input.ShapeName, mesh);
            }).ToArray();
            var legacy = TrayGeometryBuilder.Build(inputs); var measured = TrayGeometryBuilder.Build(inputs, TrayGeometryFitPolicy.MeasuredBendV2);
            Assert(legacy.ValidatedBends == 1 && measured.ValidatedBends == 1, "Exact normal selection cannot lose a proven rotated circle: " + string.Join("; ", measured.Diagnostics));
            var a = legacy.Segments[0]; var b = measured.Segments[0];
            Assert(a.Points.Count == b.Points.Count && a.Points.Zip(b.Points, (x, y) => x.DistanceTo(y)).All(d => d < .000001),
                "Candidate filtering must preserve the original selected triangle traversal and circular result.");
        }
    }

    private sealed class Fixture
    {
        public TrayGeometryInput[] Inputs;
        public RoutePoint Centre, Start, End, From, To;
    }
    private static Fixture Create(int first, int second, int firstSign, int secondSign)
    {
        int normal = 3 - first - second;
        var centre = new RoutePoint(10, 20, 30);
        var start = Shift(centre, second, secondSign);
        var end = Shift(centre, first, firstSign);
        var from = Shift(start, first, -2 * firstSign);
        var to = Shift(end, second, -2 * secondSign);
        var minimum = centre; var maximum = centre;
        minimum = Shift(minimum, first, firstSign < 0 ? -1.2 : 0);
        maximum = Shift(maximum, first, firstSign > 0 ? 1.2 : 0);
        minimum = Shift(minimum, second, secondSign < 0 ? -1.2 : 0);
        maximum = Shift(maximum, second, secondSign > 0 ? 1.2 : 0);
        minimum = Shift(minimum, normal, -0.05); maximum = Shift(maximum, normal, 0.05);
        var faces = new[] { Face(first, firstSign < 0, start, second, normal), Face(second, secondSign < 0, end, first, normal) };
        return new Fixture
        {
            Centre = centre, Start = start, End = end, From = from, To = to,
            Inputs = new[] { Input("bend", "/B002", "BEND 1", minimum, maximum, faces),
                Straight("in", "/B001", start, from, first, normal), Straight("out", "/B003", end, to, second, normal) }
        };
    }
    private static TrayFaceExtent Face(int axis, bool maximum, RoutePoint centre, int perpendicular, int normal)
    { return new TrayFaceExtent((TrayBoxFace)(axis * 2 + (maximum ? 1 : 0)), Shift(Shift(centre, perpendicular, -0.2), normal, -0.05), Shift(Shift(centre, perpendicular, 0.2), normal, 0.05), 12); }
    private static TrayGeometryInput Straight(string id, string name, RoutePoint first, RoutePoint last, int axis, int normal)
    {
        int perpendicular = 3 - axis - normal;
        var minimum = new RoutePoint(Math.Min(first.X, last.X), Math.Min(first.Y, last.Y), Math.Min(first.Z, last.Z));
        var maximum = new RoutePoint(Math.Max(first.X, last.X), Math.Max(first.Y, last.Y), Math.Max(first.Z, last.Z));
        minimum = Shift(Shift(minimum, perpendicular, -0.2), normal, -0.05);
        maximum = Shift(Shift(maximum, perpendicular, 0.2), normal, 0.05);
        return Input(id, name, "FTUBE 1", minimum, maximum);
    }
    private static TrayGeometryInput Input(string id, string name, string shape, RoutePoint min, RoutePoint max, IEnumerable<TrayFaceExtent> faces = null)
    { return new TrayGeometryInput(id, name, CableCategory.LV | CableCategory.Control, shape, min, max, faces); }
    private static IEnumerable<TrayFaceExtent> RotateFaces(TrayGeometryInput bend, int first, int second)
    {
        Func<RoutePoint, RoutePoint> rotate = p => Shift(Shift(p, first, Value(bend.Minimum, first) + Value(bend.Maximum, first) - 2 * Value(p, first)), second,
            Value(bend.Minimum, second) + Value(bend.Maximum, second) - 2 * Value(p, second));
        foreach (var face in bend.FaceExtents)
        {
            var a = rotate(face.Minimum); var b = rotate(face.Maximum);
            yield return new TrayFaceExtent((TrayBoxFace)((int)face.Face ^ 1),
                new RoutePoint(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Min(a.Z, b.Z)),
                new RoutePoint(Math.Max(a.X, b.X), Math.Max(a.Y, b.Y), Math.Max(a.Z, b.Z)), face.SampleCount);
        }
    }
    private static RoutePoint Midpoint(RoutePoint first, RoutePoint last) { return new RoutePoint((first.X + last.X) * 0.5, (first.Y + last.Y) * 0.5, (first.Z + last.Z) * 0.5); }
    private static double Value(RoutePoint point, int axis) { return axis == 0 ? point.X : axis == 1 ? point.Y : point.Z; }
    private static RoutePoint Shift(RoutePoint point, int axis, double amount) { return new RoutePoint(point.X + (axis == 0 ? amount : 0), point.Y + (axis == 1 ? amount : 0), point.Z + (axis == 2 ? amount : 0)); }
    private static double Length(IReadOnlyList<RoutePoint> points) { double sum = 0; for (int i = 1; i < points.Count; i++) sum += points[i - 1].DistanceTo(points[i]); return sum; }
    private static void Assert(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    private static void Near(double expected, double actual, double tolerance, string message) { Assert(Math.Abs(expected - actual) < tolerance, message + " Expected " + expected + ", got " + actual); }
}
