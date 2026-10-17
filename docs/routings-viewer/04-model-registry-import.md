# Етап 4 — частен регистър и импорт във WFC

Този етап добавя backend за готовите офлайн ZIP пакети. Не добавя 3D интерфейс, Viewer runtime, resource sessions или browser resource endpoints. Приетата последователност остава 0 спецификация, 1 package tooling, 2 Preparer core, 3 Preparer app, 4 registry/import, 5 protected runtime, 6 Details selector, 7 Routings viewer/manual routing, 8 cables, 9 информационен панел, 10 операции, 11 крайни интеграционни проверки. Историческото предложено групиране в етап 0 не я заменя.

## Runtime и фиксирана distribution

Build и API използват Node 24 с фиксиран Docker digest `a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5` (`node:24-bookworm-slim`). Root engines е `>=24 <25`; dependency versions не са обновявани заради този етап. `npm run server:build` компилира TypeScript и изпълнява `scripts/copy-model-verifier.mjs`.

`server/vendor/routings-model-package/` съдържа 12 непроменени runtime файла, общо 105418 bytes, от публичния самостоятелен модул. Upstream inventory е 24 файла/216308 bytes със SHA-256 `314818762db3ff18405091cb170f2a8c3fbab5b8595b319721ebfbd8a757389a`. `provenance.json` пази произхода и всеки SHA/размер; canonical runtime inventory SHA е `140b5c914eb38f916e6410914d868c7083c888eefaa17011d645a29d7d57ec79`. Copy script проверява inventory, hashes, списъка и безопасността на пътищата преди включване в compiled deployment. `.gitattributes` изключва Git newline conversion само за тази distribution, за да се запазят audited bytes и при Windows checkout с core.autocrlf=true. Adjacent декларациите и provenance са WFC-owned, извън upstream runtime inventory.

Importer извиква единствено публичния `verifyPackage(archive, {extractTo, signal})`. Няма собствен ZIP parser, host Windows import, runtime download или зависимост от Model Preparer/Autodesk SDK. Вътрешните DB assertions проверяват връзката между успешния отчет, job-а и публикуваните метаданни; не заменят verifier-а.

## Данни и публикуване

- `model_import_jobs`: server UUID, project, authenticated requestedBy, request key, archive SHA/очаквани bytes, действителни counters, ownership token, state, nullable version/failure, частен verification report и cleanup timestamps. Състояния: `receiving → staging → validating → publishing → complete`, или `failed`.
- `model_versions`: договор B — portable packageId, отделен WFC UUID, fingerprint, label, source SHA/bytes/identityBasis, profile/SDK/entrypoint, preparedAt, authenticated importedBy, importedAt, report ID, resource count/raw bytes, state и отделен health. Частни са manifest, storage prefix и ownership връзката.
- `model_validation_reports`: пълният публичен verify report и отделна durable SHA-256 readback receipt. Ready изисква успешна проверка и readback, non-null importedAt/report и липса на failure.
- `model_package_identities` и `model_package_aliases`: постоянна portable идентичност и aliases при dedup. Името на source файла не участва в provenance conflict tuple.
- `model_content_reservations`: durable project/fingerprint reservation. Partial unique index допуска една ready версия за project/fingerprint.
- `model_storage_ownership`: server-generated prefix/token и publication/cleanup evidence. Умишлено няма cascading project FK, за да остане доказателство след изтриване на проект.
- `project_model_selections`: nullable версия, selectionRevision и timestamp. Composite FK и DB trigger ограничават избора до ready/healthy версия от същия проект; промяната е transactional CAS.

Преди пълна безопасна verification има само ImportJob. Повреден архив не получава измислена ModelVersion. Upload, verification и object I/O не държат PostgreSQL transaction. Кратки transactions създават job, reservation и накрая публикуват версията/отчета/job completion/ownership publication заедно. Дългият session advisory lock не е transaction и пази job-а от конкурентен recovery. Новият job получава този lock преди COMMIT/видимостта си.

## API

Всички пътища са под `/api/projects/:projectId`. Съществуващият Bearer login, текущата DB роля и project access middleware се прилагат преди endpoint-а. Admin и assigned engineer имат edit; unassigned engineer има read; assigned basic/technician имат договорения read. Няма ново широко POST изключение. Requester/importer identity идва от сървъра.

| Метод и път | Право | Договор |
|---|---|---|
| GET `/model-versions` | read | `{versions,selection}`; само ready версии, nullable activeModelVersionId и selectionRevision; без manifest/storage prefixes/credentials. |
| POST `/model-imports` | edit | Raw streamed `application/zip`, без Content-Encoding. Задължителни `Idempotency-Key: UUID` и `X-Package-SHA256: lowercase hex64`; Content-Length е по избор. Приет upload → 202 `{importId,duplicate,modelVersionId,job}`; завършен replay на същия request key → 200. |
| GET `/model-imports/:importId` | read | `{job}` със safe progress, result/failure; job само от посочения проект. |
| PATCH `/active-model` | edit | `{modelVersionId:UUID|null,expectedSelectionRevision:integer}` → `{selection}`. Stale revision → 409 `SELECTION_CONFLICT`. |

