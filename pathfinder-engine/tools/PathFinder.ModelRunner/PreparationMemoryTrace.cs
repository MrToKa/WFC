using System.Diagnostics;
using System.Text.Json;
using PathFinder.Model;

/// <summary>Best-effort first-worker cold-phase diagnostics. No wire field,
/// geometry, business row, path or request identifier enters this fixed sink.</summary>
internal static class PreparationMemoryTrace
{
    private const int MaximumRows = 32, MaximumBytes = 65536;
    private static readonly object Gate = new();
    private static FileStream? output;
    private static bool attempted, disabled;
    private static int rows, bytes;
    private static long started;
    internal static Action<PreparationMemoryPhase>? Observer => Environment.GetEnvironmentVariable("PF_ENGINE_MEMORY_PHASES") == "1" ? Observe : null;

    internal static void Observe(PreparationMemoryPhase phase)
    {
        // Exact root-controlled opt-in before filesystem or process/GC metrics.
        if (Environment.GetEnvironmentVariable("PF_ENGINE_MEMORY_PHASES") != "1") return;
        if (!Monitor.TryEnter(Gate)) return; // Diagnostics never wait or retry.
        try
        {
            if (disabled || rows >= MaximumRows) return;
            string label = phase switch
            {
                PreparationMemoryPhase.SourceRead => "source-read",
                PreparationMemoryPhase.BeforeStrictParse => "before-strict-parse",
                PreparationMemoryPhase.BeforeTokenValidation => "before-token-validation",
                PreparationMemoryPhase.AfterTokenValidation => "after-token-validation",
                PreparationMemoryPhase.BeforeTypedDeserialize => "before-typed-deserialize",
                PreparationMemoryPhase.AfterTypedDeserialize => "after-typed-deserialize",
                PreparationMemoryPhase.BeforeSemanticValidation => "before-semantic-validation",
                PreparationMemoryPhase.AfterSemanticValidation => "after-semantic-validation",
                PreparationMemoryPhase.StrictParse => "strict-parse",
                PreparationMemoryPhase.RawDisposed => "raw-disposed",
                PreparationMemoryPhase.BeforePrepareInputs => "before-prepare-inputs",
                PreparationMemoryPhase.AfterPrepareInputs => "after-prepare-inputs",
                PreparationMemoryPhase.SnapshotTransferred => "snapshot-transferred",
                PreparationMemoryPhase.BeforeCoreFit => "before-core-fit",
                PreparationMemoryPhase.AfterCoreFit => "after-core-fit",
                PreparationMemoryPhase.BeforeDiskRestore => "before-disk-restore",
                PreparationMemoryPhase.AfterDiskRestore => "after-disk-restore",
                PreparationMemoryPhase.BeforeQuery => "before-query",
                _ => throw new ArgumentOutOfRangeException(nameof(phase))
            };
            if (!attempted)
            {
                attempted = true;
                string root = Environment.GetEnvironmentVariable("PF_ROOT") ?? "";
                if (!Path.IsPathFullyQualified(root)) throw new IOException("Diagnostic root is unavailable.");
                root = Path.GetFullPath(root);
                for (DirectoryInfo? directory = new(root); directory is not null; directory = directory.Parent)
                    if (!directory.Exists || (directory.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != FileAttributes.Directory)
                        throw new IOException("Diagnostic root is not regular.");
                var filename = Path.Combine(root, "memory-phases.jsonl");
                // Exclusive creation: ANY existing file/link/partial trace stays
                // untouched. Later workers do not append to a prior worker's file.
                output = new FileStream(filename, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 4096, FileOptions.None);
                if (OperatingSystem.IsLinux()) File.SetUnixFileMode(filename, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                started = Stopwatch.GetTimestamp();
            }
            if (output is null || output.Length != bytes) { Disable(); return; }
            using var process = Process.GetCurrentProcess(); process.Refresh();
            // Read-only estimates/last-GC observations. No collection is forced;
            // process RSS is this worker alone, not the combined supervisor guard.
            var memory = GC.GetGCMemoryInfo();
            var row = JsonSerializer.SerializeToUtf8Bytes(new
            {
                schemaVersion = "wfc.pf.preparation-memory-phase.v1", phase = label, processId = Environment.ProcessId,
                elapsedMilliseconds = Stopwatch.GetElapsedTime(started).TotalMilliseconds,
                processRssBytes = process.WorkingSet64, managedHeapEstimateBytes = GC.GetTotalMemory(false),
                gcTotalAvailableMemoryBytes = memory.TotalAvailableMemoryBytes,
                lastGcHeapSizeBytes = memory.HeapSizeBytes, lastGcCommittedBytes = memory.TotalCommittedBytes,
                totalAllocatedBytes = GC.GetTotalAllocatedBytes(false), gc0 = GC.CollectionCount(0), gc1 = GC.CollectionCount(1), gc2 = GC.CollectionCount(2)
            });
            if (row.Length + 1 > MaximumBytes - bytes) { Disable(); return; }
            output.Write(row); output.WriteByte((byte)'\n'); output.Flush();
            bytes += row.Length + 1; rows++;
            if (rows >= MaximumRows) Disable();
        }
        catch { Disable(); } // Never replace a production result/refusal.
        finally { Monitor.Exit(Gate); }
    }
    private static void Disable()
    {
        disabled = true;
        try { output?.Dispose(); } catch { }
        output = null;
    }
}
