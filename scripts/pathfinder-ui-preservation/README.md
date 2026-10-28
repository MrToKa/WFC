This is a fresh PF-8 investigation of UI data preservation. It does not recover or relabel the earlier lost post-UI observation, whose status remains `FAIL_NOT_RETAINED`.

The tools only accept a verified extra target on port5191 restored from backup `3db9fa33-c10e-4646-82bc-fe99f3d8af35`. Use the existing isolated runtime helpers with an explicit new runtime path. Never omit that path or operate on the primary5190 runtime. Application source and the existing runtime helpers are outside this delivery's editing scope.

`capture.mjs` executes the exact ordered12 workflow queries from `server/pathfinder/lookupAudit.ts` in one repeatable-read read-only transaction. Full rows remain under a new ignored owner-marked scratch directory with private file permissions. Public evidence contains counts, hashes, changed column names and causal checks. Job actor/login identifiers are replaced with SHA256 fingerprints; authentication records, secrets and tokens are not exported. Raw captures and full row diffs are exclusively written, synced and read back before classification. Capture/quiescence failures retain their evidence and never retire resources.

Run from the isolated checkout, using absolute paths for the runtime/evidence files:

```text
node --test scripts/pathfinder-ui-preservation/lib.test.mjs
node scripts/pathfinder-ui-preservation/capture.mjs --runtime <new5191runtime> --phase A0 --evidence-root <newScratchEvidenceDirectory>
```

Do not log in before A0. Parent computer-use then opens the ordinary Path Finder UI in an owned browser tab, without reload/remount between later boundaries. After the automatic calculation completes, wait for quiescence and capture A1:

```text
node scripts/pathfinder-ui-preservation/quiesce.mjs --runtime <new5191runtime> --evidence-root <evidenceDirectory>
node scripts/pathfinder-ui-preservation/capture.mjs --runtime <new5191runtime> --phase A1 --evidence-root <evidenceDirectory> --baseline <A0.private.json> --previous <A0.private.json>
```

Quiescence is bounded to90seconds and requires observed unchanged workflow/job/result hashes with no queued/running jobs or waiting/running items across at least16.5seconds, exceeding the worker's15second automatic scan cadence. This is an observation window, not a guarantee of perpetual inactivity. Parent also confirms that the UI is idle.

Next parent performs exactly one ordinary standalone Path calculation for the real copied QA network, From `=PF-DEMO-NETWORK-START`, To `=PF-DEMO-NETWORK-END`, category Control. No Review, Apply, Reverse, capture/import, settings/location/cable edits or fixtures. After completion capture A2 using A0 as baseline and A1 as previous. Parent then clicks Clear and captures A3 using A0 as baseline and A2 as previous. A sidecar receipt, raw SHA256, exact target/image/module binding and chronological phase order are required for every supplied capture.

The gates distinguish accepted behavior precisely:

- A0→A1: exactly one new automatic calculate job, an item and a new immutable proposal for each existing project cable. Current authority, frozen model/artifact/Details, shared bindings, options, complete cable scope and stored hashes must agree.
- A1→A2: exactly one preview job and one `pf_lookup_results` row; no new cable items/proposals. Its recorded input, current dependencies and known selected-network metrics must agree.
- A2→A3: no persisted workflow or auxiliary changes.
- Existing proposal/result rows, all cable values/write revisions, settings, selection, registry, locations, aliases, bindings, model data, matching events, Review and Apply remain unchanged.

Known selected-network metrics are geometric35.30345579516123m, design45m,4gaps totaling0.9840583861033791m. These do not prove whole-plant coverage or native engineering acceptance.

Never retire a target after an unexplained difference. Retain its evidence and target for read-only diagnosis. `retire.mjs` requires all four unique PASS capture sidecars, reverified raw/diff bytes, and a separate durable parent disposition JSON containing `decision: "retire-owned-target"` and the exact `targetOwner`. It has no automatic or finally cleanup path. After explicit disposition:

```text
node scripts/pathfinder-ui-preservation/retire.mjs --runtime <new5191runtime> --evidence-root <evidenceDirectory> --disposition <parentDisposition.json>
```

No global Docker prune, primary backup/restart, original application writes or deletion of the seven denied scratch children is authorized by these tools.

An additive caption check covers the reproduced stale message after Clear. Original A0–A3 records retain their original web image identity. The separate `caption-check.mjs` saves C0 against A3 before rebuilding only the owned target's web service, then C1 after parent repeats exactly one ordinary Path calculation/Clear with the same browser login. It explicitly permits the expected new web image while requiring the API container/image and compiled production modules to remain identical. C0 requires zero changes; C1 permits one new completed preview job/result, with no new proposal/item or protected business changes. Completed previews are not deduplicated; automatic cable calculations are deduplicated within the retained login. Run the5 focused `caption-lib.test.mjs` controls separately. C1 and the visual caption result require parent acceptance before the final retirement disposition.
