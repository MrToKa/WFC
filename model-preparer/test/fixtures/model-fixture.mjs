import { createHash } from 'node:crypto';

// Fixed tiny SVF envelope created once with a standard ZIP implementation.
// It is test data, not a second ZIP writer or a production geometry sample.
const SVF = 'UEsDBBQAAAAAAE1iUF3ceDb+9gEAAPYBAAANAAAAbWFuaWZlc3QuanNvbnsiYWRza0lEIjp7InZlcnNpb24iOiIiLCJpZCI6IiIsInR5cGUiOiIiLCJzb3VyY2VTeXN0ZW0iOiIifSwibmFtZSI6IkxNViBNYW5pZmVzdCIsImFzc2V0cyI6W3sidHlwZXNldCI6IjIiLCJVUkkiOiIwLnBmIiwiaWQiOiIwLnBmIiwidHlwZSI6IkF1dG9kZXNrLkNsb3VkUGxhdGZvcm0uUGFja0ZpbGUiLCJzaXplIjo0MSwidXNpemUiOjIxfSx7IlVSSSI6ImVtYmVkOi9tZXRhZGF0YS5qc29uIiwiaWQiOiJtZXRhZGF0YS5qc29uIiwidHlwZSI6IkF1dG9kZXNrLkNsb3VkUGxhdGZvcm0uVmlld2luZ01ldGFkYXRhIiwic2l6ZSI6NjcsInVzaXplIjo2N31dLCJ0eXBlc2V0cyI6W3sidHlwZXMiOlt7ImNsYXNzIjoiQXV0b2Rlc2suQ2xvdWRQbGF0Zm9ybS5HZW9tZXRyeSIsInZlcnNpb24iOjEsInR5cGUiOiJBdXRvZGVzay5DbG91ZFBsYXRmb3JtLk9wZW5DVE0ifV0sImlkIjoiMiJ9XSwidG9vbGtpdHZlcnNpb24iOiJMTVZUSyA1LjAuMjYuMCIsIm1hbmlmZXN0dmVyc2lvbiI6Mn1QSwMEFAAAAAAATWJQXZmneoRDAAAAQwAAAA0AAABtZXRhZGF0YS5qc29ueyJ2ZXJzaW9uIjoiMS4wIiwibWV0YWRhdGEiOnsiZGVmYXVsdCBkaXNwbGF5IHVuaXQiOnsidmFsdWUiOiJtIn19fVBLAQIUABQAAAAAAE1iUF3ceDb+9gEAAPYBAAANAAAAAAAAAAAAAAAAAAAAAABtYW5pZmVzdC5qc29uUEsBAhQAFAAAAAAATWJQXZmneoRDAAAAQwAAAA0AAAAAAAAAAAAAAAAAIQIAAG1ldGFkYXRhLmpzb25QSwUGAAAAAAIAAgB2AAAAjwIAAAAA';
export function tinyModel() {
  const data = new Map([
    ['output/0/0.svf', Buffer.from(SVF, 'base64')],
    ['output/0/0.pf', Buffer.from('H4sIAAAAAAAACgtITM52y8xJVUjLrCgpLUpVSEksSQQA8RQI6hUAAAA=', 'base64')],
    ['output/0/properties.db', Buffer.from('SQLite format 3\0fixture-data', 'ascii')],
  ]);
  const resources = [...data].map(([resourcePath, raw], at) => ({ path: resourcePath, resourceId: `resource-${at}`, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') }));
  return { data, resources };
}
