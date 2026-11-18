# Puts a "Reelnote" shortcut on the desktop. Clicking it runs scripts\open-reelnote.ps1: it starts the
# server if it is not running, then opens http://localhost:3900. Build first (pnpm build).
#   powershell -ExecutionPolicy Bypass -File scripts\install-desktop-shortcut.ps1
# The icon is made from web\static\icon-512.png into %LOCALAPPDATA%\Reelnote\reelnote.ico.
param([string]$Name = 'Reelnote')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repo = Split-Path -Parent $PSScriptRoot
$iconDir = Join-Path $env:LOCALAPPDATA 'Reelnote'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
$ico = Join-Path $iconDir 'reelnote.ico'

# A .ico holding one 256x256 PNG image (supported by Windows Vista and later).
$source = [System.Drawing.Image]::FromFile((Join-Path $repo 'web\static\icon-512.png'))
$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.DrawImage($source, 0, 0, 256, 256)
$png = [System.IO.MemoryStream]::new()
$bitmap.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose(); $source.Dispose()

$out = [System.IO.BinaryWriter]::new([System.IO.File]::Create($ico))
$out.Write([uint16]0); $out.Write([uint16]1); $out.Write([uint16]1)    # header: reserved, type icon, 1 image
$out.Write([byte]0); $out.Write([byte]0); $out.Write([byte]0); $out.Write([byte]0)  # 256x256, no palette
$out.Write([uint16]1); $out.Write([uint16]32)                          # planes, bits per pixel
$out.Write([uint32]$png.Length); $out.Write([uint32]22)                # image size, offset
$out.Write($png.ToArray())
$out.Dispose(); $png.Dispose()

$link = Join-Path ([Environment]::GetFolderPath('Desktop')) "$Name.lnk"
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
$shortcut.TargetPath = (Get-Command powershell.exe).Source
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'open-reelnote.ps1')`""
$shortcut.WorkingDirectory = $repo
$shortcut.IconLocation = "$ico,0"
$shortcut.Description = 'Start Reelnote and open it in the browser'
$shortcut.Save()
Write-Host "Shortcut: $link"
