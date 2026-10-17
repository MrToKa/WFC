# Отчет — етап 4: WFC registry/import

Дата: 16.10.2026. Реализацията е в клон `stage4-model-registry-import-20261016`, създаден от локалния WFC HEAD `e4093109e7e10552f1f61093486b9b9fa9bce37b`. Запазени са двата непубликувани cable export ordering commit-а `209cf911ba8045aa4c6b2ef2f9d8a0dfb21cc8ee` и `e4093109e7e10552f1f61093486b9b9fa9bce37b`; remote/main reference е `d5454b3c4c547c24631e37e24d35f76739228867`. Няма push, PR, merge или deployment към текущата работна среда.

## Реализирано

Добавени са private model registry schema/repository, public-verifier distribution, streamed import service, private raw-byte storage/readback, durable request/content reservations, safe metadata/progress API и explicit active selection с optimistic revision. Импортът не активира модел. Няма Viewer/UI, resource sessions, SDK, PathFinder или промяна на cable routing/инженерните изчисления.

Build/API са обновени ограничено до Node24, с непроменени dependency versions. Запазен е отделният малък memory upload за стандартните WFC файлове. Import proxy path има собствен limit/timeouts и предварителна edit authorization проверка, включително URL aliases, преди голямото тяло.

Подробният договор, retries, ограничения, recovery и практическите стъпки са в [04-model-registry-import.md](04-model-registry-import.md). Новите consumer проверки са S4 редовете в [матрицата](00-validation-matrix.md); историческите резултати са запазени.

## Среда и доказателства

Evidence root: `C:\Users\todor.chankov\Documents\Codex\2026-10-16\wfc-model-registry-output\evidence`.

- `baseline.json`: първоначален Git/docs snapshot.
- `environment-baseline.json`: 13 съществуващи контейнера и начални image/port/source наблюдения; SHA-256 `4f4dd6efd1c61661700a9a9ec0f754d99abacf9d7853bef201b9cce8ab99a40a`.
- `environment-final.json`: краен environment/source/input audit, PASS; SHA-256 `21bb585da86d868a4b7005d8e93468f057d6497ea394477042f83920762e9a4d`.
- `00-validation-matrix-stage3.md`: непроменен snapshot на матрицата преди новите S4 редове.
- `historical-source-preservation-final.json`: проверка на десетте стари документа, включително точния исторически byte prefix на матрицата; `final-stage4-evidence-index.json` индексира крайните документи и доказателства по SHA/размер.
- `docker-stage4-20261016/fixture-state.json`: уникален run `ad46acc4-a971-4f7d-9db0-4022b6780e9a`, Compose project `wfc-model-registry-stage4-ad46acc4a971`, command timestamps, exit codes, source inventories и image IDs.
- `docker-stage4-20261016/evidence/`: build/regression/contracts/HTTP/restart/proxy probe logs и machine-readable отчети. Първият build е provisional, със sourceInventoryStable=false поради паралелното довършване на източниците; не е финалното frozen-source доказателство.

Изолирани PostgreSQL18, MinIO, два API процеса и nginx, три нови volumes и отделна internal backend мрежа. Само proxy публикува `127.0.0.1:18084`. Съществуващата работна база/volumes/.env и WFC/Viewer/Preparer услуги не са използвани като тестови fixtures. ZIP входовете са отделни read-only bind mounts, без копие в Git/image.

На 15:36:47.573Z реалната предварителна проверка откри: direct API unauthenticated declared2GiB →401/Continue=false/0 изпратени bytes; nginx →401/Continue=true/65536 изпратени bytes. Този FAIL е запазен в `proxy-auth-probe-before.json`; nginx е коригиран с edit-only auth_request preflight и safe JSON denials. Първият повторен probe (`proxy-auth-probe-after.json`) откри наследения 10m limit на internal authorization location, коригиран целево до същите 2 GiB. `proxy-auth-probe-after-2.json` е PASS: 12 direct/proxy случая, включително encoded UUID, uppercase/trailing-slash aliases, invalid token и липсващ проект; нито един unauthorized Continue или изпратен body byte. Последвалата основна HTTP проверка също покри 19 отказа преди body и 6 aliases.

Финалното приемане на реалния пакет е записано на 16:52:52.772–16:54:03.232 UTC в `model-registry-integration-1792169571400-147ae9e9.json` (6/6 PASS), а проверката след рестарт на двата API worker-а — на 16:54:12.153–16:54:13.169 UTC в `model-registry-restart-1792169571400-147ae9e9.json` (PASS). Това са нови WFC изпълнения, без използване на исторически Preparer PASS като заместител.

