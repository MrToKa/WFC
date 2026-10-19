# PathFinder local implementation progress

## Authority and environment

The user explicitly authorized automatic implementation of the remaining stages on 17 October 2026, invoking `prepare-stage-handoff` after each completed stage and using recommended choices for routine questions. The subsequent instruction starts that work now. Historical per-stage stop instructions do not require a fresh confirmation. Final integration into the existing application remains a separate user decision.

- Working copy: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
- Current branch: `pf-r6-model-revisions-local-20261019` (inspect live branch/HEAD before each continuation).
- Historical integrated implementation commit: `51cc8324b40bd0ce2ed7d0b03decbdc06385b54a`; integration evidence/handoff commit: `03db8f7b557c1afcf05c18b81e704119db459503`. Later delivery commits are recorded below. Read live HEAD/status rather than inferring a self-referential hash or pending-change state from this historical line.
- Verified local operational delivery commit: `bf9dfdf8b075259880b58cc7a31202844a902f87`; the following metadata-only commit records the actual automation pause. Current live HEAD is authoritative.
- Starting commit: `23741d1f485248ddb519f9e04e0b7856cc0e3def` (PF-0).
- Canonical reference: PathFinder `45c24bf5f433f13e102600b36f20327c77961d0a`.
- Original WFC, both PathFinder checkouts, running containers, databases and storage are reference-only.
- No push, PR, merge, deployment or updating the existing installation is authorized.

## Current execution — PF-R0 and sequential PF-R delivery

Explicit user authorization on 19 October 2026: implement plan32, create a detailed
self-contained next prompt after EACH technically completed stage, account for
earlier deliveries and execute that prompt immediately. Routine questions use the
recommended engineering choice and are recorded; no routine stage pause.

- Starting revision: `916256f0da14b8f21ca039b34bfae2de33b2bb0d`.
- Completed R0 commit: `09f0e1dbdded9abca35b493db6eda7e9df9b94e4`.
- Detailed R1 handoff: `handoffs/PF-R1-project-tray-catalog.md`, committed at
  `9c5fa34` after prepare-stage-handoff. PF-R1 technical commit is d997dca1e7673061bd04e64bad61b6563749e1b7.
  Detailed R2 handoff: handoffs/PF-R2-purpose-policy.md; execute immediately on
  inherited pf-r2-purpose-policy-local-20261019 after this metadata commit.
  Do not repeat R0, source seed/catalog copy or model conversion/import.
- Active app heartbeat: `path-finder-purpose-rules-and-model-revisions`, ACTIVE,
  every ten minutes, created through the app tool; the old `pathfinder` remains deleted.
- Root owns overview/catalog examples, baseline/frozen hashes, validation matrix,
  report/progress/handoffs and ALL actual runtime/SQL/HTTP operations.
- R1 ownership: source-lib (old_model_conversion_map), transfer-lib
  (revision_geometry_ingestion_plan), guard-io (purpose_revision_plan_review).
  Root owns catalog CLI, independent preservation audit, docs and all actual
  runtime operations. The module writers finished their scoped deliveries;
  read-only source reviews continue when assigned. Do not duplicate root's run.
- Fresh original source metadata inspection PASS at 21:39:34 UTC on18October;
  receipt `evidence/current-inputs/pfr1-source-inspection-cdaae722-7163-45fb-a156-864d660d93fc.json`.
  Original checkout/container/endpoint/module pins unchanged.
- Root actual read-only capture PASS:330trays,51types,9default materials,
  15material trays,14project supports,5supports,3curves/803points,6report mappings,
  6files. Work `.scratch/tray-catalog-17cadea1-d54c-42b1-a563-2d3c514e7704`;
  capture receipt `evidence/tray-catalog/operator-1792360720690-8e9f1173.json`.
  Source before/copy hashes match. Independent full audit covers45tables.
  Actual original GET/readback6files/872680bytes PASS, private hash-pinned evidence.
- All4 project drawing preferences were NONNULL in original and NULL in copied
  seed: support_distance/support_weight/tray_load_safety_factor/cable_layout_settings.
  Necessary R1 scope now includes exact4-field NULL/CAS enrichment in SAME
  transaction. All identity/S/E/P/gap/model/timestamps/otherfields stay protected.
- Final combined synthetic controls192/192 PASS, exact source hashes and raw
  evidence in `evidence/tray-catalog/final-controls-1792361864308.json` (40source,
  76transfer,30guard,12preservation,5operator,29diagnostics). These are synthetic
  controls, separate from real capture/copy/replay/readonlyverification below.
- Runtime guard review closed: bounded stdin packet fixes44906-char Windows
  argv issue; AsyncFunction resolves bare packages; raw evidence durable before
  parsing; source mutation denied. Root CLI has same-plan staging resume,
  missing-descriptor recovery, complete source/seed map binding, pre-apply source
  guard, pre-write independent typed audit and explicit COMMIT outcome receipts.
- Source catalog diagnostics:330distinct names/6purposes, no observed missing
  purposes/types/unsupported codes/name-key collisions. Pure material collation
  remains explicitly NOT_VERIFIED; no synthetic claim of SQL collation parity.
- Actual prepare PASS:6new owned file objects/872680bytes;1026oldmodelobjects
  unchanged; immutable1313111byte planSHA31dee403bcbb79a0e54c737b50224873f0df32328a839e0717c7ee155f364884.
  Prepared descriptorSHA41e8cb8c00b12b3c3a12471d0b8db709a7c780362665ddc92ab82641f1a1f98c.
  Receipt `evidence/tray-catalog/operator-1792361207244-a3ea05ac.json`.
  Existing-descriptor recovery check PASS, sameplan/sameIDs/no writes, receipt
  `evidence/tray-catalog/operator-1792361309372-218493b7.json`.
- First actual writer FAILED before writes/COMMIT and rolled back. Root actual
  independent45table reconciliation PASS exactly initial state; real readonlyPG
  control confirmed SQLSTATE22023 forJSONnull-minus-array. Fixed unused INSERT
  comparison operand to{};76transfercontrolsPASS. Corrected sameplan readonly
  reconciliation PASS: complete typed projection reaches expected VERIFY_NOT_FINAL,
  writesAttemptedfalse/rollbackConfirmedtrue. All failed receipts retained.
- Corrected sameplan actualcopy PASS/COMMITconfirmed:
  `evidence/tray-catalog/operator-1792361561541-c4524e45.json`.
  1192insertions/50type enrichments/project4drawingprefs only. Full45table
  auditPASS, all2143targetcables unchanged, originalprojectionunchanged,
  old1026modelobjects unchanged and6plannedfiles only.
- Exactsameplan replay PASS/already_transferred, no additional rows changed:
  `evidence/tray-catalog/operator-1792361615735-eb7c64dc.json`.
  Readonlyfinalverification PASS:
  `evidence/tray-catalog/operator-1792361791842-2672b4a9.json`.
- Computer-use Trays/detail/material/support/loadcurve +PathFinder3tools,
  protected3Dmodelloaded andDetails1/7/5/10 PASS:
  `evidence/tray-catalog/computer-use-1792361908753.json`. Browser2/tab6 held
  for continued work at5191PathFinder. Screenshots private/notGit. Existing
  diagnosticnetwork13objects remains; fullnetwork/engineeringApply NOT_RUN.
- No active root subprocess. All R1 source/evidence review findings are closed;
  final report36 and operatorguide are written. KnownemptyACLdiagnosticTemp
  residue is documented, not retried. Seven denied historicalpaths untouched.
  No active download/package. PF-R0 documentation is
  technically delivered; no implemented R1/R2 function or engineering acceptance
  is yet claimed. Original checkout/container/database restrictions still apply.
- Evidence: 35-r0-stage-report.md; 12/12 documentation checks PASS, 24 locked
  references/11 Core, 29 unique synthetic policy cases, 54 links/0 missing,
  zero known credential matches; independent review findings closed.
- Next: PF-R2 persistent routing-purpose settings. A owns new shared/catalog/schema,
  B new policy repository/router/parser, C API/hook/card and Details integration.
  Root owns existing server schema/app/router/dependencies and actual runtime checks.
  R1 historical note; see live R2 checkpoint below for current runtime changes.

## Current PF-R6 — TECHNICAL_PASS at recorded scope; local commit next

Final source6374a1493beb3dd783d1e7841d52d7f3fe70e400c8a769aff47c6da0b539b203,
candidate4/API9cd8072c556f5c3322acd64ce41a5b58e612bb5511eb2a2bbbd18a57df115b19/
Web81df32517a4d50efc04700696039ef2d308b9879d9256e95275fbf207648d100.
Rootoperator default profile6 in ownedwork28d3491f-e33c-46cb-95c9-d72688340ba5.
Report42/source-final4/final-preservation contain exact source/scopes/results.
Combined93files1439PASS/0FAIL/5optionalNOT_RUN; final recovery/no-op correction
62scopedPASS/types/lint, latest-overall-intent semantics. Actual15PGphases/11HTTP
edges, normal old/current8→9object pair/17unresolved/11candidateedges/0matches,
normalreplay, original13-objectgeom5/BC022-2/3exacttestpoints restored.
Actualv4controls9proposals/6stale/6Review409/3finalroutes; UIpreview7.478969923197742m
yellow/filledGhost/opaque/Clear/finalreloadPASS. NoApply/realbinding/frameacceptance.
All110tables reconciled: 64oldexact/36exactreceipt deltas plus10newtables;
63oldPF_ROOTfiles13834192bytes exact/all51newfiles referenced,114total17384086B.
Initial two safeclassifierFAILs retained; final232c868a-c577-4ef0-9568-c0d05e9926fe
PASS. Raw3cachemanifest adjunct proves6cachefiles.1374oldstorageobjects exact,
173newresources rawSHAverified/1547total.3referencecheckouts/18outsidecontainers
unchanged. Sixexactunusedcandidateimages removed;0newtestcontainers.
Current approved5191demo/backup469c37ef/privatecompanion/evidence/deniedpaths
retained. No active root subprocess; agentA classifierfrozen, B/Cdrafts complete.
Next: local technicalcommit →officialR7handoff using skill/fresh remote/local
state →newinheritedR7branch and immediateimplementation. R7–R10 notdone.
No original/sources/5190changes, no push/PR/merge/deployment. Automation ACTIVE.

## Previous PF-R5 — TECHNICAL_PASS at recorded scope

- Inherited R5handoffc7adcab176058331c75c352eaf1f39e51b6e10d9/R4technical
  403504d4763efb97fabc1f4cc2f137ae0e3be370; new local inherited branch
  pf-r5-endpoint-attachments-local-20261019. Detailed assignment
  handoffs/PF-R5-endpoint-attachments.md is being executed immediately.
- A owns only new shared endpoint contracts/pure attachment evaluator/tests;
  B new endpoint schema/repository/routes/tests; C new API/hook/editor/history/
  tests. Root owns existing source integration/v3 dependencies/legacy fences,
  docs and all actual runtime/SQL/HTTP/browser. Preserve concurrent changes.
- Agreed atomic shared location/name/aliases+binding confirmation with exact
  command/replay and expected revisions, one head per location. Current R4
  capture-frame confirmation is separate from qualified cross-revision Follow.
  Real Follow remains unavailable without qualified server-owned evidence.
- New private root owner/work45f60132-cc3f-4710-aaed-4aa7e988bf89 under
  engine/.scratch/tray-catalog-…; reviewed initial r5-approved-runtime.private.json
  matched R4candidate1/5191. Fresh95table/PF_ROOT63files13834192bytes baseline PASS;
  cold checkpointa5a2afa6-8333-4b09-a7dd-b1625d0040108members/4images/TOC59193bytes
  PASS, all4models1368resources1756031212bytes rawSHAverified; privatecompanion
  separate. No fullrestore. Current reviewed r5-approved-runtime2.private.json
  binds resumed exact5191roles; firstprofile stale. No original/5190 restart.
- Root v3 endpoint dependency collection/strict dispatch+Review+Apply guard,
  geometryhash/provenance, namedpreviewhead requirement, legacyvisibility/fences
  and new atomicpanel wiring implemented. Scoped provenance/routing23PASS,
  collector7PASS, adaptedpreview25PASS. Earlier preview15FAIL represented old
  mocks missing new context; current fixture projection updated without changing
  frozen mathematical expected data. C3tools51PASS, A78purePASS, Btestsongoing.
  Counts are scoped/overlapping, no combined or runtime R5 PASS yet.
- Roottypes31614running; serverfirstpassPASS, prior front Ctest-only errors
  beingfixed byC. No R5 build/upgrade/migration/actualfeature checks yet.
- Latest source checkpoint: both roottypes PASS. A78pure controls/source frozen;
  B57mockcontrols and independent SQL/source review PASS (exacttrace/objectFK
  strengthened), rootintegrationsource review no remainingmaterialfinding;
  C14new +51existingintegration +1targetedunknownsave controls PASS. Parent
  locks Savedlocation/Resolve while mutationoutcome unknown; body/key preserved.
  Rootprovenance23+collector7+preview25 scopePASS; no combined/runtimeR5PASS.
