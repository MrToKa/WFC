using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AddinRibbon.Routing;
using Autodesk.Navisworks.Api;
using Autodesk.Navisworks.Api.Data;

namespace AddinRibbon.Services
{
    public sealed partial class RoutingSession
    {
        // Cache native name matches, never a visibility decision. Model replacement
        // clears this index; hide/unhide is evaluated afresh on each manual request.
        private readonly Dictionary<string, List<ModelItem>> lookupNameIndex =
            new Dictionary<string, List<ModelItem>>(StringComparer.OrdinalIgnoreCase);

        public async Task<List<TraySegment>> CaptureLookupSegmentsAsync(IReadOnlyList<string> codes, CancellationToken token)
        {
            RequireDocument();
            if (codes == null || codes.Count == 0) throw new InvalidOperationException("Enter a route path first.");
            int revision = Revision;
            var assignments = new List<RouteAssignment>();
            var errors = new List<string>();
            var slice = Stopwatch.StartNew();
            foreach (var code in codes.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                token.ThrowIfCancellationRequested();
                if (!lookupNameIndex.TryGetValue(code, out var matches))
                {
                    await Task.Delay(1, token);
                    if (revision != Revision) throw new OperationCanceledException("Model changed during route lookup.");
                    using (var search = new Search())
                    {
                        search.Selection.SelectAll();
                        search.Locations = SearchLocations.DescendantsAndSelf;
                        search.PruneBelowMatch = false;
                        search.SearchConditions.Add(SearchCondition.HasPropertyByName(PropertyCategoryNames.Item, DataPropertyNames.ItemName)
                            .DisplayStringContains(code.TrimStart('/')).IgnoreStringValueCase());
                        matches = search.FindAll(document, false).ToList();
                    }
                    token.ThrowIfCancellationRequested();
                    if (revision != Revision) throw new OperationCanceledException("Model changed during route lookup.");
                    lookupNameIndex.Add(code, matches);
                }
                var roots = new HashSet<ModelItem>();
                foreach (var match in matches)
                {
                    token.ThrowIfCancellationRequested();
                    if (!IsVisible(match)) continue;
                    var ancestors = match.AncestorsAndSelf.ToArray();
                    int owner = RouteNameResolver.OwnerIndex(ancestors.Select(item => item.DisplayName).ToArray());
                    if (owner >= 0 && string.Equals(RouteCodeParser.Parse(ancestors[owner].DisplayName), code, StringComparison.OrdinalIgnoreCase))
                        roots.Add(ancestors[owner]);
                    if (slice.ElapsedMilliseconds >= 25) { await Task.Delay(1, token); slice.Restart(); }
                    if (revision != Revision) throw new OperationCanceledException("Model changed during route lookup.");
                }
                // Nested wrappers carrying the same logical name represent one route,
                // while equal names on separate branches remain ambiguous.
                var owners = roots.Where(root => !root.Ancestors.Any(roots.Contains)).ToArray();
                var candidates = new List<RouteAssignment>();
                foreach (var root in owners)
                {
                    var leaves = new List<ModelItem>();
                    foreach (var item in root.DescendantsAndSelf)
                    {
                        token.ThrowIfCancellationRequested();
                        if (!item.Children.Any() && item.HasGeometry && IsVisible(item)
                            && string.Equals(FindRouteName(item, root), code, StringComparison.OrdinalIgnoreCase))
                        {
                            using (var box = item.BoundingBox()) if (!box.IsEmpty) leaves.Add(item);
                        }
                        if (slice.ElapsedMilliseconds >= 25) { await Task.Delay(1, token); slice.Restart(); }
                        if (revision != Revision) throw new OperationCanceledException("Model changed during route lookup.");
                    }
                    if (leaves.Count > 0) candidates.Add(new RouteAssignment
                    { Root = root, Name = code, Categories = CableCategory.All, Leaves = leaves, LeafCount = leaves.Count });
                }
                if (candidates.Count == 0) errors.Add("Route not found among visible objects: " + code + ". Matching objects are hidden, absent, or contain no route geometry.");
                else if (candidates.Count > 1) errors.Add("More than one visible logical route is named " + code + ".");
                else assignments.Add(candidates[0]);
            }
            if (errors.Count > 0) throw new InvalidOperationException(string.Join(Environment.NewLine, errors));
            token.ThrowIfCancellationRequested();
            if (revision != Revision) throw new OperationCanceledException("Model changed during route lookup.");
            // This session is dedicated to lookup in the pane. The Path session's
            // assignments, segment identities and cached endpoint result stay intact.
            return await CaptureSegmentsCoreAsync(assignments, token);
        }
    }
}
