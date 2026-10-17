# Етап 7 — отчет за Routings viewer / Manual routing

**STAGE_7: PASS. READY_FOR_STAGE_8: PASS.** Технически завършен за localhost HTTP, production Docker и development proxy. Потребителското приемане остава **NOT_RUN**. Етап8 не е започнат.

## Ревизия и начална база

Локален клон `stage7-routings-viewer-manual-20261017`, HEAD `e4093109e7e10552f1f61093486b9b9fa9bce37b`. Запазени са всички tracked/untracked реализации на етапи4–6, английският превод и двата cable export commit-а. Няма нов commit, push, PR, merge или cloud операция. Чист checkout от HEAD/main не включва автоматично тази working-tree реализация.

Преди редакции са проверени717 Stage6 source файла,104 evidence файла и трите документа по размер/SHA; drift няма. Историческият Stage6 index SHA е `ec3ff56ca44236f77b7c363833573f279fe5b628c3c41764b48cad7903fabfa2`. Това е начална база, а не нов Stage7 PASS. Историческите Stage5/6/English индекси и105867-byte prefix на validation matrix са запазени. Шестте English source файла на Model Preparer са непроменени. English WFC Controller/protocol имат само описаните Stage7 добавки.

## Реализация и обхват

Новият read таб е непосредствено между Cables list и Trays и използва само server active selection от canonical metadata API. Details остава единственият selection editor. Manual routing е активен, Cables е disabled. Всички нови labels/errors/accessibility names са на английски. Няма cable integration, hover/copy/pin, WFC NWD conversion, Model Preparer/PathFinder, Cable.routing/SECONDARY изчисления или инженерни промени.

Новите UI/hook/height модули, explicit-token full-trays adapter и pure parent aggregate са описани в [07-routings-viewer-manual-routing.md](07-routings-viewer-manual-routing.md). Controller има additive validated identity/readonly load snapshot и controller-only MODEL_LOADING, което обезсилва стар резултат/Zoom при reload. Shared normalizeRoutingKey е извлечен от canonical parser без промяна на неговите правила. Backend routes/auth/schema не са променяни в този етап.

Тесните ProjectDetails промени добавят таба, current read token/project binding, заглавие с разрешено пренасяне и изключват eager table/material/support заявки само докато Routings viewer е активен. Existing tabs запазват hook поведението си. Geometry/renderer/SDK/fixtures са запазени.

## Frozen build и текущи проверки

Evidence root: `C:/Users/todor.chankov/Documents/Codex/2026-10-17/wfc-manual-routing-output`.

Последен build: 2026-10-17T04:52:14.347Z → 2026-10-17T04:52:47.114Z. Inventory: **835 файла / 145339514 bytes**, compact JSON SHA `1d64971f3e570caf4d872307c73c6c8f37c68ab646d17749a6b27448a7776d04`. Това е SHA на JSON.stringify(parsed inventory), не на pretty JSON файла. Build обхватът изключва docs/env/cache; крайният versionable inventory с документацията е `evidence/final-stage7-source-inventory.json`.

| Target | Проверено image ID |
|---|---|
| API | `sha256:6d848da321dbbf5632882eef2e792e32651f9ffadc0ed0afe18037d0f275d82f` |
| Web | `sha256:45698ef59b715f616226aac8574b01dbd02ae7f04f96ab32e1b367862bc6f227` |
| Test | `sha256:cb5bbe1184825ec7d71f40e9d30b2715f6dda1f7e1693549fb6a014c474a582c` |

Final Node24 Docker/network-none: **18 Vitest файла /316 теста PASS**, **68 runtime Node теста PASS**, без skip в целия финален списък; typecheck/lint/build PASS. Source/image receipts са стабилни. Проверени са parser/aggregate/controller, API adapter, UI/hook/height, project roles/Details/current token/AuthContext, cable length, tray load/trefoil настройки. Разширени са само действително засегнатите runtime/session проверки; историческият пълен Stage5 backend/resource suite не се представя като повторно изпълнен.

