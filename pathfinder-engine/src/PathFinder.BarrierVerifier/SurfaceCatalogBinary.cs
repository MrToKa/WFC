using System.Buffers.Binary;

namespace PathFinder.BarrierVerifier;

internal static class SurfaceBinary
{
    internal const int PageHeader = 80, TriangleBytes = 96, IndexHeader = 64, IndexBytes = 128,
        RangeHeader = 64, RangeBytes = 768, RangePageRecords = 256, RangeIndexHeader = 64;
    internal static uint U32(ReadOnlySpan<byte> bytes, int at) => BinaryPrimitives.ReadUInt32LittleEndian(bytes.Slice(at, 4));
    internal static ulong U64(ReadOnlySpan<byte> bytes, int at) => BinaryPrimitives.ReadUInt64LittleEndian(bytes.Slice(at, 8));
    internal static double F64(ReadOnlySpan<byte> bytes, int at) => BitConverter.Int64BitsToDouble(BinaryPrimitives.ReadInt64LittleEndian(bytes.Slice(at, 8)));
    internal static void W32(Span<byte> bytes, int at, uint value) => BinaryPrimitives.WriteUInt32LittleEndian(bytes.Slice(at, 4), value);
    internal static void W64(Span<byte> bytes, int at, ulong value) => BinaryPrimitives.WriteUInt64LittleEndian(bytes.Slice(at, 8), value);
    internal static void WF64(Span<byte> bytes, int at, double value) => BinaryPrimitives.WriteInt64LittleEndian(bytes.Slice(at, 8), BitConverter.DoubleToInt64Bits(value));
    internal static bool Zero(ReadOnlySpan<byte> bytes) { foreach (byte b in bytes) if (b != 0) return false; return true; }
    internal static string Hex(ReadOnlySpan<byte> bytes) => Convert.ToHexString(bytes).ToLowerInvariant();
    internal static void Sha(Span<byte> bytes, int at, string sha) { SurfaceJson.Digest(sha); Convert.FromHexString(sha).CopyTo(bytes.Slice(at, 32)); }
    internal static void WritePoint(Span<byte> bytes, int at, PackedCanonicalPoint p) { WF64(bytes, at, p.X); WF64(bytes, at + 8, p.Y); WF64(bytes, at + 16, p.Z); }
    internal static PackedCanonicalPoint Point(ReadOnlySpan<byte> bytes, int at) => new(F64(bytes, at), F64(bytes, at + 8), F64(bytes, at + 16));
    internal static void Triangle(Span<byte> bytes, PackedValidatedTriangle t)
    {
        W32(bytes, 0, t.RangeOrdinal); W32(bytes, 4, t.FragmentOrdinal); W32(bytes, 8, t.SourceTriangleIndex);
        W32(bytes, 12, t.OriginalVertexA); W32(bytes, 16, t.OriginalVertexB); W32(bytes, 20, t.OriginalVertexC);
        WritePoint(bytes, 24, t.A); WritePoint(bytes, 48, t.B); WritePoint(bytes, 72, t.C);
    }
    internal static PackedValidatedTriangle Triangle(ReadOnlySpan<byte> bytes) => new(U32(bytes, 0), U32(bytes, 4), U32(bytes, 8),
        U32(bytes, 12), U32(bytes, 16), U32(bytes, 20), Point(bytes, 24), Point(bytes, 48), Point(bytes, 72));
    internal static byte[] Range(PackedValidatedRange value, string commandSha256, string receiptSha256, ulong firstTriangle)
    {
        var output = new byte[RangeBytes]; var e = value.Expected; var f = e.Fragment; var r = e.Range; var p = e.Placement;
        W32(output, 0, r.FragmentOrdinal); W32(output, 4, f.FragmentId); W32(output, 8, f.OwnerNodeOrdinal); W32(output, 12, f.OwnerDbId);
        Convert.FromHexString(r.MembershipMask).CopyTo(output, 16); W32(output, 32, p.RangeOrdinal); W32(output, 36, p.PartIndex);
        W32(output, 40, r.TriangleStart); W32(output, 44, r.TriangleCount); W32(output, 48, r.ReferencedVertexCount);
        W32(output, 52, f.SourceVertexCount); W32(output, 56, f.SourceTriangleCount);
        Sha(output, 64, r.SourceGeometrySha256); Sha(output, 96, r.TransformSha256); Sha(output, 128, r.SourceVertexIdsSha256);
        Sha(output, 160, r.SourceIndicesSha256); Sha(output, 192, p.RangeSha256); Sha(output, 224, value.Part.PayloadSha256);
        if (value.TransformBytes.Length != 384) SurfaceJson.Fail("RANGE_MATRIX_BYTES"); value.TransformBytes.Span.CopyTo(output.AsSpan(256, 384));
        Sha(output, 640, value.Part.DescriptorSha256); Sha(output, 672, commandSha256); Sha(output, 704, receiptSha256); W64(output, 736, firstTriangle); return output;
    }
    internal static SurfaceCatalogRange Range(ReadOnlySpan<byte> bytes) => new(U32(bytes, 32), U32(bytes, 0), U32(bytes, 4), U32(bytes, 8), U32(bytes, 12),
        Hex(bytes.Slice(16, 16)), U32(bytes, 36), U32(bytes, 40), U32(bytes, 44), U32(bytes, 48), U32(bytes, 52), U32(bytes, 56),
        Hex(bytes.Slice(64, 32)), Hex(bytes.Slice(96, 32)), Hex(bytes.Slice(128, 32)), Hex(bytes.Slice(160, 32)), Hex(bytes.Slice(192, 32)),
        Hex(bytes.Slice(224, 32)), bytes.Slice(256, 384).ToArray(), Hex(bytes.Slice(640, 32)), Hex(bytes.Slice(672, 32)), Hex(bytes.Slice(704, 32)), U64(bytes, 736));
    internal static void Bounds(Span<byte> bytes, int at, double[] bounds) { for (int axis = 0; axis < 6; axis++) WF64(bytes, at + axis * 8, bounds[axis]); }
    internal static double[] Bounds(ReadOnlySpan<byte> bytes, int at)
    { var values = new double[6]; for (int i = 0; i < 6; i++) values[i] = F64(bytes, at + i * 8); return values; }
    internal static void Include(double[] bounds, PackedCanonicalPoint point)
    {
        for (int axis = 0; axis < 3; axis++)
        {
            double n = axis == 0 ? point.X : axis == 1 ? point.Y : point.Z; if (!double.IsFinite(n) || Math.Abs(n) > 1e9) SurfaceJson.Fail("CATALOG_COORDINATE");
            // Strict comparisons preserve the first actual zero bit on ties.
            if (n < bounds[axis]) bounds[axis] = n; if (n > bounds[axis + 3]) bounds[axis + 3] = n;
        }
    }
    internal static double[] EmptyBounds() => [double.PositiveInfinity, double.PositiveInfinity, double.PositiveInfinity, double.NegativeInfinity, double.NegativeInfinity, double.NegativeInfinity];
    internal static bool SameBounds(double[] a, double[] b) => a.Length == b.Length && a.Zip(b).All(p => BitConverter.DoubleToInt64Bits(p.First) == BitConverter.DoubleToInt64Bits(p.Second));
    internal static void CheckBounds(double[] bounds)
    { for (int i = 0; i < 6; i++) if (!double.IsFinite(bounds[i]) || Math.Abs(bounds[i]) > 1e9 || i < 3 && bounds[i] > bounds[i + 3]) SurfaceJson.Fail("CATALOG_BOUNDS"); }
}
