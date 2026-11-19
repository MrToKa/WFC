using System.Collections.Generic;

namespace AddinRibbon.Routing
{
    public sealed partial class RouteCalculator
    {
        private sealed class EndpointSections
        {
            internal readonly Projection From, To;

            internal EndpointSections(Projection from, Projection to)
            {
                From = from;
                To = to;
            }
        }

        private static Projection? EndpointSectionToCheck(List<TraySegment> trays, Projection candidate,
            Projection? nearest, RoutingOptions options)
        {
            if (!nearest.HasValue || nearest.Value.Distance > options.SecondaryDistanceMeters
                || candidate.Segment == nearest.Value.Segment) return null;
            var section = trays[nearest.Value.Segment];
            var code = section.ConnectionRouteCode;
            if (code == null) return null;
            if (code == trays[candidate.Segment].ConnectionRouteCode) return nearest;
            if (candidate.Distance <= options.SecondaryDistanceMeters) return null;
            // A distant secondary approach must not stand in for a missing
            // continuation of the nearby tray. Check only routes split into sections.
            return trays.Exists(tray => tray.ConnectionRouteCode == code && tray != section)
                ? nearest : null;
        }

        private static bool SkipsEndpointSection(List<Node> nodes, List<TraySegment> trays, RoutePoint equipment,
            int candidate, int anchor, RouteCollisionQuery collision, ConstrainedBudget budget)
        {
            if (anchor < 0 || (collision != null &&
                budget.Query(collision, equipment, nodes[anchor].Point).Status != RouteCollisionStatus.Clear)) return false;

            var code = trays[nodes[anchor].Segment].ConnectionRouteCode;
            bool sameRoute = code == trays[nodes[candidate].Segment].ConnectionRouteCode;
            var visited = new HashSet<int> { anchor };
            var reachedSections = new HashSet<int>();
            var pending = new Stack<int>();
            pending.Push(anchor);
            while (pending.Count != 0)
            {
                budget.Charge(1);
                int current = pending.Pop();
                if (current == candidate) return false;
                reachedSections.Add(nodes[current].Segment);
                foreach (var edge in nodes[current].Edges)
                {
                    budget.Charge(1);
                    if (trays[nodes[edge.Node].Segment].ConnectionRouteCode == code && visited.Add(edge.Node))
                        pending.Push(edge.Node);
                }
            }
            if (sameRoute) return true;

            budget.Charge(trays.Count);
            for (int i = 0; i < trays.Count; i++)
                if (trays[i].ConnectionRouteCode == code && !reachedSections.Contains(i)) return true;
            return false;
        }
    }
}
