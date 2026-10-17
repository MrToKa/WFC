# Етап 5 — защитен офлайн runtime

Приетата последователност остава 0–11. Този етап предоставя ресурсни сесии, локален SDK, iframe протокол и reusable родителски контролер. Details selector, окончателният Routings viewer, проектната DB проверка на маршрут, кабелният списък и информационният панел остават за етапи 6–9. PathFinder и инженерните изчисления не участват.

## Доставка и граница на доверие

Фиксираният вход е `/viewer-runtime/7.130.0/index.html`. Bootstrap query съдържа единствено canonical UUID `instanceId` и `projectId`. Пакетът на модела не доставя изпълним код. Източниците са под `viewer-runtime/`; SDK 7.130.0 е отделно фиксиран под `viewer-runtime/sdk/7.130.0/`.

`npm run viewer:prepare` проверява целия SDK спрямо pinned vendor manifest SHA `747540a153fb18809c428d8ed177aa8a296cff1b5175ab85445e0a2ebdb36d75`, 206 оригинални assets / 82552768 bytes. Генерира `public/viewer-runtime/7.130.0/` и inventory с SHA/размер на доставените файлове. `npm run dev` и `npm run build` изпълняват тази проверка. Runtime няма download или CDN fallback и не използва абсолютни host paths. Генерираното public копие не е втори Git източник и не влиза в Docker build context; build го възпроизвежда от фиксираните източници.

Оригиналните Viewer/SDK файлове извън WFC са read-only. `route-geometry.mjs` е запазен byte-for-byte, SHA `4d10d66dca31f10b82926693a0e7438e68f448047f3f991baabb82f6ed2573fa`. Контролерът на маршрутите има тесни cancellation/index/lifecycle адаптации; геометричният алгоритъм не е заменен. Runtime запазва preset 7, quality(false,true), tonemap 1/exposure 1.0, ghost opacity 0.025 и жълто 0xffe600.

Same-origin iframe разделя CSS и lifecycle. `allow-scripts allow-same-origin` не е граница срещу злонамерен same-origin script. Доверяваме се на доставения runtime; моделните пакети остават данни, проверени чрез публичния verifier от етап 4.

## Сесии и login binding

Новите WFC access tokens имат независим UUID `jti` за всяко влизане. JWT не се съхранява в session DB. Старите tokens продължават да обслужват съществуващите WFC операции, но Viewer lifecycle връща `LOGIN_REFRESH_REQUIRED`: необходимо е ново влизане. Един user ID не се използва като login identity.

PostgreSQL `viewer_login_bindings` съхранява login binding и durable logout tombstone. `viewer_resource_sessions` обвързва user/login/project/version/load с revision на избора. Credential е 256-bit random secret; DB пази само SHA-256. Session UUID сам по себе си не дава достъп. Срокът е 5 минути, parent подновява през 3 минути, максимум 30 минути absolute lifetime; преди достигането му parent създава нов iframe/load/session. Iframe не подновява сесии.

Create/renew използват Bearer, актуални проектни права и exact same-origin правила. Create приема само `{loadId}` и връща само `{sessionId,projectId,modelVersionId,loadId,expiresAt,absoluteExpiresAt}`. Renew приема празен JSON object и връща същата identity с обновен expiry. Изборът трябва да е ready/healthy и да съвпада с активния модел. PostgreSQL locking и selection/health triggers ограждат конкурентните промени; връщане към стар модел не съживява старите сесии.

Cookie `wfc_viewer_session` е HttpOnly, SameSite=Strict, с Path точно `/api/projects/<project>/model-versions/<version>/viewer-sessions/<session>/`. Secure е задължително при HTTPS. HTTP работи само при изрично `WFC_VIEWER_ALLOW_HTTP_LOOPBACK=true` и loopback origin в `WFC_VIEWER_ALLOWED_ORIGINS`. `WFC_VIEWER_TRUST_PROXY=true` е само за API зад доверен, непубликуван reverse proxy, който презаписва forwarded protocol; Express global trust proxy не е включен. Host, port, Origin и Fetch Metadata се проверяват; permissive CORS не се прилага към частните пътища.

Cookie-only descriptor/resource router се изпълнява преди общите CORS/body/Bearer middleware. Това не отслабва project/import/selection authorization. Read lifecycle изключенията са точни; import и active selection остават edit-only, неизвестните mutations не получават ново право.

SDK 7.130.0 добавя `domain=<location.origin>` към resource GET/HEAD при `useCredentials:true`, включително в worker. Този наблюдаван SDK metadata параметър е разрешен само като точно една `domain` стойност, равна на вече проверения request origin. Той не определя ресурс, storage key или право. Други/дублирани параметри, чужд origin и query върху descriptor/create/renew/revoke остават отказани. JWT/secret/auth/acmsession параметри не се приемат. `useCredentials:true` и `useCookie:true` са изрично зададени; env Local приключва SDK Initializer преди вътрешното setUseCookie, затова реалното credential поведение се доказва с actual geometry/property worker requests.

Всеки descriptor/resource request проверява актуален user/project/role/grant, login/session expiry/revocation, health и selection revision. Logout revoke обхваща само съответния login, включително create, конкуриращ се с logout. DELETE на отделна сесия е ownership-based и остава възможен след загуба на read право.

## Ресурси и integrity

