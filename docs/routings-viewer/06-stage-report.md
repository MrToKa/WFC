# Етап 6 — отчет за избора на активен модел

**STAGE_6: PASS. READY_FOR_STAGE_7: PASS.** Технически завършен за localhost HTTP, production Docker и development proxy, Chrome Headless Shell 153.0.8010.12. Потребителското приемане на новата секция остава NOT_RUN; етап7 не е започнат.

## Начална база и обхват

Клон `stage6-project-model-selection-20261016`, създаден от завършения `viewer-english-ui-20261016` със запазени tracked/untracked промени на етапи 4–5 и двата cable export commit-а. HEAD е `e4093109e7e10552f1f61093486b9b9fa9bce37b`. Няма нов commit, push, PR, merge или cloud операция. Чист checkout от HEAD/main не съдържа автоматично тази working-tree реализация.

Завършеният английски превод е отделната начална база, описана в [05-english-ui-followup.md](05-english-ui-followup.md). Неговият index SHA е `d264b53e781b3998493413452e0cbe4ffb925d0b095a535a223f16747f44a8f6`; всичките му 16 source файла, включително Model Preparer, са проверени непроменени. Историческият Stage5 evidence index SHA `e541d8c5db938a728d08335ae72162b7bdad5185b4266c284844ebd3e1e76333` също е запазен. Неговите 1670/69/29/14 резултата не са нови Stage6 проверки.

Реализирана е самостоятелна English Fluent секция **3D model** в Details с active metadata/status, source/date и UUID disambiguation, read-only информация, explicit draft/Save/No model, Retry, stale/unavailable/missing-active състояния и conflict review. Подробният договор е в [06-project-model-selection.md](06-project-model-selection.md). Няма Viewer/SDK/iframe в Details, Routings/manual routing, cable/popover UI, импорт/конвертиране през WFC, промени в PathFinder, Model Preparer, Cable.routing, SECONDARY или инженерните изчисления. Съществуващият compile-gated Stage5 harness е използван само за проверка.

## Файлове и review корекции

- Нови browser-only `src/api/projectModels.ts`, `ProjectModelSection.tsx`, `hooks/useProjectModelSelection.ts` и техните тестове.
- Тесни wiring промени в `ProjectDetails.tsx` и `DetailsTab.tsx`; selection не влиза в общия updateProject payload.
- `useProjectDetailsData.ts` вече изолира project/token identity и скрива стария grant преди новия отговор. `src/api/projects.ts` приема optional explicit token; новият `useProjectTokenBinding.test.tsx` проверява реалния HTTP header при различен stored/current token, null и legacy undefined caller.
- `src/viewer/sessionApi.ts` използва Pick от каноничния публичен selection type. Controller/runtime/session lifecycle не са променяни.
- `server/routes/modelRegistryRoutes.ts` добавя private/no-store само на registry metadata GET/HEAD и selection PATCH handlers. Няма auth/schema/selection algorithm промени. По-ранните auth откази остават под съществуващата middleware политика; metadata клиентът винаги е no-store.
- Нови `scripts/project-model-selection/` runner, Compose, helpers/control, actual API/browser acceptance и README; 06 документация и добавени S6 validation rows.

Независимият преглед доведе до изрично token обвързване на project grant заявката, disabled „Keep my choice“ за unavailable/missing draft и изчистване на старото Saved съобщение при външна промяна. Generation/AbortSignal guards, synchronous save fence, no-op без PATCH, same UUID/new revision conflict и unknown mutation reconciliation са проверени. Само потвърден correlated PATCH отговор показва Saved.

## Ревизия и доказателства

Evidence root: `C:\Users\todor.chankov\Documents\Codex\2026-10-16\wfc-project-model-selection-output`.

Последният frozen build inventory е **818 файла / 145154839 bytes**, compact JSON inventory SHA `63ce181bd7bf622eac994e0854746b02ad7348ff35afa3bbaf2c77dc1fabce39`. Това е SHA на `JSON.stringify(parsed inventory)`, по дефиницията на runner, а не SHA на pretty JSON файла. Обхватът включва runtime delivery и изключва docs/env/build caches. `fixture/fixture-state.json` пази build history, image IDs, source stability, command logs и реалния restart proof. Крайният versionable inventory с docs е `evidence/final-stage6-source-inventory.json`, а `final-stage6-evidence-index.json` свързва източниците, документите и всички доказателства по SHA/размер.

