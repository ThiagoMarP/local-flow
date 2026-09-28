# Deploy local em um comando: encerra o app, builda o instalador numa pasta
# nova (evita os locks de Defender/Explorer em dist\win-unpacked), instala
# silencioso por cima e reabre o app. Uso: npm run deploy
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Write-NoBom($path, $content) {
  [System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding $false))
}

Write-Host "[1/6] Encerrando o Local Flow (se estiver aberto)..."
Get-Process -Name "Local Flow" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$outRel = "dist/builds/$ts"
$tmpCfg = Join-Path $root ".eb-deploy.tmp.yml"

Write-Host "[2/6] Preparando config de build (saida: $outRel)..."
$cfg = Get-Content (Join-Path $root "electron-builder.yml") -Raw
$replacement = '${1}' + $outRel
$cfg = [regex]::Replace($cfg, '(?m)^(\s*output:\s*).*$', $replacement)
Write-NoBom $tmpCfg $cfg

try {
  Write-Host "[3/6] Buildando o instalador (pode levar alguns minutos)..."
  & "$root\node_modules\.bin\electron-builder.cmd" --win nsis -c "$tmpCfg"
  if ($LASTEXITCODE -ne 0) { throw "Falha no build (exit $LASTEXITCODE)" }
} finally {
  Remove-Item $tmpCfg -Force -ErrorAction SilentlyContinue
}

$setup = Get-ChildItem (Join-Path $root $outRel) -Filter "*Setup*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $setup) { throw "Instalador nao encontrado em $outRel" }

Write-Host "[4/6] Instalando (silencioso): $($setup.Name)..."
Start-Process -FilePath $setup.FullName -ArgumentList "/S" -Wait
Start-Sleep -Seconds 3

Write-Host "[5/6] Abrindo o app..."
$exe = Join-Path $env:LOCALAPPDATA "Programs\Local Flow\Local Flow.exe"
if (Test-Path $exe) {
  Start-Process $exe; Start-Sleep -Seconds 3; Start-Process $exe
} else {
  Write-Host "  (exe instalado nao encontrado em $exe - abra manualmente)"
}

Write-Host "[6/6] Limpando builds antigos (mantendo os 2 mais recentes)..."
$buildsDir = Join-Path $root "dist\builds"
if (Test-Path $buildsDir) {
  Get-ChildItem $buildsDir -Directory | Sort-Object Name -Descending |
    Select-Object -Skip 2 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "OK! Local Flow atualizado e aberto."
