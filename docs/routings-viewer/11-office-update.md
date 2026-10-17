# Етап 11 — обновяване на офисната инсталация

Това ръководство обновява **приложението в офиса, като запазва офисните данни**. Не възстановявайте домашната база, домашния MinIO или домашни конфигурационни файлове върху офисната инсталация. Преносимият комплект съдържа само приложенията, помощния образ и операторските модули. Подготвен ZIP модел се пренася отделно и се импортира в изрично избран офисен проект.

Потвърдени са имената `wfc-app-backend-1` и `wfc-app-frontend-1`. Имената на офисните PostgreSQL/MinIO контейнери, техните дискове, версията на схемата и действителният офисен адрес **не са проверени дистанционно**. Командите по-долу се изпълняват локално от оператора. Няма разрешено автоматично свързване с друг компютър.

## Доставяни версии и необходим достъп

Проверените образи за тази доставка са:

| Роля | Точен Docker image ID |
|---|---|
| API | `sha256:481326351dbfa8acc86afe4d2543a1b96a05d523dd95a4715928f7f25418854f` |
| Web | `sha256:4fd723d0a02a742c7f9c0fda0592573abf14cec587b801a20fa0eaea24d0f326` |
| Operations helper | `sha256:6b358690a5fc4c26776c48f5cd193ff268d6f593c2896b7db966c689b2860dc7` |

Използвайте Windows PowerShell **7**, Node.js **24**, локален Docker Desktop Linux engine и достатъчно свободно място за старите образи, базата, всички сурови MinIO файлове и отделно проверочно възстановяване. Не използвайте Docker context към непроверен отдалечен engine. Не стартирайте транскрипция на сесията, когато работите с частната конфигурация или токен.

Комплектът `office-update-kit/` се доставя отделно от Git:

```text
manifest.json
wfc-api.tar
wfc-web.tar
wfc-ops-helper.tar
legacy-office-operator.mjs
operator/docker.mjs
operator/wfc-ops.mjs
operator/archives.mjs
operator/manifest.mjs
```

Проверете всички файлове срещу SHA-256/размера в доверената release разписка и `manifest.json`, преди да ги използвате. Контролната сума доказва съответствие с разписката; сама по себе си не е цифров подпис. Не копирайте папки `working-backups`, `private`, `.env`, NWD, домашна база или MinIO volume в този комплект. Операторските модули работят без checkout, `npm install` и външни заявки; helper образът е необходим за суровите архиви.

## 1. Проверка на съществуващата офисна инсталация

Отворете PowerShell 7 локално. Първо прочетете само безопасните идентификатори и състояния:

```powershell
$PSVersionTable.PSVersion
node --version
docker context show
docker ps --all --no-trunc --format '{{.ID}} {{.Names}} {{.Image}} {{.State}}'
docker inspect --format '{{.Id}} {{.Image}} {{.State.Running}} {{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}}' wfc-app-backend-1
docker inspect --format '{{.Id}} {{.Image}} {{.State.Running}} {{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}}' wfc-app-frontend-1
docker inspect --format '{{json .NetworkSettings.Networks}}' wfc-app-backend-1
docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}} {{.Destination}}{{println}}{{end}}' wfc-app-backend-1
```

Не извеждайте целия `docker inspect`, `Config.Env`, `.env` или `docker compose config` в публична разписка/чат. Операторът избира действителните PG/MinIO контейнери от локалната инвентаризация. Помощният скрипт прочита текущия `DATABASE_URL` и MinIO настройките **в паметта**, проверява връзката към точно избраните контейнери и отказва несъответствие. Не въвеждайте пароли в аргументите.

Провереният updater е за Compose project `wfc-app`, услуги `backend`/`frontend`, външна мрежа `wfc-app_application` и уеб публикуване `127.0.0.1:5180`. Ако офисният профил се различава, спрете тук за преглед на действителния профил. Не променяйте имена/мрежи и не създавайте празни дискове, за да накарате помощните скриптове да преминат.

Поддържаният адрес в този профил е `http://127.0.0.1:5180` или `http://localhost:5180` **на същия компютър**. LAN HTTP като `http://office-pc:5180` не е разрешен от защитените Viewer сесии. LAN HTTPS с реален reverse proxy, точен origin и доверие към proxy е отделна конфигурация и остава **NOT_RUN за офиса**. Няма да се разреши чрез произволно добавяне на HTTP адрес към allowlist.

