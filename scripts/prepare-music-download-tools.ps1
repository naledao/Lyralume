param(
  [switch]$SkipFfmpeg
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

$ytDlpVersion = '2026.07.04'
$ytDlpSha256 = '52FE3C26DCF71FBDC85B528589020BB0B8E383155CFA81B64DD447BBE35E24B8'
$ytDlpLicenseSha256 = '7E12E5DF4BAE12CB21581BA157CED20E1986A0508DD10D0E8A4AB9A4CF94E85C'
$ytDlpThirdPartyLicensesSha256 = 'B085C65586A953CDB4B13C6390D63EC984D66912E4B6A19E66BA3582F2ED104B'
$ytDlpDirectory = Join-Path $projectRoot 'tools\yt-dlp'
$ytDlpPath = Join-Path $ytDlpDirectory 'yt-dlp.exe'

$ffmpegBuild = 'ffmpeg-n8.1.2-29-g703dcc25b9-win64-lgpl-8.1'
$ffmpegArchiveSha256 = 'D4C43716726E4497E49B9FB1778F940C39B24F0B5FC64ADCF3CF1EEA0011F38E'
$ffmpegDirectory = Join-Path $projectRoot 'tools\ffmpeg'
$ffmpegMarker = Join-Path $ffmpegDirectory 'PREPARED_VERSION.txt'

function Get-VerifiedDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$Sha256
  )

  if (Test-Path -LiteralPath $Destination) {
    $existingHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
    if ($existingHash -eq $Sha256) {
      Write-Host "Verified existing file: $Destination"
      return
    }
  }

  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("lyralume-" + [guid]::NewGuid().ToString('N') + '.download')
  try {
    Invoke-WebRequest -Uri $Uri -OutFile $temporary -UseBasicParsing
    $actualHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash
    if ($actualHash -ne $Sha256) {
      throw "SHA-256 mismatch for $Uri. Expected $Sha256, got $actualHash"
    }
    Move-Item -LiteralPath $temporary -Destination $Destination -Force
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

function Remove-VerifiedTempDirectory {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)

  if (-not (Test-Path -LiteralPath $LiteralPath)) { return }
  $resolved = [System.IO.Path]::GetFullPath($LiteralPath)
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $leaf = Split-Path -Leaf $resolved
  if (-not $resolved.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not $leaf.StartsWith('lyralume-ffmpeg-', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected temporary directory: $resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

New-Item -ItemType Directory -Path $ytDlpDirectory -Force | Out-Null
Get-VerifiedDownload `
  -Uri "https://github.com/yt-dlp/yt-dlp/releases/download/$ytDlpVersion/yt-dlp.exe" `
  -Destination $ytDlpPath `
  -Sha256 $ytDlpSha256

Get-VerifiedDownload `
  -Uri "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$ytDlpVersion/LICENSE" `
  -Destination (Join-Path $ytDlpDirectory 'LICENSE.txt') `
  -Sha256 $ytDlpLicenseSha256
Get-VerifiedDownload `
  -Uri "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$ytDlpVersion/THIRD_PARTY_LICENSES.txt" `
  -Destination (Join-Path $ytDlpDirectory 'THIRD_PARTY_LICENSES.txt') `
  -Sha256 $ytDlpThirdPartyLicensesSha256

if (-not $SkipFfmpeg) {
  $ffmpegReady = (Test-Path -LiteralPath (Join-Path $ffmpegDirectory 'ffmpeg.exe')) -and
    (Test-Path -LiteralPath (Join-Path $ffmpegDirectory 'ffprobe.exe')) -and
    (Test-Path -LiteralPath $ffmpegMarker) -and
    ((Get-Content -LiteralPath $ffmpegMarker -Raw).Trim() -eq $ffmpegBuild)

  if (-not $ffmpegReady) {
    $archivePath = Join-Path ([System.IO.Path]::GetTempPath()) ("$ffmpegBuild-" + [guid]::NewGuid().ToString('N') + '.zip')
    $extractPath = Join-Path ([System.IO.Path]::GetTempPath()) ("lyralume-ffmpeg-" + [guid]::NewGuid().ToString('N'))
    try {
      Get-VerifiedDownload `
        -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-20-14-10/$ffmpegBuild.zip" `
        -Destination $archivePath `
        -Sha256 $ffmpegArchiveSha256
      Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
      $ffmpegSource = Get-ChildItem -LiteralPath $extractPath -Recurse -Filter 'ffmpeg.exe' -File | Select-Object -First 1
      $ffprobeSource = Get-ChildItem -LiteralPath $extractPath -Recurse -Filter 'ffprobe.exe' -File | Select-Object -First 1
      if (-not $ffmpegSource -or -not $ffprobeSource) {
        throw 'The verified FFmpeg archive did not contain ffmpeg.exe and ffprobe.exe.'
      }
      New-Item -ItemType Directory -Path $ffmpegDirectory -Force | Out-Null
      Copy-Item -LiteralPath $ffmpegSource.FullName -Destination (Join-Path $ffmpegDirectory 'ffmpeg.exe') -Force
      Copy-Item -LiteralPath $ffprobeSource.FullName -Destination (Join-Path $ffmpegDirectory 'ffprobe.exe') -Force
      Get-ChildItem -LiteralPath $extractPath -Recurse -File |
        Where-Object { $_.Name -match '^(LICENSE|COPYING|README)' } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $ffmpegDirectory $_.Name) -Force }
      Set-Content -LiteralPath $ffmpegMarker -Value $ffmpegBuild -Encoding UTF8
    } finally {
      Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
      Remove-VerifiedTempDirectory -LiteralPath $extractPath
    }
  } else {
    Write-Host "Verified prepared FFmpeg build marker: $ffmpegBuild"
  }
}

Write-Host 'Music download tools are ready.'