Проверени production images:

| Target | Image ID |
|---|---|
| API | `sha256:8261aa597da1cb34995f99ba18beaaf710b8e8c1ec32419b130d9a5a51e6d466` |
| Web | `sha256:e202f24581406aec6912d4136908782ca0d6be65f531d2ee45f1a73fe2f8f961` |
| Test | `sha256:209ede6a94309c25d32ee0d04f393d4cc5cd9ab87d19c2fa3a47d1fa9603fce7` |

Изолиран namespace: `wfc-project-model-selection-stage6-8abf9fc37b7e`, run `8abf9fc3-7b7e-4184-9aa1-958d0b19147b`, Docker proxy 18086 и dev proxy 15186. Отделни PostgreSQL18/private MinIO, два API worker-а, nginx и dev service; три task volumes и две networks. Работният Aalborg проект не е използван за mutations/fault tests. Autodesk/APS и Model Preparer заявки не са правени.

## Нови изпълнени проверки

Final Node24 Docker/network-none regression: **12 Vitest файла / 213 теста PASS**, без skip; typecheck/lint/build PASS, неизменни image/source receipts. `fixture/evidence/1792179174133-regression-vitest.log` е крайният резултат. Покрива новия API/hook/component, Details numeric/tray templates, project/token lifecycle/permissions, ViewerController и съществуващи cable length/tray load/trefoil настройки. Общият HTTP helper не е променян в етап6; token binding тестовете използват реалния му transport. Пълната Stage5 offline/geometry suite не е повтаряна.

Actual API: **2 metadata contracts +6 integration +1 restart случая PASS**. Файлове `selection-contracts-1792179076576.json`, `model-selection-integration-1792179080497-2cf43ae6.json` и съответният restart JSON. Импортиран е pinned Stage3 ZIP, 439112829 bytes/SHA `8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5`, чрез Stage4 API. A съдържа 342 resources/439007803 raw bytes и fingerprint `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`. Допълнителната B има същия label, но различни реални property-resource bytes, fingerprint и UUID; тя е public-profile-valid synthetic fixture с три ресурса, не втори превод на реален NWD или втора Stage1/Stage3 alias версия.

След import изборът остава null/rev0. A→null→B→A завършва с A/rev4. Стар CAS получава409; стар A resource/descriptor остава409 след връщане към A, а fresh session descriptor е200. Физическо премахване само на owned synthetic B resource води до503 и health unavailable, без промяна на A/rev4. Legacy JWT без jti работи за registry GET/HEAD/PATCH; basic read е разрешен, write403; legacy Viewer create остава401 LOGIN_REFRESH_REQUIRED. Реалният рестарт на двата API процеса е доказан с променени StartedAt и запазен selection, включително updatedAt.

Финален browser run: **16/16 PASS — Docker9 и development7**, `stage6-browser-1792179138315-9f81592c-summary.json`. Той проверява production Docker и development proxy, editor/read-only screenshots, initial loading/no-op, explicit keyboard Save/pending, null/reselect/reload, реален two-tab409, изгубен actual PATCH response, actual503, empty/error/Retry и Docker actual Aalborg harness old/fresh load. Има осем screenshots; external/CSP/boundary violations са0. Retry fault counters са Docker1failed/1released и dev2failed/1released; и двата са releasedByExplicitRetry=true. Първоначалният browser attempt `1792178620650-ec4ef10c` е запазен: Docker9 PASS, dev6 PASS/последен Retry case FAIL поради еднократния test fault, който focus refresh премахна. Корекцията държи fault-а до actual Retry click и не променя приложния код или assertions. Browser facts.selection е началният null/rev0 snapshot; final API/restart facts.selection е authoritative A/rev4. Двете не се смесват.

Предварителните Windows CPU timeouts, stale pre-fix module и двусмисленият numeric Save test selector са запазени в evidence. Крайният Linux run минава без отслабване на timeouts. Те не се представят като успешни финални проверки.

