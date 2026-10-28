using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace AddinRibbon.Routing
{
    public sealed partial class RouteCalculator
    {
        private static void RecordUnpreparedCandidate()
        { var request = GraphPreparationRequest.Current; if (request != null) Interlocked.Increment(ref request.Diagnostics.candidates); }
        private static bool AddNeighbourConnections(List<Node> nodes, List<Piece> pieces,
            List<List<int>> segmentNodes, double tolerance, int maxNodes, int maxConnections,
            CancellationToken token, out GraphLimit limit, long graphStarted = 0)
        {
            var request = GraphPreparationRequest.Current;
            long started = graphStarted == 0 ? Stopwatch.GetTimestamp() : graphStarted;
            if (request != null) Interlocked.Increment(ref request.Diagnostics.builds);
            try
            {
                token.ThrowIfCancellationRequested();
                if (request == null || !request.Enabled)
                    return AddNeighbourConnectionsOriginal(nodes, pieces, segmentNodes, tolerance, maxNodes, maxConnections, token, out limit, null);
                long initialConnections = 0;
                foreach (var ordered in segmentNodes) initialConnections += ordered.Count - 1;
                // Preserve the original constructor's immediate ceiling before any cache fingerprint/restore work.
                if (initialConnections > maxConnections) { limit = GraphLimit.Connections; return false; }
                var preparation = new GraphPreparationState(request, pieces, tolerance, token, nodes.Count,
                    initialConnections, segmentNodes, maxNodes, maxConnections);
                if (preparation.Recipe == null)
                    return AddNeighbourConnectionsOriginal(nodes, pieces, segmentNodes, tolerance, maxNodes, maxConnections, token, out limit, preparation);
                var graph = new ContactGraph(nodes, segmentNodes, maxNodes, maxConnections, token, preparation);
                if (graph.Limit != GraphLimit.None) { limit = graph.Limit; return false; }
                long candidates = 0;
                foreach (var pair in preparation.Recipe.Pairs)
                {
                    if (++candidates > CandidateLimit(maxConnections)) { limit = GraphLimit.Candidates; return false; }
                    if ((candidates & 127) == 0) token.ThrowIfCancellationRequested();
                    Interlocked.Increment(ref request.Diagnostics.candidates);
                    if (!ApplyPreparedPair(pair, pieces, graph, tolerance))
                    { limit = graph.Limit; return false; }
                }
                graph.BuildEdges(token); limit = GraphLimit.None; return true;
            }
            finally { if (request != null) Interlocked.Add(ref request.Diagnostics.graphTicks, Stopwatch.GetTimestamp() - started); }
        }

        private static bool ApplyPreparedPair(GraphContactPair pair, List<Piece> pieces, ContactGraph graph, double tolerance)
        {
            var first = pieces[pair.First]; var last = pieces[pair.Last];
            if (pair.PortsOnly) return AddPortContacts(first, last, graph, tolerance);
            if (!graph.AddContact(first, last, pair.FirstFraction, pair.LastFraction, tolerance)) return false;
            if (pair.Overlap && pair.HighFirst != pair.FirstFraction && !graph.AddContact(first, last, pair.HighFirst, pair.HighLast, tolerance)) return false;
            return !pair.Overlap || graph.AddParallelAttachmentContacts(first, last, pair.FirstFraction, pair.HighFirst, tolerance);
        }

        private sealed class GraphPreparationState
        {
            internal readonly GraphPreparationRequest Request;
            internal GraphContactRecipe Recipe { get; private set; }
            private readonly string fingerprint;
            private readonly List<Piece> pieces;
            private readonly Dictionary<TrayMeshClearance, int> surfaceIds = new Dictionary<TrayMeshClearance, int>();
            private readonly List<TrayMeshClearance> surfaces = new List<TrayMeshClearance>();
            private List<GraphContactPair> captured = new List<GraphContactPair>();
            private Dictionary<long, GraphSurfaceRecord> measurements = new Dictionary<long, GraphSurfaceRecord>();
            private long estimatedBytes = 1024;
            internal GraphPreparationState(GraphPreparationRequest request, List<Piece> pieces, double tolerance, CancellationToken token,
                int initialNodes, long initialConnections, List<List<int>> segmentNodes, int maxNodes, int maxConnections)
            {
                Request = request; this.pieces = pieces;
                long started = Stopwatch.GetTimestamp();
                try { fingerprint = Fingerprint(pieces, tolerance, surfaceIds, surfaces, token); }
                finally { Interlocked.Add(ref request.Diagnostics.fingerprintTicks, Stopwatch.GetTimestamp() - started); }
                Recipe = request.Cache.Find(request.Namespace, fingerprint);
                if (Recipe != null && !Recipe.Validated)
                {
                    // Never perform whole-artifact validation ahead of a query whose original
                    // graph could hit a tighter cap. The upper bound includes every possible
                    // initial endpoint/parallel attachment and tied surface witness contact.
                    var restored = WithinImportLimits(Recipe, initialNodes, initialConnections, segmentNodes,
                        maxNodes, maxConnections, token) ? ValidateImported(Recipe, tolerance, token) : null;
                    if (restored == null) { request.Cache.Remove(Recipe); Recipe = null; }
                    else { request.Cache.Replace(Recipe, restored); Recipe = restored; }
                }
                if (Recipe != null)
                {
                    captured = null; measurements = null;
                    if (Recipe.Imported) Interlocked.Increment(ref request.Diagnostics.importedHits);
                    else Interlocked.Increment(ref request.Diagnostics.memoryHits);
                }
            }
            private bool WithinImportLimits(GraphContactRecipe recipe, int initialNodes, long initialConnections,
                List<List<int>> stations, int maxNodes, int maxConnections, CancellationToken token)
            {
                if (recipe.PieceCount != pieces.Count || recipe.SurfaceCount != surfaces.Count
                    || recipe.Pairs.LongLength > CandidateLimit(maxConnections)) return false;
                long nodes = initialNodes, connections = initialConnections;
                for (int i = 0; i < recipe.Pairs.Length; i++)
                {
                    if ((i & 127) == 0) token.ThrowIfCancellationRequested(); var pair = recipe.Pairs[i];
                    if (pair.First < 0 || pair.Last < 0 || pair.First >= pieces.Count || pair.Last >= pieces.Count) return false;
                    // Four port combinations may each introduce two tied surface
                    // witnesses plus its analytical contact (twelve Link calls).
                    long contacts = pair.PortsOnly ? 12 : 4;
                    if (pair.Overlap) contacts += (long)stations[pieces[pair.First].Segment].Count + stations[pieces[pair.Last].Segment].Count;
                    nodes += 2 * contacts; connections += 3 * contacts;
                    if (nodes > maxNodes || connections > maxConnections) return false;
                }
                return true;
            }
            internal void Capture(GraphContactPair pair)
            {
                Interlocked.Increment(ref Request.Diagnostics.candidates);
                if (captured == null) return;
                estimatedBytes += 64;
                if (estimatedBytes > Request.Cache.MaximumBytes / 2) { captured = null; measurements = null; return; }
                captured.Add(pair);
            }
            internal void Publish(CancellationToken token)
            {
                token.ThrowIfCancellationRequested(); if (captured == null) return;
                var recipe = new GraphContactRecipe(Request.Namespace, fingerprint, pieces.Count, surfaces.Count,
                    captured.ToArray(), measurements, false, true);
                if (recipe.EstimatedBytes <= Request.Cache.MaximumBytes)
                { Request.Cache.Store(recipe); Interlocked.Increment(ref Request.Diagnostics.basisBuilds); }
                captured = null; measurements = null;
            }
            internal TrayMeshClearanceResult Measure(TrayMeshClearance first, TrayMeshClearance last, double tolerance, CancellationToken token)
            {
                token.ThrowIfCancellationRequested(); int a = surfaceIds[first], b = surfaceIds[last];
                long key = ((long)a << 32) | (uint)b; GraphSurfaceRecord record;
                if (Recipe != null && Recipe.Surfaces.TryGetValue(key, out record))
                { Interlocked.Increment(ref Request.Diagnostics.surfaceHits); return record.Result; }
                long started = Stopwatch.GetTimestamp(); TrayMeshClearanceResult result;
                try { Interlocked.Increment(ref Request.Diagnostics.surfaceQueries); first.TryDistanceTo(last, tolerance, token, out result); }
                finally { Interlocked.Add(ref Request.Diagnostics.surfaceTicks, Stopwatch.GetTimestamp() - started); }
                token.ThrowIfCancellationRequested();
                if (captured != null)
                {
                    record = new GraphSurfaceRecord(a, b, result); estimatedBytes += 80 + record.EstimatedBytes;
                    if (estimatedBytes > Request.Cache.MaximumBytes / 2) { captured = null; measurements = null; }
                    else measurements.Add(key, record);
                }
                return result;
            }
            private GraphContactRecipe ValidateImported(GraphContactRecipe recipe, double tolerance, CancellationToken token)
            {
                if (recipe.PieceCount != pieces.Count || recipe.SurfaceCount != surfaces.Count) return null;
                var indices = Enumerable.Range(0, pieces.Count).Where(i => !pieces[i].EndsOnly || pieces[i].HasStartPort || pieces[i].HasEndPort).ToArray();
                long started = Stopwatch.GetTimestamp(); var tree = BuildAabbTree(pieces, indices, 0, indices.Length, token);
                Interlocked.Add(ref Request.Diagnostics.treeTicks, Stopwatch.GetTimestamp() - started);
                int position = 0, visits = 0;
                for (int i = 0; i < pieces.Count; i++)
                {
                    if ((i & 127) == 0) token.ThrowIfCancellationRequested();
                    if (pieces[i].EndsOnly && !pieces[i].HasStartPort && !pieces[i].HasEndPort) continue;
                    if (!ValidateCandidates(tree, indices, pieces, i, tolerance, recipe.Pairs, ref position, ref visits, token)) return null;
                }
                if (position != recipe.Pairs.Length) return null;
                var verified = new Dictionary<long, GraphSurfaceRecord>();
                foreach (var item in recipe.Surfaces.OrderBy(value => value.Key))
                {
                    token.ThrowIfCancellationRequested(); var record = item.Value;
                    started = Stopwatch.GetTimestamp(); TrayMeshClearanceResult result;
                    try { Interlocked.Increment(ref Request.Diagnostics.surfaceQueries); surfaces[record.First].TryDistanceTo(surfaces[record.Last], tolerance, token, out result); }
                    finally { Interlocked.Add(ref Request.Diagnostics.surfaceTicks, Stopwatch.GetTimestamp() - started); }
                    // Persisted numerical claims are checked against current immutable geometry once.
                    if (!SameSurfaceResult(result, record.Result)) return null;
                    verified.Add(item.Key, new GraphSurfaceRecord(record.First, record.Last, result));
                }
                return new GraphContactRecipe(recipe.Namespace, recipe.Geometry, recipe.PieceCount, recipe.SurfaceCount, recipe.Pairs, verified, true, true);
            }
        }

        private static string Fingerprint(List<Piece> pieces, double tolerance, Dictionary<TrayMeshClearance, int> ids,
            List<TrayMeshClearance> surfaces, CancellationToken token)
        {
            for (int i = 0; i < pieces.Count; i++)
            {
                if ((i & 127) == 0) token.ThrowIfCancellationRequested();
                foreach (var surface in pieces[i].Surfaces)
                    if (!ids.ContainsKey(surface)) { ids.Add(surface, surfaces.Count); surfaces.Add(surface); }
            }
            // Surface clearance resolves equal directional witnesses by instance creation order.
            // Bind its relative order, which survives reconstruction, rather than process-local ordinals.
            var ranks = new Dictionary<TrayMeshClearance, int>(); int rank = 0;
            foreach (var surface in surfaces.OrderBy(value => value.GraphOrdinal)) ranks.Add(surface, rank++);
            using (var hash = SHA256.Create())
            using (var stream = new CryptoStream(Stream.Null, hash, CryptoStreamMode.Write))
            using (var buffered = new BufferedStream(stream, 65536))
            using (var writer = new BinaryWriter(buffered, Encoding.UTF8, true))
            {
                writer.Write(GraphPreparationCache.Version); writer.Write(tolerance); writer.Write(pieces.Count);
                for (int i = 0; i < pieces.Count; i++)
                {
                    if ((i & 127) == 0) token.ThrowIfCancellationRequested(); var piece = pieces[i];
                    writer.Write(piece.Segment); GraphPreparationCache.WritePoint(writer, piece.Start); GraphPreparationCache.WritePoint(writer, piece.End);
                    writer.Write(piece.Along); writer.Write(piece.Length); writer.Write(piece.EndsOnly); writer.Write(piece.HasStartPort); writer.Write(piece.HasEndPort);
                    writer.Write(piece.Bounds.MinX); writer.Write(piece.Bounds.MinY); writer.Write(piece.Bounds.MinZ); writer.Write(piece.Bounds.MaxX); writer.Write(piece.Bounds.MaxY); writer.Write(piece.Bounds.MaxZ);
                    writer.Write(piece.VerifiedPorts.Count);
                    foreach (var port in piece.VerifiedPorts)
                    {
                        GraphPreparationCache.WritePoint(writer, port.Point); GraphPreparationCache.WritePoint(writer, port.Outward);
                        GraphPreparationCache.WritePoint(writer, port.U); GraphPreparationCache.WritePoint(writer, port.V); writer.Write(port.Width); writer.Write(port.Height);
                    }
                    writer.Write(piece.Surfaces.Count);
                    foreach (var surface in piece.Surfaces)
                    {
                        writer.Write(ids[surface]); writer.Write(ranks[surface]); writer.Write(surface.GraphIdentity(token));
                    }
                }
                writer.Flush(); stream.FlushFinalBlock(); token.ThrowIfCancellationRequested(); return GraphPreparationCache.Hex(hash.Hash);
            }
        }

        private static bool ValidateCandidates(AabbNode node, int[] indices, List<Piece> pieces, int firstIndex, double tolerance,
            GraphContactPair[] pairs, ref int position, ref int visits, CancellationToken token)
        {
            if ((++visits & 127) == 0) token.ThrowIfCancellationRequested(); var first = pieces[firstIndex];
            if (!Bounds.WithinTolerance(first.Bounds, node.Bounds, tolerance)) return true;
            if (node.Left != null) return ValidateCandidates(node.Left, indices, pieces, firstIndex, tolerance, pairs, ref position, ref visits, token)
                && ValidateCandidates(node.Right, indices, pieces, firstIndex, tolerance, pairs, ref position, ref visits, token);
            for (int offset = 0; offset < node.Count; offset++)
            {
                int lastIndex = indices[node.Start + offset]; if (lastIndex <= firstIndex) continue; var last = pieces[lastIndex];
                if (first.Segment == last.Segment || !Bounds.WithinTolerance(first.Bounds, last.Bounds, tolerance)) continue;
                if (position >= pairs.Length) return false; var pair = pairs[position++];
                if (pair.First != firstIndex || pair.Last != lastIndex || pair.PortsOnly != (first.EndsOnly || last.EndsOnly)) return false;
                if (pair.PortsOnly) { if (pair.Overlap || pair.FirstFraction != 0 || pair.LastFraction != 0 || pair.HighFirst != 0 || pair.HighLast != 0) return false; continue; }
                double a, b, highA, highB; bool overlap = ParallelContactRange(first, last, out a, out b, out highA, out highB);
                if (!overlap) ClosestPoints(first, last, out a, out b);
                if (pair.Overlap != overlap || !SameNumber(pair.FirstFraction, a) || !SameNumber(pair.LastFraction, b)
                    || !SameNumber(pair.HighFirst, overlap ? highA : 0) || !SameNumber(pair.HighLast, overlap ? highB : 0)) return false;
            }
            return true;
        }
        private static bool SameNumber(double first, double last) { return BitConverter.DoubleToInt64Bits(first) == BitConverter.DoubleToInt64Bits(last); }
        private static bool SamePointBits(RoutePoint a, RoutePoint b) { return SameNumber(a.X, b.X) && SameNumber(a.Y, b.Y) && SameNumber(a.Z, b.Z); }
        private static bool SameSurfaceResult(TrayMeshClearanceResult first, TrayMeshClearanceResult last)
        {
            if (first == null || last == null) return first == null && last == null;
            if (first.Contacts.Count != last.Contacts.Count) return false;
            for (int i = 0; i < first.Contacts.Count; i++)
                if (!SameNumber(first.Contacts[i].SquaredDistance, last.Contacts[i].SquaredDistance)
                    || !SamePointBits(first.Contacts[i].FirstPoint, last.Contacts[i].FirstPoint)
                    || !SamePointBits(first.Contacts[i].SecondPoint, last.Contacts[i].SecondPoint)) return false;
            return true;
        }
    }
}
