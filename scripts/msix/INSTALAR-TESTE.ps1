# Instala o certificado publico de teste na maquina e o MSIX no usuario atual.
# Este fluxo e exclusivo para teste local; nao use o certificado em producao.
$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdministrator) {
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"' + $MyInvocation.MyCommand.Path + '"')
  )
  $process = Start-Process powershell.exe `
    -Verb RunAs `
    -ArgumentList $arguments `
    -Wait `
    -PassThru
  exit $process.ExitCode
}

$packageDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$certificatePath = Join-Path $packageDir "LocalFlow-Dev.cer"
$packagePath = Get-ChildItem -LiteralPath $packageDir `
  -Filter "Local Flow Teste *.appx" | Select-Object -First 1

if (-not (Test-Path -LiteralPath $certificatePath)) {
  throw "Certificado de teste nao encontrado: $certificatePath"
}
if (-not $packagePath) {
  throw "Pacote AppX de teste nao encontrado em $packageDir"
}

Write-Host "Confiando no certificado de teste Local Flow nesta maquina..."
$imported = Import-Certificate `
  -FilePath $certificatePath `
  -CertStoreLocation "Cert:\LocalMachine\TrustedPeople"

Write-Host "Instalando o Local Flow..."
Add-AppxPackage -Path $packagePath.FullName -ForceApplicationShutdown

$installedPackage = Get-AppxPackage -Name "com.localflow.desktop"
$appUserModelId = "$($installedPackage.PackageFamilyName)!LocalFlow"
Write-Host "Abrindo o painel do Local Flow..."
Start-Process explorer.exe -ArgumentList "shell:AppsFolder\$appUserModelId"

Write-Host ""
Write-Host "INSTALACAO CONCLUIDA"
Write-Host "O painel do Local Flow foi aberto automaticamente."
Write-Host "Certificado: $($imported.Thumbprint)"
