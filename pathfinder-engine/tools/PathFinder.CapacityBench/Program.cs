using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using PathFinder.Adapter;

namespace PathFinder.CapacityBench;

internal static class Program
{
    private static JsonSerializerOptions OutputOptions()
    {
        var options = new JsonSerializerOptions(Input.Json);
        options.Converters.Insert(0, new DecimalStrings()); return options;
    }
    private sealed class DecimalStrings : JsonConverter<decimal>
    {
        public override decimal Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
            ((JsonConverter<decimal>)PathfinderAdapter.JsonOptions.GetConverter(typeof(decimal))).Read(ref reader, type, PathfinderAdapter.JsonOptions);
        public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) => writer.WriteStringValue(value.ToString("0.############################", CultureInfo.InvariantCulture));
    }
    private static int Main(string[] args)
    {
        string? root = null; bool created = false;
        try
        {
            var selfTest = args.Length == 3 && args[0] == "--self-test" && args[1] == "--work-root";
            string? filename;
            if (selfTest) { root = args[2]; filename = null; }
            else if (args.Length == 4 && args[0] == "--manifest" && args[2] == "--work-root") { filename = args[1]; root = args[3]; }
            else throw new ArgumentException("Usage: --manifest <absolute input JSON> --work-root <absent absolute directory>, or --self-test --work-root <absent absolute directory>.");
            BenchManifest manifest; string manifestHash;
            Input.AbsoluteSafePath(root); root = Path.GetFullPath(root);
            if (selfTest)
            {
                Input.CreateWorkRoot(root); created = true;
                (manifest, filename) = SelfTestInput(root);
                manifest = Input.ReadManifest(filename); manifestHash = Input.Hash(Input.ReadFile(filename, Input.MaximumManifestBytes));
            }
            else
            {
                manifest = Input.ReadManifest(filename!);
                _ = Input.Snapshot(manifest.Snapshot, CancellationToken.None); // Integrity and identities before any owned output is created.
                manifestHash = Input.Hash(Input.ReadFile(filename!, Input.MaximumManifestBytes));
                Input.CreateWorkRoot(root); created = true;
            }
            var result = Benchmark.Run(manifest, root, manifestHash);
            using var document = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(result, OutputOptions()));
            var success = document.RootElement.GetProperty("status").GetString() == "PASS";
            if (selfTest) SelfCheck(document.RootElement);
            var bytes = JsonSerializer.SerializeToUtf8Bytes(result, OutputOptions());
            if (bytes.Length > Input.MaximumOutputBytes) throw new InvalidOperationException("Benchmark receipt exceeded its 2MiB budget.");
            Input.NewFile(Path.Combine(root, "result.json"), bytes); Console.Out.WriteLine(System.Text.Encoding.UTF8.GetString(bytes)); return success ? 0 : 1;
        }
        catch (Exception error) when (Benchmark.Controlled(error) || error is OperationCanceledException or KeyNotFoundException)
        {
            var code = created ? error is OperationCanceledException ? "BENCHMARK_TIMEOUT" : "BENCHMARK_FAILED" : "INVALID_INPUT";
            var message = error.Message.Replace('\r', ' ').Replace('\n', ' '); if (message.Length > 1024) message = message[..1024];
            var result = JsonSerializer.SerializeToUtf8Bytes(new { schemaVersion = "pathfinder.capacity.result.v1", recordedAtUtc = DateTimeOffset.UtcNow, status = "FAIL",
                error = new { code, message }, workRootCreated = created, engineeringAcceptance = false }, OutputOptions());
            Console.Out.WriteLine(System.Text.Encoding.UTF8.GetString(result)); return created ? 1 : 2;
        }
    }
    private static (BenchManifest Manifest, string Filename) SelfTestInput(string root)
    {
        var request = new CalculationInput
        {
            Category = "Instrumentation", From = [0, 0, .1], To = [16, 0, .1], ConnectionGap = "1",
            Options = new() { ConnectionToleranceMeters = 1, SampleSpacingMeters = .125, SecondaryDistanceMeters = 2,
                PreferVerticalApproach = true, MaxGraphNodes = 200000, MaxGraphConnections = 1000000 },
            ProjectSettings = new() { Revision = "1", SecondaryTrayLength = 5, EndConnectionLength = 6, AdditionalBendingPercent = 10 }
        };
        var seed = Path.Combine(root, "seed"); Directory.CreateDirectory(seed);
        var input = Synthetic.Create(seed, 8, request);
        var manifest = new BenchManifest { SchemaVersion = "pathfinder.capacity.input.v1", Label = "Explicit mathematical self-test, not converted-model evidence",
            Snapshot = input.Snapshot, Request = input.Request, RepeatQueries = 2, CaseTimeoutMilliseconds = 30000, TotalTimeoutMilliseconds = 180000, SyntheticSizes = [8, 64] };
        var filename = Path.Combine(seed, "manifest.json"); Input.NewFile(filename, JsonSerializer.SerializeToUtf8Bytes(manifest, OutputOptions()));
        return (manifest, filename);
    }
    private static void SelfCheck(JsonElement result)
    {
        if (result.GetProperty("status").GetString() != "PASS") throw new InvalidOperationException("Mathematical self-test did not pass.");
        var datasets = result.GetProperty("datasets").EnumerateArray().ToArray();
        foreach (var dataset in datasets)
        {
            var phases = dataset.GetProperty("phases").EnumerateArray().ToArray();
            if (phases.Any(phase => phase.GetProperty("status").GetString() != "PASS")
                || phases.Single(phase => phase.GetProperty("name").GetString() == "cold-fit").GetProperty("loadedFromDisk").GetBoolean()
                || !phases.Single(phase => phase.GetProperty("name").GetString() == "warm-disk-fit").GetProperty("loadedFromDisk").GetBoolean()
                || !phases.Single(phase => phase.GetProperty("name").GetString() == "memory-fit-hit").GetProperty("reusesPreparedReference").GetBoolean())
                throw new InvalidOperationException("Cache lifecycle or semantic equality self-test failed.");
        }
        var first = datasets[0].GetProperty("phases").EnumerateArray().Single(phase => phase.GetProperty("name").GetString() == "cold-query").GetProperty("semantic");
        if (first.GetProperty("route").GetProperty("lengthMeters").GetDouble() != 16 || first.GetProperty("design").GetProperty("designLengthMeters").GetString() != "25"
            || first.GetProperty("effectiveCategory").GetString() != "Control") throw new InvalidOperationException("Independent 16m/25m/Instrumentation mathematical expectation failed.");
    }
}