Последни logs: `C:\Users\todor.chankov\Documents\Codex\2026-10-17\wfc-manual-routing-output\fixture\evidence\1792212978863-regression-vitest.log`, `C:\Users\todor.chankov\Documents\Codex\2026-10-17\wfc-manual-routing-output\fixture\evidence\1792212976616-regression-runtime.log`. `evidence/post-build-observer-reconciliation.json` сравнява текущите файлове с build/regression inventories; всяка евентуална host-only observer разлика е изрично изброена и няма скрит product drift. Current observer SHA: `00fbce90ecb8dd627d942bd94a2e638c7cbb79fa161466ccffd31273ee4fa0e3`. Изпълнението е свързано с before/after SHA и конкретния browser summary чрез browser-host-execution receipt.

## Реални API и browser доказателства

Нов namespace `wfc-routings-viewer-stage7-3f9df768fda3`, run `3f9df768-fda3-4f0e-8db1-ad8532ba869a`; production proxy18087 и development15187. Самостоятелни PostgreSQL18/MinIO/staging volumes, два API worker-а, nginx и dev service. Работният проект не участва във fault/selection mutations.

Импортиран е pinned Stage3 ZIP439112829B, SHA `8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5`, през public API с explicit selection. Реалният модел е342 resources/439007803 raw bytes, fingerprint `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`. Новите проверки са2 contracts+6 integration+1 actual two-worker restart, всички PASS. Последен attempt: `1792212831205-8a94c22c`; /evidence/routing-integration-1792212831205-8a94c22c.json и /evidence/routing-restart-1792212831205-8a94c22c.json.

Проверени са full85-tray DTO и read роли, legacy/expired login,401/403/project404; actual DFC003 DB-only deletion при здрав model descriptor; actual fullwidth BC025 NFKC collision; null→same UUID/revision3 отказва стар session409; durable timestamp expiry отказва resource410 независимо от tray200. Това са действителни disposable server predicates, а не wall-clock wait или production clock override.

Browser `153.0.8010.12`: **12 Docker+12 development случая PASS**. Summary: `fixture/evidence/stage7-browser-1792212916328-89a47bbf-summary.json`. Реални geometry/index/properties:664556 fragments,438156 identifiers,6 sample properties от реална getProperties заявка. Във всеки mode има свеж browser context/cache и exact-origin whole-browser boundary; page/worker traces доказват0 external requests/CSP violations/boundary denials. Не са правени Autodesk/CDN/APS/Preparer заявки.

Двата точни десетсегментни маршрута дават10 drawable/1 yellow line с ignored SECONDARY. Реално изтриване само на fixture DB DFC003 дава конкретно does not exist in this project при запазен model found+drawable и partial; actual collision/model missing и controlled DB network failure са отделни. Транспортните fault injections са обозначени като такива; actual authorization denial е проверен отделно.

След actual Trays page2 и search с празен резултат, нов Viewer/Show проверява пълния snapshot и route2 остава complete. ShowA→B с heldA response, повторен еднакъв текст, Clear, empty/invalid/no-drawable, Arrow+Enter/Back/Forward pending disposal, sameUUID/newrevision Retry и actual reader grant revocation са проверени. Raw stale wire replies остават в evidence; observer избира correlated current reply и отделно проверява winning UI operation/rows.

Оформление:320px desktop,280px640–899 и stacked под640; реално измерени shell/title/tab positions и налична височина, включително899×240 със slot първоначално под прозореца, scrollable fallback, long heading, wrapped tabs и dark WFC/light Viewer. Main suite има ясно обозначен CDP125%-equivalent layout тест. Отделният **реален native Chrome125%** supplement използва Appearance→Page zoom100→125→100, без emulation/pinch/CSS zoom: `evidence/native-browser-zoom-1792214606744-reconciled.json`. Моделът/route2 се зареждат реално; проверени са window/inner/DPR/visualScale, grid/canvas bounds и backing/CSS aspect, screenshots и ownership cleanup на временния профил. Full Chrome има 64 отказани от boundary background опита, отчетени отделно от WFC page/worker trace; няма forwarded external request. Native functional execution преминава всички zoom/model/route/canvas/cleanup проверки. Първоначалният сборен native report остава FAIL по допълнителния background-attribution критерий; непресъздадените endpoints остават NOT_PROVEN. Новият scoped PASS е pure повторна оценка на съхранените функционални факти и traces, с pinned SHA към originalFAIL и no-app preflights, без повторно изпълнение на модела. Това не е zero-total-attempts или full Chrome offline/cross-browser твърдение; строгите zero-denial offline доказателства са основните24 browser случая. Native supplement доказва действителните zoom/layout bounds и aspect.

