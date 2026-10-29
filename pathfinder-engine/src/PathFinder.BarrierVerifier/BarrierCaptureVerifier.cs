using System.Buffers.Binary;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PathFinder.Barriers;

namespace PathFinder.BarrierVerifier;

/// <summary>Geometric qualification of provided capture fragments, never SDK
/// enumeration authority, authorization, model equivalence or engineering approval.</summary>
public static class BarrierCaptureVerifier
{
    public const string ProducerVersion = "wfc.pf.barrier-verifier.v1";
    public const int MaximumReceiptBytes = 64 * 1024;
    public static BarrierVerificationResult Verify(ReadOnlyMemory<byte> captureUtf8, BarrierVerifierLimits? limits = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested(); limits ??= new();
        var budget = new VerifierBudget(limits.MaximumWork, limits.MaximumMilliseconds, cancellationToken);
        string? captureHash = null;
        try
        {
            ValidateLimits(limits);
            if (captureUtf8.Length is < 1 || captureUtf8.Length > limits.MaximumBytes)
                throw new VerifierRefusal("CAPTURE_BYTES_LIMIT", "Capture bytes exceed the declared bound; no input digest was computed.");
            // ReadOnlyMemory can still wrap a mutable caller-owned byte array.
            // Hash and parse exactly one bounded private snapshot of those bytes.
            captureUtf8 = captureUtf8.ToArray();
            captureHash = Hash(captureUtf8.Span);
            var parsed = CaptureParser.Parse(captureUtf8, limits, budget); var capture = parsed.Value;
            var vertices = new List<BarrierPoint>(); var weld = new Dictionary<BarrierPoint, int>();
            var triangles = new List<Triangle>(); var edges = new Dictionary<(int, int), Edge>();
            var uniqueTriangles = new HashSet<(int, int, int)>(); var fragments = new List<BarrierFragmentQualification>();
            foreach (var fragment in capture.Fragments.OrderBy(value => value.Source.FragmentId))
            {
                budget.Spend(); var memberships = Array.AsReadOnly(fragment.Source.ParentSelectionIds.Order(StringComparer.Ordinal).ToArray());
                fragments.Add(new(fragment.Source.FragmentId, memberships, fragment.VerticesMetres.Length,
                    fragment.TriangleIndices.Length / 3, parsed.SourceHashes[fragment.Source.FragmentId]));
                var mapped = new int[fragment.VerticesMetres.Length];
                for (var at = 0; at < mapped.Length; at++)
                {
                    budget.Spend(); var value = fragment.VerticesMetres[at]; var point = new BarrierPoint(value[0], value[1], value[2]);
                    if (!weld.TryGetValue(point, out int index)) { index = vertices.Count; vertices.Add(point); weld.Add(point, index); }
                    mapped[at] = index;
                }
                for (var at = 0; at < fragment.TriangleIndices.Length; at += 3)
                {
                    budget.Spend(); int a = mapped[fragment.TriangleIndices[at]], b = mapped[fragment.TriangleIndices[at + 1]], c = mapped[fragment.TriangleIndices[at + 2]];
                    if (a == b || b == c || a == c) throw new VerifierRefusal("DEGENERATE_TRIANGLE", "Exact welding collapsed a triangle; no geometry was removed or repaired.");
                    var sorted = new[] { a, b, c }; Array.Sort(sorted);
                    if (!uniqueTriangles.Add((sorted[0], sorted[1], sorted[2]))) throw new VerifierRefusal("DUPLICATE_TRIANGLE", "Coincident/repeated triangles across fragments are ambiguous; they are not silently deduplicated.");
                    int index = triangles.Count;
                    triangles.Add(new(a, b, c, new(fragment.Source.FragmentId, at / 3, memberships)));
                    AddEdge(a, b, index); AddEdge(b, c, index); AddEdge(c, a, index);
                }
            }
            var adjacent = new List<int>[triangles.Count]; for (var at = 0; at < adjacent.Length; at++) adjacent[at] = new();
            foreach (var edge in edges.Values)
            {
                budget.Spend();
                if (edge.Second < 0) throw new VerifierRefusal("OPEN_SHELL", "Fragments do not form exactly welded closed shells.");
                adjacent[edge.First].Add(edge.Second); adjacent[edge.Second].Add(edge.First);
            }
            var seen = new bool[triangles.Count]; var meshes = new List<QualifiedBarrierMesh>(); var boxes = new List<Bounds>();
            for (var at = 0; at < triangles.Count; at++)
            {
                budget.Spend(); if (seen[at]) continue;
                if (meshes.Count >= limits.MaximumComputationalMeshes) throw new VerifierRefusal("SHELL_COUNT_LIMIT", "Disconnected computational shell count exceeds its bound.");
                var component = new List<int>(); var queue = new Queue<int>(); queue.Enqueue(at); seen[at] = true;
                while (queue.Count > 0)
                {
                    budget.Spend(); int next = queue.Dequeue(); component.Add(next);
                    foreach (var neighbour in adjacent[next]) if (!seen[neighbour]) { seen[neighbour] = true; queue.Enqueue(neighbour); }
                }
                component.Sort(); var componentVertices = new List<BarrierPoint>(); var componentIndices = new List<int>();
                var remap = new Dictionary<int, int>(); var sources = new List<BarrierTriangleSource>();
                foreach (int index in component)
                {
                    budget.Spend(); var triangle = triangles[index]; sources.Add(triangle.Source);
                    foreach (int old in new[] { triangle.A, triangle.B, triangle.C })
                    {
                        if (!remap.TryGetValue(old, out int current)) { current = componentVertices.Count; componentVertices.Add(vertices[old]); remap.Add(old, current); }
                        componentIndices.Add(current);
                    }
                }
                var mesh = new BarrierMeshInput("shell:" + meshes.Count.ToString("D6", System.Globalization.CultureInfo.InvariantCulture),
                    componentVertices.AsReadOnly(), componentIndices.AsReadOnly());
                meshes.Add(new(mesh, sources.AsReadOnly())); boxes.Add(Bounds.Of(componentVertices));
            }
            // A closed inner shell might describe a BRep cavity. The kernel's
            // union semantics must never fill it merely because it is closed.
            // Contained AABBs are an ambiguity refusal only, not a collision test.
            for (var first = 0; first < boxes.Count; first++)
                for (var last = first + 1; last < boxes.Count; last++)
                {
                    budget.Spend();
                    if (boxes[first].Contains(boxes[last]) || boxes[last].Contains(boxes[first]))
                        throw new VerifierRefusal("NESTED_OR_AMBIGUOUS_SHELLS", "Contained shell bounds may represent a cavity or ambiguous grouping; union filling is unsupported.");
                }
            budget.Checkpoint();
            var built = BarrierCollisionKernel.Build(meshes.Select(value => value.Mesh), new BarrierLimits
            {
                MaximumMeshes = limits.MaximumComputationalMeshes, MaximumVertices = limits.MaximumVertices,
                MaximumTriangles = limits.MaximumTriangles, NumericToleranceMeters = limits.NumericToleranceMetres,
                MaximumBuildWork = budget.RemainingWork, MaximumBuildMilliseconds = budget.RemainingMilliseconds,
            }, cancellationToken);
            budget.Spend(built.Work);
            if (built.Status != BarrierBuildStatus.Ready || built.Kernel is null)
                throw new VerifierRefusal("KERNEL_QUALIFICATION_REFUSED", "Independent closed-solid qualification refused: "
                    + string.Join("; ", built.Diagnostics.Take(4).Select(value => value.Code + ": " + value.Message)));
            string decompositionHash = DecompositionHash(captureHash, meshes, budget);
            var summary = built.Kernel.Summary;
            string verificationHash = Hash(Encoding.UTF8.GetBytes(ProducerVersion + "\n" + BarrierCollisionKernel.CollisionVersion + "\n"
                + captureHash + "\n" + decompositionHash + "\n" + meshes.Count.ToString(System.Globalization.CultureInfo.InvariantCulture)
                + "\n" + summary.NumericToleranceMeters.ToString("R", System.Globalization.CultureInfo.InvariantCulture)));
            var evidence = new BarrierVerifierEvidence(capture.CaptureId, capture.Scope, meshes.Count, fragments.Count,
                capture.Fragments.Sum(value => value.VerticesMetres.Length), triangles.Count, decompositionHash, verificationHash, summary.NumericToleranceMeters);
            var receipt = new BarrierVerifierReceipt("geometry-qualified", captureHash, evidence, Array.Empty<BarrierVerifierDiagnostic>());
            budget.Checkpoint();
            return new(receipt, new(built.Kernel, meshes.AsReadOnly(), fragments.AsReadOnly()));

            void AddEdge(int a, int b, int triangle)
            {
                budget.Spend(); var key = (Math.Min(a, b), Math.Max(a, b)); int direction = a < b ? 1 : -1;
                if (!edges.TryGetValue(key, out var edge)) edges.Add(key, new(triangle, -1, direction));
                else
                {
                    if (edge.Second >= 0) throw new VerifierRefusal("AMBIGUOUS_EDGE", "More than two triangles share a welded edge; no shell grouping was invented.");
                    if (edge.Direction == direction) throw new VerifierRefusal("INCONSISTENT_WINDING", "Fragment triangles do not have consistent closed-shell orientation.");
                    edges[key] = edge with { Second = triangle };
                }
            }
        }
        catch (VerifierRefusal error) { return Refused(captureHash, error.Code, error.Message); }
        catch (Exception error) when (error is JsonException or DecoderFallbackException or OverflowException or ArgumentException)
        { return Refused(captureHash, "INVALID_CAPTURE", "Capture parsing/geometry bounds refused: " + error.GetType().Name + "."); }
    }

