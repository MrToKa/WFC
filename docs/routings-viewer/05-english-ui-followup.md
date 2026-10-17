# English interface follow-up — 16 October 2026

The user requested English interface copy in WFC/Viewer and Model Preparer. Application pages, labels, help, status text and public error messages now use English. User-defined project/job labels and model properties are preserved as data.

WFC branch: `viewer-english-ui-20261016`, created from the existing Stage5 working tree without discarding Stage4/5 work. HEAD remains `e4093109e7e10552f1f61093486b9b9fa9bce37b`. No commit, push, PR or merge was performed. Historical Stage5 reports and evidence remain unchanged; their results refer to the earlier recorded revision.

## Changes

- WFC diagnostic page and iframe: English heading, buttons, accessible names, status/evidence text, warnings and error messages. The parent sends INIT locale `en`; strict validation accepts `en` and retains `bg` compatibility.
- Session error DTOs: only the 19 human-readable messages changed; codes/statuses and authorization behavior remain unchanged.
- Existing browser test selectors follow the English labels.
- Model Preparer: main/job/preview pages, help, notices, local formatting and COST_EXPIRED copy use English. Its targeted existing test assertion was updated to the equivalent wording.
- Pinned SDK, geometry algorithm, legacy geometry fixtures, project data, APS gates, conversion logic and package format are unchanged. PathFinder was not edited.

The Viewer remains the controlled Stage5 test preview and uses the real imported Aalborg model. The user confirmed that it loads. The final Details/model selector and Routings viewer remain later stages; this feedback does not imply acceptance of unimplemented UI.

## Deployed applications

- WFC Viewer: http://127.0.0.1:5180/projects/0c0007c9-d73f-4d13-bc87-601c544727b7/viewer-harness
- Model Preparer: http://127.0.0.1:8083/

The original application services were updated. Current WFC API image is `c2c620665fa59923c3ff0c24444163b688660dbedcc66e39d115e8be85cf95aa`; web image is `907ca98cc9001add4e11366113bd303fc5c20e4e3960218321f7920c5a12ac93`. Preparer image is `f7bfe7434ee7e8a864452b98678339a940bb621cfccdd21ad715f591ace6ad77`.

Preparer recreation copied the existing Docker configuration in memory, preserving mounts, ports, network aliases, healthcheck, restart policy and environment except the required instance UUID. No environment file was read or edited. The stopped predecessor was removed after health and preservation checks; its original image is retained for rollback.

## Verification

- WFC typecheck, lint and both production builds: PASS.
- Existing runtime tests: 67/67 PASS; parent 9/9 and AuthContext 7/7 PASS. No new tests were added for copy-only changes.
- Runtime delivery: 216 files, 83033648 bytes, inventory SHA `ec03ffc5bae45220364c08bed4327925a859c014b15706aaefaea2b3d789872e`. All 206 SDK assets and original geometry/fixtures remain byte-identical.
- Real browser on the original WFC: PASS. English `en` handshake, full Aalborg geometry/index/properties (664556 fragments, 438156 indexed nodes, 6 properties), English missing-identifier warning, close and maintenance-resource revoke. Ten SDK workers, zero external requests and CSP violations.
- Preparer existing relevant API cases: 3/3 PASS with network disabled. Distribution comparison: only the five approved UI/public-message files changed among 244 runtime files.
- Preparer real browser: PASS for main page, existing job details, English controls and invalid-job preview guard. The guard check does not claim a new full model preview run.
- Preparer preservation: the one existing job DTO and all 2114 persistent files / 1053221597 bytes remain byte-identical. Startup/provider/cloud calls and cloud mutations are zero.

Evidence and screenshots are under `C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-english-ui-output\evidence`. The original Stage5 1670-test/14-browser-case acceptance is historical; this follow-up reports its focused current checks separately.

## Cleanup

Application predecessors and disposable API-test containers were removed; current service images, persistent volumes and baseline rollback images are retained. Browser contexts/proxies were closed.

Temporary file cleanup is BLOCKED: automatic approval review rejected deletion of six build-context copies (60940 bytes) in three directories under `evidence/preparer/build`, stating “blocked by policy”. No deletion was executed for those targets and no alternative retry was attempted. The exact paths/hashes are recorded in `evidence/preparer/cleanup.json`.