## 2. Архив ПРЕДИ първото стартиране на новия API

Новият API извиква миграциите при стартиране. Първо направете и проверете локален rollback архив на **старите офисни данни и образи**. Не стартирайте новия API, за да създаде таблици, нужни за архивиране.

Съвременният `scripts/operations/wfc-ops.mjs backup` е профил за вече въведен model registry: изисква действителен staging mount и registry/session таблици. При стара инсталация без staging той отказва `SOURCE_STAGING_MOUNT_REQUIRED` преди архив/спиране. Наличието на mount само по себе си не доказва налична схема. Частично обновена схема изисква преглед, а не автоматично допълване или reset.

За стария профил използвайте **отделния** `WFC-LEGACY-COLD-ROLLBACK` оператор от комплекта. Той допуска само база, в която липсват всичките десет registry/session таблици; не обещава modern ready-model audit и не е вход за модерния `wfc-ops restore`. За вече мигрирана инсталация използвайте [оперативния runbook](10-operations-backup-restore.md) и съвременния профил.

### 2.1 Подготовка и действително архивиране

Примерните пътища са **нови локални директории**, извън Git checkout и всички източникови bind mounts. Изберете собствен коректен път. Източниковите имена по-долу се въвеждат от действителната офисна инвентаризация:

```powershell
$Kit = (Resolve-Path -LiteralPath 'C:\WFC-office-release\stage11\office-update-kit').Path
$Operator = Join-Path $Kit 'legacy-office-operator.mjs'
$PrivateParent = 'D:\WFC-private-rollback'
New-Item -ItemType Directory -Path $PrivateParent -ErrorAction Stop | Out-Null
$Backup = Join-Path $PrivateParent ('office-before-stage11-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss'))
$PgName = Read-Host 'Existing office PostgreSQL container name or full ID'
$MinioName = Read-Host 'Existing office MinIO container name or full ID'
$Helper = 'sha256:6b358690a5fc4c26776c48f5cd193ff268d6f593c2896b7db966c689b2860dc7'

# Load само предварително проверения помощен образ. Без pull/build.
docker load --input (Join-Path $Kit 'wfc-ops-helper.tar')
if ($LASTEXITCODE -ne 0) { throw 'Helper load failed' }
docker image inspect --format '{{.Id}}' $Helper
if ($LASTEXITCODE -ne 0) { throw 'Exact helper image is missing' }

# Преди този флаг: уведомете потребителите и спрете всички външни writers/reconnectors.
node $Operator backup `
  --api wfc-app-backend-1 --web wfc-app-frontend-1 `
  --postgres $PgName --minio $MinioName --helper $Helper `
  --destination $Backup --maintenance-confirmed
if ($LASTEXITCODE -ne 0) { throw 'Legacy capture failed; inspect private incomplete/resume records before proceeding' }

