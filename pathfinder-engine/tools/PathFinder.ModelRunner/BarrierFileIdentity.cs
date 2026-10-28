using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

internal static class BarrierFileIdentity
{
    internal readonly record struct Identity(ulong Device, ulong Inode, ulong Size, ulong ModifiedSeconds, uint ModifiedNanoseconds, uint Links, uint Kind);
    internal static Identity Path(string path)
    {
        if (OperatingSystem.IsLinux()) return Linux(-100, path, 0x100);
        if (OperatingSystem.IsWindows())
        {
            using var handle = CreateFile(WindowsNativePath(path), 0x80, 1 | 2 | 4, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
            if (handle.IsInvalid) throw new IOException("Barrier path identity unavailable.", new Win32Exception(Marshal.GetLastPInvokeError()));
            return Windows(handle);
        }
        throw new IOException("Barrier file identity is unsupported on this platform.");
    }
    private static string WindowsNativePath(string path)
    {
        if (!System.IO.Path.IsPathFullyQualified(path)) throw new IOException("Barrier native identity requires an absolute owned path.");
        string normalized = System.IO.Path.GetFullPath(path);
        // .NET FileStream already supports long owned paths. Native CreateFileW
        // needs the equivalent extended absolute spelling, including UNC roots.
        // This changes only API spelling, never the checked ownership pathname.
        if (normalized.StartsWith(@"\\?\", StringComparison.Ordinal)) return normalized;
        if (normalized.StartsWith(@"\\.\", StringComparison.Ordinal)) throw new IOException("Barrier device paths are unavailable.");
        if (normalized.StartsWith(@"\\", StringComparison.Ordinal)) return @"\\?\UNC\" + normalized[2..];
        if (normalized.Length >= 3 && char.IsAsciiLetter(normalized[0]) && normalized[1] == ':' && normalized[2] == '\\')
            return @"\\?\" + normalized;
        throw new IOException("Barrier native identity requires a normalized drive or UNC path.");
    }
    internal static Identity Handle(SafeFileHandle handle)
    {
        if (OperatingSystem.IsLinux()) return Linux(handle.DangerousGetHandle().ToInt32(), "", 0x1000);
        if (OperatingSystem.IsWindows()) return Windows(handle);
        throw new IOException("Barrier file identity is unsupported on this platform.");
    }
    private static Identity Linux(int directory, string path, int flags)
    {
        var bytes = new byte[256];
        if (Statx(directory, path, flags, 0x7ff, bytes) != 0) throw new IOException("Barrier statx identity unavailable.", new Win32Exception(Marshal.GetLastPInvokeError()));
        uint mask = BitConverter.ToUInt32(bytes, 0);
        if ((mask & 0x347) != 0x347) throw new IOException("Barrier file identity lacks required fields.");
        ulong device = ((ulong)BitConverter.ToUInt32(bytes, 136) << 32) | BitConverter.ToUInt32(bytes, 140);
        return new(device, BitConverter.ToUInt64(bytes, 32), BitConverter.ToUInt64(bytes, 40), BitConverter.ToUInt64(bytes, 112),
            BitConverter.ToUInt32(bytes, 120), BitConverter.ToUInt32(bytes, 16), (uint)(BitConverter.ToUInt16(bytes, 28) & 0xf000));
    }
    private static Identity Windows(SafeFileHandle handle)
    {
        if (!GetFileInformationByHandle(handle, out var info)) throw new IOException("Barrier handle identity unavailable.", new Win32Exception(Marshal.GetLastPInvokeError()));
        uint kind = (info.Attributes & 0x400) != 0 ? 0xa000U : (info.Attributes & 0x10) != 0 ? 0x4000U : 0x8000U;
        return new(info.Volume, ((ulong)info.IndexHigh << 32) | info.IndexLow, ((ulong)info.SizeHigh << 32) | info.SizeLow,
            ((ulong)info.WriteHigh << 32) | info.WriteLow, 0, info.Links, kind);
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct WindowsInfo
    {
        internal uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("libc", EntryPoint = "statx", SetLastError = true)]
    private static extern int Statx(int directory, [MarshalAs(UnmanagedType.LPUTF8Str)] string path, int flags, uint mask, [Out] byte[] buffer);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint desiredAccess, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out WindowsInfo information);
}
