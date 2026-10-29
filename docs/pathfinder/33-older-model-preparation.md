# Подготовка на стария Aalborg модел за сравнение

Дата: 18 октомври 2026 г. Работно копие:
`C:/Users/todor.chankov/source/WFC-pathfinder-local`, локален branch
`pf-plan-purpose-revisions-20261018`, начална ревизия
`c81328e0c6127d6633d15be51126128e2f8036bd`.

Обхватът е разрешената конверсия на предоставения по-стар NWD. Това не е
имплементация или приемане на PF-R функциите от [план 32](32-purpose-and-revision-plan.md).

## Източник и изолация

- Източник само за четене:
  `D:/OneDrive - ACS/R230039_MAN-Aalborg HPU - LVSG & UPS DB & EIC/3D/Aalborg_ACS_CABLETRAY_07_10_24.nwd`.
- Действителен размер: **69 785 194 bytes**.
- SHA256: `cf61d87b355b3d77d4c6f71a06183fb1d225cbe1bd937b60783d156aedc4df36`.
- SHA1: `2d7b9ffa98479e65d7512e72b907d7a59587a29d`.
- Собствен scratch:
  `pathfinder-engine/.scratch/older-model-3bf01791-b0b5-427d-b2f7-4091d39abe3d`.
- Job: `bef49b27-4a02-4123-a326-b0dc60e50a26`.

Оригиналният Preparer не е стартиран/рестартиран или редактиран. Използвани са
публичните му core API с отделни store/work/output/signing key директории.
Частните account DOM/screenshots, доказателства и ключове остават в собствената
защитена scratch директория. Няма credentials или бизнес редове в Git.

## Действително изпълнение

1. Проверка на редовния файл, стабилните метаданни и SHA1/SHA256 — **PASS**.
2. Ограничено откриване в проверения owned bucket — **PASS**: няма съществуващ
   обект с точния размер/съдържание; конверсията не се дублира.
3. Текущ authenticated browser review на APS Free, team/hub/application и
   лимитите — **PASS**. Първоначален source-bound proof:
   `af4dd22f282fba4bfa89e972cc19e240a109c2d2d21e07d85a77530beabd05d4`,
   валиден 19:39:23.134–20:09:23.134 UTC. Наблюдавани са 9 налични complex units,
   по 2 jobs; разрешен е само един submit. Разминаването между chart и breakdown
   е запазено; за basic е използван по-големият наблюдаван брой 3554.
4. Първото пакетиране на UI доказателствата е отказано заради JPEG байтове под
   `.png` имена. Recorder-ът е поправен да валидира реалния PNG/JPEG формат;
   оригиналните screenshot байтове не са променяни. Това не е APS отказ.
5. Качване — **PASS с възстановяване на проверката**: пет части и един completion.
   Старият adapter отхвърля completion отговора като IDENTITY_MISMATCH; не е
   доказано кое негово поле е различно. Последващ нормален строг GET на обекта
   потвърждава точните размер, SHA1 и локален SHA256. Няма повторно качване.
6. Еднократно първо подаване за **SVF 3D**, `xAdsForce:false` — **PASS**.
   Възстановяването е разрешено само след независимо проверени receipts,
   действителен ledger `none / 0 attempts / 0 acknowledgements`, същия proof,
   изчерпан upload budget и нов точен GET. Ограничител отказва нов upload/storage
   преди network mutation; няма редактиране/нулиране на ledger или повторение на
   неизвестен submit. Независим source review на runner SHA256
   `c9f7ec715f3edfa270f982da459e393d058e2320b4678cd59aa0745f2cbd66ca` — **PASS**.
7. Autodesk derivative completion — **PASS**: пет manifest reads, без нов submit.
8. Първо сваляне — **BLOCKED / COST_EXPIRED**. След 142 signed-resource заявки
   и първия raw SVF прочит валидният кратък review срок изтича; проверката отказва
   следващото четене. Няма промяна на proof срока или заобикаляне на gate.
9. Нов действителен browser review — **PASS**: актуално наблюдавани 1777 basic
   interactions, 2 complex jobs и 9/10 налични units. Новият proof
   `8004f85d4724f384619f8394db633be4653d45b4f3528e87c63e23804f5059b8`
   е валиден 20:06:14.072–20:36:14.072 UTC, с **нула** разрешения за
   storage/upload/submit и до 2000 четения. Старият proof/ledger се запазват.

10. Второто сваляне е прекратено коректно с **COST_EXPIRED** в края на валидния
    срок. Запазени са **70** завършени файлови checkpoints; invocation
    `ad20ba27-4831-49f8-bb4a-7c0fd9c75080` има 246 успешни reservations,
    173 signed-resource и 70 raw-resource заявки, **нула** cloud mutations.
11. Трети действителен преглед на Free/team/hub/application — **PASS**. Новият
    read-only proof `47341ef5e94e31fc846cee6a0b2d61d57ec463bf48d1fac66440e2de447876c7`
    е валиден 20:32:18.048–21:02:18.048 UTC. Наблюдавани са 1926 basic calls;
    complex chart показва 3, breakdown — 6, наличният баланс е 9/10 units.
    Разминаването и stale hub редът са записани; няма разрешение за нов submit.
    Първият опит за този proof е отказан при проверка за промяна на source файла.
    Независимото повторно прочитане доказва същия SHA256, размер и стабилни
    метаданни; следващият непроменен recorder преминава. Gate не е отслабен.
    Pointer е сменен атомарно и отново прочетен като валиден JSON.
