using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Text.Json;
using PathFinder.BarrierVerifier;

int passed = 0, failed = 0;
void Run(string name, Action action)
{ try { action(); passed++; Console.WriteLine("PASS " + name); } catch (Exception e) { failed++; Console.Error.WriteLine("FAIL " + name + ": " + e); } }
void Need(bool value) { if (!value) throw new Exception("Assertion failed."); }
void Refuse(Action action)
{ try { action(); } catch (Exception e) when (e is PackedPartRefusalException or SurfaceCatalogRefusalException) { return; } throw new Exception("Refusal required."); }

Run("visitor emits exact original identities and canonical points only after full validation", () =>
{
    var f = Fixtures.Build(); int ranges = 0, triangles = 0;
    var report = PackedPartReader.VisitValidatedPart(f.Bytes, f.Expected, r => { Need(r.TransformBytes.Length == 384); ranges++; }, t =>
    { Need(t.SourceTriangleIndex == 0 && t.OriginalVertexA == 2 && t.OriginalVertexB == 5 && t.OriginalVertexC == 9); Need(t.A == new PackedCanonicalPoint(0, 0, 0) && t.B.X == 1 && t.C.Y == 1); triangles++; });
    Need(ranges == 1 && triangles == 1 && report.Authority == "none" && !report.SdkSourceBytesVerified);
});
Run("late malformed second range produces zero callbacks", () =>
{
    var f = Fixtures.Build([Fixtures.Tiny(sourceTriangles: 2), Fixtures.Tiny(start: 1, sourceTriangles: 2)]);
    f = f.Mutate(bytes => Fixtures.W64(bytes, f.DataOffset + 480 + 384 + 12, double.NaN)); int calls = 0;
    Refuse(() => PackedPartReader.VisitValidatedPart(f.Bytes, f.Expected, _ => calls++, _ => calls++)); Need(calls == 0);
});
Run("extra expected tuple produces zero callbacks", () =>
{
    var f = Fixtures.Build(); int calls = 0;
    Refuse(() => PackedPartReader.VisitValidatedPart(f.Bytes, f.Expected with { Ranges = [f.Rows[0], f.Rows[0]] }, _ => calls++, _ => calls++)); Need(calls == 0);
});
Run("cursor disposal failure occurs before any callback", () =>
{
    var f = Fixtures.Build(); int calls = 0;
    try { PackedPartReader.VisitValidatedPart(f.Bytes, f.Expected with { Ranges = new DisposeFailure(f.Rows) }, _ => calls++, _ => calls++); throw new Exception("Disposal required."); }
    catch (ApplicationException) { Need(calls == 0); }
});
Run("callback transform and caller input mutation cannot alter validated geometry", () =>
{
    var f = Fixtures.Build(); int visits = 0;
    PackedPartReader.VisitValidatedPart(f.Bytes, f.Expected, range =>
    {
        Need(MemoryMarshal.TryGetArray(range.TransformBytes, out var storage)); Array.Fill(storage.Array!, (byte)0);
        Array.Fill(f.Bytes, (byte)0); Array.Fill(f.Frame, (byte)0);
    }, triangle => { Need(triangle.B.X == 1 && triangle.C.Y == 1); visits++; }); Need(visits == 1);
});
Run("visitor exception and cancellation never return success", () =>
{
    var f = Fixtures.Build(); bool thrown = false;
    try { PackedPartReader.VisitValidatedPart(f.Bytes, f.Expected, _ => { }, _ => throw new ApplicationException()); } catch (ApplicationException) { thrown = true; } Need(thrown);
    using var source = new CancellationTokenSource(); int calls = 0;
    try { PackedPartReader.VisitValidatedPart(f.Bytes, f.Expected, _ => source.Cancel(), _ => calls++, token: source.Token); throw new Exception("Cancellation required."); }
    catch (OperationCanceledException) { Need(calls == 0); }
});

