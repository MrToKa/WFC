# Етап 1 — преносим пакет на съществуващия Aalborg модел

Дата:16.10.2026, Europe/Kiev (UTC+03:00). Етапът реализира самостоятелен Node.js24 packager/verifier и проверява пълния реален пакет след локално преместване. Геометрията и свойствата са заредени в реален браузър от извлеченото копие. Последващото изтриване на временните тестови копия е **BLOCKED**; това остава неизпълнено действие, описано отделно по-долу.

```text
STAGE_1: COMPLETE
PORTABLE_PACKAGE_VERIFIED: YES
RELOCATED_MODEL_SMOKE: PASS
CLEANUP: BLOCKED
```

## Baseline и обхват

Източник на формата е [договор A, §4.1–4.5](00-specification.md), прочетен заедно с baseline, матрицата и историческия stage0 report преди реализацията. Първоначалните read-only проверки са повторени около10:56–11:00. WFC е `main`, HEAD `d5454b3c4c547c24631e37e24d35f76739228867`, ahead/behind `origin/main`=0/0; live remote `main` съвпада. Няма tracked/staged source diff или непубликувани commits. Четирите предходни stage0 документа са untracked и запазени; няма подходящ предходен самостоятелен пакетен модул.

Read-only `git branch --show-current`, `git rev-parse HEAD`, `git rev-list --left-right --count origin/main...HEAD` и `git ls-remote --heads origin main` са повторени11:56:28+03:00 със същите branch/HEAD/0–0/live-ref резултати. След добавянето на този отчет са проверени само шестте untracked stage documents, празен tracked/staged diff, local documentation links/format и23source fingerprints. Крайният запис е [final-scope.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/final-scope.json).

Финалните файлови проверки са в [source-preservation.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/source-preservation.json),11:38:52+03:00. Те сравняват всички342original model resources и206original SDK files; няма mismatch. Проверени са NWD и ключовите Viewer/descriptor hashes. Самостоятелният код е извън WFC и Viewer. Няма APS/Autodesk upload/translation, remote repository, push/PR/merge, WFC functionality, DB/MinIO, Model Preparer UI/Docker, Details/session/iframe/PathFinder или промяна на по-късната stage numbering.

`scripts/prepare-offline.js` и `scripts/vendor-viewer.js` не са изпълнявани/импортвани. `.env` не е четен. `sources/` в ChatGPT project mirror не е редактиран. Не са стартирани несвързаните WFC frontend/backend suites.

Историческите файлове остават byte-for-byte:

| Документ | SHA-256 |
| --- | --- |
| 00-baseline.md | `c5b9648484a0139b837fcc6576ae70d96e63bee2d41776df770020ea663eeb4a` |
| 00-specification.md | `4324845cd3b7c859ac814e2be27e1107c8e263075ee921e7b7f4dcf8d136ce92` |
| 00-stage-report.md | `26abb2b650e5f9664006eaa6ee4ba1ef76ed797b67ef41073d4737b679407c3e` |

Матрицата е актуализирана само за stage1 резултатите. Предишната версия е запазена цялостно в [00-validation-matrix-stage0.md](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/00-validation-matrix-stage0.md), SHA-256 `63399a5dd667b5690e706112d90ce64bd5544f288dd73ff191778063951b4c33`. Original consumer criteria са запазени като отделни `S1-FUTURE-PKG-*` rows със `NOT_RUN`. Основните PKG-14/16/18 PASS assertions са ограничени до standalone manifest, локално преместване и наблюдавана provenance.

## Готов пакет и идентичност

Output root: `C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output`.

| Поле | Проверена стойност |
| --- | --- |
| ZIP | [aalborg-svf-v1.zip](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/aalborg-svf-v1.zip) |
| Транспортен размер |439112840bytes|
| Транспортен SHA-256 | `e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922` |
| packageId | `cc477b02-e0f9-47bc-b965-7064e93404fe` |
| preparedAt | `2026-10-16T08:16:10.922Z` |
| Ресурси / raw bytes |342 /439007803|
| Canonical fingerprint input |33731bytes; UTF-8/noBOM/LF/final LF|
| contentFingerprint | `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34` |
| schema / profile / format / SDK |1 / `svf-local-7.130.0-v1` / `svf` / `7.130.0`|
| entrypoint | `resources/output/0/0.svf` |
| source.name | `Aalborg_ACS_CABLETRAY_30_03_26.nwd` |
| source.bytes |155285346|
| source.sha256 | `11b2739d92020ee58a52a4e793cf8fd538fb30758eb42176aba93ac7319b048a` |
| source.identityBasis | `observed-local-file` |

