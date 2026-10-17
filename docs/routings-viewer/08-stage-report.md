# Етап 8 — отчет за Cables / избор на маршрут

**STAGE_8: PASS. READY_FOR_STAGE_9: PASS.** Технически завършен за localhost HTTP, production Docker и development proxy. Потребителското приемане е **NOT_RUN**. Етап9 не е започнат.

## Ревизия и запазена начална база

Клон `stage8-cable-routing-selection-20261017`, HEAD `e4093109e7e10552f1f61093486b9b9fa9bce37b`. Live remote main е проверен като `d5454b3c4c547c24631e37e24d35f76739228867`;0 behind/2 ahead. Клонът е създаден от Stage7 working tree със запазени всички tracked/untracked реализации и двата cable-export commit-а. Няма reset/clean/stash, нов commit, push, PR, merge, APS заявки или cloud промени. Read-only git ls-remote е използван за изисканата повторна проверка на remote main. Remote CI не е доказателство за локалните промени.

Преди редакции са проверени **737 source файла,214 evidence файла и3 документа** по размер/SHA. Stage7 index остава `82e0f5a0b9e46d7c90c5f2efae9e458a70a85caa2a642f8dd12011c0e4719d50`. Historical validation-matrix prefix111886bytes/SHA45822a30aa324840f0beb5c001e9e4cbcf0197d21e72a8f1ef19ca60770f571a е запазен. Това са исторически Stage7 резултати, не нов Stage8 PASS.

Запазени са Stage7 native125 functional-only/FAIL/NOT_PROVEN и capture-clipping границите. Native125 не се повтаря; base grid/height/runtime са непроменени, новият cable sidebar е проверен в текущите Docker/dev browser случаи. Историческият blocked Chrome профил `native-zoom-QS9sBQ` и по-ранните blocked cleanup targets не са докосвани.

## Реализация

Cables е read функционалност в левия панел на съществуващия Routings viewer. Новият explicit-token adapter използва пълния проектен GET,10s deadline,16MiB bound, runtime UUID/project/duplicate/nullable validation и безопасни грешки. Search е локален NFKC/trim/case substring; редовете показват оригиналния tag, duplicate tags остават отделни UUIDs, а пропуснатите blank/null tags имат точен общ брой.

Click изпълнява оригиналния Routing на конкретния UUID директно през общия pipeline. Един immutable attempt пази raw/source/cableId и fresh operation; local empty/invalid резултатите също запазват cable identity. Nullable source не се променя и CableType.routing не е fallback. Manual draft, mode/search/selection и current displayed source са отделни; mode switch не пресъздава iframe.

Retry използва актуалния потвърден snapshot на същия избран UUID; failed refresh е stale, не deletion. Confirmed delete/blank tag/reroute инвалидира само matching current cable source+UUID+original routing; по-нов Manual маршрут е защитен. Scope-bound callbacks и bounded exact-request early-reply buffering пазят от закъснели completions. Подробният договор е в [08-cable-routing-selection.md](08-cable-routing-selection.md).

Controller/protocol/aggregate, backend/schema/importer, SDK/rendering/geometry/fixtures, PathFinder, Model Preparer и инженерните изчисления са непроменени. Няма информационен From/To/Routing tooltip/panel, delay, pin или copy. Няма нов Show бутон за кабел и няма business writes от Viewer.

## Frozen build и приложима regression

Evidence root: `C:/Users/todor.chankov/Documents/Codex/2026-10-17/wfc-cable-routing-output`. Build 2026-10-17T06:05:01.727Z → 2026-10-17T06:05:37.991Z. Inventory **847 файла /145505913bytes**, compact JSON SHA `2fb69ea96a1cdb67a4da5dde5c5bb82471dc4780fdabbc74914528b0a0745461`. Source/image receipts са стабилни и всички build/regression inputs, включително host observer, съвпадат: `evidence/post-build-observer-reconciliation.json`.

| Образ | Verified image ID |
|---|---|
| API | `sha256:3006a87778cdf80b789bb6eaf239c97c6b62f397a2c3075dd4d65690f7e43604` |
| Web | `sha256:2c812832423f9728d9e8336c905a43ab93b6abda7b2058111ff8def6cb06d5be` |
| Test | `sha256:c22b88fd7d68c7d3aba4549399988ba158256d1ccc13e136904c3d5f8f75f8fa` |

