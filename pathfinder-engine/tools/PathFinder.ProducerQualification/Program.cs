using System.Collections;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Numerics;
using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using AddinRibbon.Routing;
using PathFinder.Adapter;
using PathFinder.Model;

namespace PathFinder.ProducerQualification;

internal sealed record SnapshotInput
{
    public required string Path { get; init; }
    public required string Sha256 { get; init; }
    public required string ProjectId { get; init; }
    public required string ModelVersionId { get; init; }
    public required string ContentSha256 { get; init; }
}
internal sealed record QueryOptions
{
    public required double ConnectionToleranceMeters { get; init; }
    public required double SampleSpacingMeters { get; init; }
    public required double SecondaryDistanceMeters { get; init; }
    public required bool PreferVerticalApproach { get; init; }
    public required int MaxGraphNodes { get; init; }
    public required int MaxGraphConnections { get; init; }
    internal RoutingOptions Core() => new() { ConnectionToleranceMeters = ConnectionToleranceMeters,
        SampleSpacingMeters = SampleSpacingMeters, SecondaryDistanceMeters = SecondaryDistanceMeters,
        PreferVerticalApproach = PreferVerticalApproach, MaxGraphNodes = MaxGraphNodes, MaxGraphConnections = MaxGraphConnections };
}
internal sealed record ProjectDetails
{
    public required string Revision { get; init; }
    public required string? SecondaryTrayLength { get; init; }
    public required string EndConnectionLength { get; init; }
    public required string AdditionalBendingPercent { get; init; }
    public required string ConnectionGap { get; init; }
}
internal sealed record Query
{
    public required string Id { get; init; }
    public required string Category { get; init; }
    public required double[] From { get; init; }
    public required double[] To { get; init; }
    public required QueryOptions Options { get; init; }
    public required ProjectDetails ProjectDetails { get; init; }
}
internal sealed record Manifest
{
    public required string SchemaVersion { get; init; }
    public required SnapshotInput A { get; init; }
    public required SnapshotInput B { get; init; }
    public required Query[] Queries { get; init; }
    public required int TimeoutMilliseconds { get; init; }
}
internal sealed class QualificationFailure(string code) : Exception(code)
{
    internal string Code { get; } = code;
}

/** Diagnostic only: references the unchanged production libraries, invokes their
 * actual private graph builder, and checks its replay against public Calculate.
 * It does not instrument or claim to dump Calculate's local variables. */
internal static class Program
{
    private const int MaximumInput = 256 * 1024 * 1024, MaximumOutput = 32 * 1024 * 1024;
    private const int SummaryReserve = 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new(SnapshotReader.JsonOptions);
    private static readonly BindingFlags PrivateStatic = BindingFlags.Static | BindingFlags.NonPublic;
    private static readonly BindingFlags Fields = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
    private static readonly Type CoreType = typeof(RouteCalculator);
    private static readonly Type NodeType = Nested("Node"), PieceType = Nested("Piece"), LimitType = Nested("GraphLimit"), CostType = Nested("PathCost");
    private static long outputBytes;

