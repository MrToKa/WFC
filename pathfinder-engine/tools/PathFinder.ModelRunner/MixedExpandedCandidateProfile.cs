using System.Text.Json;
using System.Text.Json.Nodes;
using AddinRibbon.Routing;

internal static partial class Program
{
    private static readonly JsonElement MixedExpandedCandidateProfile = CreateMixedExpandedCandidateProfile();
    private static JsonElement CreateMixedExpandedCandidateProfile()
    {
        var profile = JsonNode.Parse(CreateMixedFullPairProfile().GetRawText())!.AsObject();
        profile["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v8";
        profile["routing"]!["maxCandidatesPerEnd"] = ConstrainedRoutingLimits.ExpandedCandidateLimit;
        profile["routing"]!["maxPairs"] = ConstrainedRoutingLimits.ExpandedCandidatePairAllowance;
        return JsonSerializer.SerializeToElement(profile);
    }
}
