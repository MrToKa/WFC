using System;
using System.Text.RegularExpressions;

namespace AddinRibbon.Routing
{
    public static class RouteCodeParser
    {
        private static readonly Regex KnownCode = new Regex(
            @"(?<![A-Za-z0-9])/?(?<code>(?:DFBC|DFB|DFC|DFV|VFD|BC|A|B|C)\d+(?:-\d+)?)(?![A-Za-z0-9-])",
            RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly Regex SlashCode = new Regex(
            @"/(?<code>(?:[A-Za-z]{1,12}\d+[A-Za-z0-9]*|\d+[A-Za-z][A-Za-z0-9]*)(?:-\d+)?)(?![A-Za-z0-9-])",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);
        private static readonly Regex QualifiedPath = new Regex(
            @"(?<![A-Za-z0-9/])/(?<path>[A-Za-z0-9]+(?:-\d+)?(?:/[A-Za-z0-9][A-Za-z0-9_-]*)+)(?![A-Za-z0-9_/-])",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);
        private static readonly Regex LastToken = new Regex(@"[A-Za-z0-9][A-Za-z0-9-]*",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);
        private static readonly Regex BareCode = new Regex(@"^(?:[A-Za-z]{1,12}\d+[A-Za-z0-9]*|\d+[A-Za-z][A-Za-z0-9]*)(?:-\d+)?$",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        /// <summary>Preserves complete codes including BC/DFBC and numeric piece suffixes.</summary>
        public static string Parse(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "/UNNAMED";
            string code;
            if (TryParseNamedCode(name, out code)) return code;
            var matches = LastToken.Matches(name);
            return matches.Count > 0 ? "/" + matches[matches.Count - 1].Value.ToUpperInvariant() : "/UNNAMED";
        }

        /// <summary>Recognizes a complete code without the display-name fallback.</summary>
        public static bool TryParseNamedCode(string name, out string code)
        {
            code = null;
            if (string.IsNullOrWhiteSpace(name)) return false;
            var paths = QualifiedPath.Matches(name);
            if (paths.Count > 0)
            {
                var parts = paths[paths.Count - 1].Groups["path"].Value.Split('/');
                var owner = SlashCode.Match("/" + parts[parts.Length - 2]);
                if (owner.Success && owner.Length == parts[parts.Length - 2].Length + 1)
                {
                    code = "/" + owner.Groups["code"].Value.ToUpperInvariant();
                    return true;
                }
            }
            var matches = KnownCode.Matches(name);
            if (matches.Count == 0) matches = SlashCode.Matches(name);
            if (matches.Count == 0)
            {
                string bare = name.Trim();
                if (!BareCode.IsMatch(bare)) return false;
                code = "/" + bare.ToUpperInvariant();
                return true;
            }
            code = "/" + matches[matches.Count - 1].Groups["code"].Value.ToUpperInvariant();
            return true;
        }

        internal static bool IsQualifiedComponentName(string name)
        {
            return !string.IsNullOrWhiteSpace(name) && QualifiedPath.IsMatch(name);
        }
    }
}
