#!/usr/bin/env python3
"""Private, bounded STEP Part-21 -> Autodesk Scene API triangle mesh converter.

Only intended for the isolated Aalborg PoC container. All coordinates are
in the original STEP millimetres, including the local CAD origin.
"""
import base64
import binascii
import hmac
import hashlib
import json
import math
import os
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

import cadquery as cq
from OCP.gp import gp_Quaternion, gp_Trsf, gp_Vec

MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_ASSEMBLY_PARTS = 128
MAX_TRIANGLES = 20000
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
TOKEN = os.environ.get("POC_CONVERTER_TOKEN", "")


def cut_straight_solids(solids, length_mm):
    """Cut the known local-Z 6000 mm stock; never scale its profile or rungs."""
    if isinstance(length_mm, bool) or not isinstance(length_mm, (int, float)) or not 0 < length_mm <= 6000 or not math.isfinite(length_mm):
        raise ValueError("Cut length must be finite and greater than zero, up to 6000 mm")
    if not solids or len(solids) > 100:
        raise ValueError("Invalid straight solid count")
    boxes = [solid.BoundingBox() for solid in solids]
    bounds = [min(box.xmin for box in boxes), min(box.ymin for box in boxes),
              min(box.zmin for box in boxes), max(box.xmax for box in boxes),
              max(box.ymax for box in boxes), max(box.zmax for box in boxes)]
    if not all(math.isfinite(value) and abs(value) <= 1e9 for value in bounds) or abs(bounds[2]) > 0.001 or abs(bounds[5] - 6000) > 0.001:
        raise ValueError("Cutting requires the original local-Z 0..6000 mm straight stock")
    if not all(solid.isValid() and solid.Volume() > 1e-9 for solid in solids):
        raise ValueError("Invalid source B-Rep")
    if length_mm == 6000:
        return list(solids)
    # All X/Y source geometry remains inside the cutting box. Its only effective
    # cut plane is Z=length, leaving the original Z=0 start and rung pitch intact.
    cutter = cq.Solid.makeBox(bounds[3] - bounds[0] + 2, bounds[4] - bounds[1] + 2,
                             float(length_mm), cq.Vector(bounds[0] - 1, bounds[1] - 1, 0))
    result = []
    for solid in solids:
        for cut in solid.intersect(cutter).Solids():
            if not cut.isValid() or cut.Volume() <= 1e-9:
                raise ValueError("Cut produced an invalid solid")
            result.append(cut)
    if not result or len(result) > 100:
        raise ValueError("Cut produced no usable solids or exceeded the body limit")
    cut_boxes = [solid.BoundingBox() for solid in result]
    if abs(min(box.zmin for box in cut_boxes)) > 0.001 or abs(max(box.zmax for box in cut_boxes) - length_mm) > 0.001:
        raise ValueError("Cut B-Rep does not match the requested straight length")
    return result


