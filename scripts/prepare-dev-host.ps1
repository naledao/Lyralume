$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$electronDist = Join-Path $projectRoot 'node_modules\electron\dist'
$sourceExe = Join-Path $electronDist 'electron.exe'
$targetExe = Join-Path $electronDist 'Lyralume.exe'
$iconPath = Join-Path $projectRoot 'assets\branding\lyralume-icon.ico'
$pnpmModules = Join-Path $projectRoot 'node_modules\.pnpm'

foreach ($requiredPath in @($sourceExe, $iconPath, $pnpmModules)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required development host resource was not found: $requiredPath"
  }
}

$resourceEditor = Get-ChildItem -LiteralPath $pnpmModules -Recurse -Filter 'rcedit.exe' -File |
  Where-Object { $_.FullName -match '[\\/]electron-winstaller[\\/]vendor[\\/]rcedit\.exe$' } |
  Select-Object -First 1

if (-not $resourceEditor) {
  throw 'Unable to locate the Windows resource editor installed with electron-builder.'
}

Copy-Item -LiteralPath $sourceExe -Destination $targetExe -Force

& $resourceEditor.FullName $targetExe `
  --set-icon $iconPath `
  --set-version-string ProductName 'Lyralume' `
  --set-version-string FileDescription 'Lyralume local music player' `
  --set-version-string InternalName 'Lyralume' `
  --set-version-string OriginalFilename 'Lyralume.exe'

if ($LASTEXITCODE -ne 0) {
  throw "Unable to apply the Lyralume icon to the development host (exit code $LASTEXITCODE)."
}

Write-Host "Prepared branded Electron development host: $targetExe"
