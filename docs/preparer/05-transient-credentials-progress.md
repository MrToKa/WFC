# Temporary page credentials — implementation and verification

24 October 2026. Accepted requirements are in 00-plan.md's latest overrides.
Source work is prepared on sp-1-main-backup-local-20261024; it is not a main5180
deployment or real browser acceptance. Root performs every actual test/runtime
operation. Parallel agents own separate source modules and never execute them.

The workspace now requires the fresh explicit WFC administrator flag. The page
starts with empty Client ID and Client Secret fields; no product environment or
legacy saved-settings fallback exists. Memory leases bind owner/login/page/
credential revision, expire after120seconds without renewal and are released
best-effort on page closure. APS provider authorization is refreshed immediately
before network operations; synchronous final cost guards remain synchronous.
Only encrypted WFC login authority is durable. Legacy encrypted APS material is
preserved unclaimed and never decoded or adopted by startup.

Owner-only durable directories preserve full trusted owner identities and full
application fingerprints on work records. Two administrators cannot list, reuse,
resume or download each other's work. Verified local ZIPs remain downloadable
without APS credentials; remote recovery needs newly entered matching keys.
The WFC admin launcher uses a bounded server handoff with a fresh admin check,
fixed internal/public origins and a Strict/HttpOnly cookie. No APS keys enter WFC.
Retained model ZIP download is current-admin-only, including a recheck after
verification and before response bytes. UI text is English.

Fresh root checks:

- Final full Preparer Linux suite after logout repair:329/329 PASS, no skips or
  cancellations,190225ms. All116 source/package input hashes match before/after;
  receipt evidence/transient-full-linux-20261024.json. Final WFC focused series
  PASS54/54. Local logout during WFC outage separately PASS1/1 with no network.

- Package current-runtime overlay: Linux174/174 PASS, no skips/cancellations,
  Node24.22, network disabled. The first vendor-only discovery run had zero tests
  and is explicitly not verification; the complete run used retained tests plus
  exact current vendored runtime overlays.
- Full Preparer Linux suite:328/328 PASS, no skips/cancellations,188940ms, network
  disabled and source mounted read-only. This precedes the subsequently found
  logout-during-WFC-outage repair; final candidate recheck remains required.
- Focused Windows combined suite:87tests/86PASS/1FAIL,211223ms. Sole failure was
  an HTTP Host test using fetch, which silently discarded its overridden header.
  The test now uses native HTTP; fresh focused handoff test PASS1/1. The earlier
  58test/50PASS/8FAIL run and separate failing Generate diagnostic are retained.
- The diagnostic proved ENAMETOOLONG at deeply nested Windows paths. Removing
  the extra app directory fixed the actual simulated Generate/ZIP/import/restart
  path: targeted PASS1/1,29926ms. Package validation guards were retained.
- WFC gateway/API/auth/UI focused series:54tests/53PASS/1FAIL plus1fixture error.
  The missing JSDOM ResizeObserver was fixed in the page test only; fresh page
  PASS5/5. Four other test files passed, including native Host/admin demotion.
- Full WFC TypeScript checks PASS. Real browser acceptance is NOT_RUN.

Backup preparation is independent. Exact PG18 root data→dot alias and sticky
root01777 have a separate closed archive format; generic archive link rejection
is unchanged. Linux17/17 archive tests PASS; final capture/capability controls
44/44 PASS. Early actual capture attempts refused before any source stop/export
because of a stale stopped-container network, the closed alias and sticky root.
Each failure has separate private evidence/reconciliation; no blind replay or
historical refusal bypass occurred. Actual cold operation ea23121d is now active.
Cold capture ea23121d subsequently finished PASS with confirmed lock release,
three verified archives and five exact images. Owned audited clone recovery
d1994f0a is ACTIVE. Earlier289c462e refused before resource creation on verified
PGDATA GID0; the narrow ID guard now accepts exact999:0 and23controls pass.
Recoverable clone/model/ZIP proof and main repair/deployment remain NOT_RUN.

No new real model conversion, APS upload or translation submission was performed.
All Generate checks used fake transports and synthetic fixtures. Main PG remains
stopped pending a verified cold seed and owned clone recovery. PF5191 is preserved;
main remains clean at96e63f13 and the user's PF merge is still pending.