    private static int Main(string[] args)
    {
        string? work = null;
        try
        {
            Need(args.Length == 4 && args[0] == "--manifest" && args[2] == "--work-root", "ARGUMENTS_REQUIRED");
            var manifestBytes = ReadFile(args[1], 256 * 1024, CancellationToken.None);
            using var document = JsonDocument.Parse(manifestBytes, new JsonDocumentOptions { MaxDepth = 48 });
            Duplicates(document.RootElement);
            var input = JsonSerializer.Deserialize<Manifest>(manifestBytes, Json) ?? throw new QualificationFailure("MANIFEST_REQUIRED");
            Validate(input);
            using var deadline = new CancellationTokenSource(input.TimeoutMilliseconds);
            var token = deadline.Token;
            var aBytes = ReadSnapshot(input.A, token); var bBytes = ReadSnapshot(input.B, token);
            var a = SnapshotReader.Read(aBytes, cancellation: token); var b = SnapshotReader.Read(bBytes, cancellation: token);
            var inputA = InputIdentity(a, token); var inputB = InputIdentity(b, token);
            Need(a.Capture.EvidenceSha256[0] != b.Capture.EvidenceSha256[0], "DISTINCT_CAPTURE_PLAN_EVIDENCE_REQUIRED");
            Need(Equal(inputA, inputB, token), "NORMALIZED_SNAPSHOT_MISMATCH");
            work = CreateWork(args[3]);
            var preparedA = new FittedModelCache(System.IO.Path.Combine(work, "cache-a")).GetOrBuild(aBytes, cancellation: token);
            var preparedB = new FittedModelCache(System.IO.Path.Combine(work, "cache-b")).GetOrBuild(bBytes, cancellation: token);
            var fittedA = FittedIdentity(preparedA, token); var fittedB = FittedIdentity(preparedB, token);
            Need(fittedA == fittedB, "FITTED_PREPARATION_MISMATCH");
            var cases = new List<object>(); var successes = 0;
            for (var index = 0; index < input.Queries.Length; index++)
            {
                token.ThrowIfCancellationRequested(); var query = input.Queries[index];
                var first = Measure(preparedA, query, System.IO.Path.Combine(work, $"query-{index:D2}-a.graph.json"), token);
                var second = Measure(preparedB, query, System.IO.Path.Combine(work, $"query-{index:D2}-b.graph.json"), token);
                Need(first.Graph.Sha256 == second.Graph.Sha256 && first.Graph.Bytes == second.Graph.Bytes, "DIAGNOSTIC_GRAPH_REPLAY_MISMATCH");
                Need(first.SemanticSha256 == second.SemanticSha256, "PUBLIC_ROUTE_DESIGN_MISMATCH");
                if (first.Success) successes++;
                cases.Add(new { query.Id, status = "PASS", effectiveCategory = Category(query.Category).ToString(),
                    first.Success, publicRouteAndDesignSha256 = first.SemanticSha256, exactDiagnosticGraphReplay = true,
                    a = first.Graph, b = second.Graph, first.Nodes, first.DirectedEdges, first.Design });
            }
            Need(successes > 0, "SUCCESSFUL_PATH_WITNESS_REQUIRED");
            token.ThrowIfCancellationRequested();
            Need(Hash(ReadFile(input.A.Path, MaximumInput, token)) == input.A.Sha256 && Hash(ReadFile(input.B.Path, MaximumInput, token)) == input.B.Sha256, "INPUT_CHANGED");
            var result = new { schemaVersion = "wfc.pf.producer-qualification-result.v1", status = "PASS", scope = "same-converted-snapshot-A-B-compatibility",
                manifestSha256 = Hash(manifestBytes), observedAtUtc = DateTimeOffset.UtcNow,
                a = new { input.A.Sha256, bytes = aBytes.Length }, b = new { input.B.Sha256, bytes = bBytes.Length },
                normalization = new { ignoredPaths = new[] { "capture.evidenceSha256" }, normalized = inputA,
                    reason = "The aggregate carries its own session-specific plan hash; source bytes remain pinned independently." },
                fittedSha256 = fittedA, engine = new { version = FittedModelCache.EngineVersion,
                    coreSha256 = Hash(ReadFile(typeof(RouteCalculator).Assembly.Location, MaximumInput, token)),
                    modelSha256 = Hash(ReadFile(typeof(FittedModelCache).Assembly.Location, MaximumInput, token)),
                    adapterSha256 = Hash(ReadFile(typeof(PathfinderAdapter).Assembly.Location, MaximumInput, token)),
                    harnessSha256 = Hash(ReadFile(typeof(Program).Assembly.Location, MaximumInput, token)) },
                checks = new { exactObjectOrder = true, exactCoordinates = true, exactCategories = true,
                    measuredDiagnosticGraphReplay = true, publicCalculateCrosscheck = true, exactPathFinderResults = true, successfulQueries = successes },
                graphObservation = "Private core graph builder and shortest-path replay; initial seed mirrors Calculate and is cross-checked against its public result. Not a live-local graph dump.",
                independentCaptureProvenance = "Required external operator evidence; distinct paths, bytes and plan hashes alone cannot prove independent A/B capture origins.",
                cases, engineeringAccepted = false, nativeParity = "not-performed", humanReviewPerformed = false,
                limitations = new[] { "Only the explicitly supplied bounded queries/categories/options were measured.",
                    "This tool neither issues producer qualification authority nor authors bindings, proposals, Review or Apply.",
                    "Identical converted geometry and results do not establish native correspondence or engineering correctness." } };
            var resultBytes = JsonSerializer.SerializeToUtf8Bytes(result, Json);
            Need(resultBytes.Length <= SummaryReserve && outputBytes + resultBytes.Length <= MaximumOutput, "OUTPUT_BUDGET");
            NewFile(System.IO.Path.Combine(work, "result.json"), resultBytes); Console.Out.WriteLine(System.Text.Encoding.UTF8.GetString(resultBytes)); return 0;
        }
        catch (Exception error)
        {
            var actual = error is TargetInvocationException { InnerException: not null } invoke ? invoke.InnerException! : error;
            var code = actual is QualificationFailure failure ? failure.Code : actual is OperationCanceledException ? "DEADLINE_EXCEEDED" : "DIAGNOSTIC_REPLAY_FAILED";
            var result = new { schemaVersion = "wfc.pf.producer-qualification-result.v1", status = "FAIL", code, workRootCreated = work is not null,
                errorType = actual.GetType().Name, engineeringAccepted = false, nativeParity = "not-performed", humanReviewPerformed = false,
                graphObservation = "No PASS is inferred from equal inputs or unavailable replay/crosscheck evidence." };
            var bytes = JsonSerializer.SerializeToUtf8Bytes(result, Json);
            if (work is not null && !File.Exists(System.IO.Path.Combine(work, "result.json")))
                try { NewFile(System.IO.Path.Combine(work, "result.json"), bytes); } catch { /* Retain any existing partial diagnostic output. */ }
            Console.Out.WriteLine(System.Text.Encoding.UTF8.GetString(bytes)); return 1;
        }
    }