node $Operator verify --backup $Backup
if ($LASTEXITCODE -ne 0) { throw 'Legacy full verification failed' }
```

`--destination` трябва да не съществува; нейният родител трябва да съществува. На Windows скриптът създава защитена DACL за текущия акаунт и SYSTEM, а на POSIX — частна директория. Само `mode=0600` не е достатъчна защита на Windows. Пренесените архиви и конфигурацията остават частни; не ги commit-вайте и не ги включвайте в публичния индекс. Файловата система/транспортът трябва да запазят или възстановят същата защита.

При няколко действителни API workers повторете `--api <име>` за **всеки** writer. Повторете `--web` за всеки frontend. Всички API workers трябва да имат един и същ точен image ID; същото важи отделно за всички frontend workers. Смесени версии се отказват с `MIXED_WORKER_IMAGES_UNSUPPORTED`, преди да се създаде архив или да се спре услуга. Скриптът отказва друг свързан работещ DB/MinIO клиент, неизвестен записващ mount, различни endpoint настройки, допълнителни application mounts и неподдържан PG/MinIO layout. Външен процес, който не е видим като Docker клиент и може да се свързва отново, трябва да бъде спрян от оператора. Флагът е потвърждение на този прозорец, не автоматична мрежова изолация.

Изпълняваният поток е:

1. Закрепва точните container/image/mount идентичности и частната пълна конфигурация. Не отпечатва стойностите ѝ.
2. Спира frontend и всички API workers с 45 секунди, изисква чист exit, ограничава/потвърждава нула останали DB клиентски сесии за тази база. Спира MinIO чисто.
3. Изчислява пълен hash на редовете/колоните на всички `public` таблици. Проверява липсата на десетте нови таблици. Не изпълнява initializer.
4. Използва **бинарен** `pg_dump --format=custom --no-owner --no-acl` и `pg_restore --list`, без PowerShell text redirection.
5. Архивира всички действителни сурови MinIO файлове и metadata чрез `archives.mjs`, след това ги прочита и хешира изцяло. Ако има действителен staging mount, го архивира отделно; липсващ staging остава записан като липсващ.
6. Запазва точните стари API/Web/PostgreSQL/MinIO/helper образи с `docker save <sha256:ID>` и проверява image archive bytes, идентичност и платформата. Дублиран ID се запазва веднъж. Няма export по подвижен tag, pull или build.
7. Повтаря DB инвентаризацията, възстановява първоначалните running състояния в `finally` при запазена точна идентичност и издава `complete.json` само след успех. `sourceResumed=true` потвърждава running състоянията, а не изчакан healthcheck; операторът проверява старите услуги/health след архива, преди да продължи.

Това е **application-cold / MinIO-cold** архив с консистентен онлайн PG custom dump. PostgreSQL остава стартиран за dump; това не е копие на работещия PG data directory или Docker Desktop VHDX. Не копирайте VHDX/volume папки като заместител. PG dump е за една база, без cluster roles/tablespaces/ownership/ACL; инсталация с допълнителни външни зависимости изисква отделен план. При недостатъчни локални DB права или лимит на инвентаризацията операцията отказва, вместо да пропусне данни.

### 2.2 Проверочно възстановяване в нови дискове

Преди обновяването докажете, че архивът може да се възстанови. Това създава отделен вътрешен Docker network, нов PG контейнер и нови volumes; няма публикувани портове, няма API и няма миграции:

```powershell
$Proof = Join-Path $PrivateParent ('office-restore-proof-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss'))
$ProofProject = 'wfc-legacy-proof-' + [Guid]::NewGuid().ToString('N').Substring(0,12)
node $Operator prove-restore --backup $Backup --destination $Proof --project $ProofProject
if ($LASTEXITCODE -ne 0) { throw 'Fresh restore proof failed; do not update the office application' }
```

Скриптът проверява SHA на всички файлове и всички image archives, използва само проверени точни образи и нови volumes с уникална ownership идентичност. Сравнява **всички стари редове/колони**, после възстановява MinIO/staging в празни volumes и ги архивира повторно, преди MinIO да бъде стартиран. Повторният суров архив трябва да има същия пълен SHA — файлове, metadata и байтове. Успехът е `allOldRowsEqual=true`, `allRawBytesAndMetadataEqual=true`, `migrationStarted=false`, `publishedPorts=0`.

Проверочните ресурси остават обозначени в частния `target.private.json`. Не ги свързвайте към офисното приложение. След операторско приемане се чистят само по точния project/target ID, exact container IDs и volume/network labels; не използвайте global prune или изтриване само по обща дума в името. Архивът на реалния офис остава необходим и не се чисти заедно с тестовия clone.

### 2.3 Какво е действително доказано преди доставката

Изолираният legacy drill изпълни точния `d5454b3c4c547c24631e37e24d35f76739228867:server/db.ts` и неговите десет Git dependency blobs. Получени бяха **38 стари таблици**, две синтетични кабелни записи с `SECONDARY`/routing/length стойности, две tray записи и реален синтетичен MinIO object. Всичките десет нови таблици липсваха. Modern backup отказа без staging преди мутация. Бинарният dump, пълният raw archive и свежото възстановяване запазиха данните; текущият initializer върху **възстановения disposable clone** добави десетте таблици — **38 → 48**, без промяна на старите колони/редове, routing/engineering стойности и object SHA, без автоматично избран модел. Основният drill има **9/9 PASS**.

Отделно окончателният доставян `legacy-office-operator.mjs`, включително отказът за смесени worker images, е изпълнен върху същия собствен синтетичен източник: backup, full verify и fresh restore — **3/3 PASS**. За image guard и ограничената разлика спрямо предходния observer има още **4/4 PASS** синтетични/byte-equality проверки. Точните изпълнени SHA, времена и разписки са в delivery manifest/acceptance index; историческите опити остават отделно. Старите API/Web в този тест са инертни lifecycle placeholders; няма претенция за replay на стар офисен browser/API или за извършена проверка на втори физически компютър. Действителната офисна база и нейните extensions/roles/обеми още трябва да преминат местните проверки по-горе.

## 3. Получаване на приложението

### Вариант A — Git и локален build

Този вариант изисква Node/npm/Docker build зависимости и достъп до разрешените package/image registries. Build не е offline доказателство. Първо архивирайте старото приложение и данни. Пазете съществуващите частни настройки; не ги заменяйте с домашни.

```powershell
Set-Location -LiteralPath 'C:\actual-office-checkout\WFC'
if ((git status --porcelain).Length -ne 0) { throw 'Checkout has local changes: preserve and review them before update' }
git switch main
if ($LASTEXITCODE -ne 0) { throw 'Could not select local main' }
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Fast-forward update refused; resolve repository state without reset/clean' }
git log -1 --format='%H %s'
# Сравнете SHA с публикуваната release разписка. Не разчитайте само на branch name.
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -File .\scripts\update-local-app.ps1 -BuildOnly
```

`-BuildOnly` не заменя работещите услуги. Проверете build image IDs/резултата. След преминат стар rollback backup и fresh restore изпълнете без `-BuildOnly`, за да build-нете/приложите локално. Локално построените образи имат собствени IDs и не се представят за предварително проверените ID-only delivery images. Не използвайте `git reset --hard`, `git clean` или принудителен merge, за да изчистите офисна работа.

### Вариант B — проверени application-only images

Този вариант избягва npm/image изтегляния на офисния компютър. Нужен е checkout на същата release версия за проверения updater и Compose; комплектът не носи офисни настройки. След SHA проверката:

```powershell
docker load --input (Join-Path $Kit 'wfc-api.tar')
if ($LASTEXITCODE -ne 0) { throw 'API load failed' }
docker load --input (Join-Path $Kit 'wfc-web.tar')
if ($LASTEXITCODE -ne 0) { throw 'Web load failed' }
$Api = 'sha256:481326351dbfa8acc86afe4d2543a1b96a05d523dd95a4715928f7f25418854f'
$Web = 'sha256:4fd723d0a02a742c7f9c0fda0592573abf14cec587b801a20fa0eaea24d0f326'
docker image inspect --format '{{.Id}}' $Api
if ($LASTEXITCODE -ne 0) { throw 'Exact API is missing' }
docker image inspect --format '{{.Id}}' $Web
if ($LASTEXITCODE -ne 0) { throw 'Exact web is missing' }

