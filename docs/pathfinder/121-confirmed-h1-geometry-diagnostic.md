# B26 — confirmed H1 geometry diagnostic

The packaged native calculation was repeated with the user's confirmed From
point `[51.2619021370831, -6.471190246329826, 4.04500007176938]`, the unchanged
To point and the same settings and original 28 Aalborg obstacles. This was an
offline test override. No saved endpoint or cable value was changed.

With drilling **Off**, the intrinsic calculation returned 116 points and a
43.80162051112078m polyline, with calculated design length 58m. An independent
checker examined every one of its 115 final segments, including approaches and
connections, against all 3,789 original triangles. It found zero exact triangle
contacts, zero ambiguous observations and no route points contained in the
independently closed obstacle components.

The returned routing is:

`/SECONDARY/BC020/BC030/BC030-1/BC175/C107-2/C107-1/C002/DFC003/DFC002/DFC001/DFBC002-1`

BC175 is present. The eleven tray codes follow the user's expected sequence in
reverse. The independent receipt's strict literal comparison remains false
because it preserves the extra `SECONDARY` marker; the user subsequently allowed
that marker. The expected route was diagnostic metadata and was not forced into
the calculation.

The final route has candidate crossings at both named walls:

| Original wall | Final segment, zero based | Independent observation |
| --- | --- | --- |
| VOLMODEL 581, dbId 168594, fragment 391 | 19 | Zero contacts with this wall and all 28 obstacles |
| VOLMODEL 2112, dbId 171737, fragment 851 | 75 | Zero contacts with this wall and all 28 obstacles |

These segments span both model-axis vertex-bound planes of their respective
walls. Those bounds locate the observations; they do not define wall material
or certify an aperture. The checker intentionally retains
`bothWallTraversalsCertified: false`. Separately, the exact original reference
endpoints at C002/C107-1 occur at final point indices 74–77, in reverse
orientation, with three actual legs and zero contacts against all 28 obstacles.
No Equipment 23 proxy, portal, geometry modification or obstacle exemption was
used.

With drilling **On**, the intrinsic calculation returned 144 points, a
50.875302159923784m polyline and design length 66m. Its production proof is
explicitly bypassed. The independent checker still examined all 143 segments
and found six triangle contacts, including two with wall 2112. These are triangle
contact observations, not a count of distinct penetrations.

The enclosing native driver remains **REFUSED**. Both individual native
processes had already exited successfully and their helpers were removed, but
the driver's final resource-conservation guard failed. A later read-only audit
authenticated those request, process, response, artifact and cleanup records.
Its observations found a changed start time for the already identified foreign
container; actor and cause remain unknown. The original failed-end resource
snapshot was not retained. Original whole-run conservation is therefore
**NOT_PROVEN**, and original final source bookends were **NOT_REACHED**. The
audit and independent geometry checker passed their own later input checks;
they do not replace the original refusal.

The diagnostic used the packaged engine identity
`b3157008f42eced7281f7b093e4b898f23fe244e808da5a605c324f57ac58090`.
The independently checked original coordinates, matrices, indices and
memberships were unchanged: 28 fragments, 4,790 vertices and 3,789 triangles.
The checker receipt is
`cb7978ae3a21ad1e11530ec044913d16d220b07f951a5d11ca7bad440da60c75`;
the intrinsic-record audit is
`5400a0c20f70c2f1200e504f49d54f46fcb4435d3aeff6cbc3da8a5c9c1bf0af`.

This establishes an independently checked offline polyline for the selected
obstacles. It does not establish live SDK capture, current Viewer/frame
authority, protected identity of the named From object, real Review/Apply or
engineering acceptance. Cable radius and near-distance clearance were not
checked. The user's 10cm coordinate corroboration tolerance was not used as a
collision tolerance. No project endpoint, routing or length was written.
