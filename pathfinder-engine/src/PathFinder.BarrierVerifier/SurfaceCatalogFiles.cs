using System.Security.Cryptography;

namespace PathFinder.BarrierVerifier;

internal static class SurfaceFiles
{
    internal static string CheckedDirectory(string directory, bool create)
    {
        if (!Path.IsPathFullyQualified(directory) || Path.GetFullPath(directory) != directory || Path.GetPathRoot(directory) == directory) SurfaceJson.Fail("OUTPUT_PATH");
        if (create)
        {
            if (Directory.Exists(directory) || File.Exists(directory)) SurfaceJson.Fail("OUTPUT_EXISTS");
            string parent = Path.GetDirectoryName(directory)!; CheckAncestors(parent); if (!Directory.Exists(parent)) SurfaceJson.Fail("OUTPUT_PARENT");
            Directory.CreateDirectory(directory); if (Directory.EnumerateFileSystemEntries(directory).Any()) SurfaceJson.Fail("OUTPUT_NOT_EMPTY");
        }
        CheckAncestors(directory); if (!Directory.Exists(directory)) SurfaceJson.Fail("DIRECTORY_MISSING"); return directory;
    }
    internal static void CheckAncestors(string path)
    {
        string? current = path;
        while (!string.IsNullOrEmpty(current))
        {
            var info = new DirectoryInfo(current); if (!info.Exists || (info.Attributes & FileAttributes.ReparsePoint) != 0 || info.LinkTarget is not null) SurfaceJson.Fail("UNSAFE_DIRECTORY");
            current = Path.GetDirectoryName(current);
        }
    }
    internal static FileStream Create(string path)
    {
        CheckAncestors(Path.GetDirectoryName(path)!); if (File.Exists(path) || Directory.Exists(path)) SurfaceJson.Fail("OUTPUT_EXISTS");
        return new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 65_536, FileOptions.WriteThrough);
    }
    internal static FileStream Read(string path)
    {
        CheckAncestors(Path.GetDirectoryName(path)!); var info = new FileInfo(path);
        if (!info.Exists || (info.Attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0 || info.LinkTarget is not null) SurfaceJson.Fail("UNSAFE_FILE");
        var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65_536, FileOptions.SequentialScan);
        if (stream.Length != info.Length) { stream.Dispose(); SurfaceJson.Fail("FILE_CHANGED"); } return stream;
    }
    internal static SurfaceCatalogFile Digest(FileStream stream, SurfaceBudget budget)
    {
        stream.Position = 0; using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256); var chunk = new byte[65_536]; long bytes = 0; int length;
        while ((length = stream.Read(chunk)) != 0) { budget.Spend(); hash.AppendData(chunk.AsSpan(0, length)); bytes = checked(bytes + length); }
        if (bytes != stream.Length) SurfaceJson.Fail("FILE_EXACT_END"); return new(Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(), (ulong)bytes);
    }
    internal static void ReadExactly(FileStream stream, Span<byte> bytes) { try { stream.ReadExactly(bytes); } catch (EndOfStreamException) { SurfaceJson.Fail("FILE_TRUNCATED"); } }
    internal static byte[] OwnedFile(string path, int maximum, SurfaceBudget budget)
    {
        using var stream = Read(path); if (stream.Length < 1 || stream.Length > maximum) SurfaceJson.Fail("FILE_BYTES");
        var bytes = new byte[(int)stream.Length]; ReadExactly(stream, bytes); if (stream.ReadByte() != -1) SurfaceJson.Fail("FILE_EXACT_END"); budget.Spend(); return bytes;
    }
}
internal sealed class SurfaceCatalogWriter : IDisposable
{
    private readonly string directory; private readonly PackedPartContext context; private readonly SurfaceCatalogLimits limits; private readonly SurfaceBudget budget;
    private readonly FileStream index, ranges, rangeIndex; private readonly byte[] pageBuffer, rangeBuffer = new byte[SurfaceBinary.RangeBytes * SurfaceBinary.RangePageRecords];
    private double[] bounds = SurfaceBinary.EmptyBounds(); private uint pageCount, pageTriangles, rangeCount, rangePageCount, rangeBuffered;
    private ulong triangleCount, rangeTriangles, bytes; private bool closed;
    internal SurfaceCatalogWriter(string directory, PackedPartContext context, SurfaceCatalogLimits limits, SurfaceBudget budget)
    {
        this.directory = SurfaceFiles.CheckedDirectory(directory, true); this.context = context; this.limits = limits; this.budget = budget;
        Directory.CreateDirectory(Path.Combine(directory, "pages")); pageBuffer = new byte[SurfaceBinary.PageHeader + limits.PageTriangles * SurfaceBinary.TriangleBytes];
        index = SurfaceFiles.Create(Path.Combine(directory, "index.bin"));
        try { ranges = SurfaceFiles.Create(Path.Combine(directory, "ranges.bin")); }
        catch { index.Dispose(); throw; }
        try { rangeIndex = SurfaceFiles.Create(Path.Combine(directory, "range-index.bin")); }
        catch { index.Dispose(); ranges.Dispose(); throw; }
        try { Write(index, new byte[SurfaceBinary.IndexHeader]); Write(ranges, new byte[SurfaceBinary.RangeHeader]); Write(rangeIndex, new byte[SurfaceBinary.RangeIndexHeader]); }
        catch { Dispose(); throw; }
    }
    private void Charge(int length)
    {
        budget.Spend(); bytes = checked(bytes + (ulong)length); if (bytes > (ulong)limits.MaximumOutputBytes) SurfaceJson.Fail("OUTPUT_BYTE_LIMIT");
        SurfaceFiles.CheckAncestors(directory);
        var drive = new DriveInfo(Path.GetPathRoot(directory)!); if (drive.AvailableFreeSpace < limits.MinimumFreeBytes + length) SurfaceJson.Fail("DISK_HEADROOM");
    }
    private void Write(FileStream file, ReadOnlySpan<byte> data) { Charge(data.Length); file.Write(data); }
    internal void Range(PackedValidatedRange value, string command, string receipt)
    {
        budget.Spend(); if (value.Expected.Placement.RangeOrdinal != rangeCount || rangeCount >= limits.MaximumRanges) SurfaceJson.Fail("CATALOG_RANGE_ORDER");
        byte[] encoded = SurfaceBinary.Range(value, command, receipt, rangeTriangles); rangeTriangles = checked(rangeTriangles + value.Expected.Range.TriangleCount);
        Write(ranges, encoded); encoded.CopyTo(rangeBuffer, checked((int)rangeBuffered * SurfaceBinary.RangeBytes));
        rangeBuffered++; rangeCount++; if (rangeBuffered == SurfaceBinary.RangePageRecords) FlushRangePage();
    }
    private void FlushRangePage()
    {
        if (rangeBuffered == 0) return; byte[] hash = Convert.FromHexString(SurfaceJson.Hash(rangeBuffer.AsSpan(0, checked((int)rangeBuffered * SurfaceBinary.RangeBytes))));
        Write(rangeIndex, hash); rangePageCount++; rangeBuffered = 0;
    }
    internal void Triangle(PackedValidatedTriangle value)
    {
        budget.Spend(); if (triangleCount >= (ulong)limits.MaximumTriangles) SurfaceJson.Fail("TRIANGLE_LIMIT");
        SurfaceBinary.Triangle(pageBuffer.AsSpan(SurfaceBinary.PageHeader + (int)pageTriangles * SurfaceBinary.TriangleBytes, SurfaceBinary.TriangleBytes), value);
        SurfaceBinary.Include(bounds, value.A); SurfaceBinary.Include(bounds, value.B); SurfaceBinary.Include(bounds, value.C);
        pageTriangles++; triangleCount++; if (pageTriangles == limits.PageTriangles) FlushPage();
    }
    private void FlushPage()
    {
        if (pageTriangles == 0) return; if (pageCount >= limits.MaximumPages) SurfaceJson.Fail("PAGE_LIMIT"); budget.Check();
        int length = checked(SurfaceBinary.PageHeader + (int)pageTriangles * SurfaceBinary.TriangleBytes); var header = pageBuffer.AsSpan(0, SurfaceBinary.PageHeader); header.Clear();
        "WFCPFTC1"u8.CopyTo(header); SurfaceBinary.W32(header, 8, 1); SurfaceBinary.W32(header, 12, pageCount);
        SurfaceBinary.W64(header, 16, triangleCount - pageTriangles); SurfaceBinary.W32(header, 24, pageTriangles); SurfaceBinary.W32(header, 28, SurfaceBinary.TriangleBytes); SurfaceBinary.Bounds(header, 32, bounds);
        string filename = Path.Combine(directory, "pages", pageCount.ToString("D8", System.Globalization.CultureInfo.InvariantCulture) + ".bin");
        string hash = SurfaceJson.Hash(pageBuffer.AsSpan(0, length));
        using (var file = SurfaceFiles.Create(filename)) { Write(file, pageBuffer.AsSpan(0, length)); file.Flush(true); }
        var entry = new byte[SurfaceBinary.IndexBytes]; SurfaceBinary.W32(entry, 0, pageCount); SurfaceBinary.W32(entry, 4, pageTriangles);
        SurfaceBinary.W64(entry, 8, triangleCount - pageTriangles); SurfaceBinary.W64(entry, 16, (ulong)length); SurfaceBinary.Sha(entry, 24, hash); SurfaceBinary.Bounds(entry, 56, bounds);
        Write(index, entry); pageCount++; pageTriangles = 0; bounds = SurfaceBinary.EmptyBounds();
    }
    internal SurfaceCatalogManifest Complete(SurfaceCatalogCounts counts, uint selectedParents, string completionHash, string partsHash, Action? verifyCurrent)
    {
        if (closed) SurfaceJson.Fail("WRITER_CLOSED"); FlushPage(); FlushRangePage(); budget.Check();
        if (counts.Ranges != rangeCount || counts.Triangles != triangleCount || rangeTriangles != triangleCount || pageCount == 0) SurfaceJson.Fail("OUTPUT_COUNTS");
        var header = new byte[64]; "WFCPFTI1"u8.CopyTo(header); SurfaceBinary.W32(header, 8, 1); SurfaceBinary.W32(header, 12, SurfaceBinary.IndexBytes);
        SurfaceBinary.W32(header, 16, pageCount); SurfaceBinary.W64(header, 24, triangleCount); Patch(index, header);
        header = new byte[64]; "WFCPFRG1"u8.CopyTo(header); SurfaceBinary.W32(header, 8, 1); SurfaceBinary.W32(header, 12, SurfaceBinary.RangeBytes);
        SurfaceBinary.W64(header, 16, rangeCount); Patch(ranges, header);
        header = new byte[64]; "WFCPFTR1"u8.CopyTo(header); SurfaceBinary.W32(header, 8, 1); SurfaceBinary.W32(header, 12, SurfaceBinary.RangePageRecords);
        SurfaceBinary.W64(header, 16, rangeCount); SurfaceBinary.W32(header, 24, rangePageCount); Patch(rangeIndex, header);
        var manifest = new SurfaceCatalogManifest { Context = context, SelectedParentCount = selectedParents, CompletionReceiptSha256 = completionHash, PartsSha256 = partsHash,
            Counts = counts with { Pages = pageCount }, Index = SurfaceFiles.Digest(index, budget), Ranges = SurfaceFiles.Digest(ranges, budget), RangeIndex = SurfaceFiles.Digest(rangeIndex, budget) };
        byte[] encoded = [];
        for (int attempt = 0; attempt < 8; attempt++)
        {
            encoded = SurfaceJson.Canonical(System.Text.Json.JsonSerializer.SerializeToElement(manifest, SurfaceJson.Options));
            ulong total = checked(bytes + (ulong)encoded.Length); if (manifest.Counts.OutputBytes == total) break;
            manifest = manifest with { Counts = manifest.Counts with { OutputBytes = total } };
            if (attempt == 7) SurfaceJson.Fail("MANIFEST_SIZE_CONVERGENCE");
        }
        if (encoded.Length > 65_536 || manifest.Counts.OutputBytes != bytes + (ulong)encoded.Length) SurfaceJson.Fail("MANIFEST_BYTES");
        // Close/fsync data first. Any failure keeps the final manifest absent.
        index.Dispose(); ranges.Dispose(); rangeIndex.Dispose(); closed = true; budget.Check();
        SurfaceCatalogReader.VerifyDirectory(directory, manifest, encoded.Length, limits, budget);
        string temporary = Path.Combine(directory, "catalog.pending.json"), final = Path.Combine(directory, "catalog.json");
        using (var file = SurfaceFiles.Create(temporary)) { Write(file, encoded); file.Flush(true); }
        budget.Check(); verifyCurrent?.Invoke(); budget.Check(); SurfaceFiles.CheckAncestors(directory); File.Move(temporary, final, overwrite: false); return manifest;
    }
    private static void Patch(FileStream file, byte[] header) { file.Position = 0; file.Write(header); file.Flush(true); }
    public void Dispose() { if (!closed) { try { index.Dispose(); } finally { try { ranges.Dispose(); } finally { rangeIndex.Dispose(); } } closed = true; } }
}
