using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading;

namespace AddinRibbon.Routing
{
    /// <summary>One measured closest-point contact on retained physical surfaces.</summary>
    public sealed class TrayMeshClearanceWitness
    {
        public double DistanceMeters { get; private set; }
        public RoutePoint FirstPoint { get; private set; }
        public RoutePoint SecondPoint { get; private set; }
        internal readonly double SquaredDistance;
        internal TrayMeshClearanceWitness(double squaredDistance, V first, V second)
        { SquaredDistance = squaredDistance; DistanceMeters = Math.Sqrt(squaredDistance); FirstPoint = first.Point; SecondPoint = second.Point; }
        internal TrayMeshClearanceWitness Swapped()
        { return new TrayMeshClearanceWitness(SquaredDistance, new V(SecondPoint), new V(FirstPoint)); }
    }

    /// <summary>Exact surface minimum and measured directional contacts with tied gap rank.</summary>
    public sealed class TrayMeshClearanceResult
    {
        public double DistanceMeters { get { return Contacts[0].DistanceMeters; } }
        public RoutePoint FirstPoint { get { return Contacts[0].FirstPoint; } }
        public RoutePoint SecondPoint { get { return Contacts[0].SecondPoint; } }
        public IReadOnlyList<TrayMeshClearanceWitness> Contacts { get; private set; }
        internal double SquaredDistance { get { return Contacts[0].SquaredDistance; } }
        internal TrayMeshClearanceResult(double squaredDistance, V first, V second)
            : this(new[] { new TrayMeshClearanceWitness(squaredDistance, first, second) }) { }
        internal TrayMeshClearanceResult(IEnumerable<TrayMeshClearanceWitness> contacts)
        { Contacts = new ReadOnlyCollection<TrayMeshClearanceWitness>(contacts.ToArray()); }
        internal TrayMeshClearanceResult Swapped()
        { return new TrayMeshClearanceResult(Contacts.Select(contact => contact.Swapped())); }
        internal TrayMeshClearanceResult Within(double cutoff)
        {
            bool all = true;
            foreach (var contact in Contacts) if (contact.DistanceMeters > cutoff) { all = false; break; }
            if (all) return this;
            var retained = new List<TrayMeshClearanceWitness>();
            foreach (var contact in Contacts) if (contact.DistanceMeters <= cutoff) retained.Add(contact);
            return new TrayMeshClearanceResult(retained);
        }
    }

    /// <summary>
    /// Immutable BVH over actual triangle surfaces. Clipping retains the existing
    /// surfaces; it never fills a rectangular section or an open tray channel.
    /// This measures surface clearance, not containment of closed solid volumes.
    /// </summary>
    public sealed class TrayMeshClearance
    {
        private const double ClipPadding = 0.00025;
        private const int MaximumTriangles = 200000;
        private const int LeafSize = 8;
        private const int MaximumPeerProofs = 128;
        private const int MaximumStationProofs = 256;
        private const double ContactRankingResolution = 0.000001;
        private static long nextInstanceOrdinal;
        private readonly long instanceOrdinal = Interlocked.Increment(ref nextInstanceOrdinal);
        private readonly TrayMeshData mesh;
        private readonly Reference[] references;
        private readonly Triangle[] clipped;
        private readonly int[] order;
        private readonly Node[] nodes;
        private readonly object proofLock = new object();
        private Dictionary<TrayMeshClearance, Proof> peerProofs;
        private Dictionary<StationKey, Proof> stationProofs;
        private long proofClock;
        private long distanceSearchCount, stationSearchCount;
        public RoutePoint Minimum { get; private set; }
        public RoutePoint Maximum { get; private set; }
        public int TriangleCount { get { return references.Length; } }
        /// <summary>Retained BVH, clips and bounded proofs; shared source mesh storage is excluded.</summary>
        public long EstimatedBytes
        {
            get
            {
                lock (proofLock)
                    return 384L + 12L * references.Length + 4L * order.Length + 72L * clipped.Length + 64L * nodes.Length
                        + (peerProofs == null ? 0 : 8192L + 384L * peerProofs.Count)
                        + (stationProofs == null ? 0 : 16384L + 672L * stationProofs.Count);
            }
        }
        internal long DistanceSearchCount { get { return Interlocked.Read(ref distanceSearchCount); } }
        internal long StationSearchCount { get { return Interlocked.Read(ref stationSearchCount); } }
        internal int CachedPeerProofCount { get { lock (proofLock) return peerProofs == null ? 0 : peerProofs.Count; } }
        internal int CachedStationProofCount { get { lock (proofLock) return stationProofs == null ? 0 : stationProofs.Count; } }

        private TrayMeshClearance(TrayMeshData source, Reference[] refs, Triangle[] clips,
            int[] sortedOrder, Node[] tree)
        {
            mesh = source; references = refs; clipped = clips; order = sortedOrder; nodes = tree;
            Minimum = tree[0].Box.Minimum.Point; Maximum = tree[0].Box.Maximum.Point;
        }

