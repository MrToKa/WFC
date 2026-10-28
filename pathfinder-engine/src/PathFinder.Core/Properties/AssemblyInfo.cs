using System.Runtime.CompilerServices;

// The unchanged native harness and frozen replay inputs exercise internal
// geometry vectors and result constructors. No production adapter is a friend.
[assembly: InternalsVisibleTo("PathFinder.Regression")]
[assembly: InternalsVisibleTo("PathFinder.Parity")]
