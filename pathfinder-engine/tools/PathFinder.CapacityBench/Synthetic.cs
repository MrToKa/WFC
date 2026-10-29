using System.Globalization;
using System.Text;
using System.Text.Json;
using PathFinder.Model;

namespace PathFinder.CapacityBench;

internal static class Synthetic
{
    internal static readonly double[] Identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    internal static DatasetInput Create(string root, int count, CalculationInput settings)
    {
        var project = "00000000-0000-4000-8000-000000000001";
        var model = "00000000-0000-4000-8000-000000000002";
        var objects = new List<SnapshotObject>();
        for (var index = 0; index < count; index++)
        {
            double x = 2 * index, end = x + 2;
            var vertices = new double[][] { [x, -.1, 0], [end, -.1, 0], [end, .1, 0], [x, .1, 0], [x, -.1, .2], [end, -.1, .2], [end, .1, .2], [x, .1, .2] };
            var code = "/CAP" + (index + 1).ToString("D6", CultureInfo.InvariantCulture);
            objects.Add(new SnapshotObject
            {
                Id = "synthetic:capacity:" + index.ToString("D6", CultureInfo.InvariantCulture), ParentId = null, Name = "STRAIGHT", GeometryRole = "routing-leaf",
                LeafToRootNames = ["STRAIGHT", code], Properties = [], NativeHidden = false, PlanningExcluded = false,
                RouteName = code, ShapeName = "STRAIGHT", CategoryAssignmentSource = "synthetic", AllowedCategories = ["MV", "LV", "Control"],
                Bounds = new() { Minimum = [x, -.1, 0], Maximum = [end, .1, .2] },
                Fragments = [new() { Id = "synthetic:fragment:" + index, Vertices = vertices,
                    TriangleIndices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5],
                    FragmentToWorldMetres = Identity, TransformAlreadyApplied = true }]
            });
        }
        var content = Input.Hash(Encoding.UTF8.GetBytes("mathematical-capacity-chain-v1:" + count));
        var snapshot = new ModelSnapshot
        {
            SchemaVersion = "pathfinder.model.snapshot.v1", Model = new() { ProjectId = project, ModelVersionId = model, ContentSha256 = content },
            Capture = new() { AdapterVersion = "pf2.capacity.synthetic-chain.v1", SourceKind = "synthetic", InventoryComplete = true, GeometryComplete = true,
                UnitsVerified = true, TransformsVerified = true, PlanningVisibilityKnown = true, SourceLinkVerified = false, EvidenceSha256 = [] },
            Coordinates = new() { VertexFrame = "canonical-world-metres", SourceUnits = "metres", MetresPerSourceUnit = 1, SourceToWorldMetres = Identity,
                GlobalOffsetMetres = [0, 0, 0], DisplayToWorldMetres = Identity }, Objects = objects.ToArray()
        };
        var bytes = JsonSerializer.SerializeToUtf8Bytes(snapshot, SnapshotReader.JsonOptions);
        var directory = Path.Combine(root, "inputs"); Directory.CreateDirectory(directory);
        var filename = Path.Combine(directory, "chain-" + count + ".json"); Input.NewFile(filename, bytes);
        var request = settings with { From = [0, 0, .1], To = [2 * count, 0, .1] };
        var expected = new ExpectedSynthetic(2 * count,
            decimal.Ceiling((2m * count + settings.ProjectSettings.EndConnectionLength) * (1 + settings.ProjectSettings.AdditionalBendingPercent / 100m)).ToString("0", CultureInfo.InvariantCulture), count);
        return new("Mathematical chain of " + count + " straight 2m segments", "synthetic",
            new() { Path = filename, Sha256 = Input.Hash(bytes), ProjectId = project, ModelVersionId = model, ContentSha256 = content }, request, expected);
    }
}
