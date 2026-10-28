using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using PathFinder.BarrierVerifier;

internal sealed record RangeInput(uint FragmentOrdinal, uint FragmentId, uint Start, uint SourceTriangles,
    uint SourceVertices, uint[] Ids, uint[] Indices, double[] Coordinates);
internal sealed record Fixture(byte[] Bytes, byte[] Frame, PackedExpectedPart Part, PackedExpectedRange[] Rows)
{
    internal PackedPartExpectedDescriptor Expected => new() { Part = Part, PayloadBytes = Bytes.Length,
        PayloadSha256 = Fixtures.Hash(Bytes), FrameHashInputUtf8 = Frame, FrameSha256 = Part.Context.FrameSha256, Ranges = Rows };
    internal int DataOffset => 32 + (int)BinaryPrimitives.ReadUInt32LittleEndian(Bytes.AsSpan(12, 4));
    internal Fixture Mutate(Action<byte[]> mutate)
    { var bytes = Bytes.ToArray(); mutate(bytes); return this with { Bytes = bytes }; }
}

// Test encoder/hash recipe is deliberately separate from the production reader.
// The optional JS-golden lane supplies an independently produced cross-language witness.
internal static class Fixtures
{
    internal static string Hash(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    internal static string H(char value) => new(value, 64);
    internal static double[] Identity() => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    internal static double[] Multiply(double[] a, double[] b)
    {
        var result = new double[16];
        for (int c = 0; c < 4; c++) for (int r = 0; r < 4; r++)
            result[c * 4 + r] = ((a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]) + a[8 + r] * b[c * 4 + 2]) + a[12 + r] * b[c * 4 + 3];
        return result;
    }
    internal static RangeInput Tiny(uint ordinal = 0, uint fragmentId = 10, uint start = 0, uint sourceTriangles = 1) =>
        new(ordinal, fragmentId, start, sourceTriangles, 10, [2, 5, 9], [2, 5, 9], [0, 0, 0, 1, 0, 0, 0, 1, 0]);

