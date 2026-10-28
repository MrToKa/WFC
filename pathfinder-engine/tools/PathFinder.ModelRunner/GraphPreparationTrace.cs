using System.Text.Json;
using AddinRibbon.Routing;

// Opt-in fixed-name, fixed-size diagnostic sink. It is intentionally separate
// from the strict response and session contracts, and contains no model data.
internal static class GraphPreparationTrace
{
    private const int MaximumRows = 256, MaximumBytes = 1024 * 1024;
    private static readonly object Gate = new();
    private static int rows;
    internal static void Observe(string requestId, double preparationMilliseconds, double restoreMilliseconds,
        double calculationMilliseconds, double publicationMilliseconds, string restore, string publication,
        GraphPreparationDiagnostics diagnostics)
    {
        if (Environment.GetEnvironmentVariable("PF_ENGINE_GRAPH_DIAGNOSTICS") != "1" || !Monitor.TryEnter(Gate)) return;
        try
        {
            if (rows >= MaximumRows) return;
            string root = Environment.GetEnvironmentVariable("PF_ROOT") ?? "";
            if (!Path.IsPathFullyQualified(root)) return;
            for (DirectoryInfo? directory = new(Path.GetFullPath(root)); directory is not null; directory = directory.Parent)
                if (!directory.Exists || (directory.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != FileAttributes.Directory) return;
            string path = Path.Combine(root, "graph-phases.jsonl");
            if (File.Exists(path) && (File.GetAttributes(path) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) return;
            var row = JsonSerializer.SerializeToUtf8Bytes(new
            {
                schemaVersion = "wfc.pf.graph-phases.v1", requestId, processId = Environment.ProcessId,
                preparationMilliseconds, restoreMilliseconds, calculationMilliseconds, publicationMilliseconds,
                restore, publication, diagnostics
            });
            using var output = new FileStream(path, FileMode.OpenOrCreate, FileAccess.Write, FileShare.Read);
            if (output.Length + row.Length + 1 > MaximumBytes) return;
            output.Position = output.Length; output.Write(row); output.WriteByte((byte)'\n'); output.Flush(); rows++;
        }
        catch { /* Optional measurements never alter a route or a refusal. */ }
        finally { Monitor.Exit(Gate); }
    }
}
