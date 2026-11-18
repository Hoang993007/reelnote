# Stops and removes the "Reelnote" Task Scheduler task. Data is not touched.
param([string]$TaskName = 'Reelnote')
$ErrorActionPreference = 'Stop'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Task '$TaskName' removed."
} else {
  Write-Host "No task named '$TaskName'."
}