- Root seeded only explicit synthetic R5control inputs in retained UIproject:
  1type/3cables/1legacyv1location+binding, durable exactUUID/marker/actorintent and
  COMMITconfirmed private receipt. Existing Details/model/aggregate/traces unchanged.
  Points selected from retained fitted trace for controlled names PF-R5-A/B;
  legacycontrolledpoint[0,0,0.5] explicit, not fallback. No modelseed/import/Apply.
  Source allconverted roleobject count0 in existingpartialindexes; actual equipment
  object-derived positive remains NOT_RUN, pure/mockmechanics separate. Do not
  invent actual equipment or qualify routing/hierarchy as equipment.
- Bauthoring bounded root-invokable actual phase harness; ROOTONLY executes after
  build. No root subprocess currentlyactive. FreshR5 runtimebuild still pending.
- R5 accuracy review correction: raw coordinate displacement now requires the
  identical capture frame; unknown legacy/different frames retain prior points
  with NULL distance and explicit unverified basis. Qualified pure migration
  compares the source normalized into the target frame. A81/B73/C16 scoped
  controls PASS and independent harness safety review closed; sources frozen.
- First combined75file run:1224PASS/7FAIL/5optionalNOT_RUN. All7 failures are
  legacy repository-match mocks missing the new project-preparation query;
  B owns only that test adaptation plus candidate-only authority regression.
  Root bothTypeScriptchecks and40filelint PASS. Root scripts prepared for
  normalHTTP,16boundedSQL controls,10transport controls and final95table audit;
  none of those actual R5 feature checks has run. No R5upgrade yet.
- Corrected repository mock/regression16PASS; secondcombined75files1234PASS/
  0FAIL/5optionalNOT_RUN. Candidatebuild1 PASS,1338contextfiles SHA
  ab3a4e732c8703da09513ac27cefe36f0bdb64696ac838c1ce0a4a8619460b2b.
  Explicit api/web-only5191 upgrade PASS;18outsidecontainers unchanged,
  PG/MinIO/volumes/networks exact. Current approvedprofile3 binds API
  9d41a53a3b759f0819ea9f13cde326376542e03a19bd717fdd6a3abe34ae5c81
  andweb3928914e878f7721595c3a2f93aa3a80c9c335eec5b0ed210b26ee388f214371.
  Root normalHTTP confirmation script is running (one-shot; do not duplicate).
- Final normalHTTP and16actualPostgreSQL controls PASS;2simultaneousHTTP
  replay/CAS pairs PASS;10host transport checks PASS. Actual3synthetic cables
  calculated successfully withv3 endpoints/currentaggregate; one shared point
  update stalesall3 and all3Review callsrefuse,0Apply/cablewrites.11normalUI
  observations PASS incl protectedpicking/save/manualrestore/history/legacyunknown
  displacement/sharednamedpreview/Instrumentation→Control/filledGhost/yellow/Clear.
- Final95table audit:80exact,13strict seed/PF deltas+2ordinaryauth,5new tables
  exactly3ownedlocations. First classifierFAIL retained; independently reconciled
  4seed drawingevents/state1→5 and4normalUI automaticjobprincipals. There were
  1explicitrootcalc+4normalUIautocalc+1normalUIpreview, exactIDs/inputs/principals;
  all3controlcablefullrows equalpostseed.63PF_ROOTfiles13834192bytes exact,
  1374storageobjects exactmetadata,1175non-docbuildfiles exact;18outsidecontainers
  and3originalrepositoryrecordedstates preserved. Report41/evidence endpoint-bindings.
- Actualequipmentpositive andrealqualifiedFollow NOT_RUN: no equipment/localframe/
  commonframe evidence in13objectcapture. PurequalifiedmechanicsPASS is separate;
  noidentity/engineeringacceptance fabricated. Nooriginal/5190writes orpublication.
  Noactive root subprocess; agentsfrozen. Keep5191demo/checkpoint/evidence;
  noR5testcontainerscreated, nohistoricaldeniedpath cleanupattempted.
- R5technical delivery committed locally at
  c9d42429077c5be415eb3d71aa7ee458eb568fd9 (77files); only historical refused
  .pf0-work/.pf2-work remainuntracked. prepare-stage-handoff produced detailed
  handoffs/PF-R6-model-revision-comparison.md using fresh local/GitHub evidence.
  Next commit is metadata only, then inheritnewR6branch and execute immediately.
  Automation ACTIVE; no routinepause. No active runtime/subprocess.
- Next: coordinated shared contracts → parallel modules/root v3+legacy/UI wiring
  → isolated tests/checkpoint → frozen candidate build → actual SQL/HTTP/UI and
  preservation → local commit, detailed R6handoff, execute immediately.
  Automation ACTIVE; no original/5190 changes, publication or engineering Apply.

## Previous PF-R4 — TECHNICAL_PASS at recorded diagnostic scope

- Branchpf-r4-geometry-trace-local-20261019 inherits R4handoff3d78bc245e15957c1607c4ebc2dd95a31a44f8b4
  and R3technical8c65ee1ccf9cb4b07c80bba99a475942fc6538e3. Report40 and
  evidence/geometry-trace/ record current proof; local technical commit next.
- Root actual executor; A C#export/tests, B bounded immutable geometry pipeline,
  C protected evidence/UI finished and frozen. No active runtime subprocess.
- Final63files1039PASS/0FAIL/5optionalNOT_RUN;11protected suites178PASS;
  actualC#39PASS now durable raw receipt; types/lint/19immutable/11Core pins PASS.
  Tests overlap. Normal Linux fsync exercised; Windows native sync NOT_RUN.
- Actual first13object/6segment/23point/10port trace, replay/history PASS;
  11repository phases and11hosttransport controls PASS. Separate actual
  post-admission owned-actor demotion causes original request403,0proof writes,
  prior proof unchanged and actor restored. Same command after natural150s lease
  recovers same intent/trace0dd84cd9-b64d-48fc-8e3d-81fbfc5a25c3, exact replay PASS.
- Normal protected UI capture/publish produces geometry2 aggregate7ca536d8-29a0-4fbc-ad4e-e31bd2fd747c,
  sessiondbe5af1c-29f3-4e50-9378-ea3883c7d148. Completed22fragment evidence17041bytes
  SHA6e0b80be4ea41d31d636f45990a247692d55f77dc6cc2b38e0d128d42e19e945;
  actualGET/exactPUTreplay/badhash400/foreignpart404 PASS. Both trace histories,
  object measurements/observations/unknownframes and filledGhost/yellow/Clear
  confirmed by computer-use. Screenshots private and hashed. No real Apply.
- Candidate1 healthy only5191. API0e48aa23e742624302ec7045dc3c213b4d2c0ee06fc913b0edcbe7dd4d0be886,
  webc89c9c5171f4852cf49343b737d2898859f757fd388e3e74ca80f4f03139db76;
  context1310filesSHAa228ff597d03de3dece853414deb8125eddbc71e906aac6a99cf3387e3317f10.
  1149non-doc files match. Current explicit profile3 in own private work
  .scratch/tray-catalog-80f5e81a-7f8b-40c3-b41e-f6f57a2e771e;1/2stale.
- Final89table audit75exact/12ownedfixture prep+lookup deltas/2strict ordinary
  auth tables;6newtrace tables all owned fixture. All1374oldobjects metadata exact.
  All business/model/routing/design/install/write revisions/drawing preserved;
  original3repo states and18outside containers unchanged. No5190 mutation.
- Before migration exact metadata-only enginefixture retirement1608rows/13files
  and independent89table audit PASS. FullUIfixture retained; no reseed/import.
  Backuped1b2fa8-f832-45df-b5de-8eec4fe693ff8members/4images/TOC55175bytes PASS;
  all4ready models1368resources/1756031212bytes fully rawSHAverified. Fullrestore
  NOT_RUN. Private companion separate. Keep necessary demo/checkpoints/evidence.
- Failed root-only assertions/formatters are retained: geometry revision string,
  null observation, provenance at object level, bounded ordinary Viewer renewal.
  Same retained raw successes reconciled; no product fix/repeated preparation.
- Full330tray capacity/commonframe/native parity/human engineering acceptance
  remain NOT_RUN; real copied project still0rules/0trustedprojectnetwork/0bindings/
  0Apply. Unknown identity/localframe not invented. Denied historical paths untouched.
- Technical R4 committed403504d4763efb97fabc1f4cc2f137ae0e3be370 (67files).
  Detailed handoffs/PF-R5-endpoint-attachments.md reconciled through
  prepare-stage-handoff. Next metadata commit → inherited
  pf-r5-endpoint-attachments-local-20261019 → execute immediately. Automation stays
  ACTIVE; no routine pause/publication. No root subprocess or active capture.
## Previous PF-R3 — TECHNICAL_PASS at tested scope

- R3 technical commit **8c65ee1ccf9cb4b07c80bba99a475942fc6538e3**,97files.
  Prepared detailed next assignment handoffs/PF-R4-geometry-trace.md through
  prepare-stage-handoff using actual local/remote/source/runtime evidence.
  Next metadata commit records this handoff; create inherited local branch
  pf-r4-geometry-trace-local-20261019 and execute immediately, without stage pause.

- Final R3 closure: report39 and evidence/preparation receipts. Final candidate6
  is healthy on5191; approved profile r3-approved-runtime6.private.json in owned
  .scratch/tray-catalog-6089519f-d9e6-45e0-8ef6-f9d8c7792287. API6f7d04e4...
  image65c482531c4d584444567f35069b393b0554236d4aa279357880049a3c033efe;
  web7e59d30f... image09f71fd6039ce971e9322327ca9ca4cff73a42b8f076f99466e4cc4c09763d07.
  Context1276files SHA f927dfb69784c7c2918d398d948ca51fe700e910a87c60c13b25709bd7b60146;
  final1115codefiles match plus2build/test-onlyEOFnormalizations;runtimecodeunchanged.
  Final52files893PASS/0FAIL/5optionalNOT_RUN,
  browserclosure3PASS, both typesPASS,55TSlintPASS.19immutable refs/11Core
  unchanged;23unchanged lockpaths plus previously reconciled R2a drawing wrapper.
  Actualengine10/refusal5/storage4/edge8+session/fencing3/resourcepublicationPASS;
  sampledAPIprocess-tree457793536bytes/54samples25ms isnotexactpeak/maxcapacity.
  Computer-use14scopechecksPASS inclactualconverted6leaves/22fragments/7592vertices/
  8036triangles→13objectaggregate1, page reload, cancel retainingaggregate,
  filledGhost/yellow/Clear and finalreadable300pxcards. UIoldtablefailurefixed.
  Real330trayproject still0rules/0trustedaggregate/0Apply; diagnosticdiscovery
  pausedafter224/1527endpointnameprogress, notfullrealcapacity. Normaldemoaccount
  restored oncopiedrealproject. Noactive root subprocess/capture/build.
  Preservation79preexistingtablesexact plus2strictlyauditedordinaryauthchanges,
  all1032oldlogicalobjectmetadata exact,3originalrepos statuses same,18protected
  containersandPG/MinIO/storage-ready/volumes/networks unchanged.
  Cleaned8unused owncandidate1–4imagetags withoutprune;current6/rollback5retained.
  TwoownedUI/enginefixtures retained withprivateintents forR4–R10;nocablesApply.
  Deniedhistoricalpaths untouched. No push/PR/merge/originalor5190mutation.
  Next: localtechnicalcommit→prepare-stage-handoff detailedR4→inheritednewR4branch
  and executeimmediately. R4mapsfrom3sourceagents delivered read-only;allidle.
  HistoricalR3checkpointsbelowarenotcurrentprofiles/proofs.

- Latest continuation checkpoint: candidate4 is healthy on5191, exact approved
  profile r3-approved-runtime4.private.json in currentR3privatework;18protected
  outsidecontainers/PG/MinIO/storage-ready/volumes/networks unchanged.
  API e611abe7ce21aad05ae44351262a4547cd3e4c33564623ec705becbfb50dd8c2,
  image sha256:a14cf3de9e567c08f17aa48da3658ed32c3e825bd3ab53f34823f8ab3be87a45;
  web9a308feacc23fbcc7b899e5398b46971d28875ef12b63a15181401f6f144649f,
  image sha256:bf4b5a6ff3de6dcb0332082790fcfa28644eb9b778ed10420deec3a20cbf1b3c.
  Actual compiled C# union/control run10PASS:513physicalleaves/2parts,20.5m
  crosspart path, atomicaggregate/currentpointer, replay/cancel/stale/auth,
  noApply. Evidence actual-engine-controls1.json; ownedfixture58490e71...
  retained privately. Additional actual5refusalcontrols PASS:missingparts,
  forgedcategories,foreignscope,on-diskparttamper, MVno_path onControlnetwork.
  Linuxfilesystem4controls PASS: deliberate link-window retry repair and
  ambiguous/tamperedpair refusal; exactcreated scratchfiles cleaned. Notactual
  power/processcrash. Hostnginx6prebody/12MiB/gzipchecks PASS; typed401/413/400/415.
  UIfixture342resourcecopy completed, but first UIload failed atmodule startup:
  preparation-input.mjs absent from explicit browserdeploymentlist. Sourcefix
  adds it and ASTvalidatedbrowsermoduleclosure;3testsPASS. Candidate5build pending
  localSQLtimeout/actualSQLfencing harness sourcefreeze. Rootnginxcasematchfix
  ensuresmixed-caseExpressmount cannotfall backtoold10MiBproxycap.
  AgentsAtransactionbounds/CboundedSQLharness active; rootsoleactualexecutor.
  No new activecopy/seed/build/subprocess. Previouscheckpointbelowishistorical.

