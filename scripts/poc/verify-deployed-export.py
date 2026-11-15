#!/usr/bin/env python3
"""Offline OCCT acceptance: compare exported solids against saved, pinned transforms."""
import json
import os
import sys

import cadquery as cq
from OCP.gp import gp_Quaternion, gp_Trsf, gp_Vec


def bounds(shape):
    box = shape.BoundingBox()
    return [box.xmin, box.ymin, box.zmin, box.xmax, box.ymax, box.zmax]


def main():
    directory = sys.argv[1]
    with open(os.path.join(directory, 'acceptance-manifest.json'), encoding='utf8') as stream:
        manifest = json.load(stream)
    actual = [bounds(solid) for solid in cq.importers.importStep(
        os.path.join(directory, 'Aalborg-Proposed-Cable-Trays.step')).solids().vals()]
    expected = []
    for placed in manifest['instances']:
        transform = gp_Trsf()
        transform.SetRotation(gp_Quaternion(placed['qx'], placed['qy'], placed['qz'], placed['qw']))
        transform.SetTranslationPart(gp_Vec(placed['xMm'], placed['yMm'], placed['zMm']))
        for solid in cq.importers.importStep(os.path.join(directory, placed['sourceFile'])).solids().vals():
            expected.append(bounds(solid.moved(cq.Location(transform))))
    assert len(actual) == len(expected) == 2
    unmatched = list(actual)
    for wanted in expected:
        match = next((box for box in unmatched if max(abs(a-b) for a, b in zip(box, wanted)) < 0.05), None)
        assert match is not None, 'Export bounds differ from saved manufacturer geometry and transform'
        unmatched.remove(match)
    print(json.dumps({'status': 'PASS', 'solids': len(actual), 'boundsToleranceMm': 0.05,
                      'designRevision': manifest['designRevision'], 'boundsMm': actual}))


if __name__ == '__main__':
    main()
