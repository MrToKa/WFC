#!/usr/bin/env python3
"""Offline CAD worker smoke test using generated, non-proprietary STEP solids."""
import base64
import http.client
import json
import os
import tempfile
import threading
from http.server import HTTPServer

import cadquery as cq
import converter
from converter import convert_step, assemble_step, cut_straight_solids


def check_http_cut(original):
    previous_token = converter.TOKEN
    converter.TOKEN = "synthetic-offline-worker-smoke-token"
    server = HTTPServer(("127.0.0.1", 0), converter.Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        for header, status, expected_length in ((None, 200, 6000), ("1500", 200, 1500),
                                                ("0", 422, None), ("6001", 422, None),
                                                ("nan", 422, None)):
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=10)
            headers = {"Authorization": "Bearer " + converter.TOKEN, "Content-Type": "application/step"}
            if header is not None:
                headers["X-WFC-Cut-Length-Mm"] = header
            connection.request("POST", "/convert", body=original, headers=headers)
            response = connection.getresponse()
            data = json.loads(response.read())
            assert response.status == status
            if expected_length is not None:
                assert abs(data["boundsMm"]["max"][2] - expected_length) < 0.001
            connection.close()
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=10)
        connection.putrequest("POST", "/convert")
        connection.putheader("Authorization", "Bearer " + converter.TOKEN)
        connection.putheader("Content-Length", str(len(original)))
        connection.putheader("X-WFC-Cut-Length-Mm", "1500")
        connection.putheader("X-WFC-Cut-Length-Mm", "2000")
        connection.endheaders(original)
        response = connection.getresponse()
        response.read()
        assert response.status == 422
        connection.close()
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)
        converter.TOKEN = previous_token


def check_cut_stock(work):
    # Two unchanged rails and regularly spaced rungs. A shortened stock must
    # remove later rungs instead of squeezing the full ladder into 1500 mm.
    ladder = cq.Workplane("XY").box(10, 60, 6000, centered=(True, False, False)).translate((-145, 0, 0))
    ladder = ladder.union(cq.Workplane("XY").box(10, 60, 6000, centered=(True, False, False)).translate((145, 0, 0)))
    for z in range(250, 6000, 500):
        ladder = ladder.union(cq.Workplane("XY").box(300, 10, 20, centered=(True, False, True)).translate((0, 20, z)))
    source = os.path.join(work, "straight-6000.step")
    cq.exporters.export(ladder, source)
    original = cq.importers.importStep(source).solids().vals()
    full = convert_step(source)
    mesh = convert_step(source, 1500)
    assert abs(full["boundsMm"]["max"][2] - 6000) < 0.001
    assert abs(mesh["boundsMm"]["max"][2] - 1500) < 0.001
    assert mesh["boundsMm"]["min"] == full["boundsMm"]["min"]
    assert mesh["boundsMm"]["max"][:2] == full["boundsMm"]["max"][:2]
    cut = cut_straight_solids(original, 1500)
    # Existing 250/750/1250 mm rung coordinates remain occupied. The open
    # 500/1000 mm gaps stay empty, catching a stretched/squashed mesh or B-Rep.
    contains = lambda z: any(solid.isInside(cq.Vector(0, 25, z), 0.001) for solid in cut)
    assert all(contains(z) for z in (250, 750, 1250))
    assert not any(contains(z) for z in (500, 1000, 1750))
    assert abs(sum(s.Volume() for s in cut_straight_solids(original, 6000)) - sum(s.Volume() for s in original)) < 0.001
    for invalid in (0, -1, 6000.01, 10**1000, float("nan"), float("inf"), True, None, "1500"):
        try:
            cut_straight_solids(original, invalid)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid cut length accepted")
    with open(source, "rb") as stream:
        source_bytes = stream.read()
        encoded = base64.b64encode(source_bytes).decode("ascii")
    check_http_cut(source_bytes)
    result = assemble_step({"parts": [{"name": "cut", "stepBase64": encoded,
        "positionMm": [500, 1000, 2000], "rotation": [0, 0, 0, 1], "cutLengthMm": 1500}]})
    destination = os.path.join(work, "cut-assembly.step")
    with open(destination, "wb") as stream:
        stream.write(result)
    exported = cq.importers.importStep(destination).solids().vals()
    assert abs(max(s.BoundingBox().zmax for s in exported) - 3500) < 0.001
    assert abs(min(s.BoundingBox().zmin for s in exported) - 2000) < 0.001
    assert abs(sum(s.Volume() for s in exported) - sum(s.Volume() for s in cut)) < 0.001
    # Calling a cut on the arbitrary box fixture is not permitted even though
    # it is a valid STEP; the upstream API additionally pins the approved SHA.
    box = cq.Workplane("XY").box(10, 10, 20).solids().vals()
    try:
        cut_straight_solids(box, 10)
    except ValueError:
        pass
    else:
        raise AssertionError("Unknown source envelope accepted for cutting")
    return {"cutLengthMm": 1500, "originalLengthMm": 6000,
            "rungPitchPreserved": True, "cutSolids": len(exported), "httpCutChecks": 6}


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
        cut_report = check_cut_stock(work)
        print(json.dumps({
            "status": "PASS", "sourceSolids": 1,
            "meshTriangles": mesh["triangleCount"],
            "exportedSolids": len(solids), "bytes": len(result),
            "straightCut": cut_report,
        }))


if __name__ == "__main__":
    main()
