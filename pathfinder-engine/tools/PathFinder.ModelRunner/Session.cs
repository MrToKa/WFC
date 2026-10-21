using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;

internal static partial class Program
{
    private static Request SessionRequest(byte[] bytes)
    {
        using var document = SessionProtocol.Parse(bytes);
        var request = JsonSerializer.Deserialize<Request>(bytes, Json) ?? throw new InvalidDataException("A request is required.");
        Validate(request); return request;
    }
    private static byte[] SessionResult(object response, Request request, int ordinal, string reuse, bool retire)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new { schemaVersion = SessionProtocol.Version, type = "result", response,
            session = new { requestOrdinal = ordinal, preparedReuse = reuse, retireAfterResponse = retire } }, Json);
        if (bytes.Length <= MaximumOutput) return bytes;
        return JsonSerializer.SerializeToUtf8Bytes(new { schemaVersion = SessionProtocol.Version, type = "result",
            response = Failure(request, "resource_limit", "Output exceeds the byte budget."),
            session = new { requestOrdinal = ordinal, preparedReuse = "none", retireAfterResponse = true } }, Json);
    }
    private static async Task<int> RunSessionWorker()
    {
        using var input = Console.OpenStandardInput(); using var output = Console.OpenStandardOutput();
        var context = new SessionExecutionContext(); var lifetime = Stopwatch.StartNew();
        await SessionProtocol.WriteFrame(output, JsonSerializer.SerializeToUtf8Bytes(SessionProtocol.Ready(), Json), MaximumOutput, CancellationToken.None);
        for (var ordinal = 1; ordinal <= SessionProtocol.MaximumRequests; ordinal++)
        {
            using var idle = new CancellationTokenSource(SessionProtocol.IdleMilliseconds);
            byte[]? bytes;
            try { bytes = await SessionProtocol.ReadFrame(input, MaximumInput, idle.Token); }
            catch (OperationCanceledException) { return 0; }
            if (bytes is null) return 0;
            var request = SessionRequest(bytes); context.BeginRequest(); object response; var retire = ordinal == SessionProtocol.MaximumRequests;
            using var deadline = new CancellationTokenSource(request.TimeoutMilliseconds);
            try { response = Execute(request, deadline.Token, context); deadline.Token.ThrowIfCancellationRequested(); }
            catch (OperationCanceledException) { response = Failure(request, "deadline_exceeded", "Calculation deadline exceeded."); retire = true; }
            catch (Exception error) when (error is ArgumentException or JsonException or IOException or InvalidDataException or InvalidOperationException or OverflowException or FormatException or KeyNotFoundException or System.ComponentModel.Win32Exception)
            { response = Failure(request, "invalid_request", error is IOException ? "An owned input or cache file could not be read." : error.Message); retire = true; }
            using var element = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(response, Json));
            retire |= element.RootElement.GetProperty("status").GetString() is "resource_limit" or "deadline_exceeded"
                || lifetime.ElapsedMilliseconds >= SessionProtocol.LifetimeMilliseconds;
            var result = SessionResult(response, request, ordinal, context.Reuse, retire);
            using var writeDeadline = new CancellationTokenSource(SessionProtocol.StartupMilliseconds);
            await SessionProtocol.WriteFrame(output, result, MaximumOutput, writeDeadline.Token);
            using var sent = SessionProtocol.Parse(result);
            if (sent.RootElement.GetProperty("session").GetProperty("retireAfterResponse").GetBoolean()) return 0;
        }
        return 0;
    }
    private static Process SessionChild()
    {
        var info = new ProcessStartInfo(Environment.ProcessPath ?? throw new InvalidOperationException("Process path unavailable."))
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        if (Path.GetFileNameWithoutExtension(info.FileName).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) info.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        info.ArgumentList.Add("--session-worker");
        return Process.Start(info) ?? throw new InvalidOperationException("Worker could not start.");
    }
    private static async Task RetireSessionChild(Process child)
    {
        if (!child.HasExited) child.Kill(true);
        await child.WaitForExitAsync(CancellationToken.None);
    }
    private static async Task<T> SessionGuard<T>(Task<T> operation, Task<string> fault, CancellationToken token)
    {
        var completed = await Task.WhenAny(operation, fault).WaitAsync(token);
        if (completed == fault) throw new SessionBudgetException(await fault);
        return await operation;
    }
    private sealed class SessionBudgetException(string message) : IOException(message);
    private static async Task SessionStderr(Process child, TaskCompletionSource<string> fault, CancellationToken token)
    {
        try
        {
            var bytes = new byte[4096]; long total = 0; int count;
            while ((count = await child.StandardError.BaseStream.ReadAsync(bytes, token)) > 0)
            { total += count; if (total > 65536) { fault.TrySetResult("Worker stderr exceeds the lifetime byte budget."); return; } }
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (IOException) { fault.TrySetResult("Worker stderr failed."); }
    }
    private static async Task SessionMemory(Process child, TaskCompletionSource<string> fault, CancellationToken token)
    {
        try
        {
            using var self = Process.GetCurrentProcess(); using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(100));
            do
            {
                if (child.HasExited) return;
                self.Refresh(); child.Refresh();
                if (self.WorkingSet64 + child.WorkingSet64 > SessionProtocol.MaximumResidentBytes)
                { fault.TrySetResult("Combined worker RSS exceeds the sampled memory budget."); return; }
            } while (await timer.WaitForNextTickAsync(token));
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException)
        {
            // A child can exit immediately after publishing its final response.
            // Its exit is validated by the framed reader; it is not a live guard
            // failure and must not overwrite that response with resource_limit.
            try { if (child.HasExited) return; } catch (InvalidOperationException) { }
            fault.TrySetResult("Worker RSS guard is unavailable.");
        }
    }
    private static async Task<int> RunSessionSupervisor()
    {
        using var input = Console.OpenStandardInput(); using var output = Console.OpenStandardOutput();
        using var child = SessionChild(); using var laneStop = new CancellationTokenSource();
        var lifetime = Stopwatch.StartNew(); var fault = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var stderr = SessionStderr(child, fault, laneStop.Token); var memory = SessionMemory(child, fault, laneStop.Token);
        Task<byte[]?>? nextInput = null;
        TaskCompletionSource<bool>? nextActivity = null;
        try
        {
            using (var startup = new CancellationTokenSource(SessionProtocol.StartupMilliseconds))
            {
                var ready = await SessionGuard(SessionProtocol.ReadFrame(child.StandardOutput.BaseStream, MaximumOutput, startup.Token), fault.Task, startup.Token)
                    ?? throw new EndOfStreamException("Worker exited before ready.");
                SessionProtocol.ValidateReady(ready);
                await SessionProtocol.WriteFrame(output, ready, MaximumOutput, startup.Token);
            }
            for (var ordinal = 1; ordinal <= SessionProtocol.MaximumRequests; ordinal++)
            {
                var remaining = SessionProtocol.LifetimeMilliseconds - lifetime.ElapsedMilliseconds;
                if (remaining <= 0) return 0;
                nextInput ??= SessionProtocol.ReadFrame(input, MaximumInput, laneStop.Token);
                byte[]? bytes;
                using (var idle = new CancellationTokenSource((int)Math.Min(remaining, SessionProtocol.IdleMilliseconds)))
                {
                    try { bytes = await SessionGuard(nextInput, fault.Task, idle.Token); }
                    catch (OperationCanceledException) { return 0; }
                }
                if (bytes is null) return 0;
                var received = Stopwatch.StartNew(); var request = SessionRequest(bytes); byte[] result;
                // Observe the first byte, not just a complete subsequent frame.
                // A partial pipelined prefix/payload must not hide until A ends.
                var activity = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                nextActivity = activity;
                nextInput = SessionProtocol.ReadFrame(input, MaximumInput, laneStop.Token, () => activity.TrySetResult(true));
                using var deadline = new CancellationTokenSource(Math.Max(1, request.TimeoutMilliseconds - (int)received.ElapsedMilliseconds));
                try
                {
                    if (lifetime.ElapsedMilliseconds + request.TimeoutMilliseconds > SessionProtocol.LifetimeMilliseconds)
                        throw new OperationCanceledException("Insufficient session lifetime.");
                    await SessionProtocol.WriteFrame(child.StandardInput.BaseStream, bytes, MaximumInput, deadline.Token);
                    var responseRead = SessionProtocol.ReadFrame(child.StandardOutput.BaseStream, MaximumOutput, deadline.Token);
                    var competing = Task.WhenAny(responseRead, nextInput, activity.Task);
                    var winner = await SessionGuard(competing, fault.Task, deadline.Token);
                    if (winner == nextInput || winner == activity.Task || nextInput.IsCompleted || activity.Task.IsCompleted)
                        throw new InvalidDataException("Pipelined request or EOF while calculation was active.");
                    var responseBytes = await responseRead ?? throw new EndOfStreamException("Worker exited without a result.");
                    var wrapper = SessionProtocol.ValidateResult(responseBytes, request.RequestId, ordinal, request);
                    if (fault.Task.IsCompleted) throw new SessionBudgetException(await fault.Task);
                    deadline.Token.ThrowIfCancellationRequested();
                    var response = wrapper.GetProperty("response"); var status = response.GetProperty("status").GetString();
                    var retire = wrapper.GetProperty("session").GetProperty("retireAfterResponse").GetBoolean()
                        || ordinal == SessionProtocol.MaximumRequests || status is "resource_limit" or "deadline_exceeded";
                    result = SessionResult(response, request, ordinal, wrapper.GetProperty("session").GetProperty("preparedReuse").GetString()!, retire);
                }
                catch (OperationCanceledException)
                {
                    await RetireSessionChild(child);
                    result = SessionResult(Failure(request, "deadline_exceeded", "Calculation deadline exceeded."), request, ordinal, "none", true);
                }
                catch (SessionBudgetException error)
                {
                    await RetireSessionChild(child);
                    result = SessionResult(Failure(request, "resource_limit", error.Message), request, ordinal, "none", true);
                }
                // Protocol/process faults emit no misleading model result and retire in finally.
                // End this guard immediately before forwarding: once the peer
                // receives A, an immediate B is legal even if Flush is completing.
                if (nextActivity.Task.IsCompleted || nextInput.IsCompleted)
                    throw new InvalidDataException("Pipelined request or EOF before result forwarding.");
                using (var writeDeadline = new CancellationTokenSource(SessionProtocol.StartupMilliseconds))
                    await SessionProtocol.WriteFrame(output, result, MaximumOutput, writeDeadline.Token);
                using var sent = SessionProtocol.Parse(result);
                if (sent.RootElement.GetProperty("session").GetProperty("retireAfterResponse").GetBoolean()) return 0;
            }
            return 0;
        }
        finally
        {
            laneStop.Cancel(); input.Dispose(); await RetireSessionChild(child);
            await Task.WhenAll(stderr, memory);
            // A console pipe's underlying read is not cancellable on every OS.
            // Do not hold process retirement hostage to a still-open parent pipe.
            if (nextInput is { IsCompleted: true }) { try { await nextInput; } catch (Exception error) when (error is OperationCanceledException or IOException or JsonException or DecoderFallbackException or ObjectDisposedException) { } }
            else if (nextInput is not null) _ = nextInput.ContinueWith(task => { _ = task.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
        }
    }
}
