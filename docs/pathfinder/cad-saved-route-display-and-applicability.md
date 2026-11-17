# CAD saved-route display and automatic applicability

## Observed on the live project

On 2026-11-17, the authenticated embedded browser showed `-WG-3056` in project
`da667921-1f13-4c1d-9f87-063d127b98ce` with saved route
`/SECONDARY/BC027-2/BC027-1/BC025/BC026/SECONDARY`, length 46 m, and a calculated
proposal `/BC903/BC027-2/BC027-1/BC025/BC026/SECONDARY`, length 42 m. The supplied
Cable details screenshot showed no manual route and no installed length or pull
date. The automatic write reported `PROPOSAL_NOT_APPLICABLE`.

The inspected proposal `d8399cc8-ac6a-42d8-a506-8fea7e0414d4` reported
`LEGACY_PAIR_CLEAR`, one pair attempt, no candidate truncation and 271/271 final
barrier checks. Thus BC903 routing was working; the refusal was downstream of the
calculation. A subsequent single-cable retry did not confirm a write and the UI
reported changed context; no protection or endpoint was changed during diagnosis.

Saved-route Show reported BC027-2 and BC027-1 missing from the model and omitted
them from the preview. They were published CAD routes, outside the original SDK
model tree.

## Display correction

The protected routing-binding reader now supplies validated current CAD
centrelines alongside original-model root mappings. It reuses the calculation
reader's base/publication/catalog checks, including validated additive and retired
CAD handling. The protected frame validates bounded v2 geometry and uses it in the
ordered preview; parent messages cannot inject these paths. The existing v1
contract remains supported.

Show waits for current saved CAD meshes to synchronize. Native and mixed paths
use combined line bounds for initial framing and Zoom to path. Native-only views
ghost the original model and restore its visibility on Clear. Show remains a
display-only, approximate reconstruction of the saved route text; it neither
recalculates nor creates write authority.

## Automatic applicability correction

The applicability query previously charged the same dependency document twice:
item dependencies + proposal dependencies + result. The writer/proof readers
admitted one dependency document + result under the same 256 KiB limit. A valid
dense CAD proposal could therefore be calculated and displayed but refused for
automatic application.

The query now returns the dependency document once and requires a separately
bounded SQL equality check against the item copy. The 256 KiB dependency+result
limit, hashes, immutable seals, currentness, permissions and protection checks
remain in force.

A real PostgreSQL regression failed under the old query and passes with this
correction. Its valid CAD payload fits the single-document limit but exceeds the
old duplicated charge. Controls reject mismatched, NULL and oversized input.
The precise live proposal byte sizes were not exposed by the browser, so this is
a reproduced applicability defect consistent with the live refusal, not a claim
that the remote payload size was measured.

The live server must be updated before these changes affect it. A fresh
calculation can then attempt the normal automatic write for an unprotected cable;
historical refused write decisions are not rewritten.
