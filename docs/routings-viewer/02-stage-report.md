# Етап 2 — отчет за Model Preparer core

Дата: 16.10.2026, Europe/Kiev, UTC+03:00. Реализирано и проверено е самостоятелно Node.js 24 ядро с **имитирани provider/transport/cost отговори**. Реална Autodesk/cloud операция не е извършена. Новото ядро използва непроменения публичен Package A API; готовият Aalborg ZIP е регистриран локално, без ново преобразуване или измислена история на remote операции.

```text
STAGE_2_CORE: COMPLETE
DURABLE_RECOVERY_TESTS: PASS
DUPLICATE_SUBMISSION_TESTS: PASS
ZERO_COST_GATE_TESTS: PASS
PACKAGE_ADAPTER_TESTS: PASS
LIVE_CLOUD_VERIFICATION: NOT_RUN
REAL_CLOUD_ACTIONS_PERFORMED: NO
READY_FOR_STAGE_3: YES
CLEANUP: BLOCKED
```

`READY_FOR_STAGE_3` означава, че API и ядрото са готови за UI/Docker обвивка. Това не е production/end-to-end приемане или проверка на действителна цена 0. Почистването на три малки директории, създадени от задачата, остава неизпълнено след автоматичен отказ; критериите за приемане на ядрото са покрити.

## Начално състояние, договори и запазване

Преди редакциите са прочетени приложимите глобални и проектни AGENTS инструкции и шестте документа от етапи 0/1. WFC checkout е `C:\Users\todor.chankov\source\WFC`, не `work/review-wfc`. В 12:09:02 проверките без промяна на branch/HEAD/ahead-behind/live-remote/status показват `main`, `d5454b3c4c547c24631e37e24d35f76739228867`, ahead/behind 0/0 и същия SHA за live `origin main`. Няма промени в проследяваните или staged файлове на приложението; шестте предходни документа за етапите са untracked. Няма подходящ съществуващ Preparer модул; новата поискана директория не съществуваше.

[baseline.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-preparer-output/evidence/baseline.json) записва отпечатъците на source/document/ZIP файловете и предварително наличните контейнери. SHA на инвентара на кода от етап 1 е `736979f65d93638a523dc981cb57e719b66d042f9dc2e1710c6e2a0216a52d1e`; 23 source файла са повторно сверени без несъответствия. ZIP е 439112840 bytes, SHA `e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922`.

Етап 2 означава **Model Preparer core** според изричното задание, а етап 3 — UI/Docker/workflow. Предложената алтернативна номерация в историческия `00-specification.md` не е приета или пренаписана. Договор A, §8 и относимите PREP правила са запазени; WFC importer не е започван. [02-model-preparer-core.md](02-model-preparer-core.md) описва проследимото съответствие и реализирания API.

Целево са прегледани като текст старите Viewer файлове `lib/aps.js`, `lib/state.js`, `lib/config.js`, `scripts/prepare-offline.js`. prepare-offline/vendor-viewer не са импортвани или изпълнявани. Не са четени `.env`, credentials, променяемо online състояние или Docker volumes; няма автоматична миграция на старите данни. Старият APS код запазва unknown marker/no-force/no-retry, но има опашки в рамките на процеса, фиксирани пътища, избор на първия root и SVF2 заявка. Новото ядро изрично използва поддържания SVF, устойчив журнал за отделните процеси и актуално обвързване с имитираното cost evidence; не променя стария код или runtime.

[preservation.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-preparer-output/evidence/preservation.json), 12:46:31, потвърждава, че са непроменени 23 Package A файла, 342 raw ресурса на модела и петте исторически baseline/specification/reports/tooling документа. Хешовете на ключовите Viewer файлове и NWD с размер 155285346 bytes/SHA `11b2739d92020ee58a52a4e793cf8fd538fb30758eb42176aba93ac7319b048a` съвпадат. Оригиналният ZIP и fingerprint/UUID са непроменени. Sources/project mirror и файловете на WFC приложението не са редактирани.

Ограниченията от етап 1 остават видими: почистването на `.relocation-check` е предварително BLOCKED и **не е повтаряно**; историческият browser smoke използва временна подмяна на font-response и не доказва production CSP приемане; portable sourcebasis остава `observed-local-file`; лимитът от 1 GiB за nested structured данните и отделните terminal bounds не са изменяни. Историческите 168 теста и browser smoke от етап 1 не са изпълнявани отново или представяни като нови резултати.

## Нови/променени директории и файлове

