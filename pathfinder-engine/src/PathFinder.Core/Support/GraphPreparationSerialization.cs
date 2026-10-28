using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace AddinRibbon.Routing
{
    public sealed partial class GraphPreparationCache
    {
        /// <summary>Export complete immutable recipes only. No route, endpoint, graph adjacency or barrier evidence is persisted.</summary>
        public byte[] Export(string identity, CancellationToken token = default(CancellationToken))
        {
            token.ThrowIfCancellationRequested(); var name = Identity(identity); GraphContactRecipe[] selected;
            lock (gate) selected = entries.Values.Where(value => value.Namespace == name).OrderBy(value => value.Geometry, StringComparer.Ordinal).ToArray();
            if (selected.Length == 0) return null;
            using (var stream = new MemoryStream())
            using (var writer = new BinaryWriter(stream, Encoding.UTF8, true))
            {
                WriteText(writer, Version); WriteText(writer, name); writer.Write(selected.Length);
                foreach (var recipe in selected)
                {
                    token.ThrowIfCancellationRequested(); WriteText(writer, recipe.Geometry);
                    writer.Write(recipe.PieceCount); writer.Write(recipe.SurfaceCount); writer.Write(recipe.Pairs.Length);
                    for (int i = 0; i < recipe.Pairs.Length; i++)
                    {
                        if ((i & 255) == 0) { token.ThrowIfCancellationRequested(); if (stream.Length > maxBytes - 1024) return null; }
                        var pair = recipe.Pairs[i]; writer.Write(pair.First); writer.Write(pair.Last); writer.Write(pair.PortsOnly); writer.Write(pair.Overlap);
                        writer.Write(pair.FirstFraction); writer.Write(pair.LastFraction); writer.Write(pair.HighFirst); writer.Write(pair.HighLast);
                    }
                    writer.Write(recipe.Surfaces.Count);
                    foreach (var item in recipe.Surfaces.OrderBy(value => value.Key))
                    {
                        token.ThrowIfCancellationRequested(); var record = item.Value;
                        if (stream.Length > maxBytes - 1024) return null;
                        writer.Write(record.First); writer.Write(record.Last); writer.Write(record.Result == null ? 0 : record.Result.Contacts.Count);
                        if (record.Result != null) foreach (var contact in record.Result.Contacts)
                        { writer.Write(contact.SquaredDistance); WritePoint(writer, contact.FirstPoint); WritePoint(writer, contact.SecondPoint); }
                    }
                }
                writer.Flush(); if (stream.Length > maxBytes - 32) return null;
                byte[] checksum; using (var hash = SHA256.Create()) checksum = hash.ComputeHash(stream.GetBuffer(), 0, checked((int)stream.Length));
                writer.Write(checksum); writer.Flush(); token.ThrowIfCancellationRequested(); return stream.ToArray();
            }
        }
        /// <summary>Admit a bounded checksummed artifact. Geometry/port/surface identity is recomputed again before use.
        /// Invalid or incompatible data is a cache miss; cancellation is never swallowed.</summary>
        public bool Import(string identity, byte[] artifact, CancellationToken token = default(CancellationToken))
        {
            token.ThrowIfCancellationRequested(); var name = Identity(identity);
            if (artifact == null || artifact.Length < 100 || artifact.Length > maxBytes) return false;
            try
            {
                int bodyLength = artifact.Length - 32; byte[] checksum;
                using (var hash = SHA256.Create()) checksum = hash.ComputeHash(artifact, 0, bodyLength);
                int difference = 0; for (int i = 0; i < 32; i++) difference |= checksum[i] ^ artifact[bodyLength + i];
                if (difference != 0) return false;
                var admitted = new List<GraphContactRecipe>(); long totalBytes = 0;
                using (var stream = new MemoryStream(artifact, 0, bodyLength, false))
                using (var reader = new BinaryReader(stream, Encoding.UTF8, true))
                {
                    if (ReadText(reader, 128) != Version || ReadText(reader, 64) != name) return false;
                    int count = ReadCount(reader, maxEntries); var seen = new HashSet<string>(StringComparer.Ordinal);
                    for (int item = 0; item < count; item++)
                    {
                        token.ThrowIfCancellationRequested(); var geometry = ReadText(reader, 64);
                        if (geometry.Length != 64 || !geometry.All(c => c >= '0' && c <= '9' || c >= 'a' && c <= 'f') || !seen.Add(geometry)) return false;
                        int pieceCount = ReadCount(reader, 5000000), surfaceCount = ReadCount(reader, 10000000);
                        int pairCount = ReadCount(reader, checked((int)Math.Min(int.MaxValue, maxBytes / 64)));
                        totalBytes += 1024L + 64L * pairCount;
                        if (totalBytes > maxBytes || pairCount > (stream.Length - stream.Position) / 42) return false;
                        var pairs = new GraphContactPair[pairCount]; var pairIds = new HashSet<long>();
                        for (int i = 0; i < pairs.Length; i++)
                        {
                            if ((i & 255) == 0) token.ThrowIfCancellationRequested();
                            int first = reader.ReadInt32(), last = reader.ReadInt32();
                            bool ports = ReadBoolean(reader), overlap = ReadBoolean(reader);
                            double a = Fraction(reader), b = Fraction(reader), highA = Fraction(reader), highB = Fraction(reader);
                            if (first < 0 || last <= first || last >= pieceCount || !pairIds.Add(((long)first << 32) | (uint)last)) return false;
                            pairs[i] = new GraphContactPair(first, last, ports, overlap, a, b, highA, highB);
                        }
                        int surfaceRecords = ReadCount(reader, checked((int)Math.Min(int.MaxValue, maxBytes / 176)));
                        var surfaces = new Dictionary<long, GraphSurfaceRecord>();
                        for (int i = 0; i < surfaceRecords; i++)
                        {
                            if ((i & 127) == 0) token.ThrowIfCancellationRequested();
                            int first = reader.ReadInt32(), last = reader.ReadInt32(), witnessCount = ReadCount(reader, 2);
                            if (first < 0 || last < 0 || first >= surfaceCount || last >= surfaceCount) return false;
                            totalBytes += 176L + 128L * witnessCount; if (totalBytes > maxBytes) return false;
                            var witnesses = new TrayMeshClearanceWitness[witnessCount];
                            for (int j = 0; j < witnesses.Length; j++)
                            {
                                double squared = reader.ReadDouble(); if (!RoutePoint.IsFinite(squared) || squared < 0) return false;
                                var a = ReadPoint(reader); var b = ReadPoint(reader);
                                witnesses[j] = new TrayMeshClearanceWitness(squared, new V(a), new V(b));
                            }
                            var result = witnessCount == 0 ? null : new TrayMeshClearanceResult(witnesses);
                            var record = new GraphSurfaceRecord(first, last, result); if (surfaces.ContainsKey(record.Key)) return false; surfaces.Add(record.Key, record);
                        }
                        var recipe = new GraphContactRecipe(name, geometry, pieceCount, surfaceCount, pairs, surfaces, true);
                        admitted.Add(recipe);
                    }
                    if (stream.Position != stream.Length || admitted.Count == 0) return false;
                }
                token.ThrowIfCancellationRequested(); foreach (var recipe in admitted) Store(recipe); return true;
            }
            catch (InvalidDataException) { return false; }
            catch (IOException) { return false; }
            catch (ArgumentException) { return false; }
            catch (OverflowException) { return false; }
        }
        private static void WriteText(BinaryWriter writer, string value)
        { var bytes = Encoding.UTF8.GetBytes(value); writer.Write(bytes.Length); writer.Write(bytes); }
        private static string ReadText(BinaryReader reader, int maximum)
        {
            int length = ReadCount(reader, maximum);
            if (length > reader.BaseStream.Length - reader.BaseStream.Position) throw new InvalidDataException();
            var bytes = reader.ReadBytes(length); return new UTF8Encoding(false, true).GetString(bytes);
        }
        private static int ReadCount(BinaryReader reader, int maximum)
        { int count = reader.ReadInt32(); if (count < 0 || count > maximum) throw new InvalidDataException(); return count; }
        private static bool ReadBoolean(BinaryReader reader)
        { byte value = reader.ReadByte(); if (value > 1) throw new InvalidDataException(); return value == 1; }
        private static double Fraction(BinaryReader reader)
        { double value = reader.ReadDouble(); if (!RoutePoint.IsFinite(value) || value < 0 || value > 1) throw new InvalidDataException(); return value; }
        internal static void WritePoint(BinaryWriter writer, RoutePoint point) { writer.Write(point.X); writer.Write(point.Y); writer.Write(point.Z); }
        private static RoutePoint ReadPoint(BinaryReader reader) { return new RoutePoint(reader.ReadDouble(), reader.ReadDouble(), reader.ReadDouble()); }
    }
}
