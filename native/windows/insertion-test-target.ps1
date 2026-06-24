param(
    [Parameter(Mandatory = $true)]
    [string]$Title,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.Width = 640
$form.Height = 180
$form.StartPosition = "CenterScreen"
$form.TopMost = $false

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Multiline = $true
$textBox.Dock = "Fill"
$textBox.Font = New-Object System.Drawing.Font("Segoe UI", 14)
$form.Controls.Add($textBox)

$utf8 = [System.Text.UTF8Encoding]::new($false)
$textBox.Add_TextChanged({
    [System.IO.File]::WriteAllText($OutputPath, $textBox.Text, $utf8)
})
$form.Add_Shown({
    $form.Activate()
    $textBox.Focus()
})

[System.Windows.Forms.Application]::Run($form)
