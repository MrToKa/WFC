using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace AddinRibbon.Routing
{
    /// <summary>Only immutable, endpoint-independent contact recipes are shared.
    /// Supplied identities partition storage; exact current geometry selects every hit.</summary>
    public sealed partial class GraphPreparationCache
    {
        public const string Version = "wfc.pf.graph-contact-preparation.v1";
        public const string OriginalRouteCalculatorSha256 = "12e96c787902850bffad660d5d2a43333960d9920890cf8f547a730f67e0d0b8";
        public const string OriginalTrayMeshClearanceSha256 = "75075cbf5b13d385f9932e1ad755815e39934e55bcbf123b657ae3b5363541e8";
        private readonly object gate = new object();
        private readonly Dictionary<string, GraphContactRecipe> entries = new Dictionary<string, GraphContactRecipe>(StringComparer.Ordinal);
        private readonly LinkedList<string> order = new LinkedList<string>();
        private readonly int maxEntries;
        private readonly long maxBytes;
        private long retainedBytes, revision;
        public GraphPreparationCache(int maxEntries = 4, long maxBytes = 64L * 1024 * 1024)
        {
            if (maxEntries < 1 || maxEntries > 64 || maxBytes < 1024 || maxBytes > 256L * 1024 * 1024)
                throw new ArgumentOutOfRangeException("Graph preparation cache limits are outside their bounded range.");
            this.maxEntries = maxEntries; this.maxBytes = maxBytes;
        }
        public long Revision { get { lock (gate) return revision; } }
        public long RetainedBytes { get { lock (gate) return retainedBytes; } }
        public int EntryCount { get { lock (gate) return entries.Count; } }
        internal long MaximumBytes { get { return maxBytes; } }
        public GraphPreparationRequest BeginRequest(string preparedIdentity, bool enabled = true)
        { return new GraphPreparationRequest(this, Identity(preparedIdentity), enabled); }
        public void Clear()
        { lock (gate) { if (entries.Count == 0) return; entries.Clear(); order.Clear(); retainedBytes = 0; revision++; } }
        internal GraphContactRecipe Find(string name, string geometry)
        {
            lock (gate)
            {
                var key = name + geometry; GraphContactRecipe recipe;
                if (!entries.TryGetValue(key, out recipe)) return null;
                order.Remove(key); order.AddLast(key); return recipe;
            }
        }
        internal void Remove(GraphContactRecipe recipe)
        {
            lock (gate)
            {
                var key = recipe.Namespace + recipe.Geometry; GraphContactRecipe current;
                if (!entries.TryGetValue(key, out current) || !ReferenceEquals(current, recipe)) return;
                entries.Remove(key); order.Remove(key); retainedBytes -= recipe.EstimatedBytes; revision++;
            }
        }
        internal void Replace(GraphContactRecipe previous, GraphContactRecipe next)
        {
            lock (gate)
            {
                var key = previous.Namespace + previous.Geometry; GraphContactRecipe current;
                if (!entries.TryGetValue(key, out current) || !ReferenceEquals(current, previous)) return;
                entries[key] = next; retainedBytes += next.EstimatedBytes - previous.EstimatedBytes; revision++;
            }
        }
        internal void Store(GraphContactRecipe recipe)
        {
            if (recipe.EstimatedBytes > maxBytes) return;
            lock (gate)
            {
                var key = recipe.Namespace + recipe.Geometry;
                if (entries.ContainsKey(key)) return;
                while (entries.Count >= maxEntries || retainedBytes > maxBytes - recipe.EstimatedBytes)
                {
                    var oldest = order.First.Value; order.RemoveFirst();
                    retainedBytes -= entries[oldest].EstimatedBytes; entries.Remove(oldest);
                }
                entries.Add(key, recipe); order.AddLast(key); retainedBytes += recipe.EstimatedBytes; revision++;
            }
        }
        private static string Identity(string identity)
        {
            if (string.IsNullOrWhiteSpace(identity) || identity.Length > 4096) throw new ArgumentException("A bounded prepared-model identity is required.", "identity");
            using (var hash = SHA256.Create()) return Hex(hash.ComputeHash(Encoding.UTF8.GetBytes(identity)));
        }
        internal static string Hex(byte[] bytes)
        { var result = new StringBuilder(bytes.Length * 2); foreach (byte b in bytes) result.Append(b.ToString("x2", System.Globalization.CultureInfo.InvariantCulture)); return result.ToString(); }
    }

    /// <summary>A request-local diagnostics ledger. No endpoints, witnesses or route payloads are recorded.</summary>
    public sealed class GraphPreparationDiagnostics
    {
        internal long builds, basisBuilds, memoryHits, importedHits, candidates, surfaceQueries, surfaceHits;
        internal long fingerprintTicks, treeTicks, surfaceTicks, graphTicks;
        private readonly GraphPreparationCache cache;
        internal GraphPreparationDiagnostics(GraphPreparationCache cache) { this.cache = cache; }
        public long GraphBuilds { get { return Interlocked.Read(ref builds); } }
        public long BasisBuilds { get { return Interlocked.Read(ref basisBuilds); } }
        public long BasisMemoryHits { get { return Interlocked.Read(ref memoryHits); } }
        public long BasisImportedHits { get { return Interlocked.Read(ref importedHits); } }
        public long CandidatePairs { get { return Interlocked.Read(ref candidates); } }
        public long SurfaceQueries { get { return Interlocked.Read(ref surfaceQueries); } }
        public long SurfaceCacheHits { get { return Interlocked.Read(ref surfaceHits); } }
        public double FingerprintMilliseconds { get { return Milliseconds(Interlocked.Read(ref fingerprintTicks)); } }
        public double TreeBuildMilliseconds { get { return Milliseconds(Interlocked.Read(ref treeTicks)); } }
        public double SurfaceMilliseconds { get { return Milliseconds(Interlocked.Read(ref surfaceTicks)); } }
        public double GraphMilliseconds { get { return Milliseconds(Interlocked.Read(ref graphTicks)); } }
        public long CacheBytes { get { return cache.RetainedBytes; } }
        public int CacheEntries { get { return cache.EntryCount; } }
        private static double Milliseconds(long ticks) { return ticks * 1000.0 / Stopwatch.Frequency; }
    }

    /// <summary>Ambient state is scoped to one logical execution flow and restored on disposal.
    /// Separate requests may safely share a bounded cache. Original execution is enabled=false.</summary>
    public sealed class GraphPreparationRequest : IDisposable
    {
        private static readonly AsyncLocal<GraphPreparationRequest> ambient = new AsyncLocal<GraphPreparationRequest>();
        private readonly GraphPreparationRequest previous;
        private int disposed;
        internal readonly GraphPreparationCache Cache;
        internal readonly string Namespace;
        public bool Enabled { get; private set; }
        public GraphPreparationDiagnostics Diagnostics { get; private set; }
        internal static GraphPreparationRequest Current { get { var value = ambient.Value; return value != null && Volatile.Read(ref value.disposed) == 0 ? value : null; } }
        internal GraphPreparationRequest(GraphPreparationCache cache, string name, bool enabled)
        {
            Cache = cache; Namespace = name; Enabled = enabled; Diagnostics = new GraphPreparationDiagnostics(cache);
            previous = ambient.Value; ambient.Value = this;
        }
        public void Dispose()
        {
            if (Volatile.Read(ref disposed) != 0) return;
            if (!ReferenceEquals(ambient.Value, this)) throw new InvalidOperationException("Graph preparation scopes must be disposed in reverse creation order on their execution flow.");
            if (Interlocked.Exchange(ref disposed, 1) == 0) ambient.Value = previous;
        }
        internal static long StartGraphAssembly() { return Current == null ? 0 : Stopwatch.GetTimestamp(); }
    }

    internal struct GraphContactPair
    {
        internal readonly int First, Last;
        internal readonly bool PortsOnly, Overlap;
        internal readonly double FirstFraction, LastFraction, HighFirst, HighLast;
        internal GraphContactPair(int first, int last, bool portsOnly, bool overlap, double firstFraction, double lastFraction, double highFirst, double highLast)
        { First = first; Last = last; PortsOnly = portsOnly; Overlap = overlap; FirstFraction = firstFraction; LastFraction = lastFraction; HighFirst = highFirst; HighLast = highLast; }
    }
    internal sealed class GraphSurfaceRecord
    {
        internal readonly int First, Last;
        internal readonly TrayMeshClearanceResult Result;
        internal GraphSurfaceRecord(int first, int last, TrayMeshClearanceResult result) { First = first; Last = last; Result = result; }
        internal long EstimatedBytes { get { return 96L + (Result == null ? 0 : 128L * Result.Contacts.Count); } }
        internal long Key { get { return ((long)First << 32) | (uint)Last; } }
    }
    internal sealed class GraphContactRecipe
    {
        internal readonly string Namespace, Geometry;
        internal readonly int PieceCount, SurfaceCount;
        internal readonly GraphContactPair[] Pairs;
        internal readonly Dictionary<long, GraphSurfaceRecord> Surfaces;
        internal readonly bool Imported;
        internal readonly bool Validated;
        internal long EstimatedBytes { get; private set; }
        internal GraphContactRecipe(string name, string geometry, int pieceCount, int surfaceCount, GraphContactPair[] pairs,
            Dictionary<long, GraphSurfaceRecord> surfaces, bool imported, bool validated = false)
        {
            Namespace = name; Geometry = geometry; PieceCount = pieceCount; SurfaceCount = surfaceCount;
            Pairs = pairs; Surfaces = surfaces; Imported = imported; Validated = validated;
            EstimatedBytes = 1024L + 64L * pairs.Length + 80L * surfaces.Count;
            foreach (var record in surfaces.Values) EstimatedBytes += record.EstimatedBytes;
        }
    }
}
