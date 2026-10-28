using System.Globalization;
using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Adapter;
using PathFinder.Barriers;
using PathFinder.Model;

internal static partial class Program
{
    private static object ExecuteBarrierRoute(Request request, string root, ModelIdentity model, PreparedModel prepared,
        object summary, RoutingOptions options, CancellationToken token, SessionExecutionContext? session)
    {
        var context = BarrierContext(request);
        if (model.ContentSha256 != BarrierString(context.Scope, "contentFingerprint")) throw new ArgumentException("Barrier scope and planning model content fingerprints differ.");
        PreparedBarriers barriers;
        try { barriers = LoadBarriers(root, context, session, token); }
        catch (BarrierQualificationException error) { return BarrierFailure(request, context, "no_path", "BARRIER_QUALIFICATION_REFUSED", error.Message); }
        var category = request.Category is "Control" or "Instrumentation" ? CableCategory.Control : CableCategory.LV;
        bool bypass = context.Drill || context.Mode == "explicit-empty";
        RouteCollisionQuery oracle = (first, last, cancellation) =>
        {
            if (barriers.Qualified is null) throw new InvalidOperationException("Qualified barrier collision data unavailable.");
            var observation = barriers.Qualified.Kernel.CheckSegment(new(first.X, first.Y, first.Z), new(last.X, last.Y, last.Z), cancellation);
            return new(observation.Status == BarrierSegmentStatus.Clear ? RouteCollisionStatus.Clear
                : observation.Status == BarrierSegmentStatus.Blocked ? RouteCollisionStatus.Blocked : RouteCollisionStatus.Indeterminate,
                observation.BarrierId, observation.Reason, observation.Work);
        };
        ConstrainedSecondaryEvaluation? secondary = null; LocalApproachRouteEvaluation local;
        var purposeTrays = PurposeRouting.Filter(prepared.Segments, request.AllowedPurposeRouteCodes, token);
        if (request.DirectSecondaryPolicy is not null)
        {
            var calculated = CapacityRouting.CalculateSecondaryWithLocalApproaches(purposeTrays, request.ExcludedRouteCodes, Point(request.From), Point(request.To), category,
                oracle, options, drillThroughWalls: bypass, cancellationToken: token, finalReverse: request.Reverse,
                routeCostMultipliers: request.RouteCostMultipliers);
            secondary = calculated.SecondaryEvaluation; local = calculated.LocalApproaches;
        }
        else local = CapacityRouting.CalculateWithLocalApproaches(purposeTrays, request.ExcludedRouteCodes, Point(request.From), Point(request.To), category,
            oracle, options, drillThroughWalls: bypass, cancellationToken: token, routeCostMultipliers: request.RouteCostMultipliers);
        token.ThrowIfCancellationRequested(); var evaluated = local.RouteEvaluation;
        var route = evaluated.Route;
        var distance = secondary?.DistanceDecision is { } raw ? DirectSecondaryDecision.Capture(raw) : null;
        bool actualDirect = secondary?.DistanceQualified == true && secondary.DirectDisposition is "clear" or "bypassed";
        if (request.Reverse)
        {
            distance = distance?.Reverse();
            route = actualDirect ? distance!.DirectRoute() : route.Reverse();
        }
        object? proof = null;
        if (route.Success)
        {
            IReadOnlyList<FinalRouteCollisionObservation> final = evaluated.FinalChecks;
            var checks = final.Select(value => value.Observation).ToArray();
            if (!bypass)
            {
                var ordered = request.Reverse && route.PathPoints.Count > 1 ? final.Reverse().ToArray() : final.ToArray();
                if (ordered.Length != Math.Max(1, route.PathPoints.Count - 1)) throw new InvalidOperationException("Final route proof does not close over its exact polyline.");
                for (int index = 0; index < ordered.Length; index++)
                {
                    bool reverse = request.Reverse && route.PathPoints.Count > 1;
                    var first = reverse ? ordered[index].To : ordered[index].From; var last = reverse ? ordered[index].From : ordered[index].To;
                    if (!SameBits(first, route.PathPoints[index]) || !SameBits(last, route.PathPoints[Math.Min(index + 1, route.PathPoints.Count - 1)]))
                        throw new InvalidOperationException("Final proof endpoints differ from the exact route.");
                }
                checks = ordered.Select(value => value.Observation).ToArray();
            }
            proof = BarrierProof(context, barriers, route.PathPoints, checks);
        }
        object? direct = null;
        if (distance is not null)
        {
            var chord = DirectSecondaryRoute.Create(Point(request.Reverse ? request.To : request.From), Point(request.Reverse ? request.From : request.To));
            object? directCheck = null; string reason = "DISTANCE_NOT_QUALIFIED";
            if (secondary!.DistanceQualified)
            {
                directCheck = BarrierProof(context, barriers, chord.PathPoints, secondary.DirectCollision is { } observed ? new[] { observed } : Array.Empty<RouteCollisionObservation>());
                reason = actualDirect ? context.Drill ? "DIRECT_SECONDARY_DRILLING_BYPASS" : context.Mode == "explicit-empty"
                    ? "DIRECT_SECONDARY_EXPLICIT_EMPTY_SCOPE" : "DIRECT_SECONDARY_CLEAR"
                    : secondary.DirectDisposition == "blocked" ? "DIRECT_SECONDARY_BLOCKED_TRAY_FALLBACK"
                    : secondary.DirectDisposition == "indeterminate" ? "DIRECT_SECONDARY_INDETERMINATE_TRAY_FALLBACK" : "DIRECT_SECONDARY_UNAVAILABLE_TRAY_FALLBACK";
            }
            direct = new { schemaVersion = ConstrainedSecondaryEvaluation.SchemaVersion, policyVersion = ConstrainedSecondaryEvaluation.PolicyVersion,
                distanceDecision = distance, binding = context.Binding, directRouteSha256 = BarrierRouteHash(chord.PathPoints),
                mode = actualDirect ? "direct-secondary" : "tray-network", directCheck, reasonCode = reason };
        }
        var status = route.Success ? "calculated" : BarrierOutcomeStatus(evaluated.Reason);
        CableDesignLength? design = null; object? ledger = null; var settings = request.ProjectSettings!;
        if (route.Success)
        {
            if (actualDirect)
            {
                var observed = DirectSecondaryLengthObserver.Calculate(distance!, settings, token); design = observed.Design;
                if (request.IncludeLengthLedger) ledger = observed.Ledger;
            }
            else if ((route.FromRequiresSecondary || route.ToRequiresSecondary) && settings.SecondaryTrayLength is null) status = "settings_required";
            else
            {
                var observed = LengthLedgerObserver.Calculate(route, settings, token); design = observed.Design;
                if (request.IncludeLengthLedger) ledger = observed.Ledger;
            }
        }
        string diagnosticStatus = route.Success ? context.Drill ? "bypassed" : context.Mode == "explicit-empty" ? "no-barriers-declared" : "clear"
            : evaluated.Status == ConstrainedRouteStatus.Bypassed ? "unavailable" : RouteStatus(evaluated.Status);
        var execution = new
        {
            schemaVersion = "wfc.pf.barrier-execution.v1", context = context.Value, proof, directSecondary = direct,
            diagnostics = new { status = diagnosticStatus, reasonCode = evaluated.Reason, searchComplete = evaluated.SearchComplete,
                candidatesTruncated = evaluated.CandidatesTruncated, pairAttempts = evaluated.PairAttempts, collisionQueries = evaluated.CollisionQueries,
                work = evaluated.Work.ToString(CultureInfo.InvariantCulture), plannerAttempts = local.PlannerAttempts,
                straightPairAttempts = local.StraightPairAttempts, localEdgeChecks = local.LocalEdgeChecks,
                localPhaseUsed = local.LocalPhaseUsed, straightPhaseTruncated = local.StraightPhaseTruncated },
            connectors = new { from = Connector(request.Reverse ? local.ToConnector : local.FromConnector), to = Connector(request.Reverse ? local.FromConnector : local.ToConnector) },
            qualification = barriers.Qualification
        };
        var result = new Dictionary<string, object?> { ["schemaVersion"] = "pathfinder.model.response.v3", ["requestId"] = request.RequestId,
            ["status"] = status, ["message"] = status == "settings_required" ? "Project Details SECONDARY length is required." : route.Message,
            ["model"] = model, ["prepared"] = summary, ["effectiveCategory"] = category.ToString(), ["route"] = route,
            ["design"] = design, ["projectSettings"] = settings, ["engineeringAccepted"] = false, ["lookupScope"] = null,
            ["usedConnectionGapMeters"] = null, ["barriers"] = execution };
        if (ledger is not null) result.Add("lengthLedger", ledger);
        token.ThrowIfCancellationRequested(); return result;
    }
    private static string RouteStatus(ConstrainedRouteStatus status) => status switch
    { ConstrainedRouteStatus.Clear => "clear", ConstrainedRouteStatus.Blocked => "blocked", ConstrainedRouteStatus.Indeterminate => "indeterminate",
        ConstrainedRouteStatus.Bypassed => "bypassed", _ => "search-incomplete" };
    private static string BarrierOutcomeStatus(string reason) => reason switch
    {
        "SEARCH_DEADLINE_EXCEEDED" => "deadline_exceeded",
        "SEARCH_WORK_LIMIT" or "CANDIDATE_PAIR_LIMIT" or "COLLISION_QUERY_LIMIT" or "ORACLE_WORK_ACCOUNTING_OVERFLOW"
            or "INPUT_TRAY_LIMIT" or "INPUT_IDENTITY_LIMIT" or "INPUT_PIECE_LIMIT" or "GRAPH_NODE_LIMIT" or "GRAPH_CONNECTION_LIMIT"
            or "GRAPH_CANDIDATE_LIMIT" or "LOCAL_PLAN_OR_EDGE_LIMIT" or "LOCAL_EDGE_CHECK_LIMIT" or "LOCAL_QUEUE_LIMIT" => "resource_limit",
        _ => "no_path"
    };
    private static bool SameBits(RoutePoint left, RoutePoint right) => BitConverter.DoubleToInt64Bits(left.X) == BitConverter.DoubleToInt64Bits(right.X)
        && BitConverter.DoubleToInt64Bits(left.Y) == BitConverter.DoubleToInt64Bits(right.Y) && BitConverter.DoubleToInt64Bits(left.Z) == BitConverter.DoubleToInt64Bits(right.Z);
    private static object? Connector(RouteConnectorPlan? plan) => plan is null ? null : new
    { policyVersion = RouteConnectorPlan.PolicyVersion, status = plan.Status.ToString().ToLowerInvariant(), reasonCode = plan.Reason,
        points = plan.Points.Select(point => new[] { point.X, point.Y, point.Z }).ToArray(), plan.LengthMeters, plan.DirectDistanceMeters, plan.IsDetour,
        plan.SearchComplete, domain = new { minimum = new[] { plan.Domain.Minimum.X, plan.Domain.Minimum.Y, plan.Domain.Minimum.Z },
            maximum = new[] { plan.Domain.Maximum.X, plan.Domain.Maximum.Y, plan.Domain.Maximum.Z }, plan.Domain.StepMeters },
        plan.EdgeChecks, plan.Queries, work = plan.Work.ToString(CultureInfo.InvariantCulture) };
    private static object BarrierProof(BarrierRuntimeContext context, PreparedBarriers barriers, IReadOnlyList<RoutePoint> points,
        IReadOnlyList<RouteCollisionObservation> checks)
    {
        int total = Math.Max(1, points.Count - 1), count = 0; object? blocking = null; int? failed = null;
        string status, reason;
        if (context.Drill) { status = "bypassed"; reason = "EXPLICIT_DRILLING_BYPASS"; }
        else if (context.Mode == "explicit-empty") { status = "no-barriers-declared"; reason = "EXPLICIT_EMPTY_SCOPE"; }
        else
        {
            status = "unavailable"; reason = "FINAL_CHECK_UNAVAILABLE";
            for (int index = 0; index < checks.Count && index < total; index++)
            {
                var observation = checks[index];
                if (observation.Status == RouteCollisionStatus.Clear) { count++; continue; }
                if (observation.Status == RouteCollisionStatus.Indeterminate) { status = "indeterminate"; reason = "BARRIER_QUERY_INDETERMINATE"; failed = index; break; }
                var membership = barriers.Qualification?.ComputationalMemberships.SingleOrDefault(value => value.ComputationalMeshId == observation.ShellId)
                    ?? throw new InvalidOperationException("Collision shell membership is unavailable.");
                count++; status = "blocked"; reason = "REGISTERED_BARRIER_INTERSECTION";
                blocking = new { membership.ComputationalMeshId, membership.ParentSelectionIds, membership.FragmentIds,
                    segmentIndex = index, reason = "surface-or-containment", surfaceWitness = (object?)null }; break;
            }
            if (count == total && blocking is null && failed is null) { status = "clear-selected-scope"; reason = "REGISTERED_SCOPE_CLEAR"; }
            if (status == "unavailable") count = 0;
        }
        return new { schemaVersion = "wfc.pf.barrier-check-proof.v2", binding = context.Binding, routeSha256 = BarrierRouteHash(points),
            status, routePointCount = points.Count, totalSegments = total, checkedSegments = count, blocking, failedSegmentIndex = failed,
            reasonCode = reason, coverage = "registered-selected-objects-only", engineeringAccepted = false };
    }
    private static object BarrierFailure(Request request, BarrierRuntimeContext context, string status, string reason, string message) => new
    { schemaVersion = "pathfinder.model.response.v3", request.RequestId, status, message, engineeringAccepted = false,
        barriers = new { schemaVersion = "wfc.pf.barrier-execution.v1", context = context.Value, proof = (object?)null, directSecondary = (object?)null,
            diagnostics = new { status = "unavailable", reasonCode = reason, searchComplete = false, candidatesTruncated = false, pairAttempts = 0,
                collisionQueries = 0, work = "0", plannerAttempts = 0, straightPairAttempts = 0, localEdgeChecks = 0, localPhaseUsed = false, straightPhaseTruncated = false },
            connectors = new { from = (object?)null, to = (object?)null }, qualification = (object?)null } };
}