        /// <summary>
        /// Proven straights require two measured ports and retain only their body
        /// prism. Ends-only geometry retains the actual surfaces in one or more
        /// narrow physical cap slabs; pass one port for one independently queried end.
        /// With no ports and endsOnly=false the full supplied mesh is retained.
        /// </summary>
        public static bool TryCreate(TrayMeshData mesh, IEnumerable<RouteConnectionPort> verifiedPorts,
            bool endsOnly, CancellationToken token, out TrayMeshClearance clearance, out string reason)
        {
            token.ThrowIfCancellationRequested();
            clearance = null; reason = "triangle mesh evidence is unavailable";
            if (mesh == null || mesh.TriangleCount == 0) return false;
            if (mesh.TriangleCount > MaximumTriangles)
            { reason = "triangle surface budget exceeded"; return false; }
            var ports = (verifiedPorts ?? Enumerable.Empty<RouteConnectionPort>()).ToArray();
            if (ports.Any(p => p == null) || ports.Length > 2 || (endsOnly && ports.Length == 0)
                || (!endsOnly && ports.Length == 1))
            { reason = "surface clipping requires measured physical sections"; return false; }
            var regions = Regions(ports, endsOnly);
            if (regions == null)
            { reason = "measured straight sections do not define a body prism"; return false; }
            var refs = new List<Reference>(); var clips = new List<Triangle>(); var boxes = new List<Box>();
            int work = 0;
            for (int fragmentIndex = 0; fragmentIndex < mesh.Fragments.Count; fragmentIndex++)
            {
                var fragment = mesh.Fragments[fragmentIndex];
                for (int offset = 0; offset < fragment.TriangleIndices.Count; offset += 3)
                {
                    if ((++work & 127) == 0) token.ThrowIfCancellationRequested();
                    var triangle = Read(fragment, offset);
                    if (!triangle.Valid) continue;
                    foreach (var region in regions)
                    {
                        bool unchanged;
                        var polygon = Clip(triangle, region, out unchanged);
                        if (unchanged)
                        {
                            refs.Add(new Reference(fragmentIndex, offset, -1)); boxes.Add(triangle.Bounds);
                        }
                        else if (polygon != null) for (int index = 1; index + 1 < polygon.Count; index++)
                        {
                            var part = new Triangle(polygon[0], polygon[index], polygon[index + 1]);
                            if (!part.Valid) continue;
                            refs.Add(new Reference(-1, 0, clips.Count)); clips.Add(part); boxes.Add(part.Bounds);
                        }
                        if (refs.Count > MaximumTriangles)
                        { reason = "clipped triangle surface budget exceeded"; return false; }
                    }
                }
            }
            token.ThrowIfCancellationRequested();
            if (refs.Count == 0)
            { reason = "no physical mesh surfaces remain inside the measured sections"; return false; }
            int[] order = Enumerable.Range(0, refs.Count).ToArray();
            var tree = new List<Node>();
            Build(tree, order, boxes.ToArray(), 0, order.Length, token);
            clearance = new TrayMeshClearance(mesh, refs.ToArray(), clips.ToArray(), order, tree.ToArray());
            reason = null; return true;
        }

        /// <summary>Returns the exact retained-surface minimum if it is within the cutoff.</summary>
        public bool TryDistanceTo(TrayMeshClearance other, double maximumDistanceMeters,
            CancellationToken token, out TrayMeshClearanceResult result)
        {
            if (other == null) throw new ArgumentNullException("other");
            ValidateCutoff(maximumDistanceMeters); token.ThrowIfCancellationRequested();
            bool found;
            if (ReadPeerProof(other, maximumDistanceMeters, out result, out found))
            { token.ThrowIfCancellationRequested(); return found; }
            Interlocked.Increment(ref distanceSearchCount);
            var canonicalFirst = instanceOrdinal <= other.instanceOrdinal ? this : other;
            var canonicalLast = ReferenceEquals(canonicalFirst, this) ? other : this;
            TrayMeshClearanceResult canonical;
            // Complete the tied directional contact proof at a slightly wider
            // search bound. Eligibility still uses the caller's exact cutoff.
            double proofCutoff = maximumDistanceMeters + ContactRankingResolution;
            if (!RoutePoint.IsFinite(proofCutoff * proofCutoff)) proofCutoff = maximumDistanceMeters;
            CanonicalMinimum(canonicalFirst, canonicalLast, proofCutoff, token, out canonical);
            var completed = canonical == null ? null : ReferenceEquals(canonicalFirst, this) ? canonical : canonical.Swapped();
            token.ThrowIfCancellationRequested();
            StorePeerProof(other, proofCutoff, completed);
            other.StorePeerProof(this, proofCutoff, completed == null ? null : completed.Swapped());
            found = completed != null && completed.DistanceMeters <= maximumDistanceMeters;
            result = found ? completed.Within(maximumDistanceMeters) : null;
            return found;
        }

