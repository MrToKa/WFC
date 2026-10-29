using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

// Derived data only. One atomic, self-contained artifact avoids a payload /
// manifest publication race. Neither the filename nor this envelope authorizes
// geometry: the core checks its own version and exact input fingerprint again.
internal sealed class GraphPreparationStore
{
    internal const int MaximumPayloadBytes = 16 * 1024 * 1024;
    internal const long MaximumDirectoryBytes = 64L * 1024 * 1024;
    internal const int MaximumEntries = 4;
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("WFCGRAPH0001");
    private static readonly Regex KeyPattern = new("^[a-f0-9]{64}$", RegexOptions.CultureInvariant);
    private static readonly Regex ArtifactPattern = new("^[a-f0-9]{64}\\.graph$", RegexOptions.CultureInvariant);
    private static readonly Regex TemporaryPattern = new("^[a-f0-9]{32}\\.tmp$", RegexOptions.CultureInvariant);
    private const int HeaderBytes = 12 + 64 + 4 + 32;
    private readonly string cacheRoot;
    private readonly string directory;

    internal GraphPreparationStore(string ownedCacheRoot)
    {
        if (!Path.IsPathFullyQualified(ownedCacheRoot)) throw new ArgumentException("An absolute cache root is required.");
        cacheRoot = Path.GetFullPath(ownedCacheRoot);
        directory = Path.Combine(cacheRoot, "graph-v1");
    }

    internal (byte[]? Payload, string Disposition) Read(string key, CancellationToken token)
    {
        ValidateKey(key); token.ThrowIfCancellationRequested();
        try
        {
            if (!CheckDirectory(create: false)) return (null, "missing");
            string path = Path.Combine(directory, key + ".graph");
            var info = new FileInfo(path); info.Refresh();
            if (!info.Exists) return (null, "missing");
            if (!Regular(info) || info.Length < HeaderBytes || info.Length > MaximumPayloadBytes + HeaderBytes)
                return (null, "invalid");
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete,
                65536, FileOptions.SequentialScan);
            var header = new byte[HeaderBytes]; ReadExactly(stream, header, token);
            if (!header.AsSpan(0, Magic.Length).SequenceEqual(Magic)
                || Encoding.ASCII.GetString(header, 12, 64) != key) return (null, "invalid");
            int length = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(76, 4));
            if (length < 1 || length > MaximumPayloadBytes || stream.Length != HeaderBytes + (long)length)
                return (null, "invalid");
            var payload = new byte[length]; ReadExactly(stream, payload, token);
            token.ThrowIfCancellationRequested();
            if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(payload), header.AsSpan(80, 32)))
                return (null, "invalid");
            return (payload, "disk");
        }
        catch (Exception error) when (OptionalCacheError(error)) { return (null, "unavailable"); }
    }

    internal string Write(string key, byte[] payload, CancellationToken token)
    {
        ValidateKey(key); token.ThrowIfCancellationRequested();
        if (payload.Length is < 1 or > MaximumPayloadBytes) return "oversize";
        string? temporary = null;
        try
        {
            if (!CheckDirectory(create: true)) return "unavailable";
            string lockPath = Path.Combine(directory, "publication.lock");
            if (File.Exists(lockPath) && !Regular(new FileInfo(lockPath))) return "unavailable";
            // Do not wait behind another process or hold any project transaction.
            using var publication = new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            string target = Path.Combine(directory, key + ".graph");
            if (File.Exists(target) && !Regular(new FileInfo(target))) return "unavailable";
            var header = new byte[HeaderBytes]; Magic.CopyTo(header, 0);
            Encoding.ASCII.GetBytes(key).CopyTo(header, 12);
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(76, 4), payload.Length);
            SHA256.HashData(payload).CopyTo(header, 80);
            if (!MakeRoom(key, payload.Length + HeaderBytes, token)) return "budget";
            temporary = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".tmp");
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                65536, FileOptions.SequentialScan))
            {
                if (OperatingSystem.IsLinux()) File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                stream.Write(header);
                for (int offset = 0; offset < payload.Length; offset += 65536)
                { token.ThrowIfCancellationRequested(); stream.Write(payload.AsSpan(offset, Math.Min(65536, payload.Length - offset))); }
                stream.Flush(flushToDisk: true);
            }
            token.ThrowIfCancellationRequested();
            File.Move(temporary, target, overwrite: true); temporary = null;
            return "written";
        }
        catch (Exception error) when (OptionalCacheError(error)) { return "unavailable"; }
        finally
        {
            if (temporary is not null)
                try { if (File.Exists(temporary) && Regular(new FileInfo(temporary))) File.Delete(temporary); }
                catch (Exception error) when (OptionalCacheError(error)) { }
        }
    }

    private bool MakeRoom(string replacing, long incoming, CancellationToken token)
    {
        var entries = new List<FileInfo>(); long bytes = 0; int visited = 0;
        foreach (string path in Directory.EnumerateFiles(directory))
        {
            token.ThrowIfCancellationRequested(); if (++visited > 512) return false;
            var info = new FileInfo(path); info.Refresh();
            if (!Regular(info)) continue;
            if (TemporaryPattern.IsMatch(info.Name))
            {
                // Only abandoned artifacts of this format; an active writer
                // owns publication.lock and cannot overlap this cleanup.
                File.Delete(info.FullName); continue;
            }
            if (!ArtifactPattern.IsMatch(info.Name)) continue;
            entries.Add(info); bytes = checked(bytes + info.Length);
        }
        entries.Sort((a, b) => { int time = a.LastWriteTimeUtc.CompareTo(b.LastWriteTimeUtc); return time != 0 ? time : StringComparer.Ordinal.Compare(a.Name, b.Name); });
        int count = entries.Count;
        var old = entries.FirstOrDefault(item => item.Name == replacing + ".graph");
        if (old is not null) { bytes -= old.Length; count--; }
        foreach (var entry in entries)
        {
            if (count < MaximumEntries && bytes + incoming <= MaximumDirectoryBytes) return true;
            if (entry.Name == replacing + ".graph") continue;
            token.ThrowIfCancellationRequested(); File.Delete(entry.FullName); bytes -= entry.Length; count--;
        }
        return count < MaximumEntries && bytes + incoming <= MaximumDirectoryBytes;
    }

    private bool CheckDirectory(bool create)
    {
        for (DirectoryInfo? current = new(cacheRoot); current is not null; current = current.Parent)
        {
            current.Refresh();
            if (!current.Exists || (current.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != FileAttributes.Directory)
                return false;
        }
        if (!Directory.Exists(directory))
        {
            if (!create) return false;
            Directory.CreateDirectory(directory);
            if (OperatingSystem.IsLinux()) File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        var own = new DirectoryInfo(directory); own.Refresh();
        return own.Exists && (own.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == FileAttributes.Directory;
    }

    private static bool Regular(FileInfo file)
    { file.Refresh(); return file.Exists && (file.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0; }
    private static void ValidateKey(string key)
    { if (!KeyPattern.IsMatch(key)) throw new ArgumentException("Invalid prepared graph identity."); }
    private static bool OptionalCacheError(Exception error) => error is IOException or UnauthorizedAccessException or System.Security.SecurityException or OverflowException;
    private static void ReadExactly(Stream stream, byte[] bytes, CancellationToken token)
    {
        for (int offset = 0; offset < bytes.Length;)
        {
            token.ThrowIfCancellationRequested();
            int count = stream.Read(bytes, offset, Math.Min(65536, bytes.Length - offset));
            if (count == 0) throw new EndOfStreamException(); offset += count;
        }
    }
}
