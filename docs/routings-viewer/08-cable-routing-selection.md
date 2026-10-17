# Етап 8 — избор на кабел и директно показване на Routing

Левият таб **Cables** в проектния **Routings viewer** е активен за всички потребители с project read access. Той показва пълния кабелен списък и изпълнява избрания оригинален `Cable.routing` през общия Stage7 pipeline. Всички нови съобщения и достъпни имена са на английски.

## Независим източник на кабели

`src/api/routingCables.ts` чете единствено съществуващия пълен `GET /api/projects/:projectId/cables`, без pagination/search/sort параметри и без editing hooks на Cables list. Adapter-ът получава текущия explicit token и AbortSignal, използва no-store, same-origin credentials, redirect error, 10 секунди deadline и максимум16MiB JSON. Deadline ограничава както fetch, така и четенето на body; късен response след отменен caller не се приема.

Приема се единствено HTTP200 application/json с пълния `{cables}` wrapper. Partial/unfinished HTTP отговори, Content-Range, pagination metadata, невалиден UTF8/JSON, чужд projectId, невалидни/повторени UUID и неправилни nullable полета са грешка, а не празен проект. Съобщенията не пренасят произволно server body.

Viewer snapshot е `{id,projectId,tag:string|null,routing:string|null}`. `id` е UUID на конкретния Cable запис. Числовото `Cable.cableId` и tag не са identity. Nullable оригиналният Routing остава непроменен; няма fallback към CableType.routing. From/To, connectedFrom/connectedTo и други колони не се добавят към този интерфейс.

## Lazy списък, търсене и състояния

`useRoutingCables` зарежда списъка при първо активиране на Cables. Началният Manual routing не изпраща cable/catalog/support заявки. Refresh/Retry е явен; focus/reveal обновява само активния Cables режим. Едновременните list reads се обединяват; няма polling или HTTP при писане в търсачката.

`routingCableList.ts` изчислява search keys чрез NFKC → trim → uppercase и case-insensitive substring. Не използва route parser. Показва се оригиналният tag с неговите символи и whitespace. Null/empty/whitespace-only тагове се пропускат с точен общ omitted count преди филтриране. Duplicate tags остават отделни редове с `key=Cable.id` и собствен Routing.

Loading, failed initial load с Retry, празен проект, всички кабели без tag, празен search result и failed refresh със stale snapshot са отделни състояния. Failed refresh не доказва изтриване: запазва кеширания избор и данни, показва предупреждение и изисква успешно обновяване преди cable activation/Retry. Докато list refresh е pending, активацията също е временно изключена. Search остава локален.

## Общ маршрут и отделни UI състояния

Manual draft, активен ляв таб, search, selectedCableId, потвърден cable snapshot и текущ route attempt/result са отделни. Смяната на левия таб не пресъздава iframe, не копира Routing в Manual, не избира първи ред и не стартира запомнен маршрут.

Редовете са native buttons в ограничен вертикално скролируем списък и съдържат само tag. Enter/Space активира конкретния ред. Click избира UUID и веднага подава snapshot към `showCable`; няма втори Show бутон. Преди MODEL_LOADED редовете не могат да стартират маршрут и няма скрито последващо изпълнение. При pending route нов избор остава разрешен.

`useRoutingsViewer` пази immutable `{rawRouting,source:'manual'|'cable',cableId:UUID|null}` за всеки опит и fresh operation UUID. `show(raw)` остава manual wrapper; `showCable({id,projectId,routing})` използва null→празен parser input само за този опит. Nullable оригиналът се пази отделно за сравнение при refresh. `currentRoute` обозначава текущия source/UUID/raw/operation за pending и settled резултат.

Двете source разновидности минават през същите canonical parser, свеж пълен tray GET и pure договорD aggregate. Source/cableId се пренасят и през local empty/invalid резултатите. ViewerController остава единственият собственик на iframe, model/resource sessions и selection/revision fences; не са добавяни друг controller, cable engine или нов protocol/runtime механизъм.

Empty/null/separator-only/SECONDARY-only кабел изчиства предишния overlay/bounds, пази selected UUID и показва **This cable has no drawable routing.** Invalid/no-model-match също не оставят чужд успешен маршрут. Clear/Show entire model премахват текущия опит и display claim; Manual draft и запомненият кабелен избор могат да останат. Общият source label различава текущ Manual маршрут от конкретния кабел, включително когато search скрива избрания ред.

## Retry, refresh и конкурентни отговори

`retryRoute` използва текущия attempt source. Manual retry повтаря rawRouting на текущия опит, независимо от редактиран draft. Cable retry изисква свеж потвърден snapshot на същия избран UUID; не използва запазен стар Routing или Manual текста. Stale/in-flight list snapshot не разрешава cable Retry.

Успешен refresh сравнява точния selected UUID:

- Изчезнал запис или празен tag премахва избора и само съответния текущ cable route.
- Променен оригинален Routing обезсилва съответния overlay/опит, пази UUID и изисква нов explicit click.
- Променен непразен tag обновява label без промяна на UUID или geometry.
- Друг ред/филтър не променя избора.

`invalidateCableRoute(id,expectedOriginalRouting)` проверява атомарно действителния current attempt source/UUID/original Routing. Късен отговор за запомнен кабел не изчиства по-нов Manual маршрут, различен кабел или по-нов snapshot. Abort е оптимизация; scope/run/read/operation/load/request огражденията са задължителни.

Публичните hook callbacks са обвързани с captured scope, така че стар callback не може да прочете новия runRef и да прекрати/изчисти друг проект или вход. Early model replies се пазят в ограничена карта до8 request IDs и се приемат само за точния requestId, върнат от showRoute. Стар отговор за еднакъв Routing/UUID не се смесва с новия опит; действително несъответстващ текущ отговор е ROUTE_RESULT_MISMATCH.

## Права, оформление и запазване

Project/token/logout/loaded-project mismatch обезсилват видимите scoped данни веднага, преди passive effect cleanup. Независим terminal Viewer access/login failure също скрива cable snapshot и деактивира list reads. List401/403/project404 прекратява Viewer; network/timeout/5xx остава unavailable/stale. Няма нов backend endpoint/schema или canEdit ограничение за read функционалността.

Съществуващите320/280/stacked grid и измерена височина са запазени. Новият cable panel не се свива до нулева височина при кратък viewport; списъкът има максимум20rem и собствен scroll, дългите tag-ове се пренасят, а целият sidebar остава достъпен с неговия scroll. Светлият Viewer и WFC темата се запазват.

Няма cable/tray/project/model-selection business writes от интерфейса. Разрешените Viewer session POST/DELETE са read lifecycle. Geometry/renderer/SDK/fixtures, importer, PathFinder, Model Preparer, Cable.routing/SECONDARY и инженерните изчисления са непроменени. Geometry SHA е `4d10d66dca31f10b82926693a0e7438e68f448047f3f991baabb82f6ed2573fa`.

Текущите проверки, ревизия, Docker/development реални browser доказателства, localhost update и cleanup са в [08-stage-report.md](08-stage-report.md) и S8 редовете на [00-validation-matrix.md](00-validation-matrix.md). Историческите Stage7 FAIL/NOT_PROVEN/native125 и blocked cleanup ограничения се запазват. Native125 не се представя като ново Stage8 изпълнение. Информационният panel/tooltip с From/To/Routing, delay, pin и copy остава за етап9; не е реализиран.