Job DTO съдържа само ID, project/requester, state, nullable result/failure, counters, duplicate flag и timestamps. Грешките са статични безопасни code/message; verifier paths, SQL и storage credentials не се връщат. Не се приемат server paths или URL. Непознати selection body полета се отказват.

При `Expect: 100-continue` директният API отлага Continue до auth, project edit, валидни headers, durable job, свободен worker и частно staging пространство. Nginx има предварителен `auth_request` преди четене на upload body: internal subrequest извиква edit-only GET `/model-import-authorization` за същия проект, който при разрешение връща204 и не създава job/приема пакет. Без тази проверка nginx може да издаде собствен Continue преди upstream authorization; този пропуск е установен с реален тест и коригиран. Unauthorized заявка не получава Continue и през двата пътя. Обикновените uploads остават под backpressure до разрешението. Nginx само за exact import path има 2 GiB limit, unbuffered proxy и 900s timeouts; съществуващите file importer и общ 10m proxy limit са запазени.

202 означава, че архивът е приет изцяло, fsynced и SHA-проверен; обработката продължава асинхронно. За content duplicate с нов request key клиентът получава 202 и после complete job с `duplicate:true`/съществуващ version ID. Неуспешен job не се рестартира със същия key: replay връща същия failed job, а нов опит използва нов key. Същият key с различен archive SHA/размер → 409 `IDEMPOTENCY_CONFLICT`. PackageId/provenance конфликти, установени след първоначалния 202, се връщат като HTTP409 с `{job,code,error}` при GET progress и последващ replay; останалите terminal failures са GET200 с failed job.

## Частно съхранение и limits

Моделите използват отделен bucket `WFC_MODEL_BUCKET` (default `wfc-models`) и съществуващите server MinIO connection настройки. Bucket трябва да няма policy; initializer не прави bucket public и отказва съществуваща nonempty policy. Няма директен browser URL. Prefix е точно `projects/<project UUID>/versions/<server version UUID>/`.

Server credentials трябва да позволяват bucket/policy проверка, създаване на липсващия bucket, object PUT/GET/STAT/LIST/DELETE и MPU LIST/ABORT в model bucket. При отказ за cleanup ownership evidence се запазва за recovery.

Реалната интеграция е проверена с MinIO `RELEASE.2025-09-07T16-13-09Z`, image `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e` — същият image като съществуващия WFC MinIO. Тестовете използват отделен disposable container/volume; работният storage не е използван или променян. Поведението на MPU изброяването по-долу е част от проверената server compatibility основа.

`WFC_MODEL_IMPORT_ROOT` задава частен staging root; default в Docker `/var/lib/wfc/model-imports`, за Windows dev `.data/model-imports`. Production compose добавя отделен persistent staging volume; двата процеса трябва да виждат същия root и да използват еднакви server IDs/DB/storage. Директориите са 0700, receipt marker и partial archive 0600, приетият архив 0400. Default concurrency е един приет/обработван import за API процес. Няма durable upload queue или resumable chunks.

Ползват се оригиналните verifier limits: archive 2 GiB, raw общо 8 GiB, individual file 2 GiB, 100000 файла, manifest 32 MiB, nested file 256 MiB/nested total 1 GiB, depth16, expansion ratio1200 и verification600000ms. Upload също има 600000ms краен срок. Storage requests имат 120s idle timeout, отделен 10-минутен общ срок за всеки storage метод и реален AbortSignal към HTTP transport. При няколко workers дисковото планиране трябва да отчита едновременните архиви, extracted resources и MinIO копия; лимитите не са глобална quota.

Ресурсите се stream-ват от проверен regular file handle, със SHA/размер и file identity проверки преди/след операцията. Bytes, включително gzip, не се променят и не се добавя Content-Encoding. Съществуващ object се приема само след реална равна SHA/size проверка; различен object не се презаписва. След всички PUT операции се прави пълен отделен readback на всички raw bytes. ETag не е доказателство за SHA-256.

Registry използва собствен MinIO client, с изключени SDK retries и без допълнителен автоматичен retry wrapper; стандартният WFC file storage client не е променен. Така отменена операция не оставя SDK backoff, който по-късно да започне нова заявка. Upload stream bridge препраща грешки/преждевременно затваряне/abort и към вътрешния multipart stream; активните HTTP заявки се отменят и изчакват преди cleanup. Нов потребителски опит продължава да изисква нов idempotency key.

## Dedup, избор и откази

