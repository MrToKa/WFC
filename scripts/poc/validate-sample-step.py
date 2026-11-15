#!/usr/bin/env python3
"""Read supplied local samples inside the offline worker; never modify originals."""
import base64
import hashlib
import json
import os
import sys
import tempfile

import cadquery as cq
from converter import assemble_step, convert_step


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Supply straight and bend STEP paths (read-only mounts).")
    parts = []
    results = []
    for index, source in enumerate(sys.argv[1:]):
        with open(source, "rb") as stream:
            original = stream.read()
        mesh = convert_step(source)
        assert mesh["units"] == "mm"
        assert mesh["solidCount"] == 1
        assert 0 < mesh["triangleCount"] <= 20000
        results.append({"filename": os.path.basename(source),
                        "sha256": hashlib.sha256(original).hexdigest(),
                        "bytes": len(original), "solids": mesh["solidCount"],
                        "triangles": mesh["triangleCount"], "boundsMm": mesh["boundsMm"]})
        parts.append({"name": "sample_" + str(index),
                      "stepBase64": base64.b64encode(original).decode("ascii"),
                      "positionMm": [index * 5000, 0, 0], "rotation": [0, 0, 0, 1]})
    assembly = assemble_step({"parts": parts})
    with tempfile.TemporaryDirectory() as work:
        output = os.path.join(work, "samples.step")
        with open(output, "wb") as stream:
            stream.write(assembly)
        solids = cq.importers.importStep(output).solids().vals()
        assert len(solids) == 2
    print(json.dumps({"status": "PASS", "samples": results,
                      "assemblySolids": len(solids), "assemblyBytes": len(assembly)}))


if __name__ == "__main__":
    main()
