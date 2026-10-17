# Етап 9 — отчет за интерактивния информационен панел

**STAGE_9: PASS. READY_FOR_STAGE_10: PASS.** Технически завършен за localhost HTTP в production Docker и development proxy. Потребителско приемане: **NOT_RUN**. Остават отделните етапи 10 и 11.

## Ревизия и запазена основа

Клон `stage9-cable-information-panel-20261017`, HEAD `e4093109e7e10552f1f61093486b9b9fa9bce37b`. Live remote main е проверен отново като `d5454b3c4c547c24631e37e24d35f76739228867`:0 behind/2 ahead. Всички предишни tracked/untracked промени и двата cable-export commit-а са запазени. Няма reset/clean/stash, нов commit/push/PR/merge, APS заявки или cloud промени; git ls-remote е изисканата read-only remote проверка.

Началната проверка потвърди **752 source файла,84 evidence файла и3 документа** от Stage8 по размер/SHA. Stage8 index остава `c117746fc99c8f414b12f0b6e12b442f8cdb487e27680569bc8b52691d44c69e`. Matrix prefix118164bytes/SHA `fcd7624d01cc492af50c91d8d7c1cce2f79a0df24b1d148da5dca173f040a297` е запазен дословно. Историческите291 теста/36browser и native125 functional-only/FAIL/NOT_PROVEN/capture-clipping ограничения не са ново hover/clipboard доказателство. Исторически blocked cleanup не е повтарян.

## Реализация

Един nonmodal portal показва оригинални From/To/Routing след1000ms, с150ms grace, selectable readonly полета, Copy field/Copy all, Pin/Unpin и Close. Alt+Enter отваря само информация; Enter/Space запазват click-to-route. Global Escape работи и при focus извън hover панела; focus restoration не предизвиква reopen. Информацията е достъпна и когато разрешените данни са налични, но моделът още не е готов за маршрут.

Панелът има собствен scope/lifecycle/UUID/generation/anchor и не управлява selection или controller. Използва пълния cable snapshot; новите nullable From/To са runtime validated. Successful refresh обновява същия UUID, при променени стойности/tag показва известие, или затваря изчезнал/blank-tag UUID; непроменени данни не създават ново известие. Stale/refreshing кешът е обозначен. From/To-only промяна не инвалидира маршрут. Clipboard feedback е вързан към точния копиран snapshot и operation. Подробности: [09-cable-information-panel.md](09-cable-information-panel.md).

Backend/schema, session/controller/protocol, geometry/SDK/legacy fixtures, importer, PathFinder, Model Preparer, Cable.routing и инженерните изчисления са непроменени. Текущите предишни source файлове са сравнени срещу Stage8; новите промени са само в разрешените frontend/test/tooling/docs модули.

## Текущи проверки и доказателства

Evidence root: `C:/Users/todor.chankov/Documents/Codex/2026-10-17/wfc-cable-information-output`. Frozen build 2026-10-17T07:53:32.667Z → 2026-10-17T07:54:00.074Z; **858 inputs**, compact JSON SHA `40eab6a67f8c77aaf8859d741649e19b6b87c5296cebf0adbf55558a4b38dcbf`. Actual host observer и всички inputs съвпадат с build/regression: post-build-observer-reconciliation.json; няма host-only exception.

| Образ | Проверен ID |
|---|---|
| API fixture | `sha256:93688c9cd9474f404f9430b3bc40b21fa15cf13e06fa84f30f38f0a5a771594b` |
| Web | `sha256:c50311e66df261d2aa24bd861f83bd104f8912808a80bad7b4ed1692984a9b68` |
| Test | `sha256:d6a98d6f6e7867e0661550370a5b895f97ad4e5170892bfb26426f2d9cce1ce3` |

**232 Vitest теста в8 фокусирани файла — PASS**, typecheck/lint/build PASS, nonroot Docker с network disabled. Log: `C:\Users\todor.chankov\Documents\Codex\2026-10-17\wfc-cable-information-output\fixture\evidence\1792223774356-regression-vitest.log`. Включени са adapter, full list/generation, shared routing/lifecycle, panel/timer/clipboard, реалното UI wiring, tag filter и ProjectAccess. Предварителните host резултати не се прибавят повторно. Непроменените пълни controller/aggregate/runtime68/engineering suites не са повтаряни за по-голям PASS брой. Geometry остава SHA `4d10d66dca31f10b82926693a0e7438e68f448047f3f991baabb82f6ed2573fa`.

