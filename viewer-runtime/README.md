# Локален Viewer runtime 7.130.0

Този runtime се отваря само като same-origin iframe от WFC. `protocol.mjs` е общият строг договор за host и iframe; `protocol.d.mts` описва публичните типове. Query string съдържа само UUID `instanceId` и `projectId`. Моделният адрес се получава от защитения descriptor след `LOAD_MODEL`, без JWT, APS идентификатори или избираем SDK URL в протокола.

`node scripts/viewer-runtime/prepare.mjs` проверява каноничния локален SDK и подготвя `/public/viewer-runtime/7.130.0/`. Пътят се определя от местоположението на скрипта. Няма download, npm build зависимост или достъп до оригиналния PoC при нормален build. Еднократното първоначално копиране приема само изричен абсолютен `--source SDK_DIRECTORY` и проверява фиксирания vendor manifest и всеки файл преди употреба.

Всичките 206 оригинални SDK файла (82 552 768 байта) остават непроменени. Отделният `style.local.css` е възпроизводима производна на оригиналния stylesheet: точно 54 URL адреса за външни шрифтове се заменят с наличния локален Arimo WOFF. `runtime-inventory.json` съдържа входния и крайния SHA-256, броя на замените и точните хешове на публикуваните файлове. Script/worker/extension ресурсите използват локалния `sdk/` каталог. HTTP заглавките за CSP и iframe policy се задават от WFC deployment, а не от HTML файл.

`route-geometry.mjs` е неизменено копие на приетия оригинален алгоритъм; подготовката проверява неговия фиксиран SHA-256. `routes.mjs` запазва същото построяване на геометрията, реда на участъците, приблизителните връзки, clipping, ghost opacity и жълтата линия. Адаптациите са изчакване на целия name index, прекъсване/освобождаване и структурирани model-only резултати. Няма project DB проверка на routing.

Готовността изисква заредена геометрия, завършен name index и успешен реален bounded `model.getProperties` callback. `#runtime-evidence` показва безопасни числови показатели и readiness флагове за браузърна проверка; SDK обектите и стойностите на свойствата не се публикуват като globals или protocol payload. Данните се изчистват при освобождаване. Това са наблюдения на runtime, а реалната проверка за външни заявки включва и worker traffic от изолирания браузърен тест.

Проверки: `node --test --test-reporter=tap viewer-runtime/test/*.test.mjs`. Те покриват оригиналните геометрични регресии и строгия протокол, state/lifecycle, прекъсване, identity/origin/source, cookie-only descriptor mapping, bounded errors и реалните SDK callback граници чрез изолиран fake SDK. Реалното зареждане на Aalborg и offline page/worker traffic се доказват отделно в етапния отчет.
