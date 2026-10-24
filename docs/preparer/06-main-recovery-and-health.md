# SP-1 recovery and primary health

Verified24 October2026 from branch sp-1-main-backup-local-20261024, source29664ee.
Cold operationea23121d archived all PG/MinIO/staging data and five exact images,
with separate private config companion. Audited recoveryacac2c9c PASS:
physical byte fidelity, target-DB logical restore in preserved cluster context,
all-public lossless rows/catalog/global metadata, read-only model integrity,
post-audit comparison and complete owned-resource cleanup. Legacy original-ZIP
table absent; startup and full fresh-cluster logical recovery are not proven.
Original qualification remains releasableBackup=false/applicationStartup=NOT_RUN.

Separate narrow health-repair admission950fa345 started the unchanged original PG
and restarted the unchanged web container after its cached API DNS pointed outside
the application network. Final /health and / return200; API/web healthy, PG/MinIO
running. Original image/config/mounts and named network membership preserved;
non-target identities/states unchanged. Docker refreshed the stopped PG's obsolete
bridge ID to the current default bridge; exact old/new proof is private.
Initial diagnostic FAIL (wrong /api/health and strict dynamic bridge-ID equality)
is retained alongside the explicit reconciliation PASS05:20:19Z.

No new schema, candidate deployment, model conversion, APS upload/translation or
PF5191 operation. Candidate deployment still requires old-data compatibility and
rollback verification. Main local and remote main both96e63f13 at05:19Z; no merge.

Private archive/receipt locations remain under .preparer-work; no rows or secrets
are committed.4,432,123,658 bytes of owned duplicate failed-operation archives were
retired after exact retained-copy equality and cleanup proof. Required backup,
images, logical dump, private companion and failure evidence remain.