12. По време на възобновеното сваляне е извършен следващ свеж преглед, без да
    изтича активният proof. Новият read-only proof
    `b018a362c81f2f58b83e5b8bff22dd7192d4c252bce56a31e40a248d652a023f`
    е валиден 20:50:30.900–21:20:30.900 UTC: basic 2101; complex chart и
    breakdown 3; баланс 9/10 units. Няма mutation grants. Същият процес приема
    новия proof в 20:53:49.923 UTC преди reservation 176, след независимо
    artifact/source/account валидиране. Старите proofs се запазват непроменени.

## Завършен резултат

Състояние: **PASS** за източник → качване → SVF 3D → сваляне → офлайн пакет.
Финалното пакетиране и независима проверка завършват в 21:09:01.699 UTC на
18 октомври / 00:09:01.699 местно време на 19 октомври 2026 г.

| Проверка | Действителен резултат |
| --- | --- |
| Support profile | `svf-local-7.130.0-v1` — PASS |
| Ресурси | 173; 174 769 843 raw bytes |
| ZIP | 174 823 508 bytes |
| ZIP SHA256 | `a4538444641bfc96ce8915a0ef24c1adfebb50a72c1575a23cc475d9bd781183` |
| Content fingerprint | `6f6fdfd86ef0a9061b74062675a3c72c971cfa1c43539e4adf42b9122c75d639` |
| Package ID | `f1074064-2cb8-4d6e-8412-e025343c6e27` |
| Качване / submit | 1 initiate, 5 части, 1 complete; точно 1 submit |
| Последно read-only сваляне | PASS; 280 reservations, 2 свежи proofs, 0 cloud mutations |
| Локално пакетиране / независима проверка | PASS; 0 APS requests, 0 cloud mutations |

Готовият [SVF пакет](../../pathfinder-engine/.scratch/older-model-3bf01791-b0b5-427d-b2f7-4091d39abe3d/runner-state/output/aalborg-older-svf.zip)
остава в собственото локално работно място. Големият пакет и частните доказателства
не се добавят в Git. [Публичният технически receipt](evidence/purpose-revision-plan/older-model-actual.json)
съдържа точните осем изпълнения, hashes, counters и отделните резултати; предишните
неуспешни опити не са заличени. Provider totals се отнасят само за тези runner
receipts, не са общ отчет за целия Autodesk акаунт.

Използван е read-only runner с проверявана ротация към изрично прегледани, свежи, същия
source/account и zero-mutation proofs. Проверява всяко четене чрез непроменения
cost provider; не удължава стар proof. Запазва една provider инстанция и плана
в паметта, а не повтаря конверсията. Невалиден/изтекъл нов pointer отказва без
fallback. Ограниченията са 1000 reservations/45 минути за оператора и непроменен
30-минутен лимит на download adapter-а. Provider е reuseOnly с read-only OAuth.

Независим source review и синтактична проверка на helper SHA256
`ce6a0f33a9408d2b7a1aa2b649e24090fa3c265de8090fad6dcd9b027d605d63` — **PASS**.
Root възобнови същия read-only helper в 20:39 UTC, exec session 69296, след
приключването на session 98950. Изпълнението завърши PASS с 173 checkpoints;
proof activation/read-progress journals са запазени под
`runner-state/read-download-a7b0c3f6-4574-4adb-9098-134eb141fd04`.
След освобождаване на lock root изпълни credential-free `package`, session
53578, също завършила PASS. Няма активен download/packager. Независимият преглед
на публичния summarizer е PASS след премахване на произволно частно поле и
добавяне на проверка на двата действителни source hashes срещу review pins.
Синтактичните проверки и реалното създаване на публичния receipt са PASS.

Реалното сравнение на геометрия/purposes/преместени локации е **NOT_RUN**.
Инженерното приемане и native parity не са доказани. Не е извършен импорт във
WFC, 3D browser проверка на стария пакет или смяна на активния модел.
Не са създадени контейнери, не са променяни
оригиналните checkout-и/контейнери/данни, 5190 или 5191. Няма push/PR/merge.
Нужните доказателства и сравнителният модел се пазят; отказаните за почистване
директории не са докосвани.
Временните две Autodesk browser страници са затворени; съществуващата 5191
демонстрация е оставена отворена. Оригиналното WFC и каноничният PathFinder
са clean при финалната проверка; старият PathFinder запазва същите два
променени source файла и `.vscode/`.

## Финални проверки на документацията

- Независим source и публичен документален review — **PASS**; runtime/package
  резултатът е отделното действително изпълнение на root, не твърдение на reviewer-а.
- Осемте доставки под `docs/pathfinder/`: JSON parse и проверка срещу действителните
  три credential стойности — **PASS**, нула съвпадения/нула разкрити стойности.
- Трите основни документа: **11** локални линка, **0** липсващи цели — **PASS**.
- Публичният package receipt, точният ZIP размер и броячите за един submit — **PASS**.
- Git whitespace проверка — **PASS**. Предупреждението за нормализация LF/CRLF
  не е грешка. Проверен обхват: `dfd04fd` плюс финалните документални промени
  преди локалния commit; няма приложен source код.

Променените/нови доставки са план 32, този отчет 33, `automation-progress.md`,
`handoffs/PF-R0-purpose-revisions.md` и четири JSON файла в
`evidence/purpose-revision-plan/`: active marker, source evidence, discovery evidence
и final actual summary. PF-R0 остава подготвен, **NOT_EXECUTED**.
