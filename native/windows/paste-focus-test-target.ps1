param(
    [Parameter(Mandatory = $true)] [string]$Title,
    [Parameter(Mandatory = $true)] [string]$StatusPath,
    [Parameter(Mandatory = $true)] [string]$TriggerPath,
    [string]$PasteText = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.Width = 640
$form.Height = 220
$form.StartPosition = "CenterScreen"

$menu = New-Object System.Windows.Forms.MenuStrip
$helpItem = New-Object System.Windows.Forms.ToolStripMenuItem("&Help")
$helpItem.DropDownItems.Add("About") | Out-Null
$menu.Items.Add($helpItem) | Out-Null
$form.MainMenuStrip = $menu
$form.Controls.Add($menu)

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Multiline = $true
$textBox.Dock = "Fill"
$textBox.Font = New-Object System.Drawing.Font("Segoe UI", 14)
$form.Controls.Add($textBox)
$utf8 = [System.Text.UTF8Encoding]::new($false)
$script:clipboardBackup = $null
if ($PasteText) {
    $script:clipboardBackup = [System.Windows.Forms.Clipboard]::GetDataObject()
    [System.Windows.Forms.Clipboard]::SetText($PasteText)
}

$writeStatus = {
    $status = [ordered]@{
        text = $textBox.Text
        textFocused = $textBox.Focused
        helpOpen = $helpItem.DropDown.Visible
        foreground = $form.ContainsFocus
    }
    [System.IO.File]::WriteAllText(
        $StatusPath,
        ($status | ConvertTo-Json -Compress),
        $utf8
    )
}

$textBox.Add_TextChanged($writeStatus)
$helpItem.Add_DropDownOpened($writeStatus)
$helpItem.Add_DropDownClosed($writeStatus)
$form.Add_Shown({
    $form.Activate()
    $textBox.Focus()
    & $writeStatus
})
$form.Add_FormClosed({
    if ($PasteText) {
        if ($null -ne $script:clipboardBackup) {
            [System.Windows.Forms.Clipboard]::SetDataObject($script:clipboardBackup, $true)
        } else {
            [System.Windows.Forms.Clipboard]::Clear()
        }
    }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 50
$timer.Add_Tick({
    if ([System.IO.File]::Exists($TriggerPath)) {
        $signal = [System.IO.File]::ReadAllText($TriggerPath).Trim()
        [System.IO.File]::Delete($TriggerPath)
        if ($signal -eq "menu") {
            $menu.Focus()
            $helpItem.ShowDropDown()
        } elseif ($signal -eq "quit") {
            $form.Close()
        }
    }
    & $writeStatus
})
$timer.Start()

[System.Windows.Forms.Application]::Run($form)
