# Етап 0 — потвърдено начално състояние

Този документ описва проверките от **16.10.2026**, а не реализирана интеграция. Прочети заедно със [спецификацията](00-specification.md), [матрицата](00-validation-matrix.md) и [отчета](00-stage-report.md). Заданието е „етап 0 — Потвърждаване на договорите и началното състояние“, предоставено от потребителя. Самото задание не е автоматично одобрение на предложената тук спецификация.

## 1. Обхват, инструкции и доказателства

- Работен checkout: `C:\Users\todor.chankov\source\WFC`, открит чрез регистрирания локален проект „ACS App“. Четирите документа се създават тук; `work/review-wfc` не е избран за основна работа.
- Проектният mirror `C:\Users\todor.chankov\.codex\.chatgpt-projects\g-p-6ad0a317833c8191bf8e4e8c824a1056` и неговото `sources/` остават непроменени. Проверочните checkout-и не се изтриват.
- Прочетени: предоставените глобални инструкции, физическият `C:\Users\todor.chankov\.codex\AGENTS.md`, проектният `AGENTS.md` и умението [prepare-stage-handoff](C:/Users/todor.chankov/.agents/skills/prepare-stage-handoff/SKILL.md). В нормалния WFC checkout, неговите проверени родители и прегледаните source директории няма допълнителен `AGENTS.md`. За Viewer също не е намерен приложим файл по родителската верига.
- Извършено: read-only проучване, Git/GitHub проверки, файлови SHA-256 и малки SVF/JSON envelope проверки, след което документация. Не са четени `.env`, токени или стойности на тайни. Четенето на кода за настройки не е проверка на конфигурираните секрети или cloud сметка.
- Не са стартирани приложения, тестове, Docker услуги, импорти, upload/translation, cloud задачи, push, PR или merge. Тестовете в кода са само прегледани.
- Статуси: `PASS` = конкретната описана проверка е извършена успешно; `FAIL` = наблюдаван провал; `BLOCKED` = посочена липсваща предпоставка; `NOT_RUN` = не е изпълнявана. „Планирано“, „налично в кода“, „доказано с проверка“ и „прието с изрично решение“ са различни състояния.
- Съществуващият `docs/` съдържа тематични документи и ADR, но няма подходяща конвенция за етапи на тази интеграция. Използват се точно четирите поискани имена, без втора система от stage документи. `docs/adr/0001-standard-material-composition.md` се отнася за друга функционалност.

Всички времена по-долу са **Europe/Kiev, UTC+03:00**. Първоначалната предоставена версия е от около 09:46; настоящите наблюдения са по-късни.

## 2. Локален Git и текущ remote

| Източник | Локално състояние преди документите | Актуално remote доказателство | Момент |
| --- | --- | --- | --- |
| Основен WFC `C:\Users\todor.chankov\source\WFC` | `main`; `d5454b3c4c547c24631e37e24d35f76739228867`; чист tracked/untracked статус; `0/0` спрямо `origin/main`; няма commits в `origin/main..HEAD` | Live `git ls-remote --heads origin` и GitHub branch GET дават същия `main` SHA | 09:52:53 и GitHub 09:53:17–09:54:40 |
| WFC проверочно `work/review-wfc` | `main`; същият SHA; чист статус при първата проверка | Не се използва като основен checkout; основният checkout е независимо проверен | преди 09:52:53 |
| PathFinder `work/review-pathfinder` | `master`; `45c24bf5f433f13e102600b36f20327c77961d0a`; чист; `0/0` спрямо `origin/master` | Live `ls-remote` и GitHub branch GET дават същия SHA | 09:52:53 и 09:53:17–09:54:40 |
| Локален Viewer | директория без Git история; пакет `aalborg-offline-viewer:1.3`, SDK `7.130.0` | Локални хешове/инвентар; няма GitHub baseline за тази директория | 09:53:12 и 09:56:34 |

`0/0` само по кеширан tracking ref не би било достатъчно. Тук неговият SHA е сравнен с текущите отговори от remote. Не е правен fetch, checkout, reset или друга промяна на refs. Непроверени checkout-и, други дискове, скрита локална работа и действителната runtime база/MinIO остават неизвестни.

