# Aalborg — atomic ordinary trace publication event

**Source verified; first actual fixture failed during seed before publication;
metadata fix reviewed, actual atomic controls and deployment pending.**
Local branch `pf-aalborg-ordinary-trace-event-local-20261020` inherits availability
delivery `4a5548c812a16529889425bff8fa54d85f0eef1c`.

New ordinary current healthy trace publication emits `GEOMETRY_TRACE_PUBLISHED`
once after its exact receipt in the final transaction. The current aggregate,
artifact, geometry revision, active model/selection/fingerprint and health must
match. Replays and historical mismatches emit nothing. Managed grants keep their
separate journaled emitter. Final role/login/cancellation gates and unknown COMMIT
reconciliation remain. No authority or calculation/Apply is enabled by the event.

Checks: PASS93repository/grant/recalculation tests plus11engine/integration-contract
tests, server types/build/import closure, scopedlint and independent source review.
Initial lint found an unsafe finally throw in the new fixture; it was corrected,
with primary and cleanup failures retained, before the successful scoped check.
No database result is inferred from mocks. Source hashes/test-report hashes:
`evidence/aalborg-trace-event/source1.json`.

Candidate1 built from7748a61. Fresh commit/disabled case1 failed with23514 in
the existing ready-model guard before trace creation: synthetic validation
metadata omitted package/fingerprint/full-manifest identities. Its helper was
positively joined/removed and only its marker-verified fresh database was dropped.
Failure receipts are retained. The test-only repair reuses one explicitly
synthetic manifest across report/model fields; constraints remain unchanged.
Independent source review confirms conformance to both SQL CHECKs and trigger.
No actual atomic PASS is inferred from this repair.

The new integration control guards a fresh uniquely owned database and empty
storage before initialization. Its five-object synthetic corpus preserves exact
B001/B002 roots, separate STRAIGHT leaves and equipment; actual C#/worker output
is required. Seeded healthy-model/package SQL metadata is only test state, never
converted-model/native/storage-verifier or human acceptance evidence. Planned
actual cases: commit under disabled/paused/expired policy, abort after the actual
dirty write, and lost acknowledgement after the actual final COMMIT. Exact and
new-key completed-derivation replays must not create another generation.

Root owns candidate-image execution and actual fixtures. Each helper uses a
separate fresh test database, separate storage, exact owner/nonce guards and
bounded CPU/memory/time/network controls. Cleanup positively joins/removes only
that helper and drops only its marker-verified new database. The actual5191
Aalborg aggregate, trace, cables and paused policy remain unchanged.

Calculation identity is expected unchanged by source scope; actual comparison
after deployment remains NOT_RUN. Trace derivation identity intentionally changes
because it hashes the repository source. Existing changed-runtime create replay
refusals remain enforced; historical trace GET/list stays readable. No real
recapture/retrace is required for this test. SkipMV remains in force; the230
calculated non-MV proposals await human review,1578stillrequirelocations.
