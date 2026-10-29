# Save calculation admission and Show read ownership

Two separate failures explained the Aalborg Save reports.

The latest saved From assignment persisted, but its automatic calculation was
blocked before job creation with `AUTOMATIC_PAIR_PROOF_READ_LIMIT`.
`acceptedBaselines` shared one receipt reader across unrelated cables. A real,
SELECT-only reproduction reached 33,559,224 bytes on the seventh independent
cable chain; there were no duplicate receipt reads. Each individual chain was
valid and below its limit. The reader is now scoped to each independent cable,
retaining its 32 MiB and 512-node bounds and all receipt/seal/history checks.
The same recorded inputs then proved all seven chains successfully.

Four earlier Saves did calculate and write the selected cable within about
10–12 seconds, before their 13-cable jobs finished. After this early handoff,
Results and the revision-results panel could both call the hook's shared job
reader. The panel starts a lookup when the new job is absent from the older
project-wide jobs list. Its read could supersede the foreground read, leaving
Show without the required job proof.

Proposal/job reads now accept an optional caller cancellation signal. Such
metadata reads own independent controllers, keep the existing request deadline,
and remain fenced to the current administrator, project, login, model and run.
Legacy history reads keep their previous supersession behavior. Exact Results
hydration supplies its own signal, so background inspection cannot cancel it.
No Show, endpoint, currentness, Review or Apply verification gate was relaxed.

Validation: 160 backend tests and 266 hook/Results/Save-flow tests passed, with
frontend/backend typechecks, focused ESLint and independent reviews. The Save
regression mounts the real hook and revision-results component, starts the
competing job read, and verifies Show without Calculate, Refresh or a write.
Read-only actual-data evidence is retained under
`D:/Codex-test-output/save-show-20261026/`. Interactive browser verification is
not claimed.

The existing admission expiry is checked before commit; it is not a hard
in-loop 30-second processing cutoff. The unchanged proof and SQL bounds remain.

Installed on 5191 with operation `992cffbf-8a7e-4c1f-94fa-e22e116fa572`.
The API changed only the compiled revision-result repository; native binaries
and protected calculation files retained their identities. The served frontend
matched all 32 qualified files, including 28 runtime assets. API/web health and
an independent HTTP health check passed. All 144 database tables (102,879 rows)
and model artifacts were conserved, including From binding 39 and cable write
revision 26. A verified 32.95 MB database checkpoint was retained; temporary
helpers were removed. No live calculation or engineering-data change was made
as part of installation. Interactive Save-to-Show verification remains unrun.
