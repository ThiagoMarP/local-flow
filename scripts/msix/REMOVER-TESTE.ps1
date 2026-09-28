# Remove o pacote MSIX e a confianca no certificado local de desenvolvimento.
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

Get-AppxPackage -Name "com.localflow.desktop" -ErrorAction SilentlyContinue |
  Remove-AppxPackage

if (Test-Path -LiteralPath $certificatePath) {
  $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $certificatePath
  )
  $certificateStores = @(
    "Cert:\LocalMachine\TrustedPeople",
    "Cert:\CurrentUser\TrustedPeople"
  )
  foreach ($store in $certificateStores) {
    $trustedCertificate = Join-Path $store $certificate.Thumbprint
    if (Test-Path -LiteralPath $trustedCertificate) {
      Remove-Item -LiteralPath $trustedCertificate -Force
    }
  }
}

Write-Host "TESTE REMOVIDO"
Write-Host "O pacote e o certificado de teste foram removidos."
