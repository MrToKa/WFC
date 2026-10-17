# Етап 2 — самостоятелно ядро на Model Preparer

Настоящият етап следва първоначалната номерация от изричното задание: 0 — договори, 1 — офлайн пакетиране, 2 — ядро на Preparer, 3 — UI, Docker и операторски workflow. Предложението в историческия §1 на `00-specification.md`, което нарича WFC importer „етап 2“, не заменя този план. Договор A и техническите правила от §8 остават приложими. WFC importer не е реализиран; историческите документи не са преномерирани.

Кодът е в отделна директория: `C:\Users\todor.chankov\source\routings-model-preparer`. Основните входни точки са [README](C:/Users/todor.chankov/source/routings-model-preparer/README.md) и [публичният API](C:/Users/todor.chankov/source/routings-model-preparer/index.mjs). Модулът е Node.js 24 ESM, версия 1.0.0, и използва само вградените библиотеки. Няма зависимости от WFC, PathFinder, DB, MinIO или auth; няма HTTP server, UI, Docker/Compose или APS SDK. Реалният adapter е затворен с `CLOUD_CLOSED`. Подготовката работи само с имитирани provider, transport и cost evidence, създадени от съответните фабрики. Локалните операции construct/list/read не извикват provider.

## Явна конфигурация и API

`await createModelPreparer({dataDirectory,workDirectory,packageModulePath,provider?,costProvider?,clock?,readPolicy?,fault?,store?,packageAdapter?})` създава локално ядро. `dataDirectory` и `workDirectory` са отделни директории с канонични абсолютни пътища. Зависимостта за пакетиране се задава изрично чрез доверения публичен `index.mjs` с абсолютен път или чрез подаване на `packageApi`. Няма търсене спрямо текущата директория, deep imports или копирани ZIP writer и частни locking функции.

Проверената зависимост е `C:\Users\todor.chankov\source\routings-model-package\index.mjs`, версия 1.0.0. Тя е запазена непроменена. Бъдещият Docker build трябва изрично да включи директориите и на двата модула и да предаде път към публичната входна точка на Package A. Текущият код не разчита на случайно съседство на директории върху host машината. Docker build не е част от етап 2.

| Метод | Действително поведение |
| --- | --- |
| `captureJob(spec,{signal?})` | Потоково създава частно устойчиво NWD копие и проверява SHA, размер и стабилност. Задачата има версия на състоянието и неизменяема идентичност. |
| `approveCost(jobId,{signal?,recoverDead?})` | Явно получава и проверява имитирано evidence. Последният отказ премахва активното разрешение. |
| `prepare(jobId,{signal?,recoverDead?})` | Повторно използва налични storage/object данни в симулацията, контролира качването и допуска едно защитено подаване. Няма forced retry. |
| `reconcile(jobId,{signal?,recoverDead?})` | Изпълнява само ограничени provider четения. Запазва неизвестния резултат при 404/pending/inprogress. |
| `waitForDerivative(jobId,{signal?,recoverDead?})` | Изпълнява ограничено polling изчакване; stop действа и между проверките. |
| `download(jobId,{rootId?,signal?,recoverDead?})` | Използва пълен план за raw ресурсите, изисква изричен избор при двусмислен root и създава проверени checkpoints и пълен вход за Package A. |
| `buildPackage(jobId,{signal?,recoverDead?})` | Използва публичните packModel и verifyPackage. lastGoodPackage се сменя само след PASS. |
| `registerPackage({packagePath,jobId?},{signal?})` | Проверява съществуващ локален ZIP с kind=`registered`, без измислена история за capture/upload/submission. |
| `readJob(jobId)` / `listJobs()` | Строго проверява локалното състояние; 0 provider извиквания. |
| `stop(jobId)` | Прекратява проследяваните локални approveCost/prepare/reconcile/waitForDerivative/download/buildPackage операции, включително polling backoff изчакването; връща remoteCancellationConfirmed=false. За captureJob/registerPackage се използва AbortSignal на извикващия. |

Изричният job spec съдържа sourcePath, namespace (account/application), region (EMEA/US), destination (bucket/objectKey), conversion, supportProfile, label, output и незадължителен UUIDv4 jobId. Преобразуването е **SVF**, views=[3d], xAdsForce=false, profile=`svf-local-7.130.0-v1`. Старият APS код подава SVF2. Тази разлика е изрично определена в конфигурацията на новата задача и не променя стария Viewer.

