# Manual review and project routing settings — user decision, 18 October 2026

This document supersedes the earlier **required native-oracle prerequisite** for
continuing the local implementation and applying reviewed real-model results.
Historical native launch failures, comparison gaps and previous receipts remain
unchanged. They are not relabelled as passing tests.

The user confirmed:
- No Navisworks licence is available.
- Aalborg_ACS_CABLETRAY_30_03_26.nwd is the intended source model.
- The user will manually check application-generated routes and lengths.
- Navisworks reference results are not required for this chosen acceptance path.
- All design allowances come from Project Details: Secondary tray length,
  Additional % for bending and For end connection.
- Connection gap must be a separate card in Details, **default1m**.
The source-model confirmation is a user declaration, not a new cryptographic
native/converted pairing proof.

## Isolation and inspected baseline

Worktree C:/Users/todor.chankov/source/WFC-pathfinder-local.
New branch pf-manual-validation-settings-20261018 inherits
5485283eda397616ca99f9d41982d2ecd65dc36d. Starting tracked tree is clean; only
the two previously denied temporary children remain untracked. Preserve them.
Original WFC, canonical/old dirty PathFinder, synced sources/, original app,
containers, databases/storage/volumes remain reference-only. No push, PR,
merge or deployment is authorized.

## Connection gap contract

Project response field: connectionGap, a finite number in metres, >0 and <=100.
SQL connection_gap is NOT NULL DEFAULT1; first migration gives existing projects
the explicitly requested1m, without resetting later saved values on restart.
Project create/update validates the same domain. Details uses a separate card,
existing project-edit permissions, and sufficient precision to retain0.25m
rather than rounding to0.3. The PathFinder tab/operations remain strictly admin.

The server resolves the stored value into options.connectionToleranceMeters
for automatic calculations, explicit calculations, ordered lookup and stale
dependency checks. A request/old saved options value cannot override it.
Changing gap invalidates old results and changes the geometry fingerprint;
a fresh route calculation is required. Reusing fitted mesh is permitted.
Changing only the three design allowances can reuse successful geometry.

Connection gap means the maximum accepted measured cross-tray clearance, with
centreline fallback where mesh evidence is unavailable. It is **not** a design
allowance. Actual centreline connector length is already inside geometric
length; reported surface gap totals must not be added again.

## Formula and remaining algorithm controls

The existing Automatic cable length calculation card keeps the distinguishable
legacy tray-list estimate and shows the actual PathFinder formula/current values:

base = max(0, geometric length - actual approaches flagged SECONDARY)
       + flagged endpoint count * Details.Secondary tray length
       + Details.For end connection
design = ceiling(base * (1 + Details.Additional % for bending /100))

The original guard rejects approaches exceeding geometry beyond numerical
tolerance; the nonnegative clamp handles only that permitted rounding residue.
Reserve is added once before the percentage. Missing required SECONDARY values
are not inferred. Preserve C# arithmetic, exact decimal casts and rounding.
Connection gap does not appear as another additive term.

Existing SECONDARY trigger distance2m remains unchanged: an approach strictly
above it is flagged for replacement. Vertical approach policy/resource ceilings/
compatibility sample spacing remain unchanged. No extra project cards are
introduced speculatively. Eleven pinned pure Core files stay byte-identical.

## Manual result review policy

Use the **existing** strict-admin per-proposal Confirm review and separate Apply.
No blanket model-acceptance checkbox or caller-provided engineeringAccepted flag
is introduced. The actual reviewed proposal hash, actor, time and dependency
identity remain authoritative. Real proposal engineeringAccepted stays false;
acceptanceScope manual-review accurately records this chosen validation method.
Synthetic fixture scope remains distinct.

Eligibility still requires successful current results/design, complete job,
compatible untruncated route, unchanged model/artifact/locations/settings/cable
write revision, current admin/login through commit, and an immutable current
review for that exact proposal/actor before Apply. Apply remains atomic for
routing/design/history/receipt, idempotent and preserves installLength.

Manual review is pending until the human performs it. Native parity is
NOT_PERFORMED / NOT_REQUIRED_BY_USER for this chosen acceptance path, never PASS.
Actual geometry integrity/finite data/category/visibility and safety budgets
still apply. Full-plant capture/capacity and reusable graph preparation remain
separate implementation/verification work, not claimed complete by this change.

## Delivery requirements

Verify project persistence/default1m/nonfinite/zero/negative/oversize rejection,
server-owned tolerance against conflicting requests, route recomputation after
gap changes, allowance-only design reuse, stale/revoked/cross-project refusals,
manual real-result review/Apply/idempotency/history/install preservation, and
existing regressions. Test only own copied/synthetic data/resources.

Rebuild/restart only the isolated5190 candidate after coordinated source freeze.
Use computer-use to inspect the new Details card/formula, saved value after
reload and manual review flow. Preserve Ghost/original tray colors/yellow path/
Clear. Record exact source/image/receipt identities and honest limitations.
Keep the demo and verified replacement backup; clean proven own superseded
payloads/images/extra fixtures with no global prune or denied-child retry.
