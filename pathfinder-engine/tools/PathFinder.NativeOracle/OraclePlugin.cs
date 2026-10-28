using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using AddinRibbon.Routing;
using AddinRibbon.Services;
using Autodesk.Navisworks.Api;
using Autodesk.Navisworks.Api.ComApi;
using Autodesk.Navisworks.Api.Plugins;
using COM = Autodesk.Navisworks.Api.Interop.ComApi;
using NApp = Autodesk.Navisworks.Api.Application;

[Plugin("PathFinderNativeOracle", "PF2L", DisplayName = "WFC isolated native reference capture")]
[AddInPlugin(AddInLocation.None)]
public sealed class WfcPathFinderNativeOracle : AddInPlugin
{
    private readonly JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 128 };
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private string output;
    private Document document;
    private double scale;
    private CancellationToken token;

    public override int Execute(params string[] parameters)
    {
        output = Path.GetFullPath(parameters[0]);
        var previousContext = SynchronizationContext.Current;
        if (previousContext == null) SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        using (var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(240)))
        {
            token = cancellation.Token;
            try
            {
                document = NApp.ActiveDocument;
                if (document == null || document.IsClear) throw new InvalidOperationException("No copied native model is open.");
                scale = UnitConversion.ScaleFactor(document.Units, Units.Meters);
                var specification = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(parameters[1]));
                var routes = ((System.Collections.IEnumerable)specification["routes"]).Cast<object>()
                    .Select(value => (Dictionary<string, object>)value).ToArray();
                if (routes.Length < 1 || routes.Length > 8) throw new InvalidOperationException("Expected one to eight bounded reference routes.");
                bool modifiedBefore = document.IsModified;
                var captures = new List<object>();
                Progress("capture-start", null, D("routeCount", routes.Length));
                foreach (var entry in routes)
                {
                    token.ThrowIfCancellationRequested();
                    string caseId = Convert.ToString(entry["caseId"], CultureInfo.InvariantCulture);
                    string routeText = Convert.ToString(entry["routeText"], CultureInfo.InvariantCulture);
                    double gap = Convert.ToDouble(entry["connectionGapMeters"], CultureInfo.InvariantCulture);
                    captures.Add(Capture(caseId, routeText, gap));
                }
                var result = D("schemaVersion", "native-oracle.capture.v1", "status", "captured",
                    "sourceCommit", "45c24bf5f433f13e102600b36f20327c77961d0a",
                    "capturedAtUtc", DateTime.UtcNow.ToString("o"), "hostApi", typeof(Document).Assembly.FullName,
                    "oracleAssembly", GetType().Assembly.FullName,
                    "document", document.FileName, "copiedNwdSha256", Hash(document.FileName),
                    "documentUnits", document.Units.ToString(), "metresPerDocumentUnit", scale,
                    "metresPerDocumentUnitR", R(scale), "coordinateSystem", "right-handed-z-up-metres",
                    "coordinateDerivation", "Pinned native COM fragment local-to-world, followed by document unit scale once; no display rebasing.",
                    "documentModifiedBefore", modifiedBefore, "documentModifiedAfter", document.IsModified,
                    "sourceModelSaved", false, "elapsedMilliseconds", clock.ElapsedMilliseconds,
                    "scope", "Selected real lookup networks and model-bound anchor/manual-point automatic references; not a whole-model capture or equipment identity validation.",
                    "nativeLimits", D("maximumPrimitivesPerLeaf", 50000, "maximumFragmentsPerLeaf", 64,
                        "maximumRetainedMeshBytes", 128L * 1024 * 1024,
                        "fallbackPolicy", "Pinned core/native capture unchanged; missing mesh and all geometry fallback counts retained."),
                    "requests", captures);
                File.WriteAllText(output, serializer.Serialize(result));
                Progress("complete", null, D("elapsedMilliseconds", clock.ElapsedMilliseconds, "captureBytes", new FileInfo(output).Length));
                return 0;
            }
            catch (Exception error)
            {
                var failure = D("schemaVersion", "native-oracle.capture.v1", "status", error is OperationCanceledException ? "cancelled" : "failed",
                    "capturedAtUtc", DateTime.UtcNow.ToString("o"), "error", error.ToString(), "elapsedMilliseconds", clock.ElapsedMilliseconds,
                    "sourceModelSaved", false);
                File.WriteAllText(output, serializer.Serialize(failure));
                Progress("failed", null, failure);
                return 1;
            }
            finally { SynchronizationContext.SetSynchronizationContext(previousContext); }
        }
    }

    private object Capture(string caseId, string routeText, double gap)
    {
        Progress("capturing-native", caseId, D("routeText", routeText));
        using (var session = new RoutingSession())
        {
            var codes = RouteLookupCalculator.Parse(routeText);
            var watch = Stopwatch.StartNew();
            var segments = Wait(session.CaptureLookupSegmentsAsync(codes, token));
            long captureMilliseconds = watch.ElapsedMilliseconds;
            var inputs = (TrayGeometryInput[])typeof(RoutingSession).GetField("fittedInputs", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(session);
            if (inputs == null || inputs.Length != session.SegmentItems.Count) throw new InvalidOperationException("Native capture did not retain complete input identity mapping.");
            var options = Options(gap);
            Progress("calculating-reference", caseId, D("capturedLeaves", inputs.Length));
            watch.Restart();
            var lookup = RouteLookupCalculator.Calculate(segments, codes, options, token);
            long lookupMilliseconds = watch.ElapsedMilliseconds;
            var identities = new List<object>();
            foreach (var input in inputs)
            {
                token.ThrowIfCancellationRequested();
                identities.Add(Leaf(input.Id, session.SegmentItems[input.Id]));
            }
            var automatic = new List<object>();
            if (lookup.Success && lookup.SegmentIds.Count > 0)
            {
                var first = session.SegmentItems[lookup.SegmentIds[0]];
                var last = session.SegmentItems[lookup.SegmentIds[lookup.SegmentIds.Count - 1]];
                var from = session.BasePointInMeters(first);
                var to = session.BasePointInMeters(last);
                automatic.Add(Automatic(caseId + "-native-bottom-anchors", segments, from, to, options,
                    "Native visible geometry leaf bottom AABBs; fixture anchors, not a claim of automatic equipment identity matching.",
                    lookup.SegmentIds[0], lookup.SegmentIds[lookup.SegmentIds.Count - 1]));
                var raisedFrom = new RoutePoint(from.X, from.Y, from.Z + 4.25);
                automatic.Add(Automatic(caseId + "-manual-offset-secondary", segments, raisedFrom, to, options,
                    "Explicit manual point: native from-leaf bottom anchor plus canonical (0,0,4.25)m; to is native last-leaf bottom anchor.",
                    lookup.SegmentIds[0], lookup.SegmentIds[lookup.SegmentIds.Count - 1]));
            }
            var missingMesh = inputs.Where(input => input.Mesh == null).Select(input => input.Id).ToArray();
            var result = D("caseId", caseId, "routeText", routeText, "orderedCodes", codes,
                "options", OptionsValue(options), "categoryPolicy", "CaptureLookupSegmentsAsync assigns CableCategory.All to the selected visible lookup leaves.",
                "inputs", inputs.Select(Input).ToArray(), "leafEvidence", identities,
                "fittedSegments", segments.Select(Segment).ToArray(), "lookup", Route(lookup), "automaticCases", automatic,
                "diagnostics", D("validatedBends", session.ValidatedBends, "fallbackBends", session.FallbackBends,
                    "validatedStraights", session.ValidatedStraights, "fallbackStraights", session.FallbackStraights,
                    "fallbackClearances", session.FallbackClearances, "messages", session.GeometryDiagnostics,
                    "missingMeshIds", missingMesh, "capturedLeafCount", inputs.Length, "usedLeafCount", lookup.SegmentIds.Distinct().Count(),
                    "captureMilliseconds", captureMilliseconds, "lookupMilliseconds", lookupMilliseconds,
                    "truncated", false, "wholeModelInventory", false));
            string partial = Path.Combine(Path.GetDirectoryName(output), caseId + ".json");
            File.WriteAllText(partial, serializer.Serialize(result));
            Progress("reference-complete", caseId, D("lookupSuccess", lookup.Success, "lengthMetersR", R(lookup.LengthMeters),
                "nativeInputBytes", new FileInfo(partial).Length));
            return result;
        }
    }

    private object Automatic(string caseId, IReadOnlyList<TraySegment> segments, RoutePoint from, RoutePoint to,
        RoutingOptions options, string derivation, string fromLeafId, string toLeafId)
    {
        var route = new RouteCalculator().Calculate(segments, from, to, CableCategory.Control, options, token);
        object design = null;
        if (route.Success)
        {
            // Explicit oracle test settings. These are not fetched from a production project.
            var calculated = CableDesignLength.Calculate(route, 6m, 5m, 5m);
            design = D("lengthBeforePercentageMeters", calculated.LengthBeforePercentageMeters.ToString(CultureInfo.InvariantCulture),
                "unroundedLengthMeters", calculated.UnroundedLengthMeters.ToString(CultureInfo.InvariantCulture),
                "designLengthMeters", calculated.DesignLengthMeters.ToString(CultureInfo.InvariantCulture),
                "coreDoubleToDecimalGeometricLength", ((decimal)route.LengthMeters).ToString(CultureInfo.InvariantCulture),
                "coreDoubleToDecimalFromDistance", ((decimal)route.FromDistanceMeters).ToString(CultureInfo.InvariantCulture),
                "coreDoubleToDecimalToDistance", ((decimal)route.ToDistanceMeters).ToString(CultureInfo.InvariantCulture));
        }
        return D("caseId", caseId, "category", "Control", "derivation", derivation, "fromLeafId", fromLeafId, "toLeafId", toLeafId,
            "from", Point(from), "fromR", PointR(from), "to", Point(to), "toR", PointR(to),
            "projectSettings", D("revision", "native-oracle-synthetic-allowances-v1", "secondaryTrayLength", "5",
                "endConnectionLength", "6", "additionalBendingPercent", "5", "source", "explicit oracle fixture; not production Project Details"),
            "options", OptionsValue(options), "route", Route(route), "design", design);
    }

    private object Leaf(string id, ModelItem item)
    {
        var chain = item.AncestorsAndSelf.Select(Node).ToArray();
        using (var box = item.BoundingBox())
        {
            var minimum = new RoutePoint(box.Min.X * scale, box.Min.Y * scale, box.Min.Z * scale);
            var maximum = new RoutePoint(box.Max.X * scale, box.Max.Y * scale, box.Max.Z * scale);
            var matrices = new List<object>();
            var path = ComApiBridge.ToInwOaPath(item);
            foreach (COM.InwOaFragment3 fragment in path.Fragments())
            {
                token.ThrowIfCancellationRequested();
                var array = (Array)fragment.GetLocalToWorldMatrix().Matrix;
                var matrix = new double[array.Length];
                for (int i = 0; i < matrix.Length; i++) matrix[i] = Convert.ToDouble(array.GetValue(i + array.GetLowerBound(0)), CultureInfo.InvariantCulture);
                matrices.Add(D("nativeLocalToWorldColumnMajor", matrix, "nativeLocalToWorldColumnMajorR", matrix.Select(R).ToArray(),
                    "worldToMetresScale", scale, "worldToMetresScaleR", R(scale)));
                if (matrices.Count > 64) throw new InvalidOperationException("Oracle transform evidence exceeds the pinned 64-fragment capture cap; no silent truncation.");
            }
            var active = TrayMeshReader.ActiveTransform(item);
            return D("id", id, "leafToRoot", chain, "effectivelyVisible", RoutingSession.IsVisible(item),
                "hasGeometry", item.HasGeometry, "isDeepestLeaf", !item.Children.Any(),
                "worldMinimum", Point(minimum), "worldMinimumR", PointR(minimum), "worldMaximum", Point(maximum), "worldMaximumR", PointR(maximum),
                "nativeActiveTransform", active, "nativeActiveTransformR", active.Select(R).ToArray(),
                "fragmentLocalToWorldMatrices", matrices, "fragmentEvidenceTruncated", false);
        }
    }

    private object Node(ModelItem item)
    {
        token.ThrowIfCancellationRequested();
        var properties = new List<object>();
        foreach (var category in item.PropertyCategories)
            foreach (var property in category.Properties)
            {
                token.ThrowIfCancellationRequested();
                if (properties.Count >= 4096) throw new InvalidOperationException("Oracle node property cap exceeded; no silent truncation.");
                properties.Add(D("category", category.DisplayName, "categoryInternalName", category.Name,
                    "name", property.DisplayName, "internalName", property.Name, "value", property.Value.ToDisplayString()));
            }
        int sibling = -1;
        if (item.Parent != null) sibling = item.Parent.Children.ToList().FindIndex(candidate => candidate.Equals(item));
        return D("displayName", item.DisplayName, "className", Property(item, "ClassName"), "classDisplayName", Property(item, "ClassDisplayName"),
            "instanceGuid", Property(item, "InstanceGuid"), "siblingIndex", sibling, "nativelyHidden", item.IsHidden,
            "hasGeometry", item.HasGeometry, "properties", properties, "propertiesTruncated", false);
    }

    private static string Property(object target, string name)
    {
        var property = target.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
        return property == null ? null : Convert.ToString(property.GetValue(target, null), CultureInfo.InvariantCulture);
    }

    private static object Input(TrayGeometryInput input)
    {
        return D("id", input.Id, "routeName", input.RouteName, "categories", (int)input.Categories, "shapeName", input.ShapeName,
            "minimum", Point(input.Minimum), "minimumR", PointR(input.Minimum), "maximum", Point(input.Maximum), "maximumR", PointR(input.Maximum),
            "faceExtents", input.FaceExtents.Select(face => D("face", (int)face.Face, "minimum", Point(face.Minimum), "minimumR", PointR(face.Minimum),
                "maximum", Point(face.Maximum), "maximumR", PointR(face.Maximum), "sampleCount", face.SampleCount)).ToArray(),
            "meshFragments", input.Mesh == null ? null : input.Mesh.Fragments.Select(fragment => D("vertices", fragment.Vertices.Select(Point).ToArray(),
                "verticesR", fragment.Vertices.Select(PointR).ToArray(), "triangleIndices", fragment.TriangleIndices)).ToArray());
    }

    private static object Segment(TraySegment segment)
    {
        return D("id", segment.Id, "name", segment.Name, "routeCode", segment.RouteCode, "categories", (int)segment.AllowedCategories,
            "points", segment.Points.Select(Point).ToArray(), "pointsR", segment.Points.Select(PointR).ToArray(),
            "connectionsAtEndsOnly", segment.ConnectionsAtEndsOnly, "verifiedPorts", segment.VerifiedPorts.Select(port => D(
                "point", Point(port.Point), "pointR", PointR(port.Point), "outward", Point(port.Outward), "outwardR", PointR(port.Outward),
                "u", Point(port.U), "uR", PointR(port.U), "v", Point(port.V), "vR", PointR(port.V),
                "width", port.Width, "widthR", R(port.Width), "height", port.Height, "heightR", R(port.Height))).ToArray(),
            "connectionSurfaceCount", segment.ConnectionSurfaces.Count);
    }

    private static object Route(RouteResult route)
    {
        return D("success", route.Success, "message", route.Message, "routeText", route.RouteText, "routeCodes", route.RouteCodes,
            "segmentIds", route.SegmentIds, "pathPoints", route.PathPoints.Select(Point).ToArray(), "pathPointsR", route.PathPoints.Select(PointR).ToArray(),
            "lengthMeters", route.LengthMeters, "lengthMetersR", R(route.LengthMeters),
            "fromDistanceMeters", route.FromDistanceMeters, "fromDistanceMetersR", R(route.FromDistanceMeters),
            "toDistanceMeters", route.ToDistanceMeters, "toDistanceMetersR", R(route.ToDistanceMeters),
            "fromRequiresSecondary", route.FromRequiresSecondary, "toRequiresSecondary", route.ToRequiresSecondary,
            "connectionGapCount", route.ConnectionGapCount, "connectionGapLengthMeters", route.ConnectionGapLengthMeters,
            "connectionGapLengthMetersR", R(route.ConnectionGapLengthMeters));
    }

    private static RoutingOptions Options(double gap) { return new RoutingOptions { ConnectionToleranceMeters = gap,
        SampleSpacingMeters = 0.125, SecondaryDistanceMeters = 2, PreferVerticalApproach = true,
        MaxGraphNodes = 100000, MaxGraphConnections = 250000 }; }
    private static object OptionsValue(RoutingOptions options) { return D("connectionToleranceMeters", options.ConnectionToleranceMeters,
        "sampleSpacingMeters", options.SampleSpacingMeters, "secondaryDistanceMeters", options.SecondaryDistanceMeters,
        "preferVerticalApproach", options.PreferVerticalApproach, "maxGraphNodes", options.MaxGraphNodes, "maxGraphConnections", options.MaxGraphConnections); }
    private T Wait<T>(Task<T> task)
    {
        while (!task.IsCompleted) { token.ThrowIfCancellationRequested(); System.Windows.Forms.Application.DoEvents(); Thread.Sleep(1); }
        return task.GetAwaiter().GetResult();
    }
    private void Progress(string phase, string caseId, object detail)
    {
        File.WriteAllText(Path.Combine(Path.GetDirectoryName(output), "progress.json"), serializer.Serialize(D("phase", phase, "caseId", caseId,
            "utc", DateTime.UtcNow.ToString("o"), "elapsedMilliseconds", clock.ElapsedMilliseconds, "detail", detail)));
    }
    private static double[] Point(RoutePoint point) { return new[] { point.X, point.Y, point.Z }; }
    private static string[] PointR(RoutePoint point) { return new[] { R(point.X), R(point.Y), R(point.Z) }; }
    private static string R(double value) { return value.ToString("R", CultureInfo.InvariantCulture); }
    private static Dictionary<string, object> D(params object[] pairs)
    {
        var result = new Dictionary<string, object>();
        for (int i = 0; i < pairs.Length; i += 2) result.Add((string)pairs[i], pairs[i + 1]);
        return result;
    }
    private static string Hash(string path)
    {
        using (var sha = SHA256.Create()) using (var input = File.OpenRead(path))
            return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
    }
}