Node24 Docker/nonroot/network-none: **16 файла /291 Vitest теста PASS**, typecheck/lint/build PASS. Включени са новият API/list/tag helper, shared routing hook, component, Controller/aggregate, Manual/Details/model selection/project token/access проверки. Log: `C:\Users\todor.chankov\Documents\Codex\2026-10-17\wfc-cable-routing-output\fixture\evidence\1792217304285-regression-vitest.log`. Предварителните host20 API/53 hook/41 UI проверки са отделни текущи опити и не се прибавят повторно към291.

Непроменените пълни68 runtime и несвързаните engineering/AuthContext suites не са изпълнявани повторно само за по-голям PASS брой. Runtime/SDK/fixtures/geometry са byte-pinned към Stage7 и реалното source:cable protocol/rendering е упражнено в текущите браузъри. Geometry SHA `4d10d66dca31f10b82926693a0e7438e68f448047f3f991baabb82f6ed2573fa`; original route-c fixture SHA `8368d5a9602d45205aead5fdabd2ff9b4d3d41ad5f8f370a7506c7bb6c4cc67d`.

## Реални API и browser проверки

Нов namespace `wfc-routings-viewer-stage8-acb34b56fed3`, run `acb34b56-fed3-490f-bac9-caffee8528e0`, loopback18088/15188. Собствени PostgreSQL18/MinIO/staging volumes и два API worker-а. Pinned Stage3 ZIP439112829B/SHA `8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5` е импортиран през public API и версията е избрана изрично. Моделът е342resources/439007803rawbytes, fingerprint `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`.

API: **2 contracts+6 integration+1 actual two-worker restart PASS**.87 кабела/84 tagged/3 omitted, duplicate tags, nullable original Routing и игнорирани table query параметри; basic/technician/read-only engineer, legacy JWT, expired401/revoked403/project404. True fixture reroute/retag/delete/blank-tag, DB-only tray removal, revision fencing и exact cable snapshot след restart. Последен attempt `1792217182074-609bacb7`: `/evidence/routing-integration-1792217182074-609bacb7.json`, `/evidence/routing-restart-1792217182074-609bacb7.json`. Тези mutations са единствено във disposable средата.

Browser `153.0.8010.12`: **18 Docker+18 development случая PASS**, `fixture/evidence/stage8-browser-1792217246283-b6a63697-summary.json`. Всеки mode използва fresh context/cache и whole-browser exact-origin egress boundary. Model evidence:664556fragments,438156indexed identifiers,6 sample properties от действителна getProperties заявка. Page/worker traces и boundary са с0 external requests/denials/CSP violations; няма APS/CDN/Preparer зависимост.

Проверени са actual предходни Cable list page2/search и независим full list, tag-only/omitted/duplicates, immediate NFKC filter без GET при писане, keyboard selection и canvas→cable click. Двата известни десетсегментни маршрута дават10 drawable/1 continuous yellow line. Повторен UUID и различни UUID с еднакъв Routing имат нови request/operation IDs; Manual/mode/filter пазят отделните state и iframe/load identity.

Empty/null/separator/SECONDARY/invalid/none, A→B late reply, source-aware Retry след DB unavailable, независим DB missing/model drawable, true retag/reroute/delete/blank-tag, failed refresh/stale и delayed deleted-cable response срещу по-нов Manual са упражнени. Source/project/token/model-reload/selection-revision/logout/unmount и list ACL revocation имат unit и приложими actual browser доказателства. Независим audit на пълните browser-wide proxy requests във всички editor/read-role contexts потвърждава0 business writes: evidence/browser-network-write-audit-1792219008797.json. Audit-ът допуска само exact login и UUID Viewer lifecycle POST/DELETE и маркира всяка друга mutation като FAIL.

Layout:320/280/stacked, long tags, short viewport, native Tab traversal/keyboard scrolling и dark WFC/light Viewer. `evidence/visual-review.json` свързва прегледаните settled actual cable PNGs с frozen build. Оригиналните материали и whole-chain/junction/terminal поведение са запазени. Approximate connectors са видими предупреждения, не инженерно доказателство за физически маршрут или дължина.

## Localhost и почистване

Съществуващият scripts/update-local-app.ps1 е използван с verified web image и запазения оригинален API image. Работният WFC на http://127.0.0.1:5180/ е обновен. Само frontend услугата е recreated; останалите12 услуги запазват IDs/images/start/restarts/fullmounts/ports. Преди това read-only byte audit сравни всички17980 runtime файла /189584894bytes, режими, symlink targets, Node binary, entrypoint/config и pinned base layers на frozen API и оригиналния API. Те съвпадат; backend container не е пресъздаван. Evidence: backend-runtime-equivalence.json. Model Preparer и PathFinder са непроменени.

