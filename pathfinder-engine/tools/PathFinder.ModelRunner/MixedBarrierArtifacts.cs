using System.Text.Json;
using System.Text.RegularExpressions;
using PathFinder.Barriers;
using PathFinder.BarrierVerifier;

internal static partial class Program
{
    private static MixedBarrierComponentMembership[] MixedMemberships(JsonElement value, MixedBarrierRuntimeContext context)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() < 1 || value.GetArrayLength() > context.MaximumComponents || BarrierCanonical(value).Length > context.MaximumMembershipBytes)
            throw new ArgumentException("Mixed membership exceeds its complete bounded representation.");
        var result = new List<MixedBarrierComponentMembership>(); var seen = new HashSet<string>(StringComparer.Ordinal);
        var allParents = new HashSet<string>(StringComparer.Ordinal); var allFragments = new HashSet<int>(); int triangles = 0;
        foreach (var row in value.EnumerateArray())
        {
            BarrierFields(row, "componentId", "kind", "fragmentIds", "parentSelectionIds", "triangleCount", "sourceMembershipSha256");
            string id = BarrierString(row, "componentId"), kind = BarrierString(row, "kind");
            if (id.Length is < 1 or > 256 || id.Any(char.IsControl) || !seen.Add(id) || kind is not ("original-surface" or "qualified-closed-solid"))
                throw new ArgumentException("Mixed component identity/kind is invalid.");
            var fs = row.GetProperty("fragmentIds"); var ps = row.GetProperty("parentSelectionIds");
            if (fs.ValueKind != JsonValueKind.Array || fs.GetArrayLength() is < 1 or > 8192 || ps.ValueKind != JsonValueKind.Array || ps.GetArrayLength() < 1 || ps.GetArrayLength() > context.MaximumParents)
                throw new ArgumentException("Mixed component source membership is out of bounds.");
            var fragments = fs.EnumerateArray().Select(item => item.GetInt32()).ToArray();
            var parents = ps.EnumerateArray().Select(item => item.GetString() ?? throw new ArgumentException("Mixed parent UUID required.")).ToArray();
            for (int at = 0; at < fragments.Length; at++)
            {
                if (fragments[at] < 0 || at > 0 && fragments[at - 1] >= fragments[at]) throw new ArgumentException("Mixed fragments must be strictly ascending original IDs.");
                allFragments.Add(fragments[at]);
            }
            for (int at = 0; at < parents.Length; at++)
            {
                if (!Regex.IsMatch(parents[at], "^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\\z", RegexOptions.CultureInvariant)
                    || at > 0 && StringComparer.Ordinal.Compare(parents[at - 1], parents[at]) >= 0) throw new ArgumentException("Mixed parents must be strictly ascending UUIDs.");
                allParents.Add(parents[at]);
            }
            int count = row.GetProperty("triangleCount").GetInt32();
            if (count is < 1 or > 250000) throw new ArgumentException("Mixed component triangle count is invalid."); triangles = checked(triangles + count);
            result.Add(new(id, kind, Array.AsReadOnly(fragments), Array.AsReadOnly(parents), count, BarrierDigest(row, "sourceMembershipSha256")));
        }
        if (triangles > 250000 || allParents.Count > context.MaximumParents || allFragments.Count > 8192) throw new ArgumentException("Mixed aggregate membership exceeds the explicit profile capture ceilings.");
        return result.ToArray();
    }
    private static PreparedMixedBarriers LoadMixedBarriers(string root, MixedBarrierRuntimeContext context, SessionExecutionContext? session, CancellationToken token)
    {
        session?.SelectBarrierKey(BarrierHash(context.Value));
        if (context.Snapshot.ValueKind == JsonValueKind.Null) return new(null, null);
        string project = BarrierString(context.Scope, "projectId"), intent = BarrierString(context.Storage, "intentId");
        var manifestBytes = ReadBarrierBlob(root, project, intent, BarrierBlob.Parse(context.Storage.GetProperty("manifest")), token);
        using var manifestDoc = SessionProtocol.Parse(manifestBytes); var manifest = manifestDoc.RootElement;
        BarrierFields(manifest, "schemaVersion", "geometryPolicy", "snapshotId", "scope", "registryRevision", "contentSha256", "selectedParents", "capture", "geometry",
            "coverage", "engineeringAccepted", "ownTerminalExemptionsSupported", "authority");
        MixedNoAuthority(manifest);
        if (BarrierString(manifest, "schemaVersion") != "wfc.pf.barrier-snapshot.v2" || BarrierString(manifest, "geometryPolicy") != MixedBarrierKernel.PolicyVersion
            || BarrierUuid(manifest, "snapshotId") != BarrierString(context.Snapshot, "snapshotId") || !BarrierEqual(manifest.GetProperty("scope"), context.Scope)
            || BarrierRevision(manifest, "registryRevision") != BarrierString(context.Binding, "registryRevision")
            || BarrierDigest(manifest, "contentSha256") != BarrierDigest(context.Snapshot, "contentSha256")
            || BarrierHash(BarrierCanonical(manifest, "contentSha256")) != BarrierDigest(manifest, "contentSha256")
            || BarrierString(manifest, "coverage") != "registered-selected-objects-only") throw new ArgumentException("Mixed immutable manifest identity/hash mismatch.");
        var geometry = manifest.GetProperty("geometry");
        if (BarrierString(geometry, "mode") != context.Mode) throw new ArgumentException("Mixed snapshot mode mismatch.");
        var selected = manifest.GetProperty("selectedParents");
        if (context.Mode == "explicit-empty")
        {
            BarrierFields(geometry, "mode", "declarationId", "declaration", "reason"); _ = BarrierUuid(geometry, "declarationId");
            if (BarrierString(geometry, "declaration") != "administrator-declared-no-selected-barriers" || string.IsNullOrWhiteSpace(BarrierString(geometry, "reason"))
                || BarrierString(geometry, "reason").Length > 2048 || selected.ValueKind != JsonValueKind.Array || selected.GetArrayLength() != 0
                || manifest.GetProperty("capture").ValueKind != JsonValueKind.Null) throw new ArgumentException("Mixed empty declaration is malformed.");
            return new(null, null);
        }
        BarrierFields(geometry, "mode", "fragments", "verification");
        var verification = geometry.GetProperty("verification");
        BarrierFields(verification, "producerVersion", "geometryPolicy", "selectionClosure", "verifiedCaptureSha256", "originalGeometrySha256", "verificationSha256",
            "componentMemberships", "engineeringAccepted", "ownTerminalExemptionsSupported", "authority"); MixedNoAuthority(verification);
        var captureRef = manifest.GetProperty("capture"); BarrierFields(captureRef, "captureId", "payloadSha256");
        var captureBlob = BarrierBlob.Parse(context.Storage.GetProperty("capture"));
        if (BarrierString(verification, "producerVersion") != MixedBarrierCaptureVerifier.ProducerVersion || BarrierString(verification, "geometryPolicy") != MixedBarrierKernel.PolicyVersion
            || BarrierString(verification, "selectionClosure") != "complete-selected-scope" || BarrierDigest(verification, "verifiedCaptureSha256") != captureBlob.Sha256
            || BarrierDigest(captureRef, "payloadSha256") != captureBlob.Sha256 || BarrierUuid(captureRef, "captureId") != intent)
            throw new ArgumentException("Mixed qualification manifest does not bind its exact stored capture.");
        _ = BarrierDigest(verification, "originalGeometrySha256"); _ = BarrierDigest(verification, "verificationSha256");
        var memberships = MixedMemberships(verification.GetProperty("componentMemberships"), context);
        var summaries = geometry.GetProperty("fragments");
        if (selected.ValueKind != JsonValueKind.Array || selected.GetArrayLength() < 1 || selected.GetArrayLength() > context.MaximumParents
            || summaries.ValueKind != JsonValueKind.Array || summaries.GetArrayLength() is < 1 or > 8192) throw new ArgumentException("Mixed selected fragment scope is invalid.");
        var captureBytes = ReadBarrierBlob(root, project, intent, captureBlob, token);
        // Same as v1: an explicit bypass authenticates immutable supplied blobs,
        // but does not assert that geometric qualification or collision ran.
        if (context.Drill) return new(null, null);
        if (session?.MixedBarrierCache is { } cached) return cached;
        var result = MixedBarrierCaptureVerifier.Verify(captureBytes, context.VerifierLimits, cancellationToken: token, maximumReceiptBytes: context.MaximumReceiptBytes);
        if (result.Qualified is null || result.Receipt.Evidence is not { } evidence || result.Receipt.CaptureSha256 != captureBlob.Sha256)
            throw new BarrierQualificationException(result.Receipt.Diagnostics.FirstOrDefault()?.Code ?? "MIXED_QUALIFICATION_UNAVAILABLE");
        if (evidence.CaptureId != intent || !BarrierEqual(JsonSerializer.SerializeToElement(evidence.Scope, Json), context.Scope)
            || evidence.OriginalGeometrySha256 != BarrierDigest(verification, "originalGeometrySha256")
            || !BarrierEqual(JsonSerializer.SerializeToElement(evidence.ComponentMemberships, Json), verification.GetProperty("componentMemberships")))
            throw new ArgumentException("Mixed requalification differs from the exact published original component evidence.");
        // The manifest verificationSha256 is a protected frame/implementation/
        // closure digest, like v1. It is authenticated above through immutable
        // content/context hashes, not equated to the pure geometry digest from
        // a different domain. Actual pure evidence is carried in execution.
        using (var captureDoc = SessionProtocol.Parse(captureBytes))
        {
            var capture = captureDoc.RootElement;
            if (!BarrierEqual(capture.GetProperty("selectedParents"), selected)) throw new ArgumentException("Mixed selected-parent provenance mismatch.");
            var originals = capture.GetProperty("fragments").EnumerateArray().ToDictionary(item => item.GetProperty("source").GetProperty("fragmentId").GetInt32());
            if (summaries.GetArrayLength() != originals.Count || originals.Count != evidence.FragmentCount) throw new ArgumentException("Mixed original fragment coverage mismatch.");
            var seen = new HashSet<int>();
            foreach (var summary in summaries.EnumerateArray())
            {
                token.ThrowIfCancellationRequested(); BarrierFields(summary, "source", "bounds", "mesh", "vertices", "triangles");
                int id = summary.GetProperty("source").GetProperty("fragmentId").GetInt32();
                if (!seen.Add(id) || !originals.TryGetValue(id, out var original) || !BarrierEqual(summary.GetProperty("source"), original.GetProperty("source"))
                    || !BarrierEqual(summary.GetProperty("bounds"), original.GetProperty("bounds")) || summary.GetProperty("vertices").GetInt32() != original.GetProperty("verticesMetres").GetArrayLength()
                    || summary.GetProperty("triangles").GetInt32() != original.GetProperty("triangleIndices").GetArrayLength() / 3)
                    throw new ArgumentException("Mixed original fragment source/bounds/count mismatch.");
                BarrierBlob.Validate(summary.GetProperty("mesh"), 33554432); var meshRef = BarrierBlob.Parse(summary.GetProperty("mesh"));
                var mesh = JsonSerializer.SerializeToElement(new { verticesMetres = original.GetProperty("verticesMetres"), triangleIndices = original.GetProperty("triangleIndices") }, Json);
                var encoded = BarrierCanonical(mesh);
                if (encoded.Length != meshRef.Bytes || BarrierHash(encoded) != meshRef.Sha256) throw new ArgumentException("Mixed original fragment mesh digest mismatch.");
            }
        }
        // Keep the independently qualified bounded membership, never a manifest
        // reconstruction. The parsed manifest array above only validates shape.
        if (memberships.Length != evidence.ComponentMemberships.Count) throw new ArgumentException("Mixed membership count mismatch.");
        var prepared = new PreparedMixedBarriers(result.Qualified, new(captureBlob.Sha256, evidence));
        session?.StoreMixedBarriers(prepared); token.ThrowIfCancellationRequested(); return prepared;
    }
}
internal sealed record MixedBarrierQualification(string CaptureSha256, MixedBarrierVerifierEvidence Evidence);
internal sealed record PreparedMixedBarriers(MixedBarrierCapture? Qualified, MixedBarrierQualification? Qualification);