Set-Location -LiteralPath 'C:\actual-office-checkout\WFC'
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -File .\scripts\update-local-app.ps1 `
  -VerifiedApiImage $Api -VerifiedWebImage $Web
if ($LASTEXITCODE -ne 0) { throw 'Update or readiness failed: follow the rollback decision below' }
```

Updater-ът прочита текущите разрешени backend настройки в паметта, пази точните стари API/Web image IDs с rollback tags, спира само двете app услуги с 45 секунди и използва `up --no-deps --no-build --pull never --wait`. Не пресъздава PG/MinIO. Новият отделен `wfc-app_model-imports` volume е staging за модели; не е заместител на старите дискове. Първото стартиране на новия API извършва миграциите; затова предходната стъпка е задължителна. `VITE_VIEWER_HARNESS=false` е финалният production build — работете през реалния таб **Routings viewer**, не през диагностичния harness.

## 4. Проверка след обновяването

```powershell
docker inspect --format '{{.Id}} {{.Image}} {{.State.Status}} {{.State.Health.Status}}' wfc-app-backend-1
docker inspect --format '{{.Id}} {{.Image}} {{.State.Status}} {{.State.Health.Status}}' wfc-app-frontend-1
(Invoke-WebRequest -Uri 'http://127.0.0.1:5180/health').StatusCode
```

Излезте от стария WFC login и влезте отново: наследен JWT без текуща login идентичност не може да създава защитена Viewer сесия. Проверете съществуващ офисен проект, същите кабели/trays и числови стойности. Не приемайте HTTP 200 като достатъчно доказателство за модел; проверете model metadata, избора и действителната геометрия в браузъра.

