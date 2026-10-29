# PF-0 — synthetic golden fixtures и граници на доказателствата

Този документ фиксира съвместимостта на текущия PathFinder core. Не въвежда PathFinder engine, API или UI в WFC. Референцията е чистият checkout `work/review-pathfinder`, commit `45c24bf5f433f13e102600b36f20327c77961d0a`. Точните локални пътища, SHA-256 и byte sizes са в [source inventory](evidence/pf-core-source-inventory.json) и [golden manifest](fixtures/pf-core-v1.manifest.json).

## Изпълнени проверки

| Проверка | Състояние и обхват |
| --- | --- |
| Съществуващият detached Release harness | **PASS, 105/105**, .NET SDK 9.0.319; непроменен production core и непроменени тестове, изпълнени единствено в собствено временно копие. |
| Golden extraction | **PASS, 43 synthetic cases** от действителния core; второто изпълнение връща byte-identical expected JSON. Това е reference extraction, а не доказателство за нов engine. |
| Corpus schema | **PASS**, JSON Schema draft-07, съществуващ Ajv 6.15.0; inputs/expected, еднакви уникални IDs/kinds и 6 negative schema controls. |
| Private Excel fixture с 327 имена | **NOT_RUN**; не е предоставян на текущия прогон. Историческите 106 проверки включват тази допълнителна група. |
| Navisworks/native smoke | **NOT_RUN** сега; историческите 70 native групи не се пренасят като нов PASS. |
| Native ↔ converted model parity | **NOT_RUN**; липсва paired dataset с пълноточни входове и изходи. |
| WFC integration, admin права, endpoint registry, Review/Apply | **NOT_RUN**; това са договори за следващи етапи. |

Наличните логове са [Release](evidence/pf-core-release.log), [extraction](evidence/pf-core-golden-extraction.log), [repeat](evidence/pf-core-golden-repeat.log), [schema](evidence/pf-core-schema-validation.log) и [summary](evidence/pf-core-summary.json). Geometry capture приключи с exit 0 и не печата stdout; празният [capture log](evidence/pf-core-geometry-capture.log) сам по себе си не е доказателство. Доказателството са сериализираните mesh inputs, source pins и двата measured geometry outputs.

## Активен core и native граница

Активният `AddinRibbon/AddinRibbon.csproj:22` включва `Routing/*.cs`; следващите **11 файла** са пълният активен pure core. Таблицата сочи файлове в pinned PathFinder checkout, а не нови WFC production файлове. Пълните SHA-256 за всеки файл са в source inventory; всяко копие за изпълнение е сравнено byte-for-byte чрез SHA-256.

| Файл в AddinRibbon/Routing | Изчисление/договор и точен anchor |
| --- | --- |
| RoutingModels.cs | `RoutePoint:19`, `TraySegment:73`, `RoutingOptions:124`, `RouteResult:150`, `Reverse:201`: detached metres, категории, immutable входове/резултат. |
| RouteCalculator.cs | `Calculate:27`; SECONDARY и физическа дължина `:140`; gap constants `:21`; lexicographic `PathCost:864`. |
| RouteLookupCalculator.cs | `Parse:18`, `Calculate:38`, ordered graph `:47`: marker filtering, задължителен ред, branch/main-span/loop избор. |
| RouteCodeParser.cs | `Parse:23`, `TryParseNamedCode:33`: route labels и suffixes, без втори web parser. |
| RouteNameResolver.cs | `Resolve:14`, `OwnerIndex:33`: logical owner от leaf-to-root hierarchy. |
| TrayGeometryBuilder.cs | `Build:103`, shape classification `:100`: measured straight/bend reconstruction или отчетен fallback. |
| TrayMeshData.cs | `TrayMeshFragment:15`, `TrayMeshData:39`: world-space indexed triangles и запазени fragment boundaries. |
| TrayMeshGeometry.cs | `StraightCandidates:27`, `ResolveStraights:149`: cap sections, extrusion axis и съседни ports. |
| TrayBendMeshGeometry.cs | `TryFit:26`, arc sampling `:351`: measured circular bend + tangent stubs, polyline chord approximation. |
| TrayMeshClearance.cs | `TryCreate:104`, `TryDistanceTo:159`, `TryDistanceAtSections:270`: действителни triangle surfaces/BVH, не solid containment. |
| CableDesignLength.cs | `Calculate:12`: decimal SECONDARY replacement, spare, increase и окончателен Ceiling. |

