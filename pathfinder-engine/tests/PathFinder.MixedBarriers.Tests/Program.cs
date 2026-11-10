using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Barriers;
using PathFinder.BarrierVerifier;
using static Fixtures;
using static MixedFixtures;

var checks = new List<object>(); int failed = 0;
void Run(string name, Action action) { try { action(); checks.Add(new { name, status = "PASS" }); } catch (Exception error) { failed++; checks.Add(new { name, status = "FAIL", detail = error.ToString() }); } }
void Need(bool value, string reason = "Synthetic assertion failed.") { if (!value) throw new Exception(reason); }
MixedBarrierVerificationResult Ready(JsonObject capture)
{
    var result = MixedBarrierCaptureVerifier.Verify(Bytes(capture));
    Need(result.Receipt.Status == "geometry-qualified" && result.Qualified is not null, JsonSerializer.Serialize(result.Receipt)); return result;
}
void Refused(JsonObject capture, BarrierVerifierLimits? limits = null, string? code = null)
{
    var result = MixedBarrierCaptureVerifier.Verify(Bytes(capture), limits); Need(result.Receipt.Status == "refused" && result.Qualified is null);
    if (code is not null) Need(result.Receipt.Diagnostics.Any(d => d.Code == code), JsonSerializer.Serialize(result.Receipt));
}
MixedBarrierKernel Kernel(params MixedFragmentInput[] fragments)
{
    var result = MixedBarrierKernel.Build(fragments); Need(result.Status == BarrierBuildStatus.Ready && result.Kernel is not null, JsonSerializer.Serialize(result.Diagnostics)); return result.Kernel!;
}
void Status(MixedBarrierKernel kernel, BarrierPoint from, BarrierPoint to, MixedBarrierSegmentStatus expected)
{
    var result = kernel.CheckSegment(from, to); Need(result.Status == expected, $"Expected {expected}; observed {result.Status}/{result.Reason}.");
    Need(!result.OwnTerminalExemptionsSupported && !result.GlobalModelCoverageVerified && !result.PhysicalCableRadiusChecked);
}
void Cancelled(Action action, CancellationToken token) { try { action(); } catch (OperationCanceledException error) { Need(error.CancellationToken == token); return; } throw new Exception("Cancellation did not propagate."); }