Интерфейсът за новия Viewer е на английски. **Details → 3D model** показва текущия модел, име на източника, дата и `Available`/`Unavailable`. Изборът изисква права за редакция на точно този проект. Read-only потребителят може да вижда информацията и разрешения Viewer, но не може да сменя модела.

## 5. Импорт на ZIP в изрично избран офисен проект

Вземете подготовения ZIP и неговия transport SHA-256 от проверената package разписка. ZIP не е NWD и не е multipart/form upload. Изберете **офисния** project UUID от действителния project URL/metadata. Не използвайте домашен UUID само защото името е същото. Подготвянето/конверсията е отделен Preparer процес; офисният WFC не прави APS/cloud заявки.

Публичният API договор е:

```http
POST /api/projects/<OFFICE_PROJECT_UUID>/model-imports
Authorization: Bearer <current authorized office login>
Content-Type: application/zip
Content-Length: <actual ZIP bytes>
Idempotency-Key: <new UUID retained for this exact import request>
X-Package-SHA256: <lowercase SHA-256 of raw ZIP>
Expect: 100-continue

<raw ZIP bytes>
```

Изпращайте към същия локален frontend origin, не към произволно публикуван API порт. Токенът остава само в частната операторска памет; не го поставяйте в URL, Git, отчета или screenshot. Действителният лимит за ZIP е 2 GiB. Използвайте stream/file upload, а не преобразуване на ZIP в текст/base64.

Следният PowerShell 7 пример изпраща файла като stream и извършва ограничено polling. Това е операторски пример по API договора, а не нов UI за импорт. Въведете текущия разрешен office Bearer token от частния login процес; не извеждайте стойността му. Запазете безопасните idempotency/import UUID, за да проверите същата операция при неизвестен резултат:

```powershell
$OfficeOrigin = 'http://127.0.0.1:5180'
$OfficeProject = ([Guid](Read-Host 'Exact OFFICE project UUID')).ToString()
$Zip = (Resolve-Path -LiteralPath (Read-Host 'Prepared ZIP path')).Path
$ZipFile = Get-Item -LiteralPath $Zip
if ($ZipFile.Length -gt 2147483648) { throw 'ZIP exceeds 2 GiB' }
$ZipSha = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
$Key = [Guid]::NewGuid().ToString()
Write-Output "Retain this import idempotency UUID: $Key"
$Secret = Read-Host 'Current authorized office Bearer token' -AsSecureString
$Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
$Http = [Net.Http.HttpClient]::new()
$Http.Timeout = [TimeSpan]::FromMinutes(20)
$Request = $null; $Response = $null; $Stream = $null
try {
  $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
  $Http.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Token)
  $Token = $null
  $Stream = [IO.File]::OpenRead($Zip)
  $Request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$OfficeOrigin/api/projects/$OfficeProject/model-imports")
  $Request.Headers.ExpectContinue = $true
  $Request.Headers.Add('Idempotency-Key', $Key)
  $Request.Headers.Add('X-Package-SHA256', $ZipSha)
  $Request.Content = [Net.Http.StreamContent]::new($Stream)
  $Request.Content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new('application/zip')
  $Request.Content.Headers.ContentLength = $ZipFile.Length
  $Response = $Http.SendAsync($Request).GetAwaiter().GetResult()
  if ([int]$Response.StatusCode -notin @(200,202)) { throw "Import HTTP status: $([int]$Response.StatusCode); do not retry with a new key automatically" }
  $Accepted = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
  $ImportId = ([Guid]$Accepted.importId).ToString()
  Write-Output "Import UUID: $ImportId"
  $Complete = $false
  for ($Attempt = 0; $Attempt -lt 180; $Attempt++) {
    $Poll = $Http.GetAsync("$OfficeOrigin/api/projects/$OfficeProject/model-imports/$ImportId").GetAwaiter().GetResult()
    try {
      if (!$Poll.IsSuccessStatusCode) { throw "Poll HTTP status: $([int]$Poll.StatusCode); inspect the same import" }
      $Job = ($Poll.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json).job
      if ($Job.state -eq 'failed') { throw 'Import failed; inspect the safe job result before any new upload' }
      if ($Job.state -eq 'complete') { $Complete = $true; Write-Output "Prepared model version: $($Job.modelVersionId)"; break }
    } finally { $Poll.Dispose() }
    Start-Sleep -Seconds 5
  }
  if (!$Complete) { throw 'Polling deadline reached: result is unknown; retain UUIDs and query the same job' }
} finally {
  if ($Response) { $Response.Dispose() }
  if ($Request) { $Request.Dispose() }
  if ($Stream) { $Stream.Dispose() }
  $Http.Dispose()
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
  $Secret.Dispose()
  $Token = $null
}
```

