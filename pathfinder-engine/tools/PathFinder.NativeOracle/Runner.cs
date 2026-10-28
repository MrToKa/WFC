using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using Autodesk.Navisworks.Api.Automation;

internal static class NativeOracleRunner
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 5) { Console.Error.WriteLine("Expected install, copied-model, oracle-plugin, output, specification paths."); return 2; }
        string install = Path.GetFullPath(args[0]);
        for (int i = 1; i < args.Length; i++) args[i] = Path.GetFullPath(args[i]);
        foreach (int i in new[] { 1, 2, 4 }) if (!File.Exists(args[i])) { Console.Error.WriteLine("Missing input: " + args[i]); return 2; }
        if (File.Exists(args[3])) { Console.Error.WriteLine("Refusing to overwrite an existing capture."); return 2; }
        AppDomain.CurrentDomain.AssemblyResolve += (sender, request) =>
        {
            string path = Path.Combine(install, new AssemblyName(request.Name).Name + ".dll");
            return File.Exists(path) ? Assembly.LoadFrom(path) : null;
        };
        Environment.SetEnvironmentVariable("PATH", install + ";" + Environment.GetEnvironmentVariable("PATH"));
        try { return Run(args); }
        catch (Exception error) { Console.Error.WriteLine(error); return 2; }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int Run(string[] args)
    {
        Console.WriteLine("Starting owned invisible automation host at " + DateTime.UtcNow.ToString("o"));
        using (var host = new NavisworksApplication())
        {
            host.DisableProgress();
            Console.WriteLine("Opening isolated copied model.");
            host.OpenFile(args[1], new string[0]);
            Console.WriteLine("Loading unique oracle plugin.");
            host.AddPluginAssembly(args[2]);
            int code = host.ExecuteAddInPlugin("PathFinderNativeOracle.PF2L", new[] { args[3], args[4] });
            Console.WriteLine("Oracle result: " + code + " at " + DateTime.UtcNow.ToString("o"));
            return code;
        }
    }
}