Новият самостоятелен локален модул е `C:\Users\todor.chankov\source\routings-model-preparer`, версия 1.0.0, ESM, Node 24.19.0, с 0 външни зависимости. Няма локално или remote Git repository, publish/push/PR/merge, UI/server/Docker/service или WFC/PathFinder imports. [README](C:/Users/todor.chankov/source/routings-model-preparer/README.md) съдържа действителните API/CLI, конфигурация, зависимости и тестови команди.

Всички 28 source файла и SHA-256 са в [code-inventory.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-preparer-output/evidence/code-inventory.json), проверен на 13:04:13+03:00. SHA-256 на инвентара: `f59a9d8352c46fbf4a7c9279143787b84d910130e838c1281138801b4a0933a0`. След пълния тестов run е уточнена само документацията в README; изпълнимият код и тестовете са непроменени.

```text
.gitignore
package.json
README.md
cli.mjs
index.mjs
lib/contracts.mjs
lib/core.mjs
lib/store.mjs
lib/cost.mjs
lib/providers.mjs
lib/package-adapter.mjs
docs/store.md
docs/cost.md
docs/package-adapter.md
schemas/job-state-v1.schema.json
schemas/store-record-v1.schema.json
test/helpers.mjs
test/core.test.mjs
test/cost.test.mjs
test/providers.test.mjs
test/store.test.mjs
test/recovery.test.mjs
test/package-adapter.test.mjs
test/pipeline.test.mjs
test/fixtures/store-child.mjs
test/fixtures/core-child.mjs
test/fixtures/model-fixture.mjs
tools/verify-existing-package.mjs
```

В WFC са нови само `docs/routings-viewer/02-model-preparer-core.md` и този отчет; матрицата е актуализирана с отделни **S2-CORE** редове. Оригиналните PREP-01–08 за пълния workflow и всички UI/Docker/live/WFC критерии остават NOT_RUN. Предишната матрица е [00-validation-matrix-stage1.md](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-preparer-output/evidence/00-validation-matrix-stage1.md), SHA `c9457d0e956600f6f68b2a28fa7e5b3b46c813a57e4df6b2982b8b57ad54a037`.

Новата директория за артефакти е `C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-preparer-output`. Доказателствата включват baseline, snapshot на предишната матрица, core-tests.tap/core-test-run/core-test-summary, обикновена и guarded existing-package-registration, offline audit, preservation, code-inventory и cleanup. Последната проверка на обхвата се записва отделно във final-scope JSON. Останалата `.adapter-check` съдържа само 5 малки local-store файла, без копие на големия модел или ZIP. Двете малки остатъчни Temp директории са описани по-долу.

## Проверки и конкретни резултати

Пълната команда е изпълнена от директорията на новия модул:

```powershell
node --test --test-concurrency=1 --test-reporter=tap test/*.test.mjs
```

[core-tests.tap](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-preparer-output/evidence/core-tests.tap): **154 PASS / 0 FAIL / 0 skipped / 0 cancelled**, 113257 ms. [core-test-run.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-preparer-output/evidence/core-test-run.json): 12:41:24.519–12:43:17.844+03:00, Node v24.19.0, exit 0. [core-test-summary.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-preparer-output/evidence/core-test-summary.json) съдържа имената на тестовете, броя им по категории и флаговете за етапа.

