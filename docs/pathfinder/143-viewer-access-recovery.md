# Recover temporary viewer access checks

The user reported a disappearing model while the cable popup waited for the
calculation after saving a shared From assignment. The main page displayed
`Model access ended or the model changed. Refresh Path Finder to reload.`
This message is an application lifecycle error, not evidence of a GPU crash.

## Evidence and scope

The loaded viewer checks the selected model on a 30-second timer, when the
window receives focus, and before protected viewer operations. It renews its
five-minute session every three minutes. Before this change, either check
called `fail()` after any request failure, including a temporary server error,
network failure or the 15-second request deadline. `fail()` immediately hides
and retires the iframe. The generic page message obscured which check failed.

The installed logs around the incident contain temporary 503 responses from
location progress and calculation-context readers. PostgreSQL also recorded
project-row lock timeouts and concurrent-update failures. This confirms
contention at the time, but does not by itself identify the exact request
which triggered the viewer teardown. Progress retry exhaustion alone does
not unload the viewer; its authorization-loss callback is restricted to
401/403 responses.

A separate Docker Desktop restart occurred later. The four existing 5191
containers stopped together with exit code 255, no OOM flag, and unchanged
images. Their `restart: no` policy left them stopped. This is separate from
the earlier application-level disappearance.

## Recovery contract

Recovery is limited to current model-selection checks and renewal of the
same existing viewer session. Concurrent selection checks share one pending
request, without caching an authorization decision. Temporary failures get
at most two retries, after 250 and 750 milliseconds. The original session
expiry and absolute expiry bound all attempts and waits.

Authorization failures, model changes and malformed replies remain immediate
terminal failures. Logout, reload and disposal cancel pending recovery. Late
responses cannot restore an old session or a replaced model. Exhausted retries
still close the viewer. Creating a session, submitting a calculation, saving
engineering data and loading model resources are outside this retry policy.

The page distinguishes a failed access check, a failed renewal, revoked access
and a failed resource. It retains saved routing data while explaining why
the viewer stopped.

Evidence is kept under
`D:/Codex-test-output/viewer-access-recovery-20261026/`.

## Verification

The bounded installed-data investigation found that the old session was still
valid and unrevoked at the incident, with no active-model change. All 35 model
and session HTTP requests in the inspected interval returned 200. There were
27 Path Finder 503 responses, 22 database lock timeouts and five serialization
failures. A successful renewal had extended the session beyond the screenshot
time. Consequently this incident must not be described as a proven renewal
timeout, expired session, revoked access or GPU crash.

Against the exact pre-change controller, 21 of the first 35 recovery tests fail.
The final implementation passes 157 controller cases, including 38 focused
recovery cases, 100 hook cases and 17 popup regression cases: 274 executions.
Frontend TypeScript and focused ESLint checks pass. Tests cover selection
coalescing, transient failure and deadline recovery, immediate denial and model
changes, malformed replies, retry exhaustion, expired grants, cancelled waits,
and ignored stale replies. Session creation is explicitly checked not to retry.

Two older controller fixtures were adjusted for the intentional shared selection
request: the focus/visibility pair now expects one read, and a superseded-capture
test releases the shared authority gate before expecting the new capture. Its
assertion that old cleanup cannot cancel the newer command remains intact.

The previously installed Results endpoint retry and serialized display changes
remain byte-identical. The popup regression suite checks those paths again.

## Runtime recovery after Docker restart

The original Postgres, MinIO, API and WEB containers were started in dependency
order, using the same images, configuration and data mounts. Health checks
passed. No container recreation or engineering-data operation was required.
Evidence: `D:/Codex-test-output/runtime-resume-20261026/recovery.pass.json`.

The preparer separately kept restarting with `LOCK_BUSY` because its durable
owner belonged to the previous Docker boot. A read-only audit covered all three
stores, including the encrypted authentication file and its key. It found no
active work or nested owner. After stopping and joining the exact container,
the recovery archived and compared the stale 258-byte owner by hash and file
identity before releasing only that owner. The same container and image then
started successfully with an owner matching the new Docker boot and process.
All four other stored files remain byte-identical; the journal is unchanged.
The fresh recovery guard passed 42 controls and independent review before use.
Evidence: `runtime-resume-20261026/preparer/recovery.pass.json` under the same
test-output root. Services on 5191 and 5180 were preserved throughout this step.

## Installed verification

Port 5191 serves frontend image
`sha256:3628c44d717677809bac063bc77887ee1e5cd9aec4b0a0eb5f798e4694af644d`,
operation `b756328f-9852-4897-ab2b-bd65a271409d`. The V6 WEB-only operator passed
49 controls and independent review of its 43 frozen inputs, immutable candidate
and strict final preflight. The API image and process were preserved during
the WEB swap, as were 5180 and the recovered preparer.

The installer and an independent root check verified all 32 served files.
The 28 viewer runtime files and inventory are byte-identical to the previous
installation. HTTP checks returned 200 on 5191, 5193 and 5180. No new calculation,
model change, endpoint assignment or engineering-data write was submitted by
the verification. An interactive browser reproduction remains unconfirmed.

Installed evidence: `delivery/deploy.pass.json` and
`root-final-verification.json` in the viewer-access-recovery evidence directory.
Close an old popup and reload the main page once to load the installed code.

Owned cleanup passed for both recovery and WEB delivery: zero temporary helper
containers and zero configuration temporary files remain. Current and rollback
images are retained. Free space after completion is approximately 82.74 GiB on
C and 108.64 GiB on D. No global prune or foreign-container cleanup was used.
