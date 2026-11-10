#!/usr/bin/env python3
"""Private, bounded STEP Part-21 -> Autodesk Scene API triangle mesh converter.

Only intended for the isolated Aalborg PoC container. All coordinates are
in the original STEP millimetres, including the local CAD origin.
"""
import base64
import binascii
import hmac
import json
import math
import os
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

import cadquery as cq
from OCP.gp import gp_Quaternion, gp_Trsf, gp_Vec

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


def assemble_step(request):
    parts = request.get("parts") if isinstance(request, dict) else None
    if not isinstance(parts, list) or not 1 <= len(parts) <= 32:
        raise ValueError("Expected 1 to 32 CAD parts")
    total_source_bytes = 0
    with tempfile.TemporaryDirectory(prefix="wfc-cad-assembly-") as work:
        result = cq.Assembly(name="WFC Proposed Cable Tray")
        for index, part in enumerate(parts):
            if not isinstance(part, dict) or set(part) != {"name", "stepBase64", "positionMm", "rotation"}:
                raise ValueError("Invalid CAD assembly part")
            if not isinstance(part["name"], str) or not 1 <= len(part["name"]) <= 120:
                raise ValueError("Invalid CAD part label")
            try:
                original = base64.b64decode(part["stepBase64"], validate=True)
            except (TypeError, ValueError, binascii.Error):
                raise ValueError("Invalid encoded CAD source")
            total_source_bytes += len(original)
            if len(original) < 40 or total_source_bytes > 8 * 1024 * 1024:
                raise ValueError("CAD source exceeds limit")
            if not original.lstrip().startswith(b"ISO-10303-21;"):
                raise ValueError("CAD source is not STEP Part-21")
            position, rotation = part["positionMm"], part["rotation"]
            if not isinstance(position, list) or len(position) != 3 or not all(
                    isinstance(x, (int, float)) and math.isfinite(x) and abs(x) <= 1e9 for x in position):
                raise ValueError("Invalid CAD position")
            if not isinstance(rotation, list) or len(rotation) != 4 or not all(
                    isinstance(x, (int, float)) and math.isfinite(x) and abs(x) <= 1 for x in rotation):
                raise ValueError("Invalid CAD rotation")
            if abs(sum(float(x)*float(x) for x in rotation) - 1) > 1e-6:
                raise ValueError("Rotation must be a unit quaternion")
            source_path = os.path.join(work, f"part-{index}.step")
            with open(source_path, "wb") as stream:
                stream.write(original)
            solids = cq.importers.importStep(source_path).solids().vals()
            if not solids or len(solids) > 50:
                raise ValueError("Invalid CAD solid count")
            transform = gp_Trsf()
            transform.SetRotation(gp_Quaternion(*rotation))
            transform.SetTranslationPart(gp_Vec(*position))
            for solid_index, solid in enumerate(solids):
                result.add(solid, name=f"part{index + 1}_solid{solid_index + 1}",
                           loc=cq.Location(transform))
        output_path = os.path.join(work, "assembly.step")
        result.save(output_path, exportType="STEP")
        if os.path.getsize(output_path) > 32 * 1024 * 1024:
            raise ValueError("CAD assembly exceeds output limit")
        # Reimport via the exact CAD kernel; an empty file is not an export.
        verify = cq.importers.importStep(output_path).solids().vals()
        if len(verify) < len(parts):
            raise ValueError("CAD assembly readback lost solids")
        with open(output_path, "rb") as stream:
            return stream.read()


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
        if self.path not in ("/convert", "/assemble"):
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
        limit = MAX_INPUT_BYTES if self.path == "/convert" else 12 * 1024 * 1024
        if not 40 <= size <= limit:
            self.respond(413, {"code": "INVALID_STEP_SIZE"})
            return
        payload = self.rfile.read(size)
        if len(payload) != size:
            self.respond(422, {"code": "INCOMPLETE_CAD_INPUT"})
            return
        if self.path == "/assemble":
            try:
                source = json.loads(payload.decode("utf-8"))
                data = assemble_step(source)
                self.send_response(200)
                self.send_header("Content-Type", "application/step")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
            except (ValueError, RuntimeError, UnicodeDecodeError, TypeError, KeyError):
                self.respond(422, {"code": "STEP_ASSEMBLY_FAILED"})
            except Exception:
                self.respond(500, {"code": "ASSEMBLY_CONVERTER_FAILURE"})
            return
        if not payload.lstrip().startswith(b"ISO-10303-21;"):
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