Descriptor е точно `{projectId,modelVersionId,loadId,contentFingerprint,supportProfile,format,sdkVersion,entrypoint,resourceCount,totalBytes}`. Entrypoint `resources/output/0/0.svf` се resolve-ва спрямо session base с краен `/`. Handler получава `output/0/0.svf` и търси `resources/output/0/0.svf` в сървърния verified manifest. Няма клиентски storage key, public URL или presigned URL.

GET и HEAD поддържат full 200 и един byte Range 206, включително open/suffix. Невалиден/multiple/unsatisfiable Range е 416 с Content-Range; непознат/опасен path е 404; неподдържан method е 405. Всички отговори, включително грешките, са private/no-store и nosniff. Няма 304 shortcut, Content-Encoding върху raw gzip, shared model cache или SPA fallback.

За всеки обслужен GET/HEAD/Range се чете целият raw MinIO object, проверяват се действителният размер и SHA-256 и се записва в private temporary spool. Отговорът чете от същия pinned file handle след успешната проверка. Size/ETag/partial Range не се представят като SHA доказателство. След storage I/O отново се проверява DB authorization, преди да се изпратят успешни headers. Linux unlink-on-open освобождава bytes и при process crash; нормалното затваряне премахва собствения temporary directory. Лимитите са 16 едновременни ресурса / 8 GiB reserved spool bytes на API process; претоварване дава 503. Това не е глобална disk quota.

Липсващ/скъсен/удължен/повреден ресурс маркира версията unavailable и прекратява сесиите. Временен storage outage отказва заявката без измислено доказателство за повреда. Отменени/error streams се прекъсват, без успешен fallback. Избраната версия никога не се заменя автоматично с друга.

## Reusable parent API и bridge

`src/viewer/ViewerController.ts` експортира `ViewerController({container,projectId,token,onEvent})`. След `RUNTIME_READY` caller извиква `load(activeModelVersionId)`. Методи: `showRoute(rawRouting,source,cableId)`, `clear(reason)`, `zoom()`, `cancel(requestId)`, `dispose(reason)`. Caller трябва да обработва ERROR и да предлага явен bounded retry чрез нов mount; няма безкрайно автоматично reopen.

Контролерът притежава iframe, request registry, expiry/selection timers и network cancellation. Следващо load освобождава стария iframe веднага, създава нов instance и чака нов handshake. Old results не променят текущия изглед. Logout инвалидира локалните операции преди authenticated revoke; старата credential се capture-ва само в parent за тази заявка, след което login state се изчиства. `viewerLogoutStatus` различава pending/acknowledged/failed; network failure не се представя като server revoke и неподновените сесии изтичат до 5 минути. Storage events освобождават същия login в друг таб; logout от стар таб не изтрива по-нов независим token.

`viewer-runtime/protocol.mjs` и `protocol.d.mts` са общият strict договор C: exact envelope/payload fields, UUID identities, 64 KiB UTF-8 limit, exact origin/source/targetOrigin, request correlation и replay/stale guards. Няма credentials, arbitrary URLs, проектни cable/tray arrays или DB твърдения в bridge. `ROUTE_RESULT` съдържа само моделната половина на D. Parent сравнява raw/source/cable identity с конкретната команда.

Runtime изпраща MODEL_LOADED едва след реалното зареждане и изграждане на целия name index. Empty/invalid/no drawable опит чисти стария overlay; SECONDARY остава ignored marker. Cancel/dispose не позволяват късни SDK callbacks да възстановят модела/маршрута. ResizeObserver обслужва resize и hide/reveal. Parent изчаква DISPOSED максимум 2 секунди и след това премахва iframe.

## Hosting и контролиран harness

nginx обслужва trusted runtime като static files с no SPA fallback, frame-ancestors self/XFO SAMEORIGIN и собствена CSP. Self-only scripts/connect, local SDK/fonts/extensions и worker self/blob са отделени от WFC shell. `unsafe-eval` не е разрешено; действителната съвместимост се доказва отделно в браузър. Dev използва `/api` same-origin proxy с `WFC_API_PROXY_TARGET`, запазен Host/port; API client default е текущият origin. Различни frontend/API ports не се третират като same-origin.

Harness е само при explicit build flag `VITE_VIEWER_HARNESS=true`, default false: `/projects/<projectId>/viewer-harness`, зад истинския WFC login/project access. Той зарежда само сървърния активен модел и дава диагностични load/show/clear/zoom/dispose контроли; не импортва/избира модел и не добавя UI от етапи 6–9. Test fixtures включват flag; локалната работна инсталация може да го включи изрично за наблюдение.

## Локално обновяване и проверки

След приключилия backup потребителят изрично разреши обновяване на съществуващите WFC контейнери. Това последващо указание заменя забраната за deployment в първоначалния handoff. `docker-compose.app.yml` възстановява definition за съществуващия `wfc-app` проект и услуги `backend`/`frontend`; `scripts/update-local-app.ps1` ползва текущите credentials в process environment без запис в `.env` или evidence. PostgreSQL/MinIO/Viewer/Preparer услуги и старите им volumes се запазват. Приложението остава на http://127.0.0.1:5180/.

Fault/API/browser проверките използват изолирани labeled fixtures под `scripts/viewer-sessions/`, отделни DB/MinIO volumes и loopback портове. Реалният Stage3 ZIP се SHA-проверява, импортва през Stage4 API и избира изрично. Браузърният тест използва fresh context, page+worker observations и whole-browser forward proxy, който отказва всички други origins; това е отделно от историческите Stage3 наблюдения. Конкретните изпълнения и ограничения са в `05-stage-report.md`. Непроверени HTTPS/LAN/друг браузър/втори физически компютър не получават PASS.
