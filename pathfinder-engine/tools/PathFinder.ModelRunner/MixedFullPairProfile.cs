using System.Text.Json;
using System.Text.Json.Nodes;

internal static partial class Program
{
    private static readonly JsonElement MixedFullPairProfile = CreateMixedFullPairProfile();
    private static JsonElement CreateMixedFullPairProfile()
    {
        var profile = JsonNode.Parse(CreateMixedMeasuredFitProfile().GetRawText())!.AsObject();
        profile["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v7";
        profile["routing"]!["maxPairs"] = 264;
        return JsonSerializer.SerializeToElement(profile);
    }
}
