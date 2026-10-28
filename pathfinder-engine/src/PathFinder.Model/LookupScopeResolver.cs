using AddinRibbon.Routing;

namespace PathFinder.Model;

public sealed record LookupScopeSummary(int RequestedCodeCount, int UniqueCodeCount, int DiscoveredObjectCount,
    int ResolvedOwnerCount, int ResolvedLeafCount, string[] Warnings);
public sealed record LookupScopeResolution(ModelSnapshot Snapshot, LookupScopeSummary Scope);

/// <summary>Native RoutingSession.Lookup owner selection over a bounded converted capture.
/// SDK display visibility is an adapter input, never proof of native visibility.</summary>
public static class LookupScopeResolver
{
    public static string[] Plan(string routeText, CancellationToken cancellation = default)
    {
        cancellation.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(routeText) || routeText.Length > 8000)
            throw new ArgumentException("Ordered lookup requires a route in at most 8000 characters.");
        var codes = RouteLookupCalculator.Parse(routeText).ToArray();
        if (codes.Length is < 1 or > 100 || codes.Any(code => code.Length > 256))
            throw new ArgumentException("Ordered lookup requires 1 to 100 bounded route codes.");
        return codes;
    }

    internal static void ValidateCodes(string[] codes)
    {
        if (codes is null || codes.Length is < 1 or > 100 || codes.Any(code => code is null || code.Length > 256))
            throw new ArgumentException("Invalid independent lookup scope.");
        var planned = Plan(string.Concat(codes)).Distinct(StringComparer.Ordinal).ToArray();
        if (!planned.SequenceEqual(codes, StringComparer.Ordinal))
            throw new ArgumentException("Independent lookup scope must contain the exact canonical C# planned codes.");
    }

    public static LookupScopeResolution Resolve(ModelSnapshot snapshot, IReadOnlyList<string> orderedCodes,
        ModelLimits? limits = null, CancellationToken cancellation = default)
    {
        limits ??= new();
        SnapshotReader.Validate(snapshot, limits, cancellation);
        var capturedCodes = snapshot.Capture.LookupRouteCodes ?? throw new ArgumentException("A dedicated independent lookup capture is required.");
        if (!capturedCodes.SequenceEqual(orderedCodes.Distinct(StringComparer.Ordinal), StringComparer.Ordinal))
            throw new ArgumentException("Lookup text does not match its immutable captured scope.");
        var objects = snapshot.Objects.ToDictionary(item => item.Id, StringComparer.Ordinal);
        var chains = new Dictionary<string, SnapshotObject[]>(StringComparer.Ordinal);
        SnapshotObject[] Chain(SnapshotObject item)
        {
            if (chains.TryGetValue(item.Id, out var retained)) return retained;
            var chain = new List<SnapshotObject>();
            while (true)
            {
                cancellation.ThrowIfCancellationRequested(); chain.Add(item);
                if (item.ParentId is null) break;
                item = objects[item.ParentId]; // Strict dedicated capture requires complete ancestor evidence.
            }
            return chains[chain[0].Id] = chain.ToArray();
        }
        var selectedLeaves = new Dictionary<string, SnapshotObject>(StringComparer.Ordinal);
        var retainedIds = new HashSet<string>(StringComparer.Ordinal);
        var uniqueCodes = orderedCodes.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var errors = new List<string>(); int ownerCount = 0;
        foreach (var code in uniqueCodes)
        {
            cancellation.ThrowIfCancellationRequested();
            var roots = new Dictionary<string, SnapshotObject>(StringComparer.Ordinal);
            foreach (var match in snapshot.Objects)
            {
                cancellation.ThrowIfCancellationRequested();
                if (!match.Name.Contains(code.TrimStart('/'), StringComparison.OrdinalIgnoreCase)) continue;
                var chain = Chain(match); int owner = RouteNameResolver.OwnerIndex(chain.Select(item => item.Name).ToArray());
                if (owner >= 0 && StringComparer.OrdinalIgnoreCase.Equals(RouteCodeParser.Parse(chain[owner].Name), code))
                    roots.TryAdd(chain[owner].Id, chain[owner]);
            }
            // Same-name nested wrappers are one logical route. Separate branches
            // stay ambiguous exactly as the pinned native host does.
            var owners = roots.Values.Where(root => !Chain(root).Skip(1).Any(ancestor => roots.ContainsKey(ancestor.Id))).ToArray();
            var ownerLeaves = owners.ToDictionary(owner => owner.Id, _ => new List<SnapshotObject>(), StringComparer.Ordinal);
            foreach (var item in snapshot.Objects)
            {
                cancellation.ThrowIfCancellationRequested();
                if (item.GeometryRole != "routing-leaf" || item.Fragments.Length == 0) continue;
                var chain = Chain(item); int boundary = Array.FindIndex(chain, ancestor => ownerLeaves.ContainsKey(ancestor.Id));
                if (boundary < 0) continue;
                var boundedNames = chain.Take(boundary + 1).Select(ancestor => ancestor.Name);
                if (StringComparer.OrdinalIgnoreCase.Equals(RouteNameResolver.Resolve(boundedNames), code)) ownerLeaves[chain[boundary].Id].Add(item);
            }
            var candidates = owners.Where(owner => ownerLeaves[owner.Id].Count > 0).Select(owner => (Owner: owner, Leaves: ownerLeaves[owner.Id])).ToArray();
            if (candidates.Length == 0)
                errors.Add("Route not found among captured visible objects: " + code + ". Matching objects are hidden, absent, or contain no route geometry.");
            else if (candidates.Length > 1) errors.Add("More than one visible logical route is named " + code + ".");
            else
            {
                ownerCount++;
                foreach (var leaf in candidates[0].Leaves)
                {
                    cancellation.ThrowIfCancellationRequested();
                    var resolved = leaf with { RouteBoundaryId = candidates[0].Owner.Id };
                    if (!selectedLeaves.TryAdd(leaf.Id, resolved)) throw new ArgumentException("A physical lookup leaf belongs to multiple requested logical owners.");
                    foreach (var ancestor in Chain(leaf)) retainedIds.Add(ancestor.Id);
                }
            }
        }
        if (errors.Count > 0) throw new ArgumentException(string.Join(Environment.NewLine, errors));
        cancellation.ThrowIfCancellationRequested();
        var resolvedObjects = snapshot.Objects.Where(item => retainedIds.Contains(item.Id))
            .Select(item => selectedLeaves.TryGetValue(item.Id, out var leaf) ? leaf : item).ToArray();
        var result = snapshot with { Objects = resolvedObjects };
        SnapshotReader.Validate(result, limits, cancellation);
        var warnings = new List<string> { "Scope uses current SDK display visibility; native visibility, native-converted parity and engineering acceptance remain unverified." };
        int discarded = snapshot.Objects.Count(item => item.GeometryRole == "routing-leaf") - selectedLeaves.Count;
        if (discarded > 0) warnings.Add(discarded + " broad name-discovery leaves were excluded by canonical logical-owner resolution.");
        return new(result, new(orderedCodes.Count, uniqueCodes.Length, snapshot.Objects.Length, ownerCount, selectedLeaves.Count, warnings.ToArray()));
    }
}
