# Етап 5 — отчет за защитения офлайн Viewer

**STAGE_5: PASS. READY_FOR_STAGE_6: PASS** за проверения loopback HTTP режим, Docker и development proxy, Chrome Headless Shell 153.0.8010.12. Потребителското визуално приемане, LAN/HTTPS, други браузъри и втори физически компютър остават NOT_RUN.

## Ревизия и разрешен обхват

Клон `stage5-protected-viewer-runtime-20261016`, HEAD `e4093109e7e10552f1f61093486b9b9fa9bce37b`. Цялата tracked/untracked реализация на етап 4, документацията и двата cable export commit-а са запазени. Няма push, PR или merge. Етап 5 е working-tree реализация; чист checkout от HEAD/main няма автоматично да я съдържа.

След приключилия backup потребителят изрично разреши промени в съществуващите WFC контейнери и избра **HPU Aalborg**. Уникалният съответстващ проект е `HPU Aalborg 2023`, ID `0c0007c9-d73f-4d13-bc87-601c544727b7`. Последващото разрешение заменя забраната за deployment в първоначалния handoff. Fault проверките са в отделни fixtures. PathFinder, Cable.routing, инженерните изчисления и UI от етапи 6–9 не са променяни от този етап. Autodesk/APS и Model Preparer не участват в изпълнението.

Финалният build inventory е **805 файла / 145025378 bytes**, SHA-256 `bbc38881f97bb365cab529a23beaede075745efb51fd4d29fed98eebc7247a97`. Обхватът е дефиниран от `scripts/viewer-sessions/run-stage5.mjs`; включва локалната SDK доставка и изключва docs/env/build caches. Source inventory е стабилен преди/след final build и regression. Отделният `final-stage5-source-inventory.json` обхваща versionable файловете и документацията; `final-stage5-evidence-index.json` свързва размерите/SHA на източниците, отчетите и доказателствата.

## Реализиран резултат

Подробният договор и reusable API са в [05-protected-viewer-runtime.md](05-protected-viewer-runtime.md). Добавени са durable login-bound resource sessions; текущи DB authorization и selection/health fences; cookie-only descriptor/resources с full SHA-verified delivery; локален SDK 7.130.0; strict bridge; cancellable runtime и родителски ViewerController. Compile-gated harness използва истински WFC login и активния модел, без importer/selector UI.

Новите login tokens имат уникален `jti`. Старите tokens остават валидни за обичайните WFC операции; Viewer изисква еднократно ново влизане. Secret е random 256-bit и се съхранява само като hash. Cookie е HttpOnly/Strict с exact session Path; sliding expiry 5 min, parent renewal през 3 min, absolute lifetime 30 min. Logout първо освобождава локалния Viewer, после revoke-ва само съответния login. Durable tombstone огражда конкурентно create. Network-failed revoke не се представя като успешен server acknowledgment.

Resource GET/HEAD/Range чете и проверява целия raw object преди успешни headers, обслужва същия pinned spool handle и recheck-ва правата след I/O. При повреда версията става unavailable; при временен storage outage няма измислена corruption диагноза. Private/no-store/nosniff, raw gzip, точни 200/206/416/405/404, без public/presigned URL, permissive CORS, SPA fallback или избор на друг модел.

## SDK и hosting

206 оригинални SDK assets / 82552768 bytes съвпадат с original offline Viewer и pinned manifest SHA `747540a153fb18809c428d8ed177aa8a296cff1b5175ab85445e0a2ebdb36d75`. Пълната доставка е **216 файла / 83034438 bytes**, inventory SHA `057b2895937356826bd7a968e3e77cd0dba62737316f23bac3ebbe07676ee498`. Build/dev възпроизвеждат доставката от repo; няма host абсолютна runtime зависимост, download или CDN fallback.

`route-geometry.mjs` и оригиналните regression fixtures са byte-preserved. Geometry SHA е `4d10d66dca31f10b82926693a0e7438e68f448047f3f991baabb82f6ed2573fa`. Отделен derived stylesheet заменя 54 font URL адреса с локалния Arimo, без редакция на SDK оригиналите. Запазени са оригиналните материали/цветове, preset 7, quality(false,true), tonemap 1/exposure 1.0, ghost 0.025 и линия 0xffe600.

