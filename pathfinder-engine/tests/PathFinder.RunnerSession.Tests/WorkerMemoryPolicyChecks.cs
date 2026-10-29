using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using PathFinder.Model;

namespace PathFinder.RunnerSession.Tests;

internal static partial class TestProgram
{
    private static async Task WorkerMemoryPolicyChecks()
    {
        static bool IsHeapPolicy(string key) => key.StartsWith("DOTNET_GCHeapHardLimit", StringComparison.OrdinalIgnoreCase)
            || key.StartsWith("COMPlus_GCHeapHardLimit", StringComparison.OrdinalIgnoreCase);
        static ProcessStartInfo Clean()
        {
            var value = new ProcessStartInfo("dotnet");
            foreach (var key in value.Environment.Keys.Where(IsHeapPolicy).ToArray()) value.Environment.Remove(key);
            return value;
        }
        var original = Environment.GetEnvironmentVariable("DOTNET_GCHeapHardLimit");
        var plain = Clean(); plain.Environment["WFC_TEST_UNRELATED"] = "synthetic-nonsecret-value";
        Check("worker-managed-budget-default320MiB", WorkerMemoryPolicy.Configure(plain) == 320L * 1024 * 1024
            && plain.Environment["DOTNET_GCHeapHardLimit"] == "14000000");
        Check("worker-budget-does-not-change-parent-or-unrelated-env", Environment.GetEnvironmentVariable("DOTNET_GCHeapHardLimit") == original
            && plain.Environment["WFC_TEST_UNRELATED"] == "synthetic-nonsecret-value");
        var large = Clean(); large.Environment["COMPlus_GCHeapHardLimit"] = "7fffffff";
        Check("worker-inherited-large-limit-cannot-raise-budget", WorkerMemoryPolicy.Configure(large) == WorkerMemoryPolicy.MaximumManagedBytes
            && large.Environment.Keys.Count(IsHeapPolicy) == 1);
        var lower = Clean(); lower.Environment["COMPlus_GCHeapHardLimit"] = "10000000";
        lower.Environment["DOTNET_GCHeapHardLimit"] = "18000000";
        Check("worker-stricter-inherited-aggregate-never-raised", WorkerMemoryPolicy.Configure(lower) == 256L * 1024 * 1024
            && lower.Environment["DOTNET_GCHeapHardLimit"] == "10000000" && lower.Environment.Keys.Count(IsHeapPolicy) == 1);
        var mixed = Clean(); mixed.Environment["dotnet_gcheapHardlimit"] = "0x12000000";
        mixed.Environment["COMPLUS_GCHEAPHARDLIMIT"] = "10000000";
        Check("worker-case-aliases-all-constrain-the-minimum", WorkerMemoryPolicy.Configure(mixed) == 256L * 1024 * 1024
            && mixed.Environment.Keys.Count(IsHeapPolicy) == 1 && mixed.Environment.ContainsKey("DOTNET_GCHeapHardLimit"));
        foreach (var alias in new[] { "DOTNET_GCHeapHardLimitPercent", "COMPlus_GCHeapHardLimitPercent", "DOTNET_GCHeapHardLimitSOH",
            "DOTNET_GCHeapHardLimitLOH", "DOTNET_GCHeapHardLimitPOH", "COMPlus_GCHeapHardLimitSOHPercent", "COMPlus_GCHeapHardLimitLOHPercent",
            "COMPlus_GCHeapHardLimitPOHPercent", "dotnet_gcheaphardlimitFutureOverride" })
        {
            var conflict = Clean(); conflict.Environment[alias] = "1";
            Throws<InvalidOperationException>("worker-uncomparable-inherited-policy-fails-closed-" + alias, () => WorkerMemoryPolicy.Configure(conflict));
            Check("worker-policy-conflict-does-not-mutate-child-env-" + alias, conflict.Environment[alias] == "1" && conflict.Environment.Keys.Count(IsHeapPolicy) == 1);
        }
        foreach (var invalid in new[] { "", "0", "-1", "not-hex", "10000000000000000", "ffffffffffffffff" })
        {
            var bad = Clean(); bad.Environment["DOTNET_GCHeapHardLimit"] = invalid;
            Throws<InvalidOperationException>("worker-invalid-aggregate-cap-fails-closed-" + (invalid.Length == 0 ? "empty" : invalid), () => WorkerMemoryPolicy.Configure(bad));
        }
        Throws<ArgumentException>("worker-factory-rejects-other-launch-modes", () => global::Program.WorkerStartInfo("--other"));
        foreach (var mode in new[] { "--worker", "--session-worker" })
        {
            var start = global::Program.WorkerStartInfo(mode);
            long expected = long.Parse(start.Environment["DOTNET_GCHeapHardLimit"]!, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture);
            Check("worker-real-launch-factory-applies-policy-" + mode, start.ArgumentList.Last() == mode && !start.UseShellExecute && start.CreateNoWindow
                && start.RedirectStandardInput && start.RedirectStandardOutput && start.RedirectStandardError && expected is > 0 and <= WorkerMemoryPolicy.MaximumManagedBytes);
            await Probe(start, expected, mode);
        }
        var stricterProbe = Clean(); stricterProbe.Environment["COMPlus_GCHeapHardLimit"] = "10000000";
        await Probe(stricterProbe, WorkerMemoryPolicy.Configure(stricterProbe), "inherited-lower");

        var request = new Request { SchemaVersion = "pathfinder.model.runner.v1", RequestId = Guid.NewGuid().ToString("D"), Operation = "calculate",
            ProjectId = Corpus.Project, ModelVersionId = Corpus.Model, TimeoutMilliseconds = 30000 };
        var originalResult = new { marker = "unchanged" };
        Check("worker-memory-boundary-preserves-success-reference", ReferenceEquals(originalResult, global::Program.WorkerCalculation(request, () => originalResult)));
        Throws<ArgumentException>("worker-memory-boundary-does-not-hide-validation-errors", () => global::Program.WorkerCalculation(request, () => throw new ArgumentException("Synthetic invalid input.")));
        using (var cancellation = new CancellationTokenSource())
        {
            cancellation.Cancel();
            Throws<OperationCanceledException>("worker-memory-boundary-does-not-hide-cancellation", () => global::Program.WorkerCalculation(request,
                () => throw new OperationCanceledException(cancellation.Token)));
        }
        foreach (var session in new global::SessionExecutionContext?[] { null, new() })
        {
            var refused = JsonSerializer.SerializeToElement(global::Program.WorkerCalculation(request,
                () => throw new OutOfMemoryException("Synthetic injected message that must not be published."), session));
            Check("worker-managed-oom-is-typed-refusal-" + (session is null ? "oneshot" : "session"), refused.GetProperty("status").GetString() == "resource_limit"
                && refused.GetProperty("message").GetString() == WorkerMemoryPolicy.RefusalMessage && !refused.GetProperty("engineeringAccepted").GetBoolean()
                && !refused.TryGetProperty("route", out _) && !refused.TryGetProperty("design", out _)
                && (session is null || session.Reuse == "none"));
        }
        Check("worker-managed-policy-keeps-original-resident-and-count-ceilings", SessionProtocol.MaximumResidentBytes == 512L * 1024 * 1024
            && SessionProtocol.MaximumRequests == 64 && SessionProtocol.StartupMilliseconds == 5000);

        static async Task Probe(ProcessStartInfo start, long expected, string label)
        {
            // Keep the exact configured child environment, but run a tiny owned
            // test entry instead of allocating the plant model. This proves CLR
            // startup's effective cap, not actual routing/RSS capacity.
            start.FileName = "dotnet"; start.UseShellExecute = false; start.CreateNoWindow = true;
            start.RedirectStandardInput = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
            start.ArgumentList.Clear(); start.ArgumentList.Add(typeof(TestProgram).Assembly.Location); start.ArgumentList.Add("--worker-memory-probe");
            using var child = Process.Start(start) ?? throw new IOException("Synthetic memory probe could not start.");
            child.StandardInput.Close(); using var deadline = new CancellationTokenSource(10000);
            var stdout = child.StandardOutput.ReadToEndAsync(deadline.Token); var stderr = child.StandardError.ReadToEndAsync(deadline.Token);
            try
            {
                await child.WaitForExitAsync(deadline.Token); var output = await stdout;
                using var parsed = JsonDocument.Parse(output); var value = parsed.RootElement;
                Check("worker-clr-effective-managed-budget-" + label, child.ExitCode == 0 && output.Length <= 1024 && (await stderr).Length == 0
                    && value.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal).SequenceEqual(new[] { "gcTotalAvailableMemoryBytes", "schemaVersion" })
                    && value.GetProperty("schemaVersion").GetString() == "wfc.pf.worker-memory-probe.v1"
                    && value.GetProperty("gcTotalAvailableMemoryBytes").GetInt64() == expected);
            }
            finally { if (!child.HasExited) { child.Kill(true); await child.WaitForExitAsync(); } }
        }
    }
}
