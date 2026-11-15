# GVL244 terminal floor contact — native implementation

## Bounded contact change

`PathFinder.Barriers/TerminalSurfaceContact.cs` adds a route-terminal contact predicate used only by the new `CheckRouteSegment` overloads in the closed and mixed kernels. Existing `CheckSegment` remains strict, including surface contact. The runner binds the allowed numerical terminal coordinates to the actual request From/To; there is no new client-supplied exception field. The pure original-triangle contact foundation is unchanged.

The predicate requires an exact bounded dyadic point-on-original-triangle certificate. The binary64 incidence guard associates the computed contact witness with that already-certified terminal; it cannot promote a point merely near the surface. A point one ULP inside material remains blocked. Nonzero coplanar contact remains blocked. Boundary status is per solid, and an open-segment midpoint is checked when a terminal meets that solid, so two actual terminals on opposite faces of the same 30 mm floor do not bypass its material. All other triangle contacts and containment checks remain. Original work/query/time budgets and drilling policy are retained.

The new successful mixed observation reason is `CLEAR_EXCEPT_ACTUAL_TERMINAL_BOUNDARY_CONTACT`. DLL hashes change normally; historical engine identity/proof is not reused as a current result. No barrier, source point, persisted cable or database was changed by this native subtask.

## Verification

Evidence directory: `D:/WFC-Test/validation/gvl244-terminal-contact-20261115/`.

Final contact gate: **534 passing checks in ten native suites**: 26 new terminal checks, 94 strict closed-kernel, 75 mixed-kernel, 16 exact-surface, 39 closed runner transport, 85 mixed runner transport, 50 capture verifier, 72 constrained routing, 51 local connectors and 26 manual ordered-route checks. Runner transport invocations use the actual absolute `--runner` and a unique absent `--work-root`; initial invocations without required arguments returned before testing and are not counted. Build and scoped diff checks pass. An independent review caught a one-ULP interior issue in an early incidence-only draft; the exact predicate and three dedicated regressions resolve it. The early draft's positive near-boundary replays are superseded by final strict results.

The 26 new checks cover floor top/bottom approach and departure, zero-length occupancy deferred to actual directional proof, true interior, inward/through-floor/opposite-face cases, coplanar travel, unrelated/modified terminal coordinates, 1e-8 and one-ULP interior points, original open sheets, and a terminal on one solid that remains inside a different solid.

## Exact original project corpus

The read-only audit copied all immutable inputs and verified their hashes. Under the strict final implementation, five original requests calculate with all 148 original floor barriers and proof present, drilling false:

| Cable | Native Design, m |
| --- | ---: |
| -WD3025MS-1 | 64 |
| -WD3120MS-1 | 67 |
| -WD3470MS-1 | 68 |
| -WD4005MS-1 | 114 |
| -WD4220MS-1 | 67 |

At that replay checkpoint, five other saved bottom-AABB anchors are microscopically inside the original floor face in binary64, not exactly on it; the exact predicate is deliberately not weakened. The **approximate assigned endpoint** of -WD3820MS-1 is genuinely inside the floor (10mm above its bottom,20mm below its top); this is not evidence that the actual pump body lies inside the floor. -WD7310MS-1 is independent of endpoint contact and remains an incomplete `CANDIDATE_PAIR_LIMIT` result in that original148-barrier corpus. Later normal source repairs and the user's revision48 barrier removal are recorded in the GVL244 recalculation report.

## Explicit source-correction previews, not application writes

`NEWproposals-preview-inputs.json` records old points, exact captured triangle Z, equipment bounds, source binding/request hashes and proposed changes. Fresh request IDs and clearly named files in `source-correction-previews/` are diagnostic scenarios only; they do not replace production source bindings or constitute an application admission.

| Cable | Proposed correction | Fresh native preview |
| --- | --- | --- |
| -WD3070MS-1 | exact top face, +1.776e-15 m Z | still candidate-pair limit |
| -WD5075MS-1 | exact top face, +1.776e-15 m Z | calculated 70 m |
| -WD5170MS-1 | exact top face, +1.776e-15 m Z | calculated 71 m |
| -WD5815MS-1 | exact bottom face, -4.441e-16 m Z | calculated 49 m |
| -WD5870MS-1 | exact top face, +1.776e-15 m Z | calculated 59 m |
| -WD3820MS-1 | actual floor top, +20 mm Z | calculated 76 m |

