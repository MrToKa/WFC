using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Threading;

namespace AddinRibbon.Routing
{
    public enum LocalConnectorStatus { Clear, Blocked, Indeterminate, SearchIncomplete }

    /// <summary>Finite canonical-world search guidance, never evidence of free space.</summary>
    public sealed class LocalConnectorDomain
    {
        public RoutePoint Minimum { get; private set; }
        public RoutePoint Maximum { get; private set; }
        public double StepMeters { get; private set; }
        public LocalConnectorDomain(RoutePoint minimum, RoutePoint maximum, double stepMeters)
        {
            if (minimum.X > maximum.X || minimum.Y > maximum.Y || minimum.Z > maximum.Z
                || !RoutePoint.IsFinite(stepMeters) || stepMeters <= 0)
                throw new ArgumentException("Local connector domain must be ordered with a finite positive step.");
            Minimum = minimum; Maximum = maximum; StepMeters = stepMeters;
        }
        internal LocalConnectorDomain Snapshot() { return new LocalConnectorDomain(Minimum, Maximum, StepMeters); }
        internal bool Contains(RoutePoint point)
        { return point.X >= Minimum.X && point.X <= Maximum.X && point.Y >= Minimum.Y && point.Y <= Maximum.Y && point.Z >= Minimum.Z && point.Z <= Maximum.Z; }
    }

    /// <summary>A bounded search profile, not project allowances, physical cable
    /// clearance or measured actual-model capacity. Smaller steps can exceed the
    /// node ceiling and will refuse instead of silently coarsening the search.</summary>
    public sealed class LocalConnectorOptions
    {
        public double StepMeters { get; set; } = 0.25;
        public double PaddingMeters { get; set; } = 1;
        public double MaxAxisSpanMeters { get; set; } = 20;
        public int MaxNodes { get; set; } = 4096;
        /// <summary>Total local oracle checks across the entire strategy, including final rechecks.</summary>
        public int MaxEdgeChecks { get; set; } = 16384;
        public int MaxPlans { get; set; } = 8;
        public int MaxStraightPairs { get; set; } = 8;
        internal LocalConnectorOptions Snapshot()
        {
            if (!RoutePoint.IsFinite(StepMeters) || StepMeters <= 0 || StepMeters > .25
                || !RoutePoint.IsFinite(PaddingMeters) || PaddingMeters < 0 || PaddingMeters > 1
                || !RoutePoint.IsFinite(MaxAxisSpanMeters) || MaxAxisSpanMeters <= 0 || MaxAxisSpanMeters > 20
                || MaxNodes < 2 || MaxNodes > 4096 || MaxEdgeChecks < 1 || MaxEdgeChecks > 16384
                || MaxPlans < 1 || MaxPlans > 8 || MaxStraightPairs < 1 || MaxStraightPairs > 8)
                throw new ArgumentException("Local connector options may only tighten the bounded search profile.");
            return new LocalConnectorOptions { StepMeters = StepMeters, PaddingMeters = PaddingMeters, MaxAxisSpanMeters = MaxAxisSpanMeters,
                MaxNodes = MaxNodes, MaxEdgeChecks = MaxEdgeChecks, MaxPlans = MaxPlans, MaxStraightPairs = MaxStraightPairs };
        }
        internal LocalConnectorDomain Domain(RoutePoint from, RoutePoint to)
        {
            return new LocalConnectorDomain(new RoutePoint(Math.Min(from.X, to.X) - PaddingMeters,
                Math.Min(from.Y, to.Y) - PaddingMeters, Math.Min(from.Z, to.Z) - PaddingMeters),
                new RoutePoint(Math.Max(from.X, to.X) + PaddingMeters, Math.Max(from.Y, to.Y) + PaddingMeters,
                Math.Max(from.Z, to.Z) + PaddingMeters), StepMeters);
        }
    }