Пълното durable доказателство `model-registry-integration-1792169571400-147ae9e9-real-proof.json` е 973170 bytes, SHA-256 `4d05ef40ca7eaf1120e75674759d54042f5b79fe7dab47bf9a97b0a8675645a2`. То съдържа двата WFC verification reports/jobs, alias bindings, PostgreSQL version/selection, readback receipt и всички 342 очаквани/наблюдавани resource SHA/размери. Това е частен тестов отчет с вътрешни storage identities, не API DTO; не съдържа access/owner tokens. `parent-real-evidence-review-final.json` независимо проверява съгласуваността на запазените факти, без нов импорт.

| Реален резултат | Стойност |
|---|---|
| Project ID в disposable fixture | `2e5550a1-878b-4270-a785-55a16da2c472` |
| Един ready/healthy ModelVersion | `d1c1f49e-0b6a-4241-aa7d-7c68dfffa821` |
| Основен ImportJob | `46671e75-8894-4b2f-80f2-56c5af691a65` |
| Втори job, duplicate:true | `91b6f072-c93b-4623-9412-97605262d1d8` |
| Два portable packageId aliases | `ba1d44aa-9062-4c7f-9c84-895245bc0630`, `cc477b02-e0f9-47bc-b965-7064e93404fe` |
| Physical objects / raw bytes | 342 / 439007803, без второ ресурсно копие |
| Fingerprint | `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34` |
| Изрично избрана версия / revision | Същият ModelVersion / 1; запазени след рестарт |
| Anonymous bucket list / object | 403 / 403 |

И двата ZIP входа са предварително проверени по зададените размери/SHA. Двата actual ImportJob byte counters са съответно 439112829 и 439112840. RequestedBy/importedBy са действителният authenticated test user `79397e22-2f56-4392-9472-3a789f9ed783`, а не вход от пакета. Всички 342 readback SHA/size двойки съвпадат и след рестарт.

### Фиксирана крайна ревизия и Docker build

Git HEAD остава посочената локална база; реализацията е непубликувана working-tree промяна в отделния клон, без нов commit. Точната проверена ревизия на източниците е inventory SHA-256 `9846387a8d4bd643687ecef0c69027302cae06c7f1971e2cc758de50ec8d5b5c`. Крайният production-compatible build е изпълнен на 16:50:43.046–16:51:12.066 UTC със `sourceInventoryStable=true`; before/after inventories са `build-1792169443046-sources-before.json` и `build-1792169443046-sources-after.json`.

| Краен image | Docker image ID |
|---|---|
| API runtime | `sha256:d61cb32e56eb048454812a7fdacc4cd3a6d91e2e4515d081b7d74a998e34e79e` |
| Web runtime | `sha256:0446b09d0ae27207c7745cf9cc997dbf5c97ebe9aac8073c24fadae1e8b797de` |
| Изолиран test runtime | `sha256:02a1e57970beef30483c43be67e6a7d55c073ae0608f35a77c1522afa594e272` |

`fixture-runtime-proof-1792169537480.json` доказва крайните два API worker-а: точните горни images, Node24.22.0, uid1000, staging0700, public verifier и частна internal backend мрежа.

Финалният реален HTTP импорт и рестартът са изпълнени върху точно тези API/web images след MPU поправката. По-ранните runtime equality отчети остават исторически; не заменят новото приемане. `minio-server-version.json` доказва MinIO RELEASE.2025-09-07T16-13-09Z и равния image с оригиналния WFC MinIO, без изпълнение или промяна в оригиналния контейнер.

## Проверено

Фокусираните lifecycle/schema unit проверки са изпълнени с инертни dependency doubles, без работна DB или cloud достъп. Широкият Node24 Docker run и real PostgreSQL/MinIO/HTTP проверките са отделни доказателства; unit PASS не ги заменя.

Крайният широк Docker regression е **PASS** на 16:52:25.451–16:57:51.703 UTC: typecheck, lint, build и Vitest са с exit0, immutable test image е непроменен и sourceInventoryStable=true. `1792169578464-regression-vitest.log` отчита **1641 PASS / 4 skip, 0 FAIL**, 97 успешни файла/1 условно пропуснат (98), за 291.66 s. Всичките 26 storage unit cases са включени в този резултат; не са добавени повторно към общия брой.

