# GVL244 automatic equipment-centre fallback

## Goal and accepted decisions

The user confirms 15-P3820 is above the floor. Its matched equipment object is correct; its approximate bottom-AABB centre is an unsuitable cable endpoint. The user explicitly accepts an automatic fallback to the centre of the same equipment bounds only after successful full-route verification with all active barriers. Preserve the equipment and immutable original assignment; do not move the physical pump or substitute a fake electrical connector.

Baseline: local `work/endpoint-stall10`, branch `fix/barrier-frame-recovery-20261112`, HEAD `cf7c64d3845aa42276c10743b62a146b5f3ce77d`, with substantial prior uncommitted work. Local-only delivery on 5181; no production changes, commits or remote writes. Remote status has not been freshly inspected and establishes no acceptance claim. Keep the completed routing-control stages and prior GVL244 repairs.

15-P3820 saved match: SDK105296 ACPPEQUIPMENT, bounds minimum `[10.699998219775821,82.0199999010227,7.980000212564879]`, maximum `[11.099998219775822,83.0499999010227,8.58000021256488]`. Bottom centre is 20 mm below the registered floor top; bounds centre is `[10.89999821977582,82.5349999010227,8.28000021256488]`. An isolated native preview with all original148 barriers calculates `/C001/C002/C003/BC018/BC019/BC069/SECONDARY`, Design76m. This is diagnostic evidence, not an application write or measured connector.

Separately, the user confirms a real missing-model opening at C003 and removes the obstructing barrier themselves. Revision48 is actually published and no longer contains dbid176150. Supported scoped automatic job `da3e63a3-a585-4a0b-90b2-b27c42526c09` successfully writes WD3070MS-1=80m and WD7310MS-1=85m with the remaining barriers and drilling off. Do not remove further barriers or invent an opening.

## Implementation sequence

1. Preserve exact native occupancy results in diagnostics: FROM/TO/BOTH_ENDPOINTS_IN_BARRIER only when exact existing queries establish the side(s). Retain generic refusal when the opposite side is indeterminate. No extra collision queries or changed physical policy, limits, opening logic or default tolerances.
2. Add source-accurate versioned centre-fallback derivation/evidence for persisted current automatically matched bottom heads. Preserve the original match, source object identity, bounds, old head/hash and current model/frame proof. Never treat manual/picked/RIO fixed points as automatic candidates.
3. On a definitive side-specific endpoint refusal, require every blocked side to be eligible. Run one complete bounded native trial using those equipment centres; preserve all other inputs and healthy endpoints. Require successful strategy, registered-barrier proof, purpose and length-ledger validation. Failed, indeterminate, stale, drilling or resource-limited trials change no assignments.
4. In a short authorized transaction, compare current job/authority, exact old heads, full dependencies, model/frame/engine/barrier/capacity inputs. Atomically append the assignment(s) and a durable idempotent trial-proof receipt. Do not fabricate a human principal, extend a grant or weaken operation permissions.
5. Preserve the original failed proposal. Never publish a successful trial against the original bottom-point dependencies. Use the ordinary location-impact generation and fresh immutable admission for all cables sharing the changed location, then the normal automatic writer for Routing/Design. Keep manual/execution protection.
6. Adapt source display, DTO/schema, same-model reuse and cross-model handling so saved centres keep the correct source and cannot silently revert to bottom. Unsupported migration remains explicit and fail-closed.

## Verification and completion

- Test From-only, To-only and both blocked, manual/RIO exclusion, uncertain opposite side, failed trial, barrier/model/head/authority races, cancellation, duplicate/lost acknowledgement, preserved immutable history and shared-location invalidation.
- Test exact centre derivation and original-source chain; display and schema tampering; reuse/model change without silent bottom reversion.
- Run relevant native suites plus client/server types and focused server/shared/UI tests. Historical534 native checks are baseline evidence, not a pass for this change.
- Rebuild/deploy only isolated5181 after source freezes. Run real automatic WD3820 admission with its existing bottom head; verify centre is saved only following successful trial and a fresh normal result writes Routing/Design76m. Verify other cables sharing15-P3820, persistence after restart/read, no manual/RIO source changes, unchanged1223 project cable IDs and original80 protected pairs.
- Use the in-app browser to verify current assignment, Show and saved Routing/length. Record exact proofs/receipts/images and failures. Do not declare completion from the isolated preview alone.

Parent owns native diagnostics, reports, deployment and live application/browser acceptance. The implementation worker owns the server/shared fallback feature and necessary source/display boundaries. Preserve concurrent edits and coordinate any shared-file expansion.
