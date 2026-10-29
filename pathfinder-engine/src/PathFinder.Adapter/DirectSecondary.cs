using System.Globalization;
using System.Text.Json;
using AddinRibbon.Routing;

namespace PathFinder.Adapter;

public sealed record DirectSecondaryDecision
{
    public required string SchemaVersion { get; init; }
    public required string PolicyVersion { get; init; }
    public required string CoordinateFrame { get; init; }
    public required string Mode { get; init; }
    public required double[] FromPoint { get; init; }
    public required double[] ToPoint { get; init; }
    public required double DistanceMeters { get; init; }
    public required double? NearestFromMeters { get; init; }
    public required double? NearestToMeters { get; init; }
    public required int EligibleTrays { get; init; }
    public required string? Comparison { get; init; }
    public static DirectSecondaryDecision Capture(DirectSecondaryEvaluation value) => new()
    {
        SchemaVersion = "wfc.pf.direct-secondary.v1", PolicyVersion = DirectSecondaryRoute.PolicyVersion, CoordinateFrame = "canonical-world-metres",
        Mode = value.IsDirect ? "direct-secondary" : "tray-network", FromPoint = [value.From.X, value.From.Y, value.From.Z], ToPoint = [value.To.X, value.To.Y, value.To.Z],
        DistanceMeters = value.DistanceMeters, NearestFromMeters = value.NearestFromMeters, NearestToMeters = value.NearestToMeters, EligibleTrays = value.EligibleTrays, Comparison = value.Comparison,
    };
    public DirectSecondaryDecision Reverse() => this with { FromPoint = [.. ToPoint], ToPoint = [.. FromPoint], NearestFromMeters = NearestToMeters, NearestToMeters = NearestFromMeters,
        Comparison = Comparison == "from-approach" ? "to-approach" : Comparison == "to-approach" ? "from-approach" : Comparison };
    public void Validate()
    {
        if (SchemaVersion != "wfc.pf.direct-secondary.v1" || PolicyVersion != DirectSecondaryRoute.PolicyVersion || CoordinateFrame != "canonical-world-metres" || Mode is not ("direct-secondary" or "tray-network")
            || EligibleTrays is < 0 or > 1_000_000) throw new ArgumentException("Direct SECONDARY decision schema or coordinate frame mismatch.");
        var from = Point(FromPoint); var to = Point(ToPoint); var distance = from.DistanceTo(to);
        if (!double.IsFinite(DistanceMeters) || DistanceMeters < 0 || DistanceMeters != distance) throw new ArgumentException("Direct SECONDARY distance does not match its exact 3D endpoints.");
        if (EligibleTrays == 0)
        {
            if (NearestFromMeters is not null || NearestToMeters is not null || Comparison is not null || Mode != "tray-network") throw new ArgumentException("Missing eligible geometry cannot authorize a direct connection.");
            return;
        }
        if (NearestFromMeters is not { } first || NearestToMeters is not { } last || !double.IsFinite(first) || !double.IsFinite(last) || first < 0 || last < 0)
            throw new ArgumentException("Both true nearest eligible distances are required.");
        bool fromWins = distance < first, toWins = distance < last;
        var comparison = fromWins && toWins ? "both" : fromWins ? "from-approach" : toWins ? "to-approach" : null;
        if (Comparison != comparison || (Mode == "direct-secondary") != (fromWins || toWins)) throw new ArgumentException("Direct SECONDARY requires the exact strict nearest-distance OR rule.");
    }
    public RouteResult DirectRoute()
    {
        Validate(); if (Mode != "direct-secondary") throw new ArgumentException("A tray-network decision is not a direct route.");
        return DirectSecondaryRoute.Create(Point(FromPoint), Point(ToPoint));
    }
    private static RoutePoint Point(double[] values)
    {
        if (values is null || values.Length != 3 || values.Any(v => !double.IsFinite(v) || Math.Abs(v) > 1e9)) throw new ArgumentException("Finite canonical-world-metre endpoints are required.");
        return new RoutePoint(values[0], values[1], values[2]);
    }
}

/// <summary>Versioned direct strategy observations, preserving every common v1 component.</summary>
public sealed class DirectSecondaryLengthLedger
{
    private readonly LengthLedger value;
    public DirectSecondaryLengthLedger(LengthLedger value, DirectSecondaryDecision decision) { this.value = value; DirectSecondary = decision; }
    public string SchemaVersion => "wfc.pf.length-components.v2";
    public string FormulaVersion => "direct-secondary-3d.v1";
    public string SettingsRevision => value.SettingsRevision;
    public LengthLedgerRaw Raw => value.Raw;
    public string RawLengthDecimalMeters => value.RawLengthDecimalMeters;
    public LengthLedgerEndpoint From => value.From;
    public LengthLedgerEndpoint To => value.To;
    public LengthLedgerSettings Settings => value.Settings;
    public int SecondaryEnds => value.SecondaryEnds;
    public string ReplacementMeters => value.ReplacementMeters;
    public string BeforeClampMeters => value.BeforeClampMeters;
    public string ClampAdjustmentMeters => value.ClampAdjustmentMeters;
    public string AfterClampMeters => value.AfterClampMeters;
    public string BeforePercentageMeters => value.BeforePercentageMeters;
    public string BendingIncrementMeters => value.BendingIncrementMeters;
    public string UnroundedMeters => value.UnroundedMeters;
    public string CeilingIncrementMeters => value.CeilingIncrementMeters;
    public string DesignLengthMeters => value.DesignLengthMeters;
    public string GapAccounting => "already-in-raw-geometry";
    public DirectSecondaryDecision DirectSecondary { get; }
}
public sealed record DirectSecondaryLengthResult(CableDesignLength Design, DirectSecondaryLengthLedger Ledger);
public static class DirectSecondaryLengthObserver
{
    public static DirectSecondaryLengthResult Calculate(DirectSecondaryDecision decision, ProjectSettingsSnapshot settings, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(decision); cancellationToken.ThrowIfCancellationRequested();
        var route = decision.DirectRoute();
        // Both old Secondary flags are false: the untouched Core casts D, adds E
        // once, applies P and ceilings. S remains an unused Details audit value.
        var observed = LengthLedgerObserver.Calculate(route, settings, cancellationToken);
        var ledger = new DirectSecondaryLengthLedger(observed.Ledger, decision);
        if (JsonSerializer.SerializeToUtf8Bytes(ledger, PathfinderAdapter.JsonOptions).Length > LengthLedgerObserver.MaximumUtf8Bytes) throw new InvalidOperationException("Direct length ledger exceeds its byte budget.");
        cancellationToken.ThrowIfCancellationRequested(); return new(observed.Design, ledger);
    }
}
