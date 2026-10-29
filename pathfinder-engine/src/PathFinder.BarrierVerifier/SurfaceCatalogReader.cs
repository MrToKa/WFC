using System.Text.Json;

namespace PathFinder.BarrierVerifier;

/// <summary>Cold structural reader. A trusted manifest digest authenticates this
/// local artifact; it cannot supply SDK, collision or publication authority.</summary>
public sealed class SurfaceCatalogReader : IDisposable
{
    private readonly string directory; private readonly SurfaceCatalogLimits limits; private readonly SurfaceBudget budget;
    private readonly byte[] index, rangeIndex; private readonly FileStream ranges;
    private byte[]? cachedRangePage; private uint cachedRangePageIndex = uint.MaxValue; private bool disposed;
    public SurfaceCatalogManifest Manifest { get; }

    public static SurfaceCatalogReader Open(string directory, string expectedManifestSha256, SurfaceCatalogLimits? limits = null, CancellationToken token = default)
    {
        limits ??= new(); SurfaceBudget.CheckLimits(limits); SurfaceJson.Digest(expectedManifestSha256); var budget = new SurfaceBudget(limits, token);
        directory = SurfaceFiles.CheckedDirectory(directory, false); byte[] bytes = SurfaceFiles.OwnedFile(Path.Combine(directory, "catalog.json"), 65_536, budget);
        if (SurfaceJson.Hash(bytes) != expectedManifestSha256) SurfaceJson.Fail("MANIFEST_HASH");
        using var doc = SurfaceJson.Parse(bytes, 65_536); var manifest = SurfaceJson.Dto<SurfaceCatalogManifest>(doc.RootElement);
        SurfaceJson.Fields(doc.RootElement, "schemaVersion", "geometryPolicy", "geometryValidation", "qualification", "authority", "sourceGeometryProvenance",
            "hierarchyMembershipProvenance", "sdkSourceBytesVerified", "solidOccupancyQualified", "context", "selectedParentCount", "completionReceiptSha256", "partsSha256", "counts", "index", "ranges", "rangeIndex");
        return new(directory, manifest, bytes.Length, limits, budget, true);
    }
    private SurfaceCatalogReader(string directory, SurfaceCatalogManifest manifest, int manifestBytes, SurfaceCatalogLimits limits, SurfaceBudget budget, bool final)
    {
        this.directory = SurfaceFiles.CheckedDirectory(directory, false); this.limits = limits; this.budget = budget; Manifest = manifest;
        ValidateManifest();
        index = SurfaceFiles.OwnedFile(Path.Combine(directory, "index.bin"), checked(SurfaceBinary.IndexHeader + limits.MaximumPages * SurfaceBinary.IndexBytes), budget);
        rangeIndex = SurfaceFiles.OwnedFile(Path.Combine(directory, "range-index.bin"), checked(SurfaceBinary.RangeIndexHeader + ((limits.MaximumRanges + 255) / 256) * 32), budget);
        if ((ulong)index.Length != manifest.Index.Bytes || SurfaceJson.Hash(index) != manifest.Index.Sha256 || (ulong)rangeIndex.Length != manifest.RangeIndex.Bytes
            || SurfaceJson.Hash(rangeIndex) != manifest.RangeIndex.Sha256) SurfaceJson.Fail("CATALOG_INDEX_HASH");
        ranges = SurfaceFiles.Read(Path.Combine(directory, "ranges.bin"));
        try
        {
            if ((ulong)ranges.Length != manifest.Ranges.Bytes || SurfaceFiles.Digest(ranges, budget) != manifest.Ranges) SurfaceJson.Fail("CATALOG_RANGES_HASH");
            ValidateHeaders(); ulong pageBytes = ValidateIndex(); ValidateRangeCoverage();
            ulong total = checked((ulong)manifestBytes + manifest.Index.Bytes + manifest.Ranges.Bytes + manifest.RangeIndex.Bytes + pageBytes);
            if (total != manifest.Counts.OutputBytes) SurfaceJson.Fail("CATALOG_OUTPUT_TOTAL"); CheckFiles(final);
        }
        catch { ranges.Dispose(); throw; }
    }
    internal static void VerifyDirectory(string directory, SurfaceCatalogManifest manifest, int bytes, SurfaceCatalogLimits limits, SurfaceBudget budget)
    {
        using var reader = new SurfaceCatalogReader(directory, manifest, bytes, limits, budget, false);
        for (uint page = 0; page < manifest.Counts.Pages; page++) reader.VisitPage(page, _ => { });
    }
    private void ValidateManifest()
    {
        var m = Manifest;
        if (m.Counts is null || m.Context is null || m.Context.Roots is null || m.Context.ProducerProfile is null || m.Index is null || m.Ranges is null || m.RangeIndex is null) SurfaceJson.Fail("CATALOG_MANIFEST");
        var c = m.Counts;
        if (m.SchemaVersion != "wfc.pf.barrier-surface-catalog.v1" || m.GeometryPolicy != "original-triangles-structural-surface-data.v1"
            || m.GeometryValidation != "STRUCTURAL_COMPLETE" || m.Qualification != "NOT_MEASURED" || m.Authority != "none"
            || m.SourceGeometryProvenance != "protected-producer-reported" || m.HierarchyMembershipProvenance != "protected-producer-reported"
            || m.SdkSourceBytesVerified || m.SolidOccupancyQualified || m.SelectedParentCount is < 1 or > 128 || m.Context.PartIndex != 0
            || c.Nodes is < 1 || c.Nodes > limits.MaximumNodes || c.Fragments is < 1 || c.Fragments > limits.MaximumFragments
            || c.Ranges is < 1 || c.Ranges > limits.MaximumRanges || c.Parts is < 1 || c.Parts > limits.MaximumParts || c.Pages is < 1 || c.Pages > limits.MaximumPages
            || c.Triangles is < 1 || c.Triangles > (ulong)limits.MaximumTriangles || c.Vertices < 3 || c.InputBytes > (ulong)limits.MaximumInputBytes
            || c.OutputBytes > (ulong)limits.MaximumOutputBytes) SurfaceJson.Fail("CATALOG_MANIFEST");
        foreach (string hash in new[] { m.CompletionReceiptSha256, m.PartsSha256, m.Index.Sha256, m.Ranges.Sha256, m.RangeIndex.Sha256,
            m.Context.ContextSha256, m.Context.ScopeSha256, m.Context.ProfileSha256, m.Context.FrameSha256, m.Context.Roots.Nodes,
            m.Context.Roots.Fragments, m.Context.Roots.GeometryRanges, m.Context.Roots.Plan }) SurfaceJson.Digest(hash);
    }
    private void ValidateHeaders()
    {
        var c = Manifest.Counts;
        if (index.Length != SurfaceBinary.IndexHeader + (long)c.Pages * SurfaceBinary.IndexBytes || !index.AsSpan(0, 8).SequenceEqual("WFCPFTI1"u8)
            || SurfaceBinary.U32(index, 8) != 1 || SurfaceBinary.U32(index, 12) != SurfaceBinary.IndexBytes || SurfaceBinary.U32(index, 16) != c.Pages
            || SurfaceBinary.U64(index, 24) != c.Triangles || !SurfaceBinary.Zero(index.AsSpan(20, 4)) || !SurfaceBinary.Zero(index.AsSpan(32, 32))) SurfaceJson.Fail("INDEX_HEADER");
        ulong rangePages = ((ulong)c.Ranges + 255) / 256;
        if (rangeIndex.Length != SurfaceBinary.RangeIndexHeader + (long)rangePages * 32 || !rangeIndex.AsSpan(0, 8).SequenceEqual("WFCPFTR1"u8)
            || SurfaceBinary.U32(rangeIndex, 8) != 1 || SurfaceBinary.U32(rangeIndex, 12) != SurfaceBinary.RangePageRecords
            || SurfaceBinary.U64(rangeIndex, 16) != c.Ranges || SurfaceBinary.U32(rangeIndex, 24) != rangePages || !SurfaceBinary.Zero(rangeIndex.AsSpan(28, 36))) SurfaceJson.Fail("RANGE_INDEX_HEADER");
        ranges.Position = 0; var header = new byte[64]; SurfaceFiles.ReadExactly(ranges, header);
        if (ranges.Length != SurfaceBinary.RangeHeader + (long)c.Ranges * SurfaceBinary.RangeBytes || !header.AsSpan(0, 8).SequenceEqual("WFCPFRG1"u8)
            || SurfaceBinary.U32(header, 8) != 1 || SurfaceBinary.U32(header, 12) != SurfaceBinary.RangeBytes || SurfaceBinary.U64(header, 16) != c.Ranges
            || !SurfaceBinary.Zero(header.AsSpan(24, 40))) SurfaceJson.Fail("RANGE_HEADER");
    }
    private ulong ValidateIndex()
    {
        ulong triangles = 0, bytes = 0;
        for (uint page = 0; page < Manifest.Counts.Pages; page++)
        {
            budget.Spend(); var e = Entry(page); uint count = SurfaceBinary.U32(e, 4); ulong length = SurfaceBinary.U64(e, 16);
            if (SurfaceBinary.U32(e, 0) != page || count is < 1 || count > limits.PageTriangles || SurfaceBinary.U64(e, 8) != triangles
                || length != SurfaceBinary.PageHeader + (ulong)count * SurfaceBinary.TriangleBytes || !SurfaceBinary.Zero(e.Slice(104, 24))) SurfaceJson.Fail("INDEX_ENTRY");
            SurfaceBinary.CheckBounds(SurfaceBinary.Bounds(e, 56)); triangles = checked(triangles + count); bytes = checked(bytes + length);
        }
        if (triangles != Manifest.Counts.Triangles) SurfaceJson.Fail("INDEX_TRIANGLE_TOTAL"); return bytes;
    }
    private void ValidateRangeCoverage()
    {
        SurfaceCatalogRange? previous = null; ulong triangles = 0, vertices = 0; uint fragments = 0; var masks = new byte[16];
        for (uint ordinal = 0; ordinal < Manifest.Counts.Ranges; ordinal++)
        {
            budget.Spend(); var r = ReadRange(ordinal);
            if (r.FirstGlobalTriangle != triangles || r.FragmentOrdinal >= Manifest.Counts.Fragments || r.OwnerNodeOrdinal >= Manifest.Counts.Nodes
                || r.PartIndex >= Manifest.Counts.Parts || r.TriangleCount is < 1 or > 250_000 || r.ReferencedVertexCount is < 3 or > 500_000
                || r.ReferencedVertexCount > r.SourceVertexCount || r.ReferencedVertexCount > 3UL * r.TriangleCount || r.SourceVertexCount < 3
                || (ulong)r.TriangleStart + r.TriangleCount > r.SourceTriangleCount || r.FragmentId > int.MaxValue || r.OwnerDbId > int.MaxValue) SurfaceJson.Fail("CATALOG_RANGE");
            byte[] mask = Convert.FromHexString(r.MembershipMask); if (mask.All(b => b == 0)) SurfaceJson.Fail("CATALOG_MASK");
            for (int bit = (int)Manifest.SelectedParentCount; bit < 128; bit++) if ((mask[15 - bit / 8] & (1 << bit % 8)) != 0) SurfaceJson.Fail("CATALOG_MASK");
            for (int i = 0; i < 16; i++) masks[i] |= mask[i];
            if (previous is null) { if (r.FragmentOrdinal != 0 || r.PartIndex != 0 || r.TriangleStart != 0) SurfaceJson.Fail("CATALOG_RANGE_START"); fragments++; }
            else
            {
                if (r.PartIndex != previous.PartIndex && r.PartIndex != previous.PartIndex + 1) SurfaceJson.Fail("CATALOG_PART_ORDER");
                if (r.FragmentOrdinal == previous.FragmentOrdinal)
                {
                    if (r.FragmentId != previous.FragmentId || r.OwnerNodeOrdinal != previous.OwnerNodeOrdinal || r.OwnerDbId != previous.OwnerDbId
                        || r.MembershipMask != previous.MembershipMask || r.SourceVertexCount != previous.SourceVertexCount || r.SourceTriangleCount != previous.SourceTriangleCount
                        || r.SourceGeometrySha256 != previous.SourceGeometrySha256 || r.TransformSha256 != previous.TransformSha256
                        || !r.TransformBytes.Span.SequenceEqual(previous.TransformBytes.Span) || r.TriangleStart != (ulong)previous.TriangleStart + previous.TriangleCount) SurfaceJson.Fail("CATALOG_FRAGMENT_CONTINUITY");
                }
                else { if (r.FragmentOrdinal != previous.FragmentOrdinal + 1 || r.FragmentId <= previous.FragmentId || r.TriangleStart != 0
                        || (ulong)previous.TriangleStart + previous.TriangleCount != previous.SourceTriangleCount) SurfaceJson.Fail("CATALOG_FRAGMENT_COVERAGE"); fragments++; }
            }
            for (int at = 0; at < 384; at += 8) if (!double.IsFinite(SurfaceBinary.F64(r.TransformBytes.Span, at))) SurfaceJson.Fail("CATALOG_MATRIX");
            triangles = checked(triangles + r.TriangleCount); vertices = checked(vertices + r.ReferencedVertexCount); previous = r;
        }
        if (previous is null || (ulong)previous.TriangleStart + previous.TriangleCount != previous.SourceTriangleCount || previous.PartIndex + 1 != Manifest.Counts.Parts
            || triangles != Manifest.Counts.Triangles || vertices != Manifest.Counts.Vertices || fragments != Manifest.Counts.Fragments) SurfaceJson.Fail("CATALOG_RANGE_TOTALS");
        for (int bit = 0; bit < Manifest.SelectedParentCount; bit++) if ((masks[15 - bit / 8] & (1 << bit % 8)) == 0) SurfaceJson.Fail("CATALOG_PARENT_COVERAGE");
    }
    public SurfaceCatalogRange ReadRange(uint ordinal)
    {
        ThrowIfDisposed(); budget.Spend(); if (ordinal >= Manifest.Counts.Ranges) SurfaceJson.Fail("RANGE_ORDINAL"); uint page = ordinal / SurfaceBinary.RangePageRecords;
        if (cachedRangePage is null || cachedRangePageIndex != page)
        {
            uint count = Math.Min(SurfaceBinary.RangePageRecords, Manifest.Counts.Ranges - page * SurfaceBinary.RangePageRecords);
            var owned = new byte[checked((int)count * SurfaceBinary.RangeBytes)]; ranges.Position = SurfaceBinary.RangeHeader + (long)page * SurfaceBinary.RangePageRecords * SurfaceBinary.RangeBytes;
            SurfaceFiles.ReadExactly(ranges, owned);
            if (SurfaceJson.Hash(owned) != SurfaceBinary.Hex(rangeIndex.AsSpan(SurfaceBinary.RangeIndexHeader + checked((int)page * 32), 32))) SurfaceJson.Fail("RANGE_PAGE_HASH");
            cachedRangePage = owned; cachedRangePageIndex = page;
        }
        var bytes = cachedRangePage.AsSpan(checked((int)(ordinal % SurfaceBinary.RangePageRecords) * SurfaceBinary.RangeBytes), SurfaceBinary.RangeBytes);
        if (SurfaceBinary.U32(bytes, 32) != ordinal || !SurfaceBinary.Zero(bytes.Slice(60, 4)) || !SurfaceBinary.Zero(bytes.Slice(744, 24))) SurfaceJson.Fail("RANGE_RECORD");
        // Range() copies exposed transform memory, never exposes verified cache.
        return SurfaceBinary.Range(bytes);
    }
    public void VisitPage(uint pageIndex, Action<PackedValidatedTriangle> visitor)
    {
        ArgumentNullException.ThrowIfNull(visitor); ThrowIfDisposed(); budget.Check(); var entry = Entry(pageIndex);
        byte[] bytes = SurfaceFiles.OwnedFile(PagePath(pageIndex), SurfaceBinary.PageHeader + limits.PageTriangles * SurfaceBinary.TriangleBytes, budget);
        if ((ulong)bytes.Length != SurfaceBinary.U64(entry, 16) || SurfaceJson.Hash(bytes) != SurfaceBinary.Hex(entry.Slice(24, 32))) SurfaceJson.Fail("PAGE_HASH");
        uint count = SurfaceBinary.U32(entry, 4); ulong first = SurfaceBinary.U64(entry, 8);
        if (!bytes.AsSpan(0, 8).SequenceEqual("WFCPFTC1"u8) || SurfaceBinary.U32(bytes, 8) != 1 || SurfaceBinary.U32(bytes, 12) != pageIndex
            || SurfaceBinary.U64(bytes, 16) != first || SurfaceBinary.U32(bytes, 24) != count || SurfaceBinary.U32(bytes, 28) != SurfaceBinary.TriangleBytes) SurfaceJson.Fail("PAGE_HEADER");
        var bounds = SurfaceBinary.EmptyBounds();
        // Full page hash and every row/provenance/bounds must pass before visits.
        for (uint at = 0; at < count; at++)
        {
            budget.Spend(); var t = SurfaceBinary.Triangle(bytes.AsSpan(SurfaceBinary.PageHeader + checked((int)at * SurfaceBinary.TriangleBytes), SurfaceBinary.TriangleBytes));
            var r = ReadRange(t.RangeOrdinal);
            if (t.FragmentOrdinal != r.FragmentOrdinal || t.SourceTriangleIndex < r.TriangleStart || (ulong)t.SourceTriangleIndex >= (ulong)r.TriangleStart + r.TriangleCount
                || first + at != r.FirstGlobalTriangle + t.SourceTriangleIndex - r.TriangleStart || t.OriginalVertexA >= r.SourceVertexCount || t.OriginalVertexB >= r.SourceVertexCount
                || t.OriginalVertexC >= r.SourceVertexCount || t.OriginalVertexA == t.OriginalVertexB || t.OriginalVertexB == t.OriginalVertexC || t.OriginalVertexA == t.OriginalVertexC) SurfaceJson.Fail("PAGE_TRIANGLE_PROVENANCE");
            SurfaceBinary.Include(bounds, t.A); SurfaceBinary.Include(bounds, t.B); SurfaceBinary.Include(bounds, t.C);
        }
        if (!SurfaceBinary.SameBounds(bounds, SurfaceBinary.Bounds(bytes, 32)) || !SurfaceBinary.SameBounds(bounds, SurfaceBinary.Bounds(entry, 56))) SurfaceJson.Fail("PAGE_DERIVED_BOUNDS");
        budget.Check(); for (uint at = 0; at < count; at++) { budget.Spend(); visitor(SurfaceBinary.Triangle(bytes.AsSpan(SurfaceBinary.PageHeader + checked((int)at * SurfaceBinary.TriangleBytes), SurfaceBinary.TriangleBytes))); budget.Check(); }
    }
    private ReadOnlySpan<byte> Entry(uint indexValue)
    { if (indexValue >= Manifest.Counts.Pages) SurfaceJson.Fail("PAGE_ORDINAL"); return index.AsSpan(SurfaceBinary.IndexHeader + checked((int)indexValue * SurfaceBinary.IndexBytes), SurfaceBinary.IndexBytes); }
    private string PagePath(uint page) => Path.Combine(directory, "pages", page.ToString("D8", System.Globalization.CultureInfo.InvariantCulture) + ".bin");
    private void CheckFiles(bool final)
    {
        var expected = new HashSet<string>(StringComparer.Ordinal) { "index.bin", "ranges.bin", "range-index.bin", "pages" }; if (final) expected.Add("catalog.json");
        foreach (string path in Directory.EnumerateFileSystemEntries(directory)) { budget.Spend(); if (!expected.Remove(Path.GetFileName(path))) SurfaceJson.Fail("CATALOG_EXTRA_FILE"); }
        if (expected.Count != 0) SurfaceJson.Fail("CATALOG_FILE_MISSING"); uint count = 0;
        foreach (string path in Directory.EnumerateFileSystemEntries(Path.Combine(directory, "pages")))
        {
            budget.Spend(); string name = Path.GetFileNameWithoutExtension(path);
            if (Path.GetExtension(path) != ".bin" || name.Length != 8 || !uint.TryParse(name, out uint ordinal) || ordinal >= Manifest.Counts.Pages
                || Path.GetFileName(path) != ordinal.ToString("D8", System.Globalization.CultureInfo.InvariantCulture) + ".bin" || Directory.Exists(path)) SurfaceJson.Fail("CATALOG_PAGE_FILE"); count++;
        }
        if (count != Manifest.Counts.Pages) SurfaceJson.Fail("CATALOG_PAGE_FILES");
    }
    private void ThrowIfDisposed() { if (disposed) throw new ObjectDisposedException(nameof(SurfaceCatalogReader)); }
    public void Dispose() { if (!disposed) { ranges.Dispose(); disposed = true; cachedRangePage = null; } }
}