Native boundary е в `AddinRibbon/Services/RoutingSession.cs`, `RoutingSession.Lookup.cs`, `TrayMeshReader.cs`; UI е `AddinRibbon/Ctr/PathFinderControl.cs`. Capture използва видими native leaves, world transforms и native unit conversion в metres. Отделни meshes се четат през COM primitives. Native category assignments и временните capture IDs не са готов persistent web identity contract.

Старият checkout `C:/Users/todor.chankov/source/repos/MrToKa/PathFinder` е master `35f4fb46f7762503576bdacd9668f34a1be2b0ed`, 24 commits преди референцията според локалната review история. Неговите два dirty tracked файла са host/build промени: 2023→2027 paths и включване на legacy Algo tab. Той е съхранен непроменен; този прогон не доказва еквивалентност на стария host с новия core.

## Формат на corpus

- [inputs](fixtures/pf-core-v1.inputs.json): `schemaVersion:1`, `provenance:synthetic-core-extraction`, pinned core commit, `units:m`, case IDs, source anchors и constructor inputs.
- [expected](fixtures/pf-core-v1.expected.json): действителни outputs от същите IDs/kinds. Включва success/failure/exception, пълните PathPoints, RouteText/codes/segment IDs, actual approaches, SECONDARY flags и gap metrics.
- [schema](fixtures/pf-core-v1.schema.json): затворени object shapes за fixture transport. Това **не е production request schema**; deliberate invalid core inputs са валидни test records.
- [manifest](fixtures/pf-core-v1.manifest.json): SHA-256/bytes на corpus и generator, source pins, coverage и доказателствени ограничения.
- [generator](fixtures/generator/Program.cs): тънко десериализиране → production constructors/API → сериализиране. Не съдържа дублирана формула, graph solver или geometry fitter.
- [mesh capture](fixtures/generator/CaptureGeometry.cs): извиква с reflection съществуващата непроменена `GeometryTests.CircularMeshFixture:316`, за да запази неговите synthetic meshes като JSON. Няма нов mesh алгоритъм.

43-те случая са: 17 Calculate, 5 ordered lookup, 5 lookup Parse, 10 design length, 2 hierarchy/name, 2 geometry fallback и 2 measured geometry+route. Последните два действително дават 1 validated bend и 2 validated straights всеки. Затвореният box mesh е **fallback** в текущия core и не се представя като validated geometry.

Direct Calculate cases покриват interior projections, триизмерна дължина, threshold equality/beyond, category bridge, physical gap equality/overflow, micrometre gap classification, end-only contact, vertical preference/band и node limit. Lookup запазва реда, игнорира SECONDARY и не използва unlisted shortcut; има missing-label, branch и closed-loop случаи. Full105 harness отделно покрива cancellation, graph/candidate limits, repeated requests, surface/verified-port checks, rotated/ambiguous mesh и dense geometry.

## Числова съвместимост

Geometric values се запазват като JSON binary64 numbers без F3 закръгляване; `lengthRoundTrip` допълнително пази .NET `double.ToString("R", InvariantCulture)`. Decimal settings и design outputs са invariant decimal strings, за да не преминават незабелязано през JavaScript binary64.

За future replay със същия core и входове очакването е byte-identical JSON. За независим engine се сравняват success/status/IDs/order/flags и integer gap counts точно, координати/геометрични дължини с absolute tolerance **1e-9 m** за този synthetic corpus и decimal strings по точна decimal стойност. Това е comparison tolerance, а не промяна на engine thresholds и не обещание за точността на конвертиран модел. Real native↔converted tolerance остава отделен неподписан gate; не се увеличава, за да скрие различен route choice.

