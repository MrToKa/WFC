# Етап 7 — проектен Routings viewer и Manual routing

Табът **Routings viewer** е между **Cables list** и **Trays**. Той е read функционалност за всички потребители с достъп до проекта. Левият таб **Manual routing** работи; **Cables** остава disabled и няма cable list/search/click-to-route функционалност.

## Активен модел и граници на отговорност

При всяко монтиране се чете canonical `GET /api/projects/:projectId/model-versions` с текущия explicit token. Използва се единствено `selection.activeModelVersionId`, намерен в същия authoritative snapshot и с `health: healthy`. Details остава единственият редактор на избора. Няма first/latest/fallback избор, local draft или втори selection editor.

Новият `RoutingsViewerTab` и `useRoutingsViewer` създават съществуващия `ViewerController`. След `RUNTIME_READY` се извиква `load(activeId)`; само correlated **MODEL_LOADED** и ready readonly snapshot разрешават Show. Resolving на `load()` не е readiness.

Controller остава единственият собственик на resource sessions, renewal, selection/focus/pre-route fences и iframe source/origin/request проверките. Добавеният `ViewerEvent.identity` съдържа валидирани публични protocol/instance/project/modelVersion/load/request identities. Readonly `getLoadSnapshot()` връща instance/project/modelVersion/load, selectionRevision и ready. Няма session secret, cookie, iframe URL или private SDK state. Съществуващите callers остават съвместими. Controller-only `MODEL_LOADING` се излъчва синхронно при започване на load, включително автоматичен reload, и незабавно обезсилва стария резултат и Zoom.

Metadata failure, липсващ избор, липсващ active UUID, unavailable модел, отнет достъп, login refresh, runtime/load failure и selection change имат отделни English съобщения. Retry приключва стария run, abort-ва metadata/DB, dispose-ва controller и създава нов. `LOGIN_REFRESH_REQUIRED`/401 изисква ново влизане. Project/token/logout/unmount затварят стария run; извън активния таб няма монтиран Viewer.

## Ръчно въвеждане и независим DB snapshot

Използва се canonical `parseRouting` от `viewer-runtime/protocol.mjs`, без cable-length parser. Съществуващата normalization е изнесена като `normalizeRoutingKey` и се използва и за project tray names:

- до 8000 UTF-16 units; ASCII `/` split преди NFKC;
- пропускане на празните части; NFKC → trim → outer ASCII slash stripping → uppercase;
- вътрешен normalized slash, control и празен key са invalid;
- exact normalized SECONDARY е ignored marker; до 100 nonmarker occurrences;
- order/repeats и индексите по непразните original occurrences, включително markers, се запазват.

Всеки валиден Show започва едновременно нов model check и свеж `GET /api/projects/:projectId/trays`. Новият тесен `src/api/routingTrays.ts` използва explicit token, caller AbortSignal, `no-store`, same-origin credentials, redirect error и 10 секунди deadline. Приема единствено HTTP200 JSON full collection; проверява UUID, уникални tray IDs и project identity на всеки ред. Тялото е ограничено до 16 MiB. Няма pagination/search/query зависимост или fallback към localStorage token.

Един normalized match е `exists`, нула е `missing`, повече от един е `ambiguous`. Raw имената се запазват, затова DB lower(name) uniqueness не скрива NFKC collision. Network/timeout/5xx/invalid или partial response са `unavailable`. 401/403/project404 прекратяват Viewer и изчистват резултатите; не стават missing trays. Непразен unavailable резултат предлага **Retry route check**, който започва нова изрична операция.

DB missing/ambiguous не премахва drawable части от модела. Например `DFC003 does not exist in this project.` е отделно от model missing. Няма запис в routing, trays или model metadata.

## Parent aggregate — договор D

`src/viewer/routeValidation.ts` е pure facade/aggregate. Frame връща само model половината; DB arrays и claims не се изпращат към iframe. Aggregate валидира envelope и сравнява rawRouting/source/cableId, canonical tokens/keys/indices/ignored markers, operationId и protocol/instance/project/modelVersion/load/request identities. Несъответствието е `ROUTE_RESULT_MISMATCH` и не създава смесен резултат.

| Общ статус | Условие |
|---|---|
| invalid | Canonical parser/limit error; няма SHOW_ROUTE или DB read; CLEAR_ROUTE премахва старото overlay. |
| empty | Няма nonmarker occurrences; отделно обяснение за marker-only. |
| none | Няма drawable части. |
| complete | DB е available, всяка occurrence е project.exists и model.found+drawable, lineCount > 0. |
| partial | Има drawable части, но някое условие за complete липсва. |

Model found и drawable са различни. DB unavailable или drawableCount > 0 с lineCount0 не е complete. UI показва компактно състояние, всички warnings и разгъваеми per-occurrence Project/Model подробности, включително ambiguity и found без geometry.

Всеки Show, включително идентичен текст, получава нов operation UUID. Предишният опит се abort/cancel-ва и резултатът/Zoom се скриват веднага. Run/scope/attempt identity guards отхвърлят късни отговори независимо от transport abort. При обратен ред на DB/model completions aggregate чака двете текущи половини. Clear отменя опита и изчиства overlay/result, като запазва текста. Show entire model използва съществуващия clear/reset. Empty/invalid/marker-only/no drawable не оставят стар overlay или bounds.

## Оформление и визуална регресия

Scoped grid: desktop ляв панел320 CSSpx, под900px —280px, под640px — stacked. Панелът има собствен vertical scroll; необходимите контейнери са min-width/min-height0. Текстът на проектното заглавие може да се пренася.

`useRoutingsViewerHeight` измерва действителните anchor top, visual viewport и ancestor bottom paddings под WFC shell/проектното заглавие/tab bar. Няма harness70vh/min450 или фиксиран top offset. ResizeObserver и viewport/scroll listeners се освобождават при unmount. Ако дълго заглавие първоначално постави anchor под прозореца, измерената височина под реалния shell header осигурява scrollable място до разкриването му; след това отново се използва действителното свободно място. Няма глобална AppShell преработка. WFC темата се запазва, Viewer остава светъл.

Geometry алгоритъмът, regression fixture, SDK и runtime rendering са запазени: оригинални материали/цветове, preset7, quality(false,true), tonemap1/exposure1.0, ghost opacity0.025, жълта линия0xffe600, nearest-junction clipping, whole-chain orientation и терминални краища. Непрекъснатите приблизителни connectors са визуално указание с предупреждение, а не инженерно доказателство за физически маршрут или дължина.

Geometry SHA: `4d10d66dca31f10b82926693a0e7438e68f448047f3f991baabb82f6ed2573fa`.
Оригинален route-c regression fixture SHA: `8368d5a9602d45205aead5fdabd2ff9b4d3d41ad5f8f370a7506c7bb6c4cc67d`.

## Проверки и следващи етапи

Текущите резултати, frozen revision, действителните API/browser/regression доказателства и локалното обновяване са в [07-stage-report.md](07-stage-report.md) и новите S7 редове на [00-validation-matrix.md](00-validation-matrix.md). Историческите PASS остават исторически.

Cable integration е за етап8; hover/copy/pin е за етап9; пълни operational/backup/restore проверки и общо приемане са за етапи10–11. Не са добавяни WFC NWD import/conversion, PathFinder или Model Preparer промени, Cable.routing/SECONDARY изчисления или инженерни промени.
