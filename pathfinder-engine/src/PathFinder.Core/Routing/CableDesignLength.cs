using System;

namespace AddinRibbon.Routing
{
    /// <summary>Design allowances are separate from the calculated 3D cable geometry.</summary>
    public sealed class CableDesignLength
    {
        public decimal LengthBeforePercentageMeters { get; private set; }
        public decimal UnroundedLengthMeters { get; private set; }
        public decimal DesignLengthMeters { get; private set; }

        public static CableDesignLength Calculate(RouteResult route, decimal connectionSpareMeters,
            decimal secondaryLengthMeters, decimal increasePercent)
        {
            if (route == null || !route.Success) throw new ArgumentException("Calculate a connected path before its design length.", "route");
            if (connectionSpareMeters < 0) throw new ArgumentOutOfRangeException("connectionSpareMeters");
            if (secondaryLengthMeters < 0) throw new ArgumentOutOfRangeException("secondaryLengthMeters");
            if (increasePercent < 0) throw new ArgumentOutOfRangeException("increasePercent");
            decimal length = Meters(route.LengthMeters);
            int secondaryEnds = 0;
            if (route.FromRequiresSecondary) { length -= Meters(route.FromDistanceMeters); secondaryEnds++; }
            if (route.ToRequiresSecondary) { length -= Meters(route.ToDistanceMeters); secondaryEnds++; }
            if (length < -0.000001m) throw new ArgumentException("Endpoint approaches exceed the calculated cable length.", "route");
            length = Math.Max(0m, length) + secondaryEnds * secondaryLengthMeters + connectionSpareMeters;
            decimal increased = length * (1m + increasePercent / 100m);
            return new CableDesignLength { LengthBeforePercentageMeters = length, UnroundedLengthMeters = increased,
                DesignLengthMeters = decimal.Ceiling(increased) };
        }

        private static decimal Meters(double value)
        {
            if (!RoutePoint.IsFinite(value) || value < 0 || value > (double)decimal.MaxValue)
                throw new ArgumentException("Design length needs finite, non-negative metre values within the supported range.");
            return (decimal)value;
        }
    }
}
