using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;

namespace AddinRibbon.Routing
{
    public enum RouteCollisionStatus { Clear, Blocked, Indeterminate }
    public enum ConstrainedRouteStatus { Clear, Blocked, Indeterminate, SearchIncomplete, Bypassed }

    /// <summary>Detached centreline oracle result. Shell identity is not a triangle,
    /// source fragment or surface contact witness; containment need not have a hit point.</summary>
    public sealed class RouteCollisionObservation
    {
        public RouteCollisionStatus Status { get; private set; }
        public string ShellId { get; private set; }
        public string Reason { get; private set; }
        public long Work { get; private set; }
        public RouteCollisionObservation(RouteCollisionStatus status, string shellId, string reason, long work)
        {
            if (status != RouteCollisionStatus.Clear && status != RouteCollisionStatus.Blocked && status != RouteCollisionStatus.Indeterminate)
                throw new ArgumentOutOfRangeException("status");
            if (work < 0) throw new ArgumentOutOfRangeException("work");
            if (shellId != null && shellId.Length > 256) throw new ArgumentException("Shell identity exceeds its bound.", "shellId");
            if (reason != null && reason.Length > 2048) throw new ArgumentException("Collision reason exceeds its bound.", "reason");
            Status = status; ShellId = shellId; Reason = reason ?? string.Empty; Work = work;
        }
    }

    public delegate RouteCollisionObservation RouteCollisionQuery(RoutePoint from, RoutePoint to, CancellationToken cancellationToken);

    /// <summary>One actual ordered final-polyline query. Search diagnostics and
    /// aggregate counters are deliberately separate from this immutable evidence.</summary>
    public sealed class FinalRouteCollisionObservation
    {
        public RoutePoint From { get; private set; }
        public RoutePoint To { get; private set; }
        public RouteCollisionObservation Observation { get; private set; }
        internal FinalRouteCollisionObservation(RoutePoint from, RoutePoint to, RouteCollisionObservation observation)
        { From = from; To = to; Observation = observation; }
    }

    /// <summary>Refusal ceilings, not a full-capacity RSS qualification. Work counts
    /// input/candidate/edge/final guards and oracle-reported primitive work. Pinned
    /// private graph internals retain their own caps and the same absolute deadline;
    /// this ledger does not count every instruction executed by those internals.
    /// An indivisible oracle query reports its work after execution: an exhausted
    /// result can therefore exceed MaxWork by that last separately bounded query.</summary>
    public sealed class ConstrainedRoutingLimits
    {
        public int MaxCandidatesPerEnd { get; set; } = 16;
        public int MaxPairs { get; set; } = 64;
        public int MaxCollisionQueries { get; set; } = 100000;
        public long MaxWork { get; set; } = 20000000;
        public int TimeoutMilliseconds { get; set; } = 30000;
        public int MaxInputTrays { get; set; } = 4096;
        public int MaxInputPieces { get; set; } = 50000;
        public int MaxGraphNodes { get; set; } = 100000;
        public int MaxGraphConnections { get; set; } = 300000;

        internal ConstrainedRoutingLimits Snapshot()
        {
            if (MaxCandidatesPerEnd < 1 || MaxCandidatesPerEnd > 16 || MaxPairs < 1 || MaxPairs > 64
                || MaxCollisionQueries < 1 || MaxCollisionQueries > 100000 || MaxWork < 1 || MaxWork > 20000000
                || TimeoutMilliseconds < 1 || TimeoutMilliseconds > 30000 || MaxInputTrays < 1 || MaxInputTrays > 4096
                || MaxInputPieces < 1 || MaxInputPieces > 50000 || MaxGraphNodes < 2 || MaxGraphNodes > 100000
                || MaxGraphConnections < 1 || MaxGraphConnections > 300000)
                throw new ArgumentException("Constrained routing limits must be positive and may only tighten the published ceilings.");
            return new ConstrainedRoutingLimits { MaxCandidatesPerEnd = MaxCandidatesPerEnd, MaxPairs = MaxPairs,
                MaxCollisionQueries = MaxCollisionQueries, MaxWork = MaxWork, TimeoutMilliseconds = TimeoutMilliseconds,
                MaxInputTrays = MaxInputTrays, MaxInputPieces = MaxInputPieces, MaxGraphNodes = MaxGraphNodes,
                MaxGraphConnections = MaxGraphConnections };
        }
    }

