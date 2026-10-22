using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Barriers;
using PathFinder.BarrierVerifier;

internal static class MixedRuntimeFixtures
{
    internal const string Policy = "wfc.pf.original-surfaces-and-qualified-solids.v2";
    internal const string Domain = "provided-original-triangle-surface-contact-and-independently-qualified-closed-solid-occupancy";
    internal static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal sealed record Stored(JsonObject Context, JsonObject Capture, JsonObject Manifest, string CapturePath, string ManifestPath,
        MixedBarrierVerificationResult? Qualified);
    internal static Fixtures.Mesh Wall() => new([Fixtures.P(0, -20, -20), Fixtures.P(0, 20, -20), Fixtures.P(0, 20, 20), Fixtures.P(0, -20, 20)], [0, 1, 2, 0, 2, 3]);
    internal static Fixtures.Mesh Ring()
    {
        BarrierPoint[] vertices = [Fixtures.P(0, -2, -2), Fixtures.P(0, 2, -2), Fixtures.P(0, 2, 2), Fixtures.P(0, -2, 2),
            Fixtures.P(0, -.6, -.8), Fixtures.P(0, .6, -.8), Fixtures.P(0, .6, .8), Fixtures.P(0, -.6, .8)];
        var indices = new List<int>();
        for (int at = 0; at < 4; at++) { int next = (at + 1) % 4; indices.AddRange([at, 4 + at, 4 + next, at, 4 + next, next]); }
        return new(vertices, indices.ToArray());
    }
    internal static JsonObject Profile()
    {
        // Independently frozen legacy fixture values, with explicit new fields;
        // never read the runner's profile or exported constants as an oracle.
        var profile = Fixtures.Profile(); profile["schemaVersion"] = "wfc.pf.barrier-runtime-profile.v2";
        var qualification = profile["qualification"]!.AsObject(); qualification.Remove("maximumComputationalMeshes");
        qualification["producerVersion"] = "wfc.pf.barrier-mixed-verifier.v2"; qualification["geometryPolicy"] = Policy; qualification["maximumComponents"] = 256;
        profile["kernel"]!["collisionVersion"] = "wfc.pf.mixed-original-triangle-centreline.v2";
        profile["kernel"]!["domain"] = Domain; profile["kernel"]!["ownTerminalExemptionsSupported"] = false; return profile;
    }
    internal static void Context(JsonObject context)
    {
        context["schemaVersion"] = "wfc.pf.barrier-runtime.v2"; context["profile"] = Profile(); context["profileSha256"] = Fixtures.Hash(Fixtures.Canonical(context["profile"]));
        var binding = context["binding"]!.AsObject(); binding["schemaVersion"] = "wfc.pf.barrier-calculation-binding.v2";
        var policy = binding["policy"]!.AsObject(); policy["schemaVersion"] = "wfc.pf.barrier-routing-policy.v2"; policy["policyVersion"] = Policy;
        policy["collisionVersion"] = "wfc.pf.mixed-original-triangle-centreline.v2"; policy["ownTerminalExemptionsSupported"] = false;
        binding["policySha256"] = Fixtures.Hash(Fixtures.Canonical(policy));
        if (binding["snapshot"] is JsonObject snapshot)
        {
            snapshot["schemaVersion"] = "wfc.pf.barrier-snapshot-reference.v2"; snapshot["geometryPolicy"] = Policy;
            if (snapshot["mode"]!.GetValue<string>() == "mesh-set") snapshot["mode"] = "mixed-mesh-set";
        }
    }
    internal static Stored Store(string root, Fixtures.Mesh? mesh, bool drill = false)
    {
        // Reuse only the original independently authored opaque-file layout and
        // unchanged capture.v1 fixture shape. New qualification is separate.
        var seed = Fixtures.Store(root, mesh is null ? null : Fixtures.Box(), drill);
        Context(seed.Context); var capture = seed.Capture; var manifest = seed.Manifest; MixedBarrierVerificationResult? qualified = null;
        if (mesh is not null)
        {
            var fragment = capture["fragments"]![0]!.AsObject();
            var vertices = new JsonArray(mesh.Vertices.Select(p => (JsonNode)Fixtures.Array([p.X, p.Y, p.Z])).ToArray());
            var indices = new JsonArray(mesh.Indices.Select(i => (JsonNode?)JsonValue.Create(i)).ToArray());
            var bounds = new JsonObject { ["minimum"] = Fixtures.Array([mesh.Vertices.Min(p => p.X), mesh.Vertices.Min(p => p.Y), mesh.Vertices.Min(p => p.Z)]),
                ["maximum"] = Fixtures.Array([mesh.Vertices.Max(p => p.X), mesh.Vertices.Max(p => p.Y), mesh.Vertices.Max(p => p.Z)]) };
            fragment["verticesMetres"] = vertices; fragment["triangleIndices"] = indices; fragment["bounds"] = bounds;
            byte[] captureBytes = Fixtures.Bytes(capture); qualified = MixedBarrierCaptureVerifier.Verify(captureBytes);
            var evidence = qualified.Receipt.Evidence ?? throw new InvalidOperationException("Independent mixed fixture refused: " + string.Join(",", qualified.Receipt.Diagnostics.Select(d => d.Code)));
            if (qualified.Qualified is null) throw new InvalidOperationException("Independent mixed kernel unavailable.");
            File.WriteAllBytes(seed.CapturePath, captureBytes); manifest["capture"]!["payloadSha256"] = Fixtures.Hash(captureBytes);
            seed.Context["storage"]!["capture"]!["sha256"] = Fixtures.Hash(captureBytes); seed.Context["storage"]!["capture"]!["bytes"] = captureBytes.Length;
            var geometry = manifest["geometry"]!.AsObject(); geometry["mode"] = "mixed-mesh-set";
            var summary = geometry["fragments"]![0]!.AsObject(); summary["bounds"] = bounds.DeepClone(); summary["vertices"] = mesh.Vertices.Length; summary["triangles"] = mesh.Indices.Length / 3;
            var meshBytes = Fixtures.Bytes(new JsonObject { ["verticesMetres"] = vertices.DeepClone(), ["triangleIndices"] = indices.DeepClone() });
            string meshId = summary["mesh"]!["blobId"]!.GetValue<string>();
            File.WriteAllBytes(Path.Combine(Path.GetDirectoryName(seed.CapturePath)!, meshId + ".json"), meshBytes); summary["mesh"] = Fixtures.Blob(meshId, meshBytes);
            geometry["verification"] = new JsonObject { ["producerVersion"] = "wfc.pf.barrier-mixed-verifier.v2", ["geometryPolicy"] = Policy,
                ["selectionClosure"] = "complete-selected-scope", ["verifiedCaptureSha256"] = Fixtures.Hash(captureBytes), ["originalGeometrySha256"] = evidence.OriginalGeometrySha256,
                // Independent protected publication digest deliberately differs
                // from pure geometry evidence, as in the existing v1 fixture.
                ["verificationSha256"] = Fixtures.Hash("independent protected frame and implementation:" + evidence.VerificationSha256), ["componentMemberships"] = JsonSerializer.SerializeToNode(evidence.ComponentMemberships, Json),
                ["engineeringAccepted"] = false, ["ownTerminalExemptionsSupported"] = false, ["authority"] = "none" };
        }
        manifest["schemaVersion"] = "wfc.pf.barrier-snapshot.v2"; manifest["geometryPolicy"] = Policy;
        manifest["ownTerminalExemptionsSupported"] = false; manifest["authority"] = "none";
        var result = new Stored(seed.Context, capture, manifest, seed.CapturePath, seed.ManifestPath, qualified); Rehash(result); return result;
    }
    internal static void Rehash(Stored stored)
    {
        stored.Manifest.Remove("contentSha256"); stored.Manifest["contentSha256"] = Fixtures.Hash(Fixtures.Canonical(stored.Manifest));
        byte[] bytes = Fixtures.Bytes(stored.Manifest); File.WriteAllBytes(stored.ManifestPath, bytes);
        stored.Context["binding"]!["snapshot"]!["contentSha256"] = stored.Manifest["contentSha256"]!.DeepClone();
        stored.Context["storage"]!["manifest"]!["sha256"] = Fixtures.Hash(bytes); stored.Context["storage"]!["manifest"]!["bytes"] = bytes.Length;
    }
    internal static JsonObject UnpublishedBypass() { var value = Fixtures.UnpublishedBypass(); Context(value); return value; }
    internal static JsonObject Protected(JsonObject request, JsonObject context)
    { var result = request.DeepClone().AsObject(); result["requestId"] = Fixtures.FreshId(); result["barriers"] = context.DeepClone(); return result; }
}
