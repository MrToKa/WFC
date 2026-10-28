using System.Text.Json;
using System.Text.Json.Nodes;
using AddinRibbon.Routing;
using PathFinder.Model;

internal static partial class Program
{
    private static readonly JsonElement MixedMeasuredFitProfile = CreateMixedMeasuredFitProfile();
    private static JsonElement CreateMixedMeasuredFitProfile()
    {
        var profile = JsonNode.Parse(CreateMixedNearestAnchoredProfile().GetRawText())!.AsObject();
        profile["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v6";
        profile["geometryFitting"] = JsonNode.Parse("""
        {"policyVersion":"wfc.pf.measured-bend-mesh-fitting.v2","modelBuildRules":"pf2.rules.v2"}
        """);
        return JsonSerializer.SerializeToElement(profile);
    }
    private static void ValidateMeasuredFitDefaults()
    {
        if (new ModelBuildRules().Version != "pf2.rules.v1" || (int)TrayGeometryFitPolicy.LegacyV1 != 0
            || (int)TrayGeometryFitPolicy.MeasuredBendV2 != 1 || FittedModelCache.MeasuredBendRulesVersion != "pf2.rules.v2"
            || FittedModelCache.MeasuredBendPolicyVersion != "wfc.pf.measured-bend-mesh-fitting.v2"
            || TrayGeometryBuilder.MeasuredBendFittingPolicyVersion != FittedModelCache.MeasuredBendPolicyVersion)
            throw new ArgumentException("Measured fitting differs from the explicit runtime profile.");
    }

    // This runs before snapshot/session/cache admission in both launch modes.
    // Exported trace v1 remains its original fitting observation, even while a
    // fresh protected calculation derives different curves from the same raw file.
    private static ModelBuildRules? EffectivePreparationRules(Request request)
    {
        bool measured = request.SchemaVersion == "pathfinder.model.runner.v2" && UsesMixedBarrierRuntime(request)
            && BarrierEqual(MixedBarrierContext(request).Value.GetProperty("profile"), MixedMeasuredFitProfile);
        if (request.Rules?.Version is { } version && version is not ("pf2.rules.v1" or FittedModelCache.MeasuredBendRulesVersion))
            throw new ArgumentException("Unknown model build rules.");
        if (measured)
        {
            if (request.Rules is not null && request.Rules.Version != FittedModelCache.MeasuredBendRulesVersion)
                throw new ArgumentException("Runtime profile v6 requires explicit rules v2 or omitted rules.");
            return request.Rules ?? new ModelBuildRules { Version = FittedModelCache.MeasuredBendRulesVersion };
        }
        if (request.Rules?.Version == FittedModelCache.MeasuredBendRulesVersion
            && (request.SchemaVersion != "pathfinder.model.runner.v1" || request.Operation != "prepare" || request.FittedTraceExport is not null))
            throw new ArgumentException("Rules v2 require runtime profile v6 or a standalone preparation diagnostic without trace export.");
        return request.Rules;
    }
}
