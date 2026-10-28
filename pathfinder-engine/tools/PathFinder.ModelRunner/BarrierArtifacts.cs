using System.Text.Json;
using PathFinder.BarrierVerifier;

internal static partial class Program
{
    private static byte[] ReadBarrierBlob(string root, string project, string intent, BarrierBlob blob, CancellationToken token)
    {
        var ancestors = new List<(string Path, BarrierFileIdentity.Identity Identity)>();
        // Check every ancestor, including those above PF_ROOT. A regular final
        // directory cannot conceal a symlink/junction in its parent chain.
        for (DirectoryInfo? ancestor = new(root); ancestor is not null; ancestor = ancestor.Parent) RememberDirectory(ancestor.FullName);
        string path = root;
        foreach (var part in new[] { "barriers", project, intent }) { path = Path.Combine(path, part); RememberDirectory(path); }
        path = Path.Combine(path, blob.Id + ".json"); var before = new FileInfo(path); CheckFile(before);
        var identity = BarrierFileIdentity.Path(path);
        if (identity.Kind != 0x8000 || identity.Links != 1 || identity.Size != (ulong)blob.Bytes) throw new ArgumentException("Barrier file links/type/size are invalid.");
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.SequentialScan);
        if (stream.Length != blob.Bytes || BarrierFileIdentity.Handle(stream.SafeFileHandle) != identity) throw new ArgumentException("Barrier blob identity changed while opening.");
        var bytes = new byte[blob.Bytes]; stream.ReadExactlyAsync(bytes, token).AsTask().GetAwaiter().GetResult();
        if (BarrierFileIdentity.Handle(stream.SafeFileHandle) != identity || BarrierFileIdentity.Path(path) != identity) throw new ArgumentException("Barrier blob identity changed while reading.");
        var after = new FileInfo(path); CheckFile(after);
        if (before.Length != after.Length || before.LastWriteTimeUtc != after.LastWriteTimeUtc || before.CreationTimeUtc != after.CreationTimeUtc
            || bytes.Length != blob.Bytes || BarrierHash(bytes) != blob.Sha256) throw new ArgumentException("Barrier blob integrity changed.");
        foreach (var ancestor in ancestors)
        {
            CheckDirectory(ancestor.Path); var afterDirectory = BarrierFileIdentity.Path(ancestor.Path);
            // Directory entry writes can change mtime/size/link count without
            // changing ownership. Compare device/inode/type, not that activity.
            if (afterDirectory.Device != ancestor.Identity.Device || afterDirectory.Inode != ancestor.Identity.Inode
                || afterDirectory.Kind != ancestor.Identity.Kind) throw new ArgumentException("Barrier ancestor identity changed.");
        }
        token.ThrowIfCancellationRequested(); return bytes;
        void RememberDirectory(string directory)
        {
            CheckDirectory(directory); var directoryIdentity = BarrierFileIdentity.Path(directory);
            if (directoryIdentity.Kind != 0x4000 || directoryIdentity.Inode == 0) throw new ArgumentException("Barrier ancestor ownership is unavailable.");
            ancestors.Add((directory, directoryIdentity));
        }
        static void CheckDirectory(string directory)
        {
            var item = new DirectoryInfo(directory);
            if (!item.Exists || item.LinkTarget is not null || (item.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new ArgumentException("Barrier ancestor must be a regular owned directory.");
        }
        void CheckFile(FileInfo file)
        {
            if (!file.Exists || file.LinkTarget is not null || (file.Attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0
                || file.Length != blob.Bytes) throw new ArgumentException("Barrier input must be the exact regular immutable blob.");
        }
    }
    private static PreparedBarriers LoadBarriers(string root, BarrierRuntimeContext context, SessionExecutionContext? session, CancellationToken token)
    {
        string key = BarrierHash(context.Value); session?.SelectBarrierKey(key);
        if (context.Snapshot.ValueKind == JsonValueKind.Null) return new(null, null);
        string project = context.Scope.GetProperty("projectId").GetString()!, intent = context.Storage.GetProperty("intentId").GetString()!;
        var manifestBytes = ReadBarrierBlob(root, project, intent, BarrierBlob.Parse(context.Storage.GetProperty("manifest")), token);
        using var manifestDoc = SessionProtocol.Parse(manifestBytes); var manifest = manifestDoc.RootElement;
        BarrierFields(manifest, "schemaVersion", "snapshotId", "scope", "registryRevision", "contentSha256", "selectedParents", "capture", "geometry", "coverage", "engineeringAccepted");
        if (BarrierString(manifest, "schemaVersion") != "wfc.pf.barrier-snapshot.v1" || BarrierUuid(manifest, "snapshotId") != BarrierString(context.Snapshot, "snapshotId")
            || !BarrierEqual(manifest.GetProperty("scope"), context.Scope) || BarrierRevision(manifest, "registryRevision") != BarrierString(context.Binding, "registryRevision")
            || BarrierDigest(manifest, "contentSha256") != BarrierDigest(context.Snapshot, "contentSha256")
            || BarrierHash(BarrierCanonical(manifest, "contentSha256")) != BarrierDigest(manifest, "contentSha256")
            || BarrierString(manifest, "coverage") != "registered-selected-objects-only" || manifest.GetProperty("engineeringAccepted").GetBoolean())
            throw new ArgumentException("Barrier published manifest identity or hash mismatch.");
        var geometry = manifest.GetProperty("geometry");
        if (BarrierString(geometry, "mode") != context.Mode) throw new ArgumentException("Barrier manifest mode differs from its reference.");
        if (context.Mode == "explicit-empty")
        {
            BarrierFields(geometry, "mode", "declarationId", "declaration", "reason"); _ = BarrierUuid(geometry, "declarationId");
            if (BarrierString(geometry, "declaration") != "administrator-declared-no-selected-barriers" || string.IsNullOrWhiteSpace(BarrierString(geometry, "reason"))
                || BarrierString(geometry, "reason").Length > 2048
                || manifest.GetProperty("selectedParents").GetArrayLength() != 0 || manifest.GetProperty("capture").ValueKind != JsonValueKind.Null)
                throw new ArgumentException("Explicit empty declaration is malformed.");
            return new(null, null);
        }
        BarrierFields(geometry, "mode", "fragments", "verification");
        var verification = geometry.GetProperty("verification");
        BarrierFields(verification, "producerVersion", "selectionClosure", "topology", "selfIntersection", "computationalMeshes", "verifiedCaptureSha256", "verificationSha256");
        var captureRef = manifest.GetProperty("capture"); BarrierFields(captureRef, "captureId", "payloadSha256");
        var captureBlob = BarrierBlob.Parse(context.Storage.GetProperty("capture"));
        if (BarrierString(verification, "producerVersion") != "wfc.pf.barrier-verifier.v1" || BarrierString(verification, "selectionClosure") != "complete-selected-scope"
            || BarrierString(verification, "topology") != "qualified-closed-consistent-two-manifold" || BarrierString(verification, "selfIntersection") != "bounded-verification-passed"
            || BarrierDigest(verification, "verifiedCaptureSha256") != captureBlob.Sha256 || BarrierDigest(captureRef, "payloadSha256") != captureBlob.Sha256
            || verification.GetProperty("computationalMeshes").GetInt32() is < 1 or > 256) throw new ArgumentException("Barrier qualification manifest does not bind its original capture.");
        _ = BarrierDigest(verification, "verificationSha256");
        if (BarrierUuid(captureRef, "captureId") != intent) throw new ArgumentException("Barrier capture does not belong to the exact published storage intent.");
        var captureBytes = ReadBarrierBlob(root, project, intent, captureBlob, token);
        // An explicit drilling request checks immutable references but performs
        // no collision query or geometric qualification and claims no clearance.
        if (context.Drill) return new(null, null);
        if (session?.BarrierCache is { } cached) return cached;
        var result = BarrierCaptureVerifier.Verify(captureBytes, cancellationToken: token);
        if (result.Qualified is null || result.Receipt.Evidence is not { } evidence || result.Receipt.CaptureSha256 != captureBlob.Sha256)
            throw new BarrierQualificationException(result.Receipt.Diagnostics.FirstOrDefault()?.Code ?? "BARRIER_QUALIFICATION_UNAVAILABLE");
        if (evidence.CaptureId != BarrierString(captureRef, "captureId") || !BarrierEqual(JsonSerializer.SerializeToElement(evidence.Scope, Json), context.Scope)
            || evidence.ComputationalMeshes != verification.GetProperty("computationalMeshes").GetInt32()) throw new ArgumentException("Requalified barrier capture differs from its published manifest.");
        using (var captureDoc = SessionProtocol.Parse(captureBytes))
        {
            var capture = captureDoc.RootElement;
            if (!BarrierEqual(capture.GetProperty("selectedParents"), manifest.GetProperty("selectedParents"))) throw new ArgumentException("Barrier selected-parent provenance mismatch.");
            var originals = capture.GetProperty("fragments").EnumerateArray().ToDictionary(value => value.GetProperty("source").GetProperty("fragmentId").GetInt32());
            var summaries = geometry.GetProperty("fragments");
            if (summaries.GetArrayLength() != originals.Count || summaries.GetArrayLength() != result.Qualified.Fragments.Count) throw new ArgumentException("Barrier fragment coverage mismatch.");
            var seen = new HashSet<int>();
            foreach (var item in summaries.EnumerateArray())
            {
                token.ThrowIfCancellationRequested(); BarrierFields(item, "source", "bounds", "mesh", "vertices", "triangles");
                int id = item.GetProperty("source").GetProperty("fragmentId").GetInt32();
                if (!seen.Add(id) || !originals.TryGetValue(id, out var original) || !BarrierEqual(item.GetProperty("source"), original.GetProperty("source"))
                    || !BarrierEqual(item.GetProperty("bounds"), original.GetProperty("bounds")) || item.GetProperty("vertices").GetInt32() != original.GetProperty("verticesMetres").GetArrayLength()
                    || item.GetProperty("triangles").GetInt32() != original.GetProperty("triangleIndices").GetArrayLength() / 3) throw new ArgumentException("Barrier fragment source or counts mismatch.");
                BarrierBlob.Validate(item.GetProperty("mesh"), 33554432);
                var mesh = JsonSerializer.SerializeToElement(new { verticesMetres = original.GetProperty("verticesMetres"), triangleIndices = original.GetProperty("triangleIndices") }, Json);
                var encoded = BarrierCanonical(mesh); var blob = BarrierBlob.Parse(item.GetProperty("mesh"));
                if (encoded.Length != blob.Bytes || BarrierHash(encoded) != blob.Sha256) throw new ArgumentException("Barrier fragment content provenance mismatch.");
            }
        }
        var memberships = result.Qualified.Meshes.Select(mesh => new BarrierMembership(mesh.Mesh.Id,
            mesh.TriangleSources.SelectMany(source => source.ParentSelectionIds).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray(),
            mesh.TriangleSources.Select(source => source.FragmentId).Distinct().Order().ToArray())).ToArray();
        var prepared = new PreparedBarriers(result.Qualified, new BarrierQualification(captureBlob.Sha256, evidence.VerificationSha256, evidence.DecompositionSha256, memberships));
        session?.StoreBarriers(prepared); return prepared;
    }
}
internal sealed record BarrierMembership(string ComputationalMeshId, string[] ParentSelectionIds, int[] FragmentIds);
internal sealed record BarrierQualification(string CaptureSha256, string PureVerificationSha256, string DecompositionSha256, BarrierMembership[] ComputationalMemberships);
internal sealed record PreparedBarriers(QualifiedBarrierCapture? Qualified, BarrierQualification? Qualification);
internal sealed class BarrierQualificationException(string code) : ArgumentException("Independent barrier qualification refused: " + code)
{ internal string Code { get; } = code; }