Пълният, несъкратен342-resource manifest е [aalborg-svf-v1.zip.manifest.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/aalborg-svf-v1.zip.manifest.json). Същият manifest е в ZIP. Машинният pack/preflight/readback/publication report е [aalborg-svf-v1.zip.validation.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/aalborg-svf-v1.zip.validation.json). Проверка с окончателния код е [final-code-readback.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/final-code-readback.json), PASS11:37:40.663+03:00.

Моделните байтове са непроменени; единствената промяна на path prefix е `offline/model/output/`→`resources/output/`. Няма пренаписване на вътрешни refs. Външният ZIP има343files:manifest+342resources, включително допълнителния `properties.db`, който не се извежда само от SVF assets. NWD, SDK/runtime, state/credentials, приложение, README и validation reports са извън ZIP.

Fingerprint точно възпроизвежда договорения snapshot. Транспортният hash е отделен от content fingerprint; двата не са цифров подпис. `observed-local-file` доказва наблюдаваните днес NWD bytes, без ретроспективна претенция за conversion-time identity.

## Самостоятелен код и променени файлове

Код: [routings-model-package/README.md](C:/Users/todor.chankov/source/routings-model-package/README.md), tool version1.0.0, Node `v24.19.0`. Използва само Node built-ins, без външни dependencies/install/build. Точните CLI/API/exit/error codes и инсталиране са в [01-package-tooling.md](01-package-tooling.md). Файловете и техните пълни SHA-256 са в [code-inventory.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/code-inventory.json), проверен11:53:14+03:00; SHA-256 на самия inventory `736979f65d93638a523dc981cb57e719b66d042f9dc2e1710c6e2a0216a52d1e`.

Всички23нови source files са в `C:\Users\todor.chankov\source\routings-model-package`:

```text
.gitignore
package.json
README.md
cli.mjs
index.mjs
lib/errors.mjs
lib/limits.mjs
lib/json.mjs
lib/paths.mjs
lib/manifest.mjs
lib/zip.mjs
lib/profile.mjs
lib/io.mjs
lib/pack.mjs
lib/verify.mjs
schemas/portable-manifest-v1.schema.json
test/contracts.test.mjs
test/zip.test.mjs
test/profile.test.mjs
test/package.test.mjs
test/fixtures.mjs
tools/offline-guard.mjs
tools/relocated-smoke.mjs
```

В `C:\Users\todor.chankov\source\WFC` са нови `docs/routings-viewer/01-package-tooling.md` и този `01-stage-report.md`; актуализиран е `00-validation-matrix.md`. Всички шест stage documents остават untracked. Няма Git index/commit mutation или WFC app source edit. Output root съдържа готовите3artifact files, evidence directory и оставащата task-created `.relocation-check` directory. Не са променяни входните директории или съществуващите контейнери.

## Реализирани проверки и граници

Strict portable JSON parser открива decoded duplicate keys, включително escaped-equivalent keys; неизвестни fields и malformed UTF-8 се отхвърлят. Машинната JSON Schema е supplement-ната с runtime ordinal ordering, safe paths, hashes, stream counters и profile validation. Fixture fingerprint tests отделно проверяват inclusion/exclusion semantics и published manifest ordering.

ZIP writer е streaming STORE; verifier поддържа bounded STORE/DEFLATE/ZIP64 и проверява central/local consistency, CRC, реални sizes, duplicate/case/path/link/device/encryption/overlap declarations и hidden nonzero bytes. Файловете/outer ZIP не се зареждат като един голям Buffer. Actual empty directories се проверяват преди връщане на archive handle; DEFLATE directory с фалшив empty header и скрит payload се reject-ва. Истински STORE0/0/CRC0 directories имат доказано празен payload. Допускат се43zero-alignment bytes и harmless stored-directory option bits от действителния SVF; guards са100MiB central metadata/64KiB cumulative all-zero padding.

Profile проверката потвърждава embedded manifestversion2, toolkit `LMVTK 5.0.26.0`,341assets/12typesets,340external sibling refs и1embedded metadata ref;7recognized gzip JSON files,78empty texture maps,340valid gzip streams, mandatory raw SQLite properties.db. Raw resource size не се бърка с embedded ZIP compressed/usize. Known duplicate `default display unit={value:"m"}` точно два пъти е единствената equal-valued metadata exception; conflicting/reference duplicates се reject-ват. Unknown profile/toolkit/reference-bearing structure не се приема чрез догадки. Textual URL в property е inert data. Binary geometry/SQLite semantics не се изпълняват или универсално интерпретират.

