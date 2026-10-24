# Operational delivery and retained recovery evidence

Technical delivery24 October2026; product543ae7a, inherited local SP7 branch.
Source main checkout remains clean96e63f13 and PF5191 is unchanged. No Git remote
mutation. Future WFC/PF merge/build must include the Preparer integration from
this local branch; rebuilding only the untouched old canonical main would omit it.

Primary delivery authority is the separate root-qualified receipt in
.preparer-work/sp-deploy-0f257b41-cebe-409f-a412-bedb56b8d3d0/
root-qualified-delivery.private.json. Automatic operator FAIL is retained, with
exact native root-user equivalence admission; do not promote that failed marker.
Its immutable failed-plan closure intentionally refuses changed operator replay.
Future source operator has45 controls PASS, including native defaults/lifecycle.

Live images and container IDs:

| Role | Container ID prefix | Image SHA256 prefix |
| --- | --- | --- |
| WFC API |2a6fbbfdaeda|ec6fc3cf89dc|
| WFC web5180 |70229930adfe|a9226e283b2b|
| Preparer5193 |a8a93feae305|3e815754b56d|
| Existing PG5434 |2f1d30dd3041|9a2e0383c38a|
| Existing MinIO |6ad45aea3b8f|14cea493d9a3|

Preparer owns exactly three named persistent stores ending-data,-work,-outputs
under wfc-preparer-main-0f257b41-cebe-409f-a412-bedb56b8d3d0. Its private durable
compose is in that operation directory. Keep the current full runtime companion
sp7-current-runtime-companion.private.json private; it contains WFC/storage auth,
not product APS keys. All five services use unless-stopped. SP7 changed only the
original PG restart policy from no; image/config/mounts/PID/start time preserved.
Host/Docker restart was NOT_RUN to preserve unrelated PF services. Actual owned
primary Preparer stop/start PASS with unchanged image/stores, no admitted jobs,
zero APS environment keys and unauthenticated session afterward.

Required private recovery material (do not publish or casually delete):

- Cold seed ea23121d: full PG/MinIO/staging archives, five exact original images,
  separate private configuration companion; verified source release.
- Audited recovery acac2c9c: target-DB logical restore in preserved cluster role
  context, exact rows/schema/global/cluster metadata, model integrity and cleanup.
  This is not an initdb full-cluster logical restore; legacy original-ZIP table was
  absent. Original qualification flags remain unchanged, never relabelled.
- Upgrade730f1a8f: exact old data/metadata, predefined empty archive additions,
  candidate and old-image startup, complete cleanup/release.
- Candidate image export3dd1681e: three exact ID-only archives with verified
  blobs/envelopes/platforms. Source/compiled allowlist contexta71848d6 retained.
- Preparer store recovery0cca87ba: all-three archives+private companion, byte-exact
  prestart restore, only declared auth-file fencing, old-cookie rejection/fresh
  current-admin/history/identical ZIP/zero APS proof and exact clone cleanup.

Original API f65cc58e and web1d5592c1 remain stopped under operation rollback
names, disconnected from the application network, with original configs/images.
Rollback uses those preserved identities and private endpoint/config records in
a fresh reviewed reconciliation; stop/quiesce current work first, preserve all
current Preparer volumes and never restore an old DB over intervening edits.
Old-image compatibility on migrated cloned data was verified. A live primary
rollback/recreate is NOT_RUN; do not claim tested complete disaster recovery on
a different computer or a full host reboot.

All owned synthetic fixture containers/volumes/networks were removed. Exact failed
duplicate archives retired with retained-copy checks freed6,426,951,237 bytes;
required backups/rollback/evidence remain. No global prune, denied scratch path
or source mirror operation. Real new conversion remains explicitly excluded.
