using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using AddinRibbon.Routing;
using Autodesk.Navisworks.Api;
using Autodesk.Navisworks.Api.Data;
using NavisworksApp = Autodesk.Navisworks.Api.Application;

namespace AddinRibbon.Services
{
    public sealed class RouteAssignment
    {
        public ModelItem Root { get; internal set; }
        public string Name { get; internal set; }
        public CableCategory Categories { get; set; }
        public int LeafCount { get; internal set; }
        internal List<ModelItem> Leaves { get; set; }
    }

    // ModelItem operations stay on the host UI thread; only value snapshots go to workers.
    public sealed partial class RoutingSession : IDisposable
    {
        public const string SelectedUnnamedObjectLabel = "(selected unnamed object)";
        private Document document;
        private Dictionary<string, List<ModelItem>> nameIndex;
        private readonly Dictionary<ModelItem, double[]> capturedBoxes = new Dictionary<ModelItem, double[]>();
        private readonly Dictionary<ModelItem, MeshSnapshot> meshCache = new Dictionary<ModelItem, MeshSnapshot>();
        private readonly LinkedList<ModelItem> meshRecency = new LinkedList<ModelItem>();
        private long cachedMeshBytes;
        private TrayGeometryInput[] fittedInputs;
        private TrayGeometryBuildResult fittedGeometry;
        private const int MaximumCachedMeshes = 2000;
        private const long MaximumMeshBytes = 128L * 1024 * 1024;
        private static readonly Regex ShapeName = new Regex(@"(?<![A-Za-z0-9])(?:BEND|ELBOW|FTUBE|TUBE|STRAIGHT)(?![A-Za-z0-9])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        public List<RouteAssignment> Assignments { get; } = new List<RouteAssignment>();
        public Dictionary<string, ModelItem> SegmentItems { get; } = new Dictionary<string, ModelItem>();
        public Document Document { get { return document; } }
        public int Revision { get; private set; }
        public int ModelRevision { get; private set; }
        public int ValidatedBends { get; private set; }
        public int FallbackBends { get; private set; }
        public int ValidatedStraights { get; private set; }
        public int FallbackStraights { get; private set; }
        public int FallbackClearances { get; private set; }
        public int GeometryBuildCount { get; private set; }
        public IReadOnlyList<string> GeometryDiagnostics { get; private set; } = new string[0];
        public event EventHandler Changed;

        public RoutingSession()
        {
            NavisworksApp.ActiveDocumentChanged += ActiveDocumentChanged;
            AttachDocument();
        }
        private void ActiveDocumentChanged(object sender, EventArgs e) { AttachDocument(); }
        private void AttachDocument()
        {
            DetachDocument();
            document = NavisworksApp.ActiveDocument;
            if (document != null)
            {
                document.Models.CollectionChanged += ModelChanged;
                document.Models.ModelTransformChanged += TransformChanged;
                document.Models.ModelItemPropertiesChanged += VisibilityChanged;
                document.UnitsChanged += ModelChanged;
                document.FileNameChanged += ModelChanged;
                document.FilesUpdated += ModelChanged;
            }
            InvalidateModel();
        }
        private void DetachDocument()
        {
            if (document == null) return;
            document.Models.CollectionChanged -= ModelChanged;
            document.Models.ModelTransformChanged -= TransformChanged;
            document.Models.ModelItemPropertiesChanged -= VisibilityChanged;
            document.UnitsChanged -= ModelChanged;
            document.FileNameChanged -= ModelChanged;
            document.FilesUpdated -= ModelChanged;
        }
        private void ModelChanged(object sender, EventArgs e) { InvalidateModel(); }
        private void TransformChanged(object sender, ModelTransformEventArgs e) { InvalidateModel(); }
        // Hidden/Required edits change the usable network without replacing the model.
        // Keep assignments and per-name search matches, but invalidate captured results.
        private void VisibilityChanged(object sender, EventArgs e) { NotifyChanged(); }
        private void InvalidateModel()
        {
            ModelRevision++;
            Assignments.Clear();
            nameIndex = null;
            lookupNameIndex.Clear();
            ClearMeshCache();
            NotifyChanged();
        }
        public void NotifyChanged()
        {
            SegmentItems.Clear();
            capturedBoxes.Clear();
            fittedInputs = null; fittedGeometry = null;
            ValidatedBends = FallbackBends = 0;
            ValidatedStraights = FallbackStraights = 0;
            FallbackClearances = 0;
            GeometryDiagnostics = new string[0];
            Revision++;
            Changed?.Invoke(this, EventArgs.Empty);
        }

        public async Task<int> AssignSelectionAsync(CableCategory categories, CancellationToken token)
        {
            RequireDocument();
            if (categories == CableCategory.None) throw new InvalidOperationException("Choose at least one cable type.");
            var roots = document.CurrentSelection.SelectedItems.ToList();
            if (roots.Count == 0) throw new InvalidOperationException("Select route objects in the Selection Tree first.");
            int revision = Revision, visited = 0;
            var pending = new List<RouteAssignment>();
            foreach (var root in roots)
            {
                var leaves = new List<ModelItem>();
                foreach (var item in root.DescendantsAndSelf)
                {
                    token.ThrowIfCancellationRequested();
                    if (!item.Children.Any() && item.HasGeometry && !item.BoundingBox().IsEmpty) leaves.Add(item);
                    if (++visited % 200 == 0) await Task.Delay(1, token);
                    if (revision != Revision) throw new OperationCanceledException("Model changed during route capture.");
                }
                if (leaves.Count > 0)
                    pending.Add(new RouteAssignment { Root = root, Name = root.DisplayName, Categories = categories, LeafCount = leaves.Count, Leaves = leaves });
            }
            if (pending.Count == 0) throw new InvalidOperationException("The selection has no deepest children with geometry.");
            foreach (var assignment in pending)
            {
                Assignments.RemoveAll(a => a.Root.Equals(assignment.Root));
                Assignments.Add(assignment);
            }
            NotifyChanged();
            return pending.Sum(a => a.LeafCount);
        }

        public async Task<ModelItem> ResolveAsync(string text, ModelItem picked, CancellationToken token)
        {
            RequireDocument();
            token.ThrowIfCancellationRequested();
            string name = (text ?? "").Trim();
            if (name.Length == 0) throw new InvalidOperationException("Enter both From and To object names.");
            if (picked != null && !picked.IsDisposed)
            {
                string pickedName = (picked.DisplayName ?? "").Trim();
                if (string.Equals(pickedName, name, StringComparison.OrdinalIgnoreCase)
                    || (pickedName.Length == 0 && name == SelectedUnnamedObjectLabel))
                {
                    if (!IsVisibleEndpoint(picked)) throw new InvalidOperationException("The selected object is hidden or has no visible geometry. Choose a visible From / To object.");
                    return picked;
                }
            }
            if (nameIndex == null) nameIndex = new Dictionary<string, List<ModelItem>>(StringComparer.OrdinalIgnoreCase);
            if (!nameIndex.TryGetValue(name, out var matches))
            {
                int revision = Revision;
                // Search inside Navisworks instead of crossing the native boundary
                // for every item in a large model. Cache all matches for this name,
                // then apply live Hidden state on every lookup, including Unhide.
                await Task.Delay(1, token);
                if (revision != Revision) throw new OperationCanceledException("Model changed during object search.");
                using (var search = new Search())
                {
                    search.Selection.SelectAll();
                    search.Locations = SearchLocations.DescendantsAndSelf;
                    search.PruneBelowMatch = false;
                    // Native contains finds both raw and whitespace-padded names;
                    // the exact trimmed post-filter preserves the lookup contract.
                    search.SearchConditions.Add(SearchCondition.HasPropertyByName(PropertyCategoryNames.Item, DataPropertyNames.ItemName)
                        .DisplayStringContains(name).IgnoreStringValueCase());
                    matches = search.FindAll(document, false).Where(item =>
                        string.Equals((item.DisplayName ?? "").Trim(), name, StringComparison.OrdinalIgnoreCase)).ToList();
                }
                token.ThrowIfCancellationRequested();
                if (revision != Revision) throw new OperationCanceledException("Model changed during object search.");
                nameIndex[name] = matches;
            }
            if (matches.Count == 0) throw new InvalidOperationException("Object not found: " + name);
            // Evaluate the current visibility, including ancestors, on every lookup.
            // A cached name index must also support objects unhidden after its creation.
            ModelItem visible = null;
            foreach (var match in matches)
            {
                token.ThrowIfCancellationRequested();
                if (!IsVisibleEndpoint(match)) continue;
                if (visible != null) throw new InvalidOperationException("More than one visible object is named " + name + ". Select the intended object and use 'Use selection'.");
                visible = match;
            }
            if (visible == null) throw new InvalidOperationException("Object not found among visible objects: " + name + ". Matching objects are hidden or have no visible geometry.");
            return visible;
        }

        public static bool IsVisible(ModelItem item)
        {
            if (item == null || item.IsDisposed) return false;
            foreach (var ancestor in item.AncestorsAndSelf)
                if (ancestor.IsDisposed || ancestor.IsHidden) return false;
            return true;
        }
        public static bool IsVisibleEndpoint(ModelItem item)
        {
            if (!IsVisible(item)) return false;
            using (var box = item.BoundingBox(true)) return !box.IsEmpty;
        }

        /// <summary>Centre of the bottom face of the visible world-space bounding box, in metres.</summary>
        public RoutePoint BasePointInMeters(ModelItem item)
        {
            if (!IsVisible(item)) throw new InvalidOperationException("From / To object is hidden. Choose a visible object.");
            using (var box = item.BoundingBox(true))
            {
                if (box.IsEmpty) throw new InvalidOperationException("Object has no visible geometry: " + item.DisplayName);
                double scale = UnitConversion.ScaleFactor(document.Units, Units.Meters);
                using (var centre = box.Center)
                using (var minimum = box.Min)
                    return new RoutePoint(centre.X * scale, centre.Y * scale, minimum.Z * scale);
            }
        }

        public async Task<List<TraySegment>> CaptureSegmentsAsync(CancellationToken token)
        {
            RequireDocument();
            if (Assignments.Count == 0) throw new InvalidOperationException("Add route objects on the Routes tab first.");
            return await CaptureSegmentsCoreAsync(Assignments, token);
        }

        private async Task<List<TraySegment>> CaptureSegmentsCoreAsync(IEnumerable<RouteAssignment> assignments, CancellationToken token)
        {
            int revision = Revision;
            // The most recently added rule wins when selections overlap.
            var assigned = new Dictionary<ModelItem, RouteAssignment>();
            foreach (var assignment in assignments)
                foreach (var leaf in assignment.Leaves) assigned[leaf] = assignment;
            double scale = UnitConversion.ScaleFactor(document.Units, Units.Meters);
            var inputs = new List<TrayGeometryInput>();
            var items = new Dictionary<string, ModelItem>();
            var boxes = new Dictionary<ModelItem, double[]>();
            long capturedMeshBytes = 0;
            bool meshBudgetAvailable = true;
            int count = 0;
            var slice = Stopwatch.StartNew();
            foreach (var pair in assigned)
            {
                token.ThrowIfCancellationRequested();
                var item = pair.Key;
                if (pair.Value.Categories != CableCategory.None && IsVisible(item))
                {
                    using (var box = item.BoundingBox())
                    {
                        if (!box.IsEmpty)
                        {
                            string id = (++count).ToString(System.Globalization.CultureInfo.InvariantCulture);
                            string shape = FindShapeName(item, pair.Value.Root);
                            var minimum = ToMeters(box.Min, scale);
                            var maximum = ToMeters(box.Max, scale);
                            var fingerprint = GeometryFingerprint(item, box);
                            IReadOnlyList<TrayFaceExtent> faces = null;
                            TrayMeshData mesh = null;
                            // Every assigned visible leaf may provide physical
                            // clearance evidence, even when its centreline shape
                            // is unsupported. Capture remains byte/primitive bounded.
                            var native = CaptureMesh(item, fingerprint, minimum, maximum, scale, token, meshBudgetAvailable);
                            faces = native.Faces;
                            if (native.Mesh != null)
                            {
                                if (native.Mesh.EstimatedBytes <= MaximumMeshBytes - capturedMeshBytes)
                                { mesh = native.Mesh; capturedMeshBytes += mesh.EstimatedBytes; }
                                else meshBudgetAvailable = false;
                            }
                            inputs.Add(new TrayGeometryInput(id, FindRouteName(item, pair.Value.Root), pair.Value.Categories,
                                shape, minimum, maximum, faces, mesh));
                            items.Add(id, item);
                            boxes.Add(item, fingerprint);
                        }
                    }
                }
                if (slice.ElapsedMilliseconds >= 25) { await Task.Delay(1, token); slice.Restart(); }
                if (revision != Revision) throw new OperationCanceledException("Model changed during geometry capture.");
            }
            // Native capture is finished. Geometry fitting uses values only, away from
            // the host thread, and commits atomically with the rest of the snapshot.
            // Endpoint edits do not change the tray geometry. Reuse the detached
            // fit only after all live bounds, transforms, visibility and rules
            // have been read again and the complete input snapshot still matches.
            TrayGeometryBuildResult geometry;
            if (fittedGeometry != null && SameGeometryInputs(inputs, fittedInputs)
                && SameGeometryFingerprints(boxes, capturedBoxes)) geometry = fittedGeometry;
            else
            {
                geometry = await Task.Run(() => TrayGeometryBuilder.Build(inputs, token), token);
                token.ThrowIfCancellationRequested();
                if (revision != Revision) throw new OperationCanceledException("Model changed during geometry capture.");
                fittedInputs = inputs.ToArray(); fittedGeometry = geometry; GeometryBuildCount++;
            }
            token.ThrowIfCancellationRequested();
            if (revision != Revision) throw new OperationCanceledException("Model changed during geometry capture.");
            SegmentItems.Clear();
            foreach (var pair in items) SegmentItems.Add(pair.Key, pair.Value);
            capturedBoxes.Clear();
            foreach (var pair in boxes) capturedBoxes.Add(pair.Key, pair.Value);
            ValidatedBends = geometry.ValidatedBends;
            FallbackBends = geometry.FallbackBends;
            ValidatedStraights = geometry.ValidatedStraights;
            FallbackStraights = geometry.FallbackStraights;
            FallbackClearances = geometry.FallbackClearances;
            GeometryDiagnostics = geometry.Diagnostics;
            return geometry.Segments.ToList();
        }

        // Item-level Transform overrides do not raise ModelTransformChanged in the host.
        // Recheck the captured geometry before displaying a cached result.
        public bool AreCapturedSegmentsCurrent()
        {
            if (capturedBoxes.Count == 0) return false;
            foreach (var pair in capturedBoxes)
            {
                if (!IsVisible(pair.Key)) return false;
                using (var box = pair.Key.BoundingBox())
                    if (box.IsEmpty || !pair.Value.SequenceEqual(GeometryFingerprint(pair.Key, box))) return false;
            }
            return true;
        }
        private static double[] GeometryFingerprint(ModelItem item, BoundingBox3D box)
        {
            // A half-turn of a square bend can preserve its box while moving both
            // ports. Include the active native transform when validating caches.
            return new[] { box.Min.X, box.Min.Y, box.Min.Z, box.Max.X, box.Max.Y, box.Max.Z }
                .Concat(TrayMeshReader.ActiveTransform(item)).ToArray();
        }

        private static bool SameGeometryInputs(List<TrayGeometryInput> current, TrayGeometryInput[] prior)
        {
            if (prior == null || current.Count != prior.Length) return false;
            for (int index = 0; index < current.Count; index++)
            {
                var a = current[index]; var b = prior[index];
                if (a.Id != b.Id || a.RouteName != b.RouteName || a.ShapeName != b.ShapeName || a.Categories != b.Categories
                    || !a.Minimum.Equals(b.Minimum) || !a.Maximum.Equals(b.Maximum)
                    || !ReferenceEquals(a.Mesh, b.Mesh) || !SameFaceEvidence(a.FaceExtents, b.FaceExtents)) return false;
            }
            return true;
        }

        private static bool SameGeometryFingerprints(Dictionary<ModelItem, double[]> current,
            Dictionary<ModelItem, double[]> prior)
        {
            if (current.Count != prior.Count) return false;
            foreach (var pair in current)
            {
                double[] previous;
                if (!prior.TryGetValue(pair.Key, out previous) || !pair.Value.SequenceEqual(previous)) return false;
            }
            return true;
        }

        private static bool SameFaceEvidence(IReadOnlyList<TrayFaceExtent> first, IReadOnlyList<TrayFaceExtent> last)
        {
            if (first.Count != last.Count) return false;
            for (int index = 0; index < first.Count; index++)
            {
                var a = first[index]; var b = last[index];
                if (a.Face != b.Face || a.SampleCount != b.SampleCount || !a.Minimum.Equals(b.Minimum) || !a.Maximum.Equals(b.Maximum)) return false;
            }
            return true;
        }

        private TrayMeshReader.CapturedTrayMesh CaptureMesh(ModelItem item, double[] fingerprint,
            RoutePoint minimum, RoutePoint maximum, double scale, CancellationToken token, bool mayRead)
        {
            if (meshCache.TryGetValue(item, out var cached))
            {
                if (cached.Fingerprint.SequenceEqual(fingerprint))
                {
                    meshRecency.Remove(cached.Recency); meshRecency.AddLast(cached.Recency);
                    return cached.Native;
                }
                RemoveCachedMesh(item, cached);
            }
            // The current detached capture has its own byte budget in addition to
            // the retained LRU cache. A capped item receives the existing fallback.
            if (!mayRead) return TrayMeshReader.CapturedTrayMesh.Empty;
            TrayMeshReader.CapturedTrayMesh native;
            try { native = TrayMeshReader.ReadGeometry(item, minimum, maximum, scale, token); }
            catch (COMException) { token.ThrowIfCancellationRequested(); native = TrayMeshReader.CapturedTrayMesh.Empty; }
            catch (InvalidOperationException) { token.ThrowIfCancellationRequested(); native = TrayMeshReader.CapturedTrayMesh.Empty; }
            catch (NotSupportedException) { token.ThrowIfCancellationRequested(); native = TrayMeshReader.CapturedTrayMesh.Empty; }
            token.ThrowIfCancellationRequested();
            long bytes = 1024L + (native.Mesh == null ? 0 : native.Mesh.EstimatedBytes);
            if (bytes <= MaximumMeshBytes)
            {
                while (meshCache.Count >= MaximumCachedMeshes || cachedMeshBytes > MaximumMeshBytes - bytes)
                {
                    var oldest = meshRecency.First.Value;
                    RemoveCachedMesh(oldest, meshCache[oldest]);
                }
                var node = meshRecency.AddLast(item);
                meshCache.Add(item, new MeshSnapshot(fingerprint, native, node, bytes));
                cachedMeshBytes += bytes;
            }
            return native;
        }
        private void RemoveCachedMesh(ModelItem item, MeshSnapshot cached)
        {
            meshCache.Remove(item); meshRecency.Remove(cached.Recency); cachedMeshBytes -= cached.Bytes;
        }
        private void ClearMeshCache()
        {
            meshCache.Clear(); meshRecency.Clear(); cachedMeshBytes = 0;
        }
        private sealed class MeshSnapshot
        {
            public readonly double[] Fingerprint;
            public readonly TrayMeshReader.CapturedTrayMesh Native;
            public readonly LinkedListNode<ModelItem> Recency;
            public readonly long Bytes;
            public MeshSnapshot(double[] fingerprint, TrayMeshReader.CapturedTrayMesh native, LinkedListNode<ModelItem> recency, long bytes)
            { Fingerprint = fingerprint; Native = native; Recency = recency; Bytes = bytes; }
        }

        private static string FindShapeName(ModelItem leaf, ModelItem root)
        {
            foreach (var item in leaf.AncestorsAndSelf)
            {
                if (ShapeName.IsMatch(item.DisplayName ?? "")) return item.DisplayName;
                if (item.Equals(root)) break;
            }
            return leaf.DisplayName;
        }

        private static string FindRouteName(ModelItem leaf, ModelItem root)
        {
            var names = new List<string>();
            foreach (var item in leaf.AncestorsAndSelf)
            {
                names.Add(item.DisplayName);
                if (item.Equals(root)) break;
            }
            return RouteNameResolver.Resolve(names);
        }
        private static RoutePoint ToMeters(Point3D p, double scale) { return new RoutePoint(p.X * scale, p.Y * scale, p.Z * scale); }
        private void RequireDocument()
        {
            if (document == null || document.Models.Count == 0) throw new InvalidOperationException("Open a 3D model in Navisworks first.");
        }
        public void Dispose()
        {
            NavisworksApp.ActiveDocumentChanged -= ActiveDocumentChanged;
            DetachDocument();
            ClearMeshCache();
            fittedInputs = null; fittedGeometry = null;
        }
    }
}
