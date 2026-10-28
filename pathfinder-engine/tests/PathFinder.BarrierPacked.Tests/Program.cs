using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using PathFinder.BarrierVerifier;

int passed = 0, failed = 0;
void Run(string name, Action test)
{
    try { test(); passed++; Console.WriteLine("PASS " + name); }
    catch (Exception error) { failed++; Console.Error.WriteLine("FAIL " + name + ": " + error.GetType().Name + " " + error.Message); }
}
void Need(bool value) { if (!value) throw new Exception("Assertion failed."); }
void Refuse(Action action, string? code = null)
{
    try { action(); } catch (PackedPartRefusalException error) { Need(code is null || code == error.Code); return; }
    throw new Exception("Expected a typed packed-part refusal.");
}
void Reject(Fixture fixture, string? code = null) => Refuse(() => PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected), code);
Fixture RewriteDescriptor(Fixture fixture, Func<string, string> change)
{
    int length = fixture.DataOffset - 32; string old = Encoding.UTF8.GetString(fixture.Bytes, 32, length);
    byte[] next = Encoding.UTF8.GetBytes(change(old)); var result = new byte[32 + next.Length + fixture.Bytes.Length - fixture.DataOffset];
    fixture.Bytes.AsSpan(0, 32).CopyTo(result); next.CopyTo(result, 32); fixture.Bytes.AsSpan(fixture.DataOffset).CopyTo(result.AsSpan(32 + next.Length));
    Fixtures.W32(result, 12, (uint)next.Length); Fixtures.W32(result, 16, (uint)result.Length); return fixture with { Bytes = result };
}

