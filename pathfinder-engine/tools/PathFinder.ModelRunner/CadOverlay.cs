using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AddinRibbon.Routing;
using PathFinder.Model;

internal sealed record CadOverlayEnvelope(string SchemaVersion, string Sha256, string PayloadBase64);
internal static partial class Program
{
    private static PreparedModel MergeCadOverlay(PreparedModel prepared, Request request, CancellationToken token)
    {
        if (request.CadOverlay is not { } envelope) return prepared;
        if (request.Operation is not ("calculate" or "design" or "prepare") || envelope.SchemaVersion != "wfc.pf.cad-overlay.v1"
            || !Regex.IsMatch(envelope.Sha256, "^[a-f0-9]{64}$") || envelope.PayloadBase64.Length > 512 * 1024)
            throw new ArgumentException("Invalid CAD routing overlay envelope.");
        byte[] bytes = Convert.FromBase64String(envelope.PayloadBase64);
        if (bytes.Length > 384 * 1024 || Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != envelope.Sha256)
            throw new ArgumentException("CAD routing overlay hash differs.");
        using var document = JsonDocument.Parse(bytes);
        var root = document.RootElement;
        if (root.GetProperty("schemaVersion").GetString() != "wfc.pf.cad-overlay-payload.v1"
            || root.GetProperty("projectId").GetString() != request.ProjectId
            || root.GetProperty("modelVersionId").GetString() != request.ModelVersionId
            || root.GetProperty("baseSnapshotSha256").GetString() != request.SnapshotSha256)
            throw new ArgumentException("CAD routing overlay belongs to another base network.");
        var rows = root.GetProperty("segments");
        if (rows.GetArrayLength() is < 1 or > 32) throw new ArgumentException("CAD overlay segment limit exceeded.");
        var segments = prepared.Segments.ToList(); var ids = new HashSet<string>(segments.Select(segment => segment.Id));
        foreach (var row in rows.EnumerateArray())
        {
            token.ThrowIfCancellationRequested();
            string id = row.GetProperty("id").GetString()!, name = row.GetProperty("name").GetString()!;
            int mask = row.GetProperty("allowedCategoryMask").GetInt32();
            if (!id.StartsWith("cad:", StringComparison.Ordinal) || !Guid.TryParseExact(id[4..], "D", out _)
                || !ids.Add(id) || !Regex.IsMatch(name, "^/[A-Z0-9][A-Z0-9_.-]{0,199}$") || name == "/SECONDARY" || mask is < 1 or > 7)
                throw new ArgumentException("Invalid CAD overlay identity or permissions.");
            var points = row.GetProperty("pointsMetres"); var ports = row.GetProperty("ports");
            if (points.GetArrayLength() is < 2 or > 16385 || ports.GetArrayLength() is < 1 or > 2)
                throw new ArgumentException("Invalid CAD routing centerline or ports.");
            var line = points.EnumerateArray().Select(CadPoint).ToArray();
            var ends = ports.EnumerateArray().Select(port => new RouteConnectionPort(CadPoint(port.GetProperty("pointMetres")),
                CadPoint(port.GetProperty("outward")), CadPoint(port.GetProperty("u")), CadPoint(port.GetProperty("v")),
                port.GetProperty("widthMetres").GetDouble(), port.GetProperty("heightMetres").GetDouble())).ToArray();
            foreach (var port in ends)
                if (Math.Min(CadDistance(port.Point, line[0]), CadDistance(port.Point, line[^1])) > 0.001)
                    throw new ArgumentException("CAD port is not on a published chain endpoint.");
            segments.Add(new TraySegment(id, name, (CableCategory)mask, line, true, ends));
        }
        string key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("wfc.pf.cad-composite.v1\n" + prepared.Key + "\n" + envelope.Sha256))).ToLowerInvariant();
        return prepared with { Key = key, Segments = segments };
    }
    private static RoutePoint CadPoint(JsonElement value)
    {
        if (value.GetArrayLength() != 3) throw new ArgumentException("Invalid CAD point.");
        var p = value.EnumerateArray().Select(item => item.GetDouble()).ToArray();
        if (p.Any(v => !double.IsFinite(v) || Math.Abs(v) > 1e9)) throw new ArgumentException("Invalid CAD coordinate.");
        return new RoutePoint(p[0], p[1], p[2]);
    }
    private static double CadDistance(RoutePoint a, RoutePoint b) => Math.Sqrt(Math.Pow(a.X-b.X,2)+Math.Pow(a.Y-b.Y,2)+Math.Pow(a.Z-b.Z,2));
}