def convert_step(step_path, cut_length_mm=None):
    assembly = cq.importers.importStep(step_path)
    solids = assembly.solids().vals()
    if not solids or len(solids) > 100:
        raise ValueError("STEP file must contain between 1 and 100 solid bodies")
    if cut_length_mm is not None:
        solids = cut_straight_solids(solids, cut_length_mm)

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
    if not isinstance(parts, list) or not 1 <= len(parts) <= MAX_ASSEMBLY_PARTS:
        raise ValueError(f"Expected 1 to {MAX_ASSEMBLY_PARTS} CAD parts")
    if set(request) - {"parts", "sources"}:
        raise ValueError("Invalid CAD assembly request")
    total_source_bytes = 0
    source_bytes = {}

    def retain_source(encoded, claimed_id=None):
        nonlocal total_source_bytes
        try:
            original = base64.b64decode(encoded, validate=True)
        except (TypeError, ValueError, binascii.Error):
            raise ValueError("Invalid encoded CAD source")
        if len(original) < 40 or not original.lstrip().startswith(b"ISO-10303-21;"):
            raise ValueError("CAD source is not STEP Part-21")
        source_id = hashlib.sha256(original).hexdigest()
        if claimed_id is not None and claimed_id != source_id:
            raise ValueError("CAD source bank hash differs")
        if source_id not in source_bytes:
            total_source_bytes += len(original)
            if total_source_bytes > MAX_INPUT_BYTES:
                raise ValueError("Unique CAD source exceeds limit")
            source_bytes[source_id] = original
        return source_id

    bank = request.get("sources")
    if "sources" in request:
        if not isinstance(bank, list) or not 1 <= len(bank) <= MAX_ASSEMBLY_PARTS:
            raise ValueError("Invalid CAD source bank")
        for item in bank:
            if not isinstance(item, dict) or set(item) != {"id", "stepBase64"} or not isinstance(item["id"], str):
                raise ValueError("Invalid CAD source bank entry")
            if item["id"] in source_bytes:
                raise ValueError("Duplicate CAD source bank identity")
            retain_source(item["stepBase64"], item["id"])
    with tempfile.TemporaryDirectory(prefix="wfc-cad-assembly-") as work:
        result = cq.Assembly(name="WFC Proposed Cable Tray")
        imported = {}
        cut_cache = {}
        for index, part in enumerate(parts):
            required = {"name", "positionMm", "rotation"}
            if not isinstance(part, dict) or not required.issubset(part) or set(part) - required - {"stepBase64", "sourceId", "cutLengthMm"}:
                raise ValueError("Invalid CAD assembly part")
            if ("sourceId" in part) == ("stepBase64" in part):
                raise ValueError("Choose exactly one CAD source reference")
            if not isinstance(part["name"], str) or not 1 <= len(part["name"]) <= 120:
                raise ValueError("Invalid CAD part label")
            if "sourceId" in part:
                source_id = part["sourceId"]
                if not isinstance(source_id, str) or source_id not in source_bytes:
                    raise ValueError("Unknown CAD source reference")
            else:
                source_id = retain_source(part["stepBase64"])
            position, rotation = part["positionMm"], part["rotation"]
            if not isinstance(position, list) or len(position) != 3 or not all(
                    isinstance(x, (int, float)) and math.isfinite(x) and abs(x) <= 1e9 for x in position):
                raise ValueError("Invalid CAD position")
            if not isinstance(rotation, list) or len(rotation) != 4 or not all(
                    isinstance(x, (int, float)) and math.isfinite(x) and abs(x) <= 1 for x in rotation):
                raise ValueError("Invalid CAD rotation")
            if abs(sum(float(x)*float(x) for x in rotation) - 1) > 1e-6:
                raise ValueError("Rotation must be a unit quaternion")
            if source_id not in imported:
                source_path = os.path.join(work, f"source-{source_id}.step")
                with open(source_path, "wb") as stream:
                    stream.write(source_bytes[source_id])
                imported[source_id] = cq.importers.importStep(source_path).solids().vals()
                if not imported[source_id] or len(imported[source_id]) > 50:
                    raise ValueError("Invalid CAD solid count")
            solids = imported[source_id]
            if "cutLengthMm" in part:
                length = part["cutLengthMm"]
                if isinstance(length, bool) or not isinstance(length, (int, float)) or not math.isfinite(length) or not 0 < length <= 6000:
                    raise ValueError("Invalid CAD cut length")
                cache_key = (source_id, float(length))
                if cache_key not in cut_cache:
                    cut_cache[cache_key] = cut_straight_solids(solids, length)
                solids = cut_cache[cache_key]
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
                cut_headers = self.headers.get_all("X-WFC-Cut-Length-Mm") or []
                if len(cut_headers) > 1:
                    raise ValueError("Duplicate cut length header")
                cut_length = float(cut_headers[0]) if cut_headers else None
                result = convert_step(filepath, cut_length)
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
