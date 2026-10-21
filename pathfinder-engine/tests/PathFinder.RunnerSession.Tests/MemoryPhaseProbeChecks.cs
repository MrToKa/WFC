using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace PathFinder.RunnerSession.Tests;

internal static partial class TestProgram
{
    private static async Task MemoryPhaseProbeChecks(string work)
    {
        Directory.CreateDirectory(work);
        async Task Probe(string root, string? setting)
        {
            var start = new ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add(typeof(TestProgram).Assembly.Location); start.ArgumentList.Add("--memory-phase-probe"); start.ArgumentList.Add(root);
            start.Environment["PF_ROOT"] = root;
            if (setting is null) start.Environment.Remove("PF_ENGINE_MEMORY_PHASES"); else start.Environment["PF_ENGINE_MEMORY_PHASES"] = setting;
            using var child = Process.Start(start)!; using var deadline = new CancellationTokenSource(10000);
            var stdout = child.StandardOutput.ReadToEndAsync(deadline.Token); var stderr = child.StandardError.ReadToEndAsync(deadline.Token);
            try
            {
                await child.WaitForExitAsync(deadline.Token);
                Check("memory-phase-probe-no-result-interference-" + Path.GetFileName(root), child.ExitCode == 0 && (await stdout).Length == 0 && (await stderr).Length == 0);
            }
            finally { if (!child.HasExited) { child.Kill(true); await child.WaitForExitAsync(); } }
        }
        var disabled = Path.Combine(work, "off"); Directory.CreateDirectory(disabled); await Probe(disabled, null);
        Check("memory-phase-default-off-no-file", !File.Exists(Path.Combine(disabled, "memory-phases.jsonl")));
        var wrong = Path.Combine(work, "not-one"); Directory.CreateDirectory(wrong); await Probe(wrong, "true");
        Check("memory-phase-requires-exact-one", !File.Exists(Path.Combine(wrong, "memory-phases.jsonl")));
        var enabled = Path.Combine(work, "enabled"); Directory.CreateDirectory(enabled); await Probe(enabled, "1");
        var filename = Path.Combine(enabled, "memory-phases.jsonl"); var first = File.ReadAllBytes(filename);
        var lines = Encoding.UTF8.GetString(first).Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Check("memory-phase-global-row-and-byte-caps", lines.Length == 32 && first.Length <= 65536 && first[^1] == (byte)'\n');
        var expectedKeys = new[] { "schemaVersion", "phase", "processId", "elapsedMilliseconds", "processRssBytes", "managedHeapEstimateBytes",
            "gcTotalAvailableMemoryBytes", "lastGcHeapSizeBytes", "lastGcCommittedBytes", "totalAllocatedBytes", "gc0", "gc1", "gc2" }.Order(StringComparer.Ordinal).ToArray();
        Check("memory-phase-payload-has-no-model-request-or-path", lines.All(line => {
            using var row = JsonDocument.Parse(line); var value = row.RootElement;
            return value.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal).SequenceEqual(expectedKeys)
                && value.GetProperty("schemaVersion").GetString() == "wfc.pf.preparation-memory-phase.v1"
                && value.GetProperty("phase").GetString() == "before-query" && value.GetProperty("processId").GetInt32() > 0
                && value.GetProperty("processRssBytes").GetInt64() > 0 && value.GetProperty("managedHeapEstimateBytes").GetInt64() >= 0
                && value.GetProperty("gcTotalAvailableMemoryBytes").GetInt64() > 0;
        }));
        await Probe(enabled, "1"); Check("memory-phase-later-worker-does-not-append", first.SequenceEqual(File.ReadAllBytes(filename)));
        var foreign = Path.Combine(work, "preexisting"); Directory.CreateDirectory(foreign);
        var preserved = Encoding.UTF8.GetBytes("Synthetic incomplete or foreign diagnostic file."); File.WriteAllBytes(Path.Combine(foreign, "memory-phases.jsonl"), preserved);
        await Probe(foreign, "1"); Check("memory-phase-any-existing-file-is-preserved", preserved.SequenceEqual(File.ReadAllBytes(Path.Combine(foreign, "memory-phases.jsonl"))));
        if (OperatingSystem.IsLinux())
        {
            var linked = Path.Combine(work, "symlink"); Directory.CreateDirectory(linked); var target = Path.Combine(work, "untouched.txt");
            File.WriteAllBytes(target, preserved); File.CreateSymbolicLink(Path.Combine(linked, "memory-phases.jsonl"), target);
            await Probe(linked, "1"); Check("memory-phase-preexisting-link-never-followed", preserved.SequenceEqual(File.ReadAllBytes(target)));
        }
    }
}
