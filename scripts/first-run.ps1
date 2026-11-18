# One-time setup of Reelnote on this PC, in one go:
#   install and build, create the owner account (you type the password, hidden),
#   listen on the home network, start Reelnote in its own window (scripts\start-reelnote.cmd) and open it.
# Run from the repo:  powershell -ExecutionPolicy Bypass -File scripts\first-run.ps1
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo

if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
pnpm install
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
pnpm build
if ($LASTEXITCODE -ne 0) { throw 'pnpm build failed' }

$email = Read-Host 'Owner email (you sign in with it)'
$name = Read-Host 'Your name'
pnpm user create --email $email --name $name --role owner
if ($LASTEXITCODE -ne 0) { throw 'Creating the owner account failed' }

function Set-EnvLine([string]$name, [string]$value) {
  $lines = @(Get-Content -LiteralPath '.env' | Where-Object { $_ -notmatch "^$name=" })
  Set-Content -LiteralPath '.env' -Value ($lines + "$name=$value")
}

# The owner exists now, so listening beyond this PC is safe: everyone has to sign in.
Set-EnvLine 'REELNOTE_HOST' '0.0.0.0'

# This PC's Tailscale address (only read here; Tailscale Serve is set up outside this repo). It is
# shown in a friend's sign-in hand-off, and writes from it are accepted even if the proxy does not pass
# the browser's scheme on.
$tailscale = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
if (Test-Path -LiteralPath $tailscale) {
  try {
    $dnsName = ((& $tailscale status --json | Out-String | ConvertFrom-Json).Self.DNSName).TrimEnd('.')
    if ($dnsName) {
      Set-EnvLine 'REELNOTE_TAILSCALE_URL' "https://$dnsName"
      Set-EnvLine 'REELNOTE_ALLOWED_ORIGINS' "https://$dnsName"
    }
  } catch { Write-Host 'Tailscale is not signed in; skipping its address.' }
}

Start-Process -FilePath (Join-Path $PSScriptRoot 'start-reelnote.cmd') -WindowStyle Minimized
Start-Sleep -Seconds 3
Start-Process 'http://localhost:3900'
Write-Host 'Reelnote is running in the minimized "Reelnote" window; closing that window stops it.'
Write-Host 'Next time start it with scripts\start-reelnote.cmd. Sign in, then add friends on People and access.'