| Проверка | Статус | Доказателство/версия/обхват |
| --- | --- | --- |
| Core identity, cost, state, abort, read budgets и неизменяем spec/provider context | PASS | 38 core теста; промени в caller/source/snapshot/account/region/settings и отказ при последното approval. |
| Crash/race/recovery с реални независими процеси | PASS | 6 recovery теста: две задачи/процеси; преди и след intent; след remote acceptance; двама възстановяващи процеса; crash при cost lock. Имитираното remote acceptance се записва в контролиран локален fixture журнал. |
| Устойчив store, locks, bootstrap, загуба на roots, chain и snapshot | PASS | 22 store теста; реални child процеси, повреден/прекъснат запис и head несъответствие, crash след afterRecordCommit, отказ да се третира загубен root като нов store, неуспешни записи и промяна на source. |
| Граница на имитираните cost/provider/transport | PASS | 52 теста; всички класове gate откази, точно обвързване, брой операции, изтичане, attestation, непроверими отговори без изтичане на тайни, raw gzip, прекратено изчакване и затворен real adapter. |
| Raw download с възстановяване и package adapter | PASS | 33 теста; изричен root, липсващи properties/препратки, SHA и размер на checkpoint, граници на частичното сваляне, abort/junction, публични pack/verify върху малък пакет и запазване на последния добър пакет. |
| Пълна интеграция на core със синтетичен модел | PASS | 3 pipeline теста; 3 файла, 864 raw bytes; capture/upload/intent/receipt/reconcile/download и публично пакетиране/проверка, избирателно повторно сваляне след restart, запазени lastGoodPackage и ZIP при провал. |
| Регистрация на съществуващия Aalborg пакет с публичния verifier | PASS | 12:39:10–12:39:31, existing-package-registration.json; 0 provider извиквания, kind=`registered`, без remote история. |
| Guarded регистрация на Aalborg с окончателния код | PASS | 12:46:21.175–12:46:29.963, existing-package-registration-guarded.json; същите 342 файла/raw bytes/transport SHA/UUID/fingerprint; 0 provider извиквания. |
| Инструментирана offline проверка и забранени source четения | PASS | existing-package-offline-audit.json; 0 network опита / 0 забранени четения / exit 0; Viewer root и NWD parent са забранени. Това е инструментация в процеса, а не OS sandbox. |
| Запазване на първоначалните входове, код, документи и пакет | PASS | preservation.json, 12:46:31; старият пакет, Viewer, NWD, raw ресурсите и петте исторически документа са непроменени. |
| Липса на собствени процеси, нови контейнери, service и UI | PASS | cleanup.json, 12:49:16; 0 собствени Node процеси, 0 нови/премахнати контейнери; съществуващите services са запазени. |
| Почистване на временните данни от етап 2 | BLOCKED | Автоматичният контрол отхвърли ограниченото native изтриване с „blocked by policy“; остават 3 директории / 7 файла / 5044 bytes. |
| Live account, действителна текуща цена 0, quota и APS изпълнение | NOT_RUN | Няма реални credentials, account заявки, upload или conversion; real provider остава затворен. |
| UI/Docker/операторски workflow, WFC/browser/втори компютър | NOT_RUN | Бъдещи задачи; няма автоматичен преход към етап 3 или production приемане. |

Тестовете използват имитирани provider/transport/clock и контролирани файлове. Тестовете с child процеси действително прекратяват процеси на границите на устойчивите записи; не симулират само опашка в един процес. Неизменяемите attempts остават в авторитетния общ журнал при промени на label/job/output и повторно 404/pending reconciliation. Не се обещава универсално remote exactly-once изпълнение.

Независимият преглед откри и поправи пет конкретни пропуска преди окончателното пълно изпълнение: изтичане на cost evidence между резервирането/записа и мутацията; преждевременно локално downloaded състояние при remote success; stop по време на polling backoff; промяна на избрания spec от извикващия преди завършване на capture; запазване на старо approval след нов отказ. Регресионните тестове покриват всеки от тях, както и променяем provider context, изрично cost-lock recovery и загуба на bootstrap evidence root. Ранните проблеми в тестовите fixtures с временен path alias и failed derivative са поправени; няма останал неуспешен тест, представен като PASS. По време на разработката на store тестовете са прекъснати два fixtures със зависнали child stdin. Окончателният fixture затваря stdin и всичките 22 теста минават, но малките им стари Temp директории не можаха да бъдат изтрити след отказа от автоматичния контрол.

## Ограничена интеграция със стария пакет

Готовият пакет се проверява, **не се преизгражда**. Действителната команда е изпълнена от директорията на новия модул:

```powershell
node tools/verify-existing-package.mjs `
  "C:\Users\todor.chankov\source\routings-model-package\index.mjs" `
  "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output\aalborg-svf-v1.zip" `
  "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-preparer-output\.adapter-check\data" `
  "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-preparer-output\.adapter-check\work" `
  "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-preparer-output\evidence\existing-package-registration.json"
```

Guarded изпълнението използва следната точна команда:

```powershell
$guardUri = ([uri]'C:\Users\todor.chankov\source\routings-model-package\tools\offline-guard.mjs').AbsoluteUri
$auditPath = 'C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-preparer-output\evidence\existing-package-offline-audit.json'
$viewerRoot = 'C:\Users\todor.chankov\Documents\Codex\2026-10-15\https-get-started-aps-autodesk-com\outputs\aps-local-viewer'
$sourceParent = 'D:\OneDrive - ACS\R230039_MAN-Aalborg HPU - LVSG & UPS DB & EIC\3D'
$guardImport = $guardUri + '?report=' + [uri]::EscapeDataString($auditPath) + '&forbid=' + [uri]::EscapeDataString($viewerRoot) + '&forbid=' + [uri]::EscapeDataString($sourceParent)
node --import $guardImport tools/verify-existing-package.mjs `
  "C:\Users\todor.chankov\source\routings-model-package\index.mjs" `
  "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output\aalborg-svf-v1.zip" `
  "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-preparer-output\.adapter-check\data" `
  "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-preparer-output\.adapter-check\work" `
  "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-preparer-output\evidence\existing-package-registration-guarded.json"
```