    internal static Fixture Build(IReadOnlyList<RangeInput>? inputs = null, double[]? original = null,
        double[]? display = null, double[]? model = null, double[]? placement = null, uint partIndex = 0, uint firstRangeOrdinal = 0)
    {
        inputs ??= [Tiny()]; original ??= Identity(); display ??= Identity();
        var frame = Utf8(Canonical(new { schemaVersion = "wfc.pf.barrier-frame-observation.v1", projectId = "10000000-0000-4000-8000-000000000001",
            modelVersionId = "20000000-0000-4000-8000-000000000002", contentFingerprint = H('c'), loadId = "30000000-0000-4000-8000-000000000003",
            sdkVersion = "7.130.0", matrixPrecision = "binary64", coordinateFrame = "canonical-world-metres", sourceUnits = "m", metresPerDisplayUnit = 1,
            upVector = new[] { 0, 0, 1 }, globalOffsetDisplayUnits = new[] { 0, 0, 0 }, globalOffsetMetres = new[] { 0, 0, 0 },
            displayToWorldMetres = display, modelTransform = model, placementTransform = placement }));
        var context = new PackedPartContext { SchemaVersion = "wfc.pf.barrier-packed-part.v1", CodecVersion = "wfc.pf.barrier-packed-mesh.v1",
            IntentId = "40000000-0000-4000-8000-000000000004", ContextSha256 = H('a'), ScopeSha256 = H('b'), ProfileSha256 = H('d'), FrameSha256 = Hash(frame),
            ProducerProfile = new() { SchemaVersion = "wfc.pf.barrier-multipart-producer.v2", SdkVersion = "7.130.0", TriangleOrder = "sdk7130-rendered-triangle-order-v1",
                GeometryDigest = "sha256-bounded-chunk-chain-v1", Visibility = "selected-scope-includes-hidden-geometry-v1" },
            Roots = new() { Nodes = H('1'), Fragments = H('2'), GeometryRanges = H('3'), Plan = H('4') }, PartIndex = partIndex,
            SourceGeometryProvenance = "protected-producer-reported", SdkSourceBytesVerified = false };
        var world = model is null ? original.ToArray() : Multiply(model, original); var canonical = Multiply(display, world);
        string transform = Chain("sdk7130-canonical-transform-v1", new { scopeSha256 = context.ScopeSha256, frameSha256 = context.FrameSha256,
            encoding = "binary64-little-endian-preserve-signed-zero", segments = new[] { "original", "world", "canonical" } }, [Doubles(original), Doubles(world), Doubles(canonical)]);
        var rows = new List<PackedExpectedRange>(); var binaries = new List<byte[]>();
        for (int index = 0; index < inputs.Count; index++)
        {
            var input = inputs[index]; uint triangles = (uint)input.Indices.Length / 3;
            var range = new PackedGeometryRange { FragmentOrdinal = input.FragmentOrdinal, TriangleStart = input.Start, TriangleCount = triangles,
                ReferencedVertexCount = (uint)input.Ids.Length, SourceVertexIdsSha256 = IntegerChain("sdk7130-ordered-original-vertex-ids-v1", input.Ids),
                SourceIndicesSha256 = IntegerChain("sdk7130-rendered-original-indices-v1", input.Indices), SourceGeometrySha256 = H('e'), TransformSha256 = transform,
                MembershipMask = "00000000000000000000000000000001" };
            var fragment = new PackedFragment { FragmentId = input.FragmentId, OwnerNodeOrdinal = 0, OwnerDbId = 20, MembershipMask = range.MembershipMask,
                Primitive = "triangles", SourceGeometrySha256 = range.SourceGeometrySha256, TransformSha256 = transform,
                SourceVertexCount = input.SourceVertices, SourceTriangleCount = input.SourceTriangles };
            var place = new PackedPlanPlacement { PartIndex = partIndex, RangeOrdinal = firstRangeOrdinal + (uint)index, FragmentOrdinal = range.FragmentOrdinal,
                TriangleStart = range.TriangleStart, TriangleCount = triangles, ReferencedVertexCount = range.ReferencedVertexCount,
                RangeSha256 = Hash(Utf8(Canonical(new { domain = "wfc.pf.barrier-multipart.v2/range", value = range }))),
                PlannedEncodedBytesUpperBound = 4096L + 128L * range.ReferencedVertexCount + 48L * triangles };
            rows.Add(new() { Placement = place, Range = range, Fragment = fragment });
            var remapped = input.Indices.Select(value => checked((uint)Array.IndexOf(input.Ids, value))).ToArray();
            binaries.Add(Join(Doubles(original), Doubles(world), Doubles(canonical), Integers(input.Ids), Doubles(input.Coordinates), Integers(remapped)));
        }
        var descriptor = JsonSerializer.SerializeToElement(context, JsonOptions);
        var dictionary = descriptor.EnumerateObject().ToDictionary(p => p.Name, p => (object)p.Value.Clone(), StringComparer.Ordinal);
        dictionary["ranges"] = rows.Select(entry => new { entry.Range.FragmentOrdinal, entry.Range.TriangleStart, entry.Range.TriangleCount,
            entry.Range.ReferencedVertexCount, entry.Range.SourceVertexIdsSha256, entry.Range.SourceIndicesSha256, entry.Range.SourceGeometrySha256,
            entry.Range.TransformSha256, entry.Range.MembershipMask, entry.Placement.RangeOrdinal, entry.Placement.RangeSha256 }).ToArray();
        var metadata = Utf8(Canonical(dictionary)); var body = Join(binaries.ToArray()); var bytes = new byte[checked(32 + metadata.Length + body.Length)];
        "WFCPFBP1"u8.CopyTo(bytes); W32(bytes, 8, 1); W32(bytes, 12, (uint)metadata.Length); W32(bytes, 16, (uint)bytes.Length); W32(bytes, 20, (uint)rows.Count);
        metadata.CopyTo(bytes, 32); body.CopyTo(bytes, 32 + metadata.Length);
        return new(bytes, frame, new() { Context = context, RangeCount = (uint)rows.Count,
            PlannedEncodedBytesUpperBound = 8192 + rows.Sum(r => r.Placement.PlannedEncodedBytesUpperBound) }, rows.ToArray());
    }
    internal static string IntegerChain(string domain, uint[] values)
    {
        var all = Integers(values); var segments = new List<byte[]>();
        for (int offset = 0; offset < all.Length; offset += 262144) segments.Add(all.AsSpan(offset, Math.Min(262144, all.Length - offset)).ToArray());
        return Chain(domain, new { encoding = "uint32-little-endian", values = values.Length }, segments);
    }
    internal static string Chain(string domain, object manifest, IEnumerable<byte[]> segments)
    {
        const string schemaVersion = "sha256-bounded-chunk-chain-v1";
        string previous = Hash(Utf8(Canonical(new { schemaVersion, domain, manifest }))); int segmentCount = 0, chunks = 0; long totalBytes = 0;
        foreach (var segment in segments)
        {
            int ordinal = segmentCount++;
            for (int offset = 0; offset < segment.Length; offset += 262144)
            {
                var chunk = segment.AsSpan(offset, Math.Min(262144, segment.Length - offset)); string sha256 = Hash(chunk); totalBytes += chunk.Length;
                previous = Hash(Utf8(Canonical(new { schemaVersion, domain, previous, segmentOrdinal = ordinal, offset, bytes = chunk.Length, sha256, chunkOrdinal = chunks++ })));
            }
        }
        return Hash(Utf8(Canonical(new { schemaVersion, domain, manifest, previous, totalBytes, chunks, segmentCount })));
    }
    internal static byte[] Integers(uint[] values)
    { var bytes = new byte[values.Length * 4]; for (int i = 0; i < values.Length; i++) W32(bytes, i * 4, values[i]); return bytes; }
    internal static byte[] Doubles(double[] values)
    { var bytes = new byte[values.Length * 8]; for (int i = 0; i < values.Length; i++) BinaryPrimitives.WriteInt64LittleEndian(bytes.AsSpan(i * 8, 8), BitConverter.DoubleToInt64Bits(values[i])); return bytes; }
    internal static void W32(byte[] bytes, int offset, uint value) => BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(offset, 4), value);
    internal static void W64(byte[] bytes, int offset, double value) => BinaryPrimitives.WriteInt64LittleEndian(bytes.AsSpan(offset, 8), BitConverter.DoubleToInt64Bits(value));
    internal static byte[] Join(params byte[][] arrays)
    { var result = new byte[arrays.Sum(a => a.Length)]; int offset = 0; foreach (var array in arrays) { array.CopyTo(result, offset); offset += array.Length; } return result; }
    internal static byte[] Utf8(string text) => Encoding.UTF8.GetBytes(text);
    internal static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow };
    internal static string Canonical<T>(T value)
    {
        var root = JsonSerializer.SerializeToElement(value, JsonOptions); using var stream = new MemoryStream();
        using var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }); Write(root); writer.Flush();
        return Encoding.UTF8.GetString(stream.ToArray());
        void Write(JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.Object) { writer.WriteStartObject(); foreach (var property in element.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal)) { writer.WritePropertyName(property.Name); Write(property.Value); } writer.WriteEndObject(); }
            else if (element.ValueKind == JsonValueKind.Array) { writer.WriteStartArray(); foreach (var child in element.EnumerateArray()) Write(child); writer.WriteEndArray(); }
            else element.WriteTo(writer);
        }
    }
}