    private sealed record GraphFile(string Sha256, long Bytes, string File);
    private sealed record Measurement(GraphFile Graph, string SemanticSha256, bool Success, int Nodes, long DirectedEdges, object? Design);
    private sealed record Replay(IList Nodes, IReadOnlyList<TraySegment> Eligible, int First, int Last, List<int>? Path, object Cost,
        object FromProjection, object ToProjection);
    private static Measurement Measure(PreparedModel prepared, Query query, string filename, CancellationToken token)
    {
        var from = Point(query.From); var to = Point(query.To); var category = Category(query.Category);
        var route = new RouteCalculator().Calculate(prepared.Segments, from, to, category, query.Options.Core(), token);
        var replay = BuildGraph(prepared.Segments, from, to, category, query.Options, token);
        Crosscheck(replay, from, to, query.Options, route, token);
        object? design = null;
        if (route.Success)
        {
            Need(!(route.FromRequiresSecondary || route.ToRequiresSecondary) || query.ProjectDetails.SecondaryTrayLength is not null, "SECONDARY_SETTING_REQUIRED");
            var computed = CableDesignLength.Calculate(route, Decimal(query.ProjectDetails.EndConnectionLength),
                query.ProjectDetails.SecondaryTrayLength is null ? 0 : Decimal(query.ProjectDetails.SecondaryTrayLength), Decimal(query.ProjectDetails.AdditionalBendingPercent));
            design = new { lengthBeforePercentageMeters = DecimalText(computed.LengthBeforePercentageMeters),
                unroundedLengthMeters = DecimalText(computed.UnroundedLengthMeters), designLengthMeters = DecimalText(computed.DesignLengthMeters) };
        }
        var semantic = new { route, design, effectiveCategory = category.ToString() };
        var semanticSha = HashValue(semantic, token);
        long edges = 0;
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        using var file = new FileStream(filename, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        using var bounded = new BoundedHashStream(file, hash, MaximumOutput - SummaryReserve - outputBytes, token);
        using (var writer = new Utf8JsonWriter(bounded))
        {
            writer.WriteStartObject(); writer.WriteString("schemaVersion", "wfc.pf.diagnostic-graph-replay.v1");
            writer.WriteString("observation", "actual-private-core-builder-replay-crosschecked-with-public-calculate");
            writer.WriteString("category", category.ToString()); writer.WriteNumber("firstNode", replay.First); writer.WriteNumber("lastNode", replay.Last);
            writer.WriteStartArray("eligibleSegmentIds"); foreach (var segment in replay.Eligible) writer.WriteStringValue(segment.Id); writer.WriteEndArray();
            writer.WriteStartArray("nodes");
            for (var index = 0; index < replay.Nodes.Count; index++)
            {
                token.ThrowIfCancellationRequested(); var node = replay.Nodes[index]!;
                writer.WriteStartObject(); writer.WriteNumber("index", index); writer.WriteNumber("segment", Field<int>(node, "Segment"));
                WritePoint(writer, "pointBinary64", Field<RoutePoint>(node, "Point")); writer.WriteString("alongBinary64", Bits(Field<double>(node, "Along")));
                writer.WriteStartArray("edges");
                foreach (var edge in (IEnumerable)Field<object>(node, "Edges"))
                {
                    token.ThrowIfCancellationRequested(); Need(++edges <= 2L * query.Options.MaxGraphConnections, "GRAPH_EDGE_BUDGET");
                    writer.WriteStartObject(); writer.WriteNumber("node", Field<int>(edge, "Node")); writer.WriteNumber("gapCount", Field<int>(edge, "GapCount"));
                    writer.WriteString("lengthBinary64", Bits(Field<double>(edge, "Length"))); writer.WriteString("gapDistanceBinary64", Bits(Field<double>(edge, "GapDistance")));
                    writer.WriteString("gapRank", Field<BigInteger>(edge, "GapRank").ToString(CultureInfo.InvariantCulture)); writer.WriteEndObject();
                }
                writer.WriteEndArray(); writer.WriteEndObject();
            }
            writer.WriteEndArray(); writer.WritePropertyName("pathNodeIndices"); JsonSerializer.Serialize(writer, replay.Path, Json);
            writer.WriteStartObject("pathCost"); writer.WriteNumber("gapCount", Field<int>(replay.Cost, "GapCount"));
            WritePossiblyInfinite(writer, "gapLengthBinary64", Field<double>(replay.Cost, "GapLength"));
            WritePossiblyInfinite(writer, "physicalLengthBinary64", Field<double>(replay.Cost, "PhysicalLength"));
            writer.WriteString("gapRank", Field<BigInteger>(replay.Cost, "GapRank").ToString(CultureInfo.InvariantCulture)); writer.WriteEndObject();
            writer.WriteString("publicRouteAndDesignSha256", semanticSha); writer.WritePropertyName("publicResult"); WriteCanonical(writer, JsonSerializer.SerializeToElement(semantic, Json), token);
            writer.WriteBoolean("publicCalculateCrosscheck", true); writer.WriteBoolean("engineeringAccepted", false); writer.WriteEndObject(); writer.Flush();
        }
        file.Flush(true); outputBytes += bounded.Bytes;
        return new(new GraphFile(Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(), bounded.Bytes, System.IO.Path.GetFileName(filename)),
            semanticSha, route.Success, replay.Nodes.Count, edges, design);
    }

    private static Replay BuildGraph(IReadOnlyList<TraySegment> trays, RoutePoint from, RoutePoint to, CableCategory category, QueryOptions options, CancellationToken token)
    {
        // Diagnostic initial seed only. Projection/contact/shortest-path mathematics
        // are always invoked from the loaded, unchanged production Core assembly.
        var eligible = trays.Where(tray => (tray.AllowedCategories & category) == category).ToList();
        eligible.Sort((left, right) => StringComparer.Ordinal.Compare(left.Id, right.Id));
        Need(eligible.Count > 0 && eligible.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count() == eligible.Count, "ELIGIBLE_ROUTING_REQUIRED");
        var first = Invoke("FindNearest", [eligible, from, token])!; var last = Invoke("FindNearest", [eligible, to, token])!;
        Need(double.IsFinite(Field<double>(first, "Distance")) && double.IsFinite(Field<double>(last, "Distance")), "ENDPOINT_DISTANCE_INVALID");
        if (options.PreferVerticalApproach)
        {
            first = Invoke("FindVerticalApproach", [eligible, from, first, options.ConnectionToleranceMeters, token])!;
            last = Invoke("FindVerticalApproach", [eligible, to, last, options.ConnectionToleranceMeters, token])!;
        }
        var nodes = ListOf(NodeType); var pieces = ListOf(PieceType); var segmentNodes = new List<List<int>>();
        var firstNode = -1; var lastNode = -1;
        for (var segmentIndex = 0; segmentIndex < eligible.Count; segmentIndex++)
        {
            token.ThrowIfCancellationRequested(); var tray = eligible[segmentIndex]; var pieceOffset = pieces.Count;
            var vertices = new List<(double Along, RoutePoint Point)>(); var ordered = new List<int>(); segmentNodes.Add(ordered); double along = 0;
            for (var part = 0; part < tray.Points.Count - 1; part++)
            {
                token.ThrowIfCancellationRequested(); var start = tray.Points[part]; var end = tray.Points[part + 1]; var length = start.DistanceTo(end);
                Need(double.IsFinite(length), "PIECE_LENGTH_INVALID");
                if (length > 0) pieces.Add(New(PieceType, [segmentIndex, start, end, along, length, tray.ConnectionsAtEndsOnly, pieces.Count == pieceOffset, tray.VerifiedPorts, tray.ConnectionSurfaces]));
                vertices.Add((along, start)); along += length;
            }
            if (pieces.Count == pieceOffset) pieces.Add(New(PieceType, [segmentIndex, tray.Points[0], tray.Points[0], 0d, 0d, tray.ConnectionsAtEndsOnly, true, tray.VerifiedPorts, tray.ConnectionSurfaces]));
            var lastPiece = pieces[pieces.Count - 1]!; Instance(lastPiece, "SetEndPort"); pieces[pieces.Count - 1] = lastPiece;
            vertices.Add((along, tray.Points[tray.Points.Count - 1]));
            if (Field<int>(first, "Segment") == segmentIndex) vertices.Add((Field<double>(first, "Along"), Field<RoutePoint>(first, "Point")));
            if (Field<int>(last, "Segment") == segmentIndex) vertices.Add((Field<double>(last, "Along"), Field<RoutePoint>(last, "Point")));
            vertices.Sort((left, right) => left.Along.CompareTo(right.Along)); var previous = -1; var previousAlong = double.NaN;
            foreach (var vertex in vertices)
            {
                token.ThrowIfCancellationRequested(); int index;
                if (previous >= 0 && vertex.Along == previousAlong) index = previous;
                else
                {
                    Need(nodes.Count < options.MaxGraphNodes, "GRAPH_NODE_BUDGET"); index = nodes.Count;
                    nodes.Add(New(NodeType, [vertex.Point, segmentIndex, vertex.Along])); ordered.Add(index); previous = index; previousAlong = vertex.Along;
                }
                if (Field<int>(first, "Segment") == segmentIndex && vertex.Along == Field<double>(first, "Along")) firstNode = index;
                if (Field<int>(last, "Segment") == segmentIndex && vertex.Along == Field<double>(last, "Along")) lastNode = index;
            }
        }
        Need(firstNode >= 0 && lastNode >= 0, "ENDPOINT_NODE_MISSING");
        object?[] graphArgs = [nodes, pieces, segmentNodes, options.ConnectionToleranceMeters, options.MaxGraphNodes, options.MaxGraphConnections, token, Activator.CreateInstance(LimitType)];
        Need(Invoke("AddNeighbourConnections", graphArgs) is true, "CORE_GRAPH_LIMIT");
        Need(string.Equals(graphArgs[7]?.ToString(), "None", StringComparison.Ordinal), "CORE_GRAPH_LIMIT");
        object?[] pathArgs = [nodes, firstNode, lastNode, token, Activator.CreateInstance(CostType)];
        var path = (List<int>?)Invoke("ShortestPath", pathArgs); token.ThrowIfCancellationRequested();
        return new(nodes, eligible, firstNode, lastNode, path, pathArgs[4]!, first, last);
    }

    private static void Crosscheck(Replay replay, RoutePoint from, RoutePoint to, QueryOptions options, RouteResult actual, CancellationToken token)
    {
        var first = replay.FromProjection; var last = replay.ToProjection;
        if (replay.Path is null)
        {
            var message = "Selected From tray " + replay.Eligible[Field<int>(first, "Segment")].RouteCode + " (" + Field<double>(first, "Distance").ToString("0.###", CultureInfo.InvariantCulture) +
                " m from object) and To tray " + replay.Eligible[Field<int>(last, "Segment")].RouteCode + " (" + Field<double>(last, "Distance").ToString("0.###", CultureInfo.InvariantCulture) +
                " m from object) are disconnected at " + options.ConnectionToleranceMeters.ToString("0.###", CultureInfo.InvariantCulture) + " m connection tolerance. Check route assignments and geometry between these trays.";
            Need(!actual.Success && actual.Message == message && actual.RouteCodes.Count == 0 && actual.SegmentIds.Count == 0 && actual.PathPoints.Count == 0 &&
                actual.RouteText == "" && actual.LengthMeters == 0 && actual.FromDistanceMeters == 0 && actual.ToDistanceMeters == 0 && !actual.FromRequiresSecondary &&
                !actual.ToRequiresSecondary && actual.ConnectionGapCount == 0 && actual.ConnectionGapLengthMeters == 0, "PUBLIC_DISCONNECTED_CROSSCHECK_FAILED"); return;
        }
        var codes = new List<string>(); var ids = new List<string>(); var points = new List<RoutePoint> { from };
        var fromSecondary = Field<double>(first, "Distance") > options.SecondaryDistanceMeters;
        var toSecondary = Field<double>(last, "Distance") > options.SecondaryDistanceMeters;
        if (fromSecondary) codes.Add("/SECONDARY");
        foreach (var index in replay.Path)
        {
            token.ThrowIfCancellationRequested(); var node = replay.Nodes[index]!; var segment = replay.Eligible[Field<int>(node, "Segment")];
            Append(codes, segment.RouteCode); Append(ids, segment.Id); AppendPoint(points, Field<RoutePoint>(node, "Point"));
        }
        AppendPoint(points, to); if (toSecondary) codes.Add("/SECONDARY");
        var length = Field<double>(replay.Cost, "PhysicalLength") + Field<double>(first, "Distance") + Field<double>(last, "Distance");
        Need(actual.Success && actual.Message == "Path calculated." && actual.RouteText == string.Concat(codes) && actual.RouteCodes.SequenceEqual(codes) && actual.SegmentIds.SequenceEqual(ids) &&
            actual.PathPoints.Count == points.Count && actual.PathPoints.Zip(points).All(pair => SamePoint(pair.First, pair.Second)) &&
            Bits(actual.LengthMeters) == Bits(length) && Bits(actual.FromDistanceMeters) == Bits(Field<double>(first, "Distance")) &&
            Bits(actual.ToDistanceMeters) == Bits(Field<double>(last, "Distance")) && actual.FromRequiresSecondary == fromSecondary && actual.ToRequiresSecondary == toSecondary &&
            actual.ConnectionGapCount == Field<int>(replay.Cost, "GapCount") && Bits(actual.ConnectionGapLengthMeters) == Bits(Field<double>(replay.Cost, "GapLength")), "PUBLIC_CALCULATE_CROSSCHECK_FAILED");
    }

    private static object InputIdentity(ModelSnapshot snapshot, CancellationToken token)
    {
        Need(snapshot.Capture.AdapterVersion == "wfc.project-preparation-aggregate.v1" && snapshot.Capture.SourceKind == "converted" &&
            !snapshot.Capture.InventoryComplete && !snapshot.Capture.GeometryComplete && !snapshot.Capture.UnitsVerified && !snapshot.Capture.TransformsVerified &&
            !snapshot.Capture.PlanningVisibilityKnown && !snapshot.Capture.SourceLinkVerified && snapshot.Capture.LookupRouteCodes is null && snapshot.Capture.InputScope is null &&
            snapshot.Capture.EvidenceSha256.Length == 1, "AGGREGATE_CAPTURE_REQUIRED");
        var normalized = snapshot with { Capture = snapshot.Capture with { EvidenceSha256 = [] } };
        return new { normalizedSnapshotSha256 = HashValue(normalized, token), modelSha256 = HashValue(snapshot.Model, token),
            coordinatesSha256 = HashValue(snapshot.Coordinates, token), objectOrderSha256 = HashValue(snapshot.Objects.Select(item => item.Id).ToArray(), token),
            categoriesSha256 = HashValue(snapshot.Objects.Select(item => new { item.Id, item.AllowedCategories, item.CategoryAssignmentSource, item.RouteName, item.ShapeName }).ToArray(), token),
            objects = snapshot.Objects.Length, routingLeaves = snapshot.Objects.Count(item => item.GeometryRole == "routing-leaf") };
    }
    private static string FittedIdentity(PreparedModel model, CancellationToken token) => HashValue(new { model.ProjectId, model.ModelVersionId, model.ContentSha256, model.RulesSha256,
        model.Readiness, model.Counts, model.Diagnostics, model.Objects,
        segments = model.Segments.Select(segment => new { segment.Id, segment.Name, segment.RouteCode, segment.AllowedCategories, segment.Points,
            segment.ConnectionsAtEndsOnly, segment.VerifiedPorts, surfaces = segment.ConnectionSurfaces.Select(surface => new { surface.Minimum, surface.Maximum, surface.TriangleCount }).ToArray() }).ToArray() }, token);
    private static Type Nested(string name) => CoreType.GetNestedType(name, BindingFlags.NonPublic) ?? throw new QualificationFailure("CORE_REFLECTION_SHAPE_CHANGED");
    private static IList ListOf(Type item) => (IList)(Activator.CreateInstance(typeof(List<>).MakeGenericType(item)) ?? throw new QualificationFailure("CORE_REFLECTION_SHAPE_CHANGED"));
    private static T Field<T>(object value, string name) => (T)(value.GetType().GetField(name, Fields)?.GetValue(value) ?? throw new QualificationFailure("CORE_REFLECTION_SHAPE_CHANGED"));
    private static object New(Type type, object?[] args)
    {
        var constructors = type.GetConstructors(Fields).Where(item => item.GetParameters().Length == args.Length).ToArray();
        Need(constructors.Length == 1, "CORE_REFLECTION_SHAPE_CHANGED"); return constructors[0].Invoke(args);
    }
    private static object? Invoke(string name, object?[] args)
    {
        var method = CoreType.GetMethod(name, PrivateStatic) ?? throw new QualificationFailure("CORE_REFLECTION_SHAPE_CHANGED");
        try { return method.Invoke(null, args); }
        catch (TargetInvocationException error) when (error.InnerException is not null) { ExceptionDispatchInfo.Capture(error.InnerException).Throw(); throw; }
    }
    private static void Instance(object value, string name) => (value.GetType().GetMethod(name, Fields) ?? throw new QualificationFailure("CORE_REFLECTION_SHAPE_CHANGED")).Invoke(value, null);
    private static bool SamePoint(RoutePoint a, RoutePoint b) => Bits(a.X) == Bits(b.X) && Bits(a.Y) == Bits(b.Y) && Bits(a.Z) == Bits(b.Z);
    private static void Append(List<string> values, string value) { if (values.Count == 0 || !StringComparer.Ordinal.Equals(values[values.Count - 1], value)) values.Add(value); }
    private static void AppendPoint(List<RoutePoint> values, RoutePoint value) { if (values.Count == 0 || values[values.Count - 1].DistanceTo(value) > 0) values.Add(value); }
    private static RoutePoint Point(double[] values) => new(values[0], values[1], values[2]);
    private static CableCategory Category(string value) => value switch { "MV" => CableCategory.MV, "LV" => CableCategory.LV, "Control" or "Instrumentation" => CableCategory.Control, _ => throw new QualificationFailure("CATEGORY_REQUIRED") };
    private static string Bits(double value) { Need(double.IsFinite(value), "NONFINITE_MEASUREMENT"); return unchecked((ulong)BitConverter.DoubleToInt64Bits(value)).ToString("x16", CultureInfo.InvariantCulture); }
    private static void WritePoint(Utf8JsonWriter writer, string name, RoutePoint point) { writer.WriteStartArray(name); writer.WriteStringValue(Bits(point.X)); writer.WriteStringValue(Bits(point.Y)); writer.WriteStringValue(Bits(point.Z)); writer.WriteEndArray(); }
    private static void WritePossiblyInfinite(Utf8JsonWriter writer, string name, double value)
    { if (double.IsPositiveInfinity(value)) writer.WriteString(name, "positive-infinity-unreachable"); else writer.WriteString(name, Bits(value)); }
    private static decimal Decimal(string value)
    {
        Need(value.Length is > 0 and <= 100 && Regex.IsMatch(value, "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$", RegexOptions.CultureInvariant), "PROJECT_DETAILS_DECIMAL_REQUIRED");
        try
        {
            // Use the production converter's coefficient/scale proof. Decimal
            // TryParse alone can silently round precision or underflow to zero.
            var parsed = JsonSerializer.Deserialize<decimal>(JsonSerializer.SerializeToUtf8Bytes(value), PathfinderAdapter.JsonOptions);
            Need(parsed >= 0, "PROJECT_DETAILS_DECIMAL_REQUIRED"); return parsed;
        }
        catch (JsonException) { throw new QualificationFailure("PROJECT_DETAILS_DECIMAL_REQUIRED"); }
    }
    private static string DecimalText(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
    private static void Validate(Manifest input)
    {
        Need(input.SchemaVersion == "wfc.pf.producer-qualification-input.v1" && input.TimeoutMilliseconds is >= 100 and <= 120000 &&
            input.A is not null && input.B is not null && input.Queries is { Length: >= 1 and <= 32 }, "MANIFEST_BOUNDS");
        foreach (var snapshot in new[] { input.A, input.B })
        {
            Need(snapshot.Path is not null && Regex.IsMatch(snapshot.Sha256 ?? "", "^[a-f0-9]{64}$") && Regex.IsMatch(snapshot.ContentSha256 ?? "", "^[a-f0-9]{64}$") &&
                Guid.TryParseExact(snapshot.ProjectId, "D", out _) && Guid.TryParseExact(snapshot.ModelVersionId, "D", out _), "SNAPSHOT_IDENTITY_REQUIRED"); SafePath(snapshot.Path);
        }
        Need(input.A.ProjectId == input.B.ProjectId && input.A.ModelVersionId == input.B.ModelVersionId && input.A.ContentSha256 == input.B.ContentSha256, "MODEL_IDENTITY_MISMATCH");
        Need(!string.Equals(System.IO.Path.GetFullPath(input.A.Path), System.IO.Path.GetFullPath(input.B.Path), OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal) &&
            input.A.Sha256 != input.B.Sha256, "DISTINCT_CAPTURE_INPUTS_REQUIRED");
        Need(input.Queries.Select(query => query.Id).Distinct(StringComparer.Ordinal).Count() == input.Queries.Length, "QUERY_ID_DUPLICATE");
        foreach (var query in input.Queries)
        {
            Need(query is not null && query.Id is { Length: > 0 and <= 100 } && !query.Id.Any(char.IsControl) && query.Options is not null && query.ProjectDetails is not null, "QUERY_REQUIRED");
            _ = Category(query.Category);
            foreach (var point in new[] { query.From, query.To }) Need(point is { Length: 3 } && point.All(value => double.IsFinite(value) && Math.Abs(value) <= 1e9), "ENDPOINT_REQUIRED");
            var o = query.Options;
            Need(double.IsFinite(o.ConnectionToleranceMeters) && o.ConnectionToleranceMeters is > 0 and <= 100 && double.IsFinite(o.SampleSpacingMeters) && o.SampleSpacingMeters is > 0 and <= 100 &&
                double.IsFinite(o.SecondaryDistanceMeters) && o.SecondaryDistanceMeters is >= 0 and <= 1000000 && o.MaxGraphNodes is >= 2 and <= 1000000 && o.MaxGraphConnections is >= 1 and <= 4000000, "OPTIONS_BOUNDS");
            var details = query.ProjectDetails;
            Need(details.Revision is { Length: > 0 and <= 19 } && long.TryParse(details.Revision, NumberStyles.None, CultureInfo.InvariantCulture, out var revision) && revision >= 0, "PROJECT_DETAILS_REVISION_REQUIRED");
            if (details.SecondaryTrayLength is not null) _ = Decimal(details.SecondaryTrayLength);
            _ = Decimal(details.EndConnectionLength); _ = Decimal(details.AdditionalBendingPercent); _ = Decimal(details.ConnectionGap);
            Need(double.TryParse(details.ConnectionGap, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var gap) && Bits(gap) == Bits(o.ConnectionToleranceMeters), "PROJECT_DETAILS_GAP_MISMATCH");
        }
    }
    private static byte[] ReadSnapshot(SnapshotInput input, CancellationToken token)
    {
        var bytes = ReadFile(input.Path, MaximumInput, token); Need(Hash(bytes) == input.Sha256, "SNAPSHOT_HASH_MISMATCH");
        var snapshot = SnapshotReader.Read(bytes, cancellation: token);
        Need(snapshot.Model.ProjectId == input.ProjectId && snapshot.Model.ModelVersionId == input.ModelVersionId && snapshot.Model.ContentSha256 == input.ContentSha256, "SNAPSHOT_IDENTITY_MISMATCH"); return bytes;
    }
    private static byte[] ReadFile(string filename, int maximum, CancellationToken token)
    {
        SafePath(filename); var info = new FileInfo(filename); Need(info.Exists && info.Length > 0 && info.Length <= maximum, "INPUT_FILE_BUDGET");
        using var stream = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var output = new MemoryStream(); var buffer = new byte[65536]; int count;
        while ((count = stream.Read(buffer)) > 0) { token.ThrowIfCancellationRequested(); Need(output.Length + count <= maximum, "INPUT_FILE_BUDGET"); output.Write(buffer, 0, count); }
        Need(output.Length == info.Length, "INPUT_FILE_CHANGED"); return output.ToArray();
    }
    private static void SafePath(string filename)
    {
        Need(!string.IsNullOrWhiteSpace(filename) && System.IO.Path.IsPathFullyQualified(filename), "ABSOLUTE_PATH_REQUIRED");
        for (var current = System.IO.Path.GetFullPath(filename); current is not null; current = System.IO.Path.GetDirectoryName(current))
            if (File.Exists(current) || Directory.Exists(current)) Need((File.GetAttributes(current) & FileAttributes.ReparsePoint) == 0, "REPARSE_PATH_REFUSED");
    }
    private static string CreateWork(string root)
    {
        SafePath(root); var full = System.IO.Path.GetFullPath(root); Need(!File.Exists(full) && !Directory.Exists(full) && System.IO.Path.GetDirectoryName(full) is string parent && Directory.Exists(parent), "FRESH_WORK_ROOT_REQUIRED");
        Directory.CreateDirectory(full); NewFile(System.IO.Path.Combine(full, ".producer-qualification-owned"), JsonSerializer.SerializeToUtf8Bytes(new { schemaVersion = "wfc.pf.producer-qualification-work.v1", nonce = Guid.NewGuid() }, Json)); return full;
    }
    private static void NewFile(string filename, ReadOnlySpan<byte> bytes)
    { SafePath(filename); Need(outputBytes + bytes.Length <= MaximumOutput, "OUTPUT_BUDGET"); using var stream = new FileStream(filename, FileMode.CreateNew, FileAccess.Write, FileShare.None); stream.Write(bytes); stream.Flush(true); outputBytes += bytes.Length; }
    private static void Need([DoesNotReturnIf(false)] bool value, string code) { if (!value) throw new QualificationFailure(code); }
    private static string Hash(ReadOnlySpan<byte> value) => Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
    private static bool Equal(object a, object b, CancellationToken token) => HashValue(a, token) == HashValue(b, token);
    private static string HashValue(object value, CancellationToken token)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        using var output = new BoundedHashStream(Stream.Null, hash, 1024L * 1024 * 1024, token);
        using (var writer = new Utf8JsonWriter(output)) { WriteCanonical(writer, JsonSerializer.SerializeToElement(value, Json), token); writer.Flush(); }
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }
    private static void WriteCanonical(Utf8JsonWriter writer, JsonElement value, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (value.ValueKind == JsonValueKind.Object)
        { writer.WriteStartObject(); foreach (var member in value.EnumerateObject().OrderBy(item => item.Name, StringComparer.Ordinal)) { writer.WritePropertyName(member.Name); WriteCanonical(writer, member.Value, token); } writer.WriteEndObject(); }
        else if (value.ValueKind == JsonValueKind.Array) { writer.WriteStartArray(); foreach (var child in value.EnumerateArray()) WriteCanonical(writer, child, token); writer.WriteEndArray(); }
        else if (value.ValueKind == JsonValueKind.Number) { writer.WriteStartObject(); writer.WriteString("binary64", Bits(value.GetDouble())); writer.WriteEndObject(); }
        else value.WriteTo(writer);
    }
    private static void Duplicates(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        { var names = new HashSet<string>(StringComparer.Ordinal); foreach (var property in value.EnumerateObject()) { Need(names.Add(property.Name), "DUPLICATE_JSON_MEMBER"); Duplicates(property.Value); } }
        else if (value.ValueKind == JsonValueKind.Array) foreach (var child in value.EnumerateArray()) Duplicates(child);
    }
    private sealed class BoundedHashStream(Stream target, IncrementalHash hash, long maximum, CancellationToken token) : Stream
    {
        internal long Bytes { get; private set; }
        public override void Write(ReadOnlySpan<byte> buffer) { token.ThrowIfCancellationRequested(); Need(maximum >= 0 && Bytes + buffer.Length <= maximum, "OUTPUT_BUDGET"); target.Write(buffer); hash.AppendData(buffer); Bytes += buffer.Length; }
        public override void Write(byte[] buffer, int offset, int count) => Write(buffer.AsSpan(offset, count));
        public override void Flush() => target.Flush();
        public override bool CanRead => false; public override bool CanSeek => false; public override bool CanWrite => true;
        public override long Length => Bytes; public override long Position { get => Bytes; set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
    }
}