if (args.Length == 2 && args[0] == "--goldens" && Path.IsPathFullyQualified(args[1]))
{
    using var manifest = JsonDocument.Parse(File.ReadAllBytes(args[1])); var m = manifest.RootElement;
    Need(m.GetProperty("schemaVersion").GetString() == "wfc.pf.barrier-surface-catalog-goldens.v1");
    string inputDirectory = Path.GetDirectoryName(args[1])!, outputs = Path.Combine(Path.GetTempPath(), "pathfinder-surface-tests-" + Guid.NewGuid().ToString("D")); Directory.CreateDirectory(outputs);
    int number = 0;
    foreach (var item in m.GetProperty("cases").EnumerateArray())
    {
        var value = item.Clone(); string name = value.GetProperty("name").GetString()!; int index = number++;
        Run("independent JS catalog golden " + name, () => CatalogGoldens.Check(inputDirectory, Path.Combine(outputs, index.ToString("D3")), value));
    }
    Need(number >= 18); Console.WriteLine("CATALOG_GOLDENS " + number);
}
else if (args.Length != 0) { failed++; Console.Error.WriteLine("Usage: [--goldens <absolute manifest.json>]"); }
Console.WriteLine($"SURFACE_TESTS passed={passed} failed={failed}"); return failed == 0 ? 0 : 1;

