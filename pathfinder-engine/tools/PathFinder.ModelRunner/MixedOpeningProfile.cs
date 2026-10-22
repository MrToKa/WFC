using System.Text.Json;
using System.Text.Json.Nodes;
using AddinRibbon.Routing;

internal static partial class Program
{
    private const string InterTrayManeuversJson = """
    {"policyVersion":"wfc.pf.inter-tray-opening-maneuvers.v1","maximumOffsetMetres":0.1,"radiiMetres":[0.05,0.1],"directionVersion":"normalized-lexicographic-26.v1","maximumEdgeAttempts":64,"candidateCount":52,"domain":"blocked-inter-tray-chords-only","selection":"legacy-clear-graph-first-lazy-selected-path.v1"}
    """;
    private static readonly JsonElement MixedOpeningProfile = CreateMixedOpeningProfile();
    private static JsonElement CreateMixedOpeningProfile()
    {
        var profile = JsonNode.Parse(MixedProfileJson)!.AsObject();
        profile["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v3";
        profile["interTrayManeuvers"] = JsonNode.Parse(InterTrayManeuversJson);
        return JsonSerializer.SerializeToElement(profile);
    }
    private static void ValidateInterTrayManeuverDefaults()
    {
        if (InterTrayOpeningManeuverPolicy.Version != "wfc.pf.inter-tray-opening-maneuvers.v1"
            || InterTrayOpeningManeuverPolicy.MaximumOffsetMetres != .1
            || InterTrayOpeningManeuverPolicy.MaximumEdgeAttempts != 64
            || InterTrayOpeningManeuverPolicy.CandidateCount != 52
            || InterTrayOpeningManeuverPolicy.FirstRadiusMetres != .05
            || InterTrayOpeningManeuverPolicy.SecondRadiusMetres != .1
            || InterTrayOpeningManeuverPolicy.DirectionVersion != "normalized-lexicographic-26.v1"
            || InterTrayOpeningManeuverPolicy.Domain != "blocked-inter-tray-chords-only"
            || InterTrayOpeningManeuverPolicy.Selection != "legacy-clear-graph-first-lazy-selected-path.v1")
            throw new ArgumentException("Inter-tray maneuver defaults differ from the exact runtime profile.");
    }
}
