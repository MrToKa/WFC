using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using System.Globalization;
using System.Buffers;
using System.Numerics;
using System.Text;
using AddinRibbon.Routing;

namespace PathFinder.Adapter;

/// <summary>Offline boundary only. The caller owns the trust and authorization of settings snapshots.</summary>
public static class PathfinderAdapter
{
    public const int MaximumRequestBytes = 8 * 1024 * 1024;
    public const int MaximumResponseBytes = 32 * 1024 * 1024;
    public const int MaximumTimeoutMilliseconds = 60_000;
    public static JsonSerializerOptions JsonOptions { get; } = CreateJsonOptions();

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = false,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
            MaxDepth = 48,
            NumberHandling = JsonNumberHandling.Strict,
            TypeInfoResolver = new DefaultJsonTypeInfoResolver()
        };
        options.Converters.Add(new JsonStringEnumConverter());
        options.Converters.Add(new ExactDecimalConverter());
        options.MakeReadOnly();
        return options;
    }

    /// <summary>The in-process API is cooperatively cancellable. Use LocalRunner for a hard process deadline.</summary>
    public static AdapterResponse Execute(ReadOnlyMemory<byte> utf8, CancellationToken cancellationToken = default)
    {
        EngineRequest? request = null;
        using var deadline = new CancellationTokenSource();
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadline.Token);
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (utf8.Length == 0 || utf8.Length > MaximumRequestBytes)
                throw new BoundaryException("resource_limit", "Request must contain 1 to 8388608 UTF-8 bytes.");
            using (var document = JsonDocument.Parse(utf8, new JsonDocumentOptions { MaxDepth = 48 }))
                RejectDuplicateMembers(document.RootElement, cancellationToken);
            request = JsonSerializer.Deserialize<EngineRequest>(utf8.Span, JsonOptions)
                ?? throw new ArgumentException("Request cannot be null.");
            ValidateEnvelope(request);
            deadline.CancelAfter(request.TimeoutMilliseconds);
            var token = linked.Token;
            var budget = new WorkBudget(token);
            var options = ToOptions(request.Options);
            var response = new AdapterResponse
            {
                RequestId = request.RequestId, Operation = request.Operation, Status = "calculated", Message = "Calculation completed.",
                ProjectSettings = request.ProjectSettings
            };

            if (request.Operation == "parse")
            {
                var codes = RouteLookupCalculator.Parse(RouteText(request.RouteText));
                token.ThrowIfCancellationRequested();
                return response with { Status = "parsed", Message = "Route codes parsed.", ParsedCodes = codes };
            }
            if (request.Operation == "name")
            {
                var names = request.Names ?? throw new ArgumentException("names is required.");
                if (names.Length is < 1 or > 256) throw new BoundaryException("resource_limit", "names count must be 1 to 256.");
                foreach (var name in names) Text(name, "name", 1024, allowEmpty: true);
                var resolved = RouteNameResolver.Resolve(names);
                token.ThrowIfCancellationRequested();
                return response with { Status = "resolved", Message = "Route name resolved.", ResolvedName = resolved, OwnerIndex = RouteNameResolver.OwnerIndex(names) };
            }

            IReadOnlyList<TraySegment> segments;
            GeometrySummary? summary = null;
            if (request.Operation is "geometry" or "geometry-route")
            {
                var values = request.Geometry ?? throw new ArgumentException("geometry is required.");
                if (values.Length is < 1 or > 2048) throw new BoundaryException("resource_limit", "geometry count must be 1 to 2048.");
                var ids = new HashSet<string>(StringComparer.Ordinal);
                var inputs = values.Select(value => ToGeometry(value, ids, budget)).ToArray();
                var built = TrayGeometryBuilder.Build(inputs, token);
                segments = built.Segments;
                summary = new GeometrySummary(built.Segments.Select(s => new SegmentSummary(s.Id, s.Name, s.RouteCode,
                    s.AllowedCategories, s.Points, s.ConnectionsAtEndsOnly, s.VerifiedPorts, s.ConnectionSurfaces.Count)).ToArray(),
                    built.ValidatedBends, built.FallbackBends, built.ValidatedStraights, built.FallbackStraights,
                    built.FallbackClearances, built.Diagnostics);
                token.ThrowIfCancellationRequested();
                if (request.Operation == "geometry")
                    return response with { Status = "geometry_ready", Message = "Geometry built; real-model equivalence is not established by this operation.", Geometry = summary };
            }
            else
            {
                var values = request.Segments ?? throw new ArgumentException("segments is required.");
                if (values.Length is < 1 or > 4096) throw new BoundaryException("resource_limit", "segments count must be 1 to 4096.");
                var ids = new HashSet<string>(StringComparer.Ordinal);
                segments = values.Select(value => ToSegment(value, ids, budget)).ToArray();
            }

            RouteResult route;
            string? category = null;
            if (request.Operation == "lookup")
                route = RouteLookupCalculator.Calculate(segments, RouteLookupCalculator.Parse(RouteText(request.RouteText)), options, token);
            else
            {
                var mapped = MapCategory(request.Category, "category_required");
                category = mapped.ToString();
                route = new RouteCalculator().Calculate(segments, Point(request.From, budget), Point(request.To, budget), mapped, options, token);
            }
            token.ThrowIfCancellationRequested();
            if (request.Reverse) route = route.Reverse();
            response = response with { Route = route, Geometry = summary, EffectiveCategory = category };
            if (!route.Success)
                return response with { Status = IsCoreResourceLimit(route.Message) ? "resource_limit" : "no_path", Message = route.Message };
            if (request.Operation == "lookup")
                return response with { Status = "calculated", Message = "Ordered lookup calculated without equipment approaches; full cable design is not calculated in lookup mode." };
            if ((route.FromRequiresSecondary || route.ToRequiresSecondary) && request.ProjectSettings.SecondaryTrayLength is null)
                return response with { Status = "settings_required", Message = "Project Details SECONDARY length is required for this path." };
            var design = CableDesignLength.Calculate(route, request.ProjectSettings.EndConnectionLength,
                request.ProjectSettings.SecondaryTrayLength ?? 0m, request.ProjectSettings.AdditionalBendingPercent);
            token.ThrowIfCancellationRequested();
            return response with { Design = design };
        }
        catch (OperationCanceledException)
        {
            return Failure(request, cancellationToken.IsCancellationRequested ? "cancelled" : "deadline_exceeded", "Calculation was cancelled before completion.");
        }
        catch (BoundaryException ex) { return Failure(request, ex.Status, ex.Message); }
        catch (JsonException) { return Failure(request, "invalid_request", "JSON does not match the strict PF-1 request contract."); }
        catch (Exception ex) when (ex is ArgumentException or OverflowException or InvalidOperationException)
        { return Failure(request, "invalid_request", ex.Message); }
    }

    public static AdapterResponse Failure(EngineRequest? request, string status, string message) => new()
    { RequestId = request?.RequestId, Operation = request?.Operation, Status = status, Message = message };

    private static void ValidateEnvelope(EngineRequest request)
    {
        if (request.SchemaVersion != "pathfinder.pf1.request.v1") throw new ArgumentException("Unsupported schemaVersion.");
        Text(request.RequestId, "requestId", 128);
        if (request.CoordinateSystem != "right-handed-z-up-metres") throw new ArgumentException("Unsupported coordinateSystem; transform to canonical metres before invoking the engine.");
        if (request.TimeoutMilliseconds is < 1 or > MaximumTimeoutMilliseconds) throw new ArgumentException("timeoutMilliseconds must be 1 to 60000.");
        if (request.ProjectSettings is null || request.Options is null) throw new ArgumentException("projectSettings and options snapshots are required.");
        Text(request.ProjectSettings.Revision, "projectSettings.revision", 256);
        if (request.ProjectSettings.SecondaryTrayLength is < 0m or > 1_000_000m ||
            request.ProjectSettings.EndConnectionLength is < 0m or > 1_000_000m ||
            request.ProjectSettings.AdditionalBendingPercent is < 0m or > 10_000m)
            throw new ArgumentException("Project allowance outside supported range.");
        _ = ToOptions(request.Options);
        if (request.Operation is not ("calculate" or "lookup" or "geometry" or "geometry-route" or "parse" or "name"))
            throw new ArgumentException("Unsupported operation.");
        bool route = request.Operation is "calculate" or "geometry-route";
        bool geometry = request.Operation is "geometry" or "geometry-route";
        if ((!route && (request.From is not null || request.To is not null || request.Category is not null)) ||
            (route && (request.From is null || request.To is null)) ||
            (!geometry && request.Geometry is not null) ||
            (request.Operation is not ("calculate" or "lookup") && request.Segments is not null) ||
            (request.Operation is not ("lookup" or "parse") && request.RouteText is not null) ||
            (request.Operation != "name" && request.Names is not null) ||
            (request.Reverse && request.Operation is not ("calculate" or "lookup" or "geometry-route")))
            throw new ArgumentException("Operation contains missing or inapplicable fields.");
        if (route) _ = MapCategory(request.Category, "category_required");
    }

    private static RoutingOptions ToOptions(EngineOptions input)
    {
        Number(input.ConnectionToleranceMeters, "connectionToleranceMeters", 1e-9, 1000);
        Number(input.SampleSpacingMeters, "sampleSpacingMeters", 1e-9, 1000);
        Number(input.SecondaryDistanceMeters, "secondaryDistanceMeters", 0, 1e6);
        if (input.MaxGraphNodes is < 2 or > 500_000 || input.MaxGraphConnections is < 1 or > 2_000_000)
            throw new BoundaryException("resource_limit", "Graph budgets exceed adapter limits (500000 nodes / 2000000 connections).");
        return new RoutingOptions { ConnectionToleranceMeters = input.ConnectionToleranceMeters, SampleSpacingMeters = input.SampleSpacingMeters,
            SecondaryDistanceMeters = input.SecondaryDistanceMeters, PreferVerticalApproach = input.PreferVerticalApproach,
            MaxGraphNodes = input.MaxGraphNodes, MaxGraphConnections = input.MaxGraphConnections };
    }

    private static TraySegment ToSegment(SegmentInput input, HashSet<string> ids, WorkBudget budget)
    {
        if (input is null) throw new ArgumentException("Segment cannot be null.");
        Id(input.Id, ids); Text(input.Name, "segment.name", 1024, true);
        var points = Points(input.Points, budget, 2, 8192);
        var ports = Ports(input.VerifiedPorts ?? [], budget);
        var surfaces = input.ConnectionSurfaces ?? [];
        if (surfaces.Length > 2) throw new ArgumentException("At most two measured connection surfaces are supported.");
        var retained = new List<TrayMeshClearance>();
        foreach (var surface in surfaces)
        {
            if (surface is null) throw new ArgumentException("Surface cannot be null.");
            if (!TrayMeshClearance.TryCreate(Mesh(surface.Mesh, budget), Ports(surface.VerifiedPorts, budget), surface.EndsOnly,
                    budget.Token, out var clearance, out var reason)) throw new ArgumentException("Invalid measured surface: " + reason);
            retained.Add(clearance);
        }
        return new TraySegment(input.Id, input.Name, Categories(input.AllowedCategories), points, input.ConnectionsAtEndsOnly, ports, retained);
    }

    private static TrayGeometryInput ToGeometry(GeometryInput input, HashSet<string> ids, WorkBudget budget)
    {
        if (input is null) throw new ArgumentException("Geometry cannot be null.");
        Id(input.Id, ids); Text(input.RouteName, "routeName", 1024, true); Text(input.ShapeName, "shapeName", 1024, true);
        var faces = input.FaceExtents ?? [];
        if (faces.Length > 6) throw new ArgumentException("At most six face extents are supported.");
        var extents = faces.Select(face =>
        {
            if (face is null || !Enum.TryParse<TrayBoxFace>(face.Face, false, out var parsed) || !Enum.IsDefined(parsed) || face.Face != parsed.ToString())
                throw new ArgumentException("Invalid box face name.");
            if (face.SampleCount is < 0 or > 262144) throw new ArgumentException("Face sample count outside supported range.");
            return new TrayFaceExtent(parsed, Point(face.Minimum, budget), Point(face.Maximum, budget), face.SampleCount);
        }).ToArray();
        return new TrayGeometryInput(input.Id, input.RouteName, Categories(input.Categories), input.ShapeName,
            Point(input.Minimum, budget), Point(input.Maximum, budget), extents, input.Mesh is null ? null : Mesh(input.Mesh, budget));
    }

    private static TrayMeshData Mesh(MeshInput input, WorkBudget budget)
    {
        if (input?.Fragments is null || input.Fragments.Length is < 1 or > 512) throw new ArgumentException("Mesh must have 1 to 512 fragments.");
        var fragments = input.Fragments.Select(fragment =>
        {
            budget.Check();
            if (fragment is null || fragment.TriangleIndices is null) throw new ArgumentException("Mesh fragment cannot be null.");
            if (fragment.TriangleIndices.Length is < 3 or > 600_000 || fragment.TriangleIndices.Length % 3 != 0)
                throw new ArgumentException("Triangle indices must have a positive bounded multiple of three entries.");
            budget.AddTriangles(fragment.TriangleIndices.Length / 3);
            var vertices = Points(fragment.Vertices, budget, 3, 262144);
            foreach (int index in fragment.TriangleIndices)
            {
                budget.Check();
                if (index < 0 || index >= vertices.Length) throw new ArgumentException("Triangle index is outside its fragment vertex array.");
            }
            return new TrayMeshFragment(vertices, fragment.TriangleIndices);
        }).ToArray();
        return new TrayMeshData(fragments);
    }

    private static RouteConnectionPort[] Ports(PortInput[]? values, WorkBudget budget)
    {
        if (values is null || values.Length > 2) throw new ArgumentException("Verified ports must contain at most two entries.");
        return values.Select(port =>
        {
            if (port is null) throw new ArgumentException("Port cannot be null.");
            Number(port.Width, "port.width", 1e-9, 1e6); Number(port.Height, "port.height", 1e-9, 1e6);
            return new RouteConnectionPort(Point(port.Point, budget), Point(port.Outward, budget), Point(port.U, budget), Point(port.V, budget), port.Width, port.Height);
        }).ToArray();
    }

    private static RoutePoint[] Points(PointInput[]? values, WorkBudget budget, int min, int max)
    {
        if (values is null || values.Length < min || values.Length > max) throw new ArgumentException("Point array count outside supported range.");
        return values.Select(point => Point(point, budget)).ToArray();
    }
    private static RoutePoint Point(PointInput? point, WorkBudget budget)
    {
        if (point is null) throw new ArgumentException("Coordinate is required.");
        budget.AddPoint();
        Number(point.X, "x", -1e9, 1e9); Number(point.Y, "y", -1e9, 1e9); Number(point.Z, "z", -1e9, 1e9);
        return new RoutePoint(point.X, point.Y, point.Z);
    }
    private static CableCategory Categories(string[]? input)
    {
        if (input is null || input.Length > 3) throw new ArgumentException("allowed categories must contain zero to three values.");
        var result = CableCategory.None;
        foreach (var value in input)
        {
            var category = MapCategory(value, "invalid_request");
            if ((result & category) != 0) throw new ArgumentException("Duplicate tray category after category mapping.");
            result |= category;
        }
        return result;
    }
    private static CableCategory MapCategory(string? input, string status) => input switch
    {
        "MV" => CableCategory.MV, "LV" => CableCategory.LV, "Control" or "Instrumentation" => CableCategory.Control,
        _ => throw new BoundaryException(status, "A known cable category is required: MV, LV, Control or Instrumentation.")
    };
    private static void Id(string? value, HashSet<string> identifiers)
    {
        Text(value, "id", 256);
        if (!identifiers.Add(value!)) throw new ArgumentException("Duplicate geometry/segment identifier.");
    }
    private static string Text(string? value, string field, int maximum, bool allowEmpty = false)
    {
        if (value is null || value.Length > maximum || (!allowEmpty && string.IsNullOrWhiteSpace(value)) || value.Any(char.IsControl))
            throw new ArgumentException(field + " is missing, too long or contains control characters.");
        return value;
    }
    private static string RouteText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 32768 || value.Any(c => char.IsControl(c) && c is not ('\r' or '\n' or '\t')))
            throw new ArgumentException("routeText is missing, too long or contains unsupported control characters.");
        return value;
    }
    private static void Number(double value, string field, double min, double max)
    {
        if (!double.IsFinite(value) || value < min || value > max) throw new ArgumentException(field + " outside finite supported range.");
    }
    private static bool IsCoreResourceLimit(string message) =>
        (message.StartsWith("The selected tray geometry exceeds the ", StringComparison.Ordinal) &&
         (message.EndsWith(" routing-node limit. Select a smaller tray area or simplify the tray geometry.", StringComparison.Ordinal) ||
          message.EndsWith(" routing-connection limit. Select a smaller tray area or use a tighter connection tolerance.", StringComparison.Ordinal) ||
          message.EndsWith(" routing-candidate limit. Too many overlapping piece bounds need comparison. Select a smaller tray area.", StringComparison.Ordinal))) ||
        (message.StartsWith("The ordered route exceeds the ", StringComparison.Ordinal) &&
         message.EndsWith(" lookup-state limit. Enter a shorter route.", StringComparison.Ordinal)) ||
        (message.StartsWith("Route /", StringComparison.Ordinal) &&
         message.EndsWith(" endpoint-inference work limit. Enter more specific route names or select a smaller route area.", StringComparison.Ordinal));
    private static void RejectDuplicateMembers(JsonElement element, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name)) throw new ArgumentException("Duplicate JSON member: " + property.Name);
                RejectDuplicateMembers(property.Value, token);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var child in element.EnumerateArray()) RejectDuplicateMembers(child, token);
    }
    private sealed class BoundaryException(string status, string message) : Exception(message) { public string Status { get; } = status; }
    private sealed class ExactDecimalConverter : JsonConverter<decimal>
    {
        public override decimal Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
        {
            string? text = reader.TokenType switch
            {
                JsonTokenType.String => reader.GetString(),
                JsonTokenType.Number => Encoding.UTF8.GetString(reader.HasValueSequence ? reader.ValueSequence.ToArray() : reader.ValueSpan),
                _ => null
            };
            if (text is null || text.Length is < 1 or > 128 ||
                !decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint | NumberStyles.AllowExponent,
                    CultureInfo.InvariantCulture, out var value) || !ExactlyRepresentable(text, value))
                throw new JsonException("An exactly representable invariant decimal number or string is required.");
            return value;
        }
        public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) =>
            writer.WriteStringValue(value.ToString(CultureInfo.InvariantCulture));

        // Decimal.TryParse and Utf8JsonReader.TryGetDecimal may round excess precision or
        // underflow to zero. Compare integer coefficients at a common scale before accepting.
        private static bool ExactlyRepresentable(string text, decimal value)
        {
            int exponent = 0;
            int exponentAt = text.IndexOfAny(['e', 'E']);
            if (exponentAt >= 0)
            {
                if (!int.TryParse(text.AsSpan(exponentAt + 1), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out exponent)
                    || Math.Abs((long)exponent) > 1000) return false;
                text = text[..exponentAt];
            }
            bool negative = text.StartsWith('-');
            if (text.StartsWith('+') || negative) text = text[1..];
            int dot = text.IndexOf('.');
            int fraction = dot < 0 ? 0 : text.Length - dot - 1;
            string digits = dot < 0 ? text : text.Remove(dot, 1);
            if (digits.Length == 0 || digits.Any(c => c is < '0' or > '9')) return false;
            var coefficient = BigInteger.Parse(digits, CultureInfo.InvariantCulture);
            if (negative) coefficient = -coefficient;
            int scale = fraction - exponent;
            var bits = decimal.GetBits(value);
            var actual = new BigInteger((uint)bits[0]) + (new BigInteger((uint)bits[1]) << 32) + (new BigInteger((uint)bits[2]) << 64);
            if ((bits[3] & int.MinValue) != 0) actual = -actual;
            int actualScale = (bits[3] >> 16) & 0x7f;
            return scale >= actualScale
                ? coefficient == actual * BigInteger.Pow(10, scale - actualScale)
                : coefficient * BigInteger.Pow(10, actualScale - scale) == actual;
        }
    }
    private sealed class WorkBudget(CancellationToken token)
    {
        private int points;
        private int triangles;
        public CancellationToken Token => token;
        public void Check() => token.ThrowIfCancellationRequested();
        public void AddPoint() { Check(); if (++points > 262144) throw new BoundaryException("resource_limit", "Total point budget (262144) exceeded."); }
        public void AddTriangles(int count) { Check(); triangles = checked(triangles + count); if (triangles > 200000) throw new BoundaryException("resource_limit", "Total triangle budget (200000) exceeded."); }
    }
}