    public sealed class ConstrainedRouteEvaluation
    {
        public const string PolicyVersion = "wfc.pf.constrained-tray-routing.v1";
        public const string CandidateRankingVersion = "wfc.pf.accessible-piece-projections.v1";
        public RouteResult Route { get; private set; }
        public ConstrainedRouteStatus Status { get; private set; }
        public string Reason { get; private set; }
        /// <summary>A completed untruncated route decision, or a conclusively
        /// exhausted bounded straight-candidate domain when no route was found.
        /// Success does not mean remaining alternative pairs were all examined.
        /// A clear exact route remains valid if unneeded candidates were truncated;
        /// neither this field nor success claims global free-space optimality.</summary>
        public bool SearchComplete { get; private set; }
        public bool CandidatesTruncated { get; private set; }
        public int CollisionQueries { get; private set; }
        /// <summary>Charged own guards plus already-performed oracle-reported
        /// units, including an exhausting or late query. Overflow saturates and
        /// refuses; the ledger never silently discards returned primitive work.</summary>
        public long Work { get; private set; }
        public int PairAttempts { get; private set; }
        /// <summary>Failure-only diagnostic: the first rejected attempted search
        /// segment. It has no final-route segment index and is not a route proof.</summary>
        public RouteCollisionObservation Blocking { get; private set; }
        public IReadOnlyList<FinalRouteCollisionObservation> FinalChecks { get; private set; }
        internal ConstrainedRouteEvaluation(RouteResult route, ConstrainedRouteStatus status, string reason, bool complete, ConstrainedBudget budget)
        {
            Route = route; Status = status;
            Reason = status == ConstrainedRouteStatus.Clear && budget.RouteUsedInterTrayManeuver
                ? reason + "_INTER_TRAY_OPENING_MANEUVER_V1" : reason;
            if (status == ConstrainedRouteStatus.Clear && budget.RouteInterTrayImprovementLimited) Reason += "_INTER_TRAY_IMPROVEMENT_LIMIT";
            SearchComplete = complete && !budget.RouteInterTrayImprovementLimited;
            CandidatesTruncated = budget.CandidatesTruncated; CollisionQueries = budget.Queries;
            Work = budget.Work; PairAttempts = budget.Pairs;
            Blocking = status == ConstrainedRouteStatus.Clear || status == ConstrainedRouteStatus.Bypassed ? null : budget.FirstBlocking;
            FinalChecks = Array.AsReadOnly(status == ConstrainedRouteStatus.Clear ? budget.FinalChecks.ToArray()
                : new FinalRouteCollisionObservation[0]);
        }
    }

    public sealed class ConstrainedSecondaryEvaluation
    {
        public const string SchemaVersion = "wfc.pf.constrained-direct-secondary.v2";
        public const string PolicyVersion = "nearest-eligible-tray-or-registered-barriers.v2";
        public DirectSecondaryEvaluation DistanceDecision { get; private set; }
        public bool DistanceQualified { get { return DistanceDecision != null && DistanceDecision.IsDirect; } }
        public RouteCollisionObservation DirectCollision { get; private set; }
        /// <summary>not-qualified, clear, blocked, indeterminate, unavailable or bypassed.</summary>
        public string DirectDisposition { get; private set; }
        public ConstrainedRouteEvaluation RouteEvaluation { get; private set; }
        internal ConstrainedSecondaryEvaluation(DirectSecondaryEvaluation decision, RouteCollisionObservation collision,
            string disposition, ConstrainedRouteEvaluation route)
        { DistanceDecision = decision; DirectCollision = collision; DirectDisposition = disposition; RouteEvaluation = route; }
    }

    internal sealed class ConstrainedLimitException : Exception
    {
        internal readonly string Reason;
        internal ConstrainedLimitException(string reason) : base(reason) { Reason = reason; }
    }

