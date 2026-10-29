using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PathFinder.Model;

internal static class SessionProtocol
{
    internal const string Version = "pathfinder.engine.session.v1";
    internal const int MaximumInput = 1048576, MaximumOutput = 33554432, MaximumRequests = 64;
    internal const int StartupMilliseconds = 5000, LifetimeMilliseconds = 600000;
    // The interactive profile retains the same bounded worker while a user
    // selects another 3D location. It changes only idle retention, never the
    // 10-minute lifetime, request count or independent memory ceilings.
    internal static int IdleMilliseconds => SessionIdleMilliseconds(Environment.GetEnvironmentVariable("PF_ENGINE_SESSION_PROFILE"));
    internal static int SessionIdleMilliseconds(string? profile) => profile switch
    {
        null or "bounded" => 30000,
        "interactive" => 300000,
        _ => throw new InvalidOperationException("Unknown bounded engine session profile.")
    };
    internal const long MaximumResidentBytes = 512L * 1024 * 1024;
    private static readonly UTF8Encoding Utf8 = new(false, true);

    internal static string RunnerHash => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(SessionProtocol).Assembly.Location))).ToLowerInvariant();
    internal static object Ready() => new { schemaVersion = Version, type = "ready", runnerSha256 = RunnerHash,
        engineVersion = FittedModelCache.EngineVersion, maxInputBytes = MaximumInput, maxOutputBytes = MaximumOutput,
        idleMilliseconds = IdleMilliseconds };

    internal static async Task<byte[]?> ReadFrame(Stream stream, int maximum, CancellationToken token, Action? firstActivity = null)
    {
        var prefix = new byte[4];
        var first = await stream.ReadAsync(prefix.AsMemory(0, 4), token);
        if (first == 0) return null;
        firstActivity?.Invoke();
        await ReadRemainder(stream, prefix.AsMemory(first), token);
        var length = BinaryPrimitives.ReadUInt32BigEndian(prefix);
        if (length == 0 || length > maximum) throw new InvalidDataException("Session frame exceeds its byte budget.");
        var bytes = new byte[(int)length]; await ReadRemainder(stream, bytes, token);
        _ = Utf8.GetCharCount(bytes); // JsonDocument can defer decoding unvisited strings.
        using var parsed = Parse(bytes);
        return bytes;
    }
    private static async Task ReadRemainder(Stream stream, Memory<byte> buffer, CancellationToken token)
    {
        while (buffer.Length != 0)
        {
            var count = await stream.ReadAsync(buffer, token);
            if (count == 0) throw new EndOfStreamException("Partial session frame.");
            buffer = buffer[count..];
        }
    }
    internal static async Task WriteFrame(Stream stream, ReadOnlyMemory<byte> bytes, int maximum, CancellationToken token)
    {
        if (bytes.Length is < 1 || bytes.Length > maximum) throw new InvalidDataException("Session frame exceeds its byte budget.");
        var prefix = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(prefix, (uint)bytes.Length);
        await stream.WriteAsync(prefix, token); await stream.WriteAsync(bytes, token); await stream.FlushAsync(token);
    }
    internal static JsonDocument Parse(ReadOnlyMemory<byte> bytes)
    {
        var document = JsonDocument.Parse(bytes);
        try { Duplicates(document.RootElement); return document; }
        catch { document.Dispose(); throw; }
    }
    private static void Duplicates(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            { if (!names.Add(property.Name)) throw new InvalidDataException("Duplicate session JSON member."); Duplicates(property.Value); }
        }
        else if (element.ValueKind == JsonValueKind.Array) foreach (var child in element.EnumerateArray()) Duplicates(child);
    }
    internal static void Fields(JsonElement element, params string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object || element.EnumerateObject().Count() != names.Length
            || element.EnumerateObject().Any(p => !names.Contains(p.Name, StringComparer.Ordinal))) throw new InvalidDataException("Session schema mismatch.");
    }
    internal static void ValidateReady(ReadOnlyMemory<byte> bytes)
    {
        using var doc = Parse(bytes); var value = doc.RootElement;
        if (value.TryGetProperty("idleMilliseconds", out var retainedIdle))
        {
            Fields(value, "schemaVersion", "type", "runnerSha256", "engineVersion", "maxInputBytes", "maxOutputBytes", "idleMilliseconds");
            if (retainedIdle.GetInt32() != IdleMilliseconds) throw new InvalidDataException("Session idle profile mismatch.");
        }
        else
        {
            Fields(value, "schemaVersion", "type", "runnerSha256", "engineVersion", "maxInputBytes", "maxOutputBytes");
            if (IdleMilliseconds != 30000) throw new InvalidDataException("Interactive session requires its checked idle profile.");
        }
        if (value.GetProperty("schemaVersion").GetString() != Version || value.GetProperty("type").GetString() != "ready"
            || value.GetProperty("runnerSha256").GetString() != RunnerHash || value.GetProperty("engineVersion").GetString() != FittedModelCache.EngineVersion
            || value.GetProperty("maxInputBytes").GetInt32() != MaximumInput || value.GetProperty("maxOutputBytes").GetInt32() != MaximumOutput)
            throw new InvalidDataException("Session binary or protocol identity mismatch.");
    }
    internal static JsonElement ValidateResult(ReadOnlyMemory<byte> bytes, string requestId, int ordinal, Request? request = null)
    {
        using var doc = Parse(bytes); var value = doc.RootElement;
        Fields(value, "schemaVersion", "type", "response", "session");
        var session = value.GetProperty("session"); Fields(session, "requestOrdinal", "preparedReuse", "retireAfterResponse");
        if (value.GetProperty("schemaVersion").GetString() != Version || value.GetProperty("type").GetString() != "result"
            || session.GetProperty("requestOrdinal").GetInt32() != ordinal
            || session.GetProperty("preparedReuse").GetString() is not ("none" or "build" or "disk" or "memory")) throw new InvalidDataException("Session result identity mismatch.");
        _ = session.GetProperty("retireAfterResponse").GetBoolean();
        var response = value.GetProperty("response");
        if (response.GetProperty("schemaVersion").GetString() is not ("pathfinder.model.response.v1" or "pathfinder.model.response.v2" or "pathfinder.model.response.v3")
            || response.GetProperty("requestId").GetString() != requestId || response.GetProperty("engineeringAccepted").GetBoolean()
            || response.GetProperty("status").GetString() is not ("prepared" or "calculated" or "lookup_planned" or "no_path" or "settings_required"
                or "category_required" or "model_needs_review" or "invalid_request" or "deadline_exceeded" or "resource_limit"))
            throw new InvalidDataException("Session response identity or status mismatch.");
        if (request is not null) Program.ValidateResponseVersion(response, request);
        else if (response.GetProperty("schemaVersion").GetString() == "pathfinder.model.response.v3") throw new InvalidDataException("Protected responses require their actual admitted request.");
        return value.Clone();
    }
}