        private static bool CanonicalMinimum(TrayMeshClearance first, TrayMeshClearance last, double cutoff,
            CancellationToken token, out TrayMeshClearanceResult result)
        {
            TrayMeshClearanceResult forward, reverse;
            bool found = first.TryDistanceUncached(last, cutoff, token, out forward);
            token.ThrowIfCancellationRequested();
            // Zero already proves the minimum. Its canonical direction is stable;
            // positive minima can have physically distinct tied end contacts.
            if (ReferenceEquals(first, last) || (found && forward.SquaredDistance == 0))
            { result = forward; return found; }
            bool reverseFound = last.TryDistanceUncached(first, cutoff, token, out reverse);
            token.ThrowIfCancellationRequested();
            if (!found) { result = reverseFound ? reverse.Swapped() : null; return reverseFound; }
            if (!reverseFound) { result = forward; return true; }
            var back = reverse.Contacts[0].Swapped(); var front = forward.Contacts[0];
            var primary = front.SquaredDistance <= back.SquaredDistance ? front : back;
            var secondary = ReferenceEquals(primary, front) ? back : front;
            bool tied = Math.Round(primary.DistanceMeters / ContactRankingResolution, MidpointRounding.AwayFromZero)
                == Math.Round(secondary.DistanceMeters / ContactRankingResolution, MidpointRounding.AwayFromZero);
            bool distinct = !SamePoint(primary.FirstPoint, secondary.FirstPoint)
                || !SamePoint(primary.SecondPoint, secondary.SecondPoint);
            result = new TrayMeshClearanceResult(tied && distinct ? new[] { primary, secondary } : new[] { primary });
            return true;
        }

        private static bool SamePoint(RoutePoint first, RoutePoint last)
        { return first.X == last.X && first.Y == last.Y && first.Z == last.Z; }

        private bool TryDistanceUncached(TrayMeshClearance other, double maximumDistanceMeters,
            CancellationToken token, out TrayMeshClearanceResult result)
        {
            if (other == null) throw new ArgumentNullException("other");
            if (!RoutePoint.IsFinite(maximumDistanceMeters) || maximumDistanceMeters < 0)
                throw new ArgumentException("The clearance cutoff must be finite and non-negative.", "maximumDistanceMeters");
            token.ThrowIfCancellationRequested();
            result = null;
            double best = maximumDistanceMeters * maximumDistanceMeters;
            if (!RoutePoint.IsFinite(best)) throw new ArgumentException("The clearance cutoff is too large.", "maximumDistanceMeters");
            double lower = Box.DistanceSquared(nodes[0].Box, other.nodes[0].Box);
            if (lower > best) return false;
            var queue = new PairHeap(); queue.Push(new Pair(0, 0, lower));
            bool found = false; V firstPoint = new V(), secondPoint = new V(); int work = 0;
            while (queue.Count > 0)
            {
                if ((++work & 31) == 0) token.ThrowIfCancellationRequested();
                var pair = queue.Pop(); if (pair.Lower > best) break;
                var first = nodes[pair.First]; var second = other.nodes[pair.Second];
                if (first.Count > 0 && second.Count > 0)
                {
                    for (int a = first.Start; a < first.Start + first.Count; a++)
                        for (int b = second.Start; b < second.Start + second.Count; b++)
                        {
                            if ((++work & 127) == 0) token.ThrowIfCancellationRequested();
                            var ta = TriangleAt(order[a]); var tb = other.TriangleAt(other.order[b]);
                            if (Box.DistanceSquared(ta.Bounds, tb.Bounds) > best) continue;
                            V pa, pb; double distance = DistanceSquared(ta, tb, out pa, out pb);
                            if (!RoutePoint.IsFinite(distance) || distance > best) continue;
                            if (!found || distance < best)
                            { found = true; best = distance; firstPoint = pa; secondPoint = pb; }
                            if (best == 0)
                            { result = new TrayMeshClearanceResult(0, firstPoint, secondPoint); return true; }
                        }
                }
                else if (second.Count > 0 || (first.Count == 0 && first.Box.SizeSquared >= second.Box.SizeSquared))
                {
                    Enqueue(queue, first.Left, pair.Second, nodes[first.Left].Box, second.Box, best);
                    Enqueue(queue, first.Right, pair.Second, nodes[first.Right].Box, second.Box, best);
                }
                else
                {
                    Enqueue(queue, pair.First, second.Left, first.Box, other.nodes[second.Left].Box, best);
                    Enqueue(queue, pair.First, second.Right, first.Box, other.nodes[second.Right].Box, best);
                }
            }
            token.ThrowIfCancellationRequested();
            if (found) result = new TrayMeshClearanceResult(best, firstPoint, secondPoint);
            return found;
        }

