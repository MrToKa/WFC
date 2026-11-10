#!/usr/bin/env python3
"""Offline CAD worker smoke test using generated, non-proprietary STEP solids."""
import base64
import json
import os
import tempfile

import cadquery as cq
from converter import convert_step, assemble_step


def main():
    with tempfile.TemporaryDirectory() as work:
        source = os.path.join(work, "box.step")
        cq.exporters.export(cq.Workplane("XY").box(100, 50, 20), source)
        mesh = convert_step(source)
        assert mesh["schemaVersion"] == 1
        assert mesh["units"] == "mm"
        assert mesh["solidCount"] == 1
        assert 0 < mesh["triangleCount"] <= 20000
        assert len(mesh["indices"]) == len(mesh["positions"]) // 3
        assert all(abs(x) <= 1e9 for x in mesh["positions"])
        with open(source, "rb") as stream:
            original = stream.read()
        encoded = base64.b64encode(original).decode("ascii")
        result = assemble_step({"parts": [
            {"name": "first", "stepBase64": encoded, "positionMm": [0, 0, 0],
             "rotation": [0, 0, 0, 1]},
            {"name": "second", "stepBase64": encoded, "positionMm": [500, 1000, 2000],
             "rotation": [0, 0, 0, 1]},
        ]})
        destination = os.path.join(work, "assembly.step")
        with open(destination, "wb") as stream:
            stream.write(result)
        solids = cq.importers.importStep(destination).solids().vals()
        assert len(solids) == 2, f"Expected two STEP solids; got {len(solids)}"
        bounds = [solid.BoundingBox() for solid in solids]
        assert max(b.xmax for b in bounds) > 400
        assert max(b.ymax for b in bounds) > 900
        assert max(b.zmax for b in bounds) > 1900
        print(json.dumps({
            "status": "PASS", "sourceSolids": 1,
            "meshTriangles": mesh["triangleCount"],
            "exportedSolids": len(solids), "bytes": len(result),
        }))


if __name__ == "__main__":
    main()
