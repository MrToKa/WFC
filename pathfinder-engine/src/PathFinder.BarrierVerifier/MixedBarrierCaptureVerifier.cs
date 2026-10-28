using System.Collections.ObjectModel;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PathFinder.Barriers;

namespace PathFinder.BarrierVerifier;

/// <summary>Explicit additive v2 consumer of current bounded capture.v1 bytes.
/// It never changes the v1 verifier or confers transport, SDK or frame authority.</summary>
public static class MixedBarrierCaptureVerifier
{
    public const string ProducerVersion = "wfc.pf.barrier-mixed-verifier.v2";
    public const int MaximumReceiptBytes = 64 * 1024;
    public const int LargeSelectionMaximumReceiptBytes = 4 * 1024 * 1024;
    public static MixedBarrierVerificationResult Verify(ReadOnlyMemory<byte> captureUtf8, BarrierVerifierLimits? limits = null,
        CancellationToken cancellationToken = default, int maximumReceiptBytes = MaximumReceiptBytes)
    {
        cancellationToken.ThrowIfCancellationRequested(); limits ??= new(); var budget = new VerifierBudget(limits.MaximumWork, limits.MaximumMilliseconds, cancellationToken); string? captureHash = null;
        try
        {
            ValidateLimits(limits, maximumReceiptBytes);
            if (captureUtf8.Length is < 1 || captureUtf8.Length > limits.MaximumBytes) throw new VerifierRefusal("CAPTURE_BYTES_LIMIT", "Capture bytes exceed the declared bound; no input digest was computed.");
            captureUtf8 = captureUtf8.ToArray(); captureHash = BarrierCaptureVerifier.Hash(captureUtf8.Span);
            var parsed = CaptureParser.Parse(captureUtf8, limits, budget); var capture = parsed.Value;
            var fragments = new List<MixedFragmentInput>();
            foreach (var fragment in capture.Fragments)
            {
                budget.Spend(); var s = fragment.Source; var matrix = new long[16]; var points = new BarrierPoint[fragment.VerticesMetres.Length];
                for (int at = 0; at < 16; at++) { budget.Spend(); matrix[at] = BitConverter.DoubleToInt64Bits(s.SourceToWorldMetres[at]); }
                for (int at = 0; at < points.Length; at++) { budget.Spend(); var p = fragment.VerticesMetres[at]; points[at] = new(p[0], p[1], p[2]); }
                var source = new MixedFragmentProvenance(s.FragmentId, s.OwnerObjectId, Array.AsReadOnly(s.ParentSelectionIds.ToArray()), parsed.SourceHashes[s.FragmentId],
                    s.TransformSha256, s.SourceUnits, s.MetresPerSourceUnit, Array.AsReadOnly(matrix));
                fragments.Add(new(source, Array.AsReadOnly(points), Array.AsReadOnly(fragment.TriangleIndices.ToArray())));
            }
            var built = MixedBarrierKernel.Build(fragments, new MixedBarrierBuildLimits { MaximumFragments = limits.MaximumFragments, MaximumParents = limits.MaximumParents,
                Geometry = new BarrierLimits { MaximumMeshes = limits.MaximumComputationalMeshes, MaximumVertices = limits.MaximumVertices, MaximumTriangles = limits.MaximumTriangles,
                    MaximumBuildWork = budget.RemainingWork, MaximumBuildMilliseconds = budget.RemainingMilliseconds, NumericToleranceMeters = limits.NumericToleranceMetres } }, cancellationToken);
            budget.Spend(built.Work);
            if (built.Status != BarrierBuildStatus.Ready || built.Kernel is null)
            {
                var diagnostic = built.Diagnostics.FirstOrDefault(); throw new VerifierRefusal(diagnostic?.Code ?? "MIXED_GEOMETRY_REFUSED", diagnostic?.Message ?? "Mixed geometry could not be qualified.");
            }
            var summary = built.Kernel.Summary;
            var memberships = new List<MixedBarrierComponentMembership>();
            foreach (var component in built.Kernel.Components) memberships.Add(ComponentMembership(captureHash, component, budget));
            string verificationHash = BarrierCaptureVerifier.Hash(Encoding.UTF8.GetBytes(ProducerVersion + "\n" + MixedBarrierKernel.PolicyVersion + "\n" + MixedBarrierKernel.CollisionVersion
                + "\n" + captureHash + "\n" + summary.OriginalGeometrySha256 + "\n" + BitConverter.DoubleToInt64Bits(summary.NumericToleranceMetres).ToString(System.Globalization.CultureInfo.InvariantCulture)));
            var evidence = new MixedBarrierVerifierEvidence(capture.CaptureId, capture.Scope, summary.OriginalSurfaceComponents, summary.QualifiedClosedSolidComponents,
                summary.FragmentCount, summary.VertexCount, summary.TriangleCount, summary.OriginalGeometrySha256, verificationHash, summary.NumericToleranceMetres, memberships.AsReadOnly());
            var receipt = new MixedBarrierVerifierReceipt("geometry-qualified", captureHash, evidence, Array.Empty<BarrierVerifierDiagnostic>());
            _ = ReceiptBytes(receipt, maximumReceiptBytes); budget.Checkpoint(); return new(receipt, new(built.Kernel, built.Kernel.Components));
        }
        catch (VerifierRefusal error) { return Refused(captureHash, error.Code, error.Message); }
        catch (Exception error) when (error is JsonException or DecoderFallbackException or OverflowException or ArgumentException)
        { return Refused(captureHash, "INVALID_CAPTURE", "Capture parsing/geometry bounds refused: " + error.GetType().Name + "."); }
    }
    public static byte[] ReceiptBytes(MixedBarrierVerifierReceipt receipt, int maximumBytes = MaximumReceiptBytes)
    {
        if (maximumBytes is not (MaximumReceiptBytes or LargeSelectionMaximumReceiptBytes))
            throw new VerifierRefusal("INVALID_LIMITS", "An explicit supported receipt byte limit is required.");
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(receipt, CaptureParser.Json);
        if (bytes.Length > maximumBytes) throw new VerifierRefusal("RECEIPT_BYTES_LIMIT", "Mixed component evidence exceeds its explicit receipt byte bound; nothing was truncated."); return bytes;
    }
    private static MixedBarrierComponentMembership ComponentMembership(string captureHash, MixedBarrierComponent component, VerifierBudget budget)
    {
        string kind = component.Kind == MixedBarrierComponentKind.OriginalSurface ? "original-surface" : "qualified-closed-solid";
        using var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        void Text(string value) => digest.AppendData(Encoding.UTF8.GetBytes(value));
        void String(string value) => Text(JsonSerializer.Serialize(value, CaptureParser.Json));
        void Integer(int value) => Text(value.ToString(System.Globalization.CultureInfo.InvariantCulture));
        // Independent streaming implementation of the shared canonical JSON
        // projection. These fields contain strings/integers only; winding stays
        // original. Source coordinates/matrices are additionally bound by the
        // exact capture hash and original-geometry binary-bit digest.
        Text("{\"domain\":\"wfc.pf.mixed-original-component-membership.v2\",\"value\":{\"captureSha256\":"); String(captureHash);
        Text(",\"componentId\":"); String(component.Id); Text(",\"kind\":"); String(kind); Text(",\"triangles\":[");
        var fragments = new SortedSet<int>(); var parents = new SortedSet<string>(StringComparer.Ordinal); int oldFragment = -1, oldLocal = -1; bool first = true;
        foreach (var triangle in component.Triangles)
        {
            budget.Spend(); int fragment = triangle.Source.FragmentId, local = triangle.LocalTriangleIndex;
            if (fragment < oldFragment || fragment == oldFragment && local <= oldLocal) throw new VerifierRefusal("COMPONENT_SOURCE_ORDER", "Original component source identities must be ordered and unique.");
            oldFragment = fragment; oldLocal = local; fragments.Add(fragment);
            if (!first) Text(","); first = false;
            Text("{\"fragmentId\":"); Integer(fragment); Text(",\"localTriangleIndex\":"); Integer(local); Text(",\"originalVertexIndices\":["); Integer(triangle.OriginalVertexA); Text(","); Integer(triangle.OriginalVertexB); Text(","); Integer(triangle.OriginalVertexC);
            Text("],\"ownerObjectId\":"); String(triangle.Source.OwnerObjectId); Text(",\"parentSelectionIds\":["); bool firstParent = true;
            foreach (string parent in triangle.Source.ParentSelectionIds) { budget.Spend(); if (!firstParent) Text(","); firstParent = false; String(parent); parents.Add(parent); }
            Text("]}");
        }
        Text("]}}");
        return new(component.Id, kind, Array.AsReadOnly(fragments.ToArray()), Array.AsReadOnly(parents.ToArray()), component.Triangles.Count,
            Convert.ToHexString(digest.GetHashAndReset()).ToLowerInvariant());
    }
    private static MixedBarrierVerificationResult Refused(string? hash, string code, string message) => new(new("refused", hash, null,
        new ReadOnlyCollection<BarrierVerifierDiagnostic>([new(code, message.Length > 2048 ? message[..2048] : message)])), null);
    private static void ValidateLimits(BarrierVerifierLimits limits, int maximumReceiptBytes)
    {
        bool largeSelection = maximumReceiptBytes == LargeSelectionMaximumReceiptBytes;
        if (maximumReceiptBytes is not (MaximumReceiptBytes or LargeSelectionMaximumReceiptBytes)
            || limits.MaximumBytes is < 1 or > 33_554_432 || limits.MaximumFragments is < 1 or > 8192 || limits.MaximumParents < 1 || limits.MaximumParents > (largeSelection ? 2048 : 128)
            || limits.MaximumComputationalMeshes < 1 || limits.MaximumComputationalMeshes > (largeSelection ? 2048 : 256) || limits.MaximumVertices is < 4 or > 500_000 || limits.MaximumTriangles is < 4 or > 250_000
            || limits.MaximumWork is < 1 or > 40_000_000 || limits.MaximumMilliseconds is < 1 or > 60_000 || !double.IsFinite(limits.NumericToleranceMetres)
            || limits.NumericToleranceMetres is < 1e-9 or > .001) throw new VerifierRefusal("INVALID_LIMITS", "Supported finite bounded verifier limits are required.");
    }
}