Native diagnostic конкретика: 38 от64 отказани process опита са независимо пресъздадени без приложение; останалите26 към content-autofill.googleapis.com/passwordsleakcheck-pa.googleapis.com остават NOT_PROVEN. Всички са отказани,0 са forwarded и0 се появяват в app page/worker trace. Native PNG capture има независимо пресъздаден clipping проблем при125% (data-only edge-marker probe), затова не е доказателство за пълен визуален fit; използват се запазените действителни DOM bounds/canvas aspect. Основните100% settled screenshots са отделното визуално доказателство.

Geometry SHA `4d10d66dca31f10b82926693a0e7438e68f448047f3f991baabb82f6ed2573fa`; original route-c fixture SHA `8368d5a9602d45205aead5fdabd2ff9b4d3d41ad5f8f370a7506c7bb6c4cc67d`. `evidence/visual-review.json` свързва прегледаните settled PNGs със същия build. DFC003→C002 и BC023-4 terminal са подкрепени и от unchanged actual geometry fixture. Оригинални материали/цветове, preset7/quality/tonemap/exposure, ghost0.025 и yellow0xffe600 са запазени. Approximate connectors остават визуално приближение с видимо предупреждение, не доказателство за физически маршрут/дължина.

## Открити и поправени проблеми

Независим review добави отказ на HTTP202/206 tray responses като incomplete/unavailable. Реалният browser откри eager supports/tray-data заявки от скрит Details hook и overlap между Griffel max899/max639 media rules; те са поправени само в новия tab scope, с non-overlapping640–899 rule. Последният build включва поправките и повторните acceptance проверки.

Запазени са неуспешните междинни опити: host Fluent duplicated text assertion; scoped jsdom zero-layout keyboard fixture (поправена без увеличен5s timeout); първи raw-wire reply observer mismatch при коректен winningB UI; истинският639px layout failure; първи build е отхвърлен при concurrent test-source change. Отделният no-app native Chrome preflight също е запазен като FAIL срещу zero-denial assertion:17 browser-process background опита са отказани,0 са forwarded. Bounded suppression probe премахва time query, но оставя13 Google CONNECT опита. Native supplement използва изрично описаната по-горе ограничена attribution; основните24 offline случая запазват строгия zero-denial критерий. Нито един FAIL/нестабилен опит не се представя като крайния PASS.

## Локално обновяване и почистване

Existing scripts/update-local-app.ps1 е използван с проверените API/web image IDs. Original WFC http://127.0.0.1:5180/ е обновен; credentials са запазени process-memory only. Само двете app услуги са recreated; PostgreSQL/MinIO/model volumes и останалите11 services запазват container/image IDs, StartedAt/restarts, пълните mounts и ports. Docker mount map order е нормализиран по destination, без игнориране на полета.

HPU Aalborg 2023, ID0c0007c9-d73f-4d13-bc87-601c544727b7, запазва active9dbe511d-9c51-49e8-bb4a-b52033b98f35/revision1/updatedAt, model metadata,2140cables и330trays с идентични id/routing/name SHA. `working-before.json`, `working-after.json` и `working-preservation-final.json` са read observations, а не UI constants. Model Preparer и PathFinder са непроменени.

Live smoke: `evidence/working-routings-browser-1792214651985-d871e53b.json`; двата действителни маршрута, independent DBavailable/modeldrawable results, settled screenshots, Clear/text/Zoom/unmount,0 project/selection writes, metadata unchanged. Maintenance login/resources са изрично revoked204 и не засягат потребителските logins. Текущите project DB results могат да са partial и се показват честно.

След exact Compose project+run ownership са премахнати7 test containers,2 networks,3 task volumes и1 unused own images. Работните API/web image обекти са запазени с wfc tags; task aliases са премахнати. Docker cleanup е PASS. InputZIP и evidence са запазени. Няма global prune, промени по original volumes или повторение на исторически blocked cleanup. Shared build cache не е глобално чистен.

