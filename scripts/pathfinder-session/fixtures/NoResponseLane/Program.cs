using System.Buffers.Binary;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

// Test-only no-response fixture for the actual Node hard deadline. Never used by the application.
internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        if (args is ["--wait-child"]) { await Task.Delay(20000); return 9; }
        if (args is not ["--session-supervisor"]) return 2;
        using var ceiling = new CancellationTokenSource(20000);
        Process? child = null;
        try
        {
            var dll = Assembly.GetExecutingAssembly().Location;
            await Frame(new { schemaVersion = "pathfinder.engine.session.v1", type = "ready",
                runnerSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(dll, ceiling.Token))).ToLowerInvariant(),
                engineVersion = "45c24bf5f433f13e102600b36f20327c77961d0a", maxInputBytes = 1048576, maxOutputBytes = 33554432 }, ceiling.Token);
            using var first = await Read(ceiling.Token);
            var id = first.RootElement.GetProperty("requestId").GetString();
            await Frame(new { schemaVersion = "pathfinder.engine.session.v1", type = "result",
                response = new { schemaVersion = "pathfinder.model.response.v1", requestId = id, status = "prepared", message = "Test-only deadline fixture warmed.", engineeringAccepted = false },
                session = new { requestOrdinal = 1, preparedReuse = "none", retireAfterResponse = false } }, ceiling.Token);
            using var second = await Read(ceiling.Token);
            var start = new ProcessStartInfo(Environment.ProcessPath ?? throw new InvalidOperationException()) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add(dll); start.ArgumentList.Add("--wait-child"); child = Process.Start(start) ?? throw new InvalidOperationException();
            await child.WaitForExitAsync(ceiling.Token); return 10;
        }
        catch (Exception error) when (error is IOException or OperationCanceledException or InvalidOperationException or JsonException) { return 3; }
        finally { if (child is not null) { try { if (!child.HasExited) { child.Kill(entireProcessTree: true); await child.WaitForExitAsync(); } } catch (InvalidOperationException) { } child.Dispose(); } }
    }
    private static async Task<JsonDocument> Read(CancellationToken token)
    {
        var input = Console.OpenStandardInput(); var prefix = new byte[4]; await input.ReadExactlyAsync(prefix, token);
        var length = BinaryPrimitives.ReadUInt32BigEndian(prefix); if (length is < 1 or > 1048576) throw new IOException();
        var bytes = new byte[length]; await input.ReadExactlyAsync(bytes, token); return JsonDocument.Parse(bytes);
    }
    private static async Task Frame(object value, CancellationToken token)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value); var prefix = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(prefix, (uint)bytes.Length);
        var output = Console.OpenStandardOutput(); await output.WriteAsync(prefix, token); await output.WriteAsync(bytes, token); await output.FlushAsync(token);
    }
}
