# PF-U: опростено разрешаване на кабели без автоматичен маршрут

Дата: 20 октомври 2026. Състояние: **PF-U0–PF-U6a TECHNICAL_SOURCE_VERIFIED; PF-U7 NEXT; real-model reread BLOCKED**. Планът и изпълнението са
изрично разрешени от потребителя; след всеки проверен етап се подготвя и изпълнява
следващият. Техническите проверки не са човешко инженерно приемане.

## 1. Работен процес

В **Path Finder → Path** основният работен изглед става **Needs routing**: търсене
и четим списък с кабелите, които изискват действие, подобно на Routings viewer.
Всеки ред показва кабелен tag, From, To и конкретната причина. Отделни филтри
показват Calculating, Ready for review, Updated и All non-MV cables. MV остава
изключен; неизвестна категория се показва като проблем, а не се разрешава.

Натискането на кабел отваря устойчив немодален прозорец. Моделът и неговият
Model Browser остават достъпни. Администраторът избира един обект и натиска
**Apply for From** или **Apply for To**. Прозорецът показва към коя логическа
локация се прилага изборът и колко различни кабела я използват. Запазването
обновява една обща проектна връзка, използвана и от двата края на всички такива
кабели. Не се правят20независими записа на едно и също табло.

След потвърден запис автоматично се преоценяват само засегнатите кабели. При две
готови крайни точки се пуска целево изчисление, без ново ръчно Match all или
Calculate project. При оставащ проблем кабелът остава в списъка с точната причина.
Избраният кабел показва новия маршрут и двете крайни устройства върху модела.

## 2. Приети решения и граници

- Всички продуктови текстове са на английски. Авторските операции и Path Finder
  остават строго само за актуални server-side администратори.
- **Новото решение на потребителя:** автоматичен запис на routing и designLength
  само ако и двете текущи полета са празни. Ако едното или и двете имат стойност,
  резултатът изисква ръчно одобрение със сравнение старо/ново.
- Празен routing означава NULL или текст само с whitespace. Празен designLength
  означава NULL. Нула е съществуваща стойност; undefined, невалиден текст и липсващ
  current read не дават право за автоматичен запис. Частично попълнен ред винаги
  преминава към ръчно одобрение. Проверката се повтаря в транзакцията на записа.
- Installed length се запазва. routing+designLength се записват атомарно с
  cableWriteRevision, текущи права/зависимости и idempotency. Новият автоматичен
  запис има собствена provenance **automatic-initial-fill**, без фиктивен human
  Review и без подправен reviewId. Старият manual Apply запазва своите проверки.
- Calculation-only grant НЕ получава право за запис. Целевото първоначално
  попълване изисква отделно проверимо, ограничено разрешение от текущия admin
  login за конкретния проект/засегнат обхват. Изтичане/отнемане на права спира
  записа; не се подновяват или измислят права във фонов режим.
- Логическите From/To имена от кабелния списък остават авторитетни. Изборът на3D
  табло свързва обекта с това име; не преименува всички кабелни локации по името
  на SDK обекта. Съвпадение: NFC + trim + uppercase, със запазена пунктуация и
  водещи нули. Само потвърдени aliases разширяват съвпадението; ambiguity не се
  разрешава с първия намерен кандидат. Различни проекти не споделят връзки.
- Ако From/To името е празно, потребителят изрично задава логическо име. Записът
  на това поле изисква собствена проверка на кабелната ревизия; не се измисля име.
- При3Dизбор се използва защитеният Viewer bridge. Един текущ модел, един избран
  обект и проверими units/frame/geometry provenance. Няма директен NOP_VIEWER.
  Поддържаният object-derived anchor е долният център на проверения bounding box;
  точен surface point остава отделен ръчен избор. Непотвърден object-attached
  режим не се обявява за работещ.
- Запазват се filled Ghost, оригиналните цветове, From/To foreground, жълтата
  линия, точните path points и Clear/restore. Left/Right продължава да засяга само
  чертежите. C# математиката за обичайните маршрути остава непроменена.
- S/E/P и Connection gap идват от Project Details. Новата директна SECONDARY
  връзка е отделна стратегия; не променя скрито съществуващия SECONDARY allowance.

