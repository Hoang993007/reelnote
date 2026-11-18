# Registers the Windows Task Scheduler task "Reelnote": starts the built server when you sign in,
# without a window, and restarts it up to 3 times if it stops. Run from the repo after `pnpm build`:
#   powershell -ExecutionPolicy Bypass -File scripts\install-startup-task.ps1
# If Windows answers "Access is denied", run it once from an elevated PowerShell.
# Remove the task with scripts\uninstall-startup-task.ps1.
param([string]$TaskName = 'Reelnote')
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $repo 'server\dist\start.js'
if (-not (Test-Path -LiteralPath $entry)) { throw "Build first (pnpm build): $entry is missing." }
$node = (Get-Command node -ErrorAction Stop).Source
$envFile = Join-Path $repo '.env'
$user = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute $node -Argument "--env-file-if-exists=$envFile $entry" -WorkingDirectory (Join-Path $repo 'server')
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
# S4U: runs without a window and without storing your password; local files only, which is all Reelnote needs.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "Reelnote server ($repo)" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Task '$TaskName' registered and started. Logs: <REELNOTE_DATA_DIR>\logs"
