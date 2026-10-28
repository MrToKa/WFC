# Aalborg discovery and automatic endpoint diagnostics

Status: **repair technically verified; complete real network and cable calculation BLOCKED by explicit project-scope/data decisions**. Human engineering acceptance and real Apply have not been performed.

Work is isolated to `C:/Users/todor.chankov/source/WFC-pathfinder-local`, branch
`pf-aalborg-auto-diagnostics-local-20261020`, inherited commit
`3cb40404738a1857b83a335f37ec9b62157c5408`. Evidence was observed on
19 October 2026 UTC / 20 October local time. The technical commit containing this
report and its subsequent handoff identify the delivered revision. Original WFC,
both reference PathFinder checkouts, sources, original containers and port 5190
were not changed. No push, PR, merge or original installation update occurred.

## Findings and resulting behavior

1. The previous panel could present unloaded discovery as if exact candidates
   were missing. It now separates fresh discovery, frozen coverage, saved manual
   roots and stale scope. The two existing user root decisions remain unchanged;
   their physical fragment coverage was independently verified.
2. The full current converted model contains 328 unique exact tray names out of
   the 330-row project catalog. Two requested names are genuinely absent in the
   retained SDK inventory and property database. They remain named blocking
   diagnostics in the private UI; nothing is silently excluded.
3. Project endpoint names lacked a single leading slash present in model names.
   Policy `wfc.pf.project-exact-candidates.v2` adds an explicit model-side adapter
   while retaining exact tray matching, project location identity, punctuation,
   internal/repeated slashes and historical v1 plans. This is a converted-model
   policy, not proof of native-addon parity.
4. Equipment discovery now builds one bounded reverse index for the active model
   and reuses it for all name batches. A live intermediate candidate exposed a
   bad new guard: a valid SDK object had 7,698 properties, mostly structural child
   links. The fixed guard distinguishes raw scanned properties from eligible
   endpoint values. Raw scan, retained keys/postings and accounted memory remain
   bounded. The intermediate failure and successful replay are retained.
5. New calculation dependency v6 permits a unique, immutable, corroborated model
   candidate to supply an approximate proposal endpoint. It records model, plan,
   geometry, identity, coordinate-frame and implementation provenance. It does
   not create a confirmed manual binding. Any existing manual/legacy/stale
   binding prevents automatic substitution. Normal v5 calculations remain
   compatible; Review/Apply and existing auth/write fences remain in force.

The index bounds are 1,000,000 raw properties per object, 32,000,000 scanned
properties, 4,096 eligible properties per object, 256 MiB accounted retained
index, 1,000,000 keys and 4,000,000 postings. Accounted bytes are not a measurement
of browser heap usage. Preparation capture also respects each frozen equipment
slice during both name and property passes. Parent/frame timeouts are aligned.

## Actual verification

The sanitized [receipt](evidence/aalborg-diagnostics/technical-receipt.json)
pins source hashes, images, retained private checks and scope. Raw model/business
rows, logins, tokens, backups and screenshots remain outside Git.

| Check | Result and exact scope |
| --- | --- |
| Retained real-data audit | PASS: 214 inventory parts and five property resources verified; 438,155 tree objects. 328 unique trays, two absent, no duplicate exact tray names. |
| Official SDK replay | PASS: all 1,527 endpoint names, 48 name pages, one 856-batch property scan, zero network calls. 437 unique / 48 ambiguous / 1,042 missing. Old guard failure reproduced separately. Geometry is not qualified by this replay. |
| Browser discovery | PASS on updated 5191: all 438,155 property rows returned, zero unavailable; 2,957 retained inventory records. New v2 frozen plan has 328 trays, 1,161 physical leaves and five parts. |
| Frozen plan persistence | PASS through normal admin HTTP: saved policy/hash/counts agree with UI. Purpose rules, user root decisions and exact cable response bytes unchanged. |
| Automatic resolver SQL | PASS on temporary clones of nine actual PostgreSQL table definitions with synthetic immutable geometry. Current admin transaction checked; unique anchor, saved head and legacy binding protection verified. Forced rollback; public row hashes unchanged. FK publication and real cable calculations are outside this check. |
| Source checks | PASS: typecheck, focused lint; runtime/capture/bridge/closure 111 cases, subsequent final guard/helper 36 cases; preparation/controller/matching 160 cases; panel/hook 31 cases; v6/identity/client/comparison 79 cases; worker/auth/Apply controls 127 cases. Groups overlap and must not be summed. |
| Own runtime update | PASS: only owned 5191 API/web replaced, current database backup retained, other own containers/volumes/networks preserved. Seven normal HTTP/asset checks passed. Browser has no captured error-level logs after discovery. |
| Complete network / real calculations | BLOCKED: two missing requested tray roots; no scope exclusion authorized yet. Zero parts captured/published by this repair, zero real cable calculations or Apply. |
| Human engineering acceptance | NOT_RUN; remains the user's decision. |

The final API image is
`sha256:cfa0961a5dca8b81b1237cde79cff3a48cd3dd75553175e7091117b7898363eb`;
web image is
`sha256:ad01f947320500cfd08c789c4de9aebd51664abc2234cded7780e56f350e990a`.
The new frozen plan hash is
`adb6b34e32a640abd65917c769a5a38a810a151e41d22f20b78c786db676e67f`.

## Remaining engineering work

- The pending user choice is whether to exclude the two absent catalog trays
  only from this preparation scope, or keep them blocking until manual review.
  No answer has been inferred from elapsed time.
- 230 of 2,140 cables have two unique model endpoint candidates. This is endpoint
  eligibility only: it proves neither a connected route nor a calculated length.
  651 cables have one unique end; 1,259 have neither end unique. Missing and
  ambiguous locations need actual mapping or explicit physical selection.
- After scope resolution, rediscover/freeze, collect the five bounded parts,
  publish the aggregate and build geometry traceability through the protected
  workflow. Then test actual calculation proposals and their deltas; preserve
  human Review/Apply. Do not substitute the legacy 13-object diagnostic snapshot
  for the complete project network.
- The new calculation implementation identity invalidates historical producer
  qualification. Background execution is not re-qualified or enabled here.
  No broader grant, invented binding, native acceptance or automatic real Apply
  is authorized by this repair.

Owned helper containers were removed by their scoped cleanup. Keep the 5191 demo,
current backups, input/replay evidence and local screenshots. Historical denied
scratch paths remain untouched; no Docker prune or parent deletion was used.