Run("single open wall is classified as original surface and blocks crossing", () => {
    var result = Ready(Capture(Wall())); Need(result.Receipt.Evidence!.OriginalSurfaceComponents == 1 && result.Receipt.Evidence.QualifiedClosedSolidComponents == 0);
    Status(result.Qualified!.Kernel, P(-1), P(1), MixedBarrierSegmentStatus.Blocked); Need(result.Qualified.Components[0].Kind == MixedBarrierComponentKind.OriginalSurface);
});
Run("open floor blocks vertical crossings and contact without fabricating thickness", () => {
    var capture = Capture(Transform(Wall(), p => P(p.Y, p.Z, p.X))); capture["selectedParents"]![0]!["kind"] = "floor"; var result = Ready(capture);
    Status(result.Qualified!.Kernel, P(0, 0, -1), P(0, 0, 1), MixedBarrierSegmentStatus.Blocked);
    Status(result.Qualified.Kernel, P(0, 0, 0), P(0, 0, 0), MixedBarrierSegmentStatus.Blocked);
    Status(result.Qualified.Kernel, P(0, 0, .2), P(1, 0, .2), MixedBarrierSegmentStatus.Clear);
});
Run("open wall coplanar overlap edge and vertex grazing are blocked", () => {
    var kernel = Ready(Capture(Wall())).Qualified!.Kernel;
    Status(kernel, P(0, -.2), P(0, .2), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(-1, 2), P(1, 2), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(-1, 2, 2), P(1, 2, 2), MixedBarrierSegmentStatus.Blocked);
});
Run("actual open ring hole stays clear while material and rim block", () => {
    var result = Ready(Capture(Ring())); var kernel = result.Qualified!.Kernel; Need(result.Receipt.Evidence!.OriginalSurfaceComponents == 1);
    Status(kernel, P(-1), P(1), MixedBarrierSegmentStatus.Clear); Status(kernel, P(-1, 1), P(1, 1), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(-1, .6), P(1, .6), MixedBarrierSegmentStatus.Blocked);
});
Run("actual floor ring opening survives exact coordinate permutation", () => {
    var kernel = Ready(Capture(Transform(Ring(), p => P(p.Y, p.Z, p.X)))).Qualified!.Kernel;
    Status(kernel, P(0, 0, -1), P(0, 0, 1), MixedBarrierSegmentStatus.Clear); Status(kernel, P(1, 0, -1), P(1, 0, 1), MixedBarrierSegmentStatus.Blocked);
});
Run("translated and wholly reversed original opening remains original geometry", () => {
    var kernel = Ready(Capture(Transform(Reverse(Ring()), p => P(p.X + 10, p.Y - 3, p.Z + 2)))).Qualified!.Kernel;
    Status(kernel, P(9, -3, 2), P(11, -3, 2), MixedBarrierSegmentStatus.Clear); Status(kernel, P(9, -2, 2), P(11, -2, 2), MixedBarrierSegmentStatus.Blocked);
});
Run("closed cube is independently qualified and blocks wholly internal segment and point", () => {
    var result = Ready(Capture(Box(-1, 1, -1, 1, -1, 1))); Need(result.Receipt.Evidence!.QualifiedClosedSolidComponents == 1 && result.Receipt.Evidence.OriginalSurfaceComponents == 0);
    Status(result.Qualified!.Kernel, P(-.2), P(.2), MixedBarrierSegmentStatus.Blocked); Status(result.Qualified.Kernel, P(0), P(0), MixedBarrierSegmentStatus.Blocked);
    Status(result.Qualified.Kernel, P(2), P(3), MixedBarrierSegmentStatus.Clear);
});
Run("actual qualified closed tunnel preserves its opening and blocks surrounding volume", () => {
    var result = Ready(Capture(Frame(), splitTriangles: true)); Need(result.Receipt.Evidence!.QualifiedClosedSolidComponents == 1 && result.Receipt.Evidence.OriginalSurfaceComponents == 0);
    Status(result.Qualified!.Kernel, P(-1), P(1), MixedBarrierSegmentStatus.Clear); Status(result.Qualified.Kernel, P(.1), P(.1), MixedBarrierSegmentStatus.Clear);
    Status(result.Qualified.Kernel, P(-1, 1), P(1, 1), MixedBarrierSegmentStatus.Blocked); Status(result.Qualified.Kernel, P(.1, 1), P(.1, 1), MixedBarrierSegmentStatus.Blocked);
});
Run("exact cut floor29669 cap incidence qualifies without altering its opening or any original source", () => {
    var input = CutFloorInput(); var mesh = CutFloorIncidenceFixture.Gvl24429669();
    Need(mesh.Vertices.Length == 82 && mesh.Indices.Length == 204);
    var kernel = Kernel(input);
    Need(kernel.Summary.FragmentCount == 1 && kernel.Summary.VertexCount == 82 && kernel.Summary.TriangleCount == 68
        && kernel.Summary.QualifiedClosedSolidComponents == 1 && kernel.Summary.OriginalSurfaceComponents == 0);
    OriginalInputsRetained(kernel, [input]);
    foreach (var triangle in kernel.Components.Single().Triangles) {
        Need(triangle.Source.OwnerObjectId == "dbid:29669" && triangle.Source.FragmentId == 1961);
        Need(triangle.Source.SourceSha256 == input.Source.SourceSha256 && triangle.Source.TransformSha256 == input.Source.TransformSha256);
        Need(triangle.Source.SourceUnits == "mm" && BitConverter.DoubleToInt64Bits(triangle.Source.MetresPerSourceUnit) == BitConverter.DoubleToInt64Bits(.001));
        Need(triangle.Source.SourceToWorldBits.SequenceEqual(input.Source.SourceToWorldBits));
    }
    CutFloorQueries(kernel);
    var legacy = BarrierCollisionKernel.Build([new("cut-floor29669", mesh.Vertices, mesh.Indices)]);
    Need(legacy.Status == BarrierBuildStatus.Ready && legacy.Kernel is not null, JsonSerializer.Serialize(legacy.Diagnostics));
    Need(legacy.Kernel!.CheckSegment(P(2.7, 72.1, 19.8), P(2.7, 72.1, 20.2)).Status == BarrierSegmentStatus.Clear);
    Need(legacy.Kernel.CheckSegment(P(1, 72.2, 19.8), P(1, 72.2, 20.2)).Status == BarrierSegmentStatus.Blocked);
});
Run("cut floor exact vertex incidence survives vertex triangle cyclic winding and fragment permutations", () => {
    var input = CutFloorInput(); int count = input.Vertices.Count;
    var reversed = input with { Vertices = input.Vertices.Reverse().ToArray(),
        TriangleIndices = input.TriangleIndices.Chunk(3).Reverse().SelectMany(t => new[] { count - 1 - t[0], count - 1 - t[2], count - 1 - t[1] }).ToArray() };
    var cyclic = input with { TriangleIndices = input.TriangleIndices.Chunk(3).SelectMany(t => new[] { t[1], t[2], t[0] }).ToArray() };
    foreach (var variant in new[] { reversed, cyclic }) {
        var kernel = Kernel(variant); Need(kernel.Summary.QualifiedClosedSolidComponents == 1 && kernel.Summary.OriginalSurfaceComponents == 0);
        OriginalInputsRetained(kernel, [variant]); CutFloorQueries(kernel);
    }
    var split = new[] {
        input with { Source = input.Source with { FragmentId = 1961 }, TriangleIndices = input.TriangleIndices.Take(102).ToArray() },
        input with { Source = input.Source with { FragmentId = 1962 }, TriangleIndices = input.TriangleIndices.Skip(102).ToArray() }
    };
    var assembled = Kernel(split.Reverse().ToArray());
    Need(assembled.Summary.FragmentCount == 2 && assembled.Summary.TriangleCount == 68 && assembled.Summary.QualifiedClosedSolidComponents == 1);
    OriginalInputsRetained(assembled, split); CutFloorQueries(assembled);
});
Run("cut floor exact incidence remains qualified through both native mixed verifier protocols", () => {
    var capture = Capture(CutFloorIncidenceFixture.Gvl24429669()); capture["selectedParents"]![0]!["kind"] = "floor";
    foreach (string mode in new[] { "--mixed-v2", "--mixed-v2-2048" }) {
        var receipt = NativeReceipt(Bytes(capture), mode);
        Need(receipt.GetProperty("status").GetString() == "geometry-qualified", receipt.GetRawText());
        var evidence = receipt.GetProperty("evidence");
        Need(evidence.GetProperty("triangleCount").GetInt32() == 68 && evidence.GetProperty("qualifiedClosedSolidComponents").GetInt32() == 1
            && evidence.GetProperty("originalSurfaceComponents").GetInt32() == 0);
    }
});
Run("exact endpoint incidence does not accept actual self crossings coplanar overlap or topology defects", () => {
    var box = Box();
    foreach (var moved in new[] { P(.1, 0, -3), P(.1, -3, 2) }) {
        var vertices = box.Vertices.ToArray(); vertices[6] = moved;
        var result = MixedBarrierKernel.Build([Input(box with { Vertices = vertices })]);
        Need(result.Kernel is null && result.Diagnostics.Single().Code == "CLOSED_SOLID_QUALIFICATION_REFUSED");
    }
    var floor = CutFloorInput();
    var repeated = MixedBarrierKernel.Build([floor with { TriangleIndices = floor.TriangleIndices.Concat(floor.TriangleIndices.Take(3)).ToArray() }]);
    Need(repeated.Kernel is null && repeated.Diagnostics.Single().Code == "DUPLICATE_TRIANGLE");
    var pinched = MixedBarrierKernel.Build([Input(Merge(Box(-1, 0, -1, 0, -1, 0), Box(0, 1, 0, 1, 0, 1)))]);
    Need(pinched.Kernel is null && pinched.Diagnostics.Single().Code == "NONMANIFOLD_VERTEX");
    // Nonincident near-contact still uses the original numeric contact guard.
    var contact = OriginalTriangleSurfaceContact.Check(P(5e-8, .2, .2), P(5e-8, .3, .2), P(0), P(0, 1), P(0, 0, 1));
    Need(contact.Status == OriginalTriangleContactStatus.Contact);
});
Run("mixed surface and solid both participate in global contact and solid occupancy", () => {
    var kernel = Kernel(Input(Wall(), 1), Input(Box(5, 6, -1, 1, -1, 1), 2)); Need(kernel.Summary.OriginalSurfaceComponents == 1 && kernel.Summary.QualifiedClosedSolidComponents == 1);
    Status(kernel, P(-1), P(1), MixedBarrierSegmentStatus.Blocked); Status(kernel, P(4), P(7), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(5.2), P(5.8), MixedBarrierSegmentStatus.Blocked); Status(kernel, P(1), P(4), MixedBarrierSegmentStatus.Clear);
});
Run("surface-only open box does not claim closed-volume occupancy", () => {
    var box = Box(-1, 1, -1, 1, -1, 1); var result = Ready(Capture(box with { Indices = box.Indices.Skip(6).ToArray() }));
    Need(result.Receipt.Evidence!.OriginalSurfaceComponents == 1 && result.Receipt.Evidence.QualifiedClosedSolidComponents == 0);
    Status(result.Qualified!.Kernel, P(-.2), P(.2), MixedBarrierSegmentStatus.Clear);
});
Run("nested or conservatively contained closed bounds are refused instead of filled", () => Refused(Capture(Merge(Box(-3, 3, -3, 3, -3, 3), Box(-1, 1, -1, 1, -1, 1))), code: "NESTED_OR_AMBIGUOUS_SHELLS"));
Run("disconnected noncontained closed solids retain separate qualified components", () => {
    var result = Ready(Capture(Merge(Box(), Box(5, 5.2)))); Need(result.Receipt.Evidence!.QualifiedClosedSolidComponents == 2 && result.Qualified!.Components.Count == 2);
});
Run("partial or unavailable observations cannot enter mixed qualification", () => {
    var partial = Capture(Wall()); partial["observation"]!["state"] = "partial"; Refused(partial, code: "PARTIAL_CAPTURE");
    var unavailable = Capture(Wall()); unavailable["observation"]!["unavailableFragmentIds"] = new JsonArray(1); Refused(unavailable, code: "PARTIAL_CAPTURE");
});
Run("malformed and authority-claiming capture inputs remain refused", () => {
    var extra = Capture(Wall()); extra["qualified"] = true; Refused(extra);
    var indices = Capture(Wall()); indices["fragments"]![0]!["triangleIndices"]![0] = 999; Refused(indices);
    var frame = Capture(Wall()); frame["scope"]!["coordinateFrame"] = "viewer-display"; Refused(frame);
    Need(MixedBarrierCaptureVerifier.Verify(new byte[] { 255 }).Qualified is null);
});
Run("repeated triangles collapsed triangles and inconsistent original winding are refused", () => {
    var wall = Wall(); Refused(Capture(wall with { Indices = wall.Indices.Concat(wall.Indices.Take(3)).ToArray() }), code: "DUPLICATE_TRIANGLE");
    var collapsed = wall.Vertices.ToArray(); collapsed[1] = collapsed[0]; Refused(Capture(wall with { Vertices = collapsed }), code: "DEGENERATE_TRIANGLE");
    var indices = wall.Indices.ToArray(); (indices[4], indices[5]) = (indices[5], indices[4]); Refused(Capture(wall with { Indices = indices }), code: "INCONSISTENT_WINDING");
});
Run("nonmanifold edges remain refused for original surfaces", () => {
    var nonmanifold = new Mesh([P(0), P(0, 1), P(0, 0, 1), P(0, 0, -1), P(1)], [0, 1, 2, 1, 0, 3, 0, 1, 4]); Refused(Capture(nonmanifold), code: "NONMANIFOLD_EDGE");
});
Run("independently closed bodies touching along an exact edge keep both occupancies and every original triangle", () => {
    var mesh = EdgeTouchingBoxes(); var result = Ready(Capture(mesh)); var kernel = result.Qualified!.Kernel;
    Need(result.Receipt.Evidence!.OriginalSurfaceComponents == 0 && result.Receipt.Evidence.QualifiedClosedSolidComponents == 2);
    Need(kernel.Components.All(component => component.Kind == MixedBarrierComponentKind.QualifiedClosedSolid && component.Triangles.Count == 12));
    OriginalMeshRetained(kernel, mesh);
    Status(kernel, P(-.8, -.8, -.5), P(-.2, -.2, .5), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(.2, .2, -.5), P(.8, .8, .5), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(-.5, -.5), P(-.5, -.5), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(-2, -.5), P(.5, -.5), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(-.1, .1), P(.1, -.1), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(-2, 2), P(2, 2), MixedBarrierSegmentStatus.Clear);
    // Pinned from the pre-owner-contact native closure's successful cut lane.
    Need(result.Receipt.CaptureSha256 == "4d85a4aea221ffd7d686fcdc160769f7a180be6bdf8626eccb8a1ae1b684f797");
    Need(result.Receipt.Evidence.OriginalGeometrySha256 == "067f1b934b2797ed608546a8a5f8efb8088f0a7c4c190136be7589791efb8f40");
    Need(result.Receipt.Evidence.VerificationSha256 == "5769e29f16c78d4c9d4f0ce92feb9a7ae156757d0dafe08a25d6203fa255c903");
    Need(result.Receipt.Evidence.ComponentMemberships.Select(component => component.SourceMembershipSha256).SequenceEqual(new[] {
        "db46bb8a7b5c42f965e8086d06fff69f0c4b27c3f3b4c729b76a2423d929a174", "5c8121dab58b8dcabdfaf2afe1e25c31d522d84698407d77d3a5d1b533f15c69" }));
});
Run("overfull-edge partition waits for all faces even when the first two have the same direction", () => {
    var capture = Capture(EdgeTouchingBoxes(), splitTriangles: true, sharedParents: true); var fragments = capture["fragments"]!.AsArray();
    // Put one downward edge face from each body before either upward face.
    fragments[10]!["source"]!["fragmentId"] = 18; fragments[17]!["source"]!["fragmentId"] = 11;
    for (int at = 12; at < fragments.Count; at++) fragments[at]!["source"]!["ownerObjectId"] = "dbid:20";
    var directions = new List<int>();
    foreach (var fragment in fragments.OrderBy(fragment => fragment!["source"]!["fragmentId"]!.GetValue<int>())) {
        var vertices = fragment!["verticesMetres"]!.AsArray();
        for (int side = 0; side < 3; side++) {
            var a = vertices[side]!.AsArray(); var b = vertices[(side + 1) % 3]!.AsArray();
            if (a[0]!.GetValue<double>() == 0 && a[1]!.GetValue<double>() == 0 && b[0]!.GetValue<double>() == 0 && b[1]!.GetValue<double>() == 0)
                directions.Add(a[2]!.GetValue<double>() < b[2]!.GetValue<double>() ? 1 : -1);
        }
    }
    Need(directions.Count == 4 && directions[0] == directions[1]);
    var result = Ready(capture); var evidence = result.Receipt.Evidence!; var originals = result.Qualified!.Components.SelectMany(component => component.Triangles).ToArray();
    Need(evidence.QualifiedClosedSolidComponents == 2 && evidence.OriginalSurfaceComponents == 0 && evidence.FragmentCount == 24 && evidence.TriangleCount == 24);
    Need(evidence.ComponentMemberships.All(component => component.TriangleCount == 12 && component.FragmentIds.Count == 12 && component.ParentSelectionIds.SequenceEqual(new[] { Id(201), Id(202) })));
    Need(evidence.ComponentMemberships.SelectMany(component => component.FragmentIds).Distinct().Count() == 24);
    foreach (var triangle in originals) {
        var fragment = fragments.Single(fragment => fragment!["source"]!["fragmentId"]!.GetValue<int>() == triangle.Source.FragmentId)!;
        Need(triangle.LocalTriangleIndex == 0 && triangle.OriginalVertexA == 0 && triangle.OriginalVertexB == 1 && triangle.OriginalVertexC == 2);
        Need(triangle.Source.OwnerObjectId == fragment["source"]!["ownerObjectId"]!.GetValue<string>());
        foreach (var pair in new[] { (Point: triangle.A, Index: 0), (Point: triangle.B, Index: 1), (Point: triangle.C, Index: 2) }) {
            var point = fragment["verticesMetres"]![pair.Index]!;
            Need(SameBits(pair.Point, P(point[0]!.GetValue<double>(), point[1]!.GetValue<double>(), point[2]!.GetValue<double>())));
        }
    }
});
Run("an overfull edge involving a cube and an open sheet cannot downgrade any part into a surface", () => {
    var sheet = new Mesh([P(0, 0, -1), P(0, 0, 1), P(1, 1)], [0, 1, 2]);
    var result = MixedBarrierCaptureVerifier.Verify(Bytes(Capture(Merge(Box(-1, 0, -1, 0, -1, 1), sheet))));
    Need(result.Qualified is null && result.Receipt.Evidence is null && result.Receipt.Diagnostics.Single().Code == "NONMANIFOLD_EDGE");
    Need(result.Receipt.Diagnostics.Single().ObjectIds!.SequenceEqual(new[] { "dbid:10" }));
});
Run("edge partition preserves unaffected open surfaces and still rejects duplicate nested or invalid closed bodies", () => {
    var separatedWall = Transform(Wall(), p => p with { X = p.X + 5 });
    var mixed = Ready(Capture(Merge(EdgeTouchingBoxes(), separatedWall)));
    Need(mixed.Receipt.Evidence!.QualifiedClosedSolidComponents == 2 && mixed.Receipt.Evidence.OriginalSurfaceComponents == 1);
    Status(mixed.Qualified!.Kernel, P(4), P(6), MixedBarrierSegmentStatus.Blocked);
    Refused(Capture(Merge(EdgeTouchingBoxes(), Box(-1, 0, -1, 0, -1, 1))), code: "DUPLICATE_TRIANGLE");
    Refused(Capture(Merge(EdgeTouchingBoxes(), Box(-.8, -.2, -.8, -.2, -.5, .5))), code: "NESTED_OR_AMBIGUOUS_SHELLS");
    var invalid = Box(); var vertices = invalid.Vertices.ToArray(); vertices[6] = P(.1, 0, -3);
    Refused(Capture(Merge(Box(-.2, 0, -4, -2, -2, 2), invalid with { Vertices = vertices })), code: "CLOSED_SOLID_QUALIFICATION_REFUSED");
});
Run("edge partition consumes the existing shared work memory and component budgets", () => {
    var input = new[] { Input(Box(-1, 0, -1, 0, -1, 1), fragment: 1), Input(Box(0, 1, 0, 1, -1, 1), fragment: 2) };
    var good = MixedBarrierKernel.Build(input); Need(good.Status == BarrierBuildStatus.Ready && good.Kernel is not null);
    var work = MixedBarrierKernel.Build(input, new() { Geometry = new() { MaximumBuildWork = good.Work - 1 } });
    Need(work.Status == BarrierBuildStatus.Refused && work.Kernel is null && work.Diagnostics.Single().Code == "WORK_LIMIT" && work.Work <= good.Work - 1);
    var memory = MixedBarrierKernel.Build(input, new() { Geometry = new() { MaximumEstimatedBytes = 32000 } });
    Need(memory.Status == BarrierBuildStatus.Refused && memory.Kernel is null && memory.Diagnostics.Single().Code == "ESTIMATED_MEMORY_LIMIT");
    Need(good.Kernel!.Summary.EstimatedBytes > 32000);
    var components = MixedBarrierKernel.Build(input, new() { Geometry = new() { MaximumMeshes = 1 } });
    Need(components.Status == BarrierBuildStatus.Refused && components.Kernel is null && components.Diagnostics.Single().Code == "COMPONENT_LIMIT");
    var parents = Enumerable.Range(0, 128).Select(at => Id(201 + at)).ToArray();
    var shared = input.Select(fragment => fragment with { Source = fragment.Source with { ParentSelectionIds = parents } }).ToArray();
    var combined = MixedBarrierKernel.Build(shared, new() { MaximumParents = 2048, Geometry = new() { MaximumMeshes = 2048, MaximumEstimatedBytes = 110000 } });
    Need(combined.Status == BarrierBuildStatus.Refused && combined.Kernel is null && combined.Diagnostics.Single().Code == "ESTIMATED_MEMORY_LIMIT");
});
Run("face-contacting distinct original owners retain mismatched cap diagonals and both independently proved occupancies", () => {
    var input = OwnerContactInputs(); var kernel = Kernel(input);
    Need(kernel.Summary.QualifiedClosedSolidComponents == 2 && kernel.Summary.OriginalSurfaceComponents == 0 && kernel.Summary.TriangleCount == 24);
    Need(kernel.Components.All(component => component.Kind == MixedBarrierComponentKind.QualifiedClosedSolid && component.Triangles.Count == 12));
    OriginalInputsRetained(kernel, input);
    Status(kernel, P(-.8), P(-.2), MixedBarrierSegmentStatus.Blocked); Status(kernel, P(.2), P(.8), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(0), P(0), MixedBarrierSegmentStatus.Blocked); Status(kernel, P(0, -.5), P(0, .5), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(-2, 2), P(2, 2), MixedBarrierSegmentStatus.Clear);
});
Run("identical original cap triangles of separate closed owners are retained with both solid occupancies", () => {
    var input = OwnerContactInputs(identicalCaps: true); var kernel = Kernel(input);
    Need(kernel.Summary.QualifiedClosedSolidComponents == 2 && kernel.Summary.OriginalSurfaceComponents == 0 && kernel.Summary.TriangleCount == 24);
    Need(kernel.Components.All(component => component.Kind == MixedBarrierComponentKind.QualifiedClosedSolid && component.Triangles.Count == 12));
    OriginalInputsRetained(kernel, input);
    Status(kernel, P(-.8), P(-.2), MixedBarrierSegmentStatus.Blocked); Status(kernel, P(.2), P(.8), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(0), P(0), MixedBarrierSegmentStatus.Blocked); Status(kernel, P(0, -.5), P(0, .5), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(-2, 2), P(2, 2), MixedBarrierSegmentStatus.Clear);
});
Run("identical owner caps remain exact after fragment input vertex triangle and complete winding permutations", () => {
    var input = OwnerContactInputs(identicalCaps: true); var kernel = Kernel(input);
    Need(Kernel(input.Reverse().ToArray()).Summary.OriginalGeometrySha256 == kernel.Summary.OriginalGeometrySha256);
    var permuted = input.Reverse().Select(fragment => {
        int count = fragment.Vertices.Count;
        int[] indices = fragment.TriangleIndices.Chunk(3).Reverse().SelectMany(triangle => new[] { count - 1 - triangle[0], count - 1 - triangle[2], count - 1 - triangle[1] }).ToArray();
        return fragment with { Vertices = fragment.Vertices.Reverse().ToArray(), TriangleIndices = indices };
    }).ToArray();
    var changed = Kernel(permuted); Need(changed.Summary.QualifiedClosedSolidComponents == 2 && changed.Summary.OriginalSurfaceComponents == 0);
    OriginalInputsRetained(changed, permuted);
    Status(changed, P(-.8), P(-.2), MixedBarrierSegmentStatus.Blocked); Status(changed, P(.2), P(.8), MixedBarrierSegmentStatus.Blocked);
    Status(changed, P(0, -.5), P(0, .5), MixedBarrierSegmentStatus.Blocked); Status(changed, P(-2, 2), P(2, 2), MixedBarrierSegmentStatus.Clear);
    var split = input.SelectMany((fragment, at) => new[] {
        fragment with { Source = fragment.Source with { FragmentId = at * 2 + 1 }, TriangleIndices = fragment.TriangleIndices.Take(18).ToArray() },
        fragment with { Source = fragment.Source with { FragmentId = at * 2 + 2 }, TriangleIndices = fragment.TriangleIndices.Skip(18).ToArray() } }).ToArray();
    var assembled = Kernel(split); Need(assembled.Summary.FragmentCount == 4 && assembled.Summary.QualifiedClosedSolidComponents == 2);
    OriginalInputsRetained(assembled, split);
});
Run("duplicate original faces attribute the exact repeated owner and cannot become duplicated open surfaces", () => {
    var input = OwnerContactInputs(identicalCaps: true);
    var sameOwner = input.Select(fragment => fragment with { Source = fragment.Source with { OwnerObjectId = "dbid:10" } }).ToArray();
    var duplicate = MixedBarrierKernel.Build(sameOwner);
    Need(duplicate.Kernel is null && duplicate.Diagnostics.Single().Code == "DUPLICATE_TRIANGLE");
    Need(duplicate.RefusalObjectIds!.SequenceEqual(new[] { "dbid:10" }));
    var repeatedSecond = MixedBarrierKernel.Build([.. input, input[1] with { Source = input[1].Source with { FragmentId = 3 } }]);
    Need(repeatedSecond.Kernel is null && repeatedSecond.Diagnostics.Single().Code == "DUPLICATE_TRIANGLE");
    Need(repeatedSecond.RefusalObjectIds!.SequenceEqual(new[] { "dbid:20" }));
    var surface = new Mesh([P(0), P(0, 1), P(0, 0, 1)], [0, 1, 2]);
    var first = Input(surface); var second = Input(Reverse(surface), fragment: 2);
    second = second with { Source = second.Source with { OwnerObjectId = "dbid:20" } };
    var sheets = MixedBarrierKernel.Build([first, second]);
    Need(sheets.Kernel is null && sheets.Diagnostics.Single().Code == "DUPLICATE_TRIANGLE");
    Need(sheets.RefusalObjectIds!.SequenceEqual(new[] { "dbid:10", "dbid:20" }));
    var capture = Capture(Merge(surface, Reverse(surface)), splitTriangles: true);
    capture["fragments"]![1]!["source"]!["ownerObjectId"] = "dbid:20";
    var receipt = MixedBarrierCaptureVerifier.Verify(Bytes(capture)).Receipt;
    Need(receipt.Status == "refused" && receipt.Diagnostics.Single().Code == "DUPLICATE_TRIANGLE");
    Need(receipt.Diagnostics.Single().ObjectIds!.SequenceEqual(new[] { "dbid:10", "dbid:20" }));
    using var json = JsonDocument.Parse(MixedBarrierCaptureVerifier.ReceiptBytes(receipt));
    Need(json.RootElement.GetProperty("diagnostics")[0].GetProperty("objectIds").EnumerateArray().Select(owner => owner.GetString()).SequenceEqual(new[] { "dbid:10", "dbid:20" }));
});
Run("identical cap hints cannot accept open nested coincident or self-intersecting closed bodies", () => {
    var input = OwnerContactInputs(identicalCaps: true);
    var open = input.ToArray(); open[0] = open[0] with { TriangleIndices = open[0].TriangleIndices.Skip(3).ToArray() };
    var opened = MixedBarrierKernel.Build(open); Need(opened.Kernel is null && opened.Diagnostics.Single().Code == "NONMANIFOLD_EDGE");
    var nested = MixedBarrierKernel.Build([.. input, Input(Box(-.8, -.2, -.5, .5, -.5, .5), fragment: 3)]);
    Need(nested.Kernel is null && nested.Diagnostics.Single().Code == "NESTED_OR_AMBIGUOUS_SHELLS");
    var coincident = input[0] with { Source = input[0].Source with { FragmentId = 3, OwnerObjectId = "dbid:30" } };
    var overlapping = MixedBarrierKernel.Build([input[0], coincident]);
    Need(overlapping.Kernel is null && overlapping.Diagnostics.Single().Code == "NESTED_OR_AMBIGUOUS_SHELLS");
    var vertices = input[0].Vertices.ToArray(); vertices[0] = P(-.1, 0, 3);
    var invalid = MixedBarrierKernel.Build([input[0] with { Vertices = vertices }, input[1]]);
    Need(invalid.Kernel is null && invalid.Diagnostics.Single().Code == "CLOSED_SOLID_QUALIFICATION_REFUSED");
});
Run("identical cap witnesses remain within shared work memory and component limits", () => {
    var input = OwnerContactInputs(identicalCaps: true); var good = MixedBarrierKernel.Build(input); Need(good.Kernel is not null);
    var work = MixedBarrierKernel.Build(input, new() { Geometry = new() { MaximumBuildWork = good.Work - 1 } });
    Need(work.Kernel is null && work.Work <= good.Work - 1 && work.Diagnostics.Single().Code == "WORK_LIMIT");
    var memory = MixedBarrierKernel.Build(input, new() { Geometry = new() { MaximumEstimatedBytes = good.Kernel!.Summary.EstimatedBytes - 1 } });
    Need(memory.Kernel is null && memory.Diagnostics.Single().Code == "ESTIMATED_MEMORY_LIMIT");
    var components = MixedBarrierKernel.Build(input, new() { Geometry = new() { MaximumMeshes = 1 } });
    Need(components.Kernel is null && components.Diagnostics.Single().Code == "COMPONENT_LIMIT");
});
Run("native mixed verifier protocols retain identical closed caps and both duplicate refusal owners", () => {
    var closed = Capture(Merge(Box(-1, 0, -1, 1, -1, 1), Box(0, 1, -1, 1, -1, 1)), splitTriangles: true);
    foreach (var fragment in closed["fragments"]!.AsArray().Skip(12)) fragment!["source"]!["ownerObjectId"] = "dbid:20";
    var surface = new Mesh([P(0), P(0, 1), P(0, 0, 1)], [0, 1, 2]);
    var sheets = Capture(Merge(surface, Reverse(surface)), splitTriangles: true);
    sheets["fragments"]![1]!["source"]!["ownerObjectId"] = "dbid:20";
    foreach (string mode in new[] { "--mixed-v2", "--mixed-v2-2048" }) {
        var qualified = NativeReceipt(Bytes(closed), mode);
        Need(qualified.GetProperty("status").GetString() == "geometry-qualified", qualified.GetRawText());
        Need(qualified.GetProperty("evidence").GetProperty("qualifiedClosedSolidComponents").GetInt32() == 2);
        Need(qualified.GetProperty("evidence").GetProperty("triangleCount").GetInt32() == 24);
        var refused = NativeReceipt(Bytes(sheets), mode); Need(refused.GetProperty("status").GetString() == "refused");
        var diagnostic = refused.GetProperty("diagnostics")[0]; Need(diagnostic.GetProperty("code").GetString() == "DUPLICATE_TRIANGLE");
        Need(diagnostic.GetProperty("objectIds").EnumerateArray().Select(owner => owner.GetString()).SequenceEqual(new[] { "dbid:10", "dbid:20" }));
    }
});
Run("owner-contact pairing assembles original owners across fragments without using fragment identity as a body", () => {
    var source = OwnerContactInputs(); var input = source.SelectMany((fragment, at) => new[] {
        fragment with { Source = fragment.Source with { FragmentId = at * 2 + 1 }, TriangleIndices = fragment.TriangleIndices.Take(18).ToArray() },
        fragment with { Source = fragment.Source with { FragmentId = at * 2 + 2 }, TriangleIndices = fragment.TriangleIndices.Skip(18).ToArray() } }).ToArray();
    var kernel = Kernel(input); Need(kernel.Summary.FragmentCount == 4 && kernel.Summary.QualifiedClosedSolidComponents == 2 && kernel.Summary.OriginalSurfaceComponents == 0);
    OriginalInputsRetained(kernel, input); Need(kernel.Components.All(component => component.Triangles.Select(triangle => triangle.Source.FragmentId).Distinct().Count() == 2));
});
Run("owner-contact hints cannot accept one-plus-three same-direction same-owner or opened assemblies", () => {
    var directions = new[] { 1, -1, 1, -1 }; var owners = new[] { "dbid:10", "dbid:10", "dbid:10", "dbid:20" };
    var tips = new[] { P(1), P(0, 1), P(-1), P(0, -1) };
    MixedFragmentInput[] Sheets(int[] winding, string[] identity) => tips.Select((tip, at) => {
        var mesh = new Mesh([P(0, 0, -1), P(0, 0, 1), tip], winding[at] == 1 ? [0, 1, 2] : [1, 0, 2]);
        var fragment = Input(mesh, at + 1); return fragment with { Source = fragment.Source with { OwnerObjectId = identity[at] } };
    }).ToArray();
    void RefuseInputs(MixedFragmentInput[] input) { var result = MixedBarrierKernel.Build(input); Need(result.Kernel is null && result.Diagnostics.Single().Code == "NONMANIFOLD_EDGE"); }
    RefuseInputs(Sheets(directions, owners));
    RefuseInputs(Sheets([1, 1, -1, -1], ["dbid:10", "dbid:10", "dbid:20", "dbid:20"]));
    var sameOwner = OwnerContactInputs().Select(fragment => fragment with { Source = fragment.Source with { OwnerObjectId = "dbid:10" } }).ToArray(); RefuseInputs(sameOwner);
    var opened = OwnerContactInputs(); opened[0] = opened[0] with { TriangleIndices = opened[0].TriangleIndices.Take(6).Concat(opened[0].TriangleIndices.Skip(9)).ToArray() }; RefuseInputs(opened);
});
Run("owner-contact fallback retains unchanged solid nested and duplicate qualification", () => {
    var input = OwnerContactInputs(); var vertices = input[0].Vertices.ToArray(); vertices[0] = P(-.1, 0, 3);
    var invalid = MixedBarrierKernel.Build([input[0] with { Vertices = vertices }, input[1]]);
    Need(invalid.Kernel is null && invalid.Diagnostics.Single().Code == "CLOSED_SOLID_QUALIFICATION_REFUSED");
    var duplicate = MixedBarrierKernel.Build([.. input, input[0] with { Source = input[0].Source with { FragmentId = 3 } }]);
    Need(duplicate.Kernel is null && duplicate.Diagnostics.Single().Code == "DUPLICATE_TRIANGLE");
    var nested = MixedBarrierKernel.Build([.. input, Input(Box(-.8, -.2, -.5, .5, -.5, .5), fragment: 3)]);
    Need(nested.Kernel is null && nested.Diagnostics.Single().Code == "NESTED_OR_AMBIGUOUS_SHELLS");
});
Run("owner-contact fallback uses one cumulative work and memory budget", () => {
    var input = OwnerContactInputs(); var good = MixedBarrierKernel.Build(input); Need(good.Kernel is not null);
    var work = MixedBarrierKernel.Build(input, new() { Geometry = new() { MaximumBuildWork = good.Work - 1 } });
    Need(work.Kernel is null && work.Work <= good.Work - 1 && work.Diagnostics.Single().Code == "WORK_LIMIT");
    var memory = MixedBarrierKernel.Build(input, new() { Geometry = new() { MaximumEstimatedBytes = 50000 } });
    Need(memory.Kernel is null && memory.Diagnostics.Single().Code == "ESTIMATED_MEMORY_LIMIT" && good.Kernel!.Summary.EstimatedBytes > 50000);
    var parents = Enumerable.Range(0, 128).Select(at => Id(201 + at)).ToArray();
    var shared = input.Select(fragment => fragment with { Source = fragment.Source with { ParentSelectionIds = parents } }).ToArray();
    var combined = MixedBarrierKernel.Build(shared, new() { MaximumParents = 2048, Geometry = new() { MaximumMeshes = 2048, MaximumEstimatedBytes = 120000 } });
    Need(combined.Kernel is null && combined.Diagnostics.Single().Code == "ESTIMATED_MEMORY_LIMIT");
});
Run("point-contact original surfaces retain both fans and block either lobe and their shared point", () => {
    var bowtie = new Mesh([P(0), P(0, 1), P(0, 0, 1), P(0, -1), P(0, 0, -1)], [0, 1, 2, 0, 3, 4]);
    var result = Ready(Capture(bowtie)); Need(result.Receipt.Evidence!.OriginalSurfaceComponents == 2 && result.Receipt.Evidence.QualifiedClosedSolidComponents == 0);
    Status(result.Qualified!.Kernel, P(-1, .2, .2), P(1, .2, .2), MixedBarrierSegmentStatus.Blocked);
    Status(result.Qualified.Kernel, P(-1, -.2, -.2), P(1, -.2, -.2), MixedBarrierSegmentStatus.Blocked);
    Status(result.Qualified.Kernel, P(-1), P(1), MixedBarrierSegmentStatus.Blocked);
    Status(result.Qualified.Kernel, P(-1, .2, -.2), P(1, .2, -.2), MixedBarrierSegmentStatus.Clear);
    OriginalMeshRetained(result.Qualified.Kernel, bowtie);
});
Run("closed shells sharing only a pinched vertex cannot become original surfaces", () => {
    var first = Box(-1, 0, -1, 0, -1, 0); var second = Box(0, 1, 0, 1, 0, 1);
    Refused(Capture(Merge(first, second)), code: "NONMANIFOLD_VERTEX");
});
Run("an original surface touching a closed shell cannot exempt its disconnected closed fan", () => {
    var box = Box(-1, 0, -1, 0, -1, 0); var surface = new Mesh([P(0), P(1), P(0, 1)], [0, 1, 2]);
    Refused(Capture(Merge(box, surface)), code: "NONMANIFOLD_VERTEX");
});
Run("actual Aalborg2772 retains every triangle and bit while both reconnecting open fans block", () => {
    var mesh = OriginalPointContactFixture.Aalborg2772(); var result = Ready(Capture(mesh));
    Need(mesh.Vertices.Length == 115 && mesh.Indices.Length == 216);
    Need(result.Receipt.Evidence!.OriginalSurfaceComponents == 1 && result.Receipt.Evidence.QualifiedClosedSolidComponents == 0);
    OriginalMeshRetained(result.Qualified!.Kernel, mesh);
    foreach (int triangle in new[] { 50, 70, 71 }) {
        var a = mesh.Vertices[mesh.Indices[3 * triangle]]; var b = mesh.Vertices[mesh.Indices[3 * triangle + 1]]; var c = mesh.Vertices[mesh.Indices[3 * triangle + 2]];
        var centre = P((a.X + b.X + c.X) / 3, (a.Y + b.Y + c.Y) / 3, (a.Z + b.Z + c.Z) / 3);
        Status(result.Qualified.Kernel, centre with { Z = centre.Z - .1 }, centre with { Z = centre.Z + .1 }, MixedBarrierSegmentStatus.Blocked);
    }
    var vertex = mesh.Vertices[92];
    Status(result.Qualified.Kernel, vertex with { Z = vertex.Z - .1 }, vertex with { Z = vertex.Z + .1 }, MixedBarrierSegmentStatus.Blocked);
    Need(BarrierCaptureVerifier.Verify(Bytes(Capture(mesh))).Receipt.Status == "refused");
});
Run("a self-intersecting closed candidate cannot downgrade into a surface", () => {
    var box = Box(); var vertices = box.Vertices.ToArray(); vertices[6] = P(.1, 0, -3); Refused(Capture(box with { Vertices = vertices }), code: "CLOSED_SOLID_QUALIFICATION_REFUSED");
});
Run("closed-solid refusal attributes only the witnessed original component owners", () => {
    var box = Box(); var vertices = box.Vertices.ToArray(); vertices[6] = P(.1, 0, -3); var invalid = box with { Vertices = vertices };
    var first = Input(Transform(Box(), p => p with { X = p.X + 20 }), fragment: 1);
    var second = Input(invalid, fragment: 2); second = second with { Source = second.Source with { OwnerObjectId = "dbid:20" } };
    var built = MixedBarrierKernel.Build([first, second]);
    Need(built.Status == BarrierBuildStatus.Refused && built.Diagnostics.Single().Code == "CLOSED_SOLID_QUALIFICATION_REFUSED");
    Need(built.RefusalObjectIds is not null && built.RefusalObjectIds.SequenceEqual(new[] { "dbid:20" }));
    var receipt = MixedBarrierCaptureVerifier.Verify(Bytes(Capture(invalid))).Receipt;
    Need(receipt.Status == "refused" && receipt.Diagnostics.Single().ObjectIds!.SequenceEqual(new[] { "dbid:10" }));
    using var json = JsonDocument.Parse(MixedBarrierCaptureVerifier.ReceiptBytes(receipt));
    Need(json.RootElement.GetProperty("diagnostics")[0].GetProperty("objectIds")[0].GetString() == "dbid:10");
    var global = MixedBarrierKernel.Build([first, second], new() { Geometry = new() { MaximumBuildWork = 1 } });
    Need(global.Status == BarrierBuildStatus.Refused && global.RefusalObjectIds is null);
});
Run("split fragments and overlapping selected parents preserve exact source ownership and original indices", () => {
    var result = Ready(Capture(Wall(), splitTriangles: true, sharedParents: true)); var triangles = result.Qualified!.Components.Single().Triangles;
    Need(triangles.Count == 2 && triangles[0].Source.FragmentId == 1 && triangles[1].Source.FragmentId == 2);
    Need(triangles.All(t => t.Source.OwnerObjectId == "dbid:10" && t.Source.ParentSelectionIds.Count == 2 && t.LocalTriangleIndex == 0 && t.OriginalVertexA == 0 && t.OriginalVertexB == 1 && t.OriginalVertexC == 2));
    var membership = result.Receipt.Evidence!.ComponentMemberships.Single(); Need(membership.Kind == "original-surface" && membership.FragmentIds.SequenceEqual(new[] { 1, 2 }) && membership.ParentSelectionIds.SequenceEqual(new[] { Id(201), Id(202) }) && membership.TriangleCount == 2);
});
Run("component membership digest independently matches canonical source-owner-parent-index projection", () => {
    var capture = Capture(Wall()); var bytes = Bytes(capture); var result = Ready(capture); var membership = result.Receipt.Evidence!.ComponentMemberships.Single();
    string parent = Id(201), captureHash = BarrierCaptureVerifier.Hash(bytes);
    string projection = "{\"domain\":\"wfc.pf.mixed-original-component-membership.v2\",\"value\":{\"captureSha256\":\"" + captureHash
        + "\",\"componentId\":\"component:000000\",\"kind\":\"original-surface\",\"triangles\":[{\"fragmentId\":1,\"localTriangleIndex\":0,\"originalVertexIndices\":[0,1,2],\"ownerObjectId\":\"dbid:10\",\"parentSelectionIds\":[\"" + parent
        + "\"]},{\"fragmentId\":1,\"localTriangleIndex\":1,\"originalVertexIndices\":[0,2,3],\"ownerObjectId\":\"dbid:10\",\"parentSelectionIds\":[\"" + parent + "\"]}]}}";
    Need(membership.SourceMembershipSha256 == BarrierCaptureVerifier.Hash(Encoding.UTF8.GetBytes(projection)));
});
Run("raw capture bytes bind receipts while original geometry decomposition stays deterministic", () => {
    var bytes = Bytes(Capture(Ring())); var a = MixedBarrierCaptureVerifier.Verify(bytes); var b = MixedBarrierCaptureVerifier.Verify(bytes);
    var c = MixedBarrierCaptureVerifier.Verify(bytes.Concat(new byte[] { 10 }).ToArray());
    var evidenceA = a.Receipt.Evidence ?? throw new Exception("First valid capture has no evidence.");
    var evidenceB = b.Receipt.Evidence ?? throw new Exception("Repeated valid capture has no evidence.");
    var evidenceC = c.Receipt.Evidence ?? throw new Exception("Whitespace variant has no evidence.");
    Need(a.Receipt.CaptureSha256 == BarrierCaptureVerifier.Hash(bytes) && a.Receipt.CaptureSha256 == b.Receipt.CaptureSha256 && a.Receipt.CaptureSha256 != c.Receipt.CaptureSha256);
    Need(evidenceA.OriginalGeometrySha256 == evidenceB.OriginalGeometrySha256 && evidenceA.OriginalGeometrySha256 == evidenceC.OriginalGeometrySha256);
    Need(evidenceA.VerificationSha256 != evidenceC.VerificationSha256 && evidenceA.ComponentMemberships[0].SourceMembershipSha256 != evidenceC.ComponentMemberships[0].SourceMembershipSha256);
});
Run("accepted split-fragment closed-frame and open-ring evidence keeps its pre-partition hashes", () => {
    // Captured from the unchanged native verifier before the overfull-edge fix.
    // Each capture shares every original fragment between two selected parents.
    foreach (var fixture in new[] {
        (Mesh: Frame(), CaptureHash: "610c88cc40ec132bda946c3dedf2c005b7727c2bc858a50aa45eeca76a64eadd", Geometry: "f8f74040eb47d2af33677b30f84f6cb40a2f04e328ce8b3f13e56b18d0d73f0e", Membership: "7d4732576b85dcd7a6710625072720cf03cfe463572c172aef08fa97c82d7c2e", Verification: "f6f57fb326379211dc88b57f861c750d759b30792b4e20b2da9ed715f9f64854"),
        (Mesh: Ring(), CaptureHash: "b89770c5843a4554bb1cf91b84e7f6c6044ef873ae6fb0acc1db6ccae56f9899", Geometry: "47ac12ef42e8c80eb705d495de501cca5e735de087869d573672895077727e33", Membership: "bd35983d03ae7b22531a8e427831959b6413052f4d6bf93e020fffeeee5f2d01", Verification: "dc4e57163c1fa64bf49055e614aea1df26555147dd60939b07b01e0292c71b9c") }) {
        var result = Ready(Capture(fixture.Mesh, splitTriangles: true, sharedParents: true)); var evidence = result.Receipt.Evidence!;
        Need(result.Receipt.CaptureSha256 == fixture.CaptureHash, result.Receipt.CaptureSha256!);
        Need(evidence.OriginalGeometrySha256 == fixture.Geometry && evidence.VerificationSha256 == fixture.Verification);
        Need(evidence.ComponentMemberships.Single().SourceMembershipSha256 == fixture.Membership);
    }
});
Run("original point and matrix signed-zero bits remain detached and affect source digest", () => {
    double negativeZero = BitConverter.Int64BitsToDouble(long.MinValue); var mesh = Wall(); var points = mesh.Vertices.ToArray(); points[0] = P(negativeZero, points[0].Y, points[0].Z);
    var input = Input(mesh with { Vertices = points }); var matrix = input.Source.SourceToWorldBits.ToArray(); matrix[1] = long.MinValue; input = input with { Source = input.Source with { SourceToWorldBits = matrix } };
    var a = Kernel(input); var source = a.Components.Single().Triangles[0]; Need(BitConverter.DoubleToInt64Bits(source.A.X) == long.MinValue && source.Source.SourceToWorldBits[1] == long.MinValue);
    matrix[1] = 0; points[0] = P(0, points[0].Y, points[0].Z); var b = Kernel(input);
    Need(a.Summary.OriginalGeometrySha256 != b.Summary.OriginalGeometrySha256); Need(source.Source.SourceToWorldBits[1] == long.MinValue);
});
Run("mutable input arrays cannot change qualified geometry and public lists refuse edits", () => {
    var mesh = Wall(); var parents = new[] { Id(201) }; var input = Input(mesh, parents: parents); var matrix = input.Source.SourceToWorldBits.ToArray(); input = input with { Source = input.Source with { SourceToWorldBits = matrix } };
    var kernel = Kernel(input); string hash = kernel.Summary.OriginalGeometrySha256; mesh.Vertices[0] = P(99); mesh.Indices[0] = 999; matrix[0] = 0; parents[0] = Id(999);
    Status(kernel, P(-1), P(1), MixedBarrierSegmentStatus.Blocked); Need(kernel.Summary.OriginalGeometrySha256 == hash);
    var triangle = kernel.Components[0].Triangles[0]; bool pointsProtected = false, parentsProtected = false, matrixProtected = false;
    try { ((IList<MixedOriginalTriangle>)kernel.Components[0].Triangles)[0] = default; } catch (NotSupportedException) { pointsProtected = true; }
    try { ((IList<string>)triangle.Source.ParentSelectionIds)[0] = Id(999); } catch (NotSupportedException) { parentsProtected = true; }
    try { ((IList<long>)triangle.Source.SourceToWorldBits)[0] = 0; } catch (NotSupportedException) { matrixProtected = true; }
    Need(pointsProtected && parentsProtected && matrixProtected && triangle.Source.ParentSelectionIds[0] == Id(201));
});
Run("caller mutation of parsed bytes after verification cannot mutate retained kernel", () => {
    byte[] bytes = Bytes(Capture(Wall())); var result = MixedBarrierCaptureVerifier.Verify(bytes); Array.Fill(bytes, (byte)'x'); Status(result.Qualified!.Kernel, P(-1), P(1), MixedBarrierSegmentStatus.Blocked);
});
Run("no broad parent or object terminal exemptions are available", () => {
    var result = Ready(Capture(Box(-1, 1, -1, 1, -1, 1))); Need(!result.Receipt.Evidence!.OwnTerminalExemptionsSupported && result.Receipt.Evidence.Authority == "none");
    var query = result.Qualified!.Kernel.CheckSegment(P(0), P(2)); Need(query.Status == MixedBarrierSegmentStatus.Blocked && !query.OwnTerminalExemptionsSupported);
});
Run("receipt fixed 64 KiB bound refuses excess component memberships without truncation", () => Refused(LargeMembershipCapture(), code: "RECEIPT_BYTES_LIMIT"));
Run("aggregate counts component source parent byte and work limits refuse closed", () => {
    Refused(Capture(Box()), new() { MaximumVertices = 7 }); Refused(Capture(Box()), new() { MaximumTriangles = 11 });
    Refused(Capture(Wall(), splitTriangles: true), new() { MaximumFragments = 1 }); Refused(Capture(Wall(), sharedParents: true), new() { MaximumParents = 1 });
    Refused(Capture(Merge(Wall(), Box(5, 6))), new() { MaximumComputationalMeshes = 1 }, "COMPONENT_LIMIT");
    Refused(Capture(Wall()), new() { MaximumWork = 1 }, "WORK_LIMIT"); var bytes = Bytes(Capture(Wall())); Need(MixedBarrierCaptureVerifier.Verify(bytes, new() { MaximumBytes = bytes.Length - 1 }).Receipt.CaptureSha256 is null);
});
Run("conservative temporary memory estimate refuses before topology allocation", () => {
    var result = MixedBarrierKernel.Build([Input(Wall())], new() { Geometry = new() { MaximumEstimatedBytes = 1 } }); Need(result.Status == BarrierBuildStatus.Refused && result.Kernel is null && result.Diagnostics.Any(d => d.Code == "ESTIMATED_MEMORY_LIMIT"));
});
Run("direct kernel factory bounds the global parent union rather than only each fragment", () => {
    var result = MixedBarrierKernel.Build([Input(Wall(), 1, new[] { Id(201) }), Input(Transform(Wall(), p => P(p.X + 5, p.Y, p.Z)), 2, new[] { Id(202) })], new() { MaximumParents = 1 });
    Need(result.Status == BarrierBuildStatus.Refused && result.Kernel is null && result.Diagnostics.Any(d => d.Code == "PARENT_LIMIT"));
});
Run("fragment sort work exhaustion unwraps into a closed refusal", () => {
    var result = MixedBarrierKernel.Build([Input(Wall(), 2), Input(Transform(Wall(), p => P(p.X + 5, p.Y, p.Z)), 1)], new() { Geometry = new() { MaximumBuildWork = 56 } });
    Need(result.Status == BarrierBuildStatus.Refused && result.Kernel is null && result.Work == 56 && result.Diagnostics.Any(d => d.Code == "WORK_LIMIT"));
});
Run("fragment sort cancellation preserves original cancellation token", () => {
    using var cancellation = new CancellationTokenSource(); var first = Input(Wall(), 2); var second = Input(Transform(Wall(), p => P(p.X + 5, p.Y, p.Z)), 1);
    second = second with { TriangleIndices = new CancellingIndices(second.TriangleIndices, cancellation) };
    Cancelled(() => MixedBarrierKernel.Build([first, second], cancellationToken: cancellation.Token), cancellation.Token);
});
Run("finite delayed input cannot reset the original build deadline", () => {
    IEnumerable<MixedFragmentInput> Slow() { Thread.Sleep(20); yield return Input(Wall()); }
    var result = MixedBarrierKernel.Build(Slow(), new() { Geometry = new() { MaximumBuildMilliseconds = 1 } }); Need(result.Status == BarrierBuildStatus.Refused && result.Diagnostics.Any(d => d.Code == "DEADLINE_EXCEEDED"));
});
Run("single combined contact and occupancy work budget returns indeterminate", () => {
    var kernel = Kernel(Input(Wall(), 1), Input(Box(5, 6, -1, 1, -1, 1), 2));
    var result = kernel.CheckSegment(P(1), P(4), new() { MaximumWork = 1 }); Need(result.Status == MixedBarrierSegmentStatus.Indeterminate && result.Witness is null);
    var tight = MixedBarrierKernel.Build([Input(Wall())], new() { Geometry = new() { MaximumQueryWork = 1 } }).Kernel!;
    Need(tight.CheckSegment(P(-1), P(1)).Status == MixedBarrierSegmentStatus.Indeterminate && tight.CheckSegment(P(-1), P(1), new() { MaximumWork = 2 }).Reason == "INVALID_QUERY");
});
Run("invalid query coordinate or deadline budget never produces clear", () => {
    var kernel = Kernel(Input(Wall())); Need(kernel.CheckSegment(P(double.NaN), P(1)).Status == MixedBarrierSegmentStatus.Indeterminate);
    Need(kernel.CheckSegment(P(-1), P(1), new() { MaximumMilliseconds = 0 }).Status == MixedBarrierSegmentStatus.Indeterminate);
});
Run("cancellation propagates before verifier build and query can return usable results", () => {
    using var cancellation = new CancellationTokenSource(); var kernel = Kernel(Input(Wall())); cancellation.Cancel();
    Cancelled(() => MixedBarrierCaptureVerifier.Verify(Bytes(Capture(Wall())), cancellationToken: cancellation.Token), cancellation.Token);
    Cancelled(() => MixedBarrierKernel.Build([Input(Wall())], cancellationToken: cancellation.Token), cancellation.Token);
    Cancelled(() => kernel.CheckSegment(P(-1), P(1), cancellationToken: cancellation.Token), cancellation.Token);
});
Run("legacy v1 open-floor refusal and closed-solid wire contract remain unchanged", () => {
    var open = BarrierCaptureVerifier.Verify(Bytes(Capture(Wall()))); var closed = BarrierCaptureVerifier.Verify(Bytes(Capture(Box())));
    Need(open.Receipt.SchemaVersion == "wfc.pf.barrier-verification-result.v1" && open.Receipt.Status == "refused" && open.Qualified is null);
    Need(closed.Receipt.SchemaVersion == "wfc.pf.barrier-verification-result.v1" && closed.Receipt.Status == "geometry-qualified" && closed.Qualified is not null);
});
Run("new result flags component union and serialized receipt identify only provided mixed geometry", () => {
    var result = Ready(Capture(Merge(Wall(), Box(5, 6)))); var evidence = result.Receipt.Evidence!; var json = JsonDocument.Parse(MixedBarrierCaptureVerifier.ReceiptBytes(result.Receipt));
    Need(result.Receipt.SchemaVersion == "wfc.pf.barrier-mixed-verification-result.v2" && evidence.PolicyVersion == MixedBarrierKernel.PolicyVersion && evidence.InputSchemaVersion == "wfc.pf.barrier-capture.v1");
    Need(evidence.ComponentMemberships.Count == evidence.OriginalSurfaceComponents + evidence.QualifiedClosedSolidComponents && evidence.ComponentMemberships.Sum(c => c.TriangleCount) == evidence.TriangleCount);
    Need(!evidence.SdkCoverageVerified && !evidence.SdkSourceBytesVerified && !evidence.CurrentFrameVerified && !evidence.EngineeringAccepted && evidence.Authority == "none");
    Need(json.RootElement.GetProperty("evidence").GetProperty("componentMemberships").GetArrayLength() == 2); json.Dispose();
});
if (args.Length != 0 && args[0] == "--retained-owner-contact")
{
    if (args.Length != 2 || !Path.IsPathFullyQualified(args[1])) throw new ArgumentException("Only an absolute pinned owner-contact capture fixture is supported.");
    Run("exact retained owner-contact capture preserves every original and independently verifies all seven closed solids", () => {
        const string expectedHash = "8b6c06116a1ce5f5d4589d7350105cadb72301062fa0fea062b86999fad48ac6";
        Need(new FileInfo(args[1]).Length == 63293); byte[] bytes = File.ReadAllBytes(args[1]); Need(BarrierCaptureVerifier.Hash(bytes) == expectedHash);
        var result = MixedBarrierCaptureVerifier.Verify(bytes); Need(result.Qualified is not null && result.Receipt.Evidence is not null, JsonSerializer.Serialize(result.Receipt));
        var evidence = result.Receipt.Evidence!; var kernel = result.Qualified!.Kernel;
        Need(evidence.FragmentCount == 7 && evidence.VertexCount == 852 && evidence.TriangleCount == 756 && evidence.QualifiedClosedSolidComponents == 7 && evidence.OriginalSurfaceComponents == 0);
        using var document = JsonDocument.Parse(bytes); var capture = document.RootElement;
        var fragments = capture.GetProperty("fragments").EnumerateArray().ToDictionary(fragment => fragment.GetProperty("source").GetProperty("fragmentId").GetInt32());
        Need(fragments.Keys.Order().SequenceEqual(new[] { 109, 113, 136, 1686, 1688, 1708, 2683 }));
        var triangles = result.Qualified.Components.SelectMany(component => component.Triangles).ToArray();
        Need(triangles.Length == 756 && triangles.Select(triangle => (triangle.Source.FragmentId, triangle.LocalTriangleIndex)).Distinct().Count() == 756);
        foreach (var triangle in triangles) {
            var fragment = fragments[triangle.Source.FragmentId]; var source = fragment.GetProperty("source"); var indices = fragment.GetProperty("triangleIndices"); var vertices = fragment.GetProperty("verticesMetres");
            Need(triangle.Source.OwnerObjectId == source.GetProperty("ownerObjectId").GetString());
            Need(triangle.Source.ParentSelectionIds.SequenceEqual(source.GetProperty("parentSelectionIds").EnumerateArray().Select(parent => parent.GetString()!).Order(StringComparer.Ordinal)));
            Need(triangle.Source.SourceUnits == source.GetProperty("sourceUnits").GetString() && BitConverter.DoubleToInt64Bits(triangle.Source.MetresPerSourceUnit) == BitConverter.DoubleToInt64Bits(source.GetProperty("metresPerSourceUnit").GetDouble()));
            Need(triangle.Source.SourceToWorldBits.SequenceEqual(source.GetProperty("sourceToWorldMetres").EnumerateArray().Select(value => BitConverter.DoubleToInt64Bits(value.GetDouble()))));
            int[] original = [triangle.OriginalVertexA, triangle.OriginalVertexB, triangle.OriginalVertexC]; BarrierPoint[] points = [triangle.A, triangle.B, triangle.C];
            for (int at = 0; at < 3; at++) {
                Need(original[at] == indices[triangle.LocalTriangleIndex * 3 + at].GetInt32()); var point = vertices[original[at]];
                Need(SameBits(points[at], P(point[0].GetDouble(), point[1].GetDouble(), point[2].GetDouble())));
            }
        }
        Need(evidence.ComponentMemberships.Sum(member => member.TriangleCount) == 756 && evidence.ComponentMemberships.SelectMany(member => member.FragmentIds).Distinct().Count() == 7);
        Need(evidence.ComponentMemberships.All(member => member.FragmentIds.Count == 1) && evidence.ComponentMemberships.SelectMany(member => member.FragmentIds).Count() == 7);
        var parents = capture.GetProperty("selectedParents").EnumerateArray().Select(parent => parent.GetProperty("selectionId").GetString()!).Order(StringComparer.Ordinal);
        Need(evidence.ComponentMemberships.SelectMany(member => member.ParentSelectionIds).Distinct().Order(StringComparer.Ordinal).SequenceEqual(parents));
        foreach (string owner in new[] { "dbid:29713", "dbid:29711" }) {
            var body = kernel.Components.Single(component => component.Triangles.All(triangle => triangle.Source.OwnerObjectId == owner));
            Need(body.Kind == MixedBarrierComponentKind.QualifiedClosedSolid && body.Triangles.Count == 12);
            var vertices = body.Triangles.SelectMany(triangle => new[] { triangle.A, triangle.B, triangle.C }).Distinct().ToArray(); Need(vertices.Length == 8);
            var centre = P(vertices.Average(point => point.X), vertices.Average(point => point.Y), vertices.Average(point => point.Z));
            Status(kernel, centre with { Y = centre.Y - .1 }, centre with { Y = centre.Y + .1 }, MixedBarrierSegmentStatus.Blocked);
            Status(kernel, centre, centre, MixedBarrierSegmentStatus.Blocked);
            Status(kernel, centre with { Z = centre.Z - .1 }, centre with { Z = centre.Z + .1 }, MixedBarrierSegmentStatus.Blocked);
        }
        Status(kernel, P(-5, -5, -5), P(-4, -4, -4), MixedBarrierSegmentStatus.Clear);
        Need(BarrierCaptureVerifier.Hash(File.ReadAllBytes(args[1])) == expectedHash);
    });
}
else if (args.Length != 0)
{
    if (args.Length != 2 || args[0] != "--retained-capture" || !Path.IsPathFullyQualified(args[1])) throw new ArgumentException("Only the explicit pinned retained-capture fixture is supported.");
    Run("exact retained27 capture qualifies with complete original ownership indices bits and component membership", () => {
        var input = new FileInfo(args[1]); Need(input.Length == 355621, "Retained capture byte count changed.");
        byte[] bytes = File.ReadAllBytes(args[1]); Need(BarrierCaptureVerifier.Hash(bytes) == OriginalPointContactFixture.CaptureSha256, "Retained capture hash changed.");
        var result = MixedBarrierCaptureVerifier.Verify(bytes); Need(result.Receipt.Status == "geometry-qualified" && result.Qualified is not null, JsonSerializer.Serialize(result.Receipt));
        var evidence = result.Receipt.Evidence!; Need(evidence.FragmentCount == 27 && evidence.VertexCount == 5031 && evidence.TriangleCount == 3971);
        using var document = JsonDocument.Parse(bytes); var fragments = document.RootElement.GetProperty("fragments").EnumerateArray().ToDictionary(f => f.GetProperty("source").GetProperty("fragmentId").GetInt32());
        var triangles = result.Qualified!.Components.SelectMany(c => c.Triangles).ToArray(); Need(triangles.Length == 3971);
        Need(triangles.Select(t => (t.Source.FragmentId, t.LocalTriangleIndex)).Distinct().Count() == 3971);
        foreach (var triangle in triangles) {
            var fragment = fragments[triangle.Source.FragmentId]; var source = fragment.GetProperty("source"); var indices = fragment.GetProperty("triangleIndices"); var vertices = fragment.GetProperty("verticesMetres");
            Need(triangle.Source.OwnerObjectId == source.GetProperty("ownerObjectId").GetString());
            Need(triangle.Source.ParentSelectionIds.SequenceEqual(source.GetProperty("parentSelectionIds").EnumerateArray().Select(p => p.GetString()!).Order(StringComparer.Ordinal)));
            int offset = triangle.LocalTriangleIndex * 3; int[] original = [triangle.OriginalVertexA, triangle.OriginalVertexB, triangle.OriginalVertexC];
            BarrierPoint[] points = [triangle.A, triangle.B, triangle.C];
            for (int at = 0; at < 3; at++) {
                Need(original[at] == indices[offset + at].GetInt32()); var point = vertices[original[at]];
                Need(SameBits(points[at], P(point[0].GetDouble(), point[1].GetDouble(), point[2].GetDouble())));
            }
        }
        Need(evidence.ComponentMemberships.Sum(c => c.TriangleCount) == 3971 && evidence.ComponentMemberships.SelectMany(c => c.FragmentIds).Distinct().Count() == 27);
        var parentIds = document.RootElement.GetProperty("selectedParents").EnumerateArray().Select(p => p.GetProperty("selectionId").GetString()!).Order(StringComparer.Ordinal);
        Need(evidence.ComponentMemberships.SelectMany(c => c.ParentSelectionIds).Distinct().Order(StringComparer.Ordinal).SequenceEqual(parentIds));
        var actual = OriginalPointContactFixture.Aalborg2772();
        foreach (var triangle in triangles.Where(t => t.Source.FragmentId == 1095)) {
            int offset = triangle.LocalTriangleIndex * 3; Need(triangle.OriginalVertexA == actual.Indices[offset] && triangle.OriginalVertexB == actual.Indices[offset + 1] && triangle.OriginalVertexC == actual.Indices[offset + 2]);
            Need(SameBits(triangle.A, actual.Vertices[actual.Indices[offset]]) && SameBits(triangle.B, actual.Vertices[actual.Indices[offset + 1]]) && SameBits(triangle.C, actual.Vertices[actual.Indices[offset + 2]]));
        }
        Need(BarrierCaptureVerifier.Hash(File.ReadAllBytes(args[1])) == OriginalPointContactFixture.CaptureSha256);
    });
}

