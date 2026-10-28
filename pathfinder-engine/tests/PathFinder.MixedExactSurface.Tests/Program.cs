using System.Text.Json;
using PathFinder.Barriers;
using PathFinder.BarrierVerifier;
using static Fixtures;
using static MixedFixtures;

var checks = new List<object>(); int failed = 0;
void Need(bool value, string message = "Exact mixed surface assertion failed.") { if (!value) throw new InvalidOperationException(message); }
void Run(string name, Action action) { try { action(); checks.Add(new { name, status = "PASS", detail = "" }); } catch (Exception error) { failed++; checks.Add(new { name, status = "FAIL", detail = error.GetType().Name + ": " + error.Message }); } }
const double height = 0.0001220703125, tolerance = 1e-7;
var a = P(0, 0, 0); var b = P(64, 0, 0); var c = P(64, height, 0); var mesh = new Mesh([a, b, c], [0, 1, 2]);
var built = MixedBarrierKernel.Build([Input(mesh)]);
MixedBarrierKernel Kernel() => built.Kernel ?? throw new InvalidOperationException("Exact mixed thin surface must qualify: " + string.Join(",", built.Diagnostics.Select(d => d.Code)));
MixedExactSurfaceStatus Exact(BarrierPoint first, BarrierPoint last, Action<long>? spend = null, CancellationToken token = default)
    => MixedDyadicSurfaceContact.Check(first, last, a, b, c, tolerance, spend ?? (_ => { }), token);
