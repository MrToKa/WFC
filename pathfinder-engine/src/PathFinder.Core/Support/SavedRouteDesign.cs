using System;

namespace AddinRibbon.Routing
{
    /// <summary>
    /// Re-evaluates project allowances for a server-retained route without
    /// rebuilding geometry. This is not a provenance or authorization check.
    /// The original eleven routing source files remain unchanged.
    /// </summary>
    public static class SavedRouteDesign
    {
        public static CableDesignLength Calculate(double lengthMeters,
            double fromDistanceMeters, double toDistanceMeters,
            bool fromRequiresSecondary, bool toRequiresSecondary,
            decimal endConnectionLength, decimal secondaryTrayLength,
            decimal additionalBendingPercent)
        {
            if (!RoutePoint.IsFinite(lengthMeters) || lengthMeters < 0 ||
                !RoutePoint.IsFinite(fromDistanceMeters) || fromDistanceMeters < 0 ||
                !RoutePoint.IsFinite(toDistanceMeters) || toDistanceMeters < 0)
                throw new ArgumentException("Saved route metrics must be finite and non-negative.");
            var route = new RouteResult(true, "Server-retained route metrics.",
                new string[0], new string[0], new RoutePoint[0], lengthMeters,
                fromDistanceMeters, toDistanceMeters, fromRequiresSecondary,
                toRequiresSecondary);
            return CableDesignLength.Calculate(route, endConnectionLength,
                secondaryTrayLength, additionalBendingPercent);
        }
    }
}
