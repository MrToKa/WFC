#!/usr/bin/env python3
"""Offline CAD worker smoke test using generated, non-proprietary STEP solids."""
import base64
import http.client
import hashlib
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


def check_section_metadata(work, encoded, source_id):
    from OCP.STEPCAFControl import STEPCAFControl_Reader
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.TDocStd import TDocStd_Document
    from OCP.XCAFApp import XCAFApp_Application
    from OCP.XCAFDoc import XCAFDoc_DocumentTool
    from OCP.TDF import TDF_LabelSequence, TDF_Label
    from OCP.IFSelect import IFSelect_ReturnStatus
    parts = []
    expected = {}
    for index in range(128):
        identity = f"00000000-0000-4000-8000-{index + 1:012d}"
        route_id = f"10000000-0000-4000-8000-{index % 2 + 1:012d}"
        route = {"id": route_id, "name": f"BC18{index % 2 + 2}", "purpose": "Route purpose"}
        name = route["name"] + " / " + identity
        purpose = "Cable's трасета \\ literal 😀" if index % 2 == 0 else "Control – управление"
        metadata = {"instanceId": identity, "name": name, "actualLengthMm": 20,
                    "widthMm": 300, "heightMm": None, "partNumber": "KL 60.303 F",
                    "manufacturer": "Niedax 'Demo'", "purpose": purpose,
                    "componentKind": "straight", "cadAssetId": None, "cadRevision": 3}
        parts.append({"name": name, "sourceId": source_id, "positionMm": [index * 200, 0, 0],
                      "rotation": [0, 0, 0, 1], "metadata": metadata, "route": route})
        expected[identity] = metadata
    result = assemble_step({"sources": [{"id": source_id, "stepBase64": encoded}], "parts": parts})
    path = os.path.join(work, "metadata-128.step")
    with open(path, "wb") as stream:
        stream.write(result)
    assert len(result) < 32 * 1024 * 1024
    assert result.count(b"MANIFOLD_SOLID_BREP(") == 1, "Repeated sections lost geometry sharing"
    assert b"GENERAL_PROPERTY_ASSOCIATION" in result and b"LENGTH_MEASURE" in result
    assert b"\\X2\\" in result and b"SI_UNIT(.MILLI.,.METRE.)" in result
    assert len(cq.importers.importStep(path).solids().vals()) == 128
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    reader.SetMetaMode(True)
    assert reader.ReadFile(path) == IFSelect_ReturnStatus.IFSelect_RetDone
    document = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
    XCAFApp_Application.GetApplication_s().InitDocument(document)
    assert reader.Transfer(document)
    tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
    roots = TDF_LabelSequence()
    tool.GetFreeShapes(roots)
    found = {}

    def read(label, depth):
        data = tool.GetNamedProperties(label, False)
        if data is not None and data.HasString(TCollection_ExtendedString("InstanceId")):
            def string(key):
                value = data.GetString(TCollection_ExtendedString(key)).ToExtString()
                # OCCT 7.9 fillAttributes uses SetString(char*) rather than UTF8
                # decoding. Normalize that reader defect, never the STEP values.
                try:
                    return value.encode("latin1").decode("utf8")
                except (UnicodeEncodeError, UnicodeDecodeError):
                    return value
            identity = string("InstanceId")
            assert depth == 2 and identity not in found
            wanted = expected[identity]
            for key, value in {"Name": wanted["name"], "Purpose": wanted["purpose"],
                               "PartNumber": wanted["partNumber"], "Manufacturer": wanted["manufacturer"],
                               "HeightMm": "unknown", "CadRevision": "3"}.items():
                assert string(key) == value, (identity, key, string(key), value)
            assert data.GetReal(TCollection_ExtendedString("ActualLengthMm")) == 20
            assert data.GetReal(TCollection_ExtendedString("WidthMm")) == 300
            found[identity] = string("RouteId")
        children = TDF_LabelSequence()
        tool.GetComponents_s(label, children)
        for i in range(1, children.Length() + 1):
            reference = TDF_Label()
            assert tool.GetReferredShape_s(children.Value(i), reference)
            read(reference, depth + 1)
    for i in range(1, roots.Length() + 1):
        read(roots.Value(i), 0)
    assert len(found) == 128 and len(set(found.values())) == 2
    # Validation must reject identity collisions and inconsistent route details.
    for bad in [parts[:1] + [parts[0]],
                [parts[0], {**parts[2], "route": {**parts[2]["route"], "purpose": "different"}}],
                [{**parts[0], "metadata": {**parts[0]["metadata"], "widthMm": -1}}]]:
        try:
            assemble_step({"sources": [{"id": source_id, "stepBase64": encoded}], "parts": bad})
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid section metadata accepted")
    return {"sections": len(found), "routes": 2, "sharedGeometryDefinitions": 1,
            "outputBytes": len(result), "nativePropertiesReadback": True, "unicodeAndQuotes": True}


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
        # Exercise the assembly count boundary with generated, non-proprietary
        # solids inside the unchanged input/output/memory budgets.
        source_id = hashlib.sha256(original).hexdigest()
        boundary_parts = [{"name": f"box-{index + 1}", "sourceId": source_id,
                           "positionMm": [index * 200, 0, 0], "rotation": [0, 0, 0, 1]}
                          for index in range(128)]
        assert len(original) <= converter.MAX_INPUT_BYTES
        boundary_request = {"sources": [{"id": source_id, "stepBase64": encoded}],
                            "parts": boundary_parts}
        boundary_result = assemble_step(boundary_request)
        boundary_path = os.path.join(work, "assembly-128.step")
        with open(boundary_path, "wb") as stream:
            stream.write(boundary_result)
        boundary_solids = cq.importers.importStep(boundary_path).solids().vals()
        assert len(boundary_solids) == 128
        assert abs(sum(s.Volume() for s in boundary_solids) - 128 * 100 * 50 * 20) < 0.001
        assert abs(max(s.BoundingBox().xmax for s in boundary_solids) - (127 * 200 + 50)) < 0.001
        try:
            assemble_step({**boundary_request, "parts": boundary_parts + [boundary_parts[0]]})
        except ValueError as error:
            assert "128" in str(error)
        else:
            raise AssertionError("129 assembly parts were accepted")
        cut_report = check_cut_stock(work)
        metadata_report = check_section_metadata(work, encoded, source_id)
        print(json.dumps({
            "status": "PASS", "sourceSolids": 1,
            "meshTriangles": mesh["triangleCount"],
            "exportedSolids": len(solids), "bytes": len(result),
            "straightCut": cut_report,
            "sectionMetadata": metadata_report,
            "assemblyPartLimit": {"accepted": 128, "rejected": 129,
                                  "readbackSolids": len(boundary_solids),
                                  "uniqueSourceBytes": len(original),
                                  "outputBytes": len(boundary_result)},
        }))


if __name__ == "__main__":
    main()
