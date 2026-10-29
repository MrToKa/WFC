using System.Buffers.Binary;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

// Test-only protocol fixture. It has no routing/Core dependency and is never a production executable.
internal static class Program
{
    private const string Protocol = "pathfinder.engine.session.v1";
    private const string EngineVersion = "45c24bf5f433f13e102600b36f20327c77961d0a";
    private const int AllocationBytes = 575 * 1024 * 1024;
    private static async Task<int> Main(string[] args)
    {
        if (args is ["--memory-worker"])
        {
            var bytes = GC.AllocateUninitializedArray<byte>(AllocationBytes);
            for (var at = 0; at < bytes.Length; at += 4096) bytes[at] = 1;
            bytes[^1] = 1;
            await Task.Delay(20000);
            GC.KeepAlive(bytes);
            return 17;
        }
        if (args is not ["--session-supervisor"]) return 2;
        using var deadline = new CancellationTokenSource(20000);
        Process? worker = null;
        try
        {
            var dll = Assembly.GetExecutingAssembly().Location;
            var runnerSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(dll, deadline.Token))).ToLowerInvariant();
            await Frame(new { schemaVersion = Protocol, type = "ready", runnerSha256, engineVersion = EngineVersion,
                maxInputBytes = 1048576, maxOutputBytes = 33554432 }, deadline.Token);
            var input = Console.OpenStandardInput();
            var prefix = new byte[4]; await input.ReadExactlyAsync(prefix, deadline.Token);
            var length = BinaryPrimitives.ReadUInt32BigEndian(prefix);
            if (length is < 1 or > 1048576) return 3;
            var payload = new byte[length]; await input.ReadExactlyAsync(payload, deadline.Token);
            using var request = JsonDocument.Parse(payload);
            if (request.RootElement.GetProperty("schemaVersion").GetString() != "pathfinder.model.runner.v1"
                || !Guid.TryParseExact(request.RootElement.GetProperty("requestId").GetString(), "D", out _)) return 4;
            var start = new ProcessStartInfo(Environment.ProcessPath ?? throw new InvalidOperationException("No dotnet host."))
            { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
            start.ArgumentList.Add(dll); start.ArgumentList.Add("--memory-worker");
            worker = Process.Start(start) ?? throw new InvalidOperationException("No fixture worker.");
            // No response is deliberately emitted. The real server RSS guard must reject and reap this lane first.
            await worker.WaitForExitAsync(deadline.Token);
            return 18;
        }
        catch (Exception error) when (error is OperationCanceledException or IOException or JsonException or InvalidOperationException or KeyNotFoundException)
        { return 5; }
        finally
        {
            if (worker is not null)
            {
                try { if (!worker.HasExited) { worker.Kill(entireProcessTree: true); await worker.WaitForExitAsync(); } }
                catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception) { }
                worker.Dispose();
            }
        }
    }
    private static async Task Frame(object value, CancellationToken token)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        var length = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(length, (uint)bytes.Length);
        var output = Console.OpenStandardOutput();
        await output.WriteAsync(length, token); await output.WriteAsync(bytes, token); await output.FlushAsync(token);
    }
}