    /// <summary>One monotonic deadline and linked token for the complete strategy,
    /// including direct comparison, all graph rebuilds and the final independent check.</summary>
    internal sealed class ConstrainedBudget : IDisposable
    {
        internal readonly ConstrainedRoutingLimits Limits;
        internal readonly CancellationToken UserToken;
        private readonly CancellationTokenSource linked;
        private readonly Stopwatch elapsed = Stopwatch.StartNew();
        private Dictionary<SegmentKey, RouteCollisionStatus> searchSegments;
        private RouteCollisionQuery searchOracle;
        private bool hasOracle, searchReuseDisabled;
        private static readonly RouteCollisionObservation reusedClear = new RouteCollisionObservation(RouteCollisionStatus.Clear, null, "SEARCH_SEGMENT_REUSED", 0);
        private static readonly RouteCollisionObservation reusedBlocked = new RouteCollisionObservation(RouteCollisionStatus.Blocked, null, "SEARCH_SEGMENT_REUSED", 0);
        internal CancellationToken Token { get { return linked.Token; } }
        internal long Work { get; private set; }
        internal int Queries { get; private set; }
        internal int Pairs { get; private set; }
        internal bool CandidatesTruncated;
        internal bool SawIndeterminate;
        internal RouteCollisionObservation FirstBlocking;
        internal readonly InterTrayOpeningContext InterTray;
        internal Dictionary<string, double> RouteCosts;
        internal IReadOnlyList<TraySegment> RouteCostTrays;
        internal bool RouteUsedInterTrayManeuver;
        internal bool RouteInterTrayImprovementLimited;
        internal readonly List<FinalRouteCollisionObservation> FinalChecks = new List<FinalRouteCollisionObservation>();
        internal RouteCollisionObservation FinalQuery(RouteCollisionQuery oracle, RoutePoint from, RoutePoint to)
        {
            var result = FreshQuery(oracle, from, to);
            FinalChecks.Add(new FinalRouteCollisionObservation(from, to, result)); return result;
        }
        internal ConstrainedBudget(ConstrainedRoutingLimits limits, CancellationToken token)
            : this(limits, token, false) { }
        internal ConstrainedBudget(ConstrainedRoutingLimits limits, CancellationToken token, bool interTrayManeuvers)
        {
            UserToken = token; UserToken.ThrowIfCancellationRequested(); Limits = limits;
            linked = CancellationTokenSource.CreateLinkedTokenSource(token); linked.CancelAfter(limits.TimeoutMilliseconds);
            if (interTrayManeuvers) InterTray = new InterTrayOpeningContext(this);
        }
        internal void Check()
        {
            UserToken.ThrowIfCancellationRequested();
            if (elapsed.ElapsedMilliseconds >= Limits.TimeoutMilliseconds || linked.IsCancellationRequested)
                throw new ConstrainedLimitException("SEARCH_DEADLINE_EXCEEDED");
        }
        internal void Charge(long units)
        {
            Check(); if (units < 0 || units > Limits.MaxWork - Work) throw new ConstrainedLimitException("SEARCH_WORK_LIMIT");
            Work += units;
        }
        internal void BeginPair()
        { Charge(1); if (Pairs >= Limits.MaxPairs) throw new ConstrainedLimitException("CANDIDATE_PAIR_LIMIT"); Pairs++; }
        internal RouteCollisionObservation Query(RouteCollisionQuery oracle, RoutePoint from, RoutePoint to)
        {
            Charge(1); ObserveOracle(oracle);
            if (searchReuseDisabled) return InvokeOracle(oracle, from, to);
            var key = new SegmentKey(from, to); RouteCollisionStatus status;
            if (searchSegments != null && searchSegments.TryGetValue(key, out status))
            {
                Check();
                // Search reuse carries no original kernel witness or performed work.
                // Final route and standalone connector checks always use FreshQuery.
                return status == RouteCollisionStatus.Clear ? reusedClear : reusedBlocked;
            }
            var result = InvokeOracle(oracle, from, to);
            if ((result.Status == RouteCollisionStatus.Clear || result.Status == RouteCollisionStatus.Blocked)
                && (searchSegments == null || searchSegments.Count < Math.Min(Limits.MaxCollisionQueries, 100000)))
            {
                if (searchSegments == null) searchSegments = new Dictionary<SegmentKey, RouteCollisionStatus>();
                searchSegments.Add(key, result.Status);
            }
            return result;
        }
        internal RouteCollisionObservation FreshQuery(RouteCollisionQuery oracle, RoutePoint from, RoutePoint to)
        {
            Charge(1); ObserveOracle(oracle); return InvokeOracle(oracle, from, to);
        }
        private void ObserveOracle(RouteCollisionQuery oracle)
        {
            if (!hasOracle) { hasOracle = true; searchOracle = oracle; }
            else if (!ReferenceEquals(searchOracle, oracle))
            {
                // One budget can only reuse one exact immutable-oracle context.
                // A -> B -> A cannot resurrect observations made before the change.
                searchReuseDisabled = true; searchSegments = null; searchOracle = null;
            }
        }
        private RouteCollisionObservation InvokeOracle(RouteCollisionQuery oracle, RoutePoint from, RoutePoint to)
        {
            if (Queries >= Limits.MaxCollisionQueries) throw new ConstrainedLimitException("COLLISION_QUERY_LIMIT");
            Queries++; RouteCollisionObservation observation;
            try { observation = oracle(from, to, Token); }
            catch (OperationCanceledException) { UserToken.ThrowIfCancellationRequested(); Check(); SawIndeterminate = true;
                return new RouteCollisionObservation(RouteCollisionStatus.Indeterminate, null, "COLLISION_ORACLE_CANCELLED", 0); }
            catch (Exception) { UserToken.ThrowIfCancellationRequested(); Check(); SawIndeterminate = true;
                return new RouteCollisionObservation(RouteCollisionStatus.Indeterminate, null, "COLLISION_ORACLE_FAILED", 0); }
            if (observation == null) observation = new RouteCollisionObservation(RouteCollisionStatus.Indeterminate, null, "COLLISION_ORACLE_UNAVAILABLE", 0);
            if (observation.Status == RouteCollisionStatus.Indeterminate) SawIndeterminate = true;
            if (observation.Status == RouteCollisionStatus.Blocked && FirstBlocking == null) FirstBlocking = observation;
            // Own guards are charged before admitting them. Oracle primitive
            // work has already happened; retain its report even if the remaining
            // work allowance or monotonic deadline was exceeded by this query.
            bool overflow = observation.Work > long.MaxValue - Work;
            Work = overflow ? long.MaxValue : Work + observation.Work;
            UserToken.ThrowIfCancellationRequested();
            if (overflow) throw new ConstrainedLimitException("ORACLE_WORK_ACCOUNTING_OVERFLOW");
            if (Work > Limits.MaxWork) throw new ConstrainedLimitException("SEARCH_WORK_LIMIT");
            Check();
            return observation;
        }
        private readonly struct SegmentKey : IEquatable<SegmentKey>
        {
            private readonly long ax, ay, az, bx, by, bz;
            internal SegmentKey(RoutePoint from, RoutePoint to)
            {
                ax = BitConverter.DoubleToInt64Bits(from.X); ay = BitConverter.DoubleToInt64Bits(from.Y); az = BitConverter.DoubleToInt64Bits(from.Z);
                bx = BitConverter.DoubleToInt64Bits(to.X); by = BitConverter.DoubleToInt64Bits(to.Y); bz = BitConverter.DoubleToInt64Bits(to.Z);
            }
            public bool Equals(SegmentKey other)
            { return ax == other.ax && ay == other.ay && az == other.az && bx == other.bx && by == other.by && bz == other.bz; }
            public override bool Equals(object other) { return other is SegmentKey && Equals((SegmentKey)other); }
            public override int GetHashCode()
            {
                unchecked
                {
                    int hash = 17; hash = hash * 31 + ax.GetHashCode(); hash = hash * 31 + ay.GetHashCode(); hash = hash * 31 + az.GetHashCode();
                    hash = hash * 31 + bx.GetHashCode(); hash = hash * 31 + by.GetHashCode(); return hash * 31 + bz.GetHashCode();
                }
            }
        }
        internal ConstrainedRouteEvaluation Failure(string reason)
        { return new ConstrainedRouteEvaluation(RouteResult.Failure("Constrained route search is incomplete: " + reason + "."),
            ConstrainedRouteStatus.SearchIncomplete, reason, false, this); }
        public void Dispose() { linked.Dispose(); }
    }
}