Текущи ранни FAIL опити са запазени: коригирана грешна search expectation в нов unit fixture; реалният same-DOM refresh/ref retention пропуск е коригиран след independent review и покрит с rendered-row regression. Първоначалната Clipboard probe expectation откри платформено LF→CRLF readText поведение, не промяна на инженерните данни. Първият main browser опит спря на грешно observer очакване: Playwright isDisabled включва aria-disabled; заменено е с проверка на native button.disabled, без отпадане на actual keyboard/copy/ACL assertions. При втория опит старият панел се затваря при model retirement, но layout shift поражда истински pointer-enter за друг UUID, който отваря нова разрешена информация след1028ms. Observer вече фиксира стария панел с Pin, доказва затварянето му при actual selection refresh и държи курсора извън редовете за no-stale-timer проверката. Pending-dwell unmount използва програмно активиране на действителния Details tab/handler, за да изолира unmount от pointer-leave cancellation. Продуктовият код не е променян за тези два observer случая. След корекциите са направени stable rebuild и повторни проверки; финалните резултати са върху последния frozen source.

Нов disposable project `wfc-routings-viewer-stage9-73a729c72934`, run `73a729c7-2934-49c1-9a84-8f6b7e391151`,18089/15189, собствени PG/MinIO/staging volumes. Реалният ZIP439112829bytes/SHA `8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5` е импортиран през public API. Моделът е342 resources/439007803 rawbytes; fingerprint `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`. API **2 contracts+3 integration+1 actual two-worker restart PASS**: nullable/original locations срещу distinct connection dates, roles/401/403/404, unselected UUID update/delete, непроменен Routing/selection/model.

**18 Docker+18 development browser случая — PASS**, Chrome `153.0.8010.12`, `fixture/evidence/stage9-browser-1792223859691-acdfd443-summary.json`. Fresh contexts и browser-wide exact-origin boundary; един full model load на mode,664556 fragments/438156 identifiers/6 sample properties. Двата known routes запазват10 drawable/1 continuous yellow line, оригинални материали и approximate-connector предупреждение. Current source/operation/frame/load се сравняват при информационните действия.

Реалният browser измерва delayed hover и ранна липса, pointer gap/focus selection, pin/filter/scroll/fallback anchor, клавиатура и focus return, unselected hovered/pinned refresh/delete, stale/error, reader roles без active model и model/scope cleanup. Точната999/1000 граница е fake-timer unit доказателство; actual browser scheduler timestamps се отчитат отделно. Layout е проверен за дълги стойности, short viewport,320/280/stacked и dark shell/light Viewer.

Допълнителни **2 browser случая — PASS**, по един в Docker и development: `evidence/hover-information-supplement-1792224510364-251c5009.json`. Панелът действително е отворен с delayed hover върху неизбран и unpinned UUID; проверени са original locations-only update, same-UUID retag и deletion през три истински full GET refresh-а. Refresh се активира програмно чрез действителния бутон/React handler, за да се запази pointer/focus в панела; не е симулиран HTTP отговор. Тези случаи са отделни от основните36; нямат допълнителен model load или business writes и всички contexts/boundaries са затворени.

Clipboard: actual native write/readback, включително null→empty, и native paste на непразни field/all стойности; actual Chromium permission state denied чрез CDP и работещ native Ctrl+C/paste; отделно simulated unavailable/rejected/deferred API. Няма твърдение за човешки permission prompt. Windows native readText преобразува LF към CRLF; точните оригинални writeText аргументи се доказват в unit tests, а actual native paste в own textarea запазва очаквания текст. Функционалността не чете clipboard; observer проверява само собствен изрично записан/копиран текст.

Независим audit на всички editor/read-role proxy requests: `evidence/browser-network-write-audit-1792224494913.json`,0 business mutations, external requests, boundary denials и CSP violations. Exact login и UUID Viewer lifecycle POST/DELETE се отчитат отделно. Fixture DB mutations са само за собствените тестови UUID; няма working-project fault injection.

## Localhost и почистване

Съществуващият update helper приложи само verified web image на http://127.0.0.1:5180/. Всичките11 API filesystem layers и runtime config съвпадат с оригиналния backend; неговият контейнер е запазен. Останалите12 услуги запазват IDs/images/start/restarts/mounts/ports. HPU Aalborg2023 запазва2140 кабела,330 тави, пълните business-row hashes, моделните metadata и същия current selection/revision/updatedAt. Evidence: working-before/after, working-preservation-final.json и backend-runtime-equivalence.json.

