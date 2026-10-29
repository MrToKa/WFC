using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace AddinRibbon.Routing
{
    /// <summary>Resolves route labels from leaf-to-root names within the assigned route selection.</summary>
    public static class RouteNameResolver
    {
        private static readonly Regex Component = new Regex(
            @"(?<![A-Za-z0-9])(?:FTUBE|TUBE|STRAIGHT|BEND|ELBOW|ELBO|BRANCH|BRAN|TEE|CROSS|CROS|REDUCER|REDU|COUPLING|ADAPTER|CAP)(?![A-Za-z0-9])",
            RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public static string Resolve(IEnumerable<string> leafToSelectedRootNames)
        {
            var names = (leafToSelectedRootNames ?? Enumerable.Empty<string>()).ToArray();
            string code;
            // The nearest explicit logical route wins, including independently named route pieces.
            foreach (string name in names)
            {
                if (IsComponent(name)) continue;
                if (RouteCodeParser.TryParseNamedCode(name, out code)) return code;
            }

            // A component selected directly may carry its owner in its qualified name.
            foreach (string name in names)
                if (RouteCodeParser.TryParseNamedCode(name, out code)) return code;

            return RouteCodeParser.Parse(names.LastOrDefault(name => !string.IsNullOrWhiteSpace(name)));
        }

        /// <summary>Identity of the same logical owner used by Resolve, or -1 without an explicit route code.</summary>
        public static int OwnerIndex(IReadOnlyList<string> leafToRootNames)
        {
            string code;
            for (int i = 0; i < leafToRootNames.Count; i++)
                if (!IsComponent(leafToRootNames[i]) && RouteCodeParser.TryParseNamedCode(leafToRootNames[i], out code)) return i;
            for (int i = 0; i < leafToRootNames.Count; i++)
                if (RouteCodeParser.TryParseNamedCode(leafToRootNames[i], out code)) return i;
            return -1;
        }

        private static bool IsComponent(string name)
        {
            return Component.IsMatch(name ?? "") || RouteCodeParser.IsQualifiedComponentName(name);
        }
    }
}