Реалното приемане откри и коригира `.mjs` MIME mapping и SDK `domain=<location.origin>` resource query. Допуска се само една точна domain стойност, равна на вече валидирания request origin, само за resource GET/HEAD. Други/дублирани/foreign queries и query върху descriptor/control endpoints се отказват. SDK env Local изисква изрични useCredentials/useCookie настройки; actual geometry/property workers доказват cookie transport. nginx/dev header probes потвърждават локални MIME, nosniff, SAMEORIGIN и CSP без unsafe-eval.

Final read-only review откри selection timer, останал при едновременни focus/visibility проверки. Поправката отменя предишния deadline. Regression възпроизвежда старите три вместо два timers; след поправката има един selection deadline и dispose оставя нула timers. Във финалния typecheck е коригирана и прекалено тясна UUID default inference в тестовия helper.

## Работещ WFC и моделът Aalborg

WFC: [http://127.0.0.1:5180/](http://127.0.0.1:5180/).

Контролиран преглед: [HPU Aalborg 2023 — Viewer](http://127.0.0.1:5180/projects/0c0007c9-d73f-4d13-bc87-601c544727b7/viewer-harness). Влезте отново веднъж, ако token е издаден преди добавянето на `jti`; след това изберете „Зареди активния модел“. Harness е изрично включен за тази локална инсталация; normal build default остава disabled.

Primary Stage3 ZIP: 439112829 bytes, SHA `8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5`. Проверен и импортнат през Stage4 HTTP API. ModelVersion `9dbe511d-9c51-49e8-bb4a-b52033b98f35` е ready/healthy, **342 ресурса / 439007803 raw bytes**, fingerprint `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`. Активиран е изрично с CAS, selectionRevision **1**; не е използван latest/automatic fallback.

Maintenance Bearer за разрешеното действие на текущия администратор Todor Chankov е бил само в process memory/child pipe. Не е записан в source/evidence/URL/bridge. Временните maintenance sessions/login resource grants са прекратени и проверени. `working-model-import.json` и `working-runtime-final-smoke.json` съдържат безопасните резултати: cookie-only descriptor, full SVF SHA, exact domain query, HEAD/Range, отказ без cookie/с чужд domain и revoke 204.

Обновени са съществуващите `wfc-app-backend-1` и `wfc-app-frontend-1`; двата са healthy. `docker-compose.app.yml` възстановява липсвалия compose definition; helper използва текущите credentials само в паметта. Добавен е persistent model-import staging volume; старите PostgreSQL/MinIO volumes и останалите услуги са запазени.

| Образ | Работна среда | Финална изолирана проверка |
|---|---|---|
| API | `245c23000f8048576780c29273d762303b877655c0276d70c787ed4fe8c7bfa3` | `868d43be822f09e46c5fc9d28d10fd255356319714ac4f3d27e891c4106c45fa` |
| Web | `eb508153aeae5a505859499f69d44d44f3e721e0d20fd891588bc7edf78f9797` | `a284c20913a92aa5d268d8065031ba545e0b14da95c55c2fa712f9ea7f27af17` |
| Test | — | `713fd8046972a6357f621c13de08dcd726a8bad5bba710dc983e50e32d7c3fb6` |

`final-runtime-distribution-and-headers-v2.json` доказва exact byte equality: **163 API distribution files**, canonical SHA `44f4d2a8e3dfe201b81efb9de5927b2dbee2b2d728ebc7b79eb58f71437e895b`; **285 served web/nginx files**, canonical SHA `93f1696657493b371cc885f8c7ed769e7cc678a439b07135bda00b2afffca9aa`. Различните image IDs са след последващи test-only промени. Не е необходимо ново пресъздаване на работните контейнери заради тестовия proxy/helper.

## Нови изпълнения в етап 5

Evidence root: `C:\Users\todor.chankov\Documents\Codex\2026-10-16\wfc-protected-viewer-output\evidence`. Fixture run `e70ce393-ec64-4441-bb53-34dc72d3c087`, compose project `wfc-viewer-sessions-stage5-e70ce393ec64`. Два API worker-а, PostgreSQL и private MinIO са в отделна internal network, с отделни volumes; browser proxy е 18085, development 15185. Оригиналните работни данни не са fault fixtures.

| Проверка | Резултат и точна граница |
|---|---|
| Финален immutable regression | **PASS**, 18:35:04–18:41:14 UTC, Node24.22.0/Linux/uid1000/network none/2CPU/4GiB/един Vitest worker; typecheck, lint, build exit0; source stable и test image unchanged. |
| Runtime Node | **69/69 PASS**: 67 protocol/bridge/geometry/adapter случаи и 2 browser-boundary policy случая. |
| WFC Vitest | **1670 PASS, 4 DB-gated skips**, 100 files PASS/1 skipped; 313.55s. Изричен VITE_API_URL=http://localhost:4000 запазва очакванията на съществуващите HTTP mocks; реалният browser проверява same-origin API. |
| Допълнителни DB случаи | **4/4 PASS** в собствен временен PostgreSQL schema с teardown, image ef375…, без промяна на app schema; production/application bytes са непроменени във final build. Не се отчита като нула skips в основния Vitest log. |
| Actual PostgreSQL/MinIO/session contracts | **29/29 PASS, 0 skip** върху финалната distribution: всички роли, foreign IDs, текущи права, expiry/renew/absolute expiry, two-worker login/selection/health races, raw resource HTTP/integrity/abort и 18 Stage4 contracts. `final-registry-contracts-1792175786201.{json,log}`. |
| Stage4 HTTP consumer regression | **6/6 PASS + restart PASS**, извършени наново в този етап: actual primary import/dedup/explicit selection и SHA/size readback на 342 ресурса. Последващите изменения са тесни session query/MIME/parent/test fixes; compiled importer/selection/auth/package bytes са independently pinned и запазени. |
| Auth/parent focused host run | **16/16 PASS** (9 parent + 7 Auth), включени и във full Vitest; не се сумират повторно. |
| Финален browser | **14/14 PASS**: Docker7/7 + development7/7, fresh contexts/empty cache/service workers blocked; browser153.0.8010.12, matching локален Playwright1.63.0, SwiftShader. |
| Settled route screenshots | **4/4 PASS**: двата маршрута във всеки режим; 2s след zoom ACK плюс два последователни еднакви canvas SHA samples. Четирите PNG са визуално прегледани от parent. |

Browser изпълнението е 18:34:06–18:35:51 UTC, `browser-1792175645372-9a8df49f-summary.json`. Във всеки режим двата реални imported models са едновременно заредени: **664556 fragments, 438156 indexed nodes, 6 actual properties** за всеки. Имат различни native HttpOnly/Strict cookie paths; dispose на единия запазва descriptor/resource HEAD 200 за другия.

Проверени са реални orbit canvas changes, active native measurement toolbar/Done, active section plane, видим properties panel, resize/hide/reveal, repeated dispose during loading, genuine delivered same-origin sibling MessageEvent (origin/source/isTrusted positive control), forged origin/oversize rejection и logout в друг таб. Acknowledged revoke връща 410 за стария login, отделен login остава 200. При изкуствено aborted revoke локалният Viewer се освобождава, незасегната стара сесия още е 200 и expiry deadline е до300000ms. Това е browser TTL-bound доказателство; няма твърдение за изчакани пет реални минути. Actual expiry denial е отделно покрит от API contracts.

Whole-browser proxy отказва всички други HTTP/CONNECT destinations. Точният локален CONNECT е разрешен само за Vite HMR; worker и WebSocket positive controls са изпълнени отделно. Final Docker: 887 proxy requests; development: 1156; всеки режим има 679 protected resource requests и 20 наблюдавани SDK workers. **0 external denials/attempts, 0 page/worker blocked external requests, 0 CSP violations** във final runs. Няма blanket console0 claim: отрицателните logout случаи очаквано дават 410 и изкуствен net::ERR_FAILED.

Двата зададени маршрута имат по10 unique/drawable tokens и една непрекъсната линия; SECONDARY е ignored marker. Стабилните изображения показват запазени цветове, ghost context, близките връзки и крайните сегменти. Това е моделната половина на резултата; няма project DB validation или инженерно приемане. Доказателства: `settled-routes-1792175886557-1fa70c13.json`, четирите mode/route PNG и `visual-review-settled-routes.json`.

## Отделни статуси

Всички PASS по-долу се отнасят до горната ревизия и проверения localhost HTTP browser/deployment обхват.

| Статус | Резултат | Доказателство |
|---|---|---|
| SDK_DISTRIBUTION | PASS | Pinned206assets, reproducible216file distribution, inventories и actual MIME/CSP probes. |
| SESSION_AUTHORIZATION | PASS | Final29actual contracts; роли, foreign IDs, current DB rights, two workers. |
| RESOURCE_HTTP | PASS | Finalactual GET/HEAD/206/416/405/path/rawgzip/integrity contracts и browser worker transport. |
| LOGIN_LOGOUT_REVOCATION | PASS | Durable login tombstones, first-create race, actual cross-tab/independent-login/network failure и bounded TTL. |
| MODEL_SELECTION_FENCING | PASS | Selection revision, away/back, create/renew/select/health races върху actual PostgreSQL. |
| BRIDGE_PROTOCOL | PASS | Strict69Node/parent proofs плюс genuine sibling/oversize/current-load browser checks. |
| REAL_BROWSER_MODEL_LOAD | PASS | Final14browser cases; реални imported342resource models, geometry/index/properties и native cookies/workers. |
| ROUTE_GEOMETRY_REGRESSION | PASS | Byte-preserved algorithm/fixtures, двете реални трасета, settled4/4 и visual review. |
| OFFLINE_RUNTIME | PASS | Fresh empty-cache contexts, exact-origin whole-browser boundary, page+worker observation, no Preparer dependency. |
| DEVELOPMENT_AND_DOCKER | PASS | И двата реални hosting режима; MIME/CSP/noeval/nativecookies и строг локален Vite HMR CONNECT. |
| STAGE_4_REGRESSION | PASS | Current actual contracts, повторен import/dedup342hashes/restart, full1670+DB4 и preservation audit. |
| STAGE_5 | PASS | Всички задължителни технически проверки за заявения режим са изпълнени. |
| READY_FOR_STAGE_6 | PASS | Reusable foundation е готова; Details selector остава отделен следващ етап. |

## Одити, почистване и ограничения

`final-preservation-audit.json` проверява оригиналните 2140 Cable.id/routing и 330 Tray.id/name спрямо baseline, 11 незасегнати container IDs/images/status/StartedAt/ports и нормализирани пълни mount sets; оригиналните DB/MinIO volume bindings са запазени. RestartCount не е записан в началния baseline и не се представя като сравнен. Първите11 исторически документа са exact unchanged; първите93928bytes на validation matrix запазват SHA `aeb2a0699b956e725b4f503770218d92b274e7771489df6653bc1a9289f7304a`. S5 редовете са само suffix.

Cleanup е **PASS**: премахнати са **7 тестови контейнера, 2 мрежи, 3 тома и 7 неизползвани run-owned images**; exact fixture project има0remaining containers/networks/volumes. Двата текущи WFC images са запазени въпреки наследения run label. `fixture-cleanup-receipt.json` сравнява всичките13 nonfixture containers преди/след cleanup: exactIDs/images/state/StartedAt и текущия RestartCount са запазени. Това cleanup comparison не заменя липсващия първоначален Stage5 RestartCount baseline.

Един label не се използва самостоятелно за container deletion; проверяват се exact compose project и references. Премахнат е и 40957-byte Stage5-generated TypeScript cache;13 наблюдавани Chrome processes,3 browser/proxy Node processes и временните profiles са затворени. Shared cache/base images, първоначалните inputs/evidence и легитимният working MinIO модел са запазени. Няма prune/force/global Docker restart или повторение на исторически blocked cleanup targets. Предварителните statistics на изтритите test volumes са1391617423logical/1414594560allocatedbytes; това не е твърдение за свиване на Windows Docker VHDX.

Финалният credential audit проверява literal/encoded варианти на реалните текущи WFC credentials само в паметта срещу task outputs и new/changed source, без запис на стойности/snippets. Пиннатите оригинални SDK assets са отделен hash-verified обхват. Отчетите за тестовите fixtures могат да съдържат изрично synthetic fixture настройки; реални JWT/cookie values и WFC secrets не се записват в evidence. Точните scan coverage/counts и хешове са в final scan и index.

Ранните неуспешни изпълнения са запазени: transient containerd snapshot export с ограничен retry; Fluent label/native tool test selectors; MIME и SDK domain rejects; timer regression; test-helper type inference/source-guard failure; development HMR proxy denials. Първият Chrome155 опит има блокирани продуктови background CONNECT requests преди SDK и не е offline PASS. Междинният preservation falseFAIL е само редът на еднакви mount objects; corrected audit сравнява всички полета като нормализирано множество. Предварителните route PNG са заснети по време на camera animation; settled proof ги допълва, без промяна на приложението.

LAN, HTTPS, други браузъри/GPU среди, втори физически компютър и отделното потребителско визуално приемане са **NOT_RUN**. Details selector, Routings viewer/manual DB validation, cable list/search и popover са етапи6–9; full backup/restore/retention е етап10; общото приемане остава етап11. Историческите Stage0–4 резултати са запазени и не са представени като нови изпълнения.
