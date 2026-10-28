# Popup recovery delivery — 23 October 2026

The paired API/web delivery to `http://127.0.0.1:5191` completed successfully.
Operation: `5ddf1981-b307-4fed-95e8-16437ae9c519`.
All eight owned phases passed, including backup, isolated restore, migration,
runtime conservation, source installation and positive target retirement.
The final check compared ten served files byte-for-byte with the immutable web
image, verified health and removed its temporary image reader.

See [delivery evidence](evidence/show-recovery-20261023/delivery.json) and the
[implementation explanation](126-popup-read-recovery-and-show-latency.md).

## Result

The popup follows lightweight selected-job progress while calculation is pending.
Temporary read failures recover within bounded windows. Once the selected item
finishes, its exact result and endpoint foreground are verified automatically.
Show then uses that verified payload without repeating the heavy reads on every
click. Model, result, preferences, observed cable revision and history changes
invalidate the display payload. Hide retains its intent while job progress can
update readiness. Hanging shared-state reads now have a deadline and release
their read lane.

The general workflow hook preserves the original barrier policy. Common result
dependencies are reused only within one authorized read transaction; each cable,
its endpoints, seal and applicability are still checked separately. Calculation
and write commands are never retried automatically by this read recovery.
Shared-location calculation order and automatic/manual write policy are retained.

## Verification

- Results component: 131 tests passed.
- Workspace, Path Finder hook and complete partitioned tab suite: 235 passed.
- Endpoint selection hooks: 126 passed; workflow hook: 32 passed.
- Backend selected suites: 101 passed; panel/viewer integration: 245 passed.
- Owned delivery/operator suites: 115 passed.
- Client/server type checks, scoped lint and production builds passed.
- Private delivery/transition/sanitizer guards: 66 passed.

The immutable implementation comparison checked six native modules and all
44 projection files. The native modules and policy versions are identical to the
previous release. The only changed projection is `dependencies.js`, containing
the transaction-local common-read collector. This changes the broader engine
identity; the transition is explicitly recorded in delivery evidence.

## Real Aalborg data check

The candidate image read the five latest proposals in an isolated restored copy
of Aalborg, including `=H1=KF1=TAC1=WGA1`. Independent common reads and the new
transaction-local collector produced identical canonical DTOs. The measured SQL
snapshot-verification entry count fell from five to one. All 81,717 rows in
144 public tables had identical before/after inventories, and the core
transaction rolled back. Its bounded temporary container was positively removed.

See [core-read evidence](evidence/show-recovery-20261023/aalborg-core-read.json).
Observed pass durations were about 4.16 s and 1.01 s, respectively. The independent
pass ran first, so filesystem/cache warming prevents treating these observations
as a controlled speedup estimate or a prediction of browser latency.

This was a core read/parity check, not an authenticated API interaction, a fresh
native route calculation, a cable Apply or a live browser acceptance test. The
first private helper attempt failed before database construction because of its
CommonJS `Pool` import; that helper was corrected and the fresh bounded run
passed. The initial failure receipt is retained separately.

## Remaining acceptance limit

The browser tool failed before opening a surface: `failed to write kernel
assets: The system cannot find the path specified. (os error 3)`. Live popup
interaction therefore remains unconfirmed. No saved user prohibition is inferred
from this tool failure.

Close an existing cable popup and reload the main page once to load the new
frontend. That initial version reload is separate from the removed need to
manually Refresh after each calculation.
