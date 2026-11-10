#!/usr/bin/env python3
"""Private, bounded STEP Part-21 -> Autodesk Scene API triangle mesh converter.

Only intended for the isolated Aalborg PoC container. All coordinates are
in the original STEP millimetres, including the local CAD origin.
"""
import hmac
import json
import math
import os
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

import cadquery as cq

MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_TRIANGLES = 20000
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
TOKEN = os.environ.get("POC_CONVERTER_TOKEN", "")


def convert_step(step_path):
    assembly = cq.importers.importStep(step_path)
    solids = assembly.solids().vals()
    if not solids or len(solids) > 100:
        raise ValueError("STEP file must contain between 1 and 100 solid bodies")

    positions, normals, indices = [], [], []
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3

    for solid in solids:
        vertices, triangles = solid.tessellate(0.25, 0.15)
        if len(triangles) + len(indices) // 3 > MAX_TRIANGLES:
            raise ValueError("STEP triangle budget exceeded")
        for face in triangles:
            a, b, c = (vertices[face[0]], vertices[face[1]], vertices[face[2]])
            pa = (float(a.x), float(a.y), float(a.z))
            pb = (float(b.x), float(b.y), float(b.z))
            pc = (float(c.x), float(c.y), float(c.z))
            u = [pb[i] - pa[i] for i in range(3)]
            v = [pc[i] - pa[i] for i in range(3)]
            n = (u[1] * v[2] - u[2] * v[1],
                 u[2] * v[0] - u[0] * v[2],
                 u[0] * v[1] - u[1] * v[0])
            length = math.sqrt(sum(x * x for x in n))
            if length < 1e-12:
                continue
            normal = tuple(x / length for x in n)
            for p in (pa, pb, pc):
                if not all(math.isfinite(x) and abs(x) <= 1e9 for x in p):
                    raise ValueError("Invalid STEP coordinate")
                positions.extend(round(x, 6) for x in p)
                normals.extend(round(x, 6) for x in normal)
                for axis in range(3):
                    lo[axis] = min(lo[axis], p[axis])
                    hi[axis] = max(hi[axis], p[axis])
                indices.append(len(indices))

    if not indices:
        raise ValueError("No usable triangles")
    return {
        "schemaVersion": 1,
        "units": "mm",
        "solidCount": len(solids),
        "triangleCount": len(indices) // 3,
        "positions": positions,
        "normals": normals,
        "indices": indices,
        "boundsMm": {"min": lo, "max": hi},
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format_string, *args):
        # Avoid logging file contents, auth headers or CAD paths.
        return

    def respond(self, status, obj):
        data = json.dumps(obj, separators=(",", ":"), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.respond(200, {"status": "ok"})
        else:
            self.respond(404, {"code": "NOT_FOUND"})

    def do_POST(self):
        if self.path != "/convert":
            self.respond(404, {"code": "NOT_FOUND"})
            return
        actual = self.headers.get("Authorization", "")
        if not TOKEN or not hmac.compare_digest(actual, "Bearer " + TOKEN):
            self.respond(401, {"code": "UNAUTHORIZED"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = -1
        if not 40 <= size <= MAX_INPUT_BYTES:
            self.respond(413, {"code": "INVALID_STEP_SIZE"})
            return
        payload = self.rfile.read(size)
        if len(payload) != size or not payload.lstrip().startswith(b"ISO-10303-21;"):
            self.respond(422, {"code": "INVALID_STEP_ENVELOPE"})
            return
        try:
            with tempfile.TemporaryDirectory(prefix="wfc-cad-") as work:
                filepath = os.path.join(work, "source.step")
                with open(filepath, "wb") as stream:
                    stream.write(payload)
                result = convert_step(filepath)
            encoded = json.dumps(result, separators=(",", ":"), allow_nan=False).encode("utf-8")
            if len(encoded) > MAX_OUTPUT_BYTES:
                self.respond(413, {"code": "MESH_TOO_LARGE"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(encoded)
        except (ValueError, RuntimeError):
            self.respond(422, {"code": "STEP_CONVERSION_FAILED"})
        except Exception:
            self.respond(500, {"code": "CONVERTER_FAILURE"})


if __name__ == "__main__":
    if len(TOKEN) < 32:
        raise RuntimeError("POC_CONVERTER_TOKEN must be at least 32 characters")
    HTTPServer(("0.0.0.0", 8090), Handler).serve_forever()