bool SameBits(BarrierPoint a, BarrierPoint b) => BitConverter.DoubleToInt64Bits(a.X) == BitConverter.DoubleToInt64Bits(b.X)
    && BitConverter.DoubleToInt64Bits(a.Y) == BitConverter.DoubleToInt64Bits(b.Y) && BitConverter.DoubleToInt64Bits(a.Z) == BitConverter.DoubleToInt64Bits(b.Z);
MixedFragmentInput CutFloorInput() {
    var input = MixedFixtures.Input(CutFloorIncidenceFixture.Gvl24429669(), 1961);
    return input with { Source = input.Source with { OwnerObjectId = "dbid:29669", SourceUnits = "mm", MetresPerSourceUnit = .001,
        TransformSha256 = "c3e78a01ed1603e4b137d8c5353baef8788ff6c9c0f20d26e99bb1735b1ce090",
        SourceToWorldBits = CutFloorIncidenceFixture.SourceToWorldMetres().Select(BitConverter.DoubleToInt64Bits).ToArray() } };
}
void CutFloorQueries(MixedBarrierKernel kernel) {
    Status(kernel, P(2.7, 72.1, 19.8), P(2.7, 72.1, 20.2), MixedBarrierSegmentStatus.Clear);
    Status(kernel, P(1, 72.2, 19.8), P(1, 72.2, 20.2), MixedBarrierSegmentStatus.Blocked);
    Status(kernel, P(1, 72.2, 19.9985), P(1, 72.2, 19.9985), MixedBarrierSegmentStatus.Blocked);
    var vertex = CutFloorIncidenceFixture.Gvl24429669().Vertices[3];
    Status(kernel, vertex, vertex, MixedBarrierSegmentStatus.Blocked);
}
JsonElement NativeReceipt(byte[] input, string mode) {
    var info = new System.Diagnostics.ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
    info.ArgumentList.Add(typeof(MixedBarrierCaptureVerifier).Assembly.Location); info.ArgumentList.Add(mode);
    using var child = System.Diagnostics.Process.Start(info) ?? throw new IOException("Native mixed verifier did not start.");
    using var deadline = new CancellationTokenSource(30000);
    async Task<byte[]> ReadBounded(Stream stream, int maximum) {
        using var memory = new MemoryStream(); byte[] buffer = new byte[32768];
        for (int count; (count = await stream.ReadAsync(buffer, deadline.Token)) != 0;) {
            if (memory.Length + count > maximum) throw new IOException("Native mixed verifier exceeded its bounded output.");
            memory.Write(buffer, 0, count);
        }
        return memory.ToArray();
    }
    var output = ReadBounded(child.StandardOutput.BaseStream, 65538); var error = ReadBounded(child.StandardError.BaseStream, 65536);
    try {
        child.StandardInput.BaseStream.WriteAsync(input, deadline.Token).AsTask().GetAwaiter().GetResult(); child.StandardInput.Close();
        child.WaitForExitAsync(deadline.Token).GetAwaiter().GetResult(); byte[] bytes = output.GetAwaiter().GetResult();
        Need(child.ExitCode == 0 && error.GetAwaiter().GetResult().Length == 0);
        using var document = JsonDocument.Parse(bytes); return document.RootElement.Clone();
    } finally {
        if (!child.HasExited) { child.Kill(true); child.WaitForExit(); }
        try { Task.WhenAll(output, error).GetAwaiter().GetResult(); } catch { /* Failed bounded transport stays failed. */ }
    }
}
Mesh EdgeTouchingBoxes() => Merge(Box(-1, 0, -1, 0, -1, 1), Box(0, 1, 0, 1, -1, 1));
MixedFragmentInput[] OwnerContactInputs(bool identicalCaps = false) {
    var first = Input(Box(-1, 0, -1, 1, -1, 1), fragment: 1); var mesh = Box(0, 1, -1, 1, -1, 1); var indices = mesh.Indices.ToArray();
    // Reverse the cap's diagonal while preserving every original orientation.
    if (!identicalCaps) { int[] cap = [0, 4, 3, 3, 4, 7]; Array.Copy(cap, 0, indices, 24, cap.Length); }
    var second = Input(mesh with { Indices = indices }, fragment: 2); second = second with { Source = second.Source with { OwnerObjectId = "dbid:20" } };
    return [first, second];
}
void OriginalInputsRetained(MixedBarrierKernel kernel, IReadOnlyList<MixedFragmentInput> input) {
    var triangles = kernel.Components.SelectMany(component => component.Triangles).ToDictionary(triangle => (triangle.Source.FragmentId, triangle.LocalTriangleIndex));
    Need(triangles.Count == input.Sum(fragment => fragment.TriangleIndices.Count / 3));
    foreach (var fragment in input) for (int at = 0; at < fragment.TriangleIndices.Count; at += 3) {
        var triangle = triangles[(fragment.Source.FragmentId, at / 3)];
        Need(triangle.Source.OwnerObjectId == fragment.Source.OwnerObjectId && triangle.Source.ParentSelectionIds.SequenceEqual(fragment.Source.ParentSelectionIds));
        Need(triangle.OriginalVertexA == fragment.TriangleIndices[at] && triangle.OriginalVertexB == fragment.TriangleIndices[at + 1] && triangle.OriginalVertexC == fragment.TriangleIndices[at + 2]);
        Need(SameBits(triangle.A, fragment.Vertices[triangle.OriginalVertexA]) && SameBits(triangle.B, fragment.Vertices[triangle.OriginalVertexB]) && SameBits(triangle.C, fragment.Vertices[triangle.OriginalVertexC]));
    }
}
void OriginalMeshRetained(MixedBarrierKernel kernel, Mesh mesh) {
    var triangles = kernel.Components.SelectMany(c => c.Triangles).OrderBy(t => t.LocalTriangleIndex).ToArray(); Need(triangles.Length == mesh.Indices.Length / 3);
    for (int at = 0; at < triangles.Length; at++) {
        var triangle = triangles[at]; Need(triangle.LocalTriangleIndex == at);
        Need(triangle.OriginalVertexA == mesh.Indices[at * 3] && triangle.OriginalVertexB == mesh.Indices[at * 3 + 1] && triangle.OriginalVertexC == mesh.Indices[at * 3 + 2]);
        Need(SameBits(triangle.A, mesh.Vertices[triangle.OriginalVertexA]) && SameBits(triangle.B, mesh.Vertices[triangle.OriginalVertexB]) && SameBits(triangle.C, mesh.Vertices[triangle.OriginalVertexC]));
    }
}

LargeSelectionFixture.Run(Run, Environment.GetEnvironmentVariable("PF_B34_SYNTHETIC_CAPTURE_OUTPUT"));

Console.WriteLine(JsonSerializer.Serialize(new { status = failed == 0 ? "PASS" : "FAIL", passed = checks.Count - failed, failed,
    scope = "Private bounded manual mixed original-surface and independently qualified solid foundation; no SDK, protected publication, runner, terminal exemption or model integration", checks }));
return failed == 0 ? 0 : 1;
