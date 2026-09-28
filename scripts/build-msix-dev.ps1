# Gera um AppX/MSIX de desenvolvimento assinado com certificado local.
# O certificado privado fica somente em work/msix-dev (pasta ignorada pelo Git).
# O pacote de entrega recebe apenas o certificado publico (.cer).
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content (Join-Path $projectRoot "package.json") -Raw |
  ConvertFrom-Json
$version = $package.version
$privateDir = Join-Path $projectRoot "work\msix-dev"
$deliveryDir = Join-Path $projectRoot "dist\Local Flow - MSIX teste local v$version"
$pfxPath = Join-Path $privateDir "LocalFlow-Dev-Thiago.pfx"
$cerPath = Join-Path $privateDir "LocalFlow-Dev-Thiago.cer"
$layoutDir = Join-Path $privateDir "layout-$version"
$subject = "CN=Thiago Marcal"
$developmentPassword = "password"

New-Item -ItemType Directory -Force -Path $privateDir | Out-Null
New-Item -ItemType Directory -Force -Path $deliveryDir | Out-Null

Write-Host "[1/6] Criando ou reutilizando certificado RSA de desenvolvimento..."
& (Join-Path $projectRoot "node_modules\.bin\winapp.cmd") cert generate `
  --publisher $subject `
  --output $pfxPath `
  --password $developmentPassword `
  --valid-days 730 `
  --export-cer `
  --if-exists Skip
if ($LASTEXITCODE -ne 0) {
  throw "winapp cert generate terminou com codigo $LASTEXITCODE."
}

