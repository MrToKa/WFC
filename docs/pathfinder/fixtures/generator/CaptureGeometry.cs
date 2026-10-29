using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using AddinRibbon.Routing;

// Captures synthetic mesh inputs from the unchanged existing test fixture
// factory. It performs no independent mesh reconstruction or route math.
internal static class CaptureGeometry
{
    private static int Main(string[] args)
    {
        if (args.Length != 2) throw new ArgumentException("Expected existing corpus and augmented output paths.");
        using (var document = JsonDocument.Parse(File.ReadAllText(args[0])))
        {
            var cases = document.RootElement.GetProperty("cases").EnumerateArray().Select(value => (object)value.Clone()).ToList();
            cases.Add(Capture("geometry-measured-circular-30", 30, false, false));
            cases.Add(Capture("geometry-measured-vertical-90-with-support", 90, true, true));
            var corpus = new { schemaVersion = 1, artifact = "inputs", provenance = "synthetic-core-extraction",
                coreCommit = "45c24bf5f433f13e102600b36f20327c77961d0a", units = "m", cases };
            File.WriteAllText(args[1], JsonSerializer.Serialize(corpus, new JsonSerializerOptions { WriteIndented = true }) + "\n", new UTF8Encoding(false));
        }
        return 0;
    }

    private static object Capture(string id, double degrees, bool vertical, bool hardware)
    {
        var factory = typeof(GeometryTests).GetMethod("CircularMeshFixture", BindingFlags.NonPublic | BindingFlags.Static);
        var fixture = factory.Invoke(null, new object[] { degrees, vertical, hardware });
        var type = fixture.GetType();
        var inputs = (TrayGeometryInput[])type.GetField("Inputs").GetValue(fixture);
        var from = (RoutePoint)type.GetField("From").GetValue(fixture);
        var to = (RoutePoint)type.GetField("To").GetValue(fixture);
        return new { id, kind = "geometry-route", basis = "captured unchanged GeometryTests.CircularMeshFixture input; not a converted model",
            sourceReferences = new[] { new { path = "tests/PathFinder.Routing.Tests/GeometryTests.cs", line = 316 } },
            input = new { geometry = inputs.Select(Input).ToArray(), from = P(from), to = P(to), category = 4,
                options = new { connectionToleranceMeters = 0.25, sampleSpacingMeters = 0.125,
                    secondaryDistanceMeters = 2, preferVerticalApproach = false,
                    maxGraphNodes = 500000, maxGraphConnections = 2000000 } } };
    }

    private static double[] P(RoutePoint value) { return new[] { value.X, value.Y, value.Z }; }
    private static object Input(TrayGeometryInput value)
    {
        return new { id = value.Id, routeName = value.RouteName, categories = (int)value.Categories,
            shapeName = value.ShapeName, minimum = P(value.Minimum), maximum = P(value.Maximum),
            faceExtents = value.FaceExtents.Select(face => new { face = (int)face.Face, minimum = P(face.Minimum),
                maximum = P(face.Maximum), sampleCount = face.SampleCount }).ToArray(),
            meshFragments = value.Mesh == null ? null : value.Mesh.Fragments.Select(fragment =>
                new { vertices = fragment.Vertices.Select(P).ToArray(), triangleIndices = fragment.TriangleIndices }).ToArray() };
    }
}

