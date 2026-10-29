using System.Buffers.Binary;
using System.Text.Json;

namespace PathFinder.BarrierVerifier;

/// <summary>Compiles exact covered original triangles. It grants no SDK source,
/// solid occupancy, collision, registry publication or routing authority.</summary>
public static class SurfaceCatalogCompiler
{
    private const string Domain = "wfc.pf.barrier-multipart.v2";
    private const string CompletionDomain = "wfc.pf.barrier-multipart-producer-completion.v2";

    public static SurfaceCatalogManifest Compile(SurfaceCatalogSource source, string outputDirectory,
        SurfaceCatalogLimits? limits = null, CancellationToken token = default)
    {
        ArgumentNullException.ThrowIfNull(source); limits ??= new(); SurfaceBudget.CheckLimits(limits);
        var budget = new SurfaceBudget(limits, token); budget.Check();
        if (source.Context is null || source.Context.PartIndex != 0 || source.SelectedParentCount is < 1 or > 128) SurfaceJson.Fail("SOURCE_CONTEXT");
        if (source.Context.Roots is null || source.Context.ProducerProfile is null) SurfaceJson.Fail("SOURCE_CONTEXT");
        var context = source.Context with { Roots = source.Context.Roots with { }, ProducerProfile = source.Context.ProducerProfile with { } };
        SurfaceJson.Uuid(context.IntentId);
        foreach (string h in new[] { context.ContextSha256, context.ScopeSha256, context.ProfileSha256, context.FrameSha256,
            context.Roots.Nodes, context.Roots.Fragments, context.Roots.GeometryRanges, context.Roots.Plan }) SurfaceJson.Digest(h);
        uint[] selected = ValidateScope(source, context, budget);
        using var completionDoc = ReadCompletion(source.CompletionReceiptUtf8, context, budget);
        var completion = completionDoc.RootElement; uint expectedParts = SurfaceJson.U32(completion, "partCount", (uint)limits.MaximumParts);
        if (expectedParts == 0) SurfaceJson.Fail("COMPLETION_PARTS");
        string chain = SurfaceJson.HashObject(new { domain = CompletionDomain + "/parts-seed", value = new {
            context.IntentId, context.ContextSha256, context.ScopeSha256, context.ProfileSha256, context.FrameSha256, context.Roots } });
        uint nodeCount = 0, fragmentCount = 0, rangeCount = 0, partCount = 0; ulong vertices = 0, triangles = 0, sourceVertices = 0, sourceTriangles = 0;
        using var output = new SurfaceCatalogWriter(outputDirectory, context, limits, budget);
        // Every source enumerator is disposed before final manifest creation.
        {
            byte[] nodeLookup;
            using (var nodes = new SealedRows(source.Nodes, "nodes", context, budget, limits.MaximumNodes))
            {
                nodeLookup = new byte[checked((int)nodes.RecordCount * 20)]; uint previous = 0; int selectedAt = 0;
                while (nodes.MoveNext())
                {
                    var row = nodes.Current; SurfaceJson.Fields(row, "dbId", "membershipMask"); uint dbId = SurfaceJson.U32(row, "dbId", int.MaxValue);
                    byte[] mask = Mask(row, source.SelectedParentCount);
                    if (nodeCount != 0 && dbId <= previous) SurfaceJson.Fail("NODE_ORDER"); previous = dbId;
                    int at = checked((int)nodeCount * 20); BinaryPrimitives.WriteUInt32LittleEndian(nodeLookup.AsSpan(at, 4), dbId); mask.CopyTo(nodeLookup, at + 4);
                    if (selectedAt < selected.Length && dbId > selected[selectedAt]) SurfaceJson.Fail("SELECTED_NODE_MISSING");
                    if (selectedAt < selected.Length && dbId == selected[selectedAt])
                    { if ((mask[15 - selectedAt / 8] & (1 << selectedAt % 8)) == 0) SurfaceJson.Fail("SELECTED_NODE_MEMBERSHIP"); selectedAt++; }
                    nodeCount++; budget.Spend();
                }
                if (nodeCount != nodes.Total("nodes") || selectedAt != selected.Length) SurfaceJson.Fail("NODE_TOTALS");
            }
            using var fragments = new SealedRows(source.Fragments, "fragments", context, budget, limits.MaximumFragments);
            using var ranges = new SealedRows(source.GeometryRanges, "geometry-ranges", context, budget, limits.MaximumRanges);
            using var plans = new SealedRows(source.Plan, "plan", context, budget, limits.MaximumRanges);
            if (fragments.Total("unavailable") != 0 || fragments.Total("nonTriangle") != 0) SurfaceJson.Fail("UNSUPPORTED_PRIMITIVE");
            if (plans.Total("parts") != expectedParts || plans.Total("nodeSealSha256", context.Roots.Nodes) == false
                || plans.Total("fragmentSealSha256", context.Roots.Fragments) == false || plans.Total("rangeSealSha256", context.Roots.GeometryRanges) == false)
                SurfaceJson.Fail("PLAN_ROOTS");
            bool havePlan = plans.MoveNext(); PackedFragment? currentFragment = null; uint currentOrdinal = 0, nextTriangle = 0; ulong lastRevision = 0, plannedTotal = 0;
            var coveredParents = new byte[16];
            using (var parts = source.Parts.GetEnumerator())
            {
                while (partCount < expectedParts)
                {
                    budget.Check(); if (!parts.MoveNext()) SurfaceJson.Fail("PART_MISSING");
                    var part = parts.Current ?? throw new SurfaceCatalogRefusalException("PART_REQUIRED");
                    if (part.PartIndex != partCount || part.Payload.Length is < 32 or > 33_554_432) SurfaceJson.Fail("PART_ORDER"); budget.Input(part.Payload.Length);
                    using var receiptDoc = ReadPartReceipt(part.ReceiptUtf8, context, partCount, part.Payload, budget);
                    var receipt = receiptDoc.RootElement; ulong revision = SurfaceJson.Revision(receipt, "sessionRevision");
                    if (revision <= lastRevision) SurfaceJson.Fail("PART_REVISION_ORDER"); lastRevision = revision;
                    var rows = new List<PackedExpectedRange>(); long upper = 8192;
                    while (havePlan && SurfaceJson.U32(plans.Current, "partIndex") == partCount)
                    {
                        budget.Spend(); if (rows.Count >= 8192 || !ranges.MoveNext()) SurfaceJson.Fail("RANGE_COUNT");
                        var plan = plans.Current; SurfaceJson.Fields(plan, "partIndex", "rangeOrdinal", "fragmentOrdinal", "triangleStart", "triangleCount", "referencedVertexCount", "rangeSha256", "plannedEncodedBytesUpperBound");
                        var rangeRow = ranges.Current; SurfaceJson.Fields(rangeRow, "fragmentOrdinal", "triangleStart", "triangleCount", "referencedVertexCount", "sourceVertexIdsSha256", "sourceIndicesSha256", "sourceGeometrySha256", "transformSha256", "membershipMask");
                        var placement = SurfaceJson.Dto<PackedPlanPlacement>(plan); var range = SurfaceJson.Dto<PackedGeometryRange>(rangeRow);
                        if (placement.RangeOrdinal != rangeCount || placement.FragmentOrdinal != range.FragmentOrdinal) SurfaceJson.Fail("GLOBAL_RANGE_ORDER");
                        if (currentFragment is null || range.FragmentOrdinal != currentOrdinal)
                        {
                            if (currentFragment is not null && (nextTriangle != currentFragment.SourceTriangleCount || range.FragmentOrdinal != currentOrdinal + 1)) SurfaceJson.Fail("FRAGMENT_COVERAGE");
                            if (currentFragment is null && range.FragmentOrdinal != 0 || !fragments.MoveNext()) SurfaceJson.Fail("FRAGMENT_MISSING");
                            var f = fragments.Current; SurfaceJson.Fields(f, "fragmentId", "ownerNodeOrdinal", "ownerDbId", "membershipMask", "primitive", "sourceGeometrySha256", "transformSha256", "sourceVertexCount", "sourceTriangleCount");
                            var next = SurfaceJson.Dto<PackedFragment>(f);
                            if (next.Primitive != "triangles" || next.SourceVertexCount < 3 || next.SourceTriangleCount < 1) SurfaceJson.Fail("UNSUPPORTED_PRIMITIVE");
                            if (currentFragment is not null && next.FragmentId <= currentFragment.FragmentId || next.FragmentId > int.MaxValue
                                || next.OwnerNodeOrdinal >= nodeCount) SurfaceJson.Fail("FRAGMENT_ORDER_OR_OWNER");
                            int ownerAt = checked((int)next.OwnerNodeOrdinal * 20); byte[] membership = Mask(f, source.SelectedParentCount);
                            if (BinaryPrimitives.ReadUInt32LittleEndian(nodeLookup.AsSpan(ownerAt, 4)) != next.OwnerDbId
                                || !nodeLookup.AsSpan(ownerAt + 4, 16).SequenceEqual(membership)) SurfaceJson.Fail("FRAGMENT_OWNER_MEMBERSHIP");
                            for (int i = 0; i < 16; i++) coveredParents[i] |= membership[i];
                            currentFragment = next; currentOrdinal = range.FragmentOrdinal; nextTriangle = 0; fragmentCount++;
                            sourceVertices = checked(sourceVertices + next.SourceVertexCount); sourceTriangles = checked(sourceTriangles + next.SourceTriangleCount);
                        }
                        if (range.TriangleStart != nextTriangle || (ulong)nextTriangle + range.TriangleCount > currentFragment!.SourceTriangleCount) SurfaceJson.Fail("GLOBAL_RANGE_COVERAGE");
                        nextTriangle = checked(nextTriangle + range.TriangleCount);
                        if (SurfaceJson.DomainHash(Domain + "/range", rangeRow) != placement.RangeSha256) SurfaceJson.Fail("GLOBAL_RANGE_HASH");
                        rows.Add(new() { Placement = placement, Range = range, Fragment = currentFragment! });
                        upper = checked(upper + placement.PlannedEncodedBytesUpperBound); rangeCount++;
                        vertices = checked(vertices + range.ReferencedVertexCount); triangles = checked(triangles + range.TriangleCount);
                        if (triangles > (ulong)limits.MaximumTriangles) SurfaceJson.Fail("TRIANGLE_LIMIT");
                        havePlan = plans.MoveNext();
                    }
                    if (rows.Count == 0) SurfaceJson.Fail("EMPTY_PART");
                    var expected = new PackedPartExpectedDescriptor { Part = new() { Context = context with { PartIndex = partCount }, RangeCount = (uint)rows.Count,
                        PlannedEncodedBytesUpperBound = upper }, PayloadSha256 = SurfaceJson.Digest(receipt.GetProperty("stored"), "sha256"), PayloadBytes = part.Payload.Length,
                        FrameHashInputUtf8 = source.FrameHashInputUtf8, FrameSha256 = context.FrameSha256, Ranges = rows };
                    string commandHash = SurfaceJson.Digest(receipt, "commandSha256"), receiptHash = SurfaceJson.Hash(SurfaceJson.Canonical(receipt));
                    PackedPartReader.VisitValidatedPart(part.Payload, expected,
                        range => output.Range(range, commandHash, receiptHash), triangle => output.Triangle(triangle), token: token);
                    plannedTotal = checked(plannedTotal + (ulong)upper);
                    var stored = receipt.GetProperty("stored");
                    chain = SurfaceJson.HashObject(new { domain = CompletionDomain + "/parts-step", value = new { previous = chain, part = new {
                        intentId = context.IntentId, scopeSha256 = context.ScopeSha256, profileSha256 = context.ProfileSha256, partIndex = partCount,
                        planSealSha256 = context.Roots.Plan, commandSha256 = commandHash, sessionRevision = SurfaceJson.Text(receipt, "sessionRevision"),
                        stored = new { blobId = SurfaceJson.Text(stored, "blobId"), sha256 = SurfaceJson.Text(stored, "sha256"), bytes = SurfaceJson.Number(stored, "bytes") } } } });
                    partCount++;
                }
                budget.Check(); if (parts.MoveNext()) SurfaceJson.Fail("PART_EXTRA"); budget.Check();
            }
            if (havePlan || ranges.MoveNext() || fragments.MoveNext() || currentFragment is null || nextTriangle != currentFragment.SourceTriangleCount
                || rangeCount != ranges.RecordCount || rangeCount != plans.RecordCount || fragmentCount != fragments.RecordCount) SurfaceJson.Fail("GLOBAL_EXACT_END");
            if (vertices != ranges.Total("referencedVertices") || vertices != plans.Total("referencedVertices") || triangles != ranges.Total("triangles")
                || triangles != plans.Total("triangles") || triangles != sourceTriangles || sourceTriangles != fragments.Total("sourceTriangles")
                || sourceVertices != fragments.Total("sourceVertices") || plannedTotal != plans.Total("plannedEncodedBytesUpperBound")) SurfaceJson.Fail("GLOBAL_TOTALS");
            for (int bit = 0; bit < source.SelectedParentCount; bit++) if ((coveredParents[15 - bit / 8] & (1 << bit % 8)) == 0) SurfaceJson.Fail("SELECTED_PARENT_WITHOUT_GEOMETRY");
            chain = SurfaceJson.HashObject(new { domain = CompletionDomain + "/parts-final", value = new { previous = chain, partCount } });
            if (chain != SurfaceJson.Digest(completion, "partsSha256") || SurfaceJson.Revision(completion, "sessionRevision") <= lastRevision) SurfaceJson.Fail("PRODUCER_COMPLETION_CHAIN");
        }
        budget.Check();
        return output.Complete(new(nodeCount, fragmentCount, rangeCount, partCount, 0, vertices, triangles, budget.InputBytes, 0),
            (uint)source.SelectedParentCount, SurfaceJson.Hash(SurfaceJson.Canonical(completion)), chain, source.VerifyCurrent);
    }
    private static uint[] ValidateScope(SurfaceCatalogSource source, PackedPartContext context, SurfaceBudget budget)
    {
        budget.Input(source.ScopeHashInputUtf8.Length); budget.Input(source.ProfileHashInputUtf8.Length); budget.Input(source.FrameHashInputUtf8.Length);
        SurfaceJson.HashEnvelope(source.ScopeHashInputUtf8, Domain + "/scope", context.ScopeSha256, out var scopeDoc);
        using (scopeDoc)
        {
            var scope = scopeDoc.RootElement.GetProperty("value"); SurfaceJson.Fields(scope, "schemaVersion", "modelScope", "modelLoadId", "selectedParents", "geometryPolicy");
            SurfaceJson.Literal(scope, "schemaVersion", "wfc.pf.barrier-multipart-scope.v2"); SurfaceJson.Literal(scope, "geometryPolicy", "original-triangles-structural-only.v2");
            var model = scope.GetProperty("modelScope"); SurfaceJson.Fields(model, "projectId", "modelVersionId", "contentFingerprint", "selectionRevision", "captureFrameId", "captureFrameSha256", "coordinateFrame");
            foreach (string key in new[] { "projectId", "modelVersionId", "captureFrameId" }) SurfaceJson.Uuid(SurfaceJson.Text(model, key));
            SurfaceJson.Digest(model, "contentFingerprint"); SurfaceJson.Digest(model, "captureFrameSha256"); SurfaceJson.Revision(model, "selectionRevision");
            SurfaceJson.Literal(model, "coordinateFrame", "canonical-world-metres"); SurfaceJson.Uuid(SurfaceJson.Text(scope, "modelLoadId"));
            using var frame = SurfaceJson.Parse(source.FrameHashInputUtf8, 65_536, canonical: false);
            if (SurfaceJson.Hash(source.FrameHashInputUtf8.Span) != context.FrameSha256
                || SurfaceJson.Text(frame.RootElement, "projectId") != SurfaceJson.Text(model, "projectId")
                || SurfaceJson.Text(frame.RootElement, "modelVersionId") != SurfaceJson.Text(model, "modelVersionId")
                || SurfaceJson.Text(frame.RootElement, "contentFingerprint") != SurfaceJson.Text(model, "contentFingerprint")
                || SurfaceJson.Text(frame.RootElement, "loadId") != SurfaceJson.Text(scope, "modelLoadId")) SurfaceJson.Fail("SCOPE_FRAME_BINDING");
            if (SurfaceJson.HashObject(new { coordinateFrame = frame.RootElement.GetProperty("coordinateFrame"),
                displayToWorldMetres = frame.RootElement.GetProperty("displayToWorldMetres"), globalOffsetMetres = frame.RootElement.GetProperty("globalOffsetMetres") })
                != SurfaceJson.Text(model, "captureFrameSha256")) SurfaceJson.Fail("SCOPE_FRAME_PROJECTION");
            var parents = scope.GetProperty("selectedParents"); if (parents.ValueKind != JsonValueKind.Array || parents.GetArrayLength() != source.SelectedParentCount) SurfaceJson.Fail("SELECTED_PARENTS");
            var result = new uint[source.SelectedParentCount]; int at = 0; var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var parent in parents.EnumerateArray())
            {
                SurfaceJson.Fields(parent, "selectionId", "dbId", "kind"); string id = SurfaceJson.Text(parent, "selectionId"); SurfaceJson.Uuid(id);
                string kind = SurfaceJson.Text(parent, "kind"); if (!ids.Add(id) || kind is not ("wall" or "partition" or "floor" or "ceiling" or "obstacle")) SurfaceJson.Fail("SELECTED_PARENTS");
                uint dbId = SurfaceJson.U32(parent, "dbId", int.MaxValue); if (at != 0 && dbId <= result[at - 1]) SurfaceJson.Fail("SELECTED_PARENT_ORDER"); result[at++] = dbId;
            }
            SurfaceJson.HashEnvelope(source.ProfileHashInputUtf8, Domain + "/profile", context.ProfileSha256, out var profileDoc);
            using (profileDoc)
            {
                // Pin the full existing v2 profile, not just its arbitrary digest.
                string expected = "{\"byteEnvelope\":{\"coordinateEncoding\":\"finite-binary64-preserve-signed-zero\",\"descriptorBytes\":4096,\"encoding\":\"nameless-json-upper-bound.v2\",\"maxIndexDigits\":10,\"maxNumericTokenBytes\":32,\"membershipBits\":128,\"partHeader\":8192,\"referencedVertex\":128,\"rangeDescriptor\":4096,\"sourceVertexMap\":\"ordered-original-uint32\",\"triangle\":48},\"geometryPolicy\":\"original-triangles-structural-only.v2\",\"limits\":{\"fragments\":1048576,\"nodeLookupBytes\":20971520,\"nodes\":1048576,\"pageBytes\":262144,\"pageRecords\":512,\"pages\":65536,\"parts\":1048576,\"ranges\":16777216,\"selectedParents\":128,\"sourceCount\":4294967295},\"part\":{\"bytes\":33554432,\"fragmentRefs\":8192,\"triangles\":250000,\"vertices\":500000},\"qualification\":\"NOT_MEASURED\",\"schemaVersion\":\"wfc.pf.barrier-multipart-profile.v2\"}";
                using var expectedProfile = JsonDocument.Parse(expected);
                if (!SurfaceJson.Canonical(profileDoc.RootElement.GetProperty("value")).AsSpan().SequenceEqual(SurfaceJson.Canonical(expectedProfile.RootElement))) SurfaceJson.Fail("PROFILE_BINDING");
            }
            return result;
        }
    }
    private static byte[] Mask(JsonElement value, int parents)
    {
        string text = SurfaceJson.Text(value, "membershipMask"); if (text.Length != 32 || text.Any(c => c is not (>= '0' and <= '9' or >= 'a' and <= 'f'))) SurfaceJson.Fail("MEMBERSHIP_MASK");
        byte[] bytes = Convert.FromHexString(text); if (bytes.All(b => b == 0)) SurfaceJson.Fail("MEMBERSHIP_MASK");
        for (int bit = parents; bit < 128; bit++) if ((bytes[15 - bit / 8] & (1 << bit % 8)) != 0) SurfaceJson.Fail("MEMBERSHIP_OUTSIDE_SCOPE"); return bytes;
    }
    private static JsonDocument ReadCompletion(ReadOnlyMemory<byte> bytes, PackedPartContext context, SurfaceBudget budget)
    {
        budget.Input(bytes.Length); var doc = SurfaceJson.Parse(bytes, 65_536); var c = doc.RootElement;
        try
        {
            SurfaceJson.Fields(c, "schemaVersion", "intentId", "sessionRevision", "commandSha256", "scopeSha256", "profileSha256", "contextSha256", "frameSha256", "roots", "partCount", "partsSha256", "bookendProfile", "recordedAt", "duplicate", "completionProvenance", "sdkSourceBytesVerified", "qualification", "geometryValidation", "authority");
            SurfaceJson.Literal(c, "schemaVersion", "wfc.pf.barrier-multipart-producer-completion-receipt.v2"); ScopeReceipt(c, context);
            if (SurfaceJson.Digest(c, "contextSha256") != context.ContextSha256 || SurfaceJson.Digest(c, "frameSha256") != context.FrameSha256
                || SurfaceJson.Utf8.GetString(SurfaceJson.Canonical(c.GetProperty("roots"))) != SurfaceJson.Utf8.GetString(SurfaceJson.Canonical(JsonSerializer.SerializeToElement(context.Roots, SurfaceJson.Options)))) SurfaceJson.Fail("COMPLETION_ROOTS");
            SurfaceJson.Literal(c, "bookendProfile", "sdk7130-after-final-part-ack-hierarchy-frame-v1"); SurfaceJson.Literal(c, "completionProvenance", "protected-producer-reported");
            SurfaceJson.False(c, "sdkSourceBytesVerified"); SurfaceJson.Digest(c, "partsSha256");
            string timestamp = SurfaceJson.Text(c, "recordedAt");
            if (timestamp.Length > 64 || !System.Text.RegularExpressions.Regex.IsMatch(timestamp, @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
                || !DateTimeOffset.TryParse(timestamp, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out _)) SurfaceJson.Fail("COMPLETION_TIMESTAMP"); return doc;
        }
        catch { doc.Dispose(); throw; }
    }
    private static JsonDocument ReadPartReceipt(ReadOnlyMemory<byte> bytes, PackedPartContext context, uint index, ReadOnlyMemory<byte> payload, SurfaceBudget budget)
    {
        budget.Input(bytes.Length); var doc = SurfaceJson.Parse(bytes, 65_536); var r = doc.RootElement;
        try
        {
            SurfaceJson.Fields(r, "schemaVersion", "intentId", "sessionRevision", "commandSha256", "scopeSha256", "profileSha256", "stored", "duplicate", "qualification", "geometryValidation", "authority", "kind", "partIndex", "planSealSha256");
            SurfaceJson.Literal(r, "schemaVersion", "wfc.pf.barrier-multipart-stage-receipt.v2"); SurfaceJson.Literal(r, "kind", "part"); ScopeReceipt(r, context);
            if (SurfaceJson.U32(r, "partIndex") != index || SurfaceJson.Digest(r, "planSealSha256") != context.Roots.Plan) SurfaceJson.Fail("PART_RECEIPT_BINDING");
            var stored = r.GetProperty("stored"); SurfaceJson.Fields(stored, "blobId", "sha256", "bytes", "durability"); SurfaceJson.Uuid(SurfaceJson.Text(stored, "blobId"));
            SurfaceJson.Literal(stored, "durability", "file-and-directory-fsynced");
            if (SurfaceJson.Number(stored, "bytes") != (ulong)payload.Length || SurfaceJson.Digest(stored, "sha256") != SurfaceJson.Hash(payload.Span)) SurfaceJson.Fail("PART_RECEIPT_BYTES"); return doc;
        }
        catch { doc.Dispose(); throw; }
    }
    private static void ScopeReceipt(JsonElement r, PackedPartContext context)
    {
        if (SurfaceJson.Text(r, "intentId") != context.IntentId || SurfaceJson.Digest(r, "scopeSha256") != context.ScopeSha256
            || SurfaceJson.Digest(r, "profileSha256") != context.ProfileSha256) SurfaceJson.Fail("RECEIPT_CONTEXT");
        SurfaceJson.Digest(r, "commandSha256"); SurfaceJson.Revision(r, "sessionRevision"); SurfaceJson.Bool(r, "duplicate");
        SurfaceJson.Literal(r, "qualification", "NOT_MEASURED"); SurfaceJson.Literal(r, "geometryValidation", "NOT_VALIDATED"); SurfaceJson.Literal(r, "authority", "none");
    }

    private sealed class SealedRows : IDisposable
    {
        private readonly IEnumerator<ReadOnlyMemory<byte>> pages; private readonly string kind; private readonly PackedPartContext context;
        private readonly SurfaceBudget budget; private readonly JsonDocument seal; private JsonDocument? page; private JsonElement.ArrayEnumerator records;
        private uint pageIndex, ordinal; private string? tail; private bool ended;
        internal JsonElement Current { get; private set; }
        internal uint RecordCount { get; }
        internal SealedRows(SurfaceSealedStream source, string kind, PackedPartContext context, SurfaceBudget budget, int maximum)
        {
            this.kind = kind; this.context = context; this.budget = budget; budget.Input(source.SealUtf8.Length);
            seal = SurfaceJson.Parse(source.SealUtf8, 262_144); var s = seal.RootElement;
            try
            {
                var fields = new List<string> { "schemaVersion", "scopeSha256", "profileSha256", "pageCount", "recordCount", "tailPageSha256", "sealSha256", "kind", "totals" };
                if (kind == "plan") { fields.Add("qualification"); fields.Add("authority"); SurfaceJson.Literal(s, "qualification", "NOT_MEASURED"); SurfaceJson.Literal(s, "authority", "none"); }
                SurfaceJson.Fields(s, [.. fields]); SurfaceJson.Literal(s, "schemaVersion", "wfc.pf.barrier-multipart-seal.v2"); SurfaceJson.Literal(s, "kind", kind); Bound(s);
                RecordCount = SurfaceJson.U32(s, "recordCount", (uint)maximum); uint pageCount = SurfaceJson.U32(s, "pageCount", 65_536);
                if (RecordCount == 0 || pageCount == 0 || pageCount > RecordCount || RecordCount > (ulong)pageCount * 512) SurfaceJson.Fail("SEAL_COUNTS");
                string expected = kind switch { "nodes" => context.Roots.Nodes, "fragments" => context.Roots.Fragments, "geometry-ranges" => context.Roots.GeometryRanges, _ => context.Roots.Plan };
                if (SurfaceJson.Digest(s, "sealSha256") != expected || HashWithout("seal", s, "sealSha256") != expected) SurfaceJson.Fail("SEAL_HASH");
                string[] totals = kind switch { "nodes" => ["nodes"], "fragments" => ["fragments", "sourceVertices", "sourceTriangles", "unavailable", "nonTriangle"],
                    "geometry-ranges" => ["ranges", "referencedVertices", "triangles"], _ => ["parts", "ranges", "referencedVertices", "triangles", "plannedEncodedBytesUpperBound", "nodeSealSha256", "fragmentSealSha256", "rangeSealSha256"] };
                SurfaceJson.Fields(s.GetProperty("totals"), totals);
                if (Total(kind is "nodes" or "fragments" ? kind : "ranges") != RecordCount) SurfaceJson.Fail("SEAL_RECORD_TOTAL");
                SurfaceJson.Digest(s, "tailPageSha256"); pages = source.PagesUtf8.GetEnumerator();
            }
            catch { seal.Dispose(); throw; }
        }
        internal ulong Total(string name) => SurfaceJson.Number(seal.RootElement.GetProperty("totals"), name);
        internal bool Total(string name, string expected) => SurfaceJson.Digest(seal.RootElement.GetProperty("totals"), name) == expected;
        internal bool MoveNext()
        {
            budget.Spend(); if (ended) return false;
            if (page is not null && records.MoveNext()) { Current = records.Current; ordinal++; if (ordinal > RecordCount) SurfaceJson.Fail("PAGE_RECORD_OVERFLOW"); return true; }
            page?.Dispose(); page = null;
            if (!pages.MoveNext())
            {
                ended = true; if (pageIndex != SurfaceJson.U32(seal.RootElement, "pageCount") || ordinal != RecordCount || tail != SurfaceJson.Digest(seal.RootElement, "tailPageSha256")) SurfaceJson.Fail("STREAM_EXACT_END");
                return false;
            }
            budget.Input(pages.Current.Length); if (pageIndex >= 65_536) SurfaceJson.Fail("PAGE_LIMIT"); page = SurfaceJson.Parse(pages.Current, 262_144); var p = page.RootElement;
            SurfaceJson.Fields(p, "schemaVersion", "scopeSha256", "profileSha256", "index", "firstOrdinal", "previousPageSha256", "pageSha256", "kind", "records");
            SurfaceJson.Literal(p, "schemaVersion", "wfc.pf.barrier-multipart-page.v2"); SurfaceJson.Literal(p, "kind", kind); Bound(p);
            if (SurfaceJson.U32(p, "index") != pageIndex || SurfaceJson.U32(p, "firstOrdinal") != ordinal || (tail is null
                ? p.GetProperty("previousPageSha256").ValueKind != JsonValueKind.Null : SurfaceJson.Digest(p, "previousPageSha256") != tail)) SurfaceJson.Fail("PAGE_ORDER");
            if (SurfaceJson.Digest(p, "pageSha256") != HashWithout("page", p, "pageSha256")) SurfaceJson.Fail("PAGE_HASH");
            var rows = p.GetProperty("records"); if (rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() is < 1 or > 512) SurfaceJson.Fail("PAGE_RECORDS");
            records = rows.EnumerateArray(); tail = SurfaceJson.Digest(p, "pageSha256"); pageIndex++; return MoveNext();
        }
        private void Bound(JsonElement value) { if (SurfaceJson.Digest(value, "scopeSha256") != context.ScopeSha256 || SurfaceJson.Digest(value, "profileSha256") != context.ProfileSha256) SurfaceJson.Fail("STREAM_CONTEXT"); }
        private static string HashWithout(string domain, JsonElement value, string field)
        { using var d = JsonDocument.Parse(SurfaceJson.Canonical(value, field)); return SurfaceJson.DomainHash(Domain + "/" + domain, d.RootElement); }
        public void Dispose() { try { pages.Dispose(); } finally { page?.Dispose(); seal.Dispose(); } }
    }
}