- Active R3 branch pf-r3-project-preparation-local-20261019, HEAD881352e403367c7b1e0e4c4d1858f1acb3e1f302.
  Three source agents active: A newstrictDTO/serverplans/sessions/storage/routes;
  B protecteddiscovery/leafslice/merger/controller; C projectmodeAPI/hook/RoutesUI.
  Root existingcatalog/repository/schema/app/engine/worker+ALLactualruntime/docs.
  No R3 schema migration/deployment yet. Root pre-migration read-only baseline
  covers81publictables/10095rows in private r3-before-all-tables2 evidence.
  New cold backup ffb2c4d0-bdc7-41fa-823c-ba428e6adab8 PASS:8members,
  exact archive hashes and pg_restore TOC50808bytes. Full restore NOT_RUN.
  Initial stdin-pipe TOC attempt failed; app automatically resumed, original18
  protectedcontainers unchanged; failure proof retained. Corrected file-mounted
  verifier source-reviewed and actualbackup2PASS. New approved current profile
  .scratch/tray-catalog-6089519f-d9e6-45e0-8ef6-f9d8c7792287/r3-approved-runtime.private.json.
  Old R2a profile has stale starttimes after ownedbackup and must not be reused.
  Root cheap routing-onlycatalog reader implemented;83catalog/policy/scope tests
  PASS, same routinghash and identitydiagnostics withoutdrawingfactbudget coupling.
  Publication adapter/interfaces agreed; enginevalidation mustuseexistingworker
  advisory-ownedserializedlane, not a competing standaloneprocess.
  Root publisher/schema/runtime/router/trustedcurrentpointer implemented;20receipt/
  pointer tests and66engine-lane/session tests PASS. Explicit source-only broad
  run721PASS/5optionalSKIP in39files; initial broad pathfilter accidentally selected
  oldcompiledscratchtests, plus2oldquerymocks needed pointer-awareupdates; failure
  kept in toolhistory, corrected explicitsourcefilelistPASS. Final run pending.
  Effective stagedvalidationinput32MiB (hardunion256MiB retained) +1GiB/session,
  8GiBpreparationdiskquota adopted, not measuredsuccessfulcapacity. B now owns
  off-thread512MiBheap/120s/softwholeNode2GiBRSS unionworker; root adds preparation
  C#oneshotsoft2GiBRSS100mssampling, distinct from exactpeak/hardcontainer4GiB.
  A/C crossreview found endpointprefixtruncation, samekeybusyoutcome, stale replay,
  lifecycle/modelrowfence/planworkbudgets; A authorized targetedfixes beforefreeze.
  C owns source-only actualintegrationharness, root will execute aftercandidatebuild.
  Candidate1 build PASS but startup FAIL beforeDBinit: missing compiled
  viewer-runtime/preparation-input.mjs; public failure proof retained. Fixed
  server:build with explicit owned runtime copy+compiledpublisher import smoke.
  Candidate2 build+EXPLICITapi/webupgrade PASS; own5191 healthy, all18protected
  outsidecontainers andPG/MinIO/storage-ready/volumes/networks unchanged.
  API fbe9675c6f73fe4e88dc23827977f0e3e3d1659f667868308db61aecbb6184b6,
  web f0d991bc840a15041658d816ea92edad21f074f19d630f01f8983ae2b03464e6.
  Approved profile r3-approved-runtime2.private.json in currentR3privatework.
  Currentnewsource differsfromcandidate2: narrow hardlink-crash retry repair,
  exact rawtrayname OR authoritative slashroutecode discovery/validation.
  Actual sourcecatalog BC022-2 vs SDK /BC022-2 justified exactalternatives;
  allcandidates retained/ambiguityexplicit, no casefold/substrings/bindinginvented.
  Finalcandidate3build/upgrade and actualC#union checks still pending.
  Combined872pure/mockedchecks PASS/5optionalNOT_RUN in52files; later targeted
  plans/storage48PASS andcollector7PASS cover abovepostcandidate2changes.
  Root copied onlytemporaryownUIprojectmetadata:56eadef6-8382-49f8-a652-c8f12026602e,
  model098a7e6f-6e39-4935-a98b-ba3b683875a5, purposeSyntheticControl, no cables.
  Hostprivatefixtureintent durable beforeSQL; sourcebusinessmodel unchanged.
  Root resourceCOPY process13920 COMPLETE/PASS:342ownsource→newfixture
  resources439007803bytes, allSHA/lengths/exactinventoryverified in24objectbatches;
  onlythatfixturehealth changed unavailable→healthy afterfinalverification.
  Do notduplicatehelper/seed/copy. Its batchintents/receipts andfixturecredentials
  are private in currentR3work; no businessrows/secrets inGit. Candidate3mustnot
  restartAPI whilethisrootcopy runs (nowfinished). No engineharness executedyet.
  Independentfinalsource-review ofcrashpairrepair/exactalternatives PASS;
  candidate3maybuild/upgrade now. No technicalR3PASSuntilactualunion/UIchecks.
- R2a technical commit e8f786806929efcee90b5386646c3e5566e7d4ee,81files;
  report38 and exact final runtime closure are delivered. Detailed R3 handoff
  handoffs/PF-R3-project-preparation.md is ready via prepare-stage-handoff;
  fresh remote/source map reconciled. After metadata commit create inherited
  pf-r3-project-preparation-local-20261019 and execute immediately.
  R2technicala96e45a/R1d997dca/R009f0e1d retained. No publication/merge.
- Source refrozen after independent report consistency/security review. Final
  combined **622/622 in31files PASS**, frontend/server typecheck PASS,56-file lint
  PASS. Includes exact reportTrays snapshot source, offscreen image rendering,
  cancellation through async generation and verifiedPUT outcome without extraGET.
- Owned5191 upgraded api/web ONLY (--no-deps); PG/MinIO/storage-ready and all
  named volumes/networks retained. API IDa2e930da7a641941a776a552c1b048bc59473c9ad4dc99b020bffa4e1e5e25ed,
  image1ae01697093fa8374af378d16fdacef6158bef167ef419937bd7a309641e8fa0;
  web ID191de419eae68ca3b9826178f984b19a523e0c14a6f3ea058ba29165b481452b,
  image134cce47c50621e7ac39f78d22cbcbd57094798ac3bcc4e1fc65a87556cc6698.
  Private approved profile r2a-approved-runtime4.private.json under owned work
  .scratch/tray-catalog-bebbc6b5-3be9-4e50-930d-3339074393b9. Root alone runtime.
- Verified pre-migration backup038dcba7-048b-4475-928b-e2d7327cd2a1 and separate
  private companion retained. Earlier candidate1 never deployed; two owned unused
  images removed after reference checks. Final whitespace-only cleanup required a
  fresh candidate4 build/update; fresh15controls and53/storage reconciliation PASS,
  protected model reloaded PASS. Candidate2/3 fourunused images also removed.
  Never generic up-all or retire5191.
- Actual **15/15SQL/HTTP PASS**, synthetic cleanup PASS. Real drawing metrics
  **330ready/330proofs/0blocked,19.308seconds**; no route-capacity claim.
  Computer-use13scopedchecks PASS: choices, save/reload/default, same-side pooling,
  two-side divider/single-side none, stale conflict, ordinary read-only drawing,
  blocked layout and retained protected model664556/438156/6 with3tools.
- Final **53-table** reconciliation PASS: old45 +8R2 tables;2143cables unchanged.
  Retained catalog v1 proofs only gain default projection discriminator; one new
  real-project v2 proof +one immutable drawing snapshot allowed. Exact current
  storage inventory unchanged1032objects(3project/3template/1026model).
  All18protected containers unchanged; original/canonical/dirtyoldPF metadata
  matchesR0 and23frozen references unchanged. No expected regenerated.
- Synthetic SQL/HTTP/UI projects/accounts/objects removed. Normal demo admin
  restored; own local logout/login changes authentication sessions only.
  Seven historical denied paths/parents +Tempresidue untouched, no prune.
- Real330trays/2140selectedcables/51types/0realrules/0bindings/0trustedscopes,
 44historicaljobs and13-objectdiagnostic/1527unresolvednames retained.
  S/E/P/gap7/5/10/1 unchanged. No real engineering Apply/invented mappings.
- Fresh yellow/Ghost route execution and generatedDOCX visual render NOT_RUN
  this stage; unchanged Viewer/Core source/inherited evidence separate. R10 must
  include actual report document workflow. Native/user acceptance not claimed.
- No active root subprocess; read-only agent reviews closed. Next apply
  prepare-stage-handoff → detailed PF-R3 bounded project preparation/global
  calculation scope prompt → localmetadata commit → inheritedR3branch → EXECUTE.
  Automation remainsACTIVE; no routine stage pause. R4–R10 still pending.

## Live PF-R2 checkpoint — technically complete

- Current branch pf-r2-purpose-policy-local-20261019, inherited HEAD8f08885;
  technical commit follows report37. R1d997dca/R009f0e1d retained.
- All scoped writers finished and froze sources. Independent read-only final
  source/evidence reviews found no material blocker; stale checkpoint replaced.
- Frontend/server typecheck, targeted lint and **164/164 tests in10files PASS**.
  Actual rollback SQL/refusal PASS; actual SQL/HTTP **21/21 PASS**, cleanup PASS.
  Actual computer-use **13/13 PASS**; real330/6/0, spacing variants disambiguated,
  synthetic save/reload/reset/exclude/conflict/discard/history and engineer rights.
- Current owned5191 API image2097b386515435d50aa1e095e4c12e340b2d2bab71c44707fc85bc89340ad476,
  ID2d24fef0506ad34629dac1da02a97b5834619893eb28714089bcd2499d359f41;
  web image77611de13845a691984a784b4e4d5a7642412ea656b33bb97f4218b9a9cae845,
  IDdcfc3490af572cc23bdd6efc8e0412a18255fee6d2a3a6722f1642bd3595d7f1.
  PostgreSQL/MinIO/storage-ready and networks/volumes retained. All18protected
  container identities/images/starttimes/state unchanged.
- Runtime owner8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46, project
  wfc-pathfinder-local-0cba87606e9b, loopback5191, directory
  .scratch/batched-capture-runtime-20261018-1600. Keep demo/normal admin login.
- Verified pre-migration backup89f25359-4b21-4c8b-b88c-9268a9806522 retained.
  Private work .scratch/tray-catalog-f135b9e0-02e8-40e2-9ae6-5c98b67c1a8a,
  current image binding r2-approved-runtime2.private.json. Old R1 image guards
  intentionally refuse new API/web; never weaken them or generic-retire5191.
- Final whole45-table/business and3-bucket inventory preservation PASS:
  evidence/purpose-policy/final-preservation-1792364617873.json. Real330trays,
  2140selected cables/51types,0rules/0bindings/0scopes/44historicaljobs unchanged;
  all2143existing cables unchanged. No real engineering Apply/native parity.
- All own SQL/HTTP/browser fixtures/accounts/logins cleaned. Three newly owned
  unused images and dead fixture credential removed; current images/archives/
  private proofs/screenshots retained. Historical denied paths untouched.
- Historical FAILs retained: unordered network-array audit, header-only test
  client ECONNRESET and tag-vs-ID image inspection. Each has explicit corrected
  reconciliation/control; no blind lifecycle/build retry.
- Report37 and evidence/purpose-policy contain exact sources/images/results.
  No active root subprocess. Original/5190 checkouts/containers/data unchanged;
  no push/PR/merge/deployment. Automation remains ACTIVE.
- Next immediately: prepare-stage-handoff → detailed R2a prompt/localcommit →
  inherited pf-r2a-drawing-positioning-local-20261019. Implement separate admin
  Left/Right rules, consistent read-only drawing snapshots for existing viewers,
  joint compatible side bundles/divider/metrics/exports. Resolve local overrides,
  export self-invalidation and mixed reads. No R2a edits yet.

## Previous continuation — purpose/revision plan and older-model preparation

The new request is a detailed implementation plan, plus explicitly authorized
Autodesk conversion of the older NWD for later revision comparison. The new
local planning branch inherits `c81328e0c6127d6633d15be51126128e2f8036bd`.
The reviewed plan/prepared handoff and operational checkpoint are committed
locally at `dfd04fd` (no publication). Staged documentation scope7/no raw credential
values/link check3documents9local targets/diff whitespace check PASS.
See [plan32](32-purpose-and-revision-plan.md) and the prepared, NOT_EXECUTED
[PF-R0 assignment](handoffs/PF-R0-purpose-revisions.md). PF-R0–PF-R10, including
R2a, remain PLANNED; no WFC feature code/runtime/database changes are made here.

Final user clarification: Left/Right affects ONLY tray drawings. Same-side types
are jointly distributed into compatible bundles; occupied left AND right sides
get an automatic divider. Existing default sides remain. 3D selected route,
yellow line/Filled Ghost and engineering lengths are unchanged by this setting.
Routing permissions and drawing sides are separate project-wide settings.

