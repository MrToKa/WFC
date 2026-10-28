Independent lookup scope controls use a ProjectReference to PathFinder.Model and
its pinned Core. They cover the C# parser, qualified/component owner discovery,
nested logical wrappers, branch ambiguity, filtering of unrequested logical
leaves, exact identities/mesh references, immutable cache scope, cancellation,
resource limits and strict separation from planning snapshots.

Build this project with `dotnet build -c Release --artifacts-path <owned-scratch>`;
run the emitted `PathFinder.LookupScope.Tests.dll` with one absolute owned scratch
directory argument. No database, Docker service, original checkout or native
license is used. These are synthetic contract controls; they establish no native
visibility, engineering acceptance or native-converted parity.

Resolver semantics come from pinned `RoutingSession.Lookup.cs` at
45c24bf5f433f13e102600b36f20327c77961d0a, using unchanged Core
RouteNameResolver.OwnerIndex/Resolve, RouteCodeParser and RouteLookupCalculator.
