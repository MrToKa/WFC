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
Run("nonmanifold edges and disconnected vertex fans are refused for surfaces too", () => {
    var nonmanifold = new Mesh([P(0), P(0, 1), P(0, 0, 1), P(0, 0, -1), P(1)], [0, 1, 2, 1, 0, 3, 0, 1, 4]); Refused(Capture(nonmanifold), code: "NONMANIFOLD_EDGE");
    var bowtie = new Mesh([P(0), P(0, 1), P(0, 0, 1), P(0, -1), P(0, 0, -1)], [0, 1, 2, 0, 3, 4]); Refused(Capture(bowtie), code: "NONMANIFOLD_VERTEX");
});
Run("a self-intersecting closed candidate cannot downgrade into a surface", () => {
    var box = Box(); var vertices = box.Vertices.ToArray(); vertices[6] = P(.1, 0, -3); Refused(Capture(box with { Vertices = vertices }), code: "CLOSED_SOLID_QUALIFICATION_REFUSED");
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
Console.WriteLine(JsonSerializer.Serialize(new { status = failed == 0 ? "PASS" : "FAIL", passed = checks.Count - failed, failed,
    scope = "Private bounded manual mixed original-surface and independently qualified solid foundation; no SDK, protected publication, runner, terminal exemption or model integration", checks }));
return failed == 0 ? 0 : 1;