        /// <summary>
        /// Exact clearance at two measured straight stations. Narrow section slabs
        /// are clipped from the already retained body surfaces, without adding caps
        /// or scanning/cloning the complete source mesh. This preserves independent
        /// contacts along parallel overlaps when the global minimum has several ties.
        /// </summary>
        public bool TryDistanceAtSections(TrayMeshClearance other, RouteConnectionPort firstStationPort,
            RouteConnectionPort lastStationPort, double maximumDistanceMeters, CancellationToken token,
            out TrayMeshClearanceResult result)
        {
            if (other == null) throw new ArgumentNullException("other");
            if (firstStationPort == null) throw new ArgumentNullException("firstStationPort");
            if (lastStationPort == null) throw new ArgumentNullException("lastStationPort");
            if (!RoutePoint.IsFinite(maximumDistanceMeters) || maximumDistanceMeters < 0
                || !RoutePoint.IsFinite(maximumDistanceMeters * maximumDistanceMeters))
                throw new ArgumentException("The clearance cutoff must be finite, non-negative and representable.", "maximumDistanceMeters");
            token.ThrowIfCancellationRequested(); result = null;
            var key = new StationKey(other, firstStationPort, lastStationPort);
            bool found;
            if (ReadStationProof(key, maximumDistanceMeters, out result, out found))
            { token.ThrowIfCancellationRequested(); return found; }
            Interlocked.Increment(ref stationSearchCount);
            TrayMeshClearance firstSection, lastSection;
            bool firstComplete, lastComplete;
            bool firstExists = TrySection(firstStationPort, token, out firstSection, out firstComplete);
            bool lastExists = other.TrySection(lastStationPort, token, out lastSection, out lastComplete);
            if (!firstComplete || !lastComplete) return false;
            found = firstExists && lastExists
                && firstSection.TryDistanceUncached(lastSection, maximumDistanceMeters, token, out result);
            token.ThrowIfCancellationRequested();
            StoreStationProof(key, maximumDistanceMeters, result);
            other.StoreStationProof(new StationKey(this, lastStationPort, firstStationPort),
                maximumDistanceMeters, result == null ? null : result.Swapped());
            return found;
        }

        private bool TrySection(RouteConnectionPort port, CancellationToken token, out TrayMeshClearance section, out bool complete)
        {
            section = null; complete = false;
            var planes = Regions(new[] { port }, true)[0];
            var center = new V(port.Point); var u = new V(port.U) * (port.Width * .5 + ClipPadding);
            var v = new V(port.V) * (port.Height * .5 + ClipPadding); var n = new V(port.Outward) * ClipPadding;
            var sectionBox = new Box(center + u + v + n, center + u + v + n);
            for (int x = -1; x <= 1; x += 2)
                for (int y = -1; y <= 1; y += 2)
                    for (int z = -1; z <= 1; z += 2)
                    {
                        var point = center + u * x + v * y + n * z;
                        sectionBox = Box.Union(sectionBox, new Box(point, point));
                    }
            var triangles = new List<Triangle>(); var stack = new Stack<int>(); stack.Push(0); int work = 0;
            while (stack.Count > 0)
            {
                if ((++work & 31) == 0) token.ThrowIfCancellationRequested();
                var node = nodes[stack.Pop()];
                if (Box.DistanceSquared(node.Box, sectionBox) > 0) continue;
                if (node.Count == 0) { stack.Push(node.Left); stack.Push(node.Right); continue; }
                for (int index = node.Start; index < node.Start + node.Count; index++)
                {
                    var triangle = TriangleAt(order[index]);
                    if (Box.DistanceSquared(triangle.Bounds, sectionBox) > 0) continue;
                    bool unchanged; var polygon = Clip(triangle, planes, out unchanged);
                    if (unchanged) triangles.Add(triangle);
                    else if (polygon != null) for (int point = 1; point + 1 < polygon.Count; point++)
                    {
                        var clippedTriangle = new Triangle(polygon[0], polygon[point], polygon[point + 1]);
                        if (clippedTriangle.Valid) triangles.Add(clippedTriangle);
                    }
                    if (triangles.Count > MaximumTriangles) return false;
                }
            }
            token.ThrowIfCancellationRequested();
            complete = true;
            if (triangles.Count == 0) return false;
            var refs = Enumerable.Range(0, triangles.Count).Select(index => new Reference(-1, 0, index)).ToArray();
            var sorted = Enumerable.Range(0, triangles.Count).ToArray(); var tree = new List<Node>();
            Build(tree, sorted, triangles.Select(t => t.Bounds).ToArray(), 0, triangles.Count, token);
            section = new TrayMeshClearance(null, refs, triangles.ToArray(), sorted, tree.ToArray()); return true;
        }

        private static void ValidateCutoff(double cutoff)
        {
            if (!RoutePoint.IsFinite(cutoff) || cutoff < 0 || !RoutePoint.IsFinite(cutoff * cutoff))
                throw new ArgumentException("The clearance cutoff must be finite, non-negative and representable.", "maximumDistanceMeters");
        }

