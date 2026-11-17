using System.Diagnostics;
using System.Text.Json;
using AddinRibbon.Routing;
using PathFinder.Barriers;

internal static partial class Program
{
    // Informational checks of the saved centreline never replace its routing proof.
    private static ObstacleReportValue ObstacleReport(IReadOnlyList<RoutePoint> points, bool hasRoute, bool knownClear, bool explicitEmpty,
        JsonElement[]? selected, IReadOnlySet<string> rejectedParents, bool exactBlockers,
        Func<BarrierPoint, BarrierPoint, IReadOnlySet<string>, ObstacleObservation>? query, CancellationToken token)
    {
        int total = hasRoute ? Math.Max(1, points.Count - 1) : 0, checkedSegments = 0;
        var crossed = new HashSet<string>(StringComparer.Ordinal);
        string status = "complete", reason = "OBSTACLE_REPORT_COMPLETE";
        if (knownClear || explicitEmpty || !hasRoute) checkedSegments = total;
        else if (query is null) { status = "unavailable"; reason = "OBSTACLE_REPORT_UNAVAILABLE"; }
        else
        {
            var watch = Stopwatch.StartNew(); long work = 0; int queries = 0;
            for (int index = 0; index < total; index++)
            {
                token.ThrowIfCancellationRequested();
                var first = points[index]; var last = points[Math.Min(index + 1, points.Count - 1)];
                while (true)
                {
                    // Each individual kernel query is separately bounded. Do not
                    // start another after this reporting-only aggregate budget.
                    if (queries++ >= 10000 || work >= 2_000_000 || watch.ElapsedMilliseconds >= 10000)
                    { status = "partial"; reason = "OBSTACLE_REPORT_LIMIT"; break; }
                    var observed = query(new(first.X, first.Y, first.Z), new(last.X, last.Y, last.Z), crossed);
                    work += observed.Work;
                    if (observed.Status == "clear") { checkedSegments++; break; }
                    if (observed.Status != "blocked") { status = "partial"; reason = "OBSTACLE_REPORT_INDETERMINATE"; break; }
                    int previous = crossed.Count; crossed.UnionWith(observed.ParentIds);
                    if (!observed.Exact || crossed.Count == previous)
                    { status = "partial"; reason = "OBSTACLE_PARENT_ATTRIBUTION_INDETERMINATE"; break; }
                }
                if (status != "complete") break;
            }
        }
        var encountered = new HashSet<string>(crossed, StringComparer.Ordinal); encountered.UnionWith(rejectedParents);
        var parentsToShow = (selected ?? []).Where(parent => encountered.Contains(parent.GetProperty("selectionId").GetString()!))
            .OrderBy(parent => parent.GetProperty("dbId").GetInt32()).ToArray();
        return new(status, crossed.Order(StringComparer.Ordinal).ToArray(), rejectedParents.Order(StringComparer.Ordinal).ToArray(),
            checkedSegments, total, reason, parentsToShow, exactBlockers ? "exact" : "component-membership");
    }
    private static string ObstacleFailureMessage(string message, ObstacleReportValue report)
    {
        var ids = report.BlockingParentSelectionIds.ToHashSet(StringComparer.Ordinal);
        var labels = report.SelectedParents.Where(parent => ids.Contains(parent.GetProperty("selectionId").GetString()!)).Select(parent => "#" + parent.GetProperty("dbId").GetInt32().ToString(System.Globalization.CultureInfo.InvariantCulture));
        string suffix = ids.Count > 0 ? (report.BlockingAttribution == "exact" ? " Blocking obstacles: " : " Selected objects associated with blocking geometry: ") + string.Join(", ", labels) + "." : "";
        if (report.Status != "complete") suffix += " Obstacle checks are " + report.Status + "; additional obstacles may be unreported.";
        return message + suffix;
    }
    private sealed record ObstacleReportValue(string Status, string[] CrossedParentSelectionIds, string[] BlockingParentSelectionIds,
        int CheckedSegments, int TotalSegments, string ReasonCode, JsonElement[] SelectedParents, string BlockingAttribution);
    private sealed record ObstacleObservation(string Status, string[] ParentIds, bool Exact, long Work);
    private sealed record ParentContact(string[] Confirmed, string[] Associated, bool Exact);
    private static ParentContact WholeShellParents(IEnumerable<IReadOnlyList<string>> sources)
    {
        var rows = sources.ToArray();
        if (rows.Length == 0) return new([], [], false);
        var common = rows[0].ToHashSet(StringComparer.Ordinal); var union = new HashSet<string>(common, StringComparer.Ordinal);
        foreach (var row in rows.Skip(1)) { common.IntersectWith(row); union.UnionWith(row); }
        // Containment is attributable only to a parent owning the complete shell.
        // A collection of partial faces is never reclassified as its own solid.
        return new(common.Order(StringComparer.Ordinal).ToArray(), union.Order(StringComparer.Ordinal).ToArray(), common.Count == union.Count);
    }
    private static ParentContact MixedContactParents(PreparedMixedBarriers barriers, MixedBarrierWitness? witness, Dictionary<string, ParentContact>? cache = null)
    {
        if (witness?.Triangle is { } triangle)
        { var ids = triangle.Source.ParentSelectionIds.ToArray(); return new(ids, ids, true); }
        if (witness is null || !barriers.ComponentsById.TryGetValue(witness.ComponentId, out var component)) return new([], [], false);
        if (cache?.TryGetValue(component.Id, out var retained) == true) return retained;
        var result = WholeShellParents(component.Triangles.Select(value => value.Source.ParentSelectionIds));
        if (cache is not null) cache[component.Id] = result; return result;
    }
    private static ParentContact LegacyContactParents(PreparedBarriers barriers, BarrierSegmentResult observation, Dictionary<string, ParentContact>? cache = null)
    {
        if (observation.BarrierId is null || !barriers.MeshesById.TryGetValue(observation.BarrierId, out var mesh)) return new([], [], false);
        if (observation.TriangleIndex is { } index)
        { var ids = mesh.TriangleSources[index].ParentSelectionIds.ToArray(); return new(ids, ids, true); }
        if (cache?.TryGetValue(mesh.Mesh.Id, out var retained) == true) return retained;
        var result = WholeShellParents(mesh.TriangleSources.Select(value => value.ParentSelectionIds));
        if (cache is not null) cache[mesh.Mesh.Id] = result; return result;
    }
    private static ObstacleReportValue MixedObstacleReport(string root, MixedBarrierRuntimeContext context, PreparedMixedBarriers barriers,
        SessionExecutionContext? session, IReadOnlyList<RoutePoint> points, bool hasRoute, IReadOnlySet<string> rejectedParents, bool exactBlockers, CancellationToken token)
    {
        var reporting = barriers;
        if (context.Drill && context.Mode == "mixed-mesh-set" && hasRoute)
        {
            try { reporting = LoadMixedBarriers(root, context, session, token, reporting: true); }
            catch (ArgumentException) { /* Reporting cannot revoke an explicit bypass. */ }
        }
        var first = hasRoute ? points[0] : default; var last = hasRoute ? points[^1] : default;
        return ObstacleReport(points, hasRoute, !context.Drill, context.Mode == "explicit-empty", reporting.SelectedParents ?? barriers.SelectedParents,
            rejectedParents, exactBlockers, reporting.Qualified is null ? null : (from, to, excluded) => {
                var value = reporting.Qualified.Kernel.CheckRouteSegmentExcluding(from, to,
                    new(first.X, first.Y, first.Z), new(last.X, last.Y, last.Z), excluded, cancellationToken: token);
                var parents = MixedContactParents(reporting, value.Witness);
                return new(value.Status == MixedBarrierSegmentStatus.Clear ? "clear" : value.Status == MixedBarrierSegmentStatus.Blocked ? "blocked" : "indeterminate",
                    parents.Confirmed, parents.Exact, value.Work);
            }, token);
    }
    private static ObstacleReportValue LegacyObstacleReport(string root, BarrierRuntimeContext context, PreparedBarriers barriers,
        SessionExecutionContext? session, IReadOnlyList<RoutePoint> points, bool hasRoute, IReadOnlySet<string> rejectedParents, bool exactBlockers, CancellationToken token)
    {
        var reporting = barriers;
        if (context.Drill && context.Mode == "mesh-set" && hasRoute)
        {
            try { reporting = LoadBarriers(root, context, session, token, reporting: true); }
            catch (ArgumentException) { /* Reporting cannot revoke an explicit bypass. */ }
        }
        var meshes = reporting.Qualified?.Meshes.ToDictionary(value => value.Mesh.Id, StringComparer.Ordinal);
        var first = hasRoute ? points[0] : default; var last = hasRoute ? points[^1] : default;
        return ObstacleReport(points, hasRoute, !context.Drill, context.Mode == "explicit-empty", reporting.SelectedParents ?? barriers.SelectedParents,
            rejectedParents, exactBlockers, reporting.Qualified is null ? null : (from, to, excluded) => {
                var value = reporting.Qualified.Kernel.CheckRouteSegmentReporting(from, to,
                    new(first.X, first.Y, first.Z), new(last.X, last.Y, last.Z),
                    (id, index) => meshes![id].TriangleSources[index].ParentSelectionIds.All(excluded.Contains),
                    id => meshes![id].TriangleSources.All(source => source.ParentSelectionIds.All(excluded.Contains)), token);
                var parents = LegacyContactParents(reporting, value);
                return new(value.Status == BarrierSegmentStatus.Clear ? "clear" : value.Status == BarrierSegmentStatus.Blocked ? "blocked" : "indeterminate",
                    parents.Confirmed, parents.Exact, value.Work);
            }, token);
    }
}