# O electron-builder antigo do projeto usa um SignTool que nao funciona neste
# Windows Insider. Ele monta o AppX sem assinatura; a CLI oficial da Microsoft
# aplica a assinatura atual logo depois.
$cscVariables = @(
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD"
)
$previousCsc = @{}
foreach ($name in $cscVariables) {
  $previousCsc[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
  [Environment]::SetEnvironmentVariable($name, $null, "Process")
}

try {
  Write-Host "[2/6] Gerando o pacote AppX/MSIX..."
  & (Join-Path $projectRoot "node_modules\.bin\electron-builder.cmd") `
    --win appx --x64 --publish never
  if ($LASTEXITCODE -ne 0) {
    throw "electron-builder terminou com codigo $LASTEXITCODE."
  }
} finally {
  foreach ($name in $cscVariables) {
    [Environment]::SetEnvironmentVariable(
      $name,
      $previousCsc[$name],
      "Process"
    )
  }
}

$appx = Get-ChildItem (Join-Path $projectRoot "dist") `
  -Filter "Local Flow Teste $version.appx" |
  Select-Object -First 1
if (-not $appx) {
  throw "Pacote AppX nao encontrado depois do build."
}

# electron-builder still emits the legacy Windows.FullTrustApplication entry
# point. On current Windows builds that places Electron in a Desktop AppX
# container where Chromium cannot open the microphone. Repack explicitly as a
# medium-integrity Win32 app, preserving package identity and Store readiness.
Write-Host "[3/7] Ajustando o manifesto para microfone Win32..."
$resolvedPrivateDir = [IO.Path]::GetFullPath($privateDir)
$resolvedLayoutDir = [IO.Path]::GetFullPath($layoutDir)
if (-not $resolvedLayoutDir.StartsWith(
  $resolvedPrivateDir + [IO.Path]::DirectorySeparatorChar
)) {
  throw "Pasta temporaria fora de work/msix-dev: $resolvedLayoutDir"
}
if (Test-Path -LiteralPath $resolvedLayoutDir) {
  Remove-Item -LiteralPath $resolvedLayoutDir -Recurse -Force
}
New-Item -ItemType Directory -Path $resolvedLayoutDir | Out-Null

& (Join-Path $projectRoot "node_modules\.bin\winapp.cmd") tool makeappx -- `
  unpack /p $appx.FullName /d $resolvedLayoutDir /o
if ($LASTEXITCODE -ne 0) {
  throw "makeappx unpack terminou com codigo $LASTEXITCODE."
}

# electron-builder converts the colored app icon to a monochrome AppX tile.
# Replace those generated images with the same blue/purple artwork used by the
# taskbar and executable so Settings and Start show the Local Flow identity.
Add-Type -AssemblyName System.Drawing
function Write-LocalFlowLogo {
  param(
    [Drawing.Image]$Source,
    [string]$Destination,
    [int]$Width,
    [int]$Height,
    [int]$LogoSize
  )

  $bitmap = [Drawing.Bitmap]::new(
    $Width,
    $Height,
    [Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.CompositingQuality = `
      [Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = `
      [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
    $x = [int](($Width - $LogoSize) / 2)
    $y = [int](($Height - $LogoSize) / 2)
    $graphics.DrawImage(
      $Source,
      [Drawing.Rectangle]::new($x, $y, $LogoSize, $LogoSize)
    )
    $bitmap.Save($Destination, [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$sourceLogo = [Drawing.Image]::FromFile(
  (Join-Path $projectRoot "assets\icon.png")
)
$appxAssets = Join-Path $resolvedLayoutDir "assets"
try {
  Write-LocalFlowLogo $sourceLogo `
    (Join-Path $appxAssets "Square44x44Logo.png") 44 44 40
  Write-LocalFlowLogo $sourceLogo `
    (Join-Path $appxAssets "StoreLogo.png") 50 50 46
  Write-LocalFlowLogo $sourceLogo `
    (Join-Path $appxAssets "Square150x150Logo.png") 150 150 132
  Write-LocalFlowLogo $sourceLogo `
    (Join-Path $appxAssets "Wide310x150Logo.png") 310 150 132
} finally {
  $sourceLogo.Dispose()
}

$manifestPath = Join-Path $resolvedLayoutDir "AppxManifest.xml"
[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
$uap10 = "http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
$manifest.Package.SetAttribute("xmlns:uap10", $uap10)
$uap3 = "http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
$desktop = "http://schemas.microsoft.com/appx/manifest/desktop/windows10"
$manifest.Package.SetAttribute("xmlns:uap3", $uap3)
$ignorable = @(
  $manifest.Package.GetAttribute("IgnorableNamespaces").Split(" ",
    [StringSplitOptions]::RemoveEmptyEntries)
  "uap10"
  "uap3"
) | Select-Object -Unique
$manifest.Package.SetAttribute("IgnorableNamespaces", ($ignorable -join " "))
$application = $manifest.Package.Applications.Application
$application.RemoveAttribute("EntryPoint")
$application.SetAttribute("RuntimeBehavior", $uap10, "win32App")
$application.SetAttribute("TrustLevel", $uap10, "mediumIL")

# This extension keeps activation compatible with Windows application-control
# policy on the test machine. The app itself executes the packaged Whisper path
# directly; invoking this alias while Local Flow is running would create a
# second package activation and tear down the shared Desktop AppX container.
$extensions = $manifest.CreateElement("Extensions", $manifest.Package.NamespaceURI)
$aliasExtension = $manifest.CreateElement("uap3", "Extension", $uap3)
$aliasExtension.SetAttribute("Category", "windows.appExecutionAlias")
$aliasExtension.SetAttribute(
  "Executable",
  "app\resources\native\whisper\whisper-cli.exe"
)
$aliasExtension.SetAttribute("EntryPoint", "Windows.FullTrustApplication")
$appExecutionAlias = $manifest.CreateElement(
  "uap3",
  "AppExecutionAlias",
  $uap3
)
$executionAlias = $manifest.CreateElement(
  "desktop",
  "ExecutionAlias",
  $desktop
)
$executionAlias.SetAttribute("Alias", "localflow-whisper.exe")
[void]$appExecutionAlias.AppendChild($executionAlias)
[void]$aliasExtension.AppendChild($appExecutionAlias)
[void]$extensions.AppendChild($aliasExtension)
[void]$application.AppendChild($extensions)
$xmlSettings = [Xml.XmlWriterSettings]::new()
$xmlSettings.Encoding = [Text.UTF8Encoding]::new($false)
$xmlSettings.Indent = $true
$writer = [Xml.XmlWriter]::Create($manifestPath, $xmlSettings)
try {
  $manifest.Save($writer)
} finally {
  $writer.Dispose()
}

# A win32App package is activated under Windows application-control rules. Sign
# the primary Electron image. Whisper and its DLLs stay unsigned individually;
# their integrity is covered by the signed AppX catalog. Self-signing those
# secondary files can conflict with Windows application-control policy.
$innerExecutables = @(
  (Join-Path $resolvedLayoutDir "app\Local Flow.exe")
)
foreach ($innerExecutable in $innerExecutables) {
  & (Join-Path $projectRoot "node_modules\.bin\winapp.cmd") sign `
    $innerExecutable `
    $pfxPath `
    --password $developmentPassword
  if ($LASTEXITCODE -ne 0) {
    throw "Assinatura interna terminou com codigo $LASTEXITCODE."
  }
}

$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
  $pfxPath,
  $developmentPassword
)
$nativeWindowsDir = Join-Path $resolvedLayoutDir `
  "app\resources\native\windows"
Get-ChildItem -LiteralPath $nativeWindowsDir -Filter "*.ps1" -File |
  ForEach-Object {
    $scriptSignature = Set-AuthenticodeSignature `
      -LiteralPath $_.FullName `
      -Certificate $certificate `
      -HashAlgorithm SHA256
    if (-not $scriptSignature.SignerCertificate -or
        $scriptSignature.SignerCertificate.Thumbprint -ne
          $certificate.Thumbprint) {
      throw "Falha ao assinar script interno $($_.Name)."
    }
    if ($scriptSignature.Status -ne "Valid") {
      Write-Host (
        "ASSINATURA_INTERNA_AINDA_NAO_CONFIADA=" + $_.Name + ":" +
        $scriptSignature.Status
      )
    }
  }

