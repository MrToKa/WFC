# Recover the selected Save result after background write contention

The 27 October report was a successful calculation followed by failed display
metadata reads. It was not an absent route or a geometry failure.

## Recorded incident

The endpoint Save was accepted at 07:19:03 UTC. The selected Aalborg cable
`=H1=KF1=TAC1=WGA1` was calculated and automatically written at
07:19:25.839. Its 13-cable background job completed at 07:19:36.938.
Proposal reads succeeded at 07:19:29, 31 and 34, while the separate live
`cable-workflow` reads received HTTP 503. PostgreSQL recorded lock timeouts
and serialization failures. After the third display verification attempt,
the browser stopped reading until the user's later manual Calculate.

The retained result has 174 path points, 31 segment IDs and a 58 m design
length. Both endpoint display contexts are confirmed. A SELECT-only replay
verified both the Save proposal and the later manual proposal. Restoring each
proposal's recorded cable write revision reproduces its complete dependency
hash; no other model, endpoint, barrier, engine or settings difference exists.
The later manual calculation supersedes the earlier receipt, so this replay
does not grant historical currentness to the earlier result.

`cableWorkflowRead.ts` uses a repeatable-read transaction and the same project
row lock as authenticated Path Finder writers. Its one-second lock timeout
and serialization conflicts are translated into `WORKFLOW_DATABASE_BUSY`.
The previous display retry schedule, 500 ms followed by 1500 ms, exhausted
before the remaining background writes released that lock.

Evidence:

- `D:/Codex-test-output/save-show-20261027/read-only-log-timeline.json`
- `D:/Codex-test-output/show-save-20261027/backend/backend-summary.json`

The integrated-browser origin check again refused access to
`http://127.0.0.1:5191` because of a saved permission or managed policy.
No alternate browser or indirect browser access was used. Component tests,
stored-data replay and installed-file checks must not be described as an
interactive browser reproduction.

## Recovery boundary

The selected display reader must keep retrying temporary metadata failures
within a finite window, without submitting another calculation. It must
publish Show as soon as the exact route passes the existing checks, without
waiting for the whole background job. Optional endpoint highlighting remains
independent of that route check and enriches the same checked display payload.

Retries retain the exact account, login, project, cable, model, preparation,
job and proposal ownership. Authority refusals, incompatible geometry and
permanent validation failures do not become display permission. Exhaustion
must produce a final diagnostic in the popup, rather than an indefinitely
retained "Loading" message. Save, Review, Apply and calculation submission
remain separate actions.

No backend lock, transaction isolation or proof requirement is relaxed.

The selected reader now has at most seven verification attempts with delays
of 500, 1500, 3000, 5000, 5000 and 5000 ms, and a separate 30-second overall
deadline that aborts an in-flight read. The deadline is cleared immediately
when the route becomes drawable; a slower optional endpoint lookup cannot
retract that route. Temporary successful-but-incomplete metadata can also be
read again within this window, while genuinely changed dependencies, invalid
geometry and incompatible results remain blocked.

The main page carries the selected check's current or final message into the
popup under the exact job/proposal identity. It no longer retains the Save
watcher's "calculation finished... Loading" text after that check has stopped.

## Validation

The causal Save/Show test fails against the previous reader after three
consecutive HTTP 503 responses. With the change, the fourth GET enables Show
and supplies the route plus both endpoint objects, with one Save and no new
calculation, Review or Apply. Separate tests cover successful incomplete
metadata, exhausted attempts, an in-flight 30-second deadline, scope changes,
and authority refusal during retry backoff. A late endpoint authority refusal
immediately retires the owned check rather than being lost between attempts.

All 499 cases in the five affected frontend suites pass. TypeScript, scoped
ESLint and whitespace checks pass. Independent review verifies the seven
changed source/test files and the build freeze. Only Results, Workspace and
the main tab's display-message comparator change in production code.

Validation and causal RED/GREEN logs are retained in
`D:/Codex-test-output/save-show-20261027/frontend/`. The 19 previous discovery
source pins remain unchanged. This validation does not claim an interactive
browser test.

## Installed verification

Port 5191 now serves WEB image
`sha256:1842267810fc52ecc45a337b5342fc71defd5051c380fa751351aa06924c4ab9`,
operation `15f66b24-60cb-444b-aa53-8c15e78a24dc`. The API remains
`sha256:fe856418062c8814286b9fc7ed7bb899982b8a418adc20ae5346d9dc71dc65f0`.
Only the WEB container was replaced. API, PostgreSQL, MinIO, the recovered
Preparer and both 5180 containers retain their processes and configurations.

The initial installer correctly stopped its acceptance check on a metadata
difference after the new WEB became healthy. Its failed receipt is retained.
The captured full before/after configurations prove exactly four differences:
the generated Compose dependency label becomes empty under `up --no-deps`,
and three empty DNS arrays are represented as null. A separate read-only
reconciliation accepts only those exact representations, verifies the current
Compose still requires a healthy API and declares no custom DNS, and checks
all remaining effective configuration fields unchanged. No second deployment
or other service control was performed.

That reconciliation verifies the actual served bytes and headers of all 240
qualified static files, including the 28 unchanged runtime files and 206 SDK
files. A separate root check rechecks 26 source pins, the 33 non-SDK served
files, all six preserved services and HTTP 200 on 5191, 5193 and 5180.
The full private before-state and rollback image are retained. Evidence is
`web-delivery/reconciliation.pass.json` and `root-postcheck.json` in the stage
directory. Close the old popup and reload the main page once to load the new
frontend; no recalculation is required just to install this update.

## Separate service recovery

Docker restarted at 07:09 UTC. The existing Preparer container was refusing
startup with `LOCK_BUSY` because its workspace owner belonged to the prior
Docker VM boot. The exact old owner was backed up, checked against the prior
and current boot identities, and released while its sole owning container
was stopped. That same container and image then started successfully.

All five workspace files were conserved except the renewed owner record;
authentication files and the empty journal retained their exact contents.
The other six containers retained their IDs, images, processes and
configurations. Evidence is in
`D:/Codex-test-output/save-show-20261027/preparer/recovery.pass.json` and
`postcheck.json`. No model, endpoint, cable or calculation write was submitted
by this recovery.
