using System.Buffers.Binary;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace PathFinder.BarrierVerifier;

/// <summary>Independent local packed-byte validation. The full SDK source buffer
/// hash remains protected-producer-reported provenance, never a reconstructed
/// source-byte, topology, occupancy, collision or publication certificate.</summary>
public static class PackedPartReader
{
    private const int ChunkBytes = 262_144;
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static readonly UTF8Encoding Utf8 = new(false, true);

    public static PackedPartValidationReport ValidatePart(ReadOnlyMemory<byte> bytes, PackedPartExpectedDescriptor expectedDescriptor,
        PackedPartLimits? limits = null, CancellationToken token = default)
        => Validate(bytes, expectedDescriptor, limits, token).Report;

    /// <summary>No callback occurs until every byte, tuple, cursor EOF and cursor
    /// disposal has passed. Callbacks receive values, never the owned mesh buffer.</summary>
    public static PackedPartValidationReport VisitValidatedPart(ReadOnlyMemory<byte> bytes, PackedPartExpectedDescriptor expectedDescriptor,
        Action<PackedValidatedRange> rangeVisitor, Action<PackedValidatedTriangle> triangleVisitor,
        PackedPartLimits? limits = null, CancellationToken token = default)
    {
        ArgumentNullException.ThrowIfNull(rangeVisitor); ArgumentNullException.ThrowIfNull(triangleVisitor);
        var validated = Validate(bytes, expectedDescriptor, limits, token);
        foreach (var slice in validated.Ranges)
        {
            validated.Budget.Check(); var item = slice.Expected;
            rangeVisitor(new(item, validated.Report, validated.Bytes.AsMemory(slice.Offset, 384).ToArray()));
            validated.Budget.Check(); var raw = validated.Bytes.AsSpan(slice.Offset, slice.Bytes);
            var matrix = new double[16]; for (int at = 0; at < 16; at++) matrix[at] = F64(raw, 256 + at * 8);
            int count = checked((int)item.Range.ReferencedVertexCount), coordinatesAt = checked(384 + count * 4), indicesAt = checked(coordinatesAt + count * 24);
            for (uint triangle = 0; triangle < item.Range.TriangleCount; triangle++)
            {
                validated.Budget.Spend(); int at = checked(indicesAt + (int)triangle * 12);
                uint a = U32(raw, at), b = U32(raw, at + 4), c = U32(raw, at + 8);
                triangleVisitor(new(item.Placement.RangeOrdinal, item.Range.FragmentOrdinal, checked(item.Range.TriangleStart + triangle),
                    U32(raw, checked(384 + (int)a * 4)), U32(raw, checked(384 + (int)b * 4)), U32(raw, checked(384 + (int)c * 4)),
                    Point(raw, coordinatesAt, a, matrix), Point(raw, coordinatesAt, b, matrix), Point(raw, coordinatesAt, c, matrix)));
                validated.Budget.Check();
            }
        }
        validated.Budget.Check(); return validated.Report;
    }
    private static PackedCanonicalPoint Point(ReadOnlySpan<byte> bytes, int coordinatesAt, uint index, double[] matrix)
    {
        int at = checked(coordinatesAt + (int)index * 24); double x = F64(bytes, at), y = F64(bytes, at + 8), z = F64(bytes, at + 16);
        double Axis(int axis) => Add(Add(Add(Product(matrix[axis], x), Product(matrix[4 + axis], y)), Product(matrix[8 + axis], z)), matrix[12 + axis]);
        return new(Axis(0), Axis(1), Axis(2));
    }
    private sealed record RangeSlice(int Offset, int Bytes, PackedExpectedRange Expected);
    private sealed record ValidatedPart(byte[] Bytes, PackedPartValidationReport Report, List<RangeSlice> Ranges, Budget Budget);
    private static ValidatedPart Validate(ReadOnlyMemory<byte> bytes, PackedPartExpectedDescriptor expectedDescriptor,
        PackedPartLimits? limits, CancellationToken token)
    {
        token.ThrowIfCancellationRequested(); limits ??= new(); CheckLimits(limits);
        var budget = new Budget(limits.MaximumWork, limits.MaximumMilliseconds, token);
        if (expectedDescriptor is null || expectedDescriptor.Part is null || expectedDescriptor.Ranges is null) Fail("EXPECTED_PART_REQUIRED");
        var expected = expectedDescriptor!.Part with { Context = CheckedContext(expectedDescriptor.Part.Context) };
        if (bytes.Length < 32 || bytes.Length > limits.MaximumBytes || expectedDescriptor.PayloadBytes != bytes.Length
            || expected.RangeCount is < 1 or > 8192 || expected.RangeCount > limits.MaximumRanges
            || expected.PlannedEncodedBytesUpperBound is < 8192 or > 33_554_432 || bytes.Length > expected.PlannedEncodedBytesUpperBound)
            Fail("PART_BYTES_OR_COUNTS");
        Digest(expectedDescriptor.PayloadSha256); Digest(expectedDescriptor.FrameSha256);
        if (expectedDescriptor.FrameSha256 != expected.Context.FrameSha256 || expectedDescriptor.FrameHashInputUtf8.Length is < 1
            || expectedDescriptor.FrameHashInputUtf8.Length > limits.MaximumFrameBytes) Fail("FRAME_BINDING");
        // A read-only view may wrap mutable caller memory. All subsequent reads
        // and identities use this one bounded private snapshot.
        var owned = bytes.ToArray(); var frameBytes = expectedDescriptor.FrameHashInputUtf8.ToArray(); budget.Check();
        string payloadHash = BarrierCaptureVerifier.Hash(owned);
        if (payloadHash != expectedDescriptor.PayloadSha256) Fail("PAYLOAD_SHA256");
        var frame = ReadFrame(frameBytes, expectedDescriptor.FrameSha256, budget);
        var raw = owned.AsSpan();
        if (!raw[..8].SequenceEqual("WFCPFBP1"u8) || U32(raw, 8) != 1 || U32(raw, 16) != owned.Length
            || U32(raw, 20) != expected.RangeCount || U32(raw, 24) != 0 || U32(raw, 28) != 0) Fail("PART_HEADER");
        uint descriptorLength = U32(raw, 12);
        if (descriptorLength < 1 || descriptorLength > owned.Length - 32) Fail("DESCRIPTOR_BYTES");
        int dataOffset = checked(32 + (int)descriptorLength), descriptorAt = 0;
        var descriptor = owned.AsMemory(32, (int)descriptorLength);
        string contextJson = Canonical(expected.Context), marker = ",\"roots\":";
        int split = contextJson.IndexOf(marker, StringComparison.Ordinal);
        if (split < 0) Fail("EXPECTED_CONTEXT");
        string prefix = contextJson[..split] + ",\"ranges\":[", suffix = "]" + contextJson[split..];
        if (32 + Utf8.GetByteCount(prefix) + Utf8.GetByteCount(suffix) > 8192) Fail("CONTEXT_ENVELOPE");
        Match(descriptor.Span, ref descriptorAt, prefix);
        long planned = 8192; int vertices = 0, triangles = 0;
        var fragments = new HashSet<uint>(); var physical = new HashSet<uint>();
        PackedExpectedRange? previous = null; var slices = new List<RangeSlice>();
        using var cursor = expectedDescriptor.Ranges.GetEnumerator();
        try
        {
            for (int ordinal = 0; ordinal < expected.RangeCount; ordinal++)
            {
                budget.Spend(); if (!cursor.MoveNext()) Fail("EXPECTED_RANGE_MISSING"); budget.Check();
                var item = CheckedRange(cursor.Current, expected.Context.PartIndex, previous);
                var range = item.Range; string rangeHash = HashObject(new { domain = "wfc.pf.barrier-multipart.v2/range", value = range });
                if (rangeHash != item.Placement.RangeSha256) Fail("RANGE_SHA256");
                string row = Canonical(new { range.FragmentOrdinal, range.TriangleStart, range.TriangleCount, range.ReferencedVertexCount,
                    range.SourceVertexIdsSha256, range.SourceIndicesSha256, range.SourceGeometrySha256, range.TransformSha256, range.MembershipMask,
                    item.Placement.RangeOrdinal, rangeSha256 = rangeHash });
                if (Utf8.GetByteCount(row) + 1 > 4096) Fail("RANGE_ENVELOPE");
                if (ordinal != 0) Match(descriptor.Span, ref descriptorAt, ","); Match(descriptor.Span, ref descriptorAt, row);
                vertices = checked(vertices + (int)range.ReferencedVertexCount); triangles = checked(triangles + (int)range.TriangleCount);
                planned = checked(planned + RangePlannedBytes(range));
                if (vertices > limits.MaximumVertices || triangles > limits.MaximumTriangles || planned > expected.PlannedEncodedBytesUpperBound) Fail("PART_GEOMETRY_LIMIT");
                bool firstOccurrence = fragments.Add(range.FragmentOrdinal);
                if (firstOccurrence && !physical.Add(item.Fragment.FragmentId)) Fail("FRAGMENT_ALIAS");
                if (fragments.Count > 8192) Fail("FRAGMENT_REFERENCE_LIMIT");
                long rangeBytes = checked(384L + 28L * range.ReferencedVertexCount + 12L * range.TriangleCount);
                if (rangeBytes > owned.Length - dataOffset) Fail("RANGE_BINARY_BYTES");
                ReadRange(raw.Slice(dataOffset, (int)rangeBytes), item, frame, expected.Context, budget);
                slices.Add(new(dataOffset, (int)rangeBytes, item));
                dataOffset = checked(dataOffset + (int)rangeBytes); previous = item;
            }
            budget.Check(); if (cursor.MoveNext()) Fail("EXPECTED_RANGE_EXTRA"); budget.Check();
            Match(descriptor.Span, ref descriptorAt, suffix);
            if (descriptorAt != descriptor.Length || dataOffset != owned.Length || planned != expected.PlannedEncodedBytesUpperBound) Fail("PART_EXACT_END");
        }
        catch (OverflowException) { throw new PackedPartRefusalException("ARITHMETIC_LIMIT"); }
        string descriptorHash;
        using (var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
        {
            digest.AppendData("{\"domain\":\"wfc.pf.barrier-packed-mesh.v1/descriptor\",\"value\":"u8);
            digest.AppendData(descriptor.Span); digest.AppendData("}"u8);
            descriptorHash = Convert.ToHexString(digest.GetHashAndReset()).ToLowerInvariant();
        }
        budget.Check(); return new(owned, new(expected.Context, descriptorHash, payloadHash,
            new((int)expected.RangeCount, fragments.Count, vertices, triangles, owned.Length)), slices, budget);
    }

    private static PackedPartContext CheckedContext(PackedPartContext? value)
    {
        if (value is null || value.ProducerProfile is null || value.Roots is null) Fail("EXPECTED_CONTEXT");
        var context = value! with { ProducerProfile = value.ProducerProfile with { }, Roots = value.Roots with { } };
        var profile = context.ProducerProfile; var roots = context.Roots;
        if (context.SchemaVersion != "wfc.pf.barrier-packed-part.v1" || context.CodecVersion != "wfc.pf.barrier-packed-mesh.v1"
            || context.PartIndex >= 1_048_576 || context.SourceGeometryProvenance != "protected-producer-reported" || context.SdkSourceBytesVerified
            || profile.SchemaVersion != "wfc.pf.barrier-multipart-producer.v2" || profile.SdkVersion != "7.130.0"
            || profile.TriangleOrder != "sdk7130-rendered-triangle-order-v1" || profile.GeometryDigest != "sha256-bounded-chunk-chain-v1"
            || profile.Visibility != "selected-scope-includes-hidden-geometry-v1") Fail("EXPECTED_CONTEXT");
        Uuid(context.IntentId);
        foreach (var hash in new[] { context.ContextSha256, context.ScopeSha256, context.ProfileSha256, context.FrameSha256,
            roots.Nodes, roots.Fragments, roots.GeometryRanges, roots.Plan }) Digest(hash);
        return context;
    }
    private static PackedExpectedRange CheckedRange(PackedExpectedRange? value, uint part, PackedExpectedRange? previous)
    {
        if (value is null || value.Placement is null || value.Range is null || value.Fragment is null) Fail("EXPECTED_RANGE_REQUIRED");
        var item = value! with { Placement = value.Placement with { }, Range = value.Range with { }, Fragment = value.Fragment with { } };
        var p = item.Placement; var r = item.Range; var f = item.Fragment;
        if (p.PartIndex != part || p.RangeOrdinal >= 16_777_216 || p.FragmentOrdinal >= 1_048_576 || r.FragmentOrdinal != p.FragmentOrdinal
            || p.TriangleStart != r.TriangleStart || p.TriangleCount != r.TriangleCount || p.ReferencedVertexCount != r.ReferencedVertexCount
            || r.TriangleCount is < 1 or > 250_000 || r.ReferencedVertexCount is < 3 or > 500_000 || r.ReferencedVertexCount > 3L * r.TriangleCount
            || (ulong)r.TriangleStart + r.TriangleCount > uint.MaxValue || p.PlannedEncodedBytesUpperBound != RangePlannedBytes(r)
            || p.PlannedEncodedBytesUpperBound + 8192 > 33_554_432 || f.Primitive != "triangles" || f.FragmentId > int.MaxValue || f.OwnerDbId > int.MaxValue
            || f.OwnerNodeOrdinal >= 1_048_576 || f.SourceVertexCount < 3 || f.SourceTriangleCount < 1 || r.ReferencedVertexCount > f.SourceVertexCount
            || (ulong)r.TriangleStart + r.TriangleCount > f.SourceTriangleCount || r.SourceGeometrySha256 != f.SourceGeometrySha256
            || r.TransformSha256 != f.TransformSha256 || r.MembershipMask != f.MembershipMask) Fail("EXPECTED_RANGE_BINDING");
        foreach (var hash in new[] { p.RangeSha256, r.SourceVertexIdsSha256, r.SourceIndicesSha256, r.SourceGeometrySha256, r.TransformSha256 }) Digest(hash);
        if (!Hex(r.MembershipMask, 32) || r.MembershipMask.All(c => c == '0')) Fail("MEMBERSHIP_MASK");
        if (previous is { } last)
        {
            if (p.RangeOrdinal != last.Placement.RangeOrdinal + 1) Fail("EXPECTED_RANGE_ORDER");
            if (r.FragmentOrdinal == last.Range.FragmentOrdinal)
            {
                if (f != last.Fragment || r.TriangleStart != (ulong)last.Range.TriangleStart + last.Range.TriangleCount) Fail("EXPECTED_RANGE_CONTINUITY");
            }
            else if (r.FragmentOrdinal != last.Range.FragmentOrdinal + 1 || f.FragmentId <= last.Fragment.FragmentId || r.TriangleStart != 0
                || (ulong)last.Range.TriangleStart + last.Range.TriangleCount != last.Fragment.SourceTriangleCount) Fail("EXPECTED_FRAGMENT_CONTINUITY");
        }
        return item;
    }
    private static long RangePlannedBytes(PackedGeometryRange r) => 4096L + 128L * r.ReferencedVertexCount + 48L * r.TriangleCount;

    private static void ReadRange(ReadOnlySpan<byte> bytes, PackedExpectedRange item, Frame frame, PackedPartContext context, Budget budget)
    {
        var r = item.Range; int count = (int)r.ReferencedVertexCount, triangles = (int)r.TriangleCount;
        double[] original = Matrix(bytes[..128], budget), world = Matrix(bytes.Slice(128, 128), budget), canonical = Matrix(bytes.Slice(256, 128), budget);
        var expectedWorld = frame.Model is null ? original : Multiply(frame.Model, original);
        if (!SameBits(world, expectedWorld) || !SameBits(canonical, Multiply(frame.Display, world))) Fail("MATRIX_RELATION");
        var transform = new Chain("sdk7130-canonical-transform-v1", Canonical(new { scopeSha256 = context.ScopeSha256, frameSha256 = context.FrameSha256,
            encoding = "binary64-little-endian-preserve-signed-zero", segments = new[] { "original", "world", "canonical" } }));
        transform.Segment(bytes[..128]); transform.Segment(bytes.Slice(128, 128)); transform.Segment(bytes.Slice(256, 128));
        if (transform.Finish() != r.TransformSha256) Fail("TRANSFORM_CHAIN");
        int idBytes = checked(count * 4), coordinateBytes = checked(count * 24), indexBytes = checked(triangles * 12);
        var ids = bytes.Slice(384, idBytes); var coordinates = bytes.Slice(384 + idBytes, coordinateBytes); var indices = bytes.Slice(384 + idBytes + coordinateBytes, indexBytes);
        uint previousId = 0;
        for (int at = 0; at < count; at++)
        {
            budget.Spend(); uint source = U32(ids, at * 4);
            if (source >= item.Fragment.SourceVertexCount || at != 0 && source <= previousId) Fail("ORIGINAL_VERTEX_IDS"); previousId = source;
            double x = F64(coordinates, at * 24), y = F64(coordinates, at * 24 + 8), z = F64(coordinates, at * 24 + 16);
            if (!Coordinate(x, 1e12) || !Coordinate(y, 1e12) || !Coordinate(z, 1e12)) Fail("LOCAL_COORDINATE");
            for (int axis = 0; axis < 3; axis++)
            {
                double value = Add(Add(Add(Product(canonical[axis], x), Product(canonical[4 + axis], y)), Product(canonical[8 + axis], z)), canonical[12 + axis]);
                if (!Coordinate(value, 1e9)) Fail("CANONICAL_COORDINATE");
            }
        }
        var idChain = new Chain("sdk7130-ordered-original-vertex-ids-v1", Canonical(new { encoding = "uint32-little-endian", values = count }));
        for (int at = 0; at < ids.Length; at += ChunkBytes) { budget.Spend(); idChain.Segment(ids.Slice(at, Math.Min(ChunkBytes, ids.Length - at))); }
        if (idChain.Finish() != r.SourceVertexIdsSha256) Fail("VERTEX_ID_CHAIN");
        var used = new bool[count]; int referenced = 0, buffered = 0; var reconstructed = new byte[ChunkBytes];
        var indexChain = new Chain("sdk7130-rendered-original-indices-v1", Canonical(new { encoding = "uint32-little-endian", values = triangles * 3 }));
        for (int at = 0; at < indices.Length; at += 12)
        {
            budget.Spend(); uint a = U32(indices, at), b = U32(indices, at + 4), c = U32(indices, at + 8);
            if (a >= count || b >= count || c >= count || a == b || b == c || a == c) Fail("REMAPPED_TRIANGLE_INDICES");
            for (int vertex = 0; vertex < 3; vertex++)
            {
                uint local = vertex == 0 ? a : vertex == 1 ? b : c;
                if (!used[local]) { used[local] = true; referenced++; }
                BinaryPrimitives.WriteUInt32LittleEndian(reconstructed.AsSpan(buffered, 4), U32(ids, checked((int)local * 4))); buffered += 4;
                if (buffered == ChunkBytes) { indexChain.Segment(reconstructed); buffered = 0; }
            }
        }
        if (buffered != 0) indexChain.Segment(reconstructed.AsSpan(0, buffered));
        if (referenced != count) Fail("NONMINIMAL_VERTEX_MAP");
        if (indexChain.Finish() != r.SourceIndicesSha256) Fail("ORIGINAL_INDEX_CHAIN"); budget.Check();
    }

    private sealed record Frame(double[] Display, double[]? Model);
    private static Frame ReadFrame(byte[] bytes, string expectedHash, Budget budget)
    {
        if (BarrierCaptureVerifier.Hash(bytes) != expectedHash) Fail("FRAME_SHA256");
        try
        {
            _ = Utf8.GetCharCount(bytes); using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
            var root = document.RootElement;
            Fields(root, "schemaVersion", "projectId", "modelVersionId", "contentFingerprint", "loadId", "sdkVersion", "matrixPrecision", "coordinateFrame", "sourceUnits", "metresPerDisplayUnit",
                "upVector", "globalOffsetDisplayUnits", "globalOffsetMetres", "displayToWorldMetres", "modelTransform", "placementTransform");
            if (Text(root, "schemaVersion") != "wfc.pf.barrier-frame-observation.v1" || Text(root, "sdkVersion") != "7.130.0" || Text(root, "matrixPrecision") != "binary64"
                || Text(root, "coordinateFrame") != "canonical-world-metres") Fail("FRAME_SCHEMA");
            Uuid(Text(root, "projectId")); Uuid(Text(root, "modelVersionId")); Uuid(Text(root, "loadId")); Digest(Text(root, "contentFingerprint"));
            string units = Text(root, "sourceUnits"); if (units.Length is < 1 or > 64 || units.Any(c => c < 32 || c is >= '\u007f' and <= '\u009f')) Fail("FRAME_UNITS");
            for (int at = 0; at < units.Length; at++)
                if (char.IsHighSurrogate(units[at])) { if (++at >= units.Length || !char.IsLowSurrogate(units[at])) Fail("FRAME_UNITS"); }
                else if (char.IsLowSurrogate(units[at])) Fail("FRAME_UNITS");
            double scale = root.GetProperty("metresPerDisplayUnit").GetDouble(); if (!double.IsFinite(scale) || scale is <= 0 or > 1e6) Fail("FRAME_UNITS");
            var up = JsonNumbers(root.GetProperty("upVector"), 3, 1e12);
            if (Math.Abs(up[0]) > 1e-12 || Math.Abs(up[1]) > 1e-12 || Math.Abs(up[2] - 1) > 1e-12) Fail("FRAME_UP_VECTOR");
            _ = JsonNumbers(root.GetProperty("globalOffsetDisplayUnits"), 3, 1e12); _ = JsonNumbers(root.GetProperty("globalOffsetMetres"), 3, 1e9);
            var display = JsonNumbers(root.GetProperty("displayToWorldMetres"), 16, 1e9); CheckMatrix(display);
            double[]? model = null;
            foreach (string name in new[] { "modelTransform", "placementTransform" })
                if (root.GetProperty(name).ValueKind != JsonValueKind.Null)
                { var matrix = JsonNumbers(root.GetProperty(name), 16, 1e9); CheckMatrix(matrix); if (name == "modelTransform") model = matrix; }
            budget.Check(); return new(display, model);
        }
        catch (Exception error) when (error is JsonException or DecoderFallbackException or InvalidOperationException or FormatException or OverflowException)
        { throw new PackedPartRefusalException("FRAME_JSON"); }
    }
    private static double[] JsonNumbers(JsonElement value, int count, double maximum)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != count) Fail("FRAME_ARRAY");
        var result = new double[count]; int at = 0;
        foreach (var item in value.EnumerateArray()) { double number = item.GetDouble(); if (!Coordinate(number, maximum)) Fail("FRAME_NUMBER"); result[at++] = number; } return result;
    }
    private static string Text(JsonElement value, string name) => value.GetProperty(name).GetString() ?? throw new PackedPartRefusalException("FRAME_TEXT");
    private static void Fields(JsonElement value, params string[] fields)
    {
        if (value.ValueKind != JsonValueKind.Object) Fail("FRAME_FIELDS"); var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject()) if (!names.Add(property.Name) || !fields.Contains(property.Name, StringComparer.Ordinal)) Fail("FRAME_FIELDS");
        if (names.Count != fields.Length) Fail("FRAME_FIELDS");
    }
    private static double[] Matrix(ReadOnlySpan<byte> bytes, Budget budget)
    { var values = new double[16]; for (int i = 0; i < 16; i++) { budget.Spend(); values[i] = F64(bytes, i * 8); } CheckMatrix(values); return values; }
    private static void CheckMatrix(double[] values)
    {
        if (values.Any(value => !Coordinate(value, 1e9)) || values[3] != 0 || values[7] != 0 || values[11] != 0 || values[15] != 1) Fail("MATRIX_AFFINE");
        double determinant = Add(Add(Product(values[0], Add(Product(values[5], values[10]), -Product(values[9], values[6]))),
            -Product(values[4], Add(Product(values[1], values[10]), -Product(values[9], values[2])))), Product(values[8], Add(Product(values[1], values[6]), -Product(values[5], values[2]))));
        if (!double.IsFinite(determinant) || determinant == 0) Fail("MATRIX_SINGULAR");
    }
    private static double[] Multiply(double[] left, double[] right)
    {
        var result = new double[16];
        for (int column = 0; column < 4; column++) for (int row = 0; row < 4; row++)
            result[column * 4 + row] = Add(Add(Add(Product(left[row], right[column * 4]), Product(left[4 + row], right[column * 4 + 1])),
                Product(left[8 + row], right[column * 4 + 2])), Product(left[12 + row], right[column * 4 + 3]));
        return result;
    }
    // Separate no-inline operations force each B13c operation to round to
    // binary64; the JIT cannot replace a sum of products with fused operations.
    [MethodImpl(MethodImplOptions.NoInlining)] private static double Product(double a, double b) => a * b;
    [MethodImpl(MethodImplOptions.NoInlining)] private static double Add(double a, double b) => a + b;
    private static bool SameBits(double[] a, double[] b) => a.Zip(b).All(pair => BitConverter.DoubleToInt64Bits(pair.First) == BitConverter.DoubleToInt64Bits(pair.Second));
    private static bool Coordinate(double value, double maximum) => double.IsFinite(value) && Math.Abs(value) <= maximum;
    private static uint U32(ReadOnlySpan<byte> bytes, int offset) => BinaryPrimitives.ReadUInt32LittleEndian(bytes.Slice(offset, 4));
    private static double F64(ReadOnlySpan<byte> bytes, int offset) => BitConverter.Int64BitsToDouble(BinaryPrimitives.ReadInt64LittleEndian(bytes.Slice(offset, 8)));
    private static bool Hex(string? value, int length) => value is not null && value.Length == length && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static void Digest(string? value) { if (!Hex(value, 64)) Fail("EXPECTED_HASH"); }
    private static void Uuid(string? value)
    {
        if (value is null || value.Length != 36 || value.Where((_, index) => index is not (8 or 13 or 18 or 23)).Any(c => c is not (>= '0' and <= '9' or >= 'a' and <= 'f'))
            || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-') Fail("EXPECTED_UUID");
    }
    private static void Match(ReadOnlySpan<byte> actual, ref int offset, string expected)
    {
        var bytes = Utf8.GetBytes(expected); if (bytes.Length > actual.Length - offset || !actual.Slice(offset, bytes.Length).SequenceEqual(bytes)) Fail("DESCRIPTOR_CANONICAL_BINDING"); offset += bytes.Length;
    }
    private static string Canonical<T>(T value)
    {
        var element = JsonSerializer.SerializeToElement(value, Json); using var stream = new MemoryStream();
        using var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }); Write(element); writer.Flush();
        return Utf8.GetString(stream.ToArray());
        void Write(JsonElement item)
        {
            if (item.ValueKind == JsonValueKind.Object) { writer.WriteStartObject(); foreach (var property in item.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal)) { writer.WritePropertyName(property.Name); Write(property.Value); } writer.WriteEndObject(); }
            else if (item.ValueKind == JsonValueKind.Array) { writer.WriteStartArray(); foreach (var child in item.EnumerateArray()) Write(child); writer.WriteEndArray(); }
            else item.WriteTo(writer);
        }
    }
    private static string HashObject<T>(T value) => BarrierCaptureVerifier.Hash(Utf8.GetBytes(Canonical(value)));
    private sealed class Chain
    {
        private readonly string domain, manifest;
        private string previous;
        private int chunks, segments; private long totalBytes;
        internal Chain(string domain, string manifest)
        {
            this.domain = domain; this.manifest = manifest;
            previous = BarrierCaptureVerifier.Hash(Utf8.GetBytes("{\"domain\":\"" + domain + "\",\"manifest\":" + manifest + ",\"schemaVersion\":\"sha256-bounded-chunk-chain-v1\"}"));
        }
        internal void Segment(ReadOnlySpan<byte> bytes)
        {
            if (bytes.Length is < 1 or > ChunkBytes) Fail("CHAIN_SEGMENT");
            string sha = BarrierCaptureVerifier.Hash(bytes);
            previous = HashObject(new { schemaVersion = "sha256-bounded-chunk-chain-v1", domain, previous, segmentOrdinal = segments++, offset = 0,
                bytes = bytes.Length, sha256 = sha, chunkOrdinal = chunks++ }); totalBytes = checked(totalBytes + bytes.Length);
        }
        internal string Finish()
        {
            using var document = JsonDocument.Parse(manifest);
            return HashObject(new { schemaVersion = "sha256-bounded-chunk-chain-v1", domain, manifest = document.RootElement,
                previous, totalBytes, chunks, segmentCount = segments });
        }
    }
    private static void CheckLimits(PackedPartLimits value)
    {
        if (value.MaximumBytes is < 32 or > 33_554_432 || value.MaximumRanges is < 1 or > 8192 || value.MaximumVertices is < 3 or > 500_000
            || value.MaximumTriangles is < 1 or > 250_000 || value.MaximumFrameBytes is < 1 or > 65_536 || value.MaximumWork is < 1 or > 40_000_000
            || value.MaximumMilliseconds is < 1 or > 60_000) Fail("INVALID_LIMITS");
    }
    private sealed class Budget(long maximum, int milliseconds, CancellationToken token)
    {
        private readonly long started = Stopwatch.GetTimestamp(); private long work;
        internal void Spend() { if (++work > maximum) Fail("WORK_LIMIT"); if ((work & 255) == 0) Check(); }
        internal void Check() { token.ThrowIfCancellationRequested(); if (Stopwatch.GetElapsedTime(started).TotalMilliseconds >= milliseconds) Fail("DEADLINE_EXCEEDED"); }
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Fail(string code) => throw new PackedPartRefusalException(code);
}