        private bool ReadPeerProof(TrayMeshClearance other, double cutoff, out TrayMeshClearanceResult result, out bool found)
        {
            lock (proofLock)
            {
                Proof proof;
                if (peerProofs != null && peerProofs.TryGetValue(other, out proof))
                {
                    proof.LastUsed = ++proofClock;
                    return proof.Read(cutoff, out result, out found);
                }
            }
            result = null; found = false; return false;
        }

        private bool ReadStationProof(StationKey key, double cutoff, out TrayMeshClearanceResult result, out bool found)
        {
            lock (proofLock)
            {
                Proof proof;
                if (stationProofs != null && stationProofs.TryGetValue(key, out proof))
                {
                    proof.LastUsed = ++proofClock;
                    return proof.Read(cutoff, out result, out found);
                }
            }
            result = null; found = false; return false;
        }

        private void StorePeerProof(TrayMeshClearance other, double cutoff, TrayMeshClearanceResult result)
        {
            lock (proofLock)
            {
                if (peerProofs == null) peerProofs = new Dictionary<TrayMeshClearance, Proof>();
                Store(peerProofs, other, MaximumPeerProofs, cutoff, result, ++proofClock);
            }
        }

        private void StoreStationProof(StationKey key, double cutoff, TrayMeshClearanceResult result)
        {
            lock (proofLock)
            {
                if (stationProofs == null) stationProofs = new Dictionary<StationKey, Proof>();
                Store(stationProofs, key, MaximumStationProofs, cutoff, result, ++proofClock);
            }
        }

        private static void Store<TKey>(Dictionary<TKey, Proof> proofs, TKey key, int maximum,
            double cutoff, TrayMeshClearanceResult result, long clock)
        {
            Proof proof;
            if (!proofs.TryGetValue(key, out proof))
            {
                if (proofs.Count == maximum)
                {
                    TKey oldest = default(TKey); long used = long.MaxValue;
                    foreach (var entry in proofs)
                        if (entry.Value.LastUsed < used) { oldest = entry.Key; used = entry.Value.LastUsed; }
                    proofs.Remove(oldest);
                }
                proof = new Proof(); proofs.Add(key, proof);
            }
            proof.LastUsed = clock;
            if (result != null) { if (proof.Result == null) proof.Result = result; }
            else proof.FailedCutoff = Math.Max(proof.FailedCutoff, cutoff);
        }

        private sealed class Proof
        {
            internal TrayMeshClearanceResult Result;
            internal double FailedCutoff = -1;
            internal long LastUsed;
            internal bool Read(double cutoff, out TrayMeshClearanceResult result, out bool found)
            {
                if (Result != null)
                {
                    found = Result.DistanceMeters <= cutoff;
                    result = found ? Result.Within(cutoff) : null; return true;
                }
                result = null; found = false; return cutoff <= FailedCutoff;
            }
        }

        private sealed class StationKey : IEquatable<StationKey>
        {
            private readonly TrayMeshClearance other;
            private readonly PortValues first, last;
            private readonly int hash;
            internal StationKey(TrayMeshClearance other, RouteConnectionPort first, RouteConnectionPort last)
            {
                this.other = other; this.first = new PortValues(first); this.last = new PortValues(last);
                unchecked { hash = (other.GetHashCode() * 397 ^ this.first.GetHashCode()) * 397 ^ this.last.GetHashCode(); }
            }
            public bool Equals(StationKey value)
            { return value != null && ReferenceEquals(other, value.other) && first.Equals(value.first) && last.Equals(value.last); }
            public override bool Equals(object value) { return Equals(value as StationKey); }
            public override int GetHashCode() { return hash; }
        }

        private struct PortValues : IEquatable<PortValues>
        {
            private readonly RoutePoint point, outward, u, v;
            private readonly double width, height;
            internal PortValues(RouteConnectionPort port)
            { point = port.Point; outward = port.Outward; u = port.U; v = port.V; width = port.Width; height = port.Height; }
            public bool Equals(PortValues value)
            { return Same(point, value.point) && Same(outward, value.outward) && Same(u, value.u) && Same(v, value.v) && width == value.width && height == value.height; }
            private static bool Same(RoutePoint a, RoutePoint b) { return a.X == b.X && a.Y == b.Y && a.Z == b.Z; }
            public override bool Equals(object value) { return value is PortValues && Equals((PortValues)value); }
            public override int GetHashCode()
            {
                unchecked
                {
                    int hash = Hash(point); hash = hash * 397 ^ Hash(outward); hash = hash * 397 ^ Hash(u);
                    hash = hash * 397 ^ Hash(v); hash = hash * 397 ^ width.GetHashCode(); return hash * 397 ^ height.GetHashCode();
                }
            }
            private static int Hash(RoutePoint p) { unchecked { return (p.X.GetHashCode() * 397 ^ p.Y.GetHashCode()) * 397 ^ p.Z.GetHashCode(); } }
        }