## 3. Допълнение: директна връзка SECONDARY

Потребителят поиска всички видове устройства — табла, инструменти, консуматори —
да могат да се свързват директно, вместо кабелът да се качва до мрежата и да се
връща. Маршрутният текст за този отделен тип е
`/SECONDARY`, а3Dпредставянето е линия между същите потвърдени From/To точки.

Потребителят уточни окончателното правило: D е директната3Dдистанция между
From/To точките; F и T са съответните най-къси3Dподходи до допустимите за
категорията трасета в текущата проектна мрежа. **Избира се директен SECONDARY,
ако D < F или D < T.** Равенството не задейства правилото. Не се добавя отделен
максимум в метри и S от Details не се използва като праг. Няма ли проверима
допустима мрежа/nearest-distance, няма измислено безкрайно разстояние или PASS.
MV остава изключен съгласно решението за кабелните категории; „всички устройства“
разширява видовете From/To обекти, а не отменя тази категория.

Потвърдената формула е ceil((distance3D + E) × (1 + P/100)),
с точните приети C# double→decimal правила, веднъж добавен E и без втори S/gap.
Съществуващите SECONDARY подходи запазват досегашната формула. В резултата има
отделен strategy/formula version, действителна дистанция и причина за избора.
Правата линия не доказва липса на стени/препятствия; това не се представя като
collision-free инженерна проверка. MV не се включва чрез това изключение.

## 4. Проверено начално състояние и технически зависимости

Работно копие `C:/Users/todor.chankov/source/WFC-pathfinder-local`, начално чисто
tracked състояние на `57a203ae170e43276dee5ff43a288f803d2c0fbe`. Запазени чужди
untracked `.pf0-work/` и `.pf2-work/`. PF-U0 започва на наследяващ локален branch
`pf-u0-cable-workflow-contracts-local-20261020`. Оригиналният WFC5180, старият5190,
PathFinder checkout-ите и sources/ остават само за справка. Без push/PR/merge.
Предишните65проверки са доказателство за report59 при неговия revision, не нов
резултат за тази функционалност. Live remote/CI не са проверени за новия план.

Проверените изходни точки са:

- `PathFinderTab.tsx`: сегашният списък филтрира липсващи точки, но не всички
  no_path/stale/failed случаи. Inline editor и дълги технически панели затрудняват
  работата. Изборът на historical calculation и preview вече са вързани правилно.
- `CableInformationPanel.tsx`: използваем немодален Portal shell. Hover lifecycle
  от Routings viewer не е подходящ за постоянен редактор по време на3Dизбор.
- `EndpointBindingPanel.tsx` / `useEndpointBinding.ts`: налични са атомарно
  споделено запазване, revision guards и retry на същия неизвестен запис. Pending
  командата е в ref и не трябва да се губи при unmount на новия popup.
- `endpointBindingRepository.ts`: server role/login/frame/alias/head/hash guards,
  object-derived anchor и споделена локация вече съществуват. Няма точен endpoint
  за SDK dbId → текущ immutable geometry record; това трябва да се добави.
- В момента всеки binding bump-ва глобалната registryRevision. Всички dependency
  hashes я включват, така че и незасегнати резултати остаряват. Само UI повикване
  calculate(affectedIds) не решава това; нужен е versioned per-cable договор.
- Scheduler-ът е project-wide. Нужни са transaction outbox/impact/coalescing за
  целевите локации. Finite автоматичният Level-A мандат изтича след30минути;
  manual job няма такъв общ30минутен timeout. Нито един не подразбира Apply.
- Изчислителният канал е сериализиран; oneshot и full-state polling носят разход.
  Новият интерфейс не бива да пуска повторни пълни2140кабелни задачи за едно табло.

## 5. Етапи и проверки