$footprints = @(
  (Join-Path $resolvedLayoutDir "AppxBlockMap.xml"),
  (Join-Path $resolvedLayoutDir "AppxSignature.p7x"),
  (Join-Path $resolvedLayoutDir "AppxMetadata\CodeIntegrity.cat")
)
foreach ($footprint in $footprints) {
  if (Test-Path -LiteralPath $footprint) {
    Remove-Item -LiteralPath $footprint -Force
  }
}

$repackedAppx = Join-Path $privateDir $appx.Name
if (Test-Path -LiteralPath $repackedAppx) {
  Remove-Item -LiteralPath $repackedAppx -Force
}
& (Join-Path $projectRoot "node_modules\.bin\winapp.cmd") tool makeappx -- `
  pack /d $resolvedLayoutDir /p $repackedAppx /o
if ($LASTEXITCODE -ne 0) {
  throw "makeappx pack terminou com codigo $LASTEXITCODE."
}

Write-Host "[4/7] Assinando com a CLI oficial da Microsoft..."
& (Join-Path $projectRoot "node_modules\.bin\winapp.cmd") sign `
  $repackedAppx `
  $pfxPath `
  --password $developmentPassword
if ($LASTEXITCODE -ne 0) {
  throw "winapp sign terminou com codigo $LASTEXITCODE."
}

$appx = Get-Item -LiteralPath $repackedAppx
Copy-Item -LiteralPath $appx.FullName `
  -Destination (Join-Path $projectRoot "dist\$($appx.Name)") -Force

Write-Host "[5/7] Montando pasta de teste local..."
Copy-Item -LiteralPath $appx.FullName `
  -Destination (Join-Path $deliveryDir $appx.Name) -Force
Copy-Item -LiteralPath $cerPath `
  -Destination (Join-Path $deliveryDir "LocalFlow-Dev.cer") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "scripts\msix\INSTALAR-TESTE.ps1") `
  -Destination (Join-Path $deliveryDir "INSTALAR-TESTE.ps1") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "scripts\msix\REMOVER-TESTE.ps1") `
  -Destination (Join-Path $deliveryDir "REMOVER-TESTE.ps1") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "docs\GUIA-MSIX-TESTE-LOCAL.md") `
  -Destination (Join-Path $deliveryDir "LEIA-ME - TESTE LOCAL.md") -Force

Write-Host "[6/7] Criando ZIP de teste..."
$zipPath = Join-Path $projectRoot "dist\Local Flow - MSIX teste local v$version.zip"
Compress-Archive -Path (Join-Path $deliveryDir "*") `
  -DestinationPath $zipPath -CompressionLevel Optimal -Force

Write-Host "[7/7] Verificando assinaturas..."
$appxSignature = Get-AuthenticodeSignature `
  -LiteralPath (Join-Path $deliveryDir $appx.Name)
if (-not $appxSignature.SignerCertificate -or
    $appxSignature.SignerCertificate.Subject -ne $subject) {
  throw "O AppX nao contem a assinatura de desenvolvimento esperada."
}
if ($appxSignature.Status -ne "Valid") {
  Write-Host (
    "ASSINATURA_AINDA_NAO_CONFIADA=" + $appxSignature.Status +
    " (normal antes de instalar LocalFlow-Dev.cer)"
  )
}

Write-Host "MSIX_TEST_READY=$deliveryDir"
Write-Host "MSIX_TEST_ZIP=$zipPath"
Write-Host "CERT_THUMBPRINT=$($certificate.Thumbprint)"