Spec се валидира, копира и замразява синхронно преди първото await. Source snapshot пази оригиналното име в частното устойчиво хранилище; качват се точно повторно проверените му байтове. Промяна на файла на първоначалния път не променя задачата. Промяна по време на capture или повреда на snapshot отказва операцията. Provider получава напълно замразен context и не може да сменя идентичността по време на callback.

## Състояние, идентичност и възстановяване

[Job schema](C:/Users/todor.chankov/source/routings-model-preparer/schemas/job-state-v1.schema.json) описва неизменяемите входни данни, тяхното представяне в задачата и имената на състоянията. Runtime добавя проверки на hash/domain, дати, пътища и provider идентичност, както и правилата за отделни процеси. [Store envelope schema](C:/Users/todor.chankov/source/routings-model-preparer/schemas/store-record-v1.schema.json) и [store protocol](C:/Users/todor.chankov/source/routings-model-preparer/docs/store.md) определят устойчивия запис.

```text
captured -> cost-blocked | uploading -> uploaded
uploaded -> submission-unknown -> submitted -> translating
submitted/translating -> downloading -> downloaded -> verifying -> packaged
explicit read-only registration -> registered
local abort -> interrupted; validation/provider failure -> failed
```

Това е общото представяне на състоянието; отделните факти се запазват. `upload`, неизменяемите `submission.attempts`, допълваните acknowledgements/observations, checkpoints, lastGoodPackage и errors/history/interruption се пазят отделно. Например `cost-blocked` след upload запазва `upload.status=uploaded`, а `interrupted` след POST запазва `submission.phase=submission-unknown`. Успешният remote derivative сам по себе си не означава локално `downloaded`.

Локалният jobId е отделен от upload/submission identity. Последната включва точните SHA/bytes на качването, account/application, region/destination и conversion/profile. Тя изключва jobId, label, локалния output и capture path/time. Обвързването на remote target допълнително отказва друг source за вече свързана цел. Промяна на label/output/jobId не може да заобиколи submission ledger.

Общият журнал за предварително записаните намерения (WAL) е авторитетният източник. Под target/submission lease за отделните процеси той изпълнява `read -> eligibility -> confirmed write-ahead unknown intent -> one submit(retries:0,xAdsForce:false) -> normalized result commit`. Intent пази точните параметри и evidenceId; attempt record не се пренаписва. При crash след marker или remote acceptance първо се чете WAL, дори представянето в job да е изостанало. 404, pending, timeout, изминало време, restart и ново cost approval не разрешават повторен POST. Неуспешен derivative не задейства forced retry. Не се обещава универсално Autodesk exactly-once изпълнение.

Store пази неизменяема верига от ревизии с контролни суми, high-water anchors и начална идентичност. Успешният запис се потвърждава преди зависима мутация. Прекъснат, повреден или дублиран JSON, непознато състояние, пропуски или загуба на последни ревизии, record/head несъответствие и загубени задължителни директории отказват работа без reset/recreate. Locks проверяват точния разпознат прекратен PID и owner nonce. Live/foreign/ambiguous lock или lifecycle mutex не се отнема по възраст. `recoverDead:true` е изричен и обхваща job/target/submission/cost locks. Двама възстановяващи процеса се изпълняват последователно.

Проверени са file fsync, атомично публикуване и възстановяване след process crash. Windows directory flush може да не се поддържа от Node; не се гарантира устойчивост при отпадане на захранването или злонамерени конкурентни промени по файловата система. Crash между record и head води до отказ поради повредено състояние, без автоматична поправка. След пълно външно унищожаване на всички устойчиви доказателства remote историята не може да бъде възстановена.

## Zero-cost gate и реална граница

[Cost rules](C:/Users/todor.chankov/source/routings-model-preparer/docs/cost.md) определят evidence със schema 1: identity, обвързване с account/application/destination/source/settings, разрешен брой storage/upload/submit операции, byte/quota allowance, основание за цена 0, provenance, checkedAt/expiresAt и проверка на issuer. Липсващо, неизвестно, изтекло, платено, изчерпано, несъответстващо или непроверимо evidence блокира мутацията. Няма `.env` флаг за разрешение или предположение „APS Free“.

