using System.Text.Json;
using PathFinder.Model;
if (args.Length != 1) throw new ArgumentException("Pass the generated owned normalizer snapshot path.");
var bytes = File.ReadAllBytes(args[0]);
var snapshot = SnapshotReader.Read(bytes);
if (snapshot.Capture.InventoryComplete || snapshot.Capture.GeometryComplete || snapshot.Capture.PlanningVisibilityKnown || snapshot.Capture.SourceLinkVerified)
    throw new InvalidOperationException("A bounded normalized capture must not acquire unsupported completeness/readiness proofs.");
if (snapshot.Objects.Any(value => value.GeometryRole != "routing-leaf" || value.NativeHidden != null || value.AllowedCategories.Length != 0 || value.CategoryAssignmentSource != "unassigned"))
    throw new InvalidOperationException("Raw capture unknowns were promoted at the strict Model boundary.");
Console.WriteLine(JsonSerializer.Serialize(new { status = "PASS", scope = "normalizer-to-strict-model-contract", sourceKind = snapshot.Capture.SourceKind,
    objectCount = snapshot.Objects.Length, canonicalVertices = snapshot.Objects.Sum(value => value.Fragments.Sum(fragment => fragment.Vertices.Length)), snapshotSha256 = SnapshotReader.Sha256(bytes) }));
