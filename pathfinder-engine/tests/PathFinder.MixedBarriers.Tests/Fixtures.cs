using System.Collections;
using System.Text.Json;
using System.Text.Json.Nodes;
using PathFinder.Barriers;
using static Fixtures;

internal static class MixedFixtures
{
    internal static Mesh Wall() => new([P(0, -2, -2), P(0, 2, -2), P(0, 2, 2), P(0, -2, 2)], [0, 1, 2, 0, 2, 3]);
    internal static Mesh Ring()
    {
        var outer = new[] { P(0, -2, -2), P(0, 2, -2), P(0, 2, 2), P(0, -2, 2) };
        var inner = new[] { P(0, -.6, -.8), P(0, .6, -.8), P(0, .6, .8), P(0, -.6, .8) };
        var indices = new List<int>(); for (int i = 0; i < 4; i++) { int j = (i + 1) % 4; indices.AddRange([i, 4 + i, 4 + j, i, 4 + j, j]); }
        return new(outer.Concat(inner).ToArray(), indices.ToArray());
    }
    internal static Mesh Transform(Mesh mesh, Func<BarrierPoint, BarrierPoint> apply) => new(mesh.Vertices.Select(apply).ToArray(), mesh.Indices.ToArray());
    internal static Mesh Reverse(Mesh mesh) { var indices = mesh.Indices.ToArray(); for (int at = 0; at < indices.Length; at += 3) (indices[at + 1], indices[at + 2]) = (indices[at + 2], indices[at + 1]); return new(mesh.Vertices.ToArray(), indices); }
    internal static MixedFragmentInput Input(Mesh mesh, int fragment = 1, IReadOnlyList<string>? parents = null)
    {
        long[] matrix = new double[] { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 }.Select(BitConverter.DoubleToInt64Bits).ToArray();
        return new(new(fragment, "dbid:10", parents ?? new[] { Id(201) }, new string('a', 64), new string('2', 64), "m", 1, matrix), mesh.Vertices, mesh.Indices);
    }
    internal static JsonObject LargeMembershipCapture()
    {
        var meshes = Enumerable.Range(0, 20).Select(i => new Mesh([P(i * 3, 0), P(i * 3, 1), P(i * 3, 0, 1)], [0, 1, 2])).ToArray();
        var capture = Capture(Merge(meshes), splitTriangles: true);
        var selected = new JsonArray(); var memberships = new JsonArray();
        for (int at = 0; at < 128; at++)
        {
            string id = Id(201 + at); memberships.Add(id);
            selected.Add(JsonSerializer.SerializeToNode(new { selectionId = id, kind = "wall", objectId = "dbid:" + (10 + at), dbId = 10 + at,
                externalId = (string?)null, name = "Synthetic selected surface", identityBasis = "version-local-only", inclusion = "own-and-all-descendant-fragments" }));
        }
        capture["selectedParents"] = selected;
        foreach (var fragment in capture["fragments"]!.AsArray()) fragment!["source"]!["parentSelectionIds"] = memberships.DeepClone();
        return capture;
    }
    internal sealed class CancellingIndices(IReadOnlyList<int> source, CancellationTokenSource cancellation) : IReadOnlyList<int>
    {
        public int Count => source.Count;
        public int this[int index] { get { int value = source[index]; if (index == source.Count - 1) cancellation.Cancel(); return value; } }
        public IEnumerator<int> GetEnumerator() => source.GetEnumerator(); IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }
}