Използването на лимита се резервира устойчиво под cost lease преди операцията; неизвестният резултат запазва резервацията. Актуалността и обвързването на вече резервирания slot се проверяват отново **синхронно непосредствено преди** всяко createStorage/upload/submit, без await между gate и извикването. Изтичане по време на upload запазва данните за успешното качване и отказва submit. Ново разрешение не качва отново проверения object. Изтичане след write-ahead marker отказва POST и консервативно запазва unknown intent. Последният изричен отказ не допуска използване на предишно все още валидно разрешение; историческите ревизии остават.

Fake attestation е публичен domain-separated digest на синтетични данни; той не е подпис или доказателство за истинска сметка. Factory brands ограничават конфигурацията, но не са sandbox за произволен подаден callback. Fake evidence не активира closed-real adapter. Няма реализиран Autodesk plan/quota endpoint, SDK, четец на credentials или network fallback. Production provider остава затворен до надеждна поддържана проверка на точните условия за цена 0 и allowance, както и отделно разрешено live изпълнение. Текущата live проверка е `NOT_RUN`.

## Download и Package A

[Adapter](C:/Users/todor.chankov/source/routings-model-preparer/docs/package-adapter.md) използва пълен нормализиран provider план с изрични region/object/submission/root/profile и безопасни raw resource IDs/paths. При няколко roots няма мълчалив избор на roots[0]. Планът включва properties.db. Публичният validateProfile проверява пълнотата на препратките за поддържания профил; не прави догадки за произволни формати.

Всеки resource се записва потоково в собствен `.part`, хешира се, синхронизира се и се публикува. След това checkpoint се записва чрез **задължителен await callback към parent store**. Resume преизчислява size/SHA на наличните файлове и сваля само липсващи, повредени или непотвърдени записи. Частично сваляне няма готов descriptor/package. След PASS за пълния inventory/profile се генерират model.json/integrity.json/output. Двата metadata файла се приемат за готови само при потвърдено downloaded състояние и последваща pack/verifier проверка чрез повторно прочитане.

Staging/work директориите са отделни от готовия ZIP. Провал в adapter или verification не заменя последния добър ZIP и core lastGoodPackage. Съществуващият Aalborg пакет се регистрира изрично чрез публичния verifyPackage, без ново upload/conversion/rebuild. Стар променяем APS ledger, `.env` или Docker volume не се чете автоматично. Не е реализирана migration за разширяване на обхвата.

Portable provenance остава `observed-local-file`, защото непромененият публичен packModel издава точно нея. Core записите доказват capture -> verified upload receipt -> immutable fake submission intent/receipt, но не пренаписват manifest в `captured-at-conversion`. Оригиналният ZIP с 342 ресурса и неговите UUID/hash са запазени.

Обхватът на Stage 1 structured nested лимита от 1 GiB, terminal limits и временната browser подмяна на font-response остават точно описани в [01-stage-report.md](01-stage-report.md). Те не са променяни или представяни като повторно доказано production приемане. Блокираното почистване на Stage 1 `.relocation-check` не е повтаряно.

## Команди и оставащ етап 3

Работна директория: `C:\Users\todor.chankov\source\routings-model-preparer`.

```powershell
node --version
node --test --test-concurrency=1 --test-reporter=tap test/*.test.mjs
node cli.mjs --help
```

CLI има само локални list/read/register операции с изрични `--data-dir`, `--work-dir` и `--package-module`, както и незадължителни или задължителни `--job-id` и `--package` според командата. Няма автоматична prepare/poll/network операция при стартиране. Резултатите и контролираните runtime грешки са JSON; грешните аргументи и неподдържаната Node major версия връщат статичен обикновен текст. Exit кодовете са: 0 — успех, 1 — контролирана грешка, 2 — грешни аргументи или Node major версия, 130 — локално прекратяване. Необработени SDK грешки не се записват в job/report.

Етап 3 остава за UI, Docker packaging, операторски start/stop, избор, статуси и явен approval/reconciliation workflow. Реалните account/price/quota, истински APS adapter/transport и end-to-end cloud приемане не са проверени или разрешени тук. WFC importer/session/iframe/PathFinder не са започвани. Действителните test counts, timestamps, команди, файлови отпечатъци и резултатът от почистването са в [02-stage-report.md](02-stage-report.md).