Run("minimal original remap and honest structural-only report", () =>
{
    var fixture = Fixtures.Build(); var report = PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected);
    Need(report.Counts == new PackedPartCounts(1, 1, 3, 1, fixture.Bytes.Length));
    Need(report.PayloadSha256 == Fixtures.Hash(fixture.Bytes) && report.DescriptorSha256.Length == 64);
    Need(report.GeometryValidation == "STRUCTURAL_ONLY" && report.Qualification == "NOT_MEASURED" && report.Authority == "none"
        && !report.SdkSourceBytesVerified && report.SourceGeometryProvenance == "protected-producer-reported");
});
Run("same fragment split into contiguous original triangle ranges", () =>
{ var fixture = Fixtures.Build([Fixtures.Tiny(sourceTriangles: 2), Fixtures.Tiny(start: 1, sourceTriangles: 2)]); Need(PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected).Counts.FragmentRefs == 1); });
Run("first range may continue from preceding part", () =>
{ var fixture = Fixtures.Build([Fixtures.Tiny(start: 7, sourceTriangles: 8)], partIndex: 3, firstRangeOrdinal: 11); PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected); });
Run("shared source geometry remains two physical occurrences", () =>
{ var fixture = Fixtures.Build([Fixtures.Tiny(), Fixtures.Tiny(ordinal: 1, fragmentId: 11)]); Need(PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected).Counts.FragmentRefs == 2); });
Run("foreign repeated physical occurrence refuses", () => Reject(Fixtures.Build([Fixtures.Tiny(), Fixtures.Tiny(ordinal: 1)]), "EXPECTED_FRAGMENT_CONTINUITY"));
Run("physical occurrence order refuses", () => Reject(Fixtures.Build([Fixtures.Tiny(fragmentId: 20), Fixtures.Tiny(ordinal: 1, fragmentId: 10)]), "EXPECTED_FRAGMENT_CONTINUITY"));
Run("original triangle range gap refuses", () => Reject(Fixtures.Build([Fixtures.Tiny(sourceTriangles: 3), Fixtures.Tiny(start: 2, sourceTriangles: 3)]), "EXPECTED_RANGE_CONTINUITY"));
Run("new occurrence before previous full source end refuses", () => Reject(Fixtures.Build([Fixtures.Tiny(sourceTriangles: 2), Fixtures.Tiny(ordinal: 1, fragmentId: 11)]), "EXPECTED_FRAGMENT_CONTINUITY"));
Run("fixed receipt catches changed finite xyz bit", () =>
{ var fixture = Fixtures.Build(); var bytes = fixture.Bytes.ToArray(); bytes[fixture.DataOffset + 384 + 12] ^= 1; Refuse(() => PackedPartReader.ValidatePart(bytes, fixture.Expected), "PAYLOAD_SHA256"); });
Run("new matching receipt is not SDK source-byte proof", () =>
{ var fixture = Fixtures.Build(); var changed = fixture.Mutate(bytes => Fixtures.W64(bytes, fixture.DataOffset + 384 + 12, 0.25)); var report = PackedPartReader.ValidatePart(changed.Bytes, changed.Expected); Need(!report.SdkSourceBytesVerified && report.GeometryValidation == "STRUCTURAL_ONLY"); });
Run("signed zero coordinate payload bits retained", () =>
{ var fixture = Fixtures.Build(); var changed = fixture.Mutate(bytes => Fixtures.W64(bytes, fixture.DataOffset + 384 + 12, -0.0)); Need(Fixtures.Hash(changed.Bytes) != Fixtures.Hash(fixture.Bytes)); PackedPartReader.ValidatePart(changed.Bytes, changed.Expected); });
Run("signed zero matrix multiplication uses first product", () =>
{
    var original = Fixtures.Identity(); original[4] = -0.0; original[5] = -1; original[6] = -2; original[7] = -0.0;
    var fixture = Fixtures.Build(original: original, model: Fixtures.Identity());
    Need(BitConverter.DoubleToInt64Bits(BitConverter.Int64BitsToDouble(BinaryPrimitives.ReadInt64LittleEndian(fixture.Bytes.AsSpan(fixture.DataOffset + 128 + 32, 8)))) < 0);
    PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected);
    Reject(fixture.Mutate(bytes => Fixtures.W64(bytes, fixture.DataOffset + 128 + 32, 0.0)), "MATRIX_RELATION");
});
Run("display model original apply once, placement not twice", () =>
{
    var original = Fixtures.Identity(); original[12] = 2; var model = Fixtures.Identity(); model[13] = 3;
    var display = Fixtures.Identity(); display[0] = display[5] = display[10] = 0.001;
    var placement = Fixtures.Identity(); placement[14] = 100;
    var fixture = Fixtures.Build(original: original, model: model, display: display, placement: placement); PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected);
});
Run("all three transform arrays checked", () =>
{ var fixture = Fixtures.Build(); foreach (int offset in new[] { 12 * 8, 128 + 12 * 8, 256 + 12 * 8 }) Reject(fixture.Mutate(bytes => Fixtures.W64(bytes, fixture.DataOffset + offset, 5))); });
Run("nonfinite and unbounded coordinates refuse after new receipt", () =>
{ var fixture = Fixtures.Build(); foreach (double value in new[] { double.NaN, double.PositiveInfinity, 1.00001e12 }) Reject(fixture.Mutate(bytes => Fixtures.W64(bytes, fixture.DataOffset + 396, value)), "LOCAL_COORDINATE"); });
Run("canonical transformed coordinate bound refuses", () =>
{ var display = Fixtures.Identity(); display[12] = 1e9; Reject(Fixtures.Build(display: display), "CANONICAL_COORDINATE"); });
Run("affine singular and nonfinite transforms refuse", () =>
{ var fixture = Fixtures.Build(); foreach (double value in new[] { 0, double.NaN, double.PositiveInfinity, 1.00001e9 }) Reject(fixture.Mutate(bytes => Fixtures.W64(bytes, fixture.DataOffset, value))); Reject(fixture.Mutate(bytes => Fixtures.W64(bytes, fixture.DataOffset + 24, 1)), "MATRIX_AFFINE"); });
Run("sorted original IDs and original source bounds enforced", () =>
{ var fixture = Fixtures.Build(); foreach (uint value in new uint[] { 2, 1, 10 }) Reject(fixture.Mutate(bytes => Fixtures.W32(bytes, fixture.DataOffset + 388, value)), "ORIGINAL_VERTEX_IDS"); });
Run("remap local bounds and distinct triangle indices enforced", () =>
{ var fixture = Fixtures.Build(); foreach (uint value in new uint[] { 0, 3, uint.MaxValue }) Reject(fixture.Mutate(bytes => Fixtures.W32(bytes, fixture.DataOffset + 384 + 12 + 72 + 4, value)), "REMAPPED_TRIANGLE_INDICES"); });
Run("original winding/index chain refuses swapped triangle", () =>
{ var fixture = Fixtures.Build(); Reject(fixture.Mutate(bytes => { int at = fixture.DataOffset + 384 + 12 + 72; Fixtures.W32(bytes, at + 4, 2); Fixtures.W32(bytes, at + 8, 1); }), "ORIGINAL_INDEX_CHAIN"); });
Run("nonminimal source-ID map refuses", () =>
{ var input = new RangeInput(0, 10, 0, 2, 10, [1, 2, 3, 4], [1, 2, 3, 1, 2, 3], new double[12]); Reject(Fixtures.Build([input]), "NONMINIMAL_VERTEX_MAP"); });
Run("integer-chain chunk boundary uses separate source segments", () =>
{
    const int count = 65_538; var ids = Enumerable.Range(0, count).Select(i => (uint)i * 2).ToArray();
    var input = new RangeInput(0, 10, 0, count / 3, (uint)count * 2, ids, ids.ToArray(), new double[count * 3]);
    var fixture = Fixtures.Build([input]); Need(PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected).Counts.Vertices == count);
});
Run("header magic version reserved count offsets and exact length", () =>
{ var fixture = Fixtures.Build(); foreach (int offset in new[] { 0, 8, 12, 16, 20, 24, 28 }) Reject(fixture.Mutate(bytes => bytes[offset] ^= 1)); Reject(fixture with { Bytes = [..fixture.Bytes, 0] }); });
Run("descriptor rejects whitespace duplicates and foreign metadata", () =>
{ var fixture = Fixtures.Build(); foreach (string prefix in new[] { " ", "\"partIndex\":0,", "\"unknown\":false," }) Reject(RewriteDescriptor(fixture, text => "{" + prefix + text[1..]), "DESCRIPTOR_CANONICAL_BINDING"); });
Run("descriptor binds exact context roots and range metadata", () =>
{ var fixture = Fixtures.Build(); Reject(RewriteDescriptor(fixture, text => text.Replace(Fixtures.H('1'), Fixtures.H('5'), StringComparison.Ordinal)), "DESCRIPTOR_CANONICAL_BINDING"); Reject(RewriteDescriptor(fixture, text => text.Replace("\"triangleStart\":0", "\"triangleStart\":1", StringComparison.Ordinal)), "DESCRIPTOR_CANONICAL_BINDING"); });
Run("expected cursor missing extra and wrong placement refuse", () =>
{
    var fixture = Fixtures.Build(); Refuse(() => PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected with { Ranges = [] }), "EXPECTED_RANGE_MISSING");
    Refuse(() => PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected with { Ranges = [fixture.Rows[0], fixture.Rows[0]] }), "EXPECTED_RANGE_EXTRA");
    var row = fixture.Rows[0] with { Placement = fixture.Rows[0].Placement with { PartIndex = 1 } };
    Refuse(() => PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected with { Ranges = [row] }), "EXPECTED_RANGE_BINDING");
});
Run("frame content hash and exact expected context binding", () =>
{ var fixture = Fixtures.Build(); Refuse(() => PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected with { FrameHashInputUtf8 = "{}"u8.ToArray() }), "FRAME_SHA256"); Refuse(() => PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected with { FrameSha256 = Fixtures.H('f') }), "FRAME_BINDING"); });
Run("frame duplicate fields unknown fields malformed UTF8 refuse", () =>
{
    var fixture = Fixtures.Build(); var text = Encoding.UTF8.GetString(fixture.Frame);
    foreach (byte[] bytes in new[] { Encoding.UTF8.GetBytes("{\"sdkVersion\":\"7.130.0\"," + text[1..]), Encoding.UTF8.GetBytes("{\"unknown\":0," + text[1..]), new byte[] { 0xc3, 0x28 } })
    { string hash = Fixtures.Hash(bytes); Refuse(() => PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected with { FrameHashInputUtf8 = bytes, FrameSha256 = hash, Part = fixture.Part with { Context = fixture.Part.Context with { FrameSha256 = hash } } })); }
});
Run("lowered caps and work budget refuse without limit increase", () =>
{ var fixture = Fixtures.Build(); Refuse(() => PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected, new() { MaximumBytes = fixture.Bytes.Length - 1 }), "PART_BYTES_OR_COUNTS"); Refuse(() => PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected, new() { MaximumWork = 1 }), "WORK_LIMIT"); Refuse(() => PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected, new() { MaximumBytes = 33_554_433 }), "INVALID_LIMITS"); });
Run("cancelled entry and cursor enumeration remain cancellation", () =>
{
    var fixture = Fixtures.Build(); using var source = new CancellationTokenSource(); source.Cancel();
    try { PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected, token: source.Token); throw new Exception("Cancellation required."); } catch (OperationCanceledException) { }
    using var during = new CancellationTokenSource(); IEnumerable<PackedExpectedRange> Rows() { during.Cancel(); yield return fixture.Rows[0]; }
    try { PackedPartReader.ValidatePart(fixture.Bytes, fixture.Expected with { Ranges = Rows() }, token: during.Token); throw new Exception("Cancellation required."); } catch (OperationCanceledException) { }
});
Run("mutable caller bytes cannot change already detached decode", () =>
{
    var fixture = Fixtures.Build(); var expected = fixture.Expected; IEnumerable<PackedExpectedRange> Rows() { fixture.Bytes[fixture.DataOffset] ^= 1; fixture.Frame[0] = 0; yield return fixture.Rows[0]; }
    var report = PackedPartReader.ValidatePart(fixture.Bytes, expected with { Ranges = Rows() }); Need(report.PayloadSha256 == expected.PayloadSha256);
});

