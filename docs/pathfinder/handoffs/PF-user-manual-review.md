# Next step — human review of the isolated PathFinder demonstration

This handoff follows the user's revised18October2026 acceptance decision.
The technical project-gap/manual-review revision is described in
[the report](../21-manual-review-settings-report.md). Read its final status and
actual receipts before treating it as delivered. Preparing this handoff does
not declare human acceptance or authorize main integration.

## Baseline and boundaries

- Work only in `C:/Users/todor.chankov/source/WFC-pathfinder-local`, branch
  `pf-manual-validation-settings-20261018`. Production checkpoint
  `feac4eb8b85f38ef4f9a0ec6f53845e8df2bb033` inherits873afeb and5485283.
  Test-only baseline correction checkpoint
  `cfdcd3f5974636737ff34acec0fc3de391d35ab1` follows it; its failed and corrected
  live results are distinguished in the report. Later documentation/evidence commits may follow; inspect live branch/HEAD,
  status and agents before further work. Preserve concurrent/uncommitted work.
  Scoped technical delivery/evidence is committed in
  `961d24ff0f8e6cbbe9a77807d631aa0b3d7f00ef`; the heartbeat is PAUSED while the
  actual human review is pending. Its tool/readback receipt is
  [automation-paused.json](../evidence/manual-settings/automation-paused.json).
- Original WFC main and observed live GitHub main are
  `e1ef20202598bb4d3d78e4772cbbb9747ec23a00`; canonical PathFinder local/live
  master is `45c24bf5f433f13e102600b36f20327c77961d0a`. Observations are dated
  in [the remote observation](../evidence/manual-settings/remote-baseline-20261018T0650Z.json).
  The feature branch is unpublished, so remote CI does not verify it.
- Original WFC, canonical and dirty older PathFinder, synced sources/ and all
  original containers/data remain read-only. No push, PR, merge, deployment or
  original-installation update is authorized. Do not repeat licence failures.
- Retain own5190 installation and its verified combined backup/private companion.
  Exact current image/backup IDs and preservation evidence are in the final
  report. Historical denied cleanup children remain untouched.

## User review

The user is the engineering reviewer. Do not confirm their acceptance on their
behalf or run another loop that only rechecks unchanged completed evidence.
The default Connection gap is explicitly1m. The three design allowances must
come from Project Details. Instrumentation follows Control. Native comparison
is NOT_PERFORMED / NOT_REQUIRED_BY_USER, never PASS.

1. Open `http://127.0.0.1:5190/projects/105913f0-7ee4-45f2-bfd8-2c01f9be9f2a?tab=pathfinder`
   as the isolated demo administrator. Credentials are private and excluded
   from Git; the [guide](../08-local-user-guide.md) identifies their local file.
2. Open the current ready **PF-MANUAL-DEMO** proposal. Its endpoint names are
   QA aliases at actual converted-network endpoints, not validated business
   equipment identities. The selected capture has52objects/26segments.
3. Review the exact yellow path, original tray colors/filled Ghost, both points,
   connections and ordered route codes. Settings for this example are gap1m,
   SECONDARY3m, end reserve5m and bending10%. The recorded result is
   geometry35.30345579516123m and design45m. Both approaches are0m, so this
   example does not demonstrate SECONDARY replacement; separate tests do.
4. The actual demo is left without Apply. If the user accepts this exact result,
   they can use Confirm proposal review and separate Apply reviewed result.
   The server stores routing/design together and preserves installLength.
   Input/model/location/cable changes require a current calculation and review.
5. Record specific accepted or incorrect routes/endpoints/lengths. Preserve
   exact project/model/artifact/settings/cable/proposal identities for any issue;
   do not substitute rounded screenshots for complete numeric evidence.

## Subsequent implementation after feedback

Keep this manual-review path separate from the remaining scale/geometry work.
Whole-plant capture/category completeness and representative capacity are not
proved by this selected-network example. Reusable graph preparation is not
implemented; the unchanged core builds its endpoint-dependent graph per query.
See [the graph review](../19-graph-preparation-review.md). Do not duplicate or
silently refactor the pinned algorithm to claim graph reuse. Continue authorized
independent work from measured evidence and accepted semantics; do not relabel
these limitations as complete merely because the settings revision passed.

After a correction, run affected checks in isolated resources, bind results to
actual source/images, update the report/progress and make a local commit without
secrets. Use prepare-stage-handoff for the next concrete stage and execute it
when it is implementation work already authorized by the user. Stop automatic
repetition while actual human review is the next required input. Integration
into main or the existing installation requires the user's separate decision.
