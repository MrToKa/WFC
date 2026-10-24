# SP-4 — WFC integration source verification

Product543ae7a closure checked on sp-4-wfc-browser-archive-local-20261024 after
SP-3 d3a7332. WFC focused54/54 PASS and full typecheck PASS; relevant product files
unchanged at source-bookend check24 October. Sources support current-admin WFC
launcher, fixed internal/public origin handoff, separate Preparer tab, local logout
revocation, English page-only key fields and retained-original-ZIP download.

Gateway tests cover current role change, exact Host, bounded fixed-origin exchange
and no key/token echo. ZIP route tests cover archive verification, permissions,
stream ownership and role recheck before bytes. The corrected autoClose/pipeline
contract avoids a reader deadlock. Existing model import transaction is preserved.
Existing real legacy model rows have no original-ZIP archive table; this does not
retroactively create old ZIPs or establish live browser acceptance.

All checks use fakes/synthetic packages; new real conversion NOT_RUN by user
restriction. Candidate images are built and isolated Preparer smoke PASS. Full
isolated app/browser/restart check and candidate compatibility/rollback remain
required before5180 update. No product/global .env credentials are used.