| Етап | Доставка | Задължителна проверка преди следващия |
| --- | --- | --- |
| **PF-U0 — договори** | Този план; write-policy truth table; отделни endpoint/job/currentness/UI състояния; синтетични договорни тестове; първи handoff и активна автоматизация за новия обхват. | Двете празни полета дават единствено eligibility за initial-fill, не server authorization; частично/0/невалидно/непотвърдено състояние не разрешава auto write. MV/unknown/ambiguity остават явни. Няма runtime промяна. |
| **PF-U1 — пълен списък Needs routing** | Пагиниран bounded admin read-model с търсене, причини и филтри. Всички кабели с проблем се включват, а не само latest5. Endpoint readiness, outcome, job state и currentness са отделни. | Missing From/To, ambiguous, no_path при две намерени точки, stale, not-evaluated, timeout/resource/cancelled/authority failure; стабилни страници100; нулеви записи при четене; MV изключен; историята не се смесва с текущия резултат. |
| **PF-U2 — избор и споделена връзка** | Точен bounded SDK-ID lookup в текущия trace; при липсващ record — проверим bounded capture на избрания обект в отделно текущо endpoint evidence или ясен отказ, без фалшифициране. Команда cable+From/To+revision → съществуваща/нова обща binding. Durable owner-scoped pending recovery. | Един обект; wrong model/project/hash/frame и multi-selection отказват; binding за едно табло се използва от20кабела и от двата края; alias conflict rollback; lost acknowledgment използва същия ключ; затваряне/смяна на кабела не губи неизвестния запис. |
| **PF-U3 — целево преизчисляване** | Нова versioned per-cable currentness proof; global registry остава concurrency/audit, но не инвалидира сляпо чужди endpoints. В binding транзакцията се записва affected impact intent. Идемпотентна bounded admission, dedupe/coalescing, ограничен progress API. | Един запис → един засегнат обхват; еднакви входове не създават втори job; две бързи промени пазят последната; незасегнати резултати остават current; auth expiry/revocation/cancel/restore fences; без forced bypass на отменена задача; progress не пресмята целия проект. |
| **PF-U4 — първоначален автоматичен запис и сравнение** | Отделен initial-fill mandate и atomic commit path. Само both-blank/current/compatible/successful резултати могат да запишат routing+designLength. За съществуващи стойности: стар/нов маршрут, добавени/премахнати/пренаредени участъци, стари/нови дължини и delta, индивидуален/пакетен Review→Apply. | МатрицаNULL/whitespace/0/partial; manual/import edit между calculate и commit; повторение на ключ/загубен отговор; atomic pair/history/provenance; installLength запазена; calculation-only grant отказва auto write; без fake review; старите approvals не получават нови права. |
| **PF-U5 — разбираемият работен екран** | Needs routing list + постоянен немодален popup, реюз на стила на Routings viewer. Apply for From/To, ясно shared count, избор от Model Browser и optional surface point, Save/Recalculating/Updated/Review required/Still blocked. Техническата история е в Advanced. | Popup остава отворен при iframe focus/selection/orbit/pan; няма backdrop/focus trap; Escape/Close и връщане на focus; exact cable/end/model ownership; късни отговори не сменят друг кабел; една обща локация обновява всички засегнати редове; жълта линия/Ghost/endpoints/Clear запазени. |
| **PF-U6 — директна SECONDARY връзка** | Потвърденото D<F OR D<T за всички видове From/To устройства; отделен formula/strategy version; nearest допустима геометрия според категорията; `/SECONDARY` и линия между устройствата. Формула actual3D+E, после P и ceiling. | Двата клона на OR; equality не задейства; D по-късо само от пълния graph route не е достатъчно; липсваща допустима мрежа не е infinity; units/frames/finite guards; точна C# формула/rounding; E веднъж, без S/gap; normal routing parity запазен; без измислен collision PASS. |
| **PF-U6a — Properties и видимост** | Допълнение от20октомври: автоматичните From/To кандидати използват собственото име от Model tree и стойностите на всички четими скаларни Properties. Скритите обекти/наследници на скрит родител се изключват. Нов versioned policy и отделно SDK display visibility evidence; native visibility не се измисля. | Custom property match, дубликати/ambiguity, hidden/off/ancestor/fragment exclusions, показан отново обект, cache freshness, PF Ghost не се приема за user-hidden, еднакви evidence при discovery/capture/publication, legacy history запазена, bounded memory/scan/откази без false missing. |
| **PF-U7 — интеграция и експлоатация** | Изолирани integration/security/regression сценарии и реален converted-model read/pick/recalc тест, computer-use когато разрешението позволява; отделени фази на времето. | Всички предходни критерии; shared20synthetic + реална проверима селекция; blank/partial/existing cable scenarios; browser reload/recovery; stale model/auth; няма duplicate/full-project fanout; old/new comparison; schema/restore compatibility; честни PASS/FAIL/BLOCKED/NOT_RUN. |
| **PF-U8 — локална доставка** | Проверени backup/restore/offline инструкции, обновен само собственият5191 runtime, демонстрация, отчет/commit/handoff, почистване само на собствени ненужни ресурси; изключване на автоматизацията при технически край. | DB/model/storage backup преди съществено обновяване; migration/restore проверени в нов собствен fixture; реално работещ адрес; original5180/5190 и данните им запазени; няма secrets/business rows в Git; човешките ограничения и неприети случаи описани. |

