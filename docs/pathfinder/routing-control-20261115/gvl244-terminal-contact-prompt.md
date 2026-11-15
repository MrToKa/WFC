# GVL244: terminal floor-surface contact and incomplete candidate search

Continue the authorized local routing audit, not a new production deployment. Project `da667921-1f13-4c1d-9f87-063d127b98ce`, localhost 5181. Original 5180 remains untouched. User explicitly confirmed that all RIO cabinets share the RIO1 exit point because modeled trays are absent there; all 12 RIO locations are now current fixed-world points, with newly assigned RIO7/9. Exact shared point and all API receipts are retained in `gvl244-rio-common-gateway.json`.

## Actual completed gate

Full job `071c6f09-1773-4933-aac5-b20c56a50af6`, generation 2335, admitted 271 cables and rejected 952 missing-input cables. Completed on 2026-11-15 around 12:05 UTC: 259 calculated, 179 automatic results saved, 80 protected manual routes retained, zero saved-value mismatches. Twelve remain without a successful current result. The producer was paused through its normal authenticated command after completion, before changing the implementation. Preserve those successful records and all original 80 business pairs.

Eleven failures report endpoint-in-material: -WD3025MS-1, -WD3070MS-1, -WD3120MS-1, -WD3470MS-1, -WD3820MS-1, -WD4005MS-1, -WD4220MS-1, -WD5075MS-1, -WD5170MS-1, -WD5815MS-1 and -WD5870MS-1. One further case, -WD7310MS-1, reaches `CANDIDATE_PAIR_LIMIT`; do not misreport that as proof that no route exists.

## Proven geometry and required correction

For -WD3470MS-1, the To anchor is exactly on the bottom face of a 30 mm registered floor, dbid:24024/fragment182/triangle50/component000015. For -WD5870MS-1 it is on the top face of dbid:24026/fragment180/triangle46/component000013, at 1.83e-15 m distance. RIO1 is clear of those surfaces. These are real captured triangle surfaces and qualified closed components, not bounding-box proxies or a registration error.

The existing policy rejects every original surface contact, including valid terminal contact. Add a narrowly scoped route-segment test bound to the actual request From/To. Allow only endpoint surface contact with exterior approach/departure and full route proof; retain strict default collision behavior everywhere else. Reject true interior points, crossing between opposite slab faces, inward approaches, coplanar contact spans and contacts at graph nodes. Keep oracle, final proof and verifier semantics aligned. Do not move points, remove barriers, enable drilling, widen tolerance indiscriminately or invent an opening.

Use immutable real corpora in `D:/WFC-Test/validation/gvl244-terminal-contact-20261115/`, verified against copied-file SHA-256 and byte counts. Reproduce with fresh compiled native execution. Cover both top/bottom outward directions, inside/opposite-face/coplanar/near-interior cases, strict defaults and verification binding. Replay all available failing real requests, then inspect the separate candidate-budget failure. Any budget extension must be bounded, justified by actual trace and tested; do not claim an incomplete search is a physical obstruction.

## Integration gate

One native writer owns necessary kernel/runner/verifier files; other agents review/read only. Freeze runtime source after meaningful regressions and real-corpus results pass. DLL hashes change calculation identity: rebuild isolated API, create fresh admissions using the new implementation and active barrier revision 47 with drilling false. Do not copy an old successful result into a current result or rewrite its identity. Re-run the full current ready scope, drain automatic writes, and compare actual Cable list values/receipts. Inspect the requested in-app browser and finish with exact counts and any genuinely unresolved inputs.