Read-only live hover/copy smoke: `evidence/working-panel-browser-1792224792966-621de8f3.json`, actual original From/To/Routing, real model/index/properties, Manual/frame/load запазени,0 informational Show/Clear и0 business writes. Maintenance login/resource sessions са revoked204 преди owned browser cleanup. Input ZIP, evidence и оригиналните DB/MinIO volumes/услуги са запазени.

Първият live smoke FAIL също е запазен: helper изчаква75ms в изкуствен gap, а последващият Pin.hover чака actionability/stability и надхвърля150ms grace; панелът закономерно се затваря. Финалният live observer преминава с действително pointer движение директно в полето на панела, проверява задържане над200ms и след това натиска Pin. Няма промяна на продуктовия код или engineering данните за тази корекция.

След exact project+run ownership са премахнати7 test containers,2 networks,3 volumes и2 unused own images; temporary fixture.env е премахнат след hash проверка. Работните images остават. Няма global prune или retry на исторически blocked cleanup.

## Финални оценки

| Gate | Result | Contracts / evidence |
|---|---|---|
| CABLE_INFORMATION_FIELDS | PASS | POP-03/05; CABLE-01/03 — Required nullable From/To DTO validation; original locations/routing, Unicode/whitespace/multiline preserved; no connected/date/type fallback or detail fetch. |
| DELAY_AND_TIMER_CANCELLATION | PASS | POP-01/02/09 — 1000ms dwell, fake999/1000 boundary, real browser timing; cancellation on leave/replacement/snapshot/scope/lifecycle. |
| POINTER_AND_FOCUS_RETENTION | PASS | POP-04/10/11 — 150ms pointer/focus union, selectable fields, A→B timer handoff and actual same-DOM row retention across successful refresh. |
| PIN_AND_IDENTITY | PASS | POP-07/08/09; CABLE-04 — Pinned exact UUID/project, duplicate tags remain distinct, full-snapshot identity independent of selected cable/filter/DOM anchor. |
| KEYBOARD_AND_FOCUS_RETURN | PASS | POP-09/10/11 — Alt+Enter information only; native Enter/Space route once; nonmodal Tab, global Escape/Close, exact-row-or-search focus return without reopen. |
| CLIPBOARD_AND_MANUAL_FALLBACK | PASS | POP-05/06/10 — Exact source arguments and labeled Copy all; actual native success/CDP denial/manual paste; separately simulated unavailable/rejected/deferred API; no false success. |
| REFRESH_AND_SCOPE_ISOLATION | PASS | POP-02/08/09; AUTH-09/10 — Confirmed refresh reconciles any open UUID and notifies on changed fields/tag; deletion/blank tag close, stale cache labeled, old timer/copy completion cannot restore retired panel. |
| PANEL_POSITIONING | PASS | POP-04/08/11; UI-02–04 — Single themed portal above iframe, collision-aware viewport bounds/internal scroll; long fields, scroll/filter,320/280/stacked preserved. |
| ROUTING_BEHAVIOR_PRESERVATION | PASS | CABLE-06–10; ROUTE; BRIDGE — Hover/focus/pin/copy/close issue no Show/Clear/selection; Manual draft/source/iframe/load and both actual yellow routes remain intact. |
| REAL_BROWSER_INFORMATION_PANEL | PASS | POP-01–11; AUTH-02/03/14; AUTH-13 localhost HTTP only — 18 Docker+18 development main cases plus2 separate actual hovered-origin refresh/delete cases; fresh contexts, actual model/index/properties, all-role browser-wide0 business writes/egress/CSP. LAN/HTTPS remains NOT_RUN. |
| LOCAL_WFC_UPDATE | PASS | OPS-10–12; VER-07 — Only verified web image applied; unchanged backend/runtime retained; actual original-data hover/copy smoke and full preservation. |
| STAGE_9 | PASS | POP; CABLE; AUTH; ROUTE — Technical localhost HTTP production Docker/development scope complete; user acceptance separate. |
| READY_FOR_STAGE_10 | PASS | Stage sequence0–11 — Information foundation ready; stages10 and11 remain separate and have not started. |
| USER_ACCEPTANCE | NOT_RUN | Текущият панел очаква потребителски преглед. |
| OTHER_ENVIRONMENTS_AND_RESTORE | NOT_RUN | LAN/HTTPS, full other-browser matrix, втори физически компютър, backup/restore. |

Source inventory и evidence index с размер/SHA са final-stage9-source-inventory.json и final-stage9-evidence-index.json/.sha256. Историческите резултати/ограничения са запазени. Етапи10 и11 не са започнати.