Current core gap contact epsilon и gap-rank resolution са 1e-6 m; verified opposing ports могат да използват 0.0005 m residual rule. Те не трябва да се заменят с corpus comparison tolerance. Bend arcs са измерени и дискретизирани чрез максимум 5-degree стъпки; length е сумата на реално върнатите polyline chords, не аналитична CAD arc length.

Design формулата е:

```text
T = max(0, geometricLength − actualApproachesMarkedSecondary)
    + secondaryEndCount × secondaryLength + connectionSpare
designLength = Ceiling(T × (1 + increasePercent / 100))
```

Spare се добавя веднъж преди процента; SECONDARY замества actual approach само при строго `distance > threshold`. Lookup няма equipment approaches и не получава автоматично design allowance. Current UI defaults `5m replacement / 6m spare / 5%` са референтни исторически defaults. В новата функционалност **и трите стойности идват от Project > Details revision**, без независим tab default/fallback. Golden settings са изрично synthetic inputs към същата формула. Instrumentation използва **Control** rules по решението на потребителя; няма отделна Instrumentation категория в текущия core.

## Възпроизвеждане без промяна на PathFinder checkout

Нужен е инсталиран .NET 9 SDK. Native DLL, Navisworks, Docker и нови packages не са нужни. В собствена временна директория се копират byte-for-byte:

```text
AddinRibbon/Routing/*.cs                         (11 production files)
tests/PathFinder.Routing.Tests/*.cs              (8 unchanged test files)
tests/PathFinder.Routing.Tests/*.csproj          (1 unchanged project)
tools/GoldenExtractor/Program.cs                (retained generator)
tools/GoldenExtractor/GoldenExtractor.csproj     (retained project)
```

Изпълнение от собственото временно копие:

```powershell
dotnet run --configuration Release --project tests/PathFinder.Routing.Tests/PathFinder.Routing.Tests.csproj
dotnet run --configuration Release --project tools/GoldenExtractor/GoldenExtractor.csproj -- <absolute-inputs-json> <absolute-new-expected-json>
dotnet run --no-build --configuration Release --project tools/GoldenExtractor/GoldenExtractor.csproj -- <absolute-inputs-json> <absolute-second-output-json>
```

Сравняват се SHA-256 на двата output файла и с pinned expected. Не се генерира output върху original PathFinder checkout. Optional private Excel fixture може да бъде подаден на първата команда след `-- <absolute-fixture-json>`, само ако е наличен и разрешен; не участва в текущите 105 проверки. Historical raw logs са били посочени в `docs/Validation.md:16–18`, но липсват и в двата намерени checkout-а.

## Реални случаи и оставащи gates

`docs/Validation.md:7–18` исторически съобщава Aalborg ordered lookup с gap1.00m: route1 **100.972m**, route2 **35.299m**, без From/To/design allowances. Това са approximate display values, а не пълноточни golden outputs. Посочените real input/result JSON и native smoke folders не са налични тук; не са възстановявани или измисляни.

За приемане на бъдещ model adapter са нужни отделни разрешени paired captures: еднакъв model revision, units/transforms/hierarchy/visibility/rules/anchors, full-precision detached native inputs и outputs, съответните converted inputs, expected fallback diagnostics и ограничен numeric comparison. Native category overlap/last-assignment precedence, persistent component identity, shared From/To manual mappings и explicit Review/Apply revision fences остават договори за следващите етапи, а не текущ web PASS.

Проверени са само чистият reference core, fixture extraction и transport schema. Не са стартирани Navisworks, cloud/APS, production services или WFC integration. Почистването на собственото временно execution копие е **BLOCKED**: automatic approval review отхвърли изтриването с причина „blocked by policy“. Командата не е изпълнена, няма повторен опит; запазени са 162 файла, 51 директории и 3 586 733 bytes под точния own-temp път в [summary](evidence/pf-core-summary.json). Този folder не е deliverable и не се представя като почистен.

