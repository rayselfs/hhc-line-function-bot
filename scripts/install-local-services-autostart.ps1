$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "start-local-services.ps1"
$taskName = "HHC Line Bot Local Services"
$action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isElevated) {
  schtasks.exe /Create /TN $taskName /SC ONLOGON /TR $action /F 2>$null | Out-Null
}
if ($isElevated -and $LASTEXITCODE -eq 0) {
  Write-Output "Installed scheduled task: $taskName"
  return
}

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "$taskName.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
$shortcut.WorkingDirectory = Split-Path -Parent $scriptPath
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Output "Scheduled Task was unavailable; installed Startup shortcut: $shortcutPath"