internal sealed class DisposeFailure(PackedExpectedRange[] values) : IEnumerable<PackedExpectedRange>
{
    public IEnumerator<PackedExpectedRange> GetEnumerator() => new Cursor(values);
    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
    private sealed class Cursor(PackedExpectedRange[] items) : IEnumerator<PackedExpectedRange>
    {
        private int index = -1; public PackedExpectedRange Current => items[index]; object System.Collections.IEnumerator.Current => Current;
        public bool MoveNext() => ++index < items.Length; public void Reset() => throw new NotSupportedException(); public void Dispose() => throw new ApplicationException("Expected disposal refusal.");
    }
}
internal static class CatalogGoldens
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static bool faultChecksDone, pageFaultChecked;
    private static void Need(bool value, string label = "unlabelled golden assertion") { if (!value) throw new Exception("Golden assertion failed: " + label); }
    internal static void Check(string root, string output, JsonElement test)
    {
        var s = test.GetProperty("source"); var context = JsonSerializer.Deserialize<PackedPartContext>(Read(root, s.GetProperty("context"), 65_536), Json)!;
        var streams = s.GetProperty("streams"); var source = new SurfaceCatalogSource { Context = context, SelectedParentCount = s.GetProperty("selectedParentCount").GetInt32(),
            ScopeHashInputUtf8 = Read(root, s.GetProperty("scopeHashInput"), 65_536), ProfileHashInputUtf8 = Read(root, s.GetProperty("profileHashInput"), 65_536),
            FrameHashInputUtf8 = Read(root, s.GetProperty("frame"), 65_536), CompletionReceiptUtf8 = s.GetProperty("completion").ValueKind == JsonValueKind.Null ? [] : Read(root, s.GetProperty("completion"), 65_536),
            Nodes = Stream("nodes"), Fragments = Stream("fragments"), GeometryRanges = Stream("geometry-ranges"), Plan = Stream("plan"), Parts = Parts() };
        SurfaceSealedStream Stream(string kind)
        { var stream = streams.GetProperty(kind).Clone(); return new() { SealUtf8 = Read(root, stream.GetProperty("seal"), 262_144), PagesUtf8 = Pages(stream) }; }
        IEnumerable<ReadOnlyMemory<byte>> Pages(JsonElement stream) { foreach (var page in stream.GetProperty("pages").EnumerateArray()) yield return Read(root, page, 262_144); }
        IEnumerable<SurfacePartInput> Parts()
        { foreach (var part in s.GetProperty("parts").EnumerateArray()) yield return new() { PartIndex = part.GetProperty("partIndex").GetUInt32(), Payload = Read(root, part.GetProperty("payload"), 33_554_432), ReceiptUtf8 = Read(root, part.GetProperty("receipt"), 65_536) }; }
        bool valid = test.GetProperty("outcome").GetString() == "valid"; JsonDocument? expectedDoc = null;
        try
        {
            if (valid) expectedDoc = JsonDocument.Parse(Read(root, test.GetProperty("expected"), 262_144));
            int pageTriangles = expectedDoc?.RootElement.GetProperty("pageTriangles").GetInt32() ?? 2;
            SurfaceCatalogManifest result;
            try { result = SurfaceCatalogCompiler.Compile(source, output, new() { PageTriangles = pageTriangles }); }
            catch (Exception error) when (error is SurfaceCatalogRefusalException or PackedPartRefusalException)
            {
                string code = error is SurfaceCatalogRefusalException surfaceError ? surfaceError.Code : ((PackedPartRefusalException)error).Code;
                if (valid) throw new Exception("Valid fixture unexpectedly refused with " + code, error);
                Need(!File.Exists(Path.Combine(output, "catalog.json")), "refused fixture has no final manifest");
                if (test.TryGetProperty("expectedRefusalCode", out var expectedCode))
                    Need(code == expectedCode.GetString(), "expected refusal " + expectedCode.GetString() + ", received " + code);
                return;
            }
            Need(valid, "negative fixture unexpectedly compiled"); var expected = expectedDoc!.RootElement; var counts = expected.GetProperty("counts");
            Need(result.Counts.Parts == counts.GetProperty("parts").GetUInt32() && result.Counts.Fragments == counts.GetProperty("fragments").GetUInt32()
                && result.Counts.Ranges == counts.GetProperty("ranges").GetUInt32() && result.Counts.Triangles == counts.GetProperty("triangles").GetUInt64(), "compiled part/fragment/range/triangle totals");
            if (!faultChecksDone)
            {
                BudgetRefusal("input", source, new() { MaximumInputBytes = 1 }, "INPUT_LIMIT");
                BudgetRefusal("output", source, new() { MaximumOutputBytes = 1 }, "OUTPUT_BYTE_LIMIT");
                BudgetRefusal("work", source, new() { MaximumWork = 1 }, "WORK_LIMIT");
                BudgetRefusal("invalid-page-limit", source, new() { MaximumPages = 0 }, "INVALID_LIMITS");
                // A finite delayed producer guarantees expiry independently of
                // normal compilation speed; this asserts no timing threshold.
                IEnumerable<SurfacePartInput> DelayedParts()
                { Thread.Sleep(10); foreach (var p in source.Parts) yield return p; }
                BudgetRefusal("deadline", source with { Parts = DelayedParts() }, new() { MaximumMilliseconds = 1 }, "DEADLINE_EXCEEDED");
                string cancelled = output + "-cancelled"; using var cancellation = new CancellationTokenSource(); cancellation.Cancel(); bool cancelledCorrectly = false;
                try { SurfaceCatalogCompiler.Compile(source, cancelled, token: cancellation.Token); } catch (OperationCanceledException) { cancelledCorrectly = true; }
                Need(cancelledCorrectly && !File.Exists(Path.Combine(cancelled, "catalog.json")));
                string disposed = output + "-source-dispose"; bool disposalRefused = false;
                try { SurfaceCatalogCompiler.Compile(source with { Parts = new FinalDisposeFailure<SurfacePartInput>(source.Parts) }, disposed); }
                catch (ApplicationException) { disposalRefused = true; }
                Need(disposalRefused && !File.Exists(Path.Combine(disposed, "catalog.json")));
                string nodeDisposed = output + "-nodes-dispose"; bool nodeDisposalRefused = false;
                try { SurfaceCatalogCompiler.Compile(source with { Nodes = source.Nodes with { PagesUtf8 = new FinalDisposeFailure<ReadOnlyMemory<byte>>(source.Nodes.PagesUtf8) } }, nodeDisposed); }
                catch (ApplicationException) { nodeDisposalRefused = true; }
                Need(nodeDisposalRefused && !File.Exists(Path.Combine(nodeDisposed, "catalog.json")));
                string lateCancelled = output + "-late-cancelled"; using var lateCancellation = new CancellationTokenSource();
                IEnumerable<SurfacePartInput> CancelAtPartEof() { foreach (var part in source.Parts) yield return part; lateCancellation.Cancel(); }
                bool lateCancelledCorrectly = false;
                try { SurfaceCatalogCompiler.Compile(source with { Parts = CancelAtPartEof() }, lateCancelled, token: lateCancellation.Token); }
                catch (OperationCanceledException) { lateCancelledCorrectly = true; }
                Need(lateCancelledCorrectly && !File.Exists(Path.Combine(lateCancelled, "catalog.json")));
                // Existing output must remain byte-for-byte unchanged.
                byte[] existing = File.ReadAllBytes(Path.Combine(output, "catalog.json")); Refusal(() => SurfaceCatalogCompiler.Compile(source, output));
                Need(existing.SequenceEqual(File.ReadAllBytes(Path.Combine(output, "catalog.json")))); faultChecksDone = true;
                Console.WriteLine("CATALOG_FAULTS input/output/work/invalid-page/deadline/cancel/late-cancel/parts-dispose/nodes-dispose/existing-output");
            }
            if (!pageFaultChecked && result.Counts.Triangles > 1)
            {
                BudgetRefusal("page-count", source, new() { MaximumPages = 1, PageTriangles = 1 }, "PAGE_LIMIT");
                BudgetRefusal("triangle-count", source, new() { MaximumTriangles = 1 }, "TRIANGLE_LIMIT");
                pageFaultChecked = true; Console.WriteLine("CATALOG_FAULTS actual-page-count/triangle-count");
            }
            byte[] manifest = File.ReadAllBytes(Path.Combine(output, "catalog.json")); string manifestHash = Fixtures.Hash(manifest);
            using (var reader = SurfaceCatalogReader.Open(output, manifestHash, new() { PageTriangles = pageTriangles }))
            {
                var actual = new List<PackedValidatedTriangle>(); for (uint page = 0; page < result.Counts.Pages; page++) reader.VisitPage(page, t => actual.Add(t));
                var triangles = expected.GetProperty("triangles"); Need(actual.Count == triangles.GetArrayLength(), "cold triangle count"); int at = 0;
                foreach (var t in triangles.EnumerateArray())
                {
                    var a = actual[at++]; var ids = t.GetProperty("sourceIds");
                    Need(a.RangeOrdinal == t.GetProperty("rangeOrdinal").GetUInt32() && a.FragmentOrdinal == t.GetProperty("fragmentOrdinal").GetUInt32()
                        && a.SourceTriangleIndex == t.GetProperty("sourceTriangle").GetUInt32() && a.OriginalVertexA == ids[0].GetUInt32() && a.OriginalVertexB == ids[1].GetUInt32() && a.OriginalVertexC == ids[2].GetUInt32(), "triangle " + (at - 1) + " provenance");
                    Need(Coordinates(a) == t.GetProperty("coordinatesHex").GetString(), "triangle " + (at - 1) + " canonical binary64 bits");
                }
                foreach (var r in expected.GetProperty("ranges").EnumerateArray())
                {
                    var actualRange = reader.ReadRange(r.GetProperty("rangeOrdinal").GetUInt32());
                    Need(actualRange.FragmentOrdinal == r.GetProperty("fragmentOrdinal").GetUInt32() && actualRange.FragmentId == r.GetProperty("fragmentId").GetUInt32()
                        && actualRange.OwnerDbId == r.GetProperty("ownerDbId").GetUInt32() && actualRange.MembershipMask == r.GetProperty("membershipMask").GetString()
                        && actualRange.SourceGeometrySha256 == r.GetProperty("sourceGeometrySha256").GetString() && actualRange.TransformSha256 == r.GetProperty("transformSha256").GetString(), "range " + actualRange.RangeOrdinal + " provenance");
                    Need(Convert.ToHexString(actualRange.TransformBytes.Span[..128]).ToLowerInvariant() == r.GetProperty("originalMatrixHex").GetString()
                        && Convert.ToHexString(actualRange.TransformBytes.Span.Slice(128, 128)).ToLowerInvariant() == r.GetProperty("worldMatrixHex").GetString()
                        && Convert.ToHexString(actualRange.TransformBytes.Span.Slice(256, 128)).ToLowerInvariant() == r.GetProperty("canonicalMatrixHex").GetString(), "range " + actualRange.RangeOrdinal + " three transform byte sequences");
                    Need(MemoryMarshal.TryGetArray(actualRange.TransformBytes, out var storage)); Array.Fill(storage.Array!, (byte)0);
                    Need(reader.ReadRange(actualRange.RangeOrdinal).TransformBytes.Span.SequenceEqual(Convert.FromHexString(r.GetProperty("originalMatrixHex").GetString()!
                        + r.GetProperty("worldMatrixHex").GetString()! + r.GetProperty("canonicalMatrixHex").GetString()!)));
                }
                // Actual original triangles are compared exactly; no surface
                // query, hole clearance or solid occupancy authority is claimed.
                if (expected.TryGetProperty("holeWitness", out var hole)) Need(hole.GetProperty("domain").GetString() == "original-triangle-preservation-only-no-runtime-clearance");
                string firstPage = Path.Combine(output, "pages", "00000000.bin"); byte[] saved = File.ReadAllBytes(firstPage), changed = saved.ToArray(); changed[^1] ^= 1; File.WriteAllBytes(firstPage, changed);
                try { int visits = 0; Refusal(() => reader.VisitPage(0, _ => visits++)); Need(visits == 0); } finally { File.WriteAllBytes(firstPage, saved); }
            }
            foreach (string file in new[] { "catalog.json", "index.bin", "ranges.bin", "range-index.bin" })
            {
                string path = Path.Combine(output, file); byte[] saved = File.ReadAllBytes(path), changed = saved.ToArray(); changed[^1] ^= 1; File.WriteAllBytes(path, changed);
                try { Refusal(() => { using var reader = SurfaceCatalogReader.Open(output, manifestHash, new() { PageTriangles = pageTriangles }); }); }
                finally { File.WriteAllBytes(path, saved); }
            }
            // Fresh independent compilation must produce exactly the same bytes.
            string again = output + "-again"; var repeated = SurfaceCatalogCompiler.Compile(source, again, new() { PageTriangles = pageTriangles });
            Need(repeated == result && File.ReadAllBytes(Path.Combine(again, "catalog.json")).SequenceEqual(manifest), "deterministic second compile manifest");
            // A final currentness refusal occurs after data validation and must
            // leave no completed manifest, even when endpoints are otherwise valid.
            string refused = output + "-currentness"; bool late = false;
            try { SurfaceCatalogCompiler.Compile(source with { VerifyCurrent = () => throw new ApplicationException("Late context refusal") }, refused, new() { PageTriangles = pageTriangles }); }
            catch (ApplicationException) { late = true; } Need(late && !File.Exists(Path.Combine(refused, "catalog.json")));
        }
        finally { expectedDoc?.Dispose(); }
        void BudgetRefusal(string label, SurfaceCatalogSource input, SurfaceCatalogLimits bounds, string code)
        {
            string target = output + "-" + label; bool refused = false;
            try { SurfaceCatalogCompiler.Compile(input, target, bounds); } catch (SurfaceCatalogRefusalException e) { Need(e.Code == code, label + " expected " + code + ", received " + e.Code); refused = true; }
            Need(refused && !File.Exists(Path.Combine(target, "catalog.json")), label + " refusal and absent final manifest");
        }
    }
    private static void Refusal(Action action)
    { try { action(); } catch (SurfaceCatalogRefusalException) { return; } throw new Exception("Cold artifact corruption must refuse."); }
    private static string Coordinates(PackedValidatedTriangle t)
    {
        double[] values = [t.A.X, t.A.Y, t.A.Z, t.B.X, t.B.Y, t.B.Z, t.C.X, t.C.Y, t.C.Z]; var bytes = new byte[72];
        for (int i = 0; i < values.Length; i++) BinaryPrimitives.WriteInt64LittleEndian(bytes.AsSpan(i * 8, 8), BitConverter.DoubleToInt64Bits(values[i])); return Convert.ToHexString(bytes).ToLowerInvariant();
    }
    private static byte[] Read(string root, JsonElement reference, int maximum)
    {
        string relative = reference.GetProperty("path").GetString()!; Need(!Path.IsPathFullyQualified(relative) && relative.IndexOfAny(['/', '\\']) < 0 && relative is not ("." or ".."));
        string path = Path.Combine(root, relative); var info = new FileInfo(path); Need(info.Exists && info.Length > 0 && info.Length <= maximum && (info.Attributes & FileAttributes.ReparsePoint) == 0);
        byte[] bytes = File.ReadAllBytes(path); Need(bytes.Length == reference.GetProperty("bytes").GetInt32() && Fixtures.Hash(bytes) == reference.GetProperty("sha256").GetString()); return bytes;
    }
}
internal sealed class FinalDisposeFailure<T>(IEnumerable<T> values) : IEnumerable<T>
{
    public IEnumerator<T> GetEnumerator() => new Cursor(values.GetEnumerator());
    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
    private sealed class Cursor(IEnumerator<T> cursor) : IEnumerator<T>
    {
        public T Current => cursor.Current; object? System.Collections.IEnumerator.Current => Current;
        public bool MoveNext() => cursor.MoveNext(); public void Reset() => cursor.Reset();
        public void Dispose() { cursor.Dispose(); throw new ApplicationException("Expected final producer disposal refusal."); }
    }
}
