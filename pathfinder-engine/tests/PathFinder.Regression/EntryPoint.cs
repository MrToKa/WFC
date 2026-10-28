using System;
using System.Linq;
using System.Reflection;
using AddinRibbon.Routing;

namespace PathFinderRegression
{
    internal static class EntryPoint
    {
        private static int Main(string[] args)
        {
            var core = typeof(RouteCalculator).Assembly;
            var regression = typeof(EntryPoint).Assembly;
            var references = core.GetReferencedAssemblies().Select(reference => reference.Name).OrderBy(name => name).ToArray();
            if (core == regression || core.GetName().Name != "PathFinder.Core")
                throw new InvalidOperationException("Regression must execute the extracted PathFinder.Core assembly.");
            if (references.Any(name => name.IndexOf("Autodesk", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                       name.IndexOf("Navisworks", StringComparison.OrdinalIgnoreCase) >= 0))
                throw new InvalidOperationException("The extracted core must not reference an Autodesk or Navisworks assembly.");
            Console.WriteLine("CORE ASSEMBLY: " + core.GetName().Name);
            Console.WriteLine("CORE LOCATION: " + core.Location);
            Console.WriteLine("CORE REFERENCES: " + string.Join(", ", references));
            Console.WriteLine("ASSEMBLY AUDIT: PASS (separate core DLL, no Autodesk or Navisworks references)");

            // Preserve the original harness sources, including its optional
            // private fixture argument, and invoke its original entry point.
            var originalMain = typeof(Program).GetMethod("Main", BindingFlags.Static | BindingFlags.NonPublic);
            return (int)originalMain.Invoke(null, new object[] { args });
        }
    }
}
