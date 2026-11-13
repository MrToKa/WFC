# Copy outside the repository, implement for this exact installation, and test
# an isolated restore before configuring this hook. Never use a no-op hook.
$ErrorActionPreference = 'Stop'
# Exit 75 to postpone an update when an enforced idle/maintenance period cannot
# be obtained. A one-time idle check alone is subject to an admission race.
# Verify the coherent application backup using its supported operations CLI.
# Arrange maintenance admission fencing with a bounded lifetime, including the
# other application if it can create new work against the one being updated.
throw 'Implement and verify the private maintenance/backup hook for this installation before enabling automatic deployment.'