The older source is actually verified: 69,785,194 bytes, SHA256
`cf61d87b355b3d77d4c6f71a06183fb1d225cbe1bd937b60783d156aedc4df36`.
Owned isolated conversion work is under
`pathfinder-engine/.scratch/older-model-3bf01791-b0b5-427d-b2f7-4091d39abe3d`.
The current authenticated Free/team/hub/application review is source-bound;
private account captures and credentials stay outside Git. Conversion outcome
and exact verification scope are recorded in the
[older-model report](33-older-model-preparation.md) and its evidence.
The current model is not replaced or imported by this preparation.
Older-model preparation is technically COMPLETE/PASS at 21:09:01.699 UTC on
18 October (00:09 on 19 October locally). Exactly one upload/submission;
173 verified resources / 174,769,843 raw bytes; independently verified ZIP
174,823,508 bytes, SHA256
`a4538444641bfc96ce8915a0ef24c1adfebb50a72c1575a23cc475d9bd781183`.
Earlier COST_EXPIRED receipts are retained. Final read-only invocation
`a7b0c3f6-4574-4adb-9098-134eb141fd04` PASS, 280 reservations / two genuinely
reviewed zero-mutation proofs; old 70 checkpoints reused, no repeated conversion.
Credential-free package session 53578 PASS, zero APS requests. No active download
or packager remains. Public [summary receipt](evidence/purpose-revision-plan/older-model-actual.json)
was generated after reviewed source hashes were rechecked. Keep the package,
source snapshot and private evidence for the upcoming comparison; do not repeat
the upload/submit or import/select the older model as part of planning.

Independent source review of the plan/handoff PASS. New implementation checks,
actual cross-revision geometry comparison and engineering acceptance NOT_RUN.
The older package has not been imported or rendered in WFC. No app feature code
or runtime changes; no new containers; own temporary account tabs closed.
The automatic task remains deleted; the planning request does not restart it.
Next implementation step is PF-R0 contracts, then the actual tray catalog in R1.
Final public documentation review PASS; eight delivered docs/evidence files,
zero raw credential matches, 11 checked local links / zero missing targets;
package receipt/size/counters and Git whitespace checks PASS. No app feature
tests were run for this planning-only scope. Exact final commit is available
from live Git history; the plan checkpoint remains `dfd04fd`.
The old human-only handoff below is historical and does not cover this new scope.

## Previous operational delivery — actual business input and full-model candidate coverage

Stage31 technically COMPLETE on `pf-8-copied-project-recovery-local-20261018`,
implementation baseline `94f83c11747e3ff6d3efb7b8064ef115b364c5df`; technical
delivery commit `e98726e04ce032c86d22a2c791a624e2262cb82b`. See [report31](31-copied-project-recovery.md) and
[local delivery guide](31-local-delivery.md). Root was the sole actual runtime
executor. Source controls174 PASS (auth45/audit48/provenance55/binding18/drill8),
syntax checks and independent16-file source review PASS. Initial drill0/8 failure
was a test-preload defect; its failed evidence and corrected8/8 are retained.

Actual source phase PASS in owned work
`pathfinder-engine/.scratch/copied-recovery-c8f5c134-d041-45b9-ab20-214ff70d30dc`:
backupId `b77a1ed0-2fa2-48a3-92f8-207a60b2035e`,8members/1793208640bytes;
full3model1026resource/1317023409rawbyte audit and30artifact9342710byte inventory.
Source normal bearer/session/descriptor/resource positives before and after cold
backup PASS while valid, exact27+auth2tables/storage3 PASS. Provenance prepare/
seal/verify PASS75files/4148668bytes/exact67-event chain. Source5191 web/API/MinIO
underwent authorized cold stop/resume; IDs/images preserved, start times changed.

Fresh target5192 owner7a64aa2a-88c3-43b9-962d-af391b72300d, project
wfc-pathfinder-local-63ab3043713e restored PASS. T0lossless27/storage3 plus auth
fencing PASS, old bearer401/old cookie410 SESSION_REVOKED before original expiry,
fresh normal admin/resource positive. T1exactly one new owned login/session and
all business/storage unchanged PASS; separate full raw model audit PASS. CUAmodel,
2140cables/1527scope/reload PASS, no mappings/calculation/Review/Apply. Post-UI27+
storage3 PASS; auth explicitly NOT_CHECKED after UI. Exact target qualified, then
retired:5containers/4volumes/2networks removed, lists empty. Source retained.

Final source CUA PASS (`evidence/copied-recovery/source-browser-final-1792350249313.json`),
source final27/storage3 PASS1792350219641 (post-UIauth NOT_CHECKED), wider12PASS
1792350218341/5dce53ce preserves18baseline original/5190 IDs/images/start times,
workflow/checkouts/inputs. All7denied children existence-only checked; no deletion
retry/parent operation/prune. No originalDB content audit is claimed. Needed5191
model/demo/archive/privatecompanion/adjunct/evidence retained. Source screenshot
`evidence/copied-recovery/source-final.png` visibly shows three tools,1527/438155
saved counters and loaded3D. Browser numeric IDs remapped on heartbeat reconnect;
final source selected by exact5191URL; exact retired5192URL page closed.

Next human handoff saved with prepare-stage-handoff:
`handoffs/PF-human-engineering-review.md`. App automation `pathfinder` was actually
deleted at19:07:48UTC18October2026 (tool deleteStatus=deleted); no further automatic
repetition is scheduled. Next actions are human route classification/location
mapping and engineering review. All
1527real names missing/3empty endpoint uses and13-object diagnostic group remain
honest limits; no whole-plant/native or engineering acceptance, no push/PR/merge/
deployment. No useful independent development stage remains without these facts.

## Previous stage30 chronology (historical)

LATEST technicaldelivery stage30 COMPLETE on copied-project branch; [report30](30-copied-project.md).
Actual1527name preparation PASS:6chunks/27278inputbytes,438155of438155SDKrows,
0omitted, one13objectartifact9723d683. NormalMatchall1527missingidentities/aliases/
events,0bindings/jobs/proposals/reviews/Apply/syntheticmarkers. CUAmanualformopened
withoutpoints/saving; reloadpersistssnapshot2140cables+1527counts, rawrulesreset.
Rootactualaggregate7PASS; finalcore4448188/offline13checks4460403 and23table/
3bucket4448755 preservationPASS. Old684metadatarecords exact/342newscopedkeys;
oldQAworkflow/bindings unchanged. Wider12PASS4580754/b40ce9c6 all18baseline unchanged.
7servedchecks4004797,sameproductimages. No originalDBqueries/restarts/publication,
newtestcontainers/images0; all7deniedchildren untouched. Needed5191/project1af0f807
and privateprovenance retained. Next localcommit→prepare-stage-handoff→inheriting
PF8copied-project recovery branch: explicit5191backup, privatehostadjunct, fresh5192
restore/lossless27tables+fencing, retireonlynew5192. Nevercallold defaultdrill/retire
againstsource5191. Human mappings/engineering review remain pending.

Chronological stage30 entries below retain the actual execution sequence.

LATEST continuation: stage29 technical delivery committed at
`3a1a212b3dd5e06930e22c758876db634cebb348`; next standalone handoff committed at
`272b3a025d0ac107c44b1ab6b9b8d3bf20c50965` on the inheriting copied-project branch.
Executing [copied-project assignment](handoffs/PF-3-copied-project.md): additive
local project with2140actual copied cable inputs,50minimal types, exact source
allowances plus approved gap1m, and its own protected normal model import on5191.
Seed/import writers have separate file ownership; independent read-only reviewer
checks frozen source before root alone executes actual mutations. Seed52controls/
syntax3 and four frozen source pins closed. Root actualplan3286531/apply3294599/
ROverify3302360/reapply3313718 PASS; secondapply already_seeded. Newproject
`1af0f807-7653-40ea-8391-7eea6c54e7d4`, private planSHA3ac537e0, own5191 only.
Postseedcore3369438 PASS protectedoldrows; exactnewID/offline8checks3554471 PASS.
Model import50controls/syntax3 and independent4fileclosure PASS. Inspect-only3635228
PASS persistedintent/key, noHTTP/SQLmutation; rootactualimport3771358 PASS with same
private work `.scratch/copied-import-cec74539-2706-4833-b86b-9e3fd11d6469` and same
immutable plan/seedreceipt pins. Newversiona613151e-c370-45c5-80f3-42ae58603b9a,
342resources/439007803rawbytes,b5fingerprint,newprefix,selectionrevision1.
Samejournal explicitresumeverification3839359 PASS, reconciledsameimport/already_selected
at revision1; no duplicateupload/CAS. CUAnewproject2140/2140 observed, active modelready.
Routesselectedactualgroup /BC022-2(425797), LV+Control diagnosticrule; preparation
NOWRUNNING with actual1527names, latest197632of438155SDKrows. Do notduplicate
preparation while active. CUAhandlepfBatchTab tab3 onnewproject5191. Sourcequalification
7PASS4004797, sameAPI/web/runnerimages. Offline8exactaddition/oldrowchecks PASS
3554471. CUAactualDetails7/5/10/gap1 andbothformulas observed; noformwrites.
No synthetic-project marker,
borrowed QA ownership/acceptance, original queries, publication or guessed locations.

LATEST16:45UTC: bounded capture/eligibility delivery TECHNICALLY COMPLETE on
pf-3-batched-capture-local-20261018; [report29](29-batched-capture.md). Final101
runtime+10syntax;53frontend/servercontracts+7affectedTab;28rootAPI/hook;25C#;
12candidateunit+1transportdelta; actualSQL12TEMP/ROLLBACK PASS. Bothasyncowner/
wholeSTART-to-final-auth deadline defects have actual0/2prefixedFAILrepros and
independent source closure. Latercardmarkup2checks/lint. Exactlatestserved7PASS
1792341465579 at ownAPIdce12a1f/web561d51c3, Linuxrunnerfe25497e modeoneshot.
OrdinaryCUA captures13objects/2QAnames,438155of438155SDKrecords/0omitted; reload
cardcounts persist; rawrulesnotrecovered. Firstv1businessbaselineprecisionlimited
nevercomparedasexact. FixedlosslessSQLJSONBtextV2before1792341157585/after
1792341771559 proves2projects/2types/3cables/2selections exactlyunchanged/0added
throughlatestmarkupbuild/start,reload,SECONDcapture. InitialcaptureNOTretroproved.
Wider12PASS1792341663456/4e0de64c preserves18baselineoriginal/5190resources+hashes.
6exactownunusedimagesremoved(logical719154364B,physicalNOT_MEASURED),3ownbadframing
screensremoved. Needednew5191/owner8fffd6b8 project0cba87606e9b retained. CUAown
tab3 remains useful for nextstage; current finalimage prepared-input-scope-final.png.
All7deniedchildren/parentsuntouched; originalDBqueries/writes/restarts0 inthisstage.
Next LOCALCOMMIT→prepare-stage-handoff→newinheritingbranch forcopied2140cable
project with ownnormalmodelimport/storage; explicitactualDetailsS/E/P+gap1.
No originalreread/native/APSrequest needed. No borrowedQAmodel/syntheticflag/guessed
aliases/coordinates/engineeringApply. Actual1527missingkeys still humanmappinggap.
Continue useful independent seed/browsercoverage, no routine pause or publication.

Chronological entries below retain earlier IN_PROGRESS states, superseded above.

NEXT IMPLEMENTATION ACTIVE: branchpf-3-batched-capture-local-20261018 inherits
actual-input deliveryd2c2d0178fb2b58617bfd4ea4039c38b9d00fa69, handoff
6761cb76df79392befba6ace1c4d8c685b36cfdd at [bounded capture assignment](handoffs/PF-3-batched-capture.md).
Runtime/protocol shared interface is being agreed before overlapping edits;
known-hidden SQL region/test owner released. No new runtime/DB action yet.
Original/source/private input preservation constraints persist. Next source/UI
batching and durable honest provenance, then isolated focused/runtime checks.

Live16:10UTC update supersedes prior preparation wording: three writers active
runtime/protocol and frontend/capture provenance, candidate SQL nowfrozen with
12unitPASS +1newtransportcontrol/type/lint. RootC#strictoptionalinputscope25PASS
at csharp-input-1792339199298; API/hook28PASS actual new final28testJSON retained
privately, compactreceipt pending. Beforeupload cancellation/localguard/fresh
server model/registry/cable-endpoint dependency guards added; acceptedinflightPOST
retains authoritative saved identity and previousscope/dirty notice as before.
One NEW owned5191restore is running: projectwfc-pathfinder-local-0cba87606e9b,
owner8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46, runtime
pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600. Old archiveAPI/
webimages only; newsource NOTBUILT/NOTACTIVATED yet. Restorerotation/fencing/
inventoriesPASS in runtime-baseline1792339580221. No original/5190 lifecycle.
Fresh local C#runner for runtimeinterop: capture-runner-3e6108f3-8bbd-497c-b2fe-
3e3c1017c02d/runner/PathFinder.ModelRunner.dll SHA5d84d7799eb95d441b427568d67f2af82a61bdc09b5420432ead7915ebb5fe97.
Candidate actualSQLdriver NOTRUN until ownsourcebuild/rootrelease; integration.mjs
wrapper is source-reviewed with strict ownership/compiledhash/SQLidentity guards
and raw-before-assert deadline capture. Next runtime/frontend focusedtests/source
freeze, finaltypes/lint/ownbuild/start then actualSQL and computer-use. Keepactive
agents' edits; do not duplicate capture or restore. All7deniedchildren untouched.

