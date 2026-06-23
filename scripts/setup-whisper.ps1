param(
  [ValidateSet("small", "standard", "all")]
  [string]$Profile = "standard"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$NativeDir = Join-Path $Root "native\whisper"
$ModelsDir = Join-Path $Root "models"
$TempDir = Join-Path $Root "work\whisper-setup"
$ReleaseVersion = "v1.9.1"
$ReleaseZip = "whisper-bin-x64.zip"
$ReleaseUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/$ReleaseVersion/$ReleaseZip"

New-Item -ItemType Directory -Force -Path $NativeDir, $ModelsDir, $TempDir | Out-Null

$InstalledCli = Join-Path $NativeDir "whisper-cli.exe"
if (Test-Path $InstalledCli) {
  Write-Host "whisper.cpp já está instalado."
} else {
  $ZipPath = Join-Path $TempDir $ReleaseZip
  Write-Host "Baixando whisper.cpp $ReleaseVersion..."
  Invoke-WebRequest -Uri $ReleaseUrl -OutFile $ZipPath

  $ExtractDir = Join-Path $TempDir "extracted"
  if (Test-Path $ExtractDir) {
    Remove-Item -LiteralPath $ExtractDir -Recurse -Force
  }
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractDir

  $Cli = Get-ChildItem -Path $ExtractDir -Recurse -Filter "whisper-cli.exe" | Select-Object -First 1
  if (-not $Cli) {
    throw "whisper-cli.exe não foi encontrado no pacote."
  }

  Copy-Item -Path (Join-Path $Cli.DirectoryName "*") -Destination $NativeDir -Recurse -Force
}

$Models = @(
  @{
    Name = "small"
    File = "ggml-small-q5_1.bin"
    Url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"
  }
)

if ($Profile -in @("standard", "all")) {
  $Models += @{
    Name = "medium"
    File = "ggml-medium-q5_0.bin"
    Url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin"
  }
}

if ($Profile -eq "all") {
  $Models += @{
    Name = "large-v3-turbo"
    File = "ggml-large-v3-turbo-q5_0.bin"
    Url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"
  }
}

foreach ($Model in $Models) {
  $Target = Join-Path $ModelsDir $Model.File
  if (Test-Path $Target) {
    Write-Host "Modelo $($Model.Name) já existe."
    continue
  }
  Write-Host "Baixando modelo $($Model.Name)..."
  Invoke-WebRequest -Uri $Model.Url -OutFile $Target
}

Write-Host ""
Write-Host "Setup concluído."
Write-Host "Binário: $(Join-Path $NativeDir 'whisper-cli.exe')"
Write-Host "Modelos: $ModelsDir"
