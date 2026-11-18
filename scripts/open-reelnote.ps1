# Opens Reelnote in the browser. When nothing answers on the port, it first starts the server in a
# minimized "Reelnote" window (scripts\start-reelnote.cmd); closing that window stops the server.
# The desktop shortcut made by scripts\install-desktop-shortcut.ps1 runs this file.
param([int]$Port = 3900)
$ErrorActionPreference = 'Stop'

function Test-Listening {
  $client = [System.Net.Sockets.TcpClient]::new()
  try { return $client.ConnectAsync('127.0.0.1', $Port).Wait(500) -and $client.Connected }
  catch { return $false }
  finally { $client.Dispose() }
}

if (-not (Test-Listening)) {
  Start-Process -FilePath (Join-Path $PSScriptRoot 'start-reelnote.cmd') -WindowStyle Minimized
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-Listening) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
}
Start-Process "http://localhost:$Port"