        private static void Enqueue(PairHeap heap, int first, int second, Box a, Box b, double best)
        { double lower = Box.DistanceSquared(a, b); if (lower <= best) heap.Push(new Pair(first, second, lower)); }

        private Triangle TriangleAt(int index)
        {
            var reference = references[index];
            return reference.Clip >= 0 ? clipped[reference.Clip] : Read(mesh.Fragments[reference.Fragment], reference.Offset);
        }

        private static Triangle Read(TrayMeshFragment fragment, int offset)
        { return new Triangle(new V(fragment.Vertices[fragment.TriangleIndices[offset]]), new V(fragment.Vertices[fragment.TriangleIndices[offset + 1]]), new V(fragment.Vertices[fragment.TriangleIndices[offset + 2]])); }

        private static List<Plane[]> Regions(RouteConnectionPort[] ports, bool endsOnly)
        {
            var result = new List<Plane[]>();
            if (ports.Length == 0) { result.Add(new Plane[0]); return result; }
            if (endsOnly)
            {
                foreach (var port in ports)
                {
                    var center = new V(port.Point); var direction = new V(port.Outward);
                    var planes = Section(port);
                    planes.Add(new Plane(direction, V.Dot(direction, center) + ClipPadding));
                    planes.Add(new Plane(-direction, V.Dot(-direction, center) + ClipPadding));
                    result.Add(planes.ToArray());
                }
                return result;
            }
            var start = ports[0]; var end = ports[1];
            if (V.Dot(new V(start.Outward), new V(end.Outward)) > -0.999
                || start.Point.DistanceTo(end.Point) < 0.00000001) return null;
            var body = Section(start);
            body.Add(new Plane(new V(start.Outward), V.Dot(new V(start.Outward), new V(start.Point)) + ClipPadding));
            body.Add(new Plane(new V(end.Outward), V.Dot(new V(end.Outward), new V(end.Point)) + ClipPadding));
            result.Add(body.ToArray()); return result;
        }

        private static List<Plane> Section(RouteConnectionPort port)
        {
            var center = new V(port.Point); var u = new V(port.U); var v = new V(port.V);
            return new List<Plane>
            {
                new Plane(u, V.Dot(u, center) + port.Width * 0.5 + ClipPadding),
                new Plane(-u, V.Dot(-u, center) + port.Width * 0.5 + ClipPadding),
                new Plane(v, V.Dot(v, center) + port.Height * 0.5 + ClipPadding),
                new Plane(-v, V.Dot(-v, center) + port.Height * 0.5 + ClipPadding)
            };
        }

        private static List<V> Clip(Triangle triangle, Plane[] planes, out bool unchanged)
        {
            unchanged = true;
            foreach (var plane in planes)
            {
                double a = plane.Distance(triangle.A), b = plane.Distance(triangle.B), c = plane.Distance(triangle.C);
                if (a > 0 && b > 0 && c > 0) { unchanged = false; return null; }
                if (a > 0 || b > 0 || c > 0) unchanged = false;
            }
            // Most body triangles require no clipping or extra vertex storage.
            if (unchanged) return null;
            var polygon = new List<V> { triangle.A, triangle.B, triangle.C };
            foreach (var plane in planes)
            {
                if (polygon.Count == 0) break;
                var output = new List<V>(); var previous = polygon[polygon.Count - 1];
                double previousDistance = plane.Distance(previous);
                foreach (var current in polygon)
                {
                    double currentDistance = plane.Distance(current);
                    bool previousInside = previousDistance <= 0, currentInside = currentDistance <= 0;
                    if (!currentInside) unchanged = false;
                    if (previousInside != currentInside)
                    {
                        double fraction = previousDistance / (previousDistance - currentDistance);
                        output.Add(previous + (current - previous) * fraction);
                    }
                    if (currentInside) output.Add(current);
                    previous = current; previousDistance = currentDistance;
                }
                polygon = output;
            }
            return polygon;
        }

        private static int Build(List<Node> nodes, int[] order, Box[] boxes, int start, int count, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            var box = boxes[order[start]];
            for (int index = start + 1; index < start + count; index++) box = Box.Union(box, boxes[order[index]]);
            int nodeIndex = nodes.Count; nodes.Add(new Node());
            if (count <= LeafSize) { nodes[nodeIndex] = new Node(box, start, count, -1, -1); return nodeIndex; }
            var size = box.Maximum - box.Minimum;
            int axis = size.X >= size.Y && size.X >= size.Z ? 0 : size.Y >= size.Z ? 1 : 2;
            Array.Sort(order, start, count, new CenterComparer(boxes, axis));
            int leftCount = count / 2;
            int left = Build(nodes, order, boxes, start, leftCount, token);
            int right = Build(nodes, order, boxes, start + leftCount, count - leftCount, token);
            nodes[nodeIndex] = new Node(box, 0, 0, left, right); return nodeIndex;
        }

