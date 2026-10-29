using System.Text.Json;

namespace PathFinder.BarrierVerifier;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        // Only this exact complete argument list selects the additive policy.
        // Unknown arguments keep the existing v1 refusal and never read stdin.
        bool largeSelection = args.Length == 1 && args[0] == "--mixed-v2-2048";
        bool mixed = largeSelection || args.Length == 1 && args[0] == "--mixed-v2";
        int maximumReceiptBytes = largeSelection ? MixedBarrierCaptureVerifier.LargeSelectionMaximumReceiptBytes : MixedBarrierCaptureVerifier.MaximumReceiptBytes;
        BarrierVerifierReceipt? receipt = null;
        MixedBarrierVerifierReceipt? mixedReceipt = null;
        try
        {
            if (args.Length != 0 && !mixed) throw new VerifierRefusal("INVALID_COMMAND", "Use bounded UTF-8 JSON stdin only; filesystem paths and URLs are not accepted.");
            using var deadline = new CancellationTokenSource(60_000);
            using var input = Console.OpenStandardInput(); using var memory = new MemoryStream();
            var buffer = new byte[65536]; int read;
            while ((read = await input.ReadAsync(buffer, deadline.Token)) != 0)
            {
                if (memory.Length + read > 32 * 1024 * 1024) throw new VerifierRefusal("CAPTURE_BYTES_LIMIT", "Capture stdin exceeded32MiB; no complete input digest was computed.");
                await memory.WriteAsync(buffer.AsMemory(0, read), deadline.Token);
            }
            if (mixed) mixedReceipt = MixedBarrierCaptureVerifier.Verify(memory.ToArray(), largeSelection
                ? new BarrierVerifierLimits { MaximumParents = 2048, MaximumComputationalMeshes = 2048 } : null,
                cancellationToken: deadline.Token, maximumReceiptBytes: maximumReceiptBytes).Receipt;
            else receipt = BarrierCaptureVerifier.Verify(memory.ToArray(), cancellationToken: deadline.Token).Receipt;
        }
        catch (Exception error) when (error is VerifierRefusal or OperationCanceledException or IOException or JsonException)
        {
            var diagnostics = Array.AsReadOnly(new[] { new BarrierVerifierDiagnostic(
                error is VerifierRefusal refusal ? refusal.Code : error is OperationCanceledException ? "DEADLINE_EXCEEDED" : "INPUT_UNAVAILABLE",
                error is VerifierRefusal ? error.Message : "Bounded stdin capture could not be completely qualified.") });
            if (mixed) mixedReceipt = new("refused", null, null, diagnostics);
            else receipt = new("refused", null, null, diagnostics);
        }
        var bytes = mixed
            ? MixedBarrierCaptureVerifier.ReceiptBytes(mixedReceipt ?? throw new InvalidOperationException("Mixed receipt is unavailable."), maximumReceiptBytes)
            : BarrierCaptureVerifier.ReceiptBytes(receipt ?? throw new InvalidOperationException("Legacy receipt is unavailable."));
        await Console.OpenStandardOutput().WriteAsync(bytes); Console.WriteLine();
        return 0; // Logical success/refusal is the closed status field, not exit0.
    }
}