var crossingFrom = P(32, height / 4, -1); var crossingTo = P(32, height / 4, 1);
Run("adversarial thin fixture activates unchanged float uncertainty guard", () => {
    Need(OriginalTriangleSurfaceContact.Check(crossingFrom, crossingTo, a, b, c).Status == OriginalTriangleContactStatus.Indeterminate);
});
Run("exact open-surface resolution retains all original triangle bits and indices", () => {
    var kernel = Kernel(); Need(built.Status == BarrierBuildStatus.Ready && kernel.Summary.OriginalSurfaceComponents == 1 && kernel.Summary.QualifiedClosedSolidComponents == 0);
    var triangle = kernel.Components.Single().Triangles.Single();
    Need(triangle.OriginalVertexA == 0 && triangle.OriginalVertexB == 1 && triangle.OriginalVertexC == 2 && triangle.A == a && triangle.B == b && triangle.C == c);
    Need(BitConverter.DoubleToInt64Bits(triangle.C.Y) == BitConverter.DoubleToInt64Bits(height));
});
Run("exact altitude proof never accepts collinear or below-tolerance facets", () => {
    Need(MixedDyadicSurfaceContact.CertifyResolution(a, b, c, tolerance, _ => { }, default));
    Need(!MixedDyadicSurfaceContact.CertifyResolution(a, b, P(32), tolerance, _ => { }, default));
    Need(!MixedDyadicSurfaceContact.CertifyResolution(a, b, P(64, tolerance / 2), tolerance, _ => { }, default));
});
Run("exact noncoplanar interior crossing is contact and mixed blocked", () => {
    Need(Exact(crossingFrom, crossingTo) == MixedExactSurfaceStatus.Contact);
    var result = Kernel().CheckSegment(crossingFrom, crossingTo);
    Need(result.Status == MixedBarrierSegmentStatus.Blocked && result.Witness is { Kind: MixedBarrierComponentKind.OriginalSurface, Triangle: { } original }
        && original.LocalTriangleIndex == 0 && original.OriginalVertexC == 2);
});
Run("exact coplanar entry and exit with both endpoints outside is contact", () => {
    var first = P(-1, height / 4); var last = P(65, height / 4);
    Need(Exact(first, last) == MixedExactSurfaceStatus.Contact && Kernel().CheckSegment(first, last).Status == MixedBarrierSegmentStatus.Blocked);
});
Run("exact original vertex and edge grazing remain blocked", () => {
    Need(Exact(a, a) == MixedExactSurfaceStatus.Contact && Kernel().CheckSegment(a, a).Status == MixedBarrierSegmentStatus.Blocked);
    var edge = P(32, height / 2); Need(Exact(edge, edge) == MixedExactSurfaceStatus.Contact && Kernel().CheckSegment(edge, edge).Status == MixedBarrierSegmentStatus.Blocked);
});
Run("coplanar near miss inside AABB cannot become invented clear", () => {
    var first = P(1, height * .75); var last = P(2, height * .75);
    Need(Exact(first, last) == MixedExactSurfaceStatus.Indeterminate && Kernel().CheckSegment(first, last).Status == MixedBarrierSegmentStatus.Indeterminate);
});
Run("unsupported tolerance-band near contact remains indeterminate", () => {
    var first = P(32, height / 4, tolerance / 2); var last = P(33, height / 4, tolerance / 2);
    Need(Exact(first, last) == MixedExactSurfaceStatus.Indeterminate && Kernel().CheckSegment(first, last).Status == MixedBarrierSegmentStatus.Indeterminate);
});
Run("exact expanded AABB separation proves no surface contact", () => {
    var first = P(32, height / 4, tolerance * 2); var last = P(33, height / 4, tolerance * 2);
    Need(Exact(first, last) == MixedExactSurfaceStatus.NoSurfaceContact && Kernel().CheckSegment(first, last).Status == MixedBarrierSegmentStatus.Clear);
});
Run("translation signed zero and original winding remain unchanged", () => {
    var translated = Transform(mesh, p => P(p.X + 80, p.Y - .03, p.Z + 7.4)); var result = MixedBarrierKernel.Build([Input(translated)]);
    var kernel = result.Kernel ?? throw new InvalidOperationException("Translated exact surface refused.");
    Need(kernel.CheckSegment(P(112, height / 4 - .03, 6.4), P(112, height / 4 - .03, 8.4)).Status == MixedBarrierSegmentStatus.Blocked);
    var negativeZero = new Mesh([P(-0d, -0d, -0d), b, c], [0, 1, 2]); var zero = MixedBarrierKernel.Build([Input(negativeZero)]).Kernel ?? throw new InvalidOperationException("Signed-zero surface refused.");
    Need(BitConverter.DoubleToInt64Bits(zero.Components[0].Triangles[0].A.X) == BitConverter.DoubleToInt64Bits(-0d));
});
Run("closed thin component retains full unchanged v1 conditioning refusal", () => {
    var closed = Box(0, 64, 0, height, 0, .001); var legacy = BarrierCollisionKernel.Build([new("closed", closed.Vertices, closed.Indices)]);
    Need(legacy.Status == BarrierBuildStatus.Refused);
    var mixed = MixedBarrierKernel.Build([Input(closed)]);
    Need(mixed.Status == BarrierBuildStatus.Refused && mixed.Kernel is null && mixed.Diagnostics.Any(row => row.Code == "CLOSED_SOLID_QUALIFICATION_REFUSED"));
});
Run("malformed collinear surface is not relabeled as supported exact geometry", () => {
    var result = MixedBarrierKernel.Build([Input(new Mesh([a, b, P(32)], [0, 1, 2]))]); Need(result.Status == BarrierBuildStatus.Refused && result.Kernel is null);
});
Run("exact arithmetic bit ceiling returns indeterminate rather than clear", () => {
    Need(Exact(P(32, height / 4, double.Epsilon), P(32, height / 4, -double.Epsilon)) == MixedExactSurfaceStatus.Indeterminate);
});
Run("exact fallback charges parent work budget and propagates its refusal", () => {
    var marker = new InvalidOperationException("parent-budget-marker"); long work = 0; bool caught = false;
    try { Exact(crossingFrom, crossingTo, amount => { work += amount; if (work > 1) throw marker; }); }
    catch (InvalidOperationException error) when (ReferenceEquals(error, marker)) { caught = true; }
    Need(caught); var result = Kernel().CheckSegment(crossingFrom, crossingTo, new() { MaximumWork = 1 }); Need(result.Status == MixedBarrierSegmentStatus.Indeterminate);
});
Run("exact cancellation propagates and cannot produce usable contact or clear", () => {
    using var cancellation = new CancellationTokenSource(); cancellation.Cancel(); bool caught = false;
    try { Exact(crossingFrom, crossingTo, token: cancellation.Token); } catch (OperationCanceledException) { caught = true; }
    Need(caught);
});
Run("capture receipt preserves exact source membership under explicit mixed policy", () => {
    byte[] input = Bytes(Capture(mesh)); var result = MixedBarrierCaptureVerifier.Verify(input);
    Need(result.Qualified is not null && result.Receipt.Status == "geometry-qualified" && result.Receipt.CaptureSha256 == BarrierCaptureVerifier.Hash(input)
        && result.Receipt.Evidence is { OriginalSurfaceComponents: 1, QualifiedClosedSolidComponents: 0, TriangleCount: 1 });
});
Console.WriteLine(JsonSerializer.Serialize(new { status = failed == 0 ? "PASS" : "FAIL", passed = checks.Count - failed, failed, checks,
    scope = "Private bounded additive original-surface exact fallback; unchanged v1/Geometry/facade/closed qualification, no physical clearance or SDK authority" }));
return failed == 0 ? 0 : 1;