if (args.Length != 0)
{
    if (args.Length != 2 || args[0] != "--goldens") { Console.Error.WriteLine("Usage: [--goldens <absolute manifest.json>]"); failed++; }
    else Run("independent JS golden manifest", () => { int count = GoldenRunner.Run(args[1]); Need(count > 0); Console.WriteLine("GOLDENS " + count); });
}
Console.WriteLine($"PACKED_TESTS passed={passed} failed={failed}");
return failed == 0 ? 0 : 1;

internal static class GoldenRunner
{
    private sealed record FileReference
    { public required string Path { get; init; } public required string Sha256 { get; init; } public required int Bytes { get; init; } }
    private sealed record PartReference
    { public required string Path { get; init; } public required string FileSha256 { get; init; } public required string ReceiptSha256 { get; init; } public required int Bytes { get; init; } public required int ReceiptBytes { get; init; } }
    private sealed record PageReference
    { public required string Path { get; init; } public required string Sha256 { get; init; } public required int Bytes { get; init; } public required int Rows { get; init; } }
    private sealed record GoldenCase
    { public required string Name { get; init; } public required PartReference Part { get; init; } public required PackedExpectedPart Expected { get; init; }
      public required FileReference Frame { get; init; } public required PageReference[] RangePages { get; init; } public required string Outcome { get; init; } public string? RefusalCode { get; init; } }
    private sealed record Manifest
    { public required string SchemaVersion { get; init; } public required GoldenCase[] Cases { get; init; } }
    private static void Need(bool value) { if (!value) throw new InvalidDataException("Invalid golden fixture metadata or outcome."); }
    private static bool Digest(string value) => value.Length == 64 && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static void NoLinks(string path)
    { for (var node = new FileInfo(path) as FileSystemInfo; node is not null; node = node is FileInfo file ? file.Directory : ((DirectoryInfo)node).Parent) Need((node.Attributes & FileAttributes.ReparsePoint) == 0); }
    private static byte[] Read(string directory, string name, int bytes, string hash, int maximum)
    {
        Need(name.Length is > 0 and <= 128 && name.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_') && name is not "." and not ".."
            && bytes > 0 && bytes <= maximum && Digest(hash));
        string path = System.IO.Path.Combine(directory, name); NoLinks(path);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read); Need(stream.Length == bytes); var result = new byte[bytes]; stream.ReadExactly(result);
        Need(stream.ReadByte() == -1 && stream.Length == bytes && Fixtures.Hash(result) == hash); return result;
    }
    private static T Parse<T>(byte[] bytes)
    {
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 32 }); Visit(document.RootElement);
        return JsonSerializer.Deserialize<T>(bytes, Fixtures.JsonOptions) ?? throw new InvalidDataException("Missing golden JSON.");
        static void Visit(JsonElement value)
        {
            if (value.ValueKind == JsonValueKind.Object) { var names = new HashSet<string>(StringComparer.Ordinal); foreach (var property in value.EnumerateObject()) { Need(names.Add(property.Name)); Visit(property.Value); } }
            else if (value.ValueKind == JsonValueKind.Array) foreach (var child in value.EnumerateArray()) Visit(child);
        }
    }
    internal static int Run(string manifestPath)
    {
        Need(System.IO.Path.IsPathFullyQualified(manifestPath)); manifestPath = System.IO.Path.GetFullPath(manifestPath); NoLinks(manifestPath);
        var info = new FileInfo(manifestPath); Need(info.Length is > 0 and <= 262144); byte[] manifestBytes = File.ReadAllBytes(manifestPath); Need(manifestBytes.Length == info.Length);
        var manifest = Parse<Manifest>(manifestBytes); Need(manifest.SchemaVersion == "wfc.pf.barrier-packed-goldens.v1" && manifest.Cases.Length is > 0 and <= 128);
        string directory = info.DirectoryName!; var names = new HashSet<string>(StringComparer.Ordinal); int completed = 0;
        foreach (var item in manifest.Cases)
        {
            Need(item.Name.Length is > 0 and <= 128 && names.Add(item.Name) && item.Outcome is "valid" or "refused" && item.RangePages.Length is > 0 and <= 8192);
            Need(Digest(item.Part.ReceiptSha256) && item.Part.ReceiptBytes is >= 32 and <= 33554432);
            var part = Read(directory, item.Part.Path, item.Part.Bytes, item.Part.FileSha256, 33554432);
            var frame = Read(directory, item.Frame.Path, item.Frame.Bytes, item.Frame.Sha256, 65536);
            // Preflight every page's integrity outside the negative-outcome catch.
            // Only ValidatePart typed refusals may satisfy a negative golden.
            int total = 0; var pageNames = new HashSet<string>(StringComparer.Ordinal);
            foreach (var page in item.RangePages)
            {
                Need(page.Rows is > 0 and <= 512 && pageNames.Add(page.Path));
                var rows = Parse<PackedExpectedRange[]>(Read(directory, page.Path, page.Bytes, page.Sha256, 262144)); Need(rows.Length == page.Rows); total = checked(total + rows.Length); Need(total <= 8192);
            }
            IEnumerable<PackedExpectedRange> Cursor()
            {
                foreach (var page in item.RangePages)
                {
                    var rows = Parse<PackedExpectedRange[]>(Read(directory, page.Path, page.Bytes, page.Sha256, 262144)); Need(rows.Length == page.Rows);
                    foreach (var row in rows) yield return row;
                }
            }
            var expected = new PackedPartExpectedDescriptor { Part = item.Expected, PayloadSha256 = item.Part.ReceiptSha256, PayloadBytes = item.Part.ReceiptBytes,
                FrameHashInputUtf8 = frame, FrameSha256 = item.Frame.Sha256, Ranges = Cursor() };
            bool refused = false;
            try
            {
                var report = PackedPartReader.ValidatePart(part, expected);
                Need(item.Outcome == "valid" && report.Authority == "none" && !report.SdkSourceBytesVerified && report.GeometryValidation == "STRUCTURAL_ONLY"
                    && report.Qualification == "NOT_MEASURED" && report.PayloadSha256 == item.Part.ReceiptSha256 && report.Counts.Bytes == part.Length && report.Counts.Ranges == total);
            }
            catch (PackedPartRefusalException error) { refused = true; Need(item.Outcome == "refused" && (item.RefusalCode is null || item.RefusalCode == error.Code)); }
            Need(refused == (item.Outcome == "refused")); completed++; Console.WriteLine("PASS GOLDEN " + item.Name);
        }
        return completed;
    }
}