Technical delivery COMPLETE at scoped evidence: [report28](28-current-input-coverage.md).
Final guarded read-only copy PASS:2140actual cables, exact same project UUID with
observed name HPU Aalborg2023/number P230039 / H.7500062; active fingerprint b5bb4fbe
and five resource pins agree. Before/copy/after four projection hashes unchanged.
Source final45controls+3syntax PASS; first endpoint-formatter FAIL and abbreviated
project-name FAIL remain historical, followed only by separately reviewed diagnostics.
Actual full214part/PDB audit PASS_WITH_GAPS:1527normalized AND raw-trimmed distinct
keys, all1527missing/0unique/0ambiguous, three empty uses. Actual category mapping
332MV/257LV/1551effectiveControl; no unknown. PDB diagnosis115actual objects and
52retained SDK property arrays agree with pinned SDK; no decoder mismatch observed.
Business labels/full rows remain private ignored scratch. Wider final preservation
12PASS1792337673384/300f2f34 plus narrow original fourgroup proof; no original writes,
new containers, import, jobs or Apply. Seven denied children/parents untouched.
Next useful independent implementation: bounded name-chunk collection in ONE capture
and ONE scan/snapshot/upload, durable input-scope provenance, unchanged security/
geometry/time/message limits, and known-hidden SQL exclusion BEFORE LIMIT/ambiguity.
Manual mapping/engineering review remains required; zero names matched is not solved
by changing punctuation/fuzzy matching. Preparing next inherited local handoff now.

The following entries retain the chronological investigation, superseded by the
actual final scoped outcome above:

Newinheritingbranchpf-3-input-coverage-local-20261018 at technicaldelivery
de093daf26531cfbedf3d12a3a52f5d8a3f136a1. Self-containedassignment
[PF-3 current inputs](handoffs/PF-3-current-input-coverage.md) prepared with
prepare-stage-handoff; userstandingauthority executesit immediately.
Actualmetadataendpointbound(host.docker.internal5434→PG172.17.0.2:5432,wfc_app),
sourcecontrols33/syntax3/source-onlyreviewPASS at0fa4a1source. Candidate48controls
+1metadata-deltacontrol/source-reviewPASS. Originalproject/businesscounts/MTO/
model-link UNKNOWN. ParentreleasedoneROOTcopy: actualsource-copy1515Z FAIL
SOURCE_SQL_SERVER_IDENTITY beforeanybusinessreads, raw146B/failuremetadata565B
durable; exactmismatchingpredicateNOTPROVED. PreserveFAIL/nounchangedretry.
Writerpreparingoneidentity-onlydiagnostic(no project/model/cablequeries) with
sameRO/endpoint/watchdog; rootsoleexecutorafternewreview/controlfreeze.
No guardrelaxationuntilactualfacts; candidateactualauditstillNOT_RUN.
DiagnosticnowOBSERVED source-identity1521Z/ce997e9c: raw172.17.0.2/32,
host172.17.0.2,expecteddbwfc_app/port5432/ROanddefaultROon/repeatable-read/
transportfalse; no businessqueries. AuthorizeminimalSQLhost(inet_server_addr())
comparisonformatterfixwithoutchangingexpectedidentity/ROguards. Sourcewriter
newcontrols/reviewerexactdelta, thenROOTsolecorrectedcopyfreshwork. Neverretry
firstfailedccf beforefile oroverwritehistoricalreceipts. Stillnocablesnapshot.
Correctedformattercopy1524Z passesSQLendpointthenFAILSOURCE_PROJECT_IDENTITY.
Boundedproject-onlydiag1529Z proves SAMEpinnedUUID0c... storednameHPUAalborg2023,
numberP230039/H.7500062; soleHPUAalborgprefixof3discoveryrows. Rootresolution
project-identity-resolution1530Z retains SAMEscreenshotUUID, exactobservedfull
name+number(no originalrename/switch). Source+candidatewritersupdateonlyexpected
pins/tests; source-onlyreviewthenROOTsolefreshcopy. Modelb5fingerprint+5resource
guardmuststillpassBEFOREcables. BothactualFAILsremain. BusinesscopystillNOTRUN
successfully, actualcandidateauditpending. Otherdiscoveredprojectlabelsprivate.
Thisstagepermits narroworiginalreadonlySQL after verified backend/PGidentity/
connectionendpoint/read-onlytxn guards; never app/config/dbbootstrap,original
writes/import/Review/Apply. Privateengineeringrows ignored, compacthashes/counts
onlyinGit. Originalconnectiondefaults are not observations. All7deniedchildren
andparentsremainuntouched; no newcontainersneeded. Parentdocs/coordination,
separate source-copy/alias-auditwriters and readonlyreview. Nextfirsttoolcontrols,
independent sourceguardreview, then boundedactualreadcopyifprerequisitespass.

## Latest delivery — fresh UI data-preservation investigation

Technically complete on `pf-8-ui-preservation-local-20261018`, inheriting coverage delivery
`7aedfe0b0b14b38ba58bc20ef40599403d4114c6`. New self-contained assignment
[PF-8 UI preservation](handoffs/PF-8-ui-preservation.md) prepared through
prepare-stage-handoff. Existing5190/source resources unchanged. Runtime writer
owns new audit/tools/evidence and fresh5191 lifecycle; parent docs/CUA. Actual
A0beforemount/A1afterautomaticwork/A2preview/A3Clear were saved before
assertion/retirement. Automatic proposal additions are
permitted only with exact current-job provenance, never mistaken for Apply.
Source review tightens contract: all existingproposalrows immutable; stale/canApply
DTOonly. RealQA manualaliases/bindings alreadyexist so registry staysunchanged.
Preview persists pf_jobs(kindpreview)+pf_lookup_results, no pf_previews table;
Clearlocalonly/nocancellation. Alljob/item quiescence spans>15s auto scan.
Do not rewrite stage25's historical FAIL_NOT_RETAINED as a new PASS.

Actual four-phase qualification nowPASS at APIe0a6d742/web5abc6002:
34controls/source-reviewedhelpers, A0rawsavedbeforelogin; A1adds1currentauthorized
calculatejob/item/proposal(designreuse) only; A2adds1previewjob+lookupresult only;
A3zeroall12workflow+6auxdeltas. Stablewindows span>15s;24aggregateraw/diff/artifact
checksPASS, exactqualifiedLinuxrunner4b940d5c/worker1c53eae0/session5d0dfe63 reused.
Allreceipts under evidence/ui-preservation; see report27. Currenttarget
wfc-pathfinder-local-f673a0facba3/owner7fa65ffa-ef34-46a7-b4c1-55cd19f8fa74
was retired only after complete evidence and parentdisposition1447Z; ownCUAtab
closed. ActualstaleClearcaption corrected by exactly3frontendowner-loss
setNotice(null) calls;5selectedUITests/types/lint/source-reviewPASS. WEB-ONLY
build577e/APIunchanged; C0zerochanges/C1onepreviewpaironlyPASS,5bindingcontrols.
NewbrowserClearcaption/draftsPASS. CalculateoccurredwhileViewerloading so
new577eGhostrenderNOTASSERTED; prior5abcGhostproofretainsitsownscope.
Gatedcleanup5containers/4volumes/2networks/3unusedimages(logical294832567B,
physicalNOT_MEASURED). Finalprimaryaudit12PASS1792335003878dfe1b66c;
all18baselineidentities/5190workflow/sourceinputsunchanged. Sevenpreviously
deniedscratchchildren+parentsuntouched/no retry. No originalDBqueries inthisstage.
Next: localdeliverycommit, prepare-stage-handoff for PF-3actualbusinessinput/
fullmodelnamecoverage on newinheritingbranch, then execute. Currentbusiness
project/count/MTO/model-link UNKNOWN until narrowlyverified originalreadonly
snapshot; templaterows2027areonlycandidate/noHPUprovenance. No Review/Apply,
originalwrites, publication or deployment. Humanengineeringacceptancepending.

## Latest delivery — retained coverage audit

SCOPED_TECHNICAL_PASS on `pf-2-coverage-local-20261018`, inheriting local worker delivery
`25e49401a7eca4117bbb261208be00bc92a7b36a`. New assignment
[PF-2 retained coverage](handoffs/PF-2-coverage-audit.md) prepared through
prepare-stage-handoff and executed under standing authorization. No activation
of session mode on5190 or new runtime is included. Actual audit
`evidence/coverage/audit-1792332295000.json` passes6scopedgates:214parts/
152879123bytes/438155objects/664556uniqueassociations,1root/depth14,
selected52objects/26LV+Controlleaves/all99fragments/10completechosenroots.
Actual43controlsPASS with TAP; independent source review closed at7afc8b8f.
All52selectednativevisibilitystates unknown; equipment-rolecount0. RealQAFrom/To
rawnamesmissing but2manualbindingscurrentagainstretainedartifact; thirdbinding
stale. Synthetic2cablesprojectfenced/currentartifactunknown, repeatedaliasesreuse
sameprojectlocations. No businesscoverage/fullplantgeometry/capacity PASS.
Independent exactPDBobservation identifiesmapped-only388764; rootpresent,
all438155retainedexternalIDsmatch; runtimeomissioncauseunproved.
Report26 records exactscopes/9.167s/604778496Bpeak/cooperativeguards and historical
fixturemkdirfailure. No app/Core/Model/DB/runtime/input mutation.
New seventh denied child: pathfinder-engine/.scratch/coverage-controls-14b7cdcb-10cb-4ad5-a8d4-a1962a8f0ea7
(406-byte failedsetupmarker), one removal rejected blocked by policy beforeprocess.
Do not retry/bypass/deleteparent; receipt cleanup-refusal-1792332352021.json.
The proposed cleanup-result file does not exist. Finalcontrolfixtures retained
as needed evidence; no Dockerresourcescreated for this stage.
Next independent proof gap: investigate stage25 post-UI unexpected comparison on
a fresh own restoredtarget as NEW evidence (never recovery of lostobservation),
save before/after/diffs before assert/cleanup. Root prepares next handoff/branch.

## Latest checkpoint — private worker reuse delivery, 18 October 2026

Implementation is complete at scoped test coverage, but the delivery is PARTIAL:
final restored5191 post-UI workflow comparison is FAIL_NOT_RETAINED. It reported
a mismatch; its full object was not saved before an assertion, and the operator
then retired the owned target without gating on that result. Do not infer a final
target noApply/database-equality PASS or recreate it as if that recovered evidence.
See [report25](25-private-worker-reuse.md) and
`evidence/session/cleanup-checkpoint-1792330908283.json`.

- Current branch `pf-2-worker-reuse-local-20261018`, baselineed0770f3; delivery
  commit follows final inventory. All production source is frozen.
- C#308session/42one-shot, Node61affected/types/lint, methodology23, profile19,
  actual network-none210 controls PASS at their bound exact source/binary scopes.
  Unchanged pinned Core/Model; graph remains per query. No raised limits.
- Corrected restored-target job10, operational21individual controls, actual
  interrupted64batch9 and read-only closure7 PASS. Historical failed aggregate
  receipts remain. Crash attempt2/all64unique/recovered29.001s, install preserved;
  exact replacement-owner UUID not retained. Current authority/dependency fences
  remain. Healthy advisory ownership and already-lost DB session have different
  safety claims; no global quarantine claimed for a lost DB session.
- Actual computer-use on final candidate confirms protected model, English three
  tabs, real35.30345579516123m/design45, filledGhost/route colors/yellow and Clear.
  Screenshots saved; own browser tab closed. No Review/Apply UI request.
- Only target5191 was retired:5containers/4volumes/2networks. Exact Linux runner
  and compiled PF modules retained first (50files/851629bytes). Final cleanup
  `evidence/session/final-cleanup-1792331030292.json` removes4unreferencedownimages,
  479405178logicalbytes (physicalreclamation NOT_MEASURED); finalsourceinventory
  saved. Never touch the six denied children or their parents.
- Separate final primary5190 preservation PASS12 at
  `evidence/worker-reuse/preservation-1792330963032-1cb78243.json`: all12workflow
  groups/counts, all18baselinecontainer IDs/images/start times and source/copy
  bytes preserved. Fresh original/Core/PF0/native5-group isolation PASS at
  `evidence/pf2/isolation-1792329686848.json`. Neither repairs lost target evidence.
- Current5190 remains old APIee402/web1895/defaultone-shot. No activation,
  original checkout/app/data update, realApply or remote publication occurred.
- Next independent work: bounded retained whole-hierarchy/name/fragment coverage
  audit versus52selectedobjects/26leaves, and actually supplied3QA endpoint/registry
  records. Native comparison not mandatory by user decision; engineering review
  pending, globalgraph and fullplantgeometry/capacity still open. Save a traceable
  handoff/new inheriting branch, then execute immediately. No invented categories,
  business cables, source proof or wholeplant PASS.

## Historical worker development checkpoints

IN_PROGRESS, branch `pf-2-worker-reuse-local-20261018`, inheriting completed
capacity commit `adcb55da93564571deb0a5bc11ef9921c54c0a53`. The next self-contained
assignment is [PF-2 worker reuse](handoffs/PF-2-worker-reuse.md), prepared through
prepare-stage-handoff under the user's automatic continuation instruction.
Read-only feasibility is complete and the shared private protocol is acknowledged.
C# and server modules are implemented and source frozen; restored-target runtime
qualification remains in progress. Current5190/original resources remain unchanged.

