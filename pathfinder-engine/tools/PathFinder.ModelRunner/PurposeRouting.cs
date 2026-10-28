using System.Text.RegularExpressions;
using AddinRibbon.Routing;

/// <summary>Project cable Purpose permissions select the eligible network before
/// nearest-tray decisions. Capacity exclusions remain a separate later filter.</summary>
internal static class PurposeRouting
{
    internal const int MaximumRouteCodes = 100000;
    private static readonly Regex CanonicalCode = new(@"\A/[A-Z0-9][A-Z0-9_.-]*\z", RegexOptions.CultureInvariant);

    internal static void Validate(IReadOnlyList<string>? routeCodes)
    {
        if (routeCodes is null) return;
        if (routeCodes.Count > MaximumRouteCodes) throw new ArgumentException("Cable Purpose route permissions exceed their bounded count.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var code in routeCodes)
            if (code is null || code.Length > 256 || !CanonicalCode.IsMatch(code) || code == "/SECONDARY" || !seen.Add(code))
                throw new ArgumentException("Cable Purpose route permissions require unique canonical tray route codes.");
    }

    internal static IEnumerable<TraySegment> Filter(IEnumerable<TraySegment> trays, IReadOnlyList<string>? routeCodes, CancellationToken token)
    {
        Validate(routeCodes);
        if (routeCodes is null) return trays;
        var allowed = new HashSet<string>(routeCodes, StringComparer.Ordinal);
        var available = new List<TraySegment>();
        foreach (var tray in trays)
        {
            token.ThrowIfCancellationRequested();
            if (allowed.Contains(tray.RouteCode)) available.Add(tray);
        }
        return available;
    }
}
