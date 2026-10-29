// The pinned SDK's enumMeshIndices has an incorrect unindexed branch. Its
// enumMeshTriangles enumerates both representations correctly and provides
// the original vertex indices after the three decoded vertex arguments.
export function enumerateTriangleIndices(geometry, reader, visit) {
  if (typeof reader?.enumMeshTriangles !== 'function') throw new Error('Pinned SDK triangle enumeration API unavailable.');
  reader.enumMeshTriangles(geometry, (_first, _second, _third, a, b, c) => visit(a, b, c));
}
