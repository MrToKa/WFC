using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace PathFinder.BarrierVerifier;

internal static class SurfaceJson
{
    internal static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false, UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow };
    internal static readonly UTF8Encoding Utf8 = new(false, true);
    internal static string Hash(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    internal static string HashObject<T>(T value) => Hash(Canonical(JsonSerializer.SerializeToElement(value, Options)));
    internal static byte[] Canonical(JsonElement value, params string[] omit)
    {
        using var stream = new MemoryStream(); using var writer = new Utf8JsonWriter(stream, new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        Write(value, 0); writer.Flush(); return stream.ToArray();
        void Write(JsonElement item, int depth)
        {
            if (depth > 32) Fail("JSON_DEPTH");
            if (item.ValueKind == JsonValueKind.Object)
            {
                var names = new HashSet<string>(StringComparer.Ordinal); writer.WriteStartObject();
                foreach (var p in item.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
                { if (!names.Add(p.Name)) Fail("JSON_DUPLICATE"); if (depth == 0 && omit.Contains(p.Name, StringComparer.Ordinal)) continue;
                    writer.WritePropertyName(p.Name); Write(p.Value, depth + 1); }
                writer.WriteEndObject();
            }
            else if (item.ValueKind == JsonValueKind.Array) { writer.WriteStartArray(); foreach (var child in item.EnumerateArray()) Write(child, depth + 1); writer.WriteEndArray(); }
            else { if (item.ValueKind == JsonValueKind.Number && (!item.TryGetDouble(out double n) || !double.IsFinite(n))) Fail("JSON_NUMBER"); item.WriteTo(writer); }
        }
    }
    internal static JsonDocument Parse(ReadOnlyMemory<byte> bytes, int maximum, bool canonical = true)
    {
        if (bytes.Length is < 1 || bytes.Length > maximum) Fail("JSON_BYTES");
        try
        {
            var owned = bytes.ToArray(); _ = Utf8.GetCharCount(owned); var doc = JsonDocument.Parse(owned, new() { MaxDepth = 32 });
            try { var next = Canonical(doc.RootElement); if (canonical && !next.AsSpan().SequenceEqual(bytes.Span)) Fail("JSON_CANONICAL"); return doc; }
            catch { doc.Dispose(); throw; }
        }
        catch (Exception e) when (e is JsonException or DecoderFallbackException) { throw new SurfaceCatalogRefusalException("JSON_INVALID"); }
    }
    internal static void Fields(JsonElement value, params string[] fields)
    {
        if (value.ValueKind != JsonValueKind.Object) Fail("JSON_FIELDS"); var names = value.EnumerateObject().Select(p => p.Name).ToArray();
        if (names.Length != fields.Length || names.Distinct(StringComparer.Ordinal).Count() != names.Length || names.Except(fields, StringComparer.Ordinal).Any()) Fail("JSON_FIELDS");
    }
    internal static string Text(JsonElement value, string key) => value.TryGetProperty(key, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString()! : throw new SurfaceCatalogRefusalException("JSON_TEXT");
    internal static ulong Number(JsonElement value, string key, ulong maximum = 9_007_199_254_740_991)
    {
        ulong n = 0;
        if (!value.TryGetProperty(key, out var p) || p.ValueKind != JsonValueKind.Number || !p.TryGetUInt64(out n) || n > maximum || p.GetRawText() != n.ToString(CultureInfo.InvariantCulture)) Fail("JSON_INTEGER");
        return n;
    }
    internal static uint U32(JsonElement value, string key, uint maximum = uint.MaxValue) => checked((uint)Number(value, key, maximum));
    internal static void Literal(JsonElement value, string key, string expected) { if (Text(value, key) != expected) Fail("JSON_LITERAL"); }
    internal static void False(JsonElement value, string key) { if (!value.TryGetProperty(key, out var p) || p.ValueKind != JsonValueKind.False) Fail("FALSE_REQUIRED"); }
    internal static void Bool(JsonElement value, string key) { if (!value.TryGetProperty(key, out var p) || p.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) Fail("BOOLEAN_REQUIRED"); }
    internal static string Digest(JsonElement value, string key) { string s = Text(value, key); Digest(s); return s; }
    internal static void Digest(string? value) { if (value is null || value.Length != 64 || value.Any(c => c is not (>= '0' and <= '9' or >= 'a' and <= 'f'))) Fail("HASH"); }
    internal static void Uuid(string? value) { if (value is null || !Guid.TryParseExact(value, "D", out var parsed) || parsed.ToString("D") != value) Fail("UUID"); }
    internal static ulong Revision(JsonElement value, string key)
    { string s = Text(value, key); if (!ulong.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out ulong n) || n > 9_223_372_036_854_775_807 || n.ToString(CultureInfo.InvariantCulture) != s) Fail("REVISION"); return n; }
    internal static T Dto<T>(JsonElement value)
    { try { return value.Deserialize<T>(Options) ?? throw new SurfaceCatalogRefusalException("JSON_DTO"); } catch (JsonException) { throw new SurfaceCatalogRefusalException("JSON_DTO"); } }
    internal static void HashEnvelope(ReadOnlyMemory<byte> bytes, string domain, string hash, out JsonDocument document)
    {
        document = Parse(bytes, 65_536); var root = document.RootElement; Fields(root, "domain", "value"); Literal(root, "domain", domain);
        if (Hash(bytes.Span) != hash) Fail("HASH_ENVELOPE");
    }
    internal static string DomainHash(string domain, JsonElement value) => HashObject(new { domain, value });
    [System.Diagnostics.CodeAnalysis.DoesNotReturn] internal static void Fail(string code) => throw new SurfaceCatalogRefusalException(code);
}
internal sealed class SurfaceBudget
{
    private readonly SurfaceCatalogLimits limits; private readonly CancellationToken token; private readonly long started = Stopwatch.GetTimestamp();
    internal long Work { get; private set; } internal ulong InputBytes { get; private set; }
    internal SurfaceBudget(SurfaceCatalogLimits limits, CancellationToken token) { this.limits = limits; this.token = token; }
    internal void Spend(long amount = 1) { Work = checked(Work + amount); if (Work > limits.MaximumWork) SurfaceJson.Fail("WORK_LIMIT"); Check(); }
    internal void Input(int bytes) { InputBytes = checked(InputBytes + (ulong)bytes); if (InputBytes > (ulong)limits.MaximumInputBytes) SurfaceJson.Fail("INPUT_LIMIT"); Spend(); }
    internal void Check() { token.ThrowIfCancellationRequested(); if (Stopwatch.GetElapsedTime(started).TotalMilliseconds >= limits.MaximumMilliseconds) SurfaceJson.Fail("DEADLINE_EXCEEDED"); }
    internal static void CheckLimits(SurfaceCatalogLimits l)
    {
        if (l.MaximumNodes is < 1 or > 1_048_576 || l.MaximumFragments is < 1 or > 1_048_576 || l.MaximumRanges is < 1 or > 16_777_216
            || l.MaximumParts is < 1 or > 1_048_576 || l.MaximumPages is < 1 or > 65_536 || l.PageTriangles is < 1 or > 4096
            || l.MaximumTriangles is < 1 or > 50_000_000 || l.MaximumInputBytes is < 1 or > 8L * 1024 * 1024 * 1024
            || l.MaximumOutputBytes is < 1 or > 8L * 1024 * 1024 * 1024 || l.MinimumFreeBytes is < 0 or > 64L * 1024 * 1024
            || l.MaximumWork is < 1 or > 1_000_000_000 || l.MaximumMilliseconds is < 1 or > 900_000) SurfaceJson.Fail("INVALID_LIMITS");
    }
}