    public static byte[] ReceiptBytes(BarrierVerifierReceipt receipt)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(receipt, CaptureParser.Json);
        if (bytes.Length > MaximumReceiptBytes) throw new InvalidOperationException("Verifier receipt exceeds its byte budget.");
        return bytes;
    }
    public static string Hash(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static BarrierVerificationResult Refused(string? captureHash, string code, string message) => new(
        new("refused", captureHash, null, new ReadOnlyCollection<BarrierVerifierDiagnostic>([new(code, message.Length > 2048 ? message[..2048] : message)])), null);
    private static void ValidateLimits(BarrierVerifierLimits limits)
    {
        if (limits.MaximumBytes is < 1 or > 33_554_432 || limits.MaximumFragments is < 1 or > 8192 || limits.MaximumParents is < 1 or > 128
            || limits.MaximumComputationalMeshes is < 1 or > 256 || limits.MaximumVertices is < 4 or > 500_000 || limits.MaximumTriangles is < 4 or > 250_000
            || limits.MaximumWork is < 1 or > 40_000_000 || limits.MaximumMilliseconds is < 1 or > 60_000
            || !double.IsFinite(limits.NumericToleranceMetres) || limits.NumericToleranceMetres is < 1e-9 or > 0.001)
            throw new VerifierRefusal("INVALID_LIMITS", "Verifier limits must be supported finite bounded values.");
    }
    private static string DecompositionHash(string captureHash, List<QualifiedBarrierMesh> meshes, VerifierBudget budget)
    {
        using var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        void Text(string value) { var bytes = Encoding.UTF8.GetBytes(value); Number(bytes.Length); digest.AppendData(bytes); }
        void Number(long value) { Span<byte> bytes = stackalloc byte[8]; BinaryPrimitives.WriteInt64LittleEndian(bytes, value); digest.AppendData(bytes); }
        Text("wfc.pf.barrier-decomposition.v1"); Text(captureHash); Number(meshes.Count);
        foreach (var item in meshes)
        {
            budget.Spend(); Text(item.Mesh.Id); Number(item.Mesh.Vertices.Count); Number(item.Mesh.TriangleIndices.Count);
            foreach (var point in item.Mesh.Vertices)
            {
                budget.Spend(); Number(BitConverter.DoubleToInt64Bits(point.X == 0 ? 0 : point.X));
                Number(BitConverter.DoubleToInt64Bits(point.Y == 0 ? 0 : point.Y)); Number(BitConverter.DoubleToInt64Bits(point.Z == 0 ? 0 : point.Z));
            }
            foreach (int index in item.Mesh.TriangleIndices) { budget.Spend(); Number(index); }
            foreach (var source in item.TriangleSources)
            {
                budget.Spend(); Number(source.FragmentId); Number(source.LocalTriangleIndex); Number(source.ParentSelectionIds.Count);
                foreach (var parent in source.ParentSelectionIds) Text(parent);
            }
        }
        return Convert.ToHexString(digest.GetHashAndReset()).ToLowerInvariant();
    }
    private readonly record struct Triangle(int A, int B, int C, BarrierTriangleSource Source);
    private readonly record struct Edge(int First, int Second, int Direction);
    private readonly record struct Bounds(BarrierPoint Minimum, BarrierPoint Maximum)
    {
        internal static Bounds Of(List<BarrierPoint> points) => new(new(points.Min(p => p.X), points.Min(p => p.Y), points.Min(p => p.Z)),
            new(points.Max(p => p.X), points.Max(p => p.Y), points.Max(p => p.Z)));
        internal bool Contains(Bounds other) => Minimum.X <= other.Minimum.X && Maximum.X >= other.Maximum.X
            && Minimum.Y <= other.Minimum.Y && Maximum.Y >= other.Maximum.Y && Minimum.Z <= other.Minimum.Z && Maximum.Z >= other.Maximum.Z;
    }
}