Limits са2GiB outer ZIP,8GiB raw aggregate,100000files,2GiB resource,32MiB root manifest,256MiB inspected nested item/1GiB aggregate,depth16,ratio1200:1 и600000ms deadline. Реалният приблизително998:1 viewables JSON е допустим. API позволява само затягане на положителни лимити.

**Изрично уточнение на scope, без промяна на формата:** §4.4 различава inspected nested SVF/recognized gzip JSON от opaque terminal binary/property nodes. Runtime1GiB nested cap се прилага към първата група; реалният total е75480079bytes. Terminal integrity streams се discard-ват и броят отделно:1286939948bytes, включително233991168raw SQLite bytes; имат допълнителни per-file2GiB/aggregate8GiB/time guards. Ако „aggregate nested inflated“ се разпростре и върху terminal data, този договорен модел би надхвърлил1GiB. Тази интерпретация е описана изрично, а не скрито увеличение на numerical limits. Няма претенция за универсален Autodesk parser или protection against hostile filesystem TOCTOU.

Publication първо сверява source/inventory/profile, пише в exclusive staging, отваря ZIP повторно чрез verifier и публикува с atomic no-overwrite same-volume link. Retry reservation пази UUID/time/content/source/label; nonce+PID lock и lifecycle mutex сериализират acquisition/recovery/release. Unrelated existing package/report и active/unrecognized lock се пазят. Tests покриват stale recognized PID recovery, interruption/failure и last-good-package preservation. Abrupt stale mutex изисква инспекция; инструментът не го изтрива автоматично.

## Команди, времена и доказателства

Командите са изпълнени от standalone tool root с Node24.19.0. `pack`/`verify` command definitions са точните CLI аргументи в [tooling](01-package-tooling.md); optional guard е зареден чрез `--import` и URL-encoded `report`/repeated `forbid` query values, без environment variables.

| Проверка | Статус | Момент Europe/Kiev / доказателство |
| --- | --- | --- |
| Strict contract/path/fingerprint positive+negative fixtures |PASS|43tests в full TAP|
| ZIP structure/CRC/ZIP64/link/limits/directory fixtures |PASS|46tests в full TAP|
| Profile/ref/material/gzip/duplicate/property fixtures |PASS|60tests в full TAP|
| Package/roundtrip/publication/retry/offline fixture scenarios |PASS|19tests в full TAP|
| Пълен автоматичен run |PASS|168passed/0failed/0skipped, duration128874ms; окончателен run приключил11:34:49; [fixture-tests.tap](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/fixture-tests.tap)|
| След финалната empty-STORE-directory optimization |PASS|6affected checks отново PASS; original SVF5entries; final code readback11:37:40|
| Реален pack+preflight+readback+publication |PASS|11:16:09.502–11:16:27.177; full validation sidecar|
| Guarded offline pack |PASS|0network/0forbidden reads/exit0; [pack-offline-audit.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/pack-offline-audit.json)|
| Ново местоположение+independent readback/extraction |PASS|11:18:50.198–11:19:00.363; [relocated-validation.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/relocated-validation.json);342resource hashes independently compared|
| Оригиналните roots забранени за relocated verifier |PASS|11:18:50.186–11:19:00.374; [relocated-offline-audit.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/relocated-offline-audit.json);0network/0forbidden reads/exit0|
| Повторна guarded final verification след ZIP directory fix |PASS|11:34:14.675–11:34:49.275; [final-readback.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/final-readback.json), [final-offline-audit.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/final-offline-audit.json)|
| Последен independently reopened ZIP с final code |PASS|11:37:32.479–11:37:40.663; final-code-readback.json; същият ZIP SHA/fingerprint|
| Копиран SDK7.130.0 |PASS|11:22:06;206files/82552768bytes; [sdk-copy-validation.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/sdk-copy-validation.json)|
| Геометрия+properties/local-only browser |PASS|11:31:46.547; relocated-browser-smoke.json/PNG/DOM|
| Model/NWD/Viewer/SDK/stage0 originals preserved |PASS|11:38:52; source-preservation.json|
| Temp server/tab closed; no task-created containers |PASS|11:53:14final check:0listeners на64718; tab closed; createdContainers0; cleanup.json|
| Temporary relocation-copy deletion |BLOCKED|3automatic-review rejections, reason „blocked by policy“; cleanup.json|
| Втори физически компютър/full UI/WFC browser acceptance |NOT_RUN|Извън stage1; локалното преместване не ги доказва|
| WFC importer/dedup/storage/session/iframe/PathFinder |NOT_RUN|Бъдещи етапи, не са реализирани или стартирани|

Изпълнен full test command:

```powershell
node --test --test-reporter=tap test/*.test.mjs
```

Relocated verifier command body (guard import допълнително забранява оригиналния Viewer root и NWD parent):

```powershell
node --import $guardImport cli.mjs verify `
  --package "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output\.relocation-check\model.zip" `
  --expect-fingerprint b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34 `
  --extract-to "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output\.relocation-check\extracted" `
  --report "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output\evidence\relocated-validation.json"
```

За нов run са необходими **нови** report/extraction targets; съществуващите evidence files не се overwrite-ват. `offline-guard` е in-process instrumentation на избраните Node APIs, **не OS sandbox**. Evidence readPaths/forbiddenRoots показват действителния audit scope. Verifier API има само получен ZIP като вход; SDK се използва отделно единствено за браузърната проверка.

## Реален relocated browser smoke

Използван е [temporary harness](C:/Users/todor.chankov/source/routings-model-package/tools/relocated-smoke.mjs) с `--root=<isolated extracted>`/`--sdk-dir=<separate copied trusted SDK>`/`--evidence=<outside copies>`/`--port=0`. Финален URL `http://127.0.0.1:64718/`, Windows browser Chrome155.0.0.0, истински Autodesk WebGL Viewer. Няма canvas imitation. Model/SDK disk files не са редактирани; working Viewer не е спиран.

[relocated-browser-smoke.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/relocated-browser-smoke.json) съдържа geometryLoaded=true,propertiesLoaded=true,664556fragments,438155objects; реален leaf dbId11, `Facet Group`,6properties. Property sample включва Type/Icon/Material/source RVM. Browser externalAttempts/errors/CSPviolations и server CSP reports са0;379recorded requests са локални, resourceOrigins е единствено127.0.0.1:64718. DOM е в [browser-dom.txt](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/browser-dom.txt).

![Реален пренесен Aalborg модел и заредени свойства](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/relocated-model.png)

**Ограничение/адаптация на тестовия host:** original SDK `style.min.css` съдържа54ArtifaktElement CDN font URLs. Temporary HTTP CSS response ги заменя с наличния локален `/sdk/res/fonts/arimo-v29-latin_latin-ext-regular.woff`. Original CSS SHA `630eb9440c8484a7f2e1fac43017c891d17d2a98f7cc8d02b2675c05b142e724`; served response SHA `4f687eb10c4a5c19be5676a143d36862d0967f6fbc9f436492c69bc6d5fddf45`; `originalSdkFilesModified=false`. Това позволява final no-external-request smoke, без да променя SDK/model files. Не доказва бъдещ production WFC runtime/font/CSP policy.

Историята на действителните неуспешни първи опити е запазена: [browser-attempt-1.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/browser-attempt-1.json) е FAIL заради неподдържан test-harness `tree.getNodeCount` call; геометрия е имало, properties proof още не. [browser-attempt-2.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/browser-attempt-2.json) е FAIL въпреки geometry/properties, защото font CDN URLs са блокирани от CSP. Harness поправките водят до отделния final PASS. `browser-console.json` е cumulative console capture и съдържа историческата грешка от attempt1; не се представя като празен final console log.

## Почистване и оставаща работа

Нормалното pack/verify staging и owned locks са почистени от инструмента. Няма `.routings-stage-*`, lock/mutex/publication sidecars при готовия artifact. Тестовият browser tab е затворен; final server е спрян и port64718 няма listener. Task-created containers:0. Read-only inventory показва12pre-existing containers, които са запазени, включително работещият Viewer/WFC/Niedax.

Остава за ръчно премахване **само** task-created temporary relocation directory:

```text
C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output\.relocation-check
```

Проверена11:53:14:551files,960895913bytes (около961MB),0reparse points; съдържа копиран ZIP, extracted model и copied SDK. Готовият оригинален ZIP/manifest/reports/evidence са извън тази directory и трябва да се запазят. [cleanup.json](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/cleanup.json) записва точния target/parent/обем, съществуващите containers и observed shutdown.

Автоматичният контрол отхвърли изтриването преди изпълнение с причина **„blocked by policy“**, без допълнително обяснение. Отхвърлени са verified bounded recursive native PowerShell deletion, literal absolute-path recursive deletion и verified bounded nonrecursive per-file deletion. Няма изпълнено изтриване и не е използван обход чрез друга среда. Това е конкретното незавършено след-задачно действие; core stage1 package/readback/browser критерии са покрити. Не се твърди, че цялото поискано почистване е приключило.

Следващите WFC/Model Preparer/втори-компютър задачи остават `NOT_RUN`. Няма автоматично преминаване към тях.