## 6. Поведение при проблем и сравнение

- Diagnostics pagination връща до100съвпадения след bounded scan на до200кабела.
  Cursor-ът носи последния проверен cable ID и е свързан с project/query/context.
  Празна филтрирана страница с оставащ cursor не означава липса на проблемни кабели
  в проекта. Не се прескачат непоказани съвпадения; при100съвпадения scan спира.
  Отделното itemState пази blocked кабелите видими дори когато общият job работи.
- Popup-ът се разполага така, че да не покрива Model Browser, и може да се свие
  по време на избор, без загуба на избран cable/end, draft или неизвестна команда.
  Липсата на modal backdrop сама по себе си не е достатъчна за достъпен3Dизбор.
- Saving binding връща резултат без да чака engine. Ако другият край липсва,
  прозорецът показва коя локация остава за задаване. Не показва неопределено Loading.
- Изчисление за стар endpoint revision не може да измести нов резултат. Unrelated
  cancelled jobs не блокират новия изрично разрешен location impact; собствен
  cancelled impact не се подновява скрито. Retry е само при нови релевантни входове
  или изрично действие; unchanged timeout/no_path не създава безкраен цикъл.
- При съществуващ кабелен запис старото routing/designLength остават до човешко
  одобрение. Сравнението запазва реда и повтарящите се участъци; само set-diff не
  е достатъчен. Наличен accepted receipt дава точните стари geometry/ledger стойности;
  без него не се извежда стара геометрия от закръглен designLength.
- При automatic initial-fill конкурентен manual/import edit отказва записа и
  показва актуалния конфликт. Не се заличават нови човешки стойности с retry.
- Обичайното прилагане остава атомарно за всеки кабел; batch отчита частичен успех,
  запазва потвърдените записи и може да спре между кабели.

## 7. Автоматично изпълнение и evidence

Една актуализирана heartbeat автоматизация за този чат изпълнява само PF-U плана;
не стартира повторно старите PF/PF-R етапи и не възобновява Simplified Preparer.
Първо чете live Git/agents/progress. Root остава единственият runtime/SQL/HTTP
executor; агенти работят с ясно разделени файлове и пазят паралелните промени.
Всеки етап има нов наследяващ локален branch, проверени доставки, локален commit,
точни receipts и самостоятелен следващ prompt чрез prepare-stage-handoff под
`docs/pathfinder/handoffs/PF-U*.md`. Следващият разрешен етап се изпълнява веднага.

Текущият checkpoint е в automation-progress.md: етап, branch/HEAD, собственост,
активни процеси, реални проверки/ограничения и следваща стъпка. Не се повтаря
активно изпълнение. Преди runtime промяна се проверяват owner/path/project/port
на5191; нови тестови ресурси имат отделни owner/DB/storage/volumes. Без write към
5180/5190. При промяна на engine/server identity не се преназовават старите receipts
и не се прекъсват текущи jobs без отделно конкретно основание.

Изтриване само на доказано собствени ненужни ресурси, с проверени абсолютни граници;
без общ Docker prune и без повторение/заобикаляне на исторически отказаните paths.
Нужните модели/ZIP/backup/evidence/5191демо се пазят. Без push/PR/merge/deployment.
При истински външен блокер се продължават независимите части; автоматизацията се
спира само при завършена техническа доставка или липса на полезна независима работа.
