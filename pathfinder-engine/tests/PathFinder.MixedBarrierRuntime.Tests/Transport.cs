using System.Buffers.Binary;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static partial class Program
{
    private static Process Spawn(string runner, string root, string? mode = null)
    {
        var info = new ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.ArgumentList.Add(runner); if (mode is not null) info.ArgumentList.Add(mode); info.Environment["PF_ROOT"] = root;
        return Process.Start(info) ?? throw new IOException("Owned runner process did not start.");
    }
    private static string NewDiagnostic(string root, string kind, JsonObject? request = null)
    {
        string directory = Path.Combine(root, "transport-diagnostics", kind + "-" + Interlocked.Increment(ref diagnosticSerial).ToString("D4"));
        Directory.CreateDirectory(directory);
        if (request is not null)
        {
            var bytes = Encoding.UTF8.GetBytes(request.ToJsonString()); Need(bytes.Length <= 1048576, "Synthetic request exceeded the real control-message ceiling.");
            File.WriteAllBytes(Path.Combine(directory, "request.json"), bytes);
        }
        return directory;
    }
    private static async Task<byte[]> ReadCaptured(Stream input, string path, int maximum, CancellationToken token)
    {
        await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 32768, true);
        using var memory = new MemoryStream(); var buffer = new byte[32768];
        for (int count; (count = await input.ReadAsync(buffer, token)) != 0;)
        {
            int allowed = Math.Min(count, maximum - checked((int)memory.Length));
            if (allowed > 0) { await file.WriteAsync(buffer.AsMemory(0, allowed), token); memory.Write(buffer, 0, allowed); }
            if (allowed != count) throw new InvalidDataException("Owned transport output exceeded its explicit capture ceiling: " + path);
        }
        return memory.ToArray();
    }
    private sealed class RunnerProcessRefusal(int exitCode, int stdoutBytes, string directory)
        : IOException($"Owned runner exited {exitCode} with {stdoutBytes} stdout bytes; exact bounded evidence: {directory}")
    { internal int ExitCode { get; } = exitCode; internal int StdoutBytes { get; } = stdoutBytes; }
    private static async Task<JsonElement> OneShot(string runner, string root, JsonObject request)
    {
        string evidence = NewDiagnostic(root, "one-shot", request); var timer = Stopwatch.StartNew();
        using var process = Spawn(runner, root); using var deadline = new CancellationTokenSource(40000);
        var output = ReadCaptured(process.StandardOutput.BaseStream, Path.Combine(evidence, "stdout.json"), 33554432, deadline.Token);
        var error = ReadCaptured(process.StandardError.BaseStream, Path.Combine(evidence, "stderr.txt"), 65536, deadline.Token);
        try { await process.StandardInput.WriteAsync(request.ToJsonString()); process.StandardInput.Close(); await process.WaitForExitAsync(deadline.Token);
            var bytes = await output; _ = await error;
            if (process.ExitCode != 0 || bytes.Length == 0) throw new RunnerProcessRefusal(process.ExitCode, bytes.Length, evidence);
            using var json = JsonDocument.Parse(bytes); return json.RootElement.Clone(); }
        finally
        {
            if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(); }
            try { await Task.WhenAll(output, error); } catch { /* Exact bounded prefixes remain in their files on refusal/timeout. */ }
            File.WriteAllText(Path.Combine(evidence, "process.json"), JsonSerializer.Serialize(new { process.Id, process.ExitCode,
                elapsedMilliseconds = timer.Elapsed.TotalMilliseconds, requestId = request["requestId"]?.GetValue<string>(), maximumStdoutBytes = 33554432, maximumStderrBytes = 65536 }));
        }
    }
    private sealed class Session : IDisposable
    {
        private Process process; private Task<byte[]> errors; private readonly string runner, root; private string sessionDirectory;
        private int ordinal; private bool finished, retired;
        private Session(Process value, string runnerPath, string workRoot)
        {
            process = value; runner = runnerPath; root = workRoot; sessionDirectory = NewDiagnostic(root, "session-process");
            errors = ReadCaptured(process.StandardError.BaseStream, Path.Combine(sessionDirectory, "stderr.txt"), 65536, CancellationToken.None);
        }
        internal static async Task<Session> Start(string runner, string root)
        {
            var session = new Session(Spawn(runner, root, "--session-supervisor"), runner, root);
            try { using var deadline = new CancellationTokenSource(10000); await session.Ready(deadline.Token); return session; }
            catch { session.Dispose(); throw; }
        }
        private async Task Ready(CancellationToken token)
        { var ready = await ReadFrame(process.StandardOutput.BaseStream, token, Path.Combine(sessionDirectory, "ready")); Equal("pathfinder.engine.session.v1", ready.GetProperty("schemaVersion").GetString()); Equal("ready", ready.GetProperty("type").GetString()); }
        internal async Task<JsonElement> Query(JsonObject request)
        {
            using var deadline = new CancellationTokenSource(40000);
            if (retired)
            {
                await process.WaitForExitAsync(deadline.Token); _ = await errors; Equal(0, process.ExitCode); process.Dispose();
                process = Spawn(runner, root, "--session-supervisor"); sessionDirectory = NewDiagnostic(root, "session-process");
                errors = ReadCaptured(process.StandardError.BaseStream, Path.Combine(sessionDirectory, "stderr.txt"), 65536, CancellationToken.None);
                ordinal = 0; retired = false; await Ready(deadline.Token);
            }
            string evidence = NewDiagnostic(root, "session-request", request);
            await WriteFrame(process.StandardInput.BaseStream, Encoding.UTF8.GetBytes(request.ToJsonString()), deadline.Token);
            var envelope = await ReadFrame(process.StandardOutput.BaseStream, deadline.Token, Path.Combine(evidence, "stdout")); Equal("result", envelope.GetProperty("type").GetString());
            Equal(++ordinal, envelope.GetProperty("session").GetProperty("requestOrdinal").GetInt32());
            retired = envelope.GetProperty("session").GetProperty("retireAfterResponse").GetBoolean();
            File.WriteAllText(Path.Combine(evidence, "process.json"), JsonSerializer.Serialize(new { process.Id, ordinal, retireAfterResponse = retired,
                stderrPath = Path.Combine(sessionDirectory, "stderr.txt"), maximumStdoutBytes = 33554432, maximumStderrBytes = 65536 }));
            var response = envelope.GetProperty("response"); Equal(request["requestId"]!.GetValue<string>(), response.GetProperty("requestId").GetString()); return response.Clone();
        }
        internal async Task Finish()
        { process.StandardInput.Close(); using var deadline = new CancellationTokenSource(10000); await process.WaitForExitAsync(deadline.Token); _ = await errors; Equal(0, process.ExitCode); finished = true; }
        public void Dispose() { if (!finished && !process.HasExited) { process.Kill(true); process.WaitForExit(); } process.Dispose(); }
    }
    private static async Task WriteFrame(Stream stream, byte[] bytes, CancellationToken token)
    { var header = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(header, (uint)bytes.Length); await stream.WriteAsync(header, token); await stream.WriteAsync(bytes, token); await stream.FlushAsync(token); }
    private static async Task<JsonElement> ReadFrame(Stream stream, CancellationToken token, string? capturePath = null)
    { var header = new byte[4]; await stream.ReadExactlyAsync(header, token); uint size = BinaryPrimitives.ReadUInt32BigEndian(header); Need(size is > 0 and <= 33554432);
        var bytes = new byte[checked((int)size)]; await stream.ReadExactlyAsync(bytes, token);
        if (capturePath is not null) { File.WriteAllBytes(capturePath + ".json", bytes); File.WriteAllBytes(capturePath + ".frame.bin", header.Concat(bytes).ToArray()); }
        using var json = JsonDocument.Parse(bytes); return json.RootElement.Clone(); }
}
