using System.Diagnostics;
using System.Globalization;

/// <summary>A worker's managed heap is smaller than the independently enforced
/// supervisor/worker RSS ceiling. Configure before CLR startup, never by forcing
/// a collection or changing the external resident-memory admission policy.</summary>
internal static class WorkerMemoryPolicy
{
    internal const long MaximumManagedBytes = 320L * 1024 * 1024;
    internal const string RefusalMessage = "Worker managed memory budget exceeded.";
    private const string DotnetPrefix = "DOTNET_GCHeapHardLimit", LegacyPrefix = "COMPlus_GCHeapHardLimit";

    internal static long Configure(ProcessStartInfo start)
    {
        long selected = MaximumManagedBytes;
        var inherited = start.Environment.Where(pair => pair.Key.StartsWith(DotnetPrefix, StringComparison.OrdinalIgnoreCase)
            || pair.Key.StartsWith(LegacyPrefix, StringComparison.OrdinalIgnoreCase)).ToArray();
        foreach (var pair in inherited)
        {
            // A null ProcessStartInfo value removes the environment variable.
            if (pair.Value is null) continue;
            if (!pair.Key.Equals(DotnetPrefix, StringComparison.OrdinalIgnoreCase)
                && !pair.Key.Equals(LegacyPrefix, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Inherited worker heap policy cannot be safely bounded.");
            var value = pair.Value.AsSpan().Trim();
            if (value.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) value = value[2..];
            if (value.Length is < 1 or > 16 || !ulong.TryParse(value, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var parsed)
                || parsed == 0 || parsed > long.MaxValue)
                throw new InvalidOperationException("Inherited worker heap policy is invalid.");
            selected = Math.Min(selected, (long)parsed);
        }
        // All equivalent aggregate spellings have constrained the minimum.
        // Emit one canonical CLR hexadecimal setting; never raise a lower cap.
        foreach (var pair in inherited) start.Environment.Remove(pair.Key);
        start.Environment[DotnetPrefix] = selected.ToString("x", CultureInfo.InvariantCulture);
        return selected;
    }
}
