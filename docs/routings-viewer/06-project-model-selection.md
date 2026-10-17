# Етап 6 — избор на активен 3D модел от Details

## Обхват и начална база

Етапът добавя отделна Fluent UI секция **3D model** в Project Details. Текстовете са на английски. Секцията използва registry/selection API от етап 4 и не създава Viewer, iframe, SDK, importer или нов механизъм за resource sessions. Приетата последователност остава: 7 Routings/manual routing, 8 cables, 9 информационен панел, 10 операции, 11 общо приемане.

Локалният клон е `stage6-project-model-selection-20261016`, създаден от завършения `viewer-english-ui-20261016` със запазен working tree. HEAD е `e4093109e7e10552f1f61093486b9b9fa9bce37b`; този commit самостоятелно не съдържа непубликуваната реализация на етапи 4–6. Няма push, PR, merge или cloud операции. Преводът е отделно документиран в [05-english-ui-followup.md](05-english-ui-followup.md); неговият evidence index е `d264b53e781b3998493413452e0cbe4ffb925d0b095a535a223f16747f44a8f6`.

## Публичен API договор

`GET /api/projects/:projectId/model-versions` връща `{versions,selection}`. Изборът съдържа `projectId`, `activeModelVersionId: UUID|null`, `selectionRevision` и `updatedAt`. Версиите са ready записи, но само `health=healthy` позволява нов избор. Неналична активна версия остава видима; липсващият в списъка active UUID е несъгласувано състояние, а не `null`.

`PATCH /api/projects/:projectId/active-model` приема точно `{modelVersionId: UUID|null,expectedSelectionRevision: integer}` и връща `{selection}`. Dropdown стойността е WFC UUID. Label, source, дата и UUID помагат за разграничаване на еднакво именувани версии; packageId/fingerprint/dbId не са selection identity.

Browser adapter-ът `src/api/projectModels.ts` използва конфигурирания API base URL, изричен Bearer token, `cache: no-store` и AbortSignal. Проверява публичния DTO и project identity, без server/storage imports. Неизвестни DTO полета не се пренасят в UI. Безопасните кодове/status разграничават CAS конфликт, unavailable, липса на права и невалиден отговор. Общият HTTP helper не е разширяван за този етап. Registry/selection API приема и legacy JWT без `jti`; Viewer session правилото `LOGIN_REFRESH_REQUIRED` не се пренася към Details.

Съответните registry GET/HEAD и PATCH handlers добавят `Cache-Control: private, no-store`. По-ранните общи authentication/authorization откази остават под съществуващата middleware политика; клиентската metadata заявка винаги е no-store. Няма промяна в auth, schema, immutable model storage или resource delivery.

## Интерфейс и права

Активната версия и статусът се показват независимо от edit правото. Изричното `No model` е draft стойност `null`; зареждане, refresh и смяна на dropdown сами не изпращат PATCH. Няма автоматичен first/latest избор. Empty project, no selection, loading, stale information, request failure и unavailable са различни състояния. След failed refresh старата информация може да остане видима с предупреждение и Retry.

Изборът и Save са достъпни при текущите `canEditProject(user,project,routeProjectId)`, съответстващ project ID и token. Името на съществуващия DetailsTab prop `isAdmin` не променя семантиката му на `canEdit`. Read-only потребителят вижда същата информация без mutation controls. Сървърът независимо проверява текущите права. Project metadata заявката също получава изрично същия token; optional аргументът на `fetchProject` запазва съвместимостта с останалите callers.

Save е забранен при непроменен избор, pending операция, липса на права/token, остаряла/невалидна authoritative информация, конфликт или неподходяща draft версия. Съществуващите numeric fields, tray templates и общият updateProject payload остават отделни. Project metadata grant-ът е обвързан и с token identity; сменен login не може да покаже старото edit разрешение от кеширания проект.

## State, concurrency и неизвестен резултат

Hook-ът `useProjectModelSelection` държи отделно authoritative snapshot/revision, draft и operation identity. Непроменен Save е HTTP no-op: дори PATCH на същия UUID/null би увеличил revision и прекратил Viewer сесиите. Едно синхронно operation ограждение предотвратява два едновременни save опита, включително преди React render.

Ненулевият save изчаква съществуващия пълен resource readback на сървъра. Pending UI не се заменя с преждевременно Saved. Само валиден потвърден PATCH отговор позволява успешното съобщение. При изгубен/невалиден отговор резултатът е неизвестен: извършва се read-only reconciliation, без автоматичен mutation retry и без твърдение, че сървърът не е записал.

При `409 SELECTION_CONFLICT` се прочита актуалният snapshot, запазва се draft-ът и се изисква ново изрично решение. Не се изпраща старият draft с тихо обновен revision. При `503 MODEL_UNAVAILABLE` изборът се запазва, health се обновява и няма fallback.

Focus/reveal обновява authoritative данните. Незапазен draft плюс променен server revision води до явно review състояние, включително когато active UUID отново е същият. Project/token/logout/unmount прекратяват заявките и обезсилват късните completions чрез generation/operation guards. Refresh по време на save не създава втори PATCH и не отменя потвърждаването му.

## Viewer и локално обновяване

Stage5 ViewerController продължава своите selection polling/focus/pre-route проверки. Сървърните selection/revision fences отказват нови заявки от стари resource sessions след промяна; A→B→A не ги възстановява. Няма нов broadcast механизъм и не се обещава незабавно изчистване на всички вече нарисувани canvas-и.

Проверките с import, selection/null/conflict/unavailable и рестарт се изпълняват единствено в новия Stage6 disposable namespace. Реалният вход е `aalborg-svf-stage3.zip`, 439112829 bytes, SHA-256 `8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5`. Stage1 и Stage3 пакети не се броят за две различни моделни версии. Допълнителната синтетична версия трябва да има различно проверено resource съдържание.

След успешните проверки съществуващият `scripts/update-local-app.ps1` обновява необходимите WFC услуги на `http://127.0.0.1:5180/`. Работният Aalborg selection, DB/MinIO volumes, кабелите/тавите, Model Preparer, PathFinder и останалите услуги се запазват. Точните изпълнения, inventories, screenshots, deployment и cleanup са в [06-stage-report.md](06-stage-report.md).
