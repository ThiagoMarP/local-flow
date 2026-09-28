# Gera a entrega simples para usuários finais: instalador, guia e ZIP.
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content (Join-Path $projectRoot "package.json") -Raw |
  ConvertFrom-Json
$version = $package.version
$distDir = Join-Path $projectRoot "dist"
$deliveryDir = Join-Path $distDir "Local Flow - para compartilhar v$version"
$installer = Join-Path $distDir "Local Flow Setup $version.exe"
$guideTemplate = Join-Path $projectRoot "docs\GUIA-PARA-COMPARTILHAR.txt"
$zipPath = "$deliveryDir.zip"

Write-Host "[1/3] Gerando o instalador do Local Flow..."
& (Join-Path $projectRoot "node_modules\.bin\electron-builder.cmd") `
  --win nsis --publish never
if ($LASTEXITCODE -ne 0) {
  throw "electron-builder terminou com codigo $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $installer)) {
  throw "Instalador nao encontrado: $installer"
}

$resolvedDist = [IO.Path]::GetFullPath($distDir)
$resolvedDelivery = [IO.Path]::GetFullPath($deliveryDir)
if (-not $resolvedDelivery.StartsWith(
  $resolvedDist + [IO.Path]::DirectorySeparatorChar
)) {
  throw "Pasta de entrega fora de dist: $resolvedDelivery"
}

Write-Host "[2/3] Montando a pasta de entrega..."
if (Test-Path -LiteralPath $resolvedDelivery) {
  Remove-Item -LiteralPath $resolvedDelivery -Recurse -Force
}
New-Item -ItemType Directory -Path $resolvedDelivery | Out-Null
Copy-Item -LiteralPath $installer -Destination $resolvedDelivery

$guide = (Get-Content -LiteralPath $guideTemplate -Raw).Replace(
  "{{VERSION}}",
  $version
)
$guidePath = Join-Path $resolvedDelivery "LEIA-ME - INSTALACAO.txt"
[IO.File]::WriteAllText(
  $guidePath,
  $guide,
  [Text.UTF8Encoding]::new($true)
)

Write-Host "[3/3] Compactando..."
Compress-Archive -Path (Join-Path $resolvedDelivery "*") `
  -DestinationPath $zipPath -CompressionLevel Optimal -Force

Write-Host "SHARE_FOLDER=$resolvedDelivery"
Write-Host "SHARE_ZIP=$zipPath"
