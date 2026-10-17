# Етап 9 — интерактивна информация за кабел

В левия **Cables** списък на **Routings viewer** задържане върху таг за **1000 ms** отваря един nonmodal dialog с оригиналните **From**, **To** и **Routing**. Всички инструкции, контроли и съобщения в приложението са на английски. Информацията има собствена идентичност и не избира кабел, не изпълнява маршрут и не управлява ViewerController.

## Данни и независимо състояние

Тесният `routingCables` adapter използва същия пълен проектен GET и изричен текущ token. DTO включва `id`, `projectId`, `tag`, `routing`, `fromLocation` и `toLocation`; четирите текстови стойности са задължителни `string|null`. Липсващи или неправилни From/To не се заместват с измислени стойности. Оригиналните Unicode, whitespace, slash и multiline данни остават непроменени. From/To са location полетата, а не connectedFrom/connectedTo; няма CableType fallback.

Няма detail request при hover. Списъкът остава единственият собственик на пълния snapshot, search и selection. Публичният `snapshotGeneration` се увеличава само при успешно пълно обновяване и се нулира с project/token/access scope. Refresh in-flight и failed refresh не увеличават generation и не доказват изтриване.

`useCableInformationPanel` получава пълните разрешени редове, generation, read status, opaque scope identity и отделния readonly `viewer.lifecycleKey`. Последният се сменя при нов Viewer run и публичното MODEL_LOADING, а terminal failure го обезсилва. Show/Clear/Zoom и route резултатите не го променят. Няма достъп до private iframe/SDK/session state и няма нов controller или resource session механизъм.

Информационният UUID е отделен от `selectedCableId` и `currentRoute`. Всяко отваряне пази scope/lifecycle, точния UUID/project, потвърден generation и конкретния DOM anchor. Друг UUID никога не замества показаните данни, включително при duplicate tags, filter или пренареждане. Scope/mode/lifecycle несъответствие скрива панела веднага при render; timers и async callbacks също проверяват актуалната идентичност.

## Задържане, фокус и pin

Един общ hook управлява dwell timer и кратък **150 ms** grace за преминаване през gap между реда и панела. До 999 ms няма отваряне; timeout при 1000 ms проверява същия разрешен snapshot и anchor. Leave, подмяна на реда/generation, смяна на scope и unmount отменят стария timer. Pointer или focus в реда/панела задържа информацията. Старият grace не отменя новото задържане върху друг кабел.

Pin фиксира UUID/project и спира hover затварянето; hover върху друг ред не пренасочва pinned панела. Ако филтърът премахне anchor от DOM, запазеният правоъгълник е fallback, без прикачване към съседен ред. Unpin връща обичайното поведение. Изричен route избор на друг кабел затваря предишния панел преди съществуващите select/showCable действия.

## Клавиатура и достъпност

Редовете остават tag-only native buttons с `aria-haspopup="dialog"` и `aria-keyshortcuts="Alt+Enter"`. **Enter/Space** изпълнява съществуващия route action. **Alt+Enter** предотвратява native click, отваря само информацията и поставя фокус в nonmodal dialog. Focus dwell може също да отвори след 1000 ms; hover не мести фокуса. Панелът е `role="dialog"`, `aria-modal="false"`, със заглавие от оригиналния tag, без focus trap или click toggle.

Информацията е read функционалност, независима от готовността на модела. Когато route не може да се изпълни, редът остава фокусируем с `aria-disabled` за route и изричен guarded click handler. Alt+Enter достига разрешената информация, без да допуска невалидно показване на маршрут.

Copy From, Copy To, Copy Routing, Copy all, Pin/Unpin и Close имат достъпни имена. Стойностите са readonly selectable textareas. Escape работи и когато hover панелът е отворен, а фокусът е останал извън него; един общ listener се включва само за отворения панел. Escape/Close връща фокуса към точния наличен ред, иначе към Search. Връщането на фокус е потиснато като нов dwell intent, за да няма автоматичен reopen. Няма clear-route действие при затваряне на информацията.

## Копиране и ръчен вариант

Копира се само след изрично действие. Copy field подава оригиналната snapshot стойност към Clipboard API; `null` означава празен текст. Не се чете DOM-normalized textarea.value като инженерна стойност. Copy all създава plain text точно в този ред:

```text
From: <original fromLocation or empty>
To: <original toLocation or empty>
Routing: <original routing or empty>
```

Вложените нови редове и оригиналните символи са част от стойностите. „No value“ е само placeholder и не се копира. Данните се показват като текст; няма HTML insertion. Функционалността не чете clipboard и не копира при hover, pin или refresh.

„Copied.“ се показва само след успешен write. При unavailable/denied/failed API се показва **Select the text and press Ctrl+C.**, а съответното поле може да се фокусира и маркира след изричния Copy click. Copy all има достъпен readonly **Copy all text** вариант със същия plain text. Ръчното маркиране е налично и при работещ API.

Feedback е ограден от scope/lifecycle, panel serial, UUID/generation, копирания snapshot и copy operation. Закъснял success/failure не отваря затворен панел и не показва резултат за друг кабел или обновени данни.

В текущия Windows/Chrome preflight native clipboard readText връща платформени CRLF след LF write; paste в собствен textarea запазва очакваните LF нови редове. Проверяват се отделно точните оригинални аргументи към writeText и действителното native копиране/paste, без обещание за еднакво кодиране на line endings между различни платформи. Browser denial и симулираните unavailable/failed случаи се отчитат отделно в отчета.

## Обновяване и оформление

Reconciliation използва пълния snapshot, включително за hovered/pinned неизбрани кабели. Успешно обновяване на същия UUID обновява оригиналните стойности/tag; при променени стойности или tag показва **Cable information was updated.** Непроменен snapshot увеличава generation, без ново известие. Изчезнал UUID или вече празен tag затваря панела. From/To-only промяна не инвалидира маршрута; Stage8 Routing invalidation остава непроменена.

По време на refresh отворените стойности са обозначени като previously confirmed. Failed refresh ги обозначава като cached/may be out of date; не се обявяват за новопотвърдени. Ново отваряне изисква потвърден snapshot. Напускане към Manual, project/token/logout/access loss, model reload/dispose и unmount затварят информацията и отменят timers.

Един общ Fluent Portal е извън отделните редове и overflow контейнерите. Fixed позиционирането предпочита дясно/ляво от anchor и се ограничава до viewport с 8 px margin, ширина до 416 px и ограничена височина с вътрешен scroll. Resize/page/sidebar scroll и visual viewport се следят само за отворения панел. Дълги стойности се пренасят/скролират, controls остават достижими. WFC dark theme се наследява от portal; светлият Viewer и 320/280/stacked grid не са променени.

Текущите проверки, точният browser/clipboard scope, evidence, локалното обновяване и cleanup са в [09-stage-report.md](09-stage-report.md) и S9 редовете на [00-validation-matrix.md](00-validation-matrix.md). Историческите Stage8 и native125/blocked cleanup резултати остават исторически. Етапи 10 и 11 са отделни.