Временни файлове: **BLOCKED** за един Chrome профил от неуспешния transport опит: `C:\Users\todor.chankov\Documents\Codex\2026-10-17\wfc-manual-routing-output\temp\native-zoom-QS9sBQ` (151 files / 15136461 bytes). Автоматичната проверка за одобрение отказа recursive cleanup преди изпълнение с единствена причина „blocked by policy“. Профилът е запазен; проверени са0 останали негови browser процеси. Действието не е повтаряно през друг инструмент. Успешният следващ native профил е изчистен. Failure/cleanup receipt: `evidence/native-browser-zoom-1792214069411-b8ca40a6-523b-4d09-87b4-dcb33d9639bd.json`. Това изключение не е представено като успешно почистване.

Native transport helper използва outside-repository копие на Stage5 browser boundary с единствено добавен socket error handler за client ECONNRESET. Allowed origins, отказите, recording/forwarding policy и instrumentContext остават същите; original/copy SHA и точният едноредов diff са в `evidence/native-browser-policy-receipt.json`. Оригиналният Stage5 файл не е редактиран.

## Финални gates

| Gate | Result | Contracts / current evidence |
|---|---|---|
| PROJECT_TAB_AND_READ_ACCESS | PASS | UI-01; AUTH-02/03 — Tab order/directURL/keyboard/history/read roles; disabled Cables, zero eager cable/catalog/tray requests. |
| VIEWER_LIFECYCLE | PASS | BRIDGE-01/04/08–10; AUTH-09/10 — Authoritative active model, MODEL_LOADED readiness, explicit fresh Retry and scope disposal. |
| MANUAL_ROUTE_PARSE | PASS | ROUTE-01–03/12–14/17 — Canonical parser, exact markers/repeats/limits/NFKC/control/fullwidth slash. |
| PROJECT_TRAY_VALIDATION | PASS | ROUTE-04–08/16 — Fresh full project snapshot and independent missing/ambiguous/unavailable vs terminal access failure. |
| COMBINED_ROUTE_RESULT | PASS | ROUTE-05/07–11; BRIDGE-02/05 — Pure identity-checked parent aggregate and independent per-occurrence results. |
| REQUEST_IDENTITY_AND_RACES | PASS | BRIDGE-06–10; ROUTE-16 — A→B/lateA, repeatedsameShow/Clear and project/token/logout/unmount guards. |
| ORIGINAL_COLORS_AND_CONTINUOUS_LINE | PASS | UI-06; OPS-01–03 — Pinned original algorithm/fixture/materials and actual settled two-route visual review. |
| RESPONSIVE_LAYOUT | PASS | UI-02–04 — 320/280/stacked, short height/long heading/wrapped tabs, dark/light and native125% zoom. |
| REAL_OFFLINE_BROWSER | PASS | AUTH-13 localhost/14; OPS-04/05 — Actual model/index/properties with browser-wide external boundary, Docker and development. |
| EXISTING_FUNCTIONALITY_REGRESSION | PASS | OPS-10/11; VER; AUTH-03 — 316 focused tests +68 runtime tests; typecheck/lint/build; unchanged engineering code. |
| LOCAL_WFC_UPDATE | PASS | OPS-10–12; VER-07 — Original WFC updated with verified images; read-only live smoke and data/service preservation. |
| STAGE_7 | PASS | ROUTE; UI; AUTH; BRIDGE — Technical localhost scope complete. |
| READY_FOR_STAGE_8 | PASS | Stage sequence0–11 — Foundation ready; Stage8 has not been started. |
| USER_ACCEPTANCE | NOT_RUN | New tab visual/working acceptance awaits the user. |
| OTHER_ENVIRONMENTS_AND_RESTORE | NOT_RUN | LAN/HTTPS, second physical computer, full other-browser matrix, backup/restore. |

Крайният SHA/размер index е `evidence/final-stage7-evidence-index.json` с отделен `.sha256`; той свързва source inventory, документацията, текущите PASS reports и запазените failures. Историческите S0–S6 резултати остават исторически. Етапи8–11 не са започвани.
