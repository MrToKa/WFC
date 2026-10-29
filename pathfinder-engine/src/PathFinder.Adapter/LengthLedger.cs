using System.Globalization;
using System.Text.Json;
using AddinRibbon.Routing;

namespace PathFinder.Adapter;

public sealed record LengthLedgerRaw(double LengthMeters, double FromDistanceMeters, double ToDistanceMeters);
public sealed record LengthLedgerEndpoint(bool RequiresSecondary, string RemovedApproachMeters);
public sealed record LengthLedgerSettings(string? SecondaryTrayLengthMeters, string EndConnectionLengthMeters, string AdditionalBendingPercent);

/// <summary>Immutable observations of the authoritative Core calculation. Decimal
/// components are invariant strings, independently of a transport's converters.</summary>
public sealed record LengthLedger(
    string SettingsRevision,
    LengthLedgerRaw Raw,
    string RawLengthDecimalMeters,
    LengthLedgerEndpoint From,
    LengthLedgerEndpoint To,
    LengthLedgerSettings Settings,
    int SecondaryEnds,
    string ReplacementMeters,
    string BeforeClampMeters,
    string ClampAdjustmentMeters,
    string AfterClampMeters,
    string BeforePercentageMeters,
    string BendingIncrementMeters,
    string UnroundedMeters,
    string CeilingIncrementMeters,
    string DesignLengthMeters)
{
    public string SchemaVersion { get; } = "wfc.pf.length-components.v1";
    public string FormulaVersion { get; } = "pathfinder-45c24bf5";
    public string GapAccounting { get; } = "already-in-raw-geometry";
}

public sealed record LengthLedgerResult(CableDesignLength Design, LengthLedger Ledger);

/// <summary>Calls the unchanged calculator exactly once. This observer does not
/// calculate a second percentage or ceiling, reinterpret gaps or authorize data.</summary>
public static class LengthLedgerObserver
{
    public const int MaximumUtf8Bytes = 8 * 1024;

    public static LengthLedgerResult Calculate(RouteResult route, ProjectSettingsSnapshot settings,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(route);
        var captured = Capture(settings, route.FromRequiresSecondary, route.ToRequiresSecondary);
        cancellationToken.ThrowIfCancellationRequested();
        var design = CableDesignLength.Calculate(route, captured.EndConnectionLength,
            captured.SecondaryTrayLength ?? 0m, captured.AdditionalBendingPercent);
        cancellationToken.ThrowIfCancellationRequested();
        return Observe(route.LengthMeters, route.FromDistanceMeters, route.ToDistanceMeters,
            route.FromRequiresSecondary, route.ToRequiresSecondary, captured, design, cancellationToken);
    }

    public static LengthLedgerResult CalculateRetained(double lengthMeters, double fromDistanceMeters,
        double toDistanceMeters, bool fromRequiresSecondary, bool toRequiresSecondary,
        ProjectSettingsSnapshot settings, CancellationToken cancellationToken = default)
    {
        var captured = Capture(settings, fromRequiresSecondary, toRequiresSecondary);
        cancellationToken.ThrowIfCancellationRequested();
        var design = SavedRouteDesign.Calculate(lengthMeters, fromDistanceMeters, toDistanceMeters,
            fromRequiresSecondary, toRequiresSecondary, captured.EndConnectionLength,
            captured.SecondaryTrayLength ?? 0m, captured.AdditionalBendingPercent);
        cancellationToken.ThrowIfCancellationRequested();
        return Observe(lengthMeters, fromDistanceMeters, toDistanceMeters, fromRequiresSecondary,
            toRequiresSecondary, captured, design, cancellationToken);
    }

    private static ProjectSettingsSnapshot Capture(ProjectSettingsSnapshot settings, bool fromSecondary, bool toSecondary)
    {
        ArgumentNullException.ThrowIfNull(settings);
        if (settings.Revision is null || settings.Revision.Length is < 1 or > 19 ||
            !long.TryParse(settings.Revision, NumberStyles.None, CultureInfo.InvariantCulture, out var revision) || revision < 0 ||
            revision.ToString(CultureInfo.InvariantCulture) != settings.Revision)
            throw new ArgumentException("A canonical Project Details settings revision is required.", nameof(settings));
        if ((fromSecondary || toSecondary) && settings.SecondaryTrayLength is null)
            throw new ArgumentException("Project Details SECONDARY length is required.", nameof(settings));
        return settings with { };
    }

    private static LengthLedgerResult Observe(double lengthMeters, double fromDistanceMeters, double toDistanceMeters,
        bool fromSecondary, bool toSecondary, ProjectSettingsSnapshot settings, CableDesignLength design,
        CancellationToken cancellationToken)
    {
        if (!double.IsFinite(lengthMeters) || lengthMeters < 0 || !double.IsFinite(fromDistanceMeters) || fromDistanceMeters < 0 ||
            !double.IsFinite(toDistanceMeters) || toDistanceMeters < 0)
            throw new ArgumentException("The observed raw metre values must be finite and non-negative.");
        // Core has already validated every consumed cast. Unused approaches stay
        // binary64 measurements: casting them would introduce new overflow errors.
        var rawLength = (decimal)lengthMeters;
        var removedFrom = fromSecondary ? (decimal)fromDistanceMeters : 0m;
        var removedTo = toSecondary ? (decimal)toDistanceMeters : 0m;
        var beforeClamp = rawLength;
        if (fromSecondary) beforeClamp -= removedFrom;
        if (toSecondary) beforeClamp -= removedTo;
        var afterClamp = Math.Max(0m, beforeClamp);
        var secondaryEnds = (fromSecondary ? 1 : 0) + (toSecondary ? 1 : 0);
        var replacement = secondaryEnds * (settings.SecondaryTrayLength ?? 0m);
        if (beforeClamp < -0.000001m || afterClamp + replacement + settings.EndConnectionLength != design.LengthBeforePercentageMeters)
            throw new InvalidOperationException("The length-component observations differ from the authoritative Core result.");
        var ledger = new LengthLedger(settings.Revision,
            new LengthLedgerRaw(lengthMeters, fromDistanceMeters, toDistanceMeters), Decimal(rawLength),
            new LengthLedgerEndpoint(fromSecondary, Decimal(removedFrom)), new LengthLedgerEndpoint(toSecondary, Decimal(removedTo)),
            new LengthLedgerSettings(settings.SecondaryTrayLength is { } secondary ? Decimal(secondary) : null,
                Decimal(settings.EndConnectionLength), Decimal(settings.AdditionalBendingPercent)),
            secondaryEnds, Decimal(replacement), Decimal(beforeClamp), Decimal(afterClamp - beforeClamp), Decimal(afterClamp),
            Decimal(design.LengthBeforePercentageMeters), Decimal(design.UnroundedLengthMeters - design.LengthBeforePercentageMeters),
            Decimal(design.UnroundedLengthMeters), Decimal(design.DesignLengthMeters - design.UnroundedLengthMeters), Decimal(design.DesignLengthMeters));
        if (JsonSerializer.SerializeToUtf8Bytes(ledger, PathfinderAdapter.JsonOptions).Length > MaximumUtf8Bytes)
            throw new InvalidOperationException("The length-component ledger exceeds its byte budget.");
        cancellationToken.ThrowIfCancellationRequested();
        return new LengthLedgerResult(design, ledger);
    }

    private static string Decimal(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
}