- Initial C#151/165 and later303/303 session checks PASS at their intermediate
  bytes, final-pre-review DLLd54d1463...,31semantic corpus cases,3actual64request
  retirements; separate one-shot42/42 PASS againstthatDLL. Server53/53 cases,
  types/scopedlint including parentindexshutdownstatusfix PASS at pre-reviewscope.
- Both cross-review gaps are corrected and final source frozen at12:41UTC:
  first-byte activity rejects partial pipelining before any result publication;
  Node checks cancellation/original deadline again after retirement join.
  Final C#308/308 session checks,31semantic corpus cases and42/42 one-shot PASS,
  DLL0a421550ac7e01a7e4659a543927cb5fd20eacac7a9cc687cc08c812a5b8c56a.
  Final server55/55 affected checks/types/scopedlint PASS, engineSession source
  SHA5cfa14c83dd0566009baecaf757ed1698f0c339043faaff48b24d36eb84a4513.
  See evidence/worker-reuse/runner-source-final-20261018T124105Z.json and
  server-cross-review-closed-20261018T124041Z.json. Failed/intermediate receipts
  remain historical. Runtime qualification hold released; no math/wire/Core change.
  Independent C# closing review PASS/no remaining material finding at
  evidence/worker-reuse/cross-review-closed-1792327496205.json.
- Actual production-source Linux age qualification completed PASS4/4 after
  601071.96ms observed elapsed; old group reaped/new lane.
  Final five actual modes total210checks PASS:117mixed,77policy,4RSS,4age and
  8correcteddeadline. The actual warmed1ms request was dispatched and returned
  deadline_exceeded; separate no-response fixture proves the Node hard deadline
  at1600ms and subsequent real-runner recovery. All five final containers and
  the retained historical label-collision attempt are retired. Public bound
  receipts: evidence/session/summary-1792328175307.json with raw results,
  orchestrations/source manifests. Harness15/15 pure controls PASS at the owner's
  recorded source scope. Restored5191 first job-driver10/10 controls PASS against
  API323f876a (256owncables/9jobs, auth/settings/active-owner rollover/cancel and
  noApply/noReview/seed+copiedreal preservation). These are scoped historical
  bytes; publication of exact raw/source receipts is in progress.
- Actual advisory-backend termination found a material production lifecycle
  failure: targetAPI323f876a exits1 on unhandled repeated pg Client error after
  uniquely identified ownPGbackend438 was terminated. Original target-ops failure
  and sanitized context are preserved under evidence/session/. The same receipt
  separately proves exact rebuiltDLL4b940d5c real35.30345579516123m/design45,
  fullDTO repeat and memory reuse before the lifecycle failure. No graceful stop,
  quarantine or crash gate PASS is inferred. Only restored5191 is affected/stopped.
  Minimal worker listener fix is frozen at3ce7708d, repeated-error/terminalclose
  regressions61/61/types/lint PASS; independent closing review no materialfinding.
  See evidence/worker-reuse/pg-owner-fix-1792328904528.json and
  worker-owner-listener-review-20261018T130804Z.json. A healthy retained advisory
  session blocks other owners; an already-lost session cannot hold its released
  DB lock, so only same-worker stop/publication fencing is claimed in that case.
  Corrected5191 API5cd3eca8/web4d6022fa session readback PASS; unchanged driver
  retake10/10 PASS at evidence/session/job-controls-corrected-1792329096322.json,
  fresh256owncables/9jobs, previousrows/seed/copiedreal12groups preserved.
  Runtime ops hold released for actual new-candidate lock-loss/stop/crash retake.
  EngineSession/C#/Core/Model remain frozen; previous210 measurement checks retain
  their original exact source/binary scopes. Final browser/audit/cleanup pending.
- Corrected actual ops now pass21individual gates (real semantics, advisory
  connection loss/API healthy/group join/no reacquire5.2s, explicit restart,
  graceful exit0/507ms/advisory release/namespace reaping). Aggregate
  target-ops-1792329135705.json remains FAIL because the old64helper misses its
  active observation window (NOT_RUN, no crash). A separate faster observer
  actually KILLed a batch observed0/64+activeitem+exactpair; persisted state was
  RUNNING4/64 between items, but its overly strict runningItems>0 assertion
  aborted before recovery and finally cancelled the job. Raw
  crash-once-1792329339791.json remains FAIL; no recovery PASS inferred. The initial
  runtime inference 'already completed64' is explicitly corrected by full raw read.
  Root authorizes one new evidence-supported harness retake: unfinished durable
  batch may be between items after KILL, but must retain exact pending counts/
  owner/attempt and naturally recover to64unique results without lease edits or
  fake engine delays. Existing64fixture reused/new explicit job. Runtime owns
  scripts/pathfinder-session/ only; browser waits for closure. Three-original-cable
  location/model metadata copy is retained for the next bounded coverage audit.
- Restored-target lifecycle gates remain separate from the completed networkless
  process qualification; restored job controls are pending.
  Extra5191 direct restore from retained3db9fa33archive and session mode readback
  PASS at evidence/session/target-startup-1792327913104.json, API323f876a/web511ba97e.
  Target Linux build DLL4b940d5c differs from host0a421550 build metadata; source
  bindings and actual target semantic checks are separate gates, not binary parity.
  A bounded actual deadline control was repeated after a receipt-helper label
  collision; original result/attempt preserved, final8/8 PASS, no production fix.
  Parent affected Compose/profile19/19 controls PASS at
  evidence/worker-reuse/parent-profile-checks-20261018T1252Z.json.
  C# design intentionally has server-side snapshot
  validation; lookup-plan needs no snapshot. Do not claim every C# operation
  rehashes geometry. Current5190/original resources remain unchanged.
- Runtime test-only MemoryLane fixture builds0warnings; actual512MiB guard branch
  passes at the explicit fixture scope above. SDK first-run logged certificate installation/ensure; filtered
  read-only current certificate is older(29July), no prior store inventory so
  actual creation is UNKNOWN. No key access/removal; later builds suppress
  generation. Receipt: evidence/session/sdk-environment-1792326425587.json.

Existing heartbeat `pathfinder` was updated/resumed through the app tool at
12:19UTC, preserving its10minute schedule/name/target thread. Its prompt now
points to this branch/handoff and all six denied children. It stays quiet on
unchanged/nonactionable state and checks active agents before any continuation.
Current direct implementation continues; this is recovery scheduling, not a
second concurrent stage or proof of completed worker qualification.

- C# owner: ModelRunner/session +runner tests only; server owner: private session/
  worker injection/tests; runtime owner: separate session test/orchestration and
  coordinated isolated mode profile; parent docs/evidence/integration.
- One lane, unchanged pinned Core/Model and per-query graph, exact private framed
  request/response/handshake, one prepared identity, hard supervisor/Node deadlines,
  bounded count/age/idle/RSS and no hidden queue/replay. One-shot stays default
  pending varied-query/parity/security/lifecycle gates. Current caps are not raised.
- Next: finish restored durable job authority/dependency/lease and operational
  lifecycle, actual target-binary real semantics/browser checks, then final
  preservation/cleanup and local delivery. No real review/Apply or whole-plant claim.

## Latest delivery — PF-2 capacity baseline, 18 October 2026

SCOPED_TECHNICAL_PASS, committed `adcb55da93564571deb0a5bc11ef9921c54c0a53` on
`pf-2-capacity-local-20261018`, inheriting
`8a726f72ab94da22681320f28ccebe1224cf8eb3`. Current user requested the next
remaining stage. The original PF-2 item5 still requires capacity measurement;
previous manual-review handoffs do not waive that technical remainder. This is
an additive bounded benchmark, not a speculative stage or engineering acceptance.

- New assignment: [PF-2 capacity baseline](handoffs/PF-2-capacity-baseline.md),
  prepared with prepare-stage-handoff and separately authorized for execution.
- Ownership: C# agent only new CapacityBench tool; orchestrator agent only new
  scripts/pathfinder-capacity/; read-only input owner fresh scratch/provenance;
  parent docs/report/integration. Preserve shared changes.
- Verified additive build0warnings/errors and self-test3synthetic datasets/
  21phases PASS at final DLL90c939476155552bf3be27bbee29e09e220e159c16996fa30dcde4f997691b2a.
  Root17/17 malformed/hash/identity/purpose/limit/path controls PASS against
  those exact bytes; all preflight refusals preserve absent/existing workroots.
  Read-only copied-input provenance PASS with source SHA b4736540... and all
  12workflowhashes/18containeridentities unchanged at extraction scope.
- Actual five datasets/65direct phases/50direct queries/15one-shot queries and
  four process controls PASS. Full unrounded route/design/category match, including
  saved real preview35.30345579516123m/design45m. Node28guards/syntax PASS.
  Source API imageee402 unchanged; own networkless temporary containers retired.
  Initial omitted-false guard refusal and outer mount-order falseFAIL retained;
  new metadata-only normalized preservation amendment PASS, no math rerun.
  Real one-shot disk-warm mean1.200s(2) vs identical-query same-model median
  0.749ms(8) have different cost scopes; no deployed speedup is claimed.
- Final preservation PASS:12workflow hashes,18container identities, source/copy/
  manifest/reference bytes, all original checkouts/dirtyfiles/Core/PF0/native pins.
  See [report24](24-capacity-baseline.md) and its linked exact receipts.
- Work uses copies of own5190 selected real planning network and explicit new
  synthetic inputs. No live settings/jobs/Apply, no API restart/code change,
  no Core/limit changes. Whole-plant completeness/capacity remains NOT_RUN and
  reusable graph NOT_IMPLEMENTED. Native comparison remains not required by
  user; engineering manual acceptance PENDING. Heartbeat remains PAUSED while
  this direct authorized continuation is active.
- Cleanup:10,010,214bytes redundant own control copies removed. Removal of two
  superseded own scratch directories was rejected by automatic approval review
  `blocked by policy`;2,502,799bytes remain,0deleted. Never retry/bypass/remove
  parents of capacity-bench-build-6134b7566e7a43c9a3bd05843a30018f or
  capacity-bench-selftest-0e06d25a9f8c459594fe6a376c0660ee under engine/.scratch.
  These join the four previously denied children; all six are retained.
- Next: local commit of completed additive delivery, then prepare/execute a bounded
  private-worker reuse handoff if read-only feasibility preserves all current
  per-request/cancellation/cache/resource/auth guarantees. Measurement supports
  investigating repeated process/JIT/cache-restore overhead, not a Core fork or
  an assumption of mixed-query equivalence. User's routine continuation is authorized.

## Previous delivery — independent Path lookup, 18 October 2026

IMPLEMENTED/VERIFIED in the scoped local delivery on branch pf-path-lookup-local-20261018 inheriting
9e6561e33ccf9ab535fb2184c858ecd20240071d. User requested the third addon tab
and its functionality. Canonical source shows that this lookup independently
discovers requested visible logical routes, rather than using Routes assignments.

