using System;
using AddinRibbon.Routing;

internal static class DesignLengthTests
{
    public static void Run(Action<string, Action> run)
    {
        run("Design length adds total connection spare before percentage and ceiling", NoSecondary);
        run("Design length replaces only a marked SECONDARY approach", OneSecondary);
        run("Two SECONDARY ends use two entered lengths, including zero", BothSecondary);
        run("Design ceiling preserves exact integers and decimal percentage boundaries", Ceiling);
        run("Design allowances survive Reverse without accumulating", Reverse);
        run("Design length rejects failures and invalid allowances", Invalid);
    }

    private static RouteResult Route(double length, double from = 0, double to = 0, bool fromSecondary = false, bool toSecondary = false)
    { return new RouteResult(true, "", new[] { "/C001" }, new[] { "tray" }, new RoutePoint[0], length, from, to, fromSecondary, toSecondary); }
    private static void Equal(decimal expected, decimal actual)
    { if (expected != actual) throw new InvalidOperationException("Expected " + expected + ", got " + actual); }
    private static void NoSecondary()
    {
        var design = CableDesignLength.Calculate(Route(100.01, 2, 3), 6m, 50m, 10m);
        Equal(106.01m, design.LengthBeforePercentageMeters);
        Equal(116.611m, design.UnroundedLengthMeters); Equal(117m, design.DesignLengthMeters);
    }
    private static void OneSecondary()
    {
        var design = CableDesignLength.Calculate(Route(94.249, 2.710, 1.075, true), 6m, 5m, 10m);
        Equal(102.539m, design.LengthBeforePercentageMeters);
        Equal(112.7929m, design.UnroundedLengthMeters); Equal(113m, design.DesignLengthMeters);
    }
    private static void BothSecondary()
    {
        var route = Route(20, 3, 4, true, true);
        Equal(29m, CableDesignLength.Calculate(route, 6m, 5m, 0m).DesignLengthMeters);
        Equal(19m, CableDesignLength.Calculate(route, 6m, 0m, 0m).DesignLengthMeters);
    }
    private static void Ceiling()
    {
        Equal(110m, CableDesignLength.Calculate(Route(100), 0m, 0m, 10m).DesignLengthMeters);
        Equal(10m, CableDesignLength.Calculate(Route(10), 0m, 0m, 0m).DesignLengthMeters);
        Equal(11m, CableDesignLength.Calculate(Route(10.00001), 0m, 0m, 0m).DesignLengthMeters);
        Equal(0m, CableDesignLength.Calculate(Route(0), 0m, 0m, 10m).DesignLengthMeters);
    }
    private static void Reverse()
    {
        var route = Route(94.249, 2.710, 1.075, true);
        Equal(CableDesignLength.Calculate(route, 6m, 5m, 10m).DesignLengthMeters,
            CableDesignLength.Calculate(route.Reverse(), 6m, 5m, 10m).DesignLengthMeters);
        Equal(94.249m, (decimal)route.LengthMeters);
        Equal(113m, CableDesignLength.Calculate(route, 6m, 5m, 10m).DesignLengthMeters);
    }
    private static void Invalid()
    {
        Reject(() => CableDesignLength.Calculate(RouteResult.Failure("No path"), 6m, 5m, 10m));
        Reject(() => CableDesignLength.Calculate(Route(10), -1m, 0m, 0m));
        Reject(() => CableDesignLength.Calculate(Route(10), 0m, -1m, 0m));
        Reject(() => CableDesignLength.Calculate(Route(10), 0m, 0m, -1m));
        Reject(() => CableDesignLength.Calculate(Route(double.NaN), 0m, 0m, 0m));
        Reject(() => CableDesignLength.Calculate(Route(1, 2, 0, true), 0m, 0m, 0m));
    }
    private static void Reject(Action action)
    { try { action(); } catch (ArgumentException) { return; } throw new InvalidOperationException("Invalid design inputs accepted."); }
}
