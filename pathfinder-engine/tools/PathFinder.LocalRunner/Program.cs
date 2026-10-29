using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using PathFinder.Adapter;

// The coordinator kills the isolated calculation worker on its deadline. Cancellation inside
// the unmodified core is cooperative; a timed-out worker can never remain as a background task.
internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        using var stop = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Cancel(); };
        AdapterResponse response;
        try
        {
            using var inputDeadline = CancellationTokenSource.CreateLinkedTokenSource(stop.Token);
            inputDeadline.CancelAfter(PathfinderAdapter.MaximumTimeoutMilliseconds);
            var bytes = await ReadBounded(Console.OpenStandardInput(), PathfinderAdapter.MaximumRequestBytes, inputDeadline.Token);
            if (args is ["--worker"])
                response = PathfinderAdapter.Execute(bytes, stop.Token);
            else if (args.Length != 0)
                response = PathfinderAdapter.Failure(null, "invalid_request", "No command-line arguments are supported.");
            else
                return await Emit(await RunWorker(bytes, stop.Token));
        }
        catch (OperationCanceledException)
        { response = PathfinderAdapter.Failure(null, stop.IsCancellationRequested ? "cancelled" : "deadline_exceeded", "Input or calculation deadline exceeded."); }
        catch (SizeLimitException)
        { response = PathfinderAdapter.Failure(null, "resource_limit", "Input or output byte budget exceeded."); }
        catch (JsonException)
        { response = PathfinderAdapter.Failure(null, "invalid_request", "JSON does not match the PF-1 request contract."); }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or System.ComponentModel.Win32Exception)
        { response = PathfinderAdapter.Failure(null, "failed", "Local worker could not complete."); }

        return await Emit(JsonSerializer.SerializeToUtf8Bytes(response, PathfinderAdapter.JsonOptions));
    }

    private static async Task<int> Emit(byte[] output)
    {
        if (output.Length > PathfinderAdapter.MaximumResponseBytes)
        {
            output = JsonSerializer.SerializeToUtf8Bytes(PathfinderAdapter.Failure(null, "resource_limit", "Response byte budget exceeded."), PathfinderAdapter.JsonOptions);
        }
        using var result = JsonDocument.Parse(output);
        string? status = result.RootElement.GetProperty("status").GetString();
        await Console.OpenStandardOutput().WriteAsync(output);
        Console.WriteLine();
        return status switch
        {
            "calculated" or "geometry_ready" or "parsed" or "resolved" => 0,
            "no_path" or "settings_required" or "category_required" => 3,
            "cancelled" or "deadline_exceeded" => 4,
            "resource_limit" => 5,
            "failed" => 1,
            _ => 2
        };
    }

    private static byte[] Failure(string status, string message) =>
        JsonSerializer.SerializeToUtf8Bytes(PathfinderAdapter.Failure(null, status, message), PathfinderAdapter.JsonOptions);

    private static async Task<byte[]> RunWorker(byte[] bytes, CancellationToken cancellation)
    {
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 48 });
        if (document.RootElement.ValueKind != JsonValueKind.Object ||
            !document.RootElement.TryGetProperty("timeoutMilliseconds", out var timeoutValue) ||
            timeoutValue.ValueKind != JsonValueKind.Number ||
            !timeoutValue.TryGetInt32(out int timeout) || timeout is < 1 or > PathfinderAdapter.MaximumTimeoutMilliseconds)
            return Failure("invalid_request", "timeoutMilliseconds must be 1 to 60000.");
        var start = new ProcessStartInfo(Environment.ProcessPath ?? throw new InvalidOperationException("Process path unavailable."))
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        if (string.Equals(Path.GetFileNameWithoutExtension(start.FileName), "dotnet", StringComparison.OrdinalIgnoreCase))
            start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        start.ArgumentList.Add("--worker");
        using var worker = new Process { StartInfo = start };
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(timeout);
        worker.Start();
        try
        {
            // Drain concurrently so neither child pipe can deadlock; each stream has a byte cap.
            var stdout = ReadBounded(worker.StandardOutput.BaseStream, PathfinderAdapter.MaximumResponseBytes, deadline.Token);
            var stderr = ReadBounded(worker.StandardError.BaseStream, 64 * 1024, deadline.Token);
            await worker.StandardInput.BaseStream.WriteAsync(bytes, deadline.Token);
            worker.StandardInput.Close();
            var output = await stdout;
            await stderr;
            await worker.WaitForExitAsync(deadline.Token);
            if (output.Length == 0) return Failure("failed", "Worker returned no response.");
            using var result = JsonDocument.Parse(output);
            if (result.RootElement.GetProperty("schemaVersion").GetString() != "pathfinder.pf1.response.v1")
                return Failure("failed", "Worker returned an unsupported response.");
            return output;
        }
        catch (OperationCanceledException)
        {
            return Failure(cancellation.IsCancellationRequested ? "cancelled" : "deadline_exceeded", "Calculation worker stopped at its hard deadline.");
        }
        finally
        {
            if (!worker.HasExited)
            {
                try { worker.Kill(entireProcessTree: true); }
                catch (InvalidOperationException) when (worker.HasExited) { }
                await worker.WaitForExitAsync(CancellationToken.None);
            }
        }
    }

    private static async Task<byte[]> ReadBounded(Stream stream, int limit, CancellationToken token)
    {
        using var output = new MemoryStream();
        var buffer = new byte[8192];
        while (true)
        {
            int read = await stream.ReadAsync(buffer, token);
            if (read == 0) return output.ToArray();
            if (output.Length + read > limit) throw new SizeLimitException();
            output.Write(buffer, 0, read);
        }
    }
    private sealed class SizeLimitException : Exception;
}
