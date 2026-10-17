# Етап 3 — Самостоятелен Model Preparer

Приложението е в `C:\Users\todor.chankov\source\routings-model-preparer` и използва публичния пакетен модул от `C:\Users\todor.chankov\source\routings-model-package`. WFC не го импортва, стартира или спира. Няма промени в PathFinder, проектните табове, базата или MinIO. Етап 4 остава последващата WFC интеграция според първоначалната номерация.

## Стартиране и конфигурация

От директорията на Preparer:

```powershell
.\start-preparer.ps1 -Build
.\start-preparer.ps1
.\stop-preparer.ps1
```

Интерфейсът е на [http://127.0.0.1:8083](http://127.0.0.1:8083). Първата команда изгражда образа; нормален повторен start използва наличния образ без изтегляне на dependencies или SDK. Собственият Compose проект е `routings-preparer`, с една управлявана service инстанция и три постоянни volumes за `/data`, `/work` и `/outputs`. Портът се публикува само на loopback. Параметрите и офлайн доставката на образа са описани в [deployment/README.md](C:/Users/todor.chankov/source/routings-model-preparer/deployment/README.md).

Разрешеният PoC `.env` се подава като runtime `env_file`. Използват се `APS_CLIENT_ID`, `APS_CLIENT_SECRET`, `APS_REGION` и `APS_BUCKET`; стойностите остават server-side. Няма втори `.env` с копирани тайни. `-EnvFilePath` сменя само пътя до конфигурацията. Старите `PORT`, `MODEL_SOURCE` и `MODEL_NAME` не определят порт, контейнерен път или автоматична задача.

Потребителят допълнително разреши откриване на съществуващ owned bucket и добавянето на валидния `APS_BUCKET` в оригиналния файл. Променена е само тази настройка, след успешни authentication/list/details проверки. Това е изричното изключение от първоначалната забрана за редакция; останалите PoC настройки се запазват.

Docker използва собствена bridge мрежа. Тя не представлява OS забрана за изходящ трафик. Provider/cost capabilities, режимът, операторското действие и текущото доказателство управляват APS достъпа; браузърният CSP ограничава ресурси и връзки до локалния origin.

## Операторски действия

NWD се качва потоково в ограничена временна директория или се избира с opaque ID от предварително разрешена read-only source директория. Клиентски Windows път не се приема като произволен Linux filesystem път. Запазват се basename, означението на версията, размерът, SHA-256 и private snapshot. Непълен upload и прекъснат capture не създават готова задача. Лимитът за browser upload е 2 GiB.

Списъкът и детайлите показват текущата фаза, проверените факти и допустимите действия. Дългите операции имат устойчив server-side ID; UUID на заявката осигурява idempotency при повторно изпращане. Refresh наблюдава вече започнатата операция. Конфликтните действия се отказват и на сървъра. Процент на изпълнение не се измисля: показват се фаза и наличните реални counts.

При подготовка последователността е capture → проверка на цена → изрично prepare → проверка на remote резултата → избор на 3D root → пълно сваляне → публична проверка на пакета → preview/export. При няколко roots се изисква избор за конкретната задача. При неизвестен submission се предлага reconciliation; нов conversion POST не се подава автоматично.

Stop прекратява собствената локална работа, включително capture/registration, и изчаква ограничено за безопасен запис. SIGTERM има същата семантика. Нито едното потвърждава отмяна на remote обработката в Autodesk. Restart чете запазените задачи и факти без автоматичен prepare, polling или lock recovery по възраст.

## Closed, simulation и live

`closed` е default. Позволява локални входове, регистрация, проверка, preview и export. Сглобяването на вече напълно свален captured модел също е локално и не изисква нова проверка за цена. Core проверява immutable snapshot и целия resource profile; частични checkpoints не разрешават пакетиране. Старт, refresh, четене на задачите и рестарт не правят APS заявки.

`simulation` използва генерирани синтетични inputs и отделни data/work/output директории. Имитирани approvals и ledger не активират live. Отчетът отделя fixture invocations от реалната cloud activity. Симулацията не доказва преобразуване на реален NWD или работеща реална геометрия.

`live` изисква различни factory-created APS provider/cost capabilities и текущ операторски review от действителния Autodesk Account интерфейс. `APS_ACCOUNT_TIER` и `APS_ALLOW_CLOUD` са исторически декларации и не предоставят approval. Не се използва предполагаем plan/quota API.

Официалните [условия за offering types](https://www.autodesk.com/company/terms-of-use/en/offering-types-and-benefits) описват Free и блокирането при лимит. Реалният account review обвързва Free offering, team/hub/application, region и destination с разрешената конфигурация чрез хешове. Запазват се наблюденията за allowance и произходът им; proof се pin-ва със SHA-256 и изтича след 30 минути. Операциите имат отделни глобални reservations; grant се recheck-ва непосредствено преди мутация. Повреден, изтекъл, чужд или невалиден proof затваря live. Детайлите са в [live-cost-source.md](C:/Users/todor.chankov/source/routings-model-preparer/docs/live-cost-source.md).

Реалният adapter покрива storage/object inspection, storage creation, streamed multipart upload, SVF submit без force/POST retry, manifest/root discovery, raw download plan и resource streaming. Секретните download URLs/cookies остават в паметта. Remote receipt използва предоставения APS SHA-1 плюс независимо изчислен local SHA-1/SHA-256; remote SHA-256 и несъществуващ job ID не се измислят.

Aalborg приемането използва съществуващия uploaded object и derivative. Default `reuseOnly` отказва ново storage/upload/submit и не преобразува модела повторно. Legacy съществуващ SVF manifest се допуска само за read-only reuse. Няма ново SVF2 преобразуване като fallback. Реалното сваляне и пакетиране се отчитат отделно от нов upload/conversion.

Планирането и мрежовото сваляне имат отделен максимум 30 минути. Публичната проверка на профила/архива запазва своя 10-минутен лимит; размерите, request deadlines и cost expiry не са разширени. При прекъсване се запазват committed checkpoints. Явното продължаване проверява хешовете им и сваля само липсващите/повредени raw ресурси. Изтекъл cost review изисква ново действително account наблюдение, pin/restart и explicit approval преди следващи мрежови операции; не разрешава нов submit.

При рестарт след изтичане запази requested `-Mode live` и същия proof pin: съществуващата задача остава в live namespace, а действителните APS capabilities са затворени. Локалните package/verify/preview/export продължават да работят. `-Mode closed` отваря отделен store и не премества live задачите.

Създадената на 16.10.2026 Aalborg задача се отваря повторно с наличния образ и запазения review (това не подновява cloud разрешението):

```powershell
.\start-preparer.ps1 -Mode live `
  -PriceProofPath 'C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-preparer-app-output\evidence\reviews\7ebf086a-1ff2-40d4-b013-889ebe79545d\aps-live-proof.json' `
  -PriceProofSha256 '04bb4b974334c9697510e15ec4b1a3ed9c65be38c594bf0aed7a6ef60ba1243b'
```

## Проверен пакет, preview и export

Готов ZIP се регистрира с публичния verifier, без нова cloud история. Aalborg пакетът от етап 1 запазва `packageId`, fingerprint, provenance и оригинални bytes. Провереният artifact или `lastGoodPackage` е единственият източник за preview/export; клиентът подава ID, а не filesystem или download URL.

Preview извлича и кешира само проверени manifest resources. Raw ресурсите се подават без неправилно `Content-Encoding`. Trusted Viewer 7.130.0 се доставя отделно от моделния пакет. Deployment копието има provenance inventory и хешове; оригиналният работещ SDK не се редактира. CDN font references са заменени с локални; вграденият icon WOFF се допуска като локален `data:` font. JavaScript eval не е разрешен. Workers, extensions, CSS и моделът се обслужват локално. Запазват се оригиналните цветове и светлото осветление.

След пълна public job/ZIP проверка ресурсите използват ограничена RAM capability, обвързана с конкретния verified artifact, разрешения ZIP path/file stamp, manifest и извлечена директория. Всеки ресурс продължава да минава path и actual byte/SHA проверки; не се препрочита целият job WAL за всяка geometry/property заявка. Смяна на artifact обезсилва capability; след рестарт е необходима нова пълна проверка, обединена за едновременните заявки. Това не променя core/cost/submission guards. При грешка в property worker DOM съдържа само ограничен вид на грешката, без негови съобщения, данни или адреси.

Браузърният sample потвърждава геометрия и свойствата на избран обект. Client-reported наблюденията в отчета имат време и собствен basis; не се представят като независима проверка на всички свойства. Последваща preview грешка записва обновено наблюдение. Реалните приемателни screenshot/DOM/network ограничения са записани в [03-stage-report.md](03-stage-report.md).

Единственото необходимо разширение в пакетния модул е публичен bounded `inspectSvfEnvelope`, който използва съществуващия строг SVF parser за download planning. Той не заменя verifier, не променя формат/лимити и не твърди, че е проверена пълната resource closure. Няма копиране на ZIP writer или private deep imports.

## Запазване и възстановяване

Спри приложението преди backup. Запази трите data/work/output volumes заедно със source/proof provenance, private snapshots, checkpoints, revision heads/chains и verified outputs. Restore използва стабилните контейнерни пътища. Образът сам по себе си не е backup на моделите и историята.

Store/WAL ownership използва Linux boot/process-start/PID-namespace identity. Live, foreign и ambiguous owner не се отнема. Кратка publication fence осигурява последователно четене на revision/head; реален orphan или незавършен запис остава fail-closed. Принудително прекъснат контейнер изисква целева проверка на stopped own-container identity; не се трият locks безусловно и не се редактира ledger/job JSON. Точната поддържана процедура и ограниченията се описват в deployment документацията.

Изпълнените команди, версии, inventories, Docker identity, резултати и почистване са в [отчета за етап 3](03-stage-report.md). Историческите етапи 1/2 и бъдещите WFC acceptance проверки остават ясно разграничени.
