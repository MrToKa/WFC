using System.Text.Json;
using System.Text.Json.Nodes;

internal static partial class Program
{
    private static readonly JsonElement MixedLargeSelectionProfile = CreateMixedLargeSelectionProfile();
    private static JsonElement CreateMixedLargeSelectionProfile()
    {
        // A distinct profile keeps v2/v3 and every historical admission exact.
        var profile = JsonNode.Parse(CreateMixedOpeningProfile().GetRawText())!.AsObject();
        profile["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v4";
        profile["qualification"]!["maximumParents"] = 2048;
        profile["qualification"]!["maximumComponents"] = 2048;
        return JsonSerializer.SerializeToElement(profile);
    }
}