Четирите skip са единствено съществуващият `server/services/materialIdentitySchema.test.ts`, който изисква `WFC_MATERIAL_IDENTITY_TEST_DATABASE_URL`. Default regression е без мрежа. Същите четири случая са изпълнени отделно срещу disposable PostgreSQL и са **4/4 PASS** в `material-identity-isolated-20261016T1614.log`, със собствена временна schema и teardown. Няма пропусната Stage4 storage проверка в Linux. Един Vitest worker при същите 2 CPU/4 GiB/256 PIDs премахва установеното CPU съревнование, без промяна на timeouts/assertions. Cable export ordering и останалите съществуващи WFC проверки са част от широкия PASS.

Крайните compiled Node contract tests върху реални изолирани PostgreSQL/MinIO са **18/18 PASS, 0 skip** на 16:52:23.213–16:52:31.032 UTC: `final-1792169543213-registry-contracts.json` и `.log` (log SHA-256 `6c7cb68eb335fe9dac2347bc4bf8a2b4cf8f84546a1bb83d0e6e34809c75ccd4`). Те включват действителен child process exit преди publish, storage failure след write, повредени MinIO bytes/readback mismatch, DB failure преди publish, загубен успешен COMMIT reply/reconciliation, project deletion fencing и retained ownership cleanup, revoke на admin права преди publish, availability failure/explicit repair и реалния clear-data HTTP route, който пази моделите.

Един от 18-те случая изпълнява шест отделни невалидни ZIP входа през WFC service и публичния verifier: invalid manifest field → `INVALID_MANIFEST`; schema2 → `UNSUPPORTED_SCHEMA`; unsupported profile и структурно невалиден SQLite с иначе съгласувани SHA/fingerprint → `UNSUPPORTED_PROFILE`; липсващ listed resource → `RESOURCE_MISSING`; променен resource с валиден ZIP CRC → `RESOURCE_HASH_MISMATCH`. Всеки потвърждава safe failure, действителен received counter, липса на нова ModelVersion/objects, cleanup и непроменени стара версия/active selection/revision.

Новият MPU случай доказва реален записан part от 5242880 bytes, нула активни part HTTP requests и все още pending SDK upload между заявките. Source error и caller abort приключват съответно за 77 и 47 ms; след тях собствените complete objects/MPU са 0, чуждият upload ID със своя 5 MiB part остава, а старите ready ресурси и selection/revision са непроменени. Намаленият до 5 MiB SDK partSize е само тестова настройка; реалният properties.db с размер 233991168 bytes в Aalborg използва production multipart пътя с default 64 MiB.