- Root owns API/hook/tests/docs/computer-use. Backend owner server/** and scoped
  nginx transport. Viewer owner Model/ModelRunner/capture/protocol/Controller and
  related tests. Former runtime owner currently owns only the three frontend
  tab/lookup/test files. Preserve concurrent edits; no partial-image builds.
- Flow: POST /lookups/plan uses pinned C# parser; protected bounded lookup capture
  discovers broad SDK name candidates; C# owner resolver filters exact logical
  owners, nested wrappers and ambiguity; new lookup-purpose artifact/job remains
  separate from planning. No registry bump, binding changes, planning promotion,
  cable proposal/Apply writes. Project Details owns gap. No design allowances.
- UI has Routes/Path/Path lookup with one protected Viewer, independent dirty-rule
  lookup, shared transparency, exact points, Reverse extension, Restore/Cancel,
  retained drafts and stale-response/review fences. Actual UI verification PASS.
- Current frozen source checks: root API/hook23/23 PASS (initial22/23 cancellation-message
  failure corrected with explicit AbortError); Model lookup37/37 plus legacy94/94,
  protected Node75/75, Controller20/20, Runner42/42 PASS. Initial Node interop used a historical DLL;
  fresh isolated DLL rebuilt and full affected suite passed, no source fix inferred.
  Backend106/106 focused controls PASS including actual Express transport and
  five fresh private C# worker calls. Types and scoped lint PASS. Frontend44-case
  baseline regression plus9final affected and1caption case PASS at their exact
  recorded scopes; this is not one full47run. Human acceptance remains PENDING.
- Source60e9ce6 built/started own5190 API1630510e/webf4b5a13. Actual scoped10/10
  API integration PASS, including13,201,771-byte nginx upload, purpose/auth/gap
  fences and cleanup. Real-project workflow baseline unchanged (registry11,
 104modelobjects,5proposals,3reviews,0Apply). Browser first forward/reverse lookup
  produced35.30345579516123m,4gaps/.9840583861033791m,25usedleaves with Ghost and
  protectedyellowline. Actual dirty-rule independence/Pathfences/Restore/Cancel
  PASS. Both reverse90point arrays exactly reverse forward. All12 workflow hashes
  unchanged; latest final job06c0b624-2d84-432e-9f1d-1c6f23cc4f6c, cable revision0,
  routing/design/installnull and0Apply. Final read-only audit is dated10:03UTC.
- Browser found one inaccurate caption: used leaves were labeled as all prepared
  geometry. Text-only correction73c13aa58519f26cbb96d93bbbb70bcdd5bb2cdd passes
  affected1test/types/lint; source828 manifest SHAc3a58fd623df881da39fa8f043a6260eb93ca3f989d938089a15015de958f2d7.
  Built/started APIee402f8d/web1895a3fa and final corrected browser PASS. API16
  filesystemlayers/fullConfig match actual-tested1630510e exactly. New verified
  backup3db9fa33-c10e-4646-82bc-fe99f3d8af35 is at
  pathfinder-engine/.scratch/path-lookup-archive-462d5a9465e8 with separate private
  companion. Archive/restore/session/newlookupreadback/targetretirement PASS;
  oldd7payloads1,348,954,278bytes and4unusedownimages retired. Extra target zero
  containers/volumes/networks. Both new crash tests deliberately NOT_RUN.
- Supplemental combined health/startup-receipt command was rejected by automatic
  approval review `blocked by policy`; it is not retried/bypassed. No startup JSON
  was produced. Actual successful runtime CLI start, build binding and separate
  10/10 API integration are the stated evidence.
- Final five-group preservation audit PASS: evidence/pf8/isolation-1792317744025.json.
  Report23 links all scopes, actual images and exact changed paths (59checkpoint
  files,45code/test/config paths; later docs/evidence only). No original update,
  publication, real Apply or user engineering acceptance performed.
- Next: actual human review in handoffs/PF-path-lookup-manual-review.md, prepared
  via prepare-stage-handoff. Existing heartbeat updated through app tool and
  remains PAUSED with schedule/target preserved. No routine unchanged reruns or
  invented stage. User feedback/main integration are separate decisions.
- Three prior denied cleanup children and parents remain untouched. A fourth,
  newly owned compatibility scratch removal was rejected by automatic approval
  review with `blocked by policy` on18October2026: `pathfinder-engine/.scratch/lookup-model-compat-459be54639f5400ebe91f856c64d7f5a`.
  It is retained; do not retry, delete its parent or bypass the rejection.
  The shell overwrite of the old handoff was also rejected; it was preserved and
  a new additive handoff was created with the file-editing tool. No rejected
  command retry, preview crash retry, native licence attempt or frozen PF0
  generator rerun occurred. Broad discovery4096objects/64MiB and other bounded
  limits remain; live no-planning-history case NOT_RUN, native comparison
  NOT_PERFORMED/NOT_REQUIRED_BY_USER, wholeplant/reusablegraph/crosscomputer and
  offline-disconnect limitations unchanged. Human engineering review PENDING.

## Previous delivery — Routes + Path, 18 October 2026

State: scoped local delivery IMPLEMENTED/VERIFIED; source/API/browser/combined
backup/restore/session/64-cable recovery/cleanup PASS. Extended preview exact-job
crash recovery NOT_RUN (PARTIAL extension). Human route/length acceptance PENDING.

- Worktree: C:/Users/todor.chankov/source/WFC-pathfinder-local, branch
  pf-two-tabs-local-20261018, inheriting fcd8f1dc39569c430125b897c95756fac9c28a89.
- Source: feature46152f9; appearance/caption542e101; final immutable-metadata fix
  cb02f43000a51b4f511346d2aa666d09929570e0. Source writers frozen.
- Live own5190: API7d216f20 / web36d9e4d6; exact binding in
  runtime/two-tabs-final-candidate-health-1792312921278.json. Source manifest817,
  SHA330b195d97b089e2c2cd063af96155dd513166a9711392a25dfa753df3777275,
  evidence/pf7/sources-1792312859326.json.
- User explicitly chose Routes + Path; outer label Path Finder. Routes supports
  newest category rules, explicit exclusion, deepest descendants and native
  bounded names. Path supports named/point/selection standalone preview/reverse,
  trigger/vertical preferences, shared locations, existing cable calculations and
  explicit Review/Apply; ordered lookup remains advanced. Previews create no fake
  cables or Apply. Details owns gap1m and all three design allowances. Core11 pinned.
- Changed modules: PathFinder*.tsx/tests, API/hook/outer tab/Details labels,
  server/pathfinder and router, protected Viewer protocol/Controller/capture/path,
  small Model DTO/reader/cache boundary, runtime recovery helper and docs/evidence.
- Actual source checks: backend69/69 after metadata fix; frontend36/36 full run
  plus focused callback/caption checks; root24 initial and18 final API/hook;
  Viewer60 final correction + original capture19/Controller19/legacy guards;
  Model94 and runner zero warnings/errors. Types/lint PASS at recorded scopes.
- First actual candidate29/29 PASS. Appearance75/0 and stale save caption failed
  in its browser run, then were corrected. Corrected542 backend27/29 exposed
  optional metadata loss during design reuse plus an over-specific concurrent
  gap assertion. Failed receipts remain intact. Final cb02 actual29/29 PASS;
  strengthened gap proof records fresh full-calculation contributor. Cleanup PASS.
- Actual computer-use: two tabs/keyboard/one Viewer/retained drafts; ten-root
  capture52objects/26segments; category edits/dirty/discard; exact selectedpoint;
  stale binding refusal/reconfirmation; standalone forward/reverse35.30345579516123m,
  design45m; Review enables Apply and tab change resets it. No real Apply.
  Corrected original-material75/0/100, defaultfilledGhost/yellowline/Clear PASS.
  New path resets defaultGhost. Saved caption confirmed. Finalcb02 fresh reload
  and protected path/Zoom PASS. See evidence/routes-path/computer-use-*.json.
- Real demo cable revision0, routing/design/install null, Apply0. Current artifact
  proposals retain Control/26segment diagnostics. Historical stale-artifact optional
  metadata is not backfilled; required frozen provenance remains available.
- Final operational receipts: runtime/final-drill-1792313480874.json,
  cleanup-1792313736971.json, two-tabs-final-health-1792313808306.json. Verified
  archive d7d63dce-4549-4e78-9bc5-7ff6a9eddc7b at
  pathfinder-engine/.scratch/pf-two-tabs-backup-20261018-0847 retains
  1,348,954,278payloadbytes/private companion. Restore/session/actual64cableworker
  recovery PASS; preview queuedcancel/no-workflowwrites PASS, same-job recovery
  NOT_RUN because observed job advanced before KILL. Extra target0resources.
  Removed8old2ae payloads1,346,348,226bytes and6unusedownimages; small oldprivate
  companion/compact provenance retained. Denied3 children untouched.
- Postrestart browser safely failed closed during coldstop; Refresh Path Finder
  restored ready model. One new standalone Control path35.30345579516123m/design45
  is displayed. Finalread-only audit post-operations-read-only-audit-20261018T085957Z.json
  confirms realcable revision0/routing-design-install null/Apply0 and preview
  noitems/proposals/reviews/Apply. Final5group preservation PASS in
  evidence/pf8/isolation-1792313848085.json. Current production bytes unchanged.
- SDK explicit transparency disables consolidation until Reload model; Clear
  restores appearance. No wholeplant throughput guarantee. Reusable graph and
  complete plant capture/capacity remain NOT_IMPLEMENTED/NOT_RUN. Native comparison
  NOT_PERFORMED/NOT_REQUIRED_BY_USER. Human manual engineering acceptance PENDING.
- Three denied cleanup children retained without retry/bypass: .pf0-work/core-1f723e37-
  f152-4a60-9b1e-46adc6c3179c, .pf2-work/model-tests-2733f823d57d477ba5e338a7d9a08cc9,
  pathfinder-engine/.scratch/model-tests-c13957af670e4ee2869cf876aa60d581. Automatic
  approval review said blocked by policy. Initial SDK certificate setup observation
  remains in report22; no certificate deletion attempted.
- Next: actual human route/length review via handoffs/PF-user-manual-review.md;
  react to concrete feedback with a new inherited local branch. Final report22,
  matrix and evidence are committed locally in the delivery commit containing
  this update (inspect live HEAD). Heartbeat updated through application tool to
  PAUSED; evidence/routes-path/automation-paused.json. No unchanged review loop.

Original checkouts/dirty files, synced sources/, original13containers and working
data remain untouched. No push, PR, merge, deployment or original update. Full
history, source receipts and honest failures: 22-routes-path-tabs.md.

## Previous delivery — project gap and manual real-result review

The latest user decision supersedes the earlier native-oracle prerequisite:
manual inspection of generated routes/lengths is the chosen acceptance path.
Native parity is NOT_PERFORMED / NOT_REQUIRED_BY_USER, never PASS. The exact
source filename is confirmed by the user. Human acceptance remains PENDING.

- Isolated branch: pf-manual-validation-settings-20261018. Settings/manual review
  checkpoint873afeb; production follow-upsfeac4eb; corrected live test driver
  and actual candidate checkpointcfdcd3f5974636737ff34acec0fc3de391d35ab1.
  Later commits deliver reports/evidence only. Inspect live HEAD/status first.
- Current5190 API286e0d43/web50034521 are healthy, rebuilt/restarted only in the
  owned stack. Details connectionGap default1m is persisted and authoritative;
  the three design allowances stay in Details; the formula card distinguishes
  legacy tray estimate and exact PathFinder math. Real Review+Apply is explicit,
  per proposal, with manual provenance and all current-state/write guards.
- Source checks: backend51process/settings plus191regressions at873afeb;
  final17boundary+16actualNode/.NET, frontend19affected plus tsc/lint PASS;
  earlier147frontend before follow-ups; runtime safety17PASS. These are separate
  scoped runs, not a new aggregate. Core/frozen source bytes unchanged.
- Final actual23SQL/HTTP and cleanup PASS on cfd/286e. Earlier22/23 test-baseline
  failure is retained separately; only test baseline ordering was corrected.
- Computer-use PASS: gap1/invalid0/0.25save+reload, formula/current values,
  read-only lookup; final real proposal35.30345579516123m/design45m, filledGhost,
  original tray colors/yellow; Confirm enables Apply, reload/reselect resets it.
  Real PF-MANUAL-DEMO has no Apply; routing/designNULL and0Applyreceipts.
- Final combined cold backup/restore/session/crash drill PASS: backup2ae6f51b,
  pf-manual-backup-20261018-0703 plus private companion retained;684resources,
  13PFfiles, actual worker interruption/natural retry64/64/no duplicates/noApply.
  Extra target retired to0containers/volumes/networks. Old433's8payloads
  1,346,316,196bytes and6unusedownimages removed; no physical layer savings
  inferred. Finalhealth200 and5-group preservation audit PASS. Original3trees,
  dirty reference files,13originalcontainer IDs/images/starttimes preserved.
- Source manifest810files d0ad1efa; final preservation receipt
  evidence/pf8/isolation-1792307166050.json. Exact source/image/test/backup/cleanup
  receipts and screenshots are linked in21-manual-review-settings-report.md.
- Two historic policy-denied scratch children remain visible/untracked and were
  not retried. No push/PR/merge/deployment/original app or data write occurred.
- Next handoff: handoffs/PF-user-manual-review.md, prepared using
  prepare-stage-handoff and actual local/remote evidence. Human review cannot
  be impersonated by another technical run. Whole-plant capacity/category
  completeness and reusable graph remain explicitly unperformed/unimplemented.

Technical delivery is ready for the user's manual review. Delivery/evidence
commit961d24ff0f8e6cbbe9a77807d631aa0b3d7f00ef follows the candidate checkpoint.
The heartbeat was setPAUSED through the app; stored status/name/schedule/target
were read back. See evidence/manual-settings/automation-paused.json. The full
saved configuration was resubmitted, changing only status. Do not repeat the old licence refusal
or unchanged completed tests. Resume from concrete feedback/remaining measured
scope while preserving the original installation and accepted algorithm.

## Latest wakeup audit — 18 October 2026, 05:38 UTC

Fresh HEADce8eab0/pf-8-delivery-local-20261018, clean trackedfiles and only two
denied untracked children. No native export appeared in inspected retained
evidence/output paths after02:46. No code/native-host/test/runtime/cleanup
operation was repeated. Existing technical passes remain historical evidence,
not new results. Refreshed remote/default revisions are unchanged; localfeature
is11ahead/0behind WFCmain, unpublished. The configured GitHub connector found
only unrelatedWFC#1 COMMENTEDreviews and no featureCI proof.

Automation was observedACTIVE again (reasonUNKNOWN), despite the prior actual
PAUSED receipt. It was setPAUSED again through the application tool; stored
status and unchanged prompt/name/schedule/target were checked. New receipt:
`evidence/pf8/automation-wakeup-20261018T0538Z.json`. The native-resume handoff
now includes this fresh baseline. Remain blocked on the same external reference;
no engineering acceptance, merge or deployment is inferred from a heartbeat.

## Historical delivery — before the revised manual-review criterion

The isolated5190 demonstration is healthy. Final combined cold backup/restore,
cookie/JWT fencing, actual .NET-child death/natural recovery64/64/0duplicates,
extra-target retirement and exact obsolete-resource cleanup all PASS.
Final preserved backup43365396 is retained. Final original-environment audit
PASS preserves13originalcontainer IDs/images/starttimes, threeoriginalsource
trees/dirtyfiles and frozen/pinned bytes. Only the two denied cleanup children
remain intended untracked. See `08-stage-report.md` and linked final receipts.

Final805sourcefile manifest3ea5002a differs from earlier63081706 only in the
strengthened operations crash driver; application images remain562e8073/81bb13b4.
Technical checks: Core105/215, ModelRunner38, registryHTTP13, backend34/20live,
legacy40, frontend71, runtime104, runtimeownership9. Exactscopes/receipts inPF-7.
Actual browser final yellow/Ghost/Review/onepoint/Clear passes are recorded.

Next executable task: `handoffs/PF-2-resume-native-validation.md`. It requires
a complete same-source full-precision native export from an authorized host or
working local entitlement plus permission for another capture. No repeat of
unchanged entitlement refusal is useful. Real engineering parity/acceptance is
BLOCKED; fullplantcapture/capacity NOT_RUN, reusablegraph NOT_IMPLEMENTED.
These unmet PF-2/PF-7 gates and user acceptance are not waived. The heartbeat
is now **PAUSED**, updated through the application tool after commitbf9dfdf;
its actual stored status and unchanged prompt/name/schedule/target were checked.
See `evidence/pf8/automation-paused-20261018.json`. Do not restart repeated
attempts without an actual change to the recorded external prerequisite.
No merge/push/PR/deployment/original-app or data write occurred.

## Earlier final technical checkpoint — 02:38 UTC

Final API562e8073 / web81bb13b4 is healthy on own5190. Backend20/20 actual,
34 process/registry,40 legacy, ModelRunner38, frontend71, runtime104 and
fresh Core105/215 checks PASS at their receipts. Actual final computer-use
now passes bright yellow real lookup/Reverse, filled Ghost including zero-ID
synthetic paths, readable review, one-point0m/design7m acknowledgment and
Clear restoration. Test TOX is restored10; automatic2/2 geometry10/design18.
No extra one-point Apply occurred. See PF-7/final computer-use receipt.

The runtime owner is now executing cold combined backup/restore/cookie fencing
and actual .NET-child crash recovery only on a fresh extra target. Source5190
is retained. Final report/audit/local commit and cleanup follow. Native/full
plant/graph reuse gates remain open. Original resources remain unchanged.

The prior checkpoint text below is historical; it is not the current list of
pending rendering fixes or final test counts.

## Earlier work checkpoint

**18 October user resumption supersedes the earlier routine stop:** automation is
ACTIVE again. See `18-execution-resume.md`. Independent PF-3 registry, PF-4
protected Viewer/UI, PF-5/PF-6 jobs/Apply and separate runtime work are progressing
in parallel; this does not waive PF-2/PF-7 engineering evidence. Current registry
source milestone: 20 pure +10 real SQL checks PASS, new ModelRunner 37 PASS,
fresh Core 105/215 PASS. Refreshed HTTP13/13 resolves the initial old-image alias
404; actual first jobs/Apply16/16 and browser workflow checks are recorded. See
`03-stage-report.md` and `07-stage-report.md`; no overall stage
acceptance or engineering Apply claimed. Runtime is new own localhost5190 with
fresh credentials/database/storage and copied model. Original resources stay
reference-only. Generate/finalize each subsequent handoff from real interfaces
and continue; do not treat old PAUSED entries below as current authorization.

PF-1 is **technically complete and verified** at local commit `db1b76ec32286d290210ba11adc0738c96665372`: 105/105 original regression checks and 215/215 parity/boundary checks, including 43 frozen cases, 33 production DTO replays and 14 CLI scenarios. Independent review fixes were verified, followed by the combined verification entry point. PF-2 has a **BLOCKED partial delivery** under `handoffs/PF-2.md`, inherited handoff commit `859949c` and earlier WIP checkpoint `f4d46ab5281ded40d0a0357c2f1cb1e23f5a5dc4`. This continuation records actual converted checks and the now-proven native licence blocker. Final human acceptance remains separate.

PF-1 has no user interface. Automated code/math checks use the normal build/test tools. The `computer-use` skill has been loaded and initialized for visual checks when an interface is available. No terminal is controlled through computer-use.

## Stages

| Stage | State | Next evidence |
|---|---|---|
| PF-0 | Technical PASS; inherited cleanup BLOCKED | Frozen receipts and local commit above |
| PF-1 | TECHNICAL_PASS | Extracted DLL; 105 original regression and 215 parity/boundary checks; source/environment preservation PASS |
| PF-2 | BLOCKED; partial implementation verified | Native host reports entitlement not found; full-precision reference and remaining graph/capacity work required |
| PF-3 | IMPLEMENTED; scoped technical verification PASS | 20 pure +10 actual SQL, refreshed HTTP13/13; actual protected capture/pick/save/reload; native gate unchanged |
| PF-4 | TECHNICAL_PASS at tested local scope | Admin/engineer deep links, protected capture/picking/shared resolution, final yellow/Ghost/onepoint/Clear verified |
| PF-5 | TECHNICAL_PASS at tested local scope | Automatic/durable jobs, staleness/designreuse, cancellation and actual extra-target crash recovery; fullplant throughput NOT_RUN |
| PF-6 | TECHNICAL_PASS for trusted synthetic fixture | Review/atomicApply/idempotency/history/install preservation tested; real engineering Apply blocked |
| PF-7 | Independent integration PASS; native parity BLOCKED | Final20live,34backend,71frontend,104runtime and stated regression receipts; exactsource/images bound |
| PF-8 | Local operational PASS; user acceptance NOT_RUN | Own5190, combinedbackup/restore/sessionfencing/realcrash/cleanup/finalpreservation PASS; crosscomputerrestore NOT_RUN |

## Inherited limitations

### Latest durable checkpoint — 18 October 2026, 02:28 UTC scope

- Integrated source/evidence is staged locally (119-file checkpoint plus later
  unstaged report/tool updates); no commit after `c95ad56` yet. Preserve all
  coordinated edits. Live branch remains `pf-4-viewer-local-20261018`.
- Current API image `sha256:6b226c434b4d23a456ed8add0c87edb105d0ace3a5ea4d982556d16e3dea64e3`;
  web `sha256:c2535ca007ec1ba2045e125bf35174e0d5a8a05032af35b10837ce409be38d4d`.
  Backend final actual **20/20** SQL/HTTP PASS, cleanup PASS; engine/registry
  **34/34**, legacy **40/40**. See `evidence/pf5/verification-final-20261018T022415Z.json`.
- Independent review found a project-FK lock inversion with mixed cable imports.
  PF project mutexes now use FOR NO KEY UPDATE; actual two-connection mixed
  import/user-assignment ordering controls passed in that20-case run.
- Scoped large-artifact proxy/prebody current-login authorization is implemented.
  Actual transport4controls PASS: admin204, unauth header-only11MiB401,
  oversize256MiB+1 header-only413, actual11MiB schema-invalid body reaches API400.
  `runtime/artifact-transport-1792290198792.json`. Nginx EOF-only formatting changed
  after that image copy; no semantic configuration difference.
- C# worker latest **38/38 PASS** at `evidence/pf3/model-runner-2026-10-18T02-26-42-960Z.json`.
  One-point zero-length native result is confirmed; last source build0warnings.
  Eleven pinned core sources remain unchanged.
- Frontend preceding overlay patch: TypeScript/ESLint PASS, runtime101/101,
  targeted frontend69/69. Actual new queued lookup/Reverse35.30345579516123m,
  four gaps/0.9840583861033791m and filled Ghost/Clear PASS at diagnostic scope.
  Yellow line is visually too weak/absent in the actual screenshot; Viewer owner
  is replacing thin WebGL line with bounded merged MeshBasic tubes along exact
  points, adding a one-point marker and related protocol/UI controls. Await its
  final tests/freeze, incremental candidate rebuild, and actual screenshot retry.
- Runtime owner is holding backup maintenance until the final visual window ends.
  Final combined backup/restore, positive copied Viewer cookie fencing and an
  actual dotnet-child crash/recovery test on an EXTRA restored target are prepared
  but NOT_RUN. Source5190 must remain retained; retire only verified extra target.
- Next: finish yellow/one-point patch → final visual checks (real lookup/Reverse,
  zero-ID synthetic Ghost/readability/review gate, one-point case) → local commit
  and PF-7/PF-8 branches/evidence → final own backup/drill/cleanup → final audit.
  Native parity, full-plant completeness/capacity and reusable graph remain open.
  No original update or publication. Do not end work merely at this checkpoint.

Frozen synthetic data does not prove real converted-model parity. Paired full-precision native/converted evidence is a substantive PF-2/PF-7 prerequisite. Investigate available authorized sources before treating that prerequisite as unavailable; do not fabricate evidence or loosen thresholds.

The PF-0 temporary child `.pf0-work/core-1f723e37-f152-4a60-9b1e-46adc6c3179c` was denied recursive removal with `blocked by policy`. It remains untouched. Do not retry or bypass that denial. New build outputs stay under the new engine directory and are not committed.

## PF-2 checkpoint — 18 October 2026, Europe/Kiev

- Actual UI checks now **PASS at capture scope** in an explicitly addressed in-app browser tab. The earlier Brave URL-confidence refusal remains a historical failed attempt; it was not retried. Copied model rendered 664,556 fragments; complete inventory has 438,155 unique objects. Both selected meshes normalized and passed the strict C# reader: 68/26 leaves, 257/99 fragments, 91,934/34,674 vertices. Full plant mesh is not captured.
- Strict normalization caught duplicate-root enumeration, nonfinite SDK translation and Float32 matrix loss. Corrected capture uses binary64 matrices and rejects nonfinite values. Failed captures are retained. Actual matrix/sample consistency is zero residual; independent native equivalence is still unproven.
- Fresh Model tests: **82/82 PASS**. Normalizer/comparator controls after independent depth review: **27/27 PASS**; both actual captures revalidated to byte-identical snapshots. ModelCheck CLI smoke: **9/9 PASS**. Two actual converted ordered lookups and memory/disk cache consistency **PASS at diagnostic scope**, with reported fallback geometry and `needs_review`. See `02-stage-report.md` and linked timestamped receipts for exact checked inputs.
- Final independent SDK enumeration review fixed support for nonindexed triangle meshes: **6/6 PASS** against the pinned SDK implementation and an actual indexed fragment. A fresh browser reload and capture exercised the final helper route; both final captures normalized successfully, with exactly unchanged geometry/identity/coordinates and new provenance hashes. The final screenshot and compact browser receipt are retained. Temporary browser/server are now closed/stopped; no port-5185 listener or native host remains.
- Actual lengths are 107.55007443085563m / 37.050260813690024m with explicit 1.0m diagnostic connection tolerance. They differ from the historical rounded 100.972m / 35.299m reports; this is unresolved, not an engineering or native parity PASS. Equipment From/To, project design allowances and SECONDARY design replacement were not evaluated by ordered lookup.
- Native Automation startup failed `0x80080005`. A separate documented direct CLI launch actually started Manage2027, then exited 2 before capture; its log reports **NOT Authorized / entitlement not found**. No licence/account/registry/installed-plugin changes or repeated identical attempts occurred. No owned native host remains. Only installed Manage2027 and Freedom2025 were found in the inspected standard application directories; no complete existing native export is available.
- `PathFinder.Model` caches fitted geometry; the endpoint-dependent graph is still built per calculation. Full graph preparation, complete geometry/category/visibility/source proof, real engineering tolerance, native parity and plant capacity are **not complete**. Do not advance to PF-3 or generate a success handoff.
- Changed files are confined to the new Model library/tests, diagnostic capture/normalizer/comparator/CLI/native-runner tools and `docs/pathfinder/`. The pinned Core and original regression sources remain unchanged. The local checkpoint commit following this update contains the complete file list and current evidence; `verify-isolation.mjs` records its checked source-set hashes separately from the pre-commit HEAD.
- Automation `pathfinder` was set to **PAUSED** through the application tool after the concrete external blocker. Resume only when an authorized full native reference is available or the user resolves the local entitlement and authorizes another capture. Retain existing code/copies/evidence and continue the first unmet PF-2 gate, not a duplicate PF-1/PF-2 implementation.
- The two denied cleanup children remain visible and untracked. No new removal attempt was made. New necessary build/cache/capture data is retained in ignored `pathfinder-engine/.scratch/`; no PF test containers were created.
- Final preservation audit **PASS**: `evidence/pf2/isolation-1792271766371.json` binds the actual engine source set to SHA256 `3b274e1e9ab562c9fd45009699ed23eff749849915732555066ebd6f53aff5a1`, preserves Core/native pins, frozen PF-0 material, all original checkout/dirty files and thirteen original container identities/images/start times. Final two recapture ModelCheck results exactly reproduce the prior valid outputs; see `model-actual-final-summary-20261017T2115Z.md`.

Next dependent step: obtain a complete full-precision native oracle for the same source, review identity pairs, investigate fitting/length differences, then complete the remaining PF-2 graph and capacity requirements. The runtime is intended to operate without Navisworks; this native dependency is for validation only.

## Resume protocol

Inspect current Git status and the stage reports before resuming. Finish the current stage, retain actual check results, review and commit locally, prepare the next durable handoff, then execute it. Never relabel historical checks as a new pass. On a real external blocker, continue independent authorized work and record the exact unresolved gate. Stop repeated unchanged attempts. Disable the automation after verified local delivery or when user input is indispensable.