    public sealed class RouteConnectorPlan
    {
        public const string PolicyVersion = "wfc.pf.local-connector-lattice.v1";
        public LocalConnectorStatus Status { get; private set; }
        public string Reason { get; private set; }
        /// <summary>Exact checked endpoint-to-tray order; failure has no proposed path.</summary>
        public IReadOnlyList<RoutePoint> Points { get; private set; }
        public double LengthMeters { get; private set; }
        public double DirectDistanceMeters { get; private set; }
        public bool IsDetour { get; private set; }
        /// <summary>Only a completed exact connector decision; a finite grid
        /// cannot establish that an arbitrary physical opening/path does not exist.</summary>
        public bool SearchComplete { get; private set; }
        public LocalConnectorDomain Domain { get; private set; }
        public int EdgeChecks { get; private set; }
        public int Queries { get; private set; }
        public long Work { get; private set; }
        internal RouteConnectorPlan(LocalConnectorStatus status, string reason, IEnumerable<RoutePoint> points,
            double length, double direct, LocalConnectorDomain domain, int checks, int queries, long work)
        {
            var copy = new List<RoutePoint>(points ?? new RoutePoint[0]).ToArray();
            Status = status; Reason = reason; Points = new ReadOnlyCollection<RoutePoint>(copy); LengthMeters = length;
            DirectDistanceMeters = direct; Domain = domain.Snapshot(); EdgeChecks = checks; Queries = queries; Work = work;
            IsDetour = status == LocalConnectorStatus.Clear && (copy.Length > 2 || length > direct);
            SearchComplete = status == LocalConnectorStatus.Clear || status == LocalConnectorStatus.Blocked;
        }
    }

    public sealed class LocalApproachRouteEvaluation
    {
        public const string PolicyVersion = "wfc.pf.local-approach-routing.v1";
        public ConstrainedRouteEvaluation RouteEvaluation { get; private set; }
        /// <summary>Populated for successful locally planned assembly; null for unchanged B3 straight/bypass results.</summary>
        public RouteConnectorPlan FromConnector { get; private set; }
        public RouteConnectorPlan ToConnector { get; private set; }
        public int PlannerAttempts { get; private set; }
        public int StraightPairAttempts { get; private set; }
        public int LocalEdgeChecks { get; private set; }
        public bool LocalPhaseUsed { get; private set; }
        public bool StraightPhaseTruncated { get; private set; }
        internal LocalApproachRouteEvaluation(ConstrainedRouteEvaluation route, RouteConnectorPlan from, RouteConnectorPlan to,
            LocalConnectorContext context, int straightPairs, bool localPhase, bool straightTruncated)
        { RouteEvaluation = route; FromConnector = from; ToConnector = to; PlannerAttempts = context.Plans;
            StraightPairAttempts = straightPairs; LocalEdgeChecks = context.EdgeChecks; LocalPhaseUsed = localPhase; StraightPhaseTruncated = straightTruncated; }
    }

    public sealed class LocalSecondaryEvaluation
    {
        public ConstrainedSecondaryEvaluation SecondaryEvaluation { get; private set; }
        public LocalApproachRouteEvaluation LocalApproaches { get; private set; }
        internal LocalSecondaryEvaluation(ConstrainedSecondaryEvaluation secondary, LocalApproachRouteEvaluation local)
        { SecondaryEvaluation = secondary; LocalApproaches = local; }
    }

    internal sealed class LocalConnectorLimitException : Exception
    { internal readonly string Reason; internal LocalConnectorLimitException(string reason) : base(reason) { Reason = reason; } }
    internal sealed class LocalConnectorContext
    {
        internal readonly LocalConnectorOptions Options;
        internal readonly ConstrainedBudget Budget;
        internal int Plans, EdgeChecks;
        internal int StraightPairs;
        internal bool LocalPhaseUsed, StraightPhaseTruncated;
        internal bool Limited;
        internal LocalConnectorContext(LocalConnectorOptions options, ConstrainedBudget budget) { Options = options; Budget = budget; }
        internal RouteCollisionObservation Query(RouteCollisionQuery collision, RoutePoint from, RoutePoint to)
        {
            Budget.Check(); if (EdgeChecks >= Options.MaxEdgeChecks) { Limited = true; throw new LocalConnectorLimitException("LOCAL_EDGE_CHECK_LIMIT"); }
            EdgeChecks++; return Budget.Query(collision, from, to);
        }
    }
}
