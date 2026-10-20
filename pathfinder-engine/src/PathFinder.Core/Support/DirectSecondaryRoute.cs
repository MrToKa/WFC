using System;
using System.Collections.Generic;
using System.Threading;

namespace AddinRibbon.Routing
{
    /// <summary>A separate strategy observation; never changes the pinned tray graph algorithm.</summary>
    public sealed class DirectSecondaryEvaluation
    {
        public RoutePoint From { get; private set; }
        public RoutePoint To { get; private set; }
        public double DistanceMeters { get; private set; }
        public double? NearestFromMeters { get; private set; }
        public double? NearestToMeters { get; private set; }
        public int EligibleTrays { get; private set; }
        public bool IsDirect { get; private set; }
        public string Comparison { get; private set; }
        public RouteResult DirectRoute { get; private set; }
        internal DirectSecondaryEvaluation(RoutePoint from, RoutePoint to, double distance, double? first, double? last, int count)
        {
            From = from; To = to; DistanceMeters = distance; NearestFromMeters = first; NearestToMeters = last; EligibleTrays = count;
            bool fromWins = first.HasValue && distance < first.Value, toWins = last.HasValue && distance < last.Value;
            IsDirect = fromWins || toWins;
            Comparison = fromWins && toWins ? "both" : fromWins ? "from-approach" : toWins ? "to-approach" : null;
            DirectRoute = IsDirect ? DirectSecondaryRoute.Create(from, to) : null;
        }
    }

    /// <summary>Strict D&lt;F OR D&lt;T against the true nearest eligible fitted polylines.
    /// No distance maximum, AABB shortcut, vertical-preference substitution or collision claim.</summary>
    public static class DirectSecondaryRoute
    {
        public const string PolicyVersion = "nearest-eligible-tray-or.v1";
        public static DirectSecondaryEvaluation Evaluate(IEnumerable<TraySegment> trays, RoutePoint from, RoutePoint to,
            CableCategory category, RoutingOptions options = null, CancellationToken cancellationToken = default(CancellationToken))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (trays == null) throw new ArgumentNullException("trays");
            if (category != CableCategory.LV && category != CableCategory.Control) throw new ArgumentException("Direct SECONDARY requires LV or Control.", "category");
            options = options ?? new RoutingOptions(); options.Validate();
            double distance = from.DistanceTo(to);
            if (!RoutePoint.IsFinite(distance)) throw new ArgumentException("Direct endpoint distance is outside the supported coordinate range.");
            var eligible = new List<TraySegment>(); var identifiers = new HashSet<string>(StringComparer.Ordinal);
            foreach (var tray in trays)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (tray == null) throw new ArgumentException("Tray snapshots cannot contain null entries.", "trays");
                if ((tray.AllowedCategories & category) != category) continue;
                if (!identifiers.Add(tray.Id)) throw new ArgumentException("Duplicate tray identifier: " + tray.Id, "trays");
                eligible.Add(tray);
            }
            eligible.Sort((left, right) => StringComparer.Ordinal.Compare(left.Id, right.Id));
            if (eligible.Count == 0) return new DirectSecondaryEvaluation(from, to, distance, null, null, 0);
            double first = Nearest(eligible, from, cancellationToken), last = Nearest(eligible, to, cancellationToken);
            if (!RoutePoint.IsFinite(first) || !RoutePoint.IsFinite(last)) throw new ArgumentException("Nearest tray distances are outside the supported coordinate range.");
            cancellationToken.ThrowIfCancellationRequested();
            return new DirectSecondaryEvaluation(from, to, distance, first, last, eligible.Count);
        }

        // The original eleven Routing sources are byte-for-byte unchanged. This
        // projection mirrors their pre-vertical FindNearest arithmetic and order.
        private static double Nearest(List<TraySegment> trays, RoutePoint target, CancellationToken token)
        {
            double best = double.PositiveInfinity;
            foreach (var tray in trays)
            {
                token.ThrowIfCancellationRequested();
                var points = tray.Points;
                for (int part = 0; part < points.Count - 1; part++)
                {
                    if ((part & 255) == 0) token.ThrowIfCancellationRequested();
                    var a = points[part]; var b = points[part + 1];
                    double x = b.X - a.X, y = b.Y - a.Y, z = b.Z - a.Z;
                    double squaredLength = x * x + y * y + z * z;
                    double fraction = squaredLength == 0 ? 0 : Math.Max(0, Math.Min(1,
                        ((target.X - a.X) * x + (target.Y - a.Y) * y + (target.Z - a.Z) * z) / squaredLength));
                    var projected = RoutePoint.Interpolate(a, b, fraction);
                    double distance = projected.DistanceTo(target);
                    if (distance < best) best = distance;
                }
            }
            return best;
        }

        /// <summary>Only same-assembly construction; canonical RouteResult constructors stay internal.</summary>
        public static RouteResult Create(RoutePoint from, RoutePoint to)
        {
            double distance = from.DistanceTo(to);
            if (!RoutePoint.IsFinite(distance)) throw new ArgumentException("Direct endpoint distance must be finite.");
            return new RouteResult(true, "Direct SECONDARY selected by nearest eligible tray approaches; collision clearance is not verified.",
                new[] { "/SECONDARY" }, new string[0], distance == 0 ? new[] { from } : new[] { from, to }, distance, 0, 0, false, false, 0, 0);
        }
    }
}
