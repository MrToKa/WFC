# Етап 1 — самостоятелен офлайн пакетен инструмент

Прочети заедно с [отчета](01-stage-report.md), [договор A](00-specification.md#4-договор-a--преносим-пакет) и [матрицата](00-validation-matrix.md). Етап1 реализира **само пакетиране и проверка на съществуващия модел**. Няма WFC importer, база/MinIO, Details selector, iframe/session, PathFinder или Model Preparer приложение.

## Местоположение и инсталиране

Кодът е извън WFC и работещия Viewer:

`C:\Users\todor.chankov\source\routings-model-package`

Начало: [README](C:/Users/todor.chankov/source/routings-model-package/README.md), [CLI](C:/Users/todor.chankov/source/routings-model-package/cli.mjs), [модулен API](C:/Users/todor.chankov/source/routings-model-package/index.mjs), [машинна схема](C:/Users/todor.chankov/source/routings-model-package/schemas/portable-manifest-v1.schema.json).

Изисква **Node.js24**; проверен е `v24.19.0` от `C:\Program Files\nodejs\node.exe`. Същата версия е налична и в bundled runtime. Няма външни dependencies, `npm install`, automatic install, build/transpile, APS SDK/config или `.env` reader. Офлайн инсталирането е копиране на цялата source директория и осигуряване на Node24. `package.json` е `private:true`; не е създаван remote repo или publish.

В WFC са добавени само двата stage1 документа и актуализирани stage1 части на матрицата. Предходните untracked stage0 files не са добавяни към commit. Историческите baseline/specification/report са byte-for-byte запазени.

## Действителни команди

Работна директория за следните команди е `C:\Users\todor.chankov\source\routings-model-package`. За друг current directory използвай абсолютния път към `cli.mjs`.

### Fixture тестове

```powershell
node --test test/*.test.mjs
```

Записаният пълен run е [fixture-tests.tap](C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/evidence/fixture-tests.tap):168PASS/0FAIL/0skipped. Test suites ползват малки изолирани fixtures; ZIP64 count сценарият е65536empty-file entries, а не големият Aalborg модел. Large artifacts не се добавят в Git.

### Pack

```powershell
node cli.mjs pack `
  --model-dir "C:\Users\todor.chankov\Documents\Codex\2026-10-15\https-get-started-aps-autodesk-com\outputs\aps-local-viewer\offline\model" `
  --source "D:\OneDrive - ACS\R230039_MAN-Aalborg HPU - LVSG & UPS DB & EIC\3D\Aalborg_ACS_CABLETRAY_30_03_26.nwd" `
  --output "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output\aalborg-svf-v1.zip" `
  --label "Aalborg cable trays — snapshot 30.03.2026" `
  --expect-fingerprint b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34
```

Изпълнено е същото pack действие с optional offline audit instrument (по-долу). При съществуващ good ZIP командата го проверява и пази неговите packageId/preparedAt/bytes. Това е идемпотентен retry на публикация, **не WFC dedup/import**. Нов различен snapshot се публикува към нов output file; няма force overwrite.

`--model-dir` изисква локални `model.json`, `integrity.json` и **пълния `output/` inventory**, включително properties.db. Descriptor format/version/entrypoint/count/bytes/source name/size се сверяват; integrity map трябва да изброява точно всички raw files. NWD се чете само за SHA/размер/име и repeated unchanged-source check, не се преобразува/кача. Издадената source identity е `observed-local-file`.

Optional pack arguments: `--package-id UUIDv4`, `--prepared-at UTC-Z`, `--manifest FILE`, `--report FILE`, `--recover`. `--expect-fingerprint` отказва drift от snapshot. При retry journal пази UUID/time/input fingerprint; противоречие с existing output е `PACKAGE_ID_CONFLICT`. `--recover` възстановява само lock с доказано спрян PID; live/unrecognized lock или lifecycle mutex се пази с `OUTPUT_BUSY`. Изоставен mutex изисква отделна инспекция — не се изтрива автоматично. Няма обещание за защита срещу враждебен процес, който сменя filesystem paths между syscalls.

### Verify и изолирано извличане

```powershell
node cli.mjs verify `
  --package "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output\aalborg-svf-v1.zip" `
  --expect-fingerprint b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34 `
  --report "C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output\evidence\new-verification.json"
```

`--report` е нов файл; existing report не се overwrites от verify. Optional `--extract-to NEW_DIRECTORY` създава само нова изолирана директория **след успешна проверка**, извлича manifest+listed resources и сравнява отново всички resource SHA. Отказва existing directory. Verifier използва само ZIP, Node и кода на инструмента; не се нуждае от NWD, Viewer, SDK или cloud state.

Exit codes:0=`PASS`;1=validation/IO/publication failure;2=usage/неподдържан Node major;130=abort/interruption/deadline. Standard stdout е малък JSON summary, failure stderr е structured JSON с code/message/details. Машинният report пази full manifest, inventory verification, profile counters/refs, ZIP SHA, времена, Node версия и limitations.

## Формат, безопасност и доказвана съвместимост

- ZIP съдържа един `manifest.json` и `resources/output/0/...`. Няма NWD, SDK/runtime, README, report, code, `.env`, credentials/state или WFC identities. Writer използва streaming **STORE**; original raw gzip/SVF/SQLite bytes се запазват. Verifier поддържа STORE/DEFLATE и bounded ZIP64. Не зарежда whole model/outer ZIP в Buffer.
- Strict JSON parser вижда всички decoded key occurrences, включително escaped keys. Root manifest unknown/duplicate fields и malformed UTF-8 са reject. JSON Schema е machine-readable договор, а runtime допълва duplicate/ordinal/path/aggregate/fingerprint/profile проверки.
- Fingerprint е точният шестредов prefix+sorted `path<TAB>bytes<TAB>sha<LF>`, UTF-8/noBOM/LF. Label/source/UUID/time/ZIP compression не участват. В реалния пакет canonical input33731bytes; model fingerprintb5bb4fbe… и **отделен** ZIP transport SHAe3056f28…. Нито един не е digital signature или origin attestation.
- V1 е `svf-local-7.130.0-v1`, SVF manifestversion2/toolkitversion`LMVTK 5.0.26.0`/SDK7.130.0. Проверяват се allowed asset/type-set tuples, unique IDs/URI,340sibling refs+one embedded metadata в реалния модел, raw external sizes и compressed/uncompressed internal sizes. properties.db е задължителен въпреки липсата му в assets.
- Structured gzip JSON и empty material texture maps се проверяват; property textual URL не е loader dependency. Known equal `default display unit:{value:'m'}` duplicate е единствената конкретна embedded-metadata exception. Conflicting/други duplicates, external/опасни URI, new reference-bearing schemas, textures и изпълнимо съдържание се reject. Binary geometry/property data са terminal nodes; stream checks/raw hashes/gzip CRC не са пълен semantic PackFile/SQLite parser.
- Директориите имат actual emptiness/CRC/inflation проверки, не само header claims. Stored0/0/CRC0 directory няма payload за streaming; deflated directory се консумира на maxBytes0. Actual Autodesk SVF option bits/43zero alignment bytes се пазят; arbitrary nonzero hidden bytes, links/devices/duplicates/overlaps/encryption/multidisk се reject.
- Source/output/staging са disjoint; no-link/ancestor/case/Windows-reserved checks, exclusive staging, lifecycle mutex и nonce owner check. Финалният ZIP се публикува atomic no-overwrite чрез same-volume link след independent readback; retry не сменя id и не заменя last good package. Sidecars не могат да alias-ват inputs/ZIP/lock/journal/mutex; чужди reports се пазят.

| Ограничение | Runtime value |
| --- | --- |
| Outer ZIP |2GiB|
| Total raw resources |8GiB|
| Resource count |100000|
| Resource |2GiB|
| Portable root manifest |32MiB|
| Inspected nested SVF/recognized gzip JSON, each/aggregate |256MiB/1GiB|
| Depth / expansion ratio |16/1200:1|
| Operation deadline |600000ms|
| Допълнителни parser guards |100MiB central metadata;64KiB aggregate **all-zero** local padding|

Limits могат само да се затягат чрез API options за тестове/операция; не се увеличават мълчаливо. Streamed actual counters, compressed/decoded CRC, exact sizes и repeated ZIP identity/transport checks се използват независимо от metadata declarations.

**Scope на nested cap:**256MiB/1GiB се отнася до инспектираните SVF entries и recognized gzip JSON, както ги различава договор A от opaque terminal data. Real structured total е75480079bytes. Opaque binary/SQLite integrity streams се discard-ват, броят се отделно1286939948bytes и имат допълнителни per-file2GiB/aggregate8GiB/time guards. Сумирането им към structured1GiB cap би отхвърлило договорения модел; стойностите/форматът на A не са сменени. Няма unbounded inflation/buffer.

## Error codes

Договорните codes се пазят: `UNSUPPORTED_SCHEMA`, `UNSUPPORTED_PROFILE`, `INVALID_MANIFEST`, `UNSAFE_PATH`, `EXECUTABLE_CONTENT`, `EXTERNAL_REFERENCE`, `RESOURCE_MISSING`, `RESOURCE_HASH_MISMATCH`, `RESOURCE_SIZE_MISMATCH`, `FINGERPRINT_MISMATCH`, `PACKAGE_LIMIT_EXCEEDED`, `STORAGE_EXHAUSTED`, `PACKAGE_ID_CONFLICT`, `PROVENANCE_CONFLICT`.

Standalone operating codes: `RESOURCE_UNEXPECTED`, `RESOURCE_CHANGED`, `GZIP_INVALID`, `PACKAGE_ABORTED`, `OUTPUT_EXISTS`, `OUTPUT_BUSY`, `PUBLICATION_FAILED`; usage=`USAGE`, native filesystem failures запазват safe code (напримерENOENT). `NETWORK_FORBIDDEN`/`OFFLINE_INPUT_FORBIDDEN` са само от optional audit guard. Това не са HTTP importer responses и не реализира договор B.

## Optional инструменти за доказателства

[offline-guard.mjs](C:/Users/todor.chankov/source/routings-model-package/tools/offline-guard.mjs) се зарежда с `node --import <fileURL?report=...&forbid=...>`. Query values са URL-encoded absolute paths, без environment settings. Той блокира instrumented Node networking/.env APIs и specified source roots, записва attempts/read paths/exit. Това е **in-process instrumentation**, не OS sandbox. Реалните guarded pack/relocated/final runs имат0network и0forbidden reads.

[relocated-smoke.mjs](C:/Users/todor.chankov/source/routings-model-package/tools/relocated-smoke.mjs) е temporarylocalhost-only host:

```powershell
node tools/relocated-smoke.mjs `
  "--root=C:\path\to\verified-new-extraction" `
  "--sdk-dir=C:\path\to\copied-trusted-sdk-7.130.0" `
  "--evidence=C:\path\to\browser-smoke.json" --port=0
```

Тези example paths трябва да се заменят с реални нови local paths; синтаксисът е изпълнен при този етап. SDK е отделно копие, validated206files/82552768bytes. HTTP Host/bind са127.0.0.1, CSP connect/script/worker/fonts са local/self. Original SDK stylesheet има54fontCDN URLs; **само CSS HTTP response в temporary harness** ги remap-ва към наличния локален SDK Arimo font. Original/copy SDK bytes и package/model hashes не се променят; response hashes са в browser evidence. Това е изрично test hosting adaptation, не production WFC runtime integration.

Geometry/property PASS с664556fragments и6properties за реален leaf object е записан с screenshot/DOM/network/CSP evidence. Не е твърдение за WFC session/iframe, пълни UI regressions или втори физически компютър. Временният сървър е спрян и браузърният таб е затворен. Изтриването на временната `.relocation-check` директория е **BLOCKED** от автоматичния контрол с причина „blocked by policy“; остават551файла/960895913bytes. Готовият ZIP и доказателствата са отделно от нея. Подробности и точният път са в [отчета](01-stage-report.md).
