#Requires -Version 7.2
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigPath, [ValidateRange(5,60)][int]$IntervalMinutes = 5)
$ErrorActionPreference = 'Stop'
$taskConfig = (Resolve-Path -LiteralPath $ConfigPath).ProviderPath
$taskUpdater = Join-Path $PSScriptRoot 'Update-Deployment.ps1'
if ($taskConfig.Contains('"') -or $taskUpdater.Contains('"')) { throw 'Unsupported quoted path.' }
$taskExecutable = (Get-Process -Id $PID).Path
# Run in the same interactive user session as Docker Desktop, never SYSTEM.
$taskAction = New-ScheduledTaskAction -Execute $taskExecutable -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$taskUpdater`" -ConfigPath `"$taskConfig`" -Apply"
$taskTriggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes))
)
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskPrincipal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'WFC - Deploy tested main' -Action $taskAction -Trigger $taskTriggers -Settings $taskSettings -Principal $taskPrincipal -Description 'Pull complete tested deployment releases; preserve Docker volumes; verify readiness and roll back images on failure.' -Force | Out-Null
Write-Output 'Deployment task registered for the current Docker Desktop user. It runs while that user is signed in.'
