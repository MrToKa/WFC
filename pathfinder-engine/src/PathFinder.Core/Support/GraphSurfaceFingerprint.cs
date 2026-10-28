using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace AddinRibbon.Routing
{
    public sealed partial class TrayMeshClearance
    {
        private readonly object graphIdentityGate = new object();
        private string graphIdentity;
        internal long GraphOrdinal { get { return instanceOrdinal; } }
        /// <summary>Hash the exact retained triangles, including clipping, in their original order.
        /// Bounds/counts cannot establish that two different surfaces are interchangeable.</summary>
        internal string GraphIdentity(CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            lock (graphIdentityGate)
            {
                if (graphIdentity != null) return graphIdentity;
                using (var hash = SHA256.Create())
                using (var stream = new CryptoStream(Stream.Null, hash, CryptoStreamMode.Write))
                using (var buffered = new BufferedStream(stream, 65536))
                using (var writer = new BinaryWriter(buffered, Encoding.UTF8, true))
                {
                    writer.Write("retained-triangle-order.v1"); writer.Write(references.Length);
                    for (int i = 0; i < references.Length; i++)
                    {
                        if ((i & 127) == 0) token.ThrowIfCancellationRequested();
                        var triangle = TriangleAt(i);
                        GraphPreparationCache.WritePoint(writer, triangle.A.Point); GraphPreparationCache.WritePoint(writer, triangle.B.Point); GraphPreparationCache.WritePoint(writer, triangle.C.Point);
                    }
                    writer.Flush(); stream.FlushFinalBlock(); token.ThrowIfCancellationRequested();
                    graphIdentity = GraphPreparationCache.Hex(hash.Hash); return graphIdentity;
                }
            }
        }
    }
}
