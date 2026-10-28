# SP-2 — verified source security

Source preparation was committed earlier in543ae7a; verification closure is now
executed on sp-2-transient-admin-security-local-20261024 after SP-1 health repair.
Fresh24 October source-bookend check PASS: all116 inputs and terminal TAP bytes
match the full Linux329/329 run. Evidence:sp2-sp4-source-bookends-20261024.json and
transient-full-linux-20261024.json. No duplicate full run was needed.

Current explicit admin flag is fetched from WFC; engineering labels/stale login
responses cannot grant access. APS leases are bound to owner/login/page/revision/
process epoch; expiry, logout, replacement and authority loss revoke them. Only
encrypted WFC login is durable. Legacy APS settings remain unclaimed; .env is
never a product fallback. Both UI fields start empty and do not use browser storage.

Verified coverage includes two administrators entering identical keys, two tabs,
demotion/deletion/outage, forged/copied bindings, heartbeat expiry, logout race,
restart loss of APS authority and local sign-out during WFC outage. This is source
and fake-transport verification; real browser and deployment remain NOT_RUN.
No new real model conversion was performed. Existing owned test resources exited
and were removed; backup/rollback evidence remains protected.
