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

## Текущ checkpoint

Състояние: **IN_PROGRESS**. Реалната конверсия е завършена; следват довършване
на свалянето, пакетиране и независима проверка на офлайн пакета. Подготвен е
read-only runner с проверявана ротация към изрично прегледани, свежи, същия
source/account и zero-mutation proofs. Проверява всяко четене чрез непроменения
cost provider; не удължава стар proof. Запазва една provider инстанция и плана
в паметта, а не повтаря конверсията. Невалиден/изтекъл нов pointer отказва без
fallback. Ограниченията са 1000 reservations/45 минути за оператора и непроменен
30-минутен лимит на download adapter-а. Provider е reuseOnly с read-only OAuth.

Независим source review и синтактична проверка на helper SHA256
`ce6a0f33a9408d2b7a1aa2b649e24090fa3c265de8090fad6dcd9b027d605d63` — **PASS**.
Root го стартира реално в 20:16:12 UTC, invocation
`ad20ba27-4831-49f8-bb4a-7c0fd9c75080`, session 98950. Не започвай второ активно
изпълнение. Общият runner.lock се пази; proof activation/read-progress journals
са под `runner-state/read-download-ad20ba27-4831-49f8-bb4a-7c0fd9c75080`.
След освобождаване на lock старият runner може да изпълни credential-free
`package`. Първият download процес вече е приключил с COST_EXPIRED.

Реалното сравнение на геометрия/purposes/преместени локации е **NOT_RUN**.
Инженерното приемане и native parity не са доказани. Не е извършен импорт във
WFC или смяна на активния модел. Не са създадени контейнери, не са променяни
оригиналните checkout-и/контейнери/данни, 5190 или 5191. Няма push/PR/merge.
Нужните доказателства и сравнителният модел се пазят; отказаните за почистване
директории не са докосвани.