        private static double DistanceSquared(Triangle first, Triangle last, out V a, out V b)
        {
            a = first.A; b = last.A;
            for (int index = 0; index < 3; index++)
            {
                V hit;
                if (Intersects(first.At(index), first.At((index + 1) % 3), last, out hit)) { a = b = hit; return 0; }
                if (Intersects(last.At(index), last.At((index + 1) % 3), first, out hit)) { a = b = hit; return 0; }
            }
            double best = double.PositiveInfinity;
            for (int index = 0; index < 3; index++)
            {
                var point = first.At(index);
                var nearest = Closest(point, last); double d = (point - nearest).LengthSquared;
                if (d < best) { best = d; a = point; b = nearest; }
            }
            for (int index = 0; index < 3; index++)
            {
                var point = last.At(index);
                var nearest = Closest(point, first); double d = (point - nearest).LengthSquared;
                if (d < best) { best = d; a = nearest; b = point; }
            }
            for (int firstEdge = 0; firstEdge < 3; firstEdge++)
                for (int lastEdge = 0; lastEdge < 3; lastEdge++)
                {
                    V x, y;
                    SegmentClosest(first.At(firstEdge), first.At((firstEdge + 1) % 3), last.At(lastEdge), last.At((lastEdge + 1) % 3), out x, out y);
                    double d = (x - y).LengthSquared;
                    if (d < best) { best = d; a = x; b = y; }
                }
            return best;
        }

        private static bool Intersects(V first, V last, Triangle triangle, out V hit)
        {
            hit = new V(); var normal = V.Cross(triangle.B - triangle.A, triangle.C - triangle.A);
            double a = V.Dot(first - triangle.A, normal), b = V.Dot(last - triangle.A, normal);
            if ((a > 0 && b > 0) || (a < 0 && b < 0) || a == b) return false;
            double fraction = a / (a - b);
            if (fraction < 0 || fraction > 1 || !RoutePoint.IsFinite(fraction)) return false;
            hit = first + (last - first) * fraction;
            return (hit - Closest(hit, triangle)).LengthSquared <= 1e-24;
        }