След `202` запазете `importId` и проверявайте с ограничено изчакване:

```http
GET /api/projects/<OFFICE_PROJECT_UUID>/model-imports/<IMPORT_UUID>
Authorization: Bearer <same authorized office login>
```

Изчаквайте `job.state === "complete"` и валиден `modelVersionId`. При `failed`, `409`, неизвестен резултат или прекъсната връзка първо прочетете същия job/idempotency резултат; не изпращайте нов ключ автоматично. Импортът сам по себе си не избира модела. WFC прави собствена проверка на package/schema/profile, всички сурови файлови SHA и readback от частния storage; не публикува непроверена версия. Няма автоматично API избиране или редакция на кабелно routing поле.

В **Details → 3D model → Model version** изберете готовата `Available` версия и натиснете **Save**. Проверете server-authoritative active model. При конфликт използвайте **Use latest selection** или изрично прегледайте **Keep my choice**, след което **Save**; не презаписвайте непознат revision. `No model` е изричен отделен избор.

Отворете **Routings viewer**. Изчакайте реалните геометрия/index/properties; въведете ръчен маршрут или включете **Cables**, потърсете оригинален tag и изберете точния UUID при дублирани tags. Информацията с **Alt+Enter**/hover и Copy не редактира кабела и не стартира route. Проверете Show/Clear/Zoom и напускане на таба. Новите ръководства за [ръчния маршрут](07-routings-viewer-manual-routing.md), [кабелния избор](08-cable-routing-selection.md) и [информационния панел](09-cable-information-panel.md) описват отделните граници.

## 6. Решение при неуспех и rollback

`scripts/update-local-app.ps1` може да възстанови старите **образи** при собствено deploy/readiness изключение. Това не връща автоматично DB миграции, object bytes, роли или нови офисни записи. Стар API върху мигрираната база не е доказан rollback.

Ако новата версия е стартирала и има съмнение за несъвместимост:

1. Спрете само новите API/Web writers и задръжте прозореца за поддръжка. Не връщайте стар API към вече мигрираната база по догадка. Запазете отделно текущото неуспешно състояние, ако е необходимо за анализ/по-късни записи.
2. Проверете отново **офисния pre-migration** legacy архив и частната му конфигурация. Използвайте нов `prove-restore` target; не overwrite-вайте съществуващ PG/MinIO volume, не използвайте `pg_restore --clean` като обещание, че ще премахне всички нови таблици.
3. Провереният fresh target дава стария PG dataset и точните стари сурови MinIO/staging volumes без API. Операторът трябва да направи изричен cutover към тях с **точните стари PG/MinIO/API/Web образи и локално запазените office mounts/network/credentials**. Този скрипт нарочно не пренасочва работещата инсталация и не публикува clone. Ако няма предварително проверен план за cutover на действителния офисен профил, останете в maintenance и ескалирайте; не импровизирайте restore върху текущите дискове.
4. След потвърдени стари DB/object hashes, roles/config и стар API/Web readiness отворете достъпа. Пазете и двата набора до приемане; след rollback записи, направени след архива, изискват отделно решение за възстановяване.

Точният office cutover и втори физически компютър остават **NOT_RUN** до местното изпълнение. Доставката доказва изолирания old-schema restore/migration и текущия production профил; не превръща непроверен офисен профил в PASS.

## 7. Какво остава за поддръжка

Пазете проверения pre-migration архив, частната configuration разписка, exact old image archives и fresh-restore proof до приемане. След като офисът вече има новата схема и model registry, следващите архиви следват [Stage 10 operations](10-operations-backup-restore.md): model ownership/WAL/import staging, raw resources, session fencing и restore quarantine са част от новия профил.

Почистването е само за доказано собствени тестови ресурси и неизползвани image IDs след проверка за всички container references. Не правете global prune, не изтривайте офисните volumes, input ZIP, частния rollback или конфигурацията. Няма инструкция да се премахват исторически автоматично блокирани cleanup targets.