HPU Aalborg 2023 запазва active9dbe511d-9c51-49e8-bb4a-b52033b98f35/revision1/updatedAt, metadata и2140кабела/330тави. Съвпадат SHA на всички пълни cable/tray business rows, включително original Routing/tag, и моделният избор. Доказателства: working-before/after.json и working-preservation-final.json.

Live smoke `evidence/working-cables-browser-1792219032486-d3514ff1.json` избира действителен кабел от работния пълен API snapshot и сравнява точните source:cable/UUID/raw Routing, drawable line, запазен Manual draft/iframe и Clear/dispose. Няма business mutation или смяна на работния модел. Maintenance login/resource sessions са изрично revoked204. Резултатът на реалния оригинален Routing е отчетен без преправяне на кабела за теста.

След exact project+run ownership са премахнати7 Stage8 test containers,2 networks,3 own volumes и2 unused own images. Временният генериран fixture.env също е премахнат след SHA/ownership проверка. Работните API/web images са запазени; входният пакет/evidence и съществуващият набор от13 услуги са запазени. Няма global prune или повторение на исторически blocked cleanup.

## Финални оценки

| Gate | Result | Contracts / current evidence |
|---|---|---|
| FULL_PROJECT_CABLE_SOURCE | PASS | CABLE-03; AUTH-02/03 — Independent lazy full GET, exact current token/project, bounded validated HTTP200 collection; no table pagination/filter dependency. |
| TAG_FILTER_AND_LIST | PASS | UI-02–04; CABLE-01/02/05/10 — Original tag-only rows, exact omitted count, duplicate preservation, immediate local NFKC/trim/case substring, distinct loading/error/empty/stale states. |
| CABLE_IDENTITY_AND_SELECTION | PASS | CABLE-04/06/08; ROUTE; BRIDGE — Cable.id UUID for row/selection/source, exact original nullable Routing snapshot, fresh operation/request for every explicit click. |
| SHARED_ROUTE_PIPELINE | PASS | ROUTE-01–17; BRIDGE-02/05 — Single controller and shared canonical parser/full-trays/model/aggregate pipeline; source/cableId propagated through local and normal results. |
| EMPTY_AND_CHANGED_ROUTING | PASS | CABLE-07/08; ROUTE-12–17 — Null/empty/separators/SECONDARY/invalid/none retire previous bounds; confirmed reroute requires new explicit click. |
| RETRY_AND_REFRESH_SAFETY | PASS | CABLE-08/09/10; ROUTE-16; AUTH-10 — Fresh selected snapshot Retry, stale failure separate from deletion, real retag/reroute/delete/blank-tag and delayed response versus newer Manual. |
| MANUAL_MODE_PRESERVATION | PASS | UI-05; CABLE-09 — Independent manual draft/mode/search/selection/current route; no copying, auto-select, auto-route or iframe remount. |
| READ_ACCESS_AND_SCOPE_ISOLATION | PASS | AUTH-02/03/05/09/10; CABLE-09 — All read roles, list revocation terminates viewer, immediate project/token/access masks and retained-callback guards;0 business writes. |
| REAL_BROWSER_CABLE_ROUTING | PASS | UI-06; CABLE; ROUTE; AUTH-13 localhost/14 — Actual Aalborg model/index/getProperties, Docker18 +development18, empty cache, whole-browser boundary and page/worker evidence. |
| LAYOUT_AND_EXISTING_REGRESSION | PASS | UI-02–06; OPS-10/11; VER — 320/280/stacked, long tags/short viewport/native keyboard scrolling/dark shell;291 focused tests, typecheck/lint/build; unchanged geometry/runtime pinned. |
| LOCAL_WFC_UPDATE | PASS | OPS-10–12; VER-07 — Verified web image deployed to original WFC; byte-equivalent original backend retained, actual cable smoke, revoked maintenance access, exact full business-row and service preservation. |
| STAGE_8 | PASS | UI; CABLE; ROUTE; AUTH — Technical localhost HTTP production/development scope complete. |
| READY_FOR_STAGE_9 | PASS | Accepted stage sequence0–11 — Cable selection foundation ready; information panel, delay/pin/copy remain unimplemented. |
| USER_ACCEPTANCE | NOT_RUN | Current Cables tab awaits user acceptance. |
| OTHER_ENVIRONMENTS_AND_RESTORE | NOT_RUN | LAN/HTTPS, full other-browser matrix, second physical computer, backup/restore. |

Versionable source inventory е `evidence/final-stage8-source-inventory.json`; SHA/size index е `evidence/final-stage8-evidence-index.json` с отделен .sha256. Историческите резултати и ограничения остават исторически. Етапи9–11 не са започнати.