The parent owns user approval, any supported source-assignment writes, deployment and fresh application admission. The 20 mm change is a real relocation, not a numerical epsilon.

## Separate bounded pair-search investigation

The parent separately authorized investigation of -WD7310MS-1 and the corrected-point -WD3070MS-1. Isolated instrumentation (removed from runtime source) recorded exact station keys and cached statuses. 7310 performs 112 plan lookups across 56 local pairs, 32 unique exact keys, with no projection/stored-station drift in that request. Seventeen lookups reference nine already-unavailable bounded plans.

A narrow cache-refusal skip was experimentally tested, but it did not solve either case and was reverted for minimal delivery. No pair-count semantics changed in production source. Isolated diagnostic-only probes permitted 128/256 pairs while retaining the other work/query/plan/time ceilings. They are explicitly nonadmissible under the historical 64-pair profile and were never deployed. 7310 still lacks a verified route after exhausting its retained 16×16 candidate domain (129 charged attempts after experimental pruning, work 4,097,436 of 20M). Corrected 3070 similarly exhausts that domain (114 attempts, work 2,652,448). Neither establishes a global physical no-path result. All diagnostic hooks and experimental cap overrides were removed.

Unchanged-barrier connectivity instrumentation resolves the immediate cause. Every tested clear endpoint-station pair is connected in the original tray graph (643 nodes). Exact barrier filtering separates the RIO-side component (592 nodes) from the upper 51 nodes. Both cases have the same single cut edge, **within `/C003`**, from `[6.499998219775819,65.84049990102272,15.374999968424259]` to `[6.499998219775819,65.84049990102272,19.300000212564882]`. The actual query witness is component `component:000141`, owner `dbid:176150`, fragment `194802`, reason `ORIGINAL_TRIANGLE_CONTACT`. The bounded inter-tray maneuver domain deliberately does not repair an edge inside one continuous tray. The original network is not globally disconnected; a registered obstacle cuts this riser. This calls for review of the actual obstacle/opening/tray geometry, rather than silently increasing pair caps or permitting material penetration.

These diagnostic queries added no collision calls and changed no application inputs. Evidence is in `pair-budget-diagnostics/*connectivity.log`, `*cut-summary.json` and the explicitly labeled probe results. Final production source contains only the contact change described above, with unchanged 64-pair limits; no environment-based diagnostic hook remains.

## Later endpoint-side diagnostics for approved centre fallback

The user approves trying the centre of automatically matched equipment when its bottom anchor is blocked, and retaining that point only after a complete active-barrier route succeeds. The server owns that source change; the native kernel gains no exemption or approximate clearance.

The two existing exact endpoint occupancy observations now distinguish `FROM_ENDPOINT_IN_BARRIER`, `TO_ENDPOINT_IN_BARRIER` and `BOTH_ENDPOINTS_IN_BARRIER`. A blocked endpoint with an indeterminate opposite endpoint retains generic `ENDPOINT_IN_BARRIER`, which does not authorize a fallback. No additional collision queries or changed budgets/physical predicates are introduced. Five automatic and five manual regressions exercise both sides, both blocked and the two mixed uncertainty cases through actual routing entry points.

New complete gate: **544 passing checks in the same ten native suites**, including local connectors56 and manual ordered31. Logs: `D:/WFC-Test/validation/routing-control-20261115/centre-PathFinder.*.log`; runner build `centre-native-build.log`. TerminalContact emits plain26/26 rather than JSON; all ten processes exit0. The first log-summary parser expected JSON for that plain-text suite and produced a reporting exception; its actual tests passed, and the other nine suites report PASS. Independent review confirms reason transport remains compatible with the bounded diagnostic-code schema.

An isolated equipment-centre preview for15-P3820 atZ8.28000021256488m calculates76m with all original148 barriers, within unchanged caps. Its files are `source-correction-previews/WD3820MS-1.EQUIPMENT-CENTRE-PREVIEW.*.json`; it does not establish a measured electrical connector and does not itself save an application assignment.
