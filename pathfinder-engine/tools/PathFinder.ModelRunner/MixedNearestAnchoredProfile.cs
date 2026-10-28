using System.Text.Json;
using System.Text.Json.Nodes;
using AddinRibbon.Routing;

internal static partial class Program
{
    private static readonly JsonElement MixedNearestAnchoredProfile = CreateMixedNearestAnchoredProfile();
    private static JsonElement CreateMixedNearestAnchoredProfile()
    {
        var profile = JsonNode.Parse(CreateMixedLargeSelectionProfile().GetRawText())!.AsObject();
        profile["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v5";
        profile["localSearch"] = JsonNode.Parse("""
        {"policyVersion":"wfc.pf.nearest-anchored-local-search.v1","pairOrder":"nearest-anchored-axes-then-rank-sum.v1","exactStraightPreflight":true}
        """);
        return JsonSerializer.SerializeToElement(profile);
    }
    private static void ValidateNearestAnchoredDefaults()
    {
        if (new LocalConnectorOptions().UseNearestAnchoredSearch
            || LocalConnectorOptions.NearestAnchoredSearchPolicyVersion != "wfc.pf.nearest-anchored-local-search.v1")
            throw new ArgumentException("Nearest-anchored local search differs from the explicit runtime profile.");
    }
}