GitHub източници: [WFC main](https://api.github.com/repos/MrToKa/WFC/branches/main), [PathFinder master](https://api.github.com/repos/MrToKa/PathFinder/branches/master). Двата repos не са archived/disabled според metadata GET. Branch списъците са пълни за върнатите малки колекции (5 и 6, лимит 100):

| WFC branch | SHA |
| --- | --- |
| `main` | `d5454b3c4c547c24631e37e24d35f76739228867` |
| `AI-suggestion-implementation` | `6a1684516976d5fb4afdb4fd77f17b6a7b4ba326` |
| `Ellis_Vulcan` | `47a9084eb55bea18496af36bb1861931322f55e0` |
| `codex/add-routings-filter-for-cables-list` | `fc81f5e250625afec76ed38f877ad7b790447dbb` |
| `codex/professional-tray-report` | `8b48388726985f8fa51aa6be897d2d9227bac757` |

| PathFinder branch | SHA |
| --- | --- |
| `master` | `45c24bf5f433f13e102600b36f20327c77961d0a` |
| `VMbranch` | `33d344a41fba07d2d4263beba4fd8aedc6057848` |
| `codex/optional-background-transparency` | `5a60a3d6ae5bebe5e53923d1a4736fc38a69c6f2` |
| `codex/path-lookup` | `b5edd1e98ddaaaa5ac38008a4e7af383e274c488` |
| `codex/route-names-from-hierarchy` | `33c1070fc89bfdcabbcd108f218bbaab224a120a` |
| `codex/two-tab-routing-poc` | `8f4d1f870c446133b1c1bd8dc926f3165abdebcf` |

Sources: [WFC branches](https://api.github.com/repos/MrToKa/WFC/branches?per_page=100&page=1), [PathFinder branches](https://api.github.com/repos/MrToKa/PathFinder/branches?per_page=100&page=1). Наличието на branch не е доказателство, че е интегриран в default branch.

## 3. PR, reviews и CI

Проверени чрез GitHub connector на 09:53:17–09:54:40:

- [WFC #1 — Add Roxtec routing filters and matching cables table](https://github.com/MrToKa/WFC/pull/1): open, non-draft, unmerged; head `fc81f5e250625afec76ed38f877ad7b790447dbb`, base `main`; `mergeable:false`, `mergeable_state:dirty` в наблюдавания отговор. Двете reviews са `COMMENTED`; няма върнато `APPROVED` или `REQUEST_CHANGES`. Едното съобщава изчерпана Copilot квота. Един unresolved/non-outdated [P2 thread](https://github.com/MrToKa/WFC/pull/1#discussion_r3479364609) при `RoxtecDetails.tsx:121` описва substring съвпадение `A001` с `A0010`/`BA001`. PR е извън обхвата; рискът за точно slash matching е относим като регресия, не като зависимост.
- WFC #2 е merged на 01.10.2026; няма отворен Viewer интеграционен PR в върнатата колекция от два PR-а. [PR collection](https://api.github.com/repos/MrToKa/WFC/pulls?state=all&per_page=100&page=1).
- PathFinder #1–#5 са closed/merged. [#5](https://github.com/MrToKa/PathFinder/pull/5) е manual path lookup, merged 12.10.2026, head `b5edd1e98ddaaaa5ac38008a4e7af383e274c488`; #2–#4 са Navisworks UI/name/transparency промени. Няма описана WFC интеграция в върнатите title/body. [PR collection](https://api.github.com/repos/MrToKa/PathFinder/pulls?state=all&per_page=100&page=1).

За двата default heads и за WFC #1 head текущите GET отговори са:

| Проверка | Наблюдение | Извод за функционален CI |
| --- | --- | --- |
| Commit statuses | `state:pending`, `total_count:0`, `statuses:[]` | `NOT_RUN`; няма публикуван status, не е доказана running задача |
| Check runs | `total_count:0`, `check_runs:[]` | `NOT_RUN` |
| Actions по точния SHA, без event ограничение | `total_count:0`, `workflow_runs:[]` | `NOT_RUN` |
| Repo-wide Actions | нула върнати runs и за двата repos | не установява локално преминали тестове |

Това е `PASS` само за read-only извличането на информация, **никога PASS за CI**. Wrapper-ът `fetch_commit_workflow_runs` ограничава до PR events; използвани са и директни GET за всички events/check-runs, така че изводът не се основава само на този wrapper.

Проследими endpoints: [WFC status](https://api.github.com/repos/MrToKa/WFC/commits/d5454b3c4c547c24631e37e24d35f76739228867/status), [WFC checks](https://api.github.com/repos/MrToKa/WFC/commits/d5454b3c4c547c24631e37e24d35f76739228867/check-runs), [WFC runs](https://api.github.com/repos/MrToKa/WFC/actions/runs?head_sha=d5454b3c4c547c24631e37e24d35f76739228867&per_page=100), [PathFinder status](https://api.github.com/repos/MrToKa/PathFinder/commits/45c24bf5f433f13e102600b36f20327c77961d0a/status), [PathFinder checks](https://api.github.com/repos/MrToKa/PathFinder/commits/45c24bf5f433f13e102600b36f20327c77961d0a/check-runs), [PathFinder runs](https://api.github.com/repos/MrToKa/PathFinder/actions/runs?head_sha=45c24bf5f433f13e102600b36f20327c77961d0a&per_page=100), [PR1 checks](https://api.github.com/repos/MrToKa/WFC/commits/fc81f5e250625afec76ed38f877ad7b790447dbb/check-runs).

## 4. WFC — проследими съществуващи договори

WFC source anchors са към проверения [commit](https://github.com/MrToKa/WFC/tree/d5454b3c4c547c24631e37e24d35f76739228867). Локалните line anchors по-долу са за същия checkout; приложенията не са променяни.

| Констатация, налична в кода | Източник при d5454b3 |
| --- | --- |
| Пълни масиви кабели/трасета, без server pagination на list endpoints; локалните filtered/paged slices са отделни | [cables.ts](../../src/api/cables.ts):239; [cablesRoutes.ts](../../server/routes/cablesRoutes.ts):2180–2206; [trays.ts](../../src/api/trays.ts):4; [traysRoutes.ts](../../server/routes/traysRoutes.ts):138–163; `useCableListSection.ts:190,252,312,366`; `useTraysSection.ts:155,205,238` |
| `Cable.id`/`projectId` са UUID strings; `cableId` е integer; tag nullable и неуникален; routing nullable text | [cable.ts](../../src/api/types/cable.ts):26–46; [db.ts](../../server/db.ts):496–528. Unique е `(project_id,cable_id)`, не tag |
| From/To локации са `fromLocation`/`toLocation`; `connectedFrom`/`connectedTo` са дати | `db.ts:504–514`; [cable model](../../server/models/cable.ts):103–111 |
| Tray name е nonnullable и unique per project по `lower(name)`; по-силната Viewer NFKC нормализация все пак може да даде колизия | [tray type](../../src/api/types/tray.ts):3–18; `db.ts:858,917` |
| SECONDARY не е трасе за Viewer, но всяко срещане добавя `secondaryTrayLength` в WFC дължината | [cableLength.ts](../../src/utils/cableLength.ts):3–58; [DetailsTab](../../src/pages/ProjectDetails/DetailsTab.tsx):197–215 |
| Функцията за дължина split `/`, trim/lowercase; повторенията се броят; обикновени трасета `lengthMm/1000`; резултат `ceil(sum*(1+bending/100)+endConnectionLength)`, defaults 10%/5m; липсващи/невалидни дължини или празен route дават null | `cableLength.ts:3–58`; [tests](../../src/utils/cableLength.test.ts):7–24, само прочетени |
| Новите project API sections се забраняват по подразбиране за basic/technician и неassigned engineer; read-only POST gate е отделен | [middleware](../../server/middleware.ts):90–149,171–200; [projectsRoutes](../../server/routes/projectsRoutes.ts):28–30. Assigned engineer/admin bypass не отменя проверката за project identity |
| `canEditProject`: admin или assigned engineer с project.canEdit; basic/technician четат assigned projects; engineer чете всички и редактира assigned | [permissions](../../src/utils/permissions.ts):11–19; middleware горе; project PATCH `projectsRoutes.ts:691–706` |
| Bearer е изрично добавен от client helper и единственият login механизъм в middleware; SDK не използва този helper | [http.ts](../../src/api/http.ts):131–147; `middleware.ts:9–27`; [session.ts](../../src/api/session.ts):1–4 |
| Сегашният logout изчиства frontend state/token; няма server Viewer sessions/revocation | [AuthContext](../../src/context/AuthContext.tsx):158–162 |
| Стандартният upload не е model importer: memory buffer, 25 MiB, само doc/docx/xls/xlsx/pdf/jpg/jpeg/png; Nginx 10 MiB | [projectFilesRoutes](../../server/routes/projectFilesRoutes.ts):22–38,162–198; [nginx](../../docker/nginx.conf):8 |
| Object storage има project/template buckets и streaming upload; кодът не задава public policy; download е full stream без stat/Range wrapper | [objectStorageService](../../server/services/objectStorageService.ts):23–45,52–76,94–105; `projectFilesRoutes.ts:629–694`. Реалната MinIO policy не е четена |
| Няма моделни версии, active-model поле или Viewer session таблици в целево прегледания schema/project code | `db.ts`, [project.ts](../../src/api/types/project.ts), `projectsRoutes.ts`, ProjectDetails target files; това е scoped source finding, не runtime DB audit |
| Схемата се инициализира idempotently при startup; има отделни schema services | `db.ts:15,2307–2309`; [server index](../../server/index.ts):13–14 |
| Новият таб има определено място; shell и проект вече имат заглавия | [forms](../../src/pages/ProjectDetails.forms.ts):20–30; [ProjectDetails](../../src/pages/ProjectDetails.tsx):186–205,252–256,1564–1600; Cables list:1584, Trays:1585; [styles](../../src/pages/ProjectDetails.styles.ts):17–71; [AppShell](../../src/app/AppShell.tsx):39–67,150–156,185–234 |
| Fluent theme е глобална; iframe предотвратява теч на стиловете на standalone Viewer | [ThemeProvider](../../src/app/ThemeProvider.tsx):91–105 |
| Production web/API са same-origin чрез `/api`; local dev defaults API на port4000; SPA fallback не трябва да отговаря с HTML за model 404 | [compose](../../docker-compose.yml):78–89; `nginx.conf:10–19,26–28`; `http.ts:32–48` |
| WFC target configs не задават CSP/frame headers; iframe DENY е в standalone Viewer, не във WFC | Nginx/server/app/index targeted search; Viewer anchors в §5 |
| PostgreSQL и MinIO имат persistent mounts; backup обхваща DB и всички MinIO objects | `docker-compose.yml:4–38`; [PORTABLE-DEPLOYMENT](../PORTABLE-DEPLOYMENT.md):36–68,91. Backup/restore не е изпълняван |

Прегледани регресионни тестове, **NOT_RUN**: [projectAccess.test.ts](../../server/routes/projectAccess.test.ts):129,213,220,255,279,297,307,335,361,470,473,516 (`/future-section`, HEAD, отнемане на права, read/edit split); cableLength тестовете горе; съществуващите generation guards в data hooks. Съдържание на тест не е доказателство за текущ PASS.

## 5. Viewer — текущи файлове и ограничения

Root `V` за всички anchors в тази секция:

`C:\Users\todor.chankov\Documents\Codex\2026-10-15\https-get-started-aps-autodesk-com\outputs\aps-local-viewer`

| Файл | SHA-256, PASS за сравнение с подадената стойност |
| --- | --- |
| `V/offline/wwwroot/viewer.js` | `60E3714FA86E190ABDF909A9965165AB6C75DEE97FDD7CDC8EFE651CD363EA7E` |
| `V/offline/wwwroot/route-geometry.mjs` | `4D10D66DCA31F10B82926693A0E7438E68F448047F3F991BAABB82F6ED2573FA` |
| `V/offline/model/model.json` | `FE029C24DE9DE51347F110BF5C5AA41D1EF78FCC5A1CEA6071DBE908632CA793` |

`model.json:2–9`: SVF; entry `/model/output/0/0.svf`; SDK7.130.0; preparedAt `2026-10-15T11:11:00.814Z`; sourceBytes155285346; физически потвърдени **342 файла / 439007803 байта** в output. Старият model.json не е новият portable manifest.

Тестов NWD, прочетен само за metadata/SHA-256:

`D:\OneDrive - ACS\R230039_MAN-Aalborg HPU - LVSG & UPS DB & EIC\3D\Aalborg_ACS_CABLETRAY_30_03_26.nwd`

Размер **155285346**; текущ SHA-256 **`11b2739d92020ee58a52a4e793cf8fd538fb30758eb42176aba93ac7319b048a`**; LastWriteTimeUtc `2026-10-07T09:04:11Z`. Това идентифицира текущия локален вход; старият model.json не пази source digest и не доказва криптографски, че точно тези байтове са били преобразувани. Договор A изрично пази тази граница чрез `source.identityBasis`.

На 09:56:34 са хеширани read-only всичките 342 resources. Според точния алгоритъм в договор A текущият model content fingerprint е **`b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`**; canonical input е33731 UTF-8 bytes. Това е изчисление по предложения договор, не генериран пакет/изпълнен importer. Ключови resource записи:

| Бъдещ portable path | Bytes | SHA-256 |
| --- | --- | --- |
| `resources/output/0/0.svf` | 6883 | `7ff03244ec796e12844b882e4079f32a2b973c786c921f8a63353d2dec2342e2` |
| `resources/output/0/properties.db` | 233991168 | `0a5c21b68a11a1992a8883187c4442d654085caf28c8147b51bb16780bb73f74` |

| Налично поведение/ограничение | Viewer source anchor |
| --- | --- |
| Normalize NFKC/trim/outer-slash removal/uppercase; parse ASCII `/` преди normalize; empty/SECONDARY отпадат, ред/повторения се пазят; 8000 JS code units/100 nonmarker tokens | `offline/wwwroot/routes.mjs:3–12` |
| Exact object-tree names; всички dbId за един key се пазят; >1 ambiguous, не се избира произволен | `routes.mjs:50–67,165–192` |
| Partial route свързва намерените части през пропуските; това не е физически потвърден път | `routes.mjs:182–189`; `route-geometry.mjs:513–554` |
| Няма проектна DB проверка; matched name може да няма geometry/lineCount | `app.js:38–76` |
| Старият manual empty/onlySECONDARY/no match задържа предишната визуализация; интеграционното предложение изрично променя това, без промяна на геометричния алгоритъм | `app.js:79–108`; `routes.mjs:159–170`; `offline/README.md:33` |
| Clear/generation/disposal съществуват, но UI `routeBusy` сериализира; няма последен кабелен избор | `routes.mjs:36–38,148–157,159–196`; `app.js:79–108` |
| Original materials, light7, quality(false,true), tonemap1, exposure1.0, ResizeObserver | `viewer.js:119–128` |
| Ghost0.025; yellow0xffe600; cylinders/spheres, depth off, renderOrder1000; radius median width×0.055 | `routes.mjs:29–34,112–145,182–189` |
| Private Autodesk geometry APIs; world vertices; ограничение1024 descendants/128profiles, finite/dedup guards | `routes.mjs:70–101` |
| Profile calibration, full piece-chain ordering, entry/exit clipping, farther terminal endpoints | `route-geometry.mjs:200–254,322–400,456–510,513–554` |
| Iframe се забранява от CSP frame-ancestors/frame-src none и X-Frame-Options DENY | `offline/server.js:11–20` |
| Global CSS, собствен header, root-relative paths; 320px desktop, 280px<900, stacked<640 | `index.html:9–16`; `styles.css:1–5,50–51`; `app.js:130–149`; `viewer.js:29–33,80,109–116` |
| Loopback-only Host; GET/HEAD/Range; моделът сега public max-age86400; gateway не forward-ва Cookie/Authorization | `offline/server.js:25–27,43–60`; `offline/gateway.js:8–18` |
| Модел/SDK сега копирани в image static; read-only/internal network/loopback compose не е WFC private session архитектура | `offline/Dockerfile:6–8`; `offline/compose.yaml:3–39` |

Текущо read-only envelope доказателство: `0.svf` е ZIP; embedded `manifest.json`53443bytes, `metadata.json`903bytes; manifest v2/toolkit LMVTK5.0.26.0. Има341 assets:340 sibling URIs, всички физически намерени, и `embed:/metadata.json`. Няма активни външни URI в прегледаните manifests;78 material textures са празни. Materials root е `LMVTK Simple Materials`/version1.0, outer version2, inner SimplePhong; texture maps са `$.materials.*.materials.*.textures`. Embedded metadata има два equal-valued `default display unit` keys със стойност `{value:'m'}`; generic duplicate-key rejection върху тези bytes би счупило този съществуващ snapshot. Suffixes: svf1, pf323, bin9, pack1, json.gz7, db1. Entry SVF и properties.db не са сред340 sibling assets; запазват се всички342 файла. Не е прочетена цялата geometry или целият SDK; не е доказана универсална съвместимост на произволен SVF. Narrow profile е решение в спецификацията.

Допълнително при общия review са потвърдени уникални asset ids/URIs и съвпадение на всички340 external asset sizes с raw resource sizes. Embedded metadata има compressed409/uncompressed903bytes; portable raw size и embedded compression metadata не се смесват. На 10:09–10:10 read-only streamed gzip byte count за7 JSON resources установи най-голям decompressed file32950895bytes и максимално ratio998.08:1 при `objects_viewables.json.gz` (1317raw/1314472inflated). Няма запис на decompressed outputs на диск или geometry scan. Това обосновава documented1200:1 limit с допълнителни абсолютни caps; не е browser verification.

## 6. Подготовка и исторически проверки

| Констатация | Source |
| --- | --- |
| Cloud gate с credentials, literal APS_ACCOUNT_TIER=free/APS_ALLOW_CLOUD=true; няма актуална проверка за цена0/остатък | `V/lib/config.js:12–45` |
| Input fingerprint, content-addressed object, reuse manifests/objects, persist submission-unknown преди startJob, xAdsForce:false, retries off | `V/lib/aps.js:28–32,133–192` |
| Known/unknown submitted jobs не се resubmit автоматично; promise coalescing и state write queue са in-process, не distributed exactly-once | `aps.js:158–164,189–192`; `lib/state.js:4–24`; `test/backend.test.js:196–275`, NOT_RUN |
| Exporter фиксира work/offline-preparation, work/offline-source-state.json и output offline; изпълнението би прочело .env; submit е забранен в exporter | `scripts/prepare-offline.js:12–15,73–108` — script не е изпълняван |
| Първи downloadable SVF root, raw gzip, hash/size/transport resume,4 consumers; discovery на derivative и един SVF assets list, не пълен recursive verifier | `prepare-offline.js:120–180` |
| Vendor script byte-preserving/checkpoints/pin; първо7.* discovery без pin; runtime само локален exact version, не CDN fallback | `scripts/vendor-viewer.js:3–4,109–177`; `viewer.js:25–38` |

`V/offline/VALIDATION.md:3–18,24–52` е **историческо сведение от15.10.2026**:74tests,548 model+SDK resource checks, ENETUNREACH isolation, browser localhost/127.0.0.1, properties/measure, start/stop/archive reload, двата regression routes. Физическият Windows internet не е бил изключен. Това не се пренася като текущ PASS, въпреки съвпадащите три хеша. В тази задача всички функционални повторения са `NOT_RUN`.

Геометрични regression anchors: `V/offline/test/route-geometry.test.mjs:143–178,190–220` — B107-1 interior entry, suffix clipping,30°bend, DFC003→C002, full BC023-4. Точните routes и критерии са в матрицата и спецификацията.

PathFinder е независим Navisworks Manage2027/net48/x64 add-in според [README](https://github.com/MrToKa/PathFinder/blob/45c24bf5f433f13e102600b36f20327c77961d0a/README.md#L3), [project](https://github.com/MrToKa/PathFinder/blob/45c24bf5f433f13e102600b36f20327c77961d0a/AddinRibbon/AddinRibbon.csproj#L8), [UI](https://github.com/MrToKa/PathFinder/blob/45c24bf5f433f13e102600b36f20327c77961d0a/AddinRibbon/Ctr/PathFinderControl.cs#L109). Manual lookup skip SECONDARY/repeats/length allowances е описан на README:15–19; това не е Viewer договор за изчисления. Няма WFC client/reference в тези inspected entry files и PR колекциите. Това е ограничена констатация, не доказателство за всяка непроверена локална директория. Никакъв PathFinder код не е необходим за интеграцията.

## 7. Неизвестни и почистване

Неизвестни: actual live DB/MinIO policy, браузърната съвместимост на SDK workers/CSP/session cookies/Range, офлайн рестарт и backup/restore на бъдещата интеграция, днешна APS цена, по-стари source digest доказателства. Техните проверки са бъдещи, не текущ PASS. Предложеният пакет обозначава наблюдавания source digest и тесен compatibility profile; тези неизвестни не налагат upload или нова конверсия в етап1.

Read-only Docker inventory установи предварително съществуващи WFC, Niedax и Viewer контейнери, включително спрян `aalborg-aps-viewer-viewer-1`. Нито един не е създаден от тази задача и липсва основание да бъде определен за ненужен. Не са премахвани чужди услуги/images/volumes или работни копия. Задачата не създава временни пакети, test outputs, downloaded artifacts или контейнери; окончателната проверка за почистване е в отчета.