Еднакъв project/fingerprint връща една версия. Нов compatible packageId се записва като alias без второ копие на ресурсите и без промяна на label/preparedAt/active selection. Existing unavailable версия остава unavailable; повторният импорт не е скрит repair. Същият packageId с различни fingerprint/profile/source tuple → `PACKAGE_ID_CONFLICT`; same fingerprint с различни source SHA/bytes/identityBasis → `PROVENANCE_CONFLICT`. Друг проект получава собствена версия и отделен prefix, без physical dedup.

Импортът никога не избира модел. Няма implicit latest или fallback. PATCH с null изрично премахва избора. За ненулев избор се проверяват всички stored resources извън DB transaction, health се обновява, след което DB transaction проверява отново membership/state/health/revision. Загубена наличност маркира unavailable и отказва избора, без да избира друг модел. Health е наблюдение към момента на readback; външна административна промяна на MinIO след проверката изисква последващо откриване при runtime/оперативни проверки.

Непубликуваните версии при отказ стават failed; старата active selection остава. При неизвестен COMMIT първо се прави DB reconciliation през друга връзка. Потвърдена публикация никога не се изтрива. Ако DB reconciliation е невъзможен, objects и ownership evidence остават до recovery, без предположение за rollback.

Startup и периодичен recovery (60s) опитват advisory lock и пропускат живи workers. Interrupted jobs се провалят; наличните objects/ZIP сами по себе си не са основание за ready. Cleanup е ограничен до съответния token, точния generated prefix и staging директория с matching ownership marker. След complete се чисти само staging. Crash след COMMIT преди staging cleanup също се възстановява. Нееднозначни filesystem ownership данни се оставят за проверка.

Незавършените MinIO multipart uploads са отделни от обикновените objects. MinIO тълкува MPU prefix като точен object key, а не като директория — това е потвърдено с действителен записан 5 MiB part и съответства на [upstream implementation](https://github.com/minio/minio/blob/master/cmd/erasure-sets.go). Затова cleanup чете ограничен root MPU metadata списък и филтрира само точния доказано unpublished prefix; обикновените objects продължават да се изброяват само под него. Чуждите качвания не се abort-ват, изтриват или записват в публични отговори.

Cleanup валидира собствените key/ID двойки преди всяка промяна, abort-ва batches до512 MPU IDs и започва нов обход до липса на собствени objects и MPU. Чуждите MPU могат да останат. Границите са100000 наблюдавани MPU entries общо за операцията,100000 собствени upload IDs/objects и 10-минутният storage deadline. Новият обход от началото заобикаля и дефекта в SDK8.0.7 upload-ID continuation marker; един пагиниран обход не е достатъчно доказателство. Невалидна metadata/key/ID, повторена страница, превишена граница или storage отказ оставят ownership evidence за recovery. Няма bucket-wide изтриване, SDK fork или изтриване на published prefix при неизвестен DB COMMIT.

Project deletion е serialized с публикацията чрез project row lock и cascading metadata FK: изтрит проект не може после да получи ready import. Retained ownership позволява cleanup на unpublished orphan objects. Published objects на изтрит проект се запазват за отделна изрична retention/оперативна процедура в етап10; staging cleanup не ги премахва. Съществуващото clear-data за cables/trays не засяга моделите.

## Практически импорт

1. Използвайте WFC deployment с Node24 build, configured PostgreSQL/MinIO и частен persistent staging root. Не е нужен Preparer или Autodesk конфигурация.
2. Влезте чрез съществуващия WFC login и вземете Bearer token за admin/assigned engineer.
3. Изчислете SHA-256 на готовия ZIP. Изпратете го като raw body на POST import с Bearer, нов UUID request key и SHA header. Не изпращайте source NWD или sidecar като модел.
4. Следете върнатия importId с GET до `complete` или `failed`. При отказ проверете безопасния failure code. За нов опит използвайте нов request key.
5. Прочетете GET model-versions и извикайте PATCH active-model с желания UUID и текущата revision, когато искате изричен избор. За премахване подайте null.

Няма UI в този етап. Автоматизираният isolated runner и integration driver под `scripts/model-registry/` документират възпроизводимите реални HTTP/DB/MinIO проверки; конкретните резултати са в [отчета](04-stage-report.md).

## Backup и следващ етап

Съгласуван backup трябва да блокира новите imports/selections/project deletion, да изчака активните workers или да ги спре и reconcile-не, след което да запише PostgreSQL metadata/reports/selection/ownership и точно съответстващите immutable MinIO prefixes. Staging jobs не се възстановяват автоматично като ready. Restore изисква пълен resource readback спрямо запазения manifest; липсващи/повредени bytes остават unavailable. Текущият общ backup script сам по себе си не доказва тази съгласуваност.

Етап5 трябва да добави защитения офлайн runtime, sessions, browser resource endpoints и SDK deployment с отделни проверки за authorization/Range/CSP/worker/offline поведение. Operational acceptance/retention/backup restore остава за етап10. PASS за backend не означава приемане на Viewer интерфейс или потребителско приемане на бъдещите етапи.
