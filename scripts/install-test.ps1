# Silent install / verify / uninstall cycle for the Local Flow NSIS installer.
# Per-user install (no elevation). Self-cleaning: it uninstalls through the
# app's own registered uninstaller and removes any leftover folder.
# ASCII-only output so Windows PowerShell 5.1 renders it without re-encoding.
param(
  [string]$Installer
)

$ErrorActionPreference = "Stop"
$root = (Get-Location).Path

if (-not $Installer) {
  $candidate = Get-ChildItem -Path (Join-Path $root "dist") -Filter "*Setup*.exe" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $candidate) { throw "No installer found under dist/." }
  $Installer = $candidate.FullName
}
if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }
Write-Host "INSTALLER=$Installer"

$uninstallRoot = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
function Get-LocalFlowEntry {
  Get-ChildItem $uninstallRoot -ErrorAction SilentlyContinue | ForEach-Object {
    Get-ItemProperty $_.PSPath
  } | Where-Object { $_.DisplayName -match "^Local Flow" } | Select-Object -First 1
}

function Get-UninstallerPath($entry) {
  $value = $entry.QuietUninstallString
  if (-not $value) { $value = $entry.UninstallString }
  if ($value -match '^"([^"]+)"') { return $matches[1] }
  return ($value -split ' ')[0]
}

if (Get-LocalFlowEntry) {
  throw "Local Flow is already installed for this user. Uninstall before testing."
}

# 1. Silent install
Start-Process -FilePath $Installer -ArgumentList "/S" -Wait
Start-Sleep -Milliseconds 1200
$entry = Get-LocalFlowEntry
if (-not $entry) { throw "Uninstall registry entry was not created." }
$uninstallerExe = Get-UninstallerPath $entry
$installLoc = Split-Path $uninstallerExe -Parent
$exe = Join-Path $installLoc "Local Flow.exe"
if (-not (Test-Path $exe)) { throw "Executable not found at $installLoc." }
Write-Host "INSTALL_OK=$installLoc"

# 2. Headless verification of the installed build
$modelsDir = Join-Path $env:TEMP ("lf-models-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
$userDir = Join-Path $env:TEMP ("lf-user-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
$env:LOCAL_FLOW_SETUP_TEST = "1"
$env:LOCAL_FLOW_MODELS_DIR = $modelsDir
$env:LOCAL_FLOW_USER_DATA = $userDir
# Discard stderr: a packaged Electron app prints a harmless crashpad line there
# on quit, and Windows PowerShell 5.1 would otherwise turn it into a terminating
# error. The setup status we need is on stdout.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
  $output = & $exe 2>$null | Out-String
} finally {
  $ErrorActionPreference = $prevEAP
  Remove-Item Env:LOCAL_FLOW_SETUP_TEST, Env:LOCAL_FLOW_MODELS_DIR, Env:LOCAL_FLOW_USER_DATA -ErrorAction SilentlyContinue
}
$line = ($output -split "`r?`n" | Where-Object { $_ -match "LOCAL_FLOW_SETUP_OK=" } | Select-Object -First 1)
if (-not $line) { throw "Installed app did not respond. Output: $output" }
Write-Host $line.Trim()
$json = ($line -replace ".*LOCAL_FLOW_SETUP_OK=", "").Trim() | ConvertFrom-Json
if (-not $json.packaged) { throw "Installed app is not running in packaged mode." }
if (-not $json.whisperAvailable) { throw "Whisper engine missing from the installed app." }
Write-Host "VERIFY_OK"

# 3. Silent uninstall through the app's own uninstaller (synchronous via _?=)
Start-Process -FilePath $uninstallerExe -ArgumentList "/currentuser", "/S", "_?=$installLoc" -Wait
Start-Sleep -Milliseconds 1200
if (Test-Path $installLoc) {
  Remove-Item $installLoc -Recurse -Force -ErrorAction SilentlyContinue
}
Remove-Item $modelsDir, $userDir -Recurse -Force -ErrorAction SilentlyContinue

if (Get-LocalFlowEntry) { throw "Uninstall registry entry remained." }
if (Test-Path $installLoc) { throw "Install folder was not removed: $installLoc" }
Write-Host "UNINSTALL_OK"
Write-Host "INSTALL_TEST_PASSED"