        // Closest point on a triangle, including every vertex/edge Voronoi region.
        private static V Closest(V p, Triangle t)
        {
            var ab = t.B - t.A; var ac = t.C - t.A; var ap = p - t.A;
            double d1 = V.Dot(ab, ap), d2 = V.Dot(ac, ap);
            if (d1 <= 0 && d2 <= 0) return t.A;
            var bp = p - t.B; double d3 = V.Dot(ab, bp), d4 = V.Dot(ac, bp);
            if (d3 >= 0 && d4 <= d3) return t.B;
            double vc = d1 * d4 - d3 * d2;
            if (vc <= 0 && d1 >= 0 && d3 <= 0) return t.A + ab * (d1 / (d1 - d3));
            var cp = p - t.C; double d5 = V.Dot(ab, cp), d6 = V.Dot(ac, cp);
            if (d6 >= 0 && d5 <= d6) return t.C;
            double vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) return t.A + ac * (d2 / (d2 - d6));
            double va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
                return t.B + (t.C - t.B) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)));
            double inverse = 1 / (va + vb + vc);
            return t.A + ab * (vb * inverse) + ac * (vc * inverse);
        }

        private static void SegmentClosest(V a, V b, V c, V d, out V first, out V last)
        {
            var u = b - a; var v = d - c; var w = a - c;
            double aa = V.Dot(u, u), bb = V.Dot(u, v), cc = V.Dot(v, v), dd = V.Dot(u, w), ee = V.Dot(v, w);
            double determinant = V.Cross(u, v).LengthSquared;
            double s = aa == 0 ? 0 : determinant > 1e-30 ? Clamp((bb * ee - cc * dd) / determinant) : 0;
            double t = cc == 0 ? 0 : (bb * s + ee) / cc;
            if (t < 0) { t = 0; s = aa == 0 ? 0 : Clamp(-dd / aa); }
            else if (t > 1) { t = 1; s = aa == 0 ? 0 : Clamp((bb - dd) / aa); }
            first = a + u * s; last = c + v * t;
        }
        private static double Clamp(double value) { return Math.Max(0, Math.Min(1, value)); }

        private struct Reference
        {
            internal readonly int Fragment, Offset, Clip;
            internal Reference(int fragment, int offset, int clip) { Fragment = fragment; Offset = offset; Clip = clip; }
        }
        private struct Triangle
        {
            internal readonly V A, B, C;
            internal Triangle(V a, V b, V c) { A = a; B = b; C = c; }
            internal V At(int index) { return index == 0 ? A : index == 1 ? B : C; }
            internal bool Valid { get { double value = V.Cross(B - A, C - A).LengthSquared; return RoutePoint.IsFinite(value) && value > 1e-28; } }
            internal Box Bounds { get { return new Box(V.Minimum(A, V.Minimum(B, C)), V.Maximum(A, V.Maximum(B, C))); } }
        }
        private struct Plane
        {
            internal readonly V Normal; internal readonly double Offset;
            internal Plane(V normal, double offset) { Normal = normal; Offset = offset; }
            internal double Distance(V point) { return V.Dot(Normal, point) - Offset; }
        }
        private struct Box
        {
            internal readonly V Minimum, Maximum;
            internal Box(V minimum, V maximum) { Minimum = minimum; Maximum = maximum; }
            internal double SizeSquared { get { return (Maximum - Minimum).LengthSquared; } }
            internal static Box Union(Box a, Box b) { return new Box(V.Minimum(a.Minimum, b.Minimum), V.Maximum(a.Maximum, b.Maximum)); }
            internal static double DistanceSquared(Box a, Box b)
            {
                double x = Math.Max(0, Math.Max(a.Minimum.X - b.Maximum.X, b.Minimum.X - a.Maximum.X));
                double y = Math.Max(0, Math.Max(a.Minimum.Y - b.Maximum.Y, b.Minimum.Y - a.Maximum.Y));
                double z = Math.Max(0, Math.Max(a.Minimum.Z - b.Maximum.Z, b.Minimum.Z - a.Maximum.Z));
                return x * x + y * y + z * z;
            }
        }
        private struct Node
        {
            internal readonly Box Box; internal readonly int Start, Count, Left, Right;
            internal Node(Box box, int start, int count, int left, int right)
            { Box = box; Start = start; Count = count; Left = left; Right = right; }
        }
        private sealed class CenterComparer : IComparer<int>
        {
            private readonly Box[] boxes; private readonly int axis;
            internal CenterComparer(Box[] boxes, int axis) { this.boxes = boxes; this.axis = axis; }
            public int Compare(int first, int last)
            {
                var a = boxes[first]; var b = boxes[last];
                double x = axis == 0 ? a.Minimum.X + a.Maximum.X : axis == 1 ? a.Minimum.Y + a.Maximum.Y : a.Minimum.Z + a.Maximum.Z;
                double y = axis == 0 ? b.Minimum.X + b.Maximum.X : axis == 1 ? b.Minimum.Y + b.Maximum.Y : b.Minimum.Z + b.Maximum.Z;
                int result = x.CompareTo(y); return result == 0 ? first.CompareTo(last) : result;
            }
        }
        private struct Pair
        {
            internal readonly int First, Second; internal readonly double Lower;
            internal Pair(int first, int second, double lower) { First = first; Second = second; Lower = lower; }
        }
        private sealed class PairHeap
        {
            private readonly List<Pair> values = new List<Pair>();
            internal int Count { get { return values.Count; } }
            internal void Push(Pair item)
            {
                int index = values.Count; values.Add(item);
                while (index > 0)
                {
                    int parent = (index - 1) / 2; if (values[parent].Lower <= item.Lower) break;
                    values[index] = values[parent]; index = parent;
                }
                values[index] = item;
            }
            internal Pair Pop()
            {
                var root = values[0]; var item = values[values.Count - 1]; values.RemoveAt(values.Count - 1);
                if (values.Count == 0) return root;
                int index = 0;
                while (index * 2 + 1 < values.Count)
                {
                    int child = index * 2 + 1;
                    if (child + 1 < values.Count && values[child + 1].Lower < values[child].Lower) child++;
                    if (values[child].Lower >= item.Lower) break;
                    values[index] = values[child]; index = child;
                }
                values[index] = item; return root;
            }
        }
    }

    // Utility-local vector: detached clearance does not depend on fitter internals.
    internal struct V
    {
        internal readonly double X, Y, Z;
        internal V(double x, double y, double z) { X = x; Y = y; Z = z; }
        internal V(RoutePoint p) { X = p.X; Y = p.Y; Z = p.Z; }
        internal RoutePoint Point { get { return new RoutePoint(X, Y, Z); } }
        internal double LengthSquared { get { return X * X + Y * Y + Z * Z; } }
        internal static double Dot(V a, V b) { return a.X * b.X + a.Y * b.Y + a.Z * b.Z; }
        internal static V Cross(V a, V b) { return new V(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X); }
        internal static V Minimum(V a, V b) { return new V(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Min(a.Z, b.Z)); }
        internal static V Maximum(V a, V b) { return new V(Math.Max(a.X, b.X), Math.Max(a.Y, b.Y), Math.Max(a.Z, b.Z)); }
        public static V operator +(V a, V b) { return new V(a.X + b.X, a.Y + b.Y, a.Z + b.Z); }
        public static V operator -(V a, V b) { return new V(a.X - b.X, a.Y - b.Y, a.Z - b.Z); }
        public static V operator -(V a) { return new V(-a.X, -a.Y, -a.Z); }
        public static V operator *(V a, double b) { return new V(a.X * b, a.Y * b, a.Z * b); }
    }
}
