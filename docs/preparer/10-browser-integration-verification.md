# SP-5 — actual isolated browser integration

Candidate product543ae7a; fixture operator244464c. Owned operationc40c725a,
24 October2026. IAB browser work was performed only on fixture5194/5193; saved
PF5191 refusal was neither retried nor bypassed. Main5180/PF data unchanged.

PASS: synthetic admin login in WFC, admin launcher, separate tab with empty key
fields, explicit fake Autodesk check, selected disposable NWD, Generate packaging
of existing tiny converted resources, completed WFC import, model listed in WFC
and browser ZIP download. No real APS request/conversion or geometry acceptance.
Browser/Preparer/WFC original ZIPs match exactly:2524bytes,
SHA25643bfe35d3c5ef19ae3271ce31493057a7c526fd8f0202213d493603792291489.

PASS: two actual fixture admins entering identical synthetic keys; foreign ZIP
and resume404, crossed lease401, owner lists separated. Second admin browser
shows empty keys and no private model history. A temporary own-fixture DB demotion
invalidated the existing Preparer login; role was restored. No real user changes.

PASS: closing/reopening the page clears both fields and confirmation; same owned
Preparer process stop/start retains encrypted WFC login, history and identical
local ZIP, rejects prior APS lease401 and makes zero startup APS calls. Actual
postrestart browser shows empty keys and retained result. A read-only scan of all
three product stores checked92files/191913bytes with zero raw Autodesk key matches.
Separate private fixture configuration contains disposable fake credentials and
is explicitly outside that product-store assertion. All test tabs are closed.

Retained FAILs: two fresh fixture PG starts failed because the official entrypoint
clears PGHOST and expected its default socket. Exact image entrypoint inspection
led to a bounded UID999 socket tmpfs;18/18 fixture controls PASS and next fresh
fixture started successfully. Both failed operations' resources fully removed.
The first immediate restart probe lacked a readiness barrier and failed; after
explicit readiness, auth/history/ZIP/zero-APS proof PASS. Failure not reclassified.

Evidence screenshots under evidence/sp5-*.png; complete private HTTP/browser/
restart/role/persistence receipts remain in the owned operation directory.
Three-store snapshot/fresh restore and final owned fixture retirement remain
pending; SP-5 is not complete until those gates pass. SP6 upgrade/rollback source
preparation proceeds independently. Production Preparer deployment NOT_RUN.