internal sealed class VerifierRefusal(string code, string message) : Exception(message)
{
    internal string Code { get; } = code;
}
internal sealed class VerifierBudget(long maximum, int milliseconds, CancellationToken token)
{
    private readonly long started = Stopwatch.GetTimestamp(); private long work; private long checkAt;
    internal long RemainingWork { get { Checkpoint(); if (maximum - work < 1) throw new VerifierRefusal("WORK_LIMIT", "Verifier work budget was exhausted."); return maximum - work; } }
    internal int RemainingMilliseconds { get { Checkpoint(); return Math.Max(1, milliseconds - (int)Stopwatch.GetElapsedTime(started).TotalMilliseconds); } }
    internal void Spend(long amount = 1)
    {
        if (work >= checkAt) { Checkpoint(); checkAt = work + 256; }
        if (amount < 0 || amount > maximum - work) throw new VerifierRefusal("WORK_LIMIT", "Verifier work budget was exhausted.");
        work += amount;
    }
    internal void Checkpoint()
    {
        token.ThrowIfCancellationRequested();
        if (Stopwatch.GetElapsedTime(started).TotalMilliseconds >= milliseconds) throw new VerifierRefusal("DEADLINE_EXCEEDED", "Verifier cooperative deadline was exceeded.");
    }
}