Тестът първо възпроизведе пропуска: complete-object listing не вижда MPU, а MinIO directory-prefix MPU listing връща празно, въпреки реално записан part. Причината е [точното object-key тълкуване в MinIO](https://github.com/minio/minio/blob/master/cmd/erasure-sets.go). Крайният storage използва ограничен read-only root MPU metadata обход, проверява точния owned prefix/key/ID и abort-ва само него; fresh scans доказват липса на собствени остатъци. SDK retries са изключени само за dedicated model client, source/abort се препраща към multipart stream и HTTP close се изчаква преди cleanup. Няма SDK fork, глобално bucket изтриване или промяна на стандартния WFC file storage client. Първоначалните FAIL/probe отчети са запазени.

Ограничените unit проверки допълват покритието за reconciliation outage, unsafe ownership marker, затваряне/abort и capacity. Тези controlled failures не се представят като допълнителни actual crash/DB outage изпълнения. HTTP suite покрива всички реални роли, foreign IDs, current role след JWT, safe DTO, два worker-а, project separation, conflicts, selection CAS/null и реалния пакет. Числото 19 denial requests включва шестте URL aliases и двата missing-project случая.

Първите широки изпълнения откриха ограничени проблеми в старите проверки: Vitest URL mocks изискват абсолютен synthetic VITE_API_URL; stale material-catalog SQL assertion очакваше стара таблица; CableDetails Fluent/Tabster modal fixture с нулев JSDOM viewport скриваше достъпните контроли. В ChangeOrders реалният DOM също показваше наличен Close в DialogSurface с aria-hidden=true. Тестовете вече използват една обща, възстановявана след всеки тест layout фикстура, без дублирани spies; след затваряне изчакват възстановените достъпни контроли, а новоотвореният редактор се затваря преди действията върху основната страница. Крайният focused Docker прогон е 34/34 PASS (`focused-changeorders-lifecycle-29ce736e-dd85-4497-91a9-e6ea00116205.log`), без намалени assertions или увеличени timeouts. Windows cold-start timeout-ите са отделно наблюдение, не доказателство за причината на DOM отказа. Корекциите са само test environment/fixtures/queries. Съществуващите lint грешки са коригирани с parser scope за TypeScript scripts и HTML entity за апостроф, без промяна на показания текст. Няма промяна на изчисленията, cable export ordering или production catalog behavior. Всички неуспешни логове са запазени.

| Статус | Резултат | Основание |
|---|---|---|
| RUNTIME_BUILD_COMPATIBILITY | PASS | Stable production Node24.22 build, pinned verifier/runtime и крайни typecheck/lint/build/1641 tests; 4 DB-gated случая проверени отделно. |
| SERVER_PACKAGE_VERIFICATION | PASS | Крайни 18 compiled Node contracts, шестте нови invalid-input варианта и двата реални imports чрез pinned public verifier. |
| PRIVATE_IMPORT | PASS | Private bucket, raw immutable bytes, full independent 342-resource SHA/size readback, anonymous403, ready/report DB guards. |
| IDEMPOTENCY_AND_CONCURRENCY | PASS | Durable identity/reservation; два API worker-а → една версия/aliases; package/provenance409; отделни project prefixes. |
| AUTHORIZATION | PASS | Actual current-role/foreign-ID matrix; 19 bodyless denials; direct/proxy/alias probes; server-derived audit identity; safe DTO/errors. |
| MODEL_SELECTION_API | PASS | Ready/same-project/health DB guards, explicit null, revisionCAS409, без autoactivation/fallback; наличност и selection след рестарт. |
| FAILURE_RECOVERY | PASS | Actual crash/COMMIT/readback/deletion проверки и нов MPU source-error/cancel: own parts0, foreign MPU/ready/selection запазени; failclosed ownership cleanup. |
| REAL_PACKAGE_IMPORT | PASS | Двата pinned ZIP през actual proxy → една ready версия, aliases2, physical342/439007803rawB, всички SHA равни преди/след рестарт. |
| STAGE_4 | PASS | Реализацията и всички задължителни проверки са завършени; отделната тестова среда е почистена. |
| READY_FOR_STAGE_5 | PASS | Проверена backend основа за protected offline Viewer runtime; не означава реализиран етап5 или готов 3D интерфейс. |

## Почистване и запазване на началното състояние

На 16:59:14.482–16:59:41.103 UTC са премахнати само ресурсите на текущия run: **6 контейнера, 2 мрежи, 3 volumes и 3 неизползвани task images**. След проверката няма останали Docker objects с този run label. Down/image removal командите са exit0. `owned-docker-cleanup-1792169981103.json` е PASS, SHA-256 `78d6843b896e7a5dc338f2b1f90041febf246d832a20ac282b2140efed8153ac`.

Всички 13 първоначални container IDs, image IDs, състояния, StartedAt, restart counts и ports са непроменени преди/след cleanup. Двата ZIP входа са повторно изцяло SHA-проверени и запазени. Host staging/model copies не са създавани; нужните outputs/evidence и историческите FAIL logs остават. Томовете съдържаха 965896952 apparent bytes/970887168 allocated bytes; image sizes споделят слоеве и не се представят като физически освободено host пространство. Base images и shared build cache не са prune-вани.

Промените остават в отделния локален клон без staged файлове или нов commit. Двата първоначални commit-а, main/HEAD и десетте предходни документа са запазени; матрицата има само нов/актуализиран S4 suffix. Историческите policy-blocked targets от етапи1–3 не са опитвани повторно. Този cleanup PASS е само за етап4.

## Ограничения и приемане

Техническа реализация и задължителни проверки: **PASS**. Потребителско приемане на етап4: **NOT_RUN**. Етап5 не е изпълнен: няма защитен browser Viewer runtime, ресурсни сесии, Details selector или 3D таб. Пълното operational acceptance на backup/restore/retention и втори компютър е **NOT_RUN**, за следващите приети етапи. Published objects на изтрит проект се запазват за изрична бъдеща retention процедура. Health е последното наблюдение на наличността, без обещание срещу външна административна повреда.

Няма Autodesk/Preparer заявки, Autodesk credentials, SDK или runtime downloads в този етап. Build dependency/image retrieval е отделен от offline runtime проверките. По-ранните policy-blocked cleanup targets от етапи1–3 не са опитвани повторно; техните исторически BLOCKED резултати остават валидни за съответния scope.