Стойностите в guard query са URL-encoded пътища; report sidecar файловете се създават с exclusive writes. Незадължителният audit инструмент е инструментация само за четене, без нова runtime зависимост или използване на private package API. Core adapter импортва само изрично зададения public index.mjs. Read/list след регистрация също са само локални; registered задачите имат submission=null.

| Идентичност на съществуващия пакет | Проверена стойност |
| --- | --- |
| ZIP bytes / SHA | 439112840 / `e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922` |
| packageId | `cc477b02-e0f9-47bc-b965-7064e93404fe` |
| contentFingerprint | `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34` |
| Raw ресурси | 342 / 439007803 bytes |
| sourcebasis | `observed-local-file` |
| Guarded локална регистрация | jobId=`b5744f41-ece5-4aa1-948f-cf4e74745cc9`, kind=`registered`, state=`registered`, 0 provider извиквания, без remote история |

Core заснема нов вход и записва действителната идентичност на заснетите байтове в собствените си локални записи; в тези тестове връзката с provider е **имитирана**. Непромененият packModel продължава да издава `observed-local-file`. Старият ZIP и синтетичният fixture не получават измислен произход `captured-at-conversion`. Не се твърди проверка на BinaryPackFiles/SQLite семантика или приемане на реално conversion/geometry изпълнение.

## Цена, възстановяване и оставащ етап 3

Cost evidence е актуално и точно обвързано, но всички приети разрешения са само имитирани. Няма текущо доказателство за действителна цена 0 или безплатен allowance; live проверката е NOT_RUN. Не е измислян или запитван Autodesk pricing/quota API. Closed-real adapter няма credentials/network реализация или флаг за активиране. Бъдещото активиране на реален adapter изисква поддържано operator/account доказателство за точните account/source/settings/destination/operations/allowance, неговата валидност и произход, както и отделно разрешено live изпълнение.

Unknown submission никога не се подава повторно автоматично. Readback 404/pending, изминало време или ново approval не могат да заличат intent. Failed derivative изисква операторско reconciliation и бъдещо изрично решение, без force. Quota usage се резервира устойчиво и се запазва при неизвестен резултат. Актуалността се проверява отново синхронно непосредствено преди мутацията. Stop записва локално прекъсване с remoteCancellationConfirmed=false за проследяваните approveCost/prepare/reconcile/waitForDerivative/download/buildPackage операции, включително backoff изчакване. captureJob/registerPackage се прекратяват чрез AbortSignal на извикващия. Store отказва работа при двусмислени owners, повредени roots и частични record/head commits. Обхватът на file fsync/process-crash проверките не гарантира устойчивост при отпадане на захранването на Windows host или злонамерени промени по файловата система.

Етап 3 остава за UI, Docker включване на двата изрично зададени модула, persistence/work mounts, операторски start/stop, избор на source и approval/status/reconciliation/download/package действия. Тук не е реализиран UI, service, container build или start script. WFC importer/DB/MinIO/Details/iframe/session/PathFinder остават извън задачата.

## Почистване

Cleanup hooks на обичайните успешни/неуспешни тестови fixtures премахнаха собствените си изолирани файлове. Всички Node child процеси, създадени от задачата, са спрени; нови контейнери — 0, премахнати съществуващи контейнери — 0. Машинният отчет [cleanup.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-preparer-output/evidence/cleanup.json) записва трите остатъчни директории, общо 7 файла/**5044 bytes**, 0 reparse points:

```text
C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-preparer-output\.adapter-check
C:\Users\todor.chankov\AppData\Local\Temp\preparer-store-dnmTGp
C:\Users\todor.chankov\AppData\Local\Temp\preparer-store-wThAs4
```

`.adapter-check` съдържа 5 локални verification-store файла/4672 bytes. Двете директории от прекъснатите тестове съдържат по един bootstrap файл с размер 186 bytes. Тези три директории могат да се премахнат ръчно; source кодът, доказателствата и оригиналният ZIP от етап 1 извън тях трябва да се запазят.

Автоматичният контрол отхвърли провереното и ограничено native PowerShell изтриване преди изпълнение с причина **„blocked by policy“**, без допълнително обяснение. Тези директории не са изтрити и няма обход чрез друга среда или повторни варианти. Предишната `.relocation-check` от етап 1 остава отделно BLOCKED и не е била цел на тази задача. Не се твърди, че цялото поискано почистване е завършено.

Последната проверка на Git обхвата и document/source отпечатъците се записва в [final-scope.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-preparer-output/evidence/final-scope.json). Всички осем документа за етапите остават untracked; няма staged промени, commit, source app diff, push/PR/merge или автоматично преминаване към етап 3.
