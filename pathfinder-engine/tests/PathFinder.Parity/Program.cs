using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using AddinRibbon.Routing;

internal static class Program
{
    private const string PinnedInputsHash = "1fd49428742284e30071a0b293cca0a8f5eff8b47a2aaab10f1184cf73cd7e78";
    private const string PinnedExpectedHash = "43ea08d2e7e5ff4e56d1fe5c4435bada300a215b0da3164f5179d27ca4b23a5a";
    private const double NumericTolerance = 1e-9;
    private static readonly HashSet<string> DiscreteNumbers = new(StringComparer.Ordinal)
    {
        "schemaVersion", "validatedBends", "fallbackBends", "validatedStraights", "fallbackStraights",
        "fallbackClearances", "connectionGapCount", "categories", "connectionSurfaceCount", "ownerIndex"
    };
    private static readonly List<object> Checks = new();
    private static readonly List<string> Failures = new();

    private static int Main(string[] args)
    {
        try
        {
            var root = args.Length > 0 ? Path.GetFullPath(args[0]) : FindRoot();
            var evidenceDir = args.Length > 1 ? Path.GetFullPath(args[1]) : Path.Combine(root, "docs/pathfinder/evidence/pf1");
            var inputsPath = Path.Combine(root, "docs/pathfinder/fixtures/pf-core-v1.inputs.json");
            var expectedPath = Path.Combine(root, "docs/pathfinder/fixtures/pf-core-v1.expected.json");
            Assert("frozen-inputs-sha256", Hash(inputsPath) == PinnedInputsHash, Hash(inputsPath));
            Assert("frozen-expected-sha256", Hash(expectedPath) == PinnedExpectedHash, Hash(expectedPath));
            using var inputDocument = JsonDocument.Parse(File.ReadAllBytes(inputsPath));
            using var expectedDocument = JsonDocument.Parse(File.ReadAllBytes(expectedPath));
            var inputs = inputDocument.RootElement.GetProperty("cases").EnumerateArray().ToArray();
            var expected = expectedDocument.RootElement.GetProperty("cases").EnumerateArray()
                .ToDictionary(c => c.GetProperty("id").GetString(), StringComparer.Ordinal);
            Assert("frozen-case-count", inputs.Length == 43 && expected.Count == 43, $"input={inputs.Length};expected={expected.Count}");
            var actual = new List<object>();
            var replayDetails = new List<object>();
            foreach (var item in inputs)
            {
                var id = item.GetProperty("id").GetString();
                var kind = item.GetProperty("kind").GetString();
                var value = FrozenReplay.Evaluate(kind, item.GetProperty("input"));
                var result = JsonSerializer.SerializeToElement(value);
                var differences = new List<string>();
                Compare(expected[id].GetProperty("output"), result, id, differences);
                Assert("golden:" + id, differences.Count == 0, differences.Count == 0 ? "matched" : string.Join("; ", differences));
                var repeated = JsonSerializer.SerializeToElement(FrozenReplay.Evaluate(kind, item.GetProperty("input")));
                Assert("repeat:" + id, result.GetRawText() == repeated.GetRawText(), "same input serialized twice against extracted DLL");
                actual.Add(new { id, kind, output = result });
                replayDetails.Add(new { id, kind, status = differences.Count == 0 ? "PASS" : "FAIL", differences });
            }
            ComparatorControls();
            BoundaryTests.Run(root, Assert);
            var loadedAssembly = typeof(RouteCalculator).Assembly;
            Assert("core-is-separate-assembly", loadedAssembly != typeof(Program).Assembly, loadedAssembly.Location);
            var references = loadedAssembly.GetReferencedAssemblies().Select(a => a.Name).ToArray();
            Assert("core-has-no-native-or-desktop-references", !references.Any(name => name.Contains("Autodesk", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Navisworks", StringComparison.OrdinalIgnoreCase) || name is "System.Windows.Forms" or "PresentationFramework" or "PresentationCore"),
                string.Join(", ", references));
            Directory.CreateDirectory(evidenceDir);
            var receipt = new
            {
                stage = "PF-1", check = "golden-replay-and-boundaries", status = Failures.Count == 0 ? "PASS" : "FAIL",
                observedAtUtc = DateTimeOffset.UtcNow, coreAssembly = loadedAssembly.GetName().Name,
                coreAssemblyPath = loadedAssembly.Location, coreAssemblySha256 = Hash(loadedAssembly.Location),
                inputsSha256 = Hash(inputsPath), expectedSha256 = Hash(expectedPath),
                numericAbsoluteToleranceMeters = NumericTolerance, discreteFieldsExact = true,
                decimalStringsExact = true, replayCaseCount = inputs.Length,
                passedChecks = Checks.Count - Failures.Count, failedChecks = Failures.Count,
                limitations = new[] { "Synthetic frozen inputs only; native/converted real-model parity not established.", "Test-only internal constructors are used for synthetic design fixtures; production transport validation is tested separately." },
                cases = replayDetails, checks = Checks, failures = Failures
            };
            var receiptJson = JsonSerializer.Serialize(receipt, JsonOptions) + "\n";
            File.WriteAllText(Path.Combine(evidenceDir, "parity-run-" + DateTimeOffset.UtcNow.ToString("yyyyMMddTHHmmssfffZ", CultureInfo.InvariantCulture) + ".json"), receiptJson);
            File.WriteAllText(Path.Combine(evidenceDir, "parity-results.json"), receiptJson);
            File.WriteAllText(Path.Combine(evidenceDir, "parity-replayed.json"), JsonSerializer.Serialize(new { cases = actual }, JsonOptions) + "\n");
            Console.WriteLine($"PF-1 parity: {inputs.Length} golden cases; {Checks.Count - Failures.Count}/{Checks.Count} checks passed.");
            foreach (var failure in Failures) Console.Error.WriteLine(failure);
            return Failures.Count == 0 ? 0 : 1;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            return 2;
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private static void Assert(string name, bool condition, string detail)
    {
        Checks.Add(new { name, status = condition ? "PASS" : "FAIL", detail });
        if (!condition) Failures.Add(name + ": " + detail);
    }

    internal static void Compare(JsonElement expected, JsonElement actual, string path, List<string> differences)
    {
        if (expected.ValueKind != actual.ValueKind)
        {
            differences.Add($"{path}: kind {expected.ValueKind} != {actual.ValueKind}");
            return;
        }
        switch (expected.ValueKind)
        {
            case JsonValueKind.Object:
                var expectedProperties = expected.EnumerateObject().ToArray();
                var actualProperties = actual.EnumerateObject().ToArray();
                var expectedNames = expectedProperties.Select(p => p.Name).Order(StringComparer.Ordinal);
                var actualNames = actualProperties.Select(p => p.Name).Order(StringComparer.Ordinal);
                if (!expectedNames.SequenceEqual(actualNames)) differences.Add(path + ": property set differs");
                foreach (var property in expectedProperties)
                    if (actual.TryGetProperty(property.Name, out var other)) Compare(property.Value, other, path + "." + property.Name, differences);
                break;
            case JsonValueKind.Array:
                if (expected.GetArrayLength() != actual.GetArrayLength()) differences.Add(path + ": array length differs");
                for (var index = 0; index < Math.Min(expected.GetArrayLength(), actual.GetArrayLength()); index++)
                    Compare(expected[index], actual[index], $"{path}[{index}]", differences);
                break;
            case JsonValueKind.Number:
                var tail = path[(path.LastIndexOf('.') + 1)..];
                if (DiscreteNumbers.Contains(tail))
                {
                    if (expected.GetDecimal() != actual.GetDecimal()) differences.Add($"{path}: exact discrete value differs");
                    break;
                }
                var a = expected.GetDouble();
                var b = actual.GetDouble();
                if (!double.IsFinite(a) || !double.IsFinite(b) || Math.Abs(a - b) > NumericTolerance)
                    differences.Add($"{path}: {a.ToString("R", CultureInfo.InvariantCulture)} != {b.ToString("R", CultureInfo.InvariantCulture)}; delta={Math.Abs(a - b).ToString("R", CultureInfo.InvariantCulture)}");
                break;
            case JsonValueKind.String:
                if (expected.GetString() != actual.GetString()) differences.Add($"{path}: string differs ({expected.GetString()} != {actual.GetString()})");
                break;
            default:
                if (expected.GetRawText() != actual.GetRawText()) differences.Add(path + ": discrete value differs");
                break;
        }
    }

    private static void ComparatorControls()
    {
        foreach (var (name, before, after) in new[]
        {
            ("discrete-integer", "{\"connectionGapCount\":1}", "{\"connectionGapCount\":2}"),
            ("ordered-ids", "[\"a\",\"b\"]", "[\"b\",\"a\"]"),
            ("decimal-string", "\"12.34567890123456789\"", "\"12.34567890123456788\""),
            ("numeric-above-tolerance", "1.0", "1.00000001")
        })
        {
            using var first = JsonDocument.Parse(before);
            using var second = JsonDocument.Parse(after);
            var differences = new List<string>();
            Compare(first.RootElement, second.RootElement, "control", differences);
            Assert("comparator-rejects:" + name, differences.Count != 0, string.Join("; ", differences));
        }
        using var insideFirst = JsonDocument.Parse("1.0");
        using var insideSecond = JsonDocument.Parse("1.0000000001");
        var inside = new List<string>();
        Compare(insideFirst.RootElement, insideSecond.RootElement, "control", inside);
        Assert("comparator-accepts:within-tolerance", inside.Count == 0, "absolute delta 1e-10m");
    }

    private static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
    private static string FindRoot()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory); current != null; current = current.Parent)
            if (File.Exists(Path.Combine(current.FullName, "docs/pathfinder/fixtures/pf-core-v1.inputs.json"))) return current.FullName;
        throw new DirectoryNotFoundException("Pass the isolated WFC worktree path as the first argument.");
    }
}