## Gate резултати

| Gate | Статус | Основание |
|---|---|---|
| DETAILS_MODEL_SELECTOR | PASS | API/hook/component, English Fluent UI и screenshots; без SDK в Details. |
| READ_ONLY_AND_EDIT_PERMISSIONS | PASS | Actual engineer/basic и UI role matrix; explicit current token project grant. |
| EXPLICIT_SELECTION_AND_NULL | PASS | Actual A/null/B/A и authoritative ACK/reload; initial/no-op без PATCH. |
| NO_OP_AND_CONFLICT_HANDLING | PASS | Unit и actual409/503/lost-response; explicit review, без replay/fallback. |
| ASYNC_STATE_ISOLATION | PASS | Project/token/logout/unmount, dirty focus, same UUID/new revision, single pending save. |
| VIEWER_SESSION_FENCING | PASS | Actual API old409/fresh200; Docker actual harness old/fresh load. |
| REAL_API_BROWSER_PERSISTENCE | PASS | Actual2+6+1 API/restart и16/16 Docker/dev browser случая. |
| EXISTING_DETAILS_REGRESSION | PASS | Final213/213 +typecheck/lint/build. |
| LOCAL_WFC_UPDATE | PASS | Verified images на original WFC; live Details/browser и preservation audit. |
| STAGE_6 | PASS | Всички технически gates в разрешения localhost обхват. |
| READY_FOR_STAGE_7 | PASS | Готова selection основа; етап7 не е започнат. |

## Локално обновяване, запазване и cleanup

След финалния browser PASS `scripts/update-local-app.ps1 -VerifiedApiImage ... -VerifiedWebImage ...` приложи точно горните API/web images към съществуващите `wfc-app-backend-1` и `wfc-app-frontend-1`; и двата са healthy. Credentials са преизползвани само в process memory от съществуващия backend, без запис на реален .env или credential стойности в evidence. `evidence/local-update.log` и `working-details-browser.json` доказват live секцията на `http://127.0.0.1:5180/projects/0c0007c9-d73f-4d13-bc87-601c544727b7`. Read-only smoke на working project има0 PATCH,0 SDK/iframe/Preparer/APS requests,0 external requests и disabled unchanged Save; screenshot `working-details-editor.png`. Maintenance login resource binding е изрично revoked204, без да се засягат потребителските logins.

`working-before.json`, `working-after.json` и `working-preservation-final.json` потвърждават: 13 original services остават, само двете WFC app услуги са обновени; останалите11 имат същите container/image IDs, StartedAt/restart counts, mounts и ports. Docker mount array order се нормализира по destination, а пълните mount entries и raw snapshots се запазват. PostgreSQL/MinIO и Model Preparer са непроменени. HPU Aalborg 2023 (`0c0007c9-d73f-4d13-bc87-601c544727b7`) запазва активен UUID `9dbe511d-9c51-49e8-bb4a-b52033b98f35`, revision1 и updatedAt, проверените model metadata, 2140 кабела и330 тави с идентични id/routing/name SHA. Това са реални наблюдения, а не frontend constants. Работният проект не е използван за selection mutations.

След project+run ownership проверка са премахнати7 test containers,2 networks,3 task volumes и1 unused test image. Двата работни API/web image обекта са запазени, а task aliases са премахнати; по-ранните task build IDs вече не съществуват. `cleanup-before.json` и `cleanup.json` пазят точните identities/действия. Входните ZIP и evidence са запазени. Предишното blocked cleanup от английския follow-up и по-ранните етапи не е повтаряно. Няма global prune, deletion на original volumes или промени по други services.

## Оставащи ограничения и приемане

Потребителско визуално/работно приемане на новата Details секция: **NOT_RUN**. Предишната обратна връзка за зареждането на test model и автоматичните screenshots не го заменят. LAN/HTTPS, други браузъри, втори физически компютър, full backup restore и етапи7–11 остават NOT_RUN. Няма нов механизъм за незабавно изчистване на всички отворени canvas-и: запазени са Stage5 polling/focus/pre-route проверки и сървърните revision fences.
